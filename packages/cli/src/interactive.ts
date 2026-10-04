import { spawn, spawnSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { cancel, confirm, intro, isCancel, multiselect, note, outro, password, select, spinner, text } from "@clack/prompts";
import { householdAdoptedAllInterfaceKey, householdAppPortSet, householdBeginArgs, householdCatalogSupported, householdFullReviewArgs, householdMediaWebHandoff, householdParallelAdapterReview, householdParallelGraphSupported, householdParallelPlan, householdParallelPorts, householdPortCandidates, householdPortSet, householdReviewRunArgs, reviewedExistingMedia, reviewedHouseholdPlan, reviewedMediaWebHostReport, unavailableHouseholdPorts, type AdoptedMediaSelection, type HouseholdChoices, type HouseholdPorts } from "./interactive-household.ts";
import { localCaddyOrigins, localCaddySelection, reviewedCaddyInputs, reviewedHttpsReady,
  reviewedPrivateCaddyApply, reviewedPrivateCaddyPlan, reviewedPrivateCaddyPrepared,
  reviewedPrivateCaddyStatus, reviewedVaultwardenRoute,
  type CaddyInputsReview, type LocalCaddySelection } from "./interactive-caddy.ts";
import { bundledCatalogPlan, bundledRecipeChoices, bundledSharedRecipeChoices, installActions, mediaCatalogSupported,
  plannedAppCommands, reviewedRecipePlan, type RecipeChoice } from "./interactive-catalog.ts";
import { installPlanSupported } from "./catalog-gate.ts";
import { reviewedMediaPlan, type MediaPlan } from "./interactive-media-plan.ts";
import { immichHomarrPermissions } from "./immich-accept.ts";
import { savedAppIds } from "./lib/app-state-discovery.ts";
import { uptimeSelfMonitorConfig, uptimeSelfMonitorUrl,
  uptimeSelfMonitorVersion } from "./lib/uptime-onboarding-api.ts";
import { createControlPanel } from "./control-panel/flow.ts";
import { inspectFirstRunSetup, runFirstRunSetups } from "./control-panel/setup-engine.ts";
import { continueSharedGoal } from "./control-panel/shared-goal.ts";
import { loadProjectSnapshot } from "./control-panel/project-snapshot.ts";
import { addSharedProjectApps, createSharedProject, runSharedFirstRun, runSharedHomarr } from "./control-panel/shared-create.ts";

type Envelope = { status: string; data?: Record<string, unknown>; summary?: string; limitations?: string[] };
type Goal = { id: string; name: string; summary: string };
type Role = { id: string; name: string; required: boolean; selected: string | null; alternatives: string[]; purpose: string };
type Service = { name: string; purpose: string };

/** Render only fixed messages from the shared owner's typed failure contract. */
export function sharedProjectFailure(value: unknown, action: string): string | null {
  if (!["remove", "add"].includes(action) || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const failure = value as { schemaVersion?: unknown; command?: unknown; status?: unknown;
    mutation?: unknown; partialWritePossible?: unknown; error?: { code?: unknown } };
  let expectedMutation: boolean | null = false;
  if (failure.partialWritePossible === true) expectedMutation = null;
  if (failure.schemaVersion !== 1 || failure.command !== `app shared ${action}` || failure.status !== "failed"
    || typeof failure.partialWritePossible !== "boolean"
    || failure.mutation !== expectedMutation) return null;
  if (failure.partialWritePossible) {
    return "The shared-project change may be partial. Inspect self-host app shared status and its original Compose resources before retrying. No later step was run.";
  }
  if (action === "remove" && failure.error?.code === "shared-remove-dependency") {
    return "Removal is blocked by a retained app dependency or saved connection history. Review that dependency or link's retirement first. No containers were changed.";
  }
  if (action === "remove" && failure.error?.code === "shared-remove-last-app") {
    return "Stop the project instead; removing the final app and retiring its owner is not implemented. No containers were changed.";
  }
  if (action === "add" && failure.error?.code === "shared-reinstall-required") {
    return "This app's previous data and credentials are retained, but safe reinstallation is not yet supported. Nothing was added.";
  }
  return null;
}

function cliInvocation(args: string[]): { command: string; argv: string[]; env: NodeJS.ProcessEnv } {
  if (typeof Bun !== "undefined" && Bun.isStandaloneExecutable) {
    const env = { ...process.env };
    // The asset loader needs Bun mode, but child CLI commands must re-enter the executable.
    delete env.BUN_BE_BUN;
    return { command: process.execPath, argv: args, env };
  }
  return { command: process.execPath, argv: [process.argv[1], ...args], env: process.env };
}

function samePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
  }
  return left === right;
}

function stopIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Stopped here. Earlier approved changes remain; use Resume a project to inspect them.");
    process.exit(0);
  }
  return value as T;
}

function invoke(args: string[]): Envelope {
  const { command, argv, env } = cliInvocation([...args, "--json"]);
  const result = spawnSync(command, argv, {
    encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env,
  });
  if (result.error) throw new Error(`The planner could not start: ${result.error.message}`);
  let response: Envelope;
  try {
    response = JSON.parse(result.stdout) as Envelope;
  } catch {
    throw new Error(`The planner returned invalid JSON: ${result.stderr.trim().slice(0, 300)}`);
  }
  if (result.status !== 0 || response.status !== "pass") {
    throw new Error(response.summary || response.limitations?.join("; ") || result.stderr.trim() || "The planner stopped.");
  }
  return response;
}

function runCli(args: string[]) {
  const { command, argv, env } = cliInvocation(args);
  const result = spawnSync(command, argv, {
    encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env,
  });
  if (result.error) throw new Error(`The CLI could not start: ${result.error.message}`);
  return result;
}

async function readOnlyCliJson(args: string[], signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new Error("The background check was cancelled");
  const { command, argv, env } = cliInvocation(args);
  return new Promise((resolveRead, rejectRead) => {
    const child = spawn(command, argv, {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env, timeout: 45000, signal,
    });
    let stdout = "";
    let oversized = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 4 * 1024 * 1024) {
        oversized = true;
        child.kill();
        return;
      }
      stdout += chunk;
    });
    // App diagnostics can contain private details. Do not echo subprocess stderr.
    child.stderr.resume();
    child.once("error", rejectRead);
    child.once("close", (code) => {
      if (oversized || code !== 0) {
        rejectRead(new Error("The saved app check was unavailable"));
        return;
      }
      try { resolveRead(JSON.parse(stdout)); }
      catch { rejectRead(new Error("The saved app check returned invalid JSON")); }
    });
  });
}

async function backgroundAppCliJson(args: string[]): Promise<unknown> {
  const { command, argv, env } = cliInvocation(args);
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, argv, {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env, timeout: 180000,
    });
    let stdout = "";
    let oversized = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 4 * 1024 * 1024) {
        oversized = true;
        child.kill();
        return;
      }
      stdout += chunk;
    });
    // First-run output may contain private details; never print raw stderr or stdout.
    child.stderr.resume();
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (oversized || code !== 0) {
        rejectRun(new Error("The approved first-run step stopped; inspect this exact app checkpoint before retrying"));
        return;
      }
      try { resolveRun(JSON.parse(stdout)); }
      catch { rejectRun(new Error("The first-run step returned an invalid checkpoint")); }
    });
  });
}

function showSavedAppRecap(root: string, appId: string): void {
  let summary = "";
  let liveChecked = false;
  try {
    const result = runCli(["app", "info", "--id", appId, "--project-root", root, "--live"]);
    if (result.status === 0) {
      summary = result.stdout.trim();
      liveChecked = true;
    }
  } catch { /* A recap failure does not undo an already applied app. */ }
  if (!liveChecked) {
    try {
      const saved = runCli(["app", "info", "--id", appId, "--project-root", root]);
      if (saved.status === 0) summary = saved.stdout.trim();
    } catch { /* Keep the exact saved-project recovery command below. */ }
  }
  if (!summary) {
    note(`The recap could not be read. Run self-host app info --id ${appId} --project-root ${root} before restarting this project.`, "Recap unavailable");
    return;
  }
  note(summary, "Saved app and restart");
  if (!liveChecked) note(`Current runtime could not be checked. Run self-host app status --id ${appId} --project-root ${root} --live before treating the app as running.`, "Runtime unverified");
}

async function runJsonCli(args: string[], progress: string, acceptedNonzeroKind?: string,
  secretStdin?: string): Promise<Record<string, unknown>> {
  if (secretStdin !== undefined && Buffer.byteLength(secretStdin) > 4096) {
    throw new Error("Private CLI input exceeded its review limit.");
  }
  const activity = spinner();
  activity.start(progress);
  try {
    const output = await new Promise<{ code: number; stdout: string }>((resolveRun, rejectRun) => {
      const { command, argv, env } = cliInvocation(args);
      const child = spawn(command, argv, {
        stdio: [secretStdin === undefined ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true, env,
      });
      if (secretStdin !== undefined) {
        if (!child.stdin) {
          rejectRun(new Error("The CLI did not open its private input channel."));
          child.kill();
          return;
        }
        child.stdin.on("error", () => { /* The child failure is reported through its bounded JSON result. */ });
        child.stdin.end(secretStdin);
      }
      let stdout = "";
      let oversized = false;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > 4 * 1024 * 1024) {
          oversized = true;
          return;
        }
        stdout += chunk;
      });
      // Drain stderr, but never display raw adapter output: it can contain credentials.
      child.stderr.resume();
      child.once("error", rejectRun);
      child.once("close", (code) => {
        if (oversized) {
          rejectRun(new Error("The CLI output exceeded its review limit. Inspect this project before retrying."));
          return;
        }
        resolveRun({ code: code ?? 1, stdout });
      });
    });
    if (output.code !== 0) {
      if (acceptedNonzeroKind) {
        try {
          const partial = JSON.parse(output.stdout);
          if (partial && typeof partial === "object" && !Array.isArray(partial)
            && partial.kind === acceptedNonzeroKind) return partial as Record<string, unknown>;
        } catch { /* The ordinary stopped-checkpoint message remains authoritative. */ }
      }
      if (args[0] === "bundle" && args[1] === "begin") {
        throw new Error("Household preparation stopped. Run self-host doctor --scope media and inspect the chosen project before retrying; begin never overwrites a partial run.");
      }
      if (args[0] === "inspect-host") {
        throw new Error("The host could not check the proposed ports. No household plan was created.");
      }
      if (args[0] === "install" && args[1] === "media") {
        throw new Error(`The existing media ${args[2]} check failed. Run self-host install media ${args[2]} for this project and resolve its reported issue before extension.`);
      }
      if (args[0] === "app") {
        const action = args[1];
        let reason = "";
        try {
          const failure = JSON.parse(output.stdout) as { command?: unknown; status?: unknown;
            error?: { code?: unknown } };
          let expectedCommand = `app ${action}`;
          if (action === "batch" || action === "shared") expectedCommand = `app ${action} ${String(args[2] ?? "")}`;
          if (action === "shared") {
            const message = sharedProjectFailure(failure, String(args[2] ?? ""));
            if (message) reason = message;
          }
          if (failure.command === expectedCommand && failure.status === "failed"
            && typeof failure.error?.code === "string"
            && /^[a-z0-9-]{1,64}$/.test(failure.error.code)
            && !["app-rejected", "unexpected"].includes(failure.error.code) && !reason) {
            reason = ` (${failure.error.code.replaceAll("-", " ")})`;
          }
        } catch { /* An older CLI may not return structured app failures. */ }
        if (action === "shared") {
          if (reason && !reason.startsWith(" (")) throw new Error(reason);
          throw new Error(`The shared-project step stopped${reason}. Inspect self-host app shared status for this exact root/project and its original Compose resources before retrying. No later step was run.`);
        }
        if (action === "batch") {
          if (args[2] === "apply" || args[2] === "resume") {
            if (args[2] === "resume") {
              throw new Error(`The approved pending batch job stopped${reason}. It may have launched. Run self-host app batch status for this exact project, inspect that app's exact status, and never batch-replay an attempted job.`);
            }
            throw new Error(`The approved app batch stopped${reason}. Some jobs may have started. Run self-host app batch status for this exact project, then inspect each attempted app; do not replay the batch apply.`);
          }
          throw new Error(`The app batch ${String(args[2] ?? "check")} stopped${reason}. Inspect this project's saved catalog, app states, and private batch history before retrying.`);
        }
        if (action === "image" || action === "plan") {
          throw new Error(`The app ${action} check stopped${reason} before app apply. Run self-host doctor --scope media, then rerun that exact app ${action} command outside the menu for its diagnostic. Check the image registry, selected port, Docker context, and local data path. No later app step was run.`);
        }
        if (action === "status") {
          throw new Error("The saved app checkpoint could not be read. Check the exact project root and owner-only .selfhost state before retrying.");
        }
        if (action === "handoff") {
          throw new Error("The private app handoff is unavailable. Inspect the exact app status and its saved credential-file path; no secret was printed.");
        }
        if (action === "homarr-input" || action === "homarr-uptime-input"
          || action === "homarr-immich-input" || action === "homarr-paperless-input") {
          throw new Error("Homarr input preparation stopped. An owner-only input or slug file may have been created; inspect those exact files before rerunning. No app container or Homarr board was changed.");
        }
        if (action === "homarr-immich-key-create") {
          throw new Error("Immich key creation stopped. A key may exist even if its one-time secret was not saved. Inspect the exact app status and Immich key inventory; do not retry a blind create.");
        }
        throw new Error(`The app ${action} step stopped${reason} and may have left a partial checkpoint. Inspect self-host app status for this exact project and its recorded resources before deciding whether to resume. No later app step was run.`);
      }
      if (args[0] === "homarr" && args[1] === "attach") {
        if (args[2] === "apply" || ((args[2] === "uptime-kuma" || args[2] === "immich" || args[2] === "paperless")
          && args[3] === "apply")) {
          throw new Error("Homarr attachment may have partially changed the board. Run the exact homarr attach status command with the saved input and key file; inspect before a new plan or approval.");
        }
        throw new Error("Homarr board inspection stopped. The selected app project was not changed; inspect the private board, API key permissions, and exact attach input before retrying.");
      }
      if (args[0] === "homarr" && args[1] === "mcp") {
        let step = "unknown step";
        let partialWritePossible = false;
        try {
          const failure = JSON.parse(output.stdout) as { error?: { step?: unknown }; partialWritePossible?: unknown };
          if (typeof failure.error?.step === "string" && /^[a-z0-9-]{1,64}$/.test(failure.error.step)) {
            step = failure.error.step.replaceAll("-", " ");
          }
          partialWritePossible = failure.partialWritePossible === true;
        } catch { /* Keep the bounded recovery message. */ }
        const boundary = partialWritePossible ? "A private profile or fragment may have been written. " : "No write was reported. ";
        throw new Error(`Homarr MCP ${String(args[2] ?? "step")} stopped at ${step}. ${boundary}Inspect homarr mcp status for this exact profile before retrying; no client configuration was installed.`);
      }
      throw new Error("The CLI stopped at a recorded checkpoint. Inspect bundle approvals and its diagnosis command before retrying.");
    }
    let value: unknown;
    try { value = JSON.parse(output.stdout); }
    catch { throw new Error("The CLI did not return one reviewable JSON result. Inspect bundle approvals before retrying."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The CLI returned an invalid review result.");
    }
    return value as Record<string, unknown>;
  } finally {
    activity.stop("CLI step ended");
  }
}

async function chooseIsolatedHouseholdPorts(): Promise<HouseholdPorts> {
  const tried = new Set<number>();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const start = randomInt(20000, 44984);
    if (tried.has(start)) continue;
    tried.add(start);
    const ports = householdPortCandidates(start);
    const selected = householdPortSet(ports);
    if (selected.includes(28443)) continue;
    const args = ["inspect-host", "--skip-docker", "--limit", "10"];
    for (const port of selected) args.push("--check-tcp-port", String(port));
    const report = await runJsonCli(args, "Checking ten isolated household ports");
    if (unavailableHouseholdPorts(report, selected).length === 0) return ports;
  }
  throw new Error("Could not find ten available isolated ports after bounded checks. Inspect host listeners and choose exact ports with bundle begin.");
}

async function chooseIsolatedAppPorts(): Promise<Pick<HouseholdPorts, "immich" | "docmost" | "vaultwarden">> {
  const tried = new Set<number>();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const start = randomInt(20000, 44984);
    if (tried.has(start)) continue;
    tried.add(start);
    const ports = householdPortCandidates(start);
    const selected = householdAppPortSet(ports);
    if (selected.includes(28443)) continue;
    const args = ["inspect-host", "--skip-docker", "--limit", "3"];
    for (const port of selected) args.push("--check-tcp-port", String(port));
    const report = await runJsonCli(args, "Checking three new app ports");
    if (unavailableHouseholdPorts(report, selected).length === 0) {
      return { immich: ports.immich, docmost: ports.docmost, vaultwarden: ports.vaultwarden };
    }
  }
  throw new Error("Could not find three available app ports after bounded checks. Inspect host listeners and choose exact ports with bundle begin.");
}

async function inspectExistingMedia(root: string): Promise<AdoptedMediaSelection> {
  const config = runCli(["config", "show", "--project-root", root]);
  if (config.status !== 0) throw new Error("The existing CLI media config could not be read. Inspect this project before extension.");
  let parsed: unknown;
  try { parsed = JSON.parse(config.stdout); }
  catch { throw new Error("The existing CLI media config is invalid. Inspect this project before extension."); }
  const candidate = parsed as { runId?: unknown };
  if (!candidate || typeof candidate.runId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(candidate.runId)) {
    throw new Error("The existing CLI media run ID is invalid. Inspect this project before extension.");
  }
  const info = await runJsonCli(["install", "media", "info", "--project-root", root,
    "--run-id", candidate.runId, "--json", "yes"], "Reading the existing media plan");
  const status = await runJsonCli(["install", "media", "status", "--project-root", root,
    "--run-id", candidate.runId, "--json", "yes"], "Checking seven existing media services");
  return reviewedExistingMedia(parsed, info, status, root);
}

async function runLive(args: string[]): Promise<number> {
  return new Promise((resolveRun, rejectRun) => {
    const { command, argv, env } = cliInvocation(args);
    const child = spawn(command, argv, { stdio: "inherit", windowsHide: true, env });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun(code ?? 1));
  });
}

async function privateProjectDirectory(path: string): Promise<boolean> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o700 || !samePath(await realpath(path), path)
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error(`Saved project directory is not owner-only and real: ${path}`);
  }
  return true;
}

async function privateProjectFile(path: string): Promise<boolean> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || !samePath(await realpath(path), path)
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error(`Saved project marker is not an owner-only regular file: ${path}`);
  }
  return true;
}

async function savedJourneyIds(root: string, includeFinished = false): Promise<string[]> {
  const journeys = join(root, ".selfhost", "journeys");
  if (!await privateProjectDirectory(journeys)) return [];
  const entries = await readdir(journeys, { withFileTypes: true });
  if (entries.length > 64) throw new Error("Too many household journeys to review");
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-z0-9][a-z0-9_-]{0,39}\.json$/.test(entry.name)) continue;
    const id = entry.name.slice(0, -5);
    const path = join(journeys, entry.name);
    if (!await privateProjectFile(path) || (await lstat(path)).size > 16 * 1024) continue;
    let value: unknown;
    try { value = JSON.parse(await readFile(path, "utf8")); }
    catch { continue; }
    const journal = value as { kind?: unknown; projectRoot?: unknown;
      bundleId?: unknown; state?: unknown } | null;
    if (journal?.kind === "household-full-journey" && journal.projectRoot === root
      && journal.bundleId === id && (journal.state === "active"
        || (includeFinished && journal.state === "finished"))) ids.push(id);
  }
  return ids.sort();
}

async function hasSavedBundleOrJourney(root: string): Promise<boolean> {
  const local = join(root, ".selfhost");
  if (!await privateProjectDirectory(local)) return false;
  const bundles = join(local, "bundles");
  if (await privateProjectDirectory(bundles)) {
    const entries = await readdir(bundles, { withFileTypes: true });
    if (entries.length > 64) throw new Error("Too many household bundle directories to review");
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(entry.name)) continue;
      const directory = join(bundles, entry.name);
      if (await privateProjectDirectory(directory)
        && await privateProjectFile(join(directory, "household-bundle.json"))) return true;
    }
  }
  return (await savedJourneyIds(root, true)).length > 0;
}

async function chooseRoot(createIfMissing: boolean, requireExplicit = false): Promise<string> {
  const currentRoot = resolve(process.cwd());
  const hasCurrentProject = existsSync(join(currentRoot, ".selfhost", "project.json"))
    || existsSync(join(currentRoot, ".selfhost", "cli.json"))
    || existsSync(join(currentRoot, ".selfhost", "stack.json"))
    || (await savedAppIds(currentRoot)).length > 0
    || await privateProjectFile(join(currentRoot, ".selfhost", "app-batch.json"))
    || await hasSavedBundleOrJourney(currentRoot);
  let initialValue = join(homedir(), ".selfhostedskills");
  if (hasCurrentProject) initialValue = currentRoot;
  if (requireExplicit) initialValue = "";
  let message = "Where should this project live?";
  let placeholder = `${initialValue} (press Enter to use)`;
  if (requireExplicit) {
    message = "Where should the new project live?";
    placeholder = "Enter a new absolute project directory";
  }
  const input = stopIfCancelled(await text({
    message,
    placeholder,
    validate(value) {
      if (requireExplicit && !value) return "Enter a new absolute project directory.";
      const chosen = value || initialValue;
      if (!isAbsolute(chosen) || /[\u0000-\u001f\u007f]/.test(chosen)) return "Enter a clean absolute directory path.";
      const candidate = resolve(chosen);
      if (candidate === parse(candidate).root || candidate === resolve(homedir())) {
        return "Choose a project directory, not a drive root or your home directory.";
      }
    },
  }));
  const chosen = input || initialValue;
  const root = resolve(chosen);
  if (!samePath(root, chosen)) throw new Error("Choose a canonical absolute path without . or .. segments.");
  if (!existsSync(root)) {
    if (!createIfMissing) throw new Error(`No project exists at ${root}. Choose a saved project directory.`);
    const create = stopIfCancelled(await confirm({
      message: `Create ${root}?`, initialValue: false,
    }));
    if (!create) throw new Error("No project directory was created.");
    if (!samePath(await realpath(dirname(root)), dirname(root))) throw new Error("Project parent contains a symlink.");
    await mkdir(root, { mode: 0o700 });
  }
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(await realpath(root), root)) {
    throw new Error("The project path must be a real, canonical directory.");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o002) !== 0) {
    throw new Error("The project directory cannot be world-writable.");
  }
  return root;
}

function componentArgs(goals: string[], apps: string[]): string[] {
  const args: string[] = [];
  for (const goal of goals) args.push("--goal", goal);
  for (const app of apps) args.push("--app", app);
  if (goals.length + apps.length > 1) args.push("--compose");
  return args;
}

function catalogArgs(directory?: string): string[] {
  return directory ? ["--catalog-dir", directory] : [];
}

function savedCatalogDirectory(root: string): string | undefined {
  if (!existsSync(join(root, ".selfhost", "project.json"))) return undefined;
  const result = runCli(["state", "status", "--project-root", root, "--json"]);
  if (result.status !== 0) throw new Error("The saved project catalog could not be loaded. Inspect state status before changing this project.");
  let response: Envelope;
  try { response = JSON.parse(result.stdout); }
  catch { throw new Error("The saved project status was invalid. No catalog selection was changed."); }
  if (response.status !== "pass") throw new Error("The saved project status was not ready for planning.");
  const state = response.data?.state as { schemaVersion?: number; catalogSource?: { kind?: string; directory?: string } } | undefined;
  const source = state?.catalogSource;
  if (source?.kind === "external" && typeof source.directory === "string") return source.directory;
  if (source?.kind === "bundled") return undefined;
  if (state?.schemaVersion === 1 || state?.schemaVersion === 2) {
    note("This older project uses the bundled catalog. Saving a revised plan will record its current source.", "Project upgrade");
    return undefined;
  }
  throw new Error("The saved project has an unknown catalog source. Inspect state status before changing it.");
}

async function chooseCatalogDirectory(root?: string, preferred?: string | null): Promise<string | undefined> {
  if (root && existsSync(join(root, ".selfhost", "project.json"))) {
    const saved = savedCatalogDirectory(root);
    if (preferred !== undefined && (preferred === null ? saved !== undefined : !saved || !samePath(preferred, saved))) {
      throw new Error("This project uses a different catalog source. Choose a new project directory to change sources.");
    }
    if (saved) note(`Using the catalog saved with this project: ${saved}`, "Catalog source");
    return saved;
  }
  if (preferred) return preferred;
  const custom = stopIfCancelled(await confirm({
    message: "Use an external app catalog for planning?", initialValue: false,
  }));
  if (!custom) return undefined;
  const input = stopIfCancelled(await text({
    message: "Absolute path to the external catalog directory",
    validate(value) {
      if (!value || !isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) return "Enter a clean absolute directory path.";
      if (!samePath(resolve(value), value)) return "Enter a canonical path without . or .. segments.";
    },
  }));
  return input;
}

function planArgs(goals: string[], apps: string[], root: string, selections: string[], directory?: string): string[] {
  const args = ["plan", ...componentArgs(goals, apps), "--project-root", root];
  args.push(...catalogArgs(directory));
  for (const selection of selections) args.push("--select", selection);
  return args;
}

function showPlan(data: Record<string, unknown>) {
  const source = data.catalogSource as { kind?: string; directory?: string } | undefined;
  if (source?.kind === "external") {
    note(`Source: ${source.directory ?? "unknown"}\nThis catalog can be planned and saved, but its installers are not yet supported.`, "External catalog");
  }
  const summary = data.summary as { services?: Service[]; currentHost?: string } | undefined;
  const services = summary?.services ?? [];
  const lines = services.map((service) => `${service.name}: ${service.purpose}`);
  note(lines.join("\n") || "No services selected.", "Selected services");
  const stages = data.setupStages as Array<{ id: string; note: string }> | undefined;
  if (stages?.length) {
    note(stages.map((stage) => `${stage.id}: ${stage.note}`).join("\n"), "Setup stages");
  }
  const workflow = data.workflow as {
    jobs?: Array<{ id: string; owner: string; needs: string[]; gates: string[]; apps: string[] }>;
    parallelGroups?: Array<{ needs: string[]; jobs: string[] }>;
  } | undefined;
  if (Array.isArray(workflow?.jobs) && workflow.jobs.length) {
    const gates = new Map([
      ["fresh-host-inspection", "inspect the current host"],
      ["exact-apply-approval", "approve the exact apply"],
      ["homarr-onboarded", "finish Homarr onboarding"],
      ["media-web-network-bound", "inspect and bind the media web network"],
      ["app-running-on-homarr-bridge", "confirm apps run on Homarr's bridge"],
      ["private-https-before-signup", "verify private HTTPS before signup"],
      ["first-account-before-registration-closure", "create the first account before closing registration"],
    ]);
    const jobs = workflow.jobs.map((job) => {
      if (!job || typeof job !== "object" || typeof job.id !== "string" || typeof job.owner !== "string"
        || !Array.isArray(job.needs) || !Array.isArray(job.gates) || !Array.isArray(job.apps)
        || [...job.needs, ...job.gates, ...job.apps].some((value) => typeof value !== "string")) {
        throw new Error("The planner returned an incomplete job graph. No setup was approved.");
      }
      const needs = job.needs.length ? job.needs.join(", ") : "none";
      const requirements = job.gates.map((gate) => gates.get(gate) ?? gate).join("; ") || "none recorded";
      const apps = job.apps.length ? ` (${job.apps.join(", ")})` : "";
      return `${job.id}${apps} — owner: ${job.owner}\n  After: ${needs}\n  Before running: ${requirements}`;
    });
    note(`${jobs.join("\n\n")}\n\nThis is a read-only order of work, not approval to run it.`, "Planned jobs");
  } else if (stages?.length) {
    note("The planner did not return a job graph. Review the owning workflow before setup; no automatic job is approved.",
      "Job graph unavailable");
  }
  if (workflow?.parallelGroups?.length) {
    const groups = workflow.parallelGroups.map((group) => {
      const prerequisite = group.needs.length ? `after ${group.needs.join(" + ")}` : "after host inspection";
      return `${group.jobs.join(" + ")} (${prerequisite})`;
    });
    note(`${groups.join("\n")}\nCandidates only: bind shared networks and approve each job before running it.`, "Parallel job groups");
  }
  note(`Host: ${summary?.currentHost ?? "not inspected"}\nNo containers were started. Planning is not installation.`, "Current status");
}

async function configureRoles(data: Record<string, unknown>, showChoicesDirectly = false): Promise<string[]> {
  const roles = (data.roles ?? []) as Role[];
  if (!showChoicesDirectly) {
    const change = stopIfCancelled(await confirm({
      message: "Change any optional or alternative services?", initialValue: false,
    }));
    if (!change) return [];
  }
  const selections: string[] = [];
  for (const role of roles) {
    const alternatives = role.alternatives ?? [];
    if (role.required && alternatives.length === 0) continue;
    const choices = [role.selected, ...alternatives].filter((value): value is string => Boolean(value));
    const options = [...new Set(choices)].map((value) => ({ value, label: value }));
    if (!role.required) options.push({ value: "off", label: "Off" });
    if (options.length < 2) continue;
    let message = `${role.name} — ${role.purpose}`;
    if (showChoicesDirectly && role.id === "control-plane") {
      message = "Include Homarr? A supported one-app recipe can set it up first, with separate approval and onboarding.";
    }
    const selected = stopIfCancelled(await select({
      message,
      options,
      initialValue: role.selected ?? "off",
    }));
    if (selected !== (role.selected ?? "off")) selections.push(`${role.id}=${selected}`);
  }
  return selections;
}

async function chooseAdditionalApps(existing: string[], directory?: string): Promise<string[]> {
  const selected = [...existing];
  while (true) {
    const add = stopIfCancelled(await confirm({
      message: "Add a specific app to this plan?", initialValue: false,
    }));
    if (!add) return selected;
    const query = stopIfCancelled(await text({
      message: "Search the app catalog", placeholder: "e.g. docmost or uptime kuma",
    }));
    if (!query.trim()) continue;
    const result = invoke(["catalog", "search", query.trim(), ...catalogArgs(directory)]);
    const matches = (result.data?.results ?? []) as Array<{ app: { id: string; name: string; support: { automation: string } } }>;
    const visible = matches.filter(({ app }) => !selected.includes(app.id) && app.support.automation !== "retired").slice(0, 10);
    if (visible.length === 0) {
      note("No new app matched. Try another search or finish this selection.", "Catalog search");
      continue;
    }
    const chosen = stopIfCancelled(await select({
      message: "Which app should this plan include?",
      options: visible.map(({ app }) => ({ value: app.id, label: app.name, hint: app.support.automation })),
    }));
    selected.push(chosen);
  }
}

