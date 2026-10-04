import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sharedImageInventory } from "../src/shared-project.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { sharedUnitRecipeCheck } from "../src/lib/shared-unit-setup.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";

function selection(appId: string, port: number) {
  const imageTag = "docker.io/library/busybox:1.37.0";
  const service = (id: string) => ({ id, imageTag, user: "image-default",
    imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
    restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [],
    fileEnvironment: [], mounts: [], dependsOn: [], publishTargetPort: null });
  const frontend = service(appId);
  frontend.publishTargetPort = 8080;
  const images = {
    [appId]: `${imageTag}@sha256:${"a".repeat(64)}`,
    db: `${imageTag}@sha256:${"b".repeat(64)}`,
  };
  const recipe = { schemaVersion: 2, kind: "multi-service-compose", appId,
    services: [frontend, service("db")], privateFiles: [],
    defaults: { hostIp: "127.0.0.1", publishedPort: port }, storage: { minimumFreeBytes: 1_000_000 } };
  return { appId, recipe, images, port };
}

const selections = [selection("alpha", 18080), selection("beta", 18081)];
const candidate = sharedProjectCandidate({ projectRoot: "/tmp/selfhost-image-inventory-fixture",
  projectId: "image-inventory", dockerContext: "default", uid: 1000, gid: 1000,
  timezone: "Etc/UTC", apps: selections,
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
const current = { ...candidate, project: candidate.manifest.project, checkpoint: {
  operation: "create", phase: "completed", appIds: ["alpha", "beta"],
} } as unknown as SharedProjectState;
const info = (appId: string) => {
  const selected = selections.find((entry) => entry.appId === appId)!;
  return { recipe: selected.recipe, defaults: selected.recipe.defaults,
    storage: selected.recipe.storage, services: selected.recipe.services, boundedApply: true,
    recipeSha256: createHash("sha256").update(JSON.stringify(selected.recipe)).digest("hex") };
};

const matched = sharedImageInventory(current, info);
assert.deepEqual(matched.images.alpha, selections[0]!.images);
assert.deepEqual(matched.images.beta, selections[1]!.images);
assert.equal(matched.recipeSha256.alpha, info("alpha").recipeSha256);
assert.equal(matched.imageChecks.alpha, "matches-saved-selection");
assert.equal(matched.imageChecks.beta, "matches-saved-selection");
assert.equal(sharedUnitRecipeCheck(current, "alpha", info), "matches-saved-selection");
assert.equal(Object.hasOwn(matched.images.alpha!, "alpha-db"), false);

const changedRecipe = (appId: string) => {
  if (appId === "alpha") {
    const changed = structuredClone(info(appId));
    changed.recipe.services[0]!.restart = "always";
    return changed;
  }
  return info(appId);
};
const drifted = sharedImageInventory(current, changedRecipe);
assert.equal(drifted.recipeSha256.alpha, null);
assert.equal(drifted.imageChecks.alpha, "recipe-unavailable-or-changed");
assert.deepEqual(drifted.images.alpha, matched.images.alpha);
assert.equal(drifted.recipeSha256.beta, matched.recipeSha256.beta);
assert.equal(sharedUnitRecipeCheck(current, "alpha", changedRecipe), "recipe-unavailable-or-changed");
assert.equal(sharedUnitRecipeCheck(current, "beta", changedRecipe), "matches-saved-selection");
assert.equal(sharedUnitRecipeCheck(current, "missing", info), "recipe-unavailable-or-changed");

const removed = sharedImageInventory(current, () => { throw new Error("recipe removed"); });
assert.deepEqual(removed.images, matched.images);
assert.deepEqual(removed.recipeSha256, { alpha: null, beta: null });
const prepared = structuredClone(current);
prepared.checkpoint.phase = "prepared";
assert.deepEqual(sharedImageInventory(prepared, () => {
  assert.fail("unfinished status must not inspect the catalog");
}).recipeSha256, { alpha: null, beta: null });
assert.deepEqual(sharedImageInventory(null, info), { images: {}, recipeSha256: {}, imageChecks: {} });
assert.equal(JSON.stringify(matched).includes("envFilePath"), false);
process.stdout.write("shared image inventory checks passed\n");
