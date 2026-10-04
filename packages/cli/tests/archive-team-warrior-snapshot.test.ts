import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { warriorIdleOpeningSnapshot } from "../src/control-panel/setup-websocket.ts";
import { readWarriorIdle } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/archive-team-warrior/idle-readback.ts";
import type { SetupInspectionContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const authorization = `Basic ${Buffer.from("warrior-admin:synthetic-private-fixture").toString("base64")}`;
const http = createServer();
const sockets = new WebSocketServer({ server: http });
await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
const address = http.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
let mode = "idle";
let sentByClient = 0;
sockets.on("connection", (socket, request) => {
  assert.equal(request.url, "/000/auto-stack/websocket");
  assert.equal(request.headers.authorization, authorization);
  socket.on("message", () => { sentByClient += 1; });
  socket.send("o");
  const events = [
    { event_name: "instance_id", message: "fixture-instance" },
    { event_name: "project.refresh", message: null },
    { event_name: "warrior.projects_loaded", message: { projects: {} } },
    { event_name: "warrior.status", message: { status: "NO_PROJECT" } },
    { event_name: "warrior.broadcast_message", message: { message: "", hash: "fixture" } },
  ];
  if (mode === "work") events[3]!.message = { status: "RUNNING_PROJECT" } as never;
  if (mode === "transition") events[4]!.event_name = "warrior.project_selected";
  if (mode === "binary") { socket.send(Buffer.from("private-unexpected")); return; }
  if (mode === "too-big") { socket.send("a" + "x".repeat(65_537)); return; }
  socket.send("a" + JSON.stringify(events.map((event) => JSON.stringify(event))));
});
try {
  const snapshot = await warriorIdleOpeningSnapshot(origin, authorization);
  assert.equal(snapshot.length, 5);
  assert.equal(sentByClient, 0);
  let anonymousStatus = 401;
  let authenticatedStatus = 200;
  let privateConfigValid = true;
  let privateConfigVerified = false;
  const context = {
    appId: "archive-team-warrior", projectRoot: "/tmp/synthetic-warrior-owner",
    status: async () => ({ command: "app status", appId: "archive-team-warrior",
      projectRoot: "/tmp/synthetic-warrior-owner", status: "applied", mutation: false,
      runtime: { state: "running" }, ownerKind: "shared", username: "warrior-admin", loginVia: "http-basic",
      passwordFile: "/tmp/synthetic-warrior-owner/private-password" }),
    secrets: { verifyMutableConfigs: async () => {
      if (!privateConfigValid) throw new Error("Private config differs");
      privateConfigVerified = true;
    }, readAdminPassword: async () => {
      assert.equal(privateConfigVerified, true);
      return "A".repeat(65);
    } },
    http: { request: async (request: { path: string; headers?: Record<string, string> }) => {
      if (request.path === "/") return { status: anonymousStatus };
      assert.equal(request.path, "/api/settings");
      assert.ok(request.headers?.Authorization?.startsWith("Basic "));
      return { status: authenticatedStatus, text: () => { throw new Error("Private HTML must not be consumed"); } };
    } },
    webSocket: { warriorIdleSnapshot: async () => snapshot },
  } as unknown as SetupInspectionContext;
  const proof = await readWarriorIdle(context);
  assert.equal(proof.effectiveState, "NO_PROJECT");
  assert.equal(proof.hqTrafficDisabled, false);
  assert.equal(proof.archivalAcceptanceVerified, false);
  privateConfigVerified = false;
  privateConfigValid = false;
  await assert.rejects(readWarriorIdle(context), /Private config differs/);
  assert.equal(privateConfigVerified, false);
  privateConfigValid = true;
  anonymousStatus = 200;
  await assert.rejects(readWarriorIdle(context), /reject anonymous/);
  anonymousStatus = 401;
  authenticatedStatus = 401;
  await assert.rejects(readWarriorIdle(context), /authenticate/);
  for (mode of ["work", "transition", "binary", "too-big"]) {
    await assert.rejects(warriorIdleOpeningSnapshot(origin, authorization), /incomplete, nonidle or unavailable/);
  }
  for (const badOrigin of ["http://example.com:8001", "http://localhost:8001", origin + "/elsewhere", "https://127.0.0.1:8001"]) {
    assert.throws(() => warriorIdleOpeningSnapshot(badOrigin, authorization), /exact private loopback/);
  }
  assert.throws(() => warriorIdleOpeningSnapshot(origin, "Bearer fixture"), /Basic identity/);
  assert.equal(sentByClient, 0);
} finally {
  for (const socket of sockets.clients) socket.terminate();
  await new Promise<void>((resolve) => sockets.close(() => resolve()));
  await new Promise<void>((resolve) => http.close(() => resolve()));
}
console.log("Warrior bounded read-only opening snapshot: pass (synthetic, no HQ traffic).");
