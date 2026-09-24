#!/usr/bin/env bun
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { configureJellyfin } from "./bootstrap-jellyfin.ts";
import { deriveSessionPassword } from "./lib/session-context.ts";

const session = { runId: "fixture-jellyfin", manifest: { JELLYFIN_PORT: "23456", ADMIN_USERNAME: "chosen-user", SESSION_PASSWORD_SCHEME: "hmac-v1" }, secrets: { HOMARR_ENCRYPTION_KEY: randomBytes(32).toString("hex") } };
for (const completed of [false, true]) {
  const calls = [];
  const folders = [];
  let firstUserInitialized = completed;
  const io = {
    requestJson: async (url, options) => {
      if (url.endsWith("/Startup/User")) { firstUserInitialized = true; return { Name: "initial-user" }; }
      if (url.endsWith("/System/Info/Public")) return { StartupWizardCompleted: completed };
      if (url.endsWith("/Users/AuthenticateByName")) {
        assert.deepEqual(JSON.parse(options.body), { Username: "chosen-user", Pw: deriveSessionPassword(session) });
        return { AccessToken: randomBytes(20).toString("hex"), User: { Name: "chosen-user", Policy: { IsAdministrator: true } } };
      }
      if (url.endsWith("/Library/VirtualFolders")) return structuredClone(folders);
      throw new Error("Unexpected fixture request");
    },
    request: async (url, options) => {
      const parsed = new URL(url); calls.push(parsed.pathname);
      if (parsed.pathname === "/Startup/User") {
        assert.equal(firstUserInitialized, true);
        assert.equal(JSON.parse(options.body).Name, "chosen-user");
      }
      if (parsed.pathname === "/Library/VirtualFolders") folders.push({ Name: parsed.searchParams.get("name"), CollectionType: parsed.searchParams.get("collectionType"), Locations: [parsed.searchParams.get("paths")] });
    },
  };
  assert.equal((await configureJellyfin(session, io)).status, "pass");
  assert.equal(calls.filter((path) => path.startsWith("/Startup/")).length, completed ? 0 : 4);
  assert.equal(calls.at(-1), "/Sessions/Logout");
  assert.equal(folders.length, 2);
  calls.length = 0;
  await configureJellyfin(session, { ...io, requestJson: async (url, options) => {
    if (url.endsWith("/System/Info/Public")) return { StartupWizardCompleted: true };
    return io.requestJson(url, options);
  } });
  assert.deepEqual(calls, ["/Sessions/Logout"]);
  folders[0].Locations = ["/unowned/path"];
  await assert.rejects(configureJellyfin(session, io), /existing library conflicts/);
  assert.equal(calls.at(-1), "/Sessions/Logout");
}
console.log("PASS Jellyfin initial setup, selected credentials, idempotent libraries, conflict rejection and token logout");
