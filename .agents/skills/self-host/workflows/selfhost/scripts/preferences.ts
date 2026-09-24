import { randomBytes } from "node:crypto";
import { access, chmod, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PREFERENCES_RELATIVE_PATH = join(".selfhost", "preferences.json");

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const INSTALLED_SKILL_DIRECTORY = resolve(SCRIPT_DIRECTORY, "../../..");

const ALLOWED_FIELDS = new Set([
  "onboarding.experience", "platform", "timezone", "locale", "project.name", "paths.stateRoot", "paths.configRoot",
  "paths.dataRoot", "paths.mediaRoot", "paths.downloadsRoot", "paths.backupRoot",
  "identity.uid", "identity.gid", "docker.network", "host.alias", "ingress.mode",
  "ingress.owner", "ingress.domain", "vpn.mode", "vpn.scope", "backup.cadence",
  "hardware.acceleration", "ui.theme"
]);

const SECRET_KEY_PATTERN = /(^|[._-])(password|passwd|secret|token|credential|credentials|api[-_]?key|auth[-_]?key|private[-_]?key|cookie|session|tunnel[-_]?token|encryption[-_]?key)($|[._-])/i;
const SECRET_ASSIGNMENT_PATTERN = /(?:^|[?&\s])(password|passwd|secret|token|api[_-]?key|private[_-]?key)=\S+/i;
const SECRET_PREFIX_PATTERN = /^(gh[pousr]_|github_pat_|sk-[A-Za-z0-9]|tskey-|xox[baprs]-|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.)/;
const PEM_PATTERN = /-----BEGIN [A-Z ]*(PRIVATE KEY|SECRET)[A-Z ]*-----/i;
const CREDENTIAL_URL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/;
const ENTROPY_PATTERN = /^(?=.{40,}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_+/=-]+$/;

export class PreferenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreferenceError";
  }
}

function now() {
  return new Date().toISOString();
}

function emptyPreferences() {
  return { schemaVersion: 1, updatedAt: now(), choices: {} };
}

function valueLooksSecret(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => valueLooksSecret(entry));
  }
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (PEM_PATTERN.test(trimmed) || SECRET_ASSIGNMENT_PATTERN.test(trimmed) || SECRET_PREFIX_PATTERN.test(trimmed) || CREDENTIAL_URL_PATTERN.test(trimmed)) {
    return true;
  }
  return ENTROPY_PATTERN.test(trimmed);
}

function refuseSecret() {
  throw new PreferenceError("Refused preference: field name or value looks secret-like.");
}

function ensureSafeFieldAndValue(field, value) {
  if (SECRET_KEY_PATTERN.test(field) || valueLooksSecret(value)) {
    refuseSecret();
  }
  if (!ALLOWED_FIELDS.has(field)) {
    throw new PreferenceError("Unsupported preference field. Use preferences schema to list allowed non-secret fields.");
  }
}

function isSafePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
  if (!isAbsolute(value) && !windowsAbsolute) {
    return false;
  }
  const segments = value.split(/[\\/]+/);
  return !segments.includes("..");
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  if (pathFromParent === "") {
    return true;
  }
  if (pathFromParent === ".." || pathFromParent.startsWith(`..${sep}`) || isAbsolute(pathFromParent)) {
    return false;
  }
  return true;
}

function validateFieldValue(field, value) {
  if (value === null) {
    return;
  }
  if (field.startsWith("paths.")) {
    if (!isSafePath(value)) {
      throw new PreferenceError("Path preferences must be absolute and contain no parent traversal segments.");
    }
    return;
  }
  if (field === "identity.uid" || field === "identity.gid") {
    if (!Number.isInteger(value) || value < 0) {
      throw new PreferenceError("UID and GID preferences must be non-negative integers.");
    }
    return;
  }
  if (field === "timezone") {
    const valid = value === "UTC" || (typeof value === "string" && /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)+$/.test(value));
    if (!valid) {
      throw new PreferenceError("Timezone must be UTC or an IANA-style area/location value.");
    }
    return;
  }
  if (field === "locale") {
    if (typeof value !== "string" || !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(value)) {
      throw new PreferenceError("Locale preference has an invalid format.");
    }
    return;
  }

  const enums = {
    "onboarding.experience": ["new", "advanced"],
    "platform": ["auto", "linux", "docker-desktop-mac", "unraid", "truenas-scale", "proxmox", "vps"],
    "ingress.mode": ["local", "lan", "tailnet", "public", "tunnel"],
    "ingress.owner": ["none", "caddy", "traefik", "nginx-proxy-manager", "cloudflare-tunnel", "pangolin", "tailscale"],
    "vpn.mode": ["none", "gluetun", "wireguard", "tailscale-exit"],
    "backup.cadence": ["manual", "hourly", "daily", "weekly"],
    "hardware.acceleration": ["none", "auto", "intel-amd", "nvidia", "apple", "unknown"],
    "ui.theme": ["system", "light", "dark"]
  };
  if (Object.hasOwn(enums, field)) {
    if (!enums[field].includes(value)) {
      throw new PreferenceError(`Preference ${field} must use one of the documented values.`);
    }
    return;
  }

  if (field === "vpn.scope") {
    const values = Array.isArray(value) ? value : [value];
    const valid = values.length > 0 && values.every((entry) => ["downloader", "project", "host"].includes(entry));
    if (!valid) {
      throw new PreferenceError("VPN scope must contain downloader, project, or host.");
    }
    return;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PreferenceError(`Preference ${field} must be a non-empty string or null.`);
  }
  if (["project.name", "docker.network", "host.alias"].includes(field) && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(value)) {
    throw new PreferenceError(`Preference ${field} contains unsupported characters.`);
  }
  if (field === "ingress.domain") {
    const hostnamePattern = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
    if (!hostnamePattern.test(value)) {
      throw new PreferenceError("Ingress domain must be a hostname without a scheme, path, or credentials.");
    }
  }
}

