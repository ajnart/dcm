import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
} from "node:path";

const CONFIG_FILE = "profile.json";
const KEY_FILE = ".credential";
const CAPABILITY_FILE = "integration-policy.json";
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_KEY_BYTES = 2 * 1024;
const PROFILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONFIG_FIELDS = new Set(["schemaVersion", "profile", "baseUrl", "mcpPath"]);
const SECRET_FIELD_PATTERN = /(api.?key|authorization|credential|password|private.?key|secret|token)/i;
const INTEGRATION_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const INTEGRATION_REQUEST_SERVICES = new Set([
  "sonarr", "radarr", "lidarr", "readarr", "prowlarr", "overseerr", "jellyseerr", "seerr",
  "immich", "slskd", "homeassistant", "coolify", "audiobookshelf", "speedtesttracker",
  "adguardhome", "nextcloud",
]);

function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireIdentity() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    throw new Error("POSIX ownership checks are unavailable");
  }
}

function assertOwned(stat, label) {
  requireIdentity();
  if (stat.uid !== process.getuid() || stat.gid !== process.getgid()) {
    throw new Error(`${label} has unexpected ownership`);
  }
}

function assertMode(stat, mode, label) {
  if ((stat.mode & 0o7777) !== mode) {
    throw new Error(`${label} has an unsafe mode`);
  }
}

function assertNotRootOrHome(path, label) {
  const normalized = resolve(path);
  if (normalized === parse(normalized).root || normalized === resolve(homedir())) {
    throw new Error(`${label} cannot be a filesystem root or home directory`);
  }
}

export function assertRealDirectory(path, options = {}) {
  const normalized = resolve(path);
  const stat = lstatSync(normalized);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(normalized) !== normalized) {
    throw new Error("managed directory is invalid");
  }
  if (stat.nlink < 1) {
    throw new Error("managed directory link count is invalid");
  }
  assertOwned(stat, "managed directory");
  if (options.mode !== undefined) {
    assertMode(stat, options.mode, "managed directory");
  }
  if (options.parent !== undefined && dirname(normalized) !== resolve(options.parent)) {
    throw new Error("managed directory escaped its parent");
  }
  return stat;
}

function assertPrivateFile(path, parent, maxBytes, label) {
  const normalized = resolve(path);
  const stat = lstatSync(normalized);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(normalized) !== normalized) {
    throw new Error(`${label} is invalid`);
  }
  if (dirname(normalized) !== resolve(parent) || stat.nlink !== 1) {
    throw new Error(`${label} escaped its profile`);
  }
  assertOwned(stat, label);
  assertMode(stat, 0o600, label);
  if (stat.size < 1 || stat.size > maxBytes) {
    throw new Error(`${label} has an invalid size`);
  }
  return stat;
}

function privateIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => part < 0 || part > 255)) {
    return false;
  }
  if (parts[0] === 10 || parts[0] === 127) {
    return true;
  }
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return true;
  }
  return false;
}

function safePlaintextHostname(rawHostname) {
  let hostname = rawHostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }
  if (privateIpv4(hostname)) {
    return true;
  }
  if (hostname === "::1" || /^(?:fc|fd)[0-9a-f]{2}:/i.test(hostname)) {
    return true;
  }
  if (/^fe[89ab][0-9a-f]:/i.test(hostname)) {
    return true;
  }
  if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    return true;
  }
  return [".home.arpa", ".internal", ".lan", ".local", ".test"].some(
    (suffix) => hostname.endsWith(suffix),
  );
}

export function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
    throw new Error("Homarr base URL is invalid");
  }
  if (value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error("Homarr base URL is invalid");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Homarr base URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Homarr base URL scheme is invalid");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Homarr base URL contains forbidden URL components");
  }
  if (parsed.pathname !== "/") {
    throw new Error("Homarr base URL must identify the Homarr origin");
  }
  if (parsed.protocol === "http:" && !safePlaintextHostname(parsed.hostname)) {
    throw new Error("public plaintext HTTP is forbidden");
  }
  return parsed.origin;
}

