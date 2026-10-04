import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecipeImageReference, matchesRecipeImagePin, pinRecipeImage } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/recipe-image-reference.ts";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { multiServiceManifest, pinnedMultiServiceImages } from "../src/lib/multi-service-recipe.ts";
import { pinnedImageFromManifest, resolveImageTag } from "../src/app.ts";
import { fetchPublicRegistryImageConfig, verifyRegistryImageConfig } from "../src/lib/public-registry-config.ts";
import { loadCompatibilityReceipts, publishCompatibilityObservation, type CompatibilityReceiptContract,
  type VerifiedRunObservation } from "../src/lib/compatibility-receipts.ts";
import { requiredCompatibilityChecks } from "../src/lib/catalog-compatibility.ts";

const digest = `sha256:${"a".repeat(64)}`;
const other = `sha256:${"b".repeat(64)}`;
const reference = `registry.example:5000/team/app@${digest}`;
for (const valid of [reference, "example:1.2.3", `example:1.2.3@${digest}`]) {
  assert.equal(isRecipeImageReference(valid), true);
}
for (const invalid of ["example", `example:latest@${digest}`, `example@${digest}@${digest}`,
  `https://example/app@${digest}`, `../example@${digest}`, `example@sha256:bad`, `${reference}\n`]) {
  assert.equal(isRecipeImageReference(invalid), false);
}
assert.equal(pinRecipeImage(reference, digest), reference);
assert.equal(pinRecipeImage("example:1.2.3", digest), `example:1.2.3@${digest}`);
assert.throws(() => pinRecipeImage(reference, other), /differs/);
assert.equal(matchesRecipeImagePin(reference, reference), true);
assert.equal(matchesRecipeImagePin(reference, `registry.example:5000/team/app@${other}`), false);
assert.equal(matchesRecipeImagePin(reference, `registry.example:5000/team/other@${digest}`), false);
assert.equal(matchesRecipeImagePin(reference, `registry.example:5000/team/app:guessed@${digest}`), false);
assert.equal(matchesRecipeImagePin("example:1.2.3", `example:1.2.3@${digest}`), true);
assert.equal(matchesRecipeImagePin("example:1.2.3", `example:1.2.4@${digest}`), false);

const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/uptime-kuma/", import.meta.url);
const recipe = JSON.parse(await readFile(new URL("recipe.json", catalog), "utf8"));
const app = JSON.parse(await readFile(new URL("manifest.json", catalog), "utf8"));
recipe.services[0].imageTag = reference;
app.image.reference = reference;
assert.deepEqual(validateAppRecipe(recipe, app), []);
const pins = pinnedMultiServiceImages(recipe, [`uptime-kuma=${reference}`]);
assert.deepEqual(pins, { "uptime-kuma": reference });
assert.throws(() => pinnedMultiServiceImages(recipe, [`uptime-kuma=registry.example:5000/team/app@${other}`]), /unique recipe/);
const manifest = multiServiceManifest({ recipe, images: pins, projectId: "image-fixture",
  appsRoot: "/tmp/image-fixture", projectDirectory: "/tmp/image-fixture/project",
  dataDirectory: "/tmp/image-fixture/data", dockerContext: "default", port: 18001, uid: 1000, gid: 1000,
  observed: { checkedAt: "2026-10-03T00:00:00.000Z", ports: [], paths: [], networks: [], volumes: [] } });
assert.equal(manifest.services[0].image, reference);

const index = { schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", digest,
  manifests: [{ digest: other, platform: { os: "linux", architecture: "amd64" } }] };
assert.equal(pinnedImageFromManifest(reference, "amd64", index).image, reference);
assert.throws(() => pinnedImageFromManifest(reference, "amd64", { ...index, digest: other }), /differs/);

const config = new TextEncoder().encode(JSON.stringify({ architecture: "amd64", os: "linux", config: { User: "1000" } }));
const configDescriptor = { mediaType: "application/vnd.docker.container.image.v1+json",
  digest: `sha256:${createHash("sha256").update(config).digest("hex")}`, size: config.byteLength };
const raw = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.docker.distribution.manifest.v2+json",
  config: configDescriptor, layers: [] });
