#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-parallel-"));
const directory = join(root, ".selfhost", "bundles", "home");
const input = join(directory, "household-bundle.json");
const ledgerPath = join(directory, "parallel-apply.json");
const report = join(root, "host-report.json");
const network = "autostack-home-media_web";
const immichApproval = `APPLY:home-immich:${"a".repeat(64)}`;
const docmostApproval = `APPLY:home-docmost:${"b".repeat(64)}`;

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function capture(action: () => Promise<void>): Promise<Record<string, any>> {
  const previous = console.log;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.join(" ")}\n`; };
  try {
    await action();
    return JSON.parse(output);
  } finally {
    console.log = previous;
  }
}

function appInput(id: string, port: number, integrationId: string) {
  return {
    project: { dockerContext: "default", id, owner: id, root, directory: join(root, id), ownership: "new" },
    hostIp: "127.0.0.1", publishedPort: port,
    integrationNetwork: { id: integrationId, name: network, owner: "external", internal: true },
  };
}

try {
  await chmod(root, 0o700);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = {
    immich: join(directory, "immich.json"), immichAccount: join(directory, "immich-account.json"),
    docmost: join(directory, "docmost.json"), docmostAccount: join(directory, "docmost-account.json"),
    vaultwarden: join(directory, "vaultwarden.json"), vaultwardenAccount: join(directory, "vaultwarden-account.json"),
    https: join(directory, "vaultwarden-https.json"),
  };
  await privateJson(files.immich, appInput("home-immich", 2283, "homarr"));
  await privateJson(files.docmost, appInput("home-docmost", 3000, "web"));
  for (const path of [files.immichAccount, files.docmostAccount, files.vaultwarden,
    files.vaultwardenAccount, files.https]) await privateJson(path, {});
  await privateJson(input, {
    schemaVersion: 1, id: "home", projectRoot: root,
    services: {
      media: { runId: "home-media", username: "admin", credentialHandoff: true, mode: "create" },
      immich: { input: files.immich, runId: "home-immich", accountFile: files.immichAccount },
      docmost: { input: files.docmost, runId: "home-docmost", accountFile: files.docmostAccount },
      vaultwarden: { input: files.vaultwarden, runId: "home-vault", accountFile: files.vaultwardenAccount, httpsPlan: files.https },
    },
  });
  await privateJson(report, {
    schemaVersion: 1, mode: "read-only", platform: { kernel: { architecture: "x86_64" } },
    identity: { uid: process.getuid?.(), gid: process.getgid?.() },
    runtime: { docker: { state: "running", rootless: { state: "observed", value: false } }, dockerContext: { state: "observed", current: "default" } },
    workloads: { dockerNetworks: { state: "observed", items: [{ name: network }], truncated: false } },
    network: { listeningPorts: { state: "observed", items: [], truncated: false },
      selectedTcpPorts: { state: "observed", complete: true,
        items: [{ port: 2283, inUse: false }, { port: 3000, inUse: false }] } },
  });
  const mediaServices = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"];
  const launched: string[] = [];
  let active = 0;
  let maximumActive = 0;
  let failDocmost = false;
  const dependencies = {
    media: async (args: string[]) => {
      if (args[0] === "benchmark") {
        console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-benchmark", mutation: false, runId: "home-media",
          workflowCompletion: { recorded: true, completed: true, status: "passed", failedStage: null } }));
        return;
      }
      console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-status",
        provenance: "cli-managed", runId: "home-media", composeProject: "autostack-home-media",
        services: mediaServices.map((service) => ({ service, present: true, state: "running", running: true, health: "unavailable" })),
        summary: { expected: 7, present: 7, running: 7, healthy: 0, unhealthy: 0, starting: 0, healthUnavailable: 7 } }));
    },
    immich: async () => console.log(JSON.stringify({ kind: "immich-v3.2.2-cli-plan", status: "pass", approvals: { apply: immichApproval } })),
    docmost: async () => console.log(JSON.stringify({ kind: "docmost-v0.96.0-cli-plan", status: "pass", approval: docmostApproval })),
    vaultwarden: async () => {},
    inspectMediaWeb: async (_context: string, selected: string, project: string) => {
      assert.equal(selected, network);
      assert.equal(project, "autostack-home-media");
    },
    runIsolatedStage: async (args: string[]) => {
      const name = args[args.indexOf("--service") + 1];
      const runningLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
      const currentJob = runningLedger.jobs.find((job: { service: string }) => job.service === name);
      assert.equal(currentJob.status, "launch-attempted");
      launched.push(name);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { ok: name !== "docmost" || !failDocmost };
    },
  };
  const base = ["--project-root", root, "--input", input, "--host-inspection", report];
  const plan = await capture(() => bundleCommand(["parallel-plan", ...base], dependencies));
  assert.equal(plan.kind, "household-bundle-parallel-plan");
  assert.equal(plan.status, "ready-for-review");
  assert.deepEqual(plan.adapterApprovals, { immich: immichApproval, docmost: docmostApproval });
  assert.deepEqual(launched, []);
  const approved = [...base, "--approve", plan.approval,
    "--immich-approve", immichApproval, "--docmost-approve", docmostApproval];
  await assert.rejects(bundleCommand(["parallel-apply", ...base, "--approve", plan.approval,
    "--immich-approve", immichApproval, "--docmost-approve", "wrong"], dependencies), /exact reviewed adapter/);
  assert.deepEqual(launched, []);
  const applied = await capture(() => bundleCommand(["parallel-apply", ...approved], dependencies));
  assert.equal(applied.status, "applied-awaiting-account-setup");
  assert.deepEqual(launched.sort(), ["docmost", "immich"]);
  assert.equal(maximumActive, 2);
  const completedLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.equal((await stat(ledgerPath)).mode & 0o777, 0o600);
  assert.deepEqual(completedLedger.jobs.map((job: { status: string }) => job.status), ["applied", "applied"]);
  await assert.rejects(bundleCommand(["parallel-apply", ...approved], dependencies), /parallel job run is already recorded/);
  // The fake stage above wrote no adapter state; reset only this disposable fixture to exercise another first run.
  await rm(ledgerPath);
  const priorAttempt = join(root, ".selfhost", "docmost", "home-docmost");
  await mkdir(priorAttempt, { recursive: true, mode: 0o700 });
  await assert.rejects(bundleCommand(["parallel-apply", ...approved], dependencies), /adapter-owned state/);
  await rm(priorAttempt, { recursive: true });
  failDocmost = true;
  const partial = await capture(() => bundleCommand(["parallel-apply", ...approved], dependencies));
  assert.equal(partial.status, "partial-needs-inspection");
  assert.deepEqual(partial.results, [
    { service: "immich", status: "applied" }, { service: "docmost", status: "inspect-checkpoint" },
  ]);
  const partialLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.deepEqual(partialLedger.jobs.map((job: { status: string }) => job.status), ["applied", "inspect-checkpoint"]);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  console.log("PASS bundle parallel app preflight, exact approvals, isolated overlap, and partial failure");
} finally {
  await rm(root, { recursive: true, force: true });
}
