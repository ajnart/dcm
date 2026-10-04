import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { runApprovedDag, type JobResult } from "./lib/approved-dag.ts";
import { savedAppIds } from "./lib/app-state-discovery.ts";
import { BatchMutationLockError, withBatchMutationLock } from "./lib/batch-mutation-lock.ts";
import { shellCommand } from "./lib/shell-command.ts";

type Json = Record<string, any>;
type AppInvoker = (args: string[]) => Promise<void>;
type WorkflowResolver = (appIds: string[], withHomarr: boolean) => Json;
type Selection = { id: string; port: number };
type HomarrBinding = { projectId: string; network: string };
type BatchOptions = { action: "plan" | "apply" | "status" | "info" | "resume-plan" | "resume" | "step-plan" | "step";
  root: string; apps: Selection[]; jobId: string | null;
  images: Map<string, string[]>; approvals: Map<string, string>; approval: string | null;
  dataParent: string | null; email: string | null; name: string | null; json: boolean;
  withoutHomarr: boolean; connectHomarr: boolean };
type BatchJob = { id: string; needs: string[]; gates: string[]; owner: string;
  apps: string[]; owns: string[] };
type BatchPlan = { schemaVersion: 1; command: "app batch plan"; status: "planned";
  mutation: false; projectRoot: string; withoutHomarr: boolean;
  homarrNetwork: string | null; homarrProjectId: string | null; completed: string[];
  catalogPlanId: string; catalogSourceSha256: string; catalogWorkflow: Json;
  apps: Array<{ id: string; port: number;
    images: string[]; approval: string; plan: Json; applyArgs: string[] }>;
  jobs: BatchJob[]; approval: string; applyArgs: string[]; applyCommand: string;
  acceptanceVerified: false };
type StepCheckpoint = { schemaVersion: 1; stage: "uptime-kuma-credential-prepare";
  jobId: "app-uptime-kuma"; appId: "uptime-kuma";
  status: "attempted" | "prepared-not-login-verified";
  approval: string; accountApproval: string; username: "admin";
  credentialRef: string; attemptedAt: string; recordedAt?: string };
type Ledger = { schemaVersion: 1 | 2 | 3; projectRoot: string; approval: string; withoutHomarr: boolean;
  homarr?: HomarrBinding;
  catalog?: { planId: string; sourceSha256: string; workflow: Json };
  inputs?: { dataParent: string | null; email: string | null; name: string | null;
    dockerContext: string };
  postApply?: { schemaVersion: 1; steps: StepCheckpoint[] };
  createdAt: string; jobs: Array<{ id: string; appId: string; projectId: string;
    port: number; images: string[];
    approval: string; status: "pending" | "launch-attempted" | JobResult["status"];
    recipeSha256?: string; composePlanId?: string; owns?: string[];
    failureCode?: string }> };

export class BatchCommandError extends Error {
  constructor(message: string, readonly code = "app-batch-rejected", readonly partialWritePossible = false) {
    super(message);
    this.name = "BatchCommandError";
  }
}

function fail(message: string, code?: string, partial = false): never {
  throw new BatchCommandError(message, code, partial);
}

async function underBatchLock<T>(root: string, callback: () => Promise<T>): Promise<T> {
  try { return await withBatchMutationLock(root, callback); }
  catch (error) {
    if (error instanceof BatchMutationLockError) {
      fail(error.message, error.partialWritePossible ? "batch-lock-ownership-changed" : "batch-lock-held",
        error.partialWritePossible);
    }
    throw error;
  }
}

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digestPattern = /^BATCH:[0-9a-f]{64}$/;
const resumeDigestPattern = /^BATCH-RESUME:[0-9a-f]{64}$/;
const stepDigestPattern = /^BATCH-STEP:[0-9a-f]{64}$/;
const accountDigestPattern = /^APP-ACCOUNT:uptime-kuma:[0-9a-f]{64}$/;

function parse(args: string[]): BatchOptions | null {
  if (args.length === 0 || args[0] === "help") return null;
  const action = args[0];
  if (action !== "plan" && action !== "apply" && action !== "status" && action !== "info"
    && action !== "resume-plan" && action !== "resume" && action !== "step-plan" && action !== "step") {
    fail("app batch supports plan, apply, status, info, resume-plan, resume, step-plan, and step");
  }
  const flags = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const repeatable = new Set(["--app", "--image", "--app-approve"]);
  const allowed = new Set(["--project-root", "--app", "--job", "--data-parent", "--image", "--app-approve",
    "--approve", "--email", "--name", "--without-homarr", "--connect-homarr", "--json"]);
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.has(flag)) fail("Invalid app batch option");
    if (flag === "--json" || flag === "--without-homarr" || flag === "--connect-homarr") {
      if (flags.has(flag)) fail(`Repeated ${flag}`);
      flags.set(flag, "true");
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) fail(`${flag} requires one value`);
    if (repeatable.has(flag)) repeated.set(flag, [...(repeated.get(flag) ?? []), value]);
    else {
      if (flags.has(flag)) fail(`Repeated ${flag}`);
      flags.set(flag, value);
    }
  }
  const withoutHomarr = flags.has("--without-homarr");
  const connectHomarr = flags.has("--connect-homarr");
  const freshAction = action === "plan" || action === "apply";
  const resumeAction = action === "resume-plan" || action === "resume";
  const stepAction = action === "step-plan" || action === "step";
  if (withoutHomarr && connectHomarr) fail("app batch Homarr modes are mutually exclusive");
  if (freshAction && !withoutHomarr && !connectHomarr) {
    fail("app batch plan and apply require --connect-homarr or --without-homarr");
  }
  const root = flags.get("--project-root");
  if (!root || !isAbsolute(root) || resolve(root) !== root || root === sep || root === resolve(homedir())) {
    fail("--project-root must be one exact absolute project directory, not root or home");
  }
  const apps: Selection[] = [];
  for (const value of repeated.get("--app") ?? []) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(\d{4,5})$/.exec(value);
    if (!match || !idPattern.test(match[1]) || match[1].length > 47
      || Number(match[2]) < 1024 || Number(match[2]) > 65535) fail("--app must be ID=PORT with a private port from 1024 through 65535");
    if (match[1] === "homarr" || match[1] === "media") fail("Homarr and media are outside the app-only batch route");
    apps.push({ id: match[1], port: Number(match[2]) });
  }
  if (freshAction && (apps.length < 2 || apps.length > 8)) fail("app batch requires 2 through 8 apps");
  if (!freshAction && apps.length) fail("saved batch commands read the ledger; do not pass --app");
  const jobId = flags.get("--job") ?? null;
  if ((resumeAction || stepAction) && (!jobId || !idPattern.test(jobId) || jobId.length > 47)) {
    fail("batch resume or step needs one --job APP_ID");
  }
  if (!resumeAction && !stepAction && jobId) fail("--job is only for batch resume or step commands");
  if (new Set(apps.map((app) => app.id)).size !== apps.length
    || new Set(apps.map((app) => app.port)).size !== apps.length) fail("app IDs and private ports must each be distinct");
  const images = new Map<string, string[]>();
  for (const value of repeated.get("--image") ?? []) {
    const separator = value.indexOf("=");
    if (separator < 1 || separator === value.length - 1) fail("--image must be ID=PINNED_SPEC");
    const id = value.slice(0, separator);
    const spec = value.slice(separator + 1);
    if (!apps.some((app) => app.id === id) || !(spec.includes("@sha256:"))) fail("--image must target a selected app with a pinned digest");
    images.set(id, [...(images.get(id) ?? []), spec]);
  }
  const approvals = new Map<string, string>();
  for (const value of repeated.get("--app-approve") ?? []) {
    const separator = value.indexOf("=");
    const id = value.slice(0, separator);
    const token = value.slice(separator + 1);
    if (separator < 1 || !apps.some((app) => app.id === id) || !token || approvals.has(id)) {
      fail("--app-approve must be one ID=TOKEN per selected app");
    }
    approvals.set(id, token);
  }
  if (action === "plan" && (approvals.size || flags.has("--approve"))) {
    fail("app batch plan does not accept apply approvals");
  }
  if (action === "plan" && images.size > 0 && images.size !== apps.length) {
    fail("app batch plan needs pinned images for every selected app, or none for registry resolution");
  }
  if (action === "apply" && (images.size !== apps.length || approvals.size !== apps.length
    || !digestPattern.test(flags.get("--approve") ?? ""))) {
    fail("app batch apply requires pinned images, every app approval, and one BATCH approval");
  }
  if ((action === "status" || action === "info") && (images.size || approvals.size || flags.has("--approve")
    || flags.has("--data-parent") || flags.has("--email") || flags.has("--name"))) {
    fail("app batch status/info accepts only project root, optional saved Homarr mode, and --json");
  }
  if (resumeAction && (images.size || approvals.size || flags.has("--data-parent")
    || flags.has("--email") || flags.has("--name") || withoutHomarr || connectHomarr)) {
    fail("batch resume uses only saved inputs, --job, --project-root, and its fresh approval");
  }
  if (action === "resume-plan" && flags.has("--approve")) fail("resume-plan is read-only; omit --approve");
  if (action === "resume" && !resumeDigestPattern.test(flags.get("--approve") ?? "")) {
    fail("batch resume needs the fresh BATCH-RESUME approval");
  }
  if (stepAction && (images.size || approvals.size || flags.has("--data-parent")
    || flags.has("--email") || flags.has("--name") || withoutHomarr || connectHomarr)) {
    fail("batch step uses only saved inputs, --job, --project-root, and its fresh approval");
  }
  if (action === "step-plan" && flags.has("--approve")) fail("step-plan is read-only; omit --approve");
  if (action === "step" && !stepDigestPattern.test(flags.get("--approve") ?? "")) {
    fail("batch step needs the fresh BATCH-STEP approval");
  }
  const email = flags.get("--email") ?? null;
  const name = flags.get("--name") ?? null;
  if ((email || name) && !apps.some((app) => app.id === "immich")) fail("--email and --name require Immich in this batch");
  if ((email && !email.startsWith("immich=")) || (name && !name.startsWith("immich="))) {
    fail("batch identity flags must be --email immich=EMAIL and --name immich=NAME");
  }
  return { action, root, apps: apps.sort((a, b) => a.id.localeCompare(b.id)), jobId, images, approvals,
    approval: flags.get("--approve") ?? null, dataParent: flags.get("--data-parent") ?? null,
    email: email?.slice(7) ?? null, name: name?.slice(7) ?? null, json: flags.has("--json"),
    withoutHomarr, connectHomarr };
}

