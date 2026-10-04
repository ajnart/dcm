import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import adapter from "./setup";
import type { SetupContext } from "../../types/setup";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../../../../../../../../../packages/cli/src/control-panel/setup-transport";

// Real shared HTTP/checkpoint/session facilities, synthetic loopback upstream.
const root = await mkdtemp(join(tmpdir(), "patchmon-deferred-fixture-"));
const projectId = "patchmon_fixture";
const directory = join(root, ".selfhost", "shared", projectId);
const privateFiles = join(directory, "secrets", "patchmon");
const passwordFile = join(privateFiles, "admin-password");
const SYNTHETIC_ADMIN_CREDENTIAL = "FixtureOnly-NotALiveCredential-12345";
const email = "owner@example.invalid";
const user = { id: "fixture-admin", username: "admin", email, role: "superadmin", is_active: true, has_password: true };
let hasAdmin = false;
let logins = 0;
let jwt = "";
const validSessions = new Set<string>();
let profileStatus = 200;
let loginStatus = 200;
let freshIdentityMismatch = false;
let tokenCreates = 0;
let statsReads = 0;
let allowToken = false;
let allowStats = false;
const pair = { apiKey: `patchmon_ae_${"a".repeat(32)}`, apiSecret: "b".repeat(64) };
const token = { id: "11111111-1111-4111-8111-111111111111", token_name: "selfhost-homarr",
  token_key: pair.apiKey, is_active: true, expires_at: null, max_hosts_per_day: 1,
  allowed_ip_ranges: [], metadata: { integration_type: "gethomepage" }, scopes: null,
  users: { id: user.id, username: "admin" } };
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return Response.json({ status: "ok", database: "ok", redis: "ok" });
    if (path.endsWith("/settings/login-settings")) return Response.json({ hasAdminUsers: hasAdmin });
    if (path.endsWith("/auth/setup-admin")) {
      assert.equal(hasAdmin, false);
      assert.equal((await request.json()).password, SYNTHETIC_ADMIN_CREDENTIAL);
      hasAdmin = true;
      return Response.json({ user }, { status: 201 });
    }
    if (path.endsWith("/auth/login")) {
      assert.equal((await request.json()).password, SYNTHETIC_ADMIN_CREDENTIAL);
      if (loginStatus !== 200) return Response.json({}, { status: loginStatus });
      logins += 1;
      jwt = `synthetic.owner.session.${logins}`;
      validSessions.add(jwt);
      return Response.json({ token: jwt });
    }
    if (path.endsWith("/auth/profile")) {
      if (profileStatus !== 200) return Response.json({}, { status: profileStatus });
      if (!validSessions.has(request.headers.get("Authorization")?.slice(7) ?? "")) return Response.json({}, { status: 401 });
      if (freshIdentityMismatch && request.headers.get("Authorization") === `Bearer ${jwt}`) {
        return Response.json({ user: { ...user, id: "different-admin" } });
      }
      return Response.json({ user });
    }
    if (path.endsWith("/auto-enrollment/tokens") && request.method === "GET") {
      if (tokenCreates === 0) return Response.json([]);
      return Response.json([token]);
    }
    if (path.endsWith("/auto-enrollment/tokens")) {
      assert.equal(allowToken, true);
      assert.equal(tokenCreates, 0);
      tokenCreates += 1;
      return Response.json({ token: { ...token, token_secret: pair.apiSecret } }, { status: 201 });
    }
    if (path.endsWith("/gethomepage/stats")) {
      assert.equal(allowStats, true);
      assert.equal(request.headers.get("Authorization"), `Basic ${Buffer.from(`${pair.apiKey}:${pair.apiSecret}`).toString("base64")}`);
      statsReads += 1;
      return Response.json({ total_hosts: 0, hosts_needing_updates: 0, security_updates: 0,
        up_to_date_hosts: 0, hosts_with_security_updates: 0, recent_updates_24h: 0,
        total_outdated_packages: 0, total_repos: 0, last_updated: "2026-10-03T12:00:00Z", os_distribution: [] });
    }
    throw new Error("Unexpected synthetic route");
  },
});

