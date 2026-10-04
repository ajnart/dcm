import type { SetupAdapter } from "../../types/setup.ts";
import { runSharedTailscaleSetup } from "../../../../../../../../../packages/cli/src/lib/shared-tailscale-connector.ts";

const adapter: SetupAdapter = {
  appId: "tailscale",
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "Private CLI node, preferences and exact Serve configuration readback; not client or ACL acceptance",
  homarrIntegration: null,
  inputDefinitions: [
    { key: "target-app-id", label: "Saved frontend app to expose privately" },
    { key: "tailnet-domain", label: "Expected private tailnet domain (for example tail-example.ts.net)" },
    { key: "acl-owner", label: "Tailnet ACL owner identifier" },
    { key: "https-port", label: "Private tailnet HTTPS port (443 or a high port)" },
  ],
  ready(record) {
    return record.appId === "tailscale" && record.stage === "private-serve-configured"
      && record.enrollmentVerified === true && record.serveConfigurationVerified === true
      && record.clientAccessVerified === false && record.aclVerified === false
      && record.internetRouteAbsent === false && record.restartIdentityVerified === false;
  },
  firstRun: runSharedTailscaleSetup,
};

export default adapter;
