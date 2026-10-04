import assert from "node:assert/strict";

import seerr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest, SetupInspectionContext } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const root = "/tmp/seerr-first-admin-fixture";
const keyPath = `${root}/secrets/seerr-api-key`;
const key = Buffer.from("1730000000000fixture-seerr-uuid-1234567890").toString("base64");
let saved: SetupCheckpoint | null = null;
let privateKey: string | null = null;
let loginCount = 0;
let peerReads = 0;
let loseResponse = false;
let initialized = false;
let serverHost = "jellyfin";
let jellyfinLibrariesReady = false;
let libraries = [
  { id: "movies-id", name: "Movies", enabled: false },
  { id: "shows-id", name: "Shows", enabled: false },
];
let syncCount = 0;
const enabledCalls: string[] = [];
let loseMoviesResponse = false;
let loseKeyReadback = false;
let loseMainReadback = false;
let privateSession: Record<string, string> = {};
let loginCookies: string[] | null = null;
let loginIdentity = { id: 1, jellyfinUsername: "admin", permissions: 2, userType: 3 };
let keyIdentity = { ...loginIdentity };
let inventory = { exitCode: 0, stdout: '{"count":0}' };
let inventoryReads = 0;

function reply(status: number, value: unknown, cookie: string | null = null) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name: string) { return name === "set-cookie" ? cookie : null; } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}

