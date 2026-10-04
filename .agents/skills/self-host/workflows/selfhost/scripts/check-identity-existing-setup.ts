import assert from "node:assert/strict";
import homeAssistant from "../references/catalog/apps/home-assistant/setup.ts";
import lldap from "../references/catalog/apps/lldap/setup.ts";
import seafile from "../references/catalog/apps/seafile/setup.ts";
import docmost from "../references/catalog/apps/docmost/setup.ts";
import linkwarden from "../references/catalog/apps/linkwarden/setup.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpRequest,
  SetupHttpResponse } from "../references/catalog/types/setup.ts";

function response(status: number, body: unknown): SetupHttpResponse {
  return { status, ok: status >= 200 && status < 300,
    headers: { get() { return null; } }, async json() { return body; },
    async text() { return JSON.stringify(body); } };
}

function fixture(appId: string, request: (value: SetupHttpRequest) => Promise<SetupHttpResponse>) {
  const projectRoot = `/tmp/${appId}-identity-fixture`;
  let checkpoint: SetupCheckpoint | null = null;
  let apiKey: string | null = null;
  let sessionCookies: Record<string, string> = {};
  const update = async (next: SetupCheckpointUpdate): Promise<SetupCheckpoint> => {
    assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
    checkpoint = { schemaVersion: 1, appId, projectRoot, revision: (checkpoint?.revision ?? 0) + 1,
      stage: next.stage, attemptedActions: checkpoint?.attemptedActions ?? [], data: next.data ?? {} };
    return checkpoint;
  };
  const context = { appId, projectRoot,
    async status() { return { command: "app status", appId, projectRoot,
      status: "applied", mutation: false, runtime: { state: "running" },
      username: "admin", passwordFile: `${projectRoot}/secrets/admin-password`,
      port: 18123, url: "http://127.0.0.1:18123" }; },
    secrets: { async readAdminPassword() { return "A".repeat(48); },
      async readSessionCookies() { return { ...sessionCookies }; },
      async writeSessionCookies(value: Readonly<Record<string, string>>) { sessionCookies = { ...value }; },
      async readApiKey() { return apiKey; },
      async apiKeyPath() { if (apiKey === null) return null; return `${projectRoot}/secrets/api-key`; },
      async writeApiKey(value: string) { apiKey = value; return `${projectRoot}/secrets/api-key`; } },
    checkpoint: { async read() { return checkpoint; }, compareAndSet: update },
    http: { async request(value: SetupHttpRequest) {
      if (value.beforeSendCheckpoint) {
        await update(value.beforeSendCheckpoint);
        checkpoint!.attemptedActions.push(value.approval!.action);
      }
      return request(value);
    } },
  } as unknown as SetupContext;
  return { context, setCheckpoint(value: SetupCheckpoint | null) { checkpoint = value; },
    setApiKey(value: string | null) { apiKey = value; }, checkpoint() { return checkpoint; } };
}

