import { createNoAccountReadOnlyAdapter } from "../../shared/no-account-get";

const adapter = createNoAccountReadOnlyAdapter({
  appId: "vector",
  sharedOwner: true,
  stage: "private-health-ready",
  healthSource: "GET /health (Vector service only)",
  homarrIntegration: null,
  recordFields: { realTelemetryVerified: false },
  async verify(context) {
    const response = await context.http.request({ method: "GET", path: "/health" });
    if (response.status !== 200 || !response.ok) throw new Error("Vector private health endpoint is unavailable");
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)
      || (value as Record<string, unknown>).ok !== true) {
      throw new Error("Vector private health endpoint did not report serving");
    }
  },
});

export default adapter;
