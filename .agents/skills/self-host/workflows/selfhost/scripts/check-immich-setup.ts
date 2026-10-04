import assert from "node:assert/strict";

import immich from "../references/catalog/apps/immich/setup.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpRequest } from "../references/catalog/types/setup.ts";

const root = "/tmp/immich-setup-fixture";
const keyId = "10000000-0000-4000-8000-000000000001";
const keySecret = "synthetic-immich-homarr-key-value";
const permissions = ["album.statistics", "album.read", "album.create", "user.read", "user.update",
  "asset.read", "asset.view", "asset.download", "asset.statistics", "server.statistics", "server.about"];
const verifiedOpen = "admin-login-and-homarr-key-verified-setup-open";
const closed = "setup-closed-admin-login-and-homarr-key-verified";
const uncertain = new Error("synthetic lost response");

function response(value: unknown, status = 200) {
  return { status, ok: status < 400, headers: { get() { return null; } },
    async json() { return value; }, async text() { return JSON.stringify(value); },
    async arrayBuffer() { return new ArrayBuffer(0); } };
}

function fixture(options: { initialized?: boolean; stage?: string; savedKey?: boolean;
  lostSignup?: boolean; lostKey?: boolean; closureDrift?: boolean; invalidConfig?: boolean;
  unavailableConfig?: boolean; wrongAdmin?: boolean; wrongKey?: boolean } = {}) {
  let initialized = options.initialized ?? false;
  let checkpoint: SetupCheckpoint | null = null;
  if (options.stage) {
    checkpoint = { schemaVersion: 1, appId: "immich", projectRoot: root, revision: 1,
      stage: options.stage, attemptedActions: ["immich-create-first-admin"], data: {} };
  }
  let secret: string | null = null;
  let key: Record<string, unknown> | null = null;
  if (options.savedKey) {
    secret = keySecret;
    key = { id: keyId, name: "Homarr", permissions };
    if (checkpoint) checkpoint.data.homarrKeyId = keyId;
  }
  let configCalls = 0;
  let signupCalls = 0;
  let keyCalls = 0;
  const requests: SetupHttpRequest[] = [];

  async function compareAndSet(update: SetupCheckpointUpdate): Promise<SetupCheckpoint> {
    assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
    checkpoint = { schemaVersion: 1, appId: "immich", projectRoot: root,
      revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
      attemptedActions: checkpoint?.attemptedActions ?? [],
      data: { ...checkpoint?.data, ...update.data } };
    return checkpoint;
  }
  const context = {
    appId: "immich", projectRoot: root,
    async status() {
      return { command: "app status", appId: "immich", projectRoot: root,
        status: "applied", mutation: false, ownerKind: "shared", runtime: { state: "running" },
        username: "admin@example.test", passwordFile: `${root}/secrets/password` };
    },
    async read() { throw new Error("Unexpected standalone read"); },
    async apply() { throw new Error("Unexpected environment transition"); },
    checkpoint: { async read() { return checkpoint; }, compareAndSet },
    secrets: {
      async readAdminPassword() { return "synthetic-admin-password"; },
      async readApiKey() { return secret; },
      async writeApiKey(value: string) { secret = value; return `${root}/secrets/api-key`; },
      async apiKeyPath() { return `${root}/secrets/api-key`; },
    },
    http: { async request(request: SetupHttpRequest) {
      requests.push(request);
      if (request.path === "/api/server/config") {
        assert.equal(request.method, "GET");
        configCalls += 1;
        if (options.unavailableConfig) return response({}, 503);
        if (options.invalidConfig) return response({ isInitialized: "true" });
        if (options.closureDrift && configCalls === 3) return response({ isInitialized: false });
        return response({ isInitialized: initialized });
      }
      if (request.method === "POST") {
        assert.ok(request.approval);
        if (request.beforeSendCheckpoint) {
          const saved = await compareAndSet(request.beforeSendCheckpoint);
          saved.attemptedActions.push(request.approval.action);
        }
      }
      if (request.path === "/api/auth/admin-sign-up") {
        assert.equal(request.method, "POST");
        assert.equal(initialized, false, "Never probe closed signup");
        assert.equal(checkpoint?.stage, "signup-attempted");
        signupCalls += 1;
        initialized = true;
        if (options.lostSignup && signupCalls === 1) throw uncertain;
        return response({}, 201);
      }
      if (request.path === "/api/auth/login") {
        assert.equal(request.method, "POST");
        assert.equal(initialized, true);
        return response({ userEmail: "admin@example.test", isAdmin: !options.wrongAdmin,
          accessToken: "synthetic-session-token" }, 201);
      }
      if (request.path === "/api/api-keys" && request.method === "GET") {
        assert.equal(request.headers?.Authorization, "Bearer synthetic-session-token");
        if (key) return response([key]);
        return response([]);
      }
      if (request.path === "/api/api-keys" && request.method === "POST") {
        assert.equal(checkpoint?.stage, "homarr-key-create-attempted");
        assert.deepEqual(JSON.parse(request.body as string), { name: "Homarr", permissions });
        keyCalls += 1;
        key = { id: keyId, name: "Homarr", permissions };
        if (options.lostKey) throw uncertain;
        return response({ ...key, secret: keySecret }, 201);
      }
      if (request.path === "/api/api-keys/me") {
        assert.equal(request.method, "GET");
        assert.equal(request.headers?.["x-api-key"], keySecret);
        if (options.wrongKey) return response({ ...key, permissions: ["all"] });
        return response(key);
      }
      throw new Error(`Unexpected request ${request.method} ${request.path}`);
    } },
  } as unknown as SetupContext;
  return { context, requests, checkpoint: () => checkpoint, secret: () => secret,
    signupCalls: () => signupCalls, keyCalls: () => keyCalls };
}

