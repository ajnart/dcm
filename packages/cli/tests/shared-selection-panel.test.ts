import assert from "node:assert/strict";
import { mock } from "bun:test";
import type { ProjectSnapshot } from "../src/control-panel/project-snapshot.ts";

const root = "/tmp/shared-selection-fixture";
function app(id: string) {
  return { id, url: `http://127.0.0.1:3000`, runtime: null, image: null, recipeSha256: null,
    update: { status: "unknown" as const, registryImage: null }, limitations: [] };
}
const initial: ProjectSnapshot = { root,
  owners: { project: false, cli: false, stack: false, appBatch: false, bundles: [], shared: ["shared"] },
  apps: [], shared: [{ id: "shared", stage: "completed", apps: [app("homarr"), app("paperless-ngx")] }] };
let latest = structuredClone(initial);
let desired: string[] | null = ["homarr", "uptime-kuma"];
let menu = ["selection", "exit"];
let confirmations = [true, true];
let wrongOwner = false;
let removalError: string | null = null;
let showCheckedRuntime = false;
const notes: string[] = [];
const calls: string[][] = [];
const additions: string[][] = [];
const mcpOffers: Array<{ root: string; url: string; projectId?: string }> = [];
const menuOptions: string[][] = [];
let failMcp = false;
let failSetup = false;
let failPublication = false;
let removedApps: Array<{ appId: string; status: "reviewable" | "needs-inspection" }> = [];
let wrongRestoreOwner = false;
const restorations: string[][] = [];
let checkSetupFlow = false;
let enrichmentSignal: AbortSignal | undefined;
const setupActions: Array<{ action: string; apps: string[] }> = [];
mock.module("@clack/prompts", () => ({
  select: async (prompt: { options: Array<{ value: string }> }) => {
    menuOptions.push(prompt.options.map((option) => option.value));
    return menu.shift();
  },
  confirm: async () => confirmations.shift() ?? false,
  note: (message: string) => notes.push(message), outro: () => {},
  cancel: () => {}, intro: () => {}, isCancel: (value: unknown) => typeof value === "symbol",
  multiselect: unsupportedPrompt, password: unsupportedPrompt, spinner: unsupportedPrompt, text: unsupportedPrompt,
}));
function unsupportedPrompt() { throw new Error("Unexpected interactive prompt"); }
mock.module("../src/control-panel/catalog-picker.ts", () => ({
  pickCatalogApps: async (items: Array<{ id: string; selected: boolean; installable?: boolean }>) => {
    assert.deepEqual(items.filter((item) => item.selected).map((item) => item.id).sort(), ["homarr", "paperless-ngx"]);
    assert.equal(items.find((item) => item.id === "discovery-only")?.installable, false);
    return desired;
  },
}));
mock.module("../src/control-panel/project-snapshot.ts", () => ({
  loadProjectSnapshot: async () => structuredClone(latest),
  enrichProjectSnapshot: async (snapshot: ProjectSnapshot, inspect: (args: string[]) => Promise<unknown>) => {
    if (checkSetupFlow) await inspect(["fixture-enrichment"]);
    if (!showCheckedRuntime) return snapshot;
    const checked = structuredClone(snapshot);
    for (const project of checked.shared) {
      for (const app of project.apps) {
        app.runtime = { state: "running", health: "healthy", checkedAt: "2026-10-04T00:00:00Z", source: "docker-compose" };
        app.update.status = "available";
      }
    }
    return checked;
  },
}));
mock.module("../src/control-panel/project-selection.ts", () => ({
  excludedAppIds: async () => { throw new Error("shared selection must not use an exclusion ledger"); },
  saveExcludedAppIds: async () => { throw new Error("shared selection must not write an exclusion ledger"); },
}));
const realSharedCreate = await import("../src/control-panel/shared-create.ts");
mock.module("../src/control-panel/shared-create.ts", () => ({
  sharedRemovedAppChoices: realSharedCreate.sharedRemovedAppChoices,
  reinstallSharedProjectApp: realSharedCreate.reinstallSharedProjectApp,
  addSharedProjectApps: async (_root: string, id: string, existing: Array<{ id: string }>,
    _dependencies: unknown, selected: string[]) => {
    assert.equal(id, "shared");
    assert.deepEqual(existing.map((item) => item.id), ["homarr"]);
    additions.push(selected);
    latest.shared[0].apps.push(app("uptime-kuma"));
    return true;
  },
  createSharedProject: async () => { throw new Error("must not create another owner"); },
  runSharedFirstRun: async (_root: string, _projectId: string, selected: string[]) => {
    setupActions.push({ action: "setup", apps: selected });
    if (checkSetupFlow) assert.equal(enrichmentSignal?.aborted, true, "Abort stale checks before account setup");
    if (failSetup) throw new Error("Synthetic account setup failed");
  },
  runSharedHomarr: async (selectedRoot: string, projectId: string, selected: string[],
    dependencies: { offerHomarrMcp?: (root: string, url: string, projectId?: string) => Promise<void> }) => {
    assert.ok(dependencies.offerHomarrMcp, "Dashboard setup must receive the same optional MCP offer");
    setupActions.push({ action: "homarr", apps: selected });
    if (failPublication) throw new Error("Synthetic publication failed");
    await dependencies.offerHomarrMcp(selectedRoot, "http://127.0.0.1:3000", projectId);
  },
}));
const { createControlPanel } = await import("../src/control-panel/flow.ts");
const unsupported = async () => { throw new Error("standalone owner must not be used"); };
const recipes = ["homarr", "paperless-ngx", "uptime-kuma"].map((id) => ({ appId: id, name: id, purpose: id,
  schemaVersion: 2, kind: "multi-service-compose", defaultPort: 3000, serviceCount: 1,
  recipeSha256: "a".repeat(64), recipeCapability: { boundedApply: true, maturity: "preview" } }));
