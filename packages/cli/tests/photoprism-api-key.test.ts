import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/photoprism/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest, SetupHttpResponse } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

// Entirely synthetic credentials; no service, session store, or private file.
const projectRoot = "/tmp/photoprism-api-key-synthetic";
const password = "p".repeat(48);
const transient = "a".repeat(48);
const renewedTransient = "b".repeat(48);
const key = "OXiV72-wTtiL9-d04jO7-X7XP4p";
const id = createHash("sha256").update(key).digest("hex");
const user = { ID: 1, UID: "u000000000000001", Name: "admin", Role: "admin", CanLogin: true };
const lifetime = 31536000;
const createdAt = "2026-10-03T10:00:00Z";
const expires = Date.parse(createdAt) / 1000 + lifetime;
const login = { status: "success", access_token: transient,
  session_id: createHash("sha256").update(transient).digest("hex"), user };
const created = { status: "success", access_token: key, session_id: id, token_type: "Bearer",
  client_name: "Self-host API", scope: "read", expires_in: lifetime, client_role: "none" };
const readback = { ...created, provider: "application", user };
const entry = { ID: "sess00000001", UserUID: user.UID, UserName: "admin", ClientUID: "",
  ClientName: "Self-host API", AuthProvider: "application", AuthMethod: "default", GrantType: "password",
  AuthScope: "read", Expires: expires, Timeout: 0, CreatedAt: createdAt };

function response(value: unknown, status = 200): SetupHttpResponse {
  return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } },
    async json() { return value; }, async text() { return JSON.stringify(value); },
    async arrayBuffer() { return new TextEncoder().encode(JSON.stringify(value)).buffer; } };
}

function fixture() {
  let saved: string | null = null;
  let checkpoint: SetupCheckpoint | null = null;
  let creations = 0;
  let secretReads = 0;
  let logins = 0;
  let privateSession: Record<string, string> = {};
  const requests: SetupHttpRequest[] = [];
  const state = { login: login as unknown, readback: readback as unknown, created: created as unknown,
    adminReadback: login as unknown, adminReadbackStatus: 200, adminUsername: "admin",
    entries: [entry] as unknown[], anonymous: 401, createStatus: 200, readbackStatus: 200,
    lostResponse: false, interruptedReadback: false, interruptedSave: false, preexisting: false,
    deferCreation: false, expiredSessionOnce: false, passwordRotated: false };
  const context = {
    appId: "photoprism", projectRoot, inputs: {}, installedAppIds: ["photoprism"],
    async status() { return { command: "app status", appId: "photoprism", projectRoot,
      status: "applied", mutation: false, runtime: { state: "running" }, username: state.adminUsername,
      passwordFile: `${projectRoot}/admin-password` }; },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(next) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "photoprism", projectRoot,
          revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
          attemptedActions: checkpoint?.attemptedActions ?? [], data: { ...next.data } };
        return checkpoint;
      },
    },
    secrets: {
      async readSessionCookies() { return { ...privateSession }; },
      async writeSessionCookies(value) { privateSession = { ...value }; },
      async readAdminPassword() { secretReads++; return password; },
      async readApiKey() { return saved; },
      async writeApiKey(value) {
        saved = value;
        if (state.interruptedSave) throw new Error("Synthetic interrupted save return");
        return `${projectRoot}/api-key`;
      },
      async apiKeyPath() { if (saved !== null) return `${projectRoot}/api-key`; return null; },
    },
    http: {
      async request(request) {
        requests.push(request);
        if (request.beforeSendCheckpoint) {
          if (state.deferCreation) throw new Error("Synthetic deferred creation approval");
          assert.equal(request.approval?.once, true);
          await context.checkpoint.compareAndSet(request.beforeSendCheckpoint);
          assert.ok(checkpoint);
          checkpoint.attemptedActions.push(request.approval!.action);
        }
        if (request.path === "/api/v1/session") {
          if (request.method === "POST") {
            logins++;
            assert.deepEqual(JSON.parse(String(request.body)), { username: "admin", password });
            if (state.passwordRotated) return response({}, 401);
            if (state.login === login && logins > 1) return response({ ...login,
              access_token: renewedTransient, session_id: createHash("sha256").update(renewedTransient).digest("hex") });
            return response(state.login);
          }
          if (request.headers?.Authorization) {
            const bearer = request.headers.Authorization.slice("Bearer ".length);
            assert.ok([transient, renewedTransient].includes(bearer));
            if (state.expiredSessionOnce) {
              state.expiredSessionOnce = false;
              return response({}, 401);
            }
            if (state.adminReadback === login) return response({ ...login, access_token: bearer,
              session_id: createHash("sha256").update(bearer).digest("hex") }, state.adminReadbackStatus);
            return response(state.adminReadback, state.adminReadbackStatus);
          }
          return response({}, state.anonymous);
        }
        if (request.path === `/api/v1/users/${user.UID}/sessions`) {
          assert.deepEqual(request.query, { count: "100", q: "Self-host API" });
          assert.equal(request.headers?.Authorization, `Bearer ${privateSession.access_token}`);
          if (creations === 0 && !state.preexisting) return response([]);
          return response(state.entries);
        }
        if (request.path === "/api/v1/oauth/token") {
          assert.equal(request.headers?.Authorization, `Bearer ${privateSession.access_token}`);
          assert.deepEqual(JSON.parse(String(request.body)), { grant_type: "password", username: "admin",
            password, client_name: "Self-host API", scope: "read", expires_in: lifetime });
          creations++;
          if (state.lostResponse) throw new Error("Synthetic lost creation response");
          return response(state.created, state.createStatus);
        }
        assert.equal(request.path, `/api/v1/session/${id}`);
        assert.equal(request.headers?.Authorization, `Bearer ${key}`);
        assert.equal(saved, key, "Save the one-time secret before any further request");
        if (state.interruptedReadback) throw new Error("Synthetic interrupted readback");
        return response(state.readback, state.readbackStatus);
      },
    },
  } as SetupContext;
  return { context, state, requests, get saved() { return saved; }, get creations() { return creations; },
    get secretReads() { return secretReads; }, get checkpoint() { return checkpoint; },
    get logins() { return logins; }, get privateSession() { return { ...privateSession }; },
    setPrivateSession(value: Record<string, string>) { privateSession = { ...value }; },
    setCheckpoint(value: SetupCheckpoint) { checkpoint = value; }, setKey(value: string) { saved = value; } };
}