async function checkedRoot(root: string): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root
    || (info.mode & 0o002) !== 0 || info.uid !== process.getuid?.()) {
    fail("project root must be a real, current-user-owned, non-world-writable directory");
  }
}

async function invokeJson(invoke: AppInvoker, args: string[]): Promise<Json> {
  const output: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => { output.push(values.map(String).join(" ")); };
  try { await invoke(args); }
  finally { console.log = original; }
  if (output.length !== 1) fail("app adapter returned an unexpected response");
  let value: unknown;
  try { value = JSON.parse(output[0]); }
  catch { fail("app adapter returned invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("app adapter returned invalid JSON");
  return value as Json;
}

function appArgs(options: BatchOptions, app: Selection, images?: string[]): string[] {
  const args = ["--id", app.id, "--project-root", options.root, "--port", String(app.port)];
  if (options.connectHomarr) args.push("--connect-homarr");
  if (options.dataParent) args.push("--data-parent", options.dataParent);
  if (app.id === "immich") {
    if (options.email) args.push("--email", options.email);
    if (options.name) args.push("--name", options.name);
  }
  if (images) for (const image of images) args.push("--image", image);
  else args.push("--resolve-images");
  return args;
}

function exactImages(plan: Json): string[] {
  if (typeof plan.image === "string") return [plan.image];
  if (!plan.images || typeof plan.images !== "object" || Array.isArray(plan.images)) fail("app plan omitted pinned images");
  return Object.entries(plan.images).map(([service, image]) => {
    if (typeof image !== "string") fail("app plan has an invalid image");
    return `${service}=${image}`;
  });
}

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function expectedCatalogJobs(appIds: string[], withHomarr: boolean): Json[] {
  const baseGates = ["fresh-host-inspection", "exact-apply-approval"];
  const expected: Json[] = [];
  if (withHomarr) {
    expected.push({ id: "dashboard", needs: [], gates: baseGates,
      owner: "selfhost-homarr", apps: ["homarr"] });
  }
  for (const id of appIds) {
    expected.push({ id: `app-${id}`, needs: withHomarr ? ["dashboard"] : [],
      gates: withHomarr ? [...baseGates, "homarr-onboarded"] : baseGates,
      owner: "selfhost-compose", apps: [id] });
  }
  if (withHomarr) {
    expected.push({ id: "homarr-attachments", needs: ["dashboard", ...appIds.map((id) => `app-${id}`)],
      gates: [...baseGates, "app-running-on-homarr-bridge"],
      owner: "selfhost-homarr", apps: appIds });
  }
  return expected;
}

function jobFields(job: Json): Json {
  return { id: job.id, needs: job.needs, gates: job.gates,
    owner: job.owner, apps: job.apps };
}

function catalogJobs(options: BatchOptions, resolveWorkflow: WorkflowResolver): {
  planId: string; sourceSha256: string; workflow: Json; jobs: Json[] } {
  const catalog = resolveWorkflow(options.apps.map((app) => app.id), options.connectHomarr);
  const source = catalog.catalogSource;
  const workflow = catalog.workflow;
  if (typeof catalog.planId !== "string" || !/^[0-9a-f]{16}$/.test(catalog.planId)
    || source?.kind !== "bundled" || source.executionAuthority !== "packaged"
    || typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.sha256)
    || workflow?.mode !== "planning-only" || !Array.isArray(workflow.jobs)
    || workflow.jobs.some((job: unknown) => !job || typeof job !== "object" || Array.isArray(job))) {
    fail("batch needs a validated bundled catalog workflow");
  }
  const expected = expectedCatalogJobs(options.apps.map((app) => app.id), options.connectHomarr);
  if (JSON.stringify(workflow.jobs.map(jobFields)) !== JSON.stringify(expected)
    || !Array.isArray(catalog.setupStages)
    || catalog.setupStages.some((stage: unknown) => !stage || typeof stage !== "object" || Array.isArray(stage))
    || JSON.stringify(catalog.setupStages.map((stage: Json) => ({ id: stage.id,
      owner: stage.owner, apps: stage.apps }))) !== JSON.stringify(expected.map((job) => ({
        id: job.id, owner: job.owner, apps: job.apps })))) {
    fail("catalog workflow has changed or includes jobs the bounded batch cannot execute");
  }
  return { planId: catalog.planId, sourceSha256: source.sha256,
    workflow, jobs: workflow.jobs };
}

function savedCatalogValid(catalog: Ledger["catalog"], jobs: Ledger["jobs"], withoutHomarr: boolean): boolean {
  if (!catalog || typeof catalog.planId !== "string" || !/^[0-9a-f]{16}$/.test(catalog.planId)
    || typeof catalog.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(catalog.sourceSha256)
    || catalog.workflow?.mode !== "planning-only" || !Array.isArray(catalog.workflow.jobs)
    || catalog.workflow.jobs.some((job: unknown) => !job || typeof job !== "object" || Array.isArray(job))) {
    return false;
  }
  const expected = expectedCatalogJobs(jobs.map((job) => job.appId), !withoutHomarr);
  if (Object.keys(catalog.workflow).sort().join(",") !== "jobs,mode"
    || catalog.workflow.jobs.length !== expected.length) return false;
  return catalog.workflow.jobs.every((job: Json, index: number) =>
    Object.keys(job).sort().join(",") === "apps,gates,id,needs,owner"
    && JSON.stringify(jobFields(job)) === JSON.stringify(expected[index]));
}

async function savedHomarrBinding(root: string, invoke: AppInvoker, live: boolean): Promise<HomarrBinding> {
  const args = ["status", "--id", "homarr", "--project-root", root];
  if (live) args.push("--live");
  const status = await invokeJson(invoke, [...args, "--json"]);
  if (status.command !== "app status" || status.appId !== "homarr"
    || status.projectRoot !== root || status.status !== "applied"
    || status.homarrSetup?.stage !== "complete" || status.homarrNetwork !== null
    || typeof status.projectId !== "string" || !idPattern.test(status.projectId)
    || status.lastRecordedLifecycle === "stopped"
    || (live && status.runtime?.state !== "running")) {
    fail("batch connection needs the exact applied, onboarded, running standalone Homarr in this project");
  }
  return { projectId: status.projectId, network: `${status.projectId}-private` };
}

async function plan(options: BatchOptions, invoke: AppInvoker,
  resolveWorkflow: WorkflowResolver, selectedApps: Selection[] = options.apps): Promise<BatchPlan> {
  const apps: BatchPlan["apps"] = [];
  const jobs: BatchJob[] = [];
  let dockerContext: string | null = null;
  const catalog = catalogJobs(options, resolveWorkflow);
  const homarr = options.connectHomarr ? await savedHomarrBinding(options.root, invoke, true) : null;
  for (const app of selectedApps) {
    const supplied = options.images.get(app.id);
    const candidate = await invokeJson(invoke, ["plan", ...appArgs(options, app, supplied), "--json"]);
    if (candidate.command !== "app plan" || candidate.status !== "candidate" || candidate.mutation !== false
      || candidate.appId !== app.id || candidate.applyAvailable === false
      || typeof candidate.approval !== "string" || !candidate.approval.startsWith(`APP-APPLY:${app.id}:`)
      || !candidate.compose || typeof candidate.compose !== "object"
      || !candidate.host || typeof candidate.host !== "object") fail(`app ${app.id} has no bounded exact plan`);
    if (!Array.isArray(candidate.servicePurposes) || candidate.servicePurposes.length < 1
      || candidate.servicePurposes.some((service: unknown) => !service || typeof service !== "object"
        || typeof (service as Json).id !== "string" || !idPattern.test((service as Json).id)
        || typeof (service as Json).purpose !== "string"
        || !(service as Json).purpose.trim() || (service as Json).purpose.length > 512
        || /[\u0000-\u001f\u007f]/.test((service as Json).purpose))
      || new Set(candidate.servicePurposes.map((service: Json) => service.id)).size
        !== candidate.servicePurposes.length) {
      fail(`app ${app.id} plan omitted a plain-language service purpose`);
    }
    const images = exactImages(candidate);
    if (supplied && JSON.stringify([...images].sort()) !== JSON.stringify([...supplied].sort())) {
      fail(`app ${app.id} pinned images changed during planning`);
    }
    if (candidate.compose.homarrNetwork !== (homarr?.network ?? null)
      || candidate.host.projectRoot !== options.root) {
      fail("batch app plan crossed the selected project or Homarr connection boundary");
    }
    if (typeof candidate.compose.publishedPort !== "string"
      || !candidate.compose.publishedPort.startsWith(`127.0.0.1:${app.port}:`)) {
      fail(`app ${app.id} did not reserve its exact private port`);
    }
    if (typeof candidate.host.dockerContext !== "string" || !candidate.host.dockerContext) fail("app plan omitted Docker context");
    if (dockerContext && dockerContext !== candidate.host.dockerContext) fail("batch apps do not share one inspected Docker context");
    dockerContext = candidate.host.dockerContext;
    const owns = [`project:${candidate.compose.projectId}`, `port:${app.port}`,
      `directory:${candidate.compose.directory}`, `render:${candidate.compose.directory}`,
      `data:${candidate.compose.dataDirectory}`, `network:${candidate.compose.network}`];
    if (owns.some((value) => typeof value !== "string" || !value)) fail("app plan omitted ownership resources");
    if (jobs.some((job) => job.owns.some((owned) => owns.some((value) => overlaps(owned, value))))) {
      fail("batch app plans share mutable ownership");
    }
    const applyArgs = ["self-host", "app", "apply", ...appArgs(options, app, images),
      "--approve", candidate.approval, "--json"];
    apps.push({ id: app.id, port: app.port, images, approval: candidate.approval,
      plan: candidate, applyArgs });
    const catalogJob = catalog.jobs.find((job) => job.id === `app-${app.id}`)!;
    jobs.push({ id: catalogJob.id, needs: catalogJob.needs, gates: catalogJob.gates,
      owner: catalogJob.owner, apps: catalogJob.apps, owns });
  }
  const binding = { projectRoot: options.root, withoutHomarr: options.withoutHomarr, dockerContext,
    catalogPlanId: catalog.planId, catalogSourceSha256: catalog.sourceSha256,
    catalogWorkflow: catalog.workflow,
    dataParent: options.dataParent, email: options.email, name: options.name,
    apps: apps.map((app) => ({ id: app.id, port: app.port, images: app.images,
      approval: app.approval, projectId: app.plan.compose.projectId,
      dataDirectory: app.plan.compose.dataDirectory, renderDirectory: app.plan.compose.directory })) };
  const approvedBinding = homarr ? { ...binding, homarr } : binding;
  const approval = `BATCH:${createHash("sha256").update(JSON.stringify(approvedBinding)).digest("hex")}`;
  const applyArgs = ["self-host", "app", "batch", "apply", "--project-root", options.root];
  for (const app of selectedApps) applyArgs.push("--app", `${app.id}=${app.port}`);
  if (options.dataParent) applyArgs.push("--data-parent", options.dataParent);
  if (options.email) applyArgs.push("--email", `immich=${options.email}`);
  if (options.name) applyArgs.push("--name", `immich=${options.name}`);
  if (options.connectHomarr) applyArgs.push("--connect-homarr");
  else applyArgs.push("--without-homarr");
  for (const app of apps) {
    for (const image of app.images) applyArgs.push("--image", `${app.id}=${image}`);
  }
  for (const app of apps) applyArgs.push("--app-approve", `${app.id}=${app.approval}`);
  applyArgs.push("--approve", approval, "--json");
  return { schemaVersion: 1, command: "app batch plan", status: "planned", mutation: false,
    projectRoot: options.root, withoutHomarr: options.withoutHomarr,
    homarrNetwork: homarr?.network ?? null, homarrProjectId: homarr?.projectId ?? null,
    completed: homarr ? ["dashboard"] : [], catalogPlanId: catalog.planId,
    catalogSourceSha256: catalog.sourceSha256,
    catalogWorkflow: catalog.workflow, apps, jobs, approval,
    applyArgs, applyCommand: shellCommand(applyArgs), acceptanceVerified: false };
}

function ledgerPath(root: string): string { return join(root, ".selfhost", "app-batch.json"); }

function formatBatchPlan(candidate: BatchPlan): string {
  const lines = [
    `Read-only ${candidate.apps.length}-app batch plan. No resources changed.`,
    `Project root: ${candidate.projectRoot}`,
    candidate.withoutHomarr
      ? "Homarr mode: off; no dashboard or attachments will be installed."
      : `Homarr mode: connected to onboarded project ${candidate.homarrProjectId} on private bridge ${candidate.homarrNetwork}. Dashboard content and attachments need separate verification.`,
    `Catalog plan: ${candidate.catalogPlanId}; bundled source SHA-256: ${candidate.catalogSourceSha256}`,
    `Catalog workflow: ${candidate.catalogWorkflow.mode}`,
    `Completed prerequisite jobs: ${candidate.completed.length ? candidate.completed.join(", ") : "none"}`,
    "Catalog job graph:",
  ];
  for (const job of candidate.catalogWorkflow.jobs as Json[]) {
    lines.push(`  ${job.id}: owner ${job.owner}; apps ${job.apps.join(", ")}; needs ${job.needs.length ? job.needs.join(", ") : "none"}; gates ${job.gates.join(", ")}`);
  }
  for (const app of candidate.apps) {
    const plan = app.plan;
    const job = candidate.jobs.find((entry) => entry.id === `app-${app.id}`)!;
    lines.push("", `${app.id}: recipe SHA-256 ${plan.recipeSha256}`);
    for (const service of plan.servicePurposes as Json[]) {
      lines.push(`  ${service.id}: ${service.purpose}`);
    }
    lines.push(
      `  Docker context: ${plan.host.dockerContext}`,
      `  Compose project: ${plan.compose.projectId}`,
      `  Compose plan: ${plan.compose.planId}`,
      `  Host port/exposure: ${plan.compose.publishedPort} (loopback-only; no public exposure approved)`,
      `  Compose directory: ${plan.compose.directory}`,
      `  Compose target: ${plan.compose.renderTarget}`,
      `  Data directory: ${plan.compose.dataDirectory}`,
      `  Network: ${plan.compose.network}`,
      `  Images (${plan.imageProvenance}):`,
      ...app.images.map((image) => `    ${image}`),
      `  Job: ${job.id}; owner ${job.owner}; needs ${job.needs.length ? job.needs.join(", ") : "none"}; gates ${job.gates.join(", ")}`,
      "  Owns:",
      ...job.owns.map((resource) => `    ${resource}`),
      "  Remaining gates:",
      ...plan.remainingGates.map((gate: string) => `    ${gate}`),
    );
    if (plan.compose.privateFiles) lines.push(`  Private files: ${plan.compose.privateFiles}`);
    if (app.id === "immich") {
      lines.push(`  First administrator: ${plan.onboarding.name} <${plan.onboarding.email}>`);
    }
    lines.push(`  App approval: ${app.approval}`);
  }
  lines.push("", "Independent app jobs can start two at a time.");
  if (!candidate.withoutHomarr) lines.push("Homarr attachment is a separate later stage.");
  lines.push(
    "Acceptance is not verified: each app still needs account, functional, and restart checks; a Homarr tile does not prove an integration, widget, or rendered board.",
    `Batch approval: ${candidate.approval}`,
    `After exact review, apply: ${candidate.applyCommand}`);
  // Keep catalog and user path values from creating fake review lines or terminal controls.
  return lines.map((line) => line.replace(/[\u0000-\u001f\u007f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)).join("\n");
}

async function privateParent(root: string, create: boolean): Promise<void> {
  const path = join(root, ".selfhost");
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { mode: 0o700 });
    const parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await parent.sync(); }
    finally { await parent.close(); }
    info = await lstat(path);
  }
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()
    || (info.mode & 0o777) !== 0o700) fail(".selfhost must be an owner-only real directory (0700)");
}

