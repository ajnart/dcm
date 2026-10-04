import { createHash } from "node:crypto";
import type { AcceptanceAdapter, AcceptanceContext, AcceptanceRuntimeEvidence } from "../../types/acceptance";
import { appliedStatus, setupRecord, type SetupCheckpoint, type SetupRecord } from "../../types/setup";
import setup from "./setup";

const APP_ID = "paperless-ngx";
const SOURCE = "https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/src/documents/views.py";
const STAGE = "paperless-document-acceptance";
const MAX_BYTES = 1024 * 1024;

function documentId(context: AcceptanceContext): number {
  const input = context.inputs?.["document-id"];
  if (!input || !/^[1-9][0-9]{0,9}$/.test(input) || !Number.isSafeInteger(Number(input))
    || Object.keys(context.inputs ?? {}).join() !== "document-id") {
    throw new Error("Paperless acceptance needs a reviewed existing document-id, not an arbitrary workload receipt");
  }
  return Number(input);
}

function evidence(context: AcceptanceContext, value: AcceptanceRuntimeEvidence, state: "running" | "stopped") {
  if (context.appId !== APP_ID || value.source !== "shared-selected-lifecycle" || value.appId !== APP_ID
    || value.projectRoot !== context.projectRoot || value.state !== state
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.ownerId)
    || !/^[a-f0-9]{64}$/.test(value.recipeSha256) || !/^[a-f0-9]{64}$/.test(value.manifestHash)
    || !/^[a-f0-9]{64}$/.test(value.epoch) || !/^[0-9a-f-]{36}$/.test(value.evidenceId)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !Array.isArray(value.units) || value.units.length !== 3
    || value.units.map((unit) => unit.serviceId).join() !== "paperless-ngx,paperless-ngx-broker,paperless-ngx-db"
    || value.units.some((unit) => !/^sha256:[a-f0-9]{64}$/.test(unit.imageId))) {
    throw new Error("Paperless acceptance requires exact selected lifecycle evidence including storage dependencies");
  }
}

async function owner(context: AcceptanceContext): Promise<SetupCheckpoint | null> {
  appliedStatus(context, await context.status());
  const saved = await context.checkpoint.read();
  if (saved && (saved.appId !== APP_ID || saved.projectRoot !== context.projectRoot
    || saved.stage !== STAGE || saved.attemptedActions.length !== 0
    || saved.data.documentId !== documentId(context))) {
    throw new Error("Paperless acceptance checkpoint or selected document differs");
  }
  return saved;
}

async function restartReady(context: AcceptanceContext): Promise<void> {
  const token = await context.secrets.readApiKey();
  if (!token || !/^[a-f0-9]{40}$/.test(token)) throw new Error("Paperless has no exact saved API token");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    let response;
    try {
      response = await context.http.request({ method: "GET", path: "/api/ui_settings/",
        headers: { Authorization: `Token ${token}`, "Cache-Control": "no-cache" }, timeoutMs: 1_000 });
    } catch {
      // Connection refusal/timeout during start is retried only on this bounded read.
    }
    if (response) {
      if (response.status === 200 && response.ok) return;
      if (![502, 503, 504].includes(response.status)) {
        throw new Error("Paperless restart readiness was denied or returned an unexpected response");
      }
    }
    if (attempt < 29) await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Paperless authenticated API did not become ready within bounded restart reads");
}

