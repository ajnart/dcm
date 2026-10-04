import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import audiobookshelf from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/audiobookshelf/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../src/control-panel/setup-transport.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-audiobookshelf-setup-"));
const appId = "audiobookshelf";
const projectId = "audiobookshelf_fixture";
const projectDirectory = join(root, ".selfhost", "shared", projectId);
const privateFiles = join(projectDirectory, "secrets", appId);
const passwordFile = join(privateFiles, "admin-password");
const password = "p".repeat(48);
const durableKey = "durable.body.signature";
const user = { id: "owned-root", username: "admin", type: "root" };
let initialized = false;
let logins = 0;
let creations = 0;
let activeBearer = "";
const validBearers = new Set<string>();
let retainedBearer = "";
let sessionStatus = 200;
let loginStatus = 200;
let loginOwnerId = user.id;
let freshSessionStatus = 200;
let keyEntries: Record<string, unknown>[] = [];
let loseKeyResponse = false;
const createdAuthorizations: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/status") return Response.json({ app: appId, serverVersion: "2.37.0", isInit: initialized });
    if (path === "/init") {
      assert.deepEqual(await request.json(), { newRoot: { username: "admin", password } });
      initialized = true;
      return Response.json({});
    }
    if (path === "/login") {
      assert.deepEqual(await request.json(), { username: "admin", password });
      if (loginStatus !== 200) return new Response(null, { status: loginStatus });
      activeBearer = `session.body${++logins}.signature`;
      validBearers.add(activeBearer);
      return Response.json({ user: { ...user, id: loginOwnerId, accessToken: activeBearer } });
    }
    const authorization = request.headers.get("authorization");
    if (path === "/api/me") {
      const bearer = authorization?.replace(/^Bearer /, "");
      if (bearer && validBearers.has(bearer) && sessionStatus !== 200) {
        return new Response(null, { status: sessionStatus });
      }
      if (bearer && validBearers.has(bearer) && retainedBearer && bearer !== retainedBearer
        && freshSessionStatus !== 200) return new Response(null, { status: freshSessionStatus });
      if ((!bearer || !validBearers.has(bearer)) && authorization !== `Bearer ${durableKey}`) {
        return new Response(null, { status: 401 });
      }
      return Response.json(user);
    }
    if (path === "/api/api-keys") {
      assert.ok(validBearers.has(authorization?.replace(/^Bearer /, "") ?? ""));
      if (request.method === "GET") return Response.json({ apiKeys: keyEntries });
      createdAuthorizations.push(authorization!);
      creations++;
      const body = await request.json() as Record<string, unknown>;
      assert.deepEqual(body, { name: "auto-stack-homarr", userId: user.id, isActive: true });
      keyEntries = [{ id: "owned-api-key", ...body }];
      if (loseKeyResponse) return new Response(null, { status: 500 });
      return Response.json({ apiKey: { ...keyEntries[0], apiKey: durableKey } });
    }
    throw new Error(`Unexpected Audiobookshelf fixture request: ${request.method} ${path}`);
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
    async readStatus() { return status; },
    async readHandoff() { throw new Error("Unexpected handoff"); },
    async approve(action, token) { reviewed.push({ action, token }); return approvals.has(token); },
    approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
  const context = { ...facilities, appId, projectRoot: root, inputs: {}, installedAppIds: [appId],
    async status() { return status; } } as unknown as SetupContext;
  async function runSetup() {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await audiobookshelf.firstRun(context); }
      catch (error) {
        const step = reviewed.at(-1);
        if (!(error instanceof SetupTransportDeferred) || step?.action !== "audiobookshelf-verify-root-login") throw error;
        approvals.add(step.token);
      }
    }
    throw new Error("Audiobookshelf fixture exceeded its login approval sequence");
  }
  async function defer(action: string): Promise<string> {
    if (action === "audiobookshelf-create-api-key") await assert.rejects(runSetup(), SetupTransportDeferred);
    else await assert.rejects(audiobookshelf.firstRun(context), SetupTransportDeferred);
    assert.equal(reviewed.at(-1)?.action, action);
    return reviewed.at(-1)!.token;
  }

  approvals.add(await defer("audiobookshelf-create-root"));
  approvals.add(await defer("audiobookshelf-verify-root-login"));
  sessionStatus = 500;
  await assert.rejects(audiobookshelf.firstRun(context), /owner readback failed/);
  assert.equal(logins, 1);
  assert.equal((await facilities.secrets.readSessionCookies()).bearer, activeBearer,
    "Capture the issued login session before uncertain first owner readback");
  retainedBearer = activeBearer;
  sessionStatus = 200;
  const keyApproval = await defer("audiobookshelf-create-api-key");
  assert.equal(logins, 2);
  assert.equal(creations, 0);
  assert.equal((await facilities.checkpoint.read())?.stage, "root-login-verified");
  assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
  assert.equal(await defer("audiobookshelf-create-api-key"), keyApproval);
  assert.equal(logins, 3, "Deferred key review freshly verifies the saved password");
  assert.equal((await facilities.secrets.readSessionCookies()).bearer, retainedBearer);
  loginStatus = 401;
  await assert.rejects(audiobookshelf.firstRun(context), /root login failed/);
  assert.equal((await facilities.secrets.readSessionCookies()).bearer, retainedBearer);
  assert.equal(creations, 0, "A rejected saved password cannot create a key");
  loginStatus = 200;
  loginOwnerId = "different-root";
  await assert.rejects(audiobookshelf.firstRun(context), /retained root identity/);
  assert.equal((await facilities.secrets.readSessionCookies()).bearer, retainedBearer);
  assert.equal(creations, 0);
  loginOwnerId = user.id;
  freshSessionStatus = 401;
  await assert.rejects(audiobookshelf.firstRun(context), /new approved login/);
  assert.equal((await facilities.secrets.readSessionCookies()).bearer, retainedBearer,
    "Rejected fresh session must not erase the bearer bound to the reviewed key write");
  assert.equal(creations, 0);
  freshSessionStatus = 200;
  approvals.add(keyApproval);
  const interrupted = await runSetup();
  assert.equal(audiobookshelf.ready(interrupted), true);
  assert.equal(audiobookshelf.compatibilityResult!(interrupted), null,
    "Completing previously interrupted initialization/key work proves neither fresh nor resume origin");
  assert.equal(await facilities.secrets.readApiKey(), durableKey);
  assert.deepEqual(createdAuthorizations, ["Bearer session.body1.signature"]);
  const resumed = await runSetup();
  assert.equal(audiobookshelf.ready(resumed), true);
  assert.equal(audiobookshelf.compatibilityResult!({ ...resumed }), null);
  assert.deepEqual(audiobookshelf.compatibilityResult!(resumed), { origin: "resume", credentialReadback: "verified" });
  assert.equal(creations, 1);
  assert.equal(logins, 7);

  sessionStatus = 500;
  await assert.rejects(audiobookshelf.firstRun(context), /owner readback failed/);
  assert.equal((await facilities.secrets.readSessionCookies()).bearer, retainedBearer);
  sessionStatus = 403;
  await assert.rejects(audiobookshelf.firstRun(context), /owner readback failed/);
  assert.equal((await facilities.secrets.readSessionCookies()).bearer, retainedBearer);
  sessionStatus = 401;
  await assert.rejects(audiobookshelf.firstRun(context), /new approved login/);
  assert.deepEqual(Object.keys(await facilities.secrets.readSessionCookies()), []);
  assert.equal(logins, 7);
  sessionStatus = 200;
  for (const step of reviewed) {
    if (step.action === "audiobookshelf-verify-root-login") approvals.delete(step.token);
  }
  approvals.add(await defer("audiobookshelf-verify-root-login"));
  assert.equal(audiobookshelf.ready(await runSetup()), true);
  assert.equal(logins, 8);
  assert.equal(creations, 1);

  // Fully approved untouched-owner setup must witness creation and credential
  // readbacks in one invocation; deferred/uncertain attempts above cannot substitute.
  const freshRoot = await mkdtemp(join(tmpdir(), "selfhost-audiobookshelf-fresh-"));
  try {
    const freshProject = join(freshRoot, ".selfhost", "shared", projectId);
    const freshFiles = join(freshProject, "secrets", appId);
    await mkdir(freshFiles, { recursive: true, mode: 0o700 });
    await writeFile(join(freshFiles, "admin-password"), password, { mode: 0o600 });
    initialized = false; keyEntries = [];
    const freshStatus = { ...status, projectRoot: freshRoot, privateFiles: freshFiles,
      passwordFile: join(freshFiles, "admin-password"),
      composeTarget: join(freshProject, "compose.aaaaaaaaaaaaaaaa.yaml") };
    const freshFacilities = createSetupTransportFacilities({ appId, projectRoot: freshRoot,
      async readStatus() { return freshStatus; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve() { return true; }, approvalQueue: { tail: Promise.resolve() },
      registerSecret() {}, redact(value) { return value; } });
    const freshContext = { ...freshFacilities, appId, projectRoot: freshRoot, inputs: {},
      installedAppIds: [appId], async status() { return freshStatus; } } as unknown as SetupContext;
    const fresh = await audiobookshelf.firstRun(freshContext);
    assert.equal(audiobookshelf.ready(fresh), true);
    assert.equal(audiobookshelf.compatibilityResult!({ ...fresh }), null);
    assert.deepEqual(audiobookshelf.compatibilityResult!(fresh), { origin: "fresh", credentialReadback: "verified" });
    const replay = await audiobookshelf.firstRun(freshContext);
    assert.deepEqual(audiobookshelf.compatibilityResult!(replay), { origin: "resume", credentialReadback: "verified" });
  } finally { await rm(freshRoot, { recursive: true }); }

  // Use a different exact owner with a response lost after the key is created.
  // Reusing the adapter's real transport still must not repeat that POST.
  const lossRoot = await mkdtemp(join(tmpdir(), "selfhost-audiobookshelf-loss-"));
  try {
    const lossProject = join(lossRoot, ".selfhost", "shared", projectId);
    const lossFiles = join(lossProject, "secrets", appId);
    await mkdir(lossFiles, { recursive: true, mode: 0o700 });
    await writeFile(join(lossFiles, "admin-password"), password, { mode: 0o600 });
    initialized = false; keyEntries = []; loseKeyResponse = true;
    const lossStatus = { ...status, projectRoot: lossRoot, privateFiles: lossFiles,
      passwordFile: join(lossFiles, "admin-password"),
      composeTarget: join(lossProject, "compose.aaaaaaaaaaaaaaaa.yaml") };
    const lossFacilities = createSetupTransportFacilities({ appId, projectRoot: lossRoot,
      async readStatus() { return lossStatus; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve() { return true; }, approvalQueue: { tail: Promise.resolve() },
      registerSecret() {}, redact(value) { return value; } });
    const lossContext = { ...lossFacilities, appId, projectRoot: lossRoot, inputs: {},
      installedAppIds: [appId], async status() { return lossStatus; } } as unknown as SetupContext;
    await assert.rejects(audiobookshelf.firstRun(lossContext), /creation is uncertain/);
    const attemptedCreations = creations;
    await assert.rejects(audiobookshelf.firstRun(lossContext), /without a captured secret/);
    assert.equal(creations, attemptedCreations);
  } finally { await rm(lossRoot, { recursive: true }); }
} finally {
  server.stop(true);
  await rm(root, { recursive: true });
}
console.log("Audiobookshelf real transport: deferred approval, private session reuse, replay and lost-key no-repeat passed");
