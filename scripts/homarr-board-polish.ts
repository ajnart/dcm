#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  loadHomarrApiKey,
  loadSession,
  normalizeName,
  requireSessionPasswordScheme,
} from "./lib/session-context.ts";
import {
  isRecord,
  NativeHomarrMcpClient,
  toolResultArray,
  toolResultValue,
} from "./lib/homarr-mcp.ts";
import { SERVICE_DESCRIPTIONS, serviceDefinitions } from "./homarr-finalize.ts";
import {
  ADDITIONAL_SERVICES_END,
  ADDITIONAL_SERVICES_START,
  HomarrBoardApiClient,
  NOTEBOOK_MARKER,
} from "./homarr-notebook.ts";

const PLAN_SCHEMA = "selfhost-homarr-starter-board-polish-plan/v2";
const APPROVAL_PREFIX = "sha256:";
const TARGET_LAYOUT_ROLES = Object.freeze(["base", "mobile"]);
const STARTER_PROVENANCE = Object.freeze({
  repository: "homarr-labs/homarr",
  commit: "6478373925ef1b111676b85bd30a48a8575b2dc7",
  definitions: "packages/definitions/src/widget-integration-map.ts",
  placement: "packages/db/queries/widget-placement.ts",
  saveProcedure: "packages/api/src/router/board.ts#saveBoard",
});
const DEFAULT_ADVANCED_OPTIONS = Object.freeze({
  title: null,
  customCssClasses: Object.freeze([]),
  borderColor: "",
});
const STARTER_APPS = Object.freeze([
  Object.freeze({
    name: "Homarr Docs",
    href: "https://homarr.dev/docs/getting-started",
    iconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr.svg",
  }),
  Object.freeze({
    name: "Homarr GitHub",
    href: "https://github.com/homarr-labs/homarr",
    iconUrl: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@master/svg/github.svg",
  }),
  Object.freeze({
    name: "Help Translate",
    href: "https://homarr.dev/docs/community/translations",
    iconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr.svg",
  }),
  Object.freeze({
    name: "Support Homarr",
    href: "https://opencollective.com/homarr",
    iconUrl: "https://cdn.jsdelivr.net/gh/loganmarchione/homelab-svg-assets@latest/assets/opencollective.svg",
  }),
]);
const MANAGED_WIDGET_SERVICE_KINDS = Object.freeze({
  calendar: Object.freeze(["sonarr", "radarr"]),
  mediaMissing: Object.freeze(["sonarr", "radarr"]),
  indexerManager: Object.freeze(["prowlarr"]),
  downloads: Object.freeze(["qbittorrent"]),
  "mediaRequests-requestStats": Object.freeze(["seerr"]),
  mediaServer: Object.freeze(["jellyfin"]),
  mediaReleases: Object.freeze(["jellyfin"]),
});

function fail(message) {
  throw new Error(message);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isRecord(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function canonicalBoard(board) {
  const items = board.items.map((item) => {
    const copy = structuredClone(item);
    copy.integrationIds.sort();
    copy.layouts.sort((left, right) => {
      const leftKey = `${left.layoutId}\u0000${left.sectionId}`;
      const rightKey = `${right.layoutId}\u0000${right.sectionId}`;
      return leftKey.localeCompare(rightKey);
    });
    return copy;
  });
  items.sort((left, right) => left.id.localeCompare(right.id));
  const sections = structuredClone(board.sections);
  sections.sort((left, right) => left.id.localeCompare(right.id));
  const layouts = structuredClone(board.layouts);
  layouts.sort((left, right) => left.id.localeCompare(right.id));
  return { id: board.id, name: board.name, isPublic: board.isPublic, items, sections, layouts };
}

function approvalDigest(board, removeItemIds, layoutDeltas, layoutMode) {
  const payload = {
    schema: PLAN_SCHEMA,
    layoutMode,
    board: canonicalBoard(board),
    removeItemIds: [...removeItemIds].sort(),
    layoutDeltas,
  };
  const digest = createHash("sha256").update(stableStringify(payload)).digest("hex");
  return `${APPROVAL_PREFIX}${digest}`;
}

function exactPrivateBoard(boards, detail, boardName) {
  if (!Array.isArray(boards)) fail("Homarr board list is invalid");
  const matches = boards.filter((board) => isRecord(board) && board.name === boardName);
  if (matches.length !== 1 || typeof matches[0].id !== "string" || matches[0].isPublic !== false) {
    fail("exact private Homarr board is unavailable");
  }
  if (!isRecord(detail) || detail.id !== matches[0].id || detail.name !== boardName
    || detail.isPublic !== false || !Array.isArray(detail.items) || !Array.isArray(detail.sections)
    || !Array.isArray(detail.layouts)) {
    fail("Homarr board detail is invalid");
  }
  for (const item of detail.items) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.kind !== "string"
      || !isRecord(item.options) || !isRecord(item.advancedOptions)
      || !Array.isArray(item.integrationIds) || !Array.isArray(item.layouts)) {
      fail("Homarr board item schema is invalid");
    }
  }
  return detail;
}

