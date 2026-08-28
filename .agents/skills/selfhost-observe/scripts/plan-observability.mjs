#!/usr/bin/env node

import fs from "node:fs";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_COLLECTION_ITEMS = 100;
const MAX_STRING_LENGTH = 2048;
const LAYER_IDS = [
  "container-process",
  "api-readiness",
  "dependency",
  "edge",
  "storage-capacity",
  "backup-freshness",
  "logs",
  "metrics",
  "alerts",
];
const ALWAYS_REQUIRED = new Set([
  "container-process",
  "api-readiness",
  "storage-capacity",
  "logs",
  "metrics",
  "alerts",
]);
const REQUIRED_PROBES = new Map([
  ["container-process", ["container-process"]],
  ["api-readiness", ["readiness"]],
  ["dependency", ["dependency-readiness"]],
  ["edge", ["dns-resolution", "tls-certificate", "auth-enforcement", "direct-port-privacy"]],
  ["storage-capacity", ["capacity"]],
  ["backup-freshness", ["backup-freshness"]],
  ["logs", ["log-collection"]],
  ["metrics", ["metrics-collection"]],
  ["alerts", ["alert-delivery"]],
]);
const RESOURCE_CLASSES = new Set(["application", "admin", "database", "queue", "monitor", "proxy", "storage", "backup"]);
const PROBE_SCHEMES = new Set(["http", "https", "tcp", "tls", "dns", "unix", "none"]);
const HOST_CLASSES = new Set(["loopback", "private-dns", "service-dns", "public-dns", "redacted"]);
const PROTECTED_CLASSES = new Set(["admin", "database", "queue", "monitor", "backup"]);

function usage() {
  process.stdout.write("Usage: plan-observability.mjs (--input FILE | --json JSON)\n\n");
  process.stdout.write("Create a redacted observability plan from explicit state and evidence.\n");
}