export function validateProfileName(profile) {
  if (typeof profile !== "string" || !PROFILE_PATTERN.test(profile)) {
    throw new Error("profile name is invalid");
  }
  return profile;
}

function validateProjectRoot(projectRoot) {
  if (typeof projectRoot !== "string" || !isAbsolute(projectRoot)) {
    throw new Error("project root must be absolute");
  }
  const normalized = resolve(projectRoot);
  assertNotRootOrHome(normalized, "project root");
  assertRealDirectory(normalized);
  return normalized;
}

function ensurePrivateDirectory(path, parent) {
  const normalized = resolve(path);
  if (!existsSync(normalized)) {
    mkdirSync(normalized, { mode: 0o700 });
  }
  assertRealDirectory(normalized, { mode: 0o700, parent });
  return normalized;
}

export function defaultProfilePath(profile, projectRoot = process.cwd()) {
  const validProfile = validateProfileName(profile);
  const validProjectRoot = validateProjectRoot(resolve(projectRoot));
  return join(validProjectRoot, ".selfhost", "homarr", validProfile);
}

function inspectProfilePath(profilePath) {
  if (typeof profilePath !== "string" || !isAbsolute(profilePath)) {
    throw new Error("profile path must be absolute");
  }
  const normalized = resolve(profilePath);
  if (normalized !== profilePath) {
    throw new Error("profile path must be normalized");
  }
  assertNotRootOrHome(normalized, "profile path");
  const profile = validateProfileName(basename(normalized));
  const homarrDirectory = dirname(normalized);
  const selfhostDirectory = dirname(homarrDirectory);
  const projectRoot = dirname(selfhostDirectory);
  if (basename(homarrDirectory) !== "homarr" || basename(selfhostDirectory) !== ".selfhost") {
    throw new Error("profile path is outside .selfhost/homarr");
  }
  validateProjectRoot(projectRoot);
  assertRealDirectory(selfhostDirectory, { mode: 0o700, parent: projectRoot });
  assertRealDirectory(homarrDirectory, { mode: 0o700, parent: selfhostDirectory });
  assertRealDirectory(normalized, { mode: 0o700, parent: homarrDirectory });
  return { profile, profilePath: normalized, projectRoot };
}

function rejectSecretFields(value) {
  if (!isRecord(value)) {
    throw new Error("profile config is invalid");
  }
  for (const key of Object.keys(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      throw new Error("profile config contains a secret-like field");
    }
  }
}

