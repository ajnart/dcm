import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manualJobProbeAllowed } from "../references/catalog/types/manual-job.ts";
import { checkedConnectorRecipe } from "../references/catalog/types/connector.ts";
import { checkedPrivateDaemonRecipe } from "../references/catalog/types/private-daemon.ts";
import { containerHashReferencesAllowed, bcryptHashTemplateReferencesAllowed } from "../references/catalog/types/config-hash-reference.ts";
import { checkedPrivateConfigEnvironment } from "../references/catalog/types/private-config-environment.ts";
import { checkedMutableConfigs } from "../references/catalog/types/mutable-config.ts";
import { checkedHttpBasicOnboarding } from "../references/catalog/types/http-basic.ts";
import { checkedMutableAdminOnboarding } from "../references/catalog/types/mutable-admin.ts";
import { isDisabledCredentialLoggingPolicy, isPassboltNonSecretIdentity, isPublicOidcEnvironment } from "../references/catalog/types/non-secret-policy.ts";
import { checkedAppFrontend } from "../references/catalog/types/app-frontend.ts";
import { isRecipeImageReference } from "../references/catalog/types/recipe-image-reference.ts";
import { checkedRuntimeResourceRequest } from "../references/catalog/types/runtime-resources.ts";
import { checkedOwnerDirectoryRequest } from "../references/catalog/types/owner-directory.ts";
import { checkedDockerCliTlsRequest, dockerCliTlsTargets } from "../references/catalog/types/docker-cli-tls.ts";
import { checkedBootstrapCapability } from "../references/catalog/types/private-file.ts";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIRECTORY = dirname(SCRIPT_DIRECTORY);
export const CATALOG_DIRECTORY = join(SKILL_DIRECTORY, "references", "catalog");

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORT_LEVELS = new Set(["managed", "guided", "discovery", "retired"]);
const TIERS = new Set(["T0", "T1", "T2"]);
const LIFECYCLES = new Set(["active", "transitioning", "verify", "retired"]);
const IMAGE_SOURCES = new Set(["upstream", "vendor", "community", "unknown"]);
const IMAGE_STATUSES = new Set(["known", "verify", "unknown"]);
const HOMARR_LEVELS = new Set(["supported", "partial", "gap", "not-applicable"]);
const HOMARR_EXCLUDED_VALUES = new Set(["mock", "searchch", "releaseprovider"]);
const STACK_SUPPORT = new Set(["managed", "guided", "discovery"]);
const ADAPTER_SCOPES = new Set(["application", "stack"]);
const INSTALL_GROUPS = new Set(["base", "pack", "extension"]);
const CLI_APP_COMMANDS = new Set(["immich", "docmost", "vaultwarden"]);
const NON_COMPOSE_APP_IDS = new Set([
  "docker", "kubernetes", "openmediavault", "opnsense", "proxmox",
  "proxmox-backup-server", "synology", "truenas", "unifi-controller", "unraid", "wireguard"
]);
const AUTOMATION_RANK = new Map([
  ["managed", 0],
  ["guided", 1],
  ["discovery", 2]
]);
const DEPENDENCY_PURPOSES = new Map([
  ["postgresql", "Stores app records such as accounts, settings, and library details."],
  ["valkey", "Handles quick caching and background jobs for the main app."],
  ["prometheus", "Collects and stores numeric health and performance measurements."],
  ["grafana", "Turns monitoring data into dashboards."],
  ["loki", "Stores service logs for searching and troubleshooting."],
  ["vector", "Collects and sends service logs to the selected log store."],
  ["docker", "Runs the selected services as isolated containers."],
  ["ollama", "Runs the selected AI models on the host."],
  ["forgejo", "Stores the source repositories used by the selected automation."]
]);
const SECRET_FIELD_PATTERN = /(^|[._-])(password|passwd|secret|token|credential|credentials|api[-_]?key|auth[-_]?key|private[-_]?key|cookie|session|encryption[-_]?key)($|[._-])/i;
const SECRET_ENV_NAME_PATTERN = /PASS(?:WORD|WD)?|SECRET|TOKEN|CREDENTIAL|(?:API|AUTH)_?KEY|(?:^|_)KEY(?:_|$)|(?:^|_)(?:AUTH|COOKIE|DATABASE_URL|DSN|CONNECTION_STRING)(?:_|$)/i;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*(PRIVATE KEY|SECRET)[A-Z ]*-----/i,
  /(?:^|[?&\s])(password|passwd|secret|token|api[_-]?key|private[_-]?key)=\S+/i,
  /^(gh[pousr]_|github_pat_|sk-[A-Za-z0-9]|tskey-|xox[baprs]-|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.)/,
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/,
  /^(?=.{40,}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_+/=-]+$/
];

const APP_KEYS = ["aliases", "alternatives", "categories", "dependencies", "homarr", "id", "image", "lifecycle", "name", "pitfalls", "roles", "security", "sources", "support", "upstream"];
const STACK_KEYS = ["acceptance", "aliases", "automation", "categories", "gates", "id", "name", "requiredSkills", "roles", "summary"];
const ROLE_KEYS = ["choices", "default", "gates", "id", "name", "purpose", "reason", "required"];
const HOMARR_REGISTRY_KEYS = ["checkedAt", "externalOnly", "officialSources", "schemaVersion", "special", "standard"];
const HOMARR_SURFACE_KEYS = ["displayName", "identifier"];
const SKILL_REGISTRY_KEYS = ["packVersion", "schemaVersion", "skills"];
const SKILL_RECORD_KEYS = ["activation", "delegatesTo", "id", "install", "kind", "risk", "scope"];
const RECIPE_KEYS = ["acceptance", "appId", "defaults", "kind", "schemaVersion", "service", "source", "storage"];
const RECIPE_SERVICE_KEYS = ["dataTarget", "id", "imageTag", "imageUserEvidence", "networkInternal", "readOnly", "restart", "targetPort", "user"];
const MAX_CATALOG_JSON_BYTES = 512 * 1024;

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value) {
  return normalize(value).replaceAll(" ", "");
}

