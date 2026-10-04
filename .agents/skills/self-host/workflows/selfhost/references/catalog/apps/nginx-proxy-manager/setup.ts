import { appliedStatus, setupRecord, type SetupAdapter } from "../../types/setup";

const APP_ID = "nginx-proxy-manager";
const ADMIN_EMAIL = "admin@example.test";
const CREATE_ACTION = "npm-create-first-admin";

async function configured(context: Parameters<SetupAdapter["firstRun"]>[0]): Promise<boolean> {
  const response = await context.http.request({ method: "GET", path: "/api" });
  if (response.status !== 200 || !response.ok) throw new Error("Nginx Proxy Manager setup status is unavailable");
  const result = setupRecord(await response.json(), "Nginx Proxy Manager setup status");
  const version = setupRecord(result.version, "Nginx Proxy Manager version");
  if (result.status !== "OK" || typeof result.setup !== "boolean"
    || version.major !== 2 || version.minor !== 16 || version.revision !== 0) {
    throw new Error("Nginx Proxy Manager did not report the pinned setup contract");
  }
  return result.setup;
}

// Routes and response fields are pinned to the official v2.16.0 API schema:
// https://github.com/NginxProxyManager/nginx-proxy-manager/tree/v2.16.0/backend/schema
const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-verified"
      && record.adminEmail === ADMIN_EMAIL && record.adminRole === "admin"
      && Number.isSafeInteger(record.adminId) && (record.adminId as number) > 0
      && record.ingressVerified === false;
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Nginx Proxy Manager setup received a different app ID");
    appliedStatus(context, await context.status());
    const password = await context.secrets.readAdminPassword();
    if (password.length < 1 || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
      throw new Error("Nginx Proxy Manager has no valid saved administrator password");
    }

    const saved = await context.checkpoint.read();
    if (saved && (saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot
      || !["first-admin-create-attempted", "admin-verified"].includes(saved.stage)
      || !saved.attemptedActions.includes(CREATE_ACTION))) {
      throw new Error("Nginx Proxy Manager setup checkpoint is unexpected");
    }
    if (!(await configured(context))) {
      if (saved) {
        throw new Error("Nginx Proxy Manager administrator creation was attempted but setup is incomplete; inspect without replaying");
      }
      const response = await context.http.request({
        method: "POST", path: "/api/users",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Administrator", nickname: "Admin", email: ADMIN_EMAIL,
          auth: { type: "password", secret: password } }),
        approval: { action: CREATE_ACTION, once: true,
          progress: "Create the first Nginx Proxy Manager administrator on this exact private server" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "first-admin-create-attempted" },
      });
      if (response.status !== 201 || !response.ok) {
        throw new Error("Nginx Proxy Manager administrator creation has an uncertain outcome; inspect without replaying");
      }
      if (!(await configured(context))) throw new Error("Nginx Proxy Manager still reports incomplete setup");
    } else if (!saved) {
      throw new Error("Nginx Proxy Manager already has an unowned account; do not adopt it blindly");
    }

    let token: string;
    let adminId: number;
    const loginResponse = await context.http.request({
      method: "POST",
      path: "/api/tokens",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: ADMIN_EMAIL, secret: password }),
      approval: { action: "npm-verify-admin", progress: "Verify the saved Nginx Proxy Manager administrator login" },
    });
    try {
      if (loginResponse.status !== 200 || !loginResponse.ok) throw new Error("login rejected");
      const result = setupRecord(await loginResponse.json(), "Nginx Proxy Manager token response");
      if (typeof result.token !== "string" || result.token.length < 1 || result.token.length > 8192
        || /[\r\n\u0000]/.test(result.token)) {
        throw new Error("token challenge or invalid token");
      }
      token = result.token;
    } catch {
      throw new Error("Nginx Proxy Manager administrator login could not be verified; a 2FA challenge needs manual completion");
    }

    const identityResponse = await context.http.request({
      method: "GET",
      path: "/api/users/me",
      headers: { Authorization: `Bearer ${token}` },
    });
    try {
      if (identityResponse.status !== 200 || !identityResponse.ok) throw new Error("identity rejected");
      const user = setupRecord(await identityResponse.json(), "Nginx Proxy Manager user response");
      if (user.email !== ADMIN_EMAIL || !Array.isArray(user.roles) || !user.roles.includes("admin")
        || user.is_disabled !== false || !Number.isSafeInteger(user.id) || (user.id as number) < 1
        || (saved?.stage === "admin-verified" && saved.data.adminId !== user.id)) {
        throw new Error("unexpected administrator identity");
      }
      adminId = user.id as number;
    } catch {
      throw new Error("The saved Nginx Proxy Manager account is not a verified, enabled administrator");
    }

    const current = await context.checkpoint.read();
    if (!current || current.appId !== APP_ID || current.projectRoot !== context.projectRoot
      || !current.attemptedActions.includes(CREATE_ACTION)) {
      throw new Error("Nginx Proxy Manager has no trusted creation checkpoint");
    }
    if (current.stage !== "admin-verified") {
      await context.checkpoint.compareAndSet({ expectedRevision: current.revision,
        stage: "admin-verified", data: { adminId } });
    }

    // A login bearer token is neither a durable API key nor a saved setup artifact.
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-verified",
      adminEmail: ADMIN_EMAIL, adminRole: "admin", adminId, ingressVerified: false };
  },
};

export default adapter;
