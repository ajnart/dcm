#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve, sep } from "node:path";
import {
  BUNDLE_MANIFEST_NAME,
  DEFAULT_BUNDLE_ROOT,
  loadAndVerifyBundle,
  sha256File,
} from "./verify-bundle.mjs";

const RUNTIME_PARENT = ".selfhost";
const RUNTIME_NAME = "media-harness";
const PRIVATE_DIRECTORY_MODE = 0o700;
const INSTALLED_MANIFEST_MODE = 0o600;
const TEMP_FILE_PATTERN = /^\.[a-zA-Z0-9._-]+\.selfhost-media-tmp-[0-9]+-[0-9a-f]{24}$/;
const EXECUTABLES = new Map([
  ["session", "scripts/session.sh"],
  ["render-prompt", "scripts/render-prompt.sh"],
]);

function fail(message) {
  throw new Error(message);
}

function isMissing(error) {
  return error && error.code === "ENOENT";
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("media runtime requires POSIX ownership checks");
  }
  return process.getuid();
}

function modeString(stat) {
  return (stat.mode & 0o777).toString(8).padStart(4, "0");
}

function directoriesForManifest(manifest) {
  const directories = new Set();
  for (const file of manifest.files) {
    let parent = posix.dirname(file.path);
    while (parent !== ".") {
      directories.add(parent);
      parent = posix.dirname(parent);
    }
  }
  return directories;
}

async function assertProjectRoot(projectArgument) {
  const requested = resolve(projectArgument);
  const stat = await lstat(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("project must be a real directory");
  }
  const resolved = await realpath(requested);
  if (resolved !== requested) {
    fail("project path must not cross a symlink");
  }
  if (resolved === sep) {
    fail("project cannot be the filesystem root");
  }

  let safeHome = "";
  try {
    safeHome = await realpath(homedir());
  } catch {
    safeHome = "";
  }
  if (safeHome && resolved === safeHome) {
    fail("project cannot be the user home directory");
  }
  if (stat.uid !== currentUid()) {
    fail("project has the wrong owner");
  }
  if ((stat.mode & 0o002) !== 0) {
    fail("project must not be world-writable");
  }
  return resolved;
}

