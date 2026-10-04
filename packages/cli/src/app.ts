import { execFile, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants, existsSync, lstatSync, readFileSync } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { isRecipeImageReference, matchesRecipeImagePin, pinRecipeImage } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/recipe-image-reference.ts";
import { fetchPublicRegistryImageConfig, type VerifiedImagePlatform } from "./lib/public-registry-config.ts";
import { assertPackagedCatalogProject } from "./lib/catalog-project.ts";
import { closedImmichManifest, generatedConfigReadability, multiServiceManifest, pinnedMultiServiceImages,
  prepareMultiServiceFiles } from "./lib/multi-service-recipe.ts";
import { bootstrapImmichAdmin, inspectInitialization, verifyLogin } from "./lib/immich-admin-api.ts";
import { verifyImmichAdminRelease } from "./lib/immich-homarr-evidence.ts";
import { createImmichHomarrKey, inspectImmichHomarrKeys,
  verifyImmichHomarrKey } from "./lib/immich-homarr-key.ts";
import { immichHomarrPermissions, immichPhotoRoundTrip, immichTrashAsset } from "./immich-accept.ts";
import { verifyPaperlessAdmin } from "./lib/paperless-admin-api.ts";
import { paperlessApiTokenCommand } from "./lib/paperless-api-token.ts";
import { createUptimeAdmin, createUptimeSelfMonitor, ensureUptimeSqliteDatabase, inspectUptimeMonitor,
  inspectUptimeSelfMonitor, listUptimeMonitors, uptimeSelfMonitorConfig,
  uptimeSelfMonitorUrl, uptimeSelfMonitorVersion,
  UptimeOnboardingError, verifyUptimeLogin } from "./lib/uptime-onboarding-api.ts";
import { createUptimeStatusPage, inspectUptimeStatusPage, uptimeStatusPageGroup,
  uptimeStatusPageSlug, uptimeStatusPageTitle, UptimeStatusPageError,
  type UptimeStatusPageStage } from "./lib/uptime-status-page-api.ts";
import { validateInput as validateHomarrAttachInput } from "./homarr-attach.ts";
import { bootstrapHomarrApi, HomarrOnboardingError,
  type HomarrOnboardingCheckpoint } from "./lib/homarr-onboarding-api.ts";
import { paperlessCanary, paperlessTask, trashPaperlessCanary, uploadPaperlessCanary,
  verifyPaperlessCanary } from "./lib/paperless-document-api.ts";
import { appBatchCommand, BatchCommandError } from "./app-batch.ts";
import { BatchMutationLockError, withAppMutationLock, withAppPortMutationLock } from "./lib/batch-mutation-lock.ts";
import { shellCommand } from "./lib/shell-command.ts";
import { configureProwlarrAdmin, prowlarrHostConfig,
  verifyProwlarrLogin } from "./lib/prowlarr-onboarding-api.ts";
import { sharedProjectCommand } from "./shared-project.ts";
import { SharedAcceptanceOwnerError } from "./lib/shared-acceptance-owner.ts";
import { SharedRecipeMigrationError } from "./lib/shared-recipe-migration-command.ts";
import { SharedImageTransitionError } from "./lib/shared-image-transition-command.ts";

export { BatchCommandError };
export { ComposeRuntimeUnavailableError } from "./lib/selfhost-compose.ts";
export { SharedProjectCommandError } from "./shared-project.ts";
export { DockerApiAuthorityError } from "./lib/docker-api-authority.ts";

type RecordValue = Record<string, any>;

const appIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digestPattern = /^[0-9a-f]{64}$/;
const outputLimit = 1024 * 1024;
const legacyPaperlessBindRecipeSha256 = "355ac8cf02b5179c7fa334cf31f2b445246cbf85de21c1a9d70bad1c3a03d933";

export class AppCommandError extends Error {
  constructor(message: string, readonly code = "app-rejected",
    readonly partialWritePossible?: boolean) {
    super(message);
    this.name = "AppCommandError";
  }
}

function fail(message: string, code?: string, partialWritePossible?: boolean): never {
  throw new AppCommandError(message, code, partialWritePossible);
}

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} is invalid`);
  return value as RecordValue;
}

function parse(args: string[]) {
  if ((args[0] === "help" || args[0] === "--help" || args[0] === "-h")
    && args.length === 1) return null;
  const action = args[0];
  if (action !== "image" && action !== "plan" && action !== "apply" && action !== "resume"
    && action !== "status" && action !== "info" && action !== "up" && action !== "down"
    && action !== "account-plan" && action !== "account-prepare" && action !== "handoff"
    && action !== "onboard" && action !== "close-plan" && action !== "close-setup"
    && action !== "photo-check" && action !== "persistence-start" && action !== "persistence-finish"
    && action !== "login-check" && action !== "document-check" && action !== "document-cleanup"
    && action !== "homarr-input" && action !== "homarr-uptime-input" && action !== "homarr-immich-input"
    && action !== "homarr-paperless-input"
    && action !== "homarr-immich-key-plan" && action !== "homarr-immich-key-create"
    && action !== "monitor-list" && action !== "monitor-plan" && action !== "monitor-check"
    && action !== "monitor-create-plan" && action !== "monitor-create"
    && action !== "status-page-plan" && action !== "status-page-create" && action !== "status-page-status"
    && action !== "document-renew-plan" && action !== "document-renew"
    && action !== "paperless-token-plan" && action !== "paperless-token-create"
    && action !== "paperless-token-status") {
    fail("unsupported app action; run app help for the current command list");
  }
  const flags: Record<string, string> = {};
  const images: string[] = [];
  const allowed = new Set(["--id", "--project-root", "--image", "--port", "--data-parent", "--approve",
    "--username", "--email", "--name", "--adopt-existing", "--show", "--resolve-images", "--json", "--live",
    "--icon-url", "--href", "--route-revision", "--url", "--slug-stdin", "--connect-homarr",
    "--monitor-id"]);
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowed.has(flag) || (flag !== "--image" && Object.hasOwn(flags, flag))) {
      fail("Invalid or repeated app option");
    }
    if (flag === "--json" || flag === "--live" || flag === "--adopt-existing" || flag === "--show"
      || flag === "--resolve-images" || flag === "--connect-homarr" || flag === "--slug-stdin"
      || flag === "--route-revision") {
      flags[flag] = "true";
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${flag} requires one value`);
    if (flag === "--image") images.push(value);
    else flags[flag] = value;
    index += 1;
  }
  let required = ["--id", "--project-root"];
  if (action === "image") required = ["--id"];
  if (action === "plan" || action === "apply") {
    required = ["--id", "--project-root", "--port"];
  }
  for (const flag of required) {
    if (!flags[flag]) fail(`app ${action} requires ${flag}`);
  }
  if ((action === "plan" || action === "apply") && images.length === 0
    && flags["--resolve-images"] !== "true") {
    fail(`app ${action} requires --image`);
  }
  if (flags["--resolve-images"] === "true" && (action !== "plan" || images.length > 0)) {
    fail("--resolve-images is only for app plan without explicit --image values");
  }
  if ((action === "apply" || action === "resume" || action === "up" || action === "down"
    || action === "account-prepare" || action === "onboard" || action === "close-setup"
    || action === "photo-check" || action === "document-check" || action === "document-cleanup"
    || action === "homarr-immich-key-create"
    || action === "monitor-check" || action === "monitor-create" || action === "status-page-create"
    || action === "document-renew"
    || action === "paperless-token-create"
    || action === "persistence-start" || action === "persistence-finish")
    && !flags["--approve"]) {
    fail(`app ${action} requires --approve from the exact saved app plan`);
  }
  if (action !== "apply" && action !== "resume" && action !== "up" && action !== "down"
    && action !== "account-prepare" && action !== "onboard" && action !== "close-setup"
    && action !== "photo-check" && action !== "document-check" && action !== "document-cleanup"
    && action !== "homarr-immich-key-create"
    && action !== "monitor-check" && action !== "monitor-create" && action !== "status-page-create"
    && action !== "document-renew"
    && action !== "paperless-token-create"
    && action !== "persistence-start" && action !== "persistence-finish"
    && flags["--approve"]) {
    fail(`--approve is not valid for app ${action}`);
  }
  if (action !== "plan" && action !== "apply" && (images.length > 0 || flags["--port"] || flags["--data-parent"])) {
    fail(`app ${action} reads the saved project; do not pass image, port, or data parent`);
  }
  if (action !== "plan" && action !== "apply" && (flags["--email"] || flags["--name"])) {
    fail("--email and --name are valid only for app plan and apply");
  }
  if (action === "image" && flags["--project-root"]) {
    fail("app image reads the catalog and registry only; do not pass a project root");
  }
  if (action !== "account-plan" && action !== "account-prepare"
    && (flags["--username"] || flags["--adopt-existing"])) {
    fail("--username and --adopt-existing are valid only for app account planning or preparation");
  }
  if (action !== "handoff" && flags["--show"]) fail("--show is valid only for app handoff");
  if (action === "homarr-input") {
    const permitted = new Set(["--id", "--project-root", "--icon-url", "--href", "--route-revision", "--json"]);
    if (Object.keys(flags).some((flag) => !permitted.has(flag))) {
      fail("app homarr-input accepts only --id, --project-root, --icon-url, --href, --route-revision, and --json");
    }
    if (flags["--route-revision"] && (!flags["--href"] || flags["--icon-url"])) {
      fail("--route-revision needs --href and cannot change the icon");
    }
  } else if (action === "homarr-uptime-input") {
    const permitted = new Set(["--id", "--project-root", "--url", "--slug-stdin", "--json"]);
    if (Object.keys(flags).some((flag) => !permitted.has(flag))) {
      fail("app homarr-uptime-input accepts only --id, --project-root, --url, --slug-stdin, and --json");
    }
  } else if (action === "homarr-immich-input") {
    const permitted = new Set(["--id", "--project-root", "--json"]);
    if (Object.keys(flags).some((flag) => !permitted.has(flag))) {
      fail("app homarr-immich-input accepts only --id, --project-root, and --json");
    }
  } else if (action === "homarr-paperless-input") {
    const permitted = new Set(["--id", "--project-root", "--json"]);
    if (Object.keys(flags).some((flag) => !permitted.has(flag))) {
      fail("app homarr-paperless-input accepts only --id, --project-root, and --json");
    }
  } else if (action === "homarr-immich-key-plan" || action === "homarr-immich-key-create") {
    const permitted = new Set(["--id", "--project-root", "--approve", "--json"]);
    if (Object.keys(flags).some((flag) => !permitted.has(flag))) {
      fail("app homarr-immich-key-plan|create accepts only --id, --project-root, --approve for create, and --json");
    }
  } else if (flags["--icon-url"] || flags["--href"] || flags["--url"] || flags["--slug-stdin"]) {
    fail("--icon-url/--href require app homarr-input; --url/--slug-stdin require app homarr-uptime-input");
  }
  if (action !== "homarr-input" && flags["--route-revision"]) {
    fail("--route-revision is only for app homarr-input");
  }
  if (action !== "status" && action !== "info" && flags["--live"]) {
    fail("--live is valid only for read-only app status or info");
  }
  if (flags["--connect-homarr"] && action !== "plan" && action !== "apply") {
    fail("--connect-homarr is valid only for app plan and apply");
  }
  if ((action === "monitor-plan" || action === "monitor-check") !== Boolean(flags["--monitor-id"])) {
    fail("--monitor-id is required only for app monitor-plan and monitor-check");
  }
  if (flags["--monitor-id"] && (!/^[1-9][0-9]{0,8}$/.test(flags["--monitor-id"]))) {
    fail("--monitor-id must be a positive monitor ID");
  }
  const appId = flags["--id"];
  if (!appIdPattern.test(appId) || appId.length > 47) fail("--id must be one bounded catalog app ID");
  let port: number | null = null;
  if (action === "plan" || action === "apply") {
    const portText = flags["--port"];
    if (!/^\d{4,5}$/.test(portText)) fail("--port must be an integer from 1024 through 65535");
    port = Number(portText);
    if (port < 1024 || port > 65535) fail("--port must be an integer from 1024 through 65535");
  }
  return { action, appId, projectRoot: flags["--project-root"], images,
    port, approval: flags["--approve"] ?? null, json: flags["--json"] === "true",
    live: flags["--live"] === "true",
    resolveImages: flags["--resolve-images"] === "true",
    dataParent: flags["--data-parent"] ?? null,
    email: flags["--email"] ?? null, name: flags["--name"] ?? null,
    username: flags["--username"] ?? "admin", adoptExisting: flags["--adopt-existing"] === "true",
    show: flags["--show"] === "true", connectHomarr: flags["--connect-homarr"] === "true",
    iconUrl: flags["--icon-url"] ?? null,
    href: flags["--href"] ?? null, url: flags["--url"] ?? null,
    slugStdin: flags["--slug-stdin"] === "true",
    routeRevision: flags["--route-revision"] === "true",
    monitorId: flags["--monitor-id"] ? Number(flags["--monitor-id"]) : null };
}

function runJson(command: string, args: string[], label: string): RecordValue {
  const result = spawnSync(command, args, {
    encoding: "utf8", timeout: 120_000, maxBuffer: outputLimit,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail(`${label} failed; child output was suppressed`);
  try {
    return record(JSON.parse(result.stdout), label);
  } catch {
    fail(`${label} returned invalid JSON`);
  }
}

function runtimeFile(packaged: string, source: string, label: string): string {
  const candidates = [new URL(packaged, import.meta.url), new URL(source, import.meta.url)];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  fail(`${label} is missing; rebuild or reinstall the CLI`);
}

export function recipeFor(appId: string, requireBoundedApply = true) {
  const router = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const command = router.endsWith(".ts") ? "bun" : process.execPath;
  const envelope = runJson(command, [router, "catalog", "recipe", appId, "--json"], "catalog recipe");
  if (envelope.schemaVersion !== 1 || envelope.status !== "pass" || envelope.mutation !== false
    || envelope.command !== "catalog recipe") fail("catalog did not return a validated read-only recipe");
  const data = record(envelope.data, "catalog recipe data");
  const recipe = record(data.recipe, "catalog recipe");
  const capability = record(data.recipeCapability, "catalog recipe capability");
  const defaults = record(recipe.defaults, "catalog recipe defaults");
  const storage = record(recipe.storage, "catalog recipe storage");
  const app = data.app === undefined ? catalogAppFor(appId) : record(data.app, "catalog app metadata");
  if (app.id !== appId) fail("catalog app metadata differs from the selected recipe");
  if (typeof data.name !== "string" || !data.name || typeof data.purpose !== "string"
    || !data.purpose || data.purpose.length > 512
    || /[\u0000-\u001f\u007f]/.test(data.purpose)) fail("catalog recipe purpose is invalid");
  if (data.appId !== appId || recipe.appId !== appId || typeof data.recipeSha256 !== "string"
    || !digestPattern.test(data.recipeSha256)
    || typeof capability.boundedApply !== "boolean") fail("catalog recipe is invalid");
  if (requireBoundedApply && !capability.boundedApply) {
    fail("catalog recipe is not yet supported by the bounded app installer");
  }
  if (recipe.schemaVersion === 2 && recipe.kind === "multi-service-compose") {
    if (!Array.isArray(recipe.services) || recipe.services.length < 1
      || recipe.services.some((service: unknown) => !service || typeof service !== "object"
        || typeof (service as RecordValue).id !== "string"
        || typeof (service as RecordValue).imageTag !== "string")) {
      fail("catalog multi-service recipe is invalid");
    }
    return { app, recipe, services: recipe.services as RecordValue[], defaults, storage,
      previousRecipes: data.previousRecipes as RecordValue[] | undefined,
      appPurpose: data.purpose as string,
      boundedApply: capability.boundedApply as boolean,
      recipeSha256: data.recipeSha256 as string };
  }
  const service = record(recipe.service, "catalog recipe service");
  if (recipe.schemaVersion !== 1 || recipe.kind !== "single-service-compose" || service.id !== appId
    || service.user !== "image-default" || service.networkInternal !== false
    || defaults.hostIp !== "127.0.0.1" || defaults.dataDirectoryName !== appId
    || storage.filesystem !== "local-posix-locks" || !Number.isSafeInteger(storage.minimumFreeBytes)
    || typeof service.imageTag !== "string") fail("catalog recipe is not supported by the app planner");
  return { app, recipe, service, defaults, storage, appPurpose: data.purpose as string,
    boundedApply: capability.boundedApply as boolean,
    recipeSha256: data.recipeSha256 as string };
}

function catalogWorkflowFor(appIds: string[], withHomarr: boolean): RecordValue {
  const router = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const command = router.endsWith(".ts") ? "bun" : process.execPath;
  const args = [router, "catalog", "workflow"];
  for (const appId of appIds) args.push("--app", appId);
  args.push("--select", `control-plane=${withHomarr ? "homarr" : "none"}`, "--json");
  const envelope = runJson(command, args, "catalog workflow");
  if (envelope.schemaVersion !== 1 || envelope.status !== "pass"
    || envelope.command !== "catalog workflow" || envelope.mutation !== false) {
    fail("catalog did not return a read-only workflow");
  }
  return record(envelope.data, "catalog workflow data");
}

function catalogAppFor(appId: string): RecordValue {
  const router = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const command = router.endsWith(".ts") ? "bun" : process.execPath;
  const envelope = runJson(command, [router, "catalog", "show", appId, "--json"], "catalog app");
  if (envelope.status !== "pass" || envelope.mutation !== false) fail("catalog app metadata is unavailable");
  return record(record(envelope.data, "catalog app data").app, "catalog app metadata");
}

async function projectRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path || path === sep || path === resolve(homedir())) {
    fail("--project-root must be one exact absolute project directory, not root or home");
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
    || (metadata.mode & 0o002) !== 0 || metadata.uid !== process.getuid?.()) {
    fail("project root must be a real, current-user-owned, non-world-writable directory");
  }
  return path;
}

async function requireAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
    fail(`${label} already exists; this route plans new projects only`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

type AppStage = "approved" | "rendered" | "applied";
type AppState = {
  schemaVersion: 1;
  appId: string;
  recipeSha256: string;
  approval: string;
  image: string;
  port: number;
  projectRoot: string;
  dockerContext: string;
  projectId: string;
  composeTarget: string;
  dataDirectory: string;
  manifest: RecordValue;
  homarrNetwork?: string;
  stage: AppStage;
  lastLifecycle?: "running" | "stopped";
  credentialRef?: string;
  accountUsername?: string;
  uptimeDatabaseSetup?: { stage: "attempted" | "ready"; completedAt?: string };
  uptimeSetup?: { stage: "attempted" | "login-verified"; verifiedAt?: string };
  uptimeSelfMonitor?: { stage: "attempted" | "recorded"; name: string;
    id?: number; recordedAt?: string };
  uptimeStatusPage?: { stage: UptimeStatusPageStage; slug: "default"; title: string;
    monitorId: number; recordedAt?: string };
  uptimeMonitor?: { id: number; name: string; identity: string;
    stage: "baseline" | "stopped" | "restarted" | "verified";
    baselineAt: string; baselineBeatId: number; stopBeatId?: number; upBeatId?: number;
    verifiedAt?: string };
};

type MultiAppState = {
  schemaVersion: 2;
  appId: string;
  recipeSha256: string;
  approval: string;
  images: Record<string, string>;
  port: number;
  uid: number;
  gid: number;
  timezone?: string;
  projectRoot: string;
  dockerContext: string;
  projectId: string;
  composeTarget: string;
  dataDirectory: string;
  manifest: RecordValue;
  onboarding: RecordValue;
  onboardingStage?: "pending" | "signup-attempted" | "login-verified" | "closing" | "closed";
  homarrSetup?: { stage: "pending" | "attempted" | "complete"; boardName: "personal";
    checkpoint?: HomarrOnboardingCheckpoint; completedAt?: string };
  prowlarrSetup?: { stage: "attempted" | "login-verified"; verifiedAt?: string };
  immichHomarrKey?: { stage: "attempted" | "saved" | "verified";
    approval: string; attemptedAt: string; keyId?: string; verifiedAt?: string };
  photoCheck?: { status: "pending-manual-recovery" | "passed"; assetId: string;
    imageSha256: string; checkedAt?: string };
  paperlessDocument?: { stage: "upload-attempted" | "task-saved" | "document-saved" | "passed";
    title: string; imageSha256: string; startedAt: string; taskId?: string;
    documentId?: number; checkedAt?: string };
  paperlessPersistence?: { stage: "awaiting-stop" | "stopped" | "restarted" | "accepted" | "stale";
    documentId: number; imageSha256: string; startedAt: string;
    stoppedAt?: string; restartedAt?: string; acceptedAt?: string;
    cleanup?: "pending" | "trashed"; cleanedAt?: string };
  paperlessGeneration?: number;
  paperlessProofHistory?: Array<{ generation: number; documentId: number; title: string;
    imageSha256: string; startedAt: string; stoppedAt: string;
    restartedAt: string; acceptedAt: string; cleanedAt: string; stale: boolean }>;
  persistence?: { stage: "uploaded" | "awaiting-stop" | "stopped" | "restarted" | "accepted" | "stale";
    assetId: string; imageSha256: string; startedAt: string;
    stoppedAt?: string; restartedAt?: string; acceptedAt?: string;
    cleanup?: "pending" | "trashed" };
  previousComposeTarget?: string;
  homarrNetwork?: string;
  stage: AppStage;
  lastLifecycle?: "running" | "stopped";
};

function recipeForSavedMultiState(state: MultiAppState, requireBoundedApply = true): ReturnType<typeof recipeFor> {
  const selected = recipeFor(state.appId, requireBoundedApply);
  if (selected.recipeSha256 === state.recipeSha256) return selected;
  if (state.appId !== "paperless-ngx" || state.recipeSha256 !== legacyPaperlessBindRecipeSha256) {
    fail("multi-service recipe changed; stop for migration review", "recipe-changed");
  }
  const path = runtimeFile("./workflows/selfhost/references/catalog/apps/paperless-ngx/recipe.bind-legacy.json",
    "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/recipe.bind-legacy.json",
    "archived Paperless bind recipe");
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 16 * 1024) {
    fail("archived Paperless bind recipe is unsafe");
  }
  const raw = readFileSync(path);
  if (createHash("sha256").update(raw).digest("hex") !== legacyPaperlessBindRecipeSha256) {
    fail("archived Paperless bind recipe differs from the saved recipe hash", "recipe-changed");
  }
  let recipe: RecordValue;
  try {
    recipe = record(JSON.parse(raw.toString("utf8")), "archived Paperless bind recipe");
  } catch {
    fail("archived Paperless bind recipe is invalid");
  }
  if (recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || recipe.appId !== "paperless-ngx" || !Array.isArray(recipe.services)) {
    fail("archived Paperless bind recipe is invalid");
  }
  return { ...selected, recipe, services: recipe.services, defaults: recipe.defaults,
    storage: recipe.storage, recipeSha256: legacyPaperlessBindRecipeSha256 };
}

function stateDirectory(root: string): string {
  return join(root, ".selfhost", "app-state");
}

function statePath(root: string, appId: string): string {
  return join(stateDirectory(root), `${appId}.json`);
}

function savedServicePurposes(state: AppState | MultiAppState): Array<{ id: string; purpose: string | null }> {
  const services = Array.isArray(state.manifest.services) ? state.manifest.services as RecordValue[] : [];
  const ids = services.map((service) => service.id as string);
  try {
    let selected: ReturnType<typeof recipeFor>;
    if (state.schemaVersion === 2) selected = recipeForSavedMultiState(state, false);
    else selected = recipeFor(state.appId, false);
    if (selected.recipeSha256 === state.recipeSha256) {
      const source = Array.isArray(selected.recipe.services)
        ? selected.recipe.services as RecordValue[] : [selected.recipe.service as RecordValue];
      if (source.length === ids.length && source.every((service, index) => service.id === ids[index])) {
        return source.map((service) => ({ id: service.id as string,
          purpose: typeof service.purpose === "string" ? service.purpose : null }));
      }
    }
  } catch { /* Saved state remains readable when an optional recipe is no longer packaged. */ }
  return ids.map((id) => ({ id, purpose: null }));
}

function lifecycleCommands(appId: string, root: string, approvals: RecordValue | null): Record<string, string[]> {
  const commands: Record<string, string[]> = {};
  if (!approvals) return commands;
  for (const action of ["resume", "up", "down"]) {
    const token = approvals[action];
    if (typeof token !== "string") continue;
    commands[action] = ["self-host", "app", action, "--id", appId,
      "--project-root", root, "--approve", token];
  }
  return commands;
}

function printLifecycleCommands(commands: Record<string, string[]>, lastRecordedLifecycle: string | null): void {
  if (commands.resume) console.log(`Resume: ${shellCommand(commands.resume)}`);
  if (lastRecordedLifecycle === "stopped" && commands.up) {
    console.log(`Start: ${shellCommand(commands.up)}`);
    return;
  }
  if (commands.down && commands.up) {
    console.log(`Restart: ${shellCommand(commands.down)}`);
    console.log(`Then: ${shellCommand(commands.up)}`);
  }
}

function projectIdFor(root: string, appId: string): string {
  const identity = createHash("sha256").update(appId).update("\0").update(root).digest("hex").slice(0, 16);
  return `selfhost-${appId.slice(0, 28)}-${identity}`;
}

function dataParentFor(root: string, requested: string | null): string {
  const fallback = join(root, ".selfhost", "app-data");
  if (requested === null) return fallback;
  if (!isAbsolute(requested) || resolve(requested) !== requested || requested === "/"
    || /[\u0000-\u001f\u007f]/.test(requested)) {
    fail("--data-parent must be one exact absolute directory, not a broad root or symlink path");
  }
  const managed = join(root, ".selfhost");
  if (requested !== fallback && (requested === managed || requested.startsWith(`${managed}${sep}`))) {
    fail("--data-parent must stay outside managed project state and secrets");
  }
  return requested;
}

function savedDataDirectory(path: unknown, appId: string, root: string): boolean {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path
    || basename(path) !== appId || dirname(path) === "/" || path === root) return false;
  const managed = join(root, ".selfhost");
  const fallback = join(managed, "app-data", appId);
  if (path === fallback) return true;
  return path !== managed && !path.startsWith(`${managed}${sep}`);
}

async function readRawState(root: string, appId: string): Promise<RecordValue | null> {
  const path = statePath(root, appId);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0
    || metadata.size < 1 || metadata.size > 256 * 1024) fail("app state is not an owner-only bounded file");
  return record(JSON.parse(await readFile(path, "utf8")), "app state");
}

async function readState(root: string, appId: string): Promise<AppState | null> {
  const value = await readRawState(root, appId);
  if (!value) return null;
  if (value.schemaVersion !== 1 || value.appId !== appId || value.projectRoot !== root
    || !["approved", "rendered", "applied"].includes(value.stage)
    || !digestPattern.test(value.recipeSha256) || typeof value.approval !== "string"
    || typeof value.image !== "string" || !Number.isInteger(value.port)
    || typeof value.dockerContext !== "string"
    || ![projectIdFor(root, appId), `selfhost-${appId}`].includes(value.projectId)
    || typeof value.composeTarget !== "string"
    || dirname(value.composeTarget) !== join(root, ".selfhost", "apps", value.projectId)
    || !/^compose\.[0-9a-f]{16}\.yaml$/.test(basename(value.composeTarget))
    || !savedDataDirectory(value.dataDirectory, appId, root)
    || (value.credentialRef !== undefined
      && value.credentialRef !== join(root, ".selfhost", "credentials", `${appId}.env`))
    || (value.accountUsername !== undefined
      && (typeof value.accountUsername !== "string" || !/^[A-Za-z0-9._-]{1,32}$/.test(value.accountUsername)))
    || (Boolean(value.credentialRef) !== Boolean(value.accountUsername))
    || (value.uptimeDatabaseSetup !== undefined
      && (appId !== "uptime-kuma" || value.stage !== "applied" || !value.credentialRef
        || !["attempted", "ready"].includes(value.uptimeDatabaseSetup?.stage)
        || (value.uptimeDatabaseSetup.stage === "ready"
          && (typeof value.uptimeDatabaseSetup.completedAt !== "string"
            || !Number.isFinite(Date.parse(value.uptimeDatabaseSetup.completedAt))))
        || (value.uptimeDatabaseSetup.stage === "attempted"
          && value.uptimeDatabaseSetup.completedAt !== undefined)))
    || (value.uptimeSetup !== undefined
      && (appId !== "uptime-kuma" || value.stage !== "applied" || !value.credentialRef
        || !["attempted", "login-verified"].includes(value.uptimeSetup?.stage)
        || (value.uptimeSetup.stage === "login-verified"
          && (typeof value.uptimeSetup.verifiedAt !== "string"
            || !Number.isFinite(Date.parse(value.uptimeSetup.verifiedAt))))
        || (value.uptimeSetup.stage === "attempted" && value.uptimeSetup.verifiedAt !== undefined)))
    || (value.uptimeMonitor !== undefined
      && (appId !== "uptime-kuma" || value.stage !== "applied"
        || value.uptimeSetup?.stage !== "login-verified"
        || !Number.isInteger(value.uptimeMonitor?.id) || value.uptimeMonitor.id < 1
        || typeof value.uptimeMonitor.name !== "string" || !value.uptimeMonitor.name
        || value.uptimeMonitor.name.length > 255
        || !digestPattern.test(value.uptimeMonitor.identity)
        || !["baseline", "stopped", "restarted", "verified"].includes(value.uptimeMonitor.stage)
        || typeof value.uptimeMonitor.baselineAt !== "string"
        || !Number.isFinite(Date.parse(value.uptimeMonitor.baselineAt))
        || !Number.isSafeInteger(value.uptimeMonitor.baselineBeatId)
        || value.uptimeMonitor.baselineBeatId < 1
        || (value.uptimeMonitor.stopBeatId !== undefined
          && (!Number.isSafeInteger(value.uptimeMonitor.stopBeatId)
            || value.uptimeMonitor.stopBeatId < value.uptimeMonitor.baselineBeatId))
        || (value.uptimeMonitor.upBeatId !== undefined
          && (!Number.isSafeInteger(value.uptimeMonitor.upBeatId)
            || value.uptimeMonitor.stopBeatId === undefined
            || value.uptimeMonitor.upBeatId < value.uptimeMonitor.stopBeatId))
        || (["restarted", "verified"].includes(value.uptimeMonitor.stage)
          && (value.uptimeMonitor.stopBeatId === undefined || value.uptimeMonitor.upBeatId === undefined))
        || (value.uptimeMonitor.stage === "verified"
          && (typeof value.uptimeMonitor.verifiedAt !== "string"
            || !Number.isFinite(Date.parse(value.uptimeMonitor.verifiedAt))))
        || (value.uptimeMonitor.stage !== "verified" && value.uptimeMonitor.verifiedAt !== undefined)))
    || (value.uptimeSelfMonitor !== undefined
      && (appId !== "uptime-kuma" || value.stage !== "applied"
        || value.uptimeSetup?.stage !== "login-verified"
        || !value.uptimeSelfMonitor || typeof value.uptimeSelfMonitor !== "object"
        || Array.isArray(value.uptimeSelfMonitor)
        || value.uptimeSelfMonitor.name !== uptimeSelfMonitorName(value.projectId)
        || !["attempted", "recorded"].includes(value.uptimeSelfMonitor.stage)
        || (value.uptimeSelfMonitor.stage === "attempted"
          && (value.uptimeSelfMonitor.id !== undefined
            || value.uptimeSelfMonitor.recordedAt !== undefined))
        || (value.uptimeSelfMonitor.stage === "recorded"
          && (!Number.isSafeInteger(value.uptimeSelfMonitor.id)
            || value.uptimeSelfMonitor.id < 1
            || typeof value.uptimeSelfMonitor.recordedAt !== "string"
            || !Number.isFinite(Date.parse(value.uptimeSelfMonitor.recordedAt))))))
    || (value.uptimeStatusPage !== undefined
      && (appId !== "uptime-kuma" || value.stage !== "applied"
        || value.uptimeSetup?.stage !== "login-verified"
        || value.uptimeStatusPage?.slug !== uptimeStatusPageSlug
        || value.uptimeStatusPage.title !== uptimeStatusPageTitle
        || !Number.isSafeInteger(value.uptimeStatusPage.monitorId)
        || value.uptimeStatusPage.monitorId < 1
        || !["add-attempted", "save-attempted", "recorded"].includes(value.uptimeStatusPage.stage)
        || (value.uptimeStatusPage.stage === "recorded"
          && (typeof value.uptimeStatusPage.recordedAt !== "string"
            || !Number.isFinite(Date.parse(value.uptimeStatusPage.recordedAt))))
        || (value.uptimeStatusPage.stage !== "recorded"
          && value.uptimeStatusPage.recordedAt !== undefined)))
    || (value.lastLifecycle !== undefined && !["running", "stopped"].includes(value.lastLifecycle))
    || !value.manifest || typeof value.manifest !== "object" || Array.isArray(value.manifest)
    || value.manifest.project?.id !== value.projectId
    || value.manifest.project?.dockerContext !== value.dockerContext
    || value.manifest.services?.[0]?.image !== value.image
    || value.manifest.services?.[0]?.ports?.[0]?.published !== value.port
    || value.manifest.services?.[0]?.mounts?.[0]?.source !== value.dataDirectory
    || value.manifest.networks?.[0]?.name !== `${value.projectId}-private`
    || !validSingleHomarrNetwork(value, root, appId)) {
    fail("app state does not match the exact saved project");
  }
  return value as AppState;
}

