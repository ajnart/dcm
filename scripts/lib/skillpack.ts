import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile
} from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { runRepositoryValidation } from "../validate-repo.ts";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const skillsRoot = join(repositoryRoot, ".agents", "skills");
export const registryPath = join(skillsRoot, "selfhost", "references", "catalog", "skills.json");

const PACKAGE_SIZE_BUDGET = Math.floor(1.35 * 1024 * 1024);
const SECRET_MESSAGE = /(?:password|passwd|secret|token|api[-_]?key|private[-_]?key|cookie|session)\s*[:=]\s*\S+/gi;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const SENSITIVE_HISTORY_PATH = /(?:^|\/)(?:\.sessions|(?:browser-)?profiles?|cookies?|secrets?)(?:\/|$)|(?:^|\/)(?:\.env[^/]*|credentials\.env|[^/]+\.(?:pem|key|p12|pfx|kdbx))$/i;
const CREDENTIAL_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["credential-url", /:\/\/[^\s/@:]+:[^\s/@]+@/],
  ["literal-password", /["']?(?:password|passwordConfirmation|web_ui_password)["']?\s*[:=]\s*["'](?!<|redacted|placeholder|example|change-me)[^"'\r\n]{8,}["']/i]
];

const BENCHMARK_P95_BUDGET_MS = 500;

const PUBLIC_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "SECURITY.md",
  "CHANGELOG.md",
  "THIRD_PARTY_NOTICES.md",
  "security/history-allowlist.json",
  "SKILL_INDEX.md",
  "skill-index.json",
  "llms.txt",
  "docs/migration-v1.md",
  "docs/cli.md",
  "docs/release.md",
  "docs/README.md",
  "docs/homarr.md",
  "docs/jellyfin.md",
  "docs/prowlarr.md",
  "docs/qbittorrent.md",
  "docs/radarr.md",
  "docs/seerr.md",
  "docs/sonarr.md",
  "docs/images/selfhost-architecture.svg",
  "docs/images/selfhost-flow.svg",
  "homarr-dashboard.png"
];

const PROJECTED_PUBLIC_FILES = [
  { source: ".agents/install.md", destination: "INSTALL.md" },
  { source: ".agents/invocation.md", destination: "INVOCATION.md" },
  { source: ".agents/CONTEXT.md", destination: "CONTEXT.md" }
];

function normalizePath(path) {
  return path.split(sep).join("/");
}

function isRepositoryChild(path) {
  return path !== repositoryRoot && path.startsWith(`${repositoryRoot}${sep}`);
}

async function assertNoSymlinkPath(path, label) {
  const resolvedPath = resolve(path);
  if (resolvedPath !== repositoryRoot && !isRepositoryChild(resolvedPath)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  let actual;
  try {
    actual = await realpath(resolvedPath);
  } catch {
    throw new Error(`${label} is missing or unreadable`);
  }
  const realRoot = await realpath(repositoryRoot);
  const expected = join(realRoot, relative(repositoryRoot, resolvedPath));
  if (actual !== expected) {
    throw new Error(`${label} must not contain symlinked path components`);
  }
  return resolvedPath;
}

async function readPackageFile(relativePath, label) {
  const path = await assertNoSymlinkPath(join(repositoryRoot, relativePath), label);
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  return { data: await readFile(path), details, path };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function safeMessage(value) {
  return String(value || "Unexpected failure")
    .replaceAll(repositoryRoot, "<repository>")
    .replace(SECRET_MESSAGE, "<redacted>")
    .slice(0, 800);
}

async function readJson(path, label) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new Error(`${label} is missing or unreadable`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(markdown, label) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) {
    throw new Error(`${label} has no YAML frontmatter`);
  }
  const values = new Map();
  for (const line of match[1].split("\n")) {
    if (!line.trim() || /^\s/.test(line)) {
      continue;
    }
    const field = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (!field) {
      throw new Error(`${label} contains unsupported frontmatter syntax`);
    }
    values.set(field[1], parseYamlScalar(field[2]));
  }
  return { values, body: normalized.slice(match[0].length) };
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink()) {
        throw new Error(`Symlink is not permitted: ${normalizePath(relative(repositoryRoot, path))}`);
      }
      if (details.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!details.isFile()) {
        throw new Error(`Special entry is not permitted: ${normalizePath(relative(repositoryRoot, path))}`);
      }
      files.push({ path, details });
    }
  }
  await visit(root);
  return files;
}

function parseOpenAiYaml(yaml) {
  const values = new Map();
  for (const line of yaml.replace(/\r\n/g, "\n").split("\n")) {
    const match = /^\s{2}(display_name|short_description|default_prompt):\s*(.+)$/.exec(line);
    if (match) {
      values.set(match[1], parseYamlScalar(match[2]));
    }
  }
  return values;
}

export async function loadRegistry() {
  return readJson(registryPath, "Skill registry");
}

export async function discoverSkills() {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !entry.name.startsWith("selfhost")) {
      continue;
    }
    const root = join(skillsRoot, entry.name);
    const skillPath = join(root, "SKILL.md");
    const markdown = await readFile(skillPath, "utf8");
    const frontmatter = parseFrontmatter(markdown, `${entry.name}/SKILL.md`);
    const files = await walkFiles(root);
    let bytes = 0;
    for (const file of files) {
      bytes += file.details.size;
    }
    const openAi = parseOpenAiYaml(await readFile(join(root, "agents", "openai.yaml"), "utf8"));
    skills.push({
      id: entry.name,
      root,
      markdown,
      frontmatter,
      openAi,
      files,
      bytes
    });
  }
  return skills;
}

