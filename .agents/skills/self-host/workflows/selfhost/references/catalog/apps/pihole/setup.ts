import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "pihole";

async function verifyAdmin(context: SetupContext): Promise<SetupRecord> {
  const password = await context.secrets.readAdminPassword();
  // 48 bytes of entropy require 65 base-62 characters in the shared generator.
  if (!/^[A-Za-z0-9]{65}$/.test(password)) {
    throw new Error("Pi-hole has no valid generated administrator password");
  }

  // Pi-hole v6 has password-only login; never put a session ID in a URL or saved checkpoint.
  const login = await context.http.request({
    method: "POST",
    path: "/api/auth",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    approval: { action: "pihole-admin-login", progress: "Verify Pi-hole's generated web password on the private origin" },
  });
  if (login.status !== 200 || !login.ok) {
    throw new Error("Pi-hole did not authorize the generated web password");
  }
  const payload = await login.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Pi-hole returned an invalid session response");
  }
  const session = (payload as Record<string, unknown>).session;
  if (!session || typeof session !== "object" || Array.isArray(session)
    || (session as Record<string, unknown>).valid !== true
    || typeof (session as Record<string, unknown>).sid !== "string"
    || !(session as Record<string, unknown>).sid) {
    throw new Error("Pi-hole returned no authenticated session");
  }

  const version = await context.http.request({
    method: "GET",
    path: "/api/info/version",
    headers: { "X-FTL-SID": (session as Record<string, string>).sid },
  });
  if (version.status !== 200 || !version.ok) {
    throw new Error("Pi-hole did not accept the authenticated version readback");
  }
  const details = await version.json();
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Pi-hole returned invalid version data");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-login-verified",
    loginVia: "password-only", adminUsername: null, dnsPublished: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: "piHole",
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-login-verified"
      && record.loginVia === "password-only" && record.dnsPublished === false;
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Pi-hole setup received a different app ID");
    appliedStatus(context, await context.status());
    return verifyAdmin(context);
  },
};

export default adapter;
