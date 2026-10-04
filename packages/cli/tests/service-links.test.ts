import assert from "node:assert/strict";
import { mkdtemp, mkdir, lstat, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runServiceLink, serviceLinks, type ServiceLinkCheckpoint, type ServiceLinkContext } from "../src/lib/service-links.ts";
import { checkedConnectState, checkConnectCategory, connectApproval, connectLedger, connectPeerEndpoint, parseConnectOptions } from "../src/connect.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";

const owner = { projectRoot: "/tmp/owned-links", projectId: "media", manifestHash: "a".repeat(64), revision: 1 };
function fixture(source: string, target: string) {
  const descriptor = serviceLinks.find((link) => link.source === source && link.target === target)!;
  const calls: { method: string; path: string; body?: Record<string, any> }[] = [];
  let checkpoint: ServiceLinkCheckpoint | null = null;
  let rows: Record<string, any>[] = [];
  let lost = false;
  let testResult: unknown = {};
  let finalTestResult: unknown = undefined;
  let indexers: Record<string, unknown>[] = [];
  let testStatus = 200;
  let storedPassword: string | null = null;
  let storedApiKey: string | null = null;
  const context: ServiceLinkContext = {
    owner,
    async verifiedPeer(appId) { return { appId, owner, verified: true,
      apiKey: `${appId}-fixture-key`, username: "admin", password: "fixture-password",
      externalUrl: "http://127.0.0.1:12345", server: { host: appId, port: 41445 } }; },
    checkpoint: { async read() { return checkpoint; }, async save(next) { checkpoint = next; } },
    async request(_app, request) {
      calls.push({ method: request.method, path: request.path,
        body: request.body === undefined ? undefined : JSON.parse(request.body as string) });
      let result: unknown = rows;
      if (request.path === "/api/v1/indexer") result = indexers;
      else if (request.path.endsWith("/schema")) {
        result = [{ implementation: descriptor.name, implementationName: descriptor.name,
          configContract: "fixture", fields: ["host", "port", "username", "password", "tvCategory",
            "movieCategory", "tvImportedCategory", "movieImportedCategory", "useSsl", "urlBase",
            "prowlarrUrl", "baseUrl", "apiKey"].map((name) => ({ name })) }];
      } else if (request.path.endsWith("/test")) {
        result = testResult;
        if (descriptor.kind === "download-client") {
          const body = JSON.parse(request.body as string);
          const password = body.fields.find((field: any) => field.name === "password").value;
          if (body.id !== undefined) {
            assert.equal(body.id, rows[0]?.id, "resolve the exact persisted resource");
            assert.equal(password, "********", "test the saved password without substituting the proposed credential");
            if (storedPassword !== "fixture-password") result = { error: "saved password rejected" };
          } else assert.equal(password, "fixture-password", "candidate test uses the reviewed generated password");
        }
        if (descriptor.kind === "application") {
          const body = JSON.parse(request.body as string);
          const key = body.fields.find((field: any) => field.name === "apiKey").value;
          if (body.id !== undefined) {
            assert.equal(body.id, rows[0]?.id, "resolve the exact persisted application");
            assert.equal(key, "********", "test the stored application key without substituting the proposed key");
            if (storedApiKey !== `${target}-fixture-key`) result = { error: "saved API key rejected" };
          } else assert.equal(key, `${target}-fixture-key`, "candidate test uses the reviewed peer key");
        }
        if (source === "seerr") result = { profiles: [{ id: 1, name: "Any" }],
          rootFolders: [{ id: 1, path: descriptor.root }], urlBase: "" };
        if (rows.length > 0 && finalTestResult !== undefined) result = finalTestResult;
      } else if (request.method === "POST") {
        assert.equal(checkpoint?.phase, "attempted", "persist before save");
        let savedId = 7;
        if (source === "seerr") savedId = 0;
        rows = [{ ...JSON.parse(request.body as string), id: savedId }];
        if (descriptor.kind === "download-client") {
          const password = rows[0]!.fields.find((field: any) => field.name === "password");
          storedPassword = password.value;
          password.value = "********";
        }
        if (descriptor.kind === "application") {
          const key = rows[0]!.fields.find((field: any) => field.name === "apiKey");
          storedApiKey = key.value;
          key.value = "********";
        }
        result = rows[0];
        if (lost) throw new Error("lost response");
      }
      let responseStatus = 200;
      if (request.path.endsWith("/test")) responseStatus = testStatus;
      return { status: responseStatus, ok: true, headers: { get() { return null; } },
        async json() { return structuredClone(result); }, async text() { return ""; } };
    },
  };
  return { context, calls, loseResponse() { lost = true; }, checkpoint() { return checkpoint; },
    corrupt() { rows[0]!.enable = false; }, remove() { rows = []; },
    testResult(value: unknown) { testResult = value; }, finalTestResult(value: unknown) { finalTestResult = value; },
    addIndexer() { indexers.push({ id: 1, enable: true }); },
    testStatus(status: number) { testStatus = status; },
    staleStoredPassword() { storedPassword = "different-stored-password"; },
    staleStoredApiKey() { storedApiKey = "different-stored-api-key"; },
    corruptField(name: string, value: unknown) { rows[0]!.fields.find((field: any) => field.name === name).value = value; } };
}

