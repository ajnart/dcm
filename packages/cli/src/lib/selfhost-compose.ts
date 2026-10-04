import { spawnSync } from "node:child_process";
import { constants, existsSync, lstatSync } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireSharedPrestart } from "./shared-prestart.ts";
import { installedCliRoot } from "./installed-cli-root.ts";
import { portableComposeLifecycle } from "./portable-compose-lifecycle.ts";
import { protectPrivatePath } from "./platform-private.ts";

type JsonObject = Record<string, any>;

type ComposeProject = {
  dockerContext: string;
  id: string;
  directory: string;
};

export type SelfhostComposePlan = JsonObject & {
  planId: string;
  status: "pass";
  render: {
    target: string;
    format: "compose-yaml";
    noClobber: true;
  };
};

export type SelfhostComposeOwner = {
  plan(): Promise<SelfhostComposePlan>;
  render(plan: SelfhostComposePlan): Promise<string>;
  checkRendered(plan: SelfhostComposePlan): Promise<void>;
  preflight(plan: SelfhostComposePlan): Promise<void>;
  apply(plan: SelfhostComposePlan, requireExistingVolumes?: boolean): Promise<void>;
  stop(plan: SelfhostComposePlan): Promise<void>;
  selectedPlan(plan: SelfhostComposePlan, operation: "start" | "stop" | "add" | "recreate" | "probe" | "remove", services: string[]): Promise<SelfhostComposeSelection>;
  removeSelected(plan: SelfhostComposePlan, services: string[], approval: string): Promise<void>;
  startSelected(plan: SelfhostComposePlan, services: string[], approval: string): Promise<void>;
  stopSelected(plan: SelfhostComposePlan, services: string[], approval: string): Promise<void>;
  addSelected(plan: SelfhostComposePlan, services: string[], approval: string): Promise<void>;
  recreateSelected(plan: SelfhostComposePlan, services: string[], approval: string): Promise<void>;
  probeSelected(plan: SelfhostComposePlan, services: string[], approval: string): Promise<void>;
};

export type SelfhostComposeSelection = {
  project: string;
  context: string;
  planId: string;
  manifestSha256: string;
  file: string;
  operation: "start" | "stop" | "add" | "recreate" | "probe" | "remove";
  services: string[];
  approval: string;
  mutation: false;
  dockerInvoked: false;
  dependenciesStarted: false;
  fullAcceptance: false;
};

const maximumOutputBytes = 1024 * 1024;
export class ComposeRuntimeUnavailableError extends Error {
  readonly code = "compose-bun-missing";
  constructor() {
    super("Bun 1.4+ must be available on PATH for saved Compose ownership checks. Run self-host doctor before retrying.");
  }
}
const composeFindingKinds = new Set(["network", "path", "port", "project", "volume"]);
const composeFindingReasons = new Set([
  "desired-path-overlap",
  "desired-port-overlap",
  "network-already-observed",
  "new-network-owner-mismatch",
  "new-path-overlaps-observed",
  "observed-path-overlap",
  "observed-port-owner-conflict",
  "ownership-evidence-missing",
  "ownership-mismatch",
  "project-already-observed",
  "volume-already-observed",
]);
const composeValidationReasons = new Set([
  "network name is invalid or unsafe",
]);

function fail(message: string): never {
  throw new Error(message);
}

