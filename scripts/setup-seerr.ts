#!/usr/bin/env bun
import { configureSeerr } from "./bootstrap-seerr.ts";
import { request, requestJson } from "./lib/session-context.ts";
import { runManagedSetup } from "./lib/setup-handoff.ts";

if (Bun.argv.length !== 3) {
  console.error("usage: setup-seerr.ts RUN_ID");
  process.exitCode = 2;
} else {
  await runManagedSetup(Bun.argv[2], "seerr", "Seerr Jellyfin and Arr links", async (session) => {
    await configureSeerr(session, { request, requestJson, cookieJar: true });
    return "Seerr Jellyfin, Movies/Shows, Radarr and Sonarr configuration";
  });
}