async function planFlow(appSelection?: string, preferredDirectory?: string | null, existingRoot?: string) {
  const root = existingRoot ?? await chooseRoot(true);
  const directory = await chooseCatalogDirectory(root, preferredDirectory);
  let goals: string[] = [];
  if (appSelection) {
    const addGoals = stopIfCancelled(await confirm({
      message: "Add one or more broader goals alongside this app?", initialValue: false,
    }));
    if (addGoals) {
      const menu = invoke(["catalog", "menu", ...catalogArgs(directory)]);
      const available = (menu.data?.goals ?? []) as Goal[];
      goals = stopIfCancelled(await multiselect({
        message: "Choose the goals to combine with this app.",
        options: available.map((goal) => ({ value: goal.id, label: goal.name, hint: goal.summary })),
        required: true,
      }));
    }
  } else {
    const menu = invoke(["catalog", "menu", ...catalogArgs(directory)]);
    const available = (menu.data?.goals ?? []) as Goal[];
    goals = stopIfCancelled(await multiselect({
      message: "What do you want to self-host? Select one or more goals.",
      options: available.map((goal) => ({ value: goal.id, label: goal.name, hint: goal.summary })),
      required: true,
    }));
  }
  const apps = await chooseAdditionalApps(appSelection ? [appSelection] : [], directory);
  let selections: string[] = [];
  let plan = invoke(planArgs(goals, apps, root, selections, directory));
  if (!plan.data) throw new Error("The planner did not return a plan.");
  selections = await configureRoles(plan.data, goals.length === 0 && apps.length === 1);
  if (selections.length) plan = invoke(planArgs(goals, apps, root, selections, directory));
  if (!plan.data) throw new Error("The planner did not return a plan.");
  showPlan(plan.data);
  if (process.platform === "linux" && bundledCatalogPlan(plan.data)) {
    const snapshot = await loadProjectSnapshot(root, readOnlyCliJson);
    const recipes = bundledSharedRecipeChoices(invoke(["catalog", "recipes"]).data ?? {},
      invoke(["catalog", "list"]).data?.apps);
    const dependencies = { invoke, runJsonCli, stopIfCancelled, offerHomarrMcp };
    await continueSharedGoal(plan.data, recipes, snapshot, {
      chooseProject: async (projects) => stopIfCancelled(await select({
        message: "Which existing shared project should this goal extend?",
        options: projects.map((item) => ({ value: item.id, label: item.id })),
      })),
      review: async (selection) => {
        note(`Apps: ${selection.composeApps.join(", ")}\nRetain: ${selection.retained.join(", ") || "none"}\n`
          + `Add: ${selection.missing.join(", ") || "none"}\n`
          + `Bundled services: ${selection.coveredDependencies.map((item) => `${item.appId} within ${item.requiredBy}/${item.serviceId}`).join(", ") || "none"}`,
        "Goal uses one shared Compose project");
        const setup = stopIfCancelled(await confirm({ message: "Review the shared project setup now?", initialValue: true }));
        if (!setup) outro("Plan only. No service was installed or changed.");
        return setup;
      },
      blocked: (details) => {
        note(details.join("\n"), "Goal setup needs a decision");
        outro("No new owner was created. Keep this goal pending until its exact owner or coverage is resolved.");
      },
      resume: resumeFlow,
      create: (root, apps) => createSharedProject(root, dependencies, apps),
      add: (root, project, apps) => addSharedProjectApps(root, project.id, project.apps, dependencies, apps, false),
      setup: (root, id, apps) => runSharedFirstRun(root, id, apps, dependencies),
      homarr: (root, id, apps) => runSharedHomarr(root, id, apps, dependencies),
    });
    return;
  }
  const save = stopIfCancelled(await confirm({
    message: "Remember these non-secret choices in this project?", initialValue: false,
  }));
  if (save) {
    const action = existsSync(join(root, ".selfhost", "project.json")) ? "revise" : "init";
    const args = ["state", action, ...componentArgs(goals, apps), "--project-root", root, ...catalogArgs(directory)];
    for (const selection of selections) args.push("--select", selection);
    invoke(args);
    plan = invoke(planArgs(goals, apps, root, selections, directory));
    if (!plan.data) throw new Error("The saved project could not be replanned; no installer was started.");
    note(`${action === "revise" ? "Revised" : "Saved"} non-secret choices in ${root}. No services were installed.`, "Saved");
  }
  if (!bundledCatalogPlan(plan.data)) {
    outro("This catalog source is external or differs from saved project state. Review or revise the project before using a fixed installer.");
    return;
  }
  if (goals.length === 1 && goals[0] === "personal-media" && apps.length === 0 && selections.length === 0) {
    outro("Next: choose Install personal media from this menu, or run self-host doctor --scope media on your Linux Docker host.");
    return;
  }
  if (selections.length === 0 && householdCatalogSupported(plan.data)) {
    const prepare = stopIfCancelled(await confirm({
      message: "Prepare this household bundle now? No containers will start.", initialValue: false,
    }));
    if (prepare) await installHouseholdFlow(root, plan.data);
    else outro("Plan only. Choose Set up a household bundle later to prepare this stack.");
    return;
  }
  const stages = plan.data.setupStages;
  const selectedApps = plan.data.selectedApps;
  const appOnlyPlan = goals.length === 0 && apps.length === 1
    && Array.isArray(stages) && stages.length === 1
    && stages[0]?.id === `app-${apps[0]}`
    && stages[0]?.owner === "selfhost-compose"
    && Array.isArray(stages[0]?.apps) && stages[0].apps.includes(apps[0])
    && Array.isArray(selectedApps)
    && selectedApps.some((app) => app && typeof app === "object" && app.id === apps[0])
    && !selectedApps.some((app) => app && typeof app === "object" && app.id === "homarr");
  if (appOnlyPlan && process.platform === "linux") {
    let choices: RecipeChoice[] = [];
    try {
      const recipes = invoke(["catalog", "recipes"]);
      choices = bundledRecipeChoices(recipes.data ?? {});
    } catch {
      note("The bundled recipe list could not be reviewed. This remains a plan; no app setup will start.", "Recipe unavailable");
    }
    if (choices.some((choice) => choice.appId === apps[0])) {
      const continueSetup = stopIfCancelled(await confirm({
        message: `Continue from this plan to the reviewed ${apps[0]} app setup?`, initialValue: true,
      }));
      if (continueSetup) {
        await installRecipeFlow(choices, apps[0], root, false);
        return;
      }
    }
  }
  const homarrAndOneApp = goals.length === 0 && apps.length === 1 && Array.isArray(selectedApps)
    && selectedApps.some((app) => app && typeof app === "object" && app.id === "homarr")
    && selectedApps.some((app) => app && typeof app === "object" && app.id === apps[0])
    && selectedApps.every((app) => app && typeof app === "object"
      && (app.id === apps[0] || app.id === "homarr"));
  if (homarrAndOneApp && process.platform === "linux") {
    let choices: RecipeChoice[] = [];
    try {
      const recipes = invoke(["catalog", "recipes"]);
      choices = bundledRecipeChoices(recipes.data ?? {});
    } catch {
      note("The bundled recipe list could not be reviewed. No app setup will start.", "Recipe unavailable");
    }
    if (choices.some((choice) => choice.appId === apps[0])
      && choices.some((choice) => choice.appId === "homarr")) {
      const continueSetup = stopIfCancelled(await confirm({
        message: `Continue into separately approved Homarr and ${apps[0]} setup?`, initialValue: true,
      }));
      if (continueSetup) {
        await installRecipeFlow(choices, apps[0], root, true);
        return;
      }
    }
    outro("Plan only. No Homarr or app container was started.");
    return;
  }
  const selectedIds = Array.isArray(selectedApps)
    ? selectedApps.map((app) => app && typeof app === "object" ? app.id : null) : [];
  const exactBatchApps = goals.length === 0 && apps.length >= 2 && apps.length <= 8
    && !selectedIds.includes("homarr") && new Set(selectedIds).size === selectedIds.length
    && apps.every((id) => selectedIds.includes(id));
  const batchStages = Array.isArray(stages) ? stages : [];
  const plannedWorkflow = plan.data.workflow as { mode?: unknown; jobs?: Array<{
    id?: unknown; needs?: unknown; gates?: unknown; owner?: unknown; apps?: unknown }> } | undefined;
  const catalogJobs = plannedWorkflow?.jobs;
  const baseBatchGates = ["fresh-host-inspection", "exact-apply-approval"];
  const homarrBatchApps = goals.length === 0 && apps.length >= 2 && apps.length <= 8
    && selectedIds.includes("homarr")
    && new Set(selectedIds).size === selectedIds.length
    && apps.every((id) => selectedIds.includes(id));
  const homarrBatchGraph = homarrBatchApps && batchStages.length === apps.length + 2
    && batchStages[0]?.id === "dashboard" && batchStages[0]?.owner === "selfhost-homarr"
    && JSON.stringify(batchStages[0]?.apps) === JSON.stringify(["homarr"])
    && batchStages[batchStages.length - 1]?.id === "homarr-attachments"
    && batchStages[batchStages.length - 1]?.owner === "selfhost-homarr"
    && JSON.stringify(batchStages[batchStages.length - 1]?.apps) === JSON.stringify(apps)
    && batchStages.slice(1, -1).every((stage) => stage && typeof stage.id === "string"
      && stage.id.startsWith("app-") && apps.includes(stage.id.slice(4))
      && stage.owner === "selfhost-compose" && Array.isArray(stage.apps)
      && stage.apps.length === 1 && stage.apps[0] === stage.id.slice(4))
    && new Set(batchStages.map((stage) => stage?.id)).size === batchStages.length
    && plannedWorkflow?.mode === "planning-only"
    && Array.isArray(catalogJobs) && catalogJobs.length === batchStages.length
    && catalogJobs[0]?.id === "dashboard" && Array.isArray(catalogJobs[0]?.needs)
    && catalogJobs[0].needs.length === 0
    && catalogJobs[0].owner === "selfhost-homarr"
    && JSON.stringify(catalogJobs[0].apps) === JSON.stringify(["homarr"])
    && JSON.stringify(catalogJobs[0].gates) === JSON.stringify(baseBatchGates)
    && apps.every((id) => catalogJobs.some((job) => job.id === `app-${id}`
      && JSON.stringify(job.needs) === JSON.stringify(["dashboard"])
      && JSON.stringify(job.gates) === JSON.stringify([...baseBatchGates, "homarr-onboarded"])
      && job.owner === "selfhost-compose" && JSON.stringify(job.apps) === JSON.stringify([id])))
    && catalogJobs.some((job) => job.id === "homarr-attachments"
      && Array.isArray(job.needs) && job.needs.length === apps.length + 1
      && job.needs.includes("dashboard")
      && apps.every((id) => job.needs.includes(`app-${id}`))
      && job.owner === "selfhost-homarr"
      && JSON.stringify(job.apps) === JSON.stringify(apps)
      && JSON.stringify(job.gates) === JSON.stringify([...baseBatchGates, "app-running-on-homarr-bridge"]));
  if (homarrBatchGraph && process.platform === "linux") {
    let choices: RecipeChoice[] = [];
    try {
      const recipes = invoke(["catalog", "recipes"]);
      choices = bundledRecipeChoices(recipes.data ?? {});
    } catch {
      note("The bundled recipe list could not be reviewed. This remains a plan; no batch setup will start.",
        "Recipe unavailable");
    }
    const selectedChoices = apps.map((id) => choices.find((choice) => choice.appId === id));
    const homarrChoice = choices.find((choice) => choice.appId === "homarr");
    if (homarrChoice && selectedChoices.every((choice): choice is RecipeChoice => choice !== undefined)) {
      const proceed = stopIfCancelled(await confirm({
        message: `Continue to Homarr onboarding, then a separately approved ${apps.length}-app batch?`,
        initialValue: false,
      }));
      if (proceed) {
        await installRecipeBatchFlow(selectedChoices, root, true, homarrChoice, plannedWorkflow);
        return;
      }
      outro("Plan only. No Homarr or app container was started.");
      return;
    }
  }
  const exactBatchGraph = exactBatchApps && batchStages.length === apps.length
    && new Set(batchStages.map((stage) => stage?.id)).size === apps.length
    && batchStages.every((stage) => stage && typeof stage === "object"
      && typeof stage.id === "string" && apps.includes(stage.id.slice(4))
      && stage.id === `app-${stage.id.slice(4)}` && stage.owner === "selfhost-compose"
      && Array.isArray(stage.apps) && stage.apps.length === 1 && stage.apps[0] === stage.id.slice(4))
    && plannedWorkflow?.mode === "planning-only"
    && Array.isArray(catalogJobs) && catalogJobs.length === apps.length
    && new Set(catalogJobs.map((job) => job?.id)).size === apps.length
    && catalogJobs.every((job) => typeof job.id === "string" && apps.includes(job.id.slice(4))
      && job.id === `app-${job.id.slice(4)}` && Array.isArray(job.needs) && job.needs.length === 0
      && job.owner === "selfhost-compose"
      && JSON.stringify(job.apps) === JSON.stringify([job.id.slice(4)])
      && JSON.stringify(job.gates) === JSON.stringify(baseBatchGates));
  if (exactBatchGraph && process.platform === "linux") {
    let choices: RecipeChoice[] = [];
    try {
      const recipes = invoke(["catalog", "recipes"]);
      choices = bundledRecipeChoices(recipes.data ?? {});
    } catch {
      note("The bundled recipe list could not be reviewed. This remains a plan; no batch setup will start.",
        "Recipe unavailable");
    }
    const selectedChoices = apps.map((id) => choices.find((choice) => choice.appId === id));
    if (selectedChoices.every((choice): choice is RecipeChoice => choice !== undefined)) {
      const proceed = stopIfCancelled(await confirm({
        message: `Continue to a separately approved ${apps.length}-app batch without Homarr?`,
        initialValue: false,
      }));
      if (proceed) {
        await installRecipeBatchFlow(selectedChoices, root, false,
          choices.find((choice) => choice.appId === "homarr"), plannedWorkflow);
        return;
      }
      outro("Plan only. No app container was started.");
      return;
    }
  }
  const appCommands = plannedAppCommands(plan.data);
  if (appCommands.length > 0) {
    outro(`Plan only. Bounded Linux adapter help: ${appCommands.map((app) => `self-host ${app} help`).join("; ")}. These are separate projects with reviewed inputs and apply approvals; no combined installer was run.`);
    return;
  }
  outro("Plan only. This selection has no one-command CLI installer yet. Review its setup stages; the self-host Agent Skill can guide an experimental or supported adapter setup.");
}

async function installHouseholdFlow(existingRoot?: string, existingPlan?: Record<string, unknown>) {
  if (process.platform !== "linux") {
    note("Household deployment currently requires a Linux Docker host. Catalog planning works here, but this wizard will not promise macOS or Windows apply.", "Platform limit");
    outro("No services were changed.");
    return;
  }
  const diagnostic = runCli(["doctor", "--scope", "media", "--json"]);
  let doctor: { status: string; tools: Array<{ tool: string; required: boolean; ok: boolean }> };
  try { doctor = JSON.parse(diagnostic.stdout); }
  catch { throw new Error("The prerequisites check did not return valid JSON."); }
  if (!doctor || !Array.isArray(doctor.tools)) throw new Error("The prerequisites check returned an invalid result.");
  const missing = doctor.tools.filter((tool) => (tool.required || tool.tool === "Docker Buildx for household image resolution") && !tool.ok);
  if (diagnostic.status !== 0 || doctor.status !== "ready" || missing.length > 0) {
    note(missing.map((tool) => tool.tool).join("\n") || "Unknown prerequisite failure", "Fix these first");
    outro("Run self-host doctor --scope media on the Linux Docker host. No setup was started.");
    return;
  }
  const root = existingRoot ?? await chooseRoot(true);
  if (existsSync(join(root, ".selfhost", "bundles"))) {
    note(`This project already has a household deployment record. Use Resume a project or choose a fresh directory: ${root}`, "Existing project");
    outro("No new bundle was created.");
    return;
  }
  let adoptedMedia: AdoptedMediaSelection | undefined;
  if (existsSync(join(root, ".selfhost", "cli.json"))) {
    adoptedMedia = await inspectExistingMedia(root);
    note(`Run: ${adoptedMedia.runId}\nAdministrator: ${adoptedMedia.username}\nBind: ${adoptedMedia.bind}\nPorts: ${adoptedMedia.ports.join(", ")}\nThis run must keep its existing data, ports, networks, and media approval. Photos, Docs, and Vault get separate new projects.`, "Existing media found");
    if (adoptedMedia.bind === "0.0.0.0") {
      const privateFirewall = stopIfCancelled(await confirm({
        message: "Have you verified private router or Docker-aware firewall rules for these existing all-interface media ports?",
        initialValue: false,
      }));
      if (!privateFirewall) {
        outro("No bundle was prepared. Keep the existing media run; verify its private firewall scope before extension.");
        return;
      }
    }
    const reuse = stopIfCancelled(await confirm({
      message: "Reuse this existing media run and add Photos, Docs, and Vault?", initialValue: false,
    }));
    if (!reuse) {
      outro("No bundle was prepared. Choose a fresh project directory for a new media run.");
      return;
    }
  }
  const goals = ["personal-media", "photos", "private-notes", "passwords"];
  const catalogPlan = existingPlan ?? invoke(planArgs(goals, [], root, [])).data;
  if (!householdCatalogSupported(catalogPlan)) {
    throw new Error("The catalog no longer describes the exact supported household stages. Use planning and review the changed catalog before setup.");
  }
  if (!existingPlan) showPlan(catalogPlan as Record<string, unknown>);
  const id = stopIfCancelled(await text({
    message: "Name this household bundle",
    placeholder: "home (press Enter to use)",
    validate(value) { if (value && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)) return "Use 1–40 lowercase letters, digits, _ or -."; },
  })) || "home";
  let username = adoptedMedia?.username;
  if (!username) {
    username = stopIfCancelled(await text({
      message: "Administrator username",
      placeholder: "admin (press Enter to use)",
      validate(value) { if (value && !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(value)) return "Use 3–64 letters, digits, _, . or -."; },
    })) || "admin";
  }
  const email = stopIfCancelled(await text({
    message: "Account email for Photos and Docs",
    placeholder: "admin@home.invalid (press Enter to use)",
  })) || "admin@home.invalid";
  const name = stopIfCancelled(await text({
    message: "Account display name",
    placeholder: "Home Admin (press Enter to use)",
  })) || "Home Admin";
  const httpsChoice = stopIfCancelled(await select({
    message: "How should the password vault get private HTTPS?",
    options: [
      { value: "later", label: "Plan a local-only Caddy route later", hint: "No DNS or CA-trust details needed now; vault setup will wait" },
      { value: "existing", label: "Use an existing private HTTPS route", hint: "Enter its exact origin and the owner of DNS/TLS" },
    ],
  }));
  let vaultwardenOrigin = "https://vaultwarden.localhost:28443";
  let routeOwner = "caddy-local-pending";
  let tlsOwner = "caddy-local-pending";
  if (httpsChoice === "existing") {
    vaultwardenOrigin = stopIfCancelled(await text({ message: "Exact private HTTPS origin for Vaultwarden", placeholder: "https://vault.example.internal" }));
    routeOwner = stopIfCancelled(await text({ message: "Who owns this private route?", placeholder: "caddy-home" }));
    tlsOwner = stopIfCancelled(await text({ message: "Who owns its TLS certificate?", placeholder: "caddy-home" }));
  }
  let ports: NonNullable<HouseholdChoices["ports"]>;
  if (adoptedMedia) ports = await chooseIsolatedAppPorts();
  else ports = await chooseIsolatedHouseholdPorts();
  const choices: HouseholdChoices = { root, id, username, email, name, vaultwardenOrigin, routeOwner, tlsOwner, ports, adoptedMedia };
  const args = householdBeginArgs(choices);
  let mediaReview = "New host-only media";
  let portReview = "Ten new ports were checked and will be rechecked during preparation.";
  if (ports.mediaStart !== undefined) mediaReview += ` on ports ${ports.mediaStart}–${ports.mediaStart + 6}`;
  if (adoptedMedia) {
    mediaReview = `Reuse ${adoptedMedia.runId} at ${adoptedMedia.bind} on ports ${adoptedMedia.ports.join(", ")}`;
    portReview = "Only three new app ports were checked; the existing media ports remain unchanged.";
  }
  note(`Project: ${root}\nBundle: ${id}\nAdministrator: ${username}\nAccount email: ${email}\nMedia: ${mediaReview}\nApp ports: Photos ${ports.immich}, Docs ${ports.docmost}, Vault ${ports.vaultwarden}\nVault origin: ${vaultwardenOrigin}\nHTTPS route: ${httpsChoice === "later" ? "not configured; a later verified step" : `owned by ${routeOwner}`}\n${portReview} No containers start during preparation.`, "Review choices");
  const prepare = stopIfCancelled(await confirm({
    message: "Inspect the host and create this private household plan?", initialValue: false,
  }));
  if (!prepare) {
    outro("No household plan was created.");
    return;
  }
  let prepared: Record<string, unknown>;
  try {
    prepared = await runJsonCli(args, "Inspecting host and preparing the household plan");
  } catch {
    note(`Preparation may have created an owner-only journey or host report, but it never applied containers.\nInspect: self-host bundle journey status --project-root ${root} --id ${id}\nIf the bundle input exists, inspect: self-host bundle plan --project-root ${root} --input ${join(root, ".selfhost", "bundles", id, "household-bundle.json")}\nRepair the failed prerequisite, then resume the existing artifacts. Do not repeat begin or delete the project.`, "Preparation stopped");
    outro("No container apply was requested. The partial preparation needs inspection before continuation.");
    return;
  }
  const plan = reviewedHouseholdPlan(prepared, choices);
  note(`Bundle approval: ${plan.approval}\nMedia: ${plan.mediaExposure}\nPorts: ${JSON.stringify(plan.mediaPorts)}\nStages:\n${plan.stages.map((stage) => `${stage.service}: ${stage.purpose}; ${stage.acceptance}`).join("\n")}`, "Prepared plan");
  note(JSON.stringify(prepared, null, 2), "Full exact bundle plan");
  const advance = stopIfCancelled(await confirm({
    message: "Approve this bundle plan and advance to the next separate review checkpoint?", initialValue: false,
  }));
  if (advance) {
    const result = await runJsonCli(["bundle", "run", "--project-root", root, "--input", plan.input, "--approve", plan.approval],
      "Running bounded, approved preparation");
    if (result.kind !== "household-bundle-run" || result.projectRoot !== root || result.bundle !== id) {
      throw new Error("The runner returned an unexpected project. Inspect bundle approvals before continuing.");
    }
    showHouseholdRunResult(result);
    const nextCheckpoint = (result.next as { checkpoint?: unknown } | undefined)?.checkpoint;
    if (result.status === "approval-required"
      || (result.status === "manual-checkpoint" && nextCheckpoint === "bind-media-web")) {
      await resumeFlow(root);
      return;
    }
  }
  const inbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", plan.input], "Reading the next checkpoint");
  if (inbox.kind !== "household-bundle-approvals" || inbox.projectRoot !== root) {
    throw new Error("The review inbox did not match this project.");
  }
  const current = inbox.current as { checkpoint?: string; service?: string; reason?: string; reviewCommand?: string[] } | undefined;
  note(`Checkpoint: ${current?.checkpoint ?? "unknown"}\nOwner: ${current?.service ?? "bundle"}\n${current?.reason ?? ""}\nReview: ${JSON.stringify(current?.reviewCommand ?? null)}`, "What remains");
  outro(`Prepared, not fully installed. Resume with self-host bundle approvals --project-root ${root} --input ${plan.input}. HTTPS, browser setup, Homarr attachments and acceptance remain separate gates.`);
}

function showHouseholdRunResult(result: Record<string, unknown>): void {
  const next = result.next as { checkpoint?: string; service?: string } | undefined;
  const diagnosis = result.diagnosis as { command?: string[] | null; safeReason?: string | null;
    doNotRetryForDiagnosis?: boolean } | undefined;
  const lines = [`Status: ${String(result.status)}`, `Next: ${next?.checkpoint ?? "unknown"} (${next?.service ?? "bundle"})`,
    `Steps: ${JSON.stringify(result.steps ?? [])}`];
  if (result.status === "stage-failed" || result.status === "stalled") {
    lines.push(`Failure: ${diagnosis?.safeReason ?? String(result.failure ?? "Inspect the adapter status.")}`);
    if (diagnosis?.command) lines.push(`Read-only diagnosis (argv): ${JSON.stringify(diagnosis.command)}`);
    if (diagnosis?.doNotRetryForDiagnosis) lines.push("Do not replay the failed mutation for diagnosis.");
  }
  note(lines.join("\n"), "Run checkpoint");
}

async function browseFlow() {
  const directory = await chooseCatalogDirectory();
  const query = stopIfCancelled(await text({ message: "Search for an app or goal", placeholder: "e.g. photos, jellyfin, backups" }));
  if (!query.trim()) {
    outro("No search performed.");
    return;
  }
  const result = invoke(["catalog", "search", query.trim(), ...catalogArgs(directory)]);
  const matches = (result.data?.results ?? []) as Array<{ app: { id: string; name: string; support: { automation: string }; homarr?: { support: string }; upstream?: { url: string } } }>;
  if (matches.length === 0) {
    note("No catalog match. An AI agent can still research an experimental guided setup.", "Catalog matches");
    outro("Catalog browsing does not change the host.");
    return;
  }
  const visible = matches.slice(0, 10);
  note(visible.map(({ app }) => `${app.name} — ${app.support.automation} setup; Homarr: ${app.homarr?.support ?? "unknown"}\n${app.upstream?.url ?? "No upstream link"}`).join("\n\n"), "Catalog matches");
  const chosen = stopIfCancelled(await select({
    message: "Plan one of these apps? Narrow your search if it is not shown.",
    options: [
      ...visible.map(({ app }) => ({ value: app.id, label: app.name, hint: app.support.automation })),
      { value: "__browse_only__", label: "Done browsing" },
    ],
  }));
  if (chosen === "__browse_only__") {
    outro("Catalog browsing does not change the host.");
    return;
  }
  await planFlow(chosen, directory ?? null);
}

async function chooseBundleInput(root: string): Promise<string | null> {
  const directory = join(root, ".selfhost", "bundles");
  const entries = await readdir(directory, { withFileTypes: true });
  const ids = entries.filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(entry.name))
    .map((entry) => entry.name).filter((id) => existsSync(join(directory, id, "household-bundle.json"))).sort();
  if (ids.length === 0) return null;
  let id = ids[0];
  if (ids.length > 1) {
    id = stopIfCancelled(await select({
      message: "Which household bundle should be resumed?",
      options: ids.map((value) => ({ value, label: value })),
    }));
  }
  return join(directory, id, "household-bundle.json");
}

async function showPartialJourney(root: string): Promise<boolean> {
  const ids = await savedJourneyIds(root);
  if (ids.length === 0) return false;
  let id = ids[0];
  if (ids.length > 1) {
    id = stopIfCancelled(await select({
      message: "Which incomplete household setup should be inspected?",
      options: ids.map((value) => ({ value, label: value })),
    }));
  }
  const status = await runJsonCli(["bundle", "journey", "status", "--project-root", root, "--id", id], "Inspecting partial preparation");
  if (status.kind !== "household-full-journey-status" || status.bundleId !== id) {
    throw new Error("The journey status did not match the selected bundle.");
  }
  note(`Journey: ${id}\nStatus: ${String(status.status)}\nStarted: ${String(status.startedAt)}\nThe bundle input was not completed. Inspect the owner-only host report and use bundle init with fresh reviewed choices; bundle begin will not overwrite this journey.\nReference: self-host bundle journey status --project-root ${root} --id ${id}`, "Partial preparation");
  outro("No deployment was resumed. Keep the existing project and repair the failed preparation step.");
  return true;
}

async function inspectPrivateHouseholdHost(args: string[], reportPath: string,
  network: string, ports: number[]): Promise<string> {
  const inspected = runCli(args);
  if (inspected.status !== 0) {
    throw new Error("The bounded host inspection stopped. Inspect the project before creating another report.");
  }
  const metadata = await lstat(reportPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 1024 * 1024
    || (metadata.mode & 0o077) !== 0 || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("The host inspection did not create one bounded owner-only report.");
  }
  let report: unknown;
  try { report = JSON.parse(await readFile(reportPath, "utf8")); }
  catch { throw new Error("The owner-only host inspection report is not valid JSON."); }
  return reviewedMediaWebHostReport(report, network, ports);
}

async function bindMediaWeb(root: string, input: string, inbox: Record<string, unknown>): Promise<boolean> {
  const bundle = inbox.bundle;
  const approval = inbox.bundleApproval;
  const next = await runJsonCli(["bundle", "next", "--project-root", root, "--input", input,
    "--approve", String(approval)], "Reading the exact media web handoff");
  const handoff = householdMediaWebHandoff(inbox, next, root, input);
  if (!handoff) throw new Error("The media web handoff did not match the current typed bundle checkpoint.");
  const plan = await runJsonCli(["bundle", "plan", "--project-root", root, "--input", input],
    "Reviewing the unchanged bundle plan");
  if (plan.kind !== "household-bundle-plan" || plan.mutation !== false || plan.projectRoot !== root
    || plan.input !== input || plan.bundle !== bundle || plan.approval !== approval) {
    throw new Error("The bundle changed before media web review. Reopen Resume a project.");
  }
  note(`Current bundle approval: ${handoff.approval}\nNetwork: ${handoff.network}\nApp ports: ${handoff.ports.join(", ")}\nFresh report: ${handoff.reportPath}\nOnly owner-only app inputs will be revised; no container or network will be changed.`, "Media web handoff");
  const inspect = stopIfCancelled(await confirm({
    message: "Inspect the exact app ports and media web network for this handoff?", initialValue: false,
  }));
  if (!inspect) return false;
  let context: string;
  try {
    context = await inspectPrivateHouseholdHost(handoff.inspectionArgs, handoff.reportPath,
      handoff.network, handoff.ports);
  } catch {
    note(`The host report was not usable. Inspect bundle plan and the owner-only report at ${handoff.reportPath}; do not repeat the same output path.`, "Host inspection stopped");
    return false;
  }
  note(`Docker context: ${context}\nObserved network: ${handoff.network}\nUnused selected TCP ports: ${handoff.ports.join(", ")}\nReport: ${handoff.reportPath}\nRoute command (argv): ${JSON.stringify(["self-host", ...handoff.routeArgs])}`, "Fresh host evidence");
  const revise = stopIfCancelled(await confirm({
    message: "Approve only the media-web binding of untouched Immich and Docmost inputs?", initialValue: false,
  }));
  if (!revise) return false;
  const refreshedPlan = await runJsonCli(["bundle", "plan", "--project-root", root, "--input", input],
    "Checking the bundle approval before revision");
  const refreshedInbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input],
    "Checking the media web checkpoint before revision");
  if (refreshedPlan.kind !== "household-bundle-plan" || refreshedPlan.mutation !== false
    || refreshedPlan.approval !== handoff.approval
    || !householdMediaWebHandoff(refreshedInbox, next, root, input)) {
    throw new Error("The media web approval changed during review. No binding was requested.");
  }
  let result: Record<string, unknown>;
  try {
    result = await runJsonCli(handoff.routeArgs, "Revising only owner-controlled app inputs");
  } catch {
    note(`The owner-only revision stopped. Inspect bundle plan and approvals for ${input}; do not replay it automatically. No app apply was requested.`, "Media web recovery");
    return false;
  }
  if (result.kind !== "household-bundle-route-network" || result.status !== "revised"
    || result.bundle !== bundle || result.network !== handoff.network
    || result.previousApproval !== handoff.approval || result.approval === handoff.approval) {
    throw new Error("The media web revision returned an unexpected checkpoint. Inspect bundle plan before continuing.");
  }
  const revisedPlan = await runJsonCli(["bundle", "plan", "--project-root", root, "--input", input],
    "Reading the revised bundle plan");
  if (revisedPlan.kind !== "household-bundle-plan" || revisedPlan.mutation !== false
    || revisedPlan.projectRoot !== root || revisedPlan.input !== input || revisedPlan.bundle !== bundle
    || revisedPlan.approval !== result.approval) {
    throw new Error("The revised bundle plan did not match the new approval. Inspect the exact inputs before continuing.");
  }
  note(`The app inputs now reference ${handoff.network}. New bundle approval: ${String(result.approval)}. The old token is invalid. No app was applied.`, "Media web bound");
  return true;
}

