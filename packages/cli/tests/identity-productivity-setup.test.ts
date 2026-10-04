import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import firefly from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/firefly-iii/setup.ts";
import keycloak from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/keycloak/setup.ts";
import type { SetupContext, SetupCheckpoint, SetupHttpRequest, SetupCheckpointUpdate,
  SetupHttpResponse } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const PASSWORD = "a".repeat(48);
const EMAIL = "admin@example.test";
const TOKEN = "t".repeat(48);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function reply(value: unknown, status = 200, cookie?: string): SetupHttpResponse {
  return { status, ok: status >= 200 && status < 300,
    headers: { get() { return null; }, getSetCookie() { return cookie ? [cookie] : []; } },
    async json() { return value; }, async text() { return String(value); },
    async arrayBuffer() { return new TextEncoder().encode(String(value)).buffer; } };
}
function fixture(appId: string) {
  const root = `/tmp/${appId}-identity-fixture`;
  let checkpoint: SetupCheckpoint | null = null;
  let session: Record<string, string> = {};
  let password = PASSWORD;
  let key: string | null = null;
  const approved = new Set<string>();
  const attempted: string[] = [];
  let pending = "";
  const context = { appId, projectRoot: root, inputs: {}, installedAppIds: [appId],
    async status() { return { command: "app status", appId, projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" },
      ownerKind: "shared", username: EMAIL, privateFiles: `${root}/private`,
      passwordFile: `${root}/private/password`, manifestHash: "fixture-manifest" }; },
    secrets: {
      async readAdminPassword() { return password; },
      async readSessionCookies() { return { ...session }; },
      async writeSessionCookies(value: Record<string, string>) { session = { ...value }; },
      async readApiKey() { return key; },
      async apiKeyPath() { return key ? `${root}/private/key` : null; },
      async writeApiKey(value: string) { key = value; return `${root}/private/key`; },
    },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(update: SetupCheckpointUpdate) {
        assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId, projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
          data: update.data ?? {}, attemptedActions: checkpoint?.attemptedActions ?? [] };
        return checkpoint;
      },
    },
  } as unknown as SetupContext;
  return { context, root, get session() { return session; }, get checkpoint() { return checkpoint; },
    set password(value: string) { password = value; },
    approve() { assert.ok(pending); approved.add(pending); },
    async authorize(request: SetupHttpRequest) {
      if (!request.approval) return;
      // Bind the retained cookie as production does, so fresh login cannot
      // silently rotate an already-reviewed token-write identity.
      const fingerprint = digest(JSON.stringify({ appId, root, action: request.approval.action,
        method: request.method, path: request.path, body: request.body,
        contentType: request.headers?.["Content-Type"], cookie: request.headers?.Cookie,
        revision: checkpoint?.revision ?? null }));
      pending = fingerprint;
      if (!approved.has(fingerprint)) throw new Error("approval deferred");
      if (request.approval.once) {
        assert.ok(!attempted.includes(request.approval.action), "one-time request repeated");
        attempted.push(request.approval.action);
      }
      if (request.beforeSendCheckpoint) {
        const saved = await context.checkpoint.compareAndSet(request.beforeSendCheckpoint);
        saved.attemptedActions.push(request.approval.action);
      }
    } };
}
const form = (token: string, extra = "") => `<form method="post"><input name="_token" value="${token}"><input name="email"><input name="password">${extra}</form>`;

// BookStack's complete account/token contract lives in bookstack-api-key-setup.test.ts.

