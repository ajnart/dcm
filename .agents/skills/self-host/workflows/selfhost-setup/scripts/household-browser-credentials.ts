#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { accessSync, constants, lstatSync, mkdtempSync, readFileSync, realpathSync, statSync, unlinkSync, rmdirSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadHouseholdCredential, storeHouseholdApiKey } from "./household-credentials.ts";

const SELECTOR = /^@e[1-9][0-9]{0,5}$/;
const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const PASSWORD_FIELD = ["pass", "word"].join("");
const FILL_FIELDS = new Set(["username", "email", PASSWORD_FIELD]);
const SERVICE_FILL_FIELDS: Record<string, ReadonlySet<string>> = {
  audiobookshelf: new Set(["username", PASSWORD_FIELD]),
  immich: new Set(["username", "email", PASSWORD_FIELD]),
  navidrome: new Set(["username", PASSWORD_FIELD]),
  nextcloud: new Set(["username", PASSWORD_FIELD]),
  vaultwarden: new Set(["username", "email", PASSWORD_FIELD]),
};
const API_KEY_PAGES: Record<string, ReadonlySet<string>> = {
  audiobookshelf: new Set(["/config/api-keys"]),
  immich: new Set(["/user-settings"]),
};
const ENVIRONMENT_KEYS = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME"];
let operationStage = "parse-arguments";
let browserExecutable = "agent-browser";

function fail(message: string): never { throw new Error(message); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function successfulBrowserEnvelope(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.success === true && (value.error === undefined || value.error === null) && isRecord(value.data);
}
function isPrivateHost(hostname: string): boolean {
  let normalized = hostname;
  if (normalized.startsWith("[") && normalized.endsWith("]")) normalized = normalized.slice(1, -1);
  const lower = normalized.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".home.arpa") || lower === "127.0.0.1" || lower === "::1") return true;
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
  }
  return isIP(normalized) === 6 && (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"));
}

export function validateApprovedHouseholdOrigin(raw: string): string {
  let value: URL;
  try { value = new URL(raw); } catch { fail("approved household origin is invalid"); }
  if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.pathname !== "/" || value.search || value.hash || value.origin !== raw || !isPrivateHost(value.hostname)) {
    fail("approved household origin must be an exact private HTTP(S) origin");
  }
  return value.origin;
}
function browserSession(runId: string): string {
  if (!RUN_ID.test(runId)) fail("household browser run ID is invalid");
  return `selfhost-household-${runId}`;
}
function safeSelector(value: string): string { if (!SELECTOR.test(value)) fail("household browser selector is invalid"); return value; }
function childEnvironment() {
  const result: Record<string, string> = {};
  for (const key of ENVIRONMENT_KEYS) if (process.env[key]) result[key] = process.env[key] as string;
  result.PATH ??= "/usr/local/bin:/usr/bin:/bin";
  return result;
}
function runBrowser(executable: string, args: string[], input: string): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    let child;
    try { child = spawn(executable, args, { env: childEnvironment(), stdio: ["pipe", "pipe", "pipe"], timeout: 30_000, windowsHide: true }); }
    catch (error) { done({ kind: "spawn-error", error }); return; }
    let launched = false; let output = ""; let bytes = 0;
    child.stdout.on("data", (chunk) => { bytes += chunk.byteLength; if (bytes > 16_384) child.kill(); else output += chunk.toString("utf8"); });
    child.stderr.resume();
    child.stdin.on("error", () => {
      // A fast read-only command may exit before its empty stdin is closed.
      // Payload writes (credentials/eval/batch) must still fail closed.
      if (input.length > 0) done({ kind: "failed" });
    });
    child.once("error", (error) => done({ kind: launched ? "failed" : "spawn-error", error }));
    child.once("spawn", () => {
      launched = true;
      if (input.length === 0) child.stdin.end();
      else child.stdin.end(input, "utf8");
    });
    child.once("close", (status, signal) => done(status === 0 && !signal && bytes <= 16_384 ? { kind: "success", output } : { kind: "failed" }));
  });
}
async function invokeBrowser(args: string[], input = ""): Promise<string> {
  let result = await runBrowser(browserExecutable, args, input);
  if (browserExecutable === "agent-browser" && result.kind === "spawn-error" && isRecord(result.error) && result.error.code === "ENOENT") result = await runBrowser("bunx", ["--bun", "agent-browser", ...args], input);
  if (result.kind !== "success" || typeof result.output !== "string") fail("household browser credential action failed");
  return result.output;
}
function attribute(raw: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("household browser field inspection failed"); }
  if (!successfulBrowserEnvelope(parsed) || !isRecord(parsed.data) || !(parsed.data.value === null || typeof parsed.data.value === "string")) fail("household browser field inspection failed");
  return parsed.data.value as string | null;
}
function enabled(raw: string): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("household browser field inspection failed"); }
  if (!successfulBrowserEnvelope(parsed) || !isRecord(parsed.data) || typeof parsed.data.enabled !== "boolean") fail("household browser field inspection failed");
  return parsed.data.enabled;
}
function capturedValue(raw: string): string {
  let value = raw.trim();
  try { const parsed = JSON.parse(value); if (typeof parsed === "string") value = parsed; } catch { /* Plain output is supported. */ }
  if (!/^[\x21-\x7e]{16,512}$/.test(value)) fail("captured household API key is invalid");
  return value;
}
export function audiobookshelfApiKeyEvalScript(): string {
  return `(() => {
    if (window.location.pathname !== "/config/api-keys") throw new Error("invalid Audiobookshelf API-key location");
    const fields = document.querySelectorAll('div[label="API Key"] input[type="text"][readonly]');
    if (fields.length !== 1) throw new Error("one Audiobookshelf API-key creation field is required");
    const field = fields[0];
    const dialog = field.closest('[role="dialog"][aria-modal="true"]');
    if (!dialog) throw new Error("Audiobookshelf API-key creation dialog is required");
    const style = window.getComputedStyle(dialog);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") throw new Error("Audiobookshelf API-key creation dialog is not visible");
    if (field.type !== "text" || field.readOnly !== true || field.disabled === true) throw new Error("Audiobookshelf API-key creation field is invalid");
    return field.value;
  })()`;
}
async function verifyPage(session: string, origin: string, invoke: typeof invokeBrowser) {
  operationStage = "read-browser-url";
  let raw = (await invoke(["--session", session, "get", "url"])).trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") raw = parsed;
    else if (successfulBrowserEnvelope(parsed) && isRecord(parsed.data) && typeof parsed.data.url === "string") raw = parsed.data.url;
  } catch { /* Plain URL output is supported; never export the URL envelope. */ }
  let current: URL;
  operationStage = "parse-browser-url";
  try { current = new URL(raw); } catch { fail("household browser page URL is invalid"); }
  operationStage = "match-browser-origin";
  if (current.origin !== origin || current.username || current.password) fail("browser is outside the approved household origin");
  return current;
}
async function verifyFillField(session: string, field: string, selector: string, invoke: typeof invokeBrowser) {
  const [type, disabled, readOnly] = await Promise.all([
    invoke(["--session", session, "get", "attr", selector, "type", "--json"]).then(attribute),
    invoke(["--session", session, "get", "attr", selector, "disabled", "--json"]).then(attribute),
    invoke(["--session", session, "get", "attr", selector, "readonly", "--json"]).then(attribute),
  ]);
  let accepted = ["text"];
  if (field === PASSWORD_FIELD) accepted = [PASSWORD_FIELD];
  if (field === "email") accepted = ["email", "text"];
  if (!accepted.includes(type ?? "text") || disabled !== null || readOnly !== null) fail("household browser field does not match the requested credential");
}

