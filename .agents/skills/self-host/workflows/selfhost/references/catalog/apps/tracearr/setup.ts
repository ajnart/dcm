import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupInspectionContext, type SetupCheckpoint, type SetupHttpRequest, type SetupRecord } from "../../types/setup";

const APP = "tracearr";
const CREATE = "tracearr-create-first-owner";
const KEY = "tracearr-create-public-api-key";
const LOGIN = "tracearr-verify-owner-login";
const PREFIX = "/api/v1";
type ReadContext = SetupContext | SetupInspectionContext;
function pinnedVersion(value: unknown): boolean { return typeof value === "string" && /^v?2\.6\.0$/.test(value); }

async function json(context: Pick<SetupContext, "http">, request: SetupHttpRequest): Promise<SetupRecord> {
  const response = await context.http.request(request);
  if (response.status !== 200 || !response.ok) throw new Error("Tracearr request failed; inspect the saved attempt before retrying");
  return setupRecord(await response.json(), "Tracearr response");
}

async function server(context: ReadContext): Promise<SetupRecord> {
  const health = await json(context, { method: "GET", path: "/health" });
  const version = await json(context, { method: "GET", path: `${PREFIX}/version` });
  const current = setupRecord(version.current, "Tracearr version");
  if (!pinnedVersion(current.version) || health.status !== "ok" || health.mode !== "ready"
    || health.db !== true || health.redis !== true) throw new Error("Tracearr is not a ready pinned v2.6.0 server");
  const status = await json(context, { method: "GET", path: `${PREFIX}/setup/status` });
  const methods = setupRecord(status.authMethods, "Tracearr login methods");
  if (typeof status.needsSetup !== "boolean" || typeof status.requiresClaimCode !== "boolean"
    || methods.local !== true) throw new Error("Tracearr first-owner state or local login is unavailable");
  return status;
}

function checkpoint(context: ReadContext, saved: SetupCheckpoint | null): SetupCheckpoint | null {
  if (saved && (saved.appId !== APP || saved.projectRoot !== context.projectRoot
    || !["owner-attempted", "owner-verified", "key-attempted", "key-saved"].includes(saved.stage)
    || typeof saved.data.email !== "string" || !saved.attemptedActions.includes(CREATE)
    || (saved.stage !== "owner-attempted" && (typeof saved.data.userId !== "string"
      || !/^[0-9a-f-]{36}$/.test(saved.data.userId))))) {
    throw new Error("Tracearr has an unexpected owner checkpoint");
  }
  return saved;
}

function account(value: SetupRecord, email: string, userId?: unknown): string {
  if (value.username !== "admin" || value.email !== email || value.role !== "owner"
    || typeof value.userId !== "string" || !/^[0-9a-f-]{36}$/.test(value.userId)
    || (userId !== undefined && value.userId !== userId)) throw new Error("Tracearr authenticated identity is not the saved owner");
  return value.userId;
}

async function login(context: SetupContext, email: string, expectedUserId?: unknown): Promise<{ token: string; userId: string }> {
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error("Tracearr saved password is invalid");
  const digest = createHash("sha256").update(JSON.stringify({ username: "admin", email, password })).digest("hex");
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((key) => !["bearer", "owner_digest"].includes(key))
    || (Object.keys(saved).length > 0 && saved.owner_digest !== digest)) {
    throw new Error("Tracearr private session differs from the saved owner credential");
  }
  let token = saved.bearer;
  if (!token) {
    const value = await json(context, { method: "POST", path: `${PREFIX}/auth/sign-in/username`,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password }),
      approval: { action: LOGIN, progress: "Verify the saved Tracearr owner password" } });
    if (typeof value.token !== "string") throw new Error("Tracearr login returned no valid private session");
    token = value.token;
    if (token.length < 16 || token.length > 4096 || /[\r\n\0]/.test(token)) throw new Error("Tracearr login returned no valid private session");
    // Keep the exact session across deferred approvals and uncertain identity reads.
    // A fresh login would change the Authorization-bound next-step approval hash.
    await context.secrets.writeSessionCookies({ bearer: token, owner_digest: digest });
  }
  if (token.length < 16 || token.length > 4096 || /[\r\n\0]/.test(token)) throw new Error("Tracearr saved private session is invalid");
  const response = await context.http.request({ method: "GET", path: `${PREFIX}/auth/me`, headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    await context.secrets.writeSessionCookies({});
    throw new Error("Tracearr saved session was rejected; approve a fresh login on the next run");
  }
  if (response.status !== 200 || !response.ok) throw new Error("Tracearr owner identity could not be verified; retain the private session and inspect");
  const me = setupRecord(await response.json(), "Tracearr owner identity");
  const userId = account(me, email, expectedUserId);
  if (saved.bearer) {
    const fresh = await json(context, { method: "POST", path: `${PREFIX}/auth/sign-in/username`,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password }),
      approval: { action: LOGIN, progress: "Verify the saved Tracearr owner password by fresh login" } });
    if (typeof fresh.token !== "string" || fresh.token.length < 16 || fresh.token.length > 4096
      || /[\r\n\0]/.test(fresh.token)) throw new Error("Tracearr login returned no valid private session");
    const identity = await json(context, { method: "GET", path: `${PREFIX}/auth/me`,
      headers: { Authorization: `Bearer ${fresh.token}` } });
    account(identity, email, userId);
    // The fresh proof must not rotate Authorization-bound deferred writes.
  }
  return { token, userId };
}

