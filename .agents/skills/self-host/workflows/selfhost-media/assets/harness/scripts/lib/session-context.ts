import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveSessionAccess,
  SESSION_ACCESS_SERVICES,
  sessionSshTunnel,
  validatePrivateProxyOrigin,
} from "./session-access.ts";
import { curlFetch, enableCurlHttp } from "./curl-http.ts";

const SCRIPT_LIB_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = realpathSync(resolve(SCRIPT_LIB_DIR, "../.."));
export const LEGACY_STANDARD_USERNAME = "admin";
export const SESSION_PASSWORD_SCHEME = "hmac-v1";

const SESSION_PASSWORD_DERIVATION_DOMAIN =
  "auto-stack/media-harness/session-password/v1";

const REQUIRED_MANIFEST_KEYS = new Set([
  "RUN_ID",
  "COMPOSE_PROJECT_NAME",
  "SESSION_ROOT",
  "AGENT_BROWSER_SESSION",
  "PUID",
  "PGID",
  "TZ",
  "PROWLARR_PORT",
  "RADARR_PORT",
  "SONARR_PORT",
  "QBITTORRENT_PORT",
  "JELLYFIN_PORT",
  "SEERR_PORT",
  "HOMARR_PORT",
]);
const MANIFEST_KEYS = new Set([
  ...REQUIRED_MANIFEST_KEYS,
  "ADMIN_USERNAME",
  "SESSION_PASSWORD_SCHEME",
  "HOMARR_BIND_ADDRESS",
  "HOMARR_ADVERTISED_HOST",
]);

const SECRET_KEYS = new Set([
  "HOMARR_ENCRYPTION_KEY",
  "SONARR_API_KEY",
  "RADARR_API_KEY",
  "PROWLARR_API_KEY",
  "SEERR_API_KEY",
]);

const OPTIONAL_CONTROL_ENV_KEYS = new Set([
  "HOMARR_API_KEY",
]);

const CREDENTIAL_VIEW_KEYS = new Set([
  "PROWLARR_URL",
  "PROWLARR_USERNAME",
  "PROWLARR_PASSWORD",
  "RADARR_URL",
  "RADARR_USERNAME",
  "RADARR_PASSWORD",
  "SONARR_URL",
  "SONARR_USERNAME",
  "SONARR_PASSWORD",
  "QBITTORRENT_URL",
  "QBITTORRENT_USERNAME",
  "QBITTORRENT_PASSWORD",
  "JELLYFIN_URL",
  "JELLYFIN_USERNAME",
  "JELLYFIN_PASSWORD",
  "SEERR_URL",
  "SEERR_USERNAME",
  "SEERR_PASSWORD",
  "HOMARR_URL",
  "HOMARR_USERNAME",
  "HOMARR_PASSWORD",
]);

const MANAGED_ENV_KEYS = new Set([
  ...MANIFEST_KEYS,
  ...SECRET_KEYS,
  ...OPTIONAL_CONTROL_ENV_KEYS,
  ...CREDENTIAL_VIEW_KEYS,
]);

const PORT_KEYS = [
  "PROWLARR_PORT",
  "RADARR_PORT",
  "SONARR_PORT",
  "QBITTORRENT_PORT",
  "JELLYFIN_PORT",
  "SEERR_PORT",
  "HOMARR_PORT",
];

function fail(message) {
  throw new Error(message);
}

function sanitizeManagedProcessEnvironment() {
  for (const key of MANAGED_ENV_KEYS) {
    delete process.env[key];
  }
}

export function sanitizedChildEnvironment() {
  const environment = { ...process.env };
  for (const key of MANAGED_ENV_KEYS) {
    delete environment[key];
  }
  return environment;
}

export function validateRunId(runId) {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(runId)) {
    fail("invalid RUN_ID");
  }
}

export function classifySessionPasswordScheme(manifest) {
  if (!manifest || typeof manifest !== "object") {
    fail("manifest password scheme is invalid");
  }
  const scheme = manifest.SESSION_PASSWORD_SCHEME;
  if (scheme === undefined) {
    return "legacy";
  }
  if (scheme !== SESSION_PASSWORD_SCHEME) {
    fail("manifest password scheme is invalid");
  }
  return scheme;
}

export function requireSessionPasswordScheme(session) {
  if (
    !session
    || typeof session !== "object"
    || classifySessionPasswordScheme(session.manifest) !== SESSION_PASSWORD_SCHEME
  ) {
    fail("session password scheme requires recreation");
  }
}

