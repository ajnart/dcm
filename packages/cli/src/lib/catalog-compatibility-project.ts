import { lstat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { CompatibilityAppInput } from "./catalog-compatibility.ts";
import { assertPackagedCatalogProject } from "./catalog-project.ts";
import { loadCompatibilityReceipts, type CompatibilityReceiptContract,
  type CompatibilityRegistryTip } from "./compatibility-receipts.ts";
import { createSharedAcceptanceOwner, SharedAcceptanceOwnerError } from "./shared-acceptance-owner.ts";
import { readSharedAcceptanceRegistryAnchor, sharedAcceptanceAvailable } from "./shared-acceptance.ts";
import { readSharedComposeCompatibilityIdentity } from "./shared-compose-compatibility.ts";
import { readSharedSetupCompatibilityIdentity } from "./shared-setup-compatibility.ts";
import { readSharedHomarrCompatibilityIdentity } from "./shared-homarr-compatibility.ts";
import { loadSharedProjectState } from "./shared-project-state.ts";
import { restoreSharedDerivedRecipeSelection, sharedDerivedRecipeAdapter } from "./shared-derived-recipe.ts";
import { loadSharedDerivedRecipeBindingSync } from "./shared-derived-recipe-state.ts";

export type CompatibilityProjectSelection = { projectRoot: string; projectId: string };
type RecordValue = Record<string, any>;

/** Production owner inspection only. No Docker, handoff, credentials or receipt import. */
export async function loadCatalogProjectCompatibility(selection: CompatibilityProjectSelection,
  inputs: CompatibilityAppInput[], apps: RecordValue[],
  recipes: Map<string, { recipe: RecordValue; sha256: string }>, checkedAt: string) {
  const { projectRoot, projectId } = selection;
  if (!isAbsolute(projectRoot) || resolve(projectRoot) !== projectRoot || projectRoot === "/"
    || projectRoot.split("/").some((part) => /^\.sessions$|^\.env|^(?:secrets|credentials)$/.test(part))
    || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)) {
    throw new Error("Compatibility needs one explicit canonical shared project root and project ID.");
  }
  const directory = join(projectRoot, ".selfhost", "shared", projectId);
  await assertPackagedCatalogProject(projectRoot);
  const state = await loadSharedProjectState(directory, projectId);
  if (!state || state.checkpoint.phase !== "completed" || state.project.directory !== directory) {
    throw new Error("Compatibility needs a completed selected shared project owner.");
  }
  const ownerRecordHash = state.recordHash;
  const contracts: CompatibilityReceiptContract[] = [];
  const revalidate: Array<() => Promise<void>> = [];
  const anchorsByRevision = new Map<number, string | null>();
  const blockers: Array<{ appId: string; code: string; next: string }> = [];
  const dependencies = {
    recipeFor(id: string) {
      if (sharedDerivedRecipeAdapter(id)) {
        const binding = loadSharedDerivedRecipeBindingSync(directory, id, state!);
        const selection = restoreSharedDerivedRecipeSelection(state!, binding);
        return { recipe: selection.recipe, recipeSha256: binding.derived.recipeSha256, boundedApply: true };
      }
      const selected = recipes.get(id);
      if (!selected) throw new Error("Selected owner recipe is no longer available; review migration.");
      return { recipe: selected.recipe, recipeSha256: selected.sha256, boundedApply: true };
    },
    appFor(id: string) { return apps.find((app) => app.id === id)!; },
  };
  function register(contract: CompatibilityReceiptContract | null, anchor: CompatibilityRegistryTip) {
    if (anchorsByRevision.has(anchor.revision) && anchorsByRevision.get(anchor.revision) !== anchor.registryHash) {
      throw new Error("Selected app acceptance anchors disagree at the same registry revision.");
    }
    anchorsByRevision.set(anchor.revision, anchor.registryHash);
    if (contract) contracts.push(contract);
  }
  async function revalidateOwner() {
    for (const validate of revalidate) await validate();
    const current = await loadSharedProjectState(directory, projectId);
    if (!current || current.recordHash !== ownerRecordHash) {
      throw new Error("Selected shared owner changed during compatibility inspection; inspect again.");
    }
  }
  // Source presence alone is not a reviewed result-to-check mapping.
  for (const appId of Object.keys(state.units).sort()) {
    const input = inputs.find((app) => app.appId === appId);
    if (!input) throw new Error("Selected owner has an app outside the complete bundled catalog.");
    if (sharedDerivedRecipeAdapter(appId)) {
      // Only the exact private owner binding can materialize this identity.
      // Loading replays current executable hashes and retained create/add revisions.
      const selected = dependencies.recipeFor(appId);
      const bindingHash = loadSharedDerivedRecipeBindingSync(directory, appId, state).bindingHash;
      input.recipeSha256 = selected.recipeSha256;
      input.imageTags = Object.fromEntries(selected.recipe.services.map((service: RecordValue) =>
        [service.id, service.imageTag]));
      revalidate.push(async () => {
        if (loadSharedDerivedRecipeBindingSync(directory, appId, state).bindingHash !== bindingHash
          || JSON.stringify(dependencies.recipeFor(appId)) !== JSON.stringify(selected)) {
          throw new Error("Selected derived recipe changed during compatibility inspection.");
        }
      });
    }
    // Compose proof belongs to the shared fresh-create owner, not an app's
    // optional workload/restart adapter. Missing journals provide no credit.
    const compose = await readSharedComposeCompatibilityIdentity(projectRoot, projectId, appId, dependencies);
    if (compose?.anchor) {
      register(compose.contract, compose.anchor);
      input.imageTags = { ...compose.contract.images };
      input.dimensions!.compose = { state: "declared", subjectSha256: compose.contract.subjectSha256,
        reason: "Shared fresh-create verifier; only matching trusted current observations receive credit." };
      revalidate.push(async () => {
        const current = await readSharedComposeCompatibilityIdentity(projectRoot, projectId, appId, dependencies);
        if (JSON.stringify(current) !== JSON.stringify(compose)) {
          throw new Error("Selected owner Compose chronology changed during compatibility inspection.");
        }
      });
    }
    const setup = await readSharedSetupCompatibilityIdentity(projectRoot, projectId, appId, dependencies);
    if (setup?.anchor) {
      register(setup.contract, setup.anchor);
      input.imageTags = { ...setup.contract.images };
      input.dimensions!.setup = { state: "declared", subjectSha256: setup.contract.subjectSha256,
        reason: "Witnessed first-run and separate credential-verifying resume; only matching current observations receive credit." };
      revalidate.push(async () => {
        const current = await readSharedSetupCompatibilityIdentity(projectRoot, projectId, appId, dependencies);
        if (JSON.stringify(current) !== JSON.stringify(setup)) {
          throw new Error("Selected owner setup chronology changed during compatibility inspection.");
        }
      });
    }
    const homarr = await readSharedHomarrCompatibilityIdentity(projectRoot, projectId, appId, dependencies);
    if (homarr?.anchor) {
      register(homarr.contract, homarr.anchor);
      if (homarr.contract) {
        input.imageTags = { ...homarr.contract.images };
        input.dimensions!.homarr = { state: "declared", subjectSha256: homarr.contract.subjectSha256,
          reason: "Witnessed Homarr-origin functional readback; only matching current owner-bound observations receive credit." };
      }
      revalidate.push(async () => {
        const current = await readSharedHomarrCompatibilityIdentity(projectRoot, projectId, appId, dependencies);
        if (JSON.stringify(current) !== JSON.stringify(homarr)) {
          throw new Error("Selected owner Homarr publication generation changed during compatibility inspection.");
        }
      });
    }
    if (!await sharedAcceptanceAvailable(appId)) continue;
    const owner = createSharedAcceptanceOwner(projectRoot, projectId, appId, {
      ...dependencies,
      approvalFor() { throw new Error("Compatibility inspection has no mutation authority."); },
    });
    let identity;
    try { identity = await owner.identity(); }
    catch (error) {
      if (!(error instanceof SharedAcceptanceOwnerError) || error.code !== "shared-recipe-migration-required") throw error;
      // A drifted owner has no current acceptance identity. Never bypass an
      // existing ledger's validation or silently ignore its anchored history.
      try { await lstat(join(directory, `acceptance-run-${appId}.json`)); throw error; }
      catch (ledgerError) {
        if ((ledgerError as NodeJS.ErrnoException).code !== "ENOENT") throw ledgerError;
      }
      const next = "Saved recipe differs from the current catalog; review migration before live acceptance.";
      blockers.push({ appId, code: error.code, next });
      input.dimensions!.liveRestart = { ...input.dimensions!.liveRestart!, state: "unsupported", reason: next };
      continue;
    }
    const anchor = readSharedAcceptanceRegistryAnchor(identity);
    if (!anchor) continue;
    register(identity.contract, anchor);
    revalidate.push(async () => {
      const current = await owner.identity();
      if (JSON.stringify(current.contract) !== JSON.stringify(identity.contract)
        || JSON.stringify(readSharedAcceptanceRegistryAnchor(current)) !== JSON.stringify(anchor)) {
        throw new Error("Selected owner acceptance chronology changed during compatibility inspection.");
      }
    });
    // Saved Compose IDs can be remapped; score exactly the owner inventory,
    // not original recipe service IDs or receipt-selected image identities.
    input.imageTags = { ...identity.contract.images };
    input.dimensions!.liveRestart = { state: "declared", subjectSha256: identity.contract.subjectSha256,
      reason: "App-owned live/restart verifier; only matching trusted current observations receive credit." };
  }
  const evidenceRoot = join(projectRoot, `selfhost-verification-${projectId}`);
  try { await lstat(evidenceRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || anchorsByRevision.size) throw error;
    await revalidateOwner();
    return { receipts: [], project: { projectId, registryRevision: 0, receiptCount: 0, blockers } };
  }
  const loaded = await loadCompatibilityReceipts(evidenceRoot, contracts,
    { checkedAt, requiredAnchors: [...anchorsByRevision].map(([revision, registryHash]) => ({ revision, registryHash })) });
  await revalidateOwner();
  return { receipts: loaded.receipts,
    project: { projectId, registryRevision: loaded.revision, receiptCount: loaded.receipts.length, blockers } };
}
