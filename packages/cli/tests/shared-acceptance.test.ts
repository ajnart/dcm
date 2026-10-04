import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedAcceptance, sharedAcceptanceAdapter, sharedAcceptanceSubjectSha256, type SharedAcceptanceIdentity, type SharedAcceptanceOwner } from "../src/lib/shared-acceptance.ts";
import { prepareCompatibilityEvidenceRoot, publishCompatibilityObservation } from "../src/lib/compatibility-receipts.ts";

const directory = await mkdtemp(join(tmpdir(), "shared-acceptance-fixture-"));
const digest = "a".repeat(64);
const identity: SharedAcceptanceIdentity = { directory, projectRoot: directory, projectId: "fixture", appId: "ntfy", ownerAppIds: ["ntfy"], services: ["ntfy"],
  contract: { appId: "ntfy", dimension: "liveRestart", homarrMode: "tile-only",
    owner: { projectFingerprint: digest, revision: 1, manifestHash: digest }, recipeSha256: digest,
    images: { ntfy: `binwiederhier/ntfy:v2.28.0@sha256:${digest}` }, subjectSha256: (await sharedAcceptanceSubjectSha256("ntfy", ["ntfy"]))!,
    verifier: { id: "shared-app-acceptance", sourceSha256: digest, release: "1.0.0" } } };
let statusCalls = 0; let lifecycleCalls = 0;
let units = [{ serviceId: "ntfy", imageId: `sha256:${digest}`, immutableImage: identity.contract.images.ntfy!,
  startedAt: "2026-10-03T00:00:00.000Z", state: "running" as const }];
