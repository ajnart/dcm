import assert from "node:assert/strict";
import { mock } from "bun:test";
import { collectSharedInstallInputArgs, installInputError } from "../src/control-panel/shared-install-inputs.ts";

const definitions = [{ key: "canonical-origin", label: "Exact canonical HTTPS origin", maxLength: 512 },
  { key: "magic-dns-domain", label: "Owner-selected MagicDNS FQDN", maxLength: 253 }];
const choice = { appId: "headscale", name: "Headscale", purpose: "Private coordination", defaultPort: null,
  kind: "shared-derived-compose",
  installInputDefinitions: definitions };
const inputs = ["--input", "headscale.canonical-origin=https://headscale.example.invalid",
  "--input", "headscale.magic-dns-domain=mesh.example.invalid"];
const values = ["https://headscale.example.invalid", "mesh.example.invalid",
  "https://headscale.example.invalid", "mesh.example.invalid"];
const notes: string[] = [];
const outros: string[] = [];
const textMessages: string[] = [];
let pickerSelection = ["headscale"];
const choices: any[] = [choice];
let publicationFailure = false;
let allowPublication = true;
let directSetup = false;
mock.module("@clack/prompts", () => ({
  confirm: async ({ message }: { message: string }) => {
    if (message.startsWith("Add these apps, integrations")) return allowPublication;
    return true;
  }, note: (message: string) => notes.push(message), outro: (message: string) => outros.push(message),
  text: async ({ message, validate }: { message: string; validate: (value: string) => string | undefined }) => {
    textMessages.push(message);
    const value = values.shift()!;
    assert.equal(validate(value), undefined);
    return value;
  } }));
mock.module("../src/interactive-catalog.ts", () => ({ bundledSharedRecipeChoices: () => choices }));
mock.module("../src/control-panel/catalog-picker.ts", () => ({ pickCatalogApps: async () => pickerSelection }));
const { createSharedProject, addSharedProjectApps, runSharedHomarr } = await import("../src/control-panel/shared-create.ts");
const calls: string[][] = [];
let changedAdditionalPort = false;
const root = "/tmp/install-input-fixture";
const dependencies = {
  stopIfCancelled: <T>(value: T | symbol) => value as T,
  invoke: () => ({ data: { apps: [] } }),
  async runJsonCli(args: string[]) {
    calls.push(args);
    const action = args[2];
    if (action === "status") return { command: "app shared status", status: "completed", mutation: false,
      projectRoot: root, projectId: "existing", apps: calls.some((call) => call[2] === "add" && call.includes("--approve"))
        ? ["headscale", "homarr"] : ["homarr"], manualJobs: [], removedApps: [] };
    if (action === "setup") return { command: "app shared setup", status: "review", setup: { direct: [], pending: ["headscale"] } };
    if (action === "homarr-plan") {
      assert.deepEqual(args.filter((_, index) => args[index - 1] === "--app"), ["headscale", "homarr"]);
      if (publicationFailure) return { command: "app shared homarr-plan", status: "planned", services: [], pending: [],
        approval: `SHARED-HOMARR:existing:${"c".repeat(64)}` };
      return { command: "app shared homarr-plan", status: "planned", services: [],
        pending: [{ id: "headscale", requiredInputs: ["saved-account"] }] };
    }
    if (action === "homarr-apply") throw new Error("Synthetic publication failed after saved addition");
    assert.equal(args.includes("--port"), false, "generated ports are planned by the owning engine, not invented by discovery");
    assert.deepEqual(args.filter((_, index) => args[index] === "--input" || args[index - 1] === "--input"), inputs);
    if (action === "plan") return { command: "app shared plan", status: "review", apps: ["headscale"],
      ports: { headscale: 8080 },
      publishedPorts: { headscale: { extra: 8081 } },
      setup: { direct: [], pending: ["headscale"] }, ownerSecretIds: [],
      approval: `SHARED-PLAN:selfhost:${"a".repeat(64)}` };
    if (action === "apply") return { command: "app shared apply", status: "applied-unverified", apps: ["headscale"],
      ports: { headscale: 8080 }, publishedPorts: { headscale: { extra: changedAdditionalPort ? 8082 : 8081 } } };
    const base = { command: "app shared add", projectRoot: root, projectId: "existing",
      added: ["headscale"], retained: ["homarr"], services: ["headscale"], ports: { headscale: 8080 },
      publishedPorts: { headscale: { extra: 8081 } },
      setup: { direct: [], pending: ["headscale"] }, ownerSecretIds: [],
      approval: `SHARED-ADD:existing:${"b".repeat(64)}` };
    if (directSetup) base.setup = { direct: ["headscale"], pending: [] };
    if (!args.includes("--approve")) return { ...base, status: "review", mutation: false };
    return { ...base, status: "added-unverified", mutation: true };
  },
};
assert.equal(await createSharedProject(root, dependencies), true);
assert.equal(await addSharedProjectApps(root, "existing", [{ id: "homarr", url: "http://127.0.0.1:3000", publishedPort: 3000 }],
  dependencies, ["headscale"]), true);
