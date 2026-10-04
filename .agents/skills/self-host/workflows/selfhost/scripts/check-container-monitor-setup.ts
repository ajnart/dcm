import assert from "node:assert/strict";

import glances from "../references/catalog/apps/glances/setup.ts";
import netdata from "../references/catalog/apps/netdata/setup.ts";
import type { SetupContext, SetupHttpRequest } from "../references/catalog/types/setup.ts";

for (const adapter of [glances, netdata]) {
  const projectRoot = `/tmp/container-monitor-fixture-${adapter.appId}`;
  let calls = 0;
  let owned = true;
  const context = {
    appId: adapter.appId, projectRoot,
    async status() {
      return { command: "app status", appId: adapter.appId, projectRoot,
        status: "applied", mutation: false, runtime: { state: "running" },
        ownerKind: "shared", ...(owned ? {} : { projectRoot: "/tmp/different-owner" }) };
    },
    http: { async request(request: SetupHttpRequest) {
      calls += 1;
      assert.equal(request.method, "GET");
      assert.equal(request.approval, undefined);
      let expectedPath = "/api/v1/info";
      if (adapter.appId === "glances") expectedPath = "/api/4/status";
      assert.equal(request.path, expectedPath);
      return { status: 200, ok: true, headers: { get() { return null; } },
        async json() { return { version: "v2.11.0" }; }, async text() { return "{}"; } };
    } },
  } as unknown as SetupContext;
  assert.equal(adapter.sharedOwner, true);
  assert.equal(adapter.ready(await adapter.firstRun(context)), true);
  assert.equal(adapter.ready(await adapter.firstRun(context)), true);
  assert.equal(calls, 2);
  owned = false;
  await assert.rejects(adapter.firstRun(context), /exact saved app project/);
  assert.equal(calls, 2);
}

console.log("Container-local monitor shared probes and owner denial: pass (synthetic)");
