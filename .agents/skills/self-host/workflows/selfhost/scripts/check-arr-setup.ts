import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sonarr from "../references/catalog/apps/sonarr/setup.ts";
import radarr from "../references/catalog/apps/radarr/setup.ts";
import prowlarr from "../references/catalog/apps/prowlarr/setup.ts";
import type { SetupAdapter, SetupContext, SetupInspectionContext } from "../references/catalog/types/setup.ts";

for (const adapter of [sonarr, radarr, prowlarr] as SetupAdapter[]) {
  const appId = adapter.appId;
  const root = `/tmp/${appId}-setup-fixture`;
  const passwordFile = `${root}/secrets/admin-password`;
  const apiKeyFile = `${root}/secrets/${appId}-api-key`;
  const key = "a".repeat(32);
  const fixtureCredential = "b".repeat(48);
  let configKey = key;
  let privateKeyPath = apiKeyFile;
  const apiPath = "/api/v3/config/host";
  let sessionStatus = 200;
  let anonymousStatus = 302;
  let loginCookie = `${appId}Auth=private-fixture-cookie; Path=/; HttpOnly`;
  let savedKey: string | null = null;
  let config: Record<string, unknown> = {
    id: 1, authenticationMethod: "none", authenticationRequired: "disabled", username: "", password: "",
  };
  let checkpoint: Record<string, unknown> | null = null;
  let writes = 0;
  let logins = 0;
  let loginLocation = "/";
  let deferredOn: "PUT" | "POST" | null = null;
  let losePutResponse = false;
  const deferred = new Error("setup approval deferred");
  const context = {
    appId, projectRoot: root, inputs: {},
    async status() {
      return { ownerKind: "shared", command: "app status", appId, projectRoot: root, status: "applied",
        mutation: false, runtime: { state: "running" }, passwordFile,
        privateFiles: `${root}/secrets` };
    },
    http: { async request(request: { method: string; path: string; headers?: Record<string, string>;
      body?: string; approval?: { action: string; once?: boolean };
      beforeSendCheckpoint?: { expectedRevision: number | null; stage: string; data: Record<string, unknown> } }) {
      if (request.method === deferredOn) throw deferred;
      if (request.method === "GET") {
        if (request.path === "/") {
          assert.equal(request.headers?.["X-Api-Key"], undefined);
          if (request.headers?.Cookie !== undefined) {
            assert.equal(request.headers.Cookie, `${appId}Auth=private-fixture-cookie`);
            return { status: sessionStatus, ok: sessionStatus === 200,
              headers: { get() { return null; } }, async json() { return {}; }, async text() { return ""; } };
          }
          return { status: anonymousStatus, ok: false,
            headers: { get(name: string) { if (name === "location") return "/login?returnUrl=%2F"; return null; } },
            async json() { return {}; }, async text() { return ""; } };
        }
        let expectedApiPath = apiPath;
        if (appId === "prowlarr") expectedApiPath = "/api/v1/config/host";
        assert.equal(request.path, expectedApiPath);
        assert.equal(request.headers?.["X-Api-Key"], key);
        return { status: 200, ok: true, headers: { get() { return null; } },
          async json() { return config; }, async text() { return JSON.stringify(config); } };
      }
      if (request.method === "PUT") {
        let expectedApiPath = apiPath;
        if (appId === "prowlarr") expectedApiPath = "/api/v1/config/host";
        assert.equal(request.path, `${expectedApiPath}/1`);
        assert.equal(request.approval?.action, `${appId}-configure-forms-auth`);
        assert.equal(request.approval.once, true);
        assert.equal(request.beforeSendCheckpoint?.stage, "auth-update-attempted");
        assert.equal(request.beforeSendCheckpoint?.expectedRevision, null);
        checkpoint = { schemaVersion: 1, appId, projectRoot: root, revision: 1,
          stage: "auth-update-attempted", attemptedActions: [request.approval.action],
          data: request.beforeSendCheckpoint.data };
        const payload = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
        assert.equal(payload.password, fixtureCredential);
        assert.equal(payload.passwordConfirmation, fixtureCredential);
        config = { id: 1, authenticationMethod: String(payload.authenticationMethod),
          authenticationRequired: String(payload.authenticationRequired), username: String(payload.username),
          password: createHash("sha256").update(fixtureCredential).digest("hex") };
        writes += 1;
        if (losePutResponse) throw new Error("response lost after authentication update");
        return { status: 202, ok: true, headers: { get() { return null; } },
          async json() { return config; }, async text() { return JSON.stringify(config); } };
      }
      assert.equal(request.method, "POST");
      assert.equal(request.path, "/login");
      assert.equal(request.approval?.action, `${appId}-verify-forms-login`);
      if (appId === "prowlarr") {
        assert.match(request.headers?.["Content-Type"] ?? "", /^multipart\/form-data; boundary=/);
        assert.ok(request.body?.includes('name="username"\r\n\r\nadmin\r\n'));
        assert.ok(request.body?.includes(`name="password"\r\n\r\n${fixtureCredential}\r\n`));
      } else {
        const form = new URLSearchParams(request.body);
        assert.equal(form.get("username"), "admin");
        assert.equal(form.get("password"), fixtureCredential);
      }
      logins += 1;
      return { status: 302, ok: false,
        headers: { get(name: string) {
          if (name === "location") return loginLocation;
          if (name === "set-cookie") return loginCookie;
          return null;
        } },
        async json() { return {}; }, async text() { return ""; } };
    } },
    secrets: {
      async readServiceConfigXmlApiKey() { return configKey; },
      async readApiKey() { return savedKey; },
      async apiKeyPath() { if (savedKey === null) return null; return privateKeyPath; },
      async writeApiKey(value: string) { assert.equal(value, key); savedKey = value; return privateKeyPath; },
      async readAdminPassword() { return fixtureCredential; },
    },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(update: { expectedRevision: number | null; stage: string; data: Record<string, unknown> }) {
        const current = checkpoint as { revision: number; attemptedActions: string[] } | null;
        assert.equal(update.expectedRevision, current?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId, projectRoot: root,
          revision: (current?.revision ?? 0) + 1,
          stage: update.stage, attemptedActions: current?.attemptedActions ?? [], data: update.data };
        return checkpoint;
      },
    },
  } as unknown as SetupContext;
  const first = await adapter.firstRun(context);
  assert.equal(adapter.ready(first), true);
  assert.deepEqual(adapter.compatibilityResult?.(first), { origin: "fresh", credentialReadback: "verified" });
  assert.equal(adapter.compatibilityResult?.({ ...first }), null, "saved copies are not fresh live proof");
  assert.equal(writes, 1);
  assert.equal(logins, 1);
  const inspected = await adapter.inspect!(context as unknown as SetupInspectionContext);
  assert.equal(adapter.ready(inspected), true);
  assert.equal(adapter.compatibilityResult?.(inspected), null, "inspection cannot manufacture fresh login evidence");
  const resumed = await adapter.firstRun(context);
  assert.equal(adapter.ready(resumed), true);
  assert.deepEqual(adapter.compatibilityResult?.(resumed), { origin: "resume", credentialReadback: "verified" });
  assert.equal(writes, 1, `${appId} must not rewrite Forms auth on resume`);
  assert.equal(logins, 2, `${appId} must reverify the saved password on resume`);
  sessionStatus = 302;
  await assert.rejects(adapter.firstRun(context), /session did not pass readback/);
  sessionStatus = 200;
  loginCookie = "unrelated=private-fixture-cookie";
  await assert.rejects(adapter.firstRun(context), /did not establish an administrator session/);
  loginCookie = `${appId}Auth=private-fixture-cookie; Path=/; HttpOnly`;
  anonymousStatus = 200;
  await assert.rejects(adapter.firstRun(context), /did not require a Forms administrator login/);
  anonymousStatus = 302;
  configKey = "c".repeat(32);
  await assert.rejects(adapter.firstRun(context), /API key changed/);
  configKey = key;
  privateKeyPath = `${root}/secrets/unrelated-api-key`;
  await assert.rejects(adapter.firstRun(context), /private API key path is unavailable/);
  privateKeyPath = apiKeyFile;
  assert.equal(writes, 1, `${appId} must not repair drift by repeating auth PUT`);
  loginLocation = "/login?loginFailed=true";
  await assert.rejects(adapter.firstRun(context), /rejected the saved Forms administrator login/);
  assert.equal(writes, 1);
  checkpoint = null;
  config = { id: 1, authenticationMethod: "none", authenticationRequired: "disabled", username: "", password: "" };
  deferredOn = "PUT";
  await assert.rejects(adapter.firstRun(context), (error: unknown) => error === deferred);
  assert.equal(writes, 1, `${appId} must not write after declined auth approval`);
  config = { id: 1, authenticationMethod: "forms", authenticationRequired: "enabled", username: "admin",
    password: createHash("sha256").update(fixtureCredential).digest("hex") };
  deferredOn = "POST";
  await assert.rejects(adapter.firstRun(context), (error: unknown) => error === deferred);
  assert.equal(logins, 5, `${appId} must not send login after declined approval`);
  checkpoint = null;
  deferredOn = null;
  loginLocation = "/";
  config = { id: 1, authenticationMethod: "none", authenticationRequired: "disabled", username: "", password: "" };
  losePutResponse = true;
  await assert.rejects(adapter.firstRun(context), /response lost after authentication update/);
  assert.equal(writes, 2);
  assert.equal(checkpoint?.stage, "auth-update-attempted");
  losePutResponse = false;
  const reconciled = await adapter.firstRun(context);
  assert.equal(adapter.ready(reconciled), true);
  assert.equal(adapter.compatibilityResult?.(reconciled), null, "ambiguous creation cannot manufacture fresh proof");
  assert.equal(writes, 2, `${appId} must reconcile a lost response without repeating PUT`);
  checkpoint = null;
  config = { id: 1, authenticationMethod: "none", authenticationRequired: "disabled", username: "" };
  await assert.rejects(adapter.firstRun(context), /already has different authentication/);
  assert.equal(writes, 2, "unreadable prior user must not be replaced");
  config = { id: 1, authenticationMethod: "basic", authenticationRequired: "enabled", username: "other" };
  await assert.rejects(adapter.firstRun(context), /already has different authentication/);
  assert.equal(writes, 2, `${appId} must preserve unexpected existing authentication`);
}

process.stdout.write("Arr setup checks passed\n");
