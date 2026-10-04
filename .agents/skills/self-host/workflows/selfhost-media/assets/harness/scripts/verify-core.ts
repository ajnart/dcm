import { pathToFileURL } from "node:url";

import {
  arrHeaders,
  deriveSessionPassword,
  fieldValue,
  loadSession,
  normalizeName,
  request,
  requestJson,
  sessionAccess,
  setField,
  sleep,
  sessionUsername,
  tryRequest,
  validateRunId,
  writableFields,
} from "./lib/session-context.ts";

const runId = Bun.argv[2] ?? "";
let activeUsername = "";

function loopback(port) {
  return `http://127.0.0.1:${port}`;
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireArray(value, label) {
  check(Array.isArray(value), `${label} returned an unexpected response`);
  return value;
}

function arrIndexerIsEnabled(indexer) {
  return indexer.enableRss === true
    && indexer.enableAutomaticSearch === true
    && indexer.enableInteractiveSearch === true;
}

function qbitHeaders(baseUrl, cookie = "") {
  const headers = {
    Origin: baseUrl,
    Referer: `${baseUrl}/`,
  };
  if (cookie !== "") {
    headers.Cookie = cookie;
  }
  return headers;
}

async function qbitLogin(baseUrl, sessionPassword) {
  const result = await tryRequest(
    `${baseUrl}/api/v2/auth/login`,
    {
      method: "POST",
      headers: qbitHeaders(baseUrl),
      body: new URLSearchParams({
        username: activeUsername,
        password: sessionPassword,
      }),
    },
    [200, 204],
  );
  check(result.ok && result.response, "qBittorrent standard login failed");

  const setCookie = result.response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(
    /(?:^|[,;]\s*)(QBT_SID(?:_\d+)?)=([^;,]+)/,
  );
  check(match, "qBittorrent login did not establish a session");
  return `${match[1]}=${match[2]}`;
}

async function verifyQbit(session, sessionPassword) {
  const baseUrl = loopback(session.manifest.QBITTORRENT_PORT);
  const cookie = await qbitLogin(baseUrl, sessionPassword);
  const versionResult = await tryRequest(
    `${baseUrl}/api/v2/app/version`,
    { headers: qbitHeaders(baseUrl, cookie) },
    [200],
  );
  check(versionResult.ok, "qBittorrent authenticated API check failed");

  const categories = await requestJson(
    `${baseUrl}/api/v2/torrents/categories`,
    { headers: qbitHeaders(baseUrl, cookie) },
    { label: "qBittorrent category list" },
  );
  check(
    categories["tv-sonarr"]?.savePath === "/data/torrents/tv-sonarr",
    "qBittorrent Sonarr category is incorrect",
  );
  check(
    categories["movies-radarr"]?.savePath === "/data/torrents/movies-radarr",
    "qBittorrent Radarr category is incorrect",
  );
}

export async function verifyJellyfin(session, io = { request, requestJson }) {
  const baseUrl = loopback(session.manifest.JELLYFIN_PORT);
  const username = sessionUsername(session);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `MediaBrowser Client="Selfhost", Device="Verify", DeviceId="selfhost-verify-${session.runId}", Version="1.0"`,
  };
  const login = await io.requestJson(`${baseUrl}/Users/AuthenticateByName`, {
    method: "POST",
    headers,
    body: JSON.stringify({ Username: username, Pw: deriveSessionPassword(session) }),
  }, { label: "Jellyfin selected account login" });
  check(
    typeof login?.AccessToken === "string"
      && login.AccessToken !== ""
      && login.User?.Name === username
      && login.User?.Policy?.IsAdministrator === true,
    "Jellyfin selected administrator verification failed",
  );
  const authenticatedHeaders = { ...headers, "X-Emby-Token": login.AccessToken };
  try {
    const folders = requireArray(await io.requestJson(
      `${baseUrl}/Library/VirtualFolders`,
      { headers: authenticatedHeaders },
      { label: "Jellyfin library verification" },
    ), "Jellyfin library list");
    const expected = [
      { name: "Movies", type: "movies", path: "/data/media/movies" },
      { name: "Shows", type: "tvshows", path: "/data/media/tv" },
    ];
    check(expected.every((library) => folders.some((folder) => (
      folder?.Name === library.name
      && folder?.CollectionType === library.type
      && folder?.Locations?.includes(library.path)
    ))), "Jellyfin managed libraries are incorrect");
  } finally {
    await io.request(`${baseUrl}/Sessions/Logout`, {
      method: "POST",
      headers: authenticatedHeaders,
    }, { label: "Jellyfin verification logout", expectedStatuses: [200, 204] });
  }
}

