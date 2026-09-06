#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_ROOT = resolve(SKILL_ROOT, "..");
const PROFILE_PATH = join(SKILL_ROOT, "references", "install-profiles.json");
const STACK_FILE = "stack.json";
const LOCK_FILE = ".stack.lock";
const RECOVERY_LOCK_FILE = ".stack.recovery.lock";
const STAGES = ["selected", "planned", "applied", "verified"];
const PROFILE_KINDS = new Set(["base", "pack", "extension"]);
const AGENTS = new Set(["codex", "claude-code"]);
const SCOPES = new Set(["project", "global"]);
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const SKILL_ID = /^selfhost(?:-[a-z0-9]+)*$/;
const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const EVIDENCE_ID = /^(?:inspection|plan|approval|apply|manifest|verify):[a-z0-9][a-z0-9._-]{0,47}$/;
const SECRET_LIKE = /(?:password|passwd|secret|token|credential|api[-_]?key|private[-_]?key|cookie|session)/i;

const MEDIA_SERVICES = [
  ["homarr", "selfhost-homarr"],
  ["jellyfin", "selfhost-media"],
  ["prowlarr", "selfhost-media"],
  ["qbittorrent", "selfhost-media"],
  ["radarr", "selfhost-media"],
  ["seerr", "selfhost-media"],
  ["sonarr", "selfhost-media"],
];

type FlagMap = Record<string, string[]>;

interface ParsedArguments {
  flags: FlagMap;
  json: boolean;
  positional: string[];
  verifyBrowser: boolean;
}

function usage(): string {
  return `Selfhost stack lifecycle

Profiles:
  profiles [--json]
  prerequisites --profile ID [--profile ID] --agent codex|claude-code --scope project|global [--project-root ABSOLUTE] [--verify-browser] [--json]

Metadata:
  init --project-root ABSOLUTE --profile ID [--profile ID] [--adapter ID --run-id ID] [--service ID=OWNER] [--consume PROFILE=SERVICE] [--json]
  show --project-root ABSOLUTE [--json]
  validate --project-root ABSOLUTE [--json]
  resume --project-root ABSOLUTE [--json]
  extend --project-root ABSOLUTE --profile ID [--profile ID] [--adapter ID --run-id ID] [--service ID=OWNER] [--consume PROFILE=SERVICE] [--json]
  checkpoint --project-root ABSOLUTE --stage planned|applied|verified [--evidence TYPE:ID] [--json]`;
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, expected: string[]): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(wanted);
}

function parseArguments(input: string[]): ParsedArguments {
  const flags: FlagMap = {
    adapter: [],
    agent: [],
    consume: [],
    evidence: [],
    profile: [],
    "project-root": [],
    "run-id": [],
    scope: [],
    service: [],
    stage: [],
  };
  const valued = new Set(Object.keys(flags).map((name) => `--${name}`));
  const positional: string[] = [];
  let json = false;
  let verifyBrowser = false;

  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === "--json") {
      json = true;
      continue;
    }
    if (value === "--verify-browser") {
      if (verifyBrowser) {
        fail("--verify-browser accepts no value and may appear once");
      }
      verifyBrowser = true;
      continue;
    }
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    if (!valued.has(value)) {
      fail(`Unknown option ${value}`);
    }
    index += 1;
    if (index >= input.length) {
      fail(`Option ${value} requires a value`);
    }
    flags[value.slice(2)].push(input[index]);
  }
  return { flags, json, positional, verifyBrowser };
}

function oneFlag(parsed: ParsedArguments, name: string, required = false): string | null {
  const values = parsed.flags[name];
  if (values.length > 1) {
    fail(`--${name} accepts one value`);
  }
  if (values.length === 0) {
    if (required) {
      fail(`--${name} is required`);
    }
    return null;
  }
  return values[0];
}

function rejectFlagsExcept(parsed: ParsedArguments, allowed: string[], allowBrowserVerification = false) {
  const accepted = new Set(allowed);
  for (const [name, values] of Object.entries(parsed.flags)) {
    if (values.length > 0 && !accepted.has(name)) {
      fail(`--${name} is not valid for this command`);
    }
  }
  if (parsed.verifyBrowser && !allowBrowserVerification) {
    fail("--verify-browser is not valid for this command");
  }
}

