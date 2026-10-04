import type { AcceptanceAdapter, AcceptanceContext, AcceptanceRuntimeEvidence } from "./acceptance";
import { appliedStatus, setupRecord, type SetupCheckpoint, type SetupRecord } from "./setup";

export type ReadOnlyAcceptanceConfig = {
  appId: string;
  source: string;
  stage: string;
  serviceIds: readonly string[];
  cleanup: string;
  inputDefinitions?: readonly { key: string; label: string }[];
  /** Documented session authentication only, through the existing exact action approval transport. */
  authenticationRequests?: readonly { path: string; action: string }[];
  /** Only flat app-owned IDs, hashes and sizes/counts; never workload bytes or secrets. */
  observe(context: AcceptanceContext, afterRestart: boolean): Promise<{ baseline: SetupRecord; result: SetupRecord }>;
};
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Exact shared-owner readback, not a canary writer or an arbitrary receipt mapper. */
export function createReadOnlyAcceptance(config: ReadOnlyAcceptanceConfig): AcceptanceAdapter {
  const serviceIds = [...config.serviceIds].sort();
  const definitions = (config.inputDefinitions ?? []).map((item) => ({ ...item }));
  const authenticationRequests = (config.authenticationRequests ?? []).map((item) => ({ ...item }));
  function fail(message: string): never { throw new Error(`${config.appId} acceptance: ${message}`); }
  if (!IDENTIFIER.test(config.appId) || !IDENTIFIER.test(config.stage) || !IDENTIFIER.test(config.cleanup)
    || !/^https:\/\//.test(config.source) || serviceIds.length < 1 || serviceIds.length > 32
    || serviceIds.some((id) => !IDENTIFIER.test(id)) || new Set(serviceIds).size !== serviceIds.length
    || definitions.length > 8 || definitions.some((item) => !IDENTIFIER.test(item.key))
    || new Set(definitions.map((item) => item.key)).size !== definitions.length
    || authenticationRequests.length > 4 || authenticationRequests.some((item) =>
      !/^\/[A-Za-z0-9/_-]{1,128}$/.test(item.path) || !IDENTIFIER.test(item.action))
    || new Set(authenticationRequests.map((item) => item.path)).size !== authenticationRequests.length) fail("invalid packaged configuration");

  function inputs(context: AcceptanceContext): string {
    const selected = context.inputs ?? {};
    if (Object.keys(selected).sort().join() !== definitions.map((item) => item.key).sort().join()) {
      fail("reviewed workload input keys differ");
    }
    const ordered: Record<string, string> = {};
    for (const key of Object.keys(selected).sort()) {
      const value = selected[key];
      if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[^\x21-\x7e]/.test(value)) {
        fail("invalid reviewed workload input");
      }
      ordered[key] = value;
    }
    return JSON.stringify(ordered);
  }
  function evidence(context: AcceptanceContext, value: AcceptanceRuntimeEvidence, state: "running" | "stopped"): void {
    if (context.appId !== config.appId || value.source !== "shared-selected-lifecycle"
      || value.appId !== config.appId || value.projectRoot !== context.projectRoot || value.state !== state
      || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.ownerId)
      || !SHA256.test(value.recipeSha256) || !SHA256.test(value.manifestHash) || !SHA256.test(value.epoch)
      || !UUID.test(value.evidenceId) || !Number.isSafeInteger(value.sequence) || value.sequence < 1
      || !Array.isArray(value.units) || value.units.map((unit) => unit.serviceId).join() !== serviceIds.join()
      || value.units.some((unit) => !/^sha256:[a-f0-9]{64}$/.test(unit.imageId))) {
      fail("exact selected trusted lifecycle evidence or service/image identity differs");
    }
  }
  async function owner(context: AcceptanceContext, receipt: AcceptanceRuntimeEvidence): Promise<SetupCheckpoint | null> {
    const status = appliedStatus(context, await context.status());
    if (status.ownerKind !== "shared" || status.ownerPhase !== "completed"
      || status.projectId !== receipt.ownerId || status.manifestHash !== receipt.manifestHash) {
      fail("an explicit completed shared owner matching the lifecycle is required");
    }
    const saved = await context.checkpoint.read();
    if (saved && (saved.schemaVersion !== 1 || saved.appId !== config.appId || saved.projectRoot !== context.projectRoot
      || saved.stage !== config.stage || !Number.isSafeInteger(saved.revision) || saved.revision < 1
      || saved.attemptedActions.length !== 0 || saved.data.inputs !== inputs(context)
      || typeof saved.data.baseline !== "string" || !SHA256.test(String(saved.data.epoch))
      || !UUID.test(String(saved.data.evidenceId)) || !Number.isSafeInteger(saved.data.sequence)
      || (saved.data.sequence as number) < 1
      || typeof saved.data.persistenceVerified !== "boolean")) {
      fail("isolated checkpoint or immutable reviewed workload choices differ");
    }
    return saved;
  }
  function sameLineage(saved: SetupCheckpoint, value: AcceptanceRuntimeEvidence): void {
    if (saved.data.ownerId !== value.ownerId || saved.data.recipeSha256 !== value.recipeSha256
      || saved.data.manifestHash !== value.manifestHash || saved.data.units !== JSON.stringify(value.units)) {
      fail("original owner or immutable image lineage differs");
    }
  }
  function baseline(value: SetupRecord): string {
    const record = setupRecord(value, "read-only acceptance baseline");
    const keys = Object.keys(record).sort();
    if (keys.length < 1 || keys.length > 32) fail("bounded sanitized baseline is required");
    const ordered: SetupRecord = {};
    for (const key of keys) {
      const value = record[key];
      if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)) fail("invalid sanitized baseline field");
      if (/(sha256|hash)$/i.test(key)) {
        if (typeof value !== "string" || !SHA256.test(value)) fail("invalid baseline hash");
      } else if (/(size|bytes|count)$/i.test(key)) {
        if (!Number.isSafeInteger(value) || (value as number) < 0) fail("invalid baseline size/count");
      } else if (/id$/i.test(key)) {
        if (typeof value === "string") {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail("invalid baseline ID");
        } else if (!Number.isSafeInteger(value) || (value as number) < 0) fail("invalid baseline ID");
      } else fail("baseline may contain only app-owned ID/hash/size/count fields");
      ordered[key] = value;
    }
    return JSON.stringify(ordered);
  }
  async function observe(context: AcceptanceContext, afterRestart: boolean) {
    // Workload reads and declared protected session auth only; no secret/checkpoint writes.
    const readOnly: AcceptanceContext = { appId: context.appId, projectRoot: context.projectRoot,
      status: () => context.status(),
      inputs: Object.freeze(JSON.parse(inputs(context))),
      http: { request(request) {
        const authentication = request.method === "POST" && authenticationRequests.some((item) =>
          item.path === request.path && item.action === request.approval?.action);
        if (authentication) {
          if (request.approval?.once === true || request.beforeSendCheckpoint !== undefined
            || request.effect !== undefined || request.query !== undefined) fail("observer attempted an unapproved authentication mutation");
        } else if (!["GET", "HEAD"].includes(request.method) || request.body !== undefined
          || request.approval !== undefined || request.beforeSendCheckpoint !== undefined
          || request.effect !== undefined) fail("observer attempted a mutation");
        return context.http.request(request);
      } },
      checkpoint: { read: () => context.checkpoint.read(), compareAndSet: async () => fail("observer attempted a checkpoint mutation") },
      secrets: new Proxy(context.secrets, { get(target, property) {
        if (typeof property !== "string" || !property.startsWith("read") && property !== "apiKeyPath") {
          fail("observer attempted a secret mutation");
        }
        const method = Reflect.get(target, property);
        if (typeof method !== "function") fail("unknown secret reader");
        return method.bind(target);
      } }),
    };
    const observed = await config.observe(readOnly, afterRestart);
    return { baseline: baseline(observed.baseline), result: setupRecord(observed.result, "read-only acceptance result") };
  }
  function result(context: AcceptanceContext, observed: SetupRecord, persistence: boolean): SetupRecord {
    return { ...observed, appId: config.appId, projectRoot: context.projectRoot, source: config.source,
      cleanup: config.cleanup, restartPersistenceVerified: persistence };
  }
  return {
    appId: config.appId, source: config.source, inputDefinitions: definitions,
    async begin(context, running) {
      evidence(context, running, "running");
      const choices = inputs(context);
      const saved = await owner(context, running);
      if (saved) {
        sameLineage(saved, running);
        if (saved.data.epoch !== running.epoch || saved.data.sequence !== running.sequence
          || saved.data.evidenceId !== running.evidenceId) fail("original baseline start chronology differs; no reset is allowed");
      }
      const observed = await observe(context, false);
      if (saved && saved.data.baseline !== observed.baseline) fail("baseline changed; it cannot be replaced");
      if (!saved) await context.checkpoint.compareAndSet({ expectedRevision: null, stage: config.stage,
        data: { inputs: choices, baseline: observed.baseline, ownerId: running.ownerId,
          recipeSha256: running.recipeSha256, manifestHash: running.manifestHash, units: JSON.stringify(running.units),
          epoch: running.epoch, sequence: running.sequence, evidenceId: running.evidenceId, persistenceVerified: false } });
      return result(context, observed.result, false);
    },
    async finish(context, restart) {
      evidence(context, restart.stopped, "stopped"); evidence(context, restart.running, "running");
      const saved = await owner(context, restart.running);
      if (!saved || typeof saved.data.baseline !== "string") fail("no verified pre-restart baseline");
      sameLineage(saved, restart.stopped); sameLineage(saved, restart.running);
      if (typeof saved.data.sequence !== "number" || restart.stopped.sequence <= saved.data.sequence
        || restart.running.sequence <= restart.stopped.sequence || restart.stopped.epoch !== saved.data.epoch
        || restart.running.epoch === saved.data.epoch
        || new Set([saved.data.evidenceId, restart.stopped.evidenceId, restart.running.evidenceId]).size !== 3) {
        fail("persistence needs the recorded stop and a distinct restart epoch/chronology");
      }
      if (saved.data.persistenceVerified === true && (saved.data.restartEpoch !== restart.running.epoch
        || saved.data.stoppedSequence !== restart.stopped.sequence || saved.data.restartSequence !== restart.running.sequence
        || saved.data.stoppedEvidenceId !== restart.stopped.evidenceId || saved.data.restartEvidenceId !== restart.running.evidenceId)) {
        fail("completed restart chronology differs; no reset is allowed");
      }
      const observed = await observe(context, true);
      if (saved.data.baseline !== observed.baseline) fail("exact existing workload baseline did not persist");
      if (saved.data.persistenceVerified !== true) await context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
        stage: config.stage, data: { ...saved.data, persistenceVerified: true, restartEpoch: restart.running.epoch,
          stoppedSequence: restart.stopped.sequence, restartSequence: restart.running.sequence,
          stoppedEvidenceId: restart.stopped.evidenceId, restartEvidenceId: restart.running.evidenceId } });
      return result(context, observed.result, true);
    },
  };
}
