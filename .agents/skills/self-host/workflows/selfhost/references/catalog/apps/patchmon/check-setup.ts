import assert from "node:assert/strict";
import adapter from "./setup";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest } from "../../types/setup";

// Synthetic transport boundary only: no Docker, real accounts, or host enrollment.
const projectRoot = "/tmp/patchmon-redacted-fixture";
const email = "owner@example.invalid";
const SYNTHETIC_ADMIN_CREDENTIAL = "FixtureOnly-NotALiveCredential-12345";
const user = { id: "fixture-admin", username: "admin", email, role: "superadmin", is_active: true, has_password: true };

const pair = { apiKey: `patchmon_ae_${"a".repeat(32)}`, apiSecret: "b".repeat(64) };
const tokenId = "11111111-1111-4111-8111-111111111111";
const token = { id: tokenId, token_name: "selfhost-homarr", token_key: pair.apiKey, is_active: true,
  expires_at: null, max_hosts_per_day: 1, allowed_ip_ranges: [], metadata: { integration_type: "gethomepage" },
  scopes: null, users: { id: user.id, username: "admin" } };

function fixture(options: { existing?: boolean; checkpoint?: SetupCheckpoint; loseCreate?: boolean;
  unhealthy?: boolean; noOptIn?: boolean; apiKey?: string; existingToken?: boolean; loseToken?: boolean;
  loseAfterSave?: boolean; tokenDrift?: boolean } = {}) {
  let existing = options.existing ?? false;
  let checkpoint: SetupCheckpoint | null = options.checkpoint ?? null;
  const requests: SetupHttpRequest[] = [];
  let apiKey: string | null = options.apiKey ?? null;
  let tokenExists = options.existingToken ?? false;
  let session: Record<string, string> = {};
  const context = {
    appId: "patchmon", projectRoot, inputs: { "admin-email": email,
      "credential-authority": "stats-and-enrollment" },
    status: async () => ({ command: "app status", appId: "patchmon", projectRoot,
      status: "applied", mutation: false, runtime: { state: "running" } }),
    secrets: { readAdminPassword: async () => SYNTHETIC_ADMIN_CREDENTIAL, readApiKey: async () => apiKey,
      readSessionCookies: async () => session,
      writeSessionCookies: async (value: Record<string, string>) => { session = { ...value }; },
      writeApiKey: async (value: string) => {
        assert.deepEqual(JSON.parse(value), pair);
        apiKey = value;
        if (options.loseAfterSave) throw new Error("Synthetic interruption after atomic secret save");
        return "/tmp/redacted-pair";
      } },
    checkpoint: {
      read: async () => checkpoint,
      compareAndSet: async (update: { expectedRevision: number | null; stage: string; data?: Record<string, any> }) => {
        assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
        for (const key of Object.keys(update.data ?? {})) {
          assert.equal(/(?:password|token|secret|api.?key|credential)/i.test(key), false,
            "Fixture rejects the same secret-like checkpoint field names as the shared transport");
        }
        checkpoint = { schemaVersion: 1, appId: "patchmon", projectRoot,
          revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
          attemptedActions: checkpoint?.attemptedActions ?? [], data: { ...update.data } };
        return checkpoint;
      },
    },
    http: { request: async (request: SetupHttpRequest) => {
      requests.push(request);
      let value: unknown;
      let status = 200;
      if (request.path === "/health") {
        value = { status: "ok", database: "ok", redis: "ok" };
        if (options.unhealthy) value = { status: "ok", database: "ok", redis: "unhealthy" };
      } else if (request.path.endsWith("/settings/login-settings")) value = { hasAdminUsers: existing };
      else if (request.path.endsWith("/auth/setup-admin")) {
        assert.equal(existing, false);
        assert.equal(request.approval?.once, true);
        assert.ok(request.beforeSendCheckpoint);
        await context.checkpoint.compareAndSet(request.beforeSendCheckpoint!);
        checkpoint!.attemptedActions.push("patchmon-create-admin");
        existing = true;
        if (options.loseCreate) throw new Error("Synthetic lost response");
        status = 201;
        value = { user };
      } else if (request.path.endsWith("/auth/login")) {
        assert.equal(JSON.parse(request.body as string).password, SYNTHETIC_ADMIN_CREDENTIAL);
        value = { token: "synthetic.shortlived.session" };
      } else if (request.path.endsWith("/auth/profile")) value = { user };
      else if (request.path.endsWith("/auto-enrollment/tokens")) {
        if (request.method === "GET") {
          value = [];
          if (tokenExists) value = [token];
          if (tokenExists && options.tokenDrift) value = [{ ...token, max_hosts_per_day: 100 }];
        } else {
          assert.equal(tokenExists, false);
          assert.equal(request.approval?.once, true);
          assert.match(request.approval!.progress, /also allows to enroll/);
          assert.deepEqual(JSON.parse(request.body as string), { token_name: "selfhost-homarr",
            metadata: { integration_type: "gethomepage" }, max_hosts_per_day: 1, allowed_ip_ranges: [] });
          await context.checkpoint.compareAndSet(request.beforeSendCheckpoint!);
          checkpoint!.attemptedActions.push("patchmon-create-homarr-token");
          tokenExists = true;
          if (options.loseToken) throw new Error("Synthetic lost token response");
          status = 201;
          value = { token: { ...token, token_secret: pair.apiSecret } };
        }
      } else if (request.path.endsWith("/gethomepage/stats")) {
        assert.equal(request.headers?.Authorization, `Basic ${Buffer.from(`${pair.apiKey}:${pair.apiSecret}`).toString("base64")}`);
        assert.ok(request.approval);
        value = { total_hosts: 0, hosts_needing_updates: 0, security_updates: 0, up_to_date_hosts: 0,
          hosts_with_security_updates: 0, recent_updates_24h: 0, total_outdated_packages: 0, total_repos: 0,
          last_updated: "2026-10-03T12:00:00Z", os_distribution: [] };
      }
      else throw new Error("Unexpected fixture request");
      return { status, ok: status >= 200 && status < 300, headers: { get: () => null },
        json: async () => value, text: async () => "" };
    } },
  } as unknown as SetupContext;
  if (options.noOptIn) delete (context.inputs as Record<string, string>)["credential-authority"];
  return { context, requests, saved: () => checkpoint, privatePair: () => apiKey };
}

