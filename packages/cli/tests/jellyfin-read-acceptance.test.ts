import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/acceptance.ts";
import type { AcceptanceContext, AcceptanceRuntimeEvidence } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance.ts";
import type { SetupCheckpoint, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { loadSharedAcceptanceContract } from "../src/lib/shared-acceptance-contract.ts";

const root = "/tmp/jellyfin-read-acceptance-synthetic";
const itemId = "1".repeat(32);
const libraryId = "2".repeat(32);
const serverId = "3".repeat(32);
const digest = "a".repeat(64);
const running: AcceptanceRuntimeEvidence = { source: "shared-selected-lifecycle", appId: "jellyfin",
  projectRoot: root, ownerId: "fixture", recipeSha256: digest, manifestHash: digest,
  units: [{ serviceId: "jellyfin", imageId: `sha256:${digest}` }],
  epoch: "b".repeat(64), sequence: 1, evidenceId: randomUUID(), state: "running" };
const restart = { stopped: { ...running, sequence: 2, evidenceId: randomUUID(), state: "stopped" as const },
  running: { ...running, sequence: 3, epoch: "c".repeat(64), evidenceId: randomUUID() } };
const original = Buffer.from("synthetic authorized original video bytes");
let bytes = original;
let checkpoint: SetupCheckpoint | null = null;
let size = original.length;
let itemType = "Movie";
let ancestorId = libraryId;
let remote = false;
let sourceCount = 1;
let libraryCount = 1;
let itemCount = 1;
let status = 200;
let contentType = "video/mp4";
let container = "mp4";
let passwordReads = 0;
let key = "k".repeat(32);
const requests: SetupHttpRequest[] = [];
const context: AcceptanceContext = { appId: "jellyfin", projectRoot: root, inputs: { "item-id": itemId },
  async status() { return { command: "app status", appId: "jellyfin", projectRoot: root,
    status: "applied", mutation: false, runtime: { state: "running" }, ownerKind: "shared",
    ownerPhase: "completed", projectId: "fixture", manifestHash: digest,
    privateFiles: `${root}/private`, url: "http://127.0.0.1:18096" }; },
  checkpoint: { async read() { return checkpoint; }, async compareAndSet(next) {
    assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
    checkpoint = { schemaVersion: 1, appId: "jellyfin", projectRoot: root,
      revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
      attemptedActions: [], data: next.data ?? {} };
    return checkpoint;
  } },
  secrets: { async readAdminPassword() { passwordReads += 1; throw new Error("No login permitted"); },
    async readApiKey() { return key; }, async apiKeyPath() { return `${root}/private/jellyfin-api-key`; },
  } as AcceptanceContext["secrets"],
  http: { async request(request) {
    requests.push(request);
    assert.equal(request.method, "GET"); assert.equal(request.body, undefined);
    assert.equal(request.approval, undefined); assert.equal(request.beforeSendCheckpoint, undefined);
    if (request.path !== "/System/Info/Public") {
      assert.equal(request.headers?.Authorization, `MediaBrowser Token="${key}"`);
    }
    let payload: unknown;
    const source = { Id: itemId, Protocol: "File", IsRemote: remote, Type: "Default",
      Path: "/data/movies/synthetic.mp4", Size: size, Container: container, RunTimeTicks: 100 };
    if (request.path === "/System/Info" || request.path === "/System/Info/Public") {
      payload = { Id: serverId, Version: "12.1.20260915", StartupWizardCompleted: true };
    } else if (request.path === "/Items") {
      assert.deepEqual(request.query, { ids: itemId, fields: "Path,MediaSources",
        locationTypes: "File", includeItemTypes: "Movie,Episode", limit: "1",
        recursive: "true", enableImages: "false", enableUserData: "false" });
      payload = { TotalRecordCount: itemCount, Items: Array.from({ length: itemCount }, () => ({
        Id: itemId, Type: itemType, IsFolder: false, MediaType: "Video", LocationType: "File",
        VideoType: "VideoFile", Path: source.Path, MediaSources: Array.from({ length: sourceCount }, () => source),
      })) };
    } else if (request.path === "/Library/VirtualFolders") {
      payload = Array.from({ length: libraryCount }, () => ({ Name: "Movies", CollectionType: "movies",
        Locations: ["/data/movies"], ItemId: libraryId }));
    } else if (request.path === `/Items/${itemId}/Ancestors`) payload = [{ Id: ancestorId }];
    else assert.equal(request.path, `/Items/${itemId}/Download`);
    return { status, ok: status === 200, headers: { get(name) {
      if (name === "content-type") return contentType;
      return null;
    } }, async json() { return payload; }, async text() { return "withheld"; },
      async arrayBuffer() { return Uint8Array.from(bytes).buffer; } };
  } },
};

const contract = await loadSharedAcceptanceContract("jellyfin");
assert.ok(contract);
assert.deepEqual(contract.inputs({ "item-id": itemId }), { "item-id": itemId });
assert.throws(() => contract.inputs({ "item-id": "https://unsafe/item" }));
assert.throws(() => contract.inputs({ "item-id": "a".repeat(37) }));
await assert.rejects(adapter.begin({ ...context, inputs: { "item-id": "not-a-guid" } }, running), /UUID-like/);
const begin = await adapter.begin(context, running);
assert.equal(begin.originalMediaReadVerified, true);
assert.equal(contract.verified(begin), false);
const saved = structuredClone(checkpoint);
await adapter.begin(context, running);
assert.deepEqual(checkpoint, saved, "Repeated begin cannot replace baseline");
assert.equal(JSON.stringify(checkpoint).includes("synthetic.mp4"), false);
assert.equal(JSON.stringify(checkpoint).includes(key), false);
assert.equal(JSON.stringify(checkpoint).includes(original.toString()), false);
await assert.rejects(adapter.finish({ ...context, inputs: { "item-id": "4".repeat(32) } }, restart), /choices differ/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, epoch: running.epoch } }), /distinct restart/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running,
  units: [{ serviceId: "another-service", imageId: `sha256:${digest}` }] } }), /lifecycle evidence/);
