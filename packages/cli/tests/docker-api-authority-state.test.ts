import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerApiAuthorityError, planDockerApiAuthority, type DockerApiAuthorityInput } from "../src/lib/docker-api-authority.ts";
import { dockerApiAuthorityRecordName, loadDockerApiAuthorityIntent, persistDockerApiAuthorityIntent }
  from "../src/lib/docker-api-authority-state.ts";
import { dockerApiAuthorityProbeApproval, loadDockerApiAuthorityObservation, probeDockerApiAuthority,
  requireDockerApiAuthorityForStart, observeDockerApiContainerImage, assertDockerApiContainerImageObservation }
  from "../src/lib/docker-api-authority-probe.ts";

const nowMs = Date.parse("2026-10-03T12:00:00.000Z");
const root = await mkdtemp(join(tmpdir(), "docker-authority-fixture-"));
const directory = join(root, "catalog");
await mkdir(directory, { mode: 0o700 });
const input: DockerApiAuthorityInput = {
  schemaVersion: 1, id: "portainer-engine",
  owner: { projectId: "catalog", revision: 1, recordSha256: "1".repeat(64), manifestSha256: "2".repeat(64) },
  consumer: { appId: "portainer", recipeSha256: "3".repeat(64), setupSha256: "4".repeat(64),
    images: [{ serviceId: "portainer", image: `docker.io/portainer/portainer-ce:2.45.1@sha256:${"5".repeat(64)}` }] },
  mode: "docker-management-mtls", endpoint: { privateIpv4: "192.168.50.2", port: 2376,
    serverName: "docker.home.arpa", expectedEngineId: "fixture-engine" },
  identities: { peerCertificateSha256: "6".repeat(64), caCertificateSha256: "7".repeat(64), clientCertificateSha256: "8".repeat(64) },
  credentialRefs: { ca: "docker-ca", clientCertificate: "docker-client-cert", clientKey: "docker-client-key" },
  expectedAuthorizationPolicySha256: null, expiresAt: "2026-10-03T13:00:00.000Z",
};
const code = (expected: string) => (error: unknown) => error instanceof DockerApiAuthorityError && error.code === expected;
let requests = 0; let revalidations = 0;
const facilities = { now: () => nowMs,
  async revalidate() { revalidations++; },
  async transport() {
    requests++;
    const intent = await loadDockerApiAuthorityIntent(directory, input, nowMs);
    assert.equal(intent.connectionVerified, false);
    const attempt = JSON.parse(await readFile(join(directory, dockerApiAuthorityRecordName(input, nowMs, "attempt")), "utf8"));
    assert.equal(attempt.record.method, "GET"); assert.equal(attempt.record.path, "/info");
    assert.equal(attempt.record.timeoutMs, 10000); assert.equal(attempt.record.maximumBytes, 262144);
    return { httpStatus: 200, engineId: "fixture-engine", peerCertificateSha256: "6".repeat(64) };
  },
};
try {
  const plan = planDockerApiAuthority(input, nowMs);
  await assert.rejects(loadDockerApiAuthorityIntent(directory, input, nowMs), code("missing-intent"));
  await assert.rejects(persistDockerApiAuthorityIntent(directory, input, "APPLY:catalog", nowMs), code("approval-required"));
  const intent = await persistDockerApiAuthorityIntent(directory, input, plan.approval, nowMs);
  assert.equal(intent.authorityVerified, false); assert.equal(intent.authorizationVerified, false);
  assert.deepEqual(await persistDockerApiAuthorityIntent(directory, input, plan.approval, nowMs + 1000), intent);
  const intentPath = join(directory, dockerApiAuthorityRecordName(input, nowMs, "intent"));
  assert.equal((await lstat(intentPath)).mode & 0o7777, 0o600);
  await assert.rejects(requireDockerApiAuthorityForStart(directory, input, nowMs), code("probe-unknown"));
  await assert.rejects(probeDockerApiAuthority(directory, input, plan.approval, facilities), code("approval-required"));
  assert.equal(requests, 0);
  const observation = await probeDockerApiAuthority(directory, input, dockerApiAuthorityProbeApproval(input, nowMs), facilities);
  assert.equal(requests, 1); assert(revalidations >= 3);
  assert.equal(observation.connectionVerified, true); assert.equal(observation.authorizationVerified, false);
  assert.equal(observation.authorityVerified, false); assert.equal(observation.usableForApplicationSetup, true);
  assert.deepEqual(await requireDockerApiAuthorityForStart(directory, input, nowMs), observation);
  assert.deepEqual(await probeDockerApiAuthority(directory, input, dockerApiAuthorityProbeApproval(input, nowMs), facilities), observation);
  assert.equal(requests, 1);
  const selectedContainerId = "b".repeat(64);
  const imageId = `sha256:${"c".repeat(64)}`;
  const repoDigest = `docker.io/library/alpine@sha256:${"d".repeat(64)}`;
  const readKinds: string[] = [];
  const sourceFacilities = { now: () => nowMs, revalidate: async () => {},
    transport: async (_directory: string, _input: DockerApiAuthorityInput,
      selection: { kind: string; containerId?: string; imageId?: string }) => {
      readKinds.push(selection.kind);
      let body: unknown = { ID: input.endpoint.expectedEngineId };
      if (selection.kind === "container") {
        assert.equal(selection.containerId, selectedContainerId);
        body = { Id: selectedContainerId, Image: imageId, Config: { Image: "docker.io/library/alpine:3.23.0" } };
      }
      if (selection.kind === "image") {
        assert.equal(selection.imageId, imageId);
        body = { Id: imageId, RepoDigests: [repoDigest], RepoTags: ["docker.io/library/alpine:3.23.0"] };
      }
      return { body, peerCertificateSha256: input.identities.peerCertificateSha256 };
    },
  };
  const source = await observeDockerApiContainerImage(directory, input, selectedContainerId, sourceFacilities);
  assert.deepEqual(readKinds, ["identity", "container", "image", "container", "identity"]);
  assert.equal(source.authorizationVerified, false);
  assert.equal(source.imageId, imageId);
  assert.equal(source.imageReference, "docker.io/library/alpine:3.23.0");
  assert.deepEqual(source.repoDigests, [repoDigest]);
  assertDockerApiContainerImageObservation(source, input, selectedContainerId, nowMs);
  assert.throws(() => assertDockerApiContainerImageObservation(structuredClone(source), input, selectedContainerId, nowMs), code("probe-failed"));
  assert.throws(() => assertDockerApiContainerImageObservation(source, input, "e".repeat(64), nowMs), code("probe-failed"));
  assert.throws(() => assertDockerApiContainerImageObservation(source, input, selectedContainerId, nowMs + 300001), code("probe-failed"));
  await assert.rejects(observeDockerApiContainerImage(directory, input, "../all", sourceFacilities), code("probe-failed"));
  for (const body of [{ ID: "wrong-engine" }, { Id: "e".repeat(64), Image: imageId },
    { Id: selectedContainerId, Image: "alpine:latest" }, { Id: imageId, RepoDigests: ["alpine:latest"] }]) {
    await assert.rejects(observeDockerApiContainerImage(directory, input, selectedContainerId, {
      ...sourceFacilities, transport: async (_directory, _input, selection) => {
        const normal = await sourceFacilities.transport(_directory, _input, selection);
        if (("ID" in body && selection.kind === "identity") || ("Image" in body && selection.kind === "container")
          || ("RepoDigests" in body && selection.kind === "image")) return { ...normal, body };
        return normal;
      },
    }), code("probe-failed"));
  }
  await assert.rejects(loadDockerApiAuthorityObservation(directory, input, nowMs + 300001), code("probe-failed"));
  const refreshed = await probeDockerApiAuthority(directory, input, dockerApiAuthorityProbeApproval(input, nowMs + 300001), {
    ...facilities, now: () => nowMs + 300001,
  });
  assert.equal(Date.parse(refreshed.observedAt), nowMs + 300001);
  assert.equal(requests, 2);
  assert.equal((await loadDockerApiAuthorityObservation(directory, input, nowMs + 300001)).connectionVerified, true);
  for (const changed of [{ ...input, owner: { ...input.owner, revision: 2 } },
    { ...input, endpoint: { ...input.endpoint, serverName: "other.home.arpa" } },
    { ...input, credentialRefs: { ...input.credentialRefs, clientKey: "other-key" } }]) {
    await assert.rejects(requireDockerApiAuthorityForStart(directory, changed, nowMs), code("missing-intent"));
  }
  const copyDirectory = join(root, "another", "catalog");
  await mkdir(copyDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(copyDirectory, dockerApiAuthorityRecordName(input, nowMs, "intent")), await readFile(intentPath), { mode: 0o600 });
  await assert.rejects(loadDockerApiAuthorityIntent(copyDirectory, input, nowMs), code("unsafe-state"));
  await chmod(intentPath, 0o644);
  await assert.rejects(loadDockerApiAuthorityIntent(directory, input, nowMs), code("unsafe-state"));
  await chmod(intentPath, 0o600);
  await link(intentPath, join(directory, "extra-link"));
  await assert.rejects(loadDockerApiAuthorityIntent(directory, input, nowMs), code("unsafe-state"));
  await rm(join(directory, "extra-link"));
  const alias = join(root, "alias"); await symlink(directory, alias);
  await assert.rejects(loadDockerApiAuthorityIntent(alias, input, nowMs), code("unsafe-state"));

  for (const [id, transport] of [["failed-probe", async () => { throw new Error("sensitive upstream payload"); }],
    ["wrong-engine", async () => ({ httpStatus: 200, engineId: "other-engine", peerCertificateSha256: "6".repeat(64) })],
    ["wrong-peer", async () => ({ httpStatus: 200, engineId: "fixture-engine", peerCertificateSha256: "9".repeat(64) })]] as const) {
    const current = { ...input, id }; const currentPlan = planDockerApiAuthority(current, nowMs);
    await persistDockerApiAuthorityIntent(directory, current, currentPlan.approval, nowMs);
    let failedRequests = 0;
    const failed = { now: () => nowMs, revalidate: async () => {}, transport: async () => { failedRequests++; return transport(); } };
    await assert.rejects(probeDockerApiAuthority(directory, current, dockerApiAuthorityProbeApproval(current, nowMs), failed), code("probe-failed"));
    await assert.rejects(probeDockerApiAuthority(directory, current, dockerApiAuthorityProbeApproval(current, nowMs), failed), code("probe-failed"));
    assert.equal(failedRequests, 2);
  }
  const inventory: DockerApiAuthorityInput = { ...input, id: "wud-engine", mode: "docker-inventory-mtls",
    consumer: { ...input.consumer, appId: "wud" }, expectedAuthorizationPolicySha256: "a".repeat(64) };
  const inventoryPlan = planDockerApiAuthority(inventory, nowMs);
  await persistDockerApiAuthorityIntent(directory, inventory, inventoryPlan.approval, nowMs);
  const inventoryObservation = await probeDockerApiAuthority(directory, inventory,
    dockerApiAuthorityProbeApproval(inventory, nowMs), { now: () => nowMs, revalidate: async () => {},
      transport: async () => ({ httpStatus: 200, engineId: "fixture-engine", peerCertificateSha256: "6".repeat(64) }) });
  assert.equal(inventoryObservation.authorizationVerified, false);
  assert.equal(inventoryObservation.usableForApplicationSetup, false);
  await assert.rejects(requireDockerApiAuthorityForStart(directory, inventory, nowMs), code("policy-unverified"));
  const sourceReadCount = readKinds.length;
  await assert.rejects(observeDockerApiContainerImage(directory, inventory, selectedContainerId, sourceFacilities), code("policy-unverified"));
  assert.equal(readKinds.length, sourceReadCount);
  assert.equal((await loadDockerApiAuthorityIntent(directory, inventory, nowMs)).authorityVerified, false);
} finally { await rm(root, { recursive: true }); }
console.log("Docker API authority durable intent/probe/replay: pass (synthetic transport; no TLS/ACL or endpoints exercised)");
