#!/usr/bin/env bun

import fs from "node:fs";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_COLLECTION_ITEMS = 100;
const MAX_STRING_LENGTH = 2048;

const GENERIC_REQUIREMENTS = [
  requirement("container-process", "runtime", "runtime", "container-process", "healthy"),
  requirement("api-readiness", "application", "application-api", "readiness", "ready"),
  requirement("storage-capacity", "storage", "filesystem", "capacity", "within-threshold"),
];

const SPECIALIZED_REQUIREMENTS = {
  publicIngress: [
    requirement("ingress-dns", "ingress", "edge-dns", "dns-resolution", "resolved"),
    requirement("ingress-tls", "ingress", "edge-tls", "tls-certificate", "valid"),
    requirement("ingress-auth", "ingress", "edge-auth", "auth-enforcement", "enforced"),
    requirement("ingress-direct-port", "ingress", "network", "direct-port-privacy", "private"),
  ],
  downloaderVpn: [
    requirement("vpn-healthy-egress", "downloader-vpn", "network", "healthy-egress", "tunnel-egress"),
    requirement("vpn-tunnel-break", "downloader-vpn", "network", "tunnel-break", "fail-closed"),
    requirement("vpn-dns-fail-closed", "downloader-vpn", "network", "dns-fail-closed", "fail-closed"),
    requirement("vpn-restored-egress", "downloader-vpn", "network", "restored-egress", "tunnel-egress"),
    requirement("vpn-route-audit", "downloader-vpn", "network", "route-firewall-audit", "restricted"),
  ],
  backups: [
    requirement("backup-isolated-restore", "backup", "backup-restore", "isolated-restore", "restored"),
    requirement("backup-integrity", "backup", "backup-restore", "integrity-ownership", "valid"),
    requirement("backup-application-acceptance", "backup", "backup-restore", "application-acceptance", "accepted"),
  ],
  media: [
    requirement("media-service-graph", "media", "application-api", "service-graph", "complete"),
  ],
  homarr: [
    requirement("homarr-integration-search", "homarr", "homarr-api", "integration-search", "found"),
    requirement("homarr-app-search", "homarr", "homarr-api", "app-search", "found"),
    requirement("homarr-widget-search", "homarr", "homarr-api", "widget-search", "found"),
    requirement("homarr-mcp-search", "homarr", "homarr-mcp", "mcp-search", "search-only-pass"),
  ],
};

const CROSS_REQUIREMENTS = {
  homarrPublicIngress: requirement("homarr-native-mcp-private", "homarr", "network", "native-mcp-public-deny", "private"),
};

function requirement(id, capability, sourceClass, probeClass, expectedClass) {
  return { id, capability, sourceClass, probeClass, expectedClass };
}

function usage() {
  process.stdout.write("Usage: verify-evidence.ts (--input FILE | --json JSON)\n\n");
  process.stdout.write("Aggregate fresh, secret-free acceptance evidence without running probes.\n");
}