const context = {
  appId: "seerr", projectRoot: root,
  async status() {
    return { command: "app status", appId: "seerr", projectRoot: root,
      ownerKind: "shared", status: "applied", mutation: false,
      runtime: { state: "running" }, privateFiles: `${root}/secrets`,
      loginVia: "jellyfin", passwordFile: null };
  },
  peers: {
    async inspectVerified(appId: string) {
      assert.equal(appId, "jellyfin");
      if (jellyfinLibrariesReady) {
        return { appId, projectRoot: root, stage: "admin-api-key-and-libraries-verified",
          mediaLibrary: "movies-and-shows-verified" };
      }
      return { appId, projectRoot: root, stage: "admin-and-api-key-saved",
        mediaLibrary: "not-configured-owner-path-required" };
    },
    async readVerifiedAdmin(appId: "jellyfin") {
      assert.equal(appId, "jellyfin");
      peerReads++;
      return { username: "admin" as const, password: "private-jellyfin-password" };
    },
  },
  container: { async exec(command: { effect: string; argv: string[];
    approval: { action: string }; beforeSendCheckpoint?: unknown }) {
    inventoryReads++;
    assert.equal(command.effect, "read");
    assert.equal(command.approval.action, "seerr-inspect-empty-users");
    assert.equal(command.beforeSendCheckpoint, undefined);
    assert.deepEqual(command.argv.slice(0, 2), ["node", "-e"]);
    assert.match(command.argv[2], /sqlite\.OPEN_READONLY/);
    assert.match(command.argv[2], /\/app\/config\/db\/db\.sqlite3/);
    assert.match(command.argv[2], /SELECT COUNT\(\*\) AS count FROM "user"/);
    assert.doesNotMatch(command.argv[2], /OPEN_READWRITE|OPEN_CREATE|INSERT|UPDATE|DELETE/);
    return { ...inventory };
  } },
  http: { async request(request: SetupHttpRequest) {
    if (request.path === "/api/v1/settings/public") return reply(200, { initialized });
    if (request.method === "POST" && request.path === "/api/v1/auth/jellyfin") {
      loginCount++;
      assert.equal(request.approval?.once, true);
      assert.equal(request.beforeSendCheckpoint?.stage, "login-attempted");
      assert.deepEqual(JSON.parse(request.body as string), {
        username: "admin", password: "private-jellyfin-password", hostname: "jellyfin",
        port: 8096, urlBase: "", useSsl: false, serverType: 2,
      });
      assert.equal(request.beforeSendCheckpoint?.expectedRevision, null);
      saved = { schemaVersion: 1, appId: "seerr", projectRoot: root, revision: 1,
        stage: "login-attempted", attemptedActions: ["seerr-jellyfin-first-admin"],
        data: { providerAppId: "jellyfin" } };
      if (loseResponse) throw new Error("response lost");
      const response = reply(200, loginIdentity, "connect.sid=fixture-session; Path=/");
      if (loginCookies !== null) {
        return { ...response, headers: { ...response.headers, getSetCookie() { return loginCookies!; } } };
      }
      return response;
    }
    if (request.path === "/api/v1/settings/main") {
      assert.equal(request.headers?.Cookie, "connect.sid=fixture-session");
      if (loseMainReadback) throw new Error("main readback lost");
      return reply(200, { apiKey: key });
    }
    if (request.path === "/api/v1/auth/me") {
      assert.equal(request.headers?.["X-Api-Key"], key);
      if (loseKeyReadback) throw new Error("key readback lost");
      assert.equal(privateKey, key, "Save the durable API key before protected readback");
      return reply(200, keyIdentity);
    }
    if (request.path === "/api/v1/settings/jellyfin") {
      assert.equal(request.headers?.["X-Api-Key"], key);
      return reply(200, { ip: serverHost, port: 8096, useSsl: false, serverId: "server-1" });
    }
    if (request.path === "/api/v1/settings/jellyfin/library/sync" && request.method === "POST") {
      assert.equal(request.headers?.["X-Api-Key"], key);
      assert.equal(request.approval?.action, "seerr-sync-jellyfin-libraries");
      syncCount++;
      return reply(200, structuredClone(libraries));
    }
    if (request.path === "/api/v1/settings/jellyfin/library" && request.method === "GET") {
      assert.equal(request.headers?.["X-Api-Key"], key);
      return reply(200, structuredClone(libraries));
    }
    if (request.path.startsWith("/api/v1/settings/jellyfin/library/") && request.method === "PUT") {
      assert.equal(request.headers?.["X-Api-Key"], key);
      assert.deepEqual(JSON.parse(request.body as string), { enabled: true });
      const id = request.path.split("/").at(-1);
      const library = libraries.find((item) => item.id === id);
      assert.ok(library);
      library.enabled = true;
      enabledCalls.push(library.id);
      if (loseMoviesResponse && library.id === "movies-id") {
        loseMoviesResponse = false;
        throw new Error("library response lost");
      }
      return reply(200, structuredClone(library));
    }
    throw new Error(`Unexpected ${request.method} ${request.path}`);
  } },
  secrets: {
    async readSessionCookies() { return { ...privateSession }; },
    async writeSessionCookies(value: Record<string, string>) { privateSession = { ...value }; },
    async readApiKey() { return privateKey; },
    async apiKeyPath() { return privateKey === null ? null : keyPath; },
    async writeApiKey(value: string) { assert.equal(value, key); privateKey = value; return keyPath; },
  },
  checkpoint: {
    async read() { return saved; },
    async compareAndSet(update: { expectedRevision: number | null; stage: string;
      data?: Record<string, string | number | boolean | null> }) {
      assert.equal(update.expectedRevision, saved?.revision ?? null);
      saved = { schemaVersion: 1, appId: "seerr", projectRoot: root,
        revision: (saved?.revision ?? 0) + 1, stage: update.stage,
        attemptedActions: saved?.attemptedActions ?? [], data: update.data ?? {} };
      return saved;
    },
  },
} as unknown as SetupContext;

const first = await seerr.firstRun(context);
assert.equal(seerr.ready(first), true);
assert.equal(first.apiKeyFile, keyPath);
assert.equal(first.functionalAcceptance, "pending-libraries-arr-initialization-and-restart");
assert.equal(loginCount, 1);
assert.equal(peerReads, 1);
assert.equal(inventoryReads, 1);
assert.equal(saved?.stage, "key-saved");
assert.equal(seerr.ready(await seerr.firstRun(context)), true);
assert.equal(loginCount, 1);
assert.equal(inventoryReads, 1, "Saved first-admin setup does not require an empty database on resume");
assert.equal((await seerr.inspect!(context as SetupInspectionContext)).apiKeyFile, keyPath);

