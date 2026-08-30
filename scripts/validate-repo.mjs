#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_ROOT = join(REPOSITORY_ROOT, ".agents", "skills");
const HOMARR_IMAGE = "ghcr.io/homarr-labs/homarr-test:v2";
const MEDIA_SKILL_ROOT = join(SKILLS_ROOT, "selfhost-media");
const MEDIA_BUNDLE_ROOT = join(MEDIA_SKILL_ROOT, "assets", "harness");
const MEDIA_BUNDLE_MANIFEST = join(MEDIA_BUNDLE_ROOT, "bundle-manifest.json");
const SKILL_REGISTRY_PATH = join(
  SKILLS_ROOT,
  "selfhost",
  "references",
  "catalog",
  "skills.json",
);
const SKILL_REGISTRY_SCHEMA_PATH = join(
  SKILLS_ROOT,
  "selfhost",
  "references",
  "catalog",
  "schemas",
  "skills.schema.json",
);
const ROOT_TOOLING_OUTSIDE_MEDIA_BUNDLE = new Set([
  "docs/images/selfhost-architecture.svg",
  "docs/images/selfhost-flow.svg",
  "scripts/refresh-media-bundle.mjs",
  "scripts/smoke-install.sh",
  "scripts/validate-repo.mjs",
]);
const GLOBAL_COPY_INSTALL_COMMAND =
  "npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --global --copy --yes";
const DOCUMENTATION_CONTRACTS = [
  {
    path: "README.md",
    required: [
      ["global copy install command", GLOBAL_COPY_INSTALL_COMMAND],
      [
        "private install command",
        "npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --yes",
      ],
      [
        "broad all-agents warning",
        "`--all` is deliberately broader: it selects every skill for every agent target",
      ],
      ["private list command", "npx skills@latest add ajnart/selfhost-skills --list"],
      [
        "install prerequisite",
        "Before running it, install Git and Node.js 22.20.0 or newer",
      ],
      ["smoke Node floor", "The smoke check requires Node.js 22.20.0 or newer."],
      ["selective skill flag", "--skill"],
      ["selective agent flag", "--agent"],
      ["copy-mode flag", "--copy"],
      ["preferences path", ".selfhost/preferences.json"],
      [
        "skill registry path",
        ".agents/skills/selfhost/references/catalog/skills.json",
      ],
      ["repository validation command", "node scripts/validate-repo.mjs"],
      ["JSON validation command", "node scripts/validate-repo.mjs --json"],
      ["installer smoke command", "bash scripts/smoke-install.sh"],
      ["Homarr image", HOMARR_IMAGE],
      ["default read-only Homarr fragment", "default client fragment remains strictly read-only"],
      [
        "no mutation-capable Homarr bridge",
        "The pack does not provide a mutation-capable Homarr client fragment or bridge.",
      ],
      [
        "blocked Homarr mutation tools",
        "`integration_requestMedia`, `app_update`, `mediaRequests_answerRequest`",
      ],
    ],
  },
  {
    path: ".agents/install.md",
    required: [
      ["global copy install command", GLOBAL_COPY_INSTALL_COMMAND],
      [
        "targeted agent install command",
        "npx skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --yes",
      ],
      [
        "all-agents fan-out warning",
        "The CLI's `--all` flag is intentionally broader",
      ],
    ],
  },
  {
    path: "CONTRIBUTING.md",
    required: [
      [
        "catalog validation command",
        "node .agents/skills/selfhost/scripts/selfhost.mjs catalog validate --json",
      ],
      ["repository validation command", "node scripts/validate-repo.mjs"],
      [
        "skill initializer command",
        "python3 /path/to/skill-creator/scripts/init_skill.py selfhost-example",
      ],
      ["skill initializer path", "--path .agents/skills"],
      ["skill initializer resources", "--resources scripts,references,assets"],
      [
        "skill registry path",
        ".agents/skills/selfhost/references/catalog/skills.json",
      ],
      ["skill registry schema path", "schemas/skills.schema.json"],
      ["installer smoke path", "scripts/smoke-install.sh"],
      ["installer Node floor", "Node.js 22.20.0"],
      ["Homarr image", HOMARR_IMAGE],
    ],
  },
];