function fail(message) {
  process.stderr.write(`plan-observability.mjs: ${message}\n`);
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

function assertNullableTimestamp(value) {
  if (value === null) {
    return;
  }
  assertTimestamp(value);
}

function assertNullableIdentifier(value) {
  if (value === null) {
    return;
  }
  assertIdentifier(value);
}

function assertEvidenceArrays(references, hashes) {
  assertArray(references);
  for (const reference of references) {
    assertReference(reference);
  }
  assertArray(hashes);
  for (const hash of hashes) {
    assertHash(hash);
  }
}

function validateTarget(target) {
  assertObjectShape(target, ["url", "scheme", "hostClass", "port"], ["url", "scheme", "hostClass", "port"]);
  if (!PROBE_SCHEMES.has(target.scheme)) {
    fail("a probe scheme is unsupported");
  }
  if (!HOST_CLASSES.has(target.hostClass)) {
    fail("a probe host class is unsupported");
  }
  if (target.port !== null) {
    assertInteger(target.port, 1, 65535);
  }
  if (target.url === null) {
    return;
  }
  if (typeof target.url !== "string" || target.url.length > 2048) {
    fail("a probe URL is invalid");
  }
  let parsed;
  try {
    parsed = new URL(target.url);
  } catch {
    fail("a probe URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("probe URLs must use http or https");
  }
  if (target.scheme !== parsed.protocol.slice(0, -1)) {
    fail("a probe URL scheme does not match its classification");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("probe URLs cannot contain credentials, query strings, or fragments");
  }
}

function validateCheck(check, layerState) {
  assertObjectShape(
    check,
    ["id", "probeClass", "target", "expectedClass", "actualClass", "result", "observedAt", "evidenceRefs", "evidenceHashes"],
    ["id", "probeClass", "target", "expectedClass", "actualClass", "result", "observedAt", "evidenceRefs", "evidenceHashes"],
  );
  assertIdentifier(check.id);
  assertIdentifier(check.probeClass);
  validateTarget(check.target);
  assertIdentifier(check.expectedClass);
  assertNullableIdentifier(check.actualClass);
  assertNullableTimestamp(check.observedAt);
  assertEvidenceArrays(check.evidenceRefs, check.evidenceHashes);
  if (layerState === "planned") {
    if (check.result !== "planned" || check.actualClass !== null || check.observedAt !== null || check.evidenceRefs.length > 0 || check.evidenceHashes.length > 0) {
      fail("planned checks cannot contain configured or observed evidence");
    }
    return;
  }
  if (layerState === "configured") {
    if (check.result !== "configured" || check.actualClass !== null || check.observedAt !== null || check.evidenceRefs.length > 0 || check.evidenceHashes.length > 0) {
      fail("configured checks cannot contain observed evidence");
    }
    return;
  }
  if (!new Set(["pass", "fail", "blocked"]).has(check.result)) {
    fail("an observed check result is unsupported");
  }
  if (check.observedAt === null || check.actualClass === null) {
    fail("observed checks require timestamped actual classifications");
  }
  if (check.result !== "blocked" && (check.evidenceRefs.length === 0 || check.evidenceHashes.length === 0)) {
    fail("observed pass/fail checks require evidence references and hashes");
  }
}

function validateInput(input) {
  assertObjectShape(
    input,
    ["schemaVersion", "project", "scope", "resources", "collection", "layers", "telemetry", "reuse"],
    ["schemaVersion", "project", "scope", "resources", "collection", "layers", "telemetry", "reuse"],
  );
  if (input.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  assertObjectShape(input.project, ["id", "owner"], ["id", "owner"]);
  assertIdentifier(input.project.id);
  assertIdentifier(input.project.owner, true);

  assertObjectShape(input.scope, ["mode", "publicIngress", "hasDependencies", "backupsExpected"], ["mode", "publicIngress", "hasDependencies", "backupsExpected"]);
  if (input.scope.mode !== "minimal" && input.scope.mode !== "full") {
    fail("scope mode must be minimal or full");
  }
  assertBoolean(input.scope.publicIngress);
  assertBoolean(input.scope.hasDependencies);
  assertBoolean(input.scope.backupsExpected);

  assertArray(input.resources);
  for (const resource of input.resources) {
    assertObjectShape(resource, ["id", "owner", "class", "protectedAdmin", "visibility"], ["id", "owner", "class", "protectedAdmin", "visibility"]);
    assertIdentifier(resource.id);
    assertIdentifier(resource.owner, true);
    if (!RESOURCE_CLASSES.has(resource.class)) {
      fail("a resource class is unsupported");
    }
    assertBoolean(resource.protectedAdmin);
    if (!new Set(["private", "public", "none"]).has(resource.visibility)) {
      fail("a resource visibility is unsupported");
    }
  }

  assertObjectShape(input.collection, ["runtimeMethod", "dockerSocket"], ["runtimeMethod", "dockerSocket"]);
  if (!new Set(["application-api", "runtime-cli", "agent", "existing-monitor", "docker-socket", "mixed"]).has(input.collection.runtimeMethod)) {
    fail("a runtime collection method is unsupported");
  }
  assertObjectShape(input.collection.dockerSocket, ["mode", "approved", "owner"], ["mode", "approved", "owner"]);
  if (!new Set(["none", "socket-proxy", "direct-readonly"]).has(input.collection.dockerSocket.mode)) {
    fail("a Docker socket mode is unsupported");
  }
  assertBoolean(input.collection.dockerSocket.approved);
  assertIdentifier(input.collection.dockerSocket.owner, true);

  assertArray(input.layers);
  if (input.layers.length !== LAYER_IDS.length) {
    fail("all observability layers must be represented exactly once");
  }
  const layerIds = new Set();
  const checkIds = new Set();
  for (const layer of input.layers) {
    assertObjectShape(layer, ["id", "required", "owner", "state", "method", "checks"], ["id", "required", "owner", "state", "method", "checks"]);
    if (!LAYER_IDS.includes(layer.id) || layerIds.has(layer.id)) {
      fail("observability layers must be unique and supported");
    }
    layerIds.add(layer.id);
    assertBoolean(layer.required);
    assertIdentifier(layer.owner, true);
    if (!new Set(["planned", "configured", "observed"]).has(layer.state)) {
      fail("a layer state is unsupported");
    }
    assertIdentifier(layer.method);
    assertArray(layer.checks);
    for (const check of layer.checks) {
      validateCheck(check, layer.state);
      if (checkIds.has(check.id)) {
        fail("check identifiers must be unique");
      }
      checkIds.add(check.id);
    }
  }

  assertObjectShape(input.telemetry, ["logs", "metrics", "alerts"], ["logs", "metrics", "alerts"]);
  assertObjectShape(input.telemetry.logs, ["owner", "retentionDays", "piiPolicy"], ["owner", "retentionDays", "piiPolicy"]);
  assertIdentifier(input.telemetry.logs.owner, true);
  assertInteger(input.telemetry.logs.retentionDays, 0, 3650);
  if (!new Set(["redact", "drop", "allow-reviewed"]).has(input.telemetry.logs.piiPolicy)) {
    fail("a log PII policy is unsupported");
  }
  assertObjectShape(input.telemetry.metrics, ["owner", "retentionDays"], ["owner", "retentionDays"]);
  assertIdentifier(input.telemetry.metrics.owner, true);
  assertInteger(input.telemetry.metrics.retentionDays, 0, 3650);
  assertObjectShape(input.telemetry.alerts, ["owner", "routes"], ["owner", "routes"]);
  assertIdentifier(input.telemetry.alerts.owner, true);
  assertArray(input.telemetry.alerts.routes);
  for (const route of input.telemetry.alerts.routes) {
    assertObjectShape(
      route,
      ["id", "kind", "owner", "destinationRef", "state", "observedAt", "evidenceRefs", "evidenceHashes"],
      ["id", "kind", "owner", "destinationRef", "state", "observedAt", "evidenceRefs", "evidenceHashes"],
    );
    assertIdentifier(route.id);
    if (!new Set(["local", "email", "webhook", "push", "pager"]).has(route.kind)) {
      fail("an alert route kind is unsupported");
    }
    assertIdentifier(route.owner, true);
    assertReference(route.destinationRef);
    if (!new Set(["planned", "configured", "observed"]).has(route.state)) {
      fail("an alert route state is unsupported");
    }
    assertNullableTimestamp(route.observedAt);
    assertEvidenceArrays(route.evidenceRefs, route.evidenceHashes);
    if (route.state === "observed" && (route.observedAt === null || route.evidenceRefs.length === 0 || route.evidenceHashes.length === 0)) {
      fail("observed alert routes require timestamped evidence");
    }
    if (route.state !== "observed" && (route.observedAt !== null || route.evidenceRefs.length > 0 || route.evidenceHashes.length > 0)) {
      fail("planned/configured alert routes cannot contain observed evidence");
    }
  }

  assertArray(input.reuse);
  for (const reuse of input.reuse) {
    assertObjectShape(
      reuse,
      ["id", "kind", "owner", "lifecycleOwner", "accepted", "protectedAdmin", "visibility"],
      ["id", "kind", "owner", "lifecycleOwner", "accepted", "protectedAdmin", "visibility"],
    );
    assertIdentifier(reuse.id);
    assertIdentifier(reuse.kind);
    assertIdentifier(reuse.owner, true);
    assertIdentifier(reuse.lifecycleOwner, true);
    assertBoolean(reuse.accepted);
    assertBoolean(reuse.protectedAdmin);
    if (!new Set(["private", "public", "none"]).has(reuse.visibility)) {
      fail("a reused monitor visibility is unsupported");
    }
  }
}

function layerIsRequired(layerId, scope) {
  if (ALWAYS_REQUIRED.has(layerId)) {
    return true;
  }
  if (layerId === "dependency") {
    return scope.hasDependencies;
  }
  if (layerId === "edge") {
    return scope.publicIngress;
  }
  if (layerId === "backup-freshness") {
    return scope.backupsExpected;
  }
  return false;
}

function sanitizedCheck(check) {
  return {
    id: check.id,
    probeClass: check.probeClass,
    target: {
      scheme: check.target.scheme,
      hostClass: check.target.hostClass,
      port: check.target.port,
    },
    result: check.result,
    observedAt: check.observedAt,
  };
}

function evaluate(input) {
  const gates = [];
  const conflicts = [];
  const decisionsNeeded = [];
  const layers = [...input.layers].sort((left, right) => LAYER_IDS.indexOf(left.id) - LAYER_IDS.indexOf(right.id));

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

  gate("project-owner", input.project.owner.length > 0, "Assign an accountable observability owner.");

  for (const resource of input.resources) {
    gate(`resource-owner:${resource.id}`, resource.owner.length > 0, "Assign an owner to every observed resource.");
    if (resource.visibility === "public" && (resource.protectedAdmin || PROTECTED_CLASSES.has(resource.class))) {
      conflict("protected-public-surface", [resource.id], "Keep protected administration and control surfaces private.");
    }
  }

  for (const reuse of input.reuse) {
    if (reuse.accepted) {
      gate(`reuse-owner:${reuse.id}`, reuse.owner.length > 0 && reuse.lifecycleOwner.length > 0, "Record the owner and lifecycle owner for every reused monitor.");
    }
    if (reuse.accepted && reuse.protectedAdmin && reuse.visibility === "public") {
      conflict("protected-public-reuse", [reuse.id], "Keep reused monitoring administration private.");
    }
  }

  const socket = input.collection.dockerSocket;
  if (socket.mode !== "none") {
    gate("docker-socket-owner", socket.owner.length > 0, "Assign an owner to the selected Docker access boundary.");
  }
  if (socket.mode === "direct-readonly" && !socket.approved) {
    conflict("unapproved-direct-docker-socket", [], "Direct Docker socket access requires explicit risk approval.");
  }
  if (input.collection.runtimeMethod === "docker-socket") {
    gate("docker-socket-contract", socket.mode !== "none" && socket.approved && socket.owner.length > 0, "Record an approved, owned Docker access contract or choose another runtime method.");
  }

  let observedFailure = false;
  for (const layer of layers) {
    const required = layerIsRequired(layer.id, input.scope);
    gate(`required-classification:${layer.id}`, layer.required === required, "Match each layer's required flag to dependency, ingress, and backup scope.");
    if (required) {
      gate(`layer-owner:${layer.id}`, layer.owner.length > 0, "Assign an owner to every required observability layer.");
      gate(`layer-checks:${layer.id}`, layer.checks.length > 0, "Define at least one check for every required observability layer.");
      const probeClasses = new Set(layer.checks.map((check) => check.probeClass));
      for (const probeClass of REQUIRED_PROBES.get(layer.id)) {
        gate(`required-probe:${layer.id}:${probeClass}`, probeClasses.has(probeClass), "Define every mandatory probe class for the required observability layer.");
      }
    }
    if (layer.state === "observed") {
      for (const check of layer.checks) {
        const passing = check.result === "pass" && check.actualClass === check.expectedClass;
        gate(`observed-result:${check.id}`, passing, "Resolve failed, blocked, or classification-mismatched observations.");
        if (!passing) {
          observedFailure = true;
        }
      }
    }
  }

  gate("logs-owner", input.telemetry.logs.owner.length > 0, "Assign an owner for logs and their retention/PII policy.");
  gate("metrics-owner", input.telemetry.metrics.owner.length > 0, "Assign an owner for metrics and their retention.");
  gate("alerts-owner", input.telemetry.alerts.owner.length > 0, "Assign an owner for alerting.");
  gate("alert-routing", input.telemetry.alerts.routes.length > 0, "Configure at least one accountable alert route.");
  for (const route of input.telemetry.alerts.routes) {
    gate(`alert-route-owner:${route.id}`, route.owner.length > 0, "Assign an owner to every alert route.");
  }
  const alertLayer = layers.find((layer) => layer.id === "alerts");
  if (alertLayer.state === "configured") {
    const configuredRoute = input.telemetry.alerts.routes.some((route) => route.state === "configured" || route.state === "observed");
    gate("configured-alert-route", configuredRoute, "Configure at least one alert route before classifying alerting as configured.");
  }
  if (alertLayer.state === "observed") {
    const observedRoute = input.telemetry.alerts.routes.some((route) => route.state === "observed");
    gate("observed-alert-route", observedRoute, "Record timestamped delivery evidence for at least one alert route before classifying alerting as observed.");
  }

  let status = "pass";
  if (conflicts.length > 0) {
    status = "conflict";
  } else if (gates.some((item) => item.status === "blocked")) {
    status = "blocked";
  }

  const requiredLayers = layers.filter((layer) => layerIsRequired(layer.id, input.scope));
  let planState = "observed";
  if (requiredLayers.some((layer) => layer.state === "planned")) {
    planState = "planned";
  } else if (requiredLayers.some((layer) => layer.state === "configured")) {
    planState = "configured";
  }
  let verificationState = "not-observed";
  if (planState === "observed" && !observedFailure && status === "pass") {
    verificationState = "observed-passing";
  }
  if (planState === "observed" && observedFailure) {
    verificationState = "observed-failing";
  }

  return {
    schemaVersion: 1,
    capability: "observability",
    status,
    project: { id: input.project.id, ownerAssigned: input.project.owner.length > 0 },
    scope: {
      mode: input.scope.mode,
      publicIngress: input.scope.publicIngress,
      hasDependencies: input.scope.hasDependencies,
      backupsExpected: input.scope.backupsExpected,
    },
    plan: {
      state: planState,
      requiredLayerCount: requiredLayers.length,
      representedLayerCount: layers.length,
      acceptedReuse: input.reuse.filter((item) => item.accepted).map((item) => item.id).sort(),
      dockerSocketMode: socket.mode,
    },
    verification: {
      state: verificationState,
      claim: "Only the required recorded checks at their supplied timestamps are classified; no host or service was probed by this planner.",
    },
    layers: layers.map((layer) => ({
      id: layer.id,
      required: layerIsRequired(layer.id, input.scope),
      ownerAssigned: layer.owner.length > 0,
      state: layer.state,
      method: layer.method,
      checks: layer.checks.map(sanitizedCheck),
    })),
    gates,
    conflicts,
    decisionsNeeded: [...new Set(decisionsNeeded)].sort(),
    mutationsPerformed: false,
  };
}

function main() {
  const input = readDocument(parseArgs(process.argv.slice(2)));
  assertSecretFree(input);
  validateInput(input);
  process.stdout.write(`${JSON.stringify(evaluate(input), null, 2)}\n`);
}

main();
