import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { withSharedProjectMutationLock } from "./lib/batch-mutation-lock.ts";
import { inspectExistingSharedHost } from "./lib/shared-host-observation.ts";
import { loadSharedProjectState, loadSharedRemovedAppIds, loadSharedRemovedAppSource,
  sharedReinstallCandidate, saveSharedProjectState, type SharedProjectState } from "./lib/shared-project-state.ts";
import { loadSharedUnitComposeOrigins } from "./lib/shared-project-state.ts";
import { restoreSavedSharedSelection, type SharedSavedRecipeFor } from "./lib/shared-saved-recipe.ts";
import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { sharedUnitRuntime } from "./lib/shared-unit-setup.ts";
import { sharedDerivedRecipeAdapter } from "./lib/shared-derived-recipe.ts";
import { bundledPostAccountTransition } from "./lib/shared-post-account-settings.ts";
import { bundledCanonicalOrigin } from "./lib/shared-canonical-origin-settings.ts";
import { sharedPrestartContracts } from "./lib/shared-prestart.ts";
import { isManualJobRecipe } from "./lib/manual-job.ts";
import { verifySharedGeneratedConfigFiles } from "./lib/multi-service-recipe.ts";

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
class SharedReinstallError extends Error {}
function fail(reason = "restore is changed, conflicted or requires inspection"): never {
  throw new SharedReinstallError(`Shared reinstall: ${reason}; preserved data and credentials were not reset`);
}

export function reviewSharedReinstallCandidate(current: SharedProjectState, source: SharedProjectState,
  appId: string, recipeFor: SharedSavedRecipeFor) {
  const selection = restoreSavedSharedSelection(source, appId, recipeFor);
  const recipe = selection.recipe;
  if (hash(recipe) !== hash(recipeFor(appId).recipe)) fail("current recipe differs from the saved selection; migration is separate");
  if (sharedDerivedRecipeAdapter(appId)) fail("derived app restoration is not supported");
  if (isManualJobRecipe(recipe)) fail("manual-job restoration is not supported");
  if (bundledPostAccountTransition(appId)) fail("post-account closure history restoration is not supported");
  if (bundledCanonicalOrigin(appId)) fail("canonical HTTPS history restoration is not supported");
  if (recipe.mutableConfigs?.length || recipe.privateConfigs?.length) fail("mutable or private-config restoration is not supported");
  if (sharedPrestartContracts(source.manifest, source.units[appId]).length) fail("prestart-authority restoration is not supported");
  if (source.manifest.services.filter((service: any) => source.units[appId]!.includes(service.id))
    .some((service: any) => service.ports.some((port: any) => port.protocol !== "tcp"))) fail("non-TCP port restoration is not supported");
  const candidate = sharedReinstallCandidate(current, source, appId);
  return { selection, candidate, services: source.units[appId]! };
}

/** Discovery uses validated source only; eligibility is not a live resource observation. */
export async function sharedReinstallOptions(current: SharedProjectState, recipeFor: SharedSavedRecipeFor) {
  const removed = await loadSharedRemovedAppIds(current.project.directory, current.project.id, current.recordHash);
  const results: { appId: string; status: "reviewable" | "needs-inspection" }[] = [];
  for (const appId of removed.filter((id) => !Object.hasOwn(current.units, id))) {
    let status: "reviewable" | "needs-inspection" = "needs-inspection";
    try {
      const { source } = await loadSharedRemovedAppSource(current, appId);
      reviewSharedReinstallCandidate(current, source, appId, recipeFor);
      status = "reviewable";
    } catch { /* Fixed discovery gap; no historical/private error payload crosses this boundary. */ }
    results.push({ appId, status });
  }
  return results;
}

async function verifyPreservedFiles(directory: string, selection: ReturnType<typeof restoreSavedSharedSelection>) {
  const privateFiles = join(directory, "secrets", selection.appId);
  for (const path of [directory, join(directory, "secrets"), privateFiles]) {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
      || (metadata.mode & 0o7777) !== 0o700 || await realpath(path) !== path) fail();
  }
  for (const file of selection.recipe.privateFiles) {
    if (typeof file.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(file.id)) fail();
    const path = join(privateFiles, file.id);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.uid !== process.getuid?.() || (metadata.mode & 0o7777) !== 0o600
      || metadata.size < 1 || metadata.size > 64 * 1024 || await realpath(path) !== path) fail();
  }
  await verifySharedGeneratedConfigFiles(selection.recipe, directory);
}