export async function runVerificationRows(rows, write = console.log) {
  const safePrefixes = ["qBittorrent", "Sonarr", "Radarr", "Prowlarr", "Seerr", "Jellyfin", "service schema"];
  let failed = false;
  for (const row of rows) {
    if (row.pending === true) {
      write(`PENDING ${row.label}`);
      continue;
    }
    try {
      await row.verify();
      write(`PASS ${row.label}`);
    } catch (error) {
      failed = true;
      let message = "verification failed";
      if (
        error instanceof Error
        && error.message.length <= 200
        && !/[\r\n]/.test(error.message)
        && safePrefixes.some((prefix) => error.message.startsWith(prefix))
      ) {
        message = error.message;
      }
      write(`FAIL ${row.label}: ${message}`);
    }
  }
  return !failed;
}

async function arrResources(session, definition, sessionPassword) {
  const baseUrl = loopback(session.manifest[definition.portKey]);
  const headers = arrHeaders(session.secrets[definition.apiKey]);
  const apiRoot = `${baseUrl}/api/v3`;
  const status = await requestJson(
    `${apiRoot}/system/status`,
    { headers },
    { label: `${definition.name} status` },
  );
  check(Boolean(status.version), `${definition.name} status is incomplete`);

  const hostConfig = await requestJson(
    `${apiRoot}/config/host`,
    { headers },
    { label: `${definition.name} host configuration` },
  );
  check(
    normalizeName(hostConfig.authenticationMethod) === "forms",
    `${definition.name} Forms authentication is not enabled`,
  );
  check(
    normalizeName(hostConfig.authenticationRequired) === "enabled",
    `${definition.name} authentication is not required`,
  );
  check(
    hostConfig.username === activeUsername,
    `${definition.name} standard username is not configured`,
  );

  const roots = requireArray(
    await requestJson(
      `${apiRoot}/rootfolder`,
      { headers },
      { label: `${definition.name} root-folder list` },
    ),
    `${definition.name} root-folder list`,
  );
  check(
    roots.some((root) => root.path === definition.rootFolder),
    `${definition.name} shared root folder is missing`,
  );

  const clients = requireArray(
    await requestJson(
      `${apiRoot}/downloadclient`,
      { headers },
      { label: `${definition.name} download-client list` },
    ),
    `${definition.name} download-client list`,
  );
  const client = clients.find((candidate) => (
    candidate.enable === true
    && (
      normalizeName(candidate.implementation) === "qbittorrent"
      || normalizeName(candidate.implementationName) === "qbittorrent"
    )
  ));
  check(client, `${definition.name} qBittorrent client is missing`);
  check(
    fieldValue(client, "host") === "qbittorrent",
    `${definition.name} qBittorrent host is not internal`,
  );
  check(
    Number(fieldValue(client, "port")) === Number(session.manifest.QBITTORRENT_PORT),
    `${definition.name} qBittorrent port is incorrect`,
  );
  check(
    fieldValue(client, "username") === activeUsername,
    `${definition.name} qBittorrent username is incorrect`,
  );
  check(
    fieldValue(client, definition.categoryField) === definition.category,
    `${definition.name} qBittorrent category is incorrect`,
  );

  const testClient = {
    ...client,
    fields: writableFields(client),
  };
  setField(testClient.fields, "password", sessionPassword);
  const clientTest = await tryRequest(
    `${apiRoot}/downloadclient/test`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(testClient),
    },
    [200],
  );
  check(
    clientTest.ok,
    `${definition.name} qBittorrent connection test failed`,
  );

}

