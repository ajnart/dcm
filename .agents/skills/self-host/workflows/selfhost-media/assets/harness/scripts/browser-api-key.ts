#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadSession,
  REPO_ROOT,
  requireSessionPasswordScheme,
  storeHomarrApiKey,
  validateBrowserPageUrl,
  validateHomarrApiKey,
  writeSessionConnections,
} from "./lib/session-context.ts";

const SERVICE_SECRET_KEYS = new Map([
  ["prowlarr", "PROWLARR_API_KEY"],
  ["radarr", "RADARR_API_KEY"],
  ["seerr", "SEERR_API_KEY"],
  ["sonarr", "SONARR_API_KEY"],
]);
const ARR_GENERAL_PORT_KEYS = new Map([
  ["prowlarr", "PROWLARR_PORT"],
  ["radarr", "RADARR_PORT"],
  ["sonarr", "SONARR_PORT"],
]);
const BROWSER_ENVIRONMENT_KEYS = [
  "AGENT_BROWSER_SESSION",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SELFHOST_AGENT_ID",
  "SELFHOST_RUN_ID",
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
      if (stdoutBytes > 262_144) {
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

export function homarrMcpKeyEvalScript() {
  return `(() => {
    if (window.location.pathname === "/manage/tools/api") {
      const fields = document.querySelectorAll('input[aria-label="API token created"]');
      if (fields.length !== 1) throw new Error("one Homarr API token field is required");
      const field = fields[0];
      if (!field.readOnly || !["password", "text"].includes(field.type) || field.getClientRects().length === 0) {
        throw new Error("Homarr API token field is unavailable");
      }
      return field.value;
    }
    if (window.location.pathname !== "/init") throw new Error("invalid Homarr key location");
    const buttons = document.querySelectorAll('button[aria-label="Copy API key"]');
    if (buttons.length !== 1) throw new Error("one Homarr MCP key button is required");
    const parent = buttons[0].parentElement;
    if (!parent) throw new Error("Homarr MCP key container is missing");
    const codes = parent.querySelectorAll(":scope > code");
    if (codes.length !== 1) throw new Error("one Homarr MCP key code is required");
    return codes[0].textContent ?? "";
  })()`;
}

export function arrApiKeyEvalScript() {
  return `(() => {
    if (window.location.pathname !== "/settings/general") throw new Error("invalid Arr general settings location");
    const fields = document.querySelectorAll('input[name="apiKey"]');
    if (fields.length !== 1) throw new Error("one Arr API key field is required");
    const field = fields[0];
    if (field.name !== "apiKey" || field.type !== "text" || field.readOnly !== true) throw new Error("Arr API key field is invalid");
    return field.value;
  })()`;
}

export function prowlarrApplicationKeyFieldEvalScript(service) {
  if (service !== "sonarr" && service !== "radarr") {
    throw new Error("Prowlarr application must be Sonarr or Radarr");
  }
  let expectedTitle = "Add Application - Sonarr";
  if (service === "radarr") {
    expectedTitle = "Add Application - Radarr";
  }
  return `(() => {
    if (window.location.pathname !== "/settings/applications") throw new Error("invalid Prowlarr applications location");
    const fields = document.querySelectorAll('input[name="apiKey"]');
    if (fields.length !== 1) throw new Error("one Prowlarr application API key field is required");
    const field = fields[0];
    if (field.type !== "text" || field.disabled || field.readOnly || field.getClientRects().length === 0) {
      throw new Error("Prowlarr application API key field is unavailable");
    }
    const modal = field.closest('[class*="Modal-modal-"]');
    if (!modal) throw new Error("Prowlarr application modal is missing");
    const titles = [...modal.querySelectorAll('div[class*="ModalHeader-modalHeader"]')]
      .filter((element) => element.textContent?.trim() === ${JSON.stringify(expectedTitle)});
    if (titles.length !== 1) throw new Error("expected Prowlarr application dialog is missing");
    return "ready";
  })()`;
}

function validateHomarrKeyUrl(session, raw) {
  validateBrowserPageUrl(session, raw);
  const url = new URL(raw.trim());
  if (url.port !== session.manifest.HOMARR_PORT
    || !["/init", "/manage/tools/api"].includes(url.pathname)) {
    throw new Error("browser is not on a Homarr key page");
  }
}

function validateArrGeneralUrl(session, service, raw) {
  const portKey = ARR_GENERAL_PORT_KEYS.get(service);
  if (!portKey) {
    throw new Error("field capture is supported only for Arr services");
  }
  validateBrowserPageUrl(session, raw);
  const url = new URL(raw.trim());
  if (url.port !== session.manifest[portKey] || url.pathname !== "/settings/general") {
    throw new Error("browser is not on the selected Arr general settings page");
  }
}

function validateSeerrGeneralUrl(session, raw) {
  validateBrowserPageUrl(session, raw);
  const url = new URL(raw.trim());
  if (url.port !== session.manifest.SEERR_PORT || url.pathname !== "/settings") {
    throw new Error("Seerr API key capture requires General Settings");
  }
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

function seerrServiceForm(session, rawUrl) {
  const url = new URL(rawUrl.trim());
  return url.port === session.manifest.SEERR_PORT
    && (url.pathname === "/setup" || url.pathname === "/settings/services");
}

export function keyRefsFromSnapshot(raw, options = {}) {
  const parsed = JSON.parse(raw);
  if (parsed.success !== true || !parsed.data?.refs) {
    throw new Error("browser snapshot failed");
  }
  const refs = Object.entries(parsed.data.refs).filter(([ref, field]) => {
    if (!/^e[1-9][0-9]{0,5}$/.test(ref) || !field || field.role !== "textbox") {
      return false;
    }
    const name = String(field.name).replace(/\s+/g, " ").trim();
    if (["api key", "apikey", "key"].includes(name.toLowerCase())) {
      return true;
    }
    if (options.seerrServiceForm === true && (options.service === "radarr" || options.service === "sonarr")) {
      let appName = "Radarr";
      if (options.service === "sonarr") {
        appName = "Sonarr";
      }
      return name === `API Key* Find it in ${appName}: Settings > General > Security > API Key`;
    }
    return false;
  }).map(([ref]) => `@${ref}`);
  if (refs.length !== 1) {
    throw new Error("one API-key field is required");
  }
  return refs[0];
}

export async function locateBrowserApiKey(session, service, options = {}) {
  const browserSession = validateBrowserSession(session);
  const invoke = options.invokeBrowserImplementation || invokeBrowser;
  const currentUrl = await invoke(["--session", browserSession, "get", "url"]);
  validateBrowserPageUrl(session, currentUrl);
  if (service === "seerr") {
    validateSeerrGeneralUrl(session, currentUrl);
  }
  const snapshot = await invoke(["--session", browserSession, "snapshot", "-i", "--json"]);
  return keyRefsFromSnapshot(snapshot, { service, seerrServiceForm: seerrServiceForm(session, currentUrl) });
}

export async function captureBrowserApiKey(session, service, selector, options = {}) {
  const browserSession = validateBrowserSession(session);
  const safeSelector = validateSelector(selector);
  const invoke = options.invokeBrowserImplementation || invokeBrowser;
  const currentUrl = await invoke(
    ["--session", browserSession, "get", "url"],
    undefined,
  );
  validateBrowserPageUrl(session, currentUrl);
  if (service === "seerr") {
    validateSeerrGeneralUrl(session, currentUrl);
  }
  const raw = await invoke(
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

export async function captureHomarrMcpKeyCode(session, options = {}) {
  const browserSession = validateBrowserSession(session);
  const invoke = options.invokeBrowserImplementation || invokeBrowser;
  const currentUrl = await invoke(
    ["--session", browserSession, "get", "url"],
    undefined,
  );
  validateHomarrKeyUrl(session, currentUrl);
  const raw = await invoke(
    ["--session", browserSession, "eval", "--stdin"],
    `${homarrMcpKeyEvalScript()}\n`,
  );
  const captured = validateHomarrApiKey(normalizeCapturedValue(raw));
  const store = options.storeImplementation || storeHomarrApiKey;
  const writeConnections = options.writeConnectionsImplementation || writeSessionConnections;
  store(session, captured);
  writeConnections(session.runId);
}

export async function captureArrApiKeyField(session, service, options = {}) {
  const browserSession = validateBrowserSession(session);
  if (!ARR_GENERAL_PORT_KEYS.has(service)) {
    throw new Error("field capture is supported only for Arr services");
  }
  const invoke = options.invokeBrowserImplementation || invokeBrowser;
  const currentUrl = await invoke(
    ["--session", browserSession, "get", "url"],
    undefined,
  );
  validateArrGeneralUrl(session, service, currentUrl);
  const raw = await invoke(
    ["--session", browserSession, "eval", "--stdin"],
    `${arrApiKeyEvalScript()}\n`,
  );
  if (normalizeCapturedValue(raw) !== serviceApiKey(session, service)) {
    throw new Error("browser API key does not match the managed session");
  }
}

export async function fillBrowserApiKey(session, service, selector, options = {}) {
  const browserSession = validateBrowserSession(session);
  const safeSelector = validateSelector(selector);
  if (service === "homarr") {
    throw new Error("Homarr API keys are capture-only");
  }
  const invoke = options.invokeBrowserImplementation || invokeBrowser;
  const currentUrl = await invoke(
    ["--session", browserSession, "get", "url"],
    undefined,
  );
  validateBrowserPageUrl(session, currentUrl);
  const snapshot = await invoke(
    ["--session", browserSession, "snapshot", "-i", "--json"],
    undefined,
  );
  if (keyRefsFromSnapshot(snapshot, { service, seerrServiceForm: seerrServiceForm(session, currentUrl) }) !== safeSelector) {
    throw new Error("browser API-key selector does not match the fresh form");
  }
  const apiKey = serviceApiKey(session, service);
  const commands = [["fill", safeSelector, apiKey]];
  await invoke(
    ["--session", browserSession, "batch", "--bail", "--json"],
    `${JSON.stringify(commands)}\n`,
  );
}

export async function fillProwlarrApplicationApiKey(session, service, options = {}) {
  const browserSession = validateBrowserSession(session);
  const script = prowlarrApplicationKeyFieldEvalScript(service);
  const invoke = options.invokeBrowserImplementation || invokeBrowser;
  const currentUrl = await invoke(["--session", browserSession, "get", "url"]);
  validateBrowserPageUrl(session, currentUrl);
  const url = new URL(currentUrl.trim());
  if (url.port !== session.manifest.PROWLARR_PORT || url.pathname !== "/settings/applications") {
    throw new Error("browser is not on the selected Prowlarr applications page");
  }
  const state = await invoke(["--session", browserSession, "eval", "--stdin"], `${script}\n`);
  if (normalizeCapturedValue(state) !== "ready") {
    throw new Error("Prowlarr application API key field did not validate");
  }
  const apiKey = serviceApiKey(session, service);
  await invoke(
    ["--session", browserSession, "batch", "--bail", "--json"],
    `${JSON.stringify([["fill", 'input[name="apiKey"]', apiKey]])}\n`,
  );
}

async function main() {
  const [action, runId, service, selector] = Bun.argv.slice(2);
  const noSelectorAction = action === "refs" || action === "capture-code" || action === "capture-field" || action === "fill-prowlarr-app";
  if (!action || !runId || !service || (noSelectorAction && selector !== undefined) || (!noSelectorAction && (!selector || Bun.argv.length !== 6))) {
    throw new Error("capture|capture-code|capture-field|fill|refs arguments are invalid");
  }
  if (![...SERVICE_SECRET_KEYS.keys(), "homarr"].includes(service)) {
    throw new Error("unsupported API-key service");
  }
  const session = loadSession(runId);
  requireSessionPasswordScheme(session);
  if (action === "refs") {
    process.stdout.write(`${await locateBrowserApiKey(session, service)}\n`);
    return;
  }
  if (action === "capture") {
    await captureBrowserApiKey(session, service, selector);
    process.stdout.write("PASS browser API key captured\n");
    return;
  }
  if (action === "capture-code") {
    if (service !== "homarr") {
      throw new Error("code capture is supported only for Homarr");
    }
    await captureHomarrMcpKeyCode(session);
    process.stdout.write("PASS browser API key captured\n");
    return;
  }
  if (action === "capture-field") {
    await captureArrApiKeyField(session, service);
    process.stdout.write("PASS browser API key captured\n");
    return;
  }
  if (action === "fill-prowlarr-app") {
    await fillProwlarrApplicationApiKey(session, service);
    process.stdout.write("PASS browser API key filled\n");
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
  main().catch((error) => {
    if (error instanceof Error && error.message === "Seerr API key capture requires General Settings") {
      process.stdout.write("FAIL Seerr API key capture requires General Settings (/settings)\n");
    } else {
      process.stdout.write("FAIL browser API-key action\n");
    }
    process.exitCode = 1;
  });
}
