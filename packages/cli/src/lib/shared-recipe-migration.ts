import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { sharedProjectCandidate, type SharedAppSelection,
  type SharedProjectCandidate } from "./shared-compose-project.ts";
import type { SharedProjectState } from "./shared-project-state.ts";

type Entry = Record<string, any>;

export type SharedRecipeMigrationReview = {
  candidate: SharedProjectCandidate;
  appId: string;
  serviceIds: string[];
  fromSelectionFingerprint: string;
  toSelectionFingerprint: string;
  fromManifestHash: string;
  toManifestHash: string;
  additions: { serviceId: string; name: string; value: string }[];
  approval: string;
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparable(service: Entry): Entry {
  const copy = structuredClone(service);
  delete copy.ownership;
  for (const mount of copy.mounts) delete mount.ownership;
  return copy;
}

/** A pending reviewed record is not an attempted operation and needs new authority. */
export function reviewSharedReviewedRecipeMigration(state: SharedProjectState,
  origin: SharedProjectState, appId: string, recipe: Entry): SharedRecipeMigrationReview {
  if (state.checkpoint.operation !== "recipe-migration" || state.checkpoint.phase !== "reviewed"
    || !same(state.checkpoint.appIds, [appId]) || origin.checkpoint.phase !== "completed"
    || state.previousHash !== origin.recordHash || state.revision !== origin.revision + 1
    || state.manifestHash !== hash(state.manifest)) {
    throw new Error("Migration recovery requires an exact pre-Docker reviewed revision");
  }
  const review = reviewSharedCatalogRecipeMigration(origin, appId, recipe);
  const savedCandidate: SharedProjectCandidate = { manifest: state.manifest, units: state.units,
    selectionFingerprints: state.selectionFingerprints, settings: state.settings,
    projectDirectory: state.project.directory };
  if (!same(review.candidate, savedCandidate) || review.toManifestHash !== state.manifestHash
    || !same(state.project, origin.project)) {
    throw new Error("Reviewed migration differs from its exact original owner and current catalog; inspect before recovery");
  }
  return { ...review, approval: `RECIPE-MIGRATION:${appId}:${hash({ version: 1,
    operation: "resume-reviewed", originalApproval: review.approval,
    pendingRevision: state.revision, pendingRecordHash: state.recordHash,
    pendingManifestHash: state.manifestHash })}` };
}

/** Rebuild only non-secret selection coordinates from the exact saved unit. */
export function reviewSharedCatalogRecipeMigration(state: SharedProjectState,
  appId: string, recipe: Entry): SharedRecipeMigrationReview {
  if (!recipe || recipe.appId !== appId || !Array.isArray(recipe.services)
    || !Object.hasOwn(state.units ?? {}, appId)) {
    throw new Error("Catalog migration requires an exact saved app and catalog recipe");
  }
  const images: Record<string, string> = {};
  const paths: Record<string, string> = {};
  let pathCount = 0;
  for (const service of recipe.services) {
    let id = `${appId}-${service.id}`;
    if (service.id === appId) id = appId;
    const saved = state.manifest.services.find((item: Entry) => item.id === id);
    if (!saved || !state.units[appId]!.includes(id) || !Array.isArray(service.mounts)) {
      throw new Error("Catalog migration cannot change the saved service inventory");
    }
    images[service.id] = saved.image;
    for (const mount of service.mounts) {
      if (mount.hostPath !== true) continue;
      const matches = saved.mounts.filter((item: Entry) => item.target === mount.target);
      if (matches.length !== 1 || typeof matches[0].source !== "string"
        || Object.hasOwn(paths, mount.name)) {
        throw new Error("Catalog migration cannot replace a selected bind path");
      }
      paths[mount.name] = matches[0].source;
      pathCount += 1;
    }
    if ((service.additionalPorts?.length ?? 0) > 0) {
      throw new Error("Additional-port recipe migration requires the exact saved selection coordinates");
    }
  }
  const front = state.manifest.services.find((item: Entry) => item.id === appId);
  if (!front || !Array.isArray(front.ports) || front.ports.length !== 1) {
    throw new Error("Catalog migration requires one saved primary frontend port");
  }
  let hostPaths: Record<string, string> | undefined;
  if (pathCount > 0) hostPaths = paths;
  return reviewSharedRecipeMigration(state,
    { appId, recipe, images, port: front.ports[0].published, hostPaths });
}

/**
 * Pure, exact-owner migration for additive static recipe environment only.
 * Reconstructs the previous selection and proves its saved fingerprint, rather
 * than assuming that a similar current catalog recipe is the installed recipe.
 * No files (including credentials), Docker, network or private-file preparation.
 * Caller supplies the bundled catalog selection with saved images/ports/paths.
 */
export function reviewSharedRecipeMigration(state: SharedProjectState,
  currentSelection: SharedAppSelection): SharedRecipeMigrationReview {
  const appId = currentSelection?.appId;
  const recipe = currentSelection?.recipe;
  if (state?.checkpoint?.phase !== "completed" || state.manifestHash !== hash(state.manifest)
    || !Object.hasOwn(state.units ?? {}, appId)
    || recipe?.appId !== appId || recipe?.schemaVersion !== 2
    || recipe.kind !== "multi-service-compose" || !Array.isArray(recipe.services)
    || recipe.services.length === 0) {
    throw new Error("Recipe migration needs one exact completed saved app and current catalog selection");
  }
  const previousSelection = structuredClone(currentSelection);
  const additions: SharedRecipeMigrationReview["additions"] = [];
  for (const service of previousSelection.recipe.services) {
    let serviceId = `${appId}-${service.id}`;
    if (service.id === appId) serviceId = appId;
    const saved = state.manifest.services.filter((item: Entry) => item.id === serviceId);
    if (!state.units[appId]!.includes(serviceId) || saved.length !== 1
      || !Array.isArray(saved[0].environment) || !Array.isArray(service.environment)) {
      throw new Error("Recipe migration cannot change the saved service inventory");
    }
    const names = new Set(saved[0].environment.map((item: Entry) => item.name));
    const seen = new Set<string>();
    service.environment = service.environment.filter((item: Entry) => {
      if (!item || !same(Object.keys(item).sort(), ["name", "value"])
        || typeof item.name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(item.name)
        || typeof item.value !== "string" || item.value.length > 256
        || /[\r\n\0$]/.test(item.value) || seen.has(item.name)) {
        throw new Error("Recipe migration requires unique bounded static environment entries");
      }
      seen.add(item.name);
      if (names.has(item.name)) return true;
      if (/PASS(?:WORD|WD)?|SECRET|TOKEN|CREDENTIAL|COOKIE|(?:^|_)(?:AUTH|API_?KEY|KEY|USERNAME|USER_NAME|IDENTITY)(?:_|$)/i.test(item.name)) {
        throw new Error("Recipe migration cannot add authentication, identity or credential environment");
      }
      if ([...(service.hostEnvironment ?? []), ...(service.derivedEnvironment ?? []),
        ...(service.secretEnvironment ?? []), ...(service.fileEnvironment ?? [])]
        .some((binding: Entry) => binding.name === item.name)) {
        throw new Error("Recipe migration cannot add a secret or derived environment binding");
      }
      additions.push({ serviceId, name: item.name, value: item.value });
      return false;
    });
  }
  const fromSelectionFingerprint = hash(previousSelection);
  const toSelectionFingerprint = hash(currentSelection);
  if (additions.length === 0 || fromSelectionFingerprint !== state.selectionFingerprints[appId]
    || fromSelectionFingerprint === toSelectionFingerprint) {
    throw new Error("Catalog drift is not exactly additive static environment; review incompatible recipe migration separately");
  }
  const compile = (selection: SharedAppSelection) => sharedProjectCandidate({
    projectRoot: dirname(dirname(state.project.root)), projectId: state.project.id,
    dockerContext: state.project.dockerContext, ...state.settings, apps: [selection],
    observed: state.manifest.observed,
  });
  const before = compile(previousSelection);
  const after = compile(currentSelection);
  if (!same(before.units[appId], state.units[appId])
    || !same(after.units[appId], state.units[appId])) {
    throw new Error("Recipe migration cannot replace a saved app unit");
  }
  const candidate: SharedProjectCandidate = {
    manifest: structuredClone(state.manifest), units: structuredClone(state.units),
    selectionFingerprints: structuredClone(state.selectionFingerprints),
    settings: structuredClone(state.settings), projectDirectory: state.project.directory,
  };
  // Rendering another immutable revision is an existing-owner operation, even
  // when the original create manifest still records its initial "new" claim.
  candidate.manifest.project.ownership = "verified-existing";
  candidate.manifest.observed.project = { id: state.project.id,
    directory: state.project.directory, owner: state.project.owner };
  for (const serviceId of state.units[appId]!) {
    const saved = candidate.manifest.services.find((service: Entry) => service.id === serviceId);
    const prior = before.manifest.services.find((service: Entry) => service.id === serviceId);
    const next = after.manifest.services.find((service: Entry) => service.id === serviceId);
    if (!saved || !prior || !next || !same(comparable(saved), comparable(prior))) {
      throw new Error("Saved runtime differs from the exact previous recipe; preserve it and inspect before migration");
    }
    const expected = structuredClone(prior);
    expected.environment = next.environment;
    if (!same(comparable(expected), comparable(next))) {
      throw new Error("Recipe migration cannot change images, storage, privileges, ports or credential references");
    }
    saved.environment = structuredClone(next.environment);
  }
  candidate.selectionFingerprints[appId] = toSelectionFingerprint;
  // Origins are tracked per app unit. Bind recreation of the complete exact unit
  // so every container retains one coherent Compose revision (never other apps).
  const serviceIds = [...state.units[appId]!].sort();
  const toManifestHash = hash(candidate.manifest);
  const binding = { version: 1, operation: "recipe-migration", project: state.project,
    revision: state.revision, recordHash: state.recordHash, appId, serviceIds,
    fromSelectionFingerprint, toSelectionFingerprint,
    fromManifestHash: state.manifestHash, toManifestHash, additions };
  return { candidate, appId, serviceIds, fromSelectionFingerprint, toSelectionFingerprint,
    fromManifestHash: state.manifestHash, toManifestHash, additions,
    approval: `RECIPE-MIGRATION:${appId}:${hash(binding)}` };
}
