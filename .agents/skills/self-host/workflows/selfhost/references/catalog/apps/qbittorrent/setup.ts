import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";

import {
  type SetupAdapter,
  type SetupContext,
  type SetupInspectionContext,
  type SetupRecord,
} from "../../types/setup";

const APP_ID = "qbittorrent";
const VERSION = "5.2.3";
const SAVE_PATH = "/data/torrents";
const TEMP_PATH = "/data/torrents/incomplete";
const CATEGORIES = [
  { appId: "sonarr", name: "tv-sonarr", path: "/data/torrents/tv-sonarr",
    action: "qbittorrent-create-sonarr-category" },
  { appId: "radarr", name: "movies-radarr", path: "/data/torrents/movies-radarr",
    action: "qbittorrent-create-radarr-category" },
] as const;
type ReadContext = Pick<SetupInspectionContext, "appId" | "projectRoot" | "status" | "http" | "secrets" | "checkpoint">;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

async function exactStatus(context: ReadContext): Promise<Record<string, unknown>> {
  if (context.appId !== APP_ID || !isAbsolute(context.projectRoot)) {
    throw new Error("qBittorrent setup received a different app project");
  }
  const status = object(await context.status(), "qBittorrent app status");
  const runtime = object(status.runtime, "qBittorrent runtime status");
  const port = status.port;
  if (status.command !== "app status" || status.appId !== APP_ID
    || status.projectRoot !== context.projectRoot || status.status !== "applied"
    || status.mutation !== false || runtime.state !== "running"
    || status.username !== "admin" || !Number.isSafeInteger(port)
    || Number(port) < 1 || Number(port) > 65535
    || status.url !== `http://127.0.0.1:${port}`
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
    || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)) {
    throw new Error("qBittorrent has no running, exact saved administrator project");
  }
  return status;
}

function headers(status: Record<string, unknown>, cookie?: string): Record<string, string> {
  const origin = status.url as string;
  const result: Record<string, string> = { Origin: origin, Referer: `${origin}/` };
  if (cookie) result.Cookie = cookie;
  return result;
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^qbt_[A-Za-z0-9]{28}$/.test(value);
}

class SessionRejected extends Error {}

function validSession(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512
    && /^QBT_SID(?:_[0-9]+)?=[^;,\s\\"]+$/.test(value);
}

async function sessionPreferences(context: SetupContext, status: Record<string, unknown>,
  cookie: string): Promise<Record<string, unknown>> {
  try {
    await version(context, headers(status, cookie));
    const prefs = await preferences(context, headers(status, cookie));
    if (prefs.web_ui_username !== "admin") {
      throw new Error("qBittorrent's existing WebUI username conflicts with managed setup");
    }
    return prefs;
  } catch (error) {
    // Pinned WebApplication::doProcessRequest returns 403 for a missing
    // private-API session. Other statuses/invalid readbacks keep the session.
    if (error instanceof SessionRejected) {
      await context.secrets.writeSessionCookies({});
      throw new SessionRejected("qBittorrent setup session was rejected; a new approved login is required");
    }
    throw error;
  }
}

async function login(context: SetupContext, status: Record<string, unknown>, password: string,
  action: string): Promise<string | null> {
  const response = await context.http.request({ method: "POST", path: "/api/v2/auth/login",
    headers: { ...headers(status), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password }).toString(),
    approval: { action, progress: "Verify the saved qBittorrent WebUI administrator login privately" } });
  if (response.status === 401) return null;
  if (response.status !== 200 && response.status !== 204) {
    throw new Error("qBittorrent WebUI login returned an unexpected status");
  }
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
  if (!validSession(cookie)) {
    throw new Error("qBittorrent login did not return a valid WebUI session cookie");
  }
  return cookie;
}

async function version(context: ReadContext, authHeaders: Record<string, string>): Promise<void> {
  const response = await context.http.request({ method: "GET", path: "/api/v2/app/version",
    headers: authHeaders });
  if (response.status === 403) throw new SessionRejected("qBittorrent private API session was rejected");
  if (response.status !== 200 || (await response.text()).trim().replace(/^v/, "") !== VERSION) {
    throw new Error("qBittorrent does not match the pinned WebUI API version");
  }
}

