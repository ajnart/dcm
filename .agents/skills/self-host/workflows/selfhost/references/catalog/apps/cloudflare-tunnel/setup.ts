import type { SetupAdapter } from "../../types/setup.ts";

const adapter: SetupAdapter = {
  appId: "cloudflare-tunnel", sharedOwner: true, credentialCommand: "app handoff", apiKey: "not-created",
  healthSource: "Native container-private edge readiness only; not intended client, Access or application acceptance",
  homarrIntegration: null,
  ready(record) { return record.appId === "cloudflare-tunnel" && record.stage === "edge-connected"
    && record.edgeConnected === true && record.intendedClientVerified === false; },
  async firstRun(context) {
    const result = await context.container.exec({ effect: "read",
      argv: ["cloudflared", "tunnel", "--metrics", "127.0.0.1:2000", "ready"],
      approval: { action: "cloudflare-native-ready", progress: "Check only private Cloudflare edge readiness" } });
    if (result.exitCode !== 0) throw new Error("Cloudflare edge connection is not ready; output withheld");
    return { appId: "cloudflare-tunnel", projectRoot: context.projectRoot,
      stage: "edge-connected", edgeConnected: true,
      intendedClientVerified: false, authenticationVerified: false, restartVerified: false,
      apiKeyCreated: false };
  },
};
export default adapter;