function validateConfig(value, expectedProfile) {
  rejectSecretFields(value);
  const keys = Object.keys(value);
  if (keys.length !== CONFIG_FIELDS.size || keys.some((key) => !CONFIG_FIELDS.has(key))) {
    throw new Error("profile config fields are invalid");
  }
  if (
    value.schemaVersion !== 1
    || value.profile !== expectedProfile
    || value.mcpPath !== "/api/mcp"
  ) {
    throw new Error("profile config values are invalid");
  }
  const baseUrl = normalizeBaseUrl(value.baseUrl);
  if (baseUrl !== value.baseUrl) {
    throw new Error("profile base URL is not normalized");
  }
  return {
    schemaVersion: 1,
    profile: expectedProfile,
    baseUrl,
    mcpPath: "/api/mcp",
  };
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function atomicWritePrivate(destination, content, options = {}) {
  const normalized = resolve(destination);
  const parent = dirname(normalized);
  assertRealDirectory(parent);
  let replace = false;
  if (options.replace === true) {
    replace = true;
  }
  if (replace) {
    assertPrivateFile(normalized, parent, options.maxBytes ?? Number.MAX_SAFE_INTEGER, "destination");
  } else if (existsSync(normalized)) {
    throw new Error("destination already exists");
  }

  const replacement = join(parent, `.${basename(normalized)}.${randomBytes(12).toString("hex")}`);
  let descriptor;
  let cleanup = false;
  try {
    descriptor = openSync(replacement, "wx", 0o600);
    cleanup = true;
    fchmodSync(descriptor, 0o600);
    const pathStat = lstatSync(replacement);
    const descriptorStat = fstatSync(descriptor);
    if (pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) {
      throw new Error("replacement changed after creation");
    }
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertPrivateFile(
      replacement,
      parent,
      options.maxBytes ?? Number.MAX_SAFE_INTEGER,
      "replacement",
    );
    if (replace) {
      renameSync(replacement, normalized);
      cleanup = false;
    } else {
      linkSync(replacement, normalized);
      unlinkSync(replacement);
      cleanup = false;
    }
    assertPrivateFile(
      normalized,
      parent,
      options.maxBytes ?? Number.MAX_SAFE_INTEGER,
      "destination",
    );
    fsyncDirectory(parent);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (cleanup && existsSync(replacement)) {
      unlinkSync(replacement);
    }
  }
}

export function initializeProfile({ profile, baseUrl, projectRoot }) {
  const validProfile = validateProfileName(profile);
  const validBaseUrl = normalizeBaseUrl(baseUrl);
  const validProjectRoot = validateProjectRoot(resolve(projectRoot));
  const selfhostDirectory = ensurePrivateDirectory(
    join(validProjectRoot, ".selfhost"),
    validProjectRoot,
  );
  const homarrDirectory = ensurePrivateDirectory(
    join(selfhostDirectory, "homarr"),
    selfhostDirectory,
  );
  const profilePath = ensurePrivateDirectory(
    join(homarrDirectory, validProfile),
    homarrDirectory,
  );
  const config = {
    schemaVersion: 1,
    profile: validProfile,
    baseUrl: validBaseUrl,
    mcpPath: "/api/mcp",
  };
  atomicWritePrivate(
    join(profilePath, CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
    { maxBytes: MAX_CONFIG_BYTES },
  );
  return profilePath;
}

export function validateApiKey(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > MAX_KEY_BYTES) {
    throw new Error("Homarr API key is invalid");
  }
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw new Error("Homarr API key is invalid");
  }
  return value;
}

export function validateMediaKeyEnvelope(value) {
  if (typeof value !== "string") {
    throw new Error("media Homarr key input is invalid");
  }
  const match = value.match(/^HOMARR_API_KEY=([^\r\n]+)\r?\n$/);
  if (!match) {
    throw new Error("media Homarr key input is invalid");
  }
  return validateApiKey(match[1]);
}

export function loadProfile(profilePath, options = {}) {
  const inspected = inspectProfilePath(profilePath);
  const configPath = join(inspected.profilePath, CONFIG_FILE);
  assertPrivateFile(configPath, inspected.profilePath, MAX_CONFIG_BYTES, "profile config");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error("profile config is invalid JSON");
  }
  const config = validateConfig(parsed, inspected.profile);
  const loaded = {
    ...inspected,
    ...config,
    endpoint: `${config.baseUrl}${config.mcpPath}`,
  };
  if (options.requireKey === true) {
    const keyPath = join(inspected.profilePath, KEY_FILE);
    assertPrivateFile(keyPath, inspected.profilePath, MAX_KEY_BYTES + 1, "profile credential");
    const encoded = readFileSync(keyPath, "utf8");
    if (!encoded.endsWith("\n") || encoded.slice(0, -1).includes("\n")) {
      throw new Error("profile credential encoding is invalid");
    }
    loaded.apiKey = validateApiKey(encoded.slice(0, -1));
  }
  const capabilityPath = join(inspected.profilePath, CAPABILITY_FILE);
  if (existsSync(capabilityPath)) {
    assertPrivateFile(capabilityPath, inspected.profilePath, MAX_CONFIG_BYTES, "integration policy");
    let capability;
    try {
      capability = JSON.parse(readFileSync(capabilityPath, "utf8"));
    } catch {
      throw new Error("integration policy is invalid JSON");
    }
    loaded.capabilityPolicy = validateCapabilityPolicy(capability);
  }
  return loaded;
}

