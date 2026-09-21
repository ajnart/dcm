#!/usr/bin/env bun

import { pathToFileURL } from "node:url";

import {
  loadHomarrApiKey,
  loadSession,
  normalizeName,
  requireSessionPasswordScheme,
  sessionAccess,
} from "./lib/session-context.ts";
import {
  isRecord,
  NativeHomarrMcpClient,
  toolResultArray,
  toolResultValue,
} from "./lib/homarr-mcp.ts";
import { HomarrBoardApiClient } from "./homarr-notebook.ts";

function serviceDefinitions(session) {
  const access = sessionAccess(session);
  return [
    {
      kind: "sonarr",
      navigationUrl: access.services.sonarr.reachableUrl ?? access.services.sonarr.browserUrl,
      pingUrl: access.services.sonarr.dockerUrl,
    },
    {
      kind: "radarr",
      navigationUrl: access.services.radarr.reachableUrl ?? access.services.radarr.browserUrl,
      pingUrl: access.services.radarr.dockerUrl,
    },
    {
      kind: "prowlarr",
      navigationUrl: access.services.prowlarr.reachableUrl ?? access.services.prowlarr.browserUrl,
      pingUrl: access.services.prowlarr.dockerUrl,
    },
    {
      kind: "qbittorrent",
      navigationUrl: access.services.qbittorrent.reachableUrl ?? access.services.qbittorrent.browserUrl,
      pingUrl: access.services.qbittorrent.dockerUrl,
    },
    {
      kind: "jellyfin",
      navigationUrl: access.services.jellyfin.reachableUrl ?? access.services.jellyfin.browserUrl,
      pingUrl: access.services.jellyfin.dockerUrl,
    },
    {
      kind: "seerr",
      navigationUrl: access.services.seerr.reachableUrl ?? access.services.seerr.browserUrl,
      pingUrl: access.services.seerr.dockerUrl,
    },
  ];
}

function oneIntegrationForKind(integrations, kind) {
  const matches = integrations.filter(
    (integration) => isRecord(integration) && normalizeName(integration.kind) === kind,
  );
  if (matches.length !== 1) {
    throw new Error("required Homarr integration is missing or duplicated");
  }
  return matches[0];
}

function appById(apps, appId) {
  const matches = apps.filter((app) => isRecord(app) && app.id === appId);
  if (matches.length !== 1) {
    throw new Error("linked Homarr app is missing or duplicated");
  }
  return matches[0];
}

function writableApp(app, service) {
  if (
    typeof app.id !== "string"
    || typeof app.name !== "string"
    || typeof app.iconUrl !== "string"
  ) {
    throw new Error("linked Homarr app is incomplete");
  }
  let description = app.description;
  if (description === undefined) {
    description = null;
  }
  return {
    id: app.id,
    name: app.name,
    description,
    iconUrl: app.iconUrl,
    href: service.navigationUrl,
    pingUrl: service.pingUrl,
  };
}

const WRITABLE_APP_FIELDS = Object.freeze([
  "id",
  "name",
  "description",
  "iconUrl",
  "href",
  "pingUrl",
]);

export function appMatchesUpdate(app, update) {
  return isRecord(app) && isRecord(update) && WRITABLE_APP_FIELDS.every(
    (field) => Object.hasOwn(app, field)
      && Object.hasOwn(update, field)
      && app[field] === update[field],
  );
}

export async function updateApp(client, update) {
  try {
    await client.callTool("app_update", update);
    return;
  } catch (updateError) {
    try {
      const apps = toolResultArray(await client.callTool("app_all"));
      const app = appById(apps, update.id);
      if (appMatchesUpdate(app, update)) {
        return;
      }
    } catch {
      // Preserve the original mutation failure when reconciliation is unavailable.
    }
    throw updateError;
  }
}

function sameStringSet(values, expected) {
  return Array.isArray(values) && values.length === expected.size
    && values.every((value) => typeof value === "string" && expected.has(value));
}