async function offerParallelApps(root: string, input: string, inbox: Record<string, unknown>): Promise<"declined" | "applied" | "stopped"> {
  const selection = (inbox.bundleReview as { mediaSelection?: { mode?: unknown; runId?: unknown } } | undefined)?.mediaSelection;
  if (inbox.current && (inbox.current as { checkpoint?: unknown }).checkpoint !== "review-immich-apply") return "declined";
  if (selection?.mode !== "create" || typeof selection.runId !== "string") return "declined";
  const goals = ["personal-media", "photos", "private-notes", "passwords"];
  let currentCatalog: Record<string, unknown> | undefined;
  try { currentCatalog = invoke(planArgs(goals, [], root, [])).data; }
  catch { currentCatalog = undefined; }
  if (!householdParallelGraphSupported(currentCatalog)) {
    note("The current catalog no longer binds this exact media → Immich + Docmost group to the household executor. Continue one separately approved bundle stage at a time.", "Parallel route unavailable");
    return "declined";
  }
  const recorded = await runJsonCli(["bundle", "status", "--project-root", root, "--input", input],
    "Checking prior app-job progress");
  const parallelState = recorded.parallelApply as { status?: unknown; jobs?: unknown } | undefined;
  if (recorded.kind !== "household-bundle-status" || recorded.projectRoot !== root
    || !parallelState || parallelState.status !== "not-started") {
    note("A parallel app run was already recorded or its history needs inspection. Review bundle status and the exact Immich/Docmost adapter checkpoints; this menu will not replay either apply.", "Parallel recovery");
    return "stopped";
  }
  const parallel = stopIfCancelled(await confirm({
    message: "Review initial Immich and Docmost applies together? Their accounts and acceptance remain separate.", initialValue: false,
  }));
  if (!parallel) return "declined";
  const bundle = String(inbox.bundle);
  const info = await runJsonCli(["bundle", "info", "--project-root", root, "--input", input],
    "Reading exact private app ports");
  const ports = householdParallelPorts(info, bundle);
  const network = `autostack-${selection.runId}_web`;
  const inspect = async (): Promise<string> => {
    const reportPath = join(root, ".selfhost", "bundles", bundle, `host-parallel-${randomUUID()}.json`);
    const args = ["host", "inspect", "--output", reportPath, "--limit", "50",
      "--check-tcp-port", String(ports[0]), "--check-tcp-port", String(ports[1])];
    await inspectPrivateHouseholdHost(args, reportPath, network, ports);
    return reportPath;
  };
  let reportPath = await inspect();
  const planArgs = (report: string) => ["bundle", "parallel-plan", "--project-root", root,
    "--input", input, "--host-inspection", report];
  const plan = await runJsonCli(planArgs(reportPath), "Planning two untouched app applies");
  const reviewed = householdParallelPlan(plan, inbox, root, input, reportPath);
  if (!reviewed) throw new Error("The parallel plan did not match the untouched bundle and exact tokens.");
  const immich = await runJsonCli(["bundle", "stage", "--project-root", root, "--input", input,
    "--service", "immich", "--phase", "plan"], "Reviewing the Immich adapter plan");
  const docmost = await runJsonCli(["bundle", "stage", "--project-root", root, "--input", input,
    "--service", "docmost", "--phase", "plan"], "Reviewing the Docmost adapter plan");
  const immichReview = householdParallelAdapterReview(immich, bundle, "immich", ports[0], reviewed.immich);
  const docmostReview = householdParallelAdapterReview(docmost, bundle, "docmost", ports[1], reviewed.docmost);
  note(`Bundle token: ${String(plan.approval)}\nNetwork: ${reviewed.network}\nHost report: ${reportPath}\n\n${immichReview}\n\n${docmostReview}\nOnly the two initial Compose applies can run together. No account, owner, Homarr, or acceptance stage is included.`, "Parallel apply review");
  reportPath = await inspect();
  const freshPlan = await runJsonCli(planArgs(reportPath), "Rechecking the host and exact app tokens");
  const freshInbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input],
    "Checking the current parallel gate");
  const current = householdParallelPlan(freshPlan, freshInbox, root, input, reportPath);
  if (!current || current.immich !== reviewed.immich || current.docmost !== reviewed.docmost
    || current.network !== reviewed.network || freshPlan.approval !== plan.approval) {
    throw new Error("An app or bundle plan changed during parallel review. No app apply was requested.");
  }
  const approveImmich = stopIfCancelled(await confirm({
    message: `Approve only Immich initial Compose apply with ${current.immich}?`, initialValue: false,
  }));
  if (!approveImmich) return "stopped";
  const approveDocmost = stopIfCancelled(await confirm({
    message: `Approve only Docmost initial Compose apply with ${current.docmost}?`, initialValue: false,
  }));
  if (!approveDocmost) return "stopped";
  let result: Record<string, unknown>;
  try {
    result = await runJsonCli(["bundle", "parallel-apply", "--project-root", root, "--input", input,
      "--host-inspection", reportPath, "--approve", String(freshPlan.approval),
      "--immich-approve", current.immich, "--docmost-approve", current.docmost],
      "Applying only the two reviewed app projects", "household-bundle-parallel-apply");
  } catch {
    note(`Parallel apply did not return a complete typed result. Inspect bundle status and both adapter checkpoints for ${input}; do not retry either apply from this menu.`, "Parallel recovery");
    return "stopped";
  }
  const results = result.results;
  if (result.kind !== "household-bundle-parallel-apply" || result.bundle !== bundle
    || !Array.isArray(results) || results.length !== 2
    || JSON.stringify(results.map((entry: { service?: unknown }) => entry?.service)) !== JSON.stringify(["immich", "docmost"])
    || results.some((entry: { status?: unknown }) => !["applied", "inspect-checkpoint"].includes(String(entry?.status)))) {
    throw new Error("The parallel apply returned an unexpected result. Inspect both adapter checkpoints before continuing.");
  }
  note(results.map((entry: { service: string; status: string }) => `${entry.service}: ${entry.status}`).join("\n"),
    "Initial app apply results");
  if (result.status !== "applied-awaiting-account-setup"
    || results.some((entry: { status: string }) => entry.status !== "applied")) {
    note(`Inspect bundle status and each adapter checkpoint for ${input}. Resume each failed app individually from its exact recovery plan; the menu will not retry either apply.`, "Partial apply recovery");
    return "stopped";
  }
  return "applied";
}

async function currentHouseholdApproval(selection: LocalCaddySelection): Promise<string> {
  const plan = await runJsonCli(["bundle", "plan", "--project-root", selection.root, "--input", selection.input],
    "Checking the current household approval");
  if (plan.kind !== "household-bundle-plan" || plan.mutation !== false
    || plan.projectRoot !== selection.root || plan.input !== selection.input
    || plan.bundle !== selection.bundle || typeof plan.approval !== "string") {
    throw new Error("The household plan is no longer the exact selected bundle.");
  }
  return plan.approval;
}

async function configureLocalHttps(root: string, input: string,
  inbox: Record<string, unknown>): Promise<boolean> {
  const status = await runJsonCli(["bundle", "status", "--project-root", root, "--input", input],
    "Reading the private HTTPS intention");
  const selection = localCaddySelection(status, inbox, root, input);
  if (!selection) {
    note("This route is not the new, host-only vaultwarden.localhost Caddy path. Use the exact bundle next checkpoint for a custom or existing route; the menu will not change its owner.", "Private HTTPS needs its route owner");
    return false;
  }
  if (selection.routeNetwork !== null && !existsSync(selection.directory)) {
    note("The Vaultwarden bridge is already recorded but its Caddy input directory is missing. Inspect the bundle and route owner before continuing.", "Private HTTPS ownership mismatch");
    return false;
  }
  let inputs: CaddyInputsReview | null = null;
  if (existsSync(selection.directory)) {
    const directory = await lstat(selection.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0
      || (typeof process.getuid === "function" && directory.uid !== process.getuid())
      || !existsSync(selection.sharedInput)) {
      note(`The Caddy input directory at ${selection.directory} is partial or not owner-only. Inspect it before retrying; no file was replaced.`, "Caddy input recovery");
      return false;
    }
    const metadata = await lstat(selection.sharedInput);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0
      || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
      note(`The saved Caddy input at ${selection.sharedInput} is not one owner-only regular file.`, "Caddy input recovery");
      return false;
    }
    note(`Resuming the original owner-only Caddy input at ${selection.sharedInput}; no input generator will be replayed.`, "Saved Caddy input");
  } else {
    const reportPath = join(root, ".selfhost", "bundles", selection.bundle,
      `host-caddy-${randomUUID()}.json`);
    const inspectArgs = ["host", "inspect", "--output", reportPath, "--limit", "50",
      "--check-tcp-port", String(selection.httpsPort)];
    await inspectPrivateHouseholdHost(inspectArgs, reportPath, selection.mediaWeb,
      [selection.httpsPort]);
    const inputsArgs = ["bundle", "caddy-inputs", "plan", "--project-root", root,
      "--input", input, "--host-inspection", reportPath];
    const inputsValue = await runJsonCli(inputsArgs, "Planning the host-only Caddy route inputs");
    inputs = reviewedCaddyInputs(inputsValue, selection, "ready-for-review");
    note(`Owner: ${selection.owner}\nBind: 127.0.0.1:${selection.httpsPort} (this host only)\nImage: ${inputs.image}\nRoutes:\n${inputs.origins.join("\n")}\nVaultwarden backend port: ${inputs.vaultwardenHostPort}\nApproval: ${inputs.approval}\nThis approval creates owner-only input files only.`, "Review Caddy input files");
    const createInputs = stopIfCancelled(await confirm({
      message: "Create these exact owner-only Caddy inputs?", initialValue: false,
    }));
    if (!createInputs) return false;
    if (await currentHouseholdApproval(selection) !== selection.bundleApproval) {
      throw new Error("The household composition changed during Caddy input review. No Caddy files were requested.");
    }
    const pinnedInputsArgs = [...inputsArgs, "--caddy-image", inputs.image];
    const refreshedInputs = reviewedCaddyInputs(await runJsonCli(pinnedInputsArgs,
      "Rechecking the exact Caddy image and inputs"), selection, "ready-for-review");
    if (refreshedInputs.approval !== inputs.approval
      || refreshedInputs.vaultwardenHostPort !== inputs.vaultwardenHostPort) {
      throw new Error("The Caddy input approval changed during review. No input files were requested.");
    }
    try {
      const createdValue = await runJsonCli(["bundle", "caddy-inputs", "apply", "--project-root", root,
        "--input", input, "--host-inspection", reportPath, "--caddy-image", inputs.image,
        "--approve", inputs.approval], "Creating only the reviewed Caddy inputs");
      const created = reviewedCaddyInputs(createdValue, selection, "created");
      if (created.approval !== inputs.approval) throw new Error("The created Caddy input approval changed.");
    } catch {
      note(`Inspect ${selection.directory} and the bundle plan. Input creation may be partial; do not repeat a no-clobber apply from the menu.`, "Caddy input recovery");
      return false;
    }
  }
  const caddyStatusArgs = ["caddy-private", "status", "--project-root", root,
    "--input", selection.sharedInput];
  const readCaddy = async () => reviewedPrivateCaddyStatus(await runJsonCli(
    caddyStatusArgs, "Reading the live private Caddy transport"), selection);
  const caddyStatus = await runJsonCli(caddyStatusArgs, "Checking for an existing Caddy checkpoint");
  if (caddyStatus.checkpointRecorded === true) {
    try { reviewedPrivateCaddyStatus(caddyStatus, selection); }
    catch {
      note(`Caddy has a non-current, stopped, or incomplete checkpoint. Inspect self-host caddy-private status --project-root ${root} --input ${selection.sharedInput}; use its exact recovery approval, not a fresh apply.`, "Caddy checkpoint recovery");
      return false;
    }
    note(`The exact host-only Caddy project is already applied. Its current transport and exported CA were read back; no apply will be replayed.`, "Caddy resumed");
  } else {
    reviewedPrivateCaddyPrepared(caddyStatus, selection);
    const caddyPlanArgs = ["caddy-private", "plan", "--project-root", root,
      "--input", selection.sharedInput];
    const caddyPlan = await runJsonCli(caddyPlanArgs, "Reviewing the private Caddy Compose plan");
    const caddyReview = reviewedPrivateCaddyPlan(caddyPlan, selection);
    if (inputs && caddyReview.image !== inputs.image) {
      throw new Error("Caddy image changed between input creation and Compose review.");
    }
    note(`Project: ${selection.owner}\nPrivate HTTPS: ${localCaddyOrigins(selection).join(", ")}\nImage: ${caddyReview.image}\nCA export: ${selection.caExportPath}\nCaddyfile SHA-256: ${String(caddyPlan.caddyfileSha256)}\nApproval: ${caddyReview.approval}\nTransport proof may return HTTP 502 before Vaultwarden runs. That is not application acceptance.`, "Review Caddy deployment");
    const applyCaddy = stopIfCancelled(await confirm({
      message: "Apply only this new, loopback-bound Caddy project?", initialValue: false,
    }));
    if (!applyCaddy) return false;
    const freshCaddy = reviewedPrivateCaddyPlan(await runJsonCli(caddyPlanArgs,
      "Rechecking the Caddy deployment approval"), selection);
    if (await currentHouseholdApproval(selection) !== selection.bundleApproval
      || freshCaddy.approval !== caddyReview.approval || freshCaddy.image !== caddyReview.image) {
      throw new Error("Caddy or household inputs changed during deployment review. No Caddy apply was requested.");
    }
    try {
      const applied = await runJsonCli(["caddy-private", "apply", "--project-root", root,
        "--input", selection.sharedInput, "--approve", caddyReview.approval],
      "Applying only the approved private Caddy project");
      reviewedPrivateCaddyApply(applied, selection);
    } catch {
      note(`Inspect self-host caddy-private status --project-root ${root} --input ${selection.sharedInput}. Caddy may have started; never replay apply without its exact checkpoint recovery plan.`, "Caddy apply recovery");
      return false;
    }
  }
  await readCaddy();
  let revisedApproval = selection.bundleApproval;
  if (selection.routeNetwork === null) {
    const bridgeReport = join(root, ".selfhost", "bundles", selection.bundle,
      `host-vaultwarden-bridge-${randomUUID()}.json`);
    await inspectPrivateHouseholdHost(["host", "inspect", "--output", bridgeReport, "--limit", "50",
      "--check-tcp-port", String(selection.backendHostPort)], bridgeReport,
      selection.bridge, [selection.backendHostPort]);
    note(`Caddy-owned bridge: ${selection.bridge}\nVaultwarden backend host port: ${selection.backendHostPort}\nFresh report: ${bridgeReport}\nThis revises the untouched Vaultwarden input only; it does not deploy the vault.`, "Review Vaultwarden bridge");
    const bindVault = stopIfCancelled(await confirm({
      message: "Bind only Vaultwarden to this verified Caddy-owned bridge?", initialValue: false,
    }));
    if (!bindVault) return false;
    await readCaddy();
    if (await currentHouseholdApproval(selection) !== selection.bundleApproval) {
      throw new Error("The bundle changed before Vaultwarden bridge approval. No route revision was requested.");
    }
    const freshBridgeReport = join(root, ".selfhost", "bundles", selection.bundle,
      `host-vaultwarden-bridge-${randomUUID()}.json`);
    await inspectPrivateHouseholdHost(["host", "inspect", "--output", freshBridgeReport, "--limit", "50",
      "--check-tcp-port", String(selection.backendHostPort)], freshBridgeReport,
      selection.bridge, [selection.backendHostPort]);
    try {
      const revised = await runJsonCli(["bundle", "route-network", "--service", "vaultwarden",
        "--project-root", root, "--input", input, "--host-inspection", freshBridgeReport,
        "--network", selection.bridge, "--approve", selection.bundleApproval],
      "Binding only the Vaultwarden route input");
      revisedApproval = reviewedVaultwardenRoute(revised, selection, selection.bundleApproval);
    } catch {
      note(`Inspect the current bundle plan and Vaultwarden input. The route revision may have completed; do not replay it blindly.`, "Vaultwarden route recovery");
      return false;
    }
  } else {
    const bridgeReport = join(root, ".selfhost", "bundles", selection.bundle,
      `host-vaultwarden-bridge-${randomUUID()}.json`);
    await inspectPrivateHouseholdHost(["host", "inspect", "--output", bridgeReport, "--limit", "50",
      "--check-tcp-port", String(selection.backendHostPort)], bridgeReport,
      selection.bridge, [selection.backendHostPort]);
    note(`The saved Vaultwarden input already names the exact Caddy-owned bridge ${selection.bridge}. No route revision will be replayed.`, "Vaultwarden bridge resumed");
  }
  if (await currentHouseholdApproval(selection) !== revisedApproval) {
    throw new Error("The revised Vaultwarden route did not match the new bundle approval.");
  }
  note(`Caddy transport is running at ${selection.origin}. Exported public CA root: ${selection.caExportPath}. On this Docker host, check that vaultwarden.localhost resolves to loopback and that your intended browser trusts this CA. An HTTP 502 is expected until Vaultwarden starts. Other devices are not covered by this .localhost route.`, "Client checks still required");
  const resolved = stopIfCancelled(await confirm({
    message: "On this host, did you verify vaultwarden.localhost resolves to loopback?", initialValue: false,
  }));
  if (!resolved) return false;
  const trusted = stopIfCancelled(await confirm({
    message: "Did your intended browser trust the exported CA and open the HTTPS origin without a certificate bypass?", initialValue: false,
  }));
  if (!trusted) return false;
  await readCaddy();
  if (await currentHouseholdApproval(selection) !== revisedApproval) {
    throw new Error("The bundle changed before the intended-client trust assertion.");
  }
  const ready = await runJsonCli(["bundle", "https-ready", "--project-root", root,
    "--input", input, "--approve", revisedApproval,
    "--https-route-status", "configured", "--https-trust", "verified-for-intended-client"],
    "Recording your exact intended-client HTTPS assertion");
  const readyApproval = reviewedHttpsReady(ready, selection, revisedApproval);
  if (await currentHouseholdApproval(selection) !== readyApproval) {
    throw new Error("The recorded HTTPS assertion did not match the new bundle plan.");
  }
  note(`Host-only Caddy transport is applied and your client-trust assertion is recorded. New bundle approval: ${readyApproval}. Vaultwarden account setup, application acceptance, Homarr links, and other-device access remain separate gates.`, "Private HTTPS handoff complete");
  return true;
}

async function showHouseholdSummary(root: string, input: string, bundle: string,
  advancedCheckpoints: number): Promise<void> {
  const args = ["--project-root", root, "--input", input];
  try {
    const info = await runJsonCli(["bundle", "info", ...args], "Summarizing this household stack");
    const status = await runJsonCli(["bundle", "status", ...args], "Checking current service phases");
    if (info.schemaVersion !== 1 || info.kind !== "household-bundle-info" || info.bundle !== bundle
      || !Array.isArray(info.services) || info.services.length > 10
      || status.schemaVersion !== 1 || status.kind !== "household-bundle-status"
      || status.bundle !== bundle || status.projectRoot !== root || status.mutation !== false
      || !Array.isArray(status.services) || status.services.length !== 4) {
      throw new Error("The closing summary did not match this bundle.");
    }
    const descriptions: string[] = [];
    for (const entry of info.services) {
      if (!entry || typeof entry !== "object" || typeof entry.name !== "string"
        || typeof entry.purpose !== "string" || typeof entry.url !== "string"
        || entry.name.length > 40 || entry.purpose.length > 160 || entry.url.length > 2048) {
        throw new Error("A service description was not reviewable.");
      }
      const url = new URL(entry.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("A service link was not reviewable.");
      }
      descriptions.push(`${entry.name}: ${entry.purpose} — ${entry.url}`);
    }
    const phases: string[] = [];
    for (const entry of status.services) {
      if (!entry || typeof entry !== "object" || typeof entry.service !== "string"
        || typeof entry.phase !== "string" || entry.service.length > 32 || entry.phase.length > 80) {
        throw new Error("A service phase was not reviewable.");
      }
      phases.push(`${entry.service}: ${entry.phase}`);
    }
    const parallel = status.parallelApply as { status?: unknown; jobs?: unknown } | undefined;
    if (parallel?.status === "recorded" && Array.isArray(parallel.jobs)) {
      for (const job of parallel.jobs) {
        if (!job || typeof job !== "object" || typeof job.id !== "string"
          || typeof job.status !== "string" || job.id.length > 32 || job.status.length > 40) {
          throw new Error("Parallel job progress was not reviewable.");
        }
        phases.push(`${job.id}: ${job.status} (saved job history; inspect its adapter before recovery)`);
      }
    }
    if (parallel?.status === "invalid-needs-inspection") {
      phases.push("parallel app history: invalid; inspect the owner-only record before recovery");
    }
    let dashboardLink: string | null = null;
    if (typeof info.dashboard === "string") {
      const dashboard = new URL(info.dashboard);
      if (!["http:", "https:"].includes(dashboard.protocol) || dashboard.username || dashboard.password
        || dashboard.search || dashboard.hash) throw new Error("The dashboard link was not reviewable.");
      dashboardLink = info.dashboard;
    }
    note(`Advanced ${advancedCheckpoints} reviewed checkpoint(s) in this session.\n\n${descriptions.join("\n")}\n\nCurrent phases:\n${phases.join("\n")}`, "Your household stack");
    if (dashboardLink) note(`Homarr link: ${dashboardLink}\nBoard, widget, and app acceptance are not verified here; do not call this a finished dashboard.`, "Homarr status");
    if (info.credentialFile === join(root, ".selfhost", "bundles", bundle, "private-handoff.env")) {
      note(`Private credential handoff: ${info.credentialFile}\nThe menu does not print its passwords or keys.`, "Credentials");
    }
  } catch {
    note(`The closing summary could not be read safely. Use self-host bundle info --project-root ${root} --input ${input} and bundle status after inspecting the current project.`, "Summary unavailable");
  }
}

function batchProgressSummary(batch: Record<string, unknown>): string {
  if (!Array.isArray(batch.jobs) || !Array.isArray(batch.apps)
    || batch.apps.length !== batch.jobs.length || batch.apps.length < 2 || batch.apps.length > 8
    || typeof batch.withoutHomarr !== "boolean") {
    throw new Error("The saved batch returned an incomplete job and runtime summary.");
  }
  const lines: string[] = [];
  for (let index = 0; index < batch.apps.length; index += 1) {
    const job = batch.jobs[index];
    const app = batch.apps[index];
    if (!job || typeof job !== "object" || !app || typeof app !== "object"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(app.appId))
      || app.id !== job.id || app.appId !== job.appId
      || !["pending", "launch-attempted", "applied", "inspect-checkpoint", "blocked"].includes(String(job.status))
      || !/^[a-z-]{1,24}$/.test(String(app.liveState))
      || typeof app.needsInspection !== "boolean"
      || typeof app.recoveredFromExactState !== "boolean") {
      throw new Error("The saved batch returned an invalid app checkpoint.");
    }
    let line = `${app.appId}: saved ${job.status}; live ${app.liveState}`;
    if (app.needsInspection) line += "; inspect this exact app";
    else line += "; exact running app inspected";
    if (app.recoveredFromExactState) line += "; recovered from exact state";
    if (typeof job.failureCode === "string" && /^[a-z0-9-]{1,64}$/.test(job.failureCode)) {
      line += `; prior failure ${job.failureCode}`;
    }
    lines.push(line);
  }
  if (batch.withoutHomarr === false) {
    if (typeof batch.homarrNeedsInspection !== "boolean") {
      throw new Error("The saved batch omitted its Homarr inspection state.");
    }
    lines.push(batch.homarrNeedsInspection
      ? "Homarr: inspect its exact running project and onboarded board"
      : "Homarr: onboarded project is running; board content still needs its own read-back");
  }
  return lines.join("\n");
}