async function loadProfiles(): Promise<Record<string, unknown>> {
  let document: unknown;
  try {
    document = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
  } catch {
    fail("Install profile manifest is unreadable");
  }
  if (!exactKeys(document, ["schemaVersion", "source", "browser", "profiles"])) {
    fail("Install profile manifest has unsupported fields");
  }
  if (document.schemaVersion !== 1 || document.source !== "ajnart/selfhost-skills") {
    fail("Install profile manifest identity is invalid");
  }
  if (!exactKeys(document.browser, ["package", "skill", "source"])) {
    fail("Browser prerequisite profile is invalid");
  }
  if (
    document.browser.package !== "agent-browser"
    || document.browser.skill !== "agent-browser"
    || document.browser.source !== "vercel-labs/agent-browser"
  ) {
    fail("Browser prerequisite identity is invalid");
  }
  if (!Array.isArray(document.profiles) || document.profiles.length === 0) {
    fail("Install profiles are missing");
  }

  const ids = new Set<string>();
  let previousOptionalId = "";
  for (const profile of document.profiles) {
    if (!exactKeys(profile, [
      "approvalEvidence",
      "description",
      "extends",
      "id",
      "kind",
      "label",
      "serviceConsumption",
      "skills",
      "verificationEvidence",
    ])) {
      fail("Install profile contains unsupported fields");
    }
    if (typeof profile.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(profile.id)) {
      fail("Install profile ID is invalid");
    }
    if (ids.has(profile.id)) {
      fail("Install profile ID is duplicated");
    }
    if (profile.id === "basic" && ids.size !== 0) {
      fail("Basic install profile must be first");
    }
    if (profile.id !== "basic") {
      if (previousOptionalId && profile.id <= previousOptionalId) {
        fail("Optional install profile IDs must be sorted");
      }
      previousOptionalId = profile.id;
    }
    ids.add(profile.id);
    if (!PROFILE_KINDS.has(String(profile.kind))) {
      fail(`Install profile ${profile.id} kind is invalid`);
    }
    if (
      typeof profile.label !== "string"
      || profile.label.trim() === ""
      || typeof profile.description !== "string"
      || profile.description.trim() === ""
    ) {
      fail(`Install profile ${profile.id} text is invalid`);
    }
    if (
      !Array.isArray(profile.extends)
      || !Array.isArray(profile.approvalEvidence)
      || !Array.isArray(profile.skills)
      || !Array.isArray(profile.verificationEvidence)
      || profile.skills.length === 0
      || !["none", "explicit"].includes(String(profile.serviceConsumption))
    ) {
      fail(`Install profile ${profile.id} dependencies are invalid`);
    }
    for (const dependency of profile.extends) {
      if (typeof dependency !== "string") {
        fail(`Install profile ${profile.id} dependency is invalid`);
      }
    }
    for (const skill of profile.skills) {
      if (typeof skill !== "string" || !SKILL_ID.test(skill)) {
        fail(`Install profile ${profile.id} skill is invalid`);
      }
    }
    for (const evidence of profile.approvalEvidence) {
      if (typeof evidence !== "string" || !EVIDENCE_ID.test(evidence) || !evidence.startsWith("approval:")) {
        fail(`Install profile ${profile.id} approval evidence is invalid`);
      }
    }
    for (const evidence of profile.verificationEvidence) {
      if (typeof evidence !== "string" || !EVIDENCE_ID.test(evidence) || !evidence.startsWith("verify:")) {
        fail(`Install profile ${profile.id} verification evidence is invalid`);
      }
    }
    if (
      new Set(profile.extends).size !== profile.extends.length
      || new Set(profile.approvalEvidence).size !== profile.approvalEvidence.length
      || new Set(profile.skills).size !== profile.skills.length
      || new Set(profile.verificationEvidence).size !== profile.verificationEvidence.length
      || JSON.stringify(profile.extends) !== JSON.stringify([...profile.extends].sort())
      || JSON.stringify(profile.approvalEvidence) !== JSON.stringify([...profile.approvalEvidence].sort())
      || JSON.stringify(profile.skills) !== JSON.stringify([...profile.skills].sort())
      || JSON.stringify(profile.verificationEvidence) !== JSON.stringify([...profile.verificationEvidence].sort())
    ) {
      fail(`Install profile ${profile.id} dependencies must be unique and sorted`);
    }
    let expectedExtends = ["basic"];
    if (profile.id === "basic") {
      expectedExtends = [];
    }
    if (JSON.stringify(profile.extends) !== JSON.stringify(expectedExtends)) {
      fail(`Install profile ${profile.id} must use the exact basic dependency`);
    }
    if (profile.id === "basic" && profile.kind !== "base") {
      fail("Basic install profile must use kind base");
    }
    if (profile.id !== "basic" && profile.kind === "base") {
      fail(`Optional install profile ${profile.id} cannot use kind base`);
    }
  }
  if (!ids.has("basic")) {
    fail("Basic install profile is missing");
  }
  for (const profile of document.profiles) {
    for (const dependency of profile.extends) {
      if (!ids.has(dependency) || dependency === profile.id) {
        fail(`Install profile ${profile.id} dependency is invalid`);
      }
    }
  }
  return document;
}

function resolveProfiles(document: Record<string, unknown>, requested: string[]) {
  if (requested.length === 0) {
    fail("At least one --profile is required");
  }
  const profiles = document.profiles as Array<Record<string, unknown>>;
  const byId = new Map(profiles.map((profile) => [String(profile.id), profile]));
  const resolvedProfiles: string[] = [];
  const resolvedSkills = new Set<string>();
  const active = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string) => {
    const profile = byId.get(id);
    if (!profile) {
      fail(`Unknown install profile ${id}`);
    }
    if (active.has(id)) {
      fail("Install profile dependency cycle detected");
    }
    if (visited.has(id)) {
      return;
    }
    active.add(id);
    for (const dependency of profile.extends as string[]) {
      visit(dependency);
    }
    active.delete(id);
    visited.add(id);
    resolvedProfiles.push(id);
    for (const skill of profile.skills as string[]) {
      resolvedSkills.add(skill);
    }
  };

  for (const id of requested) {
    visit(id);
  }
  return {
    profiles: resolvedProfiles,
    skills: [...resolvedSkills].sort(),
  };
}

function profileObligations(document: Record<string, unknown>, profiles: string[]) {
  const records = document.profiles as Array<Record<string, unknown>>;
  const byId = new Map(records.map((profile) => [String(profile.id), profile]));
  const approvalEvidence = new Set<string>();
  const verificationEvidence = new Set<string>();
  const serviceConsumerProfiles: string[] = [];
  for (const id of profiles) {
    const profile = byId.get(id);
    if (!profile) {
      fail(`Unknown install profile ${id}`);
    }
    if (profile.serviceConsumption === "explicit") {
      serviceConsumerProfiles.push(id);
    }
    for (const evidence of profile.approvalEvidence as string[]) {
      approvalEvidence.add(evidence);
    }
    for (const evidence of profile.verificationEvidence as string[]) {
      verificationEvidence.add(evidence);
    }
  }
  return {
    approvalEvidence: [...approvalEvidence].sort(),
    serviceConsumerProfiles: serviceConsumerProfiles.sort(),
    verificationEvidence: [...verificationEvidence].sort(),
  };
}

async function installedSkill(skillsRoot: string, skill: string): Promise<boolean> {
  const path = join(skillsRoot, skill, "SKILL.md");
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return false;
    }
    return false;
  }
}

