#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { isIP } from "node:net";
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

function fail(message: string): never { throw new Error(message); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
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
    child.stdin.on("error", () => done({ kind: "failed" }));
    child.once("error", (error) => done({ kind: launched ? "failed" : "spawn-error", error }));
    child.once("spawn", () => { launched = true; child.stdin.end(input, "utf8"); });
    child.once("close", (status, signal) => done(status === 0 && !signal && bytes <= 16_384 ? { kind: "success", output } : { kind: "failed" }));
  });
}
async function invokeBrowser(args: string[], input = ""): Promise<string> {
  let result = await runBrowser("agent-browser", args, input);
  if (result.kind === "spawn-error" && isRecord(result.error) && result.error.code === "ENOENT") result = await runBrowser("bunx", ["--bun", "agent-browser", ...args], input);
  if (result.kind !== "success" || typeof result.output !== "string") fail("household browser credential action failed");
  return result.output;
}
function attribute(raw: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("household browser field inspection failed"); }
  if (!isRecord(parsed) || parsed.success !== true || !isRecord(parsed.data) || parsed.error !== null || !(parsed.data.value === null || typeof parsed.data.value === "string")) fail("household browser field inspection failed");
  return parsed.data.value as string | null;
}
function enabled(raw: string): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail("household browser field inspection failed"); }
  if (!isRecord(parsed) || parsed.success !== true || !isRecord(parsed.data) || parsed.error !== null || typeof parsed.data.enabled !== "boolean") fail("household browser field inspection failed");
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
  const raw = (await invoke(["--session", session, "get", "url"])).trim();
  let current: URL;
  try { current = new URL(raw); } catch { fail("household browser page URL is invalid"); }
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
  const credential = loadHouseholdCredential(input.projectRoot, input.runId, input.service);
  const supportedFields = SERVICE_FILL_FIELDS[input.service];
  if (supportedFields === undefined) fail("household service does not support browser credential fill");
  const origin = validateApprovedHouseholdOrigin(input.origin);
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
  await verifyPage(session, origin, invoke);
  for (const item of fields) await verifyFillField(session, item.field, item.selector, invoke);
  const batch = fields.map(({ selector, value }) => ["fill", selector, value]);
  await invoke(["--session", session, "batch", "--bail", "--json"], `${JSON.stringify(batch)}\n`);
  return Object.freeze({ status: "filled", service: input.service, fields: Object.freeze(fields.map(({ field }) => field)) });
}

export async function captureHouseholdBrowserApiKey(input: { projectRoot: string; runId: string; service: string; origin: string; selector?: string }, options: { invokeBrowserImplementation?: typeof invokeBrowser; storeImplementation?: typeof storeHouseholdApiKey } = {}) {
  const allowedPaths = API_KEY_PAGES[input.service];
  if (allowedPaths === undefined) fail("household service does not support API-key capture");
  loadHouseholdCredential(input.projectRoot, input.runId, input.service);
  const origin = validateApprovedHouseholdOrigin(input.origin);
  const session = browserSession(input.runId);
  const invoke = options.invokeBrowserImplementation ?? invokeBrowser;
  const current = await verifyPage(session, origin, invoke);
  if (!allowedPaths.has(current.pathname) || current.search || current.hash) fail("browser is outside the approved household API-key settings page");
  if (input.service === "audiobookshelf") {
    if (input.selector !== undefined) fail("Audiobookshelf API-key capture uses its fixed creation field");
    const value = capturedValue(await invoke(["--session", session, "eval", "--stdin"], `${audiobookshelfApiKeyEvalScript()}\n`));
    const stored = (options.storeImplementation ?? storeHouseholdApiKey)(input.projectRoot, input.runId, input.service, value);
    return Object.freeze({ status: stored.status, path: stored.path, service: input.service });
  }
  if (input.selector === undefined) fail("household API-key selector is required");
  const selector = safeSelector(input.selector);
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
  const value = capturedValue(await invoke(["--session", session, "get", "value", selector]));
  const stored = (options.storeImplementation ?? storeHouseholdApiKey)(input.projectRoot, input.runId, input.service, value);
  return Object.freeze({ status: stored.status, path: stored.path, service: input.service });
}

function parse(args: string[]) {
  const command = args[0];
  if (!['fill', 'capture-api-key'].includes(command)) fail("household browser credential command is invalid");
  const flags: Record<string, string[]> = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index]; const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) fail("household browser credential arguments are invalid");
    (flags[name.slice(2)] ??= []).push(value);
  }
  const allowed = command === "fill" ? ["project-root", "run-id", "service", "origin", "input"] : ["project-root", "run-id", "service", "origin", "selector"];
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
  const common = { projectRoot: parsed.one("project-root"), runId: parsed.one("run-id"), service: parsed.one("service"), origin: parsed.one("origin") };
  let result;
  if (parsed.command === "fill") {
    const fields = (parsed.flags.input ?? []).map((value) => { const at = value.indexOf("="); if (at < 1) fail("--input must use FIELD=@eN"); return { field: value.slice(0, at), selector: value.slice(at + 1) }; });
    result = await fillHouseholdBrowserCredentials({ ...common, fields });
  } else result = await captureHouseholdBrowserApiKey({ ...common, selector: parsed.one("selector", common.service !== "audiobookshelf") || undefined });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (Bun.argv[1] !== undefined && import.meta.url === pathToFileURL(Bun.argv[1]).href) main().catch(() => { process.stderr.write("FAIL household browser credential operation\n"); process.exitCode = 1; });
