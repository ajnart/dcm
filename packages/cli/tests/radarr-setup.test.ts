import assert from "node:assert/strict";

import radarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/radarr/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest,
  SetupInspectionContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const root = "/tmp/radarr-setup-fixture";
const passwordFile = `${root}/secrets/admin-password`;
const apiKeyFile = `${root}/secrets/radarr-api-key`;
const apiKey = "a".repeat(32);
const password = "fixture-generated-password-123456789";
const selectedPath = "/data/library/movies";

type Folder = { id: number; path: string; accessible: boolean };
type RootFailure = "before-create" | "after-create" | "missing-readback" | null;

function reply(status: number, value: unknown = null, location: string | null = null, cookie: string | null = null) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name: string) {
      if (name === "location") return location;
      if (name === "set-cookie") return cookie;
      return null;
    } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}

function fixture() {
  let inputs: Record<string, string> = {};
  let checkpoint: SetupCheckpoint | null = null;
  let savedKey: string | null = null;
  let hostConfig = { id: 1, authenticationMethod: "none",
    authenticationRequired: "disabled", username: "", password: "" };
  let rootFailure: RootFailure = null;
  let deferRootApproval = false;
  let rootStatus = 201;
  let folders: Folder[] = [];
  let rootPosts = 0;
  let authPuts = 0;
  const calls: string[] = [];

  const context = {
    appId: "radarr", projectRoot: root,
    get inputs() { return inputs; },
    async status() {
      return { command: "app status", appId: "radarr", projectRoot: root,
        status: "applied", mutation: false, runtime: { state: "running" },
        passwordFile, privateFiles: `${root}/secrets` };
    },
    http: { async request(request: SetupHttpRequest) {
      calls.push(`${request.method} ${request.path}`);
      if (request.method === "GET" && request.path === "/api/v3/config/host") {
        assert.equal(request.headers?.["X-Api-Key"], apiKey);
        return reply(200, { ...hostConfig });
      }
      if (request.method === "PUT" && request.path === "/api/v3/config/host/1") {
        assert.equal(request.approval?.action, "radarr-configure-forms-auth");
        assert.equal(request.approval?.once, true);
        assert.equal(request.beforeSendCheckpoint?.stage, "auth-update-attempted");
        assert.deepEqual(JSON.parse(request.body as string), {
          id: 1, authenticationMethod: "forms", authenticationRequired: "enabled",
          username: "admin", password, passwordConfirmation: password,
        });
        beforeSend(request);
        hostConfig = { id: 1, authenticationMethod: "forms",
          authenticationRequired: "enabled", username: "admin", password: "" };
        authPuts++;
        return reply(202);
      }
      if (request.method === "GET" && request.path === "/") {
        if (request.headers?.Cookie === "RadarrAuth=owned-session") return reply(200);
        return reply(302, null, "/login?returnUrl=%2F");
      }
      if (request.method === "POST" && request.path === "/login") {
        assert.equal(request.approval?.action, "radarr-verify-forms-login");
        assert.equal(request.body, new URLSearchParams({ username: "admin", password }).toString());
        return reply(302, null, "/", "RadarrAuth=owned-session; Path=/");
      }
      if (request.method === "GET" && request.path === "/api/v3/rootfolder") {
        assert.equal(request.headers?.["X-Api-Key"], apiKey);
        return reply(200, folders.map((folder) => ({ ...folder })));
      }
      if (request.method === "POST" && request.path === "/api/v3/rootfolder") {
        assert.equal(request.headers?.["X-Api-Key"], apiKey);
        assert.equal(request.headers?.["Content-Type"], "application/json");
        assert.equal(request.approval?.action, "radarr-create-root-folder");
        assert.equal(request.approval?.once, true);
        assert.equal(checkpoint?.stage, "root-folder-selected");
        assert.equal(checkpoint.data.rootFolderPath, selectedPath);
        assert.equal(request.beforeSendCheckpoint?.stage, "root-folder-create-attempted");
        assert.deepEqual(JSON.parse(request.body as string), { path: selectedPath });
        if (deferRootApproval) throw new Error("root-folder approval deferred before send");
        beforeSend(request);
        rootPosts++;
        if (rootFailure === "before-create") throw new Error("root response lost before create");
        if (rootFailure !== "missing-readback") {
          folders.push({ id: folders.length + 1, path: selectedPath, accessible: true });
        }
        if (rootFailure === "after-create") throw new Error("root response lost after create");
        return reply(rootStatus, { id: 1, path: selectedPath, accessible: true });
      }
      throw new Error(`Unexpected ${request.method} ${request.path}`);
    } },
    secrets: {
      async readServiceConfigXmlApiKey() { return apiKey; },
      async readApiKey() { return savedKey; },
      async apiKeyPath() { return savedKey === null ? null : apiKeyFile; },
      async writeApiKey(value: string) { assert.equal(value, apiKey); savedKey = value; return apiKeyFile; },
      async readAdminPassword() { return password; },
    },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(update: { expectedRevision: number | null; stage: string;
        data?: Record<string, string | number | boolean | null> }) {
        assert.equal(checkpoint?.revision ?? null, update.expectedRevision);
        checkpoint = { schemaVersion: 1, appId: "radarr", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
          attemptedActions: checkpoint?.attemptedActions ?? [], data: update.data ?? {} };
        return checkpoint;
      },
    },
  } as unknown as SetupContext;

  function beforeSend(request: SetupHttpRequest): void {
    const update = request.beforeSendCheckpoint;
    assert.ok(update);
    assert.equal(checkpoint?.revision ?? null, update.expectedRevision);
    assert.ok(!checkpoint?.attemptedActions.includes(request.approval!.action));
    checkpoint = { schemaVersion: 1, appId: "radarr", projectRoot: root,
      revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
      attemptedActions: [...(checkpoint?.attemptedActions ?? []), request.approval!.action],
      data: update.data ?? {} };
  }

  return {
    context,
    get checkpoint() { return checkpoint; },
    get savedKey() { return savedKey; },
    get folders() { return folders; },
    set folders(value: Folder[]) { folders = value; },
    get rootPosts() { return rootPosts; },
    get authPuts() { return authPuts; },
    calls,
    set inputs(value: Record<string, string>) { inputs = value; },
    set rootFailure(value: RootFailure) { rootFailure = value; },
    set deferRootApproval(value: boolean) { deferRootApproval = value; },
    set rootStatus(value: number) { rootStatus = value; },
  };
}