function quoted(value: string): string {
  if (/^[a-zA-Z0-9_./@*:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function installCommand(source: string, skills: string[], agent: string, scope: string): string {
  const parts = ["bunx", "--bun", "skills@latest", "add", source];
  for (const skill of skills) {
    parts.push("--skill", skill);
  }
  parts.push("--agent", agent);
  if (scope === "global") {
    parts.push("--global");
  }
  parts.push("--copy", "--yes");
  return parts.map(quoted).join(" ");
}

async function prerequisiteTarget(agent: string, scope: string, projectRoot: string | null) {
  if (scope === "project") {
    if (projectRoot === null) {
      fail("--project-root is required for project-scoped prerequisites");
    }
    const safeRoot = await validateProjectRoot(projectRoot);
    let clientDirectory = ".agents";
    if (agent === "claude-code") {
      clientDirectory = ".claude";
    }
    return {
      skillsRoot: join(safeRoot, clientDirectory, "skills"),
      workingDirectory: safeRoot,
    };
  }
  if (projectRoot !== null) {
    fail("--project-root is only valid for project-scoped prerequisites");
  }
  if (agent === "codex") {
    return {
      skillsRoot: join(homedir(), ".agents", "skills"),
      workingDirectory: null,
    };
  }
  let claudeRoot = join(homedir(), ".claude");
  const configuredRoot = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configuredRoot) {
    if (!isAbsolute(configuredRoot) || resolve(configuredRoot) !== configuredRoot) {
      fail("CLAUDE_CONFIG_DIR must be an absolute normalized path");
    }
    claudeRoot = configuredRoot;
  }
  return {
    skillsRoot: join(claudeRoot, "skills"),
    workingDirectory: null,
  };
}

function browserRuntimeStatus(verifyBrowser: boolean) {
  const executable = Bun.which("agent-browser");
  if (!executable) {
    return { available: false, verified: false, ready: false };
  }
  if (!verifyBrowser) {
    return { available: true, verified: false, ready: false };
  }
  const doctor = spawnSync(executable, ["doctor", "--offline", "--quick", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 10_000,
  });
  return {
    available: true,
    verified: true,
    ready: !doctor.error && doctor.status === 0,
  };
}

async function prerequisites(parsed: ParsedArguments, profileDocument: Record<string, unknown>) {
  const agent = oneFlag(parsed, "agent", true) as string;
  const scope = oneFlag(parsed, "scope", true) as string;
  const projectRoot = oneFlag(parsed, "project-root");
  if (!AGENTS.has(agent)) {
    fail("--agent must be codex or claude-code");
  }
  if (!SCOPES.has(scope)) {
    fail("--scope must be project or global");
  }
  const target = await prerequisiteTarget(agent, scope, projectRoot);
  const resolved = resolveProfiles(profileDocument, parsed.flags.profile);
  const missingSkills: string[] = [];
  for (const skill of resolved.skills) {
    if (!(await installedSkill(target.skillsRoot, skill))) {
      missingSkills.push(skill);
    }
  }
  const browser = profileDocument.browser as Record<string, string>;
  const browserSkillInstalled = await installedSkill(target.skillsRoot, browser.skill);
  const runtime = browserRuntimeStatus(parsed.verifyBrowser);
  const installCommands: Array<{ reason: string; command: string; workingDirectory: string | null }> = [];
  if (missingSkills.length > 0) {
    installCommands.push({
      reason: "selected-profile-skills",
      command: installCommand(String(profileDocument.source), missingSkills, agent, scope),
      workingDirectory: target.workingDirectory,
    });
  }
  if (!browserSkillInstalled) {
    installCommands.push({
      reason: "agent-browser-skill",
      command: installCommand(browser.source, [browser.skill], agent, scope),
      workingDirectory: target.workingDirectory,
    });
  }
  if (!runtime.available) {
    installCommands.push({
      reason: "agent-browser-runtime",
      command: `bun add --global ${quoted(browser.package)}`,
      workingDirectory: null,
    });
  }
  if (!runtime.ready) {
    installCommands.push({
      reason: "agent-browser-browser",
      command: "agent-browser install",
      workingDirectory: null,
    });
  }
  const ready = missingSkills.length === 0 && browserSkillInstalled && runtime.ready;
  let next = "Load agent-browser skills get core, then continue setup.";
  if (!ready && parsed.verifyBrowser) {
    next = "Run the listed commands through the normal approval boundary, then repeat with --verify-browser.";
  }
  if (!ready && !parsed.verifyBrowser) {
    next = "Approve and run the listed commands, then repeat with --verify-browser; that verified pass may clean stale agent-browser daemon sidecars.";
  }
  return {
    status: ready ? "ready" : "missing-prerequisites",
    ready,
    requestedProfiles: parsed.flags.profile,
    resolvedProfiles: resolved.profiles,
    resolvedSkills: resolved.skills,
    targetSkillsRoot: target.skillsRoot,
    missingSkills,
    browser: {
      skillInstalled: browserSkillInstalled,
      runtimeAvailable: runtime.available,
      browserVerified: runtime.verified,
      browserReady: runtime.ready,
    },
    installCommands,
    next,
  };
}

async function validateProjectRoot(projectRoot: string): Promise<string> {
  if (!isAbsolute(projectRoot) || resolve(projectRoot) !== projectRoot) {
    fail("Project root must be an absolute normalized path");
  }
  if (projectRoot === sep || projectRoot === resolve(homedir())) {
    fail("Project root cannot be the filesystem root or user home");
  }
  let info;
  try {
    info = await lstat(projectRoot);
  } catch {
    fail("Project root must already exist");
  }
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(projectRoot) !== projectRoot) {
    fail("Project root must be one real directory without symlink traversal");
  }
  if (process.platform !== "win32") {
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      fail("Project root must be owned by the current user and group");
    }
    if ((info.mode & 0o0002) !== 0) {
      fail("Project root must not be world-writable");
    }
  }
  return projectRoot;
}

async function ensureStateDirectory(projectRoot: string): Promise<string> {
  const stateDirectory = join(projectRoot, ".selfhost");
  let info;
  try {
    info = await lstat(stateDirectory);
  } catch (error) {
    if (!isRecord(error) || error.code !== "ENOENT") {
      fail("Unable to inspect .selfhost directory");
    }
    await mkdir(stateDirectory, { mode: 0o700 });
    info = await lstat(stateDirectory);
  }
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(stateDirectory) !== stateDirectory) {
    fail(".selfhost must be one real private directory");
  }
  if (process.platform !== "win32") {
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      fail(".selfhost has the wrong owner");
    }
    await chmod(stateDirectory, 0o700);
  }

  const ignorePath = join(stateDirectory, ".gitignore");
  try {
    const ignoreInfo = await lstat(ignorePath);
    if (!ignoreInfo.isFile() || ignoreInfo.isSymbolicLink() || ignoreInfo.nlink !== 1) {
      fail(".selfhost/.gitignore must be one regular unlinked file");
    }
    const ignore = await readFile(ignorePath, "utf8");
    if (ignore !== "*\n") {
      fail(".selfhost/.gitignore must contain only the wildcard rule");
    }
    if (process.platform !== "win32") {
      if (ignoreInfo.uid !== process.getuid() || ignoreInfo.gid !== process.getgid()) {
        fail(".selfhost/.gitignore has the wrong owner");
      }
      await chmod(ignorePath, 0o600);
    }
  } catch (error) {
    if (!isRecord(error) || error.code !== "ENOENT") {
      throw error;
    }
    const handle = await open(ignorePath, "wx", 0o600);
    try {
      await handle.writeFile("*\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return stateDirectory;
}

async function inspectStateDirectory(projectRoot: string): Promise<string> {
  const stateDirectory = join(projectRoot, ".selfhost");
  let info;
  try {
    info = await lstat(stateDirectory);
  } catch {
    fail(".selfhost directory is missing or unreadable");
  }
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(stateDirectory) !== stateDirectory) {
    fail(".selfhost must be one real private directory");
  }
  if (process.platform !== "win32") {
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      fail(".selfhost has the wrong owner");
    }
    if ((info.mode & 0o7777) !== 0o700) {
      fail(".selfhost must use mode 0700");
    }
  }
  const ignorePath = join(stateDirectory, ".gitignore");
  let ignoreInfo;
  try {
    ignoreInfo = await lstat(ignorePath);
  } catch {
    fail(".selfhost/.gitignore is missing or unreadable");
  }
  if (!ignoreInfo.isFile() || ignoreInfo.isSymbolicLink() || ignoreInfo.nlink !== 1) {
    fail(".selfhost/.gitignore must be one regular unlinked file");
  }
  if (process.platform !== "win32") {
    if (ignoreInfo.uid !== process.getuid() || ignoreInfo.gid !== process.getgid()) {
      fail(".selfhost/.gitignore has the wrong owner");
    }
    if ((ignoreInfo.mode & 0o7777) !== 0o600) {
      fail(".selfhost/.gitignore must use mode 0600");
    }
  }
  if (await readFile(ignorePath, "utf8") !== "*\n") {
    fail(".selfhost/.gitignore must contain only the wildcard rule");
  }
  return stateDirectory;
}

