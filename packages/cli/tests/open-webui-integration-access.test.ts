import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/open-webui/setup";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../src/control-panel/setup-transport";

const SYNTHETIC_ADMIN_CREDENTIAL = "A".repeat(48);
const SYNTHETIC_API_KEY = `sk-${"b".repeat(32)}`;

async function scenario(existing: boolean, loseCreateResponse: boolean, losePolicyResponse = false,
  policyFailure?: "unrelated-drift" | "uncertain-not-applied" | "noncanonical"): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "open-webui-integration-fixture-"));
  const projectId = "webui_fixture";
  const directory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(directory, "secrets", "open-webui");
  const passwordFile = join(privateFiles, "admin-password");
  let logins = 0;
  let creates = 0;
  let policyWrites = 0;
  const initialPolicy = {
    SHOW_ADMIN_DETAILS: true, ADMIN_EMAIL: null, WEBUI_URL: "https://synthetic.example.test",
    ENABLE_LOGIN_FORM: true, ENABLE_SIGNUP: false, ENABLE_API_KEYS: false,
    ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false, API_KEYS_ALLOWED_ENDPOINTS: "",
    DEFAULT_USER_ROLE: "pending", DEFAULT_GROUP_ID: "synthetic-group", DEFAULT_INTERFACE_SETTINGS: { theme: "dark" },
    I18N: { en: { greeting: "  " } }, JWT_EXPIRES_IN: "4w", ENABLE_COMMUNITY_SHARING: false,
    ENABLE_MESSAGE_RATING: true, ENABLE_FOLDERS: true, FOLDER_MAX_FILE_COUNT: 25,
    AUTOMATION_MAX_COUNT: "", AUTOMATION_MIN_INTERVAL: "", ENABLE_AUTOMATIONS: true,
    ENABLE_CHANNELS: false, CHANNEL_MODEL_RESPONSE_MODE: "thread", ENABLE_CALENDAR: true,
    ENABLE_MEMORIES: true, ENABLE_MEMORY_SYSTEM_CONTEXT: true, ENABLE_NOTES: true,
    ENABLE_USER_WEBHOOKS: false, ENABLE_USER_STATUS: true, PENDING_USER_OVERLAY_TITLE: "",
    PENDING_USER_OVERLAY_CONTENT: "", RESPONSE_WATERMARK: "synthetic-watermark",
  };
  let policy = { ...initialPolicy };
  let currentKey: string | null = null;
  if (existing) currentKey = SYNTHETIC_API_KEY;
  let jwt = "";
  const validSessions = new Set<string>();
  let loginStatus = 200;
  let freshIdentityStatus = 200;
  let differentFreshOwner = false;
  let failKeyVerification = true;
  const account = { id: "synthetic-owner", email: "admin@example.test", role: "admin" };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/auths/signin") {
      assert.equal(request.method, "POST");
      assert.deepEqual(await request.json(), { email: account.email, password: SYNTHETIC_ADMIN_CREDENTIAL });
      if (loginStatus !== 200) return new Response(null, { status: loginStatus });
      logins += 1;
      jwt = `synthetic-session-${"c".repeat(32)}-${logins}`;
      validSessions.add(jwt);
      return Response.json({ ...account, token: jwt });
    }
    const authorization = request.headers.get("authorization");
    if (path === "/api/v1/auths/") {
      if (authorization === `Bearer ${SYNTHETIC_API_KEY}`) {
        assert.equal(currentKey, SYNTHETIC_API_KEY);
        if (failKeyVerification) return new Response(null, { status: 500 });
      } else {
        assert.ok(validSessions.has(authorization?.slice(7) ?? ""));
        if (authorization === `Bearer ${jwt}` && freshIdentityStatus !== 200) return new Response(null, { status: freshIdentityStatus });
        if (authorization === `Bearer ${jwt}` && differentFreshOwner) return Response.json({ ...account, id: "different-owner" });
      }
      return Response.json(account);
    }
    assert.ok(validSessions.has(authorization?.slice(7) ?? ""));
    if (path === "/api/v1/auths/admin/config") {
      if (request.method === "GET") {
        if (policyFailure === "noncanonical") return Response.json({ ...policy, FOLDER_MAX_FILE_COUNT: "25" });
        return Response.json(policy);
      }
      assert.equal(request.method, "POST");
      const payload = await request.json() as Record<string, unknown>;
      const expected = { ...initialPolicy, ENABLE_API_KEYS: true } as Record<string, unknown>;
      delete expected.I18N;
      delete expected.ENABLE_LOGIN_FORM;
      assert.deepEqual(payload, expected, "Only enable API keys; preserve unrelated settings and omit normalized I18N");
      assert.equal(policyWrites, 0, "Never replay a policy write, including a lost successful response");
      policyWrites += 1;
      if (policyFailure === "uncertain-not-applied") return new Response(null, { status: 502 });
      policy = { ...policy, ENABLE_API_KEYS: true };
      if (policyFailure === "unrelated-drift") policy.ENABLE_SIGNUP = true;
      if (losePolicyResponse) return new Response(null, { status: 502 });
      return Response.json(policy);
    }
    assert.equal(path, "/api/v1/auths/api_key");
    if (!policy.ENABLE_API_KEYS) return new Response(null, { status: 403 });
    if (request.method === "GET") {
      if (currentKey === null) return new Response(null, { status: 404 });
      return Response.json({ api_key: currentKey });
    }
    assert.equal(request.method, "POST");
    assert.equal(currentKey, null, "Never rotate an existing owner key");
    creates += 1;
    currentKey = SYNTHETIC_API_KEY;
    if (loseCreateResponse) return new Response(null, { status: 502 });
    return Response.json({ api_key: currentKey });
  } });
  try {
    await mkdir(privateFiles, { recursive: true, mode: 0o700 });
    await writeFile(passwordFile, SYNTHETIC_ADMIN_CREDENTIAL, { mode: 0o600 });
    const status = { command: "app status", ownerKind: "shared", appId: "open-webui", projectRoot: root,
      mutation: false, status: "applied", runtime: { state: "running" }, projectId, dockerContext: "default",
      port: server.port, url: `http://127.0.0.1:${server.port}`, composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
      applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
      manifestHash: "b".repeat(64), privateFiles, passwordFile, username: account.email };
    const approvals = new Set<string>();
    let review: { action: string; token: string } | undefined;
    function invocation(enabled: boolean): SetupContext {
      const facilities = createSetupTransportFacilities({ appId: "open-webui", projectRoot: root,
        async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
        async approve(action, token) { review = { action, token }; return approvals.has(token); },
        approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
      return { ...facilities, appId: "open-webui", projectRoot: root, installedAppIds: [],
        inputs: enabled ? { "integration-access": "enabled" } : {}, async status() { return status; } } as SetupContext;
    }
    await assert.rejects(adapter.firstRun(invocation(false)), (error) => error instanceof SetupTransportDeferred);
    assert.ok(review); approvals.add(review.token);
    const accountOnly = await adapter.firstRun(invocation(false));
    assert.ok(adapter.ready(accountOnly)); assert.equal(accountOnly.integrationReady, false);
    assert.equal(creates, 0); assert.equal(policyWrites, 0); assert.equal(await invocation(false).checkpoint.read(), null);

    async function complete(): Promise<Record<string, unknown>> {
      for (let count = 0; count < 35; count += 1) {
        try { return await adapter.firstRun(invocation(true)); }
        catch (error) {
          if (error instanceof SetupTransportDeferred) {
            assert.ok(review);
            if (review.action === "open-webui-enable-integration-policy") {
              assert.equal(policyWrites, 0, "Policy must not be sent before its own exact approval");
              assert.equal(creates, 0);
              assert.equal((await invocation(true).checkpoint.read())?.stage, "integration-admin-verified");
            }
            const blocked = review.token;
            await assert.rejects(adapter.firstRun(invocation(true)), (again) => again instanceof SetupTransportDeferred);
            assert.equal(review.token, blocked, "Deferred authenticated approval must remain stable");
            approvals.add(blocked);
            continue;
          }
          if (error instanceof Error && error.message.includes("policy enable outcome is unresolved") && losePolicyResponse) {
            assert.equal(policyWrites, 1);
            assert.equal(creates, 0);
            assert.equal((await invocation(true).checkpoint.read())?.stage, "integration-policy-enable-attempted");
            continue;
          }
          if (policyFailure && error instanceof Error
            && (error.message.includes("policy enable outcome is unresolved") || error.message.includes("cannot round-trip unchanged"))) {
            return { failure: error.message };
          }
          if (error instanceof Error && error.message.includes("creation is unresolved") && loseCreateResponse) {
            assert.equal(await invocation(true).secrets.readApiKey(), null);
            assert.equal(creates, 1);
            continue; // Recover pinned GET plaintext, never repeat POST.
          }
          if (error instanceof Error && error.message.includes("did not verify the same administrator")) {
            assert.equal(await invocation(true).secrets.readApiKey(), SYNTHETIC_API_KEY);
            failKeyVerification = false;
            continue;
          }
          throw error;
        }
      }
      throw new Error("Synthetic setup never completed");
    }
    const verified = await complete();
    if (policyFailure) {
      assert.equal(typeof verified.failure, "string");
      assert.equal(creates, 0);
      assert.equal(currentKey, SYNTHETIC_API_KEY, "A policy failure must retain the existing owner key");
      const expectedWrites = Number(policyFailure !== "noncanonical");
      assert.equal(policyWrites, expectedWrites);
      const failedCheckpoint = await invocation(true).checkpoint.read();
      assert.equal(typeof (await complete()).failure, "string");
      assert.equal(policyWrites, expectedWrites, "Never replay a conflicting or uncertain policy write");
      assert.deepEqual(await invocation(true).checkpoint.read(), failedCheckpoint);
      return;
    }
    assert.ok(adapter.ready(verified)); assert.equal(verified.integrationReady, true);
    assert.equal(policyWrites, 1);
    assert.deepEqual(policy, { ...initialPolicy, ENABLE_API_KEYS: true });
    assert.ok(logins >= 3, "Cached integration login must also prove the saved password");
    assert.equal(creates, Number(!existing));
    assert.equal(policyWrites, 1);
    const keyFile = await invocation(true).secrets.apiKeyPath();
    assert.ok(keyFile); assert.equal((await lstat(keyFile)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
    // Final checkpoint binds a new approval once, then completed replay is stable.
    assert.ok(adapter.ready(await complete()));
    const completed = await invocation(true).checkpoint.read();
    assert.ok(adapter.ready(await complete()));
    assert.deepEqual(await invocation(true).checkpoint.read(), completed);
    assert.equal(creates, Number(!existing));
    const retained = await invocation(true).secrets.readSessionCookies();
    loginStatus = 401;
    await assert.rejects(adapter.firstRun(invocation(true)), /administrator login could not be verified/);
    assert.deepEqual(await invocation(true).secrets.readSessionCookies(), retained);
    loginStatus = 200;
    for (const failure of ["token", "identity"] as const) {
      freshIdentityStatus = 200;
      differentFreshOwner = false;
      await assert.rejects(adapter.firstRun(invocation(true)), SetupTransportDeferred);
      const pending = await invocation(true).secrets.readSessionCookies();
      assert.equal(pending.token, retained.token);
      assert.ok(pending["pending-token"]);
      const blocked = review!.token;
      await assert.rejects(adapter.firstRun(invocation(true)), SetupTransportDeferred);
      assert.equal(review!.token, blocked, "Fresh identity review must preserve its pending bearer");
      approvals.add(blocked);
      if (failure === "token") freshIdentityStatus = 401;
      else differentFreshOwner = true;
      await assert.rejects(adapter.firstRun(invocation(true)), /fresh password/);
      assert.deepEqual(await invocation(true).secrets.readSessionCookies(), retained);
    }
    await assert.rejects(adapter.firstRun(invocation(false)), /integration choice changed/);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}

await scenario(false, false);
await scenario(false, true);
await scenario(true, false);
await scenario(true, false, true);
for (const failure of ["unrelated-drift", "uncertain-not-applied", "noncanonical"] as const) {
  await scenario(true, false, false, failure);
}
process.stdout.write("Open WebUI actual-transport optional policy/key/replay recovery: pass\n");
