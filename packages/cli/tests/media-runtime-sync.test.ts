#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  mediaRuntimeSync,
  runtimeTransitionAllows,
  withMediaRuntimeLock,
  type MediaRuntimePaths,
} from "../src/media-runtime-sync.ts";

type FixtureFile = { path: string; content: string; mode: number };

function sha(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }

async function writeRuntime(root: string, files: FixtureFile[], installed: boolean) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const records = [];
  for (const file of files) {
    const destination = join(root, file.path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await chmod(dirname(destination), 0o700);
    await writeFile(destination, file.content, { mode: file.mode });
    await chmod(destination, file.mode);
    records.push({ path: file.path, sha256: sha(file.content), mode: file.mode });
  }
  const manifest = `${JSON.stringify({ schemaVersion: 1, files: records }, null, 2)}\n`;
  let manifestMode = 0o644;
  if (installed) manifestMode = 0o600;
  await writeFile(join(root, "runtime-manifest.json"), manifest, { mode: manifestMode });
  await chmod(join(root, "runtime-manifest.json"), manifestMode);
  return sha(manifest);
}

async function copyInstalledRuntime(source: string, destination: string, files: FixtureFile[]) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await chmod(destination, 0o700);
  for (const file of files) {
    const target = join(destination, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(join(source, file.path), target);
    await chmod(target, file.mode);
  }
  await copyFile(join(source, "runtime-manifest.json"), join(destination, "runtime-manifest.json"));
  await chmod(join(destination, "runtime-manifest.json"), 0o600);
}

async function fixture(name: string, oldFiles: FixtureFile[], newFiles: FixtureFile[]) {
  const root = await mkdtemp(join(tmpdir(), `selfhost-runtime-sync-${name}-`));
  await chmod(root, 0o700);
  const local = join(root, ".selfhost");
  const harness = join(local, "media-harness");
  const packaged = join(root, "packaged-runtime");
  await mkdir(local, { mode: 0o700 });
  const oldSha256 = await writeRuntime(harness, oldFiles, true);
  const newSha256 = await writeRuntime(packaged, newFiles, false);
  const sessions = join(harness, ".sessions");
  await mkdir(join(sessions, "trial", "artifacts"), { recursive: true, mode: 0o700 });
  await chmod(sessions, 0o700);
  await writeFile(join(sessions, "trial", "artifacts", "private.txt"), "preserve-me\n", { mode: 0o600 });
  return { paths: { root, local, harness } satisfies MediaRuntimePaths, packaged, oldSha256, newSha256 };
}

const oldFiles: FixtureFile[] = [
  { path: "docker-compose.yml", content: "services: {}\n", mode: 0o644 },
  { path: "scripts/session.sh", content: "#!/bin/sh\necho old\n", mode: 0o755 },
  { path: "scripts/removed.sh", content: "#!/bin/sh\nexit 0\n", mode: 0o755 },
];
const newFiles: FixtureFile[] = [
  { path: "docker-compose.yml", content: "services: {}\n", mode: 0o644 },
  { path: "scripts/session.sh", content: "#!/bin/sh\necho new\n", mode: 0o755 },
  { path: "docs/runtime.txt", content: "new runtime\n", mode: 0o644 },
];