function fail(message) {
  process.stderr.write(`verify-evidence.ts: ${message}\n`);
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
      if (/password|passwd|token|api[-_]?key|private[-_]?key|credential|cookie|authorization|secret/i.test(childKey)) {
        fail("plaintext secret-bearing fields are not accepted");
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

function assertIdentifier(value) {
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

function validateRequirement(record) {
  assertObjectShape(
    record,
    ["id", "capability", "sourceClass", "probeClass", "expectedClass"],
    ["id", "capability", "sourceClass", "probeClass", "expectedClass"],
  );
  assertIdentifier(record.id);
  assertIdentifier(record.capability);
  assertIdentifier(record.sourceClass);
  assertIdentifier(record.probeClass);
  assertIdentifier(record.expectedClass);
}

function validateCheck(check) {
  assertObjectShape(
    check,
    ["id", "capability", "observedAt", "sourceClass", "probeClass", "expectedClass", "actualClass", "result", "evidenceRefs", "evidenceHashes", "freshnessMinutes"],
    ["id", "capability", "observedAt", "sourceClass", "probeClass", "expectedClass", "actualClass", "result", "evidenceRefs", "evidenceHashes", "freshnessMinutes"],
  );
  assertIdentifier(check.id);
  assertIdentifier(check.capability);
  assertTimestamp(check.observedAt);
  assertIdentifier(check.sourceClass);
  assertIdentifier(check.probeClass);
  assertIdentifier(check.expectedClass);
  assertIdentifier(check.actualClass);
  if (!new Set(["pass", "fail", "blocked"]).has(check.result)) {
    fail("a check result is unsupported");
  }
  assertArray(check.evidenceRefs);
  for (const reference of check.evidenceRefs) {
    assertReference(reference);
  }
  assertArray(check.evidenceHashes);
  for (const hash of check.evidenceHashes) {
    assertHash(hash);
  }
  assertInteger(check.freshnessMinutes, 1, 525600);
  if (check.result !== "blocked" && (check.evidenceRefs.length === 0 || check.evidenceHashes.length === 0)) {
    fail("pass/fail checks require evidence references and hashes");
  }
}

function validateInput(input) {
  assertObjectShape(
    input,
    ["schemaVersion", "manifestId", "evaluatedAt", "profile", "requirements", "checks", "options"],
    ["schemaVersion", "manifestId", "evaluatedAt", "profile", "requirements", "checks", "options"],
  );
  if (input.schemaVersion === 1) {
    fail("schemaVersion 1 is not migrated automatically; manually set schemaVersion to 2 and add boolean profile.homarr");
  }
  if (input.schemaVersion !== 2) {
    fail("schemaVersion must be 2");
  }
  assertIdentifier(input.manifestId);
  assertTimestamp(input.evaluatedAt);
  assertObjectShape(
    input.profile,
    ["publicIngress", "downloaderVpn", "backups", "media", "homarr"],
    ["publicIngress", "downloaderVpn", "backups", "media", "homarr"],
  );
  for (const value of Object.values(input.profile)) {
    assertBoolean(value);
  }
  assertArray(input.requirements);
  for (const item of input.requirements) {
    validateRequirement(item);
  }
  const customIds = new Set();
  for (const item of input.requirements) {
    if (customIds.has(item.id)) {
      fail("custom requirement identifiers must be unique");
    }
    customIds.add(item.id);
  }
  assertArray(input.checks);
  for (const check of input.checks) {
    validateCheck(check);
  }
  assertObjectShape(input.options, ["markdownSummary"], ["markdownSummary"]);
  assertBoolean(input.options.markdownSummary);
}

function selectedRequirements(input) {
  const selected = GENERIC_REQUIREMENTS.map((item) => ({ ...item }));
  for (const profileName of ["publicIngress", "downloaderVpn", "backups", "media", "homarr"]) {
    if (!input.profile[profileName]) {
      continue;
    }
    for (const item of SPECIALIZED_REQUIREMENTS[profileName]) {
      selected.push({ ...item });
    }
  }
  if (input.profile.publicIngress && input.profile.homarr) {
    selected.push({ ...CROSS_REQUIREMENTS.homarrPublicIngress });
  }
  const builtInIds = new Set(selected.map((item) => item.id));
  for (const item of input.requirements) {
    if (builtInIds.has(item.id)) {
      fail("custom requirement identifiers cannot collide with selected built-ins");
    }
    selected.push({ ...item });
    builtInIds.add(item.id);
  }
  return selected.sort((left, right) => left.id.localeCompare(right.id));
}

function checkSignature(check) {
  return JSON.stringify({
    capability: check.capability,
    observedAt: check.observedAt,
    sourceClass: check.sourceClass,
    probeClass: check.probeClass,
    expectedClass: check.expectedClass,
    actualClass: check.actualClass,
    result: check.result,
    evidenceRefs: [...check.evidenceRefs].sort(),
    evidenceHashes: [...check.evidenceHashes].sort(),
    freshnessMinutes: check.freshnessMinutes,
  });
}

function requirementMatches(check, expected) {
  return check.capability === expected.capability
    && check.sourceClass === expected.sourceClass
    && check.probeClass === expected.probeClass
    && check.expectedClass === expected.expectedClass;
}

function checkIsFresh(check, evaluatedAt) {
  const ageMilliseconds = Date.parse(evaluatedAt) - Date.parse(check.observedAt);
  if (ageMilliseconds < 0) {
    return false;
  }
  return ageMilliseconds <= check.freshnessMinutes * 60 * 1000;
}

function evidenceReady(check) {
  return check.evidenceRefs.length > 0 && check.evidenceHashes.length > 0;
}

function buildClaim(id, requirementIds, acceptedById, checksById) {
  const sortedIds = [...requirementIds].sort();
  const accepted = sortedIds.every((checkId) => acceptedById.has(checkId));
  const timestamps = [];
  const evidenceRefs = new Set();
  const evidenceHashes = new Set();
  for (const checkId of sortedIds) {
    const records = checksById.get(checkId);
    if (!records || records.length !== 1) {
      continue;
    }
    const check = records[0];
    timestamps.push(check.observedAt);
    for (const reference of check.evidenceRefs) {
      evidenceRefs.add(reference);
    }
    for (const hash of check.evidenceHashes) {
      evidenceHashes.add(hash);
    }
  }
  timestamps.sort();
  let state = "blocked";
  if (accepted) {
    state = "pass";
  }
  let from = null;
  let to = null;
  if (timestamps.length > 0) {
    from = timestamps[0];
    to = timestamps[timestamps.length - 1];
  }
  return {
    id,
    state,
    checkIds: sortedIds,
    evidenceWindow: { from, to },
    evidenceRefs: [...evidenceRefs].sort(),
    evidenceHashes: [...evidenceHashes].sort(),
  };
}

function markdownFor(result) {
  const lines = [
    "# Acceptance evidence",
    "",
    `- Manifest: ${result.manifestId}`,
    `- Status: ${result.status}`,
    `- Evaluated at: ${result.evaluatedAt}`,
    `- Required checks: ${result.counts.required}`,
    `- Accepted checks: ${result.counts.accepted}`,
    "",
    "## Claims",
    "",
  ];
  for (const claim of result.claims) {
    lines.push(`- ${claim.id}: ${claim.state}`);
  }
  lines.push("", "## Findings", "");
  for (const key of ["missing", "stale", "duplicates", "conflicts", "failed", "blocked"]) {
    const values = result.findings[key];
    let rendered = "none";
    if (values.length > 0) {
      rendered = values.join(", ");
    }
    lines.push(`- ${key}: ${rendered}`);
  }
  return `${lines.join("\n")}\n`;
}

function evaluate(input) {
  const requirements = selectedRequirements(input);
  const checks = [...input.checks].sort((left, right) => {
    const idOrder = left.id.localeCompare(right.id);
    if (idOrder !== 0) {
      return idOrder;
    }
    return checkSignature(left).localeCompare(checkSignature(right));
  });
  const checksById = new Map();
  for (const check of checks) {
    if (!checksById.has(check.id)) {
      checksById.set(check.id, []);
    }
    checksById.get(check.id).push(check);
  }

  const missing = new Set();
  const stale = new Set();
  const duplicates = new Set();
  const conflicts = new Set();
  const failed = new Set();
  const blocked = new Set();
  const acceptedById = new Set();
  const requiredById = new Map(requirements.map((item) => [item.id, item]));

  for (const [checkId, records] of checksById.entries()) {
    if (records.length <= 1) {
      continue;
    }
    duplicates.add(checkId);
    const signatures = new Set(records.map(checkSignature));
    if (signatures.size > 1) {
      conflicts.add(checkId);
    }
  }

  for (const expected of requirements) {
    const records = checksById.get(expected.id);
    if (!records || records.length === 0) {
      missing.add(expected.id);
      continue;
    }
    if (records.length !== 1) {
      continue;
    }
    const check = records[0];
    if (!requirementMatches(check, expected)) {
      conflicts.add(check.id);
      continue;
    }
    if (!checkIsFresh(check, input.evaluatedAt)) {
      stale.add(check.id);
      continue;
    }
    if (check.result === "blocked") {
      blocked.add(check.id);
      continue;
    }
    if (check.result === "fail" || check.actualClass !== check.expectedClass) {
      failed.add(check.id);
      continue;
    }
    if (!evidenceReady(check)) {
      blocked.add(check.id);
      continue;
    }
    acceptedById.add(check.id);
  }

  for (const check of checks) {
    if (requiredById.has(check.id)) {
      continue;
    }
    if (!checkIsFresh(check, input.evaluatedAt)) {
      stale.add(check.id);
    }
    if (check.result === "blocked") {
      blocked.add(check.id);
    }
    if (check.result === "fail" || check.actualClass !== check.expectedClass) {
      failed.add(check.id);
    }
  }

  let status = "pass";
  if (conflicts.size > 0) {
    status = "conflict";
  } else if (failed.size > 0 || missing.size > 0 || stale.size > 0 || duplicates.size > 0 || blocked.size > 0) {
    status = "blocked";
  }

  const genericIds = GENERIC_REQUIREMENTS.map((item) => item.id);
  const claims = [buildClaim("generic-acceptance", genericIds, acceptedById, checksById)];
  if (input.profile.publicIngress) {
    claims.push(buildClaim("public-ingress-acceptance", SPECIALIZED_REQUIREMENTS.publicIngress.map((item) => item.id), acceptedById, checksById));
  }
  if (input.profile.downloaderVpn) {
    claims.push(buildClaim("downloader-vpn-fail-closed", SPECIALIZED_REQUIREMENTS.downloaderVpn.map((item) => item.id), acceptedById, checksById));
  }
  if (input.profile.backups) {
    claims.push(buildClaim("backup-restore-acceptance", SPECIALIZED_REQUIREMENTS.backups.map((item) => item.id), acceptedById, checksById));
  }
  if (input.profile.media) {
    claims.push(buildClaim("media-service-graph-acceptance", SPECIALIZED_REQUIREMENTS.media.map((item) => item.id), acceptedById, checksById));
  }
  if (input.profile.homarr) {
    const homarrRequirementIds = SPECIALIZED_REQUIREMENTS.homarr.map((item) => item.id);
    if (input.profile.publicIngress) {
      homarrRequirementIds.push(CROSS_REQUIREMENTS.homarrPublicIngress.id);
    }
    claims.push(buildClaim("homarr-control-plane-acceptance", homarrRequirementIds, acceptedById, checksById));
  }
  if (input.requirements.length > 0) {
    claims.push(buildClaim("custom-requirements", input.requirements.map((item) => item.id), acceptedById, checksById));
  }

  const checkSummaries = checks.map((check) => {
    let state = "unrequired";
    if (acceptedById.has(check.id)) {
      state = "accepted";
    } else if (conflicts.has(check.id)) {
      state = "conflict";
    } else if (duplicates.has(check.id)) {
      state = "duplicate";
    } else if (stale.has(check.id)) {
      state = "stale";
    } else if (failed.has(check.id)) {
      state = "fail";
    } else if (blocked.has(check.id)) {
      state = "blocked";
    }
    return {
      id: check.id,
      capability: check.capability,
      observedAt: check.observedAt,
      sourceClass: check.sourceClass,
      probeClass: check.probeClass,
      expectedClass: check.expectedClass,
      actualClass: check.actualClass,
      result: check.result,
      freshnessMinutes: check.freshnessMinutes,
      state,
      evidenceRefs: [...check.evidenceRefs].sort(),
      evidenceHashes: [...check.evidenceHashes].sort(),
    };
  });

  const result = {
    schemaVersion: 2,
    capability: "acceptance-evidence",
    manifestId: input.manifestId,
    evaluatedAt: input.evaluatedAt,
    status,
    counts: {
      required: requirements.length,
      supplied: checks.length,
      accepted: acceptedById.size,
    },
    findings: {
      missing: [...missing].sort(),
      stale: [...stale].sort(),
      duplicates: [...duplicates].sort(),
      conflicts: [...conflicts].sort(),
      failed: [...failed].sort(),
      blocked: [...blocked].sort(),
    },
    claims,
    checks: checkSummaries,
    claimBoundary: "Claims cover only listed check IDs, supplied timestamps, classifications, references, and hashes.",
    mutationsPerformed: false,
  };
  if (input.options.markdownSummary) {
    result.markdownSummary = markdownFor(result);
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
