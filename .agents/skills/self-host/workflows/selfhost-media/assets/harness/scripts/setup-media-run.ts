#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadBoardAccessMetadata, loadSession, validateRunId } from "./lib/session-context.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stages = [
  { id: "up", cmd: ["bash", "scripts/session.sh", "up"] },
  { id: "qbittorrent", cmd: ["bun", "scripts/setup-qbittorrent.ts"] },
  { id: "sonarr", cmd: ["bun", "scripts/setup-sonarr.ts"] },
  { id: "radarr", cmd: ["bun", "scripts/setup-radarr.ts"] },
  { id: "prowlarr", cmd: ["bun", "scripts/setup-prowlarr.ts"] },
  { id: "jellyfin", cmd: ["bun", "scripts/setup-jellyfin.ts"] },
  { id: "seerr", cmd: ["bun", "scripts/setup-seerr.ts"] },
  { id: "homarr", cmd: ["bun", "scripts/setup-homarr.ts"], board: true },
  { id: "homarr-finalize", cmd: ["bash", "scripts/session.sh", "homarr-finalize"], board: true },
  { id: "homarr-widgets", cmd: ["bun", "scripts/prove-homarr-widgets-api.ts"], board: true },
  { id: "homarr-notebook", cmd: ["bash", "scripts/session.sh", "homarr-notebook"], board: true },
  { id: "mcp-config", cmd: ["bash", "scripts/session.sh", "mcp-config"] },
  { id: "mcp-verify", cmd: ["bash", "scripts/session.sh", "mcp-verify"] },
  { id: "verify", cmd: ["bash", "scripts/session.sh", "verify"] },
  { id: "connections", cmd: ["bash", "scripts/session.sh", "connections"] },
  { id: "handoff", cmd: ["bash", "scripts/session.sh", "handoff"] },
];
const deferredIndexerRows = [
  "Prowlarr selected indexer",
  "Sonarr synced indexer edge",
  "Radarr synced indexer edge",
];

function usage() {
  throw new Error("usage: setup-media-run.ts plan | run RUN_ID [BOARD_NAME] --approved [--from STAGE] [--notebook-approve sha256:DIGEST] [--no-handoff] [--defer-indexer]");
}

function stageCommand(stage, runId, boardName, deferIndexer, notebookApproval) {
  if (stage.id === "homarr-notebook") {
    return ["bash", "scripts/session.sh", "homarr-notebook", "apply", runId, boardName, "--approve", notebookApproval];
  }
  const command = [...stage.cmd, runId];
  if (stage.board) command.push(boardName);
  if (stage.id === "verify" && deferIndexer) command.push("--defer-indexer");
  return command;
}

function resumeCommand(runId, boardName, stage, notebookApproval, deferIndexer, noHandoff) {
  const parts = ["bun", "scripts/setup-media-run.ts", "run", runId, boardName,
    "--approved", "--from", stage];
  if (notebookApproval !== null) parts.push("--notebook-approve", notebookApproval);
  if (deferIndexer) parts.push("--defer-indexer");
  if (noHandoff) parts.push("--no-handoff");
  return parts.join(" ");
}

function classifyUpFailure(stderr) {
  if (/all predefined address pools have been fully subnetted/i.test(stderr)) {
    return {
      code: "docker-network-pool-exhausted",
      advice: "Docker's automatic network pools are exhausted. For a new run, review unused private CIDRs and set --media-network-subnets; do not prune other projects."
    };
  }
  if (/port is already allocated|address already in use/i.test(stderr)) {
    return { code: "selected-port-in-use", advice: "A selected host port is occupied. Check this run's ports and existing listeners before retrying." };
  }
  if (/cannot connect to the docker daemon|permission denied while trying to connect to the docker api/i.test(stderr)) {
    return { code: "docker-daemon-unavailable", advice: "Docker is unavailable to this user. Run self-host doctor and check the selected Docker context." };
  }
  return { code: "docker-compose-up-failed", advice: "Docker Compose could not start this exact project. Inspect only this run's Docker state; child output was suppressed." };
}