assert.deepEqual(radarr.inputDefinitions?.map((field) => field.key), ["root-folder-path"]);

const authOnly = fixture();
const authRecord = await radarr.firstRun(authOnly.context);
assert.equal(radarr.ready(authRecord), true);
assert.deepEqual(radarr.compatibilityResult!(authRecord), { origin: "fresh", credentialReadback: "verified" });
assert.equal(authRecord.stage, "forms-login-verified");
assert.equal(authOnly.checkpoint?.stage, "forms-login-verified");
assert.equal(authOnly.authPuts, 1);
assert.equal(authOnly.rootPosts, 0);
assert.ok(!authOnly.calls.includes("GET /api/v3/rootfolder"));
const inspected = await radarr.inspect!(authOnly.context as SetupInspectionContext);
assert.equal(inspected.stage, "forms-login-verified");
assert.equal(radarr.compatibilityResult!(inspected), null);
const resumed = await radarr.firstRun(authOnly.context);
assert.deepEqual(radarr.compatibilityResult!(resumed), { origin: "resume", credentialReadback: "verified" });
assert.equal(authOnly.authPuts, 1);

for (const badPath of ["/data", "/other/movies", "/data/../movies", "/data//movies",
  "/data/movies/", "/data/movies\n"] ) {
  const invalid = fixture();
  invalid.inputs = { "root-folder-path": badPath };
  await assert.rejects(radarr.firstRun(invalid.context), /exact directory under \/data/);
  assert.equal(invalid.checkpoint, null);
  assert.equal(invalid.savedKey, null);
  assert.deepEqual(invalid.calls, []);
}

