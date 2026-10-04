import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { reviewSharedCreateSelections, sharedHostRequest, sharedPlanApproval } from "../src/shared-project.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { restoreSharedDerivedRecipeSelection } from "../src/lib/shared-derived-recipe.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const recipes = new Map(["gotify", "tailscale"].map((id) => [id, JSON.parse(readFileSync(new URL(
  `../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${id}/recipe.json`, import.meta.url), "utf8"))]));
const options = { projectRoot: "/tmp/shared-fresh-install-fixture", projectId: "fresh-install",
  appIds: ["gotify", "haproxy", "headscale", "minio", "tailscale"],
  ports: { gotify: 8080, "minio.console": 19001 }, inputs: {
    haproxy: { "target-app-id": "gotify" },
    headscale: { "canonical-origin": "https://headscale.example.test", "magic-dns-domain": "mesh.example.test" },
    minio: { edition: "aistor-licensed", "root-username": "selfhostadminroot00001" },
  } };
const dependencies = {
  recipeFor(appId: string) {
    const recipe = recipes.get(appId);
    assert(recipe, "derived apps must not need a fabricated static recipe");
    return { recipe, services: recipe.services, defaults: recipe.defaults, storage: recipe.storage,
      boundedApply: true, recipeSha256: hash(recipe) };
  },
  async resolveImage(appId: string, derivedRecipe?: Record<string, any>) {
    const recipe = derivedRecipe ?? recipes.get(appId);
    return { command: "app image", appId, recipeSha256: hash(recipe),
      images: recipe.services.map((service: Record<string, any>) => ({ service: service.id,
        image: `${service.imageTag}@sha256:${"a".repeat(64)}` })) };
  },
};
const requests: ReturnType<typeof sharedHostRequest>[] = [];
const observe = (request: ReturnType<typeof sharedHostRequest>) => {
  requests.push(request);
  return { dockerContext: "default", uid: 1000, gid: 1000, timezone: "UTC",
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } };
};
const result = await reviewSharedCreateSelections(options, dependencies, observe);
assert.equal(requests.length, 2, "derived plans recheck all final selected ports without mutations");
assert.deepEqual(requests[1]!.tcpPorts.slice().sort((a, b) => a - b), [8080, 9000, 18081, 18082, 19001]);
assert.equal(result.selections.find((selection) => selection.appId === "tailscale")!.port, null);
assert.deepEqual(result.selections.find((selection) => selection.appId === "minio")!.publishedPorts, { console: 19001 });
assert.equal(result.derivedBindings.length, 3);
assert(result.derivedBindings.every((binding) => binding.kind === "shared-derived-create-binding"));
assert(result.selections.filter((selection) => ["haproxy", "headscale", "minio"].includes(selection.appId))
  .every((selection) => /^[0-9a-f]{64}$/.test(selection.derivationSha256!)));
assert.equal(result.candidate.units.tailscale!.length, 1);
const record = { schemaVersion: 1 as const, revision: 1, manifestRevision: 1, previousHash: null,
  project: { ...result.candidate.manifest.project }, manifest: result.candidate.manifest,
  manifestHash: hash(result.candidate.manifest), units: result.candidate.units,
  settings: result.candidate.settings, selectionFingerprints: result.candidate.selectionFingerprints,
  checkpoint: { operation: "create" as const, phase: "reviewed" as const, appIds: [...options.appIds].sort() } };
delete record.project.ownership;
const state = { ...record, recordHash: hash(record) } as SharedProjectState;
for (const binding of result.derivedBindings) {
  assert.deepEqual(restoreSharedDerivedRecipeSelection(state, binding), binding.selection);
}
const repeated = await reviewSharedCreateSelections(options, dependencies, observe);
assert.equal(sharedPlanApproval(repeated.candidate), sharedPlanApproval(result.candidate));
const derivedPeerOptions = { ...options, appIds: ["haproxy", "headscale"], ports: {}, inputs: {
  haproxy: { "target-app-id": "headscale" }, headscale: options.inputs.headscale } };
const derivedPeer = await reviewSharedCreateSelections(derivedPeerOptions, dependencies, observe);
const reversedPeer = await reviewSharedCreateSelections({ ...derivedPeerOptions,
  appIds: [...derivedPeerOptions.appIds].reverse() }, dependencies, observe);
