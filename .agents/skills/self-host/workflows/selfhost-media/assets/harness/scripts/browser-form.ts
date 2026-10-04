#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadSession,
  REPO_ROOT,
  requireSessionPasswordScheme,
  validateBrowserPageUrl,
} from "./lib/session-context.ts";

const FAIL_LINE = "FAIL browser form refs\n";
const MAX_BROWSER_OUTPUT_BYTES = 262_144;
const BROWSER_ENVIRONMENT_KEYS = [
  "AGENT_BROWSER_SESSION", "HOME", "LANG", "LC_ALL", "PATH",
  "SELFHOST_AGENT_ID", "SELFHOST_RUN_ID", "TMPDIR", "TZ", "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME",
];

function browserChildEnvironment() {
  const environment = {};
  for (const key of BROWSER_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }
  if (!environment.PATH) {
    environment.PATH = "/usr/local/bin:/usr/bin:/bin";
  }
  return environment;
}

function runBrowser(executable, args) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: REPO_ROOT,
        env: browserChildEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
        windowsHide: true,
      });
    } catch (error) {
      resolveResult({ kind: "spawn-error", error });
      return;
    }
    let stdout = "";
    let stdoutBytes = 0;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_BROWSER_OUTPUT_BYTES) {
        child.kill();
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.resume();
    child.once("error", (error) => resolveResult({ kind: "spawn-error", error }));
    child.once("close", (status, signal) => {
      if (stdoutBytes > MAX_BROWSER_OUTPUT_BYTES || status !== 0 || signal) {
        resolveResult({ kind: "failed" });
        return;
      }
      resolveResult({ kind: "success", stdout });
    });
  });
}

async function invokeBrowser(args) {
  let result = await runBrowser("agent-browser", args);
  if (result.kind === "spawn-error" && result.error?.code === "ENOENT") {
    result = await runBrowser("bunx", ["--bun", "agent-browser", ...args]);
  }
  if (result.kind !== "success") {
    throw new Error("browser form action failed");
  }
  return result.stdout;
}

function browserSession(session) {
  const expected = `auto-stack-${session?.runId || ""}`;
  if (session?.manifest?.AGENT_BROWSER_SESSION !== expected || !/^auto-stack-[a-z0-9][a-z0-9_-]{0,39}$/.test(expected)) {
    throw new Error("browser session is invalid");
  }
  return expected;
}

export function formRefsFromSnapshot(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("browser form snapshot is invalid");
  }
  if (parsed?.success !== true || typeof parsed.data?.refs !== "object" || parsed.data.refs === null) {
    throw new Error("browser form snapshot is invalid");
  }
  const refs = [];
  for (const [ref, metadata] of Object.entries(parsed.data.refs)) {
    if (!/^e[1-9][0-9]{0,5}$/.test(ref) || typeof metadata !== "object" || metadata === null) {
      continue;
    }
    if (typeof metadata.role !== "string" || typeof metadata.name !== "string") {
      continue;
    }
    refs.push({ ref: `@${ref}`, role: metadata.role, name: metadata.name });
  }
  refs.sort((left, right) => Number(left.ref.slice(2)) - Number(right.ref.slice(2)));
  return { schemaVersion: 1, refs };
}

export async function browserFormRefs(session, options = {}) {
  requireSessionPasswordScheme(session);
  const scopedSession = browserSession(session);
  const invoke = options.invokeBrowserImplementation || invokeBrowser;
  const currentUrl = await invoke(["--session", scopedSession, "get", "url"]);
  validateBrowserPageUrl(session, currentUrl);
  const snapshot = await invoke(["--session", scopedSession, "snapshot", "-i", "--json"]);
  return formRefsFromSnapshot(snapshot);
}

async function main() {
  const [runId, ...rest] = Bun.argv.slice(2);
  if (!runId || rest.length > 0) {
    throw new Error("one RUN_ID is required");
  }
  const result = await browserFormRefs(loadSession(runId));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (Bun.argv[1] && resolve(Bun.argv[1]) === scriptPath) {
  main().catch(() => {
    process.stdout.write(FAIL_LINE);
    process.exitCode = 1;
  });
}
