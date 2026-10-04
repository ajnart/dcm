#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

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

let finalizationStage = "startup";

export const SERVICE_DESCRIPTIONS = Object.freeze({
  sonarr: "Organizes your TV shows and sends approved episodes to the downloader.",
  radarr: "Organizes your movies and sends approved titles to the downloader.",
  prowlarr: "Shares your chosen, authorized search sources with Sonarr and Radarr.",
  qbittorrent: "Downloads files you are authorized to acquire.",
  jellyfin: "Plays movies and shows from your own library.",
  seerr: "Searches for movies and shows and manages household requests.",
});

export function serviceDefinitions(session) {
  const access = sessionAccess(session);
  return [
    {
      kind: "sonarr",
      description: SERVICE_DESCRIPTIONS.sonarr,
      navigationUrl: access.services.sonarr.reachableUrl ?? access.services.sonarr.browserUrl,
      pingUrl: access.services.sonarr.dockerUrl,
    },
    {
      kind: "radarr",
      description: SERVICE_DESCRIPTIONS.radarr,
      navigationUrl: access.services.radarr.reachableUrl ?? access.services.radarr.browserUrl,
      pingUrl: access.services.radarr.dockerUrl,
    },
    {
      kind: "prowlarr",
      description: SERVICE_DESCRIPTIONS.prowlarr,
      navigationUrl: access.services.prowlarr.reachableUrl ?? access.services.prowlarr.browserUrl,
      pingUrl: access.services.prowlarr.dockerUrl,
    },
    {
      kind: "qbittorrent",
      description: SERVICE_DESCRIPTIONS.qbittorrent,
      navigationUrl: access.services.qbittorrent.reachableUrl ?? access.services.qbittorrent.browserUrl,
      pingUrl: access.services.qbittorrent.dockerUrl,
    },
    {
      kind: "jellyfin",
      description: SERVICE_DESCRIPTIONS.jellyfin,
      navigationUrl: access.services.jellyfin.reachableUrl ?? access.services.jellyfin.browserUrl,
      pingUrl: access.services.jellyfin.dockerUrl,
    },
    {
      kind: "seerr",
      description: SERVICE_DESCRIPTIONS.seerr,
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
  return {
    id: app.id,
    name: app.name,
    description: service.description,
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

function stableSnapshot(value) {
  if (Array.isArray(value)) return value.map(stableSnapshot);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSnapshot(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableSnapshot(value))).digest("hex")}`;
}

function safeAppFields(app) {
  const result = {};
  for (const field of WRITABLE_APP_FIELDS) {
    const value = app[field];
    if ((field === "description" || field === "href" || field === "pingUrl") && value === null) {
      result[field] = null;
      continue;
    }
    if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error("managed Homarr app fields are invalid");
    }
    if (["href", "pingUrl", "iconUrl"].includes(field)) {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("managed Homarr app URL is not credential-free");
      }
    }
    result[field] = value;
  }
  return result;
}

/** Read-only exact plan; raw integration and board data only enter the private digest. */
async function inspectMediaAppLinks(client, boardClient, session, boardName) {
  if (typeof boardName !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/u.test(boardName)) {
    throw new Error("BOARD_NAME is invalid");
  }
  const boards = await boardClient.query("board.getAllBoards");
  if (!Array.isArray(boards)) throw new Error("Homarr board list is invalid");
  const selected = boards.filter((board) => isRecord(board) && board.name === boardName);
  if (selected.length !== 1 || typeof selected[0].id !== "string" || selected[0].isPublic !== false) {
    throw new Error("exact private Homarr board is unavailable");
  }
  const board = await boardClient.query("board.getBoardByName", { name: boardName });
  if (!isRecord(board) || board.id !== selected[0].id || board.name !== boardName || board.isPublic !== false
    || !Array.isArray(board.items) || !Array.isArray(board.sections) || !Array.isArray(board.layouts)) {
    throw new Error("Homarr board detail is invalid");
  }
  const apps = toolResultArray(await client.callTool("app_all"));
  const integrations = toolResultArray(await client.callTool("integration_all"));
  const services = serviceDefinitions(session);
  const managedApps = [];
  const rawLinks = [];
  const appIds = new Set();
  const integrationIds = new Set();
  for (const service of services) {
    const integration = oneIntegrationForKind(integrations, service.kind);
    if (typeof integration.id !== "string" || integration.url !== service.pingUrl
      || !isRecord(integration.permissions) || integration.permissions.hasUseAccess !== true
      || integration.permissions.hasInteractAccess !== true || integration.permissions.hasFullAccess !== true) {
      throw new Error("required Homarr integration is not managed");
    }
    const details = toolResultValue(await client.callTool("integration_byId", { id: integration.id }));
    if (!isRecord(details) || !isRecord(details.app) || typeof details.app.id !== "string"
      || !details.app.id.startsWith("onboarding_app_") || normalizeName(details.app.name) !== service.kind
      || appIds.has(details.app.id) || integrationIds.has(integration.id)) {
      throw new Error("managed Homarr app linkage is invalid");
    }
    appIds.add(details.app.id);
    integrationIds.add(integration.id);
    const app = appById(apps, details.app.id);
    if (normalizeName(app.name) !== service.kind || board.items.filter((item) => isRecord(item) && item.kind === "app"
      && isRecord(item.options) && item.options.appId === app.id).length !== 1) {
      throw new Error("managed Homarr board app is missing or duplicated");
    }
    managedApps.push({ service: service.kind, current: safeAppFields(app), desired: safeAppFields(writableApp(app, service)) });
    rawLinks.push({ integration: { id: integration.id, kind: integration.kind, url: integration.url,
      permissions: { hasUseAccess: integration.permissions.hasUseAccess,
        hasInteractAccess: integration.permissions.hasInteractAccess, hasFullAccess: integration.permissions.hasFullAccess } },
      linkedAppId: details.app.id, linkedAppName: details.app.name, app: safeAppFields(app) });
  }
  if (managedApps.length !== 6 || appIds.size !== 6 || integrationIds.size !== 6) {
    throw new Error("managed Homarr links are incomplete");
  }
  const updates = managedApps.filter((entry) => !appMatchesUpdate(entry.current, entry.desired)).map((entry) => entry.desired);
  const boardSnapshot = { id: board.id, name: board.name, isPublic: board.isPublic,
    items: board.items, sections: board.sections, layouts: board.layouts };
  const snapshotDigest = digest({ board: boardSnapshot, rawLinks, services });
  const preservationDigest = digest({ board: boardSnapshot, links: rawLinks.map(({ integration, linkedAppId, linkedAppName }) => (
    { integration, linkedAppId, linkedAppName }
  )) });
  const sourceSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  const safeManagedApps = managedApps.map((entry) => ({ service: entry.service, appId: entry.desired.id,
    desired: { description: entry.desired.description, href: entry.desired.href, pingUrl: entry.desired.pingUrl },
    change: !appMatchesUpdate(entry.current, entry.desired), preserveName: true, preserveIcon: true }));
  let action = "already-current";
  if (updates.length > 0) action = "update-managed-app-links";
  const plan = Object.freeze({ schemaVersion: 1, kind: "selfhost-homarr-media-links-plan/v1", runId: session.runId,
    live: false, mutation: false, board: { id: board.id, name: board.name, private: true },
    action,
    managedApps: safeManagedApps, updates: safeManagedApps.filter((entry) => entry.change), snapshotDigest,
    approvalDigest: digest({ snapshotDigest, sourceSha256, runId: session.runId, boardName, managedApps, updates }),
    limits: ["Updates only six managed onboarding app records; no board, widget, Notebook or integration mutation.",
      "Private route configuration is not client DNS, CA trust or reachability proof."] });
  return { plan, updates, managedApps, preservationDigest };
}

export async function planMediaAppLinks(client, boardClient, session, boardName) {
  return (await inspectMediaAppLinks(client, boardClient, session, boardName)).plan;
}

export async function applyMediaAppLinks(client, boardClient, session, boardName, approvedDigest) {
  const { plan, updates, managedApps, preservationDigest } = await inspectMediaAppLinks(client, boardClient, session, boardName);
  if (!/^sha256:[0-9a-f]{64}$/u.test(approvedDigest) || approvedDigest !== plan.approvalDigest) {
    throw new Error("Homarr media links approval no longer matches the exact plan");
  }
  finalizationStage = "apply-approved-media-links";
  for (const update of updates) await updateApp(client, update);
  finalizationStage = "read-back-approved-media-links";
  const after = await inspectMediaAppLinks(client, boardClient, session, boardName);
  if (after.preservationDigest !== preservationDigest) {
    throw new Error("Homarr media links apply did not preserve the private board and integration linkage");
  }
  if (managedApps.some((entry) => !appMatchesUpdate(
    after.managedApps.find((current) => current.service === entry.service)?.current, entry.desired,
  ))) {
    throw new Error("Homarr managed app fields did not fully persist");
  }
  return Object.freeze({ ...plan, live: true, mutation: plan.updates.length > 0, action: "applied" });
}

async function mediaLinksMode(args) {
  finalizationStage = "parse-media-links-plan";
  const [action, runId, boardName] = args;
  if ((action === "plan" && args.length !== 3) || (action === "apply"
    && (args.length !== 5 || args[3] !== "--approve" || !/^sha256:[0-9a-f]{64}$/u.test(args[4])))) {
    throw new Error("media links plan/apply arguments are invalid");
  }
  finalizationStage = "load-private-session";
  const session = loadSession(runId);
  requireSessionPasswordScheme(session);
  const { apiKey } = loadHomarrApiKey(session);
  const client = new NativeHomarrMcpClient(session, apiKey);
  const boardClient = new HomarrBoardApiClient(session, apiKey);
  finalizationStage = "read-approved-media-links-plan";
  await client.connect();
  let result;
  if (action === "plan") result = await planMediaAppLinks(client, boardClient, session, boardName);
  else result = await applyMediaAppLinks(client, boardClient, session, boardName, args[4]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function sameStringSet(values, expected) {
  return Array.isArray(values) && values.length === expected.size
    && new Set(values).size === expected.size
    && values.every((value) => typeof value === "string" && expected.has(value));
}

function boardItemIds(items) {
  if (!Array.isArray(items) || items.some((item) => !isRecord(item) || typeof item.id !== "string")) {
    throw new Error("Homarr board items are invalid");
  }
  return items.map((item) => item.id);
}

export async function repairLegacyStatsItem(client, boardName, managedIntegrationIds, managedAppIds, seerrIntegrationId) {
  if (typeof boardName !== "string" || boardName.trim() !== boardName || boardName.length < 1 || boardName.length > 255) {
    throw new Error("BOARD_NAME is invalid");
  }
  if (!(managedIntegrationIds instanceof Set) || managedIntegrationIds.size !== 6
    || !(managedAppIds instanceof Set) || managedAppIds.size !== 6
    || typeof seerrIntegrationId !== "string" || !managedIntegrationIds.has(seerrIntegrationId)) {
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
  if (!isRecord(requestStats[0].options) || Object.keys(requestStats[0].options).length !== 0
    || !sameStringSet(requestStats[0].integrationIds, new Set([seerrIntegrationId]))) {
    throw new Error("replacement Homarr media-request stats widget is not linked to the managed Seerr integration");
  }
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
  finalizationStage = "load-private-session";
  if (Bun.argv.length !== 3 && Bun.argv.length !== 4) {
    throw new Error("RUN_ID and optional BOARD_NAME are required");
  }
  const session = loadSession(Bun.argv[2]);
  requireSessionPasswordScheme(session);
  const { apiKey } = loadHomarrApiKey(session);
  const client = new NativeHomarrMcpClient(session, apiKey);

  // Endpoint discovery is deliberately read-only and always precedes updates.
  finalizationStage = "read-homarr-catalog";
  await client.connect();
  const apps = toolResultArray(await client.callTool("app_all"));
  const integrations = toolResultArray(await client.callTool("integration_all"));
  const updates = [];
  const managedIntegrationIds = new Set();
  const linkedAppIds = new Set();
  const expectedApps = new Map();
  let seerrIntegrationId;

  finalizationStage = "validate-media-links";
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
    managedIntegrationIds.add(integration.id);
    if (service.kind === "seerr") seerrIntegrationId = integration.id;
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
    if (app.href === service.navigationUrl && app.pingUrl === service.pingUrl
      && app.description === service.description) {
      continue;
    }
    updates.push(writableApp(app, service));
  }

  if (linkedAppIds.size !== 6 || managedIntegrationIds.size !== 6) {
    throw new Error("Homarr onboarding links are incomplete");
  }
  process.stdout.write("PASS Homarr six app and integration links verified\n");

  finalizationStage = "update-media-apps";
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
    if (app.href !== service.navigationUrl || app.pingUrl !== service.pingUrl
      || app.description !== service.description) {
      throw new Error("Homarr app description or URL update did not persist");
    }
  }
  process.stdout.write("PASS Homarr app navigation and ping URLs finalized\n");

  if (Bun.argv[3] !== undefined) {
    finalizationStage = "verify-private-board";
    const boardClient = new HomarrBoardApiClient(session, apiKey);
    const result = await repairLegacyStatsItem(
      boardClient,
      Bun.argv[3],
      managedIntegrationIds,
      linkedAppIds,
      seerrIntegrationId,
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
  let operation;
  if (["plan", "apply"].includes(Bun.argv[2])) operation = mediaLinksMode(Bun.argv.slice(2));
  else operation = main();
  operation.catch(() => {
    process.stdout.write(`FAIL Homarr finalization at ${finalizationStage}\n`);
    process.exitCode = 1;
  });
}
