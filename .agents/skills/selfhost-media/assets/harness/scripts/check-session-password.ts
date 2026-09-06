#!/usr/bin/env bun

import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  BROWSER_PASSWORD_FAIL_LINE,
  BROWSER_PASSWORD_PASS_LINE,
  fillBrowserPassword,
} from "./fill-browser-password.ts";
import {
  classifySessionPasswordScheme,
  deriveSessionPassword,
  REPO_ROOT,
  SESSION_PASSWORD_SCHEME,
} from "./lib/session-context.ts";

const NODE_DEBUG_RUNNER_ARGUMENT = "--node-debug-runner";
const NODE_DEBUG_CAPTURE_SENTINEL = "SAFE node debug fixture stderr captured\n";
const OMITTED_ENVIRONMENT_SENTINEL = "must-not-reach-browser-child";
const LEGACY_ALLOWED_SESSION_COMMANDS = [
  "doctor",
  "urls",
  "env",
  "status",
  "mcp-verify",
  "down",
  "destroy",
];
const CURRENT_SCHEME_SESSION_COMMANDS = [
  "up",
  "keys",
  "bootstrap",
  "verify",
  "browser-password",
  "homarr-key",
  "homarr-finalize",
  "mcp-config",
  "credentials",
];

function sessionFor(runId, keyByte) {
  return {
    runId,
    manifest: {
      AGENT_BROWSER_SESSION: `auto-stack-${runId}`,
      SESSION_PASSWORD_SCHEME,
    },
    secrets: {
      HOMARR_ENCRYPTION_KEY: keyByte.repeat(64),
    },
  };
}

function simulatedChild({
  signal = null,
  spawnError,
  status = 0,
  stderr = "",
  stdout = "",
} = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let input = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    input += chunk;
  });
  child.stdin.once("finish", () => {
    queueMicrotask(() => {
      child.emit("close", status, signal);
    });
  });
  child.capturedInput = () => input;

  queueMicrotask(() => {
    if (spawnError !== undefined) {
      child.emit("error", spawnError);
      return;
    }
    child.emit("spawn");
    child.stdout.end(stdout);
    child.stderr.end(stderr);
  });
  return child;
}

async function withoutProcessOutput(operation) {
  let stderrCalls = 0;
  let stdoutCalls = 0;
  const originalStderrWrite = process.stderr.write;
  const originalStdoutWrite = process.stdout.write;
  process.stderr.write = () => {
    stderrCalls += 1;
    return true;
  };
  process.stdout.write = () => {
    stdoutCalls += 1;
    return true;
  };
  try {
    await operation();
  } finally {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
  }
  return { stderrCalls, stdoutCalls };
}

async function assertNoFallback(session, resultFactory) {
  let calls = 0;
  await assert.rejects(
    fillBrowserPassword(session, ["@e7"], {
      spawnImplementation: () => {
        calls += 1;
        return resultFactory();
      },
    }),
    (error) => {
      assert.equal(error.message, "browser password fill failed");
      return true;
    },
  );
  assert.equal(calls, 1);
}

function captureChild(executable, args, options) {
  return new Promise((resolveResult, rejectResult) => {
    const child = realSpawn(executable, args, options);
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", rejectResult);
    child.once("close", (status, signal) => {
      resolveResult({ signal, status, stderr, stdout });
    });
  });
}

async function runNodeDebugRunner() {
  const fixtureSession = sessionFor("node-debug", "4");
  await fillBrowserPassword(fixtureSession, ["@e8"], {
    spawnImplementation: (_executable, _args, options) => realSpawn(
      process.execPath,
      [
        "-e",
        "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));",
      ],
      options,
    ),
  });
}

function emitNodeDebugCaptureFixture() {
  process.stderr.write(NODE_DEBUG_CAPTURE_SENTINEL);
}

async function captureParentStderr(operation) {
  let captured = "";
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, encoding, callback) => {
    if (Buffer.isBuffer(chunk)) {
      captured += chunk.toString(typeof encoding === "string" ? encoding : "utf8");
    } else {
      captured += String(chunk);
    }
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }
    return true;
  };
  try {
    await operation();
  } finally {
    process.stderr.write = originalWrite;
  }
  return captured;
}