const first = await fixture("apply", oldFiles, newFiles);
try {
  await chmod(first.paths.root, 0o770);
  await assert.rejects(
    mediaRuntimeSync("plan", first.paths, first.packaged, null),
    /Project root must not be group- or world-writable/u,
  );
  await chmod(first.paths.root, 0o700);
  const planned = await mediaRuntimeSync("plan", first.paths, first.packaged, null);
  assert.equal(planned.action, "replace-runtime");
  assert.equal(planned.live, false);
  assert.equal(planned.dockerMutation, false);
  assert.equal(planned.sessionsPreserved, true);
  assert.equal(planned.installedSha256, first.oldSha256);
  assert.equal(planned.packagedSha256, first.newSha256);
  assert.deepEqual(planned.files, {
    added: ["docs/runtime.txt"],
    changed: ["scripts/session.sh"],
    removed: ["scripts/removed.sh"],
  });
  assert.match(planned.approvalDigest!, /^sha256:[0-9a-f]{64}$/u);

  await assert.rejects(
    mediaRuntimeSync("apply", first.paths, first.packaged, `sha256:${"0".repeat(64)}`),
    /plan changed/u,
  );
  assert.equal(await readFile(join(first.paths.harness, "scripts/session.sh"), "utf8"), "#!/bin/sh\necho old\n");

  const applied = await mediaRuntimeSync("apply", first.paths, first.packaged, planned.approvalDigest!);
  assert.equal(applied.action, "applied");
  assert.equal(applied.recovered, false);
  assert.equal(await readFile(join(first.paths.harness, "scripts/session.sh"), "utf8"), "#!/bin/sh\necho new\n");
  assert.equal(await readFile(join(first.paths.harness, "docs/runtime.txt"), "utf8"), "new runtime\n");
  await assert.rejects(readFile(join(first.paths.harness, "scripts/removed.sh")), /ENOENT/u);
  assert.equal(await readFile(join(first.paths.harness, ".sessions", "trial", "artifacts", "private.txt"), "utf8"), "preserve-me\n");

  const ledgerPath = join(first.paths.local, "media-runtime-transitions.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  assert.equal((await stat(ledgerPath)).mode & 0o777, 0o600);
  assert.deepEqual(ledger, {
    schemaVersion: 1,
    baseSha256: first.oldSha256,
    transitions: [{ fromSha256: first.oldSha256, toSha256: first.newSha256,
      approvalDigest: planned.approvalDigest }],
  });
  assert.equal(await runtimeTransitionAllows(first.paths.local, first.oldSha256, first.newSha256), true);
  assert.equal(await runtimeTransitionAllows(first.paths.local, "f".repeat(64), first.newSha256), false);
  assert.equal(await readFile(join(first.paths.local, "media-runtime-rollbacks", first.oldSha256,
    "scripts", "session.sh"), "utf8"), "#!/bin/sh\necho old\n");
  await assert.rejects(stat(join(first.paths.local, "media-runtime-rollbacks", first.oldSha256, ".sessions")), /ENOENT/u);

  const current = await mediaRuntimeSync("plan", first.paths, first.packaged, null);
  assert.equal(current.action, "already-current");
  assert.equal(current.approvalDigest, null);

  const thirdPackaged = join(first.paths.root, "third-runtime");
  const thirdFiles = newFiles.map((file) => ({ ...file }));
  thirdFiles[1].content = "#!/bin/sh\necho newest\n";
  const thirdSha256 = await writeRuntime(thirdPackaged, thirdFiles, false);
  const thirdPlan = await mediaRuntimeSync("plan", first.paths, thirdPackaged, null);
  assert.equal(thirdPlan.action, "replace-runtime");
  await mediaRuntimeSync("apply", first.paths, thirdPackaged, thirdPlan.approvalDigest!);
  assert.equal(await runtimeTransitionAllows(first.paths.local, first.oldSha256, thirdSha256), true);
  assert.equal(await runtimeTransitionAllows(first.paths.local, first.newSha256, thirdSha256), true);

  await withMediaRuntimeLock(first.paths.root, async () => {
    await assert.rejects(withMediaRuntimeLock(first.paths.root, async () => undefined), /will not reclaim/u);
  });

  const lockPath = join(first.paths.root, ".selfhost-media-runtime.lock");
  await writeFile(lockPath, `${JSON.stringify({ schemaVersion: 1, pid: 2147483647 })}\n`, { mode: 0o600 });
  await chmod(lockPath, 0o600);
  await assert.rejects(withMediaRuntimeLock(first.paths.root, async () => undefined), /will not reclaim/u);
  assert.equal((await stat(lockPath)).isFile(), true);
  const candidatePath = `${lockPath}.candidate-2147483647-test`;
  await link(lockPath, candidatePath);
  await assert.rejects(withMediaRuntimeLock(first.paths.root, async () => undefined), /acquisition is active or was interrupted/u);
  assert.equal((await stat(lockPath)).ino, (await stat(candidatePath)).ino);
  await rm(candidatePath);
  await rm(lockPath);
} finally {
  await rm(first.paths.root, { recursive: true });
}

const interrupted = await fixture("interrupted", oldFiles, newFiles);
try {
  const planned = await mediaRuntimeSync("plan", interrupted.paths, interrupted.packaged, null);
  assert.equal(planned.action, "replace-runtime");
  const rollback = join(interrupted.paths.local, "media-runtime-rollbacks", interrupted.oldSha256);
  const staging = join(interrupted.paths.local, "media-runtime-staging", interrupted.newSha256);
  await mkdir(dirname(rollback), { recursive: true, mode: 0o700 });
  await chmod(dirname(rollback), 0o700);
  await mkdir(dirname(staging), { recursive: true, mode: 0o700 });
  await chmod(dirname(staging), 0o700);
  await copyInstalledRuntime(interrupted.paths.harness, rollback, oldFiles);
  await copyInstalledRuntime(interrupted.packaged, staging, newFiles);
  await writeFile(join(interrupted.paths.local, "media-runtime-sync.json"), `${JSON.stringify({
    schemaVersion: 1,
    fromSha256: interrupted.oldSha256,
    toSha256: interrupted.newSha256,
    approvalDigest: planned.approvalDigest,
    phase: "installing",
  }, null, 2)}\n`, { mode: 0o600 });
  await chmod(join(interrupted.paths.local, "media-runtime-sync.json"), 0o600);
  await copyFile(join(staging, "scripts/session.sh"), join(interrupted.paths.harness, "scripts/session.sh"));
  await chmod(join(interrupted.paths.harness, "scripts/session.sh"), 0o755);

  const resumed = await mediaRuntimeSync("apply", interrupted.paths, interrupted.packaged, planned.approvalDigest!);
  assert.equal(resumed.action, "applied");
  assert.equal(resumed.recovered, true);
  assert.equal(await readFile(join(interrupted.paths.harness, "scripts/session.sh"), "utf8"), "#!/bin/sh\necho new\n");
  assert.equal(await readFile(join(interrupted.paths.harness, ".sessions", "trial", "artifacts", "private.txt"), "utf8"), "preserve-me\n");
  await assert.rejects(stat(join(interrupted.paths.local, "media-runtime-sync.json")), /ENOENT/u);
  assert.equal(await runtimeTransitionAllows(interrupted.paths.local, interrupted.oldSha256, interrupted.newSha256), true);
} finally {
  await rm(interrupted.paths.root, { recursive: true });
}

const unsafeLocalRoot = await mkdtemp(join(tmpdir(), "selfhost-runtime-sync-symlink-local-"));
const unsafeLocalTarget = await mkdtemp(join(tmpdir(), "selfhost-runtime-sync-local-target-"));
try {
  await chmod(unsafeLocalRoot, 0o700);
  await chmod(unsafeLocalTarget, 0o700);
  const harness = join(unsafeLocalTarget, "media-harness");
  const packaged = join(unsafeLocalRoot, "packaged-runtime");
  await writeRuntime(harness, oldFiles, true);
  await writeRuntime(packaged, newFiles, false);
  await symlink(unsafeLocalTarget, join(unsafeLocalRoot, ".selfhost"), "dir");
  const paths = {
    root: unsafeLocalRoot,
    local: join(unsafeLocalRoot, ".selfhost"),
    harness: join(unsafeLocalRoot, ".selfhost", "media-harness"),
  } satisfies MediaRuntimePaths;
  await assert.rejects(mediaRuntimeSync("plan", paths, packaged, null), /.selfhost must be a real current-owner directory/u);
  await assert.rejects(mediaRuntimeSync("apply", paths, packaged, `sha256:${"a".repeat(64)}`),
    /.selfhost must be a real current-owner directory/u);
  await assert.rejects(stat(join(unsafeLocalTarget, "media-runtime-transitions.json")), /ENOENT/u);
} finally {
  await rm(unsafeLocalRoot, { recursive: true });
  await rm(unsafeLocalTarget, { recursive: true });
}

const unsafeHarnessRoot = await mkdtemp(join(tmpdir(), "selfhost-runtime-sync-symlink-harness-"));
const unsafeHarnessTarget = await mkdtemp(join(tmpdir(), "selfhost-runtime-sync-harness-target-"));
try {
  await chmod(unsafeHarnessRoot, 0o700);
  await chmod(unsafeHarnessTarget, 0o700);
  const local = join(unsafeHarnessRoot, ".selfhost");
  const packaged = join(unsafeHarnessRoot, "packaged-runtime");
  await mkdir(local, { mode: 0o700 });
  await writeRuntime(unsafeHarnessTarget, oldFiles, true);
  await writeRuntime(packaged, newFiles, false);
  await symlink(unsafeHarnessTarget, join(local, "media-harness"), "dir");
  const paths = {
    root: unsafeHarnessRoot,
    local,
    harness: join(local, "media-harness"),
  } satisfies MediaRuntimePaths;
  await assert.rejects(mediaRuntimeSync("plan", paths, packaged, null), /Installed media runtime must be a real current-owner directory/u);
  await chmod(local, 0o755);
  await assert.rejects(mediaRuntimeSync("plan", paths, packaged, null), /.selfhost must use mode 0700/u);
} finally {
  await rm(unsafeHarnessRoot, { recursive: true });
  await rm(unsafeHarnessTarget, { recursive: true });
}

console.log("PASS media runtime sync exact approval, canonical paths, fail-closed lock, preserved sessions, transition authorization, and interrupted recovery");
