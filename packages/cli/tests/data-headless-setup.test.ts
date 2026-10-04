import assert from "node:assert/strict";
import paperless from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/setup.ts";
import syncthing from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/syncthing/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest, SetupHttpResponse } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const password = "p".repeat(64);
const token = "a".repeat(40);
const projectRoot = "/tmp/selfhost-data-headless-synthetic";

function response(value: unknown, status = 200): SetupHttpResponse {
  const text = JSON.stringify(value);
  return { status, ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    async json() { return value; }, async text() { return text; },
    async arrayBuffer() { return new TextEncoder().encode(text).buffer; } };
}

function fixture(appId: string, handle: (request: SetupHttpRequest) => Promise<SetupHttpResponse>) {
  let key: string | null = null;
  let checkpoint: SetupCheckpoint | null = null;
  const requests: SetupHttpRequest[] = [];
  const status = { command: "app status", appId, projectRoot, ownerKind: "shared",
    mutation: false, status: "applied", runtime: { state: "running" }, username: "admin",
    passwordFile: `${projectRoot}/${appId}/admin-password`, url: "http://127.0.0.1:18080" };
  const context = {
    appId, projectRoot, inputs: {}, installedAppIds: [appId],
    async status() { return status; },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(next) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId, projectRoot,
          revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
          attemptedActions: checkpoint?.attemptedActions ?? [],
          data: { ...checkpoint?.data, ...next.data } };
        return checkpoint;
      },
    },
    http: {
      async request(request) {
        if (request.beforeSendCheckpoint) {
          assert.ok(request.approval?.once);
          await context.checkpoint.compareAndSet(request.beforeSendCheckpoint);
          assert.ok(checkpoint);
          checkpoint.attemptedActions.push(request.approval.action);
        }
        requests.push(request);
        return handle(request);
      },
    },
    secrets: {
      async readAdminPassword() { return password; },
      async readApiKey() { return key; },
      async writeApiKey(value) { key = value; return `${projectRoot}/${appId}/api-key`; },
      async apiKeyPath() {
        if (key === null) return null;
        return `${projectRoot}/${appId}/api-key`;
      },
    },
  } as SetupContext;
  return { context, requests, status, get key() { return key; } };
}

const user = { id: 1, username: "admin", is_superuser: true, is_active: true };
let tokenRequests = 0;
let failReadback = true;
let tokenUser = user;
const paperlessOwner = fixture("paperless-ngx", async (request) => {
  if (request.path === "/api/users/") return response({ results: [user] });
  if (request.path === "/api/token/") {
    assert.equal(request.method, "POST");
    assert.deepEqual(JSON.parse(String(request.body)), { username: "admin", password });
    tokenRequests++;
    return response({ token });
  }
  assert.equal(request.headers?.Authorization, `Token ${token}`);
  assert.equal(paperlessOwner.key, token, "Save the returned token before any follow-up request");
  if (request.path === "/api/ui_settings/") {
    if (failReadback) throw new Error("Synthetic interrupted readback");
    return response({ user: tokenUser });
  }
  if (request.path === "/api/statistics/") return response({ documents_total: 0, documents_inbox: null });
  throw new Error("Unexpected Paperless fixture route");
});
await assert.rejects(paperless.firstRun(paperlessOwner.context), /interrupted readback/);
assert.equal(paperlessOwner.key, token);
assert.equal(tokenRequests, 1);
failReadback = false;
const recovered = await paperless.firstRun(paperlessOwner.context);
assert.equal(paperless.ready(recovered), true);
await paperless.inspect!(paperlessOwner.context);
assert.equal(tokenRequests, 1, "Saved-token recovery must not acquire a replacement");
tokenUser = { ...user, id: 2 };
await assert.rejects(paperless.firstRun(paperlessOwner.context), /does not belong/);
assert.equal(tokenRequests, 1);
assert.ok(!JSON.stringify(recovered).includes(password));
assert.ok(!JSON.stringify(recovered).includes(token));

let uncertainRequests = 0;
const uncertain = fixture("paperless-ngx", async (request) => {
  if (request.path === "/api/users/") return response({ results: [user] });
  if (request.path === "/api/token/") {
    uncertainRequests++;
    throw new Error("Synthetic lost token response");
  }
  throw new Error("Unexpected uncertain-token fixture route");
});
await assert.rejects(paperless.firstRun(uncertain.context), /lost token response/);
await assert.rejects(paperless.firstRun(uncertain.context), /attempted without a saved token/);
assert.equal(uncertainRequests, 1);

// PhotoPrism's exact login/public-mode/identity/replay negatives and its genuine
// API app password flow are covered by photoprism-api-key.test.ts.

const syncOwner = fixture("syncthing", async (request) => {
  if (request.path === "/rest/noauth/health") return response({ status: "OK" });
  if (request.path === "/rest/config/gui") {
    assert.equal(request.headers?.["X-API-Key"], token);
    return response({ user: "admin", password: "$2b$synthetic", sendBasicAuthPrompt: true });
  }
  if (request.path === "/") {
    if (request.headers?.Authorization) return response({}, 200);
    return response({}, 401);
  }
  throw new Error("Unexpected Syncthing fixture route");
});
await syncOwner.context.secrets.writeApiKey(token);
assert.equal(syncthing.ready(await syncthing.inspect!(syncOwner.context)), true);
const syncCheckpoint = await syncOwner.context.checkpoint.compareAndSet({ expectedRevision: null,
  stage: "admin-write-attempted" });
syncCheckpoint.attemptedActions.push("syncthing-set-admin");
assert.equal(syncthing.ready(await syncthing.firstRun(syncOwner.context)), true);
syncCheckpoint.projectRoot = "/tmp/different-owner";
await assert.rejects(syncthing.firstRun(syncOwner.context), /unexpected administrator checkpoint/);
syncOwner.context.appId = "different-app";
const beforeWrongSync = syncOwner.requests.length;
await assert.rejects(syncthing.inspect!(syncOwner.context), /different app ID/);
assert.equal(syncOwner.requests.length, beforeWrongSync);

console.log("Data headless synthetic setup/replay checks passed; no live acceptance");
