import { createHash } from "node:crypto";
import { isAbsolute, join, posix } from "node:path";

import { appliedStatus, type SetupAdapter, type SetupCheckpoint, type SetupContext,
  type SetupHttpReadRequest, type SetupInspectionContext, type SetupRecord,
} from "../../types/setup";

// Pinned v12.1 contract: StartupController, UserController, ApiKeyController,
// AuthorizationContext, and PublicSystemInfo in github.com/jellyfin/jellyfin/v12.1.
const APP_ID = "jellyfin";
const INIT = "jellyfin-initialize-first-user";
const SET_ADMIN = "jellyfin-set-first-admin";
const COMPLETE = "jellyfin-complete-startup";
const CREATE_KEY = "jellyfin-create-api-key";
const CREATE_MOVIES = "jellyfin-create-movies-library";
const CREATE_SHOWS = "jellyfin-create-shows-library";
const STAGES = ["user-init-attempted", "user-initialized", "admin-set-attempted",
  "admin-verified", "wizard-complete-attempted", "wizard-complete",
  "key-create-attempted", "key-saved", "movies-create-attempted", "movies-verified",
  "shows-create-attempted", "libraries-verified"] as const;

type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "http">;
type Data = Record<string, string | number | boolean | null>;
type LibraryPaths = { moviesPath: string; showsPath: string };
type Library = { name: "Movies" | "Shows"; type: "movies" | "tvshows";
  path: string; action: string; attemptedStage: typeof STAGES[number] };

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Jellyfin ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function token(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 8192
    && value.trim() === value && !/[\r\n\u0000,\"]/.test(value);
}

function userId(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{32}$/.test(value);
}

async function users(context: ReadContext, accessToken?: string): Promise<Record<string, unknown>[]> {
  // The public endpoint excludes hidden/disabled users even before completion.
  // Never infer ownership from absence alone: bind the initialization response
  // to its passwordless visible ID before the first administrator update.
  const request: SetupHttpReadRequest = { method: "GET", path: "/Users/Public" };
  if (accessToken !== undefined) {
    request.path = "/Users";
    request.headers = { Authorization: authorization(context.projectRoot, accessToken) };
  }
  let response;
  try { response = await context.http.request(request); }
  catch { throw new Error("Jellyfin account inventory could not be verified"); }
  if (response.status !== 200 || !response.ok) {
    throw new Error("Jellyfin account inventory could not be verified");
  }
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new Error("Jellyfin account inventory returned invalid JSON"); }
  if (!Array.isArray(value)) throw new Error("Jellyfin account inventory is invalid");
  return value.map((entry) => {
    const user = object(entry, "account inventory entry");
    if (!userId(user.Id) || typeof user.Name !== "string") {
      throw new Error("Jellyfin account inventory entry is invalid");
    }
    return user;
  });
}

function exactAdmin(user: Record<string, unknown>, expectedId: string): void {
  const policy = object(user.Policy, "administrator policy");
  if (user.Id !== expectedId || user.Name !== "admin"
    || policy.IsAdministrator !== true || policy.IsDisabled !== false) {
    throw new Error("Jellyfin account is not the exact saved enabled administrator");
  }
}

function libraryPath(value: unknown): value is string {
  return typeof value === "string" && value.length > "/data/".length
    && value.length <= 512 && value.startsWith("/data/") && !value.endsWith("/")
    && posix.normalize(value) === value && !/[,\u0000-\u001f\u007f]/.test(value);
}

function selectedPaths(data: Data): LibraryPaths | null {
  const moviesPath = data.moviesPath;
  const showsPath = data.showsPath;
  if (moviesPath === undefined && showsPath === undefined) return null;
  if (!libraryPath(moviesPath) || !libraryPath(showsPath)
    || moviesPath === showsPath) {
    throw new Error("Jellyfin saved library paths are invalid; inspect before continuing");
  }
  return { moviesPath, showsPath };
}

