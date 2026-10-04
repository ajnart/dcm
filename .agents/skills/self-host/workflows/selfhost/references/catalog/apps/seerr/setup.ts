import { isAbsolute, join } from "node:path";

import type {
  SetupAdapter, SetupCheckpoint, SetupContext, SetupHttpReadRequest, SetupHttpResponse,
  SetupInspectionContext, SetupRecord,
} from "../../types/setup";

// Pinned v3.5.0: server/routes/auth.ts, server/routes/settings/index.ts,
// server/lib/permissions.ts, server/constants/user.ts, and server/index.ts.
// First-admin, existing API key, and selected Jellyfin libraries are separate
// checkpoints. Arr, initialize, and restart acceptance remain separate.
const APP_ID = "seerr";
const LOGIN = "seerr-jellyfin-first-admin";
const API = "/api/v1";
const SYNC_LIBRARIES = "seerr-sync-jellyfin-libraries";
const ENABLE_MOVIES = "seerr-enable-movies-library";
const ENABLE_SHOWS = "seerr-enable-shows-library";

// v3.5.0 Dockerfile ships node + sqlite3 in /app. datasource.ts's default
// SQLite path is config/db/db.sqlite3; entity/User.ts maps to the "user" table.
// OPEN_READONLY never creates a missing database or initializes TypeORM.
const EMPTY_USER_COUNT = "if(process.cwd()!=='/app'||(process.env.CONFIG_DIRECTORY&&process.env.CONFIG_DIRECTORY!=='/app/config')"
  + "||(process.env.DB_TYPE&&process.env.DB_TYPE!=='sqlite'))process.exit(1);"
  + "const sqlite=require('node:module').createRequire('/app/package.json')('sqlite3');"
  + "const db=new sqlite.Database('/app/config/db/db.sqlite3',sqlite.OPEN_READONLY,(error)=>{"
  + "if(error){process.exitCode=1;return;}"
  + "db.get('SELECT COUNT(*) AS count FROM \"user\"',(error,row)=>{"
  + "db.close((closeError)=>{if(error||closeError){process.exitCode=1;return;}"
  + "process.stdout.write(JSON.stringify({count:row.count}));});});});";

async function requireEmptyUsers(context: SetupContext): Promise<void> {
  const result = await context.container.exec({ effect: "read", argv: ["node", "-e", EMPTY_USER_COUNT],
    approval: { action: "seerr-inspect-empty-users",
      progress: "Check the exact owned Seerr database has no users before first-admin authentication" } });
  if (result.exitCode !== 0) {
    throw new Error("Seerr first-user inventory is unavailable; no first-admin login was sent");
  }
  let value: Record<string, unknown>;
  try { value = object(JSON.parse(result.stdout), "first-user inventory"); }
  catch { throw new Error("Seerr first-user inventory is invalid; no first-admin login was sent"); }
  if (Object.keys(value).length !== 1 || value.count !== 0) {
    throw new Error("Seerr already has users or unknown first-owner state; no first-admin login was sent");
  }
}

type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "checkpoint" | "secrets">;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Seerr ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function apiKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 256
    && /^[A-Za-z0-9+/=_-]+$/.test(value);
}

function administrator(user: Record<string, unknown>): boolean {
  return user.id === 1 && user.jellyfinUsername === "admin" && user.userType === 3
    && Number.isSafeInteger(user.permissions) && Number(user.permissions) >= 0
    && Number(user.permissions) <= 0x7fffffff && (Number(user.permissions) & 2) !== 0;
}

function sessionCookie(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096
    && /^connect\.sid=[^;,\s\u0000-\u001f\u007f]+$/.test(value);
}

function responseSession(response: SetupHttpResponse): string {
  const headers = response.headers.getSetCookie?.()
    ?? [response.headers.get("set-cookie") ?? ""];
  const cookies = headers.flatMap((header) => [...header.matchAll(
    /(?:^|,\s*)connect\.sid=([^;,\s]+)(?=;|,|$)/g,
  )].map((match) => `connect.sid=${match[1]}`));
  if (cookies.length !== 1 || !sessionCookie(cookies[0])) {
    throw new Error("Seerr first-admin session was not established unambiguously; inspect before retrying");
  }
  return cookies[0]!;
}

