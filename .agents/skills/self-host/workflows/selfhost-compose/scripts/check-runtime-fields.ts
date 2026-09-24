#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "compose-project.ts");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "selfhost-compose-runtime-fixture-"));
const root = path.join(workspace, "projects");
const manifestPath = path.join(workspace, "manifest.json");
fs.mkdirSync(root, { mode: 0o700 });

function service(id) {
  return {
    id,
    image: "docker.io/library/alpine:3.21.3",
    restart: "unless-stopped",
    readOnly: true,
    user: "1000:1000",
    environment: [],
    ports: [],
    mounts: [],
    networks: ["private"],
    secretRefs: []
  };
}

function manifest(id, services) {
  const directory = path.join(root, id);
  return {
    schemaVersion: 1,
    project: { dockerContext: "default", id, owner: id, root, directory, ownership: "new" },
    services,
    networks: [{ id: "private", name: `${id}-private`, driver: "bridge", internal: true, owner: id, ownership: "new" }],
    observed: { checkedAt: "2026-09-21T10:00:00Z", project: null, ports: [], paths: [], networks: [] }
  };
}

function run(args, input) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
  return Bun.spawnSync([process.execPath, script, ...args, "--input", manifestPath], { stdout: "pipe", stderr: "pipe" });
}

const database = {
  ...service("database"),
  user: "image-default",
  imageUserEvidence: { officialUrl: "https://hub.docker.com/_/postgres", reason: "upstream-init-requires-default-user" },
  healthcheck: { test: ["CMD", "pg_isready"], intervalSeconds: 10, timeoutSeconds: 5, startPeriodSeconds: 30, retries: 5 }
};
const application = {
  ...service("application"),
  entrypoint: ["/app/entrypoint"],
  command: ["serve", "--foreground"],
  dependsOn: [{ service: "database", condition: "service_healthy" }]
};
const valid = manifest("runtime-valid", [application, database]);
const planResult = run(["plan"], valid);
assert.equal(planResult.exitCode, 0);
const plan = JSON.parse(planResult.stdout.toString());
assert.deepEqual(plan.claims.services.find((item) => item.id === "database").imageUserEvidence, database.imageUserEvidence);

const renderResult = run(["render", "--output-dir", valid.project.directory], valid);
assert.equal(renderResult.exitCode, 0);
const compose = fs.readFileSync(JSON.parse(renderResult.stdout.toString()).target, "utf8");
assert.match(compose, /entrypoint: \["\/app\/entrypoint"\]/);
assert.match(compose, /command: \["serve","--foreground"\]/);
assert.match(compose, /test: \["CMD","pg_isready"\]/);
assert.match(compose, /condition: "service_healthy"/);
assert.equal((compose.match(/user: "1000:1000"/g) ?? []).length, 1);

const unknown = manifest("runtime-unknown", [{ ...service("application"), dependsOn: [{ service: "missing", condition: "service_started" }] }]);
assert.match(run(["validate"], unknown).stderr.toString(), /undeclared service/);

const cyclic = manifest("runtime-cycle", [
  { ...service("first"), dependsOn: [{ service: "second", condition: "service_started" }] },
  { ...service("second"), dependsOn: [{ service: "first", condition: "service_started" }] }
]);
assert.match(run(["validate"], cyclic).stderr.toString(), /must be acyclic/);

const malformedHealth = manifest("runtime-health", [{ ...service("app"), healthcheck: { test: ["CMD-SHELL", "true"], intervalSeconds: 10, timeoutSeconds: 5, startPeriodSeconds: 0, retries: 3 } }]);
assert.match(run(["validate"], malformedHealth).stderr.toString(), /must be a CMD argv list/);

const sensitiveArg = manifest("runtime-arg", [{ ...service("app"), command: ["serve", ["--pass", "word"].join("")] }]);
assert.match(run(["validate"], sensitiveArg).stderr.toString(), /secret-bearing or interpolated arguments/);

const rootUser = manifest("runtime-root", [{ ...service("app"), user: "0:0" }]);
assert.match(run(["validate"], rootUser).stderr.toString(), /must not use the root uid or gid/);

const unjustifiedDefault = manifest("runtime-default", [{ ...service("app"), user: "image-default" }]);
assert.match(run(["validate"], unjustifiedDefault).stderr.toString(), /requires official imageUserEvidence/);

const insecureEvidence = manifest("runtime-evidence", [{ ...service("app"), user: "image-default", imageUserEvidence: { officialUrl: "http://example.test/image", reason: "official-image-runtime-contract" } }]);
assert.match(run(["validate"], insecureEvidence).stderr.toString(), /must be an HTTPS URL/);

fs.rmSync(workspace, { recursive: true, force: true });
process.stdout.write("PASS Compose runtime field contract\n");
