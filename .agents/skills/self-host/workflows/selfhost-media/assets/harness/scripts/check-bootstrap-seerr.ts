#!/usr/bin/env bun
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { configureSeerr } from "./bootstrap-seerr.ts";
import { deriveSessionPassword, SetupRequestError } from "./lib/session-context.ts";

const radarrKey = randomBytes(24).toString("hex");
const sonarrKey = randomBytes(24).toString("hex");
const session = {
  runId: "fixture-seerr",
  manifest: { SEERR_PORT: "25055", JELLYFIN_PORT: "28096", RADARR_PORT: "27878", SONARR_PORT: "28989", ADMIN_USERNAME: "chosen-user", SESSION_PASSWORD_SCHEME: "hmac-v1" },
  secrets: { SEERR_API_KEY: randomBytes(24).toString("hex"), RADARR_API_KEY: radarrKey, SONARR_API_KEY: sonarrKey, HOMARR_ENCRYPTION_KEY: randomBytes(32).toString("hex") },
};
const localAccess = { services: {
  jellyfin: { reachableUrl: null, browserUrl: "http://127.0.0.1:28096" },
  radarr: { reachableUrl: null, browserUrl: "http://127.0.0.1:27878" },
  sonarr: { reachableUrl: null, browserUrl: "http://127.0.0.1:28989" },
} };

function fixture({ initialized = false, existing = false, partiallyEnabled = false, conflict = false, jellyfinConflict = false,
  stalePreflight = false, unexpectedLoginError = false, readbackFails = false,
  arrReadbackFails = false, publicInitializationFails = false } = {}) {
  const calls = [];
  let jellyfinReady = existing;
  let authenticated = initialized;
  let publicInitialized = initialized;
  const servers = { radarr: [], sonarr: [] };
  if (existing) {
    servers.radarr.push({ id: 0, hostname: conflict ? "wrong" : "radarr", port: 7878, useSsl: false, is4k: false, apiKey: radarrKey });
    servers.sonarr.push({ id: 1, hostname: "sonarr", port: 8989, useSsl: false, is4k: false, apiKey: sonarrKey });
  }
  const libraries = [{ id: "m", name: "Movies", enabled: existing },
    { id: "s", name: "Shows", enabled: existing && !partiallyEnabled }];
  return {
    calls,
    io: {
      request: async (url, options = {}) => {
        const path = new URL(url).pathname.replace("/api/v1", "");
        calls.push({ path, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined });
        assert.equal(path, "/auth/jellyfin");
        const login = calls.at(-1).body;
        const expectedLogin = { username: "chosen-user", password: deriveSessionPassword(session), email: "admin@example.test", serverType: 2 };
        if (login.hostname !== undefined) Object.assign(expectedLogin, { hostname: "jellyfin", port: 8096, useSsl: false, urlBase: "" });
        assert.deepEqual(login, expectedLogin);
        if (unexpectedLoginError) {
          return { status: 500, json: async () => ({ error: "Unable to authenticate." }) };
        }
        if (!jellyfinReady && login.hostname === undefined) {
          return { status: 500, json: async () => ({ error: "No hostname provided." }) };
        }
        assert.equal(Boolean(login.hostname), !jellyfinReady);
        jellyfinReady = true;
        authenticated = true;
        return { status: 200, headers: { get: (name) => name === "set-cookie" ? "connect.sid=fixture-session; Path=/; HttpOnly" : null } };
      },
      requestJson: async (url, options = {}) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace("/api/v1", "");
      calls.push({ path, query: parsed.search, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined });
      if (path === "/settings/public") return { initialized: publicInitialized };
      if (path === "/settings/jellyfin" && (options.method ?? "GET") === "GET"
        && options.headers?.["X-Api-Key"] === session.secrets.SEERR_API_KEY) {
        if ((stalePreflight && !authenticated) || (!jellyfinReady && !authenticated)) {
          throw new SetupRequestError({
            label: "Seerr API setup /settings/jellyfin",
            url,
            method: "GET",
            status: 403,
            code: "UNEXPECTED_STATUS",
          });
        }
        return jellyfinReady ? { ip: jellyfinConflict ? "other-server" : "jellyfin", port: 8096, useSsl: false, libraries: structuredClone(libraries) } : { ip: "", libraries: [] };
      }
      if (!authenticated || (initialized === false && options.headers?.Cookie !== "connect.sid=fixture-session")) throw new Error("fixture protected route returned HTTP 403");
      if (path === "/settings/jellyfin") return {};
      if (path === "/settings/jellyfin/library/sync" && options.method === "POST") {
        return structuredClone(libraries);
      }
      if (path.startsWith("/settings/jellyfin/library/") && options.method === "PUT") {
        const id = path.slice("/settings/jellyfin/library/".length);
        assert.deepEqual(calls.at(-1).body, { enabled: true });
        const library = libraries.find((item) => item.id === id);
        assert.ok(library);
        if (!readbackFails) library.enabled = true;
        return structuredClone(library);
      }
      if (path === "/settings/jellyfin/library" && (options.method ?? "GET") === "GET") return structuredClone(libraries);
      for (const kind of ["radarr", "sonarr"]) {
        if (path === `/settings/${kind}` && (options.method ?? "GET") === "GET") return structuredClone(servers[kind]);
        if (path === `/settings/${kind}/test`) return { profiles: [{ id: kind === "radarr" ? 1 : 2, name: "Any" }], rootFolders: [{ id: 1, path: kind === "radarr" ? "/data/media/movies" : "/data/media/tv" }], tags: [], urlBase: "" };
        if (path === `/settings/${kind}` || path.startsWith(`/settings/${kind}/`)) {
          const body = calls.at(-1).body;
          servers[kind] = [{ ...body, id: kind === "radarr" ? 0 : 1,
            activeDirectory: arrReadbackFails ? "/wrong" : body.activeDirectory }];
          return body;
        }
      }
      if (path === "/settings/initialize") {
        if (!publicInitializationFails) publicInitialized = true;
        return { initialized: true };
      }
      throw new Error(`Unexpected fixture request ${path}`);
    } },
  };
}

