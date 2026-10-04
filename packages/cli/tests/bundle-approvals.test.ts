#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { bundleApprovalsCommand } from "../src/bundle-approvals.ts";

const root = "/tmp/approval-fixture";
const input = `${root}/.selfhost/bundles/home/household-bundle.json`;
const approval = `BUNDLE:home:${"a".repeat(64)}`;
const stageApproval = `CLOSE_SETUP:home-immich:${"b".repeat(64)}`;
const calls: string[][] = [];
let invalidReview = false;
let docmostReview = false;
const acceptanceApproval = `ACCEPT-DOCMOST:home-docmost:${"e".repeat(64)}`;
const probes = { media: 0, immich: 0, docmost: 0, vaultwarden: 0 };
const dependencies = Object.fromEntries(Object.keys(probes).map((name) => [name, async () => {
  probes[name as keyof typeof probes] += 1;
  console.log(JSON.stringify({ schemaVersion: 1, service: name, privateCanary: "never-export" }));
}])) as Record<keyof typeof probes, (args: string[]) => Promise<void>>;

async function inspectAdapters(selected: typeof dependencies): Promise<void> {
  const prior = console.log;
  console.log = () => {};
  try {
    for (const name of Object.keys(probes) as Array<keyof typeof probes>) {
      await selected[name](["status", "--project-root", root]);
    }
  } finally {
    console.log = prior;
  }
}

