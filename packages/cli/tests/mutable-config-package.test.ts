import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mutableConfigRuntimeNames } from "../src/lib/mutable-config.ts";

const repository = resolve(import.meta.dir, "../../..");
const lib = join(repository, "packages/cli/src/lib");
const temporary = await mkdtemp(join(tmpdir(), "mutable-config-package-"));
const packageRoot = join(temporary, "package");
const references = join(packageRoot, "workflows/selfhost/references");
const catalog = join(references, "catalog");
const runtime = join(references, "mutable-config-runtime");
const app = join(catalog, "apps/fixture");
const source = "https://fixture.invalid/config";
const image = `fixture/app@sha256:${"a".repeat(64)}`;
const uid = process.getuid!();
const types = ["mutable-config.ts", "private-config-environment.ts", "manual-job.ts", "private-identity.ts"];
const recipe = { appId: "fixture", source, privateFiles: [],
  mutableConfigs: [{ id: "settings", filename: "settings.json", officialUrl: source,
    hook: "./mutable-config.ts", containerUid: uid,
    containerUidEvidence: { image, uid, officialUrl: source },
    sourceFiles: ["mutable-config.ts", "configuration.ts", "recipe.json"] }],
  services: [{ id: "fixture", user: String(uid), imageTag: image, mounts: [
    { kind: "mutable-directory", name: "settings", fileId: "settings", target: "/settings" },
  ] }] };

