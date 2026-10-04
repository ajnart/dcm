import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import packageMetadata from "../../package.json";
import { withAppMutationLock } from "./batch-mutation-lock.ts";
import { loadCompatibilityReceipts, prepareCompatibilityEvidenceRoot, publishCompatibilityObservation,
  type CompatibilityReceiptContract, type CompatibilityRegistryTip, type VerifiedRunObservation } from "./compatibility-receipts.ts";
import { homarrStackMapping, homarrStackWidgetChoices } from "./homarr-stack-mapping.ts";
import { resolveSharedAppMetadata } from "./resolved-app.ts";
import { readSharedAcceptanceSource } from "./shared-acceptance-contract.ts";
import { loadSharedProjectState, type SharedProjectState } from "./shared-project-state.ts";
import { sharedUnitRecipeCheck } from "./shared-unit-setup.ts";
import { setupContractSha256 } from "./setup-contract.ts";
import { homarrSeedNativeEligibility, type HomarrStackSeedService } from "./homarr-stack-seed.ts";
import { readOwnedHomarrTransportIdentity, type OwnedHomarrTransport } from "./shared-homarr-transport.ts";
import { restoreSavedSharedSelection } from "./shared-saved-recipe.ts";

type Entry = Record<string, any>;
type Dependencies = { recipeFor(id: string): { recipe: Entry; recipeSha256: string; boundedApply: boolean };
  appFor(id: string): Entry };
type Selection = { id: string; boardName: string; prerequisites: Record<string, string>;
  integrationUrl?: string; transport?: OwnedHomarrTransport };
type Ledger = { schemaVersion: 1; ownerRecordHash: string; generation: string; phase: "pending" | "witnessed";
  selection: Selection; contract: CompatibilityReceiptContract; anchor: CompatibilityRegistryTip };
type Selected = { seed: HomarrStackSeedService; mapping: unknown };
type Witness = { state: SharedProjectState; selected: Array<{ selection: Selection; generation: string;
  contract: CompatibilityReceiptContract; previous: Ledger | null }> };
