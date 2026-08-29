#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  loadHomarrApiKey,
  loadSession,
  normalizeName,
  requireSessionPasswordScheme,
} from "./lib/session-context.mjs";
import {
  isRecord,
  NativeHomarrMcpClient,
  toolResultArray,
  toolResultValue,
} from "./lib/homarr-mcp.mjs";

function serviceDefinitions(session) {
  return [
    {
      kind: "sonarr",
      navigationUrl: `http://127.0.0.1:${session.manifest.SONARR_PORT}`,
      pingUrl: "http://sonarr:8989",
    },
    {
      kind: "radarr",
      navigationUrl: `http://127.0.0.1:${session.manifest.RADARR_PORT}`,
      pingUrl: "http://radarr:7878",
    },
    {
      kind: "prowlarr",
      navigationUrl: `http://127.0.0.1:${session.manifest.PROWLARR_PORT}`,
      pingUrl: "http://prowlarr:9696",
    },
    {
      kind: "qbittorrent",
      navigationUrl: `http://127.0.0.1:${session.manifest.QBITTORRENT_PORT}`,
      pingUrl: `http://qbittorrent:${session.manifest.QBITTORRENT_PORT}`,
    },
    {
      kind: "jellyfin",
      navigationUrl: `http://127.0.0.1:${session.manifest.JELLYFIN_PORT}`,
      pingUrl: "http://jellyfin:8096",
    },
    {
      kind: "seerr",
      navigationUrl: `http://127.0.0.1:${session.manifest.SEERR_PORT}`,
      pingUrl: "http://seerr:5055",
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

async function main() {
  if (process.argv.length !== 3) {
    throw new Error("RUN_ID is required");
  }
  const session = loadSession(process.argv[2]);
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
}

if (
  process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stdout.write("FAIL Homarr finalization\n");
    process.exitCode = 1;
  });
}
