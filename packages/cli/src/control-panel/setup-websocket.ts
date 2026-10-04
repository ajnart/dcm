import WebSocket from "ws";
import { verifyWarriorIdleSnapshot } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/idle-config.ts";

/** SockJS opening snapshot only. Basic auth is sent privately, but the pinned
 * Warrior connection itself does not enforce it; HTTP login proof is separate.
 * This channel never sends a frame and remains restricted to private loopback.
 */
export function warriorIdleOpeningSnapshot(origin: string, authorization: string): Promise<readonly unknown[]> {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1"
    || endpoint.username || endpoint.password || endpoint.pathname !== "/"
    || endpoint.search || endpoint.hash || !endpoint.port
    || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization) || authorization.length > 2048) {
    throw new Error("Warrior snapshot requires the exact private loopback origin and Basic identity");
  }
  endpoint.protocol = "ws:";
  endpoint.pathname = "/000/auto-stack/websocket";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.href, { followRedirects: false, maxPayload: 65_536,
      perMessageDeflate: false, handshakeTimeout: 15000, maxFragments: 16, maxBufferedChunks: 16,
      headers: { Authorization: authorization } });
    const expected = ["instance_id", "project.refresh", "warrior.projects_loaded", "warrior.status", "warrior.broadcast_message"];
    const events: unknown[] = [];
    let opened = false;
    let completed = false;
    let frames = 0;
    let bytes = 0;
    const finish = (error?: Error) => {
      if (completed) return;
      completed = true;
      clearTimeout(deadline);
      socket.terminate();
      if (error) reject(error);
      else resolve(events);
    };
    const failure = () => finish(new Error("Warrior opening snapshot is incomplete, nonidle or unavailable"));
    const deadline = setTimeout(failure, 15000);
    socket.on("error", failure);
    socket.on("close", () => { if (!completed) failure(); });
    socket.on("message", (data, binary) => {
      if (completed) return;
      frames += 1;
      const frame = data.toString();
      bytes += Buffer.byteLength(frame);
      if (binary || frames > 16 || bytes > 65_536) { failure(); return; }
      if (!opened) {
        if (frame !== "o") { failure(); return; }
        opened = true;
        return;
      }
      try {
        if (!frame.startsWith("a")) { failure(); return; }
        const messages: unknown = JSON.parse(frame.slice(1));
        if (!Array.isArray(messages) || messages.length < 1 || messages.length > 5) { failure(); return; }
        for (const message of messages) {
          if (typeof message !== "string") { failure(); return; }
          const event = JSON.parse(message);
          if (!event || typeof event !== "object" || Array.isArray(event)
            || event.event_name !== expected[events.length] || !Object.hasOwn(event, "message")) {
            failure(); return;
          }
          events.push(event);
        }
        if (events.length === expected.length) {
          verifyWarriorIdleSnapshot(events);
          finish();
        }
      } catch { failure(); }
    });
  });
}

/** Home Assistant's authenticated, single-command JSON exchange. No redirects, subscriptions or headers. */
export function authenticatedJsonCommand(origin: string, accessToken: string, command: string,
  registerSecret: (value: string) => void): Promise<unknown> {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1"
    || endpoint.username || endpoint.password || endpoint.pathname !== "/"
    || endpoint.search || endpoint.hash || !endpoint.port) {
    throw new Error("Setup WebSocket requires the exact saved loopback HTTP origin");
  }
  endpoint.protocol = "ws:";
  endpoint.pathname = "/api/websocket";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.href, { followRedirects: false, maxPayload: 1024 * 1024,
      perMessageDeflate: false, handshakeTimeout: 15000, maxFragments: 64, maxBufferedChunks: 64 });
    let phase: "challenge" | "authenticated" | "result" = "challenge";
    let completed = false;
    let frames = 0;
    let received = 0;
    const finish = (error?: Error, value?: unknown) => {
      if (completed) return;
      completed = true;
      clearTimeout(deadline);
      socket.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const failure = () => finish(new Error("Local setup WebSocket failed or its outcome is unknown; inspect the saved checkpoint before retrying"));
    const deadline = setTimeout(failure, 15000);
    socket.on("error", failure);
    socket.on("close", () => { if (!completed) failure(); });
    socket.on("message", (data, isBinary) => {
      if (completed) return;
      if (isBinary) { failure(); return; }
      const text = data.toString();
      frames += 1;
      received += Buffer.byteLength(text);
      if (frames > 3 || received > 1024 * 1024) { failure(); return; }
      let message: Record<string, unknown>;
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value)) { failure(); return; }
        message = value;
      } catch { failure(); return; }
      try {
        if (phase === "challenge" && message.type === "auth_required") {
          phase = "authenticated";
          socket.send(JSON.stringify({type:"auth", access_token:accessToken}));
          return;
        }
        if (phase === "authenticated" && message.type === "auth_ok") {
          phase = "result";
          socket.send(command);
          return;
        }
        if (phase !== "result" || message.type !== "result" || message.id !== 1
          || message.success !== true || !Object.hasOwn(message,"result")) { failure(); return; }
        // Token results can be plain strings rather than a named secret field.
        if (typeof message.result === "string") registerSecret(message.result);
        finish(undefined,message.result);
      } catch { failure(); }
    });
  });
}
