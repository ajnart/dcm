#!/usr/bin/env bun

import assert from "node:assert/strict";

import {
  appMatchesUpdate,
  repairLegacyStatsItem,
  updateApp,
} from "./homarr-finalize.ts";

const update = Object.freeze({
  id: "onboarding_app_sonarr",
  name: "Sonarr",
  description: null,
  iconUrl: "https://cdn.example.test/sonarr.svg",
  href: "http://127.0.0.1:11001",
  pingUrl: "http://sonarr:8989",
});

function appResult(apps) {
  return { structuredContent: { apps } };
}

function clientFor(responses) {
  const calls = [];
  return {
    calls,
    async callTool(name, args = {}) {
      calls.push({ args, name });
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
}

async function assertOriginalFailure(client, expectedError) {
  await assert.rejects(
    updateApp(client, update),
    (error) => {
      assert.equal(error, expectedError);
      return true;
    },
  );
}

async function runChecks() {
  const directClient = clientFor([{}]);
  await updateApp(directClient, update);
  assert.deepEqual(directClient.calls, [
    { args: update, name: "app_update" },
  ]);

  const committedError = new Error("fixture mutation response failed");
  const committedClient = clientFor([
    committedError,
    appResult([{ ...update }]),
  ]);
  await updateApp(committedClient, update);
  assert.deepEqual(committedClient.calls, [
    { args: update, name: "app_update" },
    { args: {}, name: "app_all" },
  ]);
  assert.equal(appMatchesUpdate({ ...update }, update), true);

  const staleError = new Error("fixture stale mutation response failed");
  const staleClient = clientFor([
    staleError,
    appResult([
      { ...update, id: "onboarding_app_other" },
      { ...update, href: "http://127.0.0.1:10000" },
    ]),
  ]);
  await assertOriginalFailure(staleClient, staleError);

  const stalePingError = new Error("fixture stale ping mutation response failed");
  const stalePingClient = clientFor([
    stalePingError,
    appResult([{ ...update, pingUrl: "http://sonarr:9999" }]),
  ]);
  await assertOriginalFailure(stalePingClient, stalePingError);

  const fieldMismatches = [
    ["name", "Wrong Sonarr"],
    ["description", "Wrong description"],
    ["iconUrl", "https://cdn.example.test/wrong.svg"],
  ];
  for (const [field, value] of fieldMismatches) {
    const mismatchError = new Error("fixture writable field mismatch");
    const mismatchClient = clientFor([
      mismatchError,
      appResult([{ ...update, [field]: value }]),
    ]);
    await assertOriginalFailure(mismatchClient, mismatchError);
    assert.equal(appMatchesUpdate({ ...update, [field]: value }, update), false);
  }

  const readError = new Error("fixture read failed");
  const unreadableUpdateError = new Error("fixture mutation transport failed");
  const unreadableClient = clientFor([unreadableUpdateError, readError]);
  await assertOriginalFailure(unreadableClient, unreadableUpdateError);

  const integrationIds = new Set(["i1", "i2", "i3", "i4", "i5", "i6"]);
  const appIds = new Set(["a1", "a2", "a3", "a4", "a5", "a6"]);
  const baseItems = [
    ...[...appIds].map((appId, index) => ({ id: `app-${index}`, kind: "app", options: { appId }, integrationIds: [], layouts: [] })),
    { id: "request-stats", kind: "mediaRequests-requestStats", options: {}, integrationIds: ["i6"], layouts: [] },
    { id: "legacy-stats", kind: "stats", options: {}, integrationIds: [...integrationIds], layouts: [{ layoutId: "desktop", sectionId: "main", width: 1, height: 1, xOffset: 0, yOffset: 1 }] },
    { id: "preserved", kind: "clock", options: {}, integrationIds: [], layouts: [] },
  ];
  function boardClient(items = baseItems) {
    let detail = { id: "board-1", name: "MyHomelab", isPublic: false, sections: [{ id: "main", kind: "empty" }], items: structuredClone(items) };
    const calls = [];
    return {
      calls,
      async query(procedure) {
        calls.push({ procedure, type: "query" });
        if (procedure === "board.getAllBoards") return [{ id: "board-1", name: "MyHomelab", isPublic: false }];
        return structuredClone(detail);
      },
      async mutate(procedure, input) {
        calls.push({ input: structuredClone(input), procedure, type: "mutation" });
        assert.equal(procedure, "board.saveBoard");
        detail = { ...detail, sections: structuredClone(input.sections), items: structuredClone(input.items) };
      },
    };
  }
  const repairClient = boardClient();
  assert.deepEqual(await repairLegacyStatsItem(repairClient, "MyHomelab", integrationIds, appIds), { repaired: true });
  const save = repairClient.calls.find((call) => call.type === "mutation");
  assert.equal(save.input.items.some((item) => item.id === "legacy-stats"), false);
  assert.equal(save.input.items.some((item) => item.id === "preserved"), true);
  const noopClient = boardClient(baseItems.filter((item) => item.kind !== "stats"));
  assert.deepEqual(await repairLegacyStatsItem(noopClient, "MyHomelab", integrationIds, appIds), { repaired: false });
  assert.equal(noopClient.calls.some((call) => call.type === "mutation"), false);
  for (const items of [
    [...baseItems, { ...baseItems.find((item) => item.kind === "stats"), id: "legacy-duplicate" }],
    baseItems.map((item) => item.kind === "stats" ? { ...item, options: { changed: true } } : item),
    baseItems.filter((item) => item.kind !== "mediaRequests-requestStats"),
    baseItems.filter((item) => item.options?.appId !== "a6"),
  ]) {
    await assert.rejects(repairLegacyStatsItem(boardClient(items), "MyHomelab", integrationIds, appIds));
  }

  process.stdout.write("PASS Homarr update reconciliation and legacy stats compatibility checks\n");
}

runChecks().catch(() => {
  process.stdout.write("FAIL Homarr update reconciliation checks\n");
  process.exitCode = 1;
});
