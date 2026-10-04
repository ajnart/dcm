import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/netbird/manifest.json";
import { compileNetbirdConfiguration } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/netbird/configuration.ts";
import { isCanonicalPrivateBase64 } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-config-environment.ts";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { multiServiceManifest, prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import { preparePrivateConfigs } from "../src/lib/private-config.ts";

const input = { canonicalOrigin: "https://netbird.example.test", trustedProxyAddress: "127.0.0.1", ownerEmail: "owner@example.test" };
const compiled = compileNetbirdConfiguration(input);
assert.deepEqual(compiled, compileNetbirdConfiguration(input));
assert.deepEqual(validateAppRecipe(compiled.recipe, app), []);
// Keep the reusable private encoding fixture independent of UDP selection.
const primitiveFixture = structuredClone(compiled.recipe) as any;
primitiveFixture.services[0].environment = [];
delete primitiveFixture.services[1].additionalPorts;
const primitiveApp = structuredClone(app) as any;
primitiveApp.image.reference = primitiveFixture.services[0].imageTag;
assert.deepEqual(validateAppRecipe(primitiveFixture, primitiveApp), []);
assert.equal(compiled.requirements.runnable, true);
assert.equal(compiled.requirements.edge.grpcUpstream, "h2c");
assert.equal(compiled.requirements.bootstrap.lostResponse, "inspect-without-replaying");
for (const invalid of ["http://netbird.example.test", "https://localhost", "https://127.0.0.1", "https://netbird.example.test/path", "https://netbird.example.test:0", "https://netbird.example.test:65536", "https://user:password@netbird.example.test"]) {
  assert.throws(() => compileNetbirdConfiguration({ ...input, canonicalOrigin: invalid }));
}
for (const canonicalOrigin of ["https://netbird.localhost:4443", "https://netbird.example.test:8443"]) {
  const privateOrigin = compileNetbirdConfiguration({ ...input, canonicalOrigin });
  let literals = "";
  for (const part of privateOrigin.recipe.privateConfigs[0].parts) {
    if ("literal" in part) literals += part.literal;
  }
  assert.ok(literals.includes(`exposedAddress: ${JSON.stringify(canonicalOrigin)}`));
  assert.ok(!literals.includes(`${canonicalOrigin}:443`));
  assert.ok(literals.includes(`issuer: ${JSON.stringify(`${canonicalOrigin}/oauth2`)}`));
  assert.ok(literals.includes(JSON.stringify(`${canonicalOrigin}/nb-auth`)));
  assert.equal(privateOrigin.requirements.canonicalOrigin, canonicalOrigin);
  assert.equal(privateOrigin.requirements.runnable, true);
}
for (const invalid of ["0.0.0.0", "127.0.0.0/8", "8.8.8.8", "172.32.0.1", "::1"]) {
  assert.throws(() => compileNetbirdConfiguration({ ...input, trustedProxyAddress: invalid }));
}
assert.throws(() => compileNetbirdConfiguration({ ...input, password: "not-an-input" } as any));
assert.notEqual(compiled.selectionFingerprint, compileNetbirdConfiguration({ ...input, canonicalOrigin: "https://another.example.test" }).selectionFingerprint);
for (const bytes of [32, 33, 34, 128]) {
  const value = Buffer.alloc(bytes, 0xff).toString("base64");
  assert.ok(isCanonicalPrivateBase64(value, bytes));
  assert.ok(!isCanonicalPrivateBase64(value.replace(/=/g, ""), bytes) || bytes % 3 === 0);
  assert.ok(!isCanonicalPrivateBase64(value.replace(/\//g, "_"), bytes));
  assert.ok(!isCanonicalPrivateBase64(value, bytes + 1));
}
const directory = await mkdtemp(join(tmpdir(), "netbird-config-"));
const projectDirectory = join(directory, "candidate");
const dataDirectory = join(directory, "data");
try {
  // Private-config preparation is tested independently of the blocked edge.
  const manifest = multiServiceManifest({ recipe: primitiveFixture, images: compiled.images,
    projectId: "candidate", appsRoot: directory, projectDirectory, dataDirectory, dockerContext: "default",
    port: 18080, uid: 1000, gid: 1000,
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  await prepareMultiServiceFiles(compiled.recipe, projectDirectory, dataDirectory);
  const secrets = join(projectDirectory, "secrets");
  const configPath = join(secrets, "server-config");
  const config = await readFile(configPath, "utf8");
  for (const id of ["session-key", "store-key"]) {
    const value = await readFile(join(secrets, id), "utf8");
    assert.equal(value.length, 44);
    assert.ok(isCanonicalPrivateBase64(value, 32));
    assert.ok(config.includes(value));
    assert.ok(!JSON.stringify(compiled).includes(value));
    assert.ok(!JSON.stringify(manifest).includes(value));
    assert.equal((await lstat(join(secrets, id))).mode & 0o777, 0o600);
  }
  assert.ok(config.includes('issuer: "https://netbird.example.test/oauth2"'));
  assert.ok(config.includes('exposedAddress: "https://netbird.example.test:443"'));
  assert.ok(config.includes('trustedPeers: ["127.0.0.1/32"]'));
  const inode = (await lstat(configPath)).ino;
  await prepareMultiServiceFiles(compiled.recipe, projectDirectory, dataDirectory);
  assert.equal((await lstat(configPath)).ino, inode);
  assert.equal(await readFile(configPath, "utf8"), config);
  const keyPath = join(secrets, "store-key");
  const original = await readFile(keyPath, "utf8");
  // Same decoded bytes but noncanonical unused padding bits must fail.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const finalIndex = alphabet.indexOf(original[42]!);
  const noncanonical = `${original.slice(0, 42)}${alphabet[finalIndex + 1]}=`;
  assert.deepEqual(Buffer.from(noncanonical, "base64"), Buffer.from(original, "base64"));
  assert.ok(!isCanonicalPrivateBase64(noncanonical, 32));
  await writeFile(keyPath, noncanonical, { mode: 0o600 });
  await assert.rejects(prepareMultiServiceFiles(compiled.recipe, projectDirectory, dataDirectory), /format/);
  await assert.rejects(preparePrivateConfigs(compiled.recipe, secrets), /content/);
  await writeFile(keyPath, original, { mode: 0o600 });
  const raw = structuredClone(compiled.recipe) as any;
  delete raw.services[1].additionalPorts;
  raw.services[1].secretEnvironment = [{ name: "STORE_SECRET", fileId: "store-key" }];
  assert.ok(validateAppRecipe(raw, app).some((error: string) => error.includes("secret environment")));
  assert.throws(() => multiServiceManifest({ recipe: raw, images: compiled.images, projectId: "candidate",
    appsRoot: directory, projectDirectory, dataDirectory, dockerContext: "default", port: 18080,
    uid: 1000, gid: 1000,
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } }), /Base64/);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("NetBird pure candidate and canonical padded Base64 private config: pass (no runtime acceptance)");
