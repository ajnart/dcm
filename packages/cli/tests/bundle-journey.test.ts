#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { bundleBenchmarkCommand } from "../src/bundle-benchmark.ts";
import { bundleJourneyCommand } from "../src/bundle-journey.ts";
import { bundleCommand } from "../src/bundle.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function privateFile(path: string, contents: string | Buffer): Promise<string> {
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

async function privateJson(path: string, value: unknown): Promise<string> {
  return privateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function capture(action: () => Promise<void>): Promise<string> {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === "string") output += chunk;
    else output += Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try { await action(); return output; }
  finally { process.stdout.write = original; }
}

const bootId = "00000000-0000-4000-8000-000000000001";
let monotonic = 1_000_000_000n;
let wallTime = "2026-09-25T12:00:00.000Z";
const runtime = {
  bootId: async () => bootId,
  monotonicNs: () => monotonic,
  wallTime: () => wallTime,
};

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-journey-"));
try {
  await chmod(root, 0o700);
  const startArgs = ["start", "--project-root", root, "--id", "home"];
  const started = JSON.parse(await capture(() => bundleJourneyCommand(startArgs, runtime)));
  check(started.status === "active" && started.elapsedMs === 0
    && started.boundary.includes("no historical elapsed time"),
  "journey start did not create a truthful current monotonic boundary");

  const journalPath = join(root, ".selfhost", "journeys", "home.json");
  check(((await stat(journalPath)).mode & 0o777) === 0o600, "journey journal is not owner-only");
  monotonic = 2_500_000_000n;
  const active = JSON.parse(await capture(() => bundleJourneyCommand([
    "status", "--project-root", root, "--id", "home",
  ], runtime)));
  check(active.status === "active" && active.elapsedMs === 1500 && active.mutation === false,
    "journey status did not read cross-process monotonic elapsed time");

  const bundleDirectory = join(root, ".selfhost", "bundles", "home");
  await mkdir(bundleDirectory, { recursive: true, mode: 0o700 });
  await chmod(join(root, ".selfhost", "bundles"), 0o700);
  await chmod(bundleDirectory, 0o700);
  const bundlePath = join(bundleDirectory, "household-bundle.json");
  const bundle = {
    schemaVersion: 1,
    id: "home",
    projectRoot: root,
    services: {
      media: { runId: "home-media", username: "admin", credentialHandoff: true },
      immich: { input: join(bundleDirectory, "immich.json"), runId: "home-immich", accountFile: join(bundleDirectory, "immich-account.json") },
      docmost: { input: join(bundleDirectory, "docmost.json"), runId: "home-docmost", accountFile: join(bundleDirectory, "docmost-account.json") },
      vaultwarden: { input: join(bundleDirectory, "vaultwarden.json"), runId: "home-vault", accountFile: join(bundleDirectory, "vaultwarden-account.json"), httpsPlan: join(bundleDirectory, "vaultwarden-https.json") },
    },
  };
  const bundleSha256 = await privateJson(bundlePath, bundle);
  const evidencePath = join(bundleDirectory, "redacted-evidence.json");
  const evidenceSha256 = await privateJson(evidencePath, { redacted: true, status: "pass" });
  const screenshotPath = join(bundleDirectory, "final.png");
  const screenshotSha256 = await privateFile(screenshotPath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const evidenceSummary = { path: relative(root, evidencePath), sha256: evidenceSha256,
    observedAt: "2026-09-25T12:05:00.000Z", observer: "fixture-agent" };
  const applications = Object.fromEntries(["media", "immich", "docmost", "vaultwarden"]
    .map((id) => [id, { status: "pass", evidence: [evidenceSummary] }]));
  const homarr = Object.fromEntries(["board", "widgets", "notebook", "search", "mcp"]
    .map((id) => [id, { status: "pass", evidence: [evidenceSummary] }]));
  await privateJson(join(bundleDirectory, "finalization.json"), {
    schemaVersion: 1,
    kind: "household-bundle-finalization-checkpoint",
    bundleId: "home",
    projectRoot: root,
    bundleInput: { path: relative(root, bundlePath), sha256: bundleSha256, referencedFiles: {} },
    evidenceManifest: { path: relative(root, evidencePath), sha256: evidenceSha256 },
    evaluatedAt: "2026-09-25T12:06:00.000Z",
    observer: "fixture-agent",
    status: "recorded",
    findings: { blocked: [] },
    applications,
    homarr,
    screenshot: { path: relative(root, screenshotPath), sha256: screenshotSha256, format: "png", redaction: "operator-confirmed" },
    timing: { status: "measured", stages: [], endToEnd: {
      startedAt: "2026-09-25T12:00:00.000Z", completedAt: "2026-09-25T12:05:00.000Z",
    }, durationMs: 300_000, underTenMinutesMeasured: true },
    cleanup: { status: "pass", temporaryArtifacts: "removed", browserSession: "closed",
      testData: "recoverable-trash", stackState: "running", evidence: [evidenceSummary] },
    secrets: { secretFieldsAccepted: false, valuesPrinted: false, screenshotRedaction: "operator-confirmed-not-pixel-inspected" },
    independentlyVerified: false,
    mutationsPerformed: ["owner-only-finalization-checkpoint"],
    checkpoint: { path: join(bundleDirectory, "finalization.json"), mode: "0600" },
    claimBoundary: "fixture",
  });

  monotonic = 7_000_000_000n;
  wallTime = "2026-09-25T12:06:00.000Z";
  const finished = JSON.parse(await capture(() => bundleJourneyCommand([
    "finish", "--project-root", root, "--id", "home", "--input", bundlePath,
  ], runtime)));
  check(finished.status === "finished" && finished.elapsedMs === 6000 && finished.sameBoot === true
    && finished.prerequisites === "validated-recorded" && finished.independentlyVerified === false,
  "journey finish did not bind monotonic elapsed to complete recorded prerequisites");

  const benchmark = JSON.parse(await capture(() => bundleBenchmarkCommand([
    "benchmark", "--project-root", root, "--input", bundlePath,
  ])));
  check(benchmark.status === "time-measured" && benchmark.coverage.complete === false
    && benchmark.coverage.fullJourneyElapsedMeasured === true
    && benchmark.coverage.phaseBreakdownComplete === false
    && benchmark.claims.completeSetupUnderTenMinutes.status === "measured"
    && benchmark.claims.completeSetupUnderTenMinutes.value === true
    && benchmark.claims.completeSetupUnderTenMinutes.durationMs === 6000,
  "bundle benchmark did not report the validated full-journey duration");
  check(benchmark.claims.ease.status === "not-measured" && benchmark.claims.ease.targetMet === null
    && benchmark.claims.independentlyVerified === false,
  "journey timing leaked into ease or independent-acceptance claims");

  const validJournal = await readFile(journalPath, "utf8");
  const tampered = JSON.parse(validJournal);
  tampered.elapsedMs = 1;
  await privateJson(journalPath, tampered);
  let tamperingRejected = false;
  try {
    await capture(() => bundleBenchmarkCommand(["benchmark", "--project-root", root, "--input", bundlePath]));
  } catch (error) {
    tamperingRejected = error instanceof Error && error.message.includes("Finished journey journal is invalid");
  }
  check(tamperingRejected, "bundle benchmark accepted inconsistent persisted elapsed time");
  await privateFile(journalPath, validJournal);

  let invalidTimestampRejected = false;
  try {
    await capture(() => bundleJourneyCommand([
      "start", "--project-root", root, "--id", "bad-time",
    ], { ...runtime, wallTime: () => "not-a-timestamp" }));
  } catch (error) {
    invalidTimestampRejected = error instanceof Error && error.message.includes("ISO UTC timestamp");
  }
  check(invalidTimestampRejected, "journey start accepted an invalid wall-clock annotation");

  await capture(() => bundleJourneyCommand(["start", "--project-root", root, "--id", "reboot"], runtime));
  const rebooted = JSON.parse(await capture(() => bundleJourneyCommand([
    "status", "--project-root", root, "--id", "reboot",
  ], { ...runtime, bootId: async () => "00000000-0000-4000-8000-000000000002" })));
  check(rebooted.status === "invalidated" && rebooted.elapsedMs === null,
    "journey status fabricated elapsed time across a reboot");

  let delegated = false;
  const unused = async () => { delegated = true; };
  const routed = JSON.parse(await capture(() => bundleCommand([
    "journey", "start", "--project-root", root, "--id", "routed",
  ], { media: unused, immich: unused, docmost: unused, vaultwarden: unused })));
  check(routed.status === "active" && delegated === false, "bundle journey did not route without adapter calls");

  await chmod(journalPath, 0o644);
  let unsafeRejected = false;
  try {
    await capture(() => bundleJourneyCommand(["status", "--project-root", root, "--id", "home"], runtime));
  } catch (error) {
    unsafeRejected = error instanceof Error && error.message.includes("owner-only regular file");
  }
  check(unsafeRejected, "journey status accepted a non-owner-only journal");
  check(!(await readFile(journalPath, "utf8")).includes("password"), "journey journal contains a secret-bearing field");
  console.log("PASS household journey timer is monotonic, owner-only, hash-bound, and claim-separated");
} finally {
  await rm(root, { recursive: true, force: true });
}
