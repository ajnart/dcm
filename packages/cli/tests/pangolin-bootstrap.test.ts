import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/pangolin/setup.ts";
import { pangolinSetupComplete, pangolinTokenValidationRequest, pangolinTokenValid,
  pangolinFirstAdminRequest, pangolinFirstAdminResponse, pangolinLoginRequest, pangolinLoginResponse,
  pangolinOwnedAdminReadback, pangolinRootKeyRequest, pangolinRootKeyResponse, pangolinRootKeyReadback,
} from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/pangolin/bootstrap.ts";

const envelope = (data: unknown, status = 200) => ({ data, status, success: true, error: false, message: "fixture" });
const email = "owner@example.test";
const password = "Fixture-only-123!";
const setupToken = "a".repeat(32);
assert.equal(pangolinSetupComplete(envelope({ complete: false }), 200), false);
assert.equal(pangolinSetupComplete(envelope({ complete: true }), 200), true);
assert.throws(() => pangolinSetupComplete(envelope({ setupComplete: false }), 200));
assert.throws(() => pangolinSetupComplete(envelope({ complete: "false" }), 200));
assert.throws(() => pangolinSetupComplete(envelope({ complete: false }), 500));
assert.equal(pangolinTokenValid(envelope({ valid: true, message: "fixture" }), 200), true);
assert.equal(pangolinTokenValid(envelope({ valid: false, message: "fixture" }), 200), false);
assert.throws(() => pangolinTokenValid(envelope({ valid: "true", message: "fixture" }), 200));
const validate = pangolinTokenValidationRequest(setupToken);
assert.deepEqual(JSON.parse(validate.body as string), { token: setupToken });
assert.equal(validate.headers?.["x-csrf-token"], "x-csrf-protection");
assert.throws(() => pangolinTokenValidationRequest("A".repeat(32)));
const input = { setupComplete: false, tokenValid: true, freshStateVerified: true, attempted: false,
  expectedRevision: 3, email, password, setupToken };