const STANDARD_FRONTMATTER_KEYS = new Set([
  "allowed-tools",
  "compatibility",
  "description",
  "license",
  "metadata",
  "name",
]);
const FORBIDDEN_SKILL_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".selfhost",
  ".sessions",
  "__pycache__",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "evidence",
  "node_modules",
  "screenshots",
  "temp",
  "tmp",
]);
const SOURCE_EXCLUDED_ROOTS = new Set([
  ".claude",
  ".codex",
  ".cursor",
  ".gemini",
  ".git",
  ".install-tmp",
  ".opencode",
  ".selfhost",
  ".sessions",
  ".tmp",
  "artifacts",
  "config",
  "coverage",
  "data",
  "evidence",
  "node_modules",
  "screenshots",
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".txt",
  ".yaml",
  ".yml",
]);
const FORBIDDEN_REUSABLE_CREDENTIAL = ["Pass", "word", "1!"].join("");
const FORBIDDEN_CREDENTIAL_IDENTIFIERS = [
  ["STANDARD", "PASSWORD"].join("_"),
  ["SHARED", "PASSWORD"].join("_"),
  ["DEFAULT", "PASSWORD"].join("_"),
];
const LITERAL_CREDENTIAL_ASSIGNMENT =
  /["']?(?:password|passwordConfirmation|web_ui_password)["']?\s*[:=]\s*["'][^"'\r\n]+["']/i;
const LOCAL_LINK_EXTENSIONS = new Set([
  ".cjs",
  ".gif",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".png",
  ".sh",
  ".svg",
  ".txt",
  ".webp",
  ".yaml",
  ".yml",
]);
const SAFE_CHILD_ENV = {
  LANG: "C",
  LC_ALL: "C",
  PATH: process.env.PATH || "/usr/bin:/bin",
  TZ: "UTC",
};

class ValidationError extends Error {
  constructor(messages) {
    super(messages.join("; "));
    this.messages = messages;
  }
}

function fail(message) {
  throw new ValidationError([message]);
}

function failMany(messages) {
  if (messages.length > 0) {
    throw new ValidationError(messages);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((key, index) => key === expected[index]);
}

function repositoryPath(filePath) {
  const value = relative(REPOSITORY_ROOT, filePath).split(sep).join("/");
  if (value.length === 0) {
    return ".";
  }
  return value;
}

function safeMessage(value) {
  let message = String(value);
  message = message.split(REPOSITORY_ROOT).join(".");
  message = message.replace(/[\u0000-\u001f\u007f]+/g, " ");
  message = message.replace(/\s+/g, " ").trim();
  if (message.length > 600) {
    message = `${message.slice(0, 597)}...`;
  }
  return message;
}

async function statRegularFile(filePath, label) {
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(`${label}: missing ${repositoryPath(filePath)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label}: expected a regular non-symlink file at ${repositoryPath(filePath)}`);
  }
  return stat;
}

async function discoverSkillRoots() {
  let entries;
  try {
    entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  } catch {
    fail("skills: .agents/skills is missing or unreadable");
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    fail("skills: no skill directories found");
  }

  const errors = [];
  const roots = [];
  for (const entry of entries) {
    const entryPath = join(SKILLS_ROOT, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      errors.push(`skills: unexpected direct entry ${repositoryPath(entryPath)}`);
      continue;
    }
    roots.push({ name: entry.name, root: entryPath });
  }
  failMany(errors);
  return roots;
}

async function walkTree(rootPath) {
  const files = [];
  const directories = [];
  const symlinks = [];

  async function visit(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = join(directoryPath, entry.name);
      const stat = await lstat(entryPath);
      if (stat.isSymbolicLink()) {
        symlinks.push(entryPath);
        continue;
      }
      if (stat.isDirectory()) {
        directories.push(entryPath);
        await visit(entryPath);
        continue;
      }
      if (stat.isFile()) {
        files.push(entryPath);
        continue;
      }
      symlinks.push(entryPath);
    }
  }

  await visit(rootPath);
  return { directories, files, symlinks };
}

function parseYamlScalar(rawValue, label) {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      fail(`${label}: invalid quoted YAML scalar`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      fail(`${label}: invalid quoted YAML scalar`);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value.replace(/\s+#.*$/, "").trim();
}

function parseFrontmatter(markdown, label) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    fail(`${label}: missing opening frontmatter delimiter`);
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    fail(`${label}: missing closing frontmatter delimiter`);
  }

  const lines = normalized.slice(4, end).split("\n");
  const values = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    if (/^\s/.test(line)) {
      continue;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*):(?:\s*(.*))?$/);
    if (!match) {
      fail(`${label}: invalid top-level frontmatter entry`);
    }
    const key = match[1];
    if (values.has(key)) {
      fail(`${label}: duplicate frontmatter key ${key}`);
    }
    let rawValue = match[2] || "";
    if (/^[>|][+-]?$/.test(rawValue)) {
      const folded = rawValue.startsWith(">");
      const parts = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        parts.push(lines[index].trim());
      }
      rawValue = parts.join(folded ? " " : "\n");
    }
    values.set(key, parseYamlScalar(rawValue, `${label}: ${key}`));
  }
  return values;
}

