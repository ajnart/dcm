import assert from "node:assert/strict";
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SetupContainerCommand, SetupPeerTarget } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

// No real Docker, HTTP, provider or imported credential is used.
let subprocess: (command: string, args: string[], options: any) => any = () => { throw new Error("Unexpected subprocess"); };
mock.module("node:child_process", () => ({ ...childProcess,
  spawnSync: (command: string, args: string[], options: any) => subprocess(command, args, options) }));
const { createSetupTransportFacilities, SetupTransportDeferred } = await import("../src/control-panel/setup-transport.ts");
const root = await mkdtemp(join(tmpdir(), "selfhost-connector-transport-"));
const projectId = "connector_fixture";
const appId = "tailscale";
const directory = join(root, ".selfhost", "shared", projectId);
const privateFiles = join(directory, "secrets", appId);
const composeTarget = join(directory, "compose.aaaaaaaaaaaaaaaa.yaml");
const authFile = join(privateFiles, "auth-key");
const authKey = "synthetic-owner-auth-key";
const containerId = "c".repeat(64);
const status = { command: "app status", appId, projectRoot: root, ownerKind: "shared",
  mutation: false, runtime: { state: "running" }, status: "connector-applied-unverified",
  connector: true, frontendSharing: "owner-front", ownerPhase: "completed",
  ownerRecordHash: "d".repeat(64), ownerRevision: 4, manifestHash: "b".repeat(64),
  projectId, dockerContext: "default", composeTarget,
  applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`,
  port: null, url: null, username: null, passwordFile: null, privateFiles,
  loginVia: "external-secret", privateFileIds: ["auth-key"] };
let current: Record<string, unknown> = status;
let granted = false;
let duringApproval: (() => Promise<void>) | undefined;
let fields = [containerId, "true", projectId, appId, composeTarget, directory, "False"];
let executions = 0;
let subprocessCalls = 0;
let failExec = false;
let expectWriteCheckpoint = false;
const tokens: string[] = [];
const registered: string[] = [];
const target: SetupPeerTarget = { ownerRevision: status.ownerRevision,
  ownerRecordHash: status.ownerRecordHash, manifestHash: status.manifestHash,
  target: { appId: "homarr", serviceId: "homarr", hostname: "homarr", targetPort: 7575,
    publishedPort: 17575, hostIp: "127.0.0.1", frontNetworkId: "front",
    frontNetworkName: `${projectId}-front`, projectId,
    image: `ghcr.io/homarr-labs/homarr-test:v2@sha256:${"e".repeat(64)}`,
    selectionFingerprint: "f".repeat(64), ownerFingerprint: "1".repeat(64), targetFingerprint: "2".repeat(64) } };
let resolved = target;
let afterResolve: (() => void) | undefined;
const facilities = createSetupTransportFacilities({ appId, projectRoot: root,
  async readStatus() { return current; }, async readHandoff() { throw new Error("Unexpected handoff"); },
  async resolvePeerTarget(peerId) { assert.equal(peerId, "homarr"); afterResolve?.(); return resolved; },
  async resolveHttpsTarget() { throw new Error("Container transport must not resolve HTTPS"); },
  async approve(_action, token, progress) {
    assert.equal(progress.includes(authKey), false);
    tokens.push(token); await duringApproval?.(); return granted;
  }, approvalQueue: { tail: Promise.resolve() },
  registerSecret(value) { registered.push(value); },
  redact(value) { return registered.reduce((safe, secret) => safe.replaceAll(secret, "[redacted]"), value); } });
const read: SetupContainerCommand = { effect: "read", argv: ["/usr/local/bin/tailscale", "status", "--json"],
  approval: { action: "connector-read", progress: "Read private connector state" } };
const write: SetupContainerCommand = { effect: "write",
  argv: ["/usr/local/bin/tailscale", "up", "--auth-key=file:/run/secrets/auth-key"], privateFileRefs: ["auth-key"],
  approval: { action: "connector-enroll", progress: "Enroll this exact connector", once: true },
  beforeSendCheckpoint: { expectedRevision: null, stage: "enrollment-attempted" } };
try {
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(composeTarget, "synthetic-compose-only", { mode: 0o600 });
  await writeFile(authFile, authKey, { mode: 0o600 });
  subprocess = (command, args, options) => {
    assert.equal(command, "docker"); subprocessCalls++;
    assert.equal(options.timeout, 15_000); assert.equal(options.maxBuffer, 64 * 1024);
    if (args[2] === "compose") {
      assert.deepEqual(args, ["--context", "default", "compose", "--project-name", projectId,
        "--file", composeTarget, "ps", "-q", appId]);
      return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    if (args[3] === "inspect") {
      assert.equal(args.at(-1), containerId);
      assert.ok(args[5]!.includes("com.docker.compose.oneoff"));
      return { status: 0, stdout: `${fields.join("|")}\n`, stderr: "" };
    }
    assert.deepEqual(args.slice(0, 6), ["--context", "default", "container", "exec", "-i", containerId]);
    executions++;
    if (expectWriteCheckpoint) {
      const checkpoint = JSON.parse(readFileSync(join(directory, "first-run-tailscale.json"), "utf8"));
      assert.equal(checkpoint.stage, "enrollment-attempted");
      assert.ok(checkpoint.attemptedActions.includes("connector-enroll"));
      assert.equal(JSON.stringify(checkpoint).includes(authKey), false);
    }
    if (failExec) return { status: null, error: new Error("synthetic private subprocess failure"), stdout: Buffer.alloc(0) };
    return { status: 0, stdout: Buffer.from("{\"synthetic\":true}"), stderr: Buffer.alloc(0) };
  };
  assert.equal(await facilities.checkpoint.read(), null);
  await assert.rejects(facilities.http.request({ method: "GET", path: "/api/health" }), /not confirmed running/);
  await assert.rejects(facilities.secrets.readSessionCookies(), /not confirmed running/);
  assert.equal(subprocessCalls, 0);
  assert.deepEqual(await facilities.peers.resolveTarget("homarr"), target.target);
  for (const patch of [{ ownerRevision: 5 }, { ownerRecordHash: "3".repeat(64) },
    { manifestHash: "4".repeat(64) }, { target: { ...target.target, projectId: "other" } }]) {
    resolved = { ...target, ...patch };
    await assert.rejects(facilities.peers.resolveTarget("homarr"), /differs from the exact saved shared owner/);
  }
  resolved = target;
  afterResolve = () => { current = { ...status, ownerRecordHash: "5".repeat(64) }; };
  await assert.rejects(facilities.peers.resolveTarget("homarr"), /changed during resolution/);
  afterResolve = undefined; current = status;
  await assert.rejects(facilities.peers.resolveTarget(appId), /different selected app/);
  await assert.rejects(facilities.peers.resolveTarget("http://example.test"), /different selected app/);
  for (const patch of [{ ownerPhase: "attempted" }, { ownerRecordHash: undefined },
    { connector: false }, { frontendSharing: "none" }, { port: 1234 }, { url: "http://127.0.0.1:1234" },
    { ownerRevision: 0 }, { manifestHash: "invalid" }]) {
    current = { ...status, ...patch };
    await assert.rejects(facilities.container.exec(read));
  }
  current = status;
  await assert.rejects(facilities.container.exec(write), SetupTransportDeferred);
  const firstToken = tokens.at(-1)!;
  await assert.rejects(facilities.container.exec(write), SetupTransportDeferred);
  assert.equal(tokens.at(-1), firstToken);
  await writeFile(authFile, "different-synthetic-owner-auth-key", { mode: 0o600 });
  await assert.rejects(facilities.container.exec(write), SetupTransportDeferred);
  assert.notEqual(tokens.at(-1), firstToken);
  await writeFile(authFile, authKey, { mode: 0o600 });
  assert.ok(registered.includes(authKey));
  granted = true;
  duringApproval = async () => { await writeFile(authFile, "changed-during-review", { mode: 0o600 }); };
  await assert.rejects(facilities.container.exec(write), /identity changed during container approval/);
  assert.equal(await facilities.checkpoint.read(), null); assert.equal(executions, 0);
  duringApproval = undefined; await writeFile(authFile, authKey, { mode: 0o600 });
  for (let index = 0; index < 7; index++) {
    fields = [containerId, "true", projectId, appId, composeTarget, directory, "False"];
    fields[index] = "different-owner";
    await assert.rejects(facilities.container.exec(read), /does not match its saved Compose owner/);
  }
  fields = [containerId, "true", projectId, appId, composeTarget, directory, "False", "extra"];
  await assert.rejects(facilities.container.exec(read), /does not match its saved Compose owner/);
  fields = [containerId, "true", projectId, appId, composeTarget, directory, "False"];
  assert.equal((await facilities.container.exec(read)).exitCode, 0);
  await assert.rejects(facilities.container.exec({ ...write, privateFileRefs: ["../auth-key"] }), /declared exact owner-private files/);
  await assert.rejects(facilities.container.exec({ ...write, privateFileRefs: ["undeclared"] }), /declared exact owner-private files/);
  expectWriteCheckpoint = true; failExec = true;
  await assert.rejects(facilities.container.exec(write), /outcome is unknown/);
  assert.equal((await facilities.checkpoint.read())?.stage, "enrollment-attempted");
  const attempts = executions;
  await assert.rejects(facilities.container.exec(write), /already attempted/);
  assert.equal(executions, attempts);
} finally { mock.restore(); await rm(root, { recursive: true }); }
console.log("Portless setup transport: exact owner/peer/file approval binding, mocked container scope and no-repeat checkpoint checks passed");
