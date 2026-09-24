#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveSessionPassword,
  loadSession,
  REPO_ROOT,
  requireSessionPasswordScheme,
  validateBrowserPageUrl,
} from "./lib/session-context.ts";

const MAX_SELECTORS = 4;
export const BROWSER_PASSWORD_PASS_LINE = "PASS browser password filled\n";
export const BROWSER_PASSWORD_FAIL_LINE = "FAIL browser password fill\n";

const BROWSER_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
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

function executableWasNotFound(outcome) {
  if (!outcome || outcome.kind !== "spawn-error") {
    return false;
  }
  const error = outcome.error;
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

function runBrowserChild(
  spawnImplementation,
  executable,
  args,
  spawnOptions,
  input,
) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawnImplementation(executable, args, spawnOptions);
    } catch (error) {
      resolveResult({ kind: "spawn-error", error });
      return;
    }

    if (
      !child
      || typeof child.once !== "function"
      || !child.stdin
      || typeof child.stdin.end !== "function"
    ) {
      resolveResult({ kind: "failed" });
      return;
    }

    let closeResult;
    let inputSettled = false;
    let launched = false;
    let settled = false;
    let stdinFailed = false;
    let stdout = "";
    let stdoutBytes = 0;

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      resolveResult(result);
    }

    function finishAfterInputAndClose() {
      if (!inputSettled || !closeResult) {
        return;
      }
      if (
        !stdinFailed
        && closeResult.status === 0
        && (closeResult.signal === null || closeResult.signal === undefined)
      ) {
        finish({ kind: "success", stdout });
        return;
      }
      finish({ kind: "failed" });
    }

    if (child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > 2_048) {
          child.kill?.();
          finish({ kind: "failed" });
          return;
        }
        stdout += chunk.toString("utf8");
      });
    }
    if (child.stderr && typeof child.stderr.resume === "function") {
      child.stderr.resume();
    }
    if (typeof child.stdin.once === "function") {
      child.stdin.once("error", () => {
        stdinFailed = true;
        inputSettled = true;
        finishAfterInputAndClose();
      });
    }

    child.once("error", (error) => {
      if (!launched) {
        finish({ kind: "spawn-error", error });
        return;
      }
      finish({ kind: "failed" });
    });
    child.once("spawn", () => {
      launched = true;
      try {
        child.stdin.end(input, "utf8", () => {
          inputSettled = true;
          finishAfterInputAndClose();
        });
      } catch {
        finish({ kind: "failed" });
      }
    });
    child.once("close", (status, signal) => {
      if (!launched) {
        return;
      }
      closeResult = { signal, status };
      finishAfterInputAndClose();
    });
  });
}

function validatedSelectors(selectors) {
  if (!Array.isArray(selectors) || selectors.length < 1 || selectors.length > MAX_SELECTORS) {
    throw new Error("browser password selectors are invalid");
  }
  const unique = new Set();
  for (const selector of selectors) {
    if (typeof selector !== "string" || !/^@e[1-9][0-9]{0,5}$/.test(selector)) {
      throw new Error("browser password selector is invalid");
    }
    if (unique.has(selector)) {
      throw new Error("browser password selectors must be unique");
    }
    unique.add(selector);
  }
  return [...selectors];
}

function structuredBrowserData(raw, session) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("browser password field inspection failed");
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || parsed.success !== true
    || typeof parsed.data !== "object"
    || parsed.data === null
    || parsed.error !== null
  ) {
    throw new Error("browser password field inspection failed");
  }
  if (typeof parsed.data.origin === "string") {
    validateBrowserPageUrl(session, parsed.data.origin);
  }
  return parsed.data;
}

