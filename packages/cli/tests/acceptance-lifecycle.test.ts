import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createReadOnlyAcceptance } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance-lifecycle.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupHttpRequest, SetupRecord } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { loadSharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";

const digest = "a".repeat(64);
const running: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "fixture-app",
  projectRoot: "/tmp/synthetic-acceptance-owner", ownerId: "fixture", recipeSha256: digest,
  manifestHash: digest, units: [{ serviceId: "fixture-app", imageId: `sha256:${digest}` },
    { serviceId: "fixture-db", imageId: `sha256:${digest}` }], epoch: "b".repeat(64), sequence: 1,
  evidenceId: randomUUID(), state: "running" };
const restart = { stopped: { ...running, sequence: 2, state: "stopped" as const, evidenceId: randomUUID() },
  running: { ...running, sequence: 3, epoch: "c".repeat(64), evidenceId: randomUUID() } };
let saved: SetupCheckpoint | null = null;
let writes = 0;
let reads = 0;
let ownerKind = "shared";
let data: SetupRecord = { recordId: "existing_42", contentSha256: digest, contentSize: 42 };
let forbidden: "POST" | "secret" | "checkpoint" | "none" = "none";
let authError = false;
let race = false;
const context: AcceptanceContext = {
  appId: running.appId, projectRoot: running.projectRoot, inputs: { "record-id": "existing_42" },
  async status() { return { command: "app status", appId: running.appId, projectRoot: running.projectRoot,
    status: "applied", mutation: false, runtime: { state: "running" }, ownerKind, ownerPhase: "completed",
    projectId: "fixture", manifestHash: digest }; },
  http: { async request() { throw new Error("No network in synthetic lifecycle fixture"); } },
  secrets: { async readApiKey() { return "synthetic-not-a-secret"; }, async writeApiKey() { throw new Error("Must not reach transport writer"); } } as AcceptanceContext["secrets"],
  checkpoint: { async read() { return saved; }, async compareAndSet(next: SetupCheckpointUpdate) {
    if (race) throw new Error("synthetic CAS conflict");
    assert.equal(next.expectedRevision, saved?.revision ?? null);
    writes++;
    saved = { schemaVersion: 1, appId: running.appId, projectRoot: running.projectRoot,
      revision: (saved?.revision ?? 0) + 1, stage: next.stage, data: next.data ?? {}, attemptedActions: [] };
    return saved;
  } },
};
const adapter = createReadOnlyAcceptance({ appId: running.appId, source: "https://example.org/pinned-source",
  stage: "fixture-existing-acceptance", cleanup: "not-required-read-only", serviceIds: ["fixture-db", "fixture-app"],
  inputDefinitions: [{ key: "record-id", label: "Existing record ID" }],
  async observe(readOnly, afterRestart) {
    reads++;
    if (forbidden === "POST") await readOnly.http.request({ method: "POST", path: "/mutate" });
    if (forbidden === "secret") await readOnly.secrets.writeApiKey("no-write");
    if (forbidden === "checkpoint") await readOnly.checkpoint.compareAndSet({ expectedRevision: null, stage: "wrong" });
    if (authError) throw new Error("authorization denied 403");
    assert.equal(typeof afterRestart, "boolean");
    assert.equal(await readOnly.secrets.readApiKey(), "synthetic-not-a-secret");
    return { baseline: data, result: { appHealthObserved: true, existingRecordReadVerified: true,
      appId: "wrong", projectRoot: "wrong", cleanup: "wrong", source: "wrong", restartPersistenceVerified: true } };
  },
});

ownerKind = "app";
await assert.rejects(adapter.begin(context, running), /explicit completed shared owner/);
ownerKind = "shared";
await assert.rejects(adapter.begin(context, { ...running, units: running.units.slice(0, 1) }), /service\/image identity/);
await assert.rejects(adapter.begin(context, { ...running, evidenceId: "arbitrary-receipt" }), /trusted lifecycle/);
for (const method of ["POST", "secret", "checkpoint"] as const) {
  forbidden = method;
  await assert.rejects(adapter.begin(context, running), /mutation/);
  assert.equal(saved, null);
}
forbidden = "none";
data = { content: "raw workload content" };
await assert.rejects(adapter.begin(context, running), /only app-owned/);
data = { recordId: "existing_42", contentSha256: digest, contentSize: 42 };
race = true;
await assert.rejects(adapter.begin(context, running), /CAS conflict/);
race = false;
const begun = await adapter.begin(context, running);
assert.equal(begun.restartPersistenceVerified, false);
assert.equal(begun.appId, running.appId);
assert.equal(begun.projectRoot, running.projectRoot);
assert.equal(begun.cleanup, "not-required-read-only");
assert.equal(begun.source, adapter.source);
const original = structuredClone(saved);
data = { contentSize: 42, contentSha256: digest, recordId: "existing_42" };
await adapter.begin(context, running);
assert.deepEqual(saved, original, "Canonical baseline and replay do not reset or write the checkpoint");
await assert.rejects(adapter.begin({ ...context, inputs: { "record-id": "other" } }, running), /immutable reviewed/);
await assert.rejects(adapter.begin(context, { ...running, epoch: "d".repeat(64) }), /baseline start chronology/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: running.epoch } }), /distinct restart/);
await assert.rejects(adapter.finish(context, { ...restart, stopped: { ...restart.stopped, evidenceId: running.evidenceId } }), /chronology/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, sequence: 2 } }), /chronology/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, recipeSha256: "e".repeat(64) } }), /immutable image lineage/);
authError = true;
const beforeDenied = reads;
await assert.rejects(adapter.finish(context, restart), /authorization denied/);
assert.equal(reads, beforeDenied + 1, "Authentication failure is not retried");
authError = false;
data = { ...data, contentSize: 43 };
await assert.rejects(adapter.finish(context, restart), /did not persist/);
assert.deepEqual(saved, original);
data = { ...data, contentSize: 42 };
const complete = await adapter.finish(context, restart);
assert.equal(complete.restartPersistenceVerified, true);
assert.equal(writes, 2);
await adapter.finish(context, restart);
assert.equal(writes, 2, "Successful resume reads back without replacing restart chronology");
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, sequence: 4, evidenceId: randomUUID() } }), /completed restart chronology/);