async function inspectPrivateDirectory(directoryPath, label) {
  const stat = await lstat(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be a real directory`);
  }
  if (stat.uid !== currentUid()) {
    fail(`${label} has the wrong owner`);
  }
  if (modeString(stat) !== "0700") {
    fail(`${label} must use mode 0700`);
  }
  const resolved = await realpath(directoryPath);
  if (resolved !== directoryPath) {
    fail(`${label} must not cross a symlink`);
  }
}

async function ensurePrivateDirectory(directoryPath, label, create) {
  try {
    await inspectPrivateDirectory(directoryPath, label);
    return;
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  if (!create) {
    fail(`${label} does not exist`);
  }
  let created = false;
  try {
    await mkdir(directoryPath, { mode: PRIVATE_DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (!error || error.code !== "EEXIST") {
      throw error;
    }
  }
  if (!created) {
    await inspectPrivateDirectory(directoryPath, label);
    return;
  }
  await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
  await inspectPrivateDirectory(directoryPath, label);
}

async function prepareRuntime(projectArgument, create) {
  const projectRoot = await assertProjectRoot(projectArgument);
  const runtimeParent = join(projectRoot, RUNTIME_PARENT);
  const runtimeRoot = join(runtimeParent, RUNTIME_NAME);
  await ensurePrivateDirectory(runtimeParent, "runtime parent", create);
  await ensurePrivateDirectory(runtimeRoot, "media runtime", create);
  return runtimeRoot;
}

function runtimeExpectedSets(manifest) {
  const files = new Set(manifest.files.map((file) => file.path));
  files.add(BUNDLE_MANIFEST_NAME);
  return {
    directories: directoriesForManifest(manifest),
    files,
  };
}

async function removeStaleTemp(fullPath, stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail("media runtime contains an unsafe stale copy file");
  }
  if (stat.uid !== currentUid()) {
    fail("media runtime stale copy file has the wrong owner");
  }
  await unlink(fullPath);
}

async function inspectRuntimeContents(runtimeRoot, manifest, options = {}) {
  const expected = runtimeExpectedSets(manifest);
  let cleanupTemps = false;
  if (options.cleanupTemps) {
    cleanupTemps = true;
  }

  async function walk(relativeDirectory) {
    const directoryPath = relativeDirectory
      ? join(runtimeRoot, ...relativeDirectory.split("/"))
      : runtimeRoot;
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!relativeDirectory && entry.name === ".sessions") {
        continue;
      }

      let relativePath = entry.name;
      if (relativeDirectory) {
        relativePath = `${relativeDirectory}/${entry.name}`;
      }
      const fullPath = join(runtimeRoot, ...relativePath.split("/"));
      const stat = await lstat(fullPath);

      if (TEMP_FILE_PATTERN.test(entry.name)) {
        if (!cleanupTemps) {
          fail("media runtime contains an incomplete copy file");
        }
        await removeStaleTemp(fullPath, stat);
        continue;
      }
      if (stat.isSymbolicLink()) {
        fail("media runtime contains a symbolic link");
      }
      if (stat.isDirectory()) {
        if (!expected.directories.has(relativePath)) {
          fail("media runtime contains an unexpected directory");
        }
        if (stat.uid !== currentUid() || modeString(stat) !== "0700") {
          fail(`media runtime directory is unsafe: ${relativePath}`);
        }
        await walk(relativePath);
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1) {
        fail("media runtime contains an unsafe filesystem entry");
      }
      if (!expected.files.has(relativePath)) {
        fail("media runtime contains an unexpected file");
      }
      if (stat.uid !== currentUid()) {
        fail(`media runtime file has the wrong owner: ${relativePath}`);
      }
    }
  }

  await walk("");
}

async function ensurePayloadDirectories(runtimeRoot, manifest) {
  const directories = [...directoriesForManifest(manifest)].sort((left, right) => {
    const depthDifference = left.split("/").length - right.split("/").length;
    if (depthDifference !== 0) {
      return depthDifference;
    }
    return left.localeCompare(right);
  });

  for (const relativePath of directories) {
    const fullPath = join(runtimeRoot, ...relativePath.split("/"));
    let created = false;
    try {
      await mkdir(fullPath, { mode: PRIVATE_DIRECTORY_MODE });
      created = true;
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw error;
      }
    }
    if (created) {
      await chmod(fullPath, PRIVATE_DIRECTORY_MODE);
    }
    await inspectPrivateDirectory(fullPath, `media runtime directory ${relativePath}`);
  }
}

async function atomicCopy(sourcePath, destinationPath, mode) {
  const nativeParent = dirname(destinationPath);
  const temporaryName = `.${basename(destinationPath)}.selfhost-media-tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  const temporaryPath = join(nativeParent, temporaryName);
  let handle;

  try {
    const content = await readFile(sourcePath);
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function fileNeedsCopy(destinationPath, expectedMode, expectedHash) {
  let stat;
  try {
    stat = await lstat(destinationPath);
  } catch (error) {
    if (isMissing(error)) {
      return true;
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail("media runtime destination file is unsafe");
  }
  if (modeString(stat) !== expectedMode) {
    return true;
  }
  return (await sha256File(destinationPath)) !== expectedHash;
}

async function copyBundle(runtimeRoot, bundle) {
  await inspectRuntimeContents(runtimeRoot, bundle.manifest, { cleanupTemps: true });
  await ensurePayloadDirectories(runtimeRoot, bundle.manifest);

  for (const file of bundle.manifest.files) {
    const sourcePath = join(bundle.bundleRoot, ...file.path.split("/"));
    const destinationPath = join(runtimeRoot, ...file.path.split("/"));
    if (await fileNeedsCopy(destinationPath, file.mode, file.sha256)) {
      await atomicCopy(sourcePath, destinationPath, Number.parseInt(file.mode, 8));
    }
  }

  const sourceManifest = join(bundle.bundleRoot, BUNDLE_MANIFEST_NAME);
  const destinationManifest = join(runtimeRoot, BUNDLE_MANIFEST_NAME);
  const manifestHash = await sha256File(sourceManifest);
  if (await fileNeedsCopy(destinationManifest, "0600", manifestHash)) {
    await atomicCopy(sourceManifest, destinationManifest, INSTALLED_MANIFEST_MODE);
  }
}

async function verifyRuntime(runtimeRoot, bundle) {
  await inspectRuntimeContents(runtimeRoot, bundle.manifest);
  await inspectPrivateDirectory(runtimeRoot, "media runtime");

  for (const file of bundle.manifest.files) {
    const destinationPath = join(runtimeRoot, ...file.path.split("/"));
    let stat;
    try {
      stat = await lstat(destinationPath);
    } catch (error) {
      if (isMissing(error)) {
        fail(`media runtime is missing ${file.path}`);
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      fail(`media runtime file is unsafe: ${file.path}`);
    }
    if (stat.uid !== currentUid()) {
      fail(`media runtime file has the wrong owner: ${file.path}`);
    }
    if (modeString(stat) !== file.mode) {
      fail(`media runtime mode mismatch for ${file.path}`);
    }
    if ((await sha256File(destinationPath)) !== file.sha256) {
      fail(`media runtime hash mismatch for ${file.path}`);
    }
  }

  const installedManifest = join(runtimeRoot, BUNDLE_MANIFEST_NAME);
  const packagedManifest = join(bundle.bundleRoot, BUNDLE_MANIFEST_NAME);
  let manifestStat;
  try {
    manifestStat = await lstat(installedManifest);
  } catch (error) {
    if (isMissing(error)) {
      fail("media runtime is missing its bundle manifest");
    }
    throw error;
  }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.nlink !== 1) {
    fail("installed bundle manifest is unsafe");
  }
  if (manifestStat.uid !== currentUid() || modeString(manifestStat) !== "0600") {
    fail("installed bundle manifest owner or mode is unsafe");
  }
  if ((await sha256File(installedManifest)) !== (await sha256File(packagedManifest))) {
    fail("installed bundle manifest does not match the packaged manifest");
  }
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/media-runtime.mjs init [--project PATH]
  node scripts/media-runtime.mjs sync [--project PATH]
  node scripts/media-runtime.mjs verify [--project PATH]
  node scripts/media-runtime.mjs exec [--project PATH] -- session ARGS...
  node scripts/media-runtime.mjs exec [--project PATH] -- render-prompt ARGS...
`);
}

function parseOptions(command, argv) {
  let project = process.cwd();
  let forwarded = [];
  let optionArguments = argv;

  if (command === "exec") {
    const separatorIndex = argv.indexOf("--");
    if (separatorIndex < 0) {
      fail("exec requires -- before the harness command");
    }
    optionArguments = argv.slice(0, separatorIndex);
    forwarded = argv.slice(separatorIndex + 1);
    if (forwarded.length === 0) {
      fail("exec requires a harness command");
    }
  } else if (argv.includes("--")) {
    fail("-- is only valid with exec");
  }

  for (let index = 0; index < optionArguments.length; index += 1) {
    const argument = optionArguments[index];
    if (argument === "--project") {
      const value = optionArguments[index + 1];
      if (!value) {
        fail("--project requires a path");
      }
      project = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--project=")) {
      project = argument.slice("--project=".length);
      if (!project) {
        fail("--project requires a path");
      }
      continue;
    }
    fail("unknown media runtime option");
  }
  return { forwarded, project };
}

async function executeHarness(runtimeRoot, forwarded) {
  const commandName = forwarded[0];
  const relativeExecutable = EXECUTABLES.get(commandName);
  if (!relativeExecutable) {
    fail("exec supports only session and render-prompt");
  }
  const executable = join(runtimeRoot, ...relativeExecutable.split("/"));
  const result = spawnSync(executable, forwarded.slice(1), {
    cwd: runtimeRoot,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    fail("harness command could not be started");
  }
  if (result.signal) {
    process.stderr.write("error: harness command ended by signal\n");
    process.exitCode = 1;
    return;
  }
  if (typeof result.status === "number") {
    process.exitCode = result.status;
    return;
  }
  process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (!command || command === "--help" || command === "-h" || command === "help") {
    usage();
    return;
  }
  if (!["init", "sync", "verify", "exec"].includes(command)) {
    fail("unknown media runtime command");
  }

  const options = parseOptions(command, argv);
  const bundle = await loadAndVerifyBundle(DEFAULT_BUNDLE_ROOT);
  let create = false;
  if (command === "init") {
    create = true;
  }
  const runtimeRoot = await prepareRuntime(options.project, create);

  if (command === "init" || command === "sync") {
    await copyBundle(runtimeRoot, bundle);
    await verifyRuntime(runtimeRoot, bundle);
    process.stdout.write(`PASS ${command}: private media harness is ready\n`);
    return;
  }
  await verifyRuntime(runtimeRoot, bundle);
  if (command === "verify") {
    process.stdout.write("PASS verify: private media harness matches the bundle\n");
    return;
  }
  await executeHarness(runtimeRoot, options.forwarded);
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
