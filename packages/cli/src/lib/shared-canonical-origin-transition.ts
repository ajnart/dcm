import { dirname } from "node:path";
import { bundledCanonicalOrigin, canonicalOriginService, type SharedCanonicalOriginEvidence } from "./shared-canonical-origin-settings.ts";
import { exactHttpsOrigin } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/canonical-origin.ts";
import { sharedProjectCandidate, type SharedAppSelection, type SharedProjectCandidate } from "./shared-compose-project.ts";
import { restoreSharedPrivateHttpsSelection, sharedHttpsHash as hash, type SharedPrivateHttpsBinding } from "./shared-private-https-state.ts";
import type { applySharedPrivateHttpsTransport } from "./shared-private-https-apply.ts";
import type { SharedProjectState } from "./shared-project-state.ts";

type Entry = Record<string, any>;
export type SharedCanonicalTransportProof = Awaited<ReturnType<typeof applySharedPrivateHttpsTransport>>;
export type SharedCanonicalOriginReview = {
  candidate: SharedProjectCandidate;
  appId: string;
  serviceIds: string[];
  origin: string;
  bindingHash: string;
  fromManifestHash: string;
  toManifestHash: string;
  changes: Array<{ serviceId: string; name: string; from: string | null; to: string }>;
  approval: string;
  canonicalOrigin: SharedCanonicalOriginEvidence;
};

// Bundled source definitions are the authority, not CLI data or arbitrary callbacks.
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function fail(message: string): never { throw new Error(`Canonical origin transition: ${message}`); }
function comparable(service: Entry): Entry {
  const copy = structuredClone(service);
  delete copy.ownership;
  for (const mount of copy.mounts ?? []) delete mount.ownership;
  return copy;
}

/** Reconstruct non-secret coordinates, then prove the installed exact recipe fingerprint. */
function installedSelection(state: SharedProjectState, appId: string, recipe: Entry): SharedAppSelection {
  if (recipe?.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || recipe.appId !== appId || !Array.isArray(recipe.services)) fail("needs the bundled app recipe");
  const images: Record<string, string> = {};
  const paths: Record<string, string> = {};
  for (const service of recipe.services) {
    let id = `${appId}-${service.id}`;
    if (service.id === appId) id = appId;
    const matches = state.manifest.services.filter((item: Entry) => item.id === id);
    if (matches.length !== 1 || !state.units[appId]?.includes(id)
      || (service.additionalPorts?.length ?? 0) > 0) fail("unsupported or changed saved service inventory");
    const saved = matches[0];
    images[service.id] = saved.image;
    for (const mount of service.mounts ?? []) {
      if (mount.hostPath !== true) continue;
      const selected = saved.mounts.filter((item: Entry) => item.target === mount.target);
      if (selected.length !== 1 || Object.hasOwn(paths, mount.name)) fail("changed saved bind paths");
      paths[mount.name] = selected[0].source;
    }
  }
  const front = state.manifest.services.find((item: Entry) => item.id === appId);
  if (front?.ports?.length !== 1) fail("needs one saved application frontend port");
  const selection: SharedAppSelection = { appId, recipe, images, port: front.ports[0].published };
  if (Object.keys(paths).length > 0) selection.hostPaths = paths;
  if (hash(selection) !== state.selectionFingerprints[appId]) fail("bundled app recipe differs from the installed selection; migrate separately");
  return selection;
}

/**
 * Pure review of a separate app settings operation after exact owned TLS proof.
 * The command owner must re-review under its mutation lock, persist reviewed and
 * attempted checkpoints before Docker, and recreate only serviceIds. Attempted
 * or uncertain work cannot be replayed. No account/client/API acceptance granted.
 */