try {
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(passwordFile, SYNTHETIC_ADMIN_CREDENTIAL, { mode: 0o600 });
  const status = { command: "app status", ownerKind: "shared", appId: "patchmon", projectRoot: root,
    mutation: false, status: "applied", runtime: { state: "running" }, projectId, dockerContext: "default",
    port: server.port, url: `http://127.0.0.1:${server.port}`,
    composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64), privateFiles, passwordFile };
  const reviews: string[] = [];
  const statsReviews: string[] = [];
  function invocation(): SetupContext {
    const facilities = createSetupTransportFacilities({
      appId: "patchmon", projectRoot: root,
      readStatus: async () => status, readHandoff: async () => { throw new Error("Unexpected handoff"); },
      approve: async (action, approval) => {
        if (action === "patchmon-create-homarr-token") { reviews.push(approval); return allowToken; }
        if (action === "patchmon-verify-homarr-token") { statsReviews.push(approval); return allowStats; }
        return true;
      },
      approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact: (value) => value,
    });
    return { ...facilities, appId: "patchmon", projectRoot: root, installedAppIds: ["patchmon"],
      inputs: { "admin-email": email, "credential-authority": "stats-and-enrollment" },
      status: async () => status } as unknown as SetupContext;
  }
  await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
  assert.equal(logins, 1);
  const firstCheckpoint = await invocation().checkpoint.read();
  const sessionPath = join(privateFiles, "session-cookies.json");
  assert.equal((await lstat(sessionPath)).mode & 0o777, 0o600);
  assert.equal((await invocation().secrets.readSessionCookies()).token, jwt);

  await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
  assert.equal(logins, 2, "A cached session must not bypass fresh password proof");
  assert.equal(reviews.length, 2);
  assert.equal(reviews[0], reviews[1], "Deferred exact creation approval must remain stable");
  assert.deepEqual(await invocation().checkpoint.read(), firstCheckpoint);

  const sessionBefore = await readFile(sessionPath, "utf8");
  profileStatus = 503;
  await assert.rejects(adapter.firstRun(invocation()), /uncertain; session preserved/);
  assert.equal(await readFile(sessionPath, "utf8"), sessionBefore);
  assert.equal(logins, 2);
  profileStatus = 403;
  await assert.rejects(adapter.firstRun(invocation()), /uncertain; session preserved/);
  assert.equal(await readFile(sessionPath, "utf8"), sessionBefore);

  profileStatus = 200;
  loginStatus = 401;
  await assert.rejects(adapter.firstRun(invocation()), /rejected the saved administrator/);
  assert.equal(await readFile(sessionPath, "utf8"), sessionBefore);
  loginStatus = 200;
  freshIdentityMismatch = true;
  await assert.rejects(adapter.firstRun(invocation()), /differs from the retained administrator/);
  assert.equal(await readFile(sessionPath, "utf8"), sessionBefore);
  freshIdentityMismatch = false;

  // Make only the previously saved token invalid. The next login gets a new
  // valid session; no one-time mutation or checkpoint has been replayed.
  profileStatus = 200;
  validSessions.clear();
  await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
  assert.equal(logins, 4);
  assert.equal((await invocation().secrets.readSessionCookies()).token, jwt);
  await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
  assert.equal(logins, 5);
  assert.equal(reviews.at(-1), reviews.at(-2));
  assert.equal(tokenCreates, 0);
  assert.deepEqual(await invocation().checkpoint.read(), firstCheckpoint);
  allowToken = true;
  await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
  assert.equal(tokenCreates, 1);
  assert.equal(statsReads, 0);
  const savedPairCheckpoint = await invocation().checkpoint.read();
  assert.equal(savedPairCheckpoint?.stage, "homarr-token-saved");
  assert.equal((await lstat(join(privateFiles, "patchmon-api-key"))).mode & 0o777, 0o600);
  await assert.rejects(adapter.firstRun(invocation()), SetupTransportDeferred);
  assert.equal(tokenCreates, 1);
  assert.equal(statsReviews[0], statsReviews[1], "Deferred stats approval must also remain stable");
  assert.deepEqual(await invocation().checkpoint.read(), savedPairCheckpoint);
  allowStats = true;
  assert.equal(adapter.ready(await adapter.firstRun(invocation())), true);
  assert.equal(tokenCreates, 1);
  assert.equal(statsReads, 1);
  const verifiedCheckpoint = await invocation().checkpoint.read();
  assert.equal(adapter.ready(await adapter.firstRun(invocation())), true);
  assert.deepEqual(await invocation().checkpoint.read(), verifiedCheckpoint);
  console.log("PatchMon actual-transport deferred approval and private session replay checks passed");
} finally {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
