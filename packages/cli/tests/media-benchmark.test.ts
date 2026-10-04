#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaCommand } from "../src/media.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function privateJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function benchmark(runId: string, options: { resumedFrom: string | null; stages: Array<{ id: string; status: string; elapsedMs: number; exitCode: number }>; status: string; wallMs: number }) {
  let technicalAcceptance = false;
  if (options.status === "passed" && options.resumedFrom === null) technicalAcceptance = true;
  const record: Record<string, unknown> = {
    schema: "selfhost-media-setup-benchmark/v1",
    runId,
    boardName: "personal",
    startedAt: "2026-09-25T10:00:00.000Z",
    resumedFrom: options.resumedFrom,
    credentialHandoffRequested: true,
    indexerVerificationDeferred: false,
    pendingAcceptanceRows: [],
    imagePullMs: null,
    browserFallbacks: null,
    benchmarkScope: "Command stages only; manual browser repair outside this invocation is not timed or counted",
    stages: options.stages,
    status: options.status,
    technicalAcceptance,
    wallMs: options.wallMs,
    finishedAt: "2026-09-25T10:08:00.000Z",
  };
  if (options.status === "failed") record.failedStage = options.stages.at(-1)!.id;
  return record;
}

async function capture(action: () => Promise<void>) {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => { lines.push(values.join(" ")); };
  try { await action(); }
  finally { console.log = original; }
  return lines.join("\n");
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "selfhost-media-benchmark-"));
  try {
    await chmod(root, 0o700);
    const local = join(root, ".selfhost");
    const harness = join(local, "media-harness");
    const runId = "benchmark-fixture";
    const session = join(harness, ".sessions", runId);
    const artifacts = join(session, "artifacts");
    const intents = join(local, "cli-intents");
    for (const directory of [local, harness, join(harness, ".sessions"), session, artifacts, intents]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
    const runtimeManifest = `${JSON.stringify({ schemaVersion: 1, files: [] }, null, 2)}\n`;
    await writeFile(join(harness, "runtime-manifest.json"), runtimeManifest, { mode: 0o600 });
    await chmod(join(harness, "runtime-manifest.json"), 0o600);
    await privateJson(join(intents, `${runId}.json`), {
      schemaVersion: 1,
      runId,
      username: "admin",
      credentialHandoff: true,
      runtimeSha256: createHash("sha256").update(runtimeManifest).digest("hex"),
    });
    await writeFile(join(session, "manifest.env"), [
      `RUN_ID=${runId}`,
      `COMPOSE_PROJECT_NAME=autostack-${runId}`,
      `SESSION_ROOT=${session}`,
    ].join("\n") + "\n", { mode: 0o600 });
    await chmod(join(session, "manifest.env"), 0o600);

    const stageIds = ["up", "qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr",
      "homarr-finalize", "homarr-widgets", "homarr-notebook", "mcp-config", "mcp-verify", "verify", "connections", "handoff"];
    const oldPath = join(artifacts, "setup-benchmark-1758794400000-00000000-0000-4000-8000-000000000001.json");
    const historical = benchmark(runId, { resumedFrom: "sonarr", status: "failed", wallMs: 2000,
      stages: [
        { id: "sonarr", status: "pass", elapsedMs: 1000, exitCode: 0 },
        { id: "radarr", status: "fail", elapsedMs: 1000, exitCode: 1 },
      ] });
    delete historical.benchmarkScope;
    delete historical.credentialHandoffRequested;
    delete historical.indexerVerificationDeferred;
    delete historical.pendingAcceptanceRows;
    historical.browserFallbacks = 0;
    await privateJson(oldPath, historical);
    const latestPath = join(artifacts, "setup-benchmark-1758794880000-00000000-0000-4000-8000-000000000002.json");
    await privateJson(latestPath, benchmark(runId, { resumedFrom: null, status: "passed", wallMs: 480000,
      stages: stageIds.map((id) => ({ id, status: "pass", elapsedMs: 1000, exitCode: 0 })) }));
    const secretField = ["pass", "word"].join("");
    const privateValue = ["DO", "NOT", "PRINT", "THIS"].join("-");
    await privateJson(join(artifacts, "private-handoff.json"), { [secretField]: privateValue });

    const journalPath = join(local, "media-runtime-sync.json");
    await privateJson(journalPath, {
      schemaVersion: 1,
      fromSha256: "1".repeat(64),
      toSha256: "2".repeat(64),
      approvalDigest: `sha256:${"3".repeat(64)}`,
      phase: "prepared",
    });
    let transactionRejected = false;
    try { await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId])); }
    catch (error) {
      transactionRejected = error instanceof Error && error.message.includes("Media runtime sync is incomplete");
    }
    check(transactionRejected && !existsSync(join(root, ".selfhost-media-runtime.lock")),
      "benchmark did not refuse an incomplete runtime sync without taking the lock");
    await rm(journalPath);

    const output = await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId]));
    const report = JSON.parse(output);
    check(report.kind === "selfhost-media-benchmark" && report.mutation === false && report.recordCount === 2,
      "benchmark did not report the validated read-only record set");
    check(report.latestInvocation.recordPath === latestPath && report.latestInvocation.wallMs === 480000
      && report.latestInvocation.resumedFrom === null && report.latestInvocation.stages.length === stageIds.length,
    "benchmark did not select and summarize the latest complete invocation");
    check(report.claims.commandInvocationComplete === true && report.claims.commandStagesUnderTenMinutes === true
      && report.claims.fullSetupUnderTenMinutesClaimed === false
      && report.claims.fullStackAcceptanceClaimed === false && report.scope.externalBrowserRepairIncluded === false,
    "benchmark timing claims crossed their evidence boundary");
    check(report.secretsPrinted === false && !output.includes(privateValue)
      && !existsSync(join(root, ".selfhost-media-runtime.lock")),
    "benchmark exposed private values or mutated the project lock");

    check(report.workflowCompletion.completed === true && report.workflowCompletion.status === "passed",
      "full validated invocation did not qualify recorded workflow completion");
    const boundary = stageIds.indexOf("homarr");
    const predecessor = benchmark(runId, { resumedFrom: null, status: "failed", wallMs: 480000,
      stages: stageIds.slice(0, boundary + 1).map((id) => {
        if (id === "homarr") return { id, status: "fail", elapsedMs: 1000, exitCode: 1 };
        return { id, status: "pass", elapsedMs: 1000, exitCode: 0 };
      }) });
    const resumed = benchmark(runId, { resumedFrom: "homarr", status: "passed", wallMs: 480000,
      stages: stageIds.slice(boundary).map((id) => ({ id, status: "pass", elapsedMs: 1000, exitCode: 0 })) });
    resumed.startedAt = "2026-09-25T10:08:00.000Z";
    resumed.finishedAt = "2026-09-25T10:16:00.000Z";
    await privateJson(oldPath, predecessor);
    await privateJson(latestPath, resumed);
    const resumedReport = JSON.parse(await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId])));
    check(resumedReport.workflowCompletion.completed === true && resumedReport.workflowCompletion.status === "passed"
      && resumedReport.latestInvocation.resumedFrom === "homarr" && resumedReport.claims.fullSetupUnderTenMinutesClaimed === false,
    "exact resumed failed-stage chain did not qualify workflow-only completion");
    predecessor.finishedAt = "2026-09-25T10:09:00.000Z";
    await privateJson(oldPath, predecessor);
    const overlapReport = JSON.parse(await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId])));
    check(overlapReport.workflowCompletion.completed === false && overlapReport.workflowCompletion.status === "incomplete",
      "overlapping invocation records qualified resumed workflow completion");
    await privateJson(oldPath, historical);
    const missingChain = JSON.parse(await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId])));
    check(missingChain.workflowCompletion.completed === false, "unrelated failed stage qualified a resumed chain");
    const pending = benchmark(runId, { resumedFrom: null, status: "pending-owner-choice", wallMs: 480000,
      stages: stageIds.map((id) => {
        if (id === "verify") return { id, status: "pending", elapsedMs: 1000, exitCode: 2 };
        return { id, status: "pass", elapsedMs: 1000, exitCode: 0 };
      }) });
    pending.indexerVerificationDeferred = true;
    pending.pendingAcceptanceRows = ["Prowlarr selected indexer", "Sonarr synced indexer edge", "Radarr synced indexer edge"];
    await privateJson(latestPath, pending);
    const pendingReport = JSON.parse(await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId])));
    check(pendingReport.workflowCompletion.completed === true && pendingReport.workflowCompletion.status === "pending-owner-choice"
      && pendingReport.claims.fullStackAcceptanceClaimed === false,
    "strict pending-owner-choice workflow did not preserve its acceptance boundary");
    const pendingPrefixFailure = { ...pending, status: "failed", failedStage: "handoff",
      stages: (pending.stages as Array<{ id: string; status: string; elapsedMs: number; exitCode: number }>).map((stage) => {
        if (stage.id === "handoff") return { ...stage, status: "fail", exitCode: 1 };
        return stage;
      }) };
    const handoffResume = benchmark(runId, { resumedFrom: "handoff", status: "passed", wallMs: 480000,
      stages: [{ id: "handoff", status: "pass", elapsedMs: 1000, exitCode: 0 }] });
    handoffResume.startedAt = "2026-09-25T10:08:00.000Z";
    handoffResume.finishedAt = "2026-09-25T10:16:00.000Z";
    await privateJson(oldPath, pendingPrefixFailure);
    await privateJson(latestPath, handoffResume);
    const pendingChain = JSON.parse(await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId])));
    check(pendingChain.workflowCompletion.completed === true && pendingChain.workflowCompletion.status === "pending-owner-choice",
      "a passed suffix erased recorded pending verification in its exact predecessor");
    await privateJson(oldPath, historical);

    await privateJson(join(artifacts, "cli-approved.json"), {
      schemaVersion: 1, approvalDigest: "a".repeat(64),
    });
    const failed = benchmark(runId, { resumedFrom: "sonarr", status: "failed", wallMs: 2000,
      stages: [
        { id: "sonarr", status: "pass", elapsedMs: 1000, exitCode: 0 },
        { id: "radarr", status: "fail", elapsedMs: 1000, exitCode: 1 },
      ] });
    for (const recorded of [true, false, undefined]) {
      delete failed.indexerVerificationDeferred;
      if (recorded !== undefined) failed.indexerVerificationDeferred = recorded;
      await privateJson(latestPath, failed);
      const diagnosisOutput = await capture(() => mediaCommand(["diagnose", "--project-root", root, "--run-id", runId]));
      const diagnosis = JSON.parse(diagnosisOutput);
      check(diagnosis.resumeCommand.includes("--defer-indexer") === (recorded === true)
        && diagnosis.resumeCommand.includes("a".repeat(64)) && diagnosis.failedStage === "radarr"
        && !diagnosisOutput.includes(privateValue),
      "diagnosis did not preserve only the exact recorded indexer deferral and approval");
    }
    failed.indexerVerificationDeferred = "true";
    await privateJson(latestPath, failed);
    let invalidDeferralRejected = false;
    try { await capture(() => mediaCommand(["diagnose", "--project-root", root, "--run-id", runId])); }
    catch (error) {
      invalidDeferralRejected = error instanceof Error && error.message === "Invalid recorded media indexer deferral";
    }
    check(invalidDeferralRejected, "diagnosis accepted a non-boolean recorded deferral");
    await privateJson(latestPath, benchmark(runId, { resumedFrom: null, status: "passed", wallMs: 480000,
      stages: stageIds.map((id) => ({ id, status: "pass", elapsedMs: 1000, exitCode: 0 })) }));

    let unknownOptionRejected = false;
    try {
      await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId,
        "--unexpected", "value"]));
    } catch (error) {
      unknownOptionRejected = error instanceof Error && error.message === "Unexpected or incomplete media option: --unexpected";
    }
    check(unknownOptionRejected, "benchmark accepted an unknown CLI option");

    await chmod(oldPath, 0o644);
    let unsafeRejected = false;
    try { await capture(() => mediaCommand(["benchmark", "--project-root", root, "--run-id", runId])); }
    catch (error) { unsafeRejected = error instanceof Error && error.message === "Unsafe private CLI state"; }
    check(unsafeRejected, "benchmark accepted a non-owner-only historical record");
    console.log("PASS media benchmark reports only validated timing and bounded claims");
  } finally {
    await rm(root, { recursive: true });
  }
}

await main();