async function runNodeDebugRegression() {
  const fixtureSession = sessionFor("node-debug", "4");
  const fixturePassword = deriveSessionPassword(fixtureSession);
  const fixturePath = fileURLToPath(import.meta.url);
  const parentStderr = await captureParentStderr(async () => {
    emitNodeDebugCaptureFixture();
  });
  assert.equal(parentStderr.includes(NODE_DEBUG_CAPTURE_SENTINEL), true);
  assert.equal(parentStderr.includes(fixturePassword), false);
  assert.equal(
    parentStderr.includes(fixtureSession.secrets.HOMARR_ENCRYPTION_KEY),
    false,
  );
  assert.equal(parentStderr.includes(OMITTED_ENVIRONMENT_SENTINEL), false);

  const result = await captureChild(
    process.execPath,
    [fixturePath, NODE_DEBUG_RUNNER_ARGUMENT],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        AUTOSTACK_GENERIC_CREDENTIAL: OMITTED_ENVIRONMENT_SENTINEL,
        HOME: process.env.HOME || "/tmp",
        NODE_DEBUG: "child_process",
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.includes(fixturePassword), false);
  assert.equal(
    result.stderr.includes(fixtureSession.secrets.HOMARR_ENCRYPTION_KEY),
    false,
  );
  assert.equal(result.stderr.includes(OMITTED_ENVIRONMENT_SENTINEL), false);
}

function sessionCommandBody(sessionScript, command) {
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sessionScript.match(
    new RegExp(`\\n    ${escapedCommand}\\)\\n([\\s\\S]*?)\\n      ;;`),
  );
  assert.ok(match, `session command is missing: ${command}`);
  return match[1];
}

function assertGateOrder(source, loadNeedle, gateNeedle, actionNeedle, label) {
  const loadIndex = source.indexOf(loadNeedle);
  const gateIndex = source.indexOf(gateNeedle, loadIndex + loadNeedle.length);
  const actionIndex = source.indexOf(actionNeedle, gateIndex + gateNeedle.length);
  assert.notEqual(loadIndex, -1, `${label} load boundary is missing`);
  assert.notEqual(gateIndex, -1, `${label} scheme gate is missing`);
  assert.notEqual(actionIndex, -1, `${label} action boundary is missing`);
  assert.ok(loadIndex < gateIndex, `${label} gate must follow session loading`);
  assert.ok(gateIndex < actionIndex, `${label} gate must precede its action`);
}

function assertLegacySessionCommandPolicy() {
  const sessionScript = readFileSync(join(REPO_ROOT, "scripts", "session.sh"), "utf8");
  for (const command of CURRENT_SCHEME_SESSION_COMMANDS) {
    const body = sessionCommandBody(sessionScript, command);
    assert.equal(
      body.includes("require_session_password_scheme"),
      true,
      `${command} must require the current session password scheme`,
    );
  }
  for (const command of LEGACY_ALLOWED_SESSION_COMMANDS) {
    const body = sessionCommandBody(sessionScript, command);
    assert.equal(
      body.includes("require_session_password_scheme"),
      false,
      `${command} must remain available to legacy sessions`,
    );
  }

  assertGateOrder(
    readFileSync(join(REPO_ROOT, "scripts", "store-homarr-key.ts"), "utf8"),
    "const session = loadSession(Bun.argv[2]);",
    "requireSessionPasswordScheme(session);",
    "const apiKey = await readKeyFromStdin();",
    "Homarr key storage",
  );
  assertGateOrder(
    readFileSync(join(REPO_ROOT, "scripts", "homarr-finalize.ts"), "utf8"),
    "const session = loadSession(Bun.argv[2]);",
    "requireSessionPasswordScheme(session);",
    "const { apiKey } = loadHomarrApiKey(session);",
    "Homarr finalization",
  );
  assertGateOrder(
    readFileSync(join(REPO_ROOT, "scripts", "write-mcp-config.ts"), "utf8"),
    "const session = loadSession(Bun.argv[2]);",
    "requireSessionPasswordScheme(session);",
    "const { apiKey } = loadHomarrApiKey(session);",
    "MCP config writing",
  );
  const sessionContext = readFileSync(
    join(REPO_ROOT, "scripts", "lib", "session-context.ts"),
    "utf8",
  );
  const refreshStart = sessionContext.indexOf("export function refreshArrKeys(runId)");
  assert.notEqual(refreshStart, -1, "Arr key refresh entrypoint is missing");
  assertGateOrder(
    sessionContext.slice(refreshStart),
    "const session = loadSession(runId);",
    "requireSessionPasswordScheme(session);",
    "const result = spawnSync(\"docker\"",
    "Arr key refresh",
  );
}

