import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompatibilityReceipts, publishCompatibilityObservation,
  type CompatibilityReceiptContract, type VerifiedRunObservation } from "../src/lib/compatibility-receipts.ts";
import { requiredCompatibilityChecks, scoreCatalogCompatibility } from "../src/lib/catalog-compatibility.ts";

const hash = "a".repeat(64);
const contract: CompatibilityReceiptContract = {
  appId: "example-app", dimension: "compose", homarrMode: "tile-only",
  owner: { projectFingerprint: hash, revision: 2, manifestHash: "b".repeat(64) },
  recipeSha256: "c".repeat(64), subjectSha256: "d".repeat(64),
  images: { app: `example.invalid/app:1@sha256:${"e".repeat(64)}`,
    db: `example.invalid/db:2@sha256:${"f".repeat(64)}` },
  verifier: { id: "compose-owner-verifier", sourceSha256: "1".repeat(64), release: "1.1.0" },
};
function observation(runId = "run-1", checkedAt = "2026-10-03T10:00:00Z"): VerifiedRunObservation {
  const { homarrMode: _mode, ...identity } = structuredClone(contract);
  return { ...identity, runId, checkedAt, cleanup: "completed",
    checks: requiredCompatibilityChecks(contract.dimension, contract.homarrMode).map((id) => ({ id, result: "pass" })) };
}
const options = { checkedAt: "2026-10-03T15:00:00Z" };
const base = await mkdtemp(join(tmpdir(), "compatibility-receipts-fixture-"));
let sequence = 0;
async function root(): Promise<string> {
  const path = join(base, `evidence-${++sequence}`);
  await mkdir(path, { mode: 0o700 });
  return path;
}
function score(receipts: Awaited<ReturnType<typeof loadCompatibilityReceipts>>["receipts"]) {
  return scoreCatalogCompatibility([{ appId: contract.appId, name: "Example", homarrMode: contract.homarrMode,
    recipeSha256: contract.recipeSha256, imageTags: contract.images,
    dimensions: { compose: { state: "declared", subjectSha256: contract.subjectSha256, reason: "Fixture contract." } } }],
  { checkedAt: options.checkedAt, evidence: receipts });
}
try {
  const primary = await root();
  assert.equal((await loadCompatibilityReceipts(primary, [contract], options)).revision, 0);
  const first = await publishCompatibilityObservation(primary, observation(), contract, { expectedRevision: 0 });
  assert.equal(first.receipt?.result, "pass");
  assert.equal(first.revision, 1);
  assert.equal(first.artifact.path, "evidence/run-1/example-app/compose.json");
  assert.equal((await lstat(join(primary, first.artifact.path))).mode & 0o777, 0o600);
  assert.equal((await lstat(join(primary, "registry/revision-000001.json"))).mode & 0o777, 0o600);
  const pinned = { revision: first.revision, registryHash: first.registryHash };
  assert.equal((await loadCompatibilityReceipts(primary, [contract], { ...options, expectedRegistry: pinned })).receipts.length, 1);
  await assert.rejects(() => loadCompatibilityReceipts(primary, [contract], {
    ...options, expectedRegistry: { ...pinned, registryHash: hash },
  }), /caller-pinned tip/);
  await assert.rejects(() => publishCompatibilityObservation(primary, observation(), contract,
    { expectedRevision: 1, expectedRegistryHash: hash }), /compare-and-set/);
  let loaded = await loadCompatibilityReceipts(primary, [contract], options);
  assert.equal(loaded.receipts.length, 1);
  assert.equal(score(loaded.receipts).aggregate, 20);
  assert.equal((await publishCompatibilityObservation(primary, observation(), contract, { expectedRevision: 1 })).reused, true);
  assert.equal((await publishCompatibilityObservation(primary, observation(), contract,
    { expectedRevision: 1, expectedRegistryHash: pinned.registryHash })).reused, true);
  await assert.rejects(() => publishCompatibilityObservation(primary, observation(), contract, { expectedRevision: 0 }), /compare-and-set/);
  await assert.rejects(() => publishCompatibilityObservation(primary,
    { ...observation(), cleanup: "pending" }, contract, { expectedRevision: 1 }), /already exists/);

  const negative = observation("run-2", "2026-10-03T11:00:00Z");
  negative.checks[1].result = "fail";
  negative.checks[2].result = "not-run";
  negative.cleanup = "pending";
  const second = await publishCompatibilityObservation(primary, negative, contract, { expectedRevision: 1 });
  assert.equal(second.receipt?.result, "fail");
  assert.deepEqual(second.receipt?.checks, ["fresh-compose-apply", "private-exposure"]);
  assert.equal((await loadCompatibilityReceipts(primary, [contract], { ...options, requiredAnchors: [pinned] })).revision, 2,
    "A required older prefix permits a legitimate later registry append");
  await assert.rejects(loadCompatibilityReceipts(primary, [contract], { ...options, expectedRegistry: pinned }), /caller-pinned tip/,
    "Exact-tip callers retain strict behavior after prefix support");
  await assert.rejects(loadCompatibilityReceipts(primary, [contract], { ...options,
    requiredAnchors: [{ ...pinned, registryHash: hash }] }), /required registry anchor/,
    "A current valid tail cannot mask a changed older anchor");
  await assert.rejects(loadCompatibilityReceipts(primary, [contract], { ...options,
    requiredAnchors: [{ revision: 3, registryHash: second.registryHash }] }), /required registry anchor/,
    "A required missing future prefix rejects rollback");
  assert.equal((await loadCompatibilityReceipts(primary, [contract], { ...options,
    requiredAnchors: [pinned, { revision: second.revision, registryHash: second.registryHash }] })).revision, 2,
    "Each independent anchor is checked against its actual hash-linked revision");
  loaded = await loadCompatibilityReceipts(primary, [contract], options);
  assert.equal(score(loaded.receipts).aggregate, 0);
  assert.equal(score(loaded.receipts).apps[0].rating, "broken");
  await publishCompatibilityObservation(primary, observation("run-3", "2026-10-03T12:00:00Z"), contract, { expectedRevision: 2 });
  loaded = await loadCompatibilityReceipts(primary, [contract], options);
  assert.equal(score(loaded.receipts).aggregate, 20, "New complete proof restores the dimension.");

  for (const current of [
    { ...contract, recipeSha256: hash }, { ...contract, subjectSha256: hash },
    { ...contract, images: { ...contract.images, db: `example.invalid/db:3@sha256:${hash}` } },
    { ...contract, owner: { ...contract.owner, revision: 3 } },
    { ...contract, verifier: { ...contract.verifier, sourceSha256: hash } },
    { ...contract, verifier: { ...contract.verifier, release: "1.2.0" } },
  ]) {
    const mismatched = await loadCompatibilityReceipts(primary, [current], options);
    assert.equal(mismatched.receipts.length, 0);
    assert.equal(mismatched.observations.length, 3, "Historical observations remain visible without credit.");
  }
  assert.equal((await loadCompatibilityReceipts(primary, [contract], { checkedAt: "2027-10-03T15:00:00Z" })).receipts.length, 0);
  assert.equal((await loadCompatibilityReceipts(primary, [contract], { checkedAt: "2026-10-02T15:00:00Z" })).receipts.length, 0);

  for (const partial of [
    { ...observation("run-2", "2026-10-03T11:00:00Z"), cleanup: "pending" as const },
    { ...observation("run-2", "2026-10-03T11:00:00Z"), checks: [{ id: "fresh-compose-apply", result: "pass" as const }] },
  ]) {
    const selectedRoot = await root();
    await publishCompatibilityObservation(selectedRoot, observation(), contract, { expectedRevision: 0 });
    const published = await publishCompatibilityObservation(selectedRoot, partial, contract, { expectedRevision: 1 });
    assert.equal(published.receipt, null);
    const selected = await loadCompatibilityReceipts(selectedRoot, [contract], options);
    assert.equal(selected.observations.length, 2);
    assert.equal(selected.receipts.length, 0, "New incomplete/cleanup-pending observation withholds old positive credit.");
    await publishCompatibilityObservation(selectedRoot, observation("run-3", "2026-10-03T12:00:00Z"), contract, { expectedRevision: 2 });
    assert.equal(score((await loadCompatibilityReceipts(selectedRoot, [contract], options)).receipts).aggregate, 20);
  }
  const allNotRun = await root();
  const untouched = observation();
  untouched.checks.forEach((check) => { check.result = "not-run"; });
  assert.equal((await publishCompatibilityObservation(allNotRun, untouched, contract, { expectedRevision: 0 })).receipt, null);
  assert.equal((await loadCompatibilityReceipts(allNotRun, [contract], options)).observations.length, 1);
  const lostTail = await root();
  const priorTail = await publishCompatibilityObservation(lostTail, observation(), contract,
    { expectedRevision: 0, expectedRegistryHash: null });
  const tail = await publishCompatibilityObservation(lostTail, negative, contract,
    { expectedRevision: 1, expectedRegistryHash: priorTail.registryHash });
  await unlink(join(lostTail, "registry/revision-000002.json"));
  assert.equal((await loadCompatibilityReceipts(lostTail, [contract], options)).revision, 1,
    "Without an independent expected tip, an intact prefix cannot reveal tail loss.");
  await assert.rejects(() => loadCompatibilityReceipts(lostTail, [contract], {
    ...options, expectedRegistry: { revision: tail.revision, registryHash: tail.registryHash },
  }), /caller-pinned tip/);
  await assert.rejects(() => loadCompatibilityReceipts(lostTail, [contract], {
    ...options, expectedRegistry: { revision: 0, registryHash: hash },
  }), /tip is invalid/);

  // Schema guards never print or persist unexpected input fields or raw payloads.
  const malformedRoot = await root();
  for (const bad of [
    { ...observation(), body: "not-allowed" }, { ...observation(), kind: "fixture" },
    { ...observation(), owner: { ...contract.owner, path: "/private/project" } },
    { ...observation(), verifier: { ...contract.verifier, cookie: "not-allowed" } },
    { ...observation(), images: { app: "https://user:password@example.invalid" } },
    { ...observation(), runId: "../escape" }, { ...observation(), runId: "private-handoff" },
    { ...observation(), checkedAt: "2026-02-30T10:00:00Z" },
    { ...observation(), checks: [{ id: "not-required", result: "pass" }] },
    { ...observation(), checks: [observation().checks[0], observation().checks[0]] },
    { ...observation(), checks: [...observation().checks].reverse() },
    { ...observation(), recipeSha256: hash },
  ]) await assert.rejects(() => publishCompatibilityObservation(malformedRoot, bad as VerifiedRunObservation, contract,
    { expectedRevision: 0 }));
  assert.equal((await loadCompatibilityReceipts(malformedRoot, [contract], options)).revision, 0);

  const unlisted = await root();
  await mkdir(join(unlisted, "evidence"), { mode: 0o700 });
  await writeFile(join(unlisted, "evidence/unlisted.json"), JSON.stringify({ kind: "live", result: "pass" }), { mode: 0o600 });
  assert.equal((await loadCompatibilityReceipts(unlisted, [contract], options)).receipts.length, 0);
  const artifactPath = join(primary, first.artifact.path);
  const original = await readFile(artifactPath, "utf8");
  await writeFile(artifactPath, `${original} `);
  await assert.rejects(() => loadCompatibilityReceipts(primary, [contract], options), /hash changed/);
  await writeFile(artifactPath, original);
  await chmod(artifactPath, 0o644);
  await assert.rejects(() => loadCompatibilityReceipts(primary, [contract], options), /unsafe/);
  await chmod(artifactPath, 0o600);
  await link(artifactPath, join(primary, "extra-link"));
  await assert.rejects(() => loadCompatibilityReceipts(primary, [contract], options), /unsafe/);
  await unlink(join(primary, "extra-link"));
  await unlink(artifactPath);
  await assert.rejects(() => loadCompatibilityReceipts(primary, [contract], options), /missing/);
  await writeFile(artifactPath, original, { mode: 0o600 });
  const other = join(primary, "other-artifact");
  await writeFile(other, original, { mode: 0o600 });
  await unlink(artifactPath);
  await symlink(other, artifactPath);
  await assert.rejects(() => loadCompatibilityReceipts(primary, [contract], options));
  await unlink(artifactPath);
  await writeFile(artifactPath, original, { mode: 0o600 });
  await unlink(join(primary, "registry/revision-000002.json"));
  await assert.rejects(() => loadCompatibilityReceipts(primary, [contract], options), /gap/);

  const unsafe = await root();
  await chmod(unsafe, 0o755);
  await assert.rejects(() => publishCompatibilityObservation(unsafe, observation(), contract, { expectedRevision: 0 }), /0700/);
  await assert.rejects(() => loadCompatibilityReceipts(unsafe, [contract], options), /0700/);
  const aliased = join(base, "aliased-root");
  await symlink(allNotRun, aliased);
  await assert.rejects(() => loadCompatibilityReceipts(aliased, [contract], options), /canonical/);
  await assert.rejects(() => loadCompatibilityReceipts(`${base}/..`, [contract], options), /explicit canonical/);
  await assert.rejects(() => loadCompatibilityReceipts(allNotRun, [contract, contract], options), /duplicated/);

  const contested = await root();
  const competing = await Promise.allSettled([
    publishCompatibilityObservation(contested, observation("run-a"), contract, { expectedRevision: 0 }),
    publishCompatibilityObservation(contested, observation("run-b"), contract, { expectedRevision: 0 }),
  ]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await loadCompatibilityReceipts(contested, [contract], options)).revision, 1);
} finally {
  await rm(base, { recursive: true, force: true });
}
process.stdout.write("compatibility receipt checks passed (synthetic temporary-filesystem fixture, not live acceptance)\n");