function batchReviewText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 4096) {
    throw new Error(`The batch resume plan omitted a reviewable ${label}.`);
  }
  return value.replace(/[\u0000-\u001f\u007f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

async function offerPendingBatchResume(root: string, batch: Record<string, unknown>): Promise<boolean> {
  if (batch.ledgerSchemaVersion !== 3 || !Array.isArray(batch.pendingAppIds)
    || !Array.isArray(batch.jobs)) return false;
  if (batch.withoutHomarr === false && batch.homarrNeedsInspection === true) return false;
  const pending = batch.pendingAppIds;
  if (pending.length === 0) return false;
  if (pending.length > 8 || pending.some((id) => typeof id !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
    || !batch.jobs.some((job) => job?.appId === id && job.status === "pending"))) {
    throw new Error("The saved batch has an invalid pending-job list.");
  }
  const selected = stopIfCancelled(await select({
    message: "Review one never-launched batch job for resume?",
    options: [...pending.map((id) => ({ value: id, label: id.replaceAll("-", " ") })),
      { value: "__later__", label: "Not now" }],
  }));
  if (selected === "__later__") return false;
  const plan = await runJsonCli(["app", "batch", "resume-plan", "--project-root", root,
    "--job", selected, "--json"], `Rechecking the pending ${selected} job`);
  const app = plan.pendingAppPlan as Record<string, unknown> | undefined;
  const job = plan.pendingJob as Record<string, unknown> | undefined;
  const compose = app?.compose as Record<string, unknown> | undefined;
  const host = app?.host as Record<string, unknown> | undefined;
  const onboarding = app?.onboarding as Record<string, unknown> | undefined;
  if (plan.command !== "app batch resume-plan" || plan.status !== "planned"
    || plan.mutation !== false || plan.projectRoot !== root
    || plan.selectedJob !== `app-${selected}` || app?.appId !== selected
    || typeof plan.approval !== "string" || !/^BATCH-RESUME:[0-9a-f]{64}$/.test(plan.approval)
    || !Array.isArray(app.servicePurposes) || !Array.isArray(app.remainingGates)
    || !Array.isArray(job?.owns) || !Array.isArray(job.needs) || !Array.isArray(job.gates)
    || !Array.isArray(plan.applyArgs)) {
    throw new Error("The pending batch resume plan did not match this project and app.");
  }
  const expected = ["self-host", "app", "batch", "resume", "--project-root", root,
    "--job", selected, "--approve", plan.approval, "--json"];
  if (JSON.stringify(plan.applyArgs) !== JSON.stringify(expected)) {
    throw new Error("The pending batch resume command changed during review.");
  }
  const purposes = app.servicePurposes.map((service) => {
    if (!service || typeof service !== "object") throw new Error("The pending app omitted a service purpose.");
    return `${batchReviewText(service.id, "service ID")}: ${batchReviewText(service.purpose, "service purpose")}`;
  });
  let images: unknown[] = [];
  if (typeof app.image === "string") images = [app.image];
  else if (app.images && typeof app.images === "object" && !Array.isArray(app.images)) {
    images = Object.entries(app.images).map(([service, image]) => {
      if (typeof image !== "string") throw new Error("The pending app returned an invalid pinned image.");
      return `${service}=${image}`;
    });
  }
  if (!Array.isArray(images) || images.length < 1 || images.some((image) => typeof image !== "string")) {
    throw new Error("The pending app omitted its pinned images.");
  }
  let administrator = "";
  if (onboarding) {
    administrator = `\nFirst administrator: ${batchReviewText(onboarding.username, "administrator username")}`;
    if (onboarding.name !== null && onboarding.name !== undefined) {
      administrator += `; name ${batchReviewText(onboarding.name, "administrator name")}`;
    }
    if (onboarding.email !== null && onboarding.email !== undefined) {
      administrator += `; email ${batchReviewText(onboarding.email, "administrator email")}`;
    }
    administrator += `; private credential file ${batchReviewText(onboarding.passwordFile, "credential file")}`;
  }
  note(`Job: app-${selected}\nOriginal batch: ${batchReviewText(plan.originalBatchApproval, "original approval")}`
    + `\nCatalog: ${batchReviewText(plan.catalogPlanId, "catalog plan")}`
    + (plan.homarrProjectId
      ? `\nHomarr: project ${batchReviewText(plan.homarrProjectId, "Homarr project")} on private bridge ${batchReviewText(plan.homarrNetwork, "Homarr network")}; board verification remains separate`
      : "\nHomarr: off; no dashboard attachment")
    + `\nCompose: ${batchReviewText(compose?.projectId, "Compose project")}`
    + `\nPort: ${batchReviewText(compose?.publishedPort, "private port")}`
    + `\nData: ${batchReviewText(compose?.dataDirectory, "data directory")}`
    + `\nDocker context: ${batchReviewText(host?.dockerContext, "Docker context")}`
    + administrator
    + `\nServices:\n${purposes.join("\n")}`
    + `\nImages:\n${images.map((image) => batchReviewText(image, "pinned image")).join("\n")}`
    + `\nOwns:\n${job.owns.map((resource) => batchReviewText(resource, "owned resource")).join("\n")}`
    + `\nPrerequisites: ${job.needs.length ? job.needs.map((need) => batchReviewText(need, "prerequisite")).join(", ") : "none"}`
    + `\nGates:\n${job.gates.map((gate) => batchReviewText(gate, "job gate")).join("\n")}`
    + `\nApp checks still due:\n${app.remainingGates.map((gate) => batchReviewText(gate, "app gate")).join("\n")}`
    + `\nResume approval: ${plan.approval}`
    + "\nOnly this pending job will start. Account, function, restart, and Homarr board checks remain separate.",
  "Review pending batch job");
  const approved = stopIfCancelled(await confirm({
    message: `Approve the exact pending ${selected} job?`, initialValue: false,
  }));
  if (!approved) {
    outro("Plan only. No batch job was started.");
    return true;
  }
  const result = await runJsonCli(expected.slice(1), `Dispatching the approved ${selected} job`);
  if (result.command !== "app batch resume" || result.projectRoot !== root
    || result.selectedJob !== `app-${selected}` || result.mutation !== true
    || !["job-applied-unverified", "job-needs-inspection"].includes(String(result.status))) {
    throw new Error("The batch resume result needs exact app inspection before any further work.");
  }
  note(`${selected}: ${String(result.status)}\nSaved ledger: ${batchReviewText(result.ledgerPath, "ledger path")}`
    + "\nInspect this app's live status and finish its separate acceptance checks. Attempted jobs are not replayed.",
  "Batch resume checkpoint");
  if (result.status === "job-applied-unverified") {
    await continueAppliedBatchApp(root, selected, batch.withoutHomarr === false);
  }
  outro("Resume a project again for any other saved job. No account, function, restart, or Homarr board acceptance was inferred.");
  return true;
}

async function resumeFlow(existingRoot?: string) {
  const root = existingRoot ?? await chooseRoot(false);
  if (existsSync(join(root, ".selfhost", "app-batch.json"))) {
    const batch = await runJsonCli(["app", "batch", "status", "--project-root", root,
      "--json"], "Inspecting the saved app batch");
    if (batch.command !== "app batch status" || batch.projectRoot !== root
      || !Array.isArray(batch.jobs) || !Array.isArray(batch.apps)) {
      throw new Error("The saved app batch status did not match this project.");
    }
    const progress = batchProgressSummary(batch);
    const recovered = Array.isArray(batch.recoveredJobs)
      ? batch.recoveredJobs.filter((id): id is string => typeof id === "string") : [];
    const recovery = recovered.length
      ? `\nReconciled from exact running app state: ${recovered.join(", ")}. Historical batch outcomes remain unchanged.` : "";
    note(`Batch: ${String(batch.status)}\n${progress}${recovery}\n`
      + "Saved job progress is not application acceptance. Attempted or partial jobs are never replayed automatically; inspect each exact app status before a separate recovery approval.",
    "Saved app batch");
    const hasOtherOwner = existsSync(join(root, ".selfhost", "bundles"))
      || existsSync(join(root, ".selfhost", "cli.json"))
      || existsSync(join(root, ".selfhost", "stack.json"));
    if (!hasOtherOwner && await offerPendingBatchResume(root, batch)) return;
  }
  if (existsSync(join(root, ".selfhost", "bundles"))) {
    const input = await chooseBundleInput(root);
    if (!input) {
      if (await showPartialJourney(root)) return;
      throw new Error("This project has a bundles directory but no complete household input. Inspect its owner-only artifacts before continuing.");
    }
    let inbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input], "Inspecting the household checkpoint");
    if (inbox.kind !== "household-bundle-approvals" || inbox.projectRoot !== root) {
      throw new Error("The household checkpoint returned an invalid review inbox.");
    }
    let reviewedFirewallKey: string | null = null;
    let approvedCycles = 0;
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const current = inbox.current as { checkpoint?: string; service?: string; reason?: string; afterApproval?: string;
        review?: Record<string, unknown> | null; reviewCommand?: string[] | null; command?: string[] | null } | undefined;
      if (!current?.checkpoint) throw new Error("The household checkpoint is missing its next action.");
      const lines = [`Checkpoint: ${current.checkpoint}`, `Owner: ${current.service ?? "bundle"}`];
      if (current.reason) lines.push(current.reason);
      if (current.review) lines.push(`Review facts: ${JSON.stringify(current.review)}`);
      if (current.reviewCommand) lines.push(`Full read-only review (argv): ${JSON.stringify(current.reviewCommand)}`);
      else if (current.command) lines.push(`Next command (argv): ${JSON.stringify(current.command)}`);
      if (current.afterApproval) lines.push(current.afterApproval);
      note(lines.join("\n"), "Household progress");
      const firewallKey = householdAdoptedAllInterfaceKey(inbox, root);
      if (firewallKey && reviewedFirewallKey !== firewallKey) {
        const mediaReview = inbox.bundleReview as { mediaPorts: number[]; mediaSelection: { runId: string } };
        note(`Existing run: ${mediaReview.mediaSelection.runId}\nBind: every host interface (0.0.0.0)\nPorts: ${mediaReview.mediaPorts.join(", ")}\nCheck the actual router or Docker-aware firewall policy for these ports.`, "Review existing media exposure");
        const verified = stopIfCancelled(await confirm({
          message: "Have you verified private router or Docker-aware firewall rules for the existing all-interface media ports?",
          initialValue: false,
        }));
        if (!verified) {
          outro("No checkpoint was approved. Verify the existing media exposure before continuing.");
          return;
        }
        reviewedFirewallKey = firewallKey;
      }
      const firewallConfirmed = firewallKey !== null && reviewedFirewallKey === firewallKey;
      if (current.checkpoint === "bind-media-web") {
        if (!await bindMediaWeb(root, input, inbox)) break;
        approvedCycles += 1;
        inbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input],
          "Refreshing the revised household checkpoint");
        if (inbox.kind !== "household-bundle-approvals" || inbox.projectRoot !== root) {
          throw new Error("The revised household checkpoint did not match this project.");
        }
        continue;
      }
      if (current.checkpoint === "review-immich-apply") {
        const parallelResult = await offerParallelApps(root, input, inbox);
        if (parallelResult === "stopped") break;
        if (parallelResult === "applied") {
          approvedCycles += 1;
          inbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input],
            "Refreshing after both initial app applies");
          if (inbox.kind !== "household-bundle-approvals" || inbox.projectRoot !== root) {
            throw new Error("The refreshed household checkpoint did not match this project.");
          }
          continue;
        }
      }
      if (current.checkpoint === "verify-vaultwarden-private-https") {
        if (!await configureLocalHttps(root, input, inbox)) break;
        approvedCycles += 1;
        inbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input],
          "Refreshing after the private HTTPS assertion");
        if (inbox.kind !== "household-bundle-approvals" || inbox.projectRoot !== root) {
          throw new Error("The private HTTPS checkpoint did not match this project.");
        }
        continue;
      }
      const runArgs = householdReviewRunArgs(inbox, root, firewallConfirmed);
      const reviewArgs = householdFullReviewArgs(inbox, root, firewallConfirmed);
      if (!runArgs || !reviewArgs) break;
      const fullReview = await runJsonCli(reviewArgs, "Reading the full exact review plan");
      if (fullReview.mutation !== false || JSON.stringify(fullReview).length > 32768) {
        throw new Error("The full review was not a bounded read-only plan. Use its exact review command outside this menu; nothing was approved.");
      }
      if (["review-bundle-plan", "prepare-media-plan"].includes(current.checkpoint)
        && (fullReview.kind !== "household-bundle-plan" || fullReview.projectRoot !== root
          || fullReview.approval !== inbox.bundleApproval)) {
        throw new Error("The bundle plan changed during review. Refresh approvals before continuing.");
      }
      note(JSON.stringify(fullReview, null, 2), "Full exact review");
      const refreshed = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input], "Checking that approval is still current");
      if (householdAdoptedAllInterfaceKey(refreshed, root) !== firewallKey
        || JSON.stringify(householdReviewRunArgs(refreshed, root, firewallConfirmed)) !== JSON.stringify(runArgs)) {
        throw new Error("The approval changed during review. Reopen Resume a project; nothing was applied.");
      }
      const approve = stopIfCancelled(await confirm({
        message: `Approve only this ${current.service ?? "bundle"} checkpoint and advance until the next gate?`, initialValue: false,
      }));
      if (!approve) break;
      const previousCheckpoint = JSON.stringify(inbox.current);
      const result = await runJsonCli(runArgs, "Running one bounded household cycle");
      if (result.kind !== "household-bundle-run" || result.projectRoot !== root || result.bundle !== inbox.bundle) {
        throw new Error("The bundle runner returned an unexpected project. Inspect bundle approvals before continuing.");
      }
      approvedCycles += 1;
      showHouseholdRunResult(result);
      inbox = await runJsonCli(["bundle", "approvals", "--project-root", root, "--input", input], "Refreshing the household checkpoint");
      if (inbox.kind !== "household-bundle-approvals" || inbox.projectRoot !== root) {
        throw new Error("The refreshed household checkpoint did not match this project.");
      }
      const updated = inbox.current as { checkpoint?: string; service?: string } | undefined;
      note(`Next: ${updated?.checkpoint ?? "unknown"} (${updated?.service ?? "bundle"})`, "Remaining work");
      if (result.status === "stage-failed" || result.status === "stalled"
        || JSON.stringify(inbox.current) === previousCheckpoint) break;
    }
    if (approvedCycles === 12) note("Stopped after 12 separately approved review cycles. Resume this project to continue.", "Session limit");
    await showHouseholdSummary(root, input, String(inbox.bundle), approvedCycles);
    outro(`Use self-host bundle approvals --project-root ${root} --input ${input} for the full current gate. HTTPS, browser setup, Homarr and acceptance are never inferred from container liveness.`);
    return;
  }
  if (await showPartialJourney(root)) return;
  const appIds = await savedAppIds(root);
  if (appIds.length > 0) {
    const appId = appIds.length === 1 ? appIds[0] : stopIfCancelled(await select({
      message: "Which saved app project should be resumed?",
      options: appIds.map((id) => ({ value: id, label: id.replaceAll("-", " ") })),
    }));
    const status = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--json"],
      `Inspecting the saved ${appId} project`);
    if (status.command !== "app status" || status.appId !== appId || status.projectRoot !== root
      || !["approved", "rendered", "applied"].includes(String(status.status))) {
      throw new Error("The saved app status did not match this project.");
    }
    const credentialRef = status.credentialRef ?? status.passwordFile ?? "not prepared";
    note(`Stage: ${String(status.status)}\nProject: ${String(status.projectId)}\nURL: ${String(status.url)}\nData: ${String(status.dataDirectory)}\nCredentials: ${String(credentialRef)}\nLast recorded lifecycle: ${String(status.lastRecordedLifecycle ?? "unknown")}\nApplication acceptance is not inferred from this checkpoint.`, `${appId} project`);
    const approvals = status.approvals as { resume?: unknown; up?: unknown; down?: unknown } | null;
    if (status.status !== "applied") {
      if (typeof approvals?.resume !== "string" || !approvals.resume.startsWith(`APP-APPLY:${appId}:`)) {
        throw new Error("The partial app checkpoint has no exact resume approval.");
      }
      const approve = stopIfCancelled(await confirm({
        message: "Resume only this saved app apply after fresh host inspection?", initialValue: false,
      }));
      if (!approve) {
        outro(`No Docker change was requested. Use self-host app status --id ${appId} --project-root ${root} --json.`);
        return;
      }
      const resumed = await runJsonCli(["app", "resume", "--id", appId, "--project-root", root,
        "--approve", approvals.resume, "--json"], `Resuming the exact ${appId} checkpoint`);
      if (resumed.command !== "app resume" || resumed.appId !== appId
        || resumed.status !== "applied-unverified" || resumed.acceptanceVerified !== false) {
        throw new Error("The app resume result needs direct inspection before any further action.");
      }
      if (appId === "immich") {
        await continueImmichSetup(root);
        return;
      }
      if (appId === "paperless-ngx") {
        await continuePaperlessSetup(root);
        return;
      }
      if (appId === "homarr") {
        await continueHomarrSetup(root);
        return;
      }
      if (appId === "uptime-kuma") {
        await continueUptimeSetup(root);
        return;
      }
      outro(`${appId} resumed at ${String(resumed.url)}. Check its account and app-specific acceptance before calling it ready.`);
      return;
    }
    const actions = [
      { value: "inspect", label: "Keep running; show next checks" },
      { value: "up", label: "Start this project", hint: "Uses a separate exact approval" },
      { value: "down", label: "Stop this project", hint: "Preserves its data" },
    ];
    if (typeof status.homarrNetwork === "string" && appId !== "homarr") {
      actions.unshift({ value: "homarr-tile", label: "Add or check its Homarr tile", hint: "Separate board approval and read-back" });
    }
    if (appId === "immich") {
      actions.unshift({ value: "finish-setup", label: "Continue Immich account and setup closure", hint: "Separate approvals" });
    }
    if (appId === "paperless-ngx") {
      actions.unshift({ value: "finish-setup", label: "Continue Paperless checks and cleanup", hint: "Login, OCR, restart, and separate approvals" });
    }
    if (appId === "uptime-kuma") {
      actions.unshift({ value: "finish-setup", label: "Create or verify Uptime Kuma admin", hint: "Uses the saved password and one exact approval" });
    }
    if (appId === "homarr") {
      actions.unshift({ value: "finish-setup", label: "Continue Homarr onboarding", hint: "Admin, board setup, and API key" });
    }
    const action = stopIfCancelled(await select({
      message: `What should happen to this exact ${appId} project?`,
      options: actions,
    }));
    if (action === "finish-setup") {
      if (appId === "immich") await continueImmichSetup(root);
      if (appId === "paperless-ngx") await continuePaperlessSetup(root);
      if (appId === "homarr") await continueHomarrSetup(root);
      if (appId === "uptime-kuma") await continueUptimeSetup(root);
      return;
    }
    if (action === "homarr-tile") {
      await offerHomarrTile(root, appId);
      outro("The app project was not restarted. Homarr board rendering and integration-backed widgets need their own checks.");
      return;
    }
    if (action === "inspect") {
      outro(`No Docker change was requested. Open ${String(status.url)}; credentials are at ${String(credentialRef)}. Verify the account and app-specific checks separately.`);
      return;
    }
    const approval = action === "up" ? approvals?.up : approvals?.down;
    if (typeof approval !== "string" || !approval.startsWith(`APP-${action.toUpperCase()}:${appId}:`)) {
      throw new Error("The app lifecycle approval did not match the selected action.");
    }
    note(`Action: ${action}\nProject: ${String(status.projectId)}\nCompose: ${String(status.composeTarget)}\nData retained: ${String(status.dataDirectory)}\nApproval: ${approval}`, "Review exact lifecycle");
    const approve = stopIfCancelled(await confirm({
      message: `Approve only this ${appId} ${action} action?`, initialValue: false,
    }));
    if (!approve) {
      outro("No Docker change was requested.");
      return;
    }
    const result = await runJsonCli(["app", action, "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], `Running the exact ${appId} ${action} action`);
    if (result.command !== `app ${action}` || result.appId !== appId
      || result.projectId !== status.projectId || result.acceptanceVerified !== false) {
      throw new Error("The app lifecycle result did not match the saved project. Inspect status.");
    }
    outro(`${appId}: ${String(result.status)}. Data remains at ${String(status.dataDirectory)}. Check ${String(status.url)} and verify the app-specific acceptance separately.`);
    return;
  }
  const result = invoke(["state", "resume", "--project-root", root]);
  const data = result.data ?? {};
  showPlan(data);
  const appCommands = plannedAppCommands(data);
  if (appCommands.length > 0) {
    note(appCommands.map((app) => `self-host ${app} help`).join("\n"), "Separate Linux adapter entry points");
  }
  outro(`Saved choices were inspected. No live deployment checkpoint exists in ${root}; recheck the host before applying anything.`);
}

async function installMediaFlow() {
  if (process.platform !== "linux") {
    note("The media apply adapter currently requires a Linux Docker host. Plan on this computer, then run the installer on that host.", "Platform limit");
    outro("No services were changed.");
    return;
  }
  const diagnostic = runCli(["doctor", "--scope", "media", "--json"]);
  let doctor: { status: string; tools: Array<{ tool: string; required: boolean; ok: boolean }> };
  try { doctor = JSON.parse(diagnostic.stdout); }
  catch { throw new Error("The prerequisites check did not return valid JSON."); }
  if (!doctor || !Array.isArray(doctor.tools)) throw new Error("The prerequisites check returned an invalid result.");
  if (diagnostic.status !== 0 || doctor.status !== "ready") {
    note(doctor.tools.filter((tool) => tool.required && !tool.ok).map((tool) => tool.tool).join("\n") || "Unknown prerequisite failure", "Fix these first");
    outro("Run self-host doctor --scope media after installing the missing tools. No setup was started.");
    return;
  }
  const root = await chooseRoot(true);
  if (existsSync(join(root, ".selfhost", "cli.json"))) {
    note(`An existing media run belongs to ${root}. Use self-host status and info before resuming; this menu will not overwrite it.`, "Existing project");
    outro("No new run was created.");
    return;
  }
  if (existsSync(join(root, ".selfhost", "bundles"))) {
    note(`A household bundle already exists in ${root}. Use self-host bundle next instead of creating a second media deployment.`, "Existing project");
    outro("No new run was created.");
    return;
  }
  const catalogPlan = invoke(planArgs(["personal-media"], [], root, [])).data;
  if (!catalogPlan || !mediaCatalogSupported(catalogPlan)) {
    throw new Error("The catalog no longer describes the exact seven-service media installer. Review the changed catalog before setup.");
  }
  const runId = stopIfCancelled(await text({
    message: "Name this media run",
    placeholder: "home-media (press Enter to use)",
    validate(value) {
      if (value && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)) return "Use 1–40 lowercase letters, digits, _ or -.";
    },
  })) || "home-media";
  const username = stopIfCancelled(await text({
    message: "Administrator username",
    placeholder: "admin (press Enter to use)",
    validate(value) {
      if (value && !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(value)) return "Use 3–64 letters, digits, _, . or -.";
    },
  })) || "admin";
  const exposure = stopIfCancelled(await select({
    message: "Who should reach the seven service ports?",
    options: [
      { value: "host-only", label: "This host only", hint: "A separate approved private route can serve other devices" },
      { value: "all-interfaces", label: "All host interfaces (advanced)", hint: "Requires a verified private router or Docker-aware firewall policy" },
    ],
  }));
  let firewallScope: string | null = null;
  if (exposure === "all-interfaces") {
    firewallScope = stopIfCancelled(await select({
      message: "Which private firewall policy did you verify?",
      options: [
        { value: "router-private", label: "Private router rules" },
        { value: "docker-aware-private", label: "Docker-aware host firewall" },
      ],
    }));
    const verified = stopIfCancelled(await confirm({
      message: "Have you verified those rules on this host and its network?", initialValue: false,
    }));
    if (!verified) {
      outro("No media run was created. Choose host-only access or verify the private firewall first.");
      return;
    }
  }
  const deferIndexer = stopIfCancelled(await confirm({
    message: "Leave search sources for a separate authorized choice?", initialValue: true,
  }));
  note(`Project: ${root}\nRun: ${runId}\nAdministrator: ${username}\nExposure: ${exposure}\nSearch sources: ${deferIndexer ? "deferred" : "must be configured and verified"}\nA generated password will be kept in the private credential handoff.`, "Review setup");
  const prepare = stopIfCancelled(await confirm({
    message: "Create the private media plan? This does not start containers.", initialValue: false,
  }));
  if (!prepare) {
    outro("No media run was created.");
    return;
  }
  const configuration = ["config", "init", "--project-root", root, "--profile", "media", "--run-id", runId,
    "--username", username, "--credential-handoff", "yes"];
  if (exposure === "host-only") configuration.push("--media-bind-mode", "host-only");
  const configured = runCli(configuration);
  if (configured.status !== 0) throw new Error(`Media config could not be created. Inspect ${root} and run self-host status before retrying.`);
  const prepared = runCli(["up", "--project-root", root]);
  if (prepared.status !== 0) throw new Error(`Media preparation stopped. Run self-host install media diagnose --project-root ${root} --run-id ${runId}; do not create a second run.`);
  let parsedPlan: unknown;
  try { parsedPlan = JSON.parse(prepared.stdout); }
  catch { throw new Error("Media preparation did not return a parseable plan. Inspect self-host info before applying."); }
  const plan = reviewedMediaPlan(parsedPlan, exposure);
  note(`Approval digest: ${plan.approvalDigest}\nPublished: ${plan.publishedPorts}\nPorts: ${Object.entries(plan.ports).map(([app, port]) => `${app} ${port}`).join(", ")}`, "Exact media plan");
  const apply = stopIfCancelled(await confirm({
    message: "Approve this exact plan and start the media stack now?", initialValue: false,
  }));
  if (!apply) {
    outro(`Prepared only. To continue later: self-host up --project-root ${root} --approve ${plan.approvalDigest}`);
    return;
  }
  const command = ["up", "--project-root", root, "--approve", plan.approvalDigest];
  if (firewallScope) command.push("--firewall-scope", firewallScope);
  if (deferIndexer) command.push("--defer-indexer");
  const result = await runLive(command);
  if (result === 0) {
    outro(`Media setup finished. Run self-host status --project-root ${root} and self-host info --project-root ${root}; the latter shows the private credential-handoff path.`);
    return;
  }
  if (result === 2 && deferIndexer) {
    outro(`Media is pending the separate search-source choice. Run self-host status --project-root ${root}; do not claim full acceptance yet.`);
    process.exitCode = 2;
    return;
  }
  throw new Error(`Media setup stopped at a recorded stage. Diagnose with self-host install media diagnose --project-root ${root} --run-id ${runId}, then use its exact resume command.`);
}

export async function offerHomarrMcp(root: string, url: string, projectId?: string,
  runMcpCli: typeof runJsonCli = runJsonCli): Promise<void> {
  const selected = await confirm({
    message: "Prepare an optional read-only Homarr MCP profile for your coding agent? No client config is changed.",
    initialValue: false,
  });
  if (isCancel(selected) || !selected) return;
  let handoff: Record<string, unknown>;
  let handoffArgs = ["app", "handoff", "--id", "homarr", "--project-root", root, "--json"];
  let handoffCommand = "app handoff";
  if (projectId !== undefined) {
    handoffArgs = ["app", "shared", "handoff", "--app", "homarr", "--project-root", root,
      "--project-id", projectId, "--json"];
    handoffCommand = "app shared handoff";
  }
  try {
    handoff = await runMcpCli(handoffArgs,
      "Locating Homarr's private saved API key");
  } catch (error) {
    note(String(error), "MCP profile pending");
    return;
  }
  if (handoff.command !== handoffCommand || handoff.appId !== "homarr"
    || handoff.url !== url || handoff.secretful !== false
    || typeof handoff.apiKeyFile !== "string" || !isAbsolute(handoff.apiKeyFile)) {
    note("This project's verified private API key handoff was unavailable. Inspect app handoff before retrying.",
      "MCP profile pending");
    return;
  }
  if (projectId !== undefined && (handoff.ownerKind !== "shared" || handoff.projectRoot !== root
    || handoff.projectId !== projectId || handoff.mutation !== false
    || !isAbsolute(root) || resolve(root) !== root
    || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)
    || handoff.privateFiles !== join(root, ".selfhost", "shared", projectId, "secrets", "homarr")
    || handoff.apiKeyFile !== join(root, ".selfhost", "shared", projectId, "secrets", "homarr", "homarr-api-key"))) {
    note("The private API key reference differs from this exact shared Homarr owner. Inspect app shared handoff before retrying.",
      "MCP profile pending");
    return;
  }
  const profile = "read-only";
  const base = ["--project-root", root, "--profile", profile];
  let prepared: Record<string, unknown>;
  try {
    prepared = await runMcpCli(["homarr", "mcp", "prepare", ...base, "--base-url", url,
      "--api-key-file", handoff.apiKeyFile, "--require-read-only", "--json"],
    "Preparing the read-only Homarr MCP profile");
  } catch (error) {
    note(String(error), "MCP profile pending");
    return;
  }
  if (prepared.command !== "homarr mcp prepare" || prepared.status !== "ready"
    || prepared.capabilityMode !== "read-only") {
    note("The saved profile was not confirmed read-only. Inspect it before connecting a coding agent.", "MCP profile pending");
    return;
  }
  try {
    const verified = await runMcpCli(["homarr", "mcp", "verify", ...base, "--json"],
      "Checking Homarr's authenticated MCP endpoint and bridge");
    if (verified.command !== "homarr mcp verify" || verified.status !== "verified"
      || verified.capabilityMode !== "read-only") {
      throw new Error("The MCP verifier did not confirm the read-only profile.");
    }
  } catch (error) {
    note(`${String(error)}\nThe private profile remains saved. Dashboard setup and MCP verification are separate.`,
      "MCP verification pending");
    return;
  }
  const format = await select({
    message: "Generate a secret-free MCP client fragment? Installing it remains a separate choice.",
    options: [
      { value: "skip", label: "Not now" },
      { value: "codex", label: "Codex" },
      { value: "claude-code", label: "Claude Code" },
      { value: "pi", label: "Pi" },
      { value: "generic-json", label: "Generic JSON" },
      { value: "generic-toml", label: "Generic TOML" },
    ],
  });
  if (isCancel(format) || format === "skip") {
    note("Read-only MCP verified. Run self-host homarr mcp fragment later to make a client entry.", "Homarr MCP");
    return;
  }
  let fragment: Record<string, unknown>;
  try {
    fragment = await runMcpCli(["homarr", "mcp", "fragment", ...base, "--format", format,
      "--json"], "Writing a secret-free MCP client fragment");
  } catch (error) {
    note(String(error), "MCP fragment pending");
    return;
  }
  if (fragment.command !== "homarr mcp fragment" || fragment.status !== "generated"
    || fragment.capabilityMode !== "read-only" || typeof fragment.fragmentPath !== "string"
    || fragment.installed !== false) {
    note("The MCP fragment result needs inspection before client installation.", "MCP fragment pending");
    return;
  }
  note(`Read-only MCP verified. Client fragment: ${fragment.fragmentPath}\nIt is not installed in ${format}; review the target config and approve INSTALL-MCP:${profile} separately.`,
    "Homarr MCP");
}