function phraseIndex(value, phrase) {
  const paddedValue = ` ${value} `;
  const paddedPhrase = ` ${phrase} `;
  const index = paddedValue.indexOf(paddedPhrase);
  if (index < 0) {
    return -1;
  }
  return Math.max(0, index - 1);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) {
    return false;
  }
  return value.every((entry) => isNonEmptyString(entry));
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function readJson(path) {
  let raw;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.size < 1 || metadata.size > MAX_CATALOG_JSON_BYTES) {
      throw new Error("unsafe catalog JSON file");
    }
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read catalog file ${path}: ${error.code || error.message || "read error"}`);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_CATALOG_JSON_BYTES) {
    throw new Error(`Catalog file is too large: ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Catalog file is not valid JSON: ${path}`);
  }
}

async function requireCatalogDirectory(path) {
  const metadata = await lstat(path);
  const canonical = await realpath(path);
  const unsafePosixPath = process.platform !== "win32"
    && (canonical !== path || (metadata.mode & 0o002) !== 0);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || unsafePosixPath) {
    throw new Error(`Catalog directory is unsafe: ${path}`);
  }
}

export async function resolveCatalogDirectory(requested = CATALOG_DIRECTORY) {
  if (!isAbsolute(requested) || resolve(requested) !== requested) {
    throw new Error("--catalog-dir must be one canonical absolute directory");
  }
  await requireCatalogDirectory(requested);
  if (process.platform === "win32") return realpath(requested);
  return requested;
}

async function loadRecordDirectory(path) {
  await requireCatalogDirectory(path);
  const names = await readdir(path);
  const records = [];
  const jsonNames = names.filter((name) => name.endsWith(".json")).sort();
  for (const name of jsonNames) {
    const value = await readJson(join(path, name));
    if (!Array.isArray(value)) {
      throw new Error(`Catalog record file must contain an array: ${name}`);
    }
    records.push(...value);
  }
  return records;
}

async function loadAppDirectory(path) {
  await requireCatalogDirectory(path);
  const entries = (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  const apps = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) {
      throw new Error(`Catalog application entry is not a named app directory: ${entry.name}`);
    }
    await requireCatalogDirectory(join(path, entry.name));
    const manifestPath = join(path, entry.name, "manifest.json");
    const metadata = await lstat(manifestPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error(`Catalog application manifest is unsafe: ${entry.name}`);
    }
    const app = await readJson(manifestPath);
    if (!isPlainObject(app) || app.id !== entry.name) {
      throw new Error(`Catalog application ID must match its directory: ${entry.name}`);
    }
    apps.push(app);
  }
  return apps;
}

export async function loadCatalog(directory = CATALOG_DIRECTORY) {
  const source = await resolveCatalogDirectory(directory);
  const taxonomy = await readJson(join(source, "taxonomy.json"));
  const affiliates = await readJson(join(source, "affiliates.json"));
  // External data cannot replace packaged workflow authority or integration identifiers.
  const homarrIntegrations = await readJson(join(CATALOG_DIRECTORY, "homarr-integrations.json"));
  const skills = await readJson(join(CATALOG_DIRECTORY, "skills.json"));
  const apps = await loadAppDirectory(join(source, "apps"));
  const stacks = await loadRecordDirectory(join(source, "stacks"));
  return { taxonomy, affiliates, homarrIntegrations, skills, apps, stacks };
}

// A missing app folder disables its dependent features at runtime. Publishing still
// uses validateCatalog on the unmodified source so dangling references are caught.
export function availableCatalog(source) {
  const available = new Set(source.apps.map((app) => app.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const app of source.apps) {
      if (!available.has(app.id) || !Array.isArray(app.dependencies)) {
        continue;
      }
      const missingDependency = app.dependencies.some((id) => !id.startsWith("capability:") && !available.has(id));
      if (missingDependency) {
        available.delete(app.id);
        changed = true;
      }
    }
  }

  const apps = source.apps
    .filter((app) => available.has(app.id))
    .map((app) => ({
      ...app,
      alternatives: Array.isArray(app.alternatives)
        ? app.alternatives.filter((id) => available.has(id))
        : app.alternatives
    }));
  const stacks = [];
  for (const stack of source.stacks) {
    if (stack.id === "homarr-control-plane" && !available.has("homarr")) {
      continue;
    }
    if (!Array.isArray(stack.roles)) {
      stacks.push(stack);
      continue;
    }
    const roles = [];
    let unavailable = false;
    for (const role of stack.roles) {
      if (!Array.isArray(role.choices)) {
        roles.push(role);
        continue;
      }
      const choices = role.choices.filter((id) => available.has(id));
      if (role.default !== null && !choices.includes(role.default)) {
        unavailable = true;
        break;
      }
      if (role.required && choices.length === 0) {
        unavailable = true;
        break;
      }
      if (choices.length > 0) {
        roles.push({ ...role, choices });
      }
    }
    if (!unavailable) {
      stacks.push({ ...stack, roles });
    }
  }
  const supportedIntegrations = new Set(apps
    .filter((app) => app.homarr && app.homarr.support === "supported")
    .map((app) => app.homarr.integration));
  const standard = source.homarrIntegrations.standard.filter((surface) =>
    supportedIntegrations.has(surface.displayName));
  const special = source.homarrIntegrations.special.filter((surface) =>
    supportedIntegrations.has(surface.displayName));
  const availableSurfaceIds = new Set([...standard, ...special].map((surface) => surface.identifier));
  const homarrIntegrations = {
    ...source.homarrIntegrations,
    standard,
    special,
    externalOnly: source.homarrIntegrations.externalOnly.filter((id) => availableSurfaceIds.has(id))
  };
  const aliasCounts = new Map();
  for (const stack of stacks) {
    for (const alias of stack.aliases) {
      const key = normalize(alias);
      aliasCounts.set(key, (aliasCounts.get(key) || 0) + 1);
    }
  }
  const taxonomy = {
    ...source.taxonomy,
    ambiguousAliases: source.taxonomy.ambiguousAliases.filter((alias) => (aliasCounts.get(normalize(alias)) || 0) > 1)
  };
  return { ...source, apps, stacks, homarrIntegrations, taxonomy };
}

function addError(errors, condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function hasExactKeys(value, allowedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function scanForSecretLikeData(value, path, errors) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      scanForSecretLikeData(value[index], `${path}[${index}]`, errors);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_FIELD_PATTERN.test(key)) {
        errors.push(`${path}: secret-like field names are not permitted`);
      }
      scanForSecretLikeData(child, `${path}.${key}`, errors);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()))) {
    errors.push(`${path}: secret-like values are not permitted`);
  }
}

function validateMultiServiceRecipe(recipe, app) {
  const errors = [];
  const prefix = `recipe ${app.id}`;
  const recipeKeys = ["schemaVersion", "kind", "appId", "source", "services", "privateFiles", "onboarding", "defaults", "storage", "acceptance"];
  const manualJob = recipe.execution?.kind === "manual-job";
  const connector = recipe.execution?.kind === "private-connector";
  const daemon = recipe.execution?.kind === "private-daemon";
  const portless = manualJob || connector || daemon;
  if (recipe.execution !== undefined) {
    recipeKeys.push("execution");
    if (connector || daemon) {
      try {
        if (daemon) checkedPrivateDaemonRecipe(recipe);
        else checkedConnectorRecipe(recipe);
      }
      catch (error) { errors.push(`${prefix}: ${error.message}`); }
      addError(errors, isHttpsUrl(recipe.execution.officialUrl)
        && [recipe.source, ...app.sources].includes(recipe.execution.officialUrl),
      `${prefix}: connector execution requires an official source`);
      if (daemon) addError(errors, app.frontend?.kind === "none",
        `${prefix}: private daemon requires explicit non-frontend presentation`);
    } else {
      addError(errors, hasExactKeys(recipe.execution, ["kind", "officialUrl", "probe"])
        && manualJob && isHttpsUrl(recipe.execution.officialUrl)
        && [recipe.source, ...app.sources].includes(recipe.execution.officialUrl)
        && manualJobProbeAllowed(recipe.execution.probe)
        && app.sources.includes(recipe.execution.probe?.officialUrl)
        && recipe.services?.length === 1 && recipe.postFirstAccountEnvironment === undefined,
      `${prefix}: manual execution requires one portless job and an official source`);
    }
  }
  if (recipe.configFiles !== undefined) recipeKeys.push("configFiles");
  if (recipe.privateConfigs !== undefined) recipeKeys.push("privateConfigs");
  if (recipe.mutableConfigs !== undefined) recipeKeys.push("mutableConfigs");
  if (recipe.imageSources !== undefined) {
    recipeKeys.push("imageSources");
    addError(errors, Array.isArray(recipe.imageSources) && recipe.imageSources.length >= 1
      && recipe.imageSources.length <= 16 && new Set(recipe.imageSources).size === recipe.imageSources.length
      && recipe.imageSources.every((source) => isHttpsUrl(source) && app.sources.includes(source)),
    `${prefix}: image sources must be unique bounded official app sources`);
  }
  try { checkedMutableConfigs(recipe); }
  catch { addError(errors, false, `${prefix}: mutable configuration declarations or bindings are invalid`); }
  if (recipe.postFirstAccountEnvironment !== undefined) recipeKeys.push("postFirstAccountEnvironment");
  addError(errors, hasExactKeys(recipe, recipeKeys), `${prefix}: contains missing or unsupported fields`);
  addError(errors, recipe.appId === app.id, `${prefix}: app ID must match its folder`);
  addError(errors, recipe.source === app.upstream.repository || app.sources.includes(recipe.source), `${prefix}: source must be an official app source`);
  if (recipe.postFirstAccountEnvironment !== undefined) {
    const switchSpec = recipe.postFirstAccountEnvironment;
    const service = recipe.services?.find((item) => item?.id === switchSpec?.serviceId);
    const bindings = [...(service?.hostEnvironment ?? []), ...(service?.derivedEnvironment ?? []),
      ...(service?.secretEnvironment ?? []), ...(service?.fileEnvironment ?? [])];
    const switchKeys = ["serviceId", "name", "from", "to", "after"];
    if (switchSpec?.proof !== undefined) switchKeys.push("proof");
    const proof = switchSpec?.proof;
    const validProof = proof === undefined || (hasExactKeys(proof, ["stage", "attemptedActions"])
      && proof.stage === "account-verified" && Array.isArray(proof.attemptedActions)
      && proof.attemptedActions.length >= 1 && proof.attemptedActions.length <= 8
      && new Set(proof.attemptedActions).size === proof.attemptedActions.length
      && proof.attemptedActions.every((action) => typeof action === "string" && action.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(action)));
    addError(errors, hasExactKeys(switchSpec, switchKeys) && validProof
      && switchSpec.after === "first-admin-created"
      && /^[A-Z][A-Z0-9_]{0,127}$/.test(switchSpec.name)
      && typeof switchSpec.from === "string" && (switchSpec.to === null || typeof switchSpec.to === "string")
      && switchSpec.from !== switchSpec.to && switchSpec.from.length <= 256
      && (switchSpec.to === null || (switchSpec.to.length <= 256 && !/[\r\n\u0000$]/.test(switchSpec.to)))
      && !/[\r\n\u0000$]/.test(switchSpec.from)
      && recipe.services?.filter((item) => item?.id === switchSpec.serviceId).length === 1
      && service?.environment?.filter((item) => item?.name === switchSpec.name && item.value === switchSpec.from).length === 1
      && !bindings.some((item) => item?.name === switchSpec.name),
    `${prefix}: post-first-account environment must change one owned static non-secret binding`);
  }
  const files = new Set();
  let bootstrapCapability = null;
  try { bootstrapCapability = checkedBootstrapCapability(recipe); }
  catch { addError(errors, false, `${prefix}: bootstrap capability contract is invalid`); }
  addError(errors, Array.isArray(recipe.privateFiles) && recipe.privateFiles.length <= 12, `${prefix}: private file descriptors are invalid`);
  if (Array.isArray(recipe.privateFiles)) {
    for (const file of recipe.privateFiles) {
      const fields = file?.source === "owner" ? ["id", "source", "maxBytes"]
        : file?.format === undefined ? ["id", "bytes"] : ["id", "bytes", "format"];
      if (file?.source === "owner" && file.consumer === "pre-start") fields.push("consumer");
      if (file?.purpose === "bootstrap-capability") fields.push("purpose", "officialUrl");
      addError(errors, hasExactKeys(file, fields), `${prefix}: private file descriptor fields are invalid`);
      if (!isPlainObject(file)) continue;
      addError(errors, ID_PATTERN.test(file.id || "") && !files.has(file.id), `${prefix}: private file IDs must be unique`);
      if (file.source === "owner") {
        addError(errors, Number.isInteger(file.maxBytes) && file.maxBytes >= 1 && file.maxBytes <= 16384,
          `${prefix}: owner private file size is invalid`);
      } else {
        addError(errors, file === bootstrapCapability
          || (Number.isInteger(file.bytes) && file.bytes >= 32 && file.bytes <= 128), `${prefix}: private file size is invalid`);
        addError(errors, file.format === undefined || ["base64url", "alphanumeric", "hex", "base64-prefixed", "base64"].includes(file.format), `${prefix}: private file format is invalid`);
      }
      files.add(file.id);
    }
  }
  const configFiles = new Set();
  addError(errors, recipe.configFiles === undefined || (Array.isArray(recipe.configFiles)
    && recipe.configFiles.length >= 1 && recipe.configFiles.length <= 8), `${prefix}: generated config files are invalid`);
  for (const file of Array.isArray(recipe.configFiles) ? recipe.configFiles : []) {
    const fields = ["id", "content"];
    if (file?.readability !== undefined) fields.push("readability", "officialUrl");
    addError(errors, hasExactKeys(file, fields), `${prefix}: generated config fields are invalid`);
    if (!isPlainObject(file)) continue;
    addError(errors, file.readability === undefined || (file.readability === "container"
      && isHttpsUrl(file.officialUrl) && app.sources.includes(file.officialUrl)),
    `${prefix}: container-readable config needs an exact listed official publisher source`);
    addError(errors, ID_PATTERN.test(file.id || "") && !configFiles.has(file.id),
      `${prefix}: generated config IDs must be unique`);
    const content = file.content;
    const bcryptEnvironmentNames = new Set((recipe.services ?? []).filter((service) =>
      service.mounts?.some((mount) => mount.kind === "generated-file" && mount.fileId === file.id))
      .flatMap((service) => (service.secretEnvironment ?? [])
        .filter((entry) => entry?.format === "bcrypt-hash").map((entry) => entry.name)));
    const assignments = typeof content === "string"
      ? [...content.matchAll(/(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key)\s*[:=]\s*([^\s,;}]+)/gi)] : [];
    addError(errors, typeof content === "string" && Buffer.byteLength(content, "utf8") <= 16384
      && file.content.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(file.content)
      && !/\$\{|\$\(|<%|%>/.test(file.content)
      && (!content.includes("{{") || bcryptHashTemplateReferencesAllowed(content, bcryptEnvironmentNames))
      && (file.readability !== "container" || containerHashReferencesAllowed(content, bcryptEnvironmentNames))
      && !(file.readability === "container"
        && /process\s*\.\s*env\s*(?:\.\s*[A-Z][A-Z0-9_]*_AUTH_HASH\b|\[\s*["'][A-Z][A-Z0-9_]*_AUTH_HASH["']\s*\])/.test(file.content))
      && assignments.every((match) => {
        const reference = /^process\.env\.([A-Z][A-Z0-9_]*_AUTH_HASH)$/.exec(match[1]);
        return reference !== null && bcryptEnvironmentNames.has(reference[1]);
      })
      && !/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(file.content),
    `${prefix}: generated config content must be bounded, literal, and non-secret`);
    configFiles.add(file.id);
  }
  addError(errors, Array.isArray(recipe.services) && recipe.services.length >= 1 && recipe.services.length <= 8, `${prefix}: services must contain 1 to 8 entries`);
  const services = Array.isArray(recipe.services) ? recipe.services : [];
  const allServiceIds = new Set(services.map((service) => service?.id));
  const ids = new Set();
  const mountNames = new Map();
  const mountedConfigFiles = new Set();
  const additionalPortIds = new Set();
  const usedFiles = new Set();
  const privateConfigs = new Set();
  const mountedPrivateConfigs = new Set();
  addError(errors, recipe.privateConfigs === undefined || (Array.isArray(recipe.privateConfigs)
    && recipe.privateConfigs.length >= 1 && recipe.privateConfigs.length <= 8), `${prefix}: private configurations are invalid`);
  for (const config of Array.isArray(recipe.privateConfigs) ? recipe.privateConfigs : []) {
    addError(errors, hasExactKeys(config, ["id", "officialUrl", "parts"])
      && ID_PATTERN.test(config?.id || "") && !files.has(config.id) && !privateConfigs.has(config.id)
      && isHttpsUrl(config.officialUrl)
      && [recipe.source, ...app.sources].includes(config.officialUrl)
      && Array.isArray(config.parts) && config.parts.length >= 1 && config.parts.length <= 64,
    `${prefix}: private configuration needs a unique ID and official source`);
    if (!isPlainObject(config)) continue;
    let literalBytes = 0;
    let references = 0;
    for (const part of Array.isArray(config.parts) ? config.parts : []) {
      if (hasExactKeys(part, ["literal"])) {
        addError(errors, typeof part.literal === "string" && part.literal.length > 0
          && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\$\{|\$\(|`/.test(part.literal)
          && !/(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;\]}]/i.test(part.literal),
        `${prefix}: private configuration literal is invalid`);
        if (typeof part.literal === "string") literalBytes += Buffer.byteLength(part.literal);
      } else {
        const file = recipe.privateFiles?.find((entry) => entry.id === part?.fileId);
        addError(errors, hasExactKeys(part, ["fileId"]) && file && file.source === undefined
          && ["base64url", "alphanumeric", "hex", "base64"].includes(file.format ?? "base64url"),
        `${prefix}: private configuration requires a supported generated source`);
        if (file) { usedFiles.add(file.id); references += 1; }
      }
    }
    addError(errors, literalBytes <= 16384 && references > 0, `${prefix}: private configuration is unbounded or has no generated source`);
    privateConfigs.add(config.id);
  }
  let published = 0;
  let additionalPortCount = 0;
  for (const service of services) {
    const serviceKeys = ["id", "purpose", "imageTag", "imageSource", "user", "imageUserEvidence", "restart", "readOnly", "environment", "hostEnvironment", "fileEnvironment", "mounts", "dependsOn", "publishTargetPort"];
    if (service?.healthcheck !== undefined) serviceKeys.push("healthcheck");
    if (service?.init !== undefined) serviceKeys.push("init");
    if (service?.shmSizeBytes !== undefined) serviceKeys.push("shmSizeBytes");
    if (service?.runtimeResources !== undefined) serviceKeys.push("runtimeResources");
    if (service?.ownerDirectory !== undefined) serviceKeys.push("ownerDirectory");
    if (service?.dockerCliTls !== undefined) serviceKeys.push("dockerCliTls");
    if (service?.ulimits !== undefined) serviceKeys.push("ulimits");
    if (service?.capDrop !== undefined) serviceKeys.push("capDrop");
    if (service?.memoryLimitBytes !== undefined) serviceKeys.push("memoryLimitBytes");
    if (service?.cpuLimit !== undefined) serviceKeys.push("cpuLimit");
    if (service?.tmpfs !== undefined) serviceKeys.push("tmpfs");
    if (service?.privateConfigFiles !== undefined) serviceKeys.push("privateConfigFiles");
    if (service?.additionalPorts !== undefined) serviceKeys.push("additionalPorts");
    if (service?.entrypoint !== undefined) serviceKeys.push("entrypoint");
    if (service?.command !== undefined) serviceKeys.push("command");
    if (service?.hostname !== undefined) serviceKeys.push("hostname");
    if (service?.publishedPortMustMatchTarget !== undefined) serviceKeys.push("publishedPortMustMatchTarget");
    if (service?.publishTargetPortSource !== undefined) serviceKeys.push("publishTargetPortSource");
    if (service?.derivedEnvironment !== undefined) serviceKeys.push("derivedEnvironment");
    if (service?.secretEnvironment !== undefined) serviceKeys.push("secretEnvironment");
    if (service?.hostIdentityEvidence !== undefined) serviceKeys.push("hostIdentityEvidence");
    addError(errors, hasExactKeys(service, serviceKeys), `${prefix}: service fields are invalid`);
    if (!isPlainObject(service)) continue;
    const servicePortTargets = new Set();
    addError(errors, ID_PATTERN.test(service.id || "") && !ids.has(service.id), `${prefix}: service IDs must be unique`);
    addError(errors, typeof service.purpose === "string" && service.purpose.length >= 12
      && service.purpose.length <= 140 && service.purpose.trim() === service.purpose
      && !/[\r\n\u0000-\u001f\u007f]/.test(service.purpose), `${prefix}: service purpose must be plain-language text`);
    ids.add(service.id);
    addError(errors, isRecipeImageReference(service.imageTag), `${prefix}: each image needs a fixed non-latest tag or immutable sha256 digest`);
    addError(errors, isHttpsUrl(service.imageSource), `${prefix}: image source must be HTTPS`);
    addError(errors, ["image-default", "host-selected"].includes(service.user)
      && ((manualJob && service.restart === "no")
        || (!manualJob && ["unless-stopped", "always"].includes(service.restart))) && typeof service.readOnly === "boolean",
      `${prefix}: unsupported service runtime policy`);
    if (service.hostname !== undefined) {
      addError(errors, manualJob && typeof service.hostname === "string"
        && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(service.hostname),
      `${prefix}: hostname requires one bounded manual-job DNS label`);
    }
    if (manualJob) {
      addError(errors, service.id === app.id && service.publishTargetPort === null
        && (service.additionalPorts?.length ?? 0) === 0
        && (service.derivedEnvironment?.length ?? 0) === 0
        && Array.isArray(service.command) && service.command.length > 0
        && Array.isArray(service.dependsOn) && service.dependsOn.length === 0
        && service.healthcheck === undefined,
      `${prefix}: manual job cannot expose ports, start dependencies, or claim HTTP health`);
    }
    if (service.capDrop !== undefined) {
      addError(errors, Array.isArray(service.capDrop) && service.capDrop.length === 1
        && service.capDrop[0] === "ALL", `${prefix}: capability dropping accepts only ALL`);
    }
    if (service.runtimeResources !== undefined) {
      try {
        checkedRuntimeResourceRequest(service.runtimeResources);
        addError(errors, app.sources.includes(service.runtimeResources.officialUrl), `${prefix}: runtime resource needs listed publisher evidence`);
      } catch { addError(errors, false, `${prefix}: runtime resource profile or evidence is invalid`); }
    }
    if (service.ownerDirectory !== undefined) {
      try {
        checkedOwnerDirectoryRequest(service.ownerDirectory);
        addError(errors, service.id === app.id && service.user === "host-selected" && !portless
          && service.runtimeResources === undefined && app.sources.includes(service.ownerDirectory.officialUrl)
          && !service.environment.some((row) => row.name === "DOCKGE_STACKS_DIR"),
        `${prefix}: owned stacks require reviewed numeric-user source and one generated path`);
      } catch { addError(errors, false, `${prefix}: owned stack directory declaration is invalid`); }
    }
    if (service.memoryLimitBytes !== undefined) {
      addError(errors, Number.isInteger(service.memoryLimitBytes) && service.memoryLimitBytes >= 67108864
        && service.memoryLimitBytes <= 17179869184, `${prefix}: memory limit is invalid`);
    }
    if (service.cpuLimit !== undefined) {
      addError(errors, typeof service.cpuLimit === "number" && service.cpuLimit >= 0.1
        && service.cpuLimit <= 16 && Number.isInteger(service.cpuLimit * 10), `${prefix}: CPU limit is invalid`);
    }
    if (service.init !== undefined) {
      addError(errors, service.init === true, `${prefix}: init must be explicitly enabled`);
    }
    if (service.shmSizeBytes !== undefined) {
      addError(errors, Number.isInteger(service.shmSizeBytes) && service.shmSizeBytes >= 1024 ** 2
        && service.shmSizeBytes <= 1024 ** 3, `${prefix}: shared memory size is invalid`);
    }
    if (service.ulimits !== undefined) {
      const nofile = service.ulimits?.nofile;
      addError(errors, hasExactKeys(service.ulimits, ["nofile"])
        && hasExactKeys(nofile, ["soft", "hard"])
        && Number.isInteger(nofile.soft) && Number.isInteger(nofile.hard)
        && nofile.soft >= 1024 && nofile.hard <= 1048576 && nofile.soft <= nofile.hard,
      `${prefix}: nofile limits must be ordered bounded integers`);
    }
    if (service.privateConfigFiles !== undefined) {
      addError(errors, Array.isArray(service.privateConfigFiles) && service.privateConfigFiles.length >= 1
        && service.privateConfigFiles.length <= 8, `${prefix}: private configuration bindings are invalid`);
      for (const id of Array.isArray(service.privateConfigFiles) ? service.privateConfigFiles : []) {
        addError(errors, privateConfigs.has(id) && !mountedPrivateConfigs.has(id), `${prefix}: private configuration must have one exact service binding`);
        mountedPrivateConfigs.add(id);
      }
    }
    if (service.tmpfs !== undefined) {
      addError(errors, Array.isArray(service.tmpfs) && service.tmpfs.length <= 8, `${prefix}: tmpfs is invalid`);
      const targets = new Set();
      for (const mount of Array.isArray(service.tmpfs) ? service.tmpfs : []) {
        addError(errors, hasExactKeys(mount, ["target", "sizeBytes", "mode"])
          && typeof mount.target === "string" && /^\/[A-Za-z0-9/_.-]+$/.test(mount.target)
          && !mount.target.includes("//") && !mount.target.endsWith("/")
          && !mount.target.split("/").some((part) => part === "." || part === "..")
          && !targets.has(mount.target) && Number.isInteger(mount.sizeBytes)
          && mount.sizeBytes >= 1048576 && mount.sizeBytes <= 1073741824
          && Number.isInteger(mount.mode) && mount.mode >= 0 && mount.mode <= 1023,
        `${prefix}: tmpfs entry is invalid`);
        targets.add(mount.target);
      }
    }
    if (service.healthcheck !== undefined) {
      const check = service.healthcheck;
      addError(errors, hasExactKeys(check, ["test", "intervalSeconds", "timeoutSeconds", "startPeriodSeconds", "retries"])
        && Array.isArray(check?.test) && check.test.length >= 2 && check.test.length <= 32
        && check.test[0] === "CMD"
        && check.test.slice(1).every((argument) => typeof argument === "string"
          && argument.length > 0 && argument.length <= 300 && !/[\r\n\u0000]/.test(argument))
        && Number.isInteger(check.intervalSeconds) && check.intervalSeconds >= 1 && check.intervalSeconds <= 3600
        && Number.isInteger(check.timeoutSeconds) && check.timeoutSeconds >= 1 && check.timeoutSeconds <= 300
        && Number.isInteger(check.startPeriodSeconds) && check.startPeriodSeconds >= 0 && check.startPeriodSeconds <= 3600
        && Number.isInteger(check.retries) && check.retries >= 1 && check.retries <= 20,
      `${prefix}: healthcheck is invalid`);
    }
    for (const field of ["entrypoint", "command"]) {
      if (service[field] === undefined) continue;
      addError(errors, Array.isArray(service[field]) && service[field].length >= 1
        && service[field].length <= 32
        && service[field].every((argument) => typeof argument === "string"
          && argument.length >= 1 && argument.length <= 300
          && !/[\r\n\u0000$]/.test(argument)
          && (!/password|passwd|token|api[-_]?key|private[-_]?key|credential|secret|cookie|auth/i.test(argument)
            || (field === "command" && service.mounts.some((mount) => mount.kind === "generated-file"
              && mount.target === argument && recipe.configFiles?.some((file) => file.id === mount.fileId)))
            || (field === "command" && /^(?:--[a-z][a-z-]*=)?\/run\/secrets\/[a-z0-9-]+$/.test(argument)
              && service.privateConfigFiles?.includes(argument.split("/run/secrets/")[1])))),
      `${prefix}: ${field} must be a bounded non-secret argv list`);
    }
    if (service.dockerCliTls !== undefined) {
      let valid = false;
      try {
        const request = checkedDockerCliTlsRequest(service.dockerCliTls);
        valid = [recipe.source, ...app.sources].includes(request.officialUrl)
          && service.environment.filter((entry) => entry.name === "DOCKER_HOST"
            && entry.value === `tcp://${request.endpoint.serverName}:${request.endpoint.port}`).length === 1
          && dockerCliTlsTargets(request).every((binding) => recipe.privateFiles.find((file) => file.id === binding.fileId)?.source === "owner")
          && !service.environment.some((entry) => ["DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_TLS", "DOCKER_CONTEXT", "DOCKER_CONFIG"].includes(entry.name))
          && !service.fileEnvironment.some((entry) => [request.caFileId, request.certificateFileId, request.keyFileId].includes(entry.fileId));
        for (const binding of dockerCliTlsTargets(request)) usedFiles.add(binding.fileId);
      } catch { /* Retain the existing invalid-service report without source or credential payload. */ }
      addError(errors, valid, `${prefix}: Docker CLI TLS profile requires exact owner-issued credential files and generated TLS environment`);
    }
    const hasUserEvidence = hasExactKeys(service.imageUserEvidence, ["officialUrl", "reason"])
      && isHttpsUrl(service.imageUserEvidence?.officialUrl)
      && service.imageUserEvidence?.reason === "official-image-runtime-contract";
    if (service.user === "host-selected") {
      const publisherSources = [recipe.source, ...(Array.isArray(app.sources) ? app.sources : [])];
      addError(errors, hasUserEvidence && publisherSources.includes(service.imageUserEvidence.officialUrl),
        `${prefix}: host-selected user needs official publisher evidence listed in app sources`);
    } else {
      addError(errors, hasUserEvidence, `${prefix}: image-default user needs official evidence`);
    }
    addError(errors, Array.isArray(service.environment) && service.environment.length <= 32, `${prefix}: environment is invalid`);
    const environmentNames = new Set();
    for (const entry of Array.isArray(service.environment) ? service.environment : []) {
      addError(errors, hasExactKeys(entry, ["name", "value"]), `${prefix}: environment fields are invalid`);
      if (!isPlainObject(entry)) continue;
      const ntfyPolicy = app.id === "ntfy" && service.id === "ntfy"
        && ((entry.name === "NTFY_AUTH_FILE" && entry.value === "/var/lib/ntfy/user.db")
          || (entry.name === "NTFY_CACHE_FILE" && entry.value === "/var/lib/ntfy/cache.db")
          || (entry.name === "NTFY_AUTH_DEFAULT_ACCESS" && entry.value === "deny-all"));
      const tdarrAuthPolicy = app.id === "tdarr" && service.id === "tdarr"
        && entry.name === "auth" && entry.value === "true";
      addError(errors, /^[A-Za-z][A-Za-z0-9_]*$/.test(entry.name || "") && !environmentNames.has(entry.name)
        && (ntfyPolicy || tdarrAuthPolicy || isDisabledCredentialLoggingPolicy(entry.name, entry.value)
          || isPublicOidcEnvironment(entry.name, entry.value)
          || (app.id === "passbolt" && service.id === "passbolt" && isPassboltNonSecretIdentity(entry.name, entry.value))
          || (!SECRET_ENV_NAME_PATTERN.test(entry.name) && !entry.name.endsWith("_FILE")))
        && typeof entry.value === "string" && entry.value.length > 0 && entry.value.length <= 300,
        `${prefix}: environment name or value is invalid`);
      environmentNames.add(entry.name);
    }
    addError(errors, Array.isArray(service.hostEnvironment) && service.hostEnvironment.length <= 3,
      `${prefix}: host environment is invalid`);
    const linuxServerImage = service.imageTag?.startsWith(`lscr.io/linuxserver/${app.id}:`)
      || service.imageTag?.startsWith(`linuxserver/${app.id}:`);
    const officialHostIdentity = service.hostIdentityEvidence !== undefined
      && isHttpsUrl(service.hostIdentityEvidence)
      && service.hostIdentityEvidence === service.imageUserEvidence?.officialUrl
      && Array.isArray(app.sources) && app.sources.includes(service.hostIdentityEvidence)
      && service.user === "image-default";
    if (service.hostIdentityEvidence !== undefined) {
      addError(errors, officialHostIdentity, `${prefix}: host identity needs matching official image evidence`);
    }
    const uidMappedImage = (linuxServerImage
      && service.imageUserEvidence?.officialUrl === `https://docs.linuxserver.io/images/docker-${app.id}/`)
      || (app.id === "qbittorrent" && service.imageTag?.startsWith("ghcr.io/hotio/qbittorrent:"))
      || officialHostIdentity;
    for (const entry of Array.isArray(service.hostEnvironment) ? service.hostEnvironment : []) {
      addError(errors, hasExactKeys(entry, ["name", "source"]), `${prefix}: host environment fields are invalid`);
      if (!isPlainObject(entry)) continue;
      let expected = null;
      if (entry.name === "USERMAP_UID") expected = "uid";
      if (entry.name === "USERMAP_GID") expected = "gid";
      if (uidMappedImage && entry.name === "PUID") expected = "uid";
      if (uidMappedImage && entry.name === "PGID") expected = "gid";
      if (entry.name === "TZ") expected = "timezone";
      addError(errors, (service.id === app.id || entry.name === "TZ")
        && expected !== null && entry.source === expected
        && !environmentNames.has(entry.name), `${prefix}: host environment binding is invalid`);
      environmentNames.add(entry.name);
    }
    if (uidMappedImage && service.id === app.id) {
      addError(errors, service.hostEnvironment?.length >= 2
        && service.hostEnvironment?.length <= 3
        && service.hostEnvironment.some((entry) => entry?.name === "PUID" && entry.source === "uid")
        && service.hostEnvironment.some((entry) => entry?.name === "PGID" && entry.source === "gid"),
      `${prefix}: PUID and PGID must both bind the inspected host identity`);
    }
    if (service.derivedEnvironment !== undefined) {
      addError(errors, Array.isArray(service.derivedEnvironment)
        && service.derivedEnvironment.length <= 4, `${prefix}: derived environment is invalid`);
      for (const entry of Array.isArray(service.derivedEnvironment) ? service.derivedEnvironment : []) {
        if (entry?.source === "published-port") {
          const keys = ["name", "source"];
          if (entry.format !== undefined) keys.push("format");
          addError(errors, hasExactKeys(entry, keys)
            && /^[A-Z][A-Z0-9_]*$/.test(entry.name || "")
            && !SECRET_ENV_NAME_PATTERN.test(entry.name) && !environmentNames.has(entry.name)
            && (entry.format === undefined || entry.format === "tcp-port")
            && service.id === app.id && service.publishTargetPort !== null,
          `${prefix}: selected-port environment binding is invalid`);
          environmentNames.add(entry.name);
          continue;
        }
        const keys = entry?.pathSuffix === undefined ? ["name", "source"] : ["name", "source", "pathSuffix"];
        addError(errors, hasExactKeys(entry, keys)
          && /^[A-Z][A-Z0-9_]*$/.test(entry.name || "")
          && !SECRET_ENV_NAME_PATTERN.test(entry.name)
          && !entry.name.endsWith("_FILE") && !environmentNames.has(entry.name)
          && ["local-origin", "local-host-authority"].includes(entry.source)
          && (entry.source === "local-origin" || entry.pathSuffix === undefined)
          && (entry.pathSuffix === undefined || (typeof entry.pathSuffix === "string"
            && entry.pathSuffix.length <= 128
            && /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(entry.pathSuffix))),
        `${prefix}: derived environment binding is invalid`);
        if (isPlainObject(entry)) environmentNames.add(entry.name);
      }
    }
    addError(errors, Array.isArray(service.fileEnvironment) && service.fileEnvironment.length <= 12, `${prefix}: file environment is invalid`);
    for (const entry of Array.isArray(service.fileEnvironment) ? service.fileEnvironment : []) {
      const pathBinding = hasExactKeys(entry, ["name", "fileId"]);
      const uriBinding = hasExactKeys(entry, ["name", "fileId", "format", "officialUrl"])
        && entry.format === "file-uri" && isHttpsUrl(entry.officialUrl)
        && (entry.officialUrl === recipe.source || app.sources.includes(entry.officialUrl))
        && recipe.privateFiles.find((file) => file.id === entry.fileId)?.source === "owner";
      const sourcedPathBinding = hasExactKeys(entry, ["name", "fileId", "format", "officialUrl"])
        && entry.format === "file-path" && isHttpsUrl(entry.officialUrl)
        && app.sources.includes(entry.officialUrl)
        && recipe.privateFiles.find((file) => file.id === entry.fileId)?.source === "owner";
      const configPathBinding = hasExactKeys(entry, ["name", "fileId", "format", "officialUrl"])
        && entry.format === "private-config-path" && isHttpsUrl(entry.officialUrl)
        && app.sources.includes(entry.officialUrl)
        && service.privateConfigFiles?.includes(entry.fileId)
        && recipe.privateConfigs?.some((config) => config.id === entry.fileId && config.officialUrl === entry.officialUrl);
      addError(errors, pathBinding || uriBinding || sourcedPathBinding || configPathBinding, `${prefix}: file environment fields are invalid`);
      if (!isPlainObject(entry)) continue;
      addError(errors, ((pathBinding && (/^[A-Z][A-Z0-9_]*_(?:FILE|SECRETFILE)$/.test(entry.name || "")
        || /^FILE__[A-Z][A-Z0-9_]*$/.test(entry.name || "")))
        || ((uriBinding || sourcedPathBinding || configPathBinding) && /^[A-Z][A-Z0-9_]*$/.test(entry.name || "")))
        && !environmentNames.has(entry.name) && (configPathBinding || files.has(entry.fileId)), `${prefix}: file environment reference is invalid`);
      environmentNames.add(entry.name);
      if (!configPathBinding) usedFiles.add(entry.fileId);
    }
    if (service.secretEnvironment !== undefined) {
      addError(errors, Array.isArray(service.secretEnvironment) && service.secretEnvironment.length >= 1
        && service.secretEnvironment.length <= 12, `${prefix}: secret environment is invalid`);
      for (const entry of Array.isArray(service.secretEnvironment) ? service.secretEnvironment : []) {
        if (entry?.format === "private-config") {
          let valid = false;
          try {
            const config = checkedPrivateConfigEnvironment(entry, new Map((recipe.privateConfigs ?? []).map((config) => [config.id, config])));
            valid = !environmentNames.has(entry.name) && !mountedPrivateConfigs.has(config.id)
              && [recipe.source, ...app.sources].includes(entry.officialUrl);
            mountedPrivateConfigs.add(config.id);
          } catch { /* Report an invalid declaration without exposing config or source payloads. */ }
          addError(errors, valid, `${prefix}: private configuration environment binding is invalid`);
          environmentNames.add(entry.name);
          continue;
        }
        const rawBinding = hasExactKeys(entry, ["name", "fileId"]);
        const postgresBinding = hasExactKeys(entry, ["name", "fileId", "format", "username", "host", "port", "database"])
          && entry.format === "postgres-url" && entry.name === "DATABASE_URL"
          && /^[a-z][a-z0-9_]{0,62}$/.test(entry.username || "")
          && /^[a-z][a-z0-9_]{0,62}$/.test(entry.database || "")
          && allServiceIds.has(entry.host) && entry.host !== app.id
          && Number.isInteger(entry.port) && entry.port >= 1 && entry.port <= 65535;
        const ntfyBinding = hasExactKeys(entry, ["name", "fileId", "format"])
          && app.id === "ntfy" && service.id === "ntfy"
          && entry.format === "ntfy-auth-users" && entry.name === "NTFY_AUTH_USERS"
          && entry.fileId === "admin-password"
          && service.environment?.some((value) => value.name === "NTFY_AUTH_FILE" && value.value === "/var/lib/ntfy/user.db")
          && service.environment?.some((value) => value.name === "NTFY_AUTH_DEFAULT_ACCESS" && value.value === "deny-all");
        const bcryptBinding = hasExactKeys(entry, ["name", "fileId", "format"])
          && entry.format === "bcrypt-hash" && /^[A-Z][A-Z0-9_]*_AUTH_HASH$/.test(entry.name || "");
        const ownerTokenBinding = manualJob && hasExactKeys(entry, ["name", "fileId", "format", "officialUrl"])
          && entry.format === "owner-token" && isHttpsUrl(entry.officialUrl)
          && [recipe.source, ...app.sources].includes(entry.officialUrl)
          && recipe.privateFiles.find((file) => file.id === entry.fileId)?.source === "owner";
        const ownerJsonBinding = connector && hasExactKeys(entry, ["name", "fileId", "format", "officialUrl", "jsonFields"])
          && entry.format === "owner-json" && isHttpsUrl(entry.officialUrl)
          && [recipe.source, ...app.sources].includes(entry.officialUrl)
          && recipe.privateFiles.find((file) => file.id === entry.fileId)?.source === "owner"
          && Array.isArray(entry.jsonFields) && entry.jsonFields.length > 0 && entry.jsonFields.length <= 16
          && new Set(entry.jsonFields).size === entry.jsonFields.length
          && entry.jsonFields.every((field) => typeof field === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field));
        addError(errors, (rawBinding || postgresBinding || ntfyBinding || bcryptBinding || ownerTokenBinding || ownerJsonBinding)
          && /^[A-Z][A-Z0-9_]*$/.test(entry.name || "")
          && (SECRET_ENV_NAME_PATTERN.test(entry.name || "") || ownerJsonBinding)
          && !entry.name.endsWith("_FILE") && !environmentNames.has(entry.name)
          && files.has(entry.fileId)
          && recipe.privateFiles.find((file) => file.id === entry.fileId)?.format !== "base64"
          && (ownerTokenBinding || ownerJsonBinding || recipe.privateFiles.find((file) => file.id === entry.fileId)?.source !== "owner"),
          `${prefix}: secret environment binding is invalid`);
        if (isPlainObject(entry)) {
          environmentNames.add(entry.name);
          usedFiles.add(entry.fileId);
        }
      }
    }
    addError(errors, Array.isArray(service.mounts) && service.mounts.length <= 12, `${prefix}: mounts are invalid`);
    const mountTargets = new Set();
    for (const mount of Array.isArray(service.mounts) ? service.mounts : []) {
      const mountKeys = ["name", "target"];
      for (const key of ["kind", "fileId", "hostPath", "readOnly", "shareGroup"]) {
        if (mount && Object.hasOwn(mount, key)) mountKeys.push(key);
      }
      addError(errors, hasExactKeys(mount, mountKeys), `${prefix}: mount fields are invalid`);
      if (!isPlainObject(mount)) continue;
      addError(errors, mount.kind === undefined || ["bind", "volume", "generated-file", "mutable-directory"].includes(mount.kind),
        `${prefix}: mount kind is invalid`);
      if (mount.kind === "volume") {
        addError(errors, hasExactKeys(mount, ["name", "target", "kind"]),
          `${prefix}: named volume fields are invalid`);
      } else if (mount.kind === "generated-file") {
        addError(errors, hasExactKeys(mount, ["name", "target", "kind", "fileId"])
          && configFiles.has(mount.fileId) && !mountedConfigFiles.has(mount.fileId),
        `${prefix}: generated-file mount must reference one unused declared config`);
        mountedConfigFiles.add(mount.fileId);
      } else if (mount.kind === "mutable-directory") {
        addError(errors, hasExactKeys(mount, ["name", "target", "kind", "fileId"]),
          `${prefix}: mutable directory mount fields are invalid`);
      } else {
        addError(errors, mount.fileId === undefined, `${prefix}: only generated-file mounts may reference config files`);
        addError(errors, mount.hostPath === undefined
          || (mount.hostPath === true && mount.kind === "bind" && typeof mount.readOnly === "boolean"),
        `${prefix}: selected host paths require an explicit bind and read-only choice`);
        addError(errors, mount.readOnly === undefined || typeof mount.readOnly === "boolean",
          `${prefix}: bind mount read-only choice is invalid`);
        addError(errors, mount.shareGroup === undefined
          || ID_PATTERN.test(mount.shareGroup),
        `${prefix}: shared bind mounts need a valid share group`);
      }
      const previousMount = mountNames.get(mount.name);
      const sharedVolume = previousMount && mount.kind === "volume"
        && previousMount.kind === "volume" && previousMount.target === mount.target
        && previousMount.service !== service.id;
      addError(errors, ID_PATTERN.test(mount.name || "") && (!previousMount || sharedVolume),
        `${prefix}: mount names must be unique except identical shared named volumes`);
      addError(errors, configFiles.size === 0 || mount.name !== "config-files",
        `${prefix}: config-files is a reserved generated directory`);
      const targetPattern = /^\/[a-zA-Z0-9/_.-]+$/;
      addError(errors, typeof mount.target === "string" && targetPattern.test(mount.target)
        && !mount.target.includes("//") && !mount.target.endsWith("/")
        && !mount.target.split("/").includes(".") && !mount.target.split("/").includes("..")
        && !mountTargets.has(mount.target), `${prefix}: mount target is invalid or duplicated`);
      mountTargets.add(mount.target);
      if (!previousMount) mountNames.set(mount.name, { kind: mount.kind, target: mount.target, service: service.id });
    }
    if (service.publishTargetPort !== null && Number.isInteger(service.publishTargetPort)
      && service.publishTargetPort >= 1 && service.publishTargetPort <= 65535) {
      // The legacy primary port is always TCP and remains tied to the app's selected host port.
      servicePortTargets.add(`tcp:${service.publishTargetPort}`);
    }
    addError(errors, service.additionalPorts === undefined
      || (Array.isArray(service.additionalPorts) && service.additionalPorts.length <= 8),
    `${prefix}: additional port descriptors are invalid`);
    for (const descriptor of Array.isArray(service.additionalPorts) ? service.additionalPorts : []) {
      addError(errors, hasExactKeys(descriptor, ["id", "targetPort", "protocol", "purpose", "required"]),
        `${prefix}: additional port descriptor fields are invalid`);
      if (!isPlainObject(descriptor)) continue;
      const targetKey = `${descriptor.protocol}:${descriptor.targetPort}`;
      addError(errors, ID_PATTERN.test(descriptor.id || "") && !additionalPortIds.has(descriptor.id),
        `${prefix}: additional port IDs must be unique`);
      addError(errors, Number.isInteger(descriptor.targetPort) && descriptor.targetPort >= 1
        && descriptor.targetPort <= 65535 && ["tcp", "udp"].includes(descriptor.protocol)
        && !servicePortTargets.has(targetKey), `${prefix}: additional service port is invalid or duplicated`);
      addError(errors, ["admin", "application", "database", "management", "docker-api"].includes(descriptor.purpose),
        `${prefix}: additional port purpose is invalid`);
      addError(errors, typeof descriptor.required === "boolean", `${prefix}: additional port requiredness is invalid`);
      addError(errors, ID_PATTERN.test(service.id || ""), `${prefix}: additional ports need an exact declared service owner`);
      additionalPortIds.add(descriptor.id);
      if (Number.isInteger(descriptor.targetPort) && ["tcp", "udp"].includes(descriptor.protocol)) {
        servicePortTargets.add(targetKey);
      }
      additionalPortCount += 1;
    }
    const dependencyNames = [];
    for (const dependency of Array.isArray(service.dependsOn) ? service.dependsOn : []) {
      if (typeof dependency === "string") {
        dependencyNames.push(dependency);
        continue;
      }
      addError(errors, hasExactKeys(dependency, ["service", "condition"])
        && typeof dependency.service === "string"
        && ["service_started", "service_healthy"].includes(dependency.condition),
      `${prefix}: dependency fields or condition are invalid`);
      if (typeof dependency?.service === "string") dependencyNames.push(dependency.service);
    }
    addError(errors, Array.isArray(service.dependsOn) && service.dependsOn.length <= 7
      && dependencyNames.length === service.dependsOn.length
      && new Set(dependencyNames).size === dependencyNames.length, `${prefix}: dependencies are invalid`);
    if (service.publishTargetPort !== null) {
      published += 1;
      addError(errors, service.id === app.id && Number.isInteger(service.publishTargetPort)
        && service.publishTargetPort >= 1 && service.publishTargetPort <= 65535,
      `${prefix}: only the app service may publish one valid port`);
    }
    if (service.publishedPortMustMatchTarget !== undefined) {
      addError(errors, service.publishedPortMustMatchTarget === true
        && service.id === app.id && service.publishTargetPort !== null,
      `${prefix}: matching host and target ports require the published app service`);
    }
    if (service.publishTargetPortSource !== undefined) {
      addError(errors, service.publishTargetPortSource === "published-port"
        && service.id === app.id && service.publishTargetPort !== null,
      `${prefix}: selected target port requires the published app service`);
    }
  }
  addError(errors, ids.has(app.id) && ((portless && published === 0) || (!portless && published === 1)),
    `${prefix}: one app service must publish one port unless it is an explicit job or connector`);
  addError(errors, mountedConfigFiles.size === configFiles.size,
    `${prefix}: every generated config must have one exact mount`);
  addError(errors, mountedPrivateConfigs.size === privateConfigs.size,
    `${prefix}: every private configuration needs one exact service binding`);
  addError(errors, additionalPortCount <= 8, `${prefix}: recipe declares too many additional ports`);
  const onboarding = recipe.onboarding;
  addError(errors, !manualJob || onboarding?.kind === "job-credentials",
    `${prefix}: manual jobs need job-credential onboarding, never an administrator`);
  const appService = services.find((service) => service?.id === app.id);
  if (app.id === "prowlarr") {
    addError(errors, services.length === 1 && appService?.mounts?.length === 1
      && appService.mounts[0]?.kind === "volume"
      && appService.mounts[0]?.name === "config"
      && appService.mounts[0]?.target === "/config"
      && recipe.privateFiles?.length === 1
      && recipe.privateFiles[0]?.id === "admin-password",
    `${prefix}: Prowlarr requires one owned config volume and one generated admin password`);
  }
  if (onboarding?.kind === "initial-admin-from-mutable-config") {
    let valid = false;
    try { valid = checkedMutableAdminOnboarding(recipe) !== null; } catch { /* Fixed schema error only. */ }
    addError(errors, valid, `${prefix}: mutable first-user onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "gpg-client-enrollment") {
    addError(errors, app.id === "passbolt" && hasExactKeys(onboarding, ["kind", "officialUrl"])
      && isHttpsUrl(onboarding.officialUrl) && app.sources.includes(onboarding.officialUrl)
      && recipe.privateFiles.every((file) => ["database-password", "database-root-password"].includes(file.id))
      && services.every((service) => (service.secretEnvironment ?? []).length === 0),
    `${prefix}: GPG client enrollment must not invent a local password, API token or active client`);
  } else if (onboarding?.kind === "connector-enrollment") {
    addError(errors, connector && hasExactKeys(onboarding, ["kind", "officialUrl"])
      && isHttpsUrl(onboarding.officialUrl) && [recipe.source, ...app.sources].includes(onboarding.officialUrl),
    `${prefix}: connector enrollment requires an official source and no invented administrator`);
  } else if (onboarding?.kind === "job-credentials") {
    addError(errors, manualJob && hasExactKeys(onboarding, ["kind", "officialUrl"])
      && isHttpsUrl(onboarding.officialUrl) && [recipe.source, ...app.sources].includes(onboarding.officialUrl),
    `${prefix}: job credentials require a manual job without an invented administrator`);
  } else if (onboarding?.kind === "no-account") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl"])
      && isHttpsUrl(onboarding.officialUrl)
      && recipe.privateFiles?.length === 0
      && services.every((service) => Array.isArray(service.fileEnvironment)
        && service.fileEnvironment.length === 0),
    `${prefix}: no-account onboarding must declare no generated credentials`);
  } else if (onboarding?.kind === "generated-api-token") {
    const file = recipe.privateFiles?.find((entry) => entry.id === onboarding.fileId);
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && [recipe.source, ...app.sources].includes(onboarding.officialUrl)
      && file && file.source === undefined
      && ["base64url", "alphanumeric", "hex"].includes(file.format ?? "base64url"),
    `${prefix}: generated API-token onboarding requires a declared generated token`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "external-secret") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && recipe.privateFiles?.filter((file) => file.source === "owner").length === 1
      && recipe.privateFiles?.find((file) => file.id === onboarding.fileId)?.source === "owner"
      && services.some((service) => service.fileEnvironment?.some((binding) =>
        binding.fileId === onboarding.fileId)),
    `${prefix}: external-secret onboarding needs one declared owner credential`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "api-first-admin") {
    addError(errors, app.id === "immich"
      && hasExactKeys(onboarding, ["kind", "adapter", "officialUrl", "username", "email", "name", "fileId", "setupEnvironment"])
      && onboarding.adapter === "immich-v3.2.2"
      && isHttpsUrl(onboarding.officialUrl)
      && onboarding.username === "admin"
      && typeof onboarding.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(onboarding.email)
      && onboarding.email.length <= 254
      && typeof onboarding.name === "string" && onboarding.name.length >= 1 && onboarding.name.length <= 128
      && !/[\r\n\u0000-\u001f\u007f]/.test(onboarding.name)
      && files.has(onboarding.fileId)
      && onboarding.setupEnvironment === "IMMICH_ALLOW_SETUP"
      && appService?.environment?.some((entry) => entry?.name === onboarding.setupEnvironment && entry.value === "true"),
    `${prefix}: API first-admin onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "external-first-admin") {
    addError(errors, app.id === "seerr"
      && hasExactKeys(onboarding, ["kind", "officialUrl", "provider", "providerAppId"])
      && isHttpsUrl(onboarding.officialUrl)
      && onboarding.provider === "media-server"
      && onboarding.providerAppId === "jellyfin"
      && recipe.privateFiles?.length === 0,
    `${prefix}: external first-admin onboarding is invalid`);
  } else if (onboarding?.kind === "manual-first-admin") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "username", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && onboarding.username === "admin"
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId), `${prefix}: manual first-admin onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "seeded-admin-rotation") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "username", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && onboarding.username === "admin"
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId), `${prefix}: seeded-admin rotation onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "manual-first-password") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId), `${prefix}: manual password-only onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "manual-first-email") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "email", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && typeof onboarding.email === "string"
      && onboarding.email.length <= 254
      && /^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(onboarding.email)
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId), `${prefix}: manual email first-admin onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "official-client-first-email") {
    const generated = recipe.privateFiles?.find((file) => file.id === onboarding.fileId);
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && [recipe.source, ...app.sources].includes(onboarding.officialUrl)
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId)
      && generated?.source === undefined
      && [undefined, "base64url", "alphanumeric", "hex"].includes(generated?.format)
      && services.every((service) => [...(service.fileEnvironment ?? []), ...(service.secretEnvironment ?? [])]
        .every((binding) => binding.fileId !== onboarding.fileId))
      && (recipe.privateConfigs ?? []).every((config) => config.parts.every((part) => part.fileId !== onboarding.fileId)),
    `${prefix}: official-client email enrollment needs an unbound generated master password and no invented identity`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "initial-password-from-file") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "fileEnvironment", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && /^[A-Z][A-Z0-9_]*_FILE$/.test(onboarding.fileEnvironment || "")
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId)
      && appService?.fileEnvironment?.some((entry) => entry?.name === onboarding.fileEnvironment
        && entry.fileId === onboarding.fileId), `${prefix}: password-only file onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "initial-admin-password-file") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "username", "fileEnvironment", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && onboarding.username === "admin"
      && /^[A-Z][A-Z0-9_]*_FILE$/.test(onboarding.fileEnvironment || "")
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId)
      && appService?.fileEnvironment?.some((entry) => entry?.name === onboarding.fileEnvironment
        && entry.fileId === onboarding.fileId), `${prefix}: initial-admin password file onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "initial-admin-from-auth-users") {
    addError(errors, app.id === "ntfy"
      && hasExactKeys(onboarding, ["kind", "officialUrl", "username", "secretEnvironment", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && onboarding.username === "admin"
      && onboarding.secretEnvironment === "NTFY_AUTH_USERS"
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId)
      && appService?.secretEnvironment?.some((entry) => entry?.name === "NTFY_AUTH_USERS"
        && entry.fileId === "admin-password" && entry.format === "ntfy-auth-users"),
    `${prefix}: auth-users first-admin onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "http-basic-from-mutable-config") {
    try { checkedHttpBasicOnboarding(recipe); }
    catch { addError(errors, false, `${prefix}: HTTP Basic mutable-config onboarding is invalid`); }
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "initial-admin-from-secret-env") {
    const fixedUsername = onboarding.fixedUsername === true;
    const usernameKeys = fixedUsername ? ["fixedUsername"] : ["usernameEnvironment"];
    const bootstrapServiceId = onboarding.bootstrapServiceId ?? app.id;
    const bootstrapService = recipe.services?.find((service) => service?.id === bootstrapServiceId);
    const serviceKeys = onboarding.bootstrapServiceId === undefined ? [] : ["bootstrapServiceId"];
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "username", ...usernameKeys, ...serviceKeys, "secretEnvironment", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && typeof bootstrapServiceId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bootstrapServiceId)
      && bootstrapService !== undefined
      && typeof onboarding.username === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(onboarding.username)
      && (fixedUsername || /^[A-Z][A-Z0-9_]*$/.test(onboarding.usernameEnvironment || ""))
      && /^[A-Z][A-Z0-9_]*$/.test(onboarding.secretEnvironment || "")
      && SECRET_ENV_NAME_PATTERN.test(onboarding.secretEnvironment)
      && files.has(onboarding.fileId)
      && (fixedUsername || bootstrapService?.environment?.some((entry) => entry?.name === onboarding.usernameEnvironment
        && entry.value === onboarding.username))
      && bootstrapService?.secretEnvironment?.some((entry) => entry?.name === onboarding.secretEnvironment
        && entry.fileId === onboarding.fileId), `${prefix}: secret-environment first-admin onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else if (onboarding?.kind === "initial-admin-email-from-secret-env") {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "email", "emailEnvironment", "secretEnvironment", "fileId"])
      && isHttpsUrl(onboarding.officialUrl)
      && typeof onboarding.email === "string"
      && onboarding.email.length <= 254
      && /^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(onboarding.email)
      && /^[A-Z][A-Z0-9_]*$/.test(onboarding.emailEnvironment || "")
      && /^[A-Z][A-Z0-9_]*$/.test(onboarding.secretEnvironment || "")
      && SECRET_ENV_NAME_PATTERN.test(onboarding.secretEnvironment)
      && onboarding.fileId === "admin-password"
      && files.has(onboarding.fileId)
      && appService?.environment?.some((entry) => entry?.name === onboarding.emailEnvironment
        && entry.value === onboarding.email)
      && appService?.secretEnvironment?.some((entry) => entry?.name === onboarding.secretEnvironment
        && entry.fileId === onboarding.fileId), `${prefix}: email first-admin onboarding is invalid`);
    usedFiles.add(onboarding.fileId);
  } else {
    addError(errors, hasExactKeys(onboarding, ["kind", "officialUrl", "username", "usernameEnvironment", "fileEnvironment", "fileId"])
      && onboarding?.kind === "initial-admin-from-file"
      && isHttpsUrl(onboarding?.officialUrl)
      && typeof onboarding?.username === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(onboarding.username)
      && /^[A-Z][A-Z0-9_]*$/.test(onboarding?.usernameEnvironment || "")
      && /^[A-Z][A-Z0-9_]*_FILE$/.test(onboarding?.fileEnvironment || "")
      && files.has(onboarding?.fileId)
      && appService?.environment?.some((entry) => entry?.name === onboarding.usernameEnvironment
        && entry.value === onboarding.username)
      && appService?.fileEnvironment?.some((entry) => entry?.name === onboarding.fileEnvironment
        && entry.fileId === onboarding.fileId), `${prefix}: first-admin file onboarding is invalid`);
  }
  for (const service of services) {
    if (!isPlainObject(service)) continue;
    for (const dependency of Array.isArray(service.dependsOn) ? service.dependsOn : []) {
      const target = typeof dependency === "string" ? dependency : dependency?.service;
      addError(errors, ids.has(target) && target !== service.id, `${prefix}: dependency must name another service`);
      if (dependency?.condition === "service_healthy") {
        addError(errors, Boolean(services.find((candidate) => candidate?.id === target)?.healthcheck),
          `${prefix}: healthy dependency needs a declared healthcheck`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(services.filter(isPlainObject).map((service) => [service.id, service]));
  const visit = (id) => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn || []) {
      const target = typeof dependency === "string" ? dependency : dependency?.service;
      if (byId.has(target) && !visit(target)) return false;
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  addError(errors, [...byId.keys()].every(visit), `${prefix}: dependency graph contains a cycle`);
  addError(errors, [...files].every((id) => usedFiles.has(id)
    || (connector && recipe.privateFiles.some((file) => file.id === id && file.source === "owner" && file.consumer === "pre-start"))), `${prefix}: every private file needs a consumer`);
  addError(errors, services.find((service) => service?.id === app.id)?.imageTag === app.image.reference,
    `${prefix}: app image must match its catalog record`);
  addError(errors, hasExactKeys(recipe.defaults, ["dataDirectoryName", "hostIp", "publishedPort"])
    && ["127.0.0.1", "::1"].includes(recipe.defaults?.hostIp)
    && ((portless && recipe.defaults?.publishedPort === null)
      || (!portless && Number.isInteger(recipe.defaults?.publishedPort) && recipe.defaults.publishedPort >= 1024
        && recipe.defaults.publishedPort <= 65535)) && recipe.defaults.dataDirectoryName === app.id,
    `${prefix}: private defaults are invalid`);
  addError(errors, hasExactKeys(recipe.storage, ["filesystem", "minimumFreeBytes"])
    && recipe.storage?.filesystem === "local-posix-locks"
    && Number.isInteger(recipe.storage?.minimumFreeBytes) && recipe.storage.minimumFreeBytes >= 1024 * 1024
    && recipe.storage.minimumFreeBytes <= 1024 ** 4, `${prefix}: storage policy is invalid`);
  addError(errors, Array.isArray(recipe.acceptance) && recipe.acceptance.length > 0 && recipe.acceptance.length <= 12,
    `${prefix}: acceptance needs 1 to 12 checks`);
  const acceptanceIds = new Set();
  for (const check of Array.isArray(recipe.acceptance) ? recipe.acceptance : []) {
    addError(errors, hasExactKeys(check, ["description", "id", "method"]), `${prefix}: acceptance fields are invalid`);
    if (!isPlainObject(check)) continue;
    addError(errors, ID_PATTERN.test(check.id || "") && !acceptanceIds.has(check.id)
      && (["browser", "persisted", "api"].includes(check.method) || (manualJob && check.method === "job")
        || (connector && check.method === "connector"))
      && typeof check.description === "string" && check.description.length >= 10
      && check.description.length <= 300, `${prefix}: acceptance check is invalid`);
    acceptanceIds.add(check.id);
  }
  scanForSecretLikeData(recipe, prefix, errors);
  return errors;
}

export function validateAppRecipe(recipe, app) {
  const errors = [];
  const prefix = `recipe ${app.id}`;
  if (isPlainObject(recipe) && recipe.schemaVersion === 2 && recipe.kind === "multi-service-compose") {
    return validateMultiServiceRecipe(recipe, app);
  }
  addError(errors, hasExactKeys(recipe, RECIPE_KEYS), `${prefix}: contains missing or unsupported fields`);
  if (!isPlainObject(recipe)) return errors;
  addError(errors, recipe.schemaVersion === 1 && recipe.kind === "single-service-compose", `${prefix}: unsupported recipe version or kind`);
  addError(errors, recipe.appId === app.id, `${prefix}: app ID must match its folder`);
  addError(errors, recipe.source === app.upstream.repository || app.sources.includes(recipe.source), `${prefix}: source must be an official app source`);
  addError(errors, isPlainObject(recipe.service) && hasExactKeys(recipe.service, RECIPE_SERVICE_KEYS), `${prefix}: service fields are invalid`);
  if (isPlainObject(recipe.service)) {
    const service = recipe.service;
    addError(errors, service.id === app.id, `${prefix}: service ID must match the app`);
    addError(errors, service.imageTag === app.image.reference && isRecipeImageReference(service.imageTag),
      `${prefix}: image reference must match the catalog and must not be latest`);
    addError(errors, service.restart === "unless-stopped" && service.readOnly === false, `${prefix}: unsupported restart or filesystem policy`);
    addError(errors, service.user === "image-default", `${prefix}: the current single-service recipe needs evidenced image-default user`);
    addError(errors, hasExactKeys(service.imageUserEvidence, ["officialUrl", "reason"])
      && isHttpsUrl(service.imageUserEvidence.officialUrl)
      && service.imageUserEvidence.reason === "official-image-runtime-contract", `${prefix}: image-default user needs official evidence`);
    addError(errors, Number.isInteger(service.targetPort) && service.targetPort >= 1 && service.targetPort <= 65535, `${prefix}: invalid target port`);
    addError(errors, typeof service.dataTarget === "string" && /^\/[a-zA-Z0-9/_-]+$/.test(service.dataTarget)
      && !service.dataTarget.includes("//") && !service.dataTarget.split("/").includes("..")
      && !service.dataTarget.endsWith("/"), `${prefix}: invalid data mount target`);
    addError(errors, service.networkInternal === false, `${prefix}: monitoring needs a non-internal bridge for outbound checks`);
  }
  addError(errors, hasExactKeys(recipe.defaults, ["dataDirectoryName", "hostIp", "publishedPort"]), `${prefix}: defaults are invalid`);
  if (isPlainObject(recipe.defaults)) {
    addError(errors, recipe.defaults.hostIp === "127.0.0.1" || recipe.defaults.hostIp === "::1", `${prefix}: default bind must be loopback`);
    addError(errors, Number.isInteger(recipe.defaults.publishedPort) && recipe.defaults.publishedPort >= 1024
      && recipe.defaults.publishedPort <= 65535, `${prefix}: invalid default port`);
    addError(errors, recipe.defaults.dataDirectoryName === app.id, `${prefix}: data directory must match the app`);
  }
  addError(errors, hasExactKeys(recipe.storage, ["filesystem", "minimumFreeBytes"]), `${prefix}: storage policy is invalid`);
  if (isPlainObject(recipe.storage)) {
    addError(errors, recipe.storage.filesystem === "local-posix-locks", `${prefix}: unsupported storage filesystem policy`);
    addError(errors, Number.isInteger(recipe.storage.minimumFreeBytes) && recipe.storage.minimumFreeBytes >= 1024 * 1024
      && recipe.storage.minimumFreeBytes <= 1024 ** 4, `${prefix}: invalid free-space floor`);
  }
  addError(errors, Array.isArray(recipe.acceptance) && recipe.acceptance.length > 0 && recipe.acceptance.length <= 12,
    `${prefix}: acceptance needs 1 to 12 checks`);
  if (Array.isArray(recipe.acceptance)) {
    const ids = new Set();
    for (const check of recipe.acceptance) {
      addError(errors, hasExactKeys(check, ["description", "id", "method"]), `${prefix}: acceptance check fields are invalid`);
      if (!isPlainObject(check)) continue;
      addError(errors, ID_PATTERN.test(check.id || "") && !ids.has(check.id), `${prefix}: acceptance IDs must be unique`);
      ids.add(check.id);
      addError(errors, ["browser", "persisted", "api"].includes(check.method), `${prefix}: acceptance method is invalid`);
      addError(errors, typeof check.description === "string" && check.description.length >= 10
        && check.description.length <= 300, `${prefix}: acceptance description is invalid`);
    }
  }
  scanForSecretLikeData(recipe, prefix, errors);
  return errors;
}

/** Optional goal-to-service coverage; never changes the immutable Compose recipe. */
async function loadBundledDependencies(app, recipe, recipeSha256, directory) {
  const path = join(directory, "apps", app.id, "composition.json");
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return { dependencies: [], sha256: null }; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size > 8192 || await realpath(path) !== path) throw new Error(`Unsafe composition metadata for ${app.id}`);
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 8192) throw new Error(`Oversized composition metadata for ${app.id}`);
  let composition;
  try { composition = JSON.parse(raw); }
  catch { throw new Error(`Invalid composition metadata for ${app.id}`); }
  if (!hasExactKeys(composition, ["schemaVersion", "appId", "recipeSha256", "dependencies"])
    || composition.schemaVersion !== 1 || composition.appId !== app.id
    || recipe.schemaVersion !== 2 || composition.recipeSha256 !== recipeSha256
    || !Array.isArray(composition.dependencies) || composition.dependencies.length < 1
    || composition.dependencies.length > 8) throw new Error(`Composition metadata differs from the exact ${app.id} recipe`);
  const seen = new Set();
  for (const entry of composition.dependencies) {
    const service = recipe.services.find((item) => item.id === entry?.serviceId);
    if (!hasExactKeys(entry, ["appId", "serviceId", "officialUrl"])
      || !ID_PATTERN.test(entry.appId) || seen.has(entry.appId) || !app.dependencies.includes(entry.appId)
      || !service || service.id === app.id || service.publishTargetPort !== null
      || !recipe.services.find((item) => item.id === app.id)?.dependsOn.some((dependency) => {
        if (typeof dependency === "string") return dependency === service.id;
        return dependency.service === service.id;
      })
      || !isHttpUrl(entry.officialUrl) || !entry.officialUrl.startsWith("https://")
      || ![service.imageSource, recipe.source].includes(entry.officialUrl)) {
      throw new Error(`Unproven bundled dependency coverage for ${app.id}`);
    }
    seen.add(entry.appId);
  }
  return { dependencies: composition.dependencies, sha256: createHash("sha256").update(raw).digest("hex") };
}

function canonicalRecipeJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalRecipeJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalRecipeJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** History changes image fields only; all other fields come from the current recipe. */
async function loadRecipeImageHistory(app, recipe, directory) {
  const path = join(directory, "apps", app.id, "recipe-image-history.json");
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size > 16 * 1024 || await realpath(path) !== path) {
    throw new Error(`Unsafe recipe image history for ${app.id}`);
  }
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 16 * 1024) throw new Error(`Oversized recipe image history for ${app.id}`);
  let history;
  try { history = JSON.parse(raw); }
  catch { throw new Error(`Invalid recipe image history for ${app.id}`); }
  if (!hasExactKeys(history, ["schemaVersion", "appId", "recipes"])
    || history.schemaVersion !== 1 || history.appId !== app.id
    || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || !Array.isArray(history.recipes) || history.recipes.length < 1 || history.recipes.length > 16) {
    throw new Error(`Unsupported recipe image history for ${app.id}`);
  }
  const previousRecipes = [];
  const fingerprints = new Set();
  for (const entry of history.recipes) {
    if (!hasExactKeys(entry, ["sha256", "services"]) || !/^[a-f0-9]{64}$/.test(entry.sha256 || "")
      || fingerprints.has(entry.sha256) || !Array.isArray(entry.services)
      || entry.services.length !== recipe.services.length) {
      throw new Error(`Invalid recipe image history entry for ${app.id}`);
    }
    const services = new Map();
    for (const service of entry.services) {
      if (!hasExactKeys(service, ["id", "imageTag", "imageSource"])
        || !recipe.services.some((current) => current.id === service.id) || services.has(service.id)
        || typeof service.imageTag !== "string" || !isHttpsUrl(service.imageSource)) {
        throw new Error(`Invalid recipe image history service for ${app.id}`);
      }
      services.set(service.id, service);
    }
    const previous = structuredClone(recipe);
    for (const service of previous.services) {
      const image = services.get(service.id);
      service.imageTag = image.imageTag;
      service.imageSource = image.imageSource;
    }
    const historicalApp = { ...app, image: { ...app.image,
      reference: previous.services.find((service) => service.id === app.id).imageTag } };
    const errors = validateAppRecipe(previous, historicalApp);
    const sha256 = createHash("sha256").update(canonicalRecipeJson(previous)).digest("hex");
    if (errors.length > 0 || sha256 !== entry.sha256) {
      throw new Error(`Recipe image history differs from the exact ${app.id} template`);
    }
    fingerprints.add(sha256);
    previousRecipes.push(previous);
  }
  return { previousRecipes, sha256: createHash("sha256").update(raw).digest("hex") };
}

