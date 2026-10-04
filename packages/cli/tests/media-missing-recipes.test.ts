import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { multiServiceManifest } from "../src/lib/multi-service-recipe.ts";

const root = "/tmp/media-missing-recipes-fixture";
for (const app of ["tracearr", "emby"]) {
  const recipe = JSON.parse(await readFile(new URL(`../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${app}/recipe.json`, import.meta.url), "utf8"));
  const images = Object.fromEntries(recipe.services.map((service: { id: string; imageTag: string }) => [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`]));
  const projectId = `selfhost-${app}-fixture`;
  let hostPaths: Record<string, string> = {};
  if (app === "emby") hostPaths = { "media-library": "/tmp/approved-readonly-library" };
  const manifest = multiServiceManifest({ recipe, images, projectId,
    appsRoot: join(root, ".selfhost/apps"), projectDirectory: join(root, ".selfhost/apps", projectId),
    dataDirectory: join(root, ".selfhost/app-data", app), dockerContext: "default", port: 19300,
    uid: 1001, gid: 1002, timezone: "UTC", hostPaths,
    observed: { checkedAt: "2026-10-03T12:00:00.000Z", ports: [], paths: [], networks: [], volumes: [] } });
  const frontend = manifest.services[0];
  assert.deepEqual(frontend.ports.map((port: { hostIp: string; published: number }) => [port.hostIp, port.published]), [["127.0.0.1", 19300]]);
  assert.equal(manifest.services.flatMap((service: { ports: unknown[] }) => service.ports).length, 1);
  assert.equal(frontend.user, "image-default");
  if (app === "tracearr") {
    const db = manifest.services.find((service: { id: string }) => service.id === "timescale");
    assert.ok(db);
    assert.deepEqual(db.ulimits, { nofile: { soft: 65536, hard: 65536 } });
    assert.deepEqual(db.healthcheck?.test, ["CMD", "pg_isready", "-U", "tracearr"]);
    assert.equal(db.shmSizeBytes, 536870912);
    assert.equal(manifest.services.length, 3);
  } else {
    const library = frontend.mounts.find((mount: { target: string }) => mount.target === "/mnt/media");
    assert.ok(library);
    assert.equal(library.readOnly, true);
  }
}
console.log("Media missing recipe compiler fixture passed; no Docker apply or media access occurred.");
