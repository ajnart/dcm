import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSharedSetupObservationJournal, sharedProjectCommand, sharedSetupApproval } from "../src/shared-project.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { readSetupObservationJournal } from "../src/lib/setup-observation-journal.ts";
import { setupContractSha256 } from "../src/lib/setup-contract.ts";
import { runFirstRunSetups } from "../src/control-panel/setup-engine.ts";
import { SetupTransportDeferred } from "../src/control-panel/setup-transport.ts";

function selection(appId: string, port: number) {
  const imageTag = "docker.io/library/busybox:1.37.0";
  const service = (id: string, publishTargetPort: number | null) => ({ id, imageTag,
    user: "image-default", imageUserEvidence: { officialUrl: "https://example.test",
      reason: "official-image-runtime-contract" }, restart: "unless-stopped", readOnly: false,
    environment: [], hostEnvironment: [], fileEnvironment: [], mounts: [], dependsOn: [], publishTargetPort });
  const recipe = { schemaVersion: 2, kind: "multi-service-compose", appId,
    services: [service(appId, 8080), service("db", null)], privateFiles: [],
    defaults: { hostIp: "127.0.0.1", publishedPort: port }, storage: { minimumFreeBytes: 1_000_000 } };
  return { appId, recipe, images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}`,
    db: `${imageTag}@sha256:${"b".repeat(64)}` }, port };
}

const temporary = await mkdtemp(join(tmpdir(), "shared-setup-observation-fixture-"));
try {
  const selections = [selection("ollama", 18080), selection("ntfy", 18081)];
  const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId: "journal-fixture",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: selections,
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const reviewed = { operation: "create" as const, phase: "reviewed" as const,
    appIds: selections.map((item) => item.appId).sort() };
  const first = await saveSharedProjectState(candidate, reviewed,
    { revision: 0, manifestHash: null, checkpoint: null });
  const attempted = await saveSharedProjectState(candidate, { ...reviewed, phase: "attempted" },
    { revision: first.revision, manifestHash: first.manifestHash, checkpoint: first.checkpoint });
  const current = await saveSharedProjectState(candidate, { ...reviewed, phase: "completed" },
    { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  let recipeChanged = false;
  const recipeFor = (appId: string) => {
    const item = selections.find((entry) => entry.appId === appId)!;
    const recipe = structuredClone(item.recipe);
    if (recipeChanged) recipe.services[0]!.restart = "always";
    return { recipe, defaults: recipe.defaults, storage: recipe.storage, boundedApply: true,
      recipeSha256: createHash("sha256").update(JSON.stringify(recipe)).digest("hex") };
  };
  const appIds = selections.map((item) => item.appId);
  const contracts = Object.fromEntries(await Promise.all(appIds.map(async (appId) =>
    [appId, await setupContractSha256(appId, appIds)] as const)));
  const approval = sharedSetupApproval(current, appIds, {}, contracts);
  assert.notEqual(approval, sharedSetupApproval(current, appIds));
  assert.notEqual(approval, sharedSetupApproval(current, appIds, {}, { ...contracts, ollama: "c".repeat(64) }));
  assert.equal(approval, sharedSetupApproval(current, appIds, {},
    Object.fromEntries(Object.entries(contracts).reverse())));
  assert.throws(() => sharedSetupApproval(current, appIds, {}, { unknown: "c".repeat(64) }), /selected setup contracts/);

  // Production review binds the installed contracts but creates no observation journal.
  const logs: string[] = [];
  const original = console.log;
  console.log = (line: string) => { logs.push(line); };
  try {
    await sharedProjectCommand(["setup", "--project-root", temporary, "--project-id", "journal-fixture",
      "--app", "ollama", "--app", "ntfy", "--json"], { recipeFor,
      async resolveImage() { assert.fail("setup review must not resolve images"); } });
  } finally { console.log = original; }
  const review = JSON.parse(logs[0]!);
  assert.equal(review.mutation, false);
  assert.deepEqual(review.setup.setupContracts, contracts);
  assert.equal(existsSync(join(candidate.projectDirectory, "setup-observations.json")), false);
  await assert.rejects(sharedProjectCommand(["setup", "--project-root", temporary,
    "--project-id", "journal-fixture", "--app", "ollama", "--app", "ntfy",
    "--approve", sharedSetupApproval(current, ["ntfy", "ollama"]), "--json"], { recipeFor,
    async resolveImage() { assert.fail("setup must not resolve images"); } }), /exact saved project/);

  const observer = await createSharedSetupObservationJournal(current, appIds, recipeFor, contracts);
  assert.deepEqual(readSetupObservationJournal(candidate.projectDirectory), []);
  // Real adapters run concurrently up to the fake status boundary. No Docker, secrets, or network.
  let statusCalls = 0;
  let release!: () => void;
  const parallel = new Promise<void>((resolve) => { release = resolve; });
  const never = async () => { assert.fail("no private handoff or app transport expected"); };
  const outcomes = await runFirstRunSetups(temporary, appIds,
    { read: never, mutate: never, async approve() { return false; } }, {
      async status(appId) {
        statusCalls += 1;
        assert.ok(readSetupObservationJournal(candidate.projectDirectory)
          .some((event) => event.identity.appId === appId && event.outcome === "attempted"));
        if (statusCalls === appIds.length) release();
        await parallel;
        if (appId === "ntfy") throw new SetupTransportDeferred("Synthetic approval remains pending");
        throw new Error("Synthetic status unavailable");
      }, handoff: never,
    }, {}, appIds, observer);
  assert.equal(statusCalls, 2);
  assert.deepEqual(outcomes.map((item) => item.state), ["needs-inspection", "deferred"]);
  const events = readSetupObservationJournal(candidate.projectDirectory);
  assert.deepEqual(events.slice(0, 2).map((event) => event.outcome), ["attempted", "attempted"]);
  assert.deepEqual(events.slice(2).map((event) => event.outcome).sort(), ["deferred", "failed"]);
  for (const event of events) {
    assert.equal(event.identity.ownerRevision, current.revision);
    assert.equal(event.identity.manifestHash, current.manifestHash);
    assert.equal(event.identity.recipeSha256, recipeFor(event.identity.appId).recipeSha256);
    assert.equal(event.identity.setupSubjectSha256, contracts[event.identity.appId]);
    assert.deepEqual(event.identity.images, selections.find((item) => item.appId === event.identity.appId)!.images);
  }
  const bytes = await readFile(join(candidate.projectDirectory, "setup-observations.json"), "utf8");
  assert.equal(bytes.includes("Synthetic"), false);
  assert.equal(bytes.includes("acceptanceVerified"), false);
  assert.equal(bytes.includes("password"), false);
  await assert.rejects(createSharedSetupObservationJournal(current, ["ollama"], recipeFor,
    { ollama: "c".repeat(64) }), /contract changed/);
  const ready = await observer.before({ appId: "ollama", phase: "first-run" });
  await observer.after(ready);
  assert.equal(readSetupObservationJournal(candidate.projectDirectory).at(-1)!.outcome, "adapter-ready");
  const changed = await observer.before({ appId: "ollama", phase: "first-run" });
  recipeChanged = true;
  await assert.rejects(observer.after(changed), /exact saved recipe image/);
  await observer.error(changed, "failed");
  await assert.rejects(observer.before({ appId: "ollama", phase: "first-run" }), /exact saved recipe image/);
  recipeChanged = false;
  const stale = await observer.before({ appId: "ollama", phase: "first-run" });
  await saveSharedProjectState(candidate, { operation: "stop", phase: "reviewed", appIds: ["ollama"] },
    { revision: current.revision, manifestHash: current.manifestHash, checkpoint: current.checkpoint });
  await assert.rejects(observer.after(stale), /owner changed/);
  await observer.error(stale, "failed");
  console.log("shared setup production observation binding: pass (synthetic only)");
} finally { await rm(temporary, { recursive: true, force: true }); }
