import assert from "node:assert/strict";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/uptime-kuma/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const root = "/tmp/uptime-kuma-synthetic-metrics";
const key = `uk7_${"a".repeat(40)}`;
let checkpoint: SetupCheckpoint | null = null;
let privateKey: string | null = null;
let needSetup = true;
let keys: Record<string, unknown>[] = [];
let packets: string[] = [];
let creations = 0;
let loseResponse = false;
let denyApproval = false;
let failAfterSave = false;
let authDisabled = false;
let pageExists = true;
let metrics = "# HELP uptime_fixture Synthetic fixture\n# TYPE uptime_fixture gauge\nuptime_fixture 1\n";
const writes: SetupHttpRequest[] = [];
const metadata = () => ({ id: 7, name: "self-host metrics", userID: 1, active: 1, expires: null, status: "active" });
function response(status: number, value: unknown, wire?: string) {
  return { status, ok: status === 200, headers: { get() { return null; } },
    async json() { return value; }, async text() { if (wire !== undefined) return wire; return JSON.stringify(value); },
    async arrayBuffer() { throw new Error("Unexpected byte read"); } };
}
const context: SetupContext = {
  appId: "uptime-kuma", projectRoot: root, installedAppIds: [], inputs: {},
  async status() { return { command: "app status", appId: "uptime-kuma", projectRoot: root,
    ownerKind: "shared", status: "applied", mutation: false, runtime: { state: "running" },
    username: "admin", passwordFile: `${root}/private-password` }; },
  async read() { throw new Error("Unexpected legacy read"); }, async apply() { throw new Error("Unexpected legacy mutation"); },
  checkpoint: {
    async read() { if (failAfterSave && privateKey) throw new Error("Synthetic interruption after private save"); return checkpoint; },
    async compareAndSet(next) {
      assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId: "uptime-kuma", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
        data: next.data ?? checkpoint?.data ?? {}, attemptedActions: [...(checkpoint?.attemptedActions ?? [])] };
      return checkpoint;
    },
  },
  secrets: {
    async readAdminPassword() { return "synthetic-password"; },
    async readApiKey() { return privateKey; }, async apiKeyPath() { if (privateKey) return `${root}/private-metrics-key`; return null; },
    async writeApiKey(value) { assert.equal(value, key); privateKey = value; return `${root}/private-metrics-key`; },
  } as SetupContext["secrets"],
  peers: {} as SetupContext["peers"], container: {} as SetupContext["container"], webSocket: {} as SetupContext["webSocket"],
  http: { async request(request) {
    if (request.path === "/setup-database-info") return response(200, { needSetup: false, runningSetup: false });
    if (request.path === "/api/status-page/default") return response(200, { publicGroupList: [] });
    if (request.path === "/api/status-page/heartbeat/default") return response(200, { heartbeatList: {}, uptimeList: {} });
    if (request.path === "/metrics") {
      assert.equal(request.method, "GET");
      const allowed = request.headers?.Authorization === `Basic ${Buffer.from(`:${key}`).toString("base64")}`;
      if (allowed || authDisabled) return response(200, {}, metrics);
      return response(401, {});
    }
    assert.equal(request.path, "/socket.io/");
    if (request.method === "GET") {
      if (!request.query?.sid) { packets = []; return response(200, {}, '0{"sid":"fixture"}'); }
      assert.ok(packets.length > 0, "No guessed/fake Socket.IO response");
      return response(200, {}, packets.shift());
    }
    if (request.body === "40") { packets.push('40\x1e42["info",{}]'); return response(200, {}, "ok"); }
    if (request.body === "3") return response(200, {}, "ok");
    const frame = /^42(\d+)(\[.*\])$/.exec(String(request.body))!;
    assert.ok(frame);
    const [name, ...args] = JSON.parse(frame[2]!) as unknown[];
    assert.ok(["needSetup", "setup", "login", "getAPIKeyList", "addAPIKey", "getStatusPage",
      "addStatusPage", "saveStatusPage"].includes(String(name)));
    if (name === "addAPIKey" && denyApproval) throw new Error("Synthetic approval declined");
    if (request.beforeSendCheckpoint) {
      assert.equal(request.approval?.once, true);
      assert.ok(!checkpoint?.attemptedActions.includes(request.approval!.action), "Production blocks all repeated one-time actions");
      writes.push(request);
      await context.checkpoint.compareAndSet(request.beforeSendCheckpoint);
      checkpoint!.attemptedActions.push(request.approval!.action);
    }
    let payload: unknown;
    if (name === "needSetup") payload = needSetup;
    if (name === "setup") { assert.deepEqual(args, ["admin", "synthetic-password"]); needSetup = false; payload = { ok: true }; }
    if (name === "login") { assert.deepEqual(args, [{ username: "admin", password: "synthetic-password" }]); payload = { ok: true, token: "synthetic-login-token" }; }
    if (name === "getStatusPage") {
      assert.deepEqual(args, ["default"]); payload = { ok: false, msg: "No slug?" };
      if (pageExists) payload = { ok: true, config: { slug: "default", title: "Local service status", domainNameList: [] } };
    }
    if (name === "addStatusPage") {
      assert.deepEqual(args, ["Local service status", "default"]); assert.equal(pageExists, false);
      pageExists = true; payload = { ok: true, slug: "default" };
    }
    if (name === "saveStatusPage") {
      assert.deepEqual(args, ["default", { slug: "default", title: "Local service status", domainNameList: [] }, "", []]);
      payload = { ok: true };
    }
    if (name === "getAPIKeyList") {
      assert.deepEqual(args, []); assert.equal(request.approval?.action, "uptime-kuma-get-api-key-list"); payload = { ok: true };
      packets.push(`42${JSON.stringify(["apiKeyList", keys])}\x1e2`);
    }
    if (name === "addAPIKey") {
      assert.deepEqual(args, [{ name: "self-host metrics", active: true, expires: null }]);
      assert.equal(request.approval?.action, "uptime-kuma-add-api-key");
      assert.match(request.approval!.progress, /globally switch.*admin Basic auth.*API-key Basic auth.*not a general API or MCP/);
      creations++; keys = [metadata()];
      if (loseResponse) throw new Error("Synthetic lost one-time response");
      packets.push(`42${JSON.stringify(["apiKeyList", keys])}`);
      payload = { ok: true, key, keyID: 7 };
    }
    packets.push(`43${frame[1]}${JSON.stringify([payload])}`);
    return response(200, {}, "ok");
  } },
};

