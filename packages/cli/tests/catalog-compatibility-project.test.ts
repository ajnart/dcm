import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogCompatibilityCommand, loadCatalogCompatibility } from "../src/catalog-compatibility.ts";
import { createSharedAcceptanceOwner } from "../src/lib/shared-acceptance-owner.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, saveSharedProjectState, type SharedProjectExpected } from "../src/lib/shared-project-state.ts";
import { prepareCompatibilityEvidenceRoot, publishCompatibilityObservation,
  type CompatibilityReceiptContract } from "../src/lib/compatibility-receipts.ts";
import packageMetadata from "../package.json";
import { bindSharedCreateRecipe, deriveSharedCreateRecipe } from "../src/lib/shared-derived-recipe.ts";
import { prepareSharedDerivedRecipeBinding } from "../src/lib/shared-derived-recipe-state.ts";
import { invalidateSharedHomarrCompatibility, prepareSharedHomarrCompatibility, publishSharedHomarrCompatibility,
  readSharedHomarrCompatibilityIdentity, sharedHomarrCompatibilitySources } from "../src/lib/shared-homarr-compatibility.ts";
import { homarrStackMapping } from "../src/lib/homarr-stack-mapping.ts";
import { resolveSharedAppMetadata } from "../src/lib/resolved-app.ts";
import { sharedUnitRecipeCheck } from "../src/lib/shared-unit-setup.ts";