function libraryId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\u0000-\u001f\u007f/?#]/.test(value);
}

type Library = { id: string; name: string; enabled: boolean };

function libraryList(value: unknown): Library[] {
  if (!Array.isArray(value)) throw new Error("Seerr Jellyfin library list is invalid");
  return value.map((item) => {
    const entry = object(item, "Jellyfin library");
    if (!libraryId(entry.id) || typeof entry.name !== "string" || !entry.name.trim()
      || typeof entry.enabled !== "boolean") {
      throw new Error("Seerr Jellyfin library entry is invalid");
    }
    return { id: entry.id, name: entry.name, enabled: entry.enabled };
  });
}

function selectedLibraries(list: Library[]): { movies: Library; shows: Library } {
  const one = (name: string): Library => {
    const matches = list.filter((item) => item.name.toLowerCase() === name);
    if (matches.length !== 1) throw new Error(`Seerr ${name} library is missing or ambiguous`);
    return matches[0]!;
  };
  const movies = one("movies");
  const shows = one("shows");
  if (movies.id === shows.id || list.some((item) => item.enabled
    && item.id !== movies.id && item.id !== shows.id)) {
    throw new Error("Seerr enabled Jellyfin libraries differ from the selected Movies and Shows");
  }
  return { movies, shows };
}

function exactStatus(context: ReadContext): Promise<Record<string, unknown>> {
  return context.status().then((value) => {
    const status = object(value, "app status");
    const runtime = object(status.runtime, "runtime status");
    if (status.command !== "app status" || status.appId !== APP_ID
      || status.projectRoot !== context.projectRoot || status.ownerKind !== "shared"
      || status.status !== "applied" || status.mutation !== false
      || runtime.state !== "running" || status.loginVia !== "jellyfin"
      || status.passwordFile !== null
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)) {
      throw new Error("Seerr is not a running, exact shared app with external administrator identity");
    }
    return status;
  });
}

function keyPath(status: Record<string, unknown>): string {
  return join(status.privateFiles as string, "seerr-api-key");
}

async function captureSessionKey(context: SetupContext, status: Record<string, unknown>): Promise<string | null> {
  const session = await context.secrets.readSessionCookies();
  if (Object.keys(session).length === 0) return null;
  if (Object.keys(session).length !== 1 || !sessionCookie(session.seerr_cookie)) {
    throw new Error("Seerr private first-admin session is invalid; inspect without repeating login");
  }
  const main = await json(context, { method: "GET", path: `${API}/settings/main`,
    headers: { Cookie: session.seerr_cookie } }, "administrator main settings");
  if (!apiKey(main.apiKey)) throw new Error("Seerr administrator did not expose a valid existing API key");
  const path = await context.secrets.writeApiKey(main.apiKey);
  if (path !== keyPath(status)) throw new Error("Seerr API key was not saved in its exact owner-only file");
  return main.apiKey;
}

async function json(context: ReadContext, request: SetupHttpReadRequest,
  label: string): Promise<Record<string, unknown>> {
  const response = await context.http.request(request);
  if (response.status !== 200 || !response.ok) throw new Error(`Seerr ${label} was not authorized`);
  try { return object(await response.json(), label); }
  catch { throw new Error(`Seerr ${label} returned invalid JSON`); }
}

async function publicSettings(context: ReadContext): Promise<Record<string, unknown>> {
  const value = await json(context, { method: "GET", path: `${API}/settings/public` }, "public settings");
  if (typeof value.initialized !== "boolean") throw new Error("Seerr public setup state is invalid");
  return value;
}