for (const link of serviceLinks) {
  const f = fixture(link.source, link.target);
  const result = await runServiceLink(f.context, link.source, link.target);
  assert.equal(result.status, "api-link-verified");
  assert.equal(f.checkpoint()?.phase, "verified");
  const saved = f.calls.find((call) => call.method === "POST" && !call.path.endsWith("/test"))!.body!;
  if (link.kind === "download-client") assert.equal(saved.fields.find((field: any) => field.name === "port").value, 41445);
  if (link.kind === "application") {
    assert.equal(saved.fields.find((field: any) => field.name === "baseUrl").value, `http://${link.target}:41445`);
    assert.equal(saved.fields.find((field: any) => field.name === "prowlarrUrl").value, "http://prowlarr:41445");
  }
  if (link.kind === "request-manager") {
    assert.equal(saved.port, 41445);
    assert.equal(result.resourceId, 0, "Seerr's first saved server has ID zero");
  }
  assert.equal(f.calls.filter((call) => call.path.endsWith("/test")).length, 2,
    "Both candidate and saved-resource functional tests must run before verification");
  await runServiceLink(f.context, link.source, link.target);
  assert.equal(f.calls.filter((call) => call.method === "POST" && !call.path.endsWith("/test")).length, 1);
}
for (const source of ["sonarr", "radarr"]) {
  const stale = fixture(source, "qbittorrent");
  await runServiceLink(stale.context, source, "qbittorrent");
  const savedCheckpoint = stale.checkpoint();
  stale.staleStoredPassword();
  await assert.rejects(runServiceLink(stale.context, source, "qbittorrent"), /exact success resource/);
  assert.equal(stale.checkpoint(), savedCheckpoint, "failed verification preserves the prior checkpoint");
  assert.equal(stale.calls.filter((call) => call.method === "POST" && !call.path.endsWith("/test")).length, 1,
    "stale saved credentials must not overwrite or recreate the resource");
  stale.corruptField("password", "unknown-mask");
  const testsBeforeInvalidMask = stale.calls.filter((call) => call.path.endsWith("/test")).length;
  await assert.rejects(runServiceLink(stale.context, source, "qbittorrent"), /exact publisher mask/);
  assert.equal(stale.calls.filter((call) => call.path.endsWith("/test")).length, testsBeforeInvalidMask);
  assert.equal(stale.checkpoint(), savedCheckpoint);
}
for (const target of ["sonarr", "radarr"]) {
  const stale = fixture("prowlarr", target);
  await runServiceLink(stale.context, "prowlarr", target);
  const savedCheckpoint = stale.checkpoint();
  stale.staleStoredApiKey();
  await assert.rejects(runServiceLink(stale.context, "prowlarr", target), /exact success resource/);
  assert.equal(stale.checkpoint(), savedCheckpoint);
  assert.equal(stale.calls.filter((call) => call.method === "POST" && !call.path.endsWith("/test")).length, 1,
    "stale stored application keys must not overwrite or recreate the resource");
  for (const invalidKey of ["unknown-mask", "", `${target}-fixture-key`]) {
    stale.corruptField("apiKey", invalidKey);
    const callsBeforeInvalidKey = stale.calls.length;
    await assert.rejects(runServiceLink(stale.context, "prowlarr", target), /no overwrite/);
    assert.ok(stale.calls.slice(callsBeforeInvalidKey).every((call) => call.method === "GET"));
    assert.equal(stale.checkpoint(), savedCheckpoint);
  }
}
for (const result of [[], null, false, { error: "fixture-failure" }, [{ propertyName: "Host" }]]) {
  const invalidTest = fixture("sonarr", "qbittorrent");
  invalidTest.testResult(result);
  await assert.rejects(runServiceLink(invalidTest.context, "sonarr", "qbittorrent"), /exact success resource/);
  assert.equal(invalidTest.checkpoint(), null, "A failed candidate test must not start a save");
}
const quotedTest = fixture("prowlarr", "radarr");
quotedTest.testResult("{}");
await runServiceLink(quotedTest.context, "prowlarr", "radarr");
for (const status of [201, 202, 400, 500]) {
  const unsuccessfulStatus = fixture("radarr", "qbittorrent");
  unsuccessfulStatus.testStatus(status);
  await assert.rejects(runServiceLink(unsuccessfulStatus.context, "radarr", "qbittorrent"), /connection test.*status/);
  assert.equal(unsuccessfulStatus.checkpoint(), null);
}
const existingIndexer = fixture("prowlarr", "sonarr");
existingIndexer.addIndexer();
await assert.rejects(runServiceLink(existingIndexer.context, "prowlarr", "sonarr"), /empty Prowlarr indexer inventory/);
assert.equal(existingIndexer.calls.some((call) => call.method !== "GET"), false);
assert.equal(existingIndexer.checkpoint(), null);
for (const link of serviceLinks) {
  const failedReadbackTest = fixture(link.source, link.target);
  failedReadbackTest.finalTestResult({ error: "saved connection failed" });
  await assert.rejects(runServiceLink(failedReadbackTest.context, link.source, link.target), /connection test|API list/);
  assert.equal(failedReadbackTest.checkpoint()?.phase, "attempted",
    "A saved configuration without functional proof must remain attempted");
}
const unsafeImportedCategory = fixture("sonarr", "qbittorrent");
await runServiceLink(unsafeImportedCategory.context, "sonarr", "qbittorrent");
unsafeImportedCategory.corruptField("tvImportedCategory", "unowned-category");
const priorTests = unsafeImportedCategory.calls.filter((call) => call.path.endsWith("/test")).length;
await assert.rejects(runServiceLink(unsafeImportedCategory.context, "sonarr", "qbittorrent"), /no overwrite/);
assert.equal(unsafeImportedCategory.calls.filter((call) => call.path.endsWith("/test")).length, priorTests);
const interrupted = fixture("sonarr", "qbittorrent");
interrupted.loseResponse();
await assert.rejects(runServiceLink(interrupted.context, "sonarr", "qbittorrent"), /not confirmed/);
await runServiceLink(interrupted.context, "sonarr", "qbittorrent");
assert.equal(interrupted.calls.filter((call) => call.method === "POST" && !call.path.endsWith("/test")).length, 1);
interrupted.remove();
await assert.rejects(runServiceLink(interrupted.context, "sonarr", "qbittorrent"), /replay is refused/);