const projectRoot = await mkdtemp(join(tmpdir(), "catalog-project-receipts-"));
const projectId = "fixture";
const checkedAt = "2026-10-03T12:00:00.000Z";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  const base = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ntfy/", import.meta.url);
  const bytes = await readFile(new URL("recipe.json", base), "utf8");
  const recipe = JSON.parse(bytes);
  const app = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
  const digest = "a".repeat(64);
  const images = Object.fromEntries(recipe.services.map((service: Record<string, any>) =>
    [service.id, `${service.imageTag}@sha256:${digest}`]));
  const candidate = sharedProjectCandidate({ projectRoot, projectId, dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [{ appId: "ntfy", recipe, images, port: 18981 }],
    observed: { checkedAt, ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  let previous: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(candidate, { operation: "create", phase, appIds: ["ntfy"] }, previous);
    previous = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  const owner = createSharedAcceptanceOwner(projectRoot, projectId, "ntfy", {
    recipeFor() { return { recipe, boundedApply: true,
      recipeSha256: createHash("sha256").update(bytes).digest("hex") }; },
    appFor() { return app; }, approvalFor() { throw new Error("No fixture mutation authority"); },
  });
  const identity = await owner.identity();
  const selection = { projectRoot, projectId };
  const empty = await loadCatalogCompatibility(checkedAt, "ntfy", selection);
  assert.equal(empty.appCount, 94); assert.equal(empty.earnedPoints, 0);
  const driftRecipe = structuredClone(recipe);
  driftRecipe.services[0].restart = "always";
  const driftId = "recipe-drift";
  const driftCandidate = sharedProjectCandidate({ projectRoot, projectId: driftId, dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [{ appId: "ntfy", recipe: driftRecipe, images, port: 18982 }],
    observed: { checkedAt, ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(driftCandidate.projectDirectory, { recursive: true, mode: 0o700 });
  let driftPrevious: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(driftCandidate, { operation: "create", phase, appIds: ["ntfy"] }, driftPrevious);
    driftPrevious = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  const driftSelection = { projectRoot, projectId: driftId };
  const drifted = await loadCatalogCompatibility(checkedAt, "ntfy", driftSelection);
  assert.equal(drifted.appCount, 94); assert.equal(drifted.earnedPoints, 0);
  assert.equal(drifted.apps[0]!.label, "blocked");
  assert.equal(drifted.apps[0]!.source!.recipeSha256, empty.apps[0]!.source!.recipeSha256);
  assert.deepEqual(drifted.apps[0]!.source!.imageTags, empty.apps[0]!.source!.imageTags);
  assert.equal(drifted.project!.blockers[0]!.code, "shared-recipe-migration-required");
  assert.match(drifted.apps[0]!.actions.join(" "), /review migration/);
  const driftLedger = join(driftCandidate.projectDirectory, "acceptance-run-ntfy.json");
  await writeFile(driftLedger, "{}", { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", driftSelection), /review migration/,
    "Recipe drift cannot bypass validation of existing owner chronology");
  await unlink(driftLedger);
  const driftEvidence = join(projectRoot, `selfhost-verification-${driftId}`);
  await prepareCompatibilityEvidenceRoot(driftEvidence);
  await mkdir(join(driftEvidence, "registry"), { mode: 0o700 });
  await writeFile(join(driftEvidence, "registry/revision-000001.json"), "{invalid}", { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", driftSelection), /registry\/artifact JSON is invalid/,
    "A known recipe blocker does not mask malformed registry data");
  const evidenceRoot = join(projectRoot, `selfhost-verification-${projectId}`);
  await prepareCompatibilityEvidenceRoot(evidenceRoot);
  const runId = randomUUID();
  const observation = { ...identity.contract, runId, checkedAt,
    checks: [{ id: "application-health", result: "pass" as const },
      { id: "core-round-trip", result: "pass" as const }, { id: "restart-persistence", result: "pass" as const }],
    cleanup: "not-required" as const };
  const { homarrMode: _, ...sanitized } = observation;
  const first = await publishCompatibilityObservation(evidenceRoot, sanitized, identity.contract, { expectedRevision: 0 });
  // Merely writing a plausible registry without owner chronology earns nothing.
  assert.equal((await loadCatalogCompatibility(checkedAt, "ntfy", selection)).earnedPoints, 0);
  const baseline = { source: "shared-selected-lifecycle", appId: "ntfy", projectRoot, ownerId: projectId,
    recipeSha256: identity.contract.recipeSha256, manifestHash: identity.contract.owner.manifestHash,
    units: identity.services.map((serviceId) => ({ serviceId, imageId: `sha256:${digest}` })),
    epoch: digest, sequence: 1, evidenceId: randomUUID(), state: "running" };
  const ledger = { schemaVersion: 1, runId, binding: hash(identity), phase: "finished", baseline,
    stopped: { ...baseline, state: "stopped", sequence: 2, evidenceId: randomUUID() },
    running: { ...baseline, epoch: "b".repeat(64), sequence: 3, evidenceId: randomUUID() }, checkedAt,
    registry: { revision: first.revision, registryHash: first.registryHash } };
  const ledgerPath = join(candidate.projectDirectory, "acceptance-run-ntfy.json");
  await writeFile(ledgerPath, JSON.stringify(ledger), { mode: 0o600 });
  const loaded = await loadCatalogCompatibility(checkedAt, "ntfy", selection);
  assert.equal(loaded.appCount, 94); assert.equal(loaded.possiblePoints, 9400);
  assert.equal(loaded.earnedPoints, 20); assert.equal(loaded.apps[0]!.score, 20);
  assert.equal(loaded.apps[0]!.dimensions.find((row) => row.dimension === "liveRestart")!.level, "live-verified");
  assert.equal((await loadCatalogCompatibility(checkedAt, "wud", selection)).earnedPoints, 20,
    "App display filter must not remove the selected project's credit or denominator");
  assert.equal((await loadCatalogCompatibility(checkedAt, "ntfy")).earnedPoints, 0,
    "Without explicit project selection no runtime evidence is read");
  const second = await publishCompatibilityObservation(evidenceRoot, { ...sanitized, runId: randomUUID(),
    checks: [{ id: "core-round-trip", result: "fail" }] },
    identity.contract, { expectedRevision: 1, expectedRegistryHash: first.registryHash });
  ledger.registry = { revision: second.revision, registryHash: second.registryHash };
  await writeFile(ledgerPath, JSON.stringify(ledger), { mode: 0o600 });
  const failure = await loadCatalogCompatibility(checkedAt, "ntfy", selection);
  assert.equal(failure.earnedPoints, 0, "A current anchored partial failure invalidates the older pass");
  assert.equal(failure.apps[0]!.label, "broken");
  await writeFile(ledgerPath, JSON.stringify({ ...ledger, binding: "0".repeat(64) }), { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", selection), /saved chronology changed/);
  await writeFile(ledgerPath, JSON.stringify(ledger), { mode: 0o600 });
  await unlink(join(evidenceRoot, "registry/revision-000002.json"));
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", selection), /required registry anchor/,
    "Persisted owner anchor detects valid earlier-prefix rollback");
  await unlink(join(evidenceRoot, "registry/revision-000001.json"));
  await writeFile(join(evidenceRoot, "registry/revision-000002.json"), "{}", { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", selection), /sequence has a gap/);
  await assert.rejects(catalogCompatibilityCommand(["--project-root", projectRoot]), /No live receipt import/);
  await assert.rejects(catalogCompatibilityCommand(["--project-root", projectRoot, "--project-id", projectId,
    "--receipt", "made-up.json"]), /No live receipt import/);
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", { projectRoot: "/", projectId }), /explicit canonical/);

  // Both app ledgers share one append-only registry but retain independent anchors.
  const paperlessBase = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/paperless-ngx/", import.meta.url);
  const paperlessBytes = await readFile(new URL("recipe.json", paperlessBase), "utf8");
  const paperlessRecipe = JSON.parse(paperlessBytes);
  const paperlessApp = JSON.parse(await readFile(new URL("manifest.json", paperlessBase), "utf8"));
  const paperlessImages = Object.fromEntries(paperlessRecipe.services.map((service: Record<string, any>) =>
    [service.id, `${service.imageTag}@sha256:${digest}`]));
  const multiId = "multi-anchor";
  const multiCandidate = sharedProjectCandidate({ projectRoot, projectId: multiId, dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [
      { appId: "ntfy", recipe, images, port: 18983 },
      { appId: "paperless-ngx", recipe: paperlessRecipe, images: paperlessImages, port: 18984 },
    ], observed: { checkedAt, ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(multiCandidate.projectDirectory, { recursive: true, mode: 0o700 });
  let multiPrevious: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(multiCandidate,
      { operation: "create", phase, appIds: ["ntfy", "paperless-ngx"] }, multiPrevious);
    multiPrevious = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  function multiOwner(appId: string) {
    return createSharedAcceptanceOwner(projectRoot, multiId, appId, {
      recipeFor(id) {
        if (id === "ntfy") return { recipe, boundedApply: true, recipeSha256: createHash("sha256").update(bytes).digest("hex") };
        assert.equal(id, "paperless-ngx");
        return { recipe: paperlessRecipe, boundedApply: true, recipeSha256: createHash("sha256").update(paperlessBytes).digest("hex") };
      },
      appFor(id) { if (id === "ntfy") return app; return paperlessApp; },
      approvalFor() { throw new Error("No fixture mutation authority"); },
    });
  }
  const multiNtfy = await multiOwner("ntfy").identity();
  const multiPaperless = await multiOwner("paperless-ngx").identity();
  assert.deepEqual(multiPaperless.services, ["paperless-ngx", "paperless-ngx-broker", "paperless-ngx-db"]);
  const multiEvidence = join(projectRoot, `selfhost-verification-${multiId}`);
  await prepareCompatibilityEvidenceRoot(multiEvidence);
  async function publishMulti(identity: typeof multiNtfy, revision: number, registryHash?: string) {
    const { homarrMode: _mode, ...contract } = identity.contract;
    const runId = randomUUID();
    const result = await publishCompatibilityObservation(multiEvidence, { ...contract, runId, checkedAt,
      checks: [{ id: "application-health", result: "pass" }, { id: "core-round-trip", result: "pass" },
        { id: "restart-persistence", result: "pass" }], cleanup: "not-required" },
      identity.contract, { expectedRevision: revision, expectedRegistryHash: registryHash });
    const baseline = { source: "shared-selected-lifecycle", appId: identity.appId, projectRoot, ownerId: multiId,
      recipeSha256: identity.contract.recipeSha256, manifestHash: identity.contract.owner.manifestHash,
      units: identity.services.map((serviceId) => ({ serviceId, imageId: `sha256:${digest}` })),
      epoch: digest, sequence: 1, evidenceId: randomUUID(), state: "running" };
    const ledger: Record<string, any> = { schemaVersion: 1, runId, binding: hash(identity), phase: "finished", baseline,
      stopped: { ...baseline, state: "stopped", sequence: 2, evidenceId: randomUUID() },
      running: { ...baseline, epoch: "b".repeat(64), sequence: 3, evidenceId: randomUUID() }, checkedAt,
      registry: { revision: result.revision, registryHash: result.registryHash } };
    if (identity.appId === "paperless-ngx") {
      ledger.inputs = { "document-id": "42" };
      ledger.binding = hash({ identity, inputs: ledger.inputs });
    }
    const path = join(multiCandidate.projectDirectory, `acceptance-run-${identity.appId}.json`);
    await writeFile(path, JSON.stringify(ledger), { mode: 0o600 });
    return { result, ledger, path };
  }
  const multiFirst = await publishMulti(multiNtfy, 0);
  const multiSecond = await publishMulti(multiPaperless, 1, multiFirst.result.registryHash);
  const multiSelection = { projectRoot, projectId: multiId };
  const both = await loadCatalogCompatibility(checkedAt, "paperless-ngx", multiSelection);
  assert.equal(both.earnedPoints, 40, "Both independently anchored apps score against the shared latest tip");
  assert.equal(both.apps[0]!.dimensions.find((row) => row.dimension === "liveRestart")!.level, "live-verified",
    "Real Paperless receipt dispatch uses generic reviewed availability");
  const multiThird = await publishMulti(multiNtfy, 2, multiSecond.result.registryHash);
  const newestEarlierApp = await loadCatalogCompatibility(checkedAt, "ntfy", multiSelection);
  assert.equal(newestEarlierApp.project!.registryRevision, 3,
    "Greatest validated anchor wins even when sorted-last app has an older revision");
  assert.equal(newestEarlierApp.earnedPoints, 40);
  await writeFile(multiSecond.path, JSON.stringify({ ...multiSecond.ledger,
    registry: { revision: 2, registryHash: "c".repeat(64) } }), { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", multiSelection), /required registry anchor/,
    "A valid latest anchor cannot hide a tampered older independent app anchor");
  await writeFile(multiSecond.path, JSON.stringify(multiSecond.ledger), { mode: 0o600 });
  await writeFile(multiThird.path, JSON.stringify({ ...multiThird.ledger,
    registry: { revision: 2, registryHash: "c".repeat(64) } }), { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", multiSelection), /same registry revision/,
    "Different hashes at the same anchored revision are rejected before scoring");
  await writeFile(multiThird.path, JSON.stringify(multiThird.ledger), { mode: 0o600 });
  await unlink(join(multiEvidence, "registry/revision-000003.json"));
  await assert.rejects(loadCatalogCompatibility(checkedAt, "ntfy", multiSelection), /required registry anchor/,
    "The greatest independent anchor rejects a rolled-back shared registry");

  // Compose proof must remain independent of workload/restart adapter coverage
  // and an unrelated app's unjournaled saved-recipe drift.
  const linkwardenBase = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/linkwarden/", import.meta.url);
  const linkwardenBytes = await readFile(new URL("recipe.json", linkwardenBase), "utf8");
  const linkwardenRecipe = JSON.parse(linkwardenBytes);
  const linkwardenImages = Object.fromEntries(linkwardenRecipe.services.map((service: Record<string, any>) =>
    [service.id, `${service.imageTag}@sha256:${digest}`]));
  const composeId = "compose-anchor";
  const composeCandidate = sharedProjectCandidate({ projectRoot, projectId: composeId, dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [
      { appId: "ntfy", recipe: driftRecipe, images, port: 18985 },
      { appId: "linkwarden", recipe: linkwardenRecipe, images: linkwardenImages, port: 18986 },
    ], observed: { checkedAt, ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(composeCandidate.projectDirectory, { recursive: true, mode: 0o700 });
  let composePrevious: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(composeCandidate,
      { operation: "create", phase, appIds: ["linkwarden", "ntfy"] }, composePrevious);
    composePrevious = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  const composeSelection = { projectRoot, projectId: composeId };
  assert.equal((await loadCatalogCompatibility(checkedAt, "linkwarden", composeSelection)).earnedPoints, 0,
    "Saved fresh-create source chronology is not a production Compose observation");
  const composeState = (await loadSharedProjectState(composeCandidate.projectDirectory, composeId))!;
  const composeSources = ["lib/shared-compose-compatibility.ts", "shared-project.ts", "lib/selfhost-compose.ts", "lib/shared-project-state.ts"];
  const composeSourceBytes = await Promise.all(composeSources.map((name) =>
    readFile(new URL(`../src/${name}`, import.meta.url), "utf8")));
  for (const name of ["compose-project.ts", "compose-lifecycle.sh"]) {
    composeSourceBytes.push(await readFile(new URL(
      `../../../.agents/skills/self-host/workflows/selfhost-compose/scripts/${name}`, import.meta.url), "utf8"));
  }
  const composeSubject = hash(composeSourceBytes);
  const composeContract: CompatibilityReceiptContract = { appId: "linkwarden", dimension: "compose",
    homarrMode: "native", owner: { projectFingerprint: hash(composeState.project),
      revision: composeState.revision, manifestHash: composeState.manifestHash },
    recipeSha256: createHash("sha256").update(linkwardenBytes).digest("hex"),
    images: Object.fromEntries([...composeState.units.linkwarden!].sort().map((id) =>
      [id, composeState.manifest.services.find((service: Record<string, any>) => service.id === id)!.image])),
    subjectSha256: composeSubject,
    verifier: { id: "shared-compose-acceptance", sourceSha256: composeSubject, release: packageMetadata.version } };
  const composeEvidence = join(projectRoot, `selfhost-verification-${composeId}`);
  await prepareCompatibilityEvidenceRoot(composeEvidence);
  const composeRunId = randomUUID();
  const { homarrMode: _composeMode, ...composeIdentity } = composeContract;
  const composePublished = await publishCompatibilityObservation(composeEvidence, {
    ...composeIdentity, runId: composeRunId, checkedAt, cleanup: "not-required",
    checks: [{ id: "fresh-compose-apply", result: "pass" }, { id: "private-exposure", result: "pass" },
      { id: "owned-storage", result: "pass" }],
  }, composeContract, { expectedRevision: 0 });
  assert.equal((await loadCatalogCompatibility(checkedAt, "linkwarden", composeSelection)).earnedPoints, 0,
    "A Compose publisher assertion without its fresh-create owner anchor earns nothing");
  const composeLedger = { schemaVersion: 1, runId: composeRunId, attemptedRecordHash: composeState.previousHash,
    completedRecordHash: composeState.recordHash, contract: composeContract,
    anchor: { revision: composePublished.revision, registryHash: composePublished.registryHash } };
  const composeLedgerPath = join(composeCandidate.projectDirectory, "compose-run-linkwarden.json");
  await writeFile(composeLedgerPath, JSON.stringify(composeLedger), { mode: 0o600 });
  const composeLoaded = await loadCatalogCompatibility(checkedAt, "linkwarden", composeSelection);
  assert.equal(composeLoaded.appCount, 94); assert.equal(composeLoaded.possiblePoints, 9400);
  assert.equal(composeLoaded.earnedPoints, 20);
  assert.equal(composeLoaded.apps[0]!.dimensions.find((row) => row.dimension === "compose")!.level, "live-verified",
    "Compose receipts load for an app without any live/restart adapter");
  assert.equal(composeLoaded.project!.blockers[0]!.appId, "ntfy",
    "An unrelated unjournaled recipe drift retains its blocker without masking valid Compose proof");
  assert.equal((await loadCatalogCompatibility(checkedAt, "linkwarden")).earnedPoints, 0);
  await writeFile(composeLedgerPath, JSON.stringify({ ...composeLedger, completedRecordHash: "c".repeat(64) }), { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "linkwarden", composeSelection), /witnessed owner or Compose verifier changed/);
  await writeFile(composeLedgerPath, JSON.stringify(composeLedger), { mode: 0o600 });
  await writeFile(join(composeCandidate.projectDirectory, "compose-run-ntfy.json"), "{}", { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "linkwarden", composeSelection), /invalid owner chronology/,
    "Missing adapters or known recipe drift never hide an existing corrupt Compose ledger");
  await unlink(join(composeCandidate.projectDirectory, "compose-run-ntfy.json"));
  await unlink(join(composeEvidence, "registry/revision-000001.json"));
  await assert.rejects(loadCatalogCompatibility(checkedAt, "linkwarden", composeSelection), /required registry anchor/,
    "Compose owner anchors detect a valid empty-prefix registry rollback");
  // A derived recipe has no static recipe.json: replay its actual saved choices,
  // retained create journal and executable identity before binding receipt credit.
  const derivedId = "derived-receipt";
  const derivedInput = { appId: "headscale", inputs: {
    "canonical-origin": "https://headscale.example.test", "magic-dns-domain": "mesh.example.test" } };
  const derivedSource = { projectRoot, projectId: derivedId, dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [],
    observed: { checkedAt, ports: [], paths: [], networks: [], volumes: [] } };
  const derived = deriveSharedCreateRecipe(derivedSource, derivedInput);
  const derivedSelection = { appId: "headscale", recipe: derived.recipe, port: 18986,
    images: Object.fromEntries(derived.recipe.services.map((service: Record<string, any>) =>
      [service.id, `${service.imageTag}@sha256:${digest}`])) };
  const derivedBinding = bindSharedCreateRecipe(derivedSource, derivedInput, derivedSelection);
  const derivedCandidate = sharedProjectCandidate({ ...derivedSource, apps: [derivedSelection] });
  await mkdir(derivedCandidate.projectDirectory, { recursive: true, mode: 0o700 });
  let derivedPrevious: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  let derivedState;
  let derivedBindingPath = "";
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    derivedState = await saveSharedProjectState(derivedCandidate,
      { operation: "create", phase, appIds: ["headscale"] }, derivedPrevious);
    if (phase === "reviewed") derivedBindingPath = await prepareSharedDerivedRecipeBinding(derivedState, derivedBinding);
    derivedPrevious = { revision: derivedState.revision, manifestHash: derivedState.manifestHash,
      checkpoint: derivedState.checkpoint };
  }
  const derivedProject = { projectRoot, projectId: derivedId };
  const derivedEmpty = await loadCatalogCompatibility(checkedAt, "headscale", derivedProject);
  assert.equal(derivedEmpty.earnedPoints, 0, "A valid derived binding is not acceptance");
  assert.equal(derivedEmpty.apps[0]!.source!.recipeSha256, null,
    "Materializing project choices must not invent a static catalog recipe identity");
  const derivedContract: CompatibilityReceiptContract = { ...composeContract, appId: "headscale",
    homarrMode: "tile-only", owner: { projectFingerprint: hash(derivedState!.project),
      revision: derivedState!.revision, manifestHash: derivedState!.manifestHash },
    recipeSha256: derived.recipeSha256, images: derivedSelection.images };
  const derivedEvidence = join(projectRoot, `selfhost-verification-${derivedId}`);
  await prepareCompatibilityEvidenceRoot(derivedEvidence);
  const derivedRunId = randomUUID();
  const { homarrMode: _derivedMode, ...derivedIdentity } = derivedContract;
  const derivedPublished = await publishCompatibilityObservation(derivedEvidence, {
    ...derivedIdentity, runId: derivedRunId, checkedAt, cleanup: "not-required",
    checks: [{ id: "fresh-compose-apply", result: "pass" }, { id: "private-exposure", result: "pass" },
      { id: "owned-storage", result: "pass" }],
  }, derivedContract, { expectedRevision: 0 });
  assert.equal((await loadCatalogCompatibility(checkedAt, "headscale", derivedProject)).earnedPoints, 0,
    "A derived receipt without its owner chronology earns nothing");
  const derivedLedger = { schemaVersion: 1, runId: derivedRunId, attemptedRecordHash: derivedState!.previousHash,
    completedRecordHash: derivedState!.recordHash, contract: derivedContract,
    anchor: { revision: derivedPublished.revision, registryHash: derivedPublished.registryHash } };
  const derivedLedgerPath = join(derivedCandidate.projectDirectory, "compose-run-headscale.json");
  await writeFile(derivedLedgerPath, JSON.stringify(derivedLedger), { mode: 0o600 });
  const derivedLoaded = await loadCatalogCompatibility(checkedAt, "headscale", derivedProject);
  assert.equal(derivedLoaded.earnedPoints, 20);
  assert.equal(derivedLoaded.apps[0]!.dimensions.find((row) => row.dimension === "compose")!.level, "live-verified");
  assert.equal(derivedLoaded.appCount, 94);
  await writeFile(derivedLedgerPath, JSON.stringify({ ...derivedLedger,
    contract: { ...derivedContract, recipeSha256: "0".repeat(64) } }), { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "headscale", derivedProject),
    /witnessed owner or Compose verifier changed/, "Old derived recipe receipts fail closed");
  await writeFile(derivedLedgerPath, JSON.stringify(derivedLedger), { mode: 0o600 });
  const staleDerivedBinding = structuredClone(derivedBinding);
  staleDerivedBinding.derived.sourceSha256 = "0".repeat(64);
  const { bindingHash: _staleHash, ...staleBindingRecord } = staleDerivedBinding;
  staleDerivedBinding.bindingHash = hash(staleBindingRecord);
  await writeFile(derivedBindingPath, JSON.stringify(staleDerivedBinding), { mode: 0o600 });
  await assert.rejects(loadCatalogCompatibility(checkedAt, "headscale", derivedProject), /differs/,
    "Even a rehashed saved binding cannot hide current executable source drift");
  await unlink(derivedBindingPath);
  await assert.rejects(loadCatalogCompatibility(checkedAt, "headscale", derivedProject), /ENOENT/,
    "Missing derived bindings must never fall back to a guessed recipe");
  // Homarr credit requires a current owner-bound live invocation, not saved seeding/readiness.
  const dashboardId = "dashboard-proof";
  const dashboardIds = ["glances", "homarr", "sonarr"];
  const dashboardRecipes = new Map<string, any>();
  const dashboardApps = new Map<string, any>();
  const dashboardSelections = [];
  for (const [index, id] of dashboardIds.entries()) {
    const directory = new URL(`../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${id}/`, import.meta.url);
    const bytes = await readFile(new URL("recipe.json", directory), "utf8");
    const recipe = JSON.parse(bytes);
    dashboardRecipes.set(id, { recipe, recipeSha256: createHash("sha256").update(bytes).digest("hex"), boundedApply: true });
    dashboardApps.set(id, JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")));
    const hostMounts = recipe.services.flatMap((service: any) => service.mounts.filter((mount: any) => mount.hostPath));
    let hostPaths;
    if (hostMounts.length) hostPaths = Object.fromEntries(hostMounts.map((mount: any) =>
      [mount.name, join(projectRoot, ".selfhost", "shared", dashboardId, "data", "shared")]));
    dashboardSelections.push({ appId: id, recipe,
      images: Object.fromEntries(recipe.services.map((service: any) => [service.id, `${service.imageTag}@sha256:${digest}`])),
      port: 19500 + index, hostPaths });
  }
  const dashboardCandidate = sharedProjectCandidate({ projectRoot, projectId: dashboardId, dockerContext: "default",
    uid: process.getuid!(), gid: process.getgid!(), timezone: "Etc/UTC", apps: dashboardSelections,
    observed: { checkedAt, ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(dashboardCandidate.projectDirectory, { recursive: true, mode: 0o700 });
  let dashboardPrevious: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(dashboardCandidate,
      { operation: "create", phase, appIds: dashboardIds }, dashboardPrevious);
    dashboardPrevious = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  const dashboardState = (await loadSharedProjectState(dashboardCandidate.projectDirectory, dashboardId))!;
  const dashboardDependencies = { recipeFor: (id: string) => dashboardRecipes.get(id)!, appFor: (id: string) => dashboardApps.get(id)! };
  for (const id of dashboardIds) assert.equal(sharedUnitRecipeCheck(dashboardState, id, dashboardDependencies.recipeFor),
    "matches-saved-selection", `The synthetic ${id} recipe matches its saved owner`);
  const dashboardSelected = dashboardIds.map((id) => {
    const metadata = resolveSharedAppMetadata(id, dashboardApps.get(id), dashboardRecipes.get(id).recipe,
      dashboardState.manifest.services.find((service: any) => service.id === id)!);
    return { mapping: homarrStackMapping(id), seed: { id, appName: metadata.name,
      browserUrl: metadata.browserUrl!, serverUrl: metadata.serverUrl! } };
  });
  const dashboardReadback = { mutation: false, apiKeyAuthorizationVerified: true,
    services: dashboardIds.map((id) => ({ id, metadataVerified: true, structureVerified: true,
      notebookContentVerified: true, notebookLayoutVerified: true,
      integrationStructureVerified: true, widgetStructureVerified: true })) };
  const dashboardFunctional = dashboardIds.map((serviceId) => ({ serviceId, mutation: false,
    checks: { tile: { status: "pass" }, reachability: { status: "pass" }, integrationTest: { status: "pass" } },
    widgets: (homarrStackMapping(serviceId)?.widgets ?? []).map(({ kind }) =>
      ({ kind, structure: { status: "pass" }, data: { status: "pass" } })) }));
  const dashboardSelection = { projectRoot, projectId: dashboardId };
  const dashboardScore = () => loadCatalogCompatibility(checkedAt, undefined, dashboardSelection);
  assert.equal((await dashboardScore()).earnedPoints, 0, "Saved dashboard source alone earns no credit");
  const incompleteWidgets = structuredClone(dashboardFunctional);
  incompleteWidgets.find((row) => row.serviceId === "sonarr")!.widgets = [];
  let witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, dashboardReadback, incompleteWidgets, dashboardDependencies, checkedAt);
  assert.equal((await dashboardScore()).earnedPoints, 20, "Empty native widget inventory cannot pass; tile-only can pass");
  await assert.rejects(publishSharedHomarrCompatibility(witness, dashboardReadback, dashboardFunctional, dashboardDependencies, checkedAt),
    /publication generation/, "A captured invocation cannot be replayed");
  witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, dashboardReadback, dashboardFunctional, dashboardDependencies, checkedAt);
  const dashboardPass = await dashboardScore();
  assert.equal(dashboardPass.earnedPoints, 40);
  assert.equal(dashboardPass.apps.find((row) => row.appId === "homarr")!.score, 0,
    "Control-plane reload persistence is never inferred from status");
  const failedConnection = structuredClone(dashboardFunctional);
  failedConnection.find((row) => row.serviceId === "sonarr")!.checks.integrationTest.status = "fail";
  witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, dashboardReadback, failedConnection, dashboardDependencies, checkedAt);
  assert.equal((await dashboardScore()).earnedPoints, 20, "A trustworthy current native failure supersedes the earlier pass");
  witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, dashboardReadback, dashboardFunctional, dashboardDependencies, checkedAt);
  const failedResources = structuredClone(dashboardReadback);
  Object.assign(failedResources.services.find((row) => row.id === "sonarr")!,
    { status: "resource-readback-failed", metadataVerified: false, structureVerified: false,
      notebookContentVerified: false, notebookLayoutVerified: false });
  witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, failedResources, dashboardFunctional, dashboardDependencies, checkedAt);
  const resourceFailure = await dashboardScore();
  assert.equal(resourceFailure.earnedPoints, 20, "A fresh failed resource query cannot retain an older native pass");
  assert.equal(resourceFailure.apps.find((row) => row.appId === "sonarr")!.label, "broken");
  witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, dashboardReadback, dashboardFunctional, dashboardDependencies, checkedAt);
  witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, dashboardReadback,
    dashboardFunctional.filter((row) => row.serviceId !== "sonarr"), dashboardDependencies, checkedAt);
  assert.equal((await dashboardScore()).earnedPoints, 20, "A missing functional row leaves native proof pending, not historically passed");
  assert.equal((await readSharedHomarrCompatibilityIdentity(projectRoot, dashboardId, "sonarr", dashboardDependencies))!.contract, null);
  await invalidateSharedHomarrCompatibility(dashboardState, dashboardDependencies);
  assert.equal((await dashboardScore()).earnedPoints, 0, "Pending/uncertain managed publication invalidates old observations");
  witness = await prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  await publishSharedHomarrCompatibility(witness, dashboardReadback, dashboardFunctional, dashboardDependencies, checkedAt);
  assert.equal((await dashboardScore()).earnedPoints, 40, "A new witnessed invocation can reverify the pending generation");
  const changedHomarr = { ...dashboardDependencies, recipeFor(id: string) {
    const selected = dashboardRecipes.get(id)!;
    if (id !== "homarr") return selected;
    const recipe = structuredClone(selected.recipe); recipe.services[0].restart = "always";
    return { ...selected, recipe };
  } };
  await assert.rejects(prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected.filter((row) => row.seed.id !== "homarr"), changedHomarr),
    /publication generation/, "Homarr's own recipe must match even if only an app is selected");
  const dashboardLedgerPath = join(dashboardCandidate.projectDirectory, "homarr-run-sonarr.json");
  const dashboardLedger = JSON.parse(await readFile(dashboardLedgerPath, "utf8"));
  assert.equal(JSON.stringify(dashboardLedger).includes("NEVER-EMIT-PRIVATE-FIXTURE"), false);
  await writeFile(dashboardLedgerPath, JSON.stringify({ ...dashboardLedger, ownerRecordHash: "0".repeat(64) }), { mode: 0o600 });
  assert.equal((await readSharedHomarrCompatibilityIdentity(projectRoot, dashboardId, "sonarr", dashboardDependencies))!.contract, null,
    "Changed owner chronology cannot earn credit");
  await invalidateSharedHomarrCompatibility(dashboardState, dashboardDependencies);
  assert.equal((await dashboardScore()).earnedPoints, 0, "Stale historical proof does not prevent pending rebinding");

  // Minimal compiled executable/source graph: no full package or Node distribution build.
  const compiled = join(projectRoot, "compiled-homarr-contract");
  await mkdir(compiled, { mode: 0o700 });
  for (const name of sharedHomarrCompatibilitySources) {
    await writeFile(join(compiled, name.replace("../", "")),
      await readFile(new URL(`../src/lib/${name}`, import.meta.url)), { mode: 0o644 });
  }
  const workflows = new URL("../../../.agents/skills/self-host/workflows/", import.meta.url);
  for (const path of ["selfhost-compose/scripts/compose-project.ts", "selfhost-compose/scripts/compose-lifecycle.sh",
    "selfhost-host/scripts/inspect-host.sh", ...["manual-job", "non-secret-policy", "private-daemon", "runtime-resources",
      "recipe-image-reference", "owner-directory", "docker-cli-tls"].map((name) => `selfhost/references/catalog/types/${name}.ts`)]) {
    const target = join(compiled, "workflows", path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(new URL(path, workflows)), { mode: 0o644 });
  }
  for (const id of dashboardIds) {
    const directory = join(compiled, "workflows/selfhost/references/catalog/apps", id);
    await mkdir(directory, { recursive: true });
    const mapping = homarrStackMapping(id);
    if (mapping) await writeFile(join(directory, "homarr.json"), await readFile(new URL(`selfhost/references/catalog/apps/${id}/homarr.json`, workflows)));
    await writeFile(join(directory, "setup.js"), `export default { appId: ${JSON.stringify(id)} };\n`);
  }
  const bundled = await Bun.build({ entrypoints: [new URL("../src/lib/shared-homarr-compatibility.ts", import.meta.url).pathname],
    target: "bun", outdir: compiled, naming: "bundle.js" });
  assert.equal(bundled.success, true);
  const compiledModule = await import(pathToFileURL(join(compiled, "bundle.js")).href);
  const compiledWitness = await compiledModule.prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies);
  assert.equal(compiledWitness.selected.length, 2, "Shipped companion sources resolve in compiled mode");
  const executable = await readFile(join(compiled, "bundle.js"), "utf8");
  await writeFile(join(compiled, "bundle.js"), `${executable}\n// synthetic warm executable drift\n`);
  await assert.rejects(compiledModule.prepareSharedHomarrCompatibility(dashboardState, "personal", dashboardSelected, dashboardDependencies),
    /implementation changed/, "The warm compiled module cannot bless changed executable bytes");
  const newest = JSON.parse(await readFile(join(dashboardCandidate.projectDirectory, "homarr-run-sonarr.json"), "utf8"));
  await unlink(join(projectRoot, `selfhost-verification-${dashboardId}`, `registry/revision-${String(newest.anchor.revision).padStart(6, "0")}.json`));
  await assert.rejects(dashboardScore(), /anchor|gap/, "A pending historical ledger still detects registry rollback");
  console.log("catalog project receipt fixture passed; synthetic owner/registry observations, no Docker/network or live acceptance");
} finally { await rm(projectRoot, { recursive: true, force: true }); }
