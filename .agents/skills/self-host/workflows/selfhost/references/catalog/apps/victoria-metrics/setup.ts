import { createNoAccountReadOnlyAdapter } from "../../shared/no-account-get";
import { setupRecord, type SetupInspectionContext } from "../../types/setup";

const APP_ID = "victoria-metrics";
const VERSION = "1.153.0";

async function inspect(context: SetupInspectionContext): Promise<void> {
  const health = await context.http.request({ method: "GET", path: "/health" });
  if (health.status !== 200 || !health.ok) throw new Error("VictoriaMetrics single-node health check failed");

  // The Prometheus-compatible buildinfo route reports 2.24.0, not the VM version.
  const response = await context.http.request({ method: "GET", path: "/vmui/config.json" });
  if (response.status !== 200 || !response.ok) throw new Error("VictoriaMetrics build information is unavailable");
  const body = setupRecord(await response.json(), "VictoriaMetrics build information");
  if (body.version !== `v${VERSION}`) {
    throw new Error("VictoriaMetrics is not the pinned single-node version");
  }
}

export const setup = createNoAccountReadOnlyAdapter({
  appId: APP_ID,
  sharedOwner: true,
  stage: "health-and-version-verified",
  recordFields: { version: VERSION, healthVerified: true },
  verify: inspect,
  healthSource: "/health and /vmui/config.json",
  homarrIntegration: null,
});

export default setup;
