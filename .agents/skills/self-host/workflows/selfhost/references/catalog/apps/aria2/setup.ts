import { isAbsolute } from "node:path";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupContext } from "../../types/setup";

const VERSION = "1.37.0";
const DOWNLOADS = "/var/lib/aria2/downloads";

async function rpc(context: SetupContext, method: string, params: string[], expectedStatus = 200) {
  const response = await context.http.request({
    method: "POST", path: "/jsonrpc",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    approval: { action: "aria2-verify-rpc-read", progress: "Verify private aria2 token and download options through read-only RPC" },
  });
  if (response.status !== expectedStatus) {
    throw new Error("aria2 RPC did not return the documented response");
  }
  const payload = setupRecord(await response.json(), "aria2 RPC");
  if (payload.jsonrpc !== "2.0" || payload.id !== 1) {
    throw new Error("aria2 RPC response identity is invalid");
  }
  return payload;
}

const adapter: SetupAdapter = {
  appId: "aria2", credentialCommand: "app handoff", apiKey: "saved-by-onboarding",
  healthSource: null, homarrIntegration: "Aria2",
  ready(value) {
    return value.appId === "aria2" && value.stage === "rpc-token-verified"
      && value.rpcVersion === VERSION && value.downloadDirectory === DOWNLOADS
      && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== "aria2" || !isAbsolute(context.projectRoot)) {
      throw new Error("aria2 setup received a different project");
    }
    const status = appliedStatus(context, await context.status());
    if (!Number.isSafeInteger(status.port) || Number(status.port) < 1 || Number(status.port) > 65535
      || status.url !== `http://127.0.0.1:${status.port}`) {
      throw new Error("aria2 setup requires the exact private loopback origin");
    }
    const token = await context.secrets.readGeneratedApiToken();
    if (!/^[A-Za-z0-9]{32,128}$/.test(token)) {
      throw new Error("aria2 has no valid saved generated RPC token");
    }
    const denied = await rpc(context, "aria2.getVersion", [], 400);
    const error = setupRecord(denied.error, "aria2 authentication denial");
    if (error.code !== 1 || error.message !== "Unauthorized" || denied.result !== undefined) {
      throw new Error("aria2 accepted or did not explicitly reject unauthenticated RPC");
    }
    const version = await rpc(context, "aria2.getVersion", [`token:${token}`]);
    const result = setupRecord(version.result, "aria2 version");
    if (version.error !== undefined || result.version !== VERSION) {
      throw new Error("aria2 token or pinned RPC version verification failed");
    }
    const options = await rpc(context, "aria2.getGlobalOption", [`token:${token}`]);
    const values = setupRecord(options.result, "aria2 global options");
    if (options.error !== undefined || values.dir !== DOWNLOADS) {
      throw new Error("aria2 download directory is not the owned recipe mount");
    }
    const apiKeyFile = await context.secrets.writeApiKey(token);
    return { appId: "aria2", projectRoot: context.projectRoot, stage: "rpc-token-verified",
      rpcVersion: VERSION, downloadDirectory: DOWNLOADS, apiKeyFile };
  },
};

export default adapter;
