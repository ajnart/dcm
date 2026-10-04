import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { bundledSharedRecipeChoices } from "../src/interactive-catalog.ts";
import { sharedIntentSelection } from "../src/control-panel/shared-intent.ts";
import { continueSharedGoal } from "../src/control-panel/shared-goal.ts";
import type { ProjectSnapshot } from "../src/control-panel/project-snapshot.ts";

const root = resolve(import.meta.dir, "../../..");
const projectRoot = mkdtempSync(`${tmpdir()}/shared-intent-fixture-`);
const producer = resolve(root, ".agents/skills/self-host/workflows/selfhost/scripts/selfhost.ts");
function invoke(args: string[], exitCode = 0): Record<string, any> {
  const output = spawnSync(process.execPath, [producer, ...args, "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(output.status, exitCode, output.stderr);
  return JSON.parse(output.stdout);
}
function plan(args: string[], exitCode = 0) {
  return invoke(["plan", ...args, "--project-root", projectRoot], exitCode);
}
const recipes = bundledSharedRecipeChoices(invoke(["catalog", "recipes"]).data);
const photos = plan(["photos"]);
const initial = sharedIntentSelection(photos, recipes);
assert.equal(initial.status, "ready");
assert.equal(initial.mutation, false);
assert.deepEqual(initial.selected, ["homarr", "immich", "postgresql", "valkey"]);
assert.deepEqual(initial.requested, ["homarr", "immich"]);
assert.deepEqual(initial.dependencies.map((entry) => entry.app).sort(), ["postgresql", "valkey"]);
assert.deepEqual(initial.composeApps, ["homarr", "immich"]);
assert.deepEqual(initial.missing, initial.composeApps);
assert.deepEqual(initial.coveredDependencies, [{ appId: "postgresql", requiredBy: "immich", serviceId: "database" },
  { appId: "valkey", requiredBy: "immich", serviceId: "redis" }]);
assert.deepEqual(initial.gates, photos.data.gates);
assert.deepEqual(initial.acceptance, photos.data.acceptance);
assert.deepEqual(initial.unresolved, photos.data.unresolved);
assert.equal(JSON.stringify(photos), JSON.stringify(plan(["photos"])), "pure bridge does not mutate its plan");

const appOnly = sharedIntentSelection(plan(["--app", "immich", "--select", "control-plane=none"]), recipes);
assert.equal(appOnly.status, "ready");
assert.ok(!appOnly.selected.includes("homarr"), "explicit Advanced or app-only opt-out survives");
const composite = sharedIntentSelection(plan(["--goal", "photos", "--goal", "private-notes", "--compose"]), recipes);
assert.equal(composite.status, "ready");
assert.ok(composite.selected.includes("immich") && composite.selected.includes("docmost"));
assert.ok(sharedIntentSelection(plan(["Netflix"]), recipes).selected.includes("jellyfin"));
assert.deepEqual(sharedIntentSelection(plan(["docs"]), recipes).composeApps,
  ["homarr", "paperless-ngx"], "A short document goal must retain its actual service, not just Homarr");

const existing = sharedIntentSelection(photos.data, recipes, { ownerKind: "shared", existingAppIds: ["immich", "jellyfin"],
  existingRecipeSha256: { immich: recipes.find((item) => item.appId === "immich")!.recipeSha256 } });
assert.deepEqual(existing.retained, ["immich", "jellyfin"]);
assert.deepEqual(existing.missing, ["homarr"]);
assert.equal(sharedIntentSelection(photos.data, recipes, { ownerKind: "shared", existingAppIds: ["immich"] }).status,
  "blocked", "current source coverage cannot prove the older retained recipe");
const gaps = sharedIntentSelection(photos, recipes.filter((item) => item.appId !== "immich"));
assert.equal(gaps.status, "blocked");
assert.equal(gaps.gaps[0].appId, "immich");
assert.ok(gaps.selected.includes("immich"));
const reusedUnrecipe = sharedIntentSelection(photos, recipes.filter((item) => item.appId !== "immich"),
  { existingAppIds: ["immich"], ownerKind: "shared" });
assert.equal(reusedUnrecipe.status, "ready", "known retained unit is not reinstalled");
const explicitDatabase = sharedIntentSelection(plan(["--app", "immich", "--app", "postgresql", "--compose"]), recipes);
assert(explicitDatabase.composeApps.includes("postgresql"), "explicitly requested databases are never folded into another app");
assert.equal(sharedIntentSelection(photos, recipes, { ownerKind: "media" }).status, "blocked");
assert.equal(sharedIntentSelection(photos, recipes, { conflicts: ["unowned port collision"] }).status, "blocked");
const external = structuredClone(photos);
external.data.catalogSource = { kind: "external", executionAuthority: "read-only-declarative" };
assert.equal(sharedIntentSelection(external, recipes).gaps[0].kind, "external-catalog");
const stale = structuredClone(photos);
stale.data.projectContext = { planChanged: true };
assert.equal(sharedIntentSelection(stale, recipes).status, "blocked");
for (const args of [["photos and VPN", "--compose"], ["--goal", "photos", "--goal", "private-notes"]]) {
  const unresolved = sharedIntentSelection(plan(args, 3), recipes);
  assert.equal(unresolved.status, "blocked");
  assert.deepEqual(unresolved.selected, []);
  assert.equal(unresolved.gaps[0].kind, "resolution");
}
const privileged = structuredClone(photos);
privileged.data.gates.push("privilege", "public-exposure", "vpn");
assert.equal(sharedIntentSelection(privileged, recipes).status, "blocked");
const incomplete = structuredClone(photos);
incomplete.data.selectedApps = incomplete.data.selectedApps.filter((app: { id: string }) => app.id !== "valkey");
assert.throws(() => sharedIntentSelection(incomplete, recipes), /dependency coverage/);
assert.throws(() => sharedIntentSelection(photos, recipes, { existingAppIds: ["immich", "immich"] }), /existing app IDs/);

const empty: ProjectSnapshot = { root: projectRoot, apps: [], shared: [],
  owners: { project: false, cli: false, stack: false, appBatch: false, bundles: [], shared: [] } };
function savedProject(appIds: string[]): ProjectSnapshot {
  return { ...empty, shared: [{ id: "saved", stage: "completed", apps: appIds.map((id) => ({
    id, url: null, runtime: null, image: null,
    recipeSha256: recipes.find((recipe) => recipe.appId === id)?.recipeSha256 ?? null,
    update: { status: "unknown", registryImage: null }, limitations: [],
  })) }] };
}
async function route(value: unknown, snapshot = empty, available = recipes,
  review = true, added = true): Promise<Array<{ action: string; apps?: string[]; id?: string }>> {
  const calls: Array<{ action: string; apps?: string[]; id?: string }> = [];
  await continueSharedGoal(value, available, snapshot, {
    chooseProject: async (projects) => projects[projects.length - 1]!.id,
    review: async () => { calls.push({ action: "review" }); return review; },
    blocked: (details) => { assert(details.length > 0); calls.push({ action: "blocked" }); },
    resume: async (root) => { assert.equal(root, projectRoot); calls.push({ action: "resume" }); },
    create: async (root, apps) => { assert.equal(root, projectRoot); calls.push({ action: "create", apps }); },
    add: async (root, project, apps) => {
      assert.equal(root, projectRoot); calls.push({ action: "add", id: project.id, apps }); return added;
    },
    setup: async (root, id, apps) => { assert.equal(root, projectRoot); calls.push({ action: "setup", id, apps }); },
    homarr: async (root, id, apps) => { assert.equal(root, projectRoot); calls.push({ action: "homarr", id, apps }); },
  });
  return calls;
}
assert.deepEqual(await route(photos), [{ action: "review" }, { action: "create", apps: ["homarr", "immich"] }]);
assert.deepEqual(await route(photos, empty, recipes, false), [{ action: "review" }]);
assert.deepEqual(await route(photos, savedProject(["immich", "jellyfin"])), [
  { action: "review" }, { action: "add", id: "saved", apps: ["homarr"] },
  { action: "setup", id: "saved", apps: ["homarr", "immich"] },
  { action: "homarr", id: "saved", apps: ["immich", "jellyfin", "homarr"] },
], "Adding Homarr also resumes the retained Immich first-run checkpoint");
assert.deepEqual(await route(photos, savedProject(["immich"]), recipes, true, false),
  [{ action: "review" }, { action: "add", id: "saved", apps: ["homarr"] }]);
assert.deepEqual(await route(photos, savedProject(["homarr", "immich"])), [
  { action: "review" }, { action: "setup", id: "saved", apps: ["homarr", "immich"] },
  { action: "homarr", id: "saved", apps: ["homarr", "immich"] },
]);
const optedOut = plan(["--app", "immich", "--select", "control-plane=none"]);
assert.deepEqual(await route(optedOut, savedProject(["homarr", "immich"])), [
  { action: "review" }, { action: "setup", id: "saved", apps: ["immich"] },
], "Homarr opt-out retains its saved unit without publishing it");
assert.deepEqual(await route(composite, empty, recipes), [{ action: "blocked" }],
  "A selection projection is not the canonical planner report");
const combinedPlan = plan(["--goal", "photos", "--goal", "private-notes", "--compose"]);
const combinedCalls = await route(combinedPlan);
assert.deepEqual(combinedCalls[1]?.apps, ["docmost", "homarr", "immich"]);
for (const value of [external, stale, privileged]) {
  assert.deepEqual(await route(value), [{ action: "blocked" }]);
}
assert.deepEqual(await route(photos, empty, recipes.filter((recipe) => recipe.appId !== "immich")),
  [{ action: "blocked" }], "Missing app coverage never falls back into a legacy installer");
const unfinished = savedProject(["immich"]);
unfinished.shared[0]!.stage = "applying";
assert.deepEqual(await route(photos, unfinished), [{ action: "blocked" }]);
const legacy = { ...empty, owners: { ...empty.owners, cli: true } };
assert.deepEqual(await route(photos, legacy), [{ action: "blocked" }, { action: "resume" }]);
assert.deepEqual(await route(photos, { ...savedProject(["immich"]), owners: legacy.owners }),
  [{ action: "blocked" }], "Mixed owners require ownership review, not silent selection");
const multiple = savedProject(["jellyfin"]);
multiple.shared.push({ ...savedProject(["immich"]).shared[0]!, id: "chosen" });
assert.equal((await route(photos, multiple))[1]?.id, "chosen");
process.stdout.write("Canonical read-only plans, shared goal create/add/resume routing, retained delta and blocked boundaries passed; no runtime acceptance claimed.\n");
