import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CATALOG_DIRECTORY, loadAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";

const canonical = join(CATALOG_DIRECTORY, "apps", "immich");
const app = JSON.parse(await readFile(join(canonical, "manifest.json"), "utf8"));
const composition = JSON.parse(await readFile(join(canonical, "composition.json"), "utf8"));
const root = resolve(await mkdtemp(join(tmpdir(), "selfhost-composition-")));
const directory = join(root, "apps", "immich");
try {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "recipe.json"), await readFile(join(canonical, "recipe.json")));
  const path = join(directory, "composition.json");
  const load = () => loadAppRecipe({ apps: [app] }, "immich", root);
  const unannotated = await load();
  assert.deepEqual(unannotated.bundledDependencies, []);
  await writeFile(path, JSON.stringify(composition));
  const annotated = await load();
  assert.deepEqual(annotated.bundledDependencies, composition.dependencies);
  assert.equal(annotated.sha256, unannotated.sha256, "selection metadata does not replace immutable recipe bytes");
  const recipePath = join(directory, "recipe.json");
  const originalRecipe = await readFile(recipePath, "utf8");
  const structuredRecipe = JSON.parse(originalRecipe);
  structuredRecipe.services.find((service: any) => service.id === "immich").dependsOn =
    structuredRecipe.services.find((service: any) => service.id === "immich").dependsOn.map((service: string) =>
      ({ service, condition: "service_started" }));
  const structuredRaw = JSON.stringify(structuredRecipe);
  const structuredComposition = { ...composition,
    recipeSha256: createHash("sha256").update(structuredRaw).digest("hex") };
  await writeFile(recipePath, structuredRaw);
  await writeFile(path, JSON.stringify(structuredComposition));
  assert.deepEqual((await load()).bundledDependencies, composition.dependencies,
    "Structured dependsOn carries the same proven private dependency as string syntax");
  structuredRecipe.services.find((service: any) => service.id === "immich").dependsOn = [];
  const missingRaw = JSON.stringify(structuredRecipe);
  await writeFile(recipePath, missingRaw);
  await writeFile(path, JSON.stringify({ ...composition,
    recipeSha256: createHash("sha256").update(missingRaw).digest("hex") }));
  await assert.rejects(load(), /coverage/, "An absent required dependency stays unproven");
  await writeFile(recipePath, originalRecipe);
  for (const mutate of [(value: any) => { value.recipeSha256 = "a".repeat(64); },
    (value: any) => { value.dependencies[0].serviceId = "immich"; },
    (value: any) => { value.dependencies[0].appId = "homarr"; },
    (value: any) => { value.dependencies[0].officialUrl = "https://example.test/unowned"; },
    (value: any) => { value.dependencies.push(value.dependencies[0]); },
    (value: any) => { value.unreviewed = true; }]) {
    const changed = structuredClone(composition); mutate(changed);
    await writeFile(path, JSON.stringify(changed));
    await assert.rejects(load(), /Composition|coverage/);
  }
  await rm(path);
  await symlink(join(canonical, "composition.json"), path);
  await assert.rejects(load(), /Unsafe/);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("Source-bound bundled dependency metadata and fail-closed recipe drift: pass");
