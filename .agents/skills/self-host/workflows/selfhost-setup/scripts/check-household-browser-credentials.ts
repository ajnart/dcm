#!/usr/bin/env bun

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audiobookshelfApiKeyEvalScript, captureHouseholdBrowserApiKey, fillHouseholdBrowserCredentials, validateApprovedHouseholdOrigin } from "./household-browser-credentials.ts";
import { createHouseholdCredentials, householdCredentialStatus, loadHouseholdHandoff, storeHouseholdApiKey } from "./household-credentials.ts";

const root = mkdtempSync(join(tmpdir(), "household-browser-"));
const projectRoot = join(root, "project");
const state = join(projectRoot, ".selfhost");
mkdirSync(state, { recursive: true, mode: 0o700 });
chmodSync(state, 0o700);
writeFileSync(join(state, ".gitignore"), "*\n", { mode: 0o600 });
const runId = "browser-fixture";
const username = `user_${randomBytes(6).toString("hex")}`;
const email = `${randomBytes(8).toString("hex")}@example.test`;
createHouseholdCredentials({ projectRoot, runId, username, email, services: ["audiobookshelf", "immich"] });
const credential = loadHouseholdHandoff(projectRoot, runId).services.immich;
const audiobookCredential = loadHouseholdHandoff(projectRoot, runId).services.audiobookshelf;
assert.throws(() => storeHouseholdApiKey(projectRoot, runId, "audiobookshelf", audiobookCredential.password), /matches a managed password/);
const origin = "http://127.0.0.1:24567";

const calls: Array<{ args: string[]; input: string }> = [];
const attributes = new Map([["@e1", "text"], ["@e2", "email"], ["@e3", "password"], ["@e4", "password"]]);
const invoke = async (args: string[], input = "") => {
  calls.push({ args, input });
  if (args.includes("url")) return `${origin}/auth/register`;
  if (args.includes("attr")) {
    const selector = args[args.indexOf("attr") + 1];
    const name = args[args.indexOf("attr") + 2];
    const value = name === "type" ? attributes.get(selector) : null;
    return JSON.stringify({ success: true, data: { value }, error: null });
  }
  return "";
};
const filled = await fillHouseholdBrowserCredentials({ projectRoot, runId, service: "immich", origin, fields: [
  { field: "username", selector: "@e1" }, { field: "email", selector: "@e2" },
  { field: "password", selector: "@e3" }, { field: "password", selector: "@e4" },
] }, { invokeBrowserImplementation: invoke });
assert.deepEqual(filled, { status: "filled", service: "immich", fields: ["username", "email", "password", "password"] });
const batch = calls.at(-1)!;
assert.deepEqual(batch.args, ["--session", `selfhost-household-${runId}`, "batch", "--bail", "--json"]);
assert.deepEqual(JSON.parse(batch.input), [["fill", "@e1", username], ["fill", "@e2", email], ["fill", "@e3", credential.password], ["fill", "@e4", credential.password]]);
assert.equal(calls.some(({ args }) => args.includes("snapshot") || args.includes("screenshot")), false);
for (const call of calls) {
  assert.equal(call.args.includes(username), false);
  assert.equal(call.args.includes(email), false);
  assert.equal(call.args.includes(credential.password), false);
}

let wrongOriginCalls = 0;
await assert.rejects(fillHouseholdBrowserCredentials({ projectRoot, runId, service: "immich", origin: "https://public.example.com", fields: [{ field: "email", selector: "@e2" }] }, {
  invokeBrowserImplementation: async () => { wrongOriginCalls += 1; return ""; },
}), /private HTTP\(S\) origin/);
assert.equal(wrongOriginCalls, 0);
assert.equal(validateApprovedHouseholdOrigin("https://vault.home.arpa"), "https://vault.home.arpa");
assert.equal(validateApprovedHouseholdOrigin("http://[::1]:2283"), "http://[::1]:2283");
assert.equal(validateApprovedHouseholdOrigin("https://[fd12:3456::1]:8443"), "https://[fd12:3456::1]:8443");
assert.throws(() => validateApprovedHouseholdOrigin("https://[2001:db8::1]:8443"), /private HTTP\(S\) origin/);