const panel = createControlPanel({
  readOnlyCliJson: async (args, signal) => {
    assert.deepEqual(args, ["fixture-enrichment"]);
    enrichmentSignal = signal;
    return {};
  }, inspectFirstRun: unsupported, chooseRoot: unsupported,
  installRecipeBatchFlow: unsupported, installRecipeFlow: unsupported,
  offerOptionalHomarrFanIn: unsupported, offerConnectedHomarrApp: unsupported,
  resumeFlow: unsupported, planFlow: unsupported,
  async offerHomarrMcp(root, url, projectId) {
    mcpOffers.push({ root, url, projectId });
    if (failMcp) throw new Error("Synthetic optional MCP failure");
  },
  stopIfCancelled: (value) => value as never,
  invoke(args) {
    if (args[1] === "recipes") return { data: { recipes,
      catalogSource: { kind: "bundled", executionAuthority: "packaged" } } };
    return { data: { apps: [{ id: "discovery-only", name: "Discovery" }] } };
  },
  async runJsonCli(args) {
    if (args[2] === "status") return { command: "app shared status", projectRoot: root, projectId: "shared",
      status: "completed", mutation: false, apps: latest.shared[0].apps.map((entry) => entry.id), removedApps };
    if (args[2] === "reinstall") {
      restorations.push(args);
      assert.equal(args[args.indexOf("--project-root") + 1], root);
      assert.equal(args[args.indexOf("--project-id") + 1], "shared");
      assert.equal(args[args.indexOf("--app") + 1], "uptime-kuma");
      const result = { command: "app shared reinstall", projectRoot: root, projectId: "shared", appId: "uptime-kuma",
        retained: latest.shared[0].apps.map((entry) => entry.id).sort(), services: ["uptime-kuma"],
        images: { "uptime-kuma": `example.test/image@sha256:${"a".repeat(64)}` }, port: 3001,
        dataPreserved: true, credentialsRegenerated: false, accountSetupExecuted: false, acceptanceVerified: false };
      if (!args.includes("--approve")) return { ...result, projectId: wrongRestoreOwner ? "other" : "shared",
        status: "review", mutation: false, approval: `SHARED-REINSTALL:shared:${"c".repeat(64)}` };
      assert.equal(args[args.indexOf("--approve") + 1], `SHARED-REINSTALL:shared:${"c".repeat(64)}`);
      latest.shared[0].apps.push(app("uptime-kuma"));
      return { ...result, status: "restored-unverified", mutation: true };
    }
    calls.push(args);
    assert.deepEqual(args.slice(0, 3), ["app", "shared", "remove"]);
    assert.equal(args[args.indexOf("--project-root") + 1], root);
    assert.equal(args[args.indexOf("--project-id") + 1], "shared");
    if (removalError) throw new Error(removalError);
    assert.deepEqual(args.filter((_, index) => args[index - 1] === "--app"), ["paperless-ngx"]);
    const base = { command: "app shared remove", projectRoot: root,
      projectId: "shared", apps: ["paperless-ngx"], retained: ["homarr"], services: ["paperless-ngx"],
      dataPreserved: true, credentialsPreserved: true };
    if (!args.includes("--apply")) {
      if (wrongOwner) base.projectId = "other";
      return { ...base, status: "review", mutation: false, approval: `SHARED-REMOVE:shared:${"b".repeat(64)}` };
    }
    assert.equal(args[args.indexOf("--approval") + 1], `SHARED-REMOVE:shared:${"b".repeat(64)}`);
    assert.ok(!args.includes("--approve"), "removal uses the explicit engine apply/approval contract");
    latest.shared[0].apps = [app("homarr")];
    return { ...base, status: "removed-unverified", mutation: true };
  },
});
await panel.controlPanelFlow(initial);
assert.equal(calls.length, 2);
assert.deepEqual(additions, [["uptime-kuma"]]);
assert.ok(notes.some((line) => line.includes("Removed from this shared project: paperless-ngx")));
assert.ok(notes.some((line) => line.includes("Homarr publication for additions was offered separately")));
assert.ok(notes.some((line) => line.includes("Existing dashboard resources were retained")));

