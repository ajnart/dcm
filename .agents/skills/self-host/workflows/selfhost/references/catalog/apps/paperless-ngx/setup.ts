import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, statusApproval, type SetupAdapter, type SetupContext,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup";

const APP_ID = "paperless-ngx";
const ATTEMPT = "paperless-acquire-api-token";
type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "http" | "secrets" | "status">;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Paperless ${label} is invalid`);
  return value as Record<string, unknown>;
}

function exactStatus(context: ReadContext, value: unknown): SetupRecord {
  const status = object(value, "status");
  const runtime = object(status.runtime, "runtime");
  if (status.command !== "app status" || status.appId !== APP_ID
    || status.projectRoot !== context.projectRoot || status.status !== "applied"
    || status.mutation !== false || runtime.state !== "running"
    || status.username !== "admin" || typeof status.passwordFile !== "string"
    || !isAbsolute(status.passwordFile) || typeof status.url !== "string"
    || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(status.url)) {
    throw new Error("Paperless has no running, exact saved administrator project");
  }
  return status;
}

async function json(context: ReadContext, path: string, authorization: string,
  query?: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await context.http.request({ method: "GET", path, query,
    headers: { Authorization: authorization, Accept: "application/json" } });
  if (response.status !== 200 || !response.ok) throw new Error(`Paperless ${path} could not be verified`);
  try { return object(await response.json(), path); }
  catch { throw new Error(`Paperless ${path} returned invalid JSON`); }
}

async function admin(context: ReadContext, password: string): Promise<number> {
  if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) throw new Error("Paperless managed password is invalid");
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const users = await json(context, "/api/users/", authorization, { username: "admin", page_size: "2" });
  if (!Array.isArray(users.results)) throw new Error("Paperless administrator list is invalid");
  const matches = users.results.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const user = entry as Record<string, unknown>;
    return user.username === "admin" && Number.isSafeInteger(user.id)
      && Number(user.id) > 0 && user.is_superuser === true && user.is_active === true;
  }) as Record<string, unknown>[];
  if (matches.length !== 1) throw new Error("Paperless saved credentials did not prove one active superuser");
  return matches[0].id as number;
}

async function verifyToken(context: ReadContext, token: string, userId: number): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(token)) throw new Error("Paperless saved API token is invalid");
  const authorization = `Token ${token}`;
  const identity = await json(context, "/api/ui_settings/", authorization);
  const user = object(identity.user, "token identity");
  if (user.id !== userId || user.username !== "admin" || user.is_superuser !== true) {
    throw new Error("Paperless API token does not belong to the managed administrator");
  }
  const statistics = await json(context, "/api/statistics/", authorization);
  if (!Number.isSafeInteger(statistics.documents_total) || Number(statistics.documents_total) < 0
    || (statistics.documents_inbox !== null && (!Number.isSafeInteger(statistics.documents_inbox)
      || Number(statistics.documents_inbox) < 0))) {
    throw new Error("Paperless API token statistics readback is invalid");
  }
}

async function inspect(context: SetupInspectionContext): Promise<SetupRecord> {
  const status = exactStatus(context, await context.status());
  const userId = await admin(context, await context.secrets.readAdminPassword());
  const token = await context.secrets.readApiKey();
  const path = await context.secrets.apiKeyPath();
  if (token === null || path === null || !isAbsolute(path)) {
    throw new Error("Paperless administrator is verified but no saved API token is available");
  }
  await verifyToken(context, token, userId);
  return { appId: APP_ID, projectRoot: context.projectRoot,
    stage: "admin-and-api-token-verified", credentialRef: status.passwordFile, apiKeyFile: path };
}

async function standaloneFirstRun(context: SetupContext, status: SetupRecord): Promise<SetupRecord> {
  // Preserve the standalone CLI's exact plan, approval, readback, and recovery boundaries.
  const verified = setupRecord(await context.read("login-check"), "Paperless login check");
  if (verified.command !== "app login-check" || verified.appId !== context.appId
    || verified.status !== "admin-verified" || verified.mutation !== false
    || verified.loginVerified !== true || verified.acceptanceVerified !== false
    || verified.username !== status.username || verified.url !== status.url
    || !Number.isInteger(verified.userId) || Number(verified.userId) < 1) {
    throw new Error("Paperless did not verify its saved administrator");
  }
  const plan = setupRecord(await context.read("paperless-token-plan"), "Paperless token plan");
  if (plan.command !== "app paperless-token-plan" || plan.appId !== context.appId
    || plan.status !== "pass" || plan.mutation !== false || plan.adminVerified !== true) {
    throw new Error("Paperless did not return an exact private API-token plan");
  }
  const approval = statusApproval(plan, "paperlessTokenCreate");
  if (approval !== plan.approval) throw new Error("Paperless token approvals disagree");
  if (plan.alreadyPresent !== true) {
    const created = setupRecord(await context.apply("paperless-token-create", approval,
      "Acquire and verify the existing or first Paperless administrator API token without rotation"),
    "Paperless token creation");
    if (created.command !== "app paperless-token-create" || created.appId !== context.appId
      || created.status !== "token-created-and-verified" || created.apiVerified !== true
      || typeof created.apiKeyFile !== "string" || !isAbsolute(created.apiKeyFile)) {
      throw new Error("Paperless did not save and verify the exact API token");
    }
  }
  const token = setupRecord(await context.read("paperless-token-status"), "Paperless token status");
  if (token.command !== "app paperless-token-status" || token.appId !== context.appId
    || token.status !== "token-verified" || token.mutation !== false
    || token.adminVerified !== true || token.apiVerified !== true
    || typeof token.apiKeyFile !== "string" || !isAbsolute(token.apiKeyFile)) {
    throw new Error("Paperless API token did not pass read-only verification");
  }
  return { appId: context.appId, projectRoot: context.projectRoot,
    stage: "admin-and-api-token-verified", credentialRef: status.passwordFile,
    apiKeyFile: token.apiKeyFile };
}

const adapter: SetupAdapter = {
  appId: APP_ID, sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: "paperlessNgx",
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-and-api-token-verified"
      && typeof record.credentialRef === "string" && isAbsolute(record.credentialRef)
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  inspect,
  async firstRun(context: SetupContext) {
    if (context.appId !== APP_ID) throw new Error("Paperless setup received a different app ID");
    const applied = appliedStatus(context, await context.status());
    if (applied.ownerKind !== "shared") {
      if (applied.username !== "admin" || typeof applied.passwordFile !== "string"
        || !isAbsolute(applied.passwordFile) || typeof applied.url !== "string") {
        throw new Error("Paperless has no exact private-file administrator checkpoint");
      }
      return standaloneFirstRun(context, applied);
    }
    const status = exactStatus(context, applied);
    const userId = await admin(context, await context.secrets.readAdminPassword());
    const existing = await context.secrets.readApiKey();
    if (existing !== null) {
      await verifyToken(context, existing, userId);
      return inspect(context);
    }
    const prior = await context.checkpoint.read();
    if (prior !== null && (prior.appId !== APP_ID || prior.projectRoot !== context.projectRoot
      || prior.stage !== "token-request-attempted" || !prior.attemptedActions.includes(ATTEMPT)
      || prior.data.userId !== userId || prior.data.passwordFile !== status.passwordFile)) {
      throw new Error("Paperless token checkpoint differs from the saved administrator");
    }
    if (prior !== null) {
      throw new Error("Paperless token request was attempted without a saved token; inspect privately before retrying");
    }
    const password = await context.secrets.readAdminPassword();
    const response = await context.http.request({ method: "POST", path: "/api/token/",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password }),
      approval: { action: ATTEMPT, progress: "Acquire the existing or first Paperless administrator API token", once: true },
      beforeSendCheckpoint: { expectedRevision: null, stage: "token-request-attempted",
        data: { userId, passwordFile: status.passwordFile as string } },
    });
    if (response.status !== 200 || !response.ok) throw new Error("Paperless token endpoint did not return HTTP 200");
    let payload: Record<string, unknown>;
    try { payload = object(await response.json(), "token response"); }
    catch { throw new Error("Paperless token endpoint returned invalid JSON"); }
    if (typeof payload.token !== "string" || !/^[0-9a-f]{40}$/.test(payload.token)) {
      throw new Error("Paperless token endpoint returned an invalid token");
    }
    // Preserve the acquired token before a fallible readback. An attempted
    // acquisition cannot be replayed when the response secret was discarded.
    await context.secrets.writeApiKey(payload.token);
    await verifyToken(context, payload.token, userId);
    return inspect(context);
  },
};

export default adapter;
