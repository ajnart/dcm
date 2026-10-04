import assert from "node:assert/strict";

import qbittorrent from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/qbittorrent/setup.ts";
import { resolvePeerEffects } from "../src/control-panel/setup-engine.ts";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest, SetupInspectionContext } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const root = "/tmp/qbittorrent-category-fixture";
const key = "qbt_1234567890123456789012345678";
const keyPath = `${root}/secrets/qbittorrent-api-key`;
const passwordFile = `${root}/secrets/admin-password`;
let installedAppIds = ["qbittorrent"];
let ownerKind = "shared";
let saved: SetupCheckpoint | null;
let inventory: Record<string, { name: string; savePath: string }>;
let created: string[];
let loseResponse = false;

function reset() {
  installedAppIds = ["qbittorrent"];
  ownerKind = "shared";
  saved = { schemaVersion: 1, appId: "qbittorrent", projectRoot: root, revision: 1,
    stage: "login-and-api-verified", attemptedActions: [],
    data: { passwordFile, apiKeyFile: keyPath } };
  inventory = {};
  created = [];
  loseResponse = false;
}

function reply(status: number, body: unknown, cookie: string | null = null) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name: string) { return name === "set-cookie" ? cookie : null; } },
    async json() { return body; }, async text() { return String(body); } };
}

const context = {
  appId: "qbittorrent", projectRoot: root,
  get installedAppIds() { return installedAppIds; },
  async status() {
    return { command: "app status", appId: "qbittorrent", projectRoot: root,
      ownerKind, status: "applied", mutation: false, runtime: { state: "running" },
      username: "admin", port: 27408, url: "http://127.0.0.1:27408", passwordFile,
      privateFiles: `${root}/secrets` };
  },
  http: { async request(request: SetupHttpRequest) {
    if (request.path === "/api/v2/auth/login") {
      assert.equal(request.method, "POST");
      return reply(204, "", "QBT_SID_8080=fixture-session; Path=/");
    }
    if (request.path === "/api/v2/app/version") {
      assert.ok(request.headers?.Authorization === `Bearer ${key}`
        || request.headers?.Cookie === "QBT_SID_8080=fixture-session");
      return reply(200, "5.2.3");
    }
    if (request.path === "/api/v2/app/preferences") {
      return reply(200, { web_ui_username: "admin", save_path: "/data/torrents",
        temp_path: "/data/torrents/incomplete", temp_path_enabled: true,
        web_ui_api_key: key });
    }
    if (request.path === "/api/v2/torrents/categories") {
      assert.equal(request.method, "GET");
      assert.equal(request.headers?.Authorization, `Bearer ${key}`);
      return reply(200, structuredClone(inventory));
    }
    if (request.path === "/api/v2/torrents/createCategory") {
      assert.equal(request.method, "POST");
      assert.equal(request.approval?.once, true);
      assert.equal(request.beforeSendCheckpoint?.stage, "category-create-attempted");
      const values = new URLSearchParams(request.body as string);
      const name = values.get("category")!;
      const path = values.get("savePath")!;
      assert.ok(["tv-sonarr", "movies-radarr"].includes(name));
      const update = request.beforeSendCheckpoint!;
      saved = { schemaVersion: 1, appId: "qbittorrent", projectRoot: root,
        revision: saved!.revision + 1, stage: update.stage,
        attemptedActions: [...saved!.attemptedActions, request.approval!.action],
        data: update.data! };
      inventory[name] = { name, savePath: path };
      created.push(name);
      if (loseResponse) {
        loseResponse = false;
        throw new Error("category response lost");
      }
      return reply(204, "");
    }
    throw new Error(`Unexpected ${request.method} ${request.path}`);
  } },
  secrets: {
    async readSessionCookies() { return {}; },
    async writeSessionCookies() {},
    async readAdminPassword() { return "saved-password-012345678901234567890123456789"; },
    async readApiKey() { return key; },
    async apiKeyPath() { return keyPath; },
  },
  checkpoint: {
    async read() { return saved; },
    async compareAndSet(update: { expectedRevision: number | null; stage: string;
      data?: Record<string, string | number | boolean | null> }) {
      assert.equal(update.expectedRevision, saved?.revision ?? null);
      saved = { schemaVersion: 1, appId: "qbittorrent", projectRoot: root,
        revision: (saved?.revision ?? 0) + 1, stage: update.stage,
        attemptedActions: saved?.attemptedActions ?? [], data: update.data ?? {} };
      return saved;
    },
  },
} as unknown as SetupContext;

reset();
const effects = await resolvePeerEffects(["qbittorrent"], ["qbittorrent", "sonarr"]);
assert.equal(effects.length, 1);
assert.equal(effects[0]?.peerAppId, "sonarr");
assert.match(effects[0]!.description, /tv-sonarr/);
assert.equal((await qbittorrent.firstRun(context)).stage, "login-and-api-verified");
assert.deepEqual(created, []);
assert.equal((await qbittorrent.inspect!(context as SetupInspectionContext)).stage,
  "login-and-api-verified");

ownerKind = "standalone";
installedAppIds = ["qbittorrent", "sonarr"];
assert.equal((await qbittorrent.firstRun(context)).stage, "login-and-api-verified");
assert.deepEqual(created, []);
ownerKind = "shared";

installedAppIds = ["qbittorrent", "sonarr", "radarr"];
const linked = await qbittorrent.firstRun(context);
assert.equal(qbittorrent.ready(linked), true);
assert.equal(linked.stage, "categories-verified");
assert.equal(linked.sonarrCategory, "tv-sonarr");
assert.equal(linked.radarrCategory, "movies-radarr");
assert.deepEqual(created, ["tv-sonarr", "movies-radarr"]);
assert.equal(saved?.stage, "categories-verified");
assert.equal((await qbittorrent.inspect!(context as SetupInspectionContext)).stage,
  "categories-verified");
assert.equal((await qbittorrent.firstRun(context)).stage, "categories-verified");
assert.deepEqual(created, ["tv-sonarr", "movies-radarr"]);

delete inventory["tv-sonarr"];
await assert.rejects(qbittorrent.inspect!(context as SetupInspectionContext), /no longer present/);
await assert.rejects(qbittorrent.firstRun(context), /outcome is uncertain/);

reset();
installedAppIds = ["qbittorrent", "sonarr"];
loseResponse = true;
await assert.rejects(qbittorrent.firstRun(context), /category response lost/);
assert.equal(saved?.stage, "category-create-attempted");
assert.deepEqual(created, ["tv-sonarr"]);
assert.equal((await qbittorrent.firstRun(context)).stage, "categories-verified");
assert.deepEqual(created, ["tv-sonarr"]);
installedAppIds = ["qbittorrent", "sonarr", "radarr"];
assert.equal((await qbittorrent.firstRun(context)).stage, "categories-verified");
assert.deepEqual(created, ["tv-sonarr", "movies-radarr"]);
assert.equal((await qbittorrent.inspect!(context as SetupInspectionContext)).radarrCategory,
  "movies-radarr");

reset();
installedAppIds = ["qbittorrent", "sonarr"];
inventory["tv-sonarr"] = { name: "tv-sonarr", savePath: "/other" };
await assert.rejects(qbittorrent.firstRun(context), /already uses another path/);
assert.deepEqual(created, []);

console.log("qBittorrent selected Arr categories and replay: pass");