function requestedPaths(context: SetupContext, saved: SetupCheckpoint | null): LibraryPaths | null {
  const values = context.inputs;
  const hasMovies = Object.hasOwn(values, "movies-path");
  const hasShows = Object.hasOwn(values, "shows-path");
  if (hasMovies !== hasShows) {
    throw new Error("Jellyfin requires both movies-path and shows-path before setup writes");
  }
  const prior = saved === null ? null : selectedPaths(saved.data);
  if (!hasMovies) return prior;
  const moviesPath = values["movies-path"];
  const showsPath = values["shows-path"];
  if (!libraryPath(moviesPath) || !libraryPath(showsPath)
    || moviesPath === showsPath) {
    throw new Error("Jellyfin library paths must be distinct, exact directories under /data without commas or controls");
  }
  if (prior && (prior.moviesPath !== moviesPath || prior.showsPath !== showsPath)) {
    throw new Error("Jellyfin library paths differ from this project's saved selection; inspect before continuing");
  }
  return { moviesPath, showsPath };
}

function exactStatus(context: ReadContext, value: unknown): Record<string, unknown> {
  const status = appliedStatus(context, value);
  if (typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)) {
    throw new Error("Jellyfin is not a running, exact saved app project with private files");
  }
  return status;
}

function keyPath(status: Record<string, unknown>): string {
  return join(status.privateFiles as string, "jellyfin-api-key");
}

function label(root: string): string {
  return `Auto-Stack Jellyfin ${createHash("sha256").update(root).digest("hex").slice(0, 16)}`;
}

function deviceId(root: string): string {
  return `auto-stack-${createHash("sha256").update(root).digest("hex").slice(0, 24)}`;
}

function authorization(root: string, accessToken?: string): string {
  let value = `MediaBrowser Client="Auto-Stack", Device="Selfhost Setup", DeviceId="${deviceId(root)}", Version="1.0.0"`;
  if (accessToken !== undefined) {
    if (!token(accessToken)) throw new Error("Jellyfin has an invalid private token");
    value += `, Token="${accessToken}"`;
  }
  return value;
}

async function json(context: ReadContext, request: SetupHttpReadRequest,
  labelText: string): Promise<Record<string, unknown>> {
  let response;
  try { response = await context.http.request(request); }
  catch { throw new Error(`Jellyfin ${labelText} could not be verified`); }
  if (response.status !== 200 || !response.ok) {
    throw new Error(`Jellyfin ${labelText} could not be verified`);
  }
  try { return object(await response.json(), labelText); }
  catch { throw new Error(`Jellyfin ${labelText} returned an invalid response`); }
}

async function publicInfo(context: ReadContext): Promise<{ id: string; completed: boolean }> {
  const info = await json(context, { method: "GET", path: "/System/Info/Public" }, "public system info");
  if (typeof info.Version !== "string" || !/^12\.1(?:\.|$)/.test(info.Version)
    || typeof info.Id !== "string" || info.Id.length < 1
    || typeof info.StartupWizardCompleted !== "boolean") {
    throw new Error("Jellyfin setup requires the pinned v12.1 public system contract");
  }
  return { id: info.Id, completed: info.StartupWizardCompleted };
}

