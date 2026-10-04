import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAppRecipe } from "../../selfhost/scripts/catalog.ts";
import { isDisabledCredentialLoggingPolicy } from "../../selfhost/references/catalog/types/non-secret-policy.ts";

const temporary = mkdtempSync(join(tmpdir(), "credential-logging-policy-"));
const catalog = join(import.meta.dir, "../../selfhost/references/catalog/apps/paperless-ngx");
const app = JSON.parse(readFileSync(join(catalog, "manifest.json"), "utf8"));
const recipe = JSON.parse(readFileSync(join(catalog, "recipe.json"), "utf8"));
const input = join(temporary, "manifest.json");
function validate(name: string, value: unknown) {
  const manifest = { schemaVersion: 1,
    project: { dockerContext: "default", id: "logging-policy", owner: "logging-policy", root: temporary,
      directory: join(temporary, "logging-policy"), ownership: "new" },
    services: [{ id: "web", image: "docker.io/library/alpine:3.21.3", restart: "unless-stopped", readOnly: true,
      user: "1000:1000", environment: [{ name, value }], ports: [], mounts: [], networks: ["private"], secretRefs: [] }],
    networks: [{ id: "private", name: "logging-policy-private", driver: "bridge", internal: true, owner: "logging-policy", ownership: "new" }],
    observed: { checkedAt: "2026-10-03T00:00:00Z", project: null, ports: [], paths: [], networks: [] } };
  writeFileSync(input, JSON.stringify(manifest), { mode: 0o600 });
  return Bun.spawnSync([process.execPath, join(import.meta.dir, "compose-project.ts"), "validate", "--input", input],
    { stdout: "pipe", stderr: "pipe" });
}
try {
  const name = "MAYAN_AUTOADMIN_LOG_CREDENTIALS";
  assert.equal(isDisabledCredentialLoggingPolicy(name, "false"), true);
  assert.equal(validate(name, "false").exitCode, 0);
  const accepted = structuredClone(recipe);
  accepted.services[0].environment.push({ name, value: "false" });
  assert.deepEqual(validateAppRecipe(accepted, app), []);
  for (const value of ["true", "FALSE", "0", "payload-value", false, null]) {
    assert.equal(isDisabledCredentialLoggingPolicy(name, value), false);
    assert.equal(validate(name, value).exitCode, 2);
    const rejected = structuredClone(recipe);
    rejected.services[0].environment.push({ name, value });
    assert.ok(validateAppRecipe(rejected, app).length > 0);
  }
  for (const secretName of ["MAYAN_AUTOADMIN_PASSWORD", "MAYAN_CREDENTIALS", "MAYAN_API_KEY",
    "mayan_log_credentials", "LOG_CREDENTIALS"]) {
    assert.equal(isDisabledCredentialLoggingPolicy(secretName, "false"), false);
    assert.equal(validate(secretName, "false").exitCode, 2, secretName);
    const rejected = structuredClone(recipe);
    rejected.services[0].environment.push({ name: secretName, value: "false" });
    assert.ok(validateAppRecipe(rejected, app).length > 0);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log("credential logging policy: exact false accepted; true/payload/normal secret names rejected");
