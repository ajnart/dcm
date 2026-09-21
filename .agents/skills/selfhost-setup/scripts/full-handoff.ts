#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadHouseholdHandoff } from "./household-credentials.ts";

const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MEDIA_SERVICES = ["homarr", "jellyfin", "prowlarr", "qbittorrent", "radarr", "seerr", "sonarr"];
const HOUSEHOLD_SERVICES = ["audiobookshelf", "immich", "navidrome", "nextcloud", "vaultwarden"];
const CHECKPOINT_STAGES = new Set(["selected", "planned", "applied", "verified"]);
const MAX_FILE_BYTES = 256 * 1024;
const STACK_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "stack.ts");

function fail(message: string): never { throw new Error(message); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: unknown, keys: string[]): boolean {
  if (!isRecord(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function inspectDirectory(path: string, label: string, privateMode = true): void {
  let stat;
  try { stat = lstatSync(path); } catch { fail(`${label} is missing or unreadable`); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) fail(`${label} must be one real directory`);
  if (process.platform !== "win32") {
    if (stat.uid !== process.getuid() || stat.gid !== process.getgid()) fail(`${label} has the wrong owner`);
    const mode = stat.mode & 0o7777;
    if (privateMode && mode !== 0o700) fail(`${label} must use mode 0700`);
    if (!privateMode && (mode & 0o002) !== 0) fail(`${label} must not be world-writable`);
  }
}
function inspectPrivateFile(path: string, label: string, maximumBytes = MAX_FILE_BYTES): string {
  let stat;
  try { stat = lstatSync(path); } catch (error) { throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size < 1 || stat.size > maximumBytes) fail(`${label} is unsafe`);
  if (process.platform !== "win32" && (stat.uid !== process.getuid() || stat.gid !== process.getgid() || (stat.mode & 0o7777) !== 0o600)) fail(`${label} must be owned and use mode 0600`);
  return readFileSync(path, "utf8");
}
function ensurePrivateDirectory(path: string, label: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  inspectDirectory(path, label);
  if (process.platform !== "win32") chmodSync(path, 0o700);
}
function validateProjectRoot(input: string): string {
  if (!isAbsolute(input) || resolve(input) !== input || input === sep || input === resolve(homedir())) fail("project root must be an absolute normalized project path");
  inspectDirectory(input, "project root", false);
  const state = join(input, ".selfhost");
  inspectDirectory(state, ".selfhost directory");
  if (inspectPrivateFile(join(state, ".gitignore"), ".selfhost ignore file", 128) !== "*\n") fail(".selfhost ignore file is invalid");
  return input;
}
function parseJson(raw: string, label: string): unknown {
  try { return JSON.parse(raw); } catch { fail(`${label} JSON is invalid`); }
}
function loadRecordedStack(projectRoot: string, runId: string) {
  const stackPath = join(projectRoot, ".selfhost", "stack.json");
  inspectPrivateFile(stackPath, "stack metadata");
  const result = spawnSync(process.execPath, [STACK_SCRIPT, "show", "--project-root", projectRoot, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: MAX_FILE_BYTES,
  });
  if (result.error || result.signal || result.status !== 0) fail("stack lifecycle owner rejected the recorded full run");
  const envelope = parseJson(result.stdout, "stack lifecycle result");
  if (!isRecord(envelope) || envelope.status !== "metadata-valid" || envelope.path !== stackPath || !isRecord(envelope.metadata)) fail("stack lifecycle result is invalid");
  const stack = envelope.metadata;
  if (!Array.isArray(stack.profiles) || !stack.profiles.includes("full") || !isRecord(stack.runtime)
    || stack.runtime.adapter !== "selfhost-media" || stack.runtime.runId !== runId
    || stack.runtime.statePath !== `.selfhost/media-harness/.sessions/${runId}`
    || !isRecord(stack.householdCredentials) || stack.householdCredentials.runId !== runId
    || stack.householdCredentials.path !== `.selfhost/household/.sessions/${runId}/artifacts/private-handoff.json`
    || !isRecord(stack.checkpoint) || typeof stack.checkpoint.stage !== "string" || !CHECKPOINT_STAGES.has(stack.checkpoint.stage) || !Array.isArray(stack.services)) {
    fail("recorded full-stack run metadata is invalid or mismatched");
  }
  const householdStages: Record<string, string> = {};
  for (const id of HOUSEHOLD_SERVICES) {
    const service = stack.services.find((candidate) => isRecord(candidate) && candidate.id === id);
    if (!isRecord(service)) fail("recorded full stack is missing a household service");
    householdStages[id] = isRecord(service.checkpoint) && typeof service.checkpoint.stage === "string" ? service.checkpoint.stage : "selected";
    if (!CHECKPOINT_STAGES.has(householdStages[id])) fail("recorded household checkpoint is invalid");
  }
  return { checkpoint: stack.checkpoint.stage, householdStages, mediaRoot: join(projectRoot, String(stack.runtime.statePath)) };
}
function validateMediaHandoff(value: unknown, runId: string): Record<string, unknown> {
  if (!exactKeys(value, ["runId", "warning", "acceptance", "actions", "locations", "access", "homarrNotebook", "mcp", "services"])
    || value.runId !== runId || typeof value.warning !== "string" || typeof value.acceptance !== "string"
    || !Array.isArray(value.actions) || value.actions.some((action) => typeof action !== "string")
    || !isRecord(value.locations) || !isRecord(value.access) || typeof value.homarrNotebook !== "string" || !isRecord(value.mcp) || !isRecord(value.services)
    || JSON.stringify(Object.keys(value.services).sort()) !== JSON.stringify([...MEDIA_SERVICES].sort())) fail("media private handoff schema is invalid");
  for (const id of MEDIA_SERVICES) {
    const service = value.services[id];
    if (!exactKeys(service, ["url", "localUrl", "userUrl", "internalUrl", "configPath", "username", "password", "apiKey"])
      || typeof service.url !== "string" || typeof service.localUrl !== "string" || !(service.userUrl === null || typeof service.userUrl === "string")
      || typeof service.internalUrl !== "string" || typeof service.configPath !== "string" || typeof service.username !== "string"
      || typeof service.password !== "string" || !(service.apiKey === null || typeof service.apiKey === "string")) fail("media private handoff service schema is invalid");
  }
  return value as Record<string, unknown>;
}
function loadMediaHandoff(mediaRoot: string, runId: string): Record<string, unknown> | null {
  const artifactDirectory = join(mediaRoot, "artifacts");
  const handoffPath = join(artifactDirectory, "private-handoff.json");
  if (!existsSync(handoffPath)) return null;
  inspectDirectory(mediaRoot, "recorded media runtime directory");
  inspectDirectory(artifactDirectory, "recorded media artifact directory");
  return validateMediaHandoff(parseJson(inspectPrivateFile(handoffPath, "media private handoff"), "media private handoff"), runId);
}
function artifactPaths(projectRoot: string, runId: string) {
  const full = join(projectRoot, ".selfhost", "full");
  const sessions = join(full, ".sessions");
  const session = join(sessions, runId);
  const artifacts = join(session, "artifacts");
  return { full, sessions, session, artifacts, privatePath: join(artifacts, "private-handoff.json"), reportPath: join(artifacts, "handoff-report.md") };
}
function atomicReplace(path: string, contents: string): void {
  const parent = dirname(path);
  if (existsSync(path)) inspectPrivateFile(path, `existing ${basename(path)}`);
  const temporary = join(parent, `.${basename(path)}.${randomBytes(12).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    inspectPrivateFile(temporary, "full handoff replacement");
    renameSync(temporary, path);
    inspectPrivateFile(path, `written ${basename(path)}`);
    const directoryDescriptor = openSync(parent, "r");
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* Replacement normally no longer exists. */ }
  }
}

export function exportFullHandoff(projectRootInput: string, runId: string) {
  if (!RUN_ID.test(runId)) fail("run ID is invalid");
  const projectRoot = validateProjectRoot(projectRootInput);
  const recorded = loadRecordedStack(projectRoot, runId);
  const household = loadHouseholdHandoff(projectRoot, runId);
  if (JSON.stringify(Object.keys(household.services).sort()) !== JSON.stringify([...HOUSEHOLD_SERVICES].sort())) fail("household handoff does not contain the full service selection");
  const media = loadMediaHandoff(recorded.mediaRoot, runId);
  const paths = artifactPaths(projectRoot, runId);
  ensurePrivateDirectory(paths.full, "full handoff directory");
  ensurePrivateDirectory(paths.sessions, "full handoff sessions directory");
  ensurePrivateDirectory(paths.session, "full handoff session directory");
  ensurePrivateDirectory(paths.artifacts, "full handoff artifacts directory");
  const householdServices: Record<string, unknown> = {};
  const missing: string[] = [];
  if (media === null) missing.push("media-private-handoff");
  for (const id of HOUSEHOLD_SERVICES) {
    const credential = household.services[id];
    const stage = recorded.householdStages[id];
    if (stage !== "verified") missing.push(`${id}-onboarding-or-acceptance`);
    householdServices[id] = {
      ...credential,
      checkpoint: stage,
      urls: { status: "pending-recorded-access", user: null, internal: null },
      storage: { status: "pending-recorded-paths", paths: [] },
      actions: ["Generated the selected service credential bundle", credential.apiKey === null ? "API key remains pending when applicable" : "Filled the captured API key into the private credential bundle"],
    };
    missing.push(`${id}-access-metadata`, `${id}-storage-metadata`);
  }
  const status = "partial";
  const payload = {
    schemaVersion: 1,
    kind: "full-private-handoff",
    runId,
    generatedAt: new Date().toISOString(),
    warning: "PRIVATE: contains passwords and API keys; keep mode 0600",
    declaredStatus: "not-verified",
    exportStatus: status,
    checkpoint: { full: recorded.checkpoint, household: recorded.householdStages },
    missing,
    media,
    household: { declaredStatus: household.declaredStatus, generatedAt: household.generatedAt, services: householdServices },
    locations: {
      fullArtifact: paths.privatePath,
      redactedReport: paths.reportPath,
      mediaRuntime: recorded.mediaRoot,
      householdArtifact: join(projectRoot, `.selfhost/household/.sessions/${runId}/artifacts/private-handoff.json`),
    },
    actions: ["Combined the already-exported media handoff when present", "Loaded the bound household credential bundle through its owning validator", "Recorded missing URLs, storage paths, onboarding, and acceptance as pending"],
  };
  const report = [
    "# Full private handoff report",
    "",
    "Setup is not finished.",
    "Generated household passwords have been saved, but that does not mean the application accounts were created.",
    "The private handoff file contains administrator credentials. Keep it owner-only.",
    "",
    `Run: \`${runId}\``,
    `Export status: \`${status}\``,
    "Declared acceptance: `not-verified`",
    `Private artifact: \`${paths.privatePath}\``,
    `Media handoff: \`${media === null ? "missing" : "included"}\``,
    `Household credential services: \`${Object.keys(household.services).sort().join(", ")}\``,
    `Missing checkpoints: \`${missing.length === 0 ? "none recorded" : missing.join(", ")}\``,
    "Credential values, URLs, and storage details are omitted from this report.",
    "",
  ].join("\n");
  atomicReplace(paths.privatePath, `${JSON.stringify(payload, null, 2)}\n`);
  atomicReplace(paths.reportPath, report);
  return Object.freeze({ status, privatePath: paths.privatePath, reportPath: paths.reportPath });
}

function parse(args: string[]) {
  const flags: Record<string, string[]> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]; const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) fail("full handoff arguments are invalid");
    (flags[name.slice(2)] ??= []).push(value);
  }
  if (Object.keys(flags).some((name) => !["project-root", "run-id"].includes(name))) fail("full handoff option is invalid");
  const one = (name: string) => { const values = flags[name] ?? []; if (values.length !== 1) fail(`--${name} is invalid`); return values[0]; };
  return { projectRoot: one("project-root"), runId: one("run-id") };
}
function main() {
  const input = parse(Bun.argv.slice(2));
  const result = exportFullHandoff(input.projectRoot, input.runId);
  process.stdout.write(`Private full handoff: ${result.privatePath}\nRedacted full handoff report: ${result.reportPath}\n`);
}
if (Bun.argv[1] !== undefined && import.meta.url === pathToFileURL(Bun.argv[1]).href) {
  try { main(); } catch { process.stderr.write("FAIL full private handoff export\n"); process.exitCode = 1; }
}