function boardItemIds(items) {
  if (!Array.isArray(items) || items.some((item) => !isRecord(item) || typeof item.id !== "string")) {
    throw new Error("Homarr board items are invalid");
  }
  return items.map((item) => item.id);
}

export async function repairLegacyStatsItem(client, boardName, managedIntegrationIds, managedAppIds) {
  if (typeof boardName !== "string" || boardName.trim() !== boardName || boardName.length < 1 || boardName.length > 255) {
    throw new Error("BOARD_NAME is invalid");
  }
  if (!(managedIntegrationIds instanceof Set) || managedIntegrationIds.size !== 6
    || !(managedAppIds instanceof Set) || managedAppIds.size !== 6) {
    throw new Error("managed Homarr compatibility set is invalid");
  }
  const boards = await client.query("board.getAllBoards");
  if (!Array.isArray(boards)) throw new Error("Homarr board list is invalid");
  const selected = boards.filter((board) => isRecord(board) && board.name === boardName);
  if (selected.length !== 1 || typeof selected[0].id !== "string" || selected[0].isPublic !== false) {
    throw new Error("exact private Homarr board is unavailable");
  }
  let board = await client.query("board.getBoardByName", { name: boardName });
  if (!isRecord(board) || board.id !== selected[0].id || board.name !== boardName
    || board.isPublic !== false || !Array.isArray(board.sections)) {
    throw new Error("Homarr board detail is invalid");
  }
  const beforeIds = boardItemIds(board.items);
  const linkedApps = board.items.filter((item) => item.kind === "app" && isRecord(item.options))
    .map((item) => item.options.appId);
  if (![...managedAppIds].every((appId) => linkedApps.filter((candidate) => candidate === appId).length === 1)) {
    throw new Error("managed Homarr board apps are incomplete or duplicated");
  }
  const requestStats = board.items.filter((item) => item.kind === "mediaRequests-requestStats");
  if (requestStats.length !== 1) throw new Error("current Homarr media-request stats widget is missing or duplicated");
  const obsolete = board.items.filter((item) => item.kind === "stats");
  if (obsolete.length === 0) return Object.freeze({ repaired: false });
  if (obsolete.length !== 1) throw new Error("obsolete Homarr stats item is duplicated");
  const legacy = obsolete[0];
  if (!isRecord(legacy.options) || Object.keys(legacy.options).length !== 0
    || !sameStringSet(legacy.integrationIds, managedIntegrationIds)) {
    throw new Error("obsolete Homarr stats item does not match the managed compatibility case");
  }
  const retained = board.items.filter((item) => item.id !== legacy.id);
  if (retained.length !== board.items.length - 1) throw new Error("obsolete Homarr stats item identity is invalid");
  const expectedRetained = structuredClone(retained);
  const expectedSections = structuredClone(board.sections);
  await client.mutate("board.saveBoard", { id: board.id, sections: board.sections, items: retained });
  board = await client.query("board.getBoardByName", { name: boardName });
  if (!isRecord(board) || board.id !== selected[0].id || board.name !== boardName || board.isPublic !== false) {
    throw new Error("Homarr compatibility repair board changed unexpectedly");
  }
  const afterIds = boardItemIds(board.items);
  const expectedIds = beforeIds.filter((id) => id !== legacy.id);
  if (board.items.some((item) => item.kind === "stats")
    || afterIds.length !== expectedIds.length
    || !expectedIds.every((id) => afterIds.includes(id))
    || JSON.stringify(board.sections) !== JSON.stringify(expectedSections)
    || expectedRetained.some((expected) => JSON.stringify(board.items.find((item) => item.id === expected.id)) !== JSON.stringify(expected))) {
    throw new Error("Homarr compatibility repair did not persist exactly");
  }
  return Object.freeze({ repaired: true });
}

