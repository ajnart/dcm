import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import packageMetadata from "../../package.json";
import { withSharedProjectMutationLock } from "./batch-mutation-lock.ts";
import { assertPackagedCatalogProject } from "./catalog-project.ts";
import type { CompatibilityHomarrMode } from "./catalog-compatibility.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { sharedAcceptanceSubjectSha256, type SharedAcceptanceOwner,
  type SharedAcceptanceRuntimeUnit } from "./shared-acceptance.ts";
import { requireLocalSharedDockerContext } from "./shared-host-observation.ts";
import { loadSharedProjectState, loadSharedUnitComposeOrigins,
  type SharedProjectState } from "./shared-project-state.ts";
import { sharedUnitHandoff, sharedUnitRecipeCheck, sharedUnitRuntime,
  sharedUnitStatus } from "./shared-unit-setup.ts";

type Entry = Record<string, any>;
type Dependencies = {
  recipeFor(appId: string): { recipe: Entry; boundedApply: boolean; recipeSha256: string };
  appFor(appId: string): Entry;
  approvalFor(state: SharedProjectState): string;
};
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;

export class SharedAcceptanceOwnerError extends Error {
  constructor(message: string, readonly code = "shared-acceptance-owner") {
    super(`Shared acceptance: ${message}`);
    this.name = "SharedAcceptanceOwnerError";
  }
}
function fail(message: string, code?: string): never { throw new SharedAcceptanceOwnerError(message, code); }
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function docker(context: string, args: string[]): string {
  const result = spawnSync("docker", ["--context", context, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail("exact selected runtime could not be inspected");
  return result.stdout.trim();
}
function object(raw: string): Entry {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail("selected runtime returned invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("selected runtime returned invalid data");
  return value as Entry;
}

/** Production inspection only: no caller-supplied runtime or expected-image receipt. */
export function inspectSharedAcceptanceRuntime(state: SharedProjectState, appId: string,
  composeTarget: string, originTarget: string): SharedAcceptanceRuntimeUnit[] {
  requireLocalSharedDockerContext(state.project.dockerContext);
  const observed = sharedUnitRuntime(state, appId, composeTarget, originTarget);
  if (observed.state !== "running" && observed.state !== "stopped") {
    fail("selected services are partial or unknown; inspect before acceptance");
  }
  const services = state.units[appId];
  if (!services || services.length < 1 || services.length > 32) fail("selected saved services are unavailable");
  return [...services].sort().map((serviceId) => {
    const saved = state.manifest.services.find((service: Entry) => service.id === serviceId);
    if (!saved || typeof saved.image !== "string" || !/@sha256:[a-f0-9]{64}$/.test(saved.image)) {
      fail("acceptance requires every saved immutable image");
    }
    const containerId = docker(state.project.dockerContext, ["compose", "--project-name", state.project.id,
      "--file", composeTarget, "ps", "--all", "--quiet", serviceId]);
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) fail("selection does not resolve to exactly one saved container");
    const actual = object(docker(state.project.dockerContext, ["inspect", "--type", "container", containerId,
      "--format", '{"imageId":{{json .Image}},"image":{{json .Config.Image}},"startedAt":{{json .State.StartedAt}},"state":{{json .State.Status}},"labels":{{json .Config.Labels}}}']));
    // Inspect the local digest reference independently. Config.Image text alone is not image identity.
    const pinnedImageId = object(docker(state.project.dockerContext, ["image", "inspect", saved.image,
      "--format", '{"imageId":{{json .Id}}}'])).imageId;
    if (!IMAGE_ID.test(pinnedImageId) || actual.imageId !== pinnedImageId || actual.image !== saved.image
      || actual.labels?.["com.docker.compose.project"] !== state.project.id
      || actual.labels?.["com.docker.compose.service"] !== serviceId
      || actual.labels?.["com.docker.compose.project.config_files"] !== originTarget
      || actual.labels?.["com.docker.compose.project.working_dir"] !== state.project.directory
      || !["running", "exited"].includes(actual.state)
      || typeof actual.startedAt !== "string" || !Number.isFinite(Date.parse(actual.startedAt))) {
      fail("actual container image, owner or start epoch differs from the selected saved unit");
    }
    let stateName: "running" | "stopped" = "stopped";
    if (actual.state === "running") stateName = "running";
    if (stateName !== observed.state) fail("runtime changed during selected inspection");
    return { serviceId, imageId: actual.imageId, immutableImage: actual.image,
      startedAt: actual.startedAt, state: stateName };
  });
}

/** The CLI supplies only project/app selection; code, paths, images and proof come from this owner. */
export function createSharedAcceptanceOwner(root: string, projectId: string, appId: string,
  dependencies: Dependencies): SharedAcceptanceOwner {
  if (!isAbsolute(root) || resolve(root) !== root || root === "/"
    || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || appId.length > 47) {
    fail("choose one exact saved shared owner and app");
  }
  const directory = join(root, ".selfhost", "shared", projectId);
  let locked = false;
  async function current(): Promise<SharedProjectState> {
    await assertPackagedCatalogProject(root);
    const state = await loadSharedProjectState(directory, projectId);
    if (!state || state.project.directory !== directory || state.checkpoint.phase !== "completed"
      || !Object.hasOwn(state.units, appId)) fail("acceptance needs a completed active shared unit");
    if (sharedUnitRecipeCheck(state, appId, dependencies.recipeFor) !== "matches-saved-selection") {
      fail("saved recipe changed; review migration before acceptance", "shared-recipe-migration-required");
    }
    return state;
  }
  return {
    async identity() {
      const state = await current();
      const info = dependencies.recipeFor(appId);
      if (!/^[a-f0-9]{64}$/.test(info.recipeSha256)) fail("validated recipe identity is unavailable");
      const ownerAppIds = Object.keys(state.units).sort();
      const subjectSha256 = await sharedAcceptanceSubjectSha256(appId, ownerAppIds);
      if (!subjectSha256) fail("no packaged app-owned acceptance verifier is available");
      const images: Record<string, string> = {};
      for (const serviceId of [...state.units[appId]!].sort()) {
        const service = state.manifest.services.find((item: Entry) => item.id === serviceId);
        if (!service || !/@sha256:[a-f0-9]{64}$/.test(service.image)) fail("selected image pin is unavailable");
        images[serviceId] = service.image;
      }
      const app = dependencies.appFor(appId);
      if (app?.id !== appId || !app.homarr) fail("catalog integration identity is unavailable");
      let homarrMode: CompatibilityHomarrMode = "tile-only";
      if (app.homarr.integration) homarrMode = "native";
      if (app.homarr.support === "not-applicable") homarrMode = "not-applicable";
      if (appId === "homarr") homarrMode = "control-plane";
      return { directory, projectRoot: root, projectId, appId, ownerAppIds,
        services: [...state.units[appId]!].sort(),
        contract: { appId, dimension: "liveRestart", homarrMode,
          owner: { projectFingerprint: hash(state.project), revision: state.revision, manifestHash: state.manifestHash },
          recipeSha256: info.recipeSha256, images, subjectSha256,
          verifier: { id: "shared-app-acceptance", sourceSha256: subjectSha256, release: packageMetadata.version } } };
    },
    async status() {
      await current();
      return sharedUnitStatus(root, projectId, appId, dependencies.recipeFor, dependencies.approvalFor);
    },
    async handoff() {
      await current();
      return sharedUnitHandoff(root, projectId, appId, dependencies.recipeFor, dependencies.approvalFor);
    },
    async inspectRuntime() {
      const state = await current();
      const owner = createSelfhostComposeOwner(state.manifest);
      const plan = await owner.plan();
      await owner.checkRendered(plan);
      const origins = await loadSharedUnitComposeOrigins(directory, projectId, state.recordHash);
      if (!origins[appId]) fail("selected Compose origin is unavailable");
      return inspectSharedAcceptanceRuntime(state, appId, plan.render.target, origins[appId]);
    },
    async lifecycle(operation) {
      if (!locked) fail("selected acceptance lifecycle requires the held project mutation lock");
      const state = await current();
      const owner = createSelfhostComposeOwner(state.manifest);
      const plan = await owner.plan();
      await owner.checkRendered(plan);
      const origins = await loadSharedUnitComposeOrigins(directory, projectId, state.recordHash);
      if (!origins[appId]) fail("selected Compose origin is unavailable");
      const runtime = sharedUnitRuntime(state, appId, plan.render.target, origins[appId]);
      let requiredState = "stopped";
      if (operation === "stop") requiredState = "running";
      if (runtime.state !== requiredState) fail("selected runtime changed before its reviewed lifecycle action");
      const selected = await owner.selectedPlan(plan, operation, state.units[appId]!);
      // The dispatcher's approved, persisted chronology owns this exact restart. Ordinary up/down
      // would change the owner revision and invalidate the pre-restart canary binding.
      if (operation === "stop") await owner.stopSelected(plan, selected.services, selected.approval);
      else await owner.startSelected(plan, selected.services, selected.approval);
    },
    async lock(task) {
      return withSharedProjectMutationLock(root, projectId, [], async () => {
        if (locked) fail("acceptance mutation lock is already held");
        locked = true;
        try { return await task(); } finally { locked = false; }
      });
    },
  };
}
