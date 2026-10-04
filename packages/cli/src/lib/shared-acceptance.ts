import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AcceptanceAdapter, AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import { createSetupTransportFacilities } from "../control-panel/setup-transport.ts";
import { setupAdapterSource, setupContractSha256 } from "./setup-contract.ts";
import { loadSharedAcceptanceContract, readSharedAcceptanceSource as source, sharedAcceptanceContract } from "./shared-acceptance-contract.ts";
import { loadCompatibilityReceipts, prepareCompatibilityEvidenceRoot, publishCompatibilityObservation, type CompatibilityReceiptContract, type CompatibilityRegistryTip } from "./compatibility-receipts.ts";

export type SharedAcceptanceRuntimeUnit = { serviceId: string; imageId: string; immutableImage: string; startedAt: string; state: "running" | "stopped" };
export type SharedAcceptanceIdentity = {
  directory: string; projectRoot: string; projectId: string; appId: string;
  ownerAppIds: string[];
  contract: CompatibilityReceiptContract;
  /** Exact saved unit IDs, including database/cache dependencies. */
  services: string[];
};
/** These are internal production owners, never CLI arguments or imported observations. */
export type SharedAcceptanceOwner = {
  identity(): Promise<SharedAcceptanceIdentity>;
  status(): Promise<unknown>;
  handoff(): Promise<unknown>;
  inspectRuntime(): Promise<SharedAcceptanceRuntimeUnit[]>;
  lifecycle(operation: "stop" | "start"): Promise<void>;
  lock<T>(task: () => Promise<T>): Promise<T>;
};
type Ledger = { schemaVersion: 1; runId: string; binding: string; phase: "begin-attempted" | "begun" | "stop-attempted" | "stopped" | "start-attempted" | "restarted" | "finished";
  baseline: AcceptanceRuntimeEvidence; stopped: AcceptanceRuntimeEvidence | null;
  running: AcceptanceRuntimeEvidence | null; checkedAt: string | null; registry: CompatibilityRegistryTip | null;
  inputs?: Readonly<Record<string, string>> };
