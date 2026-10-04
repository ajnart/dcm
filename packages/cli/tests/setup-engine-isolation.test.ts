import assert from "node:assert/strict";
import { inspectApiCredentialSetup, inspectFirstRunSetup, runFirstRunSetups } from "../src/control-panel/setup-engine.ts";
import prowlarr from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/prowlarr/setup.ts";

const never = async () => { throw new Error("No app request should run"); };
const transport = { read: never, mutate: never,
  async approve() { throw new Error("No approval should be requested"); } };

const results = await runFirstRunSetups("/tmp", ["invalid$id", "absent-app"], transport);
assert.deepEqual(results.map((entry) => entry.appId), ["invalid$id", "absent-app"]);
assert.deepEqual(results.map((entry) => entry.state), ["needs-inspection", "needs-inspection"]);
assert.match(results[0]!.detail, /invalid/);
assert.match(results[1]!.detail, /No verified first-run adapter/);

const inspected = await inspectFirstRunSetup("/tmp", "invalid$id", never);
assert.equal(inspected.state, "needs-inspection");
assert.match(inspected.detail, /invalid/);

const originalInspect = prowlarr.inspect;
const originalCompatibilityResult = prowlarr.compatibilityResult;
const originalApiReady = prowlarr.apiReady;
try {
  let inspectedRoot = "/tmp";
  prowlarr.inspect = async (context) => {
    assert.equal("apply" in context, false);
    assert.equal("compareAndSet" in context.checkpoint, false);
    return { appId: "prowlarr", projectRoot: inspectedRoot, ownerKind: "shared",
      stage: "api-config-verified", apiVerified: true, configurationVerified: true,
      loginVerified: false, privateFiles: "/tmp/owned-prowlarr",
      apiKeyFile: "/tmp/owned-prowlarr/prowlarr-api-key" };
  };
  prowlarr.compatibilityResult = () => { throw new Error("API inspection cannot publish setup receipts"); };
  const api = await inspectApiCredentialSetup("/tmp", "prowlarr", never);
  assert.equal(api.state, "ready");
  assert.match(api.detail, /administrator password.*unverified/);
  assert.equal((await inspectFirstRunSetup("/tmp", "prowlarr", never)).state, "needs-inspection");
  inspectedRoot = "/foreign";
  assert.equal((await inspectApiCredentialSetup("/tmp", "prowlarr", never)).state, "needs-inspection");
  inspectedRoot = "/tmp";
  prowlarr.apiReady = undefined;
  assert.equal((await inspectApiCredentialSetup("/tmp", "prowlarr", never)).state, "needs-inspection");
} finally {
  prowlarr.inspect = originalInspect;
  prowlarr.compatibilityResult = originalCompatibilityResult;
  prowlarr.apiReady = originalApiReady;
}
console.log("setup engine batch isolation: pass");
