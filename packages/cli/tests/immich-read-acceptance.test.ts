import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/immich/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupHttpRequest, SetupCheckpointUpdate } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const assetId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const keyId = "33333333-3333-4333-8333-333333333333";
const secret = "synthetic-saved-homarr-key-not-real";
const permissions = ["album.statistics", "album.read", "album.create", "user.read", "user.update", "asset.read", "asset.view",
  "asset.download", "asset.statistics", "server.statistics", "server.about"];
const original = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const root = "/tmp/immich-read-synthetic-fixture";
const baseline: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "immich", projectRoot: root,
  ownerId: "fixture", recipeSha256: "a".repeat(64), manifestHash: "b".repeat(64),
  units: ["database", "immich", "immich-machine-learning", "redis"].map((serviceId) => ({ serviceId, imageId: `sha256:${"c".repeat(64)}` })),
  epoch: "d".repeat(64), sequence: 1, evidenceId: "44444444-4444-4444-8444-444444444444", state: "running" };
const restart = { stopped: { ...baseline, state: "stopped" as const, sequence: 2, evidenceId: "55555555-5555-4555-8555-555555555555" },
  running: { ...baseline, epoch: "e".repeat(64), sequence: 3, evidenceId: "66666666-6666-4666-8666-666666666666" } };
let checkpoint: SetupCheckpoint | null = null;
let bytes = Buffer.from(original);
let absent = false;
let foreignOwner = false;
let wrongMime = false;
let wrongFilename = false;
let wrongLength = false;
let partial = false;
let keyMissing = false;
let wrongKey = false;
let admin = true;
const requests: SetupHttpRequest[] = [];
function response(status: number, value: unknown, download = false) {
  return { status, ok: status === 200, headers: { get(name: string) {
    if (!download) return null;
    if (name === "Content-Type") { if (wrongMime) return "text/html"; return "image/gif"; }
    if (name === "Content-Disposition") { if (wrongFilename) return "inline; filename*=UTF-8''other.gif";
      return "inline; filename*=UTF-8''fixture.gif"; }
    if (name === "Content-Length") { if (wrongLength) return "1000"; return String(bytes.length); }
    if (name === "Content-Range" && partial) return "bytes 0-4/100";
    return null;
  } }, async json() { return value; }, async text() { throw new Error("Do not decode originals as text"); },
  async arrayBuffer() { assert.equal(download, true); return Uint8Array.from(bytes).buffer; } };
}
const context = { appId: "immich", projectRoot: root, inputs: { "asset-id": assetId },
  async status() { return { command: "app status", appId: "immich", projectRoot: root, status: "applied",
    mutation: false, runtime: { state: "running" }, ownerKind: "shared", ownerPhase: "completed",
    projectId: "fixture", manifestHash: "b".repeat(64) }; },
  secrets: { async readApiKey() { if (keyMissing) return null; return secret; } },
  checkpoint: { async read() { return checkpoint; }, async compareAndSet(next: SetupCheckpointUpdate) {
    assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
    checkpoint = { schemaVersion: 1, appId: "immich", projectRoot: root, revision: (checkpoint?.revision ?? 0) + 1,
      stage: next.stage, data: next.data ?? {}, attemptedActions: [] }; return checkpoint;
  } },
  http: { async request(request: SetupHttpRequest) {
    requests.push(request); assert.equal(request.method, "GET"); assert.equal(request.headers?.["x-api-key"], secret);
    assert.equal(request.body, undefined); assert.equal(request.query, undefined); assert.equal(request.approval, undefined);
    if (request.path === "/api/api-keys/me") {
      let name = "Homarr"; if (wrongKey) name = "replacement";
      return response(200, { id: keyId, name, permissions });
    }
    if (request.path === "/api/users/me") return response(200, { id: ownerId, email: "admin@example.test", isAdmin: admin });
    if (request.path === `/api/assets/${assetId}`) {
      if (absent) return response(404, {});
      let selectedOwner = ownerId; if (foreignOwner) selectedOwner = keyId;
      return response(200, { id: assetId, ownerId: selectedOwner, type: "IMAGE", originalMimeType: "image/gif",
        originalFileName: "fixture.gif", isOffline: false, isTrashed: false });
    }
    assert.equal(request.path, `/api/assets/${assetId}/original`); return response(200, null, true);
  } },
} as AcceptanceContext;

function reset() {
  checkpoint = null; bytes = Buffer.from(original); absent = false; foreignOwner = false;
  wrongMime = false; wrongFilename = false; wrongLength = false; partial = false;
  keyMissing = false; wrongKey = false; admin = true; requests.length = 0;
}
const first = await adapter.begin(context, baseline);
assert.equal(first.existingAssetReadVerified, true);
assert.equal(first.restartPersistenceVerified, false);
assert.equal(first.uploadVerified, false);
assert.equal(first.machineLearningVerified, false);
assert.equal((await adapter.finish(context, restart)).restartPersistenceVerified, true);
assert.ok(requests.every((request) => request.method === "GET"), "No login, key creation, upload or other writes");
assert.ok(!JSON.stringify(checkpoint).includes(secret));
assert.ok(!JSON.stringify(checkpoint).includes("fixture.gif"));
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: baseline.epoch } }), /stop|restart/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "foreign" } }), /lineage|owner/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running,
  units: restart.running.units.filter((unit) => unit.serviceId !== "immich-machine-learning") } }), /service|evidence/);
await assert.rejects(adapter.finish({ ...context, inputs: { "asset-id": ownerId } }, restart), /workload choices/);
bytes[20] ^= 1;
await assert.rejects(adapter.finish(context, restart), /differ|changed|baseline|persist/);
reset(); await assert.rejects(adapter.begin({ ...context, inputs: {} }, baseline), /reviewed|input/);
reset(); await assert.rejects(adapter.begin({ ...context, inputs: { "asset-id": "not-uuid" } }, baseline), /UUID/);
reset(); await assert.rejects(adapter.begin(context, { ...baseline, units: baseline.units.filter((unit) => unit.serviceId !== "redis") }), /unit|service|evidence/);
reset(); absent = true; await assert.rejects(adapter.begin(context, baseline), /no empty-library/);
reset(); foreignOwner = true; await assert.rejects(adapter.begin(context, baseline), /ownership/);
reset(); admin = false; await assert.rejects(adapter.begin(context, baseline), /administrator/);
reset(); wrongKey = true; await assert.rejects(adapter.begin(context, baseline), /Homarr key/);
reset(); keyMissing = true; await assert.rejects(adapter.begin(context, baseline), /saved Homarr/);
reset(); wrongMime = true; await assert.rejects(adapter.begin(context, baseline), /content type/);
reset(); wrongFilename = true; await assert.rejects(adapter.begin(context, baseline), /file identity/);
reset(); partial = true; await assert.rejects(adapter.begin(context, baseline), /file identity/);
reset(); wrongLength = true; await assert.rejects(adapter.begin(context, baseline), /truncated/);
reset(); bytes = Buffer.from("<html>not an image</html>"); await assert.rejects(adapter.begin(context, baseline), /declared image/);
reset(); bytes = Buffer.alloc(1024 * 1024 + 1); await assert.rejects(adapter.begin(context, baseline), /oversized/);
reset(); bytes = Buffer.alloc(0); await assert.rejects(adapter.begin(context, baseline), /empty/);
console.log("Immich existing asset fixture: authenticated ownership, bounded original binary identity, full-unit restart and changed bytes rejection pass; no live credit");
