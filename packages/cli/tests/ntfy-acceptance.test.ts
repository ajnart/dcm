import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ntfy/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupHttpRequest, SetupCheckpointUpdate } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const root = await mkdtemp(join(tmpdir(), "ntfy-acceptance-fixture-"));
const projectId = "fixture";
const privateFiles = join(root, ".selfhost", "shared", projectId, "secrets", "ntfy");
const status = { command: "app status", ownerKind: "shared", appId: "ntfy", projectRoot: root,
  status: "applied", mutation: false, runtime: { state: "running" }, projectId,
  dockerContext: "default", port: 18081, url: "http://127.0.0.1:18081",
  composeTarget: join(root, ".selfhost", "shared", projectId, "compose.aaaaaaaaaaaaaaaa.yaml"),
  applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
  manifestHash: "b".repeat(64), privateFiles, passwordFile: join(privateFiles, "admin-password") };
const baseline: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle",
  appId: "ntfy", projectRoot: root, ownerId: projectId, recipeSha256: "a".repeat(64),
  manifestHash: "b".repeat(64), units: [{ serviceId: "ntfy", imageId: `sha256:${"c".repeat(64)}` }],
  state: "running", epoch: "start-one", sequence: 1, evidenceId: "baseline-one" };
const restart = { stopped: { ...baseline, state: "stopped" as const, sequence: 2, evidenceId: "stop-two" },
  running: { ...baseline, epoch: "start-three", sequence: 3, evidenceId: "running-three" } };
let checkpoint: SetupCheckpoint | null = null;
let inventory: Record<string, unknown>[] = [];
let publishes = 0;
let loseResponse = false;
let storeMessage = true;
let anonymousAllowed = false;
let denyPublish = false;
let startupUnavailable = 0;
const requests: SetupHttpRequest[] = [];

function response(code: number, value: unknown, ndjson = false) {
  return { status: code, ok: code >= 200 && code < 300,
    headers: { get() { return null; } }, async json() { return value; },
    async text() { if (ndjson) return inventory.map((item) => JSON.stringify(item)).join("\n");
      return JSON.stringify(value); } };
}

async function compareAndSet(next: SetupCheckpointUpdate): Promise<SetupCheckpoint> {
  assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
  checkpoint = { schemaVersion: 1, appId: "ntfy", projectRoot: root,
    revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
    attemptedActions: checkpoint?.attemptedActions ?? [], data: next.data ?? {} };
  return checkpoint;
}

const context = { appId: "ntfy", projectRoot: root, async status() { return status; },
  checkpoint: { async read() { return checkpoint; }, compareAndSet },
  secrets: { async readAdminPassword() { return "synthetic-private-password"; } },
  http: { async request(request: SetupHttpRequest) {
    requests.push(request);
    assert.ok(!request.path.includes("auto-stack-auth-probe"));
    if (request.method === "GET") {
      assert.match(request.path, /^\/auto-stack-acceptance-[a-f0-9]{32}\/json$/);
      assert.deepEqual(request.query, { poll: "1", since: "all" });
      if (!request.headers?.Authorization) {
        if (startupUnavailable > 0) {
          startupUnavailable -= 1;
          assert.equal(request.timeoutMs, 2_000);
          return response(503, {});
        }
        let code = 403;
        if (anonymousAllowed) code = 200;
        return response(code, []);
      }
      assert.equal(request.headers.Authorization, `Basic ${Buffer.from("admin:synthetic-private-password").toString("base64")}`);
      return response(200, inventory, true);
    }
    assert.equal(request.method, "POST", "Acceptance must never delete a topic or other message");
    assert.equal(request.approval?.action, "ntfy-acceptance-publish-canary");
    assert.equal(request.approval.once, true);
    assert.ok(request.beforeSendCheckpoint);
    assert.equal(checkpoint?.data.acceptanceTopic, request.path.slice(1));
    assert.equal(checkpoint?.data.acceptanceBody, request.body);
    assert.equal(checkpoint?.data.acceptanceMessageId, null);
    if (denyPublish) throw new Error("Setup HTTP mutation approval was declined");
    assert.ok(!checkpoint?.attemptedActions.includes(request.approval.action));
    await compareAndSet(request.beforeSendCheckpoint);
    checkpoint!.attemptedActions.push(request.approval.action);
    publishes++;
    const published = { id: "abcdefgh1234", event: "message", topic: request.path.slice(1), message: request.body };
    if (storeMessage) inventory = [published];
    if (loseResponse) throw new Error("Synthetic lost response");
    return response(200, published);
  } },
} as AcceptanceContext;