async function preferences(context: ReadContext,
  authHeaders: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await context.http.request({ method: "GET", path: "/api/v2/app/preferences",
    headers: authHeaders });
  if (response.status === 403) throw new SessionRejected("qBittorrent private API session was rejected");
  if (response.status !== 200) throw new Error("qBittorrent preferences could not be read privately");
  try { return object(await response.json(), "qBittorrent preferences"); }
  catch { throw new Error("qBittorrent preferences returned invalid JSON"); }
}

function configured(prefs: Record<string, unknown>): boolean {
  return prefs.web_ui_username === "admin" && prefs.save_path === SAVE_PATH
    && prefs.temp_path === TEMP_PATH && prefs.temp_path_enabled === true
    && prefs.bypass_local_auth === false
    && prefs.bypass_auth_subnet_whitelist_enabled === false;
}

async function rejectUntrustedAccess(context: ReadContext, status: Record<string, unknown>,
  key?: string): Promise<void> {
  const authHeaders = headers(status);
  if (key !== undefined) {
    // Keep the probe structurally valid but guaranteed different from the saved key.
    let suffix = "A";
    if (key.endsWith(suffix)) suffix = "B";
    authHeaders.Authorization = `Bearer ${key.slice(0, -1)}${suffix}`;
  }
  const response = await context.http.request({ method: "GET", path: "/api/v2/app/version",
    headers: authHeaders });
  if (response.status !== 403) {
    throw new Error("qBittorrent private API did not reject untrusted access");
  }
}

function managedCategories(data: Record<string, unknown>): typeof CATEGORIES[number][] {
  const selected: typeof CATEGORIES[number][] = [];
  for (const spec of CATEGORIES) {
    const name = data[`${spec.appId}Category`];
    const path = data[`${spec.appId}SavePath`];
    if (name === undefined && path === undefined) continue;
    if (name !== spec.name || path !== spec.path) {
      throw new Error(`qBittorrent ${spec.appId} category differs from its saved managed selection`);
    }
    selected.push(spec);
  }
  return selected;
}

function categoryData(data: Record<string, unknown>, spec: typeof CATEGORIES[number]):
  Record<string, string | number | boolean | null> {
  return { ...data, [`${spec.appId}Category`]: spec.name,
    [`${spec.appId}SavePath`]: spec.path } as Record<string, string | number | boolean | null>;
}

async function categories(context: ReadContext, authHeaders: Record<string, string>):
  Promise<Record<string, { name: string; savePath: string }>> {
  const response = await context.http.request({ method: "GET", path: "/api/v2/torrents/categories",
    headers: authHeaders });
  if (response.status !== 200 || !response.ok) {
    throw new Error("qBittorrent categories could not be read privately");
  }
  const entries = object(await response.json(), "qBittorrent categories");
  const result: Record<string, { name: string; savePath: string }> = Object.create(null);
  for (const [key, value] of Object.entries(entries)) {
    const category = object(value, "qBittorrent category");
    if (category.name !== key || typeof category.savePath !== "string") {
      throw new Error("qBittorrent category inventory is invalid");
    }
    result[key] = { name: key, savePath: category.savePath };
  }
  return result;
}

function matchingCategory(inventory: Record<string, { name: string; savePath: string }>,
  spec: typeof CATEGORIES[number]): boolean {
  const existing = inventory[spec.name];
  if (existing && existing.savePath !== spec.path) {
    throw new Error(`qBittorrent ${spec.appId} category already uses another path`);
  }
  return existing?.savePath === spec.path;
}

function record(context: ReadContext, status: Record<string, unknown>, keyFile: string,
  selected: readonly typeof CATEGORIES[number][] = []): SetupRecord {
  const categoryFields: Record<string, string> = {};
  for (const spec of selected) {
    categoryFields[`${spec.appId}Category`] = spec.name;
    categoryFields[`${spec.appId}SavePath`] = spec.path;
  }
  return { appId: APP_ID, projectRoot: context.projectRoot,
    stage: selected.length > 0 ? "categories-verified" : "login-and-api-verified",
    adminUsername: "admin", passwordFile: status.passwordFile, apiKeyFile: keyFile,
    savePath: SAVE_PATH, tempPath: TEMP_PATH, ...categoryFields };
}

