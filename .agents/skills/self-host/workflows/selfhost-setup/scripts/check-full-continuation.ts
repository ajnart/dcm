#!/usr/bin/env bun

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const stackScript = resolve(import.meta.dir, "stack.ts");

async function run(args: string[], expected = 0) {
  const child = Bun.spawn([process.execPath, stackScript, ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(exitCode, expected, stderr);
  if (expected !== 0) {
    return { stderr };
  }
  return JSON.parse(stdout);
}

function flags(values: string[]) {
  return values.flatMap((value) => ["--evidence", value]);
}

const householdIds = ["audiobookshelf", "immich", "navidrome", "nextcloud", "vaultwarden"];
const mediaIds = ["homarr", "jellyfin", "prowlarr", "qbittorrent", "radarr", "seerr", "sonarr"];
const root = await mkdtemp(join(tmpdir(), "selfhost-full-continuation-"));
await chmod(root, 0o700);

function acceptanceReport(service: string, runId: string, wrongService = false) {
  const appChecks = service === "vaultwarden"
    ? ["homarr-shortcut", "recovery", "registration-closed"]
    : ["homarr-integration", "homarr-widget"];
  return {
    schemaVersion: 1,
    kind: "household-acceptance",
    service: wrongService ? "immich" : service,
    runId,
    checkedAt: new Date().toISOString(),
    observer: "synthetic-fixture",
    checks: [...["account-login", "private-access", "storage"], ...appChecks]
      .sort()
      .map((id) => ({ id, status: "pass", evidenceRefs: [`observation:${service}-${id}`] })),
  };
}

const basicRoot = join(root, "basic");
await Bun.write(join(root, ".keep"), "");
await import("node:fs/promises").then(({ mkdir }) => mkdir(basicRoot, { mode: 0o700 }));
const basic = await run(["init", "--project-root", basicRoot, "--profile", "basic"]);
assert.deepEqual(basic.metadata.profiles, ["basic"]);
assert.deepEqual(basic.metadata.services, []);
assert.equal(basic.metadata.checkpoint.stage, "selected");
const extendedBasic = await run([
  "extend", "--project-root", basicRoot, "--profile", "full",
  "--adapter", "selfhost-media", "--run-id", "extended-fixture",
  "--consume", "ingress=homarr",
]);
assert.deepEqual(extendedBasic.metadata.profiles, ["basic", "ingress", "media", "full"]);
assert.deepEqual(extendedBasic.metadata.services.map((service) => service.id), [...householdIds, ...mediaIds].sort());

const fullRoot = join(root, "full");
await import("node:fs/promises").then(({ mkdir }) => mkdir(fullRoot, { mode: 0o700 }));
const full = await run([
  "init", "--project-root", fullRoot, "--profile", "full",
  "--adapter", "selfhost-media", "--run-id", "full-fixture",
  "--consume", "ingress=homarr",
]);
assert.deepEqual(full.metadata.profiles, ["basic", "ingress", "media", "full"]);
assert.equal(full.metadata.skills.includes("selfhost-compose"), true);
assert.deepEqual(full.metadata.services.map((service) => service.id), [...householdIds, ...mediaIds].sort());
for (const id of householdIds) {
  const service = full.metadata.services.find((candidate) => candidate.id === id);
  assert.equal(service.ownerSkill, "selfhost-compose");
  assert.equal("checkpoint" in service, false);
}

const skipped = await run([
  "service-checkpoint", "--project-root", fullRoot, "--service", "navidrome",
  "--stage", "applied", "--evidence", "apply:navidrome",
], 1);
assert.match(skipped.stderr, /advance one stage/);

const firstServiceCheckpoint = await run([
  "service-checkpoint", "--project-root", fullRoot, "--service", "audiobookshelf",
  "--stage", "planned", "--evidence", "plan:audiobookshelf",
]);
assert.equal(firstServiceCheckpoint.metadata.updatedAt, firstServiceCheckpoint.metadata.checkpoint.recordedAt);
const pending = await run(["resume", "--project-root", fullRoot]);
assert.deepEqual(pending.pendingHouseholdServices, [
  { id: "audiobookshelf", stage: "applied" },
  { id: "immich", stage: "planned" },
  { id: "navidrome", stage: "planned" },
  { id: "nextcloud", stage: "planned" },
  { id: "vaultwarden", stage: "planned" },
]);

const duplicate = await run([
  "service-checkpoint", "--project-root", fullRoot, "--service", "audiobookshelf",
  "--stage", "planned", "--evidence", "plan:audiobookshelf",
], 1);
assert.match(duplicate.stderr, /must be new/);

for (const id of householdIds) {
  if (id !== "audiobookshelf") {
    await run(["service-checkpoint", "--project-root", fullRoot, "--service", id, "--stage", "planned", "--evidence", `plan:${id}`]);
  }
  await run(["service-checkpoint", "--project-root", fullRoot, "--service", id, "--stage", "applied", "--evidence", `apply:${id}`]);
}

await run(["checkpoint", "--project-root", fullRoot, "--stage", "planned", "--evidence", "plan:full"]);
await run([
  "checkpoint", "--project-root", fullRoot, "--stage", "applied", "--evidence", "apply:full",
  ...flags(["approval:compose-project", "approval:ingress-route", "approval:media-project", "approval:owned-content"]),
]);
const verificationEvidence = [
  "verify:stack", "verify:edge", "verify:household-acceptance", "verify:media-browser", "verify:media-homarr",
  "verify:media-jellyfin", "verify:media-prowlarr", "verify:media-qbittorrent",
  "verify:media-radarr", "verify:media-relationships", "verify:media-seerr", "verify:media-sonarr",
];
const premature = await run([
  "checkpoint", "--project-root", fullRoot, "--stage", "verified",
  ...flags(verificationEvidence),
], 1);
assert.match(premature.stderr, /every household service checkpoint/);

const evidenceDirectory = join(fullRoot, ".selfhost", "evidence");
await mkdir(evidenceDirectory, { mode: 0o700 });
const missingChecksPath = join(evidenceDirectory, "missing-checks.json");
const missingChecks = acceptanceReport("audiobookshelf", "full-fixture");
missingChecks.checks.pop();
await writeFile(missingChecksPath, `${JSON.stringify(missingChecks)}\n`, { mode: 0o600 });
const rejectedMissingChecks = await run(["service-checkpoint", "--project-root", fullRoot, "--service", "audiobookshelf", "--stage", "verified", "--evidence", "verify:audiobookshelf", "--evidence-file", missingChecksPath], 1);
assert.match(rejectedMissingChecks.stderr, /missing required checks/);

const wrongServicePath = join(evidenceDirectory, "wrong-service.json");
await writeFile(wrongServicePath, `${JSON.stringify(acceptanceReport("navidrome", "full-fixture", true))}\n`, { mode: 0o600 });
const rejectedWrongService = await run(["service-checkpoint", "--project-root", fullRoot, "--service", "navidrome", "--stage", "verified", "--evidence", "verify:navidrome", "--evidence-file", wrongServicePath], 1);
assert.match(rejectedWrongService.stderr, /identity is invalid/);

const unsafePath = join(evidenceDirectory, "unsafe.json");
await writeFile(unsafePath, `${JSON.stringify(acceptanceReport("immich", "full-fixture"))}\n`, { mode: 0o600 });
await chmod(unsafePath, 0o644);
const rejectedUnsafe = await run(["service-checkpoint", "--project-root", fullRoot, "--service", "immich", "--stage", "verified", "--evidence", "verify:immich", "--evidence-file", unsafePath], 1);
assert.match(rejectedUnsafe.stderr, /mode 0600/);

const reportPaths = new Map<string, string>();
for (const id of householdIds) {
  const reportPath = join(evidenceDirectory, `${id}.json`);
  reportPaths.set(id, reportPath);
  await writeFile(reportPath, `${JSON.stringify(acceptanceReport(id, "full-fixture"))}\n`, { mode: 0o600 });
  await run(["service-checkpoint", "--project-root", fullRoot, "--service", id, "--stage", "verified", "--evidence", `verify:${id}`, "--evidence-file", reportPath]);
}
const unboundVerification = await run(["checkpoint", "--project-root", fullRoot, "--stage", "verified", ...flags(verificationEvidence)], 1);
assert.match(unboundVerification.stderr, /valid bound household credentials/);
const mismatchedRun = await run(["bind-household", "--project-root", fullRoot, "--run-id", "other-run"], 1);
assert.match(mismatchedRun.stderr, /recorded full-stack run ID/);
const credentialScript = resolve(import.meta.dir, "household-credentials.ts");
const createCredentials = Bun.spawnSync([
  process.execPath, credentialScript, "create", "--project-root", fullRoot, "--run-id", "full-fixture",
  "--username", "synthetic-user", "--email", "synthetic@example.test",
  ...householdIds.flatMap((id) => ["--service", id]),
], { stdout: "pipe", stderr: "pipe" });
assert.equal(createCredentials.exitCode, 0, createCredentials.stderr.toString());
const fullHandoffPath = JSON.parse(createCredentials.stdout.toString()).path;
await chmod(fullHandoffPath, 0o644);
const unsafeBinding = await run(["bind-household", "--project-root", fullRoot, "--run-id", "full-fixture"], 1);
assert.match(unsafeBinding.stderr, /missing, unsafe, or does not match/);
await chmod(fullHandoffPath, 0o600);
const bound = await run(["bind-household", "--project-root", fullRoot, "--run-id", "full-fixture"]);
assert.equal(bound.householdCredentialsStatus, "valid");
const verified = await run([
  "checkpoint", "--project-root", fullRoot, "--stage", "verified",
  ...flags(verificationEvidence),
]);
assert.equal(verified.metadata.checkpoint.stage, "verified");

const renewedNavidromePath = join(evidenceDirectory, "navidrome-renewed.json");
await writeFile(renewedNavidromePath, `${JSON.stringify(acceptanceReport("navidrome", "full-fixture"))}\n`, { mode: 0o600 });
const renewed = await run(["service-checkpoint", "--project-root", fullRoot, "--service", "navidrome", "--stage", "verified", "--evidence", "verify:navidrome-renewal", "--evidence-file", renewedNavidromePath]);
const renewedService = renewed.metadata.services.find((service) => service.id === "navidrome");
assert.equal(renewedService.checkpoint.acceptanceReport.path, ".selfhost/evidence/navidrome-renewed.json");

await writeFile(reportPaths.get("navidrome") as string, `${JSON.stringify(acceptanceReport("navidrome", "full-fixture"))}\n\n`, { mode: 0o600 });
const oldReportMutationIgnored = await run(["validate", "--project-root", fullRoot]);
assert.equal(oldReportMutationIgnored.status, "metadata-valid");

await writeFile(renewedNavidromePath, `${JSON.stringify(acceptanceReport("navidrome", "full-fixture"))}\n\n`, { mode: 0o600 });
const rejectedChangedReport = await run(["validate", "--project-root", fullRoot], 1);
assert.match(rejectedChangedReport.stderr, /changed after checkpoint/);

const deletedRoot = join(root, "deleted-handoff");
await mkdir(deletedRoot, { mode: 0o700 });
await run(["init", "--project-root", deletedRoot, "--profile", "full", "--adapter", "selfhost-media", "--run-id", "deleted-fixture", "--consume", "ingress=homarr"]);
const missingBinding = await run(["bind-household", "--project-root", deletedRoot, "--run-id", "deleted-fixture"], 1);
assert.match(missingBinding.stderr, /missing, unsafe, or does not match/);
const deletedCreate = Bun.spawnSync([
  process.execPath, credentialScript, "create", "--project-root", deletedRoot, "--run-id", "deleted-fixture",
  "--username", "synthetic-user", "--email", "synthetic@example.test",
  ...householdIds.flatMap((id) => ["--service", id]),
], { stdout: "pipe", stderr: "pipe" });
assert.equal(deletedCreate.exitCode, 0, deletedCreate.stderr.toString());
const deletedHandoffPath = JSON.parse(deletedCreate.stdout.toString()).path;
await run(["bind-household", "--project-root", deletedRoot, "--run-id", "deleted-fixture"]);
await unlink(deletedHandoffPath);
const deletedResume = await run(["resume", "--project-root", deletedRoot]);
assert.equal(deletedResume.householdCredentialsStatus, "invalid");
assert.equal(deletedResume.householdCredentialsValid, false);

const subsetBindingRoot = join(root, "subset-binding");
await mkdir(subsetBindingRoot, { mode: 0o700 });
await run(["init", "--project-root", subsetBindingRoot, "--profile", "full", "--adapter", "selfhost-media", "--run-id", "subset-fixture", "--consume", "ingress=homarr"]);
const subsetCreate = Bun.spawnSync([
  process.execPath, credentialScript, "create", "--project-root", subsetBindingRoot, "--run-id", "subset-fixture",
  "--username", "synthetic-user", "--service", "navidrome",
], { stdout: "ignore", stderr: "pipe" });
assert.equal(subsetCreate.exitCode, 0, subsetCreate.stderr.toString());
const rejectedSubsetBinding = await run(["bind-household", "--project-root", subsetBindingRoot, "--run-id", "subset-fixture"], 1);
assert.match(rejectedSubsetBinding.stderr, /does not match every selected household service/);

const forgedRoot = join(root, "forged");
await import("node:fs/promises").then(({ mkdir }) => mkdir(forgedRoot, { mode: 0o700 }));
await run([
  "init", "--project-root", forgedRoot, "--profile", "full",
  "--adapter", "selfhost-media", "--run-id", "forged-fixture",
  "--consume", "ingress=homarr",
]);
const forgedPath = join(forgedRoot, ".selfhost", "stack.json");
const forged = JSON.parse(await readFile(forgedPath, "utf8"));
const now = new Date().toISOString();
forged.updatedAt = now;
forged.checkpoint = {
  stage: "verified",
  recordedAt: now,
  evidenceIds: [
    "plan:full", "apply:full", "approval:compose-project", "approval:ingress-route",
    "approval:media-project", "approval:owned-content", ...verificationEvidence,
  ].sort(),
};
await writeFile(forgedPath, `${JSON.stringify(forged, null, 2)}\n`, { mode: 0o600 });
const rejectedForgery = await run(["validate", "--project-root", forgedRoot], 1);
assert.match(rejectedForgery.stderr, /bound household credentials|every household service checkpoint/);

process.stdout.write("PASS full stack continuation checkpoints\n");
