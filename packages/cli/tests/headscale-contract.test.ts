import assert from "node:assert/strict";
import { compileHeadscaleConfiguration } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/headscale/config.ts";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/headscale/setup.ts";
import { generatedConfigReadability } from "../src/lib/multi-service-recipe.ts";
import type { SetupCheckpoint, SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

const configuration = compileHeadscaleConfiguration("https://headscale.example.test", "mesh.example.test");
assert.deepEqual(compileHeadscaleConfiguration(configuration.canonicalOrigin, configuration.magicDnsDomain), configuration);
assert.notEqual(compileHeadscaleConfiguration("https://other.example.test", "mesh.example.test").selectionFingerprint,
  configuration.selectionFingerprint);
assert.notEqual(compileHeadscaleConfiguration(configuration.canonicalOrigin, "othermesh.example.test").configSha256,
  configuration.configSha256);
for (const [origin, domain] of [
  ["http://headscale.example.test", "mesh.example.test"],
  ["https://headscale.example.test/", "mesh.example.test"],
  ["https://headscale.example.test/path", "mesh.example.test"],
  ["https://user:password@headscale.example.test", "mesh.example.test"],
  ["https://127.0.0.1", "mesh.example.test"],
  ["https://headscale.example.test", "headscale.example.test"],
  ["https://headscale.example.test", "mesh.example.test\nnoise:"],
]) assert.throws(() => compileHeadscaleConfiguration(origin!, domain!));
assert.deepEqual(generatedConfigReadability({ appId: "headscale", source: "https://github.com/juanfont/headscale",
  services: [configuration.service], configFiles: configuration.configFiles }),
  [{ fileId: "headscale-config", readability: "container", mode: "0644",
    officialUrl: configuration.configFiles[0]!.officialUrl }]);
assert.equal(configuration.service.mounts[1]!.kind, "volume");
assert.equal(configuration.service.publishTargetPort, 8080);
assert.equal(configuration.service.readOnly, true);
assert.equal(adapter.sharedOwner, true);

const key = `hskey-api-${"p".repeat(12)}-${"s".repeat(64)}`;
function fixture() {
  let checkpoint: SetupCheckpoint | null = null;
  let savedKey: string | null = null;
  let loseCapture = false;
  let existing = "[]";
  let failReadback = false;
  let prefix = `hskey-api-${"p".repeat(12)}-***`;
  const events: string[] = [];
  const status = { command: "app status", appId: "headscale", projectRoot: "/tmp/headscale-fixture",
    status: "applied", mutation: false, runtime: { state: "running" }, ownerKind: "shared",
    selectionFingerprint: "a".repeat(64), derivedRecipe: { appId: "headscale", configurationFilesVerified: true,
      input: { appId: "headscale", inputs: { "canonical-origin": configuration.canonicalOrigin,
        "magic-dns-domain": configuration.magicDnsDomain } },
      configuration: structuredClone(configuration), sourceSha256: "b".repeat(64),
      recipeSha256: "c".repeat(64), selectionFingerprint: "a".repeat(64), bindingHash: "d".repeat(64) } };
  const context = {
    appId: "headscale", projectRoot: status.projectRoot,
    status: async () => status,
    checkpoint: { read: async () => checkpoint, compareAndSet: async (update: any) => {
      assert.equal(update.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId: "headscale", projectRoot: status.projectRoot,
        revision: (checkpoint?.revision ?? 0) + 1, stage: update.stage,
        attemptedActions: checkpoint?.attemptedActions ?? [], data: update.data };
      return checkpoint;
    } },
    container: { exec: async (command: any) => {
      assert.equal(command.argv[0], "/ko-app/headscale");
      if (command.effect === "read") return { exitCode: 0, stdout: existing };
      assert.equal(command.approval.once, true);
      assert.deepEqual(command.argv, ["/ko-app/headscale", "apikeys", "create", "--expiration", "90d"]);
      assert.equal(command.captureAdminPassword, undefined);
      await context.checkpoint.compareAndSet(command.beforeSendCheckpoint);
      checkpoint!.attemptedActions.push(command.approval.action);
      events.push("create");
      if (loseCapture) throw new Error("synthetic capture loss");
      return { exitCode: 0, stdout: `${key}\n` };
    } },
    secrets: { readApiKey: async () => savedKey, apiKeyPath: async () => "/tmp/headscale-fixture/api-key",
      writeApiKey: async (value: string) => { assert.equal(value, key); savedKey = value; events.push("save"); return "/tmp/headscale-fixture/api-key"; } },
    http: { request: async (request: any) => {
      assert.equal(request.path, "/api/v1/apikey");
      assert.equal(request.headers.Authorization, `Bearer ${key}`);
      events.push("readback");
      return { ok: !failReadback, status: 200, json: async () => ({ apiKeys: [{ prefix }] }) };
    } },
  };
  return { context: context as unknown as SetupContext, events, status,
    loseCapture: () => { loseCapture = true; }, existing: () => { existing = '[{"prefix":"foreign"}]'; },
    failReadback: () => { failReadback = true; }, recoverReadback: () => { failReadback = false; },
    rawPrefix: () => { prefix = "p".repeat(12); } };
}
const fresh = fixture();
const record = await adapter.firstRun(fresh.context);
assert(adapter.ready(record));
assert.equal(record.adminUsername, null);
assert.equal(record.adminPassword, null);
assert.equal(record.canonicalTls, "pending");
assert.equal(record.clientEnrollment, "pending");
assert(!JSON.stringify(record).includes(key));
assert.deepEqual(fresh.events, ["create", "save", "readback"]);
await adapter.firstRun(fresh.context);
await adapter.inspect!(fresh.context);
assert.equal(fresh.events.filter((event) => event === "create").length, 1);
const lost = fixture(); lost.loseCapture();
await assert.rejects(adapter.firstRun(lost.context), /synthetic capture loss/);
await assert.rejects(adapter.firstRun(lost.context), /reconciliation/);
assert.deepEqual(lost.events, ["create"]);
const readback = fixture(); readback.failReadback();
await assert.rejects(adapter.firstRun(readback.context), /rejected/);
readback.recoverReadback();
await adapter.firstRun(readback.context);
assert.deepEqual(readback.events, ["create", "save", "readback", "readback"]);
const occupied = fixture(); occupied.existing();
await assert.rejects(adapter.firstRun(occupied.context), /pre-existing/);
assert.deepEqual(occupied.events, []);
const unmasked = fixture(); unmasked.rawPrefix();
await assert.rejects(adapter.firstRun(unmasked.context), /key identity/);
assert.deepEqual(unmasked.events, ["create", "save", "readback"]);
const changed = fixture(); changed.status.derivedRecipe.configuration.configSha256 = "0".repeat(64);
await assert.rejects(adapter.firstRun(changed.context), /retained configuration/);
assert.deepEqual(changed.events, []);
const unverifiedFiles = fixture(); unverifiedFiles.status.derivedRecipe.configurationFilesVerified = false;
await assert.rejects(adapter.firstRun(unverifiedFiles.context), /configuration binding/);
assert.deepEqual(unverifiedFiles.events, []);
const changedBytes = fixture(); changedBytes.status.derivedRecipe.configuration.configFiles[0]!.content += "\n";
await assert.rejects(adapter.firstRun(changedBytes.context), /retained configuration/);
assert.deepEqual(changedBytes.events, []);
const changedInput = fixture(); changedInput.status.derivedRecipe.input.inputs["canonical-origin"] = "https://other.example.test";
await assert.rejects(adapter.firstRun(changedInput.context), /configuration binding/);
assert.deepEqual(changedInput.events, []);
const changedSelection = fixture(); changedSelection.status.selectionFingerprint = "e".repeat(64);
await assert.rejects(adapter.firstRun(changedSelection.context), /configuration binding/);
assert.deepEqual(changedSelection.events, []);
const changedOwner = fixture(); await adapter.firstRun(changedOwner.context);
changedOwner.status.derivedRecipe.bindingHash = "e".repeat(64);
await assert.rejects(adapter.firstRun(changedOwner.context), /different configuration or owner/);
assert.equal(changedOwner.events.filter((event) => event === "create").length, 1);
await assert.rejects(adapter.inspect!(changedOwner.context), /creation evidence/);
console.log("Headscale deterministic config, private key capture, readback and fail-closed resume: pass");