const normal = fixture();
const result = await adapter.firstRun(normal.context);
assert.equal(adapter.ready(result), true);
assert.equal(adapter.apiKey, "saved-by-onboarding");
assert.equal(normal.saved, key);
assert.equal(result.apiScope, "read");
assert.equal(result.apiExpiresAt, expires);
assert.equal(result.apiCreationId, entry.ID);
assert.equal(result.acceptanceVerified, false);
assert.equal(adapter.compatibilityResult!(result), null, "Environment-seeded login does not observe fresh owner creation");
assert.equal(result.setupCompatibility, undefined);
const replay = await adapter.firstRun(normal.context);
assert.equal(adapter.compatibilityResult!({ ...replay }), null, "Only the exact live record carries proof");
assert.equal(adapter.compatibilityResult!(JSON.parse(JSON.stringify(replay))), null, "Persisted output carries no live proof");
assert.deepEqual(adapter.compatibilityResult!(replay), { origin: "resume", credentialReadback: "verified" });
assert.equal(adapter.compatibilityResult!(replay), null, "Live proof is consumed exactly once");
assert.equal(adapter.compatibilityResult!({ ...replay, setupCompatibility: { origin: "fresh", credentialReadback: "verified" } }), null);
assert.equal(normal.creations, 1, "Verified replay never replaces a key");
assert.equal(normal.logins, 2, "Replay rechecks password without replacing the approved bearer");
assert.equal(normal.privateSession.access_token, transient);
assert.equal(normal.checkpoint?.data.userId, user.ID);
assert.equal(normal.checkpoint?.data.userUid, user.UID);
for (const secret of [password, transient, key]) assert.ok(!JSON.stringify(result).includes(secret));

const deferred = fixture();
deferred.state.deferCreation = true;
await assert.rejects(adapter.firstRun(deferred.context), /deferred creation approval/);
const reviewed = deferred.requests.find((request) => request.path === "/api/v1/oauth/token");
assert.ok(reviewed);
deferred.state.deferCreation = false;
await adapter.firstRun(deferred.context);
assert.deepEqual(deferred.requests.filter((request) => request.path === "/api/v1/oauth/token")[1], reviewed);
assert.equal(deferred.logins, 2, "Independent password verification retains the approved bearer");
assert.equal(deferred.creations, 1);