async function continueHomarrSetup(root: string, inAppJourney = false): Promise<boolean> {
  const finish = (message: string) => {
    if (inAppJourney) note(message, "Homarr setup");
    else outro(message);
  };
  const appId = "homarr";
  const status = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--json"],
    "Reading the saved Homarr setup checkpoint");
  if (status.command !== "app status" || status.appId !== appId || status.projectRoot !== root
    || status.status !== "applied" || typeof status.passwordFile !== "string"
    || typeof status.url !== "string") {
    throw new Error("Homarr has no applied exact project to continue. Inspect app status.");
  }
  if (status.lastRecordedLifecycle === "stopped") {
    finish(`Homarr is stopped. Review self-host app status --id homarr --project-root ${root} --json and approve its exact app up before onboarding.`);
    return false;
  }
  if (status.homarrSetup?.stage === "complete") {
    showSavedAppRecap(root, appId);
    await offerHomarrMcp(root, String(status.url));
    finish(`Homarr admin and API key were recorded at ${String(status.url)}. Board content, integrations, widgets, Notebook, and restart persistence still need separate checks. Credential handoff: self-host app handoff --id homarr --project-root ${root} --show.`);
    return true;
  }
  const approval = status.approvals?.onboard;
  if (typeof approval !== "string" || !approval.startsWith("APP-ONBOARD:homarr:")) {
    throw new Error("Homarr onboarding has no exact saved approval.");
  }
  note(`URL: ${String(status.url)}\nAdministrator: ${String(status.username)}\nPassword file: ${status.passwordFile}\nApproval: ${approval}\nAn uncertain prior request is inspected before any retry.`,
    "Review Homarr onboarding");
  const approve = stopIfCancelled(await confirm({
    message: "Create or verify only this Homarr administrator, personal board setup, and private API key?",
    initialValue: false,
  }));
  if (!approve) {
    finish(`Homarr remains at its saved checkpoint. Resume here or inspect self-host app status --id homarr --project-root ${root} --json.`);
    return false;
  }
  let result: Record<string, any>;
  try {
    result = await runJsonCli(["app", "onboard", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Creating or verifying the private Homarr administrator");
  } catch {
    finish(`Homarr onboarding did not finish. Inspect self-host app status --id homarr --project-root ${root} --json before retrying; an attempted step may need manual recovery.`);
    return false;
  }
  if (result.command !== "app onboard" || result.appId !== appId
    || result.status !== "admin-and-api-key-verified" || result.adminVerified !== true
    || result.apiKeyVerified !== true || result.acceptanceVerified !== false
    || typeof result.url !== "string") {
    throw new Error("Homarr onboarding returned an unexpected checkpoint. Inspect app status.");
  }
  showSavedAppRecap(root, appId);
  await offerHomarrMcp(root, String(result.url));
  finish(`Homarr admin and private API key are ready at ${String(result.url)}. Use self-host app handoff --id homarr --project-root ${root} --show for credentials. Board content, integrations, widgets, Notebook, and restart persistence still need separate checks.`);
  return true;
}

async function offerHomarrTile(root: string, appId: string, localOnly = false): Promise<string | null> {
  let app: Record<string, unknown>;
  try {
    app = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--live", "--json"],
      "Checking the owned app before Homarr attachment");
  } catch {
    note(`The exact ${appId} runtime could not be checked. Add its Homarr tile after app status --live succeeds.`,
      "Dashboard attachment deferred");
    return null;
  }
  const runtime = app.runtime as { state?: unknown } | null;
  const localHref = typeof app.port === "number" ? `http://127.0.0.1:${app.port}` : null;
  let localBookmarkHref: string | null = null;
  if (localHref !== null) localBookmarkHref = new URL(localHref).href;
  if (app.status !== "applied" || runtime?.state !== "running"
    || (localOnly && (app.homarrNetwork !== null || localHref === null || app.url !== localHref))
    || (!localOnly && typeof app.homarrNetwork !== "string")) {
    note(localOnly
      ? "The app is not confirmed running at its exact loopback URL without a Homarr bridge. Its local-only bookmark was not changed."
      : "The app is not confirmed running on Homarr's approved bridge. Its dashboard tile was not changed.",
      "Dashboard attachment deferred");
    return null;
  }
  const attach = stopIfCancelled(await confirm({
    message: localOnly
      ? `Add a local-host-only ${appId} bookmark to Homarr's private board? No network bridge or integration is configured.`
      : `Add ${appId} to Homarr's private board now? A server-only link needs no LAN or DNS details.`,
    initialValue: true,
  }));
  if (!attach) return null;
  let prepared: Record<string, unknown>;
  let repairLink = false;
  const inputDirectory = join(root, ".selfhost", "homarr-attach");
  const savedInput = existsSync(join(inputDirectory, `${appId}.v2.json`))
    || existsSync(join(inputDirectory, `${appId}.json`));
  if (localOnly) {
    prepared = await runJsonCli(["app", "homarr-input", "--id", appId,
      "--project-root", root, "--json"], "Preparing local-only Homarr input");
  } else if (savedInput) {
    prepared = await runJsonCli(["app", "homarr-input", "--id", appId,
      "--project-root", root, "--json"], "Reusing the exact saved Homarr input");
    const existingInputFile = prepared.inputFile;
    const revisionNames = (await readdir(inputDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${appId}.route-`)
        && /^[a-f0-9]{64}\.v2\.json$/.test(entry.name.slice(`${appId}.route-`.length)))
      .map((entry) => entry.name).sort();
    if (revisionNames.length > 8) {
      throw new Error("Too many saved Homarr link revisions to select safely. Inspect them with homarr attach status before resuming.");
    }
    const currentRevisions: { inputFile: string; href: string; credentialFile: string | null }[] = [];
    for (const name of revisionNames) {
      const candidate = join(inputDirectory, name);
      const inspected = runCli(["homarr", "attach", "plan", "--input", candidate,
        "--api-key-file", String(prepared.apiKeyFile), "--repair-existing-link"]);
      if (inspected.status !== 0) continue;
      try {
        const candidatePlan = JSON.parse(inspected.stdout) as {
          status?: unknown; service?: { id?: unknown; href?: unknown; credentialFile?: unknown };
          resources?: { linkUpdate?: unknown; appId?: unknown; tileId?: unknown };
        };
        if (candidatePlan.status === "pass" && candidatePlan.service?.id === appId
          && typeof candidatePlan.service.href === "string"
          && candidatePlan.service.credentialFile === prepared.credentialFile
          && candidatePlan.resources?.linkUpdate === null
          && typeof candidatePlan.resources.appId === "string"
          && typeof candidatePlan.resources.tileId === "string") {
          currentRevisions.push({ inputFile: candidate, href: candidatePlan.service.href,
            credentialFile: candidatePlan.service.credentialFile as string | null });
        }
      } catch { /* Invalid revision output cannot select the current link. */ }
    }
    if (currentRevisions.length > 1) {
      throw new Error("Multiple saved Homarr link revisions match this app. Inspect them before resuming.");
    }
    if (currentRevisions.length === 1) {
      prepared = { ...prepared, ...currentRevisions[0], access: "route-unverified" };
      repairLink = true;
    }
    const revisedHref = stopIfCancelled(await text({
      message: `Saved link: ${String(prepared.href)}. Enter to keep it, type a browser URL to review a link change, or type later to defer.`,
      placeholder: "Enter to keep the saved link",
      validate(value) {
        if (!value || value === "later") return;
        try {
          const parsed = new URL(value);
          if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
            || parsed.search || parsed.hash || /[\u0000-\u001f\u007f]/.test(value)) {
            return "Use a credential-free HTTP(S) URL without query or fragment.";
          }
        } catch { return "Enter an absolute HTTP(S) URL, leave blank, or type later."; }
      },
    }));
    if (revisedHref === "later") return null;
    if (revisedHref && revisedHref !== prepared.href) {
      prepared = await runJsonCli(["app", "homarr-input", "--id", appId,
        "--project-root", root, "--href", revisedHref, "--route-revision", "--json"],
      "Preparing an immutable browser-link revision");
      if (prepared.revisionOf !== existingInputFile) {
        throw new Error("Homarr link revision changed the saved attachment source.");
      }
      repairLink = true;
    }
  } else {
    const href = stopIfCancelled(await text({
      message: "Browser URL, if you already have one (Enter = server-only link; type later to defer)",
      placeholder: "https://app.example.com (optional)",
      validate(value) {
        if (!value || value === "later") return;
        try {
          const parsed = new URL(value);
          if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
            || parsed.search || parsed.hash || /[\u0000-\u001f\u007f]/.test(value)) {
            return "Use a credential-free HTTP(S) URL without query or fragment.";
          }
        } catch { return "Enter an absolute HTTP(S) browser URL or leave this blank."; }
      },
    }));
    if (href === "later") {
      note("Dashboard attachment deferred. You can resume after choosing an app browser route.",
        "Dashboard attachment deferred");
      return null;
    }
    const inputArgs = ["app", "homarr-input", "--id", appId, "--project-root", root];
    if (href) inputArgs.push("--href", href);
    prepared = await runJsonCli([...inputArgs, "--json"], "Preparing owner-only Homarr input");
  }
  if (prepared.command !== "app homarr-input" || prepared.appId !== appId
    || !["created", "already-current"].includes(String(prepared.status))
    || typeof prepared.inputFile !== "string" || typeof prepared.apiKeyFile !== "string"
    || typeof prepared.href !== "string") {
    throw new Error("Homarr attach input did not match the saved app and key.");
  }
  if (localOnly && (prepared.access !== "local" || prepared.href !== localBookmarkHref)) {
    note("The saved Homarr input is not the exact local-host URL, so no board change was planned. Review the existing input and route separately.",
      "Local-only attachment deferred");
    return null;
  }
  let expectedCredentialFile = join(root, ".selfhost", "credentials", `${appId}.env`);
  if (typeof app.passwordFile === "string") expectedCredentialFile = app.passwordFile;
  if (prepared.credentialFile !== expectedCredentialFile) {
    throw new Error("Homarr attach input changed the saved credential handoff path.");
  }
  if (prepared.access === "local") {
    note("This link works only in a browser on the Docker host. On another device, 127.0.0.1 points to that device, not your server. A private route or tunnel and a reviewed link change are separate steps.",
      "Local-only app link");
  }
  const args = ["--input", prepared.inputFile, "--api-key-file", prepared.apiKeyFile];
  if (repairLink) args.push("--repair-existing-link");
  const plan = await runJsonCli(["homarr", "attach", "plan", ...args], "Reviewing the private Homarr board");
  const board = plan.board as { id?: unknown; name?: unknown; private?: unknown } | undefined;
  const service = plan.service as { id?: unknown; href?: unknown; credentialFile?: unknown } | undefined;
  const resources = plan.resources as {
    appId?: unknown; tileId?: unknown; notebookId?: unknown; additionalNotebookId?: unknown;
    alreadyCurrent?: unknown; descriptionUpdate?: unknown; linkUpdate?: unknown;
    moveEmbeddedServicesToCompanion?: unknown;
    compactLegacyMediaRecap?: unknown; createAdditionalNotebook?: unknown;
    updatePrimaryNotebookContent?: unknown; updateCompanionNotebookContent?: unknown;
    recapLayoutUpdates?: unknown; companionPositionUpdates?: unknown;
  } | undefined;
  const linkUpdate = resources?.linkUpdate as { from?: unknown; to?: unknown } | null | undefined;
  if (plan.status !== "pass" || plan.mutation !== false || board?.private !== true
    || typeof board.id !== "string" || typeof board.name !== "string"
    || service?.id !== appId || service.href !== prepared.href
    || service.credentialFile !== prepared.credentialFile
    || !resources || typeof resources.alreadyCurrent !== "boolean"
    || typeof resources.createAdditionalNotebook !== "boolean"
    || (resources.additionalNotebookId !== null && typeof resources.additionalNotebookId !== "string")
    || typeof resources.updatePrimaryNotebookContent !== "boolean"
    || typeof resources.updateCompanionNotebookContent !== "boolean"
    || !Array.isArray(resources.recapLayoutUpdates)
    || !Array.isArray(resources.companionPositionUpdates)
    || (repairLink && (typeof resources.appId !== "string" || typeof resources.tileId !== "string"
      || typeof resources.notebookId !== "string" || resources.descriptionUpdate !== null
      || (linkUpdate !== null && (typeof linkUpdate?.from !== "string" || linkUpdate.to !== prepared.href))))
    || (!repairLink && linkUpdate !== null)
    || typeof plan.approval !== "string" || !plan.approval.startsWith(`ATTACH:${board.id}:`)) {
    throw new Error("Homarr attach plan changed the selected private board or app link.");
  }
  const boardChanges: string[] = [];
  if (resources.appId === null) boardChanges.push("Create one app bookmark");
  if (linkUpdate !== null) boardChanges.push("Change the saved app browser link and its managed Notebook entry");
  if (resources.tileId === null) boardChanges.push("Add one app tile");
  if (resources.notebookId === null) boardChanges.push("Add the primary stack Notebook");
  if (resources.createAdditionalNotebook === true) boardChanges.push("Add the companion services Notebook");
  if (resources.updatePrimaryNotebookContent) boardChanges.push("Update the existing primary stack Notebook content");
  if (resources.updateCompanionNotebookContent) boardChanges.push("Update the existing companion services Notebook content");
  if (resources.descriptionUpdate != null) boardChanges.push("Update an existing app description");
  if (resources.moveEmbeddedServicesToCompanion === true) boardChanges.push("Move existing service details into the companion Notebook");
  if (resources.compactLegacyMediaRecap === true) boardChanges.push("Compact the existing media recap");
  if (resources.recapLayoutUpdates.length > 0) boardChanges.push(`Resize ${resources.recapLayoutUpdates.length} existing recap layout(s)`);
  if (resources.companionPositionUpdates.length > 0) boardChanges.push(`Reposition ${resources.companionPositionUpdates.length} companion layout(s)`);
  if (resources.alreadyCurrent !== true && boardChanges.length === 0) {
    throw new Error("Homarr attach plan has an unexplained board mutation; inspect its full JSON before applying.");
  }
  note(`Board: ${board.name} (private)\nApp link: ${prepared.href}\nOwner-only credential file: ${prepared.credentialFile}\nApproval: ${plan.approval}\n`
    + `Board changes: ${boardChanges.join("; ") || "none; already current"}.\n`
    + "This does not configure ingress. Browser reachability, rendered layout, integration, and widget remain separate checks.",
  "Review Homarr attachment");
  const expectsCompanion = resources.createAdditionalNotebook || resources.additionalNotebookId !== null;
  let expectedIds = resources;
  if (resources?.alreadyCurrent !== true) {
    const approve = stopIfCancelled(await confirm({
      message: "Approve this exact Homarr tile and Notebook change?", initialValue: false,
    }));
    if (!approve) return null;
    const applied = await runJsonCli(["homarr", "attach", "apply", ...args,
      "--approve", plan.approval], "Adding the reviewed app tile and Notebook");
    if (!["attached", "already-attached"].includes(String(applied.status))
      || typeof applied.appId !== "string" || typeof applied.tileId !== "string"
      || typeof applied.notebookId !== "string"
      || (expectsCompanion && typeof applied.additionalNotebookId !== "string")
      || (!expectsCompanion && applied.additionalNotebookId !== null)) {
      throw new Error("Homarr attachment did not return exact tile and Notebook IDs.");
    }
    expectedIds = applied;
  }
  const status = await runJsonCli(["homarr", "attach", "status", ...args],
    "Reading back the Homarr app tile and Notebooks");
  const savedBoard = status.board as { id?: unknown; name?: unknown; private?: unknown } | undefined;
  const homarr = await runJsonCli(["app", "status", "--id", "homarr", "--project-root", root,
    "--json"], "Checking the saved private dashboard URL");
  if (homarr.command !== "app status" || homarr.appId !== "homarr"
    || homarr.projectRoot !== root || homarr.status !== "applied"
    || typeof homarr.url !== "string") {
    throw new Error("The saved Homarr dashboard URL did not match this project.");
  }
  const boardUrl = `${homarr.url}/boards/${encodeURIComponent(board.name)}`;
  if (status.status !== "attached" || savedBoard?.id !== board.id
    || savedBoard.name !== board.name || savedBoard.private !== true
    || status.boardUrl !== boardUrl
    || typeof status.appId !== "string" || typeof status.tileId !== "string"
    || typeof status.notebookId !== "string"
    || (expectsCompanion && typeof status.additionalNotebookId !== "string")
    || (!expectsCompanion && status.additionalNotebookId !== null)
    || status.appId !== expectedIds.appId || status.tileId !== expectedIds.tileId
    || status.notebookId !== expectedIds.notebookId
    || status.additionalNotebookId !== expectedIds.additionalNotebookId
    || status.credentialFile !== prepared.credentialFile
    || status.notebookContentVerified !== true
    || status.integrationVerified !== false || status.serviceRuntimeVerified !== false) {
    throw new Error("Homarr tile and Notebook read-back is incomplete; inspect before retrying.");
  }
  const notebookSummary = expectsCompanion ? "both stack Notebooks" : "the primary stack Notebook";
  note(`View dashboard: ${boardUrl}\nTile ${status.tileId} and ${notebookSummary} were read back on private board ${board.name}. `
    + (localOnly
      ? "This is a local-host bookmark and stack Notebook only; no network bridge, integration, or widget was configured. The loopback URL opens only in a browser on the Docker host; remote reachability and browser rendering remain unverified."
      : "This loopback URL opens on the Docker host; another device needs a reviewed private route or tunnel. Browser rendering, integration, and widget remain separate checks."),
  "Homarr resources attached");
  if (!localOnly && appId === "uptime-kuma") await offerUptimeKumaIntegration(root);
  if (!localOnly && appId === "immich") await offerImmichNativeInput(root);
  if (!localOnly && appId === "paperless-ngx") await offerPaperlessNativeIntegration(root);
  return boardUrl;
}

async function offerPaperlessNativeIntegration(root: string): Promise<void> {
  const selected = stopIfCancelled(await confirm({
    message: "Connect Paperless-ngx to a native Homarr widget now? This needs a separate approval.",
    initialValue: false,
  }));
  if (!selected) return;
  const firstRun = await reviewedFirstRun(root, ["paperless-ngx"]);
  if (firstRun[0]?.state !== "ready") {
    note("Paperless administrator login and its saved API token need a verified first-run checkpoint before Homarr can connect. Resume this app's setup, then retry the native widget.",
      "Paperless integration deferred");
    return;
  }
  const prepared = await runJsonCli(["app", "homarr-paperless-input", "--id", "paperless-ngx",
    "--project-root", root, "--json"], "Preparing native Paperless integration input");
  if (prepared.command !== "app homarr-paperless-input" || prepared.appId !== "paperless-ngx"
    || !["created", "already-current"].includes(String(prepared.status))
    || typeof prepared.inputFile !== "string" || typeof prepared.apiKeyFile !== "string"
    || typeof prepared.paperlessApiKeyFile !== "string") {
    throw new Error("Paperless integration input did not match the saved app and Homarr project.");
  }
  const args = ["--input", prepared.inputFile, "--api-key-file", prepared.apiKeyFile,
    "--paperless-api-key-file", prepared.paperlessApiKeyFile];
  const plan = await runJsonCli(["homarr", "attach", "paperless", "plan", ...args],
    "Reviewing the native Paperless integration and widget");
  const board = plan.board as { id?: unknown; name?: unknown; private?: unknown } | undefined;
  const integration = plan.integration as { kind?: unknown; name?: unknown; url?: unknown } | undefined;
  const widget = plan.widget as { kind?: unknown; id?: unknown } | undefined;
  if (plan.status !== "pass" || plan.mutation !== false || board?.private !== true
    || typeof board.id !== "string" || typeof board.name !== "string"
    || integration?.kind !== "paperlessNgx" || integration.url !== "http://paperless-ngx:8000/"
    || widget?.kind !== "paperlessNgx" || typeof plan.alreadyCurrent !== "boolean"
    || typeof plan.approval !== "string" || !plan.approval.startsWith(`ATTACH-PAPERLESS:${board.id}:`)) {
    throw new Error("Paperless plan did not match the exact private board and native integration.");
  }
  note(`Board: ${board.name} (private)\nIntegration: ${String(integration.name)} at ${integration.url}\n`
    + `Widget: ${widget.id ? "already present" : "one new Paperless widget"}\nApproval: ${plan.approval}\n`
    + "The Paperless API token stays in its private file. Board rendering still needs a separate check.",
  "Review native integration");
  let applied: Record<string, unknown> | null = null;
  if (!plan.alreadyCurrent) {
    const approved = stopIfCancelled(await confirm({
      message: "Approve this exact Paperless integration and widget change?", initialValue: false,
    }));
    if (!approved) return;
    applied = await runJsonCli(["homarr", "attach", "paperless", "apply", ...args, "--approve", plan.approval],
      "Connecting Paperless to Homarr");
    if (applied.status !== "attached" || typeof applied.integrationId !== "string"
      || typeof applied.widgetId !== "string") {
      throw new Error("Paperless attachment did not return exact integration and widget IDs; inspect before retrying.");
    }
  }
  const status = await runJsonCli(["homarr", "attach", "paperless", "status", ...args],
    "Reading Paperless widget stats through Homarr");
  if (!["attached", "attached-live-unverified"].includes(String(status.status))
    || typeof status.integrationId !== "string" || typeof status.widgetId !== "string"
    || (applied && (status.integrationId !== applied.integrationId || status.widgetId !== applied.widgetId))) {
    throw new Error("Paperless integration or widget read-back is incomplete; inspect before retrying.");
  }
  if (status.status === "attached-live-unverified") {
    note(`Integration ${status.integrationId} and widget ${status.widgetId} exist, but live stats are unverified (${String(status.failure ?? "unknown")}). Inspect the Paperless endpoint and Homarr bridge before claiming success.`,
      "Widget needs attention");
    return;
  }
  const stats = status.stats as { documentsTotal?: unknown; documentsInbox?: unknown } | undefined;
  const documentsTotal = stats?.documentsTotal;
  const documentsInbox = stats?.documentsInbox;
  if (status.liveStats !== "verified" || typeof documentsTotal !== "number"
    || !Number.isSafeInteger(documentsTotal) || typeof documentsInbox !== "number"
    || !Number.isSafeInteger(documentsInbox)) {
    throw new Error("Paperless widget returned an unrecognized live-stats result.");
  }
  note(`Homarr read ${documentsTotal} Paperless document(s), including ${documentsInbox} in the inbox, through integration ${status.integrationId} and widget ${status.widgetId}. Check desktop and mobile rendering separately.`,
    "Live widget data verified");
}

async function offerImmichNativeInput(root: string): Promise<void> {
  const app = await runJsonCli(["app", "status", "--id", "immich", "--project-root", root,
    "--live", "--json"], "Checking Immich acceptance before native Homarr preparation");
  const persistence = app.persistence as { stage?: unknown; cleanup?: unknown } | null;
  const runtime = app.runtime as { state?: unknown } | null;
  if (app.command !== "app status" || app.appId !== "immich" || app.projectRoot !== root
    || app.status !== "applied" || runtime?.state !== "running") {
    note("Immich is not confirmed running. Native Homarr integration preparation was deferred.",
      "Immich integration pending");
    return;
  }
  if (persistence?.stage !== "accepted" || persistence.cleanup !== "trashed") {
    note("Finish Immich's saved photo and restart proof before preparing native Homarr integration evidence. The app tile is still available.",
      "Immich integration pending");
    return;
  }
  const prepare = stopIfCancelled(await confirm({
    message: "Prepare private Immich integration input and acceptance evidence? This does not create a key or widget.",
    initialValue: false,
  }));
  if (!prepare) return;
  const result = await runJsonCli(["app", "homarr-immich-input", "--id", "immich",
    "--project-root", root, "--json"], "Preparing native Homarr Immich inputs");
  if (result.command !== "app homarr-immich-input" || result.appId !== "immich"
    || !["created", "already-current"].includes(String(result.status))
    || typeof result.inputFile !== "string" || typeof result.acceptanceFile !== "string"
    || typeof result.apiKeyFile !== "string" || result.immichApiKeyFile !== null
    || result.nextCommand !== null) {
    throw new Error("Immich integration preparation returned an unexpected checkpoint. Inspect the exact private files before retrying.");
  }
  note(`Native integration input: ${result.inputFile}\nAccepted-service evidence: ${result.acceptanceFile}\n`
    + "A separately approved, limited Immich API key is still needed. No Homarr integration or widget was created; the dashboard remains unverified.",
  "Immich integration preparation");
  const continueKey = stopIfCancelled(await confirm({
    message: "Review a separate limited Immich API-key plan for Homarr?", initialValue: false,
  }));
  if (!continueKey) return;
  const keyPlan = await runJsonCli(["app", "homarr-immich-key-plan", "--id", "immich",
    "--project-root", root, "--json"], "Reviewing limited Immich key permissions");
  if (keyPlan.command !== "app homarr-immich-key-plan" || keyPlan.appId !== "immich"
    || typeof keyPlan.keyFile !== "string" || !Array.isArray(keyPlan.permissions)
    || keyPlan.permissions.length !== immichHomarrPermissions.length
    || !keyPlan.permissions.every((value) => typeof value === "string")
    || JSON.stringify([...keyPlan.permissions].sort()) !== JSON.stringify([...immichHomarrPermissions].sort())
    || !["create-one-limited-immich-key", "verify-existing-key"].includes(String(keyPlan.operation))) {
    throw new Error("The limited Immich key plan did not match the reviewed credential boundary.");
  }
  if (keyPlan.status === "manual-recovery-required") {
    note("A Homarr-named Immich key may already exist without a saved secret. Inspect or revoke it manually before another creation attempt.",
      "Immich key needs recovery");
    return;
  }
  if (keyPlan.status !== "ready-for-review" || typeof keyPlan.approval !== "string"
    || !/^APP-HOMARR-IMMICH-KEY:immich:[0-9a-f]{64}$/.test(keyPlan.approval)) {
    throw new Error("The limited Immich key approval is not reviewable.");
  }
  note(`One Homarr-named key for Immich. Permissions: ${keyPlan.permissions.join(", ")}.\n`
    + `Operation: ${String(keyPlan.operation)}. Secret file: ${keyPlan.keyFile}.`,
  "Review limited key");
  const approveKey = stopIfCancelled(await confirm({
    message: "Approve this exact limited Immich key step? It may create one key and save its secret privately.",
    initialValue: false,
  }));
  if (!approveKey) return;
  const key = await runJsonCli(["app", "homarr-immich-key-create", "--id", "immich",
    "--project-root", root, "--approve", keyPlan.approval, "--json"],
  "Creating or verifying the limited Immich key");
  if (key.command !== "app homarr-immich-key-create" || key.appId !== "immich"
    || !["created-and-verified", "existing-key-verified"].includes(String(key.status))
    || key.keyFile !== keyPlan.keyFile || typeof key.keyId !== "string"
    || key.secretPrinted !== false || key.integrationAttached !== false) {
    throw new Error("Immich key did not verify with its exact private file. Inspect its saved checkpoint before attaching Homarr.");
  }
  note(`Limited key ${key.keyId} verified; its secret stays in ${key.keyFile}. No Homarr integration was changed.`,
    "Immich key ready");
  const attach = stopIfCancelled(await confirm({
    message: "Review the separate native Homarr Immich integration and stats widget plan?", initialValue: false,
  }));
  if (!attach) return;
  const args = ["--input", result.inputFile, "--api-key-file", result.apiKeyFile,
    "--immich-api-key-file", key.keyFile, "--acceptance-file", result.acceptanceFile];
  const plan = await runJsonCli(["homarr", "attach", "immich", "plan", ...args],
    "Reviewing the native Homarr Immich integration");
  const board = plan.board as { id?: unknown; name?: unknown; private?: unknown } | undefined;
  const integration = plan.integration as { kind?: unknown; name?: unknown; url?: unknown } | undefined;
  if (plan.status !== "pass" || plan.mutation !== false || board?.private !== true
    || typeof board.id !== "string" || board.name !== "personal"
    || integration?.kind !== "immich" || integration.name !== "Immich"
    || integration.url !== "http://immich:2283/" || !Array.isArray(plan.widgets)
    || plan.widgets.length !== 1
    || (plan.widgets[0] as { kind?: unknown }).kind !== "immich-serverStats"
    || typeof plan.alreadyCurrent !== "boolean" || typeof plan.approval !== "string"
    || !plan.approval.startsWith(`ATTACH-IMMICH:${board.id}:`)) {
    throw new Error("Homarr Immich plan changed the selected private board, route, or widget contract.");
  }
  if (!plan.alreadyCurrent) {
    note(`Board: ${board.name} (private). Integration: Immich at ${integration.url}. Widget: server statistics.\nApproval: ${plan.approval}`,
      "Review native attachment");
    const approveAttach = stopIfCancelled(await confirm({
      message: "Approve this exact native Immich integration and widget change?", initialValue: false,
    }));
    if (!approveAttach) return;
    const applied = await runJsonCli(["homarr", "attach", "immich", "apply", ...args,
      "--approve", plan.approval], "Connecting Immich to Homarr");
    if (!["attached", "already-attached"].includes(String(applied.status))
      || typeof applied.integrationId !== "string") {
      throw new Error("Homarr Immich attachment did not return an exact integration. Inspect status before retrying.");
    }
  }
  const status = await runJsonCli(["homarr", "attach", "immich", "status", ...args],
    "Reading Homarr's native Immich widget data");
  if (status.status !== "attached" || status.integrationVerified !== true
    || !Array.isArray(status.liveWidgetKinds)
    || !status.liveWidgetKinds.includes("immich-serverStats")) {
    note("The integration may exist, but Homarr did not verify live Immich server-statistics data. Inspect its exact status and private board before claiming success.",
      "Immich widget needs attention");
    return;
  }
  note("Homarr read live Immich server statistics through the native integration. Open the private dashboard to check the rendered widget on your devices.",
    "Immich data connected");
}

async function offerAcceptedImmichHomarr(root: string): Promise<string | null> {
  const app = await runJsonCli(["app", "status", "--id", "immich", "--project-root", root,
    "--json"], "Checking Immich's saved acceptance before dashboard setup");
  const persistence = app.persistence as { stage?: unknown; cleanup?: unknown } | null;
  if (app.command !== "app status" || app.appId !== "immich" || app.projectRoot !== root) {
    throw new Error("Immich's saved acceptance belongs to a different project.");
  }
  if (app.status !== "applied" || typeof app.homarrNetwork !== "string"
    || persistence?.stage !== "accepted" || persistence.cleanup !== "trashed") return null;
  return await offerHomarrTile(root, "immich");
}

async function offerUptimeKumaIntegration(root: string): Promise<void> {
  const continueSetup = stopIfCancelled(await confirm({
    message: "Connect Uptime Kuma's status page to a Homarr widget now? This needs a separate approval.",
    initialValue: false,
  }));
  if (!continueSetup) return;
  note("Uptime Kuma's status-page API is unauthenticated. The saved host port is loopback-bound, but an existing proxy or tunnel could still expose it; inspect your access routes before approval.",
    "Status-page scope");
  let prepared = await runJsonCli(["app", "homarr-uptime-input", "--id", "uptime-kuma",
    "--project-root", root, "--json"], "Preparing the private Uptime Kuma integration input");
  if (prepared.command !== "app homarr-uptime-input" || prepared.appId !== "uptime-kuma"
    || !["created", "already-current"].includes(String(prepared.status))
    || typeof prepared.inputFile !== "string" || typeof prepared.apiKeyFile !== "string"
    || typeof prepared.url !== "string" || typeof prepared.boardName !== "string"
    || (prepared.slugFile !== null && typeof prepared.slugFile !== "string")) {
    throw new Error("Uptime Kuma integration input did not match the saved app and Homarr project.");
  }
  note(`Homarr will reach Uptime Kuma at ${prepared.url} on their approved private bridge. `
    + "This is not the browser URL on your device.", "Integration route");
  if (typeof prepared.slugFile === "string") {
    note(`Reusing the saved owner-only custom status-page slug at ${prepared.slugFile}. Its existing page and monitor are checked by the Homarr attachment plan.`,
      "Saved status page");
  } else {
    const appStatus = await runJsonCli(["app", "status", "--id", "uptime-kuma",
      "--project-root", root, "--json"], "Checking the saved Uptime setup route");
    const selfMonitor = appStatus.uptimeSelfMonitor as { stage?: unknown } | null;
    if (appStatus.command !== "app status" || appStatus.appId !== "uptime-kuma"
      || appStatus.projectRoot !== root || appStatus.status !== "applied"
      || appStatus.uptimeOnboardingStage !== "login-verified") {
      throw new Error("The saved Uptime project cannot support a Homarr status-page review yet.");
    }
    if (selfMonitor?.stage === "attempted") {
      note("An earlier self-monitor creation has an uncertain outcome. Inspect its exact saved checkpoint before attaching a manual or managed status page.",
        "Uptime monitor needs inspection");
      return;
    }
    if (selfMonitor?.stage !== "recorded") {
      note("This older Uptime project has no CLI-owned self-monitor. The CLI will not create or change your manual status page; Homarr's separate connection and live-widget checks still apply.",
        "Manual status page");
      const pageReady = stopIfCancelled(await confirm({
        message: "Have you already created a Uptime status page with at least one monitor?",
        initialValue: false,
      }));
      if (!pageReady) return;
      const slugChoice = stopIfCancelled(await select({
        message: "Which existing status-page slug should Homarr read?",
        options: [{ value: "default", label: "default" },
          { value: "custom", label: "Another slug", hint: "Save privately for resume" }],
        initialValue: "default",
      }));
      if (slugChoice === "custom") {
        const slug = stopIfCancelled(await password({
          message: "Enter the existing status-page slug (input is masked)",
          validate(value) {
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
              return "Use 1–128 letters, digits, underscores, or hyphens; start with a letter or digit.";
            }
          },
        }));
        const saved = await runJsonCli(["app", "homarr-uptime-input", "--id", "uptime-kuma",
          "--project-root", root, "--slug-stdin", "--json"],
        "Saving the existing status-page slug privately", undefined, slug);
        if (saved.command !== prepared.command || saved.appId !== prepared.appId
          || saved.inputFile !== prepared.inputFile || saved.apiKeyFile !== prepared.apiKeyFile
          || saved.url !== prepared.url || saved.boardName !== prepared.boardName
          || typeof saved.slugFile !== "string") {
          throw new Error("The saved custom status-page slug changed the Homarr integration source.");
        }
        prepared = saved;
      }
    } else {
      const existingPage = await runJsonCli(["app", "status-page-status", "--id", "uptime-kuma",
        "--project-root", root, "--json"], "Inspecting an existing default status page");
      if (existingPage.command !== "app status-page-status" || existingPage.appId !== "uptime-kuma"
        || typeof existingPage.monitorId !== "number" || typeof existingPage.pageExists !== "boolean") {
        throw new Error("The existing Uptime status page could not be inspected safely.");
      }
      if (existingPage.status === "unowned-page" && existingPage.pageExists === true) {
        note("The default status page already exists and was not created by this CLI. It will not be edited. Homarr can separately test it before attaching a widget; review its monitors and public visibility first.",
          "Existing status page");
        const useExisting = stopIfCancelled(await confirm({
          message: "Use this existing default page for a read-only Homarr connection plan?",
          initialValue: false,
        }));
        if (!useExisting) return;
      } else {
        const pagePlan = await runJsonCli(["app", "status-page-plan", "--id", "uptime-kuma",
          "--project-root", root, "--json"], "Checking the saved Uptime self-monitor and default status page");
        if (pagePlan.command !== "app status-page-plan" || pagePlan.appId !== "uptime-kuma"
          || typeof pagePlan.monitorId !== "number" || pagePlan.monitorId < 1
          || pagePlan.slug !== "default" || typeof pagePlan.approval !== "string"
          || !pagePlan.approval.startsWith("APP-STATUS-PAGE:uptime-kuma:")) {
          throw new Error("Uptime Kuma did not return an exact status-page plan.");
        }
        note(`Status page: /status/default; saved local monitor ${pagePlan.monitorId}. `
          + `Operation: ${String(pagePlan.status)}. Approval: ${pagePlan.approval}. `
          + "Its read endpoint has no login even if the page is marked unpublished.",
        "Review status-page setup");
        if (pagePlan.status !== "recorded") {
          const approved = stopIfCancelled(await confirm({
            message: "Create this exact status page with only the saved local self-monitor?",
            initialValue: false,
          }));
          if (!approved) return;
          const created = await runJsonCli(["app", "status-page-create", "--id", "uptime-kuma",
            "--project-root", root, "--approve", pagePlan.approval, "--json"],
          "Creating and reading back the reviewed status page");
          if (created.command !== "app status-page-create" || created.appId !== "uptime-kuma"
            || !["recorded", "recorded-heartbeat-pending"].includes(String(created.status))
            || created.monitorId !== pagePlan.monitorId || created.exact !== true) {
            throw new Error("The saved Uptime status page did not match its approval; inspect the checkpoint before retrying.");
          }
        }
        const page = await runJsonCli(["app", "status-page-status", "--id", "uptime-kuma",
          "--project-root", root, "--json"], "Reading back the status page and monitor heartbeat");
        if (page.command !== "app status-page-status" || page.appId !== "uptime-kuma"
          || page.status !== "recorded" || page.monitorId !== pagePlan.monitorId
          || page.exact !== true || page.heartbeatUp !== true) {
          note("The managed status page is not yet verified with an UP heartbeat. The Homarr widget was deferred; inspect this exact app status before retrying.",
            "Status page pending");
          return;
        }
      }
    }
  }
  const args = ["--input", prepared.inputFile, "--api-key-file", prepared.apiKeyFile];
  if (typeof prepared.slugFile === "string") args.push("--slug-file", prepared.slugFile);
  const plan = await runJsonCli(["homarr", "attach", "uptime-kuma", "plan", ...args],
    "Reviewing the native Uptime Kuma integration and widget");
  const board = plan.board as { id?: unknown; name?: unknown; private?: unknown } | undefined;
  const integration = plan.integration as { kind?: unknown; name?: unknown; url?: unknown;
    id?: unknown; secretKinds?: unknown } | undefined;
  const widget = plan.widget as { kind?: unknown; alreadyCurrent?: unknown } | undefined;
  if (plan.status !== "pass" || plan.mutation !== false || board?.private !== true
    || typeof board.id !== "string" || board.name !== prepared.boardName
    || integration?.kind !== "uptimeKuma" || typeof integration.name !== "string"
    || integration.url !== prepared.url || !Array.isArray(integration.secretKinds)
    || widget?.kind !== "uptimeKuma" || typeof widget.alreadyCurrent !== "boolean"
    || typeof plan.alreadyCurrent !== "boolean" || typeof plan.approval !== "string"
    || !plan.approval.startsWith(`ATTACH-UPTIME-KUMA:${board.id}:`)) {
    throw new Error("Uptime Kuma integration plan changed the selected private board, app, or route.");
  }
  note(`Board: ${board.name} (private)\nIntegration: ${integration.name} at ${integration.url}\n`
    + `Widget: ${widget.alreadyCurrent ? "already present" : "one new Uptime Kuma widget"}\n`
    + `Status-page slug: ${prepared.slugFile ? "owner-only file" : "default"}\nApproval: ${plan.approval}\n`
    + "The connection is tested before a widget is added. Browser rendering still needs a separate check.",
  "Review native integration");
  let applied: Record<string, unknown> | null = null;
  if (!plan.alreadyCurrent) {
    const approve = stopIfCancelled(await confirm({
      message: "Approve this exact Uptime Kuma integration and widget change?", initialValue: false,
    }));
    if (!approve) return;
    applied = await runJsonCli(["homarr", "attach", "uptime-kuma", "apply", ...args,
      "--approve", plan.approval], "Connecting Uptime Kuma to Homarr");
    if (!["attached", "already-attached"].includes(String(applied.status))
      || typeof applied.integrationId !== "string" || typeof applied.widgetId !== "string") {
      throw new Error("Uptime Kuma attachment did not return exact integration and widget IDs.");
    }
  }
  const status = await runJsonCli(["homarr", "attach", "uptime-kuma", "status", ...args],
    "Reading Homarr's Uptime Kuma widget data");
  if (!["attached", "attached-live-unverified"].includes(String(status.status))
    || typeof status.integrationId !== "string" || typeof status.widgetId !== "string"
    || (applied && (status.integrationId !== applied.integrationId || status.widgetId !== applied.widgetId))
    || (typeof integration.id === "string" && status.integrationId !== integration.id)) {
    throw new Error("Uptime Kuma integration or widget read-back is incomplete; inspect before retrying.");
  }
  if (status.status === "attached-live-unverified") {
    note(`Integration ${status.integrationId} and widget ${status.widgetId} were read back, but live dashboard data is unverified (${String(status.failure ?? "unknown")}). Inspect the status page and Homarr bridge before claiming success.`,
      "Widget needs attention");
    return;
  }
  if (status.liveDashboard === "empty") {
    note(`Integration ${status.integrationId} and widget ${status.widgetId} were read back, but Homarr sees zero monitors. Add a monitor to the public status page; rendered layout is not yet checked.`,
      "Widget has no monitors");
    return;
  }
  if (status.liveDashboard !== "verified" || !Number.isInteger(status.monitorCount)
    || Number(status.monitorCount) < 1) {
    throw new Error("Uptime Kuma widget returned an unrecognized live-data result.");
  }
  note(`Homarr read ${status.monitorCount} Uptime Kuma monitor(s) through integration ${status.integrationId} and widget ${status.widgetId}. Check the dashboard on desktop and mobile before calling its layout finished.`,
    "Live widget data verified");
}

async function continueUptimeMonitor(root: string): Promise<boolean> {
  const appId = "uptime-kuma";
  const statusArgs = ["app", "status", "--id", appId, "--project-root", root, "--live", "--json"];
  const readStatus = async (): Promise<Record<string, unknown>> => {
    const current = await runJsonCli(statusArgs, "Reading Uptime Kuma's monitor checkpoint");
    if (current.command !== "app status" || current.appId !== appId
      || current.projectRoot !== root || current.status !== "applied"
      || current.uptimeOnboardingStage !== "login-verified") {
      throw new Error("Uptime Kuma's saved monitor owner or admin checkpoint changed; inspect app status.");
    }
    return current;
  };
  const incomplete = (reason: string): false => {
    note(`${reason}\nAdmin login alone is not application acceptance. Resume this project for the saved monitor checkpoint.`,
      "Uptime Kuma acceptance incomplete");
    return false;
  };
  const monitorPlan = (id: number): Record<string, unknown> | null => {
    const output = runCli(["app", "monitor-plan", "--id", appId, "--project-root", root,
      "--monitor-id", String(id), "--json"]);
    let value: unknown;
    try { value = JSON.parse(output.stdout); }
    catch { throw new Error("Uptime Kuma monitor plan returned invalid JSON; inspect its saved status."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Uptime Kuma monitor plan returned an invalid result.");
    }
    const result = value as Record<string, unknown>;
    if (output.status !== 0) {
      const failure = result.error as { code?: unknown } | undefined;
      if (result.status === "failed" && failure?.code === "uptime-fresh-beat-required") return null;
      throw new Error("Uptime Kuma monitor plan stopped. Inspect the selected monitor and saved app status before retrying.");
    }
    const monitor = result.monitor as { id?: unknown; status?: unknown; lastBeatId?: unknown } | undefined;
    if (result.command !== "app monitor-plan" || result.appId !== appId
      || !["ready-for-review", "already-verified"].includes(String(result.status))
      || monitor?.id !== id || monitor.status !== "up"
      || !Number.isSafeInteger(monitor.lastBeatId) || Number(monitor.lastBeatId) < 1
      || typeof result.approval !== "string"
      || !result.approval.startsWith("APP-MONITOR:uptime-kuma:")) {
      throw new Error("Uptime Kuma monitor plan did not match the selected healthy monitor.");
    }
    return result;
  };
  let status = await readStatus();
  let saved = status.uptimeMonitor as { id?: unknown; name?: unknown; stage?: unknown } | null;
  let stage = String(saved?.stage ?? "unrecorded");
  if (!["unrecorded", "baseline", "stopped", "restarted", "verified"].includes(stage)) {
    throw new Error("Uptime Kuma has an unknown monitor checkpoint; inspect app status.");
  }
  if (stage === "verified") {
    note(`Monitor ${String(saved?.id)} has a saved post-restart readback. Current monitor health and browser layout were not checked here.`,
      "Uptime Kuma proof recorded");
    return true;
  }
  let monitorId = saved?.id;
  if (stage === "unrecorded") {
    const local = status.uptimeSelfMonitor as { stage?: unknown; id?: unknown } | null;
    if (local?.stage === "recorded" && Number.isSafeInteger(local.id) && Number(local.id) > 0) {
      note(`The saved local self-check is monitor ${String(local.id)}. It checks Uptime Kuma from inside its own container, not external availability.`,
        "Saved Uptime Kuma monitor");
      const choice = stopIfCancelled(await select({
        message: "Which monitor should provide the baseline?",
        options: [
          { value: "saved", label: "Use the saved local self-check" },
          { value: "other", label: "Choose another up monitor" },
          { value: "defer", label: "Defer monitor and restart checks" },
        ],
      }));
      if (choice === "defer") return incomplete("No monitor baseline was recorded.");
      if (choice === "saved") monitorId = Number(local.id);
      else monitorId = undefined;
    } else {
      const action = stopIfCancelled(await select({
        message: "How do you want to establish Uptime Kuma's monitor baseline?",
        options: [
          { value: "local", label: "Create a local self-check with the CLI" },
          { value: "select", label: "Select an existing up monitor" },
          { value: "manual", label: "Create a monitor manually in Uptime Kuma" },
          { value: "defer", label: "Defer monitor and restart checks" },
        ],
      }));
      if (action === "defer") return incomplete("No monitor baseline was recorded.");
      if (action === "local") {
        const plan = await runJsonCli(["app", "monitor-create-plan", "--id", appId,
          "--project-root", root, "--json"], "Planning a local Uptime Kuma self-check");
        if (plan.command !== "app monitor-create-plan" || plan.appId !== appId
          || !["ready-for-review", "existing-for-review", "already-recorded"].includes(String(plan.status))
          || typeof plan.name !== "string" || plan.target !== uptimeSelfMonitorUrl
          || plan.upstreamVersion !== uptimeSelfMonitorVersion
          || JSON.stringify(plan.config) !== JSON.stringify(uptimeSelfMonitorConfig(plan.name))
          || typeof plan.approval !== "string"
          || !plan.approval.startsWith("APP-MONITOR-CREATE:uptime-kuma:")) {
          throw new Error("Uptime Kuma did not return a reviewable local monitor plan.");
        }
        note(`Monitor: ${plan.name}\nTarget: ${plan.target} inside the Uptime Kuma container\nGET every 60 seconds; accept HTTP 200-299; retry interval 60 seconds; no extra retries; active.\nRequired Uptime Kuma version: ${plan.upstreamVersion}\nExisting ID: ${String(plan.existingMonitorId ?? "none")}\nApproval: ${plan.approval}\nThis does not check external reachability or finish the restart proof.`,
          "Review local monitor");
        const approve = stopIfCancelled(await confirm({
          message: "Approve this exact local self-check monitor?", initialValue: false,
        }));
        if (!approve) return incomplete("Local monitor creation was declined.");
        const created = await runJsonCli(["app", "monitor-create", "--id", appId,
          "--project-root", root, "--approve", String(plan.approval), "--json"],
        "Recording the local Uptime Kuma monitor");
        const monitor = created.monitor as { id?: unknown } | undefined;
        if (created.command !== "app monitor-create" || created.appId !== appId
          || created.status !== "recorded" || !Number.isSafeInteger(monitor?.id)
          || Number(monitor?.id) < 1 || created.acceptanceVerified !== false) {
          throw new Error("Uptime Kuma monitor creation needs saved-checkpoint inspection.");
        }
        monitorId = Number(monitor.id);
      }
      if (action === "manual") {
        note(`Open ${String(status.url)} and create one monitor. Use the owner-only admin credential at ${String(status.credentialRef)}. Then return here to choose it.`,
          "Manual monitor setup");
        const refresh = stopIfCancelled(await confirm({
          message: "Have you created a monitor and want to list it now?", initialValue: false,
        }));
        if (!refresh) return incomplete("Manual monitor creation is still pending.");
      }
    }
    const listed = await runJsonCli(["app", "monitor-list", "--id", appId, "--project-root", root,
      "--json"], "Listing Uptime Kuma monitors");
    if (listed.command !== "app monitor-list" || listed.appId !== appId
      || listed.mutation !== false || !Array.isArray(listed.monitors)) {
      throw new Error("Uptime Kuma did not return a reviewable monitor list.");
    }
    const healthy = listed.monitors.filter((item): item is { id: number; name: string; status: string; lastBeatId: number } => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const monitor = item as Record<string, unknown>;
      return Number.isSafeInteger(monitor.id) && Number(monitor.id) > 0
        && typeof monitor.name === "string" && monitor.status === "up"
        && Number.isSafeInteger(monitor.lastBeatId) && Number(monitor.lastBeatId) > 0;
    });
    if (healthy.length === 0) {
      return incomplete(`No up monitor with a heartbeat is available at ${String(status.url)}. Create one or wait for its first successful check, then resume.`);
    }
    if (monitorId !== undefined && monitorId !== null) {
      if (!healthy.some((monitor) => monitor.id === monitorId)) {
        return incomplete(`Saved monitor ${String(monitorId)} has no up heartbeat yet. Wait for its next check, then resume.`);
      }
    } else {
      monitorId = stopIfCancelled(await select({
        message: "Which up monitor should be used for the restart proof?",
        options: healthy.map((monitor) => ({ value: monitor.id,
          label: `${monitor.id}: ${monitor.name}`, hint: "up with a recorded heartbeat" })),
      }));
    }
  }
  if (!Number.isSafeInteger(monitorId) || Number(monitorId) < 1) {
    throw new Error("Uptime Kuma's selected monitor ID is invalid; inspect app status.");
  }
  const id = Number(monitorId);
  if (stage === "unrecorded") {
    const plan = monitorPlan(id);
    if (!plan || plan.priorStage !== "unrecorded") {
      throw new Error("Uptime Kuma's initial monitor plan changed; inspect app status.");
    }
    const monitor = plan.monitor as { name: string; lastBeatId: number };
    note(`Monitor ${id}: ${monitor.name}; up at heartbeat ${monitor.lastBeatId}.\nApproval: ${plan.approval}\nThis records only the baseline. A separately approved stop/start and a fresh heartbeat are still required.`,
      "Review Uptime Kuma baseline");
    const approve = stopIfCancelled(await confirm({
      message: "Record this exact up monitor as the baseline?", initialValue: false,
    }));
    if (!approve) return incomplete("The monitor baseline approval was declined.");
    const checked = await runJsonCli(["app", "monitor-check", "--id", appId, "--project-root", root,
      "--monitor-id", String(id), "--approve", String(plan.approval), "--json"],
    "Recording Uptime Kuma's selected monitor baseline");
    if (checked.command !== "app monitor-check" || checked.appId !== appId
      || checked.status !== "baseline" || checked.mutation !== true
      || checked.acceptanceVerified !== false) {
      throw new Error("Uptime Kuma baseline did not return its saved checkpoint; inspect app status.");
    }
    status = await readStatus();
    saved = status.uptimeMonitor as typeof saved;
    stage = String(saved?.stage);
    if (stage !== "baseline" || saved?.id !== id) {
      throw new Error("Uptime Kuma's selected baseline was not saved; inspect app status.");
    }
  }
  if (stage === "baseline") {
    if ((status.runtime as { state?: unknown } | null)?.state !== "running") {
      return incomplete("The baseline exists, but Uptime Kuma is not running. Inspect the exact lifecycle checkpoint.");
    }
    const approval = (status.approvals as { down?: unknown } | null)?.down;
    if (typeof approval !== "string" || !approval.startsWith("APP-DOWN:uptime-kuma:")) {
      throw new Error("Uptime Kuma has no exact project-stop approval; inspect app status.");
    }
    note(`Stop only project ${String(status.projectId)} with its monitor baseline and data retained.\nApproval: ${approval}`,
      "Review Uptime Kuma stop");
    const approve = stopIfCancelled(await confirm({
      message: "Approve stopping this exact Uptime Kuma project?", initialValue: false,
    }));
    if (!approve) return incomplete("Project stop was declined; the baseline remains saved.");
    const stopped = await runJsonCli(["app", "down", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Stopping only the Uptime Kuma project");
    if (stopped.command !== "app down" || stopped.appId !== appId
      || stopped.status !== "stopped" || stopped.containerState !== "exited") {
      throw new Error("Uptime Kuma stop did not confirm its exact project; inspect app status.");
    }
    status = await readStatus();
    saved = status.uptimeMonitor as typeof saved;
    stage = String(saved?.stage);
    if (stage !== "stopped" || saved?.id !== id) {
      throw new Error("Uptime Kuma's monitor stop checkpoint was not saved; inspect app status.");
    }
  }
  if (stage === "stopped") {
    const approval = (status.approvals as { up?: unknown } | null)?.up;
    if (typeof approval !== "string" || !approval.startsWith("APP-UP:uptime-kuma:")) {
      throw new Error("Uptime Kuma has no exact project-start approval; inspect app status.");
    }
    note(`Restart only project ${String(status.projectId)} with its saved monitor and data.\nApproval: ${approval}`,
      "Review Uptime Kuma restart");
    const approve = stopIfCancelled(await confirm({
      message: "Approve restarting this exact Uptime Kuma project?", initialValue: false,
    }));
    if (!approve) return incomplete("Project restart was declined; the saved project remains stopped.");
    const started = await runJsonCli(["app", "up", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Restarting only the Uptime Kuma project");
    if (started.command !== "app up" || started.appId !== appId
      || started.status !== "started-unverified" || started.containerState !== "running") {
      throw new Error("Uptime Kuma restart did not confirm its exact project; inspect app status.");
    }
    status = await readStatus();
    saved = status.uptimeMonitor as typeof saved;
    stage = String(saved?.stage);
    if (saved?.id !== id) {
      throw new Error("Uptime Kuma's selected monitor changed after restart; inspect app status.");
    }
    if (stage === "baseline" && started.monitorPostStartFenceRecorded === false) {
      return incomplete("The restart has no post-start monitor fence. After the monitor is ready, a new separately approved stop/start is needed.");
    }
  }
  if (stage !== "restarted") {
    throw new Error("Uptime Kuma's restart checkpoint is incomplete; inspect app status before retrying.");
  }
  const plan = monitorPlan(id);
  if (!plan) return incomplete("The selected monitor needs one new successful heartbeat after restart. Wait for its next check, then resume; no approval was used.");
  if (plan.priorStage !== "restarted") {
    throw new Error("Uptime Kuma's post-restart monitor plan changed; inspect app status.");
  }
  const monitor = plan.monitor as { name: string; lastBeatId: number };
  note(`Monitor ${id}: ${monitor.name}; new up heartbeat ${monitor.lastBeatId}.\nApproval: ${plan.approval}\nThe CLI will compare this monitor against its saved baseline and post-start fence.`,
    "Review Uptime Kuma readback");
  const approve = stopIfCancelled(await confirm({
    message: "Approve the exact post-restart monitor readback?", initialValue: false,
  }));
  if (!approve) return incomplete("Post-restart readback approval was declined.");
  const checked = await runJsonCli(["app", "monitor-check", "--id", appId, "--project-root", root,
    "--monitor-id", String(id), "--approve", String(plan.approval), "--json"],
  "Checking the saved Uptime Kuma monitor after restart");
  if (checked.command !== "app monitor-check" || checked.appId !== appId
    || checked.status !== "verified" || checked.acceptanceVerified !== true) {
    throw new Error("Uptime Kuma's post-restart monitor proof was not recorded; inspect app status.");
  }
  note(`Monitor ${id} survived the approved stop/start and a fresh up heartbeat was read back. Browser layout and backup recovery remain separate checks.`,
    "Uptime Kuma monitor verified");
  return true;
}

async function continueUptimeSetup(root: string): Promise<boolean> {
  let status = await runJsonCli(["app", "status", "--id", "uptime-kuma", "--project-root", root,
    "--live", "--json"], "Checking Uptime Kuma's saved owner and live container");
  const runtime = status.runtime as { state?: unknown } | null;
  if (status.command !== "app status" || status.appId !== "uptime-kuma"
    || status.projectRoot !== root || status.status !== "applied") {
    note("The exact Uptime Kuma app is not applied. Inspect its saved app status before continuing.",
      "Uptime Kuma setup deferred");
    return false;
  }
  if (runtime?.state === "exited" && status.lastRecordedLifecycle === "stopped"
    && status.uptimeOnboardingStage === "login-verified"
    && (status.uptimeMonitor as { stage?: unknown } | null)?.stage === "stopped") {
    return continueUptimeMonitor(root);
  }
  if (runtime?.state !== "running") {
    note("The exact running Uptime Kuma app is not ready. Inspect its saved app status before continuing.",
      "Uptime Kuma setup deferred");
    return false;
  }
  if (typeof status.credentialRef !== "string") {
    let batchOwnsUptime = false;
    if (existsSync(join(root, ".selfhost", "app-batch.json"))) {
      const batch = await runJsonCli(["app", "batch", "status", "--project-root", root,
        "--json"], "Checking the saved batch owner for Uptime Kuma");
      if (batch.command !== "app batch status" || batch.projectRoot !== root
        || !Array.isArray(batch.jobs)) {
        throw new Error("The saved batch owner could not be checked before Uptime Kuma setup.");
      }
      batchOwnsUptime = batch.jobs.some((job) => job?.appId === "uptime-kuma");
    }
    if (batchOwnsUptime) {
      const step = await runJsonCli(["app", "batch", "step-plan", "--project-root", root,
        "--job", "uptime-kuma", "--json"], "Planning the Uptime Kuma batch credential step");
      const account = step.accountPlan as Record<string, unknown> | undefined;
      if (step.command !== "app batch step-plan" || step.status !== "planned"
        || step.projectRoot !== root || step.selectedJob !== "app-uptime-kuma"
        || step.stage !== "uptime-kuma-credential-prepare"
        || typeof step.approval !== "string" || !/^BATCH-STEP:[0-9a-f]{64}$/.test(step.approval)
        || account?.command !== "app account-plan" || account.appId !== "uptime-kuma"
        || account.status !== "ready-for-review" || account.username !== "admin"
        || typeof account.credentialFile !== "string") {
        throw new Error("Uptime Kuma's batch credential step changed; inspect its saved batch and app status.");
      }
      note(`Administrator: admin\nOwner-only file: ${account.credentialFile}\nApproval: ${step.approval}\n`
        + "This prepares a password file only. Account login and monitor acceptance are separate.",
      "Review Uptime Kuma batch credential");
      const prepare = stopIfCancelled(await confirm({
        message: "Approve this exact Uptime Kuma batch credential step?", initialValue: false,
      }));
      if (!prepare) return false;
      const prepared = await runJsonCli(["app", "batch", "step", "--project-root", root,
        "--job", "uptime-kuma", "--approve", step.approval, "--json"],
      "Saving the approved Uptime Kuma credential checkpoint");
      if (prepared.command !== "app batch step" || prepared.projectRoot !== root
        || prepared.selectedJob !== "app-uptime-kuma" || prepared.status !== "prepared-not-login-verified"
        || prepared.credentialRef !== account.credentialFile || prepared.acceptanceVerified !== false) {
        throw new Error("Uptime Kuma's batch credential checkpoint needs inspection before account setup.");
      }
      status = await runJsonCli(["app", "status", "--id", "uptime-kuma", "--project-root", root,
        "--live", "--json"], "Reading the prepared Uptime Kuma checkpoint");
    } else {
      const account = await runJsonCli(["app", "account-plan", "--id", "uptime-kuma",
        "--project-root", root, "--username", "admin", "--json"],
      "Planning Uptime Kuma's private admin credential");
      if (account.command !== "app account-plan" || account.appId !== "uptime-kuma"
        || account.status !== "ready-for-review" || account.username !== "admin"
        || typeof account.credentialFile !== "string"
        || typeof account.approval !== "string"
        || !account.approval.startsWith("APP-ACCOUNT:uptime-kuma:")) {
        throw new Error("Uptime Kuma did not return an exact first-owner credential plan.");
      }
      note(`Administrator: admin\nOwner-only file: ${account.credentialFile}\nApproval: ${account.approval}\n`
        + "This prepares a password file only; the account still needs its own approval.",
      "Review Uptime Kuma credential");
      const prepare = stopIfCancelled(await confirm({
        message: "Prepare this owner-only Uptime Kuma password?", initialValue: false,
      }));
      if (!prepare) return false;
      const prepared = await runJsonCli(["app", "account-prepare", "--id", "uptime-kuma",
        "--project-root", root, "--username", "admin", "--approve", account.approval, "--json"],
      "Saving Uptime Kuma's private admin password");
      if (prepared.command !== "app account-prepare" || prepared.appId !== "uptime-kuma"
        || prepared.status !== "prepared-not-account-verified"
        || prepared.credentialFile !== account.credentialFile) {
        throw new Error("Uptime Kuma credential preparation needs inspection before account setup.");
      }
      status = await runJsonCli(["app", "status", "--id", "uptime-kuma", "--project-root", root,
        "--live", "--json"], "Reading the prepared Uptime Kuma checkpoint");
    }
  }
  if (status.command !== "app status" || status.appId !== "uptime-kuma"
    || status.projectRoot !== root || status.status !== "applied"
    || (status.runtime as { state?: unknown } | null)?.state !== "running"
    || typeof status.credentialRef !== "string" || typeof status.accountUsername !== "string") {
    throw new Error("Uptime Kuma's prepared first-owner checkpoint changed; inspect app status.");
  }
  if (status.uptimeOnboardingStage !== "login-verified") {
    const approvals = status.approvals as { onboard?: unknown } | null;
    if (typeof approvals?.onboard !== "string"
      || !approvals.onboard.startsWith("APP-ONBOARD:uptime-kuma:")) {
      throw new Error("Uptime Kuma has no exact first-owner approval; inspect app status.");
    }
    note(`App: ${String(status.url)}\nAdministrator: ${status.accountUsername}\nCredential file: ${status.credentialRef}\nApproval: ${approvals.onboard}\n`
      + "The CLI first checks the saved login. If this is a fresh install, it creates one admin through Uptime Kuma's local Socket.IO setup event and checks login again. An uncertain prior setup is never replayed blindly. Monitor and restart checks remain separate.",
    "Review Uptime Kuma first account");
    const approve = stopIfCancelled(await confirm({
      message: "Create or verify this exact Uptime Kuma administrator?", initialValue: false,
    }));
    if (!approve) return false;
    const result = await runJsonCli(["app", "onboard", "--id", "uptime-kuma", "--project-root", root,
      "--approve", approvals.onboard, "--json"], "Creating or verifying the Uptime Kuma administrator");
    if (result.command !== "app onboard" || result.appId !== "uptime-kuma"
      || result.status !== "login-verified" || result.accountVerified !== true
      || result.acceptanceVerified !== false || result.credentialFile !== status.credentialRef) {
      throw new Error("Uptime Kuma did not return an exact verified-login checkpoint.");
    }
    note(`Admin login checked at ${String(result.verifiedAt)}. Credential file: ${status.credentialRef}. Monitor and restart proof are still open.`,
      "Uptime Kuma admin ready");
  }
  return continueUptimeMonitor(root);
}

async function continueImmichSetup(root: string): Promise<void> {
  const appId = "immich";
  const status = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--json"],
    "Reading the saved Immich setup checkpoint");
  if (status.command !== "app status" || status.appId !== appId || status.projectRoot !== root
    || status.status !== "applied" || typeof status.passwordFile !== "string") {
    throw new Error("Immich has no applied project to continue. Inspect its exact app status.");
  }
  let stage = String(status.onboardingStage);
  if (stage === "pending" || stage === "signup-attempted") {
    const approvals = status.approvals as { onboard?: unknown } | null;
    if (typeof approvals?.onboard !== "string" || !approvals.onboard.startsWith("APP-ONBOARD:immich:")) {
      throw new Error("Immich onboarding has no exact saved approval.");
    }
    note(`URL: ${String(status.url)}\nAdministrator: ${String(status.email)}\nPassword: ${status.passwordFile}\nApproval: ${approvals.onboard}\nA retry verifies the saved account; it does not blindly create another.`, "Review Immich first account");
    const approve = stopIfCancelled(await confirm({
      message: "Create or verify only this Immich administrator?", initialValue: false,
    }));
    if (!approve) {
      outro(`Immich is running; account setup remains open. Resume this project or run self-host app status --id immich --project-root ${root} --json.`);
      return;
    }
    const onboarded = await runJsonCli(["app", "onboard", "--id", appId, "--project-root", root,
      "--approve", approvals.onboard, "--json"], "Creating or verifying the private Immich administrator");
    if (onboarded.command !== "app onboard" || onboarded.appId !== appId
      || onboarded.status !== "login-verified-setup-open" || onboarded.setupClosed !== false) {
      throw new Error("Immich onboarding did not return its expected login checkpoint.");
    }
    stage = "login-verified";
  }
  if (stage === "login-verified" || stage === "closing") {
    const plan = await runJsonCli(["app", "close-plan", "--id", appId, "--project-root", root, "--json"],
      "Inspecting Immich ownership and planning setup closure");
    const change = plan.change as { environment?: unknown; to?: unknown } | undefined;
    if (plan.command !== "app close-plan" || plan.appId !== appId
      || !["ready-for-review", "ready-to-resume"].includes(String(plan.status))
      || typeof plan.approval !== "string" || !plan.approval.startsWith("APP-CLOSE-SETUP:immich:")
      || change?.environment !== "IMMICH_ALLOW_SETUP" || change.to !== "false") {
      throw new Error("Immich setup closure did not return a bounded reviewed plan.");
    }
    let renderNote = "The saved render path is exact for this interrupted closure.";
    if (plan.renderTargetRefreshedOnApply === true) {
      renderNote = "The render path refreshes with the live observation at apply.";
    }
    note(`Project: ${String(plan.projectId)}\nOld Compose: ${String(plan.oldComposeTarget)}\nCandidate Compose: ${String(plan.candidateComposeTarget)}\nChange: IMMICH_ALLOW_SETUP=true → false\nApproval: ${plan.approval}\n${renderNote} The approval binds the project, account, owned resources, and environment change. Photo and restart checks remain separate.`, "Review Immich setup closure");
    const approve = stopIfCancelled(await confirm({
      message: "Approve only this Immich setup closure?", initialValue: false,
    }));
    if (!approve) {
      outro(`Immich login works, but setup remains open. Resume this project or run self-host app close-plan --id immich --project-root ${root} --json.`);
      return;
    }
    const closed = await runJsonCli(["app", "close-setup", "--id", appId, "--project-root", root,
      "--approve", plan.approval, "--json"], "Disabling Immich setup and reverifying the administrator");
    if (closed.command !== "app close-setup" || closed.appId !== appId
      || closed.status !== "setup-closed-login-verified" || closed.setupClosed !== true
      || closed.acceptanceVerified !== false) {
      throw new Error("Immich setup closure did not return its expected checkpoint.");
    }
    stage = "closed";
  }
  if (stage !== "closed") throw new Error("Immich setup stage is unknown. Inspect its saved app status.");
  const handoff = await runJsonCli(["app", "handoff", "--id", appId, "--project-root", root, "--json"],
    "Locating the private Immich admin handoff");
  if (handoff.command !== "app handoff" || handoff.appId !== appId
    || handoff.status !== "setup-closed-login-verified" || handoff.secretful !== false
    || typeof handoff.passwordFile !== "string") {
    throw new Error("Immich admin handoff did not match the closed setup checkpoint.");
  }
  const photoStatus = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--json"],
    "Checking the saved Immich photo checkpoint");
  if (photoStatus.command !== "app status" || photoStatus.appId !== appId
    || photoStatus.onboardingStage !== "closed" || photoStatus.setupClosed !== true
    || photoStatus.acceptanceVerified !== false) {
    throw new Error("Immich photo status did not match the closed setup checkpoint.");
  }
  let photoVerified = photoStatus.photoRoundTripVerified === true;
  if (!photoVerified) {
    const photoApproval = (photoStatus.approvals as { photoCheck?: unknown } | null)?.photoCheck;
    if (typeof photoApproval !== "string"
      || !photoApproval.startsWith("APP-PHOTO-CHECK:immich:")) {
      throw new Error("Immich did not return an exact photo-check approval.");
    }
    const pending = (photoStatus.photoCheck as { assetId?: unknown } | null)?.assetId;
    let review = `A small synthetic test photo will be uploaded, downloaded, and moved to recoverable trash. Approval: ${photoApproval}`;
    if (typeof pending === "string") review = `Resume the exact saved test asset ${pending}; no new photo will be uploaded. Approval: ${photoApproval}`;
    note(review, "Review Immich photo check");
    const approve = stopIfCancelled(await confirm({
      message: "Approve this Immich photo round-trip?", initialValue: false,
    }));
    if (approve) {
      const checked = await runJsonCli(["app", "photo-check", "--id", appId, "--project-root", root,
        "--approve", photoApproval, "--json"], "Checking one Immich photo upload and exact download");
      if (checked.command !== "app photo-check" || checked.appId !== appId
        || checked.status !== "photo-round-trip-passed" || checked.photoRoundTripVerified !== true
        || checked.acceptanceVerified !== false || checked.restartPersistenceVerified !== false) {
        throw new Error("Immich photo check did not return its expected functional checkpoint.");
      }
      photoVerified = true;
    }
  }
  let persistenceVerified = false;
  if (photoVerified) persistenceVerified = await continueImmichPersistence(root, appId);
  const photoSummary = photoVerified ? "Photo upload and exact download passed." : "Photo upload and download remain unverified.";
  const restartSummary = persistenceVerified
    ? "The saved test photo survived a separately approved stop/start."
    : "Restart persistence remains unverified.";
  const dashboardUrl = await offerAcceptedImmichHomarr(root);
  showSavedAppRecap(root, appId);
  let dashboardSummary = "Homarr dashboard is not yet verified or was not selected.";
  if (dashboardUrl !== null) {
    dashboardSummary = `View dashboard: ${dashboardUrl}. This loopback link opens on the Docker host; another device needs a reviewed private route or tunnel. Check browser rendering separately.`;
  }
  note(`Immich administrator works at ${String(handoff.url)}; setup is closed. Credentials: ${handoff.passwordFile}. Use self-host app handoff --id immich --project-root ${root} --show for the private .env. ${photoSummary} ${restartSummary} ${dashboardSummary}`,
    "Immich app checks");
}

async function continuePaperlessSetup(root: string): Promise<void> {
  const appId = "paperless-ngx";
  const status = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--json"],
    "Reading the saved Paperless project");
  if (status.command !== "app status" || status.appId !== appId || status.projectRoot !== root
    || status.status !== "applied" || typeof status.passwordFile !== "string"
    || typeof status.url !== "string") {
    throw new Error("Paperless has no applied exact project to check. Inspect app status.");
  }
  const handoff = await runJsonCli(["app", "handoff", "--id", appId, "--project-root", root, "--json"],
    "Locating the private Paperless admin handoff");
  if (handoff.command !== "app handoff" || handoff.appId !== appId
    || handoff.secretful !== false || handoff.passwordFile !== status.passwordFile) {
    throw new Error("Paperless admin handoff differs from its saved exact project.");
  }
  if (status.lastRecordedLifecycle === "stopped") {
    const approval = (status.approvals as { up?: unknown } | null)?.up;
    if (typeof approval !== "string" || !approval.startsWith("APP-UP:paperless-ngx:")) {
      throw new Error("Stopped Paperless project has no exact restart approval.");
    }
    note("Saved project: " + String(status.projectId) + "\nApproval: " + approval
      + "\nOnly this Paperless Compose project will start; data stays in place.",
      "Review Paperless resume");
    const approve = stopIfCancelled(await confirm({
      message: "Approve restarting this exact Paperless project?", initialValue: false,
    }));
    if (!approve) {
      outro("Paperless remains stopped. Resume this exact project when ready.");
      return;
    }
    const started = await runJsonCli(["app", "up", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"], "Restarting the saved Paperless project");
    if (started.command !== "app up" || started.appId !== appId || started.containerState !== "running") {
      throw new Error("Paperless did not confirm the exact restarted project.");
    }
    await continuePaperlessSetup(root);
    return;
  }
  note(`URL: ${status.url}\nAdministrator: ${String(status.username)}\nPassword file: ${status.passwordFile}\nThe private API check will verify the managed superuser without printing its password. Documents and restart remain separate.`,
    "Paperless first account");
  const check = stopIfCancelled(await confirm({
    message: "Check the Paperless admin account now?", initialValue: false,
  }));
  if (!check) {
    outro(`Paperless is configured. Resume here or run self-host app login-check --id ${appId} --project-root ${root} --json when it is ready.`);
    return;
  }
  let verified: Record<string, unknown>;
  try {
    verified = await runJsonCli(["app", "login-check", "--id", appId,
      "--project-root", root, "--json"], "Verifying the Paperless administrator");
  } catch {
    outro(`Paperless login could not be verified yet. Inspect self-host app status --id ${appId} --project-root ${root} --json and retry the read-only login check; do not create another project.`);
    return;
  }
  if (verified.command !== "app login-check" || verified.appId !== appId
    || verified.status !== "admin-verified" || verified.loginVerified !== true
    || verified.acceptanceVerified !== false) {
    throw new Error("Paperless login check returned an unexpected result; inspect the exact project.");
  }
  await offerPaperlessDocument(root, status.url, status.passwordFile);
}

async function offerPaperlessDocument(root: string, url: string, passwordFile: string): Promise<void> {
  const appId = "paperless-ngx";
  const current = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--json"],
    "Reading the Paperless canary checkpoint");
  if (current.command !== "app status" || current.appId !== appId || current.projectRoot !== root
    || current.status !== "applied") {
    throw new Error("Paperless canary status did not match the exact saved project.");
  }
  const canary = current.paperlessDocument as { stage?: unknown; title?: unknown;
    taskId?: unknown; documentId?: unknown } | null;
  if (canary?.stage === "upload-attempted") {
    outro("Paperless admin login works, but the canary upload result is uncertain. Inspect title "
      + String(canary.title) + " in Paperless before recovery; no second upload will be sent.");
    return;
  }
  if (canary?.stage === "passed") {
    if (current.paperlessPersistence?.cleanup === "trashed") {
      note(`The prior Paperless canary is in recoverable trash. Its restart proof is historical. A fresh acceptance cycle keeps that proof in the private project history and uses a distinct canary title.`,
        "Paperless proof needs renewal");
      const renew = stopIfCancelled(await confirm({
        message: "Start a fresh Paperless acceptance cycle?", initialValue: false,
      }));
      if (!renew) {
        showSavedAppRecap(root, appId);
        note("Paperless administrator works at " + url + ". The prior OCR and restart proof is recorded; its synthetic document is in recoverable trash. Credentials: " + passwordFile + ".",
          "Paperless acceptance recorded");
        return;
      }
      const plan = await runJsonCli(["app", "document-renew-plan", "--id", appId,
        "--project-root", root, "--json"], "Planning a fresh Paperless canary");
      if (plan.command !== "app document-renew-plan" || plan.appId !== appId
        || plan.status !== "ready-for-review" || plan.mutation !== false
        || typeof plan.nextTitle !== "string" || typeof plan.approval !== "string"
        || !plan.approval.startsWith("APP-DOCUMENT-RENEW:paperless-ngx:")) {
        throw new Error("Paperless canary renewal did not return an exact reviewable plan.");
      }
      note(`Prior document: ${String(plan.previousDocumentId)}\nNext title: ${plan.nextTitle}\nApproval: ${plan.approval}\nThis only changes the private checkpoint. A later document-check uploads the new canary.`,
        "Review Paperless canary renewal");
      const approve = stopIfCancelled(await confirm({
        message: "Approve this exact Paperless canary renewal?", initialValue: false,
      }));
      if (!approve) {
        outro("The prior Paperless proof remains saved. No new canary was created.");
        return;
      }
      const renewed = await runJsonCli(["app", "document-renew", "--id", appId,
        "--project-root", root, "--approve", plan.approval, "--json"],
      "Renewing the saved Paperless canary checkpoint");
      if (renewed.command !== "app document-renew" || renewed.appId !== appId
        || renewed.status !== "ready-for-new-canary" || renewed.mutation !== true
        || renewed.nextTitle !== plan.nextTitle || renewed.acceptanceVerified !== false) {
        throw new Error("Paperless canary renewal needs inspection before any new upload.");
      }
      await offerPaperlessDocument(root, url, passwordFile);
      return;
    }
    await offerPaperlessPersistence(root, url, passwordFile);
    return;
  }
  const approval = (current.approvals as { documentCheck?: unknown } | null)?.documentCheck;
  if (typeof approval !== "string" || !approval.startsWith("APP-DOCUMENT-CHECK:paperless-ngx:")) {
    throw new Error("Paperless document check has no exact saved approval.");
  }
  note(["Canary: " + String(canary?.title ?? "one harmless generated PNG"),
    "Saved task: " + String(canary?.taskId ?? "not uploaded"),
    "Saved document: " + String(canary?.documentId ?? "not processed"),
    "Approval: " + approval,
    "Paperless will OCR the image and retain it for a later restart check."].join("\n"),
  "Review Paperless document check");
  const approveDocument = stopIfCancelled(await confirm({
    message: canary ? "Inspect this saved Paperless canary without uploading another?"
      : "Approve one harmless Paperless OCR canary upload?", initialValue: false,
  }));
  if (!approveDocument) {
    outro("Paperless admin login works at " + url + ". Document/OCR and restart persistence are still unverified.");
    return;
  }
  let result: Record<string, unknown>;
  try {
    result = await runJsonCli(["app", "document-check", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"],
    "Checking the exact Paperless OCR canary");
  } catch {
    outro("Paperless document check stopped at a saved checkpoint. Inspect self-host app status --id "
      + appId + " --project-root " + root + " --json; do not start another upload.");
    return;
  }
  if (result.command !== "app document-check" || result.appId !== appId
    || !["processing", "ocr-original-roundtrip-passed"].includes(String(result.status))
    || result.acceptanceVerified !== false) {
    throw new Error("Paperless document check returned an unexpected checkpoint.");
  }
  if (result.status === "processing") {
    outro("Paperless is processing the saved canary task " + String(result.taskId)
      + ". Resume this project to check it; no new upload will be sent.");
    return;
  }
  await offerPaperlessPersistence(root, url, passwordFile);
}

async function offerPaperlessPersistence(root: string, url: string, passwordFile: string): Promise<void> {
  const appId = "paperless-ngx";
  const statusArgs = ["app", "status", "--id", appId, "--project-root", root, "--json"];
  const readStatus = async (): Promise<Record<string, any>> => {
    const status = await runJsonCli(statusArgs, "Reading the Paperless restart checkpoint");
    if (status.command !== "app status" || status.appId !== appId
      || status.documentRoundTripVerified !== true || status.ocrVerified !== true
      || status.acceptanceVerified !== false) {
      throw new Error("Paperless restart status did not match the saved OCR canary.");
    }
    return status;
  };
  let status = await readStatus();
  let stage = String(status.paperlessPersistence?.stage ?? "not-started");
  if (status.paperlessPersistence?.acceptedAt && (stage === "accepted" || stage === "stale")) {
    await offerPaperlessCleanup(root, url, passwordFile, status);
    return;
  }
  if (status.lastRecordedLifecycle === "stopped" && stage !== "stopped") {
    const approval = status.approvals?.up;
    if (typeof approval !== "string" || !approval.startsWith("APP-UP:paperless-ngx:")) {
      throw new Error("Paperless has no exact approval to restart its stopped project.");
    }
    note("Paperless is stopped. Only its exact Compose project will restart. Approval: " + approval,
      "Review Paperless restart");
    const approve = stopIfCancelled(await confirm({
      message: "Approve restarting this exact Paperless project?", initialValue: false,
    }));
    if (!approve) {
      outro("Paperless remains stopped. Resume this project when you want to restart it.");
      return;
    }
    const started = await runJsonCli(["app", "up", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"], "Restarting the exact Paperless project");
    if (started.command !== "app up" || started.appId !== appId || started.containerState !== "running") {
      throw new Error("Paperless start did not confirm the exact project.");
    }
    status = await readStatus();
    stage = String(status.paperlessPersistence?.stage ?? "not-started");
  }
  const start = stopIfCancelled(await confirm({
    message: "Verify this Paperless document survives a separately approved stop/start?",
    initialValue: false,
  }));
  if (!start) {
    outro("Paperless OCR and original-byte readback passed. Restart persistence remains unverified; resume this project later.");
    return;
  }
  if (stage === "not-started" || stage === "stale") {
    const approval = status.approvals?.persistenceStart;
    if (typeof approval !== "string" || !approval.startsWith("APP-PERSISTENCE-START:paperless-ngx:")) {
      throw new Error("Paperless restart start has no exact saved approval.");
    }
    note("Document: " + String(status.paperlessDocument?.documentId)
      + "\nApproval: " + approval + "\nThis step only saves the exact existing canary.",
      "Review Paperless restart canary");
    const approve = stopIfCancelled(await confirm({
      message: "Approve saving this Paperless restart checkpoint?", initialValue: false,
    }));
    if (!approve) {
      outro("Paperless restart proof was deferred. No container was stopped.");
      return;
    }
    const prepared = await runJsonCli(["app", "persistence-start", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"],
    "Saving the exact Paperless canary for restart");
    if (prepared.command !== "app persistence-start" || prepared.appId !== appId
      || prepared.status !== "canary-ready-for-restart" || prepared.acceptanceVerified !== false) {
      throw new Error("Paperless restart start returned an unexpected checkpoint.");
    }
    status = await readStatus();
    stage = String(status.paperlessPersistence?.stage);
  }
  if (stage === "awaiting-stop") {
    const approval = status.approvals?.down;
    if (typeof approval !== "string" || !approval.startsWith("APP-DOWN:paperless-ngx:")) {
      throw new Error("Paperless stop has no exact project approval.");
    }
    note("Only the exact Paperless Compose project will stop; data remains. Approval: " + approval,
      "Review Paperless stop");
    const approve = stopIfCancelled(await confirm({
      message: "Approve stopping only this Paperless project?", initialValue: false,
    }));
    if (!approve) {
      outro("The Paperless canary remains saved. Resume later to stop this exact project.");
      return;
    }
    const stopped = await runJsonCli(["app", "down", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"], "Stopping the exact Paperless project");
    if (stopped.command !== "app down" || stopped.appId !== appId || stopped.containerState !== "stopped") {
      throw new Error("Paperless stop did not confirm the exact project.");
    }
    status = await readStatus();
    stage = String(status.paperlessPersistence?.stage);
  }
  if (stage === "stopped") {
    const approval = status.approvals?.up;
    if (typeof approval !== "string" || !approval.startsWith("APP-UP:paperless-ngx:")) {
      throw new Error("Paperless start has no exact project approval.");
    }
    note("Only the saved Paperless Compose project will restart. Approval: " + approval,
      "Review Paperless start");
    const approve = stopIfCancelled(await confirm({
      message: "Approve restarting only this Paperless project?", initialValue: false,
    }));
    if (!approve) {
      outro("Paperless is stopped with the canary saved. Resume this project to restart it.");
      return;
    }
    const started = await runJsonCli(["app", "up", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"], "Restarting the exact Paperless project");
    if (started.command !== "app up" || started.appId !== appId || started.containerState !== "running") {
      throw new Error("Paperless start did not confirm the exact project.");
    }
    status = await readStatus();
    stage = String(status.paperlessPersistence?.stage);
  }
  if (stage !== "restarted") {
    throw new Error("Paperless restart phase is unknown. Inspect its exact app status.");
  }
  const approval = status.approvals?.persistenceFinish;
  if (typeof approval !== "string" || !approval.startsWith("APP-PERSISTENCE-FINISH:paperless-ngx:")) {
    throw new Error("Paperless restart finish has no exact canary approval.");
  }
  note("Document: " + String(status.paperlessDocument?.documentId)
    + "\nApproval: " + approval + "\nThe CLI will recheck login, OCR, and identical original bytes.",
    "Review Paperless restart readback");
  const approve = stopIfCancelled(await confirm({
    message: "Approve checking this saved Paperless canary after restart?", initialValue: false,
  }));
  if (!approve) {
    outro("Paperless restarted. Resume when it is ready to verify the saved canary.");
    return;
  }
  let accepted: Record<string, unknown>;
  try {
    accepted = await runJsonCli(["app", "persistence-finish", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"],
    "Verifying Paperless data after restart");
  } catch {
    outro("Paperless restart readback is not verified yet. Inspect app status and retry the saved finish approval after the app is ready.");
    return;
  }
  if (accepted.command !== "app persistence-finish" || accepted.appId !== appId
    || accepted.status !== "accepted-canary-retained" || accepted.acceptanceVerified !== true) {
    throw new Error("Paperless restart readback returned an unexpected result.");
  }
  status = await readStatus();
  await offerPaperlessCleanup(root, url, passwordFile, status);
}

async function offerPaperlessCleanup(root: string, url: string, passwordFile: string,
  status: Record<string, any>): Promise<void> {
  const appId = "paperless-ngx";
  const documentId = status.paperlessDocument?.documentId;
  if (!Number.isSafeInteger(documentId) || documentId <= 0
    || status.paperlessPersistence?.cleanup === "trashed") {
    throw new Error("Paperless cleanup has no exact retained canary.");
  }
  if (status.lastRecordedLifecycle === "stopped") {
    outro("Paperless's restart proof is recorded, but the project is stopped. Review app status and approve app up before cleaning the saved canary.");
    return;
  }
  const approval = status.approvals?.documentCleanup;
  if (typeof approval !== "string" || !approval.startsWith("APP-DOCUMENT-CLEANUP:paperless-ngx:")) {
    throw new Error("Paperless cleanup has no exact saved recoverable-trash approval.");
  }
  note("Paperless login, OCR, original bytes, and the approved restart readback passed at " + url
    + ".\nCanary document: " + documentId + "\nApproval: " + approval
    + "\nOnly this synthetic document will move to recoverable trash.",
  "Review Paperless cleanup");
  const approve = stopIfCancelled(await confirm({
    message: "Move this exact Paperless test document to recoverable trash?", initialValue: false,
  }));
  if (!approve) {
    showSavedAppRecap(root, appId);
    note("Paperless acceptance is recorded. The synthetic document remains in the library; resume for cleanup. Credentials: " + passwordFile + ".",
      "Paperless acceptance recorded");
    return;
  }
  let result: Record<string, unknown>;
  try {
    result = await runJsonCli(["app", "document-cleanup", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"],
    "Moving the exact Paperless canary to recoverable trash");
  } catch {
    note("Paperless cleanup was not confirmed. The saved document ID is " + documentId
      + "; inspect app status and retry its exact cleanup approval. A retry checks trash before deleting.",
    "Paperless cleanup pending");
    return;
  }
  if (result.command !== "app document-cleanup" || result.appId !== appId
    || result.status !== "recoverable-trash-confirmed" || result.cleanupPending !== false) {
    throw new Error("Paperless cleanup returned an unexpected result.");
  }
  showSavedAppRecap(root, appId);
  note("Paperless login, OCR, original bytes, and approved restart readback passed at " + url
    + ". Synthetic document " + documentId + " is in recoverable trash. Credentials: " + passwordFile + ".",
  "Paperless acceptance recorded");
}

async function continueImmichPersistence(root: string, appId: string): Promise<boolean> {
  const statusArgs = ["app", "status", "--id", appId, "--project-root", root, "--json"];
  const readStatus = async (): Promise<Record<string, any>> => {
    const status = await runJsonCli(statusArgs, "Reading the Immich restart checkpoint");
    if (status.command !== "app status" || status.appId !== appId
      || status.onboardingStage !== "closed" || status.photoRoundTripVerified !== true
      || status.acceptanceVerified !== false) {
      throw new Error("Immich restart status did not match its saved closed project.");
    }
    return status;
  };
  let status = await readStatus();
  let phase = String(status.persistence?.stage ?? "not-started");
  if (phase === "accepted" && status.testAssetCleanupPending !== true) return true;
  if (["not-started", "uploaded", "stale"].includes(phase)
    && status.lastRecordedLifecycle === "stopped") {
    const approval = status.approvals?.up;
    if (typeof approval !== "string" || !approval.startsWith("APP-UP:immich:")) {
      throw new Error("Immich has no exact approval to restart the stopped project.");
    }
    note(`Project ${String(status.projectId)} is stopped. Restart it before checking a canary. Approval: ${approval}`,
      "Review Immich restart");
    const approve = stopIfCancelled(await confirm({
      message: "Approve restarting this exact Immich project?", initialValue: false,
    }));
    if (!approve) return false;
    const restarted = await runJsonCli(["app", "up", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Restarting the exact Immich project");
    if (restarted.command !== "app up" || restarted.appId !== appId
      || restarted.status !== "started-unverified" || restarted.containerState !== "running") {
      throw new Error("Immich did not report the exact restarted project.");
    }
    status = await readStatus();
  }
  if ((phase === "accepted" || phase === "stale") && status.testAssetCleanupPending === true) {
    const approval = status.approvals?.persistenceFinish;
    if (typeof approval !== "string" || !approval.startsWith("APP-PERSISTENCE-FINISH:immich:")) {
      throw new Error("Immich saved test asset has no exact cleanup approval.");
    }
    note(`Asset ${String(status.persistence.assetId)} may still be in the library. Retry cleanup of only this saved asset. Approval: ${approval}`,
      "Review Immich test cleanup");
    const approve = stopIfCancelled(await confirm({
      message: "Approve exact Immich test-asset cleanup?", initialValue: false,
    }));
    if (!approve) return phase === "accepted";
    const cleanup = await runJsonCli(["app", "persistence-finish", "--id", appId,
      "--project-root", root, "--approve", approval, "--json"],
    "Retrying cleanup of the saved Immich test asset");
    if (cleanup.command !== "app persistence-finish" || cleanup.appId !== appId
      || !["cleanup-complete", "cleanup-pending"].includes(String(cleanup.status))) {
      throw new Error("Immich test-asset cleanup did not return its saved checkpoint.");
    }
    if (cleanup.status === "cleanup-pending") {
      note(`Test asset ${String(status.persistence.assetId)} still needs manual inspection or a later retry.`,
        "Immich cleanup pending");
      return phase === "accepted";
    }
    status = await readStatus();
    phase = String(status.persistence?.stage);
    if (phase === "accepted") return true;
  }
  if (["not-started", "uploaded", "stale"].includes(phase)) {
    const approval = status.approvals?.persistenceStart;
    if (typeof approval !== "string" || !approval.startsWith("APP-PERSISTENCE-START:immich:")) {
      throw new Error("Immich restart canary has no exact saved approval.");
    }
    let review = `Save one synthetic test photo in the exact Immich project before restart. Approval: ${approval}`;
    if (phase === "uploaded") review = `Continue the saved test photo ${String(status.persistence.assetId)}; no new photo will be uploaded. Approval: ${approval}`;
    note(review, "Review Immich restart canary");
    const approve = stopIfCancelled(await confirm({
      message: "Approve this exact Immich restart canary?", initialValue: false,
    }));
    if (!approve) return false;
    const started = await runJsonCli(["app", "persistence-start", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Saving one Immich photo for restart proof");
    if (started.command !== "app persistence-start" || started.appId !== appId
      || started.status !== "canary-ready-for-restart" || started.acceptanceVerified !== false) {
      throw new Error("Immich canary did not reach the saved restart checkpoint.");
    }
    status = await readStatus();
    phase = String(status.persistence?.stage);
  }
  if (phase === "awaiting-stop") {
    const approval = status.approvals?.down;
    if (typeof approval !== "string" || !approval.startsWith("APP-DOWN:immich:")) {
      throw new Error("Immich stop has no exact saved approval.");
    }
    note(`Stop only project ${String(status.projectId)}. Data and the saved test photo remain. Approval: ${approval}`,
      "Review Immich stop");
    const approve = stopIfCancelled(await confirm({
      message: "Approve this exact Immich project stop?", initialValue: false,
    }));
    if (!approve) return false;
    const stopped = await runJsonCli(["app", "down", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Stopping only the Immich project");
    if (stopped.command !== "app down" || stopped.appId !== appId
      || stopped.status !== "stopped" || stopped.containerState !== "stopped") {
      throw new Error("Immich did not report the exact stopped project.");
    }
    status = await readStatus();
    phase = String(status.persistence?.stage);
  }
  if (phase === "stopped") {
    const approval = status.approvals?.up;
    if (typeof approval !== "string" || !approval.startsWith("APP-UP:immich:")) {
      throw new Error("Immich restart has no exact saved approval.");
    }
    note(`Restart only project ${String(status.projectId)} with its saved data. Approval: ${approval}`,
      "Review Immich restart");
    const approve = stopIfCancelled(await confirm({
      message: "Approve this exact Immich project restart?", initialValue: false,
    }));
    if (!approve) return false;
    const restarted = await runJsonCli(["app", "up", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Restarting only the Immich project");
    if (restarted.command !== "app up" || restarted.appId !== appId
      || restarted.status !== "started-unverified" || restarted.containerState !== "running") {
      throw new Error("Immich did not report the exact restarted project.");
    }
    status = await readStatus();
    phase = String(status.persistence?.stage);
  }
  if (phase === "restarted") {
    const approval = status.approvals?.persistenceFinish;
    if (typeof approval !== "string" || !approval.startsWith("APP-PERSISTENCE-FINISH:immich:")) {
      throw new Error("Immich saved canary has no exact read-back approval.");
    }
    note(`Read test photo ${String(status.persistence.assetId)} from the restarted project, compare its exact bytes, then move it to recoverable trash. Approval: ${approval}`,
      "Review Immich persistence proof");
    const approve = stopIfCancelled(await confirm({
      message: "Approve final Immich canary read-back and cleanup?", initialValue: false,
    }));
    if (!approve) return false;
    const accepted = await runJsonCli(["app", "persistence-finish", "--id", appId, "--project-root", root,
      "--approve", approval, "--json"], "Reading the saved photo after restart");
    if (accepted.command !== "app persistence-finish" || accepted.appId !== appId
      || !["accepted", "accepted-cleanup-pending"].includes(String(accepted.status))
      || accepted.acceptanceVerified !== true
      || accepted.restartPersistenceVerified !== true) {
      throw new Error("Immich restart persistence was not accepted.");
    }
    if (accepted.cleanupPending === true) {
      note(`The restart proof passed, but test asset ${String(accepted.assetId)} may remain. Resume this project for exact cleanup.`,
        "Immich cleanup pending");
    }
    return true;
  }
  throw new Error("Immich restart phase is unknown. Inspect its exact app status.");
}

async function appAcceptanceStatus(root: string, appId: string): Promise<{
  accepted: boolean; cleanupPending: boolean;
}> {
  let current: Record<string, unknown>;
  try {
    current = await runJsonCli(["app", "status", "--id", appId,
      "--project-root", root, "--live", "--json"], `Checking ${appId}'s accepted app checkpoint`);
  } catch {
    return { accepted: false, cleanupPending: false };
  }
  const runtime = current.runtime as { state?: unknown } | null;
  if (current.command !== "app status" || current.appId !== appId || current.projectRoot !== root
    || current.status !== "applied" || runtime?.state !== "running") {
    return { accepted: false, cleanupPending: false };
  }
  if (appId === "uptime-kuma") {
    return { accepted: current.acceptanceRecorded === true
      && (current.uptimeMonitor as { stage?: unknown } | null)?.stage === "verified",
    cleanupPending: false };
  }
  if (appId === "immich") {
    const persistence = current.persistence as { stage?: unknown; cleanup?: unknown } | null;
    return { accepted: current.restartPersistenceRecorded === true && persistence?.stage === "accepted",
      cleanupPending: current.testAssetCleanupPending === true
        || (persistence?.stage === "accepted" && persistence.cleanup !== "trashed") };
  }
  if (appId === "paperless-ngx") {
    const persistence = current.paperlessPersistence as {
      stage?: unknown; cleanup?: unknown; acceptedAt?: unknown;
    } | null;
    return { accepted: current.paperlessRestartPersistenceRecorded === true
      && persistence?.stage === "accepted",
    cleanupPending: current.paperlessCanaryCleanupPending === true
      || (persistence?.stage === "accepted" && persistence.cleanup !== "trashed") };
  }
  return { accepted: false, cleanupPending: false };
}

export async function offerOptionalHomarrFanIn(root: string, appIds: string[], choices: RecipeChoice[],
  homarrChoice?: RecipeChoice): Promise<boolean> {
  if (appIds.length === 0) return false;
  const homarr = homarrChoice ?? choices.find((choice) => choice.appId === "homarr");
  if (!homarr || homarr.appId !== "homarr") {
    note("Optional Homarr fan-in is unavailable because the bundled Homarr recipe could not be reviewed.",
      "Homarr fan-in unavailable");
    return false;
  }
  const unaccepted: string[] = [];
  const cleanupPending: string[] = [];
  for (const appId of appIds) {
    const acceptance = await appAcceptanceStatus(root, appId);
    if (!acceptance.accepted) unaccepted.push(appId);
    if (acceptance.cleanupPending) cleanupPending.push(appId);
  }
  if (unaccepted.length > 0) {
    note(`Optional Homarr was not offered: current running app acceptance is not recorded for ${unaccepted.join(", ")}.`,
      "Homarr fan-in deferred");
    return false;
  }
  if (cleanupPending.length > 0) {
    note(`Acceptance is recorded for ${cleanupPending.join(", ")}; their synthetic canary cleanup remains separate.`,
      "App canary cleanup pending");
  }
  const before = await runJsonCli(["app", "status", "--id", "homarr",
    "--project-root", root, "--json"], "Checking the optional Homarr project");
  if (before.command !== "app status" || before.appId !== "homarr" || before.projectRoot !== root) {
    throw new Error("Homarr status did not match this project before optional fan-in.");
  }
  if (before.status !== "not-initialized" && before.status !== "applied") {
    note(`Homarr is at ${String(before.status)}. Inspect its saved project before trying the optional app links.`,
      "Homarr fan-in deferred");
    return false;
  }
  const beforeSetup = before.homarrSetup as { stage?: unknown } | null;
  const homarrNeedsInstall = before.status === "not-initialized";
  const homarrNeedsOnboarding = before.status === "applied" && beforeSetup?.stage !== "complete";
  let prompt = "Add local-only bookmarks for these accepted apps?";
  if (homarrNeedsInstall) {
    prompt = `Install standalone Homarr after accepting ${appIds.join(", ")} and add local-only bookmarks?`;
  } else if (homarrNeedsOnboarding) {
    prompt = `Complete Homarr onboarding, then add local-only bookmarks for ${appIds.join(", ")}?`;
  } else {
    const homarrLive = await runJsonCli(["app", "status", "--id", "homarr",
      "--project-root", root, "--live", "--json"], "Checking the existing Homarr runtime");
    const liveRuntime = homarrLive.runtime as { state?: unknown } | null;
    if (homarrLive.command !== "app status" || homarrLive.appId !== "homarr"
      || homarrLive.projectRoot !== root || homarrLive.status !== "applied"
      || liveRuntime?.state !== "running" || homarrLive.lastRecordedLifecycle === "stopped") {
      note("The saved Homarr project is not confirmed running. Resume it through its own lifecycle approval before optional attachment.",
        "Homarr fan-in deferred");
      return false;
    }
  }
  const addHomarr = stopIfCancelled(await confirm({
    message: `${prompt} No app network bridge, integration, or widget will be configured.`,
    initialValue: false,
  }));
  if (!addHomarr) return false;

  if (homarrNeedsInstall) {
    const availableRecipes = choices.some((choice) => choice.appId === "homarr")
      ? choices : [...choices, homarr];
    await installRecipeFlow(availableRecipes, "homarr", root, undefined, true);
  } else if (homarrNeedsOnboarding) {
    await continueHomarrSetup(root, true);
  }

  const after = await runJsonCli(["app", "status", "--id", "homarr",
    "--project-root", root, "--live", "--json"], "Verifying optional Homarr onboarding and runtime");
  const setup = after.homarrSetup as { stage?: unknown } | null;
  const runtime = after.runtime as { state?: unknown } | null;
  if (after.command !== "app status" || after.appId !== "homarr" || after.projectRoot !== root
    || after.status !== "applied" || setup?.stage !== "complete"
    || after.lastRecordedLifecycle === "stopped" || runtime?.state !== "running") {
    note("Homarr is not confirmed onboarded and running. No app bookmark was added.",
      "Homarr fan-in deferred");
    return false;
  }
  for (const appId of appIds) {
    const acceptance = await appAcceptanceStatus(root, appId);
    if (!acceptance.accepted) {
      note(`${appId} no longer has a current running accepted checkpoint. Remaining local bookmarks were deferred.`,
        "Homarr fan-in paused");
      return false;
    }
    if (acceptance.cleanupPending && !cleanupPending.includes(appId)) {
      note(`${appId} synthetic canary cleanup remains separate from its accepted app checkpoint.`,
        "App canary cleanup pending");
    }
    let attached: string | null;
    try {
      attached = await offerHomarrTile(root, appId, true);
    } catch {
      note(`The ${appId} Homarr attachment did not finish with a verified read-back. Inspect its exact attach status before retrying.`,
        "Homarr fan-in incomplete");
      return false;
    }
    if (attached === null) return false;
  }
  return true;
}

async function continueAppliedBatchApp(root: string, appId: string, withHomarr: boolean): Promise<boolean> {
  const current = await runJsonCli(["app", "status", "--id", appId,
    "--project-root", root, "--live", "--json"], `Checking the applied ${appId} project`);
  const runtime = current.runtime as { state?: unknown } | null;
  if (current.command !== "app status" || current.appId !== appId || current.projectRoot !== root
    || current.status !== "applied" || runtime?.state !== "running") {
    note(`${appId} is not confirmed running. Its account checks and Homarr attachment were deferred; inspect this exact app before resuming.`,
      "App needs inspection");
    return false;
  }
  showSavedAppRecap(root, appId);
  let readyForHomarr = true;
  if (appId === "uptime-kuma") readyForHomarr = await continueUptimeSetup(root);
  if (appId === "immich") await continueImmichSetup(root);
  if (appId === "paperless-ngx") await continuePaperlessSetup(root);
  if (withHomarr && readyForHomarr && appId !== "immich") await offerHomarrTile(root, appId);
  return (await appAcceptanceStatus(root, appId)).accepted;
}

async function reviewedFirstRun(root: string, appIds: string[]) {
  let cancelled = false;
  const outcomes = await runFirstRunSetups(root, appIds, {
    read: (args) => readOnlyCliJson(args),
    mutate: backgroundAppCliJson,
    async approve(appId, action, token, progress) {
      if (cancelled) return false;
      note(`${appId}: ${progress}\nExact approval: ${token}\nOther independent app setup may already be running.`,
        "Review first-run step");
      const decision = await confirm({
        message: `Approve ${appId} ${action}?`, initialValue: false,
      });
      if (isCancel(decision)) {
        cancelled = true;
        return false;
      }
      return decision;
    },
  });
  for (const result of outcomes) note(`${result.appId}: ${result.state}. ${result.detail}`, "First-run checkpoint");
  return outcomes;
}

async function installRecipeBatchFlow(choices: RecipeChoice[], root: string,
  withHomarr = false, homarrChoice?: RecipeChoice, expectedWorkflow?: unknown,
  allowOptionalHomarr = true): Promise<void> {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
    note("This batch installer currently needs a non-root Linux Docker host.", "Platform limit");
    outro("No app container was started.");
    return;
  }
  if (existsSync(join(root, ".selfhost", "app-batch.json"))) {
    note("This project already has an app batch ledger. Use Resume a project to inspect its exact jobs and app checkpoints before any new plan.",
      "Existing batch");
    return;
  }
  const selected = [...choices].sort((left, right) => left.appId.localeCompare(right.appId));
  const appArgs: string[] = [];
  const ports = new Set<number>();
  const selectedPorts = new Map<string, number>();
  for (const choice of selected) {
    const current = await runJsonCli(["app", "status", "--id", choice.appId,
      "--project-root", root, "--json"], `Checking ${choice.name}'s saved project`);
    if (current.appId !== choice.appId || current.projectRoot !== root
      || current.status !== "not-initialized") {
      note(`${choice.name} already has a saved checkpoint or an unexpected project state. Inspect its exact app status and resume it separately.`,
        "Batch deferred");
      return;
    }
  }
  const defaultDataParent = join(root, ".selfhost", "app-data");
  const dataInput = stopIfCancelled(await text({
    message: `Parent directory for these ${selected.length} app data folders (Enter for ${defaultDataParent})`,
    placeholder: defaultDataParent,
    validate(value) {
      if (value && (!isAbsolute(value) || resolve(value) !== value || /[\u0000-\u001f\u007f]/.test(value))) {
        return "Enter an exact absolute directory path or leave it blank for the default.";
      }
    },
  }));
  const dataParent = dataInput || defaultDataParent;
  const dataArgs = dataParent === defaultDataParent ? [] : ["--data-parent", dataParent];
  const identityArgs: string[] = [];
  if (selected.some((choice) => choice.appId === "immich")) {
    const emailInput = stopIfCancelled(await text({
      message: "First Immich administrator email (Enter for admin@example.test)",
      placeholder: "admin@example.test",
      validate(value) {
        if (value && (value.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value))) {
          return "Enter one valid email address.";
        }
      },
    }));
    const nameInput = stopIfCancelled(await text({
      message: "First Immich administrator name (Enter for Admin)",
      placeholder: "Admin",
      validate(value) {
        if (value && (value.trim().length === 0 || value.length > 128 || /[\r\n\u0000-\u001f\u007f]/.test(value))) {
          return "Enter a display name of at most 128 characters.";
        }
      },
    }));
    identityArgs.push("--email", `immich=${emailInput || "admin@example.test"}`,
      "--name", `immich=${nameInput || "Admin"}`);
  }
  let homarrNetwork: string | null = null;
  let homarrProjectId: string | null = null;
  if (withHomarr) {
    if (!homarrChoice || homarrChoice.appId !== "homarr") {
      throw new Error("The bundled Homarr recipe is unavailable; no app batch was started.");
    }
    const before = await runJsonCli(["app", "status", "--id", "homarr", "--project-root", root,
      "--json"], "Checking the selected Homarr project");
    if (before.status === "not-initialized") {
      await installRecipeFlow([...selected, homarrChoice], "homarr", root, undefined, true);
    } else if (before.status === "applied") {
      await continueHomarrSetup(root, true);
    } else {
      note(`Homarr is at ${String(before.status)}. Inspect its exact saved app status before retrying this batch.`,
        "Batch deferred");
      return;
    }
    const after = await runJsonCli(["app", "status", "--id", "homarr", "--project-root", root,
      "--live", "--json"], "Checking Homarr onboarding and runtime before connected app planning");
    const setup = after.homarrSetup as { stage?: unknown } | undefined;
    const runtime = after.runtime as { state?: unknown } | null;
    if (after.command !== "app status" || after.appId !== "homarr" || after.projectRoot !== root
      || after.status !== "applied" || setup?.stage !== "complete"
      || runtime?.state !== "running" || after.lastRecordedLifecycle === "stopped"
      || typeof after.projectId !== "string") {
      note("Homarr onboarding or its live runtime is incomplete. Resume its saved app checkpoint before planning the connected apps.",
        "Batch deferred");
      return;
    }
    homarrProjectId = after.projectId;
    homarrNetwork = `${homarrProjectId}-private`;
    if (!Number.isInteger(after.port) || after.port < 1024 || after.port > 65535) {
      throw new Error("The onboarded Homarr project did not report a valid private host port.");
    }
    ports.add(after.port);
  }
  for (const choice of selected) {
    const portInput = stopIfCancelled(await text({
      message: `Private host port for ${choice.name} (Enter for ${choice.defaultPort})`,
      placeholder: String(choice.defaultPort),
      validate(value) {
        const port = value || String(choice.defaultPort);
        if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
          return "Choose a TCP port from 1024 through 65535.";
        }
        if (ports.has(Number(port))) return "This port is already used by Homarr or another app in this batch.";
      },
    }));
    const port = Number(portInput || String(choice.defaultPort));
    ports.add(port);
    selectedPorts.set(choice.appId, port);
    appArgs.push("--app", `${choice.appId}=${port}`);
  }
  const mode = withHomarr ? "--connect-homarr" : "--without-homarr";
  const base = ["--project-root", root, ...appArgs, ...dataArgs, ...identityArgs, mode];
  const batch = await runJsonCli(["app", "batch", "plan", ...base, "--json"],
    `Planning ${selected.length} independent app jobs`);
  const jobs = batch.jobs as Array<{ id?: unknown; needs?: unknown; gates?: unknown;
    owner?: unknown; apps?: unknown; owns?: unknown }> | undefined;
  const workflow = batch.catalogWorkflow as { mode?: unknown; jobs?: unknown[] } | undefined;
  if (expectedWorkflow) {
    const comparable = (value: unknown) => {
      if (!value || typeof value !== "object") return null;
      const graph = value as { mode?: unknown; jobs?: unknown[] };
      if (graph.mode !== "planning-only" || !Array.isArray(graph.jobs)) return null;
      const jobs = graph.jobs.map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const job = raw as { id?: unknown; owner?: unknown; needs?: unknown;
          gates?: unknown; apps?: unknown };
        if (typeof job.id !== "string" || typeof job.owner !== "string"
          || !Array.isArray(job.needs) || !Array.isArray(job.gates) || !Array.isArray(job.apps)) return null;
        return { id: job.id, owner: job.owner,
          needs: [...job.needs].sort(), gates: [...job.gates].sort(), apps: [...job.apps].sort() };
      });
      if (jobs.includes(null)) return null;
      return JSON.stringify(jobs.sort((left, right) => String(left?.id).localeCompare(String(right?.id))));
    };
    const reviewed = comparable(expectedWorkflow);
    if (!reviewed || comparable(workflow) !== reviewed) {
      throw new Error("The batch catalog graph differs from the reviewed setup graph. Replan before approval.");
    }
  }
  const planned = batch.apps as Array<{ id?: unknown; port?: unknown; images?: unknown;
    approval?: unknown; plan?: unknown }> | undefined;
  if (batch.command !== "app batch plan" || batch.status !== "planned" || batch.mutation !== false
    || batch.withoutHomarr !== !withHomarr || batch.homarrNetwork !== homarrNetwork
    || batch.homarrProjectId !== homarrProjectId
    || JSON.stringify(batch.completed) !== JSON.stringify(withHomarr ? ["dashboard"] : [])
    || typeof batch.catalogPlanId !== "string" || !/^[0-9a-f]{16}$/.test(batch.catalogPlanId)
    || typeof batch.catalogSourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(batch.catalogSourceSha256)
    || workflow?.mode !== "planning-only" || !Array.isArray(workflow.jobs)
    || batch.projectRoot !== root || !Array.isArray(planned) || planned.length !== selected.length
    || !Array.isArray(jobs) || jobs.length !== selected.length
    || typeof batch.approval !== "string" || !/^BATCH:[0-9a-f]{64}$/.test(batch.approval)) {
    throw new Error("The app batch plan did not preserve the selected project or exact job graph.");
  }
  const imageArgs: string[] = [];
  const approvalArgs: string[] = [];
  const review: string[] = [withHomarr
    ? `Homarr project ${homarrProjectId} is onboarded on its private bridge ${homarrNetwork}. App tiles, integrations, and widgets need separate read-back.`
    : "Homarr is off for this independent app batch. No dashboard or integration will be installed.",
  `Project root: ${root}\nApp data parent: ${dataParent}`];
  for (const choice of selected) {
    const entry = planned.find((candidate) => candidate.id === choice.appId);
    const job = jobs.find((candidate) => candidate.id === `app-${choice.appId}`);
    const port = selectedPorts.get(choice.appId);
    if (port === undefined || !entry || entry.port !== port || !entry.plan || typeof entry.plan !== "object"
      || !job || !Array.isArray(job.needs)
      || JSON.stringify(job.needs) !== JSON.stringify(withHomarr ? ["dashboard"] : [])
      || job.owner !== "selfhost-compose"
      || JSON.stringify(job.apps) !== JSON.stringify([choice.appId])
      || JSON.stringify(job.gates) !== JSON.stringify(withHomarr
        ? ["fresh-host-inspection", "exact-apply-approval", "homarr-onboarded"]
        : ["fresh-host-inspection", "exact-apply-approval"])
      || !Array.isArray(job.owns) || job.owns.length < 2) {
      throw new Error(`The ${choice.name} batch job did not match the selected independent app.`);
    }
    const appPlan = entry.plan as Record<string, unknown>;
    const checked = reviewedRecipePlan(choice, appPlan, root, String(port));
    const host = appPlan.host as Record<string, unknown> | undefined;
    const onboarding = appPlan.onboarding as Record<string, unknown> | undefined;
    const gates = appPlan.remainingGates;
    if (!job.owns.includes(`project:${String(checked.compose.projectId)}`)
      || !job.owns.includes(`port:${port}`)
      || job.owns.some((owned) => typeof owned !== "string" || !owned)
      || typeof host?.dockerContext !== "string" || !host.dockerContext
      || typeof checked.compose.directory !== "string"
      || typeof checked.compose.network !== "string"
      || !Array.isArray(gates) || gates.some((gate) => typeof gate !== "string" || !gate)
      || entry.approval !== checked.approval || JSON.stringify(entry.images) !== JSON.stringify(checked.images)
      || checked.compose.homarrNetwork !== homarrNetwork
      || checked.compose.dataDirectory !== join(dataParent, choice.appId)) {
      throw new Error(`The ${choice.name} batch plan changed its exact app plan.`);
    }
    if (choice.appId === "immich"
      && (onboarding?.email !== identityArgs[1]?.slice(7)
        || onboarding.name !== identityArgs[3]?.slice(7))) {
      throw new Error("The Immich batch plan changed its first-administrator identity.");
    }
    for (const image of checked.images) imageArgs.push("--image", `${choice.appId}=${image}`);
    approvalArgs.push("--app-approve", `${choice.appId}=${checked.approval}`);
    const details = [`${choice.name}: ${choice.purpose}`,
      `  Maturity: ${choice.maturity}; app acceptance remains separate.`,
      `  Recipe SHA-256: ${choice.recipeSha256}`,
      ...checked.servicePurposes.map((service) => `  ${service.id}: ${service.purpose}`),
      `  Docker context: ${host.dockerContext}`,
      `  Project: ${String(checked.compose.projectId)}`,
      `  Private port: ${String(checked.compose.publishedPort)}`,
      `  Compose directory: ${checked.compose.directory}`,
      `  Compose target: ${checked.compose.renderTarget}`,
      `  Data: ${checked.compose.dataDirectory}`,
      `  Network: ${checked.compose.network}`,
      `  Images:\n    ${checked.images.join("\n    ")}`,
      `  Depends on: ${job.needs.length ? job.needs.join(", ") : "none"}`,
      `  Catalog plan: ${batch.catalogPlanId}`,
      `  Catalog gates: ${(job.gates as string[]).join(", ")}`,
      `  Owns:\n    ${job.owns.join("\n    ")}`,
      `  Remaining gates:\n    ${gates.join("\n    ")}`];
    if (choice.appId === "immich") {
      details.push(`  First administrator: ${onboarding?.name} <${onboarding?.email}>`);
    }
    details.push(`  App approval: ${checked.approval}`);
    review.push(details.join("\n"));
  }
  note(`${review.join("\n\n")}\n\nIndependent jobs can start two at a time. `
    + `Each app's first account, functional checks, and restart proof remain separate.\nBatch approval: ${batch.approval}`,
  "Review exact mixed-app batch");
  const expectedApplyArgs = ["self-host", "app", "batch", "apply", ...base,
    ...imageArgs, ...approvalArgs, "--approve", batch.approval, "--json"];
  if (JSON.stringify(batch.applyArgs) !== JSON.stringify(expectedApplyArgs)) {
    throw new Error("The batch's copyable apply command differs from the reviewed app plans.");
  }
  const approveBatch = stopIfCancelled(await confirm({
    message: `Approve all ${selected.length} exact app plans and start their batch (up to two at once)?`,
    initialValue: false,
  }));
  if (!approveBatch) {
    outro("Plan only. No batch job was started.");
    return;
  }
  const applied = await runJsonCli(expectedApplyArgs.slice(1),
  "Running the approved independent app jobs");
  if (applied.command !== "app batch apply" || !["applied-unverified", "partial-needs-inspection"].includes(String(applied.status))) {
    throw new Error("The batch runner did not return an exact applied or inspectable partial result.");
  }
  const status = await runJsonCli(["app", "batch", "status", "--project-root", root,
    "--json"], "Reading the saved app batch job history");
  if (status.command !== "app batch status" || status.projectRoot !== root
    || status.withoutHomarr !== !withHomarr || status.homarrNetwork !== homarrNetwork
    || status.homarrProjectId !== homarrProjectId) {
    throw new Error("The app batch status did not match this project.");
  }
  note(`Batch: ${String(status.status)}\n${batchProgressSummary(status)}\n`
    + `Apps: ${selected.map((choice) => `${choice.name} — ${choice.purpose}`).join("; ")}\n`
    + "Container apply is not account login, functional acceptance, restart persistence, or a backup restore.",
  "Saved batch checkpoint");
  const savedJobs = Array.isArray(status.jobs) ? status.jobs : [];
  const savedApps = Array.isArray(status.apps) ? status.apps : [];
  const readyApps = selected.filter((choice) => {
    const job = savedJobs.find((entry) => entry?.appId === choice.appId);
    const app = savedApps.find((entry) => entry?.appId === choice.appId);
    return job?.status === "applied" && app?.needsInspection === false
      && app?.recoveredFromExactState === false;
  });
  const completeBatch = status.status === "recorded" && savedJobs.length === selected.length
    && savedJobs.every((job) => job && typeof job === "object" && job.status === "applied")
    && readyApps.length === selected.length;
  let acceptedAppIds: string[] = [];
  if (readyApps.length && (!withHomarr || status.homarrNeedsInspection === false)) {
    if (completeBatch) {
      note("The parallel Compose jobs are recorded. Account setup, functional checks, and restart proof now continue one app at a time with their own approvals.",
        "Continue app checks");
    } else {
      note(`${readyApps.map((choice) => choice.name).join(", ")} passed the batch's exact approval and live-resource checks. Other jobs need inspection and will not be replayed.`,
        "Partial batch progress");
    }
    const continueReady = completeBatch || stopIfCancelled(await confirm({
      message: `Continue separate setup checks for ${readyApps.length} confirmed running app(s)?`,
      initialValue: false,
    }));
    if (continueReady) {
      const firstRun = await reviewedFirstRun(root, readyApps.map((choice) => choice.appId));
      for (const choice of readyApps) {
        if (firstRun.find((result) => result.appId === choice.appId)?.state !== "ready") continue;
        const accepted = await continueAppliedBatchApp(root, choice.appId, withHomarr);
        if (accepted) acceptedAppIds.push(choice.appId);
      }
    }
  }
  let homarrFanInComplete = false;
  if (allowOptionalHomarr && !withHomarr && completeBatch && acceptedAppIds.length === selected.length) {
    homarrFanInComplete = await offerOptionalHomarrFanIn(root, acceptedAppIds, selected, homarrChoice);
  }
  let homarrSummary = "Any Homarr content, integrations, widgets, and browser reachability remain separately checked.";
  if (homarrFanInComplete) {
    homarrSummary = "Local-only bookmark and Notebook read-backs passed; integrations, widgets, and browser reachability remain separate.";
  }
  outro(`Inspect each app's exact status for remaining gates. ${homarrSummary} For a partial batch, one pending job may use a fresh batch resume plan; attempted jobs need separately approved app recovery.`);
}