function validSingleHomarrNetwork(value: RecordValue, root: string, appId: string): boolean {
  const manifest = value.manifest;
  const external = value.homarrNetwork;
  if (!Array.isArray(manifest?.networks) || !Array.isArray(manifest?.services)
    || manifest.services.length !== 1) return false;
  if (external === undefined) {
    return manifest.networks.length === 1
      && JSON.stringify(manifest.services[0].networks) === JSON.stringify(["private"]);
  }
  const expected = `${projectIdFor(root, "homarr")}-private`;
  const bridge = manifest.networks[1];
  return appId !== "homarr" && external === expected && manifest.networks.length === 2
    && bridge?.id === "homarr" && bridge.name === expected && bridge.driver === "bridge"
    && bridge.internal === false && bridge.owner === "external"
    && bridge.ownership === "verified-existing"
    && JSON.stringify(manifest.services[0].networks) === JSON.stringify(["private", "homarr"])
    && Array.isArray(manifest.observed?.networks)
    && manifest.observed.networks.some((network: RecordValue) =>
      network.name === expected && network.owner === "external");
}

function validImmichIdentity(email: unknown, name: unknown): boolean {
  return typeof email === "string" && email.length <= 254
    && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)
    && typeof name === "string" && name.trim().length >= 1 && name.length <= 128
    && !/[\r\n\u0000-\u001f\u007f]/.test(name);
}

function configuredMultiOnboarding(recipe: RecordValue, email: string | null,
  name: string | null): RecordValue {
  const onboarding = structuredClone(record(recipe.onboarding, "multi-service onboarding recipe"));
  if (onboarding.kind !== "api-first-admin") {
    if (email !== null || name !== null) fail("this recipe does not accept --email or --name");
    return onboarding;
  }
  if (recipe.appId !== "immich" || onboarding.adapter !== "immich-v3.2.2") {
    fail("custom account identity is supported only by the bundled Immich recipe");
  }
  if (email !== null) onboarding.email = email;
  if (name !== null) onboarding.name = name;
  if (!validImmichIdentity(onboarding.email, onboarding.name)) {
    fail("Immich needs a valid first-admin email and a 1–128 character display name");
  }
  return onboarding;
}

function multiAccountIdentity(recipe: RecordValue, onboarding: RecordValue):
  { email: string; name: string } | undefined {
  if (onboarding.kind !== "api-first-admin") return undefined;
  if (onboarding.email === recipe.onboarding.email && onboarding.name === recipe.onboarding.name) {
    return undefined;
  }
  return { email: onboarding.email, name: onboarding.name };
}

function validMultiOnboarding(onboarding: RecordValue, appService: RecordValue | null,
  directory: string, appId: string, stage: unknown): boolean {
  const environment = Array.isArray(appService?.environment) ? appService.environment : [];
  const secretRefs = Array.isArray(appService?.secretRefs) ? appService.secretRefs : [];
  if (typeof onboarding.officialUrl !== "string" || !onboarding.officialUrl.startsWith("https://")) return false;
  if (onboarding.kind === "external-first-admin") {
    return appId === "seerr" && onboarding.provider === "media-server"
      && stage === undefined && secretRefs.length === 0;
  }
  if (typeof onboarding.fileId !== "string" || !appIdPattern.test(onboarding.fileId)) return false;
  if (onboarding.kind === "initial-admin-from-file") {
    const privateFile = secretRefs.find((entry: RecordValue) => entry?.name === onboarding.fileId);
    return stage === undefined
      && typeof onboarding.username === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(onboarding.username)
      && typeof onboarding.usernameEnvironment === "string"
      && typeof onboarding.fileEnvironment === "string"
      && environment.some((entry: RecordValue) => entry.name === onboarding.usernameEnvironment
        && entry.value === onboarding.username)
      && environment.some((entry: RecordValue) => entry.name === onboarding.fileEnvironment
        && entry.value === `/run/secrets/${onboarding.fileId}`)
      && privateFile?.filePath === join(directory, "secrets", onboarding.fileId);
  }
  if (onboarding.kind === "initial-admin-from-secret-env") {
    const fixedUsername = onboarding.fixedUsername === true
      && onboarding.usernameEnvironment === undefined;
    const environmentUsername = onboarding.fixedUsername === undefined
      && typeof onboarding.usernameEnvironment === "string"
      && environment.some((entry: RecordValue) => entry.name === onboarding.usernameEnvironment
        && entry.value === onboarding.username);
    return stage === undefined
      && (onboarding.bootstrapServiceId === undefined || onboarding.bootstrapServiceId === appId)
      && typeof onboarding.username === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(onboarding.username)
      && typeof onboarding.secretEnvironment === "string"
      && appService?.envFilePath === join(directory, "secrets", `${appId}.env`)
      && (fixedUsername || environmentUsername);
  }
  if (onboarding.kind === "manual-first-admin") {
    if (appId === "prowlarr") {
      return stage === undefined && onboarding.username === "admin"
        && onboarding.fileId === "admin-password" && secretRefs.length === 0
        && environment.some((entry: RecordValue) => entry?.name === "PUID"
          && entry.value === String(process.getuid?.()))
        && environment.some((entry: RecordValue) => entry?.name === "PGID"
          && entry.value === String(process.getgid?.()));
    }
    if (appId === "homarr") {
      return stage === undefined && onboarding.username === "admin"
        && secretRefs.every((entry: RecordValue) => entry?.name !== onboarding.fileId)
        && secretRefs.some((entry: RecordValue) => entry?.name === "encryption-key"
          && entry.filePath === join(directory, "secrets", "encryption-key"))
        && environment.some((entry: RecordValue) => entry?.name === "SECRET_ENCRYPTION_KEY_FILE"
          && entry.value === "/run/secrets/encryption-key");
    }
    return stage === undefined && onboarding.username === "admin"
      && onboarding.fileId === "admin-password"
      && secretRefs.every((entry: RecordValue) => entry?.name !== onboarding.fileId);
  }
  if (onboarding.kind !== "api-first-admin" || appId !== "immich"
    || onboarding.adapter !== "immich-v3.2.2" || onboarding.username !== "admin"
    || !validImmichIdentity(onboarding.email, onboarding.name)
    || typeof onboarding.setupEnvironment !== "string" || onboarding.setupEnvironment !== "IMMICH_ALLOW_SETUP"
    || !["pending", "signup-attempted", "login-verified", "closing", "closed"].includes(stage as string)) return false;
  const setupValue = stage === "closing" || stage === "closed" ? "false" : "true";
  return secretRefs.every((entry: RecordValue) => entry?.name !== onboarding.fileId)
    && environment.some((entry: RecordValue) => entry.name === onboarding.setupEnvironment
      && entry.value === setupValue);
}

function validMultiHomarrNetwork(value: RecordValue, manifest: RecordValue, root: string, appId: string): boolean {
  const external = value.homarrNetwork;
  const networks = manifest.networks;
  if (!Array.isArray(networks) || !Array.isArray(manifest.services)) return false;
  if (external === undefined) {
    return networks.length === 1 && manifest.services.every((service: RecordValue) =>
      JSON.stringify(service.networks) === JSON.stringify(["private"]));
  }
  const expected = `${projectIdFor(root, "homarr")}-private`;
  if (appId === "homarr" || external !== expected || networks.length !== 2
    || networks[1]?.id !== "homarr" || networks[1]?.name !== expected
    || networks[1]?.driver !== "bridge" || networks[1]?.internal !== false
    || networks[1]?.owner !== "external" || networks[1]?.ownership !== "verified-existing"
    || !Array.isArray(manifest.observed?.networks)
    || !manifest.observed.networks.some((network: RecordValue) =>
      network.name === expected && network.owner === "external")) return false;
  return manifest.services.every((service: RecordValue) => JSON.stringify(service.networks)
    === JSON.stringify(service.id === appId ? ["private", "homarr"] : ["private"]));
}

async function readMultiState(root: string, appId: string): Promise<MultiAppState | null> {
  const value = await readRawState(root, appId);
  if (!value) return null;
  const projectId = projectIdFor(root, appId);
  const directory = join(root, ".selfhost", "apps", projectId);
  const images = record(value.images, "multi-service images");
  const manifest = record(value.manifest, "multi-service manifest");
  const onboarding = record(value.onboarding, "multi-service onboarding");
  const appService = Array.isArray(manifest.services)
    ? manifest.services.find((service: RecordValue) => service?.id === appId) : null;
  if (value.schemaVersion !== 2 || value.appId !== appId || value.projectRoot !== root
    || !digestPattern.test(value.recipeSha256)
    || typeof value.approval !== "string" || !/^APP-APPLY:[a-z0-9-]+:[0-9a-f]{64}$/.test(value.approval)
    || !["approved", "rendered", "applied"].includes(value.stage)
    || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535
    || !Number.isSafeInteger(value.uid) || value.uid <= 0
    || !Number.isSafeInteger(value.gid) || value.gid <= 0
    || (value.timezone !== undefined
      && (typeof value.timezone !== "string" || value.timezone.length > 128
        || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value.timezone)))
    || value.projectId !== projectId || !savedDataDirectory(value.dataDirectory, appId, root)
    || typeof value.composeTarget !== "string" || dirname(value.composeTarget) !== directory
    || !/^compose\.[0-9a-f]{16}\.yaml$/.test(basename(value.composeTarget))
    || typeof value.dockerContext !== "string" || !["default", "rootless"].includes(value.dockerContext)
    || !Array.isArray(manifest.services) || manifest.services.length < 1
    || Object.keys(images).length !== manifest.services.length
    || new Set(manifest.services.map((service: RecordValue) => service?.id)).size !== manifest.services.length
    || manifest.project?.id !== projectId || manifest.project?.dockerContext !== value.dockerContext
    || manifest.project?.directory !== directory
    || manifest.networks?.[0]?.name !== `${projectId}-private`
    || !validMultiHomarrNetwork(value, manifest, root, appId)
    || manifest.services.some((service: RecordValue) => !service || typeof service.id !== "string"
      || service.image !== images[service.id])
    || !validMultiOnboarding(onboarding, appService, directory, appId, value.onboardingStage)
    || (value.stage !== "applied" && value.onboardingStage !== undefined && value.onboardingStage !== "pending")
    || ((value.onboardingStage === "closing" || value.onboardingStage === "closed")
      !== (typeof value.previousComposeTarget === "string"))
    || (typeof value.previousComposeTarget === "string"
      && (dirname(value.previousComposeTarget) !== directory
        || !/^compose\.[0-9a-f]{16}\.yaml$/.test(basename(value.previousComposeTarget))
        || value.previousComposeTarget === value.composeTarget))
    || ((value.onboardingStage === "closing" || value.onboardingStage === "closed")
      !== (manifest.project?.ownership === "verified-existing"))
    || (value.lastLifecycle !== undefined && !["running", "stopped"].includes(value.lastLifecycle))) {
    fail("multi-service app state does not match the exact saved project");
  }
  if (value.homarrSetup !== undefined) {
    const setup = record(value.homarrSetup, "saved Homarr setup");
    if (appId !== "homarr" || setup.boardName !== "personal"
      || !["pending", "attempted", "complete"].includes(setup.stage)
      || (setup.checkpoint !== undefined && !["admin-create-attempted", "admin-created",
        "setup-submit-attempted", "setup-completed", "api-key-create-attempted",
        "api-key-created"].includes(setup.checkpoint))
      || (setup.stage === "pending" && setup.checkpoint !== undefined)
      || ((setup.stage === "complete") !== (typeof setup.completedAt === "string"
        && !Number.isNaN(Date.parse(setup.completedAt))))) {
      fail("saved Homarr setup does not match the exact project");
    }
    if (setup.stage === "complete"
      && !await inspectCredential(join(directory, "secrets", "homarr-api-key"))) {
      fail("saved Homarr API key file is unavailable");
    }
  }
  if (value.prowlarrSetup !== undefined) {
    const setup = record(value.prowlarrSetup, "saved Prowlarr setup");
    if (appId !== "prowlarr" || value.stage !== "applied"
      || !["attempted", "login-verified"].includes(setup.stage)
      || (setup.stage === "attempted" && setup.verifiedAt !== undefined)
      || (setup.stage === "login-verified"
        && (typeof setup.verifiedAt !== "string"
          || !Number.isFinite(Date.parse(setup.verifiedAt))))) {
      fail("saved Prowlarr setup does not match the exact project");
    }
  }
  if (value.immichHomarrKey !== undefined) {
    const key = record(value.immichHomarrKey, "saved Immich Homarr key checkpoint");
    if (appId !== "immich" || value.stage !== "applied" || value.onboardingStage !== "closed"
      || !["attempted", "saved", "verified"].includes(key.stage)
      || typeof key.approval !== "string"
      || !/^APP-HOMARR-IMMICH-KEY:immich:[0-9a-f]{64}$/.test(key.approval)
      || typeof key.attemptedAt !== "string" || !Number.isFinite(Date.parse(key.attemptedAt))
      || ((key.stage === "saved" || key.stage === "verified")
        !== (typeof key.keyId === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key.keyId)))
      || ((key.stage === "verified") !== (typeof key.verifiedAt === "string"
        && Number.isFinite(Date.parse(key.verifiedAt))))) {
      fail("saved Immich Homarr key checkpoint does not match the exact project");
    }
  }
  if (value.photoCheck !== undefined) {
    const check = record(value.photoCheck, "saved photo check");
    if (appId !== "immich" || value.stage !== "applied" || value.onboardingStage !== "closed"
      || !["pending-manual-recovery", "passed"].includes(check.status)
      || typeof check.assetId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(check.assetId)
      || typeof check.imageSha256 !== "string" || !digestPattern.test(check.imageSha256)
      || (check.status === "passed" && (typeof check.checkedAt !== "string"
        || Number.isNaN(Date.parse(check.checkedAt))))
      || (check.status === "pending-manual-recovery" && check.checkedAt !== undefined)) {
      fail("saved Immich photo check does not match the exact closed project");
    }
  }
  const paperlessGeneration = value.paperlessGeneration ?? 0;
  if (!Number.isSafeInteger(paperlessGeneration) || paperlessGeneration < 0
    || paperlessGeneration > 1024
    || ((value.paperlessGeneration !== undefined || value.paperlessProofHistory !== undefined)
      && appId !== "paperless-ngx")
    || (paperlessGeneration > 0
      && (!Array.isArray(value.paperlessProofHistory)
        || value.paperlessProofHistory.length !== paperlessGeneration
        || !value.paperlessProofHistory.every((proof: RecordValue, index: number) =>
          proof && typeof proof === "object" && !Array.isArray(proof)
          && proof.generation === index
          && Number.isSafeInteger(proof.documentId) && proof.documentId > 0
          && proof.title === paperlessCanaryTitle(projectId, index)
          && proof.imageSha256 === paperlessCanary().sha256
          && typeof proof.startedAt === "string" && Number.isFinite(Date.parse(proof.startedAt))
          && typeof proof.stoppedAt === "string" && Number.isFinite(Date.parse(proof.stoppedAt))
          && typeof proof.restartedAt === "string" && Number.isFinite(Date.parse(proof.restartedAt))
          && typeof proof.acceptedAt === "string" && Number.isFinite(Date.parse(proof.acceptedAt))
          && typeof proof.cleanedAt === "string" && Number.isFinite(Date.parse(proof.cleanedAt))
          && typeof proof.stale === "boolean")))
    || (paperlessGeneration === 0 && value.paperlessProofHistory !== undefined)) {
    fail("saved Paperless canary history does not match the exact project");
  }
  if (value.paperlessDocument !== undefined) {
    const check = record(value.paperlessDocument, "saved Paperless document check");
    const taskSaved = ["task-saved", "document-saved", "passed"].includes(check.stage);
    const documentSaved = ["document-saved", "passed"].includes(check.stage);
    if (appId !== "paperless-ngx" || value.stage !== "applied"
      || !["upload-attempted", "task-saved", "document-saved", "passed"].includes(check.stage)
      || check.title !== paperlessCanaryTitle(projectId, paperlessGeneration)
      || check.imageSha256 !== paperlessCanary().sha256
      || typeof check.startedAt !== "string" || Number.isNaN(Date.parse(check.startedAt))
      || (taskSaved !== (typeof check.taskId === "string" && /^[0-9a-f-]{36}$/i.test(check.taskId)))
      || (documentSaved !== (Number.isSafeInteger(check.documentId) && check.documentId > 0))
      || ((check.stage === "passed") !== (typeof check.checkedAt === "string"
        && !Number.isNaN(Date.parse(check.checkedAt))))) {
      fail("saved Paperless document check does not match the exact project");
    }
  }
  if (value.paperlessPersistence !== undefined) {
    const proof = record(value.paperlessPersistence, "saved Paperless restart proof");
    const dated = (date: unknown): boolean => typeof date === "string" && !Number.isNaN(Date.parse(date));
    if (appId !== "paperless-ngx" || value.stage !== "applied"
      || value.paperlessDocument?.stage !== "passed"
      || !["awaiting-stop", "stopped", "restarted", "accepted", "stale"].includes(proof.stage)
      || proof.documentId !== value.paperlessDocument.documentId
      || proof.imageSha256 !== value.paperlessDocument.imageSha256
      || !dated(proof.startedAt)
      || (["stopped", "restarted", "accepted", "stale"].includes(proof.stage) !== dated(proof.stoppedAt))
      || (["restarted", "accepted", "stale"].includes(proof.stage) !== dated(proof.restartedAt))
      || (["accepted", "stale"].includes(proof.stage) !== dated(proof.acceptedAt))
      || (proof.cleanup !== undefined && !["pending", "trashed"].includes(proof.cleanup))
      || (proof.cleanup !== undefined && !["accepted", "stale"].includes(proof.stage))
      || ((proof.cleanup === "trashed") !== dated(proof.cleanedAt))) {
      fail("saved Paperless restart proof does not match the exact document and project");
    }
  }
  if (value.persistence !== undefined) {
    const proof = record(value.persistence, "saved Immich persistence proof");
    const stage = proof.stage;
    const timestamp = (date: unknown): boolean => typeof date === "string"
      && !Number.isNaN(Date.parse(date));
    if (appId !== "immich" || value.stage !== "applied" || value.onboardingStage !== "closed"
      || value.photoCheck?.status !== "passed"
      || !["uploaded", "awaiting-stop", "stopped", "restarted", "accepted", "stale"].includes(stage)
      || typeof proof.assetId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.assetId)
      || typeof proof.imageSha256 !== "string" || !digestPattern.test(proof.imageSha256)
      || !timestamp(proof.startedAt)
      || (["stopped", "restarted", "accepted", "stale"].includes(stage) !== timestamp(proof.stoppedAt))
      || (["restarted", "accepted", "stale"].includes(stage) !== timestamp(proof.restartedAt))
      || (["accepted", "stale"].includes(stage) !== timestamp(proof.acceptedAt))
      || (proof.cleanup !== undefined
        && (!["accepted", "stale"].includes(stage) || !["pending", "trashed"].includes(proof.cleanup)))) {
      fail("saved Immich restart proof does not match the exact closed project");
    }
  }
  return value as MultiAppState;
}

async function ensurePrivateDirectory(path: string, label: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await checkExistingParent(path, label);
}

async function ensurePrivateIgnore(root: string): Promise<void> {
  const path = join(root, ".selfhost", ".gitignore");
  try {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile("*\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
      || (metadata.mode & 0o077) !== 0) fail("existing .selfhost/.gitignore is not owner-only");
  }
}

async function writeState(state: AppState | MultiAppState, first: boolean): Promise<void> {
  const path = statePath(state.projectRoot, state.appId);
  const parent = stateDirectory(state.projectRoot);
  const temporary = join(parent, `.${state.appId}.${randomUUID()}.tmp`);
  if (first) await requireAbsent(path, "app state");
  else {
    const saved = state.schemaVersion === 1
      ? await readState(state.projectRoot, state.appId)
      : await readMultiState(state.projectRoot, state.appId);
    if (!saved) fail("app state disappeared during update");
  }
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (first) {
    try {
      await link(temporary, path);
    } finally {
      await unlink(temporary);
    }
    return;
  }
  await rename(temporary, path);
}

function approvalFor(value: { appId: string; projectRoot: string; image: string; port: number;
  recipeSha256: string; dockerContext: string; dataDirectory: string; networkName: string;
  homarrNetwork?: string }): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1, ...value })).digest("hex");
  return `APP-APPLY:${value.appId}:${digest}`;
}

function lifecycleApproval(state: AppState, action: "up" | "down"): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1, action,
    appId: state.appId, projectRoot: state.projectRoot, projectId: state.projectId,
    recipeSha256: state.recipeSha256, image: state.image, port: state.port,
    dockerContext: state.dockerContext, composeTarget: state.composeTarget,
    originalApproval: state.approval })).digest("hex");
  return `APP-${action.toUpperCase()}:${state.appId}:${digest}`;
}

function multiApprovalFor(value: { appId: string; projectRoot: string; images: Record<string, string>;
  port: number; recipeSha256: string; dockerContext: string; dataDirectory: string;
  networkName: string; uid: number; gid: number; timezone?: string; homarrNetwork?: string;
  accountIdentity?: { email: string; name: string } }): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2, ...value })).digest("hex");
  return `APP-APPLY:${value.appId}:${digest}`;
}

function multiLifecycleApproval(state: MultiAppState, action: "up" | "down"): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2, action,
    appId: state.appId, projectRoot: state.projectRoot, projectId: state.projectId,
    recipeSha256: state.recipeSha256, images: state.images, port: state.port,
    dockerContext: state.dockerContext, composeTarget: state.composeTarget,
    originalApproval: state.approval })).digest("hex");
  return `APP-${action.toUpperCase()}:${state.appId}:${digest}`;
}

function multiOnboardApproval(state: MultiAppState): string {
  if (state.onboarding.kind !== "api-first-admin") fail("this app does not use API first-admin onboarding");
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2, action: "onboard",
    appId: state.appId, projectRoot: state.projectRoot, projectId: state.projectId,
    recipeSha256: state.recipeSha256, originalApproval: state.approval,
    composeTarget: state.composeTarget, email: state.onboarding.email,
    name: state.onboarding.name, username: state.onboarding.username,
    passwordFile: join(dirname(state.composeTarget), "secrets", state.onboarding.fileId) })).digest("hex");
  return `APP-ONBOARD:${state.appId}:${digest}`;
}

function multiHomarrOnboardApproval(state: MultiAppState): string {
  if (state.appId !== "homarr" || state.onboarding.kind !== "manual-first-admin") {
    fail("this app does not use Homarr API onboarding");
  }
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2, action: "homarr-onboard",
    appId: state.appId, projectRoot: state.projectRoot, projectId: state.projectId,
    recipeSha256: state.recipeSha256, images: state.images, port: state.port,
    dockerContext: state.dockerContext, originalApproval: state.approval,
    composeTarget: state.composeTarget, username: state.onboarding.username,
    passwordFile: join(dirname(state.composeTarget), "secrets", state.onboarding.fileId),
    apiKeyFile: join(dirname(state.composeTarget), "secrets", "homarr-api-key"),
    boardName: "personal" })).digest("hex");
  return `APP-ONBOARD:homarr:${digest}`;
}

function multiProwlarrOnboardApproval(state: MultiAppState): string {
  if (state.appId !== "prowlarr" || state.onboarding.kind !== "manual-first-admin") {
    fail("this app does not use Prowlarr API onboarding");
  }
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2,
    action: "prowlarr-onboard", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, recipeSha256: state.recipeSha256,
    images: state.images, dockerContext: state.dockerContext, port: state.port,
    originalApproval: state.approval, composeTarget: state.composeTarget,
    username: state.onboarding.username,
    passwordFile: join(dirname(state.composeTarget), "secrets", state.onboarding.fileId),
    apiKeyFile: prowlarrKeyPath(state),
    stage: state.prowlarrSetup?.stage ?? "pending" })).digest("hex");
  return `APP-ONBOARD:prowlarr:${digest}`;
}

function multiPhotoCheckApproval(state: MultiAppState): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2,
    action: "photo-check", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, recipeSha256: state.recipeSha256,
    originalApproval: state.approval, composeTarget: state.composeTarget,
    email: state.onboarding.email, passwordFile: join(dirname(state.composeTarget), "secrets", state.onboarding.fileId),
  })).digest("hex");
  return `APP-PHOTO-CHECK:${state.appId}:${digest}`;
}

function multiDocumentCheckApproval(state: MultiAppState): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2,
    action: "document-check", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, recipeSha256: state.recipeSha256,
    originalApproval: state.approval, composeTarget: state.composeTarget,
    passwordFile: join(dirname(state.composeTarget), "secrets", state.onboarding.fileId),
    generation: state.paperlessGeneration ?? 0, check: state.paperlessDocument,
  })).digest("hex");
  return `APP-DOCUMENT-CHECK:${state.appId}:${digest}`;
}

function paperlessCanaryTitle(projectId: string, generation: number): string {
  const base = `Selfhost OCR Check ${projectId}`;
  if (generation === 0) return base;
  return `${base} ${generation}`;
}

function multiPaperlessRenewApproval(state: MultiAppState): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2,
    action: "document-renew", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, recipeSha256: state.recipeSha256,
    originalApproval: state.approval, composeTarget: state.composeTarget,
    generation: state.paperlessGeneration ?? 0,
    history: state.paperlessProofHistory ?? [],
    document: state.paperlessDocument, proof: state.paperlessPersistence,
  })).digest("hex");
  return `APP-DOCUMENT-RENEW:${state.appId}:${digest}`;
}

function multiPaperlessPersistenceApproval(state: MultiAppState,
  action: "persistence-start" | "persistence-finish"): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2, action,
    appId: state.appId, projectRoot: state.projectRoot, projectId: state.projectId,
    recipeSha256: state.recipeSha256, originalApproval: state.approval,
    composeTarget: state.composeTarget, document: state.paperlessDocument,
    proof: state.paperlessPersistence,
  })).digest("hex");
  const prefix = action === "persistence-start" ? "APP-PERSISTENCE-START" : "APP-PERSISTENCE-FINISH";
  return `${prefix}:${state.appId}:${digest}`;
}

function multiPaperlessCleanupApproval(state: MultiAppState): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2,
    action: "document-cleanup", method: "recoverable-trash", appId: state.appId,
    projectRoot: state.projectRoot, projectId: state.projectId,
    recipeSha256: state.recipeSha256, originalApproval: state.approval,
    composeTarget: state.composeTarget, document: state.paperlessDocument,
    proof: state.paperlessPersistence,
  })).digest("hex");
  return `APP-DOCUMENT-CLEANUP:${state.appId}:${digest}`;
}

function multiPersistenceApproval(state: MultiAppState, action: "persistence-start" | "persistence-finish"): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2, action,
    appId: state.appId, projectRoot: state.projectRoot, projectId: state.projectId,
    recipeSha256: state.recipeSha256, originalApproval: state.approval,
    composeTarget: state.composeTarget, email: state.onboarding.email,
    photoCheck: state.photoCheck, proof: state.persistence,
  })).digest("hex");
  const prefix = action === "persistence-start" ? "APP-PERSISTENCE-START" : "APP-PERSISTENCE-FINISH";
  return `${prefix}:${state.appId}:${digest}`;
}

function multiClosureApproval(state: MultiAppState, evidence: RecordValue): string {
  if (state.onboarding.kind !== "api-first-admin") fail("this app has no API setup closure");
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 2,
    action: "close-setup", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, recipeSha256: state.recipeSha256,
    originalApproval: state.approval, email: state.onboarding.email,
    setupEnvironment: state.onboarding.setupEnvironment, nextValue: "false",
    project: evidence.project, ports: evidence.ports, paths: evidence.paths,
    networks: evidence.networks })).digest("hex");
  return `APP-CLOSE-SETUP:${state.appId}:${digest}`;
}

function credentialPath(root: string, appId: string): string {
  return join(root, ".selfhost", "credentials", `${appId}.env`);
}

function credentialPrefix(appId: string): string {
  return appId.toUpperCase().replaceAll("-", "_");
}

function accountApproval(state: AppState, username: string, adoptExisting: boolean): string {
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(username)) {
    fail("--username must be 1-32 letters, digits, dots, underscores, or hyphens");
  }
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1,
    action: "account-prepare", appId: state.appId, projectRoot: state.projectRoot,
    originalApproval: state.approval, username, adoptExisting,
    credentialRef: credentialPath(state.projectRoot, state.appId) })).digest("hex");
  return `APP-ACCOUNT:${state.appId}:${digest}`;
}

function uptimeOnboardApproval(state: AppState): string {
  if (state.appId !== "uptime-kuma" || !state.credentialRef || !state.accountUsername) {
    fail("Uptime Kuma onboarding needs a prepared exact first-owner credential");
  }
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1,
    action: "onboard", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, originalApproval: state.approval, image: state.image,
    credentialRef: state.credentialRef, username: state.accountUsername,
    stage: state.uptimeSetup?.stage ?? "pending",
    databaseStage: state.uptimeDatabaseSetup?.stage ?? "pending" })).digest("hex");
  return `APP-ONBOARD:uptime-kuma:${digest}`;
}

function uptimeMonitorApproval(state: AppState, monitor: { id: number; identity: string }): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1,
    action: "monitor-check", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, originalApproval: state.approval,
    monitorId: monitor.id, identity: monitor.identity,
    priorStage: state.uptimeMonitor?.stage ?? "unrecorded",
    baselineIdentity: state.uptimeMonitor?.identity ?? null })).digest("hex");
  return `APP-MONITOR:uptime-kuma:${digest}`;
}

function uptimeSelfMonitorName(projectId: string): string {
  return `Self-host local check (${projectId})`;
}

function uptimeSelfMonitorApproval(state: AppState,
  monitor: { id: number; identity: string } | null): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1,
    action: "monitor-create", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, originalApproval: state.approval,
    upstreamVersion: uptimeSelfMonitorVersion,
    config: uptimeSelfMonitorConfig(uptimeSelfMonitorName(state.projectId)),
    checkpoint: state.uptimeSelfMonitor ?? null,
    existing: monitor ? { id: monitor.id, identity: monitor.identity } : null,
  })).digest("hex");
  return `APP-MONITOR-CREATE:uptime-kuma:${digest}`;
}

function uptimeStatusPageApproval(state: AppState, monitor: { id: number; identity: string },
  page: { exists: boolean; exact: boolean; groupCount: number; monitorIds: number[] }): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1,
    action: "status-page-create", appId: state.appId, projectRoot: state.projectRoot,
    projectId: state.projectId, originalApproval: state.approval, image: state.image,
    bridge: state.homarrNetwork, monitor: { id: monitor.id, identity: monitor.identity },
    slug: uptimeStatusPageSlug, title: uptimeStatusPageTitle, group: uptimeStatusPageGroup,
    checkpoint: state.uptimeStatusPage ?? null, page,
  })).digest("hex");
  return `APP-STATUS-PAGE:uptime-kuma:${digest}`;
}

function uptimeMonitorSummary(monitor: { id: number; name: string; status: string;
  lastBeatId: number | null }): { id: number; name: string; status: string;
    lastBeatId: number | null } {
  return { id: monitor.id, name: monitor.name, status: monitor.status,
    lastBeatId: monitor.lastBeatId };
}

async function inspectCredential(path: string): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0
    || metadata.size < 24 || metadata.size > 4096) {
    fail("app credential file must be one bounded current-user-owned mode-0600 regular file");
  }
  return true;
}

function homarrKeyPath(state: MultiAppState): string {
  return join(dirname(state.composeTarget), "secrets", "homarr-api-key");
}

function validHomarrApiKey(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= 496
    && /^[A-Za-z0-9_-]{1,192}\.[A-Za-z0-9_-]{16,400}$/.test(value);
}

async function savedHomarrApiKey(state: MultiAppState): Promise<string | null> {
  const path = homarrKeyPath(state);
  if (!await inspectCredential(path)) return null;
  const value = await readFile(path, "utf8");
  if (!validHomarrApiKey(value)) fail("saved Homarr API key has an unexpected format");
  return value;
}

async function persistHomarrApiKey(state: MultiAppState, value: string): Promise<void> {
  if (!validHomarrApiKey(value)) fail("Homarr returned an invalid API key format");
  const path = homarrKeyPath(state);
  await checkExistingParent(dirname(path), "Homarr private credential parent");
  const existing = await savedHomarrApiKey(state);
  if (existing !== null) {
    if (existing !== value) fail("a different Homarr API key is already saved; inspect before recovery");
    return;
  }
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!await inspectCredential(path)) fail("Homarr API key was not persisted privately");
}

function prowlarrKeyPath(state: MultiAppState): string {
  return join(dirname(state.composeTarget), "secrets", "prowlarr-api-key");
}

async function savedProwlarrApiKey(state: MultiAppState): Promise<string | null> {
  const path = prowlarrKeyPath(state);
  if (!await inspectCredential(path)) return null;
  const value = await readFile(path, "utf8");
  if (!/^[0-9a-f]{32}$/.test(value)) fail("saved Prowlarr API key has an unexpected format");
  return value;
}

async function persistProwlarrApiKey(state: MultiAppState, value: string): Promise<void> {
  if (!/^[0-9a-f]{32}$/.test(value)) fail("Prowlarr returned an invalid API key format");
  const path = prowlarrKeyPath(state);
  await checkExistingParent(dirname(path), "Prowlarr private credential parent");
  const existing = await savedProwlarrApiKey(state);
  if (existing !== null) {
    if (existing !== value) fail("a different Prowlarr API key is already saved; inspect before recovery");
    return;
  }
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!await inspectCredential(path)) fail("Prowlarr API key was not persisted privately");
}

