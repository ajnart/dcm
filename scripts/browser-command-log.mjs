#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function privateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
    || (stat.mode & 0o7777) !== 0o700 || realpathSync(path) !== path) {
    throw new Error("unsafe browser log directory");
  }
}

function prepareShim(logDirectory) {
  if (!isAbsolute(logDirectory) || /[\r\n\0]/.test(logDirectory)) {
    throw new Error("browser log directory must be an absolute path");
  }
  try {
    mkdirSync(logDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  privateDirectory(logDirectory);
  const shimDirectory = join(logDirectory, "bin");
  try {
    mkdirSync(shimDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  privateDirectory(shimDirectory);
  const scriptPath = fileURLToPath(import.meta.url);
  const quoted = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const contents = `#!/bin/sh\nexec node ${quoted(scriptPath)}`
    + ` --log ${quoted(join(logDirectory, "browser-commands.ndjson"))}`
    + ` --request-log ${quoted(join(logDirectory, "browser-requests.ndjson"))}`
    + ` --shim-dir ${quoted(shimDirectory)} -- "$@"\n`;
  const shimPath = join(shimDirectory, "agent-browser");
  let descriptor;
  try {
    descriptor = openSync(shimPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o700);
    fchmodSync(descriptor, 0o700);
    writeSync(descriptor, contents);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = openSync(shimPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(existing);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid()
        || (stat.mode & 0o7777) !== 0o700 || readFileSync(existing, "utf8") !== contents) {
        throw new Error("existing browser logger shim is unsafe or outdated");
      }
    } finally {
      closeSync(existing);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  process.stdout.write(`${JSON.stringify({ shimDirectory, commandLog: join(logDirectory, "browser-commands.ndjson"), requestLog: join(logDirectory, "browser-requests.ndjson") })}\n`);
}

if (process.argv[2] === "--prepare") {
  try {
    if (process.argv.length !== 4) throw new Error("usage: --prepare ABSOLUTE_PRIVATE_DIRECTORY");
    prepareShim(process.argv[3]);
  } catch {
    process.stderr.write("FAIL browser logger preparation\n");
    process.exitCode = 2;
  }
  process.exit();
}

const args = process.argv.slice(2);
let cursor = 0;
if (args[cursor] !== "--log") {
  process.stderr.write("FAIL browser command logger arguments\n");
  process.exit(2);
}
cursor += 1;
const logPath = args[cursor];
cursor += 1;
let requestLogPath = null;
if (args[cursor] === "--request-log") {
  cursor += 1;
  requestLogPath = args[cursor];
  cursor += 1;
}
const shimFlag = args[cursor];
const shimDirectory = args[cursor + 1];
const separator = args[cursor + 2];
const browserArgs = args.slice(cursor + 3);
if (shimFlag !== "--shim-dir" || separator !== "--") {
  process.stderr.write("FAIL browser command logger arguments\n");
  process.exit(2);
}
if (!isAbsolute(logPath) || !isAbsolute(shimDirectory) || browserArgs.length === 0) {
  process.stderr.write("FAIL browser command logger paths\n");
  process.exit(2);
}
if (requestLogPath !== null && !isAbsolute(requestLogPath)) {
  process.stderr.write("FAIL browser request logger path\n");
  process.exit(2);
}
if (requestLogPath === logPath) {
  process.stderr.write("FAIL browser request logger path must differ from command log\n");
  process.exit(2);
}

const logParent = realpathSync(dirname(logPath));
const parentStat = statSync(logParent);
if (!parentStat.isDirectory() || parentStat.uid !== process.getuid() || (parentStat.mode & 0o077) !== 0) {
  process.stderr.write("FAIL browser command logger directory\n");
  process.exit(2);
}
if (requestLogPath !== null && realpathSync(dirname(requestLogPath)) !== logParent) {
  process.stderr.write("FAIL browser request logger directory\n");
  process.exit(2);
}

const shimRoot = realpathSync(shimDirectory);
let browserBinary = "";
for (const candidateDirectory of (process.env.PATH || "").split(":")) {
  if (!candidateDirectory || !isAbsolute(candidateDirectory)) continue;
  let candidateRoot;
  try {
    candidateRoot = realpathSync(candidateDirectory);
  } catch {
    continue;
  }
  if (candidateRoot === shimRoot) continue;
  const candidate = join(candidateDirectory, "agent-browser");
  try {
    accessSync(candidate, constants.X_OK);
    browserBinary = resolve(candidate);
    break;
  } catch {
    continue;
  }
}
if (!browserBinary) {
  process.stderr.write("FAIL agent-browser executable unavailable\n");
  process.exit(127);
}

const allowedVerbs = new Set([
  "a11y", "auth", "batch", "check", "click", "close", "cookies", "dialog",
  "eval", "fill", "find", "focus", "get", "hover", "network", "open",
  "press", "read", "screenshot", "scroll", "select", "session", "snapshot",
  "tab", "type", "wait",
]);
const allowedSubverbs = new Set([
  "har", "start", "stop", "get", "set", "requests", "request", "route",
  "new", "close", "list", "info", "role", "text", "label", "placeholder",
]);
let browserSession = null;
for (let index = 0; index < browserArgs.length - 1; index += 1) {
  if (browserArgs[index] === "--session" && /^[-a-zA-Z0-9_]{1,80}$/.test(browserArgs[index + 1])) {
    browserSession = browserArgs[index + 1];
    break;
  }
}
if (browserSession === null && /^[-a-zA-Z0-9_]{1,80}$/.test(process.env.AGENT_BROWSER_SESSION || "")) {
  browserSession = process.env.AGENT_BROWSER_SESSION;
}
let verb = "other";
let subverb = null;
const skillReferenceIndex = browserArgs.findIndex((arg, index) => index < 4 && arg === "skills");
const isSkillReference = skillReferenceIndex >= 0
  && ["get", "list"].includes(browserArgs[skillReferenceIndex + 1]);
for (let index = 0; index < browserArgs.length; index += 1) {
  if (!allowedVerbs.has(browserArgs[index])) continue;
  verb = browserArgs[index];
  const next = browserArgs[index + 1];
  if (allowedSubverbs.has(next)) subverb = next;
  break;
}
if (isSkillReference) {
  verb = "skills";
  subverb = browserArgs[skillReferenceIndex + 1];
}

const startedAt = new Date();
const startedNs = process.hrtime.bigint();
const eventId = randomUUID();
let runId = null;
if (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(process.env.SELFHOST_RUN_ID || "")) {
  runId = process.env.SELFHOST_RUN_ID;
}
if (runId === null && browserSession?.startsWith("auto-stack-")) {
  const candidateRunId = browserSession.slice("auto-stack-".length);
  if (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(candidateRunId)) {
    runId = candidateRunId;
  }
}
let agentId = null;
if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(process.env.SELFHOST_AGENT_ID || "")) {
  agentId = process.env.SELFHOST_AGENT_ID;
}
const safeRouteSegments = new Set([
  "api", "v1", "v2", "v3", "trpc", "auth", "login", "callback", "credentials",
  "csrf", "onboarding", "claim", "onboard", "user", "apiKeys", "create",
  "app", "version", "setPreferences", "torrents", "categories", "createCategory",
  "editCategory", "config", "host", "rootfolder", "downloadclient", "schema",
  "test", "applications", "ping", "settings", "public", "initialize",
  "jellyfin", "radarr", "sonarr", "System", "Info", "Public", "Users",
  "AuthenticateByName", "Sessions", "Logout", "Library", "VirtualFolders",
  "items", "system", "status", "web", "index.html", "dashboard",
]);
const safeExactRoutes = new Set([
  "/api/v1/applications",
  "/api/v1/applications/schema",
  "/api/v1/applications/test",
  "/api/v1/auth/jellyfin",
  "/api/v1/config/host",
  "/api/v1/settings/initialize",
  "/api/v1/settings/jellyfin",
  "/api/v1/settings/jellyfin/library",
  "/api/v1/settings/public",
  "/api/v1/settings/radarr",
  "/api/v1/settings/radarr/test",
  "/api/v1/settings/sonarr",
  "/api/v1/settings/sonarr/test",
  "/api/v2/app/preferences",
  "/api/v2/app/setPreferences",
  "/api/v2/app/version",
  "/api/v2/app/webapiVersion",
  "/api/v2/auth/login",
  "/api/v2/sync/maindata",
  "/api/v2/torrents/categories",
  "/api/v2/torrents/createCategory",
  "/api/v2/torrents/editCategory",
  "/api/v2/torrents/info",
  "/api/v2/transfer/info",
  "/api/v3/config/host",
  "/api/v3/downloadclient",
  "/api/v3/downloadclient/schema",
  "/api/v3/downloadclient/test",
  "/api/v3/rootfolder",
  "/api/v3/system/status",
]);

function privateLogDescriptor(path, flags) {
  const descriptor = openSync(path, flags | constants.O_NOFOLLOW, 0o600);
  const stat = fstatSync(descriptor);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600) {
    closeSync(descriptor);
    throw new Error("unsafe browser log");
  }
  return descriptor;
}

function appendPrivateEntry(path, entry) {
  const descriptor = privateLogDescriptor(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
  try {
    writeSync(descriptor, `${JSON.stringify(entry)}\n`);
  } finally {
    closeSync(descriptor);
  }
}

function existingRequestFingerprints() {
  const seen = new Map();
  let descriptor;
  try {
    descriptor = privateLogDescriptor(requestLogPath, constants.O_RDONLY);
  } catch (error) {
    if (error.code === "ENOENT") return seen;
    throw error;
  }
  try {
    if (fstatSync(descriptor).size > 64 * 1024 * 1024) throw new Error("browser request log is too large");
    const contents = readFileSync(descriptor, "utf8");
    for (const line of contents.split("\n")) {
      if (line === "") continue;
      const entry = JSON.parse(line);
      if (typeof entry.fingerprint === "string") seen.set(entry.fingerprint, entry.status);
    }
  } finally {
    closeSync(descriptor);
  }
  return seen;
}

function routeTemplate(pathname) {
  if (safeExactRoutes.has(pathname)) return pathname;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const safe = segments.map((segment, index) => {
    if (safeRouteSegments.has(segment)) return segment;
    if (index === 2 && segments[0] === "api" && segments[1] === "trpc"
      && /^(?:onboard|user|apiKeys|widget|app|integration)\.[A-Za-z][A-Za-z0-9]+$/.test(segment)) {
      return segment;
    }
    return ":value";
  });
  return `/${safe.join("/")}`;
}

function sanitizedRequest(request) {
  if (!request || typeof request !== "object" || typeof request.url !== "string") return null;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const method = String(request.method || "").toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(method)) return null;
  const queryKeys = [...new Set([...url.searchParams.keys()].map((key) => {
    if (/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(key)) return key;
    return ":key";
  }))].sort();
  let status = null;
  if (Number.isInteger(request.status) && request.status >= 0 && request.status <= 599) {
    status = request.status;
  }
  let mimeType = null;
  if (typeof request.mimeType === "string"
    && /^[A-Za-z0-9.+-]{1,40}\/[A-Za-z0-9.+-]{1,40}$/.test(request.mimeType)) {
    mimeType = request.mimeType;
  }
  let resourceType = "Other";
  if (["Document", "Fetch", "XHR", "Script", "Stylesheet", "Image", "Other"].includes(request.resourceType)) {
    resourceType = request.resourceType;
  }
  const fingerprint = createHash("sha256")
    .update(`${browserSession}\0${request.requestId || ""}\0${request.timestamp || ""}\0${method}\0${url.origin}\0${routeTemplate(url.pathname)}`)
    .digest("hex");
  return {
    schemaVersion: 1,
    kind: "browser-http-request",
    fingerprint,
    commandEventId: eventId,
    runId,
    agentId,
    session: browserSession,
    timestampMs: Number.isFinite(request.timestamp) ? request.timestamp : null,
    origin: url.origin,
    method,
    route: routeTemplate(url.pathname),
    queryKeys,
    status,
    mimeType,
    resourceType,
  };
}

function captureNetworkMetadata() {
  if (requestLogPath === null) return;
  if (isSkillReference) return;
  if (browserSession === null) {
    appendPrivateEntry(requestLogPath, { schemaVersion: 1, kind: "capture-gap", commandEventId: eventId, runId, agentId, reason: "NO_SESSION" });
    return;
  }
  const result = spawnSync(browserBinary, ["--session", browserSession, "--json", "network", "requests"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    appendPrivateEntry(requestLogPath, { schemaVersion: 1, kind: "capture-gap", commandEventId: eventId, runId, agentId, session: browserSession, reason: "BROWSER_QUERY_FAILED" });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    appendPrivateEntry(requestLogPath, { schemaVersion: 1, kind: "capture-gap", commandEventId: eventId, runId, agentId, session: browserSession, reason: "INVALID_JSON" });
    return;
  }
  if (payload.success !== true || !Array.isArray(payload.data?.requests) || payload.data.requests.length > 10_000) {
    appendPrivateEntry(requestLogPath, { schemaVersion: 1, kind: "capture-gap", commandEventId: eventId, runId, agentId, session: browserSession, reason: "INVALID_RESPONSE" });
    return;
  }
  const seen = existingRequestFingerprints();
  for (const request of payload.data.requests) {
    const entry = sanitizedRequest(request);
    if (entry === null) continue;
    if (seen.has(entry.fingerprint)) {
      const previousStatus = seen.get(entry.fingerprint);
      if (previousStatus !== null || entry.status === null) continue;
    }
    appendPrivateEntry(requestLogPath, entry);
    seen.set(entry.fingerprint, entry.status);
  }
}

function captureWithoutBlocking() {
  try {
    captureNetworkMetadata();
  } catch {
    process.stderr.write("WARN browser request capture unavailable\n");
  }
}

const closesSession = verb === "close" || (verb === "session" && subverb === "close");
if (closesSession) captureWithoutBlocking();
const child = spawn(browserBinary, browserArgs, {
  env: process.env,
  stdio: ["pipe", "inherit", "inherit"],
});
process.stdin.pipe(child.stdin);

function appendResult(exitCode, signal, launchError = false) {
  const entry = {
    schemaVersion: 1,
    kind: "browser-command",
    eventId,
    runId,
    agentId,
    startedAt: startedAt.toISOString(),
    elapsedMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
    session: browserSession,
    verb,
    subverb,
    argumentCount: browserArgs.length,
    exitCode,
    signal,
    launchError,
  };
  appendPrivateEntry(logPath, entry);
}

child.once("error", () => {
  appendResult(127, null, true);
  process.exitCode = 127;
});
child.once("close", (code, signal) => {
  if (process.exitCode === 127) return;
  appendResult(code, signal);
  if (!closesSession) captureWithoutBlocking();
  process.exitCode = code ?? 1;
});
