import assert from "node:assert/strict";
import { decodeDockerApiAuthorityProfile, dockerApiAuthorityProfile } from "../src/lib/docker-api-authority-profile.ts";
import { assertDockerApiAuthorityBinding, planDockerApiAuthority, type DockerApiAuthorityInput } from "../src/lib/docker-api-authority.ts";

const profile = { version: 1, appId: "portainer", modes: ["docker-management-mtls"],
  sourceFiles: ["manifest.json", "recipe.json", "setup.ts"], additionalBoundaries: [] };
assert.equal(decodeDockerApiAuthorityProfile(profile, "portainer").appId, "portainer");
for (const change of [
  { ...profile, appId: "wud" }, { ...profile, modes: ["socket"] },
  { ...profile, sourceFiles: ["../setup.ts"] }, { ...profile, sourceFiles: [".env"] },
  { ...profile, sourceFiles: ["manifest.json", "manifest.json"] },
  { ...profile, sourceFiles: ["docker-authority.json", "manifest.json"] },
  { ...profile, grantVerified: true }, { ...profile, additionalBoundaries: ["../host"] },
]) assert.throws(() => decodeDockerApiAuthorityProfile(change, "portainer"), /profile/);
assert.equal(dockerApiAuthorityProfile("../portainer"), null);
assert.equal(dockerApiAuthorityProfile("homarr"), null);
assert.match(dockerApiAuthorityProfile("portainer")!.sourceSha256, /^[0-9a-f]{64}$/);
assert.deepEqual(dockerApiAuthorityProfile("dockge")!.additionalBoundaries, ["writable-stacks-tree"]);
assert.deepEqual(dockerApiAuthorityProfile("coolify")!.additionalBoundaries, ["host-ssh"]);

const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
const input: DockerApiAuthorityInput = {
  schemaVersion: 1, id: "wud-engine",
  owner: { projectId: "catalog", revision: 1, recordSha256: "1".repeat(64), manifestSha256: "2".repeat(64) },
  consumer: { appId: "wud", recipeSha256: "3".repeat(64), setupSha256: "4".repeat(64),
    images: [{ serviceId: "wud", image: `getwud/wud:9.1.0@sha256:${"a".repeat(64)}` }] },
  mode: "docker-inventory-mtls",
  endpoint: { privateIpv4: "192.168.50.2", port: 2376, serverName: "docker.home.arpa", expectedEngineId: "fixture-engine" },
  identities: { peerCertificateSha256: "5".repeat(64), caCertificateSha256: "6".repeat(64), clientCertificateSha256: "7".repeat(64) },
  credentialRefs: { ca: "docker-ca", clientCertificate: "docker-certificate", clientKey: "docker-key" },
  expectedAuthorizationPolicySha256: "8".repeat(64), expiresAt: "2026-10-03T13:00:00.000Z",
};
const inventory = planDockerApiAuthority(input, nowMs);
assert.match(inventory.disclosure, /deny-write/);
assert.throws(() => planDockerApiAuthority({ ...input, expectedAuthorizationPolicySha256: null }, nowMs), /authority/);
const management = planDockerApiAuthority({ ...input, mode: "docker-management-mtls", expectedAuthorizationPolicySha256: null }, nowMs);
assert.match(management.disclosure, /host-wide/);
assert.notEqual(inventory.approval, management.approval);
assert.equal(management.authorizationVerified, false);
assertDockerApiAuthorityBinding(input, structuredClone(input.consumer));
for (const consumer of [
  { ...input.consumer, recipeSha256: "9".repeat(64) },
  { ...input.consumer, setupSha256: "9".repeat(64) },
  { ...input.consumer, images: [{ ...input.consumer.images[0]!, serviceId: "other" }] },
]) assert.throws(() => assertDockerApiAuthorityBinding(input, consumer), /authority/);
assert.throws(() => planDockerApiAuthority({ ...input, consumer: { ...input.consumer, appId: "homarr" } }, nowMs), /authority/);
process.stdout.write("Docker authority app-profile fixtures passed; no Docker or live authority verified\n");
