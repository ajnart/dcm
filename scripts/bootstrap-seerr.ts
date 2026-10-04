#!/usr/bin/env bun
import { pathToFileURL } from "node:url";
import {
  arrHeaders,
  deriveSessionPassword,
  loadSession,
  request,
  requestJson,
  sessionAccess,
  sessionUsername,
  SetupRequestError,
} from "./lib/session-context.ts";

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Seerr ${label} response is invalid`);
  return value;
}

function selectOne(items, predicate, label) {
  const matches = requireArray(items, label).filter(predicate);
  if (matches.length !== 1) throw new Error(`Seerr ${label} selection is ambiguous`);
  return matches[0];
}

function compatible(existing, expected) {
  return existing.hostname === expected.hostname
    && Number(existing.port) === expected.port
    && existing.useSsl === false
    && existing.is4k === false
    && existing.apiKey === expected.apiKey;
}

function sessionCookie(response) {
  const header = response.headers.get("set-cookie") ?? "";
  const cookie = header.split(";", 1)[0];
  if (!/^[^=;,\s]+=[^;,\r\n]+$/.test(cookie)) throw new Error("Seerr authenticated session was not established");
  return cookie;
}

function userUrl(access, service) {
  return access.services[service].reachableUrl ?? access.services[service].browserUrl;
}

export async function configureSeerr(session, io = { request, requestJson }, access = sessionAccess(session)) {
  const base = `http://127.0.0.1:${session.manifest.SEERR_PORT}/api/v1`;
  let headers = arrHeaders(session.secrets.SEERR_API_KEY);
  const json = (path, options = {}, requestOptions = {}) => io.requestJson(
    `${base}${path}`,
    { ...options, headers: { ...headers, ...options.headers } },
    { label: `Seerr API setup ${path.split("?")[0]}`, ...requestOptions },
  );
  const publicSettings = await io.requestJson(`${base}/settings/public`, {}, { label: "Seerr API setup /settings/public", attempts: 40 });
  if (typeof publicSettings?.initialized !== "boolean") throw new Error("Seerr startup state unavailable");

  if (!publicSettings.initialized) {
    let existingJellyfin;
    try {
      existingJellyfin = await json("/settings/jellyfin");
    } catch (error) {
      if (!(error instanceof SetupRequestError)
        || error.code !== "UNEXPECTED_STATUS" || error.status !== 403) throw error;
    }
    if (existingJellyfin !== undefined && typeof existingJellyfin?.ip !== "string") {
      throw new Error("Seerr Jellyfin startup configuration is unavailable");
    }
    if (existingJellyfin?.ip && existingJellyfin.ip !== ""
      && (existingJellyfin.ip !== "jellyfin" || Number(existingJellyfin.port) !== 8096
        || existingJellyfin.useSsl === true)) {
      throw new Error("Seerr Jellyfin configuration conflicts with managed setup");
    }
    const login: Record<string, string | number | boolean> = {
      username: sessionUsername(session),
      password: deriveSessionPassword(session),
      email: "admin@example.test",
      serverType: 2,
    };
    const authUrl = `${base}/auth/jellyfin`;
    let response = await io.request(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(login),
    }, { label: "Seerr API setup /auth/jellyfin", expectedStatuses: [200, 500] });
    if (response.status === 500) {
      let errorMessage;
      try {
        errorMessage = (await response.json())?.error;
      } catch {
        throw new Error("Seerr Jellyfin login returned an unknown error; inspect before retrying");
      }
      if (errorMessage !== "No hostname provided." || existingJellyfin?.ip) {
        throw new Error("Seerr Jellyfin login failed; inspect before retrying");
      }
      response = await io.request(authUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...login, hostname: "jellyfin", port: 8096, useSsl: false, urlBase: "" }),
      }, { label: "Seerr API setup /auth/jellyfin" });
    }
    const cookie = sessionCookie(response);
    if (io.cookieJar !== true) {
      headers = { ...headers, Cookie: cookie };
    }
  }

  const jellyfin = await json("/settings/jellyfin");
  if (!jellyfin?.ip) {
    throw new Error("Seerr Jellyfin configuration is incomplete");
  }
  if (jellyfin.ip !== "jellyfin" || Number(jellyfin.port) !== 8096 || jellyfin.useSsl === true) {
    throw new Error("Seerr Jellyfin configuration conflicts with managed setup");
  }
  const managedLibraries = ["movies", "shows"];
  const configuredLibraries = requireArray(jellyfin.libraries ?? [], "Jellyfin library");
  if (configuredLibraries.some((item) => item?.enabled === true && !managedLibraries.includes(String(item?.name).toLowerCase()))) {
    throw new Error("Seerr enabled library configuration conflicts with managed setup");
  }
  await json("/settings/jellyfin", {
    method: "POST",
    body: JSON.stringify({ externalHostname: userUrl(access, "jellyfin") }),
  });

  const synced = requireArray(await json("/settings/jellyfin/library/sync", {
    method: "POST",
  }), "synced Jellyfin libraries");
  const enabledIds = new Set();
  for (const name of managedLibraries) {
    const library = selectOne(synced, (item) => String(item?.name).toLowerCase() === name, `${name} library`);
    if (typeof library.id !== "string" || library.id.length === 0 || library.id.length > 128) {
      throw new Error(`Seerr ${name} library ID is invalid`);
    }
    if (enabledIds.has(library.id)) throw new Error("Seerr managed Jellyfin library IDs are ambiguous");
    enabledIds.add(library.id);
  }
  const unexpectedEnabled = synced.filter((item) => item?.enabled === true && !managedLibraries.includes(String(item?.name).toLowerCase()));
  if (unexpectedEnabled.length) throw new Error("Seerr enabled library configuration conflicts with managed setup");
  for (const library of synced) {
    if (!enabledIds.has(library.id) || library.enabled === true) continue;
    await json(`/settings/jellyfin/library/${encodeURIComponent(library.id)}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
  }
  const verifiedLibraries = requireArray(await json("/settings/jellyfin/library"), "Jellyfin library readback");
  for (const name of managedLibraries) {
    const library = selectOne(verifiedLibraries, (item) => String(item?.name).toLowerCase() === name, `${name} library readback`);
    if (!enabledIds.has(library.id) || library.enabled !== true) {
      throw new Error(`Seerr ${name} library was not enabled after readback`);
    }
  }
  if (verifiedLibraries.some((item) => item?.enabled === true && !enabledIds.has(item?.id))) {
    throw new Error("Seerr enabled library configuration conflicts with managed setup");
  }

  const definitions = [
    { kind: "radarr", name: "Radarr", hostname: "radarr", port: 7878, apiKey: session.secrets.RADARR_API_KEY, root: "/data/media/movies", externalUrl: userUrl(access, "radarr") },
    { kind: "sonarr", name: "Sonarr", hostname: "sonarr", port: 8989, apiKey: session.secrets.SONARR_API_KEY, root: "/data/media/tv", externalUrl: userUrl(access, "sonarr") },
  ];
  for (const definition of definitions) {
    const existing = requireArray(await json(`/settings/${definition.kind}`), `${definition.kind} settings`);
    if (existing.length > 1 || (existing.length === 1 && !compatible(existing[0], definition))) {
      throw new Error(`Seerr ${definition.name} configuration conflicts with managed setup`);
    }
    const details = await json(`/settings/${definition.kind}/test`, {
      method: "POST",
      body: JSON.stringify({ hostname: definition.hostname, port: definition.port, apiKey: definition.apiKey, useSsl: false, baseUrl: "" }),
    });
    const profile = selectOne(details?.profiles, (item) => String(item?.name).toLowerCase() === "any" && Number.isInteger(Number(item?.id)) && Number(item.id) > 0, `${definition.kind} Any profile`);
    selectOne(details?.rootFolders, (item) => item?.path === definition.root, `${definition.kind} root folder`);
    const payload = {
      name: definition.name,
      hostname: definition.hostname,
      port: definition.port,
      apiKey: definition.apiKey,
      useSsl: false,
      baseUrl: details?.urlBase ?? "",
      activeProfileId: Number(profile.id),
      activeProfileName: profile.name,
      activeDirectory: definition.root,
      tags: [],
      is4k: false,
      isDefault: true,
      externalUrl: definition.externalUrl,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
    };
    if (definition.kind === "radarr") Object.assign(payload, { minimumAvailability: "released" });
    if (definition.kind === "sonarr") Object.assign(payload, {
      seriesType: "standard",
      animeSeriesType: "anime",
      activeAnimeProfileId: Number(profile.id),
      activeAnimeProfileName: profile.name,
      activeAnimeDirectory: definition.root,
      animeTags: [],
      enableSeasonFolders: true,
      monitorNewItems: "all",
    });
    let path = `/settings/${definition.kind}`;
    let expectedStatuses = [201];
    if (existing.length === 1) {
      path += `/${encodeURIComponent(String(existing[0].id))}`;
      expectedStatuses = [200];
    }
    await json(path, { method: existing.length ? "PUT" : "POST", body: JSON.stringify(payload) }, { expectedStatuses });
    const saved = requireArray(await json(`/settings/${definition.kind}`), `${definition.kind} settings readback`);
    if (saved.length !== 1 || !compatible(saved[0], definition)
      || Number(saved[0].activeProfileId) !== Number(profile.id)
      || saved[0].activeDirectory !== definition.root
      || saved[0].isDefault !== true || saved[0].preventSearch !== false) {
      throw new Error(`Seerr ${definition.name} settings did not pass API readback`);
    }
  }
  if (!publicSettings.initialized) await json("/settings/initialize", { method: "POST" });
  const finalPublic = await io.requestJson(`${base}/settings/public`, {}, { label: "Seerr API setup /settings/public readback" });
  if (finalPublic?.initialized !== true) throw new Error("Seerr did not confirm initialized settings");
  return { status: "pass", libraries: ["Movies", "Shows"], services: ["Radarr", "Sonarr"] };
}

if (Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  try {
    if (Bun.argv.length !== 3) throw new Error("usage");
    await configureSeerr(loadSession(Bun.argv[2]));
    console.log("PASS Seerr Jellyfin, Movies/Shows, Radarr and Sonarr configuration");
  } catch (error) {
    let summary = "Seerr API setup; no credential values emitted";
    if (error instanceof Error && /^Seerr [A-Za-z0-9 /;-]+$/.test(error.message)) summary = error.message;
    console.error(`FAIL ${summary}`);
    process.exitCode = 1;
  }
}