assert.deepEqual(calls.map((args) => args[2]), ["plan", "apply", "status", "add", "add", "status", "homarr-plan"]);
assert.ok(notes.some((message) => message.includes("missing saved-account")));
values.push("https://headscale.example.invalid", "mesh.example.invalid");
calls.length = 0;
assert.equal(await addSharedProjectApps(root, "existing", [{ id: "homarr", url: "http://127.0.0.1:3000", publishedPort: 3000 }],
  dependencies, ["headscale"], false), true);
assert.deepEqual(calls.map((args) => args[2]), ["status", "add", "add"], "Capability continuation owns its separate publication");
values.push("https://headscale.example.invalid", "mesh.example.invalid");
calls.length = 0;
publicationFailure = true;
assert.equal(await addSharedProjectApps(root, "existing", [{ id: "homarr", url: "http://127.0.0.1:3000", publishedPort: 3000 }],
  dependencies, ["headscale"]), true, "A failed dashboard write must not hide the saved addition");
assert.deepEqual(calls.map((args) => args[2]), ["status", "add", "add", "status", "homarr-plan", "homarr-apply"]);
assert.ok(notes.some((message) => message.includes("Additions are saved. Homarr publication remains pending")));
values.push("https://headscale.example.invalid", "mesh.example.invalid");
calls.length = 0;
directSetup = true;
allowPublication = false;
assert.equal(await addSharedProjectApps(root, "existing", [{ id: "homarr", url: "http://127.0.0.1:3000", publishedPort: 3000 }],
  dependencies, ["headscale"]), true);
assert.deepEqual(calls.map((args) => args[2]), ["status", "add", "add", "status", "setup", "status", "homarr-plan"],
  "Setup precedes dashboard review, and declining publication cannot apply or replay additions");
directSetup = false;
allowPublication = true;
choices.push({ appId: "homarr", name: "Homarr", purpose: "Dashboard", defaultPort: 3000,
  kind: "multi-service-compose" });
for (const addHomarr of [false, true]) {
  values.push("https://headscale.example.invalid", "mesh.example.invalid");
  const selected = ["headscale"];
  if (addHomarr) selected.push("homarr");
  const scenarioCalls: string[][] = [];
  const scenario = { ...dependencies, async runJsonCli(args: string[]) {
    scenarioCalls.push(args);
    const action = args[2];
    if (action === "status") return { command: "app shared status", status: "completed", mutation: false,
      projectRoot: root, projectId: "existing", apps: scenarioCalls.some((call) => call[2] === "add" && call.includes("--approve"))
        ? ["alpha", ...selected] : ["alpha"], manualJobs: [], removedApps: [] };
    if (action === "homarr-plan") {
      assert.deepEqual(args.filter((_, index) => args[index - 1] === "--app"), ["alpha", "headscale", "homarr"],
        "A newly added dashboard must offer publication of retained apps too");
      return { command: "app shared homarr-plan", status: "planned", services: [],
        pending: [{ id: "homarr", requiredInputs: ["saved-api-key"] }] };
    }
    assert.equal(action, "add");
    const ports: Record<string, number> = { headscale: 8080 };
    const publishedPorts: Record<string, Record<string, number>> = { headscale: { extra: 8081 } };
    if (addHomarr) ports.homarr = 3000;
    if (addHomarr) publishedPorts.homarr = {};
    const base = { command: "app shared add", projectRoot: root, projectId: "existing",
      added: selected, retained: ["alpha"], services: selected, ports,
      publishedPorts, setup: { direct: [], pending: selected }, ownerSecretIds: [],
      approval: `SHARED-ADD:existing:${"b".repeat(64)}` };
    if (!args.includes("--approve")) return { ...base, status: "review", mutation: false };
    return { ...base, status: "added-unverified", mutation: true };
  } };
  assert.equal(await addSharedProjectApps(root, "existing", [{ id: "alpha", url: "http://127.0.0.1:9000", publishedPort: 9000 }],
    scenario, selected), true);
  const actions = scenarioCalls.map((args) => args[2]);
  if (addHomarr) assert.deepEqual(actions, ["status", "add", "add", "status", "homarr-plan"]);
  else assert.deepEqual(actions, ["status", "add", "add"], "An owner without Homarr must not offer publication");
}
await assert.rejects(collectSharedInstallInputArgs([choice], ["headscale"], async () => ""), /missing or invalid/);
await assert.rejects(collectSharedInstallInputArgs([{ ...choice, installInputDefinitions: [
  { key: "api-key", label: "Secret", maxLength: 32 }] }], ["headscale"], async () => "x"), /secret-bearing/);
