import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { multiServiceManifest } from "../src/lib/multi-service-recipe.ts";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { containerHashReferencesAllowed } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/config-hash-reference.ts";

const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/uptime-kuma/", import.meta.url);
const app = JSON.parse(readFileSync(new URL("manifest.json", catalog), "utf8"));
const recipe = JSON.parse(readFileSync(new URL("recipe.json", catalog), "utf8"));
// Synthetic compiler input: this is not an installable Uptime Kuma connector.
recipe.execution = { kind: "private-connector", officialUrl: recipe.source, frontendSharing: "none" };
recipe.onboarding = { kind: "connector-enrollment", officialUrl: recipe.source };
recipe.privateFiles = [];
recipe.defaults.publishedPort = null;
recipe.services[0].publishTargetPort = null;
recipe.acceptance = [{ id: "client-access", method: "connector", description: "Verify exact intended and denied clients independently of container liveness." }];
assert.deepEqual(validateAppRecipe(recipe, app), []);
const input = { recipe, images: { "uptime-kuma": `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` },
  projectId: "connector-fixture", appsRoot: "/tmp/connector-fixture", projectDirectory: "/tmp/connector-fixture/project",
  dataDirectory: "/tmp/connector-fixture/data", dockerContext: "default", port: null, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } };
const manifest = multiServiceManifest(input);
assert.deepEqual(manifest.services[0].ports, []);
assert.equal(manifest.services[0].restart, "unless-stopped");
assert.equal(manifest.services[0].profiles, undefined);
assert.equal(manifest.services[0].manualProbe, undefined);
assert.equal(manifest.services[0].healthcheck, undefined);
assert.deepEqual(manifest.services[0].networks, ["private"]);
assert.throws(() => multiServiceManifest({ ...input, port: 18080 }), /port is invalid/);
assert.throws(() => multiServiceManifest({ ...input, homarrNetwork: "dashboard" }), /no frontend/);
for (const change of [
  { services: [{ ...recipe.services[0], restart: "no" }] },
  { services: [{ ...recipe.services[0], healthcheck: { test: ["CMD", "true"] } }] },
  { services: [{ ...recipe.services[0], publishTargetPort: 8080 }] },
  { execution: { ...recipe.execution, frontendSharing: undefined } },
  { execution: { ...recipe.execution, route: "http://arbitrary" } },
  { onboarding: { kind: "no-account", officialUrl: recipe.source } },
  { privateFiles: [{ id: "admin-password", bytes: 48 }] },
  { acceptance: [{ id: "fake-health", method: "api", description: "Fabricated HTTP acceptance is forbidden." }] },
]) {
  const invalid = { ...recipe, ...change };
  assert.ok(validateAppRecipe(invalid, app).length > 0);
  assert.throws(() => multiServiceManifest({ ...input, recipe: invalid }), /Private connectors/);
}
assert.equal(multiServiceManifest({ ...input, recipe: { ...recipe,
  execution: { ...recipe.execution, frontendSharing: "owner-front" } } }).services[0].networks[0], "private",
"owner-front is a choice for the shared owner, not automatic network authority in the pure compiler");
const names = new Set(["HAPROXY_ADMIN_AUTH_HASH"]);
assert.equal(containerHashReferencesAllowed('  user admin password "$HAPROXY_ADMIN_AUTH_HASH"', names), true);
for (const expression of ['  user admin password "$OTHER_AUTH_HASH"',
  '  user admin password "$API_KEY"', 'bind "$HAPROXY_ADMIN_AUTH_HASH"',
  '  user admin password "$HAPROXY_ADMIN_AUTH_HASH" extra', 'path "${HAPROXY_ADMIN_AUTH_HASH}"']) {
  assert.equal(containerHashReferencesAllowed(expression, names), false);
}
console.log("Portless connector compiler and bounded config hash fixture passed");