async function verifyArrIndexer(session, definition) {
  const apiRoot = `${loopback(session.manifest[definition.portKey])}/api/v3`;
  const headers = arrHeaders(session.secrets[definition.apiKey]);
  const indexers = requireArray(
    await requestJson(
      `${apiRoot}/indexer`,
      { headers },
      { label: `${definition.name} indexer list` },
    ),
    `${definition.name} indexer list`,
  );
  check(
    indexers.some((indexer) => (
      arrIndexerIsEnabled(indexer)
      && String(fieldValue(indexer, "baseUrl") ?? "")
        .startsWith("http://prowlarr:9696")
    )),
    `${definition.name} has no synced Prowlarr indexer`,
  );
}

function applicationMatches(application, definition) {
  const implementationMatches = (
    normalizeName(application.implementation) === normalizeName(definition.name)
    || normalizeName(application.implementationName) === normalizeName(definition.name)
  );
  return implementationMatches
    && application.enable === true
    && normalizeName(application.syncLevel) === "fullsync"
    && fieldValue(application, "prowlarrUrl") === "http://prowlarr:9696"
    && fieldValue(application, "baseUrl") === definition.internalUrl;
}

function apiReturnedSecret(value) {
  return typeof value === "string"
    && value !== ""
    && !/^\*+$/.test(value);
}

