import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import emby from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/emby/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const root = "/tmp/emby-setup-fixture";
const password = "fixture-generated-password-123456789";
const bearer = "fixture-session-token-123456789";
const key = "fixture-durable-api-key-123456789";
const serverId = "fixture-server";
const ownerId = "42"; // Emby user IDs need not be Jellyfin GUIDs.
const path = `${root}/secrets/emby-api-key`;
const label = `Auto-Stack Emby ${createHash("sha256").update(root).digest("hex").slice(0, 16)}`;
let cp: SetupCheckpoint | null;
let cookies: Record<string, string>;
let stored: string | null;
let keys: string[];
let loginStatus: number;
let completed: boolean;
let loseCreate: boolean;
let failKeyReadback: boolean;
let defer: boolean;
let active: boolean;
let anonymousStatus: number;
let partial: boolean;
let wrongOwner: boolean;
let wrongFreshOwner: boolean;
let freshOwnerStatus: number;
let loginCount: number;
const issuedSessions = new Set<string>();
const calls: SetupHttpRequest[] = [];
function reset() {
  cp = null; cookies = {}; stored = null; keys = []; loginStatus = 200;
  completed = true; loseCreate = false; failKeyReadback = false; defer = false;
  active = true; anonymousStatus = 401; partial = false; wrongOwner = false;
  wrongFreshOwner = false; freshOwnerStatus = 200; loginCount = 0; issuedSessions.clear();
  calls.length = 0;
}
function reply(status: number, value: unknown = null) {
  return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } },
    async json() { return value; }, async text() { return JSON.stringify(value); },
    async arrayBuffer() { return new ArrayBuffer(0); } };
}
function user() {
  let id = ownerId;
  if (wrongOwner) id = "other";
  return { Id: id, ServerId: serverId, Name: "admin", HasConfiguredPassword: true,
    Policy: { IsAdministrator: true, IsDisabled: false } };
}
const context = {
  appId: "emby", projectRoot: root, inputs: {}, installedAppIds: ["emby"],
  async status() { return { command: "app status", appId: "emby", projectRoot: root,
    status: "applied", mutation: false, runtime: { state: "running" }, privateFiles: `${root}/secrets` }; },
  http: { async request(request: SetupHttpRequest) {
    calls.push(request);
    assert.ok(!request.path.startsWith("/Startup/"), "Never touch potentially mutating wizard routes");
    if (request.path === "/System/Info/Public") return reply(200, { Id: serverId, Version: "4.10.0.40" });
    if (request.path === "/Users/AuthenticateByName") {
      assert.ok(request.approval);
      assert.equal(request.headers?.["Content-Type"], "application/x-www-form-urlencoded; charset=UTF-8");
      assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body as string)), { Username: "admin", Pw: password });
      let accessToken = bearer;
      if (cookies.bearer) accessToken = `${bearer}-fresh-${++loginCount}`;
      issuedSessions.add(accessToken);
      const identity = user();
      if (wrongFreshOwner) identity.Id = "other";
      return reply(loginStatus, { AccessToken: accessToken, ServerId: serverId, User: identity });
    }
    const supplied = request.headers?.["X-Emby-Token"];
    if (request.path === "/System/Configuration" && !supplied) return reply(anonymousStatus);
    assert.ok(issuedSessions.has(supplied!) || supplied === key);
    if (request.path === `/Users/${ownerId}`) {
      let status = 200;
      if (supplied !== cookies.bearer) status = freshOwnerStatus;
      return reply(status, user());
    }
    if (request.path === "/System/Configuration") return reply(200, { IsStartupWizardCompleted: completed });
    if (request.path === "/System/Info") {
      if (failKeyReadback) throw new Error("fixture failed readback");
      assert.equal(supplied, stored, "Capture durable key before its next request");
      assert.equal(cp?.stage, "key-saved");
      return reply(200, { Id: serverId, Version: "4.10.0.40" });
    }
    if (request.path === "/Auth/Keys" && request.method === "GET") {
      let total = keys.length;
      if (partial) total += 1;
      return reply(200, { Items: keys.map((AccessToken) => ({ AppName: label, AccessToken, IsActive: active })), TotalRecordCount: total });
    }
    if (request.path === "/Auth/Keys" && request.method === "POST") {
      assert.deepEqual(request.query, { App: label });
      assert.equal(request.approval?.once, true);
      assert.equal(request.approval?.action, "emby-create-api-key");
      assert.equal(request.beforeSendCheckpoint?.expectedRevision, cp?.revision);
      if (defer) throw new Error("fixture pending approval");
      cp = { ...cp!, revision: cp!.revision + 1, stage: request.beforeSendCheckpoint!.stage,
        attemptedActions: [request.approval!.action], data: request.beforeSendCheckpoint!.data! };
      keys.push(key);
      if (loseCreate) throw new Error("fixture lost response");
      return reply(200);
    }
    throw new Error(`Unexpected fixture route ${request.method} ${request.path}`);
  } },
  checkpoint: { async read() { return cp; }, async compareAndSet(next) {
    assert.equal(next.expectedRevision, cp?.revision ?? null);
    cp = { schemaVersion: 1, appId: "emby", projectRoot: root, revision: (cp?.revision ?? 0) + 1,
      stage: next.stage, data: next.data ?? {}, attemptedActions: cp?.attemptedActions ?? [] };
    return cp;
  } },
  secrets: { async readAdminPassword() { return password; }, async readSessionCookies() { return cookies; },
    async writeSessionCookies(next) { cookies = { ...next }; }, async readApiKey() { return stored; },
    async apiKeyPath() { if (stored === null) return null; return path; },
    async writeApiKey(value) { assert.equal(value, key); stored = value; return path; } },
} satisfies Pick<SetupContext, "appId" | "projectRoot" | "inputs" | "installedAppIds" | "status" | "http" | "checkpoint">
  & { secrets: Pick<SetupContext["secrets"], "readAdminPassword" | "readSessionCookies" | "writeSessionCookies" | "readApiKey" | "apiKeyPath" | "writeApiKey"> };
