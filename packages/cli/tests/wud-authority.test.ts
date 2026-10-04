import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { planWudAuthority, approveWudAuthority, assertWudAuthorityClaim, assertWudAuthorityStatus }
  from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/wud/authority.ts";
import { compileWudRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/wud/configuration.ts";
import setup from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/wud/setup.ts";
import type { SharedDerivedRecipeBinding } from "../src/lib/shared-derived-recipe.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { generatedPrivateFileLength } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-file.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = "a".repeat(64);
function fixture(options: { host?: string; port?: string; id?: string; projectId?: string; context?: string;
  sourceHash?: string; revision?: number; publishedPort?: number } = {}): SharedDerivedRecipeBinding {
  const projectId = options.projectId ?? "authority-fixture";
  const project = { id: projectId, owner: projectId, root: "/tmp/wud-fixture/.selfhost/shared",
    directory: `/tmp/wud-fixture/.selfhost/shared/${projectId}`, dockerContext: options.context ?? "default", ownership: "verified-existing" };
  const sourceRecord = { schemaVersion: 1, project, revision: options.revision ?? 1,
    manifest: { project }, manifestHash: hash({ project }), checkpoint: { phase: "completed" } };
  const source = { ...sourceRecord, recordHash: hash(sourceRecord) };
  const inputs = { "docker-authority-mode": "docker-management-mtls", "docker-server-name": options.host ?? "docker.example.test", "docker-port": options.port ?? "2376",
    "watched-container-id": options.id ?? id };
  const compiled = compileWudRecipe(inputs["docker-server-name"], inputs["docker-port"], inputs["watched-container-id"], inputs["docker-authority-mode"]);
  const derived = { ...compiled, peerAppIds: [], input: { appId: "wud", inputs },
    sourceSha256: options.sourceHash ?? "b".repeat(64), recipeSha256: hash(compiled.recipe) };
  const selection = { appId: "wud", recipe: compiled.recipe, publishedPort: options.publishedPort ?? 18083 };
  const record = { schemaVersion: 1, kind: "shared-derived-recipe-binding", source, derived, selection,
    selectionFingerprint: hash(selection) };
  return { ...record, bindingHash: hash(record) } as unknown as SharedDerivedRecipeBinding;
}

const binding = fixture();
const plan = planWudAuthority(binding);
assert.deepEqual(planWudAuthority(binding), plan);
assert.equal(plan.authority.kind, "remoteTLS");
assert.equal(plan.authority.serverName, "docker.example.test");
assert.equal(plan.authority.port, 2376);
assert.equal(plan.authority.watchedContainerId, id);
assert.equal(plan.effects.watchSelectionIsAcl, false);
assert.equal(plan.effects.endpointAclVerified, false);
assert.equal(plan.effects.transportVerified, false);
assert.deepEqual(plan.authority.tlsFiles.map((file) => file.name), ["docker-ca", "docker-certificate", "docker-key"]);
assert(plan.authority.tlsFiles.every((file) => file.source === "owner"
  && file.ref === `local/authority-fixture/wud/${file.name}`
  && file.filePath === `${binding.source.project.directory}/secrets/wud/${file.name}`));
assert.match(plan.approval, /^WUD-REMOTE-DOCKER:authority-fixture:[a-f0-9]{64}$/);
const claim = approveWudAuthority(binding, plan.approval);
assert.deepEqual(assertWudAuthorityClaim(binding, claim), claim);
assert.equal(Object.hasOwn(claim, "approved"), false);
for (const token of ["APPLY:authority-fixture", "true", "approved", plan.approval + "\n", "WUD-REMOTE-DOCKER:authority-fixture:" + "c".repeat(64)]) {
  assert.throws(() => approveWudAuthority(binding, token), /authority approval/);
}
for (const changed of [fixture({ host: "other.example.test" }), fixture({ port: "2377" }), fixture({ id: "c".repeat(64) }),
  fixture({ projectId: "other-owner" }), fixture({ context: "rootless" }), fixture({ sourceHash: "c".repeat(64) }),
  fixture({ revision: 2 }), fixture({ publishedPort: 18084 })]) {
  assert.notEqual(planWudAuthority(changed).approval, plan.approval);
  assert.throws(() => approveWudAuthority(changed, plan.approval), /authority approval/);
  assert.throws(() => assertWudAuthorityClaim(changed, claim), /authority approval/);
}
for (const [target, key, value] of [["authority", "serverName", "other.example.test"], ["authority", "port", 2377],
  ["effects", "endpointAclVerified", true], ["effects", "transportVerified", true]] as const) {
  const changed: any = structuredClone(claim);
  changed.plan[target][key] = value;
  const { planHash: _oldPlan, approval: _oldToken, ...review } = changed.plan;
  changed.plan.planHash = hash(review);
  changed.plan.approval = `WUD-REMOTE-DOCKER:authority-fixture:${changed.plan.planHash}`;
  const { claimHash: _oldClaim, ...record } = changed;
  changed.claimHash = hash(record);
  assert.throws(() => assertWudAuthorityClaim(binding, changed), /authority approval/);
}
for (const field of ["name", "ref", "target", "filePath", "source"]) {
  const changed: any = structuredClone(claim);
  changed.plan.authority.tlsFiles[0][field] = "other";
  assert.throws(() => assertWudAuthorityClaim(binding, changed), /authority approval/);
}
assert.throws(() => assertWudAuthorityClaim(binding, { authorityFingerprint: plan.authority.authorityFingerprint, approved: true }), /authority approval/);
for (const host of ["docker.example.test.", "Docker.example.test", "127.0.0.1", "https://docker.example.test", "/var/run/docker.sock"]) {
  assert.throws(() => fixture({ host }));
}
for (const port of ["02376", "0", "65536", "2376\n"]) assert.throws(() => fixture({ port }));
const damaged = structuredClone(binding);
damaged.derived.recipeSha256 = "d".repeat(64);
assert.throws(() => planWudAuthority(damaged), /authority approval/);

function setupFixture(imageId: unknown = `sha256:${id}`) {
  const events: string[] = [];
  const status: Record<string, any> = { command: "app status", mutation: false, ownerKind: "shared", appId: "wud",
    projectRoot: "/tmp/wud-fixture", projectId: binding.source.project.id, dockerContext: binding.source.project.dockerContext,
    privateFiles: `${binding.source.project.directory}/secrets/wud`, status: "applied", runtime: { state: "running" },
    selectionFingerprint: binding.selectionFingerprint, remoteDockerAuthority: structuredClone(claim),
    derivedRecipe: { appId: "wud", input: binding.derived.input, configuration: binding.derived.configuration,
      bindingHash: binding.bindingHash, sourceSha256: binding.derived.sourceSha256,
      recipeSha256: binding.derived.recipeSha256, selectionFingerprint: binding.selectionFingerprint } };
  const context = { appId: "wud", projectRoot: status.projectRoot, status: async () => status,
    observeContainerImage: async () => ({ kind: "docker-api-container-image-observation", authorityMode: "docker-management-mtls",
      authorityFingerprint: "e".repeat(64), containerId: id, imageId: `sha256:${id}`, observedAt: new Date().toISOString(), authorizationVerified: false }),
    secrets: { readAdminPassword: async () => { events.push("read-local-admin"); return "p".repeat(generatedPrivateFileLength(48, "alphanumeric")); } },
    http: { request: async (request: any) => {
      assert.equal(request.method, "GET"); events.push(request.path);
      if (!request.headers) return { status: 401 };
      if (request.path === "/auth/user") return { status: 200, json: async () => ({ username: "admin", role: "admin", provider: "local" }) };
      assert.equal(request.path, "/api/containers");
      return { status: 200, json: async () => [{ id, watcher: "approved", image: { id: imageId, name: "owner/image" } }] };
    } } } as unknown as SetupContext;
  return { status, context, events };
}
const happy = setupFixture();
assert.deepEqual(assertWudAuthorityStatus(happy.status, happy.status.remoteDockerAuthority), claim);
const observed = await setup.firstRun(happy.context);
assert.equal(setup.ready(observed), true);
assert.equal(observed.stage, "ready-management-authority");
assert.equal(observed.administratorVerified, true);
assert.equal(observed.selectedInventoryObserved, true);
assert.equal(observed.observedImageId, `sha256:${id}`);
assert.equal(observed.authorityVerified, false);
assert.equal(observed.usableForApplicationSetup, true);
assert.equal(setup.ready({ ...observed, authorityVerified: true, usableForApplicationSetup: true,
  dockerAuthorizationVerified: true }), false);
assert.equal(observed.dockerAuthorizationVerified, false);
assert.equal(observed.currentScanVerified, false);
assert.equal(observed.restartPersistenceVerified, false);
for (const imageId of [null, id, "sha256:short", `sha256:${"A".repeat(64)}`]) {
  await assert.rejects(setup.firstRun(setupFixture(imageId).context), /inventory differs/);
}
const missingCallback = setupFixture();
delete missingCallback.context.observeContainerImage;
await assert.rejects(setup.firstRun(missingCallback.context), /observation route/);
assert.deepEqual(missingCallback.events, []);
const serializedConsent = setupFixture();
serializedConsent.status.remoteDockerAuthority = { approved: true };
await setup.firstRun(serializedConsent.context); // status consent never supplies authority.
const stale = setupFixture();
stale.context.observeContainerImage = async () => ({ kind: "docker-api-container-image-observation", authorityMode: "docker-management-mtls",
  authorityFingerprint: "e".repeat(64), containerId: id, imageId: `sha256:${id}`, observedAt: new Date(Date.now() - 300001).toISOString(), authorizationVerified: false,
  imageReference: "owner/image", repoTags: [], repoDigests: [] });
await assert.rejects(setup.firstRun(stale.context), /authority mode/);
assert.deepEqual(stale.events, []);
console.log("WUD exact-owner pre-start credential authority contract: pass (synthetic, no endpoint ACL or TLS observation)");
