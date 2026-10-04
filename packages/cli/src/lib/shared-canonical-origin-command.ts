import { existsSync } from "node:fs";
import { join } from "node:path";
import { withSharedProjectMutationLock } from "./batch-mutation-lock.ts";
import { loadSharedProjectState, loadSharedReviewedCanonicalOrigin, saveSharedProjectState,
  type SharedProjectState } from "./shared-project-state.ts";
import { loadSharedUnitComposeOrigins } from "./shared-project-state.ts";
import { loadSharedPrivateHttpsBinding, loadSharedPrivateHttpsTransportProof,
  validateSharedPrivateHttpsTransportProof } from "./shared-private-https-state.ts";
import { reviewSharedCanonicalOriginTransition, reviewSharedReviewedCanonicalOriginTransition } from "./shared-canonical-origin-transition.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { sharedUnitRuntime } from "./shared-unit-setup.ts";

type Entry = Record<string, any>;
export type SharedCanonicalOriginCommandOptions = {
  action: "canonical-origin-plan" | "canonical-origin-apply";
  projectRoot: string;
  projectId: string;
  appId: string;
  approval: string | null;
};
export type SharedCanonicalOriginCommandDependencies = {
  /** Bundled app definitions only; no caller-provided manifest/environment authority. */
  recipeFor(appId: string): { recipe: Entry };
  /** Optional read-only exact-unit runtime observation, not application acceptance. */
  runtime?(current: SharedProjectState, appIds: string[], target: string,
    origins: Record<string, string>): Promise<Record<string, string>>;
  /** Fixture seam; production uses the existing exact selected-recreate owner. */
  recreate?: (owner: ReturnType<typeof createSelfhostComposeOwner>,
    plan: Awaited<ReturnType<ReturnType<typeof createSelfhostComposeOwner>["plan"]>>,
    services: string[], approval: string) => Promise<void>;
};

export class SharedCanonicalOriginError extends Error {
  readonly code = "shared-canonical-origin";
}

