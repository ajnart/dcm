import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedSetupTransitionCandidates, sharedPlanApproval } from "../src/shared-project.ts";
import { sharedProjectCandidate, prepareSharedProjectFiles } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { reviewSharedEnvironmentTransition } from "../src/lib/shared-env-transition.ts";
import { sharedUnitStatus } from "../src/lib/shared-unit-setup.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const root = await mkdtemp(join(tmpdir(), "shared-closure-candidates-"));
try {
  const recipe = JSON.parse(await readFile(new URL(
    "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/linkwarden/recipe.json", import.meta.url), "utf8"));
  const selection = { appId: "linkwarden", recipe,
    images: Object.fromEntries(recipe.services.map((service: Record<string, any>) =>
      [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`])), port: 18080, hostPaths: undefined };
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "closure",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "UTC", apps: [selection],
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  await owner.render(await owner.plan());
  await prepareSharedProjectFiles(candidate, [selection]);
  let state = await saveSharedProjectState(candidate,
    { operation: "create", phase: "reviewed", appIds: ["linkwarden"] },
    { revision: 0, manifestHash: null, checkpoint: null });
  for (const phase of ["attempted", "completed"] as const) state = await saveSharedProjectState(candidate,
    { operation: "create", phase, appIds: ["linkwarden"] },
    { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  const recipeFor = () => ({ recipe, services: recipe.services, defaults: recipe.defaults,
    storage: recipe.storage, boundedApply: true, recipeSha256: "a".repeat(64) });
  const outcome = { appId: "linkwarden", state: "needs-inspection" as const,
    detail: "First account verified, registration still open", transitionReady: true };
  assert.deepEqual(await sharedSetupTransitionCandidates(state, [outcome], root, recipeFor), []);
  const keyRef = join(state.project.directory, "secrets", "linkwarden", "linkwarden-api-key");
  const proof = { schemaVersion: 1, appId: "linkwarden", projectRoot: root, revision: 2,
    stage: "account-verified", attemptedActions: ["linkwarden-create-first-account"],
    data: { ownerManifestHash: state.manifestHash, identity: "admin",
      credentialRef: join(state.project.directory, "secrets", "linkwarden", "admin-password") } as Record<string, unknown> };
  const proofPath = join(state.project.directory, "first-run-linkwarden.json");
  await writeFile(proofPath, JSON.stringify(proof), { mode: 0o600 });
  assert.deepEqual(await sharedSetupTransitionCandidates(state, [outcome], root, recipeFor), [], "account without key proof must not close registration");
  proof.data.apiKeyRef = keyRef;
  await writeFile(proofPath, JSON.stringify(proof), { mode: 0o600 });
  assert.deepEqual(await sharedSetupTransitionCandidates(state, [outcome], root, recipeFor), [], "missing saved key must not authorize closure");
  await writeFile(keyRef, "synthetic-key-for-fixture-only", { mode: 0o600 });
  assert.deepEqual(await sharedSetupTransitionCandidates(state, [outcome], root, recipeFor), ["linkwarden"]);
  assert.deepEqual(await sharedSetupTransitionCandidates(state, [{ ...outcome, transitionReady: false }], root, recipeFor), []);
  const review = reviewSharedEnvironmentTransition(state, "linkwarden", recipe, recipe.postFirstAccountEnvironment);
  const closedOwner = createSelfhostComposeOwner(review.candidate.manifest);
  await closedOwner.render(await closedOwner.plan());
  for (const phase of ["reviewed", "attempted", "completed"] as const) state = await saveSharedProjectState(review.candidate,
    { operation: "transition", phase, appIds: ["linkwarden"] },
    { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  const closed = await sharedUnitStatus(root, "closure", "linkwarden", recipeFor, () => sharedPlanApproval(review.candidate), false);
  assert.equal(closed.environmentTransition.value, "true");
  // Another recorded lifecycle no longer hides the validated closure history.
  for (const phase of ["reviewed", "attempted", "completed"] as const) state = await saveSharedProjectState(review.candidate,
    { operation: "stop", phase, appIds: ["linkwarden"] },
    { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  state = (await loadSharedProjectState(state.project.directory, "closure"))!;
  const later = await sharedUnitStatus(root, "closure", "linkwarden", recipeFor, () => sharedPlanApproval(review.candidate), false);
  assert.equal(later.environmentTransition.value, "true");
  assert.equal(later.ownerRecordHash, state.recordHash);
  assert.equal(later.ownerPhase, "completed");
  assert(later.privateFileIds.includes("admin-password"));
  assert.deepEqual(await sharedSetupTransitionCandidates(state, [outcome], root, recipeFor), []);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("Shared closure candidates require saved login/key proof; validated closure survives later owner lifecycle: pass (synthetic)");
