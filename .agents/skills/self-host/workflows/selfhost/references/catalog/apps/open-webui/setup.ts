import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupCheckpoint, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "open-webui";
const ADMIN_EMAIL = "admin@example.test";
const PREFIX = "/api/v1/auths";
const CREATE = "open-webui-create-integration-key";
const ENABLE_POLICY = "open-webui-enable-integration-policy";
const POLICY_BOOLEANS = ["SHOW_ADMIN_DETAILS", "ENABLE_LOGIN_FORM", "ENABLE_SIGNUP", "ENABLE_API_KEYS",
  "ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS", "ENABLE_COMMUNITY_SHARING", "ENABLE_MESSAGE_RATING", "ENABLE_FOLDERS",
  "ENABLE_AUTOMATIONS", "ENABLE_CHANNELS", "ENABLE_CALENDAR", "ENABLE_MEMORIES", "ENABLE_MEMORY_SYSTEM_CONTEXT",
  "ENABLE_NOTES", "ENABLE_USER_WEBHOOKS", "ENABLE_USER_STATUS"];
const POLICY_STRINGS = ["WEBUI_URL", "API_KEYS_ALLOWED_ENDPOINTS", "DEFAULT_USER_ROLE", "DEFAULT_GROUP_ID",
  "JWT_EXPIRES_IN", "CHANNEL_MODEL_RESPONSE_MODE"];
const POLICY_NULLABLE_STRINGS = ["ADMIN_EMAIL", "PENDING_USER_OVERLAY_TITLE", "PENDING_USER_OVERLAY_CONTENT", "RESPONSE_WATERMARK"];
const POLICY_LIMITS = ["FOLDER_MAX_FILE_COUNT", "AUTOMATION_MAX_COUNT", "AUTOMATION_MIN_INTERVAL"];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as SetupRecord;
    return `{${Object.keys(record).sort().map((field) => `${JSON.stringify(field)}:${canonical(record[field])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Open WebUI policy contains a non-JSON value");
  return serialized;
}

function policyDigest(policy: SetupRecord): string {
  return createHash("sha256").update(canonical(policy)).digest("hex");
}

function policySnapshot(value: unknown): SetupRecord {
  const policy = setupRecord(value, "Open WebUI administrator policy");
  const fields = [...POLICY_BOOLEANS, ...POLICY_STRINGS, ...POLICY_NULLABLE_STRINGS, ...POLICY_LIMITS, "DEFAULT_INTERFACE_SETTINGS", "I18N"];
  if (Object.keys(policy).length !== fields.length || fields.some((field) => !(field in policy))
    || POLICY_BOOLEANS.some((field) => typeof policy[field] !== "boolean")
    || POLICY_STRINGS.some((field) => typeof policy[field] !== "string")
    || POLICY_NULLABLE_STRINGS.some((field) => policy[field] !== null && typeof policy[field] !== "string")
    || (policy.I18N !== null && (typeof policy.I18N !== "object" || Array.isArray(policy.I18N)))) {
    throw new Error("Open WebUI administrator policy differs from the pinned configuration schema");
  }
  return policy;
}

