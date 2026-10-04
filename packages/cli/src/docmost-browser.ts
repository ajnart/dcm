import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const fieldPattern = /^@e[1-9][0-9]{0,5}$/;
const childEnvironmentKeys = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ", "XDG_CACHE_HOME", "XDG_CONFIG_HOME",
  "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME"];

function fail(message: string): never { throw new Error(message); }

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${name} is invalid`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${name} is invalid`);
}

function parse(args: string[]) {
  const flags: Record<string, string> = {};
  const refs: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail("Docmost browser-password needs paired options");
    if (key === "--ref") {
      if (!fieldPattern.test(value) || refs.includes(value) || refs.length >= 2) fail("Use one or two fresh password-field refs");
      refs.push(value);
      continue;
    }
    if (!["--project-root", "--run-id", "--browser-bin"].includes(key) || flags[key]) fail("Unsupported Docmost browser-password option");
    flags[key] = value;
  }
  if (!flags["--project-root"] || !flags["--run-id"] || refs.length === 0
    || !runIdPattern.test(flags["--run-id"])) fail("Docmost browser-password needs project root, run ID, and fresh ref(s)");
  return { root: flags["--project-root"], runId: flags["--run-id"], refs, browserBin: flags["--browser-bin"] };
}

async function browserExecutable(path?: string): Promise<string> {
  if (path === undefined) return "agent-browser";
  if (!isAbsolute(path) || resolve(path) !== path) fail("--browser-bin must be an exact absolute executable path");
  try {
    const canonical = await realpath(path);
    const metadata = await lstat(canonical);
    if (!metadata.isFile() || (metadata.mode & 0o022) !== 0) fail("unsafe browser binary");
    await access(canonical, constants.X_OK);
    return canonical;
  } catch { fail("Docmost browser binary is unavailable, unsafe, or not executable"); }
}

async function ownedDirectory(path: string, privateMode: boolean): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) fail("Docmost browser state directory is unsafe");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Docmost browser state has another owner");
  const mode = metadata.mode & 0o777;
  if (privateMode && mode !== 0o700) fail("Docmost browser state must be owner-only");
  if (!privateMode && (mode & 0o002) !== 0) fail("Project root is world-writable");
}

