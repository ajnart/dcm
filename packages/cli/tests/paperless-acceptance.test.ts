import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { sharedAcceptance, sharedAcceptanceAvailable, sharedAcceptanceSubjectSha256, type SharedAcceptanceIdentity, type SharedAcceptanceOwner } from "../src/lib/shared-acceptance.ts";
import { sharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";

const root = await mkdtemp(join(tmpdir(), "paperless-acceptance-fixture-"));
const digest = "a".repeat(64);
const units = ["paperless-ngx", "paperless-ngx-broker", "paperless-ngx-db"].map((serviceId) => ({ serviceId, imageId: `sha256:${digest}` }));
const baseline: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "paperless-ngx",
  projectRoot: root, ownerId: "fixture", recipeSha256: digest, manifestHash: digest,
  units, epoch: "b".repeat(64), sequence: 1, evidenceId: randomUUID(), state: "running" };
const restart = {
  stopped: { ...baseline, state: "stopped" as const, sequence: 2, evidenceId: randomUUID() },
  running: { ...baseline, epoch: "c".repeat(64), sequence: 3, evidenceId: randomUUID() },
};
let checkpoint: SetupCheckpoint | null = null;
let bytes = Buffer.from("synthetic authorized original document");
let tokenUserId = 7;
let code = 200;
let startupUnavailable = 0;
const requests: SetupHttpRequest[] = [];
const context: AcceptanceContext = {
  appId: "paperless-ngx", projectRoot: root, inputs: { "document-id": "42" },
  async status() { return { command: "app status", appId: "paperless-ngx", projectRoot: root,
    status: "applied", mutation: false, runtime: { state: "running" }, username: "admin",
    passwordFile: join(root, "admin-password"), url: "http://127.0.0.1:18000" }; },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(next: SetupCheckpointUpdate) {
      assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId: "paperless-ngx", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage, data: next.data ?? {}, attemptedActions: [] };
      return checkpoint;
    },
  },
  secrets: {
    async readAdminPassword() { return "p".repeat(43); },
    async readApiKey() { return "d".repeat(40); },
    async apiKeyPath() { return join(root, "private-api-key"); },
  } as AcceptanceContext["secrets"],
  http: { async request(request) {
    requests.push(request);
    assert.equal(request.method, "GET", "Existing-document acceptance never uploads, rotates credentials or deletes");
    assert.equal(request.body, undefined);
    assert.equal(request.approval, undefined);
    let payload: unknown = {};
    let responseCode = code;
    if (request.timeoutMs === 1_000 && startupUnavailable > 0) {
      startupUnavailable--;
      responseCode = 503;
    }
    if (request.path === "/api/users/") {
      assert.equal(request.headers?.Authorization, `Basic ${Buffer.from(`admin:${"p".repeat(43)}`).toString("base64")}`);
      payload = { results: [{ id: 7, username: "admin", is_superuser: true, is_active: true }] };
    } else {
      assert.equal(request.headers?.Authorization, `Token ${"d".repeat(40)}`);
      if (request.path === "/api/ui_settings/") payload = { user: { id: tokenUserId, username: "admin", is_superuser: true } };
      else if (request.path === "/api/statistics/") payload = { documents_total: 1, documents_inbox: 0 };
      else if (request.path === "/api/documents/42/") {
        assert.deepEqual(request.query, { fields: "id" }); payload = { id: 42 };
      } else {
        assert.equal(request.path, "/api/documents/42/download/");
        assert.deepEqual(request.query, { original: "true" });
        assert.equal(request.headers?.["Cache-Control"], "no-cache");
      }
    }
    return { status: responseCode, ok: responseCode === 200, headers: { get() { return null; } },
      async json() { return payload; }, async text() { return JSON.stringify(payload); },
      async arrayBuffer() { return Uint8Array.from(bytes).buffer; } };
  } },
};

