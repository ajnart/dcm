#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleFinalizeCommand } from "../src/bundle-finalize.ts";
import { command } from "../src/command.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function privateFile(path: string, contents: string | Buffer): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function privateJson(path: string, value: unknown): Promise<void> {
  await privateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function capture(action: () => Promise<void>): Promise<string> {
  const priorWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === "string") output += chunk;
    else output += Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try { await action(); return output; }
  finally { process.stdout.write = priorWrite; }
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-finalize-"));
try {
  const bundlePath = join(root, "household-bundle.json");
  for (const name of ["immich", "immich-account", "docmost", "docmost-account", "vaultwarden",
    "vaultwarden-account", "vaultwarden-https"]) {
    if (name === "immich-account") continue;
    await privateJson(join(root, `${name}.json`), { schemaVersion: 1, fixture: name });
  }
  await privateJson(bundlePath, {
    schemaVersion: 1,
    id: "home",
    projectRoot: root,
    services: {
      media: { runId: "home-media", username: "admin", credentialHandoff: true },
      immich: { input: join(root, "immich.json"), runId: "home-immich", accountFile: join(root, "immich-account.json") },
      docmost: { input: join(root, "docmost.json"), runId: "home-docmost", accountFile: join(root, "docmost-account.json") },
      vaultwarden: { input: join(root, "vaultwarden.json"), runId: "home-vault", accountFile: join(root, "vaultwarden-account.json"), httpsPlan: join(root, "vaultwarden-https.json") },
    },
  });

  let delegated = false;
  const unused = async () => { delegated = true; };
  const scaffoldOutput = JSON.parse(await capture(() => command([
    "bundle", "finalize", "scaffold", "--project-root", root, "--input", bundlePath,
  ], unused, unused, unused, unused, unused, async () => { delegated = true; })));
  const manifestPath = join(root, "finalization-evidence.json");
  const scaffoldContents = await readFile(manifestPath, "utf8");
  const scaffold = JSON.parse(scaffoldContents);
  check(delegated === false && scaffoldOutput.acceptanceStatus === "blocked"
    && scaffoldOutput.path === manifestPath,
  "top-level CLI did not create the blocked finalization scaffold directly");
  check(((await stat(manifestPath)).mode & 0o777) === 0o600,
    "finalization scaffold is not owner-only mode 0600");
  check(scaffold.bundleId === "home" && scaffold.projectRoot === root
    && scaffold.runIds.media === "home-media" && scaffold.runIds.immich === "home-immich"
    && scaffold.runIds.docmost === "home-docmost" && scaffold.runIds.vaultwarden === "home-vault",
  "finalization scaffold is not bound to the selected bundle and run IDs");
  check(Object.values(scaffold.applications).every((entry: any) => entry.status === "blocked" && entry.evidence.length === 0)
    && Object.values(scaffold.homarr).every((entry: any) => entry.status === "blocked" && entry.evidence.length === 0)
    && scaffold.timing.stages.every((stage: any) => stage.startedAt === "" && stage.completedAt === "")
    && scaffold.screenshot.path === "" && scaffold.screenshot.sha256 === "" && scaffold.screenshot.redacted === false
    && scaffold.cleanup.status === "blocked" && scaffold.cleanup.evidence.length === 0,
  "finalization scaffold did not leave every acceptance slot visibly blocked or empty");
  let overwriteRefused = false;
  try {
    await capture(() => bundleFinalizeCommand([
      "finalize", "scaffold", "--project-root", root, "--input", bundlePath,
    ]));
  } catch (error) {
    overwriteRefused = error instanceof Error && error.message.includes("refusing to overwrite");
  }
  check(overwriteRefused && await readFile(manifestPath, "utf8") === scaffoldContents,
    "finalization scaffold overwrote an existing manifest");
  await privateJson(join(root, "immich-account.json"), { schemaVersion: 1, fixture: "immich-account" });

  const recordArgs = ["bundle", "finalize", "record", "--project-root", root, "--input", bundlePath,
    "--subject", "media", "--check", "direct-acceptance", "--observed-at", "2026-09-25T12:07:30.000Z",
    "--observer", "fixture-agent", "--status", "pass", "--redacted", "true",
    "--reference", "artifact:home-media-observed"];
  const recorded = JSON.parse(await capture(() => command(recordArgs, unused, unused, unused, unused, unused,
    async () => { delegated = true; })));
  check(delegated === false && recorded.acceptanceStatus === "blocked" && recorded.independentlyVerified === false,
    "record command overstated acceptance or delegated to another owner");
  check(((await stat(recorded.path)).mode & 0o777) === 0o600
    && ((await stat(manifestPath)).mode & 0o777) === 0o600,
  "record command did not preserve owner-only evidence and manifest modes");
  const recordedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  check(recordedManifest.applications.media.status === "pass"
    && recordedManifest.applications.media.evidence[0] === recorded.path,
  "record command did not attach the exact observation to its scaffold slot");
  let repeatedRecordRefused = false;
  try { await capture(() => bundleFinalizeCommand(recordArgs.slice(1))); }
  catch (error) {
    repeatedRecordRefused = error instanceof Error && error.message.includes("refusing to overwrite");
  }
  check(repeatedRecordRefused, "record command overwrote a filled observation slot");
  const invalidRecord = [...recordArgs];
  invalidRecord[invalidRecord.indexOf("artifact:home-media-observed")] = "artifact:live-api-key-value";
  let secretRecordRefused = false;
  try { await capture(() => bundleFinalizeCommand(invalidRecord.slice(1))); }
  catch (error) {
    secretRecordRefused = error instanceof Error && error.message.includes("secret-bearing label");
  }
  check(secretRecordRefused, "record command accepted a secret-labelled reference");

  const legacyManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  delete legacyManifest.homarr.search;
  await privateJson(manifestPath, legacyManifest);
  const searchRecorded = JSON.parse(await capture(() => bundleFinalizeCommand([
    "finalize", "record", "--project-root", root, "--input", bundlePath,
    "--subject", "homarr", "--check", "search", "--observed-at", "2026-09-25T12:07:30.000Z",
    "--observer", "fixture-agent", "--status", "pass", "--redacted", "true",
    "--reference", "artifact:home-search-observed",
  ])));
  const upgradedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  check(upgradedManifest.homarr.search.status === "pass"
    && upgradedManifest.homarr.search.evidence[0] === searchRecorded.path
    && upgradedManifest.applications.media.evidence[0] === recorded.path,
  "record command did not safely upgrade the old search-less scaffold");

  const cleanupArgs = ["finalize", "record", "--project-root", root, "--input", bundlePath,
    "--subject", "bundle", "--check", "cleanup", "--observed-at", "2026-09-25T12:07:30.000Z",
    "--observer", "fixture-agent", "--status", "pass", "--redacted", "true",
    "--reference", "artifact:home-cleanup-observed", "--temporary-artifacts", "removed",
    "--browser-session", "closed", "--test-data", "recoverable-trash", "--stack-state", "running"];
  const cleanupRecorded = JSON.parse(await capture(() => bundleFinalizeCommand(cleanupArgs)));
  const cleanupManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  check(cleanupManifest.cleanup.status === "pass" && cleanupManifest.cleanup.evidence[0] === cleanupRecorded.path
    && cleanupManifest.cleanup.testData === "recoverable-trash",
  "record command did not attach explicit cleanup state and observation");

  const evidencePaths: Record<string, string> = { media: recorded.path, search: searchRecorded.path, cleanup: cleanupRecorded.path };
  const observations = [
    { key: "media", subject: "home:media", runId: "home-media", check: "direct-acceptance" },
    { key: "immich", subject: "home:immich", runId: "home-immich", check: "direct-acceptance" },
    { key: "docmost", subject: "home:docmost", runId: "home-docmost", check: "direct-acceptance" },
    { key: "vaultwarden", subject: "home:vaultwarden", runId: "home-vault", check: "direct-acceptance" },
    { key: "board", subject: "home:homarr", runId: "home-media", check: "board" },
    { key: "widgets", subject: "home:homarr", runId: "home-media", check: "widgets" },
    { key: "notebook", subject: "home:homarr", runId: "home-media", check: "notebook" },
    { key: "search", subject: "home:homarr", runId: "home-media", check: "search" },
    { key: "mcp", subject: "home:homarr", runId: "home-media", check: "mcp" },
    { key: "cleanup", subject: "home:bundle", runId: "home", check: "cleanup" },
  ];
  for (const observation of observations) {
    if (observation.key === "media" || observation.key === "search" || observation.key === "cleanup") continue;
    const path = join(root, `${observation.key}-evidence.json`);
    evidencePaths[observation.key] = path;
    await privateJson(path, {
      schemaVersion: 1,
      kind: "redacted-observation",
      bundleId: "home",
      subject: observation.subject,
      runId: observation.runId,
      check: observation.check,
      observedAt: "2026-09-25T12:07:30.000Z",
      observer: "fixture-agent",
      status: "pass",
      evidenceRefs: [`artifact:home-${observation.key}-observed`],
      redacted: true,
    });
  }

  const screenshotPath = join(root, "final.png");
  const screenshot = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await privateFile(screenshotPath, screenshot);
  const screenshotDigest = `sha256:${createHash("sha256").update(screenshot).digest("hex")}`;
  const manifest: Record<string, any> = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.evaluatedAt = "2026-09-25T12:09:00.000Z";
  manifest.observer = "fixture-agent";
  manifest.applications = Object.fromEntries(["media", "immich", "docmost", "vaultwarden"]
    .map((service) => [service, { status: "pass", evidence: [evidencePaths[service]] }]));
  manifest.homarr = Object.fromEntries(["board", "widgets", "notebook", "search", "mcp"]
    .map((checkId) => [checkId, { status: "pass", evidence: [evidencePaths[checkId]] }]));
  manifest.screenshot = { path: screenshotPath, sha256: screenshotDigest, redacted: true };
  manifest.timing = {
      stages: [
        { id: "media", startedAt: "2026-09-25T12:00:00.000Z", completedAt: "2026-09-25T12:02:00.000Z" },
        { id: "immich", startedAt: "2026-09-25T12:02:00.000Z", completedAt: "2026-09-25T12:04:00.000Z" },
        { id: "docmost", startedAt: "2026-09-25T12:04:00.000Z", completedAt: "2026-09-25T12:06:00.000Z" },
        { id: "vaultwarden", startedAt: "2026-09-25T12:06:00.000Z", completedAt: "2026-09-25T12:07:00.000Z" },
        { id: "homarr", startedAt: "2026-09-25T12:07:00.000Z", completedAt: "2026-09-25T12:08:00.000Z" },
      ],
      endToEnd: { startedAt: "2026-09-25T12:00:00.000Z", completedAt: "2026-09-25T12:08:00.000Z" },
  };
  manifest.cleanup = {
    status: "pass",
    temporaryArtifacts: "removed",
    browserSession: "closed",
    testData: "recoverable-trash",
    stackState: "running",
    evidence: [evidencePaths.cleanup],
  };
  manifest.runIds.immich = "other-immich";
  await privateJson(manifestPath, manifest);
  let mismatchedRunRefused = false;
  try {
    await capture(() => bundleFinalizeCommand([
      "finalize", "--project-root", root, "--input", bundlePath, "--evidence", manifestPath,
    ]));
  } catch (error) {
    mismatchedRunRefused = error instanceof Error && error.message.includes("run IDs do not match");
  }
  check(mismatchedRunRefused, "finalization accepted a scaffold rebound to a different run ID");
  manifest.runIds.immich = "home-immich";
  await privateJson(manifestPath, manifest);
  const args = ["finalize", "--project-root", root, "--input", bundlePath, "--evidence", manifestPath];
  const statusArgs = ["finalize", "status", ...args.slice(1)];
  const assessment = JSON.parse(await capture(() => command(["bundle", ...statusArgs], unused, unused,
    unused, unused, unused, async () => { delegated = true; })));
  check(assessment.status === "recorded" && assessment.kind === "household-bundle-finalization-assessment"
    && assessment.mutation === false && assessment.mutationsPerformed.length === 0
    && assessment.independentlyVerified === false && !Object.hasOwn(assessment, "checkpoint")
    && !existsSync(join(root, "finalization.json")) && delegated === false,
  "read-only finalization assessment wrote a checkpoint, delegated, or overstated its evidence");
  const first = await capture(() => bundleFinalizeCommand(args));
  const result = JSON.parse(first);
  check(result.status === "recorded" && result.independentlyVerified === false
    && result.findings.blocked.length === 0,
  "complete finalization evidence was not recorded with its independent-verification limit");
  check(result.timing.durationMs === 480_000 && result.timing.underTenMinutesMeasured === true,
    "measured end-to-end timing was not reported accurately");
  check(Object.keys(result.applications).length === 4 && Object.keys(result.homarr).length === 5,
    "finalization omitted required application or Homarr evidence");
  check(result.secrets.screenshotRedaction === "operator-confirmed-not-pixel-inspected"
    && result.mutationsPerformed.length === 1,
  "finalization overstated screenshot inspection or mutation scope");
  const checkpoint = await readFile(join(root, "finalization.json"), "utf8");
  check(checkpoint === first, "saved finalization checkpoint differs from emitted output");
  const repeated = await capture(() => bundleFinalizeCommand(args));
  check(repeated === first, "identical finalization input was not deterministic");
  delegated = false;
  const routed = await capture(() => command(["bundle", ...args], unused, unused, unused, unused, unused,
    async () => { delegated = true; }));
  check(routed === first && delegated === false, "top-level CLI did not route bundle finalize directly");

  delete manifest.homarr.search;
  manifest.timing.stages = manifest.timing.stages.filter((stage: Record<string, unknown>) => stage.id !== "homarr");
  await privateJson(manifestPath, manifest);
  const blockedAssessment = JSON.parse(await capture(() => bundleFinalizeCommand(statusArgs)));
  check(blockedAssessment.status === "blocked" && blockedAssessment.findings.blocked.includes("homarr.search")
    && blockedAssessment.mutationsPerformed.length === 0
    && await readFile(join(root, "finalization.json"), "utf8") === checkpoint,
  "read-only blocked assessment altered the checkpoint or promoted missing evidence");
  const blocked = JSON.parse(await capture(() => bundleFinalizeCommand(args)));
  check(blocked.status === "blocked" && blocked.findings.blocked.includes("homarr.search")
    && blocked.findings.blocked.includes("timing.homarr") && blocked.timing.underTenMinutesMeasured === null,
  "missing evidence or stage timing was presented as passing or under ten minutes");

  manifest.homarr.search = { status: "pass", evidence: [evidencePaths.search] };
  const secretEvidence = JSON.parse(await readFile(evidencePaths.mcp, "utf8"));
  secretEvidence.evidenceRefs = ["artifact:live-api-key-value"];
  await privateJson(evidencePaths.mcp, secretEvidence);
  await privateJson(manifestPath, manifest);
  let secretRefused = false;
  try { await capture(() => bundleFinalizeCommand(args)); }
  catch (error) {
    secretRefused = error instanceof Error && error.message.includes("secret-bearing label");
  }
  check(secretRefused, "secret-bearing evidence reference was accepted");
  console.log("PASS bundle finalization evidence, timing, cleanup, and fail-closed boundaries");
} finally {
  await rm(root, { recursive: true, force: true });
}
