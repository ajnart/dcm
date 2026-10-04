import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/bookstack/setup";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../src/control-panel/setup-transport";

// Synthetic pinned forms, actual HTTP/CAS/approval/private-session facilities.
const root = await mkdtemp(join(tmpdir(), "bookstack-token-fixture-"));
const projectId = "bookstack_fixture";
const directory = join(root, ".selfhost", "shared", projectId);
const privateFiles = join(directory, "secrets", "bookstack");
const passwordFile = join(privateFiles, "admin-password");
const password = "SyntheticGeneratedOwnerPassword123456789";
const csrf = "s".repeat(40);
const key = `${"i".repeat(32)}:${"k".repeat(32)}`;
const input = (name: string, value: string) => `<input type="text" name="${name}" value="${value}">`;
let creates = 0;
let captures = 0;
let logins = 0;
let firstAdmins = 0;
let allowLogin = false;
let allowCreate = false;
let allowCapture = false;
let wrongIdentity = false;
let loginStatus = 302;
let adminReadbackStatus = 200;
const reviews = new Map<string, string[]>();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/login" && request.method === "GET") {
    return new Response(`<form method="post">${input("_token", csrf)}${input("email", "")}${input("password", "")}</form>`,
      { headers: { "Set-Cookie": "bookstack_session=synthetic_login; HttpOnly" } });
  }
  if (path === "/login") {
    const form = new URLSearchParams(await request.text());
    assert.equal(form.get("password"), password);
    assert.equal(form.get("_token"), csrf);
    assert.equal(request.headers.get("Cookie"), "bookstack_session=synthetic_login");
    logins += 1;
    return new Response(null, { status: loginStatus, headers: { Location: "/", "Set-Cookie": "bookstack_session=synthetic_auth; HttpOnly" } });
  }
  if (path === "/api/users/7") {
    assert.equal(request.headers.get("Authorization"), `Token ${key}`);
    return Response.json({ id: 7, email: wrongIdentity ? "different@example.test" : "admin@example.test" });
  }
  assert.equal(request.headers.get("Cookie"), "bookstack_session=synthetic_auth");
  if (path === "/settings/users") return new Response("Administrator users", { status: adminReadbackStatus });
  if (path === "/my-account/profile") return new Response(input("email", "admin@example.test"));
  if (path === "/my-account/auth") return new Response('<a href="http://localhost/api-tokens/7/create?context=my-account">Create</a>');
  if (path === "/api-tokens/7/create" && request.method === "GET") {
    return new Response(`<form action="http://localhost/api-tokens/7/create">${input("_token", csrf)}${input("name", "")}${input("expires_at", "")}</form>`);
  }
  if (path === "/api-tokens/7/create") {
    assert.equal(creates, 0);
    const form = new URLSearchParams(await request.text());
    assert.deepEqual([...form], [["_token", csrf], ["name", "selfhost-private-admin"], ["expires_at", "2099-01-01"]]);
    creates += 1;
    return new Response(null,
      { status: 302, headers: { Location: new URL("/api-tokens/7/11/", request.url).href } });
  }
  if (path === "/api-tokens/7/11/") {
    assert.equal(captures, 0);
    captures += 1;
    return new Response(`${input("token_id", "i".repeat(32))}<input type="text" readonly="readonly" value="${"k".repeat(32)}">${input("name", "selfhost-private-admin")}${input("expires_at", "2099-01-01")}`);
  }
  throw new Error("Unexpected synthetic BookStack route");
} });

