import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import gotify from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/gotify/recipe.json";
import docmost from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/docmost/recipe.json";
import { deriveSharedRecipe, bindSharedDerivedRecipe, assertSharedDerivedRecipeUnchanged,
  deriveSharedCreateRecipe, bindSharedCreateRecipe,
  restoreSharedDerivedRecipeSelection, sharedDerivedRecipeAdapter } from "../src/lib/shared-derived-recipe.ts";
import { resolveSharedServiceTarget } from "../src/lib/shared-service-target.ts";
import { sharedProjectCandidate, type SharedAppSelection } from "../src/lib/shared-compose-project.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const host = { projectRoot: "/tmp/derived-fixture", projectId: "derived_fixture", dockerContext: "default",
  uid: 1000, gid: 1000, timezone: "UTC" };
const observed = { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] };
const base: SharedAppSelection = { appId: "gotify", recipe: gotify, port: 18080,
  images: { gotify: `gotify/server:3.1.1@sha256:${"a".repeat(64)}` } };
function state(apps: SharedAppSelection[], revision: number): SharedProjectState {
  const candidate = sharedProjectCandidate({ ...host, apps, observed });
  const { ownership: _ownership, ...project } = candidate.manifest.project;
  const record = { schemaVersion: 1 as const, revision, manifestRevision: revision, previousHash: null,
    project, manifest: candidate.manifest, manifestHash: hash(candidate.manifest), units: candidate.units,
    selectionFingerprints: candidate.selectionFingerprints, settings: candidate.settings,
    checkpoint: { operation: "add" as const, phase: "completed" as const, appIds: apps.map((app) => app.appId).sort() } };
  return { ...record, recordHash: hash(record) };
}
const source = state([base], 1);
const haproxy = { appId: "haproxy", inputs: { "target-app-id": "gotify" } };
const headscale = { appId: "headscale", inputs: {
  "canonical-origin": "https://headscale.example.test", "magic-dns-domain": "mesh.example.test" } };
for (const input of [haproxy, headscale]) {
  const derived = deriveSharedRecipe(source, input);
  assert.deepEqual(deriveSharedRecipe(source, input), derived);
  assert.equal(derived.recipeSha256, hash(derived.recipe));
  const frontend = derived.recipe.services[0];
  const selection = { appId: input.appId, recipe: derived.recipe, images: {
    [input.appId]: `${frontend.imageTag}@sha256:${"b".repeat(64)}` }, port: 18081 };
  const binding = bindSharedDerivedRecipe(source, input, selection);
  assertSharedDerivedRecipeUnchanged(source, binding);
  const applied = state([base, selection], 2);
  assert.deepEqual(restoreSharedDerivedRecipeSelection(applied, binding), selection);
  const restored = restoreSharedDerivedRecipeSelection(applied, binding);
  restored.recipe.appId = "changed";
  assert.equal(binding.selection.recipe.appId, input.appId);
  const drift = state([base, selection], 2);
  drift.selectionFingerprints[input.appId] = "c".repeat(64);
  const { recordHash: _old, ...record } = drift; drift.recordHash = hash(record);
  assert.throws(() => restoreSharedDerivedRecipeSelection(drift, binding), /differs/);
  assert.throws(() => assertSharedDerivedRecipeUnchanged(applied, binding), /differs/);
  const changed = structuredClone(binding);
  changed.derived.recipe.services[0].purpose = "tampered";
  const { bindingHash: _ignored, ...changedRecord } = changed; changed.bindingHash = hash(changedRecord);
  assert.throws(() => restoreSharedDerivedRecipeSelection(applied, changed), /differs/);
  const staleSource = structuredClone(binding);
  staleSource.derived.sourceSha256 = "e".repeat(64);
  const { bindingHash: _prior, ...staleRecord } = staleSource; staleSource.bindingHash = hash(staleRecord);
  assert.throws(() => restoreSharedDerivedRecipeSelection(applied, staleSource), /differs/);
  const resumed = state([base, selection], 2);
  resumed.checkpoint.phase = "attempted";
  const { recordHash: _previous, ...resumeRecord } = resumed; resumed.recordHash = hash(resumeRecord);
  assert.deepEqual(restoreSharedDerivedRecipeSelection(resumed, binding), selection);
  if (input.appId === "haproxy") {
    const peerChanged = state([{ ...base, images: { gotify: `gotify/server:3.1.1@sha256:${"d".repeat(64)}` } }, selection], 2);
    assert.throws(() => restoreSharedDerivedRecipeSelection(peerChanged, binding), /differs/);
  }
}
for (const input of [{ appId: "unknown", inputs: {} },
  { ...haproxy, inputs: { "target-app-id": "http://gotify" } },
  { ...haproxy, inputs: { "target-app-id": "missing" } },
  { ...haproxy, inputs: { "target-app-id": "gotify", password: "not-allowed" } },
  { ...headscale, inputs: { ...headscale.inputs, "canonical-origin": "http://headscale.example.test" } }]) {
  assert.throws(() => deriveSharedRecipe(source, input));
}
const metadata = sharedDerivedRecipeAdapter("haproxy")!;
metadata.inputDefinitions["target-app-id"]!.maxLength = 1;
assert.equal(sharedDerivedRecipeAdapter("haproxy")!.inputDefinitions["target-app-id"]!.maxLength, 47);
assert.equal(sharedDerivedRecipeAdapter("unknown"), null);
const multiServicePeer: SharedAppSelection = { appId: "docmost", recipe: docmost, port: 18080,
  images: Object.fromEntries(docmost.services.map((service) => [service.id,
    `${service.imageTag}@sha256:${"a".repeat(64)}`])) };
