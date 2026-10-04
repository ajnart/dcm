import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupCheckpoint,
  type SetupContext, type SetupHttpApproval, type SetupInspectionContext, type SetupRecord } from "../../types/setup.ts";

const CREATE = "portainer-create-api-key";
const DESCRIPTION = "Auto-Stack administrator";
const ATTEMPTED = "api-key-create-attempted";
const SAVED = "administrator-api-key-saved";
const VERIFIED = "administrator-api-key-verified";
type Context = SetupContext | SetupInspectionContext;

function keyDigest(key: string): string { return createHash("sha256").update(key).digest("hex"); }
function validKey(value: unknown): value is string {
  return typeof value === "string" && /^ptr_[A-Za-z0-9+/]{43}=$/.test(value);
}

async function owner(context: Context): Promise<SetupRecord> {
  if (context.appId !== "portainer" || !isAbsolute(context.projectRoot)) throw new Error("Portainer owner differs");
  const status = appliedStatus(context, await context.status());
  if (status.ownerKind !== "shared" || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
    || status.passwordFile !== join(status.privateFiles, "admin-password")) {
    throw new Error("Portainer needs the exact shared-owner administrator file");
  }
  const version = await context.http.request({ method: "GET", path: "/api/system/status" });
  if (version.status !== 200 || setupRecord(await version.json(), "Portainer version").Version !== "2.45.1") {
    throw new Error("Portainer setup requires pinned 2.45.1");
  }
  return status;
}

function checkpoint(context: Context, value: SetupCheckpoint | null): SetupCheckpoint | null {
  if (value && (value.schemaVersion !== 1 || value.appId !== "portainer"
    || value.projectRoot !== context.projectRoot || !Number.isSafeInteger(value.revision) || value.revision < 1
    || ![ATTEMPTED, SAVED, VERIFIED].includes(value.stage)
    || !value.attemptedActions.includes(CREATE) || value.data.description !== DESCRIPTION)) {
    throw new Error("Portainer API-key checkpoint differs; inspect before continuing");
  }
  return value;
}

async function readAdmin(context: Context, headers: Record<string, string>, approval?: SetupHttpApproval): Promise<void> {
  const request = { method: "GET" as const, path: "/api/users/me", headers };
  let response;
  if (approval) response = await (context as SetupContext).http.request({ ...request, approval });
  else response = await context.http.request(request);
  if (response.status !== 200) throw new Error("Portainer administrator could not be verified");
  const user = setupRecord(await response.json(), "Portainer current user");
  if (user.Id !== 1 || user.Username !== "admin" || user.Role !== 1 || user.forceChangePassword !== false) {
    throw new Error("Portainer identity or password policy differs from the initial administrator");
  }
}

async function login(context: SetupContext, password: string): Promise<string> {
  const digest = keyDigest(password);
  let saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).length && (Object.keys(saved).some((key) => !["password_digest", "jwt"].includes(key))
    || saved.password_digest !== digest || !/^[A-Za-z0-9_.-]{20,8192}$/.test(saved.jwt ?? ""))) {
    throw new Error("Portainer private session differs from its saved credential");
  }
  if (saved.jwt) {
    const response = await context.http.request({ method: "GET", path: "/api/users/me", headers: { Authorization: `Bearer ${saved.jwt}` } });
    if (response.status === 401) {
      // Pinned JWT authentication rejects invalid/expired tokens with 401 only.
      await context.secrets.writeSessionCookies({});
      saved = {};
    } else {
      if (response.status !== 200) throw new Error("Portainer session is uncertain; preserve it for inspection");
      const user = setupRecord(await response.json(), "Portainer current user");
      if (user.Id !== 1 || user.Username !== "admin" || user.Role !== 1 || user.forceChangePassword !== false) {
        throw new Error("Portainer saved session identity differs");
      }
    }
  }
  const response = await context.http.request({ method: "POST", path: "/api/auth",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Username: "admin", Password: password }),
    approval: { action: "portainer-verify-admin", progress: "Authenticate the private file-preseeded Portainer administrator" } });
  if (response.status !== 200) throw new Error("Portainer saved administrator password was not accepted");
  const result = setupRecord(await response.json(), "Portainer login");
  if (typeof result.jwt !== "string" || !/^[A-Za-z0-9_.-]{20,8192}$/.test(result.jwt)) throw new Error("Portainer login did not return a valid private session");
  // Fresh password proof must succeed before replacing any private session.
  await readAdmin(context, { Authorization: `Bearer ${result.jwt}` });
  // Keep the original JWT stable for any already-reviewed token creation.
  if (saved.jwt) return saved.jwt;
  await context.secrets.writeSessionCookies({ password_digest: digest, jwt: result.jwt });
  return result.jwt;
}

async function inventory(context: SetupContext, jwt: string): Promise<SetupRecord[]> {
  const response = await context.http.request({ method: "GET", path: "/api/users/1/tokens", headers: { Authorization: `Bearer ${jwt}` } });
  if (response.status !== 200) throw new Error("Portainer API-key inventory could not be read");
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error("Portainer API-key inventory is invalid");
  return value.map((item) => setupRecord(item, "Portainer API-key metadata"));
}

function metadata(value: unknown, key: string): SetupRecord {
  const token = setupRecord(value, "Portainer API-key metadata");
  if (!Number.isSafeInteger(token.id) || Number(token.id) < 1 || token.userId !== 1
    || token.description !== DESCRIPTION || token.prefix !== key.slice(0, 7)) {
    throw new Error("Portainer one-time key metadata differs");
  }
  return token;
}