let authentication: SetupHttpRequest = { method: "POST", path: "/auth/login", body: "synthetic login",
  approval: { action: "fixture-acceptance-login", progress: "Authenticate saved account" } };
let authenticationCalls = 0;
const authContext: AcceptanceContext = { ...context,
  checkpoint: { async read() { return null; }, async compareAndSet(next) {
    return { schemaVersion: 1, appId: running.appId, projectRoot: running.projectRoot, revision: 1,
      stage: next.stage, data: next.data ?? {}, attemptedActions: [] };
  } },
  http: { async request(request) {
    authenticationCalls++;
    assert.equal(request, authentication, "Existing transport receives the original approval-bearing request");
    return { status: 200, ok: true, headers: { get() { return null; } }, async json() { return {}; },
      async text() { return ""; }, async arrayBuffer() { return new ArrayBuffer(0); } };
  } },
};
const loginAdapter = createReadOnlyAcceptance({ appId: running.appId, source: adapter.source,
  stage: "fixture-auth-acceptance", cleanup: "not-required-read-only", serviceIds: running.units.map((unit) => unit.serviceId),
  inputDefinitions: [{ key: "record-id", label: "Existing record" }],
  authenticationRequests: [{ path: "/auth/login", action: "fixture-acceptance-login" }],
  async observe(readOnly) { await readOnly.http.request(authentication); return { baseline: data, result: {} }; },
});
const permitted = { ...authentication };
await loginAdapter.begin(authContext, running);
assert.equal(authenticationCalls, 1);
for (const invalid of [{ path: "/auth/create" }, { approval: undefined },
  { approval: { action: "wrong-login", progress: "Wrong" } },
  { approval: { action: "fixture-acceptance-login", progress: "Wrong", once: true } },
  { beforeSendCheckpoint: { expectedRevision: null, stage: "wrong" } }, { effect: "socketio-control" as const },
  { query: { arbitrary: "query" } }]) {
  authentication = { ...permitted, ...invalid };
  await assert.rejects(loginAdapter.begin(authContext, running), /mutation/);
  assert.equal(authenticationCalls, 1, "Wrong path/action/once/checkpoint/effect/query never reaches auth transport");
}

const integer = await loadSharedAcceptanceContract("paperless-ngx");
assert.ok(integer);
assert.deepEqual(integer.inputs({ "document-id": "42" }), { "document-id": "42" });
for (const value of ["0", "042", "1.5", "99999999999", "../42"]) {
  assert.throws(() => integer.inputs({ "document-id": value }), /invalid or changed/);
}
const uuid = await loadSharedAcceptanceContract("immich");
assert.ok(uuid);
const assetId = randomUUID();
assert.deepEqual(uuid.inputs({ "asset-id": assetId }), { "asset-id": assetId });
for (const value of ["not-a-uuid", assetId + "-extra", "../" + assetId, "0".repeat(36)]) {
  assert.throws(() => uuid.inputs({ "asset-id": value }), /invalid or changed/);
}
const opaque = await loadSharedAcceptanceContract("beszel");
assert.ok(opaque);
assert.deepEqual(opaque.inputs({ "system-id": "abc_12-XYZ" }), { "system-id": "abc_12-XYZ" });
for (const value of ["", "abc.def", "abc/def", "a".repeat(16), "abc def", "abc\n"]) {
  assert.throws(() => opaque.inputs({ "system-id": value }), /invalid or changed/);
}
assert.throws(() => opaque.inputs({ "system-id": "abc", "extra": "no" }), /invalid or changed/);
console.log("Read-only acceptance lifecycle: exact shared lineage, immutable selection/baseline, canonical resume, CAS and mutation/auth refusal fixture pass; no live credit");