const normal = fixture();
normal.inputs = { "root-folder-path": selectedPath };
const configured = await radarr.firstRun(normal.context);
assert.equal(radarr.ready(configured), true);
assert.equal(configured.stage, "forms-login-and-root-folder-verified");
assert.equal(configured.rootFolderPath, selectedPath);
assert.equal(normal.checkpoint?.stage, "root-folder-verified");
assert.equal(normal.checkpoint?.data.rootFolderPath, selectedPath);
assert.equal(normal.rootPosts, 1);
assert.equal(normal.calls.filter((call) => call === "GET /api/v3/rootfolder").length, 2);
const beforeInspect = normal.calls.length;
assert.equal((await radarr.inspect!(normal.context as SetupInspectionContext)).rootFolderPath, selectedPath);
assert.ok(normal.calls.slice(beforeInspect).every((call) => call.startsWith("GET ")));
normal.inputs = {};
assert.equal((await radarr.firstRun(normal.context)).rootFolderPath, selectedPath);
assert.equal(normal.rootPosts, 1);
normal.inputs = { "root-folder-path": "/data/other/movies" };
const beforeChanged = normal.calls.length;
await assert.rejects(radarr.firstRun(normal.context), /differs from this project's saved selection/);
assert.equal(normal.calls.length, beforeChanged);
normal.folders = [];
await assert.rejects(radarr.inspect!(normal.context as SetupInspectionContext), /saved root folder is absent/);

const existing = fixture();
existing.inputs = { "root-folder-path": selectedPath };
existing.folders = [{ id: 8, path: selectedPath, accessible: true }];
assert.equal((await radarr.firstRun(existing.context)).rootFolderPath, selectedPath);
assert.equal(existing.rootPosts, 0);
assert.equal(existing.checkpoint?.stage, "root-folder-verified");

const deferred = fixture();
deferred.inputs = { "root-folder-path": selectedPath };
deferred.deferRootApproval = true;
await assert.rejects(radarr.firstRun(deferred.context), /approval deferred before send/);
assert.equal(deferred.checkpoint?.stage, "root-folder-selected");
assert.equal(deferred.checkpoint?.data.rootFolderPath, selectedPath);
assert.equal(deferred.rootPosts, 0);
deferred.deferRootApproval = false;
deferred.inputs = {};
assert.equal((await radarr.firstRun(deferred.context)).rootFolderPath, selectedPath);
assert.equal(deferred.rootPosts, 1);

const inaccessible = fixture();
inaccessible.inputs = { "root-folder-path": selectedPath };
inaccessible.folders = [{ id: 8, path: selectedPath, accessible: false }];
await assert.rejects(radarr.firstRun(inaccessible.context), /not accessible inside \/data/);
assert.equal(inaccessible.rootPosts, 0);

const lostAfterCreate = fixture();
lostAfterCreate.inputs = { "root-folder-path": selectedPath };
lostAfterCreate.rootFailure = "after-create";
await assert.rejects(radarr.firstRun(lostAfterCreate.context), /root response lost after create/);
assert.equal(lostAfterCreate.checkpoint?.stage, "root-folder-create-attempted");
assert.equal(lostAfterCreate.checkpoint?.data.rootFolderPath, selectedPath);
lostAfterCreate.rootFailure = null;
lostAfterCreate.inputs = {};
assert.equal((await radarr.firstRun(lostAfterCreate.context)).rootFolderPath, selectedPath);
assert.equal(lostAfterCreate.rootPosts, 1);

const lostBeforeCreate = fixture();
lostBeforeCreate.inputs = { "root-folder-path": selectedPath };
lostBeforeCreate.rootFailure = "before-create";
await assert.rejects(radarr.firstRun(lostBeforeCreate.context), /root response lost before create/);
lostBeforeCreate.rootFailure = null;
lostBeforeCreate.inputs = {};
await assert.rejects(radarr.firstRun(lostBeforeCreate.context), /never replay it/);
assert.equal(lostBeforeCreate.rootPosts, 1);
await assert.rejects(radarr.inspect!(lostBeforeCreate.context as SetupInspectionContext),
  /no completed checkpoint/);

const wrongStatus = fixture();
wrongStatus.inputs = { "root-folder-path": selectedPath };
wrongStatus.rootStatus = 200;
await assert.rejects(radarr.firstRun(wrongStatus.context), /did not return 201/);
assert.equal(wrongStatus.rootPosts, 1);

const missingReadback = fixture();
missingReadback.inputs = { "root-folder-path": selectedPath };
missingReadback.rootFailure = "missing-readback";
await assert.rejects(radarr.firstRun(missingReadback.context), /no exact path readback/);
missingReadback.rootFailure = null;
await assert.rejects(radarr.firstRun(missingReadback.context), /never replay it/);
assert.equal(missingReadback.rootPosts, 1);

console.log("Radarr root-folder first-run setup: pass");