async function installRecipeFlow(choices: RecipeChoice[], selectedAppId?: string,
  selectedRoot?: string, selectedHomarr?: boolean, inAppJourney = false,
  allowOptionalHomarr = true) {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
    note("This app-only installer currently needs a non-root Linux Docker host.", "Platform limit");
    outro("No service was changed.");
    return;
  }
  let appId = selectedAppId;
  if (!appId) {
    appId = stopIfCancelled(await select({
      message: "Which app should be set up?",
      options: choices.map((choice) => ({ value: choice.appId, label: choice.name,
        hint: `${choice.serviceCount} service(s); ${choice.maturity}` })),
    }));
  }
  const choice = choices.find((candidate) => candidate.appId === appId);
  if (!choice) throw new Error("The selected app recipe disappeared before planning.");
  note(`This recipe sets up ${choice.name} with its own exact approval. Homarr can be included as a separate reviewed project; its dashboard content still needs verified attachment.`, "Recipe scope");
  const root = selectedRoot ?? await chooseRoot(true);
  if (existsSync(join(root, ".selfhost", "project.json"))) {
    const saved = invoke(["state", "status", "--project-root", root]);
    const state = saved.data?.state as { catalogSource?: { kind?: string } } | undefined;
    if (state?.catalogSource?.kind === "external") {
      outro("This project is bound to an external read-only catalog. The bundled recipe installer will not change it.");
      return;
    }
  }
  const existing = await runJsonCli(["app", "status", "--id", appId, "--project-root", root, "--json"],
    `Checking this project's ${choice.name} state`);
  if (existing.appId !== appId || existing.projectRoot !== root) {
    throw new Error("The app status did not match this project.");
  }
  if (existing.status !== "not-initialized") {
    note(`Saved stage: ${String(existing.status)}\nURL: ${String(existing.url ?? "none")}\nCredentials: ${String(existing.credentialRef ?? existing.passwordFile ?? "not prepared")}\nLast recorded lifecycle: ${String(existing.lastRecordedLifecycle ?? "unknown")}`, "Existing app");
    if (existing.status === "applied") {
      const firstRun = await reviewedFirstRun(root, [appId]);
      if (firstRun[0]?.state !== "ready") {
        outro(`Saved ${appId} setup needs inspection. Run self-host app status --id ${appId} --project-root ${root} --live --json before retrying.`);
        return;
      }
      if (appId === "homarr") await continueHomarrSetup(root, inAppJourney);
      else {
        const hasHomarrBridge = typeof existing.homarrNetwork === "string";
        const accepted = await continueAppliedBatchApp(root, appId, hasHomarrBridge);
        let homarrFanInComplete = false;
        if (allowOptionalHomarr && !hasHomarrBridge && accepted) {
          homarrFanInComplete = await offerOptionalHomarrFanIn(root, [appId], choices);
        }
        if (accepted) {
          let homarrSummary = "Any Homarr tile, Notebook, integration, widget, or browser-rendering status remains separate.";
          if (homarrFanInComplete) {
            homarrSummary = "Its local-only Homarr bookmark and Notebook passed read-back; integrations, widgets, and browser rendering remain separate.";
          }
          outro(`${appId} has a current running accepted checkpoint. ${homarrSummary}`);
        }
        else note(`${appId} acceptance is not recorded as current. Optional Homarr fan-in was deferred.`,
          "App acceptance pending");
      }
      return;
    }
    outro(`No second project was created. Inspect self-host app status --id ${appId} --project-root ${root} --json, then use its exact resume or lifecycle approval.`);
    return;
  }
  let homarrNetwork: string | null = null;
  if (appId !== "homarr") {
    let includeHomarr = selectedHomarr;
    if (includeHomarr === undefined) {
      includeHomarr = stopIfCancelled(await confirm({
        message: "Include Homarr as a private dashboard? It has its own setup approval.", initialValue: true,
      }));
    }
    if (includeHomarr) {
      const homarrChoice = choices.find((candidate) => candidate.appId === "homarr");
      if (!homarrChoice) throw new Error("The bundled Homarr recipe is unavailable; no app was changed.");
      const homarrBefore = await runJsonCli(["app", "status", "--id", "homarr", "--project-root", root, "--json"],
        "Checking the selected Homarr project");
      if (homarrBefore.status === "not-initialized") {
        await installRecipeFlow(choices, "homarr", root, undefined, true);
      } else if (homarrBefore.status === "applied") {
        await continueHomarrSetup(root, true);
      } else {
        outro(`Homarr is at ${String(homarrBefore.status)}. Inspect its exact app status before adding ${choice.name}; no new app was started.`);
        return;
      }
      const homarrAfter = await runJsonCli(["app", "status", "--id", "homarr", "--project-root", root, "--json"],
        "Checking Homarr onboarding before the app plan");
      const setup = homarrAfter.homarrSetup as { stage?: unknown } | undefined;
      if (homarrAfter.status !== "applied" || setup?.stage !== "complete"
        || homarrAfter.lastRecordedLifecycle === "stopped" || typeof homarrAfter.projectId !== "string") {
        outro(`Homarr has not completed its saved onboarding. Resume self-host app status --id homarr --project-root ${root} --json; ${choice.name} was not started.`);
        return;
      }
      homarrNetwork = `${homarrAfter.projectId}-private`;
    }
  }
  const portInput = stopIfCancelled(await text({
    message: `Private host port for ${choice.name} (Enter for ${choice.defaultPort})`,
    placeholder: String(choice.defaultPort),
    validate(value) {
      const selected = value || String(choice.defaultPort);
      if (!/^\d{4,5}$/.test(selected) || Number(selected) < 1024 || Number(selected) > 65535) {
        return "Choose a TCP port from 1024 through 65535.";
      }
    },
  }));
  const port = portInput || String(choice.defaultPort);
  const defaultDataParent = join(root, ".selfhost", "app-data");
  const dataInput = stopIfCancelled(await text({
    message: `Parent directory for ${choice.name} data (Enter for ${defaultDataParent})`,
    placeholder: defaultDataParent,
    validate(value) {
      if (value && (!isAbsolute(value) || resolve(value) !== value || /[\u0000-\u001f\u007f]/.test(value))) {
        return "Enter an exact absolute directory path or leave it blank for the default.";
      }
    },
  }));
  const dataParent = dataInput || defaultDataParent;
  const dataOption = dataParent === defaultDataParent ? [] : ["--data-parent", dataParent];
  const identityOptions: string[] = [];
  if (appId === "immich") {
    const emailInput = stopIfCancelled(await text({
      message: "First Immich administrator email (Enter for admin@example.test)",
      placeholder: "admin@example.test",
      validate(value) {
        if (value && (value.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value))) {
          return "Enter one valid email address.";
        }
      },
    }));
    const nameInput = stopIfCancelled(await text({
      message: "First Immich administrator name (Enter for Admin)",
      placeholder: "Admin",
      validate(value) {
        if (value && (value.trim().length === 0 || value.length > 128 || /[\r\n\u0000-\u001f\u007f]/.test(value))) {
          return "Enter a display name of at most 128 characters.";
        }
      },
    }));
    identityOptions.push("--email", emailInput || "admin@example.test", "--name", nameInput || "Admin");
  }
  const homarrOption = homarrNetwork ? ["--connect-homarr"] : [];
  const plan = await runJsonCli(["app", "plan", "--id", appId, "--project-root", root,
    "--resolve-images", "--port", port, ...dataOption, ...identityOptions, ...homarrOption, "--json"], "Inspecting the host and building the exact app plan");
  const reviewed = reviewedRecipePlan(choice, plan, root, port);
  if (reviewed.compose.homarrNetwork !== homarrNetwork) {
    throw new Error("The app plan did not preserve the selected Homarr bridge.");
  }
  if (appId === "immich") {
    const account = plan.onboarding as { email?: unknown; name?: unknown } | undefined;
    if (account?.email !== identityOptions[1] || account.name !== identityOptions[3]) {
      throw new Error("The Immich plan did not preserve the selected first-admin identity.");
    }
  }
  if (reviewed.compose.dataDirectory !== join(dataParent, appId)) {
    throw new Error("The app plan did not preserve the selected data parent.");
  }
  const inputs = ["--id", appId, "--project-root", root];
  for (const image of reviewed.images) inputs.push("--image", image);
  inputs.push("--port", port, ...dataOption, ...identityOptions, ...homarrOption);
  const explainedServices = reviewed.servicePurposes.map((service) => `${service.id}: ${service.purpose}`).join("\n");
  const reviewLines = [choice.purpose];
  if (explainedServices) reviewLines.push(`Services:\n${explainedServices}`);
  reviewLines.push(`Maturity: ${choice.maturity}; app acceptance remains separate.`);
  reviewLines.push(`Images: ${reviewed.images.join("\n")}`);
  reviewLines.push(`Project: ${String(reviewed.compose.projectId)}`);
  reviewLines.push(`Private port: ${String(reviewed.compose.publishedPort)}`);
  reviewLines.push(`Data: ${String(reviewed.compose.dataDirectory)}`);
  reviewLines.push(`Compose preview: ${String(reviewed.compose.renderTarget)} (filename refreshes after the apply-time host check)`);
  if (appId === "immich") reviewLines.push(`First administrator: ${identityOptions[3]} <${identityOptions[1]}>`);
  reviewLines.push(`Approval: ${reviewed.approval}`);
  if (homarrNetwork) reviewLines.push(`Homarr frontend bridge: ${homarrNetwork}. Dashboard tile, integration, and widget need separate verified attachment.`);
  else reviewLines.push("Homarr is not included.");
  note(reviewLines.join("\n"), "Review exact plan");
  const apply = stopIfCancelled(await confirm({
    message: `Approve this exact ${choice.name} Compose apply?`, initialValue: false,
  }));
  if (!apply) {
    outro("Plan only. No app container was started.");
    return;
  }
  const applied = await runJsonCli(["app", "apply", ...inputs, "--approve", reviewed.approval, "--json"],
    `Applying only the reviewed ${choice.name} project`);
  const appliedComposeTarget = applied.composeTarget;
  const composeDirectory = reviewed.compose.directory;
  const ownedComposeTarget = typeof appliedComposeTarget === "string"
    && typeof composeDirectory === "string"
    && isAbsolute(appliedComposeTarget)
    && samePath(dirname(appliedComposeTarget), composeDirectory)
    && /^compose\.[0-9a-f]{16}\.yaml$/.test(parse(appliedComposeTarget).base);
  if (applied.command !== "app apply" || applied.appId !== appId
    || applied.status !== "applied-unverified"
    || applied.acceptanceVerified !== false || applied.url !== `http://127.0.0.1:${port}`
    || applied.projectId !== reviewed.compose.projectId
    || applied.dataDirectory !== reviewed.compose.dataDirectory
    || !ownedComposeTarget
    || applied.homarrNetwork !== homarrNetwork) {
    throw new Error("App apply returned an unexpected checkpoint. Inspect app status before continuing.");
  }
  if (choice.kind === "single-service-compose" && applied.image !== reviewed.images[0]) {
    throw new Error("App apply returned a different image from the reviewed plan.");
  }
  if (choice.kind === "multi-service-compose" && JSON.stringify(applied.images) !== JSON.stringify(plan.images)) {
    throw new Error("App apply returned different service images from the reviewed plan.");
  }
  if (appId === "immich" && (applied.email !== identityOptions[1]
    || applied.name !== identityOptions[3])) {
    throw new Error("Immich apply did not preserve the reviewed first-admin identity.");
  }
  note(`Compose started at ${applied.url}.\n${explainedServices}\nApp login, function, and restart persistence still need direct checks.`, "Applied, not verified");
  const firstRun = await reviewedFirstRun(root, [appId]);
  if (firstRun[0]?.state !== "ready") {
    showSavedAppRecap(root, appId);
    outro(`First-run setup is ${firstRun[0]?.state ?? "unknown"}. Resume from self-host app status --id ${appId} --project-root ${root} --live --json; the exact project and credentials were preserved.`);
    return;
  }
  if (appId === "homarr") {
    await continueHomarrSetup(root, inAppJourney);
    return;
  }
  const accepted = await continueAppliedBatchApp(root, appId, Boolean(homarrNetwork));
  let homarrFanInComplete = false;
  if (allowOptionalHomarr && !homarrNetwork && accepted) {
    homarrFanInComplete = await offerOptionalHomarrFanIn(root, [appId], choices);
  }
  if (accepted) {
    let homarrSummary = "Any Homarr tile, Notebook, integration, widget, or browser-rendering status remains separate.";
    if (homarrFanInComplete) {
      homarrSummary = "Its local-only Homarr bookmark and Notebook passed read-back; integrations, widgets, and browser rendering remain separate.";
    }
    outro(`${appId} has a current running accepted checkpoint. ${homarrSummary}`);
  }
  else note(`${appId} acceptance is not recorded as current. Optional Homarr fan-in was deferred.`,
    "App acceptance pending");
}

