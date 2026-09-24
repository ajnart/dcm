#!/usr/bin/env bun

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHouseholdCredentials } from "./household-credentials.ts";
import { exportFullHandoff } from "./full-handoff.ts";

const allHousehold = ["audiobookshelf", "immich", "navidrome", "nextcloud", "vaultwarden"];
const mediaIds = ["homarr", "jellyfin", "prowlarr", "qbittorrent", "radarr", "seerr", "sonarr"];
const stackScript = join(import.meta.dir, "stack.ts");
const randomValue = () => randomBytes(32).toString("base64url");
function privateDirectory(path: string) { mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); }
function privateFile(path: string, value: unknown) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); chmodSync(path, 0o600); }
function stackCommand(args: string[]) {
  const result = spawnSync(process.execPath, [stackScript, ...args, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function fixture(runId: string, includeMedia: boolean) {
  const projectRoot = mkdtempSync(join(tmpdir(), "full-handoff-"));
  stackCommand(["init", "--project-root", projectRoot, "--profile", "full", "--adapter", "selfhost-media", "--run-id", runId, "--consume", "ingress=homarr"]);
  const state = join(projectRoot, ".selfhost");
  createHouseholdCredentials({ projectRoot, runId, username: `owner_${randomBytes(4).toString("hex")}`, email: `${randomBytes(6).toString("hex")}@example.test`, services: allHousehold });
  stackCommand(["bind-household", "--project-root", projectRoot, "--run-id", runId]);
  const mediaRoot = join(state, "media-harness", ".sessions", runId);
  const artifacts = join(mediaRoot, "artifacts");
  if (includeMedia) {
    privateDirectory(artifacts);
    const password = randomValue();
    const services: Record<string, unknown> = {};
    for (const id of mediaIds) services[id] = {
      url: `http://localhost:${20000 + mediaIds.indexOf(id)}`,
      localUrl: `http://127.0.0.1:${20000 + mediaIds.indexOf(id)}`,
      userUrl: null,
      internalUrl: `http://${id}:80`,
      configPath: join(mediaRoot, "config", id),
      username: `media_${randomBytes(4).toString("hex")}`,
      password,
      apiKey: ["prowlarr", "radarr", "sonarr", "seerr"].includes(id) ? randomValue() : null,
    };
    privateFile(join(artifacts, "private-handoff.json"), {
      runId,
      warning: "private fixture",
      acceptance: "unverified fixture",
      actions: ["Synthetic fixture action"],
      locations: { sessionRoot: mediaRoot },
      access: { note: "fixture" },
      homarrNotebook: "not verified",
      mcp: { profile: "fixture" },
      services,
    });
  }
  return { projectRoot, mediaRoot };
}

const runId = "full-export-fixture";
const complete = fixture(runId, true);
const result = exportFullHandoff(complete.projectRoot, runId);
assert.equal(result.status, "partial");
assert.equal(lstatSync(result.privatePath).mode & 0o777, 0o600);
assert.equal(lstatSync(result.reportPath).mode & 0o777, 0o600);
assert.equal(lstatSync(join(complete.projectRoot, ".selfhost", "full", ".sessions", runId, "artifacts")).mode & 0o777, 0o700);
const privateOutput = readFileSync(result.privatePath, "utf8");
const report = readFileSync(result.reportPath, "utf8");
assert.match(report, /Setup is not finished\./);
assert.match(report, /does not mean the application accounts were created/);
assert.match(report, /private handoff file contains administrator credentials/);
const parsed = JSON.parse(privateOutput);
assert.equal(parsed.declaredStatus, "not-verified");
assert.equal(parsed.exportStatus, "partial");
assert.equal(parsed.media.runId, runId);
assert.equal(parsed.household.services.immich.urls.user, null);
assert.deepEqual(parsed.household.services.immich.storage.paths, []);
for (const service of Object.values(parsed.household.services) as Array<Record<string, unknown>>) {
  assert.equal(report.includes(String(service.password)), false);
  if (service.apiKey !== null) assert.equal(report.includes(String(service.apiKey)), false);
}
for (const service of Object.values(parsed.media.services) as Array<Record<string, unknown>>) {
  assert.equal(report.includes(String(service.password)), false);
  if (service.apiKey !== null) assert.equal(report.includes(String(service.apiKey)), false);
}
const cli = spawnSync(process.execPath, [join(import.meta.dir, "full-handoff.ts"), "--project-root", complete.projectRoot, "--run-id", runId], { encoding: "utf8" });
assert.equal(cli.status, 0);
assert.equal(cli.stderr, "");
assert.match(cli.stdout, /^Private full handoff: .*private-handoff\.json\nRedacted full handoff report: .*handoff-report\.md\n$/);
assert.equal(cli.stdout.includes(String(parsed.household.services.immich.password)), false);

const missingRun = "full-missing-media";
const missing = fixture(missingRun, false);
const partial = exportFullHandoff(missing.projectRoot, missingRun);
assert.equal(partial.status, "partial");
assert.equal(JSON.parse(readFileSync(partial.privatePath, "utf8")).media, null);
assert.match(readFileSync(partial.privatePath, "utf8"), /media-private-handoff/);

const mismatchRun = "full-mismatch";
const mismatch = fixture(mismatchRun, false);
assert.throws(() => exportFullHandoff(mismatch.projectRoot, "another-run"), /mismatched/);

const unsafeRun = "full-unsafe-media";
const unsafe = fixture(unsafeRun, true);
const mediaPath = join(unsafe.mediaRoot, "artifacts", "private-handoff.json");
const extraLink = join(unsafe.mediaRoot, "artifacts", "extra-link.json");
linkSync(mediaPath, extraLink);
assert.throws(() => exportFullHandoff(unsafe.projectRoot, unsafeRun), /unsafe/);
unlinkSync(extraLink);

process.stdout.write("PASS full private handoff export boundary\n");
