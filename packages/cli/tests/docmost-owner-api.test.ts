#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docmostCommand } from "../src/docmost.ts";
import { docmostBrowserPassword } from "../src/docmost-browser.ts";
import sharedDocmost from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/docmost/setup.ts";
import type { SetupCheckpoint, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities, SetupTransportDeferred } from "../src/control-panel/setup-transport.ts";

async function sharedPasswordProof(projectRoot: string): Promise<void> {
  const password = "p".repeat(48);
  const userId = "11111111-1111-4111-8111-111111111111";
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  let session: Record<string, string> = { authToken: "retained-cookie", password_digest: createHash("sha256").update(password).digest("hex") };
  let checkpoint: SetupCheckpoint = { schemaVersion: 1, appId: "docmost", projectRoot, revision: 1,
    stage: "owner-login-verified", attemptedActions: ["docmost-first-owner"], data: { userId, workspaceId } };
  let loginStatus = 200;
  let freshStatus = 200;
  let freshUserId = userId;
  let freshWorkspaceId = workspaceId;
  let deferFresh = true;
  let logins = 0;
  const retainedRequests: string[] = [];
  const context = { appId: "docmost", projectRoot,
    async status() { return { command: "app status", appId: "docmost", projectRoot,
      status: "applied", mutation: false, runtime: { state: "running" } }; },
    secrets: { async readAdminPassword() { return password; },
      async readSessionCookies() { return { ...session }; },
      async writeSessionCookies(value) { session = value; } },
    checkpoint: { async read() { return checkpoint; }, async compareAndSet(update) {
      assert.equal(update.expectedRevision, checkpoint.revision);
      checkpoint = { ...checkpoint, revision: checkpoint.revision + 1, stage: update.stage, data: update.data ?? {} };
      return checkpoint;
    } },
    http: { async request(request) {
      if (request.path === "/api/auth/login") {
        assert.equal(request.approval?.action, "docmost-prove-login");
        assert.deepEqual(JSON.parse(String(request.body)), { email: "admin@example.test", password });
        logins++;
        return new Response(JSON.stringify({ success: true, status: 200 }), { status: loginStatus,
          headers: { "set-cookie": `authToken=fresh-cookie-${logins}; HttpOnly; Path=/` } });
      }
      assert.equal(request.path, "/api/users/me", "Resume never replays first-owner setup");
      const retained = request.headers?.Cookie === "authToken=retained-cookie";
      let action = "docmost-read-owner-identity";
      if (!retained) action = "docmost-read-fresh-owner-identity";
      assert.equal(request.approval?.action, action);
      if (retained) retainedRequests.push(JSON.stringify(request));
      if (!retained && deferFresh) throw new Error("approval deferred");
      let id = userId;
      let workspace = workspaceId;
      if (!retained) { id = freshUserId; workspace = freshWorkspaceId; }
      return Response.json({ success: true, status: 200, data: {
        user: { id, workspaceId: workspace, email: "admin@example.test", role: "owner" },
        workspace: { id: workspace } } }, { status: retained ? 200 : freshStatus });
    } },
  } as unknown as SetupContext;
  const originalSession = { ...session };
  await assert.rejects(sharedDocmost.firstRun(context), /approval deferred/);
  await assert.rejects(sharedDocmost.firstRun(context), /approval deferred/);
  assert.equal(logins, 1, "Deferred fresh identity proof must retain its exact issued cookie");
  assert.equal(retainedRequests[0], retainedRequests[1]);
  assert.equal(session.authToken, originalSession.authToken);
  assert.equal(session.pending_authToken, "fresh-cookie-1");
  deferFresh = false;
  assert.equal(sharedDocmost.ready(await sharedDocmost.firstRun(context)), true);
  assert.deepEqual(session, originalSession);
  loginStatus = 401;
  await assert.rejects(sharedDocmost.firstRun(context), /first-owner credential/);
  assert.deepEqual(session, originalSession);
  loginStatus = 200;
  freshStatus = 401;
  await assert.rejects(sharedDocmost.firstRun(context), /saved session expired/);
  assert.deepEqual(session, originalSession, "Fresh rejection must not erase the retained session");
  freshStatus = 503;
  await assert.rejects(sharedDocmost.firstRun(context), /owner identity readback failed/);
  const uncertainSession = { ...session };
  assert.ok(uncertainSession.pending_authToken);
  await assert.rejects(sharedDocmost.firstRun(context), /owner identity readback failed/);
  assert.deepEqual(session, uncertainSession, "Uncertain fresh readback must retain its exact pending cookie");
  freshStatus = 200;
  assert.equal(sharedDocmost.ready(await sharedDocmost.firstRun(context)), true);
  assert.deepEqual(session, originalSession);
  freshUserId = "33333333-3333-4333-8333-333333333333";
  await assert.rejects(sharedDocmost.firstRun(context), /retained owner or workspace/);
  freshUserId = userId;
  freshWorkspaceId = "44444444-4444-4444-8444-444444444444";
  await assert.rejects(sharedDocmost.firstRun(context), /retained owner or workspace/);
  assert.deepEqual(session, originalSession);
  freshWorkspaceId = workspaceId;
  assert.equal(sharedDocmost.ready(await sharedDocmost.firstRun(context)), true);
  assert.deepEqual(session, originalSession);

  // Exercise the production Cookie-bound approval hashes and the panel's
  // one-current-token-per-action behavior, not just the adapter's mock requests.
  const mockHttp = context.http;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const cookie = request.headers.get("cookie");
    let action = "docmost-prove-login";
    if (path === "/api/users/me") {
      action = "docmost-read-fresh-owner-identity";
      if (cookie === "authToken=retained-cookie") action = "docmost-read-owner-identity";
    }
    return await mockHttp.request({ method: "POST", path, body: await request.text(),
      headers: { Cookie: cookie ?? "" }, approval: { action, progress: "Synthetic exact request" } }) as unknown as Response;
  } });
  try {
    const projectId = "docmost_fixture";
    const privateFiles = join(projectRoot, ".selfhost", "shared", projectId, "secrets", "docmost");
    await mkdir(privateFiles, { recursive: true, mode: 0o700 });
    const passwordFile = join(privateFiles, "admin-password");
    await writeFile(passwordFile, password, { mode: 0o600 });
    const status = { command: "app status", appId: "docmost", projectRoot, ownerKind: "shared",
      status: "applied", mutation: false, runtime: { state: "running" }, privateFiles, passwordFile,
      username: "admin@example.test", projectId, dockerContext: "default", port: server.port,
      url: `http://127.0.0.1:${server.port}`, ownerRevision: 1, manifestHash: "a".repeat(64),
      composeTarget: join(projectRoot, ".selfhost", "shared", projectId, "compose.aaaaaaaaaaaaaaaa.yaml"),
      applyApproval: `SHARED-APPLY:${projectId}:${"b".repeat(64)}` };
    const approved = new Map<string, string>();
    let latest: { action: string; token: string } | undefined;
    const facilities = createSetupTransportFacilities({ appId: "docmost", projectRoot,
      async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve(action, token) { latest = { action, token }; return approved.get(action) === token; },
      approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
    context.http = facilities.http;
    context.status = async () => status;
    const priorLogins = logins;
    let ready = false;
    for (let step = 0; step < 8; step++) {
      try { ready = sharedDocmost.ready(await sharedDocmost.firstRun(context)); break; }
      catch (error) {
        if (!(error instanceof SetupTransportDeferred)) throw error;
        assert.ok(latest);
        approved.set(latest.action, latest.token);
      }
    }
    assert.equal(ready, true, "Retained/fresh identity approvals must converge independently");
    assert.equal(logins, priorLogins + 1, "Deferred identity uses the exact pending fresh cookie");
    assert.ok(approved.has("docmost-read-owner-identity"));
    assert.ok(approved.has("docmost-read-fresh-owner-identity"));
    assert.deepEqual(session, originalSession);
  } finally { server.stop(true); }
}

async function capture(action: () => Promise<void>): Promise<Record<string, any>> {
  const prior = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
    return JSON.parse(output);
  } finally {
    process.stdout.write = prior;
  }
}

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

