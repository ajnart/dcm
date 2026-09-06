import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIRECTORY = dirname(SCRIPT_DIRECTORY);
export const CATALOG_DIRECTORY = join(SKILL_DIRECTORY, "references", "catalog");

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORT_LEVELS = new Set(["managed", "guided", "discovery", "retired"]);
const TIERS = new Set(["T0", "T1", "T2"]);
const LIFECYCLES = new Set(["active", "transitioning", "verify", "retired"]);
const IMAGE_SOURCES = new Set(["upstream", "vendor", "community", "unknown", "not-applicable"]);
const IMAGE_STATUSES = new Set(["known", "verify", "unknown", "not-applicable"]);
const HOMARR_LEVELS = new Set(["supported", "partial", "gap", "not-applicable"]);
const HOMARR_EXCLUDED_VALUES = new Set(["mock", "searchch", "releaseprovider"]);
const STACK_SUPPORT = new Set(["managed", "guided", "discovery"]);
const ADAPTER_SCOPES = new Set(["application", "stack"]);
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
  ["forgejo", "Stores the source repositories used by the selected automation."],
  ["proxmox", "Runs the virtual machines or containers covered by the backup service."]
]);
const SECRET_FIELD_PATTERN = /(^|[._-])(password|passwd|secret|token|credential|credentials|api[-_]?key|auth[-_]?key|private[-_]?key|cookie|session|encryption[-_]?key)($|[._-])/i;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*(PRIVATE KEY|SECRET)[A-Z ]*-----/i,
  /(?:^|[?&\s])(password|passwd|secret|token|api[_-]?key|private[_-]?key)=\S+/i,
  /^(gh[pousr]_|github_pat_|sk-[A-Za-z0-9]|tskey-|xox[baprs]-|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.)/,
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/,
  /^(?=.{40,}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_+/=-]+$/
];

