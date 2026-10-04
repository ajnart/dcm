#!/usr/bin/env bun
import { configureJellyfin } from "./bootstrap-jellyfin.ts";
import { runManagedSetup } from "./lib/setup-handoff.ts";

if (Bun.argv.length !== 3) {
  console.error("usage: setup-jellyfin.ts RUN_ID");
  process.exitCode = 2;
} else {
  await runManagedSetup(Bun.argv[2], "jellyfin", "Jellyfin administrator and libraries", async (session) => {
    await configureJellyfin(session);
    return "Jellyfin administrator and Movies/Shows libraries";
  });
}
