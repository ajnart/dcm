import { createNoAccountReadOnlyAdapter } from "../../shared/no-account-get";
import { setupRecord } from "../../types/setup";

export default createNoAccountReadOnlyAdapter({
  appId: "netdata",
  sharedOwner: true,
  stage: "local-api-ready",
  healthSource: "GET /api/v1/info (container-local Agent only)",
  homarrIntegration: null,
  recordFields: { version: "v2.11.0" },
  async verify(context) {
    const response = await context.http.request({ method: "GET", path: "/api/v1/info" });
    if (response.status !== 200 || !response.ok) {
      throw new Error("Netdata local Agent API is unavailable");
    }
    const info = setupRecord(await response.json(), "Netdata Agent information");
    if (typeof info.version !== "string" || !/^v?2\.11\.0(?:$|[-+])/.test(info.version)) {
      throw new Error("Netdata Agent does not match the pinned v2.11.0 contract");
    }
  },
});