const owner: SharedAcceptanceOwner = {
  async identity() { return structuredClone(identity); },
  async status() { statusCalls++; throw new Error("No fixture network/credentials allowed"); },
  async handoff() { throw new Error("No fixture handoff allowed"); },
  async inspectRuntime() { return units; },
  async lifecycle() { lifecycleCalls++; throw new Error("No fixture Docker allowed"); },
  async lock(task) { return task(); },
};
try {
  assert.equal((await sharedAcceptanceAdapter("ntfy"))?.adapter.appId, "ntfy");
  assert.equal(await sharedAcceptanceAdapter("filebrowser"), null);
  const options = { action: "begin" as const, evidenceRoot: join(directory, "evidence") };
  const review = await sharedAcceptance(options, owner);
  assert.equal(review.status, "review"); assert.equal(review.mutation, false);
  assert.match(review.approval!, /^SHARED-ACCEPTANCE-BEGIN:fixture:[a-f0-9]{64}$/);
  assert.equal(statusCalls, 0); assert.equal(lifecycleCalls, 0);
  await assert.rejects(sharedAcceptance({ ...options, approval: "operator-asserted-pass" }, owner), /changed/);
  units = [];
  await assert.rejects(sharedAcceptance({ ...options, approval: review.approval }, owner), /changed/);
  assert.equal(statusCalls, 0, "Incomplete service inventory fails before credentials or HTTP");
  units = [{ serviceId: "ntfy", imageId: `sha256:${digest}`, immutableImage: `binwiederhier/ntfy:v2.28.0@sha256:${"b".repeat(64)}`,
    startedAt: "2026-10-03T00:00:00.000Z", state: "running" }];
  await assert.rejects(sharedAcceptance({ ...options, approval: review.approval }, owner), /changed/);
  assert.equal(statusCalls, 0, "Different actual immutable image fails before transport");
  units[0]!.immutableImage = identity.contract.images.ntfy!;
  const ledgerPath = join(directory, "acceptance-run-ntfy.json");
  const racedLedger = { schemaVersion: 1, runId: randomUUID(), binding: createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
    phase: "begin-attempted", baseline: { source: "shared-selected-lifecycle", appId: "ntfy", projectRoot: directory,
      ownerId: "fixture", recipeSha256: digest, manifestHash: digest, units: [{ serviceId: "ntfy", imageId: `sha256:${digest}` }],
      state: "running", sequence: 1, epoch: digest, evidenceId: randomUUID() }, stopped: null, running: null, checkedAt: null, registry: null };
  const racedOwner = { ...owner, async lock<T>(task: () => Promise<T>) {
    await writeFile(ledgerPath, JSON.stringify(racedLedger), { mode: 0o600 }); return task();
  } };
  await assert.rejects(sharedAcceptance({ ...options, approval: review.approval }, racedOwner), /changed/);
  assert.equal(statusCalls, 0, "Ledger changed between review and lock cannot authorize transport");
  await writeFile(ledgerPath, JSON.stringify({ ...racedLedger, phase: "stopped" }), { mode: 0o600 });
  await assert.rejects(sharedAcceptance(options, owner), /changed/);
  await unlink(ledgerPath);
  identity.contract.owner.revision++;
  await assert.rejects(sharedAcceptance({ ...options, approval: review.approval }, owner), /changed/);
  const finishReview = await sharedAcceptance({ ...options, action: "finish" }, owner);
  await assert.rejects(sharedAcceptance({ ...options, action: "finish", approval: finishReview.approval }, owner), /changed/);
  assert.equal(lifecycleCalls, 0, "No baseline checkpoint authorizes a restart");

  // A saved app anchor is a required prefix, not exclusive ownership of the registry tail.
  const checkedAt = new Date().toISOString();
  await prepareCompatibilityEvidenceRoot(options.evidenceRoot);
  const { homarrMode: _mode, ...ownContract } = identity.contract;
  const checks = [{ id: "application-health", result: "pass" as const },
    { id: "core-round-trip", result: "pass" as const }, { id: "restart-persistence", result: "pass" as const }];
  const first = await publishCompatibilityObservation(options.evidenceRoot,
    { ...ownContract, runId: randomUUID(), checkedAt, checks, cleanup: "not-required" }, identity.contract, { expectedRevision: 0 });
  const otherContract = { ...identity.contract, appId: "other-app" };
  const { homarrMode: _otherMode, ...otherIdentity } = otherContract;
  const second = await publishCompatibilityObservation(options.evidenceRoot,
    { ...otherIdentity, runId: randomUUID(), checkedAt, checks, cleanup: "not-required" }, otherContract,
    { expectedRevision: 1, expectedRegistryHash: first.registryHash });
  const runningEpoch = createHash("sha256").update(JSON.stringify(units.map((unit) => [unit.serviceId, unit.startedAt]))).digest("hex");
  const baseline = { ...racedLedger.baseline, epoch: digest };
  const resumed = { ...racedLedger, runId: randomUUID(), phase: "restarted", baseline,
    stopped: { ...baseline, state: "stopped", sequence: 2, evidenceId: randomUUID() },
    running: { ...baseline, epoch: runningEpoch, sequence: 3, evidenceId: randomUUID() },
    binding: createHash("sha256").update(JSON.stringify(identity)).digest("hex"), checkedAt,
    registry: { revision: first.revision, registryHash: first.registryHash } };
  await writeFile(ledgerPath, JSON.stringify(resumed), { mode: 0o600 });
  const loadedAdapter = (await sharedAcceptanceAdapter("ntfy"))!.adapter;
  const originalFinish = loadedAdapter.finish;
  loadedAdapter.finish = async () => ({ appId: "ntfy", projectRoot: directory,
    appHealthObserved: true, notificationDeliveryVerified: true, anonymousSubscriptionDenied: true,
    restartPersistenceVerified: true, cleanup: "retained-until-cache-expiry-no-topic-delete" });
  try {
    const resumedReview = await sharedAcceptance({ ...options, action: "finish" }, owner);
    const finished = await sharedAcceptance({ ...options, action: "finish", approval: resumedReview.approval }, owner);
    assert.equal(finished.status, "finished");
    assert.equal(finished.registry!.revision, second.revision + 1,
      "Finish publishes using current tip CAS after validating its own older required prefix");
    const fourth = await publishCompatibilityObservation(options.evidenceRoot,
      { ...otherIdentity, runId: randomUUID(), checkedAt, checks, cleanup: "not-required" }, otherContract,
      { expectedRevision: finished.registry!.revision, expectedRegistryHash: finished.registry!.registryHash });
    const repeatReview = await sharedAcceptance({ ...options, action: "finish" }, owner);
    const repeat = await sharedAcceptance({ ...options, action: "finish", approval: repeatReview.approval }, owner);
    assert.equal(repeat.mutation, false);
    assert.equal(repeat.registry!.revision, fourth.revision,
      "Finished app remains readable after another app legitimately appends");
    assert.equal(lifecycleCalls, 0, "Persisted restarted/finished chronology never replays stop/start");
    await writeFile(ledgerPath, JSON.stringify({ ...resumed, registry: { ...resumed.registry, registryHash: "f".repeat(64) } }), { mode: 0o600 });
    const changedReview = await sharedAcceptance({ ...options, action: "finish" }, owner);
    await assert.rejects(sharedAcceptance({ ...options, action: "finish", approval: changedReview.approval }, owner), /required registry anchor/);
  } finally { loadedAdapter.finish = originalFinish; }
  console.log("shared acceptance: synthetic approval, owner/image drift, missing-inventory and no-baseline restart gates pass; no live credit");
} finally { await rm(directory, { recursive: true, force: true }); }
