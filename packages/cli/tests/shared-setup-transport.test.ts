import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";
import homarrAdapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/homarr/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-shared-transport-"));
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  const appId = "sonarr";
  const projectId = "media_one";
  const projectDirectory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(projectDirectory, "secrets", appId);
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  const passwordFile = join(privateFiles, "admin-password");
  await writeFile(passwordFile, "saved-secret\n", { mode: 0o600 });
  const status = {
    command: "app status", ownerKind: "shared", appId, projectRoot: root,
    mutation: false, status: "applied", runtime: { state: "running" },
    projectId, dockerContext: "default", port: 18989,
    url: "http://127.0.0.1:18989",
    composeTarget: join(projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`,
    ownerRevision: 4, manifestHash: "b".repeat(64),
    privateFiles, passwordFile,
  };
  let current: Record<string, unknown> = status;
  let mutableChecks = 0;
  let changeOwnerDuringCheck = false;
  const facilities = createSetupTransportFacilities({
    appId, projectRoot: root,
    async readStatus() { return current; },
    async readHandoff() { throw new Error("The shared status already has its password reference"); },
    async verifyMutableConfigs() {
      mutableChecks++;
      if (changeOwnerDuringCheck) current = { ...status, ownerRevision: 5 };
    },
    async approve() { throw new Error("No HTTP setup approval should be requested"); },
    approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; },
  });
  await facilities.secrets.verifyMutableConfigs();
  assert.equal(mutableChecks, 1);
  changeOwnerDuringCheck = true;
  await assert.rejects(facilities.secrets.verifyMutableConfigs(), /identity changed/);
  changeOwnerDuringCheck = false;
  current = status;
  assert.equal(await facilities.secrets.readAdminPassword(), "saved-secret");
  assert.deepEqual(await facilities.secrets.readSessionCookies(), {});
  await facilities.secrets.writeSessionCookies({ claim: "synthetic-claim-cookie" });
  assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
  assert.equal((await facilities.secrets.readSessionCookies()).claim, "synthetic-claim-cookie");
  await facilities.secrets.writeSessionCookies({ claim: "replacement-synthetic-cookie", csrf: "synthetic-csrf" });
  assert.equal((await facilities.secrets.readSessionCookies()).claim, "replacement-synthetic-cookie");
  await assert.rejects(facilities.secrets.writeSessionCookies({ bad: "unsafe;cookie" }), /invalid name or value/);
  current = { ...status, ownerRevision: 5 };
  assert.equal((await facilities.secrets.readSessionCookies()).claim, "replacement-synthetic-cookie");
  current = { ...status, port: 18990, url: "http://127.0.0.1:18990" };
  await assert.rejects(facilities.secrets.readSessionCookies(), /different app owner or origin/);
  current = status;
  const apiKey = "c".repeat(32);
  assert.equal(await facilities.secrets.writeApiKey(apiKey), join(privateFiles, "sonarr-api-key"));
  assert.equal(await facilities.secrets.readApiKey(), apiKey);
  assert.equal(await readFile(join(privateFiles, "sonarr-api-key"), "utf8"), apiKey);
  const checkpoint = await facilities.checkpoint.compareAndSet({ expectedRevision: null,
    stage: "api-key-saved", data: { apiKeyFile: join(privateFiles, "sonarr-api-key") } });
  assert.equal(checkpoint.revision, 1);
  assert.equal((await facilities.checkpoint.read())?.stage, "api-key-saved");

  const uptimeFiles = join(projectDirectory, "secrets", "uptime-kuma");
  await mkdir(uptimeFiles, { mode: 0o700 });
  const uptimePassword = join(uptimeFiles, "admin-password");
  await writeFile(uptimePassword, "synthetic-uptime-password", { mode: 0o600 });
  const tokens: string[] = [];
  const uptime = createSetupTransportFacilities({
    appId: "uptime-kuma", projectRoot: root,
    async readStatus() { return { ...status, appId: "uptime-kuma", privateFiles: uptimeFiles,
      passwordFile: uptimePassword }; },
    async readHandoff() { throw new Error("Unexpected credential handoff"); },
    async approve(_action, token) { tokens.push(token); return false; },
    approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; },
  });
  await assert.rejects(uptime.secrets.verifyMutableConfigs(), /exact shared owner validator/);
  async function reviewSocket(sid: string, id: number, event: unknown[], path = "/socket.io/", action = "uptime-kuma-login",
    headers = { "Content-Type": "text/plain;charset=UTF-8" } as Record<string, string>,
    extraQuery = {} as Record<string, string>) {
    await assert.rejects(uptime.http.request({ method: "POST", path,
      query: { EIO: "4", transport: "polling", sid, ...extraQuery },
      headers,
      body: `42${id}${JSON.stringify(event)}`,
      approval: { action, progress: "Verify saved login or reviewed monitor" },
    }), /approval was declined/);
    return tokens.at(-1)!;
  }
  const loginEvent = ["login", { username: "admin", password: "synthetic-uptime-password" }];
  const firstReview = await reviewSocket("session_one", 1, loginEvent);
  assert.equal(await reviewSocket("session_two", 9, loginEvent), firstReview);
  assert.notEqual(await reviewSocket("session_two", 9,
    ["login", { username: "admin", password: "different-synthetic-password" }]), firstReview);
  assert.notEqual(await reviewSocket("session_two", 9, ["setup", "admin", "synthetic-password"]), firstReview);
  const unrelated = await reviewSocket("session_one", 1, loginEvent, "/other/");
  assert.notEqual(await reviewSocket("session_two", 9, loginEvent, "/other/"), unrelated);
  for (const [event, action] of [["getMonitor", "uptime-kuma-get-monitor"],
    ["getMonitorBeats", "uptime-kuma-get-monitor-beats"]]) {
    const args: unknown[] = [event, 12];
    if (event === "getMonitorBeats") args.push(24);
    const monitorReview = await reviewSocket("session_one", 1, args, "/socket.io/", action);
    assert.equal(await reviewSocket("session_two", 9, args, "/socket.io/", action), monitorReview);
    assert.notEqual(await reviewSocket("session_two", 9, [event, 13, ...args.slice(2)], "/socket.io/", action), monitorReview);
    assert.notEqual(await reviewSocket("session_two", 9, args, "/socket.io/"), monitorReview);
  }
  for (const [event, action, args] of [
    ["getAPIKeyList", "uptime-kuma-get-api-key-list", []],
    ["addAPIKey", "uptime-kuma-add-api-key", [{ name: "self-host metrics", active: true, expires: null }]],
  ] as const) {
    const frame = [event, ...args];
    const review = await reviewSocket("session_one", 1, frame, "/socket.io/", action);
    assert.equal(await reviewSocket("session_two", 9, frame, "/socket.io/", action), review);
    assert.notEqual(await reviewSocket("session_two", 9, [event, { name: "different" }], "/socket.io/", action), review);
    assert.notEqual(await reviewSocket("session_two", 9, frame, "/socket.io/", "wrong-action"), review);
    const auth = { "Content-Type": "text/plain;charset=UTF-8", Authorization: "Bearer synthetic-one" };
    const authenticated = await reviewSocket("session_one", 1, frame, "/socket.io/", action, auth);
    assert.equal(await reviewSocket("session_two", 9, frame, "/socket.io/", action,
      { authorization: auth.Authorization, "content-type": auth["Content-Type"] }), authenticated);
    assert.notEqual(await reviewSocket("session_two", 9, frame, "/socket.io/", action,
      { ...auth, Authorization: "Bearer synthetic-two" }), authenticated);
    assert.notEqual(await reviewSocket("session_two", 9, frame, "/socket.io/", action,
      { ...auth, Cookie: "session=synthetic" }), authenticated);
    for (const query of [{ extra: "value" }, { EIO: "3" }, { transport: "websocket" }]) {
      const ordinary = await reviewSocket("session_one", 1, frame, "/socket.io/", action, auth, query);
      assert.notEqual(await reviewSocket("session_two", 9, frame, "/socket.io/", action, auth, query), ordinary);
    }
  }
  for (const args of [["getMonitor", 0], ["getMonitor", 1, 2], ["getMonitorBeats", 1, 12],
    ["getMonitorBeats", 1, 24, 2]]) {
    let action = "uptime-kuma-get-monitor";
    if (args[0] === "getMonitorBeats") action += "-beats";
    const ordinary = await reviewSocket("session_one", 1, args, "/socket.io/", action);
    assert.notEqual(await reviewSocket("session_two", 9, args, "/socket.io/", action), ordinary);
  }

  async function reviewHeaders(headers: Record<string, string>) {
    await assert.rejects(uptime.http.request({ method: "POST", path: "/api/fixture",
      headers, body: "{}",
      approval: { action: "fixture-write", progress: "Review synthetic authenticated intent" },
    }), /approval was declined/);
    return tokens.at(-1)!;
  }
  const authenticated = await reviewHeaders({ Authorization: "Bearer synthetic-one", Cookie: "session=one" });
  assert.equal(await reviewHeaders({ cookie: "session=one", authorization: "Bearer synthetic-one" }), authenticated);
  assert.notEqual(await reviewHeaders({ Authorization: "Bearer synthetic-two", Cookie: "session=one" }), authenticated);
  assert.notEqual(await reviewHeaders({ Authorization: "Bearer synthetic-one", Cookie: "session=two" }), authenticated);

  const homarrFiles = join(projectDirectory, "secrets", "homarr");
  await mkdir(homarrFiles, { mode: 0o700 });
  const homarrPassword = join(homarrFiles, "admin-password");
  await writeFile(homarrPassword, "synthetic-homarr-password", { mode: 0o600 });
  const homarr = createSetupTransportFacilities({
    appId: "homarr", projectRoot: root,
    async readStatus() { return { ...status, appId: "homarr", privateFiles: homarrFiles,
      passwordFile: homarrPassword }; },
    async readHandoff() { throw new Error("Unexpected credential handoff"); },
    async approve(_action, token) { tokens.push(token); return false; },
    approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; },
  });
  async function reviewHomarr(form: URLSearchParams, rejection = /approval was declined/, cookie?: string) {
    await assert.rejects(homarr.http.request({ method: "POST", path: "/api/auth/callback/credentials",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body: form.toString(),
      approval: { action: "homarr-verify-admin", progress: "Verify saved Homarr login" },
    }), rejection);
    return tokens.at(-1)!;
  }
  const loginForm = new URLSearchParams({ name: "admin", password: "synthetic-homarr-password",
    csrfToken: "a".repeat(64), callbackUrl: status.url });
  const homarrReview = await reviewHomarr(loginForm);
  loginForm.set("csrfToken", "b".repeat(64));
  assert.equal(await reviewHomarr(loginForm), homarrReview);
  assert.equal(await reviewHomarr(loginForm, /approval was declined/, "csrf=transient-value"), homarrReview);
  loginForm.set("password", "different-synthetic-password");
  assert.notEqual(await reviewHomarr(loginForm), homarrReview);
  loginForm.set("password", "synthetic-homarr-password");
  loginForm.set("callbackUrl", "http://127.0.0.1:18000");
  assert.notEqual(await reviewHomarr(loginForm), homarrReview);
  loginForm.append("name", "admin");
  await reviewHomarr(loginForm, /invalid or duplicate fields/);
  loginForm.delete("name");
  loginForm.set("name", "admin");
  loginForm.set("csrfToken", "bad");
  await reviewHomarr(loginForm, /invalid or duplicate fields/);

  // A valid cached administrator must never substitute for saved-password proof.
  let proofMode = "declined";
  let challenge = 0;
  let freshSessionUser = { id: "owner", name: "admin", permissions: ["admin"] };
  let savedCookies: Record<string, string> = { auth: "cached-admin", claim: "retained-claim" };
  const retainedCookies = { ...savedCookies };
  let cookieWrites = 0;
  const proofRequests: string[] = [];
  const homarrContext = {
    appId: "homarr", projectRoot: root,
    async status() { return { ...status, appId: "homarr" }; },
    checkpoint: {
      async read() { return { schemaVersion: 1, appId: "homarr", projectRoot: root,
        revision: 1, stage: "verified", attemptedActions: ["homarr-create-admin", "homarr-create-key"], data: {} }; },
      async compareAndSet() { throw new Error("Verified resume must not recreate its checkpoint"); },
    },
    secrets: {
      async readAdminPassword() { return "synthetic-homarr-password"; },
      async readSessionCookies() { return { ...savedCookies }; },
      async writeSessionCookies(value: Record<string, string>) { cookieWrites++; savedCookies = { ...value }; },
      async readApiKey() { return "synthetic.owner-key"; },
      async apiKeyPath() { return join(homarrFiles, "homarr-api-key"); },
      async writeApiKey() { throw new Error("Resume must not recreate its API key"); },
    },
    http: { async request(input) {
      const cookie = input.headers?.Cookie ?? "";
      proofRequests.push(input.path);
      function response(value: unknown, cookies: string[] = []) {
        return { status: 200, ok: true, headers: { get() { return null; }, getSetCookie() { return cookies; } },
          async json() { return value; } };
      }
      if (input.path === "/api/auth/csrf") {
        assert.equal(cookie, "", "Password proof starts without cached authorization");
        challenge++;
        return response({ csrfToken: `fresh-challenge-${challenge}` }, [`csrf=fresh-${challenge}; Path=/`]);
      }
      if (input.path === "/api/auth/callback/credentials") {
        assert.equal(cookie, `csrf=fresh-${challenge}`);
        assert.equal(new URLSearchParams(String(input.body)).get("password"), "synthetic-homarr-password");
        if (proofMode === "declined") return homarr.http.request(input);
        if (proofMode === "rejected") return response({ url: `${status.url}/auth/login?error=CredentialsSignin&code=credentials` });
        return response({ url: status.url }, [`auth=fresh-${challenge}; Path=/`]);
      }
      if (input.path === "/api/auth/session") {
        if (cookie.includes("auth=cached-admin")) {
          return response({ user: { id: "owner", name: "admin", permissions: ["admin"] } }, ["auth=rolling-cached; Path=/"]);
        }
        assert.ok(cookie.includes(`auth=fresh-${challenge}`));
        return response({ user: freshSessionUser });
      }
      if (input.path === "/api/trpc/apiKeys.getAll") {
        assert.equal(cookie, "", "API-key readback remains isolated");
        return response({ result: { data: { json: [] } } });
      }
      assert.ok(cookie.includes("auth=cached-admin"), "Later reads retain stable original authorization");
      if (input.path === "/api/trpc/onboard.currentStep") return response({ result: { data: { json: { current: "finish" } } } });
      if (input.path === "/api/trpc/board.getAllBoards") return response({ result: { data: { json: [{ id: "board", name: "personal", isPublic: false }] } } });
      if (input.path === "/api/trpc/board.getBoardByName") return response({ result: { data: { json: { id: "board", name: "personal", isPublic: false, items: [], sections: [] } } } });
      throw new Error(`Unexpected Homarr setup mutation: ${input.path}`);
    } },
  } as SetupContext;
  await assert.rejects(homarrAdapter.firstRun(homarrContext), /approval was declined/);
  const passwordReview = tokens.at(-1)!;
  await assert.rejects(homarrAdapter.firstRun(homarrContext), /approval was declined/);
  assert.equal(tokens.at(-1), passwordReview, "Fresh CSRF exchanges preserve exact login approval identity");
  assert.equal(cookieWrites, 0);
  proofMode = "rejected";
  await assert.rejects(homarrAdapter.firstRun(homarrContext), /administrator login was not verified/);
  assert.deepEqual(savedCookies, retainedCookies);
  assert.equal(cookieWrites, 0);
  proofMode = "accepted";
  freshSessionUser = { id: "other", name: "other", permissions: ["admin"] };
  await assert.rejects(homarrAdapter.firstRun(homarrContext), /administrator session was not verified/);
  assert.deepEqual(savedCookies, retainedCookies);
  freshSessionUser = { id: "owner", name: "admin", permissions: ["admin"] };
  assert.equal((await homarrAdapter.firstRun(homarrContext)).stage, "admin-and-api-key-verified");
  assert.deepEqual(savedCookies, retainedCookies);
  assert.equal(cookieWrites, 0, "Successful proof preserves stable retained authorization too");
  assert.ok(!proofRequests.includes("/api/trpc/apiKeys.create") && !proofRequests.includes("/api/trpc/user.initUser"));

  const seerrFiles = join(projectDirectory, "secrets", "seerr");
  await mkdir(seerrFiles, { mode: 0o700 });
  const seerrFacilities = createSetupTransportFacilities({
    appId: "seerr", projectRoot: root,
    async readStatus() { return { ...status, appId: "seerr", port: 15055,
      url: "http://127.0.0.1:15055", privateFiles: seerrFiles,
      loginVia: "jellyfin", passwordFile: null }; },
    async readHandoff() { throw new Error("Seerr has no local password to hand off"); },
    async approve() { throw new Error("No HTTP setup approval should be requested"); },
    approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; },
  });
  const seerrKey = Buffer.from("fixture-seerr-api-key-12345678901234567890").toString("base64");
  assert.deepEqual(await seerrFacilities.secrets.readSessionCookies(), {});
  assert.equal(await seerrFacilities.secrets.writeApiKey(seerrKey), join(seerrFiles, "seerr-api-key"));
  assert.equal(await seerrFacilities.secrets.readApiKey(), seerrKey);
  await assert.rejects(seerrFacilities.secrets.readAdminPassword(), /No trusted saved admin-password file/);

  current = { ...status, ownerRevision: 0 };
  await assert.rejects(facilities.secrets.readAdminPassword(), /revision or manifest hash/);
  current = { ...status, privateFiles: join(projectDirectory, "secrets") };
  await assert.rejects(facilities.secrets.readAdminPassword(), /private-file reference/);
  current = { ...status, composeTarget: join(root, ".selfhost", "apps", projectId,
    "compose.aaaaaaaaaaaaaaaa.yaml") };
  await assert.rejects(facilities.secrets.readAdminPassword(), /origin or apply identity/);

  let requests = 0;
  const wire: { target: string; body: string }[] = [];
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests++;
    if (new URL(request.url).pathname === "/socket.io/") {
      const url = new URL(request.url);
      wire.push({ target: `${url.pathname}${url.search}`, body: await request.text() });
      return new Response("ok");
    }
    assert.equal(new URL(request.url).pathname, "/_auto-stack/stats;csv");
    return new Response("# pxname,svname\nfixture,FRONTEND\n");
  } });
  current = { ...status, port: server.port, url: `http://127.0.0.1:${server.port}` };
  const csv = await facilities.http.request({ method: "GET", path: "/_auto-stack/stats;csv" });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /fixture,FRONTEND/);
  for (const path of ["/../stats;csv", "/..;csv/stats", "/.;csv/stats", "/stats%3Bcsv", "/stats;csv?x=1", "/stats;csv#x"]) {
    await assert.rejects(facilities.http.request({ method: "GET", path }), /fixed path/);
  }
  assert.equal(requests, 1, "Literal matrix suffixes reach the owned origin; traversal and encoded paths do not");
  const sending = createSetupTransportFacilities({
    appId: "uptime-kuma", projectRoot: root,
    async readStatus() { return { ...current, appId: "uptime-kuma", privateFiles: uptimeFiles,
      passwordFile: uptimePassword }; },
    async readHandoff() { throw new Error("Unexpected credential handoff"); },
    async approve() { return true; }, approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; },
  });
  const wireFrame = '429["addAPIKey",{"name":"self-host metrics","active":true,"expires":null}]';
  await sending.http.request({ method: "POST", path: "/socket.io/",
    query: { EIO: "4", transport: "polling", sid: "original_session" },
    headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: wireFrame,
    approval: { action: "uptime-kuma-add-api-key", progress: "Create synthetic metrics key" },
  });
  assert.deepEqual(wire, [{ target: "/socket.io/?EIO=4&sid=original_session&transport=polling", body: wireFrame }]);
} finally {
  server?.stop(true);
  await rm(root, { recursive: true });
}

console.log("shared setup transport: pass");
