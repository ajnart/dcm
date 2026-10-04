import assert from "node:assert/strict";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/freshrss/setup.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupContainerCommand, SetupHttpRequest } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

// Entirely synthetic: no filesystem, container, provider or network access.
const root = "/synthetic/freshrss";
const privateFiles = `${root}/secrets/freshrss`;
const auth = `admin/${"b".repeat(40)}`;
function fixture() {
  let cp: SetupCheckpoint | null = { schemaVersion: 1, appId: "freshrss", projectRoot: root,
    revision: 1, stage: "admin-password-hash-verified", attemptedActions: [], data: {} };
  let key: string | null = null;
  let enabled = false;
  let installed: string | null = null;
  let failLogin = false;
  let loseWrite = false;
  let writes = 0;
  const commands: SetupContainerCommand[] = [];
  async function update(next: SetupCheckpointUpdate) {
    assert.equal(next.expectedRevision, cp?.revision ?? null);
    cp = { schemaVersion: 1, appId: "freshrss", projectRoot: root, revision: (cp?.revision ?? 0) + 1,
      stage: next.stage, attemptedActions: cp?.attemptedActions ?? [], data: { ...cp?.data, ...next.data } };
    return cp;
  }
  const context = {
    appId: "freshrss", projectRoot: root, inputs: {}, installedAppIds: ["freshrss"],
    async status() { return { command: "app status", appId: "freshrss", projectRoot: root,
      ownerKind: "shared", mutation: false, status: "applied", runtime: { state: "running" },
      username: "admin", passwordFile: `${privateFiles}/admin-password`, privateFiles }; },
    checkpoint: { async read() { return cp; }, compareAndSet: update },
    secrets: { async readAdminPassword() { return "p".repeat(48); }, async readApiKey() { return key; },
      async apiKeyPath() { if (key === null) return null; return `${privateFiles}/freshrss-api-key`; },
      async writeApiKey(value: string) { assert.equal(key, null); key = value; return `${privateFiles}/freshrss-api-key`; } },
    container: { async exec(command: SetupContainerCommand) {
      commands.push(command);
      if (command.effect === "write") {
        assert.ok(command.beforeSendCheckpoint);
        assert.ok(command.approval.once);
        assert.ok(key, "Durable password must be saved before writes");
        assert.equal(command.argv.join(" ").includes(key!), false);
        await update(command.beforeSendCheckpoint);
        cp!.attemptedActions.push(command.approval.action);
        writes++;
        if (command.approval.action === "freshrss-enable-api") enabled = true;
        else {
          assert.equal(command.approval.action, "freshrss-set-api-password");
          assert.equal(command.stdin, key);
          assert.match(command.argv[2]!, /cliInitUser\('admin'\)/);
          assert.match(command.argv[2]!, /FreshRSS_api_Controller::updatePassword/);
          if (loseWrite) throw new Error("Synthetic uncertain API password write");
          installed = command.stdin!;
        }
        return { exitCode: 0, stdout: "" };
      }
      let value: unknown;
      if (command.approval.action === "freshrss-inspect-api-password") {
        value = { enabled, empty: installed === null, match: installed !== null && installed === command.stdin };
      } else if (command.approval.action === "freshrss-inspect-user") {
        value = [{ user: "admin", default: true, enabled: true }];
      } else {
        value = { marker: true, config: true, home: true, userConfig: true, users: ["admin"],
          defaultUser: "admin", authType: "form", hashState: "match" };
      }
      return { exitCode: 0, stdout: JSON.stringify(value) };
    } },
    http: { async request(request: SetupHttpRequest) {
      let body: string;
      if (request.method === "POST") {
        assert.equal(request.path, "/api/greader.php/accounts/ClientLogin");
        assert.equal(new URLSearchParams(String(request.body)).get("Passwd"), key);
        assert.equal(request.query, undefined);
        assert.ok(request.approval);
        if (failLogin) throw new Error("Synthetic interrupted login");
        body = `SID=${auth}\nAuth=${auth}\n`;
      } else {
        assert.equal(request.path, "/api/greader.php/reader/api/0/user-info");
        assert.equal(request.headers?.Authorization, `GoogleLogin auth=${auth}`);
        body = JSON.stringify({ userId: "admin", userName: "admin", userProfileId: "admin" });
      }
      return { status: 200, async text() { return body; }, async json() { return JSON.parse(body); } };
    } },
  } as unknown as SetupContext;
  return { context, commands, get cp() { return cp; }, get key() { return key; }, get writes() { return writes; },
    dropKey() { key = null; }, foreign() { installed = "foreign"; },
    failLogin(value: boolean) { failLogin = value; }, loseWrite() { loseWrite = true; } };
}
const fresh = fixture();
const result = await adapter.firstRun(fresh.context);
assert.equal(result.apiCredentialKind, "api-password");
assert.equal(adapter.ready(result), true);
assert.equal(result.apiKeyExpires, null);
assert.match(fresh.key!, /^[a-f0-9]{64}$/);
assert.equal(fresh.writes, 2);
await adapter.firstRun(fresh.context);
assert.equal(fresh.writes, 2, "Replay must only reverify");
assert.equal(JSON.stringify(fresh.cp).includes(auth), false);
assert.equal(JSON.stringify(result).includes(fresh.key!), false);
fresh.dropKey();
await assert.rejects(adapter.firstRun(fresh.context), /missing or inconsistent/);
assert.equal(fresh.writes, 2);
const foreign = fixture();
foreign.foreign();
await assert.rejects(adapter.firstRun(foreign.context), /foreign API password/);
assert.equal(foreign.key, null);
assert.equal(foreign.writes, 0);
const interrupted = fixture();
interrupted.failLogin(true);
await assert.rejects(adapter.firstRun(interrupted.context), /interrupted login/);
const preserved = interrupted.key;
interrupted.failLogin(false);
await adapter.firstRun(interrupted.context);
assert.equal(interrupted.key, preserved);
assert.equal(interrupted.writes, 2);
const uncertain = fixture();
uncertain.loseWrite();
await assert.rejects(adapter.firstRun(uncertain.context), /uncertain API password write/);
await assert.rejects(adapter.firstRun(uncertain.context), /do not replay/);
assert.equal(uncertain.writes, 2);
console.log("FreshRSS independent durable API password synthetic fixture passed");
