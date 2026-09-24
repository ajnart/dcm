#!/usr/bin/env bun

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.join(import.meta.dir, "compose-project.ts");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "selfhost-compose-secret-fixture-"));
const root = path.join(workspace, "projects");
const projectDirectory = path.join(root, "fixture");
const manifestPath = path.join(workspace, "manifest.json");
fs.mkdirSync(root, { mode: 0o700 });

function manifest(secretRef, environment = []) {
  return {
    schemaVersion: 1,
    project: { dockerContext: "default", id: "fixture", owner: "fixture", root, directory: projectDirectory, ownership: "new" },
    services: [{
      id: "app",
      image: "docker.io/library/alpine:3.21.3",
      restart: "unless-stopped",
      readOnly: true,
      user: "1000:1000",
      environment,
      ports: [],
      mounts: [],
      networks: ["private"],
      secretRefs: [secretRef]
    }],
    networks: [{ id: "private", name: "fixture-private", driver: "bridge", internal: true, owner: "fixture", ownership: "new" }],
    observed: { checkedAt: "2026-09-21T10:00:00Z", project: null, ports: [], paths: [], networks: [] }
  };
}

function run(args, input) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
  return Bun.spawnSync([process.execPath, script, ...args, "--input", manifestPath], { stdout: "pipe", stderr: "pipe" });
}

const localPath = path.join(projectDirectory, "secrets", "database-password");
const localRef = { name: "database-password", ref: "local/fixture/database-password", target: "database_password", filePath: localPath };
const localManifest = manifest(localRef, [{ name: "POSTGRES_PASSWORD_FILE", value: "/run/secrets/database_password" }]);
const validation = run(["validate"], localManifest);
assert.equal(validation.exitCode, 0);

const rendered = run(["render", "--output-dir", projectDirectory], localManifest);
assert.equal(rendered.exitCode, 0);
const renderResult = JSON.parse(rendered.stdout.toString());
const compose = fs.readFileSync(renderResult.target, "utf8");
assert.match(compose, new RegExp(`file: ${JSON.stringify(localPath)}`));
assert.doesNotMatch(compose, /external: true/);
assert.match(compose, /POSTGRES_PASSWORD_FILE/);

fs.mkdirSync(path.dirname(localPath), { mode: 0o700 });
fs.writeFileSync(localPath, crypto.randomBytes(32), { mode: 0o600 });
const lifecycleArgs = ["lifecycle-check", "--context", "default", "--project", "fixture", "--file", renderResult.target];
assert.equal(run(lifecycleArgs, localManifest).exitCode, 0);

fs.chmodSync(localPath, 0o640);
const looseMode = run(lifecycleArgs, localManifest);
assert.equal(looseMode.exitCode, 2);
assert.match(looseMode.stderr.toString(), /mode 0600/);
fs.chmodSync(localPath, 0o600);

const hardLink = path.join(path.dirname(localPath), "linked-secret");
fs.linkSync(localPath, hardLink);
const linked = run(lifecycleArgs, localManifest);
assert.equal(linked.exitCode, 2);
assert.match(linked.stderr.toString(), /must not have hard links/);
fs.unlinkSync(hardLink);

const backingFile = path.join(path.dirname(localPath), "symlink-backing");
fs.renameSync(localPath, backingFile);
fs.symlinkSync(backingFile, localPath);
const symlinked = run(lifecycleArgs, localManifest);
assert.equal(symlinked.exitCode, 2);
assert.match(symlinked.stderr.toString(), /without symlink traversal/);
fs.unlinkSync(localPath);
fs.renameSync(backingFile, localPath);

const badFileVariable = manifest(localRef, [{ name: "POSTGRES_PASSWORD_FILE", value: "/tmp/database_password" }]);
assert.equal(run(["validate"], badFileVariable).exitCode, 2);

const outsideRef = { ...localRef, filePath: path.join(workspace, "outside") };
assert.equal(run(["validate"], manifest(outsideRef)).exitCode, 2);

const unknownRef = { ...localRef, extra: "unsupported" };
assert.equal(run(["validate"], manifest(unknownRef)).exitCode, 2);

const externalRoot = path.join(workspace, "external-projects");
fs.mkdirSync(externalRoot, { mode: 0o700 });
const externalDirectory = path.join(externalRoot, "fixture");
const externalManifest = manifest({ name: "database-password", ref: "vault/fixture/database-password", target: "database_password" });
externalManifest.project.root = externalRoot;
externalManifest.project.directory = externalDirectory;
assert.equal(run(["validate"], externalManifest).exitCode, 0);
const externalPlan = run(["plan"], externalManifest);
assert.equal(externalPlan.exitCode, 0);
assert.deepEqual(JSON.parse(externalPlan.stdout.toString()).claims.secretRefs, [{ service: "app", name: "database-password", ref: "vault/fixture/database-password", target: "database_password" }]);
const externalRender = run(["render", "--output-dir", externalDirectory], externalManifest);
assert.equal(externalRender.exitCode, 0);
const externalResult = JSON.parse(externalRender.stdout.toString());
const externalCompose = fs.readFileSync(externalResult.target, "utf8");
assert.match(externalCompose, /external: true/);
const externalLifecycle = run(["lifecycle-check", "--context", "default", "--project", "fixture", "--file", externalResult.target], externalManifest);
assert.equal(externalLifecycle.exitCode, 2);
assert.match(externalLifecycle.stderr.toString(), /planning-only in the local Compose lifecycle/);

fs.rmSync(workspace, { recursive: true, force: true });
process.stdout.write("PASS local Compose secret file contract\n");
