import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { assertPrivatePath, protectPrivatePath, privateMode, ownedByCurrentUser } from "./lib/platform-private.ts";
import { inspectExistingSharedHost, inspectNewSharedHost, requireLocalSharedDockerContext,
  type SharedHostRequest } from "./lib/shared-host-observation.ts";
import { extendSharedProject, prepareSharedProjectFiles, sharedProjectCandidate,
  type SharedAppSelection, type SharedProjectCandidate } from "./lib/shared-compose-project.ts";
import { loadSharedProjectState, loadSharedUnitComposeOrigins, loadSharedUnitComposeOriginStates, loadSharedRemovedAppIds,
  loadPreparedSharedAddSource, loadReviewedSharedRemovalSource, saveSharedProjectState } from "./lib/shared-project-state.ts";
import type { SharedProjectState } from "./lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { sharedPrestartContracts, requireSharedPrestart } from "./lib/shared-prestart.ts";
import { requireFirstAccountProof, reviewSharedEnvironmentTransition } from "./lib/shared-env-transition.ts";
import { withSharedProjectMutationLock } from "./lib/batch-mutation-lock.ts";
import { assertPackagedCatalogProject } from "./lib/catalog-project.ts";
import { sharedRecipeEligible } from "./lib/shared-app-eligibility.ts";
import { MAX_SHARED_APPS } from "./lib/shared-project-limits.ts";
import { requireSavedSharedGeneratedRecipes, restoreSavedSharedSelection,
  savedSharedPrivateHttpsRoutes } from "./lib/shared-saved-recipe.ts";
import { deriveSharedRecipe, bindSharedDerivedRecipe, sharedDerivedRecipeAdapter,
  deriveSharedCreateRecipe, bindSharedCreateRecipe,
  type SharedDerivedRecipeBinding } from "./lib/shared-derived-recipe.ts";
import { prepareSharedDerivedRecipeBinding, loadSharedDerivedRecipeBindingSync } from "./lib/shared-derived-recipe-state.ts";
import { resolveOptionalSharedHttpsTarget } from "./lib/shared-https-target.ts";
import { resolveSharedServiceTarget } from "./lib/shared-service-target.ts";
import { sharedCanonicalOriginCommand } from "./lib/shared-canonical-origin-command.ts";
import { MAX_SHARED_PRIVATE_HTTPS_ROUTES } from "./lib/shared-private-https.ts";
import { sharedPrivateHttpsCommand } from "./lib/shared-private-https-command.ts";
import { checkedManualJobRecipe, isManualJobRecipe, isManualJobService } from "./lib/manual-job.ts";
import { inspectSharedManualJobPreparation } from "./lib/shared-manual-job.ts";
import { sharedHomarr } from "./shared-homarr.ts";
import { sharedHomarrTrust } from "./lib/shared-homarr-trust.ts";
import { readOwnerSecretSources, type OwnerSecretSources } from "./lib/owner-secret-input.ts";
import { sharedUnitHandoff, sharedUnitRuntime, sharedUnitSecretHandoff, sharedUnitStatus } from "./lib/shared-unit-setup.ts";
import { planSharedDockerAuthority, applySharedDockerAuthority, probeSharedDockerAuthority,
  loadSharedDockerAuthorityInput, readSharedDockerAuthorityChoices,
  sharedUnitDockerAuthorityBinding, assertSharedUnitDockerAuthorityInput,
  sharedUnitObserveContainerImage } from "./lib/shared-docker-authority.ts";
import { setupContractSha256 } from "./lib/setup-contract.ts";
import { publishSharedSetupCompatibility } from "./lib/shared-setup-compatibility.ts";
import { sharedAcceptance, sharedAcceptanceAvailable } from "./lib/shared-acceptance.ts";
import { serviceLinks } from "./lib/service-links.ts";
import { createSharedAcceptanceOwner } from "./lib/shared-acceptance-owner.ts";
import { witnessSharedComposeCompatibilityCreate, type SharedComposeCompatibilityDependencies } from "./lib/shared-compose-compatibility.ts";
import { generatedConfigReadability, checkedConnectorRecipe, checkedPrivateDaemonRecipe } from "./lib/multi-service-recipe.ts";
import { sharedRecipeMigrationCommand } from "./lib/shared-recipe-migration-command.ts";
import { sharedImageTransitionCommand } from "./lib/shared-image-transition-command.ts";
import { sharedReinstallCommand, sharedReinstallOptions } from "./shared-reinstall.ts";
import { resolveAppEndpoints } from "./lib/resolved-app.ts";
import { formatSharedHandoff } from "./lib/shared-handoff-format.ts";
import { createSetupObservationJournal, type SetupObservationIdentity } from "./lib/setup-observation-journal.ts";
import { resolvePeerEffects, resolveSetupAfter, resolveSetupInputs, resolveSetupInputDefinitions, runFirstRunSetups,
  setupAdapterAvailable,
  setupApiKeyContract,
  inspectFirstRunSetup,
  type SetupInputs, type SetupOutcome, type SetupTransport } from "./control-panel/setup-engine.ts";

type Entry = Record<string, any>;
type RecipeInfo = { recipe: Entry; app?: Entry; previousRecipes?: Entry[]; services?: Entry[]; defaults: Entry; storage: Entry;
  boundedApply: boolean; recipeSha256: string };
type ImageResult = Entry & { images?: Entry[] };

type SharedOptions = { action: "plan" | "apply" | "add" | "reinstall" | "remove" | "status" | "resume" | "setup" | "handoff" | "transition-plan" | "transition-apply" | "recipe-migration-plan" | "recipe-migration-apply" | "image-transition-plan" | "image-transition-apply" | "canonical-origin-plan" | "canonical-origin-apply" | "start" | "stop" | "homarr-plan" | "homarr-apply" | "homarr-status" | "homarr-trust-plan" | "homarr-trust-apply" | "job-plan" | "job-run" | "https-plan" | "https-apply" | "https-proof" | "acceptance-begin" | "acceptance-finish" | "authority-plan" | "authority-apply" | "authority-probe" | "cloudflare-read-plan" | "cloudflare-read-apply" | "cloudflare-public-plan" | "cloudflare-public-apply"; projectRoot: string;
  projectId: string; appIds: string[]; ports: Record<string, number>;
  inputs: SetupInputs; approval: string | null; approvedSteps: string[]; json: boolean; show: boolean;
  live: boolean; secretSources: OwnerSecretSources; httpsPort: number;
  hostnames: Record<string, string>; applyRemoval: boolean; authorityInput: string | null };

const appIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const projectIdPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

export type SharedProjectCommandErrorCode = "shared-remove-dependency" | "shared-remove-last-app"
  | "shared-reinstall-required" | "shared-remove-inspect-required";

/** Only fixed owner-bound blocker codes cross the public CLI failure boundary. */
export class SharedProjectCommandError extends Error {
  readonly partialWritePossible: boolean;
  constructor(message: string, readonly code: SharedProjectCommandErrorCode) {
    super(message);
    this.name = "SharedProjectCommandError";
    this.partialWritePossible = code === "shared-remove-inspect-required";
  }
}

function fail(message: string): never {
  throw new Error(`Shared project: ${message}`);
}

function reportReadableConfigs(configs: Record<string, ReturnType<typeof generatedConfigReadability>>): void {
  for (const [appId, files] of Object.entries(configs)) {
    for (const file of files) {
      console.log(`${appId}/${file.fileId}: non-secret, read-only container config, mode ${file.mode}; ${file.officialUrl}`);
    }
  }
}

async function selectedOwnerSecrets(sources: OwnerSecretSources,
  selections: SharedAppSelection[]): Promise<Record<string, Buffer>> {
  const declared = new Set(selections.flatMap((selection) => selection.recipe.privateFiles
    .filter((file: Entry) => file.source === "owner")
    .map((file: Entry) => `${selection.appId}:${file.id}`)));
  if (Object.keys(sources).some((id) => !declared.has(id))) {
    fail("owner secret input must match one selected owner-supplied file");
  }
  return readOwnerSecretSources(sources);
}

function parse(args: string[]): SharedOptions {
  const action = args[0];
  if (action !== "plan" && action !== "apply" && action !== "add" && action !== "reinstall" && action !== "remove" && action !== "status"
    && action !== "resume" && action !== "setup" && action !== "handoff"
    && action !== "transition-plan" && action !== "transition-apply"
    && action !== "recipe-migration-plan" && action !== "recipe-migration-apply"
    && action !== "image-transition-plan" && action !== "image-transition-apply"
    && action !== "canonical-origin-plan" && action !== "canonical-origin-apply"
    && action !== "start" && action !== "stop" && action !== "homarr-plan" && action !== "homarr-apply" && action !== "homarr-status"
    && action !== "homarr-trust-plan" && action !== "homarr-trust-apply"
    && action !== "job-plan" && action !== "job-run" && action !== "https-plan" && action !== "https-apply" && action !== "https-proof"
    && action !== "acceptance-begin" && action !== "acceptance-finish"
    && action !== "authority-plan" && action !== "authority-apply" && action !== "authority-probe"
    && action !== "cloudflare-read-plan" && action !== "cloudflare-read-apply"
    && action !== "cloudflare-public-plan" && action !== "cloudflare-public-apply") {
    fail("use app shared plan|apply|add|status|resume|setup|handoff|transition-plan|transition-apply|start|stop");
  }
  const values = new Map<string, string[]>();
  let json = false;
  let show = false;
  let live = false;
  let applyRemoval = false;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--apply") {
      if (action !== "remove" || applyRemoval) fail("--apply is accepted once only for shared remove");
      applyRemoval = true;
      continue;
    }
    if (flag === "--json") {
      if (json) fail("--json may appear only once");
      json = true;
      continue;
    }
    if (flag === "--show") {
      if (show) fail("--show may appear only once");
      show = true;
      continue;
    }
    if (flag === "--live") {
      if (live) fail("--live may appear only once");
      live = true;
      continue;
    }
    if (flag === "--approval" && action !== "remove") fail("--approval is only an alias for the shared remove approval");
    if (!["--project-root", "--project-id", "--app", "--port", "--input", "--approve", "--approval", "--approve-step", "--secret-file", "--secret-stdin", "--https-port", "--hostname", "--authority-input"].includes(flag)) {
      fail(`unsupported option ${flag}`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) fail(`${flag} needs one value`);
    let key = flag;
    if (flag === "--approval") key = "--approve";
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  const one = (name: string, required = true): string | null => {
    const found = values.get(name) ?? [];
    if (found.length > 1 || (required && found.length !== 1)) fail(`${name} must be supplied exactly once`);
    return found[0] ?? null;
  };
  const projectRoot = one("--project-root")!;
  const projectId = one("--project-id")!;
  const authorityInput = one("--authority-input", false);
  if (!action.startsWith("authority-") && !action.startsWith("cloudflare-read-") && authorityInput !== null) fail("--authority-input is only for exact external authority review/apply");
  if (!isAbsolute(projectRoot) || resolve(projectRoot) !== projectRoot || projectRoot === "/"
    || !projectIdPattern.test(projectId)) fail("choose one exact absolute project root and bounded project ID");
  const appIds = values.get("--app") ?? [];
  if ((values.has("--secret-file") || values.has("--secret-stdin"))
    && action !== "apply" && action !== "add" && action !== "resume") {
    fail("owner secret input is only accepted during apply, add, or resume");
  }
  const secretSources: OwnerSecretSources = Object.create(null);
  for (const option of values.get("--secret-file") ?? []) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)=(\/.*)$/.exec(option);
    if (!match || Object.hasOwn(secretSources, `${match[1]}:${match[2]}`)) fail("--secret-file needs unique APP:FILE=/absolute/path");
    secretSources[`${match[1]}:${match[2]}`] = { kind: "file", path: match[3] };
  }
  for (const option of values.get("--secret-stdin") ?? []) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(option);
    if (!match || Object.hasOwn(secretSources, option)) fail("--secret-stdin needs unique APP:FILE");
    secretSources[option] = { kind: "stdin" };
  }
  if (Object.values(secretSources).filter((source) => source.kind === "stdin").length > 1) {
    fail("only one owner secret may use stdin");
  }
  if (action === "status" || action === "resume" || action === "https-proof") {
    if (appIds.length || values.has("--port") || values.has("--input") || values.has("--approve-step")
      || (action === "status" && values.has("--approve"))) {
      fail(`${action} takes only the exact project root and project ID${action === "resume" ? " plus approval" : ""}`);
    }
  } else if (appIds.length < 1 || appIds.length > MAX_SHARED_APPS
    || appIds.some((id) => !appIdPattern.test(id) || id.length > 47)
    || new Set(appIds).size !== appIds.length) {
    fail(`select 1–${MAX_SHARED_APPS} distinct source-backed Compose app IDs`);
  }
  if (action.startsWith("authority-")) {
    if (appIds.length !== 1 || values.has("--port") || values.has("--input") || values.has("--approve-step")) {
      fail("Docker authority takes one saved app and no port, setup input or step overrides");
    }
    if (action === "authority-plan" && values.has("--approve")) fail("authority-plan is read-only");
    if (action === "authority-probe" && authorityInput !== null) fail("authority-probe uses only retained approved input");
    if (action !== "authority-probe" && authorityInput === null) fail("authority review/apply needs --authority-input non-secret owner-only JSON");
  }
  if (action.startsWith("homarr-trust-")) {
    if (appIds.length !== 1 || values.has("--port") || values.has("--input") || values.has("--approve-step")
      || show || live) fail("Homarr trust takes one exact saved HTTPS target app without overrides");
    if (action === "homarr-trust-plan" && values.has("--approve")) fail("homarr-trust-plan is read-only");
    if (action === "homarr-trust-apply" && !values.has("--approve")) fail("homarr-trust-apply requires exact approval");
  }
  if (action.startsWith("cloudflare-")) {
    if (appIds.length !== 1 || appIds[0] !== "cloudflare-tunnel" || values.has("--port") || values.has("--input")
      || values.has("--approve-step") || Object.keys(secretSources).length > 0 || show || live) fail("Cloudflare authority requires only the exact saved connector owner");
    if (action.endsWith("-plan") && values.has("--approve")) fail("Cloudflare planning accepts no apply approval");
    if (action.startsWith("cloudflare-read-") && authorityInput === null) fail("Cloudflare read scope requires owner-only --authority-input JSON choices");
  }
  if (action !== "https-plan" && action !== "https-apply" && (values.has("--hostname") || values.has("--https-port"))) {
    fail("--hostname and --https-port are only for the read-only shared HTTPS plan or its approved apply");
  }
  const hostnames: Record<string, string> = Object.create(null);
  let httpsPort = 4443;
  if (action === "https-plan" || action === "https-apply") {
    if (appIds.length > MAX_SHARED_PRIVATE_HTTPS_ROUTES) {
      fail(`private HTTPS planning accepts at most ${MAX_SHARED_PRIVATE_HTTPS_ROUTES} selected apps`);
    }
    if (values.has("--port") || values.has("--input") || (action === "https-plan" && values.has("--approve"))
      || values.has("--approve-step")) {
      if (action === "https-apply") fail("https-apply accepts only its exact approval and route bindings, not setup inputs or backend port changes");
      fail("https-plan is read-only and accepts no apply approval, setup inputs, or backend port changes");
    }
    const selectedPort = one("--https-port", false);
    if (selectedPort !== null) {
      if (!/^[0-9]{4,5}$/.test(selectedPort)
        || Number(selectedPort) < 1024 || Number(selectedPort) > 65535) {
        fail("--https-port must be one unprivileged TCP port");
      }
      httpsPort = Number(selectedPort);
    }
    const namedRoutes = values.get("--hostname") ?? [];
    if (namedRoutes.length > appIds.length) fail("--hostname needs at most one name for each selected app");
    for (const namedRoute of namedRoutes) {
      const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)=([a-z0-9.-]{1,253})$/.exec(namedRoute);
      if (!match || !appIds.includes(match[1]!) || Object.hasOwn(hostnames, match[1]!)) {
        fail("--hostname needs unique selected APP=NAME.localhost or APP=NAME.home.arpa bindings");
      }
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:localhost|home\.arpa)$/.test(match[2]!)) {
        fail("private HTTPS supports host-only NAME.localhost or NAME.home.arpa overrides; other names need an owned DNS review");
      }
      hostnames[match[1]!] = match[2]!;
    }
  }
  if (action === "handoff" && appIds.length !== 1) fail("handoff needs exactly one selected app");
  if (action.startsWith("transition-") && appIds.length !== 1) fail("transition needs exactly one selected app");
  if (action.startsWith("recipe-migration-") && (appIds.length !== 1 || values.has("--port")
    || values.has("--input") || values.has("--approve-step"))) {
    fail("recipe migration takes one saved app with no port, setup input or step override");
  }
  if (action.startsWith("image-transition-") && (appIds.length !== 1 || values.has("--port")
    || values.has("--input") || values.has("--approve-step"))) {
    fail("image transition takes one saved app with no port, setup input or step override");
  }
  if (action === "image-transition-plan" && values.has("--approve")) fail("image-transition-plan is read-only and does not take approval");
  if (action.startsWith("canonical-origin-") && (appIds.length !== 1 || values.has("--port")
    || values.has("--input") || values.has("--approve-step"))) {
    fail("canonical origin takes one saved app and its exact verified HTTPS route; no origin or setup override");
  }
  if (action.startsWith("job-")) {
    if (appIds.length !== 1 || values.has("--port") || values.has("--input") || values.has("--approve-step")) {
      fail("a job probe needs one exact saved manual job and no port, input, or command override");
    }
    if (action === "job-plan" && values.has("--approve")) fail("job-plan is read-only and does not take approval");
  }
  if (action.startsWith("acceptance-") && (appIds.length !== 1
    || values.has("--port"))) {
    fail("acceptance needs one exact saved app, with no port override");
  }
  if ((action === "start" || action === "stop") && (values.has("--port") || values.has("--input")
    || values.has("--approve-step"))) fail("start and stop use only saved app units");
  if (show && action !== "handoff") fail("--show is only for explicit shared credential handoff");
  if (live && action !== "status" && action !== "homarr-status") fail("--live is only for shared status or Homarr status");
  if (action === "setup" && values.has("--port")) fail("setup uses the saved app ports");
  if (action === "handoff" && values.has("--port")) fail("handoff uses the saved app port");
  if (action.startsWith("transition-") && values.has("--port")) fail("transition uses the saved app port");
  if (action !== "setup" && action !== "add" && action !== "plan" && action !== "apply" && !action.startsWith("homarr-")
    && !action.startsWith("acceptance-") && values.has("--input")) {
    fail("--input is only for shared setup, derived installation, Homarr publication, or reviewed app acceptance");
  }
  if (action.startsWith("homarr-") && values.has("--port")) fail("Homarr publication uses saved ports");
  if (action === "homarr-status" && [...(values.get("--input") ?? [])]
    .some((input) => !input.startsWith("homarr.board-name="))) fail("Homarr status accepts only the board-name choice");
  if (action !== "setup" && !action.startsWith("acceptance-") && values.has("--approve-step")) {
    fail("--approve-step is only for shared setup or app acceptance");
  }
  const ports: Record<string, number> = {};
  for (const option of values.get("--port") ?? []) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.([a-z0-9]+(?:-[a-z0-9]+)*))?=([0-9]{4,5})$/.exec(option);
    if (!match || !appIds.includes(match[1])) {
      fail("--port must name one selected app as APP=PORT or APP.PORT-ID=PORT");
    }
    const key = match[2] ? `${match[1]}.${match[2]}` : match[1];
    if (Object.hasOwn(ports, key)) fail("duplicate selected app port");
    const port = Number(match[3]);
    if (port < 1024 || port > 65535) fail("selected app port is outside the private-port range");
    ports[key] = port;
  }
  const inputs: SetupInputs = Object.create(null);
  const inputOptions = values.get("--input") ?? [];
  if (inputOptions.length > 256) fail("shared setup accepts at most 256 non-secret inputs");
  for (const option of inputOptions) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z][a-z0-9-]{0,47})=(.+)$/.exec(option);
    if (!match || !appIds.includes(match[1]) || match[3].length > 512
      || /[\u0000-\u001f\u007f]/.test(match[3])
      || /(password|secret|token|cookie|api-?key)/i.test(match[2])) {
      fail("--input must name one selected app and a non-secret APP.KEY=VALUE choice");
    }
    inputs[match[1]] ??= Object.create(null);
    if (Object.hasOwn(inputs[match[1]], match[2])) fail("duplicate shared setup input");
    inputs[match[1]][match[2]] = match[3];
  }
  const approval = one("--approve", false);
  if (action === "reinstall" && (appIds.length !== 1 || values.has("--port") || values.has("--input")
    || values.has("--approve-step") || Object.keys(secretSources).length > 0 || show || live)) {
    fail("reinstall restores one exact removed app without port, input, credential or setup overrides");
  }
  if (action === "remove") {
    if (values.has("--port") || values.has("--input") || values.has("--approve-step")) fail("remove uses only exact saved app units");
    if (applyRemoval !== (approval !== null)) fail("remove mutation requires both --apply and exact --approval (or --approve)");
  }
  if (action === "add" && approval === null && Object.keys(secretSources).length > 0) {
    fail("owner secret input is only accepted after the exact add approval");
  }
  const approvedSteps = values.get("--approve-step") ?? [];
  if (approvedSteps.length > 256 || new Set(approvedSteps).size !== approvedSteps.length) {
    fail("--approve-step needs distinct exact actions, at most 256");
  }
  if ((action === "apply" || action === "resume" || action === "transition-apply" || action === "recipe-migration-apply" || action === "image-transition-apply" || action === "canonical-origin-apply" || action === "homarr-apply" || action === "https-apply") && approval === null) {
    fail("apply and resume need one exact --approve token");
  }
  if ((action === "plan" || action === "status" || action === "handoff" || action === "transition-plan" || action === "recipe-migration-plan" || action === "canonical-origin-plan" || action === "homarr-plan" || action === "homarr-status") && approval !== null) {
    fail("plan, status, and handoff do not accept an apply approval");
  }
  if (approvedSteps.length > 0 && approval === null) fail("--approve-step needs the exact shared setup approval");
  for (const stepApproval of approvedSteps) {
    const match = /^APP-SETUP-[A-Z][A-Z0-9-]*:([a-z0-9]+(?:-[a-z0-9]+)*):[0-9a-f]{64}$/.exec(stepApproval);
    if (!match || !appIds.includes(match[1]!)) fail("--approve-step must name one selected app's exact setup action");
  }
  return { action, projectRoot, projectId, appIds: appIds.sort(), ports, inputs,
    approval, approvedSteps, json, show, live, secretSources, httpsPort, hostnames, applyRemoval, authorityInput };
}