/** A distinct, separately approved app settings operation after saved verified TLS. */
export async function sharedCanonicalOriginCommand(options: SharedCanonicalOriginCommandOptions,
  dependencies: SharedCanonicalOriginCommandDependencies) {
  const directory = join(options.projectRoot, ".selfhost", "shared", options.projectId);
  const current = existsSync(directory) ? await loadSharedProjectState(directory, options.projectId) : null;
  if (!current || current.project.directory !== directory) {
    throw new SharedCanonicalOriginError("Canonical origin needs one saved shared owner with verified bound HTTPS");
  }
  const resolveReview = async (state: SharedProjectState) => {
    let origin = state;
    let resumeReviewed = false;
    if (state.checkpoint.phase !== "completed") {
      if (state.checkpoint.operation !== "canonical-origin" || state.checkpoint.phase !== "reviewed") {
        throw new SharedCanonicalOriginError("Canonical origin was attempted or owner work is pending; inspect before continuing; no automatic replay");
      }
      origin = await loadSharedReviewedCanonicalOrigin(directory, options.projectId, state.recordHash, options.appId);
      resumeReviewed = true;
    }
    const recipe = dependencies.recipeFor(options.appId).recipe;
    const caddy = dependencies.recipeFor("caddy").recipe;
    const binding = await loadSharedPrivateHttpsBinding(directory, caddy);
    const proof = await loadSharedPrivateHttpsTransportProof(directory, origin.recordHash);
    await validateSharedPrivateHttpsTransportProof(directory, proof);
    let review = reviewSharedCanonicalOriginTransition(origin, options.appId, recipe, caddy, binding, proof);
    if (resumeReviewed) {
      review = reviewSharedReviewedCanonicalOriginTransition(state, origin, options.appId, recipe, caddy, binding, proof);
      const previousOwner = createSelfhostComposeOwner(origin.manifest);
      await previousOwner.checkRendered(await previousOwner.plan());
      const pendingOwner = createSelfhostComposeOwner(review.candidate.manifest);
      await pendingOwner.checkRendered(await pendingOwner.plan());
    }
    return { origin, resumeReviewed, review };
  };
  const resolved = await resolveReview(current);
  const { review } = resolved;
  const owner = createSelfhostComposeOwner(review.candidate.manifest);
  const plan = await owner.plan();
  await owner.selectedPlan(plan, "recreate", review.serviceIds);
  let status = "review";
  if (resolved.resumeReviewed) status = "resume-reviewed";
  const response = { command: `app shared ${options.action}`, status, mutation: false,
    resumeReviewed: resolved.resumeReviewed, projectRoot: options.projectRoot, projectId: options.projectId,
    appId: options.appId, services: review.serviceIds, origin: review.origin,
    bindingHash: review.bindingHash, fromManifestHash: review.fromManifestHash,
    toManifestHash: review.toManifestHash, changes: review.changes, approval: review.approval,
    dataPreserved: true, credentialsRegenerated: false, applicationVerified: false,
    clientTrustVerified: false, acceptanceVerified: false,
    next: "Recreate only this saved app unit; existing login, effective app settings, client trust and restart acceptance remain separate." };
  if (options.action === "canonical-origin-plan") {
    if (options.approval !== null) throw new SharedCanonicalOriginError("Canonical origin plan is read-only and takes no approval");
    return response;
  }
  if (options.approval !== review.approval) {
    throw new SharedCanonicalOriginError("Canonical origin requires its exact separately reviewed saved-owner approval");
  }
  await withSharedProjectMutationLock(options.projectRoot, options.projectId, [], async () => {
    const latest = await loadSharedProjectState(directory, options.projectId);
    if (!latest || latest.recordHash !== current.recordHash) {
      throw new SharedCanonicalOriginError("Shared owner changed after canonical origin review; request a fresh review");
    }
    const lockedResolution = await resolveReview(latest);
    const locked = lockedResolution.review;
    if (locked.approval !== options.approval) {
      throw new SharedCanonicalOriginError("Canonical settings or bound transport changed after review");
    }
    const previousOwner = createSelfhostComposeOwner(lockedResolution.origin.manifest);
    const previousPlan = await previousOwner.plan();
    await previousOwner.checkRendered(previousPlan);
    const origins = await loadSharedUnitComposeOrigins(directory, options.projectId, latest.recordHash);
    const appIds = Object.keys(latest.units).sort();
    const observe = async (state: SharedProjectState, target: string, expectedOrigins: Record<string, string>) => {
      if (dependencies.runtime) return dependencies.runtime(state, appIds, target, expectedOrigins);
      const states: Record<string, string> = {};
      for (const appId of appIds) states[appId] = sharedUnitRuntime(state, appId, target, expectedOrigins[appId]).state;
      return states;
    };
    const before = await observe(lockedResolution.origin, previousPlan.render.target, origins);
    if (before[options.appId] !== "running") {
      throw new SharedCanonicalOriginError("Exact app unit is not running; inspect before canonical recreation");
    }
    const lockedOwner = createSelfhostComposeOwner(locked.candidate.manifest);
    const lockedPlan = await lockedOwner.plan();
    const selected = await lockedOwner.selectedPlan(lockedPlan, "recreate", locked.serviceIds);
    if (!lockedResolution.resumeReviewed) await lockedOwner.render(lockedPlan);
    await lockedOwner.checkRendered(lockedPlan);
    const checkpoint = { operation: "canonical-origin" as const, appIds: [options.appId], canonicalOrigin: locked.canonicalOrigin };
    let reviewed = latest;
    if (!lockedResolution.resumeReviewed) {
      reviewed = await saveSharedProjectState(locked.candidate, { ...checkpoint, phase: "reviewed" },
        { revision: latest.revision, manifestHash: latest.manifestHash, checkpoint: latest.checkpoint });
    }
    const attempted = await saveSharedProjectState(locked.candidate, { ...checkpoint, phase: "attempted" },
      { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
    try {
      if (dependencies.recreate) await dependencies.recreate(lockedOwner, lockedPlan, locked.serviceIds, selected.approval);
      else await lockedOwner.recreateSelected(lockedPlan, locked.serviceIds, selected.approval);
      const after = await observe(attempted, lockedPlan.render.target,
        { ...origins, [options.appId]: lockedPlan.render.target });
      if (after[options.appId] !== "running"
        || appIds.some((appId) => appId !== options.appId && after[appId] !== before[appId])) {
        throw new SharedCanonicalOriginError("Scoped recreation runtime is incomplete or changed a retained unit");
      }
    } catch {
      await saveSharedProjectState(locked.candidate, { ...checkpoint, phase: "inspect-required" },
        { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
      throw new SharedCanonicalOriginError("Canonical recreation outcome is uncertain; inspect exact app unit before retrying; retain credentials and data");
    }
    await saveSharedProjectState(locked.candidate, { ...checkpoint, phase: "completed" },
      { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  });
  return { ...response, status: "canonical-origin-applied-unverified", mutation: true, approval: undefined };
}
