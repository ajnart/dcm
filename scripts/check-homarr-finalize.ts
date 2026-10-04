#!/usr/bin/env bun

import assert from "node:assert/strict";

import {
  appMatchesUpdate,
  applyMediaAppLinks,
  planMediaAppLinks,
  repairLegacyStatsItem,
  serviceDefinitions,
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
  assert.deepEqual(await repairLegacyStatsItem(repairClient, "MyHomelab", integrationIds, appIds, "i6"), { repaired: true });
  const save = repairClient.calls.find((call) => call.type === "mutation");
  assert.equal(save.input.items.some((item) => item.id === "legacy-stats"), false);
  assert.equal(save.input.items.some((item) => item.id === "preserved"), true);
  const noopClient = boardClient(baseItems.filter((item) => item.kind !== "stats"));
  assert.deepEqual(await repairLegacyStatsItem(noopClient, "MyHomelab", integrationIds, appIds, "i6"), { repaired: false });
  assert.equal(noopClient.calls.some((call) => call.type === "mutation"), false);
  for (const items of [
    [...baseItems, { ...baseItems.find((item) => item.kind === "stats"), id: "legacy-duplicate" }],
    baseItems.map((item) => item.kind === "stats" ? { ...item, options: { changed: true } } : item),
    baseItems.filter((item) => item.kind !== "mediaRequests-requestStats"),
    baseItems.filter((item) => item.options?.appId !== "a6"),
    baseItems.map((item) => item.kind === "stats" ? { ...item, integrationIds: ["i1", "i1", "i2", "i3", "i4", "i5"] } : item),
    baseItems.map((item) => item.kind === "mediaRequests-requestStats" ? { ...item, integrationIds: ["i5"] } : item),
    baseItems.map((item) => item.kind === "mediaRequests-requestStats" ? { ...item, options: { unexpected: true } } : item),
  ]) {
    const rejectedClient = boardClient(items);
    await assert.rejects(repairLegacyStatsItem(rejectedClient, "MyHomelab", integrationIds, appIds, "i6"));
    assert.equal(rejectedClient.calls.some((call) => call.type === "mutation"), false);
  }

  const session = { runId: "links-fixture", sessionDir: "/tmp/homarr-links-fixture-no-access", manifest: {
    HOMARR_BIND_ADDRESS: "127.0.0.1", HOMARR_PORT: "21006", SONARR_PORT: "21002", RADARR_PORT: "21001",
    PROWLARR_PORT: "21000", QBITTORRENT_PORT: "21003", JELLYFIN_PORT: "21004", SEERR_PORT: "21005",
  } };
  const services = serviceDefinitions(session);
  const managedApps = services.map((service) => ({ id: `onboarding_app_${service.kind}`, name: service.kind,
    description: "private-description-canary", iconUrl: "https://example.test/private-icon-canary.svg",
    href: "http://127.0.0.1:9999", pingUrl: service.pingUrl }));
  const managedIntegrations = services.map((service) => ({ id: `integration_${service.kind}`, kind: service.kind,
    url: service.pingUrl, permissions: { hasUseAccess: true, hasInteractAccess: true, hasFullAccess: true } }));
  const ownedBoard = { id: "board-1", name: "MyHomelab", isPublic: false, sections: [], layouts: [],
    items: managedApps.map((app) => ({ id: `tile-${app.id}`, kind: "app", options: { appId: app.id } })) };
  ownedBoard.items.push({ id: "keep-legacy-stats", kind: "stats", options: {} });
  const linkCalls = [];
  const linkClient = { async callTool(name, args = {}) {
    linkCalls.push({ name, args: structuredClone(args) });
    if (name === "app_all") return appResult(structuredClone(managedApps));
    if (name === "integration_all") return { structuredContent: structuredClone(managedIntegrations) };
    if (name === "integration_byId") {
      const integration = managedIntegrations.find((entry) => entry.id === args.id);
      return { structuredContent: { ...integration, app: { id: `onboarding_app_${integration.kind}`, name: integration.kind } } };
    }
    assert.equal(name, "app_update");
    Object.assign(managedApps.find((app) => app.id === args.id), args);
    return {};
  } };
  const linkBoardClient = { async query(procedure) {
    if (procedure === "board.getAllBoards") return [{ id: ownedBoard.id, name: ownedBoard.name, isPublic: false }];
    assert.equal(procedure, "board.getBoardByName");
    return structuredClone(ownedBoard);
  }, async mutate() { assert.fail("links mode must never mutate the board"); } };
  const linkPlan = await planMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab");
  assert.equal(linkPlan.managedApps.length, 6);
  assert.equal(linkPlan.updates.length, 6);
  assert.equal(linkCalls.some((call) => call.name === "app_update"), false);
  assert.equal(JSON.stringify(linkPlan).includes("private-description-canary"), false);
  assert.equal(JSON.stringify(linkPlan).includes("private-icon-canary"), false);
  managedIntegrations[0].lastHealthCheck = "volatile-observation";
  managedApps[0].updatedAt = "volatile-observation";
  assert.equal((await planMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab")).approvalDigest, linkPlan.approvalDigest);
  ownedBoard.items.push({ id: "concurrent-clock", kind: "clock", options: {} });
  await assert.rejects(applyMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab", linkPlan.approvalDigest), /approval/);
  assert.equal(linkCalls.some((call) => call.name === "app_update"), false);
  ownedBoard.items.pop();
  const result = await applyMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab", linkPlan.approvalDigest);
  assert.equal(result.mutation, true);
  assert.equal(linkCalls.filter((call) => call.name === "app_update").length, 6);
  assert.equal(ownedBoard.items.some((item) => item.id === "keep-legacy-stats"), true);
  for (const app of managedApps) {
    assert.equal(app.iconUrl, "https://example.test/private-icon-canary.svg");
    const service = services.find((entry) => entry.kind === app.name);
    assert.equal(app.href, service.navigationUrl);
    assert.equal(app.pingUrl, service.pingUrl);
    assert.equal(app.description, service.description);
  }
  const currentPlan = await planMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab");
  assert.equal(currentPlan.updates.length, 0);
  managedApps[0].description = "concurrent-description";
  await assert.rejects(applyMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab", currentPlan.approvalDigest), /approval/);
  assert.equal(linkCalls.filter((call) => call.name === "app_update").length, 6);

  const originalCallTool = linkClient.callTool.bind(linkClient);
  const boardDriftPlan = await planMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab");
  linkClient.callTool = async (name, args = {}) => {
    const result = await originalCallTool(name, args);
    if (name === "app_update") ownedBoard.sections.push({ id: "unapproved-section", kind: "empty" });
    return result;
  };
  await assert.rejects(applyMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab", boardDriftPlan.approvalDigest), /preserve the private board/);
  ownedBoard.sections.pop();
  linkClient.callTool = originalCallTool;
  managedApps[0].description = "another-outdated-description";
  const linkageDriftPlan = await planMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab");
  linkClient.callTool = async (name, args = {}) => {
    const result = await originalCallTool(name, args);
    if (name === "app_update") managedIntegrations[0].permissions.hasFullAccess = false;
    return result;
  };
  await assert.rejects(applyMediaAppLinks(linkClient, linkBoardClient, session, "MyHomelab", linkageDriftPlan.approvalDigest), /integration is not managed/);

  process.stdout.write("PASS Homarr update reconciliation, bounded links approval and legacy stats compatibility checks\n");
}

runChecks().catch(() => {
  process.stdout.write("FAIL Homarr update reconciliation checks\n");
  process.exitCode = 1;
});
