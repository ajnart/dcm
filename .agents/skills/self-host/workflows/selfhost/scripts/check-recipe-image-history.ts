import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_DIRECTORY, loadAppRecipe, validateCatalogRecipes } from "./catalog.ts";

// Catalog source fixtures only: no Docker, HTTP, credentials, or saved project reads.
const appSource = join(CATALOG_DIRECTORY, "apps", "homarr");
const app = JSON.parse(await readFile(join(appSource, "manifest.json"), "utf8"));
const recipeRaw = await readFile(join(appSource, "recipe.json"), "utf8");
const recipe = JSON.parse(recipeRaw);
const historyRaw = await readFile(join(appSource, "recipe-image-history.json"), "utf8");
const history = JSON.parse(historyRaw);
const directory = await mkdtemp(join(tmpdir(), "selfhost-image-history-"));
const appDirectory = join(directory, "apps", "homarr");
const historyPath = join(appDirectory, "recipe-image-history.json");
const catalog = { apps: [app] };

async function rejects(change: (value: typeof history) => void) {
  const candidate = structuredClone(history);
  change(candidate);
  await writeFile(historyPath, JSON.stringify(candidate));
  await assert.rejects(loadAppRecipe(catalog, "homarr", directory), /recipe image history|Recipe image history/);
}

try {
  await mkdir(appDirectory, { recursive: true });
  await writeFile(join(appDirectory, "recipe.json"), recipeRaw);
  const absent = await loadAppRecipe(catalog, "homarr", directory);
  assert.equal(Object.hasOwn(absent, "previousRecipes"), false);
  assert.equal(Object.hasOwn(absent, "recipeImageHistorySha256"), false);
  assert.equal(await loadAppRecipe(catalog, "missing", directory), null);

  await writeFile(historyPath, historyRaw);
  const loaded = await loadAppRecipe(catalog, "homarr", directory);
  assert.deepEqual(loaded.previousRecipes.map((old) => old.services[0].imageTag), [
    "ghcr.io/homarr-labs/homarr-test:v2", "ghcr.io/homarr-labs/homarr-test:pr-6997",
  ]);
  const expected = structuredClone(recipe);
  Object.assign(expected.services[0], history.recipes[0].services[0]);
  assert.equal(JSON.stringify(loaded.previousRecipes[0]), JSON.stringify(expected));
  const historyHash = createHash("sha256").update(historyRaw).digest("hex");
  assert.equal(loaded.recipeImageHistorySha256, historyHash);
  const validated = await validateCatalogRecipes(catalog, directory);
  assert.deepEqual(validated.errors, []);
  assert.ok(validated.fingerprints.some(([id, hash]) => id === "homarr/recipe-image-history" && hash === historyHash));

  await rejects((value) => { value.recipes[0].sha256 = "0".repeat(64); });
  await rejects((value) => { value.appId = "other"; });
  await rejects((value) => { value.schemaVersion = 2; });
  await rejects((value) => { value.recipes[0].services[0].id = "other"; });
  await rejects((value) => { value.recipes[0].services = []; });
  await rejects((value) => { value.recipes[0].services.push(value.recipes[0].services[0]); });
  await rejects((value) => { value.recipes.push(value.recipes[0]); });
  await rejects((value) => { value.recipes = Array.from({ length: 17 }, () => value.recipes[0]); });
  await rejects((value) => { value.recipes[0].defaults = recipe.defaults; });
  await rejects((value) => { value.recipes[0].services[0].restart = "always"; });
  await rejects((value) => { value.recipes[0].services[0].imageTag = "ghcr.io/homarr-labs/homarr:latest"; });
  await rejects((value) => { value.recipes[0].services[0].imageSource = "http://example.invalid/image"; });

  await writeFile(historyPath, "{");
  await assert.rejects(loadAppRecipe(catalog, "homarr", directory), /Invalid recipe image history/);
  await unlink(historyPath);
  const linkedPath = join(directory, "history.json");
  await writeFile(linkedPath, historyRaw);
  await symlink(linkedPath, historyPath);
  await assert.rejects(loadAppRecipe(catalog, "homarr", directory), /Unsafe recipe image history/);
  console.log("PASS recipe image history: exact templates, hashes, inventory, bounds, and file safety");
} finally {
  await rm(directory, { recursive: true, force: true });
}
