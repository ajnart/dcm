/** Bounded Uptime Kuma v2.5.5 status-page flow. Its HTTP endpoints are unauthenticated. */
import { io, type Socket } from "socket.io-client";

export const uptimeStatusPageSlug = "default";
export const uptimeStatusPageTitle = "Local service status";
export const uptimeStatusPageGroup = "Services";
const version = "2.5.5";
const timeoutMs = 10_000;

type ObjectValue = Record<string, unknown>;
export type UptimeStatusPageStage = "add-attempted" | "save-attempted" | "recorded";
export type UptimeStatusPageReadback = {
  exists: boolean;
  title: string | null;
  groupCount: number;
  monitorIds: number[];
  exact: boolean;
  heartbeatUp: boolean;
};

export class UptimeStatusPageError extends Error {
  constructor(readonly code: string, readonly uncertain = false) {
    super(code.replaceAll("-", " "));
    this.name = "UptimeStatusPageError";
  }
}

function object(value: unknown, code: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UptimeStatusPageError(code);
  return value as ObjectValue;
}

function input(origin: string, username: string, password: string, monitorId: number): void {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)
    || !/^[A-Za-z0-9._-]{1,32}$/.test(username)
    || !password || password.length > 512 || /[\r\n\u0000-\u001f\u007f]/.test(password)
    || !Number.isSafeInteger(monitorId) || monitorId < 1) {
    throw new UptimeStatusPageError("uptime-status-page-input-invalid");
  }
}

async function ack(socket: Socket, event: string, args: unknown[], uncertain = false): Promise<unknown> {
  try { return await socket.timeout(timeoutMs).emitWithAck(event, ...args); }
  catch { throw new UptimeStatusPageError(`uptime-status-page-${event}-outcome-unknown`, uncertain); }
}

async function connect(origin: string, username: string, password: string): Promise<Socket> {
  const socket = io(origin, { autoConnect: false, reconnection: false, timeout: timeoutMs,
    transports: ["websocket"], forceNew: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new UptimeStatusPageError("uptime-status-page-info-timeout")), timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off("info", onInfo);
        socket.off("connect_error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onInfo = (value: unknown) => {
        try {
          const info = object(value, "uptime-status-page-info-invalid");
          if (typeof info.serverTimezone !== "string"
            || typeof info.serverTimezoneOffset !== "string"
            || !/^[+-]\d{2}:\d{2}$/.test(info.serverTimezoneOffset)) {
            finish(new UptimeStatusPageError("uptime-status-page-info-invalid"));
            return;
          }
          finish();
        } catch (error) {
          finish(error as Error);
        }
      };
      const onError = () => finish(new UptimeStatusPageError("uptime-status-page-socket-unavailable"));
      socket.on("info", onInfo);
      socket.on("connect_error", onError);
      socket.connect();
    });
    let authenticatedVersion: string | null = null;
    const onAuthenticatedInfo = (value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)
        && typeof (value as ObjectValue).version === "string") {
        authenticatedVersion = (value as ObjectValue).version as string;
      }
    };
    socket.on("info", onAuthenticatedInfo);
    let login: ObjectValue;
    try {
      login = object(await ack(socket, "login", [{ username, password, token: "" }]),
        "uptime-status-page-login-invalid");
    } finally {
      socket.off("info", onAuthenticatedInfo);
    }
    if (login.tokenRequired === true || login.ok !== true || typeof login.token !== "string" || !login.token) {
      throw new UptimeStatusPageError("uptime-status-page-login-rejected");
    }
    if (authenticatedVersion !== version) throw new UptimeStatusPageError("uptime-status-page-version-unsupported");
    return socket;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

async function config(socket: Socket): Promise<ObjectValue | null> {
  const result = object(await ack(socket, "getStatusPage", [uptimeStatusPageSlug]),
    "uptime-status-page-config-invalid");
  if (result.ok === false && result.msg === "No slug?") return null;
  if (result.ok !== true) throw new UptimeStatusPageError("uptime-status-page-config-invalid");
  const page = object(result.config, "uptime-status-page-config-invalid");
  if (page.slug !== uptimeStatusPageSlug || typeof page.title !== "string") {
    throw new UptimeStatusPageError("uptime-status-page-config-invalid");
  }
  return page;
}

