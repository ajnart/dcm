import assert from "node:assert/strict";
import adapter from "../references/catalog/apps/nextcloud/setup.ts";
import type {
  SetupCheckpoint,
  SetupContext,
  SetupHttpRequest,
  SetupHttpResponse,
  SetupInspectionContext,
} from "../references/catalog/types/setup.ts";

const root = "/tmp/nextcloud-setup-fixture";
const passwordFile = `${root}/secrets/admin-password`;
const status = { command: "app status", appId: "nextcloud", projectRoot: root,
  status: "applied", mutation: false, runtime: { state: "running" },
  username: "admin", passwordFile, url: "http://127.0.0.1:18080" };
let installed = true;
let authenticated = true;
let administrator = true;
let writeFails = false;
let writeResponseLost = false;
let checkpoint: SetupCheckpoint | null = null;
let probeBody: string | null = null;
let writes = 0;
const paths: string[] = [];

function response(statusCode: number, body: unknown): SetupHttpResponse {
  return { status: statusCode, ok: statusCode >= 200 && statusCode < 300,
    headers: { get() { return null; } },
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); } };
}

const context = {
  appId: "nextcloud", projectRoot: root,
  async status() { return status; },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(next: { expectedRevision: number | null; stage: string; data?: Record<string, string> }) {
      assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId: "nextcloud", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
        attemptedActions: checkpoint?.attemptedActions ?? [], data: next.data ?? {} };
      return checkpoint;
    },
  },
  http: { async request(request: SetupHttpRequest): Promise<SetupHttpResponse> {
    paths.push(`${request.method} ${request.path}`);
    if (request.path === "/status.php") {
      assert.equal(request.method, "GET");
      return response(200, { installed, maintenance: false, needsDbUpgrade: false,
        versionstring: "35.0.1" });
    }
    if (request.path === "/ocs/v1.php/cloud/capabilities") {
      assert.equal(request.method, "GET");
      assert.equal(request.headers?.["OCS-APIRequest"], "true");
      assert.equal(request.headers?.Accept, "application/json");
      assert.match(request.headers?.Authorization ?? "", /^Basic /);
      return response(200, { ocs: { meta: { statuscode: 100 },
        data: { version: { string: "35.0.1" } } } });
    }
    if (request.path === "/ocs/v1.php/cloud/users") {
      assert.equal(request.method, "GET");
      assert.equal(request.headers?.["OCS-APIRequest"], "true");
      assert.equal(request.headers?.Accept, "application/json");
      assert.match(request.headers?.Authorization ?? "", /^Basic /);
      return response(authenticated ? 200 : 401, { ocs: {
        meta: { statuscode: authenticated && administrator ? 100 : 997 },
        data: { users: authenticated && administrator ? ["admin"] : [] },
      } });
    }
    assert.match(request.path, /^\/remote\.php\/dav\/files\/admin\/\.selfhost-webdav-[0-9a-f]{32}\.txt$/);
    assert.match(request.headers?.Authorization ?? "", /^Basic /);
    if (request.method === "PUT") {
      writes += 1;
      assert.equal(request.headers?.["If-None-Match"], "*");
      assert.equal(request.approval?.once, true);
      assert.equal(request.approval?.action, "nextcloud-webdav-probe");
      assert.equal(request.beforeSendCheckpoint?.expectedRevision, checkpoint?.revision);
      checkpoint = { schemaVersion: 1, appId: "nextcloud", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: "webdav-put-attempted",
        attemptedActions: ["nextcloud-webdav-probe"], data: request.beforeSendCheckpoint?.data ?? {} };
      if (writeFails) throw new Error("Local setup request outcome is unknown; inspect its saved checkpoint before retrying");
      assert.equal(typeof request.body, "string");
      probeBody = request.body as string;
      if (writeResponseLost) throw new Error("Local setup request outcome is unknown; inspect its saved checkpoint before retrying");
      return response(201, "");
    }
    assert.equal(request.method, "GET");
    if (probeBody === null) return response(404, "");
    return response(200, probeBody);
  } },
  secrets: { async readAdminPassword() { return "fixture-only-password"; } },
} as unknown as SetupContext;

const first = await adapter.firstRun(context);
assert.equal(adapter.ready(first), true);
assert.equal(first.credentialRef, passwordFile);
assert.equal(writes, 1);
assert.equal(checkpoint?.stage, "webdav-probe-verified");
assert.deepEqual(paths.map((path) => path.split(" ")[0]), ["GET", "GET", "GET", "PUT", "GET"]);

paths.length = 0;
const resumed = await adapter.firstRun(context);
assert.equal(adapter.ready(resumed), true);
assert.equal(writes, 1);
assert.deepEqual(paths.map((path) => path.split(" ")[0]), ["GET", "GET", "GET", "GET"]);
const inspected = await adapter.inspect!(context as unknown as SetupInspectionContext);
assert.equal(adapter.ready(inspected), true);
assert.equal(writes, 1);

probeBody = "modified-by-someone-else";
await assert.rejects(adapter.inspect!(context as unknown as SetupInspectionContext), /did not match/);
assert.equal(writes, 1);

checkpoint = null;
probeBody = null;
writeFails = true;
await assert.rejects(adapter.firstRun(context), /outcome is unknown/);
assert.equal(checkpoint?.stage, "webdav-put-attempted");
await assert.rejects(adapter.firstRun(context), /did not match/);
assert.equal(writes, 2);

checkpoint = null;
probeBody = null;
writeFails = false;
writeResponseLost = true;
await assert.rejects(adapter.firstRun(context), /outcome is unknown/);
assert.equal(checkpoint?.stage, "webdav-put-attempted");
writeResponseLost = false;
assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(writes, 3);

installed = false;
await assert.rejects(adapter.firstRun(context), /not an installed/);
installed = true;
authenticated = false;
await assert.rejects(adapter.firstRun(context), /cloud\/users did not return HTTP 200/);
authenticated = true;
administrator = false;
await assert.rejects(adapter.firstRun(context), /administrator credential did not pass/);
process.stdout.write("nextcloud OCS, WebDAV, checkpoint, and no-replay checks passed\n");