async function ensureCategories(context: SetupContext, status: Record<string, unknown>,
  keyFile: string, authHeaders: Record<string, string>): Promise<SetupRecord> {
  let checkpoint = await context.checkpoint.read();
  if (!checkpoint || !["login-and-api-verified", "category-create-attempted",
    "categories-verified"].includes(checkpoint.stage)
    || checkpoint.data.passwordFile !== status.passwordFile
    || checkpoint.data.apiKeyFile !== keyFile) {
    throw new Error("qBittorrent has no verified login checkpoint before category setup");
  }
  const expected = new Map<string, typeof CATEGORIES[number]>();
  for (const spec of managedCategories(checkpoint.data)) expected.set(spec.appId, spec);
  for (const spec of CATEGORIES) {
    if (status.ownerKind === "shared" && context.installedAppIds.includes(spec.appId)) {
      expected.set(spec.appId, spec);
    }
  }
  if (expected.size === 0) return record(context, status, keyFile);
  let inventory = await categories(context, authHeaders);
  for (const spec of expected.values()) {
    if (matchingCategory(inventory, spec)) continue;
    if (checkpoint.attemptedActions.includes(spec.action)) {
      throw new Error(`qBittorrent ${spec.appId} category create outcome is uncertain; inspect before retrying`);
    }
    const response = await context.http.request({ method: "POST", path: "/api/v2/torrents/createCategory",
      headers: { ...authHeaders, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ category: spec.name, savePath: spec.path }).toString(),
      approval: { action: spec.action, once: true,
        progress: `Create the selected ${spec.appId} category and shared download path` },
      beforeSendCheckpoint: { expectedRevision: checkpoint.revision,
        stage: "category-create-attempted", data: categoryData(checkpoint.data, spec) } });
    // Pinned v5.2.3 returns No Content for a successful category create.
    if (response.status !== 204 || !response.ok) {
      throw new Error(`qBittorrent did not confirm the ${spec.appId} category create`);
    }
    checkpoint = await context.checkpoint.read();
    if (!checkpoint || !checkpoint.attemptedActions.includes(spec.action)) {
      throw new Error(`qBittorrent ${spec.appId} category attempt was not saved`);
    }
    inventory = await categories(context, authHeaders);
    if (!matchingCategory(inventory, spec)) {
      throw new Error(`qBittorrent ${spec.appId} category did not pass exact readback`);
    }
  }
  const selected = [...expected.values()];
  let data = checkpoint.data;
  for (const spec of selected) data = categoryData(data, spec);
  if (checkpoint.stage !== "categories-verified"
    || selected.some((spec) => checkpoint.data[`${spec.appId}Category`] !== spec.name)) {
    checkpoint = await context.checkpoint.compareAndSet({ expectedRevision: checkpoint.revision,
      stage: "categories-verified", data });
    if (checkpoint.stage !== "categories-verified") {
      throw new Error("qBittorrent category verification checkpoint was not saved");
    }
  }
  return record(context, status, keyFile, selected);
}

