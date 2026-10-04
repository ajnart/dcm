import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateAppRecipe } from "./catalog.ts";
import { multiServiceManifest } from "../../../../../../packages/cli/src/lib/multi-service-recipe.ts";

const appPath = fileURLToPath(new URL("../references/catalog/apps/paperless-ngx/manifest.json", import.meta.url));
const recipePath = fileURLToPath(new URL("../references/catalog/apps/paperless-ngx/recipe.json", import.meta.url));
const app = JSON.parse(await readFile(appPath, "utf8"));
const recipe = JSON.parse(await readFile(recipePath, "utf8"));
assert.deepEqual(validateAppRecipe(recipe, app), []);
const alphanumeric = structuredClone(recipe);
alphanumeric.privateFiles[0].format = "alphanumeric";
assert.deepEqual(validateAppRecipe(alphanumeric, app), []);

function rejects(change: (candidate: typeof recipe) => void, pattern: RegExp) {
  const candidate = structuredClone(recipe);
  change(candidate);
  assert.match(validateAppRecipe(candidate, app).join("; "), pattern);
}

rejects((value) => { value.services[0].dependsOn = ["db"]; value.services[2].dependsOn = ["paperless-ngx"]; }, /cycle/);
rejects((value) => { value.services[0].fileEnvironment[0].fileId = "missing"; }, /file environment reference/);
rejects((value) => { value.services[1].imageTag = "docker.io/valkey/valkey:latest"; }, /fixed non-latest tag/);
rejects((value) => { value.services[1].mounts[0].name = "data"; }, /mount names must be unique/);
rejects((value) => { value.privateFiles[0].payload = "embedded"; }, /private file descriptor fields/);
rejects((value) => { value.privateFiles[0].format = "unsupported"; }, /private file format/);
rejects((value) => { value.services[2].publishTargetPort = 5432; }, /only the app service may publish/);
rejects((value) => { value.services[0].environment.push({ name: "PAPERLESS_SECRET_KEY", value: "unsafe" }); }, /environment name or value/);
rejects((value) => { value.services[0].environment.push({ name: "PAPERLESS_DBPASS", value: "unsafe" }); }, /environment name or value/);
rejects((value) => { value.services[0].environment.push({ name: "PAPERLESS_SECRET_KEY_FILE", value: "/tmp/unsafe" }); }, /environment name or value/);
rejects((value) => { value.services[0].hostEnvironment[0].source = "home"; }, /host environment binding/);
rejects((value) => { value.services[1].hostEnvironment.push({ name: "USERMAP_UID", source: "uid" }); }, /host environment binding/);
rejects((value) => { value.onboarding.fileId = "missing"; }, /first-admin file onboarding/);
rejects((value) => { value.onboarding.username = "other"; }, /first-admin file onboarding/);

const nextcloudPath = fileURLToPath(new URL("../references/catalog/apps/nextcloud/manifest.json", import.meta.url));
const nextcloudRecipePath = fileURLToPath(new URL("../references/catalog/apps/nextcloud/recipe.json", import.meta.url));
const nextcloudApp = JSON.parse(await readFile(nextcloudPath, "utf8"));
const nextcloud = JSON.parse(await readFile(nextcloudRecipePath, "utf8"));
assert.deepEqual(validateAppRecipe(nextcloud, nextcloudApp), []);
const mismatchedSharedVolume = structuredClone(nextcloud);
mismatchedSharedVolume.services[3].mounts[0].target = "/different";
assert.match(validateAppRecipe(mismatchedSharedVolume, nextcloudApp).join("; "), /shared named volumes/);
const unsafeEntrypoint = structuredClone(nextcloud);
unsafeEntrypoint.services[3].entrypoint = ["sh", "-c", "echo $PASSWORD"];
assert.match(validateAppRecipe(unsafeEntrypoint, nextcloudApp).join("; "), /bounded non-secret argv/);
const images = Object.fromEntries(nextcloud.services.map((service: { id: string; imageTag: string }) =>
  [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`]));
const compiled = multiServiceManifest({ recipe: nextcloud, images,
  projectId: "nextcloud-fixture", appsRoot: "/tmp/nextcloud-fixture/apps",
  projectDirectory: "/tmp/nextcloud-fixture/apps/nextcloud-fixture",
  dataDirectory: "/tmp/nextcloud-fixture/data", dockerContext: "default",
  port: 18080, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-09-29T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
assert.equal(compiled.services.find((service: { id: string }) => service.id === "cron")?.entrypoint?.[0], "/cron.sh");
assert.equal(compiled.services.find((service: { id: string }) => service.id === "db")?.command?.[0], "--transaction-isolation=READ-COMMITTED");
assert.deepEqual(compiled.services.filter((service: { id: string }) => ["nextcloud", "cron"].includes(service.id))
  .map((service: { mounts: { name: string }[] }) => service.mounts[0].name),
  ["nextcloud-fixture-html", "nextcloud-fixture-html"]);

const qbittorrentApp = JSON.parse(await readFile(fileURLToPath(new URL(
  "../references/catalog/apps/qbittorrent/manifest.json", import.meta.url)), "utf8"));
const qbittorrentRecipe = JSON.parse(await readFile(fileURLToPath(new URL(
  "../references/catalog/apps/qbittorrent/recipe.json", import.meta.url)), "utf8"));
assert.deepEqual(validateAppRecipe(qbittorrentRecipe, qbittorrentApp), []);
const invalidPortMatch = structuredClone(qbittorrentRecipe);
invalidPortMatch.services[0].publishedPortMustMatchTarget = false;
assert.match(validateAppRecipe(invalidPortMatch, qbittorrentApp).join("; "), /matching host and target ports/);
const selectedQbittorrent = multiServiceManifest({ recipe: qbittorrentRecipe,
  images: { qbittorrent: `ghcr.io/hotio/qbittorrent:release-5.2.3@sha256:${"a".repeat(64)}` },
  projectId: "qbittorrent-fixture", appsRoot: "/tmp/qbittorrent-fixture/apps",
  projectDirectory: "/tmp/qbittorrent-fixture/apps/qbittorrent-fixture",
  dataDirectory: "/tmp/qbittorrent-fixture/data", dockerContext: "default",
  hostPaths: { "media-data": "/tmp/qbittorrent-fixture/media" },
  port: 18080, uid: 1000, gid: 1000, timezone: "Europe/Paris",
  observed: { checkedAt: "2026-09-29T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
assert.equal(selectedQbittorrent.services[0].ports[0].target, 18080);
assert.equal(selectedQbittorrent.services[0].ports[0].published, 18080);
assert.ok(selectedQbittorrent.services[0].environment.some((entry: { name: string; value: string }) =>
  entry.name === "WEBUI_PORTS" && entry.value === "18080/tcp"));

process.stdout.write("multi-service recipe checks passed\n");
