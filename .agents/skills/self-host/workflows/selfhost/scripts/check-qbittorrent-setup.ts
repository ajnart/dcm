import assert from "node:assert/strict";
import adapter from "../references/catalog/apps/qbittorrent/setup.ts";
import type {
  SetupCheckpoint,
  SetupContext,
  SetupHttpRequest,
  SetupHttpResponse,
  SetupInspectionContext,
} from "../references/catalog/types/setup.ts";

const root = "/tmp/qbittorrent-setup-fixture";
const passwordFile = `${root}/secrets/admin-password`;
const privateFiles = `${root}/secrets`;
const managedValue = "fixture-only-managed-password-with-enough-length";
const temporaryValue = "fixture-only-temporary-password";
const apiKey = `qbt_${"A".repeat(28)}`;

function response(status: number, body: unknown, cookie?: string): SetupHttpResponse {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name) { return name === "set-cookie" ? cookie ?? null : null; } },
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); } };
}

function fixture(options: { managed?: boolean; key?: string; loseSetResponse?: boolean;
  loseRotateResponse?: boolean; temporaryAvailable?: boolean; expireAfterSet?: boolean;
  anonymousAccess?: boolean; acceptWrongKey?: boolean; bypass?: boolean } = {}) {
  let managed = options.managed ?? false;
  let key = options.key ?? "";
  let savedKey: string | null = null;
  let checkpoint: SetupCheckpoint | null = null;
  let savePath = managed ? "/data/torrents" : "/downloads";
  let tempPath = managed ? "/data/torrents/incomplete" : "/incomplete";
  let tempEnabled = managed;
  let loseSetResponse = options.loseSetResponse ?? false;
  let loseRotateResponse = options.loseRotateResponse ?? false;
  let temporaryAvailable = options.temporaryAvailable ?? true;
  let logReads = 0;
  let setWrites = 0;
  let rotations = 0;
  let sessionCookies: Record<string, string> = {};
  let expiredSession = false;
  let bypass = options.bypass ?? false;
  const paths: string[] = [];
  const status = { command: "app status", appId: "qbittorrent", projectRoot: root,
    status: "applied", mutation: false, runtime: { state: "running" },
    username: "admin", port: 8080, url: "http://127.0.0.1:8080", passwordFile, privateFiles };

  const context = {
    appId: "qbittorrent", projectRoot: root,
    async status() { return status; },
    checkpoint: {
      async read() { return checkpoint; },
      async compareAndSet(next: { expectedRevision: number | null; stage: string;
        data?: Record<string, string> }) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "qbittorrent", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
          attemptedActions: checkpoint?.attemptedActions ?? [], data: next.data ?? {} };
        return checkpoint;
      },
    },
    secrets: {
      async readSessionCookies() { return { ...sessionCookies }; },
      async writeSessionCookies(value: Record<string, string>) { sessionCookies = { ...value }; },
      async readAdminPassword() { return managedValue; },
      async readQbittorrentTemporaryPassword() { logReads += 1; return temporaryValue; },
      async readApiKey() { return savedKey; },
      async apiKeyPath() { return savedKey === null ? null : `${privateFiles}/qbittorrent-api-key`; },
      async writeApiKey(value: string) { savedKey = value; return `${privateFiles}/qbittorrent-api-key`; },
    },
    http: { async request(request: SetupHttpRequest): Promise<SetupHttpResponse> {
      paths.push(`${request.method} ${request.path}`);
      assert.equal(request.headers?.Origin, status.url);
      assert.equal(request.headers?.Referer, `${status.url}/`);
      if (request.path === "/api/v2/auth/login") {
        assert.equal(request.method, "POST");
        const values = new URLSearchParams(request.body as string);
        assert.equal(values.get("username"), "admin");
        const allowed = (managed && values.get("password") === managedValue)
          || (!managed && temporaryAvailable && values.get("password") === temporaryValue);
        if (allowed) expiredSession = false;
        return response(allowed ? 204 : 401, allowed ? "" : "Unauthorized", allowed
          ? "QBT_SID_8080=fixture-session; Path=/; HttpOnly" : undefined);
      }
      const authorized = (!expiredSession && request.headers?.Cookie === "QBT_SID_8080=fixture-session")
        || (key !== "" && request.headers?.Authorization === `Bearer ${key}`)
        || (options.anonymousAccess === true && !request.headers?.Authorization)
        || (options.acceptWrongKey === true && !!request.headers?.Authorization);
      if (!authorized) return response(403, "Forbidden");
      if (request.path === "/api/v2/app/version") return response(200, "v5.2.3");
      if (request.path === "/api/v2/app/preferences") {
        return response(200, { web_ui_username: "admin", save_path: savePath,
          temp_path: tempPath, temp_path_enabled: tempEnabled, web_ui_api_key: key,
          bypass_local_auth: bypass, bypass_auth_subnet_whitelist_enabled: bypass });
      }
      if (request.path === "/api/v2/app/setPreferences") {
        setWrites += 1;
        assert.equal(request.approval?.once, true);
        assert.equal(request.beforeSendCheckpoint?.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "qbittorrent", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: "identity-update-attempted",
          attemptedActions: ["qbittorrent-set-managed-auth"],
          data: request.beforeSendCheckpoint?.data ?? {} };
        const prefs = JSON.parse(new URLSearchParams(request.body as string).get("json") ?? "{}");
        assert.equal(prefs.web_ui_password, managedValue);
        assert.equal(prefs.bypass_local_auth, false);
        assert.equal(prefs.bypass_auth_subnet_whitelist_enabled, false);
        managed = true;
        savePath = prefs.save_path;
        tempPath = prefs.temp_path;
        tempEnabled = prefs.temp_path_enabled;
        bypass = false;
        expiredSession = options.expireAfterSet ?? false;
        if (loseSetResponse) throw new Error("Local setup request outcome is unknown");
        return response(200, "");
      }
      if (request.path === "/api/v2/app/rotateAPIKey") {
        rotations += 1;
        assert.equal(request.approval?.once, true);
        assert.equal(request.beforeSendCheckpoint?.expectedRevision, checkpoint?.revision ?? null);
        checkpoint = { schemaVersion: 1, appId: "qbittorrent", projectRoot: root,
          revision: (checkpoint?.revision ?? 0) + 1, stage: "api-key-create-attempted",
          attemptedActions: [...(checkpoint?.attemptedActions ?? []), "qbittorrent-create-api-key"],
          data: request.beforeSendCheckpoint?.data ?? {} };
        key = apiKey;
        if (loseRotateResponse) throw new Error("Local setup request outcome is unknown");
        return response(200, { apiKey: key });
      }
      throw new Error(`Unexpected qBittorrent fixture route ${request.path}`);
    } },
  } as unknown as SetupContext;
  return { context, paths, get state() { return { checkpoint, savedKey, logReads, setWrites, rotations }; },
    resolveSet() { loseSetResponse = false; }, resolveRotate() { loseRotateResponse = false; },
    expireSession() { expiredSession = true; },
    changeRuntime() { status.runtime.state = "stopped"; },
    removeTemporary() { temporaryAvailable = false; } };
}