function validKey(value: unknown): value is string { return typeof value === "string" && /^trr_pub_[A-Za-z0-9_-]{43}$/.test(value); }

async function inventory(context: SetupContext, token: string): Promise<string | null> {
  const value = await json(context, { method: "GET", path: `${PREFIX}/settings/api-key`, headers: { Authorization: `Bearer ${token}` } });
  if (value.token !== null && !validKey(value.token)) throw new Error("Tracearr persistent-key inventory is invalid");
  return value.token as string | null;
}

async function verifyKey(context: ReadContext, key: string): Promise<void> {
  const health = await json(context, { method: "GET", path: `${PREFIX}/public/health`, headers: { Authorization: `Bearer ${key}` } });
  if (health.status !== "ok" || !pinnedVersion(health.version) || !Array.isArray(health.servers)) throw new Error("Tracearr key did not authorize the expected public API");
}

function record(context: ReadContext, saved: SetupCheckpoint, path: string): SetupRecord {
  return { appId: APP, projectRoot: context.projectRoot, stage: "owner-and-key-verified", version: "2.6.0",
    adminUsername: "admin", adminEmail: saved.data.email, userId: saved.data.userId, apiKeyFile: path,
    mediaServer: "not-enrolled" };
}

const adapter: SetupAdapter = {
  appId: APP, credentialCommand: "app handoff", apiKey: "saved-by-onboarding", healthSource: "/health", homarrIntegration: "Tracearr",
  inputDefinitions: [{ key: "email", label: "First Tracearr owner's email (required)" }],
  ready(value) { return value.appId === APP && value.stage === "owner-and-key-verified" && value.version === "2.6.0"
    && value.adminUsername === "admin" && typeof value.adminEmail === "string" && typeof value.userId === "string"
    && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile); },
  async inspect(context) {
    appliedStatus(context, await context.status());
    const state = await server(context);
    const saved = checkpoint(context, await context.checkpoint.read());
    const key = await context.secrets.readApiKey();
    const path = await context.secrets.apiKeyPath();
    if (state.needsSetup || !saved || saved.stage !== "key-saved" || !saved.attemptedActions.includes(KEY)
      || !validKey(key) || !path || path !== saved.data.apiKeyFile) throw new Error("Tracearr has no completed matching owner/key checkpoint");
    await verifyKey(context, key);
    return record(context, saved, path);
  },
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    if (status.username !== "admin" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) throw new Error("Tracearr has no exact saved owner credential");
    const state = await server(context);
    let saved = checkpoint(context, await context.checkpoint.read());
    const email = context.inputs.email ?? saved?.data.email;
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || (saved && saved.data.email !== email)) throw new Error("Tracearr requires one reviewed email matching its saved owner");
    if (!saved) {
      if (!state.needsSetup || state.requiresClaimCode) throw new Error("Tracearr is already owned or requires a separately supplied claim code; refuse adoption");
      const password = await context.secrets.readAdminPassword();
      if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error("Tracearr saved password is invalid");
      await json(context, { method: "POST", path: `${PREFIX}/auth/sign-up/email`, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Administrator", username: "admin", email, password }),
        approval: { action: CREATE, once: true, progress: "Create the first Tracearr owner once" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "owner-attempted", data: { email } } });
      saved = checkpoint(context, await context.checkpoint.read());
    }
    if (!saved || (await server(context)).needsSetup) throw new Error("Tracearr owner attempt has no readback; never replay signup");
    const session = await login(context, email, saved.data.userId);
    if (saved.stage === "owner-attempted") saved = await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
      stage: "owner-verified", data: { ...saved.data, userId: session.userId } });
    let key = await inventory(context, session.token);
    const privateKey = await context.secrets.readApiKey();
    if (saved.stage === "owner-verified") {
      if (key !== null || privateKey !== null) throw new Error("Tracearr has an uncheckpointed existing key; refuse adoption or rotation");
      await json(context, { method: "POST", path: `${PREFIX}/settings/api-key/regenerate`, headers: { Authorization: `Bearer ${session.token}` },
        approval: { action: KEY, once: true, progress: "Generate the first Tracearr public API key once" },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "key-attempted", data: saved.data } });
      saved = checkpoint(context, await context.checkpoint.read());
      key = await inventory(context, session.token);
    }
    if (!saved || !saved.attemptedActions.includes(KEY) || !validKey(key)) throw new Error("Tracearr key attempt has no durable inventory; never replay generation");
    if (privateKey !== null && privateKey !== key) throw new Error("Tracearr persistent key differs from its private saved key");
    if (saved.stage === "key-attempted") {
      const path = await context.secrets.writeApiKey(key);
      if (!isAbsolute(path) || await context.secrets.readApiKey() !== key || await context.secrets.apiKeyPath() !== path) throw new Error("Tracearr private key handoff could not be verified");
      saved = await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: "key-saved", data: { ...saved.data, apiKeyFile: path } });
    }
    const path = await context.secrets.apiKeyPath();
    if (saved.stage !== "key-saved" || await context.secrets.readApiKey() !== key
      || !path || path !== saved.data.apiKeyFile) throw new Error("Tracearr has no matching completed private key checkpoint");
    await verifyKey(context, key);
    return record(context, saved, path);
  },
};

export default adapter;