async function json(origin: string, path: string): Promise<ObjectValue> {
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, { headers: { Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch { throw new UptimeStatusPageError("uptime-status-page-http-unavailable"); }
  if (response.status !== 200) throw new UptimeStatusPageError("uptime-status-page-http-invalid");
  try { return object(await response.json(), "uptime-status-page-http-invalid"); }
  catch { throw new UptimeStatusPageError("uptime-status-page-http-invalid"); }
}

async function read(socket: Socket, origin: string, monitorId: number): Promise<UptimeStatusPageReadback> {
  const page = await config(socket);
  if (!page) return { exists: false, title: null, groupCount: 0, monitorIds: [], exact: false, heartbeatUp: false };
  const publicPage = await json(origin, `/api/status-page/${uptimeStatusPageSlug}`);
  if (!Array.isArray(publicPage.publicGroupList)) throw new UptimeStatusPageError("uptime-status-page-public-invalid");
  const groups = publicPage.publicGroupList.map((value) => object(value, "uptime-status-page-public-invalid"));
  const ids: number[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.monitorList)) throw new UptimeStatusPageError("uptime-status-page-public-invalid");
    for (const value of group.monitorList) {
      const monitor = object(value, "uptime-status-page-public-invalid");
      if (!Number.isSafeInteger(monitor.id) || Number(monitor.id) < 1) {
        throw new UptimeStatusPageError("uptime-status-page-public-invalid");
      }
      ids.push(Number(monitor.id));
    }
  }
  const exact = page.title === uptimeStatusPageTitle && groups.length === 1
    && groups[0].name === uptimeStatusPageGroup && ids.length === 1 && ids[0] === monitorId;
  let heartbeatUp = false;
  if (exact) {
    const heartbeat = await json(origin, `/api/status-page/heartbeat/${uptimeStatusPageSlug}`);
    const beats = object(heartbeat.heartbeatList, "uptime-status-page-heartbeat-invalid");
    const uptime = object(heartbeat.uptimeList, "uptime-status-page-heartbeat-invalid");
    const list = beats[String(monitorId)];
    if (!Array.isArray(list) || typeof uptime[`${monitorId}_24`] !== "number") {
      throw new UptimeStatusPageError("uptime-status-page-heartbeat-invalid");
    }
    const latest = list.at(-1);
    heartbeatUp = latest !== undefined && object(latest, "uptime-status-page-heartbeat-invalid").status === 1;
  }
  return { exists: true, title: page.title, groupCount: groups.length, monitorIds: ids,
    exact, heartbeatUp };
}

export async function inspectUptimeStatusPage(origin: string, username: string, password: string,
  monitorId: number): Promise<UptimeStatusPageReadback> {
  input(origin, username, password, monitorId);
  const socket = await connect(origin, username, password);
  try { return await read(socket, origin, monitorId); }
  finally { socket.disconnect(); }
}

/** Do not replay either uncertain write. The caller persists each stage before emission. */
export async function createUptimeStatusPage(origin: string, username: string, password: string,
  monitorId: number, stage: UptimeStatusPageStage | null,
  beforeAdd: () => Promise<void>, beforeSave: () => Promise<void>): Promise<UptimeStatusPageReadback> {
  input(origin, username, password, monitorId);
  const socket = await connect(origin, username, password);
  try {
    let current = await read(socket, origin, monitorId);
    if (stage === "recorded") {
      if (!current.exact) throw new UptimeStatusPageError("uptime-status-page-changed");
      return current;
    }
    if (stage === "save-attempted") {
      if (!current.exact) throw new UptimeStatusPageError("uptime-status-page-save-uncertain", true);
      return current;
    }
    if (stage === null) {
      if (current.exists) throw new UptimeStatusPageError("uptime-status-page-collision");
      await beforeAdd();
      const result = object(await ack(socket, "addStatusPage", [uptimeStatusPageTitle, uptimeStatusPageSlug], true),
        "uptime-status-page-add-invalid");
      if (result.ok !== true || result.slug !== uptimeStatusPageSlug) {
        throw new UptimeStatusPageError("uptime-status-page-add-uncertain", true);
      }
      current = await read(socket, origin, monitorId);
    }
    if (!current.exists || current.title !== uptimeStatusPageTitle || current.groupCount !== 0) {
      throw new UptimeStatusPageError("uptime-status-page-add-uncertain", true);
    }
    const page = await config(socket);
    if (!page || page.title !== uptimeStatusPageTitle || page.slug !== uptimeStatusPageSlug
      || !Array.isArray(page.domainNameList) || page.domainNameList.length !== 0) {
      throw new UptimeStatusPageError("uptime-status-page-config-changed");
    }
    await beforeSave();
    const result = object(await ack(socket, "saveStatusPage", [uptimeStatusPageSlug, page, "",
      [{ name: uptimeStatusPageGroup, monitorList: [{ id: monitorId }] }]], true),
    "uptime-status-page-save-invalid");
    if (result.ok !== true) throw new UptimeStatusPageError("uptime-status-page-save-uncertain", true);
    current = await read(socket, origin, monitorId);
    if (!current.exact) throw new UptimeStatusPageError("uptime-status-page-save-uncertain", true);
    return current;
  } finally { socket.disconnect(); }
}
