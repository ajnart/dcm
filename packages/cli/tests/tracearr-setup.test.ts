import assert from "node:assert/strict";
import tracearr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/tracearr/setup.ts";
import type { SetupContext, SetupCheckpoint, SetupHttpRequest, SetupCheckpointUpdate } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const projectRoot = "/tmp/tracearr-setup-fixture";
const keyPath = `${projectRoot}/secrets/tracearr-api-key`;
const key = `trr_pub_${"a".repeat(43)}`;
const userId = "11111111-1111-4111-8111-111111111111";
const password = "b".repeat(48);
const email = "owner@example.test";

function fixture() {
  const state = { owned: false, token: null as string | null, privateKey: null as string | null,
    checkpoint: null as SetupCheckpoint | null, signupCount: 0, keyCount: 0, loseSignup: false,
    loseKey: false, persistSignup: true, persistKey: true, role: "owner", version: "2.6.0", claim: false,
    cookies: {} as Record<string, string>, loginCount: 0, loginStatus: 200, freshIdentityStatus: 200,
    freshUserId: userId, identityStatus: 200, loseIdentity: false };
  function update(next: SetupCheckpointUpdate, action?: string) {
    assert.equal(next.expectedRevision, state.checkpoint?.revision ?? null);
    const actions = [...(state.checkpoint?.attemptedActions ?? [])];
    if (action) { assert.ok(!actions.includes(action)); actions.push(action); }
    state.checkpoint = { schemaVersion: 1, appId: "tracearr", projectRoot,
      revision: (state.checkpoint?.revision ?? 0) + 1, stage: next.stage, data: next.data ?? {}, attemptedActions: actions };
    return state.checkpoint;
  }
  function attempt(request: SetupHttpRequest) {
    assert.equal(request.approval?.once, true);
    assert.ok(request.beforeSendCheckpoint);
    update(request.beforeSendCheckpoint, request.approval?.action);
  }
  function response(value: unknown) {
    return { status: 200, ok: true, headers: { get() { return null; } }, async json() { return value; }, async text() { return JSON.stringify(value); } };
  }
  const context = {
    appId: "tracearr", projectRoot, inputs: { email },
    async status() { return { command: "app status", appId: "tracearr", projectRoot, status: "applied", mutation: false,
      username: "admin", passwordFile: `${projectRoot}/secrets/admin-password`, runtime: { state: "running" } }; },
    checkpoint: { async read() { return state.checkpoint; }, async compareAndSet(next: SetupCheckpointUpdate) { return update(next); } },
    secrets: { async readAdminPassword() { return password; }, async readApiKey() { return state.privateKey; },
      async readSessionCookies() { return { ...state.cookies }; },
      async writeSessionCookies(value: Record<string, string>) { state.cookies = { ...value }; },
      async apiKeyPath() { if (state.privateKey === null) return null; return keyPath; },
      async writeApiKey(value: string) { assert.equal(value, key); state.privateKey = value; return keyPath; } },
    http: { async request(request: SetupHttpRequest) {
      if (request.path === "/health") return response({ status: "ok", mode: "ready", db: true, redis: true });
      if (request.path === "/api/v1/version") return response({ current: { version: state.version } });
      if (request.path === "/api/v1/setup/status") return response({ needsSetup: !state.owned, requiresClaimCode: state.claim, authMethods: { local: true } });
      if (request.path === "/api/v1/auth/sign-up/email") {
        assert.equal(request.method, "POST");
        assert.deepEqual(JSON.parse(request.body as string), { name: "Administrator", username: "admin", email, password });
        assert.equal(state.owned, false);
        attempt(request); state.signupCount++;
        if (state.persistSignup) state.owned = true;
        if (state.loseSignup) throw new Error("lost signup response");
        return response({ token: "session" });
      }
      if (request.path === "/api/v1/auth/sign-in/username") {
        assert.equal(request.method, "POST"); assert.ok(request.approval);
        assert.deepEqual(JSON.parse(request.body as string), { username: "admin", password });
        assert.equal(state.owned, true);
        state.loginCount++;
        if (state.loginStatus !== 200) return { ...response({}), status: state.loginStatus, ok: false };
        return response({ token: `${"s".repeat(32)}${state.loginCount}` });
      }
      if (request.path === "/api/v1/auth/me") {
        const freshSession = request.headers?.Authorization !== `Bearer ${state.cookies.bearer}`;
        if (freshSession && state.freshIdentityStatus !== 200) return { ...response({}), status: state.freshIdentityStatus, ok: false };
        if (state.loseIdentity) throw new Error("lost identity response");
        if (state.identityStatus !== 200) return { ...response({}), status: state.identityStatus, ok: false };
        return response({ username: "admin", email, userId: freshSession ? state.freshUserId : userId, role: state.role });
      }
      if (request.path === "/api/v1/settings/api-key") {
        assert.equal(request.headers?.Authorization, `Bearer ${state.cookies.bearer}`);
        return response({ token: state.token });
      }
      if (request.path === "/api/v1/settings/api-key/regenerate") {
        assert.equal(request.method, "POST"); assert.equal(state.token, null);
        attempt(request); state.keyCount++;
        if (state.persistKey) state.token = key;
        if (state.loseKey) throw new Error("lost key response");
        return response({ token: state.token });
      }
      if (request.path === "/api/v1/public/health") {
        assert.equal(request.headers?.Authorization, `Bearer ${key}`);
        return response({ status: "ok", version: state.version, servers: [] });
      }
      throw new Error(`Unexpected request ${request.path}`);
    } },
  } as SetupContext;
  return { context, state };
}

