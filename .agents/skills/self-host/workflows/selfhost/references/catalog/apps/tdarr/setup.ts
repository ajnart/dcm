import { createHash, randomBytes } from "node:crypto";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext,
  type SetupCheckpoint } from "../../types/setup";

const APP_ID = "tdarr";
const REGISTER = "tdarr-register-first-owner";
const INSERT = "tdarr-insert-owned-api-key";
const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");

// Exact 2.92.01 frontend request contracts and provenance: bootstrap-source.md.
function checked(context: SetupContext, checkpoint: SetupCheckpoint | null, key: string | null) {
  if (checkpoint === null) return;
  if (checkpoint.schemaVersion !== 1 || checkpoint.appId !== APP_ID
    || checkpoint.projectRoot !== context.projectRoot || checkpoint.revision < 1
    || !["owner-attempted", "key-attempted", "verified"].includes(checkpoint.stage)
    || (checkpoint.stage !== "owner-attempted"
      && (!key || checkpoint.data.keyHash !== keyHash(key)))) {
    throw new Error("Tdarr checkpoint does not match this app and private key");
  }
}

async function login(context: SetupContext, password: string): Promise<string | null> {
  const digest = keyHash(password);
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((field) => !["bearer", "password_digest", "key_date"].includes(field))
    || (saved.bearer && (saved.password_digest !== digest || saved.bearer.length > 8192
      || /[\r\n\u0000]/.test(saved.bearer)))) {
    throw new Error("Tdarr private session differs from the saved owner credential");
  }
  if (saved.bearer) {
    await verifySession(context, saved.bearer);
  }
  const response = await context.http.request({ method: "POST",
    path: "/api/v2/public/auth/login", body: JSON.stringify({ username: "admin", password }),
    headers: { "Content-Type": "application/json", "x-tdarr-request-source": "webui" },
    approval: { action: "tdarr-login", progress: "Verify the saved Tdarr owner login" } });
  if (response.status === 401 || response.status === 403) {
    if (saved.bearer) throw new Error("Tdarr rejected the saved owner password; retained session does not verify it");
    return null;
  }
  if (response.status !== 200 || !response.ok) throw new Error("Tdarr owner login failed");
  const result = setupRecord(await response.json(), "Tdarr login");
  if (typeof result.token !== "string" || !result.token || result.token.length > 8192 || /[\r\n\u0000]/.test(result.token)) {
    throw new Error("Tdarr login returned no valid token");
  }
  if (saved.bearer) {
    // Verify the password independently without changing the bearer bound to
    // a pending key-insertion approval. A failed fresh token cannot erase it.
    await verifySession(context, result.token, false);
    return saved.bearer;
  }
  // Private pending session: retain the issued token across uncertain readback,
  // but every fresh/replayed use must pass verifySession before any mutation.
  await context.secrets.writeSessionCookies({ ...saved, bearer: result.token, password_digest: digest });
  await verifySession(context, result.token);
  return result.token;
}

async function verifySession(context: SetupContext, token: string, clearSavedSession = true): Promise<void> {
  const owner = await context.http.request({ method: "GET", path: "/api/v2/auth/verify-token",
    headers: { Authorization: `Bearer ${token}`, "x-tdarr-request-source": "webui" } });
  if (owner.status === 401) {
    if (clearSavedSession) {
      const saved = await context.secrets.readSessionCookies();
      delete saved.bearer;
      delete saved.password_digest;
      await context.secrets.writeSessionCookies(saved);
    }
    throw new Error("Tdarr setup session expired; request a new approved login on the next run");
  }
  if (owner.status !== 200 || !owner.ok) throw new Error("Tdarr owner token readback failed");
  const identity = setupRecord(await owner.json(), "Tdarr owner identity");
  if (!Array.isArray(identity.roles) || !identity.roles.includes("admin")) {
    throw new Error("Tdarr saved login is not an administrator");
  }
}

async function inventory(context: SetupContext, token: string, apiKey = false): Promise<unknown[]> {
  const authorization: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (apiKey) {
    delete authorization.Authorization;
    authorization["x-api-key"] = token;
  }
  const response = await context.http.request({ method: "POST", path: "/api/v2/cruddb",
    headers: { "Content-Type": "application/json", ...authorization,
      "x-tdarr-request-source": "webui" },
    body: JSON.stringify({ data: { collection: "ApiKeysJSONDB", mode: "getAll", docID: "", obj: {} } }),
    approval: { action: "tdarr-read-api-keys", progress: "Read back Tdarr API-key ownership privately" } });
  if (response.status !== 200 || !response.ok) throw new Error("Tdarr API-key inventory failed");
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error("Tdarr API-key inventory is invalid");
  return value;
}

