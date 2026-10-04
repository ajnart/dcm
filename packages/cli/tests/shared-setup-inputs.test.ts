import assert from "node:assert/strict";
import { mock } from "bun:test";
import { collectSharedSetupInputArgs, sharedSetupStepBatch, sharedSetupOutcomeRecap,
  setupInputValueError } from "../src/control-panel/shared-setup-inputs.ts";
import { resolveSetupInputDefinitions } from "../src/control-panel/setup-engine.ts";

const prompts: string[] = [];
const notes: string[] = [];
const values = ["/data/movies", "/data/shows"];
mock.module("@clack/prompts", () => ({
  confirm: async ({ message }: { message: string }) => { prompts.push(message); return true; },
  text: async () => values.shift() ?? "",
  note: (message: string) => notes.push(message),
  outro: () => {},
}));
const { runSharedFirstRun } = await import("../src/control-panel/shared-create.ts");
const definitions = [{ appId: "jellyfin", key: "movies-path", label: "Movies directory" },
  { appId: "jellyfin", key: "shows-path", label: "Shows directory" }];
const inputs = ["--input", "jellyfin.movies-path=/data/movies", "--input", "jellyfin.shows-path=/data/shows"];
const selected = ["jellyfin", "sonarr"];
const steps = ["jellyfin", "sonarr"].map((appId, index) => ({ appId, action: "create-admin",
  token: `APP-SETUP-CREATE-ADMIN:${appId}:${String(index).repeat(64)}`, progress: `Create ${appId} admin` }));
let setupRound = 0;
const setupCalls: string[][] = [];
await runSharedFirstRun("/tmp/fixture", "selfhost", selected, {
  stopIfCancelled: (value) => value as never,
  async runJsonCli(args) {
    if (args[2] === "status") return { command: "app shared status", status: "completed",
      mutation: false, projectRoot: "/tmp/fixture", projectId: "selfhost", apps: selected, manualJobs: [] };
    setupCalls.push(args);
    const inputArgs = args.filter((_, index) => args[index] === "--input" || args[index - 1] === "--input");
    if (setupCalls.length > 1) assert.deepEqual(inputArgs, inputs);
    if (!args.includes("--approve")) {
      return { command: "app shared setup", status: "review", setup: {
        direct: selected, pending: [], inputDefinitions: definitions },
      approval: `SHARED-SETUP:selfhost:${String(setupCalls.length).repeat(64)}` };
    }
    assert.equal(args[args.indexOf("--approve") + 1], `SHARED-SETUP:selfhost:${"2".repeat(64)}`);
    setupRound += 1;
    if (setupRound === 1) return { command: "app shared setup", status: "setup-attempted", stepApprovals: steps };
    const approved = args.filter((_, index) => args[index - 1] === "--approve-step");
    assert.deepEqual(approved, steps.map((step) => step.token));
    return { command: "app shared setup", status: "setup-attempted", stepApprovals: [],
      outcomes: [{ appId: "jellyfin", state: "needs-inspection", detail: "Saved library path is absent; inspect before continuing" }] };
  },
});
assert.equal(setupCalls.length, 4, "initial review, input-bound review and two setup attempts");
assert.equal(prompts.length, 2, "one setup approval and one complete batch approval");
assert.ok(notes.some((note) => note.includes("Create jellyfin admin") && note.includes("Create sonarr admin")));
assert.ok(notes.some((note) => note.includes("Saved library path is absent; inspect before continuing")));
assert.deepEqual(await collectSharedSetupInputArgs(definitions, selected, async () => ""), []);
await assert.rejects(collectSharedSetupInputArgs([{ ...definitions[0], key: "api-key" }], selected, async () => ""), /non-secret/);
await assert.rejects(collectSharedSetupInputArgs(definitions, ["sonarr"], async () => ""), /non-secret/);
assert.throws(() => sharedSetupStepBatch([steps[0], steps[0]], selected), /invalid step/);
assert.equal(setupInputValueError("a\nb"), "Use at most 512 characters without control characters");
assert.match(sharedSetupOutcomeRecap([]), /No first-run result/);
const declared = await resolveSetupInputDefinitions(["jellyfin", "sonarr", "jellyfin"]);
assert.deepEqual(declared.map(({ appId, key }) => `${appId}.${key}`),
  ["jellyfin.movies-path", "jellyfin.shows-path", "sonarr.root-folder-path"]);
