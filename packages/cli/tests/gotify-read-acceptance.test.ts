import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/gotify/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { loadSharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";
import { sharedAcceptanceAvailable } from "../src/lib/shared-acceptance.ts";

const root = "/tmp/gotify-read-acceptance-source-fixture";
const digest = "a".repeat(64);
const running: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "gotify",
  projectRoot: root, ownerId: "fixture", recipeSha256: digest, manifestHash: digest,
  units: [{ serviceId: "gotify", imageId: `sha256:${digest}` }], epoch: "b".repeat(64),
  sequence: 1, evidenceId: randomUUID(), state: "running" };
const restart = {
  stopped: { ...running, state: "stopped" as const, sequence: 2, evidenceId: randomUUID() },
  running: { ...running, epoch: "c".repeat(64), sequence: 3, evidenceId: randomUUID() },
};

function fixture() {
  let saved: SetupCheckpoint | null = null;
  let userId = 7;
  let applicationId = 12;
  let messageId = 42;
  let appid = 12;
  let body = "synthetic private existing-message payload";
  let title = "synthetic fixture title";
  let status = 200;
  let missing = false;
  let duplicates = false;
  let startupUnavailable = 0;
  const requests: SetupHttpRequest[] = [];
  const context: AcceptanceContext = {
    appId: "gotify", projectRoot: root, inputs: { "message-id": "42" },
    async status() { return { command: "app status", appId: "gotify", projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" },
      ownerKind: "shared", ownerPhase: "completed", projectId: "fixture", manifestHash: digest }; },
    checkpoint: {
      async read() { return saved; },
      async compareAndSet(update: SetupCheckpointUpdate) {
        assert.equal(update.expectedRevision, saved?.revision ?? null);
        saved = { schemaVersion: 1, appId: "gotify", projectRoot: root, stage: update.stage,
          revision: (saved?.revision ?? 0) + 1, data: update.data ?? {}, attemptedActions: [] };
        return saved;
      },
    },
    secrets: {
      async readAdminPassword() { return "fixture-password"; },
      async readApiKey() { throw new Error("Publisher token must not be used for reads"); },
    } as AcceptanceContext["secrets"],
    http: { async request(request) {
      requests.push(request);
      assert.equal(request.method, "GET");
      assert.equal(request.approval, undefined);
      assert.equal(request.body, undefined);
      if (request.path === "/version") {
        if (startupUnavailable > 0) { startupUnavailable -= 1; return new Response("unavailable", { status: 503 }); }
        return Response.json({ version: "3.1.1" });
      }
      assert.equal(request.headers?.Authorization, `Basic ${Buffer.from("admin:fixture-password").toString("base64")}`);
      if (status !== 200) return new Response("private upstream error", { status });
      if (request.path === "/current/user") return Response.json({ id: userId, name: "admin", admin: true });
      if (request.path === "/application") {
        const apps = [{ id: applicationId, name: "Auto-Stack", token: "" }];
        if (duplicates) apps.push({ id: 99, name: "Auto-Stack", token: "" });
        return Response.json(apps);
      }
      assert.equal(request.path, `/application/${applicationId}/message`);
      assert.deepEqual(request.query, { limit: "1", since: "43" });
      let messages = [{ id: messageId, appid, message: body, title, priority: 0,
        date: "2026-10-03T10:00:00Z", extras: { "test::display": { synthetic: true } } }];
      if (missing) messages = [];
      return Response.json({ messages, paging: { size: messages.length, limit: 1, next: "", since: 0 } });
    } },
  };
  return { context, requests, saved: () => saved,
    change(value: { userId?: number; applicationId?: number; messageId?: number; appid?: number;
      body?: string; title?: string; status?: number; missing?: boolean; duplicates?: boolean; startupUnavailable?: number }) {
      if (value.userId !== undefined) userId = value.userId;
      if (value.applicationId !== undefined) applicationId = value.applicationId;
      if (value.messageId !== undefined) messageId = value.messageId;
      if (value.appid !== undefined) appid = value.appid;
      if (value.body !== undefined) body = value.body;
      if (value.title !== undefined) title = value.title;
      if (value.status !== undefined) status = value.status;
      if (value.missing !== undefined) missing = value.missing;
      if (value.duplicates !== undefined) duplicates = value.duplicates;
      if (value.startupUnavailable !== undefined) startupUnavailable = value.startupUnavailable;
    } };
}

const contract = await loadSharedAcceptanceContract("gotify");
assert.equal(contract, null);
assert.equal(await sharedAcceptanceAvailable("gotify"), false);
for (const id of ["0", "-1", "01", "1.2", "12345678901"]) {
  const f = fixture(); f.context.inputs = { "message-id": id };
  await assert.rejects(adapter.begin(f.context, running));
}
const good = fixture();
const before = await adapter.begin(good.context, running);
assert.equal(before.restartPersistenceVerified, false);
assert.equal(before.pushDeliveryVerified, false);
assert.equal(before.clientDeliveryVerified, false);
assert.equal(before.existingMessageReadVerified, true);
assert.match(String(before.messageSha256), /^[a-f0-9]{64}$/);
assert.ok(Number(before.messageSize) > 0);
assert.ok(!JSON.stringify({ before, checkpoint: good.saved() }).includes("synthetic private"));
assert.ok(!JSON.stringify({ before, checkpoint: good.saved() }).includes("fixture-password"));
assert.ok(!JSON.stringify({ before, checkpoint: good.saved() }).includes("fixture title"));
good.change({ startupUnavailable: 1 });
const after = await adapter.finish(good.context, restart);
assert.equal(after.existingMessageReadVerified, true);
assert.equal(after.restartPersistenceVerified, true);
assert.equal(after.pushDeliveryVerified, false);
assert.equal(after.clientDeliveryVerified, false);
for (const change of [{ missing: true }, { body: "" }, { body: " \n " }, { appid: 99 },
  { messageId: 41 }, { duplicates: true }, { status: 401 }, { status: 403 }, { status: 404 },
  { body: "x".repeat(1024 * 1024) }]) {
  const f = fixture(); f.change(change);
  await assert.rejects(adapter.begin(f.context, running));
  assert.equal(f.saved(), null);
}
for (const change of [{ userId: 8 }, { applicationId: 13, appid: 13 }, { body: "changed" }, { title: "changed metadata" }]) {
  const f = fixture(); await adapter.begin(f.context, running); f.change(change);
  await assert.rejects(adapter.finish(f.context, restart));
  assert.equal(f.saved()?.data.persistenceVerified, false);
}
const changedInput = fixture(); await adapter.begin(changedInput.context, running);
changedInput.context.inputs = { "message-id": "43" };
await assert.rejects(adapter.finish(changedInput.context, restart));
const lineage = fixture(); await adapter.begin(lineage.context, running);
await assert.rejects(adapter.finish(lineage.context, { ...restart,
  running: { ...restart.running, units: [{ serviceId: "other", imageId: `sha256:${digest}` }] } }));
await assert.rejects(adapter.finish(lineage.context, { ...restart, running: { ...restart.running, ownerId: "different" } }));
await assert.rejects(adapter.finish(lineage.context, { ...restart, running: { ...restart.running, epoch: running.epoch } }));
console.log("Gotify staged existing-message source fixtures passed; dispatcher unavailable, no product/core/live acceptance credit");
