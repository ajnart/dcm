import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { reviewSharedCatalogRecipeMigration, reviewSharedRecipeMigration } from "../src/lib/shared-recipe-migration.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { loadSharedProjectState, saveSharedProjectState,
  type SharedProjectExpected } from "../src/lib/shared-project-state.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-recipe-migration-"));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  const recipe = JSON.parse(await readFile(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ntfy/recipe.json", import.meta.url), "utf8"));
  const current = { appId: "ntfy", recipe,
    images: { ntfy: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` }, port: 19203 };
  const previous = structuredClone(current);
  previous.recipe.services[0].environment = previous.recipe.services[0].environment
    .filter((item: { name: string }) => item.name !== "NTFY_CACHE_FILE");
  const retained = { appId: "retained", port: 19204,
    images: { retained: `docker.io/library/busybox:1.37.0@sha256:${"b".repeat(64)}` },
    recipe: { schemaVersion: 2, kind: "multi-service-compose", appId: "retained",
      services: [{ id: "retained", imageTag: "docker.io/library/busybox:1.37.0", user: "host-selected",
        imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        readOnly: true, restart: "unless-stopped", environment: [], hostEnvironment: [],
        fileEnvironment: [], mounts: [], dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [], defaults: { hostIp: "127.0.0.1" } } };
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "migration-test",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: [previous, retained], observed: { checkedAt: "2026-10-03T00:00:00Z",
      ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const originalOwner = createSelfhostComposeOwner(candidate.manifest);
  const originalPlan = await originalOwner.plan();
  await originalOwner.render(originalPlan);
  let expected: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  let state;
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    state = await saveSharedProjectState(candidate,
      { operation: "create", phase, appIds: ["ntfy", "retained"] }, expected);
    expected = { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint };
  }
  assert.ok(state);
  const original = structuredClone(state);
  const review = reviewSharedRecipeMigration(state, current);
  assert.equal(reviewSharedCatalogRecipeMigration(state, "ntfy", recipe).approval, review.approval);
  assert.deepEqual(state, original, "planning must not mutate saved owner");
  assert.deepEqual(review.serviceIds, ["ntfy"]);
  assert.deepEqual(review.additions, [{ serviceId: "ntfy", name: "NTFY_CACHE_FILE", value: "/var/lib/ntfy/cache.db" }]);
  assert.equal(review.fromSelectionFingerprint, hash(previous));
  assert.equal(review.toSelectionFingerprint, hash(current));
  assert.equal(review.toManifestHash, hash(review.candidate.manifest));
  assert.equal(review.candidate.manifest.project.ownership, "verified-existing");
  assert.deepEqual(review.candidate.manifest.observed.project,
    { id: state.project.id, directory: state.project.directory, owner: state.project.owner });
  assert.equal(review.approval, reviewSharedRecipeMigration(state, current).approval);
  const migratedOwner = createSelfhostComposeOwner(review.candidate.manifest);
  const migratedPlan = await migratedOwner.plan();
  assert.notEqual(migratedPlan.planId, originalPlan.planId);
  await migratedOwner.render(migratedPlan);
  assert.deepEqual(review.candidate.manifest.services[1], candidate.manifest.services[1]);
  assert.deepEqual(review.candidate.manifest.services[0].mounts, candidate.manifest.services[0].mounts);
  assert.equal(review.candidate.manifest.services[0].envFilePath, candidate.manifest.services[0].envFilePath);
  assert.deepEqual(review.candidate.manifest.services[0].secretRefs, candidate.manifest.services[0].secretRefs);
  for (const alter of [
    (value: any) => { value.recipe.onboarding.username = "replacement"; },
    (value: any) => { value.recipe.privateFiles[0].bytes = 64; },
    (value: any) => { value.recipe.services[0].mounts[0].target = "/other"; },
    (value: any) => { value.recipe.services[0].readOnly = true; },
    (value: any) => { value.recipe.services[0].imageTag = "binwiederhier/ntfy:v99.0.0"; },
    (value: any) => { value.port += 1; },
    (value: any) => { value.recipe.schemaVersion = 3; },
    (value: any) => { value.recipe.services[0].environment.push({ name: "ADMIN_PASSWORD", value: "synthetic-forbidden" }); },
  ]) {
    const incompatible = structuredClone(current);
    alter(incompatible);
    assert.throws(() => reviewSharedRecipeMigration(state!, incompatible));
  }
  const changedState = structuredClone(state);
  changedState.revision += 1;
  changedState.recordHash = "c".repeat(64);
  assert.notEqual(reviewSharedRecipeMigration(changedState, current).approval, review.approval);
  const bad = structuredClone(review.candidate);
  bad.manifest.services[1].restart = "no";
  const checkpoint = { operation: "recipe-migration" as const, phase: "reviewed" as const, appIds: ["ntfy"] };
  const wrongObservation = structuredClone(review.candidate);
  wrongObservation.manifest.observed.checkedAt = "2026-10-04T00:00:00Z";
  await assert.rejects(saveSharedProjectState(wrongObservation, checkpoint, expected), /only static environment/);
  await assert.rejects(saveSharedProjectState(bad, checkpoint, expected), /another app|service/);
  const wrongSecret = structuredClone(review.candidate);
  wrongSecret.manifest.services[0].envFilePath = join(candidate.projectDirectory, "secrets", "ntfy", "other.env");
  await assert.rejects(saveSharedProjectState(wrongSecret, checkpoint, expected), /credential references/);
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    state = await saveSharedProjectState(review.candidate, { ...checkpoint, phase }, expected);
    expected = { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint };
  }
  const loaded = await loadSharedProjectState(candidate.projectDirectory, "migration-test");
  assert.equal(loaded?.selectionFingerprints.ntfy, hash(current));
  assert.equal(loaded?.selectionFingerprints.retained, original.selectionFingerprints.retained);
  assert.throws(() => reviewSharedRecipeMigration(loaded!, current), /not exactly additive/);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("PASS exact additive ntfy recipe migration, identity preservation and incompatible drift rejection (synthetic)");
