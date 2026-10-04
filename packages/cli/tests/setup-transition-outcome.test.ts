import assert from "node:assert/strict";
import { mock } from "bun:test";

const root = "/synthetic/setup-transition";
const records = new Map<string, Record<string, unknown>>();
const ready = new Set<string>();
mock.module("../src/lib/setup-contract.ts", () => ({
  async setupAdapterSource(appId: string) {
    if (appId === "absent-app") return null;
    const record = records.get(appId);
    const source = `export default { appId: ${JSON.stringify(appId)}, credentialCommand: "app handoff",
      apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: null,
      firstRun: async () => (${JSON.stringify(record)}), ready: () => ${ready.has(appId)} };`;
    return { url: new URL(`data:text/javascript,${encodeURIComponent(source)}`), sha256: "a".repeat(64) };
  },
}));
mock.module("../src/control-panel/setup-transport.ts", () => ({
  createSetupTransportFacilities() { return { peers: {} }; },
  SetupTransportDeferred: class extends Error {},
}));

try {
  const { runFirstRunSetups, setupApiKeyContract } = await import("../src/control-panel/setup-engine.ts");
  const valid = { projectRoot: root, adminLoginVerified: true, apiKeyVerified: true, registrationClosed: false };
  const cases: Array<[string, Record<string, unknown>]> = [
    ["exact", valid], ["wrong-root", { ...valid, projectRoot: "/other" }],
    ["wrong-app", { ...valid, appId: "another" }],
    ["login-false", { ...valid, adminLoginVerified: false }],
    ["key-false", { ...valid, apiKeyVerified: false }],
    ["login-string", { ...valid, adminLoginVerified: "true" }],
    ["closed", { ...valid, registrationClosed: true }],
    ["closed-missing", { projectRoot: root, adminLoginVerified: true, apiKeyVerified: true }],
    ["ready", valid],
  ];
  ready.add("ready");
  for (const [appId, fields] of cases) records.set(appId, { appId, ...fields });
  const transport = {
    async read() { throw new Error("No state read expected"); },
    async mutate() { throw new Error("No mutation expected"); },
    async approve() { throw new Error("No approval expected"); },
  };
  const results = await runFirstRunSetups(root, cases.map(([appId]) => appId), transport);
  for (const outcome of results) {
    if (outcome.appId === "exact" || outcome.appId === "ready") assert.equal(outcome.transitionReady, true);
    else assert.equal(Object.hasOwn(outcome, "transitionReady"), false);
    if (outcome.appId === "ready") assert.equal(outcome.state, "ready");
    else assert.equal(outcome.state, "needs-inspection");
  }
  assert.equal(await setupApiKeyContract("exact"), "saved-by-onboarding");
  assert.equal(await setupApiKeyContract("absent-app"), null);
  console.log("Setup transition outcome: exact adapter identity/login/key flags only, without weakening readiness");
} finally { mock.restore(); }
