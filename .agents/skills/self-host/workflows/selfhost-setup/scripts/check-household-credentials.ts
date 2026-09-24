#!/usr/bin/env bun

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOUSEHOLD_SERVICES,
  createHouseholdCredentials,
  householdCredentialStatus,
  loadHouseholdCredential,
  loadHouseholdHandoff,
  materializeHouseholdCredential,
} from "./household-credentials.ts";

const fixture = mkdtempSync(join(tmpdir(), "household-credentials-"));
const projectRoot = join(fixture, "project");
const stateDirectory = join(projectRoot, ".selfhost");
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
chmodSync(stateDirectory, 0o700);
writeFileSync(join(stateDirectory, ".gitignore"), "*\n", { mode: 0o600 });
const runId = "fixture-household";
const username = `user_${randomBytes(6).toString("hex")}`;
const email = `${randomBytes(8).toString("hex")}@example.test`;
const script = join(import.meta.dir, "household-credentials.ts");
const create = Bun.spawnSync([
  process.execPath, script, "create", "--project-root", projectRoot, "--run-id", runId,
  "--username", username, "--email", email,
  ...HOUSEHOLD_SERVICES.flatMap((service) => ["--service", service]),
], { stdout: "pipe", stderr: "pipe" });
assert.equal(create.exitCode, 0);
const createOutput = JSON.parse(create.stdout.toString());
assert.deepEqual(Object.keys(createOutput).sort(), ["path", "status"]);
assert.equal(createOutput.status, "created");
assert.equal(create.stderr.toString(), "");

const handoff = loadHouseholdHandoff(projectRoot, runId);
assert.equal(loadHouseholdCredential(projectRoot, runId, "immich").password, handoff.services.immich.password);
assert.equal(handoff.declaredStatus, "not-verified");
assert.deepEqual(Object.keys(handoff.services).sort(), HOUSEHOLD_SERVICES);
assert.equal(handoff.services.immich.email, email);
assert.equal(handoff.services.vaultwarden.email, email);
assert.equal(handoff.services.nextcloud.email, null);
assert.equal(handoff.services.immich.databasePassword === null, false);
assert.equal(handoff.services.nextcloud.databasePassword === null, false);
assert.equal(handoff.services.navidrome.databasePassword, null);
const generated = Object.values(handoff.services).flatMap((service) => [service.password, service.databasePassword].filter((value): value is string => value !== null));
assert.equal(new Set(generated).size, generated.length);
assert.equal(statSync(createOutput.path).mode & 0o777, 0o600);
assert.equal(statSync(join(stateDirectory, "household")).mode & 0o777, 0o700);

const status = householdCredentialStatus(projectRoot, runId);
assert.equal(status.status, "not-verified");
assert.deepEqual(status.services.map(({ id }) => id), HOUSEHOLD_SERVICES);
assert.equal(JSON.stringify(status).includes(username), false);
assert.equal(JSON.stringify(status).includes(email), false);
for (const secret of generated) assert.equal(JSON.stringify(status).includes(secret), false);

const composeProject = join(fixture, "compose-project");
mkdirSync(composeProject, { mode: 0o700 });
const materialized = materializeHouseholdCredential({ projectRoot, runId, service: "immich", field: "databasePassword", projectDirectory: composeProject });
assert.equal(materialized.status, "created");
assert.equal(materialized.path, join(composeProject, "secrets", "immich-database-password"));
assert.equal(statSync(materialized.path).mode & 0o777, 0o600);
assert.equal(materializeHouseholdCredential({ projectRoot, runId, service: "immich", field: "databasePassword", projectDirectory: composeProject }).status, "existing");
writeFileSync(materialized.path, randomBytes(32).toString("base64url"), { mode: 0o600 });
assert.throws(() => materializeHouseholdCredential({ projectRoot, runId, service: "immich", field: "databasePassword", projectDirectory: composeProject }), /does not match/);
assert.throws(() => materializeHouseholdCredential({ projectRoot, runId, service: "navidrome", field: "databasePassword", projectDirectory: composeProject }), /no managed database/);

const linked = join(createOutput.path, "..");
const hardLink = join(linked, "handoff-hardlink.json");
linkSync(createOutput.path, hardLink);
assert.throws(() => loadHouseholdHandoff(projectRoot, runId), /regular unlinked/);
unlinkSync(hardLink);

const repeat = Bun.spawnSync([
  process.execPath, script, "create", "--project-root", projectRoot, "--run-id", runId,
  "--username", username, "--email", email,
  ...HOUSEHOLD_SERVICES.flatMap((service) => ["--service", service]),
], { stdout: "pipe", stderr: "pipe" });
assert.equal(repeat.exitCode, 1);
assert.equal(repeat.stdout.toString(), "");
assert.equal(repeat.stderr.toString(), "FAIL household credential operation\n");
for (const secret of generated) assert.equal(repeat.stderr.toString().includes(secret), false);

const subsetRoot = join(fixture, "subset-project");
const subsetState = join(subsetRoot, ".selfhost");
mkdirSync(subsetState, { recursive: true, mode: 0o700 });
chmodSync(subsetState, 0o700);
writeFileSync(join(subsetState, ".gitignore"), "*\n", { mode: 0o600 });
const subsetRun = "fixture-subset";
const subset = Bun.spawnSync([
  process.execPath, script, "create", "--project-root", subsetRoot, "--run-id", subsetRun,
  "--username", username, "--service", "navidrome",
], { stdout: "pipe", stderr: "pipe" });
assert.equal(subset.exitCode, 0);
const subsetHandoff = loadHouseholdHandoff(subsetRoot, subsetRun);
assert.deepEqual(Object.keys(subsetHandoff.services), ["navidrome"]);
assert.equal(subsetHandoff.services.navidrome.email, null);
assert.deepEqual(householdCredentialStatus(subsetRoot, subsetRun).services, [{ id: "navidrome", provisioning: "pending" }]);
assert.throws(() => loadHouseholdCredential(subsetRoot, subsetRun, "immich"), /not selected/);
assert.throws(() => materializeHouseholdCredential({ projectRoot: subsetRoot, runId: subsetRun, service: "nextcloud", field: "password", projectDirectory: composeProject }), /not selected/);

const missingEmailRoot = join(fixture, "missing-email-project");
const missingEmailState = join(missingEmailRoot, ".selfhost");
mkdirSync(missingEmailState, { recursive: true, mode: 0o700 });
chmodSync(missingEmailState, 0o700);
writeFileSync(join(missingEmailState, ".gitignore"), "*\n", { mode: 0o600 });
assert.throws(() => createHouseholdCredentials({ projectRoot: missingEmailRoot, runId: "fixture-missing-email", username, services: ["immich"] }), /email/);
assert.equal(existsSync(join(missingEmailState, "household")), false);

process.stdout.write("PASS household credential boundary\n");
