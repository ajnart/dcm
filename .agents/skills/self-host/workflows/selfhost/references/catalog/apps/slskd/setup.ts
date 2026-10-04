import { isAbsolute } from "node:path";

import { generatedPrivateFileLength } from "../../types/private-file";
import { setupRecord, type SetupAdapter, type SetupContext,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup";

const APP_ID = "slskd";
const KEY_PATTERN = new RegExp(`^[A-Za-z0-9]{${generatedPrivateFileLength(48, "alphanumeric")}}$`);

function sharedStatus(context: SetupContext | SetupInspectionContext, value: unknown): SetupRecord {
  const status = setupRecord(value, "slskd shared status");
  const runtime = setupRecord(status.runtime, "slskd shared runtime");
  if (status.ownerKind !== "shared" || status.command !== "app status"
    || status.appId !== APP_ID || status.projectRoot !== context.projectRoot
    || status.status !== "applied" || status.mutation !== false
    || runtime.state !== "running" || typeof status.passwordFile !== "string"
    || !isAbsolute(status.passwordFile)) {
    throw new Error("slskd is not an exact running shared unit with a managed password");
  }
  return status;
}

async function verifyApiKey(context: SetupContext | SetupInspectionContext, key: string): Promise<void> {
  const enabled = await context.http.request({ method: "GET", path: "/api/v0/session/enabled" });
  if (enabled.status !== 200 || await enabled.json() !== true) {
    throw new Error("slskd authentication is not enabled");
  }
  const session = await context.http.request({ method: "GET", path: "/api/v0/session",
    headers: { "X-API-Key": key } });
  if (session.status !== 200) throw new Error("slskd rejected the saved primary API key");
}

async function verifyPassword(context: SetupContext, password: string): Promise<void> {
  const login = await context.http.request({ method: "POST", path: "/api/v0/session",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
    approval: { action: "slskd-verify-admin-login",
      progress: "Verify the saved slskd administrator login on this private shared unit" } });
  if (login.status !== 200) throw new Error("slskd rejected the saved administrator password");
  const result = setupRecord(await login.json(), "slskd login response");
  if (result.name !== "admin" || typeof result.token !== "string"
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.token)) {
    throw new Error("slskd did not return an administrator token");
  }
  const session = await context.http.request({ method: "GET", path: "/api/v0/session",
    headers: { Authorization: `Bearer ${result.token}` } });
  if (session.status !== 200) throw new Error("slskd administrator token failed session readback");
}

function record(context: SetupContext | SetupInspectionContext, status: SetupRecord,
  apiKeyFile: string, loginVerified: boolean): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "login-verified",
    username: "admin", passwordFile: status.passwordFile, apiKeyFile,
    loginVerified, apiVerified: true };
}

async function inspect(context: SetupInspectionContext): Promise<SetupRecord> {
  const status = sharedStatus(context, await context.status());
  const key = await context.secrets.readApiKey();
  const path = await context.secrets.apiKeyPath();
  if (typeof key !== "string" || !KEY_PATTERN.test(key)
    || typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("slskd has no matching private primary API key");
  }
  const checkpoint = await context.checkpoint.read();
  if (checkpoint?.stage !== "login-verified"
    || checkpoint.data.passwordFile !== status.passwordFile
    || checkpoint.data.apiKeyFile !== path) {
    throw new Error("slskd has no matching saved login verification");
  }
  await verifyApiKey(context, key);
  // The checkpoint records a past login; an independent API key cannot recheck it.
  return record(context, status, path, false);
}

async function firstRun(context: SetupContext): Promise<SetupRecord> {
  const status = sharedStatus(context, await context.status());
  const key = await context.secrets.readApiKey();
  const path = await context.secrets.apiKeyPath();
  if (typeof key !== "string" || !KEY_PATTERN.test(key)
    || typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("slskd has no generated private primary API key");
  }
  const password = await context.secrets.readAdminPassword();
  if (!KEY_PATTERN.test(password)) throw new Error("slskd generated administrator password is invalid");
  await verifyApiKey(context, key);
  await verifyPassword(context, password);
  const checkpoint = await context.checkpoint.read();
  if (checkpoint && (checkpoint.stage !== "login-verified"
    || checkpoint.data.passwordFile !== status.passwordFile
    || checkpoint.data.apiKeyFile !== path)) {
    throw new Error("slskd setup checkpoint differs; inspect before continuing");
  }
  if (!checkpoint) {
    await context.checkpoint.compareAndSet({ expectedRevision: null,
      stage: "login-verified", data: { passwordFile: status.passwordFile as string,
        apiKeyFile: path } });
  }
  return record(context, status, path, true);
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  firstRun,
  inspect,
  ready(value) {
    return value.stage === "login-verified" && value.loginVerified === true
      && value.apiVerified === true && value.username === "admin"
      && typeof value.passwordFile === "string" && isAbsolute(value.passwordFile)
      && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile);
  },
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: "/api/v0/session",
  homarrIntegration: "Slskd",
};

export default adapter;
