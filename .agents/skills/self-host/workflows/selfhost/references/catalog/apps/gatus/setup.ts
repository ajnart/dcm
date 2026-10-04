import { createNoAccountGetAdapter } from "../../shared/no-account-get";

export default createNoAccountGetAdapter({
  appId: "gatus",
  path: "/health",
  stage: "private-health-ready",
  healthSource: "GET /health (Gatus service only)",
  homarrIntegration: null,
  recordFields: { monitoredServicesVerified: 0 },
});
