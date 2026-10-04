import assert from "node:assert/strict";

import sonarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest, SetupInspectionContext } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const projectRoot = "/tmp/sonarr-root-folder-fixture";
const passwordFile = `${projectRoot}/secrets/admin-password`;
const apiKeyFile = `${projectRoot}/secrets/sonarr-api-key`;
const apiKey = "a".repeat(32);
const password = "b".repeat(48);
const chosenPath = "/data/owner-selected/tv";

type RootFolder = { id: number; path: string; accessible: boolean };
type HostConfig = { id: number; authenticationMethod: string; authenticationRequired: string; username: string; password: string };

function reply(status: number, value: unknown, location: string | null = null, cookie: string | null = null) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name: string) {
      if (name === "location") return location;
      if (name === "set-cookie") return cookie;
      return null;
    } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}

function fixture(inputs: Record<string, string> = {}) {
  const state = {
    config: { id: 1, authenticationMethod: "none", authenticationRequired: "disabled", username: "", password: "" } as HostConfig,
    savedKey: null as string | null,
    checkpoint: null as SetupCheckpoint | null,
    roots: [] as RootFolder[],
    authWrites: 0,
    loginPosts: 0,
    rootGets: 0,
    rootPosts: 0,
    createStatus: 201,
    loseCreateResponse: false,
    persistCreatedRoot: true,
  };

  function attempt(request: SetupHttpRequest): void {
    const before = request.beforeSendCheckpoint;
    const approval = request.approval;
    assert.ok(before);
    assert.ok(approval);
    assert.equal(approval.once, true);
    assert.equal(before.expectedRevision, state.checkpoint?.revision ?? null);
    assert.ok(!state.checkpoint?.attemptedActions.includes(approval.action));
    state.checkpoint = { schemaVersion: 1, appId: "sonarr", projectRoot,
      revision: (state.checkpoint?.revision ?? 0) + 1, stage: before.stage,
      attemptedActions: [...(state.checkpoint?.attemptedActions ?? []), approval.action],
      data: before.data ?? {} };
  }

  const context = {
    appId: "sonarr", projectRoot, inputs,
    async status() {
      return { command: "app status", appId: "sonarr", projectRoot, status: "applied",
        mutation: false, runtime: { state: "running" }, passwordFile,
        privateFiles: `${projectRoot}/secrets` };
    },
    http: { async request(request: SetupHttpRequest) {
      if (request.method === "GET" && request.path === "/api/v3/config/host") {
        assert.equal(request.headers?.["X-Api-Key"], apiKey);
        return reply(200, state.config);
      }
      if (request.method === "PUT" && request.path === "/api/v3/config/host/1") {
        assert.equal(request.approval?.action, "sonarr-configure-forms-auth");
        assert.equal(request.beforeSendCheckpoint?.stage, "auth-update-attempted");
        attempt(request);
        const body = JSON.parse(request.body as string) as Record<string, unknown>;
        assert.equal(body.password, password);
        assert.equal(body.passwordConfirmation, password);
        state.config = { id: 1, authenticationMethod: String(body.authenticationMethod),
          authenticationRequired: String(body.authenticationRequired), username: String(body.username), password: "" };
        state.authWrites += 1;
        return reply(202, state.config);
      }
      if (request.method === "GET" && request.path === "/") {
        if (request.headers?.Cookie === "SonarrAuth=owned-session") return reply(200, {});
        return reply(302, {}, "/login?returnUrl=%2F");
      }
      if (request.method === "POST" && request.path === "/login") {
        assert.equal(request.approval?.action, "sonarr-verify-forms-login");
        const body = new URLSearchParams(request.body as string);
        assert.equal(body.get("username"), "admin");
        assert.equal(body.get("password"), password);
        state.loginPosts += 1;
        return reply(302, {}, "/", "SonarrAuth=owned-session; Path=/");
      }
      if (request.method === "GET" && request.path === "/api/v3/rootfolder") {
        assert.equal(request.headers?.["X-Api-Key"], apiKey);
        state.rootGets += 1;
        return reply(200, state.roots);
      }
      if (request.method === "POST" && request.path === "/api/v3/rootfolder") {
        assert.equal(request.headers?.["X-Api-Key"], apiKey);
        assert.equal(request.headers?.["Content-Type"], "application/json");
        assert.equal(request.approval?.action, "sonarr-create-root-folder");
        assert.equal(request.beforeSendCheckpoint?.stage, "root-folder-create-attempted");
        assert.equal(state.checkpoint?.stage, "root-folder-selected");
        assert.ok(state.checkpoint);
        assert.equal(state.checkpoint.data.rootFolderPath, chosenPath);
        assert.ok(state.rootGets >= 1);
        assert.deepEqual(JSON.parse(request.body as string), { path: chosenPath });
        attempt(request);
        state.rootPosts += 1;
        if (state.persistCreatedRoot) state.roots.push({ id: 7, path: chosenPath, accessible: true });
        if (state.loseCreateResponse) throw new Error("Sonarr root-folder response lost");
        return reply(state.createStatus, { id: 7, path: chosenPath, accessible: true });
      }
      throw new Error(`Unexpected ${request.method} ${request.path}`);
    } },
    secrets: {
      async readServiceConfigXmlApiKey() { return apiKey; },
      async readApiKey() { return state.savedKey; },
      async apiKeyPath() { return state.savedKey === null ? null : apiKeyFile; },
      async writeApiKey(value: string) { assert.equal(value, apiKey); state.savedKey = value; return apiKeyFile; },
      async readAdminPassword() { return password; },
    },
    checkpoint: {
      async read() { return state.checkpoint; },
      async compareAndSet(update: { expectedRevision: number | null; stage: string;
        data?: Record<string, string | number | boolean | null> }) {
        assert.equal(update.expectedRevision, state.checkpoint?.revision ?? null);
        state.checkpoint = { schemaVersion: 1, appId: "sonarr", projectRoot,
          revision: (state.checkpoint?.revision ?? 0) + 1, stage: update.stage,
          attemptedActions: state.checkpoint?.attemptedActions ?? [], data: update.data ?? {} };
        return state.checkpoint;
      },
    },
  } as SetupContext;
  return { context, state };
}