calls.length = 0; additions.length = 0; latest = structuredClone(initial);
menu = ["selection", "exit"]; confirmations = [false];
await panel.controlPanelFlow(initial);
assert.equal(calls.length, 0, "declining selection preview does not mutate or inspect removal");
assert.equal(additions.length, 0);

menu = ["selection", "exit"]; confirmations = [true, false];
await panel.controlPanelFlow(initial);
assert.equal(calls.length, 1, "declining exact removal review blocks additions");
assert.equal(additions.length, 0);

calls.length = 0; menu = ["selection", "exit"]; confirmations = [true]; wrongOwner = true;
await assert.rejects(panel.controlPanelFlow(initial), /selected owner/);
assert.equal(calls.length, 1);
assert.equal(additions.length, 0);

wrongOwner = false;
calls.length = 0; menu = ["selection", "exit"]; confirmations = [true];
removalError = "retained app homarr depends on a selected removal app";
await panel.controlPanelFlow(initial);
assert.equal(calls.length, 1);
assert.equal(additions.length, 0, "engine blocker prevents additions");
assert.ok(notes.some((line) => line.includes(removalError!) && line.includes("No removals or additions were applied")));

calls.length = 0; menu = ["selection", "exit"]; confirmations = [true]; desired = [];
removalError = "stop the project; full owner retirement is not implemented";
const successfulRecaps = notes.filter((line) => line.includes("Selection changes recorded")).length;
await panel.controlPanelFlow(initial);
assert.ok(notes.some((line) => line.toLowerCase().includes(removalError!)));
assert.equal(calls.length, 0, "last-unit removal is refused before dispatch");
assert.equal(notes.filter((line) => line.includes("Selection changes recorded")).length, successfulRecaps);
assert.equal(additions.length, 0);

removalError = null;
calls.length = 0; menu = ["selection", "exit"]; desired = ["homarr", "paperless-ngx"];
await panel.controlPanelFlow(initial);
assert.equal(calls.length, 0, "unchanged selection does not start stopped retained apps or apply image updates");
showCheckedRuntime = true;
menu = ["refresh", "exit"];
const beforeRefresh = notes.length;
await panel.controlPanelFlow(initial);
assert.ok(notes.slice(beforeRefresh).some((line) => line.includes("running, health healthy")
  && line.includes("image update available")), "Refresh must show its current checks, not discard them");

