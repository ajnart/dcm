#!/usr/bin/env bun

import assert from "node:assert/strict";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
  const skillContract = readFileSync(join(root, ".agents", "skills", "selfhost-media", "SKILL.md"), "utf8");
  assert.match(skillContract, /During initial setup, also forward `session\s+handoff RUN_ID`/);
  assert.match(skillContract, /During upkeep, do not run `handoff` unless the user explicitly asked/);
  const harnessContract = readFileSync(join(root, "PROMPT.md"), "utf8");
  assert.match(harnessContract, /For initial setup, also run\s+the explicit `handoff` command/);
  assert.match(harnessContract, /During upkeep, run `handoff` only when the user explicitly requested/);
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

async function setup() {
  const cli = ".agents/skills/selfhost-setup/scripts/stack.ts";
  const profiles = deterministic(() => runBun(cli, ["profiles", "--json"]));
  assertExit(profiles, 0);
  const profileDocument = parseJson(profiles);
  assert.deepEqual(profileDocument.profiles.map((profile) => profile.id), [
    "basic",
    "backup",
    "ingress",
    "media",
    "observe",
    "research",
    "vpn",
  ]);
  for (const profile of profileDocument.profiles) {
    const closure = runBun(cli, [
      "prerequisites",
      "--profile",
      profile.id,
      "--agent",
      "codex",
      "--scope",
      "project",
      "--project-root",
      root,
      "--json",
    ]);
    assertExit(closure, 0);
    const closureOutput = parseJson(closure);
    const expectedProfiles = ["basic"];
    if (profile.id !== "basic") {
      expectedProfiles.push(profile.id);
    }
    assert.deepEqual(closureOutput.resolvedProfiles, expectedProfiles);
  }

  const prerequisite = deterministic(() => runBun(cli, [
    "prerequisites",
    "--profile",
    "media",
    "--agent",
    "codex",
    "--scope",
    "project",
    "--project-root",
    root,
    "--json",
  ]));
  assertExit(prerequisite, 0);
  const prerequisiteOutput = parseJson(prerequisite);
  assert.deepEqual(prerequisiteOutput.resolvedProfiles, ["basic", "media"]);
  assert.equal(prerequisiteOutput.resolvedSkills.includes("selfhost-setup"), true);
  assert.equal(prerequisiteOutput.targetSkillsRoot, join(root, ".agents", "skills"));
  for (const install of prerequisiteOutput.installCommands) {
    assert.equal(/\bnode\b|\bmise\b/.test(install.command), false);
  }

  const isolatedProject = join(temporaryRoot, "isolated-prerequisites");
  mkdirSync(isolatedProject, { mode: 0o700 });
  const isolated = runBun(cli, [
    "prerequisites",
    "--profile",
    "media",
    "--agent",
    "codex",
    "--scope",
    "project",
    "--project-root",
    isolatedProject,
    "--json",
  ]);
  assertExit(isolated, 0);
  assert.deepEqual(parseJson(isolated).missingSkills, prerequisiteOutput.resolvedSkills);
  assert.equal(parseJson(isolated).targetSkillsRoot, join(isolatedProject, ".agents", "skills"));
  assertExit(runBun(cli, [
    "prerequisites", "--profile", "basic", "--agent", "codex", "--scope", "project", "--json",
  ]), 1);
  assertExit(runBun(cli, [
    "prerequisites", "--profile", "basic", "--agent", "codex", "--scope", "global",
    "--project-root", root, "--json",
  ]), 1);

  const prerequisiteProject = join(temporaryRoot, "installed-prerequisites");
  const installedRoot = join(prerequisiteProject, ".agents", "skills");
  mkdirSync(installedRoot, { mode: 0o700, recursive: true });
  cpSync(
    join(root, ".agents", "skills", "selfhost-setup"),
    join(installedRoot, "selfhost-setup"),
    { recursive: true },
  );
  const fakeBin = join(temporaryRoot, "installed-prerequisites", "bin");
  mkdirSync(fakeBin, { mode: 0o700 });
  const installedCli = join(installedRoot, "selfhost-setup", "scripts", "stack.ts");
  const missing = spawnSync(process.execPath, [
    installedCli,
    "prerequisites",
    "--profile",
    "media",
    "--agent",
    "codex",
    "--scope",
    "project",
    "--project-root",
    prerequisiteProject,
    "--json",
  ], {
    cwd: prerequisiteProject,
    encoding: "utf8",
    env: { PATH: fakeBin, LANG: "C", LC_ALL: "C" },
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(missing.status, 0, `${missing.stdout}${missing.stderr}`);
  const missingOutput = JSON.parse(missing.stdout);
  assert.equal(missingOutput.ready, false);
  assert.equal(missingOutput.targetSkillsRoot, installedRoot);
  assert.deepEqual(missingOutput.installCommands.map((item) => item.reason), [
    "selected-profile-skills",
    "agent-browser-skill",
    "agent-browser-runtime",
    "agent-browser-browser",
  ]);
  assert.equal(missingOutput.installCommands[0].command.startsWith("bunx --bun skills@latest add ajnart/selfhost-skills"), true);
  assert.equal(missingOutput.installCommands[1].command.startsWith("bunx --bun skills@latest add vercel-labs/agent-browser"), true);
  assert.equal(missingOutput.installCommands[2].command, "bun add --global agent-browser");
  assert.equal(missingOutput.installCommands[3].command, "agent-browser install");
  assert.equal(missingOutput.installCommands[0].workingDirectory, prerequisiteProject);
  assert.equal(missingOutput.installCommands[1].workingDirectory, prerequisiteProject);
  assert.equal(missingOutput.installCommands[2].workingDirectory, null);

  for (const skill of prerequisiteOutput.resolvedSkills) {
    const skillRoot = join(installedRoot, skill);
    mkdirSync(skillRoot, { mode: 0o700, recursive: true });
    if (skill !== "selfhost-setup") {
      writeFileSync(join(skillRoot, "SKILL.md"), `---\nname: ${skill}\ndescription: fixture\n---\n`, { mode: 0o600 });
    }
  }
  const browserSkillRoot = join(installedRoot, "agent-browser");
  mkdirSync(browserSkillRoot, { mode: 0o700 });
  writeFileSync(join(browserSkillRoot, "SKILL.md"), "---\nname: agent-browser\ndescription: fixture\n---\n", { mode: 0o600 });
  const fakeBrowser = join(fakeBin, "agent-browser");
  const browserInvocationLog = join(temporaryRoot, "browser-invocations.log");
  writeFileSync(
    fakeBrowser,
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$AGENT_BROWSER_TEST_LOG\"\nexit 0\n",
    { mode: 0o700 },
  );
  chmodSync(fakeBrowser, 0o700);
  const browserEnvironment = {
    PATH: `${fakeBin}:${process.env.PATH || ""}`,
    LANG: "C",
    LC_ALL: "C",
    AGENT_BROWSER_TEST_LOG: browserInvocationLog,
  };
  const unchecked = spawnSync(process.execPath, [
    installedCli,
    "prerequisites",
    "--profile",
    "media",
    "--agent",
    "codex",
    "--scope",
    "project",
    "--project-root",
    prerequisiteProject,
    "--json",
  ], {
    cwd: prerequisiteProject,
    encoding: "utf8",
    env: browserEnvironment,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(unchecked.status, 0, `${unchecked.stdout}${unchecked.stderr}`);
  assert.equal(JSON.parse(unchecked.stdout).browser.browserVerified, false);
  assert.deepEqual(JSON.parse(unchecked.stdout).installCommands.map((item) => item.reason), [
    "agent-browser-browser",
  ]);
  assert.equal(existsSync(browserInvocationLog), false, "default prerequisites invoked agent-browser");
  const ready = spawnSync(process.execPath, [
    installedCli,
    "prerequisites",
    "--profile",
    "media",
    "--agent",
    "codex",
    "--scope",
    "project",
    "--project-root",
    prerequisiteProject,
    "--verify-browser",
    "--json",
  ], {
    cwd: prerequisiteProject,
    encoding: "utf8",
    env: browserEnvironment,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(ready.status, 0, `${ready.stdout}${ready.stderr}`);
  assert.equal(JSON.parse(ready.stdout).ready, true);
  assert.equal(JSON.parse(ready.stdout).browser.browserVerified, true);
  assert.deepEqual(JSON.parse(ready.stdout).installCommands, []);
  assert.equal(readFileSync(browserInvocationLog, "utf8"), "doctor --offline --quick --json\n");

  const project = join(temporaryRoot, "setup-project");
  mkdirSync(project, { mode: 0o700 });
  const initialized = runBun(cli, [
    "init",
    "--project-root",
    project,
    "--profile",
    "media",
    "--adapter",
    "selfhost-media",
    "--run-id",
    "media_demo",
    "--json",
  ]);
  assertExit(initialized, 0);
  const initializedOutput = parseJson(initialized);
  assert.equal(initializedOutput.metadata.checkpoint.stage, "selected");
  assert.equal(initializedOutput.metadata.connections.initialPasswordStored, false);
  assert.deepEqual(initializedOutput.metadata.connections.contains, ["api-keys", "urls", "usernames"]);
  assert.equal(initializedOutput.metadata.services.length, 7);
  assert.deepEqual(initializedOutput.metadata.serviceBindings, []);
  assert.equal(statSync(join(project, ".selfhost")).mode & 0o777, 0o700);
  assert.equal(statSync(join(project, ".selfhost", "stack.json")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(project, ".selfhost", ".gitignore"), "utf8"), "*\n");

  const beforeShow = readFileSync(join(project, ".selfhost", "stack.json"), "utf8");
  const shown = runBun(cli, ["show", "--project-root", project, "--json"]);
  assertExit(shown, 0);
  assert.equal(readFileSync(join(project, ".selfhost", "stack.json"), "utf8"), beforeShow);

  const stateDirectory = join(project, ".selfhost");
  chmodSync(stateDirectory, 0o750);
  assertExit(runBun(cli, ["show", "--project-root", project, "--json"]), 1);
  chmodSync(stateDirectory, 0o700);

  const stackPath = join(stateDirectory, "stack.json");
  const inconsistent = JSON.parse(beforeShow);
  inconsistent.skills = inconsistent.skills.filter((skill) => skill !== "selfhost-verify");
  writeFileSync(stackPath, `${JSON.stringify(inconsistent, null, 2)}\n`, { mode: 0o600 });
  assertExit(runBun(cli, ["show", "--project-root", project, "--json"]), 1);
  writeFileSync(stackPath, beforeShow, { mode: 0o600 });

  const wrongAdapter = JSON.parse(beforeShow);
  wrongAdapter.runtime.adapter = "selfhost-upkeep";
  writeFileSync(stackPath, `${JSON.stringify(wrongAdapter, null, 2)}\n`, { mode: 0o600 });
  assertExit(runBun(cli, ["show", "--project-root", project, "--json"]), 1);
  writeFileSync(stackPath, beforeShow, { mode: 0o600 });

  assertExit(runBun(cli, ["checkpoint", "--project-root", project, "--stage", "planned", "--json"]), 1);
  const lockPath = join(stateDirectory, ".stack.lock");
  writeFileSync(lockPath, `${JSON.stringify({
    schemaVersion: 1,
    pid: 99_999_999,
    createdAt: new Date().toISOString(),
    nonce: "0123456789abcdef",
  })}\n`, { mode: 0o600 });
  const recoveryLockPath = join(stateDirectory, ".stack.recovery.lock");
  writeFileSync(recoveryLockPath, `${JSON.stringify({
    schemaVersion: 1,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    nonce: "abcdef0123456789",
  })}\n`, { mode: 0o600 });
  const guardedRecovery = [
    "checkpoint",
    "--project-root",
    project,
    "--stage",
    "planned",
    "--evidence",
    "plan:media",
    "--evidence",
    "approval:compose-project",
    "--evidence",
    "approval:media-project",
    "--evidence",
    "approval:owned-content",
    "--json",
  ];
  assertExit(runBun(cli, guardedRecovery), 1);
  assert.equal(existsSync(lockPath), true);
  assert.equal(existsSync(recoveryLockPath), true);
  unlinkSync(recoveryLockPath);
  assertExit(runBun(cli, [
    ...guardedRecovery,
  ]), 0);
  assert.equal(existsSync(lockPath), false);
  assertExit(runBun(cli, ["checkpoint", "--project-root", project, "--stage", "planned", "--evidence", "plan:media", "--json"]), 1);
  assertExit(runBun(cli, ["checkpoint", "--project-root", project, "--stage", "planned", "--evidence", "plan:media-refresh", "--json"]), 0);
  const missingApply = runBun(cli, ["checkpoint", "--project-root", project, "--stage", "applied", "--json"]);
  assertExit(missingApply, 1);
  const secretLike = runBun(cli, ["checkpoint", "--project-root", project, "--stage", "applied", "--evidence", "apply:password", "--json"]);
  assertExit(secretLike, 1);
  assert.equal(secretLike.stderr.includes("password"), false);
  assertExit(runBun(cli, ["checkpoint", "--project-root", project, "--stage", "applied", "--evidence", "apply:media", "--json"]), 0);
  const incompleteVerification = runBun(cli, ["checkpoint", "--project-root", project, "--stage", "verified", "--evidence", "verify:media", "--json"]);
  assertExit(incompleteVerification, 1);
  const verificationEvidence = [
    "verify:stack",
    "verify:media-browser",
    "verify:media-homarr",
    "verify:media-jellyfin",
    "verify:media-prowlarr",
    "verify:media-qbittorrent",
    "verify:media-radarr",
    "verify:media-relationships",
    "verify:media-seerr",
    "verify:media-sonarr",
  ];
  const verifiedArguments = ["checkpoint", "--project-root", project, "--stage", "verified"];
  for (const evidence of verificationEvidence) {
    verifiedArguments.push("--evidence", evidence);
  }
  verifiedArguments.push("--json");
  const verified = runBun(cli, verifiedArguments);
  assertExit(verified, 0);
  assert.equal(parseJson(verified).metadata.checkpoint.stage, "verified");

  const activeLock = {
    schemaVersion: 1,
    pid: process.pid,
    createdAt: new Date(Date.now() - 600_000).toISOString(),
    nonce: "fedcba9876543210",
  };
  writeFileSync(lockPath, `${JSON.stringify(activeLock)}\n`, { mode: 0o600 });
  assertExit(runBun(cli, ["checkpoint", "--project-root", project, "--stage", "verified", "--evidence", "verify:media-refresh", "--json"]), 1);
  assert.equal(existsSync(lockPath), true);
  rmSync(lockPath);
}

async function upkeep() {
  const cli = ".agents/skills/selfhost-setup/scripts/stack.ts";
  const project = join(temporaryRoot, "upkeep-project");
  mkdirSync(project, { mode: 0o700 });
  const initialized = runBun(cli, [
    "init",
    "--project-root",
    project,
    "--profile",
    "media",
    "--adapter",
    "selfhost-media",
    "--run-id",
    "upkeep_demo",
    "--json",
  ]);
  assertExit(initialized, 0);
  const before = parseJson(initialized).metadata;
  const missingBinding = runBun(cli, ["extend", "--project-root", project, "--profile", "backup", "--json"]);
  assertExit(missingBinding, 1);
  const extended = runBun(cli, [
    "extend",
    "--project-root",
    project,
    "--profile",
    "backup",
    "--consume",
    "backup=radarr",
    "--json",
  ]);
  assertExit(extended, 0);
  const after = parseJson(extended).metadata;
  assert.equal(after.profiles.includes("backup"), true);
  assert.deepEqual(after.runtime, before.runtime);
  assert.deepEqual(after.services, before.services);
  assert.deepEqual(after.serviceBindings, [{ profileId: "backup", serviceIds: ["radarr"] }]);
  assert.equal(after.checkpoint.stage, "selected");
  assert.equal(after.revision, before.revision + 1);
  const afterExtension = readFileSync(join(project, ".selfhost", "stack.json"), "utf8");
  const noOp = runBun(cli, ["extend", "--project-root", project, "--profile", "backup", "--json"]);
  assertExit(noOp, 1);
  assert.equal(readFileSync(join(project, ".selfhost", "stack.json"), "utf8"), afterExtension);
  const replacement = runBun(cli, [
    "extend",
    "--project-root",
    project,
    "--profile",
    "observe",
    "--adapter",
    "selfhost-media",
    "--run-id",
    "another_run",
    "--json",
  ]);
  assertExit(replacement, 1);
  const shown = runBun(cli, ["show", "--project-root", project, "--json"]);
  assertExit(shown, 0);
  assert.equal(parseJson(shown).metadata.runtime.runId, "upkeep_demo");
  const pendingResume = runBun(cli, ["resume", "--project-root", project, "--json"]);
  assertExit(pendingResume, 0);
  assert.equal(parseJson(pendingResume).adapterConnectionsValid, false);
  assert.equal(parseJson(pendingResume).adapterConnectionsStatus, "pending-before-apply");

  const mediaRuntime = ".agents/skills/selfhost-media/scripts/media-runtime.ts";
  assertExit(runBun(mediaRuntime, ["init", "--project", project]), 0);
  assertExit(runBun(mediaRuntime, [
    "exec",
    "--project",
    project,
    "--",
    "session",
    "create",
    "upkeep_demo",
  ]), 0);
  assertExit(runBun(mediaRuntime, [
    "exec",
    "--project",
    project,
    "--",
    "session",
    "connections",
    "upkeep_demo",
  ]), 0);
  assertExit(runBun(cli, [
    "checkpoint",
    "--project-root",
    project,
    "--stage",
    "planned",
    "--evidence",
    "plan:upkeep",
    "--json",
  ]), 0);
  assertExit(runBun(cli, [
    "checkpoint",
    "--project-root",
    project,
    "--stage",
    "applied",
    "--evidence",
    "apply:upkeep",
    "--evidence",
    "approval:backup-target",
    "--evidence",
    "approval:compose-project",
    "--evidence",
    "approval:media-project",
    "--evidence",
    "approval:owned-content",
    "--json",
  ]), 0);
  const resumed = runBun(cli, ["resume", "--project-root", project, "--json"]);
  assertExit(resumed, 0);
  assert.equal(parseJson(resumed).adapterConnectionsValid, true);
  assert.equal(parseJson(resumed).adapterConnectionsStatus, "valid");

  const connectionsPath = join(
    project,
    ".selfhost",
    "media-harness",
    ".sessions",
    "upkeep_demo",
    "connections.env",
  );
  unlinkSync(connectionsPath);
  assertExit(runBun(cli, ["resume", "--project-root", project, "--json"]), 1);
  assertExit(runBun(mediaRuntime, [
    "exec", "--project", project, "--", "session", "connections", "upkeep_demo",
  ]), 0);

  const savedConnectionsPath = `${connectionsPath}.saved`;
  renameSync(connectionsPath, savedConnectionsPath);
  symlinkSync(savedConnectionsPath, connectionsPath);
  assertExit(runBun(cli, ["resume", "--project-root", project, "--json"]), 1);
  unlinkSync(connectionsPath);
  renameSync(savedConnectionsPath, connectionsPath);

  appendFileSync(connectionsPath, "ADMIN_PASSWORD=forbidden\n");
  const tamperedConnections = runBun(cli, ["resume", "--project-root", project, "--json"]);
  assertExit(tamperedConnections, 1);
  assert.equal(`${tamperedConnections.stdout}${tamperedConnections.stderr}`.includes("forbidden"), false);
  unlinkSync(connectionsPath);
  assertExit(runBun(mediaRuntime, [
    "exec", "--project", project, "--", "session", "connections", "upkeep_demo",
  ]), 0);

  const serviceProject = join(temporaryRoot, "service-obligation-project");
  mkdirSync(serviceProject, { mode: 0o700 });
  const missingService = runBun(cli, [
    "init",
    "--project-root",
    serviceProject,
    "--profile",
    "backup",
    "--json",
  ]);
  assertExit(missingService, 1);
  const withService = runBun(cli, [
    "init",
    "--project-root",
    serviceProject,
    "--profile",
    "backup",
    "--service",
    "demo=selfhost-compose",
    "--json",
  ]);
  assertExit(withService, 1);
  const withBinding = runBun(cli, [
    "init",
    "--project-root",
    serviceProject,
    "--profile",
    "backup",
    "--service",
    "demo=selfhost-compose",
    "--consume",
    "backup=demo",
    "--json",
  ]);
  assertExit(withBinding, 0);
  assert.deepEqual(parseJson(withBinding).metadata.serviceBindings, [
    { profileId: "backup", serviceIds: ["demo"] },
  ]);

  const mediaExtensionProject = join(temporaryRoot, "media-extension-project");
  mkdirSync(mediaExtensionProject, { mode: 0o700 });
  assertExit(runBun(cli, [
    "init", "--project-root", mediaExtensionProject, "--profile", "basic", "--json",
  ]), 0);
  assertExit(runBun(cli, [
    "extend", "--project-root", mediaExtensionProject, "--profile", "media", "--json",
  ]), 1);
  const mediaExtension = runBun(cli, [
    "extend",
    "--project-root",
    mediaExtensionProject,
    "--profile",
    "media",
    "--adapter",
    "selfhost-media",
    "--run-id",
    "extended_media",
    "--json",
  ]);
  assertExit(mediaExtension, 0);
  assert.equal(parseJson(mediaExtension).metadata.runtime.runId, "extended_media");
  assert.equal(parseJson(mediaExtension).metadata.services.length, 7);
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
  ["selfhost-setup", setup],
  ["selfhost-upkeep", upkeep],
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