assert.deepEqual(sonarr.inputDefinitions?.map((field) => field.key), ["root-folder-path"]);

const formsOnly = fixture();
const legacy = await sonarr.firstRun(formsOnly.context);
assert.equal(sonarr.ready(legacy), true);
assert.deepEqual(sonarr.compatibilityResult!(legacy), { origin: "fresh", credentialReadback: "verified" });
assert.equal(legacy.stage, "forms-login-verified");
assert.equal(formsOnly.state.rootGets, 0);
assert.equal(formsOnly.state.rootPosts, 0);
const inspected = await sonarr.inspect!(formsOnly.context as SetupInspectionContext);
assert.equal(inspected.stage, "forms-login-verified");
assert.equal(sonarr.compatibilityResult!(inspected), null);

for (const badPath of ["/data", "/elsewhere/tv", "/data/tv/", "/data//tv",
  "/data/other/../tv", "/data/tv,other", "/data/tv\nother"]) {
  const invalid = fixture({ "root-folder-path": badPath });
  await assert.rejects(sonarr.firstRun(invalid.context), /exact directory under \/data/);
  assert.equal(invalid.state.checkpoint, null);
  assert.equal(invalid.state.savedKey, null);
  assert.equal(invalid.state.authWrites, 0);
  assert.equal(invalid.state.rootPosts, 0);
}

