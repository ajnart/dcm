import {
  arrHeaders,
  composeLogs,
  deriveSessionPassword,
  fieldValue,
  loadSession,
  normalizeName,
  printSessionConnectionsSummary,
  refreshArrKeys,
  request,
  requestJson,
  setField,
  sleep,
  STANDARD_USERNAME,
  tryRequest,
  validateRunId,
  writableFields,
  writeSessionConnections,
} from "./lib/session-context.ts";

const runId = Bun.argv[2] ?? "";

function loopback(port) {
  return `http://127.0.0.1:${port}`;
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} returned an unexpected response`);
  }
  return value;
}

async function waitForCoreServices(session) {
  const manifest = session.manifest;
  const checks = [
    [loopback(manifest.PROWLARR_PORT), "Prowlarr"],
    [loopback(manifest.RADARR_PORT), "Radarr"],
    [loopback(manifest.SONARR_PORT), "Sonarr"],
  ].map(([baseUrl, label]) => request(
    `${baseUrl}/ping`,
    {},
    {
      attempts: 40,
      expectedStatuses: [200],
      label: `${label} readiness check`,
    },
  ));

  checks.push(request(
    `${loopback(manifest.QBITTORRENT_PORT)}/api/v2/app/version`,
    {},
    {
      attempts: 40,
      expectedStatuses: [200, 401, 403],
      label: "qBittorrent readiness check",
    },
  ));

  await Promise.all(checks);
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

async function qbitLogin(baseUrl, password) {
  const response = await tryRequest(
    `${baseUrl}/api/v2/auth/login`,
    {
      method: "POST",
      headers: qbitHeaders(baseUrl),
      body: new URLSearchParams({
        username: STANDARD_USERNAME,
        password,
      }),
    },
    [200, 204],
  );

  if (!response.ok || !response.response) {
    return "";
  }

  const setCookie = response.response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(
    /(?:^|[,;]\s*)(QBT_SID(?:_\d+)?)=([^;,]+)/,
  );
  if (!match) {
    return "";
  }
  return `${match[1]}=${match[2]}`;
}

function latestTemporaryQbitPassword(logs) {
  const withoutAnsi = logs.replace(/\u001b\[[0-9;]*m/g, "");
  const matches = [
    ...withoutAnsi.matchAll(
      /temporary password is provided for this session:\s*(\S+)/gi,
    ),
  ];
  if (matches.length === 0) {
    return "";
  }
  return matches.at(-1)[1];
}

async function qbitPost(baseUrl, cookie, endpoint, values, label) {
  await request(
    `${baseUrl}/api/v2/${endpoint}`,
    {
      method: "POST",
      headers: qbitHeaders(baseUrl, cookie),
      body: new URLSearchParams(values),
    },
    {
      expectedStatuses: [200],
      label,
    },
  );
}

async function configureQbit(session, sessionPassword) {
  const baseUrl = loopback(session.manifest.QBITTORRENT_PORT);
  let cookie = await qbitLogin(baseUrl, sessionPassword);

  if (cookie === "") {
    let temporaryPassword = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      temporaryPassword = latestTemporaryQbitPassword(
        composeLogs(session, "qbittorrent"),
      );
      if (temporaryPassword !== "") {
        break;
      }
      await sleep(500);
    }

    if (temporaryPassword === "") {
      throw new Error("qBittorrent temporary password was not available");
    }

    cookie = await qbitLogin(baseUrl, temporaryPassword);
    temporaryPassword = "";
    if (cookie === "") {
      throw new Error("qBittorrent temporary login failed");
    }
  }

  await qbitPost(
    baseUrl,
    cookie,
    "app/setPreferences",
    {
      json: jsonBody({
        save_path: "/data/torrents",
        temp_path: "/data/torrents/incomplete",
        temp_path_enabled: true,
        web_ui_password: sessionPassword,
      }),
    },
    "qBittorrent preference update",
  );

  cookie = await qbitLogin(baseUrl, sessionPassword);
  if (cookie === "") {
    throw new Error("qBittorrent standard login verification failed");
  }

  const categories = await requestJson(
    `${baseUrl}/api/v2/torrents/categories`,
    {
      headers: qbitHeaders(baseUrl, cookie),
    },
    { label: "qBittorrent category list" },
  );

  for (const [category, savePath] of [
    ["tv-sonarr", "/data/torrents/tv-sonarr"],
    ["movies-radarr", "/data/torrents/movies-radarr"],
  ]) {
    if (!Object.hasOwn(categories, category)) {
      await qbitPost(
        baseUrl,
        cookie,
        "torrents/createCategory",
        { category, savePath },
        `qBittorrent ${category} category creation`,
      );
      continue;
    }

    if (categories[category]?.savePath !== savePath) {
      await qbitPost(
        baseUrl,
        cookie,
        "torrents/editCategory",
        { category, savePath },
        `qBittorrent ${category} category update`,
      );
    }
  }
}

function downloadClientPayload(
  source,
  schema,
  categoryField,
  category,
  qbitPort,
  sessionPassword,
) {
  const fields = writableFields(source);
  setField(fields, "host", "qbittorrent");
  setField(fields, "port", Number(qbitPort));
  setField(fields, "username", STANDARD_USERNAME);
  setField(fields, "password", sessionPassword);
  setField(fields, categoryField, category);

  const optionalValues = new Map([
    ["useSsl", false],
    ["urlBase", ""],
  ]);
  for (const field of fields) {
    if (optionalValues.has(field.name)) {
      field.value = optionalValues.get(field.name);
    }
  }

  const payload = {
    enable: true,
    name: "qBittorrent",
    priority: Number(source.priority ?? 1),
    protocol: source.protocol ?? "torrent",
    removeCompletedDownloads: true,
    removeFailedDownloads: true,
    fields,
    implementationName: schema.implementationName,
    implementation: schema.implementation,
    configContract: schema.configContract,
    tags: Array.isArray(source.tags) ? source.tags : [],
  };
  if (source.id) {
    payload.id = source.id;
  }
  return payload;
}

async function configureArr(session, definition, sessionPassword) {
  const baseUrl = loopback(session.manifest[definition.portKey]);
  const headers = arrHeaders(session.secrets[definition.apiKey]);
  const apiRoot = `${baseUrl}/api/v3`;
  const hostConfig = await requestJson(
    `${apiRoot}/config/host`,
    { headers },
    { label: `${definition.name} host configuration` },
  );

  const securedHostConfig = {
    ...hostConfig,
    authenticationMethod: "forms",
    authenticationRequired: "enabled",
    username: STANDARD_USERNAME,
    password: sessionPassword,
    passwordConfirmation: sessionPassword,
  };
  await request(
    `${apiRoot}/config/host`,
    {
      method: "PUT",
      headers,
      body: jsonBody(securedHostConfig),
    },
    {
      expectedStatuses: [200, 202],
      label: `${definition.name} forms authentication update`,
    },
  );

  const rootFolders = requireArray(
    await requestJson(
      `${apiRoot}/rootfolder`,
      { headers },
      { label: `${definition.name} root-folder list` },
    ),
    `${definition.name} root-folder list`,
  );
  if (!rootFolders.some((folder) => folder.path === definition.rootFolder)) {
    await request(
      `${apiRoot}/rootfolder`,
      {
        method: "POST",
        headers,
        body: jsonBody({ path: definition.rootFolder }),
      },
      {
        expectedStatuses: [200, 201, 202],
        label: `${definition.name} root-folder creation`,
      },
    );
  }

  const schemas = requireArray(
    await requestJson(
      `${apiRoot}/downloadclient/schema`,
      { headers },
      { label: `${definition.name} download-client schemas` },
    ),
    `${definition.name} download-client schemas`,
  );
  const schema = schemas.find((candidate) => (
    normalizeName(candidate.implementation) === "qbittorrent"
    || normalizeName(candidate.implementationName) === "qbittorrent"
  ));
  if (!schema) {
    throw new Error(`${definition.name} has no qBittorrent schema`);
  }

  const clients = requireArray(
    await requestJson(
      `${apiRoot}/downloadclient`,
      { headers },
      { label: `${definition.name} download-client list` },
    ),
    `${definition.name} download-client list`,
  );
  const existing = clients.find((candidate) => (
    normalizeName(candidate.implementation) === "qbittorrent"
    || normalizeName(candidate.implementationName) === "qbittorrent"
  ));
  const payload = downloadClientPayload(
    existing ?? schema,
    schema,
    definition.categoryField,
    definition.category,
    session.manifest.QBITTORRENT_PORT,
    sessionPassword,
  );

  await request(
    `${apiRoot}/downloadclient/test`,
    {
      method: "POST",
      headers,
      body: jsonBody(payload),
    },
    {
      expectedStatuses: [200],
      label: `${definition.name} qBittorrent connection test`,
    },
  );

  const endpoint = existing
    ? `${apiRoot}/downloadclient/${existing.id}`
    : `${apiRoot}/downloadclient`;
  const method = existing ? "PUT" : "POST";
  await request(
    endpoint,
    {
      method,
      headers,
      body: jsonBody(payload),
    },
    {
      expectedStatuses: [200, 201, 202],
      label: `${definition.name} qBittorrent client save`,
    },
  );
}

function applicationPayload(source, schema, definition, session) {
  const fields = writableFields(source);
  setField(fields, "prowlarrUrl", "http://prowlarr:9696");
  setField(fields, "baseUrl", definition.internalUrl);
  setField(fields, "apiKey", session.secrets[definition.apiKey]);

  const payload = {
    enable: true,
    name: definition.name,
    syncLevel: "fullSync",
    fields,
    implementationName: schema.implementationName,
    implementation: schema.implementation,
    configContract: schema.configContract,
    tags: Array.isArray(source.tags) ? source.tags : [],
  };
  if (source.id) {
    payload.id = source.id;
  }
  return payload;
}

async function configureProwlarrAuth(session, sessionPassword) {
  const apiRoot = `${loopback(session.manifest.PROWLARR_PORT)}/api/v1`;
  const headers = arrHeaders(session.secrets.PROWLARR_API_KEY);
  const hostConfig = await requestJson(
    `${apiRoot}/config/host`,
    { headers },
    { label: "Prowlarr host configuration" },
  );
  await request(
    `${apiRoot}/config/host`,
    {
      method: "PUT",
      headers,
      body: jsonBody({
        ...hostConfig,
        authenticationMethod: "forms",
        authenticationRequired: "enabled",
        username: STANDARD_USERNAME,
        password: sessionPassword,
        passwordConfirmation: sessionPassword,
      }),
    },
    {
      expectedStatuses: [200, 202],
      label: "Prowlarr forms authentication update",
    },
  );
}

async function configureProwlarrApplications(session, arrDefinitions) {
  const baseUrl = loopback(session.manifest.PROWLARR_PORT);
  const apiRoot = `${baseUrl}/api/v1`;
  const headers = arrHeaders(session.secrets.PROWLARR_API_KEY);
  const schemas = requireArray(
    await requestJson(
      `${apiRoot}/applications/schema`,
      { headers },
      { label: "Prowlarr application schemas" },
    ),
    "Prowlarr application schemas",
  );
  let applications = requireArray(
    await requestJson(
      `${apiRoot}/applications`,
      { headers },
      { label: "Prowlarr application list" },
    ),
    "Prowlarr application list",
  );

  for (const definition of arrDefinitions) {
    const targetName = normalizeName(definition.name);
    const schema = schemas.find((candidate) => (
      normalizeName(candidate.implementation) === targetName
      || normalizeName(candidate.implementationName) === targetName
    ));
    if (!schema) {
      throw new Error(`Prowlarr has no ${definition.name} application schema`);
    }

    const existing = applications.find((candidate) => (
      normalizeName(candidate.implementation) === targetName
      || normalizeName(candidate.implementationName) === targetName
    ));
    const payload = applicationPayload(
      existing ?? schema,
      schema,
      definition,
      session,
    );

    await request(
      `${apiRoot}/applications/test`,
      {
        method: "POST",
        headers,
        body: jsonBody(payload),
      },
      {
        expectedStatuses: [200],
        label: `Prowlarr ${definition.name} application test`,
      },
    );

    const endpoint = existing
      ? `${apiRoot}/applications/${existing.id}`
      : `${apiRoot}/applications`;
    const method = existing ? "PUT" : "POST";
    await request(
      endpoint,
      {
        method,
        headers,
        body: jsonBody(payload),
      },
      {
        expectedStatuses: [200, 201, 202],
        label: `Prowlarr ${definition.name} application save`,
      },
    );

    applications = requireArray(
      await requestJson(
        `${apiRoot}/applications`,
        { headers },
        { label: "Prowlarr application list" },
      ),
      "Prowlarr application list",
    );
    const saved = applications.find((candidate) => (
      normalizeName(candidate.implementation) === targetName
      || normalizeName(candidate.implementationName) === targetName
    ));
    if (!saved?.id) {
      throw new Error(`Prowlarr did not retain the ${definition.name} application`);
    }

    await request(
      `${apiRoot}/applications/test`,
      {
        method: "POST",
        headers,
        body: jsonBody(saved),
      },
      {
        expectedStatuses: [200],
        label: `Prowlarr saved ${definition.name} application test`,
      },
    );
  }
}

const PUBLIC_INDEXER_PREFERENCES = [
  "internetarchive",
  "eztv",
  "yts",
  "nyaasi",
  "limetorrents",
];

function publicIndexerRank(resource) {
  const names = [
    normalizeName(resource.definitionName),
    normalizeName(resource.name),
  ];
  for (let rank = 0; rank < PUBLIC_INDEXER_PREFERENCES.length; rank += 1) {
    const preference = PUBLIC_INDEXER_PREFERENCES[rank];
    if (names.some((name) => name === preference || name.includes(preference))) {
      return rank;
    }
  }
  return -1;
}

function isPublicTorrentIndexer(resource) {
  const privacy = String(resource.privacy ?? "public").toLowerCase();
  const protocol = String(resource.protocol ?? "torrent").toLowerCase();
  return privacy === "public" && protocol === "torrent";
}

function supportsMoviesAndTv(resource) {
  const categories = resource.capabilities?.categories ?? [];
  const categoryIds = new Set();
  for (const category of categories) {
    categoryIds.add(Number(category.id));
    for (const subCategory of category.subCategories ?? []) {
      categoryIds.add(Number(subCategory.id));
    }
  }
  return categoryIds.has(2000) && categoryIds.has(5000);
}

function indexerPayload(schema, appProfileId) {
  return {
    appProfileId,
    enable: true,
    name: schema.definitionName ?? schema.name,
    priority: Number(schema.priority ?? 25),
    protocol: schema.protocol ?? "torrent",
    fields: writableFields(schema),
    implementationName: schema.implementationName,
    implementation: schema.implementation,
    configContract: schema.configContract,
    tags: [],
  };
}

async function testSavedIndexer(apiRoot, headers, indexer) {
  if (!indexer.id) {
    return false;
  }
  return testPublicIndexerPayload(apiRoot, headers, indexer);
}

async function testPublicIndexerPayload(apiRoot, headers, payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await tryRequest(
      `${apiRoot}/indexer/test`,
      {
        method: "POST",
        headers,
        body: jsonBody(payload),
      },
      [200],
    );
    if (result.ok) {
      return true;
    }
    if (attempt < 2) {
      await sleep(1_000);
    }
  }
  return false;
}

async function configurePublicIndexer(session) {
  const baseUrl = loopback(session.manifest.PROWLARR_PORT);
  const apiRoot = `${baseUrl}/api/v1`;
  const headers = arrHeaders(session.secrets.PROWLARR_API_KEY);
  const allExisting = requireArray(
    await requestJson(
      `${apiRoot}/indexer`,
      { headers },
      { label: "Prowlarr indexer list" },
    ),
    "Prowlarr indexer list",
  );
  const existing = allExisting.filter((indexer) => (
    indexer.enable === true
    && isPublicTorrentIndexer(indexer)
    && supportsMoviesAndTv(indexer)
    && publicIndexerRank(indexer) >= 0
  ));
  existing.sort((left, right) => publicIndexerRank(left) - publicIndexerRank(right));

  for (const indexer of existing) {
    if (await testSavedIndexer(apiRoot, headers, indexer)) {
      return indexer;
    }
  }

  const profiles = requireArray(
    await requestJson(
      `${apiRoot}/appprofile`,
      { headers },
      { label: "Prowlarr app-profile list" },
    ),
    "Prowlarr app-profile list",
  );
  if (!profiles[0]?.id) {
    throw new Error("Prowlarr has no application profile");
  }

  const schemas = requireArray(
    await requestJson(
      `${apiRoot}/indexer/schema`,
      { headers },
      { label: "Prowlarr indexer schemas" },
    ),
    "Prowlarr indexer schemas",
  ).filter((schema) => (
    isPublicTorrentIndexer(schema)
    && supportsMoviesAndTv(schema)
    && publicIndexerRank(schema) >= 0
  ));
  schemas.sort((left, right) => publicIndexerRank(left) - publicIndexerRank(right));

  for (const schema of schemas) {
    const payload = indexerPayload(schema, profiles[0].id);
    const matching = allExisting.find((indexer) => (
      normalizeName(indexer.definitionName) === normalizeName(schema.definitionName)
    ));
    if (matching?.id) {
      payload.id = matching.id;
    }
    if (!await testPublicIndexerPayload(apiRoot, headers, payload)) {
      continue;
    }

    let endpoint = `${apiRoot}/indexer`;
    let method = "POST";
    if (matching?.id) {
      endpoint = `${apiRoot}/indexer/${matching.id}`;
      method = "PUT";
    }
    const saved = await requestJson(
      endpoint,
      {
        method,
        headers,
        body: jsonBody(payload),
      },
      {
        expectedStatuses: [200, 201, 202],
        label: "Prowlarr public indexer save",
      },
    );
    if (!await testSavedIndexer(apiRoot, headers, saved)) {
      throw new Error("saved Prowlarr public indexer failed its test");
    }
    return saved;
  }

  throw new Error("no supported public indexer passed its live test");
}

function arrIndexerIsEnabled(indexer) {
  return indexer.enableRss === true
    && indexer.enableAutomaticSearch === true
    && indexer.enableInteractiveSearch === true;
}

async function hasProwlarrIndexer(session, definition) {
  const baseUrl = loopback(session.manifest[definition.portKey]);
  const indexers = requireArray(
    await requestJson(
      `${baseUrl}/api/v3/indexer`,
      { headers: arrHeaders(session.secrets[definition.apiKey]) },
      { label: `${definition.name} indexer list` },
    ),
    `${definition.name} indexer list`,
  );

  return indexers.some((indexer) => (
    arrIndexerIsEnabled(indexer)
    && String(fieldValue(indexer, "baseUrl") ?? "")
      .startsWith("http://prowlarr:9696")
  ));
}

async function syncAndWait(session, arrDefinitions) {
  const apiRoot = `${loopback(session.manifest.PROWLARR_PORT)}/api/v1`;
  await request(
    `${apiRoot}/command`,
    {
      method: "POST",
      headers: arrHeaders(session.secrets.PROWLARR_API_KEY),
      body: jsonBody({ name: "ApplicationIndexerSync" }),
    },
    {
      expectedStatuses: [200, 201, 202, 204],
      label: "Prowlarr application sync",
    },
  );

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const results = await Promise.all(
      arrDefinitions.map((definition) => hasProwlarrIndexer(session, definition)),
    );
    if (results.every(Boolean)) {
      return;
    }
    await sleep(1_000);
  }

  throw new Error("Prowlarr indexer sync did not reach both Arr services");
}

async function main() {
  validateRunId(runId);
  let session = loadSession(runId);
  const sessionPassword = deriveSessionPassword(session);
  await waitForCoreServices(session);
  refreshArrKeys(runId);
  session = loadSession(runId);
  console.log("PASS Arr API keys refreshed");

  await configureQbit(session, sessionPassword);
  console.log("PASS qBittorrent login and categories configured");

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

  for (const definition of arrDefinitions) {
    await configureArr(session, definition, sessionPassword);
    console.log(`PASS ${definition.name} auth, root folder, and qBittorrent link configured`);
  }

  await configureProwlarrAuth(session, sessionPassword);
  console.log("PASS Prowlarr forms authentication configured");

  await configureProwlarrApplications(session, arrDefinitions);
  console.log("PASS Prowlarr Sonarr and Radarr application tests");

  await configurePublicIndexer(session);
  console.log("PASS Prowlarr public indexer live test");

  await syncAndWait(session, arrDefinitions);
  console.log("PASS Prowlarr indexer synced to Sonarr and Radarr");

  printSessionConnectionsSummary(writeSessionConnections(runId));
}

main().catch((error) => {
  console.error(`FAIL core bootstrap: ${error.message}`);
  process.exitCode = 1;
});