const manifestDigest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
const publisher = `atdr.meo.ws/team/app@${manifestDigest}`;
const calls: { reference: string; raw: boolean }[] = [];
const inspect = async (selected: string, rawOutput: boolean): Promise<string> => {
  calls.push({ reference: selected, raw: rawOutput });
  if (rawOutput) return raw;
  // Real Buildx returns a descriptor, not an invented schemaVersion/config.
  return JSON.stringify({ mediaType: "application/vnd.docker.distribution.manifest.v2+json", digest: manifestDigest });
};
const request: typeof fetch = async (endpoint, options) => {
  assert.equal(String(endpoint), `https://atdr.meo.ws/v2/team/app/blobs/${configDescriptor.digest}`);
  assert.equal(options?.redirect, "error");
  assert.equal(options?.credentials, "omit");
  return new Response(config);
};
const resolved = await resolveImageTag(publisher, "amd64", inspect, request);
assert.deepEqual(resolved, { image: publisher, indexDigest: null, manifestDigest,
  platformDigest: manifestDigest, configDigest: configDescriptor.digest });
assert.deepEqual(calls, [{ reference: publisher, raw: false }, { reference: publisher, raw: true }]);
await assert.rejects(resolveImageTag(publisher, "arm64", inspect, request), /host architecture/);
await assert.rejects(resolveImageTag(publisher, "amd64", async (_selected, rawOutput) => {
  if (rawOutput) return `${raw}\n`;
  return inspect(publisher, false);
}, request), /raw manifest differs/);
assert.throws(() => verifyRegistryImageConfig(config, { ...configDescriptor, digest }), /unavailable or invalid/);
await assert.rejects(fetchPublicRegistryImageConfig(publisher, configDescriptor, async () => new Response(config.slice(1))), /unavailable or invalid/);
await assert.rejects(fetchPublicRegistryImageConfig(publisher, { ...configDescriptor, size: 1024 * 1024 + 1 }, request), /unavailable or invalid/);
await assert.rejects(fetchPublicRegistryImageConfig(publisher, configDescriptor, async () => new Response(config,
  { headers: { "content-length": String(config.length + 1) } })), /unavailable or invalid/);
await assert.rejects(fetchPublicRegistryImageConfig(publisher, configDescriptor, async () => new Response(new Uint8Array(config.length + 1))), /unavailable or invalid/);
await assert.rejects(fetchPublicRegistryImageConfig(publisher, configDescriptor, async () => new Response(null,
  { status: 302, headers: { location: "https://foreign.example/config" } })), /unavailable or invalid/);
await assert.rejects(fetchPublicRegistryImageConfig(`private.example/team/app@${digest}`, configDescriptor, request), /unavailable or invalid/);

const ghcrReference = `ghcr.io/team/app@${manifestDigest}`;
for (const challenge of [
  'Bearer realm="https://foreign.example/token",service="ghcr.io",scope="repository:team/app:pull"',
  'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:other/app:pull"',
  'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:team/app:pull,push"',
]) {
  let requests = 0;
  await assert.rejects(fetchPublicRegistryImageConfig(ghcrReference, configDescriptor, async () => {
    requests += 1;
    return new Response(null, { status: 401, headers: { "www-authenticate": challenge } });
  }), /unavailable or invalid/);
  assert.equal(requests, 1);
}
let anonymousRequests = 0;
await fetchPublicRegistryImageConfig(ghcrReference, configDescriptor, async (endpoint, options) => {
  anonymousRequests += 1;
  const headers = new Headers(options?.headers);
  assert.equal(options?.credentials, "omit");
  assert.equal(options?.redirect, "error");
  if (anonymousRequests === 1) {
    assert.equal(headers.has("authorization"), false);
    return new Response(null, { status: 401, headers: { "www-authenticate":
      'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:team/app:pull"' } });
  }
  if (anonymousRequests === 2) {
    assert.equal(String(endpoint), "https://ghcr.io/token?service=ghcr.io&scope=repository%3Ateam%2Fapp%3Apull");
    assert.equal(headers.has("authorization"), false);
    return Response.json({ token: "fixture-token" });
  }
  assert.equal(headers.get("authorization"), "Bearer fixture-token");
  return new Response(config);
});
assert.equal(anonymousRequests, 3);
let dockerRequests = 0;
await fetchPublicRegistryImageConfig(`docker.io/alpine@${manifestDigest}`, configDescriptor, async (endpoint) => {
  dockerRequests += 1;
  if (dockerRequests === 1) {
    assert.equal(String(endpoint), `https://registry-1.docker.io/v2/library/alpine/blobs/${configDescriptor.digest}`);
    return new Response(null, { status: 401, headers: { "www-authenticate":
      'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"' } });
  }
  if (dockerRequests === 2) {
    assert.equal(String(endpoint), "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Falpine%3Apull");
    return Response.json({ access_token: "fixture-token" });
  }
  return new Response(config);
});
assert.equal(dockerRequests, 3);
const wrongOs = new TextEncoder().encode(JSON.stringify({ architecture: "amd64", os: "windows" }));
assert.throws(() => verifyRegistryImageConfig(wrongOs, { ...configDescriptor, size: wrongOs.byteLength,
  digest: `sha256:${createHash("sha256").update(wrongOs).digest("hex")}` }), /supported Linux/);
