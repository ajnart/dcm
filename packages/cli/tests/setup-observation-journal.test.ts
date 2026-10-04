import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupObservationJournal, readSetupObservationJournal,
  type SetupObservationIdentity } from "../src/lib/setup-observation-journal.ts";
import { inspectFirstRunSetup, runFirstRunSetups } from "../src/control-panel/setup-engine.ts";
import { SetupTransportDeferred } from "../src/control-panel/setup-transport.ts";
import ollama from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ollama/setup.ts";

const temporary = mkdtempSync(join(tmpdir(), "setup-observation-fixture-"));
const directory = join(temporary, "fixture-owner");
mkdirSync(directory, { mode: 0o700 });
const initial: SetupObservationIdentity = { appId: "fixture-app", projectId: "fixture-owner",
  ownerRevision: 1, manifestHash: "a".repeat(64), recipeSha256: "b".repeat(64),
  setupSubjectSha256: "c".repeat(64), images: { "fixture-app": `registry.example/app:1@sha256:${"d".repeat(64)}` } };
let current = structuredClone(initial);
const observer = createSetupObservationJournal({ directory, async identity() { return current; } });
try {
  assert.deepEqual(readSetupObservationJournal(directory), []);
  const first = await observer.before({ appId: initial.appId, phase: "first-run" });
  assert.equal(readSetupObservationJournal(directory)[0]!.outcome, "attempted");
  const attemptBytes = readFileSync(join(directory, "setup-observations.json"), "utf8");
  await observer.after(first);
  const second = await observer.before({ appId: initial.appId, phase: "inspect" });
  await observer.after(second);
  assert.deepEqual(readSetupObservationJournal(directory).map((event) => event.outcome),
    ["attempted", "adapter-ready", "attempted", "adapter-ready"]);
  assert.equal(JSON.parse(attemptBytes).events[0].attemptId, first);
  assert.equal(lstatSync(join(directory, "setup-observations.json")).mode & 0o777, 0o600);

  const stale = await observer.before({ appId: initial.appId, phase: "first-run" });
  current.ownerRevision += 1;
  await assert.rejects(observer.after(stale), /unsafe, stale/);
  await observer.error(stale, "failed");
  await observer.error(stale, "failed"); // Idempotent error recording, no duplicate terminal event.
  const resumed = await observer.before({ appId: initial.appId, phase: "first-run" });
  await observer.error(resumed, "deferred");
  assert.deepEqual(readSetupObservationJournal(directory).map((event) => event.outcome).slice(-4),
    ["attempted", "failed", "attempted", "deferred"]);
  await assert.rejects(observer.after(resumed), /unsafe, stale/);
  assert.equal(readSetupObservationJournal(directory).length, 8);

  const recreated = createSetupObservationJournal({ directory, async identity() { return current; } });
  const third = await recreated.before({ appId: initial.appId, phase: "inspect" });
  await recreated.after(third);
  assert.equal(readSetupObservationJournal(directory).at(-1)!.ordinal, 10);
  const journalBytes = readFileSync(join(directory, "setup-observations.json"), "utf8");
  assert.ok(!journalBytes.includes("loginVerified"));
  assert.ok(!journalBytes.includes("fresh"));
  assert.ok(!journalBytes.includes("password"));

  chmodSync(join(directory, "setup-observations.json"), 0o644);
  assert.throws(() => readSetupObservationJournal(directory), /unsafe/);
  chmodSync(join(directory, "setup-observations.json"), 0o600);
  const alias = join(temporary, "alias");
  symlinkSync(directory, alias);
  assert.throws(() => readSetupObservationJournal(alias), /unsafe/);
  const changed = createSetupObservationJournal({ directory, async identity() {
    return { ...current, images: { "fixture-app": "registry.example/app:latest" } };
  } });
  await assert.rejects(changed.before({ appId: initial.appId, phase: "first-run" }), /unsafe/);

  // Engine rejects unavailable adapters before invoking observer or any app transport.
  let observations = 0;
  const unavailable = { async before() { observations += 1; return "unused"; },
    async after() { observations += 1; }, async error() { observations += 1; } };
  const never = async () => { throw new Error("No app request expected"); };
  const outcomes = await runFirstRunSetups(temporary, ["absent-app"],
    { read: never, mutate: never, async approve() { return false; } }, undefined, {}, undefined, unavailable);
  assert.equal(outcomes[0]!.state, "needs-inspection");
  await inspectFirstRunSetup(temporary, "absent-app", never, undefined, unavailable);
  assert.equal(observations, 0);

  // Real packaged adapter entry is observed before its status read; no network or secrets are accessed.
  const ollamaObserver = createSetupObservationJournal({ directory, async identity() {
    return { ...current, appId: "ollama" };
  } });
  let calls = 0;
  const owner = { async status() {
    calls += 1;
    assert.equal(readSetupObservationJournal(directory).at(-1)!.outcome, "attempted");
    throw new Error("Fixture owner is unavailable");
  }, handoff: never };
  const failed = await runFirstRunSetups(temporary, ["ollama"],
    { read: never, mutate: never, async approve() { return false; } }, owner, {}, ["ollama"], ollamaObserver);
  assert.equal(failed[0]!.state, "needs-inspection");
  assert.equal(readSetupObservationJournal(directory).at(-1)!.outcome, "failed");
  await inspectFirstRunSetup(temporary, "ollama", never, owner, ollamaObserver);
  assert.equal(readSetupObservationJournal(directory).at(-1)!.phase, "inspect");
  assert.equal(readSetupObservationJournal(directory).at(-1)!.outcome, "failed");
  const deferred = await runFirstRunSetups(temporary, ["ollama"],
    { read: never, mutate: never, async approve() { return false; } }, {
      async status() { throw new SetupTransportDeferred("Fixture deferred approval"); }, handoff: never,
    }, {}, ["ollama"], ollamaObserver);
  assert.equal(deferred[0]!.state, "deferred");
  assert.equal(readSetupObservationJournal(directory).at(-1)!.outcome, "deferred");
  assert.equal(calls, 2);

  // Error journaling failures preserve per-app outcomes and never replay adapter work.
  const recordedErrors: { attemptId: string; outcome: string }[] = [];
  const warnings: unknown[][] = [];
  const previousConsoleError = console.error;
  const failingObserver = { async before(call: { appId: string }) { return call.appId; },
    async after() { throw new Error("Unexpected ready observation"); },
    async error(attemptId: string, outcome: "failed" | "deferred") {
      recordedErrors.push({ attemptId, outcome });
      throw new Error("synthetic-private-observer-error");
    } };
  console.error = (...values: unknown[]) => { warnings.push(values); };
  try {
    const statusCalls: string[] = [];
    const isolatedOwner = { async status(appId: string) {
      statusCalls.push(appId);
      if (appId === "valkey") throw new SetupTransportDeferred("Fixture deferred approval");
      throw new Error("Fixture original owner failure");
    }, handoff: never };
    const isolated = await runFirstRunSetups(temporary, ["ollama", "valkey"],
      { read: never, mutate: never, async approve() { return false; } },
      isolatedOwner, {}, ["ollama", "valkey"], failingObserver);
    assert.deepEqual(isolated, [
      { appId: "ollama", state: "needs-inspection", detail: "Fixture original owner failure" },
      { appId: "valkey", state: "deferred", detail: "Fixture deferred approval" },
    ]);
    assert.deepEqual(statusCalls.sort(), ["ollama", "valkey"]);
    const inspected = await inspectFirstRunSetup(temporary, "ollama", never, isolatedOwner, failingObserver);
    assert.equal(inspected.state, "needs-inspection");
    assert.equal(inspected.detail, "Fixture original owner failure");
    assert.equal(statusCalls.length, 3);

    const firstRun = ollama.firstRun;
    const inspect = ollama.inspect;
    let adapterCalls = 0;
    const unverified = async () => {
      adapterCalls += 1;
      return { appId: "ollama", projectRoot: temporary, ready: false };
    };
    ollama.firstRun = unverified;
    ollama.inspect = unverified;
    try {
      const incomplete = await runFirstRunSetups(temporary, ["ollama"],
        { read: never, mutate: never, async approve() { return false; } },
        isolatedOwner, {}, ["ollama"], failingObserver);
      assert.equal(incomplete[0]!.detail, "First-run checkpoint is not verified");
      assert.equal(incomplete[0]!.state, "needs-inspection");
      const incompleteInspection = await inspectFirstRunSetup(temporary, "ollama", never, isolatedOwner, failingObserver);
      assert.equal(incompleteInspection.detail, "Saved first-run result is not verified");
      assert.equal(incompleteInspection.state, "needs-inspection");
      assert.equal(adapterCalls, 2);
    } finally {
      ollama.firstRun = firstRun;
      ollama.inspect = inspect;
    }
    assert.equal(recordedErrors.length, 5);
    assert.equal(recordedErrors.filter((entry) => entry.outcome === "deferred").length, 1);
    assert.equal(warnings.length, 5);
    for (const warning of warnings) assert.deepEqual(warning, [
      "Setup outcome preserved; compatibility evidence is incomplete. Inspect without replaying setup mutations.",
    ]);
    assert.ok(!JSON.stringify(warnings).includes("synthetic-private-observer-error"));
  } finally { console.error = previousConsoleError; }

  // A full catalog's three approval rounds exceed the former 512-event limit.
  const catalogDirectory = join(temporary, "catalog-owner");
  mkdirSync(catalogDirectory, { mode: 0o700 });
  const catalogObserver = createSetupObservationJournal({ directory: catalogDirectory,
    async identity(appId) { return { ...current, appId, projectId: "catalog-owner" }; } });
  for (let app = 0; app < 94; app += 1) {
    for (let round = 0; round < 3; round += 1) {
      const attempt = await catalogObserver.before({ appId: `app-${app}`, phase: "first-run" });
      await catalogObserver.error(attempt, "deferred");
    }
  }
  assert.equal(readSetupObservationJournal(catalogDirectory).length, 94 * 3 * 2);
  console.log("setup observation chronology: pass");
} finally { rmSync(temporary, { recursive: true, force: true }); }