function requireObject(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} returned invalid JSON`);
  }
  return value as JsonObject;
}

function projectFrom(manifest: JsonObject): ComposeProject {
  const project = requireObject(manifest.project, "selfhost-compose manifest");
  if (typeof project.dockerContext !== "string" || project.dockerContext === ""
    || typeof project.id !== "string" || project.id === ""
    || typeof project.directory !== "string" || !isAbsolute(project.directory)
    || resolve(project.directory) !== project.directory) {
    fail("selfhost-compose manifest has an invalid exact-project identity");
  }
  return {
    dockerContext: project.dockerContext,
    id: project.id,
    directory: project.directory,
  };
}

function composePlanFailure(stdout: unknown, stderr: unknown): string | null {
  if (typeof stdout === "string" && stdout.length <= maximumOutputBytes) {
    try {
      const value = requireObject(JSON.parse(stdout), "selfhost-compose plan");
      if ((value.status === "blocked" || value.status === "conflict")
        && Array.isArray(value.conflicts) && Array.isArray(value.blockers)) {
        const findings = [...value.conflicts, ...value.blockers];
        if (findings.length > 0 && findings.length <= 32) {
          const summaries: string[] = [];
          let valid = true;
          for (const finding of findings) {
            if (!finding || typeof finding !== "object" || Array.isArray(finding)
              || !composeFindingKinds.has(finding.kind) || !composeFindingReasons.has(finding.reason)) {
              valid = false;
              break;
            }
            summaries.push(`${finding.kind}:${finding.reason}`);
          }
          if (valid) {
            return `${value.status} ${[...new Set(summaries)].sort().join(", ")}`;
          }
        }
      }
    } catch {
      // Only canonical, allowlisted plan fields may cross the child boundary.
    }
  }

  if (typeof stderr === "string") {
    for (const reason of composeValidationReasons) {
      if (stderr === `compose-project.ts: ${reason}\n`) {
        return `rejected manifest: ${reason}`;
      }
    }
  }
  return null;
}

function runtimeDirectory(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const packaged = join(fileURLToPath(installedCliRoot(import.meta.url)), "workflows", "selfhost-compose", "scripts");
  if (existsSync(join(packaged, "compose-project.ts")) && existsSync(join(packaged, "compose-lifecycle.sh"))) {
    return packaged;
  }

  let repository = resolve(moduleDirectory, "../../../.agents/skills/self-host/workflows/selfhost-compose/scripts");
  if (basename(moduleDirectory) === "lib" && basename(dirname(moduleDirectory)) === "src") {
    repository = resolve(moduleDirectory, "../../../../.agents/skills/self-host/workflows/selfhost-compose/scripts");
  }
  if (existsSync(join(repository, "compose-project.ts")) && existsSync(join(repository, "compose-lifecycle.sh"))) {
    return repository;
  }
  fail("CLI is missing the canonical selfhost-compose runtime");
}

function invoke(command: string, args: string[], label: string): string {
  const environment: NodeJS.ProcessEnv = { ...process.env, COMPOSE_PROFILES: "" };
  if (command === "bun" && process.versions.bun) {
    command = process.execPath;
    environment.BUN_BE_BUN = "1";
  }
  const result = spawnSync(command, args, {
    env: environment,
    encoding: "utf8",
    maxBuffer: maximumOutputBytes,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (command === "bun" && (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new ComposeRuntimeUnavailableError();
  }
  if (result.status !== 0) {
    if (label === "selfhost-compose plan") {
      const detail = composePlanFailure(result.stdout, result.stderr);
      if (detail) {
        fail(`${label} ${detail}`);
      }
    }
    fail(`${label} failed; child output was suppressed`);
  }
  return result.stdout;
}

function invokeJson(command: string, args: string[], label: string): JsonObject {
  const output = invoke(command, args, label);
  try {
    return requireObject(JSON.parse(output), label);
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`${label} returned invalid JSON`);
    }
    throw error;
  }
}

function requireBunRuntime(): void {
  if (process.versions.bun) {
    const embedded = /^(\d+)\.(\d+)\.(\d+)/.exec(process.versions.bun);
    if (!embedded || Number(embedded[1]) < 1 || (Number(embedded[1]) === 1 && Number(embedded[2]) < 4)) throw new ComposeRuntimeUnavailableError();
    return;
  }
  const result = spawnSync("bun", ["--version"], {
    encoding: "utf8",
    maxBuffer: 4096,
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec((result.stdout ?? "").trim());
  if (result.error || result.status !== 0 || !version) {
    throw new ComposeRuntimeUnavailableError();
  }
  const major = Number(version[1]);
  const minor = Number(version[2]);
  if (major < 1 || (major === 1 && minor < 4)) {
    throw new ComposeRuntimeUnavailableError();
  }
}

function targetFrom(plan: SelfhostComposePlan, project: ComposeProject, expectedApplyApproval: string): string {
  if (!/^[0-9a-f]{16}$/.test(plan.planId) || plan.status !== "pass"
    || plan.execution?.performed !== false || plan.render?.format !== "compose-yaml"
    || plan.render?.noClobber !== true) {
    fail("selfhost-compose did not produce a read-only passing no-clobber plan");
  }
  const target = join(project.directory, `compose.${plan.planId}.yaml`);
  if (plan.render.target !== target) {
    fail("selfhost-compose plan target does not match the exact project");
  }
  if (plan.project?.dockerContext !== project.dockerContext || plan.project?.id !== project.id
    || plan.project?.directory !== project.directory || plan.approvals?.apply !== expectedApplyApproval) {
    fail("selfhost-compose plan identity does not match the exact project");
  }
  return target;
}

async function withPrivateManifest<T>(manifest: JsonObject, manifestPath: string | undefined, callback: (path: string) => T): Promise<T> {
  requireBunRuntime();
  if (manifestPath) {
    if (!isAbsolute(manifestPath) || resolve(manifestPath) !== manifestPath) {
      fail("selfhost-compose manifest path must be exact and absolute");
    }
    return callback(manifestPath);
  }

  const directory = await mkdtemp(join(tmpdir(), "selfhost-compose-cli-"));
  protectPrivatePath(directory, 0o700);
  const path = join(directory, "manifest.json");
  try {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      protectPrivatePath(path, 0o600);
      await handle.writeFile(`${JSON.stringify(manifest)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return callback(path);
  } finally {
    await rm(directory, { recursive: true });
  }
}