async function runChecks() {
  const alphaSession = sessionFor("alpha", "1");
  const betaSession = sessionFor("beta", "2");
  const alphaOtherKeySession = sessionFor("alpha", "3");
  const otherRunSameKeySession = sessionFor("gamma", "1");
  const alphaPassword = deriveSessionPassword(alphaSession);

  assert.equal(alphaPassword, deriveSessionPassword(alphaSession));
  assert.notEqual(alphaPassword, deriveSessionPassword(betaSession));
  assert.notEqual(alphaPassword, deriveSessionPassword(alphaOtherKeySession));
  assert.notEqual(alphaPassword, deriveSessionPassword(otherRunSameKeySession));
  assert.match(alphaPassword, /^Autostack-[0-9a-f]{24}!$/);
  assert.equal(
    alphaPassword.includes(alphaSession.secrets.HOMARR_ENCRYPTION_KEY),
    false,
  );

  const legacySession = sessionFor("legacy", "5");
  delete legacySession.manifest.SESSION_PASSWORD_SCHEME;
  assert.equal(classifySessionPasswordScheme(legacySession.manifest), "legacy");
  assert.throws(() => deriveSessionPassword(legacySession));

  const wrongSchemeSession = sessionFor("wrong", "6");
  wrongSchemeSession.manifest.SESSION_PASSWORD_SCHEME = "unknown-v1";
  assert.throws(() => classifySessionPasswordScheme(wrongSchemeSession.manifest));
  assert.throws(() => deriveSessionPassword(wrongSchemeSession));

  let directInvocation;
  let directCalls = 0;
  const directOutput = await withoutProcessOutput(async () => {
    await fillBrowserPassword(alphaSession, ["@e4", "@e5"], {
      spawnImplementation: (executable, args, options) => {
        directCalls += 1;
        const child = simulatedChild({
          stderr: alphaSession.secrets.HOMARR_ENCRYPTION_KEY,
          stdout: alphaPassword,
        });
        directInvocation = { args, child, executable, options };
        return child;
      },
    });
  });
  assert.deepEqual(directOutput, { stderrCalls: 0, stdoutCalls: 0 });
  assert.equal(directCalls, 1);
  assert.equal(directInvocation.executable, "agent-browser");
  assert.deepEqual(directInvocation.args, [
    "--session",
    "auto-stack-alpha",
    "batch",
    "--bail",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(directInvocation.child.capturedInput()), [
    ["fill", "@e4", alphaPassword],
    ["fill", "@e5", alphaPassword],
  ]);
  assert.equal(Object.hasOwn(directInvocation.options, "input"), false);
  assert.equal(Object.hasOwn(directInvocation.options, "shell"), false);
  assert.equal(directInvocation.args.includes(alphaPassword), false);
  assert.equal(
    JSON.stringify(directInvocation.options).includes(alphaPassword),
    false,
  );
  assert.equal(
    JSON.stringify(directInvocation.options).includes(
      alphaSession.secrets.HOMARR_ENCRYPTION_KEY,
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(directInvocation.options.env, "AUTOSTACK_GENERIC_CREDENTIAL"),
    false,
  );

  const missingExecutableError = new Error("missing executable");
  missingExecutableError.code = "ENOENT";
  const fallbackInvocations = [];
  const fallbackOutput = await withoutProcessOutput(async () => {
    await fillBrowserPassword(alphaSession, ["@e6"], {
      spawnImplementation: (executable, args, options) => {
        let child;
        if (fallbackInvocations.length === 0) {
          child = simulatedChild({ spawnError: missingExecutableError });
        } else {
          child = simulatedChild({
            stderr: alphaPassword,
            stdout: alphaSession.secrets.HOMARR_ENCRYPTION_KEY,
          });
        }
        fallbackInvocations.push({ args, child, executable, options });
        return child;
      },
    });
  });
  assert.deepEqual(fallbackOutput, { stderrCalls: 0, stdoutCalls: 0 });
  assert.equal(fallbackInvocations.length, 2);
  assert.equal(fallbackInvocations[0].executable, "agent-browser");
  assert.deepEqual(fallbackInvocations[0].args, directInvocation.args);
  assert.equal(fallbackInvocations[0].child.capturedInput(), "");
  assert.equal(fallbackInvocations[1].executable, "mise");
  assert.deepEqual(fallbackInvocations[1].args, [
    "exec",
    "node@24",
    "--",
    "agent-browser",
    "--session",
    "auto-stack-alpha",
    "batch",
    "--bail",
    "--json",
  ]);
  assert.strictEqual(
    fallbackInvocations[0].options,
    fallbackInvocations[1].options,
  );
  assert.deepEqual(JSON.parse(fallbackInvocations[1].child.capturedInput()), [
    ["fill", "@e6", alphaPassword],
  ]);
  assert.equal(
    JSON.stringify(fallbackInvocations[1].options).includes(alphaPassword),
    false,
  );

  const permissionError = new Error("permission denied");
  permissionError.code = "EACCES";
  await assertNoFallback(alphaSession, () => simulatedChild({ status: 7 }));
  await assertNoFallback(
    alphaSession,
    () => simulatedChild({ spawnError: permissionError }),
  );
  await assertNoFallback(
    alphaSession,
    () => simulatedChild({ spawnError: "ENOENT" }),
  );
  await assertNoFallback(alphaSession, () => undefined);

  for (const invalidSession of [legacySession, wrongSchemeSession]) {
    let calls = 0;
    await assert.rejects(
      fillBrowserPassword(invalidSession, ["@e1"], {
        spawnImplementation: () => {
          calls += 1;
          return simulatedChild();
        },
      }),
    );
    assert.equal(calls, 0);
  }

  for (const selectors of [
    ["#password"],
    ["@e0"],
    ["@e1", "@e1"],
    ["@e1", "click"],
    ["@e1", "@e2", "@e3", "@e4", "@e5"],
  ]) {
    let calls = 0;
    await assert.rejects(
      fillBrowserPassword(alphaSession, selectors, {
        spawnImplementation: () => {
          calls += 1;
          return simulatedChild();
        },
      }),
    );
    assert.equal(calls, 0);
  }

  let mismatchedSessionCalls = 0;
  await assert.rejects(
    fillBrowserPassword(
      {
        ...alphaSession,
        manifest: {
          ...alphaSession.manifest,
          AGENT_BROWSER_SESSION: "auto-stack-beta",
        },
      },
      ["@e1"],
      {
        spawnImplementation: () => {
          mismatchedSessionCalls += 1;
          return simulatedChild();
        },
      },
    ),
  );
  assert.equal(mismatchedSessionCalls, 0);

  assert.equal(BROWSER_PASSWORD_PASS_LINE, "PASS browser password filled\n");
  assert.equal(BROWSER_PASSWORD_FAIL_LINE, "FAIL browser password fill\n");

  assertLegacySessionCommandPolicy();
  await runNodeDebugRegression();

  process.stdout.write("PASS session password derivation and scheme gating\n");
  process.stdout.write("PASS legacy session command policy\n");
  process.stdout.write("PASS browser password helper\n");
  process.stdout.write("PASS NODE_DEBUG child-process redaction\n");
}

if (Bun.argv[2] === NODE_DEBUG_RUNNER_ARGUMENT) {
  await runNodeDebugRunner();
} else {
  await runChecks();
}
