import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import sabnzbd from "../references/catalog/apps/sabnzbd/setup.ts";
import type { SetupContext } from "../references/catalog/types/setup.ts";

const appId = "sabnzbd";
const root = "/tmp/sabnzbd-setup-fixture";
const key = "a".repeat(32);
const generatedValue = "b".repeat(48);
const keyFile = `${root}/secrets/sabnzbd-api-key`;
let savedKey: string | null = null;
let checkpoint: Record<string, unknown> | null = null;
let username = "";
let password = "";
let downloadDir = "Downloads/incomplete";
let completeDir = "Downloads/complete";
let writes = 0;
let lostPasswordResponse = false;
let safetyChecks = 0;
let rejectSafety = false;
let redirectWithoutLoginCookies = false;
let lostUsernameResponse = false;

function response(value: unknown, status = 200, location: string | null = null, cookies: string[] = []) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name: string) { return name === "location" ? location : null; },
      getSetCookie() { return cookies; } },
    async json() { return value; }, async text() { return JSON.stringify(value); } };
}

function currentSetting(name: string): string {
  if (name === "username") return username;
  if (name === "password") return password ? "********" : "";
  if (name === "download_dir") return downloadDir;
  if (name === "complete_dir") return completeDir;
  throw new Error(`Unknown fixture setting: ${name}`);
}

function setSetting(name: string, value: string): void {
  if (name === "username") username = value;
  else if (name === "password") password = value;
  else if (name === "download_dir") downloadDir = value;
  else if (name === "complete_dir") completeDir = value;
  else throw new Error(`Unknown fixture setting: ${name}`);
  writes += 1;
}

function saveCheckpoint(update: { expectedRevision: number | null; stage: string;
  data: Record<string, unknown> }, action?: string): Record<string, unknown> {
  const prior = checkpoint as { revision: number; attemptedActions: string[] } | null;
  assert.equal(update.expectedRevision, prior?.revision ?? null);
  checkpoint = { schemaVersion: 1, appId, projectRoot: root,
    revision: (prior?.revision ?? 0) + 1, stage: update.stage,
    attemptedActions: [...(prior?.attemptedActions ?? []), ...(action ? [action] : [])],
    data: update.data };
  return checkpoint;
}

const context = {
  appId, projectRoot: root,
  async status() {
    return { command: "app status", appId, projectRoot: root,
      status: "applied", mutation: false, runtime: { state: "running" },
      passwordFile: `${root}/secrets/admin-password` };
  },
  http: { async request(request: { method: string; path: string; query?: Record<string, string>;
    body?: string; approval?: { action: string; once?: boolean };
    beforeSendCheckpoint?: { expectedRevision: number | null; stage: string;
      data: Record<string, unknown> } }) {
    assert(!request.path.includes("?"), "secrets must not be put in the URL");
    if (request.method === "GET") {
      assert.equal(request.path, "/api");
      assert.equal(request.query?.mode, "version");
      return response({ version: "5.1.3" });
    }
    assert.equal(request.method, "POST");
    const fields = new URLSearchParams(request.body);
    if (request.path === "/login/") {
      assert.equal(fields.get("username"), "admin");
      assert.equal(fields.get("password"), generatedValue);
      if (username === "admin" && password === generatedValue) {
        if (redirectWithoutLoginCookies) return response({}, 303, "/");
        return response({}, 303, "/", [
          `login_cookie=${"c".repeat(40)}; Path=/`, "login_salt=123; Path=/",
        ]);
      }
      return response({ error: "bad login" });
    }
    assert.equal(request.path, "/api");
    assert(request.approval?.action);
    assert.equal(savedKey, key, "generated key must be privately saved before authenticated readback");
    if (fields.get("mode") === "auth") {
      assert.equal(fields.get("key"), key);
      return response({ auth: "apikey" });
    }
    assert.equal(fields.get("apikey"), key);
    assert.equal(fields.get("section"), "misc");
    const keyword = fields.get("keyword") ?? "";
    if (fields.get("mode") === "get_config") {
      return response({ config: { misc: { [keyword]: currentSetting(keyword) } } });
    }
    assert.equal(fields.get("mode"), "set_config");
    if (request.beforeSendCheckpoint) {
      assert.equal(request.approval.once, true);
      saveCheckpoint(request.beforeSendCheckpoint, request.approval.action);
    }
    setSetting(keyword, fields.get("value") ?? "");
    if (keyword === "username" && lostUsernameResponse) {
      throw new Error("response lost after SABnzbd saved the username");
    }
    if (keyword === "password" && lostPasswordResponse) {
      throw new Error("response lost after SABnzbd saved the password");
    }
    return response({ config: { misc: { [keyword]: currentSetting(keyword) } } });
  } },
  secrets: {
    async readSabnzbdConfigIniApiKey() { return key; },
    async checkSabnzbdSetupSafety() {
      safetyChecks += 1;
      if (rejectSafety) throw new Error("unsafe SABnzbd setup logging");
    },
    async readApiKey() { return savedKey; },
    async writeApiKey(value: string) { assert.equal(value, key); savedKey = value; return keyFile; },
    async readAdminPassword() { return generatedValue; },
  },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(update: { expectedRevision: number | null; stage: string;
      data: Record<string, unknown> }) { return saveCheckpoint(update); },
  },
} as unknown as SetupContext;

