import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mayan from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/mayan-edms/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const appId = "mayan-edms";
const password = "p".repeat(64);
const token = "a".repeat(40);
const authorization = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
const user = { id: 1, username: "admin", is_active: true };
let initialVisible = true;
let clearRequests = 0;
let tokenRequests = 0;
let loseClearResponse = false;
let loseTokenResponse = false;
let tokenIdentity = 1;
let anonymousAllowed = false;
let ownerVisible = true;
let userAdministrationAllowed = true;
const approvedActions: string[] = [];
const temporary = await mkdtemp(join(tmpdir(), "mayan-edms-setup-"));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const auth = request.headers.get("authorization");
    if (path === "/api/v4/users/") {
      assert.ok(auth === authorization || auth === `Token ${token}`);
      if (!userAdministrationAllowed) return new Response(null, { status: 403 });
      let results: Array<typeof user> = [];
      if (ownerVisible) results = [user];
      return Response.json({ count: results.length, results });
    }
    if (path === "/authentication/login/") {
      let page = "<form>Login</form>";
      if (initialVisible) page += `<strong>${password}</strong>`;
      return new Response(page, { headers: { "Content-Type": "text/html" } });
    }
    if (path === "/api/v4/users/current/") {
      if (auth !== authorization && auth !== `Token ${token}`) {
        if (anonymousAllowed) return Response.json(user);
        return new Response(null, { status: 401 });
      }
      if (request.method === "PATCH") {
        assert.equal(auth, authorization);
        assert.deepEqual(await request.json(), { password });
        clearRequests++;
        initialVisible = false;
        if (loseClearResponse) return new Response(null, { status: 500 });
      }
      if (auth === `Token ${token}`) return Response.json({ ...user, id: tokenIdentity });
      return Response.json(user);
    }
    if (path === "/api/v4/auth/token/obtain/") {
      assert.equal(request.method, "POST");
      assert.deepEqual(await request.json(), { username: "admin", password });
      assert.equal(initialVisible, false, "Token must not be acquired before credential display is cleared");
      tokenRequests++;
      if (loseTokenResponse) return new Response(null, { status: 500 });
      return Response.json({ token });
    }
    throw new Error(`Unexpected Mayan fixture request: ${request.method} ${path}`);
  },
});

