import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import type { AcceptanceAdapter, AcceptanceContext, AcceptanceRuntimeEvidence } from "../../types/acceptance";
import { appliedStatus, setupRecord, type SetupCheckpoint, type SetupRecord } from "../../types/setup";

// Version-bound evidence: v2.28.0 docs/publish.md (plain POST response),
// docs/subscribe/api.md (NDJSON poll=1&since=all, Basic auth), server/config.go
// (persistent cache requires CacheFile). No live instance has been validated.
// Cache path source: https://raw.githubusercontent.com/binwiederhier/ntfy/v2.28.0/docs/config.md
// Lifecycle receipts are trusted dispatcher evidence, not a public JSON API.
const SOURCE = "https://raw.githubusercontent.com/binwiederhier/ntfy/v2.28.0/docs/subscribe/api.md";
const PUBLISH_SOURCE = "https://raw.githubusercontent.com/binwiederhier/ntfy/v2.28.0/docs/publish.md";
const ACTION = "ntfy-acceptance-publish-canary";
const PREFIX = "auto-stack-acceptance-";

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || /[\r\n\0]/.test(value)) {
    throw new Error(`Invalid ntfy acceptance ${label}`);
  }
  return value;
}

function evidence(context: AcceptanceContext, value: AcceptanceRuntimeEvidence, state: "running" | "stopped"): void {
  if (value.source !== "shared-selected-lifecycle" || value.appId !== "ntfy"
    || value.projectRoot !== context.projectRoot || value.state !== state
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !/^[a-f0-9]{64}$/.test(value.recipeSha256)
    || !/^[a-f0-9]{64}$/.test(value.manifestHash)
    || !Array.isArray(value.units) || value.units.length < 1 || value.units.length > 8
    || value.units.some((unit) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(unit.serviceId)
      || !/^sha256:[a-f0-9]{64}$/.test(unit.imageId))
    || !value.units.some((unit) => unit.serviceId === "ntfy")
    || value.units.some((unit, index) => index > 0 && value.units[index - 1]!.serviceId >= unit.serviceId)) {
    throw new Error("ntfy acceptance requires exact-owner persisted lifecycle evidence");
  }
  for (const key of ["ownerId", "epoch", "evidenceId"] as const) text(value[key], key);
}