async function ensurePolicy(context: SetupContext, authorization: string, checkpoint: SetupCheckpoint): Promise<SetupCheckpoint> {
  async function read(): Promise<SetupRecord> {
    const response = await context.http.request({ method: "GET", path: `${PREFIX}/admin/config`,
      headers: { Authorization: authorization }, approval: { action: "open-webui-inspect-integration-policy",
        progress: "Read the administrator API-key policy and record account activity" } });
    if (response.status !== 200) throw new Error("Open WebUI administrator policy readback is uncertain; no policy write repeated");
    return policySnapshot(await response.json());
  }
  const before = await read();
  if (checkpoint.stage === "integration-policy-enable-attempted") {
    if (before.ENABLE_API_KEYS !== true || policyDigest(before) !== checkpoint.data.policyAfterDigest) {
      throw new Error("Open WebUI policy enable outcome is unresolved or conflicts with another administrator; do not repeat the policy write");
    }
    return context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
      stage: "integration-admin-verified", data: checkpoint.data });
  }
  if (before.ENABLE_API_KEYS === true) return checkpoint;
  if (checkpoint.attemptedActions.includes(ENABLE_POLICY)) {
    throw new Error("Open WebUI API-key policy changed after its one approved enable; refuse automatic replay");
  }
  // v0.11.4 bulk-writes optional defaults and normalizes these fields. Fail
  // closed rather than alter unrelated settings. I18N and ENABLE_LOGIN_FORM
  // are explicitly preserved when omitted, avoiding I18N normalization too.
  if (before.DEFAULT_INTERFACE_SETTINGS === null || typeof before.DEFAULT_INTERFACE_SETTINGS !== "object"
    || Array.isArray(before.DEFAULT_INTERFACE_SETTINGS)
    || POLICY_LIMITS.some((field) => before[field] !== ""
      && (!Number.isSafeInteger(before[field]) || before[field] === 0))
    || !["pending", "user", "admin"].includes(before.DEFAULT_USER_ROLE as string)
    || !["thread", "channel"].includes(before.CHANNEL_MODEL_RESPONSE_MODE as string)
    || !/^(-1|0|(-?\d+(\.\d+)?)(ms|s|m|h|d|w))$/.test(before.JWT_EXPIRES_IN as string)) {
    throw new Error("Open WebUI policy cannot round-trip unchanged through the pinned bulk update; enable it separately without changing unrelated settings");
  }
  const after: SetupRecord = { ...before, ENABLE_API_KEYS: true };
  const payload: SetupRecord = { ...after };
  delete payload.I18N;
  delete payload.ENABLE_LOGIN_FORM;
  const data = { ...checkpoint.data, policyBeforeDigest: policyDigest(before), policyAfterDigest: policyDigest(after) };
  const changed = await context.http.request({ method: "POST", path: `${PREFIX}/admin/config`,
    headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    approval: { action: ENABLE_POLICY, once: true,
      progress: "Enable global Open WebUI API-key access only; preserve the reviewed settings snapshot. Serialize other administrator configuration writes" },
    beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "integration-policy-enable-attempted", data } });
  if (changed.status !== 200 || policyDigest(policySnapshot(await changed.json())) !== data.policyAfterDigest) {
    throw new Error("Open WebUI policy enable outcome is unresolved; reconcile the current policy without repeating the write");
  }
  const attempted = await context.checkpoint.read();
  if (!attempted || attempted.stage !== "integration-policy-enable-attempted"
    || attempted.data.policyAfterDigest !== data.policyAfterDigest || attempted.data.ownerId !== checkpoint.data.ownerId) {
    throw new Error("Open WebUI policy checkpoint changed during verification");
  }
  // Re-enter the owner/password checks at the new checkpoint before the
  // separately approved GET readback, keeping deferred request approvals stable.
  return attempted;
}

function owner(value: unknown): SetupRecord {
  const account = setupRecord(value, "Open WebUI administrator");
  if (account.email !== ADMIN_EMAIL || account.role !== "admin"
    || typeof account.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(account.id)) {
    throw new Error("The saved Open WebUI account is not the expected administrator");
  }
  return account;
}

function key(value: unknown): string {
  const record = setupRecord(value, "Open WebUI API key");
  if (typeof record.api_key !== "string" || !/^sk-[a-f0-9]{32}$/.test(record.api_key)) {
    throw new Error("Open WebUI returned an invalid durable API key");
  }
  return record.api_key;
}

async function login(context: SetupContext, password: string): Promise<SetupRecord> {
  const response = await context.http.request({ method: "POST", path: `${PREFIX}/signin`,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ADMIN_EMAIL, password }),
    approval: { action: "open-webui-verify-admin", progress: "Verify the saved Open WebUI administrator login" } });
  if (response.status !== 200 || !response.ok) throw new Error("Open WebUI administrator login could not be verified");
  return owner(await response.json());
}

