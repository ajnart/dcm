import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { SharedProjectState } from "./shared-project-state.ts";
import { resolveSharedServiceTarget, type SharedServiceTarget } from "./shared-service-target.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContainerCommand, SetupContainerResult } from
  "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const CLI = ["/usr/local/bin/tailscale", "--socket=/tmp/tailscaled.sock"];
export const TAILSCALE_STATUS_ARGV = Object.freeze([...CLI, "status", "--json"]);
export const TAILSCALE_PREFS_ARGV = Object.freeze([...CLI, "debug", "prefs"]);
export const TAILSCALE_SERVE_STATUS_ARGV = Object.freeze([...CLI, "serve", "status", "--json"]);
export const TAILSCALE_ENROLL_ARGV = Object.freeze([...CLI, "up", "--auth-key=file:/run/secrets/auth-key",
  "--accept-dns=false", "--accept-routes=false", "--ssh=false", "--advertise-exit-node=false",
  "--advertise-routes=", "--exit-node=", "--timeout=10s"]);

type Entry = Record<string, any>;
export type TailscaleNode = { nodeId: string; dnsName: string; tailnetDomain: string };
export type TailscaleRouteInput = { targetAppId: string; tailnetDomain: string; aclOwner: string; httpsPort: number };

function fail(message: string): never { throw new Error(`Tailscale connector: ${message}`); }
function object(value: unknown): Entry {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid private readback");
  return value as Entry;
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function empty(value: unknown) { return value === undefined || value === null || value === ""; }

export function parseTailscaleReadback(stdout: string): Entry {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 64 * 1024) fail("private readback exceeds its bound");
  try { return object(JSON.parse(stdout)); }
  catch { fail("private readback is not a bounded JSON object"); }
}

/** Pinned serve status emits JSON null when the daemon has no saved config. */
export function parseTailscaleServeReadback(stdout: string): Entry | null {
  if (typeof stdout === "string" && stdout.trim() === "null") return null;
  return parseTailscaleReadback(stdout);
}