async function validLedgerLinks(root: string, info: Awaited<ReturnType<typeof lstat>>): Promise<boolean> {
  if (info.nlink === 1) return true;
  if (info.nlink !== 2) return false;
  const parent = join(root, ".selfhost");
  const temporaryPattern = /^\.app-batch-[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
  let matchingLinks = 0;
  for (const name of await readdir(parent)) {
    if (!temporaryPattern.test(name)) continue;
    let temporary;
    try { temporary = await lstat(join(parent, name)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (temporary.isFile() && !temporary.isSymbolicLink()
      && temporary.dev === info.dev && temporary.ino === info.ino
      && temporary.uid === info.uid && (temporary.mode & 0o777) === 0o600) {
      matchingLinks += 1;
    }
  }
  if (matchingLinks === 1) return true;
  const current = await lstat(ledgerPath(root));
  return current.dev === info.dev && current.ino === info.ino && current.nlink === 1;
}

function validPostApply(root: string, ledger: Ledger): boolean {
  const postApply = ledger.postApply;
  if (postApply === undefined) return true;
  if (!postApply || typeof postApply !== "object" || ledger.schemaVersion !== 3
    || postApply.schemaVersion !== 1
    || Object.keys(postApply).sort().join(",") !== "schemaVersion,steps"
    || !Array.isArray(postApply.steps) || postApply.steps.length !== 1) return false;
  const step = postApply.steps[0];
  if (!step || step.schemaVersion !== 1 || step.stage !== "uptime-kuma-credential-prepare"
    || step.jobId !== "app-uptime-kuma" || step.appId !== "uptime-kuma"
    || !["attempted", "prepared-not-login-verified"].includes(step.status)
    || !stepDigestPattern.test(step.approval) || !accountDigestPattern.test(step.accountApproval)
    || step.username !== "admin"
    || step.credentialRef !== join(root, ".selfhost", "credentials", "uptime-kuma.env")
    || !Number.isFinite(Date.parse(step.attemptedAt))
    || (step.status === "prepared-not-login-verified" && !Number.isFinite(Date.parse(step.recordedAt ?? "")))
    || (step.status === "attempted" && step.recordedAt !== undefined)
    || !ledger.jobs.some((job) => job.id === step.jobId && job.status === "applied")) return false;
  const keys = step.status === "attempted"
    ? "accountApproval,appId,approval,attemptedAt,credentialRef,jobId,schemaVersion,stage,status,username"
    : "accountApproval,appId,approval,attemptedAt,credentialRef,jobId,recordedAt,schemaVersion,stage,status,username";
  return Object.keys(step).sort().join(",") === keys;
}

async function readLedger(root: string): Promise<Ledger> {
  await privateParent(root, false);
  const path = ledgerPath(root);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || !await validLedgerLinks(root, info)
    || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || info.size > 256 * 1024) {
    fail("batch ledger must be an owner-only regular file (0600)");
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch { fail("batch ledger is unreadable; inspect it before continuing"); }
  const ledger = value as Ledger;
  if (!ledger || ![1, 2, 3].includes(ledger.schemaVersion) || ledger.projectRoot !== root
    || typeof ledger.withoutHomarr !== "boolean"
    || (ledger.schemaVersion === 1 && ledger.catalog !== undefined)
    || (ledger.schemaVersion < 3 && ledger.inputs !== undefined)
    || (ledger.schemaVersion === 3 && (!ledger.inputs
      || (ledger.inputs.dataParent !== null && (typeof ledger.inputs.dataParent !== "string"
        || !isAbsolute(ledger.inputs.dataParent) || resolve(ledger.inputs.dataParent) !== ledger.inputs.dataParent))
      || (ledger.inputs.email !== null && (typeof ledger.inputs.email !== "string" || ledger.inputs.email.length > 320))
      || (ledger.inputs.name !== null && (typeof ledger.inputs.name !== "string" || ledger.inputs.name.length > 160))
      || typeof ledger.inputs.dockerContext !== "string" || !ledger.inputs.dockerContext
      || ledger.inputs.dockerContext.length > 128))
    || (ledger.withoutHomarr && ledger.homarr !== undefined)
    || (!ledger.withoutHomarr && (!ledger.homarr || !idPattern.test(ledger.homarr.projectId)
      || ledger.homarr.network !== `${ledger.homarr.projectId}-private`))
    || !digestPattern.test(ledger.approval) || !Array.isArray(ledger.jobs)
    || ledger.jobs.length < 2 || ledger.jobs.length > 8
    || ledger.jobs.some((job) => !idPattern.test(job.appId) || job.id !== `app-${job.appId}`
      || typeof job.projectId !== "string" || !idPattern.test(job.projectId)
      || !Number.isInteger(job.port) || job.port < 1024 || job.port > 65535
      || !Array.isArray(job.images) || job.images.length < 1
      || job.images.some((image) => typeof image !== "string" || !image.includes("@sha256:"))
      || typeof job.approval !== "string" || !job.approval.startsWith(`APP-APPLY:${job.appId}:`)
      || (ledger.schemaVersion === 3 && (!job.recipeSha256 || !/^[0-9a-f]{64}$/.test(job.recipeSha256)
        || !job.composePlanId || !/^[0-9a-f]{16}$/.test(job.composePlanId)
        || !Array.isArray(job.owns) || job.owns.length !== 6
        || job.owns.some((resource) => typeof resource !== "string" || !resource || resource.length > 4096)))
      || !["pending", "launch-attempted", "applied", "inspect-checkpoint", "blocked"].includes(job.status)
      || (job.failureCode !== undefined && (!/^[a-z0-9-]{1,64}$/.test(job.failureCode)
        || !["inspect-checkpoint", "blocked"].includes(job.status))))
    || new Set(ledger.jobs.map((job) => job.id)).size !== ledger.jobs.length
    || new Set(ledger.jobs.map((job) => job.port)).size !== ledger.jobs.length
    || (ledger.schemaVersion >= 2 && !savedCatalogValid(ledger.catalog, ledger.jobs, ledger.withoutHomarr))
    || !validPostApply(root, ledger)) {
    fail("batch ledger is invalid; inspect it before continuing");
  }
  return ledger;
}

async function writeLedger(root: string, ledger: Ledger, first: boolean): Promise<void> {
  const path = ledgerPath(root);
  const temporary = join(root, ".selfhost", `.app-batch-${process.pid}-${randomUUID()}.json`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    if (first) await link(temporary, path);
    else await rename(temporary, path);
  } finally {
    try { await unlink(temporary); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const directory = await open(join(root, ".selfhost"),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); }
  finally { await directory.close(); }
}

async function runChild(args: string[], appId: string, projectId: string,
  homarrNetwork: string | null): Promise<{ ok: boolean; failureCode: string | null }> {
  let argv = [process.argv[1], "app", ...args];
  let env = process.env;
  if (typeof Bun !== "undefined" && Bun.isStandaloneExecutable) {
    argv = ["app", ...args];
    env = { ...process.env };
    delete env.BUN_BE_BUN;
  }
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, argv, {
      stdio: ["ignore", "pipe", "ignore"], env, windowsHide: true, shell: false,
    });
    let bytes = 0;
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes <= 1024 * 1024) output += chunk;
      else child.kill();
    });
    child.on("error", () => resolve({ ok: false, failureCode: "child-spawn-failed" }));
    child.on("close", (code) => {
      if (bytes > 1024 * 1024) {
        resolve({ ok: false, failureCode: "child-output-too-large" });
        return;
      }
      try {
        const value = JSON.parse(output) as Json;
        const ok = code === 0 && value.command === "app apply" && value.appId === appId && value.projectId === projectId
          && value.homarrNetwork === homarrNetwork
          && value.status === "applied-unverified"
          && value.mutation === true && value.acceptanceVerified === false;
        if (ok) {
          resolve({ ok: true, failureCode: null });
          return;
        }
        let failureCode = "child-result-mismatch";
        if (value.command === "app apply" && value.status === "failed"
          && typeof value.error?.code === "string" && /^[a-z0-9-]{1,64}$/.test(value.error.code)
          && value.error.code !== "unexpected") {
          failureCode = value.error.code;
        }
        resolve({ ok: false, failureCode });
      } catch {
        let failureCode = "child-exit-failed";
        if (code === 0) failureCode = "child-invalid-response";
        resolve({ ok: false, failureCode });
      }
    });
  });
}