function parseOpenAiInterface(yaml, label) {
  if (yaml.includes("\t")) {
    fail(`${label}: tabs are not allowed`);
  }
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  let interfaceLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "interface:") {
      interfaceLine = index;
      break;
    }
  }
  if (interfaceLine === -1) {
    fail(`${label}: interface mapping is missing`);
  }

  const values = new Map();
  for (let index = interfaceLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    if (!line.startsWith(" ")) {
      break;
    }
    const match = line.match(/^  ([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (!match) {
      continue;
    }
    if (values.has(match[1])) {
      fail(`${label}: duplicate interface field ${match[1]}`);
    }
    const rawValue = match[2].trim();
    const quoted = rawValue.startsWith('"') || rawValue.startsWith("'");
    if (!quoted) {
      fail(`${label}: interface string ${match[1]} must be quoted`);
    }
    values.set(match[1], parseYamlScalar(rawValue, `${label}: ${match[1]}`));
  }
  return values;
}

async function validateSkillMetadata() {
  const skills = await discoverSkillRoots();
  const errors = [];

  for (const skill of skills) {
    const skillPath = join(skill.root, "SKILL.md");
    const openAiPath = join(skill.root, "agents", "openai.yaml");
    try {
      await statRegularFile(skillPath, `skill ${skill.name}`);
      const markdown = await readFile(skillPath, "utf8");
      const frontmatter = parseFrontmatter(markdown, `skill ${skill.name}`);
      for (const key of frontmatter.keys()) {
        if (!STANDARD_FRONTMATTER_KEYS.has(key)) {
          fail(`skill ${skill.name}: non-standard frontmatter key ${key}`);
        }
      }
      const name = frontmatter.get("name");
      const description = frontmatter.get("description");
      if (name !== skill.name) {
        fail(`skill ${skill.name}: frontmatter name must match its directory`);
      }
      if (
        typeof name !== "string"
        || name.length < 1
        || name.length > 64
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
      ) {
        fail(`skill ${skill.name}: name must be 1-64 lowercase hyphenated characters`);
      }
      if (
        typeof description !== "string"
        || description.trim().length < 1
        || description.length > 1024
      ) {
        fail(`skill ${skill.name}: description must be 1-1024 characters`);
      }

      await statRegularFile(openAiPath, `skill ${skill.name} OpenAI metadata`);
      const yaml = await readFile(openAiPath, "utf8");
      const interfaceValues = parseOpenAiInterface(
        yaml,
        `skill ${skill.name} agents/openai.yaml`,
      );
      const displayName = interfaceValues.get("display_name");
      const shortDescription = interfaceValues.get("short_description");
      const defaultPrompt = interfaceValues.get("default_prompt");
      if (
        typeof displayName !== "string"
        || displayName.trim().length === 0
        || displayName.length > 64
      ) {
        fail(`skill ${skill.name}: display_name must be 1-64 characters`);
      }
      if (
        typeof shortDescription !== "string"
        || shortDescription.length < 25
        || shortDescription.length > 64
      ) {
        fail(`skill ${skill.name}: short_description must be 25-64 characters`);
      }
      if (
        typeof defaultPrompt !== "string"
        || !defaultPrompt.includes(`$${skill.name}`)
      ) {
        fail(`skill ${skill.name}: default_prompt must mention $${skill.name}`);
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        errors.push(...error.messages);
        continue;
      }
      errors.push(`skill ${skill.name}: metadata could not be validated`);
    }
  }

  failMany(errors);
  return `${skills.length} skill packages`;
}

function isForbiddenRuntimeFile(filePath) {
  const name = filePath.split(sep).at(-1).toLowerCase();
  if (name === ".ds_store" || name === ".env" || name === "secrets.env") {
    return true;
  }
  if (name.startsWith(".env.") || name.startsWith("secrets.")) {
    return true;
  }
  if (
    name === "cookies.json"
    || name === "mcp-client.json"
    || name === "session.json"
    || name === "storage-state.json"
  ) {
    return true;
  }
  return /(?:\.db|\.key|\.log|\.pem|\.pfx|\.p12|\.pid|\.secret|\.sock|\.sqlite|\.sqlite3|\.swp|\.pyc|~)$/.test(
    name,
  );
}

async function validateSkillTrees() {
  const skills = await discoverSkillRoots();
  const errors = [];
  let fileCount = 0;

  for (const skill of skills) {
    let tree;
    try {
      tree = await walkTree(skill.root);
    } catch {
      errors.push(`skill ${skill.name}: tree is unreadable`);
      continue;
    }
    for (const linkPath of tree.symlinks) {
      errors.push(`skill ${skill.name}: symlink or special entry ${repositoryPath(linkPath)}`);
    }
    for (const directoryPath of tree.directories) {
      const name = directoryPath.split(sep).at(-1).toLowerCase();
      if (FORBIDDEN_SKILL_DIRECTORIES.has(name)) {
        errors.push(`skill ${skill.name}: forbidden generated directory ${repositoryPath(directoryPath)}`);
      }
    }
    for (const filePath of tree.files) {
      fileCount += 1;
      if (isForbiddenRuntimeFile(filePath)) {
        errors.push(`skill ${skill.name}: unexpected secret or runtime file ${repositoryPath(filePath)}`);
        continue;
      }
      if (!TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())) {
        continue;
      }
      try {
        const content = await readFile(filePath, "utf8");
        if (content.includes("/home/")) {
          errors.push(`skill ${skill.name}: hardcoded home path in ${repositoryPath(filePath)}`);
        }
      } catch {
        errors.push(`skill ${skill.name}: text asset is unreadable at ${repositoryPath(filePath)}`);
      }
    }
  }

  failMany(errors);
  return `${fileCount} skill files, no runtime material`;
}

async function collectSourceFiles() {
  const files = [];

  async function visit(directoryPath, relativeDirectory) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      let relativePath = entry.name;
      if (relativeDirectory.length > 0) {
        relativePath = `${relativeDirectory}/${entry.name}`;
      }
      if (
        relativeDirectory.length === 0
        && SOURCE_EXCLUDED_ROOTS.has(entry.name)
      ) {
        continue;
      }
      const entryPath = join(directoryPath, entry.name);
      const stat = await lstat(entryPath);
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        await visit(entryPath, relativePath);
        continue;
      }
      if (stat.isFile()) {
        files.push(entryPath);
      }
    }
  }

  await visit(REPOSITORY_ROOT, "");
  return files;
}

