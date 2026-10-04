import assert from "node:assert/strict";

import gotify from "../references/catalog/apps/gotify/setup.ts";
import type { SetupContext } from "../references/catalog/types/setup.ts";

const root = "/tmp/gotify-setup-fixture";
const deferred = new Error("setup approval deferred");
let checkpoint: Record<string, unknown> | null = null;
let createCalls = 0;

function response(value: unknown) {
  return { status: 200, ok: true, headers: { get() { return null; } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}

const context = {
  appId: "gotify", projectRoot: root,
  async status() {
    return { command: "app status", appId: "gotify", projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" },
      privateFiles: `${root}/secrets` };
  },
  http: { async request(request: { method: string; path: string }) {
    if (request.method === "GET" && request.path === "/version") {
      return response({ version: "3.1.1" });
    }
    if (request.method === "GET" && request.path === "/current/user") {
      return response({ id: 1, name: "admin", admin: true });
    }
    if (request.method === "GET" && request.path === "/application") {
      return response([]);
    }
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/application");
    createCalls += 1;
    throw deferred;
  } },
  secrets: {
    async readAdminPassword() { return "fixture-admin-password"; },
    async readApiKey() { return null; },
    async apiKeyPath() { return null; },
  },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(update: { expectedRevision: number | null; stage: string;
      data: Record<string, unknown> }) {
      assert.equal(update.expectedRevision, null);
      checkpoint = { schemaVersion: 1, appId: "gotify", projectRoot: root,
        revision: 1, stage: update.stage, attemptedActions: [], data: update.data };
      return checkpoint;
    },
  },
} as unknown as SetupContext;

await assert.rejects(gotify.firstRun(context), (error: unknown) => error === deferred);
assert.equal(createCalls, 1);
assert.equal(checkpoint?.stage, "admin-verified");
process.stdout.write("Gotify declined approval remains deferred\n");

// The same bounded fixture exercises fresh creation and uncertain-write recovery.
const token = "fixture-publisher-token";
const apiKeyFile = `${root}/secrets/gotify-api-key`;
let savedKey: string | null = null;
let inventory: { id: number; name: string }[] = [];
let adminId = 1;
let lostResponse = false;
let writeAcknowledgementLost = false;
let wrongSavedKey = false;
let missingAfterCreate = false;
context.http.request = async (request) => {
  if (request.path === "/version") return response({ version: "3.1.1" }) as never;
  assert.equal(request.headers?.Authorization, "Basic YWRtaW46Zml4dHVyZS1hZG1pbi1wYXNzd29yZA==");
  if (request.path === "/current/user") {
    return response({ id: adminId, name: "admin", admin: true }) as never;
  }
  if (request.method === "GET" && request.path === "/application") {
    return response(inventory) as never;
  }
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/application");
  assert.equal(request.approval?.once, true);
  assert.equal(request.body, JSON.stringify({ name: "Auto-Stack" }));
  createCalls += 1;
  assert.equal(request.beforeSendCheckpoint?.expectedRevision, checkpoint?.revision);
  checkpoint = { ...checkpoint, revision: Number(checkpoint?.revision) + 1,
    stage: request.beforeSendCheckpoint!.stage, data: request.beforeSendCheckpoint!.data,
    attemptedActions: ["gotify-create-application"] };
  if (!missingAfterCreate) inventory = [{ id: 7, name: "Auto-Stack" }];
  if (lostResponse) throw new Error("fixture response lost");
  return response({ id: 7, name: "Auto-Stack", token }) as never;
};
context.checkpoint.compareAndSet = async (update) => {
  assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
  checkpoint = { schemaVersion: 1, appId: "gotify", projectRoot: root,
    revision: Number(checkpoint?.revision ?? 0) + 1, stage: update.stage,
    attemptedActions: checkpoint?.attemptedActions ?? [], data: update.data };
  return checkpoint as never;
};
context.secrets.readApiKey = async () => savedKey;
context.secrets.apiKeyPath = async () => {
  if (savedKey !== null) return apiKeyFile;
  return null;
};
context.secrets.writeApiKey = async (value) => {
  savedKey = value;
  if (wrongSavedKey) savedKey = "fixture-wrong-token";
  if (writeAcknowledgementLost) throw new Error("fixture write acknowledgement lost");
  return apiKeyFile;
};

function reset() {
  checkpoint = null;
  savedKey = null;
  inventory = [];
  createCalls = 0;
  adminId = 1;
  lostResponse = false;
  writeAcknowledgementLost = false;
  wrongSavedKey = false;
  missingAfterCreate = false;
}

reset();
const record = await gotify.firstRun(context);
assert.equal(gotify.ready(record), true);
assert.equal(record.adminUserId, 1);
assert.equal(record.apiKeyFile, apiKeyFile);
assert.equal(savedKey, token);
assert.equal(JSON.stringify(record).includes(token), false);
assert.equal(JSON.stringify(checkpoint).includes(token), false);
assert.equal(gotify.compatibilityResult!(record), null);
const resumed = await gotify.firstRun(context);
const inspected = await gotify.inspect!(context);
const compatibility = { origin: "resume", credentialReadback: "verified" };
assert.deepEqual(resumed, { ...record, setupCompatibility: compatibility });
assert.deepEqual(inspected, record);
assert.deepEqual(gotify.compatibilityResult!(resumed), compatibility);
assert.equal(gotify.compatibilityResult!(inspected), null);
assert.equal(gotify.compatibilityResult!({ ...resumed }), null);
assert.equal(gotify.compatibilityResult!(JSON.parse(JSON.stringify(resumed))), null);
assert.equal(gotify.compatibilityResult!({ ...record, setupCompatibility: compatibility }), null);
assert.equal(createCalls, 1);
adminId = 2;
await assert.rejects(gotify.firstRun(context), /administrator identity changed/);
await assert.rejects(gotify.inspect!(context), /administrator identity changed/);
assert.equal(createCalls, 1);

reset();
await gotify.firstRun(context);
checkpoint = { ...checkpoint, stage: "application-response-validated" };
const recovered = await gotify.firstRun(context);
assert.equal(gotify.ready(recovered), true);
assert.equal(gotify.compatibilityResult!(recovered), null);
assert.equal(createCalls, 1);

reset();
lostResponse = true;
await assert.rejects(gotify.firstRun(context), /response lost/);
await assert.rejects(gotify.firstRun(context), /may already have occurred/);
assert.equal(createCalls, 1);

reset();
writeAcknowledgementLost = true;
assert.equal(gotify.ready(await gotify.firstRun(context)), true);
assert.equal(createCalls, 1);

reset();
wrongSavedKey = true;
await assert.rejects(gotify.firstRun(context), /does not match its private file/);
assert.equal(checkpoint?.stage, "application-create-attempted");
await assert.rejects(gotify.firstRun(context), /may already have occurred/);
assert.equal(createCalls, 1);

reset();
missingAfterCreate = true;
await assert.rejects(gotify.firstRun(context), /saved application changed/);
assert.equal(createCalls, 1);

reset();
inventory = [{ id: 8, name: "Auto-Stack" }];
await assert.rejects(gotify.firstRun(context), /already exists/);
assert.equal(createCalls, 0);

reset();
await gotify.firstRun(context);
inventory.push({ id: 8, name: "Auto-Stack" });
await assert.rejects(gotify.firstRun(context), /saved application changed/);
assert.equal(createCalls, 1);
process.stdout.write("Gotify owner binding, private token readback and no-replay recovery verified\n");
