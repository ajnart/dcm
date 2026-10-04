import assert from "node:assert/strict";
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeSocketIoIntentProfile, socketIoApprovalEvent, socketIoIntentProfile }
  from "../src/lib/setup-socketio-profile.ts";
import { setupContractSha256 } from "../src/lib/setup-contract.ts";

const source = "https://github.com/example/project/blob/v1.2.3/server.js";
const descriptor = { version: 1, appId: "fixture", source, events: [
  { event: "login", action: "fixture-login", arguments: "any" },
  { event: "getMonitor", action: "fixture-get-monitor", arguments: "positive-id" },
  { event: "getMonitorBeats", action: "fixture-get-monitor-beats", arguments: "positive-id-hours-24" },
] };
const profile = decodeSocketIoIntentProfile(descriptor, "fixture");
assert.deepEqual(socketIoApprovalEvent(profile, '429["login",{"password":"synthetic"}]', "fixture-login"),
  ["login", { password: "synthetic" }]);
for (const frame of ['42["login"]', '429["unknown"]', '429["login"]\u001e2', '429[bad]',
  '429["getMonitor",0]', '429["getMonitor",1.5]', '429["getMonitor",1,2]',
  '429["getMonitorBeats",1,23]', '429["getMonitorBeats",1,24,2]']) {
  assert.equal(socketIoApprovalEvent(profile, frame, "fixture-get-monitor"), null);
  assert.equal(socketIoApprovalEvent(profile, frame, "fixture-get-monitor-beats"), null);
}
assert.deepEqual(socketIoApprovalEvent(profile, '421["getMonitor",12]', "fixture-get-monitor"), ["getMonitor", 12]);
assert.deepEqual(socketIoApprovalEvent(profile, '421["getMonitorBeats",12,24]', "fixture-get-monitor-beats"),
  ["getMonitorBeats", 12, 24]);
assert.equal(socketIoApprovalEvent(profile, '429["login"]', "wrong-action"), null);
for (const frame of ['42["login"]', '429["unknown"]', '429["login"]\u001e2', '429[bad]']) {
  assert.equal(socketIoApprovalEvent(profile, frame, "fixture-login"), null);
}
for (const invalid of [
  { ...descriptor, appId: "other" }, { ...descriptor, version: 2 }, { ...descriptor, path: "/other" },
  { ...descriptor, source: source.replace("v1.2.3", "master") }, { ...descriptor, events: [] },
  { ...descriptor, events: [descriptor.events[0], descriptor.events[0]] },
  { ...descriptor, events: [{ ...descriptor.events[0], arguments: "regex" }] },
  { ...descriptor, events: [{ ...descriptor.events[0], regex: ".*" }] },
]) assert.throws(() => decodeSocketIoIntentProfile(invalid, "fixture"), /profile is invalid/);
assert.equal(socketIoIntentProfile("../fixture"), null);
assert.equal(socketIoIntentProfile("sonarr"), null);
const kuma = socketIoIntentProfile("uptime-kuma")!;
assert.ok(kuma.events.some((entry) => entry.event === "addAPIKey"));
const dockge = socketIoIntentProfile("dockge")!;
assert.equal(dockge.source, "https://github.com/louislam/dockge/blob/1.5.0/backend/socket-handlers/main-socket-handler.ts");
const credentials = { username: "admin", password: "synthetic-password-123" };
const setupFrame = `421${JSON.stringify(["setup", credentials.username, credentials.password])}`;
const loginFrame = `429${JSON.stringify(["login", credentials])}`;
assert.deepEqual(socketIoApprovalEvent(dockge, setupFrame, "dockge-setup"), ["setup", "admin", credentials.password]);
assert.deepEqual(socketIoApprovalEvent(dockge, loginFrame, "dockge-login"), ["login", credentials]);
assert.deepEqual(socketIoApprovalEvent(dockge, '421["getSettings"]', "dockge-get-settings"), ["getSettings"]);
for (const [action, events] of [
  ["dockge-setup", [["setup"], ["setup", "admin", "short"], ["setup", "admin", credentials.password, true],
    ["setup", "../admin", credentials.password], ["setup", "admin", "é".repeat(37)]]],
  ["dockge-login", [["login"], ["login", { ...credentials, token: "synthetic" }], ["login", credentials, true],
    ["login", [credentials.username, credentials.password]], ["login", { ...credentials, password: "line\nbreak" }]]],
  ["dockge-get-settings", [["getSettings", {}], ["setSettings", { disableAuth: true }, credentials.password]]],
] as const) {
  for (const event of events) assert.equal(socketIoApprovalEvent(dockge, `421${JSON.stringify(event)}`, action), null);
}
assert.equal(socketIoApprovalEvent(dockge, loginFrame, "dockge-setup"), null);
assert.equal(socketIoApprovalEvent(dockge, '421["loginByToken","synthetic"]', "dockge-login"), null);
const sourceHash = await setupContractSha256("uptime-kuma");
assert.notEqual(sourceHash, await setupContractSha256("uptime-kuma", ["sonarr"]));