await assert.rejects(fetchPublicRegistryImageConfig(ghcrReference, configDescriptor, async (endpoint) => {
  if (String(endpoint).includes("/blobs/")) return new Response(null, { status: 401, headers: {
    "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' } });
  return new Response(null, { status: 302, headers: { location: "https://foreign.example/token" } });
}), /unavailable or invalid/);

const ociConfig = { ...configDescriptor, mediaType: "application/vnd.oci.image.config.v1+json" };
const ociRaw = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json", config: ociConfig, layers: [] });
const ociDigest = `sha256:${createHash("sha256").update(ociRaw).digest("hex")}`;
const ociResult = await resolveImageTag(`ghcr.io/team/app@${ociDigest}`, "amd64", async (_selected, rawOutput) => {
  if (rawOutput) return ociRaw;
  return JSON.stringify({ mediaType: "application/vnd.oci.image.manifest.v1+json", digest: ociDigest });
}, async () => new Response(config));
assert.equal(ociResult.platformDigest, ociDigest);
assert.equal(ociResult.indexDigest, null);

// Synthetic receipt storage verifies identity/schema only, not live acceptance.
const receiptRoot = await mkdtemp(join(tmpdir(), "digest-receipt-fixture-"));
try {
  const receiptContract: CompatibilityReceiptContract = {
    appId: "example-app", dimension: "compose", homarrMode: "tile-only",
    owner: { projectFingerprint: "c".repeat(64), revision: 2, manifestHash: "d".repeat(64) },
    recipeSha256: "e".repeat(64), subjectSha256: "f".repeat(64), images: { app: publisher },
    verifier: { id: "compose-owner-verifier", sourceSha256: "1".repeat(64), release: "1.1.0" },
  };
  const { homarrMode: _mode, ...identity } = structuredClone(receiptContract);
  const observation: VerifiedRunObservation = { ...identity, runId: "digest-image-fixture",
    checkedAt: "2026-10-03T10:00:00Z", cleanup: "completed",
    checks: requiredCompatibilityChecks("compose", "tile-only").map((id) => ({ id, result: "pass" })) };
  const published = await publishCompatibilityObservation(receiptRoot, observation, receiptContract, { expectedRevision: 0 });
  assert.equal(published.receipt?.images.app, publisher);
  const options = { checkedAt: "2026-10-03T15:00:00Z" };
  assert.equal((await loadCompatibilityReceipts(receiptRoot, [receiptContract], options)).receipts.length, 1);
  for (const changed of [
    { ...receiptContract, images: { app: `atdr.meo.ws/team/app@${other}` } },
    { ...receiptContract, images: { app: `atdr.meo.ws/team/other@${manifestDigest}` } },
    { ...receiptContract, owner: { ...receiptContract.owner, revision: 3 } },
    { ...receiptContract, recipeSha256: "2".repeat(64) },
    { ...receiptContract, subjectSha256: "3".repeat(64) },
  ]) {
    assert.equal((await loadCompatibilityReceipts(receiptRoot, [changed], options)).receipts.length, 0);
  }
  for (const unpinned of ["atdr.meo.ws/team/app:1", "atdr.meo.ws/team/app", "atdr.meo.ws/team/app@sha256:bad"]) {
    await assert.rejects(loadCompatibilityReceipts(receiptRoot,
      [{ ...receiptContract, images: { app: unpinned } }], options), /contract is invalid/);
  }
  await assert.rejects(publishCompatibilityObservation(receiptRoot, { ...observation,
    owner: { ...observation.owner, revision: 3 } }, receiptContract, { expectedRevision: 1 }));
} finally {
  await rm(receiptRoot, { recursive: true });
}
process.stdout.write("recipe image-reference checks passed\n");