async function context(name: string): Promise<SetupContext> {
  const projectRoot = join(temporary, name);
  const projectId = "mayan_fixture";
  const directory = join(projectRoot, ".selfhost", "shared", projectId);
  const privateFiles = join(directory, "secrets", appId);
  const passwordFile = join(privateFiles, "admin-password");
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(passwordFile, password, { mode: 0o600 });
  const status = { command: "app status", appId, projectRoot, ownerKind: "shared",
    mutation: false, status: "applied", runtime: { state: "running" }, username: "admin",
    projectId, dockerContext: "default", port: server.port, url: `http://127.0.0.1:${server.port}`,
    composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64), privateFiles, passwordFile };
  const facilities = createSetupTransportFacilities({ appId, projectRoot,
    async readStatus() { return status; },
    async readHandoff() { throw new Error("Unexpected Mayan handoff"); },
    async approve(action) { approvedActions.push(action); return true; },
    approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
  return { ...facilities, appId, projectRoot, inputs: {}, installedAppIds: [appId],
    async status() { return status; } } as unknown as SetupContext;
}

try {
  const folder = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/mayan-edms/", import.meta.url);
  const app = JSON.parse(await readFile(new URL("manifest.json", folder), "utf8"));
  const recipe = JSON.parse(await readFile(new URL("recipe.json", folder), "utf8"));
  assert.deepEqual(validateAppRecipe(recipe, app), []);
  assert.equal(recipe.services.length, 4);
  assert.equal(recipe.services.filter((service: { publishTargetPort: number | null }) => service.publishTargetPort !== null).length, 1);
  assert.equal(recipe.services[0].imageTag, "docker.io/mayanedms/mayanedms:v4.12.2");
  assert.equal(recipe.privateConfigs.length, 6);
  assert.equal(recipe.services[0].secretEnvironment.filter((binding: { format?: string }) => binding.format === "private-config").length, 5);

  const owner = await context("fresh");
  const configured = await mayan.firstRun(owner);
  assert.equal(mayan.ready(configured), true);
  assert.equal(configured.stage, "owner-login-and-api-token-verified");
  assert.equal(configured.userViewPermission, "user-list-and-saved-owner-visible");
  assert.equal(configured.administratorAuthority, "not-verified");
  assert.equal(mayan.ready({ ...configured, administratorAuthority: "verified" }), false);
  assert.equal(clearRequests, 1);
  assert.equal(tokenRequests, 1);
  assert.deepEqual(approvedActions, ["mayan-clear-initial-credential-display", "mayan-acquire-api-token"]);
  assert.equal(await owner.secrets.readApiKey(), token);
  const report = JSON.stringify(configured);
  assert.ok(!report.includes(password) && !report.includes(token));
  await mayan.firstRun(owner);
  await mayan.inspect!(owner);
  assert.equal(clearRequests, 1, "Replay must not rehash the administrator again");
  assert.equal(tokenRequests, 1, "Replay must verify the saved token, not acquire it again");
  userAdministrationAllowed = false;
  await assert.rejects(mayan.inspect!(owner), /user-view permission/);
  await assert.rejects(mayan.firstRun(owner), /user-view permission/);
  assert.equal(clearRequests, 1);
  assert.equal(tokenRequests, 1);
  userAdministrationAllowed = true;
  ownerVisible = false;
  await assert.rejects(mayan.inspect!(owner), /user list is invalid/);
  ownerVisible = true;
  initialVisible = true;
  await assert.rejects(mayan.inspect!(owner), /discloses/);
  await assert.rejects(mayan.firstRun(owner), /already attempted/);
  assert.equal(clearRequests, 1);
  initialVisible = false;
  tokenIdentity = 2;
  await assert.rejects(mayan.inspect!(owner), /different identity/);
  tokenIdentity = 1;
  anonymousAllowed = true;
  await assert.rejects(mayan.inspect!(owner), /anonymous/);
  anonymousAllowed = false;

  initialVisible = true;
  loseClearResponse = true;
  const interruptedCleanup = await context("interrupted-cleanup");
  await assert.rejects(mayan.firstRun(interruptedCleanup), /cleanup did not return/);
  const attemptedCleanup = await interruptedCleanup.checkpoint.read();
  assert.ok(attemptedCleanup?.attemptedActions.includes("mayan-clear-initial-credential-display"));
  loseClearResponse = false;
  const beforeResumeClear = clearRequests;
  await mayan.firstRun(interruptedCleanup);
  assert.equal(clearRequests, beforeResumeClear, "Lost cleanup response must reconcile readback, not repeat the PATCH");

  initialVisible = false;
  loseTokenResponse = true;
  const interruptedToken = await context("interrupted-token");
  await assert.rejects(mayan.firstRun(interruptedToken), /token acquisition did not return/);
  const attemptedToken = await interruptedToken.checkpoint.read();
  assert.ok(attemptedToken?.attemptedActions.includes("mayan-acquire-api-token"));
  loseTokenResponse = false;
  const beforeResumeToken = tokenRequests;
  await assert.rejects(mayan.firstRun(interruptedToken), /already attempted without a saved token/);
  assert.equal(tokenRequests, beforeResumeToken, "Lost token response must never replay token acquisition");

  const transientReadback = await context("token-readback-recovery");
  tokenIdentity = 2;
  await assert.rejects(mayan.firstRun(transientReadback), /different identity/);
  assert.equal(await transientReadback.secrets.readApiKey(), token,
    "A returned token must be saved before any fallible follow-up identity request");
  const beforeReadbackResume = tokenRequests;
  tokenIdentity = 1;
  await mayan.firstRun(transientReadback);
  assert.equal(tokenRequests, beforeReadbackResume, "Readback recovery must use the saved token");
  console.log("Mayan source-backed recipe and private HTTP setup fixture passed; no live runtime acceptance");
} finally {
  server.stop(true);
  await rm(temporary, { recursive: true, force: true });
}