function apiKeyIsMask(value) {
  return typeof value === "string" && /^\*{8,}$/.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasPositiveId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isSafeServiceId(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateSeerrSettings(settings, expected) {
  check(isRecord(settings), "Seerr settings are invalid");
  check(isRecord(expected), "Seerr expected settings are invalid");
  check(isRecord(settings.public), "Seerr public settings are invalid");
  check(settings.public.initialized === true, "Seerr is not initialized");

  const jellyfin = settings.jellyfin;
  check(isRecord(jellyfin), "Seerr Jellyfin settings are invalid");
  check(jellyfin.ip === "jellyfin", "Seerr Jellyfin host is incorrect");
  check(Number(jellyfin.port) === 8096, "Seerr Jellyfin port is incorrect");
  check(jellyfin.useSsl === false, "Seerr Jellyfin SSL setting is incorrect");
  check(
    jellyfin.externalHostname === expected.jellyfinExternalHostname,
    "Seerr Jellyfin external URL is incorrect",
  );
  check(
    typeof jellyfin.serverId === "string" && jellyfin.serverId !== "",
    "Seerr Jellyfin server ID is missing",
  );
  const enabledLibraries = requireArray(
    jellyfin.libraries,
    "Seerr Jellyfin library list",
  ).filter((library) => isRecord(library) && library.enabled === true);
  const enabledLibraryNames = enabledLibraries
    .map((library) => normalizeName(library.name))
    .sort();
  check(
    enabledLibraryNames.length === 2
      && enabledLibraryNames[0] === "movies"
      && enabledLibraryNames[1] === "shows",
    "Seerr Jellyfin enabled libraries are incorrect",
  );

  const radarr = requireArray(settings.radarr, "Seerr Radarr settings");
  check(radarr.length === 1, "Seerr must have exactly one Radarr server");
  const radarrServer = radarr[0];
  check(isRecord(radarrServer), "Seerr Radarr server is invalid");
  check(isSafeServiceId(radarrServer.id), "Seerr Radarr ID is invalid");
  check(radarrServer.hostname === "radarr", "Seerr Radarr host is incorrect");
  check(Number(radarrServer.port) === 7878, "Seerr Radarr port is incorrect");
  check(radarrServer.useSsl === false, "Seerr Radarr SSL setting is incorrect");
  check(radarrServer.isDefault === true, "Seerr Radarr is not the default");
  check(radarrServer.is4k === false, "Seerr Radarr must be non-4K");
  check(
    radarrServer.activeDirectory === "/data/media/movies",
    "Seerr Radarr root folder is incorrect",
  );
  check(
    hasPositiveId(radarrServer.activeProfileId)
      && normalizeName(radarrServer.activeProfileName) === "any",
    "Seerr Radarr quality profile is incorrect",
  );
  check(radarrServer.preventSearch === false, "Seerr Radarr search is disabled");
  check(radarrServer.syncEnabled === true, "Seerr Radarr sync is disabled");
  check(
    radarrServer.externalUrl === expected.radarrExternalUrl,
    "Seerr Radarr external URL is incorrect",
  );
  check(
    radarrServer.apiKey === expected.radarrApiKey,
    "Seerr Radarr API key is incorrect",
  );

  const sonarr = requireArray(settings.sonarr, "Seerr Sonarr settings");
  check(sonarr.length === 1, "Seerr must have exactly one Sonarr server");
  const sonarrServer = sonarr[0];
  check(isRecord(sonarrServer), "Seerr Sonarr server is invalid");
  check(isSafeServiceId(sonarrServer.id), "Seerr Sonarr ID is invalid");
  check(sonarrServer.hostname === "sonarr", "Seerr Sonarr host is incorrect");
  check(Number(sonarrServer.port) === 8989, "Seerr Sonarr port is incorrect");
  check(sonarrServer.useSsl === false, "Seerr Sonarr SSL setting is incorrect");
  check(sonarrServer.isDefault === true, "Seerr Sonarr is not the default");
  check(sonarrServer.is4k === false, "Seerr Sonarr must be non-4K");
  check(
    sonarrServer.activeDirectory === "/data/media/tv"
      && sonarrServer.activeAnimeDirectory === "/data/media/tv",
    "Seerr Sonarr root folders are incorrect",
  );
  check(
    hasPositiveId(sonarrServer.activeProfileId)
      && normalizeName(sonarrServer.activeProfileName) === "any"
      && hasPositiveId(sonarrServer.activeAnimeProfileId)
      && normalizeName(sonarrServer.activeAnimeProfileName) === "any",
    "Seerr Sonarr quality profiles are incorrect",
  );
  check(sonarrServer.preventSearch === false, "Seerr Sonarr search is disabled");
  check(sonarrServer.syncEnabled === true, "Seerr Sonarr sync is disabled");
  check(
    sonarrServer.monitorNewItems === "all",
    "Seerr Sonarr new-item monitoring is incorrect",
  );
  check(
    sonarrServer.enableSeasonFolders === true,
    "Seerr Sonarr season folders are disabled",
  );
  check(
    sonarrServer.externalUrl === expected.sonarrExternalUrl,
    "Seerr Sonarr external URL is incorrect",
  );
  check(
    sonarrServer.apiKey === expected.sonarrApiKey,
    "Seerr Sonarr API key is incorrect",
  );

  return {
    radarr: radarrServer.id,
    sonarr: sonarrServer.id,
  };
}

export function validateSeerrCredentialIndex(index, expectedIds) {
  check(isRecord(index), "Seerr credential index is invalid");
  check(isRecord(expectedIds), "Seerr expected service IDs are invalid");
  check(
    isSafeServiceId(expectedIds.radarr) && isSafeServiceId(expectedIds.sonarr),
    "Seerr expected service IDs are invalid",
  );

  const users = requireArray(index.jellyfinUsers, "Seerr Jellyfin user list");
  check(
    users.length > 0 && users.every((user) => isRecord(user)),
    "Seerr Jellyfin persisted user is missing",
  );

  const radarr = requireArray(index.radarr, "Seerr Radarr service list");
  check(radarr.length === 1, "Seerr Radarr service list is not exact");
  check(isRecord(radarr[0]), "Seerr Radarr service record is invalid");
  check(
    isSafeServiceId(radarr[0].id) && radarr[0].id === expectedIds.radarr,
    "Seerr Radarr service ID is incorrect",
  );

  const sonarr = requireArray(index.sonarr, "Seerr Sonarr service list");
  check(sonarr.length === 1, "Seerr Sonarr service list is not exact");
  check(isRecord(sonarr[0]), "Seerr Sonarr service record is invalid");
  check(
    isSafeServiceId(sonarr[0].id) && sonarr[0].id === expectedIds.sonarr,
    "Seerr Sonarr service ID is incorrect",
  );

  return {
    radarr: radarr[0].id,
    sonarr: sonarr[0].id,
  };
}

function validateSeerrServiceDetail(detail, label) {
  check(isRecord(detail), `${label} service detail is invalid`);
  const profiles = requireArray(detail.profiles, `${label} profile list`);
  const rootFolders = requireArray(detail.rootFolders, `${label} root-folder list`);
  requireArray(detail.tags, `${label} tag list`);
  check(profiles.length > 0, `${label} profile list is empty`);
  check(rootFolders.length > 0, `${label} root-folder list is empty`);
}

export function validateSeerrServiceDetails(details) {
  check(isRecord(details), "Seerr service details are invalid");
  validateSeerrServiceDetail(details.radarr, "Seerr Radarr");
  validateSeerrServiceDetail(details.sonarr, "Seerr Sonarr");
}

export async function verifySeerr(session, getJson = requestJson, access = sessionAccess(session)) {
  const apiRoot = `${loopback(session.manifest.SEERR_PORT)}/api/v1/settings`;
  const headers = arrHeaders(session.secrets.SEERR_API_KEY);
  const endpoints = ["public", "jellyfin", "radarr", "sonarr"];
  const responses = Object.create(null);

  for (const endpoint of endpoints) {
    responses[endpoint] = await getJson(
      `${apiRoot}/${endpoint}`,
      { method: "GET", headers },
      { label: `Seerr ${endpoint} settings` },
    );
  }

  const settingsIds = validateSeerrSettings(responses, {
    jellyfinExternalHostname: access.services.jellyfin.reachableUrl ?? access.services.jellyfin.browserUrl,
    radarrApiKey: session.secrets.RADARR_API_KEY,
    radarrExternalUrl: access.services.radarr.reachableUrl ?? access.services.radarr.browserUrl,
    sonarrApiKey: session.secrets.SONARR_API_KEY,
    sonarrExternalUrl: access.services.sonarr.reachableUrl ?? access.services.sonarr.browserUrl,
  });

  const credentialIndex = {
    jellyfinUsers: await getJson(
      `${apiRoot}/jellyfin/users`,
      { method: "GET", headers },
      { label: "Seerr Jellyfin user settings" },
    ),
    radarr: await getJson(
      `${loopback(session.manifest.SEERR_PORT)}/api/v1/service/radarr`,
      { method: "GET", headers },
      { label: "Seerr Radarr service list" },
    ),
    sonarr: await getJson(
      `${loopback(session.manifest.SEERR_PORT)}/api/v1/service/sonarr`,
      { method: "GET", headers },
      { label: "Seerr Sonarr service list" },
    ),
  };
  const serviceIds = validateSeerrCredentialIndex(credentialIndex, settingsIds);
  const serviceRoot = `${loopback(session.manifest.SEERR_PORT)}/api/v1/service`;
  const details = {
    radarr: await getJson(
      `${serviceRoot}/radarr/${encodeURIComponent(String(serviceIds.radarr))}`,
      { method: "GET", headers },
      { label: "Seerr Radarr service detail" },
    ),
    sonarr: await getJson(
      `${serviceRoot}/sonarr/${encodeURIComponent(String(serviceIds.sonarr))}`,
      { method: "GET", headers },
      { label: "Seerr Sonarr service detail" },
    ),
  };
  validateSeerrServiceDetails(details);
}

export async function verifyProwlarrIndexers(
  indexers,
  indexerStatuses,
  testIndexer,
  options = {},
) {
  const enabledIndexers = requireArray(indexers, "Prowlarr indexer list")
    .filter((indexer) => indexer.enable === true);
  check(enabledIndexers.length > 0, "Prowlarr has no enabled indexer");

  const now = options.now ?? Date.now();
  const statusByIndexerId = new Map(
    requireArray(indexerStatuses, "Prowlarr indexer status")
      .map((status) => [status.indexerId, status]),
  );
  const availableIndexers = enabledIndexers.filter((indexer) => {
    const status = statusByIndexerId.get(indexer.id);
    if (!status?.disabledTill) {
      return true;
    }
    return new Date(status.disabledTill).getTime() <= now;
  });
  check(availableIndexers.length > 0, "Prowlarr has no available enabled indexer");

  const wait = options.wait ?? sleep;
  for (const indexer of availableIndexers) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await testIndexer(indexer)) {
        return;
      }
      if (attempt < 2) {
        await wait(1_000);
      }
    }
  }
  check(false, "Prowlarr enabled indexer test failed");
}