const expiredSession = fixture();
await adapter.firstRun(expiredSession.context);
expiredSession.state.expiredSessionOnce = true;
await adapter.firstRun(expiredSession.context);
assert.equal(expiredSession.logins, 2, "Definitive session expiry renews login without creating a key");
assert.equal(expiredSession.creations, 1);
for (const status of [403, 500]) {
  const uncertainSession = fixture();
  await adapter.firstRun(uncertainSession.context);
  const preserved = uncertainSession.privateSession;
  uncertainSession.state.adminReadbackStatus = status;
  await assert.rejects(adapter.firstRun(uncertainSession.context), /saved session did not authenticate/);
  assert.deepEqual(uncertainSession.privateSession, preserved);
  assert.equal(uncertainSession.logins, 1);
  assert.equal(uncertainSession.creations, 1);
}
const changedSessionIdentity = fixture();
await adapter.firstRun(changedSessionIdentity.context);
const originalSession = changedSessionIdentity.privateSession;
changedSessionIdentity.state.adminReadback = { ...login, user: { ...user, ID: 2, UID: "other" } };
await assert.rejects(adapter.firstRun(changedSessionIdentity.context), /session readback differs/);
assert.deepEqual(changedSessionIdentity.privateSession, originalSession);
assert.equal(changedSessionIdentity.logins, 1);
assert.equal(changedSessionIdentity.creations, 1);
const changedCredential = fixture();
await adapter.firstRun(changedCredential.context);
changedCredential.setPrivateSession({ ...changedCredential.privateSession, password_digest: "b".repeat(64) });
await assert.rejects(adapter.firstRun(changedCredential.context), /differs from its saved credential/);
assert.equal(changedCredential.logins, 1);
assert.equal(changedCredential.creations, 1);
const rotatedPassword = fixture();
await adapter.firstRun(rotatedPassword.context);
const preservedPasswordSession = rotatedPassword.privateSession;
rotatedPassword.state.passwordRotated = true;
await assert.rejects(adapter.firstRun(rotatedPassword.context), /did not authorize its generated administrator credential/);
assert.deepEqual(rotatedPassword.privateSession, preservedPasswordSession);
assert.equal(rotatedPassword.creations, 1, "Live cached bearer cannot hide a changed administrator password");

for (const phase of ["interruptedReadback", "interruptedSave"] as const) {
  const recovery = fixture();
  recovery.state[phase] = true;
  await assert.rejects(adapter.firstRun(recovery.context), /Synthetic interrupted/);
  assert.equal(recovery.saved, key);
  recovery.state[phase] = false;
  const recovered = await adapter.firstRun(recovery.context);
  assert.equal(adapter.ready(recovered), true);
  assert.equal(adapter.compatibilityResult!(recovered), null, "Partial recovery is not an already-complete owner resume");
  const verifiedRecovery = await adapter.firstRun(recovery.context);
  assert.deepEqual(adapter.compatibilityResult!(verifiedRecovery), { origin: "resume", credentialReadback: "verified" });
  assert.equal(recovery.creations, 1);
}

const lost = fixture();
lost.state.lostResponse = true;
await assert.rejects(adapter.firstRun(lost.context), /lost creation response/);
await assert.rejects(adapter.firstRun(lost.context), /attempted without a saved secret/);
assert.equal(lost.creations, 1);

for (const changed of [{ ...created, scope: "*" }, { ...created, session_id: "b".repeat(64) },
  { ...created, expires_in: 0 }, { ...created, client_name: "Other" }]) {
  const mismatch = fixture();
  mismatch.state.created = changed;
  await assert.rejects(adapter.firstRun(mismatch.context), /metadata differs/);
  assert.equal(mismatch.saved, key, "Preserve valid returned secret even when metadata is wrong");
  assert.equal(mismatch.creations, 1);
}

for (const changed of [{ ...readback, scope: "*" }, { ...readback, provider: "local" },
  { ...readback, expires_in: 0 }, { ...readback, session_id: "b".repeat(64) },
  { ...readback, user: { ...user, ID: 2 } }, { ...readback, user: { ...user, UID: "other" } },
  { ...readback, user: { ...user, Role: "user" } }, { ...readback, user: { ...user, CanLogin: false } }]) {
  const mismatch = fixture();
  mismatch.state.readback = changed;
  await assert.rejects(adapter.firstRun(mismatch.context), /identity, provider, scope, or expiry differs/);
  await assert.rejects(adapter.firstRun(mismatch.context), /identity, provider, scope, or expiry differs/);
  assert.equal(mismatch.creations, 1);
}
for (const changed of [{ ...entry, AuthScope: "*" }, { ...entry, Timeout: 3600 },
  { ...entry, GrantType: "session" }, { ...entry, Expires: expires - 3600 }, { ...entry, UserUID: "other" }]) {
  const mismatch = fixture();
  mismatch.state.entries = [changed];
  await assert.rejects(adapter.firstRun(mismatch.context), /creation record or lifetime differs/);
  assert.equal(mismatch.saved, key);
}

