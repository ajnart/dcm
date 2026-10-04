import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerApiAuthorityError, type DockerApiAuthorityInput } from "../src/lib/docker-api-authority.ts";
import { planSharedDockerAuthority, applySharedDockerAuthority, probeSharedDockerAuthority,
  loadSharedDockerAuthorityInput, readSharedDockerAuthorityChoices,
  requireBoundSharedDockerAuthorityForStart } from "../src/lib/shared-docker-authority.ts";

const root = await mkdtemp(join(tmpdir(), "shared-docker-authority-"));
const directory = join(root, "fixture");
await mkdir(directory, { mode: 0o700 });
let nowMs = Date.parse("2026-10-03T12:00:00.000Z");
const input: DockerApiAuthorityInput = { schemaVersion: 1, id: "wud-engine",
  owner: { projectId: "fixture", revision: 1, recordSha256: "1".repeat(64), manifestSha256: "2".repeat(64) },
  consumer: { appId: "wud", recipeSha256: "3".repeat(64), setupSha256: "4".repeat(64),
    images: [{ serviceId: "wud", image: `getwud/wud:9.1.0@sha256:${"5".repeat(64)}` }] },
  mode: "docker-management-mtls", endpoint: { privateIpv4: "192.168.50.2", port: 2376,
    serverName: "docker.example.test", expectedEngineId: "fixture-engine" },
  identities: { peerCertificateSha256: "6".repeat(64), caCertificateSha256: "7".repeat(64), clientCertificateSha256: "8".repeat(64) },
  credentialRefs: { ca: "docker-ca", clientCertificate: "docker-certificate", clientKey: "docker-key" },
  expectedAuthorizationPolicySha256: null, expiresAt: "2026-10-03T13:00:00.000Z" };
const binding = { directory, owner: input.owner, consumer: input.consumer };
const code = (expected: string) => (error: unknown) => error instanceof DockerApiAuthorityError && error.code === expected;
let revalidations = 0;
let requests = 0;
const facilities = { now: () => nowMs, async revalidate() { revalidations++; } };
const transport = async () => { requests++; return { httpStatus: 200,
  engineId: input.endpoint.expectedEngineId, peerCertificateSha256: input.identities.peerCertificateSha256 }; };
try {
  const { owner, consumer, ...choices } = input;
  const choicesPath = join(root, "authority-choices.json");
  await writeFile(choicesPath, JSON.stringify(choices), { mode: 0o600 });
  assert.deepEqual(await readSharedDockerAuthorityChoices(choicesPath, binding, nowMs), input);
  await writeFile(choicesPath, JSON.stringify(input));
  await assert.rejects(readSharedDockerAuthorityChoices(choicesPath, binding, nowMs), code("invalid-input"));
  await assert.rejects(loadSharedDockerAuthorityInput(binding, nowMs), code("missing-intent"));
  const review = planSharedDockerAuthority(binding, input, nowMs);
  assert.equal(review.applicationSetupReady, false);
  assert.throws(() => planSharedDockerAuthority({ ...binding, owner: { ...owner, revision: 2 } }, input, nowMs), code("stale-intent"));
  await assert.rejects(applySharedDockerAuthority(binding, input, "APPLY:fixture", facilities), code("approval-required"));
  const applied = await applySharedDockerAuthority(binding, input, review.approval, facilities);
  assert.equal(applied.applicationSetupReady, false);
  assert.deepEqual(await loadSharedDockerAuthorityInput(binding, nowMs), input);
  await assert.rejects(requireBoundSharedDockerAuthorityForStart(binding, facilities), code("probe-unknown"));
  await assert.rejects(probeSharedDockerAuthority(binding, review.approval, { ...facilities, transport }), code("approval-required"));
  assert.equal(requests, 0);
  const observed = await probeSharedDockerAuthority(binding, review.probeApproval, { ...facilities, transport });
  assert.equal(observed.usableForApplicationSetup, true);
  assert.equal(observed.authorizationVerified, false);
  assert.equal(requests, 1);
  assert(revalidations >= 7);
  nowMs += 300001;
  await assert.rejects(requireBoundSharedDockerAuthorityForStart(binding, facilities), code("probe-failed"));
  await probeSharedDockerAuthority(binding, review.probeApproval, { ...facilities, transport });
  assert.equal(requests, 2, "a separately approved fixed read refreshes expired observation without overwriting it");
  assert.equal((await requireBoundSharedDockerAuthorityForStart(binding, { ...facilities, transport })).connectionVerified, true);
  assert.equal(requests, 3, "each successful start independently rechecks exact mTLS identity before Docker mutation");
  const changed = { ...input, endpoint: { ...input.endpoint, port: 2377 } };
  const changedReview = planSharedDockerAuthority(binding, changed, nowMs);
  await assert.rejects(applySharedDockerAuthority(binding, changed, changedReview.approval, facilities), code("stale-intent"));
  await assert.rejects(probeSharedDockerAuthority(binding, review.probeApproval, { ...facilities,
    async revalidate() { throw new DockerApiAuthorityError("stale-intent"); }, transport }), code("stale-intent"));
  assert.equal(requests, 3);
  await assert.rejects(loadSharedDockerAuthorityInput(binding, Date.parse(input.expiresAt)), code("expired-intent"));
  assert.match(new DockerApiAuthorityError("expired-intent").message, /renewal is not supported/);
} finally { await rm(root, { recursive: true }); }
console.log("Shared Docker authority retained-input/intent/probe/refresh/start gates: pass (synthetic; no Docker/TLS/ACL acceptance)");
