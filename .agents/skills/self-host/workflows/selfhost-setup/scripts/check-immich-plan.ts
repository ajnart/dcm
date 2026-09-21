#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildImmichManifest } from "./immich-plan";
import { validateWithComposeOwner } from "./household-plan";

const skillRoot = path.resolve(import.meta.dir, "..");
const input = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "immich-plan.example.json"), "utf8"));
const manifest = buildImmichManifest(input);

assert.deepEqual(manifest.services.map((service) => service.id), ["database", "immich-machine-learning", "immich-server", "redis"]);
const server = manifest.services.find((service) => service.id === "immich-server");
assert.deepEqual((server as any).dependsOn, [{ service: "database", condition: "service_started" }, { service: "redis", condition: "service_started" }]);
assert.equal(server?.ports[0].target, 2283);
assert.deepEqual(server?.networks, ["immich", "media"]);
assert.equal(server?.environment.some((entry) => entry.name === "DB_PASSWORD_FILE" && entry.value === "/run/secrets/db_password"), true);
assert.equal(server?.environment.find((entry) => entry.name === "IMMICH_ALLOW_SETUP")?.value, "true");
const database = manifest.services.find((service) => service.id === "database");
assert.equal(database?.mounts[0].target, "/var/lib/postgresql/data");
assert.equal(database?.healthcheck.test[1], "/usr/local/bin/healthcheck.sh");
assert.equal((database as any).shmSizeBytes, 134217728);
assert.equal(manifest.services.some((service) => service.id === "homarr"), false);
validateWithComposeOwner(manifest);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "immich-plan-check-"));
try {
  const source = path.join(temporary, "input.json");
  fs.writeFileSync(source, `${JSON.stringify(input)}\n`, { mode: 0o600 });
  const cli = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "immich-plan.ts"), "--input", source], { stdout: "pipe", stderr: "pipe" });
  assert.equal(cli.exitCode, 0, cli.stderr.toString());
  assert.deepEqual(JSON.parse(cli.stdout.toString()), manifest);

  const wrongImage = structuredClone(input);
  wrongImage.images.server = wrongImage.images.server.replace("v3.2.2", "v3");
  assert.throws(() => buildImmichManifest(wrongImage), /recorded v3.2.2/);

  const remoteDatabase = structuredClone(input);
  remoteDatabase.storage.database.localFilesystem = false;
  assert.throws(() => buildImmichManifest(remoteDatabase), /localFilesystem must be true/);

  const resumeInput = structuredClone(input);
  resumeInput.allowSetup = false;
  const resumeServer = buildImmichManifest(resumeInput).services.find((service) => service.id === "immich-server");
  assert.equal(resumeServer?.environment.find((entry) => entry.name === "IMMICH_ALLOW_SETUP")?.value, "false");
  validateWithComposeOwner(buildImmichManifest(resumeInput));

  const invalidSetupFlag = structuredClone(input);
  invalidSetupFlag.allowSetup = "false";
  assert.throws(() => buildImmichManifest(invalidSetupFlag), /allowSetup must be boolean/);

  const secretOutsideProject = structuredClone(input);
  secretOutsideProject.databaseSecret.filePath = "/srv/secrets/database-password";
  assert.throws(() => validateWithComposeOwner(buildImmichManifest(secretOutsideProject)), /selfhost-compose rejected/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("immich plan checks passed\n");