function checkpoint(context: ReadContext, value: unknown): SetupCheckpoint | null {
  if (value === null) return null;
  const saved = object(value, "setup checkpoint");
  const data = object(saved.data, "checkpoint data");
  if (saved.schemaVersion !== 1 || saved.appId !== APP_ID
    || saved.projectRoot !== context.projectRoot || !Number.isSafeInteger(saved.revision)
    || Number(saved.revision) < 1 || !STAGES.includes(saved.stage as typeof STAGES[number])
    || !Array.isArray(saved.attemptedActions)
    || !saved.attemptedActions.every((action) => typeof action === "string")
    || typeof data.serverId !== "string" || data.serverId.length < 1
    || data.keyLabel !== label(context.projectRoot)) {
    throw new Error("Jellyfin setup checkpoint does not match this app project");
  }
  for (const entry of Object.values(data)) {
    if (entry !== null && typeof entry !== "string" && typeof entry !== "boolean"
      && !(typeof entry === "number" && Number.isFinite(entry))) {
      throw new Error("Jellyfin setup checkpoint has unsupported data");
    }
  }
  const paths = selectedPaths(data as Data);
  const actions = saved.attemptedActions as string[];
  const stageIndex = STAGES.indexOf(saved.stage as typeof STAGES[number]);
  if (!actions.includes(INIT)
    || (stageIndex >= 1 && !userId(data.adminUserId))
    || (stageIndex >= 2 && !actions.includes(SET_ADMIN))
    || (stageIndex >= 4 && !actions.includes(COMPLETE))
    || (stageIndex >= 6 && !actions.includes(CREATE_KEY))
    || (stageIndex >= 8 && paths === null)
    || (saved.stage === "movies-create-attempted" && !actions.includes(CREATE_MOVIES))
    || (saved.stage === "shows-create-attempted" && !actions.includes(CREATE_SHOWS))) {
    throw new Error("Jellyfin checkpoint is missing an irreversible-step attempt");
  }
  return saved as SetupCheckpoint;
}

async function save(context: SetupContext, current: SetupCheckpoint | null,
  stage: typeof STAGES[number], data: Data): Promise<SetupCheckpoint> {
  try {
    const next = checkpoint(context, await context.checkpoint.compareAndSet({
      expectedRevision: current?.revision ?? null, stage, data,
    }));
    if (next?.stage !== stage || next.revision !== (current?.revision ?? 0) + 1) {
      throw new Error("checkpoint mismatch");
    }
    return next;
  } catch {
    throw new Error("Jellyfin setup checkpoint could not be saved; inspect before retrying");
  }
}

async function adminSession(context: SetupContext, password: string, expectedId: string): Promise<string> {
  const digest = createHash("sha256").update(password).digest("hex");
  const saved = await context.secrets.readSessionCookies();
  if (Object.keys(saved).some((field) => !["bearer", "owner_id", "password_digest"].includes(field))
    || (Object.keys(saved).length > 0 && (saved.password_digest !== digest
      || !token(saved.bearer) || saved.owner_id !== expectedId))) {
    throw new Error("Jellyfin private session differs from the saved administrator credential");
  }
  if (saved.bearer) {
    await verifySessionOwner(context, saved.bearer, saved.owner_id);
  }
  const response = await context.http.request({ method: "POST", path: "/Users/AuthenticateByName",
    headers: { Authorization: authorization(context.projectRoot), "Content-Type": "application/json" },
    body: JSON.stringify({ Username: "admin", Pw: password }),
    approval: { action: "jellyfin-verify-admin", progress: "Verify the saved Jellyfin administrator login" },
  });
  if (response.status !== 200 || !response.ok) {
    throw new Error("Jellyfin saved administrator login could not be verified");
  }
  let result: Record<string, unknown>;
  try { result = object(await response.json(), "administrator login"); }
  catch { throw new Error("Jellyfin administrator login returned an invalid response"); }
  const user = object(result.User, "authenticated user");
  exactAdmin(user, expectedId);
  if (!token(result.AccessToken)) {
    throw new Error("Jellyfin saved account is not the expected administrator");
  }
  if (saved.bearer) {
    await verifySessionOwner(context, result.AccessToken, expectedId, false);
    return saved.bearer;
  }
  // Private pending session, never readiness: verify the exact owner before
  // returning it, and recheck again on every invocation before any mutation.
  await context.secrets.writeSessionCookies({ bearer: result.AccessToken,
    owner_id: expectedId, password_digest: digest });
  await verifySessionOwner(context, result.AccessToken, expectedId);
  return result.AccessToken;
}

