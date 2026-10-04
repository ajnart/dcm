import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { sharedProjectCandidate, prepareSharedProjectFiles, type SharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState, loadSharedProjectState, loadSharedReviewedCanonicalOrigin,
  loadSharedUnitComposeOrigins, type SharedProjectState } from "../src/lib/shared-project-state.ts";
import { planSharedPrivateHttps } from "../src/lib/shared-private-https.ts";
import { createSharedPrivateHttpsBinding, sharedHttpsHash as hash, saveSharedPrivateHttpsBinding,
  saveSharedPrivateHttpsTransportProof, loadSharedPrivateHttpsTransportProof,
  restoreSharedPrivateHttpsSelection, writeSharedHttpsPrivateFile } from "../src/lib/shared-private-https-state.ts";
import { reviewSharedCanonicalOriginTransition, reviewSharedReviewedCanonicalOriginTransition,
  type SharedCanonicalTransportProof } from "../src/lib/shared-canonical-origin-transition.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedCanonicalOriginCommand } from "../src/lib/shared-canonical-origin-command.ts";
import { reviewSharedEnvironmentTransition } from "../src/lib/shared-env-transition.ts";
import { sharedUnitStatus } from "../src/lib/shared-unit-setup.ts";

const catalog = "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/";
const recipeFor = async (id: string) => JSON.parse(await readFile(new URL(`${catalog}${id}/recipe.json`, import.meta.url), "utf8"));
function saved(candidate: SharedProjectCandidate, revision: number, previousHash: string | null): SharedProjectState {
  const identity = candidate.manifest.project;
  const project = { id: identity.id, dockerContext: identity.dockerContext, owner: identity.owner,
    root: identity.root, directory: identity.directory };
  const record = { schemaVersion: 1 as const, revision, manifestRevision: revision, previousHash,
    project, manifestHash: hash(candidate.manifest), manifest: candidate.manifest, units: candidate.units,
    selectionFingerprints: candidate.selectionFingerprints, settings: candidate.settings,
    checkpoint: { operation: "create" as const, phase: "completed" as const, appIds: Object.keys(candidate.units) } };
  return { ...record, recordHash: hash(record) };
}

