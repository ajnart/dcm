import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import gotify from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/gotify/recipe.json";
import { deriveSharedRecipe, bindSharedDerivedRecipe, deriveSharedCreateRecipe,
  bindSharedCreateRecipe } from "../src/lib/shared-derived-recipe.ts";
import { prepareSharedDerivedRecipeBinding, loadSharedDerivedRecipeBindingSync } from "../src/lib/shared-derived-recipe-state.ts";
import { restoreSavedSharedSelection, requireSavedSharedGeneratedRecipes } from "../src/lib/shared-saved-recipe.ts";
import { sharedProjectCandidate, type SharedAppSelection } from "../src/lib/shared-compose-project.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const temporary = await mkdtemp(join(tmpdir(), "derived-state-fixture-"));
const observed = { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] };
const base: SharedAppSelection = { appId: "gotify", recipe: gotify, port: 18080,
  images: { gotify: `gotify/server:3.1.1@sha256:${"a".repeat(64)}` } };
function owner(root: string, apps: SharedAppSelection[], revision: number, previousHash: string | null,
  phase: "reviewed" | "completed"): SharedProjectState {
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "fixture", dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "UTC", apps, observed });
  const { ownership: _ignored, ...project } = candidate.manifest.project;
  const record = { schemaVersion: 1 as const, revision, manifestRevision: revision, previousHash,
    project, manifest: candidate.manifest, manifestHash: hash(candidate.manifest), units: candidate.units,
    selectionFingerprints: candidate.selectionFingerprints, settings: candidate.settings,
    checkpoint: { operation: "add" as const, phase, appIds: apps.filter((app) => app.appId !== "gotify").map((app) => app.appId) } };
  return { ...record, recordHash: hash(record) };
}
async function revision(state: SharedProjectState) {
  const directory = join(state.project.directory, "state");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(state.project.directory, 0o700);
  await writeFile(join(directory, `revision-${String(state.revision).padStart(6, "0")}.json`),
    JSON.stringify(state) + "\n", { mode: 0o600 });
}
try {
  for (const input of [{ appId: "haproxy", inputs: { "target-app-id": "gotify" } },
    { appId: "headscale", inputs: { "canonical-origin": "https://headscale.example.test", "magic-dns-domain": "mesh.example.test" } }]) {
    const source = owner(join(temporary, input.appId), [base], 1, null, "completed");
    await revision(source);
    const derived = deriveSharedRecipe(source, input);
    const selection: SharedAppSelection = { appId: input.appId, recipe: derived.recipe, port: 18081,
      images: { [input.appId]: `${derived.recipe.services[0].imageTag}@sha256:${"b".repeat(64)}` } };
    const binding = bindSharedDerivedRecipe(source, input, selection);
    const path = await prepareSharedDerivedRecipeBinding(source, binding);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.deepEqual(loadSharedDerivedRecipeBindingSync(source.project.directory, input.appId), binding);
    assert.equal(await prepareSharedDerivedRecipeBinding(source, binding), path);
    const reviewed = owner(join(temporary, input.appId), [base, selection], 2, source.recordHash, "reviewed");
    await revision(reviewed);
    assert.equal(await prepareSharedDerivedRecipeBinding(reviewed, binding), path);
    const noStaticRecipe = (_appId: string): never => { throw new Error("must not request a fake static recipe"); };
    assert.deepEqual(restoreSavedSharedSelection(reviewed, input.appId, noStaticRecipe), selection);
    requireSavedSharedGeneratedRecipes(reviewed, noStaticRecipe);
    const wrongOwner = { ...reviewed, project: { ...reviewed.project, owner: "other" } };
    await assert.rejects(prepareSharedDerivedRecipeBinding(wrongOwner, binding), /differs/);
    const stale = structuredClone(binding); stale.derived.sourceSha256 = "f".repeat(64);
    const { bindingHash: _oldHash, ...staleRecord } = stale; stale.bindingHash = hash(staleRecord);
    await assert.rejects(prepareSharedDerivedRecipeBinding(source, stale), /differs/);
    assert.deepEqual(loadSharedDerivedRecipeBindingSync(source.project.directory, input.appId), binding);
    const bytes = await readFile(path, "utf8");
    assert(!bytes.includes("fixture-secret-payload"));
    assert(!bytes.includes('"secretPayload"'));
    assert.throws(() => deriveSharedRecipe(source, { appId: input.appId,
      inputs: { ...input.inputs, password: "fixture-secret-payload" } }));
    await chmod(path, 0o644);
    assert.throws(() => restoreSavedSharedSelection(reviewed, input.appId, noStaticRecipe), /unsafe/);
    await chmod(path, 0o600);

    // Two independently bundled consumers share a source identity outside the checkout.
    const packageDirectory = join(temporary, `package-${input.appId}`);
    const evidenceRoot = join(packageDirectory, "workflows", "selfhost", "references");
    const repository = resolve(import.meta.dir, "../../..");
    const catalog = join(repository, ".agents/skills/self-host/workflows/selfhost/references/catalog");
    for (const name of ["shared-derived-recipe.ts", "shared-derived-recipe-loader.ts", "shared-derived-recipe-state.ts", "shared-service-target.ts",
      "shared-compose-project.ts", "shared-saved-recipe.ts", "shared-https-proxy-profile.ts"]) {
      const target = join(evidenceRoot, "derived-recipe-runtime", name);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(repository, "packages/cli/src/lib", name), target);
    }
    for (const name of ["apps/haproxy/derived-recipe.ts", "apps/haproxy/derived-recipe-adapter.json", "apps/haproxy/configuration.ts", "apps/haproxy/manifest.json",
      "apps/headscale/derived-recipe.ts", "apps/headscale/derived-recipe-adapter.json", "apps/headscale/config.ts", "apps/headscale/manifest.json",
      "apps/minio/derived-recipe.ts", "apps/minio/derived-recipe-adapter.json", "apps/minio/configuration.ts", "apps/minio/manifest.json",
      "apps/minio/setup.ts", "apps/minio/s3-auth.ts", "types/derived-recipe.ts", "types/domain-policy.ts"]) {
      const target = join(evidenceRoot, "catalog", name);
      await mkdir(dirname(target), { recursive: true }); await copyFile(join(catalog, name), target);
    }
    for (const appId of ["haproxy", "headscale", "minio"]) {
      const built = await Bun.build({ entrypoints: [join(catalog, "apps", appId, "derived-recipe.ts")],
        target: "node", outdir: join(evidenceRoot, "catalog/apps", appId), naming: "derived-recipe.js" });
      assert(built.success, JSON.stringify(built.logs));
    }
    // Packaged approval binds actual compiled bytes, not just the checkout's source evidence.
    const approvalBuild = await Bun.build({ entrypoints: [join(repository, "packages/cli/src/lib/shared-derived-recipe.ts")],
      target: "node", outdir: packageDirectory, naming: "approval.js" });
    assert(approvalBuild.success, JSON.stringify(approvalBuild.logs));
    const packagedApproval = await import(pathToFileURL(join(packageDirectory, "approval.js")).href);
    const packagedBinding = packagedApproval.bindSharedDerivedRecipe(source, input, selection);
    assert.notEqual(packagedBinding.derived.sourceSha256, binding.derived.sourceSha256);
    // This disposable fixture represents the separately reviewed installed-package record.
    await writeFile(path, JSON.stringify(packagedBinding) + "\n", { mode: 0o600 });
    const results: string[] = [];
    for (const name of ["first", "second"]) {
      const output = join(packageDirectory, `${name}.js`);
      const built = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/derived-recipe-package-consumer.ts")],
        target: "node", outdir: packageDirectory, naming: `${name}.js` });
      assert(built.success, JSON.stringify(built.logs));
      const processResult = Bun.spawnSync([process.execPath, output, source.project.directory, input.appId]);
      assert.equal(processResult.exitCode, 0, processResult.stderr.toString());
      results.push(processResult.stdout.toString().trim());
    }
    assert.equal(results[0], results[1]);
    assert.equal(JSON.parse(results[0]!).sourceSha256, packagedBinding.derived.sourceSha256);
    let unrelatedPath = join(evidenceRoot, "catalog/apps/headscale/config.ts");
    let driftPath = join(evidenceRoot, "catalog/apps/haproxy/configuration.ts");
    if (input.appId === "headscale") {
      unrelatedPath = join(evidenceRoot, "catalog/apps/haproxy/configuration.ts");
      driftPath = join(evidenceRoot, "catalog/apps/headscale/config.ts");
    }
    await writeFile(unrelatedPath, (await readFile(unrelatedPath, "utf8")) + "\n// unrelated fixture source drift\n");
    const unrelated = Bun.spawnSync([process.execPath, join(packageDirectory, "first.js"), source.project.directory, input.appId]);
    assert.equal(unrelated.exitCode, 0, unrelated.stderr.toString());
    assert.equal(JSON.parse(unrelated.stdout.toString()).sourceSha256, packagedBinding.derived.sourceSha256);
    await writeFile(driftPath, (await readFile(driftPath, "utf8")) + "\n// fixture source drift\n");
    const drift = Bun.spawnSync([process.execPath, join(packageDirectory, "first.js"), source.project.directory, input.appId]);
    assert.notEqual(drift.exitCode, 0);
  }
  for (const input of [{ appId: "headscale", inputs: { "canonical-origin": "https://headscale.example.test", "magic-dns-domain": "mesh.example.test" } },
    { appId: "haproxy", inputs: { "target-app-id": "gotify" } }]) {
    let peers: SharedAppSelection[] = [];
    if (input.appId === "haproxy") peers = [base];
    const root = join(temporary, `fresh-${input.appId}`);
    const source = { projectRoot: root, projectId: "fixture", dockerContext: "default",
      uid: 1000, gid: 1000, timezone: "UTC", apps: peers, observed };
    const derived = deriveSharedCreateRecipe(source, input);
    const selection: SharedAppSelection = { appId: input.appId, recipe: derived.recipe, port: 18081,
      images: { [input.appId]: `${derived.recipe.services[0].imageTag}@sha256:${"b".repeat(64)}` } };
    const binding = bindSharedCreateRecipe(source, input, selection);
    const reviewed = owner(root, [...peers, selection], 1, null, "reviewed");
    reviewed.checkpoint = { operation: "create", phase: "reviewed", appIds: Object.keys(reviewed.units).sort() };
    const { recordHash: _old, ...record } = reviewed; reviewed.recordHash = hash(record);
    // Saving the binding requires an actual retained revision 1, not only an
    // in-memory self-asserted planning object.
    await assert.rejects(prepareSharedDerivedRecipeBinding(reviewed, binding));
    await revision(reviewed);
    const path = await prepareSharedDerivedRecipeBinding(reviewed, binding);
    assert.deepEqual(loadSharedDerivedRecipeBindingSync(reviewed.project.directory, input.appId, reviewed), binding);
    assert.equal(await prepareSharedDerivedRecipeBinding(reviewed, binding), path);
    const recipeLess = (_id: string): never => { throw new Error("no fake static recipe"); };
    assert.deepEqual(restoreSavedSharedSelection(reviewed, input.appId, recipeLess), selection);
    const completed = structuredClone(reviewed);
    completed.revision = 2; completed.previousHash = reviewed.recordHash;
    completed.checkpoint.phase = "completed";
    const { recordHash: _next, ...completedRecord } = completed; completed.recordHash = hash(completedRecord);
    await revision(completed);
    assert.deepEqual(restoreSavedSharedSelection(completed, input.appId, recipeLess), selection);
    await assert.rejects(prepareSharedDerivedRecipeBinding(completed, binding), /differs/);
    const wrongInitial = structuredClone(reviewed);
    wrongInitial.checkpoint.operation = "add";
    const { recordHash: _bad, ...wrongRecord } = wrongInitial; wrongInitial.recordHash = hash(wrongRecord);
    await revision(wrongInitial);
    assert.throws(() => loadSharedDerivedRecipeBindingSync(reviewed.project.directory, input.appId, completed), /differs/);
    await revision(reviewed);
    await chmod(path, 0o644);
    assert.throws(() => restoreSavedSharedSelection(completed, input.appId, recipeLess), /unsafe/);
  }
  console.log("Saved derived recipes: private immutable revisions, recipe-less restoration and stable packaged source hashes: pass");
} finally { await rm(temporary, { recursive: true, force: true }); }
