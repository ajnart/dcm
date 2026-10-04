import assert from "node:assert/strict";

import jellyfin from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest,
  SetupInspectionContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const root = "/tmp/jellyfin-setup-fixture";
const keyPath = `${root}/secrets/jellyfin-api-key`;
const password = "fixture-generated-password-123456789";
const session = "fixture-session-token-123456789";
const apiKey = "fixture-persistent-api-key-123456789";
const serverId = "fixture-jellyfin-server";
let checkpoint: SetupCheckpoint | null = null;
let storedKey: string | null = null;
let sessionCookies: Record<string, string> = {};
let loginStatus = 200;
let freshOwnerStatus = 200;
let wrongFreshOwner = false;
let loginCount = 0;
const issuedSessions = new Set<string>();
let initialized = false;
let admin = false;
let adminId = "a".repeat(32);
let adminEnabled = true;
let unownedAccount = false;
let hiddenUnownedAccount = false;
let failAdminAfterSend = false;
let failCompleteAfterSend = false;
let complete = false;
let created: string | null = null;
let failCreateAfterSend = false;
let failLibraryAfterSend: "Movies" | "Shows" | null = null;
let failLibraryBeforeCreate: "Movies" | "Shows" | null = null;
let deferLibraryApproval = false;
let deferKeyApproval = false;
const deferredKeyRequests: string[] = [];
let ownerKind: "standalone" | "shared" = "standalone";
let inputs: Record<string, string> = {};
let libraries: { Name: string; CollectionType: string; Locations: string[] }[] = [];
const calls: string[] = [];

function reply(status: number, value: unknown = null) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}

function checkApproval(request: SetupHttpRequest): void {
  if (request.method === "GET" && request.path === "/Startup/User") {
    assert.equal(request.approval?.once, true);
    assert.equal(request.beforeSendCheckpoint?.stage, "user-init-attempted");
  }
  if (request.method === "POST" && ["/Startup/User", "/Startup/Complete", "/Auth/Keys"].includes(request.path)) {
    assert.equal(request.approval?.once, true);
    assert.ok(request.beforeSendCheckpoint);
  }
  if (request.method === "POST" && request.path === "/Library/VirtualFolders") {
    assert.equal(request.approval?.once, true);
    assert.equal(request.beforeSendCheckpoint?.stage,
      request.query?.name === "Movies" ? "movies-create-attempted" : "shows-create-attempted");
  }
  if (request.method === "POST" && request.path === "/Users/AuthenticateByName") {
    assert.ok(request.approval);
    assert.match(request.headers?.Authorization ?? "", /^MediaBrowser Client=/);
  }
}

