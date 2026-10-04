import assert from "node:assert/strict";
import { inspectDashdotApi } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/dashdot/inspection.ts";
import type { SetupHttpReadRequest, SetupHttpResponse } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const projectRoot = "/tmp/dashdot-source-fixture";
function fixture() {
  const responses: Record<string, unknown> = {
    "/config": { version: "6.3.4", config: { disable_integrations: false, widget_list: ["os", "cpu", "ram"] } },
    "/info": { cpu: { model: "fixture", threads: 2 }, ram: { size: 1024 } },
    "/load/cpu": [{ core: 0, load: 0, temp: 0 }, { core: 1, load: 12.5, temp: 0 }],
    "/load/ram": { load: 512 },
  };
  const calls: SetupHttpReadRequest[] = [];
  const status = { command: "app status", appId: "dashdot", projectRoot,
    status: "applied", mutation: false, runtime: { state: "running" } };
  let responseStatus = 200;
  const context = { appId: "dashdot", projectRoot, status: async () => status,
    http: { async request(request: SetupHttpReadRequest): Promise<SetupHttpResponse> {
      calls.push(request);
      assert.deepEqual(Object.keys(request).sort(), ["method", "path"]);
      assert.equal(request.method, "GET");
      assert(Object.hasOwn(responses, request.path));
      return { status: responseStatus, ok: responseStatus === 200,
        headers: { get: () => null }, json: async () => responses[request.path],
        text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    } } };
  return { context, calls, responses, status, failHttp() { responseStatus = 503; } };
}
const valid = fixture();
const observation = await inspectDashdotApi(valid.context);
assert.deepEqual(observation, { appId: "dashdot", stage: "api-contract-observed", version: "6.3.4",
  hostMetricsVerified: false, homarrVerified: false });
assert(!("ready" in observation));
assert(!("username" in observation));
assert(!("apiKey" in observation));
assert.deepEqual(valid.calls.map((call) => call.path), ["/config", "/info", "/load/cpu", "/load/ram"]);
assert.deepEqual(await inspectDashdotApi(valid.context), observation);
for (const change of [
  (f: ReturnType<typeof fixture>) => { f.context.appId = "another"; },
  (f: ReturnType<typeof fixture>) => { f.status.projectRoot = "/tmp/other-owner"; },
  (f: ReturnType<typeof fixture>) => { f.status.runtime.state = "stopped"; },
]) {
  const invalid = fixture(); change(invalid);
  await assert.rejects(inspectDashdotApi(invalid.context));
  assert.equal(invalid.calls.length, 0);
}
for (const [path, body] of [
  ["/config", { version: "6.3.5", config: { disable_integrations: false, widget_list: ["cpu", "ram"] } }],
  ["/config", { version: "6.3.4", config: { disable_integrations: true, widget_list: ["cpu", "ram"] } }],
  ["/config", { version: "6.3.4", config: { disable_integrations: false, widget_list: ["cpu"] } }],
  ["/info", { cpu: { model: "", threads: 0 }, ram: { size: 0 } }],
  ["/load/cpu", []],
  ["/load/cpu", [{ core: 0, load: 101 }]],
  ["/load/cpu", [{ core: 0, load: 2 }, { core: 0, load: 3 }]],
  ["/load/cpu", [{ core: 0, load: Number.NaN }]],
  ["/load/ram", { load: -1 }],
  ["/load/ram", { load: Number.POSITIVE_INFINITY }],
] as const) {
  const invalid = fixture(); invalid.responses[path] = body;
  await assert.rejects(inspectDashdotApi(invalid.context));
}
const unavailable = fixture(); unavailable.failHttp();
await assert.rejects(inspectDashdotApi(unavailable.context), /unavailable/);
console.log("Dashdot source fixture: read-only API shape and exact owner; no host/readiness acceptance: pass");
