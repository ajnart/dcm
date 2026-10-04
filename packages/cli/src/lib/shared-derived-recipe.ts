import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { loadSharedDerivedRecipeAdapters, sharedDerivedRecipeSourceHash as sourceHash } from "./shared-derived-recipe-loader.ts";
import type { SharedDerivedRecipe, SharedDerivedRecipeInput, SharedDerivedRecipeAdapter, SharedDerivedRecipeSource } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/derived-recipe.ts";
import { sharedProjectCandidate, type SharedAppSelection, type SharedProjectInput } from "./shared-compose-project.ts";
import type { SharedProjectState } from "./shared-project-state.ts";
import { mutableConfigSourceHash } from "./mutable-config.ts";

export type { SharedDerivedRecipeInput };
// Only bundled app-owned adapters are executable. Callers supply choices, never adapters.
const { adapters, loadedSourceHashes } = await loadSharedDerivedRecipeAdapters();
export function sharedDerivedRecipeAdapter(appId: string): Pick<SharedDerivedRecipeAdapter, "appId" | "inputDefinitions"> | null {
  const adapter = adapters.get(appId);
  if (!adapter) return null;
  return { appId: adapter.appId, inputDefinitions: structuredClone(adapter.inputDefinitions) };
}
export function sharedDerivedRecipeAdapters(): Array<Pick<SharedDerivedRecipeAdapter, "appId" | "inputDefinitions">> {
  return [...adapters.keys()].sort().map((appId) => sharedDerivedRecipeAdapter(appId)!);
}
type ExistingDerivedRecipeBinding = {
  schemaVersion: 1;
  kind: "shared-derived-recipe-binding";
  source: SharedProjectState;
  derived: SharedDerivedRecipe;
  selection: SharedAppSelection;
  selectionFingerprint: string;
  bindingHash: string;
};
export type SharedDerivedRecipeCreateBinding = Omit<ExistingDerivedRecipeBinding, "kind" | "source"> & {
  kind: "shared-derived-create-binding";
  source: SharedProjectInput;
};
export type SharedDerivedRecipeBinding = ExistingDerivedRecipeBinding | SharedDerivedRecipeCreateBinding;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(): never { throw new Error("Shared derived recipe differs from its exact reviewed input, source, recipe or owner"); }
function exact(value: any, keys: string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function checkedOwner(state: SharedProjectState, requireCompleted = true): void {
  if (!state || state.schemaVersion !== 1 || !state.checkpoint
    || (requireCompleted && state.checkpoint.phase !== "completed")
    || !Number.isSafeInteger(state.revision) || state.revision < 1
    || !Number.isSafeInteger(state.manifestRevision) || state.manifestRevision < 1) fail();
  const { recordHash, ...record } = state;
  if (recordHash !== hash(record) || state.manifestHash !== hash(state.manifest)
    || state.project.owner !== state.project.id || state.project.root !== dirname(state.project.directory)
    || !state.project.root.endsWith("/.selfhost/shared")) fail();
  for (const key of ["id", "owner", "root", "directory", "dockerContext"] as const) {
    if (state.project[key] !== state.manifest.project[key]) fail();
  }
}

/** The owner loads state first. This function performs no writes or exposure approval. */
export function deriveSharedRecipe(state: SharedProjectState, input: SharedDerivedRecipeInput): SharedDerivedRecipe {
  checkedOwner(state);
  return derive(state, input, Object.keys(state.units));
}

function derive(state: SharedDerivedRecipeSource, input: SharedDerivedRecipeInput,
  peers: string[]): SharedDerivedRecipe {
  const adapter = adapters.get(input?.appId);
  if (!adapter || !exact(input, ["appId", "inputs"]) || !exact(input.inputs, Object.keys(adapter.inputDefinitions))) fail();
  const adapterSourceSha256 = sourceHash(adapter);
  if (adapterSourceSha256 !== loadedSourceHashes.get(input.appId)) fail();
  for (const [key, definition] of Object.entries(adapter.inputDefinitions)) {
    const value = input.inputs[key];
    if (typeof value !== "string" || value.length === 0 || value.length > definition.maxLength
      || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) fail();
  }
  const { recipe, configuration, peerAppIds } = adapter.derive(state, input.inputs);
  let sourceSha256 = adapterSourceSha256;
  const mutableSourceSha256 = mutableConfigSourceHash(recipe);
  if (mutableSourceSha256 !== null) sourceSha256 = hash({ adapterSourceSha256, mutableSourceSha256 });
  if (recipe.appId !== input.appId || recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose") fail();
  if (!Array.isArray(peerAppIds) || new Set(peerAppIds).size !== peerAppIds.length
    || peerAppIds.some((appId) => !peers.includes(appId) || appId === input.appId)) fail();
  return { input: structuredClone(input), recipe, configuration, peerAppIds, sourceSha256, recipeSha256: hash(recipe) };
}

/** Called for the exact selected images/ports before approval; persist only after approval. */
export function bindSharedDerivedRecipe(state: SharedProjectState, input: SharedDerivedRecipeInput,
  selection: SharedAppSelection): ExistingDerivedRecipeBinding {
  const derived = deriveSharedRecipe(state, input);
  if (selection.appId !== input.appId || JSON.stringify(selection.recipe) !== JSON.stringify(derived.recipe)) fail();
  if (selection.derivationSha256 !== undefined && selection.derivationSha256 !== hash(derived)) fail();
  // Compile through the same real selection interface to reject invalid images, ports and shape.
  candidate(state, selection);
  const record = { schemaVersion: 1 as const, kind: "shared-derived-recipe-binding" as const,
    source: structuredClone(state), derived, selection: structuredClone(selection), selectionFingerprint: hash(selection) };
  return { ...record, bindingHash: hash(record) };
}

/** Normalize only observation time: fresh host observations still gate apply.
 * Selected resources/settings remain exact; no completed owner is invented. */
export function sharedDerivedCreateSource(input: SharedProjectInput): SharedProjectInput {
  const source = structuredClone(input);
  source.observed.checkedAt = "2026-10-03T00:00:00Z";
  return source;
}

export function deriveSharedCreateRecipe(source: SharedProjectInput,
  input: SharedDerivedRecipeInput): SharedDerivedRecipe {
  const normalized = sharedDerivedCreateSource(source);
  if (normalized.apps.some((app) => app.appId === input.appId)) fail();
  const derived = derive({ kind: "new-shared-project", input: normalized }, input,
    normalized.apps.map((app) => app.appId));
  // Exact pinned selection and fresh-project identity are validated together
  // by bindSharedCreateRecipe before approval; derivation is not authorization.
  return derived;
}

export function bindSharedCreateRecipe(source: SharedProjectInput, input: SharedDerivedRecipeInput,
  selection: SharedAppSelection): SharedDerivedRecipeCreateBinding {
  const normalized = sharedDerivedCreateSource(source);
  const derived = deriveSharedCreateRecipe(normalized, input);
  if (selection.appId !== input.appId || JSON.stringify(selection.recipe) !== JSON.stringify(derived.recipe)) fail();
  if (selection.derivationSha256 !== undefined && selection.derivationSha256 !== hash(derived)) fail();
  sharedProjectCandidate({ ...normalized, apps: [...normalized.apps, selection] });
  const record = { schemaVersion: 1 as const, kind: "shared-derived-create-binding" as const,
    source: normalized, derived, selection: structuredClone(selection), selectionFingerprint: hash(selection) };
  return { ...record, bindingHash: hash(record) };
}

function candidate(source: SharedProjectState, selection: SharedAppSelection) {
  return sharedProjectCandidate({ projectRoot: dirname(dirname(source.project.root)), projectId: source.project.id,
    dockerContext: source.project.dockerContext, ...source.settings, apps: [selection],
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
}

function replay(binding: SharedDerivedRecipeBinding): void {
  if (!exact(binding, ["schemaVersion", "kind", "source", "derived", "selection", "selectionFingerprint", "bindingHash"])
    || binding.schemaVersion !== 1
    || !["shared-derived-recipe-binding", "shared-derived-create-binding"].includes(binding.kind)) fail();
  const { bindingHash, ...record } = binding;
  if (bindingHash !== hash(record) || hash(binding.selection) !== binding.selectionFingerprint) fail();
  let expected: SharedDerivedRecipeBinding;
  if (binding.kind === "shared-derived-create-binding") {
    expected = bindSharedCreateRecipe(binding.source, binding.derived.input, binding.selection);
  } else expected = bindSharedDerivedRecipe(binding.source, binding.derived.input, binding.selection);
  if (JSON.stringify(expected) !== JSON.stringify(binding)) fail();
}

/** Immediately before add/apply: no owner or target drift since the review. */
export function assertSharedDerivedRecipeUnchanged(state: SharedProjectState, binding: SharedDerivedRecipeBinding): void {
  replay(binding); checkedOwner(state);
  if (binding.kind !== "shared-derived-recipe-binding") fail();
  if (JSON.stringify(state) !== JSON.stringify(binding.source)) fail();
}

function comparable(value: Record<string, any>): string {
  const copy = structuredClone(value);
  delete copy.ownership;
  for (const mount of copy.mounts ?? []) delete mount.ownership;
  return JSON.stringify(copy);
}

/** Replay original choices for validation, but return the immutable original selection. */
export function restoreSharedDerivedRecipeSelection(state: SharedProjectState,
  binding: SharedDerivedRecipeBinding): SharedAppSelection {
  replay(binding); checkedOwner(state, false);
  if (binding.kind === "shared-derived-create-binding") return restoreCreateSelection(state, binding);
  const appId = binding.selection.appId;
  if (state.revision <= binding.source.revision
    || JSON.stringify(state.project) !== JSON.stringify(binding.source.project)
    || JSON.stringify(state.settings) !== JSON.stringify(binding.source.settings)
    || state.selectionFingerprints[appId] !== binding.selectionFingerprint) fail();
  const expected = candidate(binding.source, binding.selection);
  if (JSON.stringify(state.units[appId]) !== JSON.stringify(expected.units[appId])) fail();
  for (const service of expected.manifest.services) {
    const actual = state.manifest.services.filter((entry: Record<string, any>) => entry.id === service.id);
    if (actual.length !== 1 || comparable(actual[0]) !== comparable(service)) fail();
  }
  // An app may bind a same-owner peer; preserve the entire selected peer identity.
  for (const target of binding.derived.peerAppIds) {
    const peerUnits = binding.source.units[target];
    if (!Array.isArray(peerUnits) || peerUnits.length === 0
      || state.selectionFingerprints[target] !== binding.source.selectionFingerprints[target]
      || JSON.stringify(state.units[target]) !== JSON.stringify(binding.source.units[target])) fail();
    const peerNetworks = new Set<string>();
    for (const id of peerUnits) {
      const before = binding.source.manifest.services.find((entry: Record<string, any>) => entry.id === id);
      const after = state.manifest.services.filter((entry: Record<string, any>) => entry.id === id);
      if (after.length !== 1 || !before || comparable(after[0]) !== comparable(before)) fail();
      for (const network of before.networks) peerNetworks.add(network);
    }
    for (const id of peerNetworks) {
      const before = binding.source.manifest.networks.find((entry: Record<string, any>) => entry.id === id);
      const after = state.manifest.networks.filter((entry: Record<string, any>) => entry.id === id);
      if (after.length !== 1 || !before || comparable(after[0]) !== comparable(before)) fail();
    }
  }
  for (const network of expected.manifest.networks) {
    const actual = state.manifest.networks.filter((entry: Record<string, any>) => entry.id === network.id);
    if (actual.length !== 1 || comparable(actual[0]) !== comparable(network)) fail();
  }
  return structuredClone(binding.selection);
}

function restoreCreateSelection(state: SharedProjectState,
  binding: SharedDerivedRecipeCreateBinding): SharedAppSelection {
  const expected = sharedProjectCandidate({ ...binding.source,
    apps: [...binding.source.apps, binding.selection] });
  const { ownership: _ownership, ...project } = expected.manifest.project;
  // The persisted owner normalizes field order independently of the manifest.
  // Keep the exact field set and values, without making insertion order identity.
  const projectKeys = ["id", "dockerContext", "owner", "root", "directory"];
  if (!exact(state.project, projectKeys) || !exact(project, projectKeys)
    || projectKeys.some((key) => state.project[key as keyof SharedProjectState["project"]] !== project[key])
    || JSON.stringify(state.settings) !== JSON.stringify(expected.settings)) fail();
  for (const appId of [binding.selection.appId, ...binding.derived.peerAppIds]) {
    if (state.selectionFingerprints[appId] !== expected.selectionFingerprints[appId]
      || JSON.stringify(state.units[appId]) !== JSON.stringify(expected.units[appId])) fail();
    for (const id of expected.units[appId]!) {
      const before = expected.manifest.services.find((service: Record<string, any>) => service.id === id);
      const after = state.manifest.services.filter((service: Record<string, any>) => service.id === id);
      if (!before || after.length !== 1 || comparable(before) !== comparable(after[0])) fail();
    }
  }
  for (const network of expected.manifest.networks) {
    if (network.id !== "front" && !network.id.startsWith(`${binding.selection.appId}-`)
      && !binding.derived.peerAppIds.some((app) => network.id.startsWith(`${app}-`))) continue;
    const after = state.manifest.networks.filter((item: Record<string, any>) => item.id === network.id);
    if (after.length !== 1 || comparable(network) !== comparable(after[0])) fail();
  }
  return structuredClone(binding.selection);
}

export function sharedDerivedBindingDirectory(binding: SharedDerivedRecipeBinding): string {
  if (binding.kind === "shared-derived-create-binding") {
    return sharedProjectCandidate({ ...binding.source,
      apps: [...binding.source.apps, binding.selection] }).projectDirectory;
  }
  return binding.source.project.directory;
}