jellyfinLibrariesReady = true;
const withLibraries = await seerr.firstRun(context);
assert.equal(seerr.ready(withLibraries), true);
assert.equal(withLibraries.stage, "admin-api-key-and-libraries-verified");
assert.equal(saved?.stage, "libraries-verified");
assert.deepEqual(enabledCalls, ["movies-id", "shows-id"]);
assert.equal(syncCount, 1);
assert.equal((await seerr.inspect!(context as SetupInspectionContext)).stage,
  "admin-api-key-and-libraries-verified");
assert.equal((await seerr.firstRun(context)).stage, "admin-api-key-and-libraries-verified");
assert.equal(syncCount, 1);

saved = { schemaVersion: 1, appId: "seerr", projectRoot: root, revision: 2,
  stage: "key-saved", attemptedActions: ["seerr-jellyfin-first-admin"],
  data: { providerAppId: "jellyfin", apiKeyFile: keyPath } };
libraries = [
  { id: "movies-id", name: "Movies", enabled: false },
  { id: "shows-id", name: "Shows", enabled: false },
];
enabledCalls.length = 0;
loseMoviesResponse = true;
await assert.rejects(seerr.firstRun(context), /library response lost/);
assert.equal(saved?.stage, "libraries-selected");
assert.deepEqual(enabledCalls, ["movies-id"]);
assert.equal((await seerr.firstRun(context)).stage, "admin-api-key-and-libraries-verified");
assert.deepEqual(enabledCalls, ["movies-id", "shows-id"]);

jellyfinLibrariesReady = false;

serverHost = "other";
await assert.rejects(seerr.inspect!(context as SetupInspectionContext), /differs from the managed shared peer/);
serverHost = "jellyfin";

saved = null;
privateKey = null;
privateSession = {};
loseMainReadback = true;
await assert.rejects(seerr.firstRun(context), /main readback lost/);
assert.equal(privateKey, null);
assert.equal(privateSession.seerr_cookie, "connect.sid=fixture-session");
const loginsBeforeMainRecovery = loginCount;
const inventoriesBeforeMainRecovery = inventoryReads;
loseMainReadback = false;
assert.equal(seerr.ready(await seerr.firstRun(context)), true);
assert.equal(loginCount, loginsBeforeMainRecovery, "Recover key capture using the saved session without first login");
assert.equal(inventoryReads, inventoriesBeforeMainRecovery);

saved = null;
privateKey = null;
privateSession = {};
loseKeyReadback = true;
await assert.rejects(seerr.firstRun(context), /key readback lost/);
assert.equal(saved?.stage, "login-attempted");
assert.equal(privateKey, key, "Capture the durable key before its first network readback");
const loginsBeforeRecovery = loginCount;
loseKeyReadback = false;
assert.equal(seerr.ready(await seerr.firstRun(context)), true);
assert.equal(loginCount, loginsBeforeRecovery, "Recover without repeating first-admin login");

saved = null;
privateKey = null;
privateSession = {};
loseResponse = true;
await assert.rejects(seerr.firstRun(context), /response lost/);
assert.equal(saved?.stage, "login-attempted");
await assert.rejects(seerr.firstRun(context), /outcome is uncertain/);
assert.equal(loginCount, loginsBeforeRecovery + 1);
loseResponse = false;
privateKey = key;
assert.equal(seerr.ready(await seerr.firstRun(context)), true);
assert.equal(loginCount, loginsBeforeRecovery + 1);

saved = null;
privateKey = null;
initialized = true;
await assert.rejects(seerr.firstRun(context), /unmanaged setup state/);
assert.equal(loginCount, loginsBeforeRecovery + 1);

initialized = false;
saved = null;
privateKey = null;
privateSession = {};
loginCookies = ["XSRF-TOKEN=fixture-csrf; Path=/", "connect.sid=fixture-session; Path=/; HttpOnly"];
assert.equal(seerr.ready(await seerr.firstRun(context)), true);
assert.equal(privateSession.seerr_cookie, "connect.sid=fixture-session",
  "Extract the exact session cookie, not the first unrelated response cookie");