export function parsePreferenceValue(raw) {
  if (raw === "null") {
    return null;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new PreferenceError("Array preference value is not valid JSON.");
    }
    if (!Array.isArray(parsed)) {
      throw new PreferenceError("Structured preference values must be arrays.");
    }
    return parsed;
  }
  return raw;
}

export function validatePreferencesDocument(document) {
  const errors = [];
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, errors: ["Preferences root must be an object."] };
  }
  const rootKeys = Object.keys(document).sort();
  const expectedRootKeys = ["choices", "schemaVersion", "updatedAt"];
  if (JSON.stringify(rootKeys) !== JSON.stringify(expectedRootKeys)) {
    errors.push("Preferences root contains unsupported fields.");
  }
  if (document.schemaVersion !== 1) {
    errors.push("Preferences schemaVersion must be 1.");
  }
  if (typeof document.updatedAt !== "string" || Number.isNaN(Date.parse(document.updatedAt))) {
    errors.push("Preferences updatedAt must be an ISO date-time.");
  }
  if (document.choices === null || typeof document.choices !== "object" || Array.isArray(document.choices)) {
    errors.push("Preferences choices must be an object.");
    return { valid: false, errors };
  }
  for (const [field, record] of Object.entries(document.choices)) {
    try {
      if (SECRET_KEY_PATTERN.test(field)) {
        refuseSecret();
      }
      if (!ALLOWED_FIELDS.has(field)) {
        errors.push(`Unsupported preference field: ${field}`);
        continue;
      }
      if (record === null || typeof record !== "object" || Array.isArray(record)) {
        errors.push(`Preference ${field} must be a provenance record.`);
        continue;
      }
      const keys = Object.keys(record).sort();
      if (JSON.stringify(keys) !== JSON.stringify(["source", "updatedAt", "value"])) {
        errors.push(`Preference ${field} contains unsupported fields.`);
        continue;
      }
      if (!["chosen", "imported"].includes(record.source)) {
        errors.push(`Preference ${field} has an invalid source.`);
      }
      if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt))) {
        errors.push(`Preference ${field} has an invalid updatedAt.`);
      }
      ensureSafeFieldAndValue(field, record.value);
      validateFieldValue(field, record.value);
    } catch (error) {
      if (error instanceof PreferenceError && error.message.startsWith("Refused")) {
        throw error;
      }
      errors.push(error.message);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function resolvePreferencesPath(path) {
  if (!isSafePath(path)) {
    throw new PreferenceError("Preferences path must be an explicit absolute path without parent traversal segments.");
  }
  const absolutePath = resolve(path);
  if (isWithin(INSTALLED_SKILL_DIRECTORY, absolutePath)) {
    throw new PreferenceError("Preferences cannot be stored inside the installed skill directory.");
  }
  return absolutePath;
}

export async function preferencesPathForProjectRoot(projectRoot) {
  if (!isSafePath(projectRoot)) {
    throw new PreferenceError("Project root must be an explicit absolute path without parent traversal segments.");
  }
  const absoluteRoot = resolve(projectRoot);
  if (dirname(absoluteRoot) === absoluteRoot) {
    throw new PreferenceError("Project root cannot be a filesystem root.");
  }
  if (isWithin(INSTALLED_SKILL_DIRECTORY, absoluteRoot)) {
    throw new PreferenceError("Project root cannot be the installed skill directory or one of its descendants.");
  }
  let rootInfo;
  try {
    rootInfo = await lstat(absoluteRoot);
  } catch {
    throw new PreferenceError("Project root must already exist as a real directory.");
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new PreferenceError("Project root must be a real directory, not a link or special file.");
  }
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(absoluteRoot);
  } catch {
    throw new PreferenceError("Project root cannot be resolved safely.");
  }
  if (canonicalRoot !== absoluteRoot) {
    throw new PreferenceError("Project root must not traverse symbolic links.");
  }
  return resolvePreferencesPath(join(absoluteRoot, DEFAULT_PREFERENCES_RELATIVE_PATH));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadPreferences(path, options = {}) {
  const absolutePath = resolvePreferencesPath(path);
  if (!(await exists(absolutePath))) {
    if (options.allowMissing) {
      return { path: absolutePath, exists: false, document: emptyPreferences() };
    }
    throw new PreferenceError("Preferences file does not exist. Run preferences init first.");
  }
  const parentPath = dirname(absolutePath);
  const parentInfo = await lstat(parentPath);
  if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) {
    throw new PreferenceError("Preferences directory must be a real directory, not a link or special file.");
  }
  if (await realpath(parentPath) !== parentPath) {
    throw new PreferenceError("Preferences path must not traverse symbolic links.");
  }
  if (process.platform !== "win32" && basename(parentPath) === ".selfhost") {
    if ((parentInfo.mode & 0o7077) !== 0) {
      throw new PreferenceError("Preferences directory permissions are too broad; require mode 0700 or stricter.");
    }
    if (parentInfo.uid !== process.getuid() || parentInfo.gid !== process.getgid()) {
      throw new PreferenceError("Preferences directory must be owned by the current user and group.");
    }
  }
  const fileInfo = await lstat(absolutePath);
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.nlink !== 1) {
    throw new PreferenceError("Preferences path must be one regular file, not a link or special file.");
  }
  if (process.platform !== "win32") {
    if ((fileInfo.mode & 0o7177) !== 0) {
      throw new PreferenceError("Preferences file permissions are too broad; require mode 0600 or stricter.");
    }
    if (fileInfo.uid !== process.getuid() || fileInfo.gid !== process.getgid()) {
      throw new PreferenceError("Preferences file must be owned by the current user and group.");
    }
  }
  let document;
  try {
    document = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch {
    throw new PreferenceError("Preferences file is unreadable or invalid JSON.");
  }
  const validation = validatePreferencesDocument(document);
  if (!validation.valid) {
    throw new PreferenceError(`Preferences validation failed: ${validation.errors.join(" ")}`);
  }
  return { path: absolutePath, exists: true, document };
}