function validateRegistryShape(registry, skillIds) {
  const errors = [];
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return ["Skill registry must be an object"];
  }
  const rootKeys = Object.keys(registry).sort();
  if (JSON.stringify(rootKeys) !== JSON.stringify(["packVersion", "schemaVersion", "skills"])) {
    errors.push("Skill registry root keys must be packVersion, schemaVersion, and skills");
  }
  if (registry.schemaVersion !== 3) {
    errors.push("Skill registry schemaVersion must be 3");
  }
  if (typeof registry.packVersion !== "string" || !SEMVER.test(registry.packVersion)) {
    errors.push("Skill registry packVersion must be strict semantic versioning");
  }
  if (!Array.isArray(registry.skills) || registry.skills.length === 0) {
    errors.push("Skill registry skills must be a non-empty array");
    return errors;
  }
  const ids = [];
  const records = new Map();
  for (const record of registry.skills) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push("Skill registry contains a non-object record");
      continue;
    }
    const keys = Object.keys(record).sort();
    const expected = ["activation", "delegatesTo", "id", "kind", "risk", "scope"];
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      errors.push(`Skill registry record ${record.id || "<unknown>"} has unsupported keys`);
      continue;
    }
    if (typeof record.id !== "string" || !/^selfhost(?:-[a-z0-9]+)*$/.test(record.id)) {
      errors.push("Skill registry contains an invalid id");
      continue;
    }
    ids.push(record.id);
    records.set(record.id, record);
    if (!["router", "capability", "adapter"].includes(record.kind)) {
      errors.push(`Skill ${record.id} has an invalid kind`);
    }
    if (!["read-only", "approval-gated-write"].includes(record.risk)) {
      errors.push(`Skill ${record.id} has an invalid risk`);
    }
    if (!["implicit", "delegated", "explicit"].includes(record.activation)) {
      errors.push(`Skill ${record.id} has an invalid activation`);
    }
    if (!Array.isArray(record.delegatesTo) || new Set(record.delegatesTo).size !== record.delegatesTo.length) {
      errors.push(`Skill ${record.id} delegatesTo must be a unique array`);
    }
    if (record.kind === "adapter") {
      if (record.scope !== "application" && record.scope !== "stack") {
        errors.push(`Adapter ${record.id} must have application or stack scope`);
      }
    } else if (record.scope !== null) {
      errors.push(`Non-adapter ${record.id} must have null scope`);
    }
    if (record.kind === "router" && record.activation !== "implicit") {
      errors.push(`Router ${record.id} must use implicit activation`);
    }
  }
  const sortedIds = [...ids].sort();
  if (JSON.stringify(ids) !== JSON.stringify(sortedIds)) {
    errors.push("Skill registry records must be sorted by id");
  }
  if (new Set(ids).size !== ids.length) {
    errors.push("Skill registry ids must be unique");
  }
  if (JSON.stringify(sortedIds) !== JSON.stringify([...skillIds].sort())) {
    errors.push("Skill registry ids must exactly match canonical skill directories");
  }
  for (const record of records.values()) {
    for (const target of record.delegatesTo) {
      if (!records.has(target)) {
        errors.push(`Skill ${record.id} delegates to missing skill ${target}`);
      }
      if (target === record.id) {
        errors.push(`Skill ${record.id} cannot delegate to itself`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      errors.push(`Delegation graph contains a cycle at ${id}`);
      return;
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    const record = records.get(id);
    if (record && Array.isArray(record.delegatesTo)) {
      for (const target of record.delegatesTo) {
        if (records.has(target)) {
          visit(target);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) {
    visit(id);
  }
  return errors;
}

function wordCount(value) {
  const words = value.match(/[A-Za-z0-9][A-Za-z0-9'./:-]*/g);
  if (!words) {
    return 0;
  }
  return words.length;
}

function validateSkillMetadata(skills) {
  const errors = [];
  let discoveryCharacters = 0;
  for (const skill of skills) {
    const values = skill.frontmatter.values;
    const name = values.get("name");
    const description = values.get("description");
    const license = values.get("license");
    const compatibility = values.get("compatibility");
    if (name !== skill.id) {
      errors.push(`${skill.id}: frontmatter name must match the directory`);
    }
    if (typeof description !== "string" || description.length < 1 || description.length > 600) {
      errors.push(`${skill.id}: description must be 1-600 characters`);
    } else {
      discoveryCharacters += description.length;
    }
    if (license !== "Apache-2.0; see LICENSE.txt") {
      errors.push(`${skill.id}: license must reference LICENSE.txt`);
    }
    if (typeof compatibility !== "string" || compatibility.length < 20 || compatibility.length > 240) {
      errors.push(`${skill.id}: compatibility must be 20-240 characters`);
    }
    const lines = skill.markdown.replace(/\r\n/g, "\n").split("\n").length;
    let budget = 700;
    if (skill.id === "selfhost") {
      budget = 900;
    }
    if (lines > 500 || Buffer.byteLength(skill.markdown) > 16 * 1024 || wordCount(skill.frontmatter.body) > budget) {
      errors.push(`${skill.id}: SKILL.md exceeds its progressive-disclosure budget`);
    }
    if (!skill.files.some((file) => file.path === join(skill.root, "LICENSE.txt"))) {
      errors.push(`${skill.id}: packaged LICENSE.txt is missing`);
    }
    const displayName = skill.openAi.get("display_name");
    const shortDescription = skill.openAi.get("short_description");
    const defaultPrompt = skill.openAi.get("default_prompt");
    if (typeof displayName !== "string" || displayName.length < 1 || displayName.length > 64) {
      errors.push(`${skill.id}: agents/openai.yaml display_name is invalid`);
    }
    if (typeof shortDescription !== "string" || shortDescription.length < 25 || shortDescription.length > 64) {
      errors.push(`${skill.id}: agents/openai.yaml short_description is invalid`);
    }
    if (typeof defaultPrompt !== "string" || !defaultPrompt.includes(`$${skill.id}`)) {
      errors.push(`${skill.id}: agents/openai.yaml default_prompt must mention $${skill.id}`);
    }
  }
  if (discoveryCharacters > 5000) {
    errors.push("Combined skill descriptions exceed 5000 characters");
  }
  return { errors, discoveryCharacters };
}

function reverseDependents(registry) {
  const reverse = new Map();
  for (const record of registry.skills) {
    reverse.set(record.id, new Set());
  }
  for (const record of registry.skills) {
    for (const target of record.delegatesTo) {
      if (reverse.has(target)) {
        reverse.get(target).add(record.id);
      }
    }
  }
  return reverse;
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: options.buffer ? null : "utf8",
    input: options.input,
    env: { PATH: process.env.PATH || "", LANG: "C", LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git command ${args[0]} failed`);
  }
  if (options.buffer) {
    return result.stdout;
  }
  return result.stdout.trim();
}

export async function affectedSkillsFromRef(reference) {
  const registry = await loadRegistry();
  const all = new Set(registry.skills.map((record) => record.id));
  const changed = runGit(["diff", "--name-only", reference, "--"]);
  if (!changed) {
    return [];
  }
  const direct = new Set();
  for (const path of changed.split("\n")) {
    const match = /^\.agents\/skills\/(selfhost(?:-[a-z0-9]+)*)\//.exec(path);
    if (match) {
      direct.add(match[1]);
      continue;
    }
    if (
      path.startsWith("scripts/lib/skillpack")
      || path === "scripts/skillpack.ts"
      || path.startsWith("tests/behavior/")
      || path === "package.json"
      || path.startsWith(".github/")
    ) {
      return [...all].sort();
    }
    const mediaDocumentation = path.startsWith("docs/")
      && !new Set([
        "docs/cli.md",
        "docs/migration-v1.md",
        "docs/release.md",
        "docs/images/selfhost-architecture.svg",
        "docs/images/selfhost-flow.svg"
      ]).has(path);
    if (
      path === "PROMPT.md"
      || path === "docker-compose.yml"
      || path.startsWith("prompts/")
      || mediaDocumentation
      || path === "scripts/refresh-media-bundle.ts"
      || path.startsWith("scripts/check-")
      || path.startsWith("scripts/lib/")
    ) {
      direct.add("selfhost-media");
    }
  }
  const reverse = reverseDependents(registry);
  const queue = [...direct];
  while (queue.length > 0) {
    const current = queue.shift();
    const parents = reverse.get(current);
    if (!parents) {
      continue;
    }
    for (const parent of parents) {
      if (!direct.has(parent)) {
        direct.add(parent);
        queue.push(parent);
      }
    }
  }
  return [...direct].sort();
}

function validateVersionParity(registry, manifests) {
  const errors = [];
  for (const [label, value] of manifests) {
    if (value !== registry.packVersion) {
      errors.push(`${label} version must equal registry packVersion ${registry.packVersion}`);
    }
  }
  return errors;
}

async function loadPublicManifests() {
  const packageManifest = await readJson(join(repositoryRoot, "package.json"), "package.json");
  const codex = await readJson(join(repositoryRoot, "packaging", "codex-plugin.json"), "Codex plugin template");
  const claude = await readJson(join(repositoryRoot, "packaging", "claude-plugin.json"), "Claude plugin template");
  return { packageManifest, codex, claude };
}

async function validatePublicSurface(registry) {
  const errors = [];
  const manifests = await loadPublicManifests();
  errors.push(...validateVersionParity(registry, [
    ["package.json", manifests.packageManifest.version],
    ["Codex plugin", manifests.codex.version],
    ["Claude plugin", manifests.claude.version]
  ]));
  if (manifests.codex.name !== "selfhost-skills" || manifests.codex.skills !== "./skills/") {
    errors.push("Codex release template must expose the native skills directory");
  }
  if (manifests.codex.hooks || manifests.codex.mcpServers || manifests.codex.apps) {
    errors.push("Codex plugin must not auto-enable hooks, MCP servers, or apps");
  }
  if (manifests.claude.name !== "selfhost-skills") {
    errors.push("Claude plugin name is invalid");
  }
  for (const invalidSourceManifest of [
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json"
  ]) {
    if (existsSync(join(repositoryRoot, invalidSourceManifest))) {
      errors.push(`${invalidSourceManifest} would expose a non-native source checkout; generate the release package instead`);
    }
  }
  if (!existsSync(join(repositoryRoot, "LICENSE"))) {
    errors.push("Root Apache-2.0 LICENSE is missing");
  }
  return errors;
}

function buildIndexData(registry, skills) {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return {
    schemaVersion: 1,
    packVersion: registry.packVersion,
    skills: registry.skills.map((record) => {
      const skill = byId.get(record.id);
      return {
        id: record.id,
        displayName: skill.openAi.get("display_name"),
        description: skill.frontmatter.values.get("description"),
        compatibility: skill.frontmatter.values.get("compatibility"),
        license: "Apache-2.0",
        kind: record.kind,
        scope: record.scope,
        risk: record.risk,
        activation: record.activation,
        delegatesTo: record.delegatesTo
      };
    })
  };
}

export function renderIndexArtifacts(registry, skills, options = {}) {
  const data = buildIndexData(registry, skills);
  const skillsDirectory = options.skillsDirectory || ".agents/skills";
  const markdown = [
    "# Selfhost Skill Index",
    "",
    `Pack version: \`${data.packVersion}\``,
    "",
    "| Skill | Kind | Risk | Activation | Purpose |",
    "| --- | --- | --- | --- | --- |"
  ];
  for (const skill of data.skills) {
    markdown.push(`| [\`${skill.id}\`](${skillsDirectory}/${skill.id}/SKILL.md) | ${skill.kind} | ${skill.risk} | ${skill.activation} | ${skill.description} |`);
  }
  markdown.push("", "Generated from the canonical registry and skill frontmatter. Do not edit this file by hand.", "");

  const llms = [
    "# Selfhost Skills",
    "",
    "> Composable, private-first self-hosting skills with explicit approval and verification boundaries.",
    "",
    `Pack version: ${data.packVersion}`,
    "",
    "## Skills",
    ""
  ];
  for (const skill of data.skills) {
    llms.push(`- [${skill.id}](${skillsDirectory}/${skill.id}/SKILL.md): ${skill.description}`);
  }
  llms.push("", "## Primary documentation", "", "- [README](README.md)", "- [Security policy](SECURITY.md)", "- [Contribution guide](CONTRIBUTING.md)", "");
  return {
    "SKILL_INDEX.md": markdown.join("\n"),
    "skill-index.json": `${JSON.stringify(data, null, 2)}\n`,
    "llms.txt": llms.join("\n")
  };
}

export async function writeIndexArtifacts() {
  const registry = await loadRegistry();
  const skills = await discoverSkills();
  const artifacts = renderIndexArtifacts(registry, skills);
  for (const [name, content] of Object.entries(artifacts)) {
    await writeFile(join(repositoryRoot, name), content, "utf8");
  }
  return Object.keys(artifacts);
}

async function validateIndexArtifacts(registry, skills) {
  const errors = [];
  const expected = renderIndexArtifacts(registry, skills);
  for (const [name, content] of Object.entries(expected)) {
    let actual = "";
    try {
      actual = await readFile(join(repositoryRoot, name), "utf8");
    } catch {
      errors.push(`${name} is missing`);
      continue;
    }
    if (actual !== content) {
      errors.push(`${name} is stale; run skillpack index --write`);
    }
  }
  return errors;
}

async function runLegacyValidation() {
  try {
    const result = await runRepositoryValidation();
    return { ok: result.ok === true, detail: result };
  } catch (error) {
    return { ok: false, detail: safeMessage(error instanceof Error ? error.message : error) };
  }
}

export async function inspectPack() {
  const registry = await loadRegistry();
  const skills = await discoverSkills();
  let files = 0;
  let bytes = 0;
  let descriptions = 0;
  for (const skill of skills) {
    files += skill.files.length;
    bytes += skill.bytes;
    descriptions += skill.frontmatter.values.get("description")?.length || 0;
  }
  return {
    packVersion: registry.packVersion,
    schemaVersion: registry.schemaVersion,
    skills: skills.length,
    adapters: registry.skills.filter((record) => record.kind === "adapter").length,
    files,
    bytes,
    descriptionCharacters: descriptions
  };
}

export async function validatePack(scope = "all") {
  const allowedScopes = new Set(["metadata", "content", "package", "public", "all"]);
  if (!allowedScopes.has(scope)) {
    throw new Error("Validation scope must be metadata, content, package, public, or all");
  }
  const registry = await loadRegistry();
  const skills = await discoverSkills();
  const checks = [];
  const registryErrors = validateRegistryShape(registry, skills.map((skill) => skill.id));
  checks.push({ name: "registry", status: registryErrors.length === 0 ? "pass" : "fail", errors: registryErrors });

  if (scope === "metadata" || scope === "content" || scope === "all") {
    const metadata = validateSkillMetadata(skills);
    checks.push({ name: "skill metadata", status: metadata.errors.length === 0 ? "pass" : "fail", errors: metadata.errors, discoveryCharacters: metadata.discoveryCharacters });
  }
  if (scope === "public" || scope === "package" || scope === "all") {
    const publicErrors = await validatePublicSurface(registry);
    checks.push({ name: "public surface", status: publicErrors.length === 0 ? "pass" : "fail", errors: publicErrors });
    const indexErrors = await validateIndexArtifacts(registry, skills);
    checks.push({ name: "generated indexes", status: indexErrors.length === 0 ? "pass" : "fail", errors: indexErrors });
  }
  if (scope === "package" || scope === "all") {
    const packageErrors = [];
    let packageDetail = null;
    try {
      const built = await buildPackage(registry.packVersion);
      packageDetail = {
        bytes: built.archive.length,
        files: built.releaseManifest.files.length,
        sha256: built.digest
      };
    } catch (error) {
      packageErrors.push(formatError(error));
    }
    checks.push({
      name: "reproducible package",
      status: packageErrors.length === 0 ? "pass" : "fail",
      errors: packageErrors,
      detail: packageDetail
    });
  }
  if (scope === "content" || scope === "all") {
    const legacy = await runLegacyValidation();
    const errors = [];
    if (!legacy.ok) {
      errors.push("Existing repository contracts failed; inspect validation detail");
    }
    checks.push({ name: "repository contracts", status: legacy.ok ? "pass" : "fail", errors, detail: legacy.detail });
  }
  const failures = checks.filter((check) => check.status === "fail");
  return { ok: failures.length === 0, scope, checks };
}

export async function runBehaviorTests(options = {}) {
  const { cleanupBehaviorTests, runSkill } = await import("../../tests/behavior/run.ts");
  const registry = await loadRegistry();
  let selected = registry.skills.map((record) => record.id);
  if (options.skill) {
    if (!selected.includes(options.skill)) {
      throw new Error(`Unknown skill ${options.skill}`);
    }
    selected = [options.skill];
  }
  if (options.changedFrom) {
    selected = await affectedSkillsFromRef(options.changedFrom);
  }
  const results = [];
  const covered = [];
  try {
    for (const id of selected) {
      covered.push(id);
      const started = process.hrtime.bigint();
      try {
        const result = await runSkill(id);
        results.push({
          path: `tests/behavior/${id}`,
          ok: true,
          exitCode: 0,
          durationMs: Number((Number(process.hrtime.bigint() - started) / 1_000_000).toFixed(2)),
          output: `${result.scenarios} deterministic scenarios passed`
        });
      } catch (error) {
        results.push({
          path: `tests/behavior/${id}`,
          ok: false,
          exitCode: 1,
          durationMs: Number((Number(process.hrtime.bigint() - started) / 1_000_000).toFixed(2)),
          output: safeMessage(error instanceof Error ? error.stack || error.message : error)
        });
      }
    }
  } finally {
    cleanupBehaviorTests();
  }
  return {
    ok: results.every((result) => result.ok),
    selected,
    covered,
    uncovered: [],
    results
  };
}

function parseBatchObjects(buffer) {
  const objects = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const newline = buffer.indexOf(0x0a, offset);
    if (newline < 0) {
      break;
    }
    const header = buffer.subarray(offset, newline).toString("utf8");
    const [objectId, type, rawSize] = header.split(" ");
    offset = newline + 1;
    if (type === "missing") {
      continue;
    }
    const size = Number.parseInt(rawSize, 10);
    if (!Number.isInteger(size) || size < 0 || offset + size > buffer.length) {
      throw new Error("Publication audit received an invalid git object stream");
    }
    objects.set(objectId, { type, content: buffer.subarray(offset, offset + size) });
    offset += size + 1;
  }
  return objects;
}

function pngMetadataChunks(content) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (content.length < 8 || !content.subarray(0, 8).equals(signature)) {
    return ["invalid-signature"];
  }
  const findings = [];
  let offset = 8;
  while (offset + 12 <= content.length) {
    const size = content.readUInt32BE(offset);
    const type = content.subarray(offset + 4, offset + 8).toString("ascii");
    if (["tEXt", "zTXt", "iTXt", "eXIf"].includes(type)) {
      findings.push(type);
    }
    offset += 12 + size;
    if (type === "IEND") {
      break;
    }
  }
  return [...new Set(findings)].sort();
}

async function auditCurrentImages(paths) {
  const metadata = [];
  const unsafeSvg = [];
  let raster = 0;
  let vector = 0;
  for (const path of paths) {
    const extension = extname(path).toLowerCase();
    if (extension === ".png") {
      raster += 1;
      const content = await readFile(join(repositoryRoot, path));
      const chunks = pngMetadataChunks(content);
      if (chunks.length > 0) {
        metadata.push({ path, chunks });
      }
      continue;
    }
    if (extension === ".svg") {
      vector += 1;
      const content = await readFile(join(repositoryRoot, path), "utf8");
      const reasons = [];
      if (/<script\b/i.test(content)) {
        reasons.push("script");
      }
      if (/(?:href|src)=["'](?:https?:|data:)/i.test(content)) {
        reasons.push("external-resource");
      }
      if (reasons.length > 0) {
        unsafeSvg.push({ path, reasons });
      }
    }
  }
  return { total: paths.length, raster, vector, metadata, unsafeSvg };
}

function validateHistoryAllowlist(document) {
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.entries)) {
    throw new Error("History audit allowlist must use schema version 1");
  }
  const entries = new Map();
  for (const entry of document.entries) {
    const expected = ["blob", "classification", "path", "pattern", "reason", "reviewedFor"];
    if (!entry || typeof entry !== "object" || Object.keys(entry).sort().join("|") !== expected.join("|")) {
      throw new Error("History audit allowlist entry has unsupported fields");
    }
    if (!/^[a-f0-9]{40}$/.test(entry.blob) || !SEMVER.test(entry.reviewedFor)) {
      throw new Error("History audit allowlist entry has invalid version or blob identity");
    }
    const key = `${entry.pattern}\0${entry.blob}\0${entry.path}`;
    if (entries.has(key)) {
      throw new Error("History audit allowlist contains a duplicate entry");
    }
    entries.set(key, entry);
  }
  return entries;
}

function auditHistory(allowlist) {
  const objectLines = runGit(["rev-list", "--objects", "--all"]).trim().split("\n").filter(Boolean);
  const pathsByObject = new Map();
  let sensitivePathRecords = 0;
  for (const line of objectLines) {
    const separator = line.indexOf(" ");
    if (separator < 0) {
      continue;
    }
    const objectId = line.slice(0, separator);
    const path = line.slice(separator + 1);
    if (SENSITIVE_HISTORY_PATH.test(path)) {
      sensitivePathRecords += 1;
      continue;
    }
    if (!pathsByObject.has(objectId)) {
      pathsByObject.set(objectId, []);
    }
    pathsByObject.get(objectId).push(path);
  }
  const ids = [...pathsByObject.keys()];
  const batchInput = `${ids.join("\n")}\n`;
  const objects = parseBatchObjects(runGit(["cat-file", "--batch"], { input: batchInput, buffer: true }));
  const findings = [];
  const matchedAllowlist = new Set();
  let textBlobsScanned = 0;
  for (const [objectId, object] of objects) {
    if (object.type !== "blob" || object.content.length > 1024 * 1024 || object.content.includes(0)) {
      continue;
    }
    textBlobsScanned += 1;
    const content = object.content.toString("utf8");
    for (const [id, pattern] of CREDENTIAL_PATTERNS) {
      const match = pattern.exec(content);
      if (match) {
        const line = content.slice(0, match.index).split("\n").length;
        const paths = [...new Set(pathsByObject.get(objectId))].sort().slice(0, 5);
        const allowlistKey = paths
          .map((path) => `${id}\0${objectId}\0${path}`)
          .find((key) => allowlist.has(key));
        if (allowlistKey) {
          matchedAllowlist.add(allowlistKey);
        }
        findings.push({
          id,
          blob: objectId,
          line,
          matchedCharacters: match[0].length,
          paths,
          disposition: allowlistKey ? "acknowledged" : "block"
        });
      }
    }
  }
  const authors = runGit(["log", "--format=%aN%x00%aE", "--all"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\0"));
  const uniqueAuthors = new Map();
  for (const [name, email] of authors) {
    uniqueAuthors.set(`${name}\0${email}`, { name, addressKind: /@users\.noreply\.github\.com$/i.test(email) ? "noreply" : "direct" });
  }
  return {
    commits: Number.parseInt(runGit(["rev-list", "--count", "--all"]).trim(), 10),
    objectsWithPaths: pathsByObject.size,
    textBlobsScanned,
    sensitivePathRecords,
    credentialFindings: findings,
    unacknowledgedCredentialFindings: findings.filter((finding) => finding.disposition === "block").length,
    acknowledgedCredentialFindings: findings.filter((finding) => finding.disposition === "acknowledged").length,
    unusedAllowlistEntries: [...allowlist.keys()].filter((key) => !matchedAllowlist.has(key)).length,
    authors: [...uniqueAuthors.values()].sort((left, right) => left.name.localeCompare(right.name))
  };
}

export async function auditPublication() {
  const tracked = runGit(["ls-files"]).trim().split("\n").filter(Boolean);
  const images = tracked.filter((path) => /\.(?:png|svg)$/i.test(path)).sort();
  const allowlistDocument = await readJson(join(repositoryRoot, "security", "history-allowlist.json"), "history audit allowlist");
  const allowlist = validateHistoryAllowlist(allowlistDocument);
  const history = auditHistory(allowlist);
  const imageAudit = await auditCurrentImages(images);
  const blockers = [];
  if (history.sensitivePathRecords > 0) {
    blockers.push(`${history.sensitivePathRecords} sensitive-path records exist in Git history and were not read`);
  }
  if (history.unacknowledgedCredentialFindings > 0) {
    blockers.push(`${history.unacknowledgedCredentialFindings} unacknowledged credential-pattern findings exist in non-sensitive historical text blobs`);
  }
  if (history.unusedAllowlistEntries > 0) {
    blockers.push(`${history.unusedAllowlistEntries} history allowlist entries no longer match a finding`);
  }
  if (imageAudit.unsafeSvg.length > 0) {
    blockers.push(`${imageAudit.unsafeSvg.length} SVG files contain active or external resources`);
  }
  return {
    ok: blockers.length === 0,
    blockers,
    history,
    images: imageAudit,
    decisions: [
      "Git history is preserved for v1.0.0.",
      `${history.acknowledgedCredentialFindings} retired pre-v1 credential finding is documented without exposing its value.`,
      "Direct author email addresses remain part of preserved commit metadata.",
      "Tracked screenshots require a human visual review before the release tag."
    ]
  };
}

export async function checkRelease(tag) {
  const registry = await loadRegistry();
  const expectedTag = `v${registry.packVersion}`;
  const checkedTag = tag || expectedTag;
  const errors = [];
  if (checkedTag !== expectedTag) {
    errors.push(`Release tag must be ${expectedTag}`);
  }
  const changelog = await readFile(join(repositoryRoot, "CHANGELOG.md"), "utf8");
  const escapedVersion = registry.packVersion.replaceAll(".", "\\.");
  const datedHeading = new RegExp(`^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`, "m");
  if (!datedHeading.test(changelog)) {
    errors.push(`CHANGELOG.md must date the ${registry.packVersion} heading before tagging`);
  }
  const validation = await validatePack("all");
  if (!validation.ok) {
    errors.push("Repository validation is not passing");
  }
  const audit = await auditPublication();
  if (!audit.ok) {
    errors.push(...audit.blockers);
  }
  const built = await buildPackage(registry.packVersion);
  return {
    ok: errors.length === 0,
    tag: checkedTag,
    expectedTag,
    version: registry.packVersion,
    archive: { bytes: built.archive.length, files: built.releaseManifest.files.length, sha256: built.digest },
    errors
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function benchmarkCommand(name, args, runs) {
  const durations = [];
  for (let index = 0; index < runs; index += 1) {
    const started = process.hrtime.bigint();
    const result = spawnSync(process.execPath, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "", LANG: "C", LC_ALL: "C" }
    });
    const ended = process.hrtime.bigint();
    if (result.status !== 0) {
      throw new Error(`Benchmark command failed: ${name}`);
    }
    durations.push(Number(ended - started) / 1_000_000);
  }
  return {
    name,
    runs,
    medianMs: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    minimumMs: Number(Math.min(...durations).toFixed(2)),
    maximumMs: Number(Math.max(...durations).toFixed(2)),
    budgetP95Ms: BENCHMARK_P95_BUDGET_MS,
    status: percentile(durations, 0.95) <= BENCHMARK_P95_BUDGET_MS ? "pass" : "fail"
  };
}

export function benchmarkPack(runs = 30) {
  const selfhost = join(repositoryRoot, ".agents", "skills", "selfhost", "scripts", "selfhost.ts");
  const projectRoot = mkdtempSync(join(tmpdir(), "selfhost-benchmark-"));
  try {
    const results = [
      benchmarkCommand("catalog menu", [selfhost, "catalog", "menu", "--json"], runs),
      benchmarkCommand("plan photos", [selfhost, "plan", "photos", "--project-root", projectRoot, "--json"], runs),
      benchmarkCommand("plan backups", [selfhost, "plan", "backups", "--project-root", projectRoot, "--json"], runs)
    ];
    return {
      ok: results.every((result) => result.status === "pass"),
      runtime: "bun",
      bun: Bun.version,
      platform: `${process.platform}-${process.arch}`,
      p95BudgetMs: BENCHMARK_P95_BUDGET_MS,
      results
    };
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    if ((value & 1) === 1) {
      value = 0xedb88320 ^ (value >>> 1);
    } else {
      value >>>= 1;
    }
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const deflated = deflateRawSync(data, { level: 9 });
    let payload = data;
    let method = 0;
    if (deflated.length < data.length) {
      payload = deflated;
      method = 8;
    }
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function assertPackagedLinks(content, availablePaths, label, baseDirectory = "") {
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^(?:[a-z]+:|#)/i.test(target)) {
      continue;
    }
    const normalized = normalizePath(join(baseDirectory, target.replace(/^\.\//, "")));
    if (!availablePaths.has(normalized)) {
      throw new Error(`${label} links to missing packaged path ${normalized}`);
    }
  }
}

async function buildPackageEntries(version) {
  await assertNoSymlinkPath(skillsRoot, "Skills root");
  const skills = await discoverSkills();
  const registry = await loadRegistry();
  if (registry.packVersion !== version) {
    throw new Error(`Package version must equal registry packVersion ${registry.packVersion}`);
  }
  const entries = [];
  const manifestFiles = [];
  for (const skill of skills) {
    for (const file of skill.files) {
      const sourceRelative = normalizePath(relative(repositoryRoot, file.path));
      const skillRelative = normalizePath(relative(skill.root, file.path));
      if (/^scripts\/check-[^/]+\.ts$/.test(skillRelative)) {
        continue;
      }
      const destination = `skills/${skill.id}/${skillRelative}`;
      const data = await readFile(file.path);
      let mode = 0o100644;
      if ((file.details.mode & 0o111) !== 0) {
        mode = 0o100755;
      }
      entries.push({ name: destination, data, mode });
      manifestFiles.push({ source: sourceRelative, path: destination, sha256: sha256(data), size: data.length, mode: mode === 0o100755 ? "0755" : "0644" });
    }
  }
  const codexTemplate = await readPackageFile("packaging/codex-plugin.json", "Codex plugin template");
  const codex = JSON.parse(codexTemplate.data.toString("utf8"));
  const codexContent = Buffer.from(`${JSON.stringify(codex, null, 2)}\n`);
  entries.push({ name: ".codex-plugin/plugin.json", data: codexContent, mode: 0o100644 });
  manifestFiles.push({ source: "packaging/codex-plugin.json", path: ".codex-plugin/plugin.json", sha256: sha256(codexContent), size: codexContent.length, mode: "0644" });

  const claudeTemplate = await readPackageFile("packaging/claude-plugin.json", "Claude plugin template");
  const claude = JSON.parse(claudeTemplate.data.toString("utf8"));
  const claudeContent = Buffer.from(`${JSON.stringify(claude, null, 2)}\n`);
  entries.push({ name: ".claude-plugin/plugin.json", data: claudeContent, mode: 0o100644 });
  manifestFiles.push({ source: "packaging/claude-plugin.json", path: ".claude-plugin/plugin.json", sha256: sha256(claudeContent), size: claudeContent.length, mode: "0644" });

  const projectedFiles = new Map();
  for (const projection of PROJECTED_PUBLIC_FILES) {
    const source = await readPackageFile(projection.source, `Projected package file ${projection.source}`);
    entries.push({ name: projection.destination, data: source.data, mode: 0o100644 });
    manifestFiles.push({ source: projection.source, path: projection.destination, sha256: sha256(source.data), size: source.data.length, mode: "0644" });
    projectedFiles.set(projection.destination, source.data.toString("utf8"));
  }

  const releaseIndexes = renderIndexArtifacts(registry, skills, { skillsDirectory: "skills" });
  let releaseReadme = "";
  for (const fileName of PUBLIC_FILES) {
    const source = await readPackageFile(fileName, `Public package file ${fileName}`);
    let data = source.data;
    let provenance = fileName;
    if (fileName === "README.md") {
      releaseReadme = source.data.toString("utf8")
        .replaceAll(".agents/install.md", "INSTALL.md")
        .replaceAll(".agents/invocation.md", "INVOCATION.md")
        .replaceAll(".agents/CONTEXT.md", "CONTEXT.md")
        .replaceAll(".agents/skills/selfhost/references/catalog.md", "skills/selfhost/references/catalog.md");
      data = Buffer.from(releaseReadme);
      provenance = "generated:README.md";
    }
    if (Object.hasOwn(releaseIndexes, fileName)) {
      data = Buffer.from(releaseIndexes[fileName]);
      provenance = `generated:${fileName}`;
    }
    let mode = 0o100644;
    if ((source.details.mode & 0o111) !== 0) {
      mode = 0o100755;
    }
    entries.push({ name: fileName, data, mode });
    manifestFiles.push({ source: provenance, path: fileName, sha256: sha256(data), size: data.length, mode: mode === 0o100755 ? "0755" : "0644" });
  }
  const availablePaths = new Set(entries.map((entry) => entry.name));
  assertPackagedLinks(releaseIndexes["SKILL_INDEX.md"], availablePaths, "Packaged SKILL_INDEX.md");
  assertPackagedLinks(releaseIndexes["llms.txt"], availablePaths, "Packaged llms.txt");
  assertPackagedLinks(releaseReadme, availablePaths, "Packaged README.md");
  assertPackagedLinks(projectedFiles.get("INVOCATION.md"), availablePaths, "Packaged INVOCATION.md");
  const mediaGuide = entries.find((entry) => entry.name === "docs/README.md");
  assertPackagedLinks(mediaGuide.data.toString("utf8"), availablePaths, "Packaged docs/README.md", "docs");
  entries.sort((left, right) => left.name.localeCompare(right.name));
  manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
  const releaseManifest = {
    schemaVersion: 1,
    name: "selfhost-skills",
    version,
    files: manifestFiles
  };
  const manifestContent = Buffer.from(`${JSON.stringify(releaseManifest, null, 2)}\n`);
  entries.push({ name: "RELEASE-MANIFEST.json", data: manifestContent, mode: 0o100644 });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return { entries, releaseManifest, manifestContent };
}

export async function buildPackage(version) {
  if (!SEMVER.test(version)) {
    throw new Error("Package version must use strict semantic versioning");
  }
  const built = await buildPackageEntries(version);
  const first = zipBuffer(built.entries);
  const second = zipBuffer(built.entries);
  if (!first.equals(second)) {
    throw new Error("Package build is not reproducible");
  }
  if (first.length > PACKAGE_SIZE_BUDGET) {
    throw new Error(`Package exceeds ${PACKAGE_SIZE_BUDGET} bytes`);
  }
  return {
    archive: first,
    digest: sha256(first),
    releaseManifest: built.releaseManifest,
    manifestContent: built.manifestContent
  };
}

export async function writePackage(version, outputDirectory) {
  if (!outputDirectory) {
    throw new Error("Package output directory is required");
  }
  const resolvedOutput = resolve(repositoryRoot, outputDirectory);
  if (!isRepositoryChild(resolvedOutput)) {
    throw new Error("Package output must be a repository subdirectory");
  }
  let existingAncestor = resolvedOutput;
  while (!existsSync(existingAncestor)) {
    existingAncestor = dirname(existingAncestor);
  }
  await assertNoSymlinkPath(existingAncestor, "Package output ancestor");
  if (existsSync(resolvedOutput)) {
    const outputDetails = await lstat(resolvedOutput);
    if (outputDetails.isSymbolicLink() || !outputDetails.isDirectory()) {
      throw new Error("Package output must be a regular directory, not a symlink");
    }
    await assertNoSymlinkPath(resolvedOutput, "Package output directory");
    const existing = await readdir(resolvedOutput);
    if (existing.length > 0) {
      throw new Error("Package output directory must not already contain files");
    }
  } else {
    await mkdir(resolvedOutput, { recursive: true });
    await assertNoSymlinkPath(resolvedOutput, "Package output directory");
  }
  const built = await buildPackage(version);
  const archiveName = `selfhost-skills-${version}.zip`;
  await writeFile(join(resolvedOutput, archiveName), built.archive);
  await writeFile(join(resolvedOutput, "RELEASE-MANIFEST.json"), built.manifestContent);
  await writeFile(join(resolvedOutput, "SHA256SUMS"), `${built.digest}  ${archiveName}\n`, "utf8");
  return {
    archive: normalizePath(relative(repositoryRoot, join(resolvedOutput, archiveName))),
    bytes: built.archive.length,
    sha256: built.digest,
    files: built.releaseManifest.files.length
  };
}

export function envelope(command, status, data, options = {}) {
  let mutation = false;
  if (options.mutation === true) {
    mutation = true;
  }
  return {
    schemaVersion: 1,
    status,
    command,
    mutation,
    data,
    decisions: options.decisions || [],
    limitations: options.limitations || [],
    summary: options.summary || ""
  };
}

export function formatError(error) {
  return safeMessage(error instanceof Error ? error.message : error);
}