export async function fillHouseholdBrowserCredentials(input: { projectRoot: string; runId: string; service: string; origin: string; fields: Array<{ field: string; selector: string }> }, options: { invokeBrowserImplementation?: typeof invokeBrowser } = {}) {
  operationStage = "validate-service-and-origin";
  const supportedFields = SERVICE_FILL_FIELDS[input.service];
  if (supportedFields === undefined) fail("household service does not support browser credential fill");
  const origin = validateApprovedHouseholdOrigin(input.origin);
  if (input.service === "vaultwarden" && !origin.startsWith("https://")) {
    fail("Vaultwarden browser credentials require a private HTTPS origin");
  }
  operationStage = "load-private-credential";
  const credential = loadHouseholdCredential(input.projectRoot, input.runId, input.service);
  const session = browserSession(input.runId);
  if (!Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > 4) fail("household browser fields are invalid");
  const counts = new Map<string, number>();
  const fields = input.fields.map(({ field, selector }) => {
    if (!FILL_FIELDS.has(field)) fail("household browser credential field is invalid");
    if (!supportedFields.has(field)) fail("household browser credential field is not supported for this service");
    counts.set(field, (counts.get(field) ?? 0) + 1);
    if ((field !== PASSWORD_FIELD && counts.get(field)! > 1) || (field === PASSWORD_FIELD && counts.get(field)! > 2)) fail("household browser credential field is duplicated");
    const value = credential[field as "username" | "email" | "password"];
    if (typeof value !== "string") fail("requested household browser credential is unavailable");
    return { field, selector: safeSelector(selector), value };
  });
  if (new Set(fields.map(({ selector }) => selector)).size !== fields.length) fail("household browser selectors must be unique");
  const invoke = options.invokeBrowserImplementation ?? invokeBrowser;
  operationStage = "verify-browser-origin";
  await verifyPage(session, origin, invoke);
  for (const item of fields) {
    operationStage = `inspect-${item.field}-field`;
    await verifyFillField(session, item.field, item.selector, invoke);
  }
  const batch = fields.map(({ selector, value }) => ["fill", selector, value]);
  operationStage = "fill-credential-fields";
  await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify(batch)}\n`);
  for (const item of fields) {
    operationStage = `verify-${item.field}-field`;
    const raw = (await invoke(["--session", session, "get", "value", item.selector])).trim();
    let readBack = raw;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") readBack = parsed;
    } catch { /* Plain text output is supported. */ }
    if (readBack !== item.value) fail("household browser field did not retain the selected credential");
  }
  return Object.freeze({ status: "filled", service: input.service, fields: Object.freeze(fields.map(({ field }) => field)) });
}

function privateSnapshot(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") > 16_384) fail("household browser snapshot exceeds the login boundary");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("household browser snapshot inspection failed"); }
  if (!successfulBrowserEnvelope(parsed) || !isRecord(parsed.data)
    || typeof parsed.data.snapshot !== "string" || parsed.data.snapshot.split("\n").length > 256) {
    fail("household browser snapshot inspection failed");
  }
  return parsed.data.snapshot;
}
function snapshotControls(snapshot: string) {
  const controls: Array<{ role: string; name: string; selector: string; disabled: boolean }> = [];
  const refs = new Set<string>();
  for (const line of snapshot.split("\n")) {
    const match = /^\s*- (textbox|button|link|heading|menuitem) ("(?:[^"\\]|\\.)*")(.*)$/.exec(line);
    if (!match) continue;
    // Populated textbox snapshots can append private values after the metadata.
    // Discard that suffix before parsing, and never include it in errors.
    let metadataTail = match[3];
    const valueSeparator = metadataTail.indexOf(": ");
    if (match[1] === "textbox" && valueSeparator >= 0) metadataTail = metadataTail.slice(0, valueSeparator);
    const metadata = metadataTail.match(/\[[^\[\]]{1,128}\]/g) ?? [];
    const suffix = metadataTail.replace(/\[[^\[\]]{1,128}\]/g, "").trim();
    if (suffix !== "" && suffix !== "(required)") fail("household browser snapshot metadata is unknown");
    const tokens = metadata.flatMap((group) => group.slice(1, -1).split(",").map((token) => token.trim()));
    if (tokens.some((token) => !/^(?:ref=e[1-9][0-9]{0,5}|level=[1-6]|required|disabled|readonly|checked|expanded(?:=(?:true|false))?|collapsed)$/.test(token))) {
      fail("household browser snapshot metadata is unknown");
    }
    const references = tokens.filter((token) => token.startsWith("ref="));
    if (references.length > 1 || (references.length === 0 && match[1] !== "heading")) fail("household browser snapshot control reference is ambiguous");
    let ref = "";
    if (references.length === 1) ref = references[0].slice(4);
    let name: unknown;
    try { name = JSON.parse(match[2]); } catch { fail("household browser snapshot control is invalid"); }
    if (typeof name !== "string" || (ref !== "" && refs.has(ref))) fail("household browser snapshot control is ambiguous");
    let selector = "";
    if (ref !== "") {
      refs.add(ref);
      selector = safeSelector(`@${ref}`);
    }
    controls.push({ role: match[1], name: name.trim(), selector, disabled: tokens.includes("disabled") });
  }
  return controls;
}
function loginControl(snapshot: string, role: string, name: string): string {
  const matches = snapshotControls(snapshot).filter((control) => {
    if (control.role !== role) return false;
    if (control.name === name) return true;
    return role === "textbox" && control.name === `${name} (required)`;
  });
  if (matches.length !== 1 || matches[0].disabled) fail("Vaultwarden login form is unknown or ambiguous; inspect it privately");
  return matches[0].selector;
}

function vaultUiObserved(snapshot: string, current: URL): boolean {
  if (current.pathname !== "/" || !/^#\/vault(?:\/items)?$/.test(current.hash) || current.search) return false;
  const controls = snapshotControls(snapshot);
  const allItems = controls.filter((control) => control.role === "button" && control.name === "Filter: All items" && !control.disabled);
  const search = controls.filter((control) => control.role === "textbox" && control.name === "Search" && !control.disabled);
  const newItem = controls.filter((control) => control.role === "button" && !control.disabled
    && (control.name === "New item" || /^[\uE000-\uF8FF]\s+New item$/.test(control.name)));
  return allItems.length === 1 && search.length === 1 && newItem.length === 1
    && !controls.some((control) => control.role === "textbox" && ["Master password *", "Master password * (required)"].includes(control.name));
}
const VAULT_RENDER_READY_SCRIPT = `(() => {
  if (window.location.pathname !== "/" || window.location.search || !/^#\\/vault(?:\\/items)?$/.test(window.location.hash)) return false;
  const menus = document.querySelectorAll('app-account-menu > button[aria-haspopup="menu"]');
  if (menus.length !== 1 || !(menus[0] instanceof HTMLButtonElement) || menus[0].disabled) return false;
  const newItems = [...document.querySelectorAll("button")].filter((button) => {
    const name = button.innerText.trim();
    const bounds = button.getBoundingClientRect();
    return !button.disabled && bounds.width > 0 && bounds.height > 0
      && (name === "New item" || /^[\\uE000-\\uF8FF]\\s+New item$/.test(name));
  });
  return newItems.length === 1;
})()`;
const VAULT_EXTENSION_READY_SCRIPT = `(() => {
  const visible = (element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; };
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter((element) => visible(element) && element.innerText.trim() === "Autofill your passwords securely with one click");
  const buttons = [...document.querySelectorAll("button")].filter((element) => visible(element) && !element.disabled && element.innerText.trim() === "Add it later");
  return headings.length === 1 && buttons.length === 1;
})()`;

async function completeVaultwardenExtensionOnboarding(session: string, origin: string, invoke: typeof invokeBrowser) {
  const inspect = async () => {
    await verifyPage(session, origin, invoke);
    return privateSnapshot(await invoke(["--session", session, "snapshot", "--json"]));
  };
  const current = await inspect();
  operationStage = "complete-known-extension-onboarding";
  loginControl(current, "heading", "Autofill your passwords securely with one click");
  const later = loginControl(current, "button", "Add it later");
  await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", later]])}\n`);
  await invoke(["--session", session, "wait", "--text", "Skip to web app"]);
  const skip = loginControl(await inspect(), "link", "Skip to web app");
  operationStage = "complete-known-extension-onboarding";
  await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", skip]])}\n`);
  await invoke(["--session", session, "wait", "--fn", VAULT_RENDER_READY_SCRIPT]);
}

