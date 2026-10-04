import { appliedStatus, type SetupAdapter, type SetupContext, type SetupInspectionContext } from "../../types/setup";

const APP_ID = "caddy";

async function verify(context: SetupContext | SetupInspectionContext) {
  if (context.appId !== APP_ID) throw new Error("Caddy setup received a different app ID");
  const status = appliedStatus(context as SetupContext, await context.status());
  if (status.privateHttps) {
    throw new Error("Generated Caddy needs its separately approved TLS/CA proof; the HTTP readiness adapter cannot verify HTTPS routes");
  }
  const response = await context.http.request({ method: "GET", path: "/health" });
  if (response.status !== 200 || !response.ok) throw new Error("Caddy's private readiness endpoint is unavailable");
  return { appId: APP_ID, projectRoot: context.projectRoot, stage: "private-health-ready", ingressVerified: false };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  sharedOwner: true,
  credentialCommand: "app handoff",
  apiKey: "not-created",
  healthSource: "GET /health (loopback-only Caddy readiness route)",
  homarrIntegration: null,
  ready(record) {
    return record.appId === APP_ID && record.stage === "private-health-ready"
      && record.ingressVerified === false;
  },
  firstRun: verify,
  inspect: verify,
};

export default adapter;
