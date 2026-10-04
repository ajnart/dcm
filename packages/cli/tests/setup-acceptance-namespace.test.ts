import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const root = await mkdtemp(join(tmpdir(), "setup-acceptance-namespace-"));
try {
  const appId = "home-assistant";
  const projectId = "fixture";
  const directory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(directory, "secrets", appId);
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  const passwordFile = join(privateFiles, "admin-password");
  await writeFile(passwordFile, "synthetic-password", { mode: 0o600 });
  const status = { command: "app status", ownerKind: "shared", appId, projectRoot: root,
    mutation: false, status: "applied", runtime: { state: "running" }, projectId, dockerContext: "default",
    port: 18123, url: "http://127.0.0.1:18123", composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64), privateFiles, passwordFile };
  const tokens: string[] = [];
  const common = { appId, projectRoot: root, checkpointNamespace: undefined as "acceptance" | undefined,
    async readStatus() { return status; },
    async readHandoff() { throw new Error("Unexpected private handoff"); },
    async approve(_action: string, token: string) { tokens.push(token); return false; },
    approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value: string) { return value; } };
  const firstRun = createSetupTransportFacilities(common);
  const acceptanceOptions = { ...common, checkpointNamespace: "acceptance" as "acceptance" | undefined };
  const acceptance = createSetupTransportFacilities(acceptanceOptions);
  // Namespace is captured at construction, not a mutable switch during later approval/checkpoint calls.
  common.checkpointNamespace = "acceptance";
  acceptanceOptions.checkpointNamespace = undefined;
  assert.throws(() => createSetupTransportFacilities({ ...common, checkpointNamespace: "first-run" } as any), /namespace is invalid/);

  // Independent pre-namespace HTTP fingerprint: adding this feature cannot change default approvals.
  const http = { method: "POST" as const, path: "/fixture", body: "{}",
    headers: { "Content-Type": "application/json" },
    approval: { action: "fixture-write", progress: "Review synthetic mutation", once: true },
    beforeSendCheckpoint: { expectedRevision: null, stage: "fixture-attempted" } };
  const legacyHttpIdentity = { version: 2, appId, projectRoot: root, projectId, applyApproval: status.applyApproval,
    origin: status.url, ownerKind: "shared", ownerRevision: 1, manifestHash: status.manifestHash,
    inputDigest: null, method: "POST", path: "/fixture", contentType: "application/json",
    headersSha256: hash([["accept", "application/json"], ["content-type", "application/json"]]), timeoutMs: 15000,
    bodySha256: createHash("sha256").update("{}").digest("hex"), checkpoint: null, beforeSendCheckpoint: http.beforeSendCheckpoint };
  await assert.rejects(firstRun.http.request(http), /approval was declined/);
  assert.equal(tokens.at(-1), `APP-SETUP-FIXTURE-WRITE:${appId}:${hash(legacyHttpIdentity)}`);
  const firstHttpToken = tokens.at(-1);
  await assert.rejects(acceptance.http.request(http), /approval was declined/);
  assert.notEqual(tokens.at(-1), firstHttpToken, "First-run HTTP approval cannot authorize acceptance");

  const socket = { path: "/api/websocket" as const, accessToken: "synthetic-access-token",
    type: "auth/long_lived_access_token" as const, payload: { client_name: "fixture", lifespan: 1 },
    approval: { action: "fixture-token", progress: "Review synthetic token", once: true },
    beforeSendCheckpoint: { expectedRevision: null, stage: "fixture-attempted" } };
  const legacySocketIdentity = { version: 1, appId, projectRoot: root, projectId, applyApproval: status.applyApproval,
    origin: status.url, ownerKind: "shared", ownerRevision: 1, manifestHash: status.manifestHash, inputDigest: null,
    protocol: "authenticated-json-websocket", path: socket.path,
    commandSha256: hash(JSON.stringify({ id: 1, type: socket.type, ...socket.payload })),
    accessTokenSha256: hash(socket.accessToken), checkpoint: null, beforeSendCheckpoint: socket.beforeSendCheckpoint };
  await assert.rejects(firstRun.webSocket.request(socket), /approval was declined/);
  assert.equal(tokens.at(-1), `APP-SETUP-FIXTURE-TOKEN:${appId}:${hash(legacySocketIdentity)}`);
  const firstSocketToken = tokens.at(-1);
  await assert.rejects(acceptance.webSocket.request(socket), /approval was declined/);
  assert.notEqual(tokens.at(-1), firstSocketToken);

  const container = { effect: "read" as const, argv: ["fixture", "--version"],
    approval: { action: "fixture-container", progress: "Review synthetic container command" } };
  const legacyContainerIdentity = { version: 1, appId, projectRoot: root, projectId, applyApproval: status.applyApproval,
    ownerKind: "shared", ownerRevision: 1, manifestHash: status.manifestHash, inputDigest: null,
    effect: "read", argv: container.argv, captureAdminPassword: null, expectedPasswordHash: null,
    stdinSha256: createHash("sha256").update("").digest("hex"), checkpoint: null, beforeSendCheckpoint: null };
  await assert.rejects(firstRun.container.exec(container), /approval was declined/);
  assert.equal(tokens.at(-1), `APP-SETUP-FIXTURE-CONTAINER:${appId}:${hash(legacyContainerIdentity)}`);
  const firstContainerToken = tokens.at(-1);
  await assert.rejects(acceptance.container.exec(container), /approval was declined/);
  assert.notEqual(tokens.at(-1), firstContainerToken);
  assert.equal(await firstRun.checkpoint.read(), null);
  assert.equal(await acceptance.checkpoint.read(), null, "Declined mutations sent no requests or Docker commands and created no checkpoint");

  await firstRun.secrets.writeSessionCookies({ session: "synthetic-first-run-cookie" });
  const defaultSessionPath = join(privateFiles, "session-cookies.json");
  const defaultSession = JSON.parse(await readFile(defaultSessionPath, "utf8"));
  assert.equal(defaultSession.identity, hash({ version: 1, appId, projectRoot: root, projectId,
    origin: status.url, approval: status.applyApproval, ownerKind: "shared", composeTarget: status.composeTarget, inputDigest: null }));
  assert.deepEqual(await acceptance.secrets.readSessionCookies(), {});
  await acceptance.secrets.writeSessionCookies({ session: "synthetic-acceptance-cookie" });
  const acceptanceSessionPath = join(privateFiles, "acceptance-session-cookies.json");
  assert.notEqual(JSON.parse(await readFile(acceptanceSessionPath, "utf8")).identity, defaultSession.identity);
  assert.equal((await firstRun.secrets.readSessionCookies()).session, "synthetic-first-run-cookie");
  assert.equal((await acceptance.secrets.readSessionCookies()).session, "synthetic-acceptance-cookie");
  await writeFile(acceptanceSessionPath, JSON.stringify(defaultSession), { mode: 0o600 });
  await assert.rejects(acceptance.secrets.readSessionCookies(), /different app owner or origin/);

  const firstLock = join(directory, `first-run-${appId}.lock`);
  await writeFile(firstLock, "synthetic-lock", { mode: 0o600 });
  const accepted = await acceptance.checkpoint.compareAndSet({ expectedRevision: null, stage: "acceptance-stage", data: { marker: "acceptance" } });
  await assert.rejects(firstRun.checkpoint.compareAndSet({ expectedRevision: null, stage: "first-run-stage" }), /lock is present/);
  await unlink(firstLock);
  const acceptanceLock = join(directory, `acceptance-${appId}.lock`);
  await writeFile(acceptanceLock, "synthetic-lock", { mode: 0o600 });
  const original = await firstRun.checkpoint.compareAndSet({ expectedRevision: null, stage: "first-run-stage", data: { marker: "first-run" } });
  await assert.rejects(acceptance.checkpoint.compareAndSet({ expectedRevision: accepted.revision, stage: "acceptance-stage" }), /lock is present/);
  await unlink(acceptanceLock);
  assert.deepEqual(JSON.parse(await readFile(join(directory, `first-run-${appId}.json`), "utf8")), original);
  assert.deepEqual(JSON.parse(await readFile(join(directory, `acceptance-${appId}.json`), "utf8")), accepted);
  assert.equal((await firstRun.checkpoint.read())?.data.marker, "first-run");
  assert.equal((await acceptance.checkpoint.read())?.data.marker, "acceptance");
  console.log("acceptance namespace: unchanged default HTTP/WebSocket/container/cookie fingerprints; isolated approval/checkpoint/lock/cookie state; no network or Docker");
} finally { await rm(root, { recursive: true, force: true }); }
