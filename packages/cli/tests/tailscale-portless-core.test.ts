import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { multiServiceManifest, checkedConnectorRecipe } from "../src/lib/multi-service-recipe.ts";
import { sharedProjectCandidate, prepareSharedProjectFiles } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedUnitHandoff, sharedUnitSecretHandoff, sharedUnitStatus } from "../src/lib/shared-unit-setup.ts";
import { resolveSharedAppMetadata } from "../src/lib/resolved-app.ts";
import { sharedHomarrPendingConnector, sharedHomarrPreparedJob } from "../src/shared-homarr.ts";

const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/tailscale/", import.meta.url);
const app = JSON.parse(await readFile(new URL("manifest.json", catalog), "utf8"));
const recipe = JSON.parse(await readFile(new URL("recipe.json", catalog), "utf8"));
assert.deepEqual(validateAppRecipe(recipe, app), []);
assert.equal(checkedConnectorRecipe(recipe), true);
assert.equal(sharedHomarrPreparedJob("tailscale", app, recipe), null);
const connectorRecap = sharedHomarrPendingConnector("tailscale", app, recipe)!;
assert.equal(connectorRecap.state, "connector-applied-unverified");
assert.equal(connectorRecap.enrollmentStatus, "pending");
assert.equal(connectorRecap.browserUrl, null);
assert.equal(connectorRecap.integrationKind, null);
assert.equal(connectorRecap.apiKeyFile, null);
assert.equal(connectorRecap.notebookStatus, "not-published");
assert.throws(() => sharedHomarrPendingConnector("tailscale", { ...app, id: "wrong" }, recipe), /differs/);
assert.equal(sharedHomarrPendingConnector("homarr", {}, { appId: "homarr" }), null);
const root = await mkdtemp(join(tmpdir(), "selfhost-tailscale-portless-"));
try {
  const projectId = "tailscale-portless-fixture";
  const selection = { appId: "tailscale", recipe,
    images: { tailscale: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` }, port: null };
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId, dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [selection],
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  const service = candidate.manifest.services[0];
  assert.deepEqual(service.ports, []);
  assert.deepEqual(service.networks, ["front", "tailscale-private"]);
  assert.deepEqual(service.entrypoint, ["/usr/local/bin/tailscaled"]);
  assert.deepEqual(service.command, ["--tun=userspace-networking", "--state=/var/lib/tailscale/tailscaled.state", "--socket=/tmp/tailscaled.sock"]);
  assert.deepEqual(service.environment, [{ name: "TS_AUTHKEY", value: "file:/run/secrets/auth-key" }]);
  assert.equal(service.secretRefs[0].target, "auth-key");
  assert.equal(service.envFilePath, undefined);
  assert.equal(service.profiles, undefined);
  assert.equal(service.manualProbe, undefined);
  assert.equal(service.healthcheck, undefined);
  assert.equal(service.restart, "unless-stopped");
  assert.equal(service.mounts[0].kind, "volume");
  assert.throws(() => resolveSharedAppMetadata("tailscale", app, recipe, service), /exact catalog frontend/);
  const compilerInput = { recipe, images: selection.images, projectId,
    appsRoot: root, projectDirectory: candidate.projectDirectory,
    dataDirectory: join(candidate.projectDirectory, "data", "tailscale"), dockerContext: "default",
    port: null, uid: 1000, gid: 1000, observed: candidate.manifest.observed };
  for (const mutate of [
    (value: any) => { value.services[0].restart = "no"; },
    (value: any) => { value.services[0].publishTargetPort = 8080; },
    (value: any) => { value.services[0].healthcheck = { test: ["CMD", "true"] }; },
    (value: any) => { value.privateFiles[0] = { id: "auth-key", bytes: 48 }; },
    (value: any) => { value.onboarding.kind = "no-account"; },
  ]) {
    const invalid = structuredClone(recipe);
    mutate(invalid);
    assert.ok(validateAppRecipe(invalid, app).length > 0);
    assert.throws(() => multiServiceManifest({ ...compilerInput, recipe: invalid }), /Private connectors/);
    assert.throws(() => sharedProjectCandidate({ projectRoot: root, projectId, dockerContext: "default",
      uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [{ ...selection, recipe: invalid }],
      observed: candidate.manifest.observed }), /Private connectors/);
  }
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const plan = await owner.plan();
  assert.equal(plan.status, "pass");
  await owner.render(plan);
  // Synthetic owner input only: no provider credential or local credential store is read.
  await prepareSharedProjectFiles(candidate, [selection], { "tailscale:auth-key": Buffer.from("fixture-owner-key-not-issued") });
  const compose = await readFile(plan.render.target, "utf8");
  assert.ok(compose.includes("tailscaled"));
  assert.ok(compose.includes("file:/run/secrets/auth-key"));
  assert.ok(!compose.includes("fixture-owner-key-not-issued"));
  assert.ok(!compose.includes("self-host-manual"));
  assert.ok(!compose.includes("privileged:"));
  assert.ok(!compose.includes("devices:"));
  let state = await saveSharedProjectState(candidate, { operation: "create", phase: "reviewed", appIds: ["tailscale"] },
    { revision: 0, manifestHash: null, checkpoint: null });
  for (const phase of ["attempted", "completed"] as const) state = await saveSharedProjectState(candidate,
    { operation: "create", phase, appIds: ["tailscale"] },
    { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  const recipeFor = () => ({ recipe, boundedApply: true });
  const status = await sharedUnitStatus(root, projectId, "tailscale", recipeFor, () => "fixture", false);
  assert.equal(status.status, "connector-applied-unverified");
  assert.equal(status.enrollmentStatus, "pending");
  assert.equal(status.enrollmentVerified, false);
  assert.equal(status.clientAccessVerified, false);
  assert.equal(status.runtime, null);
  assert.equal(status.port, null);
  assert.equal(status.url, null);
  assert.equal(status.username, null);
  assert.equal(status.passwordFile, null);
  assert.equal(status.tokenFile, null);
  // Even stale undeclared API-key metadata cannot turn a connector into an app credential.
  await writeFile(join(status.privateFiles, "tailscale-api-key"), "fixture-not-an-api-key", { mode: 0o600 });
  const handoff = await sharedUnitHandoff(root, projectId, "tailscale", recipeFor, () => "fixture");
  assert.equal(handoff.enrollmentStatus, "pending");
  assert.equal(handoff.connector, true);
  assert.equal(handoff.url, null);
  assert.equal(handoff.setupUrl, null);
  assert.equal(handoff.apiKeyFile, null);
  assert.equal(handoff.passwordFile, null);
  const secretHandoff = await sharedUnitSecretHandoff(root, projectId, "tailscale", recipeFor, () => "fixture");
  assert.equal(secretHandoff.apiKey, null);
  assert.equal(secretHandoff.password, null);
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS Tailscale portless daemon/catalog/render/shared handoff contracts (synthetic only, no Docker/enrollment)");
