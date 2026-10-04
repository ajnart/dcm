import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";
import { planPrivateConnector, type PrivateConnectorInput } from "../src/lib/connector-contract.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const imageTag = "docker.io/library/busybox:1.37.0";
function selection(appId: string, port: number) {
  return { appId, port, images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}` },
    recipe: { schemaVersion: 2, kind: "multi-service-compose", appId,
      services: [{ id: appId, imageTag, user: "image-default", imageUserEvidence: {
        officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [],
        fileEnvironment: [], mounts: [], dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [], defaults: { hostIp: "127.0.0.1" } } };
}
const candidate = sharedProjectCandidate({ projectRoot: "/tmp/connector-contract-synthetic", projectId: "connector-fixture",
  dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
  apps: [selection("alpha", 18080), selection("beta", 18081)],
  observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } });
const record = {
  schemaVersion: 1, revision: 3, manifestRevision: 1, previousHash: "b".repeat(64),
  project: { id: candidate.manifest.project.id, owner: candidate.manifest.project.owner,
    dockerContext: candidate.manifest.project.dockerContext, root: candidate.manifest.project.root,
    directory: candidate.manifest.project.directory },
  manifestHash: hash(candidate.manifest), manifest: candidate.manifest,
  units: candidate.units, selectionFingerprints: candidate.selectionFingerprints, settings: candidate.settings,
  checkpoint: { operation: "create", phase: "completed", appIds: ["alpha", "beta"] },
};
const state = { ...record, recordHash: hash(record) } as SharedProjectState;
const input: PrivateConnectorInput = { schemaVersion: 1, kind: "tailscale-private-serve",
  image: `ghcr.io/tailscale/tailscale:v1.102.4@sha256:${"c".repeat(64)}`,
  enrollmentFileId: "auth-key", aclOwner: "tailnet-admin", network: "front",
  settings: { userspace: true, authOnce: true, funnel: false, ssh: false, subnetRoutes: [], exitNode: false },
  routes: [{ appId: "beta", httpsPort: 8443 }, { appId: "alpha", httpsPort: 443 }] };
const before = JSON.stringify({ state, input });
const plan = planPrivateConnector(state, input);
assert.equal(JSON.stringify({ state, input }), before, "planning must not mutate saved identities or choices");
assert.equal(plan.authority, "read-only-plan");
assert.equal(plan.execution.publishTargetPort, null);
assert.deepEqual(plan.execution.hostPorts, []);
assert.equal(plan.execution.longRunning, true);
assert.equal(plan.execution.networkName, "connector-fixture-front");
assert.deepEqual(plan.routes.map((route) => [route.appId, route.httpsPort, route.upstream]),
  [["alpha", 443, "http://alpha:8080"], ["beta", 8443, "http://beta:8080"]]);
assert.equal(plan.watchedConfig.kind, "generated-directory");
const config = JSON.parse(plan.watchedConfig.content);
assert.deepEqual(config, { TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } }, Web: {
  "${TS_CERT_DOMAIN}:443": { Handlers: { "/": { Proxy: "http://alpha:8080" } } },
  "${TS_CERT_DOMAIN}:8443": { Handlers: { "/": { Proxy: "http://beta:8080" } } },
}, AllowFunnel: {} });
assert.equal(plan.contractSha256, planPrivateConnector(state, { ...input, routes: [...input.routes].reverse() }).contractSha256);
assert.equal(plan.enrollment.payloadIncluded, false);
assert.equal(plan.verification.enrolled, false);
assert.equal(plan.verification.aclVerified, false);
assert.equal(Object.hasOwn(plan, "approval"), false);
assert.ok(plan.requiredSeams.includes("portless-connector-compose-contract"));
assert.ok(plan.environment.some((item) => item.name === "TS_AUTHKEY" && item.value === "file:/run/secrets/auth-key"));
for (const field of ["funnel", "ssh", "exitNode"]) {
  assert.throws(() => planPrivateConnector(state, { ...input, settings: { ...input.settings, [field]: true } } as any), /no Funnel/);
}
assert.throws(() => planPrivateConnector(state, { ...input, settings: { ...input.settings, subnetRoutes: ["10.0.0.0/8"] } } as any), /subnet/);
assert.throws(() => planPrivateConnector(state, { ...input, settings: { ...input.settings, userspace: false } } as any), /userspace/);
for (const key of ["serveConfig", "extraArgs", "devices", "token", "hostNetwork"]) {
  assert.throws(() => planPrivateConnector(state, { ...input, [key]: "synthetic" } as any), /unsupported/);
}
assert.throws(() => planPrivateConnector(state, { ...input, image: input.image.replace("v1.102.4", "latest") }), /pinned image/);
assert.throws(() => planPrivateConnector(state, { ...input, routes: [{ appId: "unknown", httpsPort: 443 }] }), /selected application/);
assert.throws(() => planPrivateConnector(state, { ...input, routes: [{ appId: "alpha", httpsPort: 443, upstream: "http://elsewhere" }] } as any), /unsupported/);
assert.throws(() => planPrivateConnector(state, { ...input, routes: [{ appId: "alpha", httpsPort: 443 }, { appId: "beta", httpsPort: 443 }] }), /unique/);
assert.throws(() => planPrivateConnector(state, { ...input, routes: [{ appId: "alpha", httpsPort: 443 }, { appId: "alpha", httpsPort: 8443 }] }), /unique/);
assert.throws(() => planPrivateConnector(state, { ...input, routes: [{ appId: "alpha", httpsPort: 80 }] }), /high port/);
const stale = structuredClone(state);
stale.manifest.services[0]!.image = `${imageTag}@sha256:${"d".repeat(64)}`;
assert.throws(() => planPrivateConnector(stale, input), /hash-bound/);
const foreign = structuredClone(state);
foreign.project.id = "foreign";
const { recordHash: discarded, ...foreignRecord } = foreign;
foreign.recordHash = hash(foreignRecord);
assert.throws(() => planPrivateConnector(foreign, input), /owner identity/);
console.log("private connector planning contract fixture passed (no enrollment, apply or client acceptance)");