function record(context: Context, file: string, value: SetupCheckpoint, current: boolean): SetupRecord {
  return { appId: "portainer", projectRoot: context.projectRoot, stage: "docker-endpoint-required",
    adminUsername: "admin", apiKeyFile: file, apiKeyId: value.data.apiKeyId,
    credentialPreparationSaved: true, loginVerified: current, apiKeyVerified: current,
    connectionVerified: false, dockerAuthorityVerified: false, functionalAcceptance: false };
}

async function savedKey(context: Context, status: SetupRecord, value: SetupCheckpoint): Promise<{ key: string; file: string }> {
  const key = await context.secrets.readApiKey();
  const file = join(status.privateFiles as string, "portainer-api-key");
  if (!validKey(key) || await context.secrets.apiKeyPath() !== file
    || ([SAVED, VERIFIED].includes(value.stage) && (value.data.apiKeyFile !== file
      || value.data.apiKeySha256 !== keyDigest(key)))) {
    throw new Error("Portainer one-time API key is missing or differs; do not recreate it");
  }
  return { key, file };
}

const adapter: SetupAdapter = {
  appId: "portainer", credentialCommand: "app handoff", apiKey: "saved-by-onboarding",
  healthSource: null, homarrIntegration: null,
  ready() { return false; },
  async inspect(context) {
    const status = await owner(context);
    const value = checkpoint(context, await context.checkpoint.read());
    if (!value || value.stage !== VERIFIED) throw new Error("Portainer credentials have not completed approved verification");
    const { file } = await savedKey(context, status, value);
    // Inspection cannot renew a JWT or use an API key: key auth updates LastUsed.
    // This is saved credential evidence only, never current account/engine proof.
    return record(context, file, value, false);
  },
  async firstRun(context) {
    const status = await owner(context);
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 72 || /[\r\n\u0000]/.test(password)) throw new Error("Portainer saved password is invalid");
    const jwt = await login(context, password);
    const endpoints = await context.http.request({ method: "GET", path: "/api/endpoints",
      headers: { Authorization: `Bearer ${jwt}` } });
    if (endpoints.status !== 200) throw new Error("Portainer disconnected environment inventory could not be checked");
    const environments = await endpoints.json();
    if (!Array.isArray(environments) || environments.length !== 0) {
      throw new Error("Portainer has a Docker environment outside disconnected preparation; inspect its separate authority");
    }
    let value = checkpoint(context, await context.checkpoint.read());
    let key = await context.secrets.readApiKey();
    let file = await context.secrets.apiKeyPath();
    const expectedFile = join(status.privateFiles as string, "portainer-api-key");
    const tokens = await inventory(context, jwt);
    const matches = tokens.filter((token) => token.description === DESCRIPTION);
    if (!value) {
      if (key !== null || file !== null || matches.length) throw new Error("Portainer token exists without this owner's create checkpoint; inspect manually");
      const response = await context.http.request({ method: "POST", path: "/api/users/1/tokens",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password, description: DESCRIPTION }),
        approval: { action: CREATE, once: true, progress: "Create one administrator-equivalent Portainer API key and save it privately; Docker endpoint authority remains separate" },
        beforeSendCheckpoint: { expectedRevision: null, stage: ATTEMPTED, data: { description: DESCRIPTION } } });
      if (response.status !== 200) throw new Error("Portainer key creation is uncertain; never retry an unsaved create");
      const result = setupRecord(await response.json(), "Portainer API-key response");
      if (!validKey(result.rawAPIKey)) throw new Error("Portainer did not return its one-time key; inspect without recreating");
      key = result.rawAPIKey;
      const token = metadata(result.apiKey, key);
      if (token.digest !== createHash("sha256").update(key).digest("base64")) throw new Error("Portainer returned inconsistent key material");
      value = checkpoint(context, await context.checkpoint.read());
      if (!value || value.stage !== ATTEMPTED) throw new Error("Portainer durable pre-send checkpoint is missing");
      // Save before any follow-up network request. A lost unsaved response stops replay.
      file = await context.secrets.writeApiKey(key);
      if (file !== expectedFile) throw new Error("Portainer key writer returned a different private path");
      value = await context.checkpoint.compareAndSet({ expectedRevision: value.revision, stage: SAVED,
        data: { description: DESCRIPTION, apiKeyId: Number(token.id), apiKeyFile: file, apiKeySha256: keyDigest(key) } });
    } else {
      const saved = await savedKey(context, status, value);
      key = saved.key;
      file = saved.file;
      if (matches.length !== 1) throw new Error("Portainer saved key inventory differs; inspect without recreating");
      const token = metadata(matches[0], key);
      if (value.stage !== ATTEMPTED && value.data.apiKeyId !== token.id) throw new Error("Portainer key identity changed");
      if (value.stage === ATTEMPTED) {
        value = await context.checkpoint.compareAndSet({ expectedRevision: value.revision, stage: SAVED,
          data: { description: DESCRIPTION, apiKeyId: Number(token.id), apiKeyFile: file, apiKeySha256: keyDigest(key) } });
      }
    }
    if (!validKey(key) || file !== expectedFile) throw new Error("Portainer saved key is unavailable");
    await readAdmin(context, { "X-API-Key": key }, { action: "portainer-verify-api-key",
      progress: "Verify the saved Portainer administrator API key; authentication may update its last-used metadata" });
    if (value.stage !== VERIFIED) value = await context.checkpoint.compareAndSet({ expectedRevision: value.revision, stage: VERIFIED, data: value.data });
    return record(context, file, value, true);
  },
};

export default adapter;