type Options = { projectRoot: string; projectId: string; appId: string; approval: string | null; json: boolean };
export async function sharedReinstallCommand(options: Options, recipeFor: SharedSavedRecipeFor) {
  const directory = join(options.projectRoot, ".selfhost", "shared", options.projectId);
  let current;
  try { current = await loadSharedProjectState(directory, options.projectId); } catch { fail(); }
  if (!current || current.project.directory !== directory || current.checkpoint.phase !== "completed") fail();
  const review = async (state: SharedProjectState) => {
    const { source, composeOrigin } = await loadSharedRemovedAppSource(state, options.appId);
    const restored = reviewSharedReinstallCandidate(state, source, options.appId, recipeFor);
    await verifyPreservedFiles(directory, restored.selection);
    // Observe all preserved resources, but require the removed services absent
    // rather than claiming a running container owns them. Recheck saved ports as free.
    const host = inspectExistingSharedHost({ projectRoot: options.projectRoot, projectId: options.projectId,
      tcpPorts: restored.candidate.manifest.services.filter((service: any) => restored.services.includes(service.id))
        .flatMap((service: any) => service.ports.map((port: any) => port.published)),
      volumeNames: [], minimumFreeBytes: 1024 * 1024, mediaPath: null, preparedMediaPath: false },
    restored.candidate, restored.services);
    restored.candidate.manifest.observed.checkedAt = host.observed.checkedAt;
    const currentOwner = createSelfhostComposeOwner(state.manifest);
    const currentPlan = await currentOwner.plan();
    await currentOwner.checkRendered(currentPlan);
    const origins = await loadSharedUnitComposeOrigins(directory, options.projectId, state.recordHash);
    const before = Object.fromEntries(Object.keys(state.units).sort().map((appId) =>
      [appId, sharedUnitRuntime(state, appId, currentPlan.render.target, origins[appId]).state]));
    if (Object.values(before).some((state) => !["running", "stopped", "prepared"].includes(state))) fail();
    const owner = createSelfhostComposeOwner(restored.candidate.manifest);
    const plan = await owner.plan();
    const originalOwner = createSelfhostComposeOwner(composeOrigin.manifest);
    const originalPlan = await originalOwner.plan();
    await originalOwner.checkRendered(originalPlan);
    const selected = await originalOwner.selectedPlan(originalPlan, "start", restored.services);
    const approval = `SHARED-REINSTALL:${options.projectId}:${hash({ recordHash: state.recordHash,
      sourceHash: source.recordHash, appId: options.appId, selection: restored.selection,
      services: restored.services, selected, before })}`;
    return { ...restored, source, owner, plan, originalOwner, originalPlan, selected, approval, before, origins };
  };
  let reviewed;
  try { reviewed = await review(current); } catch (error) { if (error instanceof SharedReinstallError) throw error; fail(); }
  const response = { command: "app shared reinstall", projectRoot: options.projectRoot, projectId: options.projectId,
    appId: options.appId, services: reviewed.services, retained: Object.keys(current.units).sort(),
    images: reviewed.selection.images, port: reviewed.selection.port, approval: reviewed.approval,
    status: "review", mutation: false, dataPreserved: true, credentialsRegenerated: false,
    accountSetupExecuted: false, acceptanceVerified: false,
    supportBoundary: "Standard static TCP apps only; derived, manual-job, post-account closure, canonical HTTPS, mutable/private-config and prestart-authority restoration remain unsupported." };
  if (options.approval === null) {
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log(`Review restoring ${options.appId} with preserved data and credentials. Apply with --approve ${reviewed.approval}`);
    return;
  }
  if (options.approval !== reviewed.approval) fail();
  await withSharedProjectMutationLock(options.projectRoot, options.projectId,
    reviewed.candidate.manifest.services.filter((service: any) => reviewed.services.includes(service.id))
      .flatMap((service: any) => service.ports.map((port: any) => port.published)), async () => {
      const latest = await loadSharedProjectState(directory, options.projectId);
      if (!latest || latest.recordHash !== current.recordHash) fail();
      let locked;
      try { locked = await review(latest); } catch (error) { if (error instanceof SharedReinstallError) throw error; fail(); }
      if (locked.approval !== options.approval) fail();
      await locked.owner.render(locked.plan);
      await locked.owner.checkRendered(locked.plan);
      const checkpoint = { operation: "reinstall" as const, phase: "reviewed" as const,
        appIds: [options.appId], reinstallSourceHash: locked.source.recordHash };
      const saved = await saveSharedProjectState(locked.candidate, checkpoint,
        { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
      const attempted = await saveSharedProjectState(locked.candidate, { ...checkpoint, phase: "attempted" },
        { revision: saved.revision, manifestHash: saved.manifestHash, checkpoint: saved.checkpoint });
      try {
        await locked.originalOwner.startSelected(locked.originalPlan, locked.services, locked.selected.approval);
        const runtime = sharedUnitRuntime(attempted, options.appId, locked.plan.render.target, locked.originalPlan.render.target);
        if (runtime.state !== "running") fail();
        for (const [appId, state] of Object.entries(locked.before)) {
          if (sharedUnitRuntime(attempted, appId, locked.plan.render.target, locked.origins[appId]).state !== state) fail();
        }
      } catch {
        await saveSharedProjectState(locked.candidate, { ...checkpoint, phase: "inspect-required" },
          { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
        throw new Error("Shared reinstall: startup outcome is uncertain; inspect this exact owner without resetting data, credentials or account checkpoints");
      }
      await saveSharedProjectState(locked.candidate, { ...checkpoint, phase: "completed" },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
    });
  const applied = { ...response, status: "restored-unverified", mutation: true, approval: undefined,
    next: "Verify existing credentials and app function separately; reinstall did not execute account setup or prove restart acceptance." };
  if (options.json) console.log(JSON.stringify(applied, null, 2));
  else console.log(`${options.appId} restored with preserved resources. ${applied.next}`);
}