async function privateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
    protectPrivatePath(path, 0o700);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || !privateMode(info, 0o700)
    || !ownedByCurrentUser(info)
    || await realpath(path) !== path) fail(`unsafe owner-only directory: ${path}`);
  assertPrivatePath(path, 0o700);
}

async function checkedRoot(root: string): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o022) !== 0)
    || (typeof process.getuid === "function" && info.uid !== process.getuid())
    || await realpath(root) !== root) fail("project root must be one current-user-owned real directory");
  if (!["linux", "darwin", "win32"].includes(process.platform)
    || (typeof process.getuid === "function" && process.getuid() === 0)) {
    fail("shared Compose requires a non-root operator on Linux, macOS, or Windows with Linux containers");
  }
  if (process.platform === "win32") assertPrivatePath(root, 0o700);
}

function requireUnownedRoot(root: string): void {
  const local = join(root, ".selfhost");
  const owners = ["cli.json", "stack.json", "app-batch.json", "app-state", "apps", "bundles", "media-harness", "shared"];
  if (owners.some((entry) => existsSync(join(local, entry)))) {
    fail("this project has another saved owner; adopt it explicitly instead of starting a second owner here");
  }
}

export function sharedPlanApproval(candidate: SharedProjectCandidate): string {
  const desired = structuredClone(candidate.manifest);
  delete desired.observed;
  const identity: Entry = { desired, units: candidate.units,
    selectionFingerprints: candidate.selectionFingerprints, settings: candidate.settings };
  const prestart = sharedPrestartContracts(candidate.manifest);
  if (prestart.length > 0) identity.prestart = prestart;
  const fingerprint = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return `SHARED-APPLY:${desired.project.id}:${fingerprint}`;
}

function candidateFromState(current: SharedProjectState): SharedProjectCandidate {
  return { manifest: current.manifest, units: current.units,
    selectionFingerprints: current.selectionFingerprints, settings: current.settings,
    projectDirectory: current.project.directory };
}

/** Desired retained inventory only; no filesystem or Docker action. */
export function sharedRemovalCandidate(current: SharedProjectState, appIds: readonly string[]): SharedProjectCandidate {
  if (current.checkpoint.phase !== "completed" || appIds.length < 1
    || new Set(appIds).size !== appIds.length || appIds.some((appId) => !Object.hasOwn(current.units, appId))) {
    fail("remove needs distinct saved app units in a completed owner; inspect pending work");
  }
  const retained = Object.keys(current.units).filter((id) => !appIds.includes(id));
  if (retained.length === 0) throw new SharedProjectCommandError("stop the project; full owner retirement is not implemented", "shared-remove-last-app");
  const candidate = structuredClone(candidateFromState(current));
  candidate.manifest.project.ownership = "verified-existing";
  candidate.manifest.observed.project = { id: current.project.id, directory: current.project.directory, owner: current.project.owner };
  const services = new Set(appIds.flatMap((appId) => current.units[appId]!));
  candidate.manifest.services = candidate.manifest.services.filter((service: Entry) => !services.has(service.id));
  for (const service of candidate.manifest.services) {
    if (service.dependsOn?.some((dependency: Entry) => services.has(dependency.service))) {
      throw new SharedProjectCommandError(`retained service ${service.id} depends on a selected removal service`, "shared-remove-dependency");
    }
  }
  const networks = new Set(candidate.manifest.services.flatMap((service: Entry) => service.networks));
  candidate.manifest.networks = candidate.manifest.networks.filter((network: Entry) => network.id === "front" || networks.has(network.id));
  for (const appId of appIds) {
    delete candidate.units[appId];
    delete candidate.selectionFingerprints[appId];
  }
  return candidate;
}

/** Presence guard only, never live link verification or checkpoint payload parsing. */
async function sharedRemovalLinkHistoryPresent(current: SharedProjectState,
  retained: readonly string[], appIds: readonly string[]): Promise<boolean> {
  const relevant = serviceLinks.filter((link) => retained.includes(link.source) && appIds.includes(link.target));
  if (relevant.length === 0) return false;
  const directory = join(current.project.directory, "service-links");
  let metadata;
  try { metadata = await lstat(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new SharedProjectCommandError("saved link history could not be inspected; stop before removal", "shared-remove-dependency");
  }
  assertPrivatePath(directory, 0o700);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !ownedByCurrentUser(metadata)
    || !privateMode(metadata, 0o700) || await realpath(directory) !== directory) {
    throw new SharedProjectCommandError("saved link history directory is unsafe; stop before removal", "shared-remove-dependency");
  }
  let entries: string[];
  try { entries = await readdir(directory); }
  catch { throw new SharedProjectCommandError("saved link history could not be inspected; stop before removal", "shared-remove-dependency"); }
  if (entries.length > 8192) throw new SharedProjectCommandError("saved link history exceeds the bounded removal inspection", "shared-remove-dependency");
  let present = false;
  for (const link of relevant) {
    const prefix = `${link.source}-to-${link.target}.`;
    for (const entry of entries.filter((name) => name.startsWith(prefix))) {
      const suffix = entry.slice(prefix.length);
      if (!/^[1-9][0-9]{0,4}\.json$/.test(suffix) || Number(suffix.slice(0, -5)) > 10000) {
        throw new SharedProjectCommandError("matching saved link history filename is unsafe; stop before removal", "shared-remove-dependency");
      }
      let file;
      try { file = await lstat(join(directory, entry)); }
      catch { throw new SharedProjectCommandError("matching saved link history changed during inspection; stop before removal", "shared-remove-dependency"); }
      assertPrivatePath(join(directory, entry), 0o600);
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || !ownedByCurrentUser(file)
        || !privateMode(file, 0o600) || file.size < 1 || file.size > 8192) {
        throw new SharedProjectCommandError("matching saved link history file is unsafe; stop before removal", "shared-remove-dependency");
      }
      present = true;
    }
  }
  return present;
}

async function sharedRemovalReview(current: SharedProjectState, appIds: string[],
  dependencies: { recipeFor(appId: string): RecipeInfo; appFor?(appId: string): Entry }) {
  const candidate = sharedRemovalCandidate(current, appIds);
  const retained = Object.keys(candidate.units).sort();
  if (await sharedRemovalLinkHistoryPresent(current, retained, appIds)) {
    throw new SharedProjectCommandError("saved-link-history present for a retained app and selected removal target; separately reviewed link retirement is not implemented", "shared-remove-dependency");
  }
  if (!dependencies.appFor) fail("remove requires catalog dependency metadata before changing saved units");
  const setupAfter = await resolveSetupAfter(retained);
  for (const appId of retained) {
    const declared = dependencies.appFor(appId).dependencies;
    if (!Array.isArray(declared)) fail(`${appId} dependency metadata is unavailable`);
    const peers = new Set<string>([...declared.filter((id: unknown) => typeof id === "string"),
      ...(setupAfter.get(appId) ?? [])]);
    if (sharedDerivedRecipeAdapter(appId)) {
      const binding = loadSharedDerivedRecipeBindingSync(current.project.directory, appId, current);
      for (const peer of binding.derived.peerAppIds) peers.add(peer);
    }
    if (peers.size > 0 && appIds.some((id) => peers.has(id) || peers.has(`app:${id}`))) {
      throw new SharedProjectCommandError(`retained app ${appId} depends on a selected removal app`, "shared-remove-dependency");
    }
  }
  const routes = savedSharedPrivateHttpsRoutes(current, dependencies.recipeFor) ?? [];
  if (routes.some((route) => (appIds.includes("caddy") && retained.includes(route.appId))
    || (!appIds.includes("caddy") && appIds.includes(route.appId)))) {
    throw new SharedProjectCommandError("remove would break retained private HTTPS routes; review route retirement separately", "shared-remove-dependency");
  }
  const origins = await loadSharedUnitComposeOriginStates(current.project.directory, current.project.id, current.recordHash);
  const grouped = new Map<string, { source: SharedProjectState; services: string[] }>();
  for (const appId of appIds) {
    const source = origins[appId];
    if (!source) fail(`${appId} has no validated original Compose owner`);
    let group = grouped.get(source.manifestHash);
    if (!group) { group = { source, services: [] }; grouped.set(source.manifestHash, group); }
    group.services.push(...current.units[appId]!);
  }
  const groups = await Promise.all([...grouped.values()].map(async ({ source, services }) => {
    services.sort();
    const owner = createSelfhostComposeOwner(source.manifest);
    const plan = await owner.plan();
    await owner.checkRendered(plan);
    const selected = await owner.selectedPlan(plan, "remove", services);
    return { owner, plan, selected };
  }));
  groups.sort((left, right) => left.selected.file.localeCompare(right.selected.file));
  const digest = createHash("sha256").update(JSON.stringify({ recordHash: current.recordHash,
    appIds, retained, candidate, selections: groups.map((group) => group.selected) })).digest("hex");
  return { candidate, retained, groups, services: appIds.flatMap((appId) => current.units[appId]!).sort(),
    approval: `SHARED-REMOVE:${current.project.id}:${digest}` };
}

