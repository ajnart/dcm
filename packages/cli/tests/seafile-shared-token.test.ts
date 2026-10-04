import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import seafile from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seafile/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const appId = "seafile";
const password = "p".repeat(64);
const token = "a".repeat(40);
const temporary = await mkdtemp(join(tmpdir(), "seafile-shared-token-"));
let requests = 0;
let loseResponse = false;
let failIdentity = false;
let email = "admin@example.test";
let isStaff = true;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api2/auth-token/") {
    assert.equal(request.method, "POST");
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get("username"), "admin@example.test");
    assert.equal(body.get("password"), password);
    requests++;
    if (loseResponse) return new Response(null, { status: 500 });
    return Response.json({ token });
  }
  assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  if (url.pathname === "/api2/account/info/") {
    if (failIdentity) return new Response(null, { status: 503 });
    return Response.json({ email, is_staff: isStaff });
  }
  assert.equal(url.pathname, "/api/v2.1/admin/users/");
  assert.equal(url.searchParams.get("page"), "1");
  return Response.json({ users: [] });
} });

async function fixture(name: string) {
  const projectRoot = join(temporary, name);
  const projectId = "seafile_fixture";
  const directory = join(projectRoot, ".selfhost", "shared", projectId);
  const privateFiles = join(directory, "secrets", appId);
  const passwordFile = join(privateFiles, "admin-password");
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(passwordFile, password, { mode: 0o600 });
  const status = { command: "app status", appId, projectRoot, projectId, ownerKind: "shared",
    status: "applied", mutation: false, runtime: { state: "running" },
    username: "admin@example.test", privateFiles, passwordFile, port: server.port,
    url: `http://127.0.0.1:${server.port}`, dockerContext: "default",
    composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64) };
  const facilities = createSetupTransportFacilities({ appId, projectRoot,
    async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
    async approve() { return true; }, approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; } });
  const context = { ...facilities, appId, projectRoot, inputs: {}, installedAppIds: [appId],
    async status() { return status; } } as unknown as SetupContext;
  return { context, status, privateFiles };
}

try {
  const fresh = await fixture("fresh");
  failIdentity = true;
  await assert.rejects(seafile.firstRun(fresh.context), /did not authenticate/);
  assert.equal(await readFile(join(fresh.privateFiles, "seafile-api-key"), "utf8"), token);
  assert.equal(requests, 1, "Save the token before its fallible readback");
  failIdentity = false;
  const result = await seafile.firstRun(fresh.context);
  assert.equal(seafile.ready(result), true);
  assert.deepEqual(await seafile.inspect!(fresh.context), result);
  assert.equal(requests, 1, "Resume through saved-token reads, not another token acquisition");
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.equal(JSON.stringify(result).includes(token), false);
  email = "someone-else@example.test";
  await assert.rejects(seafile.firstRun(fresh.context), /exact administrator/);
  email = "admin@example.test";
  isStaff = false;
  await assert.rejects(seafile.inspect!(fresh.context), /exact administrator/);
  isStaff = true;
  fresh.status.username = "someone-else@example.test";
  await assert.rejects(seafile.firstRun(fresh.context), /exact shared email administrator/);
  const uncertain = await fixture("uncertain");
  loseResponse = true;
  await assert.rejects(seafile.firstRun(uncertain.context), /uncertain/);
  loseResponse = false;
  await assert.rejects(seafile.firstRun(uncertain.context), /without replaying/);
  assert.equal(requests, 2, "Do not replay an acquisition whose returned token was lost");
  console.log("PASS Seafile real shared transport token privacy, capture-before-readback, identity and no-replay; no live acceptance");
} finally {
  server.stop(true);
  await rm(temporary, { recursive: true, force: true });
}
