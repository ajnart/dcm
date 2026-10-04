import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sharedPrestartRuntimeNames } from "../src/lib/shared-prestart.ts";

const repository = resolve(import.meta.dir, "../../..");
const lib = join(repository, "packages/cli/src/lib");
const temporary = await mkdtemp(join(tmpdir(), "shared-prestart-package-"));
const packageRoot = join(temporary, "package");
const references = join(packageRoot, "workflows/selfhost/references");
const catalog = join(references, "catalog");
const app = join(catalog, "apps/fixture");
const manifest = { services: [{ id: "fixture" }, { id: "undeclared" }] };

try {
  await mkdir(app, { recursive: true });
  await mkdir(join(catalog, "types"), { recursive: true });
  await cp(join(repository, ".agents/skills/self-host/workflows/selfhost/references/catalog/types/pre-start.ts"),
    join(catalog, "types/pre-start.ts"));
  const runtime = join(references, "prestart-runtime");
  await mkdir(runtime, { recursive: true });
  for (const name of sharedPrestartRuntimeNames) {
    let source = join(lib, name);
    if (name === "shared-project.ts") source = join(repository, "packages/cli/src", name);
    if (name === "setup-cloudflare-provider.ts") source = join(repository, "packages/cli/src/control-panel", name);
    await cp(source, join(runtime, name));
  }
  const metadata = { schemaVersion: 1, kind: "shared-pre-start-adapter", appId: "fixture",
    sourceFiles: ["pre-start.ts", "manifest.json"], effects: ["Fixture prerequisite"] };
  await writeFile(join(app, "pre-start-adapter.json"), JSON.stringify(metadata));
  await writeFile(join(app, "manifest.json"), JSON.stringify({ id: "fixture" }));
  await writeFile(join(app, "pre-start.ts"), 'export default {appId:"fixture",async verify(){throw new Error("must not execute")}};\n');
  await writeFile(join(app, "setup.ts"), 'export default {appId:"fixture"};\n');
  await writeFile(join(app, "setup.js"), 'export default {appId:"fixture"};\n');
  const adapterBuild = await Bun.build({ entrypoints: [join(app, "pre-start.ts")],
    target: "node", outdir: app, naming: "pre-start.js" });
  assert(adapterBuild.success, JSON.stringify(adapterBuild.logs));
  await mkdir(join(catalog, "apps/undeclared"));
  await writeFile(join(catalog, "apps/undeclared/pre-start.js"), 'throw new Error("undeclared executed");\n');
  for (const name of ["first", "second"]) {
    const built = await Bun.build({ entrypoints: [join(lib, "shared-prestart.ts")],
      target: "node", outdir: packageRoot, naming: `${name}.js` });
    assert(built.success, JSON.stringify(built.logs));
  }
  // A separately bundled app imports the same production context/authority module.
  const consumer = join(temporary, "app-consumer.ts");
  await writeFile(consumer, `export {sharedPrestartContracts,sharedPrestartContext,assertSharedPrestartAuthority} from ${JSON.stringify(join(lib, "shared-prestart.ts"))};\n`);
  const appBuild = await Bun.build({ entrypoints: [consumer], target: "node", outdir: app, naming: "consumer.js" });
  assert(appBuild.success, JSON.stringify(appBuild.logs));
  const composeScripts = join(packageRoot, "workflows/selfhost-compose/scripts");
  const composeBuild = await Bun.build({ entrypoints: [consumer], target: "node",
    outdir: composeScripts, naming: "pre-start-check.js" });
  assert(composeBuild.success, JSON.stringify(composeBuild.logs));
  const first = await import(pathToFileURL(join(packageRoot, "first.js")).href);
  const second = await import(pathToFileURL(join(packageRoot, "second.js")).href);
  const appConsumer = await import(pathToFileURL(join(app, "consumer.js")).href);
  const composeConsumer = await import(pathToFileURL(join(composeScripts, "pre-start-check.js")).href);
  const reviewed = first.sharedPrestartContracts(manifest);
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0].appId, "fixture");
  assert.deepEqual(second.sharedPrestartContracts(manifest), reviewed);
  assert.deepEqual(appConsumer.sharedPrestartContracts(manifest), reviewed);
  assert.deepEqual(composeConsumer.sharedPrestartContracts(manifest), reviewed);
  for (const path of [join(packageRoot, "first.js"), join(packageRoot, "second.js"),
    join(app, "consumer.js"), join(composeScripts, "pre-start-check.js")]) {
    const result = spawnSync("node", ["--input-type=module", "-e",
      "const loaded = await import(process.argv[1]); const fs = await import('node:fs'); fs.writeSync(1,JSON.stringify(loaded.sharedPrestartContracts(JSON.parse(process.argv[2]))));",
      pathToFileURL(path).href, JSON.stringify(manifest)], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim(), JSON.stringify({ path, stderr: result.stderr, status: result.status, error: result.error }));
    assert.deepEqual(JSON.parse(result.stdout), reviewed);
  }
  assert.deepEqual(first.sharedPrestartContracts(manifest, ["undeclared"]), []);
  for (const path of [join(app, "pre-start.ts"), join(app, "pre-start.js"), join(app, "setup.js"),
    join(app, "pre-start-adapter.json"), join(catalog, "types/pre-start.ts")]) {
    const before = await readFile(path);
    await writeFile(path, Buffer.concat([before, Buffer.from("\n")]));
    assert.notEqual(first.sharedPrestartContracts(manifest)[0].sourceSha256, reviewed[0].sourceSha256);
    assert.deepEqual(second.sharedPrestartContracts(manifest), first.sharedPrestartContracts(manifest));
    assert.deepEqual(appConsumer.sharedPrestartContracts(manifest), first.sharedPrestartContracts(manifest));
    assert.deepEqual(composeConsumer.sharedPrestartContracts(manifest), first.sharedPrestartContracts(manifest));
    await writeFile(path, before);
    assert.deepEqual(first.sharedPrestartContracts(manifest), reviewed);
  }
  // A loaded helper graph cannot approve changed canonical bytes over cached code.
  for (const name of sharedPrestartRuntimeNames) {
    const path = join(runtime, name);
    const before = await readFile(path);
    await writeFile(path, Buffer.concat([before, Buffer.from("\n")]));
    for (const consumer of [first, second, appConsumer, composeConsumer]) {
      assert.throws(() => consumer.sharedPrestartContracts(manifest), /differs/);
    }
    await writeFile(path, before);
    for (const consumer of [first, second, appConsumer, composeConsumer]) {
      assert.deepEqual(consumer.sharedPrestartContracts(manifest), reviewed);
    }
  }
  const executable = join(app, "pre-start.js");
  const bytes = await readFile(executable);
  await rm(executable);
  assert.throws(() => first.sharedPrestartContracts(manifest));
  await symlink(join(app, "pre-start.ts"), executable);
  assert.throws(() => first.sharedPrestartContracts(manifest), /differs/);
  await rm(executable);
  await writeFile(executable, bytes);
  await writeFile(join(app, "pre-start-adapter.json"), JSON.stringify({ ...metadata, executable: "outside.js" }));
  assert.throws(() => first.sharedPrestartContracts(manifest), /differs/);
  console.log("PASS pre-start package identity across CLI/app bundles, exact source/executable hashes and bounded discovery");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