/** Does not prove controller policy or intended-client reachability. */
export function verifyTailscaleNode(value: unknown, expectedDomain: string, savedNodeId?: string): TailscaleNode {
  const status = object(value);
  const self = object(status.Self);
  const tailnet = object(status.CurrentTailnet);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:ts\.net|tailscale\.net)$/.test(expectedDomain)
    || status.BackendState !== "Running" || status.HaveNodeKey !== true
    || tailnet.MagicDNSSuffix !== expectedDomain || typeof self.ID !== "string"
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(self.ID) || self.Online !== true
    || typeof self.DNSName !== "string"
    || !new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.${expectedDomain.replaceAll(".", "\\.")}\\.$`).test(self.DNSName)
    || !Array.isArray(self.TailscaleIPs) || self.TailscaleIPs.length === 0
    || !empty(status.ExitNodeStatus) || (savedNodeId !== undefined && savedNodeId !== self.ID)) {
    fail("running node differs from the reviewed tailnet or saved identity");
  }
  return { nodeId: self.ID, dnsName: self.DNSName.slice(0, -1), tailnetDomain: expectedDomain };
}

/** Inspect only the selected prefs; never return Persist, account keys or raw debug JSON. */
export function verifyTailscalePrivatePrefs(value: unknown): void {
  const prefs = object(value);
  if (prefs.RouteAll !== false || prefs.CorpDNS !== false || prefs.RunSSH !== false
    || prefs.RunWebClient !== false || prefs.WantRunning !== true
    || prefs.ExitNodeAllowLANAccess !== false || !empty(prefs.ExitNodeID) || !empty(prefs.ExitNodeIP)
    || !empty(prefs.AutoExitNode) || (prefs.AdvertiseRoutes !== null &&
      (!Array.isArray(prefs.AdvertiseRoutes) || prefs.AdvertiseRoutes.length !== 0))
    || (prefs.AdvertiseServices !== null &&
      (!Array.isArray(prefs.AdvertiseServices) || prefs.AdvertiseServices.length !== 0))
    || (prefs.AdvertiseTags !== null &&
      (!Array.isArray(prefs.AdvertiseTags) || prefs.AdvertiseTags.length !== 0))
    || !prefs.AppConnector || prefs.AppConnector.Advertise !== false
    || prefs.RemoteConfig !== false || !empty(prefs.RelayServerPort)) {
    fail("SSH, DNS, subnet, exit or remotely delegated networking is not allowed");
  }
}

/** For a fresh userspace daemon, state inspection must precede enrollment. */
export function requireFreshTailscaleNode(value: unknown, serveValue: unknown): void {
  const status = object(value);
  if (status.BackendState !== "NeedsLogin" || (status.HaveNodeKey !== false && status.HaveNodeKey !== undefined)
    || !empty(status.CurrentTailnet) || !empty(status.AuthURL)
    || (status.Self !== null && status.Self !== undefined && !empty(object(status.Self).ID))) {
    fail("enrollment needs a fresh unregistered daemon; do not re-enroll unknown state");
  }
  requireEmptyTailscaleServe(serveValue);
}

export function requireFreshTailscalePrefs(value: unknown): void {
  const prefs = object(value);
  if (prefs.WantRunning !== false || prefs.RunSSH !== false || prefs.RunWebClient !== false
    || prefs.RemoteConfig !== false || !prefs.AppConnector || prefs.AppConnector.Advertise !== false
    || !empty(prefs.RelayServerPort) || !empty(prefs.ExitNodeID) || !empty(prefs.ExitNodeIP)
    || !empty(prefs.AutoExitNode)
    || ![prefs.AdvertiseRoutes, prefs.AdvertiseServices, prefs.AdvertiseTags].every((items) =>
      items === null || (Array.isArray(items) && items.length === 0))) {
    fail("fresh enrollment prefs contain unowned networking or remote-control settings");
  }
}

export function requireEmptyTailscaleServe(value: unknown): void {
  if (value === null) return;
  const config = object(value);
  for (const [key, setting] of Object.entries(config)) {
    if (!["TCP", "Web", "AllowFunnel", "Services", "Foreground"].includes(key)
      || (setting !== null && Object.keys(object(setting)).length !== 0)) {
      fail("existing Serve or Funnel configuration is not owned by this activation");
    }
  }
}

/** Exact saved-owner route descriptor, not an activation authority or a caller-approved flag. */
export function planSharedTailscaleRoute(owner: SharedProjectState, input: TailscaleRouteInput) {
  const target = resolveSharedServiceTarget(owner, input.targetAppId);
  const connectors = owner.manifest.services.filter((service) => service.id === "tailscale");
  if (!owner.units.tailscale?.includes("tailscale") || connectors.length !== 1
    || connectors[0]!.ports?.length !== 0 || !connectors[0]!.networks?.includes("front")
    || !/^ghcr\.io\/tailscale\/tailscale:v1\.102\.4@sha256:[0-9a-f]{64}$/.test(connectors[0]!.image)) {
    fail("route needs the exact installed pinned portless connector in the selected frontend owner");
  }
  return planResolvedSharedTailscaleRoute({ projectId: owner.project.id,
    projectRoot: dirname(dirname(dirname(owner.project.directory))), directory: owner.project.directory,
    ownerRevision: owner.revision, ownerRecordHash: owner.recordHash, manifestHash: owner.manifestHash,
    connectorSelectionFingerprint: owner.selectionFingerprints.tailscale! }, target, input);
}

export type TailscaleOwnerMetadata = { projectId: string; projectRoot: string; directory: string;
  ownerRevision: number; ownerRecordHash: string; manifestHash: string; connectorSelectionFingerprint: string };

/** Target must come from the transport-owned peers.resolveTarget, never an adapter input or approved flag. */
export function planResolvedSharedTailscaleRoute(owner: TailscaleOwnerMetadata,
  target: SharedServiceTarget, input: TailscaleRouteInput) {
  if (!input || Object.keys(input).sort().join(",") !== "aclOwner,httpsPort,tailnetDomain,targetAppId"
    || typeof input.aclOwner !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.aclOwner)
    || typeof input.tailnetDomain !== "string"
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:ts\.net|tailscale\.net)$/.test(input.tailnetDomain)
    || !Number.isInteger(input.httpsPort)
    || (input.httpsPort !== 443 && (input.httpsPort < 1024 || input.httpsPort > 65535))
    || input.targetAppId === "tailscale") fail("select one saved peer, private tailnet domain, ACL owner and HTTPS port");
  if (!owner || Object.keys(owner).sort().join(",") !== "connectorSelectionFingerprint,directory,manifestHash,ownerRecordHash,ownerRevision,projectId,projectRoot"
    || typeof owner.projectId !== "string" || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(owner.projectId)
    || typeof owner.projectRoot !== "string" || !owner.projectRoot.startsWith("/")
    || owner.directory !== join(owner.projectRoot, ".selfhost", "shared", owner.projectId)
    || !Number.isSafeInteger(owner.ownerRevision) || owner.ownerRevision < 1
    || ![owner.ownerRecordHash, owner.manifestHash, owner.connectorSelectionFingerprint].every((value) => /^[a-f0-9]{64}$/.test(value))
    || !target || target.appId !== input.targetAppId || target.serviceId !== input.targetAppId
    || target.hostname !== input.targetAppId || target.projectId !== owner.projectId
    || target.frontNetworkId !== "front" || target.frontNetworkName !== `${owner.projectId}-front`
    || !Number.isInteger(target.targetPort) || target.targetPort < 1 || target.targetPort > 65535
    || ![target.ownerFingerprint, target.targetFingerprint, target.selectionFingerprint].every((value) => /^[a-f0-9]{64}$/.test(value))) {
    fail("route target or saved owner metadata differs from its private resolver");
  }
  const upstream = `http://${target.hostname}:${target.targetPort}`;
  const contract = { schemaVersion: 1, appId: "tailscale", owner: { ...owner }, target, input: { ...input },
    enrollArgv: [...TAILSCALE_ENROLL_ARGV], serveArgv: [...CLI, "serve", "--bg", `--https=${input.httpsPort}`, upstream],
    upstream, enrollmentVerified: false, clientAccessVerified: false };
  return { ...contract, contractHash: digest(contract) };
}

