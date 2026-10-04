#!/usr/bin/env bun

import { pathToFileURL } from "node:url";
import { curlFetch } from "./lib/curl-http.ts";
import { loadHomarrApiKey, loadSession, requireSessionPasswordScheme, sessionAccess, useCurlTransport } from "./lib/session-context.ts";
import { printWidgetProof, PROCEDURES, validateWidgetProof } from "./prove-homarr-widgets.ts";
import { SERVICE_DESCRIPTIONS } from "./homarr-finalize.ts";

const EXPECTED_COUNTS = {
  calendar: 2,
  mediaMissing: 2,
  indexerManager: 1,
  downloads: 1,
  "mediaRequests-requestStats": 1,
  mediaServer: 1,
  mediaReleases: 1,
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boardItem(board, kind) {
  const matches = board.items.filter((item) => item?.kind === kind);
  if (matches.length !== 1 || !Array.isArray(matches[0].integrationIds)
    || matches[0].integrationIds.length !== EXPECTED_COUNTS[kind]) {
    throw new Error("Homarr generated widget is missing or disconnected");
  }
  return matches[0];
}

export function appTilesAreLinked(board, apps, access) {
  if (!Array.isArray(board?.items) || !Array.isArray(apps)) return false;
  const tiles = board.items.filter((item) => item?.kind === "app");
  const services = ["sonarr", "radarr", "prowlarr", "qbittorrent", "jellyfin", "seerr"];
  if (tiles.length < services.length) return false;
  const ids = tiles.map((item) => item?.options?.appId);
  return services.every((service) => {
    const expected = access?.services?.[service];
    const navigationUrl = expected?.reachableUrl ?? expected?.browserUrl;
    const matches = apps.filter((app) => app?.name?.toLowerCase() === service);
    return matches.length === 1 && ids.filter((id) => id === matches[0].id).length === 1
      && matches[0].href === navigationUrl
      && matches[0].pingUrl === expected?.dockerUrl
      && matches[0].description === SERVICE_DESCRIPTIONS[service];
  });
}

export function widgetResultIsHealthy(procedure, result, integrationIds) {
  if (!Array.isArray(integrationIds) || integrationIds.length < 1 || new Set(integrationIds).size !== integrationIds.length) return false;
  if (procedure === "widget.mediaRelease.getMediaReleases") {
    return object(result) && Array.isArray(result.releases)
      && Array.isArray(result.failedIntegrations) && result.failedIntegrations.length === 0;
  }
  if (procedure === "widget.mediaRequests.getStats") {
    return object(result) && Array.isArray(result.failedIntegrations)
      && result.failedIntegrations.length === 0 && Array.isArray(result.integrations)
      && result.integrations.length === integrationIds.length
      && result.integrations.every((item) => integrationIds.includes(item?.id));
  }
  if (!Array.isArray(result) || result.length !== integrationIds.length) return false;
  const seen = new Set();
  for (const item of result) {
    if (!object(item) || (item.error !== undefined && item.error !== null)) return false;
    const integrationId = item.integrationId ?? item.integration?.id;
    if (!integrationIds.includes(integrationId) || seen.has(integrationId)) return false;
    seen.add(integrationId);
    if (procedure === "widget.indexerManager.getIndexersStatus" && !Array.isArray(item.indexers)) return false;
    if (procedure === "widget.downloads.getJobsAndStatuses" && !object(item.data)) return false;
    if (procedure === "widget.mediaServer.getCurrentStreams" && !Array.isArray(item.sessions)) return false;
    if (procedure === "widget.calendar.findAllEvents" && !Array.isArray(item.events)) return false;
    if (procedure === "widget.mediaOrganizer.getData"
      && (!Array.isArray(item.missing) || !Array.isArray(item.queued))) return false;
  }
  return true;
}

export function widgetProofFailureReason(error) {
  if (!(error instanceof Error)) return "unknown";
  const fixed = new Set([
    "Homarr board is unavailable",
    "Homarr generated app tiles or links are incomplete",
    "Homarr generated widget is missing or disconnected",
    "Homarr widget API returned invalid JSON",
    "Homarr widget proof is incomplete",
    "Homarr widget proof row schema is invalid",
    "Homarr media-release proof counts are invalid",
    "Homarr media-release proof has failed integrations",
  ]);
  if (fixed.has(error.message)) return error.message;
  for (const procedure of PROCEDURES) {
    if (error.message === `Homarr widget proof failed for ${procedure}`) return `procedure=${procedure}`;
  }
  return "unknown";
}

export async function proveHomarrWidgetsApi(session, boardName) {
  requireSessionPasswordScheme(session);
  useCurlTransport(session);
  const { apiKey } = loadHomarrApiKey(session);
  const origin = `http://127.0.0.1:${session.manifest.HOMARR_PORT}`;
  async function query(procedure, input) {
    const path = `/api/trpc/${procedure}`;
    const url = `${origin}${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const response = await curlFetch(url, { headers: { Accept: "application/json", ApiKey: apiKey, Cookie: "" } });
    let payload;
    try { payload = await response.json(); } catch { throw new Error("Homarr widget API returned invalid JSON"); }
    return { response, payload, path };
  }
  const boardReply = await query("board.getBoardByName", { name: boardName });
  const board = boardReply.payload?.result?.data?.json;
  if (boardReply.response.status !== 200 || !object(board) || board.name !== boardName
    || board.isPublic !== false || !Array.isArray(board.items)) {
    throw new Error("Homarr board is unavailable");
  }
  const appsReply = await query("app.all");
  const apps = appsReply.payload?.result?.data?.json;
  if (appsReply.response.status !== 200 || !appTilesAreLinked(board, apps, sessionAccess(session))) {
    throw new Error("Homarr generated app tiles or links are incomplete");
  }
  const now = new Date();
  const inputs = {
    "widget.indexerManager.getIndexersStatus": { integrationIds: boardItem(board, "indexerManager").integrationIds },
    "widget.downloads.getJobsAndStatuses": { integrationIds: boardItem(board, "downloads").integrationIds, limitPerIntegration: 50 },
    "widget.mediaRequests.getStats": { integrationIds: boardItem(board, "mediaRequests-requestStats").integrationIds },
    "widget.mediaServer.getCurrentStreams": { integrationIds: boardItem(board, "mediaServer").integrationIds, showOnlyPlaying: false },
    "widget.calendar.findAllEvents": { integrationIds: boardItem(board, "calendar").integrationIds, year: now.getFullYear(), month: now.getMonth() + 1, releaseType: ["inCinemas", "digitalRelease"], showUnmonitored: false },
    "widget.mediaOrganizer.getData": { integrationIds: boardItem(board, "mediaMissing").integrationIds, pageSize: 10 },
    "widget.mediaRelease.getMediaReleases": { integrationIds: boardItem(board, "mediaReleases").integrationIds },
  };
  const rows = [];
  for (const procedure of PROCEDURES) {
    const { response, payload, path } = await query(procedure, inputs[procedure]);
    const result = payload?.result?.data?.json;
    let classification = "error";
    if (response.status === 200 && !payload?.error
      && widgetResultIsHealthy(procedure, result, inputs[procedure].integrationIds)) {
      classification = "result";
    }
    const row = {
      procedure,
      method: "GET",
      path,
      status: response.status,
      classification,
    };
    if (procedure === "widget.mediaRelease.getMediaReleases") {
      row.releases = Array.isArray(result?.releases) ? result.releases.length : -1;
      row.failedIntegrations = Array.isArray(result?.failedIntegrations) ? result.failedIntegrations.length : -1;
    }
    rows.push(row);
  }
  return validateWidgetProof({ board: boardName, rows }, boardName);
}

if (Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  try {
    if (Bun.argv.length !== 4) throw new Error("usage");
    printWidgetProof(await proveHomarrWidgetsApi(loadSession(Bun.argv[2]), Bun.argv[3]));
  } catch (error) {
    console.error(`FAIL Homarr generated-widget API proof reason=${widgetProofFailureReason(error)}`);
    process.exitCode = 1;
  }
}
