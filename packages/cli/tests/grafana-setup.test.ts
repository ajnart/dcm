import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/grafana/setup.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const recipe = JSON.parse(await readFile(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/grafana/recipe.json", import.meta.url), "utf8"));
const service = recipe.services[0];
assert.equal(service.user, "image-default");
assert.deepEqual(service.fileEnvironment, []);
assert.deepEqual(service.secretEnvironment, [{ name: "GF_SECURITY_ADMIN_PASSWORD", fileId: "admin-password" }]);
assert.equal(recipe.onboarding.kind, "initial-admin-from-secret-env");
assert.equal(recipe.onboarding.secretEnvironment, "GF_SECURITY_ADMIN_PASSWORD");

const root = "/tmp/grafana-redacted-fixture";
const privateFiles = `${root}/private`;
const account = { id: 2, name: "Auto-Stack Readonly", login: "sa-auto-stack-readonly", role: "Viewer", orgId: 1, isDisabled: false };
const token = { id: 3, name: "Auto-Stack Readonly Token", expiration: null, hasExpired: false, isRevoked: false };
const key = `glsa_${"fixture".repeat(5)}`;
const password = "redacted-fixture-password";

function fixture() {
  let saved: SetupCheckpoint | null = null;
  let apiKey: string | null = null;
  let existing = false;
  let retained = false;
  let lose: string | null = null;
  let defer: string | null = null;
  let collisions = false;
  let wrongBearer = false;
  let interruptSave = false;
  let admin: unknown = { id: 1, login: "admin", isGrafanaAdmin: true, isDisabled: false, orgId: 1 };
  let adminStatus = 200;
  let statusAppId = "grafana";
  let calls = 0;
  const writes: string[] = [];
  const update = async (next: SetupCheckpointUpdate) => {
    assert.equal(next.expectedRevision, saved?.revision ?? null);
    if (next.stage === "api-key-saved" && interruptSave) throw new Error("Fixture metadata save interrupted");
    saved = { schemaVersion: 1, appId: "grafana", projectRoot: root, revision: (saved?.revision ?? 0) + 1,
      stage: next.stage, data: next.data ?? {}, attemptedActions: saved?.attemptedActions ?? [] };
    return saved;
  };
  const response = (value: unknown, status = 200) => ({ status, ok: status >= 200 && status < 300,
    headers: { get() { return null; } }, async json() { return value; }, async text() { return ""; }, async arrayBuffer() { return new ArrayBuffer(0); } });
  const context = {
    appId: "grafana", projectRoot: root, inputs: {}, installedAppIds: ["grafana"],
    async status() { return { command: "app status", appId: statusAppId, projectRoot: root, status: "applied", mutation: false,
      runtime: { state: "running" }, username: "admin", passwordFile: `${privateFiles}/admin-password`, privateFiles }; },
    checkpoint: { async read() { return saved; }, compareAndSet: update },
    secrets: { async readAdminPassword() { return password; }, async readApiKey() { return apiKey; },
      async apiKeyPath() { if (apiKey === null) return null; return `${privateFiles}/grafana-api-key`; },
      async writeApiKey(value: string) { apiKey = value; return `${privateFiles}/grafana-api-key`; } },
    http: { async request(request: SetupHttpRequest) {
      calls += 1;
      if (request.method === "GET") {
        if (request.path === "/api/user") {
          if (request.headers?.Authorization?.startsWith("Bearer ")) return response({ id: 0, uid: "service-account:2", orgId: 1,
            login: account.login, isGrafanaAdmin: wrongBearer, isDisabled: false });
          assert.equal(request.headers?.Authorization, `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`);
          return response(admin, adminStatus);
        }
        if (request.path === "/api/serviceaccounts/search") return response({ totalCount: Number(collisions), serviceAccounts: collisions ? [account] : [] });
        if (request.path === "/api/serviceaccounts/2") { assert.equal(existing, true); return response(account); }
        if (request.path === "/api/serviceaccounts/2/tokens") return response(retained ? [token] : []);
        throw new Error("Unexpected fixture read");
      }
      assert.equal(request.approval?.once, true);
      if (defer === request.approval?.action) throw new Error("Fixture approval deferred");
      await update(request.beforeSendCheckpoint!);
      saved!.attemptedActions.push(request.approval!.action);
      writes.push(request.approval!.action);
      let output: unknown;
      let status = 200;
      if (request.path === "/api/serviceaccounts") {
        assert.equal(JSON.parse(request.body as string).role, "Viewer"); existing = true; output = account; status = 201;
      } else {
        assert.equal(request.path, "/api/serviceaccounts/2/tokens");
        assert.equal(JSON.parse(request.body as string).secondsToLive, 0); retained = true; output = { id: token.id, name: token.name, key };
      }
      if (lose === request.approval!.action) throw new Error("Fixture lost response");
      return response(output, status);
    } },
  } as unknown as SetupContext;
  return { context, writes, checkpoint() { return saved; },
    legacy() { saved = { schemaVersion: 1, appId: "grafana", projectRoot: root, revision: 1, stage: "admin-verified", attemptedActions: [], data: {} }; },
    collision() { collisions = true; }, lose(value: string | null) { lose = value; }, defer(value: string | null) { defer = value; },
    admin(value: unknown) { admin = value; }, adminStatus(value: number) { adminStatus = value; },
    statusAppId(value: string) { statusAppId = value; }, calls() { return calls; },
    dropKey() { apiKey = null; }, wrongBearer() { wrongBearer = true; }, interruptSave(value: boolean) { interruptSave = value; } };
}

const normal = fixture();
const first = await adapter.firstRun(normal.context);
assert.equal(adapter.ready(first), true);
assert.deepEqual(adapter.compatibilityResult!(first), { origin: "fresh", credentialReadback: "verified" });
assert.equal(adapter.compatibilityResult!({ ...first }), null, "copied ready state is not current-invocation evidence");
assert.equal(JSON.stringify(first).includes(password), false);
assert.equal(JSON.stringify(first).includes(key), false);
const inspected = await adapter.inspect!(normal.context);
assert.equal(adapter.compatibilityResult!(inspected), null, "read-only inspection is not first-run provenance");
const resumed = await adapter.firstRun(normal.context);
assert.deepEqual(resumed, first);
assert.deepEqual(adapter.compatibilityResult!(resumed), { origin: "resume", credentialReadback: "verified" });
assert.equal(normal.writes.length, 2);
normal.wrongBearer();
await assert.rejects(adapter.firstRun(normal.context), /authenticate the owned/);

const invalidAdmin = fixture();
for (const user of [
  { login: "admin", isGrafanaAdmin: false },
  { login: "someone-else", isGrafanaAdmin: true },
  { login: "admin", isGrafanaAdmin: true, isDisabled: true },
]) {
  invalidAdmin.admin(user);
  await assert.rejects(adapter.firstRun(invalidAdmin.context), /administrator login failed/);
  assert.equal(invalidAdmin.writes.length, 0);
}
invalidAdmin.adminStatus(401);
await assert.rejects(adapter.firstRun(invalidAdmin.context), /authenticated readback failed/);
invalidAdmin.statusAppId("different-app");
const before = invalidAdmin.calls();
await assert.rejects(adapter.firstRun(invalidAdmin.context), /exact saved app project/);
assert.equal(invalidAdmin.calls(), before);

const legacy = fixture(); legacy.legacy();
assert.equal(adapter.compatibilityResult!(await adapter.firstRun(legacy.context)), null);
assert.equal(legacy.checkpoint()?.stage, "api-key-saved");

const deferred = fixture(); deferred.defer("grafana-create-service-account");
await assert.rejects(adapter.firstRun(deferred.context), /deferred/);
deferred.defer("grafana-create-service-account-token");
await assert.rejects(adapter.firstRun(deferred.context), /deferred/);
deferred.defer(null);
assert.equal(adapter.compatibilityResult!(await adapter.firstRun(deferred.context)), null);
assert.equal(deferred.writes.length, 2);

for (const action of ["grafana-create-service-account", "grafana-create-service-account-token"]) {
  const lost = fixture(); lost.lose(action);
  await assert.rejects(adapter.firstRun(lost.context), /lost response/);
  const count = lost.writes.length; lost.lose(null);
  await assert.rejects(adapter.firstRun(lost.context), /inspect manually/);
  assert.equal(lost.writes.length, count);
}
const collision = fixture(); collision.collision();
await assert.rejects(adapter.firstRun(collision.context), /pre-existing/);
assert.equal(collision.writes.length, 0);
const interrupted = fixture(); interrupted.interruptSave(true);
await assert.rejects(adapter.firstRun(interrupted.context), /save interrupted/);
assert.equal(interrupted.checkpoint()?.stage, "token-attempted");
interrupted.interruptSave(false);
assert.equal(adapter.compatibilityResult!(await adapter.firstRun(interrupted.context)), null);
assert.equal(interrupted.writes.length, 2, "saved once-returned key must reconcile without token recreation");
const missing = fixture(); await adapter.firstRun(missing.context); missing.dropKey();
await assert.rejects(adapter.firstRun(missing.context), /one-time token is missing/);
assert.equal(missing.writes.length, 2);
process.stdout.write("Grafana Viewer token, deferred approval, legacy migration, identity, collision and no-replay fixture passed\n");