let onboardingStatus = 200;
let created = false;
let creates = 0;
let rejectedPassword = false;
let loseCreationResponse = false;
let tokenWrites = 0;
let loseTokenResponse = false;
let isOwner = true;
let ownerId = "b".repeat(32);
let sessionStatus = 200;
const ha = fixture("home-assistant", async (request) => {
  if (request.path === "/api/onboarding") {
    return response(onboardingStatus, [{ step: "user", done: created },
      { step: "core_config", done: false }, { step: "analytics", done: false },
      { step: "integration", done: false }]);
  }
  if (request.path === "/api/") return response(sessionStatus, { message: "API running." });
  if (request.path === "/api/onboarding/users") {
    assert.equal(request.approval?.once, true);
    assert.equal(ha.checkpoint()?.stage, "owner-attempted");
    created = true;
    creates += 1;
    if (loseCreationResponse) throw new Error("lost response");
    return response(200, { auth_code: "discarded" });
  }
  if (request.path === "/auth/login_flow") {
    return response(200, { type: "form", flow_id: "a".repeat(32) });
  }
  if (request.path === "/auth/token") {
    assert.equal(new URLSearchParams(String(request.body)).get("grant_type"), "authorization_code");
    return response(200, { access_token: "session".repeat(16), token_type: "Bearer", expires_in: 1800 });
  }
  assert.equal(request.path, `/auth/login_flow/${"a".repeat(32)}`);
  if (rejectedPassword) return response(200, { type: "form", errors: { base: "invalid_auth" } });
  return response(200, { type: "create_entry", result: "e".repeat(32) });
});
ha.context.webSocket = { async request(request) {
  assert.equal(request.path, "/api/websocket");
  if (request.type === "auth/current_user") {
    return { id: ownerId, is_owner: isOwner, is_admin: isOwner,
      credentials: [{ auth_provider_type: "homeassistant", auth_provider_id: null }] };
  }
  assert.equal(request.type, "auth/long_lived_access_token");
  assert.equal(request.approval?.once, true);
  assert.deepEqual(request.payload, { client_name: "selfhost-homarr", lifespan: 3650 });
  await ha.context.checkpoint.compareAndSet(request.beforeSendCheckpoint!);
  ha.checkpoint()!.attemptedActions.push(request.approval!.action);
  tokenWrites += 1;
  if (loseTokenResponse) throw new Error("lost token response");
  return "durable".repeat(16);
} };
const initialOwner = await homeAssistant.firstRun(ha.context);
assert.equal(homeAssistant.ready(initialOwner), true);
assert.equal(initialOwner.onboardingComplete, false);
assert.deepEqual(initialOwner.pendingOnboardingSteps, ["core_config", "analytics", "integration"]);
assert.equal(creates, 1);
assert.equal(tokenWrites, 1);
onboardingStatus = 404; // Fully completed onboarding removes its view on restart.
const restartedOwner = await homeAssistant.firstRun(ha.context);
assert.equal(homeAssistant.ready(restartedOwner), true);
assert.equal(restartedOwner.onboardingComplete, true);
assert.deepEqual(restartedOwner.pendingOnboardingSteps, []);
assert.equal(creates, 1);
assert.equal(tokenWrites, 1);
isOwner = false;
await assert.rejects(homeAssistant.firstRun(ha.context), /administrator owner/);
isOwner = true;
ownerId = "c".repeat(32);
await assert.rejects(homeAssistant.firstRun(ha.context), /differs from the saved/);
ownerId = "b".repeat(32);
rejectedPassword = true;
sessionStatus = 401;
await assert.rejects(homeAssistant.firstRun(ha.context), /credential was not accepted/);
rejectedPassword = false;
sessionStatus = 200;
const trusted = ha.checkpoint()!;
ha.setCheckpoint({ ...trusted, appId: "another-app" });
await assert.rejects(homeAssistant.firstRun(ha.context), /unrecognized first-owner checkpoint/);
ha.setCheckpoint({ ...trusted, attemptedActions: [] });
await assert.rejects(homeAssistant.firstRun(ha.context), /unrecognized first-owner checkpoint/);
ha.setCheckpoint(null);
await assert.rejects(homeAssistant.firstRun(ha.context), /onboarding status is unavailable/);
assert.equal(creates, 1);
onboardingStatus = 200;
await assert.rejects(homeAssistant.firstRun(ha.context), /refusing to adopt/);
created = false;
ha.setApiKey(null);
await ha.context.secrets.writeSessionCookies({});
loseCreationResponse = true;
await assert.rejects(homeAssistant.firstRun(ha.context), /lost response/);
loseCreationResponse = false;
assert.equal(homeAssistant.ready(await homeAssistant.firstRun(ha.context)), true);
assert.equal(creates, 2); // Exactly one write for each fresh fixture owner.
assert.equal(tokenWrites, 2);
ha.setCheckpoint(null);
ha.setApiKey(null);
await ha.context.secrets.writeSessionCookies({});
created = false;
loseTokenResponse = true;
await assert.rejects(homeAssistant.firstRun(ha.context), /lost token response/);
loseTokenResponse = false;
await assert.rejects(homeAssistant.firstRun(ha.context), /not saved/);
assert.equal(tokenWrites, 3);
assert.equal(ha.checkpoint()?.stage, "token-attempted");
ha.setApiKey("durable".repeat(16));
assert.equal(homeAssistant.ready(await homeAssistant.firstRun(ha.context)), true);
assert.equal(tokenWrites, 3);
const tokenInspected = await homeAssistant.inspect!(ha.context);
assert.equal(homeAssistant.ready(tokenInspected), true);
assert.equal(tokenInspected.passwordLoginVerified, false);

let groups: unknown[] = [{ displayName: "lldap_admin" }];
const directory = fixture("lldap", async (request) => {
  if (request.path === "/auth/simple/login") return response(200, { token: "a".repeat(48) });
  assert.equal(request.path, "/api/graphql");
  assert.equal(JSON.parse(String(request.body)).query,
    '{ user(userId: "admin") { id groups { displayName } } }');
  return response(200, { data: { user: { id: "admin", groups } } });
});
assert.equal(lldap.ready(await lldap.firstRun(directory.context)), true);
groups = [{ displayName: "lldap_strict_readonly" }];
await assert.rejects(lldap.firstRun(directory.context), /did not confirm/);
groups = ["lldap_admin"];
await assert.rejects(lldap.firstRun(directory.context), /did not confirm/);