export async function loadAppRecipe(catalog, appId, directory = CATALOG_DIRECTORY) {
  const app = catalog.apps.find((candidate) => candidate.id === appId);
  if (!app || !ID_PATTERN.test(appId)) return null;
  const source = await resolveCatalogDirectory(directory);
  await requireCatalogDirectory(join(source, "apps"));
  await requireCatalogDirectory(join(source, "apps", appId));
  const path = join(source, "apps", appId, "recipe.json");
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Unable to inspect recipe for ${appId}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 16 * 1024) {
    throw new Error(`Recipe file is unsafe for ${appId}`);
  }
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 16 * 1024) throw new Error(`Recipe file is too large for ${appId}`);
  let recipe;
  try {
    recipe = JSON.parse(raw);
  } catch {
    throw new Error(`Recipe JSON is invalid for ${appId}`);
  }
  const errors = validateAppRecipe(recipe, app);
  if (errors.length > 0) throw new Error(errors.join(" "));
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const composition = await loadBundledDependencies(app, recipe, sha256, source);
  const loaded = { recipe, sha256, bundledDependencies: composition.dependencies, compositionSha256: composition.sha256 };
  const history = await loadRecipeImageHistory(app, recipe, source);
  if (history) return { ...loaded, previousRecipes: history.previousRecipes, recipeImageHistorySha256: history.sha256 };
  return loaded;
}

