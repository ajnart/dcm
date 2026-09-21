#!/usr/bin/env bun
import { pathToFileURL } from "node:url";
import { deriveSessionPassword, loadSession, request, requestJson, sessionUsername } from "./lib/session-context.ts";

const libraries = [
  { name: "Movies", type: "movies", path: "/data/media/movies" },
  { name: "Shows", type: "tvshows", path: "/data/media/tv" },
];

export async function configureJellyfin(session, io = { request, requestJson }) {
  const base = `http://127.0.0.1:${session.manifest.JELLYFIN_PORT}`;
  const username = sessionUsername(session);
  const password = deriveSessionPassword(session);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `MediaBrowser Client="Selfhost", Device="Setup", DeviceId="selfhost-${session.runId}", Version="1.0"`,
  };
  const info = await io.requestJson(`${base}/System/Info/Public`, {}, { label: "Jellyfin public readiness", attempts: 40 });
  if (typeof info?.StartupWizardCompleted !== "boolean") throw new Error("Jellyfin startup state unavailable");
  const post = async (path, body, authenticatedHeaders = headers) => {
    const options = { method: "POST", headers: authenticatedHeaders };
    if (body !== undefined) options.body = JSON.stringify(body);
    await io.request(`${base}${path}`, options, { label: `Jellyfin configuration ${path.split("?")[0]}`, expectedStatuses: [200, 204] });
  };
  if (!info.StartupWizardCompleted) {
    await post("/Startup/Configuration", { ServerName: "My Media", UICulture: "en-US", MetadataCountryCode: "US", PreferredMetadataLanguage: "en" });
    // Jellyfin 10.11 initializes its first user in GET before POST can update it.
    await io.requestJson(`${base}/Startup/User`, { headers }, { label: "Jellyfin first user initialization" });
    await post("/Startup/User", { Name: username, Password: password });
    await post("/Startup/RemoteAccess", { EnableRemoteAccess: true });
    await post("/Startup/Complete");
  }
  const login = await io.requestJson(`${base}/Users/AuthenticateByName`, {
    method: "POST", headers, body: JSON.stringify({ Username: username, Pw: password }),
  }, { label: "Jellyfin selected account login" });
  if (typeof login?.AccessToken !== "string" || !login.AccessToken || login.User?.Name !== username || login.User?.Policy?.IsAdministrator !== true) {
    throw new Error("Jellyfin selected administrator verification failed");
  }
  const auth = { ...headers, "X-Emby-Token": login.AccessToken };
  try {
    const existing = await io.requestJson(`${base}/Library/VirtualFolders`, { headers: auth }, { label: "Jellyfin libraries" });
    if (!Array.isArray(existing)) throw new Error("Jellyfin libraries unavailable");
    for (const library of libraries) {
      const matches = existing.filter((item) => item.Name === library.name);
      if (matches.length > 1 || (matches.length === 1 && (matches[0].CollectionType !== library.type || !matches[0].Locations?.includes(library.path)))) {
        throw new Error("Jellyfin existing library conflicts with managed configuration");
      }
      if (!matches.length) {
        const query = new URLSearchParams({ name: library.name, collectionType: library.type, paths: library.path, refreshLibrary: "false" });
        await post(`/Library/VirtualFolders?${query}`, { LibraryOptions: { EnableRealtimeMonitor: true } }, auth);
      }
    }
    const verified = await io.requestJson(`${base}/Library/VirtualFolders`, { headers: auth }, { label: "Jellyfin library verification" });
    if (!Array.isArray(verified) || !libraries.every((library) => verified.some((item) => item.Name === library.name && item.CollectionType === library.type && item.Locations?.includes(library.path)))) {
      throw new Error("Jellyfin library verification failed");
    }
    return { status: "pass", administrator: true, libraries: ["Movies", "Shows"] };
  } finally {
    await io.request(`${base}/Sessions/Logout`, { method: "POST", headers: auth }, { label: "Jellyfin setup token logout", expectedStatuses: [200, 204] });
  }
}

if (Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  try {
    if (Bun.argv.length !== 3) throw new Error("usage");
    await configureJellyfin(loadSession(Bun.argv[2]));
    console.log("PASS Jellyfin selected administrator and Movies/Shows libraries; temporary API session logged out");
  } catch (error) {
    let summary = "Jellyfin API setup; no credential values emitted";
    if (error instanceof Error && /^Jellyfin [A-Za-z0-9 /;-]+$/.test(error.message)) summary = error.message;
    console.error(`FAIL ${summary}`);
    process.exitCode = 1;
  }
}