export type SharedTailscaleRoute = ReturnType<typeof planResolvedSharedTailscaleRoute>;

/** Reject all unrelated routes, file serving, forwarding, Funnel and services. */
export function verifyTailscaleServe(value: unknown, node: TailscaleNode, route: SharedTailscaleRoute): void {
  const config = object(value);
  for (const key of Object.keys(config)) {
    if (!["TCP", "Web", "AllowFunnel", "Services", "Foreground"].includes(key)) fail("Serve readback contains unknown routing fields");
  }
  for (const key of ["AllowFunnel", "Services", "Foreground"]) {
    if (config[key] !== undefined && config[key] !== null && Object.keys(object(config[key])).length !== 0) {
      fail("Funnel, service and foreground routes are prohibited");
    }
  }
  const port = String(route.input.httpsPort);
  const tcp = object(config.TCP);
  const web = object(config.Web);
  const expectedHost = `${node.dnsName}:${port}`;
  if (Object.keys(tcp).join() !== port || Object.keys(web).join() !== expectedHost
    || JSON.stringify(tcp[port]) !== JSON.stringify({ HTTPS: true })) fail("Serve route port or hostname differs");
  const server = object(web[expectedHost]);
  if (Object.keys(server).join() !== "Handlers") fail("Serve route contains unsupported server settings");
  const handlers = object(server.Handlers);
  if (Object.keys(handlers).join() !== "/") fail("Serve has an unrelated path");
  const handler = object(handlers["/"]);
  if (Object.keys(handler).join() !== "Proxy" || typeof handler.Proxy !== "string") fail("Serve is not an exact private proxy");
  let actual: URL;
  try { actual = new URL(handler.Proxy); }
  catch { fail("Serve returned an invalid private proxy target"); }
  if (actual.username || actual.password || actual.search || actual.hash
    || actual.pathname !== "/" || actual.origin !== route.upstream) fail("Serve upstream differs from the selected saved frontend");
}