export function vaultwardenWelcomeTourScript(origin: string): string {
  const approved = validateApprovedHouseholdOrigin(origin);
  return `(() => {
    if (window.location.origin !== ${JSON.stringify(approved)} || window.location.pathname !== "/" || window.location.search
      || !/^#\\/(?:vault(?:\\/items)?|settings\\/account)$/.test(window.location.hash)) throw new Error("invalid welcome-tour location");
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(visible);
    if (dialogs.length === 0) return;
    if (dialogs.length !== 1 || dialogs[0].tagName !== "CDK-DIALOG-CONTAINER") throw new Error("unknown welcome-tour modal");
    const dialog = dialogs[0];
    const headings = [...dialog.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].map((heading) => heading.innerText.trim());
    if (JSON.stringify(headings) !== JSON.stringify(["", "You're in! Welcome to Bitwarden"])) throw new Error("unknown welcome-tour headings");
    const buttons = [...dialog.querySelectorAll("button")];
    if (buttons.length !== 2 || buttons.some((button) => !(button instanceof HTMLButtonElement) || button.disabled || !visible(button))) throw new Error("unknown welcome-tour buttons");
    const skip = buttons.filter((button) => button.innerText.trim() === "Skip");
    const start = buttons.filter((button) => button.innerText.trim() === "Start tour");
    if (skip.length !== 1 || start.length !== 1) throw new Error("unknown welcome-tour buttons");
    skip[0].click();
  })()`;
}