assert.ok(installInputError("x".repeat(254), definitions[1]));
assert.equal(values.length, 0);
values.push("https://headscale.example.invalid", "mesh.example.invalid");
changedAdditionalPort = true;
await assert.rejects(createSharedProject(root, dependencies), /Additional generated ports differ/);
for (const missingTopic of [false, true]) {
  const scenarioCalls: string[][] = [];
  const beforePrompts = textMessages.length;
  const freshApproval = `SHARED-HOMARR:existing:${"d".repeat(64)}`;
  const initialApproval = `SHARED-HOMARR:existing:${"e".repeat(64)}`;
  if (missingTopic) values.push("owner-notifications");
  await runSharedHomarr(root, "existing", ["homarr", "ntfy"], {
    stopIfCancelled: dependencies.stopIfCancelled,
    async runJsonCli(args: string[]) {
      scenarioCalls.push(args);
      const action = args[2];
      const supplied = args.filter((_, index) => args[index] === "--input" || args[index - 1] === "--input");
      if (action === "status") return { command: "app shared status", status: "completed", mutation: false,
        projectRoot: root, projectId: "existing", apps: ["homarr", "ntfy"], manualJobs: [] };
      if (action === "homarr-plan") {
        const firstPlan = scenarioCalls.filter((call) => call[2] === action).length === 1;
        if (firstPlan || !missingTopic) assert.deepEqual(supplied, [], "First review must reuse saved choices without overriding the topic");
        else assert.deepEqual(supplied, ["--input", "ntfy.topic=owner-notifications"]);
        return { command: "app shared homarr-plan", status: "planned", services: [],
          pending: firstPlan && missingTopic ? [{ id: "ntfy", requiredInputs: ["topic"] }] : [],
          approval: firstPlan ? initialApproval : freshApproval };
      }
      if (action === "homarr-apply") {
        if (missingTopic) assert.deepEqual(supplied, ["--input", "ntfy.topic=owner-notifications"]);
        else assert.deepEqual(supplied, [], "A retained topic must not become an explicit default override");
        assert.equal(args[args.indexOf("--approve") + 1], missingTopic ? freshApproval : initialApproval,
          "Apply must bind the exact final review and topic");
        return { command: "app shared homarr-apply", status: "attached", services: [] };
      }
      assert.equal(action, "homarr-status");
      throw new Error("Synthetic live status unavailable");
    },
  });
  assert.equal(textMessages.length - beforePrompts, Number(missingTopic), "Only a missing topic may prompt");
  assert.equal(scenarioCalls.filter((args) => args[2] === "homarr-plan").length, 1 + Number(missingTopic));
  assert.equal(values.length, 0);
}
pickerSelection = ["homarr"];
for (const outcome of ["publication-failed", "pending", "declined", "apply-failed", "setup-failed"]) {
  const scenarioCalls: string[][] = [];
  const beforeNotes = notes.length;
  const beforeOutros = outros.length;
  allowPublication = outcome !== "declined";
  const scenario = { ...dependencies, async runJsonCli(args: string[]) {
    scenarioCalls.push(args);
    const action = args[2];
    if (action === "plan") return { command: "app shared plan", status: "review", apps: ["homarr"],
      setup: { direct: ["homarr"], pending: [] }, ownerSecretIds: [],
      approval: `SHARED-PLAN:selfhost:${"a".repeat(64)}` };
    if (action === "apply") {
      if (outcome === "apply-failed") throw new Error("Synthetic new apply failed");
      return { command: "app shared apply", status: "applied-unverified", apps: ["homarr"] };
    }
    if (action === "status") return { command: "app shared status", status: "completed", mutation: false,
      projectRoot: root, projectId: "selfhost", apps: ["homarr"], manualJobs: [] };
    if (action === "setup") {
      if (outcome === "setup-failed") throw new Error("Synthetic new setup failed");
      return { command: "app shared setup", status: "review", setup: { direct: [], pending: ["homarr"] } };
    }
    if (action === "homarr-plan") {
      const pending: Array<{ id: string; requiredInputs: string[] }> = [];
      if (outcome === "pending") pending.push({ id: "homarr", requiredInputs: ["saved-api-key"] });
      return { command: "app shared homarr-plan", status: "planned", services: [], pending,
        approval: `SHARED-HOMARR:selfhost:${"c".repeat(64)}` };
    }
    assert.equal(action, "homarr-apply");
    assert.equal(args[args.indexOf("--approve") + 1], `SHARED-HOMARR:selfhost:${"c".repeat(64)}`);
    throw new Error("Synthetic new dashboard write failed");
  } };
  if (outcome === "apply-failed" || outcome === "setup-failed") {
    await assert.rejects(createSharedProject(root, scenario), /Synthetic new (apply|setup) failed/);
    assert.equal(scenarioCalls.some((args) => args[2] === "homarr-plan"), false,
      "Apply and account setup failures must stop before dashboard publication");
    assert.equal(outros.length, beforeOutros, "Failed apply/setup cannot present the saved-project handoff");
  } else {
    assert.equal(await createSharedProject(root, scenario), true, "Saved creation survives failed, pending or declined dashboard publication");
    assert.equal(outros.length, beforeOutros + 1);
    assert.ok(outros.at(-1)!.includes(`Shared project saved at ${root}`));
    assert.equal(scenarioCalls.filter((args) => args[2] === "apply").length, 1);
    const written = scenarioCalls.some((args) => args[2] === "homarr-apply");
    assert.equal(written, outcome === "publication-failed");
    assert.ok(!notes.slice(beforeNotes).some((message) => message.includes("Dashboard resources were read back")),
      "Unpublished dashboards cannot be reported as verified");
    if (outcome === "publication-failed") assert.ok(notes.slice(beforeNotes).some((message) =>
      message.includes("shared stack remains saved") && message.includes("retry from Set up Homarr dashboard")));
  }
}
allowPublication = true;
const restoreCalls: string[][] = [];
const restoreDependencies = { ...dependencies, async runJsonCli(args: string[]) {
  restoreCalls.push(args);
  if (args[2] === "status") return { command: "app shared status", status: "completed", mutation: false,
    projectRoot: root, projectId: "existing", apps: ["alpha"], removedApps: [{ appId: "homarr", status: "reviewable" }] };
  assert.equal(args[2], "reinstall", "Removed app additions must never generate accounts or use ordinary add");
  assert.deepEqual(args.filter((_, index) => args[index - 1] === "--app"), ["homarr"]);
  const result = { command: "app shared reinstall", projectRoot: root, projectId: "existing", appId: "homarr",
    retained: ["alpha"], services: ["homarr"], port: 3000, images: { homarr: `example.test/image@sha256:${"a".repeat(64)}` },
    dataPreserved: true, credentialsRegenerated: false, accountSetupExecuted: false, acceptanceVerified: false };
  if (!args.includes("--approve")) return { ...result, status: "review", mutation: false,
    approval: `SHARED-REINSTALL:existing:${"f".repeat(64)}` };
  assert.equal(args[args.indexOf("--approve") + 1], `SHARED-REINSTALL:existing:${"f".repeat(64)}`);
  return { ...result, status: "restored-unverified", mutation: true };
} };
assert.equal(await addSharedProjectApps(root, "existing", [{ id: "alpha", url: "http://127.0.0.1:9000", publishedPort: 9000 }],
  restoreDependencies, ["homarr"]), true);
assert.deepEqual(restoreCalls.map((args) => args[2]), ["status", "reinstall", "reinstall"],
  "A restored dashboard must not enter first-admin setup or automatic dashboard publication");
process.stdout.write("declared installation inputs bind create/add reviews and applies (synthetic only)\n");
