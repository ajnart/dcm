import { setupRecord, type SetupAdapter, type SetupCheckpoint, type SetupCompatibilityResult,
  type SetupContext, type SetupInspectionContext,
  type SetupRecord } from "../types/setup";
import { createSetupProofRecorder } from "./setup-proof";

type Probe = {
  appId: string;
  path: `/${string}`;
  stage: string;
  healthSource: string | null;
  homarrIntegration: string | null;
  /** Narrow facts the endpoint does not prove, such as unconfigured ingress. */
  recordFields?: Readonly<Record<string, string | number | boolean>>;
};

type ReadOnlyProbe = Omit<Probe, "path"> & {
  /** Keep omitted for apps that do not declare shared-owner support. */
  sharedOwner?: true;
  /** App-specific, documented, read-only verification after exact-owner checks. */
  verify(context: SetupInspectionContext): Promise<void>;
};

/** A no-account probe with app-owned response validation and no setup mutation. */
export function createNoAccountReadOnlyAdapter(probe: ReadOnlyProbe): SetupAdapter {
  const proof = createSetupProofRecorder();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(probe.appId)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(probe.stage)
    || (probe.healthSource !== null && (typeof probe.healthSource !== "string"
      || !probe.healthSource || probe.healthSource.length > 200))
    || Object.keys(probe.recordFields ?? {}).some((key) => ["appId", "projectRoot", "stage"].includes(key))) {
    throw new Error("No-account read-only probe is invalid");
  }

  async function exactStatus(context: SetupInspectionContext): Promise<SetupRecord> {
    if (context.appId !== probe.appId) throw new Error(`${probe.appId} setup received another app`);
    const status = setupRecord(await context.status(), `${probe.appId} status`);
    const runtime = setupRecord(status.runtime, `${probe.appId} runtime`);
    if (status.command !== "app status" || status.appId !== probe.appId
      || status.projectRoot !== context.projectRoot || status.status !== "applied"
      || status.mutation !== false || runtime.state !== "running") {
      throw new Error(`${probe.appId} is not a running, exact saved app project`);
    }
    return status;
  }

  function markerData(status: SetupRecord): Record<string, string> {
    if (status.ownerKind !== "shared" || status.loginVia !== "none"
      || status.username !== null || status.passwordFile !== null
      || typeof status.projectId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(status.projectId)
      || typeof status.selectionFingerprint !== "string"
      || !/^[a-f0-9]{64}$/.test(status.selectionFingerprint)) {
      throw new Error(`${probe.appId} has no exact shared no-account selection; inspect before continuing`);
    }
    return { projectId: status.projectId, selectionFingerprint: status.selectionFingerprint,
      probeStage: probe.stage };
  }

  function checkMarker(context: SetupInspectionContext, marker: SetupCheckpoint | null,
    data: Record<string, string>): void {
    if (marker === null) return;
    if (marker.schemaVersion !== 1 || marker.appId !== probe.appId
      || marker.projectRoot !== context.projectRoot || marker.stage !== "no-account-read-verified"
      || !Number.isSafeInteger(marker.revision) || marker.revision < 1
      || !Array.isArray(marker.attemptedActions) || marker.attemptedActions.length !== 0
      || !marker.data || Object.keys(marker.data).sort().join() !== Object.keys(data).sort().join()
      || Object.entries(data).some(([key, value]) => marker.data[key] !== value)) {
      throw new Error(`${probe.appId} read-verification marker changed; inspect without resetting it`);
    }
  }

  async function verify(context: SetupInspectionContext): Promise<SetupRecord> {
    const status = await exactStatus(context);
    if (status.ownerKind === "shared" && context.checkpoint) {
      checkMarker(context, await context.checkpoint.read(), markerData(status));
    }
    await probe.verify(context);
    return { appId: probe.appId, projectRoot: context.projectRoot, stage: probe.stage,
      ...probe.recordFields };
  }

  return {
    appId: probe.appId,
    ...(probe.sharedOwner ? { sharedOwner: true } : {}),
    credentialCommand: "app handoff",
    apiKey: "not-created",
    healthSource: probe.healthSource,
    homarrIntegration: probe.homarrIntegration,
    ready(record) {
      return record.appId === probe.appId && record.stage === probe.stage
        && Object.entries(probe.recordFields ?? {}).every(([key, value]) => record[key] === value);
    },
    compatibilityResult(record) {
      return proof.result(record);
    },
    async firstRun(context: SetupContext) {
      const status = await exactStatus(context);
      // Standalone owners and older minimal fixtures retain read-only readiness,
      // without changing their checkpoints or producing shared provenance.
      if (status.ownerKind !== "shared" || !context.checkpoint) {
        await probe.verify(context);
        return { appId: probe.appId, projectRoot: context.projectRoot,
          stage: probe.stage, ...probe.recordFields };
      }
      const data = markerData(status);
      const marker = await context.checkpoint.read();
      checkMarker(context, marker, data);
      await probe.verify(context);
      if (marker === null) {
        const saved = await context.checkpoint.compareAndSet({ expectedRevision: null,
          stage: "no-account-read-verified", data });
        checkMarker(context, saved, data);
      }
      const record: SetupRecord = { appId: probe.appId, projectRoot: context.projectRoot,
        stage: probe.stage, ...probe.recordFields };
      let origin: SetupCompatibilityResult["origin"] = "resume";
      // "fresh" is the first owner-verified read, not creation of a server/account.
      // Compatibility scoring separately requires fresh Compose provenance.
      if (marker === null) origin = "fresh";
      return proof.record(record, origin, "no-account-verified");
    },
    inspect: verify,
  };
}

/** One documented private GET for an app with no account or API-key bootstrap. */
export function createNoAccountGetAdapter(probe: Probe): SetupAdapter {
  if (!/^\/[A-Za-z0-9/_-]*$/.test(probe.path)) {
    throw new Error("No-account GET probe is invalid");
  }
  return createNoAccountReadOnlyAdapter({
    ...probe,
    sharedOwner: true,
    async verify(context) {
      const response = await context.http.request({ method: "GET", path: probe.path });
      if (response.status !== 200 || !response.ok) {
        throw new Error(`${probe.appId} did not pass its documented private GET probe`);
      }
    },
  });
}
