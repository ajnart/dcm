import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-setup-query-"));
const seen: string[] = [];
const server = createServer((request, response) => {
  seen.push(request.url ?? "");
  if (request.url === "/Startup/Uncertain") {
    request.socket.destroy();
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end("{}\n");
});

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const projectId = "query-test";
  const appDirectory = join(root, ".selfhost", "apps", projectId);
  const privateFiles = join(appDirectory, "secrets");
  await mkdir(privateFiles, { recursive: true, mode: 0o700 });
  const approvals: string[] = [];
  const facilities = createSetupTransportFacilities({
    appId: "jellyfin", projectRoot: root,
    async readStatus() {
      return { command: "app status", appId: "jellyfin", projectRoot: root,
        status: "applied", mutation: false, runtime: { state: "running" },
        projectId, port: address.port, dockerContext: "default",
        composeTarget: join(appDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
        applyApproval: `APP-APPLY:jellyfin:${"a".repeat(64)}`,
        url: `http://127.0.0.1:${address.port}`,
        privateFiles, passwordFile: join(privateFiles, "admin-password") };
    },
    async readHandoff() { throw new Error("Unexpected handoff read"); },
    async approve(_action, token, progress) {
      approvals.push(token);
      if (progress.includes("/Auth/Keys")) {
        assert.match(progress, /query: app/);
        assert.doesNotMatch(progress, /Selfhost Setup/);
      }
      return true;
    },
    approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; },
  });
  const read = await facilities.http.request({ method: "GET", path: "/Library/VirtualFolders",
    query: { paths: "/data/media/movies", name: "Movie Night" } });
  assert.equal(read.status, 200);
  assert.equal(seen[0], "/Library/VirtualFolders?name=Movie+Night&paths=%2Fdata%2Fmedia%2Fmovies");

  const write = await facilities.http.request({ method: "POST", path: "/Auth/Keys",
    query: { app: "Selfhost Setup" }, approval: { action: "create-key", progress: "Create the Jellyfin key" } });
  assert.equal(write.status, 200);
  assert.equal(seen[1], "/Auth/Keys?app=Selfhost+Setup");
  assert.match(approvals[0] ?? "", /^APP-SETUP-CREATE-KEY:jellyfin:[a-f0-9]{64}$/);

  const initialize = { method: "GET" as const, path: "/Startup/User",
    approval: { action: "initialize-user", progress: "Initialize the first user", once: true },
    beforeSendCheckpoint: { expectedRevision: null, stage: "user-initialization-attempted" } };
  assert.equal((await facilities.http.request(initialize)).status, 200);
  assert.equal(seen[2], "/Startup/User");
  await assert.rejects(facilities.http.request(initialize), /already attempted/);
  assert.equal((await facilities.checkpoint.read())?.stage, "user-initialization-attempted");
  const uncertain = { method: "GET" as const, path: "/Startup/Uncertain",
    approval: { action: "uncertain-startup", progress: "Check uncertain first-run behavior", once: true },
    beforeSendCheckpoint: { expectedRevision: 1, stage: "uncertain-startup-attempted" } };
  await assert.rejects(facilities.http.request(uncertain), /outcome is unknown/);
  await assert.rejects(facilities.http.request(uncertain), /already attempted/);

  await assert.rejects(facilities.http.request({ method: "GET", path: "/Auth/Keys?app=raw" }), /fixed path/);
  await assert.rejects(facilities.http.request({ method: "GET", path: "/Auth/Keys",
    query: { api_key: "secret" } }), /unsafe parameter/);
  await assert.rejects(facilities.http.request({ method: "GET", path: "/Auth/Keys",
    query: { app: "bad\nvalue" } }), /unsafe parameter/);
  await assert.rejects(facilities.http.request({ method: "HEAD", path: "/Startup/User",
    approval: { action: "initialize-user", progress: "Unsafe HEAD" } }), /side-effecting HEAD/);
  assert.equal(seen.length, 4);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true });
}

process.stdout.write("setup query checks passed\n");