for (const closure of [
  { appId: "linkwarden", name: "NEXT_PUBLIC_DISABLE_REGISTRATION", from: "false", to: "true" },
  { appId: "stalwart-mail", name: "STALWART_RECOVERY_MODE", from: "1", to: null },
]) {
  const closureCalls: string[][] = [];
  let closed = false;
  let reviewedClosure = false;
  let accountProven = false;
  const accountToken = `APP-SETUP-FIRST-ADMIN:${closure.appId}:${"c".repeat(64)}`;
  await runSharedFirstRun("/tmp/fixture", "selfhost", [closure.appId], {
    stopIfCancelled: (value) => value as never,
    async runJsonCli(args) {
      closureCalls.push(args);
      const action = args[2];
      if (action === "status") return { command: "app shared status", status: "completed",
        mutation: false, projectRoot: "/tmp/fixture", projectId: "selfhost", apps: [closure.appId], manualJobs: [] };
      if (action === "transition-plan" || action === "transition-apply") {
        assert.deepEqual(args.filter((_, index) => args[index - 1] === "--app"), [closure.appId]);
        const base = { command: `app shared ${action}`, projectRoot: "/tmp/fixture", projectId: "selfhost",
          appId: closure.appId, serviceId: closure.appId, environment: {
            name: closure.name, from: closure.from, to: closure.to } };
        if (action === "transition-plan") {
          reviewedClosure = true;
          return { ...base, mutation: false, status: "review", approval: `TRANSITION:${closure.appId}:${"a".repeat(64)}` };
        }
        assert.equal(reviewedClosure, true);
        assert.equal(args[args.indexOf("--approve") + 1], `TRANSITION:${closure.appId}:${"a".repeat(64)}`);
        closed = true;
        return { ...base, mutation: true, status: "recreated-unverified" };
      }
      if (!args.includes("--approve")) return { command: "app shared setup", status: "review",
        setup: { direct: [closure.appId], pending: [], inputDefinitions: [] },
        approval: `SHARED-SETUP:selfhost:${String(Number(closed)).repeat(64)}` };
      assert.equal(args[args.indexOf("--approve") + 1], `SHARED-SETUP:selfhost:${String(Number(closed)).repeat(64)}`);
      if (closed) assert.equal(args.includes("--approve-step"), false, "old revision step tokens must not survive closure");
      if (!closed && !accountProven) {
        if (!args.includes("--approve-step")) return { command: "app shared setup", status: "setup-attempted",
          stepApprovals: [{ appId: closure.appId, action: "first-admin", token: accountToken, progress: "Create the first admin" }] };
        assert.equal(args[args.indexOf("--approve-step") + 1], accountToken);
        accountProven = true;
      }
      if (!closed) return { command: "app shared setup", status: "setup-attempted", stepApprovals: [],
        transitionCandidates: [closure.appId], outcomes: [{ appId: closure.appId, state: "needs-inspection",
          detail: "First account created; registration closure remains" }] };
      return { command: "app shared setup", status: "setup-attempted", stepApprovals: [], transitionCandidates: [],
        outcomes: [{ appId: closure.appId, state: "ready", detail: "Registration closure verified" }] };
    },
  });
  assert.equal(closed, true);
  assert.deepEqual(closureCalls.map((args) => args[2]),
    ["status", "setup", "setup", "setup", "transition-plan", "transition-apply", "setup", "setup"]);
  assert.ok(notes.some((note) => note.includes("Registration closure verified")));
  if (closure.to === null) assert.ok(notes.some((note) => note.includes("STALWART_RECOVERY_MODE: 1 → remove variable")));
}
const connectionCalls: string[][] = [];
let connectionRound = 0;
const connectionOwner = { projectRoot: "/tmp/fixture", projectId: "selfhost", revision: 1, manifestHash: "a".repeat(64) };
const connectionStep = { appId: "sonarr", action: "link-sonarr-test",
  token: `APP-SETUP-LINK-SONARR-TEST:sonarr:${"b".repeat(64)}`, progress: "Test the saved downloader connection" };
await runSharedFirstRun("/tmp/fixture", "selfhost", ["sonarr"], {
  stopIfCancelled: (value) => value as never,
  async runJsonCli(args) {
    if (args[0] === "connect") {
      connectionCalls.push(args);
      assert.equal(args[args.indexOf("--source") + 1], "sonarr");
      assert.equal(args[args.indexOf("--target") + 1], "qbittorrent");
      const base = { command: `connect ${args[1]}`, owner: connectionOwner, source: "sonarr", target: "qbittorrent" };
      if (args[1] === "plan") return { ...base, mutation: false,
        approval: `CONNECT:selfhost:${"c".repeat(64)}`, prerequisites: ["Existing downloader category required"] };
      assert.equal(args[args.indexOf("--approve") + 1], `CONNECT:selfhost:${"c".repeat(64)}`);
      if (++connectionRound === 1) return { ...base, mutation: false, status: "step-review",
        outcome: null, stepApprovals: [connectionStep] };
      assert.equal(args[args.indexOf("--approve-step") + 1], connectionStep.token);
      return { ...base, mutation: true, status: "api-link-verified", stepApprovals: [],
        outcome: { ...base, linkId: "sonarr-to-qbittorrent", status: "api-link-verified" } };
    }
    if (args[2] === "status") return { command: "app shared status", status: "completed", mutation: false,
      projectRoot: "/tmp/fixture", projectId: "selfhost", apps: ["sonarr", "qbittorrent"], manualJobs: [] };
    assert.deepEqual(args.filter((_, index) => args[index - 1] === "--app"), ["sonarr"], "only selected account setup runs");
    if (!args.includes("--approve")) return { command: "app shared setup", status: "review",
      setup: { direct: ["sonarr"], pending: [], inputDefinitions: [] }, approval: `SHARED-SETUP:selfhost:${"d".repeat(64)}` };
    return { command: "app shared setup", status: "setup-attempted", stepApprovals: [], transitionCandidates: [],
      outcomes: [{ appId: "sonarr", state: "ready", detail: "Saved account verified" }] };
  },
});
assert.deepEqual(connectionCalls.map((args) => args[1]), ["plan", "apply", "apply"]);
assert.ok(notes.some((message) => message.includes("Existing downloader category required")));
assert.ok(notes.some((message) => message.includes("sonarr → qbittorrent: verified")));
process.stdout.write("shared setup inputs, closure, retained-peer connections and approval retries passed (synthetic only)\n");
