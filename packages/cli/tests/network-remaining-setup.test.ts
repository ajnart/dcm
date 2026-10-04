import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolveSharedServiceTarget } from "../src/lib/shared-service-target.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { multiServiceManifest, prepareMultiServiceFiles, verifySharedGeneratedConfigFiles } from "../src/lib/multi-service-recipe.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { homarrStackMapping, homarrIntegrationCredentials, homarrNativeEligibility } from "../src/lib/homarr-stack-mapping.ts";
import traefik, { TRAEFIK_API_PATHS, TRAEFIK_API_RULE } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/traefik/setup.ts";
import traefikRecipe from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/traefik/recipe.json";
import type { SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { bcryptHashTemplateReferencesAllowed } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/config-hash-reference.ts";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import traefikApp from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/traefik/manifest.json";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function fixture(): SharedProjectState {
  const project = { id: "network_fixture", owner: "network_fixture", dockerContext: "default",
    root: "/tmp/network-fixture/.selfhost/shared", directory: "/tmp/network-fixture/.selfhost/shared/network_fixture" };
  const manifest = { project: { ...project }, services: [{ id: "target", image: `example/target:1.2.3@sha256:${"a".repeat(64)}`,
    networks: ["front", "target-private"], restart: "unless-stopped",
    ports: [{ hostIp: "127.0.0.1", target: 8080, published: 18080,
      protocol: "tcp", purpose: "admin", publicApproved: false }] },
    { id: "target-db", image: `example/db:1.0.0@sha256:${"b".repeat(64)}`,
      networks: ["target-private"], ports: [] }],
    networks: [{ id: "front", name: "network_fixture-front", driver: "bridge", internal: false,
      owner: "network_fixture", ownership: "verified-existing" }] };
  const state = { schemaVersion: 1, revision: 2, manifestRevision: 1, previousHash: "c".repeat(64),
    project, manifestHash: hash(manifest), manifest, units: { target: ["target", "target-db"] },
    selectionFingerprints: { target: "d".repeat(64) }, settings: {},
    checkpoint: { operation: "create", phase: "completed", appIds: ["target"] } };
  return { ...state, recordHash: hash(state) } as unknown as SharedProjectState;
}

function rebind(state: SharedProjectState): SharedProjectState {
  state.manifestHash = hash(state.manifest);
  const { recordHash: _ignored, ...record } = state;
  state.recordHash = hash(record);
  return state;
}

const original = fixture();
const snapshot = JSON.stringify(original);
const resolved = resolveSharedServiceTarget(original, "target");
assert.equal(JSON.stringify(original), snapshot);
assert.deepEqual(resolveSharedServiceTarget(original, "target"), resolved);
assert.equal(resolved.hostname, "target");
assert.equal(resolved.targetPort, 8080);
assert.equal(resolved.frontNetworkId, "front");
assert.equal(resolved.frontNetworkName, "network_fixture-front");
assert.equal(resolved.projectId, original.project.id);
assert.equal(resolved.image, original.manifest.services[0]!.image);
assert.match(resolved.ownerFingerprint, /^[0-9a-f]{64}$/);
assert.match(resolved.targetFingerprint, /^[0-9a-f]{64}$/);
assert.throws(() => resolveSharedServiceTarget(original, "target-db"), /selected application frontend/);
for (const input of ["http://target:8080", "target:8080", "target\nother", "absent"]) {
  assert.throws(() => resolveSharedServiceTarget(original, input), /selected application frontend/);
}

for (const mutate of [
  (state: SharedProjectState) => { state.checkpoint.phase = "attempted"; },
  (state: SharedProjectState) => { state.project.owner = "other-owner"; },
  (state: SharedProjectState) => { state.manifest.networks[0]!.owner = "other-owner"; },
  (state: SharedProjectState) => { state.manifest.networks[0]!.name = "external-front"; },
  (state: SharedProjectState) => { state.manifest.services[0]!.networks = ["target-private"]; },
  (state: SharedProjectState) => { state.manifest.services[0]!.ports.push({ ...state.manifest.services[0]!.ports[0] }); },
  (state: SharedProjectState) => { state.manifest.services[0]!.ports[0]!.hostIp = "0.0.0.0"; },
  (state: SharedProjectState) => { state.manifest.services[0]!.ports[0]!.purpose = "database"; },
  (state: SharedProjectState) => { state.manifest.services[0]!.ports[0]!.publicApproved = true; },
  (state: SharedProjectState) => { state.manifest.services[0]!.ports[0]!.protocol = "udp"; },
  (state: SharedProjectState) => { state.manifest.services[0]!.ports[0]!.target = 65536; },
  (state: SharedProjectState) => { state.manifest.services[0]!.ports[0]!.published = 443; },
  (state: SharedProjectState) => { state.manifest.services[0]!.image = "example/target:latest"; },
  (state: SharedProjectState) => { state.manifest.services.push({ ...state.manifest.services[0] }); },
]) {
  const invalid = fixture(); mutate(invalid);
  assert.throws(() => resolveSharedServiceTarget(rebind(invalid), "target"), /Shared service target:/);
}
const corrupted = fixture(); corrupted.manifest.services[0]!.ports[0]!.target = 8081;
assert.throws(() => resolveSharedServiceTarget(corrupted, "target"), /hash-bound/);
const otherOrigin = fixture(); otherOrigin.project.directory = "/tmp/other-owner";
assert.throws(() => resolveSharedServiceTarget(rebind(otherOrigin), "target"), /owner identity/);
const changed = fixture(); changed.manifest.services[0]!.ports[0]!.target = 8081;
const next = resolveSharedServiceTarget(rebind(changed), "target");
assert.notEqual(next.targetFingerprint, resolved.targetFingerprint);
assert.notEqual(next.ownerFingerprint, resolved.ownerFingerprint);
process.stdout.write("Explicit same-owner frontend target, ambiguity and private-authority contracts: pass\n");

const traefikRoot = await mkdtemp(join(tmpdir(), "traefik-api-source-fixture-"));
try {
  assert.deepEqual(validateAppRecipe(traefikRecipe, traefikApp), []);
  const hashNames = new Set(["TRAEFIK_ADMIN_AUTH_HASH"]);
  assert.ok(bcryptHashTemplateReferencesAllowed(traefikRecipe.configFiles[0]!.content, hashNames));
  for (const template of ['{{ env "UNDECLARED_AUTH_HASH" }}', '{{ env "TRAEFIK_ADMIN_AUTH_HASH" | quote }}',
    '{{ expandenv "TRAEFIK_ADMIN_AUTH_HASH" }}', '{{ env "TRAEFIK_ADMIN_AUTH_HASH" ', '{{ env "RAW_PASSWORD" }}']) {
    assert.equal(bcryptHashTemplateReferencesAllowed(template, hashNames), false);
  }
  for (const replacement of ['{{ env "UNDECLARED_AUTH_HASH" }}', '{{ env "TRAEFIK_ADMIN_AUTH_HASH" | quote }}',
    '{{ env "RAW_PASSWORD" }}', '${TRAEFIK_ADMIN_AUTH_HASH}', '$(env)']) {
    const invalid = structuredClone(traefikRecipe);
    invalid.configFiles[0]!.content = invalid.configFiles[0]!.content.replace('{{ env "TRAEFIK_ADMIN_AUTH_HASH" }}', replacement);
    assert.ok(validateAppRecipe(invalid, traefikApp).length > 0);
    await assert.rejects(prepareMultiServiceFiles(invalid, join(traefikRoot, "invalid"), join(traefikRoot, "invalid", "data")), /bounded, literal, and non-secret/);
  }
  const unhashed = structuredClone(traefikRecipe);
  delete (unhashed.services[0]!.secretEnvironment[0] as Record<string, unknown>).format;
  assert.ok(validateAppRecipe(unhashed, traefikApp).length > 0);
  await assert.rejects(prepareMultiServiceFiles(unhashed, join(traefikRoot, "invalid"), join(traefikRoot, "invalid", "data")), /bounded, literal, and non-secret/);
  const directory = join(traefikRoot, "project");
  const data = join(directory, "data", "traefik");
  const candidate = multiServiceManifest({ recipe: traefikRecipe,
    images: { traefik: `traefik:v3.6.22@sha256:${"a".repeat(64)}` }, projectId: "project",
    appsRoot: traefikRoot, projectDirectory: directory, dataDirectory: data,
    dockerContext: "default", port: 18080, uid: process.getuid!(), gid: process.getgid!(),
    observed: { checkedAt: "2026-10-04T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  const owner = createSelfhostComposeOwner(candidate);
  const rendered = await owner.render(await owner.plan());
  const compose = await readFile(rendered, "utf8");
  await prepareMultiServiceFiles(traefikRecipe, directory, data, undefined, "traefik");
  const passwordFile = join(directory, "secrets", "traefik", "admin-password");
  const envFile = join(directory, "secrets", "traefik", "traefik.env");
  const password = await readFile(passwordFile, "utf8");
  const environment = await readFile(envFile, "utf8");
  const match = /^TRAEFIK_ADMIN_AUTH_HASH='(\$2[aby]\$[^']+)'\n$/.exec(environment);
  assert.ok(match);
  assert.ok(await bcrypt.compare(password, match[1]!));
  assert.equal(environment.includes(password), false);
  for (const file of [passwordFile, envFile, join(data, "config-files", "management-api")]) {
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
  }
  await verifySharedGeneratedConfigFiles(traefikRecipe, directory);
  await prepareMultiServiceFiles(traefikRecipe, directory, data, undefined, "traefik");
  assert.equal(await readFile(passwordFile, "utf8"), password, "Resume preserves the generated control password");
  assert.equal(await readFile(envFile, "utf8"), environment, "Resume preserves the bcrypt hash");
  assert.equal(compose.includes(password), false);
  assert.equal(compose.includes(match[1]!), false);
  assert.equal(traefikRecipe.configFiles[0]!.content.includes(password), false);
  assert.ok(traefikRecipe.configFiles[0]!.content.includes(TRAEFIK_API_RULE));
  assert.ok(traefikRecipe.services[0]!.command.includes("--api.insecure=false"));
  assert.ok(traefikRecipe.services[0]!.command.includes("--api.dashboard=false"));
  assert.equal(JSON.stringify(traefikRecipe).includes("docker.sock"), false);
  const mapping = homarrStackMapping("traefik")!;
  assert.equal(homarrNativeEligibility(mapping, traefikRecipe).eligible, true);
  assert.equal(homarrNativeEligibility(mapping, { ...traefikRecipe, privateFiles: [] }).eligible, false);
  assert.deepEqual(mapping.requiredSecrets, ["username", "password"]);
  assert.deepEqual(homarrIntegrationCredentials(mapping, { username: "admin", password }),
    { credentials: { username: "admin", password }, missing: [] });
  assert.deepEqual(homarrIntegrationCredentials(mapping, {}).missing, ["username", "password"]);

  let anonymousStatus = 401, authenticatedStatus = 200, version = "3.6.22", forbiddenStatus = 404;
  let rule = TRAEFIK_API_RULE, username: string | null = "admin";
  let requests = 0;
  const context = { appId: "traefik", projectRoot: traefikRoot,
    async status() { return { command: "app status", appId: "traefik", projectRoot: traefikRoot,
      status: "applied", mutation: false, runtime: { state: "running" }, username, passwordFile }; },
    secrets: { async readAdminPassword() { return password; } },
    http: { async request(input: SetupHttpRequest) {
      requests++;
      assert.equal(input.method, "GET"); assert.equal(input.body, undefined);
      if (input.path === "/ping") return new Response("OK");
      if (!TRAEFIK_API_PATHS.includes(input.path as typeof TRAEFIK_API_PATHS[number])) {
        return new Response(null, { status: forbiddenStatus });
      }
      if (!input.headers?.Authorization) return new Response(null, { status: anonymousStatus });
      assert.equal(input.headers.Authorization, `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`);
      if (authenticatedStatus !== 200) return new Response(null, { status: authenticatedStatus });
      if (input.path === "/api/version") return Response.json({ Version: version });
      if (input.path === "/api/http/routers") return Response.json([{ name: "selfhost-api@file", status: "enabled",
        rule, service: "api@internal", entryPoints: ["health"], middlewares: ["selfhost-auth@file"] }]);
      return Response.json([]);
    } },
  } as unknown as SetupContext;
  const ready = await traefik.firstRun(context);
  assert.ok(traefik.ready(ready));
  assert.equal(ready.administratorCreated, false); assert.equal(ready.ingressVerified, false);
  assert.equal(ready.restartPersistenceVerified, false);
  assert.equal(JSON.stringify(ready).includes(password), false);
  assert.ok(traefik.ready(await traefik.inspect!(context)), "Inspection freshly verifies saved password");
  anonymousStatus = 200; await assert.rejects(traefik.firstRun(context), /reject anonymous/); anonymousStatus = 401;
  authenticatedStatus = 401; await assert.rejects(traefik.firstRun(context), /saved Basic/); authenticatedStatus = 200;
  version = "3.6.21"; await assert.rejects(traefik.firstRun(context), /version differs/); version = "3.6.22";
  rule = "PathPrefix(`/api`)"; await assert.rejects(traefik.firstRun(context), /router differs/); rule = TRAEFIK_API_RULE;
  forbiddenStatus = 200; await assert.rejects(traefik.firstRun(context), /outside the reviewed/); forbiddenStatus = 404;
  username = null; const before = requests;
  await assert.rejects(traefik.firstRun(context), /old ping-only owners/);
  assert.equal(requests, before, "Old no-account owner cannot release new control credentials");
} finally { await rm(traefikRoot, { recursive: true, force: true }); }
process.stdout.write("Traefik exact authenticated read-only API, private bcrypt persistence and Homarr Basic contract: pass\n");