calls.length = 0;
menu = ["homarr-mcp", "exit"];
await panel.controlPanelFlow(initial);
assert.deepEqual(mcpOffers, [{ root, url: "http://127.0.0.1:3000", projectId: "shared" }]);
assert.equal(calls.length, 0, "MCP offer must not create another app owner or run dashboard publication");
assert.ok(menuOptions.at(-1)!.includes("homarr-mcp"));
menu = ["homarr", "exit"];
await panel.controlPanelFlow(initial);
assert.equal(mcpOffers.length, 2, "Explicit dashboard setup receives exactly one MCP callback");
assert.equal(mcpOffers[1]!.projectId, "shared");
failMcp = true;
menu = ["homarr-mcp", "exit"];
await panel.controlPanelFlow(initial);
assert.ok(notes.some((line) => line.includes("Dashboard setup is separate; no client configuration was installed")));
failMcp = false;
const withoutHomarr = structuredClone(initial);
withoutHomarr.shared[0]!.apps = [app("paperless-ngx")];
menu = ["exit"];
await panel.controlPanelFlow(withoutHomarr);
assert.ok(!menuOptions.at(-1)!.includes("homarr-mcp"), "Only installed shared Homarr owners offer MCP");

checkSetupFlow = true;
setupActions.length = 0;
latest = structuredClone(initial);
latest.shared[0]!.apps.push(app("uptime-kuma"));
menu = ["setup", "exit"];
await panel.controlPanelFlow(initial);
assert.deepEqual(setupActions, [
  { action: "setup", apps: ["homarr", "paperless-ngx"] },
  { action: "homarr", apps: ["homarr", "paperless-ngx", "uptime-kuma"] },
], "Publication follows setup and uses the freshly loaded same-owner selection");

setupActions.length = 0;
latest = structuredClone(withoutHomarr);
menu = ["setup", "exit"];
await panel.controlPanelFlow(withoutHomarr);
assert.deepEqual(setupActions, [{ action: "setup", apps: ["paperless-ngx"] }], "No Homarr owner means no publication");

setupActions.length = 0;
latest = structuredClone(initial);
failPublication = true;
menu = ["setup", "exit"];
await panel.controlPanelFlow(initial);
assert.deepEqual(setupActions.map((item) => item.action), ["setup", "homarr"]);
assert.ok(notes.some((line) => line.includes("Saved app accounts and setup checkpoints are retained")
  && line.includes("retry from Set up Homarr dashboard")));
failPublication = false;

setupActions.length = 0;
failSetup = true;
menu = ["setup", "exit"];
await assert.rejects(panel.controlPanelFlow(initial), /account setup failed/);
assert.deepEqual(setupActions.map((item) => item.action), ["setup"], "Setup failure cannot trigger publication or imply success");
failSetup = false;

setupActions.length = 0;
latest = structuredClone(initial);
latest.shared[0]!.stage = "prepared";
menu = ["setup", "exit"];
await panel.controlPanelFlow(initial);
assert.deepEqual(setupActions.map((item) => item.action), ["setup"], "A refreshed unfinished owner cannot publish");
checkSetupFlow = false;