type ResumeCandidate = { ledger: Ledger; app: BatchPlan["apps"][number]; job: BatchJob;
  approval: string; result: Json };

async function planPendingResume(options: BatchOptions, invoke: AppInvoker,
  resolveWorkflow: WorkflowResolver): Promise<ResumeCandidate> {
  const ledger = await readLedger(options.root);
  if (ledger.schemaVersion !== 3 || !ledger.inputs || !ledger.catalog) {
    fail("this older batch ledger lacks exact replay inputs; use separately approved per-app recovery", "resume-legacy-ledger");
  }
  const selected = ledger.jobs.find((job) => job.appId === options.jobId);
  if (!selected) fail("the selected app is not owned by this batch", "resume-job-missing");
  if (selected.status !== "pending") {
    fail("only a never-dispatched pending batch job can use batch resume; inspect this app and use its separate recovery approval", "resume-job-not-pending");
  }
  const savedOptions: BatchOptions = { ...options, action: "apply",
    apps: ledger.jobs.map((job) => ({ id: job.appId, port: job.port })),
    images: new Map(ledger.jobs.map((job) => [job.appId, job.images])),
    approvals: new Map(ledger.jobs.map((job) => [job.appId, job.approval])),
    approval: ledger.approval, dataParent: ledger.inputs.dataParent,
    email: ledger.inputs.email, name: ledger.inputs.name,
    withoutHomarr: ledger.withoutHomarr, connectHomarr: !ledger.withoutHomarr };
  const candidate = await plan(savedOptions, invoke, resolveWorkflow,
    [{ id: selected.appId, port: selected.port }]);
  if (candidate.catalogPlanId !== ledger.catalog.planId
    || candidate.catalogSourceSha256 !== ledger.catalog.sourceSha256
    || JSON.stringify(candidate.catalogWorkflow.jobs.map(jobFields))
      !== JSON.stringify(ledger.catalog.workflow.jobs)
    || candidate.homarrProjectId !== (ledger.homarr?.projectId ?? null)
    || candidate.homarrNetwork !== (ledger.homarr?.network ?? null)) {
    fail("current catalog graph or Homarr prerequisite differs from the approved batch; stop for review", "resume-source-drift");
  }
  const app = candidate.apps[0];
  const job = candidate.jobs[0];
  if (!app || !job || app.id !== selected.appId || app.port !== selected.port
    || app.approval !== selected.approval
    || app.plan.recipeSha256 !== selected.recipeSha256
    || app.plan.compose.projectId !== selected.projectId
    || app.plan.host.dockerContext !== ledger.inputs.dockerContext
    || JSON.stringify(app.images) !== JSON.stringify(selected.images)
    || JSON.stringify(job.owns) !== JSON.stringify(selected.owns)) {
    fail("fresh pending app plan differs from its saved exact approval or owned resources", "resume-plan-drift");
  }
  const binding = { schemaVersion: 1, operation: "resume-one-pending-job",
    ledgerSha256: createHash("sha256").update(JSON.stringify(ledger)).digest("hex"),
    catalogPlanId: candidate.catalogPlanId, catalogSourceSha256: candidate.catalogSourceSha256,
    homarrProjectId: candidate.homarrProjectId, homarrNetwork: candidate.homarrNetwork,
    job: { id: job.id, appId: app.id, approval: app.approval,
      recipeSha256: app.plan.recipeSha256, approvedComposePlanId: selected.composePlanId,
      projectId: app.plan.compose.projectId, dockerContext: app.plan.host.dockerContext,
      images: app.images, owns: job.owns } };
  const approval = `BATCH-RESUME:${createHash("sha256").update(JSON.stringify(binding)).digest("hex")}`;
  const applyArgs = ["self-host", "app", "batch", "resume", "--project-root", options.root,
    "--job", selected.appId, "--approve", approval, "--json"];
  const result = { schemaVersion: 1, command: "app batch resume-plan", status: "planned",
    mutation: false, projectRoot: options.root, selectedJob: selected.id,
    originalBatchApproval: ledger.approval, catalogPlanId: candidate.catalogPlanId,
    catalogSourceSha256: candidate.catalogSourceSha256,
    catalogWorkflow: candidate.catalogWorkflow, homarrProjectId: candidate.homarrProjectId,
    homarrNetwork: candidate.homarrNetwork, savedJobs: ledger.jobs,
    pendingAppPlan: app.plan, pendingJob: job,
    approval, applyArgs, applyCommand: shellCommand(applyArgs), acceptanceVerified: false,
    next: "Only this pending job can be dispatched. Historical attempted, blocked, and recovered jobs remain untouched; account, function, restart, and Homarr board acceptance stay separate." };
  return { ledger, app, job, approval, result };
}

