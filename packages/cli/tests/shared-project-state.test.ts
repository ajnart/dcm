import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extendSharedProject, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { loadPreparedSharedAddSource, loadSharedPrestartAuthoritySource, loadSharedProjectState, saveSharedProjectState,
  loadSharedRemovedAppSource, loadSharedUnitComposeOriginStates, sharedReinstallCandidate } from "../src/lib/shared-project-state.ts";
import linkwarden from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/linkwarden/recipe.json";

function selection(appId: string, port: number) {
  const imageTag = "docker.io/library/busybox:1.37.0";
  return {
    appId, port, images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}` },
    recipe: {
      schemaVersion: 2, kind: "multi-service-compose", appId,
      services: [{ id: appId, imageTag, user: "image-default",
        imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped",
        readOnly: false, environment: [{ name: "SYNTHETIC_SETUP_FLAG", value: "false" }],
        hostEnvironment: [], fileEnvironment: [],
        mounts: [{ name: "state", target: "/state" }], dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [], defaults: { hostIp: "127.0.0.1" },
    },
  };
}

const temporary = await mkdtemp(join(tmpdir(), "selfhost-shared-state-"));
try {
  const projectId = "state-test";
  const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId,
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: [selection("alpha", 18080), selection("beta", 18081)],
    observed: { checkedAt: "2026-09-29T12:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const reviewed = { operation: "create" as const, phase: "reviewed" as const, appIds: ["alpha", "beta"] };
  const attempted = { ...reviewed, phase: "attempted" as const };
  const completed = { ...reviewed, phase: "completed" as const };
  const empty = { revision: 0, manifestHash: null, checkpoint: null };
  assert.equal(await loadSharedProjectState(candidate.projectDirectory, projectId), null);
  const first = await saveSharedProjectState(candidate, reviewed, empty);
  assert.equal(first.revision, 1);
  assert.equal(first.manifestRevision, 1);
  assert.equal(first.checkpoint.phase, "reviewed");
  assert.deepEqual((await loadSharedProjectState(candidate.projectDirectory, projectId, first.manifestHash))?.units,
    candidate.units);
  await assert.rejects(saveSharedProjectState(candidate, attempted, empty), /compare-and-set/);
  await assert.rejects(loadSharedProjectState(candidate.projectDirectory, "other-project"), /identity/);
  await assert.rejects(loadSharedProjectState(candidate.projectDirectory, projectId, "0".repeat(64)), /manifest hash/);

  const second = await saveSharedProjectState(candidate, attempted,
    { revision: first.revision, manifestHash: first.manifestHash, checkpoint: reviewed });
  assert.equal(second.revision, 2);
  assert.equal(second.manifestRevision, 1);
  await assert.rejects(saveSharedProjectState(candidate, reviewed,
    { revision: second.revision, manifestHash: second.manifestHash, checkpoint: reviewed }), /compare-and-set/);
  const changed = structuredClone(candidate);
  changed.manifest.services.find((service: { id: string }) => service.id === "alpha")
    .environment.find((entry: { name: string }) => entry.name === "SYNTHETIC_SETUP_FLAG").value = "true";
  await assert.rejects(saveSharedProjectState(changed, reviewed,
    { revision: second.revision, manifestHash: second.manifestHash, checkpoint: attempted }), /changed manifest/);
  const third = await saveSharedProjectState(candidate, completed,
    { revision: second.revision, manifestHash: second.manifestHash, checkpoint: attempted });
  const transition = { operation: "transition" as const, phase: "reviewed" as const, appIds: ["alpha"] };
  const transitionAttempted = { ...transition, phase: "attempted" as const };
  const transitionCompleted = { ...transition, phase: "completed" as const };
  const undeclaredPromotion = structuredClone(changed);
  undeclaredPromotion.manifest.project.ownership = "verified-existing";
  undeclaredPromotion.manifest.observed.project = { id: third.project.id,
    directory: third.project.directory, owner: third.project.owner };
  await assert.rejects(saveSharedProjectState(undeclaredPromotion, transition,
    { revision: third.revision, manifestHash: third.manifestHash, checkpoint: completed }), /exactly one environment/);
  const fourth = await saveSharedProjectState(changed, transition,
    { revision: third.revision, manifestHash: third.manifestHash, checkpoint: completed });
  assert.equal(fourth.manifestRevision, 2);
  assert.notEqual(fourth.manifestHash, third.manifestHash);
  const wrongSettings = structuredClone(changed);
  wrongSettings.settings.uid = 1001;
  await assert.rejects(saveSharedProjectState(wrongSettings, transition,
    { revision: fourth.revision, manifestHash: fourth.manifestHash, checkpoint: transition }), /common settings/);

  const fifth = await saveSharedProjectState(changed, transitionAttempted,
    { revision: fourth.revision, manifestHash: fourth.manifestHash, checkpoint: transition });
  const sixth = await saveSharedProjectState(changed, transitionCompleted,
    { revision: fifth.revision, manifestHash: fifth.manifestHash, checkpoint: transitionAttempted });
  assert.equal(sixth.manifest.services.find((service: { id: string }) => service.id === "alpha")
    .environment[0].value, "true");
  assert.equal(sixth.manifest.services.find((service: { id: string }) => service.id === "beta")
    .environment[0].value, "false");
  assert.deepEqual(sixth.units, third.units);
  assert.deepEqual(sixth.selectionFingerprints, third.selectionFingerprints);
  const retainedData = join(candidate.projectDirectory, "data", "beta", "retained-marker");
  await mkdir(join(candidate.projectDirectory, "data", "beta"), { recursive: true, mode: 0o700 });
  await writeFile(retainedData, "synthetic non-secret data\n", { mode: 0o600 });
  const wrongUnit = structuredClone(changed);
  wrongUnit.selectionFingerprints.alpha = "b".repeat(64);
  await assert.rejects(saveSharedProjectState(wrongUnit,
    { operation: "resume", phase: "reviewed", appIds: ["alpha"] },
    { revision: sixth.revision, manifestHash: sixth.manifestHash, checkpoint: transitionCompleted }), /saved app unit was replaced/);
  const removed = structuredClone(changed);
  removed.manifest.services = removed.manifest.services.filter((service: { id: string }) => service.id !== "beta");
  removed.manifest.networks = removed.manifest.networks.filter((network: { id: string }) => network.id !== "beta-private");
  delete removed.units.beta;
  delete removed.selectionFingerprints.beta;
  const removal = { operation: "remove" as const, phase: "reviewed" as const, appIds: ["beta"] };
  const removalAttempted = { ...removal, phase: "attempted" as const };
  const removalCompleted = { ...removal, phase: "completed" as const };
  const sixthExpected = { revision: sixth.revision, manifestHash: sixth.manifestHash, checkpoint: transitionCompleted };
  await assert.rejects(saveSharedProjectState(removed,
    { operation: "resume", phase: "reviewed", appIds: ["beta"] }, sixthExpected), /removed units need/);
  await assert.rejects(saveSharedProjectState(removed,
    { operation: "remove", phase: "reviewed", appIds: ["alpha"] }, sixthExpected), /removed units need/);
  const mixed = sharedProjectCandidate({ projectRoot: temporary, projectId,
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: [selection("alpha", 18080), selection("gamma", 18082)],
    observed: { checkedAt: "2026-09-29T12:02:00Z", ports: [], paths: [], networks: [] } });
  await assert.rejects(saveSharedProjectState(mixed, removal, sixthExpected), /mix app addition and removal/);
  const seventh = await saveSharedProjectState(removed, removal, sixthExpected);
  await assert.rejects(loadSharedRemovedAppSource(seventh, "beta"), /completed exact owner/);
  assert.equal(seventh.manifestRevision, 3);
  assert.deepEqual(Object.keys(seventh.units), ["alpha"]);
  const priorRevision = JSON.parse(await readFile(join(candidate.projectDirectory, "state", "revision-000006.json"), "utf8"));
  assert.deepEqual(Object.keys(priorRevision.units), ["alpha", "beta"]);
  const eighth = await saveSharedProjectState(removed, removalAttempted,
    { revision: seventh.revision, manifestHash: seventh.manifestHash, checkpoint: removal });
  const ninth = await saveSharedProjectState(removed, removalCompleted,
    { revision: eighth.revision, manifestHash: eighth.manifestHash, checkpoint: removalAttempted });
  const historicalRemoval = await loadSharedRemovedAppSource(ninth, "beta");
  assert.equal(historicalRemoval.source.recordHash, sixth.recordHash);
  assert.equal(historicalRemoval.composeOrigin.recordHash, first.recordHash);
  await assert.rejects(loadSharedRemovedAppSource(ninth, "alpha"), /absent app/);
  assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.revision, ninth.revision);
  assert.equal(await readFile(retainedData, "utf8"), "synthetic non-secret data\n");
  const resume = { operation: "resume" as const, phase: "reviewed" as const, appIds: ["beta"] };
  const tenth = await saveSharedProjectState(removed, resume,
    { revision: ninth.revision, manifestHash: ninth.manifestHash, checkpoint: removalCompleted });
  assert.equal(tenth.checkpoint.operation, "resume");

  const revisionPath = join(candidate.projectDirectory, "state", "revision-000010.json");
  const hardlinkPath = join(temporary, "revision-hardlink");
  await link(revisionPath, hardlinkPath);
  await assert.rejects(loadSharedProjectState(candidate.projectDirectory, projectId), /unsafe revision file/);
  await unlink(hardlinkPath);
  const original = await readFile(revisionPath);
  const tampered = JSON.parse(original.toString());
  tampered.settings.uid = 1001;
  await writeFile(revisionPath, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(loadSharedProjectState(candidate.projectDirectory, projectId), /integrity/);
  await writeFile(revisionPath, original);
  await chmod(revisionPath, 0o644);
  await assert.rejects(loadSharedProjectState(candidate.projectDirectory, projectId), /unsafe revision file/);
  await chmod(revisionPath, 0o600);
  const symlinkPath = join(candidate.projectDirectory, "state", "revision-000011.json");
  await symlink(revisionPath, symlinkPath);
  await assert.rejects(loadSharedProjectState(candidate.projectDirectory, projectId));
  await unlink(symlinkPath);
  assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.revision, 10);

  const preparedProject = sharedProjectCandidate({ projectRoot: temporary,
    projectId: "prepared-test", dockerContext: "default", uid: 1000, gid: 1000,
    timezone: "Etc/UTC", apps: [selection("alpha", 19080)],
    observed: { checkedAt: "2026-09-29T12:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(preparedProject.projectDirectory, { mode: 0o700 });
  const preparedReview = { operation: "create" as const, phase: "reviewed" as const,
    appIds: ["alpha"] };
  const preparedFirst = await saveSharedProjectState(preparedProject, preparedReview, empty);
  const preparedSecond = await saveSharedProjectState(preparedProject,
    { ...preparedReview, phase: "prepared" },
    { revision: preparedFirst.revision, manifestHash: preparedFirst.manifestHash,
      checkpoint: preparedReview });
  const preparedThird = await saveSharedProjectState(preparedProject,
    { ...preparedReview, phase: "attempted" },
    { revision: preparedSecond.revision, manifestHash: preparedSecond.manifestHash,
      checkpoint: preparedSecond.checkpoint });
  assert.equal(preparedThird.checkpoint.phase, "attempted");
  const preparedCompleted = await saveSharedProjectState(preparedProject,
    { ...preparedReview, phase: "completed" },
    { revision: preparedThird.revision, manifestHash: preparedThird.manifestHash,
      checkpoint: preparedThird.checkpoint });
  const addCandidate = extendSharedProject(preparedProject, [selection("beta", 19081)],
    { projectRoot: temporary, projectId: "prepared-test", dockerContext: "default",
      uid: 1000, gid: 1000, timezone: "Etc/UTC" },
    { checkedAt: "2026-10-03T12:00:00Z",
      ports: [{ hostIp: "127.0.0.1", published: 19080, protocol: "tcp", owner: "prepared-test" }],
      paths: [{ path: join(preparedProject.projectDirectory, "data", "alpha", "state"), owner: "prepared-test" }],
      networks: ["front", "alpha-private"].map((id) => ({ name: `prepared-test-${id}`, owner: "prepared-test" })),
      project: { id: "prepared-test", owner: "prepared-test", directory: preparedProject.projectDirectory } });
  const addReview = { operation: "add" as const, phase: "reviewed" as const, appIds: ["beta"] };
  const addReviewed = await saveSharedProjectState(addCandidate, addReview,
    { revision: preparedCompleted.revision, manifestHash: preparedCompleted.manifestHash,
      checkpoint: preparedCompleted.checkpoint });
  await assert.rejects(loadPreparedSharedAddSource(addReviewed), /exact prepared state/);
  const addPrepared = await saveSharedProjectState(addCandidate, { ...addReview, phase: "prepared" },
    { revision: addReviewed.revision, manifestHash: addReviewed.manifestHash, checkpoint: addReviewed.checkpoint });
  assert.equal((await loadPreparedSharedAddSource(addPrepared)).recordHash, preparedCompleted.recordHash);
  assert.equal((await loadSharedPrestartAuthoritySource(addPrepared, "beta")).recordHash, addPrepared.recordHash);
  assert.equal((await loadSharedPrestartAuthoritySource(addPrepared, "alpha")).recordHash, preparedSecond.recordHash);
  const addAttempted = await saveSharedProjectState(addCandidate, { ...addReview, phase: "attempted" },
    { revision: addPrepared.revision, manifestHash: addPrepared.manifestHash, checkpoint: addPrepared.checkpoint });
  await assert.rejects(loadPreparedSharedAddSource(addPrepared), /exact prepared state/);
  await assert.rejects(loadPreparedSharedAddSource(addAttempted), /exact prepared state/);
  assert.equal((await loadSharedPrestartAuthoritySource(addAttempted, "beta")).recordHash, addPrepared.recordHash);
  await assert.rejects(loadSharedPrestartAuthoritySource(addPrepared, "beta"), /exact current journal/);
  await assert.rejects(loadSharedPrestartAuthoritySource(addAttempted, "gamma"), /installed app identity/);
  await assert.rejects(saveSharedProjectState(addCandidate,
    { operation: "start", phase: "prepared", appIds: ["alpha"] },
    { revision: addAttempted.revision, manifestHash: addAttempted.manifestHash,
      checkpoint: addAttempted.checkpoint }), /supported operation\/phase/);

  const restoreProject = sharedProjectCandidate({ projectRoot: temporary,
    projectId: "restore-test", dockerContext: "default", uid: 1000, gid: 1000,
    timezone: "Etc/UTC", apps: [selection("alpha", 19400), selection("beta", 19401)],
    observed: { checkedAt: "2026-10-04T12:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(restoreProject.projectDirectory, { mode: 0o700 });
  const originalReview = await saveSharedProjectState(restoreProject, reviewed, empty);
  const originalAttempt = await saveSharedProjectState(restoreProject, attempted,
    { revision: originalReview.revision, manifestHash: originalReview.manifestHash, checkpoint: originalReview.checkpoint });
  const originalComplete = await saveSharedProjectState(restoreProject, completed,
    { revision: originalAttempt.revision, manifestHash: originalAttempt.manifestHash, checkpoint: originalAttempt.checkpoint });
  const withoutBeta = structuredClone(restoreProject);
  withoutBeta.manifest.services = withoutBeta.manifest.services.filter((service) => service.id !== "beta");
  withoutBeta.manifest.networks = withoutBeta.manifest.networks.filter((network) => network.id !== "beta-private");
  delete withoutBeta.units.beta;
  delete withoutBeta.selectionFingerprints.beta;
  const removeReview = await saveSharedProjectState(withoutBeta, removal,
    { revision: originalComplete.revision, manifestHash: originalComplete.manifestHash, checkpoint: originalComplete.checkpoint });
  const removeAttempt = await saveSharedProjectState(withoutBeta, removalAttempted,
    { revision: removeReview.revision, manifestHash: removeReview.manifestHash, checkpoint: removeReview.checkpoint });
  await assert.rejects(loadSharedRemovedAppSource(removeAttempt, "beta"), /completed exact owner/);
  const removeComplete = await saveSharedProjectState(withoutBeta, removalCompleted,
    { revision: removeAttempt.revision, manifestHash: removeAttempt.manifestHash, checkpoint: removeAttempt.checkpoint });
  const removedSource = await loadSharedRemovedAppSource(removeComplete, "beta");
  const restore = sharedReinstallCandidate(removeComplete, removedSource.source, "beta");
  assert.equal(restore.manifest.services.find((service) => service.id === "beta").ports[0].published, 19401);
  assert.equal(restore.manifest.services.find((service) => service.id === "beta").image,
    restoreProject.manifest.services.find((service) => service.id === "beta").image);
  assert.ok(restore.manifest.services.every((service) => service.mounts.every((mount) => mount.ownership === "verified-existing")));
  const restoreExpected = { revision: removeComplete.revision, manifestHash: removeComplete.manifestHash, checkpoint: removeComplete.checkpoint };
  const restoreCheckpoint = { operation: "reinstall" as const, phase: "reviewed" as const,
    appIds: ["beta"], reinstallSourceHash: removedSource.source.recordHash };
  await assert.rejects(saveSharedProjectState(restore, { operation: "add", phase: "reviewed", appIds: ["beta"] },
    restoreExpected), /cannot reuse a removed ID/);
  await assert.rejects(saveSharedProjectState(restore, { ...restoreCheckpoint, reinstallSourceHash: "a".repeat(64) },
    restoreExpected), /historical source changed/);
  const changedRestore = structuredClone(restore);
  changedRestore.manifest.services.find((service) => service.id === "beta").environment[0].value = "true";
  await assert.rejects(saveSharedProjectState(changedRestore, restoreCheckpoint, restoreExpected), /changed saved app/);
  const changedObservation = structuredClone(restore);
  changedObservation.manifest.observed.paths.push({ path: join(restoreProject.projectDirectory, "invented"), owner: "restore-test" });
  await assert.rejects(saveSharedProjectState(changedObservation, restoreCheckpoint, restoreExpected), /changed saved app/);
  const conflicting = structuredClone(removeComplete);
  conflicting.manifest.services[0].ports[0].published = 19401;
  assert.throws(() => sharedReinstallCandidate(conflicting, removedSource.source, "beta"), /saved port/);
  const restoreReviewed = await saveSharedProjectState(restore, restoreCheckpoint, restoreExpected);
  await assert.rejects(saveSharedProjectState(restore, { ...restoreCheckpoint, phase: "attempted", reinstallSourceHash: "b".repeat(64) },
    { revision: restoreReviewed.revision, manifestHash: restoreReviewed.manifestHash, checkpoint: restoreReviewed.checkpoint }), /source cannot change/);
  const restoreAttempt = await saveSharedProjectState(restore, { ...restoreCheckpoint, phase: "attempted" },
    { revision: restoreReviewed.revision, manifestHash: restoreReviewed.manifestHash, checkpoint: restoreReviewed.checkpoint });
  const restoreComplete = await saveSharedProjectState(restore, { ...restoreCheckpoint, phase: "completed" },
    { revision: restoreAttempt.revision, manifestHash: restoreAttempt.manifestHash, checkpoint: restoreAttempt.checkpoint });
  const restoredOrigins = await loadSharedUnitComposeOriginStates(restoreProject.projectDirectory, "restore-test", restoreComplete.recordHash);
  assert.equal(restoredOrigins.beta.recordHash, originalReview.recordHash, "Restored containers use their original immutable Compose file");
  assert.deepEqual((await loadSharedProjectState(restoreProject.projectDirectory, "restore-test"))?.units, restore.units);
  // A subsequent removal/restoration still uses the original immutable owner,
  // not the preceding restore's aggregate manifest or a recursive projection.
  const repeatedRemoval = structuredClone(restore);
  repeatedRemoval.manifest.services = repeatedRemoval.manifest.services.filter((service) => service.id !== "beta");
  repeatedRemoval.manifest.networks = repeatedRemoval.manifest.networks.filter((network) => network.id !== "beta-private");
  delete repeatedRemoval.units.beta;
  delete repeatedRemoval.selectionFingerprints.beta;
  const repeatedReview = await saveSharedProjectState(repeatedRemoval, removal,
    { revision: restoreComplete.revision, manifestHash: restoreComplete.manifestHash, checkpoint: restoreComplete.checkpoint });
  const repeatedAttempt = await saveSharedProjectState(repeatedRemoval, removalAttempted,
    { revision: repeatedReview.revision, manifestHash: repeatedReview.manifestHash, checkpoint: repeatedReview.checkpoint });
  const repeatedComplete = await saveSharedProjectState(repeatedRemoval, removalCompleted,
    { revision: repeatedAttempt.revision, manifestHash: repeatedAttempt.manifestHash, checkpoint: repeatedAttempt.checkpoint });
  const repeatedSource = await loadSharedRemovedAppSource(repeatedComplete, "beta");
  assert.equal(repeatedSource.composeOrigin.recordHash, originalReview.recordHash);
  const repeatedRestore = sharedReinstallCandidate(repeatedComplete, repeatedSource.source, "beta");
  const repeatedCheckpoint = { ...restoreCheckpoint, reinstallSourceHash: repeatedSource.source.recordHash };
  const repeatedRestoreReview = await saveSharedProjectState(repeatedRestore, repeatedCheckpoint,
    { revision: repeatedComplete.revision, manifestHash: repeatedComplete.manifestHash, checkpoint: repeatedComplete.checkpoint });
  const repeatedOrigins = await loadSharedUnitComposeOriginStates(restoreProject.projectDirectory, "restore-test", repeatedRestoreReview.recordHash);
  assert.equal(repeatedOrigins.beta.recordHash, originalReview.recordHash);

  const freshClosure = sharedProjectCandidate({ projectRoot: temporary,
    projectId: "fresh-closure", dockerContext: "default", uid: 1000, gid: 1000,
    timezone: "Etc/UTC", apps: [{ appId: "linkwarden", recipe: linkwarden, port: 19300,
      images: Object.fromEntries(linkwarden.services.map((service) =>
        [service.id, `${service.imageTag}@sha256:${"c".repeat(64)}`])) }],
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(freshClosure.projectDirectory, { mode: 0o700 });
  const freshReview = { operation: "create" as const, phase: "reviewed" as const, appIds: ["linkwarden"] };
  const freshFirst = await saveSharedProjectState(freshClosure, freshReview, empty);
  const freshAttempted = await saveSharedProjectState(freshClosure, { ...freshReview, phase: "attempted" },
    { revision: freshFirst.revision, manifestHash: freshFirst.manifestHash, checkpoint: freshFirst.checkpoint });
  const freshCompleted = await saveSharedProjectState(freshClosure, { ...freshReview, phase: "completed" },
    { revision: freshAttempted.revision, manifestHash: freshAttempted.manifestHash, checkpoint: freshAttempted.checkpoint });
  const freshExpected = { revision: freshCompleted.revision, manifestHash: freshCompleted.manifestHash,
    checkpoint: freshCompleted.checkpoint };
  const closure = { operation: "transition" as const, phase: "reviewed" as const, appIds: ["linkwarden"] };
  const promoted = structuredClone(freshClosure);
  promoted.manifest.project.ownership = "verified-existing";
  promoted.manifest.observed.project = { id: freshCompleted.project.id,
    directory: freshCompleted.project.directory, owner: freshCompleted.project.owner };
  await assert.rejects(saveSharedProjectState(promoted, closure, freshExpected), /exactly one environment/);
  promoted.manifest.services.find((service: { id: string }) => service.id === "linkwarden")
    .environment.find((entry: { name: string }) => entry.name === "NEXT_PUBLIC_DISABLE_REGISTRATION").value = "true";
  const wrongObservation = structuredClone(promoted);
  wrongObservation.manifest.observed.project.owner = "foreign-owner";
  await assert.rejects(saveSharedProjectState(wrongObservation, closure, freshExpected), /project|environment/);
  const unrelatedMetadata = structuredClone(promoted);
  unrelatedMetadata.manifest.observed.checkedAt = "2026-10-04T12:00:00Z";
  await assert.rejects(saveSharedProjectState(unrelatedMetadata, closure, freshExpected), /exactly one environment/);
  const otherMutation = structuredClone(promoted);
  otherMutation.manifest.services.find((service: { id: string }) => service.id === "linkwarden").restart = "unless-stopped";
  await assert.rejects(saveSharedProjectState(otherMutation, closure, freshExpected), /non-environment/);
  const promotedReview = await saveSharedProjectState(promoted, closure, freshExpected);
  const promotedAttempt = await saveSharedProjectState(promoted, { ...closure, phase: "attempted" },
    { revision: promotedReview.revision, manifestHash: promotedReview.manifestHash, checkpoint: promotedReview.checkpoint });
  const promotedComplete = await saveSharedProjectState(promoted, { ...closure, phase: "completed" },
    { revision: promotedAttempt.revision, manifestHash: promotedAttempt.manifestHash, checkpoint: promotedAttempt.checkpoint });
  const loadedClosure = await loadSharedProjectState(promoted.projectDirectory, "fresh-closure");
  assert.equal(loadedClosure?.recordHash, promotedComplete.recordHash);
  assert.equal(loadedClosure?.manifest.project.ownership, "verified-existing");
  assert.deepEqual(loadedClosure?.manifest.observed.project, promoted.manifest.observed.project);
  assert.deepEqual(loadedClosure?.selectionFingerprints, freshCompleted.selectionFingerprints);
} finally {
  await rm(temporary, { recursive: true });
}

process.stdout.write("shared-project state checks passed\n");