function checkpoint(context: ReadContext, value: unknown): SetupCheckpoint | null {
  if (value === null) return null;
  const saved = object(value, "setup checkpoint");
  const data = object(saved.data, "checkpoint data");
  if (saved.schemaVersion !== 1 || saved.appId !== APP_ID
    || saved.projectRoot !== context.projectRoot || !Number.isSafeInteger(saved.revision)
    || Number(saved.revision) < 1
    || !["login-attempted", "key-saved", "libraries-selected", "libraries-verified"].includes(String(saved.stage))
    || !Array.isArray(saved.attemptedActions) || !saved.attemptedActions.includes(LOGIN)
    || data.providerAppId !== "jellyfin") {
    throw new Error("Seerr setup checkpoint does not match this shared project");
  }
  if (["libraries-selected", "libraries-verified"].includes(String(saved.stage))
    && (!libraryId(data.moviesLibraryId) || !libraryId(data.showsLibraryId)
      || data.moviesLibraryId === data.showsLibraryId)) {
    throw new Error("Seerr saved library selection is invalid");
  }
  return saved as SetupCheckpoint;
}

function record(context: ReadContext, path: string, libraries = false): SetupRecord {
  if (libraries) {
    return { appId: APP_ID, projectRoot: context.projectRoot,
      stage: "admin-api-key-and-libraries-verified", adminUsername: "admin", apiKeyFile: path,
      functionalAcceptance: "pending-arr-initialization-and-restart" };
  }
  return { appId: APP_ID, projectRoot: context.projectRoot,
    stage: "admin-and-api-key-saved", adminUsername: "admin", apiKeyFile: path,
    functionalAcceptance: "pending-libraries-arr-initialization-and-restart" };
}

async function protectedState(context: ReadContext, key: string): Promise<void> {
  const headers = { "X-Api-Key": key };
  const user = await json(context, { method: "GET", path: `${API}/auth/me`, headers }, "API-key administrator");
  if (!administrator(user)) {
    throw new Error("Seerr API key does not authenticate the expected first administrator");
  }
  const jellyfin = await json(context,
    { method: "GET", path: `${API}/settings/jellyfin`, headers }, "saved Jellyfin server");
  if (jellyfin.ip !== "jellyfin" || Number(jellyfin.port) !== 8096
    || jellyfin.useSsl !== false || typeof jellyfin.serverId !== "string"
    || jellyfin.serverId.length < 1) {
    throw new Error("Seerr Jellyfin server differs from the managed shared peer");
  }
}

async function getLibraries(context: ReadContext, key: string): Promise<Library[]> {
  const response = await context.http.request({ method: "GET", path: `${API}/settings/jellyfin/library`,
    headers: { "X-Api-Key": key } });
  if (response.status !== 200 || !response.ok) {
    throw new Error("Seerr Jellyfin library readback was not authorized");
  }
  try { return libraryList(await response.json()); }
  catch { throw new Error("Seerr Jellyfin library readback is invalid"); }
}

async function syncLibraries(context: SetupContext, key: string): Promise<Library[]> {
  const response = await context.http.request({ method: "POST", path: `${API}/settings/jellyfin/library/sync`,
    headers: { "X-Api-Key": key },
    approval: { action: SYNC_LIBRARIES,
      progress: "Sync the selected shared Jellyfin libraries into Seerr" } });
  if (response.status !== 200 || !response.ok) {
    throw new Error("Seerr Jellyfin library sync was not confirmed");
  }
  try { return libraryList(await response.json()); }
  catch { throw new Error("Seerr Jellyfin library sync returned an invalid list"); }
}

async function enableLibrary(context: SetupContext, key: string, library: Library,
  action: string): Promise<void> {
  const response = await context.http.request({ method: "PUT",
    path: `${API}/settings/jellyfin/library/${encodeURIComponent(library.id)}`,
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
    approval: { action, progress: `Enable Seerr's selected ${library.name} library` } });
  if (response.status !== 200 || !response.ok) {
    throw new Error(`Seerr ${library.name} library enable was not confirmed`);
  }
  let value: Record<string, unknown>;
  try { value = object(await response.json(), `${library.name} library update`); }
  catch { throw new Error(`Seerr ${library.name} library update returned invalid JSON`); }
  if (value.id !== library.id || value.enabled !== true) {
    throw new Error(`Seerr ${library.name} library update did not return the selected state`);
  }
}

