#!/usr/bin/env bun

import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
  connectionsContents,
  deriveSessionPassword,
  handoffContents,
  privateHandoffContents,
  redactedHandoffContents,
  REPO_ROOT,
  SESSION_PASSWORD_SCHEME,
  sessionUsername,
  validateAdminUsername,
  validateBrowserPageUrl,
  writeConnectionsFile,
  writeSessionHandoffArtifacts,
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
  "homarr-widgets",
  "down",
  "destroy",
];
const CURRENT_SCHEME_SESSION_COMMANDS = [
  "up",
  "keys",
  "bootstrap",
  "bootstrap-jellyfin",
  "bootstrap-seerr",
  "verify",
  "browser-password",
  "browser-form",
  "access-proxy",
  "browser-key",
  "homarr-key",
  "homarr-finalize",
  "homarr-notebook",
  "mcp-config",
  "connections-check",
  "connections",
  "handoff",
];

function sessionFor(runId, keyByte) {
  return {
    runId,
    sessionDir: `/tmp/auto-stack-fixture/${runId}`,
    manifestFile: `/tmp/auto-stack-fixture/${runId}/manifest.env`,
    secretsFile: `/tmp/auto-stack-fixture/${runId}/secrets.env`,
    manifest: {
      ADMIN_USERNAME: "alice",
      AGENT_BROWSER_SESSION: `auto-stack-${runId}`,
      HOMARR_PORT: "21006",
      JELLYFIN_PORT: "21004",
      PROWLARR_PORT: "21000",
      QBITTORRENT_PORT: "21003",
      RADARR_PORT: "21001",
      SEERR_PORT: "21005",
      SESSION_PASSWORD_SCHEME,
      SONARR_PORT: "21002",
    },
    secrets: {
      HOMARR_ENCRYPTION_KEY: keyByte.repeat(64),
      PROWLARR_API_KEY: "a".repeat(32),
      RADARR_API_KEY: "b".repeat(32),
      SEERR_API_KEY: "c".repeat(32),
      SONARR_API_KEY: "d".repeat(32),
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

function successfulBrowserOutput(args) {
  if (args.includes("attr")) {
    const attribute = args[args.indexOf("attr") + 2];
    return JSON.stringify({
      success: true,
      data: {
        value: attribute === "type" ? "password" : null,
        origin: "http://127.0.0.1:21006",
        lifecycle: "fresh",
      },
      error: null,
    });
  }
  if (args.includes("is")) {
    return JSON.stringify({
      success: true,
      data: {
        enabled: true,
        origin: "http://127.0.0.1:21006",
        lifecycle: "fresh",
      },
      error: null,
    });
  }
  return "";
}

function successfulBrowserChild(args, overrides = {}) {
  const stdout = successfulBrowserOutput(args);
  return simulatedChild({ ...overrides, stdout });
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
      pageUrl: "http://127.0.0.1:21006/setup",
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
    spawnImplementation: (_executable, args, options) => {
      const output = successfulBrowserOutput(args);
      return realSpawn(
      process.execPath,
      [
        "-e",
        `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(output)}); process.exit(0); });`,
      ],
      options,
    );
    },
    pageUrl: "http://127.0.0.1:21006/setup",
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

  const legacyValidatorStart = sessionScript.indexOf(
    "validate_legacy_credentials_control_file()",
  );
  const legacyValidatorEnd = sessionScript.indexOf(
    "\n}\n\nvalidate_connections_schema_file()",
    legacyValidatorStart,
  );
  assert.notEqual(legacyValidatorStart, -1, "legacy credentials validator is missing");
  assert.notEqual(legacyValidatorEnd, -1, "legacy credentials validator boundary is missing");
  const legacyValidator = sessionScript.slice(legacyValidatorStart, legacyValidatorEnd);
  assert.equal(
    legacyValidator.includes("validate_private_control_file"),
    true,
    "legacy credentials must retain private control-file validation",
  );
  assert.equal(
    legacyValidator.includes("SESSION_PASSWORD_SCHEME"),
    false,
    "legacy credentials must remain migratable for current-scheme sessions",
  );
  assert.equal(
    legacyValidator.includes('< "$file_path"'),
    false,
    "legacy credentials validation must not read secret payloads",
  );
  assert.equal(
    sessionScript.match(/! -path "\$SESSION_DIR\/credentials\.env"/g)?.length,
    4,
    "every normal-session destroy allowlist must include legacy credentials",
  );
  assert.equal(
    sessionScript.match(/! -path "\$tombstone_dir\/credentials\.env"/g)?.length,
    1,
    "the tombstone allowlist must include legacy credentials",
  );
  const tombstoneDeleteStart = sessionScript.indexOf("for control_file in \\");
  const credentialsDeleteIndex = sessionScript.indexOf(
    '"$tombstone_dir/credentials.env"',
    tombstoneDeleteStart,
  );
  const manifestDeleteIndex = sessionScript.indexOf(
    '"$tombstone_dir/manifest.env"',
    tombstoneDeleteStart,
  );
  assert.ok(
    tombstoneDeleteStart < credentialsDeleteIndex && credentialsDeleteIndex < manifestDeleteIndex,
    "legacy credentials must be deleted before the manifest for retry safety",
  );

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

  assert.equal(validateAdminUsername("habs.user-1"), "habs.user-1");
  for (const invalidUsername of ["", " space", "user name", "user@host", "a".repeat(65)]) {
    assert.throws(() => validateAdminUsername(invalidUsername));
  }
  assert.equal(
    validateBrowserPageUrl(alphaSession, "http://127.0.0.1:21006/settings/general"),
    "http://127.0.0.1:21006/settings/general",
  );
  for (const invalidPageUrl of [
    "https://127.0.0.1:21006/",
    "http://example.com:21006/",
    "http://127.0.0.1:9999/",
    "http://user:pass@127.0.0.1:21006/",
  ]) {
    assert.throws(() => validateBrowserPageUrl(alphaSession, invalidPageUrl));
  }

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
  const directInvocations = [];
  let directCalls = 0;
  const directOutput = await withoutProcessOutput(async () => {
    await fillBrowserPassword(alphaSession, ["@e4", "@e5"], {
      pageUrl: "http://127.0.0.1:21006/setup",
      spawnImplementation: (executable, args, options) => {
        directCalls += 1;
        const child = successfulBrowserChild(args, {
          stderr: alphaSession.secrets.HOMARR_ENCRYPTION_KEY,
        });
        const invocation = { args, child, executable, options };
        directInvocations.push(invocation);
        if (args.includes("batch")) {
          directInvocation = invocation;
        }
        return child;
      },
    });
  });
  assert.deepEqual(directOutput, { stderrCalls: 0, stdoutCalls: 0 });
  assert.equal(directCalls, 9);
  const directInspections = directInvocations.slice(0, 8);
  assert.equal(directInspections.every((invocation) => (
    invocation.args[0] === "--session"
    && invocation.args[1] === "auto-stack-alpha"
    && invocation.args.at(-1) === "--json"
  )), true);
  assert.equal(directInspections.some((invocation) => invocation.args.includes("editable")), false);
  assert.deepEqual(
    directInspections.map((invocation) => invocation.args.slice(2, -1)),
    [
      ["get", "attr", "@e4", "type"],
      ["get", "attr", "@e4", "disabled"],
      ["get", "attr", "@e4", "readonly"],
      ["is", "enabled", "@e4"],
      ["get", "attr", "@e5", "type"],
      ["get", "attr", "@e5", "disabled"],
      ["get", "attr", "@e5", "readonly"],
      ["is", "enabled", "@e5"],
    ],
  );
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

  const rejectedTextInvocations = [];
  await assert.rejects(
    fillBrowserPassword(alphaSession, ["@e9"], {
      pageUrl: "http://127.0.0.1:21006/setup",
      spawnImplementation: (executable, args, options) => {
        const attribute = args[args.indexOf("attr") + 2];
        let stdout = successfulBrowserOutput(args);
        if (attribute === "type") {
          stdout = JSON.stringify({
            success: true,
            data: { value: "text", origin: "http://127.0.0.1:21006", lifecycle: "fresh" },
            error: null,
          });
        }
        const child = simulatedChild({ stdout });
        rejectedTextInvocations.push({ args, child, executable, options });
        return child;
      },
    }),
    /browser password field is invalid/,
  );
  assert.equal(rejectedTextInvocations.length, 4);
  assert.equal(rejectedTextInvocations.every((invocation) => (
    invocation.args[0] === "--session" && invocation.args[1] === "auto-stack-alpha"
  )), true);
  assert.equal(rejectedTextInvocations.some((invocation) => invocation.args.includes("batch")), false);
  assert.equal(
    rejectedTextInvocations.some((invocation) => invocation.child.capturedInput().includes(alphaPassword)),
    false,
  );

  for (const blockedAttribute of ["disabled", "readonly"]) {
    let mutationCalls = 0;
    await assert.rejects(
      fillBrowserPassword(alphaSession, ["@e10"], {
        pageUrl: "http://127.0.0.1:21006/setup",
        spawnImplementation: (_executable, args) => {
          if (args.includes("batch")) {
            mutationCalls += 1;
          }
          const attribute = args[args.indexOf("attr") + 2];
          let stdout = successfulBrowserOutput(args);
          if (attribute === blockedAttribute) {
            stdout = JSON.stringify({
              success: true,
              data: { value: blockedAttribute, origin: "http://127.0.0.1:21006", lifecycle: "fresh" },
              error: null,
            });
          }
          return simulatedChild({ stdout });
        },
      }),
      /browser password field is invalid/,
    );
    assert.equal(mutationCalls, 0);
  }

  const missingExecutableError = new Error("missing executable");
  missingExecutableError.code = "ENOENT";
  const fallbackInvocations = [];
  const fallbackOutput = await withoutProcessOutput(async () => {
    await fillBrowserPassword(alphaSession, ["@e6"], {
      pageUrl: "http://localhost:21006/setup",
      spawnImplementation: (executable, args, options) => {
        let child;
        if (fallbackInvocations.length === 0) {
          child = simulatedChild({ spawnError: missingExecutableError });
        } else {
          child = successfulBrowserChild(args, {
            stderr: alphaPassword,
          });
        }
        fallbackInvocations.push({ args, child, executable, options });
        return child;
      },
    });
  });
  assert.deepEqual(fallbackOutput, { stderrCalls: 0, stdoutCalls: 0 });
  assert.equal(fallbackInvocations.length, 6);
  assert.equal(fallbackInvocations[0].executable, "agent-browser");
  assert.deepEqual(fallbackInvocations[0].args.slice(2, -1), ["get", "attr", "@e6", "type"]);
  assert.equal(fallbackInvocations[0].child.capturedInput(), "");
  assert.equal(fallbackInvocations[1].executable, "bunx");
  assert.deepEqual(fallbackInvocations[1].args.slice(4, -1), ["get", "attr", "@e6", "type"]);
  assert.strictEqual(
    fallbackInvocations[0].options,
    fallbackInvocations[1].options,
  );
  const fallbackFill = fallbackInvocations.at(-1);
  assert.equal(fallbackFill.executable, "agent-browser");
  assert.deepEqual(JSON.parse(fallbackFill.child.capturedInput()), [
    ["fill", "@e6", alphaPassword],
  ]);
  assert.equal(
    JSON.stringify(fallbackFill.options).includes(alphaPassword),
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

  const connectionsWithoutHomarr = connectionsContents(alphaSession, "");
  assert.equal(connectionsWithoutHomarr.includes("_PASSWORD="), false);
  assert.equal(connectionsWithoutHomarr.includes(alphaPassword), false);
  assert.equal(
    connectionsWithoutHomarr.includes(alphaSession.secrets.HOMARR_ENCRYPTION_KEY),
    false,
  );
  assert.equal(connectionsWithoutHomarr.includes("HOMARR_API_KEY="), false);
  assert.equal(connectionsWithoutHomarr.includes("PROWLARR_API_KEY="), true);
  assert.equal(connectionsWithoutHomarr.includes("SEERR_API_KEY="), true);

  const homarrApiKey = `${"e".repeat(16)}.${"f".repeat(16)}`;
  const connectionsWithHomarr = connectionsContents(alphaSession, homarrApiKey);
  assert.equal(connectionsWithHomarr.includes(`HOMARR_API_KEY=${homarrApiKey}`), true);
  assert.equal(connectionsWithHomarr.includes("_PASSWORD="), false);

  const handoff = handoffContents(alphaSession);
  assert.equal(sessionUsername(alphaSession), "alice");
  assert.equal(handoff.includes("Admin username: alice"), true);
  assert.equal(handoff.includes(`Admin password: ${alphaPassword}`), true);
  assert.equal(handoff.includes(alphaSession.secrets.HOMARR_ENCRYPTION_KEY), false);

  const privateHandoff = privateHandoffContents(alphaSession, homarrApiKey);
  const parsedPrivateHandoff = JSON.parse(privateHandoff);
  assert.equal(parsedPrivateHandoff.services.sonarr.username, "alice");
  assert.equal(parsedPrivateHandoff.services.sonarr.password, alphaPassword);
  assert.equal(parsedPrivateHandoff.services.sonarr.apiKey, alphaSession.secrets.SONARR_API_KEY);
  assert.equal(parsedPrivateHandoff.services.homarr.apiKey, homarrApiKey);
  assert.equal(parsedPrivateHandoff.actions.length >= 4, true);
  const redactedHandoff = redactedHandoffContents(alphaSession, homarrApiKey);
  assert.equal(redactedHandoff.includes(alphaPassword), false);
  assert.equal(redactedHandoff.includes(homarrApiKey), false);
  assert.equal(redactedHandoff.includes(alphaSession.secrets.SONARR_API_KEY), false);
  assert.equal(redactedHandoff.includes("[REDACTED - saved]"), true);

  const connectionDirectory = mkdtempSync(join(tmpdir(), "auto-stack-connections-"));
  chmodSync(connectionDirectory, 0o700);
  try {
    const artifactDirectory = join(connectionDirectory, "artifacts");
    mkdirSync(artifactDirectory, { mode: 0o700 });
    const fileSession = {
      ...alphaSession,
      sessionDir: connectionDirectory,
      manifestFile: join(connectionDirectory, "manifest.env"),
      secretsFile: join(connectionDirectory, "secrets.env"),
    };
    const legacyPath = join(connectionDirectory, "credentials.env");
    writeFileSync(legacyPath, `ADMIN_PASSWORD=${alphaPassword}\n`, { mode: 0o600 });
    const result = writeConnectionsFile(fileSession, homarrApiKey);
    const persisted = readFileSync(result.filePath, "utf8");
    assert.equal(statSync(result.filePath).mode & 0o777, 0o600);
    assert.equal(persisted, connectionsWithHomarr);
    assert.equal(persisted.includes(alphaPassword), false);
    assert.equal(persisted.includes("PASSWORD="), false);
    assert.equal(existsSync(legacyPath), false);

    const artifacts = writeSessionHandoffArtifacts(fileSession, homarrApiKey);
    assert.equal(statSync(artifacts.privatePath).mode & 0o777, 0o600);
    assert.equal(statSync(artifacts.redactedPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(artifacts.privatePath, "utf8").includes(alphaPassword), true);
    assert.equal(readFileSync(artifacts.redactedPath, "utf8").includes(alphaPassword), false);
    chmodSync(artifactDirectory, 0o755);
    assert.throws(() => writeSessionHandoffArtifacts(fileSession, homarrApiKey), /private and owned/);
    chmodSync(artifactDirectory, 0o700);


    writeFileSync(result.filePath, `${persisted}ADMIN_PASSWORD=${alphaPassword}\n`, { mode: 0o600 });
    assert.throws(() => writeConnectionsFile(fileSession, homarrApiKey));
    assert.equal(readFileSync(result.filePath, "utf8").includes("ADMIN_PASSWORD="), true);
  } finally {
    rmSync(connectionDirectory, { force: true, recursive: true });
  }

  const sessionContextSource = readFileSync(
    join(REPO_ROOT, "scripts", "lib", "session-context.ts"),
    "utf8",
  );
  assert.equal(sessionContextSource.includes("legacy credentials file"), true);
  assert.equal(sessionContextSource.includes("connections.env"), true);

  assertLegacySessionCommandPolicy();
  await runNodeDebugRegression();

  process.stdout.write("PASS session password derivation and scheme gating\n");
  process.stdout.write("PASS legacy session command policy\n");
  process.stdout.write("PASS browser password helper\n");
  process.stdout.write("PASS password-free connections and explicit handoff\n");
  process.stdout.write("PASS NODE_DEBUG child-process redaction\n");
}

if (Bun.argv[2] === NODE_DEBUG_RUNNER_ARGUMENT) {
  await runNodeDebugRunner();
} else {
  await runChecks();
}