const context = {
  appId: "jellyfin", projectRoot: root,
  get inputs() { return inputs; },
  async status() {
    return { command: "app status", appId: "jellyfin", projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" },
      privateFiles: `${root}/secrets`, ownerKind };
  },
  http: { async request(request: SetupHttpRequest) {
    calls.push(`${request.method} ${request.path}`);
    checkApproval(request);
    if (deferKeyApproval && request.method === "POST" && request.path === "/Auth/Keys") {
      deferredKeyRequests.push(JSON.stringify(request));
      throw new Error("key approval deferred before send");
    }
    if (deferLibraryApproval && request.method === "POST"
      && request.path === "/Library/VirtualFolders") {
      throw new Error("library approval deferred before send");
    }
    if (request.beforeSendCheckpoint) {
      assert.equal(checkpoint?.revision ?? null, request.beforeSendCheckpoint.expectedRevision);
      assert.ok(!checkpoint?.attemptedActions.includes(request.approval!.action));
      checkpoint = { schemaVersion: 1, appId: "jellyfin", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: request.beforeSendCheckpoint.stage,
        attemptedActions: [...(checkpoint?.attemptedActions ?? []), request.approval!.action],
        data: request.beforeSendCheckpoint.data ?? {} };
    }
    if (request.method === "GET" && request.path === "/System/Info/Public") {
      return reply(200, { Id: serverId, Version: "12.1.20260915", StartupWizardCompleted: complete });
    }
    if (request.method === "GET" && request.path === "/Startup/User") {
      initialized = true;
      return reply(200, { Name: "Jellyfin" });
    }
    if (request.method === "GET" && ["/Users/Public", "/Users"].includes(request.path)) {
      if (hiddenUnownedAccount) return reply(200, []);
      if (unownedAccount) {
        return reply(200, [{ Id: "b".repeat(32), Name: "existing", HasPassword: false }]);
      }
      if (!initialized) return reply(200, []);
      return reply(200, [{ Id: adminId, Name: admin ? "admin" : "Jellyfin", HasPassword: admin,
        Policy: { IsAdministrator: true, IsDisabled: !adminEnabled } }]);
    }
    if (request.method === "POST" && request.path === "/Startup/User") {
      assert.equal(initialized, true);
      assert.deepEqual(JSON.parse(request.body as string), { Name: "admin", Password: password });
      admin = true;
      if (failAdminAfterSend) throw new Error("uncertain admin delivery");
      return reply(204);
    }
    if (request.method === "POST" && request.path === "/Users/AuthenticateByName") {
      assert.equal(admin, true);
      assert.deepEqual(JSON.parse(request.body as string), { Username: "admin", Pw: password });
      let accessToken = session;
      if (sessionCookies.bearer) accessToken = `${session}-fresh-${++loginCount}`;
      issuedSessions.add(accessToken);
      let id = adminId;
      if (wrongFreshOwner) id = "b".repeat(32);
      return reply(loginStatus, { AccessToken: accessToken, User: { Id: id, Name: "admin",
        Policy: { IsAdministrator: true, IsDisabled: !adminEnabled } } });
    }
    if (request.method === "GET" && request.path === "/Users/Me") {
      assert.equal(admin, true);
      const supplied = (request.headers?.Authorization ?? "").match(/Token="([^"]+)"/)?.[1];
      assert.ok(issuedSessions.has(supplied!));
      let status = 200;
      if (supplied !== sessionCookies.bearer) status = freshOwnerStatus;
      return reply(status, { Id: adminId, Name: "admin", Policy: { IsAdministrator: true, IsDisabled: !adminEnabled } });
    }
    if (request.method === "POST" && request.path === "/Startup/Complete") {
      complete = true;
      if (failCompleteAfterSend) throw new Error("uncertain completion delivery");
      return reply(204);
    }
    if (request.method === "GET" && request.path === "/Auth/Keys") {
      assert.match(request.headers?.Authorization ?? "", /Token="fixture-(session-token|persistent-api-key)/);
      const items = created === null ? [] : [{ AppName: requestLabel(), AccessToken: created, IsActive: true }];
      return reply(200, { Items: items, TotalRecordCount: items.length });
    }
    if (request.method === "POST" && request.path === "/Auth/Keys") {
      assert.deepEqual(request.query, { app: requestLabel() });
      created = apiKey;
      if (failCreateAfterSend) throw new Error("uncertain network delivery");
      return reply(204);
    }
    if (request.method === "GET" && request.path === "/System/Info") {
      assert.match(request.headers?.Authorization ?? "", /Token="fixture-persistent-api-key/);
      return reply(200, { Id: serverId, Version: "12.1.20260915" });
    }
    if (request.method === "GET" && request.path === "/Library/VirtualFolders") {
      assert.match(request.headers?.Authorization ?? "", /Token="fixture-(session-token|persistent-api-key)/);
      return reply(200, libraries.map((library) => ({ ...library, Locations: [...library.Locations] })));
    }
    if (request.method === "POST" && request.path === "/Library/VirtualFolders") {
      assert.match(request.headers?.Authorization ?? "", /Token="fixture-persistent-api-key/);
      assert.equal(ownerKind, "shared");
      const name = request.query?.name;
      assert.ok(name === "Movies" || name === "Shows");
      assert.deepEqual(request.query, { name, collectionType: name === "Movies" ? "movies" : "tvshows",
        paths: inputs[`${name === "Movies" ? "movies" : "shows"}-path`]
          ?? checkpoint?.data[name === "Movies" ? "moviesPath" : "showsPath"],
        refreshLibrary: "false" });
      if (failLibraryBeforeCreate === name) throw new Error("uncertain library network delivery");
      const selectedPath = request.query?.paths;
      assert.ok(typeof selectedPath === "string");
      libraries.push({ Name: name, CollectionType: name === "Movies" ? "movies" : "tvshows",
        Locations: [selectedPath] });
      if (failLibraryAfterSend === name) throw new Error("uncertain library network delivery");
      return reply(204);
    }
    throw new Error(`Unexpected ${request.method} ${request.path}`);
  } },
  secrets: {
    async readSessionCookies() { return { ...sessionCookies }; },
    async writeSessionCookies(value: Record<string, string>) { sessionCookies = { ...value }; },
    async readAdminPassword() { return password; },
    async readApiKey() { return storedKey; },
    async apiKeyPath() { return storedKey === null ? null : keyPath; },
    async writeApiKey(value: string) {
      assert.equal(storedKey, null);
      storedKey = value;
      return keyPath;
    },
  },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(update: { expectedRevision: number | null; stage: string;
      data?: Record<string, string | number | boolean | null> }) {
      assert.equal(checkpoint?.revision ?? null, update.expectedRevision);
      checkpoint = { schemaVersion: 1, appId: "jellyfin", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
        attemptedActions: checkpoint?.attemptedActions ?? [], data: update.data ?? {} };
      return checkpoint;
    },
  },
} as unknown as SetupContext;

function requestLabel(): string {
  // The fixture intentionally checks the exact label used by create and inventory.
  return checkpoint?.data.keyLabel as string;
}

const first = await jellyfin.firstRun(context);
const expectedLabel = first.keyLabel as string;
assert.equal(jellyfin.ready(first), true);
assert.equal(first.apiKeyFile, keyPath);
assert.equal(first.mediaLibrary, "not-configured-owner-path-required");
assert.equal(checkpoint?.stage, "key-saved");
assert.equal(checkpoint?.attemptedActions.length, 4);
const beforeInspect = calls.length;
assert.equal((await jellyfin.inspect(context as unknown as SetupInspectionContext)).apiKeyFile, keyPath);
assert.ok(calls.slice(beforeInspect).every((call) => call.startsWith("GET ")));
assert.equal(calls.filter((call) => call === "POST /Auth/Keys").length, 1);
const replay = await jellyfin.firstRun(context);
assert.equal(jellyfin.ready(replay), true);
assert.equal(calls.filter((call) => call === "POST /Auth/Keys").length, 1);

checkpoint = null;
storedKey = null;
initialized = false;
admin = false;
complete = false;
created = null;
failCreateAfterSend = true;
await assert.rejects(jellyfin.firstRun(context), /uncertain network delivery/);
assert.equal(checkpoint?.stage, "key-create-attempted");
failCreateAfterSend = false;
const recovered = await jellyfin.firstRun(context);
assert.equal(jellyfin.ready(recovered), true);
assert.equal(calls.filter((call) => call === "POST /Auth/Keys").length, 2);

checkpoint = { schemaVersion: 1, appId: "jellyfin", projectRoot: root, revision: 6,
  stage: "wizard-complete", attemptedActions: ["jellyfin-initialize-first-user",
    "jellyfin-set-first-admin", "jellyfin-complete-startup"],
  data: { serverId, keyLabel: expectedLabel, adminUserId: "a".repeat(32) } };
storedKey = null;
created = apiKey;
const createsBeforeExistingKey = calls.filter((call) => call === "POST /Auth/Keys").length;
await assert.rejects(jellyfin.firstRun(context), /never rotate or adopt/);
assert.equal(calls.filter((call) => call === "POST /Auth/Keys").length, createsBeforeExistingKey);

checkpoint = null;
storedKey = null;
initialized = false;
admin = false;
complete = false;
created = null;
checkpoint = { schemaVersion: 1, appId: "jellyfin", projectRoot: root, revision: 1,
  stage: "user-init-attempted", attemptedActions: ["jellyfin-initialize-first-user"],
  data: { serverId, keyLabel: expectedLabel } };
const before = calls.length;
await assert.rejects(jellyfin.firstRun(context), /never replay it/);
assert.equal(calls.filter((call) => call === "GET /Startup/User").length, 2);
assert.equal(calls.length, before + 1);

function reset(): void {
  checkpoint = null;
  storedKey = null;
  sessionCookies = {};
  loginStatus = 200;
  freshOwnerStatus = 200;
  wrongFreshOwner = false;
  loginCount = 0;
  issuedSessions.clear();
  initialized = false;
  admin = false;
  adminId = "a".repeat(32);
  adminEnabled = true;
  unownedAccount = false;
  hiddenUnownedAccount = false;
  failAdminAfterSend = false;
  failCompleteAfterSend = false;
  complete = false;
  created = null;
  failCreateAfterSend = false;
  failLibraryAfterSend = null;
  failLibraryBeforeCreate = null;
  deferLibraryApproval = false;
  deferKeyApproval = false;
  deferredKeyRequests.length = 0;
  ownerKind = "standalone";
  inputs = {};
  libraries = [];
  calls.length = 0;
}

reset();
unownedAccount = true;
await assert.rejects(jellyfin.firstRun(context), /unowned account/);
assert.equal(checkpoint, null);
assert.ok(!calls.includes("GET /Startup/User"));
assert.ok(calls.every((call) => call.startsWith("GET ")));

reset();
hiddenUnownedAccount = true;
await assert.rejects(jellyfin.firstRun(context), /no exact passwordless account readback/);
assert.equal(checkpoint?.stage, "user-init-attempted");
assert.ok(!calls.includes("POST /Startup/User"));
await assert.rejects(jellyfin.firstRun(context), /never replay it/);
assert.equal(calls.filter((call) => call === "GET /Startup/User").length, 1);

reset();
assert.equal(jellyfin.ready(await jellyfin.firstRun(context)), true);
assert.equal(checkpoint?.data.adminUserId, "a".repeat(32));
adminId = "b".repeat(32);
sessionCookies = {};
const keyCreatesBeforeReplacement = calls.filter((call) => call === "POST /Auth/Keys").length;
await assert.rejects(jellyfin.firstRun(context), /exact saved enabled administrator/);
assert.deepEqual(sessionCookies, {});
await assert.rejects(jellyfin.inspect(context as unknown as SetupInspectionContext), /administrator is missing/);
assert.equal(calls.filter((call) => call === "POST /Auth/Keys").length, keyCreatesBeforeReplacement);

reset();
await jellyfin.firstRun(context);
adminEnabled = false;
await assert.rejects(jellyfin.firstRun(context), /exact saved enabled administrator/);
await assert.rejects(jellyfin.inspect(context as unknown as SetupInspectionContext), /exact saved enabled administrator/);

reset();
await jellyfin.firstRun(context);
created = null;
const keyCreatesBeforeMissing = calls.filter((call) => call === "POST /Auth/Keys").length;
await assert.rejects(jellyfin.firstRun(context), /exactly one matching saved API key/);
await assert.rejects(jellyfin.inspect(context as unknown as SetupInspectionContext), /exactly one matching saved API key/);
assert.equal(calls.filter((call) => call === "POST /Auth/Keys").length, keyCreatesBeforeMissing);

reset();
failAdminAfterSend = true;
await assert.rejects(jellyfin.firstRun(context), /uncertain admin delivery/);
assert.equal(checkpoint?.stage, "admin-set-attempted");
failAdminAfterSend = false;
assert.equal(jellyfin.ready(await jellyfin.firstRun(context)), true);
assert.equal(calls.filter((call) => call === "POST /Startup/User").length, 1);

reset();
failCompleteAfterSend = true;
await assert.rejects(jellyfin.firstRun(context), /uncertain completion delivery/);
assert.equal(checkpoint?.stage, "wizard-complete-attempted");
failCompleteAfterSend = false;
assert.equal(jellyfin.ready(await jellyfin.firstRun(context)), true);
assert.equal(calls.filter((call) => call === "POST /Startup/Complete").length, 1);

reset();
deferKeyApproval = true;
await assert.rejects(jellyfin.firstRun(context), /key approval deferred/);
await assert.rejects(jellyfin.firstRun(context), /key approval deferred/);
assert.equal(deferredKeyRequests.length, 2);
assert.equal(deferredKeyRequests[0], deferredKeyRequests[1]);
assert.equal(calls.filter((call) => call === "POST /Users/AuthenticateByName").length, 2);
deferKeyApproval = false;
assert.equal(jellyfin.ready(await jellyfin.firstRun(context)), true);

reset();
await jellyfin.firstRun(context);
const retainedSession = { ...sessionCookies };
loginStatus = 401;
await assert.rejects(jellyfin.firstRun(context), /login could not be verified/);
assert.deepEqual(sessionCookies, retainedSession);
loginStatus = 200;
wrongFreshOwner = true;
await assert.rejects(jellyfin.firstRun(context), /exact saved enabled administrator/);
assert.deepEqual(sessionCookies, retainedSession);
wrongFreshOwner = false;
freshOwnerStatus = 401;
await assert.rejects(jellyfin.firstRun(context), /session expired/);
assert.deepEqual(sessionCookies, retainedSession);
freshOwnerStatus = 200;
assert.equal(jellyfin.ready(await jellyfin.firstRun(context)), true);
assert.deepEqual(sessionCookies, retainedSession);

const selected = { "movies-path": "/data/media/movies", "shows-path": "/data/media/tv" };
assert.deepEqual(jellyfin.inputDefinitions?.map((field) => field.key), ["movies-path", "shows-path"]);

reset();
inputs = { "movies-path": selected["movies-path"] };
await assert.rejects(jellyfin.firstRun(context), /requires both movies-path and shows-path/);
assert.ok(calls.every((call) => call.startsWith("GET ")));
assert.equal(checkpoint, null);

reset();
ownerKind = "shared";
inputs = { ...selected, "shows-path": "/data/media/../tv" };
await assert.rejects(jellyfin.firstRun(context), /exact directories under \/data/);
assert.ok(calls.every((call) => call.startsWith("GET ")));

for (const badPath of ["/data/media,movies", "/data/media/\nmovies", "/elsewhere/movies",
  "/data//movies", "/data/media/"]) {
  reset();
  ownerKind = "shared";
  inputs = { ...selected, "movies-path": badPath };
  await assert.rejects(jellyfin.firstRun(context), /exact directories under \/data/);
  assert.ok(calls.every((call) => call.startsWith("GET ")));
}

reset();
ownerKind = "shared";
inputs = { "movies-path": selected["movies-path"], "shows-path": selected["movies-path"] };
await assert.rejects(jellyfin.firstRun(context), /paths must be distinct/);
assert.ok(calls.every((call) => call.startsWith("GET ")));

reset();
inputs = { ...selected };
await assert.rejects(jellyfin.firstRun(context), /requires the exact shared app owner/);
assert.ok(calls.every((call) => call.startsWith("GET ")));

reset();
ownerKind = "shared";
inputs = { ...selected };
deferLibraryApproval = true;
await assert.rejects(jellyfin.firstRun(context), /approval deferred before send/);
assert.equal(checkpoint?.stage, "key-saved");
assert.ok(!checkpoint?.attemptedActions.includes("jellyfin-create-movies-library"));
assert.deepEqual(libraries, []);
deferLibraryApproval = false;
inputs = {};
assert.equal((await jellyfin.firstRun(context)).mediaLibrary, "movies-and-shows-verified");
assert.equal(libraries.length, 2);

reset();
ownerKind = "shared";
inputs = { ...selected };
const configured = await jellyfin.firstRun(context);
assert.equal(jellyfin.ready(configured), true);
assert.equal(configured.stage, "admin-api-key-and-libraries-verified");
assert.equal(configured.mediaLibrary, "movies-and-shows-verified");
assert.equal(configured.moviesPath, selected["movies-path"]);
assert.equal(configured.showsPath, selected["shows-path"]);
assert.equal(checkpoint?.stage, "libraries-verified");
assert.equal(checkpoint?.data.moviesPath, selected["movies-path"]);
assert.equal(checkpoint?.data.showsPath, selected["shows-path"]);
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, 2);
const beforeLibraryInspect = calls.length;
assert.equal((await jellyfin.inspect(context as unknown as SetupInspectionContext)).mediaLibrary,
  "movies-and-shows-verified");
assert.ok(calls.slice(beforeLibraryInspect).every((call) => call.startsWith("GET ")));
inputs = {};
assert.equal((await jellyfin.firstRun(context)).mediaLibrary, "movies-and-shows-verified");
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, 2);
inputs = { ...selected, "movies-path": "/data/other/movies" };
const beforeChanged = calls.filter((call) => call.startsWith("POST ")).length;
await assert.rejects(jellyfin.firstRun(context), /differ from this project's saved selection/);
assert.equal(calls.filter((call) => call.startsWith("POST ")).length, beforeChanged);
libraries[0]!.Locations.push("/data/other");
await assert.rejects(jellyfin.inspect(context as unknown as SetupInspectionContext), /differs from the saved path/);

reset();
ownerKind = "shared";
inputs = { ...selected };
failLibraryAfterSend = "Movies";
await assert.rejects(jellyfin.firstRun(context), /uncertain library network delivery/);
assert.equal(checkpoint?.stage, "movies-create-attempted");
assert.equal(checkpoint?.data.moviesPath, selected["movies-path"]);
assert.equal(libraries.length, 1);
failLibraryAfterSend = null;
inputs = {};
const recoveredMovies = await jellyfin.firstRun(context);
assert.equal(recoveredMovies.mediaLibrary, "movies-and-shows-verified");
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, 2);
assert.deepEqual(libraries.map((library) => library.Name), ["Movies", "Shows"]);

