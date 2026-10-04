import { Buffer } from "node:buffer";
import { isAbsolute } from "node:path";

import { type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "transmission";
const VERSION = "4.1.3";
const RPC_PATH = "/transmission/rpc";
type ReadContext = SetupContext;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

async function exactStatus(context: ReadContext): Promise<Record<string, unknown>> {
  if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
    throw new Error("Transmission setup received a different app project");
  }
  const status = object(await context.status(), "Transmission app status");
  const runtime = object(status.runtime, "Transmission runtime status");
  const port = status.port;
  if (status.command !== "app status" || status.appId !== APP_ID
    || status.projectRoot !== context.projectRoot || status.status !== "applied"
    || status.mutation !== false || runtime.state !== "running"
    || status.username !== "admin" || !Number.isSafeInteger(port)
    || Number(port) < 1 || Number(port) > 65535
    || status.url !== `http://127.0.0.1:${port}`
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Transmission has no running, exact saved administrator project");
  }
  return status;
}

async function verify(context: ReadContext): Promise<SetupRecord> {
  const status = await exactStatus(context);
  const password = await context.secrets.readAdminPassword();
  if (password.length < 32 || password.length > 128 || /[\r\n\u0000]/.test(password)) {
    throw new Error("Transmission has no valid saved administrator password");
  }
  const body = JSON.stringify({ jsonrpc: "2.0", method: "session_get", params: { fields: ["version"] }, id: 1 });
  const approval = { action: "transmission-verify-rpc-read",
    progress: "Verify the saved Transmission administrator through read-only RPC" };
  const unauthenticated = await context.http.request({ method: "POST", path: RPC_PATH, body,
    headers: { "Content-Type": "application/json" }, approval });
  if (unauthenticated.status !== 401) {
    throw new Error("Transmission RPC did not reject an unauthenticated request");
  }
  const authorization = `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`;
  const headers = { Authorization: authorization, "Content-Type": "application/json" };
  let response = await context.http.request({ method: "POST", path: RPC_PATH, body, headers, approval });
  if (response.status === 409) {
    const sessionId = response.headers.get("x-transmission-session-id");
    if (!sessionId || sessionId.length > 512 || /[\r\n\u0000]/.test(sessionId)) {
      throw new Error("Transmission RPC returned no valid CSRF session ID");
    }
    response = await context.http.request({ method: "POST", path: RPC_PATH, body,
      headers: { ...headers, "X-Transmission-Session-Id": sessionId }, approval });
  }
  if (response.status !== 200 || !response.ok) {
    throw new Error("Transmission saved RPC credentials were not accepted");
  }
  const payload = object(await response.json(), "Transmission RPC response");
  const result = object(payload.result, "Transmission RPC result");
  if (payload.jsonrpc !== "2.0" || payload.id !== 1 || payload.error !== undefined
    || typeof result.version !== "string"
    || !(result.version === VERSION || result.version.startsWith(`${VERSION} `))) {
    throw new Error("Transmission RPC did not match the pinned version and session response");
  }
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-rpc-verified",
    adminUsername: "admin", passwordFile: status.passwordFile, rpcVersion: VERSION };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: null,
  homarrIntegration: "Transmission",
  ready(value) {
    return value.appId === APP_ID && value.stage === "admin-rpc-verified"
      && value.adminUsername === "admin" && value.rpcVersion === VERSION
      && typeof value.passwordFile === "string" && isAbsolute(value.passwordFile);
  },
  async firstRun(context: SetupContext) { return verify(context); },
};

export default adapter;