export function sharedSetupApproval(current: SharedProjectState, appIds: string[], inputs: SetupInputs = {},
  setupContracts: Record<string, string> = {}): string {
  const contracts = Object.fromEntries(Object.entries(setupContracts).sort(([a], [b]) => a.localeCompare(b)));
  if (Object.entries(contracts).some(([appId, hash]) => !appIds.includes(appId)
    || !/^[0-9a-f]{64}$/.test(hash))) fail("setup approval needs exact selected setup contracts");
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 2,
    projectId: current.project.id, projectRoot: dirname(dirname(dirname(current.project.directory))),
    revision: current.revision, manifestHash: current.manifestHash, appIds, inputs,
    setupContracts: contracts })).digest("hex");
  return `SHARED-SETUP:${current.project.id}:${fingerprint}`;
}

/** A closure is offered only after the adapter's durable, exact first-account proof.
 * Outcome text alone is not authority to recreate a service. */
export async function sharedSetupTransitionCandidates(current: SharedProjectState,
  outcomes: readonly SetupOutcome[], projectRoot: string,
  recipeFor: (appId: string) => RecipeInfo): Promise<string[]> {
  if (current.checkpoint.phase !== "completed") return [];
  const candidates: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.transitionReady !== true || !Object.hasOwn(current.units, outcome.appId)) continue;
    const recipe = restoreSavedSharedSelection(current, outcome.appId, recipeFor).recipe;
    const descriptor = recipe.postFirstAccountEnvironment;
    const identity = recipe.onboarding?.username ?? recipe.onboarding?.email;
    if (!descriptor || typeof identity !== "string"
      || typeof recipe.onboarding?.fileId !== "string") continue;
    try {
      reviewSharedEnvironmentTransition(current, outcome.appId, recipe, descriptor);
      await requireFirstAccountProof(current, outcome.appId, projectRoot,
        identity, recipe.onboarding.fileId,
        await firstAccountApiKeyRef(current, outcome.appId));
      candidates.push(outcome.appId);
    } catch {
      // Missing proof or an already-closed switch never produces a mutation offer.
    }
  }
  return [...new Set(candidates)].sort();
}

async function firstAccountApiKeyRef(current: SharedProjectState, appId: string): Promise<string | undefined> {
  if (await setupApiKeyContract(appId) === "saved-by-onboarding") {
    return join(current.project.directory, "secrets", appId, `${appId}-api-key`);
  }
  return undefined;
}

function sharedLifecycleApproval(current: SharedProjectState, operation: "start" | "stop",
  appIds: string[], before: Record<string, string>, services: string[], selectedApproval: string): string {
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 1,
    operation, project: current.project, revision: current.revision,
    recordHash: current.recordHash, appIds, before, services, selectedApproval })).digest("hex");
  return `SELECTED-${operation.toUpperCase()}:${current.project.id}:${fingerprint}`;
}

async function exactLifecycleState(current: SharedProjectState, appIds: string[], target: string): Promise<Record<string, string>> {
  const origins = await loadSharedUnitComposeOrigins(current.project.directory,
    current.project.id, current.recordHash);
  const states: Record<string, string> = {};
  for (const appId of appIds) {
    const state = sharedUnitRuntime(current, appId, target, origins[appId]).state;
    if (state !== "running" && state !== "stopped" && state !== "prepared") {
      fail("selected unit is partial or unknown; inspect before lifecycle mutation");
    }
    states[appId] = state;
  }
  return states;
}

function manualJobIds(candidate: Pick<SharedProjectCandidate, "manifest" | "units">): string[] {
  return Object.keys(candidate.units).filter((id) => candidate.units[id]!.every((serviceId) =>
    isManualJobService(candidate.manifest.services.find((service: Entry) => service.id === serviceId)))).sort();
}

function selectionPorts(selections: SharedAppSelection[]): number[] {
  return selections.flatMap((selection) => [selection.port, ...Object.values(selection.publishedPorts ?? {})])
    .filter((port): port is number => typeof port === "number");
}

function selectedPort(info: RecipeInfo, appId: string, ports: Record<string, number>): number | null {
  if (checkedManualJobRecipe(info.recipe) || checkedConnectorRecipe(info.recipe) || checkedPrivateDaemonRecipe(info.recipe)) {
    if (Object.hasOwn(ports, appId)) fail(`${appId} has no browser frontend and cannot publish a frontend port`);
    return null;
  }
  return ports[appId] ?? info.defaults.publishedPort;
}

/** Recipe-declared application ports only. UDP requires an explicit private mapping;
 * Docker APIs, public ingress and databases keep their separate owners. */
function selectedApplicationPorts(recipe: Entry, ports: Record<string, number>, used: Set<number>,
  reserved: ReadonlyMap<number, string> = new Map()): Record<string, number> {
  const descriptors = recipe.services.flatMap((service: Entry) => service.additionalPorts ?? []);
  const selected: Record<string, number> = {};
  for (const key of Object.keys(ports).filter((key) => key.startsWith(`${recipe.appId}.`))) {
    if (!descriptors.some((descriptor: Entry) => key === `${recipe.appId}.${descriptor.id}`)) {
      fail(`${recipe.appId} selected an undeclared additional port`);
    }
  }
  for (const descriptor of descriptors) {
    const key = `${recipe.appId}.${descriptor.id}`;
    if (!descriptor.required && !Object.hasOwn(ports, key)) continue;
    if (!["tcp", "udp"].includes(descriptor.protocol) || descriptor.purpose !== "application") {
      fail(`${recipe.appId} additional port ${descriptor.id} requires a separately reviewed capability`);
    }
    if (descriptor.protocol === "udp" && !Object.hasOwn(ports, key)) {
      fail(`${recipe.appId} additional UDP port ${descriptor.id} needs an explicit private host-port choice`);
    }
    let port = ports[key] ?? descriptor.targetPort;
    if (!Object.hasOwn(ports, key)) while (used.has(port) && port <= 65535) port += 1;
    if (!Number.isInteger(port) || port < 1024 || port > 65535
      || (used.has(port) && reserved.get(port) !== key)) {
      fail(`${recipe.appId} additional port needs a distinct private host port`);
    }
    used.add(port);
    selected[descriptor.id] = port;
  }
  return selected;
}

function reservedSharedPorts(ports: Record<string, number>, existing: Iterable<number> = []) {
  const used = new Set(existing);
  const reserved = new Map<number, string>();
  for (const [key, port] of Object.entries(ports)) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || used.has(port)) {
      fail("explicit selected ports must be distinct and not already owned");
    }
    used.add(port);
    reserved.set(port, key);
  }
  return { used, reserved };
}

function availableSharedFrontendPort(selection: SharedAppSelection, ports: Record<string, number>,
  used: Set<number>, reserved: ReadonlyMap<number, string>): void {
  if (selection.port === null) return;
  if (!Object.hasOwn(ports, selection.appId)) {
    while (used.has(selection.port) && selection.port <= 65535) selection.port += 1;
  }
  if (!Number.isInteger(selection.port) || selection.port < 1024 || selection.port > 65535
    || (used.has(selection.port) && reserved.get(selection.port) !== selection.appId)) {
    fail(`${selection.appId} needs a distinct private frontend port`);
  }
  used.add(selection.port);
}

async function setupCoverage(appIds: string[], jobs: string[] = []): Promise<{ direct: string[]; pending: string[]; jobs: string[] }> {
  const checked = await Promise.all(appIds
    .map(async (id) => ({ id, direct: await setupAdapterAvailable(id) })));
  return { direct: checked.filter((entry) => entry.direct).map((entry) => entry.id),
    pending: checked.filter((entry) => !entry.direct && !jobs.includes(entry.id)).map((entry) => entry.id), jobs };
}

export function sharedSetupGroups(appIds: string[], current: Pick<SharedProjectState, "units">,
  recipeFor: (appId: string) => Pick<RecipeInfo, "recipe">,
  declaredAfter: Map<string, readonly string[]>):
  { groups: string[][]; dependencies: Map<string, string[]> } {
  const dependencies = new Map<string, string[]>();
  const selected = new Set(appIds);
  for (const appId of appIds) {
    const peer = recipeFor(appId).recipe.onboarding?.providerAppId;
    const after = new Set(declaredAfter.get(appId) ?? []);
    if (appId === "homarr") {
      for (const other of appIds) if (other !== appId) after.add(other);
    }
    if (peer !== undefined) {
      if (typeof peer !== "string" || !appIdPattern.test(peer) || peer === appId
        || !Object.hasOwn(current.units, peer)) {
        fail(`${appId} needs its exact selected Compose provider before first-run setup`);
      }
      after.add(peer);
    }
    dependencies.set(appId, [...after].filter((id) => Object.hasOwn(current.units, id)));
  }
  const waiting = new Set(appIds);
  const groups: string[][] = [];
  while (waiting.size > 0) {
    const ready = [...waiting].filter((appId) => {
      const after = dependencies.get(appId) ?? [];
      return after.every((id) => !selected.has(id) || !waiting.has(id));
    });
    if (ready.length === 0) fail("first-run setup dependencies contain a cycle");
    groups.push(ready);
    for (const appId of ready) waiting.delete(appId);
  }
  return { groups, dependencies };
}

function internalMediaPath(root: string, projectId: string): string {
  return join(root, ".selfhost", "shared", projectId, "data", "shared");
}

function automaticMediaHostPaths(root: string, projectId: string,
  recipe: Entry): Record<string, string> | undefined {
  const mounts = recipe.services.flatMap((service: Entry) =>
    service.mounts.filter((mount: Entry) => mount.hostPath === true));
  if (mounts.length === 0) return undefined;
  return { [mounts[0].name]: internalMediaPath(root, projectId) };
}

function selectedMediaPath(root: string, projectId: string, selection: SharedAppSelection): string | null {
  const mounts = selection.recipe.services.flatMap((service: Entry) =>
    service.mounts.filter((mount: Entry) => mount.hostPath === true));
  if (mounts.length === 0) {
    if (selection.hostPaths && Object.keys(selection.hostPaths).length > 0) {
      fail(`${selection.appId} selected an undeclared shared media path`);
    }
    return null;
  }
  const mount = mounts[0];
  if (mounts.length !== 1 || mount.kind !== "bind"
    || mount.shareGroup !== "media-data" || typeof mount.readOnly !== "boolean") {
    fail(`${selection.appId} needs a reviewed shared host-path mapping`);
  }
  const path = internalMediaPath(root, projectId);
  const selected = selection.hostPaths ?? {};
  if (selected[mount.name] !== path || Object.keys(selected).length !== 1) {
    fail(`${selection.appId} must use this project's exact shared media path`);
  }
  return path;
}

export function sharedHostRequest(root: string, projectId: string,
  selections: SharedAppSelection[], preparedMediaPath = false): SharedHostRequest {
  const tcpPorts: number[] = [];
  const volumeNames = new Set<string>();
  let mediaPath: string | null = null;
  let minimumFreeBytes = 1024 * 1024;
  for (const selection of selections) {
    const recipe = selection.recipe;
    const manualJob = checkedManualJobRecipe(recipe);
    const connector = checkedConnectorRecipe(recipe);
    if (!Array.isArray(recipe.services) || !Array.isArray(recipe.privateFiles)
      || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose") {
      fail(`${selection.appId} needs a validated v2 Compose recipe`);
    }
    const selectedPath = selectedMediaPath(root, projectId, selection);
    if (selectedPath) mediaPath = selectedPath;
    const supplied = Object.fromEntries(Object.entries(selection.publishedPorts ?? {})
      .map(([id, port]) => [`${selection.appId}.${id}`, port]));
    const additional = selectedApplicationPorts(recipe, supplied, new Set(selection.port === null ? [] : [selection.port]));
    if (JSON.stringify(additional) !== JSON.stringify(selection.publishedPorts ?? {})) {
      fail(`${selection.appId} additional ports differ from their selected review`);
    }
    tcpPorts.push(...Object.values(additional));
    let published = 0;
    for (const service of recipe.services) {
      if (service.publishTargetPort !== null) {
        if (typeof selection.port !== "number") fail(`${selection.appId} needs a numeric frontend port`);
        tcpPorts.push(selection.port);
        published += 1;
      }
      for (const mount of service.mounts) {
        if (mount.kind === "volume") volumeNames.add(`${projectId}-${selection.appId}-${mount.name}`);
      }
    }
    if (manualJob || connector || checkedPrivateDaemonRecipe(recipe)) {
      if (published !== 0 || selection.port !== null || Object.keys(additional).length > 0) fail(`${selection.appId} has no browser frontend and cannot publish ports`);
    } else if (published !== 1) fail(`${selection.appId} must publish exactly one selected frontend port`);
    const free = recipe.storage?.minimumFreeBytes;
    if (!Number.isSafeInteger(free) || free < 0) fail(`${selection.appId} has no bounded storage estimate`);
    minimumFreeBytes += free;
  }
  if (new Set(tcpPorts).size !== tcpPorts.length || !Number.isSafeInteger(minimumFreeBytes)) {
    fail("selected apps need distinct host ports and bounded aggregate free space");
  }
  return { projectRoot: root, projectId, tcpPorts, volumeNames: [...volumeNames].sort(),
    minimumFreeBytes, mediaPath, preparedMediaPath: preparedMediaPath && mediaPath !== null };
}

function pinnedImages(result: ImageResult, info: RecipeInfo, appId: string): Record<string, string> {
  if (result.command !== "app image" || result.appId !== appId
    || result.recipeSha256 !== info.recipeSha256 || !Array.isArray(result.images)
    || result.images.length !== info.services?.length) {
    fail(`${appId} image resolution differs from its validated recipe`);
  }
  const images: Record<string, string> = {};
  for (const entry of result.images) {
    if (typeof entry.service !== "string" || typeof entry.image !== "string"
      || Object.hasOwn(images, entry.service)) fail(`${appId} has an invalid resolved image`);
    images[entry.service] = entry.image;
  }
  return images;
}

/** Materialize fresh selections through the same app-owned derived contract as additions.
 * Host observation and image resolution are read-only. No pretend saved owner is created. */