const first = await adapter.firstRun(context);
assert.equal(first.loginVerified, true, "A successful bounded HTTP 200 metrics response must complete shared setup");
assert.equal(first.apiKeyScope, "metrics"); assert.equal(first.generalApiToken, false); assert.equal(first.mcpToken, false);
assert.equal(first.apiKeyFile, `${root}/private-metrics-key`); assert.equal(creations, 1);
assert.equal(adapter.ready(first), true);
assert.equal(adapter.ready({ appId: "uptime-kuma", stage: "login-verified", loginVerified: true,
  credentialRef: `${root}/private-password` }), false);
const original = structuredClone(checkpoint);
await adapter.firstRun(context); assert.deepEqual(checkpoint, original); assert.equal(creations, 1);
assert.ok(!JSON.stringify(checkpoint).includes(key)); assert.ok(!JSON.stringify(first).includes(key));
keys[0]!.expires = "2030-01-01"; await assert.rejects(adapter.firstRun(context), /nonexpiry changed/); keys[0]!.expires = null;
keys[0]!.active = 0; await assert.rejects(adapter.firstRun(context), /nonexpiry changed/); keys[0]!.active = 1;
keys[0]!.userID = 2; await assert.rejects(adapter.firstRun(context), /owner/); keys[0]!.userID = 1;
authDisabled = true; await assert.rejects(adapter.firstRun(context), /API-key-only/); authDisabled = false;
metrics = "<!doctype html>"; await assert.rejects(adapter.firstRun(context), /Prometheus/); metrics = "# TYPE fixture gauge\n";
metrics += "x".repeat(131072);
await assert.rejects(adapter.firstRun(context), /Prometheus/, "Oversized successful metrics responses must remain bounded");
metrics = "# TYPE fixture gauge\n";