await assert.rejects(adapter.finish(context, { ...restart, running: { ...restart.running, ownerId: "other" } }), /shared owner/);
bytes = Buffer.from("changed video bytes"); size = bytes.length;
await assert.rejects(adapter.finish(context, restart), /did not persist/);
await assert.rejects(adapter.begin(context, running), /cannot be replaced/);
bytes = original; size = original.length;
container = "mkv";
await assert.rejects(adapter.finish(context, restart), /did not persist/);
container = "mp4"; remote = true;
await assert.rejects(adapter.finish(context, restart), /local original/);
remote = false; itemType = "Folder";
await assert.rejects(adapter.finish(context, restart), /Movie or Episode/);
itemType = "Movie"; sourceCount = 2;
await assert.rejects(adapter.finish(context, restart), /original media source/);
sourceCount = 1; itemCount = 0;
await assert.rejects(adapter.finish(context, restart), /empty library/);
itemCount = 1; libraryCount = 2;
await assert.rejects(adapter.finish(context, restart), /library is missing or ambiguous/);
libraryCount = 1; ancestorId = "5".repeat(32);
await assert.rejects(adapter.finish(context, restart), /expected local media library/);
ancestorId = libraryId; size = 1024 * 1024 + 1;
const beforeOversize = requests.filter((request) => request.path.endsWith("/Download")).length;
await assert.rejects(adapter.finish(context, restart), /at most 1 MiB/);
assert.equal(requests.filter((request) => request.path.endsWith("/Download")).length, beforeOversize);
size = original.length; bytes = Buffer.alloc(0);
await assert.rejects(adapter.finish(context, restart), /empty, oversized, truncated/);
bytes = Buffer.alloc(1024 * 1024 + 1);
await assert.rejects(adapter.finish(context, restart), /empty, oversized, truncated/);
bytes = original; contentType = "text/html";
await assert.rejects(adapter.finish(context, restart), /video bytes/);
contentType = "video/mp4"; status = 403;
await assert.rejects(adapter.finish(context, restart), /readiness was denied/);
status = 200; key = "short";
await assert.rejects(adapter.finish(context, restart), /saved private API key/);
key = "k".repeat(32);
const complete = await adapter.finish(context, restart);
assert.equal(contract.verified(complete), true);
assert.equal(contract.verified({ ...complete, originalMediaReadVerified: false }), false);
assert.equal(complete.renderedPlayerVerified, false);
assert.equal(complete.transcodingVerified, false);
assert.equal(complete.externalClientNetworkVerified, false);
assert.equal(passwordReads, 0);
console.log("Jellyfin read-only original acceptance fixture passed (synthetic; zero live credit)");