export const sharedHomarrCompatibilitySources = ["shared-homarr-compatibility.ts", "../shared-homarr.ts", "../homarr-attach.ts",
  "homarr-stack-mapping.ts", "homarr-stack-seed.ts", "homarr-live-verification.ts", "homarr-read-contract.ts",
  "homarr-non-browser-recap.ts", "resolved-app.ts", "shared-unit-setup.ts", "shared-project-state.ts",
  "compatibility-receipts.ts", "catalog-compatibility.ts", "shared-homarr-transport.ts",
  "shared-homarr-trust.ts", "shared-https-target.ts", "shared-private-https-state.ts"] as const;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const liveWitnesses = new WeakSet<Witness>();
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(): never { throw new Error("Homarr compatibility: owner, source, publication generation or private anchor changed; inspect before retrying"); }
function exact(value: unknown, keys: string[]): value is Entry {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...keys].sort().join();
}
function sources(): string {
  const own = new URL(import.meta.url);
  return hash(sharedHomarrCompatibilitySources.map((name) => {
    let url = new URL(name, own);
    if (!own.pathname.endsWith(".ts")) url = new URL(name.replace("../", "./"), own);
    return readSharedAcceptanceSource(url);
  }));
}
function selection(value: unknown, current = true): asserts value is Selection {
  let keys = ["id", "boardName", "prerequisites"];
  if (value && typeof value === "object" && Object.hasOwn(value, "transport")) keys = [...keys, "integrationUrl", "transport"];
  if (!exact(value, keys) || typeof value.id !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || value.id.length > 47
    || typeof value.boardName !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(value.boardName)
    || !value.prerequisites || typeof value.prerequisites !== "object" || Array.isArray(value.prerequisites)) fail();
  const allowed = new Set(homarrStackWidgetChoices(homarrStackMapping(value.id)).map(([name]) => name));
  if (Object.keys(value.prerequisites).length > 16 || Object.entries(value.prerequisites).some(([key, item]) =>
    (current && !allowed.has(key)) || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)
    || /password|secret|cookie|credential|token/i.test(key) || typeof item !== "string"
    || !item.trim() || item.length > 512 || /[\u0000-\u001f\u007f]/.test(item))) fail();
  if (value.transport !== undefined && (!exact(value.transport, ["integrationUrl", "ownerRecordHash", "bindingHash",
    "caSha256", "recipeSha256", "transportProofSha256"]) || value.integrationUrl !== value.transport.integrationUrl
    || typeof value.integrationUrl !== "string" || !/^https:\/\/[A-Za-z0-9.-]+:[0-9]+$/.test(value.integrationUrl)
    || Object.entries(value.transport).some(([key, item]) => key !== "integrationUrl" && (typeof item !== "string" || !HASH.test(item))))) fail();
}
async function contractFor(state: SharedProjectState, chosen: Selection, generation: string,
  phase: Ledger["phase"], dependencies: Dependencies): Promise<CompatibilityReceiptContract> {
  selection(chosen);
  if (!UUID.test(generation) || !["pending", "witnessed"].includes(phase)
    || state.checkpoint.phase !== "completed") fail();
  const app = dependencies.appFor(chosen.id);
  const mapping = homarrStackMapping(chosen.id);
  if (app?.id !== chosen.id || !mapping || mapping.nativeEligibility || chosen.id === "homarr"
    || app.homarr?.support === "not-applicable") fail();
  const homarrMode = app.homarr?.integration ? "native" : "tile-only";
  if (Boolean(mapping.integrationKind) !== (homarrMode === "native")) fail();
  if (mapping.nativeTransportRequirement) {
    const recipe = restoreSavedSharedSelection(state, chosen.id, dependencies.recipeFor).recipe;
    const identity = await readOwnedHomarrTransportIdentity(state, chosen.id, recipe, dependencies.recipeFor("caddy").recipe);
    if (!chosen.transport || identity.recipeSha256 !== mapping.nativeRecipeSha256
      || hash(identity) !== hash(chosen.transport) || chosen.integrationUrl !== identity.integrationUrl) fail();
  } else if (chosen.transport || chosen.integrationUrl) fail();
  const images: Record<string, string> = {};
  const ownerImages: Record<string, Record<string, string>> = {};
  const metadata: Record<string, unknown> = {};
  const recipes: Record<string, string> = {};
  for (const id of [chosen.id, "homarr"]) {
    if (sharedUnitRecipeCheck(state, id, dependencies.recipeFor) !== "matches-saved-selection") fail();
    const info = dependencies.recipeFor(id);
    if (!HASH.test(info.recipeSha256) || !state.units[id]?.length) fail();
    recipes[id] = info.recipeSha256;
    ownerImages[id] = {};
    for (const serviceId of [...state.units[id]!].sort()) {
      const service = state.manifest.services.find((item: Entry) => item.id === serviceId);
      if (!service || !/@sha256:[a-f0-9]{64}$/.test(service.image)) fail();
      ownerImages[id]![serviceId] = service.image;
      if (id === chosen.id) images[serviceId] = service.image;
    }
    const frontend = state.manifest.services.filter((item: Entry) => item.id === id);
    if (frontend.length !== 1 || !frontend[0]!.networks.includes("front")) fail();
    const resolved = resolveSharedAppMetadata(id, dependencies.appFor(id), info.recipe, frontend[0]!);
    if (!resolved.browserUrl || !resolved.serverUrl) fail();
    metadata[id] = resolved;
  }
  const subjectSha256 = hash({ execution: await setupContractSha256(chosen.id, Object.keys(state.units).sort()),
    sources: sources(), mapping, ownerRecordHash: state.recordHash,
    recipes, ownerImages, metadata, selection: chosen, generation, phase });
  return { appId: chosen.id, dimension: "homarr", homarrMode,
    owner: { projectFingerprint: hash(state.project), revision: state.revision, manifestHash: state.manifestHash },
    recipeSha256: recipes[chosen.id]!, images, subjectSha256,
    verifier: { id: "shared-homarr-acceptance", sourceSha256: subjectSha256, release: packageMetadata.version } };
}
async function owned(path: string, directory = false): Promise<void> {
  const info = await lstat(path);
  let mode = 0o600;
  if (directory) mode = 0o700;
  if (info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o7777) !== mode
    || await realpath(path) !== path || (directory && !info.isDirectory())
    || (!directory && (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 32 * 1024))) fail();
}
async function readLedger(state: SharedProjectState, id: string, dependencies: Dependencies): Promise<Ledger | null> {
  await owned(state.project.directory, true);
  const path = join(state.project.directory, `homarr-run-${id}.json`);
  try { await owned(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let value: Ledger;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.()
      || (before.mode & 0o7777) !== 0o600 || before.size < 1 || before.size > 32 * 1024) fail();
    value = JSON.parse(await handle.readFile("utf8"));
    const after = await handle.stat(); const named = await lstat(path);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || named.ino !== before.ino || named.dev !== before.dev || named.isSymbolicLink()) fail();
  } finally { await handle.close(); }
  if (!exact(value, ["schemaVersion", "ownerRecordHash", "generation", "phase", "selection", "contract", "anchor"])
    || value.schemaVersion !== 1 || !HASH.test(value.ownerRecordHash)
    || !UUID.test(value.generation) || !["pending", "witnessed"].includes(value.phase)
    || !exact(value.anchor, ["revision", "registryHash"]) || !Number.isSafeInteger(value.anchor.revision)
    || value.anchor.revision < 1 || value.anchor.revision > 4096 || !HASH.test(value.anchor.registryHash!)) fail();
  selection(value.selection, false);
  if (value.selection.id !== id || value.contract?.appId !== id || value.contract?.dimension !== "homarr"
    || value.contract?.owner?.projectFingerprint !== hash(state.project)) fail();
  // Historical source/owner revisions may be stale, but their registry anchor remains mandatory.
  await loadCompatibilityReceipts(join(state.project.root, "..", "..", `selfhost-verification-${state.project.id}`),
    [value.contract], { checkedAt: new Date().toISOString(), requiredAnchors: [value.anchor] });
  return value;
}
async function writeLedger(state: SharedProjectState, value: Ledger, previous: Ledger | null,
  dependencies: Dependencies): Promise<void> {
  if (hash(await readLedger(state, value.selection.id, dependencies)) !== hash(previous)) fail();
  const path = join(state.project.directory, `homarr-run-${value.selection.id}.json`);
  const temporary = join(state.project.directory, `.homarr-run-${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  try {
    if (hash(await readLedger(state, value.selection.id, dependencies)) !== hash(previous)) fail();
    const current = await loadSharedProjectState(state.project.directory, state.project.id);
    if (!current || current.recordHash !== state.recordHash) fail();
    await rename(temporary, path);
  } catch (error) { await unlink(temporary); throw error; }
}
/** Serialize witnessed reads and approved writes, including uncertain publication outcomes. */
export async function withSharedHomarrCompatibilityLock<T>(root: string, projectId: string, task: () => Promise<T>): Promise<T> {
  if (!isAbsolute(root) || resolve(root) !== root || root === "/"
    || root.split("/").some((part) => /^\.sessions$|^\.env|^(?:secrets|credentials)$/.test(part))
    || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)) fail();
  const directory = join(root, ".selfhost", "shared", projectId);
  const state = await loadSharedProjectState(directory, projectId);
  if (!state || state.project.directory !== directory || state.project.root !== join(root, ".selfhost", "shared")
    || state.checkpoint.phase !== "completed" || !state.units.homarr) fail();
  return withAppMutationLock(directory, "homarr-compatibility", task);
}
/** Loader reads only bounded nonsecret owner metadata; never handoffs or connection exports. */
export async function readSharedHomarrCompatibilityIdentity(root: string, projectId: string, id: string,
  dependencies: Dependencies) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 47) fail();
  const directory = join(root, ".selfhost", "shared", projectId);
  const state = await loadSharedProjectState(directory, projectId);
  if (!state || state.project.directory !== directory || state.checkpoint.phase !== "completed") fail();
  const value = await readLedger(state, id, dependencies);
  if (!value) return null;
  let contract: CompatibilityReceiptContract | null = null;
  if (value.phase === "witnessed" && value.ownerRecordHash === state.recordHash) {
    try {
      const current = await contractFor(state, value.selection, value.generation, value.phase, dependencies);
      if (hash(current) === hash(value.contract)) contract = current;
    } catch { /* Stale recipe/source/applicability cannot earn credit or prevent a new reviewed publication. */ }
  }
  return { contract, anchor: { ...value.anchor } };
}
/** Before any managed publication write, invalidate older observations, retaining their rollback anchors. */
export async function invalidateSharedHomarrCompatibility(state: SharedProjectState, dependencies: Dependencies) {
  for (const id of Object.keys(state.units).sort()) {
    const previous = await readLedger(state, id, dependencies);
    if (!previous) continue;
    const generation = randomUUID();
    await writeLedger(state, { ...previous, ownerRecordHash: state.recordHash, generation, phase: "pending" }, previous, dependencies);
  }
}
type Check = VerifiedRunObservation["checks"][number];
function observed(value: unknown): Check["result"] {
  if (value === "pass" || value === "fail") return value;
  return "not-run";
}
/** Capture the exact current owner/source/selection before structural or functional reads. */
export async function prepareSharedHomarrCompatibility(state: SharedProjectState, boardName: string,
  selected: Selected[], dependencies: Dependencies): Promise<Witness> {
  const captured: Witness["selected"] = [];
  for (const item of selected) {
    const { seed } = item;
    const mapping = homarrStackMapping(seed.id);
    const app = dependencies.appFor(seed.id);
    if (!mapping || !homarrSeedNativeEligibility(seed).eligible || seed.id === "homarr" || app.homarr?.support === "not-applicable") continue;
    if (hash(mapping) !== hash(item.mapping) || captured.some((entry) => entry.selection.id === seed.id)) fail();
    const frontend = state.manifest.services.find((service: Entry) => service.id === seed.id);
    if (!frontend) fail();
    const metadata = resolveSharedAppMetadata(seed.id, app, dependencies.recipeFor(seed.id).recipe, frontend);
    if (seed.appName !== metadata.name || seed.browserUrl !== metadata.browserUrl || seed.serverUrl !== metadata.serverUrl) fail();
    let previous = await readLedger(state, seed.id, dependencies);
    if (previous) {
      const pending: Ledger = { ...previous, ownerRecordHash: state.recordHash,
        generation: randomUUID(), phase: "pending" };
      await writeLedger(state, pending, previous, dependencies);
      previous = pending;
    }
    const chosen: Selection = { id: seed.id, boardName, prerequisites: { ...seed.prerequisites } };
    if (mapping.nativeTransportRequirement) {
      chosen.integrationUrl = seed.integrationUrl;
      chosen.transport = seed.ownedTransport;
    }
    const generation = previous?.generation ?? randomUUID();
    const contract = await contractFor(state, chosen, generation, "witnessed", dependencies);
    captured.push({ selection: chosen, generation, contract, previous });
  }
  const witness = { state, selected: captured };
  liveWitnesses.add(witness);
  return witness;
}
/** Only called with this invocation's structural and functional reads by explicit live status. */
export async function publishSharedHomarrCompatibility(witness: Witness,
  readback: Entry, functional: Entry[], dependencies: Dependencies, checkedAt: string): Promise<void> {
  if (!liveWitnesses.has(witness)) fail();
  liveWitnesses.delete(witness);
  const { state } = witness;
  const evidenceRoot = join(state.project.root, "..", "..", `selfhost-verification-${state.project.id}`);
  // Resolve from the canonical shared-owner root, not caller-provided artifact paths.
  const root = join(state.project.directory, "..", "..", "..", `selfhost-verification-${state.project.id}`);
  if (root !== evidenceRoot) fail();
  for (const { selection: chosen, generation, contract, previous } of witness.selected) {
    if (hash(await contractFor(state, chosen, generation, "witnessed", dependencies)) !== hash(contract)
      || hash(await readLedger(state, chosen.id, dependencies)) !== hash(previous)) fail();
    const mapping = homarrStackMapping(chosen.id)!;
    const rows = functional.filter((item) => item?.serviceId === chosen.id && item.mutation === false);
    if (rows.length !== 1 || readback.mutation !== false || readback.apiKeyAuthorizationVerified !== true) continue;
    const structures = readback.services.filter((item: Entry) => item?.id === chosen.id);
    if (structures.length !== 1) continue;
    const structure = structures[0]; const live = rows[0]!;
    const tileStructure = ["metadataVerified", "structureVerified", "notebookContentVerified", "notebookLayoutVerified"];
    let tile = observed(live.checks?.tile?.status);
    if (structure.status === "resource-readback-failed" || tileStructure.some((key) => structure[key] === false)) tile = "fail";
    else if (!tileStructure.every((key) => structure[key] === true)) tile = "not-run";
    const checks: Check[] = [{ id: "tile-readback", result: tile },
      { id: "homarr-origin-reachability", result: observed(live.checks?.reachability?.status) }];
    if (contract.homarrMode === "native") {
      let connection = observed(live.checks?.integrationTest?.status);
      if (structure.integrationStructureVerified !== true) connection = "not-run";
      checks.push({ id: "integration-test", result: connection });
      const expected = mapping.widgets.map((item) => item.kind).sort();
      const actual = Array.isArray(live.widgets) ? live.widgets.map((item: Entry) => item?.kind).sort() : [];
      let widgets: Check["result"] = "not-run";
      if (expected.length > 0 && hash(expected) === hash(actual) && structure.widgetStructureVerified === true) {
        if (live.widgets.some((item: Entry) => item.structure?.status === "fail" || item.data?.status === "fail")) widgets = "fail";
        else if (live.widgets.every((item: Entry) => item.structure?.status === "pass" && item.data?.status === "pass")) widgets = "pass";
      }
      checks.push({ id: "widget-readback", result: widgets });
    }
    await prepareCompatibilityEvidenceRoot(root);
    const requiredAnchors = [];
    if (previous) requiredAnchors.push(previous.anchor);
    const tip = await loadCompatibilityReceipts(root, [contract], { checkedAt, requiredAnchors });
    const current = await loadSharedProjectState(state.project.directory, state.project.id);
    if (!current || current.recordHash !== state.recordHash
      || hash(await contractFor(state, chosen, generation, "witnessed", dependencies)) !== hash(contract)) fail();
    const { homarrMode: _mode, ...identity } = contract;
    const published = await publishCompatibilityObservation(root, { ...identity, runId: randomUUID(), checkedAt,
      checks, cleanup: "not-required" }, contract, { expectedRevision: tip.revision, expectedRegistryHash: tip.registryHash });
    await writeLedger(state, { schemaVersion: 1, ownerRecordHash: state.recordHash, generation,
      phase: "witnessed", selection: chosen, contract,
      anchor: { revision: published.revision, registryHash: published.registryHash } }, previous, dependencies);
  }
}