try {
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(passwordFile, "p".repeat(48), { mode: 0o600 });
  const status = { command: "app status", ownerKind: "shared", appId: "bookstack", projectRoot: root,
    username: "admin@example.test", mutation: false, status: "applied", runtime: { state: "running" },
    projectId, dockerContext: "default", port: server.port, url: `http://127.0.0.1:${server.port}`,
    composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64), privateFiles, passwordFile };
  function invocation(): SetupContext {
    const facilities = createSetupTransportFacilities({ appId: "bookstack", projectRoot: root,
      readStatus: async () => status, readHandoff: async () => { throw new Error("Unexpected handoff"); },
      approve: async (action, approval) => {
        const saved = reviews.get(action) ?? [];
        saved.push(approval);
        reviews.set(action, saved);
        if (action === "bookstack-verify-generated-admin") return allowLogin;
        if (action === "bookstack-create-private-api-token") return allowCreate;
        if (action === "bookstack-capture-private-api-token") return allowCapture;
        throw new Error("Unexpected approval");
      }, approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact: (value) => value });
    return { ...facilities, appId: "bookstack", projectRoot: root, installedAppIds: ["bookstack"], inputs: {},
      status: async () => status, container: { async exec(command) {
        assert.deepEqual(command.argv, ["php", "/app/www/artisan", "bookstack:create-admin", "--initial",
          "--email=admin@example.test", "--name=Administrator", "--generate-password"]);
        assert.equal(command.captureAdminPassword?.format, "whole-stdout");
        assert.equal(firstAdmins, 0);
        firstAdmins += 1;
        await facilities.checkpoint.compareAndSet(command.beforeSendCheckpoint!);
        await writeFile(passwordFile, password, { mode: 0o600 });
        return { exitCode: 0, stdout: "" };
      } } } as SetupContext;
  }
  const deferredTwice = async (action: string) => {
    await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
    const before = await invocation().checkpoint.read();
    await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
    assert.deepEqual(await invocation().checkpoint.read(), before);
    const tokens = reviews.get(action)!;
    assert.equal(tokens.at(-1), tokens.at(-2), "Deferred approval must retain exact session and payload");
  };
  await deferredTwice("bookstack-verify-generated-admin");
  assert.equal(firstAdmins, 1);
  assert.equal(logins, 0);
  await writeFile(passwordFile, "DifferentSyntheticOwnerPassword123456789", { mode: 0o600 });
  await assert.rejects(adapter.firstRun(invocation()), /differs from the private owner credential/);
  await writeFile(passwordFile, password, { mode: 0o600 });
  allowLogin = true;
  await deferredTwice("bookstack-create-private-api-token");
  assert.equal(logins, 1);
  assert.equal(creates, 0);
  allowCreate = true;
  await deferredTwice("bookstack-capture-private-api-token");
  assert.equal(creates, 1);
  assert.equal(captures, 0);
  assert.equal(logins, 1);
  allowCapture = true;
  wrongIdentity = true;
  await assert.rejects(adapter.firstRun(invocation()), /differs from the saved administrator/);
  assert.equal(captures, 1);
  assert.equal(await invocation().secrets.readApiKey(), key);
  assert.equal((await lstat(join(privateFiles, "bookstack-api-key"))).mode & 0o777, 0o600);
  assert.equal((await invocation().checkpoint.read())?.stage, "token-secret-attempted");
  await unlink(join(privateFiles, "bookstack-api-key"));
  await assert.rejects(adapter.firstRun(invocation()), /output is missing or creation is uncertain/);
  assert.equal(creates, 1);
  assert.equal(captures, 1);
  // Restore only the known synthetic fixture value to exercise safe saved-key resume.
  await invocation().secrets.writeApiKey(key);
  wrongIdentity = false;
  const verified = await adapter.firstRun(invocation());
  assert.equal(adapter.ready(verified), true);
  assert.equal(verified.apiKeyScope, "inherits-saved-administrator-permissions");
  assert.equal(adapter.ready(await adapter.firstRun(invocation())), true);
  assert.equal(creates, 1);
  assert.equal(captures, 1);
  assert.equal(firstAdmins, 1);
  // A once-read secret lost before capture must not consume another flash or create another key.
  await unlink(join(privateFiles, "bookstack-api-key"));
  await assert.rejects(adapter.firstRun(invocation()), /output is missing or creation is uncertain/);
  assert.equal(creates, 1);
  assert.equal(captures, 1);
  await invocation().secrets.writeApiKey(key);
  loginStatus = 419;
  await assert.rejects(adapter.firstRun(invocation()), /expired/);
  assert.deepEqual(Object.keys(await invocation().secrets.readSessionCookies()), []);
  loginStatus = 302;
  adminReadbackStatus = 302;
  await assert.rejects(adapter.firstRun(invocation()), /rejected its captured/);
  assert.deepEqual(Object.keys(await invocation().secrets.readSessionCookies()), []);
  adminReadbackStatus = 200;
  assert.equal(adapter.ready(await adapter.firstRun(invocation())), true);
  assert.equal(firstAdmins, 1);
  assert.equal(creates, 1);
  assert.equal(captures, 1);
  console.log("BookStack private API token deferred approval, owner readback and no-replay checks passed");
} finally {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
