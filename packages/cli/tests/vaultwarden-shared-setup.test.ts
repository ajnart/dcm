import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import recipe from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/vaultwarden/recipe.json";
import manifest from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/vaultwarden/manifest.json";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import adapter, { deriveCanonicalEnvironment, verifyCanonicalConfig } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/vaultwarden/setup.ts";
import type { SetupContext } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { prepareSharedProjectFiles, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { officialClientFirstEmailCredential } from "../src/lib/shared-unit-setup.ts";

assert.deepEqual(validateAppRecipe(recipe, manifest), []);
const injectedIdentity = structuredClone(recipe) as Record<string, any>;
injectedIdentity.onboarding.email = "fabricated@example.test";
assert.ok(validateAppRecipe(injectedIdentity, manifest).length > 0);
assert.throws(() => officialClientFirstEmailCredential(injectedIdentity, "/tmp/owned-secrets"), /no invented identity/);
const boundMaster = structuredClone(recipe);
boundMaster.services[0].fileEnvironment.push({ name: "ADMIN_TOKEN_FILE", fileId: "admin-password" } as never);
assert.ok(validateAppRecipe(boundMaster, manifest).length > 0);
assert.throws(() => officialClientFirstEmailCredential(boundMaster, "/tmp/owned-secrets"), /unbound generated master password/);
const foreignSource = structuredClone(recipe);
foreignSource.onboarding.officialUrl = "https://foreign.example.test";
assert.ok(validateAppRecipe(foreignSource, manifest).length > 0);
const externalMaster = structuredClone(recipe) as Record<string, any>;
externalMaster.privateFiles[0] = { id: "admin-password", source: "owner", maxBytes: 128 };
assert.ok(validateAppRecipe(externalMaster, manifest).length > 0);
assert.throws(() => officialClientFirstEmailCredential(externalMaster, "/tmp/owned-secrets"), /generated master password/);
assert.equal(officialClientFirstEmailCredential({ onboarding: { kind: "manual-first-email" } }, "/tmp/owned-secrets"), null);

const origin = "https://vaultwarden.localhost:28443";
assert.deepEqual(deriveCanonicalEnvironment(origin), [{ name: "DOMAIN", value: origin }]);
for (const invalid of ["http://127.0.0.1:8088", `${origin}/`, `${origin}/vault`,
  `${origin}?key=value`, "https://user:pass@vaultwarden.localhost:28443", `${origin}#fragment`]) {
  assert.throws(() => deriveCanonicalEnvironment(invalid), /exact approved HTTPS origin/);
}
const config = { object: "config",
  server: { name: "Vaultwarden", url: "https://github.com/dani-garcia/vaultwarden" },
  settings: { disableUserRegistration: true },
  environment: { vault: origin, api: `${origin}/api`, identity: `${origin}/identity`,
    notifications: `${origin}/notifications` } };
verifyCanonicalConfig(config, origin);
for (const field of ["vault", "api", "identity", "notifications"]) {
  const changed = structuredClone(config);
  changed.environment[field] = "https://foreign.localhost";
  assert.throws(() => verifyCanonicalConfig(changed, origin), /differs/);
}
assert.throws(() => verifyCanonicalConfig({ ...config,
  settings: { disableUserRegistration: false } }, origin), /differs/);

const root = await mkdtemp(join(tmpdir(), "selfhost-vaultwarden-shared-"));
try {
  const selection = { appId: "vaultwarden", recipe, port: 18088,
    images: { vaultwarden: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` } };
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "vault-fixture",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [selection],
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  assert.equal((await createSelfhostComposeOwner(candidate.manifest).plan()).status, "pass");
  const service = candidate.manifest.services[0];
  assert.deepEqual(candidate.units.vaultwarden, ["vaultwarden"]);
  assert.equal(service.mounts[0].target, "/data");
  assert.equal(service.mounts[0].kind, "volume");
  assert.equal(service.ports[0].hostIp, "127.0.0.1");
  assert.equal(service.ports[0].published, 18088);
  assert.equal(service.ports[0].target, 8080);
  assert.equal(service.environment.find((entry) => entry.name === "SIGNUPS_ALLOWED").value, "false");
  assert.equal(service.environment.find((entry) => entry.name === "INVITATIONS_ALLOWED").value, "false");
  assert.equal(service.environment.some((entry) => /DOMAIN|ADMIN_TOKEN|PASSWORD/.test(entry.name)), false);
  assert.deepEqual(service.secretRefs, []);
  await mkdir(join(root, ".selfhost", "shared"), { recursive: true, mode: 0o700 });
  await prepareSharedProjectFiles(candidate, [selection]);
  const privateFiles = join(candidate.projectDirectory, "secrets", "vaultwarden");
  const passwordFile = join(privateFiles, "admin-password");
  assert.deepEqual(officialClientFirstEmailCredential(recipe, privateFiles), {
    username: null, email: null, loginVia: "official-client-email", passwordFile,
    credentialUsage: "generated-master-password", enrollmentStatus: "pending",
    accountCreated: false, loginVerified: false, unlockVerified: false,
  });
  const password = await readFile(passwordFile, "utf8");
  const firstFile = await lstat(passwordFile);
  assert.equal(firstFile.mode & 0o777, 0o600);
  assert.equal(/^[A-Za-z0-9]+$/.test(password), true);
  assert.equal(password.length, Math.ceil(48 * 8 / Math.log2(62)));
  await prepareSharedProjectFiles(candidate, [selection]);
  assert.equal((await lstat(passwordFile)).ino, firstFile.ino);
  assert.equal(await readFile(passwordFile, "utf8"), password);

  let url = origin;
  let setupUrl: string | undefined;
  let calls = 0;
  let body = config;
  const context = { appId: "vaultwarden", projectRoot: root,
    async status() { return { command: "app status", appId: "vaultwarden", projectRoot: root,
      ownerKind: "shared", status: "applied", mutation: false, runtime: { state: "running" },
      url, setupUrl, privateFiles, passwordFile }; },
    http: { async request(request) {
      assert.deepEqual(request, { method: "GET", path: "/api/config", requireHttps: true });
      calls += 1;
      return { status: 200, async json() { return body; } };
    } },
  } as unknown as SetupContext;
  const first = await adapter.firstRun(context);
  assert.equal(first.passwordFile, passwordFile);
  assert.equal(first.canonicalConfigVerified, true);
  assert.equal(first.stage, "official-client-enrollment-required");
  assert.equal(adapter.ready(first), false);
  assert.equal(adapter.ready({ ...first, loginVerified: true, unlockVerified: true }), false);
  assert.equal(adapter.ready(await adapter.inspect!(context)), false);
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(first).includes(password), false);
  url = "http://127.0.0.1:18088";
  await assert.rejects(adapter.firstRun(context), /same-owner canonical HTTPS/);
  assert.equal(calls, 2);
  setupUrl = origin;
  assert.equal((await adapter.firstRun(context)).canonicalOrigin, origin);
  assert.equal(calls, 3);
  setupUrl = "http://127.0.0.1:18088";
  await assert.rejects(adapter.firstRun(context), /same-owner canonical HTTPS/);
  assert.equal(calls, 3);
  setupUrl = undefined;
  url = origin;
  body = { ...config, settings: { disableUserRegistration: false } };
  await assert.rejects(adapter.firstRun(context), /differs/);
} finally {
  await rm(root, { recursive: true });
}
console.log("Vaultwarden shared closed deployment and canonical origin: pass");
