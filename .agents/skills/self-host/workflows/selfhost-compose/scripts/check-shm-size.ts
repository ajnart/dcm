#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const composeProject = path.join(import.meta.dir, "compose-project.ts");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "compose-shm-"));

function manifest(shmSizeBytes?: unknown) {
  const selected: Record<string, unknown> = {
    id: "database",
    image: `docker.io/library/postgres:17@sha256:${"a".repeat(64)}`,
    restart: "unless-stopped",
    readOnly: false,
    user: "1000:1000",
    environment: [],
    ports: [],
    mounts: [],
    networks: ["private"],
    secretRefs: []
  };
  if (shmSizeBytes !== undefined) {
    selected.shmSizeBytes = shmSizeBytes;
  }
  return {
    schemaVersion: 1,
    project: { dockerContext: "default", id: "shm-check", owner: "shm-check", root: temporary, directory: path.join(temporary, "shm-check"), ownership: "new" },
    services: [selected],
    networks: [{ id: "private", name: "shm-check-private", driver: "bridge", internal: true, owner: "shm-check", ownership: "new" }],
    observed: { checkedAt: "2026-09-21T00:00:00Z", project: null, ports: [], paths: [], networks: [] }
  };
}

function run(action: "validate" | "plan" | "render", value: unknown) {
  const input = path.join(temporary, "manifest.json");
  fs.writeFileSync(input, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const args = [process.execPath, composeProject, action, "--input", input];
  if (action === "render") {
    args.push("--output-dir", path.join(temporary, "shm-check"));
  }
  return Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
}

try {
  assert.equal(run("validate", manifest()).exitCode, 0);
  assert.equal(run("validate", manifest(1024 * 1024)).exitCode, 0);
  assert.equal(run("validate", manifest(1024 * 1024 * 1024)).exitCode, 0);

  const plan = run("plan", manifest(128 * 1024 * 1024));
  assert.equal(plan.exitCode, 0, plan.stderr.toString());
  assert.equal(JSON.parse(plan.stdout.toString()).claims.services[0].shmSizeBytes, 134217728);

  const rendered = run("render", manifest(128 * 1024 * 1024));
  assert.equal(rendered.exitCode, 0, rendered.stderr.toString());
  const target = JSON.parse(rendered.stdout.toString()).target;
  assert.match(fs.readFileSync(target, "utf8"), /^    shm_size: 134217728$/m);

  for (const invalid of [1024 * 1024 - 1, 1024 * 1024 * 1024 + 1, "134217728", 1.5]) {
    assert.equal(run("validate", manifest(invalid)).exitCode, 2);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("shm size checks passed\n");
