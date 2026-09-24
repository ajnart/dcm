#!/usr/bin/env bun

import crypto from "node:crypto";
import fs from "node:fs";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ITEMS = 100;
const MAX_DEPTH = 12;
const MAX_STRING = 2048;
const LABEL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const DOCKER_CONTEXT = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]{0,126}[a-zA-Z0-9])?$/;
const OPAQUE_REF = /^[a-z0-9][a-z0-9._:/-]{2,255}$/i;
const SENSITIVE_KEYS = /password|passwd|token|api[-_]?key|private[-_]?key|credential|secret|cookie/i;
const MUTATION_KEYS = /^(?:command|commands|executed|execution|verified|verification|docker|compose)$/i;
const FLOATING = /^(?:latest|stable|edge|main|master|nightly|rolling|current|head|dev|next|lts)$/i;

class ValidationError extends Error {}

function usage() {
  process.stdout.write("Usage: plan-operation.ts <validate|plan> --input FILE\n");
}

function reject(message) {
  throw new ValidationError(message);
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    usage();
    process.exit(0);
  }
  const action = argv[0];
  if (action !== "validate" && action !== "plan") {
    reject("unsupported action");
  }
  if (argv.length !== 3 || argv[1] !== "--input" || !argv[2]) {
    reject("provide exactly --input FILE");
  }
  return { action, input: argv[2] };
}

function readInput(inputPath) {
  let stat;
  try {
    stat = fs.lstatSync(inputPath);
  } catch {
    reject("input file is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    reject("input must be a regular non-symlink file");
  }
  if (stat.size > MAX_INPUT_BYTES) {
    reject("input exceeds 256 KiB");
  }
  const content = fs.readFileSync(inputPath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_INPUT_BYTES) {
    reject("input exceeds 256 KiB");
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    reject("input is not valid JSON");
  }
  assertBoundedAndSecretFree(parsed);
  return parsed;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertBoundedAndSecretFree(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    reject("input nesting exceeds the supported limit");
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) {
      reject("an input collection exceeds 100 items");
    }
    for (const item of value) {
      assertBoundedAndSecretFree(item, depth + 1);
    }
    return;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_ITEMS) {
      reject("an input object exceeds 100 fields");
    }
    for (const [key, child] of entries) {
      if (key.length > 128) {
        reject("an input field name exceeds the supported limit");
      }
      if (SENSITIVE_KEYS.test(key)) {
        reject("plaintext secret-bearing fields are not accepted; use opaque references");
      }
      if (MUTATION_KEYS.test(key)) {
        reject("execution, verification, and command fields are not accepted in a read-only plan");
      }
      assertBoundedAndSecretFree(child, depth + 1);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  if (value.length > MAX_STRING) {
    reject("an input string exceeds the supported limit");
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    reject("control characters are not accepted");
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    reject("private key material is not accepted");
  }
  if (/[?&](?:token|password|api[_-]?key|secret)=/i.test(value)) {
    reject("secret-bearing URLs are not accepted");
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i.test(value)) {
    reject("credential material is not accepted");
  }
  if (/\b(?:sk|ghp|github_pat|glpat)-?[A-Za-z0-9_]{16,}\b/.test(value)) {
    reject("credential material is not accepted");
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(value) || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value)) {
    reject("credential material is not accepted");
  }
  if (/\b(?:password|passwd|token|api[_-]?key|secret)\s*[:=]\s*\S+/i.test(value)) {
    reject("plaintext credential assignments are not accepted");
  }
  if (/\$\{[^}]+\}/.test(value)) {
    reject("environment interpolation is not accepted");
  }
  if (/\bdocker\s+(?:compose\s+down|system\s+prune|volume\s+(?:prune|rm)|network\s+prune|container\s+prune)\b/i.test(value) || /\bdown\s+--volumes\b/i.test(value)) {
    reject("broad teardown, prune, and volume deletion choreography is not accepted");
  }
}

