import { join } from "node:path";

export type LocalCaddySelection = {
  root: string;
  input: string;
  bundle: string;
  bundleApproval: string;
  owner: string;
  origin: string;
  httpsPort: number;
  backendHostPort: number;
  routeNetwork: string | null;
  mediaWeb: string;
  bridge: string;
  directory: string;
  sharedInput: string;
  caExportPath: string;
};

export type CaddyInputsReview = {
  approval: string;
  image: string;
  vaultwardenHostPort: number;
  origins: string[];
};

const idPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ownerPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const imagePattern = /^docker\.io\/library\/caddy:2\.[0-9]+\.[0-9]+(?:-alpine)?@sha256:[0-9a-f]{64}$/;
const routeIds = ["homarr", "jellyfin", "seerr", "immich", "docmost", "vaultwarden"];
const routeUpstreams: Record<string, string> = {
  homarr: "homarr:7575",
  jellyfin: "jellyfin:8096",
  seerr: "seerr:5055",
  immich: "immich-server:2283",
  docmost: "docmost:3000",
  vaultwarden: "vaultwarden:8080",
};

function object(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function fail(message: string): never { throw new Error(message); }

function expectedRoutes(selection: LocalCaddySelection): Array<{ service: string; origin: string; network: string }> {
  return routeIds.map((service) => ({
    service,
    origin: `https://${service}.localhost:${selection.httpsPort}`,
    network: service === "vaultwarden" ? "vaultwarden" : "media-web",
  }));
}

function expectedCaddyRoutes(selection: LocalCaddySelection): Array<{ service: string; origin: string; network: string }> {
  return expectedRoutes(selection).sort((left, right) =>
    `${left.service}.localhost`.localeCompare(`${right.service}.localhost`));
}

export function localCaddyOrigins(selection: LocalCaddySelection): string[] {
  return expectedRoutes(selection).map((route) => route.origin);
}

export function localCaddySelection(statusValue: unknown, inboxValue: unknown,
  root: string, input: string): LocalCaddySelection | null {
  const status = object(statusValue);
  const inbox = object(inboxValue);
  const https = object(status?.privateHttps);
  const review = object(inbox?.bundleReview);
  const media = object(review?.mediaSelection);
  const current = object(inbox?.current);
  if (status?.schemaVersion !== 1 || status.kind !== "household-bundle-status"
    || status.status !== "incomplete" || status.mutation !== false || status.projectRoot !== root
    || inbox?.kind !== "household-bundle-approvals" || inbox.status !== "review-required"
    || inbox.mutation !== false || inbox.executionPerformed !== false || inbox.projectRoot !== root
    || current?.checkpoint !== "verify-vaultwarden-private-https"
    || typeof inbox.bundle !== "string" || !idPattern.test(inbox.bundle)
    || status.bundle !== inbox.bundle
    || input !== join(root, ".selfhost", "bundles", inbox.bundle, "household-bundle.json")
    || typeof inbox.bundleApproval !== "string"
    || !new RegExp(`^BUNDLE:${inbox.bundle}:[0-9a-f]{64}$`).test(inbox.bundleApproval)
    || media?.mode !== "create" || media.bind !== "127.0.0.1"
    || media.source !== "bundle-selection" || media.approvalDigest !== null
    || typeof media.runId !== "string" || !idPattern.test(media.runId)
    || https?.ready !== false || https.recordedRouteStatus !== "pending"
    || https.recordedClientTrust !== "pending"
    || https.backendPortMatchesApp !== true
    || !Number.isInteger(https.backendHostPort) || https.backendHostPort < 1024
    || https.backendHostPort > 65535
    || typeof https.routeOwner !== "string" || !ownerPattern.test(https.routeOwner)
    || https.tlsOwner !== https.routeOwner || typeof https.origin !== "string") return null;
  let origin: URL;
  try { origin = new URL(https.origin); }
  catch { return null; }
  const httpsPort = Number(origin.port);
  if (origin.protocol !== "https:" || origin.hostname !== "vaultwarden.localhost"
    || origin.origin !== https.origin || origin.pathname !== "/" || origin.search || origin.hash
    || origin.username || origin.password || !Number.isInteger(httpsPort)
    || httpsPort < 1024 || httpsPort > 65535) return null;
  const directory = join(root, ".selfhost", "bundles", inbox.bundle, "caddy");
  const bridge = `${https.routeOwner}-vaultwarden`;
  if (https.vaultwardenRouteNetwork !== null && https.vaultwardenRouteNetwork !== bridge) return null;
  return {
    root, input, bundle: inbox.bundle, bundleApproval: inbox.bundleApproval,
    owner: https.routeOwner, origin: https.origin, httpsPort,
    backendHostPort: https.backendHostPort, routeNetwork: https.vaultwardenRouteNetwork,
    mediaWeb: `autostack-${media.runId}_web`, bridge,
    directory, sharedInput: join(directory, "shared-caddy.json"),
    caExportPath: join(root, ".selfhost", "caddy-private", https.routeOwner, "caddy-local-root.crt"),
  };
}

function inputRouteRows(value: unknown, selection: LocalCaddySelection): string[] {
  if (!Array.isArray(value) || value.length !== routeIds.length) fail("Caddy did not plan the six exact host-only routes.");
  const expected = expectedRoutes(selection);
  const origins: string[] = [];
  for (const [index, entry] of value.entries()) {
    const route = object(entry);
    if (!route || route.service !== expected[index].service || route.origin !== expected[index].origin
      || route.upstreamNetwork !== expected[index].network) fail("Caddy route ownership or origin changed during review.");
    origins.push(route.origin);
  }
  return origins;
}

export function reviewedCaddyInputs(value: unknown, selection: LocalCaddySelection,
  expectedStatus: "ready-for-review" | "created"): CaddyInputsReview {
  const plan = object(value);
  const networks = object(plan?.networks);
  let expectedMutation: false | string = false;
  if (expectedStatus === "created") expectedMutation = "owner-only-caddy-inputs";
  if (plan?.schemaVersion !== 1 || plan.kind !== "household-caddy-inputs"
    || plan.status !== expectedStatus || plan.mutation !== expectedMutation
    || plan.bundle !== selection.bundle || plan.input !== selection.sharedInput
    || typeof plan.approval !== "string"
    || !new RegExp(`^CADDY-INPUTS:${selection.bundle}:[0-9a-f]{64}$`).test(plan.approval)
    || typeof plan.caddyImage !== "string" || !imagePattern.test(plan.caddyImage)
    || plan.vaultwardenHostPort !== selection.backendHostPort
    || networks?.mediaWeb !== selection.mediaWeb
    || networks.vaultwarden !== selection.bridge) fail("Caddy input plan did not match this exact host-only bundle.");
  const origins = inputRouteRows(plan.routes, selection);
  return { approval: plan.approval, image: plan.caddyImage,
    vaultwardenHostPort: plan.vaultwardenHostPort, origins };
}

export function reviewedPrivateCaddyPlan(value: unknown, selection: LocalCaddySelection): { approval: string; image: string } {
  const plan = object(value);
  const project = object(plan?.project);
  const access = object(plan?.access);
  const manifest = object(plan?.manifest);
  const services = manifest?.services;
  if (plan?.schemaVersion !== 1 || plan.kind !== "shared-private-caddy-plan"
    || plan.status !== "pass" || plan.mutation !== false
    || project?.id !== selection.owner || project.owner !== selection.owner
    || project.directory !== join(selection.root, selection.owner) || project.ownership !== "new"
    || access?.exposure !== "private" || access.bindAddress !== "127.0.0.1"
    || access.httpsPort !== selection.httpsPort || access.public !== false
    || access.httpRedirectPort !== "disabled" || plan.dockerSocket !== "not-mounted"
    || plan.caExportPath !== selection.caExportPath || plan.existingLifecycle !== null
    || typeof plan.approval !== "string"
    || !new RegExp(`^APPLY:${selection.owner}:[0-9a-f]{64}$`).test(plan.approval)
    || typeof plan.caddyfileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(plan.caddyfileSha256)) {
    fail("Private Caddy plan changed ownership, exposure, lifecycle, or approval.");
  }
  if (!Array.isArray(services) || services.length !== 1 || services[0]?.id !== "caddy"
    || typeof services[0].image !== "string" || !imagePattern.test(services[0].image)) {
    fail("Private Caddy plan did not contain one immutable official image.");
  }
  if (!Array.isArray(plan.routes) || plan.routes.length !== routeIds.length) fail("Private Caddy routes changed.");
  const expected = expectedCaddyRoutes(selection);
  for (const [index, entry] of plan.routes.entries()) {
    const route = object(entry);
    if (!route || route.service !== expected[index].service || route.origin !== expected[index].origin
      || route.hostname !== `${expected[index].service}.localhost`
      || route.upstream !== routeUpstreams[expected[index].service]
      || route.network !== expected[index].network) fail("Private Caddy route changed during review.");
  }
  return { approval: plan.approval, image: services[0].image };
}

function transportProofs(value: unknown, selection: LocalCaddySelection): void {
  if (!Array.isArray(value) || value.length !== routeIds.length) fail("Caddy transport proof is incomplete.");
  const expected = expectedCaddyRoutes(selection);
  for (const [index, entry] of value.entries()) {
    const proof = object(entry);
    if (!proof || proof.hostname !== `${expected[index].service}.localhost`
      || proof.origin !== expected[index].origin || proof.method !== "curl-cacert-resolve"
      || proof.verified !== true) fail("Caddy transport proof did not match the reviewed routes.");
  }
}

export function reviewedPrivateCaddyApply(value: unknown, selection: LocalCaddySelection): void {
  const result = object(value);
  const access = object(result?.access);
  if (result?.schemaVersion !== 1 || result.kind !== "shared-private-caddy-apply"
    || result.status !== "applied-transport-only" || result.project !== selection.owner
    || result.caExportPath !== selection.caExportPath
    || access?.exposure !== "private" || access.bindAddress !== "127.0.0.1"
    || access.httpsPort !== selection.httpsPort || access.public !== false) {
    fail("Caddy apply did not return the exact private transport checkpoint.");
  }
  if (!Array.isArray(result.routes) || result.routes.length !== routeIds.length) fail("Applied Caddy routes changed.");
  const expected = expectedCaddyRoutes(selection);
  for (const [index, entry] of result.routes.entries()) {
    const route = object(entry);
    if (!route || route.service !== expected[index].service || route.origin !== expected[index].origin
      || route.hostname !== `${expected[index].service}.localhost`
      || route.upstream !== routeUpstreams[expected[index].service]
      || route.network !== expected[index].network) fail("Applied Caddy route changed.");
  }
  transportProofs(result.transportProofs, selection);
}

export function reviewedPrivateCaddyPrepared(value: unknown, selection: LocalCaddySelection): void {
  const status = object(value);
  const access = object(status?.access);
  if (status?.schemaVersion !== 1 || status.kind !== "shared-private-caddy-status"
    || status.project !== selection.owner || status.applied !== false
    || status.checkpointRecorded !== false || status.current !== false
    || status.currentInput !== "valid-without-checkpoint" || status.checkpoint !== null
    || access?.exposure !== "private" || access.bindAddress !== "127.0.0.1"
    || access.httpsPort !== selection.httpsPort || access.public !== false) {
    fail("Existing Caddy inputs are not an untouched, private project.");
  }
}

export function reviewedPrivateCaddyStatus(value: unknown, selection: LocalCaddySelection): void {
  const status = object(value);
  const access = object(status?.access);
  const checkpoint = object(status?.checkpoint);
  const trust = object(status?.verification?.intendedClientCaTrust);
  if (status?.schemaVersion !== 1 || status.kind !== "shared-private-caddy-status"
    || status.project !== selection.owner || status.applied !== true
    || status.checkpointRecorded !== true || status.current !== true
    || status.currentInput !== "matches-checkpoint" || status.persistentCaMatchesExport !== true
    || checkpoint?.phase !== "verified" || checkpoint.inputPath !== selection.sharedInput
    || trust?.verified !== false || trust.caExportPath !== selection.caExportPath
    || access?.exposure !== "private" || access.bindAddress !== "127.0.0.1"
    || access.httpsPort !== selection.httpsPort || access.public !== false) {
    fail("Caddy checkpoint is not the exact current host-only verified transport.");
  }
  if (!Array.isArray(status.routes) || status.routes.length !== routeIds.length) fail("Current Caddy routes changed.");
  const expected = expectedCaddyRoutes(selection);
  for (const [index, entry] of status.routes.entries()) {
    const route = object(entry);
    if (!route || route.hostname !== `${expected[index].service}.localhost`
      || route.origin !== expected[index].origin) fail("Current Caddy route changed.");
  }
  transportProofs(status.liveTransport, selection);
}

export function reviewedVaultwardenRoute(value: unknown, selection: LocalCaddySelection,
  previousApproval: string): string {
  const result = object(value);
  if (result?.schemaVersion !== 1 || result.kind !== "household-bundle-route-network"
    || result.status !== "revised" || result.mutation !== "owner-only-vaultwarden-input"
    || result.bundle !== selection.bundle || result.network !== selection.bridge
    || result.previousApproval !== previousApproval || typeof result.approval !== "string"
    || result.approval === previousApproval
    || !new RegExp(`^BUNDLE:${selection.bundle}:[0-9a-f]{64}$`).test(result.approval)) {
    fail("Vaultwarden route revision did not return one new exact bundle approval.");
  }
  return result.approval;
}

export function reviewedHttpsReady(value: unknown, selection: LocalCaddySelection,
  previousApproval: string): string {
  const result = object(value);
  if (result?.schemaVersion !== 1 || result.kind !== "household-bundle-https-ready"
    || result.status !== "recorded" || result.mutation !== "owner-only-https-plan"
    || result.bundle !== selection.bundle || result.origin !== selection.origin
    || result.routeOwner !== selection.owner || result.tlsOwner !== selection.owner
    || result.previousApproval !== previousApproval || typeof result.approval !== "string"
    || result.approval === previousApproval
    || !new RegExp(`^BUNDLE:${selection.bundle}:[0-9a-f]{64}$`).test(result.approval)) {
    fail("HTTPS readiness did not record the owner's exact new assertion.");
  }
  return result.approval;
}