async function validateCredentialHygiene() {
  const sourceFiles = await collectSourceFiles();
  let scannedFiles = 0;
  for (const filePath of sourceFiles) {
    if (!TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      continue;
    }
    scannedFiles += 1;
    const content = await readFile(filePath, "utf8");
    if (content.includes(FORBIDDEN_REUSABLE_CREDENTIAL)) {
      fail("credential hygiene: forbidden reusable credential detected");
    }
    if (FORBIDDEN_CREDENTIAL_IDENTIFIERS.some((name) => content.includes(name))) {
      fail("credential hygiene: fixed credential assignment detected");
    }
    if (LITERAL_CREDENTIAL_ASSIGNMENT.test(content)) {
      fail("credential hygiene: literal credential assignment detected");
    }
  }
  return `${scannedFiles} repository text files contain no fixed credentials`;
}

function isInside(boundary, target) {
  const relation = relative(boundary, target);
  if (relation.length === 0) {
    return true;
  }
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    return false;
  }
  return true;
}

function normalizeMarkdownTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const closing = target.indexOf(">");
    if (closing === -1) {
      return "";
    }
    target = target.slice(1, closing);
  } else {
    const match = target.match(/^(\S+)/);
    if (!match) {
      return "";
    }
    target = match[1];
  }
  if (
    target.length === 0
    || target.startsWith("#")
    || /^(?:data|https?|mailto):/i.test(target)
    || target.startsWith("/")
  ) {
    return "";
  }
  target = target.split("#", 1)[0].split("?", 1)[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    return "";
  }
  return target;
}

function isReliablyLocalTarget(target) {
  if (target.startsWith("./") || target.startsWith("../")) {
    return true;
  }
  if (LOCAL_LINK_EXTENSIONS.has(extname(target).toLowerCase())) {
    return true;
  }
  return false;
}

function skillBoundaryFor(filePath, skills) {
  for (const skill of skills) {
    if (isInside(skill.root, filePath)) {
      return skill.root;
    }
  }
  return REPOSITORY_ROOT;
}