async function privateJson(path: string, limit: number, name: string): Promise<Record<string, unknown>> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 2
    || metadata.size > limit || (metadata.mode & 0o777) !== 0o600 || await realpath(path) !== path) {
    fail(`${name} must be one owner-only regular file`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has another owner`);
  try { return object(JSON.parse(await readFile(path, "utf8")), name); }
  catch { fail(`${name} is invalid`); }
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of childEnvironmentKeys) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  if (!environment.PATH) environment.PATH = "/usr/local/bin:/usr/bin:/bin";
  return environment;
}

function browser(executable: string, spawn: typeof spawnSync, session: string, args: string[], input?: string, capture = true): string {
  let standardIo: ["pipe", "pipe" | "ignore", "pipe" | "ignore"] = ["pipe", "pipe", "pipe"];
  if (!capture) standardIo = ["pipe", "ignore", "ignore"];
  const result = spawn(executable, ["--session", session, ...args], {
    encoding: "utf8", env: childEnvironment(), input, maxBuffer: 2048, timeout: 30_000,
    stdio: standardIo,
  });
  if (result.error || result.status !== 0) fail("Docmost browser-password failed; check the selected browser session and fresh field refs");
  if (!capture) return "";
  if (typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 2048) fail("Docmost browser inspection failed");
  return result.stdout;
}

function browserData(raw: string): Record<string, unknown> {
  let parsed: Record<string, unknown>;
  try { parsed = object(JSON.parse(raw), "browser field inspection"); }
  catch { fail("Docmost browser field inspection failed"); }
  if (parsed.success !== true || (parsed.error !== undefined && parsed.error !== null)) fail("Docmost browser field inspection failed");
  return object(parsed.data, "browser field inspection");
}

function fieldValue(invoke: (args: string[]) => string, ref: string, name: string): unknown {
  const data = browserData(invoke(["get", "attr", ref, name, "--json"]));
  if (!Object.hasOwn(data, "value")) fail("Docmost browser field inspection failed");
  return data.value;
}

export async function docmostBrowserPassword(args: string[], runtime: { spawnSyncImplementation?: typeof spawnSync } = {}): Promise<void> {
  const options = parse(args);
  const executable = await browserExecutable(options.browserBin);
  if (!isAbsolute(options.root) || resolve(options.root) !== options.root || options.root === sep
    || options.root === resolve(homedir())) fail("Choose one exact Docmost project root");
  await ownedDirectory(options.root, false);
  const stateRoot = join(options.root, ".selfhost");
  const adapterRoot = join(stateRoot, "docmost");
  const runRoot = join(adapterRoot, options.runId);
  await ownedDirectory(stateRoot, true);
  await ownedDirectory(adapterRoot, true);
  await ownedDirectory(runRoot, true);
  const checkpoint = await privateJson(join(runRoot, "state.json"), 16 * 1024, "Docmost checkpoint");
  exact(checkpoint, ["schemaVersion", "project", "runId", "approvalDigest", "composeFile", "handoffPath", "health", "ownerSetup"], "Docmost checkpoint");
  const handoffPath = join(runRoot, "private-handoff.json");
  if (checkpoint.schemaVersion !== 1 || checkpoint.runId !== options.runId || checkpoint.health !== true
    || checkpoint.ownerSetup !== "browser-evidence-required" || checkpoint.handoffPath !== handoffPath) {
    fail("Docmost browser-password needs the exact healthy approved run");
  }
  const handoff = await privateJson(handoffPath, 16 * 1024, "Docmost handoff");
  exact(handoff, ["schemaVersion", "kind", "runId", "projectId", "account", "url", "password", "appSecret",
    "databasePassword", "status"], "Docmost handoff");
  if (handoff.schemaVersion !== 1 || handoff.kind !== "docmost-private-handoff"
    || handoff.runId !== options.runId || handoff.projectId !== checkpoint.project
    || handoff.status !== "first-owner-browser-required"
    || typeof handoff.password !== "string" || !/^[0-9a-f]{64}$/.test(handoff.password)) {
    fail("Docmost handoff does not match the approved run");
  }
  let origin: URL;
  try { origin = new URL(String(handoff.url)); }
  catch { fail("Docmost handoff URL is invalid"); }
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/"
    || origin.search || origin.hash || origin.username || origin.password) {
    fail("Docmost browser-password is restricted to the exact local HTTP origin");
  }
  const session = `selfhost-docmost-${options.runId}`;
  const invoke = (args: string[], input?: string, capture = true) => browser(executable, runtime.spawnSyncImplementation ?? spawnSync, session, args, input, capture);
  const current = invoke(["get", "url"]).trim();
  let page: URL;
  try { page = new URL(current); }
  catch { fail("Docmost browser session URL is invalid"); }
  let allowedSearch = page.search === "";
  if (page.pathname === "/login" && page.search === "?logout=1") allowedSearch = true;
  if (page.origin !== origin.origin || !["/setup/register", "/login"].includes(page.pathname)
    || !allowedSearch || page.hash || page.username || page.password) {
    fail("Docmost browser session is not on its approved local setup or login page");
  }
  for (const ref of options.refs) {
    const type = fieldValue(invoke, ref, "type");
    const disabled = fieldValue(invoke, ref, "disabled");
    const readOnly = fieldValue(invoke, ref, "readonly");
    const enabled = browserData(invoke(["is", "enabled", ref, "--json"]));
    if (type !== "password" || disabled !== null || readOnly !== null || enabled.enabled !== true) {
      fail("Docmost browser ref is not a fresh enabled password field");
    }
  }
  const commands = options.refs.map((ref) => ["fill", ref, handoff.password]);
  invoke(["batch", "--bail", "--json"], `${JSON.stringify(commands)}\n`, false);
  process.stdout.write("PASS Docmost browser password filled\n");
}