const controlPanel = createControlPanel({
  readOnlyCliJson, stopIfCancelled, invoke, runJsonCli, chooseRoot, offerHomarrMcp,
  async inspectFirstRun(root, appId) {
    const outcome = await inspectFirstRunSetup(root, appId, readOnlyCliJson);
    return outcome.state === "ready";
  },
  installRecipeBatchFlow, installRecipeFlow, offerOptionalHomarrFanIn,
  offerConnectedHomarrApp: offerHomarrTile, resumeFlow,
  planFlow: (root) => planFlow(undefined, undefined, root),
});

export async function interactive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive setup needs a terminal. Use catalog, plan, and state commands with explicit arguments in scripts or AI agents.");
  }
  intro("self-host — your self-hosting control panel");
  if (await controlPanel.offerCliUpdate(true)) return;
  const savedProject = await controlPanel.savedControlPanelRoot();
  if (savedProject) {
    await controlPanel.controlPanelFlow(savedProject);
    return;
  }
  let availableGoals: Goal[] | null = null;
  try {
    const menu = invoke(["catalog", "menu"]);
    availableGoals = (menu.data?.goals ?? []) as Goal[];
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 240) : "unknown failure";
    note(`The catalog could not be read: ${detail}\nResume and tool checks remain available; run self-host catalog validate before planning a new setup.`, "Catalog needs repair");
  }
  const catalogActions = [
    { value: "plan", label: "Choose what to self-host", hint: "Get recommended apps, then review one shared Compose project" },
    { value: "browse", label: "Explore apps", hint: "Search the bundled or an external app catalog" },
  ];
  let recipeChoices: RecipeChoice[] = [];
  if (availableGoals) {
    const supported = { media: false, household: false };
    try { supported.media = await installPlanSupported("media"); } catch { /* Planning remains available. */ }
    try { supported.household = await installPlanSupported("household"); } catch { /* Planning remains available. */ }
    catalogActions.push(...installActions(supported));
    if (process.platform === "linux") {
      try {
        const recipes = invoke(["catalog", "recipes"]);
        recipeChoices = bundledRecipeChoices(recipes.data ?? {});
        if (recipeChoices.length > 0) {
          catalogActions.splice(1, 0, { value: "select-apps", label: "Select apps for a new project",
            hint: "Search, Space to toggle, Enter to review" });
          catalogActions.push({ value: "install-recipe", label: "Set up one app",
            hint: `${recipeChoices.length} Linux recipe(s); Homarr is optional` });
        }
      } catch { /* A missing or invalid recipe catalog removes this action. */ }
    }
  }
  const action = stopIfCancelled(await select({
    message: "What would you like to do?",
    options: [
      ...catalogActions,
      { value: "resume", label: "Resume a project", hint: "Inspect saved choices or the current household checkpoint" },
      { value: "doctor", label: "Check setup tools", hint: "Find missing prerequisites" },
    ],
  }));
  if (action === "plan") await planFlow();
  if (action === "select-apps") await controlPanel.createSelectedProjectFlow();
  if (action === "install-household") await installHouseholdFlow();
  if (action === "install-media") await installMediaFlow();
  if (action === "install-recipe") await installRecipeFlow(recipeChoices);
  if (action === "resume") await resumeFlow();
  if (action === "browse") await browseFlow();
  if (action === "doctor") {
    const scope = stopIfCancelled(await select({
      message: "Which prerequisites should be checked?",
      options: [
        { value: "plan", label: "Planning on this computer", hint: "Windows, macOS, or Linux" },
        { value: "media", label: "Deploying on a Linux Docker host", hint: "Bun, Docker, Bash, and API tools" },
      ],
    }));
    const { command, argv, env } = cliInvocation(["doctor", "--scope", scope]);
    const result = spawnSync(command, argv, { stdio: "inherit", env });
    if (result.error || result.status !== 0) process.exitCode = 1;
  }
}