export async function validateCatalogRecipes(catalog, directory = CATALOG_DIRECTORY) {
  const errors = [];
  let count = 0;
  const fingerprints = [];
  const loadedRecipes = new Map();
  for (const app of catalog.apps) {
    try {
      const loaded = await loadAppRecipe(catalog, app.id, directory);
      if (loaded) {
        count += 1;
        fingerprints.push([app.id, loaded.sha256]);
        if (loaded.compositionSha256) fingerprints.push([`${app.id}/composition`, loaded.compositionSha256]);
        if (loaded.recipeImageHistorySha256) fingerprints.push([`${app.id}/recipe-image-history`, loaded.recipeImageHistorySha256]);
        loadedRecipes.set(app.id, loaded);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { count, errors, fingerprints, loadedRecipes };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function cliSetupFields(app) {
  if (app.cliSetup) return { cliSetup: app.cliSetup };
  return {};
}

function validateSkillRegistry(registry, errors) {
  const ids = new Set();
  const adapters = new Set();
  const applicationAdapters = new Set();
  const stackAdapters = new Set();
  addError(errors, isPlainObject(registry), "skills: registry must be an object");
  if (!isPlainObject(registry)) {
    return { ids, adapters, applicationAdapters, stackAdapters };
  }
  addError(errors, hasExactKeys(registry, SKILL_REGISTRY_KEYS), "skills: registry contains missing or unsupported fields");
  addError(errors, registry.schemaVersion === 4, "skills: schemaVersion must be 4");
  addError(errors, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(registry.packVersion || ""), "skills: packVersion must be semantic versioning");
  addError(errors, Array.isArray(registry.skills) && registry.skills.length > 0, "skills: records must be a non-empty array");
  if (!Array.isArray(registry.skills)) {
    return { ids, adapters, applicationAdapters, stackAdapters };
  }
  const orderedIds = [];
  for (const record of registry.skills) {
    const label = isPlainObject(record) && isNonEmptyString(record.id) ? record.id : "<unknown>";
    addError(errors, isPlainObject(record), `skill ${label}: record must be an object`);
    if (!isPlainObject(record)) {
      continue;
    }
    addError(errors, hasExactKeys(record, SKILL_RECORD_KEYS), `skill ${label}: contains missing or unsupported fields`);
    addError(errors, /^(?:self-host|selfhost(?:-[a-z0-9]+)*)$/.test(record.id || ""), `skill ${label}: invalid id`);
    addError(errors, ["router", "capability", "adapter", "workflow"].includes(record.kind), `skill ${label}: kind is invalid`);
    addError(errors, ["read-only", "approval-gated-write"].includes(record.risk), `skill ${label}: risk is invalid`);
    addError(errors, ["implicit", "delegated", "explicit"].includes(record.activation), `skill ${label}: activation is invalid`);
    addError(errors, isStringArray(record.delegatesTo), `skill ${label}: delegatesTo must contain skill ids`);
    if (record.kind === "adapter") {
      addError(errors, ADAPTER_SCOPES.has(record.scope), `skill ${label}: adapter scope must be application or stack`);
    }
    if (record.kind !== "adapter") {
      addError(errors, record.scope === null, `skill ${label}: non-adapter scope must be null`);
    }
    if (record.kind === "router") {
      if (record.id === "self-host") {
        addError(errors, record.activation === "explicit", `skill ${label}: public router activation must be explicit`);
      } else {
        addError(errors, record.activation === "implicit", `skill ${label}: internal router activation must be implicit`);
      }
    }
    if (record.kind === "workflow") {
      addError(errors, record.activation === "explicit", `skill ${label}: workflow activation must be explicit`);
    }
    addError(errors, hasExactKeys(record.install, ["group", "requires"]), `skill ${label}: install metadata is invalid`);
    if (isPlainObject(record.install)) {
      addError(errors, INSTALL_GROUPS.has(record.install.group), `skill ${label}: install group is invalid`);
      addError(errors, isStringArray(record.install.requires), `skill ${label}: install requirements must contain skill ids`);
      if (Array.isArray(record.install.requires)) {
        addError(errors, duplicateValues(record.install.requires).length === 0, `skill ${label}: install requirements must be unique`);
      }
      if (record.kind === "workflow") {
        addError(errors, record.install.group === "base", `skill ${label}: workflow must be in the base install group`);
      }
    }
    if (isNonEmptyString(record.id)) {
      ids.add(record.id);
      orderedIds.push(record.id);
      if (record.kind === "adapter") {
        adapters.add(record.id);
        if (record.scope === "application") {
          applicationAdapters.add(record.id);
        }
        if (record.scope === "stack") {
          stackAdapters.add(record.id);
        }
      }
    }
  }
  for (const duplicate of duplicateValues(orderedIds)) {
    errors.push(`skills: duplicate id ${duplicate}`);
  }
  const sortedIds = [...orderedIds].sort((left, right) => left.localeCompare(right));
  addError(errors, JSON.stringify(orderedIds) === JSON.stringify(sortedIds), "skills: records must be sorted by id");
  for (const record of registry.skills) {
    if (!isPlainObject(record) || !Array.isArray(record.delegatesTo)) {
      continue;
    }
    for (const target of record.delegatesTo) {
      addError(errors, ids.has(target), `skill ${record.id}: delegates to missing skill ${target}`);
      addError(errors, target !== record.id, `skill ${record.id}: cannot delegate to itself`);
    }
    if (!isPlainObject(record.install) || !Array.isArray(record.install.requires)) {
      continue;
    }
    for (const target of record.install.requires) {
      addError(errors, ids.has(target), `skill ${record.id}: requires missing skill ${target}`);
      addError(errors, target !== record.id, `skill ${record.id}: cannot require itself`);
    }
  }
  addError(errors, ids.has("selfhost"), "skills: selfhost router record is required");
  addError(errors, adapters.size > 0, "skills: at least one adapter is required");
  return { ids, adapters, applicationAdapters, stackAdapters };
}

function validateAppShape(app, categories, skillContract, errors, runtime = false) {
  const prefix = `app ${app && app.id ? app.id : "<unknown>"}`;
  addError(errors, isPlainObject(app), `${prefix}: record must be an object`);
  if (!isPlainObject(app)) {
    return;
  }
  const appKeys = [...APP_KEYS];
  if (Object.hasOwn(app, "cliSetup")) appKeys.push("cliSetup");
  if (Object.hasOwn(app, "frontend")) appKeys.push("frontend");
  addError(errors, hasExactKeys(app, appKeys), `${prefix}: contains missing or unsupported fields`);
  addError(errors, checkedAppFrontend(app.frontend) !== null, `${prefix}: frontend must declare web HTTP(S), a supported TCP protocol, or none`);
  if (Object.hasOwn(app, "cliSetup")) {
    const cli = app.cliSetup;
    addError(errors, hasExactKeys(cli, ["command", "note", "platform"]), `${prefix}: cliSetup contains missing or unsupported fields`);
    if (isPlainObject(cli)) {
      addError(errors, cli.command === app.id && CLI_APP_COMMANDS.has(cli.command), `${prefix}: cliSetup command has no packaged application adapter`);
      addError(errors, cli.platform === "linux", `${prefix}: cliSetup platform must be linux`);
      addError(errors, isNonEmptyString(cli.note) && cli.note.length >= 3 && cli.note.length <= 300, `${prefix}: cliSetup note must have 3 to 300 characters`);
    }
  }
  addError(errors, ID_PATTERN.test(app.id || ""), `${prefix}: invalid id`);
  addError(errors, !NON_COMPOSE_APP_IDS.has(app.id), `${prefix}: host platforms and protocols are not Compose app choices`);
  addError(errors, isNonEmptyString(app.name), `${prefix}: name is required`);
  addError(errors, isStringArray(app.aliases), `${prefix}: aliases must be strings`);
  addError(errors, isStringArray(app.categories, 1), `${prefix}: categories are required`);
  if (Array.isArray(app.categories)) {
    for (const category of app.categories) {
      addError(errors, categories.has(category), `${prefix}: unknown category ${category}`);
    }
  }
  addError(errors, isStringArray(app.roles, 1), `${prefix}: roles are required`);

  addError(errors, isPlainObject(app.upstream), `${prefix}: upstream object is required`);
  if (isPlainObject(app.upstream)) {
    addError(errors, hasExactKeys(app.upstream, ["docs", "repository", "url"]), `${prefix}: upstream contains missing or unsupported fields`);
    addError(errors, isHttpUrl(app.upstream.url), `${prefix}: upstream.url must be HTTP(S)`);
    if (app.upstream.repository !== null) {
      addError(errors, isHttpUrl(app.upstream.repository), `${prefix}: upstream.repository must be HTTP(S) or null`);
    }
    if (app.upstream.docs !== null) {
      addError(errors, isHttpUrl(app.upstream.docs), `${prefix}: upstream.docs must be HTTP(S) or null`);
    }
  }

  addError(errors, isPlainObject(app.image), `${prefix}: image object is required`);
  if (isPlainObject(app.image)) {
    addError(errors, hasExactKeys(app.image, ["reference", "source", "status"]), `${prefix}: image contains missing or unsupported fields`);
    if (app.image.reference !== null) {
      addError(errors, isNonEmptyString(app.image.reference), `${prefix}: image.reference must be a string or null`);
    }
    addError(errors, IMAGE_SOURCES.has(app.image.source), `${prefix}: invalid image source`);
    addError(errors, IMAGE_STATUSES.has(app.image.status), `${prefix}: invalid image status`);
  }

  addError(errors, isPlainObject(app.lifecycle), `${prefix}: lifecycle object is required`);
  if (isPlainObject(app.lifecycle)) {
    addError(errors, hasExactKeys(app.lifecycle, ["checkedAt", "note", "status"]), `${prefix}: lifecycle contains missing or unsupported fields`);
    addError(errors, LIFECYCLES.has(app.lifecycle.status), `${prefix}: invalid lifecycle status`);
    addError(errors, DATE_PATTERN.test(app.lifecycle.checkedAt || ""), `${prefix}: invalid checkedAt`);
    addError(errors, isNonEmptyString(app.lifecycle.note), `${prefix}: lifecycle note is required`);
  }

  addError(errors, isPlainObject(app.support), `${prefix}: support object is required`);
  if (isPlainObject(app.support)) {
    addError(errors, hasExactKeys(app.support, ["adapterSkill", "automation", "tier"]), `${prefix}: support contains missing or unsupported fields`);
    addError(errors, SUPPORT_LEVELS.has(app.support.automation), `${prefix}: invalid automation support`);
    addError(errors, TIERS.has(app.support.tier), `${prefix}: invalid tier`);
    if (app.support.automation === "managed") {
      addError(errors, isNonEmptyString(app.support.adapterSkill), `${prefix}: managed support requires adapterSkill`);
      addError(errors, /^selfhost-[a-z0-9-]+$/.test(app.support.adapterSkill || ""), `${prefix}: managed adapterSkill must be a selfhost skill id`);
    }
    if (app.support.adapterSkill !== null) {
      addError(errors, skillContract.applicationAdapters.has(app.support.adapterSkill), `${prefix}: adapterSkill ${app.support.adapterSkill} is not available as an application adapter in this skill pack`);
    }
    if (app.support.automation !== "managed") {
      addError(errors, app.support.adapterSkill === null, `${prefix}: only managed support may name adapterSkill`);
    }
  }

  addError(errors, isPlainObject(app.homarr), `${prefix}: homarr object is required`);
  if (isPlainObject(app.homarr)) {
    const homarrKeys = ["integration", "support"];
    if (Object.hasOwn(app.homarr, "iconUrl")) homarrKeys.push("iconUrl");
    addError(errors, hasExactKeys(app.homarr, homarrKeys), `${prefix}: Homarr contains missing or unsupported fields`);
    addError(errors, HOMARR_LEVELS.has(app.homarr.support), `${prefix}: invalid Homarr support`);
    if (Object.hasOwn(app.homarr, "iconUrl")) {
      let safeIcon = false;
      if (typeof app.homarr.iconUrl === "string") {
        try {
          const icon = new URL(app.homarr.iconUrl);
          safeIcon = icon.protocol === "https:" && !icon.username && !icon.password
            && !icon.search && !icon.hash;
        } catch { /* The catalog error below names this field. */ }
      }
      addError(errors, safeIcon, `${prefix}: Homarr iconUrl must be credential-free HTTPS without query or fragment`);
    }
    if (app.homarr.integration !== null) {
      addError(errors, isNonEmptyString(app.homarr.integration), `${prefix}: Homarr integration must be a string or null`);
    }
    if (app.homarr.support === "supported") {
      addError(errors, isNonEmptyString(app.homarr.integration), `${prefix}: supported Homarr record requires an integration name`);
    }
    if (app.homarr.support === "gap" || app.homarr.support === "partial") {
      addError(errors, app.homarr.integration === null, `${prefix}: Homarr gap or partial record must not claim an integration`);
    }
  }

  addError(errors, isStringArray(app.dependencies), `${prefix}: dependencies must be strings`);
  addError(errors, isStringArray(app.alternatives, 0), `${prefix}: alternatives must be a string list`);
  addError(errors, isStringArray(app.security, 1), `${prefix}: security requirements are required`);
  addError(errors, isStringArray(app.pitfalls, 1), `${prefix}: pitfalls are required`);
  addError(errors, isStringArray(app.sources, 1), `${prefix}: primary sources are required`);
  if (Array.isArray(app.sources)) {
    for (const source of app.sources) {
      addError(errors, isHttpUrl(source), `${prefix}: source must be HTTP(S)`);
    }
  }
  if (isPlainObject(app.lifecycle) && isPlainObject(app.support)) {
    if (app.lifecycle.status === "retired") {
      addError(errors, app.support.automation === "retired", `${prefix}: retired lifecycle requires retired automation support`);
    }
    if (app.support.automation === "retired") {
      addError(errors, ["retired", "transitioning"].includes(app.lifecycle.status), `${prefix}: retired automation requires retired or transitioning lifecycle`);
    }
  }
}

function validateRoleShape(role, prefix, appIds, errors) {
  addError(errors, isPlainObject(role), `${prefix}: must be an object`);
  if (!isPlainObject(role)) {
    return;
  }
  addError(errors, hasExactKeys(role, ROLE_KEYS), `${prefix}: contains missing or unsupported fields`);
  addError(errors, ID_PATTERN.test(role.id || ""), `${prefix}: invalid id`);
  addError(errors, isNonEmptyString(role.name), `${prefix}: name is required`);
  addError(errors, typeof role.required === "boolean", `${prefix}: required must be boolean`);
  addError(errors, isStringArray(role.choices, 1), `${prefix}: choices are required`);
  addError(errors, isNonEmptyString(role.reason), `${prefix}: reason is required`);
  addError(errors, isNonEmptyString(role.purpose), `${prefix}: purpose is required`);
  addError(errors, isStringArray(role.gates), `${prefix}: gates must be strings`);
  if (Array.isArray(role.choices)) {
    for (const choice of role.choices) {
      addError(errors, appIds.has(choice), `${prefix}: unknown app choice ${choice}`);
    }
    if (role.default !== null) {
      addError(errors, role.choices.includes(role.default), `${prefix}: default must be a listed choice`);
    }
  }
  if (role.required) {
    addError(errors, role.default !== null, `${prefix}: required role needs a default`);
  }
}

function validateStackShape(stack, categories, appIds, skillContract, errors) {
  const prefix = `stack ${stack && stack.id ? stack.id : "<unknown>"}`;
  addError(errors, isPlainObject(stack), `${prefix}: record must be an object`);
  if (!isPlainObject(stack)) {
    return;
  }
  addError(errors, hasExactKeys(stack, STACK_KEYS), `${prefix}: contains missing or unsupported fields`);
  addError(errors, ID_PATTERN.test(stack.id || ""), `${prefix}: invalid id`);
  addError(errors, isNonEmptyString(stack.name), `${prefix}: name is required`);
  addError(errors, isStringArray(stack.aliases, 1), `${prefix}: aliases are required`);
  addError(errors, isNonEmptyString(stack.summary), `${prefix}: summary is required`);
  addError(errors, isStringArray(stack.categories, 1), `${prefix}: categories are required`);
  if (Array.isArray(stack.categories)) {
    for (const category of stack.categories) {
      addError(errors, categories.has(category), `${prefix}: unknown category ${category}`);
    }
  }
  addError(errors, STACK_SUPPORT.has(stack.automation), `${prefix}: invalid automation support`);
  addError(errors, Array.isArray(stack.roles), `${prefix}: roles are required`);
  const roleIds = [];
  if (Array.isArray(stack.roles)) {
    for (const role of stack.roles) {
      const rolePrefix = `${prefix} role ${role && role.id ? role.id : "<unknown>"}`;
      validateRoleShape(role, rolePrefix, appIds, errors);
      if (!isPlainObject(role)) {
        continue;
      }
      roleIds.push(role.id);
      addError(errors, role.id !== "control-plane", `${rolePrefix}: control-plane is reserved for taxonomy.defaultControlPlane`);
      if (Array.isArray(role.choices)) {
        addError(errors, !role.choices.includes("homarr"), `${rolePrefix}: Homarr comes from taxonomy.defaultControlPlane`);
      }
    }
  }
  for (const duplicate of duplicateValues(roleIds)) {
    errors.push(`${prefix}: duplicate role ${duplicate}`);
  }
  addError(errors, isStringArray(stack.requiredSkills, 1), `${prefix}: requiredSkills are required`);
  if (Array.isArray(stack.requiredSkills)) {
    for (const skill of stack.requiredSkills) {
      addError(errors, /^(?:self-host|selfhost(?:-[a-z0-9]+)*)$/.test(skill), `${prefix}: invalid required skill ${skill}`);
      addError(errors, skillContract.ids.has(skill), `${prefix}: required skill ${skill} is not available in this skill pack`);
      addError(errors, !skillContract.adapters.has(skill), `${prefix}: specialized adapter ${skill} cannot be an implicit required skill`);
    }
    for (const duplicate of duplicateValues(stack.requiredSkills)) {
      errors.push(`${prefix}: duplicate required skill ${duplicate}`);
    }
  }
  addError(errors, isStringArray(stack.gates, 1), `${prefix}: gates are required`);
  addError(errors, isStringArray(stack.acceptance, 1), `${prefix}: acceptance checks are required`);
}

function validateAffiliates(affiliates, errors) {
  addError(errors, isPlainObject(affiliates), "affiliates: registry must be an object");
  if (!isPlainObject(affiliates)) {
    return;
  }
  const rootKeys = Object.keys(affiliates).sort();
  addError(errors, JSON.stringify(rootKeys) === JSON.stringify(["entries", "schemaVersion"]), "affiliates: only schemaVersion and entries are allowed");
  addError(errors, affiliates.schemaVersion === 1, "affiliates: schemaVersion must be 1");
  addError(errors, Array.isArray(affiliates.entries), "affiliates: entries must be an array");
  if (!Array.isArray(affiliates.entries)) {
    return;
  }
  const allowedKeys = ["checkedAt", "disclosure", "enabled", "id", "regions", "url"];
  for (const entry of affiliates.entries) {
    const prefix = `affiliate ${entry && entry.id ? entry.id : "<unknown>"}`;
    addError(errors, isPlainObject(entry), `${prefix}: entry must be an object`);
    if (!isPlainObject(entry)) {
      continue;
    }
    addError(errors, JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(allowedKeys), `${prefix}: contains unsupported fields`);
    addError(errors, ID_PATTERN.test(entry.id || ""), `${prefix}: invalid id`);
    addError(errors, isHttpsUrl(entry.url), `${prefix}: URL must use HTTPS`);
    addError(errors, isNonEmptyString(entry.disclosure), `${prefix}: disclosure is required`);
    addError(errors, isStringArray(entry.regions), `${prefix}: regions must be strings`);
    addError(errors, DATE_PATTERN.test(entry.checkedAt || ""), `${prefix}: invalid checkedAt`);
    addError(errors, typeof entry.enabled === "boolean", `${prefix}: enabled must be boolean`);
  }
}

function validateHomarrSurfaceList(surfaces, kind, expectedCount, errors) {
  const prefix = `Homarr ${kind}`;
  addError(errors, Array.isArray(surfaces), `${prefix}: surfaces must be an array`);
  if (!Array.isArray(surfaces)) {
    return [];
  }
  if (expectedCount !== null) {
    addError(errors, surfaces.length === expectedCount, `${prefix}: expected ${expectedCount} surfaces, found ${surfaces.length}`);
  }
  for (const surface of surfaces) {
    const label = isPlainObject(surface) && isNonEmptyString(surface.identifier) ? surface.identifier : "<unknown>";
    addError(errors, isPlainObject(surface), `${prefix} ${label}: surface must be an object`);
    if (!isPlainObject(surface)) {
      continue;
    }
    addError(errors, hasExactKeys(surface, HOMARR_SURFACE_KEYS), `${prefix} ${label}: contains missing or unsupported fields`);
    addError(errors, /^[A-Za-z][A-Za-z0-9]*$/.test(surface.identifier || ""), `${prefix} ${label}: invalid identifier`);
    addError(errors, isNonEmptyString(surface.displayName), `${prefix} ${label}: displayName is required`);
    const excludedIdentifier = HOMARR_EXCLUDED_VALUES.has(compact(surface.identifier || ""));
    const excludedDisplay = HOMARR_EXCLUDED_VALUES.has(compact(surface.displayName || ""));
    addError(errors, !excludedIdentifier && !excludedDisplay, `${prefix} ${label}: excluded integration values are not permitted`);
  }
  return surfaces;
}

function validateHomarrRegistry(registry, appRecords, errors) {
  addError(errors, isPlainObject(registry), "Homarr registry: must be an object");
  if (!isPlainObject(registry)) {
    return { standard: 0, special: 0, standardCovered: 0, specialCovered: 0, gaps: 0 };
  }
  addError(errors, hasExactKeys(registry, HOMARR_REGISTRY_KEYS), "Homarr registry: contains missing or unsupported fields");
  addError(errors, registry.schemaVersion === 1, "Homarr registry: schemaVersion must be 1");
  addError(errors, DATE_PATTERN.test(registry.checkedAt || ""), "Homarr registry: checkedAt must be a date");
  addError(errors, isStringArray(registry.officialSources, 2), "Homarr registry: at least two official sources are required");
  if (Array.isArray(registry.officialSources)) {
    for (const source of registry.officialSources) {
      addError(errors, isHttpsUrl(source), "Homarr registry: official sources must use HTTPS");
    }
    for (const duplicate of duplicateValues(registry.officialSources)) {
      errors.push(`Homarr registry: duplicate official source ${duplicate}`);
    }
  }

  const standard = validateHomarrSurfaceList(registry.standard, "standard", null, errors);
  const special = validateHomarrSurfaceList(registry.special, "special", null, errors);
  const surfaces = [...standard, ...special].filter(isPlainObject);
  const externalOnly = Array.isArray(registry.externalOnly) ? registry.externalOnly : [];
  addError(errors, Array.isArray(registry.externalOnly)
    && externalOnly.every((id) => typeof id === "string"
      && surfaces.some((surface) => surface.identifier === id))
    && new Set(externalOnly).size === externalOnly.length,
  "Homarr registry: external-only identifiers must be unique known surfaces");
  for (const duplicate of duplicateValues(surfaces.map((surface) => surface.identifier))) {
    errors.push(`Homarr registry: duplicate identifier ${duplicate}`);
  }
  for (const duplicate of duplicateValues(surfaces.map((surface) => surface.displayName))) {
    errors.push(`Homarr registry: duplicate display name ${duplicate}`);
  }

  for (const app of appRecords) {
    const values = [app.id, app.name, app.homarr && app.homarr.integration];
    const hasExcludedValue = values.some((value) => isNonEmptyString(value) && HOMARR_EXCLUDED_VALUES.has(compact(value)));
    addError(errors, !hasExcludedValue, `app ${app.id || "<unknown>"}: excluded Homarr values are not permitted`);
  }

  const supportedApps = appRecords.filter((app) => isPlainObject(app.homarr) && app.homarr.support === "supported");
  for (const duplicate of duplicateValues(supportedApps.map((app) => app.homarr.integration))) {
    errors.push(`Homarr catalog: duplicate supported integration ${duplicate}`);
  }
  for (const app of supportedApps) {
    const matches = surfaces.filter((surface) => surface.displayName === app.homarr.integration);
    addError(errors, matches.length === 1, `app ${app.id}: supported Homarr integration must map to exactly one registry surface`);
  }
  for (const surface of surfaces) {
    const matches = supportedApps.filter((app) => app.homarr.integration === surface.displayName);
    const expected = externalOnly.includes(surface.identifier) ? 0 : 1;
    addError(errors, matches.length === expected,
      `Homarr ${surface.identifier}: registry surface has the wrong Compose catalog mapping`);
  }

  const covered = (surfaceList) => surfaceList.filter((surface) => supportedApps.filter((app) => app.homarr.integration === surface.displayName).length === 1).length;
  return {
    standard: standard.length,
    special: special.length,
    standardCovered: covered(standard),
    specialCovered: covered(special),
    gaps: appRecords.filter((app) => isPlainObject(app.homarr) && app.homarr.support === "gap").length
  };
}

function validateCatalogDocument(catalog, runtime = false) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(catalog)) {
    return {
      valid: false,
      counts: { apps: 0, stacks: 0, categories: 0, affiliates: 0, skills: 0, adapters: 0, homarrStandard: 0, homarrSpecial: 0, homarrStandardCovered: 0, homarrSpecialCovered: 0, homarrGaps: 0 },
      errors: ["catalog: root must be an object"],
      warnings
    };
  }
  addError(errors, hasExactKeys(catalog, ["affiliates", "apps", "homarrIntegrations", "skills", "stacks", "taxonomy"]), "catalog: contains missing or unsupported root fields");
  addError(errors, isPlainObject(catalog.taxonomy), "taxonomy: must be an object");
  const categories = new Set();
  if (isPlainObject(catalog.taxonomy)) {
    addError(errors, hasExactKeys(catalog.taxonomy, ["ambiguousAliases", "categories", "checkedAt", "defaultControlPlane", "schemaVersion"]), "taxonomy: contains missing or unsupported fields");
    addError(errors, catalog.taxonomy.schemaVersion === 2, "taxonomy: schemaVersion must be 2");
    addError(errors, DATE_PATTERN.test(catalog.taxonomy.checkedAt || ""), "taxonomy: checkedAt must be a date");
    addError(errors, isStringArray(catalog.taxonomy.ambiguousAliases), "taxonomy: ambiguousAliases must be strings");
    addError(errors, Array.isArray(catalog.taxonomy.categories), "taxonomy: categories must be an array");
    if (Array.isArray(catalog.taxonomy.categories)) {
      for (const category of catalog.taxonomy.categories) {
        const valid = isPlainObject(category) && ID_PATTERN.test(category.id || "") && isNonEmptyString(category.name) && isNonEmptyString(category.description);
        addError(errors, valid, "taxonomy: every category needs id, name, and description");
        if (isPlainObject(category)) {
          addError(errors, hasExactKeys(category, ["description", "id", "name"]), `taxonomy category ${category.id || "<unknown>"}: contains missing or unsupported fields`);
        }
        if (isPlainObject(category) && isNonEmptyString(category.id)) {
          categories.add(category.id);
        }
      }
    }
  }

  const skillContract = validateSkillRegistry(catalog.skills, errors);
  addError(errors, Array.isArray(catalog.apps), "apps: must be an array");
  const appRecords = Array.isArray(catalog.apps) ? catalog.apps : [];
  const appIds = new Set();
  if (Array.isArray(catalog.apps)) {
    for (const app of appRecords) {
      validateAppShape(app, categories, skillContract, errors, runtime);
      if (isPlainObject(app) && isNonEmptyString(app.id)) {
        appIds.add(app.id);
      }
    }
    for (const duplicate of duplicateValues(appRecords.filter(isPlainObject).map((app) => app.id))) {
      errors.push(`apps: duplicate id ${duplicate}`);
    }
  }

  if (isPlainObject(catalog.taxonomy)) {
    const controlPlane = catalog.taxonomy.defaultControlPlane;
    validateRoleShape(controlPlane, "taxonomy defaultControlPlane", appIds, errors);
    if (isPlainObject(controlPlane)) {
      addError(errors, controlPlane.id === "control-plane", "taxonomy defaultControlPlane: id must be control-plane");
      addError(errors, controlPlane.required === false, "taxonomy defaultControlPlane: must be optional");
      addError(errors, controlPlane.default === "homarr", "taxonomy defaultControlPlane: default must be homarr");
      addError(errors, JSON.stringify(controlPlane.choices) === JSON.stringify(["homarr"]), "taxonomy defaultControlPlane: choices must contain only homarr");
    }
  }

  for (const app of appRecords.filter(isPlainObject)) {
    const alternatives = Array.isArray(app.alternatives) ? app.alternatives : [];
    for (const alternative of alternatives) {
      addError(errors, appIds.has(alternative), `app ${app.id}: unknown alternative ${alternative}`);
      addError(errors, alternative !== app.id, `app ${app.id}: cannot be its own alternative`);
    }
    const dependencies = Array.isArray(app.dependencies) ? app.dependencies : [];
    for (const dependency of dependencies) {
      if (dependency.startsWith("capability:")) {
        continue;
      }
      addError(errors, dependency !== "homarr", `app ${app.id}: Homarr is injected as the default control plane, not implied as a dependency`);
      addError(errors, appIds.has(dependency), `app ${app.id}: unknown dependency ${dependency}`);
    }
  }

  addError(errors, Array.isArray(catalog.stacks), "stacks: must be an array");
  const stackRecords = Array.isArray(catalog.stacks) ? catalog.stacks : [];
  if (Array.isArray(catalog.stacks)) {
    for (const stack of stackRecords) {
      validateStackShape(stack, categories, appIds, skillContract, errors);
    }
    for (const duplicate of duplicateValues(stackRecords.filter(isPlainObject).map((stack) => stack.id))) {
      errors.push(`stacks: duplicate id ${duplicate}`);
    }
    const aliases = [];
    for (const stack of stackRecords) {
      const stackAliases = Array.isArray(stack.aliases) ? stack.aliases : [];
      for (const alias of stackAliases) {
        aliases.push(normalize(alias));
      }
    }
    let ambiguousAliasValues = [];
    if (isPlainObject(catalog.taxonomy) && Array.isArray(catalog.taxonomy.ambiguousAliases)) {
      ambiguousAliasValues = catalog.taxonomy.ambiguousAliases;
    }
    const ambiguousAliases = new Set(ambiguousAliasValues.map(normalize));
    for (const duplicate of duplicateValues(aliases)) {
      if (ambiguousAliases.has(duplicate)) {
        warnings.push(`stacks: intentional ambiguous alias ${duplicate}`);
        continue;
      }
      errors.push(`stacks: duplicate normalized alias ${duplicate}`);
    }
    for (const alias of ambiguousAliases) {
      const occurrences = aliases.filter((candidate) => candidate === alias).length;
      addError(errors, occurrences > 1, `taxonomy: ambiguous alias ${alias} must occur in at least two stacks`);
    }
    const appById = new Map(appRecords.map((app) => [app.id, app]));
    for (const stack of stackRecords) {
      const stackRoles = Array.isArray(stack.roles) ? stack.roles : [];
      for (const role of stackRoles) {
        if (!isPlainObject(role)) {
          continue;
        }
        const defaultApp = appById.get(role.default);
        if (defaultApp) {
          addError(errors, defaultApp.support.automation !== "retired", `stack ${stack.id}: default ${role.default} is retired`);
          if (stack.automation === "managed") {
            addError(errors, defaultApp.support.automation === "managed", `stack ${stack.id}: managed default ${role.default} lacks managed support`);
          }
        }
        const choices = Array.isArray(role.choices) ? role.choices : [];
        for (const choice of choices) {
          const choiceApp = appById.get(choice);
          if (!choiceApp) {
            continue;
          }
          addError(errors, choiceApp.support.automation !== "retired" && choiceApp.lifecycle.status !== "retired", `stack ${stack.id}: choice ${choice} is retired`);
        }
      }
    }
  }

  validateAffiliates(catalog.affiliates, errors);
  const homarrCoverageCounts = validateHomarrRegistry(catalog.homarrIntegrations, appRecords, errors);
  scanForSecretLikeData(catalog.taxonomy, "taxonomy", errors);
  scanForSecretLikeData(catalog.apps, "apps", errors);
  scanForSecretLikeData(catalog.stacks, "stacks", errors);
  scanForSecretLikeData(catalog.skills, "skills", errors);
  scanForSecretLikeData(catalog.affiliates, "affiliates", errors);
  scanForSecretLikeData(catalog.homarrIntegrations, "homarrIntegrations", errors);

  const homarr = appRecords.find((app) => app.id === "homarr");
  addError(errors, Boolean(homarr), "apps: Homarr record is required");
  if (homarr && isPlainObject(homarr.image)) {
    addError(errors, homarr.image.reference === "ghcr.io/homarr-labs/homarr:dev", "app homarr: default development image is not configured");
  } else if (homarr) {
    errors.push("app homarr: default development image is not configured");
  }

  for (const category of categories) {
    const usedByApp = appRecords.some((app) => Array.isArray(app.categories) && app.categories.includes(category));
    const usedByStack = stackRecords.some((stack) => Array.isArray(stack.categories) && stack.categories.includes(category));
    if (!usedByApp && !usedByStack) {
      warnings.push(`taxonomy: unused category ${category}`);
    }
  }

  return {
    valid: errors.length === 0,
    counts: {
      apps: appRecords.length,
      stacks: stackRecords.length,
      categories: categories.size,
      affiliates: isPlainObject(catalog.affiliates) && Array.isArray(catalog.affiliates.entries) ? catalog.affiliates.entries.length : 0,
      skills: skillContract.ids.size,
      adapters: skillContract.adapters.size,
      homarrStandard: homarrCoverageCounts.standard,
      homarrSpecial: homarrCoverageCounts.special,
      homarrStandardCovered: homarrCoverageCounts.standardCovered,
      homarrSpecialCovered: homarrCoverageCounts.specialCovered,
      homarrGaps: homarrCoverageCounts.gaps
    },
    errors,
    warnings
  };
}

export function validateCatalog(catalog, options = {}) {
  try {
    return validateCatalogDocument(catalog, options.runtime === true);
  } catch {
    return {
      valid: false,
      counts: { apps: 0, stacks: 0, categories: 0, affiliates: 0, skills: 0, adapters: 0, homarrStandard: 0, homarrSpecial: 0, homarrStandardCovered: 0, homarrSpecialCovered: 0, homarrGaps: 0 },
      errors: ["catalog: malformed input could not be validated safely"],
      warnings: []
    };
  }
}

export function listApps(catalog, filters = {}) {
  let apps = [...catalog.apps];
  if (filters.category) {
    apps = apps.filter((app) => app.categories.includes(filters.category));
  }
  if (filters.support) {
    apps = apps.filter((app) => app.support.automation === filters.support);
  }
  if (filters.tier) {
    apps = apps.filter((app) => app.support.tier === filters.tier);
  }
  apps.sort((left, right) => left.id.localeCompare(right.id));
  return apps;
}

export function homarrCoverage(catalog, status = null) {
  const registry = catalog.homarrIntegrations;
  const supportedApps = new Map();
  for (const app of catalog.apps) {
    if (app.homarr.support === "supported") {
      supportedApps.set(app.homarr.integration, app);
    }
  }

  const supported = [];
  for (const surface of registry.standard) {
    const app = supportedApps.get(surface.displayName);
    supported.push({
      status: "supported",
      surface: "standard",
      identifier: surface.identifier,
      displayName: surface.displayName,
      appId: app.id,
      appName: app.name,
      lifecycle: app.lifecycle.status,
      automation: app.support.automation
    });
  }
  for (const surface of registry.special) {
    const app = supportedApps.get(surface.displayName);
    supported.push({
      status: "supported",
      surface: "special",
      identifier: surface.identifier,
      displayName: surface.displayName,
      appId: app.id,
      appName: app.name,
      lifecycle: app.lifecycle.status,
      automation: app.support.automation
    });
  }
  supported.sort((left, right) => {
    if (left.surface !== right.surface) {
      return left.surface === "standard" ? -1 : 1;
    }
    return left.identifier.localeCompare(right.identifier);
  });

  const gaps = catalog.apps
    .filter((app) => app.homarr.support === "gap")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((app) => ({
      status: "gap",
      surface: null,
      identifier: null,
      displayName: null,
      appId: app.id,
      appName: app.name,
      lifecycle: app.lifecycle.status,
      automation: app.support.automation
    }));

  let entries = [...supported, ...gaps];
  if (status === "supported") {
    entries = supported;
  }
  if (status === "gap") {
    entries = gaps;
  }
  const standardCovered = registry.standard.filter((surface) => supportedApps.has(surface.displayName)).length;
  const specialCovered = registry.special.filter((surface) => supportedApps.has(surface.displayName)).length;
  return {
    checkedAt: registry.checkedAt,
    officialSources: [...registry.officialSources],
    counts: {
      standard: { covered: standardCovered, total: registry.standard.length },
      special: { covered: specialCovered, total: registry.special.length },
      gaps: gaps.length
    },
    entries
  };
}

function appSearchScore(app, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return { score: 1, matched: "all" };
  }
  const phrases = [app.id, app.name, ...app.aliases].map(normalize);
  let best = 0;
  let matched = null;
  for (const phrase of phrases) {
    if (normalizedQuery === phrase) {
      const score = 10000 + phrase.length;
      if (score > best) {
        best = score;
        matched = phrase;
      }
      continue;
    }
    if (phrase.includes(normalizedQuery) || normalizedQuery.includes(phrase)) {
      const score = 5000 + phrase.length;
      if (score > best) {
        best = score;
        matched = phrase;
      }
    }
  }
  const tokens = normalizedQuery.split(" ");
  const homarrSearch = `homarr ${app.homarr.support} ${app.homarr.integration || ""}`;
  const haystack = normalize([app.id, app.name, ...app.aliases, ...app.categories, ...app.roles, app.lifecycle.status, app.support.automation, app.support.tier, homarrSearch].join(" "));
  const matchingTokens = tokens.filter((token) => haystack.includes(token));
  if (matchingTokens.length === tokens.length) {
    const score = 2000 + matchingTokens.length * 10;
    if (score > best) {
      best = score;
      matched = matchingTokens.join(" ");
    }
  }
  return { score: best, matched };
}

export function searchApps(catalog, query) {
  const results = [];
  let apps = catalog.apps;
  const queryTokens = new Set(normalize(query).split(" "));
  if (queryTokens.has("homarr")) {
    for (const level of ["supported", "partial", "gap"]) {
      if (queryTokens.has(level)) {
        apps = apps.filter((app) => app.homarr.support === level);
      }
    }
  }
  for (const app of apps) {
    const match = appSearchScore(app, query);
    if (match.score > 0) {
      results.push({ app, score: match.score, matched: match.matched });
    }
  }
  results.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.app.id.localeCompare(right.app.id);
  });
  return results;
}

