import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import adapter from "./setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest, SetupRecord } from "../../types/setup.ts";

const root = "/tmp/ntfy-owned-token-fixture";
const password = randomBytes(48).toString("base64url");
const token = `tk_${"a".repeat(29)}`;
const action = "ntfy-create-homarr-token";
const completed = "admin-and-homarr-token-verified";

function fixture() {
  let checkpoint: SetupCheckpoint | null = null;
  let saved: string | null = null;
  let issued = false;
  let createCalls = 0;
  let privateReads = 0;
  const requests: SetupHttpRequest[] = [];
  const status: SetupRecord = { command: "app status", ownerKind: "shared", appId: "ntfy",
    projectRoot: root, status: "applied", mutation: false, runtime: { state: "running" },
    username: "admin", passwordFile: `${root}/secrets/admin-password` };
  const context = {
    appId: "ntfy", projectRoot: root,
    async status() { return status; },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(update) {
        assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "ntfy", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
          attemptedActions: checkpoint?.attemptedActions ?? [], data: update.data ?? {} };
        return checkpoint;
      },
    },
    secrets: {
      async readAdminPassword() { privateReads += 1; return password; },
      async readApiKey() { privateReads += 1; return saved; },
      async apiKeyPath() { return `${root}/secrets/ntfy-api-key`; },
      async writeApiKey(value) { saved = value; return `${root}/secrets/ntfy-api-key`; },
    },
    http: { async request(request: SetupHttpRequest) {
      requests.push(request);
      let body: unknown = {};
      let responseStatus = 200;
      if (request.path === "/v1/account/token") {
        assert.equal(request.method, "POST");
        assert.equal(request.approval?.action, action);
        assert.equal(issued, false);
        await context.checkpoint.compareAndSet(request.beforeSendCheckpoint!);
        checkpoint!.attemptedActions.push(action);
        issued = true;
        createCalls += 1;
        body = { token, label: "Homarr" };
      } else if (request.path === "/v1/account") {
        body = { username: "admin", role: "admin", tokens: [] };
        if (issued) body = { username: "admin", role: "admin", tokens: [{ token, label: "Homarr" }] };
      } else {
        assert.equal(request.path, "/auto-stack-auth-probe/json");
        if (!request.headers?.Authorization) responseStatus = 403;
        else assert.ok([
          `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`,
          `Bearer ${token}`,
        ].includes(request.headers.Authorization));
      }
      return { status: responseStatus, ok: responseStatus === 200,
        headers: { get() { return null; } }, async json() { return body; }, async text() { return ""; } };
    } },
  } as SetupContext;
  return { context, status, requests, checkpoint: () => checkpoint,
    setCheckpoint(value: SetupCheckpoint | null) { checkpoint = value; },
    setSaved(value: string) { saved = value; issued = true; },
    reads: () => privateReads, creates: () => createCalls };
}

const fresh = fixture();
const first = await adapter.firstRun(fresh.context);
assert.equal(adapter.ready(first), true);
assert.equal(fresh.checkpoint()?.stage, completed);
assert.deepEqual(await adapter.firstRun(fresh.context), first);
assert.deepEqual(await adapter.inspect!(fresh.context), first);
assert.equal(fresh.creates(), 1);
assert.equal(JSON.stringify(first).includes(token), false);
assert.equal(adapter.ready({ ...first, apiKeyFile: "relative-key" }), false);

// A saved one-time secret can reconcile an interrupted attempt, never duplicate it.
const interrupted = fixture();
interrupted.setSaved(token);
interrupted.setCheckpoint({ schemaVersion: 1, appId: "ntfy", projectRoot: root,
  revision: 2, stage: "homarr-token-create-attempted", attemptedActions: [action], data: {} });
assert.equal(adapter.ready(await adapter.firstRun(interrupted.context)), true);
assert.equal(interrupted.creates(), 0);

for (const change of [
  (value: ReturnType<typeof fixture>) => { value.context.appId = "other-app"; },
  (value: ReturnType<typeof fixture>) => { value.status.projectRoot = "/tmp/other-owner"; },
  (value: ReturnType<typeof fixture>) => { value.status.ownerKind = "standalone"; },
  (value: ReturnType<typeof fixture>) => { value.status.username = "other-admin"; },
  (value: ReturnType<typeof fixture>) => { value.status.passwordFile = "relative-password"; },
  (value: ReturnType<typeof fixture>) => { value.setCheckpoint({ schemaVersion: 1,
    appId: "ntfy", projectRoot: "/tmp/other-owner", revision: 1,
    stage: completed, attemptedActions: [action], data: {} }); },
  (value: ReturnType<typeof fixture>) => { value.setCheckpoint({ schemaVersion: 1,
    appId: "ntfy", projectRoot: root, revision: 1,
    stage: completed, attemptedActions: [], data: {} }); },
]) {
  const invalid = fixture();
  change(invalid);
  await assert.rejects(adapter.firstRun(invalid.context));
  await assert.rejects(adapter.inspect!(invalid.context));
  assert.equal(invalid.reads(), 0);
  assert.equal(invalid.requests.length, 0);
}

const unowned = fixture();
unowned.setSaved(token);
await assert.rejects(adapter.firstRun(unowned.context), /owned creation checkpoint/);
assert.equal(unowned.creates(), 0);
const unfinished = fixture();
await assert.rejects(adapter.inspect!(unfinished.context), /completed owned/);
assert.equal(unfinished.reads(), 0);
assert.equal(unfinished.requests.length, 0);
console.log("PASS ntfy exact-owner inspection, one-time token provenance and interrupted replay; synthetic only");