try {
  await mkdir(app, { recursive: true });
  await mkdir(join(catalog, "types"), { recursive: true });
  for (const name of types) {
    await cp(join(repository, ".agents/skills/self-host/workflows/selfhost/references/catalog/types", name),
      join(catalog, "types", name));
  }
  await mkdir(runtime, { recursive: true });
  for (const name of mutableConfigRuntimeNames) await cp(join(lib, name), join(runtime, name));
  await writeFile(join(app, "recipe.json"), JSON.stringify(recipe));
  await writeFile(join(app, "configuration.ts"), 'export const initial={enabled:false};\n');
  await writeFile(join(app, "mutable-config.ts"), `import {initial} from './configuration.ts';
export const mutableConfigHook={async initialize(){return JSON.stringify(initial)},async validate(content){
const value=JSON.parse(content);if(typeof value.enabled!=='boolean')throw new Error('invalid fixture config');}};\n`);
  const adapter = await Bun.build({ entrypoints: [join(app, "mutable-config.ts")],
    target: "node", outdir: app, naming: "mutable-config.js" });
  assert(adapter.success, JSON.stringify(adapter.logs));
  const consumer = join(temporary, "consumer.ts");
  await writeFile(consumer, `export {prepareMutableConfigs,verifyMutableConfigs,mutableConfigSourceHash,requireMutableConfigNamespace} from ${JSON.stringify(join(lib, "mutable-config.ts"))};\n`);
  const paths = [join(packageRoot, "app.js"), join(packageRoot, "bundle.js"),
    join(app, "consumer.js"), join(packageRoot, "workflows/selfhost-compose/scripts/mutable-config.js")];
  for (const path of paths) {
    let target: "node" | "bun" = "node";
    let entrypoint = consumer;
    if (path.endsWith("/selfhost-compose/scripts/mutable-config.js")) {
      target = "bun";
      entrypoint = join(repository, ".agents/skills/self-host/workflows/selfhost-compose/scripts/mutable-config.ts");
    }
    const built = await Bun.build({ entrypoints: [entrypoint], target,
      outdir: resolve(path, ".."), naming: path.split("/").at(-1)! });
    assert(built.success, JSON.stringify(built.logs));
  }
  const consumers = await Promise.all(paths.map((path) => import(pathToFileURL(path).href)));
  const reviewed = consumers[0].mutableConfigSourceHash(recipe);
  assert.match(reviewed, /^[a-f0-9]{64}$/);
  for (const loaded of consumers) assert.equal(loaded.mutableConfigSourceHash(recipe), reviewed);

  // Fresh Node CLI and Bun owner processes use the installed catalog only.
  for (let index = 0; index < paths.length; index++) {
    let executable = "node";
    if (index === paths.length - 1) executable = process.execPath;
    const result = spawnSync(executable, ["--input-type=module", "-e",
      "const loaded=await import(process.argv[1]);const fs=await import('node:fs');fs.writeSync(1,loaded.mutableConfigSourceHash(JSON.parse(process.argv[2])));",
      pathToFileURL(paths[index]).href, JSON.stringify(recipe)], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, reviewed);
  }
  const data = join(temporary, "data");
  await mkdir(data, { mode: 0o700 });
  await consumers[0].prepareMutableConfigs(recipe, data, join(temporary, "unused-private-files"));
  const state = join(data, "mutable-configs/settings/settings.json");
  assert.equal((await lstat(state)).mode & 0o777, 0o600);
  await writeFile(state, '{"enabled":true}\n', { mode: 0o600 });
  const inode = (await lstat(state)).ino;
  for (const loaded of consumers) {
    await loaded.verifyMutableConfigs(recipe, data, join(temporary, "unused-private-files"));
    await loaded.prepareMutableConfigs(recipe, data, join(temporary, "unused-private-files"));
    assert.equal(await readFile(state, "utf8"), '{"enabled":true}\n');
    assert.equal((await lstat(state)).ino, inode);
  }
  const lateBuild = await Bun.build({ entrypoints: [consumer], target: "node",
    outdir: packageRoot, naming: "late.js" });
  assert(lateBuild.success, JSON.stringify(lateBuild.logs));
  const late = await import(pathToFileURL(join(packageRoot, "late.js")).href);
  const warmAndLate = [...consumers, late];

  // Real helper through a fixture-owned executable; never contact a daemon.
  const fakeBin = join(temporary, "fake-bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "docker"), `#!/usr/bin/env node
const {writeSync}=require('node:fs');
const args=process.argv.slice(2);
if(args[0]==='context'&&args[1]==='inspect'){
 let endpoint='unix:///var/run/docker.sock';
 if(args[2]==='rootless')endpoint='unix:///run/user/'+process.getuid()+'/docker.sock';
 writeSync(1,JSON.stringify(endpoint));process.exit(0);
}
if(args[0]==='--context'&&args[2]==='info'){
 const mode=process.env.MUTABLE_NAMESPACE_FIXTURE;
 if(mode==='failed')process.exit(1);
 const values={rootful:[],rootless:['name=rootless'],userns:['name=userns'],nonarray:{},malformed:'not json'};
 if(mode==='malformed')writeSync(1,values[mode]);
 else writeSync(1,JSON.stringify(values[mode]));
 process.exit(0);
}
process.exit(2);
`, { mode: 0o700 });
  const savedEnvironment = new Map(["PATH", "DOCKER_HOST", "DOCKER_CONTEXT", "MUTABLE_NAMESPACE_FIXTURE"]
    .map((name) => [name, process.env[name]]));
  try {
    process.env.PATH = `${fakeBin}:${process.env.PATH}`;
    delete process.env.DOCKER_HOST;
    delete process.env.DOCKER_CONTEXT;
    for (const loaded of consumers) {
      process.env.MUTABLE_NAMESPACE_FIXTURE = "rootful";
      assert.doesNotThrow(() => loaded.requireMutableConfigNamespace(recipe, "default"));
      assert.throws(() => loaded.requireMutableConfigNamespace(recipe, "rootless"));
      for (const mode of ["rootless", "userns", "failed", "nonarray", "malformed"]) {
        process.env.MUTABLE_NAMESPACE_FIXTURE = mode;
        assert.throws(() => loaded.requireMutableConfigNamespace(recipe, "default"));
      }
    }
  } finally {
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  // Cached consumers cannot reapprove new source bytes over old executable code.
  for (const path of [join(app, "mutable-config.ts"), join(app, "configuration.ts"),
    join(app, "mutable-config.js"), join(app, "recipe.json"),
    ...types.map((name) => join(catalog, "types", name)),
    ...mutableConfigRuntimeNames.map((name) => join(runtime, name))]) {
    const before = await readFile(path);
    await writeFile(path, Buffer.concat([before, Buffer.from("\n")]));
    for (const loaded of warmAndLate) {
      assert.throws(() => loaded.mutableConfigSourceHash(recipe));
      await assert.rejects(loaded.prepareMutableConfigs(recipe, data, join(temporary, "unused-private-files")));
    }
    assert.equal(await readFile(state, "utf8"), '{"enabled":true}\n');
    await writeFile(path, before);
    for (const loaded of warmAndLate) assert.equal(loaded.mutableConfigSourceHash(recipe), reviewed);
  }
  const executable = join(app, "mutable-config.js");
  const bytes = await readFile(executable);
  await rm(executable);
  for (const loaded of consumers) assert.throws(() => loaded.mutableConfigSourceHash(recipe));
  await symlink(join(app, "mutable-config.ts"), executable);
  for (const loaded of consumers) assert.throws(() => loaded.mutableConfigSourceHash(recipe));
  await rm(executable);
  await writeFile(executable, bytes);
  assert.equal(consumers[0].mutableConfigSourceHash(recipe), reviewed);
  console.log("PASS mutable config installed CLI/Bun owner/app bundles, source/executable pins and mutable resume");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