function fireflyFixture(lostRegistration = false, lostToken = false) {
  const f = fixture("firefly-iii");
  let registered = false;
  let registerForms = 0;
  let loginForms = 0;
  let registrations = 0;
  let logins = 0;
  let tokens = 0;
  let profileStatus = 200;
  let loginStatus = 302;
  f.context.http = { async request(request) {
    await f.authorize(request);
    if (request.path === "/register" && request.method === "GET") {
      if (registered) return reply("Registration is currently not available");
      return reply(form(`r${++registerForms}`.padEnd(40, "c"), '<input name="password_confirmation">'), 200, "session=register");
    }
    if (request.path === "/register") {
      registered = true;
      registrations++;
      if (lostRegistration) throw new Error("registration response lost");
      return reply("", 302);
    }
    if (request.path === "/login" && request.method === "GET") {
      return reply(form(`l${++loginForms}`.padEnd(40, "d")), 200, "session=login");
    }
    if (request.path === "/login") { logins++; return reply("", loginStatus, "session=authenticated"); }
    if (request.path === "/profile/change-email") {
      return reply(`<input id="email" value="${EMAIL}"><input name="_token" value="${"p".repeat(40)}">`, profileStatus);
    }
    if (request.path === "/profile/oauth") return reply("personal client ready");
    if (request.path === "/oauth/personal-access-tokens" && request.method === "GET") return reply([]);
    if (request.path === "/oauth/personal-access-tokens") {
      tokens++;
      if (lostToken) throw new Error("token response lost");
      return reply({ accessToken: TOKEN });
    }
    assert.equal(request.path, "/api/v1/about/user");
    if (!request.headers?.Authorization) return reply({}, 401);
    return reply({ data: { attributes: { email: EMAIL, role: "owner" } } });
  } };
  return { ...f, set profileStatus(value: number) { profileStatus = value; },
    set loginStatus(value: number) { loginStatus = value; },
    counts() { return { registerForms, loginForms, registrations, logins, tokens }; } };
}
const f = fireflyFixture();
async function approvedFirefly(f: ReturnType<typeof fireflyFixture>) {
  for (let step = 0; step < 12; step++) {
    try { return await firefly.firstRun(f.context); }
    catch (error) {
      if (!(error instanceof Error) || !/approval deferred/.test(error.message)) throw error;
      await assert.rejects(firefly.firstRun(f.context), /approval deferred/);
      f.approve();
    }
  }
  throw new Error("Firefly approvals did not converge");
}
for (let step = 0; step < 4; step++) {
  await assert.rejects(firefly.firstRun(f.context), /approval deferred/);
  await assert.rejects(firefly.firstRun(f.context), /approval deferred/);
  f.approve();
}
const record = await approvedFirefly(f);
assert.equal(firefly.ready(record), true);
assert.equal(record.passwordLoginVerified, true, "readiness requires fresh saved-password proof");
assert.equal(firefly.ready({ ...record, passwordLoginVerified: false }), false);
assert.equal(record.passwordLoginPreviouslyVerified, true);
assert.deepEqual(f.counts(), { registerForms: 1, loginForms: 2, registrations: 1, logins: 2, tokens: 1 });
assert.equal(firefly.ready(await approvedFirefly(f)), true);
assert.equal(f.counts().logins, 3, "completed resume must not rely on the valid retained cookie");
assert.equal(f.counts().tokens, 1);
f.profileStatus = 503;
await assert.rejects(approvedFirefly(f), /cannot open its owner profile/);
assert.equal((await f.context.secrets.readSessionCookies()).step, "login-pending");
f.profileStatus = 401;
await assert.rejects(approvedFirefly(f), /saved session was rejected/);
assert.deepEqual(await f.context.secrets.readSessionCookies(), {});
f.profileStatus = 200;
f.loginStatus = 422;
await assert.rejects(approvedFirefly(f), /did not establish a web login/);
assert.equal(f.counts().registrations, 1);
assert.equal(f.counts().tokens, 1);

const lost = fireflyFixture(true);
await assert.rejects(firefly.firstRun(lost.context), /approval deferred/);
lost.approve();
await assert.rejects(firefly.firstRun(lost.context), /registration response lost/);
await assert.rejects(firefly.firstRun(lost.context), /approval deferred/);
assert.equal(lost.counts().registrations, 1, "lost signup response reconciles by login only");
const lostKey = fireflyFixture(false, true);
for (let step = 0; step < 4; step++) {
  await assert.rejects(firefly.firstRun(lostKey.context), /approval deferred/);
  lostKey.approve();
}
await assert.rejects(firefly.firstRun(lostKey.context), /token response lost/);
await assert.rejects(firefly.firstRun(lostKey.context), /personal-token result was lost/);
assert.equal(lostKey.counts().tokens, 1);

const k = fixture("keycloak");
let adminId = "owner-id";
let adminRole = true;
k.context.http = { async request(request) {
  if (request.method === "POST") return reply({ access_token: "fixture-access" });
  if (request.path === "/admin/realms/master") return reply({ realm: "master", id: "master-id" });
  if (request.path === "/admin/realms/master/users") {
    assert.deepEqual(request.query, { username: "admin", exact: "true" });
    return reply([{ id: adminId, username: "admin", enabled: true }]);
  }
  assert.equal(request.path, `/admin/realms/master/users/${adminId}/role-mappings/realm/composite`);
  if (!adminRole) return reply([{ name: "view-realm", clientRole: true, containerId: "master-id" }]);
  return reply([{ name: "admin", clientRole: false, containerId: "master-id" }]);
} };
assert.equal(keycloak.ready(await keycloak.firstRun(k.context)), true);
assert.equal(keycloak.ready(await keycloak.firstRun(k.context)), true);
adminRole = false;
await assert.rejects(keycloak.firstRun(k.context), /not a master-realm administrator/);
adminRole = true;
adminId = "replacement-owner-id";
await assert.rejects(keycloak.firstRun(k.context), /identity changed/);
console.log("Identity/productivity setup fixture passed (synthetic only)");
