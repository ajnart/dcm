import { isAbsolute } from "node:path";

import { setupRecord, type SetupAdapter, type SetupContext,
  type SetupInspectionContext, type SetupRecord } from "../../types/setup";

const APP_ID = "peanut";
const USERNAME = "admin";
const INFO_PATH = "/api/v1/info";

function exactStatus(context: SetupContext | SetupInspectionContext, value: unknown): SetupRecord {
  const status = setupRecord(value, "PeaNUT shared status");
  const runtime = setupRecord(status.runtime, "PeaNUT shared runtime");
  if (status.ownerKind !== "shared" || status.command !== "app status"
    || status.appId !== APP_ID || status.projectRoot !== context.projectRoot
    || status.status !== "applied" || status.mutation !== false
    || runtime.state !== "running" || typeof status.passwordFile !== "string"
    || !isAbsolute(status.passwordFile)) {
    throw new Error("PeaNUT is not an exact running shared unit with a managed password");
  }
  return status;
}

async function verify(context: SetupContext | SetupInspectionContext, status: SetupRecord): Promise<SetupRecord> {
  const password = await context.secrets.readAdminPassword();
  if (!/^[A-Za-z0-9]{65}$/.test(password)) throw new Error("PeaNUT has no valid generated administrator password");
  const anonymous = await context.http.request({ method: "GET", path: INFO_PATH });
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error("PeaNUT's private information API did not reject anonymous access");
  }
  const wrong = Buffer.from(`${USERNAME}:not-the-generated-password`).toString("base64");
  const rejected = await context.http.request({ method: "GET", path: INFO_PATH,
    headers: { Authorization: `Basic ${wrong}` } });
  if (rejected.status !== 401 && rejected.status !== 403) {
    throw new Error("PeaNUT's private information API did not reject an incorrect password");
  }
  const encoded = Buffer.from(`${USERNAME}:${password}`).toString("base64");
  const authenticated = await context.http.request({ method: "GET", path: INFO_PATH,
    headers: { Authorization: `Basic ${encoded}` } });
  if (authenticated.status !== 200) throw new Error("PeaNUT rejected the generated administrator credential");
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-auth-verified",
    username: USERNAME, passwordFile: status.passwordFile, loginVerified: true,
    nutMonitoringVerified: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "GET /api/v1/info (authenticated dashboard only)",
  homarrIntegration: "PeaNUT",
  ready(value) {
    return value.appId === APP_ID && value.stage === "admin-auth-verified"
      && value.username === USERNAME && value.loginVerified === true
      && value.nutMonitoringVerified === false && typeof value.passwordFile === "string"
      && isAbsolute(value.passwordFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("PeaNUT setup received a different app ID");
    return verify(context, exactStatus(context, await context.status()));
  },
  async inspect(context) {
    if (context.appId !== APP_ID) throw new Error("PeaNUT inspection received a different app ID");
    return verify(context, exactStatus(context, await context.status()));
  },
};

export default adapter;
