import { isAbsolute } from "node:path";

import { appliedStatus, setupRecord, type SetupAdapter, type SetupInspectionContext } from "../../types/setup";

// v0.23.1: cli/command_server.go binds KOPIA_SERVER_USERNAME/PASSWORD to Basic auth;
// internal/server/server.go exposes current-user even before repository connection.
// This verifies UI access only. It does not create a repository or an API key.
const APP_ID = "kopia";
const USERNAME = "admin";
const CURRENT_USER_PATH = "/api/v1/current-user";
const BASIC_CHALLENGE = 'Basic realm="Kopia"';

type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "secrets">;

async function verifyAdmin(context: ReadContext): Promise<void> {
  const anonymous = await context.http.request({ method: "GET", path: CURRENT_USER_PATH });
  if (anonymous.status !== 401 || anonymous.headers.get("www-authenticate") !== BASIC_CHALLENGE) {
    throw new Error("Kopia did not reject unauthenticated UI access");
  }

  const password = await context.secrets.readAdminPassword();
  if (password.length < 1 || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Kopia has no valid saved administrator password");
  }
  const wrong = await context.http.request({
    method: "GET", path: CURRENT_USER_PATH,
    headers: { Authorization: `Basic ${Buffer.from(`${USERNAME}:wrong-${password}`, "utf8").toString("base64")}` },
  });
  if (wrong.status !== 401 || wrong.headers.get("www-authenticate") !== BASIC_CHALLENGE) {
    throw new Error("Kopia did not reject an incorrect administrator password");
  }
  const authorization = Buffer.from(`${USERNAME}:${password}`, "utf8").toString("base64");
  const authenticated = await context.http.request({
    method: "GET",
    path: CURRENT_USER_PATH,
    headers: { Authorization: `Basic ${authorization}` },
  });
  if (authenticated.status !== 200 || !authenticated.ok) {
    throw new Error("Kopia did not verify the saved administrator credential");
  }
  const identity = setupRecord(await authenticated.json(), "Kopia current-user response");
  // This endpoint reports the backup process identity, not the Basic-auth UI username.
  // Do not require "admin" or infer a connected repository from these fields.
  for (const key of ["username", "hostname"]) {
    if (typeof identity[key] !== "string" || identity[key].length < 1
      || identity[key].length > 256 || /[\u0000-\u001f\u007f]/.test(identity[key])) {
      throw new Error("Kopia did not return its documented current-user response");
    }
  }
}

async function verify(context: ReadContext) {
  if (context.appId !== APP_ID) throw new Error("Kopia setup received a different app ID");
  const status = appliedStatus(context, await context.status());
  if (status.username !== USERNAME || typeof status.passwordFile !== "string"
    || !isAbsolute(status.passwordFile)) {
    throw new Error("Kopia has no exact private-file administrator checkpoint");
  }
  await verifyAdmin(context);
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-verified",
    username: USERNAME, credentialRef: status.passwordFile,
    repositoryVerified: false, backupVerified: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-verified"
      && record.username === USERNAME && typeof record.credentialRef === "string"
      && isAbsolute(record.credentialRef) && record.repositoryVerified === false
      && record.backupVerified === false;
  },
  firstRun: verify,
  inspect: verify,
};

export default adapter;
