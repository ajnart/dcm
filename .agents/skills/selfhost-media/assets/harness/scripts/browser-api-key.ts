#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadSession,
  REPO_ROOT,
  requireSessionPasswordScheme,
  storeHomarrApiKey,
  validateHomarrApiKey,
  writeSessionConnections,
} from "./lib/session-context.ts";

const SERVICE_SECRET_KEYS = new Map([
  ["prowlarr", "PROWLARR_API_KEY"],
  ["radarr", "RADARR_API_KEY"],
  ["seerr", "SEERR_API_KEY"],
  ["sonarr", "SONARR_API_KEY"],
]);
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

function validateSelector(selector) {
  if (typeof selector !== "string" || !/^@e[1-9][0-9]{0,5}$/.test(selector)) {
    throw new Error("browser API-key selector is invalid");
  }
  return selector;
}

function validateBrowserSession(session) {
  const expected = `auto-stack-${session?.runId || ""}`;
  if (
    !session
    || typeof session !== "object"
    || !session.manifest
    || session.manifest.AGENT_BROWSER_SESSION !== expected
    || !/^auto-stack-[a-z0-9][a-z0-9_-]{0,39}$/.test(expected)
  ) {
    throw new Error("browser session is invalid");
  }
  return expected;
}

function executableWasNotFound(result) {
  return result.kind === "spawn-error" && result.error?.code === "ENOENT";
}

function runBrowser(executable, args, input) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: REPO_ROOT,
        env: browserChildEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30_000,
        windowsHide: true,
      });
    } catch (error) {
      resolveResult({ kind: "spawn-error", error });
      return;
    }

    let launched = false;
    let closeResult;
    let inputSettled = false;
    let stdinFailed = false;
    let settled = false;
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
      if (!stdinFailed && closeResult.status === 0 && !closeResult.signal) {
        finish({ kind: "success", stdout });
        return;
      }
      finish({ kind: "failed" });
    }

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > 2_048) {
        child.kill();
        finish({ kind: "failed" });
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.resume();
    child.once("error", (error) => {
      if (!launched) {
        finish({ kind: "spawn-error", error });
        return;
      }
      finish({ kind: "failed" });
    });
    child.once("spawn", () => {
      launched = true;
      child.stdin.once("error", () => {
        stdinFailed = true;
        inputSettled = true;
        finishAfterInputAndClose();
      });
      child.stdin.end(input || "", "utf8", () => {
        inputSettled = true;
        finishAfterInputAndClose();
      });
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

async function invokeBrowser(args, input) {
  let result = await runBrowser("agent-browser", args, input);
  if (executableWasNotFound(result)) {
    result = await runBrowser("bunx", ["--bun", "agent-browser", ...args], input);
  }
  if (result.kind !== "success") {
    throw new Error("browser API-key action failed");
  }
  return result.stdout;
}

function normalizeCapturedValue(raw) {
  let value = raw.trim();
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      value = parsed;
    }
  } catch {
    // Plain output is the normal agent-browser value format.
  }
  return value;
}

function serviceApiKey(session, service) {
  const secretKey = SERVICE_SECRET_KEYS.get(service);
  if (!secretKey) {
    throw new Error("service does not expose a harness-managed API key");
  }
  const value = session.secrets[secretKey];
  if (!/^[0-9a-f]{32}$/.test(value)) {
    throw new Error("session API key is invalid");
  }
  return value;
}

export async function captureBrowserApiKey(session, service, selector) {
  const browserSession = validateBrowserSession(session);
  const safeSelector = validateSelector(selector);
  const raw = await invokeBrowser(
    ["--session", browserSession, "get", "value", safeSelector],
    undefined,
  );
  const captured = normalizeCapturedValue(raw);

  if (service === "homarr") {
    storeHomarrApiKey(session, validateHomarrApiKey(captured));
    writeSessionConnections(session.runId);
    return;
  }
  if (captured !== serviceApiKey(session, service)) {
    throw new Error("browser API key does not match the managed session");
  }
}

export async function fillBrowserApiKey(session, service, selector) {
  const browserSession = validateBrowserSession(session);
  const safeSelector = validateSelector(selector);
  if (service === "homarr") {
    throw new Error("Homarr API keys are capture-only");
  }
  const apiKey = serviceApiKey(session, service);
  const commands = [["fill", safeSelector, apiKey]];
  await invokeBrowser(
    ["--session", browserSession, "batch", "--bail", "--json"],
    `${JSON.stringify(commands)}\n`,
  );
}

async function main() {
  const [action, runId, service, selector] = Bun.argv.slice(2);
  if (!action || !runId || !service || !selector || Bun.argv.length !== 6) {
    throw new Error("capture|fill, RUN_ID, SERVICE, and @eN are required");
  }
  if (![...SERVICE_SECRET_KEYS.keys(), "homarr"].includes(service)) {
    throw new Error("unsupported API-key service");
  }
  const session = loadSession(runId);
  requireSessionPasswordScheme(session);
  if (action === "capture") {
    await captureBrowserApiKey(session, service, selector);
    process.stdout.write("PASS browser API key captured\n");
    return;
  }
  if (action === "fill") {
    await fillBrowserApiKey(session, service, selector);
    process.stdout.write("PASS browser API key filled\n");
    return;
  }
  throw new Error("unsupported browser API-key action");
}

const scriptPath = fileURLToPath(import.meta.url);
if (Bun.argv[1] && resolve(Bun.argv[1]) === scriptPath) {
  main().catch(() => {
    process.stdout.write("FAIL browser API-key action\n");
    process.exitCode = 1;
  });
}