async function writeRecord(session, record) {
  const path = join(session.sessionDir, "artifacts", `setup-benchmark-${Date.now()}-${randomUUID()}.json`);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

async function main(args) {
  if (args.length === 1 && args[0] === "plan") {
    console.log(JSON.stringify({ stages: stages.map((stage) => stage.id), live: false }, null, 2));
    return;
  }
  if (args[0] !== "run" || !args.includes("--approved")) usage();
  const options = [];
  let requestedStage = null;
  let noHandoff = false;
  let deferIndexer = false;
  let notebookApproval = null;
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--approved") continue;
    if (value === "--no-handoff") { noHandoff = true; continue; }
    if (value === "--defer-indexer") { deferIndexer = true; continue; }
    if (value === "--notebook-approve") {
      notebookApproval = args[index + 1];
      index += 1;
      if (typeof notebookApproval !== "string" || !/^sha256:[0-9a-f]{64}$/.test(notebookApproval)) usage();
      continue;
    }
    if (value === "--from") {
      requestedStage = args[index + 1];
      index += 1;
      continue;
    }
    if (value.startsWith("--")) usage();
    options.push(value);
  }
  if (options.length < 1 || options.length > 2) usage();
  const runId = options[0];
  const boardName = options[1] ?? "personal";
  validateRunId(runId);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(boardName)) throw new Error("invalid board name");
  const selectedStages = noHandoff ? stages.filter((stage) => stage.id !== "handoff") : stages;
  let first = 0;
  if (requestedStage !== null) {
    first = selectedStages.findIndex((stage) => stage.id === requestedStage);
    if (first < 0) throw new Error("unknown resume stage");
  }
  const session = loadSession(runId);
  let pendingAcceptanceRows = [];
  if (deferIndexer) pendingAcceptanceRows = deferredIndexerRows;
  const record = {
    schema: "selfhost-media-setup-benchmark/v1",
    runId,
    boardName,
    startedAt: new Date().toISOString(),
    resumedFrom: first === 0 ? null : selectedStages[first].id,
    credentialHandoffRequested: !noHandoff,
    indexerVerificationDeferred: deferIndexer,
    pendingAcceptanceRows,
    imagePullMs: null,
    browserFallbacks: null,
    benchmarkScope: "Command stages only; manual browser repair outside this invocation is not timed or counted",
    stages: [],
    status: "running",
    technicalAcceptance: false,
  };
  const started = performance.now();
  if (first === 0) console.log("Automated setup is running. Go grab a coffee or do the dishes; this run will stop when it needs a decision.");
  for (const stage of selectedStages.slice(first)) {
    console.log(`Starting ${stage.id}…`);
    const stageStarted = performance.now();
    if (stage.id === "homarr-notebook" && notebookApproval === null) {
      const result = Bun.spawnSync({
        cmd: ["bash", "scripts/session.sh", "homarr-notebook", "plan", runId, boardName],
        cwd: root,
        stdout: "pipe",
        stderr: "ignore",
      });
      let digest = null;
      if (result.exitCode === 0) {
        try {
          const plan = JSON.parse(result.stdout.toString());
          if (plan.status === "planned" && /^sha256:[0-9a-f]{64}$/.test(plan.approvalDigest)) digest = plan.approvalDigest;
        } catch { /* Treat malformed plan output as a failed stage. */ }
      }
      const status = digest === null ? "fail" : "pending";
      record.stages.push({ id: stage.id, status, elapsedMs: Math.round(performance.now() - stageStarted), exitCode: result.exitCode });
      if (digest === null) {
        record.status = "failed";
        record.failedStage = stage.id;
        console.log("FAIL homarr-notebook: the read-only plan could not be verified.");
      } else {
        record.status = "pending-notebook-approval";
        record.notebookApprovalDigest = digest;
        console.log(`PENDING homarr-notebook: review the exact plan with scripts/session.sh homarr-notebook plan ${runId} ${boardName}`);
        console.log(`Resume with: ${resumeCommand(runId, boardName, stage.id, digest, deferIndexer, noHandoff)}`);
      }
      break;
    }
    const command = stageCommand(stage, runId, boardName, deferIndexer, notebookApproval);
    let exitCode = -1;
    let failure = null;
    try {
      let stderrMode = "ignore";
      if (stage.id === "up") stderrMode = "pipe";
      const result = Bun.spawnSync({ cmd: command, cwd: root, stdout: "ignore", stderr: stderrMode });
      exitCode = result.exitCode;
      if (stage.id === "up" && exitCode !== 0) failure = classifyUpFailure(result.stderr.toString());
    } catch {
      // The benchmark still records the stage when a child cannot start.
    }
    const elapsedMs = Math.round(performance.now() - stageStarted);
    let status = "fail";
    if (exitCode === 0) status = "pass";
    if (stage.id === "verify" && deferIndexer && exitCode === 2) status = "pending";
    record.stages.push({ id: stage.id, status, elapsedMs, exitCode });
    if (status === "pending") {
      for (const label of deferredIndexerRows) console.log(`PENDING ${label}`);
    } else {
      console.log(`${status.toUpperCase()} ${stage.id} (${(elapsedMs / 1000).toFixed(1)}s)`);
    }
    if (failure) {
      record.failureCategory = failure.code;
      console.log(`FAIL detail: ${failure.advice}`);
    }
    if (status === "fail") {
      record.status = "failed";
      record.failedStage = stage.id;
      break;
    }
  }
  if (record.status === "running") {
    if (deferIndexer) {
      record.status = "pending-owner-choice";
    } else {
      record.status = "passed";
      record.technicalAcceptance = first === 0;
    }
  }
  record.wallMs = Math.round(performance.now() - started);
  record.finishedAt = new Date().toISOString();
  const path = await writeRecord(session, record);
  console.log(`Benchmark: ${path}`);
  const passedCount = record.stages.filter((stage) => stage.status === "pass").length;
  let setupOutcome = `stopped at ${record.failedStage}`;
  if (record.status === "passed") setupOutcome = "selected stages completed";
  if (record.status === "pending-owner-choice") setupOutcome = "authorized indexer selection and synced edges remain pending owner choice";
  if (record.status === "pending-notebook-approval") setupOutcome = "Homarr recap is awaiting exact plan approval";
  console.log(`Setup summary: ${passedCount}/${selectedStages.length - first} stages passed in this invocation; ${setupOutcome}.`);
  if (record.status === "passed" || record.status === "pending-owner-choice") {
    const board = loadBoardAccessMetadata(session);
    if (board !== null) {
      console.log(`View dashboard: ${board.urls.user ?? board.urls.local}`);
      if (board.urls.user === null) console.log("From another device, use the private tunnel described in the handoff.");
    }
    if (!noHandoff) console.log(`Private credentials and service URLs: ${join(session.sessionDir, "artifacts", "private-handoff.json")}`);
    if (noHandoff) console.log("Private credential export was not requested; run the scoped handoff command only when needed.");
    console.log("Jellyfin plays your library; Seerr takes requests; Sonarr and Radarr organize shows and movies; Prowlarr shares authorized sources; qBittorrent downloads; Homarr brings the services together.");
    console.log("Still to choose separately: an authorized indexer, content sources, remote access, and a tested backup.");
  }
  if (record.status === "pending-owner-choice" || record.status === "pending-notebook-approval") process.exitCode = 2;
  if (record.status === "failed") {
    const failedStage = record.failedStage;
    if (!noHandoff) {
      let handoffExported = false;
      try {
        const handoff = Bun.spawnSync({
          cmd: ["bash", "scripts/session.sh", "handoff", runId],
          cwd: root,
          stdout: "ignore",
          stderr: "ignore",
        });
        handoffExported = handoff.exitCode === 0;
      } catch {
        // Keep the original setup failure as the actionable error.
      }
      if (handoffExported) {
        console.log(`Partial private credentials and available service URLs: ${join(session.sessionDir, "artifacts", "private-handoff.json")}`);
      } else {
        console.error("Private credential export is pending; repair the failed stage, then run the scoped handoff command.");
      }
    }
    if (["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr"].includes(failedStage)) {
      console.error(`Browser takeover: ${join(session.sessionDir, "artifacts", `setup-fallback-${failedStage}.json`)}`);
    }
    if (failedStage === "homarr-notebook") {
      console.error("The board or approval may have changed. Review a fresh Notebook plan before applying it.");
    }
    console.error(`Resume after repair: ${resumeCommand(runId, boardName, failedStage, null, deferIndexer, noHandoff)}`);
    process.exitCode = 1;
  }
}

try {
  await main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "media setup runner failed");
  process.exitCode = 1;
}
