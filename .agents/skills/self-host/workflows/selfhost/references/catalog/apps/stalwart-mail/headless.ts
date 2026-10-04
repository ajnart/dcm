import { randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SetupJmapRequest } from "../../types/setup.ts";

/** Callable only by a staged owner adapter. Not a discoverable shared setup.ts or installable recipe. */
export const readinessPrerequisites = [
  "Exact reviewed Compose owner, pinned v0.16.24 image, fresh config.json absence and owned RocksDB/log paths",
  "Approved bootstrap/recovery start with the saved private recovery env file; no published mail ports",
  "Existing approved canonical hostname-bound HTTPS route with certificate validation and no redirects",
  "Private owner-bound request transport, durable compare-and-set journal, and scoped recovery-removal/restart facility",
] as const;

export type StalwartIntent = { hostname: string; domain: string; httpsOrigin: string; dataPath: string; logPath: string };
export type StalwartPhase = "fresh" | "bootstrap-attempted" | "captured" | "cleanup-attempted" | "ready";
export type StalwartJournal = { intent: StalwartIntent; phase: StalwartPhase };
export type StalwartContext = {
  privateDirectory: string;
  registerSecret(value: string): void;
  /** Revalidate owner/image, path ownership, endpoint bindings and private file metadata on every invocation. */
  inspectPrerequisites(intent: StalwartIntent): Promise<void>;
  journal: { read(): Promise<StalwartJournal | null>; save(next: StalwartJournal): Promise<void> };
  /** Bounded response; suppress payloads/errors, reject redirects, authenticate only on the fixed saved origin.
   * POST /api /get calls are read-only; /set requires exact approval. Call beforeSend after approval,
   * before request bytes. This contract is intentionally not the existing loopback-only HTTP transport. */
  request(input: SetupJmapRequest): Promise<{ status: number; json: unknown }>;
  /** Approved, checkpointed start; assert config.json absent, consume saved env, do not print logs. */
  startFreshRecovery(input: { envFile: string; configMustBeAbsent: true }): Promise<void>;
  /** Bootstrap writes config.json itself. Wait for that exact owner to serve recovery management again. */
  waitForRecovery(): Promise<void>;
  /** Exact separately approved lifecycle: remove BOTH recovery variables from running and saved env,
   * restart only this owned app, and inspect their absence. Preserve the captured credential file. */
  removeRecoveryAndRestart(beforeSend: () => Promise<void>): Promise<void>;
};

export type StalwartApiKeyJournal = { intent: StalwartIntent; phase: "attempted" | "captured" | "ready" };
export type StalwartApiKeyContext = StalwartContext & {
  /** Separate durable compare-and-set journal; share the bootstrap owner's exclusive setup lease. */
  apiKeyJournal: { read(): Promise<StalwartApiKeyJournal | null>; save(next: StalwartApiKeyJournal): Promise<void> };
};
export type StalwartVerificationContext = Pick<StalwartContext, "request" | "registerSecret">;

function fail(message: string): never { throw new Error(`Stalwart ${message}`); }
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("returned an invalid private resource");
  return value as Record<string, any>;
}
function validateIntent(intent: StalwartIntent): void {
  const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (!domain.test(intent.hostname) || !domain.test(intent.domain)) fail("requires canonical explicit hostname and domain");
  let origin: URL;
  try { origin = new URL(intent.httpsOrigin); } catch { fail("requires a canonical HTTPS origin"); }
  if (origin.protocol !== "https:" || origin.hostname !== intent.hostname || origin.origin !== intent.httpsOrigin
    || origin.username || origin.password) fail("HTTPS origin does not match the selected hostname");
  for (const path of [intent.dataPath, intent.logPath]) {
    if (!/^\/[a-zA-Z0-9_./-]+\/$/.test(path) || path.includes("..") || path.includes("//") || path === "/") {
      fail("requires exact owned storage and log directory paths");
    }
  }
}
function privateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
    || (metadata.mode & 0o7777) !== 0o700 || realpathSync(path) !== path) fail("private directory is not owner-only");
}
function readPrivate(directory: string, name: string): string | null {
  privateDirectory(directory);
  const path = join(directory, name);
  let metadata;
  try { metadata = lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail("saved credential metadata is unavailable");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.()
    || (metadata.mode & 0o7777) !== 0o600 || metadata.size < 1 || metadata.size > 4096) fail("saved credential is not private");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.nlink !== 1
      || opened.uid !== process.getuid?.() || (opened.mode & 0o7777) !== 0o600
      || opened.size !== metadata.size || realpathSync(path) !== path) fail("saved credential changed during inspection");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}
