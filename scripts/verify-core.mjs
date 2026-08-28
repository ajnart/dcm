import {
  arrHeaders,
  deriveSessionPassword,
  fieldValue,
  loadSession,
  normalizeName,
  requestJson,
  setField,
  sleep,
  STANDARD_USERNAME,
  tryRequest,
  validateRunId,
  writableFields,
} from "./lib/session-context.mjs";

const runId = process.argv[2] ?? "";

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
        username: STANDARD_USERNAME,
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
    hostConfig.username === STANDARD_USERNAME,
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
    fieldValue(client, "username") === STANDARD_USERNAME,
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

async function verifyProwlarr(session, arrDefinitions) {
  const apiRoot = `${loopback(session.manifest.PROWLARR_PORT)}/api/v1`;
  const headers = arrHeaders(session.secrets.PROWLARR_API_KEY);
  const status = await requestJson(
    `${apiRoot}/system/status`,
    { headers },
    { label: "Prowlarr status" },
  );
  check(Boolean(status.version), "Prowlarr status is incomplete");

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

  const indexers = requireArray(
    await requestJson(
      `${apiRoot}/indexer`,
      { headers },
      { label: "Prowlarr indexer list" },
    ),
    "Prowlarr indexer list",
  );
  const publicIndexers = indexers.filter((indexer) => (
    indexer.enable === true
    && String(indexer.privacy ?? "public").toLowerCase() === "public"
  ));
  check(publicIndexers.length > 0, "Prowlarr has no enabled public indexer");

  const indexerStatuses = requireArray(
    await requestJson(
      `${apiRoot}/indexerstatus`,
      { headers },
      { label: "Prowlarr indexer status" },
    ),
    "Prowlarr indexer status",
  );
  const now = Date.now();
  const statusByIndexerId = new Map(
    indexerStatuses.map((status) => [status.indexerId, status]),
  );
  const hasAvailablePublicIndexer = publicIndexers.some((indexer) => {
    const status = statusByIndexerId.get(indexer.id);
    if (!status?.disabledTill) {
      return true;
    }
    return new Date(status.disabledTill).getTime() <= now;
  });
  check(hasAvailablePublicIndexer, "Prowlarr has no available public indexer");

  let testedPublicIndexer = false;
  for (const indexer of publicIndexers) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const indexerTest = await tryRequest(
        `${apiRoot}/indexer/test`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(indexer),
        },
        [200],
      );
      if (indexerTest.ok) {
        testedPublicIndexer = true;
        break;
      }
      if (attempt < 2) {
        await sleep(1_000);
      }
    }
    if (testedPublicIndexer) {
      break;
    }
  }
  check(testedPublicIndexer, "Prowlarr public indexer test failed");
}

async function main() {
  validateRunId(runId);
  const session = loadSession(runId);
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

  await verifyQbit(session, sessionPassword);
  console.log("PASS qBittorrent login and categories");

  for (const definition of arrDefinitions) {
    await arrResources(session, definition, sessionPassword);
    console.log(`PASS ${definition.name} auth, root, qBittorrent, and Prowlarr links`);
  }

  await verifyProwlarr(session, arrDefinitions);
  console.log("PASS Prowlarr applications and public indexer state");
}

main().catch((error) => {
  console.error(`FAIL core verification: ${error.message}`);
  process.exitCode = 1;
});