const admin = pangolinFirstAdminRequest(input);
assert.deepEqual(JSON.parse(admin.body as string), { email, password, setupToken });
assert.deepEqual(admin.beforeSendCheckpoint, { expectedRevision: 3, stage: "admin-attempted", data: { email } });
assert.equal(admin.approval?.once, true);
for (const patch of [{ setupComplete: true }, { tokenValid: false }, { freshStateVerified: false },
  { attempted: true }, { attempted: "false" }, { expectedRevision: -1 }, { expectedRevision: undefined },
  { password: "all-lowercase-123!" }, { password: "A1!" + "b".repeat(126) }, { email: "Owner@example.test" }]) {
  assert.throws(() => pangolinFirstAdminRequest({ ...input, ...patch } as any));
}
pangolinFirstAdminResponse(envelope(null), 200);
assert.throws(() => pangolinFirstAdminResponse(envelope({ userId: "unknown" }), 200));
const login = pangolinLoginRequest(email, password);
assert.equal(login.headers?.Cookie, undefined);
assert.equal(login.beforeSendCheckpoint, undefined);
pangolinLoginResponse({ ...envelope(null), message: "Logged in successfully" }, 200);
assert.throws(() => pangolinLoginResponse({ ...envelope(null), message: "Already logged in" }, 200));
assert.throws(() => pangolinLoginResponse(envelope({ codeRequested: true }, 202), 202));
assert.throws(() => pangolinLoginResponse(envelope({ emailVerificationRequired: true }), 200));
const user = { userId: "b".repeat(15), email, username: email, type: "internal", serverAdmin: true, emailVerified: true };
const ownedAdmin = pangolinOwnedAdminReadback(envelope(user), 200, email);
for (const patch of [{ email: "other@example.test" }, { username: "other" }, { serverAdmin: false },
  { serverAdmin: "true" }, { type: "oidc" }, { emailVerified: false }, { userId: "bad/id" }]) {
  assert.throws(() => pangolinOwnedAdminReadback(envelope({ ...user, ...patch }), 200, email));
}
assert.throws(() => pangolinOwnedAdminReadback(envelope(user), 200, email, "c".repeat(15)));
const keyInput = { ownedAdmin, rootKeyApproved: true, attempted: false, expectedRevision: 4, savedKeyPresent: false, name: "fixture-key" };
assert.equal(pangolinRootKeyRequest(keyInput).beforeSendCheckpoint?.expectedRevision, 4);
assert.deepEqual(pangolinRootKeyRequest(keyInput).beforeSendCheckpoint?.data, { email });
// Real checkpoint CAS replaces data rather than merging it. Both writes must
// therefore retain identity for the adapter's interrupted-run validation.
for (const request of [admin, pangolinRootKeyRequest(keyInput)]) {
  const replacement = { stage: request.beforeSendCheckpoint!.stage, data: request.beforeSendCheckpoint!.data ?? {} };
  assert.equal(replacement.data.email, email);
}
for (const patch of [{ rootKeyApproved: false }, { attempted: true }, { savedKeyPresent: true }, { name: "" }]) {
  assert.throws(() => pangolinRootKeyRequest({ ...keyInput, ...patch }));
}
const key = { apiKeyId: "c".repeat(15), apiKey: "d".repeat(40), lastChars: "dddd", createdAt: "2026-10-03T00:00:00.000Z", name: "fixture-key" };
const saved = pangolinRootKeyResponse(envelope(key, 201), 201, "fixture-key");
assert.equal(saved.apiKey, key.apiKey);
pangolinRootKeyReadback(envelope({ ...key, apiKey: undefined, isRoot: true }), 200, saved);
assert.throws(() => pangolinRootKeyResponse(envelope({ ...key, lastChars: "xxxx" }, 201), 201, key.name));
assert.throws(() => pangolinRootKeyResponse(envelope(key, 201), 201, "other"));
assert.throws(() => pangolinRootKeyReadback(envelope({ ...key, isRoot: false }), 200, saved));
assert.throws(() => pangolinRootKeyReadback(envelope({ ...key, isRoot: true, apiKeyId: "e".repeat(15) }), 200, saved));
const projectRoot = "/tmp/pangolin-bootstrap-fixture";
const canonicalOrigin = "https://pangolin.example.test";
const selectionFingerprint = "a".repeat(64);
const apiKeyFile = `${projectRoot}/private/pangolin-api-key`;
const combined = `${key.apiKeyId}.${key.apiKey}`;
const record = await adapter.inspect!({
 appId: "pangolin", projectRoot,
 status: async () => ({ command: "app status", appId: "pangolin", projectRoot,
  status: "applied", mutation: false, runtime: { state: "running" }, ownerKind: "shared",
  username: email, passwordFile: `${projectRoot}/private/admin-password`, setupUrl: canonicalOrigin, selectionFingerprint,
  derivedRecipe: { appId: "pangolin", selectionFingerprint, bindingHash: "b".repeat(64), configurationFilesVerified: true,
   input: { appId: "pangolin", inputs: { email, "canonical-origin": canonicalOrigin, "base-domain": "resources.example.test" } },
   configuration: { email, canonicalOrigin, baseDomain: "resources.example.test", scope: "administration-only" } } }),
 checkpoint: { read: async () => ({ stage: "administration-prepared", data: { email, userId: user.userId,
  apiKeyId: key.apiKeyId, createdAt: key.createdAt, lastChars: key.lastChars, apiKeyFile,
  apiKeySha256: createHash("sha256").update(combined).digest("hex") } }) },
 secrets: { readSessionCookies: async () => ({ p_session_token: "a".repeat(32) }),
  readApiKey: async () => combined, apiKeyPath: async () => apiKeyFile },
 http: { request: async (request: { path: string }) => {
  let data: unknown = user;
  if (request.path !== "/api/v1/user") data = { ...key, name: "Auto-Stack private administrative root key", isRoot: true };
  return { status: 200, json: async () => envelope(data) };
 } },
} as any);
assert.equal(record.projectRoot, projectRoot);
assert.equal(adapter.ready(record), true);
console.log("Pangolin staged bootstrap fixture passed");
