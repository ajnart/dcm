import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompatibilityReceipts } from "../src/lib/compatibility-receipts.ts";
import { sharedAcceptance, sharedAcceptanceSubjectSha256, type SharedAcceptanceIdentity,
  type SharedAcceptanceOwner, type SharedAcceptanceRuntimeUnit } from "../src/lib/shared-acceptance.ts";

// Real packaged observer + approval transport, synthetic HTTP/runtime only. Zero live credit.
const root = await mkdtemp(join(tmpdir(), "shared-acceptance-session-fixture-"));
const digest = "a".repeat(64);
const projectId = "session-fixture";
const directory = join(root, ".selfhost", "shared", projectId);
const privateFiles = join(directory, "secrets", "beszel");
const passwordFile = join(privateFiles, "admin-password");
const password = "synthetic-session-fixture-password";
const identityId = "user00000000001";
const systemId = "system000000001";
const historyId = "history00000001";
const token = `e30.${Buffer.from(JSON.stringify({ id: identityId, type: "auth" })).toString("base64url")}.synthetic`;
const user = { id: identityId, collectionName: "users", email: "admin@example.test", role: "admin", verified: true };
const timestamp = new Date().toISOString();
const system = { id: systemId, name: "synthetic-system", host: "synthetic.invalid", port: "45876",
  users: [identityId], status: "up", updated: timestamp, info: { u: 1000, cpu: 5, mp: 25, dp: 20 } };
const history = { id: historyId, system: systemId, type: "1m", created: timestamp,
  stats: { cpu: 5, m: 8, mu: 2, mp: 25, d: 50, du: 10, dp: 20 } };
let loginRequests = 0;
let readRequests = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (request.method === "POST") {
    assert.equal(url.pathname, "/api/collections/users/auth-with-password");
    assert.deepEqual(await request.json(), { identity: user.email, password });
    loginRequests++;
    return Response.json({ token, record: user });
  }
  assert.equal(request.method, "GET");
  assert.equal(request.headers.get("authorization"), token);
  readRequests++;
  if (url.pathname === `/api/collections/users/records/${identityId}`) return Response.json(user);
  if (url.pathname === `/api/collections/systems/records/${systemId}`) return Response.json(system);
  assert.equal(url.pathname, "/api/collections/system_stats/records");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("perPage"), "1");
  assert.equal(url.searchParams.get("sort"), "-created");
  const filter = url.searchParams.get("filter");
  assert.ok(filter === `system='${systemId}' && type='1m'`
    || filter === `system='${systemId}' && type='1m' && id='${historyId}'`);
  return Response.json({ items: [history] });
} });