async function resumePending(options: BatchOptions, invoke: AppInvoker,
  resolveWorkflow: WorkflowResolver): Promise<Json> {
  return underBatchLock(options.root, async () => {
    const candidate = await planPendingResume(options, invoke, resolveWorkflow);
    if (candidate.approval !== options.approval) {
      fail("batch resume approval differs from the fresh pending job and saved ledger", "resume-approval-mismatch");
    }
    const ledger = candidate.ledger;
    let childFailureCode: string | null = null;
    const persist = async (id: string, status: Ledger["jobs"][number]["status"]) => {
      const updated = { ...ledger, jobs: ledger.jobs.map((job) => {
        if (job.id !== id) return job;
        const failureCode = status === "inspect-checkpoint"
          ? childFailureCode ?? "child-failure-unclassified" : undefined;
        return { ...job, status, failureCode };
      }) };
      await writeLedger(options.root, updated, false);
      ledger.jobs = updated.jobs;
    };
    try {
      const outcomes = await runApprovedDag([{ ...candidate.job,
        run: async () => {
          const result = await runChild(candidate.app.applyArgs.slice(2), candidate.app.id,
            candidate.app.plan.compose.projectId, ledger.homarr?.network ?? null);
          childFailureCode = result.failureCode;
          return result.ok;
        } }], new Set(ledger.homarr ? ["dashboard"] : []), 1, persist);
      const outcome = outcomes[0];
      const result = { schemaVersion: 1, command: "app batch resume",
        status: outcome.status === "applied" ? "job-applied-unverified" : "job-needs-inspection",
        mutation: true, projectRoot: options.root, selectedJob: outcome.id,
        originalBatchApproval: ledger.approval, ledgerPath: ledgerPath(options.root),
        outcome: { ...outcome, failureCode: ledger.jobs.find((job) => job.id === outcome.id)?.failureCode ?? null },
        jobs: ledger.jobs, acceptanceVerified: false,
        next: "Inspect the exact app status and other saved batch jobs. Account, function, restart, and Homarr board checks remain separate; attempted jobs are never automatically replayed." };
      return result;
    } catch {
      fail("batch resume stopped after its checkpoint may have changed; inspect the selected app before recovery",
        "resume-inspect-required", true);
    }
  });
}

