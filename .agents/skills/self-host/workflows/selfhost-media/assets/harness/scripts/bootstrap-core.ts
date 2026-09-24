import {
  arrHeaders,
  composeLogs,
  deriveSessionPassword,
  fieldValue,
  LEGACY_STANDARD_USERNAME,
  loadSession,
  normalizeName,
  printSessionConnectionsSummary,
  refreshArrKeys,
  request,
  requestJson,
  setField,
  sleep,
  sessionUsername,
  tryRequest,
  useCurlTransport,
  validateRunId,
  writableFields,
  writeSessionConnections,
} from "./lib/session-context.ts";
import { pathToFileURL } from "node:url";

const runId = Bun.argv[2] ?? "";
const identitiesOnly = Bun.argv[3] === "--identities-only";
let activeUsername = "";

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

async function qbitLogin(baseUrl, username, password) {
  const response = await tryRequest(
    `${baseUrl}/api/v2/auth/login`,
    {
      method: "POST",
      headers: qbitHeaders(baseUrl),
      body: new URLSearchParams({
        username,
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

export async function establishQbitIdentity(options) {
  const {
    activeUsername: selectedUsername,
    sessionPassword,
    login,
    temporaryPassword,
    updatePreferences,
  } = options;
  let cookie = await login(selectedUsername, sessionPassword);
  if (cookie === "") {
    const firstStartPassword = await temporaryPassword();
    cookie = await login(LEGACY_STANDARD_USERNAME, firstStartPassword);
    if (cookie === "") {
      throw new Error("qBittorrent temporary login failed");
    }
  }

  await updatePreferences(cookie, {
    web_ui_username: selectedUsername,
    web_ui_password: sessionPassword,
  });
  cookie = await login(selectedUsername, sessionPassword);
  if (cookie === "") {
    throw new Error("qBittorrent standard login verification failed");
  }
  return cookie;
}

async function configureQbit(session, sessionPassword) {
  const baseUrl = loopback(session.manifest.QBITTORRENT_PORT);
  const cookie = await establishQbitIdentity({
    activeUsername,
    sessionPassword,
    login: (username, password) => qbitLogin(baseUrl, username, password),
    temporaryPassword: async () => {
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
      return temporaryPassword;
    },
    updatePreferences: async (authenticatedCookie, identityPreferences) => qbitPost(
      baseUrl,
      authenticatedCookie,
      "app/setPreferences",
      {
        json: jsonBody({
          save_path: "/data/torrents",
          temp_path: "/data/torrents/incomplete",
          temp_path_enabled: true,
          ...identityPreferences,
        }),
      },
      "qBittorrent preference update",
    ),
  });

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
  setField(fields, "username", activeUsername);
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

async function configureArr(session, definition, sessionPassword, options = {}) {
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
    username: activeUsername,
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

  if (options.identitiesOnly === true) {
    return;
  }

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
        username: activeUsername,
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

export async function setupCoreService(runId, service) {
  validateRunId(runId);
  let session = loadSession(runId);
  useCurlTransport(session);
  activeUsername = sessionUsername(session);
  const sessionPassword = deriveSessionPassword(session);

  if (service === "qbittorrent") {
    await request(`${loopback(session.manifest.QBITTORRENT_PORT)}/api/v2/app/version`, {}, {
      attempts: 40, expectedStatuses: [200, 401, 403], label: "qBittorrent readiness check",
    });
    await configureQbit(session, sessionPassword);
    return "qBittorrent authentication and categories";
  }

  if (service === "sonarr" || service === "radarr" || service === "prowlarr") {
    const portKey = `${service.toUpperCase()}_PORT`;
    await request(`${loopback(session.manifest[portKey])}/ping`, {}, {
      attempts: 40, expectedStatuses: [200], label: `${service} readiness check`,
    });
    refreshArrKeys(runId, [service]);
    session = loadSession(runId);
  }

  if (service === "sonarr" || service === "radarr") {
    const definition = arrDefinitions.find((item) => item.name.toLowerCase() === service);
    await configureArr(session, definition, sessionPassword, { identitiesOnly: false });
    return `${definition.name} authentication, root folder, and qBittorrent link`;
  }

  if (service === "prowlarr") {
    await configureProwlarrAuth(session, sessionPassword);
    await configureProwlarrApplications(session, arrDefinitions);
    writeSessionConnections(runId);
    return "Prowlarr authentication and Sonarr/Radarr Full Sync links; authorized indexer pending";
  }

  throw new Error("unsupported core service");
}

async function main() {
  if (Bun.argv.length > 4 || (Bun.argv[3] && !identitiesOnly)) {
    throw new Error("usage: bootstrap-core.ts RUN_ID [--identities-only]");
  }
  validateRunId(runId);
  let session = loadSession(runId);
  activeUsername = sessionUsername(session);
  const sessionPassword = deriveSessionPassword(session);
  await waitForCoreServices(session);
  refreshArrKeys(runId);
  session = loadSession(runId);
  console.log("PASS Arr API keys refreshed");

  await configureQbit(session, sessionPassword);
  console.log("PASS qBittorrent login and categories configured");

  for (const definition of arrDefinitions) {
    await configureArr(session, definition, sessionPassword, { identitiesOnly });
    if (identitiesOnly) {
      console.log(`PASS ${definition.name} forms authentication configured`);
    } else {
      console.log(`PASS ${definition.name} auth, root folder, and qBittorrent link configured`);
    }
  }

  await configureProwlarrAuth(session, sessionPassword);
  console.log("PASS Prowlarr forms authentication configured");

  if (identitiesOnly) {
    printSessionConnectionsSummary(writeSessionConnections(runId));
    console.log("PASS identities-only bootstrap complete; service links remain for browser setup");
    return;
  }

  await configureProwlarrApplications(session, arrDefinitions);
  console.log("PASS Prowlarr Sonarr and Radarr application tests");
  console.log("PENDING authorized indexer selection and downstream sync");

  printSessionConnectionsSummary(writeSessionConnections(runId));
}

if (Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`FAIL core bootstrap: ${error.message}`);
    process.exitCode = 1;
  });
}