async function ensurePrivateDirectory(path) {
  const directory = dirname(path);
  let created = false;
  let directoryInfo = null;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new PreferenceError(`Unable to inspect preferences directory: ${error.code || "inspection error"}`);
    }
    let canonicalParent;
    try {
      canonicalParent = await realpath(dirname(directory));
    } catch {
      throw new PreferenceError("Preferences directory parent cannot be resolved safely.");
    }
    if (canonicalParent !== dirname(directory)) {
      throw new PreferenceError("Preferences path must not traverse symbolic links.");
    }
    await mkdir(directory, { mode: 0o700 });
    created = true;
    directoryInfo = await lstat(directory);
  }
  if (directoryInfo && (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory())) {
    throw new PreferenceError("Preferences directory must be a real directory, not a link or special file.");
  }
  let canonicalDirectory;
  try {
    canonicalDirectory = await realpath(directory);
  } catch {
    throw new PreferenceError("Preferences directory cannot be resolved safely.");
  }
  if (canonicalDirectory !== directory) {
    throw new PreferenceError("Preferences path must not traverse symbolic links.");
  }
  if (process.platform !== "win32" && basename(directory) === ".selfhost") {
    if (directoryInfo.uid !== process.getuid() || directoryInfo.gid !== process.getgid()) {
      throw new PreferenceError("Preferences directory must be owned by the current user and group.");
    }
  }
  if (created || basename(directory) === ".selfhost") {
    await chmod(directory, 0o700);
  }
  let ignoreCreated = false;
  if (basename(directory) === ".selfhost") {
    const ignoreResult = await ensureLocalStateIgnore(directory);
    ignoreCreated = ignoreResult.created;
  }
  return { directory, ignoreCreated };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform.
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

