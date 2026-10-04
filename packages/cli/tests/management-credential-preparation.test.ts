import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import recipe from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/portainer/recipe.json";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/portainer/setup.ts";
import { prepareRemoteWatcher } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/wud/remote-watcher.ts";
import type { SetupCheckpoint, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { prepareSharedProjectFiles, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const choice = { serverName: "docker.private.example", port: 2376,
  caFileId: "docker-ca", certificateFileId: "docker-client-certificate", keyFileId: "docker-client-key" };
const watcher = prepareRemoteWatcher(choice);
assert.equal(watcher.deployable, false);
assert.equal(watcher.connectionVerified, false);
assert.equal(watcher.authorizationVerified, false);
assert.equal(watcher.environment.some((entry) => /SOCKET|SKIP|TRIGGER/.test(entry.name)), false);
assert.deepEqual(watcher.environment.slice(0, 2), [
  { name: "WUD_WATCHER_DOCKER_APPROVED_HOST", value: choice.serverName },
  { name: "WUD_WATCHER_DOCKER_APPROVED_PORT", value: "2376" }
]);
for (const serverName of ["tcp://10.0.0.2", "10.0.0.2", "docker", "user@docker.example", "/var/run/docker.sock", "Docker.example"]) {
  assert.throws(() => prepareRemoteWatcher({ ...choice, serverName }), /TLS DNS name/);
}
assert.throws(() => prepareRemoteWatcher({ ...choice, keyFileId: choice.caFileId }), /distinct/);
assert.throws(() => prepareRemoteWatcher({ ...choice, verified: true } as typeof choice), /exact/);

const root = await mkdtemp(join(tmpdir(), "selfhost-management-preparation-"));
try {
  const selection = { appId: "portainer", recipe, port: 19000,
    images: { portainer: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` } };
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId: "management-fixture",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [selection],
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  assert.equal((await createSelfhostComposeOwner(candidate.manifest).plan()).status, "pass");
  for (const forbidden of ["--admin-password-file=plaintext", "--admin-password-file=/run/secrets/undeclared",
    "--admin-password=plaintext", "--token=/run/secrets/admin-bootstrap"]) {
    const changed = structuredClone(candidate.manifest);
    changed.services[0].command = [forbidden];
    await assert.rejects(createSelfhostComposeOwner(changed).plan());
  }
  const service = candidate.manifest.services[0];
  assert.equal(service.ports[0].hostIp, "127.0.0.1");
  assert.equal(service.ports[0].target, 9000);
  assert.deepEqual(service.command, ["--http-enabled", "--bind", ":9000", "--admin-password-file=/run/secrets/admin-bootstrap"]);
  assert.equal(JSON.stringify(service).includes("docker.sock"), false);
  assert.equal(service.command.some((arg) => /--host|--tls/.test(arg)), false);
  await mkdir(join(root, ".selfhost", "shared"), { recursive: true, mode: 0o700 });
  await prepareSharedProjectFiles(candidate, [selection]);
  const privateFiles = join(candidate.projectDirectory, "secrets", "portainer");
  const passwordFile = join(privateFiles, "admin-password");
  const password = await readFile(passwordFile, "utf8");
  assert.equal((await lstat(passwordFile)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(privateFiles, "admin-bootstrap"))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(privateFiles, "admin-bootstrap"), "utf8"), password);
  assert.equal(password.length <= 72, true);
  await prepareSharedProjectFiles(candidate, [selection]);
  assert.equal(await readFile(passwordFile, "utf8"), password);

  const rawKey = `ptr_${Buffer.alloc(32, 7).toString("base64")}`;
  const jwt = "a".repeat(32) + "." + "b".repeat(32) + "." + "c".repeat(32);
  const token = { id: 2, userId: 1, description: "Auto-Stack administrator", prefix: rawKey.slice(0, 7) };
  const apiKeyFile = join(privateFiles, "portainer-api-key");
  function fixture() {
    let checkpoint: SetupCheckpoint | null = null;
    let session: Record<string, string> = {};
    let savedKey: string | null = null;
    let savedPath: string | null = null;
    let inventory: unknown[] = [];
    let creates = 0;
    let logins = 0;
    let passwordAccepted = true;
    let freshStatus = 200;
    let freshRole = 1;
    let freshJwt = jwt;
    let deferCreate = false;
    let loseCreate = false;
    let loseVerify = false;
    const attempts: unknown[] = [];
    const admin = { Id: 1, Username: "admin", Role: 1, forceChangePassword: false };
    function response(body: unknown, status = 200) {
      return { status, ok: status === 200, async json() { return body; } };
    }
    const context = { appId: "portainer", projectRoot: root, installedAppIds: ["portainer"], inputs: {},
      async status() { return { command: "app status", appId: "portainer", projectRoot: root,
        ownerKind: "shared", status: "applied", mutation: false, runtime: { state: "running" }, privateFiles, passwordFile }; },
      checkpoint: { async read() { return checkpoint; }, async compareAndSet(next) {
        assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
        const actions = checkpoint?.attemptedActions ?? [];
        checkpoint = { schemaVersion: 1, appId: "portainer", projectRoot: root, revision: (checkpoint?.revision ?? 0) + 1,
          stage: next.stage, attemptedActions: actions, data: next.data ?? {} };
        return checkpoint;
      } },
      secrets: { async readAdminPassword() { return password; }, async readApiKey() { return savedKey; },
        async apiKeyPath() { return savedPath; }, async writeApiKey(value) { savedKey = value; savedPath = apiKeyFile; return apiKeyFile; },
        async readSessionCookies() { return session; }, async writeSessionCookies(value) { session = value; } },
      http: { async request(request) {
        if (request.path === "/api/system/status") return response({ Version: "2.45.1" });
        if (request.path === "/api/endpoints") return response([]);
        if (request.path === "/api/auth") {
          assert.equal(request.approval.action, "portainer-verify-admin");
          assert.deepEqual(JSON.parse(request.body), { Username: "admin", Password: password });
          logins += 1;
          freshJwt = `${jwt}.${logins}`;
          if (!passwordAccepted) return response({}, 401);
          return response({ jwt: freshJwt });
        }
        if (request.path === "/api/users/me") {
          if (request.headers["X-API-Key"]) {
            assert.equal(savedKey, rawKey); // capture first
            assert.equal(request.approval.action, "portainer-verify-api-key");
            if (loseVerify) { loseVerify = false; throw new Error("readback unavailable"); }
          }
          if (request.headers.Authorization === `Bearer ${freshJwt}`
            && request.headers.Authorization !== `Bearer ${session.jwt}`) {
            return response({ ...admin, Role: freshRole }, freshStatus);
          }
          return response(admin);
        }
        if (request.path === "/api/users/1/tokens" && request.method === "GET") return response(inventory);
        if (request.path === "/api/users/1/tokens" && request.method === "POST") {
          attempts.push(structuredClone(request));
          if (deferCreate) { deferCreate = false; throw new Error("approval required"); }
          const next = request.beforeSendCheckpoint;
          assert.equal(next.expectedRevision, null);
          assert.equal(checkpoint, null);
          checkpoint = { schemaVersion: 1, appId: "portainer", projectRoot: root, revision: 1,
            stage: next.stage, data: next.data, attemptedActions: [request.approval.action] };
          inventory = [token];
          creates += 1;
          if (loseCreate) throw new Error("response lost");
          return response({ rawAPIKey: rawKey, apiKey: { ...token, digest: createHash("sha256").update(rawKey).digest("base64") } });
        }
        throw new Error("Unexpected Portainer endpoint");
      } }
    } as unknown as SetupContext;
    return { context, attempts, get creates() { return creates; }, get logins() { return logins; },
      defer() { deferCreate = true; }, loseCreate() { loseCreate = true; }, loseVerify() { loseVerify = true; },
      rejectPassword() { passwordAccepted = false; }, rejectFresh(status: number) { freshStatus = status; },
      changeFreshOwner() { freshRole = 2; },
      changeRole() { admin.Role = 2; }, clearKey() { savedKey = null; savedPath = null; } };
  }

  const happy = fixture();
  happy.defer();
  await assert.rejects(adapter.firstRun(happy.context), /approval required/);
  const first = await adapter.firstRun(happy.context);
  assert.deepEqual(happy.attempts[0], happy.attempts[1]); // stable private session and request across approval
  assert.equal(happy.logins, 2);
  assert.equal(first.loginVerified, true);
  assert.equal(first.apiKeyVerified, true);
  assert.equal(first.connectionVerified, false);
  assert.equal(first.stage, "docker-endpoint-required");
  assert.equal(adapter.ready(first), false);
  assert.equal(adapter.ready({ ...first, connectionVerified: true, dockerAuthorityVerified: true }), false);
  assert.equal(JSON.stringify(first).includes(rawKey), false);
  assert.equal(JSON.stringify(first).includes(password), false);
  assert.equal((await adapter.inspect!(happy.context)).loginVerified, false);
  await adapter.firstRun(happy.context);
  assert.equal(happy.logins, 3);
  assert.equal(happy.creates, 1);
  happy.changeRole();
  await assert.rejects(adapter.firstRun(happy.context), /identity differs/);

  const rejectedPassword = fixture();
  rejectedPassword.defer();
  await assert.rejects(adapter.firstRun(rejectedPassword.context), /approval required/);
  const retained = { ...await rejectedPassword.context.secrets.readSessionCookies() };
  rejectedPassword.rejectPassword();
  await assert.rejects(adapter.firstRun(rejectedPassword.context), /password was not accepted/);
  assert.deepEqual(await rejectedPassword.context.secrets.readSessionCookies(), retained);
  assert.equal(rejectedPassword.creates, 0);
  for (const status of [401, 500]) {
    const freshRejected = fixture();
    freshRejected.defer();
    await assert.rejects(adapter.firstRun(freshRejected.context), /approval required/);
    const saved = { ...await freshRejected.context.secrets.readSessionCookies() };
    freshRejected.rejectFresh(status);
    await assert.rejects(adapter.firstRun(freshRejected.context), /could not be verified/);
    assert.deepEqual(await freshRejected.context.secrets.readSessionCookies(), saved);
    assert.equal(freshRejected.creates, 0);
  }
  const otherFreshOwner = fixture();
  otherFreshOwner.defer();
  await assert.rejects(adapter.firstRun(otherFreshOwner.context), /approval required/);
  const sameSession = { ...await otherFreshOwner.context.secrets.readSessionCookies() };
  otherFreshOwner.changeFreshOwner();
  await assert.rejects(adapter.firstRun(otherFreshOwner.context), /identity or password policy differs/);
  assert.deepEqual(await otherFreshOwner.context.secrets.readSessionCookies(), sameSession);
  assert.equal(otherFreshOwner.creates, 0);

  const uncertain = fixture();
  uncertain.loseCreate();
  await assert.rejects(adapter.firstRun(uncertain.context), /response lost/);
  await assert.rejects(adapter.firstRun(uncertain.context), /missing or differs/);
  assert.equal(uncertain.creates, 1);

  const readback = fixture();
  readback.loseVerify();
  await assert.rejects(adapter.firstRun(readback.context), /readback unavailable/);
  await adapter.firstRun(readback.context);
  assert.equal(readback.creates, 1);
  readback.clearKey();
  await assert.rejects(adapter.firstRun(readback.context), /missing or differs/);
  assert.equal(readback.creates, 1);
} finally {
  await rm(root, { recursive: true });
}
console.log("Portainer disconnected credential preparation and WUD non-executable TLS settings: pass");