async function verifyLibraries(context: ReadContext, key: string,
  data: SetupCheckpoint["data"]): Promise<void> {
  const selected = selectedLibraries(await getLibraries(context, key));
  if (selected.movies.id !== data.moviesLibraryId || selected.shows.id !== data.showsLibraryId
    || !selected.movies.enabled || !selected.shows.enabled) {
    throw new Error("Seerr selected Jellyfin libraries did not pass exact readback");
  }
}

async function savedKey(context: ReadContext, status: Record<string, unknown>,
  saved: SetupCheckpoint | null): Promise<string> {
  const path = keyPath(status);
  if (!saved || !["key-saved", "libraries-selected", "libraries-verified"].includes(saved.stage)
    || saved.data.apiKeyFile !== path) {
    throw new Error("Seerr has no completed first-admin and API-key checkpoint");
  }
  const key = await context.secrets.readApiKey();
  if (!apiKey(key) || await context.secrets.apiKeyPath() !== path) {
    throw new Error("Seerr has no matching private API-key handoff");
  }
  await publicSettings(context);
  await protectedState(context, key);
  return key;
}

async function inspectSaved(context: ReadContext, status: Record<string, unknown>,
  saved: SetupCheckpoint | null): Promise<SetupRecord> {
  if (saved?.stage !== "key-saved" && saved?.stage !== "libraries-verified") {
    throw new Error("Seerr first-run checkpoint has an unfinished library selection");
  }
  const key = await savedKey(context, status, saved);
  if (saved.stage === "libraries-verified") {
    await verifyLibraries(context, key, saved.data);
    return record(context, keyPath(status), true);
  }
  return record(context, keyPath(status));
}

