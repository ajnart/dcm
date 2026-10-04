#!/usr/bin/env bun
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "compose-daemon-fixture-"));
const projectRoot = path.join(root, "projects");
fs.mkdirSync(projectRoot, { mode: 0o700 });
const projectDirectory = path.join(projectRoot, "fixture");
const manifest = {
  schemaVersion: 1,
  project: {
    dockerContext: "fixture-context",
    id: "fixture",
    owner: "fixture",
    root: projectRoot,
    directory: projectDirectory,
    ownership: "new",
  },
  services: [{
    id: "web",
    image: "docker.io/library/nginx:1.27.4",
    restart: "unless-stopped",
    readOnly: true,
    user: "1000:1000",
    environment: [],
    ports: [],
    mounts: [],
    networks: ["private"],
    secretRefs: [],
  }],
  networks: [{
    id: "private",
    name: "fixture-private",
    driver: "bridge",
    internal: true,
    owner: "fixture",
    ownership: "new",
  }],
  observed: {
    checkedAt: new Date().toISOString(),
    project: null,
    ports: [],
    paths: [],
    networks: [],
  },
};
manifest.services.push({ ...structuredClone(manifest.services[0]), id: "database", image: "docker.io/library/postgres:18" });
manifest.services[0].dependsOn = [{ service: "database", condition: "service_started" }];
const manifestPath = path.join(root, "manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });

const source = path.resolve(import.meta.dir, "compose-project.ts");
const wrapper = path.resolve(import.meta.dir, "compose-lifecycle.sh");
const render = Bun.spawnSync([
  process.execPath,
  source,
  "render",
  "--input",
  manifestPath,
  "--output-dir",
  projectDirectory,
], { stdout: "pipe", stderr: "pipe" });
assert.equal(render.exitCode, 0, render.stderr.toString());
const target = JSON.parse(render.stdout.toString()).target;

const bin = path.join(root, "bin");
fs.mkdirSync(bin);
const log = path.join(root, "docker-calls.jsonl");
const fakeDocker = `#!${process.execPath}
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SELFHOST_FIXTURE_LOG, JSON.stringify(args) + "\\n");
if (args[2] === "info") {
  if (args.includes("{{json .SecurityOptions}}")) {
    process.stdout.write(process.env.SELFHOST_SECURITY_OPTIONS + "\\n");
  } else {
    process.stdout.write("fixture daemon stdout\\n");
  }
  process.stderr.write("fixture daemon stderr\\n");
  process.exit(Number(process.env.SELFHOST_DAEMON_STATUS));
}
if (args.includes("config")) process.exit(Number(process.env.SELFHOST_CONFIG_STATUS));
process.exit(0);
`;
fs.writeFileSync(path.join(bin, "docker"), fakeDocker, { mode: 0o700 });

function run(action: string, daemonStatus = 0, configStatus = 0, approval?: string, services = "database") {
  fs.writeFileSync(log, "");
  const args = [
    "bash",
    wrapper,
    action,
    "--manifest",
    manifestPath,
    "--context",
    "fixture-context",
    "--project",
    "fixture",
    "--file",
    target,
  ];
  if (approval !== undefined) {
    args.push("--approval", approval);
  }
  if (action.startsWith("selected-")) args.push("--services", services);
  const result = Bun.spawnSync(args, {
    env: {
      ...process.env,
      PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
      SELFHOST_FIXTURE_LOG: log,
      SELFHOST_DAEMON_STATUS: String(daemonStatus),
      SELFHOST_CONFIG_STATUS: String(configStatus),
      SELFHOST_SECURITY_OPTIONS: '["name=seccomp"]',
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const calls = fs.readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { result, calls };
}

try {
  for (const action of ["preflight", "apply", "stop"]) {
    let approval: string | undefined;
    if (action === "apply") {
      approval = "APPLY:fixture";
    }
    if (action === "stop") {
      approval = "STOP:fixture";
    }
    const { result, calls } = run(action, 77, 0, approval);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr.toString(), /cannot reach Docker context fixture-context/);
    assert.doesNotMatch(result.stdout.toString(), /fixture daemon/);
    assert.doesNotMatch(result.stderr.toString(), /fixture daemon/);
    assert.deepEqual(calls, [["--context", "fixture-context", "info", "--format", "{{.ServerVersion}}"]]);
  }

  const preflight = run("preflight");
  assert.equal(preflight.result.exitCode, 0);
  assert.deepEqual(preflight.calls[1], [
    "--context", "fixture-context",
    "compose", "--project-name", "fixture",
    "--file", target,
    "config", "--quiet",
  ]);
  assert.doesNotMatch(preflight.result.stdout.toString(), /fixture daemon/);
  assert.doesNotMatch(preflight.result.stderr.toString(), /fixture daemon/);

  const applied = run("apply", 0, 0, "APPLY:fixture");
  assert.equal(applied.result.exitCode, 0);
  assert.equal(applied.calls.length, 3);
  assert.deepEqual(applied.calls[1], [
    "--context", "fixture-context",
    "compose", "--project-name", "fixture",
    "--file", target,
    "config", "--quiet",
  ]);
  assert.deepEqual(applied.calls[2], [
    "--context", "fixture-context",
    "compose", "--project-name", "fixture",
    "--file", target,
    "up", "--detach",
  ]);

  const badConfig = run("apply", 0, 12, "APPLY:fixture");
  assert.equal(badConfig.result.exitCode, 12);
  assert.equal(badConfig.calls.length, 2);

  const noApproval = run("apply");
  assert.equal(noApproval.result.exitCode, 2);
  assert.equal(noApproval.calls.length, 0);

  function selection(operation: string, services = "database") {
    return Bun.spawnSync([process.execPath, source, "selected-plan", "--input", manifestPath,
      "--services", services, "--operation", operation], { stdout: "pipe", stderr: "pipe" });
  }
  const startPlan = selection("start");
  assert.equal(startPlan.exitCode, 0, startPlan.stderr.toString());
  const startToken = JSON.parse(startPlan.stdout.toString()).approval;
  const selectedIdentity = JSON.parse(startPlan.stdout.toString());
  assert.match(selectedIdentity.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(selectedIdentity.planId, selectedIdentity.manifestSha256.slice(0, 16));
  const stopToken = JSON.parse(selection("stop").stdout.toString()).approval;
  assert.notEqual(startToken, stopToken, "operation must be approval-bound");
  assert.equal(JSON.parse(startPlan.stdout.toString()).dockerInvoked, false);
  const selectedStart = run("selected-start", 0, 0, startToken);
  assert.equal(selectedStart.result.exitCode, 0, selectedStart.result.stderr.toString());
  assert.deepEqual(selectedStart.calls[2], ["--context", "fixture-context", "compose", "--project-name", "fixture",
    "--file", target, "up", "--detach", "--no-deps", "database"]);
  assert.equal(selectedStart.calls[2].includes("web"), false, "dependent app cannot enter selected database startup");
  const selectedStop = run("selected-stop", 0, 0, stopToken);
  assert.equal(selectedStop.result.exitCode, 0);
  assert.deepEqual(selectedStop.calls[2], ["--context", "fixture-context", "compose", "--project-name", "fixture",
    "--file", target, "stop", "database"]);
  const widened = run("selected-start", 0, 0, startToken, "database,web");
  assert.notEqual(widened.result.exitCode, 0);
  assert.equal(widened.calls.length, 0, "approval cannot widen the selected service set");
  for (const token of ["APPLY:fixture", stopToken, startToken.replace(/.$/, "x")]) {
    const refused = run("selected-start", 0, 0, token);
    assert.notEqual(refused.result.exitCode, 0);
    assert.equal(refused.calls.length, 0, "invalid selection approval must fail before daemon calls");
  }
  for (const services of ["unknown", "web,web", "web,", "--all"]) {
    assert.notEqual(selection("start", services).exitCode, 0, "unknown/duplicate/unsafe selection must fail");
  }
  const changedManifest = structuredClone(manifest);
  changedManifest.services[0].image = "docker.io/library/nginx:1.27.5";
  fs.writeFileSync(manifestPath, JSON.stringify(changedManifest), { mode: 0o600 });
  assert.notEqual(JSON.parse(selection("start").stdout.toString()).approval, startToken, "manifest plan must be approval-bound");
  const changedRefusal = run("selected-start", 0, 0, startToken);
  assert.notEqual(changedRefusal.result.exitCode, 0);
  assert.equal(changedRefusal.calls.length, 0, "changed rendered plan must fail before Docker");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });

  const rootlessDirectory = path.join(projectRoot, "rootless-fixture");
  const rootlessManifest = structuredClone(manifest);
  rootlessManifest.project.dockerContext = "rootless";
  rootlessManifest.project.id = "rootless-fixture";
  rootlessManifest.project.owner = "rootless-fixture";
  rootlessManifest.project.directory = rootlessDirectory;
  rootlessManifest.services[0].user = "0:0";
  rootlessManifest.services[0].rootlessUserEvidence = {
    officialUrl: "https://docs.docker.com/engine/security/rootless/",
    reason: "host-user-mapped-container-root",
  };
  rootlessManifest.networks[0].name = "rootless-fixture-private";
  rootlessManifest.networks[0].owner = "rootless-fixture";
  const rootlessManifestPath = path.join(root, "rootless-manifest.json");
  fs.writeFileSync(rootlessManifestPath, JSON.stringify(rootlessManifest), { mode: 0o600 });
  const rootlessRender = Bun.spawnSync([
    process.execPath,
    source,
    "render",
    "--input",
    rootlessManifestPath,
    "--output-dir",
    rootlessDirectory,
  ], { stdout: "pipe", stderr: "pipe" });
  assert.equal(rootlessRender.exitCode, 0, rootlessRender.stderr.toString());
  const rootlessTarget = JSON.parse(rootlessRender.stdout.toString()).target;

  function runRootless(securityOptions: string) {
    fs.writeFileSync(log, "");
    const result = Bun.spawnSync([
      "bash",
      wrapper,
      "preflight",
      "--manifest",
      rootlessManifestPath,
      "--context",
      "rootless",
      "--project",
      "rootless-fixture",
      "--file",
      rootlessTarget,
    ], {
      env: {
        ...process.env,
        PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
        SELFHOST_FIXTURE_LOG: log,
        SELFHOST_DAEMON_STATUS: "0",
        SELFHOST_CONFIG_STATUS: "0",
        SELFHOST_SECURITY_OPTIONS: securityOptions,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const calls = fs.readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { result, calls };
  }

  const wrongDaemonMode = runRootless('["name=seccomp"]');
  assert.equal(wrongDaemonMode.result.exitCode, 2);
  assert.match(wrongDaemonMode.result.stderr.toString(), /does not report rootless security mode/);
  assert.equal(wrongDaemonMode.calls.length, 1);

  const rootlessDaemon = runRootless('["name=seccomp","name=rootless"]');
  assert.equal(rootlessDaemon.result.exitCode, 0, rootlessDaemon.result.stderr.toString());
  assert.deepEqual(rootlessDaemon.calls[0], [
    "--context", "rootless", "info", "--format", "{{json .SecurityOptions}}",
  ]);
  assert.equal(rootlessDaemon.calls.length, 2);

  process.stdout.write("PASS Compose daemon preflight and mutation ordering\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
