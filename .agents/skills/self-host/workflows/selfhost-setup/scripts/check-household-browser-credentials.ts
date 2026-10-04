#!/usr/bin/env bun

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audiobookshelfApiKeyEvalScript, captureHouseholdBrowserApiKey, describeHouseholdVaultwardenSignupFailure, fillHouseholdBrowserCredentials, hasVaultwardenInvalidMasterPassword, householdVaultwardenCredentialFingerprint, loginHouseholdBrowser, signupHouseholdVaultwarden, validateApprovedHouseholdOrigin, vaultwardenWelcomeTourScript } from "./household-browser-credentials.ts";
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
createHouseholdCredentials({ projectRoot, runId, username, email, services: ["audiobookshelf", "immich", "vaultwarden"] });
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
  if (args.includes("value")) {
    const selected = args[args.indexOf("value") + 1];
    if (selected === "@e1") return username;
    if (selected === "@e2") return email;
    return credential.password;
  }
  return "";
};
const filled = await fillHouseholdBrowserCredentials({ projectRoot, runId, service: "immich", origin, fields: [
  { field: "username", selector: "@e1" }, { field: "email", selector: "@e2" },
  { field: "password", selector: "@e3" }, { field: "password", selector: "@e4" },
] }, { invokeBrowserImplementation: invoke });
assert.deepEqual(filled, { status: "filled", service: "immich", fields: ["username", "email", "password", "password"] });
const batch = calls.find(({ args }) => args.includes("batch"))!;
assert.deepEqual(batch.args, ["--session", `selfhost-household-${runId}`, "batch", "--bail", "--json"]);
assert.deepEqual(JSON.parse(batch.input), [["fill", "@e1", username], ["fill", "@e2", email], ["fill", "@e3", credential.password], ["fill", "@e4", credential.password]]);
assert.equal(calls.some(({ args }) => args.includes("snapshot") || args.includes("screenshot")), false);
for (const call of calls) {
  assert.equal(call.args.includes(username), false);
  assert.equal(call.args.includes(email), false);
  assert.equal(call.args.includes(credential.password), false);
}
await assert.rejects(fillHouseholdBrowserCredentials({ projectRoot, runId, service: "immich", origin,
  fields: [{ field: "password", selector: "@e3" }] }, {
  invokeBrowserImplementation: async (args, input = "") => {
    if (args.includes("value")) return "different-field-value";
    return invoke(args, input);
  },
}), /did not retain the selected credential/);

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
  { id: "vaultwarden", provisioning: "pending" },
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

const vaultCredential = loadHouseholdHandoff(projectRoot, runId).services.vaultwarden;
const vaultOrigin = "https://vaultwarden.localhost:28443";
const evaluateWelcome = new Function("window", "document", "HTMLButtonElement", `return ${vaultwardenWelcomeTourScript(vaultOrigin)};`);
class WelcomeButton {
  disabled = false;
  constructor(public innerText: string) {}
  getBoundingClientRect() { return { width: 100, height: 30 }; }
  click() { welcomeClicks.push(this.innerText); }
}
const welcomeClicks: string[] = [];
const skipWelcome = new WelcomeButton("Skip");
const startWelcome = new WelcomeButton("Start tour");
let welcomeHeadings = ["", "You're in! Welcome to Bitwarden"];
let welcomeButtons = [skipWelcome, startWelcome];
const welcomeDialog = { tagName: "CDK-DIALOG-CONTAINER", getBoundingClientRect: () => ({ width: 400, height: 300 }),
  querySelectorAll: (selector: string) => {
    if (selector === "button") return welcomeButtons;
    return welcomeHeadings.map((innerText) => ({ innerText }));
  } };
