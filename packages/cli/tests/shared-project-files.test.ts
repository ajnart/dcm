import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, rm, rmdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extendSharedProject, prepareSharedProjectFiles, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";

function selection(appId: string, port: number) {
  const imageTag = "docker.io/library/busybox:1.37.0";
  return {
    appId, port, images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}` },
    recipe: {
      schemaVersion: 2, kind: "multi-service-compose", appId,
      services: [{ id: appId, imageTag, user: "host-selected",
        imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped",
        readOnly: false, environment: [], hostEnvironment: [],
        fileEnvironment: [{ name: "APP_KEY_FILE", fileId: "app-key" }],
        mounts: [{ name: "state", target: "/state" }], dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [{ id: "app-key", bytes: 48 }],
      defaults: { hostIp: "127.0.0.1" },
    },
  };
}

const temporary = await mkdtemp(join(tmpdir(), "selfhost-shared-files-"));
try {
  const sharedRoot = join(temporary, ".selfhost", "shared");
  await mkdir(sharedRoot, { recursive: true, mode: 0o700 });
  const selections = [selection("alpha", 18080), selection("beta", 18081)];
  const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId: "shared-test",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: selections, observed: { checkedAt: "2026-09-29T12:00:00Z",
      ports: [], paths: [], networks: [] } });
  const projectDirectory = candidate.projectDirectory;
  assert.deepEqual(candidate.manifest.services.map((service: { user: string }) => service.user),
    ["1000:1000", "1000:1000"]);
  const mismatched = structuredClone(selections);
  mismatched[0].recipe.privateFiles[0].bytes = 64;
  await assert.rejects(prepareSharedProjectFiles(candidate, mismatched), /selections differ/);
  await assert.rejects(lstat(projectDirectory), { code: "ENOENT" });
  const changedCandidate = structuredClone(candidate);
  changedCandidate.manifest.services[0].secretRefs[0].filePath = join(projectDirectory, "secrets", "wrong");
  await assert.rejects(prepareSharedProjectFiles(changedCandidate, selections), /service differs/);
  await assert.rejects(lstat(projectDirectory), { code: "ENOENT" });

  await prepareSharedProjectFiles(candidate, selections);
  const alphaFile = join(projectDirectory, "secrets", "alpha", "app-key");
  const betaFile = join(projectDirectory, "secrets", "beta", "app-key");
  const alphaStat = await lstat(alphaFile);
  const betaStat = await lstat(betaFile);
  assert.equal(alphaStat.mode & 0o777, 0o600);
  assert.equal(betaStat.mode & 0o777, 0o600);
  assert.notEqual(alphaStat.ino, betaStat.ino);
  assert.equal((await lstat(join(projectDirectory, "data", "alpha", "state"))).mode & 0o777, 0o700);
  assert.equal((await lstat(join(projectDirectory, "data", "beta", "state"))).mode & 0o777, 0o700);
  await assert.rejects(lstat(join(projectDirectory, "secrets", "app-key")), { code: "ENOENT" });
  await prepareSharedProjectFiles(candidate, selections);
  assert.equal((await lstat(alphaFile)).ino, alphaStat.ino);

  await chmod(betaFile, 0o644);
  await assert.rejects(prepareSharedProjectFiles(candidate, selections), /mode-0600/);
  await chmod(betaFile, 0o600);
  const betaData = join(projectDirectory, "data", "beta", "state");
  await rmdir(betaData);
  await symlink(join(projectDirectory, "data", "alpha", "state"), betaData);
  await assert.rejects(prepareSharedProjectFiles(candidate, selections), /mode-0700 real directories/);

  const addProjectId = "shared-add";
  const initial = sharedProjectCandidate({ projectRoot: temporary, projectId: addProjectId,
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: [selections[0]], observed: { checkedAt: "2026-09-29T12:00:00Z",
      ports: [], paths: [], networks: [] } });
  await prepareSharedProjectFiles(initial, [selections[0]]);
  const observation = { checkedAt: "2026-09-29T12:01:00Z",
    project: { id: addProjectId, directory: initial.projectDirectory, owner: addProjectId },
    ports: [{ hostIp: "127.0.0.1", published: 18080, protocol: "tcp", owner: addProjectId }],
    paths: [{ path: join(initial.projectDirectory, "data", "alpha", "state"), owner: addProjectId }],
    networks: ["front", "alpha-private"].map((id) => ({ name: `${addProjectId}-${id}`, owner: addProjectId })),
  };
  const extended = extendSharedProject(initial, [selections[1]],
    { projectRoot: temporary, projectId: addProjectId, dockerContext: "default",
      uid: 1000, gid: 1000, timezone: "Etc/UTC" }, observation);
  await prepareSharedProjectFiles(extended, [selections[1]]);
  assert.equal((await lstat(join(initial.projectDirectory, "secrets", "beta", "app-key"))).mode & 0o777, 0o600);
  assert.equal((await lstat(join(initial.projectDirectory, "data", "beta", "state"))).mode & 0o777, 0o700);
} finally {
  await rm(temporary, { recursive: true });
}

process.stdout.write("shared-project file preparation checks passed\n");