assert.deepEqual(reversedPeer, derivedPeer, "derived peer rounds and port selection are independent of input order");
const proxyBinding = derivedPeer.derivedBindings.find((binding) => binding.selection.appId === "haproxy")!;
assert.deepEqual(proxyBinding.derived.peerAppIds, ["headscale"]);
assert.deepEqual(proxyBinding.source.apps.map((selection) => selection.appId), ["headscale"]);
const peerRecord = { ...record, project: { ...derivedPeer.candidate.manifest.project },
  manifest: derivedPeer.candidate.manifest, manifestHash: hash(derivedPeer.candidate.manifest),
  units: derivedPeer.candidate.units, settings: derivedPeer.candidate.settings,
  selectionFingerprints: derivedPeer.candidate.selectionFingerprints,
  checkpoint: { operation: "create" as const, phase: "reviewed" as const, appIds: [...derivedPeerOptions.appIds].sort() } };
delete peerRecord.project.ownership;
const peerState = { ...peerRecord, recordHash: hash(peerRecord) } as SharedProjectState;
for (const binding of derivedPeer.derivedBindings) {
  assert.deepEqual(restoreSharedDerivedRecipeSelection(peerState, binding), binding.selection);
}
await assert.rejects(reviewSharedCreateSelections({ ...derivedPeerOptions, inputs: {
  ...derivedPeerOptions.inputs, haproxy: { "target-app-id": "missing" } } }, dependencies, observe),
  /cannot resolve.*haproxy:.*target/);
await assert.rejects(reviewSharedCreateSelections({ ...derivedPeerOptions, inputs: {
  ...derivedPeerOptions.inputs, headscale: { ...derivedPeerOptions.inputs.headscale, "canonical-origin": "invalid" } } },
dependencies, observe), /cannot resolve.*headscale:/);
await assert.rejects(reviewSharedCreateSelections({ ...derivedPeerOptions, inputs: {
  ...derivedPeerOptions.inputs, headscale: { ...derivedPeerOptions.inputs.headscale, invented: "value" } } },
dependencies, observe), /cannot resolve.*headscale:/);
const changed = await reviewSharedCreateSelections({ ...options, inputs: { ...options.inputs,
  minio: { ...options.inputs.minio, "root-username": "selfhostadminroot00002" } } }, dependencies, observe);
assert.notEqual(sharedPlanApproval(changed.candidate), sharedPlanApproval(result.candidate));
const portChanged = await reviewSharedCreateSelections({ ...options,
  ports: { ...options.ports, "minio.console": 19002 } }, dependencies, observe);
assert.notEqual(sharedPlanApproval(portChanged.candidate), sharedPlanApproval(result.candidate));
await assert.rejects(reviewSharedCreateSelections({ ...options,
  ports: { ...options.ports, "minio.console": 8080 } }, dependencies, observe), /distinct/);
const reserved = await reviewSharedCreateSelections({ ...options,
  ports: { ...options.ports, minio: 18082, "minio.console": 18081 } }, dependencies, observe);
assert.equal(reserved.selections.find((selection) => selection.appId === "minio")!.port, 18082);
assert.equal(reserved.selections.find((selection) => selection.appId === "headscale")!.port, 18084);
assert.deepEqual(reserved.selections.find((selection) => selection.appId === "minio")!.publishedPorts, { console: 18081 });
await assert.rejects(reviewSharedCreateSelections({ ...options,
  ports: { ...options.ports, "minio.undefined": 19002 } }, dependencies, observe), /undeclared/);
await assert.rejects(reviewSharedCreateSelections({ ...options,
  inputs: { ...options.inputs, gotify: { invented: "value" } } }, dependencies, observe), /no derived/);
await assert.rejects(reviewSharedCreateSelections(options, dependencies, (request) => {
  const host = observe(request);
  if (request.tcpPorts.length > 1) host.uid = 1001;
  return host;
}), /identity changed/);
assert.throws(() => sharedProjectCandidate({ ...result.derivedBindings[0]!.source,
  apps: result.selections.map((selection) => ({ ...selection, derivationSha256: "invalid" })) } as any), /invalid/);
console.log("Fresh shared install: real derived inputs, pinned peers, all reviewed ports and portless connector: pass");
