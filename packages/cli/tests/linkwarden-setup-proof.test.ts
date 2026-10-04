import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import linkwarden from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/linkwarden/setup";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";

const SYNTHETIC_CREDENTIAL = "SyntheticFixtureOnly123";
const SYNTHETIC_BEARER = "fixture-bearer".repeat(4);
const FRESH_BEARER = "fresh-fixture-bearer".repeat(4);
const SYNTHETIC_API_KEY = "fixture-api-key".repeat(4);
const root = "/tmp/linkwarden-proof-fixture";
const selection = "a".repeat(64);

function fixture() {
  const state = { manifest: "initial-manifest", selection, closed: false,
    keyAccepted: true, passwordAccepted: true, freshStatus: 200, freshUserId: 1,
    keyPresent: true, freshBearer: FRESH_BEARER, tokenAttempts: [] as SetupHttpRequest[],
    logins: 0, writes: 0, probes: 0, keyReads: 0,
    checkpoint: { schemaVersion: 1, appId: "linkwarden", projectRoot: root,
      revision: 1, stage: "account-verified", attemptedActions: ["linkwarden-create-first-account"],
      data: { ownerManifestHash: "initial-manifest", identity: "admin",
        credentialRef: `${root}/admin-password` } } as SetupCheckpoint };
  const context = {
    appId: "linkwarden", projectRoot: root,
    async status() {
      let environmentTransition: unknown = null;
      if (state.closed) environmentTransition = { serviceId: "linkwarden",
        name: "NEXT_PUBLIC_DISABLE_REGISTRATION", value: "true",
        manifestHash: state.manifest, revision: 7 };
      return { command: "app status", appId: "linkwarden", projectRoot: root,
        status: "applied", mutation: false, runtime: { state: "running" }, ownerKind: "shared",
        username: "admin", passwordFile: `${root}/admin-password`, manifestHash: state.manifest,
        selectionFingerprint: state.selection, ownerRevision: 7, environmentTransition };
    },
    secrets: {
      async readAdminPassword() { return SYNTHETIC_CREDENTIAL; },
      async readSessionCookies() { return { bearer: SYNTHETIC_BEARER,
        password_digest: createHash("sha256").update(SYNTHETIC_CREDENTIAL).digest("hex") }; },
      async readApiKey() { if (!state.keyPresent) return null; return SYNTHETIC_API_KEY; },
      async apiKeyPath() { return `${root}/api-key`; },
    },
    checkpoint: {
      async read() { return structuredClone(state.checkpoint); },
      async compareAndSet(update: SetupCheckpointUpdate) {
        assert.equal(update.expectedRevision, state.checkpoint.revision);
        state.writes += 1;
        state.checkpoint = { ...state.checkpoint, revision: state.checkpoint.revision + 1,
          stage: update.stage, data: update.data ?? {} };
        return structuredClone(state.checkpoint);
      },
    },
    http: { async request(request: SetupHttpRequest) {
      if (request.path === "/api/v1/session") {
        assert.equal(request.method, "POST");
        assert.equal(request.approval?.action, "linkwarden-verify-admin-login");
        assert.deepEqual(JSON.parse(String(request.body)), { username: "admin", password: SYNTHETIC_CREDENTIAL });
        state.logins += 1;
        state.freshBearer = `${FRESH_BEARER}-${state.logins}`;
        let status = 200;
        if (!state.passwordAccepted) status = 401;
        return { status, async json() { return { response: { token: state.freshBearer } }; } };
      }
      if (request.path === "/api/v1/tokens") {
        assert.equal(request.method, "POST");
        assert.equal(request.approval?.action, "linkwarden-create-api-token");
        assert.equal(request.headers?.Authorization, `Bearer ${SYNTHETIC_BEARER}`);
        state.tokenAttempts.push(structuredClone(request));
        throw new Error("approval required");
      }
      if (request.method === "POST") {
        assert.equal(request.path, "/api/v1/users");
        assert.equal(request.approval?.action, "linkwarden-prove-registration-closed");
        assert.ok(request.beforeSendCheckpoint);
        assert.equal(request.beforeSendCheckpoint.expectedRevision, state.checkpoint.revision);
        state.probes += 1;
        state.checkpoint = { ...state.checkpoint, revision: state.checkpoint.revision + 1,
          stage: "closure-probe-attempted" };
        return { status: 400, async json() { return { response: "Registration is disabled." }; } };
      }
      assert.equal(request.method, "GET");
      assert.equal(request.path, "/api/v1/users/me");
      let status = 200;
      if (request.headers?.Authorization === `Bearer ${SYNTHETIC_API_KEY}`) {
        state.keyReads += 1;
        if (!state.keyAccepted) status = 401;
      } else if (request.headers?.Authorization === `Bearer ${state.freshBearer}`) {
        return { status: state.freshStatus,
          async json() { return { response: { username: "admin", id: state.freshUserId } }; } };
      } else assert.equal(request.headers?.Authorization, `Bearer ${SYNTHETIC_BEARER}`);
      return { status, async json() { return { response: { username: "admin", id: 1 } }; } };
    } },
  } as unknown as SetupContext;
  return { context, state };
}