for (const cookies of [
  [],
  ["XSRF-TOKEN=fixture-csrf; Path=/"],
  ["connect.sid=first; Path=/", "connect.sid=second; Path=/"],
  ["connect.sid=first, connect.sid=second"],
  ["connect.sid=; Path=/"],
]) {
  saved = null;
  privateKey = null;
  privateSession = {};
  loginCookies = cookies;
  const before = loginCount;
  await assert.rejects(seerr.firstRun(context), /session was not established unambiguously/);
  assert.equal(saved?.stage, "login-attempted");
  assert.equal(privateKey, null);
  await assert.rejects(seerr.firstRun(context), /outcome is uncertain/);
  assert.equal(loginCount, before + 1, "Missing or ambiguous cookies never replay first login");
}

loginCookies = null;
for (const identity of [
  { ...loginIdentity, permissions: 0 },
  { ...loginIdentity, permissions: 4 },
  { ...loginIdentity, userType: 2 },
  { ...loginIdentity, id: 2 },
]) {
  saved = null;
  privateKey = null;
  privateSession = {};
  const expectedIdentity = loginIdentity;
  loginIdentity = identity;
  const before = loginCount;
  await assert.rejects(seerr.firstRun(context), /expected first administrator/);
  loginIdentity = expectedIdentity;
  await assert.rejects(seerr.firstRun(context), /outcome is uncertain/);
  assert.equal(loginCount, before + 1, "Unexpected first identity never replays login");
}

saved = null;
privateKey = null;
privateSession = {};
keyIdentity = { ...loginIdentity, permissions: 4 };
const beforeWrongRole = loginCount;
await assert.rejects(seerr.firstRun(context), /expected first administrator/);
assert.equal(privateKey, key);
await assert.rejects(seerr.firstRun(context), /expected first administrator/);
assert.equal(loginCount, beforeWrongRole + 1, "Unexpected key role retains credentials without login replay");
keyIdentity = { ...loginIdentity };
assert.equal(seerr.ready(await seerr.firstRun(context)), true);
keyIdentity.permissions = 0;
await assert.rejects(seerr.inspect!(context as SetupInspectionContext), /expected first administrator/);
keyIdentity = { ...loginIdentity };

saved = { schemaVersion: 1, appId: "seerr", projectRoot: root, revision: 1,
  stage: "login-attempted", attemptedActions: ["seerr-jellyfin-first-admin"],
  data: { providerAppId: "jellyfin" } };
privateKey = null;
privateSession = { seerr_cookie: "XSRF-TOKEN=fixture-csrf" };
const beforeInvalidSession = loginCount;
await assert.rejects(seerr.firstRun(context), /private first-admin session is invalid/);
assert.equal(loginCount, beforeInvalidSession);

for (const result of [
  { exitCode: 0, stdout: '{"count":1}' },
  { exitCode: 0, stdout: '{"count":2}' },
  { exitCode: 0, stdout: '{"count":"0"}' },
  { exitCode: 0, stdout: '{"count":null}' },
  { exitCode: 0, stdout: '{}' },
  { exitCode: 0, stdout: '{"count":0,"unknown":true}' },
  { exitCode: 0, stdout: 'unknown' },
  { exitCode: 1, stdout: '' },
]) {
  saved = null;
  privateKey = null;
  privateSession = {};
  inventory = result;
  const before = loginCount;
  const peersBefore = peerReads;
  await assert.rejects(seerr.firstRun(context), /first-user inventory|already has users or unknown first-owner state/);
  assert.equal(loginCount, before, "Existing or unknown users cannot be replaced by first-admin authentication");
  assert.equal(peerReads, peersBefore, "Do not release peer credentials before empty-owner proof");
  assert.equal(saved, null);
}

console.log("Seerr first-admin and private API-key setup: pass");
