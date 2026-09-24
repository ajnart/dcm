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
  process.stdout.write("fixture daemon stdout\\n");
  process.stderr.write("fixture daemon stderr\\n");
  process.exit(Number(process.env.SELFHOST_DAEMON_STATUS));
}
if (args.includes("config")) process.exit(Number(process.env.SELFHOST_CONFIG_STATUS));
process.exit(0);
`;
fs.writeFileSync(path.join(bin, "docker"), fakeDocker, { mode: 0o700 });

function run(action: string, daemonStatus = 0, configStatus = 0, approval?: string) {
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
  const result = Bun.spawnSync(args, {
    env: {
      ...process.env,
      PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
      SELFHOST_FIXTURE_LOG: log,
      SELFHOST_DAEMON_STATUS: String(daemonStatus),
      SELFHOST_CONFIG_STATUS: String(configStatus),
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

  process.stdout.write("PASS Compose daemon preflight and mutation ordering\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