async function integration(context: SetupContext, password: string): Promise<SetupRecord> {
  let checkpoint = await context.checkpoint.read();
  if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
    || checkpoint.data.integrationAccess !== "enabled"
    || !["integration-choice", "integration-admin-verified", "integration-policy-enable-attempted", "integration-create-attempted", "integration-key-verified"].includes(checkpoint.stage))) {
    throw new Error("Open WebUI integration checkpoint differs from the saved choice");
  }
  if (!checkpoint) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null,
    stage: "integration-choice", data: { integrationAccess: "enabled" } });
  const digest = createHash("sha256").update(password).digest("hex");
  let session = await context.secrets.readSessionCookies();
  if (Object.keys(session).length > 0 && (Object.keys(session).some((field) => !["token", "password-digest", "owner-id", "pending-token"].includes(field))
    || session["password-digest"] !== digest || !/^[A-Za-z0-9_.-]{16,8192}$/.test(session.token ?? "")
    || !/^[A-Za-z0-9_-]{1,128}$/.test(session["owner-id"] ?? "")
    || (session["pending-token"] !== undefined && !/^[A-Za-z0-9_.-]{16,8192}$/.test(session["pending-token"])))) {
    throw new Error("Open WebUI saved session differs from the administrator credential");
  }
  const retainedSession = Boolean(session.token);
  if (!session.token) {
    const account = await login(context, password);
    if (typeof account.token !== "string" || !/^[A-Za-z0-9_.-]{16,8192}$/.test(account.token)
      || (checkpoint.data.ownerId !== undefined && checkpoint.data.ownerId !== account.id)) {
      throw new Error("Open WebUI login did not return the expected private administrator session");
    }
    // The authenticated signin response already identifies the exact owner.
    // Cache before subsequent approved GETs, whose JWT auth updates activity.
    session = { token: account.token, "password-digest": digest, "owner-id": account.id as string };
    await context.secrets.writeSessionCookies(session);
  }
  if (checkpoint.stage === "integration-choice") checkpoint = await context.checkpoint.compareAndSet({
    expectedRevision: checkpoint.revision, stage: "integration-admin-verified",
    data: { integrationAccess: "enabled", ownerId: session["owner-id"]! } });
  const authorization = `Bearer ${session.token}`;
  const current = await context.http.request({ method: "GET", path: `${PREFIX}/`, headers: { Authorization: authorization },
    approval: { action: "open-webui-verify-session",
      progress: "Verify the saved administrator session and record Open WebUI account activity" } });
  if (current.status === 401) {
    await context.secrets.writeSessionCookies({});
    throw new Error("Open WebUI saved session is unauthorized; authenticate on a subsequent reviewed invocation");
  }
  if (current.status !== 200) throw new Error("Open WebUI saved-session verification is uncertain; session preserved");
  const account = owner(await current.json());
  if (account.id !== session["owner-id"] || (checkpoint.data.ownerId !== undefined && checkpoint.data.ownerId !== account.id)) {
    throw new Error("Open WebUI administrator identity changed");
  }
  if (retainedSession) {
    if (!session["pending-token"]) {
      const fresh = await login(context, password);
      if (fresh.id !== account.id || typeof fresh.token !== "string" || !/^[A-Za-z0-9_.-]{16,8192}$/.test(fresh.token)) {
        throw new Error("Open WebUI fresh password login differs from the retained administrator");
      }
      session = { ...session, "pending-token": fresh.token };
      await context.secrets.writeSessionCookies(session);
    }
    // This GET updates activity, so its stable fresh bearer needs its own approval.
    const fresh = await context.http.request({ method: "GET", path: `${PREFIX}/`,
      headers: { Authorization: `Bearer ${session["pending-token"]}` },
      approval: { action: "open-webui-verify-fresh-session",
        progress: "Verify the fresh password session identifies the retained administrator and record account activity" } });
    if (fresh.status === 401) {
      delete session["pending-token"];
      await context.secrets.writeSessionCookies(session);
      throw new Error("Open WebUI fresh password session was rejected; retained session preserved");
    }
    if (fresh.status !== 200) throw new Error("Open WebUI fresh-session verification is uncertain; private sessions preserved");
    let freshOwner: SetupRecord;
    try { freshOwner = owner(await fresh.json()); }
    catch {
      delete session["pending-token"];
      await context.secrets.writeSessionCookies(session);
      throw new Error("Open WebUI fresh password login returned a different administrator");
    }
    if (freshOwner.id !== account.id) {
      delete session["pending-token"];
      await context.secrets.writeSessionCookies(session);
      throw new Error("Open WebUI fresh password login differs from the retained administrator");
    }
  }
  const policyCheckpoint = await ensurePolicy(context, authorization, checkpoint);
  if (policyCheckpoint.revision !== checkpoint.revision) return integration(context, password);
  checkpoint = policyCheckpoint;
  const inventory = await context.http.request({ method: "GET", path: `${PREFIX}/api_key`, headers: { Authorization: authorization },
    approval: { action: "open-webui-inspect-integration-key",
      progress: "Inspect the existing administrator API key without rotating it and record account activity" } });
  const saved = await context.secrets.readApiKey();
  if (inventory.status === 403) {
    delete session["pending-token"];
    await context.secrets.writeSessionCookies(session);
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "integration-policy-pending",
      adminEmail: ADMIN_EMAIL, adminRole: "admin", integrationAccess: "enabled", apiKeyCreated: false, apiKeyVerified: false,
      integrationReady: false, requiredPolicy: "Global API-key policy is enabled, but upstream key access was denied; inspect endpoint restrictions separately" };
  }
  let apiKey: string;
  if (inventory.status === 200) {
    apiKey = key(await inventory.json());
    if (saved !== null && saved !== apiKey) throw new Error("Open WebUI saved key differs from the current owner key; refuse rotation");
  } else if (inventory.status === 404) {
    if (saved !== null || checkpoint.stage !== "integration-admin-verified"
      || checkpoint.attemptedActions.includes(CREATE)) {
      throw new Error("Open WebUI key creation outcome is unresolved; do not repeat or rotate it");
    }
    const created = await context.http.request({ method: "POST", path: `${PREFIX}/api_key`, headers: { Authorization: authorization },
      approval: { action: CREATE, once: true, progress: "Create one administrator Open WebUI API key only after confirming none exists; never rotate an existing key" },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "integration-create-attempted",
        data: { ...checkpoint.data, integrationAccess: "enabled", ownerId: account.id as string } } });
    if (created.status !== 200) throw new Error("Open WebUI key creation is unresolved; inspect the existing key before retrying");
    apiKey = key(await created.json());
    // Persist the returned plaintext before any further readback can fail.
    await context.secrets.writeApiKey(apiKey);
    return integration(context, password);
  } else {
    throw new Error("Open WebUI API-key inventory is uncertain; no creation was attempted");
  }
  const apiKeyFile = await context.secrets.writeApiKey(apiKey);
  const verified = await context.http.request({ method: "GET", path: `${PREFIX}/`, headers: { Authorization: `Bearer ${apiKey}` },
    approval: { action: "open-webui-verify-integration-key",
      progress: "Verify the saved API key identifies the same administrator and record account activity" } });
  if (verified.status !== 200 || owner(await verified.json()).id !== account.id) {
    throw new Error("Open WebUI saved API key did not verify the same administrator");
  }
  checkpoint = await context.checkpoint.read();
  if (!checkpoint || checkpoint.data.integrationAccess !== "enabled" || checkpoint.data.ownerId !== account.id
    || (checkpoint.stage === "integration-key-verified" && checkpoint.data.apiKeyRef !== apiKeyFile)) {
    throw new Error("Open WebUI API key differs from its exact integration checkpoint");
  }
  if (checkpoint.stage !== "integration-key-verified") await context.checkpoint.compareAndSet({
    expectedRevision: checkpoint.revision, stage: "integration-key-verified",
    data: { ...checkpoint.data, apiKeyRef: apiKeyFile } });
  delete session["pending-token"];
  await context.secrets.writeSessionCookies(session);
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "integration-key-verified",
    adminEmail: ADMIN_EMAIL, adminRole: "admin", apiKeyFile, apiKeyVerified: true,
    apiKeyCreated: checkpoint.attemptedActions.includes(CREATE),
    integrationAccess: "enabled", integrationReady: true, modelProviderVerified: false, restartPersistenceVerified: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  inputDefinitions: [{ key: "integration-access", label: "Optionally enable global API-key access and capture the owner key (enabled); each write requires separate approval" }],
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    if (record.appId !== APP_ID || record.adminEmail !== ADMIN_EMAIL || record.adminRole !== "admin") return false;
    if (record.stage === "admin-verified") return record.integrationAccess === "disabled";
    return record.stage === "integration-key-verified" && record.apiKeyVerified === true
      && record.integrationAccess === "enabled" && record.integrationReady === true
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Open WebUI setup received a different app ID");
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (password.length < 1 || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Open WebUI has no valid saved administrator password");
    }
    const access = context.inputs["integration-access"];
    if (access !== undefined && access !== "enabled" && access !== "disabled") throw new Error("Open WebUI integration-access must be enabled or disabled");
    if (access === "enabled") return integration(context, password);
    if (await context.checkpoint.read() !== null) throw new Error("Open WebUI integration choice changed; preserve the saved choice before continuing");
    await login(context, password);
    // Account-only setup does not save or expose the expiring bearer session.
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-verified", adminEmail: ADMIN_EMAIL,
      adminRole: "admin", integrationAccess: "disabled", integrationReady: false, apiKeyCreated: false, apiKeyVerified: false };
  },
};

export default adapter;
