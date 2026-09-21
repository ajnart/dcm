#!/usr/bin/env bun
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { configureSeerr } from "./bootstrap-seerr.ts";
import { deriveSessionPassword } from "./lib/session-context.ts";

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

function fixture({ initialized = false, existing = false, conflict = false, authNeedsResume = false } = {}) {
  const calls = [];
  let jellyfinReady = existing;
  let authenticated = initialized;
  const servers = { radarr: [], sonarr: [] };
  if (existing) {
    servers.radarr.push({ id: 0, hostname: conflict ? "wrong" : "radarr", port: 7878, useSsl: false, is4k: false, apiKey: radarrKey });
    servers.sonarr.push({ id: 1, hostname: "sonarr", port: 8989, useSsl: false, is4k: false, apiKey: sonarrKey });
  }
  const libraries = [{ id: "m", name: "Movies", enabled: existing }, { id: "s", name: "Shows", enabled: existing }];
  return {
    calls,
    io: {
      request: async (url, options = {}) => {
        const path = new URL(url).pathname.replace("/api/v1", "");
        calls.push({ path, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined });
        assert.equal(path, "/auth/jellyfin");
        const login = calls.at(-1).body;
        if (authNeedsResume && calls.filter((call) => call.path === "/auth/jellyfin").length === 1) {
          assert.equal(login.hostname, "jellyfin");
          throw new Error("fixture hostname already configured");
        }
        const expectedLogin = { username: "chosen-user", password: deriveSessionPassword(session), email: "admin@example.test", serverType: 2 };
        if (!authNeedsResume) Object.assign(expectedLogin, { hostname: "jellyfin", port: 8096, useSsl: false, urlBase: "" });
        assert.deepEqual(login, expectedLogin);
        jellyfinReady = true;
        authenticated = true;
        return { headers: { get: (name) => name === "set-cookie" ? "connect.sid=fixture-session; Path=/; HttpOnly" : null } };
      },
      requestJson: async (url, options = {}) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace("/api/v1", "");
      calls.push({ path, query: parsed.search, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : undefined });
      if (path === "/settings/public") return { initialized };
      if (!authenticated || (initialized === false && options.headers?.Cookie !== "connect.sid=fixture-session")) throw new Error("fixture protected route returned HTTP 403");
      if (path === "/settings/jellyfin" && (options.method ?? "GET") === "GET") return jellyfinReady ? { ip: "jellyfin", port: 8096, useSsl: false, libraries: structuredClone(libraries) } : { ip: "", libraries: [] };
      if (path === "/settings/jellyfin") return {};
      if (path === "/settings/jellyfin/library" && parsed.searchParams.has("sync")) {
        libraries.forEach((item) => { item.enabled = false; });
        return structuredClone(libraries);
      }
      if (path === "/settings/jellyfin/library") {
        const enabled = (parsed.searchParams.get("enable") ?? "").split(",");
        libraries.forEach((item) => { item.enabled = enabled.includes(item.id); });
        return structuredClone(libraries);
      }
      for (const kind of ["radarr", "sonarr"]) {
        if (path === `/settings/${kind}` && (options.method ?? "GET") === "GET") return structuredClone(servers[kind]);
        if (path === `/settings/${kind}/test`) return { profiles: [{ id: kind === "radarr" ? 1 : 2, name: "Any" }], rootFolders: [{ id: 1, path: kind === "radarr" ? "/data/media/movies" : "/data/media/tv" }], tags: [], urlBase: "" };
        if (path === `/settings/${kind}` || path.startsWith(`/settings/${kind}/`)) { const body = calls.at(-1).body; servers[kind] = [{ ...body, id: kind === "radarr" ? 0 : 1 }]; return body; }
      }
      if (path === "/settings/initialize") return { initialized: true };
      throw new Error(`Unexpected fixture request ${path}`);
    } },
  };
}

const fresh = fixture();
assert.equal((await configureSeerr(session, fresh.io, localAccess)).status, "pass");
assert.equal(fresh.calls.filter((call) => call.path === "/auth/jellyfin").length, 1);
assert.equal(fresh.calls[0].path, "/settings/public");
assert.equal(fresh.calls[1].path, "/auth/jellyfin");
assert.equal(fresh.calls[2].path, "/settings/jellyfin");
assert.equal(fresh.calls.filter((call) => call.path === "/settings/initialize").length, 1);
assert.equal(fresh.calls.find((call) => call.path === "/settings/radarr" && call.method === "POST").body.activeProfileName, "Any");
assert.equal(fresh.calls.find((call) => call.path === "/settings/jellyfin" && call.method === "POST").body.externalHostname, "http://127.0.0.1:28096");
assert.equal(fresh.calls.find((call) => call.path === "/settings/radarr" && call.method === "POST").body.externalUrl, "http://127.0.0.1:27878");
assert.equal(fresh.calls.find((call) => call.path === "/settings/sonarr" && call.method === "POST").body.activeAnimeDirectory, "/data/media/tv");
assert.equal(fresh.calls.some((call) => call.path.includes("request")), false);
assert.deepEqual(
  fresh.calls.filter((call) => call.path === "/settings/jellyfin/library").map((call) => [call.method, call.query]),
  [["GET", "?sync=true"], ["GET", "?enable=m%2Cs"]],
);

const resumed = fixture({ initialized: true, existing: true });
await configureSeerr(session, resumed.io, localAccess);
assert.equal(resumed.calls.some((call) => call.path === "/auth/jellyfin"), false);
assert.equal(resumed.calls.some((call) => call.path === "/settings/initialize"), false);
assert.equal(resumed.calls.filter((call) => call.method === "PUT" && /^\/settings\/(radarr|sonarr)\//.test(call.path)).length, 2);

const partial = fixture({ existing: true, authNeedsResume: true });
await configureSeerr(session, partial.io, localAccess);
assert.equal(partial.calls.filter((call) => call.path === "/auth/jellyfin").length, 2);

await assert.rejects(configureSeerr(session, fixture({ existing: true, conflict: true }).io, localAccess), /Radarr configuration conflicts/);
console.log("PASS Seerr fresh bootstrap, private credential use, API-derived defaults, safe resume and conflict rejection");
