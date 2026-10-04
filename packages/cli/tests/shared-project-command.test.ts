import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedHostRequest, sharedProjectCommand, sharedPlanApproval,
  sharedSetupApproval } from "../src/shared-project.ts";
import { prepareSharedProjectFiles, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { appCommand } from "../src/app.ts";
import { withSharedProjectMutationLock } from "../src/lib/batch-mutation-lock.ts";
import { sharedUnitHandoff, sharedUnitStatus } from "../src/lib/shared-unit-setup.ts";

const imageTag = "docker.io/library/busybox:1.37.0";
function selection(appId: string, port: number) {
  return {
    appId, port, images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}` },
    recipe: { schemaVersion: 2, kind: "multi-service-compose", appId,
      services: [{ id: appId, imageTag, user: "image-default",
        imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [],
        fileEnvironment: [], mounts: [{ kind: "volume", name: "state", target: "/state" }],
        dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [], defaults: { hostIp: "127.0.0.1", publishedPort: port },
      storage: { minimumFreeBytes: 2_000_000 } },
  };
}

const temporary = await mkdtemp(join(tmpdir(), "selfhost-shared-command-"));
try {
  const selections = [selection("alpha", 18080), selection("beta", 18081)];
  const host = sharedHostRequest(temporary, "shared-test", selections);
  assert.deepEqual(host.tcpPorts, [18080, 18081]);
  assert.deepEqual(host.volumeNames, ["shared-test-alpha-state", "shared-test-beta-state"]);
  assert.equal(host.minimumFreeBytes, 5_048_576);
  assert.equal(host.mediaPath, null);
  assert.equal(sharedHostRequest(temporary, "shared-test", selections, true).preparedMediaPath, false);
  const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId: "shared-test",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: selections, observed: { checkedAt: "2026-09-29T12:00:00Z",
      ports: [], paths: [], networks: [], volumes: [] } });
  const changedTime = structuredClone(candidate);
  changedTime.manifest.observed.checkedAt = "2026-09-29T12:05:00Z";
  assert.equal(sharedPlanApproval(candidate), sharedPlanApproval(changedTime));
  const changedImage = structuredClone(candidate);
  changedImage.manifest.services[0].image = `${imageTag}@sha256:${"b".repeat(64)}`;
  assert.notEqual(sharedPlanApproval(candidate), sharedPlanApproval(changedImage));
  assert.throws(() => sharedHostRequest(temporary, "shared-test",
    [selection("alpha", 18080), selection("beta", 18080)]), /distinct host ports/);

  const logs: string[] = [];
  const original = console.log;
  console.log = (line: string) => { logs.push(line); };
  try {
    await sharedProjectCommand(["status", "--project-root", temporary,
      "--project-id", "shared-test", "--json"], {
      recipeFor() { throw new Error("status must not read catalog recipes"); },
      async resolveImage() { throw new Error("status must not contact a registry"); },
    });
  } finally { console.log = original; }
  assert.equal(JSON.parse(logs[0]!).status, "not-created");
  const noRestoreDependencies = {
    recipeFor() { throw new Error("An absent reinstall owner must not read recipes"); },
    async resolveImage() { throw new Error("Reinstall must not resolve new images"); },
  };
  await assert.rejects(sharedProjectCommand(["reinstall", "--project-root", temporary,
    "--project-id", "shared-test", "--app", "alpha", "--json"], noRestoreDependencies), /Shared reinstall:/);
  await assert.rejects(appCommand(["shared", "reinstall", "--project-root", temporary,
    "--project-id", "shared-test", "--app", "alpha", "--json"]), /Shared reinstall:/);
  await assert.rejects(sharedProjectCommand(["reinstall", "--project-root", temporary,
    "--project-id", "shared-test", "--app", "alpha", "--port", "alpha=18080"], noRestoreDependencies), /without port/);
  await assert.rejects(sharedProjectCommand(["reinstall", "--project-root", temporary,
    "--project-id", "shared-test", "--app", "alpha", "--app", "beta"], noRestoreDependencies), /one exact removed app/);
  await withSharedProjectMutationLock(temporary, "lock-one", [18080], async () => {
    await assert.rejects(withSharedProjectMutationLock(temporary, "lock-one", [18081],
      async () => {}), /mutation lock already exists/);
    await assert.rejects(withSharedProjectMutationLock(temporary, "lock-two", [18080],
      async () => {}), /App port 18080 mutation lock already exists/);
  });

  const realSelection = async (appId: string) => {
    const path = new URL(`../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${appId}/recipe.json`, import.meta.url);
    const recipe = JSON.parse(await readFile(path, "utf8"));
    const images = Object.fromEntries(recipe.services.map((service: { id: string; imageTag: string }) =>
      [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`]));
    return { appId, recipe, images, port: recipe.defaults.publishedPort };
  };
  const actualSelections = await Promise.all([realSelection("homarr"), realSelection("immich")]);
  const actualHost = sharedHostRequest(temporary, "real-recipe-check", actualSelections);
  const actualCandidate = sharedProjectCandidate({ projectRoot: temporary,
    projectId: "real-recipe-check", dockerContext: "default", uid: 1000, gid: 1000,
    timezone: "Etc/UTC", apps: actualSelections, observed: {
      checkedAt: "2026-09-29T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  assert.deepEqual(actualHost.tcpPorts, [7575, 2283]);
  assert.equal(actualCandidate.units.immich.length, 4);
  assert.equal(actualCandidate.units.homarr.length, 1);
  const actualPlan = await createSelfhostComposeOwner(actualCandidate.manifest).plan();
  assert.equal(actualPlan.status, "pass");

  const mediaIds = ["sonarr", "radarr", "qbittorrent", "sabnzbd", "jellyfin"];
  const mediaPath = join(temporary, ".selfhost", "shared", "media-recipe-check", "data", "shared");
  const mediaSelections = (await Promise.all(mediaIds.map(realSelection))).map((item) => ({
    ...item, port: item.appId === "sabnzbd" ? 18081 : item.port,
    hostPaths: { [item.appId === "jellyfin" ? "media-library" : "media-data"]: mediaPath },
  }));
  const mediaHost = sharedHostRequest(temporary, "media-recipe-check", mediaSelections);
  assert.equal(mediaHost.mediaPath, mediaPath);
  assert.equal(sharedHostRequest(temporary, "media-recipe-check", mediaSelections, true).preparedMediaPath, true);
  const redirectedMedia = structuredClone(mediaSelections);
  redirectedMedia[0]!.hostPaths["media-data"] = join(temporary, "elsewhere");
  assert.throws(() => sharedHostRequest(temporary, "media-recipe-check", redirectedMedia),
    /exact shared media path/);
  const mediaCandidate = sharedProjectCandidate({ projectRoot: temporary,
    projectId: "media-recipe-check", dockerContext: "default", uid: 1000, gid: 1000,
    timezone: "Etc/UTC", apps: mediaSelections, observed: {
      checkedAt: "2026-09-29T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  const mediaPlan = await createSelfhostComposeOwner(mediaCandidate.manifest).plan();
  assert.equal(mediaPlan.status, "pass");
  const sharedMounts = mediaCandidate.manifest.services.flatMap((service: { mounts: Array<{
    source: string; target: string; shared: boolean; owner: string }> }) =>
    service.mounts.filter((mount) => mount.source === mediaPath));
  assert.equal(sharedMounts.length, mediaIds.length);
  assert.ok(sharedMounts.every((mount) => mount.target === "/data"));
  assert.ok(sharedMounts.every((mount) => mount.shared && mount.owner === "media-recipe-check"));
  await mkdir(join(temporary, ".selfhost"), { mode: 0o700 });
  await mkdir(join(temporary, ".selfhost", "shared"), { mode: 0o700 });
  await mkdir(mediaCandidate.projectDirectory, { mode: 0o700 });
  await createSelfhostComposeOwner(mediaCandidate.manifest).render(mediaPlan);
  await prepareSharedProjectFiles(mediaCandidate, mediaSelections);
  assert.equal((await lstat(mediaPath)).mode & 0o777, 0o700);
  for (const relative of ["media/movies", "media/tv", "torrents/incomplete",
    "torrents/tv-sonarr", "torrents/movies-radarr", "usenet/complete"]) {
    assert.equal((await lstat(join(mediaPath, relative))).mode & 0o777, 0o700);
  }
  const reviewed = { operation: "create" as const, phase: "reviewed" as const,
    appIds: [...mediaIds].sort() };
  const first = await saveSharedProjectState(mediaCandidate, reviewed,
    { revision: 0, manifestHash: null, checkpoint: null });
  const statusArgs = ["status", "--project-root", temporary,
    "--project-id", "media-recipe-check", "--json"];
  const statusDependencies = {
    recipeFor(appId: string) {
      const selected = mediaSelections.find((item) => item.appId === appId);
      assert.ok(selected);
      return { recipe: selected.recipe, defaults: selected.recipe.defaults,
        storage: selected.recipe.storage, boundedApply: true, recipeSha256: "a".repeat(64) };
    },
    async resolveImage() { throw new Error("status must not resolve images"); },
  };
  logs.length = 0;
  console.log = (line: string) => { logs.push(line); };
  try { await sharedProjectCommand(statusArgs, statusDependencies); }
  finally { console.log = original; }
  assert.equal(JSON.parse(logs[0]!).resumeApproval, null);
  assert.match(JSON.parse(logs[0]!).recovery, /inspect before retrying/);
  const prepared = await saveSharedProjectState(mediaCandidate,
    { ...reviewed, phase: "prepared" },
    { revision: first.revision, manifestHash: first.manifestHash, checkpoint: reviewed });
  logs.length = 0;
  console.log = (line: string) => { logs.push(line); };
  try { await sharedProjectCommand(statusArgs, statusDependencies); }
  finally { console.log = original; }
  assert.equal(JSON.parse(logs[0]!).status, "prepared");
  assert.equal(JSON.parse(logs[0]!).resumeApproval, sharedPlanApproval(mediaCandidate));
  assert.equal(JSON.parse(logs[0]!).recovery, null);
  assert.equal(prepared.checkpoint.phase, "prepared");
  await assert.rejects(sharedProjectCommand(["setup", "--project-root", temporary,
    "--project-id", "media-recipe-check", "--app", "sonarr", "--json"], {
    recipeFor() { throw new Error("pre-apply setup must not read recipes"); },
    async resolveImage() { throw new Error("pre-apply setup must not resolve images"); },
  }), /completed shared project/);
  await createSelfhostComposeOwner(mediaCandidate.manifest).checkRendered(mediaPlan);
  const attempted = await saveSharedProjectState(mediaCandidate,
    { ...reviewed, phase: "attempted" },
    { revision: prepared.revision, manifestHash: prepared.manifestHash,
      checkpoint: prepared.checkpoint });
  const completedState = await saveSharedProjectState(mediaCandidate, { ...reviewed, phase: "completed" },
    { revision: attempted.revision, manifestHash: attempted.manifestHash,
      checkpoint: attempted.checkpoint });
  const recipeForUnit = (appId: string) => {
    const selected = mediaSelections.find((item) => item.appId === appId);
    assert.ok(selected);
    return { recipe: selected.recipe, boundedApply: false };
  };
  const approvalForUnit = () => sharedPlanApproval(mediaCandidate);
  const sonarrStatus = await sharedUnitStatus(temporary, "media-recipe-check", "sonarr",
    recipeForUnit, approvalForUnit, false);
  assert.equal(sonarrStatus.ownerKind, "shared");
  assert.equal(sonarrStatus.projectId, "media-recipe-check");
  assert.equal(sonarrStatus.privateFiles,
    join(mediaCandidate.projectDirectory, "secrets", "sonarr"));
  assert.equal(sonarrStatus.passwordFile,
    join(mediaCandidate.projectDirectory, "secrets", "sonarr", "admin-password"));
  assert.equal(sonarrStatus.runtime, null);
  const sonarrHandoff = await sharedUnitHandoff(temporary, "media-recipe-check", "sonarr",
    recipeForUnit, approvalForUnit);
  assert.equal(sonarrHandoff.passwordFile, sonarrStatus.passwordFile);
  assert.equal(sonarrHandoff.apiKeyFile, null);
  await assert.rejects(sharedUnitStatus(temporary, "media-recipe-check", "sonarr",
    (appId) => ({ recipe: { ...recipeForUnit(appId).recipe, source: "https://changed.example.test" },
      boundedApply: false }), approvalForUnit, false), /differs from its exact saved selection/);
  logs.length = 0;
  console.log = (line: string) => { logs.push(line); };
  try {
    await sharedProjectCommand(["setup", "--project-root", temporary,
      "--project-id", "media-recipe-check", "--app", "sonarr", "--app", "radarr", "--json"], {
      recipeFor: recipeForUnit,
      async resolveImage() { throw new Error("setup review must not resolve images"); },
    });
  } finally { console.log = original; }
  const setupReview = JSON.parse(logs[0]!);
  assert.equal(setupReview.status, "review");
  assert.deepEqual(setupReview.setup.direct, ["radarr", "sonarr"]);
  assert.match(setupReview.approval, /^SHARED-SETUP:media-recipe-check:[0-9a-f]{64}$/);
  logs.length = 0;
  console.log = (line: string) => { logs.push(line); };
  try {
    await sharedProjectCommand(["setup", "--project-root", temporary,
      "--project-id", "media-recipe-check", "--app", "jellyfin",
      "--input", "jellyfin.movies-path=/data/media/movies",
      "--input", "jellyfin.shows-path=/data/media/tv", "--json"], {
      recipeFor: recipeForUnit,
      async resolveImage() { throw new Error("setup review must not resolve images"); },
    });
  } finally { console.log = original; }
  const libraryReview = JSON.parse(logs[0]!);
  assert.deepEqual(libraryReview.inputs.jellyfin, {
    "movies-path": "/data/media/movies", "shows-path": "/data/media/tv",
  });
  assert.notEqual(libraryReview.approval, sharedSetupApproval(completedState, ["jellyfin"]));
  await assert.rejects(sharedProjectCommand(["setup", "--project-root", temporary,
    "--project-id", "media-recipe-check", "--app", "jellyfin",
    "--input", "jellyfin.api-key=forbidden", "--json"], {
    recipeFor: recipeForUnit,
    async resolveImage() { throw new Error("invalid setup must not resolve images"); },
  }), /non-secret/);
  logs.length = 0;
  console.log = (line: string) => { logs.push(line); };
  try {
    await sharedProjectCommand(["handoff", "--project-root", temporary,
      "--project-id", "media-recipe-check", "--app", "sonarr", "--json"], {
      recipeFor: recipeForUnit,
      async resolveImage() { throw new Error("handoff must not resolve images"); },
    });
  } finally { console.log = original; }
  const publicHandoff = JSON.parse(logs[0]!);
  assert.equal(publicHandoff.command, "app shared handoff");
  assert.equal(publicHandoff.secretful, false);
  assert.equal(publicHandoff.passwordFile, sonarrStatus.passwordFile);
  assert.ok(!Object.hasOwn(publicHandoff, "password"));
  logs.length = 0;
  console.log = (line: string) => { logs.push(line); };
  try {
    await appCommand(["shared", "handoff", "--project-root", temporary,
      "--project-id", "media-recipe-check", "--app", "sonarr", "--json"]);
  } finally { console.log = original; }
  assert.equal(JSON.parse(logs[0]!).passwordFile, sonarrStatus.passwordFile);
  logs.length = 0;
  console.log = (line: string) => { logs.push(line); };
  try {
    await appCommand(["shared", "status", "--project-root", temporary,
      "--project-id", "shared-test", "--json"]);
  } finally { console.log = original; }
  assert.equal(JSON.parse(logs[0]!).status, "not-created");
} finally {
  await rm(temporary, { recursive: true });
}

console.log("shared project command: pass");