const APP_KEYS = ["aliases", "alternatives", "categories", "dependencies", "homarr", "id", "image", "lifecycle", "name", "pitfalls", "roles", "security", "sources", "support", "upstream"];
const STACK_KEYS = ["acceptance", "aliases", "automation", "categories", "gates", "id", "name", "requiredSkills", "roles", "summary"];
const REQUIRED_ROLE_KEYS = ["choices", "default", "gates", "id", "name", "purpose", "reason", "required"];
const ROLE_KEYS = [...REQUIRED_ROLE_KEYS, "recommended"];
const HOMARR_REGISTRY_KEYS = ["checkedAt", "officialSources", "schemaVersion", "special", "standard"];
const HOMARR_SURFACE_KEYS = ["displayName", "identifier"];
const SKILL_REGISTRY_KEYS = ["packVersion", "schemaVersion", "skills"];
const SKILL_RECORD_KEYS = ["activation", "delegatesTo", "id", "kind", "risk", "scope"];

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
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read catalog file ${path}: ${error.code || "read error"}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Catalog file is not valid JSON: ${path}`);
  }
}

async function loadRecordDirectory(path) {
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

export async function loadCatalog() {
  const taxonomy = await readJson(join(CATALOG_DIRECTORY, "taxonomy.json"));
  const affiliates = await readJson(join(CATALOG_DIRECTORY, "affiliates.json"));
  const homarrIntegrations = await readJson(join(CATALOG_DIRECTORY, "homarr-integrations.json"));
  const skills = await readJson(join(CATALOG_DIRECTORY, "skills.json"));
  const apps = await loadRecordDirectory(join(CATALOG_DIRECTORY, "apps"));
  const stacks = await loadRecordDirectory(join(CATALOG_DIRECTORY, "stacks"));
  return { taxonomy, affiliates, homarrIntegrations, skills, apps, stacks };
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

function hasRequiredAndAllowedKeys(value, requiredKeys, allowedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }
  const allowed = new Set(allowedKeys);
  return requiredKeys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
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
  addError(errors, registry.schemaVersion === 3, "skills: schemaVersion must be 3");
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
    addError(errors, /^selfhost(?:-[a-z0-9]+)*$/.test(record.id || ""), `skill ${label}: invalid id`);
    addError(errors, ["router", "capability", "adapter"].includes(record.kind), `skill ${label}: kind is invalid`);
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
      addError(errors, record.activation === "implicit", `skill ${label}: router activation must be implicit`);
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
  }
  addError(errors, ids.has("selfhost"), "skills: selfhost router record is required");
  addError(errors, adapters.size > 0, "skills: at least one adapter is required");
  return { ids, adapters, applicationAdapters, stackAdapters };
}

function validateAppShape(app, categories, skillContract, errors) {
  const prefix = `app ${app && app.id ? app.id : "<unknown>"}`;
  addError(errors, isPlainObject(app), `${prefix}: record must be an object`);
  if (!isPlainObject(app)) {
    return;
  }
  addError(errors, hasExactKeys(app, APP_KEYS), `${prefix}: contains missing or unsupported fields`);
  addError(errors, ID_PATTERN.test(app.id || ""), `${prefix}: invalid id`);
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
    addError(errors, hasExactKeys(app.homarr, ["integration", "support"]), `${prefix}: Homarr contains missing or unsupported fields`);
    addError(errors, HOMARR_LEVELS.has(app.homarr.support), `${prefix}: invalid Homarr support`);
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
  addError(errors, isStringArray(app.alternatives, 1), `${prefix}: alternatives are required`);
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
  if (isPlainObject(app.image)) {
    if (app.image.status === "not-applicable" || app.image.source === "not-applicable") {
      addError(errors, app.image.status === "not-applicable" && app.image.source === "not-applicable" && app.image.reference === null, `${prefix}: non-container image facts must be consistently not-applicable`);
    }
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
  addError(errors, Array.isArray(stack.roles) && stack.roles.length > 0, `${prefix}: roles are required`);
  const roleIds = [];
  if (Array.isArray(stack.roles)) {
    for (const role of stack.roles) {
      const rolePrefix = `${prefix} role ${role && role.id ? role.id : "<unknown>"}`;
      addError(errors, isPlainObject(role), `${rolePrefix}: must be an object`);
      if (!isPlainObject(role)) {
        continue;
      }
      addError(errors, hasRequiredAndAllowedKeys(role, REQUIRED_ROLE_KEYS, ROLE_KEYS), `${rolePrefix}: contains missing or unsupported fields`);
      roleIds.push(role.id);
      addError(errors, ID_PATTERN.test(role.id || ""), `${rolePrefix}: invalid id`);
      addError(errors, isNonEmptyString(role.name), `${rolePrefix}: name is required`);
      addError(errors, typeof role.required === "boolean", `${rolePrefix}: required must be boolean`);
      if (Object.hasOwn(role, "recommended")) {
        addError(errors, typeof role.recommended === "boolean", `${rolePrefix}: recommended must be boolean`);
      }
      if (role.recommended === true) {
        addError(errors, role.required === false, `${rolePrefix}: recommended role must be optional`);
        addError(errors, role.default === null, `${rolePrefix}: recommended role must remain off by default`);
      }
      addError(errors, isStringArray(role.choices, 1), `${rolePrefix}: choices are required`);
      addError(errors, isNonEmptyString(role.reason), `${rolePrefix}: reason is required`);
      addError(errors, isNonEmptyString(role.purpose), `${rolePrefix}: purpose is required`);
      addError(errors, isStringArray(role.gates), `${rolePrefix}: gates must be strings`);
      if (Array.isArray(role.choices)) {
        for (const choice of role.choices) {
          addError(errors, appIds.has(choice), `${rolePrefix}: unknown app choice ${choice}`);
        }
        if (role.default !== null) {
          addError(errors, role.choices.includes(role.default), `${rolePrefix}: default must be a listed choice`);
        }
        if (role.choices.includes("homarr")) {
          const isExplicitHomarrGoal = stack.id === "homarr-control-plane";
          if (isExplicitHomarrGoal) {
            addError(errors, role.required === true, `${rolePrefix}: explicit Homarr goal must select its control plane`);
            addError(errors, role.default === "homarr", `${rolePrefix}: explicit Homarr goal must default to Homarr`);
          } else {
            addError(errors, role.recommended === true, `${rolePrefix}: Homarr role must be recommended`);
            addError(errors, role.required === false, `${rolePrefix}: Homarr role must be optional`);
            addError(errors, role.default === null, `${rolePrefix}: Homarr role must remain off by default`);
          }
        }
      }
      if (role.required) {
        addError(errors, role.default !== null, `${rolePrefix}: required role needs a default`);
      }
    }
  }
  for (const duplicate of duplicateValues(roleIds)) {
    errors.push(`${prefix}: duplicate role ${duplicate}`);
  }
  addError(errors, isStringArray(stack.requiredSkills, 1), `${prefix}: requiredSkills are required`);
  if (Array.isArray(stack.requiredSkills)) {
    for (const skill of stack.requiredSkills) {
      addError(errors, /^selfhost(?:-[a-z0-9]+)*$/.test(skill), `${prefix}: invalid required skill ${skill}`);
      addError(errors, skillContract.ids.has(skill), `${prefix}: required skill ${skill} is not available in this skill pack`);
      addError(errors, !skillContract.adapters.has(skill), `${prefix}: specialized adapter ${skill} cannot be an implicit required skill`);
    }
    for (const duplicate of duplicateValues(stack.requiredSkills)) {
      errors.push(`${prefix}: duplicate required skill ${duplicate}`);
    }
  }
  addError(errors, isStringArray(stack.gates, 1), `${prefix}: gates are required`);
  addError(errors, isStringArray(stack.acceptance, 1), `${prefix}: acceptance checks are required`);
  if (Array.isArray(stack.acceptance)) {
    const hasHomarrAcceptance = stack.acceptance.some((check) => /homarr/i.test(check));
    addError(errors, !hasHomarrAcceptance, `${prefix}: Homarr acceptance must be conditional on explicit selection`);
  }
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
  addError(errors, surfaces.length === expectedCount, `${prefix}: expected ${expectedCount} surfaces, found ${surfaces.length}`);
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

  const standard = validateHomarrSurfaceList(registry.standard, "standard", 54, errors);
  const special = validateHomarrSurfaceList(registry.special, "special", 2, errors);
  const surfaces = [...standard, ...special].filter(isPlainObject);
  for (const duplicate of duplicateValues(surfaces.map((surface) => surface.identifier))) {
    errors.push(`Homarr registry: duplicate identifier ${duplicate}`);
  }
  for (const duplicate of duplicateValues(surfaces.map((surface) => surface.displayName))) {
    errors.push(`Homarr registry: duplicate display name ${duplicate}`);
  }

  const expectedSpecial = new Map([
    ["docker", "Docker"],
    ["kubernetes", "Kubernetes"]
  ]);
  for (const [identifier, displayName] of expectedSpecial) {
    const matches = special.filter((surface) => surface.identifier === identifier && surface.displayName === displayName);
    addError(errors, matches.length === 1, `Homarr special: required surface ${identifier} -> ${displayName} is missing or duplicated`);
  }
  for (const surface of special) {
    const expectedDisplay = expectedSpecial.get(surface.identifier);
    addError(errors, expectedDisplay === surface.displayName, `Homarr special ${surface.identifier || "<unknown>"}: unsupported special surface`);
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
    addError(errors, matches.length === 1, `Homarr ${surface.identifier}: registry surface must map to exactly one supported app`);
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

function validateCatalogDocument(catalog) {
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
    addError(errors, hasExactKeys(catalog.taxonomy, ["ambiguousAliases", "categories", "checkedAt", "schemaVersion"]), "taxonomy: contains missing or unsupported fields");
    addError(errors, catalog.taxonomy.schemaVersion === 1, "taxonomy: schemaVersion must be 1");
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
      validateAppShape(app, categories, skillContract, errors);
      if (isPlainObject(app) && isNonEmptyString(app.id)) {
        appIds.add(app.id);
      }
    }
    for (const duplicate of duplicateValues(appRecords.filter(isPlainObject).map((app) => app.id))) {
      errors.push(`apps: duplicate id ${duplicate}`);
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
      addError(errors, dependency !== "homarr", `app ${app.id}: Homarr must be selected through an optional role, not implied as a dependency`);
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
    addError(errors, homarr.image.reference === "ghcr.io/homarr-labs/homarr-test:v2", "app homarr: required test image is not configured");
  } else if (homarr) {
    errors.push("app homarr: required test image is not configured");
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

export function validateCatalog(catalog) {
  try {
    return validateCatalogDocument(catalog);
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
  const phrases = [stack.id, stack.name, ...stack.aliases].map(normalize);
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
  matches.sort((left, right) => {
    if (left.index !== right.index) {
      return left.index - right.index;
    }
    return left.stack.id.localeCompare(right.stack.id);
  });
  return matches;
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

export function resolveStack(catalog, query) {
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
      continue;
    }
    for (const dependency of app.dependencies) {
      if (dependency.startsWith("capability:")) {
        capabilities.add(dependency.slice("capability:".length));
        continue;
      }
      if (selected.has(dependency) || implied.has(dependency)) {
        continue;
      }
      implied.set(dependency, { app: dependency, requiredBy: appId });
      queue.push(dependency);
    }
  }
  return { implied: [...implied.values()], capabilities: [...capabilities].sort() };
}

export function buildPlan(catalog, stack, selections = {}, preferences = null) {
  const appById = new Map(catalog.apps.map((app) => [app.id, app]));
  const roleIds = new Set(stack.roles.map((role) => role.id));
  for (const roleId of Object.keys(selections).sort()) {
    if (!roleIds.has(roleId)) {
      throw new Error(`Unknown selection role ${roleId}. Choose one of: ${[...roleIds].sort().join(", ")}`);
    }
  }
  const roles = [];
  const selectedIds = [];
  for (const role of stack.roles) {
    let selected = role.default;
    if (Object.hasOwn(selections, role.id)) {
      selected = selections[role.id];
    }
    if (selected === "none" || selected === "off") {
      selected = null;
    }
    const selectedApp = appById.get(selected);
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
      recommended: role.recommended === true,
      selected,
      reason: role.reason,
      purpose: role.purpose,
      alternatives: role.choices.filter((choice) => choice !== selected),
      gates: role.gates
    });
  }

  const dependencies = expandDependencies(catalog, selectedIds);
  const allAppIds = [...selectedIds, ...dependencies.implied.map((entry) => entry.app)];
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
    const isHomarrRole = role.selected === "homarr" || role.alternatives.includes("homarr");
    if (isHomarrRole) {
      role.controlPlaneCoverage = homarrCoverage;
    }
  }
  const recommendations = roles
    .filter((role) => role.recommended)
    .map((role) => {
      let suggested = role.selected;
      if (suggested === null) {
        suggested = role.alternatives[0] || null;
      }
      let select = null;
      if (suggested !== null) {
        select = `--select ${role.id}=${suggested}`;
      }
      let status = "available";
      if (role.selected !== null) {
        status = "selected";
      }
      let coverageMode = "dedicated-integrations";
      if (homarrCoverage.supported.length === 0) {
        coverageMode = "app-links-only";
      }
      return {
        id: role.id,
        name: role.name,
        kind: "optional-control-plane",
        status,
        selected: role.selected,
        suggested,
        select,
        coverageMode,
        coverage: homarrCoverage,
        reason: role.reason,
        purpose: role.purpose
      };
    });
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

  return {
    mode: "read-only",
    status: "planned",
    planId,
    catalogCheckedAt: catalog.taxonomy.checkedAt,
    goal: { id: stack.id, name: stack.name, summary: stack.summary, automation: stack.automation },
    effectiveAutomation,
    automationLimiters,
    roles,
    recommendations,
    impliedApps: dependencies.implied,
    requiredCapabilities: dependencies.capabilities,
    requiredSkills: [...requiredSkills].sort(),
    gates: [...gates].sort(),
    acceptance: [...acceptance],
    unresolved,
    preferences: preferenceChoices,
    summary: {
      goal: { id: stack.id, name: stack.name },
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
