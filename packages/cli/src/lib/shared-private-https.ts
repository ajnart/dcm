import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { buildIngressPlan } from "../../../../.agents/skills/self-host/workflows/selfhost-ingress/scripts/plan-ingress.ts";
import { renderCaddyfile } from "../../../../.agents/skills/self-host/workflows/selfhost-ingress/scripts/render-caddyfile.ts";
import { extendSharedProject, type SharedAppSelection, type SharedProjectCandidate,
  type SharedProjectObservation } from "./shared-compose-project.ts";
import type { SharedProjectState } from "./shared-project-state.ts";
import { pinnedMultiServiceImages } from "./multi-service-recipe.ts";
import { loadSharedHttpsProxyProfile, renderSharedHttpsProxyProfile, validateSharedHttpsProxyProfile,
  type SharedHttpsProxyProfileBinding } from "./shared-https-proxy-profile.ts";

type Entry = Record<string, any>;
export const MAX_SHARED_PRIVATE_HTTPS_ROUTES = 100;
export type SharedPrivateHttpsRoute = { appId: string; hostname: string };
/** Exact local transport identity syntax; this is not domain ownership or cookie eligibility. */
export function isSharedPrivateHttpsHostname(hostname: unknown): hostname is string {
  return typeof hostname === "string" && hostname.length <= 253
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname);
}
export function sharedPrivateHttpsHostnameScope(routes: SharedPrivateHttpsRoute[]):
  "host-only-localhost" | "host-only-name-override" {
  if (routes.some((route) => !route.hostname.endsWith(".localhost"))) return "host-only-name-override";
  return "host-only-localhost";
}
export type SharedPrivateHttpsPlan = {
  owner: { projectId: string; revision: number; recordHash: string; manifestHash: string };
  candidate: SharedProjectCandidate;
  caddySelection: SharedAppSelection;
  caddyRouteAliases?: "owner-front-v1";
  routes: Array<SharedPrivateHttpsRoute & { url: string; frontService: string; targetPort: number;
    proxyProfileSha256?: string; proxyProfileStatus?: "source-bound-route-unverified" }>;
  proxyProfiles: SharedHttpsProxyProfileBinding[];
  caddyfileSha256: string;
  evidence: { transportVerified: false; dnsVerified: false; clientTrustVerified: false; applicationVerified: false };
  blockers: string[];
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(message: string): never {
  throw new Error(`Shared private HTTPS: ${message}`);
}

/** Pure planning only. A generated TLS recipe is not yet a resumable or configured app selection. */
export function planSharedPrivateHttps(current: SharedProjectState, caddyRecipe: Entry,
  image: string, routes: SharedPrivateHttpsRoute[], port: number,
  observation: SharedProjectObservation, caddyRouteAliases = true): SharedPrivateHttpsPlan {
  if (!current || current.schemaVersion !== 1 || current.checkpoint?.phase !== "completed"
    || !Number.isSafeInteger(current.revision) || current.revision < 1
    || !/^[0-9a-f]{64}$/.test(current.recordHash ?? "")
    || current.manifestHash !== hash(current.manifest)) {
    fail("needs one completed, hash-bound saved owner");
  }
  const { recordHash, ...record } = current;
  if (recordHash !== hash(record)) fail("saved owner record hash differs");
  if (Object.hasOwn(current.units, "caddy")
    || current.manifest.services.some((service: Entry) => service.id === "caddy")) {
    fail("Caddy is already installed; replacement and route updates are not supported");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("select one private high TLS port");
  if (!Array.isArray(routes) || routes.length < 1 || routes.length > MAX_SHARED_PRIVATE_HTTPS_ROUTES) {
    fail(`select 1 to ${MAX_SHARED_PRIVATE_HTTPS_ROUTES} bounded routes`);
  }
  if (!observation || !Array.isArray(observation.ports)
    || !Array.isArray(observation.networks) || !Array.isArray(observation.paths)
    || typeof observation.checkedAt !== "string" || Number.isNaN(Date.parse(observation.checkedAt))) {
    fail("needs an exact supplied shared-owner observation");
  }
  if (observation.ports.some((entry: Entry) => entry.protocol === "tcp" && entry.published === port)) {
    fail("selected TLS port conflicts with an observed TCP listener");
  }
  if (!caddyRecipe || caddyRecipe.appId !== "caddy" || caddyRecipe.schemaVersion !== 2
    || caddyRecipe.kind !== "multi-service-compose" || caddyRecipe.services?.length !== 1
    || caddyRecipe.services[0]?.id !== "caddy" || caddyRecipe.privateFiles?.length !== 0
    || caddyRecipe.sharedPrivateHttpsRouteAliases !== undefined
    || caddyRecipe.onboarding?.kind !== "no-account"
    || caddyRecipe.configFiles?.length !== 1 || caddyRecipe.configFiles[0]?.id !== "caddyfile") {
    fail("needs the bounded, no-account Caddy recipe with one generated Caddyfile");
  }
  const service = caddyRecipe.services[0];
  if (!/^caddy:2\.[0-9]+\.[0-9]+$/.test(service.imageTag) || typeof image !== "string") {
    fail("image must exactly match the Caddy recipe tag and immutable digest");
  }
  pinnedMultiServiceImages(caddyRecipe, [`caddy=${image}`]);
  if (service.environment?.length !== 0 || service.hostEnvironment?.length !== 0
    || service.fileEnvironment?.length !== 0 || service.dependsOn?.length !== 0
    || service.mounts?.length !== 3 || service.command !== undefined || service.entrypoint !== undefined
    || service.secretEnvironment !== undefined || service.derivedEnvironment !== undefined
    || service.additionalPorts !== undefined || caddyRecipe.privateConfigs !== undefined
    || !service.mounts.some((mount: Entry) => mount.kind === "generated-file"
      && mount.fileId === "caddyfile" && mount.target === "/etc/caddy/Caddyfile")
    || !["/data", "/config"].every((target) => service.mounts.some((mount: Entry) =>
      mount.kind === "volume" && mount.target === target && mount.hostPath !== true))) {
    fail("Caddy recipe must retain only its reviewed config and persistent named volumes");
  }
  const seenApps = new Set<string>();
  const seenHosts = new Set<string>();
  const proxyProfiles: SharedHttpsProxyProfileBinding[] = [];
  const resolved = routes.map((route) => {
    if (!route || Object.keys(route).sort().join(",") !== "appId,hostname"
      || typeof route.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.appId)
      || route.appId === "caddy" || !isSharedPrivateHttpsHostname(route.hostname)) {
      fail("route needs only a saved app ID and a bounded lowercase private hostname");
    }
    if (route.appId === "authelia" && (route.hostname.endsWith(".localhost")
      || route.hostname.endsWith(".home.arpa"))) {
      fail("Authelia requires a separately reviewed eligible cookie-domain contract");
    }
    if (seenApps.has(route.appId) || seenHosts.has(route.hostname)) fail("route apps and hostnames must be unique");
    seenApps.add(route.appId);
    seenHosts.add(route.hostname);
    if (caddyRouteAliases) {
      if (route.hostname.length > 64) fail("route hostname exceeds the existing Compose alias limit of 64 characters");
      if (current.manifest.services.some((entry: Entry) => entry.networks.includes("front")
        && (entry.id === route.hostname || entry.hostname === route.hostname || (entry.networkAliases ?? []).some((alias: Entry) =>
          alias.network === "front" && alias.alias === route.hostname)))) {
        fail("route hostname conflicts with a saved shared-front service identity");
      }
    }
    const front = current.manifest.services.find((entry: Entry) => entry.id === route.appId);
    if (!Object.hasOwn(current.units, route.appId) || !current.units[route.appId].includes(route.appId)
      || !front || !front.networks?.includes("front") || front.ports?.length !== 1) {
      fail("route target is not an exact saved application frontend");
    }
    const backend = front.ports[0];
    if (backend.hostIp !== "127.0.0.1" || backend.protocol !== "tcp"
      || !["application", "private-admin", "admin"].includes(backend.purpose)
      || backend.publicApproved !== false || !Number.isInteger(backend.target)
      || backend.target < 1 || backend.target > 65535
      || !Number.isInteger(backend.published) || backend.published < 1024 || backend.published > 65535) {
      fail("route target needs its saved loopback TCP application/private-admin binding");
    }
    const profile = loadSharedHttpsProxyProfile(route.appId);
    if (profile) {
      validateSharedHttpsProxyProfile(current, profile);
      if (profile.profile.fallback.service !== front.id || profile.profile.fallback.port !== backend.target) {
        fail("proxy fallback differs from the exact saved frontend port");
      }
      proxyProfiles.push(profile);
    }
    return { ...route, url: `https://${route.hostname}:${port}`,
      frontService: front.id as string, targetPort: backend.target as number,
      ...(profile && { proxyProfileSha256: profile.sourceSha256,
        proxyProfileStatus: "source-bound-route-unverified" as const }) };
  }).sort((left, right) => left.hostname.localeCompare(right.hostname));
  proxyProfiles.sort((left, right) => left.profile.appId.localeCompare(right.profile.appId));

  // These are the actual named-volume mount targets, not host CA-export paths.
  const configPath = "/config";
  const dataPath = "/data";
  const plans = resolved.map((route) => buildIngressPlan({ schemaVersion: 1,
    service: { id: route.appId, class: "application", internalPort: route.targetPort },
    // This is the candidate's sole future port claim, not observed runtime ownership.
    facts: { ownership: { ports: [{ port, owner: current.project.id }] } },
    preferences: { route: "caddy-private", hostname: route.hostname, clientTrustPlanned: true,
      ...(!route.hostname.endsWith(".localhost") && { nameResolution: "host-only-override" }),
      caddy: { owner: current.project.id, runtime: "container", upstreamHost: route.frontService,
        clientScope: "host-only", hostBindAddress: "127.0.0.1", httpsPort: port, configPath, dataPath } },
  }));
  let rendered = renderCaddyfile(plans);
  for (const route of resolved) {
    const profile = proxyProfiles.find((entry) => entry.profile.appId === route.appId);
    if (!profile) continue;
    const original = `${route.hostname}:${port} {\n\ttls internal\n\treverse_proxy ${route.frontService}:${route.targetPort}\n}`;
    if (rendered.split(original).length !== 2) fail("compound proxy target differs from the bounded renderer output");
    rendered = rendered.replace(original,
      `${route.hostname}:${port} {\n\ttls internal\n${renderSharedHttpsProxyProfile(profile)}}`);
  }
  const caddyfile = rendered.replace("{\n", "{\n\tadmin off\n");
  const recipe = structuredClone(caddyRecipe);
  recipe.configFiles[0].content = caddyfile;
  recipe.services[0].publishTargetPort = port;
  delete recipe.services[0].publishTargetPortSource;
  recipe.services[0].purpose = "Plans host-only private TLS routes; runtime setup and client trust remain pending.";
  recipe.defaults.hostIp = "127.0.0.1";
  recipe.defaults.publishedPort = port;
  if (caddyRouteAliases) recipe.sharedPrivateHttpsRouteAliases = resolved.map(({ hostname }) => hostname);
  const caddySelection: SharedAppSelection = { appId: "caddy", recipe, images: { caddy: image }, port };
  const candidate = extendSharedProject({ manifest: structuredClone(current.manifest),
    units: structuredClone(current.units), selectionFingerprints: { ...current.selectionFingerprints },
    settings: { ...current.settings }, projectDirectory: current.project.directory }, [caddySelection],
  { projectRoot: dirname(dirname(current.project.root)), projectId: current.project.id,
    dockerContext: current.project.dockerContext, ...current.settings }, structuredClone(observation));
  return {
    owner: { projectId: current.project.id, revision: current.revision, recordHash, manifestHash: current.manifestHash },
    candidate, caddySelection, routes: resolved, proxyProfiles,
    ...(caddyRouteAliases && { caddyRouteAliases: "owner-front-v1" as const }),
    caddyfileSha256: createHash("sha256").update(caddyfile).digest("hex"),
    evidence: { transportVerified: false, dnsVerified: false, clientTrustVerified: false, applicationVerified: false },
    blockers: ["owner-tls-transport-and-ca-export", "persisted-route-bindings-and-resume",
      "routed-app-canonical-origin", "upstream-http-protocol-and-proxy-settings",
      "intended-client-dns-and-ca-trust", "application-and-restart-acceptance",
      "caddy-http-health-adapter-does-not-verify-tls"],
  };
}
