import assert from "node:assert/strict";
import { compilePassboltFirstStartEnvironment, compilePassboltRegistration, deriveCanonicalEnvironment, parsePassboltEnrollmentOutput } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/passbolt/configuration.ts";
import { canonicalOrigin } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/passbolt/canonical-origin.ts";
import { buildPlan, loadCatalog, stackForGoalId, validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { compilePassboltRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/passbolt/recipe.ts";
import passboltSetup from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/passbolt/setup.ts";
import { deriveSharedCreateRecipe } from "../src/lib/shared-derived-recipe.ts";
import { gpgClientEnrollmentCredential } from "../src/lib/shared-unit-setup.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const origin = "https://passbolt.example.net";
const identity = { email: "owner@example.net", firstName: "Owner's", lastName: "Chosen Name" };
assert.deepEqual(deriveCanonicalEnvironment(origin), [{ name: "APP_FULL_BASE_URL", value: origin }]);
assert.deepEqual(canonicalOrigin.derive(origin), deriveCanonicalEnvironment(origin));
const firstStart = { canonicalOrigin: origin,
  smtp: { host: "smtp.example.net", port: 587, fromEmail: "vault@example.net", fromName: "Team vault", transport: "starttls" as const },
  serverKey: { email: "server-key@example.net", name: "Vault server" } };
const firstEnvironment = compilePassboltFirstStartEnvironment(firstStart);
assert.deepEqual(firstEnvironment, [
  { name: "APP_FULL_BASE_URL", value: origin },
  { name: "PASSBOLT_SSL_FORCE", value: "true" },
  { name: "EMAIL_DEFAULT_FROM", value: firstStart.smtp.fromEmail },
  { name: "EMAIL_DEFAULT_FROM_NAME", value: firstStart.smtp.fromName },
  { name: "EMAIL_TRANSPORT_DEFAULT_HOST", value: firstStart.smtp.host },
  { name: "EMAIL_TRANSPORT_DEFAULT_PORT", value: "587" },
  { name: "EMAIL_TRANSPORT_DEFAULT_TLS", value: "true" },
  { name: "PASSBOLT_KEY_EMAIL", value: firstStart.serverKey.email },
  { name: "PASSBOLT_KEY_NAME", value: firstStart.serverKey.name },
]);
assert.deepEqual(compilePassboltFirstStartEnvironment(firstStart), firstEnvironment, "Resume must not generate or rotate identities");
for (const host of ["127.0.0.1", "::1", "mail"]) {
  assert.ok(compilePassboltFirstStartEnvironment({ ...firstStart, smtp: { ...firstStart.smtp, host } }));
}
for (const host of ["smtp://user:secret@mail.example.net", "mail.example.net/path", "mail.example.net\n", "", "mail:587"]) {
  assert.throws(() => compilePassboltFirstStartEnvironment({ ...firstStart, smtp: { ...firstStart.smtp, host } }));
}
for (const port of [0, 65536, 587.5, NaN]) {
  assert.throws(() => compilePassboltFirstStartEnvironment({ ...firstStart, smtp: { ...firstStart.smtp, port } }));
}
assert.throws(() => compilePassboltFirstStartEnvironment({ ...firstStart, smtp: { ...firstStart.smtp, transport: "plain" as "starttls" } }));
assert.throws(() => compilePassboltFirstStartEnvironment({ ...firstStart, smtp: { ...firstStart.smtp, password: "fixture-only" } } as typeof firstStart));
assert.throws(() => compilePassboltFirstStartEnvironment({ ...firstStart, serverKey: { ...firstStart.serverKey, email: "" } }));
assert.throws(() => compilePassboltRegistration({ ...identity, email: "owner\x7f@example.net" }, origin));
const command = compilePassboltRegistration(identity, origin);
assert.equal(command.user, "www-data");
assert.deepEqual(command.argv, ["/usr/share/php/passbolt/bin/cake", "passbolt", "register_user", "-u", identity.email,
  "-f", identity.firstName, "-l", identity.lastName, "-r", "admin"]);
assert.equal(command.outputCustody, "private-enrollment-link");
assert.throws(() => compilePassboltRegistration({ ...identity, email: "" }, origin));
assert.throws(() => compilePassboltRegistration({ ...identity, firstName: "\n" }, origin));
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const link = `${origin}/setup/start/${userId}/${token}`;
assert.deepEqual(parsePassboltEnrollmentOutput(`User saved successfully.\n${link}\n`, origin),
  { enrollmentUrl: link, userId });
for (const bad of ["", `${link}\n${link}`, link.replace(origin, "https://other.example.net"),
  link.replace("/setup/start/", "/setup/finish/"), `${link}?token=other`, `${link}#fragment`, `${link}/`,
  link.replace(userId, "not-a-uuid"), `\x1b[31m${link}`, `https://user:pass@passbolt.example.net/setup/start/${userId}/${token}`]) {
  assert.throws(() => parsePassboltEnrollmentOutput(bad, origin));
}
for (const bad of ["http://127.0.0.1:8000", `${origin}/`, `${origin}/vault`, `${origin}?key=value`]) {
  assert.throws(() => deriveCanonicalEnvironment(bad));
}
const catalog = await loadCatalog();
const app = catalog.apps.find((entry) => entry.id === "passbolt")!;
assert.equal(app.image.reference, "docker.io/passbolt/passbolt:5.16.0-1-ce");
assert.equal(app.image.status, "known");
assert.equal(app.support.automation, "discovery", "Verified image metadata must not promote setup support");
const inputs = { "canonical-origin": origin, "smtp-host": "smtp.example.net", "smtp-port": "587",
  "smtp-auth": "none", "from-email": "vault@example.net", "from-name": "Vault",
  "server-key-email": "server@example.net", "server-key-name": "Vault" };
const compiled = compilePassboltRecipe(inputs);
assert.deepEqual(validateAppRecipe(compiled.recipe, app), []);
assert.deepEqual(compilePassboltRecipe(inputs), compiled);
const derived = deriveSharedCreateRecipe({ projectRoot: "/tmp/passbolt-fixture", projectId: "fixture",
  dockerContext: "default", uid: 1000, gid: 1000, timezone: "UTC", apps: [],
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } },
{ appId: "passbolt", inputs });
assert.deepEqual(derived.recipe, compiled.recipe, "Installed discovery must consume the actual recipe compiler");
const candidate = sharedProjectCandidate({ projectRoot: "/tmp/passbolt-fixture", projectId: "fixture",
  dockerContext: "default", uid: 1000, gid: 1000, timezone: "UTC",
  apps: [{ appId: "passbolt", recipe: derived.recipe, port: 18085,
    images: Object.fromEntries(derived.recipe.services.map((service: any) => [service.id,
      `${service.imageTag}@sha256:${"a".repeat(64)}`])) }],
  observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
const composePlan = await createSelfhostComposeOwner(candidate.manifest).plan();
assert.equal(composePlan.status, "pass", "Real shared compiler and Compose owner must accept the sourced identity settings");
assert.equal(compiled.recipe.services[0]!.publishTargetPort, 80);
assert.equal(compiled.recipe.services[1]!.publishTargetPort, null);
assert.deepEqual(compiled.recipe.privateFiles.map((file) => file.id), ["database-password", "database-root-password"]);
assert.equal(compiled.recipe.onboarding.kind, "gpg-client-enrollment");
const credentials = gpgClientEnrollmentCredential(compiled.recipe)!;
assert.equal(credentials.passwordFile, null);
assert.equal(credentials.accountCreated, false);
assert.equal(credentials.enrollmentStatus, "pending");
assert.equal(credentials.loginVia, "gpg-client-enrollment");
assert.throws(() => gpgClientEnrollmentCredential({ ...compiled.recipe,
  privateFiles: [...compiled.recipe.privateFiles, { id: "admin-password", bytes: 48 }] }));
assert.throws(() => compilePassboltRecipe({ ...inputs, "smtp-auth": "password" }));
assert.throws(() => compilePassboltRecipe({ ...inputs, "smtp-port": "587.0" }));
assert.throws(() => compilePassboltRecipe({ ...inputs, "canonical-origin": "http://localhost" }));
await assert.rejects(passboltSetup.firstRun({ status: async () => ({}) } as never));
assert.equal(passboltSetup.ready({ appId: "passbolt", stage: "pending-gpg-client-enrollment" }), false);
assert.equal(passboltSetup.ready({ appId: "passbolt", stage: "gpg-administrator-verified",
  loginVerified: true, clientPrivateKeyCustodyVerified: true }), true);
let checkpoint: any = null, privateSession: any = null, savedCookies: any = {};
let captured: any = null, active = false, loggedIn = false, custody = false;
let registrations = 0, activations = 0;
const clientFingerprint = "A".repeat(40), serverFingerprint = "B".repeat(40);
const response = (status: number, value: unknown, fields: Record<string, string> = {}, cookies: string[] = []) => ({
  status, headers: { get: (key: string) => fields[key] ?? null, getSetCookie: () => cookies },
  json: async () => value });
const success = (value: unknown) => ({ header: { status: "success" }, body: value });
const context: any = { appId: "passbolt", projectRoot: "/tmp/passbolt-fixture",
  inputs: { email: identity.email, "first-name": identity.firstName, "last-name": identity.lastName,
    "server-fingerprint": serverFingerprint },
  status: async () => ({ command: "app status", appId: "passbolt", projectRoot: "/tmp/passbolt-fixture",
    ownerKind: "shared", status: "applied", mutation: false, runtime: { state: "running" },
    setupUrl: origin, derivedRecipe: { configuration: { canonicalOrigin: origin } } }),
  checkpoint: { read: async () => checkpoint, compareAndSet: async (next: any) => {
    assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
    checkpoint = { ...next, revision: (checkpoint?.revision ?? 0) + 1 }; return checkpoint;
  } },
  crypto: { inspectPublicKey: async () => ({ fingerprint: serverFingerprint }),
    ensureClientKey: async () => { custody = true; return { fingerprint: clientFingerprint, publicKey: "PUBLIC", custodyPath: "/tmp/private-key-custody" }; },
    encryptSign: async () => "ENCRYPTED", decryptVerify: async () => `gpgauthv1.3.0|36|${token}|gpgauthv1.3.0` },
  secrets: { readSessionCookies: async () => savedCookies, writeSessionCookies: async (value: any) => { savedCookies = value; },
    readSetupSession: async () => privateSession, writeSetupSession: async (value: any) => { privateSession = value; } },
  passbolt: { readInvitation: async () => captured, registerFirstAdmin: async (input: any) => {
    registrations++; assert.equal(custody, true);
    await context.checkpoint.compareAndSet(input.beforeSendCheckpoint); captured = { userId, token }; return captured;
  } },
  http: { request: async (request: any) => {
    assert.equal(request.requireHttps, true);
    if (request.path === "/auth/verify.json" && request.method === "GET") return response(200, success({ fingerprint: serverFingerprint, keydata: "SERVER" }));
    if (request.path === `/setup/start/${userId}/${token}.json`) return response(200, success({ user: { id: userId, username: identity.email, active: false } }));
    if (request.path === `/setup/complete/${userId}.json`) {
      assert.equal(custody, true); activations++; assert.equal(active, false);
      assert.deepEqual(JSON.parse(request.body), { authentication_token: { token }, gpgkey: { armored_key: "PUBLIC" } });
      await context.checkpoint.compareAndSet(request.beforeSendCheckpoint); active = true;
      return response(200, success(null));
    }
    if (request.path === "/users/me.json") {
      if (!loggedIn) return response(403, {});
      return response(200, success({ id: userId, username: identity.email, active: true, role: { name: "admin" }, gpgkey: { fingerprint: clientFingerprint } }));
    }
    if (request.path === "/auth/verify.json") return response(200, {}, { "X-GPGAuth-Verify-Response": privateSession.nonce });
    if (request.path === "/auth/login.json") {
      assert.equal(active, true);
      if (!JSON.parse(request.body).gpg_auth.user_token_result) return response(200, {}, { "X-GPGAuth-Progress": "stage1", "X-GPGAuth-User-Auth-Token": encodeURIComponent("ARMOR") });
      loggedIn = true;
      return response(200, {}, { "X-GPGAuth-Authenticated": "true", "X-GPGAuth-Progress": "complete" }, ["passbolt_session=private-fixture-session; Secure; HttpOnly"]);
    }
    throw new Error("Unexpected Passbolt native request");
  } },
};
const enrolled = await passboltSetup.firstRun(context);
assert.equal(passboltSetup.ready(enrolled), true);
assert.equal(enrolled.smtpDeliveryVerified, false);
assert.equal(enrolled.encryptedRoundTripVerified, false);
assert.equal(passboltSetup.ready(await passboltSetup.firstRun(context)), true);
assert.equal(registrations, 1); assert.equal(activations, 1);
const nativeRequest = context.http.request;
const staleAttempt = { fingerprint: clientFingerprint, serverFingerprint, serverVerified: "true",
  nonce: "fixture-private-nonce", encrypted: Buffer.from("ENCRYPTED").toString("base64"),
  userToken: `gpgauthv1.3.0|36|${userId}|gpgauthv1.3.0` };
loggedIn = false; savedCookies = {}; privateSession = { ...staleAttempt };
let rejectedOldToken = false, refreshedChallenge = false;
context.http.request = async (request: any) => {
  if (request.path === "/auth/login.json") {
    const auth = JSON.parse(request.body).gpg_auth;
    if (auth.user_token_result === staleAttempt.userToken) {
      rejectedOldToken = true;
      return response(400, { header: { status: "error" } }, { "X-GPGAuth-Progress": "stage2", "X-GPGAuth-Authenticated": "false" });
    }
    if (!auth.user_token_result) refreshedChallenge = true;
  }
  return nativeRequest(request);
};
assert.equal(passboltSetup.ready(await passboltSetup.firstRun(context)), true);
assert.equal(rejectedOldToken, true); assert.equal(refreshedChallenge, true);
assert.equal(privateSession, null);
assert.equal(registrations, 1); assert.equal(activations, 1);
// Unknown stage2 outcomes preserve attempt state; a proven owner after a lost
// success response clears it without creating another key/invitation/account.
loggedIn = false; savedCookies = {}; privateSession = { ...staleAttempt };
context.http.request = async (request: any) => {
  if (request.path === "/auth/login.json") throw new Error("Unknown stage2 outcome");
  return nativeRequest(request);
};
await assert.rejects(passboltSetup.firstRun(context), /Unknown stage2 outcome/);
assert.deepEqual(privateSession, staleAttempt);
context.http.request = async (request: any) => {
  if (request.path === "/auth/login.json") { loggedIn = true; throw new Error("Lost successful stage2 response"); }
  return nativeRequest(request);
};
assert.equal(passboltSetup.ready(await passboltSetup.firstRun(context)), true);
assert.equal(privateSession, null);
assert.equal(registrations, 1); assert.equal(activations, 1);
const stack = stackForGoalId(catalog, "application-passbolt");
assert.ok(stack);
const plan = buildPlan(catalog, stack, { "control-plane": "none" });
for (const prerequisite of ["smtp", "owner-selected-canonical-origin", "private-registration-link-custody",
  "official-client-gpg-enrollment", "vault-recovery"]) {
  assert.ok(plan.requiredCapabilities.includes(prerequisite), `Exact Passbolt plan must preserve ${prerequisite}`);
}
console.log("Passbolt canonical/private enrollment parser and real catalog prerequisite plan: pass (no application acceptance)");
