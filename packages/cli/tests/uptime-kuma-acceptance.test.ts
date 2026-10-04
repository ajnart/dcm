import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/uptime-kuma/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { sharedAcceptanceAvailable } from "../src/lib/shared-acceptance.ts";
import { sharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";

const root = "/tmp/uptime-kuma-synthetic-acceptance";
const digest = "a".repeat(64);
const baseline: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "uptime-kuma",
  projectRoot: root, ownerId: "fixture", recipeSha256: digest, manifestHash: digest,
  units: [{ serviceId: "uptime-kuma", imageId: `sha256:${digest}` }],
  epoch: "b".repeat(64), sequence: 1, evidenceId: randomUUID(), state: "running" };
const restart = { stopped: { ...baseline, state: "stopped" as const, sequence: 2, evidenceId: randomUUID() },
  running: { ...baseline, epoch: "c".repeat(64), sequence: 3, evidenceId: randomUUID() } };
let checkpoint: SetupCheckpoint | null = null;
let packets: string[] = [];
let loginOk = true;
let denyApproval = false;
let readinessCode = 200;
let startupUnavailable = 0;
let beats: Record<string, unknown>[];
const monitor = { id: 42, type: "http", active: true, forceInactive: false, maintenance: false,
  interval: 60, timeout: 30, url: "http://synthetic-private-target/", basic_auth_pass: "synthetic-monitor-secret" };
const requests: SetupHttpRequest[] = [];
function time(offset = 0) { return new Date(Date.now() - 10_000 + offset).toISOString().replace("T", " ").replace("Z", ""); }
function resetBeats() { beats = [{ id: 7, monitor_id: 42, status: 1, time: time(), ping: 2,
  msg: "synthetic private target", response: "synthetic-private-response" }]; }