function formatResumePlan(candidate: ResumeCandidate): string {
  const { result } = candidate;
  const lines = [
    `Read-only resume plan for ${candidate.job.id}. No resources changed.`,
    `Project root: ${result.projectRoot}`,
    `Original batch approval: ${result.originalBatchApproval}`,
    `Catalog plan: ${result.catalogPlanId}; source SHA-256: ${result.catalogSourceSha256}`,
    result.homarrProjectId
      ? `Homarr attachment: project ${result.homarrProjectId} on private bridge ${result.homarrNetwork}; board content still needs separate verification.`
      : "Homarr attachment: off; this job will not be attached to a dashboard.",
    `Job owner: ${candidate.job.owner}; needs ${candidate.job.needs.length ? candidate.job.needs.join(", ") : "none"}; gates ${candidate.job.gates.join(", ")}`,
    `App approval: ${candidate.app.approval}`,
    `Compose project: ${candidate.app.plan.compose.projectId}; plan ${candidate.app.plan.compose.planId}`,
    `Private port: ${candidate.app.plan.compose.publishedPort}`,
    `Data directory: ${candidate.app.plan.compose.dataDirectory}`,
    `Docker context: ${candidate.app.plan.host.dockerContext}`,
  ];
  if (candidate.app.plan.onboarding) {
    const onboarding = candidate.app.plan.onboarding;
    lines.push(`First administrator: ${onboarding.username ?? "not set"}; name ${onboarding.name ?? "not set"}; email ${onboarding.email ?? "not set"}; private credential file ${onboarding.passwordFile ?? "not prepared"}`);
  }
  lines.push(
    "Services:",
    ...candidate.app.plan.servicePurposes.map((service: Json) => `  ${service.id}: ${service.purpose}`),
    "Pinned images:",
    ...candidate.app.images.map((image) => `  ${image}`),
    "Owned resources:",
    ...candidate.job.owns.map((resource) => `  ${resource}`),
    "Remaining app gates:",
    ...candidate.app.plan.remainingGates.map((gate: string) => `  ${gate}`),
    `Other jobs retain their saved status: ${candidate.ledger.jobs.filter((job) => job.id !== candidate.job.id)
      .map((job) => `${job.id}=${job.status}`).join(", ")}.`,
    "This only dispatches a never-launched job. Account, functional, restart, and Homarr board acceptance remain separate.",
    `Resume approval: ${result.approval}`,
    `After exact review, run: ${result.applyCommand}`,
  );
  return lines.map((line) => line.replace(/[\u0000-\u001f\u007f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)).join("\n");
}

type StepCandidate = { ledger: Ledger; checkpoint: StepCheckpoint; result: Json };

function exactUptimeStatus(status: Json, root: string, job: Ledger["jobs"][number],
  homarrNetwork: string | null, credentialsPrepared: boolean): boolean {
  let imagesMatch = false;
  try { imagesMatch = JSON.stringify(exactImages(status)) === JSON.stringify(job.images); }
  catch { return false; }
  if (status.command !== "app status" || status.appId !== "uptime-kuma"
    || status.projectRoot !== root || status.status !== "applied"
    || status.projectId !== job.projectId || status.port !== job.port
    || !imagesMatch || status.applyApproval !== job.approval
    || status.homarrNetwork !== homarrNetwork
    || status.url !== `http://127.0.0.1:${job.port}`
    || typeof status.composeTarget !== "string"
    || dirname(status.composeTarget) !== join(root, ".selfhost", "apps", job.projectId)
    || !/^compose\.[0-9a-f]{16}\.yaml$/.test(basename(status.composeTarget))
    || !job.owns?.includes(`render:${dirname(status.composeTarget)}`)
    || !job.owns?.includes(`data:${status.dataDirectory}`)
    || !job.owns?.includes(`network:${job.projectId}-private`)
    || status.lastRecordedLifecycle === "stopped"
    || status.runtime?.state !== "running"
    || typeof status.runtime.checkedAt !== "string"
    || !Number.isFinite(Date.parse(status.runtime.checkedAt))) return false;
  if (credentialsPrepared) {
    return status.credentialRef === join(root, ".selfhost", "credentials", "uptime-kuma.env")
      && status.accountUsername === "admin" && status.uptimeOnboardingStage === null;
  }
  return status.credentialRef === null && status.accountUsername === null
    && status.uptimeOnboardingStage === null;
}

async function planStep(options: BatchOptions, invoke: AppInvoker,
  resolveWorkflow: WorkflowResolver): Promise<StepCandidate> {
  const ledger = await readLedger(options.root);
  const selected = ledger.jobs.find((job) => job.appId === options.jobId);
  if (!selected) fail("the selected app is not owned by this batch", "step-job-missing");
  if (selected.appId !== "uptime-kuma") {
    fail("this post-apply batch stage supports only Uptime Kuma credential preparation", "step-unsupported-stage");
  }
  if (ledger.schemaVersion !== 3 || !ledger.catalog || !selected.recipeSha256 || !selected.composePlanId) {
    fail("this batch ledger lacks the exact post-apply job binding", "step-legacy-ledger");
  }
  if (selected.status !== "applied") {
    fail("the selected batch job is not recorded applied; inspect or recover its exact app first", "step-job-not-applied");
  }
  if (ledger.postApply?.steps.length) {
    fail("the Uptime Kuma batch step has a saved checkpoint; inspect status rather than replay preparation", "step-checkpoint-exists");
  }
  const savedOptions: BatchOptions = { ...options,
    apps: ledger.jobs.map((job) => ({ id: job.appId, port: job.port })),
    withoutHomarr: ledger.withoutHomarr, connectHomarr: !ledger.withoutHomarr };
  const catalog = catalogJobs(savedOptions, resolveWorkflow);
  if (catalog.planId !== ledger.catalog.planId
    || catalog.sourceSha256 !== ledger.catalog.sourceSha256
    || JSON.stringify(catalog.workflow.jobs.map(jobFields))
      !== JSON.stringify(ledger.catalog.workflow.jobs)) {
    fail("current catalog graph differs from the approved batch; stop for review", "step-source-drift");
  }
  if (ledger.homarr) {
    const liveHomarr = await savedHomarrBinding(options.root, invoke, true);
    if (liveHomarr.projectId !== ledger.homarr.projectId
      || liveHomarr.network !== ledger.homarr.network) {
      fail("live Homarr prerequisite differs from the approved batch bridge", "step-homarr-drift");
    }
  }
  const status = await invokeJson(invoke, ["status", "--id", "uptime-kuma",
    "--project-root", options.root, "--live", "--json"]);
  const bridge = ledger.homarr?.network ?? null;
  if (!exactUptimeStatus(status, options.root, selected, bridge, false)) {
    fail("fresh Uptime Kuma status differs from the approved, running batch job or already has account state", "step-app-drift");
  }
  const accountPlan = await invokeJson(invoke, ["account-plan", "--id", "uptime-kuma",
    "--project-root", options.root, "--username", "admin", "--json"]);
  const credentialRef = join(options.root, ".selfhost", "credentials", "uptime-kuma.env");
  if (accountPlan.command !== "app account-plan" || accountPlan.appId !== "uptime-kuma"
    || accountPlan.status !== "ready-for-review" || accountPlan.mutation !== false
    || accountPlan.username !== "admin" || accountPlan.source !== "generate"
    || accountPlan.credentialFile !== credentialRef
    || !accountDigestPattern.test(accountPlan.approval)
    || accountPlan.accountVerified !== false) {
    fail("Uptime Kuma returned no exact new admin credential plan", "step-account-plan-drift");
  }
  const ledgerSha256 = createHash("sha256").update(JSON.stringify(ledger)).digest("hex");
  const liveAppStatus = { status: status.status, projectId: status.projectId,
    port: status.port, image: status.image, applyApproval: status.applyApproval,
    homarrNetwork: status.homarrNetwork, runtimeState: status.runtime.state,
    runtimeHealth: status.runtime.health, inspectedAt: status.runtime.checkedAt };
  const binding = { schemaVersion: 1, operation: "uptime-kuma-credential-prepare",
    ledgerSha256, originalBatchApproval: ledger.approval,
    catalogPlanId: ledger.catalog.planId, catalogSourceSha256: ledger.catalog.sourceSha256,
    homarrProjectId: ledger.homarr?.projectId ?? null, homarrNetwork: bridge,
    job: { id: selected.id, appId: selected.appId, approval: selected.approval,
      recipeSha256: selected.recipeSha256, composePlanId: selected.composePlanId,
      projectId: selected.projectId, port: selected.port, images: selected.images,
      owns: selected.owns },
    liveAppStatus: { status: liveAppStatus.status, projectId: liveAppStatus.projectId,
      port: liveAppStatus.port, image: liveAppStatus.image,
      applyApproval: liveAppStatus.applyApproval,
      homarrNetwork: liveAppStatus.homarrNetwork,
      runtimeState: liveAppStatus.runtimeState, runtimeHealth: liveAppStatus.runtimeHealth },
    accountPlan: { approval: accountPlan.approval, username: accountPlan.username,
      credentialFile: accountPlan.credentialFile, source: accountPlan.source } };
  const approval = `BATCH-STEP:${createHash("sha256").update(JSON.stringify(binding)).digest("hex")}`;
  const applyArgs = ["self-host", "app", "batch", "step", "--project-root", options.root,
    "--job", "uptime-kuma", "--approve", approval, "--json"];
  const checkpoint: StepCheckpoint = { schemaVersion: 1, stage: "uptime-kuma-credential-prepare",
    jobId: "app-uptime-kuma", appId: "uptime-kuma", status: "attempted",
    approval, accountApproval: accountPlan.approval, username: "admin",
    credentialRef, attemptedAt: "" };
  const result = { schemaVersion: 1, command: "app batch step-plan", status: "planned",
    mutation: false, projectRoot: options.root, selectedJob: selected.id,
    stage: checkpoint.stage, ledgerSha256, originalBatchApproval: ledger.approval,
    job: selected, homarrProjectId: ledger.homarr?.projectId ?? null,
    homarrNetwork: bridge, liveAppStatus, accountPlan,
    approval, applyArgs, applyCommand: shellCommand(applyArgs), acceptanceVerified: false,
    next: "This only prepares an owner-only Uptime Kuma admin password. Login, a monitor, restart persistence, and any Homarr attachment remain separate checks." };
  return { ledger, checkpoint, result };
}

async function executeStep(options: BatchOptions, invoke: AppInvoker,
  resolveWorkflow: WorkflowResolver): Promise<Json> {
  return underBatchLock(options.root, async () => {
    const candidate = await planStep(options, invoke, resolveWorkflow);
    if (candidate.result.approval !== options.approval) {
      fail("batch step approval differs from the fresh live app, account plan, or saved ledger", "step-approval-mismatch");
    }
    const attempted: StepCheckpoint = { ...candidate.checkpoint, attemptedAt: new Date().toISOString() };
    const ledger = { ...candidate.ledger,
      postApply: { schemaVersion: 1 as const, steps: [attempted] } };
    await writeLedger(options.root, ledger, false);
    try {
      const persisted = await readLedger(options.root);
      if (JSON.stringify(persisted.postApply?.steps[0]) !== JSON.stringify(attempted)) {
        fail("batch step attempt checkpoint could not be read back", "step-checkpoint-drift", true);
      }
      const prepared = await invokeJson(invoke, ["account-prepare", "--id", "uptime-kuma",
        "--project-root", options.root, "--username", "admin", "--approve",
        attempted.accountApproval, "--json"]);
      if (prepared.command !== "app account-prepare" || prepared.appId !== "uptime-kuma"
        || prepared.status !== "prepared-not-account-verified" || prepared.mutation !== true
        || prepared.credentialFile !== attempted.credentialRef || prepared.username !== "admin"
        || prepared.source !== "generated" || prepared.accountVerified !== false) {
        fail("Uptime Kuma credential preparation returned an unexpected result", "step-prepare-result-drift", true);
      }
      const status = await invokeJson(invoke, ["status", "--id", "uptime-kuma",
        "--project-root", options.root, "--live", "--json"]);
      const selected = ledger.jobs.find((job) => job.id === attempted.jobId)!;
      if (!exactUptimeStatus(status, options.root, selected, ledger.homarr?.network ?? null, true)
        || status.credentialRef !== prepared.credentialFile) {
        fail("prepared Uptime Kuma credential could not be read back from exact live app status", "step-readback-drift", true);
      }
      const completed: StepCheckpoint = { ...attempted, status: "prepared-not-login-verified",
        recordedAt: new Date().toISOString() };
      ledger.postApply.steps = [completed];
      await writeLedger(options.root, ledger, false);
      return { schemaVersion: 1, command: "app batch step",
        status: "prepared-not-login-verified", mutation: true, projectRoot: options.root,
        selectedJob: selected.id, stage: completed.stage, ledgerPath: ledgerPath(options.root),
        credentialRef: completed.credentialRef, accountUsername: completed.username,
        stepCheckpoint: completed, acceptanceVerified: false,
        next: "Use the separately approved Uptime Kuma onboard flow to create or verify login. Monitor, restart persistence, and any Homarr attachment remain unverified." };
    } catch {
      fail("batch step stopped after its attempt checkpoint; inspect the ledger and exact app status before any recovery",
        "step-inspect-required", true);
    }
  });
}

export async function appBatchCommand(args: string[], invoke: AppInvoker,
  resolveWorkflow: WorkflowResolver): Promise<void> {
  const options = parse(args);
  if (!options) {
    console.log("app batch plan --project-root ABS --app ID=PORT --app ID=PORT (--connect-homarr|--without-homarr) [--image ID=PINNED_SPEC repeated for every service of every app] [--data-parent ABS] [--email immich=EMAIL --name immich=NAME] [--json]\napp batch apply (same selection) --image ID=PINNED_SPEC [repeat] --app-approve ID=TOKEN [repeat] --approve BATCH:DIGEST (--connect-homarr|--without-homarr) [--json]\napp batch status|info --project-root ABS [--without-homarr|--connect-homarr] [--json]\napp batch resume-plan --project-root ABS --job APP_ID [--json]\napp batch resume --project-root ABS --job APP_ID --approve BATCH-RESUME:DIGEST [--json]\napp batch step-plan --project-root ABS --job uptime-kuma [--json]\napp batch step --project-root ABS --job uptime-kuma --approve BATCH-STEP:DIGEST [--json]\nWithout --image, plan resolves registry digests. Reviewed pins can bypass unavailable registry lookups but are not revalidated there. Connected mode needs a separately approved and onboarded standalone Homarr first. Apply records an owner-only checkpoint before launching independent apps. Resume dispatches only one proven never-launched pending job; attempted jobs need separate per-app recovery. The Uptime Kuma step only prepares a credential; login and acceptance remain separate.");
    return;
  }
  await checkedRoot(options.root);
  if (options.action === "step-plan" || options.action === "step") {
    if (options.action === "step-plan") {
      const candidate = await planStep(options, invoke, resolveWorkflow);
      if (options.json) {
        console.log(JSON.stringify(candidate.result, null, 2));
        return;
      }
      const lines = [`Read-only credential step plan for ${candidate.result.selectedJob}. No resources changed.`,
        `Project root: ${candidate.result.projectRoot}`,
        `Original batch approval: ${candidate.result.originalBatchApproval}`,
        `Ledger SHA-256: ${candidate.result.ledgerSha256}`,
        `App: Uptime Kuma on private port ${candidate.result.job.port}; recipe SHA-256 ${candidate.result.job.recipeSha256}.`,
        `Live app: ${candidate.result.liveAppStatus.runtimeState}; Homarr bridge: ${candidate.result.homarrNetwork ?? "off"}.`,
        `Administrator: ${candidate.result.accountPlan.username}; owner-only file: ${candidate.result.accountPlan.credentialFile}.`,
        `Account approval: ${candidate.result.accountPlan.approval}`,
        "This only prepares credentials; it does not create or verify an application login.",
        `Batch step approval: ${candidate.result.approval}`,
        `After exact review, run: ${candidate.result.applyCommand}`];
      console.log(lines.map((line) => line.replace(/[\u0000-\u001f\u007f]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)).join("\n"));
      return;
    }
    await privateParent(options.root, false);
    const result = await executeStep(options, invoke, resolveWorkflow);
    console.log(options.json ? JSON.stringify(result, null, 2)
      : `${result.status}; owner-only credential: ${result.credentialRef}. Login and acceptance remain separate. Ledger: ${result.ledgerPath}`);
    return;
  }
  if (options.action === "resume-plan" || options.action === "resume") {
    if (options.action === "resume-plan") {
      const candidate = await planPendingResume(options, invoke, resolveWorkflow);
      console.log(options.json ? JSON.stringify(candidate.result, null, 2) : formatResumePlan(candidate));
      return;
    }
    if (!(typeof Bun !== "undefined" && Bun.isStandaloneExecutable)
      && (typeof process.argv[1] !== "string" || !isAbsolute(process.argv[1]))) {
      fail("batch resume needs the exact CLI entry point for its isolated app job");
    }
    await privateParent(options.root, false);
    const result = await resumePending(options, invoke, resolveWorkflow);
    console.log(options.json ? JSON.stringify(result, null, 2)
      : `${result.status}; ${result.selectedJob} was attempted. Inspect ${result.ledgerPath} and the exact app status before further recovery.`);
    return;
  }
  if (options.action === "status" || options.action === "info") {
    const ledger = await readLedger(options.root);
    if ((options.withoutHomarr && !ledger.withoutHomarr)
      || (options.connectHomarr && ledger.withoutHomarr)) {
      fail("requested Homarr mode differs from the saved batch ledger");
    }
    let homarrStatus: Json | null = null;
    let homarrNeedsInspection = false;
    if (!ledger.withoutHomarr) {
      try {
        homarrStatus = await invokeJson(invoke, ["status", "--id", "homarr", "--project-root",
          options.root, "--live", "--json"]);
      } catch { /* A failed live check leaves the saved Homarr prerequisite unverified. */ }
      homarrNeedsInspection = !homarrStatus || homarrStatus.command !== "app status"
        || homarrStatus.appId !== "homarr" || homarrStatus.projectRoot !== options.root
        || homarrStatus.status !== "applied" || homarrStatus.homarrSetup?.stage !== "complete"
        || homarrStatus.projectId !== ledger.homarr?.projectId
        || homarrStatus.homarrNetwork !== null
        || homarrStatus.runtime?.state !== "running"
        || homarrStatus.lastRecordedLifecycle === "stopped";
    }
    const apps = [];
    for (const job of ledger.jobs) {
      let status: Json | null = null;
      const statusArgs = ["status", "--id", job.appId, "--project-root", options.root];
      try { status = await invokeJson(invoke, [...statusArgs, "--live", "--json"]); }
      catch {
        // Keep saved service details available even when Docker cannot be inspected.
        try { status = await invokeJson(invoke, [...statusArgs, "--json"]); }
        catch { /* The saved app record also needs inspection. */ }
      }
      let imagesMatch = false;
      if (status) {
        try { imagesMatch = JSON.stringify(exactImages(status)) === JSON.stringify(job.images); }
        catch { /* Missing or invalid saved image needs inspection. */ }
      }
      const applied = status?.command === "app status" && status.appId === job.appId
        && status.projectRoot === options.root && status.status === "applied"
        && status.port === job.port && status.projectId === job.projectId && imagesMatch
        && status.applyApproval === job.approval
        && status.homarrNetwork === (ledger.homarr?.network ?? null);
      const running = applied && status.runtime?.state === "running"
        && status.lastRecordedLifecycle !== "stopped";
      const recoveredFromExactState = job.status !== "applied" && running;
      const stepCheckpoint = ledger.postApply?.steps.find((step) => step.jobId === job.id) ?? null;
      const stepStateMismatch = stepCheckpoint?.status === "attempted"
        || (stepCheckpoint?.status === "prepared-not-login-verified"
          && (status?.credentialRef !== stepCheckpoint.credentialRef
            || status?.accountUsername !== stepCheckpoint.username));
      const needsInspection = !running || stepStateMismatch;
      apps.push({ id: job.id, appId: job.appId, jobStatus: job.status,
        failureCode: job.failureCode ?? null,
        appStatus: status, liveState: status?.runtime?.state ?? "not-checked",
        recoveredFromExactState, needsInspection, stepCheckpoint });
    }
    const savedIds = await savedAppIds(options.root);
    const batchIds = new Set(ledger.jobs.map((job) => job.appId));
    if (ledger.homarr) batchIds.add("homarr");
    const additionalAppIds = savedIds.filter((id) => !batchIds.has(id));
    const stepNeedsInspection = ledger.postApply?.steps.some((step) => {
      if (step.status === "attempted") return true;
      const app = apps.find((entry) => entry.id === step.jobId);
      return app?.appStatus?.credentialRef !== step.credentialRef
        || app?.appStatus?.accountUsername !== step.username;
    }) ?? false;
    const needsInspection = homarrNeedsInspection || apps.some((app) => app.needsInspection) || stepNeedsInspection;
    const recoveredJobs = apps.filter((app) => app.recoveredFromExactState).map((app) => app.id);
    const pendingAppIds = ledger.schemaVersion === 3
      ? ledger.jobs.filter((job) => job.status === "pending").map((job) => job.appId) : [];
    let next = "Exact running app resources match the saved approvals. Finish account, functional, restart, and selected Homarr board checks before calling the stack accepted.";
    if (recoveredJobs.length) {
      next = "Exact running app states match the original batch approvals despite incomplete batch history. The ledger keeps its historical job outcomes; finish account, functional, Homarr, and restart checks. Never replay this batch apply.";
    }
    if (needsInspection) {
      next = "Inspect Homarr when selected and each exact app status. Stopped or uninspectable apps, pending, launch-attempted, inspect-checkpoint, and blocked jobs are never auto-replayed; recovery needs a separately reviewed app plan or resume approval.";
    }
    if (stepNeedsInspection) {
      next = "Uptime Kuma credential preparation has an attempted or mismatched checkpoint. Inspect its exact app status and owner-only credential reference; never replay this batch step blindly.";
    }
    if (pendingAppIds.length) {
      next += ` One saved pending job can be freshly reviewed with app batch resume-plan --job ${pendingAppIds[0]} at this exact project root; an attempted job cannot use that route.`;
    }
    const result = { schemaVersion: 1, command: `app batch ${options.action}`,
      status: needsInspection ? "needs-inspection" : recoveredJobs.length ? "recovered-unverified" : "recorded",
      mutation: false, projectRoot: options.root, approval: ledger.approval,
      ledgerSchemaVersion: ledger.schemaVersion, pendingAppIds,
      withoutHomarr: ledger.withoutHomarr,
      catalogPlanId: ledger.catalog?.planId ?? null,
      catalogSourceSha256: ledger.catalog?.sourceSha256 ?? null,
      catalogWorkflow: ledger.catalog?.workflow ?? null,
      catalogEvidence: ledger.catalog ? "saved-approved-graph" : "legacy-ledger-unrecorded",
      homarrNetwork: ledger.homarr?.network ?? null,
      homarrProjectId: ledger.homarr?.projectId ?? null,
      homarrStatus, homarrNeedsInspection,
      ledgerPath: ledgerPath(options.root), jobs: ledger.jobs, apps, recoveredJobs, needsInspection,
      postApplySteps: ledger.postApply?.steps ?? [], stepNeedsInspection,
      additionalAppIds,
      acceptanceVerified: false,
      next };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`${ledger.jobs.length} batch jobs ${result.status}; app acceptance is separate. Ledger: ${result.ledgerPath}`);
    if (ledger.catalog) {
      console.log(`Approved catalog plan: ${ledger.catalog.planId} (saved graph; current catalog not rechecked).`);
    } else {
      console.log("Approved catalog graph was not recorded by this older batch ledger.");
    }
    if (ledger.homarr) {
      console.log(`Homarr: ${ledger.homarr.projectId}; ${homarrNeedsInspection ? "inspect its live board" : "saved onboarding and running container checked; board content remains separate"}.`);
    }
    for (const app of apps) {
      const saved = app.appStatus;
      const graphJob = ledger.catalog?.workflow.jobs.find((job: Json) => job.id === app.id);
      let reason = "";
      if (app.failureCode) reason = `; safe failure code: ${app.failureCode}`;
      let observation = `exact running app inspected (health ${app.appStatus?.runtime?.health ?? "not-checked"})`;
      if (app.needsInspection) observation = `inspect checkpoint (live state ${app.liveState})`;
      else if (app.recoveredFromExactState) observation = "exact running app reconciled from saved state; historical batch outcome retained";
      console.log(`${app.appId}: ${app.jobStatus}${reason}; ${saved?.url ?? "no saved URL"}; ${observation}.`);
      if (app.stepCheckpoint) {
        console.log(`  Post-apply ${app.stepCheckpoint.stage}: ${app.stepCheckpoint.status}; credential reference ${app.stepCheckpoint.credentialRef}.`);
      }
      if (graphJob) {
        console.log(`  After: ${graphJob.needs.length ? graphJob.needs.join(", ") : "none"}; gates: ${graphJob.gates.join(", ")}.`);
      }
      if (options.action === "info") {
        for (const service of saved?.services ?? []) {
          console.log(`  ${service.id}: ${service.purpose ?? "purpose unavailable; inspect the saved recipe"}`);
        }
        console.log(`  Data: ${saved?.dataDirectory ?? "not recorded"}; credentials: ${saved?.credentialRef ?? saved?.passwordFile ?? "not prepared"}.`);
        console.log(`  Next: self-host app info --id ${app.appId} --project-root ${options.root}`);
      }
    }
    if (additionalAppIds.length) {
      console.log(`Additional app checkpoints outside this batch: ${additionalAppIds.join(", ")}. Inspect each exact app separately.`);
    }
    console.log(result.next);
    return;
  }
  const candidate = await plan(options, invoke, resolveWorkflow);
  if (options.action === "plan") {
    console.log(options.json ? JSON.stringify(candidate, null, 2) : formatBatchPlan(candidate));
    return;
  }
  if (options.approval !== candidate.approval || candidate.apps.some((app) => options.approvals.get(app.id) !== app.approval)) {
    fail("batch or app approval does not match the fresh exact plans", "approval-mismatch");
  }
  if (!(typeof Bun !== "undefined" && Bun.isStandaloneExecutable)
    && (typeof process.argv[1] !== "string" || !isAbsolute(process.argv[1]))) {
    fail("batch apply needs the exact CLI entry point for isolated app jobs");
  }
  await privateParent(options.root, true);
  await underBatchLock(options.root, async () => {
  const ledger: Ledger = { schemaVersion: 3, projectRoot: options.root, approval: candidate.approval,
    withoutHomarr: options.withoutHomarr,
    catalog: { planId: candidate.catalogPlanId, sourceSha256: candidate.catalogSourceSha256,
      workflow: { mode: "planning-only", jobs: candidate.catalogWorkflow.jobs.map(jobFields) } },
    inputs: { dataParent: options.dataParent, email: options.email, name: options.name,
      dockerContext: candidate.apps[0].plan.host.dockerContext },
    ...(candidate.homarrNetwork && candidate.homarrProjectId
      ? { homarr: { projectId: candidate.homarrProjectId, network: candidate.homarrNetwork } } : {}),
    createdAt: new Date().toISOString(),
    jobs: candidate.apps.map((app, index) => ({ id: `app-${app.id}`, appId: app.id,
      projectId: app.plan.compose.projectId, port: app.port, images: app.images,
      approval: app.approval, recipeSha256: app.plan.recipeSha256,
      composePlanId: app.plan.compose.planId, owns: candidate.jobs[index].owns,
      status: "pending" })) };
  try { await writeLedger(options.root, ledger, true); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("batch ledger already exists; inspect status rather than replay apply");
    throw error;
  }
  let transition = Promise.resolve();
  const childFailureCodes = new Map<string, string>();
  const persist = async (id: string, status: Ledger["jobs"][number]["status"]) => {
    transition = transition.then(async () => {
      if (!ledger.jobs.some((job) => job.id === id)) fail("unknown batch job transition", "ledger-transition", true);
      const updated = { ...ledger, jobs: ledger.jobs.map((job) => {
        if (job.id !== id) return job;
        let failureCode: string | undefined;
        if (status === "inspect-checkpoint") failureCode = childFailureCodes.get(id) ?? "child-failure-unclassified";
        if (status === "blocked") failureCode = "dependency-failed";
        return { ...job, status, failureCode };
      }) };
      await writeLedger(options.root, updated, false);
      ledger.jobs = updated.jobs;
    });
    await transition;
  };
  try {
    const outcomes = await runApprovedDag(candidate.apps.map((app, index) => ({
      ...candidate.jobs[index],
      run: async () => {
        const id = `app-${app.id}`;
        const result = await runChild(app.applyArgs.slice(2), app.id, app.plan.compose.projectId,
          candidate.homarrNetwork);
        if (result.failureCode) childFailureCodes.set(id, result.failureCode);
        return result.ok;
      },
    })), new Set(candidate.completed), 2, persist);
    const complete = outcomes.every((job) => job.status === "applied");
    const jobResults = outcomes.map((outcome) => ({ ...outcome,
      failureCode: ledger.jobs.find((job) => job.id === outcome.id)?.failureCode ?? null }));
    const result = { schemaVersion: 1, command: "app batch apply",
      status: complete ? "applied-unverified" : "partial-needs-inspection", mutation: true,
      projectRoot: options.root, withoutHomarr: options.withoutHomarr,
      homarrNetwork: candidate.homarrNetwork, homarrProjectId: candidate.homarrProjectId,
      ledgerPath: ledgerPath(options.root), jobs: jobResults,
      results: jobResults, acceptanceVerified: false,
      next: complete ? "Run each app status and its independent account and acceptance gates."
        : "Inspect the batch ledger and each exact app status. No batch job is automatically replayed." };
    console.log(options.json ? JSON.stringify(result, null, 2)
      : `${result.status}; inspect ${result.ledgerPath} and each app status before any recovery.`);
  } catch {
    fail("batch execution stopped after its ledger was created; inspect exact app states before recovery",
      "batch-inspect-required", true);
  }
  });
}