async function verifySessionOwner(context: SetupContext, bearer: string, ownerId: string,
  clearRejectedSession = true): Promise<void> {
  const response = await context.http.request({ method: "GET", path: "/Users/Me",
    headers: { Authorization: authorization(context.projectRoot, bearer) } });
  if (response.status === 401) {
    if (clearRejectedSession) await context.secrets.writeSessionCookies({});
    throw new Error("Jellyfin setup session expired; request a new approved login on the next run");
  }
  if (response.status !== 200 || !response.ok) throw new Error("Jellyfin setup-session owner readback failed");
  const user = object(await response.json(), "setup-session owner");
  exactAdmin(user, ownerId);
}

async function keys(context: ReadContext, sessionToken: string): Promise<string[]> {
  const result = await json(context, { method: "GET", path: "/Auth/Keys",
    headers: { Authorization: authorization(context.projectRoot, sessionToken) } }, "API-key inventory");
  if (!Array.isArray(result.Items) || !Number.isSafeInteger(result.TotalRecordCount)
    || result.TotalRecordCount !== result.Items.length) {
    throw new Error("Jellyfin API-key inventory is incomplete or invalid");
  }
  const matching: string[] = [];
  for (const item of result.Items) {
    const key = object(item, "API-key entry");
    if (key.AppName === label(context.projectRoot)) {
      if (!token(key.AccessToken) || key.IsActive !== true) {
        throw new Error("Jellyfin labeled API key is invalid or inactive");
      }
      matching.push(key.AccessToken);
    }
  }
  return matching;
}

async function protectedRead(context: ReadContext, accessToken: string, serverId: string): Promise<void> {
  const info = await json(context, { method: "GET", path: "/System/Info",
    headers: { Authorization: authorization(context.projectRoot, accessToken) } }, "API-key authorization");
  if (info.Id !== serverId || typeof info.Version !== "string" || !/^12\.1(?:\.|$)/.test(info.Version)) {
    throw new Error("Jellyfin API key did not authorize the expected v12.1 server");
  }
}

async function libraryInventory(context: ReadContext, accessToken: string): Promise<Record<string, unknown>[]> {
  let response;
  try {
    response = await context.http.request({ method: "GET", path: "/Library/VirtualFolders",
      headers: { Authorization: authorization(context.projectRoot, accessToken) } });
  } catch {
    throw new Error("Jellyfin library inventory could not be verified");
  }
  if (response.status !== 200 || !response.ok) {
    throw new Error("Jellyfin library inventory could not be verified");
  }
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new Error("Jellyfin library inventory returned invalid JSON"); }
  if (!Array.isArray(value)) throw new Error("Jellyfin library inventory is invalid");
  return value.map((entry) => {
    const folder = object(entry, "library entry");
    if (typeof folder.Name !== "string" || folder.Name.length < 1
      || (folder.CollectionType !== null && folder.CollectionType !== undefined
        && typeof folder.CollectionType !== "string")
      || !Array.isArray(folder.Locations)
      || !folder.Locations.every((location) => typeof location === "string")) {
      throw new Error("Jellyfin library inventory has an invalid entry");
    }
    return folder;
  });
}

function libraryPresent(inventory: Record<string, unknown>[], library: Library): boolean {
  const matches = inventory.filter((entry) => entry.Name === library.name);
  if (matches.length > 1 || inventory.some((entry) => entry.Name !== library.name
    && ((entry.Name as string).toLowerCase() === library.name.toLowerCase()
      || (entry.Locations as string[]).includes(library.path)))) {
    throw new Error(`Jellyfin ${library.name} library conflicts with existing media paths; inspect manually`);
  }
  if (matches.length === 0) return false;
  const found = matches[0];
  const locations = found.Locations as string[];
  if (found.CollectionType !== library.type || locations.length !== 1
    || locations[0] !== library.path) {
    throw new Error(`Jellyfin ${library.name} library differs from the saved path or type; inspect manually`);
  }
  return true;
}

