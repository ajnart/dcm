import assert from "node:assert/strict";
import { approveDockerApiAuthorityIntent as approveIntent, planDockerApiAuthority, DOCKER_MANAGEMENT_DISCLOSURE,
  type DockerApiAuthorityInput } from "../src/lib/docker-api-authority.ts";

const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
const input: DockerApiAuthorityInput = {
  schemaVersion: 1, id: "portainer-engine",
  owner: { projectId: "catalog", revision: 1, recordSha256: "1".repeat(64), manifestSha256: "9".repeat(64) },
  consumer: { appId: "portainer", recipeSha256: "2".repeat(64), setupSha256: "3".repeat(64),
    images: [{ serviceId: "portainer", image: `docker.io/portainer/portainer-ce:2.45.1@sha256:${"a".repeat(64)}` }] },
  mode: "docker-management-mtls",
  endpoint: { privateIpv4: "192.168.50.2", port: 2376, serverName: "docker.home.arpa", expectedEngineId: "fixture-engine" },
  identities: { peerCertificateSha256: "4".repeat(64), caCertificateSha256: "5".repeat(64), clientCertificateSha256: "6".repeat(64) },
  credentialRefs: { ca: "docker-ca", clientCertificate: "docker-client-cert", clientKey: "docker-client-key" },
  expectedAuthorizationPolicySha256: null, expiresAt: "2026-10-03T13:00:00.000Z",
};

const plan = planDockerApiAuthority(input, nowMs);
assert.equal(plan.disclosure, DOCKER_MANAGEMENT_DISCLOSURE);
assert.equal(plan.connectionVerified, false);
const approved = approveIntent(plan, plan.approval, nowMs);
assert.equal(approved.state, "approved-intent");
assert.equal(approved.authorityVerified, false);
assert.equal(approved.usableForApplicationSetup, false);
assert.equal(approved.connectionVerified, false);
assert.equal(approved.authorizationVerified, false);
assert.deepEqual(input.consumer, plan.input.consumer);
assert.notEqual(input, plan.input);

for (const mutate of [
  (v: DockerApiAuthorityInput) => { v.consumer.appId = "dockge"; },
  (v: DockerApiAuthorityInput) => { v.consumer.recipeSha256 = "7".repeat(64); },
  (v: DockerApiAuthorityInput) => { v.consumer.setupSha256 = "7".repeat(64); },
  (v: DockerApiAuthorityInput) => { v.owner.revision = 2; },
  (v: DockerApiAuthorityInput) => { v.owner.recordSha256 = "7".repeat(64); },
  (v: DockerApiAuthorityInput) => { v.owner.manifestSha256 = "7".repeat(64); },
  (v: DockerApiAuthorityInput) => { v.consumer.images[0]!.image = `docker.io/portainer/portainer-ce:2.45.1@sha256:${"b".repeat(64)}`; },
  (v: DockerApiAuthorityInput) => { v.endpoint.privateIpv4 = "10.0.0.2"; },
  (v: DockerApiAuthorityInput) => { v.endpoint.serverName = "other.home.arpa"; },
  (v: DockerApiAuthorityInput) => { v.endpoint.expectedEngineId = "other-engine"; },
  (v: DockerApiAuthorityInput) => { v.identities.peerCertificateSha256 = "7".repeat(64); },
  (v: DockerApiAuthorityInput) => { v.identities.caCertificateSha256 = "7".repeat(64); },
  (v: DockerApiAuthorityInput) => { v.identities.clientCertificateSha256 = "7".repeat(64); },
  (v: DockerApiAuthorityInput) => { v.credentialRefs.clientKey = "other-key"; },
  (v: DockerApiAuthorityInput) => { v.expiresAt = "2026-10-03T12:30:00.000Z"; },
]) {
  const changed = structuredClone(input);
  mutate(changed);
  const replacement = planDockerApiAuthority(changed, nowMs);
  assert.notEqual(replacement.fingerprint, plan.fingerprint);
  assert.throws(() => approveIntent(replacement, plan.approval, nowMs), /authority/);
  assert.throws(() => approveIntent({ ...plan, input: changed }, plan.approval, nowMs), /authority/);
}