const fresh = fixture();
assert.equal(adapter.ready(await adapter.firstRun(fresh.context)), true);
assert.deepEqual(fresh.state, { checkpoint: fresh.state.checkpoint, savedKey: apiKey,
  logReads: 1, setWrites: 1, rotations: 1 });
assert.equal(fresh.state.checkpoint?.stage, "login-and-api-verified");
assert.equal(adapter.ready(await adapter.inspect!(fresh.context as unknown as SetupInspectionContext)), true);
assert.equal(adapter.ready(await adapter.firstRun(fresh.context)), true);
assert.equal(fresh.state.logReads, 1);
assert.equal(fresh.state.setWrites, 1);
assert.equal(fresh.state.rotations, 1);

const existingKey = fixture({ managed: true, key: apiKey });
assert.equal(adapter.ready(await adapter.firstRun(existingKey.context)), true);
assert.equal(existingKey.state.logReads, 0);
assert.equal(existingKey.state.setWrites, 0);
assert.equal(existingKey.state.rotations, 0);

const lostSet = fixture({ loseSetResponse: true, expireAfterSet: true });
await assert.rejects(adapter.firstRun(lostSet.context), /outcome is unknown/);
assert.equal(lostSet.state.checkpoint?.stage, "identity-update-attempted");
lostSet.resolveSet();
assert.equal(adapter.ready(await adapter.firstRun(lostSet.context)), true);
assert.equal(lostSet.state.setWrites, 1);

const lostRotate = fixture({ managed: true, loseRotateResponse: true });
await assert.rejects(adapter.firstRun(lostRotate.context), /outcome is unknown/);
assert.equal(lostRotate.state.checkpoint?.stage, "api-key-create-attempted");
lostRotate.resolveRotate();
assert.equal(adapter.ready(await adapter.firstRun(lostRotate.context)), true);
assert.equal(lostRotate.state.rotations, 1);

const noTemporary = fixture({ temporaryAvailable: false });
await assert.rejects(adapter.firstRun(noTemporary.context), /rejected its current-start temporary password/);
assert.equal(noTemporary.state.setWrites, 0);

fresh.expireSession();
assert.equal(adapter.ready(await adapter.firstRun(fresh.context)), true);
assert.equal(fresh.state.setWrites, 1);
assert.equal(fresh.state.rotations, 1);

const anonymous = fixture({ anonymousAccess: true });
await assert.rejects(adapter.firstRun(anonymous.context), /did not reject untrusted access/);
assert.equal(anonymous.state.logReads, 0);
assert.equal(anonymous.state.setWrites, 0);

const wrongKey = fixture({ managed: true, key: apiKey, acceptWrongKey: true });
await assert.rejects(adapter.firstRun(wrongKey.context), /did not reject untrusted access/);
assert.equal(wrongKey.state.rotations, 0);

const bypass = fixture({ managed: true, key: apiKey, bypass: true });
await assert.rejects(adapter.firstRun(bypass.context), /differ from the managed setup/);
assert.equal(bypass.state.setWrites, 0);

fresh.changeRuntime();
await assert.rejects(adapter.firstRun(fresh.context), /no running, exact saved administrator project/);

process.stdout.write("qBittorrent fresh, resume, expired-session, auth-rejection, and no-replay setup checks passed\n");