// Upgrade an old owned login checkpoint without changing its status-page provenance.
checkpoint = { ...original!, stage: "login-verified", attemptedActions: ["uptime-kuma-setup"], data: { statusPageRecorded: true } };
privateKey = null; keys = []; denyApproval = true;
await assert.rejects(adapter.firstRun(context), /approval declined/); assert.equal(checkpoint.stage, "login-verified");
denyApproval = false; failAfterSave = true;
await assert.rejects(adapter.firstRun(context), /interruption after private save/);
assert.equal(privateKey, key); assert.equal(checkpoint.stage, "metrics-key-write-attempted");
failAfterSave = false; const count = creations;
await adapter.firstRun({ ...context, installedAppIds: ["homarr"] });
assert.equal(creations, count); assert.equal(checkpoint.data.statusPageRecorded, true);

// A saved-key interruption before any page work recovers when Homarr is added later.
checkpoint = { ...original!, stage: "login-verified", attemptedActions: ["uptime-kuma-setup"], data: {} };
privateKey = null; keys = []; pageExists = false; failAfterSave = true;
await assert.rejects(adapter.firstRun(context), /interruption after private save/);
assert.equal(checkpoint.stage, "metrics-key-write-attempted"); assert.equal(privateKey, key);
failAfterSave = false; const recoveryCount = creations;
await adapter.firstRun({ ...context, installedAppIds: ["homarr"] });
assert.equal(creations, recoveryCount); assert.equal(checkpoint.stage, "login-verified");
assert.equal(checkpoint.data.statusPageRecorded, true);
for (const action of ["uptime-kuma-add-api-key", "uptime-kuma-add-status-page", "uptime-kuma-save-status-page"]) {
  assert.ok(checkpoint.attemptedActions.includes(action));
}
assert.equal(writes.filter((request) => request.approval?.action === "uptime-kuma-add-status-page").length, 1);
assert.equal(writes.filter((request) => request.approval?.action === "uptime-kuma-save-status-page").length, 1);
const recovered = structuredClone(checkpoint);
await adapter.firstRun({ ...context, installedAppIds: ["homarr"] }); assert.deepEqual(checkpoint, recovered);
// A valid owned key does not authorize adopting an unrelated default page.
checkpoint = structuredClone(original);
await assert.rejects(adapter.firstRun({ ...context, installedAppIds: ["homarr"] }), /without an owned attempt; do not adopt/);

checkpoint = { ...original!, stage: "login-verified", attemptedActions: ["uptime-kuma-setup"], data: {} }; privateKey = null; keys = []; loseResponse = true;
await assert.rejects(adapter.firstRun(context), /lost one-time response/); const lostCount = creations;
loseResponse = false;
await assert.rejects(adapter.firstRun(context), /never recreate or rotate/); assert.equal(creations, lostCount);
// A later Homarr selection cannot adopt a foreign default page or erase the key attempt.
const lost = structuredClone(checkpoint)!;
keys = [];
await assert.rejects(adapter.firstRun({ ...context, installedAppIds: ["homarr"] }), /never recreate or rotate/);
assert.deepEqual(checkpoint, lost); assert.equal(creations, lostCount);
// Existing page-phase provenance never masks a lost key response.
checkpoint = { ...lost, stage: "status-page-save-attempted", attemptedActions: [...lost.attemptedActions,
  "uptime-kuma-add-status-page", "uptime-kuma-save-status-page"] };
await assert.rejects(adapter.firstRun({ ...context, installedAppIds: ["homarr"] }), /never recreate or rotate/);
assert.equal(checkpoint.stage, "status-page-save-attempted");
// Ordinary CAS stage changes preserve the ledger, just as production does.
await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision, stage: "login-verified",
  data: { ...checkpoint.data, statusPageRecorded: true } });
assert.equal(checkpoint.stage, "login-verified");
assert.equal(checkpoint.data.statusPageRecorded, true);
assert.ok(checkpoint.attemptedActions.includes("uptime-kuma-add-api-key")); assert.equal(creations, lostCount);
await assert.rejects(adapter.firstRun(context), /never recreate or rotate/); assert.equal(creations, lostCount);
checkpoint = { ...original!, stage: "login-verified", attemptedActions: ["uptime-kuma-setup"], data: {} };
keys = [metadata()];
await assert.rejects(adapter.firstRun(context), /do not adopt or rotate/);
assert.equal(writes.filter((request) => String(request.body).includes('"setup"')).length, 1);
console.log("Uptime Kuma metrics key: synthetic first-admin, permanent key, pushed metadata, private-save recovery, lost-response no-replay, auth policy and old-checkpoint upgrade pass; no live credit");