async function inspectPrivateFile(path: string, optional = false) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (optional && isRecord(error) && error.code === "ENOENT") {
      return null;
    }
    fail(`${STACK_FILE} is missing or unreadable`);
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    fail(`${STACK_FILE} must be one regular unlinked file`);
  }
  if (info.size > 128 * 1024) {
    fail(`${STACK_FILE} is unexpectedly large`);
  }
  if (process.platform !== "win32") {
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      fail(`${STACK_FILE} has the wrong owner`);
    }
    if ((info.mode & 0o7777) !== 0o600) {
      fail(`${STACK_FILE} must use mode 0600`);
    }
  }
  return info;
}

function validDateTime(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateEvidence(evidenceIds: unknown): string[] {
  if (!Array.isArray(evidenceIds) || evidenceIds.length > 32) {
    fail("Stack evidence IDs are invalid");
  }
  const unique = new Set<string>();
  for (const evidence of evidenceIds) {
    if (typeof evidence !== "string" || !EVIDENCE_ID.test(evidence) || SECRET_LIKE.test(evidence)) {
      fail("Stack evidence ID is invalid or secret-like");
    }
    unique.add(evidence);
  }
  if (unique.size !== evidenceIds.length) {
    fail("Stack evidence IDs must be unique");
  }
  return evidenceIds;
}

function sameStrings(left: unknown, right: string[]): boolean {
  return Array.isArray(left) && JSON.stringify(left) === JSON.stringify(right);
}

function validateMetadata(document: unknown, profileDocument: Record<string, unknown>) {
  if (!exactKeys(document, ["checkpoint", "connections", "createdAt", "profiles", "revision", "runtime", "schemaVersion", "serviceBindings", "services", "skills", "updatedAt"])) {
    fail("Stack metadata contains missing or unsupported fields");
  }
  if (document.schemaVersion !== 1 || !Number.isInteger(document.revision) || Number(document.revision) < 1) {
    fail("Stack metadata version is invalid");
  }
  if (!validDateTime(document.createdAt) || !validDateTime(document.updatedAt)) {
    fail("Stack metadata timestamps are invalid");
  }
  if (Date.parse(document.updatedAt) < Date.parse(document.createdAt)) {
    fail("Stack metadata timestamp order is invalid");
  }
  if (!Array.isArray(document.profiles) || document.profiles.length === 0 || new Set(document.profiles).size !== document.profiles.length) {
    fail("Stack metadata profiles are invalid");
  }
  for (const profile of document.profiles) {
    if (typeof profile !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(profile)) {
      fail("Stack metadata contains an invalid profile");
    }
  }
  if (!Array.isArray(document.skills) || document.skills.length === 0 || new Set(document.skills).size !== document.skills.length) {
    fail("Stack metadata skills are invalid");
  }
  for (const skill of document.skills) {
    if (typeof skill !== "string" || !SKILL_ID.test(skill)) {
      fail("Stack metadata contains an invalid skill");
    }
  }
  const resolved = resolveProfiles(profileDocument, document.profiles as string[]);
  if (!sameStrings(document.profiles, resolved.profiles)) {
    fail("Stack metadata profiles do not match the install profile closure");
  }
  if (!sameStrings(document.skills, resolved.skills)) {
    fail("Stack metadata skills do not match the install profile closure");
  }
  const obligations = profileObligations(profileDocument, resolved.profiles);
  if (document.runtime !== null) {
    if (!exactKeys(document.runtime, ["adapter", "runId", "statePath"])) {
      fail("Stack runtime metadata is invalid");
    }
    if (
      document.runtime.adapter !== "selfhost-media"
      || !document.skills.includes(document.runtime.adapter)
      || typeof document.runtime.runId !== "string"
      || !RUN_ID.test(document.runtime.runId)
      || typeof document.runtime.statePath !== "string"
      || document.runtime.statePath !== `.selfhost/media-harness/.sessions/${document.runtime.runId}`
    ) {
      fail("Stack runtime pointer is invalid");
    }
  }
  const mediaSelected = document.profiles.includes("media");
  if (mediaSelected !== (document.runtime !== null)) {
    fail("Media profile and runtime metadata must be recorded together");
  }
  if (!Array.isArray(document.services)) {
    fail("Stack services are invalid");
  }
  const serviceIds = new Set<string>();
  for (const service of document.services) {
    if (!exactKeys(service, ["id", "ownerSkill"])) {
      fail("Stack service record is invalid");
    }
    if (
      typeof service.id !== "string"
      || !IDENTIFIER.test(service.id)
      || serviceIds.has(service.id)
      || typeof service.ownerSkill !== "string"
      || !document.skills.includes(service.ownerSkill)
    ) {
      fail("Stack service record is invalid");
    }
    serviceIds.add(service.id);
  }
  validateServiceBindings(
    document.serviceBindings,
    obligations.serviceConsumerProfiles,
    serviceIds,
  );
  if (document.connections !== null) {
    if (!exactKeys(document.connections, ["contains", "initialPasswordStored", "path"])) {
      fail("Stack connection metadata is invalid");
    }
    if (
      document.runtime === null
      || document.connections.path !== `${document.runtime.statePath}/connections.env`
      || JSON.stringify(document.connections.contains) !== JSON.stringify(["api-keys", "urls", "usernames"])
      || document.connections.initialPasswordStored !== false
    ) {
      fail("Stack connection pointer is invalid");
    }
  }
  if ((document.runtime === null) !== (document.connections === null)) {
    fail("Stack runtime and connection metadata must be recorded together");
  }
  if (mediaSelected) {
    for (const [id, ownerSkill] of MEDIA_SERVICES) {
      const service = document.services.find((candidate) => candidate.id === id);
      if (!service || service.ownerSkill !== ownerSkill) {
        fail("Media stack metadata is missing a required owned service");
      }
    }
  }
  if (!exactKeys(document.checkpoint, ["evidenceIds", "recordedAt", "stage"])) {
    fail("Stack checkpoint is invalid");
  }
  if (
    !STAGES.includes(String(document.checkpoint.stage))
    || !validDateTime(document.checkpoint.recordedAt)
    || document.checkpoint.recordedAt !== document.updatedAt
  ) {
    fail("Stack checkpoint is invalid");
  }
  const evidence = validateEvidence(document.checkpoint.evidenceIds);
  const rank = STAGES.indexOf(String(document.checkpoint.stage));
  if (rank === STAGES.indexOf("selected") && evidence.length !== 0) {
    fail("Selected stack metadata cannot contain checkpoint evidence");
  }
  if (rank >= STAGES.indexOf("planned") && !evidence.some((id) => id.startsWith("plan:"))) {
    fail("Planned stack metadata requires plan evidence");
  }
  if (rank >= STAGES.indexOf("applied") && !evidence.some((id) => id.startsWith("apply:") || id.startsWith("manifest:"))) {
    fail("Applied stack metadata requires apply or manifest evidence");
  }
  if (
    rank >= STAGES.indexOf("applied")
    && obligations.approvalEvidence.some((id) => !evidence.includes(id))
  ) {
    fail("Applied stack metadata is missing selected-profile approval evidence");
  }
  if (
    rank >= STAGES.indexOf("verified")
    && obligations.verificationEvidence.some((id) => !evidence.includes(id))
  ) {
    fail("Verified stack metadata is missing selected-profile verification evidence");
  }
  return document;
}

async function loadMetadata(projectRoot: string, profileDocument: Record<string, unknown>) {
  const safeRoot = await validateProjectRoot(projectRoot);
  const stateDirectory = await inspectStateDirectory(safeRoot);
  const path = join(stateDirectory, STACK_FILE);
  await inspectPrivateFile(path);
  let document: unknown;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("Stack metadata is invalid JSON");
  }
  return { path, document: validateMetadata(document, profileDocument) as Record<string, unknown> };
}

