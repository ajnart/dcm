#!/usr/bin/env bun

import assert from "node:assert/strict";

import { applyStarterBoardPolish, inspectStarterBoard } from "./homarr-board-polish.ts";
import { SERVICE_DESCRIPTIONS, serviceDefinitions } from "./homarr-finalize.ts";
import { ADDITIONAL_SERVICES_END, ADDITIONAL_SERVICES_START, NOTEBOOK_MARKER } from "./homarr-notebook.ts";

const session = {
  runId: "board-polish-fixture",
  sessionDir: "/tmp/board-polish-fixture",
  manifest: {
    PROWLARR_PORT: "21000", RADARR_PORT: "21001", SONARR_PORT: "21002",
    QBITTORRENT_PORT: "21003", JELLYFIN_PORT: "21004", SEERR_PORT: "21005", HOMARR_PORT: "21006",
  },
};
const advancedOptions = Object.freeze({ title: null, customCssClasses: Object.freeze([]), borderColor: "" });
const boardLayouts = Object.freeze([
  Object.freeze({ id: "mobile", columnCount: 3, leftGutterColumnCount: 0, rightGutterColumnCount: 0 }),
  Object.freeze({ id: "base", columnCount: 10, leftGutterColumnCount: 0, rightGutterColumnCount: 0 }),
]);
const starterApps = Object.freeze([
  Object.freeze({ id: "starter-docs", name: "Homarr Docs", description: null, href: "https://homarr.dev/docs/getting-started", iconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr.svg", pingUrl: null }),
  Object.freeze({ id: "starter-github", name: "Homarr GitHub", description: null, href: "https://github.com/homarr-labs/homarr", iconUrl: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@master/svg/github.svg", pingUrl: null }),
  Object.freeze({ id: "starter-translate", name: "Help Translate", description: null, href: "https://homarr.dev/docs/community/translations", iconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr.svg", pingUrl: null }),
  Object.freeze({ id: "starter-support", name: "Support Homarr", description: null, href: "https://opencollective.com/homarr", iconUrl: "https://cdn.jsdelivr.net/gh/loganmarchione/homelab-svg-assets@latest/assets/opencollective.svg", pingUrl: null }),
]);

function placements(base, mobile) {
  return [
    { layoutId: "mobile", sectionId: "main", xOffset: mobile[0], yOffset: mobile[1], width: mobile[2], height: mobile[3] },
    { layoutId: "base", sectionId: "main", xOffset: base[0], yOffset: base[1], width: base[2], height: base[3] },
  ];
}

function item(id, kind, options, integrationIds, itemLayouts) {
  return { id, kind, options: structuredClone(options), integrationIds: [...integrationIds],
    advancedOptions: structuredClone(advancedOptions), layouts: structuredClone(itemLayouts) };
}

function fixture() {
  const services = serviceDefinitions(session);
  const integrations = services.map((service) => ({
    id: `integration-${service.kind}`, kind: service.kind, url: service.pingUrl,
    permissions: { hasUseAccess: true, hasInteractAccess: true, hasFullAccess: true },
  }));
  const apps = services.map((service) => ({
    id: `onboarding_app_${service.kind}`, name: service.kind, description: SERVICE_DESCRIPTIONS[service.kind],
    iconUrl: `https://icons.example.test/${service.kind}.svg`, href: service.navigationUrl, pingUrl: service.pingUrl,
  }));
  const integrationId = (kind) => `integration-${kind}`;
  const appLayouts = [
    placements([5, 7, 1, 1], [0, 21, 1, 1]), placements([6, 7, 1, 1], [1, 21, 1, 1]),
    placements([7, 7, 1, 1], [2, 21, 1, 1]), placements([8, 7, 1, 1], [0, 22, 1, 1]),
    placements([9, 7, 1, 1], [1, 22, 1, 1]), placements([0, 9, 1, 1], [2, 22, 1, 1]),
  ];
  const managedItems = [
    ...apps.map((app, index) => item(`tile-${app.id}`, "app", { appId: app.id, openInNewTab: true, showTitle: true }, [], appLayouts[index])),
    item("managed-calendar", "calendar", {}, [integrationId("radarr"), integrationId("sonarr")], placements([1, 2, 2, 2], [1, 5, 2, 2])),
    item("managed-missing", "mediaMissing", {}, [integrationId("sonarr"), integrationId("radarr")], placements([3, 2, 2, 2], [0, 7, 2, 2])),
    item("managed-indexers", "indexerManager", {}, [integrationId("prowlarr")], placements([5, 2, 2, 3], [0, 9, 2, 3])),
    item("managed-downloads", "downloads", {}, [integrationId("qbittorrent")], placements([0, 5, 4, 2], [0, 12, 3, 2])),
    item("managed-server", "mediaServer", {}, [integrationId("jellyfin")], placements([4, 5, 3, 2], [0, 14, 3, 2])),
    item("managed-releases", "mediaReleases", {}, [integrationId("jellyfin")], placements([7, 5, 1, 1], [0, 16, 1, 1])),
    item("managed-request-stats", "mediaRequests-requestStats", {}, [integrationId("seerr")], placements([3, 7, 2, 2], [0, 19, 2, 2])),
  ];
  const starterItems = [
    item("tile-starter-docs", "app", { appId: "starter-docs", openInNewTab: true, showTitle: true }, [], placements([0, 0, 1, 1], [0, 0, 1, 1])),
    item("tile-starter-github", "app", { appId: "starter-github", openInNewTab: true, showTitle: true }, [], placements([1, 0, 1, 1], [1, 0, 1, 1])),
    item("tile-starter-translate", "app", { appId: "starter-translate", openInNewTab: true, showTitle: true }, [], placements([2, 0, 1, 1], [2, 0, 1, 1])),
    item("tile-starter-support", "app", { appId: "starter-support", openInNewTab: true, showTitle: true }, [], placements([3, 0, 1, 1], [0, 1, 1, 1])),
    item("starter-clock", "clock", {}, [], placements([4, 0, 2, 1], [1, 1, 2, 1])),
    item("starter-weather", "weather", { showHumidity: false, showCity: false, hasForecast: false }, [], placements([6, 0, 2, 1], [0, 2, 2, 1])),
    item("starter-bookmarks", "bookmarks", { title: "Useful Links", layout: "grid", openNewTab: true, items: starterApps.map((app) => app.id) }, [], placements([8, 0, 2, 2], [0, 3, 2, 2])),
  ];
  const requestList = item("unverified-request-list", "mediaRequests-requestList", {}, [integrationId("seerr")], placements([0, 7, 3, 2], [0, 17, 3, 2]));
  const userNotebook = item("user-note", "notebook", { content: "User owned", showToolbar: true }, [], placements([1, 9, 8, 4], [0, 23, 3, 4]));
  const board = { id: "board-1", name: "personal", isPublic: false, layouts: structuredClone(boardLayouts),
    sections: [{ id: "main", kind: "empty", xOffset: 0, yOffset: 0 }],
    items: [...starterItems, ...managedItems, requestList, userNotebook] };
  const calls = [];
  const client = {
    calls,
    async query(procedure) {
      calls.push({ operation: "query", procedure });
      if (procedure === "board.getAllBoards") return [{ id: board.id, name: board.name, isPublic: board.isPublic }];
      if (procedure === "board.getBoardByName") return structuredClone(board);
      throw new Error("unexpected board query");
    },
    async mutate(procedure, input) {
      calls.push({ operation: "mutate", procedure, input: structuredClone(input) });
      assert.equal(procedure, "board.saveBoard");
      board.sections = structuredClone(input.sections);
      board.items = structuredClone(input.items);
    },
  };
  const details = new Map(services.map((service) => [integrationId(service.kind), {
    id: integrationId(service.kind), app: { id: `onboarding_app_${service.kind}`, name: service.kind },
  }]));
  const mcpClient = {
    async callTool(name, args = {}) {
      if (name === "app_all") return { structuredContent: { apps: [...apps, ...starterApps] } };
      if (name === "integration_all") return { structuredContent: { integrations } };
      if (name === "integration_byId") return { structuredContent: details.get(args.id) };
      throw new Error("unexpected MCP tool");
    },
  };
  return { board, client, mcpClient, requestList, userNotebook };
}

function assertNoOverlap(items, layoutId) {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex].layouts.find((layout) => layout.layoutId === layoutId);
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex].layouts.find((layout) => layout.layoutId === layoutId);
      const horizontal = left.xOffset < right.xOffset + right.width && right.xOffset < left.xOffset + left.width;
      const vertical = left.yOffset < right.yOffset + right.height && right.yOffset < left.yOffset + left.height;
      assert.equal(horizontal && vertical, false, `${layoutId} overlap at ${leftIndex}/${rightIndex}`);
    }
  }
}

const plannedFixture = fixture();
const inspection = await inspectStarterBoard(plannedFixture.client, plannedFixture.mcpClient, session, "personal");
assert.equal(inspection.action, "remove-exact-starter-items");
assert.equal(inspection.candidates.length, 7);
assert.match(inspection.digest, /^sha256:[0-9a-f]{64}$/u);
assert.equal(inspection.managed.calendarItemId, "managed-calendar");
assert.equal(inspection.managed.managedItemIds.size, 13);
assert.ok(inspection.layoutDeltas.length > 0);
assert.ok(inspection.layoutDeltas.every((delta) => delta.toYOffset < delta.fromYOffset));
assert.equal(plannedFixture.client.calls.some((call) => call.operation === "mutate"), false);

await assert.rejects(applyStarterBoardPolish(plannedFixture.client, plannedFixture.mcpClient, session, "personal", `sha256:${"0".repeat(64)}`), /stale or inapplicable/u);
assert.equal(plannedFixture.client.calls.some((call) => call.operation === "mutate"), false);

const appliedFixture = fixture();
const appliedInspection = await inspectStarterBoard(appliedFixture.client, appliedFixture.mcpClient, session, "personal");
const beforeSections = structuredClone(appliedFixture.board.sections);
const beforeLayouts = structuredClone(appliedFixture.board.layouts);
const beforeRequestList = structuredClone(appliedFixture.requestList);
const beforeUserNotebook = structuredClone(appliedFixture.userNotebook);
const beforeRetainedIds = appliedFixture.board.items.filter((current) => !current.id.startsWith("starter-") && !current.id.startsWith("tile-starter-")).map((current) => current.id).sort();
const applied = await applyStarterBoardPolish(appliedFixture.client, appliedFixture.mcpClient, session, "personal", appliedInspection.digest);
assert.equal(applied.action, "applied");
assert.equal(applied.live, true);
assert.equal(applied.removeItems.length, 7);
assert.deepEqual(applied.layoutDeltas, appliedInspection.layoutDeltas);
assert.equal(appliedFixture.client.calls.filter((call) => call.operation === "mutate").length, 1);
assert.deepEqual(appliedFixture.board.sections, beforeSections);
assert.deepEqual(appliedFixture.board.layouts, beforeLayouts);
assert.deepEqual(appliedFixture.board.items.find((current) => current.id === "unverified-request-list"), beforeRequestList);
assert.deepEqual(appliedFixture.board.items.find((current) => current.id === "user-note"), beforeUserNotebook);
assert.deepEqual(appliedFixture.board.items.map((current) => current.id).sort(), beforeRetainedIds);
assertNoOverlap(appliedFixture.board.items, "base");
assertNoOverlap(appliedFixture.board.items, "mobile");
assert.deepEqual(applied.preserve.unchangedLayoutItemIds, ["unverified-request-list", "user-note"]);
const cleanInspection = await inspectStarterBoard(appliedFixture.client, appliedFixture.mcpClient, session, "personal");
assert.equal(cleanInspection.action, "already-clean");
assert.equal(cleanInspection.digest, null);
assert.deepEqual(cleanInspection.layoutDeltas, []);

const reflowFixture = fixture();
reflowFixture.board.items.push(
  item("added-immich", "app", { appId: "extra-immich", openInNewTab: true }, [], placements([9, 50, 1, 1], [2, 50, 1, 1])),
  // A narrow, short companion fits earlier holes unless managed recap placement has a floor.
  item("a-companion-recap", "notebook", { content: `<h2>More services in your homelab</h2>${ADDITIONAL_SERVICES_START}<p>Additional stack apps</p>${ADDITIONAL_SERVICES_END}`, showToolbar: false }, [], placements([0, 60, 1, 1], [0, 60, 1, 1])),
  item("z-primary-recap", "notebook", { content: `<h2>${NOTEBOOK_MARKER}</h2><p>Media instructions</p>`, showToolbar: false }, [], placements([0, 80, 8, 12], [0, 80, 3, 16])),
);
const originalReflowBoard = structuredClone(reflowFixture.board);
const reflowOptions = { reflowAll: true };
const reflowInspection = await inspectStarterBoard(reflowFixture.client, reflowFixture.mcpClient, session, "personal", reflowOptions);
assert.equal(reflowInspection.action, "reflow-all-items");
assert.equal(reflowInspection.layoutMode, "all-top-left");
assert.deepEqual(reflowInspection.candidates, []);
assert.ok(reflowInspection.layoutDeltas.some((delta) => delta.toXOffset !== delta.fromXOffset));
assert.ok(reflowInspection.layoutDeltas.some((delta) => delta.itemId === "user-note"));
assert.ok(reflowInspection.layoutDeltas.some((delta) => delta.itemId === "added-immich"));
const defaultReflowInspection = await inspectStarterBoard(reflowFixture.client, reflowFixture.mcpClient, session, "personal");
assert.notEqual(reflowInspection.digest, defaultReflowInspection.digest);
await assert.rejects(applyStarterBoardPolish(reflowFixture.client, reflowFixture.mcpClient, session, "personal", reflowInspection.digest), /stale or inapplicable/u);
await assert.rejects(applyStarterBoardPolish(reflowFixture.client, reflowFixture.mcpClient, session, "personal", defaultReflowInspection.digest, reflowOptions), /stale or inapplicable/u);
assert.equal(reflowFixture.client.calls.some((call) => call.operation === "mutate"), false);
reflowFixture.board.items.reverse();
const reorderedInspection = await inspectStarterBoard(reflowFixture.client, reflowFixture.mcpClient, session, "personal", reflowOptions);
assert.equal(reorderedInspection.digest, reflowInspection.digest);
const reflowApplied = await applyStarterBoardPolish(reflowFixture.client, reflowFixture.mcpClient, session, "personal", reflowInspection.digest, reflowOptions);
assert.deepEqual(reflowApplied.removeItems, []);
assert.equal(reflowApplied.preserve.retainedItems, originalReflowBoard.items.length);
assert.equal(reflowApplied.limits.some((limit) => limit.includes("user-owned")), true);
assert.equal(reflowApplied.limits.some((limit) => limit.includes("clipping")), true);
assert.deepEqual(reflowFixture.board.sections, originalReflowBoard.sections);
assert.deepEqual(reflowFixture.board.layouts, originalReflowBoard.layouts);
for (const original of originalReflowBoard.items) {
  const actual = reflowFixture.board.items.find((current) => current.id === original.id);
  assert.deepEqual({ ...actual, layouts: undefined }, { ...original, layouts: undefined });
  for (const layout of original.layouts) {
    const actualLayout = actual.layouts.find((current) => current.layoutId === layout.layoutId);
    assert.deepEqual({ ...actualLayout, xOffset: undefined, yOffset: undefined }, { ...layout, xOffset: undefined, yOffset: undefined });
  }
}
for (const layoutId of ["base", "mobile"]) {
  assertNoOverlap(reflowFixture.board.items, layoutId);
  const primary = reflowFixture.board.items.find((current) => current.id === "z-primary-recap").layouts.find((layout) => layout.layoutId === layoutId);
  const companion = reflowFixture.board.items.find((current) => current.id === "a-companion-recap").layouts.find((layout) => layout.layoutId === layoutId);
  const userNote = reflowFixture.board.items.find((current) => current.id === "user-note").layouts.find((layout) => layout.layoutId === layoutId);
  assert.ok(companion.yOffset >= primary.yOffset + primary.height);
  assert.ok(userNote.yOffset >= companion.yOffset + companion.height);
  const beforeBottom = Math.max(...originalReflowBoard.items.map((current) => {
    const layout = current.layouts.find((entry) => entry.layoutId === layoutId);
    return layout.yOffset + layout.height;
  }));
  const afterBottom = Math.max(...reflowFixture.board.items.map((current) => {
    const layout = current.layouts.find((entry) => entry.layoutId === layoutId);
    return layout.yOffset + layout.height;
  }));
  assert.ok(afterBottom < beforeBottom);
}
const packedInspection = await inspectStarterBoard(reflowFixture.client, reflowFixture.mcpClient, session, "personal", reflowOptions);
assert.equal(packedInspection.action, "already-reflowed");
assert.equal(packedInspection.digest, null);
assert.deepEqual(packedInspection.layoutDeltas, []);

const cleanReflowInspection = await inspectStarterBoard(appliedFixture.client, appliedFixture.mcpClient, session, "personal", reflowOptions);
assert.equal(cleanReflowInspection.action, "reflow-all-items");
appliedFixture.userNotebook.options.content = "concurrent edit";
appliedFixture.board.items.find((current) => current.id === "user-note").options.content = "concurrent edit";
await assert.rejects(applyStarterBoardPolish(appliedFixture.client, appliedFixture.mcpClient, session, "personal", cleanReflowInspection.digest, reflowOptions), /stale or inapplicable/u);

const committedFixture = fixture();
const committedInspection = await inspectStarterBoard(committedFixture.client, committedFixture.mcpClient, session, "personal");
const committedMutate = committedFixture.client.mutate;
committedFixture.client.mutate = async (procedure, input) => { await committedMutate(procedure, input); throw new Error("fixture response failed after commit"); };
const reconciled = await applyStarterBoardPolish(committedFixture.client, committedFixture.mcpClient, session, "personal", committedInspection.digest);
assert.equal(reconciled.action, "applied");

const incompleteReadbackFixture = fixture();
const incompleteReadbackInspection = await inspectStarterBoard(incompleteReadbackFixture.client, incompleteReadbackFixture.mcpClient, session, "personal");
const incompleteReadbackMutate = incompleteReadbackFixture.client.mutate;
incompleteReadbackFixture.client.mutate = async (procedure, input) => {
  await incompleteReadbackMutate(procedure, input);
  incompleteReadbackFixture.board.items = incompleteReadbackFixture.board.items.filter((current) => current.id !== "user-note");
};
await assert.rejects(
  applyStarterBoardPolish(incompleteReadbackFixture.client, incompleteReadbackFixture.mcpClient, session, "personal", incompleteReadbackInspection.digest),
  /did not persist exactly/u,
);

const staleFixture = fixture();
const staleInspection = await inspectStarterBoard(staleFixture.client, staleFixture.mcpClient, session, "personal");
staleFixture.board.items.push(item("concurrent-user-item", "notebook", { content: "new" }, [], placements([0, 30, 2, 2], [0, 30, 3, 2])));
await assert.rejects(applyStarterBoardPolish(staleFixture.client, staleFixture.mcpClient, session, "personal", staleInspection.digest), /stale or inapplicable/u);
assert.equal(staleFixture.client.calls.some((call) => call.operation === "mutate"), false);

const generatedLayoutFixture = fixture();
for (const layout of generatedLayoutFixture.board.layouts) {
  layout.role = layout.id;
  layout.id = `generated-${layout.role}-id`;
}
for (const current of generatedLayoutFixture.board.items) {
  for (const layout of current.layouts) layout.layoutId = `generated-${layout.layoutId}-id`;
}
const generatedInspection = await inspectStarterBoard(generatedLayoutFixture.client, generatedLayoutFixture.mcpClient, session, "personal");
assert.equal(generatedInspection.action, "remove-exact-starter-items");
assert.ok(generatedInspection.layoutDeltas.every((delta) => delta.layoutId.startsWith("generated-")));
await applyStarterBoardPolish(generatedLayoutFixture.client, generatedLayoutFixture.mcpClient, session, "personal", generatedInspection.digest);
assert.deepEqual(generatedLayoutFixture.board.layouts.map((layout) => layout.id), ["generated-mobile-id", "generated-base-id"]);

const duplicateRoleFixture = fixture();
duplicateRoleFixture.board.layouts[0].role = "base";
duplicateRoleFixture.board.layouts[1].role = "base";
await assert.rejects(inspectStarterBoard(duplicateRoleFixture.client, duplicateRoleFixture.mcpClient, session, "personal"), /unambiguous base and mobile/u);

const customizedFixture = fixture();
customizedFixture.board.items.find((current) => current.id === "starter-weather").options.showCity = true;
await assert.rejects(inspectStarterBoard(customizedFixture.client, customizedFixture.mcpClient, session, "personal"), /partial or customized/u);

const mislinkedFixture = fixture();
mislinkedFixture.board.items.find((current) => current.id === "managed-downloads").integrationIds = ["integration-prowlarr"];
await assert.rejects(
  inspectStarterBoard(mislinkedFixture.client, mislinkedFixture.mcpClient, session, "personal"),
  /widget set is incomplete or disconnected/u,
);
assert.equal(mislinkedFixture.client.calls.some((call) => call.operation === "mutate"), false);

const duplicatedIntegrationFixture = fixture();
duplicatedIntegrationFixture.board.items.find((current) => current.id === "managed-calendar").integrationIds = [
  "integration-sonarr",
  "integration-sonarr",
];
await assert.rejects(
  inspectStarterBoard(duplicatedIntegrationFixture.client, duplicatedIntegrationFixture.mcpClient, session, "personal"),
  /widget set is incomplete or disconnected/u,
);
assert.equal(duplicatedIntegrationFixture.client.calls.some((call) => call.operation === "mutate"), false);

const complexFixture = fixture();
complexFixture.board.sections.push({ id: "sidebar", kind: "empty", xOffset: 0, yOffset: 0 });
await assert.rejects(inspectStarterBoard(complexFixture.client, complexFixture.mcpClient, session, "personal"), /one unambiguous section/u);

const ambiguousFixture = fixture();
ambiguousFixture.board.items[0].layouts.push(structuredClone(ambiguousFixture.board.items[0].layouts[0]));
await assert.rejects(inspectStarterBoard(ambiguousFixture.client, ambiguousFixture.mcpClient, session, "personal"), /missing or ambiguous/u);

const overlapFixture = fixture();
const overlapLayout = overlapFixture.board.items.find((current) => current.id === "user-note").layouts.find((layout) => layout.layoutId === "base");
overlapLayout.xOffset = 1;
overlapLayout.yOffset = 2;
await assert.rejects(inspectStarterBoard(overlapFixture.client, overlapFixture.mcpClient, session, "personal"), /overlaps items/u);

process.stdout.write("PASS Homarr starter removal, managed compaction, preservation and refusal checks\n");
