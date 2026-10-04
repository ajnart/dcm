import assert from "node:assert/strict";
import setup from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/navidrome/setup.ts";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/navidrome/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { loadSharedAcceptanceContract, sharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";
import { sharedAcceptanceAdapter, sharedAcceptanceAvailable, sharedAcceptanceSubjectSha256 } from "../src/lib/shared-acceptance.ts";

// A source audit is not byte-delivery or restart evidence. The pinned Subsonic
// GET API requires secret query parameters; the current transport's query map
// is non-secret only. Do not register a metadata-only replacement as acceptance.
assert.equal(setup.apiKey, "not-created");
assert.equal(await loadSharedAcceptanceContract("navidrome"), null);
assert.equal(sharedAcceptanceContract("navidrome"), null);
assert.equal((await sharedAcceptanceAdapter("navidrome"))?.adapter.appId, "navidrome");
assert.equal(await sharedAcceptanceAvailable("navidrome"), false);
assert.equal(await sharedAcceptanceSubjectSha256("navidrome", ["navidrome"]), null);

const hash = "a".repeat(64);
const root = "/synthetic/navidrome";
let checkpoint: SetupCheckpoint | null = null;
const requests: SetupHttpRequest[] = [];
let loginOk = true;
let changed = false;
let denied = false;
const runtime: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "navidrome", projectRoot: root,
  ownerId: "fixture", recipeSha256: hash, manifestHash: hash, epoch: hash, sequence: 1,
  evidenceId: "00000000-0000-4000-8000-000000000001", state: "running", units: [{ serviceId: "navidrome", imageId: `sha256:${hash}` }] };
const context = {
  appId: "navidrome", projectRoot: root, inputs: { "track-id": "track_fixture" },
  async status() { return { command: "app status", appId: "navidrome", projectRoot: root, status: "applied",
    mutation: false, runtime: { state: "running" }, ownerKind: "shared", ownerPhase: "completed", projectId: "fixture", manifestHash: hash }; },
  secrets: { async readAdminPassword() { return "x".repeat(40); } },
  checkpoint: { async read() { return checkpoint; }, async compareAndSet(next: any) {
    assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
    checkpoint = { schemaVersion: 1, appId: "navidrome", projectRoot: root, revision: (checkpoint?.revision ?? 0) + 1,
      stage: next.stage, attemptedActions: [], data: next.data };
    return checkpoint;
  } },
  http: { async request(request: SetupHttpRequest) {
    requests.push(request);
    assert.equal(request.query, undefined);
    let body: unknown;
    if (request.path === "/auth/login") {
      assert.equal(request.method, "POST");
      assert.equal(request.approval?.action, "navidrome-acceptance-login");
      if (denied) throw new Error("synthetic step approval denied");
      body = { username: "admin", isAdmin: loginOk, id: "user_fixture", token: "private.synthetic.jwt" };
    } else {
      assert.equal(request.method, "GET");
      assert.equal(request.path, "/api/song/track_fixture");
      assert.equal(request.headers?.["X-ND-Authorization"], "Bearer private.synthetic.jwt");
      body = { id: "track_fixture", size: 512, duration: 1.25, bitRate: 128, sampleRate: 44100,
        channels: 2, missing: false, title: "synthetic private title", path: "/private/track", ...changed && { size: 513 } };
    }
    return { status: 200, ok: true, headers: { get() { return null; } }, async json() { return body; },
      async text() { throw new Error("No text read allowed"); }, async arrayBuffer() { throw new Error("No fake media read allowed"); } };
  } },
} as unknown as AcceptanceContext;
denied = true;
await assert.rejects(adapter.begin(context, runtime), /protected/);
assert.equal(checkpoint, null);
denied = false;
loginOk = false;
await assert.rejects(adapter.begin(context, runtime), /protected/);
assert.equal(checkpoint, null);
loginOk = true;
const begin = await adapter.begin(context, runtime);
assert.equal(begin.stagedOnly, true);
assert.equal(begin.mediaBytesReadVerified, false);
assert.equal(begin.playbackVerified, false);
const restart = { stopped: { ...runtime, state: "stopped" as const, sequence: 2,
  evidenceId: "00000000-0000-4000-8000-000000000002" },
  running: { ...runtime, sequence: 3, epoch: "b".repeat(64), evidenceId: "00000000-0000-4000-8000-000000000003" } };
changed = true;
await assert.rejects(adapter.finish(context, restart), /baseline|changed|persist/);
changed = false;
const finish = await adapter.finish(context, restart);
assert.equal(finish.existingTrackMetadataReadVerified, true);
assert.equal(finish.mediaBytesReadVerified, false);
assert.equal(finish.originalDeliveryVerified, false);
for (const value of ["private.synthetic.jwt", "synthetic private title", "/private/track", "x".repeat(40)]) {
  assert.ok(!JSON.stringify(checkpoint).includes(value));
  assert.ok(!JSON.stringify(finish).includes(value));
}
assert.ok(requests.every((request) => request.path === "/auth/login" || request.path === "/api/song/track_fixture"));
console.log("Navidrome staged metadata: protected approved session auth, private header JWT and sanitized restart metadata pass; no byte delivery, active contract or live credit");
