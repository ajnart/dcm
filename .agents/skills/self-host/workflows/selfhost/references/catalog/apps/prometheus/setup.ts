import { createNoAccountReadOnlyAdapter } from "../../shared/no-account-get";
import { setupRecord } from "../../types/setup";

const VERSION = "3.15.0";

export default createNoAccountReadOnlyAdapter({
  appId: "prometheus",
  sharedOwner: true,
  stage: "ready",
  healthSource: "GET /-/ready",
  homarrIntegration: null,
  recordFields: { version: VERSION },
  async verify(context) {
    const ready = await context.http.request({ method: "GET", path: "/-/ready" });
    if (ready.status !== 200 || !ready.ok) {
      throw new Error("Prometheus is not ready to serve queries");
    }
    const response = await context.http.request({ method: "GET", path: "/api/v1/status/buildinfo" });
    if (response.status !== 200 || !response.ok) {
      throw new Error("Prometheus build information is unavailable");
    }
    const result = setupRecord(await response.json(), "Prometheus build information");
    const data = setupRecord(result.data, "Prometheus build information data");
    if (result.status !== "success" || data.version !== VERSION) {
      throw new Error("Prometheus does not match the pinned 3.15.0 API contract");
    }
  },
});
