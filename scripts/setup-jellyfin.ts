#!/usr/bin/env bun
import { configureJellyfin } from "./bootstrap-jellyfin.ts";
import { loadSession, useCurlTransport } from "./lib/session-context.ts";

if (Bun.argv.length !== 3) {
  console.error("usage: setup-jellyfin.ts RUN_ID");
  process.exitCode = 2;
} else {
  try {
    const session = loadSession(Bun.argv[2]);
    useCurlTransport(session);
    await configureJellyfin(session);
    console.log("PASS Jellyfin administrator and Movies/Shows libraries");
  } catch {
    console.error("FAIL Jellyfin API setup; run session doctor RUN_ID for diagnostics");
    process.exitCode = 1;
  }
}
