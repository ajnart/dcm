import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedProjectCandidate, prepareSharedProjectFiles } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedUnitStatus, sharedUnitHandoff } from "../src/lib/shared-unit-setup.ts";
import { restoreSavedSharedSelection } from "../src/lib/shared-saved-recipe.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-shared-connector-"));
try {
  const recipe = JSON.parse(await readFile(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/uptime-kuma/recipe.json", import.meta.url), "utf8"));
  recipe.execution = { kind: "private-connector", officialUrl: recipe.source, frontendSharing: "none" };
  recipe.onboarding = { kind: "connector-enrollment", officialUrl: recipe.source };
  recipe.privateFiles = [];
  recipe.defaults.publishedPort = null;
  recipe.services[0].publishTargetPort = null;
  recipe.acceptance = [{ id: "client-access", method: "connector", description: "Explicit client enrollment verification is required." }];
  // Synthetic input exercises the shared engine, not an installable Uptime connector.
  for (const sharing of ["none", "owner-front"] as const) {
    const selectedRecipe = structuredClone(recipe);
    selectedRecipe.execution.frontendSharing = sharing;
    const selection = { appId: recipe.appId, recipe: selectedRecipe,
      images: { [recipe.appId]: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` }, port: null };
    const projectId = `connector-${sharing}`;
    const candidate = sharedProjectCandidate({ projectRoot: root, projectId, dockerContext: "default",
      uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [selection],
      observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
    const service = candidate.manifest.services[0];
    const networks = ["uptime-kuma-private"];
    if (sharing === "owner-front") networks.unshift("front");
    assert.deepEqual(service.networks, networks);
    assert.deepEqual(service.ports, []);
    assert.equal(service.profiles, undefined);
    assert.equal(service.restart, "unless-stopped");
    await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
    const owner = createSelfhostComposeOwner(candidate.manifest);
    const plan = await owner.plan();
    assert.equal(plan.status, "pass");
    await owner.render(plan);
    await prepareSharedProjectFiles(candidate, [selection]);
    let state = await saveSharedProjectState(candidate, { operation: "create", phase: "reviewed", appIds: [recipe.appId] },
      { revision: 0, manifestHash: null, checkpoint: null });
    for (const phase of ["attempted", "completed"] as const) state = await saveSharedProjectState(candidate,
      { operation: "create", phase, appIds: [recipe.appId] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
    const recipeFor = () => ({ recipe: selectedRecipe, boundedApply: true });
    const restored = restoreSavedSharedSelection(state, recipe.appId, recipeFor);
    assert.equal(restored.port, null);
    const status = await sharedUnitStatus(root, projectId, recipe.appId, recipeFor, () => "fixture", false);
    assert.equal(status.url, null);
    assert.equal(status.port, null);
    assert.equal(status.username, null);
    assert.equal(status.passwordFile, null);
    assert.equal(status.connector, true);
    assert.equal(status.enrollmentVerified, false);
    assert.equal(status.clientAccessVerified, false);
    assert.equal(status.frontendSharing, sharing);
    const handoff = await sharedUnitHandoff(root, projectId, recipe.appId, recipeFor, () => "fixture");
    assert.equal(handoff.url, null);
    assert.equal(handoff.apiKeyFile, null);
    assert.equal(handoff.passwordFile, null);
    assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, state.recordHash);
    assert.throws(() => sharedProjectCandidate({ projectRoot: root, projectId, dockerContext: "default",
      uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [{ ...selection, port: 19000 }],
      observed: candidate.manifest.observed }), /private port is invalid/);
  }
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS shared portless connector selection/network/status contracts (no Docker or enrollment)");
