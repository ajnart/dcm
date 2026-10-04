import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import npm from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/nginx-proxy-manager/setup.ts";
import kopia from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/kopia/setup.ts";
import traefik from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/traefik/setup.ts";
import { SetupTransportDeferred } from "../src/control-panel/setup-transport.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const projectRoot = "/tmp/storage-headless-fixture";
const password = "fixture".repeat(8);
const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);

async function recipe(app: string) {
  return JSON.parse(await readFile(new URL(`${app}/recipe.json`, catalog), "utf8"));
}

function response(status: number, value: unknown, body = JSON.stringify(value)) {
  return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } },
    async json() { return value; }, async text() { return body; },
    async arrayBuffer() { return Uint8Array.from(Buffer.from(body)).buffer; } };
}

function status(appId: string) {
  return { command: "app status", appId, projectRoot, status: "applied", mutation: false,
    runtime: { state: "running" }, username: "admin", passwordFile: `${projectRoot}/admin-password` };
}

function npmFixture() {
  const state = { configured: false, checkpoint: null as SetupCheckpoint | null,
    creations: 0, loseCreation: false, persistCreation: true, version: 0, challenge: false,
    user: { id: 1, email: "admin@example.test", roles: ["admin"], is_disabled: false },
    loginError: null as Error | null, identityError: null as Error | null };
  function update(next: SetupCheckpointUpdate, action?: string): SetupCheckpoint {
    assert.equal(next.expectedRevision, state.checkpoint?.revision ?? null);
    const attemptedActions = [...(state.checkpoint?.attemptedActions ?? [])];
    if (action) { assert.ok(!attemptedActions.includes(action)); attemptedActions.push(action); }
    state.checkpoint = { schemaVersion: 1, appId: "nginx-proxy-manager", projectRoot,
      revision: (state.checkpoint?.revision ?? 0) + 1, stage: next.stage,
      attemptedActions, data: next.data ?? {} };
    return state.checkpoint;
  }
  const context = {
    appId: "nginx-proxy-manager", projectRoot,
    async status() { return status("nginx-proxy-manager"); },
    secrets: { async readAdminPassword() { return password; } },
    checkpoint: { async read() { return state.checkpoint; },
      async compareAndSet(next: SetupCheckpointUpdate) { return update(next); } },
    http: { async request(request: SetupHttpRequest) {
      if (request.path === "/api") {
        assert.equal(request.method, "GET");
        return response(200, { status: "OK", setup: state.configured,
          version: { major: 2, minor: 16, revision: state.version } });
      }
      if (request.path === "/api/users") {
        assert.equal(request.method, "POST");
        assert.equal(request.approval?.action, "npm-create-first-admin");
        assert.equal(request.approval?.once, true);
        assert.ok(request.beforeSendCheckpoint);
        assert.deepEqual(JSON.parse(request.body as string), { name: "Administrator", nickname: "Admin",
          email: "admin@example.test", auth: { type: "password", secret: password } });
        assert.equal(state.configured, false);
        update(request.beforeSendCheckpoint, request.approval.action);
        state.creations += 1;
        if (state.persistCreation) state.configured = true;
        if (state.loseCreation) throw new Error("lost creation response");
        return response(201, state.user);
      }
      if (request.path === "/api/tokens") {
        assert.equal(request.method, "POST");
        assert.deepEqual(JSON.parse(request.body as string), { identity: "admin@example.test", secret: password });
        assert.ok(request.approval);
        if (state.loginError) throw state.loginError;
        if (state.challenge) return response(200, { requires_2fa: true, challenge_token: "fixture-challenge" });
        return response(200, { token: "fixture-short-lived-token" });
      }
      assert.equal(request.path, "/api/users/me");
      assert.equal(request.method, "GET");
      assert.equal(request.headers?.Authorization, "Bearer fixture-short-lived-token");
      if (state.identityError) throw state.identityError;
      return response(200, state.user);
    } },
  } as unknown as SetupContext;
  return { context, state };
}

const npmRecipe = await recipe("nginx-proxy-manager");
assert.equal(npmRecipe.onboarding.kind, "manual-first-email");
assert.deepEqual(npmRecipe.services[0].environment, []);
assert.equal(npmRecipe.services[0].secretEnvironment, undefined);
assert.equal(JSON.stringify(npmRecipe).includes("INITIAL_ADMIN_PASSWORD"), false);
const fresh = npmFixture();
const first = await npm.firstRun(fresh.context);
assert.equal(npm.ready(first), true);
assert.deepEqual(await npm.firstRun(fresh.context), first);
assert.equal(fresh.state.creations, 1);
assert.equal(first.ingressVerified, false);
assert.equal(JSON.stringify(first).includes(password), false);
assert.equal(JSON.stringify(fresh.state.checkpoint).includes(password), false);
assert.deepEqual(fresh.state.checkpoint?.data, { adminId: 1 });
fresh.state.user.id = 2;
await assert.rejects(npm.firstRun(fresh.context), /verified, enabled administrator/);