function rectanglesOverlap(left, right) {
  const horizontal = left.xOffset < right.xOffset + right.width
    && right.xOffset < left.xOffset + left.width;
  const vertical = left.yOffset < right.yOffset + right.height
    && right.yOffset < left.yOffset + left.height;
  return horizontal && vertical;
}

function simpleBoardGeometry(board) {
  if (board.sections.length !== 1 || !isRecord(board.sections[0])
    || typeof board.sections[0].id !== "string" || board.sections[0].kind !== "empty"
    || board.sections[0].xOffset !== 0 || board.sections[0].yOffset !== 0) {
    fail("Homarr board polish requires one unambiguous section");
  }
  const sectionId = board.sections[0].id;
  const definitions = new Map();
  const roles = new Set();
  for (const layout of board.layouts) {
    let role = layout?.role;
    if (role === undefined && TARGET_LAYOUT_ROLES.includes(layout?.id)) role = layout.id;
    if (!isRecord(layout) || typeof layout.id !== "string"
      || !TARGET_LAYOUT_ROLES.includes(role) || roles.has(role) || definitions.has(layout.id)
      || !Number.isInteger(layout.columnCount)
      || !Number.isInteger(layout.leftGutterColumnCount)
      || !Number.isInteger(layout.rightGutterColumnCount)) {
      fail("Homarr board polish requires unambiguous base and mobile layouts");
    }
    const columnCount = layout.columnCount
      - layout.leftGutterColumnCount
      - layout.rightGutterColumnCount;
    if (columnCount < 1) fail("Homarr board layout has no usable columns");
    definitions.set(layout.id, columnCount);
    roles.add(role);
  }
  if (definitions.size !== TARGET_LAYOUT_ROLES.length) {
    fail("Homarr board polish requires exactly base and mobile layouts");
  }
  for (const item of board.items) {
    if (item.layouts.length !== TARGET_LAYOUT_ROLES.length) {
      fail("Homarr board item layout is missing or ambiguous");
    }
    const seen = new Set();
    for (const layout of item.layouts) {
      if (!isRecord(layout) || typeof layout.layoutId !== "string"
        || seen.has(layout.layoutId) || !definitions.has(layout.layoutId)
        || layout.sectionId !== sectionId
        || !Number.isInteger(layout.xOffset) || !Number.isInteger(layout.yOffset)
        || !Number.isInteger(layout.width) || !Number.isInteger(layout.height)
        || layout.xOffset < 0 || layout.yOffset < 0
        || layout.width < 1 || layout.height < 1
        || layout.xOffset + layout.width > definitions.get(layout.layoutId)) {
        fail("Homarr board item layout is invalid or uses a complex section");
      }
      seen.add(layout.layoutId);
    }
  }
  return Object.freeze({ sectionId, definitions });
}

function placementFor(item, layoutId) {
  const matches = item.layouts.filter((layout) => layout.layoutId === layoutId);
  if (matches.length !== 1) fail("Homarr board item layout is missing or ambiguous");
  return matches[0];
}

function assertNoOverlaps(items, layoutIds) {
  for (const layoutId of layoutIds) {
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      const leftItem = items[leftIndex];
      const left = placementFor(leftItem, layoutId);
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const rightItem = items[rightIndex];
        const right = placementFor(rightItem, layoutId);
        if (rectanglesOverlap(left, right)) {
          fail(`Homarr ${layoutId} layout overlaps items ${leftItem.id} and ${rightItem.id}`);
        }
      }
    }
  }
}

