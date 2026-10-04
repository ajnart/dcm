import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sharedDerivedRecipeAdapters } from "../src/lib/shared-derived-recipe.ts";

const repository = resolve(import.meta.dir, "../../..");
const catalog = join(repository, ".agents/skills/self-host/workflows/selfhost/references/catalog");
const lib = join(repository, "packages/cli/src/lib");
const enabled = ["archive-team-warrior", "authelia", "cloudflare-tunnel", "gluetun", "haproxy", "headscale",
  "minio", "netbird", "pangolin", "passbolt", "stalwart-mail", "wud"];
assert.deepEqual(sharedDerivedRecipeAdapters().map((adapter) => adapter.appId), enabled);
const temporary = await mkdtemp(join(tmpdir(), "derived-discovery-"));
const runtimeFiles = ["shared-derived-recipe.ts", "shared-derived-recipe-loader.ts", "shared-derived-recipe-state.ts",
  "shared-service-target.ts", "shared-compose-project.ts", "shared-saved-recipe.ts", "shared-https-proxy-profile.ts"];
const input = { appId: "headscale", inputs: {
  "canonical-origin": "https://headscale.example.test", "magic-dns-domain": "mesh.example.test" } };
const source = { projectRoot: "/tmp/derived-discovery-owner", projectId: "fixture", dockerContext: "default",
  uid: 1000, gid: 1000, timezone: "UTC", apps: [],
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } };
try {
  // Source-mode discovery uses only the sandbox's catalog, including undeclared staged code.
  const sourceRoot = join(temporary, "source");
  const sourceLib = join(sourceRoot, "packages/cli/src/lib");
  const sourceCatalog = join(sourceRoot, ".agents/skills/self-host/workflows/selfhost/references/catalog");
  await cp(lib, sourceLib, { recursive: true });
  await cp(catalog, sourceCatalog, { recursive: true });
  await symlink(join(repository, "packages/cli/node_modules"), join(sourceRoot, "packages/cli/node_modules"), "dir");
  const sourceModule = await import(pathToFileURL(join(sourceLib, "shared-derived-recipe.ts")).href);
  assert.deepEqual(sourceModule.sharedDerivedRecipeAdapters().map((adapter: any) => adapter.appId), enabled);
  const reviewed = sourceModule.deriveSharedCreateRecipe(source, input);
  const sourceDeclaration = join(sourceCatalog, "apps/headscale/derived-recipe-adapter.json");
  const declarationBytes = await readFile(sourceDeclaration);
  await writeFile(sourceDeclaration, Buffer.concat([declarationBytes, Buffer.from("\n")]));
  assert.throws(() => sourceModule.deriveSharedCreateRecipe(source, input), /differs/);
  await writeFile(sourceDeclaration, declarationBytes);
  assert.equal(sourceModule.deriveSharedCreateRecipe(source, input).sourceSha256, reviewed.sourceSha256);

  // An unchanged adapter entry must not approve new dependency bytes over a cached config module.
  const configPath = join(sourceCatalog, "apps/headscale/config.ts");
  const configBytes = await readFile(configPath, "utf8");
  await writeFile(configPath, configBytes.replace("server_url:", "changed_server_url:"));
  const changedConsumerPath = join(sourceLib, "derived-dependency-drift-consumer.ts");
  await cp(join(sourceLib, "shared-derived-recipe-loader.ts"), join(sourceLib, "derived-consumer-loader.ts"));
  const consumerSource = (await readFile(join(sourceLib, "shared-derived-recipe.ts"), "utf8"))
    .replace("./shared-derived-recipe-loader.ts", "./derived-consumer-loader.ts");
  await writeFile(changedConsumerPath, consumerSource);
  const newConsumer = pathToFileURL(changedConsumerPath);
  await assert.rejects(import(newConsumer.href), /differs/);
  await writeFile(configPath, configBytes);
  const unchangedConsumerPath = join(sourceLib, "derived-unchanged-consumer.ts");
  await writeFile(unchangedConsumerPath, consumerSource);
  const unchangedConsumer = pathToFileURL(unchangedConsumerPath);
  const unchangedSource = await import(unchangedConsumer.href);
  assert.equal(unchangedSource.deriveSharedCreateRecipe(source, input).sourceSha256, reviewed.sourceSha256);

  const packageRoot = join(temporary, "package");
  const references = join(packageRoot, "workflows/selfhost/references");
  const packageCatalog = join(references, "catalog");
  await cp(catalog, packageCatalog, { recursive: true });
  const runtime = join(references, "derived-recipe-runtime");
  await mkdir(runtime, { recursive: true });
  for (const name of runtimeFiles) await cp(join(lib, name), join(runtime, name));
  // Stage a non-opted-in executable that would throw if automatically imported.
  await mkdir(join(packageCatalog, "apps/sonarr"), { recursive: true });
  await writeFile(join(packageCatalog, "apps/sonarr/derived-recipe.js"), 'throw new Error("undeclared adapter executed");\n');
  for (const appId of enabled) {
    const built = await Bun.build({ entrypoints: [join(catalog, `apps/${appId}/derived-recipe.ts`)],
      target: "node", outdir: join(packageCatalog, "apps", appId), naming: "derived-recipe.js" });
    assert(built.success, JSON.stringify(built.logs));
  }
  for (const name of ["first", "second"]) {
    const built = await Bun.build({ entrypoints: [join(lib, "shared-derived-recipe.ts")], target: "node",
      outdir: packageRoot, naming: `${name}.js` });
    assert(built.success, JSON.stringify(built.logs));
  }
  const first = await import(pathToFileURL(join(packageRoot, "first.js")).href);
  const second = await import(pathToFileURL(join(packageRoot, "second.js")).href);
  assert.deepEqual(first.sharedDerivedRecipeAdapters().map((adapter: any) => adapter.appId), enabled);
  const packaged = first.deriveSharedCreateRecipe(source, input);
  assert.equal(second.deriveSharedCreateRecipe(source, input).sourceSha256, packaged.sourceSha256);
  assert.notEqual(packaged.sourceSha256, reviewed.sourceSha256); // Compiled executable is separately bound.
  for (const name of ["derived-recipe.js", "derived-recipe-adapter.json", "config.ts"]) {
    const path = join(packageCatalog, "apps/headscale", name);
    const before = await readFile(path);
    await writeFile(path, Buffer.concat([before, Buffer.from("\n")]));
    assert.throws(() => first.deriveSharedCreateRecipe(source, input), /differs/);
    await writeFile(path, before);
  }
  // No checkout fallback when the installed executable is absent or linked elsewhere.
  const executable = join(packageCatalog, "apps/headscale/derived-recipe.js");
  const executableBytes = await readFile(executable);
  await rm(executable);
  assert.throws(() => first.deriveSharedCreateRecipe(source, input));
  await symlink(join(catalog, "apps/headscale/derived-recipe.ts"), executable);
  assert.throws(() => first.deriveSharedCreateRecipe(source, input), /differs/);
  await rm(executable);
  await writeFile(executable, executableBytes);
  const declaration = join(packageCatalog, "apps/headscale/derived-recipe-adapter.json");
  await writeFile(declaration, JSON.stringify({ schemaVersion: 1, kind: "shared-derived-recipe-adapter",
    appId: "headscale", executable: "../../outside.js" }));
  assert.throws(() => first.deriveSharedCreateRecipe(source, input), /differs/);
  console.log("Derived discovery: explicit source/package opt-in, exact executable/metadata hashes and warm drift rejection: pass");
} finally { await rm(temporary, { recursive: true, force: true }); }