async function dismissVaultwardenWelcomeTour(session: string, origin: string, invoke: typeof invokeBrowser): Promise<void> {
  await verifyPage(session, origin, invoke);
  operationStage = "dismiss-known-welcome-tour";
  await invoke(["--session", session, "eval", "--stdin"], vaultwardenWelcomeTourScript(origin));
  // Skip closes with an animation; wait until its backdrop cannot cover Vaults.
  const cleared = `(() => [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .cdk-overlay-backdrop')].every((element) => {
    const bounds = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return bounds.width === 0 || bounds.height === 0 || style.display === "none" || style.visibility === "hidden";
  }))()`;
  await invoke(["--session", session, "wait", "--fn", cleared]);
}
const LOGIN_REJECTION_PREFIX = "Invalid master password. Confirm your email is correct and your account was created on ";
export function hasVaultwardenInvalidMasterPassword(snapshot: string, origin: string): boolean {
  if (Buffer.byteLength(snapshot, "utf8") > 16_384 || snapshot.split("\n").length > 256) fail("household browser snapshot exceeds the login boundary");
  const expected = `${LOGIN_REJECTION_PREFIX}${new URL(validateApprovedHouseholdOrigin(origin)).host}.`;
  for (const line of snapshot.split("\n")) {
    const staticText = /^\s*- StaticText ("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    if (staticText) {
      let value: unknown;
      try { value = JSON.parse(staticText[1]); } catch { fail("household browser error inspection failed"); }
      if (typeof value === "string" && value.trim() === expected) return true;
      continue;
    }
    const value = line.replace(/^\s*- (?:text|alert|generic|paragraph):\s*/, "").trim();
    if (value === expected) return true;
  }
  return false;
}

export async function loginHouseholdBrowser(input: { projectRoot: string; runId: string; service: string; origin: string }, options: { invokeBrowserImplementation?: typeof invokeBrowser } = {}) {
  operationStage = "validate-login-service-and-origin";
  if (input.service !== "vaultwarden") fail("bounded household browser login supports only Vaultwarden");
  const origin = validateApprovedHouseholdOrigin(input.origin);
  if (!origin.startsWith("https://")) fail("Vaultwarden browser login requires private HTTPS");
  const session = browserSession(input.runId);
  operationStage = "load-private-login-credential";
  const credential = loadHouseholdCredential(input.projectRoot, input.runId, input.service);
  if (typeof credential.email !== "string") fail("Vaultwarden managed email is unavailable");
  const invoke = options.invokeBrowserImplementation ?? invokeBrowser;
  const snapshot = async () => {
    const snapshotStage = operationStage;
    await verifyPage(session, origin, invoke);
    operationStage = `${snapshotStage}-snapshot`;
    const inspected = privateSnapshot(await invoke(["--session", session, "snapshot", "--json"]));
    operationStage = snapshotStage;
    return inspected;
  };
  operationStage = "inspect-login-email-form";
  const emailSnapshot = await snapshot();
  operationStage = "inspect-login-email-controls";
  loginControl(emailSnapshot, "heading", "Log in");
  const emailRef = loginControl(emailSnapshot, "textbox", "Email address *");
  loginControl(emailSnapshot, "button", "Continue");
  if (snapshotControls(emailSnapshot).filter((control) => control.role === "textbox").length !== 1) fail("Vaultwarden email form is unknown");
  await fillHouseholdBrowserCredentials({ ...input, fields: [{ field: "email", selector: emailRef }] }, { invokeBrowserImplementation: invoke });
  operationStage = "submit-login-email";
  const continueRef = loginControl(await snapshot(), "button", "Continue");
  await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", continueRef]])}\n`);
  await invoke(["--session", session, "wait", "--text", "Welcome back"]);
  operationStage = "inspect-login-password-form";
  const passwordSnapshot = await snapshot();
  operationStage = "inspect-login-password-controls";
  loginControl(passwordSnapshot, "heading", "Welcome back");
  const passwordRef = loginControl(passwordSnapshot, "textbox", "Master password *");
  loginControl(passwordSnapshot, "button", "Log in");
  if (snapshotControls(passwordSnapshot).filter((control) => control.role === "textbox").length !== 1) fail("Vaultwarden password form is unknown");
  await fillHouseholdBrowserCredentials({ ...input, fields: [{ field: PASSWORD_FIELD, selector: passwordRef }] }, { invokeBrowserImplementation: invoke });
  operationStage = "submit-login-password-once";
  const loginRef = loginControl(await snapshot(), "button", "Log in");
  await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", loginRef]])}\n`);
  operationStage = "wait-login-result";
  // Route changes can precede rendering. Wait for known interactive vault controls
  // or the known error, never retry submission; child invocation is bounded to 30s.
  const waitScript = `(() => (${VAULT_RENDER_READY_SCRIPT}) || (${VAULT_EXTENSION_READY_SCRIPT}) || document.body.innerText.includes(${JSON.stringify(LOGIN_REJECTION_PREFIX)}))()`;
  await invoke(["--session", session, "wait", "--fn", waitScript]);
  operationStage = "classify-login-result";
  let resultSnapshot = await snapshot();
  let current = await verifyPage(session, origin, invoke);
  operationStage = "classify-login-result";
  if (hasVaultwardenInvalidMasterPassword(resultSnapshot, origin)) {
    return Object.freeze({ status: "rejected", service: "vaultwarden", reason: "invalid-master-password", submitted: true, scope: "fresh-login-only" });
  }
  if (snapshotControls(resultSnapshot).some((control) => control.role === "heading" && control.name === "Autofill your passwords securely with one click")) {
    await completeVaultwardenExtensionOnboarding(session, origin, invoke);
    resultSnapshot = await snapshot();
    current = await verifyPage(session, origin, invoke);
  }
  if (!vaultUiObserved(resultSnapshot, current)) {
    fail("Vaultwarden login result is unknown; inspect the account privately without signup or reset");
  }
  await dismissVaultwardenWelcomeTour(session, origin, invoke);
  operationStage = "open-readonly-account-menu";
  const menuScript = `(() => {
    if (window.location.origin !== ${JSON.stringify(origin)} || window.location.pathname !== "/" || window.location.search || !/^#\\/vault(?:\\/items)?$/.test(window.location.hash)) throw new Error("invalid vault location");
    const buttons = document.querySelectorAll('app-account-menu > button[aria-haspopup="menu"]');
    if (buttons.length !== 1 || !(buttons[0] instanceof HTMLButtonElement) || buttons[0].disabled) throw new Error("unknown account menu");
    buttons[0].click();
  })()`;
  await invoke(["--session", session, "eval", "--stdin"], menuScript);
  operationStage = "inspect-readonly-account-menu";
  const settingsRef = loginControl(await snapshot(), "menuitem", "Account settings");
  await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", settingsRef]])}\n`);
  await invoke(["--session", session, "wait", "--text", "My account"]);
  let accountMatched = false;
  let identityFailureStage: string | undefined;
  try {
    operationStage = "inspect-readonly-account-identity";
    const accountPage = await verifyPage(session, origin, invoke);
    operationStage = "inspect-readonly-account-identity";
    if (accountPage.pathname !== "/" || accountPage.hash !== "#/settings/account" || accountPage.search) fail("Vaultwarden account settings location is unknown");
    const accountSnapshot = await snapshot();
    loginControl(accountSnapshot, "heading", "My account");
    const emailRef = loginControl(accountSnapshot, "textbox", "Email");
    const type = attribute(await invoke(["--session", session, "get", "attr", emailRef, "type", "--json"]));
    const readOnly = attribute(await invoke(["--session", session, "get", "attr", emailRef, "readonly", "--json"]));
    const isEnabled = enabled(await invoke(["--session", session, "is", "enabled", emailRef, "--json"]));
    if ((type !== null && type !== "text") || readOnly === null || !isEnabled) fail("Vaultwarden account identity field is not readonly");
    let actualEmail = (await invoke(["--session", session, "get", "value", emailRef])).trim();
    try { const parsed = JSON.parse(actualEmail); if (typeof parsed === "string") actualEmail = parsed; } catch { /* Plain output is supported. */ }
    accountMatched = actualEmail === credential.email;
    operationStage = "verify-managed-account-identity";
    if (!accountMatched) fail("Vaultwarden account does not match the managed identity");
  } catch (error) {
    identityFailureStage = operationStage;
    throw error;
  } finally {
    try {
      await dismissVaultwardenWelcomeTour(session, origin, invoke);
      operationStage = "restore-vault-after-account-inspection";
      const vaultsRef = loginControl(await snapshot(), "link", "Vaults");
      await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", vaultsRef]])}\n`);
      await invoke(["--session", session, "wait", "--fn", VAULT_RENDER_READY_SCRIPT]);
      const restoredSnapshot = await snapshot();
      const restoredPage = await verifyPage(session, origin, invoke);
      operationStage = "verify-restored-vault";
      if (!vaultUiObserved(restoredSnapshot, restoredPage)) fail("Vaultwarden vault restoration is unknown");
    } catch (error) {
      // Preserve an identity failure when best-effort cleanup also fails.
      if (identityFailureStage === undefined) throw error;
    }
    if (identityFailureStage !== undefined) operationStage = identityFailureStage;
  }
  operationStage = "verify-managed-account-identity";
  if (!accountMatched) fail("Vaultwarden account does not match the managed identity");
  return Object.freeze({ status: "accepted", service: "vaultwarden", accountMatched: true, vaultUiObserved: true, submitted: true, scope: "fresh-login-only" });
}

