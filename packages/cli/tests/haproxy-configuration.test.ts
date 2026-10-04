import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compileHaproxyConfiguration, assertHaproxyTargetUnchanged } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/haproxy/configuration.ts";
import adapter, { verifyHaproxyStats, checkedHaproxyBinding } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/haproxy/setup.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";
import { multiServiceManifest } from "../src/lib/multi-service-recipe.ts";
import type { SetupContext, SetupHttpResponse } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(): SharedProjectState {
  const project = { id: "haproxy_fixture", owner: "haproxy_fixture", dockerContext: "default",
    root: "/tmp/haproxy-fixture/shared", directory: "/tmp/haproxy-fixture/shared/haproxy_fixture" };
  const manifest = { project, services: [{ id: "chosen-app", image: `example/chosen:1@sha256:${"a".repeat(64)}`,
    networks: ["front"], restart: "unless-stopped", ports: [{ hostIp: "127.0.0.1", target: 8123,
      published: 18123, protocol: "tcp", purpose: "application", publicApproved: false }] }],
    networks: [{ id: "front", name: "haproxy_fixture-front", driver: "bridge", internal: false,
      owner: "haproxy_fixture", ownership: "verified-existing" }] };
  const state = { schemaVersion: 1, revision: 2, manifestRevision: 1, project, manifest,
    manifestHash: hash(manifest), units: { "chosen-app": ["chosen-app"] },
    selectionFingerprints: { "chosen-app": "b".repeat(64) },
    checkpoint: { phase: "completed" } };
  return { ...state, recordHash: hash(state) } as unknown as SharedProjectState;
}
const state = fixture(), snapshot = JSON.stringify(state);
const compiled = compileHaproxyConfiguration(state, "chosen-app");
assert.equal(JSON.stringify(state), snapshot);
assert.deepEqual(compileHaproxyConfiguration(state, "chosen-app"), compiled);
assertHaproxyTargetUnchanged(state, compiled);
const config = compiled.recipe.configFiles[0]!;
assert.match(config.content, /server chosen-app chosen-app:8123 check resolvers docker/);
assert.match(config.content, /init-addr none/);
assert.match(config.content, /user admin password "\$HAPROXY_ADMIN_AUTH_HASH"/);
assert.match(config.content, /stats http-request auth/);
assert.doesNotMatch(config.content, /insecure-password|stats admin|stats socket|homarr/);
assert.equal(config.readability, "container");
assert.equal(compiled.recipe.services[0]!.readOnly, true);
assert.equal(compiled.recipe.onboarding.username, "admin");
assert.equal(compiled.recipe.privateFiles[0]!.id, "admin-password");
const candidate = multiServiceManifest({ recipe: compiled.recipe,
  images: { haproxy: `haproxy:3.2.25@sha256:${"c".repeat(64)}` }, projectId: "haproxy_candidate",
  appsRoot: "/tmp/haproxy-candidate/apps", projectDirectory: "/tmp/haproxy-candidate/apps/haproxy_candidate",
  dataDirectory: "/tmp/haproxy-candidate/data", dockerContext: "default", port: 18081, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
assert.equal(candidate.services[0].ports[0].hostIp, "127.0.0.1");
assert.equal(candidate.services[0].ports[0].target, 8080);
assert.equal(candidate.services[0].mounts[0].readOnly, true);
assert.match(candidate.services[0].envFilePath, /\/secrets\/haproxy\.env$/);
assert.throws(() => compileHaproxyConfiguration(state, ""), /selected application/);
assert.throws(() => compileHaproxyConfiguration(state, "haproxy"), /proxy itself/);
assert.throws(() => compileHaproxyConfiguration(state, "http://chosen-app:8123"), /selected application/);
const changed = fixture(); changed.manifest.services[0]!.ports[0]!.target = 9000;
changed.manifestHash = hash(changed.manifest);
const { recordHash: _ignored, ...record } = changed; changed.recordHash = hash(record);
assert.notEqual(compileHaproxyConfiguration(changed, "chosen-app").binding.configurationFingerprint, compiled.binding.configurationFingerprint);
assert.throws(() => assertHaproxyTargetUnchanged(changed, compiled), /changed/);
assert.deepEqual(checkedHaproxyBinding(compiled.binding), compiled.binding);
assert.throws(() => checkedHaproxyBinding({ ...compiled.binding, targetPort: 0 }), /differs/);
assert.throws(() => checkedHaproxyBinding({ ...compiled.binding, hostname: "other" }), /differs/);

const csv = `# pxname,svname,status,\n${compiled.binding.statsBackendName},chosen-app,UP,\n`;
verifyHaproxyStats(csv, compiled.binding);
for (const invalid of [csv.replace("UP", "DOWN"), csv.replace("chosen-app", "other-app"),
  csv + csv.split("\n")[1] + "\n", "<html>200</html>", csv.replace("status", "unknown")]) {
  assert.throws(() => verifyHaproxyStats(invalid, compiled.binding), /HAProxy/);
}

let syntaxCode = 0, anonymousCode = 401, authenticatedCode = 200, binding: unknown = compiled.binding;
let derivedRecipe: unknown;
const calls: string[] = [];
function reply(status: number, body: string): SetupHttpResponse {
  return { status, ok: status === 200, headers: { get() { return null; } },
    async text() { return body; }, async json() { throw new Error("no JSON"); },
    async arrayBuffer() { return new TextEncoder().encode(body).buffer; } };
}
const context = { appId: "haproxy", projectRoot: "/tmp/haproxy-fixture",
  async status() { return { command: "app status", appId: "haproxy", projectRoot: "/tmp/haproxy-fixture",
    status: "applied", mutation: false, runtime: { state: "running" }, haproxyConfiguration: binding,
    derivedRecipe, ownerKind: "shared", selectionFingerprint: "d".repeat(64) }; },
  container: { async exec(command: { argv: string[]; effect: string }) {
    assert.equal(command.effect, "read");
    assert.deepEqual(command.argv, ["haproxy", "-c", "-f", "/usr/local/etc/haproxy/haproxy.cfg"]);
    calls.push("syntax"); return { exitCode: syntaxCode, stdout: "Configuration file is valid" }; } },
  secrets: { async readAdminPassword() { return "fixture-only-synthetic-password"; } },
  http: { async request(request: { method: string; path: string; headers?: Record<string, string>; query?: unknown }) {
    assert.equal(request.method, "GET"); assert.equal(request.query, undefined);
    calls.push(request.path);
    if (request.headers?.Authorization) {
      assert.equal(request.path, "/_auto-stack/stats;csv");
      assert.match(request.headers.Authorization, /^Basic /); return reply(authenticatedCode, csv);
    }
    assert.equal(request.path, "/_auto-stack/stats"); return reply(anonymousCode, "Unauthorized");
  } },
} as unknown as SetupContext;
const ready = await adapter.firstRun(context);
assert.equal(adapter.ready(ready), true);
assert.equal(ready.syntaxVerified, true);
assert.equal(ready.forwardedTrafficVerified, false);
assert.equal(ready.restartPersistenceVerified, false);
assert.equal(ready.apiKeyCreated, false);
assert.deepEqual(calls, ["syntax", "/_auto-stack/stats", "/_auto-stack/stats;csv"]);
syntaxCode = 1; await assert.rejects(() => adapter.firstRun(context), /did not validate/);
syntaxCode = 0; anonymousCode = 200; await assert.rejects(() => adapter.firstRun(context), /anonymous/);
anonymousCode = 401; authenticatedCode = 403; await assert.rejects(() => adapter.firstRun(context), /authenticate/);
authenticatedCode = 200; binding = undefined; await assert.rejects(() => adapter.firstRun(context), /binding/);
const metadata = { appId: "haproxy", input: { appId: "haproxy", inputs: { "target-app-id": "chosen-app" } },
  configuration: compiled.binding, sourceSha256: "e".repeat(64), recipeSha256: "f".repeat(64),
  selectionFingerprint: "d".repeat(64), bindingHash: "a".repeat(64), configurationFilesVerified: true };
derivedRecipe = metadata;
assert(adapter.ready(await adapter.firstRun(context)));
assert(adapter.ready(await adapter.inspect!(context)));
for (const invalid of [{ ...metadata, appId: "headscale" },
  { ...metadata, configurationFilesVerified: false }, { ...metadata, configurationFilesVerified: undefined },
  { ...metadata, sourceSha256: "invalid" }, { ...metadata, selectionFingerprint: "c".repeat(64) },
  { ...metadata, input: { appId: "haproxy", inputs: { "target-app-id": "other-app" } } },
  { ...metadata, configuration: { ...compiled.binding, targetPort: 0 } },
  { ...metadata, unowned: true }]) {
  derivedRecipe = invalid;
  await assert.rejects(() => adapter.firstRun(context), /differs/);
}
derivedRecipe = metadata;
binding = { ...compiled.binding, targetPort: 9000 };
await assert.rejects(() => adapter.firstRun(context), /legacy and derived/);
process.stdout.write("HAProxy explicit target compiler, immutable approval binding, syntax/statistics readback and fail-closed fixtures: pass\n");