async function validateMarkdownReferences() {
  const sourceFiles = await collectSourceFiles();
  const skills = await discoverSkillRoots();
  const markdownFiles = sourceFiles.filter((filePath) => extname(filePath) === ".md");
  const errors = [];
  let checked = 0;

  for (const markdownPath of markdownFiles) {
    let markdown;
    try {
      markdown = await readFile(markdownPath, "utf8");
    } catch {
      errors.push(`references: unreadable Markdown ${repositoryPath(markdownPath)}`);
      continue;
    }
    const boundary = skillBoundaryFor(markdownPath, skills);
    const linkPattern = /!?\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g;
    for (const match of markdown.matchAll(linkPattern)) {
      const target = normalizeMarkdownTarget(match[1]);
      if (!isReliablyLocalTarget(target)) {
        continue;
      }
      checked += 1;
      const resolvedTarget = resolve(dirname(markdownPath), target);
      if (!isInside(boundary, resolvedTarget)) {
        errors.push(`references: ${repositoryPath(markdownPath)} escapes its install boundary`);
        continue;
      }
      try {
        await lstat(resolvedTarget);
      } catch {
        errors.push(
          `references: ${repositoryPath(markdownPath)} points to missing ${repositoryPath(resolvedTarget)}`,
        );
      }
    }

    if (markdownPath.split(sep).at(-1) !== "SKILL.md") {
      continue;
    }
    const skill = skills.find((candidate) => candidate.root === boundary);
    if (!skill) {
      continue;
    }
    const codeSpanPattern = /`([^`\r\n]+)`/g;
    for (const match of markdown.matchAll(codeSpanPattern)) {
      let candidate = match[1].trim();
      const skillPrefix = "<skill-directory>/";
      const mediaPrefix = "$MEDIA_SKILL_ROOT/";
      if (candidate.startsWith(skillPrefix)) {
        candidate = candidate.slice(skillPrefix.length);
      } else if (candidate.startsWith(mediaPrefix)) {
        candidate = candidate.slice(mediaPrefix.length);
      }
      if (!/^(?:assets|references|scripts)\/[A-Za-z0-9._/-]+$/.test(candidate)) {
        continue;
      }
      checked += 1;
      const targetPath = resolve(skill.root, candidate);
      if (!isInside(skill.root, targetPath)) {
        errors.push(`references: skill ${skill.name} contains an escaping code path`);
        continue;
      }
      try {
        await lstat(targetPath);
      } catch {
        errors.push(`references: skill ${skill.name} points to missing ${candidate}`);
      }
    }
  }

  failMany(errors);
  return `${checked} local Markdown and script references`;
}

async function validateJsonFiles() {
  const sourceFiles = await collectSourceFiles();
  const jsonFiles = sourceFiles.filter((filePath) => extname(filePath) === ".json");
  const errors = [];
  for (const filePath of jsonFiles) {
    try {
      JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      errors.push(`json: invalid ${repositoryPath(filePath)}`);
    }
  }
  failMany(errors);
  return `${jsonFiles.length} JSON files parsed`;
}

async function validateDocumentationContracts() {
  const errors = [];
  let checked = 0;

  for (const contract of DOCUMENTATION_CONTRACTS) {
    const filePath = join(REPOSITORY_ROOT, ...contract.path.split("/"));
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      errors.push(`documentation: missing ${contract.path}`);
      continue;
    }
    for (const [label, snippet] of contract.required) {
      checked += 1;
      if (!content.includes(snippet)) {
        errors.push(`documentation: ${contract.path} is missing ${label}`);
      }
    }
  }

  failMany(errors);
  return `${checked} essential commands, flags, and paths`;
}

function runLocal(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: SAFE_CHILD_ENV,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return { ok: false, output: "", status: null };
  }
  return {
    ok: result.status === 0,
    output: result.stdout || "",
    status: result.status,
  };
}

async function validateCatalogSemantics() {
  const validatorPath = join(
    SKILLS_ROOT,
    "selfhost",
    "scripts",
    "catalog.mjs",
  );
  await statRegularFile(validatorPath, "catalog semantic validator");
  let catalogModule;
  try {
    catalogModule = await import(pathToFileURL(validatorPath).href);
  } catch {
    fail("catalog: semantic validator could not be loaded");
  }
  const catalog = await catalogModule.loadCatalog();
  const validation = catalogModule.validateCatalog(catalog);
  if (!validation || validation.valid !== true) {
    fail("catalog: semantic validator returned a non-pass result");
  }
  const counts = validation.counts || {};
  return `${counts.apps || 0} apps, ${counts.stacks || 0} stacks`;
}

async function loadStrictSkillRegistry() {
  const skills = await discoverSkillRoots();
  const available = new Set(skills.map((skill) => skill.name));
  const errors = [];
  let registry;
  let schema;

  try {
    registry = JSON.parse(await readFile(SKILL_REGISTRY_PATH, "utf8"));
  } catch {
    fail("skill registry: skills.json is missing or invalid");
  }
  try {
    schema = JSON.parse(await readFile(SKILL_REGISTRY_SCHEMA_PATH, "utf8"));
  } catch {
    fail("skill registry: skills.schema.json is missing or invalid");
  }
  const schemaProperties = isPlainObject(schema) && schema.properties;
  const schemaVersion = isPlainObject(schemaProperties) && schemaProperties.schemaVersion;
  const schemaSkills = isPlainObject(schemaProperties) && schemaProperties.skills;
  const schemaItems = isPlainObject(schemaSkills) && schemaSkills.items;
  const schemaItemProperties = isPlainObject(schemaItems) && schemaItems.properties;
  const schemaId = isPlainObject(schemaItemProperties) && schemaItemProperties.id;
  const schemaAdapter = isPlainObject(schemaItemProperties) && schemaItemProperties.adapter;
  const schemaScope = isPlainObject(schemaItemProperties) && schemaItemProperties.scope;
  if (
    !isPlainObject(schema)
    || schema.type !== "object"
    || schema.additionalProperties !== false
    || !Array.isArray(schema.required)
    || schema.required.length !== 2
    || !schema.required.includes("schemaVersion")
    || !schema.required.includes("skills")
    || !isPlainObject(schemaVersion)
    || schemaVersion.const !== 2
    || !isPlainObject(schemaSkills)
    || schemaSkills.type !== "array"
    || schemaSkills.minItems !== 1
    || schemaSkills.uniqueItems !== true
    || !isPlainObject(schemaItems)
    || schemaItems.type !== "object"
    || schemaItems.additionalProperties !== false
    || !Array.isArray(schemaItems.required)
    || schemaItems.required.length !== 3
    || !schemaItems.required.includes("id")
    || !schemaItems.required.includes("adapter")
    || !schemaItems.required.includes("scope")
    || !hasExactKeys(schemaItemProperties, ["adapter", "id", "scope"])
    || !isPlainObject(schemaId)
    || schemaId.type !== "string"
    || schemaId.pattern !== "^selfhost(?:-[a-z0-9]+)*$"
    || !isPlainObject(schemaAdapter)
    || schemaAdapter.type !== "boolean"
    || !isPlainObject(schemaScope)
    || !Array.isArray(schemaScope.enum)
    || JSON.stringify(schemaScope.enum) !== JSON.stringify(["application", "stack", null])
  ) {
    fail("skill registry: skills.schema.json contract is invalid");
  }
  if (!hasExactKeys(registry, ["schemaVersion", "skills"])) {
    fail("skill registry: root contains missing or unsupported fields");
  }
  if (registry.schemaVersion !== 2) {
    errors.push("skill registry: schemaVersion must be 2");
  }
  if (!Array.isArray(registry.skills) || registry.skills.length === 0) {
    errors.push("skill registry: skills must be a non-empty array");
    failMany(errors);
  }

  const ids = new Set();
  const adapters = new Set();
  const applicationAdapters = new Set();
  const stackAdapters = new Set();
  let previousId = "";
  for (let index = 0; index < registry.skills.length; index += 1) {
    const record = registry.skills[index];
    const label = `record ${index + 1}`;
    if (!hasExactKeys(record, ["adapter", "id", "scope"])) {
      errors.push(`skill registry: ${label} contains missing or unsupported fields`);
      continue;
    }
    if (
      typeof record.id !== "string"
      || !/^selfhost(?:-[a-z0-9]+)*$/.test(record.id)
    ) {
      errors.push(`skill registry: ${label} has an invalid id`);
      continue;
    }
    if (ids.has(record.id)) {
      errors.push(`skill registry: duplicate id ${record.id}`);
    }
    if (previousId.length > 0 && record.id <= previousId) {
      errors.push("skill registry: ids must be unique and sorted");
    }
    previousId = record.id;
    ids.add(record.id);

    if (typeof record.adapter !== "boolean") {
      errors.push(`skill registry: ${record.id} adapter must be boolean`);
      continue;
    }
    if (record.adapter) {
      adapters.add(record.id);
      if (record.scope !== "application" && record.scope !== "stack") {
        errors.push(`skill registry: ${record.id} adapter scope must be application or stack`);
        continue;
      }
      if (record.scope === "application") {
        applicationAdapters.add(record.id);
      }
      if (record.scope === "stack") {
        stackAdapters.add(record.id);
      }
      continue;
    }
    if (record.scope !== null) {
      errors.push(`skill registry: ${record.id} non-adapter scope must be null`);
    }
  }
  if (adapters.size === 0) {
    errors.push("skill registry: at least one adapter is required");
  }

  for (const skillName of [...available].sort()) {
    if (!ids.has(skillName)) {
      errors.push(`skill registry: packaged skill is undeclared ${skillName}`);
    }
  }
  for (const skillName of [...ids].sort()) {
    if (!available.has(skillName)) {
      errors.push(`skill registry: declared skill package is missing ${skillName}`);
    }
  }

  failMany(errors);
  return { adapters, applicationAdapters, available, ids, stackAdapters };
}

async function validateSkillRegistry() {
  const registry = await loadStrictSkillRegistry();
  const readmePath = join(REPOSITORY_ROOT, "README.md");
  let readme;
  try {
    readme = await readFile(readmePath, "utf8");
  } catch {
    fail("skill registry: README.md is missing");
  }
  const countContract = `${registry.ids.size} packaged skills, including ${registry.adapters.size} specialized adapters`;
  if (!readme.includes(countContract)) {
    fail("skill registry: README package and adapter counts are stale");
  }
  return `${registry.ids.size} packages, ${registry.adapters.size} adapters, exact directory match`;
}

async function validateCatalogSkillReferences() {
  const registry = await loadStrictSkillRegistry();
  const required = new Set();
  const adapterReferences = new Set();
  const errors = [];
  const goalsPath = join(
    SKILLS_ROOT,
    "selfhost",
    "references",
    "catalog",
    "stacks",
    "goals.json",
  );
  let goals;
  try {
    goals = JSON.parse(await readFile(goalsPath, "utf8"));
  } catch {
    fail("catalog skills: goals.json is missing or invalid");
  }
  if (!Array.isArray(goals)) {
    fail("catalog skills: goals.json root must be an array");
  }
  for (const stack of goals) {
    if (!stack || !Array.isArray(stack.requiredSkills)) {
      continue;
    }
    for (const skillName of stack.requiredSkills) {
      if (typeof skillName === "string") {
        required.add(skillName);
        if (registry.adapters.has(skillName)) {
          errors.push(`catalog skills: specialized adapter cannot be an implicit required skill ${skillName}`);
        }
      }
    }
  }

  const appsDirectory = join(
    SKILLS_ROOT,
    "selfhost",
    "references",
    "catalog",
    "apps",
  );
  const appFiles = (await readdir(appsDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of appFiles) {
    let records;
    try {
      records = JSON.parse(await readFile(join(appsDirectory, name), "utf8"));
    } catch {
      fail(`catalog skills: invalid apps file ${name}`);
    }
    if (!Array.isArray(records)) {
      continue;
    }
    for (const record of records) {
      const support = record && record.support;
      if (
        support
        && support.automation === "managed"
        && typeof support.adapterSkill === "string"
      ) {
        required.add(support.adapterSkill);
        adapterReferences.add(support.adapterSkill);
      }
    }
  }

  for (const skillName of [...required].sort()) {
    if (!registry.ids.has(skillName)) {
      errors.push(`catalog skills: undeclared required skill ${skillName}`);
      continue;
    }
    if (!registry.available.has(skillName)) {
      errors.push(`catalog skills: required skill package is missing ${skillName}`);
    }
  }
  for (const skillName of [...adapterReferences].sort()) {
    if (!registry.applicationAdapters.has(skillName)) {
      errors.push(`catalog skills: managed adapter is not registered as an application adapter ${skillName}`);
    }
  }
  for (const skillName of [...registry.applicationAdapters].sort()) {
    if (!adapterReferences.has(skillName)) {
      errors.push(`catalog skills: registered application adapter has no managed catalog reference ${skillName}`);
    }
  }
  failMany(errors);
  return `${required.size} required skill references`;
}

function extractComposeImage(compose, serviceName) {
  const lines = compose.replace(/\r\n/g, "\n").split("\n");
  let inServices = false;
  let currentService = "";
  for (const line of lines) {
    if (line === "services:") {
      inServices = true;
      continue;
    }
    if (inServices && /^[A-Za-z]/.test(line)) {
      inServices = false;
      currentService = "";
    }
    if (!inServices) {
      continue;
    }
    const serviceMatch = line.match(/^  ([a-z0-9_-]+):\s*$/);
    if (serviceMatch) {
      currentService = serviceMatch[1];
      continue;
    }
    if (currentService !== serviceName) {
      continue;
    }
    const imageMatch = line.match(/^    image:\s*([^\s#]+)\s*$/);
    if (imageMatch) {
      return imageMatch[1];
    }
  }
  return "";
}

async function validateHomarrImage() {
  const rootCompose = await readFile(
    join(REPOSITORY_ROOT, "docker-compose.yml"),
    "utf8",
  );
  if (extractComposeImage(rootCompose, "homarr") !== HOMARR_IMAGE) {
    fail("homarr image: root Compose contract changed");
  }

  const operationsPath = join(
    SKILLS_ROOT,
    "selfhost",
    "references",
    "catalog",
    "apps",
    "operations.json",
  );
  let operations;
  try {
    operations = JSON.parse(await readFile(operationsPath, "utf8"));
  } catch {
    fail("homarr image: operations catalog is missing or invalid");
  }
  const homarr = operations.find((record) => record && record.id === "homarr");
  if (!homarr || !homarr.image || homarr.image.reference !== HOMARR_IMAGE) {
    fail("homarr image: catalog contract changed");
  }

  const bundleCompose = await readFile(
    join(MEDIA_BUNDLE_ROOT, "docker-compose.yml"),
    "utf8",
  );
  if (extractComposeImage(bundleCompose, "homarr") !== HOMARR_IMAGE) {
    fail("homarr image: media bundle Compose contract changed");
  }
  return "root, catalog, and media bundle";
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function validateMediaBundleDrift() {
  const verifierPath = join(MEDIA_SKILL_ROOT, "scripts", "verify-bundle.mjs");
  await statRegularFile(verifierPath, "media bundle verifier");
  const verifier = runLocal(process.execPath, [verifierPath]);
  if (!verifier.ok) {
    let status = "unknown";
    if (verifier.status !== null) {
      status = String(verifier.status);
    }
    fail(`media bundle: integrity verifier failed with exit status ${status}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(MEDIA_BUNDLE_MANIFEST, "utf8"));
  } catch {
    fail("media bundle: manifest is missing or invalid");
  }
  if (!manifest || !Array.isArray(manifest.files) || !Array.isArray(manifest.sourceTransforms)) {
    fail("media bundle: manifest structure is invalid");
  }
  const transforms = new Map();
  for (const transform of manifest.sourceTransforms) {
    if (transform && typeof transform.path === "string") {
      transforms.set(transform.path, transform);
    }
  }

  const errors = [];
  const manifestPaths = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== "string") {
      errors.push("media bundle: malformed manifest file entry");
      continue;
    }
    manifestPaths.add(entry.path);
    const sourcePath = join(REPOSITORY_ROOT, ...entry.path.split("/"));
    let sourceStat;
    let sourceContent;
    try {
      sourceStat = await lstat(sourcePath);
      sourceContent = await readFile(sourcePath);
    } catch {
      errors.push(`media bundle: canonical source missing ${entry.path}`);
      continue;
    }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      errors.push(`media bundle: unsafe canonical source ${entry.path}`);
      continue;
    }
    let expectedMode = "0644";
    if ((sourceStat.mode & 0o111) !== 0) {
      expectedMode = "0755";
    }
    if (expectedMode !== entry.mode) {
      errors.push(`media bundle: source mode drift ${entry.path}`);
    }
    const transform = transforms.get(entry.path);
    let expectedHash = entry.sha256;
    if (transform && typeof transform.sourceSha256 === "string") {
      expectedHash = transform.sourceSha256;
    }
    if (sha256(sourceContent) !== expectedHash) {
      errors.push(`media bundle: source content drift ${entry.path}`);
    }
  }

  for (const directoryName of ["docs", "prompts", "scripts"]) {
    const directoryPath = join(REPOSITORY_ROOT, directoryName);
    const tree = await walkTree(directoryPath);
    for (const sourcePath of tree.files) {
      const sourceRelativePath = repositoryPath(sourcePath);
      if (
        !manifestPaths.has(sourceRelativePath)
        && !ROOT_TOOLING_OUTSIDE_MEDIA_BUNDLE.has(sourceRelativePath)
      ) {
        errors.push(`media bundle: unexpected canonical source ${sourceRelativePath}`);
      }
    }
  }
  failMany(errors);
  return `${manifest.files.length} bundled files match canonical sources`;
}