export async function reviewSharedCreateSelections(options: Pick<SharedOptions,
  "projectRoot" | "projectId" | "appIds" | "inputs" | "ports">, dependencies: {
    recipeFor(appId: string): RecipeInfo;
    resolveImage(appId: string, derivedRecipe?: Entry): Promise<ImageResult>;
  }, observe = inspectNewSharedHost) {
  const staticIds = options.appIds.filter((appId) => !sharedDerivedRecipeAdapter(appId)).sort();
  const derivedIds = options.appIds.filter((appId) => sharedDerivedRecipeAdapter(appId)).sort();
  const staticSelections = await Promise.all(staticIds.map(async (appId): Promise<SharedAppSelection> => {
    if (Object.keys(options.inputs[appId] ?? {}).length > 0) fail(`${appId} has no derived installation input contract; use inputs during setup instead`);
    const info = dependencies.recipeFor(appId);
    if (!sharedRecipeEligible(appId, info.boundedApply) || info.recipe.schemaVersion !== 2
      || info.recipe.kind !== "multi-service-compose") fail(`${appId} is not yet an eligible v2 shared Compose application`);
    return { appId, recipe: info.recipe, images: pinnedImages(await dependencies.resolveImage(appId), info, appId),
      port: selectedPort(info, appId, options.ports),
      hostPaths: automaticMediaHostPaths(options.projectRoot, options.projectId, info.recipe) };
  }));
  const { used, reserved } = reservedSharedPorts(options.ports);
  for (const selection of staticSelections) availableSharedFrontendPort(selection, options.ports, used, reserved);
  for (const selection of staticSelections) {
    const additional = selectedApplicationPorts(selection.recipe, options.ports, used, reserved);
    if (Object.keys(additional).length > 0) selection.publishedPorts = additional;
  }
  const firstHost = observe(sharedHostRequest(options.projectRoot, options.projectId, staticSelections));
  const derivedBindings: SharedDerivedRecipeBinding[] = [];
  const generated: SharedAppSelection[] = [];
  let pending = derivedIds;
  while (pending.length > 0) {
    // Each pure derivation round sees only fully materialized, pinned peers.
    // Preserve that exact source for replay instead of binding against later rounds.
    const source = { projectRoot: options.projectRoot, projectId: options.projectId,
      apps: [...staticSelections, ...generated].sort((left, right) => left.appId.localeCompare(right.appId)), ...firstHost };
    const ready: Array<{ appId: string; input: { appId: string; inputs: Record<string, string> };
      derived: ReturnType<typeof deriveSharedCreateRecipe> }> = [];
    const unresolved: string[] = [];
    const errors: string[] = [];
    for (const appId of pending) {
      const input = { appId, inputs: options.inputs[appId] ?? {} };
      try { ready.push({ appId, input, derived: deriveSharedCreateRecipe(source, input) }); }
      catch (error) {
        unresolved.push(appId);
        let message = "derivation failed";
        if (error instanceof Error) message = error.message;
        errors.push(`${appId}: ${message}`);
      }
    }
    if (ready.length === 0) {
      fail(`derived installation cannot resolve selected peers or inputs (including cyclic dependencies): ${errors.join("; ")}`);
    }
    const materialized = await Promise.all(ready.map(async ({ appId, input, derived }) => {
      const info = { recipe: derived.recipe, services: derived.recipe.services,
        defaults: derived.recipe.defaults, storage: derived.recipe.storage,
        boundedApply: true, recipeSha256: derived.recipeSha256 };
      if (!sharedRecipeEligible(appId, true)) fail(`${appId} is not eligible for shared Compose installation`);
      const images = pinnedImages(await dependencies.resolveImage(appId, derived.recipe), info, appId);
      return { appId, input, derived, info, images };
    }));
    for (const { appId, input, derived, info, images } of materialized) {
      const selection: SharedAppSelection & { derivationSha256: string } = {
        appId, recipe: derived.recipe, images, port: selectedPort(info, appId, options.ports),
        derivationSha256: createHash("sha256").update(JSON.stringify(derived)).digest("hex"),
        hostPaths: automaticMediaHostPaths(options.projectRoot, options.projectId, derived.recipe) };
      availableSharedFrontendPort(selection, options.ports, used, reserved);
      const additional = selectedApplicationPorts(derived.recipe, options.ports, used, reserved);
      if (Object.keys(additional).length > 0) selection.publishedPorts = additional;
      derivedBindings.push(bindSharedCreateRecipe(source, input, selection));
      generated.push(selection);
    }
    pending = unresolved;
  }
  const selections = [...staticSelections, ...generated].sort((left, right) => left.appId.localeCompare(right.appId));
  let host = firstHost;
  if (generated.length > 0) {
    host = observe(sharedHostRequest(options.projectRoot, options.projectId, selections));
    if (host.dockerContext !== firstHost.dockerContext || host.uid !== firstHost.uid
      || host.gid !== firstHost.gid || host.timezone !== firstHost.timezone) fail("host identity changed during derived installation review");
  }
  const candidate = sharedProjectCandidate({ projectRoot: options.projectRoot,
    projectId: options.projectId, apps: selections, ...host });
  return { selections, derivedBindings, candidate };
}

async function finishReviewedCreate(candidate: SharedProjectCandidate,
  selections: SharedAppSelection[], current: SharedProjectState,
  ownerSecrets: Record<string, Buffer>, compatibility: SharedComposeCompatibilityDependencies,
  resumePrepared = false): Promise<"prepared-prestart" | "applied-unverified"> {
  if (current.checkpoint.operation !== "create"
    || !["reviewed", "prepared"].includes(current.checkpoint.phase)
    || current.manifestHash !== createHash("sha256").update(JSON.stringify(candidate.manifest)).digest("hex")) {
    fail("only an exact reviewed or prepared create checkpoint can continue automatically");
  }
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const plan = await owner.plan();
  requireLocalSharedDockerContext(candidate.manifest.project.dockerContext);
  await owner.render(plan);
  await prepareSharedProjectFiles(candidate, selections, ownerSecrets, current.checkpoint.phase === "reviewed");
  let progress = current;
  if (current.checkpoint.phase === "reviewed") {
    progress = await saveSharedProjectState(candidate,
      { ...current.checkpoint, phase: "prepared" },
      { revision: current.revision, manifestHash: current.manifestHash,
        checkpoint: current.checkpoint });
  }
  await owner.checkRendered(plan);
  if (!resumePrepared && sharedPrestartContracts(candidate.manifest).length > 0) return "prepared-prestart";
  // A rejected prestart prerequisite is still pre-Docker and remains resumable.
  await requireSharedPrestart(candidate.manifest, "apply");
  await owner.preflight(plan);
  const attempted = { ...progress.checkpoint, phase: "attempted" as const };
  const next = await saveSharedProjectState(candidate, attempted,
    { revision: progress.revision, manifestHash: progress.manifestHash,
      checkpoint: progress.checkpoint });
  await witnessSharedComposeCompatibilityCreate(next, plan.render.target, async () => {
    try {
      await owner.apply(plan);
    } catch {
      await saveSharedProjectState(candidate, { ...attempted, phase: "inspect-required" },
        { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint });
      fail("Compose apply may have partially changed this exact project; inspect before retrying");
    }
    return saveSharedProjectState(candidate, { ...attempted, phase: "completed" },
      { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint });
  }, compatibility);
  return "applied-unverified";
}

function preparedResumeApproval(current: SharedProjectState): string | null {
  if (current.checkpoint.operation === "add" && current.checkpoint.phase === "prepared") {
    const identity = { recordHash: current.recordHash,
      prestart: sharedPrestartContracts(current.manifest,
        current.checkpoint.appIds.flatMap((appId) => current.units[appId]!)) };
    const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    return `SHARED-RESUME:${current.project.id}:${digest}`;
  }
  if (current.checkpoint.operation === "create" && ["reviewed", "prepared"].includes(current.checkpoint.phase)) {
    return sharedPlanApproval(candidateFromState(current));
  }
  return null;
}