async function validateAdapterConnections(
  projectRoot: string,
  metadata: Record<string, unknown>,
) {
  if (metadata.runtime === null) {
    return false;
  }
  const runtime = metadata.runtime as Record<string, unknown>;
  if (runtime.adapter !== "selfhost-media") {
    fail("Recorded runtime adapter is unsupported");
  }
  const adapterScript = join(SKILLS_ROOT, "selfhost-media", "scripts", "media-runtime.ts");
  let info;
  try {
    info = await lstat(adapterScript);
  } catch {
    fail("Recorded runtime adapter is not installed");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    fail("Recorded runtime adapter executable is unsafe");
  }
  const adapterResult = spawnSync(process.execPath, [
    adapterScript,
    "exec",
    "--project",
    projectRoot,
    "--",
    "session",
    "connections-check",
    String(runtime.runId),
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 30_000,
  });
  if (adapterResult.error || adapterResult.signal || adapterResult.status !== 0) {
    fail("Recorded adapter connection state is invalid");
  }
  return true;
}

async function resume(parsed: ParsedArguments, profileDocument: Record<string, unknown>) {
  const projectRoot = oneFlag(parsed, "project-root", true) as string;
  const loaded = await loadMetadata(projectRoot, profileDocument);
  const checkpoint = loaded.document.checkpoint as Record<string, unknown>;
  const connectionRequired = STAGES.indexOf(String(checkpoint.stage)) >= STAGES.indexOf("applied");
  let adapterConnectionsValid = false;
  let adapterConnectionsStatus = "not-applicable";
  if (loaded.document.runtime !== null) {
    adapterConnectionsStatus = "pending-before-apply";
  }
  if (loaded.document.runtime !== null && connectionRequired) {
    adapterConnectionsValid = await validateAdapterConnections(projectRoot, loaded.document);
    adapterConnectionsStatus = "valid";
  }
  return {
    status: "upkeep-ready",
    path: loaded.path,
    adapterConnectionsValid,
    adapterConnectionsStatus,
    metadata: loaded.document,
  };
}

