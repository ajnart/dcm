import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tracearr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/tracearr/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const root = await mkdtemp(join(tmpdir(), "tracearr-deferred-setup-"));
const projectId = "tracearr-deferred-fixture";
const appDirectory = join(root, ".selfhost", "apps", projectId);
const privateFiles = join(appDirectory, "secrets");
const email = "owner@example.test";
const password = "fixture-private-password";
const userId = "11111111-1111-4111-8111-111111111111";
const key = `trr_pub_${"a".repeat(43)}`;
let owned = false;
let signupCount = 0;
let loginCount = 0;
let keyCount = 0;
let session = "";
const validSessions = new Set<string>();
let keyCreated = false;
let approvedKey = "";
const pendingKeys: string[] = [];
const server = createServer(async (request, response) => {
  let value: unknown = {};
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    switch (request.url) {
      case "/health": value = { status: "ok", mode: "ready", db: true, redis: true }; break;
      case "/api/v1/version": value = { current: { version: "v2.6.0" } }; break;
      case "/api/v1/setup/status": value = { needsSetup: !owned, requiresClaimCode: false, authMethods: { local: true } }; break;
      case "/api/v1/auth/sign-up/email":
        assert.equal(request.method, "POST"); assert.equal(owned, false);
        assert.deepEqual(JSON.parse(body), { name: "Administrator", username: "admin", email, password });
        owned = true; signupCount++; value = { token: "ignored-signup-session" }; break;
      case "/api/v1/auth/sign-in/username":
        assert.deepEqual(JSON.parse(body), { username: "admin", password });
        loginCount++; session = `unique-fixture-session-${loginCount}`; validSessions.add(session); value = { token: session }; break;
      case "/api/v1/auth/me":
        assert.ok(validSessions.has(request.headers.authorization?.slice(7) ?? ""));
        value = { username: "admin", email, userId, role: "owner" }; break;
      case "/api/v1/settings/api-key":
        assert.equal(request.headers.authorization, "Bearer unique-fixture-session-1");
        value = { token: null }; if (keyCreated) value = { token: key }; break;
      case "/api/v1/settings/api-key/regenerate":
        assert.equal(request.headers.authorization, "Bearer unique-fixture-session-1");
        assert.equal(keyCreated, false); keyCreated = true; keyCount++; value = { token: key }; break;
      case "/api/v1/public/health":
        assert.equal(request.headers.authorization, `Bearer ${key}`);
        value = { status: "ok", version: "v2.6.0", servers: [] }; break;
      default: throw new Error("Unexpected fixture route");
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  } catch {
    response.writeHead(500); response.end("Fixture assertion failed");
  }
});

try {
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  const passwordFile = join(privateFiles, "admin-password");
  await writeFile(passwordFile, password, { mode: 0o600 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const status = { command: "app status", appId: "tracearr", projectRoot: root, status: "applied", mutation: false,
    username: "admin", runtime: { state: "running" }, projectId, port: address.port, dockerContext: "default",
    composeTarget: join(appDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `APP-APPLY:tracearr:${"a".repeat(64)}`, url: `http://127.0.0.1:${address.port}`, privateFiles, passwordFile };
  function context(): SetupContext {
    const facilities = createSetupTransportFacilities({ appId: "tracearr", projectRoot: root,
      async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve(action, token) {
        if (action === "tracearr-create-public-api-key") {
          pendingKeys.push(token);
          return token === approvedKey;
        }
        return true;
      }, approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
    return { ...facilities, appId: "tracearr", projectRoot: root, inputs: { email }, async status() { return status; } } as SetupContext;
  }
  await assert.rejects(tracearr.firstRun(context()), /approval was declined/);
  assert.equal(loginCount, 1); assert.equal(keyCount, 0);
  assert.equal((await stat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
  // New facilities/context emulates a later CLI invocation reading the private session from disk.
  await assert.rejects(tracearr.firstRun(context()), /approval was declined/);
  assert.equal(pendingKeys.length, 2);
  assert.equal(pendingKeys[1], pendingKeys[0]);
  assert.equal(loginCount, 2); assert.equal(signupCount, 1); assert.equal(keyCount, 0);
  approvedKey = pendingKeys[0]!;
  assert.equal(tracearr.ready(await tracearr.firstRun(context())), true);
  assert.equal(loginCount, 3); assert.equal(signupCount, 1); assert.equal(keyCount, 1);
  assert.equal(tracearr.ready(await tracearr.firstRun(context())), true);
  assert.equal(keyCount, 1);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true });
}
console.log("Tracearr real-transport deferred approval fixture passed; no Docker or upstream API was used.");