const caddy = await recipeFor("caddy");
const temporary = await mkdtemp(join(tmpdir(), "canonical-origin-state-"));
try {
for (const scenario of ["vaultwarden", "docmost", "docmost-failed", "docmost-runtime-failed"]) {
  let appId = scenario;
  if (scenario.startsWith("docmost-")) appId = "docmost";
  const recipe = await recipeFor(appId);
  const peer = await recipeFor("ntfy");
  const selection = (id: string, source: any, port: number) => ({ appId: id, recipe: source,
    images: Object.fromEntries(source.services.map((service: any) => [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`])), port });
  const selected = [selection(appId, recipe, 18080), selection("ntfy", peer, 18081)];
  const linkwarden = await recipeFor("linkwarden");
  if (scenario === "vaultwarden") selected.push(selection("linkwarden", linkwarden, 18082));
  const original = sharedProjectCandidate({ projectRoot: temporary, projectId: scenario,
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: selected,
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(original.projectDirectory, { recursive: true, mode: 0o700 });
  const originalOwner = createSelfhostComposeOwner(original.manifest);
  await originalOwner.render(await originalOwner.plan());
  await prepareSharedProjectFiles(original, selected);
  let source = await saveSharedProjectState(original,
    { operation: "create", phase: "reviewed", appIds: Object.keys(original.units).sort() },
    { revision: 0, manifestHash: null, checkpoint: null });
  for (const phase of ["attempted", "completed"] as const) {
    source = await saveSharedProjectState(original,
      { operation: "create", phase, appIds: Object.keys(original.units).sort() },
      { revision: source.revision, manifestHash: source.manifestHash, checkpoint: source.checkpoint });
  }
  const observation = { ...source.manifest.observed, project: { id: source.project.id,
    directory: source.project.directory, owner: source.project.owner },
    networks: source.manifest.networks.map((network: any) => ({ name: network.name, owner: source.project.id })),
    volumes: source.manifest.services.flatMap((service: any) => service.mounts
      .filter((mount: any) => mount.kind === "volume")
      .map((mount: any) => ({ name: mount.name, driver: "local", owner: source.project.id,
        labels: { "com.docker.compose.project": source.project.id, "com.docker.compose.volume": mount.name,
          "io.selfhost.project": source.project.id,
          "io.selfhost.volume": mount.name.slice(source.project.id.length + 1) } }))) };
  const routes = [{ appId, hostname: `${appId}.localhost` }];
  if (scenario === "vaultwarden") routes.push({ appId: "linkwarden", hostname: "linkwarden.localhost" });
  const https = planSharedPrivateHttps(source, caddy, `${caddy.services[0].imageTag}@sha256:${"b".repeat(64)}`,
    routes, 28443, observation);
  const binding = createSharedPrivateHttpsBinding(source, caddy, https, observation);
  await saveSharedPrivateHttpsBinding(source.project.directory, binding, caddy);
  const httpsOwner = createSelfhostComposeOwner(https.candidate.manifest);
  await httpsOwner.render(await httpsOwner.plan());
  await prepareSharedProjectFiles(https.candidate, [https.caddySelection]);
  let state = source;
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    state = await saveSharedProjectState(https.candidate,
      { operation: "add", phase, appIds: ["caddy"] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  }
  if (scenario === "vaultwarden") {
    const closure = reviewSharedEnvironmentTransition(state, "linkwarden", linkwarden,
      linkwarden.postFirstAccountEnvironment);
    const closedOwner = createSelfhostComposeOwner(closure.candidate.manifest);
    await closedOwner.render(await closedOwner.plan());
    const beforeClosure = structuredClone(state);
    const forged = structuredClone(state);
    forged.manifest = closure.candidate.manifest;
    forged.manifestHash = hash(forged.manifest);
    const { recordHash: ignoredHash, ...forgedRecord } = forged;
    forged.recordHash = hash(forgedRecord);
    assert.throws(() => restoreSharedPrivateHttpsSelection(forged, caddy, binding),
      "self-asserted post-account state without validated journal history is rejected");
    const arbitrary = structuredClone(closure.candidate);
    arbitrary.manifest.services.find((service: any) => service.id === "linkwarden")
      .environment.find((entry: any) => entry.name === "NEXT_PUBLIC_DISABLE_REGISTRATION").value = "other";
    await assert.rejects(saveSharedProjectState(arbitrary,
      { operation: "transition", phase: "reviewed", appIds: ["linkwarden"] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint }), /source-owned post-account switch/);
    for (const phase of ["reviewed", "attempted", "completed"] as const) {
      state = await saveSharedProjectState(closure.candidate,
        { operation: "transition", phase, appIds: ["linkwarden"] },
        { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
    }
    state = (await loadSharedProjectState(state.project.directory, state.project.id))!;
    assert.equal(restoreSharedPrivateHttpsSelection(state, caddy, binding).appId, "caddy");
    for (const service of beforeClosure.manifest.services) {
      const closed = state.manifest.services.find((entry: any) => entry.id === service.id);
      const expected = structuredClone(service);
      if (service.id === "linkwarden") expected.environment = closed.environment;
      assert.deepEqual(closed, expected, "post-account closure preserves all other service settings");
    }
    const status = await sharedUnitStatus(temporary, scenario, "ntfy", (id) => {
      if (id === "ntfy") return { recipe: peer, boundedApply: true };
      if (id === "caddy") return { recipe: caddy, boundedApply: true };
      if (id === "linkwarden") return { recipe: linkwarden, boundedApply: true };
      return { recipe, boundedApply: true };
    }, () => "synthetic-not-used", false);
    assert.equal(status.appId, "ntfy", "unrelated unit status does not fan out route restoration failure");
  }
  const origin = `https://${appId}.localhost:28443`;
  const publicRoot = rootCertificates.find((pem) => {
    const cert = new X509Certificate(pem);
    return cert.ca && cert.checkIssued(cert) && cert.verify(cert.publicKey)
      && Date.parse(cert.validFrom) < Date.now() && Date.parse(cert.validTo) > Date.now();
  });
  assert.ok(publicRoot);
  await writeSharedHttpsPrivateFile(state.project.directory, "private-https-root.crt", Buffer.from(publicRoot));
  const transport: SharedCanonicalTransportProof = { projectId: state.project.id, ownerRecordHash: state.recordHash,
    bindingHash: binding.bindingHash, caExportPath: `${state.project.directory}/private-https-root.crt`,
    caSha256: createHash("sha256").update(publicRoot).digest("hex"), hostnameScope: "host-only-localhost",
    proofs: binding.routes.map((route) => ({ appId: route.appId, hostname: route.hostname,
      url: `https://${route.hostname}:${binding.port}`, method: "curl-cacert-resolve" as const,
      verified: true, httpStatus: 200, verifiedAt: "2026-10-03T00:00:00Z" })),
    transportVerified: true, dnsVerified: false, clientTrustVerified: false, applicationVerified: false,
    composeMutation: false, trustStoreMutation: false };
  const before = structuredClone(state);
  const review = reviewSharedCanonicalOriginTransition(state, appId, recipe, caddy, binding, transport);
  const checkpoint = { operation: "canonical-origin" as const, phase: "reviewed" as const,
    appIds: [appId], canonicalOrigin: review.canonicalOrigin };
  const expectation = { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint };
  await assert.rejects(saveSharedProjectState(review.candidate, checkpoint, expectation), /ENOENT/,
    "self-asserted checkpoint cannot substitute for producer TLS evidence");
  await saveSharedPrivateHttpsTransportProof(state, caddy, binding, transport);
  const repeated = structuredClone(transport);
  repeated.proofs[0]!.verifiedAt = "2026-10-03T00:00:01Z";
  const republished = await saveSharedPrivateHttpsTransportProof(state, caddy, binding, repeated);
  assert.deepEqual(republished.proof, transport, "fresh exact reprobe reuses immutable original proof");
  assert.deepEqual(await loadSharedPrivateHttpsTransportProof(state.project.directory, state.recordHash), transport);
  const commandOptions = { action: "canonical-origin-plan" as const, projectRoot: temporary,
    projectId: scenario, appId, approval: null };
  let recreated = false;
  const dependencies = { async runtime(_state: SharedProjectState, appIds: string[], _target: string,
    origins: Record<string, string>) {
    assert.ok(origins[appId]);
    const states = Object.fromEntries(appIds.map((id) => [id, "running"]));
    states.ntfy = "stopped"; // Retained peers need not be running or accepted.
    if (scenario === "docmost-runtime-failed" && recreated) states[appId] = "stopped";
    return states;
  }, recipeFor(id: string) {
    if (id === appId) return { recipe };
    if (id === "caddy") return { recipe: caddy };
    throw new Error("Unexpected app authority");
  } };
  const commandReview = await sharedCanonicalOriginCommand(commandOptions, dependencies);
  assert.equal(commandReview.approval, review.approval);
  await assert.rejects(sharedCanonicalOriginCommand({ ...commandOptions, action: "canonical-origin-apply",
    approval: "WRONG-APPROVAL" }, dependencies), /exact separately reviewed/);
  assert.deepEqual(state, before, "review is read-only");
  assert.deepEqual(review.serviceIds, [...state.units[appId]!].sort());
  assert.equal(review.origin, origin);
  assert.equal(review.changes.length, 1);
  const name = appId === "vaultwarden" ? "DOMAIN" : "APP_URL";
  assert.equal(review.changes[0]!.name, name);
  assert.equal(review.changes[0]!.to, origin);
  if (appId === "vaultwarden") assert.equal(review.changes[0]!.from, null);
  else assert.equal(review.changes[0]!.from, "http://127.0.0.1:18080");
  assert.deepEqual(review.candidate.selectionFingerprints, state.selectionFingerprints);
  for (const service of state.manifest.services) {
    const next = review.candidate.manifest.services.find((item: any) => item.id === service.id);
    if (service.id !== appId) assert.deepEqual(next, service, "retained other services are unchanged");
    else {
      const expected = structuredClone(service);
      expected.environment = next.environment;
      assert.deepEqual(next, expected, "only static environment changes, including secret file reference preservation");
    }
  }
  const owner = createSelfhostComposeOwner(review.candidate.manifest);
  const plan = await owner.plan();
  assert.equal(plan.status, "pass");
  await owner.selectedPlan(plan, "recreate", review.serviceIds);
  await owner.render(plan);
  for (const alter of [
    (proof: any) => { proof.ownerRecordHash = "f".repeat(64); },
    (proof: any) => { proof.bindingHash = "f".repeat(64); },
    (proof: any) => { proof.proofs.find((entry: any) => entry.appId === appId).url = "https://guessed.localhost:28443"; },
    (proof: any) => { proof.proofs.find((entry: any) => entry.appId === appId).verified = false; },
    (proof: any) => { proof.proofs.find((entry: any) => entry.appId === appId).httpStatus = null; },
    (proof: any) => { proof.transportVerified = false; },
  ]) {
    const invalid = structuredClone(transport);
    alter(invalid);
    assert.throws(() => reviewSharedCanonicalOriginTransition(state, appId, recipe, caddy, binding, invalid));
  }
  const pending = saved(review.candidate, state.revision + 1, state.recordHash);
  pending.checkpoint = structuredClone(checkpoint);
  const { recordHash: ignored, ...pendingRecord } = pending;
  pending.recordHash = hash(pendingRecord);
  const recovery = reviewSharedReviewedCanonicalOriginTransition(pending, state, appId, recipe, caddy, binding, transport);
  assert.notEqual(recovery.approval, review.approval, "reviewed recovery requires fresh approval");
  pending.checkpoint.phase = "attempted";
  assert.throws(() => reviewSharedReviewedCanonicalOriginTransition(pending, state, appId, recipe, caddy, binding, transport));
  assert.throws(() => reviewSharedCanonicalOriginTransition(pending, appId, recipe, caddy, binding, transport));
  const drifted = structuredClone(recipe);
  drifted.services[0].environment.push({ name: "ARBITRARY_ORIGIN", value: "https://guessed.invalid" });
  assert.throws(() => reviewSharedCanonicalOriginTransition(state, appId, drifted, caddy, binding, transport));

  for (const alter of [
    (value: any) => { value.manifest.services.find((service: any) => service.id === appId).image = `docker.io/library/busybox:1.37.0@sha256:${"d".repeat(64)}`; },
    (value: any) => { value.manifest.services.find((service: any) => service.id === appId).environment.push({ name: "OTHER_ORIGIN", value: origin }); },
    (value: any) => { value.manifest.services.find((service: any) => service.id === "ntfy").restart = "no"; },
    (value: any) => { value.selectionFingerprints[appId] = "d".repeat(64); },
    (value: any) => { value.manifest.services.find((service: any) => service.id === appId).environment.find((entry: any) => entry.name === name).value = "https://guessed.localhost:28443"; },
  ]) {
    const invalid = structuredClone(review.candidate);
    alter(invalid);
    await assert.rejects(saveSharedProjectState(invalid, checkpoint, expectation));
  }
  const invalidProof = structuredClone(checkpoint);
  invalidProof.canonicalOrigin.transportHash = "d".repeat(64);
  await assert.rejects(saveSharedProjectState(review.candidate, invalidProof, expectation), /proof differs/);
  await assert.rejects(saveSharedProjectState(review.candidate,
    { operation: "transition", phase: "reviewed", appIds: [appId] }, expectation),
    "legacy transition cannot bypass separately bound canonical authority");
  if (scenario === "docmost-failed" || scenario === "docmost-runtime-failed") {
    let recreations = 0;
    await assert.rejects(sharedCanonicalOriginCommand({ ...commandOptions, action: "canonical-origin-apply",
      approval: commandReview.approval }, { ...dependencies, async recreate(_owner, _plan, services, approval) {
      recreations += 1;
      assert.deepEqual(services, review.serviceIds);
      assert.ok(approval.startsWith("SELECTED-RECREATE:"));
      const attempted = await loadSharedProjectState(state.project.directory, state.project.id);
      assert.equal(attempted!.checkpoint.phase, "attempted", "checkpoint precedes external mutation");
      recreated = true;
      if (scenario === "docmost-failed") throw new Error("Synthetic uncertain recreate");
    } }), /outcome is uncertain/);
    assert.equal(recreations, 1);
    const uncertain = await loadSharedProjectState(state.project.directory, state.project.id);
    assert.equal(uncertain!.checkpoint.phase, "inspect-required");
    assert.equal(uncertain!.checkpoint.operation, "canonical-origin");
    assert.deepEqual(uncertain!.manifest, review.candidate.manifest);
    await assert.rejects(sharedCanonicalOriginCommand(commandOptions, dependencies), /no automatic replay/);
    continue;
  }
  let persisted = await saveSharedProjectState(review.candidate, checkpoint, expectation);
  const recovered = await loadSharedReviewedCanonicalOrigin(state.project.directory, state.project.id, persisted.recordHash, appId);
  assert.equal(recovered.recordHash, state.recordHash);
  assert.equal(restoreSharedPrivateHttpsSelection(persisted, caddy, binding).appId, "caddy",
    "Caddy restores with only exact source-derived canonical overlay");
  if (appId === "vaultwarden") {
    const commandRecovery = await sharedCanonicalOriginCommand(commandOptions, dependencies);
    assert.equal(commandRecovery.status, "resume-reviewed");
    assert.notEqual(commandRecovery.approval, commandReview.approval);
    await assert.rejects(sharedCanonicalOriginCommand({ ...commandOptions, action: "canonical-origin-apply",
      approval: commandReview.approval }, dependencies), /exact separately reviewed/);
    const applied = await sharedCanonicalOriginCommand({ ...commandOptions, action: "canonical-origin-apply",
      approval: commandRecovery.approval }, { ...dependencies, async recreate(_owner, _plan, services) {
      assert.deepEqual(services, review.serviceIds);
      const attempted = await loadSharedProjectState(state.project.directory, state.project.id);
      assert.equal(attempted!.checkpoint.phase, "attempted");
    } });
    assert.equal(applied.status, "canonical-origin-applied-unverified");
    assert.equal(applied.applicationVerified, false);
    persisted = (await loadSharedProjectState(state.project.directory, state.project.id))!;
  } else {
  for (const phase of ["attempted", "completed"] as const) {
    const changedEvidence = { ...checkpoint, phase,
      canonicalOrigin: { ...checkpoint.canonicalOrigin, transportHash: "d".repeat(64) } };
    await assert.rejects(saveSharedProjectState(review.candidate, changedEvidence,
      { revision: persisted.revision, manifestHash: persisted.manifestHash, checkpoint: persisted.checkpoint }), /evidence cannot change/);
    persisted = await saveSharedProjectState(review.candidate, { ...checkpoint, phase },
      { revision: persisted.revision, manifestHash: persisted.manifestHash, checkpoint: persisted.checkpoint });
    await assert.rejects(loadSharedReviewedCanonicalOrigin(state.project.directory, state.project.id, persisted.recordHash, appId), /before any Docker attempt/);
  }
  }
  assert.equal((await loadSharedProjectState(state.project.directory, state.project.id))!.recordHash, persisted.recordHash,
    "historical proof remains valid after canonical operation changes latest owner");
  assert.equal(restoreSharedPrivateHttpsSelection(persisted, caddy, binding).appId, "caddy");
  await originalOwner.checkRendered(await originalOwner.plan());
  await httpsOwner.checkRendered(await httpsOwner.plan());
  await owner.checkRendered(plan);
  const origins = await loadSharedUnitComposeOrigins(state.project.directory, state.project.id, persisted.recordHash);
  assert.equal(origins[appId], plan.render.target);
  assert.equal(origins.ntfy, (await originalOwner.plan()).render.target);
  assert.equal(origins.caddy, (await httpsOwner.plan()).render.target);
}
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log("Shared canonical origin state, proof, restore and scoped command fixtures passed (synthetic runtime, no Docker).");
