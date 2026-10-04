import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sonarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/acceptance";
import radarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/radarr/acceptance";
import { loadSharedAcceptanceContract } from "../src/lib/shared-acceptance-contract";
import { sharedAcceptanceAvailable } from "../src/lib/shared-acceptance";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance";
import type { SetupCheckpoint, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";

for (const adapter of [sonarr, radarr]) {
  const appId = adapter.appId;
  assert.equal(await loadSharedAcceptanceContract(appId), null, "Metadata observer has no full-product acceptance mapping");
  assert.equal(await sharedAcceptanceAvailable(appId), false, "Metadata observer must not earn generic core-round-trip credit");
  const root = `/tmp/synthetic-${appId}-acceptance`;
  const digest = "a".repeat(64);
  const baseline: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId, projectRoot: root,
    ownerId: "fixture", recipeSha256: digest, manifestHash: digest,
    units: [{ serviceId: appId, imageId: `sha256:${digest}` }], epoch: "b".repeat(64),
    sequence: 1, evidenceId: randomUUID(), state: "running" };
  const restart = {
    stopped: { ...baseline, sequence: 2, evidenceId: randomUUID(), state: "stopped" as const },
    running: { ...baseline, sequence: 3, evidenceId: randomUUID(), epoch: "c".repeat(64) },
  };
  let checkpoint: SetupCheckpoint | null = null;
  let code = 200;
  let empty = false;
  let duplicate = false;
  let foreignFile = false;
  let foreignSelection = false;
  let foreignKeyPath = false;
  let username = "admin";
  let size = 1000;
  let profileId = 5;
  let title = "private synthetic title";
  let path = "/data/private/synthetic";
  const key = "d".repeat(32);
  const requests: SetupHttpRequest[] = [];
  let inputKey = "series-id";
  if (appId === "radarr") inputKey = "movie-id";
  const context: AcceptanceContext = {
    appId, projectRoot: root, inputs: { [inputKey]: "42" },
    async status() { return { command: "app status", appId, projectRoot: root, status: "applied", mutation: false,
      runtime: { state: "running" }, ownerKind: "shared", ownerPhase: "completed", projectId: "fixture",
      manifestHash: digest, privateFiles: `${root}/private` }; },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(next) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId, projectRoot: root, revision: (checkpoint?.revision ?? 0) + 1,
          stage: next.stage, data: next.data ?? {}, attemptedActions: [] };
        return checkpoint;
      },
    },
    secrets: {
      async readApiKey() { return key; },
      async apiKeyPath() { if (foreignKeyPath) return `${root}/foreign-key`; return `${root}/private/${appId}-api-key`; },
    } as AcceptanceContext["secrets"],
    http: { async request(request) {
      requests.push(request);
      assert.equal(request.method, "GET");
      assert.equal(request.body, undefined);
      assert.equal(request.approval, undefined);
      assert.equal(request.headers?.["X-Api-Key"], key);
      let selectedId = 42;
      let ownerId = 42;
      if (foreignSelection) selectedId = 43;
      if (foreignFile) ownerId = 43;
      let payload: unknown;
      if (request.path === "/api/v3/config/host") {
        payload = { id: 1, username, authenticationMethod: "forms", authenticationRequired: "enabled", apiKey: key };
      } else if (appId === "sonarr" && request.path === "/api/v3/series/42") {
        payload = { id: selectedId, tvdbId: 13, qualityProfileId: profileId, monitored: true, title, path };
      } else if (appId === "radarr" && request.path === "/api/v3/movie/42") {
        payload = { id: selectedId, tmdbId: 13, movieFileId: 7, qualityProfileId: profileId, monitored: true, title, path };
      } else {
        const file = { id: 7, size, title, path, apiKey: key };
        if (appId === "sonarr") {
          assert.equal(request.path, "/api/v3/episodefile");
          assert.deepEqual(request.query, { seriesId: "42" });
          payload = [{ ...file, seriesId: ownerId, seasonNumber: 0 }];
        } else {
          assert.equal(request.path, "/api/v3/moviefile");
          assert.deepEqual(request.query, { movieId: "42" });
          payload = [{ ...file, movieId: ownerId }];
        }
        if (duplicate) payload = [...payload as unknown[], ...payload as unknown[]];
        if (empty) payload = [];
      }
      return { status: code, ok: code === 200, headers: { get() { return null; } },
        async json() { return payload; }, async text() { throw new Error("not used"); }, async arrayBuffer() { throw new Error("not used"); } };
    } },
  };
  await assert.rejects(adapter.begin({ ...context, inputs: {} }, baseline), /input keys/);
  for (const selected of ["0", "-1", "01", "1.5", "1e2", "10000000000"]) {
    await assert.rejects(adapter.begin({ ...context, inputs: { [inputKey]: selected } }, baseline), /positive/);
  }
  empty = true; await assert.rejects(adapter.begin(context, baseline), /existing imported/); empty = false;
  duplicate = true; await assert.rejects(adapter.begin(context, baseline), /ownership|one existing/); duplicate = false;
  foreignFile = true; await assert.rejects(adapter.begin(context, baseline), /ownership/); foreignFile = false;
  foreignSelection = true; await assert.rejects(adapter.begin(context, baseline), /selected/); foreignSelection = false;
  foreignKeyPath = true; await assert.rejects(adapter.begin(context, baseline), /saved-key/); foreignKeyPath = false;
  username = "other"; await assert.rejects(adapter.begin(context, baseline), /administrator/); username = "admin";
  code = 403; await assert.rejects(adapter.begin(context, baseline), /library read failed/); code = 200;
  size = 0; await assert.rejects(adapter.begin(context, baseline), /ID or size/); size = 1000;
  assert.equal(checkpoint, null, "Invalid or empty workloads never gain a baseline");
  const first = await adapter.begin(context, baseline);
  assert.equal(first.existingLibraryReadVerified, true);
  assert.equal(first.restartPersistenceVerified, false);
  assert.equal(first.mediaBytesReadVerified, false);
  const saved = structuredClone(checkpoint);
  await adapter.begin(context, baseline);
  assert.deepEqual(checkpoint, saved);
  const serialized = JSON.stringify({ checkpoint, first });
  for (const secret of [key, title, path, "apiKey", "username"]) assert.equal(serialized.includes(secret), false);
  await assert.rejects(adapter.finish({ ...context, inputs: { [inputKey]: "43" } }, restart), /immutable/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: baseline.epoch } }), /distinct restart/);
  await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "foreign" } }), /shared owner/);
  size++; await assert.rejects(adapter.finish(context, restart), /did not persist/); size--;
  profileId++; await assert.rejects(adapter.finish(context, restart), /did not persist/); profileId--;
  title = "different excluded title"; path = "/different/excluded/path";
  const finished = await adapter.finish(context, restart);
  assert.equal(finished.restartPersistenceVerified, true);
  const completed = structuredClone(checkpoint);
  await adapter.finish(context, restart);
  assert.deepEqual(checkpoint, completed);
  assert(requests.every((request) => request.method === "GET" && !request.path.includes("command")));
}
console.log("Arr read-only acceptance fixtures passed (synthetic only)");