const lost = npmFixture(); lost.state.loseCreation = true;
await assert.rejects(npm.firstRun(lost.context), /lost creation response/);
lost.state.loseCreation = false;
assert.equal(npm.ready(await npm.firstRun(lost.context)), true);
assert.equal(lost.state.creations, 1);
const incomplete = npmFixture(); incomplete.state.loseCreation = true; incomplete.state.persistCreation = false;
await assert.rejects(npm.firstRun(incomplete.context), /lost creation response/);
incomplete.state.loseCreation = false;
await assert.rejects(npm.firstRun(incomplete.context), /inspect without replaying/);
assert.equal(incomplete.state.creations, 1);
const unowned = npmFixture(); unowned.state.configured = true;
await assert.rejects(npm.firstRun(unowned.context), /unowned account/);
assert.equal(unowned.state.creations, 0);
const wrongVersion = npmFixture(); wrongVersion.state.version = 1;
await assert.rejects(npm.firstRun(wrongVersion.context), /pinned setup contract/);
assert.equal(wrongVersion.state.creations, 0);
const challenge = npmFixture(); challenge.state.challenge = true;
await assert.rejects(npm.firstRun(challenge.context), /2FA challenge/);
challenge.state.challenge = false;
assert.equal(npm.ready(await npm.firstRun(challenge.context)), true);
assert.equal(challenge.state.creations, 1);
const deferred = npmFixture();
const deferredError = new SetupTransportDeferred("Fixture login approval pending; token npm-verify-admin:fixture");
deferred.state.loginError = deferredError;
await assert.rejects(npm.firstRun(deferred.context), (error) => error === deferredError);
assert.equal(deferred.state.checkpoint?.stage, "first-admin-create-attempted");
assert.deepEqual(deferred.state.checkpoint?.attemptedActions, ["npm-create-first-admin"]);
assert.equal(deferred.state.creations, 1);
deferred.state.loginError = null;
assert.equal(npm.ready(await npm.firstRun(deferred.context)), true);
assert.equal(deferred.state.creations, 1);
const identityError = new Error("fixture transport unavailable");
deferred.state.identityError = identityError;
await assert.rejects(npm.firstRun(deferred.context), (error) => error === identityError);
assert.equal(deferred.state.creations, 1);
for (const badUser of [{ email: "other@example.test" }, { roles: [] }, { is_disabled: true }]) {
  const invalid = npmFixture(); Object.assign(invalid.state.user, badUser);
  await assert.rejects(npm.firstRun(invalid.context), /verified, enabled administrator/);
}

let kopiaPayload: unknown = { username: "root", hostname: "fixture-backup-process" };
let anonymousStatus = 401;
let challengeRealm = 'Basic realm="Kopia"';
let wrongPasswordStatus = 401;
const kopiaContext = {
  appId: "kopia", projectRoot, async status() { return status("kopia"); },
  secrets: { async readAdminPassword() { return password; } },
  http: { async request(request: SetupHttpRequest) {
    assert.equal(request.method, "GET"); assert.equal(request.path, "/api/v1/current-user");
    assert.equal(request.headers?.Cookie, undefined);
    const rejected = (code: number) => ({ ...response(code, {}),
      headers: { get(name: string) { if (name.toLowerCase() === "www-authenticate") return challengeRealm; return null; } } });
    if (!request.headers?.Authorization) return rejected(anonymousStatus);
    if (request.headers.Authorization === `Basic ${Buffer.from(`admin:wrong-${password}`).toString("base64")}`) {
      return rejected(wrongPasswordStatus);
    }
    assert.equal(request.headers.Authorization, `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`);
    return response(200, kopiaPayload);
  } },
} as unknown as SetupContext;
const kopiaFirst = await kopia.firstRun(kopiaContext);
assert.equal(kopia.ready(kopiaFirst), true);
assert.equal(kopiaFirst.repositoryVerified, false); assert.equal(kopiaFirst.backupVerified, false);
assert.deepEqual(await kopia.firstRun(kopiaContext), kopiaFirst);
for (const invalid of [{}, { username: "root", hostname: "" }, "generic HTML endpoint"]) {
  kopiaPayload = invalid;
  await assert.rejects(kopia.firstRun(kopiaContext), /current-user/);
}
anonymousStatus = 200;
await assert.rejects(kopia.firstRun(kopiaContext), /reject unauthenticated/);
anonymousStatus = 401;
challengeRealm = 'Basic realm="unrelated"';
await assert.rejects(kopia.firstRun(kopiaContext), /reject unauthenticated/);
challengeRealm = 'Basic realm="Kopia"';
wrongPasswordStatus = 200;
await assert.rejects(kopia.firstRun(kopiaContext), /incorrect administrator password/);

let pingBody = "OK";
const traefikContext = { appId: "traefik", projectRoot,
  async status() { return status("traefik"); },
  http: { async request(request: SetupHttpRequest) {
    assert.deepEqual(request, { method: "GET", path: "/ping" });
    return response(200, {}, pingBody);
  } },
} as unknown as SetupContext;
assert.equal(traefik.ready(await traefik.firstRun(traefikContext)), true);
assert.equal(traefik.ready(await traefik.inspect!(traefikContext)), true);
pingBody = "unrelated service";
await assert.rejects(traefik.firstRun(traefikContext), /documented private ping/);

for (const app of ["restic", "borgmatic"]) {
  const job = await recipe(app);
  assert.equal(job.execution.kind, "manual-job");
  assert.equal(job.onboarding.kind, "job-credentials");
  assert.equal(job.defaults.publishedPort, null);
  assert.equal(job.services[0].publishTargetPort, null);
  assert.equal(job.services[0].restart, "no");
  assert.deepEqual(job.services[0].dependsOn, []);
  assert.ok(job.acceptance.some((check: { id: string }) => check.id === "isolated-restore"));
}
console.log("PASS storage headless first-user privacy, checkpoint reconciliation, exact auth/readiness and inert backup boundaries");
