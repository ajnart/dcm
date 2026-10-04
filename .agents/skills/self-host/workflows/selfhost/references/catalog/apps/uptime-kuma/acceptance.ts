import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { AcceptanceAdapter, AcceptanceContext, AcceptanceRuntimeEvidence } from "../../types/acceptance";
import { appliedStatus, setupRecord, type SetupCheckpoint, type SetupRecord } from "../../types/setup";
import { PollingSocket } from "./setup";

const APP_ID = "uptime-kuma";
const STAGE = "uptime-kuma-monitor-acceptance";
const SOURCE = "https://github.com/louislam/uptime-kuma/blob/2.5.5/server/server.js";
const MAX_AGE_MS = 5 * 60 * 1000;
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function monitorId(context: AcceptanceContext): number {
  const input = context.inputs?.["monitor-id"];
  if (!input || !/^[1-9][0-9]{0,9}$/.test(input) || !Number.isSafeInteger(Number(input))
    || Object.keys(context.inputs ?? {}).join() !== "monitor-id") {
    throw new Error("Uptime Kuma acceptance needs one reviewed existing monitor-id");
  }
  return Number(input);
}
function evidence(context: AcceptanceContext, value: AcceptanceRuntimeEvidence, state: "running" | "stopped") {
  if (context.appId !== APP_ID || value.source !== "shared-selected-lifecycle" || value.appId !== APP_ID
    || value.projectRoot !== context.projectRoot || value.state !== state
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.ownerId)
    || !/^[a-f0-9]{64}$/.test(value.recipeSha256) || !/^[a-f0-9]{64}$/.test(value.manifestHash)
    || !/^[a-f0-9]{64}$/.test(value.epoch) || !/^[0-9a-f-]{36}$/.test(value.evidenceId)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !Array.isArray(value.units) || value.units.length !== 1
    || value.units[0]?.serviceId !== APP_ID || !/^sha256:[a-f0-9]{64}$/.test(value.units[0]?.imageId ?? "")) {
    throw new Error("Uptime Kuma acceptance requires exact selected lifecycle evidence");
  }
}
async function owner(context: AcceptanceContext): Promise<SetupCheckpoint | null> {
  const status = appliedStatus(context, await context.status());
  if (status.ownerKind !== "shared" || status.username !== "admin"
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Uptime Kuma acceptance needs the exact saved administrator identity");
  }
  const saved = await context.checkpoint.read();
  if (saved && (saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot || saved.stage !== STAGE
    || saved.attemptedActions.length !== 0 || saved.data.monitorId !== monitorId(context))) {
    throw new Error("Uptime Kuma checkpoint owner or selected monitor differs");
  }
  return saved;
}
async function ready(context: AcceptanceContext, afterRestart: boolean): Promise<void> {
  let attempts = 1;
  if (afterRestart) attempts = 30;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try {
      response = await context.http.request({ method: "GET", path: "/setup-database-info", timeoutMs: 1_000 });
    } catch {
      // Retry only this database readiness read; never retry an authentication failure.
    }
    if (response) {
      if (response.status === 200) {
        const info = setupRecord(await response.json(), "Uptime Kuma database readiness");
        if (info.needSetup !== false || info.runningSetup !== false) {
          throw new Error("Uptime Kuma database setup is incomplete");
        }
        return;
      }
      if (![502, 503, 504].includes(response.status)) throw new Error("Uptime Kuma readiness was denied");
    }
    if (attempt + 1 < attempts) await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Uptime Kuma database did not become ready within bounded reads");
}
function heartbeat(value: unknown, id: number): { id: number; sha256: string; time: number; status: number } {
  const item = setupRecord(value, "Uptime Kuma selected heartbeat");
  // getMonitorBeats returns raw database rows (monitor_id), not the pushed monitorID envelope.
  if (!Number.isSafeInteger(item.id) || Number(item.id) < 1 || item.monitor_id !== id
    || ![0, 1, 2, 3].includes(Number(item.status)) || typeof item.status !== "number"
    || typeof item.time !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(item.time)
    || (item.ping !== null && (typeof item.ping !== "number" || !Number.isFinite(item.ping) || item.ping < 0))) {
    throw new Error("Uptime Kuma selected heartbeat shape differs");
  }
  const time = Date.parse(item.time.replace(" ", "T") + "Z");
  if (!Number.isFinite(time)) throw new Error("Uptime Kuma heartbeat time is invalid");
  // Never hash/store message, response body, target URL, or embedded monitor credentials.
  return { id: Number(item.id), time, status: item.status,
    sha256: hash({ id: item.id, monitorId: id, status: item.status, time: item.time, ping: item.ping }) };
}
async function readMonitor(context: AcceptanceContext, saved: SetupCheckpoint | null, afterRestart = false) {
  await ready(context, afterRestart);
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) {
    throw new Error("Uptime Kuma saved administrator password is invalid");
  }
  const socket = new PollingSocket(context);
  await socket.connect();
  const login = setupRecord(await socket.event("login", [{ username: "admin", password }]), "Uptime Kuma login");
  if (login.ok !== true || typeof login.token !== "string" || login.token.length < 1 || login.tokenRequired === true) {
    throw new Error("Uptime Kuma live saved administrator login was not verified");
  }
  const id = monitorId(context);
  // First assert the selected monitor belongs to this authenticated owner. The upstream
  // getMonitorBeats handler itself checks login only, not monitor ownership.
  const found = setupRecord(await socket.event("getMonitor", [id]), "Uptime Kuma selected monitor result");
  if (found.ok !== true) throw new Error("Uptime Kuma selected existing owner monitor is unavailable");
  const monitor = setupRecord(found.monitor, "Uptime Kuma selected monitor");
  if (monitor.id !== id || monitor.active !== true || monitor.forceInactive !== false || monitor.maintenance !== false
    || typeof monitor.type !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(monitor.type)
    || !Number.isSafeInteger(monitor.interval) || Number(monitor.interval) < 1
    || typeof monitor.timeout !== "number" || !Number.isFinite(monitor.timeout) || monitor.timeout <= 0) {
    throw new Error("Uptime Kuma acceptance needs a selected active non-maintenance monitor");
  }
  const configSha256 = hash({ id, type: monitor.type, active: monitor.active,
    forceInactive: monitor.forceInactive, interval: monitor.interval, timeout: monitor.timeout });
  if (saved && saved.data.configSha256 !== configSha256) throw new Error("Uptime Kuma selected operating configuration changed");
  const beats = setupRecord(await socket.event("getMonitorBeats", [id, 24]), "Uptime Kuma selected history");
  if (beats.ok !== true || !Array.isArray(beats.data) || beats.data.length < 1 || beats.data.length > 4096) {
    throw new Error("Uptime Kuma selected monitor has no bounded non-empty history");
  }
  const history = beats.data.map((value) => heartbeat(value, id));
  if (new Set(history.map((item) => item.id)).size !== history.length
    || history.some((item, index) => index > 0 && history[index - 1]!.time > item.time)) {
    throw new Error("Uptime Kuma heartbeat history is duplicated or unordered");
  }
  const latest = history[history.length - 1]!;
  const age = Date.now() - latest.time;
  if (latest.status !== 1 || age < 0 || age > MAX_AGE_MS) {
    throw new Error("Uptime Kuma selected monitor has no recent UP heartbeat");
  }
  if (saved) {
    const original = history.find((item) => item.id === saved.data.heartbeatId);
    if (!original || original.sha256 !== saved.data.heartbeatSha256) {
      throw new Error("Uptime Kuma historical heartbeat did not persist; do not replace the baseline");
    }
  }
  return { configSha256, heartbeatId: latest.id, heartbeatSha256: latest.sha256 };
}
function sameLineage(saved: SetupCheckpoint, receipt: AcceptanceRuntimeEvidence) {
  if (saved.data.ownerId !== receipt.ownerId || saved.data.recipeSha256 !== receipt.recipeSha256
    || saved.data.manifestHash !== receipt.manifestHash || saved.data.units !== JSON.stringify(receipt.units)) {
    throw new Error("Uptime Kuma restart owner or immutable image lineage differs");
  }
}
function result(context: AcceptanceContext, persistence: boolean): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, appHealthObserved: true,
    authenticatedIdentityVerified: true, monitorStatusReadVerified: true, historicalHeartbeatVerified: persistence,
    restartPersistenceVerified: persistence, workloadScope: "selected-existing-active-monitor-up-heartbeat-read",
    monitorCreationVerified: false, notificationDeliveryVerified: false,
    cleanup: "not-required-existing-monitor-read-only", source: SOURCE };
}
const adapter: AcceptanceAdapter = {
  appId: APP_ID, source: SOURCE,
  inputDefinitions: [{ key: "monitor-id", label: "Existing authorized active monitor ID with a recent UP heartbeat" }],
  async begin(context, running) {
    evidence(context, running, "running");
    const saved = await owner(context);
    if (saved) {
      sameLineage(saved, running);
      if (saved.data.epoch !== running.epoch || saved.data.sequence !== running.sequence
        || saved.data.evidenceId !== running.evidenceId) throw new Error("Uptime Kuma baseline epoch differs");
    }
    const observed = await readMonitor(context, saved);
    if (!saved) await context.checkpoint.compareAndSet({ expectedRevision: null, stage: STAGE,
      data: { monitorId: monitorId(context), ...observed, ownerId: running.ownerId,
        recipeSha256: running.recipeSha256, manifestHash: running.manifestHash, units: JSON.stringify(running.units),
        epoch: running.epoch, sequence: running.sequence, evidenceId: running.evidenceId, persistenceVerified: false } });
    return result(context, false);
  },
  async finish(context, restart) {
    evidence(context, restart.stopped, "stopped"); evidence(context, restart.running, "running");
    const saved = await owner(context);
    if (!saved || !/^[a-f0-9]{64}$/.test(String(saved.data.configSha256))
      || !/^[a-f0-9]{64}$/.test(String(saved.data.heartbeatSha256)) || !Number.isSafeInteger(saved.data.heartbeatId)) {
      throw new Error("Uptime Kuma acceptance has no verified pre-restart monitor/history baseline");
    }
    sameLineage(saved, restart.stopped); sameLineage(saved, restart.running);
    if (typeof saved.data.sequence !== "number" || restart.stopped.sequence <= saved.data.sequence
      || restart.running.sequence <= restart.stopped.sequence || restart.stopped.epoch !== saved.data.epoch
      || restart.running.epoch === saved.data.epoch
      || new Set([saved.data.evidenceId, restart.stopped.evidenceId, restart.running.evidenceId]).size !== 3) {
      throw new Error("Uptime Kuma persistence needs an actual recorded stop and distinct restart epoch");
    }
    await readMonitor(context, saved, true);
    await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: STAGE,
      data: { ...saved.data, persistenceVerified: true, restartEpoch: restart.running.epoch,
        stoppedEvidenceId: restart.stopped.evidenceId, restartEvidenceId: restart.running.evidenceId } });
    return result(context, true);
  },
};
export default adapter;
