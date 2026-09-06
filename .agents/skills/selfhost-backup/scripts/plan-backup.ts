#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_COLLECTION_ITEMS = 100;
const MAX_STRING_LENGTH = 2048;
const SOURCE_CLASSES = new Set(["config", "user-data", "database", "cache"]);
const CONSISTENCY_METHODS = new Set([
  "native-export",
  "application-export",
  "quiesced-copy",
  "quiesced-snapshot",
  "filesystem-copy",
  "filesystem-snapshot",
  "excluded",
]);
const DATABASE_METHODS = new Set([
  "native-export",
  "application-export",
  "quiesced-copy",
  "quiesced-snapshot",
]);

function usage() {
  process.stdout.write("Usage: plan-backup.ts (--input FILE | --json JSON)\n\n");
  process.stdout.write("Create a secret-free backup plan and assess isolated restore evidence.\n");
}

function fail(message) {
  process.stderr.write(`plan-backup.ts: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { inputPath: "", json: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    if (argument !== "--input" && argument !== "--json") {
      fail("unknown argument");
    }
    if (index + 1 >= argv.length) {
      fail("an argument value is missing");
    }
    if (argument === "--input") {
      options.inputPath = argv[index + 1];
    } else {
      options.json = argv[index + 1];
    }
    index += 1;
  }
  if (Boolean(options.inputPath) === Boolean(options.json)) {
    fail("provide exactly one of --input or --json");
  }
  return options;
}

function readDocument(options) {
  let content = options.json;
  if (options.inputPath) {
    let stat;
    try {
      stat = fs.lstatSync(options.inputPath);
    } catch {
      fail("input file cannot be read");
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail("--input must name a regular non-symlink file");
    }
    if (stat.size > MAX_INPUT_BYTES) {
      fail("input exceeds 256 KiB");
    }
    try {
      content = fs.readFileSync(options.inputPath, "utf8");
    } catch {
      fail("input file cannot be read");
    }
  }
  if (Buffer.byteLength(content, "utf8") > MAX_INPUT_BYTES) {
    fail("input exceeds 256 KiB");
  }
  try {
    return JSON.parse(content);
  } catch {
    fail("input is not valid JSON");
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function entropy(value) {
  const frequencies = new Map();
  for (const character of value) {
    const count = frequencies.get(character) || 0;
    frequencies.set(character, count + 1);
  }
  let result = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    result -= probability * Math.log2(probability);
  }
  return result;
}

function isHighEntropy(value) {
  if (value.length < 24 || /^(?:0+|1+|x+)$/i.test(value)) {
    return false;
  }
  let classes = 0;
  if (/[a-z]/.test(value)) {
    classes += 1;
  }
  if (/[A-Z]/.test(value)) {
    classes += 1;
  }
  if (/[0-9]/.test(value)) {
    classes += 1;
  }
  if (/[+/_=-]/.test(value)) {
    classes += 1;
  }
  if (/^[a-f0-9]{32,}$/i.test(value)) {
    return entropy(value) >= 3.6;
  }
  return classes >= 3 && entropy(value) >= 3.8;
}

function containsHighEntropy(value) {
  const candidates = value.match(/[A-Za-z0-9+/_=-]{24,}/g) || [];
  return candidates.some(isHighEntropy);
}

function validateSecretReferences(value) {
  if (!Array.isArray(value) || value.length > 20) {
    fail("secretRefs must be a bounded array of opaque identifiers");
  }
  for (const reference of value) {
    if (typeof reference !== "string" || !/^[a-z0-9][a-z0-9._:/-]{2,127}$/i.test(reference)) {
      fail("secretRefs must contain opaque identifiers");
    }
    if (containsHighEntropy(reference)) {
      fail("secretRefs must name references, not secret payloads");
    }
  }
}

function assertSecretFree(value, key = "input", depth = 0) {
  if (depth > 12) {
    fail("input nesting exceeds the supported limit");
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS) {
      fail("an input collection exceeds 100 items");
    }
    for (const item of value) {
      assertSecretFree(item, key, depth + 1);
    }
    return;
  }
  if (isObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === "secretRefs") {
        validateSecretReferences(childValue);
        continue;
      }
      if (/password|passwd|token|api[-_]?key|private[-_]?key|credential|cookie|authorization|secret/i.test(childKey)) {
        fail("plaintext secret-bearing fields are not accepted; use secretRefs");
      }
      assertSecretFree(childValue, childKey, depth + 1);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  if (value.length > MAX_STRING_LENGTH) {
    fail("an input string exceeds the supported limit");
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    fail("private key material is not accepted");
  }
  if (/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/i.test(value)) {
    fail("authorization material is not accepted");
  }
  if (/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/.test(value)) {
    fail("token-shaped material is not accepted");
  }
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value)) {
    fail("token-shaped material is not accepted");
  }
  if (/[?&](?:token|password|passwd|api[_-]?key|secret|signature)=/i.test(value)) {
    fail("secret-bearing URLs are not accepted");
  }
  if (key !== "evidenceHashes" && containsHighEntropy(value)) {
    fail("high-entropy secret-like material is not accepted");
  }
}

function assertObjectShape(value, allowedKeys, requiredKeys) {
  if (!isObject(value)) {
    fail("input shape is invalid");
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("input contains an unsupported field");
    }
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      fail("input is missing a required field");
    }
  }
}

function assertArray(value) {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    fail("input contains an invalid collection");
  }
}

function assertBoolean(value) {
  if (typeof value !== "boolean") {
    fail("input contains an invalid boolean");
  }
}

function assertInteger(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("input contains an out-of-range integer");
  }
}

function assertIdentifier(value, allowEmpty = false) {
  if (allowEmpty && value === "") {
    return;
  }
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) {
    fail("input contains an invalid identifier");
  }
}

function assertReference(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:/-]{2,199}$/i.test(value)) {
    fail("input contains an invalid opaque reference");
  }
}

function assertTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    fail("input contains an invalid timestamp");
  }
  if (Number.isNaN(Date.parse(value))) {
    fail("input contains an invalid timestamp");
  }
}

function assertHash(value) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    fail("evidence hashes must be SHA-256 identifiers");
  }
}

function assertAbsoluteLocation(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("input contains an invalid location");
  }
  if (!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)) {
    fail("source and target locations must be absolute");
  }
}

function normalizeLocation(value) {
  if (path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)) {
    return { style: "win32", value: path.win32.normalize(value).toLowerCase(), separator: "\\" };
  }
  return { style: "posix", value: path.posix.normalize(value), separator: "/" };
}

function locationsOverlap(first, second) {
  const left = normalizeLocation(first);
  const right = normalizeLocation(second);
  if (left.style !== right.style) {
    return false;
  }
  if (left.value === right.value) {
    return true;
  }
  let leftPrefix = left.value;
  if (!leftPrefix.endsWith(left.separator)) {
    leftPrefix = `${leftPrefix}${left.separator}`;
  }
  let rightPrefix = right.value;
  if (!rightPrefix.endsWith(right.separator)) {
    rightPrefix = `${rightPrefix}${right.separator}`;
  }
  return right.value.startsWith(leftPrefix) || left.value.startsWith(rightPrefix);
}

function assertUniqueIds(records) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) {
      fail("input contains duplicate record identifiers");
    }
    ids.add(record.id);
  }
}

function validateInput(input) {
  assertObjectShape(
    input,
    ["schemaVersion", "project", "objectives", "sources", "targets", "schedule", "notifications", "restoreDrill"],
    ["schemaVersion", "project", "objectives", "sources", "targets", "schedule", "notifications"],
  );
  if (input.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }

  assertObjectShape(input.project, ["id", "owner"], ["id", "owner"]);
  assertIdentifier(input.project.id);
  assertIdentifier(input.project.owner, true);

  assertObjectShape(input.objectives, ["rpoMinutes", "rtoMinutes"], ["rpoMinutes", "rtoMinutes"]);
  assertInteger(input.objectives.rpoMinutes, 1, 525600);
  assertInteger(input.objectives.rtoMinutes, 1, 525600);

  assertArray(input.sources);
  for (const source of input.sources) {
    assertObjectShape(
      source,
      ["id", "class", "path", "failureDomain", "included", "rebuildable", "owner", "consistency"],
      ["id", "class", "path", "failureDomain", "included", "rebuildable", "owner", "consistency"],
    );
    assertIdentifier(source.id);
    if (!SOURCE_CLASSES.has(source.class)) {
      fail("a source class is unsupported");
    }
    assertAbsoluteLocation(source.path);
    assertIdentifier(source.failureDomain);
    assertBoolean(source.included);
    assertBoolean(source.rebuildable);
    assertIdentifier(source.owner, true);
    assertObjectShape(source.consistency, ["method", "versionCaptured", "quiesceOwner"], ["method", "versionCaptured", "quiesceOwner"]);
    if (!CONSISTENCY_METHODS.has(source.consistency.method)) {
      fail("a consistency method is unsupported");
    }
    assertBoolean(source.consistency.versionCaptured);
    if (source.consistency.quiesceOwner !== null) {
      assertIdentifier(source.consistency.quiesceOwner, true);
    }
  }
  assertUniqueIds(input.sources);

  assertArray(input.targets);
  for (const target of input.targets) {
    assertObjectShape(
      target,
      ["id", "kind", "path", "failureDomain", "sourceIds", "owner", "encryption", "immutable", "versioned", "offline", "destructive", "destructiveApproved"],
      ["id", "kind", "path", "failureDomain", "sourceIds", "owner", "encryption", "immutable", "versioned", "offline", "destructive", "destructiveApproved"],
    );
    assertIdentifier(target.id);
    if (target.kind !== "local" && target.kind !== "off-host") {
      fail("a target kind is unsupported");
    }
    assertAbsoluteLocation(target.path);
    assertIdentifier(target.failureDomain);
    assertArray(target.sourceIds);
    for (const sourceId of target.sourceIds) {
      assertIdentifier(sourceId);
    }
    if (new Set(target.sourceIds).size !== target.sourceIds.length) {
      fail("a target contains duplicate source identifiers");
    }
    assertIdentifier(target.owner, true);
    assertObjectShape(target.encryption, ["enabled", "secretRefs", "custody"], ["enabled", "secretRefs", "custody"]);
    assertBoolean(target.encryption.enabled);
    validateSecretReferences(target.encryption.secretRefs);
    if (target.encryption.custody !== null) {
      assertObjectShape(
        target.encryption.custody,
        ["owner", "locationRef", "independent", "lastConfirmedAt"],
        ["owner", "locationRef", "independent", "lastConfirmedAt"],
      );
      assertIdentifier(target.encryption.custody.owner, true);
      assertReference(target.encryption.custody.locationRef);
      assertBoolean(target.encryption.custody.independent);
      assertTimestamp(target.encryption.custody.lastConfirmedAt);
    }
    assertBoolean(target.immutable);
    assertBoolean(target.versioned);
    assertBoolean(target.offline);
    assertBoolean(target.destructive);
    assertBoolean(target.destructiveApproved);
  }
  assertUniqueIds(input.targets);

  assertObjectShape(input.schedule, ["cadenceMinutes", "retention", "pruning"], ["cadenceMinutes", "retention", "pruning"]);
  assertInteger(input.schedule.cadenceMinutes, 1, 525600);
  assertObjectShape(input.schedule.retention, ["keepLast", "daily", "weekly", "monthly"], ["keepLast", "daily", "weekly", "monthly"]);
  for (const count of Object.values(input.schedule.retention)) {
    assertInteger(count, 0, 10000);
  }
  assertObjectShape(input.schedule.pruning, ["enabled", "approved", "owner"], ["enabled", "approved", "owner"]);
  assertBoolean(input.schedule.pruning.enabled);
  assertBoolean(input.schedule.pruning.approved);
  assertIdentifier(input.schedule.pruning.owner, true);

  assertObjectShape(input.notifications, ["failureOwner", "routeRefs"], ["failureOwner", "routeRefs"]);
  assertIdentifier(input.notifications.failureOwner, true);
  assertArray(input.notifications.routeRefs);
  for (const reference of input.notifications.routeRefs) {
    assertReference(reference);
  }

  if (!Object.hasOwn(input, "restoreDrill") || input.restoreDrill === null) {
    return;
  }
  const drill = input.restoreDrill;
  assertObjectShape(
    drill,
    ["observedAt", "isolatedTarget", "targetPath", "sourceIds", "durationMinutes", "productionOverwritten", "integrity", "applicationAcceptance", "evidenceRefs", "evidenceHashes"],
    ["observedAt", "isolatedTarget", "targetPath", "sourceIds", "durationMinutes", "productionOverwritten", "integrity", "applicationAcceptance", "evidenceRefs", "evidenceHashes"],
  );
  assertTimestamp(drill.observedAt);
  assertBoolean(drill.isolatedTarget);
  assertAbsoluteLocation(drill.targetPath);
  assertArray(drill.sourceIds);
  for (const sourceId of drill.sourceIds) {
    assertIdentifier(sourceId);
  }
  assertInteger(drill.durationMinutes, 1, 525600);
  assertBoolean(drill.productionOverwritten);
  assertObjectShape(drill.integrity, ["result", "objectsChecked", "ownershipPreserved"], ["result", "objectsChecked", "ownershipPreserved"]);
  if (!new Set(["pass", "fail", "blocked"]).has(drill.integrity.result)) {
    fail("a restore result is unsupported");
  }
  assertInteger(drill.integrity.objectsChecked, 0, 1000000000);
  assertBoolean(drill.integrity.ownershipPreserved);
  assertObjectShape(drill.applicationAcceptance, ["result", "checks"], ["result", "checks"]);
  if (!new Set(["pass", "fail", "blocked"]).has(drill.applicationAcceptance.result)) {
    fail("a restore result is unsupported");
  }
  assertArray(drill.applicationAcceptance.checks);
  for (const check of drill.applicationAcceptance.checks) {
    assertObjectShape(check, ["id", "result"], ["id", "result"]);
    assertIdentifier(check.id);
    if (!new Set(["pass", "fail", "blocked"]).has(check.result)) {
      fail("an application acceptance result is unsupported");
    }
  }
  assertArray(drill.evidenceRefs);
  for (const reference of drill.evidenceRefs) {
    assertReference(reference);
  }
  assertArray(drill.evidenceHashes);
  for (const hash of drill.evidenceHashes) {
    assertHash(hash);
  }
}

function evaluate(input) {
  const gates = [];
  const conflicts = [];
  const decisionsNeeded = [];
  const sources = [...input.sources].sort((left, right) => left.id.localeCompare(right.id));
  const targets = [...input.targets].sort((left, right) => left.id.localeCompare(right.id));
  const includedSources = sources.filter((source) => source.included);
  const sourceIds = new Set(sources.map((source) => source.id));

  function gate(id, passed, detail) {
    let status = "blocked";
    if (passed) {
      status = "pass";
    }
    gates.push({ id, status, detail });
    if (!passed) {
      decisionsNeeded.push(detail);
    }
  }

  function conflict(id, subjects, detail) {
    conflicts.push({ id, subjects: [...subjects].sort(), detail });
  }

  gate("project-owner", input.project.owner.length > 0, "Assign an accountable project owner.");
  gate("rpo-schedule", input.schedule.cadenceMinutes <= input.objectives.rpoMinutes, "Set backup cadence within the RPO.");
  const retention = input.schedule.retention;
  const retentionReady = retention.keepLast + retention.daily + retention.weekly + retention.monthly > 0;
  gate("retention", retentionReady, "Keep at least one retained recovery point.");
  gate("failure-owner", input.notifications.failureOwner.length > 0, "Assign an owner for backup failures.");
  gate("failure-routing", input.notifications.routeRefs.length > 0, "Provide at least one opaque failure-notification route reference.");

  if (input.schedule.pruning.enabled && !input.schedule.pruning.approved) {
    conflict("unapproved-pruning", [], "Pruning requires separate explicit approval.");
  }
  if (input.schedule.pruning.enabled) {
    gate("pruning-owner", input.schedule.pruning.owner.length > 0, "Assign an owner for approved pruning.");
  }

  for (const source of sources) {
    gate(`source-owner:${source.id}`, source.owner.length > 0, "Assign an owner to every protected source.");
    if (source.class !== "cache") {
      gate(`durable-source-included:${source.id}`, source.included, "Include every configuration, user-data, and database source.");
    }
    if (source.class === "cache" && !source.included) {
      gate(`cache-rebuildable:${source.id}`, source.rebuildable, "Mark every excluded cache as rebuildable.");
    }
    if (source.included) {
      const consistencyReady = source.consistency.method !== "excluded" && source.consistency.versionCaptured;
      gate(`consistency:${source.id}`, consistencyReady, "Record a usable consistency method and application/schema version for every included source.");
    }
    if (source.class === "database" && source.included) {
      let databaseReady = DATABASE_METHODS.has(source.consistency.method) && source.consistency.versionCaptured;
      if (source.consistency.method.startsWith("quiesced-") && !source.consistency.quiesceOwner) {
        databaseReady = false;
      }
      gate(`database-consistency:${source.id}`, databaseReady, "Use a native export or an owned quiesce method for every database.");
    }
  }

  for (const target of targets) {
    gate(`target-owner:${target.id}`, target.owner.length > 0, "Assign an owner to every backup target.");
    const referencesKnown = target.sourceIds.every((sourceId) => sourceIds.has(sourceId));
    gate(`target-source-refs:${target.id}`, referencesKnown, "Limit each target to declared source identifiers.");
    const custody = target.encryption.custody;
    let custodyReady = false;
    if (custody !== null) {
      custodyReady = custody.owner.length > 0 && custody.independent;
    }
    const encryptionReady = target.encryption.enabled && target.encryption.secretRefs.length > 0 && custodyReady;
    gate(`encryption-custody:${target.id}`, encryptionReady, "Encrypt every target through opaque references and record independent recovery-key custody.");
    if (target.destructive && !target.destructiveApproved) {
      conflict("unapproved-destructive-target", [target.id], "A destructive target requires separate explicit approval.");
    }
    for (const source of sources) {
      if (locationsOverlap(source.path, target.path)) {
        conflict("source-target-overlap", [source.id, target.id], "A backup target overlaps a protected source tree.");
      }
    }
  }

  for (const source of includedSources) {
    const coveringTargets = targets.filter((target) => target.sourceIds.includes(source.id));
    const localTargets = coveringTargets.filter((target) => target.kind === "local");
    const offHostTargets = coveringTargets.filter((target) => target.kind === "off-host");
    const independentTargets = offHostTargets.filter((target) => target.failureDomain !== source.failureDomain);
    gate(`local-copy:${source.id}`, localTargets.length > 0, "Provide local recovery staging for every included source.");
    gate(`off-host-copy:${source.id}`, offHostTargets.length > 0, "Provide an off-host copy for every included source.");
    gate(`independent-failure-domain:${source.id}`, independentTargets.length > 0, "Keep an off-host copy outside the source failure domain.");
    if (offHostTargets.length > 0 && independentTargets.length === 0) {
      conflict("same-failure-domain-only", [source.id], "Off-host-labelled copies remain in the source failure domain.");
    }
  }

  const resilientOffHost = targets.some((target) => target.kind === "off-host" && (target.immutable || target.versioned || target.offline));
  gate("off-host-protection", resilientOffHost, "Select immutable, versioned, or offline protection for at least one off-host target.");

  let restoreReady = false;
  let drill = null;
  if (Object.hasOwn(input, "restoreDrill")) {
    drill = input.restoreDrill;
  }
  if (drill === null) {
    gate("isolated-restore", false, "Record a timestamped restore into an isolated target with integrity and application acceptance evidence.");
  } else {
    const restoredIds = new Set(drill.sourceIds);
    const allIncludedRestored = includedSources.every((source) => restoredIds.has(source.id));
    let isolatedPath = true;
    for (const source of sources) {
      if (locationsOverlap(source.path, drill.targetPath)) {
        isolatedPath = false;
      }
    }
    for (const target of targets) {
      if (locationsOverlap(target.path, drill.targetPath)) {
        isolatedPath = false;
      }
    }
    const applicationChecksPass = drill.applicationAcceptance.checks.length > 0
      && drill.applicationAcceptance.checks.every((check) => check.result === "pass");
    const integrityReady = drill.integrity.result === "pass"
      && drill.integrity.objectsChecked > 0
      && drill.integrity.ownershipPreserved;
    const applicationReady = drill.applicationAcceptance.result === "pass" && applicationChecksPass;
    const evidenceReady = drill.evidenceRefs.length > 0 && drill.evidenceHashes.length > 0;
    const rtoReady = drill.durationMinutes <= input.objectives.rtoMinutes;
    restoreReady = drill.isolatedTarget
      && !drill.productionOverwritten
      && isolatedPath
      && allIncludedRestored
      && integrityReady
      && applicationReady
      && evidenceReady
      && rtoReady;
    gate("restore-source-coverage", allIncludedRestored, "Restore every included source during the drill.");
    gate("restore-isolation", drill.isolatedTarget && !drill.productionOverwritten && isolatedPath, "Restore into a non-production target isolated from sources and backup targets.");
    gate("restore-integrity", integrityReady, "Record passing integrity and ownership checks.");
    gate("application-acceptance", applicationReady, "Record at least one passing application acceptance check.");
    gate("restore-evidence", evidenceReady, "Attach opaque evidence references and SHA-256 hashes to the restore drill.");
    gate("rto", rtoReady, "Complete the restore drill within the RTO.");
  }

  let status = "pass";
  if (conflicts.length > 0) {
    status = "conflict";
  } else if (gates.some((item) => item.status === "blocked")) {
    status = "blocked";
  }

  let restoreState = "not-verified";
  if (restoreReady && status === "pass") {
    restoreState = "verified";
  }

  const localTargetCount = targets.filter((target) => target.kind === "local").length;
  const offHostTargetCount = targets.filter((target) => target.kind === "off-host").length;
  const protectedOffHostCount = targets.filter((target) => target.kind === "off-host" && (target.immutable || target.versioned || target.offline)).length;
  const result = {
    schemaVersion: 1,
    capability: "backup",
    status,
    project: { id: input.project.id, ownerAssigned: input.project.owner.length > 0 },
    objectives: { rpoMinutes: input.objectives.rpoMinutes, rtoMinutes: input.objectives.rtoMinutes },
    inventory: {
      sourceCount: sources.length,
      includedSourceCount: includedSources.length,
      databaseCount: sources.filter((source) => source.class === "database").length,
      excludedRebuildableCacheCount: sources.filter((source) => source.class === "cache" && !source.included && source.rebuildable).length,
      localTargetCount,
      offHostTargetCount,
      protectedOffHostCount,
    },
    restore: {
      state: restoreState,
      observedAt: null,
      claim: "No isolated application restore has been accepted.",
    },
    gates,
    conflicts,
    decisionsNeeded: [...new Set(decisionsNeeded)].sort(),
    mutationsPerformed: false,
  };
  if (restoreState === "verified") {
    result.restore.observedAt = drill.observedAt;
    result.restore.claim = "The recorded included sources restored into the isolated target and passed the supplied integrity, application, and RTO checks.";
  }
  return result;
}

function main() {
  const input = readDocument(parseArgs(Bun.argv.slice(2)));
  assertSecretFree(input);
  validateInput(input);
  process.stdout.write(`${JSON.stringify(evaluate(input), null, 2)}\n`);
}

main();
