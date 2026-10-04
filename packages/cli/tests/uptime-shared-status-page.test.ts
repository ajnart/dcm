import assert from "node:assert/strict";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/uptime-kuma/setup.ts";
import type { SetupCheckpoint, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const projectRoot = "/tmp/synthetic-uptime-status-page";
const metricsKey = `uk7_${"a".repeat(40)}`;
let saved: SetupCheckpoint = { schemaVersion: 1, appId: "uptime-kuma", projectRoot,
  revision: 1, stage: "login-verified", attemptedActions: ["uptime-kuma-add-api-key"],
  data: { metricsKeyID: 7, metricsKeyUserID: 1 } };
let page: Record<string, unknown> | null = null;
let packet = "";
let writes = 0;
const response = (value: unknown, status = 200) => ({ status, ok: status === 200, headers: { get() { return null; } },
  async json() { return value; }, async text() { return String(value); } });
const context = {
  appId: "uptime-kuma", projectRoot, installedAppIds: ["uptime-kuma", "homarr"],
  async status() { return { command: "app status", appId: "uptime-kuma", projectRoot,
    status: "applied", mutation: false, runtime: { state: "running" }, ownerKind: "shared",
    username: "admin", passwordFile: `${projectRoot}/admin-password` }; },
  secrets: {
    async readAdminPassword() { return "synthetic-password"; },
    async readApiKey() { return metricsKey; },
    async apiKeyPath() { return `${projectRoot}/uptime-kuma-api-key`; },
    async writeApiKey() { throw new Error("Status-page setup must reuse the saved metrics key"); },
  },
  checkpoint: {
    async read() { return saved; },
    async compareAndSet(update) {
      assert.equal(update.expectedRevision, saved.revision);
      saved = { ...saved, ...update, revision: saved.revision + 1, data: update.data ?? saved.data };
      return saved;
    },
  },
  http: { async request(input) {
    if (input.path === "/setup-database-info") return response({ needSetup: false, runningSetup: false });
    if (input.path === "/api/status-page/default") return response({ publicGroupList: [] });
    if (input.path === "/api/status-page/heartbeat/default") return response({ heartbeatList: {}, uptimeList: {} });
    if (input.path === "/metrics") {
      if (input.headers?.Authorization === `Basic ${Buffer.from(`:${metricsKey}`).toString("base64")}`) {
        return response("# TYPE synthetic_status_page gauge\nsynthetic_status_page 1\n");
      }
      return response("Unauthorized", 401);
    }
    if (input.method === "GET") {
      if (!input.query?.sid) return response('0{"sid":"synthetic_session"}');
      const current = packet;
      packet = "";
      return response(current);
    }
    if (input.body === "40") {
      packet = '40\x1e42["info",{}]';
      return response("ok");
    }
    const frame = /^42(\d+)(\[.*\])$/.exec(String(input.body))!;
    const [event, ...args] = JSON.parse(frame[2]!);
    if (input.beforeSendCheckpoint) {
      await context.checkpoint.compareAndSet(input.beforeSendCheckpoint);
      saved.attemptedActions.push(input.approval!.action);
    }
    let result: unknown;
    let pushed = "";
    if (event === "needSetup") result = false;
    else if (event === "login") result = { ok: true, token: "synthetic-login-token" };
    else if (event === "getAPIKeyList") {
      result = { ok: true };
      pushed = `42${JSON.stringify(["apiKeyList", [{ id: 7, name: "self-host metrics", userID: 1,
        active: 1, expires: null, status: "active" }]])}\x1e`;
    }
    else if (event === "getStatusPage") result = page ? { ok: true, config: page } : { ok: false, msg: "No slug?" };
    else if (event === "addStatusPage") {
      assert.equal(page, null);
      page = { title: args[0], slug: args[1], domainNameList: [] };
      writes++;
      result = { ok: true, slug: "default" };
    } else if (event === "saveStatusPage") {
      assert.deepEqual(args, ["default", page, "", []]);
      writes++;
      result = { ok: true };
    } else throw new Error("Unexpected event");
    packet = `${pushed}43${frame[1]}${JSON.stringify([result])}`;
    return response("ok");
  } },
} as unknown as SetupContext;

assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(writes, 2);
assert.equal(saved.data.statusPageRecorded, true);
assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(writes, 2);
saved = { ...saved, stage: "login-verified", attemptedActions: ["uptime-kuma-add-api-key"],
  data: { metricsKeyID: 7, metricsKeyUserID: 1 } };
await assert.rejects(adapter.firstRun(context), /already exists without an owned attempt; do not adopt/);
console.log("Uptime Kuma empty shared status page: pass");