function compactManagedBoard(board, removeItemIds, managedItemIds) {
  const geometry = simpleBoardGeometry(board);
  const layoutIds = [...geometry.definitions.keys()];
  assertNoOverlaps(board.items, layoutIds);
  const removed = new Set(removeItemIds);
  const managed = new Set(managedItemIds);
  const retainedItems = board.items
    .filter((item) => !removed.has(item.id))
    .map((item) => structuredClone(item));
  const retainedIds = new Set(retainedItems.map((item) => item.id));
  for (const itemId of managed) {
    if (!retainedIds.has(itemId)) fail("managed Homarr item set is incomplete");
  }
  const layoutDeltas = [];
  for (const layoutId of layoutIds) {
    const occupied = retainedItems
      .filter((item) => !managed.has(item.id))
      .map((item) => placementFor(item, layoutId));
    const ordered = retainedItems
      .filter((item) => managed.has(item.id))
      .map((item) => ({ item, layout: placementFor(item, layoutId) }));
    ordered.sort((left, right) => {
      if (left.layout.yOffset !== right.layout.yOffset) {
        return left.layout.yOffset - right.layout.yOffset;
      }
      if (left.layout.xOffset !== right.layout.xOffset) {
        return left.layout.xOffset - right.layout.xOffset;
      }
      return left.item.id.localeCompare(right.item.id);
    });
    for (const { item, layout } of ordered) {
      const fromYOffset = layout.yOffset;
      let targetYOffset = 0;
      for (const blocker of occupied) {
        const horizontal = layout.xOffset < blocker.xOffset + blocker.width
          && blocker.xOffset < layout.xOffset + layout.width;
        const blockerBottom = blocker.yOffset + blocker.height;
        if (horizontal && blockerBottom <= fromYOffset && blockerBottom > targetYOffset) {
          targetYOffset = blockerBottom;
        }
      }
      if (targetYOffset > fromYOffset) {
        fail("managed Homarr item cannot be compacted upward safely");
      }
      const updatedLayout = placementFor(item, layoutId);
      if (targetYOffset !== fromYOffset) {
        updatedLayout.yOffset = targetYOffset;
        layoutDeltas.push({
          itemId: item.id,
          layoutId,
          sectionId: layout.sectionId,
          xOffset: layout.xOffset,
          width: layout.width,
          height: layout.height,
          fromYOffset,
          toYOffset: targetYOffset,
        });
      }
      occupied.push(updatedLayout);
    }
  }
  simpleBoardGeometry({ ...board, items: retainedItems });
  assertNoOverlaps(retainedItems, layoutIds);
  layoutDeltas.sort((left, right) => {
    const layoutOrder = left.layoutId.localeCompare(right.layoutId);
    if (layoutOrder !== 0) return layoutOrder;
    return left.itemId.localeCompare(right.itemId);
  });
  return Object.freeze({
    board: {
      id: board.id,
      name: board.name,
      isPublic: board.isPublic,
      sections: structuredClone(board.sections),
      layouts: structuredClone(board.layouts),
      items: retainedItems,
    },
    layoutDeltas,
  });
}

