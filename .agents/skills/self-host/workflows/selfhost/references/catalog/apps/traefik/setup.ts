import { Buffer } from "node:buffer";
import { appliedStatus, setupRecord, type SetupAdapter, type SetupInspectionContext } from "../../types/setup";
import recipe from "./recipe.json";

// The fixed secret-env onboarding identity is Basic middleware control access,
// not a Traefik user database or a first-owner creation operation.

export const TRAEFIK_API_PATHS = ["/api/version", "/api/entrypoints", "/api/http/routers", "/api/http/services",
  "/api/http/middlewares", "/api/tcp/routers", "/api/tcp/services", "/api/tcp/middlewares",
  "/api/udp/routers", "/api/udp/services"] as const;
export const TRAEFIK_API_RULE = "Method(`GET`) && (" + TRAEFIK_API_PATHS.map((path) => `Path(\`${path}\`)`).join(" || ") + ")";

async function verify(context: SetupInspectionContext) {
  if (context.appId !== "traefik") throw new Error("Traefik setup needs its exact app owner");
  const status = appliedStatus(context, await context.status());
  if (status.username !== "admin" || typeof status.passwordFile !== "string") {
    throw new Error("Traefik saved control-interface credential is unavailable; old ping-only owners require a reviewed recipe transition");
  }
  const ping = await context.http.request({ method: "GET", path: "/ping" });
  if (!ping.ok || ping.status !== 200 || (await ping.text()).trim() !== "OK") throw new Error("Traefik private ping response differs");
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error("Traefik saved control-interface password is invalid");
  const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  let routers: Record<string, any>[] = [];
  for (const path of TRAEFIK_API_PATHS) {
    const anonymous = await context.http.request({ method: "GET", path });
    if (anonymous.status !== 401) throw new Error("Traefik management API did not reject anonymous access");
    const response = await context.http.request({ method: "GET", path, headers: { Authorization: authorization } });
    if (!response.ok || response.status !== 200) throw new Error("Traefik management API rejected the saved Basic credential");
    const value = await response.json();
    if (path === "/api/version") {
      if (setupRecord(value, "Traefik version").Version !== "3.6.22") throw new Error("Traefik API version differs from the pinned recipe");
    } else {
      if (!Array.isArray(value) || value.length > 512) throw new Error("Traefik management inventory is invalid or exceeds its bounded readback");
      const entries = value.map((entry) => setupRecord(entry, "Traefik management inventory"));
      if (path === "/api/http/routers") routers = entries;
    }
  }
  const matches = routers.filter((entry) => entry.name === "selfhost-api@file");
  const router = matches[0];
  if (matches.length !== 1 || router?.status !== "enabled" || router.rule !== TRAEFIK_API_RULE
    || router.service !== "api@internal" || JSON.stringify(router.entryPoints) !== '["health"]'
    || JSON.stringify(router.middlewares) !== '["selfhost-auth@file"]'
    || !recipe.configFiles[0]!.content.includes(TRAEFIK_API_RULE)) {
    throw new Error("Traefik effective management router differs from its exact read-only authenticated source");
  }
  for (const path of ["/dashboard/", "/api/rawdata", "/api/overview", "/debug/vars"]) {
    const response = await context.http.request({ method: "GET", path, headers: { Authorization: authorization } });
    if (response.status !== 404) throw new Error("Traefik exposes a management endpoint outside the reviewed GET-only paths");
  }
  return { appId: "traefik", projectRoot: context.projectRoot, stage: "private-readonly-api-ready", adminUsername: "admin",
    credentialUsage: "http-basic-control-interface", administratorCreated: false, apiKeyCreated: false,
    anonymousApiAccessDenied: true, savedPasswordVerified: true, managementEndpointsVerified: true,
    ingressVerified: false, restartPersistenceVerified: false };
}

const adapter: SetupAdapter = {
  appId: "traefik", sharedOwner: true, credentialCommand: "app handoff", apiKey: "not-created",
  healthSource: "GET /ping (loopback-only Traefik readiness endpoint)", homarrIntegration: "Traefik",
  firstRun: verify, inspect: verify,
  ready(record) { return record.appId === "traefik" && record.stage === "private-readonly-api-ready"
    && record.credentialUsage === "http-basic-control-interface" && record.administratorCreated === false
    && record.apiKeyCreated === false && record.anonymousApiAccessDenied === true
    && record.savedPasswordVerified === true && record.managementEndpointsVerified === true; },
};
export default adapter;