export function createSelfhostComposeOwner(manifest: JsonObject, manifestPath?: string): SelfhostComposeOwner {
  const exactManifest = structuredClone(manifest);
  const project = projectFrom(exactManifest);
  const runtime = runtimeDirectory();
  let owner = join(runtime, "compose-project.ts");
  if (existsSync(join(runtime, "compose-project.js"))) owner = join(runtime, "compose-project.js");
  const lifecycle = join(runtime, "compose-lifecycle.sh");
  function invokeLifecycle(args: string[], label: string): string {
    const action = args[1];
    const options = new Map<string, string>();
    for (let index = 2; index < args.length; index += 2) options.set(args[index], args[index + 1]);
    portableComposeLifecycle({ action, manifest: options.get("--manifest")!, context: project.dockerContext,
      project: project.id, file: options.get("--file")!, services: options.get("--services")?.split(","),
      approval: options.get("--approval"), requireExistingVolumes: options.get("--require-existing-volumes") === "true" },
      (canonicalArgs) => invoke("bun", [owner, ...canonicalArgs], label), invoke, (operation, services) => {
        let checker = join(runtime, "pre-start-check.ts");
        if (existsSync(join(runtime, "pre-start-check.js"))) checker = join(runtime, "pre-start-check.js");
        const checkerStat = lstatSync(checker);
        if (!checkerStat.isFile() || checkerStat.isSymbolicLink()) fail("Canonical app pre-start checker is missing or unsafe");
        const checkArgs = [checker, "--manifest", options.get("--manifest")!, "--operation", operation];
        if (services) checkArgs.push("--services", services.join(","));
        invoke("bun", checkArgs, "selfhost-compose pre-start check");
      });
    return "";
  }
  function canonicalApplyApproval(path: string): string {
    return invoke("bun", [owner, "apply-approval", "--input", path], "selfhost-compose apply approval").trim();
  }
  async function checkedTarget(planResult: SelfhostComposePlan): Promise<string> {
    return withPrivateManifest(exactManifest, manifestPath,
      (path) => targetFrom(planResult, project, canonicalApplyApproval(path)));
  }

  async function plan(): Promise<SelfhostComposePlan> {
    return withPrivateManifest(exactManifest, manifestPath, (path) => {
      const result = invokeJson("bun", [owner, "plan", "--input", path], "selfhost-compose plan") as SelfhostComposePlan;
      targetFrom(result, project, canonicalApplyApproval(path));
      return result;
    });
  }

  async function render(planResult: SelfhostComposePlan): Promise<string> {
    const target = await checkedTarget(planResult);
    if (existsSync(target)) {
      return target;
    }
    await withPrivateManifest(exactManifest, manifestPath, (path) => {
      const result = invokeJson(
        "bun",
        [owner, "render", "--input", path, "--output-dir", project.directory],
        "selfhost-compose render",
      );
      if (result.status !== "rendered" || result.project !== project.id || result.target !== target
        || result.overwritten !== false || result.dockerInvoked !== false) {
        fail("selfhost-compose render returned an invalid exact-project result");
      }
    });
    return target;
  }

  async function preflight(planResult: SelfhostComposePlan): Promise<void> {
    const target = await checkedTarget(planResult);
    await withPrivateManifest(exactManifest, manifestPath, (path) => {
      invokeLifecycle([
        lifecycle,
        "preflight",
        "--manifest", path,
        "--context", project.dockerContext,
        "--project", project.id,
        "--file", target,
      ], "selfhost-compose preflight");
    });
  }

  async function checkRendered(planResult: SelfhostComposePlan): Promise<void> {
    const target = await checkedTarget(planResult);
    await withPrivateManifest(exactManifest, manifestPath, (path) => {
      const verified = invokeJson("bun", [owner, "lifecycle-check", "--input", path,
        "--context", project.dockerContext, "--project", project.id, "--file", target], "selfhost-compose rendered check");
      if (verified.valid !== true || verified.status !== "pass" || verified.project !== project.id
        || verified.context !== project.dockerContext || verified.file !== target || verified.dockerInvoked !== false) {
        fail("selfhost-compose rendered check returned an invalid exact-project result");
      }
    });
  }

  async function apply(planResult: SelfhostComposePlan, requireExistingVolumes = false): Promise<void> {
    const target = await checkedTarget(planResult);
    await requireSharedPrestart(exactManifest, "apply");
    const volumeGuard = requireExistingVolumes ? ["--require-existing-volumes", "true"] : [];
    await withPrivateManifest(exactManifest, manifestPath, (path) => {
      invokeLifecycle([
        lifecycle,
        "preflight",
        "--manifest", path,
        "--context", project.dockerContext,
        "--project", project.id,
        "--file", target,
        ...volumeGuard,
      ], "selfhost-compose preflight");
      invokeLifecycle([
        lifecycle,
        "apply",
        "--manifest", path,
        "--context", project.dockerContext,
        "--project", project.id,
        "--file", target,
        "--approval", planResult.approvals.apply,
        ...volumeGuard,
      ], "selfhost-compose apply");
      const verified = invokeJson("bun", [
        owner,
        "lifecycle-check",
        "--input", path,
        "--context", project.dockerContext,
        "--project", project.id,
        "--file", target,
      ], "post-apply selfhost-compose lifecycle check");
      if (verified.valid !== true || verified.status !== "pass" || verified.project !== project.id
        || verified.context !== project.dockerContext || verified.file !== target || verified.dockerInvoked !== false) {
        fail("post-apply selfhost-compose lifecycle check returned an invalid exact-project result");
      }
    });
  }

  async function stop(planResult: SelfhostComposePlan): Promise<void> {
    const target = await checkedTarget(planResult);
    await withPrivateManifest(exactManifest, manifestPath, (path) => {
      invokeLifecycle([
        lifecycle,
        "stop",
        "--manifest", path,
        "--context", project.dockerContext,
        "--project", project.id,
        "--file", target,
        "--approval", `STOP:${project.id}`,
      ], "selfhost-compose stop");
    });
  }

  async function selectedPlan(planResult: SelfhostComposePlan, operation: "start" | "stop" | "add" | "recreate" | "probe" | "remove", services: string[]): Promise<SelfhostComposeSelection> {
    const target = await checkedTarget(planResult);
    if (!["start", "stop", "add", "recreate", "probe", "remove"].includes(operation) || !Array.isArray(services) || services.length < 1 || services.length > 512
      || services.some((id) => typeof id !== "string" || !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(id))
      || new Set(services).size !== services.length) fail("Selected lifecycle needs unique exact service IDs");
    const selected = [...services].sort();
    return withPrivateManifest(exactManifest, manifestPath, (path) => {
      const result = invokeJson("bun", [owner, "selected-plan", "--input", path,
        "--services", selected.join(","), "--operation", operation], "selfhost-compose selected plan");
      if (result.project !== project.id || result.context !== project.dockerContext || result.planId !== planResult.planId
        || typeof result.manifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(result.manifestSha256)
        || result.manifestSha256.slice(0, 16) !== result.planId
        || result.file !== target || result.operation !== operation || JSON.stringify(result.services) !== JSON.stringify(selected)
        || typeof result.approval !== "string" || !/^SELECTED-(START|STOP|ADD|RECREATE|PROBE|REMOVE):[a-z0-9_-]+:[0-9a-f]{64}$/.test(result.approval)
        || result.mutation !== false || result.dockerInvoked !== false || result.dependenciesStarted !== false
        || result.fullAcceptance !== false) fail("Selected plan returned an invalid exact-project result");
      return result as SelfhostComposeSelection;
    });
  }

  async function selectedLifecycle(planResult: SelfhostComposePlan, operation: "start" | "stop" | "add" | "recreate" | "probe" | "remove", services: string[], approval: string): Promise<void> {
    const selection = await selectedPlan(planResult, operation, services);
    if (approval !== selection.approval) fail("Selected lifecycle needs the exact separately reviewed selection approval");
    await requireSharedPrestart(exactManifest, operation, services);
    await withPrivateManifest(exactManifest, manifestPath, (path) => {
      invokeLifecycle([lifecycle, `selected-${operation}`, "--manifest", path,
        "--context", project.dockerContext, "--project", project.id, "--file", selection.file,
        "--services", selection.services.join(","), "--approval", approval], "selfhost-compose selected lifecycle");
    });
  }

  return { plan, render, checkRendered, preflight, apply, stop, selectedPlan,
    removeSelected: (planResult, services, approval) => selectedLifecycle(planResult, "remove", services, approval),
    startSelected: (planResult, services, approval) => selectedLifecycle(planResult, "start", services, approval),
    stopSelected: (planResult, services, approval) => selectedLifecycle(planResult, "stop", services, approval),
    addSelected: (planResult, services, approval) => selectedLifecycle(planResult, "add", services, approval),
    recreateSelected: (planResult, services, approval) => selectedLifecycle(planResult, "recreate", services, approval),
    probeSelected: (planResult, services, approval) => selectedLifecycle(planResult, "probe", services, approval) };
}