function reflowAllBoard(board) {
  const geometry = simpleBoardGeometry(board);
  assertNoOverlaps(board.items, geometry.definitions.keys());
  const items = board.items.map((item) => structuredClone(item));
  function group(item) {
    if (item.kind === "app") return 0;
    if (item.kind === "notebook") return 2;
    return 1;
  }
  function notebookPriority(item) {
    const content = item.options?.content;
    if (typeof content !== "string") return 2;
    if (content.includes(`<h2>${NOTEBOOK_MARKER}</h2>`)) return 0;
    if (content.includes("<h2>More services in your homelab</h2>")
      && content.includes(ADDITIONAL_SERVICES_START)
      && content.includes(ADDITIONAL_SERVICES_END)) return 1;
    return 2;
  }
  const ordered = [...items].sort((left, right) => {
    const groupOrder = group(left) - group(right);
    if (groupOrder !== 0) return groupOrder;
    const kindOrder = left.kind.localeCompare(right.kind);
    if (kindOrder !== 0) return kindOrder;
    if (left.kind === "notebook") {
      const notebookOrder = notebookPriority(left) - notebookPriority(right);
      if (notebookOrder !== 0) return notebookOrder;
    }
    return left.id.localeCompare(right.id);
  });
  const layoutDeltas = [];
  for (const [layoutId, columns] of geometry.definitions) {
    const occupied = [];
    let managedRecapBottom = 0;
    for (const item of ordered) {
      const layout = placementFor(item, layoutId);
      // A first-fit free rectangle begins at the origin or an occupied edge.
      // Edge candidates avoid scanning potentially enormous empty row ranges.
      const rows = [...new Set([0, ...occupied.map((rect) => rect.yOffset + rect.height)])].sort((a, b) => a - b);
      const positions = [...new Set([0, ...occupied.map((rect) => rect.xOffset + rect.width)])].sort((a, b) => a - b);
      let target;
      for (const yOffset of rows) {
        if (item.kind === "notebook" && yOffset < managedRecapBottom) continue;
        for (const xOffset of positions) {
          if (xOffset + layout.width > columns) continue;
          const candidate = { ...layout, xOffset, yOffset };
          if (occupied.some((rect) => rectanglesOverlap(candidate, rect))) continue;
          target = candidate;
          break;
        }
        if (target !== undefined) break;
      }
      if (target === undefined) fail("Homarr item cannot be packed within its layout columns");
      if (target.xOffset !== layout.xOffset || target.yOffset !== layout.yOffset) {
        layoutDeltas.push({ itemId: item.id, layoutId, sectionId: layout.sectionId,
          xOffset: target.xOffset, width: layout.width, height: layout.height,
          fromXOffset: layout.xOffset, toXOffset: target.xOffset,
          fromYOffset: layout.yOffset, toYOffset: target.yOffset });
        layout.xOffset = target.xOffset;
        layout.yOffset = target.yOffset;
      }
      occupied.push(layout);
      if (item.kind === "notebook" && notebookPriority(item) < 2) {
        managedRecapBottom = layout.yOffset + layout.height;
      }
    }
  }
  simpleBoardGeometry({ ...board, items });
  assertNoOverlaps(items, geometry.definitions.keys());
  layoutDeltas.sort((left, right) => left.layoutId.localeCompare(right.layoutId) || left.itemId.localeCompare(right.itemId));
  return { board: { ...board, items }, layoutDeltas };
}

function oneExactApp(apps, expected) {
  const matches = apps.filter((app) => isRecord(app)
    && typeof app.id === "string"
    && app.name === expected.name
    && app.href === expected.href
    && app.iconUrl === expected.iconUrl
    && app.description === null
    && app.pingUrl === null);
  if (matches.length > 1) fail("Homarr starter app provenance is ambiguous");
  return matches[0] ?? null;
}

function exactItem(matches, label) {
  if (matches.length > 1) fail(`Homarr starter ${label} provenance is ambiguous`);
  return matches[0] ?? null;
}

function baseStarterItem(item, kind, options, integrationIds = []) {
  return item.kind === kind
    && sameValue(item.options, options)
    && sameValue(item.advancedOptions, DEFAULT_ADVANCED_OPTIONS)
    && sameValue([...item.integrationIds].sort(), [...integrationIds].sort());
}

function starterBookmarksItem(item, starterAppIds) {
  if (item.kind !== "bookmarks" || !sameValue(item.advancedOptions, DEFAULT_ADVANCED_OPTIONS)
    || item.integrationIds.length !== 0 || !isRecord(item.options)) {
    return false;
  }
  if (!sameValue(Object.keys(item.options).sort(), ["items", "layout", "openNewTab", "title"])) return false;
  if (item.options.title !== "Useful Links" || item.options.layout !== "grid"
    || item.options.openNewTab !== true || !Array.isArray(item.options.items)) {
    return false;
  }
  return sameValue([...item.options.items].sort(), [...starterAppIds].sort());
}

function starterCandidates(board, starterApps) {
  const candidates = [];
  for (const app of starterApps) {
    if (app === null) continue;
    const item = exactItem(
      board.items.filter((current) => baseStarterItem(current, "app", {
        appId: app.id,
        openInNewTab: true,
        showTitle: true,
      })),
      `app tile ${app.name}`,
    );
    if (item !== null) candidates.push({ item, reason: `upstream starter app tile: ${app.name}` });
  }

  const clock = exactItem(
    board.items.filter((item) => baseStarterItem(item, "clock", {})),
    "clock widget",
  );
  if (clock !== null) candidates.push({ item: clock, reason: "upstream starter clock widget" });

  const weather = exactItem(
    board.items.filter((item) => baseStarterItem(item, "weather", {
      showHumidity: false,
      showCity: false,
      hasForecast: false,
    })),
    "weather widget",
  );
  if (weather !== null) candidates.push({ item: weather, reason: "upstream starter weather widget" });

  const starterAppIds = starterApps.filter((app) => app !== null).map((app) => app.id).sort();
  const bookmarks = exactItem(
    board.items.filter((item) => starterBookmarksItem(item, starterAppIds)),
    "Useful Links widget",
  );
  if (bookmarks !== null) candidates.push({ item: bookmarks, reason: "upstream starter Useful Links widget" });
  return candidates;
}

