import assert from "node:assert/strict";
import { compileWarriorRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/configuration.ts";
import { mutableConfigHook } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/mutable-config.ts";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/setup.ts";
import prestart from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/pre-start.ts";
import { checkedHttpBasicOnboarding } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/http-basic.ts";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import manifest from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/manifest.json";

const inputs = { downloader: "fixture-warrior", "selected-project": "none", concurrency: "1",
  "outbound-policy": "hq-registration-and-updates-only", "resource-policy": "idle-no-archival-transfers" };
const compiled = compileWarriorRecipe(inputs);
assert.equal(compiled.recipe.services[0]!.cpuLimit, 1);
assert.equal(compiled.recipe.services[0]!.memoryLimitBytes, 536870912);
assert.equal(compiled.recipe.onboarding.kind, "http-basic-from-mutable-config");
assert.equal(compiled.configuration.archivalTransfersApproved, false);
assert.deepEqual(validateAppRecipe(compiled.recipe, manifest), []);
assert.equal(checkedHttpBasicOnboarding(compiled.recipe)?.username, "warrior-admin");
for (const onboarding of [{ ...compiled.recipe.onboarding, approved: true },
  { ...compiled.recipe.onboarding, configId: "missing" },
  { ...compiled.recipe.onboarding, officialUrl: "https://example.com/unrelated" }]) {
  assert.throws(() => checkedHttpBasicOnboarding({ ...compiled.recipe, onboarding }), /HTTP Basic/);
}
assert.throws(() => checkedHttpBasicOnboarding({ ...compiled.recipe,
  privateFiles: [{ ...compiled.recipe.privateFiles[0], source: "owner" }] }), /HTTP Basic/);
for (const [key, value] of [["selected-project", "auto"], ["concurrency", "6"],
  ["downloader", "invalid name"], ["outbound-policy", "approved"], ["resource-policy", "unlimited"]]) {
  assert.throws(() => compileWarriorRecipe({ ...inputs, [key!]: value! }), /requires an exact/);
}
const context = { recipe: compiled.recipe, inputs: compiled.recipe.mutableConfigs[0]!.inputs,
  async readPrivateFile(id: string) { assert.equal(id, "admin-password"); return "A".repeat(65); } };
const fresh = await mutableConfigHook.initialize(context);
const saved = JSON.stringify({ ...JSON.parse(fresh), warrior_id: "upstream-issued-fixture", unrelated: "retained" });
await mutableConfigHook.validate(saved, context);
assert.equal(JSON.parse(saved).warrior_id, "upstream-issued-fixture");
await assert.rejects(mutableConfigHook.validate(saved.replace('"none"', '"auto"'), context), /differs/);
await assert.rejects(mutableConfigHook.validate(saved.replace("fixture-warrior", "another-nickname"), context), /differs/);
await assert.rejects(mutableConfigHook.validate(saved.replace("A".repeat(65), "B".repeat(65)), context), /differs/);
let revalidated = false;
const binding = { selection: { appId: "archive-team-warrior", recipe: compiled.recipe },
  derived: { input: { appId: "archive-team-warrior", inputs }, recipe: compiled.recipe,
    configuration: compiled.configuration, peerAppIds: [] } };
await prestart.verify({ appId: "archive-team-warrior", derived: binding,
  async revalidate() { revalidated = true; } } as never);
assert.equal(revalidated, true);
await assert.rejects(prestart.verify({ appId: "archive-team-warrior", derived: null } as never), /retained/);
await assert.rejects(prestart.verify({ appId: "archive-team-warrior",
  derived: { ...binding, derived: { ...binding.derived, configuration: { approved: true } } } } as never), /differs/);
assert.equal(adapter.ready({ appId: "archive-team-warrior", stage: "basic-login-and-effective-idle-verified",
  httpUsername: "warrior-admin", anonymousDenied: true, selectedProject: "none", effectiveState: "NO_PROJECT",
  hqTrafficDisabled: false, archivalAcceptanceVerified: false, apiKeyCreated: false }), true);
assert.equal(adapter.ready({ appId: "archive-team-warrior", stage: "basic-login-and-effective-idle-verified",
  httpUsername: "warrior-admin", anonymousDenied: true, selectedProject: "auto", effectiveState: "NO_PROJECT" }), false);
console.log("Warrior derived idle recipe/config/prestart/setup: pass (synthetic, no HQ traffic).");
