import type { SharedPrestartAdapter } from "../../types/pre-start.ts";
import { requireCloudflarePublicExposure } from "../../../../../../../../../packages/cli/src/control-panel/setup-cloudflare-provider.ts";

const adapter: SharedPrestartAdapter = {
  appId: "cloudflare-tunnel",
  async verify(context) {
    if (!context.derived || !context.readCloudflareProvider) throw new Error("Cloudflare retained owner prerequisite is unavailable");
    await requireCloudflarePublicExposure(context.state, context.revalidate);
  },
};
export default adapter;
