import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import frigate from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/frigate/setup.ts";
import type { SetupCheckpoint, SetupCheckpointUpdate, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { multiServiceManifest } from "../src/lib/multi-service-recipe.ts";

const root = "/tmp/frigate-source-fixture";
const passwordFile = `${root}/secrets/admin-password`;
const temporary = "a".repeat(32);
const password = "b".repeat(48);
function fixture() {
  const state = { checkpoint: null as SetupCheckpoint | null, sessions: {} as Record<string, string>,
    currentPassword: temporary, bootstrapReads: 0, bootstrapLogins: 0, rotations: 0, savedLogins: 0,
    deferred: false, loseRotation: false, persistRotation: true, anonymousStatus: 401, role: "admin",
    profileStatus: 200, loseProfile: false, cookies: new Map<string, string>(), rotationApprovals: [] as string[] };
  function update(next: SetupCheckpointUpdate, action?: string): SetupCheckpoint {
    assert.equal(next.expectedRevision, state.checkpoint?.revision ?? null);
    const actions = [...(state.checkpoint?.attemptedActions ?? [])];
    if (action) { assert.ok(!actions.includes(action)); actions.push(action); }
    state.checkpoint = { schemaVersion: 1, appId: "frigate", projectRoot: root,
      revision: (state.checkpoint?.revision ?? 0) + 1, stage: next.stage, data: next.data ?? {}, attemptedActions: actions };
    return state.checkpoint;
  }
  function response(value: unknown, status = 200, setCookie: string | null = null, text = JSON.stringify(value)) {
    return { status, ok: status >= 200 && status < 300, headers: { get() { return setCookie; } },
      async json() { return value; }, async text() { return text; } };
  }
  const context = { appId: "frigate", projectRoot: root, inputs: {},
    async status() { return { command: "app status", appId: "frigate", projectRoot: root,
      status: "applied", mutation: false, username: "admin", passwordFile, runtime: { state: "running" } }; },
    checkpoint: { async read() { return state.checkpoint; }, async compareAndSet(next: SetupCheckpointUpdate) { return update(next); } },
    secrets: { async readAdminPassword() { return password; }, async readBootstrapPassword() { state.bootstrapReads++; return temporary; },
      async readSessionCookies() { return { ...state.sessions }; }, async writeSessionCookies(value: Record<string, string>) { state.sessions = { ...value }; } },
    http: { async request(request: SetupHttpRequest) {
      if (request.path === "/api/version") {
        assert.ok(state.cookies.has(request.headers?.Cookie ?? ""));
        return response({}, 200, null, "0.18.0-pinnedbuild");
      }
      if (request.path === "/api/profile") {
        const header = request.headers?.Cookie;
        if (!header) return response({}, state.anonymousStatus);
        if (state.loseProfile) throw new Error("identity read uncertain");
        if (state.profileStatus !== 200) return response({}, state.profileStatus);
        assert.ok(state.cookies.has(header));
        return response({ username: "admin", role: state.role, allowed_cameras: [] });
      }
      if (request.path === "/api/login") {
        assert.equal(request.method, "POST"); assert.ok(request.approval);
        const body = JSON.parse(request.body as string);
        assert.equal(body.user, "admin");
        if (body.password !== state.currentPassword) return response({}, 401);
        if (body.password === temporary) state.bootstrapLogins++;
        else state.savedLogins++;
        const token = `private-frigate-session-${state.bootstrapLogins}-${state.savedLogins}`;
        state.cookies.set(`frigate_token=${token}`, body.password);
        return response({}, 200, `frigate_token=${token}; HttpOnly; Path=/; SameSite=Lax`, "");
      }
      if (request.path === "/api/users/admin/password") {
        assert.equal(request.method, "PUT");
        assert.deepEqual(JSON.parse(request.body as string), { password });
        assert.equal(state.cookies.get(request.headers?.Cookie ?? ""), temporary);
        assert.equal(request.approval?.once, true);
        assert.ok(request.beforeSendCheckpoint);
        state.rotationApprovals.push(JSON.stringify({ headers: request.headers, body: request.body, checkpoint: request.beforeSendCheckpoint }));
        if (state.deferred) throw new Error("approval deferred");
        update(request.beforeSendCheckpoint, request.approval?.action);
        state.rotations++;
        if (state.persistRotation) state.currentPassword = password;
        if (state.loseRotation) throw new Error("rotation response lost");
        return response({ success: true });
      }
      throw new Error("Unexpected Frigate fixture route");
    } },
  } as SetupContext;
  return { context, state };
}

const fresh = fixture();
assert.equal(frigate.ready(await frigate.firstRun(fresh.context)), true);
assert.equal(frigate.ready(await frigate.firstRun(fresh.context)), true);
assert.equal(fresh.state.rotations, 1); assert.equal(fresh.state.bootstrapReads, 1);
assert.equal(frigate.apiKey, "not-created");

const deferred = fixture(); deferred.state.deferred = true;
await assert.rejects(frigate.firstRun(deferred.context), /deferred/);
await assert.rejects(frigate.firstRun(deferred.context), /deferred/);
assert.equal(deferred.state.rotationApprovals[0], deferred.state.rotationApprovals[1]);
assert.equal(deferred.state.bootstrapLogins, 1); assert.equal(deferred.state.bootstrapReads, 1);
deferred.state.deferred = false;
assert.equal(frigate.ready(await frigate.firstRun(deferred.context)), true);
assert.equal(deferred.state.rotations, 1);

for (const persists of [true, false]) {
  const uncertain = fixture(); uncertain.state.loseRotation = true; uncertain.state.persistRotation = persists;
  await assert.rejects(frigate.firstRun(uncertain.context), /response lost/);
  uncertain.state.loseRotation = false;
  if (persists) assert.equal(frigate.ready(await frigate.firstRun(uncertain.context)), true);
  else await assert.rejects(frigate.firstRun(uncertain.context), /never replay/);
  assert.equal(uncertain.state.rotations, 1);
}
for (const bad of ["anonymous", "role", "401", "403", "uncertain"] as const) {
  const rejected = fixture();
  if (bad === "anonymous") rejected.state.anonymousStatus = 200;
  if (bad === "role") rejected.state.role = "viewer";
  if (bad === "401") rejected.state.profileStatus = 401;
  if (bad === "403") rejected.state.profileStatus = 403;
  if (bad === "uncertain") rejected.state.loseProfile = true;
  await assert.rejects(frigate.firstRun(rejected.context));
  assert.equal(rejected.state.rotations, 0);
  if (bad === "401") assert.deepEqual(rejected.state.sessions, {});
  if (bad === "403" || bad === "uncertain") assert.ok(rejected.state.sessions.frigate_token);
}

const recipe = JSON.parse(await readFile(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/frigate/recipe.json", import.meta.url), "utf8"));
const projectId = "selfhost-frigate-fixture";
const manifest = multiServiceManifest({ recipe, images: { frigate: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` },
  projectId, appsRoot: join(root, ".selfhost/apps"), projectDirectory: join(root, ".selfhost/apps", projectId),
  dataDirectory: join(root, ".selfhost/app-data/frigate"), dockerContext: "default", port: 18971, uid: 1001, gid: 1002,
  observed: { checkedAt: "2026-10-03T12:00:00.000Z", ports: [], paths: [], networks: [], volumes: [] } });
assert.deepEqual(manifest.services[0].tmpfs, [{ target: "/tmp/cache", sizeBytes: 1000000000, mode: 511 }]);
assert.equal(manifest.services[0].shmSizeBytes, 67108864);
assert.deepEqual(manifest.services[0].ports.map((port: { hostIp: string; target: number }) => [port.hostIp, port.target]), [["127.0.0.1", 8971]]);
assert.match(recipe.configFiles[0].content, /cameras: \{\}/);
assert.match(recipe.configFiles[0].content, /internal: 127\.0\.0\.1:5000/);
assert.match(recipe.configFiles[0].content, /tls:\n  enabled: false/);
assert.match(recipe.configFiles[0].content, /auth:\n  enabled: true/);
assert.equal(Object.hasOwn(recipe.services[0], "devices"), false);
assert.equal(Object.hasOwn(recipe.services[0], "privileged"), false);
console.log("Frigate source-backed bootstrap and recipe fixture passed; no Docker, cameras or upstream API was used.");
