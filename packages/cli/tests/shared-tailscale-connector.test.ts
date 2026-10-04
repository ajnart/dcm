import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";
import { loadAppRecipe, loadCatalog } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { parseTailscaleReadback, parseTailscaleServeReadback, planSharedTailscaleRoute, requireFreshTailscaleNode,
  requireEmptyTailscaleServe, verifyTailscaleNode, verifyTailscalePrivatePrefs,
  verifyTailscaleServe, TAILSCALE_ENROLL_ARGV, runSharedTailscaleSetup,
  type TailscaleSetupFacilities } from "../src/lib/shared-tailscale-connector.ts";
import type { SetupCheckpoint } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/tailscale/setup.ts";
import { resolveSetupInputDefinitions, resolveSetupInputs, setupAdapterAvailable } from "../src/control-panel/setup-engine.ts";

assert.equal(await setupAdapterAvailable("tailscale"), true);
assert.deepEqual((await resolveSetupInputDefinitions(["tailscale"])).map(({ appId, key }) => ({ appId, key })), [
  { appId: "tailscale", key: "target-app-id" },
  { appId: "tailscale", key: "tailnet-domain" },
  { appId: "tailscale", key: "acl-owner" },
  { appId: "tailscale", key: "https-port" },
]);

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const catalog = await loadCatalog();
const { recipe } = await loadAppRecipe(catalog, "tailscale");
const peerTag = "docker.io/library/busybox:1.37.0";
const candidate = sharedProjectCandidate({ projectRoot: "/tmp/tailscale-connector-synthetic", projectId: "tailnet-fixture",
  dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [
    { appId: "tailscale", port: null, recipe, images: { tailscale: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` } },
    { appId: "alpha", port: 18080, images: { alpha: `${peerTag}@sha256:${"b".repeat(64)}` }, recipe: {
      schemaVersion: 2, kind: "multi-service-compose", appId: "alpha", services: [{ id: "alpha", imageTag: peerTag,
        user: "image-default", imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [], fileEnvironment: [], mounts: [],
        dependsOn: [], publishTargetPort: 8080 }], privateFiles: [], defaults: { hostIp: "127.0.0.1" } } },
  ], observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } });
const connector = candidate.manifest.services.find((service) => service.id === "tailscale")!;
assert.deepEqual(connector.ports, []);
assert.deepEqual(connector.entrypoint, ["/usr/local/bin/tailscaled"]);
assert.deepEqual(connector.command, ["--tun=userspace-networking", "--state=/var/lib/tailscale/tailscaled.state", "--socket=/tmp/tailscaled.sock"]);
assert.ok(connector.networks.includes("front"));
assert.ok(!connector.networks.includes("alpha-private"));
assert.ok(connector.environment.some((binding) => binding.name === "TS_AUTHKEY" && binding.value === "file:/run/secrets/auth-key"));
const record = { schemaVersion: 1, revision: 3, manifestRevision: 1, previousHash: "c".repeat(64),
  project: { id: candidate.manifest.project.id, owner: candidate.manifest.project.owner,
    dockerContext: candidate.manifest.project.dockerContext, root: candidate.manifest.project.root,
    directory: candidate.manifest.project.directory },
  manifestHash: hash(candidate.manifest), manifest: candidate.manifest, units: candidate.units,
  selectionFingerprints: candidate.selectionFingerprints, settings: candidate.settings,
  checkpoint: { operation: "create", phase: "completed", appIds: ["alpha", "tailscale"] } };
const owner = { ...record, recordHash: hash(record) } as SharedProjectState;
const input = { targetAppId: "alpha", tailnetDomain: "tail-synthetic.ts.net", aclOwner: "tailnet-admin", httpsPort: 443 };
const consumerInputs = { "target-app-id": input.targetAppId, "tailnet-domain": input.tailnetDomain,
  "acl-owner": input.aclOwner, "https-port": String(input.httpsPort) };
const resolvedInputs = await resolveSetupInputs(["tailscale"], { tailscale: consumerInputs });
assert.deepEqual(resolvedInputs.tailscale, consumerInputs);
const route = planSharedTailscaleRoute(owner, input);
assert.deepEqual(route.serveArgv, ["/usr/local/bin/tailscale", "--socket=/tmp/tailscaled.sock", "serve", "--bg", "--https=443", "http://alpha:8080"]);
assert.ok(TAILSCALE_ENROLL_ARGV.includes("--auth-key=file:/run/secrets/auth-key"));
assert.ok(TAILSCALE_ENROLL_ARGV.every((arg) => !arg.startsWith("tskey-")));
assert.equal(route.enrollmentVerified, false);
assert.equal(route.clientAccessVerified, false);
assert.equal(Object.hasOwn(route, "approved"), false);
assert.throws(() => planSharedTailscaleRoute(owner, { ...input, approved: true } as any), /select one/);
assert.throws(() => planSharedTailscaleRoute(owner, { ...input, targetAppId: "unknown" }), /selected application/);

requireFreshTailscaleNode({ BackendState: "NeedsLogin", HaveNodeKey: false, CurrentTailnet: null, AuthURL: "", Self: null }, {});
requireFreshTailscaleNode({ BackendState: "NeedsLogin", CurrentTailnet: null, AuthURL: "", Self: null }, {});
requireFreshTailscaleNode({ BackendState: "NeedsLogin", CurrentTailnet: null, AuthURL: "", Self: null }, parseTailscaleServeReadback("null\n"));
assert.throws(() => requireFreshTailscaleNode({ BackendState: "Running", HaveNodeKey: true }, {}), /fresh/);
assert.throws(() => requireEmptyTailscaleServe({ AllowFunnel: { "node.ts.net:443": true } }), /existing/);
const status = { BackendState: "Running", HaveNodeKey: true, ExitNodeStatus: null,
  CurrentTailnet: { MagicDNSSuffix: input.tailnetDomain },
  Self: { ID: "node-synthetic", DNSName: `node.${input.tailnetDomain}.`, Online: true, TailscaleIPs: ["100.64.0.1"] } };
const node = verifyTailscaleNode(status, input.tailnetDomain, "node-synthetic");
assert.deepEqual(node, { nodeId: "node-synthetic", dnsName: `node.${input.tailnetDomain}`, tailnetDomain: input.tailnetDomain });
assert.throws(() => verifyTailscaleNode(status, "other.ts.net"), /reviewed tailnet/);
assert.throws(() => verifyTailscaleNode(status, input.tailnetDomain, "different-node"), /saved identity/);
  const prefs = { RouteAll: false, CorpDNS: false, RunSSH: false, RunWebClient: false, WantRunning: true,
  ExitNodeAllowLANAccess: false, ExitNodeID: "", ExitNodeIP: "", AdvertiseRoutes: null, AdvertiseServices: null,
  AppConnector: { Advertise: false }, RemoteConfig: false, AdvertiseTags: null };
verifyTailscalePrivatePrefs(prefs);
for (const field of ["RouteAll", "CorpDNS", "RunSSH", "RunWebClient", "ExitNodeAllowLANAccess", "RemoteConfig"]) {
  assert.throws(() => verifyTailscalePrivatePrefs({ ...prefs, [field]: true }), /not allowed/);
}
assert.throws(() => verifyTailscalePrivatePrefs({ ...prefs, AdvertiseRoutes: ["0.0.0.0/0"] }), /not allowed/);
assert.throws(() => verifyTailscalePrivatePrefs({ ...prefs, ExitNodeID: "remote-node" }), /not allowed/);
const config = { TCP: { "443": { HTTPS: true } }, Web: { [`${node.dnsName}:443`]: { Handlers: { "/": { Proxy: route.upstream } } } } };
verifyTailscaleServe(config, node, route);
assert.throws(() => verifyTailscaleServe({ ...config, AllowFunnel: { [`${node.dnsName}:443`]: true } }, node, route), /Funnel/);
assert.throws(() => verifyTailscaleServe({ ...config, Services: { "svc:other": {} } }, node, route), /service/);
assert.throws(() => verifyTailscaleServe({ ...config, TCP: { ...config.TCP, "8443": { HTTPS: true } } }, node, route), /port or hostname/);
const wrong = structuredClone(config);
wrong.Web[`${node.dnsName}:443`].Handlers["/"].Proxy = "http://unowned:8080";
assert.throws(() => verifyTailscaleServe(wrong, node, route), /upstream differs/);
assert.deepEqual(parseTailscaleReadback(JSON.stringify(status)), status);
assert.equal(parseTailscaleServeReadback("null\n"), null);
assert.throws(() => parseTailscaleReadback("provider private failure synthetic"), /bounded JSON/);
function setupFixture() {
  let checkpoint: SetupCheckpoint | null = null;
  let enrolled = false;
  let serve: unknown = null;
  let loseEnrollmentResponse = false;
  let loseServeResponse = false;
  let unresolvedEnrollment = false;
  let unresolvedServe = false;
  const approvedActions = new Set<string>();
  const writes: string[] = [];
  const projectRoot = "/tmp/tailscale-connector-synthetic";
  const context: TailscaleSetupFacilities = {
    appId: "tailscale", projectRoot,
    inputs: { ...resolvedInputs.tailscale },
    async status() { return { command: "app status", appId: "tailscale", projectRoot,
      projectId: owner.project.id, ownerKind: "shared", mutation: false,
      status: "connector-applied-unverified", connector: true, frontendSharing: "owner-front",
      port: null, url: null, runtime: { state: "running" },
      composeTarget: `${owner.project.directory}/compose.${"a".repeat(16)}.yaml`,
      ownerRevision: owner.revision, ownerRecordHash: owner.recordHash, ownerPhase: "completed",
      manifestHash: owner.manifestHash, selectionFingerprint: owner.selectionFingerprints.tailscale }; },
    peers: { async resolveTarget() { return route.target; } },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(next) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "tailscale", projectRoot,
          revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
          data: { ...checkpoint?.data, ...next.data }, attemptedActions: checkpoint?.attemptedActions ?? [] };
        return checkpoint;
      },
    },
    container: { async exec(command) {
      if (command.effect === "read") {
        let value: unknown;
        if (command.approval.action === "tailscale-read-node") {
          value = { BackendState: "NeedsLogin", CurrentTailnet: null, Self: null, AuthURL: "" };
          if (enrolled) value = status;
        } else if (command.approval.action === "tailscale-read-serve") value = serve;
        else if (command.approval.action === "tailscale-read-prefs") {
          value = prefs;
          if (!enrolled) value = { ...prefs, CorpDNS: true, WantRunning: false };
        }
        else throw new Error("Unexpected private read action");
        return { exitCode: 0, stdout: JSON.stringify(value) };
      }
      const action = command.approval.action;
      if (!approvedActions.has(action)) throw new Error("Separate APP-SETUP step required");
      assert.equal(command.approval.once, true);
      assert.ok(command.beforeSendCheckpoint);
      await context.checkpoint.compareAndSet(command.beforeSendCheckpoint!);
      checkpoint!.attemptedActions.push(action);
      writes.push(action);
      if (action === "tailscale-enroll") {
        assert.deepEqual(command.argv, [...TAILSCALE_ENROLL_ARGV]);
        assert.deepEqual(command.privateFileRefs, ["auth-key"]);
        if (unresolvedEnrollment) throw new Error("Synthetic unobserved enrollment response");
        enrolled = true;
        if (loseEnrollmentResponse) throw new Error("Synthetic lost enrollment response");
      } else {
        assert.equal(action, "tailscale-activate-serve");
        assert.deepEqual(command.argv, route.serveArgv);
        if (unresolvedServe) throw new Error("Synthetic unobserved Serve response");
        serve = config;
        if (loseServeResponse) throw new Error("Synthetic lost Serve response");
      }
      return { exitCode: 0, stdout: "" };
    } },
  };
  return { context, writes, approvedActions,
    loseEnrollment() { loseEnrollmentResponse = true; }, loseServe() { loseServeResponse = true; },
    unobservedEnrollment() { unresolvedEnrollment = true; }, unobservedServe() { unresolvedServe = true; } };
}
const setup = setupFixture();
await assert.rejects(runSharedTailscaleSetup(setup.context), /Separate APP-SETUP/);
assert.deepEqual(setup.writes, []);
setup.approvedActions.add("tailscale-enroll");
await assert.rejects(runSharedTailscaleSetup(setup.context), /Separate APP-SETUP/);
assert.deepEqual(setup.writes, ["tailscale-enroll"]);
setup.approvedActions.add("tailscale-activate-serve");
const configured = await runSharedTailscaleSetup(setup.context);
assert.equal(adapter.sharedOwner, true);
assert.equal(adapter.ready(configured), true);
assert.equal(adapter.ready({ ...configured, clientAccessVerified: true }), false);
assert.equal(adapter.apiKey, "not-created");
assert.equal(adapter.homarrIntegration, null);
assert.equal(configured.enrollmentVerified, true);
assert.equal(configured.serveConfigurationVerified, true);
assert.equal(configured.clientAccessVerified, false);
assert.equal(configured.aclVerified, false);
await runSharedTailscaleSetup(setup.context);
assert.deepEqual(setup.writes, ["tailscale-enroll", "tailscale-activate-serve"]);
for (const lostStage of ["enrollment", "Serve"]) {
  const recovery = setupFixture();
  recovery.approvedActions.add("tailscale-enroll");
  recovery.approvedActions.add("tailscale-activate-serve");
  if (lostStage === "enrollment") recovery.loseEnrollment();
  else recovery.loseServe();
  await assert.rejects(runSharedTailscaleSetup(recovery.context), /Synthetic lost/);
  await runSharedTailscaleSetup(recovery.context);
  assert.deepEqual(recovery.writes, ["tailscale-enroll", "tailscale-activate-serve"], "Observed recovery must not replay provider writes");
}
for (const missing of ["enrollment", "Serve"]) {
  const unresolved = setupFixture();
  unresolved.approvedActions.add("tailscale-enroll");
  unresolved.approvedActions.add("tailscale-activate-serve");
  if (missing === "enrollment") unresolved.unobservedEnrollment();
  else unresolved.unobservedServe();
  await assert.rejects(runSharedTailscaleSetup(unresolved.context), /Synthetic unobserved/);
  const writesBefore = [...unresolved.writes];
  await assert.rejects(runSharedTailscaleSetup(unresolved.context), /do not re-enroll|invalid private readback/);
  assert.deepEqual(unresolved.writes, writesBefore);
}
console.log("Tailscale inert recipe, exact activation approvals and no-replay fixture passed (synthetic; no provider operations)");