async function createLibrary(context: SetupContext, saved: SetupCheckpoint, accessToken: string,
  library: Library): Promise<SetupCheckpoint> {
  const response = await context.http.request({ method: "POST", path: "/Library/VirtualFolders",
    query: { name: library.name, collectionType: library.type, paths: library.path,
      refreshLibrary: "false" },
    headers: { Authorization: authorization(context.projectRoot, accessToken) },
    approval: { action: library.action,
      progress: `Create the ${library.name} Jellyfin library at its saved path once`, once: true },
    beforeSendCheckpoint: { expectedRevision: saved.revision,
      stage: library.attemptedStage, data: saved.data },
  });
  if (response.status !== 204 || !response.ok) {
    throw new Error(`Jellyfin ${library.name} library creation is uncertain; inspect inventory and do not replay it`);
  }
  const attempted = checkpoint(context, await context.checkpoint.read());
  if (attempted?.stage !== library.attemptedStage
    || !attempted.attemptedActions.includes(library.action)) {
    throw new Error(`Jellyfin ${library.name} library attempt checkpoint is missing; inspect manually`);
  }
  return attempted;
}

async function configureLibraries(context: SetupContext, saved: SetupCheckpoint,
  accessToken: string, paths: LibraryPaths): Promise<SetupCheckpoint> {
  const movies: Library = { name: "Movies", type: "movies", path: paths.moviesPath,
    action: CREATE_MOVIES, attemptedStage: "movies-create-attempted" };
  const shows: Library = { name: "Shows", type: "tvshows", path: paths.showsPath,
    action: CREATE_SHOWS, attemptedStage: "shows-create-attempted" };

  if (saved.stage === "key-saved" || saved.stage === "movies-create-attempted") {
    const prior = await libraryInventory(context, accessToken);
    const moviesPresent = libraryPresent(prior, movies);
    libraryPresent(prior, shows);
    if (!moviesPresent) {
      if (saved.stage === "movies-create-attempted") {
        throw new Error("Jellyfin Movies create was attempted but has no exact readback; never replay it");
      }
      saved = await createLibrary(context, saved, accessToken, movies);
    }
    const verified = await libraryInventory(context, accessToken);
    if (!libraryPresent(verified, movies)) {
      throw new Error("Jellyfin Movies library has no exact readback; never replay creation");
    }
    libraryPresent(verified, shows);
    saved = await save(context, saved, "movies-verified", saved.data);
  }

  if (saved.stage === "movies-verified" || saved.stage === "shows-create-attempted") {
    const prior = await libraryInventory(context, accessToken);
    if (!libraryPresent(prior, movies)) {
      throw new Error("Jellyfin Movies library changed after verification; inspect manually");
    }
    const showsPresent = libraryPresent(prior, shows);
    if (!showsPresent) {
      if (saved.stage === "shows-create-attempted") {
        throw new Error("Jellyfin Shows create was attempted but has no exact readback; never replay it");
      }
      saved = await createLibrary(context, saved, accessToken, shows);
    }
    const verified = await libraryInventory(context, accessToken);
    if (!libraryPresent(verified, movies) || !libraryPresent(verified, shows)) {
      throw new Error("Jellyfin libraries have no exact final readback; never replay creation");
    }
    saved = await save(context, saved, "libraries-verified", saved.data);
  }

  if (saved.stage !== "libraries-verified") {
    throw new Error("Jellyfin library setup has no verified terminal checkpoint");
  }
  const final = await libraryInventory(context, accessToken);
  if (!libraryPresent(final, movies) || !libraryPresent(final, shows)) {
    throw new Error("Jellyfin libraries no longer match the saved paths; inspect manually");
  }
  return saved;
}

