import { createNoAccountGetAdapter } from "../../shared/no-account-get";

export default createNoAccountGetAdapter({
  appId: "loki",
  path: "/ready",
  stage: "readiness-verified",
  healthSource: "GET /ready",
  homarrIntegration: null,
});
