import { createHash } from "node:crypto";
import type { SharedProjectState } from "./shared-project-state.ts";
import { resolveSharedServiceTarget } from "./shared-service-target.ts";

export const TAILSCALE_CONNECTOR_SOURCE = "https://github.com/tailscale/tailscale/blob/v1.102.4/ipn/serve.go";
export const TAILSCALE_CONTAINER_SOURCE = "https://github.com/tailscale/tailscale/blob/v1.102.4/cmd/containerboot/serve.go";
export type PrivateServeRoute = { appId: string; httpsPort: number };
export type PrivateConnectorInput = {
  schemaVersion: 1;
  kind: "tailscale-private-serve";
  image: string;
  enrollmentFileId: "auth-key";
  aclOwner: string;
  network: "front";
  settings: { userspace: true; authOnce: true; funnel: false; ssh: false; subnetRoutes: []; exitNode: false };
  routes: PrivateServeRoute[];
};

function fail(message: string): never {
  throw new Error(`Private connector: ${message}`);
}

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    fail(`${label} has unsupported or missing fields`);
  }
}

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

/** Planning only: no recipe, Compose mutation, enrollment, runtime proof, or arbitrary Serve JSON. */
export function planPrivateConnector(owner: SharedProjectState, input: PrivateConnectorInput) {
  exact(input, ["schemaVersion", "kind", "image", "enrollmentFileId", "aclOwner", "network", "settings", "routes"], "input");
  if (input.schemaVersion !== 1 || input.kind !== "tailscale-private-serve"
    || typeof input.image !== "string"
    || !/^ghcr\.io\/tailscale\/tailscale:v1\.102\.4@sha256:[0-9a-f]{64}$/.test(input.image)
    || input.enrollmentFileId !== "auth-key" || input.network !== "front"
    || typeof input.aclOwner !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.aclOwner)) {
    fail("needs the pinned image, opaque enrollment-file ID, ACL owner and shared frontend network");
  }
  exact(input.settings, ["userspace", "authOnce", "funnel", "ssh", "subnetRoutes", "exitNode"], "settings");
  if (input.settings.userspace !== true || input.settings.authOnce !== true
    || input.settings.funnel !== false || input.settings.ssh !== false
    || input.settings.exitNode !== false || !Array.isArray(input.settings.subnetRoutes)
    || input.settings.subnetRoutes.length !== 0) {
    fail("only persistent userspace private Serve is allowed; no Funnel, SSH, subnet or exit-node expansion");
  }
  if (!Array.isArray(input.routes) || input.routes.length < 1 || input.routes.length > 32) {
    fail("select 1 to 32 exact frontend routes");
  }
  const seenApps = new Set<string>();
  const seenPorts = new Set<number>();
  const routes = input.routes.map((route) => {
    exact(route, ["appId", "httpsPort"], "route");
    const validPort = Number.isInteger(route.httpsPort)
      && (route.httpsPort === 443 || (route.httpsPort >= 1024 && route.httpsPort <= 65535));
    if (typeof route.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.appId)
      || route.appId === "tailscale" || !validPort) {
      fail("route needs a saved peer app and tailnet HTTPS 443 or an unprivileged high port");
    }
    if (seenApps.has(route.appId) || seenPorts.has(route.httpsPort)) fail("route apps and tailnet ports must be unique");
    seenApps.add(route.appId);
    seenPorts.add(route.httpsPort);
    const target = resolveSharedServiceTarget(owner, route.appId);
    return { ...target, httpsPort: route.httpsPort, upstream: `http://${target.hostname}:${target.targetPort}` };
  }).sort((a, b) => a.httpsPort - b.httpsPort);
  if (Object.hasOwn(owner.units, "tailscale") || owner.manifest.services.some((service) => service.id === "tailscale")) {
    fail("connector replacement or route update requires a separate retained-owner lifecycle");
  }
  const tcp: Record<string, { HTTPS: true }> = {};
  const web: Record<string, { Handlers: { "/": { Proxy: string } } }> = {};
  for (const route of routes) {
    tcp[String(route.httpsPort)] = { HTTPS: true };
    web[`\${TS_CERT_DOMAIN}:${route.httpsPort}`] = { Handlers: { "/": { Proxy: route.upstream } } };
  }
  // containerboot substitutes the enrolled certificate domain; callers cannot inject arbitrary SNI/targets.
  const serveConfig = `${JSON.stringify({ TCP: tcp, Web: web, AllowFunnel: {} }, null, 2)}\n`;
  const contract = {
    schemaVersion: 1 as const,
    authority: "read-only-plan" as const,
    owner: { projectId: owner.project.id, revision: owner.revision,
      recordHash: owner.recordHash, manifestHash: owner.manifestHash },
    image: input.image,
    source: TAILSCALE_CONNECTOR_SOURCE,
    containerSource: TAILSCALE_CONTAINER_SOURCE,
    execution: { kind: "private-connector" as const, longRunning: true, publishTargetPort: null,
      hostPorts: [], network: "front", networkName: routes[0].frontNetworkName },
    enrollment: { source: "owner-file" as const, fileId: "auth-key", payloadIncluded: false, aclOwner: input.aclOwner },
    settings: { userspace: true, authOnce: true, funnel: false, ssh: false, subnetRoutes: [], exitNode: false },
    environment: [
      { name: "TS_USERSPACE", value: "true" }, { name: "TS_AUTH_ONCE", value: "true" },
      { name: "TS_AUTHKEY", value: "file:/run/secrets/auth-key" },
      { name: "TS_STATE_DIR", value: "/var/lib/tailscale" },
      { name: "TS_SERVE_CONFIG", value: "/etc/tailscale-serve/serve.json" },
    ],
    persistentState: { kind: "owned-volume", name: `${owner.project.id}-tailscale-state`,
      ownership: "new", target: "/var/lib/tailscale" },
    watchedConfig: { kind: "generated-directory", target: "/etc/tailscale-serve", fileName: "serve.json",
      content: serveConfig, sha256: hash(serveConfig) },
    routes,
    verification: { enrolled: false, aclVerified: false, upstreamHttpVerified: false, intendedClientVerified: false,
      internetRouteAbsent: false, restartIdentityVerified: false },
    requiredSeams: ["portless-connector-compose-contract", "generated-watched-directory", "new-node-state-volume-ownership",
      "retained-owner-connector-lifecycle", "upstream-http-protocol-review",
      "enrollment-and-serve-readback", "intended-client-acl-acceptance"],
  };
  return { ...contract, contractSha256: hash(JSON.stringify(contract)) };
}
