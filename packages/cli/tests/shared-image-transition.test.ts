import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState, loadSharedProjectState, loadSharedReviewedMigrationOrigin,
  loadSharedUnitComposeOriginStates } from "../src/lib/shared-project-state.ts";
import { restoreSavedSharedSelection } from "../src/lib/shared-saved-recipe.ts";
import { reviewSharedImageTransition, reviewSharedReviewedImageTransition } from "../src/lib/shared-image-transition.ts";
import { sharedImageTransitionCommand } from "../src/lib/shared-image-transition-command.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedProjectCommand } from "../src/shared-project.ts";

function selection(appId: string, port: number) {
  const imageTag = "docker.io/library/busybox:1.37.0";
  const prior = { appId, port, images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}` }, recipe: {
    schemaVersion: 2, kind: "multi-service-compose", appId,
    services: [{ id: appId, imageTag, imageSource: "https://example.test/old",
      user: "image-default", imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
      restart: "unless-stopped", readOnly: false, environment: [{ name: "SYNTHETIC_FLAG", value: "false" }],
      hostEnvironment: [], fileEnvironment: [], mounts: [{ name: "state", target: "/state" }],
      dependsOn: [], publishTargetPort: 8080 }],
    privateFiles: [], defaults: { hostIp: "127.0.0.1" },
  } };
  return { appId, recipe: prior.recipe, images: prior.images, port, hostPaths: undefined };
}
const temporary = await mkdtemp(join(tmpdir(), "selfhost-image-transition-"));
try {
  const alpha = selection("alpha", 19080);
  const beta = selection("beta", 19081);
  const recipe = structuredClone(alpha.recipe);
  recipe.services[0]!.imageTag = "docker.io/library/busybox:1.38.0";
  recipe.services[0]!.imageSource = "https://example.test/new";
  const recipeFor = () => ({ recipe, previousRecipes: [alpha.recipe], boundedApply: true });
  const images = { alpha: `${recipe.services[0]!.imageTag}@sha256:${"b".repeat(64)}` };
  const projectId = "image-transition";
  const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId,
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [alpha, beta],
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  await owner.render(await owner.plan());
  for (const service of candidate.manifest.services) {
    for (const mount of service.mounts) await mkdir(mount.source, { recursive: true, mode: 0o700 });
  }
  let state = await saveSharedProjectState(candidate,
    { operation: "create", phase: "reviewed", appIds: ["alpha", "beta"] },
    { revision: 0, manifestHash: null, checkpoint: null });
  const createOrigin = state;
  for (const phase of ["attempted", "completed"] as const) state = await saveSharedProjectState(candidate,
    { operation: "create", phase, appIds: ["alpha", "beta"] },
    { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  assert.deepEqual(restoreSavedSharedSelection(state, "alpha", recipeFor), alpha);
  assert.throws(() => restoreSavedSharedSelection(state, "alpha", () => ({ recipe, boundedApply: true })), /exact saved selection/);
  const review = reviewSharedImageTransition(state, "alpha", recipeFor, images);
  const options = { action: "image-transition-plan" as const, projectRoot: temporary,
    projectId, appId: "alpha", approval: null, json: true };
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values) => lines.push(values.join(" "));
  try {
    await sharedImageTransitionCommand(options, recipeFor, async () => images);
  } finally { console.log = originalLog; }
  const plan = JSON.parse(lines.join("\n"));
  assert.equal(plan.approval, review.approval);
  assert.equal(plan.mutation, false);
  assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, state.recordHash);
  await assert.rejects(sharedImageTransitionCommand({ ...options, action: "image-transition-apply", approval: "wrong" },
    recipeFor, async () => images), /exact saved-owner approval/);
  let observed = false;
  await assert.rejects(sharedImageTransitionCommand({ ...options, action: "image-transition-apply", approval: review.approval },
    recipeFor, async () => images, async (saved, appId, recordHash) => {
      observed = true;
      assert.equal(saved.recordHash, state.recordHash);
      assert.equal(appId, "alpha");
      assert.equal(recordHash, state.recordHash);
      throw new Error("foreign container ownership labels");
    }), /foreign container ownership/);
  assert.equal(observed, true);
  assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, state.recordHash);
  await assert.rejects(sharedImageTransitionCommand({ ...options, action: "image-transition-apply", approval: review.approval },
    recipeFor, async () => images, async () => ({ state: "stopped" })), /exact saved app running/);
  const dependencies = { recipeFor: () => ({ ...recipeFor(), recipeSha256: "fixture", services: recipe.services,
    defaults: {}, storage: {} }), resolveImage: async () => { throw new Error("invalid command must not resolve images"); } };
  const args = ["image-transition-plan", "--project-root", temporary, "--project-id", projectId, "--app", "alpha", "--json"];
  for (const extra of [["--app", "beta"], ["--port", "alpha=19090"], ["--input", "alpha.flag=value"], ["--approve", "wrong"]]) {
    await assert.rejects(sharedProjectCommand([...args, ...extra], dependencies), /one saved app|read-only/);
  }
  assert.deepEqual(review.serviceIds, ["alpha"]);
  assert.deepEqual(review.candidate.manifest.services[1], state.manifest.services[1]);
  assert.deepEqual(review.candidate.units, state.units);
  assert.deepEqual(review.candidate.settings, state.settings);
  assert.deepEqual(review.candidate.manifest.services[0].mounts, state.manifest.services[0].mounts);
  assert.deepEqual(review.candidate.manifest.services[0].environment, state.manifest.services[0].environment);
  assert.deepEqual(review.candidate.manifest.services[0].secretRefs, state.manifest.services[0].secretRefs);
  const incompatible = structuredClone(recipe);
  incompatible.services[0]!.environment[0]!.value = "true";
  assert.throws(() => reviewSharedImageTransition(state, "alpha", () => ({ ...recipeFor(), recipe: incompatible }), images), /beyond imageTag/);
  assert.throws(() => reviewSharedImageTransition(state, "alpha", recipeFor, { alpha: alpha.images.alpha }), /does not match/);
  const checkpoint = { operation: "image-transition" as const, phase: "reviewed" as const, appIds: ["alpha"] };
  const expected = { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint };
  for (const mutate of [
    (changed: any) => { changed.manifest.services[0].environment[0].value = "true"; },
    (changed: any) => { changed.manifest.services[0].ports[0].published += 1; },
    (changed: any) => { changed.manifest.services[0].mounts[0].target = "/changed-state"; },
    (changed: any) => { changed.manifest.services[0].envFilePath = join(candidate.projectDirectory, "secrets", "alpha", "alternate.env"); },
    (changed: any) => { changed.manifest.services[1].image = images.alpha; },
    (changed: any) => { changed.selectionFingerprints.beta = "c".repeat(64); },
    (changed: any) => { changed.settings.uid += 1; },
  ]) {
    const changed = structuredClone(review.candidate);
    mutate(changed);
    await assert.rejects(saveSharedProjectState(changed, checkpoint, expected));
  }
  const reviewed = await saveSharedProjectState(review.candidate, checkpoint, expected);
  const origin = await loadSharedReviewedMigrationOrigin(candidate.projectDirectory, projectId,
    reviewed.recordHash, "alpha", "image-transition");
  const recovered = reviewSharedReviewedImageTransition(reviewed, origin, "alpha", recipeFor);
  assert.notEqual(recovered.approval, review.approval);
  assert.deepEqual(recovered.candidate, review.candidate);
  const reviewedOwner = createSelfhostComposeOwner(review.candidate.manifest);
  await reviewedOwner.render(await reviewedOwner.plan());
  lines.length = 0;
  console.log = (...values) => lines.push(values.join(" "));
  try {
    await sharedImageTransitionCommand(options, recipeFor,
      async () => { throw new Error("reviewed recovery must retain its reviewed pins"); });
  } finally { console.log = originalLog; }
  const recoveryPlan = JSON.parse(lines.join("\n"));
  assert.equal(recoveryPlan.status, "resume-reviewed");
  assert.equal(recoveryPlan.approval, recovered.approval);
  const attempted = await saveSharedProjectState(review.candidate, { ...checkpoint, phase: "attempted" },
    { revision: reviewed.revision, manifestHash: reviewed.manifestHash, checkpoint: reviewed.checkpoint });
  await assert.rejects(sharedImageTransitionCommand({ action: "image-transition-apply",
    projectRoot: temporary, projectId, appId: "alpha", approval: recovered.approval, json: true },
  recipeFor, async () => { throw new Error("attempted transition must not resolve images or invoke Docker"); }), /no automatic replay/);
  state = await saveSharedProjectState(review.candidate, { ...checkpoint, phase: "completed" },
    { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  const restored = restoreSavedSharedSelection(state, "alpha", recipeFor);
  assert.deepEqual(restored.recipe, recipe);
  assert.deepEqual(restored.images, images);
  assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, state.recordHash);
  const origins = await loadSharedUnitComposeOriginStates(candidate.projectDirectory, projectId, state.recordHash);
  assert.equal(origins.alpha?.recordHash, state.recordHash);
  assert.equal(origins.beta?.recordHash, createOrigin.recordHash);
  assert.equal(origins.beta?.manifestRevision, 1);
  assert.equal(origins.alpha?.manifestRevision, 2);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log("shared image-only transition fixture passed");
