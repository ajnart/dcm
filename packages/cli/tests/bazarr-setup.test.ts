import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import bazarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/bazarr/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

// Redacted synthetic configuration/API boundary; no Bazarr process or Docker.
const password = "fixture-admin-password";
const key = "a".repeat(32);
const digest = (algorithm: string, value: string) => createHash(algorithm).update(value).digest("hex");
let extractionScript = "";
function reply(value: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}
function fixture() {
  const root = "/tmp/bazarr-setup-fixture";
  let stored: string | null = null;
  let checkpoint: SetupCheckpoint | null = null;
  const state = { auth: { apikey: key, type: null as string | null, username: "", password: "" },
    deferred: true, responseLost: false, writes: 0, reads: 0, extractionStatus: 0,
    readStatus: 200, anonymousStatus: 401, loginStatus: 200, requests: [] as string[] };
  const context = {
    appId: "bazarr", projectRoot: root, inputs: {},
    async status() { return { command: "app status", appId: "bazarr", projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" } }; },
    container: { async exec(command) {
      assert.equal(command.effect, "read");
      assert.deepEqual(command.argv.slice(0, 3), ["python3", "-I", "-c"]);
      assert.match(command.argv[3], /\/config\/config\/config\.yaml/);
      assert.match(command.argv[3], /O_NOFOLLOW/);
      assert.match(command.argv[3], /len\(names\)==len\(set\(names\)\)/);
      assert.ok(command.argv[3].length < 2048);
      extractionScript = command.argv[3];
      state.reads++;
      return { exitCode: state.extractionStatus, stdout: JSON.stringify(state.auth) };
    } },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(update) {
        assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "bazarr", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
          data: update.data ?? {}, attemptedActions: [] };
        return checkpoint;
      },
    },
    secrets: {
      async readAdminPassword() { return password; },
      async readApiKey() { return stored; },
      async writeApiKey(value) { stored = value; return `${root}/key`; },
      async apiKeyPath() { if (stored === null) return null; return `${root}/key`; },
    },
    http: { async request(request: SetupHttpRequest) {
      if (request.path === "/") {
        if (request.headers?.Authorization) {
          assert.equal(request.headers.Authorization, `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`);
          return reply({}, state.loginStatus);
        }
        return reply({}, state.anonymousStatus);
      }
      assert.equal(request.path, "/api/system/settings");
      assert.equal(request.headers?.["X-API-KEY"], stored);
      if (request.method === "GET") return reply({ auth: state.auth }, state.readStatus);
      assert.equal(request.method, "POST");
      assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body as string)), {
        "settings-auth-type": "basic", "settings-auth-username": "admin", "settings-auth-password": password });
      state.requests.push(JSON.stringify(request));
      if (state.deferred) throw new Error("approval deferred");
      const next = await context.checkpoint.compareAndSet(request.beforeSendCheckpoint!);
      next.attemptedActions.push(request.approval!.action);
      state.writes++;
      state.auth = { apikey: key, type: "basic", username: "admin", password: digest("md5", password) };
      if (state.responseLost) throw new Error("response uncertain");
      return reply({}, 204);
    } },
  } as SetupContext;
  return { context, state, get checkpoint() { return checkpoint; },
    get key() { return stored; }, set key(value: string | null) { stored = value; } };
}

const fresh = fixture();
await assert.rejects(bazarr.firstRun(fresh.context), /approval deferred/);
await assert.rejects(bazarr.firstRun(fresh.context), /approval deferred/);
assert.equal(fresh.key, key);
assert.equal(fresh.checkpoint, null);
assert.equal(fresh.state.requests[0], fresh.state.requests[1]);
fresh.state.deferred = false;
fresh.state.responseLost = true;
await assert.rejects(bazarr.firstRun(fresh.context), /response uncertain/);
assert.deepEqual(Object.keys(fresh.checkpoint!.data).sort(), ["keyHash", "loginDigest"]);
assert.equal(fresh.checkpoint?.data.loginDigest, digest("sha256", password));
assert.equal(fresh.checkpoint?.data.keyHash, digest("sha256", key));
assert.equal(bazarr.ready(await bazarr.firstRun(fresh.context)), true);
assert.equal(bazarr.ready(await bazarr.inspect!(fresh.context)), true);
assert.equal(fresh.key, key, "Resume verifies the same saved API key without rotating it");
assert.equal(fresh.state.writes, 1);
fresh.state.readStatus = 503;
const attempt = structuredClone(fresh.checkpoint);
await assert.rejects(bazarr.firstRun(fresh.context), /settings readback/);
assert.deepEqual(fresh.checkpoint, attempt);
fresh.state.readStatus = 200;
fresh.state.auth = { apikey: key, type: null, username: "", password: "" };
await assert.rejects(bazarr.firstRun(fresh.context), /not confirmed in owned config/);
assert.equal(fresh.state.writes, 1);
assert.deepEqual(fresh.checkpoint, attempt);

