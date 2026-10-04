import { isAbsolute } from "node:path";
import { checkedAppFrontend, type AppFrontend } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/app-frontend.ts";

type Entry = Record<string, any>;

export type AppEndpoint = {
  transport: "tcp";
  protocol: "http" | "https" | "postgresql" | "redis";
  host: string;
  port: number;
};

export function resolveAppFrontend(appManifest: Entry): AppFrontend {
  const frontend = checkedAppFrontend(appManifest?.frontend);
  if (!appManifest || !frontend) fail();
  return frontend;
}

/** Endpoints describe saved bindings only; TCP endpoints are never browser URLs. */
export function resolveAppEndpoints(appManifest: Entry, publishedPort: number,
  serverHost: string, containerPort: number) {
  const frontend = resolveAppFrontend(appManifest);
  if (!portNumber(publishedPort) || !portNumber(containerPort)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serverHost) || frontend.kind === "none") fail();
  const endpoint: AppEndpoint = { transport: "tcp", protocol: frontend.protocol,
    host: "127.0.0.1", port: publishedPort };
  const serverEndpoint: AppEndpoint = { transport: "tcp", protocol: frontend.protocol,
    host: serverHost, port: containerPort };
  let browserUrl: string | null = null;
  let serverUrl: string | null = null;
  if (frontend.kind === "web") {
    browserUrl = `${frontend.protocol}://${endpoint.host}:${endpoint.port}`;
    serverUrl = `${frontend.protocol}://${serverEndpoint.host}:${serverEndpoint.port}`;
  }
  return { frontend, endpoint, serverEndpoint, browserUrl, serverUrl };
}

export type ResolvedSharedAppMetadata = {
  id: string;
  name: string;
  description: string;
  group: string;
  iconUrl: string;
  frontend: AppFrontend;
  endpoint: AppEndpoint;
  serverEndpoint: AppEndpoint;
  browserUrl: string | null;
  serverUrl: string | null;
  storagePath: string | null;
  containerPort: number;
  publishedPort: number;
};

function fail(): never {
  throw new Error("Shared app metadata requires an exact catalog frontend and saved port mapping");
}

function portNumber(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535;
}

/** Presentation metadata only: URLs and icons do not establish reachability or acceptance. */
export function resolveSharedAppMetadata(appId: string, appManifest: Entry,
  recipe: Entry, savedService: Entry): ResolvedSharedAppMetadata {
  if (typeof appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)
    || appManifest?.id !== appId || recipe?.appId !== appId
    || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || savedService?.id !== appId || !Array.isArray(recipe.services)
    || !Array.isArray(savedService.ports)) fail();
  const frontends = recipe.services.filter((service: Entry) => service.id === appId);
  if (frontends.length !== 1) fail();
  const frontend = frontends[0];
  if (!portNumber(frontend.publishTargetPort)) fail();
  if (frontend.publishTargetPortSource !== undefined
    && frontend.publishTargetPortSource !== "published-port") fail();
  const additionalPorts = frontend.additionalPorts ?? [];
  if (!Array.isArray(additionalPorts)) fail();
  const frontPorts = savedService.ports.filter((port: Entry) => {
    if (port.protocol !== "tcp") return false;
    if (frontend.publishTargetPortSource === "published-port") {
      if (additionalPorts.some((descriptor: Entry) =>
        descriptor.targetPort === port.target && descriptor.protocol === port.protocol)) return false;
      return port.target === port.published;
    }
    return port.target === frontend.publishTargetPort;
  });
  if (frontPorts.length !== 1 || !portNumber(frontPorts[0].published)) fail();
  const selected = frontPorts[0];
  // Auxiliary mappings must be declared; do not mistake DNS, agents, or peer ports for the UI.
  for (const port of savedService.ports) {
    if (!portNumber(port.target) || !portNumber(port.published)) fail();
    if (port === selected) continue;
    const descriptors = additionalPorts.filter((descriptor: Entry) =>
      descriptor.targetPort === port.target && descriptor.protocol === port.protocol);
    if (descriptors.length !== 1) fail();
  }
  if (typeof appManifest.name !== "string" || !appManifest.name.trim()
    || typeof frontend.purpose !== "string" || !frontend.purpose.trim()) fail();
  const categories = appManifest.categories;
  let group = "Applications";
  if (Array.isArray(categories)) {
    const category = categories.find((value: unknown) => typeof value === "string"
      && value.trim() && !["all", "other", "general"].includes(value.toLowerCase()));
    if (category) group = category.trim();
  }
  // The generic slug URL is a presentation fallback, not proof that upstream hosts an icon.
  let iconUrl = `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${appId}.svg`;
  const declaredIcon = appManifest.homarr?.iconUrl;
  if (declaredIcon !== undefined) {
    if (typeof declaredIcon !== "string") fail();
    let parsed: URL;
    try { parsed = new URL(declaredIcon); } catch { fail(); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail();
    iconUrl = parsed.href;
  }
  let storagePath: string | null = null;
  if (!Array.isArray(frontend.mounts) || !Array.isArray(savedService.mounts)) fail();
  // Prefer app-owned data over shared media paths; named volumes have no host-path claim.
  const dataMount = frontend.mounts.find((mount: Entry) => mount.kind !== "generated-file"
    && mount.hostPath !== true && mount.kind !== "volume");
  if (dataMount) {
    const mounts = savedService.mounts.filter((mount: Entry) => mount.target === dataMount.target);
    if (mounts.length !== 1 || typeof mounts[0].source !== "string"
      || !isAbsolute(mounts[0].source)) fail();
    storagePath = mounts[0].source;
  }
  return {
    id: appId, name: appManifest.name.trim(), description: frontend.purpose.trim().slice(0, 512),
    group, iconUrl,
    ...resolveAppEndpoints(appManifest, selected.published, savedService.id, selected.target), storagePath,
    containerPort: selected.target, publishedPort: selected.published,
  };
}
