import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAppRecipe } from "../../selfhost/scripts/catalog.ts";
import { multiServiceManifest } from "../../../../../../packages/cli/src/lib/multi-service-recipe.ts";

const catalog = join(import.meta.dir, "../../selfhost/references/catalog/apps/paperless-ngx");
const app = JSON.parse(readFileSync(join(catalog, "manifest.json"), "utf8"));
const original = JSON.parse(readFileSync(join(catalog, "recipe.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "owner-file-path-"));
const input = join(temporary, "manifest.json");
const binding = { name: "OWNER_ACCESS_KEY", fileId: "owner-bundle", format: "file-path", officialUrl: app.sources[0] };
const recipe = structuredClone(original);
recipe.privateFiles.push({ id: binding.fileId, source: "owner", maxBytes: 16384 });
recipe.services[0].fileEnvironment.push(binding);

function compile(candidate = recipe) {
  return multiServiceManifest({ recipe: candidate,
    images: Object.fromEntries(candidate.services.map((service: { id: string; imageTag: string }) =>
      [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`])),
    projectId: "owner-file-path", appsRoot: temporary,
    projectDirectory: join(temporary, "owner-file-path"), dataDirectory: join(temporary, "data"),
    dockerContext: "default", port: 18080, uid: 1000, gid: 1000,
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
}

function invoke(manifest: Record<string, any>, action = "validate") {
  writeFileSync(input, JSON.stringify(manifest), { mode: 0o600 });
  const arguments_ = [process.execPath, join(import.meta.dir, "compose-project.ts"), action, "--input", input];
  if (action === "render") arguments_.push("--output-dir", manifest.project.directory);
  return Bun.spawnSync(arguments_,
    { stdout: "pipe", stderr: "pipe" });
}

try {
  assert.deepEqual(validateAppRecipe(recipe, app), []);
  const compiled = compile();
  const service = compiled.services[0];
  assert.equal(service.environment.find((entry: { name: string }) => entry.name === binding.name).value,
    "/run/secrets/owner-bundle");
  assert.deepEqual(service.fileEnvironmentConsumers, [{ name: binding.name, target: binding.fileId,
    format: "file-path", officialUrl: binding.officialUrl, appId: "paperless-ngx", source: "owner" }]);
  assert.equal(invoke(compiled).exitCode, 0);
  const plan = invoke(compiled, "plan");
  assert.equal(plan.exitCode, 0, plan.stderr.toString());
  assert.ok(plan.stdout.toString().includes("fileEnvironmentConsumers"));
  // No owner input file exists: rendering must use references without reading bytes.
  const rendered = invoke(compiled, "render");
  assert.equal(rendered.exitCode, 0, rendered.stderr.toString());
  const compose = readFileSync(JSON.parse(rendered.stdout.toString()).target, "utf8");
  assert.ok(compose.includes('"OWNER_ACCESS_KEY": "/run/secrets/owner-bundle"'));
  assert.ok(!compose.includes("fileEnvironmentConsumers"));
  const license = structuredClone(compiled);
  license.services[0].fileEnvironmentConsumers[0].name = "MINIO_LICENSE";
  license.services[0].environment.find((entry: { name: string }) => entry.name === binding.name).name = "MINIO_LICENSE";
  assert.equal(invoke(license).exitCode, 0);
  delete license.services[0].fileEnvironmentConsumers;
  assert.equal(invoke(license).exitCode, 2, "a non-secret-like name cannot bypass typed path provenance");
  const old = compile(original);
  assert.ok(old.services.every((entry: Record<string, any>) => !Object.hasOwn(entry, "fileEnvironmentConsumers")));
  assert.equal(invoke(old).exitCode, 0);

  for (const change of [
    (value: Record<string, any>) => { value.services[0].fileEnvironment.at(-1).officialUrl = "https://example.com/undocumented"; },
    (value: Record<string, any>) => { value.services[0].fileEnvironment.at(-1).format = "unsupported"; },
    (value: Record<string, any>) => { value.services[0].fileEnvironment.at(-1).payload = "not-a-path"; },
    (value: Record<string, any>) => { value.privateFiles.at(-1).source = "generated"; },
  ]) {
    const candidate = structuredClone(recipe);
    change(candidate);
    assert.ok(validateAppRecipe(candidate, app).length > 0);
    assert.throws(() => compile(candidate));
  }

  for (const change of [
    (value: Record<string, any>) => { delete value.services[0].fileEnvironmentConsumers; },
    (value: Record<string, any>) => { value.services[0].fileEnvironmentConsumers[0].source = "generated"; },
    (value: Record<string, any>) => { value.services[0].fileEnvironmentConsumers[0].officialUrl = "https://example.com/undocumented"; },
    (value: Record<string, any>) => { value.services[0].fileEnvironmentConsumers[0].target = "not-granted"; },
    (value: Record<string, any>) => { value.services[0].fileEnvironmentConsumers[0].format = "file-uri"; },
    (value: Record<string, any>) => { value.services[0].fileEnvironmentConsumers[0].payload = "not-a-path"; },
    (value: Record<string, any>) => { value.services[0].environment.find((entry: { name: string }) => entry.name === binding.name).value = "file:/run/secrets/owner-bundle"; },
    (value: Record<string, any>) => { value.services[0].environment.find((entry: { name: string }) => entry.name === binding.name).value = "not-a-path"; },
    (value: Record<string, any>) => { value.services[0].environment.push({ name: "ANOTHER_KEY", value: "/run/secrets/owner-bundle" }); },
  ]) {
    const candidate = structuredClone(compiled);
    change(candidate);
    const result = invoke(candidate);
    assert.equal(result.exitCode, 2, result.stdout.toString());
  }
  const uri = structuredClone(recipe);
  uri.services[0].fileEnvironment.at(-1).format = "file-uri";
  assert.deepEqual(validateAppRecipe(uri, app), []);
  const uriManifest = compile(uri);
  assert.equal(uriManifest.services[0].environment.find((entry: { name: string }) => entry.name === binding.name).value,
    "file:/run/secrets/owner-bundle");
  assert.ok(!Object.hasOwn(uriManifest.services[0], "fileEnvironmentConsumers"));
  assert.equal(invoke(uriManifest).exitCode, 0);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log("owner-file paths: exact typed paths accepted; undeclared consumers, altered evidence, generated inputs and payloads rejected");