const fresh = fixture();
assert.equal(tracearr.ready(await tracearr.firstRun(fresh.context)), true);
assert.equal(fresh.state.signupCount, 1);
assert.equal(fresh.state.keyCount, 1);
assert.equal(fresh.state.loginCount, 1);
fresh.state.version = "v2.6.0";
assert.equal(tracearr.ready(await tracearr.firstRun(fresh.context)), true);
assert.equal(tracearr.ready(await tracearr.inspect!(fresh.context)), true);
assert.equal(fresh.state.signupCount, 1);
assert.equal(fresh.state.keyCount, 1);

for (const loss of ["loseSignup", "loseKey"] as const) {
  const lost = fixture(); lost.state[loss] = true;
  await assert.rejects(tracearr.firstRun(lost.context), /lost/);
  lost.state[loss] = false;
  assert.equal(tracearr.ready(await tracearr.firstRun(lost.context)), true);
  assert.equal(lost.state.signupCount, 1);
  assert.equal(lost.state.keyCount, 1);
}
const uncertainIdentity = fixture(); uncertainIdentity.state.loseIdentity = true;
await assert.rejects(tracearr.firstRun(uncertainIdentity.context), /lost identity/);
assert.ok(uncertainIdentity.state.cookies.bearer);
uncertainIdentity.state.loseIdentity = false;
assert.equal(tracearr.ready(await tracearr.firstRun(uncertainIdentity.context)), true);
assert.equal(uncertainIdentity.state.loginCount, 2);
for (const failure of ["password", "fresh-token", "identity"] as const) {
  const proof = fixture();
  await tracearr.firstRun(proof.context);
  const retained = { ...proof.state.cookies };
  if (failure === "password") proof.state.loginStatus = 401;
  if (failure === "fresh-token") proof.state.freshIdentityStatus = 401;
  if (failure === "identity") proof.state.freshUserId = "22222222-2222-4222-8222-222222222222";
  await assert.rejects(tracearr.firstRun(proof.context));
  assert.deepEqual(proof.state.cookies, retained);
}
for (const code of [401, 403, 503]) {
  const rejectedSession = fixture();
  await tracearr.firstRun(rejectedSession.context);
  rejectedSession.state.identityStatus = code;
  await assert.rejects(tracearr.firstRun(rejectedSession.context));
  if (code === 401) assert.deepEqual(rejectedSession.state.cookies, {});
  else assert.ok(rejectedSession.state.cookies.bearer);
  assert.equal(rejectedSession.state.loginCount, 1);
}
for (const loss of ["signup", "key"] as const) {
  const missing = fixture();
  if (loss === "signup") { missing.state.loseSignup = true; missing.state.persistSignup = false; }
  else { missing.state.loseKey = true; missing.state.persistKey = false; }
  await assert.rejects(tracearr.firstRun(missing.context));
  await assert.rejects(tracearr.firstRun(missing.context), /never replay/);
  assert.equal(missing.state.signupCount, 1);
  assert.ok(missing.state.keyCount <= 1);
}
for (const bad of ["owned", "claim", "role", "version", "email", "existing-key"] as const) {
  const rejected = fixture();
  if (bad === "owned") rejected.state.owned = true;
  if (bad === "claim") rejected.state.claim = true;
  if (bad === "role") rejected.state.role = "viewer";
  if (bad === "version") rejected.state.version = "2.5.1";
  if (bad === "email") rejected.context.inputs = {};
  if (bad === "existing-key") rejected.state.token = key;
  await assert.rejects(tracearr.firstRun(rejected.context));
  assert.equal(rejected.state.keyCount, 0);
}
console.log("Tracearr pinned-source setup fixture passed; no live containers were started.");
