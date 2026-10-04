import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { generatedConfigReadability, multiServiceManifest, prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";

const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/", import.meta.url);
const recipe = JSON.parse(await readFile(new URL("recipe.json", catalog), "utf8"));
const app = JSON.parse(await readFile(new URL("manifest.json", catalog), "utf8"));
recipe.configFiles = [
  { id: "ordinary", content: "listen: 8080\n" },
  { id: "readable", content: "listen: 8081\n", readability: "container", officialUrl: recipe.source },
];
for (const file of recipe.configFiles) {
  recipe.services[0].mounts.push({ name: `generated-${file.id}`, kind: "generated-file",
    fileId: file.id, target: `/etc/fixture/${file.id}` });
}
recipe.privateConfigs = [{ id: "private-config", officialUrl: recipe.source,
  parts: [{ literal: "value=" }, { fileId: "database-password" }] }];
recipe.services[0].privateConfigFiles = ["private-config"];
assert.deepEqual(validateAppRecipe(recipe, app), []);
assert.deepEqual(generatedConfigReadability(recipe), [{ fileId: "readable",
  readability: "container", mode: "0644", officialUrl: recipe.source }]);
const root = await mkdtemp(join(tmpdir(), "generated-config-readability-"));
const projectDirectory = join(root, "project");
const dataDirectory = join(projectDirectory, "data");
const directory = join(dataDirectory, "config-files");
const readable = join(directory, "readable");
const ordinary = join(directory, "ordinary");
const images = Object.fromEntries(recipe.services.map((service: { id: string; imageTag: string }) =>
  [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`]));
const input = { recipe, images, projectId: "config-readability", appsRoot: root,
  projectDirectory, dataDirectory, dockerContext: "default", port: 18080, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [] } };

function rejected(change: (value: any) => void): void {
  const invalid = structuredClone(recipe);
  change(invalid);
  assert.ok(validateAppRecipe(invalid, app).length > 0);
  assert.throws(() => multiServiceManifest({ ...input, recipe: invalid }));
}

try {
  const manifest = multiServiceManifest(input);
  for (const path of [readable, ordinary]) {
    const mount = manifest.services[0].mounts.find((entry: { source: string }) => entry.source === path);
    assert.ok(mount && mount.readOnly === true);
  }
  // A restrictive caller umask must not make the explicit exception unreadable.
  const previousUmask = process.umask(0o077);
  try { await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory); }
  finally { process.umask(previousUmask); }
  assert.equal((await lstat(readable)).mode & 0o7777, 0o644);
  assert.equal((await lstat(ordinary)).mode & 0o7777, 0o600);
  assert.equal((await lstat(directory)).mode & 0o7777, 0o700);
  assert.equal((await lstat(dataDirectory)).mode & 0o7777, 0o700);
  for (const file of ["database-password", "private-config"]) {
    assert.equal((await lstat(join(projectDirectory, "secrets", file))).mode & 0o7777, 0o600);
  }
  const before = await lstat(readable);
  await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory);
  assert.equal((await lstat(readable)).ino, before.ino);
  assert.equal(await readFile(readable, "utf8"), recipe.configFiles[1].content);

  await chmod(readable, 0o600);
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /readability/);
  assert.equal((await lstat(readable)).mode & 0o7777, 0o600, "resume must not repair permissions");
  await chmod(readable, 0o644);
  await chmod(ordinary, 0o644);
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /readability/);
  await chmod(ordinary, 0o600);
  await writeFile(readable, "listen: 9999\n");
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /reviewed recipe/);
  await writeFile(readable, recipe.configFiles[1].content);
  const extraLink = join(directory, "hardlink");
  await link(readable, extraLink);
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /readability/);
  await unlink(extraLink);
  await unlink(readable);
  await symlink(ordinary, readable);
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory));
  await unlink(readable);
  await writeFile(readable, recipe.configFiles[1].content, { mode: 0o644 });
  await chmod(directory, 0o755);
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /mode-0700/);
  await chmod(directory, 0o700);

  rejected((value) => { delete value.configFiles[1].officialUrl; });
  rejected((value) => { value.configFiles[1].officialUrl = "https://unlisted.invalid/config"; });
  rejected((value) => { value.configFiles[1].officialUrl = `http://${new URL(recipe.source).host}/config`; });
  rejected((value) => { value.configFiles[1].readability = "world"; });
  rejected((value) => { value.configFiles[0].officialUrl = recipe.source; });
  for (const content of ["password: embedded", "token=embedded", "postgres://user:embedded@db/test",
    "process.env.FIXTURE_AUTH_HASH", "process . env . FIXTURE_AUTH_HASH",
    'process.env["FIXTURE_AUTH_HASH"]', "value: ${UNREVIEWED}"]) {
    rejected((value) => { value.configFiles[1].content = content; });
  }
  // Legacy private config still permits a sourced bcrypt environment reference.
  const bcryptRecipe = structuredClone(recipe);
  bcryptRecipe.configFiles[0].content = "password: process.env.FIXTURE_AUTH_HASH\n";
  bcryptRecipe.services[0].secretEnvironment = [{ name: "FIXTURE_AUTH_HASH",
    fileId: "admin-password", format: "bcrypt-hash" }];
  assert.deepEqual(validateAppRecipe(bcryptRecipe, app), []);
  assert.doesNotThrow(() => multiServiceManifest({ ...input, recipe: bcryptRecipe }));
  bcryptRecipe.configFiles[0].readability = "container";
  bcryptRecipe.configFiles[0].officialUrl = recipe.source;
  assert.ok(validateAppRecipe(bcryptRecipe, app).length > 0);
  assert.throws(() => multiServiceManifest({ ...input, recipe: bcryptRecipe }));

  // Packaged execution resolves the adjacent bundled manifest, not a source-tree fallback.
  const bundle = join(root, "compiled.js");
  const built = Bun.spawnSync([process.execPath, "build",
    new URL("../src/lib/multi-service-recipe.ts", import.meta.url).pathname,
    "--target=bun", `--outfile=${bundle}`]);
  assert.equal(built.exitCode, 0, built.stderr.toString());
  const packagedApp = join(root, "workflows", "selfhost", "references", "catalog", "apps", app.id);
  await mkdir(packagedApp, { recursive: true });
  await writeFile(join(packagedApp, "manifest.json"), JSON.stringify(app), { mode: 0o644 });
  const compiled = await import(pathToFileURL(bundle).href);
  assert.doesNotThrow(() => compiled.multiServiceManifest(input));
  const bad = structuredClone(recipe);
  bad.configFiles[1].officialUrl = "https://unlisted.invalid/config";
  assert.throws(() => compiled.multiServiceManifest({ ...input, recipe: bad }), /exact listed/);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("generated config readability: explicit mode, private defaults, read-only mounts, replay and rejection passed");