const root = await mkdtemp(join(tmpdir(), "selfhost-docmost-owner-api-"));
const exportDirectory = await mkdtemp(join(tmpdir(), "selfhost-docmost-export-"));
try {
  await sharedPasswordProof(root);
  await chmod(root, 0o700);
  await chmod(exportDirectory, 0o700);
  const projectId = "docmost-owner-fixture";
  const runId = "initial";
  const inputPath = join(root, "docmost-input.json");
  const accountPath = join(root, "docmost-account.json");
  const digest = "a".repeat(64);
  const input = {
    schemaVersion: 1,
    project: {
      dockerContext: "default",
      id: projectId,
      owner: projectId,
      root,
      directory: join(root, projectId),
      ownership: "new",
    },
    observed: {
      checkedAt: "2026-09-25T10:00:00Z",
      project: null,
      ports: [],
      paths: [],
      networks: [],
    },
    images: {
      docmost: `docker.io/docmost/docmost:0.96.0@sha256:${digest}`,
      postgres: `docker.io/library/postgres:18.6@sha256:${digest}`,
      redis: `docker.io/library/redis:8.10.2@sha256:${digest}`,
    },
    hostIp: "127.0.0.1",
    publishedPort: 31333,
  };
  const account = { schemaVersion: 1, username: "admin", email: "admin@example.com", name: "Admin" };
  await privateJson(inputPath, input);
  await privateJson(accountPath, account);
  const common = ["--project-root", root, "--input", inputPath, "--run-id", runId, "--account-file", accountPath];

  const composePlan = await capture(() => docmostCommand(["plan", ...common]));
  await capture(() => docmostCommand(["apply", ...common, "--approve", composePlan.approval], {
    composeApply: async () => {},
    healthAfterApply: async () => true,
  }));

  const ownerPlan = await capture(() => docmostCommand(["owner", "plan", ...common]));
  assert.match(ownerPlan.approval, new RegExp(`^OWNER:${projectId}:[0-9a-f]{64}$`));
  assert.equal(ownerPlan.mutation, false);
  assert.equal(ownerPlan.experimental, true);
  const ownerStatePath = join(root, ".selfhost", "docmost", runId, "owner-state.json");
  assert.equal(existsSync(ownerStatePath), false);
  const handoffPath = join(root, ".selfhost", "docmost", runId, "private-handoff.json");
  const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  assert.doesNotMatch(JSON.stringify(ownerPlan), new RegExp(handoff.password));

  const browserBinary = join(root, "fixture-browser");
  const browserLink = join(root, "fixture-browser-link");
  await writeFile(browserBinary, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await chmod(browserBinary, 0o755);
  await symlink(browserBinary, browserLink);
  const browserArgs = ["--project-root", root, "--run-id", runId, "--ref", "@e1", "--browser-bin", browserLink];
  const browserCalls: Array<{ executable: string; args: string[]; input: unknown }> = [];
  let envelopeError: unknown;
  let browserStatus = 0;
  const browserSpawn = ((executable: string, args: string[], options: { input?: unknown }) => {
    browserCalls.push({ executable, args, input: options.input });
    let stdout = `${handoff.url}/login`;
    if (args.includes("attr")) {
      let value: string | null = null;
      if (args[args.indexOf("attr") + 2] === "type") value = "password";
      stdout = JSON.stringify({ success: true, error: envelopeError, data: { value } });
    }
    if (args.includes("enabled")) stdout = JSON.stringify({ success: true, error: envelopeError, data: { enabled: true } });
    return { pid: 0, output: [], stdout, stderr: "", status: browserStatus, signal: null };
  }) as typeof import("node:child_process").spawnSync;
  const originalWrite = process.stdout.write;
  let browserOutput = "";
  process.stdout.write = ((chunk: string | Uint8Array) => { browserOutput += chunk.toString(); return true; }) as typeof process.stdout.write;
  try {
    for (const optionalError of [undefined, null]) {
      envelopeError = optionalError;
      browserCalls.length = 0;
      await docmostBrowserPassword(browserArgs, { spawnSyncImplementation: browserSpawn });
      assert.equal(browserCalls.length, 6);
      assert.equal(browserCalls.every((call) => call.executable === browserBinary && !call.args.includes(handoff.password)), true);
      assert.equal(browserCalls.slice(0, -1).every((call) => call.input === undefined), true);
      assert.deepEqual(JSON.parse(String(browserCalls.at(-1)?.input)), [["fill", "@e1", handoff.password]]);
    }
    for (const invalidError of [false, "fixture-error"]) {
      envelopeError = invalidError;
      browserCalls.length = 0;
      await assert.rejects(docmostBrowserPassword(browserArgs, { spawnSyncImplementation: browserSpawn }), /field inspection failed/);
      assert.equal(browserCalls.some((call) => call.args.includes("batch")), false);
    }
    envelopeError = undefined;
    browserCalls.length = 0;
    await docmostBrowserPassword(browserArgs.slice(0, -2), { spawnSyncImplementation: browserSpawn });
    assert.equal(browserCalls.every((call) => call.executable === "agent-browser"), true);
    browserStatus = 1;
    browserCalls.length = 0;
    await assert.rejects(docmostBrowserPassword(browserArgs, { spawnSyncImplementation: browserSpawn }), /browser-password failed/);
    assert.equal(browserCalls.length, 1);
    await assert.rejects(docmostBrowserPassword([...browserArgs.slice(0, -2), "--browser-bin", "relative-browser"]), /absolute executable path/);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.doesNotMatch(browserOutput, new RegExp(handoff.password));

  let requestCount = 0;
  const firstFetch = async (url: string, init: RequestInit): Promise<Response> => {
    requestCount += 1;
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(String(init.body));
    assert.equal(body.password, handoff.password);
    assert.equal(process.argv.includes(handoff.password), false);
    assert.equal(Object.values(process.env).includes(handoff.password), false);
    if (url.endsWith("/api/auth/setup")) {
      return new Response(JSON.stringify({
        data: { id: "11111111-1111-4111-8111-111111111111", name: "Admin's workspace", defaultSpaceId: "22222222-2222-4222-8222-222222222222" },
        success: true,
        status: 200,
      }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "authToken=setup-cookie; HttpOnly; SameSite=Lax; Path=/" } });
    }
    assert.equal(url.endsWith("/api/auth/login"), true);
    return new Response(JSON.stringify({ success: true, status: 200 }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": "authToken=login-cookie; HttpOnly; SameSite=Lax; Path=/" },
    });
  };
  await assert.rejects(
    capture(() => docmostCommand(["owner", "apply", ...common, "--approve", `${ownerPlan.approval}0`],
      { ownerFetch: firstFetch, health: async () => true })),
    /exact approval token/,
  );
  assert.equal(requestCount, 0);
  await assert.rejects(
    capture(() => docmostCommand(["owner", "apply", ...common, "--approve", ownerPlan.approval],
      { ownerFetch: firstFetch, health: async () => false })),
    /needs the selected loopback service to be healthy now/,
  );
  assert.equal(requestCount, 0);
  const applied = await capture(() => docmostCommand(
    ["owner", "apply", ...common, "--approve", ownerPlan.approval],
    { ownerFetch: firstFetch, health: async () => true }));
  assert.equal(applied.result, "setup-created");
  assert.equal(applied.freshLogin, true);
  assert.equal(requestCount, 2);
  assert.doesNotMatch(JSON.stringify(applied), /setup-cookie|login-cookie/);

  const ownerStateText = await readFile(ownerStatePath, "utf8");
  const ownerState = JSON.parse(ownerStateText);
  assert.equal((await lstat(ownerStatePath)).mode & 0o777, 0o600);
  assert.equal(ownerState.result, "setup-created");
  assert.equal(ownerState.freshLogin, true);
  assert.doesNotMatch(ownerStateText, new RegExp(handoff.password));
  assert.doesNotMatch(ownerStateText, /setup-cookie|login-cookie/);

  const repeatedPlan = await capture(() => docmostCommand(["owner", "plan", ...common]));
  assert.equal(repeatedPlan.approval, ownerPlan.approval);
  assert.equal(repeatedPlan.alreadyRecorded, true);
  const secondFetch = async (url: string): Promise<Response> => {
    if (url.endsWith("/api/auth/setup")) {
      return new Response(JSON.stringify({ message: "sensitive-upstream-marker" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, {
      status: 200,
      headers: { "set-cookie": "authToken=fresh-login-cookie; HttpOnly; SameSite=Lax; Path=/" },
    });
  };
  const repeated = await capture(() => docmostCommand(
    ["owner", "apply", ...common, "--approve", repeatedPlan.approval],
    { ownerFetch: secondFetch, health: async () => true }));
  assert.equal(repeated.result, "existing-owner-login");
  const repeatedState = await readFile(ownerStatePath, "utf8");
  assert.doesNotMatch(JSON.stringify(repeated), /sensitive-upstream-marker|fresh-login-cookie/);
  assert.doesNotMatch(repeatedState, /sensitive-upstream-marker|fresh-login-cookie/);

  const status = await capture(() => docmostCommand([
    "status", "--project-root", root, "--input", inputPath, "--run-id", runId,
  ], { health: async () => true }));
  assert.equal(status.owner.recorded, true);
  assert.equal(status.ownerSetup, "api-owner-recorded");
  assert.equal(status.acceptance, "not-verified-by-cli");

  const acceptancePlan = await capture(() => docmostCommand(["accept", "plan", ...common]));
  assert.match(acceptancePlan.approval, /^ACCEPT-DOCMOST:docmost-owner-fixture:[a-f0-9]{64}$/);
  assert.equal(acceptancePlan.mutation, false);
  const acceptanceDir = join(root, ".selfhost", "docmost", runId);
  const acceptanceAttempt = join(acceptanceDir, "acceptance-attempt.jsonl");
  assert.equal(existsSync(join(acceptanceDir, "acceptance-plan.json")), false);
  assert.equal(existsSync(acceptanceAttempt), false);
  assert.equal((await capture(() => docmostCommand(["accept", "plan", ...common]))).approval, acceptancePlan.approval);
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const spaceId = "22222222-2222-4222-8222-222222222222";
  const userId = "33333333-3333-4333-8333-333333333333";
  const pageId = "44444444-4444-4444-8444-444444444444";
  const attachmentId = "55555555-5555-4555-8555-555555555555";
  let loginCount = 0;
  let acceptanceRequests = 0;
  let createdPage: Record<string, unknown> = {};
  let uploadedBytes = new Uint8Array();
  let uploadedAttachment: Record<string, unknown> = {};
  let identityMismatch = false;
  let invalidDownload = false;
  let reconciling = false;
  const acceptanceFetch = async (url: string, init: RequestInit): Promise<Response> => {
    acceptanceRequests += 1;
    assert.equal(url.startsWith(`${handoff.url}/api/`), true);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    const ledger = await readFile(acceptanceAttempt, "utf8");
    assert.equal(ledger.endsWith("\n"), true);
    assert.equal((await lstat(acceptanceAttempt)).mode & 0o777, 0o600);
    const lastEvent = JSON.parse(ledger.trim().split("\n").at(-1)!);
    assert.equal(lastEvent.result, reconciling ? "unknown" : "intent");
    const json = (data: unknown) => new Response(JSON.stringify({ data, success: true, status: 200 }), { status: 200 });
    const headers = new Headers(init.headers);
    if (url.endsWith("/api/auth/login")) {
      loginCount += 1;
      assert.equal(headers.has("cookie"), false);
      assert.deepEqual(JSON.parse(String(init.body)), { email: account.email, password: handoff.password });
      return new Response(null, { status: 200, headers: { "set-cookie": `authToken=accept-cookie-${loginCount}; HttpOnly; Path=/` } });
    }
    assert.equal(headers.get("cookie"), `authToken=accept-cookie-${loginCount}`);
    if (url.endsWith("/api/users/me")) {
      assert.equal(init.method, "POST");
      assert.equal(String(init.body), "{}");
      return json({ user: { id: userId, email: identityMismatch ? "other@example.com" : account.email, workspaceId }, workspace: { id: workspaceId } });
    }
    if (url.endsWith("/api/pages/create")) {
      assert.equal(reconciling, false);
      assert.equal(lastEvent.stage, "create-page");
      const body = JSON.parse(String(init.body));
      assert.equal(body.spaceId, spaceId);
      assert.equal(body.format, "json");
      assert.equal(body.parentPageId, undefined);
      createdPage = { ...body, id: pageId, workspaceId, creatorId: userId };
      return json(createdPage);
    }
    if (url.endsWith("/api/pages/update")) {
      assert.equal(reconciling, false);
      assert.equal(lastEvent.stage, "edit-page");
      assert.equal(lastEvent.pageId, pageId);
      const body = JSON.parse(String(init.body));
      assert.equal(body.pageId, pageId);
      assert.equal(body.operation, "replace");
      assert.equal(body.format, "json");
      createdPage.content = body.content;
      return json(createdPage);
    }
    if (url.endsWith("/api/files/upload")) {
      assert.equal(reconciling, false);
      assert.equal(lastEvent.stage, "upload-file");
      assert.equal(init.body instanceof FormData, true);
      const form = init.body as FormData;
      assert.deepEqual([...form.keys()], ["pageId", "file"]);
      assert.equal(form.get("pageId"), pageId);
      const file = form.get("file") as File;
      uploadedBytes = new Uint8Array(await file.arrayBuffer());
      uploadedAttachment = { id: attachmentId, pageId, spaceId, workspaceId, creatorId: userId, type: "file",
        fileName: file.name, mimeType: "text/plain; charset=utf-8", fileExt: ".txt", fileSize: file.size,
        url: "https://unapproved.example/never-follow-this" };
      return new Response(JSON.stringify(uploadedAttachment), { status: 200 });
    }
    assert.equal(loginCount, reconciling ? 1 : 2);
    if (url.endsWith("/api/pages/attachments")) {
      assert.deepEqual(JSON.parse(String(init.body)), { pageId, limit: 20, query: uploadedAttachment.fileName });
      return json({ items: [uploadedAttachment], meta: { hasNextPage: false, nextCursor: null } });
    }
    if (url.endsWith("/api/pages/info")) {
      const content = structuredClone(createdPage.content) as { content: Array<{ attrs?: unknown }> };
      content.content[0].attrs = { id: "server-paragraph-id", textAlign: null, indent: 0, dir: "auto" };
      return json({ ...createdPage, content });
    }
    if (url.endsWith("/api/files/info")) return json(uploadedAttachment);
    assert.equal(init.method, "GET");
    assert.equal(url, `${handoff.url}/api/files/${attachmentId}/${encodeURIComponent(String(uploadedAttachment.fileName))}`);
    let bytes = uploadedBytes;
    if (invalidDownload) bytes = new Uint8Array(uploadedBytes.length).fill(1);
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
  };
  await assert.rejects(capture(() => docmostCommand(["accept", "apply", ...common, "--approve", `${acceptancePlan.approval}0`],
    { ownerFetch: acceptanceFetch, health: async () => true })), /exact approval token/);
  assert.equal(acceptanceRequests, 0);
  assert.equal(existsSync(acceptanceAttempt), false);
  const accepted = await capture(() => docmostCommand(["accept", "apply", ...common, "--approve", acceptancePlan.approval],
    { ownerFetch: acceptanceFetch, health: async () => true }));
  assert.equal(accepted.status, "accepted", `Acceptance failed at ${accepted.stage}`);
  assert.equal(accepted.pageId, pageId);
  assert.equal(accepted.attachmentId, attachmentId);
  assert.equal(loginCount, 2);
  assert.equal(accepted.synthetic.disposition, "retained-for-inspection");
  assert.doesNotMatch(JSON.stringify(accepted), /accept-cookie|unapproved\.example/);
  const acceptanceStatusArgs = ["accept", "status", "--project-root", root, "--input", inputPath, "--run-id", runId];
  const acceptedStatus = await capture(() => docmostCommand(acceptanceStatusArgs));
  assert.equal(acceptedStatus.status, "accepted");
  assert.equal(acceptedStatus.replayAllowed, false);
  const requestsBeforeReplay = acceptanceRequests;
  await assert.rejects(capture(() => docmostCommand(["accept", "apply", ...common, "--approve", acceptancePlan.approval],
    { ownerFetch: acceptanceFetch, health: async () => true })), /already consumed/);
  assert.equal(acceptanceRequests, requestsBeforeReplay);
  const acceptedLedger = await readFile(acceptanceAttempt, "utf8");
  assert.doesNotMatch(acceptedLedger, new RegExp(handoff.password));
  assert.doesNotMatch(acceptedLedger, /accept-cookie/);
  const firstRecord = acceptedLedger.split("\n")[0];
  const forgedAccepted = { ...JSON.parse(firstRecord), stage: "accepted", result: "completed" };
  await writeFile(acceptanceAttempt, `${firstRecord}\n${JSON.stringify(forgedAccepted)}\n`, { mode: 0o600 });
  await assert.rejects(capture(() => docmostCommand(acceptanceStatusArgs)), /transition is invalid/);
  const successRecords = acceptedLedger.trim().split("\n").map((line) => JSON.parse(line));
  successRecords.at(-1).attachmentId = null;
  await writeFile(acceptanceAttempt, `${successRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
  await assert.rejects(capture(() => docmostCommand(acceptanceStatusArgs)), /sequence is invalid/);
  await writeFile(acceptanceAttempt, `${acceptedLedger}{"stage":`, { mode: 0o600 });
  const tornStatus = await capture(() => docmostCommand(acceptanceStatusArgs));
  assert.equal(tornStatus.status, "unknown-no-replay");
  assert.equal(tornStatus.interruptedTail, true);
  assert.equal(tornStatus.pageId, pageId);
  assert.equal(tornStatus.attachmentId, attachmentId);
  await writeFile(acceptanceAttempt, `${acceptedLedger}not-json\n`, { mode: 0o600 });
  await assert.rejects(capture(() => docmostCommand(acceptanceStatusArgs)), /malformed complete record/);
  await rm(acceptanceAttempt); // Fixture-only new isolated scenario; production never resets an attempt.
  loginCount = 0;
  identityMismatch = true;
  const rejectedIdentity = await capture(() => docmostCommand(["accept", "apply", ...common, "--approve", acceptancePlan.approval],
    { ownerFetch: acceptanceFetch, health: async () => true }));
  assert.equal(rejectedIdentity.status, "unknown-no-replay");
  assert.equal(rejectedIdentity.stage, "write-identity");
  assert.equal(rejectedIdentity.pageId, null);
  process.exitCode = 0;
  await rm(acceptanceAttempt);
  loginCount = 0;
  identityMismatch = false;
  invalidDownload = true;
  const badHash = await capture(() => docmostCommand(["accept", "apply", ...common, "--approve", acceptancePlan.approval],
    { ownerFetch: acceptanceFetch, health: async () => true }));
  assert.equal(badHash.status, "unknown-no-replay");
  assert.equal(badHash.stage, "download-file");
  process.exitCode = 0;
  assert.equal((await capture(() => docmostCommand(acceptanceStatusArgs))).lastDurableStage, "download-file");

  // Preserve and reconcile the original v1 unknown-upload contract without replaying a mutation.
  const hashJson = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const legacyContract = "9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af:accept-v1";
  const legacyNonce = hashJson({ factsDigest: acceptancePlan.factsDigest, contract: legacyContract }).slice(0, 24);
  const content = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const legacyBytes = Buffer.from(`Self-host Docmost attachment acceptance ${legacyNonce}\n`);
  const legacySynthetic = { title: `Self-host acceptance ${legacyNonce}`, fileName: `selfhost-acceptance-${legacyNonce}.txt`,
    initialHash: hashJson(content(`Initial acceptance ${legacyNonce}`)), editedHash: hashJson(content(`Edited acceptance ${legacyNonce}`)),
    byteHash: createHash("sha256").update(legacyBytes).digest("hex"), byteLength: legacyBytes.length,
    disposition: "retained-for-inspection" };
  const legacyDigest = hashJson({ schemaVersion: 1, kind: acceptancePlan.kind, project: projectId, runId,
    origin: handoff.url, contract: legacyContract, nonce: legacyNonce, factsDigest: acceptancePlan.factsDigest,
    workspaceId, spaceId, synthetic: legacySynthetic });
  const legacyRecords = acceptedLedger.trim().split("\n").map((line) => JSON.parse(line)).slice(0, 10);
  for (const record of legacyRecords) record.digest = legacyDigest;
  legacyRecords.push({ ...legacyRecords.at(-1), result: "unknown" });
  const legacyLedger = `${legacyRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await writeFile(acceptanceAttempt, legacyLedger, { mode: 0o600 });
  createdPage.title = legacySynthetic.title;
  createdPage.content = content(`Edited acceptance ${legacyNonce}`);
  uploadedAttachment.fileName = legacySynthetic.fileName;
  uploadedBytes = legacyBytes;
  invalidDownload = false;
  reconciling = true;
  loginCount = 0;
  const oldStatus = await capture(() => docmostCommand(acceptanceStatusArgs));
  assert.equal(oldStatus.approval, `ACCEPT-DOCMOST:${projectId}:${legacyDigest}`);
  assert.equal(oldStatus.synthetic.fileName, legacySynthetic.fileName);
  const reconciled = await capture(() => docmostCommand(["accept", "verify", ...common], { ownerFetch: acceptanceFetch, health: async () => true }));
  assert.equal(reconciled.status, "verified-readback", `Readback failed at ${reconciled.stage}`);
  assert.equal(reconciled.applicationWrites, false);
  assert.equal(reconciled.localEvidenceWritten, true);
  assert.equal(reconciled.attachmentId, attachmentId);
  assert.equal(await readFile(acceptanceAttempt, "utf8"), legacyLedger);
  const verifiedStatus = await capture(() => docmostCommand(acceptanceStatusArgs));
  assert.equal(verifiedStatus.status, "verified-readback");
  assert.equal(verifiedStatus.lastDurableStage, "upload-file");
  assert.equal(verifiedStatus.replayAllowed, false);
  assert.equal(verifiedStatus.attachmentId, attachmentId);
  const requestsBeforeVerifyReplay = acceptanceRequests;
  await capture(() => docmostCommand(["accept", "verify", ...common], { ownerFetch: acceptanceFetch, health: async () => true }));
  assert.equal(acceptanceRequests, requestsBeforeVerifyReplay);

  // The production export dispatch reads only owner metadata, consumes an intent
  // before one native dump, and verifies a private exclusive publication.
  const dbContainer = "b".repeat(64);
  const dbImage = `sha256:${"c".repeat(64)}`;
  const composeState = JSON.parse(await readFile(join(root, ".selfhost", "docmost", runId, "state.json"), "utf8"));
  let dumpCalls = 0;
  let foreignIdentity = false;
  const exportRuntime = {
    inspect: async (argv: string[]) => {
      assert.deepEqual(argv.slice(0, 2), ["--context", "default"]);
      if (argv[2] === "image") return `${dbImage}\n`;
      if (argv[3] === "ls") {
        assert.ok(argv.includes("label=com.docker.compose.service=database"));
        return `${dbContainer}\n`;
      }
      const format = argv[5];
      assert.doesNotMatch(format, /json \.Config\.Labels|json \.Mounts|Config\.Env/);
      return JSON.stringify({ id: dbContainer, image: dbImage, sourceImage: input.images.postgres,
        project: projectId, service: "database", configFile: composeState.composeFile, directory: input.project.directory,
        oneoff: "False", running: true, health: "healthy", mounts: [
          { Type: "bind", Source: join(input.project.directory, "data", "database"), Destination: "/var/lib/postgresql", RW: true },
          { Type: "bind", Source: join(input.project.directory, "secrets", "docmost-database-password"), Destination: "/run/secrets/docmost_db_password", RW: false },
        ], ...foreignIdentity && { project: "foreign" } });
    },
    dump: async (argv: string[], consume: (bytes: Uint8Array) => Promise<void>) => {
      dumpCalls += 1;
      assert.deepEqual(argv, ["--context", "default", "exec", "--user", "postgres", dbContainer,
        "timeout", "--signal=TERM", "--kill-after=5s", "120s", "pg_dump",
        "--format=custom", "--no-password", "--host=/var/run/postgresql", "--port=5432", "--username=docmost", "--dbname=docmost"]);
      assert.equal(existsSync(`${exportOutput}.intent.json`), true);
      assert.equal((await lstat(`${exportOutput}.intent.json`)).mode & 0o777, 0o600);
      await consume(Buffer.from("PG")); await consume(Buffer.from("DMP synthetic native archive fixture"));
    },
  };
  let exportOutput = join(exportDirectory, "docmost.dump");
  const exportArgs = () => [...common, "--destination", exportDirectory, "--output", exportOutput];
  const dbPlan = await capture(() => docmostCommand(["db-export", "plan", ...exportArgs()], { dbExport: exportRuntime }));
  assert.equal(dbPlan.mutation, false);
  assert.equal(dbPlan.singleDatabaseSnapshot, false);
  assert.equal(dbPlan.timeoutMs, 120_000);
  assert.equal(dbPlan.killAfterMs, 5_000);
  assert.equal(dbPlan.hostWatchdogMs, 130_000);
  assert.equal(existsSync(`${exportOutput}.intent.json`), false);
  await assert.rejects(capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", "wrong"], { dbExport: exportRuntime })), /exact fresh approval/);
  assert.equal(dumpCalls, 0);
  const exported = await capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", dbPlan.approval], { dbExport: exportRuntime }));
  assert.equal(exported.status, "exported"); assert.equal(exported.singleDatabaseSnapshot, true);
  assert.equal(exported.applicationConsistency, false); assert.equal(exported.restoreVerified, false);
  assert.equal((await lstat(exportOutput)).mode & 0o777, 0o600);
  assert.equal(existsSync(`${exportOutput}.partial`), false);
  assert.equal(exported.sha256, createHash("sha256").update(await readFile(exportOutput)).digest("hex"));
  assert.equal(dumpCalls, 1);
  const exportStatus = await capture(() => docmostCommand(["db-export", "status", ...exportArgs()], { dbExport: {
    inspect: async () => { throw new Error("Status must not inspect Docker"); },
  } }));
  assert.equal(exportStatus.status, "exported"); assert.equal(exportStatus.replayAllowed, false);
  await assert.rejects(capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", dbPlan.approval], { dbExport: exportRuntime })), /consumed/);
  await writeFile(exportOutput, "tampered", { mode: 0o600 });
  assert.equal((await capture(() => docmostCommand(["db-export", "status", ...exportArgs()]))).status, "unknown-no-replay");
  exportOutput = join(exportDirectory, "failed.dump");
  const failedPlan = await capture(() => docmostCommand(["db-export", "plan", ...exportArgs()], { dbExport: exportRuntime }));
  const failedExport = await capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", failedPlan.approval], {
    dbExport: { ...exportRuntime, dump: async (_argv, consume) => { await consume(Buffer.from("PGDMP")); throw new Error("secret child diagnostic"); } },
  }));
  assert.equal(failedExport.status, "unknown-no-replay"); assert.equal(failedExport.singleDatabaseSnapshot, false);
  assert.equal(process.exitCode, 1); process.exitCode = 0;
  assert.equal(existsSync(exportOutput), false);
  assert.equal((await capture(() => docmostCommand(["db-export", "status", ...exportArgs()]))).status, "unknown-no-replay");
  await assert.rejects(capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", failedPlan.approval], { dbExport: exportRuntime })), /consumed/);
  exportOutput = join(exportDirectory, "foreign.dump"); foreignIdentity = true;
  await assert.rejects(capture(() => docmostCommand(["db-export", "plan", ...exportArgs()], { dbExport: exportRuntime })), /identity/);
  assert.equal(existsSync(`${exportOutput}.intent.json`), false);
  foreignIdentity = false;
  exportOutput = join(exportDirectory, "directory-drift.dump");
  const directoryPlan = await capture(() => docmostCommand(["db-export", "plan", ...exportArgs()], { dbExport: exportRuntime }));
  const movedExportDirectory = `${exportDirectory}-original`;
  await rename(exportDirectory, movedExportDirectory);
  await mkdir(exportDirectory, { mode: 0o700 });
  try {
    await assert.rejects(capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", directoryPlan.approval], { dbExport: exportRuntime })), /exact fresh approval/);
    assert.equal(existsSync(`${exportOutput}.intent.json`), false);
  } finally {
    await rm(exportDirectory, { recursive: true });
    await rename(movedExportDirectory, exportDirectory);
  }
  exportOutput = join(exportDirectory, "staging-replaced.dump");
  const stagingPlan = await capture(() => docmostCommand(["db-export", "plan", ...exportArgs()], { dbExport: exportRuntime }));
  const replaced = await capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", stagingPlan.approval], {
    dbExport: { ...exportRuntime, dump: async (_argv, consume) => {
      await consume(Buffer.from("PGDMP original archive"));
      await rename(`${exportOutput}.partial`, `${exportOutput}.original`);
      await writeFile(`${exportOutput}.partial`, "PGDMP replacement", { mode: 0o600 });
    } },
  }));
  assert.equal(replaced.status, "unknown-no-replay"); assert.equal(replaced.stage, "publish-private-export");
  assert.equal(existsSync(exportOutput), false); process.exitCode = 0;
  exportOutput = join(exportDirectory, "malformed.dump");
  await writeFile(`${exportOutput}.intent.json`, '{"secret":"never expose this', { mode: 0o600 });
  await assert.rejects(capture(() => docmostCommand(["db-export", "status", ...exportArgs()])), /^Error: Invalid export record$/);
  exportOutput = join(exportDirectory, "no-clobber.dump");
  const noClobberPlan = await capture(() => docmostCommand(["db-export", "plan", ...exportArgs()], { dbExport: exportRuntime }));
  const noClobber = await capture(() => docmostCommand(["db-export", "apply", ...exportArgs(), "--approve", noClobberPlan.approval], {
    dbExport: { ...exportRuntime, dump: async (_argv, consume) => {
      await consume(Buffer.from("PGDMP original archive"));
      await writeFile(exportOutput, "existing owner file", { mode: 0o600 });
    } },
  }));
  assert.equal(noClobber.status, "unknown-no-replay");
  assert.equal(await readFile(exportOutput, "utf8"), "existing owner file"); process.exitCode = 0;

  input.hostIp = "192.168.1.10";
  await privateJson(inputPath, input);
  await assert.rejects(
    capture(() => docmostCommand(["owner", "plan", ...common])),
    /restricted to the selected loopback origin/,
  );
  process.stdout.write("PASS Docmost owner API uses exact approval, bounded secret handling, idempotent login, and a redacted checkpoint\n");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(exportDirectory, { recursive: true, force: true });
}
