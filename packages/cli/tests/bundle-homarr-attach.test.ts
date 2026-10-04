#!/usr/bin/env bun

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

async function privateFile(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}
async function privateJson(path: string, value: unknown): Promise<void> {
  await privateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
async function capture(action: () => Promise<void>): Promise<Record<string, any>> {
  const prior = console.log;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.map(String).join(" ")}\n`; };
  try { await action(); }
  finally { console.log = prior; }
  return JSON.parse(output);
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-homarr-attach-"));
const directory = join(root, ".selfhost", "bundles", "home");
const session = join(root, ".selfhost", "media-harness", ".sessions", "home-media");
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir(session, { recursive: true, mode: 0o700 });
await chmod(join(root, ".selfhost"), 0o700);
await chmod(join(root, ".selfhost", "bundles"), 0o700);
await chmod(directory, 0o700);
const input = join(directory, "household-bundle.json");
await privateJson(input, { schemaVersion: 1, id: "home", projectRoot: root, services: {
  media: { runId: "home-media", username: "admin", credentialHandoff: true },
  immich: { input: join(directory, "immich.json"), runId: "home-immich", accountFile: join(directory, "immich-account.json") },
  docmost: { input: join(directory, "docmost.json"), runId: "home-docmost", accountFile: join(directory, "docmost-account.json") },
  vaultwarden: { input: join(directory, "vaultwarden.json"), runId: "home-vault",
    accountFile: join(directory, "vaultwarden-account.json"), httpsPlan: join(directory, "vaultwarden-https.json") },
} });
const homarrEntry = `${["HOMARR", "API", "KEY"].join("_")}=${["fixture", "value", "not", "printed"].join("-")}\n`;
await privateFile(join(session, "connections.env"), homarrEntry);
for (const id of ["immich", "docmost", "vaultwarden"]) {
  await privateJson(join(directory, `homarr-attach-${id}.json`), { schemaVersion: 1, homarr: { boardName: "personal" }, service: { id } });
}
await privateJson(join(directory, "homarr-attach-immich-native.json"), { schemaVersion: 1, immich: { widgets: [{ kind: "immich-serverStats" }] } });
await privateJson(join(directory, "immich-acceptance.json"), { schemaVersion: 1, status: "accepted" });
const noop = async (): Promise<void> => { throw new Error("adapter must not run"); };
const dependencies = { media: noop, immich: noop, docmost: noop, vaultwarden: noop };
const args = ["homarr-attach", "status", "--project-root", root, "--input", input];

try {
  const blocked = await capture(() => bundleCommand(args, dependencies));
  assert.equal(blocked.kind, "household-bundle-homarr-attach-queue");
  assert.equal(blocked.mutation, false);
  assert.equal(blocked.secretsRead, false);
  assert.equal(blocked.secretsPrinted, false);
  assert.equal(blocked.status, "partially-ready");
  assert.equal(blocked.queue.length, 4);
  assert.deepEqual(blocked.queue.slice(0, 3).map((entry: any) => entry.state),
    ["ready-for-plan", "ready-for-plan", "ready-for-plan"]);
  assert.equal(blocked.queue[3].state, "blocked");
  assert.match(blocked.queue[3].gate, /limited-immich-key/);
  assert.equal(JSON.stringify(blocked).includes(homarrEntry.trim()), false);
  assert.deepEqual(blocked.queue[0].commands.plan.slice(0, 5), ["self-host", "homarr", "attach", "plan", "--input"]);

  const immichKey = `${["limited", "immich", "fixture", "not", "printed"].join("-")}\n`;
  await privateFile(join(directory, "immich-homarr-api-key"), immichKey);
  const ready = await capture(() => bundleCommand(args, dependencies));
  assert.equal(ready.status, "ready-for-adapter-plans");
  assert.equal(ready.queue.every((entry: any) => entry.state === "ready-for-plan"), true);
  assert.deepEqual(ready.queue[3].commands.plan.slice(0, 6),
    ["self-host", "homarr", "attach", "immich", "plan", "--input"]);
  assert.deepEqual(ready.queue[3].commands.status.slice(0, 6),
    ["self-host", "homarr", "attach", "immich", "status", "--input"]);
  assert.equal(JSON.stringify(ready).includes(immichKey.trim()), false);

  const inspectedCalls: string[][] = [];
  let docmostAttached = false;
  let invalidStatus = false;
  let nativeLive = true;
  const homarrAttach = async (command: string[]) => {
    inspectedCalls.push(command);
    assert.ok(command.includes("status") && !command.includes("apply") && !command.includes("--approve"));
    if (command[0] === "immich") {
      let status = "attached-live-unverified";
      let liveWidgetKinds: string[] = [];
      if (nativeLive) { status = "attached"; liveWidgetKinds = ["immich-serverStats"]; }
      console.log(JSON.stringify({ status, mutation: false,
        integrationId: "integration-1", widgetKinds: ["immich-serverStats"], liveWidgetKinds, integrationVerified: nativeLive,
        boardPreserved: true, serviceAcceptanceRecorded: true }));
      return;
    }
    const commandInput = command[command.indexOf("--input") + 1];
    let status = "attached";
    if (commandInput.endsWith("homarr-attach-docmost.json") && !docmostAttached) status = "needs-attachment";
    const value: Record<string, any> = { status, mutation: false,
      board: { id: "board-1", name: "personal", private: true }, appId: "app-1", tileId: "tile-1",
      notebookId: "notebook-1", additionalNotebookId: "notebook-2", integrationVerified: false, serviceRuntimeVerified: false };
    if (invalidStatus) { value.appId = null; value.privateError = "fixture private detail must not escape"; }
    process.stdout.write(JSON.stringify(value));
  };
  const inspectedDependencies = { ...dependencies, homarrAttach };
  const inspected = await capture(() => bundleCommand([...args, "--inspect"], inspectedDependencies));
  assert.deepEqual(inspected.queue.map((entry: any) => entry.state), ["attached", "needs-attachment", "ready-for-plan", "ready-for-plan"]);
  assert.equal(inspectedCalls.length, 2);
  assert.equal(inspected.secretsRead, true);
  assert.equal(inspected.observation, "fresh-sequential-adapter-status");
  inspectedCalls.length = 0;
  invalidStatus = true;
  const invalid = await capture(() => bundleCommand([...args, "--inspect"], inspectedDependencies));
  assert.equal(invalid.queue[0].state, "status-unavailable");
  assert.equal(inspectedCalls.length, 1);
  assert.equal(JSON.stringify(invalid).includes("fixture private detail"), false);
  invalidStatus = false;
  docmostAttached = true;
  const attached = await capture(() => bundleCommand([...args, "--inspect"], inspectedDependencies));
  assert.equal(attached.status, "attached-readback");
  nativeLive = false;
  const liveUnverified = await capture(() => bundleCommand([...args, "--inspect"], inspectedDependencies));
  assert.equal(liveUnverified.queue[3].state, "needs-attachment");

  await rm(join(directory, "homarr-attach-immich.json"));
  inspectedCalls.length = 0;
  const missing = await capture(() => bundleCommand([...args, "--inspect"], inspectedDependencies));
  assert.equal(missing.queue[0].state, "blocked");
  assert.equal(inspectedCalls.length, 0);

  await chmod(join(directory, "homarr-attach-docmost.json"), 0o644);
  await assert.rejects(bundleCommand(args, dependencies), /owner-only file/);
} finally {
  await rm(root, { recursive: true });
}

console.log("PASS bundle Homarr attachment queue is read-only, deterministic, and secret-safe");
