import { join } from "node:path";
import { withSharedProjectMutationLock } from "./batch-mutation-lock.ts";
import { loadSharedProjectState, loadSharedReviewedMigrationOrigin, saveSharedProjectState,
  type SharedProjectState } from "./shared-project-state.ts";
import { reviewSharedCatalogRecipeMigration, reviewSharedReviewedRecipeMigration } from "./shared-recipe-migration.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";

type Entry = Record<string, any>;
type Options = { action: "recipe-migration-plan" | "recipe-migration-apply";
  projectRoot: string; projectId: string; appId: string; approval: string | null; json: boolean };

export class SharedRecipeMigrationError extends Error {
  readonly code = "shared-recipe-migration";
}

/** The CLI supplies the bundled recipe, not a desired manifest or imported migration. */
export async function sharedRecipeMigrationCommand(options: Options,
  recipeFor: (appId: string) => { recipe: Entry }) {
  const directory = join(options.projectRoot, ".selfhost", "shared", options.projectId);
  const current = await loadSharedProjectState(directory, options.projectId);
  if (!current || current.project.directory !== directory) {
    throw new SharedRecipeMigrationError("Recipe migration needs a completed saved project; inspect pending work first");
  }
  const resolveReview = async (state: SharedProjectState) => {
    const recipe = recipeFor(options.appId).recipe;
    if (state.checkpoint.phase === "completed") {
      return { origin: state, resumeReviewed: false,
        review: reviewSharedCatalogRecipeMigration(state, options.appId, recipe) };
    }
    if (state.checkpoint.operation !== "recipe-migration" || state.checkpoint.phase !== "reviewed") {
      throw new SharedRecipeMigrationError("Migration was attempted or pending work is uncertain; inspect before continuing; no automatic replay");
    }
    const origin = await loadSharedReviewedMigrationOrigin(directory, options.projectId,
      state.recordHash, options.appId);
    const review = reviewSharedReviewedRecipeMigration(state, origin, options.appId, recipe);
    const originalOwner = createSelfhostComposeOwner(origin.manifest);
    await originalOwner.checkRendered(await originalOwner.plan());
    const reviewedOwner = createSelfhostComposeOwner(review.candidate.manifest);
    await reviewedOwner.checkRendered(await reviewedOwner.plan());
    return { origin, resumeReviewed: true, review };
  };
  const resolved = await resolveReview(current);
  const { review } = resolved;
  const owner = createSelfhostComposeOwner(review.candidate.manifest);
  const plan = await owner.plan();
  await owner.selectedPlan(plan, "recreate", review.serviceIds);
  let status = "review";
  let pendingRevision: number | undefined;
  if (resolved.resumeReviewed) { status = "resume-reviewed"; pendingRevision = current.revision; }
  const response = { command: `app shared ${options.action}`, status, mutation: false,
    resumeReviewed: resolved.resumeReviewed, pendingRevision,
    projectRoot: options.projectRoot, projectId: options.projectId, appId: options.appId, services: review.serviceIds,
    fromSelectionFingerprint: review.fromSelectionFingerprint,
    toSelectionFingerprint: review.toSelectionFingerprint,
    fromManifestHash: review.fromManifestHash, toManifestHash: review.toManifestHash,
    additions: review.additions, approval: review.approval,
    dataPreserved: true, credentialsRegenerated: false,
    acceptanceVerified: false,
    next: "Recreate only this saved app unit, then verify its existing login and application separately." };
  if (options.action === "recipe-migration-plan") {
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else {
      if (resolved.resumeReviewed) console.log("Resume-reviewed: no Docker attempt was recorded; fresh approval is required.");
      console.log(`Review recipe migration for ${options.appId}: ${review.serviceIds.join(", ")}. Data and credentials are retained.`);
      for (const addition of review.additions) console.log(`${addition.serviceId}: add ${addition.name}=${addition.value}`);
      console.log(`Apply with --approve ${review.approval}`);
    }
    return;
  }
  if (options.approval !== review.approval) {
    throw new SharedRecipeMigrationError("Recipe migration requires its exact saved-owner approval");
  }
  await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
    const latest = await loadSharedProjectState(directory, options.projectId);
    if (!latest || latest.recordHash !== current.recordHash) {
      throw new SharedRecipeMigrationError("Shared owner changed after migration review; request a fresh review");
    }
    const lockedResolution = await resolveReview(latest);
    const locked = lockedResolution.review;
    if (locked.approval !== options.approval) {
      throw new SharedRecipeMigrationError("Recipe migration changed after review; request a fresh review");
    }
    const previousOwner = createSelfhostComposeOwner(lockedResolution.origin.manifest);
    await previousOwner.checkRendered(await previousOwner.plan());
    const lockedOwner = createSelfhostComposeOwner(locked.candidate.manifest);
    const lockedPlan = await lockedOwner.plan();
    const selected = await lockedOwner.selectedPlan(lockedPlan, "recreate", locked.serviceIds);
    if (!lockedResolution.resumeReviewed) await lockedOwner.render(lockedPlan);
    await lockedOwner.checkRendered(lockedPlan);
    let reviewed = latest;
    if (!lockedResolution.resumeReviewed) {
      reviewed = await saveSharedProjectState(locked.candidate,
        { operation: "recipe-migration", phase: "reviewed", appIds: [options.appId] },
        { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
    }
    const attempted = await saveSharedProjectState(locked.candidate,
      { operation: "recipe-migration", phase: "attempted", appIds: [options.appId] },
      { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
    try {
      await lockedOwner.recreateSelected(lockedPlan, locked.serviceIds, selected.approval);
    } catch {
      await saveSharedProjectState(locked.candidate,
        { operation: "recipe-migration", phase: "inspect-required", appIds: [options.appId] },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
      throw new SharedRecipeMigrationError("Migration outcome is uncertain; inspect this app unit before retrying; do not reset credentials or data");
    }
    await saveSharedProjectState(locked.candidate,
      { operation: "recipe-migration", phase: "completed", appIds: [options.appId] },
      { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  });
  const applied = { ...response, status: "migrated-unverified", mutation: true, approval: undefined };
  if (options.json) console.log(JSON.stringify(applied, null, 2));
  else console.log(`${options.appId} recipe migrated; data and credentials retained. Existing login, application and restart acceptance remain unverified.`);
}