async function validateScriptSyntax() {
  const skills = await discoverSkillRoots();
  const scripts = [];
  for (const skill of skills) {
    const tree = await walkTree(skill.root);
    for (const filePath of tree.files) {
      const extension = extname(filePath).toLowerCase();
      if (
        extension === ".cjs"
        || extension === ".js"
        || extension === ".mjs"
        || extension === ".sh"
      ) {
        scripts.push(filePath);
      }
    }
  }
  scripts.push(join(REPOSITORY_ROOT, "scripts", "refresh-media-bundle.mjs"));
  scripts.push(join(REPOSITORY_ROOT, "scripts", "validate-repo.mjs"));
  scripts.push(join(REPOSITORY_ROOT, "scripts", "smoke-install.sh"));

  const uniqueScripts = [...new Set(scripts)].sort();
  const errors = [];
  for (const scriptPath of uniqueScripts) {
    const extension = extname(scriptPath).toLowerCase();
    let result;
    if (extension === ".sh") {
      result = runLocal("bash", ["-n", scriptPath]);
    } else {
      result = runLocal(process.execPath, ["--check", scriptPath]);
    }
    if (!result.ok) {
      errors.push(`syntax: ${repositoryPath(scriptPath)}`);
    }
  }
  failMany(errors);
  return `${uniqueScripts.length} Node and Bash scripts`;
}

