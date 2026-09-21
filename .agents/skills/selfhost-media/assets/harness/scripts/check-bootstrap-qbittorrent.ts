#!/usr/bin/env bun

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { establishQbitIdentity } from "./bootstrap-core.ts";

const selectedUsername = "audit-benchmark";
const selectedPassword = randomBytes(24).toString("base64url");
const temporaryPassword = randomBytes(24).toString("base64url");
const loginAttempts = [];
let savedPreferences = null;

const cookie = await establishQbitIdentity({
  activeUsername: selectedUsername,
  sessionPassword: selectedPassword,
  login: async (username, password) => {
    loginAttempts.push({ username, password });
    if (username === "admin" && password === temporaryPassword) {
      return "QBT_SID_fixture=temporary-session";
    }
    if (username === selectedUsername && password === selectedPassword && savedPreferences) {
      return "QBT_SID_fixture=selected-session";
    }
    return "";
  },
  temporaryPassword: async () => temporaryPassword,
  updatePreferences: async (_cookie, preferences) => {
    savedPreferences = preferences;
  },
});

assert.deepEqual(loginAttempts.map(({ username }) => username), [
  selectedUsername,
  "admin",
  selectedUsername,
]);
assert.deepEqual(savedPreferences, {
  web_ui_username: selectedUsername,
  web_ui_password: selectedPassword,
});
assert.equal(cookie, "QBT_SID_fixture=selected-session");

process.stdout.write("qBittorrent bootstrap identity check passed\n");