/** Synchronous capture: fsync payload AND parent directory before any await, request or checkpoint. */
function capture(directory: string, name: string, payload: string): string {
  privateDirectory(directory);
  const path = join(directory, name);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, payload); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
  return path;
}
function basic(context: StalwartVerificationContext, username: string, secret: string): string {
  context.registerSecret(secret);
  const header = `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`;
  context.registerSecret(header);
  return header;
}
async function jmap(context: StalwartVerificationContext, endpoint: "recovery" | "https", intent: StalwartIntent,
  authorization: string, method: string, args: object, beforeSend?: () => Promise<void>): Promise<Record<string, any>> {
  let effect: "read" | "write" = "read";
  if (method.endsWith("/set")) effect = "write";
  const response = await context.request({ endpoint, origin: intent.httpsOrigin, path: "/api", authorization, effect,
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"], methodCalls: [[method, args, "c1"]] }), beforeSend });
  if (response.status !== 200) fail("private authentication or JMAP request failed");
  const calls = record(response.json).methodResponses;
  if (!Array.isArray(calls) || calls.length !== 1 || !Array.isArray(calls[0])
    || calls[0][0] !== method || calls[0][2] !== "c1") fail("JMAP response did not match the requested method");
  return record(calls[0][1]);
}
function list(value: Record<string, any>): Record<string, any>[] {
  if (!Array.isArray(value.list) || (value.notFound?.length ?? 0) !== 0) fail("readback is incomplete");
  return value.list.map(record);
}
export async function verifyStalwartAdministration(context: StalwartVerificationContext, endpoint: "recovery" | "https", intent: StalwartIntent, secret: string): Promise<void> {
  validateIntent(intent);
  const denied = await context.request({ endpoint, origin: intent.httpsOrigin, path: "/api",
    authorization: basic(context, `admin@${intent.domain}`, `${secret}-invalid`), effect: "read",
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: [["x:SystemSettings/get", { ids: ["singleton"] }, "c1"]] }) });
  if (denied.status !== 401) fail("wrong-password authentication was not rejected");
  const auth = basic(context, `admin@${intent.domain}`, secret);
  const settings = list(await jmap(context, endpoint, intent, auth, "x:SystemSettings/get", { ids: ["singleton"] }));
  if (settings.length !== 1 || settings[0]!.defaultHostname !== intent.hostname
    || typeof settings[0]!.defaultDomainId !== "string") fail("server identity does not match the reviewed intent");
  const domainId = settings[0]!.defaultDomainId;
  const domains = list(await jmap(context, endpoint, intent, auth, "x:Domain/get", { ids: [domainId] }));
  if (domains.length !== 1 || domains[0]!.id !== domainId || domains[0]!.name !== intent.domain
    || domains[0]!.isEnabled !== true) fail("domain readback does not match");
  const accounts = list(await jmap(context, endpoint, intent, auth, "x:Account/get", {
    ids: null, properties: ["id", "@type", "name", "emailAddress", "domainId", "roles"] }));
  const admin = accounts.filter((account) => account.name === "admin" && account.domainId === domainId);
  if (admin.length !== 1 || typeof admin[0]!.id !== "string" || admin[0]!["@type"] !== "User" || admin[0]!.roles?.["@type"] !== "Admin"
    || admin[0]!.emailAddress !== `admin@${intent.domain}`) fail("permanent administrator identity or role is unproven");
  // Recovery suppresses listeners, but removing it activates the saved listener policy.
  // Unpublished Docker ports do not prevent access from peers on the same network.
  const listeners = list(await jmap(context, endpoint, intent, auth, "x:NetworkListener/get", {
    ids: null, properties: ["id", "name", "protocol", "bind"] }));
  const ids = new Set<string>();
  if (listeners.length === 0) fail("management-only listener policy is unproven");
  for (const listener of listeners) {
    if (typeof listener.id !== "string" || !listener.id || ids.has(listener.id)
      || typeof listener.name !== "string" || !listener.name || listener.protocol !== "http"
      || Object.keys(record(listener.bind)).length === 0
      || Object.values(listener.bind).some((enabled) => enabled !== true)) {
      fail("management-only listener policy is unproven; reconcile native mail listeners before recovery removal");
    }
    ids.add(listener.id);
  }
}

/** Reused by the staged bootstrap owner and the consumed shared closure route.
 * Requires canonical HTTPS administration/listener proof and actual rejection of the saved old login. */