function record(context: ReadContext, path: string, paths: LibraryPaths | null): SetupRecord {
  const base = { appId: APP_ID, projectRoot: context.projectRoot, adminUsername: "admin",
    apiKeyFile: path, keyLabel: label(context.projectRoot) };
  if (paths === null) {
    return { ...base, stage: "admin-and-api-key-saved",
      mediaLibrary: "not-configured-owner-path-required" };
  }
  return { ...base, stage: "admin-api-key-and-libraries-verified",
    mediaLibrary: "movies-and-shows-verified", ...paths };
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  inputDefinitions: [
    { key: "movies-path", label: "Movies directory inside Jellyfin (/data/...)" },
    { key: "shows-path", label: "Shows directory inside Jellyfin (/data/...)" },
  ],
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "jellyfin",
  ready(value) {
    const firstAdmin = value.stage === "admin-and-api-key-saved"
      && value.mediaLibrary === "not-configured-owner-path-required";
    const libraries = value.stage === "admin-api-key-and-libraries-verified"
      && value.mediaLibrary === "movies-and-shows-verified"
      && libraryPath(value.moviesPath) && libraryPath(value.showsPath)
      && value.moviesPath !== value.showsPath;
    return value.appId === APP_ID && (firstAdmin || libraries)
      && value.adminUsername === "admin" && typeof value.apiKeyFile === "string"
      && isAbsolute(value.apiKeyFile) && typeof value.projectRoot === "string"
      && isAbsolute(value.projectRoot) && value.keyLabel === label(value.projectRoot);
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Jellyfin inspection received a different app project");
    }
    const status = exactStatus(context, await context.status());
    const info = await publicInfo(context);
    const saved = checkpoint(context, await context.checkpoint.read());
    if (!info.completed || !saved || !["key-saved", "libraries-verified"].includes(saved.stage)
      || saved.data.serverId !== info.id
      || saved.data.apiKeyFile !== keyPath(status)) {
      throw new Error("Jellyfin has no completed, matching first-run checkpoint");
    }
    const paths = selectedPaths(saved.data);
    if (paths !== null && status.ownerKind !== "shared") {
      throw new Error("Jellyfin library setup requires the exact shared app owner");
    }
    if ((paths === null) !== (saved.stage === "key-saved")) {
      throw new Error("Jellyfin library paths have no completed readback checkpoint");
    }
    const accessToken = await context.secrets.readApiKey();
    if (!token(accessToken) || await context.secrets.apiKeyPath() !== keyPath(status)) {
      throw new Error("Jellyfin has no matching private API-key handoff");
    }
    await protectedRead(context, accessToken, info.id);
    const inventory = await users(context, accessToken);
    const owners = inventory.filter((user) => user.Id === saved.data.adminUserId);
    if (owners.length !== 1) throw new Error("Jellyfin saved administrator is missing or ambiguous");
    exactAdmin(owners[0], saved.data.adminUserId as string);
    const matching = await keys(context, accessToken);
    if (matching.length !== 1 || matching[0] !== accessToken) {
      throw new Error("Jellyfin must have exactly one matching saved API key");
    }
    if (paths !== null) {
      const inventory = await libraryInventory(context, accessToken);
      if (!libraryPresent(inventory, { name: "Movies", type: "movies", path: paths.moviesPath,
        action: CREATE_MOVIES, attemptedStage: "movies-create-attempted" })
        || !libraryPresent(inventory, { name: "Shows", type: "tvshows", path: paths.showsPath,
          action: CREATE_SHOWS, attemptedStage: "shows-create-attempted" })) {
        throw new Error("Jellyfin libraries no longer match the saved paths; inspect manually");
      }
    }
    return record(context, keyPath(status), paths);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Jellyfin setup received a different app project");
    }
    const status = exactStatus(context, await context.status());
    const info = await publicInfo(context);
    const password = await context.secrets.readAdminPassword();
    if (!token(password)) throw new Error("Jellyfin has no valid generated administrator password");
    let saved = checkpoint(context, await context.checkpoint.read());
    if (saved && saved.data.serverId !== info.id) {
      throw new Error("Jellyfin server identity changed; inspect the project manually");
    }
    const paths = requestedPaths(context, saved);
    if (paths !== null && status.ownerKind !== "shared") {
      throw new Error("Jellyfin library setup requires the exact shared app owner");
    }
    const data: Data = { serverId: info.id, keyLabel: label(context.projectRoot), ...(paths ?? {}) };
    if (saved && paths !== null && selectedPaths(saved.data) === null) {
      saved = await save(context, saved, saved.stage as typeof STAGES[number],
        { ...saved.data, ...paths });
    }
    if (saved === null) {
      if (info.completed) throw new Error("Jellyfin is already initialized without this setup checkpoint; inspect manually");
      if ((await users(context)).length !== 0) {
        throw new Error("Jellyfin already has an unowned account; never initialize or replace it implicitly");
      }
      const response = await context.http.request({ method: "GET", path: "/Startup/User",
        approval: { action: INIT, progress: "Initialize the first Jellyfin user once", once: true },
        beforeSendCheckpoint: { expectedRevision: null, stage: "user-init-attempted", data },
      });
      if (response.status !== 200 || !response.ok) {
        throw new Error("Jellyfin first-user initialization is uncertain; inspect manually and do not replay");
      }
      let initial: Record<string, unknown>;
      try { initial = object(await response.json(), "first user"); }
      catch { throw new Error("Jellyfin first-user response is uncertain; inspect manually and do not replay"); }
      if (typeof initial.Name !== "string" || initial.Name.length < 1) {
        throw new Error("Jellyfin first-user response is invalid; inspect manually and do not replay");
      }
      saved = checkpoint(context, await context.checkpoint.read());
      if (saved?.stage !== "user-init-attempted" || !saved.attemptedActions.includes(INIT)) {
        throw new Error("Jellyfin first-user attempt checkpoint is missing; inspect manually");
      }
      const inventory = await users(context);
      if (inventory.length !== 1 || inventory[0].Name !== initial.Name
        || inventory[0].HasPassword !== false) {
        throw new Error("Jellyfin initialized user has no exact passwordless account readback; never replay initialization");
      }
      saved = await save(context, saved, "user-initialized", { ...data,
        firstUser: initial.Name, adminUserId: inventory[0].Id as string });
    }
    if (saved.stage === "user-init-attempted") {
      throw new Error("Jellyfin first-user initialization may have occurred; inspect manually and never replay it");
    }
    if (!saved.attemptedActions.includes(INIT)) {
      throw new Error("Jellyfin first-user checkpoint has no matching one-time attempt");
    }
    if (saved.stage === "user-initialized") {
      if (info.completed) throw new Error("Jellyfin wizard completed before the saved admin step; inspect manually");
      const inventory = await users(context);
      if (inventory.length !== 1 || inventory[0].Id !== saved.data.adminUserId
        || inventory[0].Name !== saved.data.firstUser || inventory[0].HasPassword !== false) {
        throw new Error("Jellyfin first-user account changed before the approved administrator update");
      }
      const response = await context.http.request({ method: "POST", path: "/Startup/User",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Name: "admin", Password: password }),
        approval: { action: SET_ADMIN, progress: "Set the generated Jellyfin admin credential once", once: true },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "admin-set-attempted", data: saved.data },
      });
      if (response.status !== 204 || !response.ok) {
        throw new Error("Jellyfin first-admin update is uncertain; verify login, never replay it");
      }
      saved = checkpoint(context, await context.checkpoint.read());
    }
    let sessionToken: string | null = null;
    if (saved?.stage === "admin-set-attempted") {
      if (!saved.attemptedActions.includes(SET_ADMIN)) {
        throw new Error("Jellyfin first-admin attempt checkpoint is missing");
      }
      sessionToken = await adminSession(context, password, saved.data.adminUserId as string);
      saved = await save(context, saved, "admin-verified", saved.data);
    }
    if (!saved || !saved.attemptedActions.includes(SET_ADMIN)) {
      throw new Error("Jellyfin has no verified first-admin attempt");
    }
    if (sessionToken === null) {
      sessionToken = await adminSession(context, password, saved.data.adminUserId as string);
    }
    if (saved.stage === "admin-verified") {
      if (info.completed) throw new Error("Jellyfin wizard completed outside this setup checkpoint; inspect manually");
      const response = await context.http.request({ method: "POST", path: "/Startup/Complete",
        approval: { action: COMPLETE, progress: "Complete the Jellyfin startup wizard once", once: true },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "wizard-complete-attempted", data: saved.data },
      });
      if (response.status !== 204 || !response.ok) {
        throw new Error("Jellyfin wizard completion is uncertain; inspect status and do not replay it");
      }
      saved = checkpoint(context, await context.checkpoint.read());
    }
    const completed = await publicInfo(context);
    if (completed.id !== info.id || !completed.completed) {
      throw new Error("Jellyfin startup completion is not verified; never replay an uncertain mutation");
    }
    if (saved?.stage === "wizard-complete-attempted") {
      if (!saved.attemptedActions.includes(COMPLETE)) {
        throw new Error("Jellyfin wizard-complete attempt checkpoint is missing");
      }
      saved = await save(context, saved, "wizard-complete", saved.data);
    }
    if (!saved || !saved.attemptedActions.includes(COMPLETE)) {
      throw new Error("Jellyfin has no matching wizard-complete attempt");
    }
    const expectedPath = keyPath(status);
    let stored = await context.secrets.readApiKey();
    const storedPath = await context.secrets.apiKeyPath();
    if ((stored === null) !== (storedPath === null)
      || (storedPath !== null && storedPath !== expectedPath)
      || (stored !== null && !token(stored))) {
      throw new Error("Jellyfin private API-key state is inconsistent; inspect manually");
    }
    if (saved.stage === "wizard-complete") {
      if (stored !== null) throw new Error("Jellyfin has an uncheckpointed private API key; inspect manually");
      const existing = await keys(context, sessionToken);
      if (existing.length > 0) {
        throw new Error("Jellyfin already has a matching API key; never rotate or adopt it implicitly");
      }
      const response = await context.http.request({ method: "POST", path: "/Auth/Keys",
        query: { app: label(context.projectRoot) },
        headers: { Authorization: authorization(context.projectRoot, sessionToken) },
        approval: { action: CREATE_KEY, progress: "Create one labeled persistent Jellyfin API key", once: true },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: "key-create-attempted", data: saved.data },
      });
      if (response.status !== 204 || !response.ok) {
        throw new Error("Jellyfin API-key creation is uncertain; inspect inventory and do not replay it");
      }
      saved = checkpoint(context, await context.checkpoint.read());
    }
    if (saved?.stage === "key-create-attempted") {
      if (!saved.attemptedActions.includes(CREATE_KEY)) {
        throw new Error("Jellyfin API-key creation has no durable attempt checkpoint");
      }
      const matching = await keys(context, sessionToken);
      if (matching.length !== 1) {
        throw new Error("Jellyfin key creation is ambiguous; require exactly one labeled key and never retry create");
      }
      const found = matching[0];
      if (stored !== null && stored !== found) {
        throw new Error("Jellyfin private key differs from its labeled key; inspect manually");
      }
      if (stored === null) {
        const path = await context.secrets.writeApiKey(found);
        if (path !== expectedPath || await context.secrets.apiKeyPath() !== expectedPath
          || await context.secrets.readApiKey() !== found) {
          throw new Error("Jellyfin key could not be confirmed in its private handoff; inspect manually");
        }
        stored = found;
      }
      saved = await save(context, saved, "key-saved", { ...saved.data, apiKeyFile: expectedPath });
    }
    if (!saved || STAGES.indexOf(saved.stage as typeof STAGES[number]) < 7
      || !saved.attemptedActions.includes(CREATE_KEY)
      || saved.data.apiKeyFile !== expectedPath || stored === null) {
      throw new Error("Jellyfin has no completed private API-key checkpoint");
    }
    const matching = await keys(context, sessionToken);
    if (matching.length !== 1 || matching[0] !== stored) {
      throw new Error("Jellyfin must have exactly one matching saved API key");
    }
    await protectedRead(context, stored, info.id);
    if (paths !== null) {
      saved = await configureLibraries(context, saved, stored, paths);
    } else if (saved.stage !== "key-saved") {
      throw new Error("Jellyfin library checkpoint has no saved path selection");
    }
    return record(context, expectedPath, paths);
  },
};

export default adapter;
