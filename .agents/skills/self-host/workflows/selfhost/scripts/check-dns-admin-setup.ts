import assert from "node:assert/strict";

import pihole from "../references/catalog/apps/pihole/setup.ts";
import technitium from "../references/catalog/apps/technitium-dns/setup.ts";
import type { SetupAdapter, SetupCheckpoint, SetupContext, SetupHttpRequest } from "../references/catalog/types/setup.ts";

// Synthetic transport only: no DNS, Docker, session file or external request.
const passwordLength = Math.ceil(48 * 8 / Math.log2(62));
assert.equal(passwordLength, 65);
const SYNTHETIC_VALID_CREDENTIAL = "A".repeat(passwordLength);
const SYNTHETIC_INVALID_CREDENTIAL = "A".repeat(48);

for (const adapter of [pihole] satisfies SetupAdapter[]) {
  const root = `/tmp/dns-admin-fixture-${adapter.appId}`;
  let password = SYNTHETIC_VALID_CREDENTIAL;
  let calls = 0;
  const context = {
    appId: adapter.appId, projectRoot: root,
    async status() {
      return { command: "app status", appId: adapter.appId, projectRoot: root,
        status: "applied", mutation: false, runtime: { state: "running" } };
    },
    secrets: { async readAdminPassword() { return password; } },
    http: { async request(request: SetupHttpRequest) {
      calls += 1;
      let value: unknown;
      if (request.method === "POST") {
        assert.ok(request.approval);
        assert.equal(request.beforeSendCheckpoint, undefined);
        if (adapter.appId === "pihole") {
          assert.equal(request.path, "/api/auth");
          assert.equal(JSON.parse(request.body as string).password, password);
          value = { session: { valid: true, sid: "fixture-session" } };
        } else {
          assert.equal(request.path, "/api/user/login");
          assert.equal(new URLSearchParams(request.body as string).get("pass"), password);
          value = { status: "ok", username: "admin", token: "fixture-session" };
        }
      } else {
        assert.equal(request.method, "GET");
        if (adapter.appId === "pihole") {
          assert.equal(request.path, "/api/info/version");
          assert.equal(request.headers?.["X-FTL-SID"], "fixture-session");
          value = { version: { ftl: { local: { version: "v6.7.1" } } } };
        } else {
          assert.equal(request.path, "/api/user/profile/get");
          assert.equal(request.headers?.Authorization, "Bearer fixture-session");
          value = { status: "ok", response: { username: "admin" } };
        }
      }
      return { status: 200, ok: true, headers: { get() { return null; } },
        async json() { return value; }, async text() { return JSON.stringify(value); } };
    } },
  } as unknown as SetupContext;
  assert.equal(adapter.ready(await adapter.firstRun(context)), true);
  assert.equal(adapter.ready(await adapter.firstRun(context)), true);
  assert.equal(calls, 4);
  password = SYNTHETIC_INVALID_CREDENTIAL;
  await assert.rejects(adapter.firstRun(context), /valid generated administrator password/);
  assert.equal(calls, 4);
}

async function technitiumFixture(failure: "none" | "lost-output" | "capture" | "checkpoint" | "collision" | "temporary") {
  const root = "/tmp/technitium-owner-token-fixture";
  const privateFiles = `${root}/private`;
  const token = "b".repeat(64);
  let saved: string | null = null;
  let checkpoint: SetupCheckpoint | null = null;
  let creates = 0;
  let tokenExists = failure === "collision";
  let failed = false;
  const context = {
    appId: "technitium-dns", projectRoot: root,
    async status() { return { command: "app status", appId: "technitium-dns", projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" }, privateFiles }; },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(next: { expectedRevision: number | null; stage: string; data: SetupCheckpoint["data"] }) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        if (next.stage === "owner-token-saved" && failure === "checkpoint" && !failed) {
          failed = true;
          throw new Error("synthetic checkpoint interruption");
        }
        const attemptedActions = [...checkpoint?.attemptedActions ?? []];
        if (next.stage === "owner-token-attempted") attemptedActions.push("technitium-create-owner-api-token");
        checkpoint = { schemaVersion: 1, appId: "technitium-dns", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage, data: next.data, attemptedActions };
        return checkpoint;
      },
    },
    secrets: {
      async readAdminPassword() { return SYNTHETIC_VALID_CREDENTIAL; },
      async readApiKey() { return saved; },
      async apiKeyPath() { if (saved) return `${privateFiles}/technitium-dns-api-key`; return null; },
      async writeApiKey(value: string) {
        assert.equal(value, token);
        if (failure === "capture") throw new Error("synthetic private capture failure");
        saved = value;
        return `${privateFiles}/technitium-dns-api-key`;
      },
    },
    http: { async request(request: SetupHttpRequest) {
      assert.equal(request.query, undefined);
      assert.ok(!request.path.includes("?"));
      let value: unknown;
      if (request.path === "/api/user/login") {
        assert.equal(request.method, "POST");
        assert.equal(new URLSearchParams(request.body as string).get("pass"), SYNTHETIC_VALID_CREDENTIAL);
        value = { status: "ok", username: "admin", token: "fixture-login-only" };
      } else if (request.path === "/api/admin/sessions/createToken") {
        assert.equal(request.method, "POST");
        assert.equal(request.headers?.Authorization, "Bearer fixture-login-only");
        assert.equal(request.headers?.["Content-Type"], "application/x-www-form-urlencoded");
        assert.equal(new URLSearchParams(request.body as string).get("user"), "admin");
        assert.equal(request.approval?.once, true);
        assert.ok(request.beforeSendCheckpoint);
        await context.checkpoint.compareAndSet(request.beforeSendCheckpoint as never);
        creates += 1;
        tokenExists = true;
        if (failure === "lost-output") throw new Error("synthetic lost output");
        value = { status: "ok", response: { username: "admin", tokenName: "Auto-Stack owner administration", token } };
      } else {
        assert.equal(request.path, "/api/user/profile/get");
        assert.equal(request.method, "GET");
        const isCurrentSession = request.headers?.Authorization === `Bearer ${token}`;
        value = { status: "ok", response: { username: "admin", sessions: tokenExists ? [{
          username: "admin", tokenName: "Auto-Stack owner administration", partialToken: token.slice(0, 16),
          type: failure === "temporary" ? "Standard" : "ApiToken", isCurrentSession,
        }] : [] } };
      }
      return { status: 200, ok: true, headers: { get() { return null; } },
        async json() { return value; }, async text() { return JSON.stringify(value); } };
    } },
  };
  const setup = () => technitium.firstRun(context as unknown as SetupContext);
  if (failure === "none") {
    const record = await setup();
    assert.equal(technitium.ready(record), true);
    assert.equal(JSON.stringify(record).includes(token), false);
    assert.equal(record.dnsPublished, false);
    assert.equal(technitium.ready(await setup()), true);
  } else {
    await assert.rejects(setup());
    if (failure === "checkpoint") assert.equal(technitium.ready(await setup()), true);
    else await assert.rejects(setup());
  }
  assert.equal(creates, failure === "collision" ? 0 : 1);
  assert.equal(JSON.stringify(checkpoint).includes(token), false);
}

for (const failure of ["none", "lost-output", "capture", "checkpoint", "collision", "temporary"] as const) {
  await technitiumFixture(failure);
}
console.log("DNS admin and Technitium durable owner token replay/recovery: pass (synthetic)");