const HASH = /^[a-f0-9]{64}$/;
const adapters = new Map<string, { adapter: AcceptanceAdapter; sha256: string }>();
function fail(): never { throw new Error("Shared acceptance owner, contract, runtime or saved chronology changed; inspect without replaying mutations"); }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function ledgerBinding(identity: SharedAcceptanceIdentity, inputs: Readonly<Record<string, string>>): string {
  if (Object.keys(inputs).length) return hash({ identity, inputs });
  return hash(identity);
}
function exact(value: unknown, keys: string[]): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...keys].sort().join();
}
function checkedEvidence(value: unknown, identity: SharedAcceptanceIdentity, state: "running" | "stopped", sequence: number): asserts value is AcceptanceRuntimeEvidence {
  if (!exact(value, ["source", "appId", "projectRoot", "ownerId", "recipeSha256", "manifestHash", "units", "epoch", "sequence", "evidenceId", "state"])
    || value.source !== "shared-selected-lifecycle" || value.appId !== identity.appId
    || value.projectRoot !== identity.projectRoot || value.ownerId !== identity.projectId
    || value.recipeSha256 !== identity.contract.recipeSha256 || value.manifestHash !== identity.contract.owner.manifestHash
    || value.state !== state || value.sequence !== sequence || !HASH.test(value.epoch)
    || typeof value.evidenceId !== "string" || !/^[0-9a-f-]{36}$/.test(value.evidenceId)
    || !Array.isArray(value.units) || value.units.length !== identity.services.length
    || value.units.map((unit: any) => unit?.serviceId).join() !== [...identity.services].sort().join()
    || value.units.some((unit: unknown) => !exact(unit, ["serviceId", "imageId"]) || !/^sha256:[a-f0-9]{64}$/.test(unit.imageId))) fail();
}
function checkedLedger(value: unknown, identity: SharedAcceptanceIdentity): asserts value is Ledger {
  const keys = ["schemaVersion", "runId", "binding", "phase", "baseline", "stopped", "running", "checkedAt", "registry"];
  if (value && typeof value === "object" && Object.hasOwn(value, "inputs")) keys.push("inputs");
  if (!exact(value, keys)
    || value.schemaVersion !== 1 || typeof value.runId !== "string" || !/^[0-9a-f-]{36}$/.test(value.runId)
    || !["begin-attempted", "begun", "stop-attempted", "stopped", "start-attempted", "restarted", "finished"].includes(value.phase)) fail();
  const contract = sharedAcceptanceContract(identity.appId);
  if (!contract) fail();
  const inputs = contract.inputs(value.inputs ?? {});
  if (value.binding !== ledgerBinding(identity, inputs) || (value.inputs && hash(value.inputs) !== hash(inputs))) fail();
  checkedEvidence(value.baseline, identity, "running", 1);
  if (value.stopped !== null) {
    checkedEvidence(value.stopped, identity, "stopped", 2);
    if (value.stopped.epoch !== value.baseline.epoch || hash(value.stopped.units) !== hash(value.baseline.units)) fail();
  }
  if (value.running !== null) {
    checkedEvidence(value.running, identity, "running", 3);
    if (!value.stopped || value.running.epoch === value.baseline.epoch || hash(value.running.units) !== hash(value.baseline.units)) fail();
  }
  if (["begin-attempted", "begun", "stop-attempted"].includes(value.phase) && (value.stopped !== null || value.running !== null)) fail();
  if (["stopped", "start-attempted"].includes(value.phase) && (!value.stopped || value.running !== null)) fail();
  if (["restarted", "finished"].includes(value.phase) && (!value.stopped || !value.running)) fail();
  if (value.registry !== null && (!exact(value.registry, ["revision", "registryHash"])
    || !Number.isSafeInteger(value.registry.revision) || value.registry.revision < 0 || value.registry.revision > 4096
    || (value.registry.revision === 0 && value.registry.registryHash !== null)
    || (value.registry.revision > 0 && !HASH.test(value.registry.registryHash)))) fail();
  if ((value.registry === null) !== (value.checkedAt === null)
    || (value.checkedAt !== null && (typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))))) fail();
}
function owned(path: string, directory: boolean): void {
  const stat = lstatSync(path);
  let mode = 0o600;
  if (directory) mode = 0o700;
  if (stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== mode
    || realpathSync(path) !== path || (directory && !stat.isDirectory())
    || (!directory && (!stat.isFile() || stat.nlink !== 1 || stat.size > 32 * 1024))) fail();
}
function read(identity: SharedAcceptanceIdentity): Ledger | null {
  owned(identity.directory, true);
  const path = join(identity.directory, `acceptance-run-${identity.appId}.json`);
  try { owned(path, false); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.()
      || (before.mode & 0o7777) !== 0o600 || before.size < 1 || before.size > 32 * 1024) fail();
    const raw = readFileSync(fd, "utf8"); const after = fstatSync(fd); const named = lstatSync(path);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || named.ino !== before.ino || named.dev !== before.dev || named.isSymbolicLink()) fail();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { fail(); }
    checkedLedger(value, identity);
    return value;
  } finally { closeSync(fd); }
}
/** Read only the checked owner chronology, never an operator-supplied proof/tip. */
export function readSharedAcceptanceRegistryAnchor(identity: SharedAcceptanceIdentity): CompatibilityRegistryTip | null {
  const ledger = read(identity);
  if (!ledger?.registry) return null;
  return { ...ledger.registry };
}
function save(identity: SharedAcceptanceIdentity, value: Ledger): void {
  owned(identity.directory, true);
  checkedLedger(value, identity);
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw) > 32 * 1024) fail();
  const temporary = join(identity.directory, `acceptance-run-${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
  try { owned(identity.directory, true); renameSync(temporary, join(identity.directory, `acceptance-run-${identity.appId}.json`)); }
  finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  const directory = openSync(identity.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

/** Load the app-owned packaged verifier, never a caller supplied module. */
export async function sharedAcceptanceAdapter(appId: string): Promise<{ adapter: AcceptanceAdapter; sha256: string } | null> {
  const setup = await setupAdapterSource(appId);
  if (!setup) return null;
  const url = new URL(setup.url.href.replace(/setup\.(ts|js)$/, "acceptance.$1"));
  let before: string;
  try { before = source(url); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const sha256 = createHash("sha256").update(before).digest("hex");
  const cached = adapters.get(url.href);
  if (cached) { if (cached.sha256 !== sha256) fail(); return cached; }
  const adapter = (await import(url.href)).default as AcceptanceAdapter;
  if (!adapter || adapter.appId !== appId || typeof adapter.begin !== "function" || typeof adapter.finish !== "function"
    || source(url) !== before) fail();
  const loaded = { adapter, sha256 }; adapters.set(url.href, loaded); return loaded;
}
export async function sharedAcceptanceSubjectSha256(appId: string, ownerApps: readonly string[]): Promise<string | null> {
  const setup = await setupAdapterSource(appId);
  if (!setup) return null;
  const url = new URL(setup.url.href.replace(/setup\.(ts|js)$/, "acceptance.$1"));
  let bytes: string;
  try { bytes = source(url); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const contract = await loadSharedAcceptanceContract(appId);
  if (!contract) return null;
  const mapper = createHash("sha256").update(source(new URL("./shared-acceptance-contract.ts", import.meta.url))).digest("hex");
  const engine = createHash("sha256").update(source(new URL("./shared-acceptance.ts", import.meta.url))).digest("hex");
  const own = new URL(import.meta.url);
  let lifecycleUrl = new URL("./workflows/selfhost/references/catalog/types/acceptance-lifecycle.ts", own);
  if (own.pathname.endsWith(".ts")) {
    lifecycleUrl = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance-lifecycle.ts", own);
  }
  const lifecycle = createHash("sha256").update(source(lifecycleUrl)).digest("hex");
  return hash({ schemaVersion: 1, setup: await setupContractSha256(appId, ownerApps), acceptance: sha256,
    contract: contract.sha256, mapper, engine, lifecycle });
}

/** Result-to-required-check mapping is reviewed independently of adapter presence. */
export async function sharedAcceptanceAvailable(appId: string): Promise<boolean> {
  if (!await loadSharedAcceptanceContract(appId)) return false;
  return await sharedAcceptanceAdapter(appId) !== null;
}

/** Explicit owner-bound begin/finish; no receipts, pass flags or runtime injection in public inputs. */
export async function sharedAcceptance(options: { action: "begin" | "finish"; approval?: string | null;
  approvedSteps?: readonly string[]; evidenceRoot: string; inputs?: Readonly<Record<string, string>> }, owner: SharedAcceptanceOwner) {
  const identity = await owner.identity();
  if (identity.contract.appId !== identity.appId || identity.contract.dimension !== "liveRestart"
    || !HASH.test(identity.contract.subjectSha256) || identity.services.length < 1 || identity.services.length > 32
    || new Set(identity.services).size !== identity.services.length
    || !Array.isArray(identity.ownerAppIds) || identity.ownerAppIds.length > 256 || !identity.ownerAppIds.includes(identity.appId)) fail();
  const loaded = await sharedAcceptanceAdapter(identity.appId);
  if (!loaded) return { status: "blocked", reason: "No packaged app-owned acceptance verifier", mutation: false };
  // Presence alone cannot establish a reviewed result-to-check contract.
  if (!await sharedAcceptanceAvailable(identity.appId)) return { status: "blocked", reason: "Acceptance result contract is not reviewed", mutation: false };
  const contract = sharedAcceptanceContract(identity.appId)!;
  const saved = read(identity);
  const inputs = contract.inputs(options.inputs ?? saved?.inputs ?? {});
  const declaredInputs = (loaded.adapter.inputDefinitions ?? []).map((definition) => definition.key).sort();
  if (Object.keys(inputs).sort().join() !== declaredInputs.join()
    || (saved?.inputs && hash(saved.inputs) !== hash(inputs))) fail();
  if (identity.contract.subjectSha256 !== await sharedAcceptanceSubjectSha256(identity.appId, identity.ownerAppIds)) fail();
  function approvalFor(saved: Ledger | null) {
    const binding: Record<string, unknown> = { identity, action: options.action, evidenceRoot: options.evidenceRoot, saved };
    if (Object.keys(inputs).length) binding.inputs = inputs;
    return `SHARED-ACCEPTANCE-${options.action.toUpperCase()}:${identity.projectId}:${hash(binding)}`;
  }
  const approval = approvalFor(read(identity));
  let effects = [contract.beginEffect];
  if (options.action === "finish") effects = ["Stop only the selected saved unit, retaining data", "Start that same saved unit", contract.finishEffect];
  if (!options.approval) return { status: "review", approval, mutation: false,
    scope: options.action, services: [...identity.services], owner: identity.contract.owner,
    recipeSha256: identity.contract.recipeSha256, subjectSha256: identity.contract.subjectSha256,
    images: { ...identity.contract.images },
    effects,
    evidenceRoot: options.evidenceRoot,
    inputs, cleanup: contract.cleanup, setupAcceptance: "not-proven" };
  if (options.approval !== approval) fail();
  return owner.lock(async () => {
    async function current() {
      if (hash(await owner.identity()) !== hash(identity)) fail();
      const now = await sharedAcceptanceAdapter(identity.appId);
      if (!now || now.sha256 !== loaded.sha256) fail();
      if (identity.contract.subjectSha256 !== await sharedAcceptanceSubjectSha256(identity.appId, identity.ownerAppIds)) fail();
    }
    async function publishFailure(check: "core-round-trip" | "restart-persistence") {
      await current();
      await runtime("running", 1);
      const checkedAt = new Date().toISOString();
      const anchor = readSharedAcceptanceRegistryAnchor(identity);
      const tip = await loadCompatibilityReceipts(options.evidenceRoot, [identity.contract],
        { checkedAt, requiredAnchors: anchor ? [anchor] : [] });
      const published = await publishCompatibilityObservation(options.evidenceRoot, {
        appId: identity.appId, dimension: "liveRestart", owner: identity.contract.owner,
        recipeSha256: identity.contract.recipeSha256, images: identity.contract.images,
        subjectSha256: identity.contract.subjectSha256, verifier: identity.contract.verifier,
        runId: randomUUID(), checkedAt, checks: [{ id: check, result: "fail" }], cleanup: "not-required",
      }, identity.contract, { expectedRevision: tip.revision, expectedRegistryHash: tip.registryHash });
      const chronology = read(identity);
      if (!chronology) fail();
      chronology.registry = { revision: published.revision, registryHash: published.registryHash };
      chronology.checkedAt = checkedAt;
      save(identity, chronology);
    }
    async function runtime(state: "running" | "stopped", sequence: number, epoch?: string): Promise<AcceptanceRuntimeEvidence> {
      await current();
      const units = (await owner.inspectRuntime()).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
      if (units.length !== identity.services.length || units.map((unit) => unit.serviceId).join() !== [...identity.services].sort().join()
        || units.some((unit) => unit.state !== state || !/^sha256:[a-f0-9]{64}$/.test(unit.imageId)
          || unit.immutableImage !== identity.contract.images[unit.serviceId]
          || !Number.isFinite(Date.parse(unit.startedAt)))) fail();
      const observedEpoch = hash(units.map((unit) => [unit.serviceId, unit.startedAt]));
      if (epoch && epoch !== observedEpoch) fail();
      return { source: "shared-selected-lifecycle", appId: identity.appId, projectRoot: identity.projectRoot,
        ownerId: identity.projectId, recipeSha256: identity.contract.recipeSha256,
        manifestHash: identity.contract.owner.manifestHash, units: units.map(({ serviceId, imageId }) => ({ serviceId, imageId })),
        state, sequence, epoch: observedEpoch, evidenceId: randomUUID() };
    }
    await current();
    // Bind review to the actual locked checkpoint, not the earlier unlocked snapshot.
    if (options.approval !== approvalFor(read(identity))) fail();
    await prepareCompatibilityEvidenceRoot(options.evidenceRoot);
    const stepApprovals: { action: string; token: string; progress: string }[] = [];
    const facilities = createSetupTransportFacilities({ appId: identity.appId, projectRoot: identity.projectRoot,
      checkpointNamespace: "acceptance", readStatus: async () => { await current(); return owner.status(); },
      readHandoff: async () => { await current(); return owner.handoff(); },
      async approve(action, token, progress) { if (options.approvedSteps?.includes(token)) return true;
        stepApprovals.push({ action, token, progress }); return false; },
      approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact() { return "Private acceptance transport failed"; } });
    const context: AcceptanceContext = { appId: identity.appId, projectRoot: identity.projectRoot,
      inputs, status: async () => { await current(); return owner.status(); }, ...facilities };
    let ledger = read(identity);
    if (ledger?.phase === "finished") {
      await runtime("running", 3, ledger.running?.epoch);
      const registry = await loadCompatibilityReceipts(options.evidenceRoot, [identity.contract],
        { checkedAt: new Date().toISOString(), requiredAnchors: ledger.registry ? [ledger.registry] : [] });
      const recorded = registry.observations.find((item) => item.matched && item.observation.runId === ledger!.runId);
      if (!recorded?.receipt || recorded.receipt.result !== "pass") fail();
      return { status: "finished", mutation: false, runId: ledger.runId, artifact: recorded.artifact,
        registry: { revision: registry.revision, registryHash: registry.registryHash },
        cleanup: contract.cleanup, setupAcceptance: "not-proven" };
    }
    if (options.action === "begin") {
      if (!ledger) { ledger = { schemaVersion: 1, runId: randomUUID(), binding: ledgerBinding(identity, inputs), phase: "begin-attempted",
        baseline: await runtime("running", 1), stopped: null, running: null, checkedAt: null, registry: null };
        if (Object.keys(inputs).length) ledger.inputs = inputs;
        save(identity, ledger); }
      if (!["begin-attempted", "begun"].includes(ledger.phase)) fail();
      const actual = await runtime("running", 1, ledger.baseline.epoch);
      if (hash(actual.units) !== hash(ledger.baseline.units)) fail();
      try { await loaded.adapter.begin(context, ledger.baseline); }
      catch { if (stepApprovals.length) return { status: "deferred", stepApprovals, mutation: true };
        await publishFailure("core-round-trip");
        throw new Error("App acceptance begin failed; inspect the saved canary without replaying uncertain writes"); }
      ledger.phase = "begun"; save(identity, ledger);
      return { status: "begun", mutation: true, restartVerified: false, setupAcceptance: "not-proven", runId: ledger.runId };
    }
    if (!ledger || ledger.phase === "begin-attempted" || ["stop-attempted", "start-attempted"].includes(ledger.phase)) fail();
    if (ledger.phase === "begun") {
      const before = await runtime("running", 1, ledger.baseline.epoch);
      if (hash(before.units) !== hash(ledger.baseline.units)) fail();
      ledger.phase = "stop-attempted"; save(identity, ledger);
      await owner.lifecycle("stop"); ledger.stopped = await runtime("stopped", 2, ledger.baseline.epoch);
      ledger.phase = "stopped"; save(identity, ledger);
    }
    if (ledger.phase === "stopped") {
      await runtime("stopped", 2, ledger.baseline.epoch);
      ledger.phase = "start-attempted"; save(identity, ledger);
      await owner.lifecycle("start"); ledger.running = await runtime("running", 3);
      if (ledger.running.epoch === ledger.baseline.epoch) fail();
      ledger.phase = "restarted"; save(identity, ledger);
    }
    if (!ledger.stopped || !ledger.running) fail();
    const observed = await runtime("running", 3, ledger.running.epoch);
    if (hash(observed.units) !== hash(ledger.baseline.units)) fail();
    let result;
    try { result = await loaded.adapter.finish(context, { stopped: ledger.stopped, running: ledger.running }); }
    catch {
      if (stepApprovals.length) return { status: "deferred", stepApprovals, mutation: true };
      await publishFailure("restart-persistence");
      throw new Error("App restart acceptance failed; inspect the saved canary without republishing");
    }
    if (result.appId !== identity.appId || result.projectRoot !== identity.projectRoot || !contract.verified(result)) fail();
    await current();
    const after = await runtime("running", 3, ledger.running.epoch);
    if (hash(after.units) !== hash(ledger.baseline.units)) fail();
    const tip = await loadCompatibilityReceipts(options.evidenceRoot, [identity.contract],
      { checkedAt: new Date().toISOString(), requiredAnchors: ledger.registry ? [ledger.registry] : [] });
    const anchoredFailure = ledger.registry && tip.observations.some((item) => item.matched
      && item.receipt?.result === "fail" && item.observation.checkedAt === ledger!.checkedAt
      && item.observation.runId !== ledger!.runId);
    if (!ledger.registry || anchoredFailure) {
      ledger.registry = { revision: tip.revision, registryHash: tip.registryHash };
      ledger.checkedAt = new Date().toISOString(); save(identity, ledger);
    }
    const published = await publishCompatibilityObservation(options.evidenceRoot, {
      owner: identity.contract.owner, recipeSha256: identity.contract.recipeSha256, images: identity.contract.images,
      subjectSha256: identity.contract.subjectSha256, verifier: identity.contract.verifier,
      appId: identity.appId, dimension: "liveRestart", runId: ledger.runId, checkedAt: ledger.checkedAt!,
      checks: [{ id: "application-health", result: "pass" }, { id: "core-round-trip", result: "pass" }, { id: "restart-persistence", result: "pass" }],
      cleanup: "not-required" }, identity.contract,
    { expectedRevision: tip.revision, expectedRegistryHash: tip.registryHash });
    ledger.registry = { revision: published.revision, registryHash: published.registryHash };
    ledger.phase = "finished"; save(identity, ledger);
    return { status: "finished", mutation: true, runId: ledger.runId, artifact: published.artifact,
      registry: { revision: published.revision, registryHash: published.registryHash },
      cleanup: contract.cleanup, setupAcceptance: "not-proven" };
  });
}