async function readDocument(context: AcceptanceContext, afterRestart = false): Promise<{ sha256: string; size: number }> {
  if (afterRestart) await restartReady(context);
  // Reuse the app-owned inspector, but perform its credential and API reads live.
  // A stored setup observation is never consulted as application health evidence.
  await setup.inspect!(context);
  const token = await context.secrets.readApiKey();
  if (!token || !/^[a-f0-9]{40}$/.test(token)) throw new Error("Paperless has no exact saved API token");
  const headers = { Authorization: `Token ${token}`, "Cache-Control": "no-cache" };
  const id = documentId(context);
  const metadata = await context.http.request({ method: "GET", path: `/api/documents/${id}/`,
    query: { fields: "id" }, headers });
  if (!metadata.ok || metadata.status !== 200 || setupRecord(await metadata.json(), "Paperless document").id !== id) {
    throw new Error("Paperless selected existing document identity could not be read");
  }
  const response = await context.http.request({ method: "GET", path: `/api/documents/${id}/download/`,
    query: { original: "true" }, headers: { ...headers, Accept: "application/octet-stream" } });
  if (!response.ok || response.status !== 200) throw new Error("Paperless selected original download is unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_BYTES) {
    throw new Error("Paperless acceptance requires a non-empty selected original document of at most 1 MiB");
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function result(context: AcceptanceContext, persistence: boolean): SetupRecord {
  return { appId: APP_ID, projectRoot: context.projectRoot, appHealthObserved: true,
    authenticatedIdentityVerified: true, documentDownloadVerified: true,
    restartPersistenceVerified: persistence, workloadScope: "selected-existing-original-document-download",
    uploadOcrSearchVerified: false, cleanup: "not-required-existing-document-read-only", source: SOURCE };
}

function sameLineage(saved: SetupCheckpoint, receipt: AcceptanceRuntimeEvidence): void {
  if (saved.data.ownerId !== receipt.ownerId || saved.data.recipeSha256 !== receipt.recipeSha256
    || saved.data.manifestHash !== receipt.manifestHash || saved.data.units !== JSON.stringify(receipt.units)) {
    throw new Error("Paperless restart owner or immutable image lineage differs");
  }
}

const adapter: AcceptanceAdapter = {
  appId: APP_ID, source: SOURCE,
  inputDefinitions: [{ key: "document-id", label: "Existing authorized original document ID (at most 1 MiB)" }],
  async begin(context, running) {
    evidence(context, running, "running");
    const saved = await owner(context);
    if (saved) {
      sameLineage(saved, running);
      if (saved.data.epoch !== running.epoch || saved.data.sequence !== running.sequence
        || saved.data.evidenceId !== running.evidenceId) {
        throw new Error("Paperless baseline start epoch differs; inspect without replacing the workload");
      }
    }
    const observed = await readDocument(context);
    if (saved && (saved.data.documentSha256 !== observed.sha256 || saved.data.documentSize !== observed.size)) {
      throw new Error("Paperless selected document bytes changed; the acceptance baseline cannot be replaced");
    }
    if (!saved) await context.checkpoint.compareAndSet({ expectedRevision: null, stage: STAGE,
      data: { documentId: documentId(context), documentSha256: observed.sha256, documentSize: observed.size,
        ownerId: running.ownerId, recipeSha256: running.recipeSha256, manifestHash: running.manifestHash,
        units: JSON.stringify(running.units), epoch: running.epoch, sequence: running.sequence,
        evidenceId: running.evidenceId, persistenceVerified: false } });
    return result(context, false);
  },
  async finish(context, restart) {
    evidence(context, restart.stopped, "stopped");
    evidence(context, restart.running, "running");
    const saved = await owner(context);
    if (!saved || !/^[a-f0-9]{64}$/.test(String(saved.data.documentSha256))
      || typeof saved.data.documentSize !== "number" || saved.data.documentSize < 1 || saved.data.documentSize > MAX_BYTES) {
      throw new Error("Paperless acceptance has no verified pre-restart document");
    }
    sameLineage(saved, restart.stopped); sameLineage(saved, restart.running);
    if (typeof saved.data.sequence !== "number" || restart.stopped.sequence <= saved.data.sequence
      || restart.running.sequence <= restart.stopped.sequence || restart.stopped.epoch !== saved.data.epoch
      || restart.running.epoch === saved.data.epoch
      || new Set([saved.data.evidenceId, restart.stopped.evidenceId, restart.running.evidenceId]).size !== 3) {
      throw new Error("Paperless persistence needs an actual recorded stop and distinct restart epoch");
    }
    const observed = await readDocument(context, true);
    if (saved.data.documentSha256 !== observed.sha256 || saved.data.documentSize !== observed.size) {
      throw new Error("Paperless exact selected original document bytes did not persist across restart");
    }
    await context.checkpoint.compareAndSet({ expectedRevision: saved.revision, stage: STAGE,
      data: { ...saved.data, persistenceVerified: true, restartEpoch: restart.running.epoch,
        stoppedEvidenceId: restart.stopped.evidenceId, restartEvidenceId: restart.running.evidenceId } });
    return result(context, true);
  },
};

export default adapter;
