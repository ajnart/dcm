import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";
import type { AcceptanceContext } from "../../types/acceptance";
import { setupRecord, type SetupRecord } from "../../types/setup";

const SOURCE = "https://github.com/henrygd/beszel/blob/v0.20.0/internal/hub/collections.go";
const ID = /^[a-z0-9]{15}$/;
const MAX_AGE = 5 * 60 * 1000;
const HISTORY_FIELDS = "id,system,type,created,stats.cpu,stats.m,stats.mu,stats.mp,stats.d,stats.du,stats.dp";
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function id(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error("Beszel needs an exact existing 15-character opaque record ID");
  return value;
}
function recent(value: unknown): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("Beszel paired observation timestamp is invalid");
  }
  const age = Date.now() - Date.parse(value.replace(" ", "T"));
  if (!Number.isFinite(age) || age < -30_000 || age > MAX_AGE) throw new Error("Beszel paired stats are stale or future-dated");
}
function numeric(record: SetupRecord, keys: readonly string[]): void {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0
      || (["cpu", "mp", "dp"].includes(key) && value > 100)) {
      throw new Error("Beszel meaningful paired metrics are invalid");
    }
  }
}
async function read(context: AcceptanceContext, token: string, path: string, query: Record<string, string>): Promise<SetupRecord> {
  const response = await context.http.request({ method: "GET", path, query,
    headers: { Authorization: token, "Cache-Control": "no-cache" } });
  if (response.status !== 200) throw new Error("Beszel authorized read unavailable or denied");
  return setupRecord(await response.json(), "Beszel read");
}
async function history(context: AcceptanceContext, token: string, systemId: string, historyId?: string): Promise<SetupRecord> {
  let filter = `system='${systemId}' && type='1m'`;
  if (historyId) filter += ` && id='${id(historyId)}'`;
  const body = await read(context, token, "/api/collections/system_stats/records", {
    page: "1", perPage: "1", sort: "-created", filter, fields: HISTORY_FIELDS,
  });
  if (!Array.isArray(body.items) || body.items.length !== 1) throw new Error("Beszel selected system has no readable paired history record");
  const row = setupRecord(body.items[0], "Beszel paired history");
  if (row.system !== systemId || row.type !== "1m" || (historyId && row.id !== historyId)) {
    throw new Error("Beszel historical record belongs to a different system or interval");
  }
  id(row.id);
  const stats = setupRecord(row.stats, "Beszel paired metrics");
  numeric(stats, ["cpu", "m", "mu", "mp", "d", "du", "dp"]);
  if ((stats.m as number) <= 0 || (stats.d as number) <= 0
    || (stats.mu as number) > (stats.m as number) || (stats.du as number) > (stats.d as number)) {
    throw new Error("Beszel paired stats lack meaningful capacity measurements");
  }
  return { id: row.id, system: row.system, type: row.type, created: row.created,
    stats: { cpu: stats.cpu, m: stats.m, mu: stats.mu, mp: stats.mp, d: stats.d, du: stats.du, dp: stats.dp } };
}

export default createReadOnlyAcceptance({
  appId: "beszel", source: SOURCE, stage: "beszel-paired-system-read-acceptance", serviceIds: ["beszel"],
  cleanup: "not-required-existing-paired-system-read-only",
  authenticationRequests: [{ path: "/api/collections/users/auth-with-password", action: "beszel-acceptance-login" }],
  inputDefinitions: [{ key: "system-id", label: "Exact existing paired Beszel system ID" }],
  async observe(context, afterRestart) {
    const systemId = id(context.inputs?.["system-id"]);
    const status = setupRecord(await context.status(), "Beszel saved identity");
    if (status.username !== "admin@example.test" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("Beszel saved Hub identity or private password reference differs");
    }
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) throw new Error("Beszel saved Hub password is invalid");
    // Only this declared authentication POST is approval-gated by the transport.
    // No first-account route, token refresh, superuser login or enrollment is used.
    const login = await context.http.request({ method: "POST", path: "/api/collections/users/auth-with-password",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: status.username, password }),
      approval: { action: "beszel-acceptance-login", progress: "Authenticate the saved Beszel Hub user for selected-system read acceptance" } });
    if (login.status !== 200) throw new Error("Beszel saved Hub user authentication failed; no account creation or token refresh is authorized");
    const authenticated = setupRecord(await login.json(), "Beszel Hub authentication");
    const record = setupRecord(authenticated.record, "Beszel authenticated Hub user");
    const token = authenticated.token;
    if (typeof token !== "string" || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
      || record.collectionName !== "users" || record.email !== status.username || record.role !== "admin" || record.verified !== true) {
      throw new Error("Beszel authenticated saved Hub administrator is unproven");
    }
    const identityId = id(record.id);
    const identity = await read(context, token, `/api/collections/users/records/${identityId}`, { fields: "id,collectionName,email,role,verified" });
    if (identity.id !== identityId || identity.collectionName !== "users" || identity.email !== status.username
      || identity.role !== "admin" || identity.verified !== true) throw new Error("Beszel authenticated saved Hub administrator is unproven");
    const system = await read(context, token, `/api/collections/systems/records/${systemId}`, {
      fields: "id,name,host,port,users,status,updated,info.u,info.cpu,info.mp,info.dp",
    });
    if (system.id !== systemId || system.status !== "up" || !Array.isArray(system.users)
      || !system.users.includes(identityId) || system.users.some((value) => typeof value !== "string" || !ID.test(value))
      || [system.name, system.host, system.port].some((value) => typeof value !== "string" || value.length > 1024)
      || !system.name || !system.host) throw new Error("Beszel selected system is not an UP paired system owned by the saved user");
    recent(system.updated);
    const info = setupRecord(system.info, "Beszel system info");
    numeric(info, ["u", "cpu", "mp", "dp"]);
    if ((info.u as number) <= 0) throw new Error("Beszel selected system has no meaningful agent uptime");
    const saved = await context.checkpoint.read();
    let originalId: string | undefined;
    if (saved) {
      const baseline = setupRecord(JSON.parse(String(saved.data.baseline)), "Beszel original baseline");
      originalId = id(baseline.historyId);
    }
    const latest = await history(context, token, systemId);
    recent(latest.created);
    let original = latest;
    if (originalId) original = await history(context, token, systemId, originalId);
    return { baseline: { identityId, systemId, configHash: hash({ name: system.name, host: system.host,
      port: system.port, users: [...system.users].sort() }), historyId: original.id, historyHash: hash(original) },
      result: { appHealthObserved: true, authenticatedIdentityVerified: true, pairedSystemStatsReadVerified: true,
        historicalStatsVerified: afterRestart, agentEnrollmentVerified: false,
        workloadScope: "selected-existing-owned-paired-system-stats-history-read" } };
  },
});