const peerSource = state([multiServicePeer], 1);
const peerInput = { appId: "haproxy", inputs: { "target-app-id": "docmost" } };
const peerDerived = deriveSharedRecipe(peerSource, peerInput);
const proxySelection: SharedAppSelection = { appId: "haproxy", recipe: peerDerived.recipe, port: 18081,
  images: { haproxy: `${peerDerived.recipe.services[0].imageTag}@sha256:${"b".repeat(64)}` } };
const peerBinding = bindSharedDerivedRecipe(peerSource, peerInput, proxySelection);
const peerApplied = state([multiServicePeer, proxySelection], 2);
assert.deepEqual(restoreSharedDerivedRecipeSelection(peerApplied, peerBinding), proxySelection);
for (const kind of ["helper-service", "private-network"]) {
  const drift = structuredClone(peerApplied);
  if (kind === "helper-service") {
    const helperId = drift.units.docmost!.find((id) => id !== "docmost")!;
    drift.manifest.services.find((service) => service.id === helperId)!.image = `postgres:18@sha256:${"d".repeat(64)}`;
  } else {
    const network = drift.manifest.networks.find((entry) => entry.id !== "front")!;
    network.name = `${network.name}-changed`;
  }
  drift.manifestHash = hash(drift.manifest);
  const { recordHash: _old, ...record } = drift; drift.recordHash = hash(record);
  assert.throws(() => restoreSharedDerivedRecipeSelection(drift, peerBinding), /differs/);
}
for (const input of [headscale, haproxy]) {
  let peers: SharedAppSelection[] = [];
  if (input.appId === "haproxy") peers = [base];
  const planned = { ...host, apps: peers, observed };
  const derived = deriveSharedCreateRecipe(planned, input);
  const selection: SharedAppSelection = { appId: input.appId, recipe: derived.recipe, port: 18081,
    images: { [input.appId]: `${derived.recipe.services[0].imageTag}@sha256:${"b".repeat(64)}` } };
  const binding = bindSharedCreateRecipe(planned, input, selection);
  assert.equal(binding.kind, "shared-derived-create-binding");
  assert(!("checkpoint" in binding.source));
  assert(!("revision" in binding.source));
  const reviewed = state([...peers, selection], 1);
  reviewed.checkpoint = { operation: "create", phase: "reviewed", appIds: Object.keys(reviewed.units).sort() };
  const { recordHash: _hash, ...record } = reviewed; reviewed.recordHash = hash(record);
  assert.deepEqual(restoreSharedDerivedRecipeSelection(reviewed, binding), selection);
  // Planned source is not a completed-state authorization shortcut.
  assert.throws(() => resolveSharedServiceTarget(reviewed, input.appId), /completed/);
  assert.throws(() => assertSharedDerivedRecipeUnchanged(reviewed, binding), /differs/);
  const completed = state([...peers, selection], 4);
  assert.deepEqual(restoreSharedDerivedRecipeSelection(completed, binding), selection);
  const laterObservation = { ...planned, observed: { ...observed, checkedAt: "2026-10-04T00:00:00Z" } };
  assert.deepEqual(bindSharedCreateRecipe(laterObservation, input, selection), binding);
  const drift = structuredClone(binding);
  drift.source.timezone = "Europe/Berlin";
  const { bindingHash: _old, ...changed } = drift; drift.bindingHash = hash(changed);
  assert.throws(() => restoreSharedDerivedRecipeSelection(completed, drift), /differs/);
  assert.throws(() => bindSharedCreateRecipe(planned, input, { ...selection,
    images: { [input.appId]: derived.recipe.services[0].imageTag } }), /Pinned/);
  if (peers.length > 0) {
    const peerChanged = state([{ ...base, port: 19080 }, selection], 4);
    assert.throws(() => restoreSharedDerivedRecipeSelection(peerChanged, binding), /differs/);
  }
}
assert.throws(() => deriveSharedCreateRecipe({ ...host, apps: [], observed }, haproxy), /invalid|target/);
console.log("Shared app-owned derived recipes: explicit inputs, immutable replay and owner/source identity: pass");