export function deriveSessionPassword(session) {
  if (!session || typeof session !== "object" || !session.secrets) {
    fail("session password source is invalid");
  }
  requireSessionPasswordScheme(session);
  validateRunId(session.runId);
  const encryptionKey = session.secrets.HOMARR_ENCRYPTION_KEY;
  if (typeof encryptionKey !== "string" || !/^[0-9a-f]{64}$/.test(encryptionKey)) {
    fail("session password source is invalid");
  }
  const digest = createHmac("sha256", Buffer.from(encryptionKey, "hex"))
    .update(SESSION_PASSWORD_DERIVATION_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(session.runId, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `Autostack-${digest}!`;
}

export function validateAdminUsername(username) {
  if (typeof username !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(username)) {
    fail("admin username is invalid");
  }
  return username;
}

export function sessionUsername(session) {
  if (!session || typeof session !== "object" || !session.manifest) {
    fail("session username source is invalid");
  }
  const username = session.manifest.ADMIN_USERNAME;
  if (username === undefined) {
    return LEGACY_STANDARD_USERNAME;
  }
  return validateAdminUsername(username);
}

export function validateBrowserPageUrl(session, rawUrl) {
  if (typeof rawUrl !== "string" || Buffer.byteLength(rawUrl, "utf8") > 2_048) {
    fail("browser page URL is invalid");
  }
  let pageUrl;
  try {
    pageUrl = new URL(rawUrl.trim());
  } catch {
    fail("browser page URL is invalid");
  }
  const allowedPorts = new Set(PORT_KEYS.map((key) => String(session?.manifest?.[key] ?? "")));
  if (
    pageUrl.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(pageUrl.hostname)
    || pageUrl.username !== ""
    || pageUrl.password !== ""
    || !allowedPorts.has(pageUrl.port)
  ) {
    fail("browser page is outside the managed session");
  }
  return pageUrl.href;
}

function assertPrivateControlFile(filePath, expectedParent, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} must be a regular file`);
  }
  if (dirname(filePath) !== expectedParent || realpathSync(filePath) !== filePath) {
    fail(`${label} escaped its session`);
  }
  if (stat.nlink !== 1) {
    fail(`${label} must not be hard-linked`);
  }
  assertOwnedMode(stat, 0o600, label);
  return stat;
}

function assertOwnedMode(stat, expectedMode, label) {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    fail(`${label} ownership cannot be verified`);
  }
  if (stat.uid !== process.getuid() || stat.gid !== process.getgid()) {
    fail(`${label} has unexpected ownership`);
  }
  if ((stat.mode & 0o7777) !== expectedMode) {
    fail(`${label} has an unsafe mode`);
  }
}

function validatedSessionsDir() {
  const sessionsDir = join(REPO_ROOT, ".sessions");
  const sessionsStat = lstatSync(sessionsDir);
  if (!sessionsStat.isDirectory() || sessionsStat.isSymbolicLink()) {
    fail(".sessions must be a real directory");
  }
  if (realpathSync(sessionsDir) !== sessionsDir || dirname(sessionsDir) !== REPO_ROOT) {
    fail(".sessions escaped the repository");
  }
  assertOwnedMode(sessionsStat, 0o700, ".sessions");

  const lockFile = join(sessionsDir, ".ports.lock");
  const lockStat = lstatSync(lockFile);
  if (!lockStat.isFile() || lockStat.isSymbolicLink()) {
    fail("session lock must be a regular file");
  }
  if (lockStat.nlink !== 1) {
    fail("session lock must not be hard-linked");
  }
  if (realpathSync(lockFile) !== lockFile) {
    fail("session lock escaped .sessions");
  }
  assertOwnedMode(lockStat, 0o600, "session lock");
  return sessionsDir;
}

function parseRestrictedEnv(
  filePath,
  expectedParent,
  allowedKeys,
  valuePattern,
  label,
  requiredKeys = allowedKeys,
) {
  assertPrivateControlFile(filePath, expectedParent, label);
  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split("\n");

  if (lines.at(-1) === "") {
    lines.pop();
  }

  const values = Object.create(null);
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      fail(`${label} contains an invalid entry`);
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!allowedKeys.has(key) || Object.hasOwn(values, key)) {
      fail(`${label} contains an unexpected entry`);
    }
    if (!valuePattern.test(value)) {
      fail(`${label} contains an invalid value`);
    }

    values[key] = value;
  }

  for (const key of requiredKeys) {
    if (!Object.hasOwn(values, key)) {
      fail(`${label} is incomplete`);
    }
  }

  return values;
}

export function loadSession(runId) {
  sanitizeManagedProcessEnvironment();
  validateRunId(runId);

  const sessionsDir = validatedSessionsDir();
  const requestedSessionDir = join(sessionsDir, runId);
  const sessionStat = lstatSync(requestedSessionDir);
  if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
    fail("session directory is invalid");
  }
  assertOwnedMode(sessionStat, 0o700, "session directory");

  const sessionDir = realpathSync(requestedSessionDir);
  if (dirname(sessionDir) !== sessionsDir) {
    fail("session escaped .sessions");
  }

  const manifestFile = join(sessionDir, "manifest.env");
  const secretsFile = join(sessionDir, "secrets.env");
  const manifest = parseRestrictedEnv(
    manifestFile,
    sessionDir,
    MANIFEST_KEYS,
    /^[a-zA-Z0-9_./:-]+$/,
    "manifest",
    REQUIRED_MANIFEST_KEYS,
  );
  const secrets = parseRestrictedEnv(
    secretsFile,
    sessionDir,
    SECRET_KEYS,
    /^[0-9a-f]+$/,
    "secrets file",
  );

  if (manifest.RUN_ID !== runId) {
    fail("manifest RUN_ID mismatch");
  }
  if (manifest.SESSION_ROOT !== sessionDir) {
    fail("manifest SESSION_ROOT mismatch");
  }
  if (manifest.COMPOSE_PROJECT_NAME !== `autostack-${runId}`) {
    fail("manifest project mismatch");
  }
  if (manifest.AGENT_BROWSER_SESSION !== `auto-stack-${runId}`) {
    fail("manifest browser session mismatch");
  }
  classifySessionPasswordScheme(manifest);
  if (!/^\d+$/.test(manifest.PUID) || !/^\d+$/.test(manifest.PGID)) {
    fail("manifest user identifiers are invalid");
  }

  const seenPorts = new Set();
  for (const key of PORT_KEYS) {
    const port = Number(manifest[key]);
    if (!Number.isInteger(port) || port < 20000 || port > 44999) {
      fail("manifest port is outside the managed range");
    }
    if (seenPorts.has(port)) {
      fail("manifest contains a duplicate port");
    }
    seenPorts.add(port);
  }

  if (!/^[0-9a-f]{64}$/.test(secrets.HOMARR_ENCRYPTION_KEY)) {
    fail("Homarr encryption key is invalid");
  }
  for (const key of [
    "SONARR_API_KEY",
    "RADARR_API_KEY",
    "PROWLARR_API_KEY",
    "SEERR_API_KEY",
  ]) {
    if (!/^[0-9a-f]{32}$/.test(secrets[key])) {
      fail("session API key is invalid");
    }
  }

  const session = Object.freeze({
    runId,
    sessionDir,
    manifestFile,
    secretsFile,
    manifest: Object.freeze(manifest),
    secrets: Object.freeze(secrets),
  });
  sessionAccess(session);
  return session;
}

export function sessionAccess(session) {
  const bindAddress = session.manifest.HOMARR_BIND_ADDRESS ?? "127.0.0.1";
  if (bindAddress === "127.0.0.1" && session.manifest.HOMARR_ADVERTISED_HOST !== undefined) {
    fail("Homarr advertised host requires a non-loopback bind");
  }
  const accessConfig = loadSessionAccessConfig(session);
  return resolveSessionAccess({
    advertisedHost: session.manifest.HOMARR_ADVERTISED_HOST,
    bindAddress,
    directServices: ["homarr"],
    ports: session.manifest,
    reverseProxyUrls: accessConfig.reverseProxyUrls,
  });
}

export function loadSessionAccessConfig(session) {
  const artifactDirectory = join(session.sessionDir, "artifacts");
  const filePath = join(artifactDirectory, "access.json");
  if (!existsSync(filePath)) {
    return Object.freeze({ reverseProxyUrls: Object.freeze({}), routes: Object.freeze({}) });
  }
  assertPrivateControlFile(filePath, artifactDirectory, "session access file");
  const contents = readFileSync(filePath, "utf8");
  if (Buffer.byteLength(contents, "utf8") > 8_192) {
    fail("session access file is too large");
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    fail("session access file is invalid");
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || parsed.schemaVersion !== 1
    || !parsed.routes
    || typeof parsed.routes !== "object"
    || Array.isArray(parsed.routes)
    || Object.keys(parsed).some((key) => !["schemaVersion", "routes"].includes(key))
  ) {
    fail("session access file is invalid");
  }
  const reverseProxyUrls = {};
  const routes = {};
  for (const [service, route] of Object.entries(parsed.routes)) {
    if (!SESSION_ACCESS_SERVICES.includes(service)) {
      fail("session access file contains an unknown service");
    }
    if (
      !route
      || typeof route !== "object"
      || Array.isArray(route)
      || typeof route.origin !== "string"
      || typeof route.privateDnsConfirmed !== "boolean"
      || Object.keys(route).some((key) => !["origin", "privateDnsConfirmed"].includes(key))
    ) {
      fail("session access file contains an invalid route");
    }
    reverseProxyUrls[service] = validatePrivateProxyOrigin(
      route.origin,
      service,
      route.privateDnsConfirmed,
    );
    routes[service] = Object.freeze({
      origin: reverseProxyUrls[service],
      privateDnsConfirmed: route.privateDnsConfirmed,
    });
  }
  return Object.freeze({
    reverseProxyUrls: Object.freeze(reverseProxyUrls),
    routes: Object.freeze(routes),
  });
}

export function configureSessionProxyAccess(
  session,
  action,
  service,
  rawOrigin,
  privateDnsConfirmed = false,
) {
  requireSessionPasswordScheme(session);
  if (!SESSION_ACCESS_SERVICES.includes(service)) {
    fail("session access service is invalid");
  }
  const existing = loadSessionAccessConfig(session);
  const routes = {};
  for (const [existingService, route] of Object.entries(existing.routes)) {
    routes[existingService] = { ...route };
  }
  if (action === "set") {
    const origin = validatePrivateProxyOrigin(rawOrigin, service, privateDnsConfirmed);
    routes[service] = { origin, privateDnsConfirmed };
  } else if (action === "clear") {
    delete routes[service];
  } else {
    fail("session access action is invalid");
  }
  replacePrivateArtifact(
    session,
    "access.json",
    `${JSON.stringify({ schemaVersion: 1, routes }, null, 2)}\n`,
  );
  loadSessionAccessConfig(session);
  return Object.freeze({
    count: Object.keys(routes).length,
    filePath: join(session.sessionDir, "artifacts", "access.json"),
  });
}

export function validateHomarrApiKey(apiKey) {
  if (typeof apiKey !== "string" || Buffer.byteLength(apiKey, "utf8") > 496) {
    fail("Homarr API key is invalid");
  }
  if (!/^[A-Za-z0-9_-]{1,192}\.[A-Za-z0-9_-]{16,400}$/.test(apiKey)) {
    fail("Homarr API key is invalid");
  }
  return apiKey;
}

export function loadHomarrApiKey(session, options = {}) {
  const optional = options.optional === true;
  const filePath = join(session.sessionDir, "homarr-api-key.env");
  try {
    lstatSync(filePath);
  } catch (error) {
    if (optional && error?.code === "ENOENT") {
      return null;
    }
    fail("Homarr API key file is missing");
  }

  assertPrivateControlFile(filePath, session.sessionDir, "Homarr API key file");
  const contents = readFileSync(filePath);
  if (contents.byteLength > 512) {
    fail("Homarr API key file is too large");
  }
  const match = contents.toString("utf8").match(
    /^HOMARR_API_KEY=([A-Za-z0-9_-]{1,192}\.[A-Za-z0-9_-]{16,400})\n$/,
  );
  if (!match) {
    fail("Homarr API key file is invalid");
  }

  return Object.freeze({
    filePath,
    apiKey: validateHomarrApiKey(match[1]),
  });
}

export function storeHomarrApiKey(session, apiKey) {
  validateHomarrApiKey(apiKey);
  loadHomarrApiKey(session, { optional: true });
  const destination = join(session.sessionDir, "homarr-api-key.env");
  const replacement = join(
    session.sessionDir,
    `.homarr-api-key.env.${randomBytes(12).toString("hex")}`,
  );
  let descriptor;
  let cleanupArmed = false;
  try {
    descriptor = openSync(replacement, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    const pathStat = assertPrivateControlFile(
      replacement,
      session.sessionDir,
      "replacement Homarr API key file",
    );
    const descriptorStat = fstatSync(descriptor);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
      fail("replacement Homarr API key file changed after creation");
    }
    cleanupArmed = true;
    writeFileSync(descriptor, `HOMARR_API_KEY=${apiKey}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertPrivateControlFile(
      replacement,
      session.sessionDir,
      "replacement Homarr API key file",
    );
    renameSync(replacement, destination);
    cleanupArmed = false;
    loadHomarrApiKey(session);
    const directoryDescriptor = openSync(session.sessionDir, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (cleanupArmed && existsSync(replacement)) {
      assertPrivateControlFile(
        replacement,
        session.sessionDir,
        "replacement Homarr API key file",
      );
      unlinkSync(replacement);
    }
  }
}

export function connectionsContents(session, homarrApiKey) {
  const username = sessionUsername(session);
  const lines = [`RUN_ID=${session.runId}`];
  for (const [service, portKey, apiKey] of [
    ["PROWLARR", "PROWLARR_PORT", session.secrets.PROWLARR_API_KEY],
    ["RADARR", "RADARR_PORT", session.secrets.RADARR_API_KEY],
    ["SONARR", "SONARR_PORT", session.secrets.SONARR_API_KEY],
    ["QBITTORRENT", "QBITTORRENT_PORT", null],
    ["JELLYFIN", "JELLYFIN_PORT", null],
    ["SEERR", "SEERR_PORT", session.secrets.SEERR_API_KEY],
    ["HOMARR", "HOMARR_PORT", homarrApiKey],
  ]) {
    lines.push(
      `${service}_URL=http://localhost:${session.manifest[portKey]}`,
      `${service}_USERNAME=${username}`,
    );
    if (apiKey !== null && apiKey !== "") {
      lines.push(`${service}_API_KEY=${apiKey}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function validateConnectionsFile(session, options = {}) {
  const optional = options.optional === true;
  const expectedContents = options.expectedContents;
  const filePath = join(session.sessionDir, "connections.env");
  try {
    lstatSync(filePath);
  } catch (error) {
    if (optional && error?.code === "ENOENT") {
      return null;
    }
    fail("connections file is missing");
  }

  assertPrivateControlFile(filePath, session.sessionDir, "connections file");
  const contents = readFileSync(filePath, "utf8");
  if (Buffer.byteLength(contents, "utf8") > 8_192) {
    fail("connections file is too large");
  }
  if (expectedContents !== undefined && contents !== expectedContents) {
    fail("connections file did not persist correctly");
  }

  const keys = new Set();
  const lines = contents.endsWith("\n")
    ? contents.slice(0, -1).split("\n")
    : [];
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      fail("connections file contains an invalid entry");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (keys.has(key)) {
      fail("connections file contains a duplicate entry");
    }
    keys.add(key);

    if (key === "RUN_ID") {
      if (value !== session.runId) {
        fail("connections file RUN_ID mismatch");
      }
      continue;
    }
    if (key.endsWith("_URL")) {
      if (!/^http:\/\/localhost:\d+$/.test(value)) {
        fail("connections file contains an invalid URL");
      }
      continue;
    }
    if (key.endsWith("_USERNAME")) {
      if (value !== sessionUsername(session)) {
        fail("connections file contains an invalid username");
      }
      continue;
    }
    if (key === "HOMARR_API_KEY") {
      validateHomarrApiKey(value);
      continue;
    }
    if (key.endsWith("_API_KEY")) {
      if (!/^[0-9a-f]{32}$/.test(value)) {
        fail("connections file contains an invalid API key");
      }
      continue;
    }
    fail("connections file contains an unexpected entry");
  }

  const expectedKeys = new Set([
    "RUN_ID",
    ...["PROWLARR", "RADARR", "SONARR", "QBITTORRENT", "JELLYFIN", "SEERR", "HOMARR"]
      .flatMap((service) => [`${service}_URL`, `${service}_USERNAME`]),
    "PROWLARR_API_KEY",
    "RADARR_API_KEY",
    "SONARR_API_KEY",
    "SEERR_API_KEY",
  ]);
  if (keys.has("HOMARR_API_KEY")) {
    expectedKeys.add("HOMARR_API_KEY");
  }
  if (keys.size !== expectedKeys.size) {
    fail("connections file has an unexpected schema");
  }
  for (const key of expectedKeys) {
    if (!keys.has(key)) {
      fail("connections file is incomplete");
    }
  }
  return Object.freeze({ filePath });
}

function removeLegacyCredentialsFile(session) {
  const filePath = join(session.sessionDir, "credentials.env");
  try {
    const stat = assertPrivateControlFile(
      filePath,
      session.sessionDir,
      "legacy credentials file",
    );
    if (stat.size > 8_192) {
      fail("legacy credentials file is too large");
    }
    unlinkSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export function writeConnectionsFile(session, homarrApiKey = "") {
  requireSessionPasswordScheme(session);
  validateConnectionsFile(session, { optional: true });
  const contents = connectionsContents(session, homarrApiKey);
  const destination = join(session.sessionDir, "connections.env");
  const replacement = join(
    session.sessionDir,
    `.connections.env.${randomBytes(12).toString("hex")}`,
  );
  let descriptor;
  let cleanupArmed = false;
  try {
    descriptor = openSync(replacement, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    const pathStat = assertPrivateControlFile(
      replacement,
      session.sessionDir,
      "replacement connections file",
    );
    const descriptorStat = fstatSync(descriptor);
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
      fail("replacement connections file changed after creation");
    }
    cleanupArmed = true;
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertPrivateControlFile(
      replacement,
      session.sessionDir,
      "replacement connections file",
    );
    renameSync(replacement, destination);
    cleanupArmed = false;
    validateConnectionsFile(session, { expectedContents: contents });
    removeLegacyCredentialsFile(session);
    const directoryDescriptor = openSync(session.sessionDir, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (cleanupArmed && existsSync(replacement)) {
      assertPrivateControlFile(
        replacement,
        session.sessionDir,
        "replacement connections file",
      );
      unlinkSync(replacement);
    }
  }

  return Object.freeze({
    filePath: destination,
    homarrApiKeyStored: homarrApiKey !== "",
  });
}

export function writeSessionConnections(runId) {
  const session = loadSession(runId);
  const homarr = loadHomarrApiKey(session, { optional: true });
  return writeConnectionsFile(session, homarr?.apiKey ?? "");
}

export function printSessionConnectionsSummary(result) {
  let homarrStatus = "pending capture";
  if (result.homarrApiKeyStored) {
    homarrStatus = "included";
  }
  process.stdout.write([
    "PASS private connections file refreshed",
    `Connections file: ${result.filePath}`,
    "Services: Homarr dashboard/MCP; Seerr requests; Sonarr shows; Radarr movies; Prowlarr indexers; qBittorrent downloads; Jellyfin playback.",
    `Stored in connections.env: 7 service URLs, 7 admin usernames, 4 service API keys; Homarr API key ${homarrStatus}. connections.env contains no password.`,
    "",
  ].join("\n"));
}

export function handoffContents(session) {
  requireSessionPasswordScheme(session);
  return [
    "PASS user access handoff ready",
    `Admin username: ${sessionUsername(session)}`,
    `Admin password: ${deriveSessionPassword(session)}`,
    "",
  ].join("\n");
}

function handoffActions() {
  return [
    "At export time, recorded the run-scoped session identity, storage, and ports",
    "Derived the run administrator password and collected managed service API keys",
    "At export time, refreshed the reusable connections file from managed session state",
    "At export time, included the Homarr API key only when it had already been captured",
    "At export time, wrote this private handoff and a separate redacted report",
  ];
}

function handoffLocations(session) {
  return {
    sessionRoot: session.sessionDir,
    manifest: session.manifestFile,
    secrets: session.secretsFile,
    connections: join(session.sessionDir, "connections.env"),
    access: join(session.sessionDir, "artifacts", "access.json"),
    boardAccess: optionalKnownArtifact(session, "board-access.json"),
    mcpClient: optionalKnownArtifact(session, "mcp-client.json"),
    config: join(session.sessionDir, "config"),
    data: join(session.sessionDir, "data"),
    artifacts: join(session.sessionDir, "artifacts"),
  };
}

function optionalKnownArtifact(session, filename) {
  const artifactDirectory = join(session.sessionDir, "artifacts");
  const filePath = join(artifactDirectory, filename);
  try {
    assertPrivateControlFile(filePath, artifactDirectory, filename);
    return filePath;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function loadBoardAccessMetadata(session) {
  const artifactDirectory = join(session.sessionDir, "artifacts");
  const filePath = join(artifactDirectory, "board-access.json");
  if (!existsSync(filePath)) {
    return null;
  }
  assertPrivateControlFile(filePath, artifactDirectory, "board access metadata");
  const contents = readFileSync(filePath, "utf8");
  if (Buffer.byteLength(contents, "utf8") > 8_192) {
    fail("board access metadata is too large");
  }
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    fail("board access metadata is invalid");
  }
  const allowedKeys = ["schemaVersion", "board", "notebook", "urls", "evidence"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowedKeys.includes(key))
    || Object.keys(value).length !== allowedKeys.length
    || value.schemaVersion !== 1
    || !value.board || typeof value.board !== "object"
    || typeof value.board.id !== "string" || typeof value.board.name !== "string"
    || typeof value.board.path !== "string"
    || value.board.isPublic !== false
    || Object.keys(value.board).some((key) => !["id", "name", "path", "isPublic"].includes(key))
    || Object.keys(value.board).length !== 4
    || !value.notebook || value.notebook.status !== "verified-at-recording"
    || value.notebook.marker !== "Your homelab at a glance"
    || typeof value.notebook.verifiedAt !== "string" || Number.isNaN(Date.parse(value.notebook.verifiedAt))
    || Object.keys(value.notebook).some((key) => !["status", "marker", "verifiedAt"].includes(key))
    || Object.keys(value.notebook).length !== 3
    || !value.urls || typeof value.urls.local !== "string"
    || !(value.urls.user === null || typeof value.urls.user === "string")
    || Object.keys(value.urls).some((key) => !["local", "user"].includes(key))
    || Object.keys(value.urls).length !== 2
    || value.evidence !== "private board and notebook read back from Homarr API") {
    fail("board access metadata is invalid");
  }
  const expectedPath = `/boards/${encodeURIComponent(value.board.name)}`;
  const access = sessionAccess(session);
  const expectedLocal = `${access.services.homarr.browserUrl}${expectedPath}`;
  let expectedUser = null;
  if (access.services.homarr.reachableUrl !== null) {
    expectedUser = `${access.services.homarr.reachableUrl}${expectedPath}`;
  }
  if (value.board.path !== expectedPath) fail("board access metadata path is invalid");
  return Object.freeze({ ...value, urls: Object.freeze({ local: expectedLocal, user: expectedUser }) });
}

export function writeBoardAccessMetadata(session, board) {
  if (!board || typeof board !== "object" || typeof board.id !== "string"
    || typeof board.name !== "string" || board.name.length < 1 || board.name.length > 255
    || board.isPublic !== false) {
    fail("verified board metadata is invalid");
  }
  const access = sessionAccess(session);
  const path = `/boards/${encodeURIComponent(board.name)}`;
  let userUrl = null;
  if (access.services.homarr.reachableUrl !== null) {
    userUrl = `${access.services.homarr.reachableUrl}${path}`;
  }
  replacePrivateArtifact(session, "board-access.json", `${JSON.stringify({
    schemaVersion: 1,
    board: { id: board.id, name: board.name, path, isPublic: false },
    notebook: { status: "verified-at-recording", marker: "Your homelab at a glance", verifiedAt: new Date().toISOString() },
    urls: { local: `${access.services.homarr.browserUrl}${path}`, user: userUrl },
    evidence: "private board and notebook read back from Homarr API",
  }, null, 2)}\n`);
  return loadBoardAccessMetadata(session);
}

export function privateHandoffContents(session, homarrApiKey = "") {
  requireSessionPasswordScheme(session);
  const username = sessionUsername(session);
  const password = deriveSessionPassword(session);
  const access = sessionAccess(session);
  const sshTunnel = sessionSshTunnel(access);
  const boardAccess = loadBoardAccessMetadata(session);
  const mcpClientPath = optionalKnownArtifact(session, "mcp-client.json");
  const services = Object.create(null);
  for (const [service, portKey, internalUrl, apiKey] of [
    ["prowlarr", "PROWLARR_PORT", "http://prowlarr:9696", session.secrets.PROWLARR_API_KEY],
    ["radarr", "RADARR_PORT", "http://radarr:7878", session.secrets.RADARR_API_KEY],
    ["sonarr", "SONARR_PORT", "http://sonarr:8989", session.secrets.SONARR_API_KEY],
    ["qbittorrent", "QBITTORRENT_PORT", `http://qbittorrent:${session.manifest.QBITTORRENT_PORT}`, null],
    ["jellyfin", "JELLYFIN_PORT", "http://jellyfin:8096", null],
    ["seerr", "SEERR_PORT", "http://seerr:5055", session.secrets.SEERR_API_KEY],
    ["homarr", "HOMARR_PORT", "http://homarr:7575", homarrApiKey || null],
  ]) {
    services[service] = {
      url: `http://localhost:${session.manifest[portKey]}`,
      localUrl: access.services[service].browserUrl,
      userUrl: access.services[service].reachableUrl,
      internalUrl,
      configPath: join(session.sessionDir, "config", service),
      username,
      password,
      apiKey,
    };
  }
  return `${JSON.stringify({
    runId: session.runId,
    warning: "PRIVATE: contains passwords and API keys; keep mode 0600",
    acceptance: "unverified by handoff; consult separate acceptance evidence when present",
    actions: handoffActions(),
    locations: handoffLocations(session),
    access: {
      note: "Configured URLs are not client-side reachability evidence",
      sshTunnel,
      board: boardAccess,
    },
    homarrNotebook: boardAccess === null ? "not verified" : boardAccess.notebook.status,
    mcp: {
      profile: "expected read-only bridge profile; candidate client artifact is not revalidated by handoff",
      bridge: join(REPO_ROOT, "scripts", "homarr-mcp-bridge.ts"),
      clientConfig: mcpClientPath,
      instruction: mcpClientPath === null
        ? "Run scripts/session.sh mcp-config RUN_ID to create the uninstalled client fragment"
        : "Re-run mcp-config to validate and refresh this candidate before separately authorized installation",
    },
    services,
  }, null, 2)}\n`;
}

export function redactedHandoffContents(session, homarrApiKey = "") {
  requireSessionPasswordScheme(session);
  const locations = handoffLocations(session);
  const access = sessionAccess(session);
  const sshTunnel = sessionSshTunnel(access);
  const boardAccess = loadBoardAccessMetadata(session);
  const mcpClientPath = optionalKnownArtifact(session, "mcp-client.json");
  const reachableLines = SESSION_ACCESS_SERVICES.map((service) => {
    const reachableUrl = access.services[service].reachableUrl;
    if (reachableUrl === null) {
      return `- ${service}: SSH forward required`;
    }
    return `- ${service}: \`${reachableUrl}\` (configured; not client-verified)`;
  });
  const lines = [
    "# Self-hosted stack handoff",
    "",
    `Run: \`${session.runId}\``,
    `Username: \`${sessionUsername(session)}\``,
    "Password: `[REDACTED - saved in private-handoff.json]`",
    `Local Homarr URL: \`${access.services.homarr.browserUrl}\``,
    access.services.homarr.reachableUrl === null
      ? `Remote stack access: establish one tunnel with \`${sshTunnel.command}\``
      : `User-reachable Homarr URL: \`${access.services.homarr.reachableUrl}\` (configured; client reachability still requires verification)`,
    "Homarr's direct wildcard option exposes only the dashboard. Service app links need the SSH forwards above or explicit private proxy origins.",
    boardAccess === null
      ? "Personal board: not verified by the notebook helper"
      : `Personal board: \`${boardAccess.urls.user ?? boardAccess.urls.local}\` (recorded private board identity; notebook verified at ${boardAccess.notebook.verifiedAt}; current board state and overall acceptance remain separate)`,
    `Homarr notebook: ${boardAccess === null ? "not verified" : boardAccess.notebook.status}`,
    mcpClientPath === null
      ? "MCP client: run `scripts/session.sh mcp-config RUN_ID` to create the uninstalled read-only client fragment"
      : `MCP client candidate: \`${mcpClientPath}\` (handoff did not validate its contents; re-run mcp-config before separately authorized installation)`,
    "",
    "## User URLs",
    "",
    ...reachableLines,
    "",
    "## Actions",
    "",
    ...handoffActions().map((action) => `- ${action}`),
    "",
    "## Locations",
    "",
    ...Object.entries(locations).map(([name, path]) => `- ${name}: \`${path}\``),
    "",
    "## Credentials",
    "",
    "- Prowlarr, Radarr, Sonarr, and Seerr API keys: `[REDACTED - saved]`",
    `- Homarr API key: ${homarrApiKey ? "`[REDACTED - saved]`" : "pending capture"}`,
    "- Shared administrator password: `[REDACTED - saved]`",
    "",
  ];
  return lines.join("\n");
}

function replacePrivateArtifact(session, filename, contents) {
  const artifactDirectory = join(session.sessionDir, "artifacts");
  const directoryStat = lstatSync(artifactDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || realpathSync(artifactDirectory) !== artifactDirectory
    || directoryStat.uid !== process.getuid() || (directoryStat.mode & 0o077) !== 0) {
    fail("handoff artifact directory must be private and owned");
  }
  const destination = join(artifactDirectory, filename);
  const replacement = join(
    artifactDirectory,
    `.${filename}.${randomBytes(12).toString("hex")}`,
  );
  let descriptor;
  let cleanupArmed = false;
  try {
    descriptor = openSync(replacement, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    cleanupArmed = true;
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertPrivateControlFile(replacement, artifactDirectory, `replacement ${filename}`);
    renameSync(replacement, destination);
    cleanupArmed = false;
    assertPrivateControlFile(destination, artifactDirectory, filename);
    const directoryDescriptor = openSync(artifactDirectory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (cleanupArmed && existsSync(replacement)) {
      assertPrivateControlFile(replacement, artifactDirectory, `replacement ${filename}`);
      unlinkSync(replacement);
    }
  }
  return destination;
}

export function writeSessionHandoffArtifacts(session, homarrApiKey = "") {
  const privatePath = replacePrivateArtifact(
    session,
    "private-handoff.json",
    privateHandoffContents(session, homarrApiKey),
  );
  const redactedPath = replacePrivateArtifact(
    session,
    "handoff-report.md",
    redactedHandoffContents(session, homarrApiKey),
  );
  return Object.freeze({ privatePath, redactedPath });
}

export function printSessionHandoff(runId) {
  writeSessionConnections(runId);
  const session = loadSession(runId);
  const homarr = loadHomarrApiKey(session, { optional: true });
  const artifacts = writeSessionHandoffArtifacts(session, homarr?.apiKey ?? "");
  process.stdout.write([
    `Private handoff artifact: ${artifacts.privatePath}`,
    `Redacted handoff report: ${artifacts.redactedPath}`,
    "",
  ].join("\n"));
}

export function refreshArrKeys(runId, services = ["sonarr", "radarr", "prowlarr"]) {
  const session = loadSession(runId);
  requireSessionPasswordScheme(session);
  const arrKeys = {
    SONARR_API_KEY: session.secrets.SONARR_API_KEY,
    RADARR_API_KEY: session.secrets.RADARR_API_KEY,
    PROWLARR_API_KEY: session.secrets.PROWLARR_API_KEY,
  };
  const allowedServices = new Set(["sonarr", "radarr", "prowlarr"]);
  if (!Array.isArray(services) || services.length === 0 || services.some((service) => !allowedServices.has(service))) {
    fail("invalid Arr service selection");
  }
  for (const [service, secretName] of [
    ["sonarr", "SONARR_API_KEY"],
    ["radarr", "RADARR_API_KEY"],
    ["prowlarr", "PROWLARR_API_KEY"],
  ]) {
    if (!services.includes(service)) {
      continue;
    }
    const result = spawnSync("docker", [
      "compose",
      "--project-name",
      session.manifest.COMPOSE_PROJECT_NAME,
      "--env-file",
      session.manifestFile,
      "--env-file",
      session.secretsFile,
      "--file",
      join(REPO_ROOT, "docker-compose.yml"),
      "exec",
      "-T",
      service,
      "sh",
      "-c",
      "sed -n 's:.*<ApiKey>\\([^<]*\\)</ApiKey>.*:\\1:p' /config/config.xml",
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: sanitizedChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });

    if (result.error || result.status !== 0) {
      fail(`could not read the ${service} API key`);
    }
    const apiKey = result.stdout.replace(/[\r\n]/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(apiKey)) {
      fail(`${service} API key is not ready`);
    }
    arrKeys[secretName] = apiKey;
  }

  replaceArrKeysAtomic(session, arrKeys);
}

function replaceArrKeysAtomic(session, arrKeys) {
  const replacement = join(
    session.sessionDir,
    `.secrets.env.${randomBytes(12).toString("hex")}`,
  );
  if (!/^\.secrets\.env\.[0-9a-f]{24}$/.test(basename(replacement))) {
    fail("replacement secrets filename is invalid");
  }

  let descriptor;
  let cleanupArmed = false;
  const signalExitCodes = new Map([
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]);
  const signalHandlers = new Map();
  const cleanupReplacement = () => {
    let closeError;
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (error) {
        closeError = error;
      } finally {
        descriptor = undefined;
      }
    }
    if (cleanupArmed && existsSync(replacement)) {
      assertPrivateControlFile(
        replacement,
        session.sessionDir,
        "replacement secrets file",
      );
      unlinkSync(replacement);
    }
    if (closeError) {
      throw closeError;
    }
  };

  for (const [signal, exitCode] of signalExitCodes) {
    const handler = () => {
      try {
        cleanupReplacement();
      } finally {
        process.exit(exitCode);
      }
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    descriptor = openSync(replacement, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    const replacementStat = assertPrivateControlFile(
      replacement,
      session.sessionDir,
      "replacement secrets file",
    );
    const descriptorStat = fstatSync(descriptor);
    if (
      descriptorStat.dev !== replacementStat.dev
      || descriptorStat.ino !== replacementStat.ino
    ) {
      fail("replacement secrets file changed after creation");
    }
    cleanupArmed = true;
    const contents = [
      `HOMARR_ENCRYPTION_KEY=${session.secrets.HOMARR_ENCRYPTION_KEY}`,
      `SONARR_API_KEY=${arrKeys.SONARR_API_KEY}`,
      `RADARR_API_KEY=${arrKeys.RADARR_API_KEY}`,
      `PROWLARR_API_KEY=${arrKeys.PROWLARR_API_KEY}`,
      `SEERR_API_KEY=${session.secrets.SEERR_API_KEY}`,
      "",
    ].join("\n");
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertPrivateControlFile(
      replacement,
      session.sessionDir,
      "replacement secrets file",
    );
    renameSync(replacement, session.secretsFile);
    cleanupArmed = false;
    assertPrivateControlFile(
      session.secretsFile,
      session.sessionDir,
      "secrets file",
    );
  } finally {
    try {
      cleanupReplacement();
    } finally {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    }
  }
}

export function composeLogs(session, service) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-name",
      session.manifest.COMPOSE_PROJECT_NAME,
      "--env-file",
      session.manifestFile,
      "--env-file",
      session.secretsFile,
      "--file",
      join(REPO_ROOT, "docker-compose.yml"),
      "logs",
      "--no-color",
      service,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: sanitizedChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  if (result.error || result.status !== 0) {
    fail(`could not inspect ${service} startup state`);
  }

  return result.stdout;
}

export function sleep(milliseconds) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

let curlTransportEnabled = false;

export function useCurlTransport(session) {
  enableCurlHttp(session);
  curlTransportEnabled = true;
}

async function fetchWithTimeout(url, options = {}) {
  if (curlTransportEnabled) {
    return curlFetch(url, options);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    return await fetch(url, {
      ...options,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function request(url, options = {}, requestOptions = {}) {
  const expectedStatuses = requestOptions.expectedStatuses ?? [200];
  const attempts = requestOptions.attempts ?? 1;
  const label = requestOptions.label ?? "service request";
  let lastStatus = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      lastStatus = response.status;
      if (expectedStatuses.includes(response.status)) {
        return response;
      }
    } catch {
      lastStatus = 0;
    }

    if (attempt < attempts) {
      await sleep(500);
    }
  }

  if (lastStatus === 0) {
    fail(`${label} did not respond`);
  }
  fail(`${label} returned HTTP ${lastStatus}`);
}

export async function requestJson(url, options = {}, requestOptions = {}) {
  const response = await request(url, options, requestOptions);
  try {
    return await response.json();
  } catch {
    fail(`${requestOptions.label ?? "service request"} returned invalid JSON`);
  }
}

export async function tryRequest(url, options = {}, expectedStatuses = [200]) {
  try {
    const response = await fetchWithTimeout(url, options);
    return {
      ok: expectedStatuses.includes(response.status),
      response,
    };
  } catch {
    return {
      ok: false,
      response: null,
    };
  }
}

export function arrHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
  };
}

export function fieldValue(resource, fieldName) {
  const field = resource.fields?.find((candidate) => candidate.name === fieldName);
  return field?.value;
}

export function setField(fields, fieldName, value) {
  const field = fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    fail(`service schema is missing field ${fieldName}`);
  }
  field.value = value;
}

export function writableFields(resource) {
  if (!Array.isArray(resource.fields)) {
    fail("service schema has no fields");
  }

  return resource.fields.map((field) => ({
    name: field.name,
    value: field.value,
  }));
}

export function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const invokedFile = Bun.argv[1] ? resolve(Bun.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  try {
    if (Bun.argv.length === 4 && Bun.argv[2] === "connections") {
      const result = writeSessionConnections(Bun.argv[3]);
      printSessionConnectionsSummary(result);
    } else if (Bun.argv.length === 4 && Bun.argv[2] === "handoff") {
      printSessionHandoff(Bun.argv[3]);
    } else if (Bun.argv[2] === "access-proxy") {
      const action = Bun.argv[3];
      if (action === "set") {
        if (
          ![7, 8].includes(Bun.argv.length)
          || (Bun.argv.length === 8 && Bun.argv[7] !== "--private-dns-confirmed")
        ) {
          fail("usage: session-context.ts access-proxy set RUN_ID SERVICE ORIGIN [--private-dns-confirmed]");
        }
        const session = loadSession(Bun.argv[4]);
        const result = configureSessionProxyAccess(
          session,
          "set",
          Bun.argv[5],
          Bun.argv[6],
          Bun.argv[7] === "--private-dns-confirmed",
        );
        process.stdout.write(`PASS private proxy access saved for one service (${result.count} total)\n`);
      } else if (action === "clear" && Bun.argv.length === 6) {
        const session = loadSession(Bun.argv[4]);
        const result = configureSessionProxyAccess(session, "clear", Bun.argv[5]);
        process.stdout.write(`PASS private proxy access removed for one service (${result.count} remain)\n`);
      } else {
        fail("usage: session-context.ts access-proxy set|clear RUN_ID SERVICE [ORIGIN] [--private-dns-confirmed]");
      }
    } else {
      fail("usage: session-context.ts connections|handoff|access-proxy ...");
    }
  } catch {
    process.stdout.write("FAIL session access or handoff operation\n");
    process.exitCode = 1;
  }
}