try {
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  await writeFile(passwordFile, password, { mode: 0o600 });
  const identity: SharedAcceptanceIdentity = { directory, projectRoot: root, projectId, appId: "beszel",
    ownerAppIds: ["beszel"], services: ["beszel"],
    contract: { appId: "beszel", dimension: "liveRestart", homarrMode: "native",
      owner: { projectFingerprint: digest, revision: 1, manifestHash: digest }, recipeSha256: digest,
      images: { beszel: `ghcr.io/henrygd/beszel:0.20.0@sha256:${digest}` },
      subjectSha256: (await sharedAcceptanceSubjectSha256("beszel", ["beszel"]))!,
      verifier: { id: "shared-app-acceptance", sourceSha256: digest, release: "1.0.0" } } };
  let unit: SharedAcceptanceRuntimeUnit = { serviceId: "beszel", imageId: `sha256:${digest}`,
    immutableImage: identity.contract.images.beszel!, startedAt: "2026-10-03T00:00:00.000Z", state: "running" };
  const lifecycle: string[] = [];
  const owner: SharedAcceptanceOwner = {
    async identity() { return structuredClone(identity); },
    async status() { return { command: "app status", appId: "beszel", projectRoot: root,
      ownerKind: "shared", ownerPhase: "completed", ownerRevision: 1, ownerRecordHash: digest,
      manifestHash: digest, status: "applied", mutation: false, projectId,
      runtime: { state: unit.state }, dockerContext: "default", port: server.port,
      url: `http://127.0.0.1:${server.port}`, composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
      applyApproval: `SHARED-APPLY:${projectId}:${digest}`, privateFiles, passwordFile,
      username: user.email }; },
    async handoff() { throw new Error("Synthetic status already provides exact private reference"); },
    async inspectRuntime() { return [{ ...unit }]; },
    async lifecycle(operation) {
      lifecycle.push(operation);
      if (operation === "stop") {
        assert.equal(unit.state, "running"); unit = { ...unit, state: "stopped" };
      } else {
        assert.equal(unit.state, "stopped");
        unit = { ...unit, state: "running", startedAt: "2026-10-03T00:01:00.000Z" };
      }
    },
    async lock(task) { return task(); },
  };
  const evidenceRoot = join(root, "evidence");
  const beginOptions = { action: "begin" as const, evidenceRoot, inputs: { "system-id": systemId } };
  const beginReview = await sharedAcceptance(beginOptions, owner);
  const withheldBegin = await sharedAcceptance({ ...beginOptions, approval: beginReview.approval }, owner);
  assert.equal(withheldBegin.status, "deferred");
  assert.equal(withheldBegin.stepApprovals?.length, 1);
  assert.equal(withheldBegin.stepApprovals![0]!.action, "beszel-acceptance-login");
  assert.equal(loginRequests, 0, "Withheld begin authentication sends no password/request");
  const resumedBeginReview = await sharedAcceptance(beginOptions, owner);
  const begun = await sharedAcceptance({ ...beginOptions, approval: resumedBeginReview.approval,
    approvedSteps: [withheldBegin.stepApprovals![0]!.token] }, owner);
  assert.equal(begun.status, "begun");
  assert.equal(loginRequests, 1);
  assert.equal(readRequests, 3);
  assert.deepEqual(lifecycle, []);

  const finishOptions = { action: "finish" as const, evidenceRoot };
  const finishReview = await sharedAcceptance(finishOptions, owner);
  const withheldFinish = await sharedAcceptance({ ...finishOptions, approval: finishReview.approval }, owner);
  assert.equal(withheldFinish.status, "deferred", "Pending session approval is not an application failure");
  assert.equal(withheldFinish.stepApprovals?.length, 1);
  assert.equal(withheldFinish.stepApprovals![0]!.action, "beszel-acceptance-login");
  assert.notEqual(withheldFinish.stepApprovals![0]!.token, withheldBegin.stepApprovals![0]!.token,
    "Finish login approval is bound to its original acceptance baseline checkpoint");
  assert.equal(loginRequests, 1, "Withheld finish auth never reaches the HTTP server");
  assert.deepEqual(lifecycle, ["stop", "start"]);
  const beforeResume = await loadCompatibilityReceipts(evidenceRoot, [identity.contract], { checkedAt: new Date().toISOString() });
  assert.equal(beforeResume.revision, 0);
  assert.equal(beforeResume.observations.length, 0, "Withheld authentication must not publish a failed receipt");
  const chronology = JSON.parse(await readFile(join(directory, "acceptance-run-beszel.json"), "utf8"));
  assert.equal(chronology.phase, "restarted");
  assert.equal(chronology.registry, null);
  assert.equal(chronology.checkedAt, null);

  const resumeReview = await sharedAcceptance(finishOptions, owner);
  const finished = await sharedAcceptance({ ...finishOptions, approval: resumeReview.approval,
    approvedSteps: [withheldFinish.stepApprovals![0]!.token] }, owner);
  assert.equal(finished.status, "finished");
  assert.equal(loginRequests, 2);
  assert.equal(readRequests, 7);
  assert.deepEqual(lifecycle, ["stop", "start"], "Resumed finish cannot stop/start an already restarted owner again");
  const afterResume = await loadCompatibilityReceipts(evidenceRoot, [identity.contract], { checkedAt: new Date().toISOString() });
  assert.equal(afterResume.revision, 1);
  assert.equal(afterResume.observations.length, 1);
  assert.equal(afterResume.observations[0]!.receipt?.result, "pass");
  const completeLedger = JSON.parse(await readFile(join(directory, "acceptance-run-beszel.json"), "utf8"));
  assert.deepEqual(completeLedger.baseline, chronology.baseline);
  assert.deepEqual(completeLedger.stopped, chronology.stopped);
  assert.deepEqual(completeLedger.running, chronology.running);
  assert.ok(!JSON.stringify(completeLedger).includes(password));
  assert.ok(!JSON.stringify(completeLedger).includes(token));
  console.log("Shared acceptance session fixture: actual Beszel transport approvals defer begin/finish without failure receipts; exact resumed finish preserves one stop/start; zero live credit");
} finally {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