let welcomeDialogs = [welcomeDialog];
const welcomeWindow = { location: { origin: vaultOrigin, pathname: "/", search: "", hash: "#/vault" },
  getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
const welcomeDocument = { querySelectorAll: () => welcomeDialogs };
evaluateWelcome(welcomeWindow, welcomeDocument, WelcomeButton);
assert.deepEqual(welcomeClicks, ["Skip"]);
welcomeHeadings = ["", "Unknown account dialog"];
assert.throws(() => evaluateWelcome(welcomeWindow, welcomeDocument, WelcomeButton), /unknown welcome-tour headings/);
welcomeHeadings = ["", "You're in! Welcome to Bitwarden"];
welcomeButtons = [skipWelcome, startWelcome, new WelcomeButton("Close")];
assert.throws(() => evaluateWelcome(welcomeWindow, welcomeDocument, WelcomeButton), /unknown welcome-tour buttons/);
welcomeButtons = [skipWelcome, startWelcome];
welcomeDialogs = [welcomeDialog, welcomeDialog];
assert.throws(() => evaluateWelcome(welcomeWindow, welcomeDocument, WelcomeButton), /unknown welcome-tour modal/);
welcomeDialogs = [];
evaluateWelcome(welcomeWindow, welcomeDocument, WelcomeButton);
assert.deepEqual(welcomeClicks, ["Skip"], "unknown dialogs must never cause any click");
const emailForm = '- heading "Log in" [level=1, ref=e1]\n- textbox "Email address * (required)" [required, ref=e2]\n- button "Continue" [ref=e3]\n- link "Create account" [ref=e4]';
const passwordForm = '- heading "Welcome back" [level=1, ref=e5]\n- textbox "Master password * (required)" [required, ref=e6]\n- button "Log in" [ref=e7]\n- button "Back" [ref=e8]\n- link "Hint" [ref=e9]';
const acceptedForm = '- button "Display name" [expanded=false, ref=e10]\n- button "Filter: All items" [expanded=true, ref=e11]\n- button " New item" [ref=e12]\n- textbox "Search" [ref=e13]\n- heading "No items in vault" [level=2]';
const rejectedForm = `${passwordForm}\n- StaticText " Invalid master password. Confirm your email is correct and your account was created on vaultwarden.localhost:28443."`;
assert.equal(hasVaultwardenInvalidMasterPassword(rejectedForm, vaultOrigin), true);
assert.equal(hasVaultwardenInvalidMasterPassword(rejectedForm, "https://vaultwarden.localhost:31429"), false);
assert.equal(hasVaultwardenInvalidMasterPassword(rejectedForm.replace("Invalid master password.", "Invalid master password?"), vaultOrigin), false);
async function exerciseLogin(finalSnapshot: string, finalHash: string, options: { accountEmail?: string; accountType?: string | null; readonly?: boolean; duplicateEmail?: boolean; duplicateMenu?: boolean; welcomeAtRestore?: boolean; extensionOnboarding?: boolean; extensionButton?: string } = {}) {
  const loginCalls: Array<{ args: string[]; input: string }> = [];
  let phase = 0;
  let fieldFilled = false;
  let accountInspected = false;
  let welcomeDismissed = false;
  let extensionStep = 0;
  const result = await loginHouseholdBrowser({ projectRoot, runId, service: "vaultwarden", origin: vaultOrigin }, {
    invokeBrowserImplementation: async (args, input = "") => {
      loginCalls.push({ args, input });
      if (args.includes("url")) {
        if (phase === 4) return `${vaultOrigin}/#/settings/account`;
        if (phase >= 2) return `${vaultOrigin}/${finalHash}`;
        return `${vaultOrigin}/#/login`;
      }
      if (args.includes("snapshot")) {
        let snapshot = emailForm;
        if (phase === 1) snapshot = passwordForm;
        if (phase >= 2) snapshot = finalSnapshot;
        if (phase === 2 && options.extensionOnboarding && extensionStep === 0) snapshot = `- heading "Autofill your passwords securely with one click" [level=1]\n- heading "Get the Bitwarden browser extension and start autofilling today" [level=2]\n- button "${options.extensionButton ?? "Add it later"}" [ref=e30]`;
        if (phase === 2 && options.extensionOnboarding && extensionStep === 1) snapshot = '- link "Skip to web app" [ref=e31]';
        if (phase === 3) {
          snapshot += '\n- menuitem " Account settings" [ref=e14]';
          if (options.duplicateMenu) snapshot += '\n- menuitem "Account settings " [ref=e20]';
        }
        if (phase === 4) {
          accountInspected = true;
          snapshot = `- heading "My account" [level=1]\n- textbox "Email" [ref=e15, readonly]: ${options.accountEmail ?? email}\n- textbox "Name" [ref=e16]\n- link "Vaults" [ref=e17]`;
          if (options.duplicateEmail) snapshot += '\n- textbox "Email" [ref=e18, readonly]';
        }
        if (fieldFilled && phase === 0) snapshot = snapshot.replace('[required, ref=e2]', `[required, ref=e2]: ${email}`);
        if (fieldFilled && phase === 1) snapshot = snapshot.replace('[required, ref=e6]', `[required, ref=e6]: ${vaultCredential.password}`);
        return JSON.stringify({ success: true, error: null, data: { snapshot } });
      }
      if (args.includes("attr")) {
        const name = args[args.indexOf("attr") + 2];
        let value: string | null = null;
        if (name === "type") {
          value = "email";
          if (phase === 1) value = "password";
          if (phase === 4) {
            value = "text";
            if (options.accountType !== undefined) value = options.accountType;
          }
        }
        if (name === "readonly" && phase === 4 && options.readonly !== false) value = "";
        return JSON.stringify({ success: true, error: null, data: { value } });
      }
      if (args.includes("enabled")) return JSON.stringify({ success: true, data: { enabled: true } });
      if (args.includes("wait") && args.includes("--fn")) {
        const predicate = args[args.indexOf("--fn") + 1];
        if (predicate.includes(".cdk-overlay-backdrop")) return "";
        assert.equal(predicate.includes('app-account-menu > button[aria-haspopup="menu"]'), true);
        assert.equal(predicate.includes("button.innerText.trim()"), true);
        assert.equal(predicate.includes("bounds.width > 0 && bounds.height > 0"), true);
        assert.equal(predicate.includes("newItems.length === 1"), true);
        assert.equal(predicate.includes("menus[0].disabled"), true);
        class FixtureButton {
          disabled = false;
          innerText = " New item";
          getBoundingClientRect() { return { width: 100, height: 30 }; }
        }
        const renderedButton = new FixtureButton();
        const menuButton = new FixtureButton();
        let rendered = false;
        const evaluateReady = new Function("window", "document", "HTMLButtonElement", `return ${predicate};`);
        const page = { location: { pathname: "/", search: "", hash: "#/vault" } };
        const documentFixture = {
          body: { innerText: "" },
          querySelectorAll: (selector: string) => {
            if (!rendered) return [];
            if (selector === "button") return [renderedButton];
            return [menuButton];
          },
        };
        assert.equal(evaluateReady(page, documentFixture, FixtureButton), false, "route alone must not complete the rendering wait");
        rendered = true;
        assert.equal(evaluateReady(page, documentFixture, FixtureButton), true);
        menuButton.disabled = true;
        assert.equal(evaluateReady(page, documentFixture, FixtureButton), false);
      }
      if (args.includes("value")) {
        if (phase === 0) return email;
        if (phase === 4) return JSON.stringify(options.accountEmail ?? email);
        return vaultCredential.password;
      }
      if (args.includes("eval")) {
        if (input.includes("You're in! Welcome to Bitwarden")) {
          if (phase === 4) welcomeDismissed = true;
          return "";
        }
        assert.equal(phase, 2);
        assert.equal(input.includes('app-account-menu > button[aria-haspopup="menu"]'), true);
        assert.equal(input.includes("buttons.length !== 1"), true);
        assert.equal(input.includes("buttons[0].disabled"), true);
        phase = 3;
      }
      if (args.includes("batch")) {
        const batch: string[][] = JSON.parse(input);
        if (phase === 4 && batch[0][0] === "click" && options.welcomeAtRestore && !welcomeDismissed) {
          throw new Error("welcome overlay covers Vaults");
        }
        if (batch[0][0] === "fill") fieldFilled = true;
        if (batch[0][0] === "click") {
          if (batch[0][1] === "@e30") { extensionStep = 1; return ""; }
          if (batch[0][1] === "@e31") { extensionStep = 2; return ""; }
          phase += 1;
          fieldFilled = false;
        }
      }
      return "";
    },
  }).finally(() => {
    if (accountInspected) assert.equal(phase, 5, "account inspection must restore Vaults even on mismatch or invalid field");
    for (const call of loginCalls) {
      assert.equal(call.args.some((argument) => argument.includes(email) || argument.includes(vaultCredential.password)), false);
      assert.equal(call.args.includes("open") || call.args.includes("screenshot"), false);
    }
  });
  let expectedClicks = 2;
  if (phase === 5) expectedClicks = 4;
  if (options.extensionOnboarding) expectedClicks += 2;
  assert.equal(loginCalls.filter((call) => call.args.includes("batch") && JSON.parse(call.input)[0][0] === "click").length, expectedClicks);
  assert.equal(JSON.stringify(result).includes(email) || JSON.stringify(result).includes(vaultCredential.password), false);
  return result;
}
assert.equal((await exerciseLogin(rejectedForm, "#/login")).status, "rejected");
assert.equal((await exerciseLogin(acceptedForm, "#/vault")).status, "accepted");
assert.equal((await exerciseLogin(acceptedForm, "#/vault", { welcomeAtRestore: true })).status, "accepted");
assert.equal((await exerciseLogin(acceptedForm, "#/vault", { extensionOnboarding: true })).status, "accepted");
await assert.rejects(exerciseLogin(acceptedForm, "#/vault", { extensionOnboarding: true, extensionButton: "Install now" }), /unknown or ambiguous/);
assert.equal((await exerciseLogin(acceptedForm, "#/vault", { accountType: null })).status, "accepted");
for (const accountType of ["password", "email"]) {
  await assert.rejects(exerciseLogin(acceptedForm, "#/vault", { accountType }), /identity field is not readonly/);
}
assert.equal((await exerciseLogin(acceptedForm.replace(" New item", "New item"), "#/vault/items")).status, "accepted");
await assert.rejects(exerciseLogin(acceptedForm, "#/vault", { duplicateMenu: true }), /unknown or ambiguous/);
await assert.rejects(exerciseLogin(acceptedForm, "#/vault", { accountEmail: "other@example.test" }), /does not match the managed identity/);
await assert.rejects(exerciseLogin(acceptedForm, "#/vault", { readonly: false }), /identity field is not readonly/);
await assert.rejects(exerciseLogin(acceptedForm, "#/vault", { duplicateEmail: true }), /unknown or ambiguous/);
await assert.rejects(exerciseLogin(acceptedForm.replace("Filter: All items", "All items"), "#/vault"), /result is unknown/);
await assert.rejects(exerciseLogin(`${acceptedForm}\n- button "New item" [ref=e19]`, "#/vault"), /result is unknown/);
await assert.rejects(exerciseLogin('- alert: An unexpected server error', "#/login"), /result is unknown/);
await assert.rejects(loginHouseholdBrowser({ projectRoot, runId, service: "immich", origin: vaultOrigin }), /only Vaultwarden/);
await assert.rejects(loginHouseholdBrowser({ projectRoot, runId, service: "vaultwarden", origin }), /private HTTPS/);
let unknownFormWrites = 0;
await assert.rejects(loginHouseholdBrowser({ projectRoot, runId, service: "vaultwarden", origin: vaultOrigin }, {
  invokeBrowserImplementation: async (args) => {
    if (args.includes("url")) return `${vaultOrigin}/#/login`;
    if (args.includes("batch")) unknownFormWrites += 1;
    return JSON.stringify({ success: true, error: null, data: { snapshot: `${emailForm}\n- button "Continue" [ref=e15]` } });
  },
}), /unknown or ambiguous/);
assert.equal(unknownFormWrites, 0);
// Fresh signup failures must not cross the durable single-submission callback.
const signupCa = join(root, "fixture-public-root.crt");
const generatedCa = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(root, "fixture-key.pem"), "-out", signupCa,
  "-days", "1", "-subj", "/CN=Selfhost fixture root", "-addext", "basicConstraints=critical,CA:TRUE"], { stdio: "ignore" });