for (const auth of [
  { apikey: key, type: "basic", username: "admin", password: digest("md5", password) },
  { apikey: key, type: "form", username: "foreign", password: "foreign-hash" },
  { apikey: key, type: null, username: "foreign", password: "" },
  { apikey: "invalid", type: null, username: "", password: "" },
  { apikey: key, type: "unknown", username: "", password: "" },
]) {
  const foreign = fixture(); foreign.state.auth = auth;
  await assert.rejects(bazarr.firstRun(foreign.context), /outside this project|ambiguous/);
  assert.equal(foreign.key, null);
  assert.equal(foreign.state.writes, 0);
}
const changed = fixture(); changed.key = "b".repeat(32);
await assert.rejects(bazarr.firstRun(changed.context), /differs from its saved key/);
assert.equal(changed.key, "b".repeat(32));
const failed = fixture(); failed.state.extractionStatus = 1;
await assert.rejects(bazarr.firstRun(failed.context), /extraction failed/);
assert.equal(failed.key, null);
const passwordChanged = fixture();
passwordChanged.state.deferred = false;
assert.equal(bazarr.ready(await bazarr.firstRun(passwordChanged.context)), true);
passwordChanged.context.secrets.readAdminPassword = async () => "changed-password";
await assert.rejects(bazarr.firstRun(passwordChanged.context), /checkpoint does not match/);
assert.equal(passwordChanged.state.writes, 1);
const anonymous = fixture(); anonymous.state.deferred = false; anonymous.state.anonymousStatus = 200;
await assert.rejects(bazarr.firstRun(anonymous.context), /anonymous UI access/);
assert.equal(anonymous.state.writes, 1);

// Execute the fixed parser with only its owned path relocated to this synthetic
// fixture. Host PyYAML is parser evidence, not the pinned image's interpreter.
const parserRoot = await mkdtemp(join(tmpdir(), "bazarr-owned-config-"));
const parserDirectory = join(parserRoot, "config");
const parserFile = join(parserDirectory, "config.yaml");
try {
  await mkdir(parserDirectory);
  const script = extractionScript.replaceAll("/config/config", parserDirectory);
  const yaml = `auth:\n  apikey: '${key}'\n  type: null\n  username: ''\n  password: ''\nsonarr:\n  apikey: 'unrelated-fixture-provider-key'\n`;
  await writeFile(parserFile, yaml, { mode: 0o600 });
  const parsed = spawnSync("python3", ["-I", "-c", script], { encoding: "utf8" });
  assert.equal(parsed.status, 0);
  assert.deepEqual(JSON.parse(parsed.stdout), { apikey: key, type: null, username: "", password: "" });
  assert.ok(!parsed.stdout.includes("unrelated-fixture-provider-key"));
  for (const invalid of [
    yaml.replace("  type: null", "  type: null\n  type: basic"),
    `${yaml}\nauth:\n  apikey: '${key}'\n`,
    yaml.replace("auth:", "AUTH:"),
    yaml.replace("  password: ''", "  password: ''\n  extra: unexpected"),
  ]) {
    await writeFile(parserFile, invalid);
    const denied = spawnSync("python3", ["-I", "-c", script], { encoding: "utf8" });
    assert.notEqual(denied.status, 0);
    assert.equal(denied.stdout, "");
  }
  await writeFile(join(parserRoot, "foreign.yaml"), yaml);
  await rm(parserFile);
  await symlink(join(parserRoot, "foreign.yaml"), parserFile);
  assert.notEqual(spawnSync("python3", ["-I", "-c", script], { encoding: "utf8" }).status, 0);
} finally {
  await rm(parserRoot, { recursive: true, force: true });
}
console.log("Bazarr owned-config/auth synthetic fixture passed; no image, live, restart, Arr or Homarr credit");