async function credentialEnv(path: string, state: AppState, username: string): Promise<string> {
  const value = await readFile(path, "utf8");
  const lines = value.trimEnd().split("\n");
  const prefix = credentialPrefix(state.appId);
  if (lines.length !== 3 || lines[0] !== `${prefix}_USERNAME=${username}`
    || !lines[1].startsWith(`${prefix}_PASSWORD=`)
    || !/^[^\r\n]+$/.test(lines[1].slice(`${prefix}_PASSWORD=`.length))
    || lines[2] !== `${prefix}_URL=http://127.0.0.1:${state.port}`) {
    fail("app credential file does not match the expected owner-only handoff");
  }
  return value;
}

function dockerText(args: string[], label: string): string {
  const result = spawnSync("docker", args, {
    encoding: "utf8", timeout: 30_000, maxBuffer: outputLimit,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail(`${label} failed; child output was suppressed`);
  return result.stdout.trim();
}

function dockerObject(args: string[], label: string): RecordValue {
  const output = dockerText(args, label);
  try {
    return record(JSON.parse(output), label);
  } catch {
    fail(`${label} returned invalid JSON`);
  }
}

function observedRecipeVolumes(recipe: RecordValue, projectId: string, dockerContext: string): RecordValue[] {
  const mounts = recipe.services.flatMap((service: RecordValue) =>
    service.mounts.filter((mount: RecordValue) => mount.kind === "volume"));
  if (mounts.length === 0) return [];
  if (mounts.length > 32) fail("recipe names too many Docker volumes for bounded inspection");
  const result: RecordValue[] = [];
  for (const mount of mounts) {
    const name = `${projectId}-${mount.name}`;
    const listed = dockerText(["--context", dockerContext, "volume", "ls", "--filter", `name=${name}`,
      "--format", "{{.Name}}"], "exact app volume inventory");
    if (!listed.split("\n").includes(name)) continue;
    const volume = dockerObject(["--context", dockerContext, "volume", "inspect", name,
      "--format", "{{json .}}"], "exact app volume inspection");
    const labels = volume.Labels === null ? {} : record(volume.Labels, "exact app volume labels");
    if (volume.Name !== name || typeof volume.Driver !== "string"
      || !/^[A-Za-z0-9_.-]{1,64}$/.test(volume.Driver)) {
      fail("exact app volume inspection returned a different name or invalid driver");
    }
    const owner = labels["io.selfhost.project"] === projectId ? projectId : "external";
    result.push({ name, driver: volume.Driver, owner, labels: {
      "com.docker.compose.project": labels["com.docker.compose.project"] ?? null,
      "com.docker.compose.volume": labels["com.docker.compose.volume"] ?? null,
      "io.selfhost.project": labels["io.selfhost.project"] ?? null,
      "io.selfhost.volume": labels["io.selfhost.volume"] ?? null,
    } });
  }
  return result;
}

export function pinnedImageFromManifest(imageTag: string, architecture: string, manifest: RecordValue,
  configPlatform?: VerifiedImagePlatform): RecordValue {
  if (manifest.schemaVersion !== 2
    || !["application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json"].includes(manifest.mediaType)
    || typeof manifest.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(manifest.digest)) {
    fail("catalog image registry did not provide one immutable multi-platform index or image manifest");
  }
  const image = pinRecipeImage(imageTag, manifest.digest);
  if (["application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json"].includes(manifest.mediaType)) {
    if (!configPlatform || configPlatform.configDigest !== manifest.config?.digest
      || configPlatform.os !== "linux" || configPlatform.architecture !== architecture) {
      fail("catalog image has no digest-verified Linux configuration for this host architecture", "image-platform-unavailable");
    }
    return { image, indexDigest: null, manifestDigest: manifest.digest,
      platformDigest: manifest.digest, configDigest: configPlatform.configDigest };
  }
  if (!Array.isArray(manifest.manifests)) fail("catalog image registry did not provide one immutable multi-platform index");
  const matches = manifest.manifests.filter((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const platform = (entry as RecordValue).platform;
    return platform && typeof platform === "object" && !Array.isArray(platform)
      && platform.os === "linux" && platform.architecture === architecture
      && typeof (entry as RecordValue).digest === "string"
      && /^sha256:[0-9a-f]{64}$/.test((entry as RecordValue).digest);
  });
  if (matches.length !== 1) fail("catalog image has no unique Linux manifest for this host architecture", "image-platform-unavailable");
  return { image, indexDigest: manifest.digest,
    platformDigest: matches[0].digest };
}

async function inspectRegistryImage(imageTag: string, raw: boolean): Promise<string> {
  const argumentsList = ["buildx", "imagetools", "inspect", imageTag];
  if (raw) argumentsList.push("--raw");
  else argumentsList.push("--format", "{{json .Manifest}}");
  const output = await new Promise<string>((resolveOutput, rejectOutput) => {
    execFile("docker", argumentsList,
    { encoding: "utf8", timeout: 30_000, maxBuffer: outputLimit }, (error, stdout, stderr) => {
      if (error) {
        let cause = "registry lookup failed";
        let remedy = "check Docker Buildx and registry access";
        if (/\b429\b|too many requests|toomanyrequests/i.test(stderr)) {
          cause = "registry rate limit reached";
          remedy = "wait for the registry limit to reset or authenticate Docker with your own registry account, then retry the same reviewed plan";
        }
        if (error.killed) cause = "registry lookup timed out";
        rejectOutput(new AppCommandError(`${imageTag}: ${cause}; ${remedy}`, "image-resolution-failed"));
        return;
      }
      resolveOutput(stdout);
    });
  });
  return output;
}

/** Registry resolution stays read-only; single-image platform evidence is bound
 * to exact manifest and config bytes, never a fabricated multi-platform index. */
export async function resolveImageTag(imageTag: string, architecture: string,
  inspect: (reference: string, raw: boolean) => Promise<string> = inspectRegistryImage,
  request: typeof fetch = fetch): Promise<RecordValue> {
  if (!isRecipeImageReference(imageTag)) fail("catalog image needs a reviewed fixed tag or immutable digest");
  const output = await inspect(imageTag, false);
  let manifest: RecordValue;
  try {
    manifest = record(JSON.parse(output), "catalog image manifest");
  } catch {
    fail("catalog image manifest was not valid JSON");
  }
  if (["application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json"].includes(manifest.mediaType)) {
    const immutableImage = pinRecipeImage(imageTag, manifest.digest);
    const raw = await inspect(immutableImage, true);
    if (Buffer.byteLength(raw) > outputLimit
      || `sha256:${createHash("sha256").update(raw).digest("hex")}` !== manifest.digest) {
      fail("catalog image raw manifest differs from its immutable registry digest");
    }
    let imageManifest: RecordValue;
    try { imageManifest = record(JSON.parse(raw), "catalog image raw manifest"); }
    catch { fail("catalog image raw manifest was not valid JSON"); }
    if (imageManifest.mediaType !== manifest.mediaType || imageManifest.schemaVersion !== 2
      || !imageManifest.config || typeof imageManifest.config !== "object" || Array.isArray(imageManifest.config)) {
      fail("catalog image raw manifest does not match its registry descriptor");
    }
    const configPlatform = await fetchPublicRegistryImageConfig(immutableImage, imageManifest.config, request);
    return pinnedImageFromManifest(imageTag, architecture, { ...imageManifest, digest: manifest.digest }, configPlatform);
  }
  return pinnedImageFromManifest(imageTag, architecture, manifest);
}

async function resolveImage(appId: string, derivedRecipe?: RecordValue): Promise<RecordValue> {
  // Only the bundled, owner-reviewed derived-recipe path supplies this override.
  // No CLI flag imports an executable recipe or replaces catalog metadata.
  let info: ReturnType<typeof recipeFor>;
  if (derivedRecipe !== undefined) {
    if (derivedRecipe.appId !== appId || derivedRecipe.schemaVersion !== 2
      || derivedRecipe.kind !== "multi-service-compose" || !Array.isArray(derivedRecipe.services)
      || derivedRecipe.services.length < 1 || derivedRecipe.services.some((service: RecordValue) =>
        typeof service.id !== "string" || typeof service.imageTag !== "string")) {
      fail("derived image resolution needs one bundled, reviewed multi-service recipe");
    }
    info = { recipe: derivedRecipe, services: derivedRecipe.services, defaults: derivedRecipe.defaults,
      storage: derivedRecipe.storage, appPurpose: "Owner-derived application recipe", boundedApply: true,
      recipeSha256: createHash("sha256").update(JSON.stringify(derivedRecipe)).digest("hex") };
  } else info = recipeFor(appId, false);
  const architecture = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
  if (!architecture) fail("app image supports only x64 and ARM64 hosts");
  if (info.recipe.schemaVersion === 2) {
    const images: RecordValue[] = [];
    for (let index = 0; index < info.services.length; index += 3) {
      const batch = info.services.slice(index, index + 3);
      images.push(...await Promise.all(batch.map(async (service) => ({ service: service.id,
        ...await resolveImageTag(service.imageTag, architecture) }))));
    }
    let source = "Docker Buildx registry manifests; multi-service apply requires separate approval and application acceptance remains unverified";
    if (!info.boundedApply) {
      source = "Docker Buildx registry manifests; this recipe is read-only and cannot be applied by the bounded app installer";
    }
    return { schemaVersion: 1, command: "app image", appId, status: "resolved-read-only",
      mutation: false, images, platform: `linux/${architecture}`,
      recipeSha256: info.recipeSha256, boundedApply: info.boundedApply, maturity: "experimental",
      source };
  }
  const resolved = await resolveImageTag(info.service.imageTag, architecture);
  return { schemaVersion: 1, command: "app image", appId, status: "resolved",
    mutation: false, image: resolved.image,
    indexDigest: resolved.indexDigest, platform: `linux/${architecture}`,
    platformDigest: resolved.platformDigest, recipeSha256: info.recipeSha256,
    boundedApply: info.boundedApply,
    source: "Docker Buildx registry manifest; single-image configuration is publicly digest-verified; inspect the exact plan before apply" };
}

function inspectAppRuntime(state: AppState): { state: string; health: string } {
  const rows = dockerText(["--context", state.dockerContext, "compose", "--project-name", state.projectId,
    "--file", state.composeTarget, "ps", "--all", "--format", "json"], "exact app Compose inventory")
    .split("\n").filter(Boolean);
  if (rows.length !== 1) fail("app lifecycle needs exactly one existing owned service container");
  let container: RecordValue;
  try {
    container = record(JSON.parse(rows[0]), "app Compose service");
  } catch {
    fail("app Compose inventory returned invalid JSON");
  }
  if (container.Project !== state.projectId || container.Service !== state.appId
    || container.Image !== state.image || typeof container.ID !== "string"
    || !/^[0-9a-f]{12,64}$/.test(container.ID)
    || !["running", "exited", "created"].includes(container.State)) {
    fail("app service identity differs from the saved exact project");
  }
  const labels = dockerObject(["--context", state.dockerContext, "inspect", "--type", "container",
    container.ID, "--format", "{{json .Config.Labels}}"], "app container labels");
  if (labels["com.docker.compose.project"] !== state.projectId
    || labels["com.docker.compose.service"] !== state.appId
    || labels["com.docker.compose.project.config_files"] !== state.composeTarget
    || labels["com.docker.compose.project.working_dir"] !== dirname(state.composeTarget)) {
    fail("app container ownership labels differ from the saved exact project");
  }
  if (state.homarrNetwork && container.State === "running") {
    const memberships = dockerObject(["--context", state.dockerContext, "inspect", "--type", "container",
      container.ID, "--format", "{{json .NetworkSettings.Networks}}"], "app network membership");
    if (JSON.stringify(Object.keys(memberships).sort())
      !== JSON.stringify([`${state.projectId}-private`, state.homarrNetwork].sort())) {
      fail("app network membership differs from the approved Homarr bridge");
    }
  }
  const network = dockerObject(["--context", state.dockerContext, "network", "inspect",
    `${state.projectId}-private`, "--format", "{{json .Labels}}"], "app network labels");
  if (network["com.docker.compose.project"] !== state.projectId
    || network["com.docker.compose.network"] !== "private") {
    fail("app network ownership labels differ from the saved exact project");
  }
  if (state.homarrNetwork) {
    const bridge = dockerObject(["--context", state.dockerContext, "network", "inspect",
      state.homarrNetwork, "--format", "{{json .}}"], "saved Homarr bridge");
    if (bridge.Name !== state.homarrNetwork || bridge.Driver !== "bridge" || bridge.Internal !== false
      || bridge.Labels?.["com.docker.compose.project"] !== projectIdFor(state.projectRoot, "homarr")
      || bridge.Labels?.["com.docker.compose.network"] !== "private") {
      fail("saved Homarr bridge ownership changed; do not treat this app as connected");
    }
  }
  return { state: container.State as string, health: typeof container.Health === "string" ? container.Health : "unknown" };
}

function requireLocalDockerContext(context: string): void {
  const result = spawnSync("docker", ["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail("Docker context endpoint could not be checked before app apply");
  let endpoint: unknown;
  try {
    endpoint = JSON.parse(result.stdout.trim());
  } catch {
    fail("Docker context endpoint was not a JSON string");
  }
  const local = context === "default" ? "unix:///var/run/docker.sock"
    : `unix:///run/user/${process.getuid?.()}/docker.sock`;
  if (endpoint !== local) fail("app apply requires a local Linux Docker socket matching the inspected host", "docker-context-mismatch");
}

async function applySaved(state: AppState): Promise<void> {
  const owner = createSelfhostComposeOwner(state.manifest);
  const plan = await owner.plan();
  if (plan.render.target !== state.composeTarget) fail("saved app project no longer matches its exact Compose plan");
  await ensurePrivateDirectory(state.dataDirectory, "app data directory");
  await owner.render(plan);
  state.stage = "rendered";
  await writeState(state, false);
  await owner.apply(plan);
  state.stage = "applied";
  state.lastLifecycle = "running";
  await writeState(state, false);
}

async function checkExistingParent(path: string, label: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
      || (metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.()) {
      fail(`${label} must be a current-user-owned, owner-only real directory (0700)`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function checkDataParent(path: string, fallback: string): Promise<void> {
  if (path === fallback) {
    await checkExistingParent(path, "app data parent");
    return;
  }
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      fail("custom app data parent must already exist; create and review it before planning");
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
    || metadata.uid !== process.getuid?.() || (metadata.mode & 0o300) !== 0o300
    || (metadata.mode & 0o022) !== 0) {
    fail("custom app data parent must be a real current-user-owned writable directory, not writable by other users");
  }
}

async function existingDataAncestor(dataRoot: string): Promise<string> {
  let candidate = dataRoot;
  for (;;) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) fail("Unable to locate an existing data-path ancestor");
    candidate = parent;
  }
}

function hostReport(root: string, dataAncestor: string, port: number): RecordValue {
  const script = runtimeFile("./workflows/selfhost-host/scripts/inspect-host.sh",
    "../../../.agents/skills/self-host/workflows/selfhost-host/scripts/inspect-host.sh", "bounded host inspector");
  const paths = dataAncestor === root ? ["--path", root] : ["--path", root, "--path", dataAncestor];
  return runJson("bash", [script, ...paths, "--check-tcp-port", String(port), "--limit", "128"], "bounded host inspection");
}

function observedBind(value: string): string {
  if (value === "0.0.0.0" || value === "::" || value === "*") return "*";
  const address = value.split("%", 1)[0];
  if (isIP(address) === 0) fail("host listener inventory has an invalid bind address");
  return address;
}

function observation(report: RecordValue, root: string, dataAncestor: string, port: number, projectId: string, networkName: string, minimumFreeBytes: number) {
  if (report.schemaVersion !== 1 || report.mode !== "read-only") fail("host inspector did not return read-only evidence");
  const runtime = record(report.runtime, "host runtime");
  const docker = record(runtime.docker, "host Docker state");
  const context = record(runtime.dockerContext, "host Docker context");
  const identity = record(report.identity, "host identity");
  const workloads = record(report.workloads, "host workloads");
  const containers = record(workloads.containers, "host containers");
  const networks = record(workloads.dockerNetworks, "host Docker networks");
  const network = record(report.network, "host network");
  const listeners = record(network.listeningPorts, "host listeners");
  const selected = record(network.selectedTcpPorts, "selected host port");
  const storage = record(report.storage, "host storage");
  if (docker.state !== "running" || context.state !== "observed"
    || !["default", "rootless"].includes(context.current)
    || identity.uid !== process.getuid?.() || identity.gid !== process.getgid?.()
    || containers.state !== "observed" || containers.truncated !== false || !Array.isArray(containers.items)
    || networks.state !== "observed" || networks.truncated !== false || !Array.isArray(networks.items)
    || listeners.state !== "observed" || !Array.isArray(listeners.items)
    || selected.state !== "observed" || selected.complete !== true || !Array.isArray(selected.items)
    || !Array.isArray(storage.paths)) fail("host facts are incomplete; inspect Docker, networks, listeners, identity and storage before planning");
  for (const item of containers.items) {
    const container = record(item, "host container");
    const name = container.name;
    if (typeof name !== "string" || name === projectId || name.startsWith(`${projectId}-`)) {
      fail("the proposed Compose project has an existing or unidentifiable container");
    }
    const published = container.publishedPorts;
    if (published !== null && typeof published !== "string") fail("host container port inventory is invalid");
    if (typeof published === "string" && new RegExp(`(?:^|[^0-9])${port}->`).test(published)) {
      fail("a Docker container already publishes the selected TCP port", "port-unavailable");
    }
  }
  const observedNetworks = networks.items.map((item: unknown) => {
    const name = record(item, "host Docker network").name;
    if (typeof name !== "string" || !name) fail("host network inventory has an invalid name");
    return { name, owner: "external" };
  });
  if (observedNetworks.some((item) => item.name === networkName)) fail("the proposed Compose network already exists");
  if (selected.items.length !== 1) fail("host inspector did not check exactly one selected TCP port");
  const checked = record(selected.items[0], "selected TCP port");
  if (checked.port !== port || checked.inUse !== false) fail("the selected TCP port is occupied or not fully observed", "port-unavailable");
  const observedPorts = listeners.items.map((item: unknown) => {
    const entry = record(item, "host listener");
    const protocol = entry.protocol === "tcp6" ? "tcp" : entry.protocol === "udp6" ? "udp" : entry.protocol;
    const published = Number(entry.port);
    if ((protocol !== "tcp" && protocol !== "udp") || typeof entry.port !== "string"
      || !/^\d{1,5}$/.test(entry.port) || !Number.isInteger(published)
      || published < 1 || published > 65535 || typeof entry.bind !== "string") fail("host listener inventory is invalid");
    return { hostIp: observedBind(entry.bind), published, protocol, owner: "external" };
  });
  if (observedPorts.some((entry) => entry.protocol === "tcp" && entry.published === port)) {
    fail("listener inventory contradicts the selected TCP port check");
  }
  // The selected-port probe is complete even when the general listener list
  // truncates. Compose needs observations for its requested port, not every
  // unrelated listener on this host.
  const relevantPorts = observedPorts.filter((entry) => entry.published === port);
  const rootPath = storage.paths.find((item: unknown) => record(item, "inspected storage path").path === root);
  const dataPath = storage.paths.find((item: unknown) => record(item, "inspected storage path").path === dataAncestor);
  if (!rootPath || !dataPath) fail("host inspector did not inspect both selected storage paths");
  const inspectedRoot = record(rootPath, "inspected project root");
  const inspectedPath = record(dataPath, "inspected app data ancestor");
  for (const [path, minimum] of [[inspectedRoot, 1024 * 1024], [inspectedPath, minimumFreeBytes]] as const) {
    if (path.exists !== true || path.directory !== true || path.symlink !== false
      || path.writableByInspector !== true || path.networkFilesystem !== false
      || path.readOnlyMount !== false || !Number.isSafeInteger(path.availableBytes)
      || path.availableBytes < minimum || !Number.isSafeInteger(path.availableInodes)
      || path.availableInodes < 1) fail("project or app data storage lacks observed local writable capacity for the recipe", "storage-unavailable");
  }
  return {
    dockerContext: context.current as string,
    checkedAt: new Date().toISOString(),
    ports: relevantPorts,
    paths: [],
    networks: observedNetworks,
    storage: { dataAncestor, filesystemType: inspectedPath.filesystemType as string | null,
      availableBytes: inspectedPath.availableBytes as number },
  };
}

function assertMultiStateRecipe(state: MultiAppState, selected: ReturnType<typeof recipeFor>): void {
  if (selected.recipe.schemaVersion !== 2 || selected.recipeSha256 !== state.recipeSha256
    || state.uid !== process.getuid?.() || state.gid !== process.getgid?.()) {
    fail("multi-service recipe or host identity changed; stop for migration review");
  }
  pinnedMultiServiceImages(selected.recipe,
    Object.entries(state.images).map(([id, image]) => `${id}=${image}`));
  let expected = multiServiceManifest({ recipe: selected.recipe, images: state.images,
    projectId: state.projectId, appsRoot: join(state.projectRoot, ".selfhost", "apps"),
    projectDirectory: dirname(state.composeTarget), dataDirectory: state.dataDirectory,
    dockerContext: state.dockerContext, port: state.port, uid: state.uid, gid: state.gid,
    timezone: state.timezone,
    homarrNetwork: state.homarrNetwork, observed: state.manifest.observed });
  if (state.onboardingStage === "closing" || state.onboardingStage === "closed") {
    expected = closedImmichManifest(expected, state.manifest.observed);
  }
  const expectedOnboarding = configuredMultiOnboarding(selected.recipe,
    state.onboarding.email ?? null, state.onboarding.name ?? null);
  const approval = multiApprovalFor({ appId: state.appId, projectRoot: state.projectRoot,
    images: state.images, port: state.port, recipeSha256: state.recipeSha256,
    dockerContext: state.dockerContext, dataDirectory: state.dataDirectory,
    networkName: `${state.projectId}-private`, uid: state.uid, gid: state.gid,
    timezone: state.timezone,
    homarrNetwork: state.homarrNetwork,
    accountIdentity: multiAccountIdentity(selected.recipe, expectedOnboarding) });
  if (JSON.stringify(expected) !== JSON.stringify(state.manifest) || approval !== state.approval) {
    fail("multi-service app state differs from its validated recipe or original approval");
  }
  if (JSON.stringify(state.onboarding) !== JSON.stringify(expectedOnboarding)) {
    fail("multi-service app onboarding differs from the validated recipe");
  }
}

function inspectMultiAppRuntime(state: MultiAppState): { state: string; health: string;
  containerIds: Record<string, string> } {
  const rows = dockerText(["--context", state.dockerContext, "compose", "--project-name", state.projectId,
    "--file", state.composeTarget, "ps", "--all", "--format", "json"], "exact multi-service Compose inventory")
    .split("\n").filter(Boolean);
  if (rows.length !== state.manifest.services.length) {
    fail("multi-service lifecycle needs every exact owned service container");
  }
  const expected = new Map(state.manifest.services.map((service: RecordValue) => [service.id, service.image]));
  const observed = new Map<string, RecordValue>();
  for (const row of rows) {
    let container: RecordValue;
    try {
      container = record(JSON.parse(row), "multi-service Compose service");
    } catch {
      fail("multi-service Compose inventory returned invalid JSON");
    }
    if (container.Project !== state.projectId || !expected.has(container.Service)
      || container.Image !== expected.get(container.Service) || observed.has(container.Service)
      || typeof container.ID !== "string" || !/^[0-9a-f]{12,64}$/.test(container.ID)
      || !["running", "exited", "created"].includes(container.State)) {
      fail("multi-service container identity differs from the saved exact project");
    }
    const labels = dockerObject(["--context", state.dockerContext, "inspect", "--type", "container",
      container.ID, "--format", "{{json .Config.Labels}}"], "multi-service container labels");
    if (labels["com.docker.compose.project"] !== state.projectId
      || labels["com.docker.compose.service"] !== container.Service
      || ![state.composeTarget, state.previousComposeTarget].includes(labels["com.docker.compose.project.config_files"])
      || labels["com.docker.compose.project.working_dir"] !== dirname(state.composeTarget)) {
      fail("multi-service container ownership labels differ from the saved exact project");
    }
    if (state.homarrNetwork && container.State === "running") {
      const memberships = dockerObject(["--context", state.dockerContext, "inspect", "--type", "container",
        container.ID, "--format", "{{json .NetworkSettings.Networks}}"], "multi-service network membership");
      const actual = Object.keys(memberships).sort();
      const wanted = container.Service === state.appId
        ? [`${state.projectId}-private`, state.homarrNetwork].sort()
        : [`${state.projectId}-private`];
      if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
        fail("multi-service container network membership differs from the approved frontend-only Homarr bridge");
      }
    }
    observed.set(container.Service, container);
  }
  const network = dockerObject(["--context", state.dockerContext, "network", "inspect",
    `${state.projectId}-private`, "--format", "{{json .Labels}}"], "multi-service network labels");
  if (network["com.docker.compose.project"] !== state.projectId
    || network["com.docker.compose.network"] !== "private") {
    fail("multi-service network ownership labels differ from the saved exact project");
  }
  if (state.homarrNetwork) {
    const external = dockerObject(["--context", state.dockerContext, "network", "inspect",
      state.homarrNetwork, "--format", "{{json .}}"], "exact saved Homarr bridge");
    if (external.Name !== state.homarrNetwork || external.Driver !== "bridge" || external.Internal !== false
      || external.Labels?.["com.docker.compose.project"] !== projectIdFor(state.projectRoot, "homarr")
      || external.Labels?.["com.docker.compose.network"] !== "private") {
      fail("saved Homarr bridge ownership changed; do not treat this app as connected");
    }
  }
  const states = [...observed.values()];
  const runningCount = states.filter((container) => container.State === "running").length;
  let runtimeState = "partial";
  if (runningCount === states.length) runtimeState = "running";
  if (runningCount === 0) runtimeState = "stopped";
  return { state: runtimeState,
    health: states.every((container) => container.Health === "healthy") ? "healthy" : "unverified",
    containerIds: Object.fromEntries([...observed.entries()].map(([id, container]) => [id, container.ID as string])) };
}

async function inspectedStandaloneHomarrNetwork(root: string, dockerContext: string): Promise<string> {
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail("connecting an app to Homarr needs the saved local Docker context without overrides");
  }
  const homarr = await readMultiState(root, "homarr");
  if (!homarr || homarr.stage !== "applied" || homarr.homarrSetup?.stage !== "complete"
    || homarr.dockerContext !== dockerContext) {
    fail("--connect-homarr needs an onboarded standalone Homarr project in this root and Docker context");
  }
  assertMultiStateRecipe(homarr, recipeFor("homarr", false));
  requireLocalDockerContext(dockerContext);
  const runtime = inspectMultiAppRuntime(homarr);
  if (runtime.state !== "running" || !runtime.containerIds.homarr) {
    fail("--connect-homarr needs the exact Homarr container running");
  }
  const name = `${homarr.projectId}-private`;
  const network = dockerObject(["--context", dockerContext, "network", "inspect", name,
    "--format", "{{json .}}"], "exact Homarr bridge");
  if (network.Name !== name || network.Driver !== "bridge" || network.Internal !== false
    || network.Labels?.["com.docker.compose.project"] !== homarr.projectId
    || network.Labels?.["com.docker.compose.network"] !== "private"
    || !network.Containers || typeof network.Containers !== "object"
    || !Object.keys(network.Containers).some((id) => id.startsWith(runtime.containerIds.homarr))) {
    fail("--connect-homarr needs the exact Homarr-owned bridge and container membership");
  }
  return name;
}

async function inspectSavedRuntime(state: AppState | MultiAppState): Promise<{
  state: string; health: string; checkedAt: string }> {
  if (state.stage !== "applied") fail("--live needs a previously applied exact app project", "not-applied");
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail("--live cannot use a Docker connection override for this saved local project", "docker-context-mismatch");
  }
  let selected: ReturnType<typeof recipeFor>;
  if (state.schemaVersion === 2) selected = recipeForSavedMultiState(state);
  else selected = recipeFor(state.appId);
  if (selected.recipeSha256 !== state.recipeSha256) fail("app recipe changed; stop for migration review", "recipe-changed");
  if (state.schemaVersion === 2) {
    assertMultiStateRecipe(state, selected);
  } else {
    const approval = approvalFor({ appId: state.appId, projectRoot: state.projectRoot,
      image: state.image, port: state.port, recipeSha256: state.recipeSha256,
      dockerContext: state.dockerContext, dataDirectory: state.dataDirectory,
      networkName: `${state.projectId}-private`, homarrNetwork: state.homarrNetwork });
    if (approval !== state.approval) fail("single-service app state differs from its original approval", "state-mismatch");
  }
  requireLocalDockerContext(state.dockerContext);
  const owner = createSelfhostComposeOwner(state.manifest);
  const plan = await owner.plan();
  if (plan.render.target !== state.composeTarget) fail("saved app live inspection plan changed");
  await owner.checkRendered(plan);
  let observed: { state: string; health: string };
  if (state.schemaVersion === 2) observed = inspectMultiAppRuntime(state);
  else observed = inspectAppRuntime(state);
  let health = observed.health;
  if (observed.state !== "running") health = "not-running";
  return { state: observed.state, health, checkedAt: new Date().toISOString() };
}

async function inspectImmichClosure(state: MultiAppState): Promise<RecordValue> {
  const runtime = inspectMultiAppRuntime(state);
  if (runtime.state !== "running" || runtime.health !== "healthy") {
    fail("Immich setup closure needs every exact owned service running and healthy");
  }
  const projectDirectory = dirname(state.composeTarget);
  const projectMetadata = await lstat(projectDirectory);
  const dataMetadata = await lstat(state.dataDirectory);
  for (const metadata of [projectMetadata, dataMetadata]) {
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
      || (metadata.mode & 0o077) !== 0) {
      fail("Immich project and data roots must remain owner-only current-user-owned directories");
    }
  }
  if (await realpath(projectDirectory) !== projectDirectory || await realpath(state.dataDirectory) !== state.dataDirectory) {
    fail("Immich project or data root has a symlinked path");
  }
  const networkName = `${state.projectId}-private`;
  const network = dockerObject(["--context", state.dockerContext, "network", "inspect", networkName,
    "--format", "{{json .}}"], "exact Immich network");
  if (network.Name !== networkName || network.Driver !== "bridge" || network.Internal !== false
    || network.Labels?.["com.docker.compose.project"] !== state.projectId
    || network.Labels?.["com.docker.compose.network"] !== "private") {
    fail("Immich closure network does not match the owned private bridge");
  }
  const paths = new Map<string, string>();
  for (const service of state.manifest.services as RecordValue[]) {
    const id = runtime.containerIds[service.id];
    if (!id) fail("Immich closure is missing one exact service container");
    const container = dockerObject(["--context", state.dockerContext, "inspect", "--type", "container",
      id, "--format", "{{json .}}"], "exact Immich container");
    const labels = record(container.Config?.Labels, "Immich container labels");
    if (typeof container.Id !== "string" || !container.Id.startsWith(id)
      || labels["com.docker.compose.project"] !== state.projectId
      || labels["com.docker.compose.service"] !== service.id
      || ![state.composeTarget, state.previousComposeTarget].includes(labels["com.docker.compose.project.config_files"])
      || labels["com.docker.compose.project.working_dir"] !== projectDirectory) {
      fail("Immich closure container is not owned by this exact Compose project");
    }
    const memberships = Object.keys(record(container.NetworkSettings?.Networks, "Immich network membership"));
    const expectedMemberships = service.id === state.appId && state.homarrNetwork
      ? [networkName, state.homarrNetwork].sort() : [networkName];
    if (JSON.stringify(memberships.sort()) !== JSON.stringify(expectedMemberships)) {
      fail("Immich closure container uses an unexpected Docker network");
    }
    if (!Array.isArray(container.Mounts)) fail("Immich closure container mounts are unavailable");
    for (const mount of service.mounts as RecordValue[]) {
      const actual = container.Mounts.find((entry: RecordValue) => entry?.Destination === mount.target);
      if (!actual || actual.Type !== "bind" || actual.Source !== mount.source
        || actual.RW !== !mount.readOnly) {
        fail("Immich closure container mount differs from the approved data path");
      }
      const metadata = await lstat(mount.source);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(mount.source) !== mount.source) {
        fail("Immich closure data path is not a real directory");
      }
      paths.set(mount.source, state.projectId);
    }
    if (service.id === state.appId) {
      const port = service.ports[0];
      const bindings = container.NetworkSettings?.Ports?.[`${port.target}/tcp`];
      if (!Array.isArray(bindings) || bindings.length !== 1
        || bindings[0]?.HostIp !== port.hostIp || bindings[0]?.HostPort !== String(port.published)) {
        fail("Immich closure port binding differs from the approved private address");
      }
    }
  }
  const appService = state.manifest.services.find((service: RecordValue) => service.id === state.appId);
  const published = appService.ports[0];
  return { checkedAt: new Date().toISOString(),
    project: { id: state.projectId, directory: projectDirectory, owner: state.projectId },
    ports: [{ hostIp: published.hostIp, published: published.published,
      protocol: "tcp", owner: state.projectId }],
    paths: [...paths.keys()].sort().map((path) => ({ path, owner: state.projectId })),
    networks: [{ name: networkName, owner: state.projectId },
      ...(state.homarrNetwork ? [{ name: state.homarrNetwork, owner: "external" }] : [])] };
}

