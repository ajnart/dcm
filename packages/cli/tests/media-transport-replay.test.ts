import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tdarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/tdarr/setup.ts";
import deluge from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/deluge/setup.ts";
import jellyfin from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/setup.ts";
import type { SetupAdapter, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../src/control-panel/setup-transport.ts";

// Synthetic loopback APIs, actual HTTP transport/approval hashes/0600 files.
// Every invocation creates fresh facilities. No Docker or upstream app runs.
async function check(adapter: SetupAdapter, targetAction: string) {
  const appId = adapter.appId;
  const root = await mkdtemp(join(tmpdir(), `media-transport-${appId}-`));
  const projectId = "media_fixture";
  const projectDirectory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(projectDirectory, "secrets", appId);
  const passwordFile = join(privateFiles, "admin-password");
  const password = "p".repeat(48);
  const ownerId = "a".repeat(32);
  const persistentKey = "fixture-persistent-key-123456789";
  let initialized = false;
  let owner = false;
  let complete = false;
  let key: string | null = null;
  let keyLabel = "";
  let activeSession = "";
  const tdarrSessions = new Set<string>();
  const jellyfinSessions = new Set<string>();
  let logins = 0;
  let mutations = 0;
  let ownerStatus = 200;
  let loseWrite = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const session = request.headers.get("authorization")?.replace(/^Bearer /, "")
      ?? request.headers.get("cookie");
    const ownerResponse = { Id: ownerId, Name: "admin", Policy: { IsAdministrator: true } };
    if (appId === "tdarr") {
      if (path.endsWith("/login")) {
        assert.deepEqual(await request.json(), { username: "admin", password });
        if (!owner) return new Response(null, { status: 401 });
        activeSession = `fixtureBearer${++logins}`;
        tdarrSessions.add(activeSession);
        return Response.json({ token: activeSession });
      }
      if (path.endsWith("/register")) {
        assert.equal(owner, false);
        assert.deepEqual(await request.json(), { username: "admin", password });
        owner = true;
        return Response.json({}, { status: 201 });
      }
      if (path.endsWith("/verify-token")) {
        if (!request.headers.get("authorization")) return Response.json({ setupAdmin: !owner }, { status: 401 });
        assert.ok(typeof session === "string" && tdarrSessions.has(session));
        return Response.json({ roles: ["admin"] }, { status: ownerStatus });
      }
      assert.equal(path, "/api/v2/cruddb");
      const payload = await request.json() as { data: { mode: string; docID: string; obj: { date: number } } };
      assert.ok((typeof session === "string" && tdarrSessions.has(session)) || request.headers.get("x-api-key") === key);
      if (payload.data.mode === "insert") {
        assert.equal(ownerStatus, 200);
        assert.equal(key, null);
        assert.ok(Number.isSafeInteger(payload.data.obj.date));
        mutations++;
        key = payload.data.docID;
        return Response.json({}, { status: loseWrite ? 500 : 200 });
      }
      assert.equal(payload.data.mode, "getAll");
      return Response.json(key === null ? [] : [{ _id: key }]);
    }
    if (appId === "deluge") {
      assert.equal(path, "/json");
      const rpc = await request.json() as { method: string; params: string[]; id: number };
      let result: boolean;
      let cookie: string | null = null;
      if (rpc.method === "auth.login") {
        result = rpc.params[0] === (owner ? password : "deluge");
        if (result) {
          activeSession = `_session_id=fixtureSession${++logins}`;
          cookie = activeSession;
        }
      } else if (rpc.method === "auth.check_session") {
        assert.equal(session, activeSession);
        if (ownerStatus === 503) return new Response(null, { status: 503 });
        result = ownerStatus !== 401;
      } else {
        assert.equal(rpc.method, "auth.change_password");
        assert.equal(session, activeSession);
        assert.deepEqual(rpc.params, ["deluge", password]);
        assert.equal(ownerStatus, 200);
        assert.equal(owner, false);
        owner = true;
        mutations++;
        result = true;
        if (loseWrite) return new Response(null, { status: 500 });
      }
      const headers: Record<string, string> = {};
      if (cookie) headers["set-cookie"] = `${cookie}; Path=/json; HttpOnly`;
      return Response.json({ id: rpc.id, error: null, result }, { headers });
    }
    assert.equal(appId, "jellyfin");
    const jellyfinOwner = { ...ownerResponse, Policy: { IsAdministrator: true, IsDisabled: false } };
    if (path === "/System/Info/Public") return Response.json({ Id: "fixture-server",
      Version: "12.1.20260915", StartupWizardCompleted: complete });
    if (path === "/Users/Public" || path === "/Users") {
      if (!initialized) return Response.json([]);
      let name = "Jellyfin";
      if (owner) name = "admin";
      return Response.json([{ ...jellyfinOwner, Name: name, HasPassword: owner }]);
    }
    if (path === "/Startup/User" && request.method === "GET") {
      initialized = true;
      return Response.json({ Name: "Jellyfin" });
    }
    if (path === "/Startup/User") {
      assert.equal(initialized, true);
      assert.deepEqual(await request.json(), { Name: "admin", Password: password });
      owner = true;
      return new Response(null, { status: 204 });
    }
    if (path === "/Users/AuthenticateByName") {
      assert.equal(owner, true);
      assert.deepEqual(await request.json(), { Username: "admin", Pw: password });
      activeSession = `fixture-session-token-${++logins}`;
      jellyfinSessions.add(activeSession);
      return Response.json({ AccessToken: activeSession, User: jellyfinOwner });
    }
    const auth = request.headers.get("authorization") ?? "";
    const jellyfinToken = auth.match(/Token="([^"]+)"/)?.[1] ?? "";
    if (path === "/Users/Me") {
      assert.ok(jellyfinSessions.has(jellyfinToken));
      return Response.json(jellyfinOwner, { status: ownerStatus });
    }
    if (path === "/Startup/Complete") {
      complete = true;
      return new Response(null, { status: 204 });
    }
    if (path === "/Auth/Keys") {
      assert.ok(jellyfinSessions.has(jellyfinToken) || jellyfinToken === persistentKey);
      if (request.method === "POST") {
        assert.equal(ownerStatus, 200);
        assert.equal(key, null);
        keyLabel = url.searchParams.get("app")!;
        key = persistentKey;
        mutations++;
        return new Response(null, { status: loseWrite ? 500 : 204 });
      }
      const items = key === null ? [] : [{ AppName: keyLabel, AccessToken: key, IsActive: true }];
      return Response.json({ Items: items, TotalRecordCount: items.length });
    }
    assert.equal(path, "/System/Info");
    assert.ok(auth.includes(`Token="${persistentKey}"`));
    return Response.json({ Id: "fixture-server", Version: "12.1.20260915" });
  } });
  try {
    await mkdir(privateFiles, { recursive: true, mode: 0o700 });
    await writeFile(passwordFile, password, { mode: 0o600 });
    const status = { command: "app status", appId, projectRoot: root, ownerKind: "shared",
      mutation: false, status: "applied", runtime: { state: "running" },
      username: appId === "deluge" ? null : "admin", port: server.port,
      url: `http://127.0.0.1:${server.port}`, projectId, dockerContext: "default",
      composeTarget: join(projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
      applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
      manifestHash: "b".repeat(64), privateFiles, passwordFile };
    const approved = new Set<string>();
    const reviewed: { action: string; token: string }[] = [];
    function invocation() {
      const facilities = createSetupTransportFacilities({ appId, projectRoot: root,
        async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
        async approve(action, token) { reviewed.push({ action, token }); return approved.has(token); },
        approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
      const context = { ...facilities, appId, projectRoot: root, inputs: {}, installedAppIds: [appId],
        async status() { return status; } } as unknown as SetupContext;
      return { facilities, context };
    }
    async function until(target: string | null) {
      for (let index = 0; index < 30; index++) {
        try {
          const record = await adapter.firstRun(invocation().context);
          assert.equal(target, null, "Expected a deferred mutation, not readiness");
          assert.equal(adapter.ready(record), true);
          return null;
        } catch (error) {
          if (!(error instanceof SetupTransportDeferred)) throw error;
          const step = reviewed.at(-1)!;
          if (step.action === target) return step.token;
          approved.add(step.token);
        }
      }
      throw new Error("Synthetic setup exceeded its bounded approval sequence");
    }
    const firstApproval = await until(targetAction);
    assert.ok(firstApproval);
    assert.equal(await until(targetAction), firstApproval);
    if (appId === "jellyfin") assert.ok(logins > 1, "Jellyfin resumes reverify the password");
    else if (appId === "tdarr") assert.ok(logins > 1, "Tdarr resumes reverify the password");
    else assert.equal(logins, 1);
    const verifiedLogins = logins;
    assert.equal(mutations, 0);
    const cache = await invocation().facilities.secrets.readSessionCookies();
    assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
    ownerStatus = 503;
    await assert.rejects(adapter.firstRun(invocation().context));
    assert.deepEqual(await invocation().facilities.secrets.readSessionCookies(), cache);
    assert.equal(logins, verifiedLogins);
    assert.equal(mutations, 0);
    ownerStatus = 401;
    await assert.rejects(adapter.firstRun(invocation().context), /session expired/);
    const expired = await invocation().facilities.secrets.readSessionCookies();
    assert.equal(expired.bearer, undefined);
    assert.equal(expired.seed_cookie, undefined);
    assert.equal(mutations, 0);
    // A new CLI invocation does not carry prior login consent automatically.
    for (const step of reviewed) if (step.action !== targetAction) approved.delete(step.token);
    ownerStatus = 200;
    const newApproval = await until(targetAction);
    assert.ok(newApproval);
    // HTTP v2 binds authorization headers as well as path/body/checkpoint.
    // A renewed verified session therefore requires a new exact write approval.
    assert.notEqual(newApproval, firstApproval, "Session renewal requires a new authorization-bound approval");
    if (appId === "jellyfin") assert.ok(logins > verifiedLogins);
    else if (appId === "tdarr") assert.ok(logins > verifiedLogins);
    else assert.equal(logins, 2);
    assert.equal(mutations, 0);
    approved.add(newApproval);
    loseWrite = true;
    await assert.rejects(until(null), /failed|unexpected status|uncertain/);
    assert.equal(mutations, 1);
    loseWrite = false;
    await until(null);
    await until(null);
    assert.equal(mutations, 1, "A lost write response reconciles instead of repeating the mutation");
  } finally {
    server.stop(true);
    await rm(root, { recursive: true });
  }
}

await check(tdarr, "tdarr-insert-owned-api-key");
await check(deluge, "deluge-rotate-web-password");
await check(jellyfin, "jellyfin-create-api-key");
console.log("Media real transport approval replay: Tdarr, Deluge and Jellyfin passed (synthetic APIs only)");
