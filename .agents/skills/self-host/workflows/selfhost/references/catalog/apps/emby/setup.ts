import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupCheckpoint,
  type SetupContext, type SetupInspectionContext, type SetupRecord } from "../../types/setup";

// Post-manual-bootstrap only. BOOTSTRAP.md records the missing fresh-owner gate.
const APP = "emby";
const CREATE = "emby-create-api-key";
const STAGES = ["manual-owner-verified", "key-create-attempted", "key-saved"];
type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "http" | "secrets" | "checkpoint">;
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function label(root: string): string { return `Auto-Stack Emby ${digest(root).slice(0, 16)}`; }
function token(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 8192
    && !/[\s\u0000-\u001f\u007f,\"]/.test(value);
}
function identity(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value);
}
function exact(context: ReadContext, value: unknown): SetupRecord {
  if (context.appId !== APP || !isAbsolute(context.projectRoot)) throw new Error("Emby setup requires the exact app project");
  const status = appliedStatus(context, value);
  if (typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)) throw new Error("Emby private-file owner is unavailable");
  return status;
}
async function read(context: ReadContext, path: string, key?: string): Promise<SetupRecord> {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers["X-Emby-Token"] = key;
  const response = await context.http.request({ method: "GET", path, headers });
  if (response.status !== 200 || !response.ok) throw new Error("Emby authenticated readback failed; inspect before continuing");
  return setupRecord(await response.json(), "Emby readback");
}
async function server(context: ReadContext, key?: string): Promise<string> {
  let path = "/System/Info/Public";
  if (key !== undefined) path = "/System/Info";
  const info = await read(context, path, key);
  if (info.Version !== "4.10.0.40" || !identity(info.Id)) throw new Error("Emby setup requires the pinned 4.10.0.40 server identity");
  return info.Id;
}
function admin(value: unknown, serverId: string, ownerId?: string): string {
  const user = setupRecord(value, "Emby administrator");
  const policy = setupRecord(user.Policy, "Emby administrator policy");
  if (user.Name !== "admin" || user.ServerId !== serverId || !identity(user.Id)
    || policy.IsAdministrator !== true || policy.IsDisabled !== false
    || user.HasConfiguredPassword !== true || (ownerId !== undefined && user.Id !== ownerId)) {
    throw new Error("Emby account is not the exact enabled, password-configured administrator");
  }
  return user.Id;
}
async function owner(context: ReadContext, key: string, serverId: string, ownerId: string): Promise<void> {
  admin(await read(context, `/Users/${ownerId}`, key), serverId, ownerId);
  if ((await read(context, "/System/Configuration", key)).IsStartupWizardCompleted !== true) {
    throw new Error("Emby first-owner wizard must be completed manually with the saved admin password; automatic startup writes are not proven safe");
  }
}
async function session(context: SetupContext, password: string, serverId: string): Promise<{ key: string; ownerId: string }> {
  const cookies = await context.secrets.readSessionCookies();
  if (Object.keys(cookies).length > 0) {
    if (Object.keys(cookies).some((name) => !["bearer", "owner_id", "password_digest", "server_id"].includes(name))
      || !token(cookies.bearer) || !identity(cookies.owner_id)
      || cookies.password_digest !== digest(password) || cookies.server_id !== serverId) {
      throw new Error("Emby private session differs from the saved owner credential");
    }
    const response = await context.http.request({ method: "GET", path: `/Users/${cookies.owner_id}`,
      headers: { "X-Emby-Token": cookies.bearer } });
    if (response.status === 401) {
      await context.secrets.writeSessionCookies({});
      throw new Error("Emby setup session expired; approve a new login on the next run");
    }
    if (response.status !== 200 || !response.ok) throw new Error("Emby setup-session owner readback failed");
    admin(await response.json(), serverId, cookies.owner_id);
  }
  const response = await context.http.request({ method: "POST", path: "/Users/AuthenticateByName",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Emby-Authorization": `Emby Client="Auto-Stack", Device="Selfhost Setup", DeviceId="auto-stack-${digest(context.projectRoot).slice(0, 24)}", Version="1.0.0"` },
    body: new URLSearchParams({ Username: "admin", Pw: password }).toString(),
    approval: { action: "emby-verify-manual-admin", progress: "Verify the manually established Emby administrator using the saved password" },
  });
  if (response.status !== 200 || !response.ok) throw new Error("Emby first owner remains manual: complete the wizard with admin and the saved password; no startup writes were sent");
  const result = setupRecord(await response.json(), "Emby login");
  const ownerId = admin(result.User, serverId, cookies.owner_id);
  if (!token(result.AccessToken) || result.ServerId !== serverId) throw new Error("Emby login token or server identity is invalid");
  const freshOwner = await context.http.request({ method: "GET", path: `/Users/${ownerId}`,
    headers: { "X-Emby-Token": result.AccessToken } });
  if (freshOwner.status !== 200 || !freshOwner.ok) throw new Error("Emby fresh-session owner readback failed");
  admin(await freshOwner.json(), serverId, ownerId);
  if (cookies.bearer) return { key: cookies.bearer, ownerId: cookies.owner_id };
  await context.secrets.writeSessionCookies({ bearer: result.AccessToken, owner_id: ownerId,
    password_digest: digest(password), server_id: serverId });
  return { key: result.AccessToken, ownerId };
}
function checkpoint(context: ReadContext, saved: SetupCheckpoint | null): SetupCheckpoint | null {
  if (saved === null) return null;
  if (saved.schemaVersion !== 1 || saved.appId !== APP || saved.projectRoot !== context.projectRoot
    || !Number.isSafeInteger(saved.revision) || saved.revision < 1 || !STAGES.includes(saved.stage)
    || !identity(saved.data.serverId) || !identity(saved.data.ownerId)
    || saved.data.keyLabel !== label(context.projectRoot)
    || typeof saved.data.passwordDigest !== "string" || !/^[a-f0-9]{64}$/.test(saved.data.passwordDigest)
    || !Array.isArray(saved.attemptedActions) || saved.attemptedActions.some((action) => action !== CREATE)
    || saved.attemptedActions.length > 1
    || (saved.stage === "manual-owner-verified" && saved.attemptedActions.length !== 0)
    || (saved.stage !== "manual-owner-verified" && !saved.attemptedActions.includes(CREATE))) {
    throw new Error("Emby setup checkpoint does not match this post-manual-bootstrap owner");
  }
  return saved;
}
async function inventory(context: ReadContext, key: string): Promise<string[]> {
  const result = await read(context, "/Auth/Keys", key);
  // Fail closed if the result is truncated; never infer absence from one page.
  if (!Array.isArray(result.Items) || !Number.isSafeInteger(result.TotalRecordCount)
    || result.TotalRecordCount !== result.Items.length) throw new Error("Emby API-key inventory is incomplete");
  const matches: string[] = [];
  for (const value of result.Items) {
    const entry = setupRecord(value, "Emby API-key entry");
    if (entry.AppName === label(context.projectRoot)) {
      if (!token(entry.AccessToken) || entry.IsActive !== true) throw new Error("Emby labeled API key is invalid or inactive");
      matches.push(entry.AccessToken);
    }
  }
  if (matches.length > 1) throw new Error("Emby has duplicate project-labeled API keys; inspect manually");
  return matches;
}
async function save(context: SetupContext, saved: SetupCheckpoint | null, stage: string,
  data: SetupCheckpoint["data"]): Promise<SetupCheckpoint> {
  const next = checkpoint(context, await context.checkpoint.compareAndSet({ expectedRevision: saved?.revision ?? null, stage, data }));
  if (!next || next.stage !== stage || next.revision !== (saved?.revision ?? 0) + 1) throw new Error("Emby checkpoint was not saved");
  return next;
}
function record(context: ReadContext, keyPath: string): SetupRecord {
  return { appId: APP, projectRoot: context.projectRoot, stage: "manual-owner-and-api-key-verified",
    firstOwnerSetup: "manual", adminUsername: "admin", apiKeyFile: keyPath,
    apiKeyVerified: true, keyLabel: label(context.projectRoot), wizardCompleted: true,
    mediaLibraryVerified: false, restartPersistenceVerified: false };
}
async function verifyKey(context: ReadContext, key: string, saved: SetupCheckpoint): Promise<void> {
  // Prevent an anonymous/pre-wizard endpoint from masquerading as key proof.
  const anonymous = await context.http.request({ method: "GET", path: "/System/Configuration" });
  if (anonymous.status !== 401 && anonymous.status !== 403) throw new Error("Emby configuration did not deny anonymous access");
  if (await server(context, key) !== saved.data.serverId) throw new Error("Emby API key authorized a different server");
  await owner(context, key, saved.data.serverId as string, saved.data.ownerId as string);
  const matches = await inventory(context, key);
  if (matches.length !== 1 || matches[0] !== key) throw new Error("Emby saved persistent key has no exact inventory readback");
}
const adapter: SetupAdapter = {
  appId: APP, sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: "Emby",
  ready(value) {
    return value.appId === APP && value.stage === "manual-owner-and-api-key-verified"
      && value.firstOwnerSetup === "manual" && value.adminUsername === "admin"
      && value.apiKeyVerified === true && value.wizardCompleted === true
      && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile)
      && typeof value.projectRoot === "string" && isAbsolute(value.projectRoot)
      && value.keyLabel === label(value.projectRoot);
  },
  async inspect(context) {
    const status = exact(context, await context.status());
    const saved = checkpoint(context, await context.checkpoint.read());
    const path = join(status.privateFiles as string, "emby-api-key");
    const key = await context.secrets.readApiKey();
    if (!saved || saved.stage !== "key-saved" || saved.data.apiKeyFile !== path
      || await context.secrets.apiKeyPath() !== path || !token(key)
      || saved.data.passwordDigest !== digest(await context.secrets.readAdminPassword())) {
      throw new Error("Emby has no exact saved post-manual-bootstrap credential checkpoint");
    }
    await verifyKey(context, key, saved);
    return record(context, path);
  },
  async firstRun(context) {
    const status = exact(context, await context.status());
    const serverId = await server(context);
    const password = await context.secrets.readAdminPassword();
    if (!token(password)) throw new Error("Emby saved administrator password is invalid");
    let saved = checkpoint(context, await context.checkpoint.read());
    if (saved && (saved.data.serverId !== serverId || saved.data.passwordDigest !== digest(password))) throw new Error("Emby saved server or password changed");
    const authenticated = await session(context, password, serverId);
    await owner(context, authenticated.key, serverId, authenticated.ownerId);
    if (saved && saved.data.ownerId !== authenticated.ownerId) throw new Error("Emby administrator identity changed");
    const data = { serverId, ownerId: authenticated.ownerId, passwordDigest: digest(password), keyLabel: label(context.projectRoot) };
    if (!saved) saved = await save(context, null, "manual-owner-verified", data);
    const path = join(status.privateFiles as string, "emby-api-key");
    let key = await context.secrets.readApiKey();
    const storedPath = await context.secrets.apiKeyPath();
    if ((key === null) !== (storedPath === null) || (key !== null && (!token(key) || storedPath !== path))) throw new Error("Emby private API-key state is inconsistent");
    if (saved.stage === "manual-owner-verified") {
      if (key !== null || (await inventory(context, authenticated.key)).length !== 0) throw new Error("Emby has an uncheckpointed project key; never adopt or rotate it implicitly");
      const response = await context.http.request({ method: "POST", path: "/Auth/Keys", query: { App: label(context.projectRoot) },
        headers: { "X-Emby-Token": authenticated.key },
        approval: { action: CREATE, progress: "Create one labeled persistent Emby API key", once: true },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "key-create-attempted", data: saved.data } });
      if (!response.ok) throw new Error("Emby key creation is uncertain; inspect inventory without replay");
      saved = checkpoint(context, await context.checkpoint.read());
    }
    if (!saved || saved.stage === "manual-owner-verified") throw new Error("Emby API-key attempt checkpoint is missing");
    if (saved.stage === "key-create-attempted") {
      const matches = await inventory(context, authenticated.key);
      if (matches.length !== 1 || (key !== null && key !== matches[0])) throw new Error("Emby attempted key has no unique matching readback; never replay creation");
      if (key === null) {
        key = matches[0];
        if (await context.secrets.writeApiKey(key) !== path) throw new Error("Emby captured API key has a different private path");
      }
      saved = await save(context, saved, "key-saved", { ...saved.data, apiKeyFile: path });
    }
    if (!token(key) || saved.data.apiKeyFile !== path) throw new Error("Emby saved API-key checkpoint is inconsistent");
    await verifyKey(context, key, saved);
    return record(context, path);
  },
};
export default adapter;
