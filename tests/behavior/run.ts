#!/usr/bin/env bun

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(join(root, "tests/behavior/scenarios.json"), "utf8"));
const sentinel = "NOT_A_REAL_SECRET_7f31";
const hash = `sha256:${"0".repeat(64)}`;
const observedAt = "2026-09-06T10:00:00Z";
const temporaryRoot = mkdtempSync(join(tmpdir(), "selfhost-behavior-"));
let secretFixtureCounter = 0;

function execute(relativePath, args = [], input = null, command = process.execPath) {
  const executable = command === process.execPath ? process.execPath : command;
  const commandArgs = command === process.execPath ? [join(root, relativePath), ...args] : [join(root, relativePath), ...args];
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    encoding: "utf8",
    input,
    env: { PATH: process.env.PATH || "", LANG: "C", LC_ALL: "C" },
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, `${relativePath} failed to start`);
  return { exitCode: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function runBun(relativePath, args = [], input = null) {
  return execute(relativePath, args, input);
}

function bash(relativePath, args = []) {
  return execute(relativePath, args, null, "bash");
}

function parseJson(result, stream = "stdout") {
  const value = result[stream].trim();
  assert.notEqual(value, "", `expected JSON on ${stream}`);
  return JSON.parse(value);
}

function assertExit(result, expected) {
  assert.equal(result.exitCode, expected, `${result.stdout}${result.stderr}`);
}

function assertNoSecret(result) {
  assert.equal(`${result.stdout}${result.stderr}`.includes(sentinel), false, "secret-like input was echoed");
}

function deterministic(run, normalize = (value) => value) {
  const first = run();
  const second = run();
  assert.deepEqual(normalize(second), normalize(first), "repeated execution was not deterministic");
  return first;
}

function writeJson(name, value) {
  const path = join(temporaryRoot, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return path;
}

function backupInput() {
  const target = (id, kind, path, failureDomain) => ({
    id,
    kind,
    path,
    failureDomain,
    sourceIds: ["database"],
    owner: "operations",
    encryption: {
      enabled: true,
      secretRefs: [`backup.${id}.key`],
      custody: { owner: "recovery", locationRef: `vault:backup/${id}`, independent: true, lastConfirmedAt: observedAt },
    },
    immutable: kind === "off-host",
    versioned: true,
    offline: false,
    destructive: false,
    destructiveApproved: false,
  });
  return {
    schemaVersion: 1,
    project: { id: "private-demo", owner: "operations" },
    objectives: { rpoMinutes: 60, rtoMinutes: 120 },
    sources: [{
      id: "database",
      class: "database",
      path: "/srv/private-demo/database",
      failureDomain: "host-a",
      included: true,
      rebuildable: false,
      owner: "operations",
      consistency: { method: "native-export", versionCaptured: true, quiesceOwner: null },
    }],
    targets: [
      target("local", "local", "/srv/private-demo-backups/local", "host-a"),
      target("off-host", "off-host", "/mnt/off-host/private-demo", "site-b"),
    ],
    schedule: {
      cadenceMinutes: 30,
      retention: { keepLast: 3, daily: 7, weekly: 4, monthly: 3 },
      pruning: { enabled: false, approved: false, owner: "operations" },
    },
    notifications: { failureOwner: "operations", routeRefs: ["alerts:backup-failures"] },
    restoreDrill: {
      observedAt,
      isolatedTarget: true,
      targetPath: "/srv/restore-tests/private-demo",
      sourceIds: ["database"],
      durationMinutes: 45,
      productionOverwritten: false,
      integrity: { result: "pass", objectsChecked: 12, ownershipPreserved: true },
      applicationAcceptance: { result: "pass", checks: [{ id: "database-read", result: "pass" }] },
      evidenceRefs: ["artifact:restore/private-demo"],
      evidenceHashes: [hash],
    },
  };
}

function composeInput() {
  return {
    schemaVersion: 1,
    project: {
      dockerContext: "default",
      id: "private-demo",
      owner: "private-demo",
      root: "/srv/selfhost-projects",
      directory: "/srv/selfhost-projects/private-demo",
      ownership: "new",
    },
    services: [{
      id: "web",
      image: "docker.io/library/nginx:1.27.4",
      restart: "unless-stopped",
      readOnly: true,
      user: "1000:1000",
      environment: [{ name: "TZ", value: "Europe/Berlin" }],
      ports: [{ hostIp: "127.0.0.1", published: 18080, target: 8080, protocol: "tcp", purpose: "application", publicApproved: false }],
      mounts: [{ source: "/srv/selfhost-data/private-demo", target: "/data", readOnly: false, shared: false, owner: "private-demo", ownership: "new" }],
      networks: ["private"],
      secretRefs: [{ name: "session-key", ref: "vault/private-demo/session-key", target: "session_key" }],
    }],
    networks: [{ id: "private", name: "private-demo-private", driver: "bridge", internal: true, owner: "private-demo", ownership: "new" }],
    observed: { checkedAt: observedAt, project: null, ports: [], paths: [], networks: [] },
  };
}

function ingressInput() {
  return {
    schemaVersion: 1,
    service: { id: "homarr", class: "application", directBindings: [{ address: "127.0.0.1", port: 7575, internetReachable: false }] },
    facts: {
      existingIngress: [{ kind: "caddy", owner: "edge-team", lifecycleOwner: "edge-team", routeContract: "managed-caddyfile", network: "edge", acceptsRoutes: true, ports: [80, 443] }],
      ownership: {
        ports: [{ port: 80, owner: "edge-team" }, { port: 443, owner: "edge-team" }],
        dns: [{ zone: "example.com", owner: "dns-team" }],
        tls: [{ hostname: "homarr.example.com", owner: "edge-team" }],
      },
    },
    preferences: {
      route: "reverse-proxy",
      hostname: "homarr.example.com",
      desiredOwner: "edge-team",
      publicApproved: true,
      authentication: { mode: "oidc", owner: "identity-team", approved: true },
      secretRefs: [],
      nativeMcp: { publicAccess: "deny", privateBridgeRoute: "loopback" },
    },
  };
}

function observedCheck(id, probeClass) {
  return {
    id,
    probeClass,
    target: { url: null, scheme: "none", hostClass: "redacted", port: null },
    expectedClass: "pass",
    actualClass: "pass",
    result: "pass",
    observedAt,
    evidenceRefs: [`artifact:observe/${id}`],
    evidenceHashes: [hash],
  };
}

function observeInput() {
  const probes = new Map([
    ["container-process", "container-process"],
    ["api-readiness", "readiness"],
    ["storage-capacity", "capacity"],
    ["logs", "log-collection"],
    ["metrics", "metrics-collection"],
    ["alerts", "alert-delivery"],
  ]);
  const layerIds = ["container-process", "api-readiness", "dependency", "edge", "storage-capacity", "backup-freshness", "logs", "metrics", "alerts"];
  return {
    schemaVersion: 1,
    project: { id: "private-demo", owner: "operations" },
    scope: { mode: "minimal", publicIngress: false, hasDependencies: false, backupsExpected: false },
    resources: [{ id: "application", owner: "operations", class: "application", protectedAdmin: false, visibility: "private" }],
    collection: { runtimeMethod: "application-api", dockerSocket: { mode: "none", approved: false, owner: "" } },
    layers: layerIds.map((id) => {
      if (probes.has(id)) {
        return { id, required: true, owner: "operations", state: "observed", method: "recorded-evidence", checks: [observedCheck(`${id}-check`, probes.get(id))] };
      }
      return { id, required: false, owner: "", state: "planned", method: "not-required", checks: [] };
    }),
    telemetry: {
      logs: { owner: "operations", retentionDays: 14, piiPolicy: "redact" },
      metrics: { owner: "operations", retentionDays: 30 },
      alerts: { owner: "operations", routes: [{ id: "primary", kind: "local", owner: "operations", destinationRef: "alerts:primary", state: "observed", observedAt, evidenceRefs: ["artifact:alerts/primary"], evidenceHashes: [hash] }] },
    },
    reuse: [],
  };
}

function operationInput() {
  return {
    schemaVersion: 1,
    project: { dockerContext: "default", id: "photos", owner: "photos", manifestRef: "manifests/photos-v1", ownershipVerified: true },
    operation: {
      id: "photos-upgrade-1-2",
      type: "upgrade",
      risk: "stateful",
      currentVersion: "v1.1.0",
      targetVersion: "v1.2.0",
      reversibility: "reversible",
      summary: "Upgrade after compatibility and restore gates pass.",
      forwardOnlyApproved: false,
    },
    compatibilityEvidence: [{ id: "upstream-upgrade-notes", sourceRef: "https://docs.example.invalid/upgrade-1-2", checkedAt: observedAt, claim: "The direct upgrade path supports this version pair." }],
    backup: {
      required: true,
      artifactRef: "backups/photos/pre-upgrade-20260906",
      capturedAt: observedAt,
      restoreEvidence: { id: "restore-drill-20260906", verifiedAt: observedAt, scope: "Application data and database restored into an isolated target." },
    },
    rollback: { mode: "compose-reapply", manifestRef: "manifests/photos-v1", statement: "Reapply the prior manifest, restore the recorded backup if data changed, then rerun acceptance checks." },
    healthChecks: [{ id: "application-health", kind: "api", criterion: "The authenticated application health contract passes." }],
    acceptanceChecks: [{ id: "core-workflow", kind: "ui", criterion: "A representative signed-in workflow reads and writes expected data." }],
    observed: { checkedAt: observedAt, project: { dockerContext: "default", id: "photos", owner: "photos", manifestRef: "manifests/photos-v1" }, currentVersion: "v1.1.0", health: "healthy" },
  };
}

function evidenceInput() {
  const requirementRows = [
    ["container-process", "runtime", "runtime", "container-process", "healthy"],
    ["api-readiness", "application", "application-api", "readiness", "ready"],
    ["storage-capacity", "storage", "filesystem", "capacity", "within-threshold"],
  ];
  return {
    schemaVersion: 2,
    manifestId: "private-demo-acceptance",
    evaluatedAt: "2026-09-06T10:05:00Z",
    profile: { publicIngress: false, downloaderVpn: false, backups: false, media: false, homarr: false },
    requirements: [],
    checks: requirementRows.map(([id, capability, sourceClass, probeClass, expectedClass]) => ({
      id,
      capability,
      observedAt,
      sourceClass,
      probeClass,
      expectedClass,
      actualClass: expectedClass,
      result: "pass",
      evidenceRefs: [`artifact:acceptance/${id}`],
      evidenceHashes: [hash],
      freshnessMinutes: 30,
    })),
    options: { markdownSummary: false },
  };
}

function vpnInput() {
  return {
    schemaVersion: 1,
    service: { id: "qbittorrent", class: "downloader", webUiPort: 8080 },
    facts: { observedTopology: { downloaderSharesGatewayNamespace: true, downloaderPublishesPorts: false, webUiPublishedByGateway: true, gatewayHasTun: true, gatewayHasNetAdmin: true, killSwitchEnabled: true, lanAllowlistApplied: true } },
    preferences: { mode: "gluetun", gatewayService: "gluetun", scope: ["qbittorrent"], lanControlCidrs: ["192.168.1.0/24"], webUiBind: "127.0.0.1", secretRefs: ["vpn.credentials"], legalContentOnly: true, peerValidationRequested: false },
    evidence: {
      healthy: { tunnelUp: true, externalIpObserved: true, expectedTunnelEgress: true, dnsResolverObserved: true, dnsUsesTunnel: true },
      tunnelBreak: { performed: true, recordedAt: observedAt, tunnelDownObserved: true, downloaderStayedRunning: true, externalRequestFailed: true, dnsRequestFailed: true },
      restored: { tunnelUp: true, expectedTunnelEgress: true },
      routeAudit: { noDirectDefaultRoute: true, firewallRestrictsEgress: true },
    },
  };
}

function secretRejection(relativePath, argsForPath, input) {
  secretFixtureCounter += 1;
  const path = writeJson(`secret-${secretFixtureCounter}.json`, { ...input, password: sentinel });
  const result = runBun(relativePath, argsForPath(path));
  assert.notEqual(result.exitCode, 0);
  assertNoSecret(result);
}

async function selfhost() {
  const cli = ".agents/skills/selfhost/scripts/selfhost.ts";
  const project = join(temporaryRoot, "router-project");
  mkdirSync(project, { mode: 0o700 });
  const passing = deterministic(() => runBun(cli, ["plan", "photos", "--project-root", project, "--json"]));
  assertExit(passing, 0);
  const output = parseJson(passing);
  assert.equal(output.status, "pass");
  assert.equal(output.mutation, false);
  const blocked = deterministic(() => runBun(cli, ["plan", "--project-root", project, "--json"]));
  assertExit(blocked, 3);
  assert.equal(parseJson(blocked).status, "blocked");
  const secret = runBun(cli, ["preferences", "set", "password", sentinel, "--project-root", project, "--json"]);
  assertExit(secret, 3);
  assertNoSecret(secret);
  const router = deterministic(() => runBun(".agents/skills/selfhost/scripts/check-router.ts"));
  assertExit(router, 0);
  assert.match(router.stdout, /^selfhost router checks passed/);
}

async function backup() {
  const cli = ".agents/skills/selfhost-backup/scripts/plan-backup.ts";
  const input = backupInput();
  const passing = deterministic(() => runBun(cli, ["--json", JSON.stringify(input)]));
  assertExit(passing, 0);
  assert.equal(parseJson(passing).restore.state, "verified");
  const conflictInput = structuredClone(input);
  conflictInput.targets[0].destructive = true;
  const conflict = deterministic(() => runBun(cli, ["--json", JSON.stringify(conflictInput)]));
  assertExit(conflict, 0);
  assert.equal(parseJson(conflict).conflicts.some((item) => item.id === "unapproved-destructive-target"), true);
  secretRejection(cli, (path) => ["--input", path], input);
}

async function compose() {
  const cli = ".agents/skills/selfhost-compose/scripts/compose-project.ts";
  const input = composeInput();
  const path = writeJson("compose-pass.json", input);
  const passing = deterministic(() => runBun(cli, ["validate", "--input", path]));
  assertExit(passing, 0);
  const output = parseJson(passing);
  assert.equal(output.status, "pass");
  assert.equal(output.dockerInvoked, false);
  const conflictInput = structuredClone(input);
  conflictInput.observed.project = { id: "private-demo", directory: "/srv/selfhost-projects/private-demo", owner: "private-demo" };
  const conflictPath = writeJson("compose-conflict.json", conflictInput);
  const conflict = deterministic(() => runBun(cli, ["validate", "--input", conflictPath]));
  assertExit(conflict, 3);
  assert.equal(parseJson(conflict).status, "conflict");
  secretRejection(cli, (secretPath) => ["validate", "--input", secretPath], input);
}

async function homarr() {
  const cli = ".agents/skills/selfhost-homarr/scripts/integration-plan.ts";
  const selection = { selectedApps: ["seerr", "immich"], media: true, connectedIntegrations: ["seerr", "sonarr", "radarr", "prowlarr", "qbittorrent", "jellyfin"], generatedDashboard: true };
  const path = writeJson("homarr-pass.json", selection);
  const passing = deterministic(() => runBun(cli, [path]));
  assertExit(passing, 0);
  assert.equal(parseJson(passing).media.generatedDashboardGate, "ready-for-managed-evidence-check");
  const invalidPath = writeJson("homarr-invalid.json", { ...selection, password: sentinel });
  const invalid = deterministic(() => runBun(cli, [invalidPath]));
  assertExit(invalid, 1);
  assertNoSecret(invalid);
  const audit = deterministic(() => runBun(".agents/skills/selfhost-homarr/scripts/check-audit.ts"));
  assertExit(audit, 0);
}

async function host() {
  const cli = ".agents/skills/selfhost-host/scripts/inspect-host.sh";
  const normalize = (result) => {
    const value = parseJson(result);
    delete value.observedAt;
    for (const path of value.storage.paths) {
      delete path.availableBytes;
      delete path.availableInodes;
    }
    return { exitCode: result.exitCode, value, stderr: result.stderr };
  };
  const passing = deterministic(() => bash(cli, ["--skip-docker", "--limit", "1"]), normalize);
  assertExit(passing, 0);
  const output = parseJson(passing);
  assert.equal(output.safety.secretBearingFilesRead, false);
  assert.equal(output.safety.hostMutationPerformed, false);
  const invalid = deterministic(() => bash(cli, ["--limit", "0"]));
  assertExit(invalid, 2);
  assert.match(invalid.stderr, /integer from 1 through 50/);
}

async function ingress() {
  const cli = ".agents/skills/selfhost-ingress/scripts/plan-ingress.ts";
  const input = ingressInput();
  const passing = deterministic(() => runBun(cli, ["--json", JSON.stringify(input)]));
  assertExit(passing, 0);
  assert.equal(parseJson(passing).route.nativeMcp.publicAccess, "deny");
  const conflictInput = structuredClone(input);
  conflictInput.preferences.nativeMcp.publicAccess = "allow";
  const conflict = deterministic(() => runBun(cli, ["--json", JSON.stringify(conflictInput)]));
  assertExit(conflict, 0);
  assert.equal(parseJson(conflict).status, "conflict");
  secretRejection(cli, (path) => ["--input", path], input);
}

async function media() {
  const cli = ".agents/skills/selfhost-media/scripts/verify-bundle.ts";
  const passing = deterministic(() => runBun(cli));
  assertExit(passing, 0);
  assert.match(passing.stdout, /^PASS bundle:/);
  const missing = deterministic(() => runBun(cli, ["--bundle", join(temporaryRoot, "missing-bundle")]));
  assertExit(missing, 1);
  assert.match(missing.stderr, /^error:/);
}

async function observe() {
  const cli = ".agents/skills/selfhost-observe/scripts/plan-observability.ts";
  const input = observeInput();
  const passing = deterministic(() => runBun(cli, ["--json", JSON.stringify(input)]));
  assertExit(passing, 0);
  const output = parseJson(passing);
  assert.equal(output.status, "pass");
  assert.equal(output.verification.state, "observed-passing");
  const conflictInput = structuredClone(input);
  conflictInput.collection.dockerSocket = { mode: "direct-readonly", approved: false, owner: "operations" };
  const conflict = deterministic(() => runBun(cli, ["--json", JSON.stringify(conflictInput)]));
  assertExit(conflict, 0);
  assert.equal(parseJson(conflict).conflicts.some((item) => item.id === "unapproved-direct-docker-socket"), true);
  secretRejection(cli, (path) => ["--input", path], input);
}

async function operations() {
  const cli = ".agents/skills/selfhost-operations/scripts/plan-operation.ts";
  const input = operationInput();
  const path = writeJson("operations-pass.json", input);
  const passing = deterministic(() => runBun(cli, ["plan", "--input", path]));
  assertExit(passing, 0);
  const output = parseJson(passing);
  assert.equal(output.status, "pass");
  assert.equal(output.execution.performed, false);
  const blockedInput = structuredClone(input);
  blockedInput.compatibilityEvidence = [];
  const blockedPath = writeJson("operations-blocked.json", blockedInput);
  const blocked = deterministic(() => runBun(cli, ["validate", "--input", blockedPath]));
  assertExit(blocked, 3);
  assert.equal(parseJson(blocked).status, "blocked");
  secretRejection(cli, (secretPath) => ["validate", "--input", secretPath], input);
}

async function research() {
  const composeResult = deterministic(() => runBun(".agents/skills/selfhost-research/scripts/extract-compose.ts", [], "services:\n  web:\n    image: docker.io/library/nginx:1.27.4\n"));
  assertExit(composeResult, 0);
  assert.equal(parseJson(composeResult).status, "pass");
  const noServices = deterministic(() => runBun(".agents/skills/selfhost-research/scripts/extract-compose.ts", [], "name: demo\n"));
  assertExit(noServices, 1);
  assert.equal(parseJson(noServices).status, "blocked");
  const lifecycle = { id: "demo", lifecycle: { status: "active", checkedAt: "2026-09-06", sourceUrl: "https://example.com/docs" } };
  const lifecycleResult = deterministic(() => runBun(".agents/skills/selfhost-research/scripts/validate-lifecycle.ts", [], JSON.stringify(lifecycle)));
  assertExit(lifecycleResult, 0);
  const link = {
    checkedAt: observedAt,
    sourceUrl: "https://example.com/docs",
    canonicalUrl: "https://example.com/docs",
    finalUrl: "https://example.com/docs",
    read: { success: true, statusCode: 200, finalUrl: "https://example.com/docs" },
    wait: { completed: true, kind: "network-idle" },
    evidence: { titleCaptured: true, title: "Documentation", contentMarkerCaptured: true, soft404Checked: true },
  };
  const linkResult = deterministic(() => runBun(".agents/skills/selfhost-research/scripts/validate-link-result.ts", [], JSON.stringify(link)));
  assertExit(linkResult, 0);
  assert.equal(parseJson(linkResult).status, "pass");
  const secretLink = structuredClone(link);
  secretLink.sourceUrl = `https://example.com/docs?token=${sentinel}`;
  const redacted = deterministic(() => runBun(".agents/skills/selfhost-research/scripts/validate-link-result.ts", [], JSON.stringify(secretLink)));
  assertNoSecret(redacted);
  const redactResult = deterministic(() => runBun(".agents/skills/selfhost-research/scripts/redact.ts", [], "ordinary public text\n"));
  assertExit(redactResult, 0);
}

async function verify() {
  const cli = ".agents/skills/selfhost-verify/scripts/verify-evidence.ts";
  const input = evidenceInput();
  const passing = deterministic(() => runBun(cli, ["--json", JSON.stringify(input)]));
  assertExit(passing, 0);
  assert.equal(parseJson(passing).status, "pass");
  const blockedInput = structuredClone(input);
  blockedInput.checks = blockedInput.checks.filter((check) => check.id !== "api-readiness");
  const blocked = deterministic(() => runBun(cli, ["--json", JSON.stringify(blockedInput)]));
  assertExit(blocked, 0);
  assert.deepEqual(parseJson(blocked).findings.missing, ["api-readiness"]);
  secretRejection(cli, (path) => ["--input", path], input);
}

async function vpn() {
  const cli = ".agents/skills/selfhost-vpn/scripts/plan-vpn.ts";
  const input = vpnInput();
  const passing = deterministic(() => runBun(cli, ["--json", JSON.stringify(input)]));
  assertExit(passing, 0);
  assert.equal(parseJson(passing).verification.safeClaimAllowed, true);
  const conflictInput = structuredClone(input);
  conflictInput.evidence.tunnelBreak.externalRequestFailed = false;
  const conflict = deterministic(() => runBun(cli, ["--json", JSON.stringify(conflictInput)]));
  assertExit(conflict, 0);
  assert.equal(parseJson(conflict).conflicts.some((item) => item.id === "egress-leak"), true);
  secretRejection(cli, (path) => ["--input", path], input);
}

const runners = new Map([
  ["selfhost", selfhost],
  ["selfhost-backup", backup],
  ["selfhost-compose", compose],
  ["selfhost-homarr", homarr],
  ["selfhost-host", host],
  ["selfhost-ingress", ingress],
  ["selfhost-media", media],
  ["selfhost-observe", observe],
  ["selfhost-operations", operations],
  ["selfhost-research", research],
  ["selfhost-verify", verify],
  ["selfhost-vpn", vpn],
]);

export async function runSkill(skill) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.contract.hostMutationAllowed, false);
  assert.equal(manifest.contract.dockerInvocationAllowed, false);
  assert.equal(manifest.skills.length, runners.size);
  assert.deepEqual(manifest.skills.map((record) => record.id), [...runners.keys()].sort());
  const runner = runners.get(skill);
  if (!runner) {
    throw new Error(`Unknown skill ${skill}`);
  }
  const record = manifest.skills.find((candidate) => candidate.id === skill);
  assert.equal(record.scenarios.length >= 2, true);
  assert.equal(typeof record.structuredInput, "boolean");
  const names = new Set();
  const coveredClasses = new Set();
  for (const scenario of record.scenarios) {
    assert.equal(typeof scenario.name, "string");
    assert.equal(scenario.name.length > 0, true);
    assert.equal(names.has(scenario.name), false);
    names.add(scenario.name);
    assert.equal(Array.isArray(scenario.classes), true);
    assert.equal(scenario.classes.length > 0, true);
    for (const scenarioClass of scenario.classes) {
      assert.equal(["happy", "rejection", "secret"].includes(scenarioClass), true);
      coveredClasses.add(scenarioClass);
    }
  }
  for (const requiredClass of manifest.contract.requiredClasses) {
    assert.equal(coveredClasses.has(requiredClass), true, `${skill} has no ${requiredClass} scenario`);
  }
  if (record.structuredInput && manifest.contract.structuredInputSecretCheck) {
    assert.equal(coveredClasses.has("secret"), true, `${skill} has no secret-handling scenario`);
  }
  await runner();
  return { skill, scenarios: record.scenarios.length };
}

export function cleanupBehaviorTests() {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

async function main() {
  const index = Bun.argv.indexOf("--skill");
  if (index < 0 || !Bun.argv[index + 1]) {
    throw new Error("Use --skill ID");
  }
  const result = await runSkill(Bun.argv[index + 1]);
  process.stdout.write(`PASS ${result.skill}: ${result.scenarios} deterministic scenarios\n`);
}

if (Bun.argv[1] && resolve(Bun.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } finally {
    cleanupBehaviorTests();
  }
}
