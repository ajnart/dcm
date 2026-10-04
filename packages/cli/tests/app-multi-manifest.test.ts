import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { multiServiceManifest, pinnedMultiServiceImages, prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const recipePath = fileURLToPath(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/recipe.json", import.meta.url));
const recipe = JSON.parse(await readFile(recipePath, "utf8"));
const root = "/tmp/selfhost-multi-manifest-fixture";
const projectId = "selfhost-paperless-ngx-0123456789abcdef";
const appsRoot = join(root, ".selfhost", "apps");
const images = Object.fromEntries(recipe.services.map((service: { id: string; imageTag: string }) => [
  service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`,
]));
const specifications = Object.entries(images).map(([id, image]) => `${id}=${image}`);
assert.deepEqual(pinnedMultiServiceImages(recipe, specifications), images);
assert.deepEqual(pinnedMultiServiceImages(recipe, [...specifications].reverse()), images);
assert.throws(() => pinnedMultiServiceImages(recipe, specifications.slice(1)), /one --image/);
assert.throws(() => pinnedMultiServiceImages(recipe, [...specifications.slice(0, 2), specifications[0]]), /one unique recipe service/);
assert.throws(() => pinnedMultiServiceImages(recipe, [...specifications.slice(0, 2), "db=docker.io/library/postgres:latest@sha256:" + "a".repeat(64)]), /one unique recipe service/);
const input = {
  recipe, images, projectId, appsRoot, projectDirectory: join(appsRoot, projectId),
  dataDirectory: join(root, ".selfhost", "app-data", "paperless-ngx"),
  dockerContext: "default", port: 18000, uid: 1001, gid: 1002,
  observed: { checkedAt: "2026-09-28T12:00:00.000Z", ports: [], paths: [], networks: [] },
};
const manifest = multiServiceManifest(input);
assert.equal(manifest.services.length, 3);
const web = manifest.services.find((service: { id: string }) => service.id === "paperless-ngx");
assert.deepEqual(web.environment.filter((entry: { name: string }) => entry.name.startsWith("USERMAP_")), [
  { name: "USERMAP_UID", value: "1001" },
  { name: "USERMAP_GID", value: "1002" },
]);
assert.equal(web.secretRefs.length, 3);
assert.deepEqual(web.environment.find((entry: { name: string }) => entry.name === "PAPERLESS_ADMIN_USER"),
  { name: "PAPERLESS_ADMIN_USER", value: "admin" });
assert.deepEqual(web.environment.find((entry: { name: string }) => entry.name === "PAPERLESS_ADMIN_PASSWORD_FILE"),
  { name: "PAPERLESS_ADMIN_PASSWORD_FILE", value: "/run/secrets/admin-password" });
assert.equal(manifest.services.filter((service: { ports: unknown[] }) => service.ports.length > 0).length, 1);
assert.equal(manifest.services.find((service: { id: string }) => service.id === "db").ports.length, 0);
assert.equal(JSON.stringify(manifest).includes("database-password="), false);
const plan = await createSelfhostComposeOwner(manifest).plan();
assert.equal(plan.status, "pass");
assert.equal(plan.render.noClobber, true);
assert.throws(() => multiServiceManifest({ ...input, uid: 0 }), /non-root host UID/);
assert.throws(() => multiServiceManifest({ ...input, images: { ...images, broker: "docker.io/valkey/valkey:latest" } }), /immutable image digest/);
const invalidRecipe = structuredClone(recipe);
invalidRecipe.services[0].hostEnvironment[0].source = "home";
assert.throws(() => multiServiceManifest({ ...input, recipe: invalidRecipe }), /host environment source/);

const temporary = await mkdtemp(join(tmpdir(), "selfhost-multi-files-"));
try {
  const projectDirectory = join(temporary, "project");
  const dataDirectory = join(temporary, "data");
  await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory);
  const passwordPath = join(projectDirectory, "secrets", "database-password");
  const first = await lstat(passwordPath);
  assert.equal(first.mode & 0o777, 0o600);
  assert.equal(first.size > 48, true);
  assert.equal((await lstat(join(dataDirectory, "export"))).isDirectory(), true);
  await assert.rejects(lstat(join(dataDirectory, "media")), { code: "ENOENT" });
  await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory);
  assert.equal((await lstat(passwordPath)).ino, first.ino);
  const alphanumericRecipe = structuredClone(recipe);
  alphanumericRecipe.privateFiles[0].format = "alphanumeric";
  const alphanumericProject = join(temporary, "alphanumeric-project");
  await prepareMultiServiceFiles(alphanumericRecipe, alphanumericProject, join(temporary, "alphanumeric-data"));
  const alphanumericPath = join(alphanumericProject, "secrets", "application-key");
  const alphanumericValue = await readFile(alphanumericPath, "utf8");
  assert.match(alphanumericValue, /^[A-Za-z0-9]+$/);
  assert.equal(alphanumericValue.length, Math.ceil(alphanumericRecipe.privateFiles[0].bytes * 8 / Math.log2(62)));
  await prepareMultiServiceFiles(alphanumericRecipe, alphanumericProject, join(temporary, "alphanumeric-data"));
  await chmod(passwordPath, 0o644);
  await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory), /mode-0600/);
  const invalidFiles = structuredClone(recipe);
  invalidFiles.privateFiles[0].id = "../outside";
  await assert.rejects(prepareMultiServiceFiles(invalidFiles, projectDirectory, dataDirectory), /file name is invalid/);
  const linked = join(temporary, "linked");
  await symlink(projectDirectory, linked);
  await assert.rejects(prepareMultiServiceFiles(recipe, linked, dataDirectory), /mode-0700 real directories/);
} finally {
  await rm(temporary, { recursive: true });
}

process.stdout.write("multi-service Compose manifest checks passed\n");