// Exercise the reused offer itself with a synthetic CLI: no private files or live endpoint.
const { offerHomarrMcp } = await import("../src/interactive.ts");
const url = "http://127.0.0.1:3000";
async function offerScenario(projectId: string | undefined, changed: Record<string, unknown> = {}, failVerify = false) {
  const commands: string[][] = [];
  confirmations = [true]; menu = ["codex"];
  await offerHomarrMcp(root, url, projectId, async (args) => {
    commands.push(args);
    if (args[0] === "app") {
      if (projectId === undefined) {
        assert.deepEqual(args, ["app", "handoff", "--id", "homarr", "--project-root", root, "--json"]);
        return { command: "app handoff", appId: "homarr", url, secretful: false,
          apiKeyFile: `${root}/legacy/homarr-api-key`, ...changed };
      }
      assert.deepEqual(args, ["app", "shared", "handoff", "--app", "homarr", "--project-root", root,
        "--project-id", projectId, "--json"]);
      const privateFiles = `${root}/.selfhost/shared/${projectId}/secrets/homarr`;
      return { command: "app shared handoff", appId: "homarr", ownerKind: "shared", projectRoot: root,
        projectId, url, mutation: false, secretful: false, privateFiles,
        apiKeyFile: `${privateFiles}/homarr-api-key`, ...changed };
    }
    assert.deepEqual(args.slice(0, 2), ["homarr", "mcp"]);
    assert.equal(args[args.indexOf("--project-root") + 1], root);
    assert.equal(args[args.indexOf("--profile") + 1], "read-only");
    if (args[2] === "prepare") {
      assert.ok(args.includes("--require-read-only"));
      assert.equal(args[args.indexOf("--base-url") + 1], url);
      return { command: "homarr mcp prepare", status: "ready", capabilityMode: "read-only" };
    }
    if (args[2] === "verify") {
      if (failVerify) throw new Error("Synthetic verifier unavailable");
      return { command: "homarr mcp verify", status: "verified", capabilityMode: "read-only" };
    }
    assert.equal(args[2], "fragment", "No client installation or API-key creation is permitted");
    return { command: "homarr mcp fragment", status: "generated", capabilityMode: "read-only",
      fragmentPath: `${root}/fragment.toml`, installed: false };
  });
  return commands;
}
assert.equal((await offerScenario("shared")).length, 4);
assert.equal((await offerScenario("a".repeat(64))).length, 4, "Canonical long saved project IDs remain supported");
assert.equal((await offerScenario(undefined)).length, 4, "Legacy handoff behavior is unchanged");
for (const changed of [
  { projectId: "another-owner" }, { projectRoot: "/tmp/another-root" },
  { url: "http://127.0.0.1:9999" }, { apiKeyFile: `${root}/unowned-key` },
  { command: "app handoff" }, { secretful: true },
]) assert.equal((await offerScenario("shared", changed)).length, 1, "Mismatched shared handoff cannot prepare a profile");
assert.equal((await offerScenario("shared", {}, true)).length, 3, "Verifier failure never generates or installs a fragment");
assert.ok(notes.some((line) => line.includes("Dashboard setup and MCP verification are separate")));

// Removed IDs use the preserved-restore review, never the ordinary add/account path.
latest = structuredClone(initial); desired = ["homarr", "paperless-ngx", "uptime-kuma"];
showCheckedRuntime = false; checkSetupFlow = false; failSetup = false; failPublication = false;
removedApps = [{ appId: "uptime-kuma", status: "reviewable" }];
menu = ["selection", "exit"]; confirmations = [true, true];
calls.length = 0; additions.length = 0; restorations.length = 0; setupActions.length = 0;
await panel.controlPanelFlow(initial);
assert.equal(restorations.length, 2, "each removed app needs a fresh review and exact approved restore");
assert.equal(additions.length, 0, "removed IDs must never reach ordinary add");
assert.equal(calls.length, 0, "restore does not remove retained units");
assert.equal(setupActions.length, 0, "restore must not run first-account setup or dashboard writes");
assert.ok(notes.some((line) => line.includes("Restore preserved apps: uptime-kuma")));

latest = structuredClone(initial); menu = ["selection", "exit"]; confirmations = [true, false];
restorations.length = 0;
await panel.controlPanelFlow(initial);
assert.equal(restorations.length, 1, "declining restore sends no approval or mutation");
assert.deepEqual(latest.shared[0].apps.map((entry) => entry.id), ["homarr", "paperless-ngx"]);

latest = structuredClone(initial); menu = ["selection", "exit"]; confirmations = [true];
removedApps = [{ appId: "uptime-kuma", status: "needs-inspection" }]; desired = ["homarr", "uptime-kuma"];
restorations.length = 0; calls.length = 0;
await panel.controlPanelFlow(initial);
assert.equal(calls.length, 0, "unsupported restoration is named before any requested removal");
assert.equal(restorations.length, 0, "source-ineligible restoration cannot reach apply");
assert.ok(notes.some((line) => line.includes("Restoration needs inspection: uptime-kuma")));

latest = structuredClone(initial); menu = ["selection", "exit"]; confirmations = [true];
removedApps = [{ appId: "uptime-kuma", status: "reviewable" }]; desired = ["homarr", "paperless-ngx", "uptime-kuma"];
wrongRestoreOwner = true; restorations.length = 0;
await assert.rejects(panel.controlPanelFlow(initial), /selected app and owner/);
assert.equal(restorations.length, 1, "wrong-owner review never reaches restore apply");
wrongRestoreOwner = false;
process.stdout.write("shared searchable selection, exact removal approvals, seeded additions and cancellation passed (synthetic only)\n");