async function verifyManagedMediaBoard(mcpClient, session, board, apps, integrations) {
  const managedIntegrationIds = new Set();
  const managedIntegrationIdByKind = new Map();
  const managedAppIds = new Set();
  const managedItemIds = new Set();
  for (const service of serviceDefinitions(session)) {
    const integrationMatches = integrations.filter((integration) => isRecord(integration)
      && normalizeName(integration.kind) === service.kind);
    if (integrationMatches.length !== 1) fail("managed Homarr integration is missing or duplicated");
    const integration = integrationMatches[0];
    if (typeof integration.id !== "string" || integration.url !== service.pingUrl
      || !isRecord(integration.permissions)
      || integration.permissions.hasUseAccess !== true
      || integration.permissions.hasInteractAccess !== true
      || integration.permissions.hasFullAccess !== true) {
      fail("managed Homarr integration provenance is invalid");
    }
    managedIntegrationIds.add(integration.id);
    managedIntegrationIdByKind.set(service.kind, integration.id);
    const detail = toolResultValue(await mcpClient.callTool("integration_byId", { id: integration.id }));
    if (!isRecord(detail) || !isRecord(detail.app) || typeof detail.app.id !== "string"
      || !detail.app.id.startsWith("onboarding_app_") || normalizeName(detail.app.name) !== service.kind) {
      fail("managed Homarr onboarding app provenance is invalid");
    }
    const matchingApps = apps.filter((app) => isRecord(app) && app.id === detail.app.id);
    if (matchingApps.length !== 1) fail("managed Homarr app is missing or duplicated");
    const app = matchingApps[0];
    if (app.href !== service.navigationUrl || app.pingUrl !== service.pingUrl
      || app.description !== SERVICE_DESCRIPTIONS[service.kind]) {
      fail("managed Homarr app links are not finalized");
    }
    const tileMatches = board.items.filter((item) => item.kind === "app"
      && isRecord(item.options) && item.options.appId === app.id);
    if (tileMatches.length !== 1) fail("managed Homarr app tile is missing or duplicated");
    managedAppIds.add(app.id);
    managedItemIds.add(tileMatches[0].id);
  }
  if (managedIntegrationIds.size !== 6 || managedAppIds.size !== 6) {
    fail("managed Homarr media provenance is incomplete");
  }
  for (const [kind, serviceKinds] of Object.entries(MANAGED_WIDGET_SERVICE_KINDS)) {
    const matches = board.items.filter((item) => item.kind === kind);
    const expectedIntegrationIds = serviceKinds.map((serviceKind) => managedIntegrationIdByKind.get(serviceKind));
    if (expectedIntegrationIds.some((id) => typeof id !== "string")) {
      fail("managed Homarr widget integration mapping is unavailable");
    }
    if (matches.length !== 1
      || !sameValue([...matches[0].integrationIds].sort(), [...expectedIntegrationIds].sort())) {
      fail("managed Homarr widget set is incomplete or disconnected");
    }
    managedItemIds.add(matches[0].id);
  }
  return Object.freeze({
    managedAppIds,
    managedIntegrationIds,
    managedItemIds,
    calendarItemId: board.items.find((item) => item.kind === "calendar").id,
  });
}