async function verifyProwlarr(session, arrDefinitions, options = {}) {
  const apiRoot = `${loopback(session.manifest.PROWLARR_PORT)}/api/v1`;
  const headers = arrHeaders(session.secrets.PROWLARR_API_KEY);
  const status = await requestJson(
    `${apiRoot}/system/status`,
    { headers },
    { label: "Prowlarr status" },
  );
  check(Boolean(status.version), "Prowlarr status is incomplete");

  const hostConfig = await requestJson(
    `${apiRoot}/config/host`,
    { headers },
    { label: "Prowlarr host configuration" },
  );
  check(
    normalizeName(hostConfig.authenticationMethod) === "forms",
    "Prowlarr authentication method is not Forms",
  );
  check(
    normalizeName(hostConfig.authenticationRequired) === "enabled",
    "Prowlarr authentication is not required",
  );
  check(
    hostConfig.username === activeUsername,
    "Prowlarr standard username is not configured",
  );

  const applications = requireArray(
    await requestJson(
      `${apiRoot}/applications`,
      { headers },
      { label: "Prowlarr application list" },
    ),
    "Prowlarr application list",
  );
  for (const definition of arrDefinitions) {
    const application = applications.find((candidate) => (
      applicationMatches(candidate, definition)
    ));
    check(
      application,
      `Prowlarr ${definition.name} full-sync application is incorrect`,
    );

    const returnedApiKey = fieldValue(application, "apiKey");
    if (apiReturnedSecret(returnedApiKey)) {
      check(
        returnedApiKey === session.secrets[definition.apiKey],
        `Prowlarr ${definition.name} application API key is incorrect`,
      );
    } else {
      check(
        apiKeyIsMask(returnedApiKey),
        `Prowlarr ${definition.name} application API key mask is invalid`,
      );
    }

    const applicationTest = await tryRequest(
      `${apiRoot}/applications/test`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(application),
      },
      [200],
    );
    check(
      applicationTest.ok,
      `Prowlarr ${definition.name} application test failed`,
    );

    const knownKeyApplication = {
      ...application,
      fields: writableFields(application),
    };
    setField(
      knownKeyApplication.fields,
      "apiKey",
      session.secrets[definition.apiKey],
    );
    const knownKeyTest = await tryRequest(
      `${apiRoot}/applications/test`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(knownKeyApplication),
      },
      [200],
    );
    check(
      knownKeyTest.ok,
      `Prowlarr ${definition.name} known-key application test failed`,
    );
  }

  if (options.deferIndexer === true) {
    return;
  }

  const indexers = requireArray(
    await requestJson(
      `${apiRoot}/indexer`,
      { headers },
      { label: "Prowlarr indexer list" },
    ),
    "Prowlarr indexer list",
  );
  const indexerStatuses = requireArray(
    await requestJson(
      `${apiRoot}/indexerstatus`,
      { headers },
      { label: "Prowlarr indexer status" },
    ),
    "Prowlarr indexer status",
  );
  await verifyProwlarrIndexers(indexers, indexerStatuses, async (indexer) => {
    const indexerTest = await tryRequest(
      `${apiRoot}/indexer/test`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(indexer),
      },
      [200],
    );
    return indexerTest.ok;
  });
}