const setup = context as SetupContext;
const writes = () => calls.filter((call) => call.method === "POST" && call.path === "/Auth/Keys");

reset();
const ready = await emby.firstRun(setup);
assert.equal(emby.ready(ready), true);
assert.equal(ready.firstOwnerSetup, "manual");
assert.equal(ready.restartPersistenceVerified, false);
assert.equal(emby.ready(await emby.firstRun(setup)), true);
assert.equal(emby.ready(await emby.inspect!(context)), true);
assert.equal(writes().length, 1);
assert.equal(calls.filter((call) => call.path === "/Users/AuthenticateByName").length, 2);
assert.ok(!JSON.stringify(cp).includes(password) && !JSON.stringify(cp).includes(key));

const retainedSession = { ...cookies };
loginStatus = 401;
await assert.rejects(emby.firstRun(setup), /first owner remains manual/);
assert.deepEqual(cookies, retainedSession);
loginStatus = 200; wrongFreshOwner = true;
await assert.rejects(emby.firstRun(setup), /exact enabled/);
assert.deepEqual(cookies, retainedSession);
wrongFreshOwner = false; freshOwnerStatus = 401;
await assert.rejects(emby.firstRun(setup), /fresh-session owner readback failed/);
assert.deepEqual(cookies, retainedSession);
freshOwnerStatus = 200;
assert.equal(emby.ready(await emby.firstRun(setup)), true);
assert.deepEqual(cookies, retainedSession);

reset(); loginStatus = 401;
await assert.rejects(emby.firstRun(setup), /first owner remains manual/);
assert.equal(writes().length, 0); assert.equal(cp, null);
reset(); completed = false;
await assert.rejects(emby.firstRun(setup), /wizard must be completed manually/);
assert.equal(writes().length, 0);

reset(); loseCreate = true;
await assert.rejects(emby.firstRun(setup), /lost response/);
loseCreate = false;
assert.equal(emby.ready(await emby.firstRun(setup)), true);
assert.equal(writes().length, 1);
reset(); failKeyReadback = true;
await assert.rejects(emby.firstRun(setup), /failed readback/);
assert.equal(stored, key); assert.equal(cp!.stage, "key-saved");
failKeyReadback = false;
assert.equal(emby.ready(await emby.firstRun(setup)), true);
assert.equal(writes().length, 1);

reset(); defer = true;
await assert.rejects(emby.firstRun(setup), /pending approval/);
const pending = JSON.stringify(writes()[0]);
await assert.rejects(emby.firstRun(setup), /pending approval/);
assert.equal(JSON.stringify(writes()[1]), pending);
defer = false;
assert.equal(emby.ready(await emby.firstRun(setup)), true);

reset(); keys = [key];
await assert.rejects(emby.firstRun(setup), /uncheckpointed project key/);
assert.equal(writes().length, 0);
reset(); loseCreate = true;
await assert.rejects(emby.firstRun(setup));
loseCreate = false; keys.push("fixture-second-durable-key-123456789");
await assert.rejects(emby.firstRun(setup), /duplicate project-labeled/);
assert.equal(writes().length, 1); assert.equal(stored, null);
reset(); partial = true;
await assert.rejects(emby.firstRun(setup), /inventory is incomplete/);
assert.equal(writes().length, 0);
reset(); loseCreate = true;
await assert.rejects(emby.firstRun(setup));
keys = []; loseCreate = false;
await assert.rejects(emby.firstRun(setup), /never replay creation/);
assert.equal(writes().length, 1);
reset(); await emby.firstRun(setup); active = false;
await assert.rejects(emby.firstRun(setup), /inactive/);
reset(); await emby.firstRun(setup); wrongOwner = true;
await assert.rejects(emby.firstRun(setup), /exact enabled/);
reset(); anonymousStatus = 200;
await assert.rejects(emby.firstRun(setup), /deny anonymous/);
assert.equal(stored, key);
console.log("Emby post-manual-bootstrap setup fixture passed");