const directory = await mkdtemp(join(tmpdir(), "socketio-profile-fixture-"));
try {
  const loaderBundle = join(directory, "loader.js");
  const contractBundle = join(directory, "contract.js");
  for (const [entry, outfile] of [["setup-socketio-profile.ts", loaderBundle], ["setup-contract.ts", contractBundle]]) {
    const build = Bun.spawnSync([process.execPath, "build", new URL(`../src/lib/${entry}`, import.meta.url).pathname,
      "--target=node", `--outfile=${outfile}`]);
    assert.equal(build.exitCode, 0, build.stderr.toString());
  }
  const apps = join(directory, "workflows", "selfhost", "references", "catalog", "apps");
  async function app(appId: string, value: unknown = { ...descriptor, appId }) {
    const path = join(apps, appId);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "setup.js"), "export default {};\n", { mode: 0o644 });
    await writeFile(join(path, "socketio-intents.json"), JSON.stringify(value), { mode: 0o644 });
    return join(path, "socketio-intents.json");
  }
  for (const path of ["selfhost-compose/scripts/compose-project.ts", "selfhost-compose/scripts/compose-lifecycle.sh",
    "selfhost-host/scripts/inspect-host.sh", "selfhost/references/catalog/types/manual-job.ts",
    "selfhost/references/catalog/types/non-secret-policy.ts"]) {
    const target = join(directory, "workflows", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "// synthetic external owner\n", { mode: 0o644 });
  }
  const owned = await app("fixture");
  const peer = await app("peer");
  const loader = await import(pathToFileURL(loaderBundle).href);
  assert.deepEqual(loader.socketIoIntentProfile("fixture"), profile);
  assert.equal(loader.socketIoIntentProfile("missing"), null);
  await app("missing");
  assert.throws(() => loader.socketIoIntentProfile("missing"), /changed while the CLI was running/);
  const original = await readFile(owned, "utf8");
  await writeFile(owned, `${original}\n`);
  assert.throws(() => loader.socketIoIntentProfile("fixture"), /changed while the CLI was running/);
  await writeFile(owned, original);
  for (const [id, prepare] of [
    ["world-writable", async (path: string) => chmod(path, 0o666)],
    ["oversized", async (path: string) => writeFile(path, "x".repeat(4097))],
    ["malformed", async (path: string) => writeFile(path, "{")],
    ["wrong-app", async (path: string) => writeFile(path, JSON.stringify(descriptor))],
    ["hardlink", async (path: string) => link(path, `${path}.linked`)],
    ["symlink", async (path: string) => { await rm(path); await symlink(owned, path); }],
  ] as const) {
    const path = await app(id);
    await prepare(path);
    assert.throws(() => loader.socketIoIntentProfile(id), /profile could not be read/);
  }
  const contract = await import(pathToFileURL(contractBundle).href);
  const hash = await contract.setupContractSha256("fixture", ["peer"]);
  assert.equal(hash, await contract.setupContractSha256("fixture", ["peer", "fixture"]));
  await writeFile(peer, `${await readFile(peer, "utf8")}\n`);
  await assert.rejects(contract.setupContractSha256("fixture", ["peer"]), /changed while the CLI was running/);
  async function freshContract(name: string) {
    const bundle = join(directory, `${name}.js`);
    await copyFile(contractBundle, bundle);
    return import(pathToFileURL(bundle).href);
  }
  const fresh = await freshContract("fresh-peer");
  assert.notEqual(hash, await fresh.setupContractSha256("fixture", ["peer"]));
  const ownedHash = await fresh.setupContractSha256("fixture");
  await writeFile(owned, `${original}\n`);
  await assert.rejects(fresh.setupContractSha256("fixture"), /changed while the CLI was running/);
  assert.notEqual(ownedHash, await (await freshContract("fresh-owned")).setupContractSha256("fixture"));
  console.log("Socket.IO profiles: strict rules, safe source/package loading, owned/peer contract bytes and warm drift: pass");
} finally { await rm(directory, { recursive: true, force: true }); }
