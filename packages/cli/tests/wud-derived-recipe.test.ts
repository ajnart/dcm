import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import { compileWudRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/wud/configuration.ts";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/wud/setup.ts";
import { approveWudAuthority, planWudAuthority } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/wud/authority.ts";
import type { SharedDerivedRecipeBinding } from "../src/lib/shared-derived-recipe.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { generatedPrivateFileLength } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-file.ts";

const id = "a".repeat(64);
const compiled = compileWudRecipe("docker.example.test", "2376", id);
assert.deepEqual(compileWudRecipe("docker.example.test", "2376", id), compiled);
assert.notEqual(compileWudRecipe("other.example.test", "2376", id).configuration.authorityFingerprint,
  compiled.configuration.authorityFingerprint);
for (const host of ["/var/run/docker.sock", "https://docker.example.test", "127.0.0.1", "docker.example.test\nOTHER=true"])
  assert.throws(() => compileWudRecipe(host, "2376", id));
for (const port of ["0", "65536", "02376", "2376x"])
  assert.throws(() => compileWudRecipe("docker.example.test", port, id));
assert.throws(() => compileWudRecipe("docker.example.test", "2376", "short-id"));
assert.equal(compiled.recipe.services[0]!.mounts.length, 1);
assert.equal(compiled.recipe.services[0]!.mounts[0]!.target, "/store");
assert.equal(compiled.recipe.privateFiles.filter((file) => file.source === "owner").length, 3);
assert.equal(compiled.configuration.authorityApprovalRequired, true);
assert.equal(compiled.configuration.dockerAuthorizationVerified, false);
assert.equal(compiled.recipe.services[0]!.environment.find((entry) => entry.name.endsWith("WATCHBYDEFAULT"))!.value, "false");
assert.equal(compiled.recipe.services[0]!.fileEnvironment.filter((entry) => entry.format === "file-path").length, 3);
const management = compileWudRecipe("docker.example.test", "2376", id, "docker-management-mtls");
assert.notEqual(management.configuration.authorityFingerprint, compiled.configuration.authorityFingerprint);
assert.equal(management.configuration.mutatingOperations, "explicitly-approved-host-wide-docker-control");
assert.equal(compiled.configuration.mutatingOperations, "must-be-denied-by-endpoint-owner");
assert.throws(() => compileWudRecipe("docker.example.test", "2376", id, "read-only"));
const privateFixture = await mkdtemp(join(tmpdir(), "wud-generated-password-fixture-"));
await prepareMultiServiceFiles({ schemaVersion: 2, services: [{ mounts: [] }],
  privateFiles: [{ id: "admin-password", bytes: 48, format: "alphanumeric" }] },
  privateFixture, join(privateFixture, "data"));
const password = await readFile(join(privateFixture, "secrets", "admin-password"), "utf8");
assert.equal(password.length, generatedPrivateFileLength(48, "alphanumeric"));
await rm(privateFixture, { recursive: true, force: true });

function fixture() {
  const events: string[] = [];
  let denied = true;
  let containers: unknown = [{ id, watcher: "approved", image: { id: `sha256:${id}`, name: "owner/image",
    tag: { value: "1.0.0", semver: true }, digest: { watch: false }, registry: { name: "hub" } },
    result: { tag: "1.0.1" }, updateAvailable: true }];
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const project = { id: "wud-fixture", owner: "wud-fixture", root: "/tmp/wud-fixture/.selfhost/shared",
    directory: "/tmp/wud-fixture/.selfhost/shared/wud-fixture", dockerContext: "default", ownership: "verified-existing" };
  const sourceRecord = { schemaVersion: 1, project, revision: 1, manifest: { project },
    manifestHash: hash({ project }), checkpoint: { phase: "completed" } };
  const source = { ...sourceRecord, recordHash: hash(sourceRecord) };
  const input = { appId: "wud", inputs: { "docker-authority-mode": "docker-management-mtls", "docker-server-name": "docker.example.test",
    "docker-port": "2376", "watched-container-id": id } };
  const derived = { ...management, input, peerAppIds: [], sourceSha256: "b".repeat(64), recipeSha256: hash(management.recipe) };
  const selection = { appId: "wud", recipe: management.recipe, publishedPort: 18083 };
  const fingerprint = hash(selection);
  const bindingRecord = { schemaVersion: 1, kind: "shared-derived-recipe-binding", source, derived,
    selection, selectionFingerprint: fingerprint };
  const binding = { ...bindingRecord, bindingHash: hash(bindingRecord) } as unknown as SharedDerivedRecipeBinding;
  const plan = planWudAuthority(binding);
  const status: Record<string, any> = { command: "app status", appId: "wud", projectRoot: "/tmp/wud-fixture",
    status: "applied", mutation: false, ownerKind: "shared", runtime: { state: "running" }, selectionFingerprint: fingerprint,
    projectId: project.id, dockerContext: project.dockerContext, privateFiles: join(project.directory, "secrets", "wud"),
    remoteDockerAuthority: approveWudAuthority(binding, plan.approval),
    derivedRecipe: { appId: "wud", input, configuration: structuredClone(management.configuration),
      bindingHash: binding.bindingHash, sourceSha256: derived.sourceSha256, selectionFingerprint: fingerprint,
      recipeSha256: derived.recipeSha256 } };
  const context = { appId: "wud", projectRoot: status.projectRoot, status: async () => status,
    observeContainerImage: async () => ({ kind: "docker-api-container-image-observation", authorityMode: "docker-management-mtls",
      authorityFingerprint: "e".repeat(64), containerId: id, imageId: `sha256:${id}`, observedAt: new Date().toISOString(), authorizationVerified: false }),
    secrets: { readAdminPassword: async () => password }, http: { request: async (request: any) => {
      assert.equal(request.method, "GET");
      events.push(request.path);
      if (!request.headers) return { status: denied ? 401 : 200 };
      assert.equal(request.headers.Authorization, `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`);
      if (request.path === "/auth/user") return { status: 200, json: async () => ({ username: "admin", role: "admin", provider: "local" }) };
      assert.equal(request.path, "/api/containers");
      return { status: 200, json: async () => containers };
    } } } as unknown as SetupContext;
  return { context, status, events, allowAnonymous: () => { denied = false; },
    setContainers: (value: unknown) => { containers = value; } };
}
const happy = fixture();
const record = await adapter.firstRun(happy.context);
assert.equal(adapter.ready(record), true);
assert.equal(record.stage, "ready-management-authority");
assert.equal(record.administratorVerified, true);
assert.equal(record.selectedInventoryObserved, true);
assert.equal(record.authorityVerified, false);
assert.equal(record.usableForApplicationSetup, true);
assert.equal(adapter.ready({ ...record, authorityVerified: true, usableForApplicationSetup: true,
  dockerAuthorizationVerified: true }), false);
assert.equal(record.currentScanVerified, false);
assert.equal(record.dockerAuthorizationVerified, false);
assert.equal(record.restartPersistenceVerified, false);
await adapter.inspect!(happy.context);
const invalidPassword = fixture();
invalidPassword.context.secrets.readAdminPassword = async () => "p".repeat(48);
await assert.rejects(adapter.firstRun(invalidPassword.context), /saved administrator password/);
assert.equal(invalidPassword.events.includes("/api/containers/watch"), false);
const authority = fixture(); delete authority.context.observeContainerImage;
await assert.rejects(adapter.firstRun(authority.context), /observation route/);
assert.deepEqual(authority.events, []);
const drift = fixture(); drift.status.derivedRecipe.configuration.authorityFingerprint = "c".repeat(64);
await assert.rejects(adapter.firstRun(drift.context), /configuration differs/);
const anonymous = fixture(); anonymous.allowAnonymous();
await assert.rejects(adapter.firstRun(anonymous.context), /anonymous/);
const empty = fixture(); empty.setContainers([]);
await assert.rejects(adapter.firstRun(empty.context), /not observed/);
const scope = fixture(); scope.setContainers([{ id, watcher: "approved", image: { name: "owner/image" } }, { id: "c".repeat(64) }]);
await assert.rejects(adapter.firstRun(scope.context), /scope differs/);
const wrong = fixture(); wrong.setContainers([{ id: "c".repeat(64), watcher: "approved", image: { name: "owner/image" } }]);
await assert.rejects(adapter.firstRun(wrong.context), /inventory differs/);
console.log("WUD derived TLS recipe and bounded Basic/inventory observations: pass");