export function findApp(catalog, query) {
  const normalizedQuery = normalize(query);
  return catalog.apps.find((app) => {
    if (normalize(app.id) === normalizedQuery || normalize(app.name) === normalizedQuery) {
      return true;
    }
    return app.aliases.some((alias) => normalize(alias) === normalizedQuery);
  }) || null;
}

function stackScore(stack, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return { score: 0, matched: null };
  }
  const queryTokens = new Set(normalizedQuery.split(" "));
  const phrases = [stack.id, stack.name, ...stack.aliases]
    .filter((phrase) => !(stack.id === "full" && phrase === stack.id))
    .map(normalize);
  let best = 0;
  let matched = null;
  for (const phrase of phrases) {
    if (normalizedQuery === phrase) {
      const score = 10000 + phrase.length;
      if (score > best) {
        best = score;
        matched = phrase;
      }
      continue;
    }
    if (phraseIndex(normalizedQuery, phrase) >= 0) {
      const score = 6000 + phrase.split(" ").length * 100 + phrase.length;
      if (score > best) {
        best = score;
        matched = phrase;
      }
      continue;
    }
    const phraseTokens = phrase.split(" ");
    const allPresent = phraseTokens.every((token) => queryTokens.has(token));
    if (allPresent) {
      const score = 5000 + phraseTokens.length * 1000 + phrase.length;
      if (score > best) {
        best = score;
        matched = phrase;
      }
    }
  }
  return { score: best, matched };
}