function reset() {
  checkpoint = null; inventory = []; publishes = 0; loseResponse = false;
  storeMessage = true; anonymousAllowed = false; denyPublish = false; requests.length = 0;
  startupUnavailable = 0;
}

try {
  const first = await adapter.begin(context, baseline);
  assert.equal(first.notificationDeliveryVerified, true);
  assert.equal(first.restartPersistenceVerified, false);
  assert.equal(first.appHealthObserved, true);
  assert.equal(publishes, 1);
  await adapter.begin(context, baseline);
  assert.equal(publishes, 1, "Repeated begin must read, never publish a duplicate");
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: baseline.epoch } }), /actual stop/);
  await assert.rejects(adapter.finish(context, { ...restart, stopped: { ...restart.stopped, state: "running" } }), /lifecycle evidence/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "foreign" } }), /lineage/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, recipeSha256: "d".repeat(64) } }), /lineage/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running,
    units: [{ serviceId: "ntfy", imageId: `sha256:${"e".repeat(64)}` }] } }), /lineage/);
  await assert.rejects(adapter.finish(context, { ...restart, stopped: { ...restart.stopped, sequence: 1 } }), /actual stop/);
  startupUnavailable = 2;
  const good = await adapter.finish(context, restart);
  assert.equal(startupUnavailable, 0, "Transient post-start subscription reads are retried before persistence classification");
  assert.equal(good.restartPersistenceVerified, true, "Synthetic lifecycle receipts are fixture credit only");
  assert.equal(publishes, 1);
  inventory[0]!.message = "different bytes";
  await assert.rejects(adapter.finish(context, restart), /exact bytes/);
  inventory = [];
  await assert.rejects(adapter.finish(context, restart), /without republishing/);
  assert.equal(publishes, 1, "Lost cache after restart is not persistence or permission to publish again");

  reset(); loseResponse = true;
  await assert.rejects(adapter.begin(context, baseline), /lost response/);
  assert.equal(publishes, 1);
  assert.equal((await adapter.begin(context, baseline)).notificationDeliveryVerified, true);
  assert.equal(publishes, 1, "Lost publish response resumes by exact nonce/topic readback");
  inventory.push({ ...inventory[0]! });
  await assert.rejects(adapter.begin(context, baseline), /duplicated/);
  assert.equal(publishes, 1);

  reset(); loseResponse = true; storeMessage = false;
  await assert.rejects(adapter.begin(context, baseline), /lost response/);
  await assert.rejects(adapter.begin(context, baseline), /without republishing/);
  assert.equal(publishes, 1, "Missing uncertain publish must never be replayed");

  reset(); anonymousAllowed = true;
  await assert.rejects(adapter.begin(context, baseline), /not private/);
  assert.equal(publishes, 0);
  reset(); denyPublish = true;
  await assert.rejects(adapter.begin(context, baseline), /approval was declined/);
  assert.equal(publishes, 0);
  assert.equal(checkpoint?.attemptedActions.length, 0);

  // Exercise the actual transport approval boundary; no network bytes are sent.
  const publish = requests.find((request) => request.method === "POST")!;
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(status.passwordFile, "synthetic-private-password", { mode: 0o600 });
  let reviews = 0;
  const transport = createSetupTransportFacilities({ appId: "ntfy", projectRoot: root,
    async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
    async approve(action, token) { reviews++; assert.equal(action, publish.approval!.action);
      assert.match(token, /^APP-SETUP-NTFY-ACCEPTANCE-PUBLISH-CANARY:ntfy:[a-f0-9]{64}$/); return false; },
    approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
  await assert.rejects(transport.http.request(publish), /approval was declined/);
  assert.equal(reviews, 1);
  assert.equal(await transport.checkpoint.read(), null, "Declined publish cannot checkpoint an attempt");
  console.log("ntfy acceptance: synthetic round-trip, uncertain-write replay, lifecycle lineage and real approval denial pass; no live credit");
} finally {
  await rm(root, { recursive: true, force: true });
}