resetBeats();
function response(status: number, value: unknown, wire?: string) {
  return { status, ok: status === 200, headers: { get() { return null; } },
    async json() { return value; }, async text() { if (wire !== undefined) return wire; return JSON.stringify(value); },
    async arrayBuffer() { throw new Error("Unexpected byte read"); } };
}
const context: AcceptanceContext = {
  appId: "uptime-kuma", projectRoot: root, inputs: { "monitor-id": "42" },
  async status() { return { command: "app status", appId: "uptime-kuma", projectRoot: root,
    ownerKind: "shared", status: "applied", mutation: false, runtime: { state: "running" },
    username: "admin", passwordFile: `${root}/private-admin-password` }; },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(next) {
      assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId: "uptime-kuma", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage, data: next.data ?? {}, attemptedActions: [] };
      return checkpoint;
    },
  },
  secrets: { async readAdminPassword() { return "synthetic-saved-password"; } } as AcceptanceContext["secrets"],
  http: { async request(request) {
    requests.push(request);
    if (request.path === "/setup-database-info") {
      assert.equal(request.method, "GET");
      assert.equal(request.timeoutMs, 1000);
      if (startupUnavailable > 0) { startupUnavailable--; return response(503, {}); }
      return response(readinessCode, { needSetup: false, runningSetup: false });
    }
    assert.equal(request.path, "/socket.io/");
    assert.equal(request.query?.EIO, "4");
    assert.equal(request.query?.transport, "polling");
    if (request.method === "GET") {
      if (!request.query?.sid) { packets = []; return response(200, {}, '0{"sid":"fixture-session"}'); }
      assert.ok(packets.length > 0, "Synthetic server must have a requested response");
      return response(200, {}, packets.shift());
    }
    assert.equal(request.method, "POST");
    if (request.body === "40" || request.body === "3") {
      assert.equal(request.effect, "socketio-control");
      assert.equal(request.approval, undefined);
      if (request.body === "40") packets.push('40\x1e42["info",{}]');
      return response(200, {}, "ok");
    }
    assert.equal(request.beforeSendCheckpoint, undefined, "No monitor/status-page writes can be checkpointed");
    const frame = /^42(\d+)(\[.*\])$/.exec(String(request.body))!;
    assert.ok(frame);
    const event = JSON.parse(frame[2]!) as unknown[];
    assert.ok(["login", "getMonitor", "getMonitorBeats"].includes(String(event[0])), "Only login and selected reads allowed");
    assert.equal(request.approval?.action, `uptime-kuma-${String(event[0]).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    if (denyApproval) throw new Error("Synthetic exact action approval declined");
    let payload: unknown;
    if (event[0] === "login") {
      assert.deepEqual(event, ["login", { username: "admin", password: "synthetic-saved-password" }]);
      payload = { ok: loginOk, token: "synthetic-private-jwt" };
    } else if (event[0] === "getMonitor") {
      assert.deepEqual(event, ["getMonitor", 42]); payload = { ok: true, monitor };
    } else {
      assert.deepEqual(event, ["getMonitorBeats", 42, 24]); payload = { ok: true, data: beats };
    }
    packets.push(`43${frame[1]}${JSON.stringify([payload])}`);
    return response(200, {}, "ok");
  } },
};

assert.equal(await sharedAcceptanceAvailable("uptime-kuma"), true);
const contract = sharedAcceptanceContract("uptime-kuma")!;
assert.deepEqual(contract.inputs({ "monitor-id": "42" }), { "monitor-id": "42" });
assert.throws(() => contract.inputs({ "monitor-id": "042" }));
await assert.rejects(adapter.begin({ ...context, inputs: {} }, baseline), /monitor-id/);
denyApproval = true;
await assert.rejects(adapter.begin(context, baseline), /approval declined/);
assert.equal(checkpoint, null);
denyApproval = false;
beats = [];
await assert.rejects(adapter.begin(context, baseline), /non-empty history/);
assert.equal(checkpoint, null, "Empty authenticated inventory earns no core acceptance");
resetBeats();
const first = await adapter.begin(context, baseline);
assert.equal(first.monitorStatusReadVerified, true);
assert.equal(first.restartPersistenceVerified, false);
assert.equal(contract.verified(first), false);
const original = structuredClone(checkpoint);
await adapter.begin(context, baseline);
assert.deepEqual(checkpoint, original, "Repeat begin never replaces selected workload baseline");
const serialized = JSON.stringify(checkpoint);
for (const secret of ["synthetic-saved-password", "synthetic-private-jwt", "synthetic-monitor-secret",
  "synthetic-private-target", "synthetic private target", "synthetic-private-response"]) assert.ok(!serialized.includes(secret));
await assert.rejects(adapter.finish({ ...context, inputs: { "monitor-id": "43" } }, restart), /selected monitor/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: baseline.epoch } }), /distinct restart/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "foreign" } }), /lineage/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running,
  units: [{ serviceId: "uptime-kuma", imageId: `sha256:${"d".repeat(64)}` }] } }), /lineage/);
await assert.rejects(adapter.finish(context, { ...restart, stopped: { ...restart.stopped, sequence: 1 } }), /recorded stop/);
loginOk = false;
await assert.rejects(adapter.finish(context, restart), /live saved administrator/);
loginOk = true; readinessCode = 403;
await assert.rejects(adapter.finish(context, restart), /readiness was denied/);
readinessCode = 200; monitor.active = false;
await assert.rejects(adapter.finish(context, restart), /active non-maintenance/);
monitor.active = true; monitor.interval = 61;
await assert.rejects(adapter.finish(context, restart), /operating configuration changed/);
monitor.interval = 60;
beats[0]!.monitor_id = 43;
await assert.rejects(adapter.finish(context, restart), /heartbeat shape/);
beats[0]!.monitor_id = 42;
beats[0]!.status = 0;
await assert.rejects(adapter.finish(context, restart), /recent UP/);
beats[0]!.status = 1;
const savedTime = beats[0]!.time;
beats[0]!.time = time(-600_000);
await assert.rejects(adapter.finish(context, restart), /recent UP/);
beats[0]!.time = savedTime;
beats[0]!.ping = 3;
await assert.rejects(adapter.finish(context, restart), /did not persist/);
beats[0]!.ping = 2;
const historical = structuredClone(beats[0]!);
beats = [{ ...historical, id: 8, time: time(1000) }];
await assert.rejects(adapter.finish(context, restart), /did not persist/);
beats = [historical, { ...historical, id: 8, time: time(1000) }];
startupUnavailable = 1;
const finished = await adapter.finish(context, restart);
assert.equal(startupUnavailable, 0);
assert.equal(contract.verified(finished), true);
assert.equal(finished.monitorCreationVerified, false);
assert.equal(finished.notificationDeliveryVerified, false);
assert.equal(contract.verified({ ...finished, historicalHeartbeatVerified: false }), false);
assert.ok(requests.every((item) => item.path === "/setup-database-info" || item.path === "/socket.io/"));
console.log("Uptime Kuma acceptance: synthetic selected-monitor/history, lineage, bounded readiness, approval denial and sanitized checkpoints pass; no live credit");