export async function withLocalStateLock(directory, operation) {
  const lockPath = join(directory, ".project.lock");
  let handle;
  let lockInfo;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile("locked\n", "utf8");
    await handle.sync();
    lockInfo = await handle.stat();
  } catch (error) {
    if (handle) {
      await handle.close();
      try {
        await unlink(lockPath);
      } catch {
        // The failed lock may already be absent.
      }
    }
    if (error.code === "EEXIST") {
      throw new PreferenceError("Another local-state update is active. Retry after it finishes.");
    }
    throw new PreferenceError("Unable to acquire the private local-state lock.");
  }

  let result;
  let operationError = null;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  let releaseError = null;
  try {
    await handle.close();
    const currentInfo = await lstat(lockPath);
    const unchanged = currentInfo.isFile()
      && !currentInfo.isSymbolicLink()
      && currentInfo.nlink === 1
      && currentInfo.dev === lockInfo.dev
      && currentInfo.ino === lockInfo.ino;
    if (!unchanged) {
      throw new PreferenceError("Local-state lock changed unexpectedly before release.");
    }
    await unlink(lockPath);
    await syncDirectory(directory);
  } catch (error) {
    releaseError = error;
  }
  if (operationError) {
    throw operationError;
  }
  if (releaseError) {
    throw releaseError;
  }
  return result;
}

export async function ensureLocalStateIgnore(directory) {
  const ignorePath = join(directory, ".gitignore");
  let info;
  try {
    info = await lstat(ignorePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new PreferenceError("Unable to inspect the local-state ignore file.");
    }
    let handle;
    let created = false;
    try {
      handle = await open(ignorePath, "wx", 0o600);
      created = true;
      await handle.writeFile("*\n", "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await chmod(ignorePath, 0o600);
      return { created: true };
    } catch (writeError) {
      if (handle) {
        await handle.close();
      }
      if (created) {
        try {
          await unlink(ignorePath);
        } catch {
          // The incomplete ignore file may already be absent.
        }
      }
      if (writeError.code !== "EEXIST") {
        throw new PreferenceError("Unable to create the local-state ignore file safely.");
      }
      info = await lstat(ignorePath);
    }
  }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
    throw new PreferenceError("The local-state ignore path must be one regular file.");
  }
  if (process.platform !== "win32") {
    if ((info.mode & 0o7177) !== 0) {
      throw new PreferenceError("The local-state ignore file has unsafe permissions.");
    }
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      throw new PreferenceError("The local-state ignore file must be owned by the current user and group.");
    }
  }
  let content;
  try {
    content = await readFile(ignorePath, "utf8");
  } catch {
    throw new PreferenceError("The local-state ignore file cannot be read safely.");
  }
  if (content !== "*\n") {
    throw new PreferenceError("The local-state ignore file must contain only the documented wildcard rule.");
  }
  return { created: false };
}

async function atomicPrivateWrite(path, document) {
  const suffix = randomBytes(8).toString("hex");
  const temporaryPath = join(dirname(path), `.preferences.${process.pid}.${suffix}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
    await syncDirectory(dirname(path));
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may not exist.
    }
    throw new PreferenceError(`Unable to write preferences safely: ${error.code || "write error"}`);
  }
}

export async function initPreferences(path) {
  const absolutePath = resolvePreferencesPath(path);
  const directoryState = await ensurePrivateDirectory(absolutePath);
  return withLocalStateLock(dirname(absolutePath), async () => {
    if (await exists(absolutePath)) {
      const loaded = await loadPreferences(path);
      return { path: loaded.path, created: false, ignoreCreated: directoryState.ignoreCreated, document: loaded.document };
    }
    const document = emptyPreferences();
    await atomicPrivateWrite(absolutePath, document);
    return { path: absolutePath, created: true, ignoreCreated: directoryState.ignoreCreated, document };
  });
}

export async function setPreference(field, rawValue, path) {
  const value = parsePreferenceValue(rawValue);
  ensureSafeFieldAndValue(field, value);
  validateFieldValue(field, value);
  const absolutePath = resolvePreferencesPath(path);
  const directoryState = await ensurePrivateDirectory(absolutePath);
  return withLocalStateLock(dirname(absolutePath), async () => {
    const loaded = await loadPreferences(absolutePath, { allowMissing: true });
    const timestamp = now();
    loaded.document.choices[field] = { value, source: "chosen", updatedAt: timestamp };
    loaded.document.updatedAt = timestamp;
    const validation = validatePreferencesDocument(loaded.document);
    if (!validation.valid) {
      throw new PreferenceError(`Preferences validation failed: ${validation.errors.join(" ")}`);
    }
    await atomicPrivateWrite(loaded.path, loaded.document);
    return { path: loaded.path, field, updated: true, ignoreCreated: directoryState.ignoreCreated };
  });
}

export function publicPreferences(document) {
  const choices = {};
  for (const [field, record] of Object.entries(document.choices || {})) {
    choices[field] = { value: record.value, source: record.source, updatedAt: record.updatedAt };
  }
  return { schemaVersion: document.schemaVersion, updatedAt: document.updatedAt, choices };
}
