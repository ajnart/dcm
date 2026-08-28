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

const SCRIPT_LIB_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = realpathSync(resolve(SCRIPT_LIB_DIR, "../.."));
export const STANDARD_USERNAME = "admin";
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
  "SESSION_PASSWORD_SCHEME",
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

const MANAGED_ENV_KEYS = new Set([
  ...MANIFEST_KEYS,
  ...SECRET_KEYS,
  ...OPTIONAL_CONTROL_ENV_KEYS,
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

  return Object.freeze({
    runId,
    sessionDir,
    manifestFile,
    secretsFile,
    manifest: Object.freeze(manifest),
    secrets: Object.freeze(secrets),
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

export function refreshArrKeys(runId) {
  const session = loadSession(runId);
  requireSessionPasswordScheme(session);
  const arrKeys = Object.create(null);
  for (const [service, secretName] of [
    ["sonarr", "SONARR_API_KEY"],
    ["radarr", "RADARR_API_KEY"],
    ["prowlarr", "PROWLARR_API_KEY"],
  ]) {
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

async function fetchWithTimeout(url, options = {}) {
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