async function finishSaved(context: SetupContext, status: Record<string, unknown>,
  saved: SetupCheckpoint): Promise<SetupRecord> {
  const key = await savedKey(context, status, saved);
  const peer = await context.peers.inspectVerified("jellyfin");
  const peerLibrariesReady = peer.stage === "admin-api-key-and-libraries-verified"
    && peer.mediaLibrary === "movies-and-shows-verified";
  if (!peerLibrariesReady) {
    if (saved.stage !== "key-saved") {
      throw new Error("Seerr selected libraries lost their verified Jellyfin peer");
    }
    return record(context, keyPath(status));
  }
  if (saved.stage === "libraries-verified") {
    await verifyLibraries(context, key, saved.data);
    return record(context, keyPath(status), true);
  }
  const publicState = await publicSettings(context);
  if (publicState.initialized !== false) {
    throw new Error("Seerr is already initialized before managed library setup; inspect before changing it");
  }
  const selected = selectedLibraries(await syncLibraries(context, key));
  if (saved.stage === "key-saved") {
    const selectedCheckpoint = checkpoint(context, await context.checkpoint.compareAndSet({
      expectedRevision: saved.revision, stage: "libraries-selected",
      data: { ...saved.data, moviesLibraryId: selected.movies.id,
        showsLibraryId: selected.shows.id },
    }));
    if (selectedCheckpoint?.stage !== "libraries-selected") {
      throw new Error("Seerr library selection checkpoint was not saved");
    }
    saved = selectedCheckpoint;
  } else if (saved.stage !== "libraries-selected"
    || saved.data.moviesLibraryId !== selected.movies.id
    || saved.data.showsLibraryId !== selected.shows.id) {
    throw new Error("Seerr Jellyfin library IDs changed after selection; inspect before continuing");
  }
  if (!selected.movies.enabled) await enableLibrary(context, key, selected.movies, ENABLE_MOVIES);
  if (!selected.shows.enabled) await enableLibrary(context, key, selected.shows, ENABLE_SHOWS);
  await verifyLibraries(context, key, saved.data);
  const verifiedCheckpoint = checkpoint(context, await context.checkpoint.compareAndSet({
    expectedRevision: saved.revision, stage: "libraries-verified", data: saved.data,
  }));
  if (verifiedCheckpoint?.stage !== "libraries-verified") {
    throw new Error("Seerr library verification checkpoint was not saved");
  }
  return record(context, keyPath(status), true);
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  setupAfter: ["jellyfin", "sonarr", "radarr"],
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "seerr",
  ready(value) {
    const firstAdmin = value.stage === "admin-and-api-key-saved"
      && value.functionalAcceptance === "pending-libraries-arr-initialization-and-restart";
    const libraries = value.stage === "admin-api-key-and-libraries-verified"
      && value.functionalAcceptance === "pending-arr-initialization-and-restart";
    return value.appId === APP_ID && (firstAdmin || libraries)
      && value.adminUsername === "admin" && typeof value.projectRoot === "string"
      && isAbsolute(value.projectRoot) && typeof value.apiKeyFile === "string"
      && isAbsolute(value.apiKeyFile);
  },
  async inspect(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Seerr inspection received a different app project");
    }
    const status = await exactStatus(context);
    return inspectSaved(context, status, checkpoint(context, await context.checkpoint.read()));
  },
  async firstRun(context) {
    if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
      throw new Error("Seerr setup received a different app project");
    }
    const status = await exactStatus(context);
    const publicState = await publicSettings(context);
    let saved = checkpoint(context, await context.checkpoint.read());
    let existingKey = await context.secrets.readApiKey();
    if (saved && ["key-saved", "libraries-selected", "libraries-verified"].includes(saved.stage)) {
      return finishSaved(context, status, saved);
    }
    if (saved?.stage === "login-attempted") {
      if (existingKey === null) existingKey = await captureSessionKey(context, status);
      if (existingKey === null) {
        throw new Error("Seerr first-admin outcome is uncertain; inspect before retrying, never replay login");
      }
      if (!apiKey(existingKey) || await context.secrets.apiKeyPath() !== keyPath(status)) {
        throw new Error("Seerr attempted login has an invalid private key handoff");
      }
      await protectedState(context, existingKey);
      saved = checkpoint(context, await context.checkpoint.compareAndSet({
        expectedRevision: saved.revision, stage: "key-saved",
        data: { ...saved.data, apiKeyFile: keyPath(status) },
      }));
      if (!saved) throw new Error("Seerr API-key checkpoint was not saved");
      return finishSaved(context, status, saved);
    }
    if (existingKey !== null || publicState.initialized !== false) {
      throw new Error("Seerr already has unmanaged setup state; inspect before first-admin login");
    }

    await requireEmptyUsers(context);
    const peer = await context.peers.readVerifiedAdmin("jellyfin");
    const response = await context.http.request({
      method: "POST", path: `${API}/auth/jellyfin`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: peer.username, password: peer.password,
        hostname: "jellyfin", port: 8096, urlBase: "", useSsl: false, serverType: 2 }),
      approval: { action: LOGIN, progress: "Create Seerr's first administrator with the verified shared Jellyfin admin", once: true },
      beforeSendCheckpoint: { expectedRevision: null, stage: "login-attempted",
        data: { providerAppId: "jellyfin" } },
    });
    if (response.status !== 200 || !response.ok) {
      throw new Error("Seerr first-admin login did not return success; inspect before retrying");
    }
    const cookie = responseSession(response);
    const loginUser = object(await response.json(), "first administrator");
    if (!administrator(loginUser)) {
      throw new Error("Seerr did not create the expected first administrator; inspect before retrying");
    }
    await context.secrets.writeSessionCookies({ seerr_cookie: cookie });
    const capturedKey = await captureSessionKey(context, status);
    if (capturedKey === null) throw new Error("Seerr returned no recoverable first-admin session");
    const path = keyPath(status);
    // Capture the durable key before any further network request. An uncertain
    // readback resumes verification from login-attempted, never first login.
    await protectedState(context, capturedKey);
    saved = checkpoint(context, await context.checkpoint.read());
    if (saved?.stage !== "login-attempted") {
      throw new Error("Seerr first-admin attempt checkpoint is missing; inspect before retrying");
    }
    saved = checkpoint(context, await context.checkpoint.compareAndSet({
      expectedRevision: saved.revision, stage: "key-saved",
      data: { providerAppId: "jellyfin", apiKeyFile: path },
    }));
    if (!saved) throw new Error("Seerr API-key checkpoint was not saved");
    return finishSaved(context, status, saved);
  },
};

export default adapter;