async function verifiedImmichPhotoRuntime(state: MultiAppState): Promise<{ origin: string; password: string }> {
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail("Immich acceptance needs the saved local Docker context without environment overrides");
  }
  const currentRecipe = recipeFor(state.appId, false);
  assertMultiStateRecipe(state, currentRecipe);
  requireLocalDockerContext(state.dockerContext);
  await inspectImmichClosure(state);
  const runtime = inspectMultiAppRuntime(state);
  const server = dockerObject(["--context", state.dockerContext, "inspect", "--type", "container",
    runtime.containerIds[state.appId], "--format", "{{json .}}"], "exact closed Immich server");
  const environment = server.Config?.Env;
  if (!Array.isArray(environment)
    || environment.filter((entry: unknown) => entry === "IMMICH_ALLOW_SETUP=false").length !== 1
    || environment.some((entry: unknown) => entry === "IMMICH_ALLOW_SETUP=true")) {
    fail("Immich acceptance could not verify disabled setup in the exact running server");
  }
  const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
  if (!await inspectCredential(passwordFile)) fail("managed Immich admin password file is unavailable");
  const password = await readFile(passwordFile, "utf8");
  if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) fail("managed Immich admin password file is invalid");
  return { origin: `http://127.0.0.1:${state.port}`, password };
}

async function applyMultiSaved(state: MultiAppState, recipe: RecordValue): Promise<void> {
  const owner = createSelfhostComposeOwner(state.manifest);
  const plan = await owner.plan();
  if (plan.render.target !== state.composeTarget) fail("saved multi-service project no longer matches its exact Compose plan");
  await owner.render(plan);
  state.stage = "rendered";
  await writeState(state, false);
  await prepareMultiServiceFiles(recipe, dirname(state.composeTarget), state.dataDirectory);
  await owner.apply(plan);
  state.stage = "applied";
  state.lastLifecycle = "running";
  await writeState(state, false);
}