async function command(args: string[], selected = dependencies): Promise<void> {
  calls.push(args);
  if (args[0] === "plan") {
    console.log(JSON.stringify({ kind: "household-bundle-plan", mutation: false,
      bundle: "home", projectRoot: root, input, approval, mediaExposure: "host-only",
      mediaPorts: "automatic", mediaSelection: { mode: "create", runId: "home-media", bind: "127.0.0.1",
        source: "bundle-selection", approvalDigest: null, privateCanary: "never-export" },
      inputFingerprints: {}, secretCanary: "never-export" }));
    return;
  }
  if (args[0] === "status") {
    await inspectAdapters(selected);
    console.log(JSON.stringify({ kind: "household-bundle-status", mutation: false,
      bundle: "home", projectRoot: root, services: [{ service: "immich", phase: "awaiting-setup-closure",
        statusCheck: "returned", incompleteGates: ["direct acceptance"], privateCanary: "never-export" }],
      errors: [], privateHttps: { ready: false, lifecycle: { status: "separate-owner" } } }));
    return;
  }
  if (args[0] === "next") {
    await inspectAdapters(selected);
    assert(args.includes(approval), "next must inspect using the exact current bundle plan token");
    if (docmostReview) {
      console.log(JSON.stringify({ kind: "household-bundle-next", mutation: false, executionPerformed: false,
        bundle: "home", projectRoot: root, next: { checkpoint: "review-docmost-acceptance-plan", service: "docmost",
          apiAcceptance: { status: "planned", project: "home-docmost", runId: "home-docmost",
            replayAllowed: true, evidence: "recorded-api-proof-not-live-recheck", approval: acceptanceApproval },
          command: ["self-host", "bundle", "stage", "--project-root", root, "--input", input,
            "--service", "docmost", "--phase", "accept-plan"] }, deferredGates: ["browser and isolated recovery remain pending"] }));
      return;
    }
    const inspectCommand = ["self-host", "bundle", "homarr-attach", "status", "--project-root", root, "--input", input, "--inspect"];
    if (invalidReview) inspectCommand.push("--approve");
    console.log(JSON.stringify({ kind: "household-bundle-next", mutation: false, executionPerformed: false,
      bundle: "home", projectRoot: root, next: { checkpoint: "review-immich-close-setup", service: "immich",
        homarrAttachments: { observation: "fresh-read-only-attached-prefix", mutation: false, firstUnresolved: "docmost",
          inspectCommand,
          planCommand: ["self-host", "homarr", "attach", "plan", "--input", `${root}/homarr-attach-docmost.json`, "--api-key-file", `${root}/key.env`],
          statusCommand: ["self-host", "homarr", "attach", "status", "--input", `${root}/homarr-attach-docmost.json`, "--api-key-file", `${root}/key.env`],
          nextActionCommand: ["self-host", "homarr", "attach", "plan", "--input", `${root}/homarr-attach-docmost.json`, "--api-key-file", `${root}/key.env`],
          privateCanary: "never-export" },
        command: ["self-host", "bundle", "stage", "--project-root", root, "--input", input,
          "--service", "immich", "--phase", "plan"], afterApproval: "Review before apply" },
      deferredGates: ["browser acceptance remains pending"], secretCanary: "never-export" }));
    return;
  }
  if (args[0] === "stage" && args.includes("accept-plan")) {
    const nonce = "a".repeat(24);
    console.log(JSON.stringify({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-plan", project: "home-docmost",
      runId: "home-docmost", mutation: false, status: "ready-for-approval", attemptConsumed: invalidReview,
      approval: acceptanceApproval, contract: "9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af:accept-v2-mime-charset", nonce,
      digest: "e".repeat(64),
      workspaceId: "01a0e3ca-bf88-76ac-9e0a-98a0a569b57d", spaceId: "01a0e3ca-bf88-76ac-9e0a-98a0a569b57d",
      synthetic: { title: `Self-host acceptance ${nonce}`, fileName: `selfhost-acceptance-${nonce}.txt`,
        byteLength: 65, byteHash: "b".repeat(64), initialHash: "c".repeat(64), editedHash: "d".repeat(64),
        disposition: "retained-for-inspection", privateCanary: "never-export" }, privateCanary: "never-export" }));
    return;
  }
  if (args[0] === "stage" && args.includes("plan")) {
    let kind = "immich-v3.2.2-cli-plan";
    if (invalidReview) kind = "unknown-private-plan";
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, kind, mutation: false,
      runId: "home-immich", compose: { schemaVersion: 1, kind: "selfhost-compose-plan", status: "pass",
        planId: "c".repeat(16), project: { id: "home-immich", dockerContext: "default", ownership: "new",
          privateCanary: "never-export" }, execution: { performed: false }, privateCanary: "never-export",
        claims: { services: [{ id: "immich-server", image: `ghcr.io/immich-app/immich-server:v3.2.2@sha256:${"d".repeat(64)}`,
          environmentValues: "never-export" }], privatePorts: [{ service: "immich-server", hostIp: "127.0.0.1",
            published: 2283, target: 2283, protocol: "tcp", privateCanary: "never-export" }], publicPorts: [],
          secretRefs: [{ value: "never-export" }] } },
      approvals: { closeSetup: stageApproval }, secretCanary: "never-export" })}\n`);
    return;
  }
  throw new Error(`Unexpected command: ${args[0]}`);
}

let output = "";
const previous = console.log;
console.log = (...values: unknown[]) => { output += values.map(String).join(" "); };
try {
  await bundleApprovalsCommand(["--project-root", root, "--input", input], dependencies, command);
} finally {
  console.log = previous;
}
const result = JSON.parse(output);
assert.equal(result.kind, "household-bundle-approvals");
assert.equal(result.mutation, false);
assert.equal(result.executionPerformed, false);
assert.equal(result.bundleApproval, approval);
assert.deepEqual(result.bundleReview.mediaSelection, { mode: "create", runId: "home-media",
  bind: "127.0.0.1", source: "bundle-selection", approvalDigest: null });
assert.equal(result.current.adapterApproval, stageApproval);
assert.equal(result.current.requiresReview, true);
assert.equal(result.current.review.summaryOnly, true);
assert.equal(result.current.review.compose.project.id, "home-immich");
assert.equal(result.current.homarrAttachments.firstUnresolved, "docmost");
assert.equal(result.current.homarrAttachments.planCommand[3], "plan");
assert.equal(result.current.homarrAttachments.statusCommand[3], "status");
assert.deepEqual(result.current.homarrAttachments.inspectCommand,
  ["self-host", "bundle", "homarr-attach", "status", "--project-root", root, "--input", input, "--inspect"]);
assert.equal(JSON.stringify(result.current.homarrAttachments).includes("never-export"), false);
assert.equal(result.current.review.compose.ports[0].hostIp, "127.0.0.1");
assert.equal(result.current.review.compose.services[0].id, "immich-server");
assert.deepEqual(result.current.runAfterReview, ["self-host", "bundle", "run", "--project-root", root,
  "--input", input, "--approve", approval, "--stage-approve", stageApproval]);
assert(!result.current.runAfterReview.includes("--firewall-scope"));
assert.deepEqual(calls.map((args) => args[0]), ["plan", "status", "next", "stage"]);
assert(!output.includes("never-export"), "inbox must whitelist returned fields");
assert(!calls.some((args) => ["apply", "run", "prepare"].includes(args[0])));
assert.deepEqual(probes, { media: 1, immich: 1, docmost: 1, vaultwarden: 1 },
  "one read-only approval inbox must not repeat identical live status probes");

invalidReview = true;
output = "";
console.log = (...values: unknown[]) => { output += values.map(String).join(" "); };
try {
  await bundleApprovalsCommand(["--project-root", root], dependencies, command);
} finally {
  console.log = previous;
}
const invalidResult = JSON.parse(output);
assert.equal(invalidResult.current.homarrAttachments.inspectCommand, null, "inspect recovery must reject extra flags or approval");
assert.equal(invalidResult.current.review, null);
assert.equal(invalidResult.current.runAfterReview, null, "unknown schemas must not produce a runnable approval handoff");
assert.equal(invalidResult.current.requiresReview, true);
assert(!output.includes("never-export"));
assert.deepEqual(probes, { media: 2, immich: 2, docmost: 2, vaultwarden: 2 },
  "a new inbox invocation must obtain new observations rather than reuse an old cache");

docmostReview = true;
invalidReview = false;
output = "";
console.log = (...values: unknown[]) => { output += values.map(String).join(" "); };
try {
  await bundleApprovalsCommand(["--project-root", root], dependencies, command);
} finally { console.log = previous; }
const docmostResult = JSON.parse(output);
assert.equal(docmostResult.current.adapterApproval, acceptanceApproval);
assert.equal(docmostResult.current.review.synthetic.byteLength, 65);
assert.equal(docmostResult.current.review.browserHomarrRestoreAccepted, false);
assert.equal(docmostResult.current.requiresReview, true);
assert.deepEqual(docmostResult.current.runAfterReview, ["self-host", "bundle", "run", "--project-root", root,
  "--input", input, "--approve", approval, "--stage-approve", acceptanceApproval]);
assert(!output.includes("never-export"), "acceptance review must whitelist synthetic facts rather than raw plans");
assert(!calls.some((args) => args.includes("accept-apply") || args.includes("accept-verify")), "inbox mutated or authenticated an acceptance attempt");
invalidReview = true;
output = "";
console.log = (...values: unknown[]) => { output += values.map(String).join(" "); };
try {
  await bundleApprovalsCommand(["--project-root", root], dependencies, command);
} finally { console.log = previous; }
assert.equal(JSON.parse(output).current.runAfterReview, null, "consumed plans must not yield runnable acceptance approval");

let rejected = false;
try {
  await bundleApprovalsCommand(["--project-root", root, "--approve", approval], dependencies, command);
} catch (error) {
  rejected = error instanceof Error && /Invalid or repeated/.test(error.message);
}
assert(rejected, "review inbox must reject supplied approval and mutation flags");
