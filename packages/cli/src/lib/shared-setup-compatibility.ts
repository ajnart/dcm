import { assertPrivatePath, protectPrivatePath, ownedByCurrentUser, privateMode } from "./platform-private.ts";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import packageMetadata from "../../package.json";
import { setupCompatibilityAvailable } from "../control-panel/setup-engine.ts";
import { loadCompatibilityReceipts, prepareCompatibilityEvidenceRoot, publishCompatibilityObservation,
  type CompatibilityReceiptContract, type CompatibilityRegistryTip } from "./compatibility-receipts.ts";
import { setupContractSha256 } from "./setup-contract.ts";
import { readSetupObservationJournal, type SetupObservationEvent } from "./setup-observation-journal.ts";
import { loadSharedProjectState, type SharedProjectState } from "./shared-project-state.ts";
import { sharedUnitRecipeCheck } from "./shared-unit-setup.ts";

type Entry = Record<string, any>;
export type SharedSetupCompatibilityDependencies = {
  recipeFor(appId: string): { recipe: Entry; recipeSha256: string; boundedApply: boolean };
  appFor?(appId: string): Entry;
};
export type SharedSetupCompatibilityIdentity = {
  contract: CompatibilityReceiptContract;
  anchor: CompatibilityRegistryTip;
};
type Ledger = SharedSetupCompatibilityIdentity & {
  schemaVersion: 1;
  runId: string;
  completedRecordHash: string;
  firstAttemptId: string;
  resumeAttemptId: string;
  journalProofHash: string;
};
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function fail(): never { throw new Error("Setup compatibility: unsafe, incomplete or changed observed owner chronology"); }
function exact(value: unknown, keys: string[]): value is Entry {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...keys].sort().join();
}
async function owned(path: string, directory = false): Promise<void> {
  const info = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, (info.isDirectory() ? 0o700 : 0o600));
  let mode = 0o600;
  if (directory) mode = 0o700;
  if (info.isSymbolicLink() || !ownedByCurrentUser(info) || !privateMode(info, mode)
    || await realpath(path) !== path || (directory && !info.isDirectory())
    || (!directory && (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 32 * 1024))) fail();
}
async function contractFor(state: SharedProjectState, appId: string,
  dependencies: SharedSetupCompatibilityDependencies): Promise<CompatibilityReceiptContract> {
  if (state.checkpoint.phase !== "completed" || !await setupCompatibilityAvailable(appId)
    || sharedUnitRecipeCheck(state, appId, dependencies.recipeFor) !== "matches-saved-selection") fail();
  const info = dependencies.recipeFor(appId);
  const app = dependencies.appFor?.(appId);
  if (!HASH.test(info.recipeSha256) || app?.id !== appId || !app.homarr) fail();
  const services = state.units[appId];
  if (!services?.length || services.length > 32) fail();
  const images: Record<string, string> = {};
  for (const id of [...services].sort()) {
    const service = state.manifest.services.find((item: Entry) => item.id === id);
    if (!service || !/@sha256:[a-f0-9]{64}$/.test(service.image)) fail();
    images[id] = service.image;
  }
  let homarrMode: CompatibilityReceiptContract["homarrMode"] = "tile-only";
  if (app.homarr.integration) homarrMode = "native";
  if (app.homarr.support === "not-applicable") homarrMode = "not-applicable";
  if (appId === "homarr") homarrMode = "control-plane";
  const subjectSha256 = await setupContractSha256(appId, Object.keys(state.units));
  return { appId, dimension: "setup", homarrMode,
    owner: { projectFingerprint: hash(state.project), revision: state.revision, manifestHash: state.manifestHash },
    recipeSha256: info.recipeSha256, images, subjectSha256,
    verifier: { id: "shared-setup-acceptance", sourceSha256: subjectSha256, release: packageMetadata.version } };
}
function sameIdentity(event: SetupObservationEvent, state: SharedProjectState,
  contract: CompatibilityReceiptContract, setupRecipeSha256: string): boolean {
  const bound = event.identity;
  const localImages: Record<string, string> = {};
  for (const [id, image] of Object.entries(contract.images)) {
    let localId = id;
    if (id !== contract.appId) localId = id.slice(contract.appId.length + 1);
    localImages[localId] = image;
  }
  const ordered = (value: Record<string, string>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return bound.appId === contract.appId && bound.projectId === state.project.id
    && bound.ownerRevision === state.revision && bound.manifestHash === state.manifestHash
    && bound.recipeSha256 === setupRecipeSha256 && bound.setupSubjectSha256 === contract.subjectSha256
    && hash(ordered(bound.images)) === hash(ordered(localImages));
}
function observedPair(state: SharedProjectState, contract: CompatibilityReceiptContract,
  setupRecipeSha256: string, resumeAttemptId: string): [SetupObservationEvent, SetupObservationEvent] | null {
  const events = readSetupObservationJournal(state.project.directory);
  const matches = (event: SetupObservationEvent) => event.phase === "first-run"
    && event.outcome === "adapter-ready" && !!event.compatibility
    && sameIdentity(event, state, contract, setupRecipeSha256);
  const resumed = events.find((event) => event.attemptId === resumeAttemptId && matches(event)
    && event.compatibility!.result.origin === "resume");
  if (!resumed) return null;
  const fresh = events.find((event) => event.ordinal < resumed.ordinal && event.attemptId !== resumed.attemptId
    && matches(event) && event.compatibility!.result.origin === "fresh"
    && event.compatibility!.result.credentialReadback === resumed.compatibility!.result.credentialReadback
    && event.compatibility!.checkedAt <= resumed.compatibility!.checkedAt);
  if (!fresh) return null;
  // Failed/deferred retries cannot erase a successful earlier readback, but
  // none of them can substitute for either successful, separate invocation.
  return [fresh, resumed];
}
async function readLedger(state: SharedProjectState, appId: string): Promise<Ledger | null> {
  await owned(state.project.directory, true);
  const path = join(state.project.directory, `setup-run-${appId}.json`);
  try { await owned(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || !ownedByCurrentUser(before)
      || !privateMode(before, 0o600) || before.size < 1 || before.size > 32 * 1024) fail();
    const value: unknown = JSON.parse(await handle.readFile("utf8"));
    const after = await handle.stat();
    const named = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, (named.isDirectory() ? 0o700 : 0o600));
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || named.ino !== before.ino || named.dev !== before.dev || named.isSymbolicLink()) fail();
    if (!exact(value, ["schemaVersion", "runId", "completedRecordHash", "firstAttemptId", "resumeAttemptId",
      "journalProofHash", "contract", "anchor"]) || value.schemaVersion !== 1
      || !UUID.test(value.runId) || !UUID.test(value.firstAttemptId) || !UUID.test(value.resumeAttemptId)
      || value.runId !== value.resumeAttemptId || !HASH.test(value.completedRecordHash)
      || !HASH.test(value.journalProofHash) || !exact(value.anchor, ["revision", "registryHash"])
      || !Number.isSafeInteger(value.anchor.revision) || value.anchor.revision < 1 || value.anchor.revision > 4096
      || !HASH.test(value.anchor.registryHash)) fail();
    return value as Ledger;
  } finally { await handle.close(); }
}
async function validateLedger(state: SharedProjectState, appId: string,
  dependencies: SharedSetupCompatibilityDependencies, ledger: Ledger,
  allowLater = false): Promise<SharedSetupCompatibilityIdentity> {
  const contract = await contractFor(state, appId, dependencies);
  const setupRecipeSha256 = hash(dependencies.recipeFor(appId).recipe);
  const pair = observedPair(state, contract, setupRecipeSha256, ledger.resumeAttemptId);
  if (ledger.completedRecordHash !== state.recordHash || hash(contract) !== hash(ledger.contract)
    || !pair || pair[0].attemptId !== ledger.firstAttemptId || hash(pair) !== ledger.journalProofHash) fail();
  if (!allowLater && readSetupObservationJournal(state.project.directory).some((event) =>
    event.ordinal > pair[1].ordinal && sameIdentity(event, state, contract, setupRecipeSha256))) fail();
  return { contract, anchor: { ...ledger.anchor } };
}
/** Only indexed, owner-pinned chronology; no Docker, credentials or supplied evidence JSON. */
export async function readSharedSetupCompatibilityIdentity(root: string, projectId: string, appId: string,
  dependencies: SharedSetupCompatibilityDependencies): Promise<SharedSetupCompatibilityIdentity | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || appId.length > 47) fail();
  const directory = join(root, ".selfhost", "shared", projectId);
  const state = await loadSharedProjectState(directory, projectId);
  if (!state || state.project.directory !== directory || state.checkpoint.phase !== "completed") fail();
  const ledger = await readLedger(state, appId);
  if (!ledger) return null;
  return validateLedger(state, appId, dependencies, ledger);
}
/** Called only by the current shared owner's terminal setup observer. */
export async function publishSharedSetupCompatibility(approved: SharedProjectState, event: SetupObservationEvent,
  dependencies: SharedSetupCompatibilityDependencies): Promise<void> {
  if (!event.compatibility || event.compatibility.result.origin !== "resume" || !dependencies.appFor) return;
  const appId = event.identity.appId;
  const state = await loadSharedProjectState(approved.project.directory, approved.project.id);
  if (!state || state.recordHash !== approved.recordHash) fail();
  const previous = await readLedger(state, appId);
  if (previous) {
    await validateLedger(state, appId, dependencies, previous, true);
    if (previous.resumeAttemptId === event.attemptId) return;
  }
  const contract = await contractFor(state, appId, dependencies);
  const pair = observedPair(state, contract, hash(dependencies.recipeFor(appId).recipe), event.attemptId);
  if (!pair || hash(pair[1]) !== hash(event)) return;
  const checkedAt = pair[1].compatibility!.checkedAt;
  const root = join(dirname(dirname(state.project.root)), `selfhost-verification-${state.project.id}`);
  await prepareCompatibilityEvidenceRoot(root);
  const requiredAnchors: CompatibilityRegistryTip[] = [];
  if (previous) requiredAnchors.push(previous.anchor);
  const tip = await loadCompatibilityReceipts(root, [contract], { checkedAt, requiredAnchors });
  const { homarrMode: _mode, ...identity } = contract;
  const published = await publishCompatibilityObservation(root, { ...identity, runId: event.attemptId, checkedAt,
    checks: [{ id: "first-run", result: "pass" }, { id: "credential-or-no-account-readback", result: "pass" },
      { id: "resume-readback", result: "pass" }], cleanup: "not-required" }, contract,
    { expectedRevision: tip.revision, expectedRegistryHash: tip.registryHash });
  const current = await loadSharedProjectState(state.project.directory, state.project.id);
  if (!current || current.recordHash !== state.recordHash) fail();
  const ledger: Ledger = { schemaVersion: 1, runId: event.attemptId, completedRecordHash: state.recordHash,
    firstAttemptId: pair[0].attemptId, resumeAttemptId: event.attemptId, journalProofHash: hash(pair), contract,
    anchor: { revision: published.revision, registryHash: published.registryHash } };
  await owned(state.project.directory, true);
  const target = join(state.project.directory, `setup-run-${appId}.json`);
  const output = join(state.project.directory, `setup-run-${appId}.${event.attemptId}.tmp`);
  const handle = await open(output,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { protectPrivatePath(output, 0o600); await handle.writeFile(JSON.stringify(ledger)); await handle.sync(); } finally { await handle.close(); }
    if (previous) {
      const latest = await readLedger(state, appId);
      if (!latest || hash(latest) !== hash(previous)) fail();
      await owned(state.project.directory, true);
      await rename(output, target);
    } else {
      await owned(state.project.directory, true);
      await link(output, target);
    }
  } finally {
    try { await unlink(output); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (process.platform !== "win32") {
    const directoryHandle = await open(state.project.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
}