for (const address of ["8.8.8.8", "0.0.0.0", "127.0.0.1", "169.254.169.254", "::1", "docker.home.arpa", "192.168.050.2"]) {
  assert.throws(() => planDockerApiAuthority({ ...input, endpoint: { ...input.endpoint, privateIpv4: address } }, nowMs), /authority/);
}
for (const reference of ["/tmp/client-key", "../client-key", "file:/client-key", "inline secret"]) {
  assert.throws(() => planDockerApiAuthority({ ...input, credentialRefs: { ...input.credentialRefs, clientKey: reference } }, nowMs), /authority/);
}
assert.throws(() => planDockerApiAuthority({ ...input, verified: true } as DockerApiAuthorityInput, nowMs), /authority/);
assert.throws(() => planDockerApiAuthority({ ...input, evidence: { tlsVerified: true } } as DockerApiAuthorityInput, nowMs), /authority/);
assert.throws(() => planDockerApiAuthority({ ...input, endpoint: { ...input.endpoint,
  skipTlsVerification: true } } as DockerApiAuthorityInput, nowMs), /authority/);
assert.throws(() => planDockerApiAuthority({ ...input, identities: { ...input.identities,
  peerCertificateSha256: "sha256:" + "4".repeat(64) } }, nowMs), /authority/);
assert.throws(() => approveIntent({ ...plan, connectionVerified: true } as never, plan.approval, nowMs), /authority/);
assert.throws(() => approveIntent(plan, plan.approval, Date.parse(input.expiresAt)), /authority/);
assert.throws(() => approveIntent(plan, plan.approval, NaN), /authority/);
assert.throws(() => approveIntent({ ...plan, disclosure: "read-only" }, plan.approval, nowMs), /authority/);
assert.throws(() => approveIntent(plan, `APP-APPLY:${input.id}:${plan.fingerprint}`, nowMs), /authority/);

const inventory = { ...input, consumer: { ...input.consumer, appId: "wud" },
  mode: "docker-inventory-mtls" as const, expectedAuthorizationPolicySha256: "8".repeat(64) };
const inventoryPlan = planDockerApiAuthority(inventory, nowMs);
assert.notEqual(inventoryPlan.fingerprint, plan.fingerprint);
assert.match(inventoryPlan.disclosure, /does not make Docker read-only/);
assert.equal(approveIntent(inventoryPlan, inventoryPlan.approval, nowMs).authorizationVerified, false);
const changedPolicy = planDockerApiAuthority({ ...inventory, expectedAuthorizationPolicySha256: "9".repeat(64) }, nowMs);
assert.throws(() => approveIntent(changedPolicy, inventoryPlan.approval, nowMs), /authority/);
assert.throws(() => planDockerApiAuthority({ ...inventory, expectedAuthorizationPolicySha256: null }, nowMs), /authority/);
assert.throws(() => planDockerApiAuthority({ ...input, expectedAuthorizationPolicySha256: "8".repeat(64) }, nowMs), /authority/);
const reordered = Object.fromEntries(Object.entries(input).reverse()) as DockerApiAuthorityInput;
assert.equal(planDockerApiAuthority(reordered, nowMs).fingerprint, plan.fingerprint);
assert.deepEqual(approveIntent({ ...plan, input: reordered }, plan.approval, nowMs).plan, plan);
const explicitWudManagement = planDockerApiAuthority({ ...input,
  consumer: { ...input.consumer, appId: "wud" } }, nowMs);
assert.equal(explicitWudManagement.input.mode, "docker-management-mtls");
assert.equal(explicitWudManagement.disclosure, DOCKER_MANAGEMENT_DISCLOSURE);
assert.notEqual(explicitWudManagement.approval, inventoryPlan.approval);
assert.equal(explicitWudManagement.authorizationVerified, false);
assert.equal(approveIntent(explicitWudManagement, explicitWudManagement.approval, nowMs).usableForApplicationSetup, false);
assert.throws(() => planDockerApiAuthority({ ...input, consumer: { ...input.consumer, images: [] } }, nowMs), /authority/);
assert.throws(() => planDockerApiAuthority({ ...input, consumer: { ...input.consumer,
  images: [{ serviceId: "portainer", image: "portainer/portainer-ce:latest" }] } }, nowMs), /authority/);

process.stdout.write("Docker API authority planning/approval checks passed (pure fixtures; no verified authority or Docker)\n");