export async function inspectStarterBoard(client, mcpClient, session, boardName, options = {}) {
  if (options.reflowAll !== undefined && typeof options.reflowAll !== "boolean") fail("reflow-all selection is invalid");
  let layoutMode = "managed-y";
  if (options.reflowAll === true) layoutMode = "all-top-left";
  if (typeof boardName !== "string" || boardName.trim() !== boardName
    || !/^[a-zA-Z0-9_-]{1,64}$/u.test(boardName)) {
    fail("BOARD_NAME is invalid");
  }
  const boards = await client.query("board.getAllBoards");
  const boardDetail = await client.query("board.getBoardByName", { name: boardName });
  const board = exactPrivateBoard(boards, boardDetail, boardName);
  const apps = toolResultArray(await mcpClient.callTool("app_all"));
  const integrations = toolResultArray(await mcpClient.callTool("integration_all"));
  const managed = await verifyManagedMediaBoard(mcpClient, session, board, apps, integrations);
  if (options.reflowAll === true) {
    const reflowed = reflowAllBoard(board);
    let action = "already-reflowed";
    let digest = null;
    if (reflowed.layoutDeltas.length > 0) {
      action = "reflow-all-items";
      digest = approvalDigest(board, [], reflowed.layoutDeltas, layoutMode);
    }
    return Object.freeze({ board, managed, candidates: [], action, digest, layoutMode,
      expectedBoard: reflowed.board, layoutDeltas: reflowed.layoutDeltas });
  }
  const starterApps = STARTER_APPS.map((expected) => oneExactApp(apps, expected));
  const candidates = starterCandidates(board, starterApps);
  const starterAppCount = starterApps.filter((app) => app !== null).length;
  let action = "no-exact-starter-set";
  if (starterAppCount === STARTER_APPS.length && candidates.length === 0) action = "already-clean";
  if (starterAppCount === STARTER_APPS.length && candidates.length === 7) action = "remove-exact-starter-items";
  if (candidates.length > 0 && action !== "remove-exact-starter-items") {
    fail("Homarr starter board is partial or customized; no cleanup is safe");
  }
  const removeItemIds = candidates.map(({ item }) => item.id).sort();
  let digest = null;
  let expectedBoard = null;
  let layoutDeltas = [];
  if (action === "remove-exact-starter-items") {
    const compacted = compactManagedBoard(board, removeItemIds, managed.managedItemIds);
    expectedBoard = compacted.board;
    layoutDeltas = compacted.layoutDeltas;
    digest = approvalDigest(board, removeItemIds, layoutDeltas, layoutMode);
  }
  return Object.freeze({ board, managed, candidates, action, digest, expectedBoard, layoutDeltas, layoutMode });
}

function publicPlan(inspection) {
  const removeItems = inspection.candidates.map(({ item, reason }) => ({
    id: item.id,
    kind: item.kind,
    reason,
  }));
  removeItems.sort((left, right) => left.id.localeCompare(right.id));
  const removeItemIds = new Set(removeItems.map((item) => item.id));
  const retainedItemIds = inspection.board.items
    .filter((item) => !removeItemIds.has(item.id))
    .map((item) => item.id)
    .sort();
  let unchangedLayoutItemIds = retainedItemIds.filter((itemId) => !inspection.managed.managedItemIds.has(itemId));
  let limits = [
    "No global Homarr app record is deleted.",
    "Only base and mobile y-offsets of verified managed media items are compacted.",
    "Other item layouts, sections, and layout definitions are preserved exactly.",
    "The integration-backed media calendar is managed content and is preserved.",
    "A partial, duplicated, customized, overlapping, or complex-section board is refused.",
  ];
  if (inspection.layoutMode === "all-top-left") {
    const moved = new Set(inspection.layoutDeltas.map((delta) => delta.itemId));
    unchangedLayoutItemIds = retainedItemIds.filter((id) => !moved.has(id));
    limits = [
      "Explicit opt-in: every board item, including user-owned items, may move in base and mobile layouts.",
      "Layout-only: no item or app is deleted; content, options, integrations, widths and heights are preserved exactly.",
      "Top-left packing orders app tiles, other widgets, then Notebooks; managed primary and companion recaps precede ordinary notes below each recap, with stable kind and item-ID tie-breaking.",
      "Sections and layout definitions are unchanged; overlapping or complex-section boards are refused.",
      "Existing widget and Notebook sizes are preserved; clipping or unreadable sizing still requires separate review.",
    ];
  }
  return {
    schema: PLAN_SCHEMA,
    live: false,
    board: {
      id: inspection.board.id,
      name: inspection.board.name,
      private: true,
    },
    provenance: STARTER_PROVENANCE,
    action: inspection.action,
    layoutMode: inspection.layoutMode,
    removeItems,
    layoutDeltas: inspection.layoutDeltas,
    preserve: {
      retainedItems: inspection.board.items.length - removeItems.length,
      retainedItemIds,
      unchangedLayoutItemIds,
      managedAppTiles: inspection.managed.managedAppIds.size,
      managedIntegrations: inspection.managed.managedIntegrationIds.size,
      managedLayoutItems: inspection.managed.managedItemIds.size,
      integrationBackedCalendarItemId: inspection.managed.calendarItemId,
      sections: inspection.board.sections.length,
    },
    approvalDigest: inspection.digest,
    limits,
  };
}