reset();
ownerKind = "shared";
inputs = { ...selected };
failLibraryAfterSend = "Shows";
await assert.rejects(jellyfin.firstRun(context), /uncertain library network delivery/);
assert.equal(checkpoint?.stage, "shows-create-attempted");
assert.equal(libraries.length, 2);
failLibraryAfterSend = null;
inputs = {};
assert.equal((await jellyfin.firstRun(context)).mediaLibrary, "movies-and-shows-verified");
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, 2);

reset();
ownerKind = "shared";
inputs = { ...selected };
failLibraryBeforeCreate = "Movies";
await assert.rejects(jellyfin.firstRun(context), /uncertain library network delivery/);
assert.equal(checkpoint?.stage, "movies-create-attempted");
assert.equal(libraries.length, 0);
inputs = {};
const beforeMissing = calls.filter((call) => call === "POST /Library/VirtualFolders").length;
await assert.rejects(jellyfin.firstRun(context), /never replay it/);
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, beforeMissing);

reset();
ownerKind = "shared";
inputs = { ...selected };
failLibraryBeforeCreate = "Shows";
await assert.rejects(jellyfin.firstRun(context), /uncertain library network delivery/);
assert.equal(checkpoint?.stage, "shows-create-attempted");
assert.equal(libraries.length, 1);
inputs = {};
const beforeMissingShows = calls.filter((call) => call === "POST /Library/VirtualFolders").length;
await assert.rejects(jellyfin.firstRun(context), /never replay it/);
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, beforeMissingShows);

reset();
ownerKind = "shared";
inputs = { ...selected };
libraries = [{ Name: "Movies", CollectionType: "movies", Locations: [selected["movies-path"]] },
  { Name: "Shows", CollectionType: "tvshows", Locations: [selected["shows-path"]] }];
assert.equal((await jellyfin.firstRun(context)).mediaLibrary, "movies-and-shows-verified");
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, 0);

reset();
ownerKind = "shared";
inputs = { ...selected };
libraries = [{ Name: "Movies", CollectionType: "movies", Locations: [selected["movies-path"], "/data/extra"] }];
await assert.rejects(jellyfin.firstRun(context), /differs from the saved path/);
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, 0);

reset();
ownerKind = "shared";
inputs = { ...selected };
libraries = [{ Name: "movies", CollectionType: "movies", Locations: ["/data/other"] }];
await assert.rejects(jellyfin.firstRun(context), /conflicts with existing media paths/);
assert.equal(calls.filter((call) => call === "POST /Library/VirtualFolders").length, 0);

process.stdout.write("Jellyfin setup mock checks passed\n");
