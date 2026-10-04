import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { multiServiceManifest } from "../src/lib/multi-service-recipe.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const recipePath = fileURLToPath(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/recipe.json", import.meta.url));
const recipe = JSON.parse(await readFile(recipePath, "utf8"));
const root = "/tmp/selfhost-jellyfin-recipe-fixture";
const projectId = "selfhost-jellyfin-fixture";
const projectDirectory = join(root, ".selfhost", "apps", projectId);
const image = `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}`;
const input = {
  recipe, images: { jellyfin: image }, projectId,
  appsRoot: join(root, ".selfhost", "apps"), projectDirectory,
  dataDirectory: join(root, ".selfhost", "app-data", "jellyfin"),
  dockerContext: "default", port: 18096, uid: 1001, gid: 1002,
  hostPaths: { "media-library": "/tmp/selfhost-jellyfin-library-fixture" },
  observed: { checkedAt: "2026-09-29T12:00:00.000Z", ports: [], paths: [], networks: [], volumes: [] },
};
assert.throws(() => multiServiceManifest({ ...input, hostPaths: undefined }), /selected absolute host path/);
const manifest = multiServiceManifest(input);
const service = manifest.services[0];
assert.equal(service.user, "1001:1002");
assert.equal(Object.hasOwn(service, "imageUserEvidence"), false);
assert.equal(service.image, image);
assert.deepEqual(service.mounts.map((mount: { target: string; kind: string; readOnly: boolean }) =>
  [mount.target, mount.kind, mount.readOnly]), [
  ["/config", "volume", false], ["/cache", "volume", false], ["/media", "bind", true],
]);
assert.deepEqual(service.ports.map((port: { hostIp: string; published: number; target: number }) =>
  [port.hostIp, port.published, port.target]), [["127.0.0.1", 18096, 8096]]);
assert.equal((await createSelfhostComposeOwner(manifest).plan()).status, "pass");

const invalidEvidence = structuredClone(recipe);
invalidEvidence.services[0].imageUserEvidence.officialUrl = "http://example.test";
assert.throws(() => multiServiceManifest({ ...input, recipe: invalidEvidence }), /official evidence/);

process.stdout.write("Jellyfin recipe checks passed\n");
