import { isAbsolute } from "node:path";

import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "actual-budget";
const VERSION = "26.9.0";

async function body(response: { json(): Promise<unknown> }, label: string): Promise<SetupRecord> {
  return setupRecord(await response.json(), label);
}

async function bootstrapped(context: SetupContext): Promise<boolean> {
  const response = await context.http.request({ method: "GET", path: "/account/needs-bootstrap" });
  if (response.status !== 200) throw new Error("Actual Budget bootstrap state is unavailable");
  const result = await body(response, "Actual Budget bootstrap state");
  const data = setupRecord(result.data, "Actual Budget bootstrap data");
  if (result.status !== "ok" || typeof data.bootstrapped !== "boolean") {
    throw new Error("Actual Budget bootstrap state is invalid");
  }
  return data.bootstrapped;
}

async function verifyPassword(context: SetupContext, password: string): Promise<void> {
  const response = await context.http.request({
    method: "POST", path: "/account/login", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    approval: { action: "actual-budget-verify-login", progress: "Verify the saved Actual Budget server password" },
  });
  if (response.status !== 200) throw new Error("Actual Budget saved password did not authenticate");
  const login = await body(response, "Actual Budget login");
  const loginData = setupRecord(login.data, "Actual Budget login data");
  if (login.status !== "ok" || typeof loginData.token !== "string" || loginData.token.length < 1) {
    throw new Error("Actual Budget login returned no valid session");
  }
  const validation = await context.http.request({
    method: "GET", path: "/account/validate", headers: { "x-actual-token": loginData.token },
  });
  if (validation.status !== 200) throw new Error("Actual Budget administrator session could not be validated");
  const verified = await body(validation, "Actual Budget session validation");
  const data = setupRecord(verified.data, "Actual Budget validated user");
  if (verified.status !== "ok" || data.validated !== true || data.permission !== "ADMIN"
    || data.userName !== "" || data.loginMethod !== "password") {
    throw new Error("Actual Budget password did not authenticate the expected server owner");
  }
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
  ready(value) {
    return value.appId === APP_ID && value.stage === "password-login-verified"
      && value.version === VERSION && value.adminUsername === null
      && typeof value.credentialRef === "string" && isAbsolute(value.credentialRef);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Actual Budget setup received another app ID");
    const status = appliedStatus(context, await context.status());
    if (status.username !== null || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
      throw new Error("Actual Budget has no exact saved password-only credential");
    }
    const password = await context.secrets.readAdminPassword();
    if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Actual Budget saved server password is invalid");
    }
    const checkpoint = await context.checkpoint.read();
    if (checkpoint && (checkpoint.appId !== APP_ID || checkpoint.projectRoot !== context.projectRoot
      || !["bootstrap-attempted", "password-login-verified"].includes(checkpoint.stage))) {
      throw new Error("Actual Budget setup checkpoint is unexpected");
    }
    const initialized = await bootstrapped(context);
    if (!initialized) {
      if (checkpoint) throw new Error("Actual Budget bootstrap was attempted but is incomplete; inspect before retrying");
      const response = await context.http.request({
        method: "POST", path: "/account/bootstrap", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        approval: { action: "actual-budget-bootstrap-password", once: true,
          progress: "Set the first Actual Budget server password on this private instance" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "bootstrap-attempted" },
      });
      if (response.status !== 200) throw new Error("Actual Budget bootstrap outcome is uncertain; inspect before retrying");
      const result = await body(response, "Actual Budget bootstrap result");
      if (result.status !== "ok") throw new Error("Actual Budget bootstrap outcome is uncertain; inspect before retrying");
    } else if (!checkpoint) {
      throw new Error("Actual Budget is already bootstrapped outside this setup; do not adopt it blindly");
    }
    if (!(await bootstrapped(context))) throw new Error("Actual Budget still needs bootstrap");
    await verifyPassword(context, password);
    const current = await context.checkpoint.read();
    if (!current || current.appId !== APP_ID || current.projectRoot !== context.projectRoot) {
      throw new Error("Actual Budget has no trusted bootstrap checkpoint");
    }
    if (current.stage !== "password-login-verified") {
      await context.checkpoint.compareAndSet({ expectedRevision: current.revision, stage: "password-login-verified" });
    }
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "password-login-verified",
      version: VERSION, adminUsername: null, credentialRef: status.passwordFile };
  },
};

export default adapter;