async function writeMetadata(
  path: string,
  document: Record<string, unknown>,
  create: boolean,
  profileDocument: Record<string, unknown>,
) {
  validateMetadata(document, profileDocument);
  const temporary = join(dirname(path), `.stack.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o600);
    if (create) {
      await link(temporary, path);
      await unlink(temporary);
    } else {
      await rename(temporary, path);
    }
    await chmod(path, 0o600);
  } finally {
    if (handle) {
      await handle.close();
    }
    try {
      await unlink(temporary);
    } catch {
      // The temporary path normally no longer exists.
    }
  }
}

async function inspectMetadataLock(lockPath: string) {
  let info;
  try {
    info = await lstat(lockPath);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { exists: false, stale: false, info: null };
    }
    fail("Unable to inspect stack metadata lock");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 512) {
    fail("Stack metadata lock is unsafe");
  }
  if (process.platform !== "win32") {
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      fail("Stack metadata lock has the wrong owner");
    }
    if ((info.mode & 0o7777) !== 0o600) {
      fail("Stack metadata lock must use mode 0600");
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    if (Date.now() - info.mtimeMs > 300_000) {
      return { exists: true, stale: true, info };
    }
    fail("Stack metadata lock is incomplete");
  }
  if (
    !exactKeys(payload, ["createdAt", "nonce", "pid", "schemaVersion"])
    || payload.schemaVersion !== 1
    || !Number.isInteger(payload.pid)
    || Number(payload.pid) < 1
    || !validDateTime(payload.createdAt)
    || typeof payload.nonce !== "string"
    || !/^[0-9a-f]{16}$/.test(payload.nonce)
  ) {
    fail("Stack metadata lock is invalid");
  }

  let processIsActive = true;
  try {
    process.kill(Number(payload.pid), 0);
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") {
      processIsActive = false;
    }
  }
  return { exists: true, stale: !processIsActive, info };
}

async function createMetadataLock(lockPath: string) {
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(`${JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      nonce: randomBytes(8).toString("hex"),
    })}\n`, "utf8");
    await lock.sync();
    await chmod(lockPath, 0o600);
    return lock;
  } catch (error) {
    await lock.close();
    try {
      await unlink(lockPath);
    } catch {
      // A failed lock creation may already have lost its exact temporary file.
    }
    throw error;
  }
}

async function acquireMetadataLock(lockPath: string) {
  try {
    return await createMetadataLock(lockPath);
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") {
      fail("Unable to create stack metadata lock");
    }
  }

  const recoveryPath = join(dirname(lockPath), RECOVERY_LOCK_FILE);
  let recovery;
  try {
    recovery = await createMetadataLock(recoveryPath);
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      fail("Another stack metadata recovery is active");
    }
    fail("Unable to create stack metadata recovery claim");
  }
  const recoveryInfo = await recovery.stat();
  try {
    const observed = await inspectMetadataLock(lockPath);
    if (observed.exists) {
      if (!observed.stale || observed.info === null) {
        fail("Another stack metadata update is active");
      }
      const current = await lstat(lockPath);
      if (current.dev !== observed.info.dev || current.ino !== observed.info.ino) {
        fail("Stack metadata lock changed during stale-lock recovery");
      }
      await unlink(lockPath);
    }
    try {
      return await createMetadataLock(lockPath);
    } catch {
      fail("Another stack metadata update acquired the recovered lock");
    }
  } finally {
    await recovery.close();
    const currentRecovery = await lstat(recoveryPath);
    if (
      currentRecovery.dev !== recoveryInfo.dev
      || currentRecovery.ino !== recoveryInfo.ino
    ) {
      fail("Stack metadata recovery claim changed while held");
    }
    await unlink(recoveryPath);
  }
}

async function withLock(stateDirectory: string, action: () => Promise<unknown>) {
  const lockPath = join(stateDirectory, LOCK_FILE);
  const lock = await acquireMetadataLock(lockPath);
  const lockInfo = await lock.stat();
  try {
    return await action();
  } finally {
    await lock.close();
    const current = await lstat(lockPath);
    if (current.dev !== lockInfo.dev || current.ino !== lockInfo.ino) {
      fail("Stack metadata lock changed while held");
    }
    await unlink(lockPath);
  }
}

function parseServices(values: string[], allowedSkills: string[]) {
  const services: Array<{ id: string; ownerSkill: string }> = [];
  const seen = new Set<string>();
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0 || value.indexOf("=", separator + 1) !== -1) {
      fail("--service must use ID=OWNER_SKILL");
    }
    const id = value.slice(0, separator);
    const ownerSkill = value.slice(separator + 1);
    if (!IDENTIFIER.test(id) || !SKILL_ID.test(ownerSkill) || !allowedSkills.includes(ownerSkill)) {
      fail("--service names an invalid service or unavailable owner skill");
    }
    if (seen.has(id)) {
      fail("--service repeats a service ID");
    }
    seen.add(id);
    services.push({ id, ownerSkill });
  }
  return services;
}

function validateServiceBindings(
  value: unknown,
  consumerProfiles: string[],
  serviceIds: Set<string>,
) {
  if (!Array.isArray(value)) {
    fail("Stack service bindings are invalid");
  }
  const expectedProfiles = new Set(consumerProfiles);
  const foundProfiles = new Set<string>();
  let previousProfile = "";
  for (const binding of value) {
    if (!exactKeys(binding, ["profileId", "serviceIds"])) {
      fail("Stack service binding is invalid");
    }
    if (
      typeof binding.profileId !== "string"
      || !expectedProfiles.has(binding.profileId)
      || foundProfiles.has(binding.profileId)
      || (previousProfile && binding.profileId <= previousProfile)
      || !Array.isArray(binding.serviceIds)
      || binding.serviceIds.length === 0
    ) {
      fail("Stack service binding is invalid");
    }
    const boundServices = new Set<string>();
    let previousService = "";
    for (const serviceId of binding.serviceIds) {
      if (
        typeof serviceId !== "string"
        || !IDENTIFIER.test(serviceId)
        || !serviceIds.has(serviceId)
        || boundServices.has(serviceId)
        || (previousService && serviceId <= previousService)
      ) {
        fail("Stack service binding is invalid");
      }
      boundServices.add(serviceId);
      previousService = serviceId;
    }
    foundProfiles.add(binding.profileId);
    previousProfile = binding.profileId;
  }
  if (foundProfiles.size !== expectedProfiles.size) {
    fail("Every consuming profile requires an explicit service binding");
  }
  return value as Array<{ profileId: string; serviceIds: string[] }>;
}

function mergeServiceBindings(
  existing: unknown,
  values: string[],
  existingConsumerProfiles: string[],
  consumerProfiles: string[],
  services: Array<{ id: string; ownerSkill: string }>,
) {
  const knownServices = new Set(services.map((service) => service.id));
  const existingBindings = validateServiceBindings(
    existing,
    existingConsumerProfiles,
    knownServices,
  );
  const byProfile = new Map<string, Set<string>>();
  for (const binding of existingBindings) {
    byProfile.set(binding.profileId, new Set(binding.serviceIds));
  }
  const consumers = new Set(consumerProfiles);
  const supplied = new Set<string>();
  let bindingAdded = false;
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0 || value.indexOf("=", separator + 1) !== -1) {
      fail("--consume must use PROFILE=SERVICE");
    }
    const profileId = value.slice(0, separator);
    const serviceId = value.slice(separator + 1);
    const pair = `${profileId}=${serviceId}`;
    if (!consumers.has(profileId) || !IDENTIFIER.test(serviceId) || !knownServices.has(serviceId)) {
      fail("--consume must bind a consuming selected profile to a recorded service");
    }
    if (supplied.has(pair)) {
      fail("--consume repeats a profile and service binding");
    }
    supplied.add(pair);
    let boundServices = byProfile.get(profileId);
    if (!boundServices) {
      boundServices = new Set<string>();
      byProfile.set(profileId, boundServices);
    }
    if (!boundServices.has(serviceId)) {
      bindingAdded = true;
      boundServices.add(serviceId);
    }
  }
  const serviceBindings = [...byProfile.entries()]
    .map(([profileId, ids]) => ({ profileId, serviceIds: [...ids].sort() }))
    .sort((left, right) => left.profileId.localeCompare(right.profileId));
  validateServiceBindings(serviceBindings, consumerProfiles, knownServices);
  return { bindingAdded, serviceBindings };
}

function runtimeFromFlags(parsed: ParsedArguments, profiles: string[]) {
  const adapter = oneFlag(parsed, "adapter");
  const runId = oneFlag(parsed, "run-id");
  if ((adapter === null) !== (runId === null)) {
    fail("--adapter and --run-id must be supplied together");
  }
  if (profiles.includes("media") && (adapter !== "selfhost-media" || runId === null)) {
    fail("The media profile requires --adapter selfhost-media and --run-id ID");
  }
  if (adapter !== null && adapter !== "selfhost-media") {
    fail("Only the selfhost-media runtime adapter is currently implemented");
  }
  if (runId !== null && !RUN_ID.test(runId)) {
    fail("--run-id is invalid");
  }
  if (adapter === null || runId === null) {
    return { runtime: null, connections: null };
  }
  const statePath = `.selfhost/media-harness/.sessions/${runId}`;
  return {
    runtime: { adapter, runId, statePath },
    connections: {
      path: `${statePath}/connections.env`,
      contains: ["api-keys", "urls", "usernames"],
      initialPasswordStored: false,
    },
  };
}

function mediaServices(profiles: string[], skills: string[]) {
  if (!profiles.includes("media")) {
    return [];
  }
  return MEDIA_SERVICES.map(([id, ownerSkill]) => {
    if (!skills.includes(ownerSkill)) {
      fail("Media profile skill closure is incomplete");
    }
    return { id, ownerSkill };
  });
}

async function initialize(parsed: ParsedArguments, profileDocument: Record<string, unknown>) {
  const projectRoot = oneFlag(parsed, "project-root", true) as string;
  const safeRoot = await validateProjectRoot(projectRoot);
  const resolved = resolveProfiles(profileDocument, parsed.flags.profile);
  const runtime = runtimeFromFlags(parsed, resolved.profiles);
  const services = mediaServices(resolved.profiles, resolved.skills);
  services.push(...parseServices(parsed.flags.service, resolved.skills));
  const serviceIds = new Set<string>();
  for (const service of services) {
    if (serviceIds.has(service.id)) {
      fail("Stack service selection is duplicated");
    }
    serviceIds.add(service.id);
  }
  const obligations = profileObligations(profileDocument, resolved.profiles);
  const serviceBindings = mergeServiceBindings(
    [],
    parsed.flags.consume,
    [],
    obligations.serviceConsumerProfiles,
    services,
  ).serviceBindings;
  const stateDirectory = await ensureStateDirectory(safeRoot);
  const path = join(stateDirectory, STACK_FILE);
  return await withLock(stateDirectory, async () => {
    if (await inspectPrivateFile(path, true)) {
      fail("Stack metadata already exists; use extend or checkpoint");
    }
    const recordedAt = new Date().toISOString();
    const document = {
      schemaVersion: 1,
      revision: 1,
      createdAt: recordedAt,
      updatedAt: recordedAt,
      profiles: resolved.profiles,
      skills: resolved.skills,
      runtime: runtime.runtime,
      serviceBindings,
      services: services.sort((left, right) => left.id.localeCompare(right.id)),
      connections: runtime.connections,
      checkpoint: { stage: "selected", recordedAt, evidenceIds: [] },
    };
    await writeMetadata(path, document, true, profileDocument);
    return { status: "initialized", path, metadata: document };
  });
}

async function extend(parsed: ParsedArguments, profileDocument: Record<string, unknown>) {
  const projectRoot = oneFlag(parsed, "project-root", true) as string;
  if (parsed.flags.profile.length === 0 && parsed.flags.service.length === 0 && parsed.flags.consume.length === 0) {
    fail("extend requires at least one --profile, --service, or --consume");
  }
  const safeRoot = await validateProjectRoot(projectRoot);
  const stateDirectory = await inspectStateDirectory(safeRoot);
  return await withLock(stateDirectory, async () => {
    const loaded = await loadMetadata(safeRoot, profileDocument);
    const currentProfiles = loaded.document.profiles as string[];
    const requested = [...currentProfiles, ...parsed.flags.profile];
    const resolved = resolveProfiles(profileDocument, requested);
    if (
      !resolved.profiles.includes("media")
      && (parsed.flags.adapter.length > 0 || parsed.flags["run-id"].length > 0)
    ) {
      fail("Runtime flags require the media profile");
    }
    let runtime = loaded.document.runtime;
    let connections = loaded.document.connections;
    if (currentProfiles.includes("media") || resolved.profiles.includes("media")) {
      if (runtime === null) {
        const selectedRuntime = runtimeFromFlags(parsed, resolved.profiles);
        runtime = selectedRuntime.runtime;
        connections = selectedRuntime.connections;
      } else if (parsed.flags.adapter.length > 0 || parsed.flags["run-id"].length > 0) {
        const selectedRuntime = runtimeFromFlags(parsed, resolved.profiles);
        if (selectedRuntime.runtime === null) {
          fail("Recorded runtime validation failed");
        }
        const currentRuntime = runtime as Record<string, unknown>;
        if (
          currentRuntime.adapter !== selectedRuntime.runtime.adapter
          || currentRuntime.runId !== selectedRuntime.runtime.runId
        ) {
          fail("Extension cannot replace the recorded runtime");
        }
      }
    }
    const existingServices = structuredClone(loaded.document.services) as Array<{ id: string; ownerSkill: string }>;
    const additions = mediaServices(resolved.profiles, resolved.skills);
    additions.push(...parseServices(parsed.flags.service, resolved.skills));
    const byId = new Map(existingServices.map((service) => [service.id, service]));
    let serviceAdded = false;
    for (const service of additions) {
      const existing = byId.get(service.id);
      if (existing && existing.ownerSkill !== service.ownerSkill) {
        fail(`Service ${service.id} already has another owner`);
      }
      if (!existing) {
        serviceAdded = true;
      }
      byId.set(service.id, service);
    }
    const obligations = profileObligations(profileDocument, resolved.profiles);
    const currentObligations = profileObligations(profileDocument, currentProfiles);
    const mergedBindings = mergeServiceBindings(
      loaded.document.serviceBindings,
      parsed.flags.consume,
      currentObligations.serviceConsumerProfiles,
      obligations.serviceConsumerProfiles,
      [...byId.values()],
    );
    const profileAdded = !sameStrings(currentProfiles, resolved.profiles);
    if (!profileAdded && !serviceAdded && !mergedBindings.bindingAdded) {
      fail("extend must add a profile, service, or service binding");
    }
    const recordedAt = new Date().toISOString();
    loaded.document.revision = Number(loaded.document.revision) + 1;
    loaded.document.updatedAt = recordedAt;
    loaded.document.profiles = resolved.profiles;
    loaded.document.skills = resolved.skills;
    loaded.document.runtime = runtime;
    loaded.document.connections = connections;
    loaded.document.serviceBindings = mergedBindings.serviceBindings;
    loaded.document.services = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
    loaded.document.checkpoint = { stage: "selected", recordedAt, evidenceIds: [] };
    await writeMetadata(loaded.path, loaded.document, false, profileDocument);
    return { status: "extended-selection", path: loaded.path, metadata: loaded.document };
  });
}

async function checkpoint(parsed: ParsedArguments, profileDocument: Record<string, unknown>) {
  const projectRoot = oneFlag(parsed, "project-root", true) as string;
  const stage = oneFlag(parsed, "stage", true) as string;
  if (!STAGES.includes(stage) || stage === "selected") {
    fail("--stage must be planned, applied, or verified");
  }
  const supplied = validateEvidence(parsed.flags.evidence);
  if (stage === "planned" && !supplied.some((id) => id.startsWith("plan:"))) {
    fail("Planned checkpoint requires new plan evidence");
  }
  if (stage === "applied" && !supplied.some((id) => id.startsWith("apply:") || id.startsWith("manifest:"))) {
    fail("Applied checkpoint requires new apply or manifest evidence");
  }
  if (stage === "verified" && !supplied.some((id) => id.startsWith("verify:"))) {
    fail("Verified checkpoint requires new verification evidence");
  }
  const safeRoot = await validateProjectRoot(projectRoot);
  const stateDirectory = await inspectStateDirectory(safeRoot);
  return await withLock(stateDirectory, async () => {
    const loaded = await loadMetadata(safeRoot, profileDocument);
    const currentCheckpoint = loaded.document.checkpoint as Record<string, unknown>;
    const current = STAGES.indexOf(String(currentCheckpoint.stage));
    const requested = STAGES.indexOf(stage);
    if (requested < current || requested > current + 1) {
      fail("Stack checkpoints must advance one stage at a time");
    }
    const existingEvidence = currentCheckpoint.evidenceIds as string[];
    if (supplied.some((id) => existingEvidence.includes(id))) {
      fail("Checkpoint evidence must be new");
    }
    const recordedAt = new Date().toISOString();
    loaded.document.revision = Number(loaded.document.revision) + 1;
    loaded.document.updatedAt = recordedAt;
    loaded.document.checkpoint = {
      stage,
      recordedAt,
      evidenceIds: [...new Set([...existingEvidence, ...supplied])].sort(),
    };
    await writeMetadata(loaded.path, loaded.document, false, profileDocument);
    return { status: "checkpoint-recorded", path: loaded.path, metadata: loaded.document };
  });
}

function printHuman(result: Record<string, unknown>) {
  if (result.status === "profiles") {
    for (const profile of result.profiles as Array<Record<string, unknown>>) {
      process.stdout.write(`${profile.id} [${profile.kind}] - ${profile.label}\n`);
    }
    return;
  }
  if (result.status === "ready" || result.status === "missing-prerequisites") {
    process.stdout.write(`Prerequisites: ${result.status}\n`);
    process.stdout.write(`Skill target: ${result.targetSkillsRoot}\n`);
    for (const item of result.installCommands as Array<{ reason: string; command: string; workingDirectory: string | null }>) {
      let location = "";
      if (item.workingDirectory !== null) {
        location = ` (from ${item.workingDirectory})`;
      }
      process.stdout.write(`  ${item.reason}${location}: ${item.command}\n`);
    }
    process.stdout.write(`${result.next}\n`);
    return;
  }
  process.stdout.write(`${result.status}: ${result.path}\n`);
  const metadata = result.metadata as Record<string, unknown>;
  const checkpointData = metadata.checkpoint as Record<string, unknown>;
  process.stdout.write(`Profiles: ${(metadata.profiles as string[]).join(", ")}\n`);
  process.stdout.write(`Services: ${(metadata.services as unknown[]).length}\n`);
  process.stdout.write(`Service bindings: ${(metadata.serviceBindings as unknown[]).length}\n`);
  process.stdout.write(`Checkpoint: ${checkpointData.stage}\n`);
  if (typeof result.adapterConnectionsStatus === "string") {
    process.stdout.write(`Adapter connections: ${result.adapterConnectionsStatus}\n`);
  }
  if (metadata.connections !== null) {
    const connections = metadata.connections as Record<string, unknown>;
    process.stdout.write(`Connections: ${connections.path} (password excluded)\n`);
  }
}

async function main() {
  const [command, ...input] = Bun.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const parsed = parseArguments(input);
  if (parsed.positional.length > 0) {
    fail(`Unexpected argument ${parsed.positional[0]}`);
  }
  const profileDocument = await loadProfiles();
  let result: Record<string, unknown>;
  if (command === "profiles") {
    rejectFlagsExcept(parsed, []);
    result = { status: "profiles", profiles: profileDocument.profiles };
  } else if (command === "prerequisites") {
    rejectFlagsExcept(parsed, ["agent", "profile", "project-root", "scope"], true);
    result = await prerequisites(parsed, profileDocument);
  } else if (command === "init") {
    rejectFlagsExcept(parsed, ["adapter", "consume", "profile", "project-root", "run-id", "service"]);
    result = await initialize(parsed, profileDocument);
  } else if (command === "show" || command === "validate") {
    rejectFlagsExcept(parsed, ["project-root"]);
    const projectRoot = oneFlag(parsed, "project-root", true) as string;
    const loaded = await loadMetadata(projectRoot, profileDocument);
    result = { status: "metadata-valid", path: loaded.path, metadata: loaded.document };
  } else if (command === "resume") {
    rejectFlagsExcept(parsed, ["project-root"]);
    result = await resume(parsed, profileDocument);
  } else if (command === "extend") {
    rejectFlagsExcept(parsed, ["adapter", "consume", "profile", "project-root", "run-id", "service"]);
    result = await extend(parsed, profileDocument);
  } else if (command === "checkpoint") {
    rejectFlagsExcept(parsed, ["evidence", "project-root", "stage"]);
    result = await checkpoint(parsed, profileDocument);
  } else {
    fail(`Unknown command ${command}`);
  }
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  printHuman(result);
}

main().catch((error) => {
  let message = "Unexpected stack lifecycle failure";
  if (error instanceof Error && error.message) {
    message = error.message;
  }
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
});
