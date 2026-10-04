import {
  appliedStatus,
  type SetupAdapter,
  type SetupContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "node-red";

async function probe(context: SetupContext): Promise<SetupRecord> {
  const scheme = await context.http.request({ method: "GET", path: "/auth/login" });
  if (scheme.status !== 200) throw new Error("Node-RED authentication scheme is unavailable");
  const login = await scheme.json();
  if (!login || typeof login !== "object" || Array.isArray(login)
    || (login as Record<string, unknown>).type !== "credentials") {
    throw new Error("Node-RED editor authentication is not enabled");
  }
  const anonymous = await context.http.request({ method: "GET", path: "/flows" });
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error("Node-RED did not deny anonymous administrator flow access");
  }

  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Node-RED has no valid saved administrator password");
  }
  const issued = await context.http.request({
    method: "POST",
    path: "/auth/token",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: "node-red-admin", grant_type: "password", scope: "*", username: "admin", password }),
    approval: { action: "node-red-verify-admin-login", progress: "Verify the saved Node-RED administrator on the exact private origin" },
  });
  if (issued.status !== 200) throw new Error("Node-RED rejected the saved administrator credential");
  const response = await issued.json();
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Node-RED returned an invalid authentication response");
  }
  const token = (response as Record<string, unknown>).access_token;
  if (typeof token !== "string" || !token || token.length > 16384 || /[\r\n\u0000]/.test(token)
    || (response as Record<string, unknown>).token_type !== "Bearer"
    || !Number.isFinite((response as Record<string, unknown>).expires_in)
    || Number((response as Record<string, unknown>).expires_in) <= 0) {
    throw new Error("Node-RED did not issue an expiring Bearer token");
  }
  const flows = await context.http.request({
    method: "GET", path: "/flows", headers: { Authorization: `Bearer ${token}` },
  });
  if (flows.status !== 200 || !Array.isArray(await flows.json())) {
    throw new Error("Node-RED did not authorize administrator flow readback");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-auth-verified", adminUsername: "admin",
    anonymousAdminAccessDenied: true, durableApiKey: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  async firstRun(context: SetupContext): Promise<SetupRecord> {
    appliedStatus(context, await context.status());
    return probe(context);
  },
  ready(status): boolean {
    return status.appId === APP_ID && status.stage === "admin-auth-verified" && status.adminUsername === "admin"
      && status.anonymousAdminAccessDenied === true;
  },
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: null,
};

export default adapter;