const adapter: SetupAdapter = {
  appId: APP_ID,
  credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding",
  healthSource: null,
  homarrIntegration: "qBittorrent",
  peerEffects: [
    { peerAppId: "sonarr", description: "Create or verify qBittorrent's tv-sonarr category at /data/torrents/tv-sonarr" },
    { peerAppId: "radarr", description: "Create or verify qBittorrent's movies-radarr category at /data/torrents/movies-radarr" },
  ],
  ready(value) {
    const categoryStage = value.stage === "categories-verified"
      && CATEGORIES.some((spec) => value[`${spec.appId}Category`] === spec.name
        && value[`${spec.appId}SavePath`] === spec.path)
      && CATEGORIES.every((spec) => value[`${spec.appId}Category`] === undefined
        || (value[`${spec.appId}Category`] === spec.name
          && value[`${spec.appId}SavePath`] === spec.path));
    return value.appId === APP_ID
      && (value.stage === "login-and-api-verified" || categoryStage)
      && value.adminUsername === "admin"
      && typeof value.passwordFile === "string" && isAbsolute(value.passwordFile)
      && typeof value.apiKeyFile === "string" && isAbsolute(value.apiKeyFile)
      && value.savePath === SAVE_PATH && value.tempPath === TEMP_PATH;
  },
  async firstRun(context) {
    const status = await exactStatus(context);
    await rejectUntrustedAccess(context, status);
    const password = await context.secrets.readAdminPassword();
    if (password.length < 32 || password.length > 128 || /[\r\n\u0000]/.test(password)) {
      throw new Error("qBittorrent has no valid saved administrator password");
    }
    const digest = createHash("sha256").update(password).digest("hex");
    const session = await context.secrets.readSessionCookies();
    if (Object.keys(session).some((name) => !["session", "mode", "password_digest"].includes(name))
      || (Object.keys(session).length > 0 && (!validSession(session.session)
        || !["temporary", "managed"].includes(session.mode ?? "")
        || session.password_digest !== digest))) {
      throw new Error("qBittorrent private setup session differs from its saved owner credential");
    }
    let cookie: string | null = null;
    let temporarySession = false;
    if (session.session) {
      try {
        const observed = await sessionPreferences(context, status, session.session);
        if (session.mode === "managed" && !configured(observed)) {
          throw new Error("qBittorrent download paths or WebUI username differ from the managed setup");
        }
        // An attempted rotation must reconcile through the saved password,
        // never repeat setPreferences with the old temporary session.
        if (session.mode === "managed" || await context.checkpoint.read() === null) {
          cookie = session.session;
          temporarySession = session.mode === "temporary";
        }
      } catch (error) {
        if (!(error instanceof SessionRejected)) throw error;
      }
    }
    if (cookie === null) {
      let action = "qbittorrent-verify-managed-login";
      if ((await context.checkpoint.read())?.stage === "identity-update-attempted") {
        action = "qbittorrent-verify-new-login";
      }
      cookie = await login(context, status, password, action);
    }
    if (cookie === null) {
      const prior = await context.checkpoint.read();
      if (prior !== null) {
        throw new Error("qBittorrent managed login failed after a setup attempt; inspect before retrying");
      }
      const temporary = await context.secrets.readQbittorrentTemporaryPassword();
      cookie = await login(context, status, temporary, "qbittorrent-verify-temporary-login");
      if (cookie === null) throw new Error("qBittorrent rejected its current-start temporary password");
      await sessionPreferences(context, status, cookie);
      await context.secrets.writeSessionCookies({ session: cookie, mode: "temporary", password_digest: digest });
      temporarySession = true;
    }
    if (temporarySession) {
      const response = await context.http.request({ method: "POST", path: "/api/v2/app/setPreferences",
        headers: { ...headers(status, cookie), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ json: JSON.stringify({ web_ui_username: "admin",
          web_ui_password: password, save_path: SAVE_PATH, temp_path: TEMP_PATH,
          temp_path_enabled: true, bypass_local_auth: false,
          bypass_auth_subnet_whitelist_enabled: false }) }).toString(),
        approval: { action: "qbittorrent-set-managed-auth", once: true,
          progress: "Set the generated qBittorrent administrator password and selected shared download paths" },
        beforeSendCheckpoint: { expectedRevision: null, stage: "identity-update-attempted",
          data: { passwordFile: status.passwordFile as string } } });
      if (response.status !== 200 && response.status !== 204) {
        throw new Error("qBittorrent did not confirm its managed WebUI preference update");
      }
      cookie = await login(context, status, password, "qbittorrent-verify-new-login");
      if (cookie === null) throw new Error("qBittorrent rejected the saved administrator password after setup");
    }
    const sessionHeaders = headers(status, cookie);
    let prefs = await sessionPreferences(context, status, cookie);
    if (!configured(prefs)) {
      throw new Error("qBittorrent download paths or WebUI username differ from the managed setup");
    }
    await context.secrets.writeSessionCookies({ session: cookie, mode: "managed", password_digest: digest });
    let key = prefs.web_ui_api_key;
    if (key === "") {
      const prior = await context.checkpoint.read();
      if (prior?.attemptedActions.includes("qbittorrent-create-api-key")) {
        throw new Error("qBittorrent API-key creation was attempted but no key is readable; inspect before retrying");
      }
      const response = await context.http.request({ method: "POST", path: "/api/v2/app/rotateAPIKey",
        headers: sessionHeaders,
        approval: { action: "qbittorrent-create-api-key", once: true,
          progress: "Create a qBittorrent WebUI API key only because none exists" },
        beforeSendCheckpoint: { expectedRevision: prior?.revision ?? null,
          stage: "api-key-create-attempted", data: { passwordFile: status.passwordFile as string } } });
      if (response.status !== 200) throw new Error("qBittorrent did not confirm API-key creation");
      // Pinned v5.2.3 returns the durable key in JSON. Capture it before
      // another network request so an uncertain readback cannot lose it.
      const created = object(await response.json(), "qBittorrent API-key creation").apiKey;
      if (!validKey(created)) throw new Error("qBittorrent returned no usable created API key");
      const existing = await context.secrets.readApiKey();
      if (existing !== null && existing !== created) {
        throw new Error("qBittorrent API key changed; inspect before replacing the saved key");
      }
      if (existing === null) {
        const path = await context.secrets.writeApiKey(created);
        if (typeof path !== "string" || !isAbsolute(path)) {
          throw new Error("qBittorrent private API-key path is unavailable");
        }
      }
      prefs = await preferences(context, sessionHeaders);
      key = prefs.web_ui_api_key;
      if (key !== created) throw new Error("qBittorrent created API key did not match its readback");
    }
    if (!validKey(key)) throw new Error("qBittorrent returned no usable WebUI API key");
    const saved = await context.secrets.readApiKey();
    if (saved !== null && saved !== key) {
      throw new Error("qBittorrent API key changed; inspect before replacing the saved key");
    }
    const keyFile = saved === null ? await context.secrets.writeApiKey(key)
      : await context.secrets.apiKeyPath();
    if (typeof keyFile !== "string" || !isAbsolute(keyFile)) {
      throw new Error("qBittorrent private API-key path is unavailable");
    }
    await version(context, { ...headers(status), Authorization: `Bearer ${key}` });
    await rejectUntrustedAccess(context, status, key);
    const prior = await context.checkpoint.read();
    if (prior?.stage !== "login-and-api-verified" && prior?.stage !== "category-create-attempted"
      && prior?.stage !== "categories-verified") {
      await context.checkpoint.compareAndSet({ expectedRevision: prior?.revision ?? null,
        stage: "login-and-api-verified", data: { passwordFile: status.passwordFile as string,
          apiKeyFile: keyFile } });
    }
    return ensureCategories(context, status, keyFile,
      { ...headers(status), Authorization: `Bearer ${key}` });
  },
  async inspect(context) {
    const status = await exactStatus(context);
    const key = await context.secrets.readApiKey();
    const keyFile = await context.secrets.apiKeyPath();
    if (!validKey(key) || typeof keyFile !== "string"
      || keyFile !== join(status.privateFiles as string, `${APP_ID}-api-key`)) {
      throw new Error("qBittorrent has no matching private API key");
    }
    const checkpoint = await context.checkpoint.read();
    if (!checkpoint || !["login-and-api-verified", "categories-verified"].includes(checkpoint.stage)
      || checkpoint.data.passwordFile !== status.passwordFile
      || checkpoint.data.apiKeyFile !== keyFile) {
      throw new Error("qBittorrent has no matching saved managed-login checkpoint");
    }
    const authHeaders = { ...headers(status), Authorization: `Bearer ${key}` };
    await rejectUntrustedAccess(context, status);
    await rejectUntrustedAccess(context, status, key);
    await version(context, authHeaders);
    const prefs = await preferences(context, authHeaders);
    if (!configured(prefs) || prefs.web_ui_api_key !== key) {
      throw new Error("qBittorrent managed API key or download paths no longer match");
    }
    const selected = managedCategories(checkpoint.data);
    if (checkpoint.stage === "categories-verified" && selected.length === 0) {
      throw new Error("qBittorrent has a category checkpoint without a managed category");
    }
    if (checkpoint.stage === "login-and-api-verified" && selected.length > 0) {
      throw new Error("qBittorrent has unfinished managed category selection");
    }
    if (selected.length > 0) {
      const inventory = await categories(context, authHeaders);
      for (const spec of selected) {
        if (!matchingCategory(inventory, spec)) {
          throw new Error(`qBittorrent ${spec.appId} category is no longer present`);
        }
      }
    }
    return record(context, status, keyFile, selected);
  },
};

export default adapter;
