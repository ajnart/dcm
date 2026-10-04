import type { SetupContext, SetupCheckpointUpdate, SetupHttpApproval } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { setupRecord } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const MAX_FRAME_BYTES = 131072;
const MAX_PACKETS = 64;
type Packet = { kind: "connect" | "event" | "ack" | "ping"; id?: number; value?: unknown };

function parsePackets(body: string): Packet[] {
  if (body.length > MAX_FRAME_BYTES) throw new Error("Socket.IO polling frame exceeds the limit");
  const frames = body.split("\x1e");
  if (frames.length > MAX_PACKETS) throw new Error("Socket.IO polling batch exceeds the limit");
  return frames.map((frame) => {
    if (frame === "2") return { kind: "ping" };
    if (frame.startsWith("40")) {
      if (frame.length > 2) setupRecord(JSON.parse(frame.slice(2)), "Socket.IO namespace connect");
      return { kind: "connect" };
    }
    if (/^4[23]\d/.test(frame)) {
      const match = /^4([23])(\d+)(\[.*\])$/s.exec(frame);
      if (!match) throw new Error("Socket.IO packet is invalid");
      const value: unknown = JSON.parse(match[3]!);
      const id = Number(match[2]);
      if (!Number.isSafeInteger(id) || !Array.isArray(value) || (match[1] === "3" && value.length !== 1)) {
        throw new Error("Socket.IO payload is invalid");
      }
      let kind: Packet["kind"] = "event";
      if (match[1] === "3") kind = "ack";
      return { kind, id, value };
    }
    if (/^42\[/.test(frame)) {
      const value: unknown = JSON.parse(frame.slice(2));
      if (!Array.isArray(value)) throw new Error("Socket.IO event is invalid");
      return { kind: "event", value };
    }
    throw new Error("Engine.IO packet is unsupported");
  });
}

/** Owner-bound transport only. App adapters own event intents and retained metadata.
 * No origin, credentials, API keys or login tokens are stored by this module. */
export class SetupEngineIoPolling {
  private sid: string | null = null;
  private nextId = 1;
  private pending: Packet[] = [];
  private pushed = new Map<string, unknown[]>();

  constructor(private readonly context: Pick<SetupContext, "http">,
    private readonly options: {
      approval(event: string): SetupHttpApproval;
      retainEvents: readonly string[];
    }) {
    if (options.retainEvents.length > 16 || new Set(options.retainEvents).size !== options.retainEvents.length
      || options.retainEvents.some((name) => !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name))) {
      throw new Error("Socket.IO retained event selection is invalid");
    }
  }

  takeEvent(name: string): unknown[] | undefined {
    const value = this.pushed.get(name);
    this.pushed.delete(name);
    return value;
  }

  /** Await only explicitly retained unsolicited metadata. Absence never proves
   * application state. Uses the same bounded frames and owner-bound polling. */
  async waitEvent(name: string): Promise<unknown[]> {
    if (!this.options.retainEvents.includes(name)) throw new Error("Socket.IO event was not selected for retention");
    const retained = this.takeEvent(name);
    if (retained) return retained;
    for (let tries = 0; tries < 12; tries++) {
      const packet = await this.next();
      if (packet.kind === "ack") throw new Error("Unexpected Socket.IO acknowledgment while awaiting metadata");
      this.retain(packet);
      const value = this.takeEvent(name);
      if (value) return value;
    }
    throw new Error("Socket.IO retained event was not received");
  }

  private retain(packet: Packet) {
    if (packet.kind !== "event" || !Array.isArray(packet.value)) return;
    if (this.options.retainEvents.includes(packet.value[0])) {
      this.pushed.set(packet.value[0], packet.value.slice(1));
    }
  }

  private async request(method: "GET" | "POST", body?: string,
    approval?: SetupHttpApproval, beforeSendCheckpoint?: SetupCheckpointUpdate) {
    const query: Record<string, string> = { EIO: "4", transport: "polling" };
    if (this.sid) query.sid = this.sid;
    const request = { method, path: "/socket.io/", query, timeoutMs: 35000 };
    let response;
    if (body === undefined) response = await this.context.http.request(request);
    else {
      response = await this.context.http.request({ ...request, body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        ...(!approval && { effect: "socketio-control" as const }),
        ...(approval && { approval }), ...(beforeSendCheckpoint && { beforeSendCheckpoint }) });
    }
    if (response.status !== 200) throw new Error("Socket.IO polling transport failed");
    const text = await response.text();
    if (text.length > MAX_FRAME_BYTES) throw new Error("Socket.IO polling response exceeds the limit");
    return text;
  }

  async connect() {
    const open = await this.request("GET");
    if (!open.startsWith("0") || open.length > 4096) throw new Error("Engine.IO handshake is invalid");
    const handshake = setupRecord(JSON.parse(open.slice(1)), "Engine.IO handshake");
    if (typeof handshake.sid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(handshake.sid)) {
      throw new Error("Engine.IO session is invalid");
    }
    this.sid = handshake.sid;
    await this.send("40");
    let connected = false;
    let infoReceived = false;
    for (let tries = 0; tries < 12; tries++) {
      const packet = await this.next();
      this.retain(packet);
      if (packet.kind === "connect") connected = true;
      if (packet.kind === "event" && Array.isArray(packet.value) && packet.value[0] === "info") infoReceived = true;
      if (connected && infoReceived) return;
    }
    throw new Error("Socket.IO namespace and info readiness did not complete");
  }

  private async send(body: string, approval?: SetupHttpApproval, checkpoint?: SetupCheckpointUpdate) {
    const receipt = await this.request("POST", body, approval, checkpoint);
    if (receipt !== "ok") throw new Error("Engine.IO polling write was not acknowledged");
  }

  private async next(): Promise<Packet> {
    for (let tries = 0; tries < 24; tries++) {
      if (this.pending.length === 0) this.pending = parsePackets(await this.request("GET"));
      const packet = this.pending.shift()!;
      if (packet.kind === "ping") { await this.send("3"); continue; }
      return packet;
    }
    throw new Error("Socket.IO polling response did not complete");
  }

  async event(name: string, args: unknown[], checkpoint?: SetupCheckpointUpdate): Promise<unknown> {
    const id = this.nextId++;
    const approval = { ...this.options.approval(name) };
    if (checkpoint) approval.once = true;
    await this.send(`42${id}${JSON.stringify([name, ...args])}`, approval, checkpoint);
    for (let tries = 0; tries < 24; tries++) {
      const packet = await this.next();
      this.retain(packet);
      if (packet.kind === "ack") {
        if (packet.id !== id) throw new Error("Socket.IO acknowledgment ID mismatched");
        return (packet.value as unknown[])[0];
      }
    }
    throw new Error("Socket.IO acknowledgment was not received");
  }
}