const adapter: SetupAdapter = {
  appId: APP_ID, sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", healthSource: "Saved owner login and private API-key inventory readback",
  homarrIntegration: "Tdarr",
  ready(record) {
    return record.appId === APP_ID && record.stage === "owner-and-api-key-verified"
      && record.adminUsername === "admin" && typeof record.apiKeyFile === "string";
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Tdarr received a different app ID");
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Tdarr saved owner password is invalid");
    }
    let key = await context.secrets.readApiKey();
    if (key !== null && !/^tapi_[a-zA-Z0-9_]{9,128}$/.test(key)) {
      throw new Error("Tdarr saved API key is invalid");
    }
    let checkpoint = await context.checkpoint.read();
    checked(context, checkpoint, key);
    let token = await login(context, password);
    if (token && checkpoint === null) {
      throw new Error("Tdarr has an uncheckpointed owner; refusing implicit adoption");
    }
    if (!token) {
      const state = await context.http.request({ method: "GET", path: "/api/v2/auth/verify-token",
        headers: { "x-tdarr-request-source": "webui" } });
      if (![401, 403].includes(state.status)
        || setupRecord(await state.json(), "Tdarr initial auth").setupAdmin !== true) {
        throw new Error("Tdarr already has an owner or has an incompatible authentication contract");
      }
      if (checkpoint !== null) throw new Error("Tdarr owner creation was attempted; inspect before retrying");
      const response = await context.http.request({ method: "POST", path: "/api/v2/public/auth/register",
        headers: { "Content-Type": "application/json", "x-tdarr-request-source": "webui" },
        body: JSON.stringify({ username: "admin", password }),
        approval: { action: REGISTER, progress: "Create the first Tdarr administrator", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: "owner-attempted" } });
      if (response.status !== 201 || !response.ok) throw new Error("Tdarr first-owner creation failed");
      token = await login(context, password);
      if (!token) throw new Error("Tdarr newly created owner login failed");
      checkpoint = await context.checkpoint.read();
      checked(context, checkpoint, key);
    }
    if (!key) {
      key = `tapi_${randomBytes(32).toString("hex")}`;
      await context.secrets.writeApiKey(key);
      if (await context.secrets.readApiKey() !== key) throw new Error("Tdarr key was not saved privately");
    }
    const hasKey = (items: unknown[]) => items.some((item) => setupRecord(item, "Tdarr API key")._id === key);
    if (!hasKey(await inventory(context, token))) {
      if (checkpoint?.attemptedActions.includes(INSERT)) {
        throw new Error("Tdarr key creation was attempted but not found; inspect before retrying");
      }
      const session = await context.secrets.readSessionCookies();
      if (!session.key_date) {
        session.key_date = String(Date.now());
        await context.secrets.writeSessionCookies(session);
      }
      const date = Number(session.key_date);
      if (!Number.isSafeInteger(date) || date < 1 || date > Date.now()) {
        throw new Error("Tdarr private key creation date is invalid");
      }
      const response = await context.http.request({ method: "POST", path: "/api/v2/cruddb",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
          "x-tdarr-request-source": "webui" },
        body: JSON.stringify({ data: { collection: "ApiKeysJSONDB", mode: "insert", docID: key,
          obj: { _id: key, date } } }),
        approval: { action: INSERT, progress: "Create the privately saved Tdarr API key", once: true },
        beforeSendCheckpoint: { expectedRevision: checkpoint?.revision ?? null,
          stage: "key-attempted", data: { keyHash: keyHash(key) } } });
      if (!response.ok) throw new Error("Tdarr owned API-key insertion failed");
    }
    if (!hasKey(await inventory(context, token))) throw new Error("Tdarr owned API-key readback failed");
    if (!hasKey(await inventory(context, key, true))) throw new Error("Tdarr independent API-key access failed");
    checkpoint = await context.checkpoint.read();
    await context.checkpoint.compareAndSet({ expectedRevision: checkpoint?.revision ?? null,
      stage: "verified", data: { keyHash: keyHash(key) } });
    const apiKeyFile = await context.secrets.apiKeyPath();
    if (!apiKeyFile) throw new Error("Tdarr private API-key handoff path is missing");
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "owner-and-api-key-verified",
      adminUsername: "admin", serverVersion: "2.92.01", apiKeyFile };
  },
};

export default adapter;