const created = fixture({ "root-folder-path": chosenPath });
const record = await sonarr.firstRun(created.context);
assert.equal(sonarr.ready(record), true);
assert.equal(record.stage, "forms-login-and-root-folder-verified");
assert.equal(record.rootFolderPath, chosenPath);
assert.equal(created.state.rootPosts, 1);
assert.equal(created.state.rootGets, 2);
assert.equal(created.state.checkpoint?.stage, "root-folder-verified");
assert.equal(created.state.checkpoint?.data.rootFolderPath, chosenPath);
assert.equal((await sonarr.inspect!(created.context as SetupInspectionContext)).rootFolderPath, chosenPath);
created.context.inputs = {};
const resumed = await sonarr.firstRun(created.context);
assert.equal(resumed.rootFolderPath, chosenPath);
assert.deepEqual(sonarr.compatibilityResult!(resumed), { origin: "resume", credentialReadback: "verified" });
assert.equal(created.state.rootPosts, 1);
created.context.inputs = { "root-folder-path": "/data/other/tv" };
await assert.rejects(sonarr.firstRun(created.context), /differs from this project's saved selection/);
assert.equal(created.state.rootPosts, 1);
created.context.inputs = {};
created.state.roots = [];
await assert.rejects(sonarr.inspect!(created.context as SetupInspectionContext), /saved root folder is absent/);
await assert.rejects(sonarr.firstRun(created.context), /saved root folder is absent/);
assert.equal(created.state.rootPosts, 1);

const existing = fixture({ "root-folder-path": chosenPath });
existing.state.roots.push({ id: 9, path: chosenPath, accessible: true });
assert.equal((await sonarr.firstRun(existing.context)).rootFolderPath, chosenPath);
assert.equal(existing.state.rootPosts, 0);
assert.equal(existing.state.checkpoint?.stage, "root-folder-verified");

const different = fixture({ "root-folder-path": chosenPath });
different.state.roots.push({ id: 9, path: "/data/other/tv", accessible: true });
assert.equal((await sonarr.firstRun(different.context)).rootFolderPath, chosenPath);
assert.equal(different.state.rootPosts, 1);

const inaccessible = fixture({ "root-folder-path": chosenPath });
inaccessible.state.roots.push({ id: 9, path: chosenPath, accessible: false });
await assert.rejects(sonarr.firstRun(inaccessible.context), /not accessible/);
assert.equal(inaccessible.state.rootPosts, 0);

const lost = fixture({ "root-folder-path": chosenPath });
lost.state.loseCreateResponse = true;
await assert.rejects(sonarr.firstRun(lost.context), /response lost/);
assert.equal(lost.state.checkpoint?.stage, "root-folder-create-attempted");
assert.equal(lost.state.rootPosts, 1);
lost.context.inputs = {};
assert.equal((await sonarr.firstRun(lost.context)).rootFolderPath, chosenPath);
assert.equal(lost.state.rootPosts, 1);
assert.equal(lost.state.checkpoint?.stage, "root-folder-verified");

const absent = fixture({ "root-folder-path": chosenPath });
absent.state.loseCreateResponse = true;
absent.state.persistCreatedRoot = false;
await assert.rejects(sonarr.firstRun(absent.context), /response lost/);
await assert.rejects(sonarr.firstRun(absent.context), /attempted but the path is absent/);
assert.equal(absent.state.rootPosts, 1);

for (const status of [200, 202]) {
  const wrongStatus = fixture({ "root-folder-path": chosenPath });
  wrongStatus.state.createStatus = status;
  wrongStatus.state.persistCreatedRoot = false;
  await assert.rejects(sonarr.firstRun(wrongStatus.context), /create was not confirmed/);
  assert.equal(wrongStatus.state.checkpoint?.stage, "root-folder-create-attempted");
  assert.equal(wrongStatus.state.rootPosts, 1);
}

const noReadback = fixture({ "root-folder-path": chosenPath });
noReadback.state.persistCreatedRoot = false;
await assert.rejects(sonarr.firstRun(noReadback.context), /exact-path readback/);
assert.equal(noReadback.state.checkpoint?.stage, "root-folder-create-attempted");
assert.equal(noReadback.state.rootPosts, 1);

console.log("Sonarr root-folder first-run setup: pass");
