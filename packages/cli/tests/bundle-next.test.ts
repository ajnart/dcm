#!/usr/bin/env bun

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function capture(action: () => Promise<void>): Promise<Record<string, any>> {
  const previous = console.log;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.map(String).join(" ")}\n`; };
  try {
    await action();
    return JSON.parse(output);
  } finally {
    console.log = previous;
  }
}

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function mediaStatus(running: boolean) {
  const names = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"];
  let state = "absent";
  let count = 0;
  if (running) {
    state = "running";
    count = 7;
  }
  const services = names.map((service) => ({
    service,
    present: running,
    state,
    running,
    health: "unavailable",
  }));
  return {
    schemaVersion: 1,
    kind: "selfhost-media-status",
    provenance: "cli-managed",
    runId: "home-media",
    composeProject: "autostack-home-media",
    services,
    summary: {
      expected: 7,
      present: count,
      running: count,
      healthy: 0,
      unhealthy: 0,
      starting: 0,
      healthUnavailable: 7,
    },
  };
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-next-"));
try {
  await chmod(root, 0o700);
  const bundleDirectory = join(root, ".selfhost", "bundles", "home");
  await mkdir(bundleDirectory, { recursive: true, mode: 0o700 });
  const files = {
    immichInput: join(root, "immich-input.json"),
    immichAccount: join(root, "immich-account.json"),
    docmostInput: join(root, "docmost-input.json"),
    docmostAccount: join(root, "docmost-account.json"),
    vaultwardenInput: join(root, "vaultwarden-input.json"),
    vaultwardenAccount: join(root, "vaultwarden-account.json"),
    vaultwardenHttps: join(root, "vaultwarden-https.json"),
    localHttpsInput: join(root, "local-https.json"),
    bundle: join(bundleDirectory, "household-bundle.json"),
  };
  for (const path of [files.immichInput, files.immichAccount, files.docmostInput, files.docmostAccount,
    files.vaultwardenAccount, files.localHttpsInput]) {
    await privateJson(path, { fixture: true });
  }
  await privateJson(files.docmostInput, { project: { id: "home-docmost" } });
  await privateJson(files.vaultwardenInput, {
    integrationNetwork: { id: "vaultwarden-route", name: "caddy-home-private", owner: "external" },
  });
  await privateJson(files.vaultwardenHttps, {
    schemaVersion: 1,
    origin: "https://vault.home.arpa",
    exposure: "private",
    routeStatus: "configured",
    routeOwner: "caddy-home",
    tlsOwner: "caddy-home",
    clientCertificateTrust: "verified-for-intended-client",
    backend: { hostIp: "127.0.0.1", publishedPort: 8080 },
  });
  await privateJson(files.bundle, {
    schemaVersion: 1,
    id: "home",
    projectRoot: root,
    services: {
      media: { runId: "home-media", username: "admin", credentialHandoff: true },
      immich: { input: files.immichInput, runId: "home-immich", accountFile: files.immichAccount },
      docmost: { input: files.docmostInput, runId: "home-docmost", accountFile: files.docmostAccount },
      vaultwarden: {
        input: files.vaultwardenInput,
        runId: "home-vault",
        accountFile: files.vaultwardenAccount,
        httpsPlan: files.vaultwardenHttps,
      },
    },
  });

  let runningMedia = false;
  let mediaOutcome: Record<string, unknown> | null = {
    recorded: true, completed: true, status: "passed", failedStage: null,
  };
  let mediaPrepared = true;
  let failMediaApply = false;
  let immichApplied = false;
  let docmostApplied = false;
  let docmostOwnerRecorded = false;
  let vaultwardenBootstrapped = false;
  let vaultwardenSignupEligible = false;
  let vaultwardenSignupAttempted = false;
  let vaultwardenSignupEvidence = true;
  let appliedBundle = false;
  const calls: string[] = [];
  const mediaCalls: string[][] = [];
  const mediaDigest = "a".repeat(64);
  const immichApply = `APPLY:home-immich:${"b".repeat(64)}`;
  const immichBootstrap = `BOOTSTRAP:home-immich:${"b".repeat(64)}`;
  const immichClose = `CLOSE_SETUP:home-immich:${"b".repeat(64)}`;
  const docmostApproval = `APPLY:home-docmost:${"c".repeat(64)}`;
  const docmostOwnerApproval = `OWNER:home-docmost:${"d".repeat(64)}`;
  const docmostAcceptanceApproval = `ACCEPT-DOCMOST:home-docmost:${"e".repeat(64)}`;
  const docmostAcceptanceCalls: string[][] = [];
  let acceptanceStatus = "planned";
  let invalidAcceptanceIdentity = false;
  let invalidAcceptancePlan = false;
  let unavailableAcceptance = false;
  let failAcceptanceApply = false;
  let docmostOwnerMethod = "setup-created";
  const artifactId = "01a0e3ca-bf88-76ac-9e0a-98a0a569b57d";
  function acceptanceObservation() {
    let pageId: string | null = null;
    let attachmentId: string | null = null;
    let recordedAt: string | null = null;
    let lastDurableStage: string | null = null;
    let runId = "home-docmost";
    if (invalidAcceptanceIdentity) runId = "unowned-docmost";
    let verificationRecordedAt: string | null = null;
    if (acceptanceStatus !== "planned") { pageId = artifactId; recordedAt = "2026-09-27T16:00:00Z"; lastDurableStage = "upload-file"; }
    if (["accepted", "verified-readback"].includes(acceptanceStatus)) attachmentId = artifactId;
    if (acceptanceStatus === "accepted") lastDurableStage = "accepted";
    if (acceptanceStatus === "verified-readback") verificationRecordedAt = recordedAt;
    return { schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-status", project: "home-docmost",
      runId, status: acceptanceStatus,
      approval: docmostAcceptanceApproval, evidence: "recorded-api-proof-not-live-recheck", interruptedTail: false,
      replayAllowed: acceptanceStatus === "planned", verified: acceptanceStatus === "verified-readback",
      pageId, attachmentId, recordedAt, lastDurableStage,
      verificationRecordedAt, privateCanary: "never-export" };
  }
  const dependencies = {
    media: async (args: string[]) => {
      calls.push(`media:${args[0]}`);
      mediaCalls.push([...args]);
      if (args[0] === "lifecycle-check" && !appliedBundle) throw new Error("not applied");
      if (args[0] === "status") console.log(JSON.stringify(mediaStatus(runningMedia)));
      if (args[0] === "benchmark" && mediaOutcome !== null) console.log(JSON.stringify({
        schemaVersion: 1, kind: "selfhost-media-benchmark", mutation: false, runId: "home-media",
        workflowCompletion: mediaOutcome,
      }));
      if (args[0] === "info" && mediaPrepared) {
        console.log(JSON.stringify({ runId: "home-media", approvalDigest: mediaDigest, approved: false, bind: "0.0.0.0" }));
      }
      if (args[0] === "prepare") mediaPrepared = true;
      if (args[0] === "apply") {
        if (!args.includes("--firewall-scope") || !args.includes("router-private")) {
          throw new Error("missing confirmed private media firewall scope");
        }
        if (failMediaApply) throw new Error("synthetic adapter failure with private detail");
        runningMedia = true;
      }
    },
    immich: async (args: string[]) => {
      calls.push(`immich:${args[0]}`);
      if (args[0] === "lifecycle-check" && !appliedBundle) throw new Error("not applied");
      if (args[0] === "status") {
        if (immichApplied) console.log(JSON.stringify({ status: "observed", initialized: true, setupEnabled: false }));
        else console.log(JSON.stringify({ status: "planned", initialized: null, accepted: false }));
      }
      if (args[0] === "plan") {
        console.log(JSON.stringify({ approvals: { apply: immichApply, bootstrap: immichBootstrap, closeSetup: immichClose } }));
      }
    },
    docmost: async (args: string[]) => {
      if (args[0] === "accept") {
        docmostAcceptanceCalls.push([...args]);
        if (args[1] === "status" && unavailableAcceptance) throw new Error("missing managed workspace identity");
        if (args[1] === "apply") {
          acceptanceStatus = "accepted";
          if (failAcceptanceApply) {
            acceptanceStatus = "unknown-no-replay";
            process.exitCode = 1;
            console.log(JSON.stringify({ status: "unknown-no-replay", privateCanary: "private acceptance failure" }));
            return;
          }
        }
        if (args[1] === "status") console.log(JSON.stringify(acceptanceObservation()));
        else console.log(JSON.stringify({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-plan", project: "home-docmost",
          runId: "home-docmost", status: "ready-for-approval", mutation: false, attemptConsumed: invalidAcceptancePlan,
          contract: "9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af:accept-v2-mime-charset", digest: "e".repeat(64),
          approval: docmostAcceptanceApproval, action: args[1] }));
        return;
      }
      let call = `docmost:${args[0]}`;
      if (args[1] === "plan") call += ":plan";
      calls.push(call);
      if (args[0] === "lifecycle-check" && !appliedBundle) throw new Error("not applied");
      if (args[0] === "status") {
        let checkpoint = null;
        if (docmostApplied) checkpoint = { recorded: true };
        console.log(JSON.stringify({ schemaVersion: 1, kind: "docmost-cli-status", project: "home-docmost", runId: "home-docmost", health: docmostApplied, checkpoint,
          owner: { recorded: docmostOwnerRecorded, method: docmostOwnerMethod, freshLogin: docmostOwnerRecorded } }));
      }
      if (args[0] === "plan") console.log(JSON.stringify({ approval: docmostApproval }));
      if (args[0] === "owner" && args[1] === "plan") {
        console.log(JSON.stringify({ approval: docmostOwnerApproval }));
      }
      if (args[0] === "owner" && args[1] === "apply") {
        docmostOwnerRecorded = true;
        console.log(JSON.stringify({ status: "owner-recorded" }));
      }
    },
    vaultwarden: async (args: string[]) => {
      calls.push(`vaultwarden:${args[0]}`);
      if (args[0] === "status" && vaultwardenBootstrapped) {
        console.log(JSON.stringify({ bootstrap: { applied: true },
          accountBootstrap: { evidenceRecorded: vaultwardenSignupEvidence, boundedSignupEligible: vaultwardenSignupEligible,
            attemptRecorded: vaultwardenSignupAttempted }, registrationClosure: { applied: false } }));
      }
      if (args[0] === "lifecycle-check" && !appliedBundle) throw new Error("not applied");
      if (args[0] === "local-https" && args[1] === "status") {
        console.log(JSON.stringify({
          schemaVersion: 1,
          kind: "vaultwarden-local-https-status",
          project: "caddy-home",
          runId: "caddy-home",
          origin: "https://vault.home.arpa",
          integrationNetwork: { id: "vaultwarden-route", name: "caddy-home-private", owner: "caddy-home" },
          access: { scope: "host-only", public: false },
          applied: true,
          checkpoint: { recorded: true },
        }));
      }
    },
  };

  const plan = await capture(() => bundleCommand(["plan", "--project-root", root, "--input", files.bundle], dependencies));
  calls.length = 0;
  const runWithoutApproval = await capture(() => bundleCommand(["run", "--project-root", root,
    "--input", files.bundle], dependencies));
  check(runWithoutApproval.kind === "household-bundle-run" && runWithoutApproval.status === "approval-required"
    && runWithoutApproval.executionPerformed === false && runWithoutApproval.next.checkpoint === "review-bundle-plan",
  "bundle run crossed the bundle approval checkpoint");
  check(!calls.some((call) => call.endsWith(":apply") || call.endsWith(":prepare")),
    "bundle run mutated an adapter without approval");

  mediaPrepared = false;
  calls.length = 0;
  const runPreparedMedia = await capture(() => bundleCommand(["run", "--project-root", root,
    "--input", files.bundle, "--approve", plan.approval], dependencies));
  check(runPreparedMedia.status === "approval-required" && runPreparedMedia.steps.length === 1
    && runPreparedMedia.steps[0].checkpoint === "prepare-media-plan"
    && runPreparedMedia.next.checkpoint === "review-media-plan",
  "bundle run did not advance a bundle-approved safe preparation stage");
  check(calls.includes("media:prepare") && !calls.includes("media:apply"),
    "bundle run crossed the media adapter approval after preparation");

  const missingFirewallScope = await capture(() => bundleCommand(["run", "--project-root", root,
    "--input", files.bundle, "--approve", plan.approval, "--stage-approve", mediaDigest], dependencies));
  check(missingFirewallScope.status === "manual-checkpoint"
    && missingFirewallScope.next.checkpoint === "confirm-media-firewall-scope"
    && missingFirewallScope.executionPerformed === false,
  "bundle run crossed the private firewall scope checkpoint");

  failMediaApply = true;
  const failedMedia = await capture(() => bundleCommand(["run", "--project-root", root,
    "--input", files.bundle, "--approve", plan.approval, "--stage-approve", mediaDigest,
    "--firewall-scope", "router-private"], dependencies));
  check(failedMedia.status === "stage-failed" && failedMedia.steps[0].checkpoint === "apply-or-resume-media"
    && failedMedia.diagnosis.safeReason === "adapter-status-error"
    && failedMedia.diagnosis.failedStageCommand.includes("--stage-approve")
    && failedMedia.diagnosis.doNotRetryForDiagnosis === true
    && JSON.stringify(failedMedia.diagnosis.command) === JSON.stringify(["self-host", "bundle", "stage",
      "--project-root", root, "--input", files.bundle, "--service", "media", "--phase", "status"])
    && !failedMedia.diagnosis.command.includes("--stage-approve")
    && !JSON.stringify(failedMedia).includes("synthetic adapter failure with private detail"),
  "bundle run did not provide a safe targeted failure handoff");
  failMediaApply = false;

  runningMedia = true;
  for (const outcome of [
    { recorded: true, completed: false, status: "failed", failedStage: "homarr" },
    { recorded: true, completed: false, status: "incomplete", failedStage: null },
    { recorded: true, completed: "true", status: "passed", failedStage: null },
    null,
  ]) {
    mediaOutcome = outcome;
    calls.length = 0;
    const blocked = await capture(() => bundleCommand(["run", "--project-root", root,
      "--input", files.bundle, "--approve", plan.approval], dependencies));
    let expectedCheckpoint = "inspect-media-workflow-outcome";
    let expectedAction = "benchmark";
    if (outcome?.status === "failed") {
      expectedCheckpoint = "diagnose-failed-media-workflow";
      expectedAction = "diagnose";
    }
    check(blocked.status === "manual-checkpoint" && blocked.next.checkpoint === expectedCheckpoint
      && blocked.next.command[3] === expectedAction && blocked.executionPerformed === false
      && !calls.some((call) => call.endsWith(":apply") || call.endsWith(":prepare") || call.endsWith(":resume")),
    "running media with failed, incomplete, malformed or legacy missing outcome replayed setup or advanced");
  }
  mediaOutcome = { recorded: true, completed: true, status: "pending-owner-choice", failedStage: null };
  const pendingMedia = await capture(() => bundleCommand(["next", "--project-root", root,
    "--input", files.bundle, "--approve", plan.approval], dependencies));
  check(pendingMedia.next.checkpoint === "review-immich-apply"
    && pendingMedia.deferredGates.some((value: string) => value.includes("not current graph or full acceptance")),
  "intentional pending media workflow did not advance with its acceptance boundary visible");
  mediaOutcome = { recorded: true, completed: true, status: "passed", failedStage: null };
  runningMedia = false;

  calls.length = 0;
  const runApprovedMedia = await capture(() => bundleCommand(["run", "--project-root", root,
    "--input", files.bundle, "--approve", plan.approval, "--stage-approve", mediaDigest,
    "--firewall-scope", "router-private"], dependencies));
  check(runApprovedMedia.status === "approval-required" && runApprovedMedia.steps.length === 1
    && runApprovedMedia.steps[0].checkpoint === "apply-or-resume-media"
    && runApprovedMedia.next.checkpoint === "review-immich-apply",
  "bundle run did not advance exactly one approved adapter stage to the next approval");
  check(runApprovedMedia.resume.stageApprovalConsumed === true
    && !runApprovedMedia.resume.command.includes("--stage-approve"),
  "bundle run carried one adapter approval into the next adapter");
  check(calls.includes("media:apply") && !calls.includes("immich:apply"),
    "bundle run crossed into an unapproved adapter mutation");
  runningMedia = false;

  mediaCalls.length = 0;
  await bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "media", "--phase", "apply", "--approve", plan.approval,
    "--stage-approve", mediaDigest, "--firewall-scope", "router-private", "--defer-indexer"], dependencies);
  check(mediaCalls.length === 1 && mediaCalls[0].at(-1) === "--defer-indexer",
    "bundle media apply did not forward explicit indexer deferral");
  mediaCalls.length = 0;
  await bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "media", "--phase", "resume", "--approve", plan.approval,
    "--stage-approve", mediaDigest, "--from", "verify", "--defer-indexer"], dependencies);
  check(mediaCalls.length === 1 && mediaCalls[0].includes("--from") && mediaCalls[0].at(-1) === "--defer-indexer",
    "bundle media resume did not forward explicit indexer deferral");
  let rejectedDefer = false;
  try {
    await bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
      "--service", "media", "--phase", "prepare", "--approve", plan.approval, "--defer-indexer"], dependencies);
  } catch (error) {
    rejectedDefer = error instanceof Error && /media apply or resume/.test(error.message);
  }
  check(rejectedDefer, "bundle accepted indexer deferral outside media apply or resume");
  runningMedia = false;
  mediaCalls.length = 0;
  const deferredNext = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", mediaDigest,
    "--firewall-scope", "router-private", "--defer-indexer"], dependencies));
  check(deferredNext.next.checkpoint === "apply-or-resume-media"
    && deferredNext.next.command.at(-1) === "--defer-indexer",
  "bundle next did not retain explicit indexer deferral on the approved media apply command");
  const deferredRun = await capture(() => bundleCommand(["run", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", mediaDigest,
    "--firewall-scope", "router-private", "--defer-indexer"], dependencies));
  check(deferredRun.steps[0]?.checkpoint === "apply-or-resume-media"
    && mediaCalls.some((args) => args[0] === "apply" && args.at(-1) === "--defer-indexer")
    && !deferredRun.resume.command.includes("--defer-indexer"),
  "bundle run did not consume indexer deferral only at the approved media apply stage");
  runningMedia = false;

  calls.length = 0;
  const review = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle], dependencies));
  check(review.mutation === false && review.executionPerformed === false
    && review.next.checkpoint === "review-bundle-plan" && review.next.command[2] === "plan",
  "bundle next did not stop at exact bundle review without approval");
  check(calls.includes("media:status") && calls.includes("immich:status") && calls.includes("docmost:status"),
    "bundle next did not inspect every available adapter before selecting a checkpoint");

  calls.length = 0;
  const mediaApply = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", mediaDigest,
    "--firewall-scope", "router-private"], dependencies));
  check(mediaApply.next.checkpoint === "apply-or-resume-media"
    && mediaApply.next.command.includes(mediaDigest)
    && mediaApply.next.command.includes("router-private"), "bundle next did not validate the frozen media digest and firewall scope");
  check(!calls.some((call) => call.endsWith(":apply") || call.endsWith(":prepare") || call.endsWith(":bootstrap")),
    "bundle next executed a mutating adapter command");

  runningMedia = true;
  calls.length = 0;
  const immichReview = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(immichReview.next.checkpoint === "review-immich-apply"
    && immichReview.next.command.at(-1) === "plan", "bundle next skipped the Immich adapter approval review");
  const immichNext = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", immichApply], dependencies));
  check(immichNext.next.checkpoint === "apply-immich" && immichNext.next.command.includes(immichApply),
    "bundle next did not return the exact approved Immich command");

  immichApplied = true;
  docmostApplied = true;
  const ownerReview = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(ownerReview.next.checkpoint === "review-docmost-owner-plan"
    && ownerReview.next.command.includes("owner-plan"),
  "bundle next did not stop at the separate Docmost owner approval");
  const ownerApply = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", docmostOwnerApproval], dependencies));
  check(ownerApply.next.checkpoint === "apply-docmost-owner"
    && ownerApply.next.command.includes(docmostOwnerApproval),
  "bundle next did not return the exact approved Docmost owner command");
  calls.length = 0;
  await capture(() => bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "docmost", "--phase", "owner-plan"], dependencies));
  check(calls.includes("docmost:owner:plan"), "bundle stage did not delegate the Docmost owner plan");
  calls.length = 0;
  await capture(() => bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "docmost", "--phase", "owner-apply", "--approve", plan.approval,
    "--stage-approve", docmostOwnerApproval], dependencies));
  check(calls.includes("docmost:owner"), "bundle stage did not delegate the approved Docmost owner apply");

  const acceptanceReview = await capture(() => bundleCommand(["run", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(acceptanceReview.next.checkpoint === "review-docmost-acceptance-plan"
    && acceptanceReview.executionPerformed === false && !docmostAcceptanceCalls.some((args) => args[1] === "apply"),
  "unapproved acceptance was not stopped at its exact plan");
  invalidAcceptanceIdentity = true;
  const foreignAcceptance = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", docmostAcceptanceApproval], dependencies));
  check(foreignAcceptance.next.checkpoint === "inspect-docmost-acceptance-status", "foreign acceptance identity was trusted");
  invalidAcceptanceIdentity = false;
  invalidAcceptancePlan = true;
  const invalidPlan = await capture(() => bundleCommand(["run", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", docmostAcceptanceApproval], dependencies));
  check(invalidPlan.next.checkpoint === "review-docmost-acceptance-plan" && invalidPlan.executionPerformed === false,
    "a consumed or invalid plan crossed the exact ready-plan gate");
  invalidAcceptancePlan = false;
  docmostOwnerMethod = "existing-owner-login";
  const existingOwnerAcceptance = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(existingOwnerAcceptance.next.checkpoint === "prepare-vaultwarden-plan"
    && existingOwnerAcceptance.optionalAppChecks.docmost.planCommand.includes("accept-plan")
    && existingOwnerAcceptance.deferredGates.some((entry: string) => entry.includes("existing-owner API acceptance is optional")),
    "existing workspace blocked independent app stages or received an automatic write plan");
  unavailableAcceptance = true;
  const unsupportedAcceptance = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(unsupportedAcceptance.next.checkpoint === "prepare-vaultwarden-plan"
    && unsupportedAcceptance.optionalAppChecks.docmost.statusCommand.includes("accept-status")
    && unsupportedAcceptance.optionalAppChecks.docmost.browserFallback.includes("protected Docmost browser"),
    "existing-owner null workspace made unsupported API acceptance mandatory");
  const consumedMarker = join(root, ".selfhost", "docmost", "home-docmost", "acceptance-attempt.jsonl");
  await mkdir(join(root, ".selfhost", "docmost", "home-docmost"), { recursive: true, mode: 0o700 });
  await privateJson(consumedMarker, { fixture: "consumed-marker-metadata-only" });
  const unavailableConsumed = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(unavailableConsumed.next.checkpoint === "inspect-docmost-acceptance-status"
    && unavailableConsumed.optionalAppChecks.docmost === null,
    "unavailable status bypassed a known consumed attempt marker");
  await rm(consumedMarker);
  docmostOwnerMethod = "setup-created";
  const missingNewWorkspace = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(missingNewWorkspace.next.checkpoint === "inspect-docmost-acceptance-status"
    && missingNewWorkspace.optionalAppChecks.docmost === null, "invalid new-owner acceptance status bypassed its gate");
  unavailableAcceptance = false;
  docmostOwnerMethod = "existing-owner-login";
  acceptanceStatus = "unknown-no-replay";
  const consumedExistingOwner = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(consumedExistingOwner.next.checkpoint === "reconcile-docmost-acceptance" && consumedExistingOwner.next.command === null,
    "known consumed existing-owner attempt bypassed no-replay reconciliation");
  acceptanceStatus = "planned";
  docmostOwnerMethod = "setup-created";
  failAcceptanceApply = true;
  const failedAcceptance = await capture(() => bundleCommand(["run", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", docmostAcceptanceApproval], dependencies));
  check(failedAcceptance.status === "stage-failed" && failedAcceptance.diagnosis.command.includes("accept-status")
    && failedAcceptance.diagnosis.doNotRetryForDiagnosis === true && !JSON.stringify(failedAcceptance).includes("private acceptance failure"),
  "acceptance failure was not diagnosed with safe read-only acceptance status");
  const applyCount = docmostAcceptanceCalls.filter((args) => args[1] === "apply").length;
  const unknownAcceptance = await capture(() => bundleCommand(["run", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", docmostAcceptanceApproval], dependencies));
  check(unknownAcceptance.next.checkpoint === "reconcile-docmost-acceptance" && unknownAcceptance.next.command === null
    && unknownAcceptance.next.verifyCommand.includes("accept-verify") && unknownAcceptance.executionPerformed === false
    && docmostAcceptanceCalls.filter((args) => args[1] === "apply").length === applyCount
    && !docmostAcceptanceCalls.some((args) => args[1] === "verify"), `unknown acceptance replayed or automatically logged in: ${unknownAcceptance.next.checkpoint}`);
  failAcceptanceApply = false;
  acceptanceStatus = "planned"; // Disposable adapter stub only; no real consumed run is reset.
  docmostAcceptanceCalls.length = 0;
  const acceptedRun = await capture(() => bundleCommand(["run", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--stage-approve", docmostAcceptanceApproval], dependencies));
  check(acceptedRun.steps.filter((step: Record<string, any>) => step.checkpoint === "apply-docmost-acceptance").length === 1
    && acceptedRun.resume.stageApprovalConsumed === true && !acceptedRun.resume.command.includes("--stage-approve")
    && docmostAcceptanceCalls.filter((args) => args[1] === "apply").length === 1,
  "acceptance approval did not authorize exactly one consumed write stage");
  acceptanceStatus = "verified-readback";
  const apiStatus = await capture(() => bundleCommand(["status", "--project-root", root, "--input", files.bundle], dependencies));
  const docmostApiStatus = apiStatus.services.find((entry: Record<string, any>) => entry.service === "docmost");
  check(docmostApiStatus.observations.apiAcceptance.status === "verified-readback"
    && docmostApiStatus.observations.accepted === false && apiStatus.recovery.status === "not-verified"
    && apiStatus.recovery.dataProtectionVerified === false
    && docmostApiStatus.incompleteGates.includes("browser-client login and editor rendering")
    && !JSON.stringify(apiStatus).includes("never-export"), "recorded API proof erased non-API gates or leaked raw output");
  acceptanceStatus = "planned";
  docmostAcceptanceCalls.length = 0;

  await capture(() => bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "docmost", "--phase", "accept-plan"], dependencies));
  check(docmostAcceptanceCalls[0]?.[1] === "plan"
    && docmostAcceptanceCalls[0].includes(files.docmostAccount)
    && !docmostAcceptanceCalls[0].includes("--approve"),
  "bundle did not delegate the read-only acceptance plan with its exact account reference");
  let rejectedAcceptance = false;
  try {
    await bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
      "--service", "docmost", "--phase", "accept-apply", "--stage-approve", docmostAcceptanceApproval], dependencies);
  } catch (error) {
    rejectedAcceptance = error instanceof Error && /unchanged bundle plan/.test(error.message);
  }
  check(rejectedAcceptance && docmostAcceptanceCalls.length === 1,
    "Docmost acceptance mutation crossed an unapproved bundle boundary");
  await capture(() => bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "docmost", "--phase", "accept-apply", "--approve", plan.approval,
    "--stage-approve", docmostAcceptanceApproval], dependencies));
  check(docmostAcceptanceCalls.at(-1)?.[1] === "apply" && docmostAcceptanceCalls.at(-1)!.includes(docmostAcceptanceApproval),
    "bundle did not preserve the separate exact Docmost acceptance token");
  await capture(() => bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "docmost", "--phase", "accept-status"], dependencies));
  check(docmostAcceptanceCalls.at(-1)?.[1] === "status" && !docmostAcceptanceCalls.at(-1)!.includes("--account-file"),
    "acceptance status received account payload or incorrect action");
  await capture(() => bundleCommand(["stage", "--project-root", root, "--input", files.bundle,
    "--service", "docmost", "--phase", "accept-verify"], dependencies));
  check(docmostAcceptanceCalls.at(-1)?.[1] === "verify" && docmostAcceptanceCalls.at(-1)!.includes(files.docmostAccount)
    && !docmostAcceptanceCalls.at(-1)!.includes("--approve"),
    "read-only app reconciliation did not retain its private account reference or required an app-write approval");

  docmostOwnerRecorded = true;
  await privateJson(files.vaultwardenHttps, {
    schemaVersion: 1,
    origin: "https://vault.home.arpa",
    exposure: "private",
    routeStatus: "pending",
    routeOwner: "caddy-home",
    tlsOwner: "caddy-home",
    clientCertificateTrust: "pending",
    backend: { hostIp: "127.0.0.1", publishedPort: 8080 },
  });
  const pendingHttpsPlan = await capture(() => bundleCommand(["plan", "--project-root", root,
    "--input", files.bundle], dependencies));
  const manualHttps = await capture(() => bundleCommand(["run", "--project-root", root,
    "--input", files.bundle, "--approve", pendingHttpsPlan.approval], dependencies));
  check(manualHttps.status === "manual-checkpoint" && manualHttps.executionPerformed === false
    && manualHttps.next.checkpoint === "verify-vaultwarden-private-https",
  "bundle run crossed or hid the manual private-HTTPS checkpoint");
  await privateJson(files.vaultwardenHttps, {
    schemaVersion: 1,
    origin: "https://vault.home.arpa",
    exposure: "private",
    routeStatus: "configured",
    routeOwner: "caddy-home",
    tlsOwner: "caddy-home",
    clientCertificateTrust: "verified-for-intended-client",
    backend: { hostIp: "127.0.0.1", publishedPort: 8080 },
  });
  const browserBlock = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(browserBlock.next.checkpoint === "prepare-vaultwarden-plan"
    && browserBlock.deferredGates.some((entry: string) => entry.includes("browser login/editor rendering")),
  "bundle next did not keep Docmost acceptance explicit after the owner checkpoint");
  check(!calls.some((call) => call.includes("browser")), "bundle next attempted a browser action");
  vaultwardenBootstrapped = true;
  await mkdir(join(root, ".selfhost", "vaultwarden", "home-vault"), { recursive: true });
  const loginCheckpoint = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(loginCheckpoint.next.loginCommand.join(" ") ===
    `self-host browser login --project-root ${root} --run-id home-vault --service vaultwarden --origin https://vault.home.arpa`,
  "bundle next did not return the exact bounded private login command");
  check(loginCheckpoint.next.docmostAcceptancePlanCommand.includes("accept-plan")
    && loginCheckpoint.next.docmostAcceptanceStatusCommand.includes("accept-status")
    && loginCheckpoint.next.docmostAcceptanceVerifyCommand.includes("accept-verify"),
  "Vaultwarden account checkpoint hid independently usable Docmost acceptance commands");
  const homarrSession = join(root, ".selfhost", "media-harness", ".sessions", "home-media");
  await mkdir(homarrSession, { recursive: true, mode: 0o700 });
  await privateJson(join(homarrSession, "connections.env"), { fixture: "owner key stays private" });
  for (const id of ["immich", "docmost", "vaultwarden"]) {
    await privateJson(join(bundleDirectory, `homarr-attach-${id}.json`), { homarr: { boardName: "personal" }, service: { id } });
  }
  const attachmentCalls: string[][] = [];
  const homarrAttach = async (args: string[]) => {
    attachmentCalls.push(args);
    const source = args[args.indexOf("--input") + 1];
    let status = "attached";
    if (source.endsWith("homarr-attach-docmost.json")) status = "needs-attachment";
    console.log(JSON.stringify({ status, mutation: false, board: { id: "board-1", name: "personal", private: true },
      appId: "app-1", tileId: "tile-1", notebookId: "note-1", additionalNotebookId: "note-2",
      integrationVerified: false, serviceRuntimeVerified: false }));
  };
  const attachedPrefix = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], { ...dependencies, homarrAttach }));
  check(attachedPrefix.next.checkpoint === loginCheckpoint.next.checkpoint
    && JSON.stringify(attachedPrefix.next.loginCommand) === JSON.stringify(loginCheckpoint.next.loginCommand)
    && attachedPrefix.next.homarrAttachments.firstUnresolved === "docmost"
    && attachedPrefix.next.homarrAttachments.planCommand.includes(join(bundleDirectory, "homarr-attach-docmost.json"))
    && attachmentCalls.length === 2 && attachmentCalls.every((args) => args[0] === "status"),
  "late attachment guidance hid Vaultwarden authority, failed to skip a fresh attached prefix, or mutated Homarr");
  vaultwardenSignupEvidence = false;
  vaultwardenSignupEligible = true;
  const eligibleSignup = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(eligibleSignup.next.signupPlanCommandTemplate.includes("ABSOLUTE_BROWSER_EXECUTABLE")
    && eligibleSignup.next.signupPlanCommandTemplate.includes("PUBLIC_ROOT_CERTIFICATE")
    && eligibleSignup.next.loginCommand === undefined && eligibleSignup.next.command === null,
  "eligible new Vaultwarden did not retain its separate exact signup plan and approval");
  vaultwardenSignupAttempted = true;
  const attemptedSignup = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(attemptedSignup.next.signupPlanCommandTemplate === undefined && attemptedSignup.next.loginCommand === undefined
    && attemptedSignup.next.signupStatusCommand.includes("status") && attemptedSignup.next.reason.includes("Never repeat signup"),
  "attempted Vaultwarden offered signup replay or a misleading fixed-session login");

  runningMedia = false;
  appliedBundle = true;
  const routeCheckpoint = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval], dependencies));
  check(routeCheckpoint.next.checkpoint === "restart-applied-bundle-with-route-owner"
    && routeCheckpoint.next.command === null && routeCheckpoint.next.reason.includes("caddy-home"),
  "bundle next treated a stopped applied bundle as a fresh apply or hid the route owner");
  const restart = await capture(() => bundleCommand(["next", "--project-root", root, "--input", files.bundle,
    "--approve", plan.approval, "--local-https-input", files.localHttpsInput,
    "--local-https-run-id", "caddy-home"], dependencies));
  check(restart.next.checkpoint === "restart-applied-bundle" && restart.next.command[2] === "up"
    && restart.next.command.includes(files.localHttpsInput),
  "bundle next did not return the exact safe restart after adapter and route preflight");

  console.log("PASS bundle next/run preserve exact approval, resume, and manual gates");
} finally {
  await rm(root, { recursive: true, force: true });
}