export function householdVaultwardenCredentialFingerprint(projectRoot: string, runId: string): string {
  const credential = loadHouseholdCredential(projectRoot, runId, "vaultwarden");
  if (typeof credential.email !== "string") fail("Vaultwarden managed email is unavailable");
  return createHash("sha256").update(JSON.stringify([credential.username, credential.email, credential.password])).digest("hex");
}

const SIGNUP_BASE_STAGES = ["unknown-signup-stage", "validate-signup-boundary", "require-new-signup-browser", "record-signup-browser-session", "launch-ca-trusted-signup-browser",
  "inspect-signup-identity", "inspect-signup-password", "disable-signup-breach-lookup", "record-single-signup-submission", "submit-signup-once",
  "complete-signup-onboarding", "complete-known-extension-onboarding", "logout-created-signup-account", "verify-signup-fresh-login", "verify-signup-secure-context", "close-signup-browser",
  "read-browser-url", "parse-browser-url", "match-browser-origin", "validate-service-and-origin", "load-private-credential", "verify-browser-origin",
  "inspect-username-field", "inspect-email-field", "inspect-password-field", "fill-credential-fields", "verify-username-field", "verify-email-field", "verify-password-field",
  "dismiss-known-welcome-tour", "validate-login-service-and-origin", "load-private-login-credential", "inspect-login-email-form", "inspect-login-email-controls",
  "submit-login-email", "inspect-login-password-form", "inspect-login-password-controls", "submit-login-password-once", "wait-login-result", "classify-login-result",
  "open-readonly-account-menu", "inspect-readonly-account-menu", "inspect-readonly-account-identity", "verify-managed-account-identity", "restore-vault-after-account-inspection", "verify-restored-vault"];