const fresh = fixture();
assert.equal((await configureSeerr(session, fresh.io, localAccess)).status, "pass");
assert.equal(fresh.calls.filter((call) => call.path === "/auth/jellyfin").length, 2);
assert.equal(fresh.calls[0].path, "/settings/public");
assert.equal(fresh.calls[1].path, "/settings/jellyfin");
assert.equal(fresh.calls[2].path, "/auth/jellyfin");
assert.equal(fresh.calls[2].body.hostname, undefined);
assert.equal(fresh.calls[3].body.hostname, "jellyfin");
assert.equal(fresh.calls.filter((call) => call.path === "/settings/initialize").length, 1);
assert.equal(fresh.calls.at(-1).path, "/settings/public");
assert.equal(fresh.calls.filter((call) => call.path === "/settings/radarr" && call.method === "GET").length, 2);
assert.equal(fresh.calls.filter((call) => call.path === "/settings/sonarr" && call.method === "GET").length, 2);
assert.equal(fresh.calls.find((call) => call.path === "/settings/radarr" && call.method === "POST").body.activeProfileName, "Any");
assert.equal(fresh.calls.find((call) => call.path === "/settings/jellyfin" && call.method === "POST").body.externalHostname, "http://127.0.0.1:28096");
assert.equal(fresh.calls.find((call) => call.path === "/settings/radarr" && call.method === "POST").body.externalUrl, "http://127.0.0.1:27878");
assert.equal(fresh.calls.find((call) => call.path === "/settings/sonarr" && call.method === "POST").body.activeAnimeDirectory, "/data/media/tv");
assert.equal(fresh.calls.some((call) => call.path.includes("request")), false);
assert.deepEqual(
  fresh.calls.filter((call) => call.path.startsWith("/settings/jellyfin/library")).map((call) => [call.method, call.path]),
  [["POST", "/settings/jellyfin/library/sync"], ["PUT", "/settings/jellyfin/library/m"],
    ["PUT", "/settings/jellyfin/library/s"], ["GET", "/settings/jellyfin/library"]],
);

const resumed = fixture({ initialized: true, existing: true });
await configureSeerr(session, resumed.io, localAccess);
assert.equal(resumed.calls.some((call) => call.path === "/auth/jellyfin"), false);
assert.equal(resumed.calls.some((call) => call.path === "/settings/initialize"), false);
assert.equal(resumed.calls.filter((call) => call.method === "PUT" && /^\/settings\/(radarr|sonarr)\//.test(call.path)).length, 2);
assert.equal(resumed.calls.some((call) => call.method === "PUT" && call.path.startsWith("/settings/jellyfin/library/")), false);

const partial = fixture({ existing: true, partiallyEnabled: true });
await configureSeerr(session, partial.io, localAccess);
assert.equal(partial.calls.filter((call) => call.path === "/auth/jellyfin").length, 1);
assert.equal(partial.calls.find((call) => call.path === "/auth/jellyfin").body.hostname, undefined);
assert.deepEqual(partial.calls.filter((call) => call.method === "PUT" && call.path.startsWith("/settings/jellyfin/library/"))
  .map((call) => call.path), ["/settings/jellyfin/library/s"]);

const stale = fixture({ existing: true, stalePreflight: true });
await configureSeerr(session, stale.io, localAccess);
assert.equal(stale.calls.filter((call) => call.path === "/auth/jellyfin").length, 1);
assert.equal(stale.calls.find((call) => call.path === "/auth/jellyfin").body.hostname, undefined);

const unexpected = fixture({ unexpectedLoginError: true });
await assert.rejects(configureSeerr(session, unexpected.io, localAccess), /login failed; inspect before retrying/);
assert.equal(unexpected.calls.filter((call) => call.path === "/auth/jellyfin").length, 1);

await assert.rejects(configureSeerr(session, fixture({ existing: true, conflict: true }).io, localAccess), /Radarr configuration conflicts/);
const wrongJellyfin = fixture({ existing: true, jellyfinConflict: true });
await assert.rejects(configureSeerr(session, wrongJellyfin.io, localAccess), /Jellyfin configuration conflicts/);
assert.equal(wrongJellyfin.calls.some((call) => call.path === "/auth/jellyfin"), false);
const incomplete = fixture({ readbackFails: true });
await assert.rejects(configureSeerr(session, incomplete.io, localAccess), /library was not enabled after readback/);
assert.equal(incomplete.calls.some((call) => call.path === "/settings/initialize"), false);
const wrongArrReadback = fixture({ arrReadbackFails: true });
await assert.rejects(configureSeerr(session, wrongArrReadback.io, localAccess), /settings did not pass API readback/);
assert.equal(wrongArrReadback.calls.some((call) => call.path === "/settings/initialize"), false);
const wrongFinalState = fixture({ publicInitializationFails: true });
await assert.rejects(configureSeerr(session, wrongFinalState.io, localAccess), /did not confirm initialized settings/);
console.log("PASS Seerr fresh bootstrap, private credential use, API-derived defaults, safe resume and conflict rejection");
