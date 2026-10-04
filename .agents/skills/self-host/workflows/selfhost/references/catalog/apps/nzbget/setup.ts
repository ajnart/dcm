import { isAbsolute } from "node:path";

import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

// Official Docker README: NZBGET_USER/NZBGET_PASS. Official RPC API: /jsonrpc,
// HTTP Basic authentication, and the read-only version() method.
const APP_ID = "nzbget";
const VERSION = "26.3";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("NZBGet returned an invalid RPC response");
  }
  return value as Record<string, unknown>;
}

async function verify(context: SetupContext): Promise<SetupRecord> {
  if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
    throw new Error("NZBGet setup received a different app project");
  }
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 8192 || !/^[A-Za-z0-9]+$/.test(password)) {
    throw new Error("NZBGet has no valid generated administrator password");
  }
  const authorization = `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
  const body = JSON.stringify({ version: "1.1", method: "version", params: [], id: "auto-stack-version" });
  const anonymous = await context.http.request({ method: "POST", path: "/jsonrpc",
    headers: { "Content-Type": "application/json" }, body,
    approval: { action: "nzbget-deny-anonymous-version",
      progress: "Verify NZBGet RPC rejects an unauthenticated read-only version request" } });
  if (anonymous.status !== 401) {
    throw new Error("NZBGet RPC did not reject anonymous access with HTTP Basic authentication");
  }
  const response = await context.http.request({
    method: "POST",
    path: "/jsonrpc",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
    approval: { action: "nzbget-read-version", progress: "Read NZBGet's version via authenticated RPC on the exact private origin" },
  });
  if (response.status !== 200 || !response.ok) {
    throw new Error("NZBGet did not authorize its generated administrator credential");
  }
  const result = object(await response.json());
  if (result.id !== "auto-stack-version" || result.error !== null || result.result !== VERSION) {
    throw new Error("NZBGet's authenticated RPC version differs from the pinned image");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-rpc-verified",
    adminUsername: "admin", version: VERSION, provider: "owner-input-required", pathVerification: "pending" };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: "nzbGet",
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-rpc-verified"
      && record.adminUsername === "admin" && record.version === VERSION
      && record.provider === "owner-input-required" && record.pathVerification === "pending";
  },
  async firstRun(context) {
    appliedStatus(context, await context.status());
    return verify(context);
  },
};

export default adapter;