export async function verifyStalwartRecoveryClosure(context: StalwartVerificationContext, intent: StalwartIntent,
  secret: string, recovery: { username: string; password: string }): Promise<void> {
  validateIntent(intent);
  await verifyStalwartAdministration(context, "https", intent, secret);
  const rejected = await context.request({ endpoint: "https", origin: intent.httpsOrigin, path: "/api",
    authorization: basic(context, recovery.username, recovery.password), effect: "read",
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
      methodCalls: [["x:SystemSettings/get", { ids: ["singleton"] }, "c1"]] }) });
  if (rejected.status !== 401) fail("temporary recovery authentication was not rejected");
}

/** Narrow account/configuration setup only. No DNS, ACME, mail ports, sending or delivery acceptance. */
export async function bootstrapStalwart(context: StalwartContext, intent: StalwartIntent): Promise<object> {
  validateIntent(intent);
  await context.inspectPrerequisites(intent);
  const journal = await context.journal.read();
  if (journal && JSON.stringify(journal.intent) !== JSON.stringify(intent)) fail("saved setup intent changed");
  let phase: StalwartPhase = journal?.phase ?? "fresh";
  if (!["fresh", "bootstrap-attempted", "captured", "cleanup-attempted", "ready"].includes(phase)) fail("saved setup phase is invalid");
  const save = async (next: StalwartPhase) => {
    await context.journal.save({ intent, phase: next });
    phase = next;
  };
  let secret = readPrivate(context.privateDirectory, "permanent-admin-password");
  if (secret) context.registerSecret(secret);
  let recoveryPassword = readPrivate(context.privateDirectory, "recovery-password");
  if (recoveryPassword) context.registerSecret(recoveryPassword);
  if (recoveryPassword && !/^[0-9a-f]{64}$/.test(recoveryPassword)) fail("saved recovery credential is invalid");
  if (secret && phase === "fresh") fail("saved administrator has no bootstrap attempt ownership");
  if (secret && !recoveryPassword) fail("saved recovery credential is required to prove rejection");
  if (!secret && phase !== "fresh") fail("bootstrap outcome is unresolved; never replay credential creation");
  if (!secret) {
    if (!recoveryPassword) {
      recoveryPassword = randomBytes(32).toString("hex");
      context.registerSecret(recoveryPassword);
      capture(context.privateDirectory, "recovery-password", recoveryPassword);
    }
    let recovery = readPrivate(context.privateDirectory, "recovery.env");
    const expectedRecovery = `STALWART_RECOVERY_MODE=1\nSTALWART_RECOVERY_ADMIN=recovery:${recoveryPassword}\n`;
    if (!recovery) {
      recovery = expectedRecovery;
      context.registerSecret(recovery);
      capture(context.privateDirectory, "recovery.env", recovery);
    }
    if (recovery !== expectedRecovery || !/^[0-9a-f]{64}$/.test(recoveryPassword)) fail("saved recovery environment is invalid");
    await save("fresh");
    await context.startFreshRecovery({ envFile: join(context.privateDirectory, "recovery.env"), configMustBeAbsent: true });
    const auth = basic(context, "recovery", recoveryPassword);
    const fresh = list(await jmap(context, "recovery", intent, auth, "x:Bootstrap/get", { ids: ["singleton"] }));
    if (fresh.length !== 1 || fresh[0]!.id !== "singleton") fail("fresh bootstrap object was not proven");
    const result = await jmap(context, "recovery", intent, auth, "x:Bootstrap/set", { update: { singleton: {
      serverHostname: intent.hostname, defaultDomain: intent.domain, requestTlsCertificate: false, generateDkimKeys: false,
      dataStore: { "@type": "RocksDb", path: intent.dataPath }, blobStore: { "@type": "Default" },
      searchStore: { "@type": "Default" }, inMemoryStore: { "@type": "Default" }, directory: { "@type": "Internal" },
      tracer: { "@type": "Log", path: intent.logPath, prefix: "stalwart", enable: true, ansi: false }, dnsServer: { "@type": "Manual" },
    } } }, () => save("bootstrap-attempted"));
    const returned = record(record(result.updated).singleton);
    if (typeof returned.secret === "string") context.registerSecret(returned.secret);
    if (returned.username !== `admin@${intent.domain}` || !/^[A-Za-z0-9]{16}$/.test(returned.secret)
      || Object.keys(result.notUpdated ?? {}).length !== 0) fail("bootstrap returned no exact permanent administrator");
    capture(context.privateDirectory, "permanent-admin-password", returned.secret);
    secret = returned.secret;
    await save("captured");
    await context.waitForRecovery();
  }
  if (!/^[A-Za-z0-9]{16}$/.test(secret)) fail("saved permanent administrator password is invalid");
  if (phase !== "cleanup-attempted" && phase !== "ready") {
    await verifyStalwartAdministration(context, "recovery", intent, secret);
    await verifyStalwartAdministration(context, "https", intent, secret);
    await context.removeRecoveryAndRestart(() => save("cleanup-attempted"));
  }
  if (recoveryPassword) {
    if (!/^[0-9a-f]{64}$/.test(recoveryPassword)) fail("saved recovery credential is invalid");
    await verifyStalwartRecoveryClosure(context, intent, secret, { username: "recovery", password: recoveryPassword });
  } else fail("saved recovery credential is required to prove rejection");
  await save("ready");
  return { appId: "stalwart-mail", status: "administrator-verified", username: `admin@${intent.domain}`,
    passwordFile: join(context.privateDirectory, "permanent-admin-password"), httpsOrigin: intent.httpsOrigin,
    recoveryRemoved: true, mailDelivery: "not-verified", dns: "not-changed", tls: "existing-owner-route" };
}

