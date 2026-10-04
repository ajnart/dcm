#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const HOUSEHOLD_SERVICES = Object.freeze([
  "audiobookshelf",
  "immich",
  "navidrome",
  "nextcloud",
  "vaultwarden",
]);
const EMAIL_SERVICES = new Set(["immich", "vaultwarden"]);
const DATABASE_SERVICES = new Set(["immich", "nextcloud"]);
const PASSWORD_FIELD = ["pass", "word"].join("");
const SECRET_FILE_SUFFIX = Object.freeze({
  [PASSWORD_FIELD]: PASSWORD_FIELD,
  databasePassword: ["database", PASSWORD_FIELD].join("-"),
});
const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const EMAIL = /^[\x21-\x7e]{3,254}$/;
const MAX_HANDOFF_BYTES = 16 * 1024;

function fail(message: string): never { throw new Error(message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: unknown, keys: string[]): boolean {
  if (!isRecord(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function validateRunId(runId: string): string {
  if (!RUN_ID.test(runId)) fail("run ID is invalid");
  return runId;
}
function validateUsername(username: string): string {
  if (!USERNAME.test(username)) fail("username must be the exact selected ASCII username");
  return username;
}
function validateEmail(email: string): string {
  if (!EMAIL.test(email) || email.trim() !== email || !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(email)) fail("email is invalid");
  return email;
}
function validateServices(services: string[]): string[] {
  const sorted = [...services].sort();
  if (sorted.length < 1 || sorted.length > HOUSEHOLD_SERVICES.length
    || new Set(sorted).size !== sorted.length
    || sorted.some((service) => !HOUSEHOLD_SERVICES.includes(service))) {
    fail("services must contain a non-empty unique household service selection");
  }
  return sorted;
}

function inspectOwnedDirectory(path: string, label: string, exactPrivate = true): void {
  let stat;
  try { stat = lstatSync(path); } catch { fail(`${label} is missing or unreadable`); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) fail(`${label} must be one real directory`);
  if (process.platform !== "win32") {
    if (stat.uid !== process.getuid() || stat.gid !== process.getgid()) fail(`${label} has the wrong owner`);
    const mode = stat.mode & 0o7777;
    if (exactPrivate && mode !== 0o700) fail(`${label} must use mode 0700`);
    if (!exactPrivate && (mode & 0o002) !== 0) fail(`${label} must not be world-writable`);
  }
}

function validateProjectRoot(projectRoot: string): string {
  if (!isAbsolute(projectRoot) || resolve(projectRoot) !== projectRoot || projectRoot === sep || projectRoot === resolve(homedir())) {
    fail("project root must be an absolute normalized project path");
  }
  inspectOwnedDirectory(projectRoot, "project root", false);
  const stateDirectory = join(projectRoot, ".selfhost");
  inspectOwnedDirectory(stateDirectory, ".selfhost directory");
  const ignorePath = join(stateDirectory, ".gitignore");
  const ignore = inspectPrivateFile(ignorePath, ".selfhost ignore file", 128);
  if (ignore !== "*\n") fail(".selfhost ignore file is invalid");
  return projectRoot;
}

function inspectPrivateFile(path: string, label: string, maximumBytes = MAX_HANDOFF_BYTES): string {
  let stat;
  try { stat = lstatSync(path); } catch { fail(`${label} is missing or unreadable`); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path) {
    fail(`${label} must be one regular unlinked file`);
  }
  if (stat.size < 1 || stat.size > maximumBytes) fail(`${label} has an invalid size`);
  if (process.platform !== "win32" && (stat.uid !== process.getuid() || stat.gid !== process.getgid() || (stat.mode & 0o7777) !== 0o600)) {
    fail(`${label} must be owned and use mode 0600`);
  }
  return readFileSync(path, "utf8");
}

function ensurePrivateDirectory(path: string, label: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  inspectOwnedDirectory(path, label);
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

function handoffPaths(projectRoot: string, runId: string) {
  const stateDirectory = join(projectRoot, ".selfhost");
  const householdDirectory = join(stateDirectory, "household");
  const sessionsDirectory = join(householdDirectory, ".sessions");
  const sessionDirectory = join(sessionsDirectory, runId);
  const artifactsDirectory = join(sessionDirectory, "artifacts");
  return { householdDirectory, sessionsDirectory, sessionDirectory, artifactsDirectory, handoffPath: join(artifactsDirectory, "private-handoff.json") };
}

function atomicCreate(path: string, contents: string): void {
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.${randomBytes(12).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, path);
    unlinkSync(temporary);
    const directoryDescriptor = openSync(parent, "r");
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* Temporary may not exist. */ }
    throw error;
  }
}

function newSecret(used: Set<string>): string {
  let value = "";
  do { value = randomBytes(32).toString("base64url"); } while (used.has(value));
  used.add(value);
  return value;
}

export interface HouseholdServiceCredential {
  apiKey: string | null;
  databasePassword: string | null;
  email: string | null;
  password: string;
  provisioning: "pending" | "filled";
  username: string;
}
export interface HouseholdHandoff {
  declaredStatus: "not-verified";
  generatedAt: string;
  runId: string;
  schemaVersion: 1;
  services: Record<string, HouseholdServiceCredential>;
}

function validateHandoff(value: unknown, expectedRunId: string): HouseholdHandoff {
  if (!exactKeys(value, ["schemaVersion", "runId", "generatedAt", "declaredStatus", "services"])
    || value.schemaVersion !== 1 || value.runId !== expectedRunId || value.declaredStatus !== "not-verified"
    || typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))
    || !isRecord(value.services)) {
    fail("household handoff schema is invalid");
  }
  const selectedServices = validateServices(Object.keys(value.services));
  const secrets = new Set<string>();
  let selectedUsername = "";
  let selectedEmail = "";
  for (const service of selectedServices) {
    const credential = value.services[service];
    if (!exactKeys(credential, ["username", "email", "password", "databasePassword", "apiKey", "provisioning"])
      || typeof credential.username !== "string" || validateUsername(credential.username) !== credential.username
      || !(credential.email === null || (typeof credential.email === "string" && validateEmail(credential.email) === credential.email))
      || typeof credential.password !== "string" || credential.password.length < 32
      || !(credential.databasePassword === null || (typeof credential.databasePassword === "string" && credential.databasePassword.length >= 32))
      || !(credential.apiKey === null || (typeof credential.apiKey === "string" && /^[\x21-\x7e]{16,512}$/.test(credential.apiKey)))
      || !["pending", "filled"].includes(String(credential.provisioning))
      || ((credential.apiKey === null) !== (credential.provisioning === "pending"))
      || (EMAIL_SERVICES.has(service) !== (credential.email !== null))
      || (DATABASE_SERVICES.has(service) !== (credential.databasePassword !== null))) {
      fail("household handoff service schema is invalid");
    }
    if (selectedUsername === "") selectedUsername = credential.username;
    if (credential.username !== selectedUsername) fail("household handoff usernames do not match the selected username");
    if (credential.email !== null) {
      if (selectedEmail === "") selectedEmail = credential.email;
      if (credential.email !== selectedEmail) fail("household handoff emails do not match the selected email");
    }
    for (const secret of [credential.password, credential.databasePassword]) {
      if (secret === null) continue;
      if (secrets.has(secret)) fail("household handoff secrets must be unique");
      secrets.add(secret);
    }
  }
  return value as unknown as HouseholdHandoff;
}

export function createHouseholdCredentials(input: { projectRoot: string; runId: string; username: string; email?: string; services: string[] }) {
  const projectRoot = validateProjectRoot(input.projectRoot);
  const runId = validateRunId(input.runId);
  const username = validateUsername(input.username);
  const services = validateServices(input.services);
  const email = services.some((service) => EMAIL_SERVICES.has(service)) ? validateEmail(input.email ?? "") : "";
  const paths = handoffPaths(projectRoot, runId);
  ensurePrivateDirectory(paths.householdDirectory, "household directory");
  ensurePrivateDirectory(paths.sessionsDirectory, "household sessions directory");
  if (existsSync(paths.sessionDirectory)) fail("household credential run already exists");
  mkdirSync(paths.sessionDirectory, { mode: 0o700 });
  inspectOwnedDirectory(paths.sessionDirectory, "household session directory");
  ensurePrivateDirectory(paths.artifactsDirectory, "household artifacts directory");
  const used = new Set<string>();
  const credentials: Record<string, HouseholdServiceCredential> = {};
  for (const service of services) {
    credentials[service] = {
      username,
      email: EMAIL_SERVICES.has(service) ? email : null,
      password: newSecret(used),
      databasePassword: DATABASE_SERVICES.has(service) ? newSecret(used) : null,
      apiKey: null,
      provisioning: "pending",
    };
  }
  const handoff: HouseholdHandoff = { schemaVersion: 1, runId, generatedAt: new Date().toISOString(), declaredStatus: "not-verified", services: credentials };
  atomicCreate(paths.handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  loadHouseholdHandoff(projectRoot, runId);
  return Object.freeze({ status: "created", path: paths.handoffPath });
}

export function loadHouseholdHandoff(projectRootInput: string, runIdInput: string): HouseholdHandoff {
  const projectRoot = validateProjectRoot(projectRootInput);
  const runId = validateRunId(runIdInput);
  const paths = handoffPaths(projectRoot, runId);
  for (const [path, label] of [[paths.householdDirectory, "household directory"], [paths.sessionsDirectory, "household sessions directory"], [paths.sessionDirectory, "household session directory"], [paths.artifactsDirectory, "household artifacts directory"]]) {
    inspectOwnedDirectory(path, label);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(inspectPrivateFile(paths.handoffPath, "household private handoff")); }
  catch (error) { if (error instanceof SyntaxError) fail("household handoff JSON is invalid"); throw error; }
  return Object.freeze(validateHandoff(parsed, runId));
}

export function loadHouseholdCredential(projectRoot: string, runId: string, service: string): HouseholdServiceCredential {
  if (!HOUSEHOLD_SERVICES.includes(service)) fail("household service is invalid");
  const credential = loadHouseholdHandoff(projectRoot, runId).services[service];
  if (credential === undefined) fail("household service was not selected for this run");
  return Object.freeze(credential);
}

export function householdCredentialStatus(projectRoot: string, runId: string) {
  const handoff = loadHouseholdHandoff(projectRoot, runId);
  return Object.freeze({
    status: handoff.declaredStatus,
    path: handoffPaths(resolve(projectRoot), handoff.runId).handoffPath,
    services: Object.freeze(Object.keys(handoff.services).sort().map((id) => Object.freeze({ id, provisioning: handoff.services[id].provisioning }))),
  });
}

export function storeHouseholdApiKey(projectRootInput: string, runIdInput: string, service: string, apiKey: string) {
  if (!["audiobookshelf", "immich"].includes(service)) fail("service does not use a managed API key");
  if (!/^[\x21-\x7e]{16,512}$/.test(apiKey)) fail("captured API key is invalid");
  const projectRoot = validateProjectRoot(projectRootInput);
  const runId = validateRunId(runIdInput);
  const paths = handoffPaths(projectRoot, runId);
  const lockPath = join(paths.artifactsDirectory, ".private-handoff.lock");
  let lockDescriptor: number | undefined;
  let lockAcquired = false;
  try {
    lockDescriptor = openSync(lockPath, "wx", 0o600);
    lockAcquired = true;
    const handoff = loadHouseholdHandoff(projectRoot, runId);
    const credential = handoff.services[service];
    if (credential === undefined) fail("household service was not selected for this run");
    for (const selected of Object.values(handoff.services)) {
      if (selected.password === apiKey || selected.databasePassword === apiKey) fail("captured API key matches a managed password");
    }
    if (credential.apiKey !== null && credential.apiKey !== apiKey) fail("household API key is already captured");
    if (credential.apiKey === apiKey) return Object.freeze({ status: "existing", path: paths.handoffPath, service });
    const updated = structuredClone(handoff);
    updated.services[service].apiKey = apiKey;
    updated.services[service].provisioning = "filled";
    const temporary = join(paths.artifactsDirectory, `.private-handoff.${randomBytes(12).toString("hex")}.tmp`);
    let replacement: number | undefined;
    try {
      replacement = openSync(temporary, "wx", 0o600);
      writeFileSync(replacement, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
      fsyncSync(replacement);
      closeSync(replacement);
      replacement = undefined;
      renameSync(temporary, paths.handoffPath);
      const directoryDescriptor = openSync(paths.artifactsDirectory, "r");
      try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    } finally {
      if (replacement !== undefined) closeSync(replacement);
      try { unlinkSync(temporary); } catch { /* Replacement normally no longer exists. */ }
    }
    loadHouseholdHandoff(projectRoot, runId);
    return Object.freeze({ status: "filled", path: paths.handoffPath, service });
  } finally {
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    if (lockAcquired) {
      try { unlinkSync(lockPath); } catch { /* Acquired lock may already be absent after interruption. */ }
    }
  }
}

export function materializeHouseholdCredential(input: { projectRoot: string; runId: string; service: string; field: string; projectDirectory: string }) {
  const handoff = loadHouseholdHandoff(input.projectRoot, input.runId);
  if (!HOUSEHOLD_SERVICES.includes(input.service)) fail("household service is invalid");
  const serviceCredential = handoff.services[input.service];
  if (serviceCredential === undefined) fail("household service was not selected for this run");
  if (!['password', 'databasePassword'].includes(input.field)) fail("household credential field is invalid");
  if (input.field === "databasePassword" && !DATABASE_SERVICES.has(input.service)) fail("service has no managed database password");
  if (!isAbsolute(input.projectDirectory) || resolve(input.projectDirectory) !== input.projectDirectory) fail("Compose project directory must be absolute and normalized");
  inspectOwnedDirectory(input.projectDirectory, "Compose project directory");
  const secretDirectory = join(input.projectDirectory, "secrets");
  ensurePrivateDirectory(secretDirectory, "Compose secret directory");
  const suffix = SECRET_FILE_SUFFIX[input.field as keyof typeof SECRET_FILE_SUFFIX];
  const path = join(secretDirectory, `${input.service}-${suffix}`);
  const credential = serviceCredential[input.field as "password" | "databasePassword"];
  if (typeof credential !== "string") fail("household credential is unavailable");
  let status = "created";
  if (existsSync(path)) {
    const existing = inspectPrivateFile(path, "materialized household credential", 1024);
    if (existing !== credential) fail("materialized household credential does not match the managed value");
    status = "existing";
  } else {
    atomicCreate(path, credential);
    inspectPrivateFile(path, "materialized household credential", 1024);
  }
  return Object.freeze({ status, path, ref: `local/${input.runId}/${input.service}/${suffix}` });
}

function parseCli(args: string[]) {
  const command = args[0];
  if (!['create', 'status', 'materialize'].includes(command)) fail("household credential command is invalid");
  const flags: Record<string, string[]> = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) fail("household credential arguments are invalid");
    (flags[name.slice(2)] ??= []).push(value);
  }
  const one = (name: string, required = true) => {
    const values = flags[name] ?? [];
    if (values.length > 1 || (required && values.length !== 1)) fail(`--${name} is invalid`);
    return values[0] ?? "";
  };
  const allowed = command === "create" ? ["project-root", "run-id", "username", "email", "service"]
    : command === "materialize" ? ["project-root", "run-id", "service", "field", "project-directory"] : ["project-root", "run-id"];
  if (Object.keys(flags).some((name) => !allowed.includes(name))) fail("household credential option is invalid");
  return { command, flags, one };
}

function main(): void {
  const parsed = parseCli(Bun.argv.slice(2));
  let result;
  if (parsed.command === "create") {
    const email = parsed.one("email", false);
    result = createHouseholdCredentials({ projectRoot: parsed.one("project-root"), runId: parsed.one("run-id"), username: parsed.one("username"), email: email || undefined, services: parsed.flags.service ?? [] });
  } else if (parsed.command === "materialize") {
    result = materializeHouseholdCredential({ projectRoot: parsed.one("project-root"), runId: parsed.one("run-id"), service: parsed.one("service"), field: parsed.one("field"), projectDirectory: parsed.one("project-directory") });
    result = { status: result.status, path: result.path };
  } else {
    result = householdCredentialStatus(parsed.one("project-root"), parsed.one("run-id"));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// Bun rewrites import.meta.url to the bundle entry for imported modules. Keep
// this CLI entrypoint dormant when a different helper bundles this module.
if (typeof Bun !== "undefined" && Bun.argv[1] !== undefined
  && basename(Bun.argv[1]) === "household-credentials.ts"
  && import.meta.url === pathToFileURL(Bun.argv[1]).href) {
  try { main(); } catch { process.stderr.write("FAIL household credential operation\n"); process.exitCode = 1; }
}