async function multiAppCommand(options: NonNullable<ReturnType<typeof parse>>, root: string,
  selected: ReturnType<typeof recipeFor> | null): Promise<void> {
  if (options.action === "account-plan" || options.action === "account-prepare") {
    fail("multi-service initial-admin credentials are generated by approved app apply; use app handoff afterward");
  }
  if (options.action === "paperless-token-plan" || options.action === "paperless-token-create"
    || options.action === "paperless-token-status") {
    if (options.appId !== "paperless-ngx") fail("Paperless token commands support only paperless-ngx");
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "initial-admin-from-file") {
      fail("Paperless token handoff needs one previously applied exact project");
    }
    assertMultiStateRecipe(state, recipeForSavedMultiState(state, false));
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("Paperless token handoff needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    if (inspectMultiAppRuntime(state).state !== "running") fail("Paperless token handoff needs every exact owned service running");
    const result = await paperlessApiTokenCommand({ action: options.action, approval: options.approval,
      origin: `http://127.0.0.1:${state.port}`, username: state.onboarding.username,
      passwordFile: join(dirname(state.composeTarget), "secrets", state.onboarding.fileId),
      tokenFile: join(dirname(state.composeTarget), "secrets", "paperless-api-token"),
      projectId: state.projectId, recipeSha256: state.recipeSha256 });
    const output = { schemaVersion: 1, command: `app ${options.action}`, appId: options.appId, ...result };
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`Paperless API token: ${result.status}. Private file: ${result.apiKeyFile ?? "not created"}.`);
    return;
  }
  if (options.action === "login-check") {
    if (options.appId === "prowlarr") {
      const state = await readMultiState(root, options.appId);
      if (!state || state.stage !== "applied" || state.onboarding.kind !== "manual-first-admin"
        || state.onboarding.username !== "admin" || state.prowlarrSetup?.stage !== "login-verified") {
        fail("Prowlarr login check needs the exact saved verified-admin checkpoint");
      }
      const runtime = await inspectSavedRuntime(state);
      if (runtime.state !== "running") fail("Prowlarr login check needs its exact owned container running");
      const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
      if (!await inspectCredential(passwordFile)) fail("Prowlarr admin password file is unavailable");
      const password = await readFile(passwordFile, "utf8");
      if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) fail("Prowlarr admin password file is invalid");
      const apiKey = await savedProwlarrApiKey(state);
      if (!apiKey) fail("Prowlarr API key file is unavailable");
      const origin = `http://127.0.0.1:${state.port}`;
      const config = await prowlarrHostConfig(origin, apiKey);
      if (config.authenticationMethod !== "forms" || config.authenticationRequired !== "enabled"
        || config.username !== "admin") {
        fail("Prowlarr host authentication no longer matches the saved administrator",
          "prowlarr-auth-changed");
      }
      const login = await verifyProwlarrLogin(origin, "admin", password);
      if (!login.verified) {
        fail(`Prowlarr managed login could not be reverified. ${JSON.stringify(login)}`,
          "prowlarr-login-unverified");
      }
      const result = { schemaVersion: 1, command: "app login-check", appId: options.appId,
        projectRoot: root, projectId: state.projectId, status: "admin-and-api-verified",
        mutation: false, username: "admin", url: origin, passwordFile,
        apiKeyFile: prowlarrKeyPath(state), loginVerified: true, apiVerified: true,
        indexersConfigured: "not-checked", restartPersistenceVerified: false,
        acceptanceVerified: false };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log("Prowlarr admin login and API access reverified. Indexer and restart checks remain separate.");
      return;
    }
    if (options.appId !== "paperless-ngx") fail("app login-check currently supports only the bundled Paperless-ngx recipe");
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "initial-admin-from-file") {
      fail("Paperless login check needs one previously applied exact project");
    }
    assertMultiStateRecipe(state, recipeForSavedMultiState(state, false));
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("Paperless login check needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    const runtime = inspectMultiAppRuntime(state);
    if (runtime.state !== "running") fail("Paperless login check needs every exact owned service running");
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("managed Paperless admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    const origin = `http://127.0.0.1:${state.port}`;
    let account: { userId: number; username: string };
    try {
      account = await verifyPaperlessAdmin(origin, state.onboarding.username, password);
    } catch {
      fail("Paperless admin login or superuser identity could not be verified; inspect the exact app before retrying",
        "login-unverified");
    }
    const result = { schemaVersion: 1, command: "app login-check", appId: options.appId,
      status: "admin-verified", mutation: false, url: origin, username: account.username,
      userId: account.userId, loginVerified: true, documentRoundTripVerified: false,
      restartPersistenceVerified: false, acceptanceVerified: false,
      next: "Upload a harmless document, check extraction and original bytes, then verify it survives a separately approved stop/start." };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log("Paperless managed admin login and superuser identity verified. Document and restart checks remain.");
    return;
  }
  if (options.action === "document-renew-plan" || options.action === "document-renew") {
    if (options.appId !== "paperless-ngx") fail("canary renewal currently supports only Paperless-ngx");
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.paperlessDocument?.stage !== "passed"
      || !state.paperlessPersistence?.acceptedAt
      || !state.paperlessPersistence.cleanedAt
      || state.paperlessPersistence.cleanup !== "trashed"
      || !["accepted", "stale"].includes(state.paperlessPersistence.stage)
      || state.paperlessPersistence.documentId !== state.paperlessDocument.documentId) {
      fail("a fresh Paperless canary needs a completed prior OCR, restart, and recoverable-trash checkpoint");
    }
    assertMultiStateRecipe(state, recipeForSavedMultiState(state, false));
    const generation = state.paperlessGeneration ?? 0;
    if (generation >= 1024) fail("Paperless canary history reached its bound; export and review the project state before another cycle");
    const approval = multiPaperlessRenewApproval(state);
    const nextTitle = paperlessCanaryTitle(state.projectId, generation + 1);
    if (options.action === "document-renew-plan") {
      const result = { schemaVersion: 1, command: "app document-renew-plan", appId: options.appId,
        status: "ready-for-review", mutation: false, generation: generation + 1,
        previousDocumentId: state.paperlessDocument.documentId, nextTitle, approval,
        acceptanceVerified: false,
        next: "Review the prior recoverable-trash proof, then approve document-renew. It changes only this app's owner-only checkpoint; document-check separately uploads the new canary." };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Next Paperless canary: ${nextTitle}. Approval: ${approval}`);
      return;
    }
    if (options.approval !== approval) fail("Paperless canary renewal needs the exact current plan approval", "approval-mismatch");
    const history = state.paperlessProofHistory ?? [];
    history.push({ generation, documentId: state.paperlessDocument.documentId!,
      title: state.paperlessDocument.title,
      imageSha256: state.paperlessDocument.imageSha256,
      startedAt: state.paperlessPersistence.startedAt,
      stoppedAt: state.paperlessPersistence.stoppedAt!,
      restartedAt: state.paperlessPersistence.restartedAt!,
      acceptedAt: state.paperlessPersistence.acceptedAt,
      cleanedAt: state.paperlessPersistence.cleanedAt,
      stale: state.paperlessPersistence.stage === "stale" });
    state.paperlessProofHistory = history;
    state.paperlessGeneration = generation + 1;
    state.paperlessDocument = undefined;
    state.paperlessPersistence = undefined;
    await writeState(state, false);
    const result = { schemaVersion: 1, command: "app document-renew", appId: options.appId,
      status: "ready-for-new-canary", mutation: true, generation: state.paperlessGeneration,
      previousProofCount: history.length, nextTitle, acceptanceVerified: false,
      next: "Review approvals.documentCheck from app status, then run document-check for the new exact canary. No upload occurred during renewal." };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Paperless canary checkpoint renewed. ${result.next}`);
    return;
  }
  if (options.action === "document-check") {
    if (options.appId !== "paperless-ngx") fail("app document-check currently supports only the bundled Paperless-ngx recipe");
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "initial-admin-from-file") {
      fail("Paperless document check needs one previously applied exact project");
    }
    assertMultiStateRecipe(state, recipeForSavedMultiState(state, false));
    if (state.paperlessPersistence?.cleanup === "trashed") {
      fail("Paperless canary is in recoverable trash. Its saved acceptance is historical; do not check it as an active document.");
    }
    if (options.approval !== multiDocumentCheckApproval(state)) {
      fail("Paperless document check needs the exact saved project and canary approval");
    }
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("Paperless document check needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    const runtime = inspectMultiAppRuntime(state);
    if (runtime.state !== "running") fail("Paperless document check needs every exact owned service running");
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("managed Paperless admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    const origin = `http://127.0.0.1:${state.port}`;
    try {
      await verifyPaperlessAdmin(origin, state.onboarding.username, password);
    } catch {
      fail("Paperless admin login is not verified; inspect the exact app before a document check", "login-unverified");
    }
    const canary = paperlessCanary();
    let newlyAttempted = false;
    if (!state.paperlessDocument) {
      state.paperlessDocument = { stage: "upload-attempted",
        title: paperlessCanaryTitle(state.projectId, state.paperlessGeneration ?? 0),
        imageSha256: canary.sha256,
        startedAt: new Date().toISOString() };
      await writeState(state, false);
      newlyAttempted = true;
    }
    if (state.paperlessDocument.stage === "upload-attempted") {
      if (!newlyAttempted) {
        fail("Paperless upload was attempted but its task UUID was not saved. Inspect the exact canary title in Paperless before any new upload.",
          "upload-uncertain");
      }
      let taskId: string;
      try {
        taskId = await uploadPaperlessCanary(origin, state.onboarding.username, password,
          state.paperlessDocument.title);
      } catch {
        fail("Paperless upload may have reached the server, but no task UUID was saved. Inspect the exact canary title before recovery.",
          "upload-uncertain");
      }
      state.paperlessDocument = { ...state.paperlessDocument, stage: "task-saved", taskId };
      await writeState(state, false);
    }
    if (state.paperlessDocument.stage === "task-saved") {
      let task: Awaited<ReturnType<typeof paperlessTask>>;
      try {
        task = await paperlessTask(origin, state.onboarding.username, password,
          state.paperlessDocument.taskId!);
      } catch {
        fail("Paperless task could not be inspected. The task UUID is saved; retry this exact document check without uploading again.",
          "task-unverified");
      }
      if (task.status === "failure" || task.status === "revoked") {
        fail("Paperless consumption failed or was revoked. Inspect the saved task; no new upload will be sent.",
          "task-failed");
      }
      if (task.status === "pending" || task.status === "started") {
        const processing = { schemaVersion: 1, command: "app document-check", appId: options.appId,
          status: "processing", mutation: newlyAttempted, taskId: state.paperlessDocument.taskId,
          documentRoundTripVerified: false, ocrVerified: false, acceptanceVerified: false,
          next: "Wait for Paperless processing, then use the fresh approvals.documentCheck from app status. No new upload will be sent." };
        if (options.json) console.log(JSON.stringify(processing, null, 2));
        else console.log("Paperless is processing the saved canary. Retry its exact task from app status; no new upload will be sent.");
        return;
      }
      state.paperlessDocument = { ...state.paperlessDocument, stage: "document-saved",
        documentId: task.documentId! };
      await writeState(state, false);
    }
    const documentId = state.paperlessDocument.documentId;
    if (!documentId) fail("Paperless canary document ID is unavailable");
    try {
      await verifyPaperlessCanary(origin, state.onboarding.username, password,
        documentId, state.paperlessDocument.imageSha256);
    } catch {
      fail("Paperless document exists but OCR or original-byte readback is not verified. Retry the saved document ID, not another upload.",
        "document-unverified");
    }
    state.paperlessDocument = { ...state.paperlessDocument, stage: "passed",
      checkedAt: new Date().toISOString() };
    await writeState(state, false);
    const checked = { schemaVersion: 1, command: "app document-check", appId: options.appId,
      status: "ocr-original-roundtrip-passed", mutation: true,
      documentId, imageSha256: state.paperlessDocument.imageSha256,
      ocrVerified: true, documentRoundTripVerified: true,
      restartPersistenceVerified: false, acceptanceVerified: false,
      next: "Keep this exact canary in Paperless across separately approved app down/up, then verify it again before moving it to recoverable trash." };
    if (options.json) console.log(JSON.stringify(checked, null, 2));
    else console.log("Paperless OCR and original-byte readback passed for the saved canary. Restart persistence remains unverified.");
    return;
  }
  if ((options.action === "persistence-start" || options.action === "persistence-finish")
    && options.appId === "paperless-ngx") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.paperlessDocument?.stage !== "passed") {
      fail("Paperless restart proof needs a saved OCR and original-byte round-trip");
    }
    assertMultiStateRecipe(state, recipeForSavedMultiState(state, false));
    if (state.paperlessPersistence?.cleanup === "trashed") {
      fail("Paperless canary is in recoverable trash. A new restart proof needs a new, separately approved canary.");
    }
    if (options.approval !== multiPaperlessPersistenceApproval(state, options.action)) {
      fail("Paperless restart proof needs the exact saved document and project approval");
    }
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("Paperless restart proof needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    const runtime = inspectMultiAppRuntime(state);
    if (runtime.state !== "running") fail("Paperless restart proof needs every exact owned service running");
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("managed Paperless admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    const origin = `http://127.0.0.1:${state.port}`;
    try {
      await verifyPaperlessAdmin(origin, state.onboarding.username, password);
      await verifyPaperlessCanary(origin, state.onboarding.username, password,
        state.paperlessDocument.documentId!, state.paperlessDocument.imageSha256);
    } catch {
      fail("Paperless managed login, OCR, or exact original bytes could not be reverified",
        "persistence-unverified");
    }
    if (options.action === "persistence-start") {
      if (state.paperlessPersistence?.acceptedAt) {
        fail("Paperless's prior accepted canary must be cleaned up before planning a new restart proof");
      }
      if (state.paperlessPersistence && state.paperlessPersistence.stage !== "stale") {
        fail("Paperless restart proof already has a saved canary; inspect app status before continuing");
      }
      state.paperlessPersistence = { stage: "awaiting-stop",
        documentId: state.paperlessDocument.documentId!,
        imageSha256: state.paperlessDocument.imageSha256,
        startedAt: new Date().toISOString() };
      await writeState(state, false);
      const prepared = { schemaVersion: 1, command: "app persistence-start", appId: options.appId,
        status: "canary-ready-for-restart", mutation: true,
        documentId: state.paperlessPersistence.documentId,
        ocrVerified: true, documentRoundTripVerified: true,
        restartPersistenceVerified: false, acceptanceVerified: false,
        next: "Review separate app down and app up approvals from app status, then finish this exact canary proof." };
      if (options.json) console.log(JSON.stringify(prepared, null, 2));
      else console.log("Paperless canary is ready. Stop and restart only this exact app project with separate approvals.");
      return;
    }
    if (state.paperlessPersistence?.stage !== "restarted") {
      fail("Paperless restart finish needs the saved canary and separately approved app down/up checkpoints");
    }
    state.paperlessPersistence = { ...state.paperlessPersistence, stage: "accepted",
      acceptedAt: new Date().toISOString(), cleanup: "pending" };
    await writeState(state, false);
    const accepted = { schemaVersion: 1, command: "app persistence-finish", appId: options.appId,
      status: "accepted-canary-retained", mutation: true,
      documentId: state.paperlessPersistence.documentId,
      ocrVerified: true, documentRoundTripVerified: true,
      restartPersistenceVerified: true, acceptanceVerified: true,
      cleanupPending: true, checkedAt: state.paperlessPersistence.acceptedAt,
      next: "The canary remains in Paperless for recoverable, separately approved cleanup. Backups and remote access need separate checks." };
    if (options.json) console.log(JSON.stringify(accepted, null, 2));
    else console.log("Paperless login, OCR, and original bytes survived the approved stop/start. The exact test document remains for cleanup.");
    return;
  }
  if (options.action === "document-cleanup") {
    if (options.appId !== "paperless-ngx") fail("app document-cleanup currently supports only Paperless-ngx");
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "initial-admin-from-file"
      || state.paperlessDocument?.stage !== "passed"
      || !state.paperlessPersistence?.acceptedAt
      || !["accepted", "stale"].includes(state.paperlessPersistence.stage)) {
      fail("Paperless canary cleanup needs recorded OCR and approved restart acceptance");
    }
    assertMultiStateRecipe(state, recipeForSavedMultiState(state, false));
    if (state.paperlessPersistence.cleanup === "trashed") {
      fail("Paperless canary was already confirmed in recoverable trash");
    }
    if (options.approval !== multiPaperlessCleanupApproval(state)) {
      fail("Paperless canary cleanup needs the exact saved document and recoverable-trash approval");
    }
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("Paperless cleanup needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    const runtime = inspectMultiAppRuntime(state);
    if (runtime.state !== "running") fail("Paperless cleanup needs every exact owned service running");
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("managed Paperless admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    const origin = `http://127.0.0.1:${state.port}`;
    let cleanup: "already-trashed" | "trashed";
    try {
      await verifyPaperlessAdmin(origin, state.onboarding.username, password);
      cleanup = await trashPaperlessCanary(origin, state.onboarding.username, password,
        state.paperlessDocument.documentId!, state.paperlessDocument.title,
        state.paperlessDocument.imageSha256);
    } catch {
      fail("Paperless canary cleanup is uncertain. Retry the saved approval; it checks recoverable trash before any delete.",
        "cleanup-unverified");
    }
    state.paperlessPersistence = { ...state.paperlessPersistence,
      cleanup: "trashed", cleanedAt: new Date().toISOString() };
    await writeState(state, false);
    const result = { schemaVersion: 1, command: "app document-cleanup", appId: options.appId,
      status: "recoverable-trash-confirmed", mutation: cleanup === "trashed",
      documentId: state.paperlessPersistence.documentId, cleanup,
      cleanupPending: false, acceptanceRecorded: true, acceptanceVerified: false,
      checkedAt: state.paperlessPersistence.cleanedAt,
      next: "The exact synthetic canary is in recoverable trash. Current app health, backup restore, and remote access remain separate checks." };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log("Paperless's exact test document is in recoverable trash. Its restart proof remains recorded; current health was not checked.");
    return;
  }
  if (options.action === "close-plan" || options.action === "close-setup") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "api-first-admin") {
      fail("Immich setup closure needs one previously applied API-onboarded project");
    }
    const currentRecipe = recipeFor(options.appId, false);
    assertMultiStateRecipe(state, currentRecipe);
    if (state.onboardingStage === "closed") {
      if (options.action === "close-setup") fail("Immich setup closure is already recorded; use app status");
      const closed = { schemaVersion: 1, command: "app close-plan", appId: options.appId,
        status: "already-closed", mutation: false, approval: null, setupClosed: true,
        acceptanceVerified: false };
      if (options.json) console.log(JSON.stringify(closed, null, 2));
      else console.log(`${options.appId}: setup closure is already recorded.`);
      return;
    }
    if (state.onboardingStage !== "login-verified" && state.onboardingStage !== "closing") {
      fail("Immich setup closure needs the managed first-admin login checkpoint");
    }
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("Immich setup closure needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    let evidence: RecordValue;
    let candidate: RecordValue;
    let resume = false;
    if (state.onboardingStage === "closing") {
      inspectMultiAppRuntime(state);
      evidence = record(state.manifest.observed, "saved Immich closure evidence");
      candidate = state.manifest;
      resume = true;
    } else {
      evidence = await inspectImmichClosure(state);
      const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
      if (!await inspectCredential(passwordFile)) fail("managed Immich admin password file is unavailable");
      const password = await readFile(passwordFile, "utf8");
      const origin = `http://127.0.0.1:${state.port}`;
      if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)
        || await inspectInitialization(origin) !== true
        || !await verifyLogin(origin, state.onboarding.email, password)) {
        fail("Immich setup closure needs a fresh initialized server and managed admin login");
      }
      candidate = closedImmichManifest(state.manifest, evidence);
    }
    const owner = createSelfhostComposeOwner(candidate);
    const plan = await owner.plan();
    if (resume && plan.render.target !== state.composeTarget) {
      fail("saved Immich closure plan changed during resume");
    }
    const approval = multiClosureApproval(state, evidence);
    if (options.action === "close-plan") {
      const result = { schemaVersion: 1, command: "app close-plan", appId: options.appId,
        status: resume ? "ready-to-resume" : "ready-for-review", mutation: false,
        projectId: state.projectId, oldComposeTarget: state.previousComposeTarget ?? state.composeTarget,
        candidateComposeTarget: plan.render.target,
        renderTargetRefreshedOnApply: !resume,
        change: { service: state.appId, environment: state.onboarding.setupEnvironment,
          from: "true", to: "false", ownership: "verified-existing" },
        observed: { checkedAt: evidence.checkedAt, serviceCount: state.manifest.services.length,
          dataPathCount: evidence.paths.length, networkCount: evidence.networks.length },
        approval, setupClosed: false, acceptanceVerified: false };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`${options.appId}: reviewed setup closure for ${state.projectId}; approval ${approval}. No resources changed.`);
      return;
    }
    if (options.approval !== approval) fail("Immich setup closure needs the exact reviewed project and resource approval");
    if (!resume) {
      await owner.render(plan);
      await owner.checkRendered(plan);
      state.previousComposeTarget = state.composeTarget;
      state.composeTarget = plan.render.target;
      state.manifest = candidate;
      state.onboardingStage = "closing";
      await writeState(state, false);
    } else {
      await owner.checkRendered(plan);
    }
    await owner.apply(plan);
    const runtime = inspectMultiAppRuntime(state);
    if (runtime.state !== "running" || runtime.health !== "healthy") {
      fail("Immich setup closure applied but all exact services are not healthy yet; inspect app status and retry");
    }
    const server = dockerObject(["--context", state.dockerContext, "inspect", "--type", "container",
      runtime.containerIds[state.appId], "--format", "{{json .}}"], "closed Immich server");
    const setupEnvironment = server.Config?.Env;
    if (!Array.isArray(setupEnvironment)
      || setupEnvironment.filter((entry: unknown) => entry === "IMMICH_ALLOW_SETUP=false").length !== 1
      || setupEnvironment.some((entry: unknown) => entry === "IMMICH_ALLOW_SETUP=true")) {
      fail("Immich server has not confirmed the setup-disabled configuration");
    }
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("managed Immich admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    const origin = `http://127.0.0.1:${state.port}`;
    if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)
      || await inspectInitialization(origin) !== true
      || !await verifyLogin(origin, state.onboarding.email, password)) {
      fail("Immich setup is disabled, but the managed admin login could not be reverified");
    }
    state.onboardingStage = "closed";
    await writeState(state, false);
    const result = { schemaVersion: 1, command: "app close-setup", appId: options.appId,
      status: "setup-closed-login-verified", mutation: true, projectId: state.projectId,
      composeTarget: state.composeTarget, url: origin, setupClosed: true,
      acceptanceVerified: false };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${options.appId}: setup disabled and managed admin login verified. Photo and restart checks remain.`);
    return;
  }
  if (options.action === "photo-check") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.appId !== "immich"
      || state.onboardingStage !== "closed") {
      fail("Immich photo check needs an applied project with verified admin and closed setup");
    }
    if (options.approval !== multiPhotoCheckApproval(state)) {
      fail("Immich photo check needs the exact saved project and account approval");
    }
    if (state.photoCheck?.status === "passed") {
      const previous = { schemaVersion: 1, command: "app photo-check", appId: options.appId,
        status: "previously-passed", mutation: false, photoRoundTripVerified: true,
        restartPersistenceVerified: false, acceptanceVerified: false,
        assetId: state.photoCheck.assetId, checkedAt: state.photoCheck.checkedAt };
      if (options.json) console.log(JSON.stringify(previous, null, 2));
      else console.log("Immich photo round-trip was previously recorded; restart persistence remains unverified.");
      return;
    }
    const { origin, password } = await verifiedImmichPhotoRuntime(state);
    let result: { assetId: string; imageSha256: string };
    try {
      result = await immichPhotoRoundTrip({
        origin, email: state.onboarding.email,
        password, runId: state.projectId,
        resumeAsset: state.photoCheck?.status === "pending-manual-recovery"
          ? { assetId: state.photoCheck.assetId, imageSha256: state.photoCheck.imageSha256 }
          : undefined,
        onUploaded: async (assetId, imageSha256) => {
          state.photoCheck = { status: "pending-manual-recovery", assetId, imageSha256 };
          await writeState(state, false);
        },
      });
    } catch {
      fail("Immich photo check did not finish; inspect app status for the exact saved test asset before recovery",
        "photo-check-incomplete");
    }
    state.photoCheck = { status: "passed", assetId: result.assetId,
      imageSha256: result.imageSha256, checkedAt: new Date().toISOString() };
    await writeState(state, false);
    const checked = { schemaVersion: 1, command: "app photo-check", appId: options.appId,
      status: "photo-round-trip-passed", mutation: true, photoRoundTripVerified: true,
      restartPersistenceVerified: false, acceptanceVerified: false,
      assetId: result.assetId, imageSha256: result.imageSha256,
      movedToRecoverableTrash: true, checkedAt: state.photoCheck.checkedAt,
      next: "Review separately approved app down/up and verify application data survives restart." };
    if (options.json) console.log(JSON.stringify(checked, null, 2));
    else console.log("Immich admin login and photo upload/download passed; the test asset moved to recoverable trash. Restart persistence remains unverified.");
    return;
  }
  if (options.action === "persistence-start" || options.action === "persistence-finish") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.appId !== "immich"
      || state.onboardingStage !== "closed" || state.photoCheck?.status !== "passed") {
      fail("Immich restart proof needs closed setup and a passed photo round-trip");
    }
    if (options.approval !== multiPersistenceApproval(state, options.action)) {
      fail("Immich restart proof needs the exact saved canary and project approval");
    }
    const phase = state.persistence?.stage;
    const cleanupPending = (phase === "accepted" || phase === "stale")
      && state.persistence?.cleanup === "pending";
    if (options.action === "persistence-start"
      && (cleanupPending || (phase && !["uploaded", "stale"].includes(phase)))) {
      fail("Immich restart proof already has a saved canary; inspect app status before continuing");
    }
    if (options.action === "persistence-finish" && phase !== "restarted" && !cleanupPending) {
      fail("Immich restart proof needs the saved canary and separately approved app down/up checkpoints");
    }
    const { origin, password } = await verifiedImmichPhotoRuntime(state);
    if (cleanupPending && state.persistence) {
      let cleaned = false;
      try {
        await immichTrashAsset({ origin, email: state.onboarding.email,
          password, assetId: state.persistence.assetId });
        cleaned = true;
      } catch { /* Keep the accepted proof and exact pending asset for another reviewed attempt. */ }
      if (cleaned) {
        state.persistence.cleanup = "trashed";
        await writeState(state, false);
      }
      let mutation: boolean | null = null;
      if (cleaned) mutation = true;
      const cleanup = { schemaVersion: 1, command: "app persistence-finish", appId: options.appId,
        status: cleaned ? "cleanup-complete" : "cleanup-pending", mutation,
        partialWritePossible: !cleaned,
        assetId: state.persistence.assetId, acceptanceRecorded: phase === "accepted",
        acceptanceVerified: false, restartPersistenceVerified: false,
        movedToRecoverableTrash: cleaned,
        next: cleaned ? "Read app status for the saved acceptance and current lifecycle."
          : "The exact test asset may remain; inspect it and retry the current approvals.persistenceFinish." };
      if (options.json) console.log(JSON.stringify(cleanup, null, 2));
      else console.log(cleaned ? "Saved Immich test asset moved to recoverable trash."
        : "Immich acceptance is recorded, but test asset cleanup remains pending; inspect app status.");
      return;
    }
    let result: { assetId: string; imageSha256: string };
    try {
      const saved = phase === "uploaded" || options.action === "persistence-finish"
        ? state.persistence : undefined;
      result = await immichPhotoRoundTrip({
        origin, email: state.onboarding.email, password, runId: `${state.projectId}-restart`,
        resumeAsset: saved ? { assetId: saved.assetId, imageSha256: saved.imageSha256 } : undefined,
        retainAsset: true,
        onUploaded: async (assetId, imageSha256) => {
          state.persistence = { stage: "uploaded", assetId, imageSha256,
            startedAt: new Date().toISOString() };
          await writeState(state, false);
        },
      });
    } catch {
      fail("Immich restart proof did not finish; inspect app status for the exact saved canary before recovery",
        "persistence-incomplete");
    }
    if (options.action === "persistence-start") {
      const startedAt = state.persistence?.stage === "uploaded"
        ? state.persistence.startedAt : new Date().toISOString();
      state.persistence = { stage: "awaiting-stop", assetId: result.assetId,
        imageSha256: result.imageSha256, startedAt };
      await writeState(state, false);
      const prepared = { schemaVersion: 1, command: "app persistence-start", appId: options.appId,
        status: "canary-ready-for-restart", mutation: true, assetId: result.assetId,
        imageSha256: result.imageSha256, restartPersistenceVerified: false,
        acceptanceVerified: false,
        next: "Review separate app down and app up approvals from app status; then review approvals.persistenceFinish." };
      if (options.json) console.log(JSON.stringify(prepared, null, 2));
      else console.log("Immich test photo is saved. Stop and restart this exact app project with separate approvals before finishing persistence proof.");
      return;
    }
    if (!state.persistence) fail("Immich restart canary disappeared");
    state.persistence = { ...state.persistence, stage: "accepted",
      acceptedAt: new Date().toISOString(), cleanup: "pending" };
    await writeState(state, false);
    let cleaned = false;
    try {
      await immichTrashAsset({ origin, email: state.onboarding.email,
        password, assetId: state.persistence.assetId });
      cleaned = true;
    } catch { /* Acceptance remains recorded; the exact asset is recoverable on retry. */ }
    if (cleaned) {
      state.persistence.cleanup = "trashed";
      await writeState(state, false);
    }
    const accepted = { schemaVersion: 1, command: "app persistence-finish", appId: options.appId,
      status: cleaned ? "accepted" : "accepted-cleanup-pending", mutation: true, assetId: result.assetId,
      imageSha256: result.imageSha256, photoRoundTripVerified: true,
      restartPersistenceVerified: true, acceptanceVerified: true,
      movedToRecoverableTrash: cleaned, cleanupPending: !cleaned,
      checkedAt: state.persistence.acceptedAt,
      next: cleaned ? "Current functional acceptance passed. Backups, remote access, and Homarr integration need separate checks."
        : "Functional acceptance passed, but the exact test asset may remain; inspect app status and retry its cleanup approval." };
    if (options.json) console.log(JSON.stringify(accepted, null, 2));
    else console.log(cleaned
      ? "Immich test photo survived the approved stop/start with identical bytes and was moved to recoverable trash."
      : "Immich test photo survived the approved stop/start. Its cleanup is still pending; inspect app status.");
    return;
  }
  if (options.action === "onboard" && options.appId === "prowlarr") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "manual-first-admin"
      || state.onboarding.username !== "admin") {
      fail("Prowlarr onboarding needs one previously applied exact project");
    }
    if (options.approval !== multiProwlarrOnboardApproval(state)) {
      fail("Prowlarr onboarding needs its exact current status approval", "approval-mismatch");
    }
    const runtime = await inspectSavedRuntime(state);
    if (runtime.state !== "running") fail("Prowlarr onboarding needs its exact owned container running");
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("Prowlarr admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) fail("Prowlarr admin password file is invalid");
    const key = dockerText(["--context", state.dockerContext, "compose", "--project-name", state.projectId,
      "--file", state.composeTarget, "exec", "-T", "prowlarr", "sh", "-c",
      "sed -n 's:.*<ApiKey>\\([^<]*\\)</ApiKey>.*:\\1:p' /config/config.xml"], "exact Prowlarr API key").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(key)) fail("Prowlarr API key is not ready");
    await persistProwlarrApiKey(state, key);
    const origin = `http://127.0.0.1:${state.port}`;
    let config = await prowlarrHostConfig(origin, key);
    let configured = false;
    if (config.authenticationMethod === "forms" && config.authenticationRequired === "enabled"
      && config.username === "admin") {
      configured = true;
    } else if (state.prowlarrSetup?.stage !== undefined) {
      fail("Prowlarr host auth differs after an attempted update; inspect before retrying",
        "prowlarr-setup-needs-inspection");
    } else if (config.authenticationMethod !== "none" || (config.username && config.username !== "")) {
      fail("Prowlarr already has different authentication; inspect before changing it",
        "prowlarr-existing-auth");
    } else {
      state.prowlarrSetup = { stage: "attempted" };
      await writeState(state, false);
      await configureProwlarrAdmin(origin, key, config, "admin", password);
      config = await prowlarrHostConfig(origin, key);
      configured = config.authenticationMethod === "forms"
        && config.authenticationRequired === "enabled" && config.username === "admin";
    }
    if (!configured) fail("Prowlarr Forms authentication could not be read back; inspect before retrying",
      "prowlarr-auth-unverified");
    const login = await verifyProwlarrLogin(origin, "admin", password);
    if (!login.verified) {
      fail(`Prowlarr managed login could not be verified; inspect before retrying. ${JSON.stringify(login)}`,
        "prowlarr-login-unverified");
    }
    let mutation = false;
    if (state.prowlarrSetup?.stage !== "login-verified") {
      state.prowlarrSetup = { stage: "login-verified", verifiedAt: new Date().toISOString() };
      await writeState(state, false);
      mutation = true;
    }
    const result = { schemaVersion: 1, command: "app onboard", appId: options.appId,
      status: "login-verified", mutation, projectId: state.projectId,
      username: "admin", passwordFile, apiKeyFile: prowlarrKeyPath(state),
      accountVerified: true, acceptanceVerified: false, indexersConfigured: "not-checked",
      verifiedAt: state.prowlarrSetup.verifiedAt,
      next: "Choose and test an authorized indexer separately; verify restart persistence afterward." };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Prowlarr admin login verified at ${origin}. Indexers and restart checks remain open.`);
    return;
  }
  if (options.action === "onboard" && options.appId === "homarr") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "manual-first-admin") {
      fail("Homarr API onboarding needs one previously applied exact project");
    }
    assertMultiStateRecipe(state, recipeForSavedMultiState(state, false));
    if (options.approval !== multiHomarrOnboardApproval(state)) {
      fail("Homarr onboarding needs the exact saved project and account approval");
    }
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("Homarr onboarding needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    const runtime = inspectMultiAppRuntime(state);
    if (runtime.state !== "running") fail("Homarr onboarding needs its exact owned container running");
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("Homarr admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) fail("Homarr admin password file is invalid");
    if (!state.homarrSetup) {
      state.homarrSetup = { stage: "pending", boardName: "personal" };
      await writeState(state, false);
    }
    const origin = `http://127.0.0.1:${state.port}`;
    const existingApiKey = await savedHomarrApiKey(state);
    let onboarding;
    try {
      onboarding = await bootstrapHomarrApi({ origin, username: state.onboarding.username,
        password, boardName: state.homarrSetup.boardName,
        checkpoint: state.homarrSetup.checkpoint, existingApiKey: existingApiKey ?? undefined,
        onStage: async (checkpoint) => {
          if (!state.homarrSetup) fail("Homarr setup checkpoint disappeared");
          state.homarrSetup = { stage: "attempted", boardName: "personal", checkpoint };
          await writeState(state, false);
        },
        onApiKeyCreated: async (apiKey) => { await persistHomarrApiKey(state, apiKey); },
      });
    } catch (error) {
      if (error instanceof HomarrOnboardingError) {
        const code = error.uncertain ? "onboarding-uncertain" : "onboarding-failed";
        fail(`Homarr ${error.stage}: ${error.message} Inspect app status before recovery.`, code);
      }
      fail("Homarr onboarding failed after an uncertain request; inspect app status before recovery",
        "onboarding-uncertain");
    }
    state.homarrSetup = { ...state.homarrSetup, stage: "complete",
      boardName: "personal", completedAt: new Date().toISOString() };
    await writeState(state, false);
    const result = { schemaVersion: 1, command: "app onboard", appId: "homarr",
      status: "admin-and-api-key-verified",
      mutation: onboarding.onboardingSubmitted || onboarding.apiKeySource === "created",
      url: origin, username: state.onboarding.username,
      passwordFile, apiKeyFile: homarrKeyPath(state),
      adminVerified: onboarding.adminVerified, apiKeyVerified: onboarding.apiKeyVerified,
      onboardingSubmitted: onboarding.onboardingSubmitted,
      integrationsSubmitted: onboarding.integrationsSubmitted,
      boardContentVerified: false, integrationConnectionsVerified: false,
      widgetsVerified: false, notebookVerified: false, restartPersistenceVerified: false,
      acceptanceVerified: false,
      next: "Read back the board, add and verify selected integrations, widgets and Notebook, then prove restart persistence." };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log("Homarr admin login and private API key verified. Board content, integrations, widgets, Notebook, and restart persistence remain unchecked.");
    return;
  }
  if (options.action === "onboard") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied" || state.onboarding.kind !== "api-first-admin") {
      fail("API onboarding needs one previously applied multi-service project");
    }
    if (state.onboardingStage === "closing" || state.onboardingStage === "closed") {
      fail("Immich setup is closing or closed; use app status instead of replaying onboarding");
    }
    const currentRecipe = recipeFor(options.appId, false);
    assertMultiStateRecipe(state, currentRecipe);
    if (options.approval !== multiOnboardApproval(state)) {
      fail("app onboarding needs the exact saved project and account approval");
    }
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("app onboarding needs the saved local Docker context without environment overrides");
    }
    requireLocalDockerContext(state.dockerContext);
    const runtime = inspectMultiAppRuntime(state);
    if (runtime.state !== "running" || runtime.health !== "healthy") {
      fail("app onboarding needs every exact owned service running and healthy");
    }
    const passwordFile = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(passwordFile)) fail("managed app admin password file is unavailable");
    const password = await readFile(passwordFile, "utf8");
    if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) fail("managed app admin password file is invalid");
    const origin = `http://127.0.0.1:${state.port}`;
    if (state.onboardingStage === "login-verified") {
      if (!await verifyLogin(origin, state.onboarding.email, password)) {
        fail("saved admin checkpoint could not be reverified; inspect the account before continuing");
      }
      const existing = { schemaVersion: 1, command: "app onboard", appId: options.appId,
        status: "login-verified-setup-open", mutation: false, username: state.onboarding.username,
        email: state.onboarding.email, passwordFile, url: origin, setupClosed: false,
        acceptanceVerified: false };
      if (options.json) console.log(JSON.stringify(existing, null, 2));
      else console.log(`${options.appId}: managed admin login reverified. Setup closure is still required.`);
      return;
    }
    if (state.onboardingStage === "pending") {
      state.onboardingStage = "signup-attempted";
      await writeState(state, false);
      const result = await bootstrapImmichAdmin({ origin, email: state.onboarding.email,
        name: state.onboarding.name, password });
      if (!result.loginVerified) {
        fail(`${result.reason} The saved signup-attempted checkpoint requires inspection before recovery.`,
          "onboarding-uncertain");
      }
    } else {
      const initialized = await inspectInitialization(origin);
      if (initialized !== true || !await verifyLogin(origin, state.onboarding.email, password)) {
        fail("Admin signup may have been attempted, but the managed login is unverified; inspect the UI before recovery.",
          "onboarding-uncertain");
      }
    }
    state.onboardingStage = "login-verified";
    await writeState(state, false);
    const result = { schemaVersion: 1, command: "app onboard", appId: options.appId,
      status: "login-verified-setup-open", mutation: true, username: state.onboarding.username,
      email: state.onboarding.email, passwordFile, url: origin, setupClosed: false,
      acceptanceVerified: false };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${options.appId}: managed admin login verified. Setup closure is still required.`);
    return;
  }
  if (options.action === "handoff") {
    const state = await readMultiState(root, options.appId);
    if (!state || state.stage !== "applied") fail("multi-service handoff needs a previously applied exact project");
    const filePath = join(dirname(state.composeTarget), "secrets", state.onboarding.fileId);
    if (!await inspectCredential(filePath)) fail("multi-service admin password file is unavailable");
    let status = "configured-not-login-verified";
    if (state.onboarding.kind === "manual-first-admin") status = "password-prepared-onboarding-pending";
    if (state.homarrSetup?.stage === "complete") status = "homarr-admin-and-api-key-recorded";
    if (state.prowlarrSetup?.stage === "login-verified") status = "login-verified-recorded";
    if (state.onboardingStage === "login-verified") status = "login-verified-setup-open";
    if (state.onboardingStage === "closing") status = "setup-closure-in-progress";
    if (state.onboardingStage === "closed") status = "setup-closed-login-verified";
    let apiKeyFile: string | null = null;
    if (state.homarrSetup?.stage === "complete") {
      apiKeyFile = join(dirname(state.composeTarget), "secrets", "homarr-api-key");
    } else if (state.appId === "prowlarr" && state.prowlarrSetup?.stage === "login-verified"
      && await savedProwlarrApiKey(state)) {
      apiKeyFile = prowlarrKeyPath(state);
    } else if (state.appId === "paperless-ngx") {
      const paperlessTokenFile = join(dirname(state.composeTarget), "secrets", "paperless-api-token");
      if (await inspectCredential(paperlessTokenFile)) apiKeyFile = paperlessTokenFile;
    }
    const summary = { schemaVersion: 1, command: "app handoff", appId: options.appId,
      status, mutation: false, username: state.onboarding.username,
      email: state.onboarding.email ?? null,
      passwordFile: filePath, url: `http://127.0.0.1:${state.port}`,
      apiKeyFile };
    if (options.show) {
      const password = await readFile(filePath, "utf8");
      if (!/^[A-Za-z0-9_-]{43,172}$/.test(password)) fail("multi-service admin password file is invalid");
      const prefix = credentialPrefix(options.appId);
      let env = `${prefix}_USERNAME=${state.onboarding.username}\n`;
      if (state.onboarding.kind === "api-first-admin") env += `${prefix}_EMAIL=${state.onboarding.email}\n`;
      env += `${prefix}_PASSWORD=${password}\n${prefix}_URL=${summary.url}\n`;
      if (state.appId === "homarr" && summary.apiKeyFile) {
        const apiKey = await savedHomarrApiKey(state);
        if (!apiKey) fail("saved Homarr API key is unavailable");
        env += `${prefix}_API_KEY=${apiKey}\n`;
      }
      if (state.appId === "prowlarr" && summary.apiKeyFile) {
        const apiKey = await savedProwlarrApiKey(state);
        if (!apiKey) fail("saved Prowlarr API key is unavailable");
        env += `PROWLARR_API_KEY=${apiKey}\n`;
      }
      if (state.appId === "paperless-ngx" && summary.apiKeyFile) {
        const metadata = await lstat(summary.apiKeyFile);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
          || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
          || await realpath(summary.apiKeyFile) !== summary.apiKeyFile || metadata.size !== 40) {
          fail("saved Paperless API token file is not an intact owner-only mode-0600 file");
        }
        const token = await readFile(summary.apiKeyFile, "utf8");
        if (!/^[0-9a-f]{40}$/.test(token)) fail("saved Paperless API token is invalid");
        env += `${prefix}_API_KEY=${token}\n`;
      }
      if (options.json) console.log(JSON.stringify({ ...summary, secretful: true, env }, null, 2));
      else process.stdout.write(env);
      return;
    }
    if (options.json) console.log(JSON.stringify({ ...summary, secretful: false }, null, 2));
    else console.log(`${options.appId}: admin credentials are at ${filePath}; use --show for the full private .env. ${status}.`);
    return;
  }
  if (options.action === "status-page-plan" || options.action === "status-page-create"
    || options.action === "status-page-status") {
    if (options.appId !== "uptime-kuma") fail("status-page commands support only Uptime Kuma");
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    const homarr = await readMultiState(root, "homarr");
    if (!state || state.stage !== "applied" || state.uptimeSetup?.stage !== "login-verified"
      || !state.credentialRef || !state.accountUsername || !await inspectCredential(state.credentialRef)
      || state.uptimeSelfMonitor?.stage !== "recorded" || !state.uptimeSelfMonitor.id
      || !homarr || homarr.stage !== "applied" || homarr.homarrSetup?.stage !== "complete"
      || state.homarrNetwork !== `${homarr.projectId}-private`
      || state.manifest.services?.[0]?.ports?.[0]?.hostIp !== "127.0.0.1") {
      fail("status-page setup needs a verified Uptime self-monitor on the approved private Homarr bridge");
    }
    const runtime = await inspectSavedRuntime(state);
    if (runtime.state !== "running") fail("the exact Uptime Kuma container must be running");
    const env = await credentialEnv(state.credentialRef, state, state.accountUsername);
    const password = env.trimEnd().split("\n")[1].slice("UPTIME_KUMA_PASSWORD=".length);
    const origin = `http://127.0.0.1:${state.port}`;
    try {
      const monitor = await inspectUptimeSelfMonitor(origin, state.accountUsername, password,
        state.uptimeSelfMonitor.name);
      if (!monitor || monitor.id !== state.uptimeSelfMonitor.id || monitor.status !== "up") {
        fail("the exact saved Uptime self-monitor needs a latest UP heartbeat");
      }
      if (state.uptimeStatusPage && state.uptimeStatusPage.monitorId !== monitor.id) {
        fail("the saved status page belongs to a different monitor; inspect before retrying");
      }
      const page = await inspectUptimeStatusPage(origin, state.accountUsername, password, monitor.id);
      const checkpoint = state.uptimeStatusPage;
      if (options.action === "status-page-status") {
        const status = !checkpoint && page.exists ? "unowned-page" : checkpoint?.stage ?? "needs-page";
        const result = { schemaVersion: 1, command: "app status-page-status", appId: options.appId,
          mutation: false, status, slug: uptimeStatusPageSlug, monitorId: monitor.id,
          pageExists: page.exists, exact: page.exact, heartbeatUp: page.heartbeatUp,
          privacy: "Kuma status-page endpoints are unauthenticated. Loopback binding and the private bridge do not prove that no proxy or tunnel exposes them." };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else console.log(`${status}: /status/${uptimeStatusPageSlug}; exact=${page.exact}; heartbeatUp=${page.heartbeatUp}. ${result.privacy}`);
        return;
      }
      if (!checkpoint && page.exists) fail("default status page already exists and is not CLI-owned; do not overwrite it");
      if (checkpoint?.stage === "add-attempted" && !page.exists) {
        fail("status-page add attempt has no readback; inspect before retrying", "uptime-status-page-add-uncertain", true);
      }
      if (checkpoint?.stage === "save-attempted" && !page.exact) {
        fail("status-page save attempt has no exact readback; inspect before retrying", "uptime-status-page-save-uncertain", true);
      }
      if (checkpoint?.stage === "recorded" && !page.exact) {
        fail("saved status page changed; inspect before retrying", "uptime-status-page-changed");
      }
      const approval = uptimeStatusPageApproval(state, monitor, page);
      if (options.action === "status-page-plan") {
        const result = { schemaVersion: 1, command: "app status-page-plan", appId: options.appId,
          mutation: false, status: checkpoint?.stage ?? "ready-for-review", slug: uptimeStatusPageSlug,
          title: uptimeStatusPageTitle, group: uptimeStatusPageGroup, monitorId: monitor.id,
          pageExists: page.exists, exact: page.exact, heartbeatUp: page.heartbeatUp, approval,
          mutationScope: "Create one default status page and expose only the saved local self-monitor on it.",
          privacy: "The status-page API needs no authentication. Review existing proxies and tunnels before approving; this command verifies loopback binding and the private bridge but cannot prove no external route exists." };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else console.log(`${result.status}: ${result.mutationScope} ${result.privacy} Approval: ${approval}`);
        return;
      }
      if (options.approval !== approval) fail("status-page creation needs its exact current plan approval");
      const readback = await createUptimeStatusPage(origin, state.accountUsername, password, monitor.id,
        checkpoint?.stage ?? null,
        async () => {
          state.uptimeStatusPage = { stage: "add-attempted", slug: uptimeStatusPageSlug,
            title: uptimeStatusPageTitle, monitorId: monitor.id };
          await writeState(state, false);
        },
        async () => {
          state.uptimeStatusPage = { stage: "save-attempted", slug: uptimeStatusPageSlug,
            title: uptimeStatusPageTitle, monitorId: monitor.id };
          await writeState(state, false);
        });
      const mutation = state.uptimeStatusPage?.stage !== "recorded";
      if (mutation) {
        state.uptimeStatusPage = { stage: "recorded", slug: uptimeStatusPageSlug,
          title: uptimeStatusPageTitle, monitorId: monitor.id, recordedAt: new Date().toISOString() };
        await writeState(state, false);
      }
      const result = { schemaVersion: 1, command: "app status-page-create", appId: options.appId,
        status: readback.heartbeatUp ? "recorded" : "recorded-heartbeat-pending", mutation,
        slug: uptimeStatusPageSlug, monitorId: monitor.id, exact: readback.exact,
        heartbeatUp: readback.heartbeatUp,
        privacy: "The status-page API is unauthenticated; this command did not verify external proxy or tunnel exposure.",
        next: "Use app homarr-uptime-input, then the separately approved homarr attach uptime-kuma plan/apply/status." };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`${result.status}: /status/${uptimeStatusPageSlug}. ${result.privacy} ${result.next}`);
    } catch (error) {
      if (error instanceof UptimeStatusPageError) {
        fail("Uptime Kuma status page could not be read back safely; inspect its saved checkpoint before retrying",
          error.code, error.uncertain);
      }
      throw error;
    }
    return;
  }
  if (options.action === "monitor-list" || options.action === "monitor-plan"
    || options.action === "monitor-check") {
    if (options.appId !== "uptime-kuma") fail("monitor checks currently support only Uptime Kuma");
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    if (!state || state.stage !== "applied" || state.uptimeSetup?.stage !== "login-verified"
      || !state.credentialRef || !state.accountUsername
      || !await inspectCredential(state.credentialRef)) {
      fail("verify Uptime Kuma's saved administrator before checking a monitor");
    }
    const runtime = await inspectSavedRuntime(state);
    if (runtime.state !== "running") fail("the exact Uptime Kuma container must be running for a monitor check");
    const env = await credentialEnv(state.credentialRef, state, state.accountUsername);
    const password = env.trimEnd().split("\n")[1].slice("UPTIME_KUMA_PASSWORD=".length);
    const origin = `http://127.0.0.1:${state.port}`;
    try {
      if (options.action === "monitor-list") {
        const monitors = await listUptimeMonitors(origin, state.accountUsername, password);
        let next = "Choose one healthy monitor ID; app monitor-plan reviews its checkpoint.";
        if (monitors.length === 0) {
          next = "No supported active monitor is available. Create an HTTP, ping, or TCP-port monitor in Uptime Kuma, or inspect unsupported types in its UI.";
        }
        const result = { schemaVersion: 1, command: "app monitor-list", appId: options.appId,
          mutation: false, monitors: monitors.map(uptimeMonitorSummary), next };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else {
          for (const monitor of monitors) console.log(`${monitor.id}: ${monitor.name} (${monitor.status})`);
          if (monitors.length === 0) console.log(result.next);
        }
        return;
      }
      const monitor = await inspectUptimeMonitor(origin, state.accountUsername, password, options.monitorId!);
      if (monitor.status !== "up" || monitor.lastBeatId === null) {
        fail("the selected monitor is not up with a recorded heartbeat; inspect its target and retry");
      }
      if (state.uptimeMonitor && (state.uptimeMonitor.id !== monitor.id
        || state.uptimeMonitor.identity !== monitor.identity
        || state.uptimeMonitor.name !== monitor.name)) {
        fail("the saved monitor changed; inspect it before claiming persistence", "uptime-monitor-changed");
      }
      if (state.uptimeMonitor?.stage === "baseline" || state.uptimeMonitor?.stage === "stopped") {
        fail("stop and restart this exact app with its separate status approvals before the persistence readback",
          "uptime-restart-required");
      }
      if (state.uptimeMonitor?.stage === "restarted"
        && (monitor.lastBeatId === null || state.uptimeMonitor.upBeatId === undefined
          || monitor.lastBeatId <= state.uptimeMonitor.upBeatId)) {
        fail("wait for a new successful monitor check after the post-start fence; the saved up heartbeat is too old",
          "uptime-fresh-beat-required");
      }
      const approval = uptimeMonitorApproval(state, monitor);
      if (options.action === "monitor-plan") {
        const result = { schemaVersion: 1, command: "app monitor-plan", appId: options.appId,
          status: state.uptimeMonitor?.stage === "verified" ? "already-verified" : "ready-for-review",
          mutation: false, monitor: uptimeMonitorSummary(monitor),
          priorStage: state.uptimeMonitor?.stage ?? "unrecorded",
          approval, acceptanceRecorded: state.uptimeMonitor?.stage === "verified",
          acceptanceVerified: false,
          next: state.uptimeMonitor ? "Review the restart readback and approve app monitor-check."
            : "Review the live up monitor and approve app monitor-check for a baseline checkpoint." };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else console.log(`Monitor ${monitor.id} (${monitor.name}) is up. Approval: ${approval}`);
        return;
      }
      if (options.approval !== approval) fail("monitor check needs its exact current plan approval", "approval-mismatch");
      let acceptanceVerified = false;
      let mutation = false;
      if (!state.uptimeMonitor) {
        state.uptimeMonitor = { id: monitor.id, name: monitor.name, identity: monitor.identity,
          stage: "baseline", baselineAt: new Date().toISOString(), baselineBeatId: monitor.lastBeatId };
        mutation = true;
      } else if (state.uptimeMonitor.stage === "restarted") {
        state.uptimeMonitor = { ...state.uptimeMonitor, stage: "verified",
          verifiedAt: new Date().toISOString() };
        acceptanceVerified = true;
        mutation = true;
      } else if (state.uptimeMonitor.stage === "verified") {
        acceptanceVerified = true;
      }
      if (mutation) await writeState(state, false);
      const result = { schemaVersion: 1, command: "app monitor-check", appId: options.appId,
        status: state.uptimeMonitor.stage, mutation,
        monitor: uptimeMonitorSummary(monitor), acceptanceVerified,
        baselineAt: state.uptimeMonitor.baselineAt,
        verifiedAt: state.uptimeMonitor.verifiedAt ?? null,
        next: acceptanceVerified ? "Monitor and saved admin survived the scoped stop/start."
          : "Use separately approved app down and app up, then repeat app monitor-plan and monitor-check." };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Uptime Kuma monitor ${monitor.id}: ${result.status}. ${result.next}`);
    } catch (error) {
      if (error instanceof UptimeOnboardingError) {
        fail("Uptime Kuma did not return a trustworthy monitor readback; inspect the app before retrying", error.code);
      }
      throw error;
    }
    return;
  }
  if (options.action === "monitor-create-plan" || options.action === "monitor-create") {
    if (options.appId !== "uptime-kuma") fail("local monitor creation supports only Uptime Kuma");
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    if (!state || state.stage !== "applied" || state.uptimeSetup?.stage !== "login-verified"
      || !state.credentialRef || !state.accountUsername
      || !await inspectCredential(state.credentialRef)) {
      fail("verify the saved Uptime Kuma administrator before creating a monitor");
    }
    const runtime = await inspectSavedRuntime(state);
    if (runtime.state !== "running") fail("the exact Uptime Kuma container must be running");
    const env = await credentialEnv(state.credentialRef, state, state.accountUsername);
    const password = env.trimEnd().split("\n")[1].slice("UPTIME_KUMA_PASSWORD=".length);
    const origin = `http://127.0.0.1:${state.port}`;
    const name = uptimeSelfMonitorName(state.projectId);
    try {
      const existing = await inspectUptimeSelfMonitor(origin, state.accountUsername, password, name);
      if (state.uptimeSelfMonitor?.stage === "recorded"
        && state.uptimeSelfMonitor.id !== existing?.id) {
        fail("the saved local monitor is missing or changed; inspect Uptime Kuma before retrying",
          "uptime-self-monitor-changed");
      }
      if (state.uptimeSelfMonitor?.stage === "attempted" && !existing) {
        fail("a prior monitor create attempt has no matching readback; inspect Uptime Kuma before another create",
          "uptime-monitor-create-uncertain", true);
      }
      if (state.uptimeMonitor && state.uptimeMonitor.id !== existing?.id) {
        fail("a different monitor already owns the acceptance checkpoint; use its saved ID",
          "uptime-monitor-baseline-exists");
      }
      const approval = uptimeSelfMonitorApproval(state, existing);
      if (options.action === "monitor-create-plan") {
        let planStatus = "ready-for-review";
        if (existing) planStatus = "existing-for-review";
        if (state.uptimeSelfMonitor?.stage === "recorded") planStatus = "already-recorded";
        const result = { schemaVersion: 1, command: "app monitor-create-plan", appId: options.appId,
          status: planStatus,
          mutation: false, projectId: state.projectId, name, target: uptimeSelfMonitorUrl,
          upstreamVersion: uptimeSelfMonitorVersion,
          config: uptimeSelfMonitorConfig(name),
          location: "inside the Uptime Kuma container", intervalSeconds: 60,
          existingMonitorId: existing?.id ?? null, approval, acceptanceVerified: false,
          next: "This local self-check is not an external availability monitor. Review and approve monitor-create, then wait for an up heartbeat and run monitor-plan/check." };
        if (options.json) console.log(JSON.stringify(result, null, 2));
        else {
          console.log(`${name}: ${result.status}.`);
          console.log(`Target: ${uptimeSelfMonitorUrl} inside the Uptime Kuma container.`);
          console.log("GET every 60 seconds; accept HTTP 200-299; retry interval 60 seconds; no extra retries; active.");
          console.log(`Required Uptime Kuma version: ${uptimeSelfMonitorVersion}. Existing ID: ${existing?.id ?? "none"}.`);
          console.log("This does not check external availability or finish the restart proof.");
          console.log(`Approval: ${approval}`);
        }
        return;
      }
      if (options.approval !== approval) {
        fail("monitor creation needs the exact current plan approval", "approval-mismatch");
      }
      let monitor = existing;
      let mutation = false;
      let remoteMutation = false;
      if (!monitor) {
        monitor = await createUptimeSelfMonitor(origin, state.accountUsername, password, name,
          async () => {
            state.uptimeSelfMonitor = { stage: "attempted", name };
            await writeState(state, false);
          });
        remoteMutation = true;
      }
      if (state.uptimeSelfMonitor?.stage !== "recorded") {
        state.uptimeSelfMonitor = { stage: "recorded", name, id: monitor.id,
          recordedAt: new Date().toISOString() };
        await writeState(state, false);
        mutation = true;
      }
      const result = { schemaVersion: 1, command: "app monitor-create", appId: options.appId,
        status: "recorded", mutation, remoteMutation,
        monitor: uptimeMonitorSummary(monitor),
        acceptanceVerified: false,
        next: "Wait for an up heartbeat, then use monitor-plan/check and a separately approved stop/start for persistence proof." };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Local Uptime Kuma monitor ${monitor.id} recorded. Wait for an up heartbeat before the baseline check.`);
    } catch (error) {
      if (error instanceof UptimeOnboardingError) {
        fail("Uptime Kuma did not confirm the local monitor; inspect its saved checkpoint before retrying",
          error.code, error.uncertain);
      }
      throw error;
    }
    return;
  }
  if (options.action === "status" || options.action === "info") {
    const state = await readMultiState(root, options.appId);
    let runtime: Awaited<ReturnType<typeof inspectSavedRuntime>> | null = null;
    if (options.live) {
      if (!state) fail("--live needs a saved applied app project", "not-applied");
      runtime = await inspectSavedRuntime(state);
    }
    let approvals: RecordValue | null = null;
    let next = "Review app plan before starting a new project.";
    if (state?.stage === "applied") {
      approvals = { up: multiLifecycleApproval(state, "up"), down: multiLifecycleApproval(state, "down") };
      next = "Verify the administrator login, an app-specific function, and restart persistence.";
      if (state.appId === "homarr") {
        approvals.onboard = multiHomarrOnboardApproval(state);
        next = "Review approvals.onboard to create or reverify the Homarr admin, personal board, and private API key. Integrations, widgets, Notebook, and restart persistence remain separate.";
        if (state.homarrSetup?.stage === "attempted") {
          next = "Homarr onboarding may have partially completed. The approved retry inspects the saved account and current setup step before any further mutation.";
        }
        if (state.homarrSetup?.stage === "complete") {
          next = "Homarr admin, personal board setup, and private API key were recorded. Recheck the key if needed; integrations, widgets, Notebook, and restart persistence remain separate.";
        }
        if (state.lastLifecycle === "stopped") {
          next = "Homarr is stopped. Review approvals.up before running onboarding or verifying the saved API key.";
        }
      }
      if (state.appId === "prowlarr") {
        approvals.onboard = multiProwlarrOnboardApproval(state);
        next = "Review approvals.onboard to enable required Forms auth and verify the saved admin login. Indexers and restart persistence remain separate.";
        if (state.prowlarrSetup?.stage === "attempted") {
          next = "Prowlarr auth update was attempted. The approved retry checks the saved login and host config before any further mutation.";
        }
        if (state.prowlarrSetup?.stage === "login-verified") {
          next = "Prowlarr admin login was recorded. Choose and test an authorized indexer separately; restart persistence remains unverified.";
        }
      }
      if (state.appId === "paperless-ngx") {
        next = "Run app login-check to verify the managed superuser, then review approvals.documentCheck for the OCR canary. Restart persistence remains separate.";
        if ((state.paperlessGeneration ?? 0) > 0 && !state.paperlessDocument) {
          next = "The prior canary proof is archived. Review approvals.documentCheck for a fresh OCR and restart cycle.";
        }
        if ((!state.paperlessDocument || state.paperlessDocument.stage !== "upload-attempted")
          && state.paperlessPersistence?.cleanup !== "trashed") {
          approvals.documentCheck = multiDocumentCheckApproval(state);
        }
        if (state.paperlessDocument?.stage === "upload-attempted") {
          next = `Canary upload ${state.paperlessDocument.title} was attempted without a saved task UUID. Inspect Paperless before recovery; do not upload again.`;
        }
        if (state.paperlessDocument?.stage === "task-saved") {
          next = `Canary task ${state.paperlessDocument.taskId} is saved. Retry approvals.documentCheck to inspect that exact task; no new upload will be sent.`;
        }
        if (state.paperlessDocument?.stage === "document-saved") {
          next = `Canary document ${state.paperlessDocument.documentId} is saved. Retry approvals.documentCheck to verify OCR and original bytes; no new upload will be sent.`;
        }
        if (state.paperlessDocument?.stage === "passed") {
          next = `Canary document ${state.paperlessDocument.documentId} passed OCR and original-byte readback. Review approvals.persistenceStart for a separate restart proof.`;
          if (!state.paperlessPersistence
            || (state.paperlessPersistence.stage === "stale"
              && !state.paperlessPersistence.acceptedAt)) {
            approvals.persistenceStart = multiPaperlessPersistenceApproval(state, "persistence-start");
          }
          if (state.paperlessPersistence?.stage === "awaiting-stop") {
            next = "Paperless canary is ready. Review approvals.down, then approvals.up; both are separate exact-project changes.";
          }
          if (state.paperlessPersistence?.stage === "stopped") {
            next = "The exact Paperless project stopped. Review approvals.up before checking the saved canary again.";
          }
          if (state.paperlessPersistence?.stage === "restarted") {
            approvals.persistenceFinish = multiPaperlessPersistenceApproval(state, "persistence-finish");
            next = "The exact Paperless project restarted. Review approvals.persistenceFinish to verify login, OCR, and original bytes again.";
          }
          if (state.paperlessPersistence?.stage === "accepted") {
            next = "Paperless restart proof was recorded. The test document remains in the library pending separate cleanup; current health is not checked.";
          }
          if (state.paperlessPersistence?.stage === "stale") {
            next = "A later stop made the prior Paperless restart proof stale. The saved proof remains historical.";
          }
          if (state.paperlessPersistence?.cleanup === "trashed") {
            approvals.documentRenew = multiPaperlessRenewApproval(state);
            next = "The prior canary is in recoverable trash. Review approvals.documentRenew to start a fresh acceptance cycle after maintenance.";
          } else if (state.paperlessPersistence?.acceptedAt) {
            next = `Prior restart proof is recorded; canary ${state.paperlessDocument.documentId} is pending separately approved cleanup.`;
            if (state.lastLifecycle !== "stopped") {
              approvals.documentCleanup = multiPaperlessCleanupApproval(state);
            }
          }
          if (state.lastLifecycle === "stopped") {
            next = "Paperless is stopped. Review approvals.up before any login, canary, or restart proof.";
          }
        }
      }
      if (state.onboarding.kind === "api-first-admin") {
        if (state.onboardingStage === "pending" || state.onboardingStage === "signup-attempted"
          || state.onboardingStage === "login-verified") approvals.onboard = multiOnboardApproval(state);
        if (state.onboardingStage === "pending" || state.onboardingStage === "signup-attempted") {
          next = "After the exact containers are healthy, review approvals.onboard and run app onboard. A retry checks the saved account without blindly repeating signup.";
        }
        if (state.onboardingStage === "login-verified") {
          next = "Run app close-plan, review the owned resources and setup-disabled change, then separately approve app close-setup.";
        }
        if (state.onboardingStage === "closing") {
          approvals.closeSetup = multiClosureApproval(state, state.manifest.observed);
          next = "Setup closure was checkpointed but not confirmed. Run app close-plan and resume app close-setup with its exact approval.";
        }
        if (state.onboardingStage === "closed") {
          next = "Setup is closed and managed login was verified. Review approvals.photoCheck, then separately verify restart persistence.";
          if (state.photoCheck?.status !== "passed") approvals.photoCheck = multiPhotoCheckApproval(state);
          if (state.photoCheck?.status === "pending-manual-recovery") {
            next = `Test asset ${state.photoCheck.assetId} may remain in the library. Retry approvals.photoCheck against that saved asset; no new upload will be sent.`;
          }
          if (state.photoCheck?.status === "passed") {
            next = "Photo upload and exact download passed. Review approvals.persistenceStart to save a restart canary.";
            if (!state.persistence || state.persistence.stage === "uploaded"
              || (state.persistence.stage === "stale" && state.persistence.cleanup !== "pending")) {
              approvals.persistenceStart = multiPersistenceApproval(state, "persistence-start");
            }
            if (state.persistence?.stage === "uploaded") {
              next = `Canary asset ${state.persistence.assetId} was uploaded. Retry approvals.persistenceStart against that exact asset; no new upload will be sent.`;
              if (state.lastLifecycle === "stopped") {
                next = `Canary asset ${state.persistence.assetId} was uploaded before the app stopped. Review approvals.up, then retry approvals.persistenceStart against that exact asset.`;
              }
            }
            if (state.persistence?.stage === "awaiting-stop") {
              next = "Canary is saved. Review approvals.down, then approvals.up in app status; both are separate exact-project changes.";
            }
            if (state.persistence?.stage === "stopped") {
              next = "Exact app project was stopped with its approval. Review approvals.up; the canary must then be read back.";
            }
            if (state.persistence?.stage === "restarted") {
              approvals.persistenceFinish = multiPersistenceApproval(state, "persistence-finish");
              next = "Exact app project restarted. Review approvals.persistenceFinish to read the saved canary and confirm persistence.";
            }
            if (state.persistence?.stage === "accepted") {
              next = "Photo and restart persistence were accepted at the saved time. Current container health is not checked by status.";
              if (state.persistence.cleanup === "pending") {
                approvals.persistenceFinish = multiPersistenceApproval(state, "persistence-finish");
                next = `Restart proof was accepted, but test asset ${state.persistence.assetId} may remain. Retry approvals.persistenceFinish for exact cleanup; current health is not checked.`;
              }
            }
            if (state.persistence?.stage === "stale") {
              next = "A later lifecycle change invalidated current acceptance. Review approvals.persistenceStart for a fresh canary.";
              if (state.lastLifecycle === "stopped") {
                next = "A later stop invalidated current acceptance. Review approvals.up first, then create a fresh canary.";
              }
              if (state.persistence.cleanup === "pending") {
                approvals.persistenceFinish = multiPersistenceApproval(state, "persistence-finish");
                next = `Prior proof is stale and test asset ${state.persistence.assetId} may remain. Clean that exact asset before a fresh canary.`;
                if (state.lastLifecycle === "stopped") {
                  next = "Prior proof is stale and its asset cleanup is pending. Review approvals.up first, then approvals.persistenceFinish for cleanup.";
                }
              }
            }
          }
        }
      }
      if (state.appId === "immich" && state.immichHomarrKey?.stage === "attempted") {
        next = "A limited Homarr key creation was attempted. Review app homarr-immich-key-plan and inspect Immich before any retry; a one-time secret may be unavailable.";
      }
      if (state.appId === "immich" && state.immichHomarrKey?.stage === "saved") {
        next = "The limited Homarr key secret was saved but its permissions are not yet verified. Review app homarr-immich-key-plan before attachment.";
      }
      if (state.appId === "immich" && state.immichHomarrKey?.stage === "verified") {
        next = "The limited Immich key was verified when recorded. Native Homarr integration and widget still require separate plan, apply, and live status checks.";
      }
    } else if (state) {
      approvals = { resume: state.approval };
      next = "Inspect the exact saved project and use approvals.resume to continue its partial Compose apply.";
    }
    const result = { schemaVersion: 1, command: `app ${options.action}`, appId: options.appId,
      status: state?.stage ?? "not-initialized", mutation: false,
      projectRoot: root, projectId: state?.projectId ?? null,
      dockerContext: state?.dockerContext ?? null,
      applyApproval: state?.approval ?? null,
      services: state ? savedServicePurposes(state) : [],
      images: state?.images ?? null, port: state?.port ?? null,
      homarrNetwork: state?.homarrNetwork ?? null,
      url: state ? `http://127.0.0.1:${state.port}` : null,
      composeTarget: state?.composeTarget ?? null,
      dataDirectory: state?.dataDirectory ?? null,
      privateFiles: state ? join(dirname(state.composeTarget), "secrets") : null,
      username: state?.onboarding.username ?? null,
      email: state?.onboarding.email ?? null,
      name: state?.onboarding.name ?? null,
      onboardingStage: state?.onboardingStage ?? null,
      homarrSetup: state?.homarrSetup ?? null,
      prowlarrOnboardingStage: state?.prowlarrSetup?.stage ?? null,
      apiKeyFile: state?.appId === "prowlarr" && state.prowlarrSetup?.stage === "login-verified"
        && await savedProwlarrApiKey(state) ? prowlarrKeyPath(state) : null,
      immichHomarrKey: state?.immichHomarrKey ? {
        stage: state.immichHomarrKey.stage,
        keyId: state.immichHomarrKey.keyId ?? null,
        attemptedAt: state.immichHomarrKey.attemptedAt,
        verifiedAt: state.immichHomarrKey.verifiedAt ?? null,
        keyFile: immichHomarrKeyPath(state),
      } : null,
      setupClosed: state?.onboardingStage === "closed" || state?.homarrSetup?.stage === "complete",
      photoRoundTripVerified: state?.photoCheck?.status === "passed",
      photoCheck: state?.photoCheck ?? null,
      documentRoundTripVerified: state?.paperlessDocument?.stage === "passed",
      ocrVerified: state?.paperlessDocument?.stage === "passed",
      paperlessDocument: state?.paperlessDocument ?? null,
      paperlessPersistence: state?.paperlessPersistence ?? null,
      paperlessCanaryGeneration: state?.paperlessGeneration ?? 0,
      paperlessPriorProofCount: state?.paperlessProofHistory?.length ?? 0,
      paperlessLatestPriorProof: state?.paperlessProofHistory?.at(-1) ?? null,
      paperlessRestartPersistenceRecorded: state?.paperlessPersistence?.stage === "accepted",
      paperlessCanaryCleanupPending: Boolean(state?.paperlessPersistence?.acceptedAt
        && state.paperlessPersistence.cleanup !== "trashed"),
      persistence: state?.persistence ?? null,
      restartPersistenceRecorded: state?.persistence?.stage === "accepted",
      testAssetCleanupPending: state?.persistence?.cleanup === "pending",
      restartPersistenceVerified: false,
      passwordFile: state ? join(dirname(state.composeTarget), "secrets", state.onboarding.fileId) : null,
      lastRecordedLifecycle: state?.lastLifecycle ?? null, approvals,
      lifecycleCommands: lifecycleCommands(options.appId, root, approvals),
      runtime, containerHealth: runtime?.health ?? "not-checked", acceptanceVerified: false, next };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (options.action === "info") {
      console.log(`${options.appId}: ${result.status}; ${result.url ?? "no saved URL"}`);
      for (const service of result.services) console.log(`  ${service.id}: ${service.purpose ?? "purpose unavailable; saved recipe changed or is missing"}`);
      console.log(`Data: ${result.dataDirectory ?? "not created"}. Credentials: ${result.passwordFile ?? "not prepared"}.`);
      printLifecycleCommands(result.lifecycleCommands, result.lastRecordedLifecycle);
      if (runtime) console.log(`Runtime: ${runtime.state}; container health: ${runtime.health} (checked ${runtime.checkedAt}).`);
      if (!runtime) console.log("Current container health was not checked.");
      console.log(`${next} Application acceptance was not checked.`);
    } else {
      let observation = "Container health was not checked.";
      if (runtime) observation = `Runtime ${runtime.state}, health ${runtime.health}.`;
      console.log(`${options.appId}: ${result.status}; ${result.url ?? "no saved URL"}. ${observation} ${next} Application acceptance was not checked.`);
    }
    return;
  }
  if (options.action === "resume" || options.action === "up" || options.action === "down") {
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("multi-service lifecycle needs the saved local Docker context without environment overrides");
    }
    const state = await readMultiState(root, options.appId);
    if (!state) fail("there is no saved multi-service app project");
    if (state.onboardingStage === "closing" && options.action !== "resume") {
      fail("Immich setup closure is in progress; use app close-plan and close-setup before lifecycle actions");
    }
    const currentRecipe = recipeForSavedMultiState(state);
    assertMultiStateRecipe(state, currentRecipe);
    if (options.action === "resume") {
      if (state.stage === "applied") fail("multi-service app apply is already recorded; use app status");
      if (options.approval !== state.approval) fail("multi-service resume needs the exact saved approval token");
      requireLocalDockerContext(state.dockerContext);
      const dataAncestor = await existingDataAncestor(state.dataDirectory);
      observation(hostReport(root, dataAncestor, state.port), root, dataAncestor, state.port,
        state.projectId, `${state.projectId}-private`, currentRecipe.storage.minimumFreeBytes);
      await applyMultiSaved(state, currentRecipe.recipe);
      const result = { schemaVersion: 1, command: "app resume", appId: options.appId,
        status: "applied-unverified", mutation: true, images: state.images,
        url: `http://127.0.0.1:${state.port}`, dataDirectory: state.dataDirectory,
        acceptance: currentRecipe.recipe.acceptance, acceptanceVerified: false };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`${options.appId}: Compose resumed at ${result.url}. Complete application acceptance separately.`);
      return;
    }
    if (state.stage !== "applied") fail("multi-service lifecycle needs a previously applied exact project");
    if (options.approval !== multiLifecycleApproval(state, options.action)) {
      fail(`app ${options.action} requires its exact separately reviewed status approval`);
    }
    requireLocalDockerContext(state.dockerContext);
    const owner = createSelfhostComposeOwner(state.manifest);
    const plan = await owner.plan();
    if (plan.render.target !== state.composeTarget) fail("saved multi-service lifecycle plan changed");
    await owner.checkRendered(plan);
    inspectMultiAppRuntime(state);
    if (options.action === "up") await owner.apply(plan, true);
    else await owner.stop(plan);
    const observed = inspectMultiAppRuntime(state);
    if (options.action === "up" && observed.state !== "running") {
      fail("multi-service app up returned but not every exact service is running");
    }
    if (options.action === "down" && observed.state !== "stopped") {
      fail("multi-service app down returned but an exact service is still running");
    }
    if (state.persistence && options.action === "down") {
      if (state.persistence.stage === "accepted") state.persistence.stage = "stale";
      if (state.persistence.stage === "awaiting-stop" || state.persistence.stage === "restarted") {
        state.persistence = { stage: "stopped", assetId: state.persistence.assetId,
          imageSha256: state.persistence.imageSha256,
          startedAt: state.persistence.startedAt, stoppedAt: new Date().toISOString() };
      }
    }
    if (state.persistence?.stage === "stopped" && options.action === "up") {
      state.persistence = { ...state.persistence, stage: "restarted",
        restartedAt: new Date().toISOString() };
    }
    if (state.paperlessPersistence && options.action === "down") {
      if (state.paperlessPersistence.stage === "accepted") state.paperlessPersistence.stage = "stale";
      if (state.paperlessPersistence.stage === "awaiting-stop"
        || state.paperlessPersistence.stage === "restarted") {
        state.paperlessPersistence = { stage: "stopped",
          documentId: state.paperlessPersistence.documentId,
          imageSha256: state.paperlessPersistence.imageSha256,
          startedAt: state.paperlessPersistence.startedAt,
          stoppedAt: new Date().toISOString() };
      }
    }
    if (state.paperlessPersistence?.stage === "stopped" && options.action === "up") {
      state.paperlessPersistence = { ...state.paperlessPersistence, stage: "restarted",
        restartedAt: new Date().toISOString() };
    }
    state.lastLifecycle = options.action === "up" ? "running" : "stopped";
    await writeState(state, false);
    const result = { schemaVersion: 1, command: `app ${options.action}`, appId: options.appId,
      status: options.action === "up" ? "started-unverified" : "stopped",
      mutation: true, projectId: state.projectId, containerState: observed.state,
      containerHealth: observed.health, dataDirectory: state.dataDirectory,
      url: `http://127.0.0.1:${state.port}`, acceptanceVerified: false };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${options.appId}: ${result.status}; ${observed.state}. Application acceptance remains separate.`);
    return;
  }
  if (options.action !== "plan" && options.action !== "apply") fail("unsupported multi-service app action");
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail("multi-service planning needs the inspected local Docker context without environment overrides");
  }
  const currentRecipe = selected ?? recipeFor(options.appId);
  const { recipe, defaults, storage, recipeSha256 } = currentRecipe;
  if (recipe.schemaVersion !== 2 || !options.port) fail("multi-service planning needs a validated recipe and port");
  if (options.connectHomarr && options.appId === "homarr") {
    fail("Homarr cannot connect its own project to itself");
  }
  const onboarding = configuredMultiOnboarding(recipe, options.email, options.name);
  if (options.action === "apply" && !currentRecipe.boundedApply) {
    fail("catalog recipe is not yet supported by the bounded app installer");
  }
  await assertPackagedCatalogProject(root);
  const projectId = projectIdFor(root, options.appId);
  const appsRoot = join(root, ".selfhost", "apps");
  const defaultDataRoot = join(root, ".selfhost", "app-data");
  const dataRoot = dataParentFor(root, options.dataParent);
  const projectDirectory = join(appsRoot, projectId);
  const dataDirectory = join(dataRoot, defaults.dataDirectoryName);
  const networkName = `${projectId}-private`;
  await checkExistingParent(join(root, ".selfhost"), ".selfhost");
  await checkExistingParent(appsRoot, "app project parent");
  await checkDataParent(dataRoot, defaultDataRoot);
  await checkExistingParent(stateDirectory(root), "app state parent");
  await requireAbsent(statePath(root, options.appId), "app state");
  await requireAbsent(projectDirectory, "app Compose project directory");
  await requireAbsent(dataDirectory, "app data directory");
  const dataAncestor = await existingDataAncestor(dataRoot);
  const hostFacts = hostReport(root, dataAncestor, options.port);
  const observed = observation(hostFacts, root, dataAncestor,
    options.port, projectId, networkName, storage.minimumFreeBytes);
  let timezone: string | undefined;
  if (recipe.services.some((service: RecordValue) => service.hostEnvironment?.some(
    (binding: RecordValue) => binding.name === "TZ" && binding.source === "timezone"))) {
    const hostTimezone = record(record(hostFacts.identity, "host identity").timezone, "host timezone");
    if (hostTimezone.state !== "observed" || typeof hostTimezone.value !== "string") {
      fail("this recipe needs an observed host timezone; inspect or choose a supported IANA zone before apply");
    }
    timezone = hostTimezone.value;
  }
  const observedVolumes = observedRecipeVolumes(recipe, projectId, observed.dockerContext);
  const homarrNetwork = options.connectHomarr
    ? await inspectedStandaloneHomarrNetwork(root, observed.dockerContext) : undefined;
  let imageSpecifications = options.images;
  let imageProvenance = "operator-supplied digests; registry resolution not verified by this command";
  if (options.resolveImages) {
    const resolved = await resolveImage(options.appId);
    if (resolved.recipeSha256 !== recipeSha256 || !Array.isArray(resolved.images)) {
      fail("multi-service recipe changed during image resolution");
    }
    imageSpecifications = resolved.images.map((entry: RecordValue) => `${entry.service}=${entry.image}`);
    imageProvenance = "Docker Buildx registry manifests resolved for this host";
  }
  let images: Record<string, string>;
  try {
    images = pinnedMultiServiceImages(recipe, imageSpecifications);
  } catch (error) {
    if (!(error instanceof Error) || ![
      "Provide one --image SERVICE=TAG@sha256:DIGEST for each recipe service",
      "Each image must use SERVICE=TAG@sha256:DIGEST",
      "Pinned image does not match one unique recipe service and tag",
    ].includes(error.message)) throw error;
    const ids = recipe.services.map((service: RecordValue) => service.id).join(", ");
    fail(`Multi-service --image needs SERVICE=TAG@sha256:DIGEST once per service (${ids}); review the pinned recipe tags`,
      "invalid-image-specification", false);
  }
  const uid = process.getuid();
  const gid = process.getgid();
  const manifest = multiServiceManifest({ recipe, images, projectId, appsRoot, projectDirectory,
    dataDirectory, dockerContext: observed.dockerContext, port: options.port,
    uid, gid, timezone, homarrNetwork, observed: { ...observed, volumes: observedVolumes } });
  const compose = await createSelfhostComposeOwner(manifest).plan();
  const approval = multiApprovalFor({ appId: options.appId, projectRoot: root, images,
    port: options.port, recipeSha256, dockerContext: observed.dockerContext,
    dataDirectory, networkName, uid, gid, timezone, homarrNetwork,
    accountIdentity: multiAccountIdentity(recipe, onboarding) });
  const publishedService = recipe.services.find((candidate: RecordValue) => candidate.publishTargetPort !== null);
  if (!publishedService) fail("multi-service recipe has no private published service");
  const servicePurposes = recipe.services.map((service: RecordValue) => ({ id: service.id, purpose: service.purpose }));
  let onboardingGate = "Apply supplies first-admin creation settings; login and persisted data still require direct checks.";
  if (onboarding.kind === "api-first-admin") {
    onboardingGate = "The first administrator needs an API login check and setup closure after Compose apply.";
  }
  if (onboarding.kind === "manual-first-admin" && options.appId === "homarr") {
    onboardingGate = "Apply prepares the administrator password; a separate approved app onboard call creates and verifies the Homarr account, board setup, and API key. Integrations still need direct checks.";
  }
  if (onboarding.kind === "manual-first-admin" && options.appId === "prowlarr") {
    onboardingGate = "Apply prepares the private administrator password; a separate approved app onboard call enables required Forms auth and verifies login. No indexer is configured or tested.";
  }
  if (onboarding.kind === "external-first-admin") {
    onboardingGate = "First admin creation requires a selected media-server administrator and a verified private connection; this preview cannot apply or initialize Seerr.";
  }
  const result = { schemaVersion: 1, command: "app plan",
    status: currentRecipe.boundedApply ? "candidate" : "preview", mutation: false,
    appId: options.appId, recipeSha256, images, imageProvenance, servicePurposes,
    containerReadableConfigs: generatedConfigReadability(recipe),
    onboarding: { kind: onboarding.kind, username: onboarding.username ?? null,
      email: onboarding.email ?? null, name: onboarding.name ?? null,
      passwordFile: onboarding.fileId ? join(projectDirectory, "secrets", onboarding.fileId) : null,
      accountVerified: false },
    host: { inspectedAt: observed.checkedAt, dockerContext: observed.dockerContext,
      projectRoot: root, dataStorageAncestor: observed.storage.dataAncestor,
      filesystemType: observed.storage.filesystemType, availableBytes: observed.storage.availableBytes,
      timezone: timezone ?? null },
    compose: { projectId, planId: compose.planId, directory: projectDirectory,
      renderTarget: compose.render.target,
      publishedPort: `${defaults.hostIp}:${options.port}:${publishedService.publishTargetPort}/tcp`,
      dataDirectory, network: networkName, homarrNetwork: homarrNetwork ?? null,
      serviceCount: manifest.services.length,
      privateFiles: join(projectDirectory, "secrets") },
    remainingGates: ["Verify the Docker context targets this inspected Linux host.",
      "Review every pinned image and the image-default container users.",
      ...(homarrNetwork ? ["The frontend joins Homarr's exact owned bridge; verify the live Homarr-to-app endpoint and integration separately."] : []),
      onboardingGate,
      ...recipe.acceptance.map((check: RecordValue) => check.description)],
    approval: currentRecipe.boundedApply ? approval : null,
    applyAvailable: currentRecipe.boundedApply,
    applied: false, dockerMutation: false, acceptanceVerified: false };
  if (!currentRecipe.boundedApply) {
    result.remainingGates.unshift("This bundled recipe is not connected to bounded apply yet.");
  }
  if (options.action === "apply") {
    if (options.approval !== approval) {
      fail("multi-service apply approval does not match the fresh recipe, images, port, paths and Docker context");
    }
    requireLocalDockerContext(observed.dockerContext);
    await ensurePrivateDirectory(join(root, ".selfhost"), ".selfhost");
    await ensurePrivateIgnore(root);
    await ensurePrivateDirectory(appsRoot, "app project parent");
    if (dataRoot === defaultDataRoot) await ensurePrivateDirectory(dataRoot, "app data parent");
    await ensurePrivateDirectory(stateDirectory(root), "app state parent");
    const state: MultiAppState = { schemaVersion: 2, appId: options.appId, recipeSha256,
      approval, images, port: options.port, uid, gid, projectRoot: root,
      dockerContext: observed.dockerContext, projectId, composeTarget: compose.render.target,
      dataDirectory, manifest, onboarding, stage: "approved" };
    if (timezone) state.timezone = timezone;
    if (homarrNetwork) state.homarrNetwork = homarrNetwork;
    if (onboarding.kind === "api-first-admin") state.onboardingStage = "pending";
    if (options.appId === "homarr" && onboarding.kind === "manual-first-admin") {
      state.homarrSetup = { stage: "pending", boardName: "personal" };
    }
    await writeState(state, true);
    await applyMultiSaved(state, recipe);
    const applied = { schemaVersion: 1, command: "app apply", appId: options.appId,
      status: "applied-unverified", mutation: true, projectId, images, servicePurposes,
      url: `http://${defaults.hostIp}:${options.port}`, dataDirectory,
      homarrNetwork: homarrNetwork ?? null,
      privateFiles: join(projectDirectory, "secrets"), composeTarget: compose.render.target,
      username: onboarding.username,
      email: onboarding.email ?? null,
      name: onboarding.name ?? null,
      passwordFile: join(projectDirectory, "secrets", onboarding.fileId),
      acceptance: recipe.acceptance, acceptanceVerified: false };
    if (options.json) console.log(JSON.stringify(applied, null, 2));
    else {
      console.log(`${options.appId}: Compose applied at ${applied.url}.`);
      for (const service of servicePurposes) console.log(`  ${service.id}: ${service.purpose}`);
      if (onboarding.kind === "api-first-admin") {
        console.log(`Next: self-host app status --id ${options.appId} --project-root ${root} --json, then approve app onboard and app close-setup separately.`);
      }
      if (onboarding.kind === "manual-first-admin" && options.appId === "homarr") {
        console.log(`Next: self-host app status --id ${options.appId} --project-root ${root} --json, then review approvals.onboard to create the admin, board setup, and API key. No integration has been verified.`);
      }
      if (onboarding.kind === "manual-first-admin" && options.appId === "prowlarr") {
        console.log(`Next: self-host app status --id prowlarr --project-root ${root} --json, then review approvals.onboard to enable Forms auth and verify login. No indexer has been configured.`);
      }
      console.log("Complete the recipe's acceptance checks before treating this app as verified.");
    }
    return;
  }
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    if (currentRecipe.boundedApply) {
      console.log(`${options.appId}: reviewed ${manifest.services.length}-service plan ${compose.planId}; approval ${approval}. No resources changed.`);
    } else {
      console.log(`${options.appId}: previewed ${manifest.services.length}-service plan ${compose.planId}. Apply is unavailable; no resources changed.`);
    }
    for (const service of servicePurposes) console.log(`  ${service.id}: ${service.purpose}`);
    for (const file of result.containerReadableConfigs) {
      console.log(`  ${file.fileId}: non-secret, read-only container config, mode ${file.mode}; ${file.officialUrl}`);
    }
  }
}