export type TailscaleSetupFacilities = {
  appId: string; projectRoot: string; inputs: Readonly<Record<string, string>>;
  status(): Promise<unknown>;
  peers: { resolveTarget(appId: string): Promise<SharedServiceTarget> };
  container: { exec(command: SetupContainerCommand): Promise<SetupContainerResult> };
  checkpoint: { read(): Promise<SetupCheckpoint | null>; compareAndSet(next: SetupCheckpointUpdate): Promise<SetupCheckpoint> };
};

/** Per-command APP-SETUP transport approval is mandatory; this function holds no provider consent itself. */
export async function runSharedTailscaleSetup(context: TailscaleSetupFacilities) {
  const status = object(await context.status());
  if (context.appId !== "tailscale" || status.command !== "app status" || status.appId !== "tailscale"
    || status.projectRoot !== context.projectRoot || status.ownerKind !== "shared" || status.mutation !== false
    || status.status !== "connector-applied-unverified" || status.connector !== true
    || object(status.runtime).state !== "running" || status.port !== null || status.url !== null
    || status.frontendSharing !== "owner-front" || status.ownerPhase !== "completed"
    || typeof status.composeTarget !== "string") fail("needs the exact running portless shared connector");
  if (Object.keys(context.inputs).sort().join(",") !== "acl-owner,https-port,tailnet-domain,target-app-id"
    || !/^[0-9]{1,5}$/.test(context.inputs["https-port"] ?? "")) fail("select all four non-secret route inputs");
  const input: TailscaleRouteInput = { targetAppId: context.inputs["target-app-id"]!,
    tailnetDomain: context.inputs["tailnet-domain"]!, aclOwner: context.inputs["acl-owner"]!,
    httpsPort: Number(context.inputs["https-port"]) };
  const route = planResolvedSharedTailscaleRoute({ projectId: status.projectId, projectRoot: context.projectRoot,
    directory: dirname(status.composeTarget), ownerRevision: status.ownerRevision,
    ownerRecordHash: status.ownerRecordHash, manifestHash: status.manifestHash,
    connectorSelectionFingerprint: status.selectionFingerprint }, await context.peers.resolveTarget(input.targetAppId), input);
  let checkpoint = await context.checkpoint.read();
  if (checkpoint && checkpoint.data.routeHash !== route.contractHash) fail("saved setup route differs; no provider action was sent");
  if (!checkpoint) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: null,
    stage: "route-reviewed", data: { routeHash: route.contractHash, targetFingerprint: route.target.targetFingerprint,
      targetAppId: input.targetAppId, tailnetDomain: input.tailnetDomain, aclOwner: input.aclOwner, httpsPort: input.httpsPort } });
  async function read(argv: readonly string[], action: string) {
    const response = await context.container.exec({ effect: "read", argv: [...argv],
      approval: { action, progress: "Read private Tailscale daemon configuration from the exact saved container" } });
    if (response.exitCode !== 0) fail("private daemon read failed; inspect the saved owner");
    if (action === "tailscale-read-serve") return parseTailscaleServeReadback(response.stdout);
    return parseTailscaleReadback(response.stdout);
  }
  let nodeStatus = await read(TAILSCALE_STATUS_ARGV, "tailscale-read-node");
  let serveStatus = await read(TAILSCALE_SERVE_STATUS_ARGV, "tailscale-read-serve");
  if (object(nodeStatus).BackendState !== "Running") {
    if (checkpoint.attemptedActions.includes("tailscale-enroll")) fail("enrollment was attempted but is not verified; do not re-enroll");
    requireFreshTailscaleNode(nodeStatus, serveStatus);
    requireFreshTailscalePrefs(await read(TAILSCALE_PREFS_ARGV, "tailscale-read-prefs"));
    const enrolled = await context.container.exec({ effect: "write", argv: [...route.enrollArgv], privateFileRefs: ["auth-key"],
      approval: { action: "tailscale-enroll", progress: `Enroll only this saved userspace node in ${input.tailnetDomain}; ACL owner ${input.aclOwner}; imported owner-key file only`, once: true },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "enrollment-attempted", data: { routeHash: route.contractHash } } });
    if (enrolled.exitCode !== 0) fail("enrollment outcome is unresolved; inspect node status instead of replaying it");
    nodeStatus = await read(TAILSCALE_STATUS_ARGV, "tailscale-read-node");
    serveStatus = await read(TAILSCALE_SERVE_STATUS_ARGV, "tailscale-read-serve");
    checkpoint = await context.checkpoint.read();
    if (!checkpoint) fail("enrollment checkpoint disappeared");
  } else if (!checkpoint.attemptedActions.includes("tailscale-enroll")) {
    fail("registered identity is not owned by a saved enrollment attempt");
  }
  let savedNodeId: string | undefined;
  if (typeof checkpoint.data.nodeId === "string") savedNodeId = checkpoint.data.nodeId;
  const node = verifyTailscaleNode(nodeStatus, input.tailnetDomain, savedNodeId);
  verifyTailscalePrivatePrefs(await read(TAILSCALE_PREFS_ARGV, "tailscale-read-prefs"));
  if (!savedNodeId) checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
    stage: "node-enrolled", data: { nodeId: node.nodeId, dnsName: node.dnsName } });
  if (checkpoint.attemptedActions.includes("tailscale-activate-serve")) {
    verifyTailscaleServe(serveStatus, node, route);
  } else {
    requireEmptyTailscaleServe(serveStatus);
    const activated = await context.container.exec({ effect: "write", argv: [...route.serveArgv],
      approval: { action: "tailscale-activate-serve", progress: `Activate only private tailnet HTTPS ${input.httpsPort} to saved ${input.targetAppId}:${route.target.targetPort}; no Funnel`, once: true },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision, stage: "serve-attempted", data: { routeHash: route.contractHash, nodeId: node.nodeId } } });
    if (activated.exitCode !== 0) fail("Serve outcome is unresolved; inspect saved configuration instead of replaying it");
    serveStatus = await read(TAILSCALE_SERVE_STATUS_ARGV, "tailscale-read-serve");
    verifyTailscaleServe(serveStatus, node, route);
    checkpoint = await context.checkpoint.read();
    if (!checkpoint) fail("Serve checkpoint disappeared");
  }
  // Recheck identity and prohibited network prefs after activation, not only before it.
  verifyTailscaleNode(await read(TAILSCALE_STATUS_ARGV, "tailscale-read-node"), input.tailnetDomain, node.nodeId);
  verifyTailscalePrivatePrefs(await read(TAILSCALE_PREFS_ARGV, "tailscale-read-prefs"));
  await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: "private-serve-configured",
    data: { routeHash: route.contractHash, nodeId: node.nodeId, dnsName: node.dnsName } });
  let url = `https://${node.dnsName}`;
  if (input.httpsPort !== 443) url += `:${input.httpsPort}`;
  return { appId: "tailscale", projectRoot: context.projectRoot, stage: "private-serve-configured",
    enrollmentVerified: true, serveConfigurationVerified: true, clientAccessVerified: false,
    aclVerified: false, internetRouteAbsent: false, restartIdentityVerified: false,
    targetAppId: input.targetAppId, routeHash: route.contractHash, nodeIdentitySha256: digest(node.nodeId), url };
}
