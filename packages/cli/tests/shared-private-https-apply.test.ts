import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { sharedProjectCandidate, prepareSharedProjectFiles, type SharedProjectObservation } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { planSharedPrivateHttps } from "../src/lib/shared-private-https.ts";
import { createSharedPrivateHttpsBinding, saveSharedPrivateHttpsBinding, loadSharedPrivateHttpsBinding,
  restoreSharedPrivateHttpsSelection, sharedHttpsHash, writeSharedHttpsPrivateFile,
  saveSharedPrivateHttpsTransportProof } from "../src/lib/shared-private-https-state.ts";
import { applySharedPrivateHttpsTransport, reviewSharedPrivateHttpsTransport } from "../src/lib/shared-private-https-apply.ts";
import { resolveSharedHttpsTarget, validateSharedHttpsTarget } from "../src/lib/shared-https-target.ts";
import { restoreSavedSharedSelection, requireSavedSharedGeneratedRecipes } from "../src/lib/shared-saved-recipe.ts";
import { sharedUnitRecipeCheck, sharedUnitStatus } from "../src/lib/shared-unit-setup.ts";
import { sharedImageInventory } from "../src/shared-project.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import caddySetup from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/caddy/setup.ts";

type Entry = Record<string, any>;
for (const [hostname, routeAliases] of [["alpha.localhost", true], ["alpha.home.arpa", true],
  ["alpha.example.com", true], ["alpha.localhost", false]] as const) {
const temporary = await mkdtemp(join(tmpdir(), "shared-https-apply-"));
try {
  const imageTag = "docker.io/library/busybox:1.37.0";
  const app = { appId: "alpha", port: 18080, images: { alpha: `${imageTag}@sha256:${"a".repeat(64)}` },
    recipe: { schemaVersion: 2, kind: "multi-service-compose", appId: "alpha",
      services: [{ id: "alpha", imageTag, user: "image-default",
        imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [], fileEnvironment: [],
        mounts: [{ kind: "volume", name: "state", target: "/state" }], dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [], defaults: { hostIp: "127.0.0.1" } } };
  const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId: "https-test",
    dockerContext: "fixture-context", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [app],
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const initialOwner = createSelfhostComposeOwner(candidate.manifest);
  await initialOwner.render(await initialOwner.plan());
  let state = await saveSharedProjectState(candidate, { operation: "create", phase: "reviewed", appIds: ["alpha"] },
    { revision: 0, manifestHash: null, checkpoint: null });
  for (const phase of ["attempted", "completed"] as const) {
    state = await saveSharedProjectState(candidate, { operation: "create", phase, appIds: ["alpha"] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  }
  const recipe = JSON.parse(await readFile(new URL(
    "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/caddy/recipe.json", import.meta.url), "utf8"));
  const observation: SharedProjectObservation = { checkedAt: "2026-10-03T12:01:00Z", ports: [], paths: [],
    project: { id: state.project.id, directory: state.project.directory, owner: state.project.id },
    networks: state.manifest.networks.map((network: Entry) => ({ name: network.name, owner: state.project.id })),
    volumes: state.manifest.services.flatMap((service: Entry) => service.mounts.filter((mount: Entry) => mount.kind === "volume")
      .map((mount: Entry) => ({ name: mount.name, owner: state.project.id, driver: "local", labels: {
        "com.docker.compose.project": state.project.id, "com.docker.compose.volume": mount.name,
        "io.selfhost.project": state.project.id, "io.selfhost.volume": mount.name.slice(state.project.id.length + 1) } }))) };
  const plan = planSharedPrivateHttps(state, recipe, `${recipe.services[0].imageTag}@sha256:${"b".repeat(64)}`,
    [{ appId: "alpha", hostname }], 28443, observation, routeAliases);
  const binding = createSharedPrivateHttpsBinding(state, recipe, plan, observation);
  await saveSharedPrivateHttpsBinding(state.project.directory, binding, recipe);
  await saveSharedPrivateHttpsBinding(state.project.directory, binding, recipe);
  assert.deepEqual(await loadSharedPrivateHttpsBinding(state.project.directory, recipe), binding);
  await prepareSharedProjectFiles(plan.candidate, [plan.caddySelection]);
  const savedOwner = createSelfhostComposeOwner(plan.candidate.manifest);
  await savedOwner.render(await savedOwner.plan());
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    state = await saveSharedProjectState(plan.candidate, { operation: "add", phase, appIds: ["caddy"] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  }
  assert.deepEqual(restoreSharedPrivateHttpsSelection(state, recipe, binding), plan.caddySelection);
  const recipeFor = (appId: string) => {
    const value = appId === "caddy" ? recipe : app.recipe;
    return { recipe: value, boundedApply: true, defaults: value.defaults, storage: value.storage ?? {},
      recipeSha256: sharedHttpsHash(value) };
  };
  assert.deepEqual(restoreSavedSharedSelection(state, "caddy", recipeFor), plan.caddySelection);
  requireSavedSharedGeneratedRecipes(state, recipeFor);
  assert.equal(sharedUnitRecipeCheck(state, "caddy", recipeFor), "matches-saved-selection");
  const inventory = sharedImageInventory(state, recipeFor);
  assert.equal(inventory.imageChecks.caddy, "matches-saved-selection");
  assert.equal(inventory.recipeSha256.caddy, sharedHttpsHash(plan.caddySelection.recipe));
  const status = await sharedUnitStatus(temporary, state.project.id, "caddy", recipeFor, () => "fixture", false);
  assert.equal(status.appId, "caddy");
  assert.equal(status.url, null, "a generated TLS proxy must not advertise an HTTP frontend");
  assert.deepEqual(status.privateHttps.routes, [{ appId: "alpha", url: `https://${hostname}:28443` }]);
  assert.equal(status.privateHttps.transportVerified, false);
  await assert.rejects(caddySetup.firstRun({ appId: "caddy", projectRoot: temporary,
    status: async () => ({ ...status, runtime: { state: "running" } }), http: { request: async () => { throw new Error("must not request an invented HTTP health route"); } } } as any),
  /separately approved TLS\/CA proof/);
  const review = reviewSharedPrivateHttpsTransport(state, recipe, binding);
  const publicRoot = rootCertificates.find((pem) => {
    const cert = new X509Certificate(pem);
    return cert.ca && cert.verify(cert.publicKey) && Date.parse(cert.validFrom) < Date.now() && Date.parse(cert.validTo) > Date.now();
  });
  assert.ok(publicRoot);
  const commands: Array<{ command: string; args: string[] }> = [];
  const dependencies = { checkOwner: async (_state: unknown, target: string) => {
    assert.match(target, /\/compose\.[0-9a-f]+\.yaml$/);
  }, run: (command: string, args: string[]) => {
    commands.push({ command, args });
    if (command === "docker") return { status: 0, stdout: publicRoot! };
    return { status: 0, stdout: "502" };
  } };
  await assert.rejects(applySharedPrivateHttpsTransport(state, recipe, binding, "wrong", dependencies), /exact owner-bound approval/);
  assert.equal(commands.length, 0);
  const result = await applySharedPrivateHttpsTransport(state, recipe, binding, review.approval, dependencies);
  assert.equal(result.transportVerified, true);
  assert.equal(result.proofs[0]!.httpStatus, 502); // TLS response is not upstream acceptance.
  assert.equal(result.applicationVerified, false);
  assert.equal(result.clientTrustVerified, false);
  assert.equal(result.dnsVerified, false);
  assert.equal(result.composeMutation, false);
  let expectedScope = "host-only-localhost";
  if (!hostname.endsWith(".localhost")) expectedScope = "host-only-name-override";
  assert.equal(result.hostnameScope, expectedScope);
  assert.equal(review.hostnameScope, expectedScope);
  await assert.rejects(saveSharedPrivateHttpsTransportProof(state, recipe, binding,
    { ...result, dnsVerified: true } as any), /binding differs/);
  await assert.rejects(saveSharedPrivateHttpsTransportProof(state, recipe, binding,
    { ...result, hostnameScope: "invalid-scope" } as any), /binding differs/);
  const savedProof = await saveSharedPrivateHttpsTransportProof(state, recipe, binding, result);
  assert.equal(savedProof.proof.hostnameScope, expectedScope);
  const setupTarget = await resolveSharedHttpsTarget(state, recipe, "alpha");
  assert.equal(setupTarget.origin, `https://${hostname}:28443`);
  assert.equal(setupTarget.caPath, result.caExportPath);
  assert.equal(setupTarget.caSha256, result.caSha256);
  await validateSharedHttpsTarget(setupTarget, state, recipe);
  await assert.rejects(resolveSharedHttpsTarget(state, recipe, "unowned"), /exact owner/);
  await assert.rejects(validateSharedHttpsTarget({ ...setupTarget, caSha256: "a".repeat(64) }, state, recipe), /exact owner/);
  await assert.rejects(validateSharedHttpsTarget({ ...setupTarget, hostname: "other.localhost" }, state, recipe), /exact owner/);
  assert.deepEqual(commands[0]!.args.slice(0, 8), ["--context", "fixture-context", "compose", "--project-directory",
    state.project.directory, "--project-name", "https-test", "--file"]);
  assert.deepEqual(commands[0]!.args.slice(-5), ["exec", "-T", "caddy", "cat", "/data/caddy/pki/authorities/local/root.crt"]);
  assert.equal(commands[1]!.args[0], "--disable");
  assert.ok(commands[1]!.args.includes("--cacert"));
  assert.ok(commands[1]!.args.includes(`${hostname}:28443:127.0.0.1`));
  assert.ok(!commands[1]!.args.includes("--insecure"));
  assert.ok(!commands[0]!.args.includes("up"));
  await applySharedPrivateHttpsTransport(state, recipe, binding, review.approval, dependencies);
  const failed = await applySharedPrivateHttpsTransport(state, recipe, binding, review.approval,
    { ...dependencies, run: (command, args) => {
      if (command === "docker") return dependencies.run(command, args);
      return { status: 60, stdout: "000" };
    } });
  assert.equal(failed.transportVerified, false);
  assert.equal(failed.proofs[0]!.httpStatus, null);
  await assert.rejects(applySharedPrivateHttpsTransport(state, recipe, binding, review.approval,
    { ...dependencies, run: () => ({ status: 1, stdout: "" }) }), /CA export is unavailable/);
  await assert.rejects(applySharedPrivateHttpsTransport(state, recipe, binding, review.approval,
    { ...dependencies, run: () => ({ status: 0, stdout: "not a certificate".repeat(20) }) }), /self-signed CA/);
  assert.throws(() => restoreSharedPrivateHttpsSelection(state, { ...recipe, source: "https://changed.test" }, binding), /binding differs/);
  assert.throws(() => restoreSavedSharedSelection(state, "caddy", () => recipeFor("alpha")), /saved selection/);
  function resign(changed: typeof state) {
    changed.manifestHash = sharedHttpsHash(changed.manifest);
    const { recordHash: _discard, ...record } = changed;
    changed.recordHash = sharedHttpsHash(record);
    return changed;
  }
  const uncertain = structuredClone(state);
  uncertain.checkpoint.phase = "inspect-required";
  assert.throws(() => reviewSharedPrivateHttpsTransport(resign(uncertain), recipe, binding), /completed owner/);
  const changed = structuredClone(state);
  changed.manifest.services.find((service: Entry) => service.id === "alpha").environment.push({ name: "CANONICAL_URL", value: "https://alpha.localhost" });
  assert.throws(() => restoreSharedPrivateHttpsSelection(resign(changed), recipe, binding), /binding differs/);
  assert.equal(sharedUnitRecipeCheck(changed, "caddy", recipeFor), "recipe-unavailable-or-changed");
  await chmod(join(state.project.directory, "private-https-binding.json"), 0o644);
  assert.throws(() => requireSavedSharedGeneratedRecipes(state, recipeFor), /differs from its exact saved selection/);
  await chmod(join(state.project.directory, "private-https-binding.json"), 0o600);
  await assert.rejects(writeSharedHttpsPrivateFile(state.project.directory, "private-https-root.crt", Buffer.from(publicRoot! + "changed")), /binding differs/);
  await chmod(result.caExportPath, 0o644);
  await assert.rejects(applySharedPrivateHttpsTransport(state, recipe, binding, review.approval, dependencies), /binding differs/);
  await chmod(result.caExportPath, 0o600);
  const linkedDirectory = join(temporary, "linked-owner");
  await symlink(state.project.directory, linkedDirectory);
  await assert.rejects(writeSharedHttpsPrivateFile(linkedDirectory, "private-https-root.crt", Buffer.from(publicRoot!)), /binding differs/);
  console.log("shared HTTPS binding and transport fixture passed (synthetic; no Docker or live TLS)");
} finally { await rm(temporary, { recursive: true, force: true }); }
}