function exactObject(value, keys, context) {
  if (!isObject(value)) {
    reject(`${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) {
    reject(`${context} must contain exactly the documented fields`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      reject(`${context} must contain exactly the documented fields`);
    }
  }
}

function requireArray(value, context) {
  if (!Array.isArray(value)) {
    reject(`${context} must be an array`);
  }
  return value;
}

function requireBoolean(value, context) {
  if (typeof value !== "boolean") {
    reject(`${context} must be boolean`);
  }
  return value;
}

function requireLabel(value, context) {
  if (typeof value !== "string" || !LABEL.test(value)) {
    reject(`${context} must be a bounded lowercase identifier`);
  }
  return value;
}

function requireDockerContext(value, context) {
  if (typeof value !== "string" || !DOCKER_CONTEXT.test(value)) {
    reject(`${context} must be a bounded Docker context name`);
  }
  return value;
}

function requireText(value, context, minimum = 1, maximum = 512) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    reject(`${context} must be bounded text`);
  }
  return value;
}

function requireOpaqueRef(value, context) {
  if (typeof value !== "string" || !OPAQUE_REF.test(value) || value.includes("..") || value.includes("@")) {
    reject(`${context} must be an opaque reference identifier`);
  }
  return value;
}

function requireNullableOpaqueRef(value, context) {
  if (value === null) {
    return null;
  }
  return requireOpaqueRef(value, context);
}

function requireTimestamp(value, context) {
  requireText(value, context, 1, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    reject(`${context} must be a UTC timestamp`);
  }
  return value;
}

function requireNullableTimestamp(value, context) {
  if (value === null) {
    return null;
  }
  return requireTimestamp(value, context);
}

function requirePinnedVersion(value, context) {
  requireText(value, context, 1, 160);
  if (FLOATING.test(value) || /[\s*^~<>=|]/.test(value) || value.includes("..") || /\$\{/.test(value)) {
    reject(`${context} must be an immutable version, digest, date release, or commit`);
  }
  const digest = /^sha256:[a-f0-9]{64}$/i.test(value);
  const semver = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
  const dateRelease = /^v?\d{4}[-.]\d{2}[-.]\d{2}(?:[-.][0-9A-Za-z.-]+)?$/.test(value);
  const commit = /^[a-f0-9]{7,40}$/i.test(value);
  if (!digest && !semver && !dateRelease && !commit) {
    reject(`${context} must be an immutable version, digest, date release, or commit`);
  }
  return value;
}

function normalizeProject(value) {
  exactObject(value, ["dockerContext", "id", "owner", "manifestRef", "ownershipVerified"], "project");
  return {
    dockerContext: requireDockerContext(value.dockerContext, "project.dockerContext"),
    id: requireLabel(value.id, "project.id"),
    owner: requireLabel(value.owner, "project.owner"),
    manifestRef: requireOpaqueRef(value.manifestRef, "project.manifestRef"),
    ownershipVerified: requireBoolean(value.ownershipVerified, "project.ownershipVerified")
  };
}

function normalizeOperation(value) {
  exactObject(value, ["id", "type", "risk", "currentVersion", "targetVersion", "reversibility", "summary", "forwardOnlyApproved"], "operation");
  const types = new Set(["upgrade", "migration", "rollback", "troubleshoot"]);
  const risks = new Set(["low", "stateful", "schema"]);
  const reversibility = new Set(["read-only", "reversible", "forward-only"]);
  if (!types.has(value.type)) {
    reject("operation.type is unsupported");
  }
  if (!risks.has(value.risk)) {
    reject("operation.risk is unsupported");
  }
  if (!reversibility.has(value.reversibility)) {
    reject("operation.reversibility is unsupported");
  }
  const currentVersion = requirePinnedVersion(value.currentVersion, "operation.currentVersion");
  const targetVersion = requirePinnedVersion(value.targetVersion, "operation.targetVersion");
  if (value.type === "troubleshoot") {
    if (value.reversibility !== "read-only" || currentVersion !== targetVersion || value.forwardOnlyApproved) {
      reject("troubleshooting must be read-only at the observed current version");
    }
  } else {
    if (value.reversibility === "read-only" || currentVersion === targetVersion) {
      reject("mutating operations require a distinct target and reversible or forward-only semantics");
    }
  }
  return {
    id: requireLabel(value.id, "operation.id"),
    type: value.type,
    risk: value.risk,
    currentVersion,
    targetVersion,
    reversibility: value.reversibility,
    summary: requireText(value.summary, "operation.summary", 8, 512),
    forwardOnlyApproved: requireBoolean(value.forwardOnlyApproved, "operation.forwardOnlyApproved")
  };
}

function normalizeCompatibilityEvidence(value) {
  exactObject(value, ["id", "sourceRef", "checkedAt", "claim"], "compatibility evidence");
  return {
    id: requireLabel(value.id, "compatibility evidence id"),
    sourceRef: requireOpaqueRef(value.sourceRef, "compatibility sourceRef"),
    checkedAt: requireTimestamp(value.checkedAt, "compatibility checkedAt"),
    claim: requireText(value.claim, "compatibility claim", 8, 512)
  };
}

function normalizeRestoreEvidence(value) {
  if (value === null) {
    return null;
  }
  exactObject(value, ["id", "verifiedAt", "scope"], "restore evidence");
  return {
    id: requireLabel(value.id, "restore evidence id"),
    verifiedAt: requireTimestamp(value.verifiedAt, "restore evidence verifiedAt"),
    scope: requireText(value.scope, "restore evidence scope", 12, 512)
  };
}

function normalizeBackup(value) {
  exactObject(value, ["required", "artifactRef", "capturedAt", "restoreEvidence"], "backup");
  const required = requireBoolean(value.required, "backup.required");
  const result = {
    required,
    artifactRef: requireNullableOpaqueRef(value.artifactRef, "backup.artifactRef"),
    capturedAt: requireNullableTimestamp(value.capturedAt, "backup.capturedAt"),
    restoreEvidence: normalizeRestoreEvidence(value.restoreEvidence)
  };
  if (!required && (result.artifactRef !== null || result.capturedAt !== null || result.restoreEvidence !== null)) {
    reject("optional backup fields must be null when backup.required is false");
  }
  return result;
}

function normalizeRollback(value) {
  exactObject(value, ["mode", "manifestRef", "statement"], "rollback");
  const modes = new Set(["none", "compose-reapply", "restore-backup", "forward-recovery"]);
  if (!modes.has(value.mode)) {
    reject("rollback.mode is unsupported");
  }
  return {
    mode: value.mode,
    manifestRef: requireNullableOpaqueRef(value.manifestRef, "rollback.manifestRef"),
    statement: requireText(value.statement, "rollback.statement", 8, 768)
  };
}

function normalizeCheck(value, context) {
  exactObject(value, ["id", "kind", "criterion"], context);
  const kinds = new Set(["api", "edge", "health", "storage", "ui", "vpn", "restore", "log"]);
  if (!kinds.has(value.kind)) {
    reject(`${context} kind is unsupported`);
  }
  return {
    id: requireLabel(value.id, `${context} id`),
    kind: value.kind,
    criterion: requireText(value.criterion, `${context} criterion`, 12, 512)
  };
}

function normalizeObserved(value) {
  exactObject(value, ["checkedAt", "project", "currentVersion", "health"], "observed");
  exactObject(value.project, ["dockerContext", "id", "owner", "manifestRef"], "observed.project");
  const healthStates = new Set(["healthy", "degraded", "unknown"]);
  if (!healthStates.has(value.health)) {
    reject("observed.health is unsupported");
  }
  return {
    checkedAt: requireTimestamp(value.checkedAt, "observed.checkedAt"),
    project: {
      dockerContext: requireDockerContext(value.project.dockerContext, "observed project Docker context"),
      id: requireLabel(value.project.id, "observed project id"),
      owner: requireLabel(value.project.owner, "observed project owner"),
      manifestRef: requireOpaqueRef(value.project.manifestRef, "observed project manifestRef")
    },
    currentVersion: requirePinnedVersion(value.currentVersion, "observed.currentVersion"),
    health: value.health
  };
}

function normalizeInput(value) {
  exactObject(value, ["schemaVersion", "project", "operation", "compatibilityEvidence", "backup", "rollback", "healthChecks", "acceptanceChecks", "observed"], "operation plan input");
  if (value.schemaVersion !== 1) {
    reject("schemaVersion must be 1");
  }
  const compatibilityEvidence = requireArray(value.compatibilityEvidence, "compatibilityEvidence").map(normalizeCompatibilityEvidence);
  const healthChecks = requireArray(value.healthChecks, "healthChecks").map((entry) => normalizeCheck(entry, "health check"));
  const acceptanceChecks = requireArray(value.acceptanceChecks, "acceptanceChecks").map((entry) => normalizeCheck(entry, "acceptance check"));
  compatibilityEvidence.sort((left, right) => left.id.localeCompare(right.id));
  healthChecks.sort((left, right) => left.id.localeCompare(right.id));
  acceptanceChecks.sort((left, right) => left.id.localeCompare(right.id));
  requireUnique(compatibilityEvidence.map((entry) => entry.id), "compatibility evidence IDs");
  requireUnique(healthChecks.map((entry) => entry.id), "health check IDs");
  requireUnique(acceptanceChecks.map((entry) => entry.id), "acceptance check IDs");
  if (healthChecks.length === 0 || acceptanceChecks.length === 0) {
    reject("at least one health check and acceptance check are required");
  }
  return {
    schemaVersion: 1,
    project: normalizeProject(value.project),
    operation: normalizeOperation(value.operation),
    compatibilityEvidence,
    backup: normalizeBackup(value.backup),
    rollback: normalizeRollback(value.rollback),
    healthChecks,
    acceptanceChecks,
    observed: normalizeObserved(value.observed)
  };
}

function requireUnique(values, context) {
  if (new Set(values).size !== values.length) {
    reject(`${context} must be unique`);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function planIdFor(input) {
  return crypto.createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 16);
}

function addFinding(collection, gate, reason) {
  collection.push({ gate, reason });
}

function findingStatus(conflicts, blockers, gate) {
  if (conflicts.some((finding) => finding.gate === gate)) {
    return "conflict";
  }
  if (blockers.some((finding) => finding.gate === gate)) {
    return "blocked";
  }
  return "pass";
}

function buildPlan(input) {
  const conflicts = [];
  const blockers = [];
  const project = input.project;
  const operation = input.operation;
  const observed = input.observed;

  if (!project.ownershipVerified) {
    addFinding(blockers, "ownership", "explicit-ownership-verification-missing");
  }
  if (project.dockerContext !== observed.project.dockerContext || project.id !== observed.project.id || project.owner !== observed.project.owner || project.manifestRef !== observed.project.manifestRef) {
    addFinding(conflicts, "ownership", "observed-project-ownership-mismatch");
  }
  if (operation.currentVersion !== observed.currentVersion) {
    addFinding(conflicts, "current-version", "observed-current-version-mismatch");
  }
  if (operation.type !== "troubleshoot" && input.compatibilityEvidence.length === 0) {
    addFinding(blockers, "compatibility", "compatibility-evidence-missing");
  }

  const backupRisk = operation.type === "migration" || operation.type === "rollback" || operation.risk !== "low" || operation.reversibility === "forward-only";
  if (backupRisk && !input.backup.required) {
    addFinding(blockers, "backup-restore", "risk-requires-backup-and-restore-evidence");
  }
  if (input.backup.required) {
    if (input.backup.artifactRef === null || input.backup.capturedAt === null) {
      addFinding(blockers, "backup-restore", "backup-evidence-incomplete");
    }
    if (input.backup.restoreEvidence === null) {
      addFinding(blockers, "backup-restore", "restore-drill-evidence-missing");
    }
  }

  if (operation.reversibility === "read-only") {
    if (input.rollback.mode !== "none" || input.rollback.manifestRef !== null) {
      addFinding(conflicts, "rollback", "read-only-operation-must-not-name-an-apply-rollback");
    }
  }
  if (operation.reversibility === "reversible") {
    if (input.rollback.mode !== "compose-reapply" && input.rollback.mode !== "restore-backup") {
      addFinding(blockers, "rollback", "reversible-operation-needs-a-supported-rollback-mode");
    }
    if (input.rollback.manifestRef === null) {
      addFinding(blockers, "rollback", "prior-manifest-reference-missing");
    }
    if (operation.forwardOnlyApproved) {
      addFinding(conflicts, "forward-only", "reversible-operation-must-not-carry-forward-only-approval");
    }
  }
  if (operation.reversibility === "forward-only") {
    if (!operation.forwardOnlyApproved) {
      addFinding(blockers, "forward-only", "explicit-forward-only-gate-missing");
    }
    if (input.rollback.mode !== "forward-recovery") {
      addFinding(blockers, "rollback", "forward-only-operation-needs-forward-recovery-mode");
    }
    if (input.rollback.statement.length < 24) {
      addFinding(blockers, "rollback", "forward-recovery-statement-is-not-concrete");
    }
    if (input.backup.restoreEvidence === null) {
      addFinding(blockers, "forward-only", "forward-only-operation-needs-restore-evidence");
    }
  }

  let restoreEvidenceRef = null;
  if (input.backup.restoreEvidence !== null) {
    restoreEvidenceRef = input.backup.restoreEvidence.id;
  }

  conflicts.sort(compareFinding);
  blockers.sort(compareFinding);
  let status = "pass";
  if (blockers.length > 0) {
    status = "blocked";
  }
  if (conflicts.length > 0) {
    status = "conflict";
  }

  const steps = [];
  steps.push({ order: 1, phase: "ownership", owner: "selfhost-operations", action: "confirm-exact-project-and-current-version", mutation: false });
  if (operation.reversibility === "read-only") {
    steps.push({ order: 2, phase: "diagnosis", owner: "selfhost-operations", action: "collect-scoped-read-only-evidence", mutation: false });
    steps.push({ order: 3, phase: "acceptance", owner: "selfhost-verify", action: "evaluate-health-and-acceptance-criteria", mutation: false });
  } else {
    let order = 2;
    if (input.backup.required) {
      steps.push({ order, phase: "backup", owner: "selfhost-backup", action: "confirm-recorded-backup-and-restore-drill", mutation: false });
      order += 1;
    }
    steps.push({ order, phase: "compose-plan", owner: "selfhost-compose", action: "validate-plan-and-render-exact-target-manifest", mutation: false });
    order += 1;
    steps.push({ order, phase: "compose-preflight", owner: "selfhost-compose", action: "run-exact-project-config-preflight", mutation: false });
    order += 1;
    if (operation.reversibility === "forward-only") {
      steps.push({ order, phase: "forward-only-gate", owner: "selfhost-operations", action: "confirm-explicit-forward-only-approval", mutation: false });
      order += 1;
    }
    steps.push({ order, phase: "apply", owner: "selfhost-compose", action: "apply-byte-verified-target-with-exact-project-token", approval: `APPLY:${project.id}`, mutation: true });
    order += 1;
    steps.push({ order, phase: "acceptance", owner: "selfhost-verify", action: "run-health-and-acceptance-criteria", mutation: false });
    order += 1;
    steps.push({ order, phase: "failure-gate", owner: "selfhost-operations", action: "stop-on-failure-and-follow-recorded-recovery-statement", mutation: false });
  }

  return {
    schemaVersion: 1,
    kind: "selfhost-operation-plan",
    planId: planIdFor(input),
    status,
    project: { dockerContext: project.dockerContext, id: project.id, owner: project.owner, manifestRef: project.manifestRef, observedAt: observed.checkedAt },
    operation: {
      id: operation.id,
      type: operation.type,
      risk: operation.risk,
      currentVersion: operation.currentVersion,
      targetVersion: operation.targetVersion,
      reversibility: operation.reversibility,
      summary: operation.summary
    },
    gates: [
      { id: "ownership", status: findingStatus(conflicts, blockers, "ownership") },
      { id: "current-version", status: findingStatus(conflicts, blockers, "current-version") },
      { id: "compatibility", status: findingStatus(conflicts, blockers, "compatibility"), evidenceRefs: input.compatibilityEvidence.map((entry) => entry.id) },
      { id: "backup-restore", status: findingStatus(conflicts, blockers, "backup-restore"), required: backupRisk, artifactRef: input.backup.artifactRef, restoreEvidenceRef },
      { id: "rollback", status: findingStatus(conflicts, blockers, "rollback"), mode: input.rollback.mode, manifestRef: input.rollback.manifestRef },
      { id: "forward-only", status: findingStatus(conflicts, blockers, "forward-only"), required: operation.reversibility === "forward-only", approved: operation.forwardOnlyApproved },
      { id: "health-acceptance", status: "pending", healthChecks: input.healthChecks.map((entry) => entry.id), acceptanceChecks: input.acceptanceChecks.map((entry) => entry.id) }
    ],
    blockers,
    conflicts,
    recoveryStatement: input.rollback.statement,
    choreography: { applyOwner: "selfhost-compose", authorized: false, steps },
    execution: { performed: false },
    verification: { completed: false, acceptance: "pending" }
  };
}

function compareFinding(left, right) {
  return `${left.gate}\0${left.reason}`.localeCompare(`${right.gate}\0${right.reason}`);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const options = parseArguments(Bun.argv.slice(2));
  const input = normalizeInput(readInput(options.input));
  const plan = buildPlan(input);
  if (options.action === "validate") {
    writeJson({ valid: plan.status === "pass", status: plan.status, project: plan.project.id, operation: plan.operation.id, mutationPerformed: false });
  } else {
    writeJson(plan);
  }
  if (plan.status !== "pass") {
    process.exitCode = 3;
  }
}

try {
  main();
} catch (error) {
  if (error instanceof ValidationError) {
    process.stderr.write(`plan-operation.ts: ${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write("plan-operation.ts: unexpected failure\n");
  process.exit(2);
}