export function validateCapabilityPolicy(value) {
  rejectSecretFields(value);
  if (value.schemaVersion !== 1) {
    throw new Error("integration policy is invalid");
  }
  if (value.mode === "media-request") {
    const keys = Object.keys(value);
    const expected = new Set(["schemaVersion", "mode", "integrationId"]);
    if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
      throw new Error("media request policy fields are invalid");
    }
    if (typeof value.integrationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.integrationId)) {
      throw new Error("media request policy integration is invalid");
    }
    return {
      schemaVersion: 1,
      mode: "media-request",
      integrationId: value.integrationId,
    };
  }
  if (value.mode !== "integration-request" || !Array.isArray(value.rules)) {
    throw new Error("integration policy is invalid");
  }
  if (value.rules.length < 1 || value.rules.length > 32) {
    throw new Error("integration policy rules are invalid");
  }
  const rules = value.rules.map((rule) => {
    rejectSecretFields(rule);
    const keys = Object.keys(rule);
    const expected = new Set(["integrationId", "service", "methods", "paths"]);
    if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
      throw new Error("integration policy rule fields are invalid");
    }
    if (typeof rule.integrationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(rule.integrationId)) {
      throw new Error("integration policy integration is invalid");
    }
    if (typeof rule.service !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(rule.service)) {
      throw new Error("integration policy service is invalid");
    }
    const service = rule.service.toLowerCase();
    if (!INTEGRATION_REQUEST_SERVICES.has(service)) {
      throw new Error("integration policy service is unsupported");
    }
    if (!Array.isArray(rule.methods) || rule.methods.length < 1 || rule.methods.length > 5
      || rule.methods.some((method) => !INTEGRATION_METHODS.has(method))) {
      throw new Error("integration policy methods are invalid");
    }
    if (!Array.isArray(rule.paths) || rule.paths.length < 1 || rule.paths.length > 32) {
      throw new Error("integration policy paths are invalid");
    }
    for (const path of rule.paths) {
      if (typeof path !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,1023}$/.test(path)
        || path.includes("..") || path.includes("//")) {
        throw new Error("integration policy path is invalid");
      }
    }
    return {
      integrationId: rule.integrationId,
      service,
      methods: [...new Set(rule.methods)],
      paths: [...new Set(rule.paths)],
    };
  });
  return { schemaVersion: 1, mode: "integration-request", rules };
}

export function storeCapabilityPolicy(profilePath, policy) {
  const loaded = loadProfile(profilePath);
  if (existsSync(join(loaded.profilePath, "client-fragments"))) {
    throw new Error("integration policy must be selected before fragment generation");
  }
  const validated = validateCapabilityPolicy(policy);
  atomicWritePrivate(
    join(loaded.profilePath, CAPABILITY_FILE),
    `${JSON.stringify(validated, null, 2)}\n`,
    { maxBytes: MAX_CONFIG_BYTES },
  );
}

export function storeApiKey(profilePath, apiKey, options = {}) {
  const key = validateApiKey(apiKey);
  const loaded = loadProfile(profilePath);
  const keyPath = join(loaded.profilePath, KEY_FILE);
  let replace = false;
  if (options.rotate === true) {
    const current = loadProfile(profilePath, { requireKey: true });
    if (current.apiKey === key) {
      throw new Error("rotated Homarr API key must differ");
    }
    replace = true;
  }
  atomicWritePrivate(keyPath, `${key}\n`, {
    maxBytes: MAX_KEY_BYTES + 1,
    replace,
  });
}

export function doctorProfile(profilePath) {
  loadProfile(profilePath, { requireKey: true });
}