function directStackIntents(catalog, query) {
  const normalizedQuery = normalize(query);
  const ambiguousAliases = new Set(catalog.taxonomy.ambiguousAliases.map(normalize));
  const matches = [];
  for (const stack of catalog.stacks) {
    const phrases = [stack.id, stack.name, ...stack.aliases]
      .filter((phrase) => !(stack.id === "full" && phrase === stack.id))
      .map(normalize)
      .filter((phrase) => phrase && !ambiguousAliases.has(phrase));
    let best = null;
    for (const phrase of phrases) {
      const index = phraseIndex(normalizedQuery, phrase);
      if (index < 0) {
        continue;
      }
      const score = phrase.split(" ").length * 1000 + phrase.length;
      if (best === null || score > best.score) {
        best = { matched: phrase, index, score };
      }
    }
    if (best !== null) {
      matches.push({ stack, ...best });
    }
  }
  const unshadowed = matches.filter((candidate) => !matches.some((other) => {
    if (other === candidate || other.score <= candidate.score) {
      return false;
    }
    const candidateEnd = candidate.index + candidate.matched.length;
    const otherEnd = other.index + other.matched.length;
    return other.index <= candidate.index && otherEnd >= candidateEnd;
  }));
  unshadowed.sort((left, right) => {
    if (left.index !== right.index) {
      return left.index - right.index;
    }
    return left.stack.id.localeCompare(right.stack.id);
  });
  return unshadowed;
}