async function homarrInputCommand(options: NonNullable<ReturnType<typeof parse>>, root: string): Promise<void> {
  if (options.appId === "homarr") fail("app homarr-input needs a separate saved application");
  await checkExistingParent(join(root, ".selfhost"), ".selfhost");
  await checkExistingParent(stateDirectory(root), "app state parent");
  const homarr = await readMultiState(root, "homarr");
  if (!homarr || homarr.stage !== "applied" || homarr.homarrSetup?.stage !== "complete") {
    fail("app homarr-input needs Homarr applied with onboarding complete in this project root");
  }
  const keyFile = homarrKeyPath(homarr);
  const keyMetadata = await lstat(keyFile);
  if (!keyMetadata.isFile() || keyMetadata.isSymbolicLink() || keyMetadata.nlink !== 1
    || keyMetadata.uid !== process.getuid?.() || (keyMetadata.mode & 0o777) !== 0o600
    || await realpath(keyFile) !== keyFile || !await savedHomarrApiKey(homarr)) {
    fail("saved Homarr API key must be an owner-only regular mode-0600 file");
  }
  const rawApp = await readRawState(root, options.appId);
  if (!rawApp) fail("app homarr-input needs a saved application in this project root");
  let app: AppState | MultiAppState | null = null;
  if (rawApp.schemaVersion === 1) app = await readState(root, options.appId);
  if (rawApp.schemaVersion === 2) app = await readMultiState(root, options.appId);
  if (!app || app.stage !== "applied") fail("app homarr-input needs an applied saved application");
  let savedRecipeSha256: string;
  if (app.schemaVersion === 2) savedRecipeSha256 = recipeForSavedMultiState(app, false).recipeSha256;
  else savedRecipeSha256 = recipeFor(options.appId, false).recipeSha256;
  if (savedRecipeSha256 !== app.recipeSha256) {
    fail("saved application recipe differs from the current catalog; review the app before preparing Homarr input");
  }

  const catalogRouter = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const catalogRunner = catalogRouter.endsWith(".ts") ? "bun" : process.execPath;
  const catalog = runJson(catalogRunner, [catalogRouter, "catalog", "show", options.appId, "--json"], "catalog app");
  if (catalog.schemaVersion !== 1 || catalog.status !== "pass" || catalog.command !== "catalog show"
    || catalog.mutation !== false) fail("catalog did not return validated read-only app facts");
  const selected = record(record(catalog.data, "catalog data").app, "catalog app");
  if (selected.id !== options.appId || typeof selected.name !== "string"
    || typeof selected.purpose !== "string") fail("catalog app name or purpose is unavailable");

  const directory = join(root, ".selfhost", "homarr-attach");
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
    || directoryMetadata.uid !== process.getuid?.() || (directoryMetadata.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) fail("Homarr input directory must be owner-only (0700)");
  const inputFile = join(directory, `${options.appId}.v2.json`);
  const legacyInputFile = join(directory, `${options.appId}.json`);
  const savedPath = existsSync(inputFile) ? inputFile : legacyInputFile;
  let savedInput: ReturnType<typeof validateHomarrAttachInput> | null = null;
  try {
    const metadata = await lstat(savedPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
      || await realpath(savedPath) !== savedPath || metadata.size < 1 || metadata.size > 32 * 1024) {
      fail("existing Homarr input is not an owner-only regular file");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(savedPath, "utf8")); }
    catch { fail("existing Homarr input is invalid JSON; inspect its owner-only file"); }
    savedInput = validateHomarrAttachInput(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const catalogIcon = record(selected.homarr, "catalog Homarr metadata").iconUrl;
  if (options.routeRevision && (savedInput === null || savedInput.schemaVersion !== 2
    || savedInput.service.id !== options.appId
    || savedInput.service.name !== selected.name
    || savedInput.service.storagePath !== app.dataDirectory
    || savedInput.homarr.origin !== `http://127.0.0.1:${homarr.port}`
    || savedInput.homarr.boardName !== homarr.homarrSetup.boardName)) {
    fail("route revision needs the exact saved version-2 input for this app and Homarr board");
  }
  const iconUrl = options.iconUrl ?? savedInput?.service.iconUrl ?? catalogIcon;
  if (typeof iconUrl !== "string") {
    fail("this app has no catalog Homarr icon; pass --icon-url with a reviewed HTTPS icon");
  }
  let icon: URL;
  try { icon = new URL(iconUrl); } catch { fail("Homarr icon must be an absolute HTTPS URL"); }
  if (icon.protocol !== "https:") fail("Homarr icon must use HTTPS");
  const explicitHref = options.href !== null || savedInput?.service.access === "route-unverified";
  const href = options.href ?? savedInput?.service.href ?? `http://127.0.0.1:${app.port}`;
  let credentialFile = credentialPath(root, options.appId);
  if (app.schemaVersion === 2) {
    credentialFile = join(dirname(app.composeTarget), "secrets", app.onboarding.fileId);
  }
  if (options.routeRevision && savedInput?.service.credentialFile !== credentialFile) {
    fail("route revision needs the saved credential reference for this exact app");
  }
  const input = validateHomarrAttachInput({ schemaVersion: 2,
    homarr: { origin: `http://127.0.0.1:${homarr.port}`, boardName: homarr.homarrSetup.boardName },
    service: options.routeRevision && savedInput !== null
      ? { ...savedInput.service, href, access: "route-unverified" }
      : { id: options.appId, name: selected.name, description: selected.purpose,
        href, iconUrl, access: explicitHref ? "route-unverified" : "local",
        storagePath: app.dataDirectory, credentialFile } });
  if (options.routeRevision && savedInput?.service.href === input.service.href) {
    fail("route revision must change the saved browser link");
  }

  const contents = `${JSON.stringify(input, null, 2)}\n`;
  const targetInputFile = options.routeRevision
    ? join(directory, `${options.appId}.route-${createHash("sha256").update(contents).digest("hex")}.v2.json`)
    : inputFile;
  let created = false;
  try {
    const handle = await open(targetInputFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const metadata = await lstat(targetInputFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
      || await realpath(targetInputFile) !== targetInputFile || metadata.size !== Buffer.byteLength(contents)
      || await readFile(targetInputFile, "utf8") !== contents) {
      fail("existing Homarr input is not an identical owner-only file; review it before replacing anything");
    }
  }
  const planCommand = shellCommand(["self-host", "homarr", "attach", "plan",
    "--input", targetInputFile, "--api-key-file", keyFile,
    ...(options.routeRevision ? ["--repair-existing-link"] : [])]);
  const result = { schemaVersion: 1, command: "app homarr-input", appId: options.appId,
    status: created ? "created" : "already-current", mutation: created, inputFile: targetInputFile,
    revisionOf: options.routeRevision ? savedPath : null,
    apiKeyFile: keyFile, href: input.service.href, iconUrl, access: input.service.access,
    credentialFile,
    nextCommand: planCommand,
    limitations: ["This prepares input only; no Homarr shortcut, companion Notebook, integration, or widget was created.",
      explicitHref ? "The supplied route is not verified as private or reachable."
        : "The loopback link is local to the host; it does not prove remote browser access.",
      "Saved apply state does not prove current app health or Homarr board rendering."] };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Homarr attach input ${created ? "created" : "already current"}: ${targetInputFile}`);
    console.log(`Next: ${planCommand}`);
    console.log(result.limitations.join(" "));
  }
}

function reviewedUptimeUrl(value: string): string {
  if (value.trim() !== value || value.length < 1 || value.length > 2048
    || /[\u0000-\u001f\u007f]/.test(value)) fail("Uptime Kuma URL is invalid");
  let parsed: URL;
  try { parsed = new URL(value); } catch { fail("Uptime Kuma URL must be absolute HTTP(S)"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail("Uptime Kuma URL must be a credential-free HTTP(S) origin without path, query, or fragment");
  }
  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    const parts = host.split(".").map(Number);
    const privateIpv4 = parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && (parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127));
    if (host !== "localhost" && host !== "[::1]" && !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(host)
      && !privateIpv4) fail("HTTP Uptime Kuma URL must use a private or local host");
  }
  return parsed.href;
}

async function uptimeSlugFromStdin(): Promise<string> {
  if (process.stdin.isTTY) fail("--slug-stdin requires a piped raw status-page slug");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 256) fail("status-page slug on stdin exceeds the bounded input size");
    chunks.push(bytes);
  }
  let value = Buffer.concat(chunks).toString("utf8");
  if (value.endsWith("\r\n")) value = value.slice(0, -2);
  else if (value.endsWith("\n")) value = value.slice(0, -1);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    fail("status-page slug on stdin has unsupported characters");
  }
  return value.toLowerCase();
}

async function homarrUptimeInputCommand(options: NonNullable<ReturnType<typeof parse>>, root: string): Promise<void> {
  if (options.appId !== "uptime-kuma") fail("app homarr-uptime-input supports only --id uptime-kuma");
  await checkExistingParent(join(root, ".selfhost"), ".selfhost");
  await checkExistingParent(stateDirectory(root), "app state parent");
  const homarr = await readMultiState(root, "homarr");
  if (!homarr || homarr.stage !== "applied" || homarr.homarrSetup?.stage !== "complete"
    || homarr.homarrNetwork !== undefined || recipeFor("homarr", false).recipeSha256 !== homarr.recipeSha256) {
    fail("app homarr-uptime-input needs the saved, complete standalone Homarr from the current recipe");
  }
  const keyFile = homarrKeyPath(homarr);
  const keyMetadata = await lstat(keyFile);
  if (!keyMetadata.isFile() || keyMetadata.isSymbolicLink() || keyMetadata.nlink !== 1
    || keyMetadata.uid !== process.getuid?.() || (keyMetadata.mode & 0o777) !== 0o600
    || await realpath(keyFile) !== keyFile || !await savedHomarrApiKey(homarr)) {
    fail("saved Homarr API key must be an owner-only regular mode-0600 file");
  }
  const app = await readState(root, "uptime-kuma");
  const selected = recipeFor("uptime-kuma", false);
  if (!app || app.stage !== "applied" || app.homarrNetwork !== `${homarr.projectId}-private`
    || selected.recipe.schemaVersion !== 1 || selected.recipeSha256 !== app.recipeSha256
    || !Number.isInteger(selected.service?.targetPort) || selected.service.targetPort < 1
    || selected.service.targetPort > 65535 || selected.service.id !== "uptime-kuma"
    || app.manifest.services?.[0]?.id !== selected.service.id
    || app.manifest.services?.[0]?.ports?.[0]?.target !== selected.service.targetPort) {
    fail("Uptime Kuma needs a saved applied single-service recipe on Homarr's exact approved shared bridge");
  }
  const catalogRouter = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const catalogRunner = catalogRouter.endsWith(".ts") ? "bun" : process.execPath;
  const catalog = runJson(catalogRunner, [catalogRouter, "catalog", "show", "uptime-kuma", "--json"], "catalog app");
  if (catalog.schemaVersion !== 1 || catalog.status !== "pass" || catalog.command !== "catalog show"
    || catalog.mutation !== false) fail("catalog did not return validated read-only app facts");
  const catalogApp = record(record(catalog.data, "catalog data").app, "catalog app");
  const homarrMetadata = record(catalogApp.homarr, "catalog Homarr metadata");
  if (catalogApp.id !== "uptime-kuma" || catalogApp.name !== "Uptime Kuma"
    || homarrMetadata.integration !== "Uptime Kuma") {
    fail("catalog Uptime Kuma integration metadata differs from the reviewed contract");
  }
  const url = reviewedUptimeUrl(options.url ?? `http://${selected.service.id}:${selected.service.targetPort}`);
  const slug = options.slugStdin ? await uptimeSlugFromStdin() : null;
  const input = { schemaVersion: 1,
    homarr: { origin: `http://127.0.0.1:${homarr.port}`, boardName: homarr.homarrSetup.boardName },
    uptimeKuma: { appName: catalogApp.name, integrationName: homarrMetadata.integration, url } };
  const directory = join(root, ".selfhost", "homarr-attach");
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
    || directoryMetadata.uid !== process.getuid?.() || (directoryMetadata.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) fail("Homarr input directory must be owner-only (0700)");
  const inputFile = join(directory, "uptime-kuma-integration.json");
  const contents = `${JSON.stringify(input, null, 2)}\n`;
  let created = false;
  try {
    const handle = await open(inputFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const metadata = await lstat(inputFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
      || await realpath(inputFile) !== inputFile || metadata.size !== Buffer.byteLength(contents)
      || await readFile(inputFile, "utf8") !== contents) {
      fail("existing Uptime Kuma integration input differs; review it before replacing anything");
    }
  }
  let slugFile: string | null = null;
  let slugCreated = false;
  const savedSlugFile = join(directory, "uptime-kuma-status-slug");
  if (slug !== null) {
    slugFile = savedSlugFile;
    try {
      const handle = await open(slugFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(slug); await handle.sync(); }
      finally { await handle.close(); }
      slugCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const metadata = await lstat(slugFile);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
        || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
        || await realpath(slugFile) !== slugFile || metadata.size !== Buffer.byteLength(slug)
        || await readFile(slugFile, "utf8") !== slug) {
        fail("existing Uptime Kuma status-page slug differs; review its owner-only file before replacing anything");
      }
    }
  } else {
    try {
      const metadata = await lstat(savedSlugFile);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
        || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
        || await realpath(savedSlugFile) !== savedSlugFile || metadata.size < 1 || metadata.size > 128
        || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(await readFile(savedSlugFile, "utf8"))) {
        fail("saved Uptime Kuma status-page slug is not a valid owner-only file");
      }
      slugFile = savedSlugFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const planArgs = ["self-host", "homarr", "attach", "uptime-kuma", "plan",
    "--input", inputFile, "--api-key-file", keyFile];
  if (slugFile !== null) planArgs.push("--slug-file", slugFile);
  const nextCommand = shellCommand(planArgs);
  const mutation = created || slugCreated;
  const result = { schemaVersion: 1, command: "app homarr-uptime-input", status: mutation ? "created" : "already-current",
    appId: "uptime-kuma", inputFile, apiKeyFile: keyFile, url, boardName: input.homarr.boardName,
    slugFile, nextCommand, mutation };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Homarr Uptime Kuma integration input ${mutation ? "created" : "already current"}: ${inputFile}`);
    console.log(`Next: ${nextCommand}`);
    console.log("Input preparation does not attach an integration or widget; live Homarr and Uptime Kuma behavior remains unverified.");
  }
}

async function writeIdenticalPrivateJson(path: string, value: unknown): Promise<boolean> {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
      || await realpath(path) !== path || metadata.size !== Buffer.byteLength(contents)
      || await readFile(path, "utf8") !== contents) {
      fail("existing Homarr Immich file differs or is not owner-only; inspect it before replacing anything");
    }
    return false;
  }
}

async function homarrPaperlessInputCommand(options: NonNullable<ReturnType<typeof parse>>, root: string): Promise<void> {
  if (options.appId !== "paperless-ngx") fail("app homarr-paperless-input supports only --id paperless-ngx");
  await checkExistingParent(join(root, ".selfhost"), ".selfhost");
  await checkExistingParent(stateDirectory(root), "app state parent");
  const homarr = await readMultiState(root, "homarr");
  const paperless = await readMultiState(root, "paperless-ngx");
  if (!homarr || homarr.stage !== "applied" || homarr.homarrSetup?.stage !== "complete"
    || homarr.homarrNetwork !== undefined || !paperless || paperless.stage !== "applied"
    || paperless.homarrNetwork !== `${homarr.projectId}-private`
    || paperless.dockerContext !== homarr.dockerContext
    || paperless.onboarding.kind !== "initial-admin-from-file") {
    fail("native Paperless input needs exact applied Homarr and Paperless projects on Homarr's approved bridge");
  }
  assertMultiStateRecipe(homarr, recipeFor("homarr", false));
  assertMultiStateRecipe(paperless, recipeForSavedMultiState(paperless, false));
  const frontend = paperless.manifest.services.find((service: RecordValue) => service.id === "paperless-ngx");
  if (!frontend || frontend.ports?.[0]?.target !== 8000
    || JSON.stringify(frontend.networks) !== JSON.stringify(["private", "homarr"])) {
    fail("saved Paperless frontend does not match the approved Homarr bridge and port");
  }
  const homarrKeyFile = homarrKeyPath(homarr);
  const homarrKeyMetadata = await lstat(homarrKeyFile);
  if (!homarrKeyMetadata.isFile() || homarrKeyMetadata.isSymbolicLink() || homarrKeyMetadata.nlink !== 1
    || homarrKeyMetadata.uid !== process.getuid?.() || (homarrKeyMetadata.mode & 0o777) !== 0o600
    || await realpath(homarrKeyFile) !== homarrKeyFile || !await savedHomarrApiKey(homarr)) {
    fail("saved Homarr API key must be an owner-only mode-0600 regular file");
  }
  const tokenFile = join(dirname(paperless.composeTarget), "secrets", "paperless-api-token");
  const tokenStatus = await paperlessApiTokenCommand({ action: "paperless-token-status", approval: null,
    origin: `http://127.0.0.1:${paperless.port}`, username: paperless.onboarding.username,
    passwordFile: join(dirname(paperless.composeTarget), "secrets", paperless.onboarding.fileId),
    tokenFile, projectId: paperless.projectId, recipeSha256: paperless.recipeSha256 });
  if (tokenStatus.status !== "token-verified" || tokenStatus.apiKeyFile !== tokenFile
    || tokenStatus.adminVerified !== true || tokenStatus.apiVerified !== true) {
    fail("saved Paperless token is not verified for the exact managed administrator");
  }
  const catalogRouter = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const catalogRunner = catalogRouter.endsWith(".ts") ? "bun" : process.execPath;
  const catalog = runJson(catalogRunner, [catalogRouter, "catalog", "show", "paperless-ngx", "--json"], "catalog app");
  if (catalog.schemaVersion !== 1 || catalog.status !== "pass" || catalog.command !== "catalog show"
    || catalog.mutation !== false) fail("catalog did not return validated Paperless facts");
  const catalogApp = record(record(catalog.data, "catalog data").app, "catalog app");
  const metadata = record(catalogApp.homarr, "catalog Homarr metadata");
  if (catalogApp.id !== "paperless-ngx" || catalogApp.name !== "Paperless-ngx"
    || metadata.integration !== "Paperless-ngx") fail("catalog Paperless integration metadata differs from the native contract");
  const input = { schemaVersion: 1,
    homarr: { origin: `http://127.0.0.1:${homarr.port}`, boardName: homarr.homarrSetup.boardName },
    paperless: { appName: catalogApp.name, integrationName: metadata.integration, url: "http://paperless-ngx:8000/" } };
  const directory = join(root, ".selfhost", "homarr-attach");
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
    || directoryMetadata.uid !== process.getuid?.() || (directoryMetadata.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) fail("Homarr input directory must be owner-only (0700)");
  const inputFile = join(directory, "paperless-ngx-integration.json");
  const created = await writeIdenticalPrivateJson(inputFile, input);
  const nextCommand = shellCommand(["self-host", "homarr", "attach", "paperless", "plan",
    "--input", inputFile, "--api-key-file", homarrKeyFile, "--paperless-api-key-file", tokenFile]);
  const result = { schemaVersion: 1, command: "app homarr-paperless-input", appId: "paperless-ngx",
    status: created ? "created" : "already-current", mutation: created, inputFile,
    apiKeyFile: homarrKeyFile, paperlessApiKeyFile: tokenFile, nextCommand,
    limitations: ["Input preparation created no Homarr integration or widget.",
      "Homarr-to-Paperless reachability, widget stats, and board rendering remain unverified."] };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else { console.log(`Homarr Paperless integration input ${result.status}: ${inputFile}`);
    console.log(`Next: ${nextCommand}`); console.log(result.limitations.join(" ")); }
}

async function homarrImmichInputCommand(options: NonNullable<ReturnType<typeof parse>>, root: string): Promise<void> {
  if (options.appId !== "immich") fail("app homarr-immich-input supports only --id immich");
  await checkExistingParent(join(root, ".selfhost"), ".selfhost");
  await checkExistingParent(stateDirectory(root), "app state parent");
  const homarr = await readMultiState(root, "homarr");
  const immich = await readMultiState(root, "immich");
  if (!homarr || homarr.stage !== "applied" || homarr.homarrSetup?.stage !== "complete"
    || homarr.homarrNetwork !== undefined || !immich || immich.stage !== "applied"
    || immich.homarrNetwork !== `${homarr.projectId}-private`
    || homarr.dockerContext !== immich.dockerContext) {
    fail("native Immich input needs exact applied Homarr and Immich projects on Homarr's approved bridge");
  }
  assertMultiStateRecipe(homarr, recipeFor("homarr", false));
  assertMultiStateRecipe(immich, recipeFor("immich", false));
  if (immich.onboardingStage !== "closed" || immich.photoCheck?.status !== "passed"
    || immich.persistence?.stage !== "accepted" || immich.persistence.cleanup !== "trashed"
    || !immich.persistence.acceptedAt) {
    fail("native Immich input needs closed setup and an accepted, cleaned exact restart canary");
  }
  const appService = immich.manifest.services.find((service: RecordValue) => service.id === "immich");
  if (!appService || appService.ports?.[0]?.target !== 2283
    || JSON.stringify(appService.networks) !== JSON.stringify(["private", "homarr"])) {
    fail("saved Immich frontend does not match the supported Homarr bridge and port");
  }
  const homarrKeyFile = homarrKeyPath(homarr);
  const homarrKeyMetadata = await lstat(homarrKeyFile);
  if (!homarrKeyMetadata.isFile() || homarrKeyMetadata.isSymbolicLink() || homarrKeyMetadata.nlink !== 1
    || homarrKeyMetadata.uid !== process.getuid?.() || (homarrKeyMetadata.mode & 0o777) !== 0o600
    || await realpath(homarrKeyFile) !== homarrKeyFile || !await savedHomarrApiKey(homarr)) {
    fail("saved Homarr API key must be an owner-only regular mode-0600 file");
  }
  const homarrRuntime = await inspectSavedRuntime(homarr);
  const immichRuntime = await inspectSavedRuntime(immich);
  if (homarrRuntime.state !== "running" || immichRuntime.state !== "running"
    || immichRuntime.health !== "healthy") {
    fail("native Immich input needs Homarr running and the exact Immich project healthy now");
  }
  const { origin, password } = await verifiedImmichPhotoRuntime(immich);
  try { await verifyImmichAdminRelease(origin, immich.onboarding.email, password); }
  catch { fail("managed Immich admin login, release, or setup could not be verified now",
    "immich-admin-release-unverified"); }

  const catalogRouter = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const catalogRunner = catalogRouter.endsWith(".ts") ? "bun" : process.execPath;
  const catalog = runJson(catalogRunner, [catalogRouter, "catalog", "show", "immich", "--json"], "catalog app");
  if (catalog.schemaVersion !== 1 || catalog.status !== "pass" || catalog.command !== "catalog show"
    || catalog.mutation !== false) fail("catalog did not return validated read-only Immich facts");
  const catalogApp = record(record(catalog.data, "catalog data").app, "catalog app");
  const homarrMetadata = record(catalogApp.homarr, "catalog Homarr metadata");
  if (catalogApp.id !== "immich" || catalogApp.name !== "Immich" || homarrMetadata.integration !== "Immich") {
    fail("catalog Immich integration metadata differs from the reviewed native contract");
  }
  const integrationUrl = "http://immich:2283/";
  const input = { schemaVersion: 1,
    homarr: { origin: `http://127.0.0.1:${homarr.port}`, boardName: homarr.homarrSetup.boardName },
    immich: { appName: catalogApp.name, integrationName: "Immich", url: integrationUrl,
      widgets: [{ kind: "immich-serverStats", options: {
        showUsers: true, showPhotos: true, showVideos: true, showStorage: true,
      } }] } };
  const acceptance = { schemaVersion: 1, kind: "immich-service-acceptance", service: "immich",
    integrationUrl, status: "accepted", checks: [
      { id: "admin-login", status: "pass", evidenceRefs: [`immich:admin:${immich.projectId}`] },
      { id: "release-version", status: "pass", evidenceRefs: ["immich:version:v3.2.2"] },
      { id: "test-image-upload-retrieval", status: "pass", evidenceRefs: [
        `immich:asset:${immich.persistence.assetId}`, `sha256:${immich.persistence.imageSha256}`,
      ] },
    ] };
  const directory = join(root, ".selfhost", "homarr-attach");
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
    || directoryMetadata.uid !== process.getuid?.() || (directoryMetadata.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) fail("Homarr input directory must be owner-only (0700)");
  const inputFile = join(directory, "immich-integration.json");
  const acceptanceDigest = createHash("sha256").update(JSON.stringify(acceptance)).digest("hex");
  const acceptanceFile = join(directory, `immich-service-acceptance-${acceptanceDigest}.json`);
  const inputCreated = await writeIdenticalPrivateJson(inputFile, input);
  const acceptanceCreated = await writeIdenticalPrivateJson(acceptanceFile, acceptance);
  const result = { schemaVersion: 1, command: "app homarr-immich-input", appId: "immich",
    status: inputCreated || acceptanceCreated ? "created" : "already-current",
    mutation: inputCreated || acceptanceCreated, inputFile, acceptanceFile,
    apiKeyFile: homarrKeyFile, immichApiKeyFile: null, nextCommand: null,
    next: "A separate, explicitly approved Immich Homarr API-key creation is required. Save its one-time secret to an owner-only file, then plan the native Homarr Immich attachment using these input and acceptance files. No integration or widget was created.",
    limitations: ["The existing Immich app tile on Homarr's private board has not been checked by this command.",
      "The saved canary passed upload, exact retrieval, restart readback, and recoverable-trash cleanup; this command rechecked the admin and release but did not upload a new image.",
      "Homarr-to-Immich API reachability and native widget rendering remain unverified."] };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Homarr Immich input and acceptance ${result.status}: ${inputFile}, ${acceptanceFile}`);
    console.log(result.next);
    console.log(result.limitations.join(" "));
  }
}

function immichHomarrKeyPath(state: MultiAppState): string {
  return join(dirname(state.composeTarget), "secrets", "immich-homarr-api-key");
}

async function existingImmichHomarrKey(path: string): Promise<string | null> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
    || metadata.size < 24 || metadata.size > 4096 || await realpath(path) !== path) {
    fail("saved Immich Homarr key must be one current-user-owned mode-0600 regular file");
  }
  const secret = await readFile(path, "utf8");
  if (secret.trim() !== secret || /[\u0000-\u001f\u007f]/.test(secret)) {
    fail("saved Immich Homarr key format is invalid");
  }
  return secret;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function persistImmichHomarrKey(path: string, secret: string): Promise<void> {
  const handle = await open(path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(secret);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
  if (!await existingImmichHomarrKey(path)) fail("Immich Homarr key was not saved privately");
}

function immichHomarrKeyApproval(homarr: MultiAppState, immich: MultiAppState,
  keyFile: string): string {
  const digest = createHash("sha256").update(JSON.stringify({ schemaVersion: 1,
    action: "homarr-immich-key-create", keyFile, permissions: immichHomarrPermissions,
    homarr: { projectId: homarr.projectId, recipeSha256: homarr.recipeSha256,
      approval: homarr.approval, composeTarget: homarr.composeTarget,
      setup: homarr.homarrSetup, keyFile: homarrKeyPath(homarr) },
    immich: { projectId: immich.projectId, recipeSha256: immich.recipeSha256,
      approval: immich.approval, composeTarget: immich.composeTarget,
      onboarding: immich.onboarding, onboardingStage: immich.onboardingStage,
      homarrNetwork: immich.homarrNetwork, photoCheck: immich.photoCheck,
      persistence: immich.persistence },
  })).digest("hex");
  return `APP-HOMARR-IMMICH-KEY:immich:${digest}`;
}

async function homarrImmichKeyCommand(options: NonNullable<ReturnType<typeof parse>>,
  root: string): Promise<void> {
  if (options.appId !== "immich") fail("app Homarr Immich key commands support only --id immich");
  await checkExistingParent(join(root, ".selfhost"), ".selfhost");
  await checkExistingParent(stateDirectory(root), "app state parent");
  const homarr = await readMultiState(root, "homarr");
  const immich = await readMultiState(root, "immich");
  if (!homarr || homarr.stage !== "applied" || homarr.homarrSetup?.stage !== "complete"
    || homarr.homarrNetwork !== undefined || !immich || immich.stage !== "applied"
    || immich.homarrNetwork !== `${homarr.projectId}-private`
    || homarr.dockerContext !== immich.dockerContext) {
    fail("limited Immich key needs exact applied Homarr and Immich projects on Homarr's approved bridge");
  }
  assertMultiStateRecipe(homarr, recipeFor("homarr", false));
  assertMultiStateRecipe(immich, recipeFor("immich", false));
  if (immich.onboardingStage !== "closed" || immich.photoCheck?.status !== "passed"
    || immich.persistence?.stage !== "accepted" || immich.persistence.cleanup !== "trashed"
    || !immich.persistence.acceptedAt) {
    fail("limited Immich key needs closed setup and the accepted, cleaned exact restart canary");
  }
  const appService = immich.manifest.services.find((service: RecordValue) => service.id === "immich");
  if (!appService || appService.ports?.[0]?.target !== 2283
    || JSON.stringify(appService.networks) !== JSON.stringify(["private", "homarr"])) {
    fail("saved Immich frontend does not match the supported Homarr bridge and port");
  }
  if (!await savedHomarrApiKey(homarr)) fail("managed Homarr API key is unavailable");
  const homarrRuntime = await inspectSavedRuntime(homarr);
  const immichRuntime = await inspectSavedRuntime(immich);
  if (homarrRuntime.state !== "running" || immichRuntime.state !== "running"
    || immichRuntime.health !== "healthy") {
    fail("limited Immich key needs Homarr running and the exact Immich project healthy now");
  }
  const { origin, password } = await verifiedImmichPhotoRuntime(immich);
  try { await verifyImmichAdminRelease(origin, immich.onboarding.email, password); }
  catch { fail("managed Immich admin login, release, or setup could not be verified now"); }
  const catalogRouter = runtimeFile("./workflows/selfhost/scripts/selfhost.js",
    "../../../.agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts", "catalog router");
  const catalogRunner = catalogRouter.endsWith(".ts") ? "bun" : process.execPath;
  const catalog = runJson(catalogRunner, [catalogRouter, "catalog", "show", "immich", "--json"], "catalog app");
  if (catalog.schemaVersion !== 1 || catalog.status !== "pass" || catalog.command !== "catalog show"
    || catalog.mutation !== false) fail("catalog did not return validated read-only Immich facts");
  const catalogApp = record(record(catalog.data, "catalog data").app, "catalog app");
  const homarrMetadata = record(catalogApp.homarr, "catalog Homarr metadata");
  if (catalogApp.id !== "immich" || catalogApp.name !== "Immich"
    || homarrMetadata.integration !== "Immich") {
    fail("catalog Immich integration metadata differs from the reviewed native contract");
  }
  const keyFile = immichHomarrKeyPath(immich);
  await checkExistingParent(dirname(keyFile), "Immich private credential parent");
  const approval = immichHomarrKeyApproval(homarr, immich, keyFile);
  if (immich.immichHomarrKey && immich.immichHomarrKey.approval !== approval) {
    fail("saved Immich key attempt belongs to a different project or acceptance plan; inspect manually");
  }
  const secret = await existingImmichHomarrKey(keyFile);
  let inventory;
  try { inventory = await inspectImmichHomarrKeys(origin, immich.onboarding.email, password); }
  catch { fail("Immich admin or API key inventory could not be verified. No new key request was sent by this command; a prior attempt may still exist, so inspect Immich manually."); }
  let existingKeyId: string | null = null;
  if (secret !== null) {
    try { existingKeyId = await verifyImmichHomarrKey(origin, secret, immich.immichHomarrKey?.keyId); }
    catch { fail("saved limited Immich key did not verify with exact identity and permissions; inspect it manually"); }
    if (inventory.homarrIds.length !== 1 || inventory.homarrIds[0] !== existingKeyId) {
      fail("saved limited Immich key does not match one exact Homarr key in Immich inventory");
    }
  }
  if (options.action === "homarr-immich-key-plan") {
    const attemptedWithoutSecret = immich.immichHomarrKey !== undefined && secret === null;
    const unmanagedKey = secret === null && inventory.homarrIds.length !== 0;
    const blocked = attemptedWithoutSecret || unmanagedKey;
    let next = "Review the exact approval, then run app homarr-immich-key-create. Integration attachment is separate.";
    if (attemptedWithoutSecret) {
      next = "A key creation was already attempted but no secret is saved. Inspect or revoke the Homarr key in Immich manually; this command will not create a duplicate.";
    } else if (unmanagedKey) {
      next = "A Homarr key already exists in Immich without the managed secret. Inspect or revoke it manually; this command will not create a duplicate.";
    }
    const result = { schemaVersion: 1, command: "app homarr-immich-key-plan", appId: "immich",
      status: blocked ? "manual-recovery-required" : "ready-for-review", mutation: false,
      approval: blocked ? null : approval, keyFile, permissions: immichHomarrPermissions,
      operation: secret === null ? "create-one-limited-immich-key" : "verify-existing-key",
      integrationAttached: false, acceptanceVerified: false,
      next };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.status}: ${result.next}${result.approval ? ` Approval: ${result.approval}` : ""}`);
    return;
  }
  if (options.approval !== approval) fail("Immich Homarr key creation needs the exact fresh approval");
  if (immich.immichHomarrKey && secret === null) {
    fail("Immich Homarr key creation was attempted but its one-time secret is unavailable; inspect or revoke manually before recovery",
      "immich-key-manual-recovery", true);
  }
  if (secret !== null) {
    if (existingKeyId === null) fail("saved limited Immich key identity is missing");
    const keyId = existingKeyId;
    let recorded = false;
    if (immich.immichHomarrKey?.stage !== "verified") {
      immich.immichHomarrKey = { stage: "verified", approval,
        attemptedAt: immich.immichHomarrKey?.attemptedAt ?? new Date().toISOString(),
        keyId, verifiedAt: new Date().toISOString() };
      await writeState(immich, false);
      recorded = true;
    }
    const result = { schemaVersion: 1, command: "app homarr-immich-key-create", appId: "immich",
      status: "existing-key-verified", mutation: recorded, keyId, keyFile,
      permissions: immichHomarrPermissions, secretPrinted: false,
      integrationAttached: false, acceptanceVerified: false };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Existing limited Immich key ${keyId} verified; secret remains private at ${keyFile}. No integration was attached.`);
    return;
  }
  if (inventory.homarrIds.length !== 0) {
    fail("an Immich API key named Homarr already exists without a managed secret; inspect or revoke it manually");
  }
  const attemptedAt = new Date().toISOString();
  immich.immichHomarrKey = { stage: "attempted", approval, attemptedAt };
  await writeState(immich, false);
  await syncDirectory(stateDirectory(root));
  let created;
  try { created = await createImmichHomarrKey(origin, inventory.token); }
  catch { fail("Immich key POST may have created a key without a recoverable secret; inspect or revoke manually",
    "immich-key-manual-recovery", true); }
  try { await persistImmichHomarrKey(keyFile, created.secret); }
  catch { fail("Immich key was created but its one-time secret could not be saved; inspect or revoke manually",
    "immich-key-manual-recovery", true); }
  if (!created.metadataValid || typeof created.id !== "string") {
    fail("Immich returned unexpected key metadata; the private secret was retained for manual inspection or revoke",
      "immich-key-manual-recovery", true);
  }
  immich.immichHomarrKey = { stage: "saved", approval, attemptedAt, keyId: created.id };
  await writeState(immich, false);
  let verifiedId;
  try { verifiedId = await verifyImmichHomarrKey(origin, created.secret, created.id); }
  catch { fail("new Immich key did not verify with exact identity and permissions; private secret was retained for manual recovery",
    "immich-key-manual-recovery", true); }
  immich.immichHomarrKey = { stage: "verified", approval, attemptedAt,
    keyId: verifiedId, verifiedAt: new Date().toISOString() };
  await writeState(immich, false);
  const result = { schemaVersion: 1, command: "app homarr-immich-key-create", appId: "immich",
    status: "created-and-verified", mutation: true, keyId: verifiedId, keyFile,
    permissions: immichHomarrPermissions, secretPrinted: false,
    integrationAttached: false, acceptanceVerified: false };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Limited Immich key ${verifiedId} created and verified; secret saved privately at ${keyFile}. No integration was attached.`);
}

