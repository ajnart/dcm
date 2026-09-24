#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildHouseholdManifest, validateWithComposeOwner } from "./household-plan";

const skillRoot = path.resolve(import.meta.dir, "..");
const examplePath = path.join(skillRoot, "references", "household-plan.example.json");
const input = JSON.parse(fs.readFileSync(examplePath, "utf8"));
const manifest = buildHouseholdManifest(input);

assert.deepEqual(manifest.services.map((service) => service.id), ["audiobookshelf", "navidrome", "vaultwarden"]);
assert.equal(manifest.services.find((service) => service.id === "navidrome")?.ports[0].target, 4533);
assert.equal(manifest.services.find((service) => service.id === "audiobookshelf")?.mounts.find((entry) => entry.target === "/config")?.readOnly, false);
assert.equal(manifest.services.find((service) => service.id === "vaultwarden")?.environment.find((entry) => entry.name === "SIGNUPS_ALLOWED")?.value, "false");
assert.ok(manifest.services.every((service) => service.networks.includes("media")));
assert.equal(manifest.services.some((service) => service.id === "homarr"), false);
validateWithComposeOwner(manifest);

const navidromeOnly = structuredClone(input);
navidromeOnly.apps = { navidrome: navidromeOnly.apps.navidrome };
const navidromeManifest = buildHouseholdManifest(navidromeOnly);
assert.deepEqual(navidromeManifest.services.map((service) => service.id), ["navidrome"]);
validateWithComposeOwner(navidromeManifest);

const unknownApp = structuredClone(navidromeOnly);
unknownApp.apps.unknown = unknownApp.apps.navidrome;
assert.throws(() => buildHouseholdManifest(unknownApp), /unsupported field/);
const emptyApps = structuredClone(input);
emptyApps.apps = {};
assert.throws(() => buildHouseholdManifest(emptyApps), /at least one/);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "household-plan-check-"));
try {
  const source = path.join(temporary, "input.json");
  fs.writeFileSync(source, `${JSON.stringify(input)}\n`);
  const cli = Bun.spawnSync([process.execPath, path.join(import.meta.dir, "household-plan.ts"), "--input", source], { stdout: "pipe", stderr: "pipe" });
  assert.equal(cli.exitCode, 0);
  assert.deepEqual(JSON.parse(cli.stdout.toString()), manifest);

  const missingDigest = structuredClone(input);
  missingDigest.apps.navidrome.image = "deluan/navidrome@sha256:";
  assert.throws(() => validateWithComposeOwner(buildHouseholdManifest(missingDigest)), /selfhost-compose rejected/);

  const taggedImage = structuredClone(input);
  taggedImage.apps.navidrome.image = "deluan/navidrome:0.58.0";
  assert.throws(() => buildHouseholdManifest(taggedImage), /immutable sha256 digest/);

  const nonLocalConfig = structuredClone(input);
  nonLocalConfig.apps.audiobookshelf.storage.config.localFilesystem = false;
  assert.throws(() => buildHouseholdManifest(nonLocalConfig), /localFilesystem must be true/);

  const wrongOwner = structuredClone(input);
  wrongOwner.observed.paths.find((entry: { path: string }) => entry.path === "/srv/media/music").owner = "someone-else";
  assert.throws(() => validateWithComposeOwner(buildHouseholdManifest(wrongOwner)), /selfhost-compose rejected/);

  const publicBootstrap = structuredClone(input);
  publicBootstrap.apps.vaultwarden.hostIp = "0.0.0.0";
  publicBootstrap.apps.vaultwarden.bootstrapRegistration = true;
  assert.throws(() => buildHouseholdManifest(publicBootstrap), /private host bind/);

  for (const domain of ["https://user@example.test", "https://example.test/vault", "https://example.test:99999"]) {
    const badDomain = structuredClone(input);
    badDomain.apps.vaultwarden.domain = domain;
    assert.throws(() => buildHouseholdManifest(badDomain), /approved HTTPS origin/);
  }

  const stringBootstrap = structuredClone(input);
  stringBootstrap.apps.vaultwarden.bootstrapRegistration = "false";
  assert.throws(() => buildHouseholdManifest(stringBootstrap), /must be boolean/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("household plan checks passed\n");