export const VAULTWARDEN_SIGNUP_STAGES = Object.freeze([...SIGNUP_BASE_STAGES, ...SIGNUP_BASE_STAGES.map((stage) => `${stage}-snapshot`)]);
class VaultwardenSignupFailure extends Error {
  constructor(readonly stage: string, readonly submitted: boolean, readonly browserSession: string | null) { super("Vaultwarden bounded signup stopped; do not repeat signup"); }
}
export function describeHouseholdVaultwardenSignupFailure(error: unknown) {
  if (!(error instanceof VaultwardenSignupFailure)) return null;
  return Object.freeze({ stage: error.stage, submitted: error.submitted, browserSession: error.browserSession });
}
type VaultwardenSignupInput = {
  projectRoot: string; runId: string; origin: string; browserBin: string; caCert: string;
  uiContractVersion: "vaultwarden-1.37.3-20260927"; browserSandbox?: "enabled" | "disabled";
  expectedCredentialFingerprint: string; expectedCaFingerprint: string;
  beforeSubmit: () => Promise<void>;
  onBrowserSession?: (session: string) => Promise<void>;
};
export async function signupHouseholdVaultwarden(input: VaultwardenSignupInput, options: { invokeBrowserImplementation?: typeof invokeBrowser } = {}) {
  try { return await performHouseholdVaultwardenSignup(input, options); }
  catch (error) {
    if (error instanceof VaultwardenSignupFailure) throw error;
    let stage = "unknown-signup-stage";
    if (VAULTWARDEN_SIGNUP_STAGES.includes(operationStage)) stage = operationStage;
    throw new VaultwardenSignupFailure(stage, false, null);
  }
}
async function performHouseholdVaultwardenSignup(input: VaultwardenSignupInput, options: { invokeBrowserImplementation?: typeof invokeBrowser }) {
  operationStage = "validate-signup-boundary";
  const origin = validateApprovedHouseholdOrigin(input.origin);
  const fixedSession = browserSession(input.runId);
  const session = `selfhost-vault-signup-${createHash("sha256").update(input.runId).digest("hex").slice(0, 12)}-${randomBytes(12).toString("hex")}`;
  if (!origin.startsWith("https://") || input.uiContractVersion !== "vaultwarden-1.37.3-20260927"
    || typeof input.beforeSubmit !== "function" || (input.onBrowserSession !== undefined && typeof input.onBrowserSession !== "function")
    || !["enabled", "disabled"].includes(input.browserSandbox ?? "enabled")) fail("Vaultwarden signup boundary is invalid");
  if (!isAbsolute(input.browserBin) || !isAbsolute(input.caCert)) fail("Vaultwarden signup requires exact browser and public CA paths");
  const executable = realpathSync(input.browserBin);
  const executableMetadata = statSync(executable);
  if (!executableMetadata.isFile() || (executableMetadata.mode & 0o022) !== 0) fail("Vaultwarden signup browser is unsafe");
  accessSync(executable, constants.X_OK);
  const caMetadata = lstatSync(input.caCert);
  if (!caMetadata.isFile() || caMetadata.isSymbolicLink() || realpathSync(input.caCert) !== input.caCert
    || caMetadata.size < 1 || caMetadata.size > 16_384 || (caMetadata.mode & 0o022) !== 0) fail("Vaultwarden signup public CA is unsafe");
  const caText = readFileSync(input.caCert, "utf8");
  if (!/^\s*-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(caText)
    || (caText.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1 || caText.includes("PRIVATE KEY")) fail("Vaultwarden signup requires one public CA certificate");
  const ca = new X509Certificate(caText);
  if (!ca.ca || !ca.verify(ca.publicKey) || ca.subject !== ca.issuer
    || Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) < Date.now()) fail("Vaultwarden signup public root CA is invalid");
  if (ca.fingerprint256 !== input.expectedCaFingerprint
    || householdVaultwardenCredentialFingerprint(input.projectRoot, input.runId) !== input.expectedCredentialFingerprint) fail("Vaultwarden signup approved private inputs changed");
  const invokeRaw = options.invokeBrowserImplementation ?? (async (args: string[], value = "") => {
    const result = await runBrowser(executable, args, value);
    if (result.kind !== "success" || typeof result.output !== "string") fail("household browser signup action failed");
    return result.output;
  });
  // An explicit empty config excludes ambient profiles, plugins, restore and TLS bypass.
  const configDirectory = mkdtempSync(join(tmpdir(), "selfhost-vault-browser-config-"));
  const configPath = join(configDirectory, "agent-browser.json");
  writeFileSync(configPath, "{}\n", { mode: 0o600, flag: "wx" });
  const invoke = (args: string[], value = "") => {
    const scoped = [...args];
    const sessionFlag = scoped.indexOf("--session");
    if (sessionFlag >= 0) {
      if (scoped[sessionFlag + 1] === fixedSession) scoped[sessionFlag + 1] = session;
      else if (scoped[sessionFlag + 1] !== session) fail("Vaultwarden signup browser scope changed");
    }
    return invokeRaw(["--config", configPath, ...scoped], value);
  };
  const sessions = async () => {
    const raw = await invoke(["--session", session, "session", "list", "--json"]);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { fail("Vaultwarden fresh browser inventory is unknown"); }
    if (!successfulBrowserEnvelope(parsed) || !isRecord(parsed.data)
      || !Array.isArray(parsed.data.sessions) || parsed.data.sessions.some((value) => typeof value !== "string")) fail("Vaultwarden fresh browser inventory is unknown");
    return parsed.data.sessions as string[];
  };
  let launched = false;
  let submitted = false;
  let accepted = false;
  try {
    operationStage = "require-new-signup-browser";
    if ((await sessions()).includes(session)) fail("Vaultwarden signup refuses an existing browser session");
    operationStage = "record-signup-browser-session";
    if (input.onBrowserSession !== undefined) await input.onBrowserSession(session);
    operationStage = "launch-ca-trusted-signup-browser";
    if (new X509Certificate(readFileSync(input.caCert)).fingerprint256 !== input.expectedCaFingerprint) fail("Vaultwarden signup approved CA changed");
    const launch = ["--session", session, "--ca-cert", input.caCert, "--allowed-domains", new URL(origin).hostname];
    if (input.browserSandbox === "disabled") launch.push("--args", "--no-sandbox");
    const launchOutput = await invoke([...launch, "open", origin, "--json"]);
    let launchResult: unknown;
    try { launchResult = JSON.parse(launchOutput); } catch { fail("Vaultwarden fresh launch provenance is unknown"); }
    if (!successfulBrowserEnvelope(launchResult) || !isRecord(launchResult.data)
      || !isRecord(launchResult.data.lifecycle) || launchResult.data.lifecycle.restoreStatus !== "not_configured"
      || !isRecord(launchResult.data.lifecycle.effectiveLaunch) || launchResult.data.lifecycle.effectiveLaunch.browserLaunched !== true
      || launchResult.data.lifecycle.effectiveLaunch.engine !== "chrome") fail("Vaultwarden fresh launch provenance is unknown");
    launched = true;
    if (!(await sessions()).includes(session)) fail("Vaultwarden signup fresh browser was not observed");
    const secure = async () => {
      if (householdVaultwardenCredentialFingerprint(input.projectRoot, input.runId) !== input.expectedCredentialFingerprint) fail("Vaultwarden signup approved credential changed");
      await verifyPage(session, origin, invoke);
      await invoke(["--session", session, "eval", "--stdin"], `(() => { if (location.origin !== ${JSON.stringify(origin)} || !window.isSecureContext || !window.crypto || !window.crypto.subtle) throw new Error("secure WebCrypto context required"); return true; })()`);
    };
    const snapshot = async () => { await secure(); return privateSnapshot(await invoke(["--session", session, "snapshot", "--json"])); };
    const click = async (role: string, name: string) => {
      const ref = loginControl(await snapshot(), role, name);
      await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", ref]])}\n`);
    };
    await invoke(["--session", session, "wait", "--text", "Log in"]);
    loginControl(await snapshot(), "heading", "Log in");
    await click("link", "Create account");
    await invoke(["--session", session, "wait", "--text", "Create account"]);
    const account = await snapshot();
    operationStage = "inspect-signup-identity";
    loginControl(account, "heading", "Create account");
    if (snapshotControls(account).filter((control) => control.role === "textbox").length !== 2) fail("Vaultwarden signup identity form is unknown");
    await fillHouseholdBrowserCredentials({ ...input, service: "vaultwarden", fields: [
      { field: "email", selector: loginControl(account, "textbox", "Email address *") },
      { field: "username", selector: loginControl(account, "textbox", "Name") },
    ] }, { invokeBrowserImplementation: invoke });
    await click("button", "Continue");
    await invoke(["--session", session, "wait", "--text", "Set a strong password"]);
    const password = await snapshot();
    operationStage = "inspect-signup-password";
    loginControl(password, "heading", "Set a strong password");
    const passwordRef = loginControl(password, "textbox", "Master password *");
    const confirmationRef = loginControl(password, "textbox", "Confirm master password *");
    const hintRef = loginControl(password, "textbox", "Master password hint");
    if (snapshotControls(password).filter((control) => control.role === "textbox").length !== 3) fail("Vaultwarden signup password form is unknown");
    for (const [ref, id] of [[passwordRef, "input-password-form_new-password"], [confirmationRef, "input-password-form_new-password-confirm"]]) {
      if (attribute(await invoke(["--session", session, "get", "attr", ref, "id", "--json"])) !== id) fail("Vaultwarden signup password identity is unknown");
    }
    let hint = (await invoke(["--session", session, "get", "value", hintRef])).trim();
    try { const parsed = JSON.parse(hint); if (typeof parsed === "string") hint = parsed; } catch { /* Plain empty output is supported; never export hints. */ }
    if (hint !== "") fail("Vaultwarden signup password hint must be empty");
    operationStage = "disable-signup-breach-lookup";
    await invoke(["--session", session, "eval", "--stdin"], `(() => {
      if (location.origin !== ${JSON.stringify(origin)}) throw new Error("invalid origin");
      const fields = document.querySelectorAll("#input-password-form_check-for-breaches");
      if (fields.length !== 1 || !(fields[0] instanceof HTMLInputElement) || fields[0].type !== "checkbox" || fields[0].disabled || !fields[0].checked
        || fields[0].labels.length !== 1 || fields[0].labels[0].innerText.trim() !== "Check known data breaches for this password") throw new Error("unknown breach control");
      fields[0].click(); if (fields[0].checked) throw new Error("breach lookup still enabled");
    })()`);
    await fillHouseholdBrowserCredentials({ ...input, service: "vaultwarden", fields: [
      { field: PASSWORD_FIELD, selector: passwordRef }, { field: PASSWORD_FIELD, selector: confirmationRef },
    ] }, { invokeBrowserImplementation: invoke });
    const submitRef = loginControl(await snapshot(), "button", "Create account");
    operationStage = "record-single-signup-submission";
    await input.beforeSubmit();
    operationStage = "submit-signup-once";
    submitted = true;
    await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify([["click", submitRef]])}\n`);
    operationStage = "complete-signup-onboarding";
    await invoke(["--session", session, "wait", "--text", "Autofill your passwords securely with one click"]);
    await completeVaultwardenExtensionOnboarding(session, origin, invoke);
    const vaultSnapshot = await snapshot();
    if (!vaultUiObserved(vaultSnapshot, await verifyPage(session, origin, invoke))) fail("Vaultwarden signup unlocked vault is unknown");
    await dismissVaultwardenWelcomeTour(session, origin, invoke);
    operationStage = "logout-created-signup-account";
    await invoke(["--session", session, "eval", "--stdin"], `(() => {
      if (location.origin !== ${JSON.stringify(origin)} || !/^#\\/vault(?:\\/items)?$/.test(location.hash)) throw new Error("invalid vault");
      const menus = document.querySelectorAll('app-account-menu > button[aria-haspopup="menu"]');
      if (menus.length !== 1 || !(menus[0] instanceof HTMLButtonElement) || menus[0].disabled) throw new Error("unknown account menu"); menus[0].click();
    })()`);
    await click("menuitem", "Log out");
    await invoke(["--session", session, "wait", "--text", "Log in"]);
    operationStage = "verify-signup-fresh-login";
    const verified = await loginHouseholdBrowser({ ...input, service: "vaultwarden" }, { invokeBrowserImplementation: invoke });
    if (verified.status !== "accepted") fail("Vaultwarden created account fresh login was not accepted");
    await secure();
    accepted = true;
    return Object.freeze({ status: "accepted" as const, observedAt: new Date().toISOString(), secureContext: true as const, cryptoSubtle: true as const, freshLoginVerified: true });
  } catch {
    let stage = "unknown-signup-stage";
    if (VAULTWARDEN_SIGNUP_STAGES.includes(operationStage)) stage = operationStage;
    let ownedSession: string | null = null;
    if (launched) ownedSession = session;
    throw new VaultwardenSignupFailure(stage, submitted, ownedSession);
  } finally {
    let closeFailure: VaultwardenSignupFailure | undefined;
    if (launched && accepted) {
      const failedStage = operationStage;
      try { await invoke(["--session", session, "close"]); }
      catch { closeFailure = new VaultwardenSignupFailure("close-signup-browser", true, session); }
      operationStage = failedStage;
    }
    try { unlinkSync(configPath); rmdirSync(configDirectory); }
    finally { if (closeFailure !== undefined) throw closeFailure; }
  }
}

export async function captureHouseholdBrowserApiKey(input: { projectRoot: string; runId: string; service: string; origin: string; selector?: string }, options: { invokeBrowserImplementation?: typeof invokeBrowser; storeImplementation?: typeof storeHouseholdApiKey } = {}) {
  operationStage = "validate-api-key-page";
  const allowedPaths = API_KEY_PAGES[input.service];
  if (allowedPaths === undefined) fail("household service does not support API-key capture");
  loadHouseholdCredential(input.projectRoot, input.runId, input.service);
  const origin = validateApprovedHouseholdOrigin(input.origin);
  const session = browserSession(input.runId);
  const invoke = options.invokeBrowserImplementation ?? invokeBrowser;
  operationStage = "verify-browser-origin";
  const current = await verifyPage(session, origin, invoke);
  if (!allowedPaths.has(current.pathname) || current.search || current.hash) fail("browser is outside the approved household API-key settings page");
  if (input.service === "audiobookshelf") {
    if (input.selector !== undefined) fail("Audiobookshelf API-key capture uses its fixed creation field");
    operationStage = "capture-api-key-field";
    const value = capturedValue(await invoke(["--session", session, "eval", "--stdin"], `${audiobookshelfApiKeyEvalScript()}\n`));
    operationStage = "store-api-key";
    const stored = (options.storeImplementation ?? storeHouseholdApiKey)(input.projectRoot, input.runId, input.service, value);
    return Object.freeze({ status: stored.status, path: stored.path, service: input.service });
  }
  if (input.selector === undefined) fail("household API-key selector is required");
  const selector = safeSelector(input.selector);
  operationStage = "inspect-api-key-field";
  const metadataNames = ["type", "disabled", "readonly", "name", "aria-label", "placeholder"];
  const metadata = await Promise.all([
    ...metadataNames.map((name) => invoke(["--session", session, "get", "attr", selector, name, "--json"]).then(attribute)),
    invoke(["--session", session, "is", "enabled", selector, "--json"]).then(enabled),
  ]);
  const [type, disabled, readOnly, name, ariaLabel, placeholder] = metadata;
  if (type === PASSWORD_FIELD || (type !== null && type !== "text")) fail("household API-key field type is invalid");
  if (disabled !== null || readOnly === null || metadata[6] !== true) fail("household API-key field must be enabled and readonly");
  const identity = [name, ariaLabel, placeholder].filter((value): value is string => value !== null).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (!/(^| )(api ?key|token)( |$)/.test(identity)) fail("household API-key field identity is invalid");
  operationStage = "capture-api-key-field";
  const value = capturedValue(await invoke(["--session", session, "get", "value", selector]));
  operationStage = "store-api-key";
  const stored = (options.storeImplementation ?? storeHouseholdApiKey)(input.projectRoot, input.runId, input.service, value);
  return Object.freeze({ status: stored.status, path: stored.path, service: input.service });
}

function parse(args: string[]) {
  const command = args[0];
  if (!['fill', 'capture-api-key', 'login'].includes(command)) fail("household browser credential command is invalid");
  const flags: Record<string, string[]> = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index]; const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) fail("household browser credential arguments are invalid");
    (flags[name.slice(2)] ??= []).push(value);
  }
  const allowed = ["project-root", "run-id", "service", "origin", "browser-bin"];
  if (command === "fill") allowed.push("input");
  if (command === "capture-api-key") allowed.push("selector");
  if (Object.keys(flags).some((name) => !allowed.includes(name))) fail("household browser credential option is invalid");
  const one = (name: string, required = true) => {
    const values = flags[name] ?? [];
    if (values.length > 1 || (required && values.length !== 1)) fail(`--${name} is invalid`);
    return values[0] ?? "";
  };
  return { command, flags, one };
}
async function main() {
  const parsed = parse(Bun.argv.slice(2));
  const selectedBrowser = parsed.one("browser-bin", false);
  if (selectedBrowser) {
    operationStage = "validate-browser-binary";
    if (!isAbsolute(selectedBrowser)) fail("browser binary path must be absolute");
    try {
      const resolved = realpathSync(selectedBrowser);
      if (!statSync(resolved).isFile()) fail("browser binary must be a file");
      accessSync(resolved, constants.X_OK);
      browserExecutable = resolved;
    } catch {
      fail("browser binary is unavailable or not executable");
    }
  }
  const common = { projectRoot: parsed.one("project-root"), runId: parsed.one("run-id"), service: parsed.one("service"), origin: parsed.one("origin") };
  let result;
  if (parsed.command === "fill") {
    const fields = (parsed.flags.input ?? []).map((value) => { const at = value.indexOf("="); if (at < 1) fail("--input must use FIELD=@eN"); return { field: value.slice(0, at), selector: value.slice(at + 1) }; });
    result = await fillHouseholdBrowserCredentials({ ...common, fields });
  } else if (parsed.command === "login") {
    result = await loginHouseholdBrowser(common);
  } else result = await captureHouseholdBrowserApiKey({ ...common, selector: parsed.one("selector", common.service !== "audiobookshelf") || undefined });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (typeof Bun !== "undefined" && Bun.argv[1] !== undefined && ["household-browser-credentials.ts", "household-browser-credentials.js"].includes(basename(Bun.argv[1]))
  && import.meta.url === pathToFileURL(Bun.argv[1]).href) main().catch(() => { process.stderr.write(`FAIL household browser credential operation at ${operationStage}\n`); process.exitCode = 1; });