try {
  assert.equal(await sharedAcceptanceAvailable("paperless-ngx"), true);
  assert.equal(await sharedAcceptanceAvailable("ntfy"), true);
  assert.equal(await sharedAcceptanceAvailable("immich"), false, "Adapter presence or setup observation earns no live receipt");
  await assert.rejects(adapter.begin({ ...context, inputs: {} }, baseline), /document-id/);
  const first = await adapter.begin(context, baseline);
  assert.equal(first.documentDownloadVerified, true);
  assert.equal(first.restartPersistenceVerified, false);
  assert.equal(first.uploadOcrSearchVerified, false);
  const originalCheckpoint = structuredClone(checkpoint);
  await adapter.begin(context, baseline);
  assert.deepEqual(checkpoint, originalCheckpoint, "Repeat begin reads exact workload without replacing its baseline");
  await assert.rejects(adapter.finish({ ...context, inputs: { "document-id": "43" } }, restart), /selected document/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: baseline.epoch } }), /distinct restart/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "foreign" } }), /lineage/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, units: [units[2]!] } }), /dependencies/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running,
    units: ["broker", "db", "paperless-ngx"].map((serviceId) => ({ serviceId, imageId: `sha256:${digest}` })) } }), /dependencies/);
  await assert.rejects(adapter.finish(context, { ...restart, stopped: { ...restart.stopped, sequence: 1 } }), /recorded stop/);
  tokenUserId = 8;
  await assert.rejects(adapter.finish(context, restart), /managed administrator/);
  tokenUserId = 7; code = 403;
  await assert.rejects(adapter.finish(context, restart), /readiness was denied/);
  code = 200; bytes = Buffer.from("changed document bytes");
  await assert.rejects(adapter.finish(context, restart), /did not persist/);
  await assert.rejects(adapter.begin(context, baseline), /baseline cannot be replaced/);
  bytes = Buffer.alloc(1024 * 1024 + 1);
  await assert.rejects(adapter.finish(context, restart), /at most 1 MiB/);
  bytes = Buffer.from("synthetic authorized original document");
  startupUnavailable = 2;
  const complete = await adapter.finish(context, restart);
  assert.equal(startupUnavailable, 0, "Transient restart readiness reads are retried, not classified as lost document persistence");
  assert.equal(sharedAcceptanceContract("paperless-ngx")!.verified(complete), true);
  assert.equal(sharedAcceptanceContract("paperless-ngx")!.verified({ ...complete, documentDownloadVerified: false }), false);
  assert.equal(sharedAcceptanceContract("ntfy")!.verified(complete), false);
  assert.ok(!JSON.stringify(checkpoint).includes(bytes.toString()), "Private document bytes never enter checkpoints");

  const identity: SharedAcceptanceIdentity = { directory: root, projectRoot: root, projectId: "fixture",
    appId: "paperless-ngx", ownerAppIds: ["paperless-ngx"], services: units.map((unit) => unit.serviceId),
    contract: { appId: "paperless-ngx", dimension: "liveRestart", homarrMode: "native",
      owner: { projectFingerprint: digest, revision: 1, manifestHash: digest }, recipeSha256: digest,
      images: Object.fromEntries(units.map((unit) => [unit.serviceId, `example/${unit.serviceId}:fixture@sha256:${digest}`])),
      subjectSha256: (await sharedAcceptanceSubjectSha256("paperless-ngx", ["paperless-ngx"]))!,
      verifier: { id: "shared-app-acceptance", sourceSha256: digest, release: "1.0.0" } } };
  let inspections = 0;
  const owner: SharedAcceptanceOwner = {
    async identity() { return identity; }, async status() { throw new Error("No runtime access in review"); },
    async handoff() { throw new Error("No credentials in review"); },
    async inspectRuntime() { inspections++; return []; },
    async lifecycle() { throw new Error("No Docker in synthetic fixture"); }, async lock(task) { return task(); },
  };
  const options = { action: "begin" as const, evidenceRoot: join(root, "evidence"), inputs: { "document-id": "42" } };
  const review = await sharedAcceptance(options, owner);
  const other = await sharedAcceptance({ ...options, inputs: { "document-id": "43" } }, owner);
  assert.notEqual(review.approval, other.approval, "Workload input is bound to exact approval");
  assert.equal(inspections, 0);
  const ledger = { schemaVersion: 1, runId: randomUUID(), binding: createHash("sha256").update(JSON.stringify({ identity, inputs: options.inputs })).digest("hex"),
    phase: "begun", baseline, stopped: null, running: null, checkedAt: null, registry: null, inputs: { "document-id": "42" } };
  await writeFile(join(root, "acceptance-run-paperless-ngx.json"), JSON.stringify(ledger), { mode: 0o600 });
  const finish = await sharedAcceptance({ action: "finish", evidenceRoot: options.evidenceRoot }, owner);
  assert.deepEqual(finish.inputs, { "document-id": "42" }, "Finish reuses the saved exact workload");
  await assert.rejects(sharedAcceptance({ action: "finish", evidenceRoot: options.evidenceRoot, inputs: { "document-id": "43" } }, owner), /changed/);
  console.log("Paperless acceptance: selected existing download, exact lifecycle, byte persistence and approval/input lineage fixture pass; no live credit");
} finally {
  await rm(root, { recursive: true, force: true });
}