const open = fixture();
const record = await linkwarden.firstRun(open.context);
assert.equal(record.registrationClosed, false);
assert.equal(record.adminLoginVerified, true);
assert.equal(record.apiKeyVerified, true);
assert.equal(linkwarden.ready(record), false);
assert.equal(open.state.checkpoint.data.apiKeyRef, `${root}/api-key`);
assert.equal(open.state.checkpoint.data.selectionFingerprint, selection);
assert.deepEqual(await linkwarden.firstRun(open.context), record);
assert.equal(open.state.writes, 1);
assert.equal(open.state.keyReads, 2);
assert.equal(open.state.logins, 2);
assert.equal((await open.context.secrets.readSessionCookies()).bearer, SYNTHETIC_BEARER);

const passwordRejected = fixture(); passwordRejected.state.passwordAccepted = false;
await assert.rejects(linkwarden.firstRun(passwordRejected.context), /administrator login failed/);
assert.equal(passwordRejected.state.writes, 0);
assert.equal(passwordRejected.state.keyReads, 0);
assert.equal((await passwordRejected.context.secrets.readSessionCookies()).bearer, SYNTHETIC_BEARER);
for (const freshStatus of [401, 500]) {
  const freshRejected = fixture(); freshRejected.state.freshStatus = freshStatus;
  await assert.rejects(linkwarden.firstRun(freshRejected.context), /expired or was rejected|identity readback failed/);
  assert.equal(freshRejected.state.writes, 0);
  assert.equal((await freshRejected.context.secrets.readSessionCookies()).bearer, SYNTHETIC_BEARER);
}
const freshOtherOwner = fixture(); freshOtherOwner.state.freshUserId = 2;
await assert.rejects(linkwarden.firstRun(freshOtherOwner.context), /did not identify/);
assert.equal((await freshOtherOwner.context.secrets.readSessionCookies()).bearer, SYNTHETIC_BEARER);

const deferredKey = fixture(); deferredKey.state.keyPresent = false;
await assert.rejects(linkwarden.firstRun(deferredKey.context), /approval required/);
await assert.rejects(linkwarden.firstRun(deferredKey.context), /approval required/);
assert.equal(deferredKey.state.logins, 2);
assert.deepEqual(deferredKey.state.tokenAttempts[0], deferredKey.state.tokenAttempts[1]);

const rejected = fixture(); rejected.state.keyAccepted = false;
await assert.rejects(linkwarden.firstRun(rejected.context), /Saved Linkwarden API token/);
assert.equal(rejected.state.writes, 0);
assert.equal(rejected.state.checkpoint.data.apiKeyRef, undefined);

open.state.closed = true;
assert.equal(linkwarden.ready(await linkwarden.firstRun(open.context)), true);
assert.equal(open.state.probes, 1);
assert.equal(open.state.checkpoint.data.selectionFingerprint, selection);
open.state.manifest = "unrelated-app-added-manifest";
assert.equal(linkwarden.ready(await linkwarden.firstRun(open.context)), true);
assert.equal(open.state.probes, 1);
open.state.selection = "b".repeat(64);
await assert.rejects(linkwarden.firstRun(open.context), /closure proof differs/);
open.state.selection = selection;
delete open.state.checkpoint.data.selectionFingerprint;
await assert.rejects(linkwarden.firstRun(open.context), /closure proof differs/);
open.state.manifest = "initial-manifest";
assert.equal(linkwarden.ready(await linkwarden.firstRun(open.context)), true);

console.log("PASS Linkwarden key-bound account proof, unrelated-owner replay and selection refusal (synthetic)");
