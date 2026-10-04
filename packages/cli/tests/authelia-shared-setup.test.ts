import assert from "node:assert/strict";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authelia/setup.ts";
import { compileAutheliaUserDatabase, verifyAutheliaUserDatabase } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authelia/bootstrap.ts";
import { privateIdentityHasher, parsePrivateIdentityYaml } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-identity.ts";
import derived from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authelia/derived-recipe.ts";
import { checkedMutableConfigs } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/mutable-config.ts";
import { multiServiceManifest } from "../src/lib/multi-service-recipe.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import manifest from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authelia/manifest.json";
import { deriveSharedCreateRecipe } from "../src/lib/shared-derived-recipe.ts";
import { createHash } from "node:crypto";

const derivedInputs = { "canonical-origin": "https://auth.house.net", "cookie-domain": "house.net",
  "protected-origin": "https://photos.house.net", username: "owner", "display-name": "Selected Owner",
  email: "owner@house.net", notifier: "filesystem" };
const planned = derived.derive({ kind: "new-shared-project", input: { uid: 1000 } } as any, derivedInputs);
assert.equal(planned.recipe.services[0].user, "host-selected");
assert.deepEqual(planned.recipe.services[0].command, ["--config", "/etc/authelia/configuration.yml"]);
assert.equal(checkedMutableConfigs(planned.recipe).get("users")?.containerUid, 1000);
assert.match(planned.recipe.configFiles[0].content, /path: \/var\/lib\/authelia-users\/users_database.yml/);
const compiled = multiServiceManifest({ recipe: planned.recipe, images: { authelia: planned.recipe.services[0].imageTag },
  projectId: "authelia-fixture", appsRoot: "/tmp/authelia-fixture/apps",
  projectDirectory: "/tmp/authelia-fixture/apps/authelia-fixture", dataDirectory: "/tmp/authelia-fixture/data",
  dockerContext: "default", port: 19091, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
assert.equal(compiled.services[0].user, "1000:1000");
const source = { projectRoot: "/tmp/authelia-fixture", projectId: "authelia-fixture",
  dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
  apps: [], observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } };
const actualDerived = deriveSharedCreateRecipe(source, { appId: "authelia", inputs: derivedInputs });
assert.deepEqual(actualDerived.recipe, planned.recipe);
const candidate = sharedProjectCandidate({ ...source,
  apps: [{ appId: "authelia", recipe: actualDerived.recipe, images: { authelia: planned.recipe.services[0].imageTag }, port: 19091,
    derivationSha256: createHash("sha256").update(JSON.stringify(actualDerived)).digest("hex") }] });
assert.equal((await createSelfhostComposeOwner(candidate.manifest).plan()).status, "pass");
assert.deepEqual(validateAppRecipe(planned.recipe, manifest), []);
const unknownSource = structuredClone(planned.recipe);
unknownSource.imageSources.push("https://unreviewed.house.net/source");
assert.ok(validateAppRecipe(unknownSource, manifest).length > 0);
const unsafeArgument = structuredClone(planned.recipe);
unsafeArgument.services[0].command.push("--auth=unsafe");
assert.ok(validateAppRecipe(unsafeArgument, manifest).length > 0);
const unsafeManifest = structuredClone(candidate.manifest);
unsafeManifest.services[0].command.push("--auth=unsafe");
await assert.rejects(createSelfhostComposeOwner(unsafeManifest).plan());
for (const domain of ["com", "co.uk", "duckdns.org", "example.com", "home.arpa", "test.invalid"]) {
  assert.throws(() => derived.derive({ kind: "new-shared-project", input: { uid: 1000 } } as any,
    { ...derivedInputs, "cookie-domain": domain, "canonical-origin": `https://auth.${domain}`,
      "protected-origin": `https://photos.${domain}` }));
}

const identity = { username: "owner", displayName: "Selected Owner", email: "owner@example.net" };
const password = "a".repeat(48);
const content = await compileAutheliaUserDatabase(identity, password, privateIdentityHasher);
assert.equal(content.includes(password), false);
await verifyAutheliaUserDatabase(await parsePrivateIdentityYaml(content), identity, password, privateIdentityHasher);
await assert.rejects(verifyAutheliaUserDatabase(await parsePrivateIdentityYaml(content), identity,
  "b".repeat(48), privateIdentityHasher), /never reseed/);
const calls: any[] = [];
let cookies: Record<string, string> = {};
let checkpoint: any = null;
let mutableChecks = 0;
let passwordReads = 0;
const cookie = "A".repeat(64);
const context: any = {
  appId: "authelia", projectRoot: "/tmp/authelia-fixture", inputs: {},
  async status() { return { command: "app status", appId: "authelia", projectRoot: context.projectRoot,
    status: "applied", mutation: false, runtime: { state: "running" }, ownerKind: "shared",
    username: identity.username, passwordFile: "/tmp/authelia-fixture/private/admin-password" }; },
  checkpoint: { async read() { return checkpoint; }, async compareAndSet(next: any) {
    checkpoint = { ...next, revision: 1, appId: "authelia", projectRoot: context.projectRoot }; return checkpoint;
  } },
  secrets: { async verifyMutableConfigs() { mutableChecks++; }, async readAdminPassword() { passwordReads++; return password; },
    async readSessionCookies() { return cookies; }, async writeSessionCookies(value: any) { cookies = value; } },
  http: { async request(request: any) {
    calls.push(request);
    assert.equal(request.requireHttps, true);
    if (request.method === "POST") {
      assert.equal(request.path, "/api/firstfactor");
      assert.equal(request.approval.action, "authelia-verify-firstfactor-login");
      assert.deepEqual(JSON.parse(request.body), { username: "owner", password, keepMeLoggedIn: false });
      return { status: 200, headers: { getSetCookie() { return [`authelia_session=${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`]; } },
        async json() { return { status: "OK" }; } };
    }
    return { status: 200, async json() { return { status: "OK", data: {
      username: "owner", authentication_level: 1, factor_knowledge: true } }; } };
  } },
};
const first = await adapter.firstRun(context);
assert.equal(adapter.ready(first), true);
assert.equal(first.protectedTargetSsoVerified, false);
assert.equal(first.restartPersistenceVerified, false);
assert.equal(calls.filter((request) => request.method === "POST").length, 1);
assert.equal(mutableChecks, 1);
assert.deepEqual(cookies, { authelia_session: cookie });
assert.equal(JSON.stringify(first).includes(cookie), false);
await adapter.firstRun(context);
assert.equal(calls.filter((request) => request.method === "POST").length, 1);
assert.equal(passwordReads, 1);
assert.equal(adapter.ready(await adapter.inspect!(context)), true);
assert.equal(calls.filter((request) => request.method === "POST").length, 1);
// Broken/missing owner HTTPS must stop before password release or authentication.
cookies = {};
context.http.request = async (request: any) => { assert.equal(request.method, "GET"); throw new Error("HTTPS owner proof unavailable"); };
await assert.rejects(adapter.firstRun(context), /HTTPS owner proof unavailable/);
assert.equal(passwordReads, 1);
console.log("Authelia private hash/YAML and HTTPS first-factor setup fixture: pass");
