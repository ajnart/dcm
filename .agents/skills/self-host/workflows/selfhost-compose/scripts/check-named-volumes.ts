#!/usr/bin/env bun
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "compose-volume-fixture-"));
const projects = path.join(root, "projects");
const directory = path.join(projects, "fixture");
const source = path.join(import.meta.dir, "compose-project.ts");
const wrapper = path.join(import.meta.dir, "compose-lifecycle.sh");
const input = path.join(root, "manifest.json");
const bin = path.join(root, "bin");
const log = path.join(root, "docker-calls.jsonl");
fs.mkdirSync(projects, { mode: 0o700 });
fs.mkdirSync(bin);

const manifest = {
  schemaVersion: 1,
  project: { dockerContext: "fixture-context", id: "fixture", owner: "fixture", root: projects, directory, ownership: "new" },
  services: [{
    id: "database", image: "docker.io/library/postgres:18", restart: "unless-stopped", readOnly: false,
    user: "1000:1000", environment: [], ports: [],
    mounts: [{ kind: "volume", name: "fixture-database", target: "/var/lib/postgresql", readOnly: false, owner: "fixture", ownership: "new" }],
    networks: ["private"], secretRefs: []
  }, {
    id: "cron", image: "docker.io/library/postgres:18", restart: "unless-stopped", readOnly: false,
    user: "1000:1000", environment: [], ports: [],
    mounts: [{ kind: "volume", name: "fixture-database", target: "/var/lib/postgresql", readOnly: false, owner: "fixture", ownership: "new" }],
    networks: ["private"], secretRefs: []
  }],
  networks: [{ id: "private", name: "fixture-private", driver: "bridge", internal: true, owner: "fixture", ownership: "new" }],
  observed: { checkedAt: "2026-09-29T00:00:00Z", project: null, ports: [], paths: [], networks: [], volumes: [] }
};

function runProject(action: string) {
  fs.writeFileSync(input, JSON.stringify(manifest), { mode: 0o600 });
  return Bun.spawnSync([process.execPath, source, action, "--input", input, ...(action === "render" ? ["--output-dir", directory] : [])],
    { stdout: "pipe", stderr: "pipe" });
}

const fakeDocker = `#!${process.execPath}
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SELFHOST_FIXTURE_LOG, JSON.stringify(args) + "\\n");
if (args[2] === "info") { process.stdout.write("fixture daemon\\n"); process.exit(0); }
if (args[2] === "volume" && args[3] === "ls") {
  if (process.env.SELFHOST_VOLUME_STATE !== "missing") process.stdout.write("fixture-database\\n");
  process.exit(0);
}
if (args[2] === "volume" && args[3] === "inspect") {
  const mount = process.env.SELFHOST_VOLUME_STATE === "wrong" ? "other" : "database";
  process.stdout.write(["fixture-database", "local", "fixture", "fixture-database", "fixture", mount].join("\\t") + "\\n");
  process.exit(0);
}
process.exit(0);
`;
fs.writeFileSync(path.join(bin, "docker"), fakeDocker, { mode: 0o700 });

function lifecycle(action: string, target: string, volumeState: string, requireExisting = false) {
  fs.writeFileSync(log, "");
  const args = ["bash", wrapper, action, "--manifest", input, "--context", "fixture-context", "--project", "fixture", "--file", target];
  if (action === "apply") args.push("--approval", "APPLY:fixture");
  if (action === "stop") args.push("--approval", "STOP:fixture");
  if (requireExisting) args.push("--require-existing-volumes", "true");
  const result = Bun.spawnSync(args, { env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    SELFHOST_FIXTURE_LOG: log, SELFHOST_VOLUME_STATE: volumeState }, stdout: "pipe", stderr: "pipe" });
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { result, calls };
}

try {
  const planned = runProject("plan");
  assert.equal(planned.exitCode, 0, planned.stderr.toString());
  const plan = JSON.parse(planned.stdout.toString());
  assert.equal(plan.claims.volumes[0].name, "fixture-database");
  assert.equal(plan.claims.volumes.length, 2, "both services must retain their scoped mount claim");
  assert.deepEqual(plan.claims.paths, []);
  manifest.services[1].mounts[0].target = "/different";
  assert.notEqual(runProject("plan").exitCode, 0, "a shared volume cannot change its target");
  manifest.services[1].mounts[0].target = "/var/lib/postgresql";
  const rendered = runProject("render");
  assert.equal(rendered.exitCode, 0, rendered.stderr.toString());
  const target = JSON.parse(rendered.stdout.toString()).target;
  const yaml = fs.readFileSync(target, "utf8");
  assert.match(yaml, /type: volume/);
  assert.equal((yaml.match(/^  "fixture-database":$/gm) ?? []).length, 1, "one shared volume needs one declaration");
  assert.match(yaml, /"io\.selfhost\.volume": "database"/);
  assert.doesNotMatch(yaml, /type: bind/);

  const fresh = lifecycle("apply", target, "missing");
  assert.equal(fresh.result.exitCode, 0, fresh.result.stderr.toString());
  assert.equal(fresh.calls.filter((args) => args[2] === "volume" && args[3] === "ls").length, 1,
    "a shared volume needs one ownership preflight");
  assert.equal(fresh.calls.some((args) => args.includes("up")), true);
  const restart = lifecycle("apply", target, "owned", true);
  assert.equal(restart.result.exitCode, 0, restart.result.stderr.toString());
  const missingOnRestart = lifecycle("apply", target, "missing", true);
  assert.equal(missingOnRestart.result.exitCode, 2);
  assert.equal(missingOnRestart.calls.some((args) => args.includes("compose")), false);
  const stopped = lifecycle("stop", target, "owned");
  assert.equal(stopped.result.exitCode, 0, stopped.result.stderr.toString());
  assert.equal(stopped.calls.some((args) => args.includes("stop")), true);
  assert.equal(stopped.calls.some((args) => args.includes("down") || args.includes("rm")), false);
  const conflict = lifecycle("apply", target, "wrong");
  assert.equal(conflict.result.exitCode, 2);
  assert.equal(conflict.calls.some((args) => args.includes("compose")), false);

  manifest.observed.volumes = [{ name: "fixture-database", driver: "local", owner: "fixture", labels: {
    "com.docker.compose.project": "fixture", "com.docker.compose.volume": "fixture-database",
    "io.selfhost.project": "fixture", "io.selfhost.volume": "database" } }];
  assert.equal(runProject("plan").exitCode, 3, "new volume must conflict with observed name");
  manifest.project.ownership = "verified-existing";
  manifest.observed.project = { id: "fixture", directory, owner: "fixture" };
  manifest.networks[0].ownership = "verified-existing";
  manifest.observed.networks = [{ name: "fixture-private", owner: "fixture" }];
  manifest.services[0].mounts[0].ownership = "verified-existing";
  manifest.services[1].mounts[0].ownership = "verified-existing";
  assert.equal(runProject("plan").exitCode, 0, "exact owned volume can be resumed");
  manifest.observed.volumes[0].labels["io.selfhost.volume"] = null;
  assert.equal(runProject("plan").exitCode, 3, "missing ownership label must conflict");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("named volume checks passed\n");
