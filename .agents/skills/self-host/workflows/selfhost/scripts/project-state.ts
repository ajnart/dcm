import { randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import {
  ensureLocalStateIgnore,
  loadPreferences,
  preferencesPathForProjectRoot,
  withLocalStateLock
} from "./preferences.ts";

export const DEFAULT_PROJECT_STATE_FILE = "project.json";

const CHECKPOINTS = ["intent-recorded", "inspected", "planned", "applied", "verified"];
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const SELECTION_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,126}$/;
const PLAN_ID_PATTERN = /^[a-f0-9]{16}$/;
const CATALOG_SHA_PATTERN = /^[a-f0-9]{64}$/;
const EVIDENCE_ID_PATTERN = /^(?:inspection|apply|verify|manifest):[a-z0-9][a-z0-9._-]{0,31}$/;
const SECRET_LIKE_EVIDENCE_PATTERN = /(?:password|passwd|secret|token|credential|api[-_]?key|private[-_]?key|cookie|session|gh[pousr]_|github_pat_|sk-|tskey-|xox[baprs]-)/i;
const LONG_UNBROKEN_VALUE_PATTERN = /^[a-z0-9]{24,}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export class ProjectStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectStateError";
  }
}

function timestamp() {
  return new Date().toISOString();
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(wanted);
}

function validDateTime(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) {
    return false;
  }
  return validCalendarParts(value.slice(0, 10)) && validTimeParts(value.slice(11, 19));
}

function validCatalogDate(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (ISO_DATE_PATTERN.test(value)) {
    return validCalendarParts(value);
  }
  return validDateTime(value);
}