async function finishPreparedAdd(current: SharedProjectState,
  selections: SharedAppSelection[], dependencies: { recipeFor: (appId: string) => RecipeInfo }): Promise<void> {
  const source = await loadPreparedSharedAddSource(current);
  requireSavedSharedGeneratedRecipes(current, dependencies.recipeFor);
  const appIds = current.checkpoint.appIds;
  const additions = selections.filter((selection) => appIds.includes(selection.appId));
  const candidate = candidateFromState(current);
  const projectRoot = dirname(dirname(dirname(current.project.directory)));
  const mediaPath = internalMediaPath(projectRoot, current.project.id);
  const preparedMedia = current.manifest.services.some((service: Entry) =>
    service.mounts.some((mount: Entry) => mount.source === mediaPath));
  const fresh = inspectExistingSharedHost(sharedHostRequest(projectRoot,
    current.project.id, additions, preparedMedia), candidateFromState(source));
  if (fresh.dockerContext !== current.project.dockerContext || fresh.uid !== current.settings.uid
    || fresh.gid !== current.settings.gid || fresh.timezone !== current.settings.timezone) {
    fail("shared-project host identity or timezone changed before addition resume");
  }
  await createSelfhostComposeOwner({ ...candidate.manifest, observed: fresh.observed }).plan();
  const sourceOwner = createSelfhostComposeOwner(source.manifest);
  const sourcePlan = await sourceOwner.plan();
  await sourceOwner.checkRendered(sourcePlan);
  const retained = Object.keys(source.units).sort();
  const before = await exactLifecycleState(current, retained, sourcePlan.render.target);
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const plan = await owner.plan();
  await owner.checkRendered(plan);
  const services = appIds.flatMap((appId) => current.units[appId]!).sort();
  const selected = await owner.selectedPlan(plan, "add", services);
  await requireSharedPrestart(candidate.manifest, "add", services);
  const attempted = await saveSharedProjectState(candidate,
    { ...current.checkpoint, phase: "attempted" },
    { revision: current.revision, manifestHash: current.manifestHash, checkpoint: current.checkpoint });
  try {
    await owner.addSelected(plan, services, selected.approval);
    const after = await exactLifecycleState(attempted, Object.keys(attempted.units).sort(), plan.render.target);
    const jobs = manualJobIds(candidate);
    for (const appId of appIds) {
      let expected = "running";
      if (jobs.includes(appId)) expected = "prepared";
      if (after[appId] !== expected) fail("resumed addition differs from its prepared project");
    }
    if (retained.some((appId) => after[appId] !== before[appId])) fail("retained runtime changed during addition resume");
  } catch {
    await saveSharedProjectState(candidate, { ...attempted.checkpoint, phase: "inspect-required" },
      { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
    fail("app addition outcome is uncertain; inspect exact shared services before retrying");
  }
  await saveSharedProjectState(candidate, { ...attempted.checkpoint, phase: "completed" },
    { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
}

function savedSelections(current: SharedProjectState,
  recipeFor: (appId: string) => RecipeInfo,
  appIds = Object.keys(current.units).sort()): SharedAppSelection[] {
  return appIds.map((appId) => restoreSavedSharedSelection(current, appId, recipeFor));
}

/** Saved pins remain inspectable even when the installed catalog has changed. */
export function sharedImageInventory(current: SharedProjectState | null,
  recipeFor: (appId: string) => RecipeInfo): {
    images: Record<string, Record<string, string>>;
    recipeSha256: Record<string, string | null>;
    imageChecks: Record<string, "matches-saved-selection" | "recipe-unavailable-or-changed">;
  } {
  const images: Record<string, Record<string, string>> = {};
  const recipeSha256: Record<string, string | null> = {};
  const imageChecks: Record<string, "matches-saved-selection" | "recipe-unavailable-or-changed"> = {};
  if (!current) return { images, recipeSha256, imageChecks };
  const services = new Map(current.manifest.services.map((service: Entry) => [service.id, service]));
  for (const appId of Object.keys(current.units).sort()) {
    images[appId] = {};
    recipeSha256[appId] = null;
    imageChecks[appId] = "recipe-unavailable-or-changed";
    for (const id of current.units[appId]!) {
      const service = services.get(id) as Entry | undefined;
      const localId = id === appId ? appId : id.slice(appId.length + 1);
      if (!service || (id !== appId && !id.startsWith(`${appId}-`))) continue;
      images[appId]![localId] = service.image;
    }
    if (current.checkpoint.phase !== "completed") continue;
    try {
      const [selection] = savedSelections(current, recipeFor, [appId]);
      if (!selection || createHash("sha256").update(JSON.stringify(selection)).digest("hex")
        !== current.selectionFingerprints[appId]) continue;
      recipeSha256[appId] = createHash("sha256").update(JSON.stringify(selection.recipe)).digest("hex");
      imageChecks[appId] = "matches-saved-selection";
    } catch { /* Catalog removal or migration never makes saved status unreadable. */ }
  }
  return { images, recipeSha256, imageChecks };
}

/** Owner-bound attempt chronology only: adapter-ready is not live acceptance. */
export async function createSharedSetupObservationJournal(current: SharedProjectState, appIds: string[],
  recipeFor: (appId: string) => RecipeInfo, setupContracts: Record<string, string>,
  appFor?: (appId: string) => Entry) {
  const approved = structuredClone(current);
  const contracts = { ...setupContracts };
  const identities = new Map<string, SetupObservationIdentity>();
  const identity = async (appId: string): Promise<SetupObservationIdentity> => {
    if (!appIds.includes(appId) || !/^[0-9a-f]{64}$/.test(contracts[appId] ?? "")) {
      fail("setup observation needs an exact selected setup contract");
    }
    const latest = await loadSharedProjectState(approved.project.directory, approved.project.id);
    if (!latest || latest.revision !== approved.revision || latest.manifestHash !== approved.manifestHash
      || latest.recordHash !== approved.recordHash || latest.checkpoint.phase !== "completed") {
      fail("shared owner changed after setup approval; inspect before continuing");
    }
    const inventory = sharedImageInventory(latest, recipeFor);
    const recipeSha256 = inventory.recipeSha256[appId];
    const images = inventory.images[appId];
    if (inventory.imageChecks[appId] !== "matches-saved-selection" || !recipeSha256 || !images
      || Object.keys(images).length !== latest.units[appId]?.length) {
      fail(`${appId} setup observation needs every exact saved recipe image`);
    }
    const setupSubjectSha256 = await setupContractSha256(appId, Object.keys(latest.units));
    if (setupSubjectSha256 !== contracts[appId]) fail("setup contract changed after review; inspect before continuing");
    const value = { appId, projectId: latest.project.id, ownerRevision: latest.revision,
      manifestHash: latest.manifestHash, recipeSha256, setupSubjectSha256, images };
    const pinned = identities.get(appId);
    if (pinned && JSON.stringify(value) !== JSON.stringify(pinned)) {
      fail("setup observation identity changed after approval; inspect before continuing");
    }
    return value;
  };
  // Validate all selected identities before any adapter can extract credentials or send a request.
  for (const appId of appIds) identities.set(appId, await identity(appId));
  let publishing: Promise<void> = Promise.resolve();
  return createSetupObservationJournal({ directory: approved.project.directory, identity,
    async completed(event) {
      const task = publishing.then(() => publishSharedSetupCompatibility(approved, event, { recipeFor, appFor }));
      publishing = task.catch(() => undefined);
      await task;
    } });
}

export async function sharedProjectCommand(args: string[], dependencies: {
  recipeFor(appId: string): RecipeInfo;
  resolveImage(appId: string, derivedRecipe?: Entry): Promise<ImageResult>;
  appFor?(appId: string): Entry;
}): Promise<void> {
  const options = parse(args);
  await checkedRoot(options.projectRoot);
  const directory = join(options.projectRoot, ".selfhost", "shared", options.projectId);
  if (options.action.startsWith("cloudflare-")) {
    await assertPackagedCatalogProject(options.projectRoot);
    await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
      const state = await loadSharedProjectState(directory, options.projectId);
      if (!state || !state.units["cloudflare-tunnel"] || !["prepared", "completed"].includes(state.checkpoint.phase)) fail("Cloudflare authority requires its prepared or completed exact shared owner");
      const revalidate = async () => {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== state.recordHash) fail("Cloudflare owner changed during authority review");
        loadSharedDerivedRecipeBindingSync(directory, "cloudflare-tunnel", latest);
      };
      const owner = await import("./control-panel/setup-cloudflare-provider.ts");
      let result: unknown;
      if (options.action === "cloudflare-read-plan") {
        const scope = await owner.planCloudflareReadScope(state, options.authorityInput!);
        result = { scope, approval: scope.readApproval, publicExposureApproved: false };
      } else if (options.action === "cloudflare-public-plan") result = await owner.planCloudflarePublicExposure(state, revalidate);
      else {
        if (!options.approval) fail("Cloudflare authority apply requires its exact separate approval");
        if (options.action === "cloudflare-read-apply") result = await owner.applyCloudflareReadScope(state, options.authorityInput!, options.approval, revalidate);
        else result = await owner.applyCloudflarePublicExposure(state, options.approval, revalidate);
      }
      await revalidate();
      console.log(JSON.stringify({ command: `app shared ${options.action}`, projectId: state.project.id, result }, null, 2));
    });
    return;
  }
  if (options.action === "authority-plan" || options.action === "authority-apply" || options.action === "authority-probe") {
    await assertPackagedCatalogProject(options.projectRoot);
    const current = await loadSharedProjectState(directory, options.projectId);
    if (!current || (current.checkpoint.phase !== "completed"
      && !(current.checkpoint.phase === "prepared" && ["create", "add"].includes(current.checkpoint.operation)))) {
      fail("Docker authority requires a prepared pre-Docker or completed exact shared owner");
    }
    const appId = options.appIds[0]!;
    const binding = await sharedUnitDockerAuthorityBinding(current, appId);
    let input;
    if (options.authorityInput) input = await readSharedDockerAuthorityChoices(options.authorityInput, binding);
    else input = await loadSharedDockerAuthorityInput(binding);
    await assertSharedUnitDockerAuthorityInput(current, appId, input);
    const review = planSharedDockerAuthority(binding, input);
    const response = { command: `app shared ${options.action}`, projectId: options.projectId,
      projectRoot: options.projectRoot, appId, mutation: false, status: "review",
      authority: review, approval: review.approval, applicationAcceptanceVerified: false };
    if (options.action === "authority-plan") {
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(`${review.disclosure}\nApprove intent with --approve ${review.approval}; this does not verify a connection.`);
      return;
    }
    if (options.action === "authority-probe" && options.approval === null) {
      console.log(JSON.stringify({ ...response, approval: review.probeApproval,
        effect: "fixed GET /info with owner-issued mTLS credentials; no daemon configuration or writes" }, null, 2));
      return;
    }
    if (options.approval === null) fail("Docker authority apply/probe needs its exact separate approval");
    const revalidate = async () => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (!latest || latest.recordHash !== current.recordHash) fail("shared owner changed after Docker authority review");
      const replayed = await sharedUnitDockerAuthorityBinding(latest, appId);
      if (JSON.stringify(replayed) !== JSON.stringify(binding)) fail("Docker authority executable binding changed after review");
      await assertSharedUnitDockerAuthorityInput(latest, appId, input);
    };
    const result = await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
      await revalidate();
      if (options.action === "authority-apply") {
        input = await readSharedDockerAuthorityChoices(options.authorityInput!, binding);
        await assertSharedUnitDockerAuthorityInput(current, appId, input);
        return applySharedDockerAuthority(binding, input, options.approval!, { revalidate });
      }
      return probeSharedDockerAuthority(binding, options.approval!, { revalidate });
    });
    let status = "connection-observed";
    if (options.action === "authority-apply") status = "approved-intent";
    console.log(JSON.stringify({ ...response, mutation: true, status,
      authority: result, approval: undefined }, null, 2));
    return;
  }
  if (["image-transition-plan", "image-transition-apply", "recipe-migration-plan", "recipe-migration-apply",
    "canonical-origin-plan", "canonical-origin-apply", "transition-plan", "transition-apply"].includes(options.action)) {
    const current = await loadSharedProjectState(directory, options.projectId);
    if (current && sharedPrestartContracts(current.manifest,
      options.appIds.flatMap((appId) => current.units[appId] ?? [])).length > 0) {
      const response = { command: `app shared ${options.action}`, projectId: options.projectId,
        projectRoot: options.projectRoot, apps: options.appIds, mutation: false,
        status: "blocked-prestart-transition", approval: null,
        detail: "This app requires a separately prepared authority transition for changed images, recipe or settings; that transition is not implemented. Existing services and checkpoints are unchanged." };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(response.detail);
      return;
    }
  }
  if (options.action === "canonical-origin-plan" || options.action === "canonical-origin-apply") {
    const result = await sharedCanonicalOriginCommand({ action: options.action,
      projectRoot: options.projectRoot, projectId: options.projectId, appId: options.appIds[0],
      approval: options.approval }, { recipeFor: dependencies.recipeFor });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${options.appIds[0]}: ${result.status}; canonical HTTPS ${result.origin}. Data and credentials retained.`);
      if (result.approval) console.log(`Review the scoped settings and apply with --approve ${result.approval}`);
      console.log("Effective app settings, existing login, client trust and application acceptance remain separate.");
    }
    return;
  }
  if (options.action === "homarr-trust-plan" || options.action === "homarr-trust-apply") {
    if (!dependencies.appFor) fail("catalog metadata is unavailable for Homarr trust");
    await assertPackagedCatalogProject(options.projectRoot);
    const result = await sharedHomarrTrust(options.projectRoot, options.projectId, options.appIds[0]!,
      options.approval, { recipeFor: dependencies.recipeFor, appFor: dependencies.appFor,
        approvalFor: (state) => sharedPlanApproval({ manifest: state.manifest, units: state.units,
          selectionFingerprints: state.selectionFingerprints, settings: state.settings,
          projectDirectory: state.project.directory }) });
    console.log(JSON.stringify({ ...result, command: `app shared ${options.action}`,
      projectRoot: options.projectRoot }, null, 2));
    return;
  }
  if (options.action === "homarr-plan" || options.action === "homarr-apply" || options.action === "homarr-status") {
    if (!dependencies.appFor) fail("catalog metadata is unavailable for Homarr publication");
    await assertPackagedCatalogProject(options.projectRoot);
    const result = await sharedHomarr(options.projectRoot, options.projectId, options.appIds,
      options.inputs, options.approval, { recipeFor: dependencies.recipeFor,
        appFor: dependencies.appFor, approvalFor: (state) => sharedPlanApproval({
          manifest: state.manifest, units: state.units,
          selectionFingerprints: state.selectionFingerprints, settings: state.settings,
          projectDirectory: state.project.directory }) }, options.action === "homarr-status", options.live);
    console.log(JSON.stringify({ ...result, command: `app shared ${options.action}`,
      projectRoot: options.projectRoot }, null, 2));
    return;
  }
  if (options.action === "status") {
    const current = existsSync(directory)
      ? await loadSharedProjectState(directory, options.projectId) : null;
    let jobs: string[] = [];
    if (current) jobs = manualJobIds(candidateFromState(current));
    const ports = Object.fromEntries(Object.keys(current?.units ?? {}).sort().map((appId) => {
      const front = current?.manifest.services.find((service: Entry) => service.id === appId);
      if (current) {
        try {
          return [appId, restoreSavedSharedSelection(current, appId, dependencies.recipeFor).port];
        } catch {
          // A single historical TCP binding is still useful for read-only inspection.
          // Ambiguous auxiliary ports never become a guessed browser frontend.
        }
      }
      if (front?.ports?.length === 1 && front.ports[0]?.protocol === "tcp"
        && Number.isInteger(front.ports[0].published)) return [appId, front.ports[0].published];
      return [appId, null];
    }));
    let privateHttpsRoutes: ReturnType<typeof savedSharedPrivateHttpsRoutes> = null;
    let privateHttpsError: string | null = null;
    if (current?.checkpoint.phase === "completed") {
      try { privateHttpsRoutes = savedSharedPrivateHttpsRoutes(current, dependencies.recipeFor); }
      catch { privateHttpsError = "Saved private HTTPS route binding requires inspection; no TLS or application claim is made."; }
    }
    const endpoints: Record<string, unknown> = {};
    const urls = Object.fromEntries(Object.entries(ports).map(([appId, port]) => {
      if (port === null || (appId === "caddy" && (privateHttpsRoutes !== null || privateHttpsError !== null
        || existsSync(join(directory, "private-https-binding.json"))))) return [appId, null];
      const manifest = dependencies.appFor?.(appId) ?? dependencies.recipeFor(appId).app ?? { id: appId };
      if (manifest.id !== appId) fail("frontend metadata differs from its saved app");
      const front = current!.manifest.services.find((service: Entry) => service.id === appId);
      const target = front?.ports?.find((item: Entry) => item.published === port && item.protocol === "tcp")?.target;
      const resolved = resolveAppEndpoints(manifest, port, appId, target);
      endpoints[appId] = resolved.endpoint;
      return [appId, resolved.browserUrl];
    }));
    let runtime: Record<string, Entry> | null = null;
    if (options.live && current?.checkpoint.phase === "completed") {
      const owner = createSelfhostComposeOwner(current.manifest);
      const plan = await owner.plan();
      await owner.checkRendered(plan);
      const origins = await loadSharedUnitComposeOrigins(current.project.directory,
        current.project.id, current.recordHash);
      runtime = {};
      for (const appId of Object.keys(current.units).sort()) {
        try { runtime[appId] = sharedUnitRuntime(current, appId, plan.render.target, origins[appId]); }
        catch { runtime[appId] = { state: "unknown", health: "unknown", checkedAt: new Date().toISOString() }; }
      }
    }
    const mediaPath = internalMediaPath(options.projectRoot, options.projectId);
    const expectsMedia = current?.manifest.services.some((service: Entry) =>
      service.mounts.some((mount: Entry) => mount.source === mediaPath)) ?? false;
    const mediaPathMatches = !expectsMedia
      || (current?.checkpoint.phase === "reviewed" ? !existsSync(mediaPath) : existsSync(mediaPath));
    const response = { command: "app shared status", mutation: false,
      status: current?.checkpoint.phase ?? "not-created", projectId: options.projectId,
      projectRoot: options.projectRoot, apps: Object.keys(current?.units ?? {}).sort(),
      removedApps: current ? await sharedReinstallOptions(current, dependencies.recipeFor) : [],
      urls, ports, endpoints, privateHttpsRoutes, privateHttpsError, runtime, manualJobs: jobs, jobExecutionVerified: false,
      ...sharedImageInventory(current, dependencies.recipeFor),
      revision: current?.revision ?? null,
      resumeApproval: current && mediaPathMatches ? preparedResumeApproval(current) : null,
      prestart: current ? sharedPrestartContracts(current.manifest) : [],
      recovery: mediaPathMatches ? null
        : "Shared media path differs from the saved preparation checkpoint; inspect before retrying.",
      setup: await setupCoverage(Object.keys(current?.units ?? {}).sort(), jobs) };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else {
      console.log(`${response.status}: ${response.apps.join(", ") || "no saved apps"}`);
      if (response.recovery) console.log(response.recovery);
    }
    return;
  }
  await assertPackagedCatalogProject(options.projectRoot);
  if (options.action === "reinstall") {
    await sharedReinstallCommand({ projectRoot: options.projectRoot, projectId: options.projectId,
      appId: options.appIds[0]!, approval: options.approval, json: options.json }, dependencies.recipeFor);
    return;
  }
  if (options.action === "remove") {
    const current = await loadSharedProjectState(directory, options.projectId);
    if (!current || current.project.directory !== directory) fail("remove needs one exact saved shared owner");
    const reviewRemoval = async (saved: SharedProjectState) => {
      let source = saved;
      const recovering = saved.checkpoint.operation === "remove" && saved.checkpoint.phase === "reviewed";
      if (recovering) {
        if (JSON.stringify(options.appIds) !== JSON.stringify(saved.checkpoint.appIds)) {
          fail("reviewed removal recovery needs its exact saved app selection");
        }
        source = await loadReviewedSharedRemovalSource(saved);
      }
      const review = await sharedRemovalReview(source, options.appIds, dependencies);
      if (recovering && JSON.stringify(review.candidate) !== JSON.stringify(candidateFromState(saved))) {
        fail("reviewed removal inventory changed; inspect before recovery");
      }
      return { ...review, recovering };
    };
    const review = await reviewRemoval(current);
    const base = { command: "app shared remove", projectRoot: options.projectRoot,
      projectId: options.projectId, apps: options.appIds, retained: review.retained,
      services: review.services, dataPreserved: true, credentialsPreserved: true };
    if (!options.applyRemoval) {
      const response = { ...base, status: "review", mutation: false, approval: review.approval };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(`Review container removal for ${options.appIds.join(", ")}; data and credentials retained. Apply with --apply --approval ${review.approval}`);
      return;
    }
    if (options.approval !== review.approval) fail("remove requires the exact saved-revision approval");
    await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (!latest || latest.recordHash !== current.recordHash) fail("shared owner changed after removal review");
      const locked = await reviewRemoval(latest);
      if (locked.approval !== options.approval) fail("removal selection changed after review");
      const retainedOwner = createSelfhostComposeOwner(locked.candidate.manifest);
      const retainedPlan = await retainedOwner.plan();
      if (!locked.recovering) await retainedOwner.render(retainedPlan);
      await retainedOwner.checkRendered(retainedPlan);
      let reviewed = latest;
      if (!locked.recovering) {
        reviewed = await saveSharedProjectState(locked.candidate,
          { operation: "remove", phase: "reviewed", appIds: options.appIds },
          { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
      }
      const attempted = await saveSharedProjectState(locked.candidate,
        { operation: "remove", phase: "attempted", appIds: options.appIds },
        { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
      try {
        for (const group of locked.groups) {
          await group.owner.removeSelected(group.plan, group.selected.services, group.selected.approval);
        }
        await saveSharedProjectState(locked.candidate,
          { operation: "remove", phase: "completed", appIds: options.appIds },
          { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
      } catch {
        try {
          await saveSharedProjectState(locked.candidate,
            { operation: "remove", phase: "inspect-required", appIds: options.appIds },
            { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
        } catch {
          // Preserve the original unknown-outcome classification even when the
          // journal append failed or completed bytes were already persisted.
        }
        throw new SharedProjectCommandError("removal outcome is uncertain; inspect original Compose containers and the checkpoint before retrying; data and credentials retained", "shared-remove-inspect-required");
      }
    });
    const response = { ...base, status: "removed-unverified", mutation: true };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log(`Removed selected containers; ${review.retained.join(", ")} retained. Data and private credentials retained; application acceptance unverified.`);
    return;
  }
  if (options.action === "recipe-migration-plan" || options.action === "recipe-migration-apply") {
    await sharedRecipeMigrationCommand({ action: options.action, projectRoot: options.projectRoot,
      projectId: options.projectId, appId: options.appIds[0]!, approval: options.approval, json: options.json },
    dependencies.recipeFor);
    return;
  }
  if (options.action === "image-transition-plan" || options.action === "image-transition-apply") {
    const appId = options.appIds[0]!;
    await sharedImageTransitionCommand({ action: options.action, projectRoot: options.projectRoot,
      projectId: options.projectId, appId, approval: options.approval, json: options.json },
    dependencies.recipeFor, async () => {
      const info = dependencies.recipeFor(appId);
      return pinnedImages(await dependencies.resolveImage(appId), info, appId);
    });
    return;
  }
  if (options.action === "acceptance-begin" || options.action === "acceptance-finish") {
    if (!dependencies.appFor) fail("catalog metadata is unavailable for app acceptance");
    const appId = options.appIds[0]!;
    if (!await sharedAcceptanceAvailable(appId)) {
      const response = { command: `app shared ${options.action}`, status: "blocked", mutation: false,
        projectRoot: options.projectRoot, projectId: options.projectId, appId,
        reason: "No reviewed packaged acceptance contract for this app; no credentials, canary or containers touched" };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(`${appId}: ${response.reason}.`);
      return;
    }
    const owner = createSharedAcceptanceOwner(options.projectRoot, options.projectId, options.appIds[0]!, {
      recipeFor: dependencies.recipeFor, appFor: dependencies.appFor,
      approvalFor: (state) => sharedPlanApproval(candidateFromState(state)),
    });
    let action: "begin" | "finish" = "begin";
    if (options.action === "acceptance-finish") action = "finish";
    const result = await sharedAcceptance({ action, approval: options.approval,
      inputs: options.inputs[appId],
      approvedSteps: options.approvedSteps,
      evidenceRoot: join(options.projectRoot, `selfhost-verification-${options.projectId}`) }, owner);
    const response = { ...result, command: `app shared ${options.action}`,
      projectRoot: options.projectRoot, projectId: options.projectId, appId: options.appIds[0] };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else {
      console.log(`${response.appId}: acceptance ${response.status}. This does not prove first-run setup or Homarr integration.`);
      if (response.status === "review") {
        console.log(`Selected services: ${response.services?.join(", ")}.`);
        for (const effect of response.effects ?? []) console.log(effect);
        for (const [service, image] of Object.entries(response.images ?? {})) console.log(`${service}: ${image}`);
        console.log(`Canary cleanup: ${response.cleanup}. Private evidence: ${response.evidenceRoot}`);
        console.log(`Apply this exact review with --approve ${response.approval}`);
      }
      if (response.status === "deferred") {
        for (const step of response.stepApprovals ?? []) console.log(`${step.progress}: --approve-step ${step.token}`);
        console.log("Request a fresh outer review, then retry with its approval and reviewed step tokens. No blind canary replay.");
      }
      if (response.status === "finished") console.log(`Private verification evidence: ${join(options.projectRoot, `selfhost-verification-${options.projectId}`)}`);
    }
    return;
  }
  if (options.action === "https-plan" || options.action === "https-apply" || options.action === "https-proof") {
    const response = await sharedPrivateHttpsCommand({ ...options, action: options.action }, {
      recipeFor: dependencies.recipeFor,
      image: async (recipe) => pinnedImages(await dependencies.resolveImage("caddy"),
        { ...dependencies.recipeFor("caddy"), recipe }, "caddy").caddy!,
      inspect: (current, selection) => {
        const mediaPath = internalMediaPath(options.projectRoot, options.projectId);
        const preparedMedia = current.manifest.services.some((service: Entry) =>
          service.mounts.some((mount: Entry) => mount.source === mediaPath));
        return inspectExistingSharedHost(sharedHostRequest(options.projectRoot,
          options.projectId, [selection], preparedMedia), candidateFromState(current)).observed;
      },
      runtime: exactLifecycleState,
      validateSaved: (current) => requireSavedSharedGeneratedRecipes(current, dependencies.recipeFor),
      desiredApproval: sharedPlanApproval,
    });
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else {
      console.log(`Private HTTPS: ${response.status}.`);
      if (response.approval) console.log(`Exact approval: ${response.approval}`);
      console.log("TLS transport is separate from app setup, DNS, intended-client trust and application acceptance.");
    }
    return;
  }
  if (options.action === "job-plan" || options.action === "job-run") {
    const current = await loadSharedProjectState(directory, options.projectId);
    const appId = options.appIds[0]!;
    if (!current || current.checkpoint.phase !== "completed"
      || !manualJobIds(candidateFromState(current)).includes(appId)) {
      fail("a job probe needs one completed shared owner with an exact prepared manual job");
    }
    const selection = savedSelections(current, dependencies.recipeFor).find((item) => item.appId === appId);
    if (!selection || !isManualJobRecipe(selection.recipe)
      || createHash("sha256").update(JSON.stringify(selection)).digest("hex") !== current.selectionFingerprints[appId]) {
      fail("the saved manual-job recipe changed; review migration before running a probe");
    }
    const services = current.units[appId]!;
    const service = current.manifest.services.find((item: Entry) => item.id === services[0]);
    if (services.length !== 1 || JSON.stringify(service?.manualProbe) !== JSON.stringify(selection.recipe.execution.probe)) {
      fail("the saved manual job has no exact source-backed version probe");
    }
    const owner = createSelfhostComposeOwner(current.manifest);
    const plan = await owner.plan();
    await owner.checkRendered(plan);
    const selected = await owner.selectedPlan(plan, "probe", services);
    const digest = createHash("sha256").update(JSON.stringify({ version: 1, recordHash: current.recordHash,
      appId, services, manualProbe: service.manualProbe, selectedApproval: selected.approval })).digest("hex");
    const approval = `SHARED-JOB-PROBE:${options.projectId}:${digest}`;
    const base = { command: `app shared ${options.action}`, projectRoot: options.projectRoot,
      projectId: options.projectId, appId, services, approval, probe: service.manualProbe,
      jobExecutionVerified: false, backupVerified: false, restoreVerified: false };
    if (options.action === "job-plan") {
      const response = { ...base, mutation: false, status: "review", probeOnly: true };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(`Review the fixed ${appId} version probe. Run with --approve ${approval}; no backup, init, or repository update is authorized.`);
      return;
    }
    if (options.approval !== approval) fail("job-run needs the exact saved-owner version-probe approval");
    await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (!latest || latest.recordHash !== current.recordHash) fail("shared owner changed after job-probe review");
      const before = await exactLifecycleState(latest, Object.keys(latest.units).sort(), plan.render.target);
      if (before[appId] !== "prepared") fail("the manual job is not inert; inspect before running a probe");
      const candidate = candidateFromState(latest);
      const reviewed = await saveSharedProjectState(candidate,
        { operation: "job-probe", phase: "reviewed", appIds: [appId] },
        { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
      const attempted = await saveSharedProjectState(candidate,
        { operation: "job-probe", phase: "attempted", appIds: [appId] },
        { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
      try {
        await owner.probeSelected(plan, services, selected.approval);
        const after = await exactLifecycleState(attempted, Object.keys(attempted.units).sort(), plan.render.target);
        if (JSON.stringify(after) !== JSON.stringify(before)) fail("a shared unit changed during the version probe");
      } catch {
        await saveSharedProjectState(candidate,
          { operation: "job-probe", phase: "inspect-required", appIds: [appId] },
          { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
        fail("job probe failed or its outcome is uncertain; inspect before retrying; no automatic replay");
      }
      await saveSharedProjectState(candidate,
        { operation: "job-probe", phase: "completed", appIds: [appId] },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
    });
    const response = { ...base, mutation: true, status: "probe-completed", probeOnly: true, versionProbeVerified: true };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log(`${appId} version probe completed. Backup, restore, and repository-update acceptance remain unverified.`);
    return;
  }
  if (options.action === "add") {
    if (!existsSync(directory)) fail("no saved shared project exists for app addition");
    const current = await loadSharedProjectState(directory, options.projectId);
    if (!current || current.project.directory !== directory || current.checkpoint.phase !== "completed") {
      fail("app addition needs a completed exact shared owner; inspect pending work");
    }
    const reviewAdd = async (saved: SharedProjectState) => {
      const removed = await loadSharedRemovedAppIds(saved.project.directory, saved.project.id, saved.recordHash);
      if (options.appIds.some((appId) => removed.includes(appId))) {
        throw new SharedProjectCommandError("removed app IDs retain data, named volumes, networks and credentials; safe reinstallation requires a separate reinstall transition that is not implemented", "shared-reinstall-required");
      }
      requireSavedSharedGeneratedRecipes(saved, dependencies.recipeFor);
      for (const appId of options.appIds) {
        if (Object.hasOwn(saved.units, appId)) fail(`${appId} is already installed in this shared project`);
      }
      const existingOwner = createSelfhostComposeOwner(saved.manifest);
      const existingPlan = await existingOwner.plan();
      await existingOwner.checkRendered(existingPlan);
      const before = await exactLifecycleState(saved, Object.keys(saved.units).sort(),
        existingPlan.render.target);
      const derivedBindings: SharedDerivedRecipeBinding[] = [];
      const derivedById = new Map<string, ReturnType<typeof deriveSharedRecipe>>();
      const additions = await Promise.all(options.appIds.map(async (appId): Promise<SharedAppSelection> => {
        let info: RecipeInfo;
        if (sharedDerivedRecipeAdapter(appId)) {
          const derived = deriveSharedRecipe(saved, { appId, inputs: options.inputs[appId] ?? {} });
          derivedById.set(appId, derived);
          info = { recipe: derived.recipe, services: derived.recipe.services,
            defaults: derived.recipe.defaults, storage: derived.recipe.storage,
            boundedApply: true, recipeSha256: derived.recipeSha256 };
        } else {
          if (Object.keys(options.inputs[appId] ?? {}).length > 0) fail(`${appId} has no derived installation input contract; use inputs during setup instead`);
          info = dependencies.recipeFor(appId);
        }
        if (!sharedRecipeEligible(appId, info.boundedApply) || info.recipe.schemaVersion !== 2
          || info.recipe.kind !== "multi-service-compose") {
          fail(`${appId} is not yet an eligible v2 shared Compose application`);
        }
        let image: ImageResult;
        if (sharedDerivedRecipeAdapter(appId)) image = await dependencies.resolveImage(appId, info.recipe);
        else image = await dependencies.resolveImage(appId);
        const selection = { appId, recipe: info.recipe, images: pinnedImages(image, info, appId),
          port: selectedPort(info, appId, options.ports),
          hostPaths: automaticMediaHostPaths(options.projectRoot, options.projectId, info.recipe) };
        return selection;
      }));
      const { used, reserved } = reservedSharedPorts(options.ports,
        saved.manifest.services.flatMap((service: Entry) => service.ports.map((port: Entry) => port.published)));
      for (const selection of additions) {
        const derived = derivedById.get(selection.appId);
        availableSharedFrontendPort(selection, options.ports, used, reserved);
        const additional = selectedApplicationPorts(selection.recipe, options.ports, used, reserved);
        if (Object.keys(additional).length > 0) selection.publishedPorts = additional;
        if (derived) {
          selection.derivationSha256 = createHash("sha256").update(JSON.stringify(derived)).digest("hex");
          derivedBindings.push(bindSharedDerivedRecipe(saved, { appId: selection.appId,
            inputs: options.inputs[selection.appId] ?? {} }, selection));
        }
      }
      const mediaPath = internalMediaPath(options.projectRoot, options.projectId);
      const preparedMediaPath = saved.manifest.services.some((service: Entry) =>
        service.mounts.some((mount: Entry) => mount.source === mediaPath));
      const host = inspectExistingSharedHost(sharedHostRequest(options.projectRoot,
        options.projectId, additions, preparedMediaPath), candidateFromState(saved));
      const candidate = extendSharedProject(candidateFromState(saved), additions,
        { projectRoot: options.projectRoot, projectId: options.projectId,
          dockerContext: host.dockerContext, uid: host.uid, gid: host.gid,
          timezone: host.timezone }, host.observed);
      const owner = createSelfhostComposeOwner(candidate.manifest);
      const plan = await owner.plan();
      const services = options.appIds.flatMap((appId) => candidate.units[appId]!).sort();
      const selected = await owner.selectedPlan(plan, "add", services);
      const identity: Entry = { version: 1,
        previousRecordHash: saved.recordHash, desired: sharedPlanApproval(candidate),
        appIds: options.appIds, services, before };
      derivedBindings.sort((left, right) => left.selection.appId.localeCompare(right.selection.appId));
      if (derivedBindings.length > 0) identity.derivedBindings = derivedBindings.map((binding) => binding.bindingHash);
      const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
      return { additions, derivedBindings, candidate, owner, plan, services, before, selected,
        approval: `SHARED-ADD:${options.projectId}:${digest}` };
    };
    const reviewed = await reviewAdd(current);
    const base = { command: "app shared add", projectId: options.projectId,
      projectRoot: options.projectRoot, added: options.appIds,
      retained: Object.keys(current.units).sort(), services: reviewed.services,
      images: Object.fromEntries(reviewed.additions.map((item) => [item.appId, item.images])),
      ports: Object.fromEntries(reviewed.additions.map((item) => [item.appId, item.port])),
      publishedPorts: Object.fromEntries(reviewed.additions.map((item) => [item.appId, item.publishedPorts ?? {}])),
      derivedInputs: Object.fromEntries(reviewed.derivedBindings.map((binding) =>
        [binding.selection.appId, binding.derived.input.inputs])),
      containerReadableConfigs: Object.fromEntries(reviewed.additions.map((item) =>
        [item.appId, generatedConfigReadability(item.recipe)])),
      prestart: sharedPrestartContracts(reviewed.candidate.manifest, reviewed.services),
      setup: await setupCoverage(options.appIds, manualJobIds(reviewed.candidate).filter((id) => options.appIds.includes(id))), dataPreserved: true,
      ownerSecretIds: reviewed.additions.flatMap((selection) => selection.recipe.privateFiles
        .filter((file: Entry) => file.source === "owner")
        .map((file: Entry) => `${selection.appId}:${file.id}`)) };
    if (options.approval === null) {
      const response = { ...base, status: "review", mutation: false, approval: reviewed.approval };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else {
        console.log(`Review adding ${options.appIds.join(", ")} while retaining ${base.retained.join(", ")}. Apply with --approve ${reviewed.approval}`);
        reportReadableConfigs(base.containerReadableConfigs);
      }
      return;
    }
    if (options.approval !== reviewed.approval) fail("app addition needs its exact saved-revision approval");
    let addStatus = "added-unverified";
    await withSharedProjectMutationLock(options.projectRoot, options.projectId,
      selectionPorts(reviewed.additions), async () => {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== current.recordHash || latest.checkpoint.phase !== "completed") {
          fail("shared owner changed after addition review; inspect before retrying");
        }
        const locked = await reviewAdd(latest);
        if (locked.approval !== options.approval) {
          fail("addition images, ports, runtime, or recipe changed after review");
        }
        requireLocalSharedDockerContext(locked.candidate.manifest.project.dockerContext);
        for (const binding of locked.derivedBindings) await prepareSharedDerivedRecipeBinding(latest, binding);
        await prepareSharedProjectFiles(locked.candidate, locked.additions,
          await selectedOwnerSecrets(options.secretSources, locked.additions));
        await locked.owner.render(locked.plan);
        await locked.owner.checkRendered(locked.plan);
        const first = await saveSharedProjectState(locked.candidate,
          { operation: "add", phase: "reviewed", appIds: options.appIds },
          { revision: latest.revision, manifestHash: latest.manifestHash,
            checkpoint: latest.checkpoint });
        const prepared = await saveSharedProjectState(locked.candidate,
          { operation: "add", phase: "prepared", appIds: options.appIds },
          { revision: first.revision, manifestHash: first.manifestHash,
            checkpoint: first.checkpoint });
        if (sharedPrestartContracts(locked.candidate.manifest, locked.services).length > 0) {
          addStatus = "prepared-prestart";
          return;
        }
        await requireSharedPrestart(locked.candidate.manifest, "add", locked.services);
        const attempted = await saveSharedProjectState(locked.candidate,
          { operation: "add", phase: "attempted", appIds: options.appIds },
          { revision: prepared.revision, manifestHash: prepared.manifestHash,
            checkpoint: prepared.checkpoint });
        try {
          await locked.owner.addSelected(locked.plan, locked.services, locked.selected.approval);
          const after = await exactLifecycleState(attempted, Object.keys(attempted.units).sort(),
            locked.plan.render.target);
          const jobs = manualJobIds(locked.candidate);
          if (options.appIds.some((appId) => jobs.includes(appId)
            ? after[appId] !== "prepared" : after[appId] !== "running")
            || Object.keys(locked.before).some((appId) => after[appId] !== locked.before[appId])) {
            fail("added services or retained runtime differ from the reviewed project");
          }
        } catch {
          await saveSharedProjectState(locked.candidate,
            { operation: "add", phase: "inspect-required", appIds: options.appIds },
            { revision: attempted.revision, manifestHash: attempted.manifestHash,
              checkpoint: attempted.checkpoint });
          fail("app addition outcome is uncertain; inspect exact shared services before retrying");
        }
        await saveSharedProjectState(locked.candidate,
          { operation: "add", phase: "completed", appIds: options.appIds },
          { revision: attempted.revision, manifestHash: attempted.manifestHash,
            checkpoint: attempted.checkpoint });
      });
    let next = "Run app shared setup for the added apps, then verify login and restart separately.";
    if (addStatus === "prepared-prestart") next = "Complete the declared prestart approvals and fresh proof, then review status and resume the prepared addition.";
    const response = { ...base, status: addStatus, mutation: true,
      prestart: sharedPrestartContracts(reviewed.candidate.manifest, reviewed.services), next };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else if (addStatus === "prepared-prestart") console.log(`Prepared ${options.appIds.join(", ")} without starting the added services. ${next}`);
    else console.log(`Added ${options.appIds.join(", ")} without recreating retained services; first-run setup remains pending.`);
    return;
  }
  if (options.action === "start" || options.action === "stop") {
    if (!existsSync(directory)) fail("no saved shared project exists for selected lifecycle");
    const current = await loadSharedProjectState(directory, options.projectId);
    if (!current || current.project.directory !== directory || current.checkpoint.phase !== "completed") {
      fail("selected lifecycle needs a completed exact shared owner; inspect pending work");
    }
    if (options.appIds.some((id) => manualJobIds(candidateFromState(current)).includes(id))) {
      fail("manual jobs are inert; ordinary start/stop cannot execute them; use a separately approved job probe");
    }
    for (const appId of options.appIds) {
      if (!Object.hasOwn(current.units, appId)) fail(`${appId} is not a saved shared unit`);
    }
    if (options.action === "start") requireSavedSharedGeneratedRecipes(current, dependencies.recipeFor);
    const owner = createSelfhostComposeOwner(current.manifest);
    const plan = await owner.plan();
    await owner.checkRendered(plan);
    const before = await exactLifecycleState(current, options.appIds, plan.render.target);
    const desired = options.action === "start" ? "running" : "stopped";
    const changedApps = options.appIds.filter((appId) => before[appId] !== desired);
    const services = changedApps.flatMap((appId) => current.units[appId]!).sort();
    const base = { command: `app shared ${options.action}`, projectRoot: options.projectRoot,
      projectId: options.projectId, apps: options.appIds, services };
    if (changedApps.length === 0) {
      const response = { ...base, status: "no-change", mutation: false };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(`${options.appIds.join(", ")} already ${desired}; no change.`);
      return;
    }
    const selected = await owner.selectedPlan(plan, options.action, services);
    const approval = sharedLifecycleApproval(current, options.action, options.appIds,
      before, services, selected.approval);
    if (options.approval === null) {
      const response = { ...base, status: "review", mutation: false, approval };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(`Review ${options.action} for ${options.appIds.join(", ")} (${services.join(", ")}). Apply with --approve ${approval}`);
      return;
    }
    if (options.approval !== approval) fail("selected lifecycle needs the exact saved-revision approval");
    await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (!latest || latest.recordHash !== current.recordHash || latest.checkpoint.phase !== "completed") {
        fail("shared owner changed after lifecycle review; inspect before retrying");
      }
      if (options.action === "start") requireSavedSharedGeneratedRecipes(latest, dependencies.recipeFor);
      const lockedOwner = createSelfhostComposeOwner(latest.manifest);
      const lockedPlan = await lockedOwner.plan();
      await lockedOwner.checkRendered(lockedPlan);
      const lockedSelected = await lockedOwner.selectedPlan(lockedPlan, options.action, services);
      const lockedBefore = await exactLifecycleState(latest, options.appIds, lockedPlan.render.target);
      if (JSON.stringify(lockedBefore) !== JSON.stringify(before)) {
        fail("selected live state changed after review; inspect before retrying");
      }
      if (sharedLifecycleApproval(latest, options.action, options.appIds, lockedBefore, services,
        lockedSelected.approval) !== approval) fail("selected lifecycle plan changed after review");
      const candidate = candidateFromState(latest);
      if (options.action === "start") await requireSharedPrestart(candidate.manifest, "start", services);
      const reviewed = await saveSharedProjectState(candidate,
        { operation: options.action, phase: "reviewed", appIds: options.appIds },
        { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
      const attempted = await saveSharedProjectState(candidate,
        { operation: options.action, phase: "attempted", appIds: options.appIds },
        { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
      try {
        if (options.action === "start") {
          await lockedOwner.startSelected(lockedPlan, services, lockedSelected.approval);
        } else {
          await lockedOwner.stopSelected(lockedPlan, services, lockedSelected.approval);
        }
        const after = await exactLifecycleState(attempted, options.appIds, lockedPlan.render.target);
        if (options.appIds.some((appId) => after[appId] !== desired)) {
          fail("selected services did not reach the requested state");
        }
      } catch {
        await saveSharedProjectState(candidate,
          { operation: options.action, phase: "inspect-required", appIds: options.appIds },
          { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
        fail("selected lifecycle outcome is uncertain; inspect exact shared services before retrying");
      }
      await saveSharedProjectState(candidate,
        { operation: options.action, phase: "completed", appIds: options.appIds },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
    });
    const response = { ...base, status: "changed-unverified", mutation: true };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log(`${options.appIds.join(", ")} ${desired}; application acceptance remains unverified.`);
    return;
  }
  if (options.action === "transition-plan" || options.action === "transition-apply") {
    if (!existsSync(directory)) fail("no saved shared project exists for environment transition");
    const appId = options.appIds[0]!;
    const current = await loadSharedProjectState(directory, options.projectId);
    if (!current) fail("shared project has no saved owner revision");
    const selection = savedSelections(current, dependencies.recipeFor)
      .find((item) => item.appId === appId);
    if (!selection || createHash("sha256").update(JSON.stringify(selection)).digest("hex")
      !== current.selectionFingerprints[appId]) {
      fail("transition recipe differs from the exact saved app selection");
    }
    const recipe = selection.recipe;
    const descriptor = recipe.postFirstAccountEnvironment;
    if (!descriptor) fail(`${appId} has no recipe-declared first-account environment transition`);
    const identity = recipe.onboarding?.username ?? recipe.onboarding?.email;
    if (typeof identity !== "string" || typeof recipe.onboarding?.fileId !== "string") {
      fail("transition recipe lacks a saved administrator identity and credential file");
    }
    await requireFirstAccountProof(current, appId, options.projectRoot,
      identity, recipe.onboarding.fileId, await firstAccountApiKeyRef(current, appId));
    const review = reviewSharedEnvironmentTransition(current, appId, recipe, descriptor);
    const owner = createSelfhostComposeOwner(review.candidate.manifest);
    const plan = await owner.plan();
    const selected = await owner.selectedPlan(plan, "recreate", [review.serviceId]);
    const response = { command: `app shared ${options.action}`, status: "review",
      mutation: false, projectId: options.projectId, projectRoot: options.projectRoot, appId, serviceId: review.serviceId,
      previousRevision: current.revision, nextManifestHash: review.manifestHash,
      environment: { name: descriptor.name, from: descriptor.from, to: descriptor.to },
      approval: review.approval, acceptance: "saved administrator login must be verified separately" };
    if (options.action === "transition-plan") {
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else console.log(`Review ${appId} environment transition. Apply with --approve ${review.approval}`);
      return;
    }
    if (options.approval !== review.approval) fail("transition needs the exact saved-revision approval");
    await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (!latest || latest.recordHash !== current.recordHash) fail("shared owner changed after transition review");
      await requireFirstAccountProof(latest, appId, options.projectRoot,
        identity, recipe.onboarding.fileId, await firstAccountApiKeyRef(latest, appId));
      // A native bootstrap proof is not enough by itself: immediately before
      // immutable closure, recheck through the exact read-only adapter owner.
      if (descriptor.proof) {
        const exact = async (value: Entry) => {
          if (value.ownerRevision !== latest.revision || value.manifestHash !== latest.manifestHash) fail("shared transition owner changed during adapter inspection");
          return value;
        };
        const result = await inspectFirstRunSetup(options.projectRoot, appId,
          async () => { throw new Error("Shared transition inspection has no standalone read route"); }, {
            status: async (id) => exact(await sharedUnitStatus(options.projectRoot, options.projectId, id,
              dependencies.recipeFor, (state) => sharedPlanApproval(candidateFromState(state)), true, dependencies.appFor)),
            handoff: async (id) => exact(await sharedUnitHandoff(options.projectRoot, options.projectId, id,
              dependencies.recipeFor, (state) => sharedPlanApproval(candidateFromState(state)), dependencies.appFor)),
            async verifyMutableConfigs(id) { await requireSharedPrestart(latest.manifest, "start", latest.units[id]); },
            async resolveHttpsTarget(id) {
              if (!Object.hasOwn(latest.units, "caddy")) return null;
              return resolveOptionalSharedHttpsTarget(latest, dependencies.recipeFor("caddy").recipe, id);
            },
          });
        if (result.state !== "ready") fail("fresh owner-bound administration/HTTPS inspection failed; recovery remains enabled");
        const confirmed = await loadSharedProjectState(directory, options.projectId);
        if (!confirmed || confirmed.recordHash !== latest.recordHash) fail("shared owner changed during closure inspection");
      }
      await owner.render(plan);
      await owner.checkRendered(plan);
      const reviewed = await saveSharedProjectState(review.candidate,
        { operation: "transition", phase: "reviewed", appIds: [appId] },
        { revision: current.revision, manifestHash: current.manifestHash, checkpoint: current.checkpoint });
      const attempted = await saveSharedProjectState(review.candidate,
        { operation: "transition", phase: "attempted", appIds: [appId] },
        { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
      try {
        await owner.recreateSelected(plan, [review.serviceId], selected.approval);
      } catch (error) {
        await saveSharedProjectState(review.candidate,
          { operation: "transition", phase: "inspect-required", appIds: [appId] },
          { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
        throw error;
      }
      await saveSharedProjectState(review.candidate,
        { operation: "transition", phase: "completed", appIds: [appId] },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
    });
    const applied = { ...response, command: "app shared transition-apply", status: "recreated-unverified",
      mutation: true, approval: undefined };
    if (options.json) console.log(JSON.stringify(applied, null, 2));
    else console.log(`${appId} service recreated; saved administrator login remains unverified.`);
    return;
  }
  if (options.action === "handoff") {
    if (!existsSync(directory)) fail("no shared project exists for credential handoff");
    const appId = options.appIds[0]!;
    const handoff = options.show
      ? await sharedUnitSecretHandoff(options.projectRoot, options.projectId, appId,
        dependencies.recipeFor, (state) => sharedPlanApproval(candidateFromState(state)), dependencies.appFor)
      : await sharedUnitHandoff(options.projectRoot, options.projectId, appId,
        dependencies.recipeFor, (state) => sharedPlanApproval(candidateFromState(state)), dependencies.appFor);
    const response = { ...handoff, command: "app shared handoff" };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log(formatSharedHandoff(response, options.show));
    return;
  }
  if (options.action === "setup") {
    if (!existsSync(directory)) fail("no shared project exists to set up");
    const current = await loadSharedProjectState(directory, options.projectId);
    if (!current || current.checkpoint.phase !== "completed"
      || options.appIds.some((appId) => !Object.hasOwn(current.units, appId))) {
      fail("setup needs a completed shared project containing every selected app");
    }
    const coverage = await setupCoverage(options.appIds,
      manualJobIds(candidateFromState(current)).filter((id) => options.appIds.includes(id)));
    const direct = coverage.direct;
    const declaredAfter = await resolveSetupAfter(direct);
    const { groups, dependencies: setupDependencies } = sharedSetupGroups(direct, current,
      (appId) => ({ recipe: restoreSavedSharedSelection(current, appId, dependencies.recipeFor).recipe }), declaredAfter);
    const inputs = await resolveSetupInputs(options.appIds, options.inputs);
    const peerEffects = await resolvePeerEffects(direct, Object.keys(current.units));
    const setupContracts = Object.fromEntries(await Promise.all(direct.map(async (appId) =>
      [appId, await setupContractSha256(appId, Object.keys(current.units))] as const)));
    const setupApproval = sharedSetupApproval(current, options.appIds, inputs, setupContracts);
    if (options.approval === null) {
      const response = { command: "app shared setup", mutation: false, status: "review",
        projectId: options.projectId, projectRoot: options.projectRoot, apps: options.appIds, inputs, approval: setupApproval,
        setup: { ...coverage, parallelGroups: groups, peerEffects, setupContracts,
          inputDefinitions: await resolveSetupInputDefinitions(direct) },
        next: "Approve this exact shared owner before extracting credentials or running first-run steps." };
      if (options.json) console.log(JSON.stringify(response, null, 2));
      else {
        console.log(`Review setup for ${options.appIds.join(", ")}.`);
        for (const [appId, choices] of Object.entries(inputs)) {
          for (const [key, value] of Object.entries(choices)) console.log(`${appId}.${key}=${value}`);
        }
        for (const effect of peerEffects) {
          console.log(`${effect.appId} with installed ${effect.peerAppId}: ${effect.description}`);
        }
        console.log(`Approve with --approve ${setupApproval}`);
      }
      return;
    }
    if (options.approval !== setupApproval) fail("setup needs the exact saved project and app selection approval");
    const observer = await createSharedSetupObservationJournal(current, direct,
      dependencies.recipeFor, setupContracts, dependencies.appFor);
    const stepApprovals: Array<{ appId: string; action: string; token: string; progress: string }> = [];
    const exactOwner = (value: Entry): Entry => {
      if (value.ownerRevision !== current.revision || value.manifestHash !== current.manifestHash) {
        fail("shared owner changed after setup approval; inspect before continuing");
      }
      return value;
    };
    const resolveSetupHttpsTarget = async (appId: string) => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (!latest || latest.recordHash !== current.recordHash) fail("shared owner changed after setup review");
      if (!Object.hasOwn(latest.units, "caddy")) return null;
      const target = await resolveOptionalSharedHttpsTarget(latest, dependencies.recipeFor("caddy").recipe, appId);
      if (target && sharedDerivedRecipeAdapter(appId)) {
        const binding = loadSharedDerivedRecipeBindingSync(directory, appId, latest);
        const canonicalOrigin = binding.derived.configuration?.canonicalOrigin;
        if (canonicalOrigin !== undefined && canonicalOrigin !== target.origin) {
          fail("saved application canonical origin differs from its private HTTPS setup route");
        }
        const expectedProxyAddress = binding.derived.configuration?.trustedProxyAddress;
        if (expectedProxyAddress !== undefined) {
          if (!target.proxyProfile || typeof expectedProxyAddress !== "string") {
            fail("application proxy trust needs its exact source-bound shared HTTPS profile");
          }
          const edge = latest.manifest.services.find((service: Entry) => service.id === "caddy");
          const front = latest.manifest.networks.find((network: Entry) => network.id === "front");
          const origins = await loadSharedUnitComposeOrigins(directory, options.projectId, latest.recordHash);
          const edgeComposeTarget = origins.caddy;
          if (!edge || !front || !edge.networks.includes("front") || typeof edgeComposeTarget !== "string"
            || Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
            fail("trusted proxy inspection needs the exact shared edge and Docker context");
          }
          const base = ["--context", latest.project.dockerContext];
          const selected = spawnSync("docker", [...base, "compose", "--project-name", latest.project.id,
            "--file", edgeComposeTarget, "ps", "-q", "caddy"], {
            encoding: "utf8", timeout: 15000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"],
          });
          const id = selected.stdout?.trim();
          if (selected.error || selected.status !== 0 || !/^[0-9a-f]{64}$/.test(id ?? "")) {
            fail("the exact owned proxy container could not be observed; setup remains pending");
          }
          const format = '{{.Id}}|{{.State.Running}}|{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}|'
            + `{{with index .NetworkSettings.Networks ${JSON.stringify(front.name)}}}{{.IPAddress}}{{end}}`;
          const inspect = () => spawnSync("docker", [...base, "container", "inspect", "--format", format, id!], {
            encoding: "utf8", timeout: 15000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"],
          });
          const observed = inspect();
          const expected = [id, "true", edge.image, latest.project.id, "caddy", edgeComposeTarget,
            latest.project.directory, "False", expectedProxyAddress].join("|");
          if (observed.error || observed.status !== 0 || observed.stdout.trim() !== expected) {
            fail("the observed owned proxy IPv4 differs from the saved trust selection; no setup credentials were released");
          }
          const confirmedOwner = await loadSharedProjectState(directory, options.projectId);
          const confirmed = inspect();
          if (!confirmedOwner || confirmedOwner.recordHash !== latest.recordHash
            || confirmed.error || confirmed.status !== 0 || confirmed.stdout.trim() !== expected) {
            fail("shared proxy ownership or IPv4 changed during trust inspection; setup remains pending");
          }
        }
      }
      return target;
    };
    const owner = {
      async inspectManualJob(appId: string) {
        return inspectSharedManualJobPreparation(current, appId, dependencies.recipeFor);
      },
      async resolveBootstrapCapabilityRecipe(appId: string) {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== current.recordHash || !Object.hasOwn(latest.units, appId)) {
          fail("shared owner changed after setup review");
        }
        return structuredClone(restoreSavedSharedSelection(latest, appId, dependencies.recipeFor).recipe);
      },
      async resolvePrivateOpenPgpContext(appId: string) {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== current.recordHash || !Object.hasOwn(latest.units, appId)) {
          fail("shared owner changed after setup review");
        }
        const selection = restoreSavedSharedSelection(latest, appId, dependencies.recipeFor);
        const enrollment = selection.recipe.onboarding;
        const choices = inputs[appId] ?? {};
        const target = await resolveSetupHttpsTarget(appId);
        if (enrollment?.kind !== "gpg-client-enrollment"
          || Object.keys(enrollment).sort().join(",") !== "kind,officialUrl" || !target) {
          fail("client OpenPGP custody needs its exact saved enrollment source and reviewed identity");
        }
        const profile: import("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-openpgp.ts").PrivateOpenPgpContext = { sourceUrl: enrollment.officialUrl,
          recipeHash: createHash("sha256").update(JSON.stringify(selection.recipe)).digest("hex"),
          canonicalOrigin: target.origin };
        const identityKeys = ["email", "first-name", "last-name"];
        if (identityKeys.some((key) => Object.hasOwn(choices, key))) {
          if (identityKeys.some((key) => typeof choices[key] !== "string")) {
            fail("new OpenPGP identity choices must include the complete reviewed identity");
          }
          profile.identity = { name: `${choices["first-name"]} ${choices["last-name"]}`, email: choices.email };
        }
        return profile;
      },
      async verifyMutableConfigs(appId: string) {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== current.recordHash || !Object.hasOwn(latest.units, appId)) {
          fail("shared owner changed after setup review");
        }
        restoreSavedSharedSelection(latest, appId, dependencies.recipeFor);
        // The same read-only gate validates private config semantics and actual
        // daemon namespace mapping before startup or credential readback.
        await requireSharedPrestart(latest.manifest, "start", latest.units[appId]);
        const after = await loadSharedProjectState(directory, options.projectId);
        if (!after || after.recordHash !== current.recordHash) fail("shared owner changed during configuration validation");
      },
      async observeContainerImage(appId: string) {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== current.recordHash) fail("shared owner changed after setup review");
        return sharedUnitObserveContainerImage(latest, appId);
      },
      async requireSameDaemonDirectory(appId: string) {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== current.recordHash || !Object.hasOwn(latest.units, appId)
          || !latest.manifest.services.some((service: Entry) => latest.units[appId]!.includes(service.id) && service.ownerDirectory)) fail("shared owner changed or has no owned daemon directory");
        restoreSavedSharedSelection(latest, appId, dependencies.recipeFor);
        await requireSharedPrestart(latest.manifest, "start", latest.units[appId]);
        const after = await loadSharedProjectState(directory, options.projectId);
        if (!after || after.recordHash !== current.recordHash) fail("shared owner changed during same-daemon directory validation");
      },
      async status(appId: string) {
        const status = exactOwner(await sharedUnitStatus(options.projectRoot, options.projectId,
          appId, dependencies.recipeFor, (state) => sharedPlanApproval(candidateFromState(state)), true, dependencies.appFor));
        const target = await resolveSetupHttpsTarget(appId);
        if (target) status.setupUrl = target.origin;
        return status;
      },
      async handoff(appId: string) {
        return exactOwner(await sharedUnitHandoff(options.projectRoot, options.projectId,
          appId, dependencies.recipeFor, (state) => sharedPlanApproval(candidateFromState(state)), dependencies.appFor));
      },
      resolveHttpsTarget: resolveSetupHttpsTarget,
      async resolvePeerTarget(appId: string) {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.recordHash !== current.recordHash) fail("shared owner changed after setup review");
        restoreSavedSharedSelection(latest, appId, dependencies.recipeFor);
        return { target: resolveSharedServiceTarget(latest, appId), ownerRevision: latest.revision,
          ownerRecordHash: latest.recordHash, manifestHash: latest.manifestHash };
      },
    };
    const transport: SetupTransport = {
      async read() { throw new Error("Shared setup has no standalone app read route"); },
      async mutate() { throw new Error("Shared setup has no standalone app mutation route"); },
      async approve(appId, action, token, progress) {
        if (options.approvedSteps.includes(token)) return true;
        stepApprovals.push({ appId, action, token, progress });
        return false;
      },
    };
    const outcomes: SetupOutcome[] = [];
    for (const group of groups) {
      const runnable = group.filter((appId) => {
        const after = setupDependencies.get(appId) ?? [];
        return after.every((id) => !options.appIds.includes(id)
          || outcomes.some((outcome) => outcome.appId === id && outcome.state === "ready"));
      });
      for (const appId of group) {
        if (!runnable.includes(appId)) outcomes.push({ appId, state: "deferred",
          detail: "A selected shared setup dependency is not verified" });
      }
      const groupInputs = Object.fromEntries(runnable.filter((appId) => inputs[appId])
        .map((appId) => [appId, inputs[appId]]));
      outcomes.push(...await runFirstRunSetups(options.projectRoot, runnable, transport, owner,
        groupInputs, Object.keys(current.units).sort(), observer));
    }
    const pending: SetupOutcome[] = coverage.pending
      .map((appId) => ({ appId, state: "needs-inspection",
        detail: "This app still needs a shared-owner first-run adapter; no standalone command was called" }));
    const transitionCandidates = await sharedSetupTransitionCandidates(current, outcomes,
      options.projectRoot, dependencies.recipeFor);
    const reportedOutcomes: Array<SetupOutcome & { recoveryHandoff?: string[] }> = [...outcomes, ...pending]
      .sort((left, right) => left.appId.localeCompare(right.appId))
      .map((outcome) => {
        if (outcome.state !== "needs-inspection") return outcome;
        return { ...outcome, recoveryHandoff: ["app", "shared", "handoff", "--project-root", options.projectRoot,
          "--project-id", options.projectId, "--app", outcome.appId, "--json"] };
      });
    const response = { command: "app shared setup", mutation: true, status: "setup-attempted",
      projectId: options.projectId, projectRoot: options.projectRoot, apps: options.appIds,
      outcomes: reportedOutcomes,
      preparedJobs: coverage.jobs, jobExecutionVerified: false,
      observationJournal: { path: join(directory, "setup-observations.json"), chronologyOnly: true,
        acceptanceVerified: false },
      transitionCandidates, stepApprovals, next: stepApprovals.length > 0
        ? "Review exact steps and rerun with repeated --approve-step TOKEN; newly discovered steps require fresh review."
        : "Verify each app login, function, saved credentials, and safe restart separately." };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else {
      for (const outcome of response.outcomes) {
        console.log(`${outcome.appId}: ${outcome.state}. ${outcome.detail}`);
        if (outcome.recoveryHandoff) console.log(`${outcome.appId}: inspect saved recovery with self-host arguments ${JSON.stringify(outcome.recoveryHandoff)}; no secret export or replay is authorized.`);
      }
      for (const appId of coverage.jobs) console.log(`${appId}: prepared, not executed. Only a separately approved version probe is available; functional acceptance remains pending.`);
      for (const step of stepApprovals) console.log(`${step.appId} ${step.action}: ${step.token}\n${step.progress}`);
    }
    return;
  }
  if (options.action === "resume") {
    if (!existsSync(directory)) fail("no shared project exists to resume");
    const current = await loadSharedProjectState(directory, options.projectId);
    if (!current || preparedResumeApproval(current) === null) {
      fail("only a reviewed/prepared create or prepared add checkpoint can resume; inspect attempted work");
    }
    const candidate = { manifest: current.manifest, units: current.units,
      selectionFingerprints: current.selectionFingerprints, settings: current.settings,
      projectDirectory: current.project.directory };
    if (options.approval !== preparedResumeApproval(current)) fail("resume needs the exact saved pre-Docker approval");
    const selections = savedSelections(current, dependencies.recipeFor);
    await withSharedProjectMutationLock(options.projectRoot, options.projectId,
      selectionPorts(selections), async () => {
        const latest = await loadSharedProjectState(directory, options.projectId);
        if (!latest || latest.revision !== current.revision || latest.recordHash !== current.recordHash) {
          fail("shared-project checkpoint changed during resume; inspect before retrying");
        }
        if (current.checkpoint.operation === "add") {
          if (Object.keys(options.secretSources).length > 0) fail("prepared addition already retained its private files; resume accepts no replacement secret inputs");
          await finishPreparedAdd(current, selections, dependencies);
          return;
        }
        const fresh = inspectNewSharedHost(sharedHostRequest(options.projectRoot,
          options.projectId, selections, current.checkpoint.phase === "prepared"));
        if (fresh.dockerContext !== current.project.dockerContext
          || fresh.uid !== current.settings.uid || fresh.gid !== current.settings.gid
          || fresh.timezone !== current.settings.timezone) {
          fail("shared-project host identity or timezone changed before resume");
        }
        const observed = { checkedAt: fresh.observed.checkedAt, project: null,
          ports: fresh.observed.ports, paths: fresh.observed.paths,
          networks: fresh.observed.networks,
          ...(Object.hasOwn(candidate.manifest.observed, "volumes")
            ? { volumes: fresh.observed.volumes } : {}) };
        await createSelfhostComposeOwner({ ...candidate.manifest, observed }).plan();
        await finishReviewedCreate(candidate, selections, current,
          await selectedOwnerSecrets(options.secretSources, selections), dependencies, true);
      });
    const response = { command: "app shared resume", mutation: true, status: "applied-unverified",
      projectId: options.projectId, apps: Object.keys(current.units).sort(),
      setup: await setupCoverage(Object.keys(current.units).sort(), manualJobIds(candidateFromState(current))) };
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log("Shared Compose project applied; manual jobs remain prepared and not executed. First-run setup and direct acceptance remain pending.");
    return;
  }
  requireUnownedRoot(options.projectRoot);
  if (existsSync(directory)) fail("this shared project already has files; use status and resume, not a fresh apply");
  const { selections, derivedBindings, candidate } = await reviewSharedCreateSelections(options, dependencies);
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const plan = await owner.plan();
  const approval = sharedPlanApproval(candidate);
  const response = { command: `app shared ${options.action}`, projectId: options.projectId,
    projectRoot: options.projectRoot, apps: options.appIds, units: candidate.units,
    images: Object.fromEntries(selections.map((item) => [item.appId, item.images])),
    ports: Object.fromEntries(selections.map((item) => [item.appId, item.port])),
    publishedPorts: Object.fromEntries(selections.map((item) => [item.appId, item.publishedPorts ?? {}])),
    installInputs: Object.fromEntries(derivedBindings.map((binding) => [binding.selection.appId, binding.derived.input.inputs])),
    containerReadableConfigs: Object.fromEntries(selections.map((item) =>
      [item.appId, generatedConfigReadability(item.recipe)])),
    prestart: sharedPrestartContracts(candidate.manifest),
    planId: plan.planId, approval, mutation: options.action === "apply",
    status: options.action === "plan" ? "review" : "applied-unverified",
    setup: await setupCoverage(options.appIds, manualJobIds(candidate)), dataPreserved: true,
    ownerSecretIds: selections.flatMap((selection) => selection.recipe.privateFiles
      .filter((file: Entry) => file.source === "owner")
      .map((file: Entry) => `${selection.appId}:${file.id}`)) };
  if (options.action === "plan") {
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else {
      console.log(`Review ${options.appIds.join(", ")} in one Compose project. Apply with --approve ${approval}`);
      reportReadableConfigs(response.containerReadableConfigs);
    }
    return;
  }
  if (options.approval !== approval) fail("apply needs the exact reviewed shared-project approval");
  let createStatus: "prepared-prestart" | "applied-unverified" = "applied-unverified";
  await withSharedProjectMutationLock(options.projectRoot, options.projectId,
    selectionPorts(selections), async () => {
      requireUnownedRoot(options.projectRoot);
      if (existsSync(directory)) fail("this shared project was created concurrently; inspect its saved state");
      await privateDirectory(join(options.projectRoot, ".selfhost"));
      await privateDirectory(join(options.projectRoot, ".selfhost", "shared"));
      await privateDirectory(directory);
      // A new Compose owner renders into an empty directory. Save checkpoints and
      // prepare credentials only after that no-clobber render has succeeded.
      await owner.render(plan);
      const reviewed = { operation: "create" as const, phase: "reviewed" as const,
        appIds: [...options.appIds] };
      const first = await saveSharedProjectState(candidate, reviewed,
        { revision: 0, manifestHash: null, checkpoint: null });
      for (const binding of derivedBindings) await prepareSharedDerivedRecipeBinding(first, binding);
      createStatus = await finishReviewedCreate(candidate, selections, first,
        await selectedOwnerSecrets(options.secretSources, selections), dependencies);
    });
  response.status = createStatus;
  if (options.json) console.log(JSON.stringify(response, null, 2));
  else if (createStatus === "prepared-prestart") console.log(`Prepared ${options.appIds.join(", ")} without starting services. Complete declared prestart approvals and fresh proof, then review status and resume.`);
  else console.log(`Applied ${options.appIds.join(", ")} in one Compose project; manual jobs remain prepared and not executed. First-run setup and direct acceptance remain pending.`);
}