const conflict = fixture("radarr", "qbittorrent");
await runServiceLink(conflict.context, "radarr", "qbittorrent");
conflict.corrupt();
await assert.rejects(runServiceLink(conflict.context, "radarr", "qbittorrent"), /no overwrite/);

const wrongOwner = fixture("prowlarr", "sonarr");
const peer = wrongOwner.context.verifiedPeer;
wrongOwner.context.verifiedPeer = async (id) => ({ ...await peer(id), owner: { ...owner, revision: 2 } });
await assert.rejects(runServiceLink(wrongOwner.context, "prowlarr", "sonarr"), /exact same shared/);
assert.equal(wrongOwner.calls.length, 0);

const args = ["plan", "--project-root", "/tmp/owned-links", "--project-id", "media", "--source", "prowlarr", "--target", "sonarr"];
assert.equal(parseConnectOptions(args).source, "prowlarr");
assert.throws(() => parseConnectOptions([...args, "--approve", "bad"]), /read-only/);
assert.throws(() => parseConnectOptions(["apply", ...args.slice(1)]), /exact connect-plan approval/);
assert.notEqual(connectApproval(owner, "prowlarr", "sonarr"), connectApproval({ ...owner, revision: 2 }, "prowlarr", "sonarr"));
assert.notEqual(connectApproval(owner, "prowlarr", "sonarr"), connectApproval(owner, "prowlarr", "radarr"));
// This is the actual shared-project runtime shape: project.root is the shared owner parent,
// not the CLI project root; frontend target ports can differ from published browser ports.
const actualState = {
  project: { root: "/tmp/owned-links/.selfhost/shared", directory: "/tmp/owned-links/.selfhost/shared/media", id: "media" },
  checkpoint: { phase: "completed" }, units: { prowlarr: ["prowlarr"], sonarr: ["sonarr"], qbittorrent: ["qbittorrent"] },
  manifest: { services: [{ id: "qbittorrent", networks: ["front", "qbittorrent-private"],
    ports: [{ protocol: "tcp", target: 41445, published: 41445 }] }] },
} as unknown as SharedProjectState;
assert.equal(checkedConnectState(actualState, owner.projectRoot, owner.projectId, "prowlarr", "sonarr"), actualState);
assert.throws(() => checkedConnectState(actualState, "/tmp/different-root", owner.projectId, "prowlarr", "sonarr"), /exact shared/);
assert.deepEqual(connectPeerEndpoint(actualState, "qbittorrent"), { host: "qbittorrent", port: 41445 });
actualState.manifest.services[0]!.networks = ["qbittorrent-private"];
assert.throws(() => connectPeerEndpoint(actualState, "qbittorrent"), /shared front network/);
checkConnectCategory({ "tv-sonarr": { name: "tv-sonarr", savePath: "/data/torrents/tv-sonarr" } }, "tv-sonarr");
assert.throws(() => checkConnectCategory({}, "tv-sonarr"), /target category/);
assert.throws(() => checkConnectCategory({ "tv-sonarr": { name: "tv-sonarr", savePath: "/unowned" } }, "tv-sonarr"), /target category/);
const temporary = await mkdtemp(join(tmpdir(), "service-link-ledger-"));
try {
  const directory = join(temporary, "links");
  const a = await connectLedger(directory, owner, "prowlarr-to-sonarr");
  const b = await connectLedger(directory, owner, "prowlarr-to-sonarr");
  const checkpoint: ServiceLinkCheckpoint = { owner, linkId: "prowlarr-to-sonarr", phase: "attempted" };
  assert.equal(await a.read(checkpoint.linkId), null);
  await a.save(checkpoint);
  assert.equal((await lstat(join(directory, "prowlarr-to-sonarr.1.json"))).mode & 0o777, 0o600);
  await assert.rejects(b.save(checkpoint), /changed concurrently/);
  const resumed = await connectLedger(directory, owner, checkpoint.linkId);
  assert.equal((await resumed.read(checkpoint.linkId))?.phase, "attempted");
  await resumed.save({ ...checkpoint, phase: "verified" });
  await assert.rejects(connectLedger(directory, { ...owner, revision: 2 }, checkpoint.linkId), /identity changed/);
  const real = join(temporary, "real");
  await mkdir(real, { mode: 0o700 });
  const linked = join(temporary, "linked");
  await symlink(real, linked);
  await assert.rejects(connectLedger(linked, owner, checkpoint.linkId), /owner-only/);
} finally { await rm(temporary, { recursive: true }); }
console.log("Service links: six routes, replay, owner/conflict rejection, exact approval, and private CAS ledger passed");