async function runAppCommand(args: string[]): Promise<void> {
  if (args[0] === "shared") {
    try {
      await sharedProjectCommand(args.slice(1), { recipeFor: (appId) => recipeFor(appId, false), appFor: catalogAppFor,
        resolveImage });
    } catch (error) {
      if (error instanceof SharedAcceptanceOwnerError) fail(error.message, error.code);
      if (error instanceof SharedRecipeMigrationError) fail(error.message, error.code);
      if (error instanceof SharedImageTransitionError) fail(error.message, error.code);
      throw error;
    }
    return;
  }
  if (args[0] === "batch") {
    await appBatchCommand(args.slice(1), appCommand, catalogWorkflowFor);
    return;
  }
  const options = parse(args);
  if (!options) {
    console.log("app shared plan|apply --project-root ABSOLUTE --project-id ID --app ID [--app ID ...] [--port APP=PORT ...] [--approve SHARED-APPLY:ID:DIGEST] [--secret-file APP:FILE=/absolute/mode-0600/path | --secret-stdin APP:FILE] [--json] (owner secret inputs apply-only; one new Compose project)");
    console.log("app shared add --project-root ABSOLUTE --project-id ID --app NEW_ID [--app NEW_ID ...] [--port APP=PORT ...] [--input APP.KEY=VALUE ...] [--approve SHARED-ADD:ID:DIGEST] [--secret-file APP:FILE=/absolute/mode-0600/path | --secret-stdin APP:FILE] [--json] (review then add only new services; inputs are bundled derived-recipe choices, secrets require approval)");
    console.log("app shared status --project-root ABSOLUTE --project-id ID [--json] (saved checkpoint and any pre-Docker resume approval)");
    console.log("app shared https-plan|https-apply --project-root ABSOLUTE --project-id ID --app INSTALLED_ID [--app INSTALLED_ID ...] [--hostname APP=NAME.localhost ...] [--https-port 4443] [--approve SHARED-HTTPS-ADD:ID:DIGEST] [--json] (review then add only Caddy; retain existing app units, data and credentials)");
    console.log("app shared https-proof --project-root ABSOLUTE --project-id ID [--approve SHARED-HTTPS-PROOF:ID:DIGEST] [--json] (review then export the owned public CA and verify exact TLS routes; no DNS, client trust or app settings changes)");
    console.log("app shared canonical-origin-plan|canonical-origin-apply --project-root ABSOLUTE --project-id ID --app ID [--approve CANONICAL-ORIGIN:APP:DIGEST] [--json] (review source-declared app origin settings only after saved HTTPS proof; scoped recreation preserves credentials and storage)");
    console.log("app shared start|stop --project-root ABSOLUTE --project-id ID --app ID [--app ID ...] [--approve SELECTED-START|STOP:ID:DIGEST] [--json] (review exact saved units, then scoped selected-service lifecycle; no volumes or project teardown)");
    console.log("app shared transition-plan|transition-apply --project-root ABSOLUTE --project-id ID --app ID [--approve TRANSITION:ID:DIGEST] [--json] (recipe-declared post-first-account environment change and scoped recreate; rerun setup to verify closure)");
    console.log("app shared recipe-migration-plan|recipe-migration-apply --project-root ABSOLUTE --project-id ID --app ID [--approve RECIPE-MIGRATION:APP:DIGEST] [--json] (exact additive static environment only; recreate selected unit without regenerating credentials or deleting data)");
    console.log("app shared image-transition-plan|image-transition-apply --project-root ABSOLUTE --project-id ID --app ID [--approve IMAGE-TRANSITION:APP:DIGEST] [--json] (digest-pinned image changes only; recreate one running saved app unit, retain credentials and data)");
    console.log("app shared resume --project-root ABSOLUTE --project-id ID --approve SAVED_TOKEN [--secret-file APP:FILE=/absolute/mode-0600/path | --secret-stdin APP:FILE] [--json] (reviewed pre-Docker create only; saved owner files may be reused without input)");
    console.log("app shared setup --project-root ABSOLUTE --project-id ID --app ID [--app ID ...] [--input APP.KEY=VALUE ...] [--approve SHARED-SETUP:ID:DIGEST] [--approve-step APP-SETUP-ACTION:ID:DIGEST] [--json] (saved passwords, non-secret app choices, direct first-run adapters, stepwise exact approvals)");
    console.log("app shared handoff --project-root ABSOLUTE --project-id ID --app ID [--show] [--json] (private credential references; --show deliberately prints the saved password and key)");
    console.log("app shared homarr-plan|homarr-apply --project-root ABSOLUTE --project-id ID --app ID [--app ID ...] [--input APP.KEY=VALUE ...] [--approve SHARED-HOMARR:ID:DIGEST] [--json] (review then publish tiles, supported integrations/widgets, and the stack recap using saved credentials; separate acceptance)");
    console.log("app shared homarr-trust-plan|homarr-trust-apply --project-root ABSOLUTE --project-id ID --app ID [--approve SHARED-HOMARR-TRUST:ID:DIGEST for apply] [--json] (review then add only the verified owned HTTPS root CA to Homarr server trust; no client trust or integration acceptance)");
    console.log("app shared homarr-status --project-root ABSOLUTE --project-id ID --app ID [--app ID ...] [--input homarr.board-name=NAME] [--live] [--json] (read-only private dashboard structure; --live also checks Homarr-origin reachability and supported widget data, not rendered acceptance or integration retests)");
    console.log("app shared remove --project-root ABSOLUTE --project-id ID --app ID [--app ID ...] [--apply --approval SHARED-REMOVE:ID:DIGEST] [--json] (review then remove only selected containers; data and credentials remain; retained dependencies and final-unit removal are blocked)");
    console.log("app shared job-plan|job-run --project-root ABSOLUTE --project-id ID --app JOB [--approve SHARED-JOB-PROBE:ID:DIGEST] [--json] (prepared manual jobs only; fixed version probe, never backups or repository updates)");
    console.log("app shared acceptance-begin|acceptance-finish --project-root ABSOLUTE --project-id ID --app ntfy|paperless-ngx [--input APP.KEY=VALUE] [--approve TOKEN] [--approve-step TOKEN] [--json] (review an app-owned workload and selected data-preserving restart; no first-run or Homarr credit)");
    console.log("app batch plan|apply|status|info|resume-plan|resume --project-root ABSOLUTE [--json] (mixed bounded recipes; see app batch help)");
    console.log("app image --id ID [--json] (read-only registry resolution)\napp plan --id ID --project-root ABSOLUTE (--resolve-images | --image IMAGE@sha256:DIGEST) --port PORT [--json]\napp plan --id MULTI_ID --project-root ABSOLUTE (--resolve-images | --image SERVICE=IMAGE@sha256:DIGEST [--image SERVICE=IMAGE@sha256:DIGEST ...]) --port PORT [--json]\napp apply --id ID --project-root ABSOLUTE --image IMAGE@sha256:DIGEST --port PORT --approve APP-APPLY:ID:DIGEST [--json]\napp apply --id MULTI_ID --project-root ABSOLUTE --image SERVICE=IMAGE@sha256:DIGEST [--image SERVICE=IMAGE@sha256:DIGEST ...] --port PORT --approve APP-APPLY:MULTI_ID:DIGEST [--json]\napp resume --id ID --project-root ABSOLUTE --approve SAVED_TOKEN [--json]\napp status|info --id ID --project-root ABSOLUTE [--live] [--json]\napp up|down --id ID --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN [--json]\napp onboard --id immich|homarr|uptime-kuma --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN [--json]\napp close-plan --id immich --project-root ABSOLUTE [--json]\napp close-setup --id immich --project-root ABSOLUTE --approve EXACT_CLOSE_PLAN_TOKEN [--json]\napp photo-check --id immich --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN [--json]\napp account-plan --id SINGLE_ID --project-root ABSOLUTE [--username NAME] [--adopt-existing] [--json]\napp account-prepare --id SINGLE_ID --project-root ABSOLUTE [--username NAME] [--adopt-existing] --approve EXACT_TOKEN [--json]\napp handoff --id ID --project-root ABSOLUTE [--show] [--json]\nMulti-service apply is experimental; login, setup closure, and application acceptance stay separate checkpoints.");
    console.log("app plan/apply optionally accept --data-parent ABSOLUTE. It must be an existing owned local directory; the app gets one new child named by its catalog ID. Pass the same value to plan and apply.");
    console.log("app onboard --id prowlarr --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN [--json] (enables Forms login; indexer setup remains separate)");
    console.log("app login-check --id prowlarr --project-root ABSOLUTE [--json] (read-only live administrator login and API check)");
    console.log("--live checks exact owned containers, not app acceptance.");
    console.log("Immich app plan/apply optionally accept --email FIRST_ADMIN_EMAIL --name FIRST_ADMIN_NAME. Pass the same values to both commands; the exact approval binds them.");
    console.log("app login-check --id paperless-ngx --project-root ABSOLUTE [--json]\napp document-check|document-cleanup --id paperless-ngx --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN [--json]\napp persistence-start|persistence-finish --id immich|paperless-ngx --project-root ABSOLUTE --approve EXACT_STATUS_TOKEN [--json]\nBetween persistence commands, use separately approved app down and app up. The saved canary must survive the restart before acceptance is recorded; cleanup needs its own approval.");
    console.log("app paperless-token-plan|paperless-token-status --id paperless-ngx --project-root ABSOLUTE [--json]\napp paperless-token-create --id paperless-ngx --project-root ABSOLUTE --approve EXACT_TOKEN_PLAN [--json] (saves a private API token; does not attach Homarr)");
    console.log("app document-renew-plan --id paperless-ngx --project-root ABSOLUTE [--json]\napp document-renew --id paperless-ngx --project-root ABSOLUTE --approve EXACT_RENEW_PLAN_TOKEN [--json]\nAfter confirmed recoverable-trash cleanup, renewal archives the prior proof and starts a distinct canary cycle; it does not upload anything.");
    console.log("app homarr-input --id APP --project-root ABSOLUTE [--icon-url HTTPS_URL] [--href HTTP_OR_HTTPS_URL] [--route-revision] [--json] (prepares immutable attach input only; route revision needs an existing v2 input)");
    console.log("app homarr-uptime-input --id uptime-kuma --project-root ABSOLUTE [--url HTTP_OR_HTTPS_URL] [--slug-stdin] [--json] (prepares separate Uptime Kuma integration input only; slug is read from stdin, never argv)");
    console.log("app homarr-paperless-input --id paperless-ngx --project-root ABSOLUTE [--json] (prepares native Paperless integration input after a fresh private token check; attachment remains separate)");
    console.log("app homarr-immich-input --id immich --project-root ABSOLUTE [--json] (prepares owner-only native Immich input and acceptance after exact saved and fresh live checks; key creation and attachment remain separate)");
    console.log("app homarr-immich-key-plan --id immich --project-root ABSOLUTE [--json]\napp homarr-immich-key-create --id immich --project-root ABSOLUTE --approve EXACT_KEY_PLAN_TOKEN [--json] (creates or verifies one limited Immich API key; never attaches an integration)");
    console.log("app monitor-create-plan --id uptime-kuma --project-root ABSOLUTE [--json]\napp monitor-create --id uptime-kuma --project-root ABSOLUTE --approve EXACT_CREATE_PLAN_TOKEN [--json]\napp monitor-list --id uptime-kuma --project-root ABSOLUTE [--json]\napp monitor-plan --id uptime-kuma --project-root ABSOLUTE --monitor-id POSITIVE_ID [--json]\napp monitor-check --id uptime-kuma --project-root ABSOLUTE --monitor-id POSITIVE_ID --approve EXACT_MONITOR_PLAN_TOKEN [--json]\nLocal self-check creation is optional and uses Uptime Kuma's version-sensitive internal API. A healthy baseline, separately approved app down/up, and matching monitor readback record restart persistence.");
    console.log("app status-page-plan|status-page-status --id uptime-kuma --project-root ABSOLUTE [--json]\napp status-page-create --id uptime-kuma --project-root ABSOLUTE --approve EXACT_STATUS_PAGE_PLAN_TOKEN [--json]\nCreates only the default status page for the saved local self-monitor after separate approval. Its endpoints are unauthenticated; keep Kuma private.");
    console.log("App plan/apply may repeat --connect-homarr when an onboarded standalone Homarr project exists in the same root; it joins only the app frontend to Homarr's owned bridge. This does not create an integration or widget.");
    return;
  }
  if (options.action === "image") {
    const result = await resolveImage(options.appId);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (Array.isArray(result.images)) {
      for (const image of result.images) console.log(`${image.service}: ${image.image} (${result.platform}; ${image.platformDigest})`);
      if (result.boundedApply) console.log("Read-only registry resolution; multi-service apply needs an exact reviewed plan and approval.");
      else console.log("Read-only registry resolution; this recipe cannot be applied by the bounded app installer yet.");
    } else console.log(`${result.image} (${result.platform}; ${result.platformDigest})`);
    return;
  }
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
    fail("generic app commands currently require a non-root Linux host");
  }
  const root = await projectRoot(options.projectRoot);
  if (options.action === "plan" && ((await lstat(root)).mode & 0o022) !== 0) {
    fail("app apply cannot lock a group- or world-writable project root; choose a private root or remove group write access before planning");
  }
  if (options.action === "homarr-input") {
    await homarrInputCommand(options, root);
    return;
  }
  if (options.action === "homarr-uptime-input") {
    await homarrUptimeInputCommand(options, root);
    return;
  }
  if (options.action === "homarr-paperless-input") {
    await homarrPaperlessInputCommand(options, root);
    return;
  }
  if (options.action === "homarr-immich-input") {
    await homarrImmichInputCommand(options, root);
    return;
  }
  if (options.action === "homarr-immich-key-plan" || options.action === "homarr-immich-key-create") {
    await homarrImmichKeyCommand(options, root);
    return;
  }
  if (options.action === "monitor-list" || options.action === "monitor-plan"
    || options.action === "monitor-check" || options.action === "monitor-create-plan"
    || options.action === "monitor-create") {
    await multiAppCommand(options, root, null);
    return;
  }
  if (options.action === "status-page-plan" || options.action === "status-page-create"
    || options.action === "status-page-status") {
    await multiAppCommand(options, root, null);
    return;
  }
  if (options.action === "document-renew-plan" || options.action === "document-renew") {
    await multiAppCommand(options, root, null);
    return;
  }
  if (options.action === "paperless-token-plan" || options.action === "paperless-token-create"
    || options.action === "paperless-token-status") {
    await multiAppCommand(options, root, null);
    return;
  }
  if (options.action === "plan" || options.action === "apply") {
    const selected = recipeFor(options.appId, options.action === "apply");
    if (selected.recipe.schemaVersion === 2) {
      await multiAppCommand(options, root, selected);
      return;
    }
    if (options.email !== null || options.name !== null) {
      fail("this single-service recipe does not accept --email or --name");
    }
  } else {
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readRawState(root, options.appId);
    if (state?.schemaVersion === 2) {
      await multiAppCommand(options, root, null);
      return;
    }
  }
  if (options.action === "account-plan" || options.action === "account-prepare" || options.action === "handoff") {
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    if (!state || state.stage !== "applied") fail("app credential handoff needs a previously applied exact project");
    const path = credentialPath(root, options.appId);
    const directory = dirname(path);
    await checkExistingParent(directory, "app credential parent");
    if (options.action === "handoff") {
      if (state.credentialRef !== path || !state.accountUsername || !await inspectCredential(path)) {
        fail("no prepared app credential handoff is recorded; run app account-plan first");
      }
      let status = "prepared-not-account-verified";
      if (state.uptimeSetup?.stage === "login-verified") status = "login-verified-recorded";
      const summary = { schemaVersion: 1, command: "app handoff", appId: options.appId,
        status, mutation: false, credentialFile: path,
        username: state.accountUsername, url: `http://127.0.0.1:${state.port}` };
      if (options.show) {
        const env = await credentialEnv(path, state, state.accountUsername);
        if (options.json) console.log(JSON.stringify({ ...summary, secretful: true, env }, null, 2));
        else process.stdout.write(env);
        return;
      }
      if (options.json) console.log(JSON.stringify({ ...summary, secretful: false }, null, 2));
      else console.log(`Credentials: ${path} (owner-only). Use app handoff --show only when you want the full .env printed.`);
      return;
    }
    const username = options.username;
    const approval = accountApproval(state, username, options.adoptExisting);
    const exists = await inspectCredential(path);
    if (state.credentialRef) {
      if (state.credentialRef !== path || state.accountUsername !== username || !exists) {
        fail("saved app credential reference differs from this account request");
      }
      if (options.action === "account-prepare" && options.approval !== approval) {
        fail("app account preparation needs its exact reviewed approval");
      }
      const existing = { schemaVersion: 1, command: `app ${options.action}`, appId: options.appId,
        status: "already-prepared", mutation: false, credentialFile: path,
        username, accountVerified: false };
      if (options.json) console.log(JSON.stringify(existing, null, 2));
      else if (options.appId === "uptime-kuma") {
        console.log(`Uptime Kuma credentials are at ${path}. Run app status --id uptime-kuma --project-root ${root} to review the onboarding approval, then app onboard with that token.`);
      } else console.log(`${options.appId}: credentials already prepared at ${path}; account verification remains separate.`);
      return;
    }
    if (options.adoptExisting && !exists) fail("--adopt-existing needs the exact owner-only credential file");
    if (!options.adoptExisting && exists) fail("app credential file exists without a saved reference; review it and use --adopt-existing");
    if (options.action === "account-plan") {
      const planned = { schemaVersion: 1, command: "app account-plan", appId: options.appId,
        status: "ready-for-review", mutation: false, username, credentialFile: path,
        source: options.adoptExisting ? "adopt-existing" : "generate", approval,
        accountVerified: false };
      if (options.json) console.log(JSON.stringify(planned, null, 2));
      else console.log(`${options.appId}: review ${username}, ${planned.source}, ${path}; approval ${approval}`);
      return;
    }
    if (options.approval !== approval) fail("app account preparation needs its exact reviewed approval");
    if (options.adoptExisting) await credentialEnv(path, state, username);
    else {
      await ensurePrivateDirectory(directory, "app credential parent");
      const password = randomBytes(24).toString("base64url");
      const prefix = credentialPrefix(options.appId);
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(`${prefix}_USERNAME=${username}\n${prefix}_PASSWORD=${password}\n${prefix}_URL=http://127.0.0.1:${state.port}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    state.credentialRef = path;
    state.accountUsername = username;
    await writeState(state, false);
    const prepared = { schemaVersion: 1, command: "app account-prepare", appId: options.appId,
      status: "prepared-not-account-verified", mutation: true, credentialFile: path,
      username, source: options.adoptExisting ? "adopt-existing" : "generated",
      accountVerified: false };
    if (options.json) console.log(JSON.stringify(prepared, null, 2));
    else if (options.appId === "uptime-kuma") {
      console.log(`Uptime Kuma credentials are ready at ${path}. Run app status --id uptime-kuma --project-root ${root} to review the onboarding approval, then app onboard with that token. Monitor and restart checks remain separate.`);
    } else console.log(`${options.appId}: owner-only credentials prepared at ${path}. Create/log in to the app account, then verify it separately.`);
    return;
  }
  if (options.action === "onboard") {
    if (options.appId !== "uptime-kuma") fail("single-service app onboard currently supports only Uptime Kuma");
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    if (!state || state.stage !== "applied" || !state.credentialRef || !state.accountUsername
      || !await inspectCredential(state.credentialRef)) {
      fail("Uptime Kuma onboarding needs the exact applied project and prepared owner-only credential");
    }
    if (options.approval !== uptimeOnboardApproval(state)) {
      fail("Uptime Kuma onboarding needs its exact current status approval", "approval-mismatch");
    }
    const runtime = await inspectSavedRuntime(state);
    if (runtime.state !== "running") fail("Uptime Kuma onboarding needs its exact owned container running");
    const env = await credentialEnv(state.credentialRef, state, state.accountUsername);
    const password = env.trimEnd().split("\n")[1].slice("UPTIME_KUMA_PASSWORD=".length);
    const origin = `http://127.0.0.1:${state.port}`;
    let verified = false;
    let created = false;
    try {
      await ensureUptimeSqliteDatabase(origin, state.uptimeDatabaseSetup === undefined, async () => {
        state.uptimeDatabaseSetup = { stage: "attempted" };
        await writeState(state, false);
      });
      if (state.uptimeDatabaseSetup?.stage !== "ready") {
        state.uptimeDatabaseSetup = { stage: "ready", completedAt: new Date().toISOString() };
        await writeState(state, false);
      }
      verified = await verifyUptimeLogin(origin, state.accountUsername, password);
      if (!verified) {
        if (state.uptimeSetup?.stage === "attempted" || state.uptimeSetup?.stage === "login-verified") {
          fail("saved Uptime Kuma setup may have changed; inspect the account before another create attempt",
            "uptime-setup-needs-inspection");
        }
        await createUptimeAdmin(origin, state.accountUsername, password, async () => {
          state.uptimeSetup = { stage: "attempted" };
          await writeState(state, false);
        });
        created = true;
        verified = await verifyUptimeLogin(origin, state.accountUsername, password);
      }
    } catch (error) {
      if (error instanceof UptimeOnboardingError) {
        fail("Uptime Kuma's local account setup did not complete; inspect its saved checkpoint",
          error.code);
      }
      throw error;
    }
    if (!verified) fail("Uptime Kuma did not verify the saved admin login", "uptime-login-unverified");
    let mutation = false;
    if (state.uptimeSetup?.stage !== "login-verified") {
      state.uptimeSetup = { stage: "login-verified", verifiedAt: new Date().toISOString() };
      await writeState(state, false);
      mutation = true;
    }
    const result = { schemaVersion: 1, command: "app onboard", appId: options.appId,
      status: "login-verified", mutation, projectId: state.projectId,
      username: state.accountUsername, credentialFile: state.credentialRef,
      created, accountVerified: true, acceptanceVerified: false,
      verifiedAt: state.uptimeSetup.verifiedAt,
      next: "Create and verify a monitor, then prove this exact account and monitor survive a scoped restart." };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Uptime Kuma admin login verified at ${origin}. Monitor and restart checks remain open.`);
    return;
  }
  if (options.action === "status" || options.action === "info") {
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    let runtime: Awaited<ReturnType<typeof inspectSavedRuntime>> | null = null;
    if (options.live) {
      if (!state) fail("--live needs a saved applied app project", "not-applied");
      runtime = await inspectSavedRuntime(state);
    }
    let approvals: RecordValue | null = null;
    if (state?.stage === "applied") {
      approvals = { up: lifecycleApproval(state, "up"), down: lifecycleApproval(state, "down") };
      if (options.appId === "uptime-kuma" && state.credentialRef && state.accountUsername) {
        approvals.onboard = uptimeOnboardApproval(state);
      }
    } else if (state) {
      approvals = { resume: state.approval };
    }
    const result = { schemaVersion: 1, command: `app ${options.action}`, appId: options.appId,
      projectRoot: root, status: state?.stage ?? "not-initialized", mutation: false,
      projectId: state?.projectId ?? null,
      applyApproval: state?.approval ?? null,
      services: state ? savedServicePurposes(state) : [],
      image: state?.image ?? null, port: state?.port ?? null,
      homarrNetwork: state?.homarrNetwork ?? null,
      url: state ? `http://127.0.0.1:${state.port}` : null,
      composeTarget: state?.composeTarget ?? null,
      dataDirectory: state?.dataDirectory ?? null,
      credentialRef: state?.credentialRef ?? null,
      accountUsername: state?.accountUsername ?? null,
      uptimeDatabaseStage: state?.uptimeDatabaseSetup?.stage ?? null,
      uptimeOnboardingStage: state?.uptimeSetup?.stage ?? null,
      accountLoginRecordedAt: state?.uptimeSetup?.verifiedAt ?? null,
      uptimeSelfMonitor: state?.uptimeSelfMonitor ? { stage: state.uptimeSelfMonitor.stage,
        name: state.uptimeSelfMonitor.name, id: state.uptimeSelfMonitor.id ?? null,
        recordedAt: state.uptimeSelfMonitor.recordedAt ?? null } : null,
      uptimeMonitor: state?.uptimeMonitor ? { id: state.uptimeMonitor.id,
        name: state.uptimeMonitor.name, stage: state.uptimeMonitor.stage,
        baselineAt: state.uptimeMonitor.baselineAt,
        verifiedAt: state.uptimeMonitor.verifiedAt ?? null } : null,
      acceptanceRecorded: state?.uptimeMonitor?.stage === "verified",
      lastRecordedLifecycle: state?.lastLifecycle ?? null,
      approvals,
      lifecycleCommands: lifecycleCommands(options.appId, root, approvals),
      runtime, containerHealth: runtime?.health ?? "not-checked", acceptanceVerified: false };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (options.action === "info") {
      console.log(`${options.appId}: ${result.status}; ${result.url ?? "no saved URL"}`);
      for (const service of result.services) console.log(`  ${service.id}: ${service.purpose ?? "purpose unavailable; saved recipe changed or is missing"}`);
      console.log(`Data: ${result.dataDirectory ?? "not created"}. Credentials: ${result.credentialRef ?? "not prepared"}.`);
      printLifecycleCommands(result.lifecycleCommands, result.lastRecordedLifecycle);
      if (runtime) console.log(`Runtime: ${runtime.state}; container health: ${runtime.health} (checked ${runtime.checkedAt}).`);
      if (!runtime) console.log("Current container health was not checked.");
      if (state?.uptimeSetup?.stage === "login-verified") {
        console.log(`Admin login passed at ${state.uptimeSetup.verifiedAt}; local monitor: ${state.uptimeSelfMonitor?.stage ?? "not created"}; monitor proof: ${state.uptimeMonitor?.stage ?? "not started"}. Current login and monitor health were not checked here.`);
      } else console.log("Account login and application acceptance were not checked.");
    } else {
      let observation = "Container health was not checked.";
      if (runtime) observation = `Runtime ${runtime.state}, health ${runtime.health}.`;
      console.log(`${options.appId}: ${result.status}; ${result.url ?? "no saved URL"}. ${observation} Application acceptance was not checked.`);
    }
    return;
  }
  if (options.action === "up" || options.action === "down") {
    if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
      fail("app lifecycle needs the saved local Docker context without environment overrides");
    }
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    if (!state || state.stage !== "applied") fail("app lifecycle needs a previously applied exact project");
    if (options.approval !== lifecycleApproval(state, options.action)) {
      fail(`app ${options.action} requires its exact separately reviewed status approval`);
    }
    requireLocalDockerContext(state.dockerContext);
    const owner = createSelfhostComposeOwner(state.manifest);
    const plan = await owner.plan();
    if (plan.render.target !== state.composeTarget) fail("saved app lifecycle plan changed");
    await owner.checkRendered(plan);
    inspectAppRuntime(state);
    let stopBeatId: number | undefined;
    if (options.action === "down" && state.uptimeMonitor && state.credentialRef && state.accountUsername) {
      try {
        const env = await credentialEnv(state.credentialRef, state, state.accountUsername);
        const password = env.trimEnd().split("\n")[1].slice("UPTIME_KUMA_PASSWORD=".length);
        const monitor = await inspectUptimeMonitor(`http://127.0.0.1:${state.port}`,
          state.accountUsername, password, state.uptimeMonitor.id);
        if (monitor.identity === state.uptimeMonitor.identity && monitor.status === "up"
          && monitor.lastBeatId !== null
          && monitor.lastBeatId >= state.uptimeMonitor.baselineBeatId) {
          stopBeatId = monitor.lastBeatId;
        }
      } catch (error) {
        if (!(error instanceof UptimeOnboardingError)) throw error;
      }
    }
    if (options.action === "up") await owner.apply(plan);
    else await owner.stop(plan);
    const observed = inspectAppRuntime(state);
    if (options.action === "up" && observed.state !== "running") {
      fail("app up returned but its exact service container is not running");
    }
    if (options.action === "down" && observed.state === "running") {
      fail("app down returned but its exact service container is still running");
    }
    let upBeatId: number | undefined;
    const monitorRestartPending = options.action === "up" && state.uptimeMonitor?.stage === "stopped";
    if (monitorRestartPending && state.uptimeMonitor
      && state.uptimeMonitor.stopBeatId !== undefined
      && state.credentialRef && state.accountUsername) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const env = await credentialEnv(state.credentialRef, state, state.accountUsername);
          const password = env.trimEnd().split("\n")[1].slice("UPTIME_KUMA_PASSWORD=".length);
          const monitor = await inspectUptimeMonitor(`http://127.0.0.1:${state.port}`,
            state.accountUsername, password, state.uptimeMonitor.id);
          if (monitor.identity === state.uptimeMonitor.identity) {
            upBeatId = Math.max(state.uptimeMonitor.stopBeatId, monitor.lastBeatId ?? 0);
            break;
          }
        } catch { /* Never claim restart proof when a post-start fence cannot be read. */ }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    state.lastLifecycle = options.action === "up" ? "running" : "stopped";
    if (state.uptimeMonitor) {
      if (options.action === "down") {
        state.uptimeMonitor = { ...state.uptimeMonitor, stage: "stopped",
          stopBeatId, upBeatId: undefined, verifiedAt: undefined };
      } else if (state.uptimeMonitor.stage === "stopped") {
        state.uptimeMonitor = { ...state.uptimeMonitor,
          stage: upBeatId === undefined ? "baseline" : "restarted", upBeatId };
      }
    }
    await writeState(state, false);
    const result = { schemaVersion: 1, command: `app ${options.action}`, appId: options.appId,
      status: options.action === "up" ? "started-unverified" : "stopped",
      mutation: true, projectId: state.projectId, containerState: observed.state,
      containerHealth: observed.health, dataDirectory: state.dataDirectory,
      url: `http://127.0.0.1:${state.port}`, acceptanceVerified: false,
      monitorPostStartFenceRecorded: upBeatId !== undefined };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${options.appId}: ${result.status}; container ${observed.state}. Application acceptance remains separate.`);
      if (monitorRestartPending && upBeatId === undefined) {
        console.log("No post-start monitor fence was recorded; repeat the scoped stop/start when the app is ready before claiming persistence.");
      }
    }
    return;
  }
  if (options.action === "resume") {
    await checkExistingParent(join(root, ".selfhost"), ".selfhost");
    await checkExistingParent(stateDirectory(root), "app state parent");
    const state = await readState(root, options.appId);
    if (!state) fail("there is no saved app apply to resume");
    if (state.stage === "applied") fail("app apply is already recorded; use app status, not a second apply");
    if (options.approval !== state.approval) fail("app resume requires the exact saved approval token");
    const currentRecipe = recipeFor(options.appId);
    if (currentRecipe.recipeSha256 !== state.recipeSha256) fail("app recipe changed; stop for migration review");
    requireLocalDockerContext(state.dockerContext);
    const dataAncestor = await existingDataAncestor(state.dataDirectory);
    observation(hostReport(root, dataAncestor, state.port), root, dataAncestor, state.port,
      state.projectId, `${state.projectId}-private`, currentRecipe.storage.minimumFreeBytes);
    await applySaved(state);
    const result = { schemaVersion: 1, command: "app resume", appId: options.appId,
      status: "applied-unverified", mutation: true, image: state.image,
      url: `http://127.0.0.1:${state.port}`, dataDirectory: state.dataDirectory,
      acceptance: currentRecipe.recipe.acceptance, acceptanceVerified: false };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${options.appId}: Compose resumed at ${result.url}. Application acceptance remains separate.`);
    return;
  }
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail(`app ${options.action} cannot match local storage and ports to Docker while Docker connection overrides are set`);
  }
  const port = options.port;
  if (!port) fail("app planning requires an exact port");
  await assertPackagedCatalogProject(root);
  const { recipe, service, defaults, storage, recipeSha256, appPurpose } = recipeFor(options.appId);
  const projectId = projectIdFor(root, options.appId);
  const appsRoot = join(root, ".selfhost", "apps");
  const defaultDataRoot = join(root, ".selfhost", "app-data");
  const dataRoot = dataParentFor(root, options.dataParent);
  const projectDirectory = join(appsRoot, projectId);
  const dataDirectory = join(dataRoot, defaults.dataDirectoryName);
  const networkName = `${projectId}-private`;
  await checkExistingParent(join(root, ".selfhost"), ".selfhost");
  await checkExistingParent(appsRoot, "app project parent");
  await checkDataParent(dataRoot, defaultDataRoot);
  await checkExistingParent(stateDirectory(root), "app state parent");
  await requireAbsent(statePath(root, options.appId), "app state");
  await requireAbsent(projectDirectory, "app Compose project directory");
  await requireAbsent(dataDirectory, "app data directory");
  const dataAncestor = await existingDataAncestor(dataRoot);
  const observed = observation(hostReport(root, dataAncestor, port), root, dataAncestor,
    port, projectId, networkName, storage.minimumFreeBytes);
  const homarrNetwork = options.connectHomarr
    ? await inspectedStandaloneHomarrNetwork(root, observed.dockerContext) : undefined;
  let selectedImages = options.images;
  let imageProvenance = "operator-supplied digests; registry resolution not verified by this command";
  if (options.resolveImages) {
    const resolved = await resolveImage(options.appId);
    if (resolved.recipeSha256 !== recipeSha256) fail("catalog recipe changed during image resolution");
    if (Array.isArray(resolved.images)) {
      selectedImages = resolved.images.map((entry: RecordValue) => `${entry.service}=${entry.image}`);
    } else {
      selectedImages = [resolved.image as string];
    }
    imageProvenance = "Docker Buildx registry manifest resolved for this host";
  }
  if (recipe.schemaVersion !== 1 || !service || selectedImages.length !== 1) {
    fail("single-service app planning requires exactly one pinned --image");
  }
  const image = selectedImages[0];
  if (!matchesRecipeImagePin(service.imageTag, image)) {
    fail(`--image must exactly pin the recipe reference ${service.imageTag} to one sha256 digest`);
  }
  const manifest = {
    schemaVersion: 1,
    project: { dockerContext: observed.dockerContext, id: projectId, owner: projectId,
      root: appsRoot, directory: projectDirectory, ownership: "new" },
    services: [{ id: service.id, image, restart: service.restart,
      readOnly: service.readOnly, user: service.user, imageUserEvidence: service.imageUserEvidence,
      environment: [], ports: [{ hostIp: defaults.hostIp, published: port,
        target: service.targetPort, protocol: "tcp", purpose: "admin", publicApproved: false }],
      mounts: [{ source: dataDirectory, target: service.dataTarget, readOnly: false,
        shared: false, owner: projectId, ownership: "new" }],
      networks: homarrNetwork ? ["private", "homarr"] : ["private"], secretRefs: [] }],
    networks: [{ id: "private", name: networkName, driver: "bridge", internal: false,
      owner: projectId, ownership: "new" },
      ...(homarrNetwork ? [{ id: "homarr", name: homarrNetwork, driver: "bridge",
        internal: false, owner: "external", ownership: "verified-existing" }] : [])],
    observed: { checkedAt: observed.checkedAt, project: null, ports: observed.ports,
      paths: observed.paths, networks: observed.networks },
  };
  const compose = await createSelfhostComposeOwner(manifest).plan();
  const approval = approvalFor({ appId: options.appId, projectRoot: root, image, port,
    recipeSha256, dockerContext: observed.dockerContext, dataDirectory, networkName,
    homarrNetwork });
  const result = {
    schemaVersion: 1, command: "app plan", status: "candidate", mutation: false,
    appId: options.appId, recipeSha256, image,
    servicePurposes: [{ id: service.id, purpose: appPurpose }],
    imageProvenance,
    host: { inspectedAt: observed.checkedAt, dockerContext: observed.dockerContext,
      projectRoot: root, dataStorageAncestor: observed.storage.dataAncestor,
      dockerLocality: "unverified", filesystemType: observed.storage.filesystemType,
      availableBytes: observed.storage.availableBytes },
    compose: { projectId, planId: compose.planId, directory: projectDirectory,
      renderTarget: compose.render.target, publishedPort: `${defaults.hostIp}:${port}:${service.targetPort}/tcp`,
      dataDirectory, network: networkName, homarrNetwork: homarrNetwork ?? null, user: service.user },
    remainingGates: ["Verify the Docker context targets this same inspected host before relying on local port and storage facts.",
      options.resolveImages
        ? "Review the resolved image index and exact Linux platform digest before apply."
        : "Verify the supplied image digest and image architecture against the upstream registry.",
      "Verify POSIX locks and persistence on the selected local storage before apply.",
      ...(homarrNetwork ? ["The app joins Homarr's exact owned bridge; verify the live Homarr-to-app endpoint and integration separately."] : []),
      "Review the exact approval. Apply will re-inspect this host and check its local Docker socket before mutation.",
      ...recipe.acceptance.map((check: RecordValue) => check.description)],
    approval, applied: false, dockerMutation: false, acceptanceVerified: false,
  };
  if (options.action === "apply") {
    if (options.approval !== approval) fail("app apply approval does not match the fresh exact recipe, image, port, path and Docker context");
    requireLocalDockerContext(observed.dockerContext);
    await ensurePrivateDirectory(join(root, ".selfhost"), ".selfhost");
    await ensurePrivateIgnore(root);
    await ensurePrivateDirectory(appsRoot, "app project parent");
    if (dataRoot === defaultDataRoot) await ensurePrivateDirectory(dataRoot, "app data parent");
    await ensurePrivateDirectory(stateDirectory(root), "app state parent");
    const state: AppState = { schemaVersion: 1, appId: options.appId, recipeSha256,
      approval, image, port, projectRoot: root, dockerContext: observed.dockerContext,
      projectId, composeTarget: compose.render.target, dataDirectory, manifest, stage: "approved" };
    if (homarrNetwork) state.homarrNetwork = homarrNetwork;
    await writeState(state, true);
    await applySaved(state);
    const applied = { schemaVersion: 1, command: "app apply", appId: options.appId,
      status: "applied-unverified", mutation: true, projectId, image,
      url: `http://${defaults.hostIp}:${port}`, dataDirectory, composeTarget: compose.render.target,
      homarrNetwork: homarrNetwork ?? null,
      acceptance: recipe.acceptance, acceptanceVerified: false,
      next: "Finish the listed application checks, including first-account and restart persistence. Use app status for the saved stage." };
    if (options.json) console.log(JSON.stringify(applied, null, 2));
    else console.log(`${options.appId}: Compose applied at ${applied.url}. Complete first-account, monitor, and restart-persistence checks before calling it verified.`);
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${options.appId}: read-only Compose candidate ${compose.planId} for ${projectId}`);
  console.log(`Purpose: ${appPurpose}`);
  console.log(`Image: ${image} (${imageProvenance})`);
  console.log(`Private admin port: ${result.compose.publishedPort}`);
  console.log(`Data: ${dataDirectory}`);
  console.log(`Rendered target if separately approved: ${compose.render.target}`);
  console.log(`Approval for fresh exact apply: ${approval}`);
  console.log("No files or Docker resources were changed. Docker locality, apply and application acceptance remain separate gates.");
}

const readOnlyAppActions = new Set(["image", "plan", "status", "info", "account-plan",
  "handoff", "close-plan", "login-check", "monitor-list", "monitor-plan",
  "monitor-create-plan", "status-page-plan", "status-page-status",
  "document-renew-plan", "homarr-immich-key-plan", "paperless-token-plan",
  "paperless-token-status"]);

export async function appCommand(args: string[]): Promise<void> {
  if (args[0] === "batch" || args[0] === "shared") {
    await runAppCommand(args);
    return;
  }
  const options = parse(args);
  if (!options || readOnlyAppActions.has(options.action)
    || process.platform !== "linux" || typeof process.getuid !== "function"
    || process.getuid() === 0) {
    await runAppCommand(args);
    return;
  }
  const root = await projectRoot(options.projectRoot);
  try {
    await withAppMutationLock(root, options.appId, async () => {
      let claimedPort = options.action === "apply" ? options.port : null;
      if (options.action === "resume" || options.action === "up") {
        await checkExistingParent(join(root, ".selfhost"), ".selfhost");
        await checkExistingParent(stateDirectory(root), "app state parent");
        const state = await readRawState(root, options.appId);
        if (state !== null) {
          if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) {
            fail("saved app port is invalid; inspect the exact app state before lifecycle mutation");
          }
          claimedPort = state.port;
        }
      }
      if (claimedPort !== null) {
        await withAppPortMutationLock(root, claimedPort, () => runAppCommand(args));
        return;
      }
      await runAppCommand(args);
    });
  } catch (error) {
    if (error instanceof BatchMutationLockError) {
      fail(error.message, error.partialWritePossible
        ? "app-lock-ownership-changed" : "app-lock-held", error.partialWritePossible);
    }
    throw error;
  }
}