let adminAllowed = true;
const files = fixture("seafile", async (request) => {
  if (request.path === "/api2/auth-token/") return response(200, { token: "a".repeat(40) });
  assert.equal(request.path, "/api/v2.1/admin/users/");
  assert.equal(request.headers?.Authorization, `Bearer ${"a".repeat(40)}`);
  return response(adminAllowed ? 200 : 403, { users: [] });
});
assert.equal(seafile.ready(await seafile.firstRun(files.context)), true);
assert.equal(seafile.ready(await seafile.firstRun(files.context)), true);
adminAllowed = false;
await assert.rejects(seafile.firstRun(files.context), /administrator API access/);

const userId = "11111111-1111-4111-8111-111111111111";
let workspaceId = "22222222-2222-4222-8222-222222222222";
let docmostRole = "owner";
let docmostCreates = 0;
let loseDocmostResponse = false;
const docs = fixture("docmost", async (request) => {
  if (request.path === "/api/auth/setup") {
    docmostCreates += 1;
    if (loseDocmostResponse) throw new Error("lost workspace response");
    const result = response(200, { success: true, status: 200,
      data: { id: workspaceId, name: "My workspace", defaultSpaceId: userId } });
    result.headers.get = () => "authToken=private-fixture-cookie; HttpOnly";
    return result;
  }
  if (request.path === "/api/auth/login") {
    const result = response(200, { success: true, status: 200 });
    result.headers.get = () => "authToken=private-fixture-cookie; HttpOnly";
    return result;
  }
  assert.equal(request.path, "/api/users/me");
  assert.equal(request.method, "POST");
  assert.equal(request.headers?.Cookie, "authToken=private-fixture-cookie");
  return response(200, { success: true, status: 200, data: {
    user: { id: userId, email: "admin@example.test", role: docmostRole, workspaceId },
    workspace: { id: workspaceId } } });
});
assert.equal(docmost.ready(await docmost.firstRun(docs.context)), true);
assert.equal(docmost.ready(await docmost.firstRun(docs.context)), true);
assert.equal(docmostCreates, 1);
docmostRole = "admin";
await assert.rejects(docmost.firstRun(docs.context), /not the expected workspace owner/);
docmostRole = "owner";
workspaceId = "33333333-3333-4333-8333-333333333333";
await assert.rejects(docmost.firstRun(docs.context), /differs from the saved/);
docs.setCheckpoint(null);
loseDocmostResponse = true;
await assert.rejects(docmost.firstRun(docs.context), /lost workspace response/);
loseDocmostResponse = false;
assert.equal(docmost.ready(await docmost.firstRun(docs.context)), true);
assert.equal(docmostCreates, 2);

let existingUsers = 1;
let linkwardenWrites = 0;
const archive = fixture("linkwarden", async (request) => {
  if (request.path === "/api/v1/users") linkwardenWrites += 1;
  throw new Error("stop-after-preflight");
});
const archiveStatus = archive.context.status;
archive.context.status = async () => ({ ...await archiveStatus() as object,
  ownerKind: "shared", manifestHash: "a".repeat(64), selectionFingerprint: "b".repeat(64) });
archive.context.container = { async exec(command) {
  assert.equal(command.effect, "read");
  assert.deepEqual(command.argv.slice(0, 2), ["node", "-e"]);
  assert.match(command.argv[2]!, /db\.user\.count\(\)/);
  assert.doesNotMatch(command.argv[2]!, /\.create\(|\.update\(|\.delete\(/);
  return { exitCode: 0, stdout: JSON.stringify({ count: existingUsers }) };
} };
await assert.rejects(linkwarden.firstRun(archive.context), /already has users/);
assert.equal(linkwardenWrites, 0);
assert.equal(archive.checkpoint(), null);
existingUsers = 0;
await assert.rejects(linkwarden.firstRun(archive.context), /stop-after-preflight/);
assert.equal(linkwardenWrites, 1);
assert.equal(archive.checkpoint()?.stage, "account-attempted");
process.stdout.write("identity-existing HA durable-token/replay, Docmost owner-role, Linkwarden preflight, LLDAP role, Seafile bearer checks passed\n");