function unresolvedAmbiguousIntents(catalog, query, directIntents) {
  const normalizedQuery = normalize(query);
  const unresolved = [];
  for (const rawAlias of catalog.taxonomy.ambiguousAliases) {
    const alias = normalize(rawAlias);
    const index = phraseIndex(normalizedQuery, alias);
    if (index < 0) {
      continue;
    }
    const owners = catalog.stacks
      .filter((stack) => stack.aliases.some((candidate) => normalize(candidate) === alias))
      .sort((left, right) => left.id.localeCompare(right.id));
    const explicitlyResolved = directIntents.some((intent) => owners.some((owner) => owner.id === intent.stack.id));
    if (explicitlyResolved) {
      continue;
    }
    unresolved.push({
      intent: alias,
      matched: alias,
      requiredAction: "choose-one-before-planning",
      candidates: owners.map((stack) => ({ id: stack.id, name: stack.name }))
    });
  }
  return unresolved;
}

function unavailableResolution(goalId) {
  return {
    kind: "unavailable",
    resolved: false,
    ambiguous: false,
    needsComposition: false,
    needsClarification: false,
    requiredAction: "restore-catalog-feature-or-change-goal",
    stack: null,
    matched: goalId,
    components: [],
    unresolvedIntents: [],
    candidates: []
  };
}

export function resolveStack(catalog, query) {
  const normalizedQuery = normalize(query);
  const fullStack = catalog.stacks.find((candidate) => candidate.id === "full");
  if (normalizedQuery === "full" && !fullStack) {
    return unavailableResolution("full");
  }
  if (normalizedQuery === "full" && fullStack) {
    const stack = fullStack;
    return {
      kind: "single",
      resolved: true,
      ambiguous: false,
      needsComposition: false,
      needsClarification: false,
      requiredAction: null,
      stack,
      matched: "full",
      components: [],
      unresolvedIntents: [],
      candidates: [{ id: stack.id, name: stack.name, score: 1, matched: "full" }]
    };
  }
  const hasGooglePhotos = phraseIndex(normalizedQuery, "google photos") >= 0;
  const hasCloudFileBrand = ["google drive", "microsoft onedrive", "onedrive", "dropbox"]
    .some((phrase) => phraseIndex(normalizedQuery, phrase) >= 0);
  const photosAndFiles = catalog.stacks.find((candidate) => candidate.id === "photos-and-files");
  if (hasGooglePhotos && hasCloudFileBrand && !photosAndFiles) {
    return unavailableResolution("photos-and-files");
  }
  if (hasGooglePhotos && hasCloudFileBrand && photosAndFiles) {
    const stack = photosAndFiles;
    return {
      kind: "single",
      resolved: true,
      ambiguous: false,
      needsComposition: false,
      needsClarification: false,
      requiredAction: null,
      stack,
      matched: "google photos plus cloud files",
      components: [],
      unresolvedIntents: [],
      candidates: [{ id: stack.id, name: stack.name, score: 1, matched: "google photos plus cloud files" }]
    };
  }
  const hasAudiobooks = ["audio books", "audiobooks", "audiobook"]
    .some((phrase) => phraseIndex(normalizedQuery, phrase) >= 0);
  const hasMusic = phraseIndex(normalizedQuery, "music") >= 0;
  const audioLibrary = catalog.stacks.find((candidate) => candidate.id === "audio-library");
  if (hasAudiobooks && hasMusic && !audioLibrary) {
    return unavailableResolution("audio-library");
  }
  if (hasAudiobooks && hasMusic && audioLibrary) {
    const stack = audioLibrary;
    return {
      kind: "single",
      resolved: true,
      ambiguous: false,
      needsComposition: false,
      needsClarification: false,
      requiredAction: null,
      stack,
      matched: "audiobooks plus music",
      components: [],
      unresolvedIntents: [],
      candidates: [{ id: stack.id, name: stack.name, score: 1, matched: "audiobooks plus music" }]
    };
  }
  const directIntents = directStackIntents(catalog, query);
  const unresolvedIntents = unresolvedAmbiguousIntents(catalog, query, directIntents);
  if (directIntents.length > 0 && unresolvedIntents.length > 0) {
    const components = directIntents.map((candidate) => ({
      id: candidate.stack.id,
      name: candidate.stack.name,
      matched: candidate.matched
    }));
    return {
      kind: "composite",
      resolved: false,
      ambiguous: true,
      needsComposition: true,
      needsClarification: true,
      requiredAction: "choose-unresolved-intents-before-planning",
      stack: null,
      matched: null,
      components,
      unresolvedIntents,
      candidates: components
    };
  }
  if (directIntents.length > 1) {
    const components = directIntents.map((candidate) => ({
      id: candidate.stack.id,
      name: candidate.stack.name,
      matched: candidate.matched
    }));
    return {
      kind: "composite",
      resolved: false,
      ambiguous: false,
      needsComposition: true,
      needsClarification: false,
      requiredAction: "confirm-composition-before-planning",
      stack: null,
      matched: null,
      components,
      unresolvedIntents: [],
      candidates: components
    };
  }
  const candidates = [];
  for (const stack of catalog.stacks) {
    const match = stackScore(stack, query);
    if (match.score > 0) {
      candidates.push({ stack, score: match.score, matched: match.matched });
    }
  }
  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.stack.id.localeCompare(right.stack.id);
  });
  if (candidates.length === 0) {
    return { kind: "none", resolved: false, ambiguous: false, needsComposition: false, needsClarification: false, requiredAction: null, stack: null, matched: null, components: [], unresolvedIntents: [], candidates: [] };
  }
  let ambiguous = false;
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    ambiguous = true;
  }
  let kind = "single";
  if (ambiguous) {
    kind = "ambiguous";
  }
  let requiredAction = null;
  if (ambiguous) {
    requiredAction = "choose-one-before-planning";
  }
  return {
    kind,
    resolved: !ambiguous,
    ambiguous,
    needsComposition: false,
    needsClarification: ambiguous,
    requiredAction,
    stack: ambiguous ? null : candidates[0].stack,
    matched: ambiguous ? null : candidates[0].matched,
    components: [],
    unresolvedIntents: [],
    candidates: candidates.slice(0, 5).map((candidate) => ({ id: candidate.stack.id, name: candidate.stack.name, score: candidate.score, matched: candidate.matched }))
  };
}

function applicationStack(app) {
  const rolePurpose = `${app.name} provides ${app.roles.join(" and ").replaceAll("-", " ")} for this private service.`;
  return {
    id: `application-${app.id}`,
    name: app.name,
    aliases: [app.id, app.name, ...app.aliases],
    summary: `Run ${app.name} as one private service with only its required dependencies and Homarr.`,
    categories: app.categories,
    automation: app.support.automation,
    roles: [{
      id: "application",
      name: app.name,
      required: true,
      default: app.id,
      choices: [app.id],
      reason: `The request named ${app.name} explicitly.`,
      purpose: rolePurpose,
      gates: ["storage", "exposure", "secrets"]
    }],
    requiredSkills: ["selfhost-host", "selfhost-compose", "selfhost-verify"],
    gates: ["storage", "exposure", "secrets", "migration"],
    acceptance: [
      `${app.name} is API-ready on its private service route.`,
      `Every required dependency for ${app.name} is reachable on the private project network.`
    ]
  };
}

export function stackForGoalId(catalog, goalId) {
  const stack = catalog.stacks.find((candidate) => candidate.id === goalId);
  if (stack) {
    return stack;
  }
  const prefix = "application-";
  if (!goalId.startsWith(prefix)) {
    return null;
  }
  const app = catalog.apps.find((candidate) => candidate.id === goalId.slice(prefix.length));
  if (!app) {
    return null;
  }
  return applicationStack(app);
}

export function resolveExplicitComponents(catalog, goalIds = [], appIds = []) {
  const components = [];
  const seen = new Set();
  for (const goalId of goalIds) {
    const stack = catalog.stacks.find((candidate) => candidate.id === goalId);
    if (!stack) {
      throw new Error(`Unknown goal ${goalId}. Use catalog menu for available goal IDs.`);
    }
    if (seen.has(stack.id)) {
      throw new Error(`Goal ${goalId} was selected more than once.`);
    }
    seen.add(stack.id);
    components.push({ id: stack.id, name: stack.name, matched: goalId });
  }
  for (const appId of appIds) {
    const app = catalog.apps.find((candidate) => candidate.id === appId);
    if (!app) {
      throw new Error(`Unknown app ${appId}. Use catalog search for available app IDs.`);
    }
    if (app.support.automation === "retired" || app.lifecycle.status === "retired") {
      throw new Error(`App ${appId} is retired. Choose an active alternative from catalog show ${appId}.`);
    }
    const id = `application-${app.id}`;
    if (seen.has(id)) {
      throw new Error(`App ${appId} was selected more than once.`);
    }
    seen.add(id);
    components.push({ id, name: app.name, matched: appId });
  }
  if (components.length === 0) {
    throw new Error("Choose at least one --goal or --app.");
  }
  if (components.length === 1) {
    const component = components[0];
    return {
      kind: component.id.startsWith("application-") ? "application" : "single",
      resolved: true,
      ambiguous: false,
      needsComposition: false,
      needsClarification: false,
      requiredAction: null,
      stack: stackForGoalId(catalog, component.id),
      matched: component.matched,
      components: [],
      unresolvedIntents: [],
      candidates: [component]
    };
  }
  return {
    kind: "composite",
    resolved: false,
    ambiguous: false,
    needsComposition: true,
    needsClarification: false,
    requiredAction: "confirm-composition-before-planning",
    stack: null,
    matched: null,
    components,
    unresolvedIntents: [],
    candidates: components
  };
}

function compositeAutomation(stacks) {
  let automation = "managed";
  for (const stack of stacks) {
    if (AUTOMATION_RANK.get(stack.automation) > AUTOMATION_RANK.get(automation)) {
      automation = stack.automation;
    }
  }
  return automation;
}

function compositeSelections(stacks, selections) {
  const translated = {};
  const validKeys = new Set(["control-plane"]);
  const plainRoleOwners = new Map();
  for (const stack of stacks) {
    for (const role of stack.roles) {
      const scopedId = `${stack.id}.${role.id}`;
      validKeys.add(scopedId);
      const owners = plainRoleOwners.get(role.id) || [];
      owners.push(scopedId);
      plainRoleOwners.set(role.id, owners);
    }
  }
  for (const [roleId, selected] of Object.entries(selections)) {
    if (validKeys.has(roleId)) {
      translated[roleId] = selected;
      continue;
    }
    const owners = plainRoleOwners.get(roleId) || [];
    if (owners.length === 1) {
      translated[owners[0]] = selected;
      continue;
    }
    if (owners.length > 1) {
      throw new Error(`Selection role ${roleId} exists in more than one component. Use one of: ${owners.join(", ")}`);
    }
    throw new Error(`Unknown selection role ${roleId}. Choose one of: ${[...validKeys].sort().join(", ")}`);
  }
  return translated;
}

function compositeStack(stacks) {
  const componentIds = stacks.map((stack) => stack.id);
  const componentNames = stacks.map((stack) => stack.name);
  const roles = [];
  const categories = new Set();
  const requiredSkills = new Set();
  const gates = new Set();
  const acceptance = new Set();
  for (const stack of stacks) {
    for (const category of stack.categories) {
      categories.add(category);
    }
    for (const skill of stack.requiredSkills) {
      requiredSkills.add(skill);
    }
    for (const gate of stack.gates) {
      gates.add(gate);
    }
    for (const criterion of stack.acceptance) {
      acceptance.add(criterion);
    }
    for (const role of stack.roles) {
      roles.push({
        ...role,
        id: `${stack.id}.${role.id}`,
        name: `${stack.name}: ${role.name}`
      });
    }
  }
  return {
    id: "composite",
    name: componentNames.join(" + "),
    aliases: [],
    summary: `Combine ${componentNames.join(", ")} in one private project without duplicating shared services.`,
    categories: [...categories].sort(),
    automation: compositeAutomation(stacks),
    roles,
    requiredSkills: [...requiredSkills].sort(),
    gates: [...gates].sort(),
    acceptance: [...acceptance],
    componentGoalIds: componentIds,
    componentGoals: stacks.map((stack) => ({ id: stack.id, name: stack.name }))
  };
}

