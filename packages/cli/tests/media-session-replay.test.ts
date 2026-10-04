import assert from "node:assert/strict";
import tdarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/tdarr/setup.ts";
import deluge from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/deluge/setup.ts";
import nzbget from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/nzbget/setup.ts";
import type { SetupContext, SetupCheckpoint, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

// Synthetic transport boundary: decline the mutation twice, then approve the
// exact previously returned request. No app process or Docker is involved.
function fixture(appId: string) {
  const root = `/tmp/${appId}-session-fixture`;
  let checkpoint: SetupCheckpoint | null = null;
  let cookies: Record<string, string> = {};
  let key: string | null = null;
  const context = {
    appId, projectRoot: root, inputs: {},
    async status() { return { command: "app status", appId, projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" },
      username: null, port: 8112, url: "http://127.0.0.1:8112",
      passwordFile: `${root}/password`, ownerKind: "shared" }; },
    secrets: {
      async readAdminPassword() { return "a".repeat(48); },
      async readSessionCookies() { return { ...cookies }; },
      async writeSessionCookies(value: Record<string, string>) { cookies = { ...value }; },
      async readApiKey() { return key; },
      async writeApiKey(value: string) { key = value; return `${root}/key`; },
      async apiKeyPath() { return key === null ? null : `${root}/key`; },
    },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(update: { expectedRevision: number | null; stage: string;
        data?: Record<string, string | number | boolean | null> }) {
        assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId, projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
          data: update.data ?? {}, attemptedActions: checkpoint?.attemptedActions ?? [] };
        return checkpoint;
      },
    },
  } as unknown as SetupContext;
  return { context, get cookies() { return cookies; },
    async sent(request: SetupHttpRequest) {
      if (!request.beforeSendCheckpoint) return;
      const next = await context.checkpoint.compareAndSet(request.beforeSendCheckpoint);
      next.attemptedActions.push(request.approval!.action);
    } };
}