async function runCheck(name, operation) {
  try {
    const detail = await operation();
    return { name, status: "PASS", detail: safeMessage(detail) };
  } catch (error) {
    let detail = "validation failed";
    if (error instanceof ValidationError) {
      detail = error.messages.join("; ");
    }
    return { name, status: "FAIL", detail: safeMessage(detail) };
  }
}

function usage() {
  process.stdout.write(
    "Usage: node scripts/validate-repo.mjs [--json]\n",
  );
}

async function main() {
  let jsonOutput = false;
  for (const argument of process.argv.slice(2)) {
    if (argument === "--json") {
      jsonOutput = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      usage();
      return;
    }
    process.stderr.write("FAIL arguments: unsupported option\n");
    process.exitCode = 2;
    return;
  }

  const checks = [
    ["skill metadata", validateSkillMetadata],
    ["skill trees", validateSkillTrees],
    ["credential hygiene", validateCredentialHygiene],
    ["local references", validateMarkdownReferences],
    ["documentation", validateDocumentationContracts],
    ["JSON", validateJsonFiles],
    ["catalog semantics", validateCatalogSemantics],
    ["skill registry", validateSkillRegistry],
    ["catalog skills", validateCatalogSkillReferences],
    ["Homarr image", validateHomarrImage],
    ["media bundle", validateMediaBundleDrift],
    ["script syntax", validateScriptSyntax],
  ];
  const results = [];
  for (const [name, operation] of checks) {
    results.push(await runCheck(name, operation));
  }

  const failures = results.filter((result) => result.status === "FAIL");
  if (jsonOutput) {
    process.stdout.write(
      `${JSON.stringify({
        ok: failures.length === 0,
        checks: results,
        summary: {
          passed: results.length - failures.length,
          failed: failures.length,
        },
      }, null, 2)}\n`,
    );
  } else {
    for (const result of results) {
      process.stdout.write(
        `${result.status} ${result.name}: ${result.detail}\n`,
      );
    }
    let summaryStatus = "PASS";
    if (failures.length > 0) {
      summaryStatus = "FAIL";
    }
    process.stdout.write(
      `${summaryStatus} summary: ${results.length - failures.length} passed, ${failures.length} failed\n`,
    );
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(() => {
  process.stderr.write("FAIL validator: unexpected internal error\n");
  process.exitCode = 1;
});
