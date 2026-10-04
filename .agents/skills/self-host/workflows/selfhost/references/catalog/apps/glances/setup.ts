import { createNoAccountReadOnlyAdapter } from "../../shared/no-account-get";

export default createNoAccountReadOnlyAdapter({
  appId: "glances",
  sharedOwner: true,
  stage: "local-api-ready",
  healthSource: "GET /api/4/status (container-local API only)",
  homarrIntegration: null,
  async verify(context) {
    const response = await context.http.request({ method: "GET", path: "/api/4/status" });
    if (response.status !== 200 || !response.ok) {
      throw new Error("Glances local API status is unavailable");
    }
  },
});