const apiKey = randomBytes(32).toString("base64url");
const captureCalls: Array<{ args: string[]; input: string }> = [];
const captured = await captureHouseholdBrowserApiKey({ projectRoot, runId, service: "immich", origin, selector: "@e7" }, {
  invokeBrowserImplementation: async (args, input = "") => {
    captureCalls.push({ args, input });
    if (args.includes("url")) return `${origin}/user-settings`;
    if (args.includes("attr")) {
      const name = args[args.indexOf("attr") + 2];
      let value: string | null = null;
      if (name === "type") value = "text";
      if (name === "readonly") value = "";
      if (name === "aria-label") value = "API key";
      return JSON.stringify({ success: true, data: { value }, error: null });
    }
    if (args.includes("enabled")) return JSON.stringify({ success: true, data: { enabled: true }, error: null });
    return JSON.stringify(apiKey);
  },
});
assert.equal(captured.status, "filled");
assert.equal(JSON.stringify(captured).includes(apiKey), false);
assert.equal(captureCalls.some(({ args, input }) => args.includes(apiKey) || input.includes(apiKey)), false);
assert.equal(loadHouseholdHandoff(projectRoot, runId).services.immich.apiKey, apiKey);
assert.deepEqual(householdCredentialStatus(projectRoot, runId).services, [
  { id: "audiobookshelf", provisioning: "pending" },
  { id: "immich", provisioning: "filled" },
]);

const audiobookKey = randomBytes(32).toString("base64url");
const audiobookCalls: Array<{ args: string[]; input: string }> = [];
const audiobookCapture = await captureHouseholdBrowserApiKey({ projectRoot, runId, service: "audiobookshelf", origin }, {
  invokeBrowserImplementation: async (args, input = "") => {
    audiobookCalls.push({ args, input });
    if (args.includes("url")) return `${origin}/config/api-keys`;
    return JSON.stringify(audiobookKey);
  },
});
assert.equal(audiobookCapture.status, "filled");
assert.deepEqual(audiobookCalls[1].args, ["--session", `selfhost-household-${runId}`, "eval", "--stdin"]);
assert.equal(audiobookCalls[1].input, `${audiobookshelfApiKeyEvalScript()}\n`);
assert.equal(audiobookCalls[1].input.includes(audiobookKey), false);
assert.equal(loadHouseholdHandoff(projectRoot, runId).services.audiobookshelf.apiKey, audiobookKey);
await assert.rejects(captureHouseholdBrowserApiKey({ projectRoot, runId, service: "audiobookshelf", origin, selector: "@e9" }, {
  invokeBrowserImplementation: async () => `${origin}/config/api-keys`,
}), /fixed creation field/);
await assert.rejects(captureHouseholdBrowserApiKey({ projectRoot, runId, service: "nextcloud", origin, selector: "@e7" }, { invokeBrowserImplementation: invoke }), /does not support/);

const fixedField = { closest: () => ({}), disabled: false, readOnly: true, type: "text", value: audiobookKey };
const executeAudiobookCapture = new Function("window", "document", `return ${audiobookshelfApiKeyEvalScript()}`);
assert.equal(executeAudiobookCapture(
  { location: { pathname: "/config/api-keys" }, getComputedStyle: () => ({ display: "flex", opacity: "1", visibility: "visible" }) },
  { querySelectorAll: () => [fixedField] },
), audiobookKey);
assert.throws(() => executeAudiobookCapture(
  { location: { pathname: "/config/api-keys" }, getComputedStyle: () => ({ display: "none", opacity: "0", visibility: "hidden" }) },
  { querySelectorAll: () => [fixedField] },
), /not visible/);

for (const rejection of [
  { url: `${origin}/auth/register`, type: "text", readOnly: "", label: "API key", message: /settings page/ },
  { url: `${origin}/user-settings`, type: "password", readOnly: "", label: "API key", message: /type is invalid/ },
  { url: `${origin}/user-settings`, type: "text", readOnly: null, label: "API key", message: /enabled and readonly/ },
  { url: `${origin}/user-settings`, type: "text", readOnly: "", label: "Account name", message: /identity is invalid/ },
]) {
  let valueReads = 0;
  await assert.rejects(captureHouseholdBrowserApiKey({ projectRoot, runId, service: "immich", origin, selector: "@e8" }, {
    invokeBrowserImplementation: async (args) => {
      if (args.includes("url")) return rejection.url;
      if (args.includes("attr")) {
        const name = args[args.indexOf("attr") + 2];
        let value: string | null = null;
        if (name === "type") value = rejection.type;
        if (name === "readonly") value = rejection.readOnly;
        if (name === "aria-label") value = rejection.label;
        return JSON.stringify({ success: true, data: { value }, error: null });
      }
      if (args.includes("enabled")) return JSON.stringify({ success: true, data: { enabled: true }, error: null });
      if (args.includes("value")) valueReads += 1;
      return JSON.stringify(apiKey);
    },
    storeImplementation: () => { throw new Error("store must not be reached"); },
  }), rejection.message);
  assert.equal(valueReads, 0);
}

process.stdout.write("PASS household private browser credential boundary\n");
