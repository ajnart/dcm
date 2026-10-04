import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import qbittorrent from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/qbittorrent/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../src/control-panel/setup-transport.ts";

// Synthetic loopback server, real owner-only transport files and approval hashes.
// Bootstrap log reading is replaced; no Docker or torrent/indexer request occurs.
const root = await mkdtemp(join(tmpdir(), "selfhost-qbittorrent-session-"));
const appId = "qbittorrent";
const projectId = "qbittorrent_fixture";
const projectDirectory = join(root, ".selfhost", "shared", projectId);
const privateFiles = join(projectDirectory, "secrets", appId);
const passwordFile = join(privateFiles, "admin-password");
const password = "p".repeat(48);
const temporaryPassword = "syntheticTemporaryPassword";
const apiKey = "qbt_1234567890123456789012345678";
let managed = false;
let logins = 0;
let bootstrapReads = 0;
let rotations = 0;
let keyCreations = 0;
let categoryCreations = 0;
let sessionStatus = 200;
let wrongOwner = false;
let wrongVersion = false;
let loseRotation = false;
let loseKey = false;
let currentKey = "";
let failKeyReadback = false;
let activeCookie = "";
let inventory: Record<string, unknown> = {};
const rotationCookies: string[] = [];
const keyCookies: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/v2/auth/login") {
      const form = new URLSearchParams(await request.text());
      assert.equal(form.get("username"), "admin");
      const expectedPassword = managed ? password : temporaryPassword;
      if (form.get("password") !== expectedPassword) return new Response(null, { status: 401 });
      activeCookie = `QBT_SID_8080=synthetic-session-${++logins}`;
      return new Response(null, { status: 204, headers: { "set-cookie": `${activeCookie}; Path=/; HttpOnly` } });
    }
    const cookie = request.headers.get("cookie");
    const bearer = request.headers.get("authorization");
    if (cookie === activeCookie && sessionStatus !== 200) return new Response(null, { status: sessionStatus });
    if (cookie !== activeCookie && bearer !== `Bearer ${apiKey}`) return new Response(null, { status: 403 });
    if (path === "/api/v2/app/version") return new Response(wrongVersion ? "5.2.4" : "5.2.3");
    if (path === "/api/v2/app/preferences") {
      if (failKeyReadback && currentKey !== "") return new Response(null, { status: 503 });
      return Response.json({ web_ui_username: wrongOwner ? "other" : "admin",
      save_path: managed ? "/data/torrents" : "/downloads", temp_path: "/data/torrents/incomplete",
      temp_path_enabled: managed, web_ui_api_key: currentKey });
    }
    if (path === "/api/v2/app/setPreferences") {
      assert.equal(request.method, "POST");
      const json = JSON.parse(new URLSearchParams(await request.text()).get("json")!);
      assert.deepEqual(json, { web_ui_username: "admin", web_ui_password: password,
        save_path: "/data/torrents", temp_path: "/data/torrents/incomplete", temp_path_enabled: true });
      rotations++;
      rotationCookies.push(cookie!);
      managed = true;
      if (loseRotation) return new Response(null, { status: 500 });
      return new Response(null, { status: 204 });
    }
    if (path === "/api/v2/app/rotateAPIKey") {
      assert.equal(request.method, "POST");
      keyCreations++;
      keyCookies.push(cookie!);
      if (loseKey) return new Response(null, { status: 500 });
      currentKey = apiKey;
      return Response.json({ apiKey });
    }
    if (path === "/api/v2/torrents/categories") return Response.json(inventory);
    if (path === "/api/v2/torrents/createCategory") {
      assert.equal(request.method, "POST");
      const form = new URLSearchParams(await request.text());
      assert.deepEqual(Object.fromEntries(form), { category: "tv-sonarr", savePath: "/data/torrents/tv-sonarr" });
      categoryCreations++;
      inventory["tv-sonarr"] = { name: "tv-sonarr", savePath: "/data/torrents/tv-sonarr" };
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected synthetic qBittorrent route: ${request.method} ${path}`);
  },
});

try {
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(passwordFile, password, { mode: 0o600 });
  const approvals = new Set<string>();
  const reviewed: { action: string; token: string }[] = [];
  const status = { command: "app status", ownerKind: "shared", appId, projectRoot: root,
    mutation: false, status: "applied", runtime: { state: "running" }, username: "admin",
    projectId, dockerContext: "default", port: server.port, url: `http://127.0.0.1:${server.port}`,
    composeTarget: join(projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64), privateFiles, passwordFile };
  const facilities = createSetupTransportFacilities({ appId, projectRoot: root,
    async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
    async approve(action, token) { reviewed.push({ action, token }); return approvals.has(token); },
    approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
  const context = { ...facilities, appId, projectRoot: root, inputs: {}, installedAppIds: [appId, "sonarr"],
    secrets: { ...facilities.secrets, async readQbittorrentTemporaryPassword() { bootstrapReads++; return temporaryPassword; } },
    async status() { return status; } } as unknown as SetupContext;
  async function defer(action: string) {
    await assert.rejects(qbittorrent.firstRun(context), SetupTransportDeferred);
    assert.equal(reviewed.at(-1)?.action, action);
    return reviewed.at(-1)!.token;
  }
  approvals.add(await defer("qbittorrent-verify-managed-login"));
  approvals.add(await defer("qbittorrent-verify-temporary-login"));
  const rotationApproval = await defer("qbittorrent-set-managed-auth");
  assert.equal(logins, 1);
  assert.equal(rotations, 0);
  assert.equal((await facilities.secrets.readSessionCookies()).mode, "temporary");
  assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
  assert.equal(await defer("qbittorrent-set-managed-auth"), rotationApproval);
  assert.equal(logins, 1);
  const readsAtReview = bootstrapReads;
  assert.equal(await defer("qbittorrent-set-managed-auth"), rotationApproval);
  assert.equal(bootstrapReads, readsAtReview, "Cached temporary session must not reread bootstrap logs");
  approvals.add(rotationApproval);
  approvals.add(await defer("qbittorrent-verify-new-login"));
  assert.equal(rotations, 1);
  const keyApproval = await defer("qbittorrent-create-api-key");
  assert.equal(logins, 2);
  assert.equal(await defer("qbittorrent-create-api-key"), keyApproval);
  assert.equal(logins, 2, "Deferred key approval must retain its exact Cookie header");
  approvals.add(keyApproval);
  failKeyReadback = true;
  await assert.rejects(qbittorrent.firstRun(context), /preferences could not be read/);
  assert.equal(await facilities.secrets.readApiKey(), apiKey,
    "The returned durable key must be captured before its failing network readback");
  assert.equal((await facilities.checkpoint.read())?.stage, "api-key-create-attempted");
  assert.equal(keyCreations, 1);
  failKeyReadback = false;
  const categoryApproval = await defer("qbittorrent-create-sonarr-category");
  assert.equal(keyCreations, 1);
  approvals.add(categoryApproval);
  assert.equal(qbittorrent.ready(await qbittorrent.firstRun(context)), true);
  assert.equal(await facilities.secrets.readApiKey(), apiKey);
  assert.deepEqual(rotationCookies, ["QBT_SID_8080=synthetic-session-1"]);
  assert.deepEqual(keyCookies, ["QBT_SID_8080=synthetic-session-2"]);
  assert.equal(qbittorrent.ready(await qbittorrent.firstRun(context)), true);
  assert.equal(logins, 2);
  assert.equal(rotations, 1);
  assert.equal(keyCreations, 1);
  assert.equal(categoryCreations, 1);
  const cached = await facilities.secrets.readSessionCookies();
  for (const code of [401, 500]) {
    sessionStatus = code;
    await assert.rejects(qbittorrent.firstRun(context), /pinned WebUI API version/);
    assert.deepEqual(await facilities.secrets.readSessionCookies(), cached);
    assert.equal(logins, 2);
  }
  sessionStatus = 200; wrongOwner = true;
  await assert.rejects(qbittorrent.firstRun(context), /username conflicts/);
  assert.deepEqual(await facilities.secrets.readSessionCookies(), cached);
  wrongOwner = false; wrongVersion = true;
  await assert.rejects(qbittorrent.firstRun(context), /pinned WebUI API version/);
  assert.deepEqual(await facilities.secrets.readSessionCookies(), cached);
  wrongVersion = false; sessionStatus = 403;
  await assert.rejects(qbittorrent.firstRun(context), /new approved login/);
  const cleared = await facilities.secrets.readSessionCookies();
  assert.deepEqual(Reflect.ownKeys(cleared), []);
  assert.equal(JSON.stringify(cleared), "{}");
  assert.equal(logins, 2);
  sessionStatus = 200;
  approvals.add(await defer("qbittorrent-verify-managed-login"));
  assert.equal(qbittorrent.ready(await qbittorrent.firstRun(context)), true);
  assert.equal(logins, 3);
  assert.equal(keyCreations, 1);
  const validCache = await facilities.secrets.readSessionCookies();
  await facilities.secrets.writeSessionCookies({ ...validCache, password_digest: "f".repeat(64) });
  await assert.rejects(qbittorrent.firstRun(context), /differs from its saved owner credential/);
  assert.equal(logins, 3);
  await facilities.secrets.writeSessionCookies(validCache);

  // Renewing an expired session must invalidate an already reviewed
  // Cookie-bound key-creation token, even with an unchanged checkpoint/body.
  const renewalRoot = await mkdtemp(join(tmpdir(), "selfhost-qbittorrent-renewal-"));
  try {
    const renewalProject = join(renewalRoot, ".selfhost", "shared", projectId);
    const renewalFiles = join(renewalProject, "secrets", appId);
    await mkdir(renewalFiles, { recursive: true, mode: 0o700 });
    await writeFile(join(renewalFiles, "admin-password"), password, { mode: 0o600 });
    currentKey = "";
    const renewalStatus = { ...status, projectRoot: renewalRoot, privateFiles: renewalFiles,
      passwordFile: join(renewalFiles, "admin-password"),
      composeTarget: join(renewalProject, "compose.aaaaaaaaaaaaaaaa.yaml") };
    const granted = new Set<string>();
    let pending: { action: string; token: string } | undefined;
    const renewalFacilities = createSetupTransportFacilities({ appId, projectRoot: renewalRoot,
      async readStatus() { return renewalStatus; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve(action, token) { pending = { action, token }; return granted.has(token); },
      approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
    const renewalContext = { ...renewalFacilities, appId, projectRoot: renewalRoot, inputs: {}, installedAppIds: [appId],
      async status() { return renewalStatus; } } as unknown as SetupContext;
    async function renewalDefer(action: string) {
      await assert.rejects(qbittorrent.firstRun(renewalContext), SetupTransportDeferred);
      assert.equal(pending?.action, action);
      return pending!.token;
    }
    const firstLogin = await renewalDefer("qbittorrent-verify-managed-login");
    granted.add(firstLogin);
    const oldKeyApproval = await renewalDefer("qbittorrent-create-api-key");
    const oldCookie = (await renewalFacilities.secrets.readSessionCookies()).session;
    sessionStatus = 403;
    await assert.rejects(qbittorrent.firstRun(renewalContext), /new approved login/);
    assert.deepEqual(Reflect.ownKeys(await renewalFacilities.secrets.readSessionCookies()), []);
    granted.delete(firstLogin);
    sessionStatus = 200;
    granted.add(await renewalDefer("qbittorrent-verify-managed-login"));
    granted.add(oldKeyApproval);
    const beforeCreation = keyCreations;
    const renewedKeyApproval = await renewalDefer("qbittorrent-create-api-key");
    assert.notEqual((await renewalFacilities.secrets.readSessionCookies()).session, oldCookie);
    assert.notEqual(renewedKeyApproval, oldKeyApproval);
    assert.equal(keyCreations, beforeCreation, "The old Cookie-bound token must not authorize renewed-session writes");
    granted.add(renewedKeyApproval);
    assert.equal(qbittorrent.ready(await qbittorrent.firstRun(renewalContext)), true);
    assert.equal(keyCreations, beforeCreation + 1);
  } finally { await rm(renewalRoot, { recursive: true }); }

  // A separate exact owner retains before-send checkpoints after uncertain writes.
  async function lossFixture(kind: "rotation" | "key") {
    const lossRoot = await mkdtemp(join(tmpdir(), "selfhost-qbittorrent-loss-"));
    try {
      const lossProject = join(lossRoot, ".selfhost", "shared", projectId);
      const lossFiles = join(lossProject, "secrets", appId);
      await mkdir(lossFiles, { recursive: true, mode: 0o700 });
      await writeFile(join(lossFiles, "admin-password"), password, { mode: 0o600 });
      managed = false; currentKey = ""; inventory = {}; loseRotation = kind === "rotation"; loseKey = kind === "key";
      const lossStatus = { ...status, projectRoot: lossRoot, privateFiles: lossFiles,
        passwordFile: join(lossFiles, "admin-password"), composeTarget: join(lossProject, "compose.aaaaaaaaaaaaaaaa.yaml") };
      const lossFacilities = createSetupTransportFacilities({ appId, projectRoot: lossRoot,
        async readStatus() { return lossStatus; }, async readHandoff() { throw new Error("Unexpected handoff"); },
        async approve() { return true; }, approvalQueue: { tail: Promise.resolve() },
        registerSecret() {}, redact(value) { return value; } });
      const lossContext = { ...lossFacilities, appId, projectRoot: lossRoot, inputs: {}, installedAppIds: [appId],
        secrets: { ...lossFacilities.secrets, async readQbittorrentTemporaryPassword() { return temporaryPassword; } },
        async status() { return lossStatus; } } as unknown as SetupContext;
      await assert.rejects(qbittorrent.firstRun(lossContext), /did not confirm/);
      const writes = { rotations, keyCreations };
      if (kind === "rotation") {
        loseRotation = false;
        assert.equal(qbittorrent.ready(await qbittorrent.firstRun(lossContext)), true);
        assert.equal(rotations, writes.rotations, "An attempted password rotation must reconcile, never replay");
      } else {
        await assert.rejects(qbittorrent.firstRun(lossContext), /creation was attempted/);
        assert.equal(keyCreations, writes.keyCreations, "An uncertain API-key rotation must not replay");
      }
    } finally { await rm(lossRoot, { recursive: true }); }
  }
  await lossFixture("rotation");
  await lossFixture("key");
} finally {
  server.stop(true);
  await rm(root, { recursive: true });
}
console.log("qBittorrent real transport: stable temporary/managed session approval hashes, readback, expiry and no-repeat checkpoints passed");
