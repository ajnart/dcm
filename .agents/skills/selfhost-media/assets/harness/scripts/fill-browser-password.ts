#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveSessionPassword,
  loadSession,
  REPO_ROOT,
} from "./lib/session-context.ts";

const MAX_SELECTORS = 4;
export const BROWSER_PASSWORD_PASS_LINE = "PASS browser password filled\n";
export const BROWSER_PASSWORD_FAIL_LINE = "FAIL browser password fill\n";

const BROWSER_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "MISE_CACHE_DIR",
  "MISE_CONFIG_DIR",
  "MISE_DATA_DIR",
  "MISE_GLOBAL_CONFIG_FILE",
  "MISE_STATE_DIR",
  "MISE_SYSTEM_CONFIG_FILE",
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
        finish({ kind: "success" });
        return;
      }
      finish({ kind: "failed" });
    }

    if (child.stdout && typeof child.stdout.resume === "function") {
      child.stdout.resume();
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

  let spawnImplementation = spawn;
  if (typeof options.spawnImplementation === "function") {
    spawnImplementation = options.spawnImplementation;
  }
  const password = deriveSessionPassword(session);
  const commands = safeSelectors.map((selector) => ["fill", selector, password]);
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
  const input = `${JSON.stringify(commands)}\n`;
  let result = await runBrowserChild(
    spawnImplementation,
    "agent-browser",
    browserArguments,
    spawnOptions,
    input,
  );
  if (executableWasNotFound(result)) {
    result = await runBrowserChild(
      spawnImplementation,
      "mise",
      ["exec", "node@24", "--", "agent-browser", ...browserArguments],
      spawnOptions,
      input,
    );
  }
  if (result.kind !== "success") {
    throw new Error("browser password fill failed");
  }
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