async function main() {
  if (Bun.argv.length !== 3 && Bun.argv.length !== 4) {
    throw new Error("RUN_ID and optional BOARD_NAME are required");
  }
  const session = loadSession(Bun.argv[2]);
  requireSessionPasswordScheme(session);
  const { apiKey } = loadHomarrApiKey(session);
  const client = new NativeHomarrMcpClient(session, apiKey);

  // Endpoint discovery is deliberately read-only and always precedes updates.
  await client.connect();
  const apps = toolResultArray(await client.callTool("app_all"));
  const integrations = toolResultArray(await client.callTool("integration_all"));
  if (integrations.length !== 6) {
    throw new Error("Homarr onboarding integration set is not exact");
  }
  const updates = [];
  const linkedAppIds = new Set();
  const expectedApps = new Map();

  for (const service of serviceDefinitions(session)) {
    const integration = oneIntegrationForKind(integrations, service.kind);
    if (
      typeof integration.id !== "string"
      || integration.url !== service.pingUrl
      || !isRecord(integration.permissions)
      || integration.permissions.hasUseAccess !== true
      || integration.permissions.hasInteractAccess !== true
      || integration.permissions.hasFullAccess !== true
    ) {
      throw new Error("required Homarr integration is not the managed onboarding integration");
    }
    const details = toolResultValue(
      await client.callTool("integration_byId", { id: integration.id }),
    );
    if (
      !isRecord(details)
      || !isRecord(details.app)
      || typeof details.app.id !== "string"
      || !details.app.id.startsWith("onboarding_app_")
      || normalizeName(details.app.name) !== service.kind
    ) {
      throw new Error("required Homarr integration is not linked to an app");
    }
    if (linkedAppIds.has(details.app.id)) {
      throw new Error("required Homarr integrations reuse an app");
    }
    linkedAppIds.add(details.app.id);

    const app = appById(apps, details.app.id);
    if (normalizeName(app.name) !== service.kind) {
      throw new Error("linked Homarr onboarding app has an unexpected name");
    }
    expectedApps.set(app.id, service);
    if (app.href === service.navigationUrl && app.pingUrl === service.pingUrl) {
      continue;
    }
    updates.push(writableApp(app, service));
  }

  if (linkedAppIds.size !== 6) {
    throw new Error("Homarr onboarding links are incomplete");
  }
  process.stdout.write("PASS Homarr six app and integration links verified\n");

  for (const update of updates) {
    await updateApp(client, update);
  }

  const updatesById = new Map(updates.map((update) => [update.id, update]));
  const finalizedApps = toolResultArray(await client.callTool("app_all"));
  for (const [appId, service] of expectedApps) {
    const app = appById(finalizedApps, appId);
    const update = updatesById.get(appId);
    if (update !== undefined) {
      if (!appMatchesUpdate(app, update)) {
        throw new Error("Homarr app update did not fully persist");
      }
      continue;
    }
    if (app.href !== service.navigationUrl || app.pingUrl !== service.pingUrl) {
      throw new Error("Homarr app URL update did not persist");
    }
  }
  process.stdout.write("PASS Homarr app navigation and ping URLs finalized\n");

  if (Bun.argv[3] !== undefined) {
    const boardClient = new HomarrBoardApiClient(session, apiKey);
    const result = await repairLegacyStatsItem(
      boardClient,
      Bun.argv[3],
      new Set(integrations.map((integration) => integration.id)),
      linkedAppIds,
    );
    process.stdout.write(result.repaired
      ? "PASS Homarr legacy stats compatibility repair\n"
      : "PASS Homarr legacy stats compatibility repair not needed\n");
  }
}

if (
  Bun.argv[1] !== undefined
  && import.meta.url === pathToFileURL(Bun.argv[1]).href
) {
  main().catch(() => {
    process.stdout.write("FAIL Homarr finalization\n");
    process.exitCode = 1;
  });
}
