#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleBenchmarkCommand } from "../src/bundle-benchmark.ts";
import { bundleCommand } from "../src/bundle.ts";
import { bundleJourneyCommand } from "../src/bundle-journey.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function capture(action: () => Promise<void>): Promise<string> {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === "string") output += chunk;
    else output += Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
    return output;
  } finally {
    process.stdout.write = original;
  }
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-benchmark-"));
try {
  await chmod(root, 0o700);
  const bundlePath = join(root, "household-bundle.json");
  const bundle = {
    schemaVersion: 1,
    id: "home",
    projectRoot: root,
    services: {
      media: { runId: "home-media", username: "admin", credentialHandoff: true },
      immich: { input: join(root, "immich.json"), runId: "home-immich", accountFile: join(root, "immich-account.json") },
      docmost: { input: join(root, "docmost.json"), runId: "home-docmost", accountFile: join(root, "docmost-account.json") },
      vaultwarden: { input: join(root, "vaultwarden.json"), runId: "home-vault", accountFile: join(root, "vaultwarden-account.json"), httpsPlan: join(root, "vaultwarden-https.json") },
    },
  };
  await privateJson(bundlePath, bundle);
  const baseArgs = ["benchmark", "--project-root", root, "--input", bundlePath];
  const missing = JSON.parse(await capture(() => bundleBenchmarkCommand(baseArgs)));
  check(missing.status === "not-measured" && missing.mutation === false
    && missing.evidence.finalization.state === "missing" && missing.coverage.recordedPhaseCount === 0,
  "missing finalization evidence was not reported as an unmeasured read-only result");
  check(missing.claims.completeSetupUnderTenMinutes.value === null
    && missing.claims.ease.score === null && missing.claims.ease.target === 85,
  "missing evidence produced an under-ten-minute or ease claim");
  await privateJson(bundlePath, { ...bundle, services: { ...bundle.services,
    media: { ...bundle.services.media, mode: "adopt" } } });
  const adopted = JSON.parse(await capture(() => bundleBenchmarkCommand(baseArgs)));
  check(adopted.coverage.freshFullStackComparable === false
    && adopted.claims.completeSetupUnderTenMinutes.status === "not-comparable-adopted-media"
    && adopted.claims.completeSetupUnderTenMinutes.value === null,
  "an adopted media run was treated as a fresh full-stack speed measurement");
  await privateJson(bundlePath, bundle);

  const bundleRaw = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  const bundleSha256 = `sha256:${createHash("sha256").update(bundleRaw).digest("hex")}`;
  const start = Date.parse("2026-09-25T12:00:00.000Z");
  const stageIds = ["media", "immich", "docmost", "vaultwarden", "homarr"];
  await privateJson(join(root, "finalization.json"), {
    schemaVersion: 1,
    kind: "household-bundle-finalization-checkpoint",
    bundleId: "home",
    projectRoot: root,
    bundleInput: { path: "household-bundle.json", sha256: bundleSha256, referencedFiles: {} },
    status: "recorded",
    timing: {
      stages: stageIds.map((id, index) => ({
        id,
        startedAt: new Date(start + index * 60_000).toISOString(),
        completedAt: new Date(start + (index + 1) * 60_000).toISOString(),
        durationMs: 60_000,
      })),
      endToEnd: { startedAt: new Date(start).toISOString(), completedAt: new Date(start + 300_000).toISOString() },
      durationMs: 300_000,
      underTenMinutesMeasured: true,
    },
    independentlyVerified: false,
  });
  const output = await capture(() => bundleBenchmarkCommand(baseArgs));
  const report = JSON.parse(output);
  check(report.status === "not-measured" && report.coverage.recordedPhaseCount === 5
    && report.coverage.requiredPhaseCount === 10 && report.coverage.complete === false,
  "partial finalization timings were mistaken for a complete setup journal");
  check(report.phases.find((phase: Record<string, unknown>) => phase.id === "media")?.durationMs === 60_000
    && report.phases.find((phase: Record<string, unknown>) => phase.id === "caddy-private-https")?.state === "unknown"
    && report.phases.find((phase: Record<string, unknown>) => phase.id === "browser-acceptance")?.state === "unknown",
  "the report did not separate recorded stages from Caddy and browser unknowns");
  check(report.claims.completeSetupUnderTenMinutes.status === "not-measured"
    && report.claims.completeSetupUnderTenMinutes.value === null
    && report.claims.completeSetupUnderTenMinutes.durationMs === null
    && report.claims.ease.status === "not-measured" && report.claims.ease.targetMet === null,
  "partial timing or the finalizer's narrow under-ten result escaped the benchmark boundary");

  let delegated = false;
  const unused = async () => { delegated = true; };
  const routed = JSON.parse(await capture(() => bundleCommand(baseArgs, {
    media: unused,
    immich: unused,
    docmost: unused,
    vaultwarden: unused,
  })));
  check(routed.kind === "household-bundle-benchmark" && delegated === false,
    "bundle benchmark did not route through the bundle CLI without adapter calls");

  const privateValue = ["DO", "NOT", "PRINT", "THIS"].join("-");
  const privateField = ["pass", "word"].join("");
  await privateJson(join(root, "private-handoff.json"), { [privateField]: privateValue });
  check(!output.includes(privateValue) && report.secretsPrinted === false,
    "bundle benchmark read or printed unrelated private credential state");

  let clock = 1_000_000_000n;
  const boot = "00000000-0000-4000-8000-000000000001";
  const runtime = { bootId: async () => boot, monotonicNs: () => clock,
    wallTime: () => "2026-09-25T12:00:00.000Z" };
  await capture(() => bundleJourneyCommand(["start", "--project-root", root, "--id", "home"], runtime));
  clock += 599_999_000_000n;
  const belowDeadline = JSON.parse(await capture(() => bundleBenchmarkCommand(baseArgs, runtime)));
  check(belowDeadline.claims.completeSetupUnderTenMinutes.status === "not-measured"
    && belowDeadline.claims.completeSetupUnderTenMinutes.value === null,
  "an unfinished journey below the deadline was claimed to meet the target");
  clock += 1_000_000n;
  const expired = JSON.parse(await capture(() => bundleBenchmarkCommand(baseArgs, runtime)));
  check(expired.evidence.fullJourneyJournal.elapsedMs === 600_000
    && expired.claims.completeSetupUnderTenMinutes.status === "threshold-exceeded-in-progress"
    && expired.claims.completeSetupUnderTenMinutes.value === false
    && expired.claims.completeSetupUnderTenMinutes.durationMs === null
    && expired.coverage.fullJourneyElapsedMeasured === false
    && expired.claims.ease.score === null && expired.mutation === false,
  "an expired unfinished journey hid the deadline failure or claimed completed timing/ease");
  const rebootedRuntime = { ...runtime, bootId: async () => "00000000-0000-4000-8000-000000000002" };
  const rebooted = JSON.parse(await capture(() => bundleBenchmarkCommand(baseArgs, rebootedRuntime)));
  check(rebooted.evidence.fullJourneyJournal.state === "invalidated"
    && rebooted.claims.completeSetupUnderTenMinutes.value === null,
  "a cross-boot journey manufactured a deadline result");

  await chmod(join(root, "finalization.json"), 0o644);
  let unsafeRejected = false;
  try {
    await capture(() => bundleBenchmarkCommand(baseArgs));
  } catch (error) {
    unsafeRejected = error instanceof Error && error.message.includes("owner-only regular file");
  }
  check(unsafeRejected, "bundle benchmark accepted a non-owner-only finalization checkpoint");
  console.log("PASS bundle benchmark reports partial timings without unsupported speed or ease claims");
} finally {
  await rm(root, { recursive: true, force: true });
}
