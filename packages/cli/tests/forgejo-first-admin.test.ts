import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/forgejo/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpResponse } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const appId = "forgejo";
const projectRoot = "/tmp/forgejo-first-admin-fixture";
const passwordFile = `${projectRoot}/private/admin-password`;
let password = "A".repeat(65);
let checkpoint: SetupCheckpoint | null = null;
let created = false;
let creates = 0;
let inventory = "ID Username Email IsActive IsAdmin 2FA\n";
let loseCapture = false;
let apiKey: string | null = null;
const key = "a".repeat(40);
let tokens: Record<string, unknown>[] = [];
let keyCreates = 0;
let loseKeyOutput = false;
let failKeyReadback = false;
let interruptKeyCheckpoint = false;
function reply(value: unknown, status = 200): SetupHttpResponse {
  return { status, ok: status === 200, headers: { get(name) {
    if (name === "x-total-count" && Array.isArray(value)) return String(value.length);
    return null;
  } },
    async json() { return value; }, async text() { return JSON.stringify(value); },
    async arrayBuffer() { return new TextEncoder().encode(JSON.stringify(value)).buffer; } };
}
const context = { appId, projectRoot, installedAppIds: [appId], inputs: {},
  async status() { return { command: "app status", appId, projectRoot, mutation: false,
    ownerKind: "shared", status: "applied", runtime: { state: "running" },
    username: "admin", privateFiles: `${projectRoot}/private`, passwordFile }; },
  secrets: { async readAdminPassword() { return password; },
    async readApiKey() { return apiKey; },
    async apiKeyPath() { if (apiKey === null) return null; return `${projectRoot}/private/api-key`; },
    async writeApiKey(value) { apiKey = value; return `${projectRoot}/private/api-key`; } },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(next) {
      if (interruptKeyCheckpoint && next.data?.tokenId) {
        assert.equal(apiKey, key, "once-returned key must already be saved before checkpoint writes");
        interruptKeyCheckpoint = false;
        throw new Error("checkpoint interrupted");
      }
      assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId, projectRoot, revision: (checkpoint?.revision ?? 0) + 1,
        stage: next.stage, data: next.data ?? {}, attemptedActions: checkpoint?.attemptedActions ?? [] };
      return checkpoint;
    },
  },
  http: { async request(request) {
    if (request.path === "/api/v1/users/admin/tokens") {
      assert.equal(request.headers?.Authorization, `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`);
      if (request.method === "GET") {
        if (failKeyReadback && apiKey !== null) {
          assert.equal(apiKey, key, "key saved before network readback");
          throw new Error("private upstream error");
        }
        assert.deepEqual(request.query, { page: "1", limit: "100" });
        return reply(tokens);
      }
      assert.equal(request.method, "POST");
      assert.deepEqual(JSON.parse(request.body as string), { name: "selfhost-readonly", scopes: ["read:user"] });
      assert.equal(request.approval?.action, "forgejo-readonly-api-key");
      assert.equal(request.approval?.once, true);
      await context.checkpoint.compareAndSet(request.beforeSendCheckpoint!);
      checkpoint!.attemptedActions.push(request.approval!.action);
      keyCreates++;
      const token = { id: 10, name: "selfhost-readonly", scopes: ["read:user"], token_last_eight: key.slice(-8) };
      tokens = [token];
      if (loseKeyOutput) return reply({}, 201);
      return reply({ ...token, sha1: key }, 201);
    }
    assert.equal(request.method, "GET");
    assert.equal(request.path, "/api/v1/user");
    assert.ok([`Basic ${Buffer.from(`admin:${password}`).toString("base64")}`, `token ${key}`].includes(request.headers?.Authorization ?? ""));
    if (!created || loseCapture) return reply({}, 401);
    return reply({ id: 1, login: "admin", is_admin: true, active: true });
  } },
  container: { async exec(command) {
    assert.deepEqual(command.argv.slice(0, 3), ["su-exec", "git", "forgejo"]);
    assert.ok(command.argv.length <= 16, "must fit the actual container transport argv limit");
    assert.ok(!command.argv.some((value) => value.includes(password)), "no password in argv");
    if (command.effect === "read") {
      assert.deepEqual(command.argv.slice(3), ["admin", "user", "list"]);
      return { exitCode: 0, stdout: inventory };
    }
    assert.deepEqual(command.argv.slice(3), ["admin", "user", "create", "--username", "admin",
      "--email", "admin@forgejo.invalid", "--admin", "--random-password",
      "--random-password-length", "48", "--must-change-password=false"]);
    assert.equal(command.approval.once, true);
    assert.deepEqual(command.captureAdminPassword,
      { format: "one-line", prefix: "generated random password is '", suffix: "'" });
    await context.checkpoint.compareAndSet(command.beforeSendCheckpoint!);
    checkpoint!.attemptedActions.push(command.approval.action);
    creates++;
    created = true;
    if (loseCapture) throw new Error("private capture interrupted");
    password = "generated-private-password".padEnd(48, "b");
    return { exitCode: 0, stdout: "" };
  } },
} as SetupContext;

assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(adapter.ready(await adapter.inspect!(context)), true);
assert.equal(creates, 1);
assert.equal(keyCreates, 1);
assert.equal(apiKey, key);
assert.equal(adapter.ready({ appId, stage: "admin-login-verified", username: "admin", credentialRef: passwordFile }), false);
const ownedCheckpoint = checkpoint!;
tokens[0]!.scopes = ["all"];
await assert.rejects(adapter.inspect!(context), /unexpected identity or scope/);
tokens[0]!.scopes = ["read:user"];
tokens[0]!.id = 11;
await assert.rejects(adapter.inspect!(context), /does not match/);
tokens[0]!.id = 10;
tokens[0]!.token_last_eight = "b".repeat(8);
await assert.rejects(adapter.inspect!(context), /does not match/);
tokens[0]!.token_last_eight = key.slice(-8);
checkpoint = { ...ownedCheckpoint, stage: "admin-login-verified", data: {}, attemptedActions: ["forgejo-first-admin"] };
await assert.rejects(adapter.inspect!(context), /resume setup/);
await assert.rejects(adapter.firstRun(context), /without this setup's token checkpoint/);
apiKey = null;
tokens = [];
failKeyReadback = true;
await assert.rejects(adapter.firstRun(context), /bounded token inventory/);
assert.equal(apiKey, key);
failKeyReadback = false;
assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(keyCreates, 2, "owned legacy checkpoint migrates without creating another administrator");
checkpoint = { ...ownedCheckpoint, stage: "admin-login-verified", data: {}, attemptedActions: ["forgejo-first-admin"] };
apiKey = null;
tokens = [];
interruptKeyCheckpoint = true;
await assert.rejects(adapter.firstRun(context), /checkpoint interrupted/);
assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(keyCreates, 3, "saved key recovers even when its metadata checkpoint was interrupted");
checkpoint = { ...ownedCheckpoint, stage: "admin-login-verified", data: {}, attemptedActions: ["forgejo-first-admin"] };
apiKey = null;
tokens = [];
loseKeyOutput = true;
await assert.rejects(adapter.firstRun(context), /unexpected identity or scope/);
await assert.rejects(adapter.firstRun(context), /ambiguous outcome/);
assert.equal(keyCreates, 4, "lost one-time key output must not be recreated");
loseKeyOutput = false;
checkpoint = null;
await assert.rejects(adapter.firstRun(context), /without this setup's creation checkpoint/);
created = false;
inventory += "1 foreign foreign@example.test true true false\n";
await assert.rejects(adapter.firstRun(context), /already has a user/);
assert.equal(creates, 1);
inventory = "ID Username Email IsActive IsAdmin 2FA\n";
loseCapture = true;
await assert.rejects(adapter.firstRun(context), /private capture interrupted/);
await assert.rejects(adapter.firstRun(context), /ambiguous outcome/);
assert.equal(creates, 2, "uncertain creation must not be repeated");
console.log("Forgejo account/key migration, capture/replay, read-only scope, private-save ordering and interrupted output checks passed (synthetic only)");