assert.equal(generatedCa.status, 0);
chmodSync(signupCa, 0o600);
const signupInput = { projectRoot, runId, origin: vaultOrigin, browserBin: realpathSync(process.execPath), caCert: signupCa,
  uiContractVersion: "vaultwarden-1.37.3-20260927" as const,
  expectedCredentialFingerprint: householdVaultwardenCredentialFingerprint(projectRoot, runId),
  expectedCaFingerprint: new X509Certificate(readFileSync(signupCa)).fingerprint256 };
assert.match(signupInput.expectedCredentialFingerprint, /^[a-f0-9]{64}$/);
assert.equal(signupInput.expectedCredentialFingerprint.includes(vaultCredential.password), false);
let existingSessionOpens = 0;
await assert.rejects(signupHouseholdVaultwarden({ ...signupInput, beforeSubmit: async () => { throw new Error("unexpected submit"); } }, {
  invokeBrowserImplementation: async (args) => {
    if (args.includes("open")) existingSessionOpens += 1;
    return JSON.stringify({ success: true, error: null, data: { sessions: [args[args.indexOf("--session") + 1]] } });
  },
}), (error) => describeHouseholdVaultwardenSignupFailure(error)?.stage === "require-new-signup-browser");
assert.equal(existingSessionOpens, 0);
for (const lifecycle of [{ launched: false, reused: true }, {}]) {
  let writes = 0; let closes = 0;
  await assert.rejects(signupHouseholdVaultwarden({ ...signupInput, beforeSubmit: async () => { writes += 1; } }, {
    invokeBrowserImplementation: async (args) => {
      if (args.includes("batch")) writes += 1;
      if (args.includes("close")) closes += 1;
      if (args.includes("list")) return JSON.stringify({ success: true, error: null, data: { sessions: [] } });
      return JSON.stringify({ success: true, error: null, data: { lifecycle } });
    },
  }), (error) => describeHouseholdVaultwardenSignupFailure(error)?.stage === "launch-ca-trusted-signup-browser");
  assert.equal(writes, 0);
  assert.equal(closes, 0, "unproven or reused sessions must not be closed");
}
await assert.rejects(signupHouseholdVaultwarden({ ...signupInput, expectedCredentialFingerprint: "0".repeat(64), beforeSubmit: async () => {} }), (error) => describeHouseholdVaultwardenSignupFailure(error)?.stage === "validate-signup-boundary");
for (const outcome of ["ledger-fails", "unknown-signup", "accepted", "close-fails"]) {
  const ledgerFails = outcome === "ledger-fails";
  let phase = 0; let launched = false; let breachDisabled = false; let submissions = 0; let ledgerCalls = 0;
  let recordedSession = "";
  let closes = 0;
  const invokeSignup = async (args: string[], input = "") => {
    assert.equal(args.includes(vaultCredential.password) || args.includes(email), false);
    assert.equal(args.includes("--ignore-https-errors"), false);
    const selectedSession = args[args.indexOf("--session") + 1];
    assert.match(selectedSession, /^selfhost-vault-signup-[a-f0-9]{12}-[a-f0-9]{24}$/);
    if (args.includes("list")) return JSON.stringify({ success: true, data: { sessions: launched ? [selectedSession] : [] } });
    if (args.includes("open")) {
      assert.equal(selectedSession, recordedSession, "owned nonce must be recorded before browser launch");
      assert.equal(args.includes("--ca-cert") && args.includes("--allowed-domains"), true);
      assert.equal(args.includes("--no-sandbox"), false);
      launched = true; return JSON.stringify({ success: true, data: { lifecycle: { launched: false, reused: true, restoreStatus: "not_configured", effectiveLaunch: { browserLaunched: true, engine: "chrome" } } } });
    }
    if (args.includes("close")) {
      closes += 1;
      assert.equal(selectedSession, recordedSession);
      if (outcome === "close-fails") throw new Error("raw secret-bearing close failure must not escape");
      return "";
    }
    if (args.includes("url")) {
      let hash = "#/register?token=private-fixture-token";
      if ([5, 6, 9, 10, 12].includes(phase)) hash = "#/vault";
      if (phase === 11) hash = "#/settings/account";
      if ([7, 8].includes(phase)) hash = "#/login";
      return JSON.stringify({ success: true, data: { url: `${vaultOrigin}/${hash}` } });
    }
    if (args.includes("snapshot")) {
      let snapshot = '- heading "Log in" [level=1]\n- link "Create account" [ref=e1]';
      if (phase === 1) snapshot = '- heading "Create account" [level=1]\n- textbox "Email address *" [ref=e2]\n- textbox "Name" [ref=e3]\n- button "Continue" [ref=e4]';
      if (phase === 2) snapshot = '- heading "Set a strong password" [level=1]\n- textbox "Master password *" [ref=e5]\n- textbox "Confirm master password *" [ref=e6]\n- textbox "Master password hint" [ref=e7]\n- button "Create account" [ref=e8]';
      if (phase === 3) snapshot = '- heading "Autofill your passwords securely with one click" [level=1]\n- button "Add it later" [ref=e9]';
      if (phase === 4) snapshot = '- link "Skip to web app" [ref=e9]';
      if ([5, 6, 9, 10, 12].includes(phase)) snapshot = acceptedForm;
      if (phase === 6) snapshot += '\n- menuitem "Log out" [ref=e9]';
      if (phase === 7) snapshot = '- heading "Log in" [level=1]\n- textbox "Email address *" [ref=e20]\n- button "Continue" [ref=e21]';
      if (phase === 8) snapshot = '- heading "Welcome back" [level=1]\n- textbox "Master password *" [ref=e22]\n- button "Log in" [ref=e23]';
      if (phase === 10) snapshot += '\n- menuitem "Account settings" [ref=e24]';
      if (phase === 11) snapshot = '- heading "My account" [level=1]\n- textbox "Email" [readonly, ref=e25]\n- link "Vaults" [ref=e26]';
      return JSON.stringify({ success: true, data: { snapshot } });
    }
    if (args.includes("attr")) {
      const ref = args[args.indexOf("attr") + 1]; const name = args[args.indexOf("attr") + 2];
      let value: string | null = null;
      if (name === "type") { value = "text"; if (["@e5", "@e6", "@e22"].includes(ref)) value = "password"; }
      if (name === "id") { value = "input-password-form_new-password"; if (ref === "@e6") value += "-confirm"; }
      if (name === "readonly" && ref === "@e25") value = "";
      return JSON.stringify({ success: true, data: { value } });
    }
    if (args.includes("value")) {
      const ref = args[args.indexOf("value") + 1];
      if (["@e2", "@e20", "@e25"].includes(ref)) return email;
      if (ref === "@e3") return username;
      if (ref === "@e7") { if (ledgerFails) return JSON.stringify(""); return ""; }
      return vaultCredential.password;
    }
    if (args.includes("eval") && input.includes("input-password-form_check-for-breaches")) breachDisabled = true;
    if (args.includes("enabled")) return JSON.stringify({ success: true, data: { enabled: true } });
    if (args.includes("eval") && input.includes('app-account-menu > button[aria-haspopup="menu"]') && !input.includes("You're in! Welcome to Bitwarden")) phase += 1;
    if (args.includes("batch")) {
      const action: string[][] = JSON.parse(input);
      if (action[0][0] === "fill" && action.some((row) => row[2] === vaultCredential.password)) assert.equal(breachDisabled, true);
      if (action[0][0] === "click") {
        if (action[0][1] === "@e8") { assert.equal(ledgerCalls, 1); submissions += 1; }
        phase += 1;
      }
    }
    if (outcome === "unknown-signup" && args.includes("wait") && args.includes("Autofill your passwords securely with one click")) throw new Error("unknown signup outcome");
    return "";
  };
  const operation = signupHouseholdVaultwarden({ ...signupInput, onBrowserSession: async (session) => { recordedSession = session; }, beforeSubmit: async () => {
    ledgerCalls += 1; if (ledgerFails) throw new Error("ledger flush failed");
  } }, { invokeBrowserImplementation: invokeSignup });
  if (outcome === "accepted") {
    assert.equal((await operation).status, "accepted");
    assert.equal(phase, 12);
  } else await assert.rejects(operation, (error) => {
    const failure = describeHouseholdVaultwardenSignupFailure(error);
    assert.equal(failure?.submitted, !ledgerFails);
    assert.match(failure?.browserSession ?? "", /^selfhost-vault-signup-[a-f0-9]{12}-[a-f0-9]{24}$/);
    let stage = "complete-signup-onboarding";
    if (ledgerFails) stage = "record-single-signup-submission";
    if (outcome === "close-fails") stage = "close-signup-browser";
    assert.equal(failure?.stage, stage);
    return true;
  });
  assert.equal(ledgerCalls, 1);
  assert.equal(submissions, Number(!ledgerFails));
  let expectedCloses = 0;
  if (["accepted", "close-fails"].includes(outcome)) expectedCloses = 1;
  assert.equal(closes, expectedCloses);
}
let blockedLaunches = 0;
await assert.rejects(signupHouseholdVaultwarden({ ...signupInput,
  onBrowserSession: async () => { throw new Error("private session ledger flush failed"); }, beforeSubmit: async () => {} }, {
  invokeBrowserImplementation: async (args) => {
    if (args.includes("open")) blockedLaunches += 1;
    return JSON.stringify({ success: true, error: null, data: { sessions: [] } });
  },
}), (error) => describeHouseholdVaultwardenSignupFailure(error)?.stage === "record-signup-browser-session");
assert.equal(blockedLaunches, 0);
for (const error of ["native error", false, 0, {}]) {
  let errorEnvelopeLaunches = 0;
  await assert.rejects(signupHouseholdVaultwarden({ ...signupInput, beforeSubmit: async () => {} }, {
    invokeBrowserImplementation: async (args) => {
      if (args.includes("open")) errorEnvelopeLaunches += 1;
      return JSON.stringify({ success: true, error, data: { sessions: [] } });
    },
  }), (failure) => describeHouseholdVaultwardenSignupFailure(failure)?.stage === "require-new-signup-browser");
  assert.equal(errorEnvelopeLaunches, 0);
}
process.stdout.write("PASS household private browser credential boundary\n");
