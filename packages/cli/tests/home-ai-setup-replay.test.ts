import assert from "node:assert/strict";
import homebridge from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/homebridge/setup";
import speedtest from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/speedtest-tracker/setup";
import nodeRed from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/node-red/setup";
import type { SetupCheckpoint, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";

const SYNTHETIC_ADMIN_CREDENTIAL = "A".repeat(48);
const SYNTHETIC_API_KEY = `7|${"b".repeat(40)}`;
const projectRoot = "/synthetic/project";
function response(payload: unknown) {
  return { status: 200, ok: true, async json() { return payload; } };
}

// Source-contract fixtures, not live upstream evidence. The Scrypted fixture
// separately exercises real shared transport and persisted approval subjects.
async function homebridgeReplay(): Promise<void> {
  const instanceId = "c".repeat(64);
  let writes = 0;
  let ownerId = 1;
  const checkpoint: SetupCheckpoint = { schemaVersion: 1, appId: "homebridge", projectRoot, revision: 3,
    stage: "admin-auth-verified", attemptedActions: ["homebridge-create-first-admin"], data: { instanceId, ownerId: 1 } };
  const context = { appId: "homebridge", projectRoot,
    async status() { return { command: "app status", appId: "homebridge", projectRoot, mutation: false,
      status: "applied", runtime: { state: "running" } }; },
    secrets: { async readAdminPassword() { return SYNTHETIC_ADMIN_CREDENTIAL; } },
    checkpoint: { async read() { return checkpoint; }, async compareAndSet() { writes += 1; throw new Error("Unexpected rewrite"); } },
    http: { async request(input: { path: string }) {
      if (input.path === "/api/auth/settings") return response({ env: { packageVersion: "5.29.0", setupWizardComplete: true, instanceId } });
      if (input.path === "/api/auth/login") return { ...response({ access_token: "d".repeat(64), token_type: "Bearer", expires_in: 86400 }), status: 201 };
      if (input.path === "/api/users") return response([{ id: ownerId, username: "admin", admin: true }]);
      throw new Error("Unexpected Homebridge route");
    } },
  } as unknown as SetupContext;
  assert.ok(homebridge.ready(await homebridge.firstRun(context)));
  assert.ok(homebridge.ready(await homebridge.firstRun(context)));
  assert.equal(writes, 0);
  ownerId = 2;
  await assert.rejects(homebridge.firstRun(context), /identity changed/);
  assert.equal(writes, 0);
}

async function speedtestReplay(): Promise<void> {
  const passwordFile = "/synthetic/private/admin-password";
  const apiKeyFile = "/synthetic/private/speedtest-tracker-api-key";
  let saved: string | null = null;
  let checkpoint: SetupCheckpoint | null = null;
  let creates = 0;
  let updates = 0;
  let observedOwner = 1;
  let failStats = true;
  let statsReads = 0;
  const context = { appId: "speedtest-tracker", projectRoot,
    async status() { return { command: "app status", appId: "speedtest-tracker", projectRoot,
      ownerKind: "shared", username: "admin@example.test", passwordFile, url: "http://127.0.0.1:19101",
      mutation: false, status: "applied", runtime: { state: "running" } }; },
    secrets: {
      async readAdminPassword() { return SYNTHETIC_ADMIN_CREDENTIAL; },
      async readApiKey() { return saved; }, async apiKeyPath() { return apiKeyFile; },
      async writeApiKey(value: string) { assert.equal(value, SYNTHETIC_API_KEY); saved = value; return apiKeyFile; },
    },
    checkpoint: { async read() { return checkpoint; }, async compareAndSet(input: { expectedRevision: number; stage: string; data: SetupCheckpoint["data"] }) {
      assert.ok(checkpoint); assert.equal(input.expectedRevision, checkpoint.revision);
      updates += 1; checkpoint = { ...checkpoint, revision: checkpoint.revision + 1, stage: input.stage, data: input.data };
      return checkpoint;
    } },
    http: { async request(input: { path: string; approval?: { action: string } }) {
      assert.equal(input.path, "/api/v1/stats");
      assert.equal(input.approval?.action, "speedtest-tracker-verify-api-token");
      assert.equal(saved, SYNTHETIC_API_KEY); // Must save before fallible verification.
      statsReads += 1;
      if (failStats) throw new Error("Synthetic statistics failure");
      return response({ data: [], message: "synthetic" });
    } },
    container: { async exec(input: { effect: string; beforeSendCheckpoint?: { data: SetupCheckpoint["data"] }; argv: string[] }) {
      if (input.effect === "write") {
        creates += 1; assert.equal(checkpoint, null);
        checkpoint = { schemaVersion: 1, appId: "speedtest-tracker", projectRoot, revision: 0,
          stage: "token-create-attempted", attemptedActions: ["speedtest-tracker-create-token"], data: input.beforeSendCheckpoint!.data };
        return { exitCode: 0, stdout: SYNTHETIC_API_KEY };
      }
      if (input.argv.at(-1)!.includes("PersonalAccessToken::findToken")) return { exitCode: 0, stdout: String(observedOwner) };
      return { exitCode: 0, stdout: JSON.stringify({ id: 1, tokens: 0 }) };
    } },
  } as unknown as SetupContext;
  await assert.rejects(speedtest.firstRun(context), /Synthetic statistics failure/);
  assert.equal(saved, SYNTHETIC_API_KEY);
  assert.equal(creates, 1);
  failStats = false;
  assert.ok(speedtest.ready(await speedtest.firstRun(context)));
  assert.equal(updates, 1);
  assert.ok(speedtest.ready(await speedtest.firstRun(context)));
  assert.equal(updates, 1);
  assert.equal(creates, 1);
  observedOwner = 2;
  const ownerMismatchReads = statsReads;
  await assert.rejects(speedtest.firstRun(context), /checkpoint owner or file/);
  assert.equal(statsReads, ownerMismatchReads);
  observedOwner = 1;
  const completed = checkpoint;
  checkpoint = null;
  const readsBefore = statsReads;
  await assert.rejects(speedtest.firstRun(context), /no matching creation checkpoint/);
  assert.equal(statsReads, readsBefore);
  checkpoint = completed;
  saved = null;
  await assert.rejects(speedtest.firstRun(context), /attempt is unresolved/);
  assert.equal(creates, 1);
}

await homebridgeReplay();
await speedtestReplay();
let anonymousStatus = 401;
let expiresIn = 86400;
let tokenRequests = 0;
const nodeRedContext = { appId: "node-red", projectRoot,
  async status() { return { command: "app status", appId: "node-red", projectRoot, mutation: false,
    status: "applied", runtime: { state: "running" } }; },
  secrets: { async readAdminPassword() { return SYNTHETIC_ADMIN_CREDENTIAL; } },
  http: { async request(input: { path: string; headers?: Record<string, string> }) {
    if (input.path === "/auth/login") return response({ type: "credentials" });
    if (input.path === "/auth/token") {
      tokenRequests += 1;
      return response({ access_token: "c".repeat(64), token_type: "Bearer", expires_in: expiresIn });
    }
    if (input.path === "/flows") {
      if (!input.headers?.Authorization) return { ...response([]), status: anonymousStatus };
      return response([]);
    }
    throw new Error("Unexpected Node-RED route");
  } },
} as unknown as SetupContext;
assert.ok(nodeRed.ready(await nodeRed.firstRun(nodeRedContext)));
anonymousStatus = 200;
const issuedBefore = tokenRequests;
await assert.rejects(nodeRed.firstRun(nodeRedContext), /deny anonymous/);
assert.equal(tokenRequests, issuedBefore);
anonymousStatus = 401;
expiresIn = -1;
await assert.rejects(nodeRed.firstRun(nodeRedContext), /expiring Bearer/);
assert.equal(nodeRed.ready({ appId: "node-red", stage: "admin-auth-verified", adminUsername: "admin" }), false);
process.stdout.write("Homebridge, Speedtest Tracker and Node-RED replay/auth regressions: pass\n");