async function auth(context: AcceptanceContext): Promise<string> {
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) {
    throw new Error("ntfy acceptance has no saved administrator password");
  }
  return `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
}

async function owner(context: AcceptanceContext): Promise<SetupCheckpoint> {
  if (context.appId !== "ntfy") throw new Error("ntfy acceptance app owner differs");
  appliedStatus(context, await context.status());
  let saved = await context.checkpoint.read();
  if (!saved) {
    saved = await context.checkpoint.compareAndSet({ expectedRevision: null, stage: "ntfy-acceptance", data: {} });
  }
  if (saved.appId !== "ntfy" || saved.projectRoot !== context.projectRoot
    || saved.stage !== "ntfy-acceptance") {
    throw new Error("ntfy acceptance requires an isolated exact-owner acceptance checkpoint");
  }
  return saved;
}

async function save(context: AcceptanceContext, saved: SetupCheckpoint,
  data: SetupCheckpoint["data"]): Promise<SetupCheckpoint> {
  // The dispatcher supplies a separate acceptance checkpoint facility.
  return context.checkpoint.compareAndSet({ expectedRevision: saved.revision,
    stage: saved.stage, data: { ...saved.data, ...data } });
}

function canary(saved: SetupCheckpoint): { topic: string; body: string } {
  const nonce = text(saved.data.acceptanceNonce, "nonce");
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error("ntfy acceptance nonce differs");
  const topic = `${PREFIX}${nonce}`;
  const body = `Auto-Stack synthetic public canary ${nonce}`;
  if (saved.data.acceptanceTopic !== topic || saved.data.acceptanceBody !== body) {
    throw new Error("ntfy acceptance canary checkpoint differs");
  }
  return { topic, body };
}

function message(value: unknown, topic: string, body: string): SetupRecord {
  const result = setupRecord(value, "ntfy canary message");
  if (result.event !== "message" || result.topic !== topic || result.message !== body
    || typeof result.id !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(result.id)) {
    throw new Error("ntfy canary ID, topic or exact bytes differ");
  }
  return result;
}

async function subscription(context: AcceptanceContext, path: string,
  query: { poll: string; since: string }, afterRestart: boolean) {
  if (!afterRestart) return context.http.request({ method: "GET", path, query });
  // Retry only this read-only documented subscription after the selected start.
  // Authorization failures and a public subscription are observed immediately, not retried away.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await context.http.request({ method: "GET", path, query, timeoutMs: 2_000 });
      if (![502, 503, 504].includes(response.status) || attempt === 2) return response;
    } catch {
      if (attempt === 2) throw new Error("ntfy subscription is unavailable after bounded restart readiness reads");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("ntfy restart subscription readiness is unavailable");
}

async function poll(context: AcceptanceContext, topic: string, authorization: string,
  afterRestart = false): Promise<SetupRecord[]> {
  const path = `/${topic}/json`;
  const query = { poll: "1", since: "all" };
  const anonymous = await subscription(context, path, query, afterRestart);
  if (anonymous.status !== 401 && anonymous.status !== 403) {
    throw new Error("ntfy canary subscription was not private");
  }
  const response = await context.http.request({ method: "GET", path, query,
    headers: { Authorization: authorization } });
  if (response.status !== 200 || response.headers.get("X-Messages-Truncated") === "1") {
    throw new Error("ntfy authenticated canary poll is unavailable or truncated");
  }
  const body = await response.text();
  if (body.length > 16384) throw new Error("ntfy canary poll exceeded its bounded response");
  const lines = body.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > 8) throw new Error("ntfy canary inventory differs");
  return lines.map((line) => setupRecord(JSON.parse(line), "ntfy cached message"))
    .filter((entry) => entry.event === "message");
}

async function readback(context: AcceptanceContext, saved: SetupCheckpoint,
  authorization: string, afterRestart = false): Promise<SetupCheckpoint> {
  const { topic, body } = canary(saved);
  const inventory = await poll(context, topic, authorization, afterRestart);
  if (inventory.length !== 1) {
    throw new Error("ntfy canary absent or duplicated; inspect without republishing (verify persistent cache configuration)");
  }
  const observed = message(inventory[0], topic, body);
  if (saved.data.acceptanceMessageId !== null && saved.data.acceptanceMessageId !== observed.id) {
    throw new Error("ntfy canary readback ID differs");
  }
  return save(context, saved, { acceptanceMessageId: observed.id as string,
    acceptanceState: "round-trip-verified" });
}

function result(context: AcceptanceContext, saved: SetupCheckpoint, persistence: boolean): SetupRecord {
  return { appId: "ntfy", projectRoot: context.projectRoot,
    stage: saved.data.acceptanceState, topic: saved.data.acceptanceTopic,
    messageId: saved.data.acceptanceMessageId, syntheticCanary: true,
    notificationDeliveryVerified: true, anonymousSubscriptionDenied: true,
    appHealthObserved: true, healthSource: "authenticated-private-topic-poll",
    restartPersistenceVerified: persistence,
    publisherScope: "saved-administrator-not-least-privilege-publisher",
    cleanup: "retained-until-cache-expiry-no-topic-delete", source: SOURCE,
    publishSource: PUBLISH_SOURCE };
}

const adapter: AcceptanceAdapter = {
  appId: "ntfy", source: SOURCE,
  async begin(context, running) {
    evidence(context, running, "running");
    let saved = await owner(context);
    const authorization = await auth(context);
    if (saved.data.acceptanceNonce === undefined) {
      const nonce = randomBytes(16).toString("hex");
      saved = await save(context, saved, { acceptanceNonce: nonce,
        acceptanceTopic: `${PREFIX}${nonce}`, acceptanceBody: `Auto-Stack synthetic public canary ${nonce}`,
        acceptanceMessageId: null, acceptanceState: "prepared", acceptanceOwnerId: running.ownerId,
        acceptanceRecipeSha256: running.recipeSha256, acceptanceManifestHash: running.manifestHash,
        acceptanceUnits: JSON.stringify(running.units), acceptanceEpoch: running.epoch,
        acceptanceSequence: running.sequence, acceptanceEvidenceId: running.evidenceId });
    }
    if (saved.data.acceptanceOwnerId !== running.ownerId
      || saved.data.acceptanceRecipeSha256 !== running.recipeSha256
      || saved.data.acceptanceManifestHash !== running.manifestHash
      || saved.data.acceptanceUnits !== JSON.stringify(running.units)
      || saved.data.acceptanceEpoch !== running.epoch
      || saved.data.acceptanceSequence !== running.sequence
      || saved.data.acceptanceEvidenceId !== running.evidenceId) {
      throw new Error("ntfy acceptance baseline lineage differs; finish with the recorded stop/start evidence");
    }
    const { topic, body } = canary(saved);
    if (!saved.attemptedActions.includes(ACTION)) {
      if (saved.data.acceptanceState !== "prepared" || (await poll(context, topic, authorization)).length !== 0) {
        throw new Error("ntfy canary topic is not fresh; inspect without publishing");
      }
      const response = await context.http.request({ method: "POST", path: `/${topic}`,
        headers: { Authorization: authorization, "Content-Type": "text/plain; charset=utf-8" }, body,
        approval: { action: ACTION, once: true, progress: "Publish one synthetic public canary to the owned private ntfy topic" },
        beforeSendCheckpoint: { expectedRevision: saved.revision, stage: saved.stage,
          data: { ...saved.data, acceptanceState: "publish-attempted" } } });
      saved = await owner(context);
      if (response.status !== 200) throw new Error("ntfy canary publish is uncertain; inspect without republishing");
      const published = message(await response.json(), topic, body);
      saved = await save(context, saved, { acceptanceMessageId: published.id as string });
    }
    saved = await readback(context, saved, authorization);
    return result(context, saved, false);
  },
  async finish(context, restart) {
    evidence(context, restart.stopped, "stopped");
    evidence(context, restart.running, "running");
    let saved = await owner(context);
    canary(saved);
    if (!saved.attemptedActions.includes(ACTION) || typeof saved.data.acceptanceMessageId !== "string"
      || !["round-trip-verified", "restart-persistence-verified"].includes(String(saved.data.acceptanceState))) {
      throw new Error("ntfy acceptance has no verified pre-restart canary");
    }
    const baseline = saved.data.acceptanceSequence;
    for (const receipt of [restart.stopped, restart.running]) {
      if (receipt.ownerId !== saved.data.acceptanceOwnerId
        || receipt.recipeSha256 !== saved.data.acceptanceRecipeSha256
        || receipt.manifestHash !== saved.data.acceptanceManifestHash
        || JSON.stringify(receipt.units) !== saved.data.acceptanceUnits) {
        throw new Error("ntfy restart lifecycle owner lineage differs");
      }
    }
    if (typeof baseline !== "number" || restart.stopped.sequence <= baseline
      || restart.running.sequence <= restart.stopped.sequence
      || restart.stopped.epoch !== saved.data.acceptanceEpoch
      || restart.running.epoch === saved.data.acceptanceEpoch
      || new Set([saved.data.acceptanceEvidenceId, restart.stopped.evidenceId, restart.running.evidenceId]).size !== 3) {
      throw new Error("ntfy restart needs a recorded actual stop then a distinct running epoch");
    }
    saved = await readback(context, saved, await auth(context), true);
    saved = await save(context, saved, { acceptanceState: "restart-persistence-verified",
      acceptanceStoppedEvidenceId: restart.stopped.evidenceId,
      acceptanceRestartEvidenceId: restart.running.evidenceId,
      acceptanceRestartEpoch: restart.running.epoch });
    return result(context, saved, true);
  },
};

export default adapter;
