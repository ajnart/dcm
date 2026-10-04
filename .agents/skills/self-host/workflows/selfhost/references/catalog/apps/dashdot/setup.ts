import { createNoAccountReadOnlyAdapter } from "../../shared/no-account-get";
import { inspectDashdotApi } from "./inspection";

export default createNoAccountReadOnlyAdapter({
  appId: "dashdot",
  sharedOwner: true,
  stage: "cpu-ram-api-ready",
  healthSource: "GET /config, /info, /load/cpu, /load/ram (kernel-visible CPU/RAM only)",
  // Full Homarr health/disk coverage is not offered by this deliberately narrow profile.
  homarrIntegration: null,
  recordFields: {
    metricsScope: "kernel-visible-cpu-ram",
    visibleMetricsVerified: true,
    hostMetricsVerified: false,
    homarrVerified: false,
  },
  async verify(context) {
    await inspectDashdotApi(context, { boundedProfile: true });
  },
});
