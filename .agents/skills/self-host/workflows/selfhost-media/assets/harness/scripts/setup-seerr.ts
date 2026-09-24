#!/usr/bin/env bun
import { configureSeerr } from "./bootstrap-seerr.ts";
import { loadSession, request, requestJson, useCurlTransport } from "./lib/session-context.ts";

if (Bun.argv.length !== 3) {
  console.error("usage: setup-seerr.ts RUN_ID");
  process.exitCode = 2;
} else {
  try {
    const session = loadSession(Bun.argv[2]);
    useCurlTransport(session);
    await configureSeerr(session, { request, requestJson, cookieJar: true });
    console.log("PASS Seerr Jellyfin, Movies/Shows, Radarr and Sonarr configuration");
  } catch {
    console.error("FAIL Seerr API setup; run session doctor RUN_ID for diagnostics");
    process.exitCode = 1;
  }
}