function reply(value: unknown, cookie: string | null = null, status = 200) {
  return { status, ok: status === 200, headers: { get() { return cookie; } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}

const t = fixture("tdarr");
let tdarrLogins = 0;
let registered = false;
let inserted = false;
let defer = true;
let ownerStatus = 200;
let passwordAccepted = true;
let freshTokenStatus = 200;
let retainedBearer: string | undefined;
const requests: string[] = [];
t.context.http = { async request(request) {
  if (request.path.endsWith("/login")) {
    tdarrLogins += 1;
    if (!registered || !passwordAccepted) return reply({}, null, 401);
    return reply({ token: `fixture-token-${tdarrLogins}` });
  }
  if (request.path.endsWith("/register")) {
    await t.sent(request);
    registered = true;
    return { ...reply({}), status: 201, ok: true };
  }
  if (request.path.endsWith("/verify-token")) {
    if (!request.headers?.Authorization) return reply({ setupAdmin: true }, null, 401);
    if (retainedBearer && request.headers.Authorization !== `Bearer ${retainedBearer}`) {
      return reply({ roles: ["admin"] }, null, freshTokenStatus);
    }
    return reply({ roles: ["admin"] }, null, ownerStatus);
  }
  const body = JSON.parse(request.body as string);
  if (body.data.mode === "insert") {
    requests.push(JSON.stringify(request));
    if (defer) throw new Error("approval deferred");
    await t.sent(request);
    inserted = true;
    return reply({});
  }
  return reply(inserted ? [{ _id: await t.context.secrets.readApiKey() }] : []);
} };
await assert.rejects(tdarr.firstRun(t.context), /approval deferred/);
await assert.rejects(tdarr.firstRun(t.context), /approval deferred/);
assert.equal(requests[0], requests[1]);
assert.equal(tdarrLogins, 3); // Initial probe, first-owner login, then fresh resume verification.
retainedBearer = t.cookies.bearer;
passwordAccepted = false;
await assert.rejects(tdarr.firstRun(t.context), /rejected the saved owner password/);
assert.equal(t.cookies.bearer, retainedBearer);
assert.equal(requests.length, 2, "A stale saved password cannot reach key insertion");
passwordAccepted = true;
freshTokenStatus = 401;
await assert.rejects(tdarr.firstRun(t.context), /session expired/);
assert.equal(t.cookies.bearer, retainedBearer, "A rejected fresh token preserves the reviewed bearer");
assert.equal(requests.length, 2);
freshTokenStatus = 200;
ownerStatus = 503;
await assert.rejects(tdarr.firstRun(t.context), /readback failed/);
assert.ok(t.cookies.bearer);
ownerStatus = 200;
defer = false;
assert.equal(tdarr.ready(await tdarr.firstRun(t.context)), true);
assert.equal(requests[0], requests[2]);
ownerStatus = 401;
await assert.rejects(tdarr.firstRun(t.context), /session expired/);
assert.equal(t.cookies.bearer, undefined);
ownerStatus = 200;
const unowned = fixture("tdarr");
unowned.context.http = t.context.http;
await assert.rejects(tdarr.firstRun(unowned.context), /uncheckpointed owner/);

const d = fixture("deluge");
let seedLogins = 0;
let rotated = false;
let sessionValid: boolean | null = true;
defer = true;
requests.length = 0;
d.context.http = { async request(request) {
  const body = JSON.parse(request.body as string);
  let result: unknown;
  let cookie: string | null = null;
  if (body.method === "auth.check_session") {
    if (sessionValid === null) throw new Error("network uncertainty");
    result = sessionValid;
  } else if (body.method === "auth.login") {
    const seed = body.params[0] === "deluge";
    result = seed !== rotated;
    if (result) cookie = `_session_id=fixture${seed ? ++seedLogins : "managed"}`;
  } else {
    assert.equal(body.method, "auth.change_password");
    requests.push(JSON.stringify(request));
    if (defer) throw new Error("approval deferred");
    await d.sent(request);
    rotated = true;
    result = true;
  }
  return reply({ id: 1, error: null, result }, cookie);
} };
await assert.rejects(deluge.firstRun(d.context), /approval deferred/);
await assert.rejects(deluge.firstRun(d.context), /approval deferred/);
assert.equal(requests[0], requests[1]);
assert.equal(seedLogins, 1);
sessionValid = null;
await assert.rejects(deluge.firstRun(d.context), /network uncertainty/);
assert.ok(d.cookies.seed_cookie);
sessionValid = true;
defer = false;
assert.equal(deluge.ready(await deluge.firstRun(d.context)), true);
assert.equal(requests[0], requests[2]);
assert.equal(deluge.ready(await deluge.firstRun(d.context)), true);
assert.equal(requests.length, 3);
const expired = fixture("deluge");
await expired.context.secrets.writeSessionCookies(d.cookies);
expired.context.http = d.context.http;
sessionValid = false;
await assert.rejects(deluge.firstRun(expired.context), /seed session expired/);
assert.deepEqual(expired.cookies, {});
const n = fixture("nzbget");
let anonymousStatus = 401;
let rpcId = "auto-stack-version";
n.context.http = { async request(request) {
  assert.deepEqual(JSON.parse(request.body as string), {
    version: "1.1", method: "version", params: [], id: "auto-stack-version" });
  if (!request.headers?.Authorization) return reply({}, null, anonymousStatus);
  assert.equal(request.headers.Authorization, `Basic ${Buffer.from(`admin:${"a".repeat(48)}`).toString("base64")}`);
  return reply({ id: rpcId, error: null, result: "26.3" });
} };
assert.equal(nzbget.ready(await nzbget.firstRun(n.context)), true);
anonymousStatus = 200;
await assert.rejects(nzbget.firstRun(n.context), /anonymous access/);
anonymousStatus = 401;
rpcId = "different-request";
await assert.rejects(nzbget.firstRun(n.context), /RPC version/);
console.log("Media setup session replay fixture passed");