const fresh = fixture();
assert.equal(adapter.ready(await adapter.firstRun(fresh.context)), true);
assert.equal(fresh.requests.filter((request) => request.path.endsWith("/auth/setup-admin")).length, 1);
assert.equal(fresh.saved()?.data.adminId, user.id);

const resumed = fixture({ existing: true, checkpoint: fresh.saved()!, apiKey: fresh.privatePair()!, existingToken: true });
assert.equal(adapter.ready(await adapter.firstRun(resumed.context)), true);
assert.equal(resumed.requests.some((request) => request.path.endsWith("/auth/setup-admin")), false);
assert.equal(resumed.requests.some((request) => request.method === "POST" && request.path.endsWith("/auto-enrollment/tokens")), false);

const interrupted = fixture({ loseCreate: true });
await assert.rejects(adapter.firstRun(interrupted.context), /lost response/);
const reconcile = fixture({ existing: true, checkpoint: interrupted.saved()! });
assert.equal(adapter.ready(await adapter.firstRun(reconcile.context)), true);
assert.equal(reconcile.requests.some((request) => request.path.endsWith("/auth/setup-admin")), false);
await assert.rejects(adapter.firstRun(fixture({ checkpoint: interrupted.saved()! }).context), /instead of replaying/);

await assert.rejects(adapter.firstRun(fixture({ existing: true }).context), /not proven to belong/);
await assert.rejects(adapter.firstRun(fixture({ unhealthy: true }).context), /authenticated Redis/);
const changed = structuredClone(fresh.saved()!);
changed.data.email = "different@example.invalid";
await assert.rejects(adapter.firstRun(fixture({ existing: true, checkpoint: changed }).context), /changed on resume/);
changed.data.email = email;
changed.data.adminId = "different-admin";
await assert.rejects(adapter.firstRun(fixture({ existing: true, checkpoint: changed }).context), /identity changed/);
assert.equal(adapter.ready({ appId: "patchmon", stage: "admin-login-verified" }), false);
const dashboardOnly = fixture({ noOptIn: true });
const dashboardRecord = await adapter.firstRun(dashboardOnly.context);
assert.equal(dashboardRecord.stage, "credential-authority-required");
assert.equal(dashboardRecord.apiKeyCreated, false);
assert.equal(adapter.ready(dashboardRecord), false);
assert.equal(dashboardOnly.requests.some((request) => request.path.includes("/auto-enrollment/")), false);
assert.equal(JSON.stringify(dashboardRecord).includes(SYNTHETIC_ADMIN_CREDENTIAL), false);
assert.equal(JSON.stringify(await adapter.firstRun(resumed.context)).includes(pair.apiSecret), false);

const lostToken = fixture({ loseToken: true });
await assert.rejects(adapter.firstRun(lostToken.context), /lost token response/);
await assert.rejects(adapter.firstRun(fixture({ existing: true, checkpoint: lostToken.saved()!, existingToken: true }).context), /never replay/);
await assert.rejects(adapter.firstRun(fixture({ existing: true, checkpoint: lostToken.saved()! }).context), /never replay/);
const savedToken = fixture({ loseAfterSave: true });
await assert.rejects(adapter.firstRun(savedToken.context), /atomic secret save/);
assert.equal(adapter.ready(await adapter.firstRun(fixture({ existing: true, checkpoint: savedToken.saved()!,
  existingToken: true, apiKey: savedToken.privatePair()! }).context)), true);
await assert.rejects(adapter.firstRun(fixture({ existing: true, checkpoint: fresh.saved()!, existingToken: true,
  apiKey: fresh.privatePair()!, tokenDrift: true }).context), /authority drifted/);
console.log("PatchMon focused synthetic administrator, Homarr credential and replay checks passed");
