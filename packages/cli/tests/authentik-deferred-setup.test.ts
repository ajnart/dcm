import assert from "node:assert/strict";
import { createServer } from "node:http";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/authentik/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const root = await mkdtemp(join(tmpdir(), "authentik-deferred-setup-"));
const password = "A".repeat(65); // Actual 48-byte alphanumeric preparation length.
const token = "B".repeat(65);
let opens = 0;
let identifications = 0;
let passwords = 0;
let readbackStatus = 200;
const flow = "/api/v3/flows/executor/default-authentication-flow/";
const server = createServer(async (request, result) => {
  let raw = "";
  for await (const chunk of request) raw += String(chunk);
  result.setHeader("Content-Type", "application/json");
  let body: unknown;
  if (request.url === flow && request.method === "GET") {
    opens++;
    result.setHeader("Set-Cookie", `authentik_session=initial-${opens}; HttpOnly`);
    body = { component: "ak-stage-identification", response_errors: {} };
  } else if (request.url === flow) {
    const input = JSON.parse(raw);
    if (input.component === "ak-stage-identification") {
      assert.equal(request.headers.cookie, `authentik_session=initial-${opens}`);
      assert.equal(input.uid_field, "akadmin");
      identifications++;
      result.setHeader("Set-Cookie", `authentik_session=identified-${opens}; HttpOnly`);
      body = { component: "ak-stage-password" };
    } else {
      assert.equal(input.component, "ak-stage-password");
      assert.equal(input.password, password);
      assert.equal(request.headers.cookie, `authentik_session=identified-${opens}`);
      passwords++;
      result.setHeader("Set-Cookie", `authentik_session=authenticated-${opens}; HttpOnly`);
      body = { component: "xak-flow-redirect", final_redirect: true };
    }
  } else {
    assert.equal(request.url, "/api/v3/core/users/me/");
    if (request.headers.authorization) {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      body = { user: { username: "akadmin", is_superuser: true } };
    } else if (request.headers.cookie) {
      assert.equal(request.headers.cookie, `authentik_session=authenticated-${opens}`);
      result.statusCode = readbackStatus;
      body = { user: { username: "akadmin", is_superuser: true } };
    } else {
      result.statusCode = 401;
      body = {};
    }
  }
  result.end(JSON.stringify(body));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const appId = "authentik";
  const projectId = "authentik_deferred";
  const projectDirectory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(projectDirectory, "secrets", appId);
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  const passwordFile = join(privateFiles, "admin-password");
  await writeFile(passwordFile, password, { mode: 0o600 });
  await writeFile(join(privateFiles, "authentik-api-key"), token, { mode: 0o600 });
  const status = { command: "app status", ownerKind: "shared", appId,
    projectRoot: root, mutation: false, status: "applied", runtime: { state: "running" },
    projectId, dockerContext: "default", port: address.port, url: `http://127.0.0.1:${address.port}`,
    composeTarget: join(projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64), privateFiles, passwordFile, username: "akadmin" };
  const approvals = new Set<string>();
  let pending = "";
  function invocation(): SetupContext {
    const facilities = createSetupTransportFacilities({ appId, projectRoot: root,
      async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve(_action, review) { pending = review; return approvals.has(review); },
      approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
    return { ...facilities, appId, projectRoot: root, async status() { return status; },
      installedAppIds: [appId], inputs: {} } as unknown as SetupContext;
  }
  async function deferred(): Promise<string> {
    await assert.rejects(adapter.firstRun(invocation()), /approval was declined/);
    return pending;
  }
  const identification = await deferred();
  assert.equal(await deferred(), identification);
  assert.equal(opens, 1);
  approvals.add(identification);
  const passwordReview = await deferred();
  assert.equal(await deferred(), passwordReview);
  assert.equal(identifications, 1);
  assert.equal(opens, 1);
  assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
  approvals.add(passwordReview);
  readbackStatus = 503;
  await assert.rejects(adapter.firstRun(invocation()), /did not establish/);
  assert.equal(passwords, 1);
  assert.equal((await invocation().secrets.readSessionCookies()).component, "xak-flow-redirect");
  readbackStatus = 200;
  assert.equal(adapter.ready(await adapter.firstRun(invocation())), true);
  assert.equal(passwords, 1, "readback retry must not re-submit the password");
  assert.deepEqual(Object.keys(await invocation().secrets.readSessionCookies()), []);
  assert.equal(await invocation().checkpoint.read().then((value) => value?.stage), "admin-password-and-token-verified");
  const freshReview = await deferred();
  assert.notEqual(freshReview, identification);
  assert.equal(opens, 2, "a later completed run starts fresh password proof");
  await writeFile(passwordFile, "C".repeat(65), { mode: 0o600 });
  await assert.rejects(adapter.firstRun(invocation()), /saved flow differs/);
  console.log("Authentik actual-transport deferred approval and saved-flow checks passed (synthetic only)");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error); else resolve();
  }));
  await rm(root, { recursive: true, force: true });
}
