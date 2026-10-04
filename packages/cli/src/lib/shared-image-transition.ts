import { createHash } from "node:crypto";
import type { SharedAppSelection, SharedProjectCandidate } from "./shared-compose-project.ts";
import type { SharedProjectState } from "./shared-project-state.ts";
import { restoreSavedSharedSelection, type SharedSavedRecipeFor } from "./shared-saved-recipe.ts";
import { pinnedMultiServiceImages } from "./multi-service-recipe.ts";

type Entry = Record<string, any>;
export type SharedImageTransitionReview = {
  candidate: SharedProjectCandidate;
  appId: string;
  serviceIds: string[];
  changes: { serviceId: string; from: string; to: string }[];
  fromManifestHash: string;
  toManifestHash: string;
  approval: string;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function withoutRecipeImages(recipe: Entry): Entry {
  const copy = structuredClone(recipe);
  for (const service of copy.services ?? []) {
    delete service.imageTag;
    delete service.imageSource;
  }
  return copy;
}

/** Pure image-only review; historical recipes come only from the bundled owner. */
export function reviewSharedImageTransition(state: SharedProjectState, appId: string,
  recipeFor: SharedSavedRecipeFor, images: Record<string, string>): SharedImageTransitionReview {
  if (state.checkpoint.phase !== "completed" || state.manifestHash !== hash(state.manifest)) {
    throw new Error("Image transition needs one exact completed saved owner");
  }
  const previous = restoreSavedSharedSelection(state, appId, recipeFor);
  const recipe = recipeFor(appId).recipe;
  if (!same(withoutRecipeImages(previous.recipe), withoutRecipeImages(recipe))) {
    throw new Error("Image transition cannot change recipe fields beyond imageTag and imageSource");
  }
  const pins = pinnedMultiServiceImages(recipe,
    Object.entries(images).map(([id, image]) => `${id}=${image}`));
  const selection: SharedAppSelection = { ...structuredClone(previous), recipe: structuredClone(recipe), images: pins };
  const candidate: SharedProjectCandidate = {
    manifest: structuredClone(state.manifest), units: structuredClone(state.units),
    selectionFingerprints: structuredClone(state.selectionFingerprints),
    settings: structuredClone(state.settings), projectDirectory: state.project.directory,
  };
  candidate.manifest.project.ownership = "verified-existing";
  candidate.manifest.observed.project = { id: state.project.id,
    directory: state.project.directory, owner: state.project.owner };
  const changes: SharedImageTransitionReview["changes"] = [];
  for (const service of recipe.services) {
    let serviceId = `${appId}-${service.id}`;
    if (service.id === appId) serviceId = appId;
    const matches = candidate.manifest.services.filter((item: Entry) => item.id === serviceId);
    if (matches.length !== 1 || !state.units[appId]?.includes(serviceId)) {
      throw new Error("Image transition cannot replace the saved service inventory");
    }
    const saved = matches[0];
    if (saved.image !== pins[service.id]) {
      changes.push({ serviceId, from: saved.image, to: pins[service.id]! });
      saved.image = pins[service.id];
    }
  }
  if (changes.length === 0) throw new Error("Image transition has no image change");
  candidate.selectionFingerprints[appId] = hash(selection);
  const toManifestHash = hash(candidate.manifest);
  const serviceIds = [...state.units[appId]!].sort();
  const approval = `IMAGE-TRANSITION:${appId}:${hash({ version: 1, project: state.project,
    revision: state.revision, recordHash: state.recordHash, appId, serviceIds, changes,
    fromManifestHash: state.manifestHash, toManifestHash,
    fromSelectionFingerprint: state.selectionFingerprints[appId],
    toSelectionFingerprint: candidate.selectionFingerprints[appId] })}`;
  return { candidate, appId, serviceIds, changes, fromManifestHash: state.manifestHash, toManifestHash, approval };
}

/** Resume only an exact reviewed record, before any Docker attempt, with fresh authority. */
export function reviewSharedReviewedImageTransition(state: SharedProjectState, origin: SharedProjectState,
  appId: string, recipeFor: SharedSavedRecipeFor): SharedImageTransitionReview {
  if (state.checkpoint.operation !== "image-transition" || state.checkpoint.phase !== "reviewed"
    || !same(state.checkpoint.appIds, [appId]) || origin.checkpoint.phase !== "completed"
    || state.previousHash !== origin.recordHash || state.revision !== origin.revision + 1) {
    throw new Error("Image recovery needs an exact pre-Docker reviewed revision");
  }
  const images: Record<string, string> = {};
  for (const service of recipeFor(appId).recipe.services) {
    let id = `${appId}-${service.id}`;
    if (service.id === appId) id = appId;
    images[service.id] = state.manifest.services.find((item: Entry) => item.id === id)?.image;
  }
  const review = reviewSharedImageTransition(origin, appId, recipeFor, images);
  const candidate = { manifest: state.manifest, units: state.units,
    selectionFingerprints: state.selectionFingerprints, settings: state.settings,
    projectDirectory: state.project.directory };
  if (!same(candidate, review.candidate) || state.manifestHash !== review.toManifestHash
    || !same(state.project, origin.project)) throw new Error("Reviewed image transition differs from exact source owner");
  return { ...review, approval: `IMAGE-TRANSITION:${appId}:${hash({ operation: "resume-reviewed",
    originalApproval: review.approval, pendingRevision: state.revision, pendingRecordHash: state.recordHash })}` };
}
