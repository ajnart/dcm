import { join } from "node:path";
import { withSharedProjectMutationLock } from "./batch-mutation-lock.ts";
import { loadSharedProjectState, loadSharedReviewedMigrationOrigin, saveSharedProjectState,
  type SharedProjectState } from "./shared-project-state.ts";
import { reviewSharedImageTransition, reviewSharedReviewedImageTransition } from "./shared-image-transition.ts";
import type { SharedSavedRecipeFor } from "./shared-saved-recipe.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { observeSharedSavedUnitRuntime } from "./shared-unit-setup.ts";

type Options = { action: "image-transition-plan" | "image-transition-apply";
  projectRoot: string; projectId: string; appId: string; approval: string | null; json: boolean };
export class SharedImageTransitionError extends Error {
  readonly code = "shared-image-transition";
}

export async function sharedImageTransitionCommand(options: Options, recipeFor: SharedSavedRecipeFor,
  resolveImages: () => Promise<Record<string, string>>,
  observe = observeSharedSavedUnitRuntime) {
  const directory = join(options.projectRoot, ".selfhost", "shared", options.projectId);
  const current = await loadSharedProjectState(directory, options.projectId);
  if (!current || current.project.directory !== directory) {
    throw new SharedImageTransitionError("Image transition needs one exact saved owner");
  }
  let images: Record<string, string> | undefined;
  const resolveReview = async (state: SharedProjectState) => {
    if (state.checkpoint.phase === "completed") {
      if (!images) images = await resolveImages();
      return { origin: state, resumeReviewed: false,
        review: reviewSharedImageTransition(state, options.appId, recipeFor, images) };
    }
    if (state.checkpoint.operation !== "image-transition" || state.checkpoint.phase !== "reviewed") {
      throw new SharedImageTransitionError("Image update was attempted or other work is pending; inspect before continuing; no automatic replay");
    }
    const origin = await loadSharedReviewedMigrationOrigin(directory, options.projectId,
      state.recordHash, options.appId, "image-transition");
    return { origin, resumeReviewed: true,
      review: reviewSharedReviewedImageTransition(state, origin, options.appId, recipeFor) };
  };
  const resolved = await resolveReview(current);
  const { review } = resolved;
  const originalOwner = createSelfhostComposeOwner(resolved.origin.manifest);
  await originalOwner.checkRendered(await originalOwner.plan());
  const owner = createSelfhostComposeOwner(review.candidate.manifest);
  const plan = await owner.plan();
  await owner.selectedPlan(plan, "recreate", review.serviceIds);
  if (resolved.resumeReviewed) await owner.checkRendered(plan);
  let status = "review";
  if (resolved.resumeReviewed) status = "resume-reviewed";
  const response = { command: `app shared ${options.action}`, status, mutation: false,
    projectRoot: options.projectRoot, projectId: options.projectId, appId: options.appId,
    services: review.serviceIds, changes: review.changes, fromManifestHash: review.fromManifestHash,
    toManifestHash: review.toManifestHash, approval: review.approval,
    resumeReviewed: resolved.resumeReviewed, dataPreserved: true,
    credentialsRegenerated: false, acceptanceVerified: false };
  if (options.action === "image-transition-plan") {
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else console.log(`Review images for ${options.appId}. Apply with --approve ${review.approval}`);
    return;
  }
  if (options.approval !== review.approval) throw new SharedImageTransitionError("Image transition requires its exact saved-owner approval");
  await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
    const latest = await loadSharedProjectState(directory, options.projectId);
    if (!latest || latest.recordHash !== current.recordHash) throw new SharedImageTransitionError("Owner changed after image review");
    const lockedResolution = await resolveReview(latest);
    const locked = lockedResolution.review;
    if (locked.approval !== options.approval) throw new SharedImageTransitionError("Image transition changed after review");
    const observed = await observe(lockedResolution.origin, options.appId, latest.recordHash);
    if (observed.state !== "running") {
      throw new SharedImageTransitionError("Image-only recreation needs the exact saved app running; inspect stopped or partial units separately");
    }
    const previousOwner = createSelfhostComposeOwner(lockedResolution.origin.manifest);
    await previousOwner.checkRendered(await previousOwner.plan());
    const lockedOwner = createSelfhostComposeOwner(locked.candidate.manifest);
    const lockedPlan = await lockedOwner.plan();
    const selected = await lockedOwner.selectedPlan(lockedPlan, "recreate", locked.serviceIds);
    if (!lockedResolution.resumeReviewed) await lockedOwner.render(lockedPlan);
    await lockedOwner.checkRendered(lockedPlan);
    let reviewed = latest;
    if (!lockedResolution.resumeReviewed) reviewed = await saveSharedProjectState(locked.candidate,
      { operation: "image-transition", phase: "reviewed", appIds: [options.appId] },
      { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
    const attempted = await saveSharedProjectState(locked.candidate,
      { operation: "image-transition", phase: "attempted", appIds: [options.appId] },
      { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
    try {
      await lockedOwner.recreateSelected(lockedPlan, locked.serviceIds, selected.approval);
    } catch {
      await saveSharedProjectState(locked.candidate,
        { operation: "image-transition", phase: "inspect-required", appIds: [options.appId] },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
      throw new SharedImageTransitionError("Image update outcome is uncertain; inspect the saved app; do not reset credentials or data");
    }
    await saveSharedProjectState(locked.candidate,
      { operation: "image-transition", phase: "completed", appIds: [options.appId] },
      { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  });
  const applied = { ...response, status: "updated-unverified", mutation: true, approval: undefined };
  if (options.json) console.log(JSON.stringify(applied, null, 2));
  else console.log(`${options.appId} images updated; existing login, application and restart acceptance remain unverified.`);
}
