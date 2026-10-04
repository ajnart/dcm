import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkedAppFrontend } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/app-frontend.ts";
import { loadCatalog, validateCatalog } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { resolveAppEndpoints, resolveAppFrontend, resolveSharedAppMetadata } from "../src/lib/resolved-app.ts";

const catalogRoot = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
for (const [id, protocol] of [["postgresql", "postgresql"], ["valkey", "redis"]]) {
  const app = JSON.parse(await readFile(new URL(`${id}/manifest.json`, catalogRoot), "utf8"));
  const recipe = JSON.parse(await readFile(new URL(`${id}/recipe.json`, catalogRoot), "utf8"));
  const before = JSON.stringify(recipe);
  // Deliberately unusual ports: frontend semantics come from metadata, not numbers.
  const savedService = { id, ports: [{ protocol: "tcp", target: recipe.services[0].publishTargetPort,
    published: 18080 }], mounts: [] };
  const metadata = resolveSharedAppMetadata(id, app, recipe, savedService);
  assert.deepEqual(metadata.frontend, { kind: "tcp", protocol });
  assert.equal(metadata.browserUrl, null);
  assert.equal(metadata.serverUrl, null);
  assert.deepEqual(metadata.endpoint, { transport: "tcp", protocol, host: "127.0.0.1", port: 18080 });
  assert.deepEqual(metadata.serverEndpoint, { transport: "tcp", protocol, host: id,
    port: recipe.services[0].publishTargetPort });
  assert.equal(metadata.storagePath, null);
  assert.equal(JSON.stringify(recipe), before, "resolving presentation cannot mutate recipe identity");
  assert.throws(() => resolveSharedAppMetadata(id, app, recipe,
    { ...savedService, ports: [{ protocol: "tcp", target: 8080, published: 18080 }] }), /exact catalog frontend/);
  assert.throws(() => resolveSharedAppMetadata(id, app, recipe,
    { ...savedService, ports: [...savedService.ports, ...savedService.ports] }), /exact catalog frontend/);
}

assert.deepEqual(resolveAppFrontend({ id: "legacy" }), { kind: "web", protocol: "http" });
const legacy = resolveAppEndpoints({ id: "legacy" }, 5432, "legacy", 6379);
assert.equal(legacy.browserUrl, "http://127.0.0.1:5432");
assert.equal(legacy.serverUrl, "http://legacy:6379");
const secure = resolveAppEndpoints({ frontend: { kind: "web", protocol: "https" } }, 18443, "secure", 8443);
assert.equal(secure.browserUrl, "https://127.0.0.1:18443");
assert.equal(secure.serverUrl, "https://secure:8443");
assert.deepEqual(resolveAppFrontend({ frontend: { kind: "none" } }), { kind: "none" });
assert.throws(() => resolveAppEndpoints({ frontend: { kind: "none" } }, 8080, "job", 8080), /exact catalog frontend/);
for (const id of ["cloudflare-tunnel", "zerotier"]) {
  const app = JSON.parse(await readFile(new URL(`${id}/manifest.json`, catalogRoot), "utf8"));
  assert.deepEqual(resolveAppFrontend(app), { kind: "none" });
  assert.throws(() => resolveAppEndpoints(app, 8080, id, 8080), /exact catalog frontend/,
    "a non-native descriptor never authorizes a fake browser endpoint");
}
for (const invalid of [null, [], {}, { kind: "tcp", protocol: "http" },
  { kind: "web", protocol: "redis" }, { kind: "tcp", protocol: "smtp" },
  { kind: "none", protocol: "http" }, { kind: "web", protocol: "http", extra: true }]) {
  assert.equal(checkedAppFrontend(invalid), null);
  assert.throws(() => resolveAppFrontend({ frontend: invalid }), /exact catalog frontend/);
}
assert.throws(() => resolveAppEndpoints({}, 0, "app", 8080), /exact catalog frontend/);
assert.throws(() => resolveAppEndpoints({}, 8080, "app:password@host", 8080), /exact catalog frontend/);

const catalog = await loadCatalog();
const app = catalog.apps.find((value) => value.id === "postgresql")!;
assert.ok(!validateCatalog(catalog).errors.some((error) => error.startsWith("app postgresql:")));
for (const frontend of [{ kind: "tcp", protocol: "http" }, { kind: "none", port: 5432 }]) {
  const invalid = structuredClone(catalog);
  invalid.apps.find((value) => value.id === app.id)!.frontend = frontend;
  assert.ok(validateCatalog(invalid).errors.some((error) => error.startsWith("app postgresql: frontend")));
}
console.log("PASS declarative frontend metadata preserves TCP endpoints and saved recipe identity");
