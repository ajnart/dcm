#!/usr/bin/env bun

import assert from "node:assert/strict";

import { browserFormRefs, formRefsFromSnapshot } from "./browser-form.ts";
import { SESSION_PASSWORD_SCHEME } from "./lib/session-context.ts";

const secret = "synthetic-secret-that-must-not-escape";
const snapshot = JSON.stringify({
  success: true,
  data: {
    refs: {
      e12: { role: "textbox", name: "API Key", value: secret, placeholder: secret },
      e2: { role: "textbox", name: "Username", value: secret },
      e3: { role: "button", name: "Save", unsupported: secret },
      bad: { role: "textbox", name: secret },
    },
    snapshot: `- textbox "API Key" [ref=e12]: ${secret}`,
  },
});
const safe = formRefsFromSnapshot(snapshot);
assert.deepEqual(safe, {
  schemaVersion: 1,
  refs: [
    { ref: "@e2", role: "textbox", name: "Username" },
    { ref: "@e3", role: "button", name: "Save" },
    { ref: "@e12", role: "textbox", name: "API Key" },
  ],
});
assert.equal(JSON.stringify(safe).includes(secret), false);
assert.throws(() => formRefsFromSnapshot("not-json"), /snapshot is invalid/);
assert.throws(() => formRefsFromSnapshot(JSON.stringify({ success: false })), /snapshot is invalid/);

const session = {
  runId: "form-fixture",
  manifest: {
    AGENT_BROWSER_SESSION: "auto-stack-form-fixture",
    HOMARR_PORT: "21006",
    JELLYFIN_PORT: "21004",
    PROWLARR_PORT: "21000",
    QBITTORRENT_PORT: "21003",
    RADARR_PORT: "21001",
    SEERR_PORT: "21005",
    SESSION_PASSWORD_SCHEME,
    SONARR_PORT: "21002",
  },
};
const calls = [];
const result = await browserFormRefs(session, {
  invokeBrowserImplementation: async (args) => {
    calls.push(args);
    if (args.includes("url")) {
      return "http://127.0.0.1:21006/setup";
    }
    return snapshot;
  },
});
assert.deepEqual(result, safe);
assert.deepEqual(calls, [
  ["--session", "auto-stack-form-fixture", "get", "url"],
  ["--session", "auto-stack-form-fixture", "snapshot", "-i", "--json"],
]);
process.stdout.write("PASS safe browser form refs\n");