const fresh = fixture();
const result = await immich.firstRun(fresh.context);
assert.equal(result.stage, closed);
assert.equal(result.setupClosed, true);
assert.equal(result.setupClosure, "intrinsic-first-admin");
assert.equal(result.acceptanceVerified, false);
assert.equal(immich.ready(result), true);
assert.equal(fresh.checkpoint()?.stage, closed);
assert.equal(fresh.signupCalls(), 1);
assert.equal(fresh.keyCalls(), 1);
assert.equal(fresh.requests.at(-1)?.path, "/api/server/config");
const revision = fresh.checkpoint()?.revision;
assert.equal(immich.ready(await immich.firstRun(fresh.context)), true);
assert.equal(fresh.checkpoint()?.revision, revision);
assert.equal(fresh.signupCalls(), 1);
assert.equal(fresh.keyCalls(), 1);
assert.equal(immich.ready({ ...result, setupClosed: false }), false);
assert.equal(immich.ready({ ...result, stage: verifiedOpen, setupClosed: false }), false);
assert.equal(immich.ready({ ...result, apiKeyFile: "relative" }), false);
// Standalone ready semantics remain unchanged.
assert.equal(immich.ready({ appId: "immich", credentialRef: `${root}/password`,
  stage: "setup-closed-login-verified" }), true);

const migrated = fixture({ initialized: true, stage: verifiedOpen, savedKey: true });
assert.equal(immich.ready(await immich.firstRun(migrated.context)), true);
assert.equal(migrated.signupCalls(), 0);
assert.equal(migrated.keyCalls(), 0);

const lostSignup = fixture({ lostSignup: true });
await assert.rejects(immich.firstRun(lostSignup.context), (error) => error === uncertain);
assert.equal(immich.ready(await immich.firstRun(lostSignup.context)), true);
assert.equal(lostSignup.signupCalls(), 1);

const lostKey = fixture({ lostKey: true });
await assert.rejects(immich.firstRun(lostKey.context), (error) => error === uncertain);
await assert.rejects(immich.firstRun(lostKey.context), /no saved secret or an uncertain creation/);
assert.equal(lostKey.keyCalls(), 1);
assert.equal(lostKey.secret(), null);

for (const [options, message] of [
  [{ initialized: true }, /already initialized outside/],
  [{ stage: "signup-attempted" }, /incomplete/],
  [{ invalidConfig: true }, /initialization state is invalid/],
  [{ unavailableConfig: true }, /initialization state is unavailable/],
  [{ wrongAdmin: true }, /saved administrator identity/],
  [{ wrongKey: true }, /identity or permissions differ/],
  [{ closureDrift: true }, /setup closure was not verified/],
] as const) {
  const rejected = fixture(options);
  await assert.rejects(immich.firstRun(rejected.context), message);
  assert.notEqual(rejected.checkpoint()?.stage, closed);
}

process.stdout.write("Immich intrinsic closure, checkpoint resume, readback failures, and uncertain-write safety fixtures passed\n");