async function validatePasswordFields(session, selectors, invoke) {
  const browserSession = session.manifest.AGENT_BROWSER_SESSION;
  const inspected = [];
  for (const selector of selectors) {
    const typeData = structuredBrowserData(await invoke([
      "--session", browserSession, "get", "attr", selector, "type", "--json"
    ]), session);
    const disabledData = structuredBrowserData(await invoke([
      "--session", browserSession, "get", "attr", selector, "disabled", "--json"
    ]), session);
    const readOnlyData = structuredBrowserData(await invoke([
      "--session", browserSession, "get", "attr", selector, "readonly", "--json"
    ]), session);
    const enabledData = structuredBrowserData(await invoke([
      "--session", browserSession, "is", "enabled", selector, "--json"
    ]), session);
    if (
      !Object.hasOwn(typeData, "value")
      || !Object.hasOwn(disabledData, "value")
      || !Object.hasOwn(readOnlyData, "value")
      || typeof enabledData.enabled !== "boolean"
      || (typeData.value !== null && typeof typeData.value !== "string")
      || (disabledData.value !== null && typeof disabledData.value !== "string")
      || (readOnlyData.value !== null && typeof readOnlyData.value !== "string")
    ) {
      throw new Error("browser password field inspection failed");
    }
    inspected.push({
      disabled: disabledData.value,
      enabled: enabledData.enabled,
      readOnly: readOnlyData.value,
      selector,
      type: typeData.value,
    });
  }
  for (const field of inspected) {
    if (
      field.type !== "password"
      || field.disabled !== null
      || field.readOnly !== null
      || !field.enabled
    ) {
      throw new Error("browser password field is invalid");
    }
  }
}

export async function fillBrowserPassword(session, selectors, options = {}) {
  const safeSelectors = validatedSelectors(selectors);
  const expectedBrowserSession = `auto-stack-${session?.runId || ""}`;
  if (
    !session
    || typeof session !== "object"
    || !session.manifest
    || typeof session.manifest.AGENT_BROWSER_SESSION !== "string"
    || !/^auto-stack-[a-z0-9][a-z0-9_-]{0,39}$/.test(
      session.manifest.AGENT_BROWSER_SESSION,
    )
    || session.manifest.AGENT_BROWSER_SESSION !== expectedBrowserSession
  ) {
    throw new Error("browser session is invalid");
  }
  requireSessionPasswordScheme(session);

  let spawnImplementation = spawn;
  if (typeof options.spawnImplementation === "function") {
    spawnImplementation = options.spawnImplementation;
  }
  const browserArguments = [
    "--session",
    session.manifest.AGENT_BROWSER_SESSION,
    "batch",
    "--bail",
    "--json",
  ];
  const spawnOptions = {
    cwd: REPO_ROOT,
    env: browserChildEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
    windowsHide: true,
  };
  async function invoke(args, stdin = "") {
    let result = await runBrowserChild(
      spawnImplementation,
      "agent-browser",
      args,
      spawnOptions,
      stdin,
    );
    if (executableWasNotFound(result)) {
      result = await runBrowserChild(
        spawnImplementation,
        "bunx",
        ["--bun", "agent-browser", ...args],
        spawnOptions,
        stdin,
      );
    }
    if (result.kind !== "success") {
      throw new Error("browser password fill failed");
    }
    return result.stdout;
  }
  let currentUrl = options.pageUrl;
  if (typeof currentUrl !== "string") {
    currentUrl = await invoke([
      "--session",
      session.manifest.AGENT_BROWSER_SESSION,
      "get",
      "url",
    ]);
  }
  validateBrowserPageUrl(session, currentUrl);
  await validatePasswordFields(session, safeSelectors, invoke);
  const password = deriveSessionPassword(session);
  const commands = safeSelectors.map((selector) => ["fill", selector, password]);
  const input = `${JSON.stringify(commands)}\n`;
  await invoke(browserArguments, input);
}

async function main() {
  const args = Bun.argv.slice(2);
  if (args.length < 2 || args.length > MAX_SELECTORS + 1) {
    throw new Error("RUN_ID and password selectors are required");
  }
  const session = loadSession(args[0]);
  await fillBrowserPassword(session, args.slice(1));
  process.stdout.write(BROWSER_PASSWORD_PASS_LINE);
}

const scriptPath = fileURLToPath(import.meta.url);
if (Bun.argv[1] && resolve(Bun.argv[1]) === scriptPath) {
  main().catch(() => {
    process.stdout.write(BROWSER_PASSWORD_FAIL_LINE);
    process.exitCode = 1;
  });
}