export function buildCompositePlan(catalog, stacks, selections = {}, preferences = null) {
  if (!Array.isArray(stacks) || stacks.length < 2) {
    throw new Error("Composition requires at least two goal stacks.");
  }
  const componentIds = stacks.map((stack) => stack && stack.id);
  if (componentIds.some((id) => !isNonEmptyString(id))) {
    throw new Error("Composition contains an invalid goal stack.");
  }
  if (new Set(componentIds).size !== componentIds.length) {
    throw new Error("Composition goal stacks must be unique.");
  }
  const stack = compositeStack(stacks);
  return buildPlan(catalog, stack, compositeSelections(stacks, selections), preferences);
}

export function resolvePlanTarget(catalog, query) {
  const normalizedQuery = normalize(query);
  let matches = [];
  const explicitGoal = catalog.stacks.some((stack) => normalize(stack.id) === normalizedQuery);
  if (!explicitGoal) {
    matches = catalog.apps.filter((app) =>
      [app.id, app.name].some((value) => normalize(value) === normalizedQuery)
    );
  }
  const resolution = resolveStack(catalog, query);
  if (matches.length === 0) {
    if (resolution.kind !== "none") {
      return resolution;
    }
    matches = catalog.apps.filter((app) =>
      app.aliases.some((value) => normalize(value) === normalizedQuery)
    );
  }
  if (matches.length === 0) {
    return resolution;
  }
  if (matches.length > 1) {
    return {
      ...resolution,
      kind: "ambiguous",
      ambiguous: true,
      needsClarification: true,
      requiredAction: "choose-one-before-planning",
      candidates: matches.map((app) => ({ id: app.id, name: app.name }))
    };
  }
  const app = matches[0];
  if (app.support.automation === "retired" || app.lifecycle.status === "retired") {
    return {
      ...resolution,
      kind: "retired-application",
      requiredAction: "choose-active-alternative",
      candidates: app.alternatives.map((id) => ({ id, name: catalog.apps.find((candidate) => candidate.id === id)?.name || id }))
    };
  }
  return {
    kind: "application",
    resolved: true,
    ambiguous: false,
    needsComposition: false,
    needsClarification: false,
    requiredAction: null,
    stack: applicationStack(app),
    matched: app.id,
    components: [],
    unresolvedIntents: [],
    candidates: [{ id: app.id, name: app.name, matched: app.id }]
  };
}

function expandDependencies(catalog, selectedIds) {
  const appById = new Map(catalog.apps.map((app) => [app.id, app]));
  const selected = new Set(selectedIds);
  const implied = new Map();
  const capabilities = new Set();
  const queue = [...selectedIds];
  while (queue.length > 0) {
    const appId = queue.shift();
    const app = appById.get(appId);
    if (!app) {
      throw new Error(`Application ${appId} is unavailable in this catalog.`);
    }
    for (const dependency of app.dependencies) {
      if (dependency.startsWith("capability:")) {
        capabilities.add(dependency.slice("capability:".length));
        continue;
      }
      if (selected.has(dependency) || implied.has(dependency)) {
        continue;
      }
      if (!appById.has(dependency)) {
        throw new Error(`Application ${appId} requires unavailable dependency ${dependency}.`);
      }
      implied.set(dependency, { app: dependency, requiredBy: appId });
      queue.push(dependency);
    }
  }
  return { implied: [...implied.values()], capabilities: [...capabilities].sort() };
}

export function buildPlan(catalog, stack, selections = {}, preferences = null) {
  const appById = new Map(catalog.apps.map((app) => [app.id, app]));
  const planRoles = [catalog.taxonomy.defaultControlPlane, ...stack.roles];
  const roleIds = new Set(planRoles.map((role) => role.id));
  for (const roleId of Object.keys(selections).sort()) {
    if (!roleIds.has(roleId)) {
      throw new Error(`Unknown selection role ${roleId}. Choose one of: ${[...roleIds].sort().join(", ")}`);
    }
  }
  const roles = [];
  const selectedIds = [];
  for (const role of planRoles) {
    let selected = role.default;
    if (Object.hasOwn(selections, role.id)) {
      selected = selections[role.id];
    }
    if (selected === "none" || selected === "off") {
      selected = null;
    }
    const selectedApp = appById.get(selected);
    if (selected !== null && !selectedApp) {
      throw new Error(`Application ${selected} is unavailable in this catalog.`);
    }
    if (selectedApp && (selectedApp.support.automation === "retired" || selectedApp.lifecycle.status === "retired")) {
      throw new Error(`Application ${selected} is retired and cannot be selected for a new deployment.`);
    }
    if (selected !== null && !role.choices.includes(selected)) {
      throw new Error(`Invalid selection for role ${role.id}. Choose one of: ${role.choices.join(", ")}`);
    }
    if (role.required && selected === null) {
      throw new Error(`Role ${role.id} is required and cannot be disabled.`);
    }
    if (selected !== null) {
      selectedIds.push(selected);
    }
    roles.push({
      id: role.id,
      name: role.name,
      required: role.required,
      selected,
      reason: role.reason,
      purpose: role.purpose,
      alternatives: role.choices.filter((choice) => choice !== selected),
      gates: role.gates
    });
  }
  if (stack.id === "homarr-control-plane" && !selectedIds.includes("homarr")) {
    throw new Error("This goal is Homarr itself; choose another goal to plan an app-only stack.");
  }

  const dependencies = expandDependencies(catalog, selectedIds);
  const allAppIds = [...new Set([...selectedIds, ...dependencies.implied.map((entry) => entry.app)])];
  const appDetails = allAppIds.map((id) => appById.get(id)).filter(Boolean);
  for (const app of appDetails) {
    if (app.support.automation === "retired" || app.lifecycle.status === "retired") {
      throw new Error(`Application ${app.id} is retired and cannot be selected for a new deployment.`);
    }
  }
  const homarrCoverage = {
    supported: appDetails
      .filter((app) => app.id !== "homarr" && app.homarr.support === "supported")
      .map((app) => ({ id: app.id, name: app.name, integration: app.homarr.integration }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    partial: appDetails
      .filter((app) => app.id !== "homarr" && app.homarr.support === "partial")
      .map((app) => ({ id: app.id, name: app.name }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    gaps: appDetails
      .filter((app) => app.id !== "homarr" && app.homarr.support === "gap")
      .map((app) => ({ id: app.id, name: app.name }))
      .sort((left, right) => left.id.localeCompare(right.id))
  };
  for (const role of roles) {
    if (role.selected === "homarr") {
      role.controlPlaneCoverage = homarrCoverage;
    }
  }
  const gates = new Set(stack.gates);
  for (const role of roles) {
    if (role.selected === null) {
      continue;
    }
    for (const gate of role.gates) {
      gates.add(gate);
    }
  }

  const requiredSkills = new Set(stack.requiredSkills);
  const mediaHarnessApps = ["homarr", "jellyfin", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent"];
  const componentGoalIds = Array.isArray(stack.componentGoalIds) ? stack.componentGoalIds : [];
  const includesPersonalMedia = stack.id === "personal-media" || stack.id === "full"
    || componentGoalIds.includes("personal-media");
  const usesExactMediaHarness = includesPersonalMedia
    && mediaHarnessApps.every((id) => selectedIds.includes(id));
  if (usesExactMediaHarness) {
    requiredSkills.add("selfhost-media");
  }
  for (const app of appDetails) {
    if (app.support.adapterSkill !== null) {
      requiredSkills.add(app.support.adapterSkill);
    }
  }
  if (selectedIds.includes("gluetun")) {
    requiredSkills.add("selfhost-vpn");
  }
  const ingressApps = new Set(["caddy", "traefik", "nginx-proxy-manager", "cloudflare-tunnel", "pangolin"]);
  if (selectedIds.some((id) => ingressApps.has(id))) {
    requiredSkills.add("selfhost-ingress");
  }

  const unresolved = ["Inspect the selected host and classify existing resources as reuse, coexist, or conflict."];
  if (gates.has("storage")) {
    unresolved.push("Confirm logical config, data, media, download, and backup paths plus filesystem constraints.");
  }
  if (gates.has("exposure") || gates.has("public-exposure")) {
    unresolved.push("Confirm exposure class, one ingress owner, DNS/TLS policy, and authentication boundary.");
  }
  if (gates.has("secrets")) {
    unresolved.push("Name secret references for apply without placing secret values in this plan.");
  }
  if (gates.has("vpn")) {
    unresolved.push("Confirm VPN provider, protocol, downloader-only scope, and authority to run the failure test.");
  }
  for (const app of appDetails) {
    if (app.image.reference === null || app.image.status === "unknown" || app.image.status === "verify") {
      unresolved.push(`Verify the current image, tag or host package for ${app.name}.`);
    }
    if (app.support.automation === "discovery") {
      unresolved.push(`Research current deployment facts before applying ${app.name}.`);
    }
  }

  const preferenceChoices = {};
  if (preferences && preferences.choices) {
    for (const [key, record] of Object.entries(preferences.choices)) {
      preferenceChoices[key] = { value: record.value, source: record.source };
    }
  }

  const serviceSummaries = [];
  const summarizedApps = new Set();
  for (const role of roles) {
    if (role.selected === null || summarizedApps.has(role.selected)) {
      continue;
    }
    const app = appById.get(role.selected);
    if (!app) {
      continue;
    }
    serviceSummaries.push({
      id: app.id,
      name: app.name,
      role: role.name,
      purpose: role.purpose,
      selection: "chosen"
    });
    summarizedApps.add(app.id);
  }
  for (const dependency of dependencies.implied) {
    if (summarizedApps.has(dependency.app)) {
      continue;
    }
    const app = appById.get(dependency.app);
    const parent = appById.get(dependency.requiredBy);
    if (!app) {
      continue;
    }
    let parentName = dependency.requiredBy;
    if (parent) {
      parentName = parent.name;
    }
    let purpose = DEPENDENCY_PURPOSES.get(app.id);
    if (!purpose) {
      purpose = `${app.name} provides supporting ${app.roles.join(" and ")} work needed by ${parentName}.`;
    }
    serviceSummaries.push({
      id: app.id,
      name: app.name,
      role: "Required service",
      purpose,
      selection: "dependency"
    });
    summarizedApps.add(app.id);
  }

  const appFingerprints = appDetails.map((app) => ({
    id: app.id,
    dependencies: app.dependencies,
    homarr: app.homarr,
    image: app.image,
    lifecycle: app.lifecycle,
    name: app.name,
    pitfalls: app.pitfalls,
    roles: app.roles,
    security: app.security,
    support: app.support,
    ...cliSetupFields(app),
    upstream: app.upstream
  }));
  const hashInput = JSON.stringify({
    catalogCheckedAt: catalog.taxonomy.checkedAt,
    stack,
    roles: roles.map((role) => [role.id, role.selected]),
    apps: appFingerprints,
    requiredCapabilities: dependencies.capabilities,
    preferences: preferenceChoices
  });
  const planId = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
  const acceptance = new Set(stack.acceptance);
  if (!selectedIds.includes("homarr")) {
    for (const criterion of acceptance) {
      if (/homarr/i.test(criterion)) {
        acceptance.delete(criterion);
      }
    }
    if (stack.id === "full") {
      acceptance.add("The selected media services pass their API, UI, and relationship checks without an automatically chosen indexer.");
    }
  }
  if (selectedIds.includes("homarr")) {
    acceptance.add("Every selected Homarr app tile opens the intended private service.");
    acceptance.add("Every configured Homarr integration authenticates and returns expected data.");
    acceptance.add("Every selected Homarr widget renders data from its intended integration.");
    acceptance.add("The packaged Homarr MCP bridge exposes only the approved profile and a bounded read-only probe succeeds.");
  }
  if (selectedIds.includes("gluetun")) {
    acceptance.add("Breaking the VPN tunnel makes downloader egress fail; restoring it returns only the expected VPN egress.");
    acceptance.add("Control-plane and management traffic remain outside the downloader VPN namespace.");
  }

  let effectiveAutomation = stack.automation;
  for (const app of appDetails) {
    if (AUTOMATION_RANK.get(app.support.automation) > AUTOMATION_RANK.get(effectiveAutomation)) {
      effectiveAutomation = app.support.automation;
    }
  }
  const automationLimiters = [];
  if (stack.automation === effectiveAutomation) {
    automationLimiters.push({ type: "stack", id: stack.id, automation: stack.automation });
  }
  for (const app of appDetails) {
    if (app.support.automation === effectiveAutomation) {
      automationLimiters.push({ type: "app", id: app.id, automation: app.support.automation });
    }
  }

  const setupStages = [];
  const stagedApps = new Set();
  if (includesPersonalMedia) {
    if (usesExactMediaHarness) {
      setupStages.push({
        id: "media",
        owner: "selfhost-media",
        mode: "hybrid",
        automation: "executable",
        apps: mediaHarnessApps,
        note: "Run the seven-service media harness, then verify onboarding and service links. A content source remains a separate user choice."
      });
      for (const id of mediaHarnessApps) stagedApps.add(id);
    } else {
      const mediaCandidates = new Set(["jellyfin", "plex", "emby", "seerr", "sonarr", "radarr", "prowlarr", "qbittorrent", "sabnzbd"]);
      const mediaApps = [...new Set(selectedIds.filter((id) => mediaCandidates.has(id)))];
      if (mediaApps.length > 0) {
        setupStages.push({
          id: "media",
          owner: "selfhost-compose",
          mode: "guided",
          automation: "guided",
          apps: mediaApps,
          note: "The exact seven-service harness does not match this selection. Plan each selected service and verify its relationships without claiming a managed media apply."
        });
        for (const id of mediaApps) stagedApps.add(id);
      }
    }
  }

  if (selectedIds.includes("homarr") && !stagedApps.has("homarr")) {
    setupStages.push({
      id: "dashboard",
      owner: "selfhost-homarr",
      mode: "hybrid",
      automation: "guided",
      apps: ["homarr"],
      note: "Deploy or reuse one Homarr instance and verify its private board and approved MCP profile."
    });
  }

  const nonMediaApps = [];
  for (const id of selectedIds) {
    if (id === "homarr" || stagedApps.has(id) || nonMediaApps.includes(id)) continue;
    nonMediaApps.push(id);
    const app = appById.get(id);
    const owner = "selfhost-compose";
    let mode = "guided";
    let note = "Use the owning capability and current install instructions; verify the app and its required dependencies before linking it to Homarr.";
    if (app?.cliSetup) {
      mode = "hybrid";
      note = app.cliSetup.note;
    }
    setupStages.push({ id: `app-${id}`, owner, mode, automation: "guided", apps: [id], note });
    stagedApps.add(id);
  }
  if (selectedIds.includes("homarr") && nonMediaApps.length > 0) {
    setupStages.push({
      id: "homarr-attachments",
      owner: "selfhost-homarr",
      mode: "hybrid",
      automation: "guided",
      apps: nonMediaApps,
      note: "Add each app tile and update the Notebook recap; claim an integration or widget only after live data proof."
    });
  }

  const mediaStage = setupStages.some((stage) => stage.id === "media");
  const dashboardStage = setupStages.some((stage) => stage.id === "dashboard");
  const setupJobs = setupStages.map((stage) => {
    const needs = [];
    const gates = ["fresh-host-inspection", "exact-apply-approval"];
    if (mediaStage && stage.id.startsWith("app-")) needs.push("media");
    if (dashboardStage && stage.id.startsWith("app-")) {
      needs.push("dashboard");
      gates.push("homarr-onboarded");
    }
    if (mediaStage && ["app-immich", "app-docmost"].includes(stage.id)) {
      gates.push("media-web-network-bound");
    }
    if (stage.id === "homarr-attachments") {
      needs.push(...setupStages.filter((candidate) => candidate.id !== stage.id).map((candidate) => candidate.id));
      gates.push("app-running-on-homarr-bridge");
    }
    if (stage.id === "app-vaultwarden") {
      gates.push("private-https-before-signup", "first-account-before-registration-closure");
    }
    return { id: stage.id, needs, gates, owner: stage.owner, apps: stage.apps };
  });
  const candidateGroups = new Map();
  for (const job of setupJobs) {
    if (!["app-immich", "app-docmost"].includes(job.id)) continue;
    const key = JSON.stringify(job.needs);
    const group = candidateGroups.get(key) ?? { needs: job.needs, jobs: [] };
    group.jobs.push(job.id);
    candidateGroups.set(key, group);
  }
  const parallelGroups = [...candidateGroups.values()].filter((group) => group.jobs.length > 1);
  const parallelCandidates = parallelGroups.flatMap((group) => group.jobs);
  const workflow = {
    mode: "planning-only",
    jobs: setupJobs,
    parallelGroups,
    parallelCandidates,
    note: "A parallel group shares prerequisite jobs, not blanket authority to run. Inspect the host, bind any shared network, check collisions and resource ownership, then obtain each exact approval. This plan does not start jobs or bypass adapter checkpoints."
  };

  const goal = { id: stack.id, name: stack.name, summary: stack.summary, automation: stack.automation };
  if (Array.isArray(stack.componentGoals)) {
    goal.components = structuredClone(stack.componentGoals);
  }
  const summaryGoal = { id: stack.id, name: stack.name };
  if (Array.isArray(stack.componentGoals)) {
    summaryGoal.components = structuredClone(stack.componentGoals);
  }

  return {
    mode: "read-only",
    status: "planned",
    planId,
    catalogCheckedAt: catalog.taxonomy.checkedAt,
    goal,
    effectiveAutomation,
    automationLimiters,
    setupStages,
    workflow,
    roles,
    impliedApps: dependencies.implied,
    requiredCapabilities: dependencies.capabilities,
    requiredSkills: [...requiredSkills].sort(),
    gates: [...gates].sort(),
    acceptance: [...acceptance],
    unresolved,
    preferences: preferenceChoices,
    summary: {
      goal: summaryGoal,
      outcome: `Created a read-only plan for ${stack.name}.`,
      services: serviceSummaries,
      rememberedChoices: Object.keys(preferenceChoices).length,
      currentHost: "not-inspected-by-router",
      changed: [],
      unchanged: ["No host services or files were changed."],
      blockers: unresolved,
      verification: "not-run-by-router",
      next: "Inspect the current host and prove ownership before reusing or changing anything."
    },
    selectedApps: appDetails.map((app) => ({
      id: app.id,
      name: app.name,
      automation: app.support.automation,
      tier: app.support.tier,
      upstream: app.upstream.url,
      image: app.image,
      ...cliSetupFields(app),
      security: app.security,
      pitfalls: app.pitfalls
    }))
  };
}

export function catalogMenu(catalog) {
  const appCounts = new Map();
  for (const category of catalog.taxonomy.categories) {
    appCounts.set(category.id, 0);
  }
  for (const app of catalog.apps) {
    for (const category of app.categories) {
      appCounts.set(category, (appCounts.get(category) || 0) + 1);
    }
  }
  return {
    checkedAt: catalog.taxonomy.checkedAt,
    goals: [...catalog.stacks]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((stack) => ({ id: stack.id, name: stack.name, summary: stack.summary, examples: stack.aliases.slice(0, 2) })),
    categories: catalog.taxonomy.categories.map((category) => ({ id: category.id, name: category.name, apps: appCounts.get(category.id) || 0 }))
  };
}

export { normalize };
