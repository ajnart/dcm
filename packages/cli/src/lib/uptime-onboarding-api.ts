/** Released Uptime Kuma v2 first-owner Socket.IO flow. Never return tokens or sessions. */
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";

export class UptimeOnboardingError extends Error {
  constructor(readonly code: string, readonly uncertain = false) {
    super(code.replaceAll("-", " "));
    this.name = "UptimeOnboardingError";
  }
}

type Reply = Record<string, unknown>;
const timeoutMs = 10_000;

async function databaseInfo(origin: string): Promise<{ runningSetup: boolean; needSetup: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${origin}/setup-database-info`, {
      headers: { Accept: "application/json" }, redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new UptimeOnboardingError("uptime-database-info-unavailable");
  }
  if (response.status !== 200) throw new UptimeOnboardingError("uptime-database-info-invalid");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new UptimeOnboardingError("uptime-database-info-invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof (value as Reply).runningSetup !== "boolean"
    || typeof (value as Reply).needSetup !== "boolean") {
    throw new UptimeOnboardingError("uptime-database-info-invalid");
  }
  return value as { runningSetup: boolean; needSetup: boolean };
}

/** v2.5.5 serves an HTTP-only SQLite setup gate before Socket.IO exists. */
export async function ensureUptimeSqliteDatabase(origin: string, maySubmit: boolean,
  onBeforeWrite: () => Promise<void>): Promise<void> {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)) {
    throw new UptimeOnboardingError("uptime-input-invalid");
  }
  const before = await databaseInfo(origin);
  if (!before.needSetup) return;
  if (before.runningSetup) throw new UptimeOnboardingError("uptime-database-setup-busy");
  if (!maySubmit) throw new UptimeOnboardingError("uptime-database-setup-needs-inspection");
  await onBeforeWrite();
  let response: Response;
  try {
    response = await fetch(`${origin}/setup-database`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ dbConfig: { type: "sqlite" } }), redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new UptimeOnboardingError("uptime-database-setup-outcome-unknown", true);
  }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new UptimeOnboardingError("uptime-database-setup-outcome-unknown", true); }
  if (response.status !== 200 || !result || typeof result !== "object"
    || Array.isArray(result) || (result as Reply).ok !== true) {
    throw new UptimeOnboardingError("uptime-database-setup-outcome-unknown", true);
  }
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await delay(2000);
    try {
      const after = await databaseInfo(origin);
      if (!after.needSetup && !after.runningSetup) return;
    } catch (error) {
      if (!(error instanceof UptimeOnboardingError)
        || error.code !== "uptime-database-info-unavailable") throw error;
    }
  }
  throw new UptimeOnboardingError("uptime-database-readiness-unknown", true);
}

function checkedInput(origin: string, username: string, password: string): void {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)
    || !/^[A-Za-z0-9._-]{1,32}$/.test(username)
    || !password || password.length > 512 || /[\r\n\u0000-\u001f\u007f]/.test(password)) {
    throw new UptimeOnboardingError("uptime-input-invalid");
  }
}

async function connected(origin: string): Promise<Socket> {
  const socket = io(origin, { autoConnect: false, reconnection: false, timeout: timeoutMs,
    transports: ["websocket"], forceNew: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new UptimeOnboardingError("uptime-info-timeout")), timeoutMs);
      const done = (error?: Error) => {
        clearTimeout(timer);
        socket.off("info", onInfo);
        socket.off("connect_error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onInfo = (value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)
          || typeof (value as Reply).serverTimezone !== "string"
          || typeof (value as Reply).serverTimezoneOffset !== "string"
          || !/^[+-]\d{2}:\d{2}$/.test((value as Reply).serverTimezoneOffset as string)) {
          done(new UptimeOnboardingError("uptime-info-invalid"));
          return;
        }
        done();
      };
      const onError = () => done(new UptimeOnboardingError("uptime-socket-unavailable"));
      socket.on("info", onInfo);
      socket.on("connect_error", onError);
      socket.connect();
    });
    return socket;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

async function ack(socket: Socket, event: string, args: unknown[], uncertain = false): Promise<unknown> {
  try {
    return await socket.timeout(timeoutMs).emitWithAck(event, ...args);
  } catch {
    throw new UptimeOnboardingError(`uptime-${event}-outcome-unknown`, uncertain);
  }
}

function reply(value: unknown, uncertain: boolean): Reply {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UptimeOnboardingError("uptime-response-invalid", uncertain);
  }
  return value as Reply;
}

export type UptimeMonitorSnapshot = {
  id: number;
  name: string;
  status: "up" | "down" | "pending";
  identity: string;
  lastBeatId: number | null;
};

export const uptimeSelfMonitorUrl = "http://127.0.0.1:3001/";
export const uptimeSelfMonitorVersion = "2.5.5";

export function uptimeSelfMonitorConfig(name: string) {
  return { type: "http", name, parent: null, url: uptimeSelfMonitorUrl,
    method: "GET", interval: 60, retryInterval: 60, maxretries: 0, active: true,
    notificationIDList: {}, accepted_statuscodes: ["200-299"],
    kafkaProducerBrokers: [], kafkaProducerSaslOptions: { mechanism: "None" },
    rabbitmqNodes: [], conditions: [] };
}

function monitorId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new UptimeOnboardingError("uptime-monitor-invalid");
  }
  return value;
}

function monitorConfig(value: unknown): Reply {
  const monitor = reply(value, false);
  monitorId(monitor.id);
  if (typeof monitor.name !== "string" || !monitor.name.trim() || monitor.name.length > 120
    || /[\p{C}\p{Zl}\p{Zp}]/u.test(monitor.name) || monitor.name.includes("://")
    || typeof monitor.type !== "string" || !/^[a-z][a-z0-9-]{0,40}$/.test(monitor.type)
    || typeof monitor.active !== "boolean") {
    throw new UptimeOnboardingError("uptime-monitor-invalid");
  }
  return monitor;
}

function targetSelector(monitor: Reply): unknown[] {
  if (monitor.type === "http") {
    if (typeof monitor.url !== "string" || monitor.url.length > 2048
      || /[\u0000-\u001f\u007f]/.test(monitor.url)
      || typeof monitor.method !== "string" || !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(monitor.method)) {
      throw new UptimeOnboardingError("uptime-monitor-target-invalid");
    }
    let target: URL;
    try { target = new URL(monitor.url); } catch { throw new UptimeOnboardingError("uptime-monitor-target-invalid"); }
    if (!["http:", "https:"].includes(target.protocol) || !target.hostname) {
      throw new UptimeOnboardingError("uptime-monitor-target-invalid");
    }
    return [target.href, monitor.method];
  }
  if (monitor.type === "ping" || monitor.type === "port") {
    if (typeof monitor.hostname !== "string" || !/^[A-Za-z0-9.:[\]_-]{1,253}$/.test(monitor.hostname)) {
      throw new UptimeOnboardingError("uptime-monitor-target-invalid");
    }
    if (monitor.type === "ping") return [monitor.hostname.toLowerCase()];
    if (typeof monitor.port !== "number" || !Number.isInteger(monitor.port)
      || monitor.port < 1 || monitor.port > 65535) {
      throw new UptimeOnboardingError("uptime-monitor-target-invalid");
    }
    return [monitor.hostname.toLowerCase(), monitor.port];
  }
  throw new UptimeOnboardingError("uptime-monitor-type-unsupported");
}

async function loggedIn(socket: Socket, username: string, password: string): Promise<string | null> {
  let version: string | null = null;
  const onInfo = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)
      && typeof (value as Reply).version === "string") {
      version = (value as Reply).version as string;
    }
  };
  socket.on("info", onInfo);
  try {
    const result = reply(await ack(socket, "login", [{ username, password, token: "" }]), false);
    if (result.tokenRequired === true) throw new UptimeOnboardingError("uptime-two-factor-needed");
    if (result.ok !== true || typeof result.token !== "string" || !result.token) {
      throw new UptimeOnboardingError("uptime-login-rejected");
    }
    return version;
  } finally {
    socket.off("info", onInfo);
  }
}

async function monitorStatus(socket: Socket, id: number, active: boolean): Promise<{
  status: UptimeMonitorSnapshot["status"];
  lastBeatId: number | null;
}> {
  const result = reply(await ack(socket, "getMonitorBeats", [id, 24]), false);
  if (result.ok !== true || !Array.isArray(result.data)) {
    throw new UptimeOnboardingError("uptime-monitor-beats-invalid");
  }
  let latest: number | undefined;
  let lastBeatId: number | null = null;
  for (const value of result.data) {
    const beat = reply(value, false);
    if (!Number.isInteger(beat.status) || ![0, 1, 2, 3].includes(beat.status as number)
      || typeof beat.id !== "number" || !Number.isSafeInteger(beat.id) || beat.id < 1
      || beat.monitor_id !== id) {
      throw new UptimeOnboardingError("uptime-monitor-beats-invalid");
    }
    if (lastBeatId === null || beat.id > lastBeatId) {
      latest = beat.status as number;
      lastBeatId = beat.id;
    }
  }
  if (!active || latest === 3) throw new UptimeOnboardingError("uptime-monitor-state-unsupported");
  if (latest === undefined || latest === 2) return { status: "pending", lastBeatId };
  if (latest === 1) return { status: "up", lastBeatId };
  return { status: "down", lastBeatId };
}

async function snapshot(socket: Socket, value: unknown, password: string): Promise<UptimeMonitorSnapshot> {
  const monitor = monitorConfig(value);
  const id = monitor.id as number;
  const name = monitor.name as string;
  const type = monitor.type as string;
  const active = monitor.active as boolean;
  const identity = createHmac("sha256", password)
    .update(JSON.stringify([id, name, type, active, targetSelector(monitor)])).digest("hex");
  return { id, name, identity, ...await monitorStatus(socket, id, active) };
}

async function monitorList(socket: Socket): Promise<Reply> {
  let list: unknown;
  const onList = (value: unknown) => { list = value; };
  socket.on("monitorList", onList);
  try {
    const result = reply(await ack(socket, "getMonitorList", []), false);
    if (result.ok !== true || !list || typeof list !== "object" || Array.isArray(list)) {
      throw new UptimeOnboardingError("uptime-monitor-list-invalid");
    }
  } finally {
    socket.off("monitorList", onList);
  }
  return list as Reply;
}

function namedSelfMonitor(list: Reply, name: string): Reply | null {
  let found: Reply | null = null;
  for (const [key, value] of Object.entries(list)) {
    const monitor = monitorConfig(value);
    if (String(monitor.id) !== key) throw new UptimeOnboardingError("uptime-monitor-list-invalid");
    if (monitor.name !== name) continue;
    if (found || monitor.type !== "http" || monitor.url !== uptimeSelfMonitorUrl
      || monitor.method !== "GET" || monitor.active !== true) {
      throw new UptimeOnboardingError("uptime-self-monitor-conflict");
    }
    found = monitor;
  }
  return found;
}

/** Inspect one deterministic local-only monitor; never return its target or session. */
export async function inspectUptimeSelfMonitor(origin: string, username: string, password: string,
  name: string): Promise<UptimeMonitorSnapshot | null> {
  checkedInput(origin, username, password);
  if (!name || name.length > 120 || /[\p{C}\p{Zl}\p{Zp}]/u.test(name)) {
    throw new UptimeOnboardingError("uptime-monitor-name-invalid");
  }
  const socket = await connected(origin);
  try {
    const version = await loggedIn(socket, username, password);
    if (version !== uptimeSelfMonitorVersion) {
      throw new UptimeOnboardingError("uptime-self-monitor-version-unsupported");
    }
    const monitor = namedSelfMonitor(await monitorList(socket), name);
    if (!monitor) return null;
    return await snapshot(socket, monitor, password);
  } finally {
    socket.disconnect();
  }
}

/** One approved create attempt. The caller persists attempted state before invoking this. */
export async function createUptimeSelfMonitor(origin: string, username: string, password: string,
  name: string, onBeforeWrite: () => Promise<void>): Promise<UptimeMonitorSnapshot> {
  checkedInput(origin, username, password);
  if (!name || name.length > 120 || /[\p{C}\p{Zl}\p{Zp}]/u.test(name)) {
    throw new UptimeOnboardingError("uptime-monitor-name-invalid");
  }
  const socket = await connected(origin);
  try {
    const version = await loggedIn(socket, username, password);
    if (version !== uptimeSelfMonitorVersion) {
      throw new UptimeOnboardingError("uptime-self-monitor-version-unsupported");
    }
    if (namedSelfMonitor(await monitorList(socket), name)) {
      throw new UptimeOnboardingError("uptime-self-monitor-conflict");
    }
    const config = uptimeSelfMonitorConfig(name);
    await onBeforeWrite();
    const result = reply(await ack(socket, "add", [config], true), true);
    if (result.ok !== true) throw new UptimeOnboardingError("uptime-monitor-create-rejected", true);
    let id: number;
    try { id = monitorId(result.monitorID); }
    catch { throw new UptimeOnboardingError("uptime-monitor-create-outcome-unknown", true); }
    const readback = reply(await ack(socket, "getMonitor", [id], true), true);
    if (readback.ok !== true) throw new UptimeOnboardingError("uptime-monitor-readback-unverified", true);
    const monitor = monitorConfig(readback.monitor);
    if (monitor.id !== id || monitor.name !== name || monitor.type !== "http"
      || monitor.url !== uptimeSelfMonitorUrl || monitor.method !== "GET"
      || monitor.active !== true) {
      throw new UptimeOnboardingError("uptime-monitor-readback-unverified", true);
    }
    try { return await snapshot(socket, monitor, password); }
    catch { throw new UptimeOnboardingError("uptime-monitor-readback-unverified", true); }
  } finally {
    socket.disconnect();
  }
}

/** Read an owner's monitor list without returning target URLs or monitor credentials. */
export async function listUptimeMonitors(origin: string, username: string, password: string): Promise<UptimeMonitorSnapshot[]> {
  checkedInput(origin, username, password);
  const socket = await connected(origin);
  try {
    await loggedIn(socket, username, password);
    const monitors = await monitorList(socket);
    const snapshots: UptimeMonitorSnapshot[] = [];
    for (const [key, value] of Object.entries(monitors)) {
      const monitor = monitorConfig(value);
      if (String(monitor.id) !== key) throw new UptimeOnboardingError("uptime-monitor-list-invalid");
      try {
        snapshots.push(await snapshot(socket, monitor, password));
      } catch (error) {
        if (error instanceof UptimeOnboardingError
          && ["uptime-monitor-state-unsupported", "uptime-monitor-type-unsupported"].includes(error.code)) continue;
        throw error;
      }
    }
    return snapshots;
  } finally {
    socket.disconnect();
  }
}

/** Read back one owner-visible monitor and its latest heartbeat state. */
export async function inspectUptimeMonitor(origin: string, username: string, password: string,
  id: number): Promise<UptimeMonitorSnapshot> {
  checkedInput(origin, username, password);
  monitorId(id);
  const socket = await connected(origin);
  try {
    await loggedIn(socket, username, password);
    const result = reply(await ack(socket, "getMonitor", [id]), false);
    if (result.ok !== true) throw new UptimeOnboardingError("uptime-monitor-read-invalid");
    const monitor = monitorConfig(result.monitor);
    if (monitor.id !== id) throw new UptimeOnboardingError("uptime-monitor-read-invalid");
    return await snapshot(socket, monitor, password);
  } finally {
    socket.disconnect();
  }
}

/** False means these credentials were refused, not that setup is safe to repeat. */
export async function verifyUptimeLogin(origin: string, username: string, password: string): Promise<boolean> {
  checkedInput(origin, username, password);
  const socket = await connected(origin);
  try {
    const result = reply(await ack(socket, "login", [{ username, password, token: "" }]), false);
    if (result.tokenRequired === true) throw new UptimeOnboardingError("uptime-two-factor-needed");
    if (result.ok === false && result.msg === "authIncorrectCreds") return false;
    if (result.ok !== true || typeof result.token !== "string" || !result.token) {
      throw new UptimeOnboardingError("uptime-login-rejected");
    }
    return true;
  } finally {
    socket.disconnect();
  }
}

/** Persist the attempted checkpoint immediately before emitting the one-time setup event. */
export async function createUptimeAdmin(origin: string, username: string, password: string,
  onBeforeWrite: () => Promise<void>): Promise<void> {
  checkedInput(origin, username, password);
  const socket = await connected(origin);
  try {
    const needSetup = await ack(socket, "needSetup", []);
    if (needSetup !== true) throw new UptimeOnboardingError("uptime-setup-not-needed");
    await onBeforeWrite();
    const result = reply(await ack(socket, "setup", [username, password], true), true);
    if (result.ok !== true) throw new UptimeOnboardingError("uptime-setup-rejected", true);
  } finally {
    socket.disconnect();
  }
}