const first = await sabnzbd.firstRun(context);
assert.equal(sabnzbd.ready(first), true);
assert.equal(first.provider, "owner-input-required");
assert.equal(first.pathVerification, "api-readback-only");
assert.equal(writes, 4);
assert.equal(savedKey, key);
assert.equal(sabnzbd.homarrIntegration, "sabNzbd");
assert.equal(safetyChecks, 1);

const repeated = await sabnzbd.firstRun(context);
assert.equal(sabnzbd.ready(repeated), true);
assert.equal(writes, 4, "resume must not rewrite credentials or paths");

redirectWithoutLoginCookies = true;
await assert.rejects(sabnzbd.firstRun(context), /administrator password was not verified/);
assert.equal(writes, 4, "a login redirect without fresh authorization cookies is not credential proof");
redirectWithoutLoginCookies = false;

checkpoint = null;
savedKey = null;
username = "";
password = generatedValue;
await assert.rejects(sabnzbd.firstRun(context), /unowned WebUI password/);
assert.equal(writes, 4, "a pre-existing password must not be overwritten or activated for a new username");

checkpoint = null;
savedKey = null;
username = "";
password = "";
downloadDir = "Downloads/incomplete";
completeDir = "Downloads/complete";
lostUsernameResponse = true;
await assert.rejects(sabnzbd.firstRun(context), /response lost/);
assert.equal(checkpoint?.stage, "username-attempted");
const beforeUsernameRecovery = writes;
lostUsernameResponse = false;
assert.equal(sabnzbd.ready(await sabnzbd.firstRun(context)), true);
assert.equal(writes, beforeUsernameRecovery + 3, "resume must not repeat the username write");

checkpoint = null;
savedKey = null;
username = "";
password = "";
downloadDir = "Downloads/incomplete";
completeDir = "Downloads/complete";
lostPasswordResponse = true;
await assert.rejects(sabnzbd.firstRun(context), /response lost/);
assert.equal(checkpoint?.stage, "password-attempted");
const beforeRecovery = writes;
lostPasswordResponse = false;
username = "";
await assert.rejects(sabnzbd.firstRun(context), /administrator changed after its credential checkpoint/);
assert.equal(writes, beforeRecovery, "changed username must not trigger credential or path writes");
username = "admin";
assert.equal(sabnzbd.ready(await sabnzbd.firstRun(context)), true);
assert.equal(writes, beforeRecovery + 2, "resume must not repeat the password write");

checkpoint = null;
savedKey = null;
username = "admin";
password = generatedValue;
const beforeUnowned = writes;
await assert.rejects(sabnzbd.firstRun(context), /first-admin provenance is missing/);
assert.equal(checkpoint, null, "matching unmanaged credentials must not gain setup provenance");
assert.equal(writes, beforeUnowned, "unowned administrator must prevent path and credential writes");

for (const attemptedActions of [[], ["sab-set-username"], ["sab-set-password"]]) {
  checkpoint = { schemaVersion: 1, appId, projectRoot: root, revision: 1,
    stage: "admin-verified", attemptedActions,
    data: { version: "5.1.3", keyHash: createHash("sha256").update(key).digest("hex") } };
  const obsoleteCheckpoint = checkpoint;
  savedKey = null;
  await assert.rejects(sabnzbd.firstRun(context), /checkpoint is missing first-admin credential-write provenance/);
  assert.equal(checkpoint, obsoleteCheckpoint, "invalid saved provenance must not be promoted");
  assert.equal(savedKey, null, "invalid saved provenance must not export an API key");
  assert.equal(writes, beforeUnowned, "invalid saved provenance must prevent setup writes");
}

checkpoint = null;
savedKey = null;
username = "other";
await assert.rejects(sabnzbd.firstRun(context), /different WebUI administrator/);

const beforeUnsafe = writes;
rejectSafety = true;
await assert.rejects(sabnzbd.firstRun(context), /unsafe SABnzbd setup logging/);
assert.equal(writes, beforeUnsafe, "unsafe logging must prevent all setup writes");

process.stdout.write("SABnzbd first-run contract checks passed\n");
