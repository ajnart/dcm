import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/beszel/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { loadSharedAcceptanceContract, sharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";

const root = "/tmp/beszel-synthetic-owner";
const digest = "a".repeat(64);
const identityId = "user00000000001";
const systemId = "system000000001";
const historyId = "history00000001";
const newHistoryId = "history00000002";
function authToken(claims = { id: identityId, collectionId: "_pb_users_auth_", type: "auth" }) {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`;
}
let token = authToken();
let password = "synthetic-private-password";
let checkpoint: SetupCheckpoint | null = null;
let denied = false;
let readDenied = false;
let missingHistory = false;
let missingOriginal = false;
let latestCreated: string | null = null;
let latestId = historyId;
let original = { id: historyId, system: systemId, type: "1m", created: new Date().toISOString(),
  stats: { cpu: 5, m: 8, mu: 2, mp: 25, d: 50, du: 10, dp: 20 } };
let user = { id: identityId, collectionName: "users", email: "admin@example.test", role: "admin", verified: true };
let system = { id: systemId, name: "synthetic private host", host: "synthetic.invalid", port: "45876",
  users: [identityId], status: "up", updated: new Date().toISOString(), info: { u: 1000, cpu: 5, mp: 25, dp: 20 } };
const requests: SetupHttpRequest[] = [];
const context: AcceptanceContext = {
  appId: "beszel", projectRoot: root, inputs: { "system-id": systemId },
  async status() { return { command: "app status", appId: "beszel", projectRoot: root, status: "applied",
    mutation: false, runtime: { state: "running" }, ownerKind: "shared", ownerPhase: "completed",
    projectId: "fixture", manifestHash: digest, username: "admin@example.test", passwordFile: `${root}/private-password` }; },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(next) {
      assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId: "beszel", projectRoot: root, revision: (checkpoint?.revision ?? 0) + 1,
        stage: next.stage, data: next.data ?? {}, attemptedActions: [] };
      return checkpoint;
    },
  },
  secrets: { async readApiKey() { throw new Error("Setup exports no REST token"); }, async readAdminPassword() { return password; } } as AcceptanceContext["secrets"],
  http: { async request(request) {
    requests.push(request);
    let payload: unknown;
    if (request.method === "POST") {
      assert.equal(request.path, "/api/collections/users/auth-with-password", "Only the pinned existing-user auth route is allowed");
      assert.equal(request.approval?.action, "beszel-acceptance-login");
      assert.deepEqual(JSON.parse(request.body as string), { identity: "admin@example.test", password });
      assert.equal(request.beforeSendCheckpoint, undefined);
      payload = { token, record: { ...user, id: identityId } };
    } else {
      assert.equal(request.method, "GET");
      assert.equal(request.body, undefined);
      assert.equal(request.approval, undefined);
      assert.equal(request.headers?.Authorization, token);
      if (request.path.startsWith("/api/collections/users/records/")) payload = user;
      else if (request.path === `/api/collections/systems/records/${systemId}`) payload = system;
      else {
        assert.equal(request.path, "/api/collections/system_stats/records", "No enrollment, public URL or agent/host-control path");
        assert.equal(request.query?.page, "1");
        assert.equal(request.query?.perPage, "1");
        assert.equal(request.query?.sort, "-created");
        assert.ok(request.query?.fields?.startsWith("id,system,type,created,stats.cpu"));
        assert.ok(request.query?.filter?.startsWith(`system='${systemId}' && type='1m'`));
        let latest = original;
        if (latestId !== historyId) latest = { ...original, id: latestId, created: new Date().toISOString() };
        if (latestCreated) latest = { ...latest, created: latestCreated };
        let rows: unknown[] = [latest];
        if (request.query?.filter?.includes(" && id=")) {
          assert.equal(request.query.filter, `system='${systemId}' && type='1m' && id='${historyId}'`);
          rows = [original];
          if (missingOriginal) rows = [];
        }
        if (missingHistory) rows = [];
        payload = { items: rows };
      }
    }
    let status = 200;
    if (denied || (readDenied && request.method === "GET")) status = 403;
    return { status, ok: status === 200, headers: { get() { return null; } },
      async json() { return payload; }, async text() { return JSON.stringify(payload); }, async arrayBuffer() { return new ArrayBuffer(0); } };
  } },
};
const baseline: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "beszel", projectRoot: root,
  ownerId: "fixture", recipeSha256: digest, manifestHash: digest, units: [{ serviceId: "beszel", imageId: `sha256:${digest}` }],
  epoch: "b".repeat(64), sequence: 1, evidenceId: randomUUID(), state: "running" };
const restart = { stopped: { ...baseline, sequence: 2, evidenceId: randomUUID(), state: "stopped" as const },
  running: { ...baseline, epoch: "c".repeat(64), sequence: 3, evidenceId: randomUUID() } };

await assert.rejects(adapter.begin({ ...context, inputs: {} }, baseline), /input keys/);
await assert.rejects(adapter.begin({ ...context, inputs: { "system-id": "../other" } }, baseline), /opaque record ID/);
password = "";
await assert.rejects(adapter.begin(context, baseline), /password is invalid/);
assert.equal(requests.length, 0, "Missing password cannot trigger account creation or enrollment");
password = "synthetic-private-password";
user.collectionName = "_superusers";
await assert.rejects(adapter.begin(context, baseline), /administrator is unproven/);
user.collectionName = "users";
denied = true;
await assert.rejects(adapter.begin(context, baseline), /no account creation or token refresh is authorized/);
denied = false;
readDenied = true;
await assert.rejects(adapter.begin(context, baseline), /authorized read unavailable/);
readDenied = false;
user.id = "user00000000002";
await assert.rejects(adapter.begin(context, baseline), /administrator is unproven/);
user.id = identityId;
system.users = ["user00000000002"];
await assert.rejects(adapter.begin(context, baseline), /owned by the saved user/);
system.users = [identityId];
system.status = "pending";
await assert.rejects(adapter.begin(context, baseline), /UP paired system/);
system.status = "up";
system.updated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await assert.rejects(adapter.begin(context, baseline), /stale/);
system.updated = new Date().toISOString();
original.stats.m = 0;
await assert.rejects(adapter.begin(context, baseline), /meaningful capacity/);
original.stats.m = 8;
missingHistory = true;
await assert.rejects(adapter.begin(context, baseline), /no readable paired history/);
missingHistory = false;
latestCreated = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await assert.rejects(adapter.begin(context, baseline), /stale/);
latestCreated = null;
const first = await adapter.begin(context, baseline);
assert.equal(first.pairedSystemStatsReadVerified, true);
assert.equal(first.restartPersistenceVerified, false);
assert.equal(first.agentEnrollmentVerified, false);
const originalCheckpoint = structuredClone(checkpoint);
latestId = newHistoryId;
await adapter.begin(context, baseline);
assert.deepEqual(checkpoint, originalCheckpoint, "Resumed begin preserves original history even when a later sample exists");
await assert.rejects(adapter.finish({ ...context, inputs: { "system-id": "system000000002" } }, restart), /choices differ/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, units: [{ serviceId: "beszel-agent", imageId: `sha256:${digest}` }] } }), /service\/image identity/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "foreign" } }), /matching the lifecycle/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: baseline.epoch } }), /distinct restart/);
system.host = "changed.invalid";
await assert.rejects(adapter.finish(context, restart), /did not persist/);
system.host = "synthetic.invalid";
original.stats.cpu = 6;
await assert.rejects(adapter.finish(context, restart), /did not persist/);
original.stats.cpu = 5;
missingOriginal = true;
await assert.rejects(adapter.finish(context, restart), /no readable paired history/);
missingOriginal = false;
const complete = await adapter.finish(context, restart);
assert.equal(complete.historicalStatsVerified, true);
assert.equal(complete.restartPersistenceVerified, true);
assert.ok(await loadSharedAcceptanceContract("beszel"));
assert.deepEqual(sharedAcceptanceContract("beszel")!.inputs({ "system-id": systemId }), { "system-id": systemId });
assert.throws(() => sharedAcceptanceContract("beszel")!.inputs({ "system-id": "x".repeat(16) }), /invalid or changed/);
assert.throws(() => sharedAcceptanceContract("beszel")!.inputs({ "system-id": "../outside" }), /invalid or changed/);
assert.equal(sharedAcceptanceContract("beszel")!.verified(complete), true);
assert.equal(sharedAcceptanceContract("beszel")!.verified({ ...complete, pairedSystemStatsReadVerified: false }), false);
assert.equal(sharedAcceptanceContract("beszel")!.verified({ ...complete, historicalStatsVerified: false }), false);
assert.ok(!JSON.stringify(checkpoint).includes(system.host));
assert.ok(!JSON.stringify(checkpoint).includes(token));
assert.ok(!JSON.stringify(checkpoint).includes(password));
assert.ok(!JSON.stringify(checkpoint).includes("\"stats\""));
assert.deepEqual(Object.keys(JSON.parse(String(checkpoint!.data.baseline))).sort(), ["configHash", "historyHash", "historyId", "identityId", "systemId"]);
console.log("Beszel existing paired-system read acceptance synthetic fixture passed (zero live credit)");