function validCalendarParts(value) {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function validTimeParts(value) {
  const [hourText, minuteText, secondText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function validateSelections(selections, errors) {
  if (selections === null || typeof selections !== "object" || Array.isArray(selections)) {
    errors.push("Project selections must be an object.");
    return;
  }
  if (Object.keys(selections).length === 0) {
    errors.push("Project selections must include at least one role.");
  }
  for (const [role, app] of Object.entries(selections)) {
    if (!SELECTION_KEY_PATTERN.test(role)) {
      errors.push("Project selection role is invalid.");
    }
    if (app !== null && (typeof app !== "string" || !IDENTIFIER_PATTERN.test(app))) {
      errors.push("Project selection application is invalid.");
    }
  }
}

function validateEvidenceIds(evidenceIds, errors) {
  if (!Array.isArray(evidenceIds)) {
    errors.push("Project checkpoint evidenceIds must be an array.");
    return;
  }
  if (evidenceIds.length > 16) {
    errors.push("Project checkpoint has too many evidence IDs.");
  }
  const unique = new Set();
  for (const evidenceId of evidenceIds) {
    if (typeof evidenceId !== "string" || !EVIDENCE_ID_PATTERN.test(evidenceId)) {
      errors.push("Project checkpoint evidence ID is invalid.");
      continue;
    }
    const value = evidenceId.slice(evidenceId.indexOf(":") + 1);
    if (SECRET_LIKE_EVIDENCE_PATTERN.test(value) || LONG_UNBROKEN_VALUE_PATTERN.test(value)) {
      throw new ProjectStateError("Refused project state: evidence ID looks secret-like.");
    }
    if (unique.has(evidenceId)) {
      errors.push("Project checkpoint evidence IDs must be unique.");
    }
    unique.add(evidenceId);
  }
}

function validateCheckpoint(checkpoint, errors) {
  if (!exactKeys(checkpoint, ["stage", "recordedAt", "evidenceIds"])) {
    errors.push("Project checkpoint contains missing or unsupported fields.");
    return;
  }
  const stageRank = CHECKPOINTS.indexOf(checkpoint.stage);
  if (stageRank < 0) {
    errors.push("Project checkpoint stage is invalid.");
  }
  if (!validDateTime(checkpoint.recordedAt)) {
    errors.push("Project checkpoint recordedAt must be an ISO date-time.");
  }
  validateEvidenceIds(checkpoint.evidenceIds, errors);
  if (!Array.isArray(checkpoint.evidenceIds)) {
    return;
  }
  if (stageRank >= CHECKPOINTS.indexOf("inspected") && !checkpoint.evidenceIds.some((value) => value.startsWith("inspection:"))) {
    errors.push("An inspected checkpoint requires an inspection evidence ID.");
  }
  if (stageRank >= CHECKPOINTS.indexOf("applied") && !checkpoint.evidenceIds.some((value) => value.startsWith("apply:") || value.startsWith("manifest:"))) {
    errors.push("An applied checkpoint requires an apply or manifest evidence ID.");
  }
  if (stageRank >= CHECKPOINTS.indexOf("verified") && !checkpoint.evidenceIds.some((value) => value.startsWith("verify:"))) {
    errors.push("A verified checkpoint requires a verification evidence ID.");
  }
}

export function validateProjectState(document) {
  const errors = [];
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { valid: false, errors: ["Project state contains missing or unsupported fields."] };
  }
  let rootKeys = ["schemaVersion", "revision", "createdAt", "updatedAt", "goalId", "selections", "plan", "checkpoint"];
  if (document.schemaVersion === 2) {
    rootKeys = [...rootKeys, "componentGoalIds"];
  }
  if (document.schemaVersion === 3) {
    rootKeys = [...rootKeys, "componentGoalIds", "catalogSource"];
  }
  if (!exactKeys(document, rootKeys)) {
    return { valid: false, errors: ["Project state contains missing or unsupported fields."] };
  }
  if (document.schemaVersion !== 1 && document.schemaVersion !== 2 && document.schemaVersion !== 3) {
    errors.push("Project state schemaVersion must be 1, 2, or 3.");
  }
  if (!Number.isInteger(document.revision) || document.revision < 1) {
    errors.push("Project state revision must be a positive integer.");
  }
  if (!validDateTime(document.createdAt) || !validDateTime(document.updatedAt)) {
    errors.push("Project state timestamps must be ISO date-times.");
  }
  if (typeof document.goalId !== "string" || !IDENTIFIER_PATTERN.test(document.goalId)) {
    errors.push("Project goalId is invalid.");
  }
  if (document.schemaVersion >= 2) {
    if (!Array.isArray(document.componentGoalIds) || document.componentGoalIds.length === 0) {
      errors.push("Project componentGoalIds must contain at least one goal ID.");
    } else {
      const unique = new Set();
      for (const goalId of document.componentGoalIds) {
        if (typeof goalId !== "string" || !IDENTIFIER_PATTERN.test(goalId)) {
          errors.push("Project component goal ID is invalid.");
          continue;
        }
        if (unique.has(goalId)) {
          errors.push("Project component goal IDs must be unique.");
        }
        unique.add(goalId);
      }
      if (document.componentGoalIds.length === 1 && document.goalId !== document.componentGoalIds[0]) {
        errors.push("A single-goal project must match its component goal ID.");
      }
      if (document.componentGoalIds.length > 1 && document.goalId !== "composite") {
        errors.push("A multi-goal project must use the composite goal ID.");
      }
    }
  }
  if (document.schemaVersion === 3) {
    validateCatalogSource(document.catalogSource, errors);
  }
  validateSelections(document.selections, errors);
  if (!exactKeys(document.plan, ["id", "catalogCheckedAt"])) {
    errors.push("Project plan contains missing or unsupported fields.");
  } else {
    if (typeof document.plan.id !== "string" || !PLAN_ID_PATTERN.test(document.plan.id)) {
      errors.push("Project plan id is invalid.");
    }
    if (!validCatalogDate(document.plan.catalogCheckedAt)) {
      errors.push("Project plan catalogCheckedAt must be an ISO date or date-time.");
    }
  }
  validateCheckpoint(document.checkpoint, errors);
  return { valid: errors.length === 0, errors };
}

function validateCatalogSource(source, errors) {
  if (!exactKeys(source, ["kind", "directory", "sha256", "executionAuthority"])) {
    errors.push("Project catalog source contains missing or unsupported fields.");
    return;
  }
  if (source.kind !== "bundled" && source.kind !== "external") {
    errors.push("Project catalog source kind is invalid.");
  }
  if (typeof source.sha256 !== "string" || !CATALOG_SHA_PATTERN.test(source.sha256)) {
    errors.push("Project catalog source SHA-256 is invalid.");
  }
  if (source.kind === "bundled") {
    if (source.directory !== null || source.executionAuthority !== "packaged") {
      errors.push("Bundled project catalog source must use packaged authority and no directory.");
    }
  } else if (source.kind === "external") {
    const directory = source.directory;
    const absolute = typeof directory === "string"
      && (posix.isAbsolute(directory) || win32.isAbsolute(directory));
    if (!absolute || directory.length > 4096 || directory.includes("\0")
      || source.executionAuthority !== "read-only-declarative") {
      errors.push("External project catalog source must name one absolute directory with read-only authority.");
    }
  }
}

function ensureValidProjectState(document) {
  const validation = validateProjectState(document);
  if (!validation.valid) {
    throw new ProjectStateError(`Project state validation failed: ${validation.errors.join(" ")}`);
  }
}

function effectiveSelections(plan) {
  const selections = {};
  for (const role of plan.roles) {
    selections[role.id] = role.selected;
  }
  return selections;
}

export function planGoalIds(plan) {
  if (Array.isArray(plan.goal.components) && plan.goal.components.length > 0) {
    return plan.goal.components.map((component) => component.id);
  }
  return [plan.goal.id];
}

export function projectGoalIds(document) {
  if (document.schemaVersion >= 2) {
    return [...document.componentGoalIds];
  }
  return [document.goalId];
}

function sameGoalIds(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function projectStatePathForProjectRoot(projectRoot) {
  const preferencePath = await preferencesPathForProjectRoot(projectRoot);
  return join(dirname(preferencePath), DEFAULT_PROJECT_STATE_FILE);
}

async function inspectPrivateDirectory(path, allowCreate) {
  const directory = dirname(path);
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error.code === "ENOENT" && !allowCreate) {
      throw new ProjectStateError("Project state directory does not exist.");
    }
    if (error.code !== "ENOENT") {
      throw new ProjectStateError("Project state directory is unavailable.");
    }
    await mkdir(directory, { mode: 0o700 });
    info = await lstat(directory);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new ProjectStateError("Project state directory must be a real directory.");
  }
  if (await realpath(directory) !== directory) {
    throw new ProjectStateError("Project state directory must not traverse links.");
  }
  if (process.platform !== "win32") {
    if ((info.mode & 0o7077) !== 0) {
      throw new ProjectStateError("Project state directory permissions are too broad; require mode 0700 or stricter.");
    }
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      throw new ProjectStateError("Project state directory must be owned by the current user and group.");
    }
  }
  return directory;
}