/** Create one management credential only after permanent-admin proof and recovery closure.
 * The permanent password and API key are distinct once-returned credentials. */
export async function createStalwartApiKey(context: StalwartApiKeyContext, intent: StalwartIntent): Promise<object> {
  await bootstrapStalwart(context, intent);
  const journal = await context.apiKeyJournal.read();
  if (journal && (JSON.stringify(journal.intent) !== JSON.stringify(intent)
    || !["attempted", "captured", "ready"].includes(journal.phase))) fail("API-key journal differs from its owner intent");
  let saved = readPrivate(context.privateDirectory, "management-api-key.json");
  if (saved && !journal) fail("saved API key has no owned creation attempt");
  if (!saved && journal) fail("API-key outcome is unresolved; never replay credential creation");
  if (!saved) {
    const password = readPrivate(context.privateDirectory, "permanent-admin-password");
    if (!password) fail("permanent administrator password is unavailable");
    const auth = basic(context, `admin@${intent.domain}`, password);
    const existing = list(await jmap(context, "https", intent, auth, "x:ApiKey/get", {
      ids: null, properties: ["id", "description"] }));
    if (existing.length !== 0) fail("pre-existing administrator API keys require ownership reconciliation");
    const created = await jmap(context, "https", intent, auth, "x:ApiKey/set", { create: { selfhost: {
      description: "selfhost shared-owner management", allowedIps: {}, permissions: { "@type": "Inherit" },
    } } }, () => context.apiKeyJournal.save({ intent, phase: "attempted" }));
    const credential = record(record(created.created).selfhost);
    if (typeof credential.secret === "string") context.registerSecret(credential.secret);
    if (typeof credential.id !== "string" || !credential.id || credential.id.length > 128
      || !/^API_[A-Za-z0-9_-]{38}$/.test(credential.secret)
      || Object.keys(created.notCreated ?? {}).length !== 0) fail("API-key creation returned no exact private credential");
    saved = JSON.stringify({ id: credential.id, secret: credential.secret });
    context.registerSecret(saved);
    capture(context.privateDirectory, "management-api-key.json", saved);
    await context.apiKeyJournal.save({ intent, phase: "captured" });
  }
  context.registerSecret(saved);
  let credential: Record<string, any>;
  try { credential = record(JSON.parse(saved)); } catch { fail("saved API key is invalid"); }
  if (Object.keys(credential).sort().join(",") !== "id,secret" || typeof credential.id !== "string"
    || !credential.id || credential.id.length > 128 || !/^API_[A-Za-z0-9_-]{38}$/.test(credential.secret)) {
    fail("saved API key has an invalid pinned format");
  }
  context.registerSecret(credential.secret);
  const auth = `Bearer ${credential.secret}`;
  context.registerSecret(auth);
  const keys = list(await jmap(context, "https", intent, auth, "x:ApiKey/get", {
    ids: [credential.id], properties: ["id", "description", "permissions", "allowedIps"] }));
  if (keys.length !== 1 || keys[0]!.id !== credential.id
    || keys[0]!.description !== "selfhost shared-owner management"
    || keys[0]!.permissions?.["@type"] !== "Inherit"
    || Object.keys(record(keys[0]!.allowedIps)).length !== 0) fail("saved API-key identity or scope is unproven");
  await context.apiKeyJournal.save({ intent, phase: "ready" });
  return { appId: "stalwart-mail", status: "management-api-key-verified", username: `admin@${intent.domain}`,
    passwordFile: join(context.privateDirectory, "permanent-admin-password"),
    apiKeyFile: join(context.privateDirectory, "management-api-key.json"), apiKeyId: credential.id,
    httpsOrigin: intent.httpsOrigin, recoveryRemoved: true, mailDelivery: "not-verified" };
}
