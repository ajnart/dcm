#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  openSync,
  realpathSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const [logFlag, logPath, shimFlag, shimDirectory, separator, ...browserArgs] = process.argv.slice(2);
if (logFlag !== "--log" || shimFlag !== "--shim-dir" || separator !== "--") {
  process.stderr.write("FAIL browser command logger arguments\n");
  process.exit(2);
}
if (!isAbsolute(logPath) || !isAbsolute(shimDirectory) || browserArgs.length === 0) {
  process.stderr.write("FAIL browser command logger paths\n");
  process.exit(2);
}

const logParent = realpathSync(dirname(logPath));
const parentStat = statSync(logParent);
if (!parentStat.isDirectory() || parentStat.uid !== process.getuid() || (parentStat.mode & 0o077) !== 0) {
  process.stderr.write("FAIL browser command logger directory\n");
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
let verb = "other";
let subverb = null;
for (let index = 0; index < browserArgs.length; index += 1) {
  if (!allowedVerbs.has(browserArgs[index])) continue;
  verb = browserArgs[index];
  const next = browserArgs[index + 1];
  if (allowedSubverbs.has(next)) subverb = next;
  break;
}

const startedAt = new Date();
const startedNs = process.hrtime.bigint();
let inputBytes = 0;
const child = spawn(browserBinary, browserArgs, {
  env: process.env,
  stdio: ["pipe", "inherit", "inherit"],
});
process.stdin.on("data", (chunk) => { inputBytes += chunk.byteLength; });
process.stdin.pipe(child.stdin);

function appendResult(exitCode, signal, launchError = false) {
  const entry = {
    schemaVersion: 1,
    kind: "browser-command",
    eventId: randomUUID(),
    startedAt: startedAt.toISOString(),
    elapsedMs: Number(process.hrtime.bigint() - startedNs) / 1_000_000,
    session: browserSession,
    verb,
    subverb,
    argumentCount: browserArgs.length,
    inputBytes,
    exitCode,
    signal,
    launchError,
  };
  let descriptor;
  try {
    descriptor = openSync(logPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600) {
      throw new Error("unsafe browser command log");
    }
    writeSync(descriptor, `${JSON.stringify(entry)}\n`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

child.once("error", () => {
  appendResult(127, null, true);
  process.exitCode = 127;
});
child.once("close", (code, signal) => {
  if (process.exitCode === 127) return;
  appendResult(code, signal);
  process.exitCode = code ?? 1;
});