async function inspectPrivateFile(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new ProjectStateError("Unable to inspect project state.");
  }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
    throw new ProjectStateError("Project state must be one regular, unlinked file.");
  }
  if (process.platform !== "win32") {
    if ((info.mode & 0o7177) !== 0) {
      throw new ProjectStateError("Project state permissions are too broad; require mode 0600 or stricter.");
    }
    if (info.uid !== process.getuid() || info.gid !== process.getgid()) {
      throw new ProjectStateError("Project state must be owned by the current user and group.");
    }
  }
  return info;
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform.
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

async function writeTemporary(path, document) {
  const suffix = randomBytes(8).toString("hex");
  const temporaryPath = join(dirname(path), `.project.${process.pid}.${suffix}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, 0o600);
    return temporaryPath;
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary path may not exist.
    }
    throw new ProjectStateError(`Unable to write project state safely: ${error.code || "write error"}`);
  }
}

async function withStateLock(path, allowCreateDirectory, operation) {
  const directory = await inspectPrivateDirectory(path, allowCreateDirectory);
  const ignoreResult = await ensureLocalStateIgnore(directory);
  const value = await withLocalStateLock(directory, operation);
  return { value, ignoreCreated: ignoreResult.created };
}

function normalizedPreferences(choices) {
  const normalized = {};
  for (const key of Object.keys(choices || {}).sort()) {
    const record = choices[key];
    normalized[key] = { value: record.value, source: record.source };
  }
  return normalized;
}

async function ensureCurrentPlanPreferences(path, plan) {
  const preferencePath = join(dirname(path), "preferences.json");
  const loaded = await loadPreferences(preferencePath, { allowMissing: true });
  const current = normalizedPreferences(loaded.document.choices);
  const planned = normalizedPreferences(plan.preferences);
  if (JSON.stringify(current) !== JSON.stringify(planned)) {
    throw new ProjectStateError("Project preferences changed during this command. Rebuild the plan and try again.");
  }
}

async function createPrivateFile(path, document) {
  const directory = await inspectPrivateDirectory(path, true);
  await ensureLocalStateIgnore(directory);
  if (await inspectPrivateFile(path)) {
    throw new ProjectStateError("Project state already exists for this project root.");
  }
  const temporaryPath = await writeTemporary(path, document);
  try {
    await link(temporaryPath, path);
    await unlink(temporaryPath);
    await chmod(path, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary path may already be gone.
    }
    if (error.code === "EEXIST") {
      throw new ProjectStateError("Project state already exists for this project root.");
    }
    throw new ProjectStateError(`Unable to create project state safely: ${error.code || "write error"}`);
  }
}

async function replacePrivateFile(path, document) {
  const directory = await inspectPrivateDirectory(path, false);
  await ensureLocalStateIgnore(directory);
  if (!(await inspectPrivateFile(path))) {
    throw new ProjectStateError("Project state does not exist. Run state init first.");
  }
  const temporaryPath = await writeTemporary(path, document);
  try {
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary path may already be gone.
    }
    throw new ProjectStateError(`Unable to replace project state safely: ${error.code || "write error"}`);
  }
}

export async function loadProjectState(path, options = {}) {
  try {
    await inspectPrivateDirectory(path, false);
  } catch (error) {
    if (options.allowMissing && error instanceof ProjectStateError && error.message === "Project state directory does not exist.") {
      return { path, exists: false, document: null };
    }
    throw error;
  }
  const info = await inspectPrivateFile(path);
  if (!info) {
    if (options.allowMissing) {
      return { path, exists: false, document: null };
    }
    throw new ProjectStateError("Project state does not exist. Run state init first.");
  }
  let document;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new ProjectStateError("Project state is unreadable or invalid JSON.");
  }
  ensureValidProjectState(document);
  return { path, exists: true, document };
}

export async function initProjectState(path, plan, verifyCatalogSource) {
  const recordedAt = timestamp();
  const componentGoalIds = planGoalIds(plan);
  const document = {
    schemaVersion: 3,
    revision: 1,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    goalId: plan.goal.id,
    componentGoalIds,
    catalogSource: structuredClone(plan.catalogSource),
    selections: effectiveSelections(plan),
    plan: { id: plan.planId, catalogCheckedAt: plan.catalogCheckedAt },
    checkpoint: { stage: "intent-recorded", recordedAt, evidenceIds: [] }
  };
  ensureValidProjectState(document);
  const locked = await withStateLock(path, true, async () => {
    await ensureCurrentPlanPreferences(path, plan);
    await verifyCatalogSource();
    await createPrivateFile(path, document);
  });
  return { path, created: true, document, ignoreCreated: locked.ignoreCreated };
}

export async function reviseProjectState(path, plan, expectedRevision, verifyCatalogSource) {
  const locked = await withStateLock(path, false, async () => {
    const loaded = await loadProjectState(path);
    if (loaded.document.revision !== expectedRevision) {
      throw new ProjectStateError("Project state changed during this command. Reload it and try again.");
    }
    if (loaded.document.goalId !== plan.goal.id || !sameGoalIds(projectGoalIds(loaded.document), planGoalIds(plan))) {
      throw new ProjectStateError("A project record cannot be reassigned to a different goal. Use a different project root.");
    }
    await ensureCurrentPlanPreferences(path, plan);
    await verifyCatalogSource();
    const selections = effectiveSelections(plan);
    const sameSelections = JSON.stringify(selections) === JSON.stringify(loaded.document.selections);
    const sameCatalogSource = samePlanCatalogSource(loaded.document, plan);
    if (loaded.document.schemaVersion === 3 && sameSelections
      && loaded.document.plan.id === plan.planId && sameCatalogSource) {
      return { path, updated: false, document: loaded.document };
    }
    const recordedAt = timestamp();
    loaded.document.revision += 1;
    loaded.document.schemaVersion = 3;
    loaded.document.componentGoalIds = planGoalIds(plan);
    loaded.document.updatedAt = recordedAt;
    loaded.document.selections = selections;
    loaded.document.catalogSource = structuredClone(plan.catalogSource);
    loaded.document.plan = { id: plan.planId, catalogCheckedAt: plan.catalogCheckedAt };
    loaded.document.checkpoint = { stage: "intent-recorded", recordedAt, evidenceIds: [] };
    ensureValidProjectState(loaded.document);
    await replacePrivateFile(path, loaded.document);
    return { path, updated: true, document: loaded.document };
  });
  return { ...locked.value, ignoreCreated: locked.ignoreCreated };
}

export async function checkpointProjectState(path, stage, evidenceIds, plan, expectedRevision,
  verifyCatalogSource) {
  const locked = await withStateLock(path, false, async () => {
    const loaded = await loadProjectState(path);
    if (loaded.document.schemaVersion < 3) {
      throw new ProjectStateError("Legacy project state needs state revise before recording a new checkpoint.");
    }
    if (loaded.document.revision !== expectedRevision) {
      throw new ProjectStateError("Project state changed during this command. Reload it and try again.");
    }
    await ensureCurrentPlanPreferences(path, plan);
    await verifyCatalogSource();
    if (!CHECKPOINTS.includes(stage) || stage === "intent-recorded") {
      throw new ProjectStateError("Checkpoint stage must be inspected, planned, applied, or verified.");
    }
    const currentRank = CHECKPOINTS.indexOf(loaded.document.checkpoint.stage);
    const requestedRank = CHECKPOINTS.indexOf(stage);
    if (requestedRank < currentRank || requestedRank > currentRank + 1) {
      throw new ProjectStateError("Checkpoint stages must advance one step at a time and cannot move backward.");
    }
    if (plan.goal.id !== loaded.document.goalId || !sameGoalIds(planGoalIds(plan), projectGoalIds(loaded.document))) {
      throw new ProjectStateError("Current catalog plan does not match the recorded project goal.");
    }
    if (loaded.document.plan.id !== plan.planId || loaded.document.plan.catalogCheckedAt !== plan.catalogCheckedAt) {
      throw new ProjectStateError("The current plan differs from saved project state. Run state revise before recording progress.");
    }
    if (!samePlanCatalogSource(loaded.document, plan)) {
      throw new ProjectStateError("The catalog source changed. Run state revise before recording progress.");
    }
    const selections = effectiveSelections(plan);
    if (JSON.stringify(selections) !== JSON.stringify(loaded.document.selections)) {
      throw new ProjectStateError("Current role selections do not match the recorded project state.");
    }
    const recordedAt = timestamp();
    const checkpointErrors = [];
    validateEvidenceIds(evidenceIds, checkpointErrors);
    if (Array.isArray(evidenceIds)) {
      if (stage === "inspected" && !evidenceIds.some((value) => value.startsWith("inspection:"))) {
        checkpointErrors.push("An inspected checkpoint requires a new inspection evidence ID.");
      }
      if (stage === "applied" && !evidenceIds.some((value) => value.startsWith("apply:") || value.startsWith("manifest:"))) {
        checkpointErrors.push("An applied checkpoint requires a new apply or manifest evidence ID.");
      }
      if (stage === "verified" && !evidenceIds.some((value) => value.startsWith("verify:"))) {
        checkpointErrors.push("A verified checkpoint requires a new verification evidence ID.");
      }
    }
    if (checkpointErrors.length > 0) {
      throw new ProjectStateError(`Project checkpoint validation failed: ${checkpointErrors.join(" ")}`);
    }
    const combinedEvidence = [...loaded.document.checkpoint.evidenceIds, ...evidenceIds];
    loaded.document.revision += 1;
    loaded.document.updatedAt = recordedAt;
    loaded.document.plan = { id: plan.planId, catalogCheckedAt: plan.catalogCheckedAt };
    loaded.document.checkpoint = { stage, recordedAt, evidenceIds: [...new Set(combinedEvidence)].sort() };
    ensureValidProjectState(loaded.document);
    await replacePrivateFile(path, loaded.document);
    return { path, updated: true, document: loaded.document };
  });
  return { ...locked.value, ignoreCreated: locked.ignoreCreated };
}

export function projectFreshness(document, plan) {
  return {
    recorded: true,
    savedCheckpoint: document.checkpoint.stage,
    savedAt: document.updatedAt,
    planChanged: document.plan.id !== plan.planId,
    catalogChanged: document.plan.catalogCheckedAt !== plan.catalogCheckedAt
      || !samePlanCatalogSource(document, plan),
    freshInspectionRequired: true,
    ownershipRevalidationRequired: true,
    savedEvidenceStatus: "stale-until-rechecked"
  };
}

function samePlanCatalogSource(document, plan) {
  if (document.schemaVersion < 3) return false;
  return JSON.stringify(document.catalogSource) === JSON.stringify(plan.catalogSource);
}

export function publicProjectState(document) {
  return structuredClone(document);
}
