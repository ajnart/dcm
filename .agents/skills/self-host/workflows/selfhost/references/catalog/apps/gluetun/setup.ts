import { isAbsolute } from "node:path";
import { appliedStatus, type SetupAdapter } from "../../types/setup.ts";
import { verifyGluetunControl } from "./control.ts";

const adapter: SetupAdapter = {
  appId: "gluetun", credentialCommand: "app handoff", apiKey: "saved-by-onboarding",
  healthSource: null, homarrIntegration: "Gluetun",
  ready(record) {
    return record.appId === "gluetun" && record.stage === "vpn-control-authenticated"
      && record.controlAuthenticationVerified === true && record.vpnStatus === "running"
      && typeof record.apiKeyFile === "string" && isAbsolute(record.apiKeyFile);
  },
  async firstRun(context) {
    const status = appliedStatus(context, await context.status());
    if (context.appId !== "gluetun" || !isAbsolute(context.projectRoot)
      || !Number.isSafeInteger(status.port) || Number(status.port) < 1 || Number(status.port) > 65535
      || status.url !== `http://127.0.0.1:${status.port}`) {
      throw new Error("Gluetun requires its exact saved loopback control origin");
    }
    const apiKey = await context.secrets.readGeneratedApiToken();
    const result = await verifyGluetunControl(context.http, apiKey);
    if (result.vpnStatus !== "running") throw new Error("Gluetun control authenticated but the VPN is not running");
    const apiKeyFile = await context.secrets.writeApiKey(apiKey);
    // Setup readiness is control-only. Keep broader VPN safety claims false.
    const { ready: _ready, ...verification } = result;
    return { ...verification, appId: "gluetun", projectRoot: context.projectRoot,
      stage: "vpn-control-authenticated", apiKeyFile, readinessScope: "authenticated-running-vpn-control-only" };
  },
};

export default adapter;