export async function main(selectedRunId = runId, mode = "all", options = {}) {
  validateRunId(selectedRunId);
  const session = loadSession(selectedRunId);
  activeUsername = sessionUsername(session);
  const sessionPassword = deriveSessionPassword(session);
  const arrDefinitions = [
    {
      name: "Sonarr",
      portKey: "SONARR_PORT",
      apiKey: "SONARR_API_KEY",
      rootFolder: "/data/media/tv",
      categoryField: "tvCategory",
      category: "tv-sonarr",
      internalUrl: "http://sonarr:8989",
    },
    {
      name: "Radarr",
      portKey: "RADARR_PORT",
      apiKey: "RADARR_API_KEY",
      rootFolder: "/data/media/movies",
      categoryField: "movieCategory",
      category: "movies-radarr",
      internalUrl: "http://radarr:7878",
    },
  ];

  if (mode === "verify-seerr") {
    return runVerificationRows([{
      label: "Seerr links and persisted service configuration",
      verify: () => verifySeerr(session),
    }]);
  }
  const deferIndexer = options.deferIndexer === true;
  const indexerRows = [];
  if (deferIndexer) {
    indexerRows.push(
      { label: "Prowlarr auth and full-sync applications", verify: () => verifyProwlarr(session, arrDefinitions, { deferIndexer }) },
      { label: "Prowlarr selected indexer", pending: true },
      { label: "Sonarr synced indexer edge", pending: true },
      { label: "Radarr synced indexer edge", pending: true },
    );
  } else {
    indexerRows.push(
      ...arrDefinitions.map((definition) => ({
        label: `${definition.name} Prowlarr indexer edge`,
        verify: () => verifyArrIndexer(session, definition),
      })),
      { label: "Prowlarr auth, applications, and indexer state", verify: () => verifyProwlarr(session, arrDefinitions) },
    );
  }
  const rows = [
    { label: "qBittorrent login and categories", verify: () => verifyQbit(session, sessionPassword) },
    ...arrDefinitions.map((definition) => ({
      label: `${definition.name} auth, root, and qBittorrent link`,
      verify: () => arrResources(session, definition, sessionPassword),
    })),
    ...indexerRows,
    { label: "Jellyfin selected administrator and managed libraries", verify: () => verifyJellyfin(session) },
    { label: "Seerr links and persisted service configuration", verify: () => verifySeerr(session) },
  ];
  return runVerificationRows(rows);
}

async function runFromCli() {
  let mode = "all";
  let selectedRunId = runId;
  let deferIndexer = false;
  if (Bun.argv[2] === "verify-seerr") {
    mode = "verify-seerr";
    selectedRunId = Bun.argv[3] ?? "";
    if (Bun.argv.length !== 4) throw new Error("verify-seerr requires one RUN_ID");
  } else {
    const options = Bun.argv.slice(3);
    if (options.length === 1 && options[0] === "--defer-indexer") {
      deferIndexer = true;
    } else if (options.length !== 0) {
      throw new Error("verification accepts only optional --defer-indexer");
    }
  }
  const passed = await main(selectedRunId, mode, { deferIndexer });
  if (!passed) {
    process.exitCode = 1;
    return;
  }
  if (deferIndexer) process.exitCode = 2;
}

if (
  Bun.argv[1] !== undefined
  && import.meta.url === pathToFileURL(Bun.argv[1]).href
) {
  runFromCli().catch((error) => {
    console.error(`FAIL core verification: ${error.message}`);
    process.exitCode = 1;
  });
}