for (const changed of [{ id: transient }, { ...login, status: "failed" }, { ...login, session_id: "b".repeat(64) },
  { ...login, access_token: "short" }, { ...login, user: { ...user, Name: "other" } },
  { ...login, user: { ...user, Role: "user" } },
  { ...login, user: { ...user, CanLogin: false } }, { ...login, access_token: key }]) {
  const denied = fixture();
  denied.state.login = changed;
  await assert.rejects(adapter.firstRun(denied.context), /active administrator session|session user returned an invalid/);
  assert.equal(denied.creations, 0);
}
const publicMode = fixture();
publicMode.state.anonymous = 200;
await assert.rejects(adapter.firstRun(publicMode.context), /deny anonymous/);
assert.equal(publicMode.creations, 0);
assert.equal(publicMode.requests.length, 1, "Public mode is denied before credential submission");
const wrongAdminReadback = fixture();
wrongAdminReadback.state.adminReadback = { ...login, user: { ...user, ID: 2, UID: "u000000000000002" } };
await assert.rejects(adapter.firstRun(wrongAdminReadback.context), /session readback differs/);
assert.equal(wrongAdminReadback.creations, 0);
const deniedAdminReadback = fixture();
deniedAdminReadback.state.adminReadbackStatus = 401;
await assert.rejects(adapter.firstRun(deniedAdminReadback.context), /saved session did not authenticate/);
assert.equal(deniedAdminReadback.creations, 0);
const wrongAdminOwner = fixture();
wrongAdminOwner.state.adminUsername = "other";
await assert.rejects(adapter.firstRun(wrongAdminOwner.context), /exact saved administrator credential/);
assert.equal(wrongAdminOwner.secretReads, 0);
assert.equal(wrongAdminOwner.requests.length, 0);
const disabled = fixture();
disabled.state.createStatus = 403;
await assert.rejects(adapter.firstRun(disabled.context), /outcome is uncertain/);
await assert.rejects(adapter.firstRun(disabled.context), /attempted without a saved secret/);
assert.equal(disabled.creations, 1);
const existing = fixture();
existing.state.preexisting = true;
await assert.rejects(adapter.firstRun(existing.context), /outside this setup/);
assert.equal(existing.creations, 0);
const transientCreation = fixture();
transientCreation.state.created = { ...created, access_token: transient };
await assert.rejects(adapter.firstRun(transientCreation.context), /no usable app password/);
assert.equal(transientCreation.saved, null);
await assert.rejects(adapter.firstRun(transientCreation.context), /attempted without a saved secret/);
assert.equal(transientCreation.creations, 1);
const duplicate = fixture();
duplicate.state.entries = [entry, entry];
await assert.rejects(adapter.firstRun(duplicate.context), /no unique matching/);
const deniedReadback = fixture();
deniedReadback.state.readbackStatus = 401;
await assert.rejects(adapter.firstRun(deniedReadback.context), /did not authenticate/);
assert.equal(deniedReadback.saved, key);

const wrongOwner = fixture();
assert.ok(normal.checkpoint);
wrongOwner.setCheckpoint({ ...normal.checkpoint, projectRoot: "/tmp/other-owner" });
await assert.rejects(adapter.firstRun(wrongOwner.context), /unexpected API app password checkpoint/);
assert.equal(wrongOwner.secretReads, 0);
assert.equal(wrongOwner.requests.length, 0);
const missingAttempt = fixture();
missingAttempt.setCheckpoint({ ...normal.checkpoint, attemptedActions: [] });
await assert.rejects(adapter.firstRun(missingAttempt.context), /unexpected API app password checkpoint/);
const changedId = fixture();
changedId.setCheckpoint({ ...normal.checkpoint, data: { ...normal.checkpoint.data, sessionId: "b".repeat(64) } });
changedId.setKey(key);
await assert.rejects(adapter.firstRun(changedId.context), /differs from its creation identity/);
assert.equal(changedId.creations, 0);
normal.state.entries = [{ ...entry, ID: "sess00000002" }];
await assert.rejects(adapter.firstRun(normal.context), /creation record or lifetime differs/);
assert.equal(normal.creations, 1);
const unowned = fixture();
unowned.setKey(key);
await assert.rejects(adapter.firstRun(unowned.context), /no creation checkpoint/);
assert.equal(unowned.creations, 0);
console.log("PhotoPrism app password creation, private preservation, replay and identity/scope/expiry negatives passed (synthetic).");