export function reviewSharedCanonicalOriginTransition(state: SharedProjectState, appId: string,
  recipe: Entry, caddyRecipe: Entry, binding: SharedPrivateHttpsBinding,
  transport: SharedCanonicalTransportProof): SharedCanonicalOriginReview {
  const definition = bundledCanonicalOrigin(appId);
  const { recordHash, ...record } = state;
  if (!definition || state.checkpoint.phase !== "completed" || recordHash !== hash(record)
    || state.manifestHash !== hash(state.manifest)) fail("needs a completed exact saved owner and bundled app settings");
  restoreSharedPrivateHttpsSelection(state, caddyRecipe, binding);
  const routes = binding.routes.filter((route) => route.appId === appId);
  if (routes.length !== 1) fail("app has no unique bound HTTPS route");
  const origin = exactHttpsOrigin(`https://${routes[0]!.hostname}:${binding.port}`);
  const proofs = transport?.proofs?.filter((proof) => proof.appId === appId);
  if (transport?.projectId !== state.project.id || transport.ownerRecordHash !== recordHash
    || transport.bindingHash !== binding.bindingHash || transport.transportVerified !== true
    || !/^[0-9a-f]{64}$/.test(transport.caSha256 ?? "")
    || proofs?.length !== 1 || proofs[0]!.verified !== true || proofs[0]!.url !== origin
    || proofs[0]!.hostname !== routes[0]!.hostname || proofs[0]!.method !== "curl-cacert-resolve"
    || !Number.isInteger(proofs[0]!.httpStatus) || proofs[0]!.httpStatus! < 100
    || proofs[0]!.httpStatus! > 599 || Number.isNaN(Date.parse(proofs[0]!.verifiedAt))) {
    fail("needs fresh transport evidence for this exact owner and bound route");
  }
  const selection = installedSelection(state, appId, recipe);
  const compiled = sharedProjectCandidate({ projectRoot: dirname(dirname(state.project.root)),
    projectId: state.project.id, dockerContext: state.project.dockerContext, ...state.settings,
    apps: [selection], observed: state.manifest.observed });
  if (!same(compiled.units[appId], state.units[appId])) fail("compiled unit differs from saved unit");
  for (const serviceId of state.units[appId]!) {
    const saved = state.manifest.services.find((item: Entry) => item.id === serviceId);
    const expected = compiled.manifest.services.find((item: Entry) => item.id === serviceId);
    if (!saved || !expected || !same(comparable(saved), comparable(expected))) {
      fail("saved runtime differs from exact bundled recipe; preserve it and inspect separately");
    }
  }
  const derived = definition.derive(origin);
  if (derived.length !== definition.environmentNames.length
    || !same(derived.map((entry) => entry.name).sort(), [...definition.environmentNames].sort())) {
    fail("source-owned canonical settings declaration is inconsistent");
  }
  let serviceId = `${appId}-${definition.serviceId}`;
  if (definition.serviceId === appId) serviceId = appId;
  const recipeService = recipe.services.find((item: Entry) => item.id === definition.serviceId);
  if (!recipeService || !state.units[appId]?.includes(serviceId)) fail("settings service is outside saved app unit");
  const candidate: SharedProjectCandidate = { manifest: structuredClone(state.manifest),
    units: structuredClone(state.units), selectionFingerprints: structuredClone(state.selectionFingerprints),
    settings: structuredClone(state.settings), projectDirectory: state.project.directory };
  candidate.manifest.project.ownership = "verified-existing";
  candidate.manifest.observed.project = { id: state.project.id, directory: state.project.directory, owner: state.project.owner };
  const index = candidate.manifest.services.findIndex((item: Entry) => item.id === serviceId);
  const target = candidate.manifest.services[index];
  const updated = canonicalOriginService(target, appId, origin);
  const changes: SharedCanonicalOriginReview["changes"] = [];
  for (const entry of derived) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(entry.name) || entry.value !== origin
      || [...(recipeService.hostEnvironment ?? []), ...(recipeService.secretEnvironment ?? []),
        ...(recipeService.fileEnvironment ?? [])].some((item: Entry) => item.name === entry.name)
      || (recipeService.derivedEnvironment ?? []).some((item: Entry) => item.name === entry.name
        && item.source !== "local-origin")) fail("canonical settings conflict with non-origin or secret bindings");
    const matches = target.environment.filter((item: Entry) => item.name === entry.name);
    if (matches.length > 1) fail("canonical environment identity is ambiguous");
    let from: string | null = null;
    if (matches.length === 1) {
      from = matches[0].value;
    }
    if (from !== entry.value) changes.push({ serviceId, name: entry.name, from, to: entry.value });
  }
  candidate.manifest.services[index] = updated;
  if (changes.length === 0) fail("canonical settings already match; no recreation authorized");
  const serviceIds = [...state.units[appId]!].sort();
  const toManifestHash = hash(candidate.manifest);
  return { candidate, appId, serviceIds, origin, bindingHash: binding.bindingHash,
    canonicalOrigin: { origin, bindingHash: binding.bindingHash, ownerRecordHash: recordHash,
      transportHash: hash(transport) },
    fromManifestHash: state.manifestHash, toManifestHash, changes,
    approval: `CANONICAL-ORIGIN:${appId}:${hash({ version: 1, operation: "canonical-origin",
      project: state.project, revision: state.revision, recordHash, fromManifestHash: state.manifestHash,
      toManifestHash, appId, serviceIds, origin, bindingHash: binding.bindingHash,
      declaration: { ...definition, derive: undefined }, changes,
      transport: { ownerRecordHash: transport.ownerRecordHash, bindingHash: transport.bindingHash,
        caSha256: transport.caSha256, origin, method: proofs[0]!.method } })}` };
}

/** Fresh approval only for a saved reviewed revision before any Docker attempt. */
export function reviewSharedReviewedCanonicalOriginTransition(state: SharedProjectState,
  origin: SharedProjectState, appId: string, recipe: Entry, caddyRecipe: Entry,
  binding: SharedPrivateHttpsBinding, transport: SharedCanonicalTransportProof): SharedCanonicalOriginReview {
  const { recordHash, ...record } = state;
  if (recordHash !== hash(record)
    || (state.checkpoint.operation as string) !== "canonical-origin" || state.checkpoint.phase !== "reviewed"
    || !same(state.checkpoint.appIds, [appId]) || state.previousHash !== origin.recordHash
    || state.revision !== origin.revision + 1 || state.manifestHash !== hash(state.manifest)
    || !same(state.project, origin.project)) fail("recovery requires exact reviewed pre-Docker revision");
  const review = reviewSharedCanonicalOriginTransition(origin, appId, recipe, caddyRecipe, binding, transport);
  const saved = { manifest: state.manifest, units: state.units, selectionFingerprints: state.selectionFingerprints,
    settings: state.settings, projectDirectory: state.project.directory };
  if (!same(review.candidate, saved)) fail("reviewed candidate differs from original exact owner and settings");
  return { ...review, approval: `CANONICAL-ORIGIN:${appId}:${hash({ operation: "resume-reviewed",
    originalApproval: review.approval, pendingRevision: state.revision, pendingRecordHash: state.recordHash })}` };
}