function boardMatchesExpected(actual, expected) {
  const actualCanonical = canonicalBoard(actual);
  const expectedCanonical = canonicalBoard({
    id: expected.id,
    name: expected.name,
    isPublic: expected.isPublic,
    items: expected.items,
    sections: expected.sections,
    layouts: expected.layouts,
  });
  return stableStringify(actualCanonical) === stableStringify(expectedCanonical);
}

export async function applyStarterBoardPolish(client, mcpClient, session, boardName, approvedDigest, options = {}) {
  if (typeof approvedDigest !== "string" || !approvedDigest.startsWith(APPROVAL_PREFIX)) {
    fail("an approval digest from a fresh plan is required");
  }
  const inspection = await inspectStarterBoard(client, mcpClient, session, boardName, options);
  if (!["remove-exact-starter-items", "reflow-all-items"].includes(inspection.action) || inspection.digest !== approvedDigest) {
    fail("the approved Homarr starter-board plan is stale or inapplicable");
  }
  if (inspection.expectedBoard === null) fail("approved Homarr board plan has no expected readback");
  const expected = inspection.expectedBoard;
  const output = publicPlan(inspection);
  try {
    await client.mutate("board.saveBoard", {
      id: expected.id,
      sections: expected.sections,
      items: expected.items,
    });
  } catch (mutationError) {
    try {
      const actual = await client.query("board.getBoardByName", { name: boardName });
      if (isRecord(actual) && boardMatchesExpected(actual, expected)) {
        const geometry = simpleBoardGeometry(actual);
        assertNoOverlaps(actual.items, geometry.definitions.keys());
        return { ...output, live: true, action: "applied" };
      }
    } catch {
      // Preserve the original mutation failure when reconciliation is unavailable.
    }
    throw mutationError;
  }
  const actual = await client.query("board.getBoardByName", { name: boardName });
  if (!isRecord(actual) || !boardMatchesExpected(actual, expected)) {
    fail("Homarr starter-board cleanup did not persist exactly");
  }
  const geometry = simpleBoardGeometry(actual);
  assertNoOverlaps(actual.items, geometry.definitions.keys());
  return { ...output, live: true, action: "applied" };
}

async function main() {
  const args = Bun.argv.slice(2);
  const options = { reflowAll: false };
  if (args.at(-1) === "--reflow-all") {
    options.reflowAll = true;
    args.pop();
  }
  const [command, runId, boardName, approvalFlag, approvedDigest] = args;
  if ((command !== "plan" && command !== "apply") || runId === undefined || boardName === undefined) {
    fail("usage: homarr-board-polish.ts plan RUN_ID BOARD_NAME [--reflow-all] | apply RUN_ID BOARD_NAME --approve DIGEST [--reflow-all]");
  }
  if (command === "plan" && args.length !== 3) {
    fail("plan accepts only RUN_ID and BOARD_NAME");
  }
  if (command === "apply" && (args.length !== 5 || approvalFlag !== "--approve" || approvedDigest === undefined)) {
    fail("apply requires --approve DIGEST");
  }
  const session = loadSession(runId);
  requireSessionPasswordScheme(session);
  const { apiKey } = loadHomarrApiKey(session);
  const client = new HomarrBoardApiClient(session, apiKey);
  const mcpClient = new NativeHomarrMcpClient(session, apiKey);
  await mcpClient.connect();
  let output;
  if (command === "plan") output = publicPlan(await inspectStarterBoard(client, mcpClient, session, boardName, options));
  if (command === "apply") {
    output = await applyStarterBoardPolish(client, mcpClient, session, boardName, approvedDigest, options);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (Bun.argv[1] !== undefined && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  main().catch(() => {
    process.stdout.write("FAIL Homarr starter-board polish\n");
    process.exitCode = 1;
  });
}
