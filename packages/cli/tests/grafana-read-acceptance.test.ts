import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/grafana/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { loadSharedAcceptanceContract, sharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";
import { sharedAcceptanceAvailable } from "../src/lib/shared-acceptance.ts";

const root = "/tmp/grafana-read-acceptance-fixture";
const digest = "a".repeat(64);
const running: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "grafana",
  projectRoot: root, ownerId: "fixture", recipeSha256: digest, manifestHash: digest,
  units: [{ serviceId: "grafana", imageId: `sha256:${digest}` }], epoch: "b".repeat(64),
  sequence: 1, evidenceId: randomUUID(), state: "running" };
const restart = { stopped: { ...running, state: "stopped" as const, sequence: 2, evidenceId: randomUUID() },
  running: { ...running, epoch: "c".repeat(64), sequence: 3, evidenceId: randomUUID() } };
const password = "synthetic-private-password";
const privateContent = "synthetic-private-query-and-content";
function dashboard() {
  return { dashboard: { id: 42, uid: "fixture_uid", version: 3, schemaVersion: 41, title: privateContent,
    panels: [{ id: 1, type: "stat", gridPos: { x: 0, y: 0, w: 12, h: 8 }, transparent: false,
      options: { orientation: "auto", textMode: "value", content: privateContent, password },
      targets: [{ expr: privateContent }], datasource: { uid: privateContent } }] },
    meta: { version: 3, isFolder: false, canSave: true, canAdmin: true, folderUid: "folder_one", updatedBy: privateContent } };
}
let payload = dashboard();
let checkpoint: SetupCheckpoint | null = null;
let admin = true;
let orgId = 1;
let database = "ok";
let httpCode = 200;
let ownerId = "fixture";
let startupUnavailable = 0;
let requests = 0;
const context: AcceptanceContext = {
  appId: "grafana", projectRoot: root, inputs: { "dashboard-uid": "fixture_uid" },
  async status() { return { command: "app status", appId: "grafana", projectRoot: root, status: "applied", mutation: false,
    ownerKind: "shared", ownerPhase: "completed", projectId: ownerId, manifestHash: digest,
    runtime: { state: "running" }, username: "admin", passwordFile: `${root}/admin-password` }; },
  checkpoint: { async read() { return checkpoint; }, async compareAndSet(next: SetupCheckpointUpdate) {
    assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
    checkpoint = { schemaVersion: 1, appId: "grafana", projectRoot: root, revision: (checkpoint?.revision ?? 0) + 1,
      stage: next.stage, attemptedActions: [], data: next.data ?? {} };
    return checkpoint;
  } },
  secrets: { async readAdminPassword() { return password; } } as AcceptanceContext["secrets"],
  http: { async request(request) {
    requests++;
    assert.equal(request.method, "GET"); assert.equal(request.body, undefined); assert.equal(request.approval, undefined);
    assert.equal(request.headers?.Authorization, `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`);
    assert.equal(request.headers?.["Cache-Control"], "no-cache");
    assert.ok(["/api/user", "/api/health", "/api/dashboards/uid/fixture_uid"].includes(request.path));
    let value: unknown = payload;
    if (request.path === "/api/user") value = { id: 7, orgId, login: "admin", isGrafanaAdmin: admin, isDisabled: false };
    if (request.path === "/api/health") value = { database };
    let code = httpCode;
    if (request.timeoutMs === 1_000 && startupUnavailable > 0) { startupUnavailable--; code = 503; }
    return { status: code, ok: code === 200, headers: { get() { return null; } },
      async json() { return value; }, async text() { return JSON.stringify(value); } };
  } },
};
assert.equal(await loadSharedAcceptanceContract("grafana"), null, "Config reads cannot earn generic core acceptance credit");
assert.equal(await sharedAcceptanceAvailable("grafana"), false, "Candidate observer is unavailable to the acceptance dispatcher");
await assert.rejects(adapter.finish(context, restart), /pre-restart baseline/);
const beforeInvalid = requests;
for (const uid of ["", "a".repeat(41), "../other", "a?b", "space uid"]) {
  await assert.rejects(adapter.begin({ ...context, inputs: { "dashboard-uid": uid } }, running));
}
assert.equal(requests, beforeInvalid);
ownerId = "foreign";
await assert.rejects(adapter.begin(context, running), /shared owner/);
ownerId = "fixture";
payload.dashboard.panels = [];
await assert.rejects(adapter.begin(context, running), /nonempty existing dashboard/);
payload = dashboard(); payload.dashboard.panels[0]!.gridPos.w = 25;
await assert.rejects(adapter.begin(context, running), /invalid stable numeric/);
payload = dashboard(); payload.dashboard.panels.push(structuredClone(payload.dashboard.panels[0]!));
await assert.rejects(adapter.begin(context, running), /duplicate/);
payload = dashboard(); payload.meta.canAdmin = false;
await assert.rejects(adapter.begin(context, running), /owner scope/);
const rowOnly = dashboard();
Object.assign(rowOnly.dashboard.panels[0]!, { type: "row", collapsed: true, panels: [] });
payload = rowOnly;
await assert.rejects(adapter.begin(context, running), /nonempty existing dashboard/);
payload = dashboard(); payload.dashboard.uid = "other";
await assert.rejects(adapter.begin(context, running), /identity/);
payload = dashboard(); admin = false;
await assert.rejects(adapter.begin(context, running), /server administrator/);
admin = true; database = "failing";
await assert.rejects(adapter.begin(context, running), /database health/);
database = "ok"; httpCode = 401;
await assert.rejects(adapter.begin(context, running), /acceptance read failed/);
httpCode = 200;
const first = await adapter.begin(context, running);
assert.equal(first.restartPersistenceVerified, false);
assert.equal(first.datasourceVerified, false); assert.equal(first.metricQueryVerified, false);
assert.equal(first.workloadScope, "dashboard-layout-config-read");
const saved = structuredClone(checkpoint);
await adapter.begin(context, running); assert.deepEqual(checkpoint, saved);
assert.equal(JSON.stringify(checkpoint).includes(password), false);
assert.equal(JSON.stringify(checkpoint).includes(privateContent), false);
await assert.rejects(adapter.finish({ ...context, inputs: { "dashboard-uid": "other" } }, restart), /immutable reviewed/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: running.epoch } }), /distinct restart/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "foreign" } }), /shared owner/);
await assert.rejects(adapter.finish(context, { ...restart, stopped: { ...restart.stopped, units: [] } }), /lifecycle/);
httpCode = 403;
await assert.rejects(adapter.finish(context, restart), /readiness was denied/);
httpCode = 200;
payload.dashboard.panels[0]!.gridPos.w = 11;
await assert.rejects(adapter.finish(context, restart), /did not persist/);
await assert.rejects(adapter.begin(context, running), /baseline changed/);
payload = dashboard(); payload.dashboard.panels[0]!.options.orientation = "horizontal";
await assert.rejects(adapter.finish(context, restart), /did not persist/);
payload = dashboard(); payload.dashboard.version = 4; payload.meta.version = 4;
await assert.rejects(adapter.finish(context, restart), /did not persist/);
payload = dashboard(); orgId = 2;
await assert.rejects(adapter.finish(context, restart), /did not persist/);
orgId = 1;
payload.dashboard.panels[0]!.targets[0]!.expr = "changed-excluded-query";
payload.dashboard.panels[0]!.options.content = "changed-excluded-raw-text";
startupUnavailable = 1;
const complete = await adapter.finish(context, restart);
assert.equal(startupUnavailable, 0);
assert.equal(complete.restartPersistenceVerified, true);
assert.equal(sharedAcceptanceContract("grafana"), null, "Even a successful candidate read has no active acceptance contract");
assert.deepEqual(await adapter.finish(context, restart), complete);
assert.equal(JSON.stringify(checkpoint).includes("changed-excluded-query"), false);
assert.equal(JSON.stringify(checkpoint).includes("changed-excluded-raw-text"), false);
console.log("PASS staged Grafana dashboard config read/persistence fixture; dispatcher unavailable, no core/live/metric/datasource/browser credit");
