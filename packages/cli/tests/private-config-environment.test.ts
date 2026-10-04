import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { checkedPrivateConfigEnvironment, type PrivateConfigDeclaration } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-config-environment.ts";
import { multiServiceManifest, prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH}`;
const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/", import.meta.url);
const recipe = JSON.parse(await readFile(new URL("recipe.json", catalog), "utf8"));
const app = JSON.parse(await readFile(new URL("manifest.json", catalog), "utf8"));
recipe.privateConfigs = [
  { id: "database-options", officialUrl: recipe.source, parts: [
    { literal: '{"default":{"ENGINE":"django.db.backends.postgresql","PASSWORD":"' },
    { fileId: "database-password" }, { literal: '","HOST":"db","PORT":5432}}' },
  ] },
  { id: "broker-uri", officialUrl: recipe.source, parts: [
    { literal: "redis://:" }, { fileId: "database-password" }, { literal: "@broker:6379/1" },
  ] },
];
recipe.services[0].secretEnvironment = [
  { name: "APP_DATABASES", fileId: "database-options", format: "private-config", officialUrl: recipe.source },
  { name: "APP_BROKER_URL", fileId: "broker-uri", format: "private-config", officialUrl: recipe.source },
  { name: "FIXTURE_SECRET", fileId: "database-password" },
  { name: "FIXTURE_AUTH_HASH", fileId: "database-password", format: "bcrypt-hash" },
];
assert.deepEqual(validateAppRecipe(recipe, app), []);
const temporary = await mkdtemp(join(tmpdir(), "private-config-environment-"));
const projectId = "derived-config";
const projectDirectory = join(temporary, projectId);
const dataDirectory = join(temporary, "data");
const fileDirectory = join(projectDirectory, "secrets");
const envPath = join(fileDirectory, "paperless-ngx.env");
const images = Object.fromEntries(recipe.services.map((service: { id: string; imageTag: string }) =>
  [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`]));
const input = { recipe, images, projectId, appsRoot: temporary, projectDirectory, dataDirectory,
  dockerContext: "default", port: 18080, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [] } };
try {
  const manifest = multiServiceManifest(input);
  const owner = createSelfhostComposeOwner(manifest);
  const plan = await owner.plan();
  const rendered = await owner.render(plan);
  const compose = await readFile(rendered, "utf8");
  await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory);
  const password = await readFile(join(fileDirectory, "database-password"), "utf8");
  const env = await readFile(envPath, "utf8");
  assert.equal((await lstat(envPath)).mode & 0o777, 0o600);
  const databaseValue = /^APP_DATABASES='(.*)'$/m.exec(env)?.[1];
  assert.ok(databaseValue);
  assert.equal(JSON.parse(databaseValue).default.PASSWORD, password);
  assert.ok(env.includes(`APP_BROKER_URL='redis://:${password}@broker:6379/1'`));
  assert.ok(env.includes(`FIXTURE_SECRET=${password}`));
  const hash = /^FIXTURE_AUTH_HASH='(.*)'$/m.exec(env)?.[1];
  assert.ok(hash && await bcrypt.compare(password, hash));
  const inode = (await lstat(envPath)).ino;
  await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory);
  assert.equal(await readFile(envPath, "utf8"), env);
  assert.equal((await lstat(envPath)).ino, inode);
  for (const publicValue of [JSON.stringify(manifest), JSON.stringify(plan), compose]) {
    assert.ok(!publicValue.includes(password));
    assert.ok(!publicValue.includes(databaseValue));
  }
  assert.ok(compose.includes(envPath));
  assert.ok(!manifest.services[0].secretRefs.some((entry: { target: string }) =>
    ["database-options", "broker-uri"].includes(entry.target)), "env-only configs are not secret mounts");
  await writeFile(envPath, `${env}UNREVIEWED=extra\n`, { mode: 0o600 });
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /does not match/);
  await writeFile(envPath, env, { mode: 0o600 });
  const configPath = join(fileDirectory, "database-options");
  const savedConfig = await readFile(configPath, "utf8");
  await writeFile(configPath, "tampered", { mode: 0o600 });
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /differs from/);
  await writeFile(configPath, savedConfig, { mode: 0o600 });
  await chmod(configPath, 0o644);
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /owner-only/);
  await chmod(configPath, 0o600);
  for (const literal of ["unsafe'quote", "unsafe\\escape", "unsafe$variable", "unsafe\nnewline",
    '"PASSWORD":"embedded-secret"', "amqp://user:embedded-secret@broker", "x".repeat(4097)]) {
    const invalid = structuredClone(recipe);
    invalid.privateConfigs[0].parts[0].literal = literal;
    assert.ok(validateAppRecipe(invalid, app).length > 0);
    assert.throws(() => multiServiceManifest({ ...input, recipe: invalid }));
  }
  const duplicate = structuredClone(recipe);
  duplicate.services[1].secretEnvironment = [structuredClone(recipe.services[0].secretEnvironment[0])];
  assert.ok(validateAppRecipe(duplicate, app).length > 0);
  assert.throws(() => multiServiceManifest({ ...input, recipe: duplicate }), /one exact service binding/);
  const mounted = structuredClone(recipe);
  mounted.services[0].privateConfigFiles = ["database-options"];
  assert.ok(validateAppRecipe(mounted, app).length > 0);
  assert.throws(() => multiServiceManifest({ ...input, recipe: mounted }), /one exact service binding/);
  const unlisted = structuredClone(recipe);
  unlisted.privateConfigs[0].officialUrl = "https://unlisted.invalid/config";
  unlisted.services[0].secretEnvironment[0].officialUrl = "https://unlisted.invalid/config";
  assert.ok(validateAppRecipe(unlisted, app).length > 0);
  const malformed = { ...recipe.services[0].secretEnvironment[0], arbitrary: "unsupported" };
  assert.throws(() => checkedPrivateConfigEnvironment(malformed,
    new Map<string, PrivateConfigDeclaration>(recipe.privateConfigs.map((config: PrivateConfigDeclaration) => [config.id, config]))));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log("private config environment: typed dict/URI, scoped files, replay, tamper, rejection and no public payload passed");
