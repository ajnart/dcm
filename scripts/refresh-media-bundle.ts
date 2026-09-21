#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPortabilityTransform,
  BUNDLE_MANIFEST_NAME,
  DEFAULT_BUNDLE_ROOT,
  loadAndVerifyBundle,
  loadAndVerifyBundleStructure,
  validateManifestPath,
  verifySourceDrift,
} from "../.agents/skills/self-host/workflows/selfhost-media/scripts/verify-bundle.ts";

// Runtime additions are explicit so repository tooling is never packaged by accident.
const RUNTIME_ADDITIONS = [
  "docs/browser-benchmark.md",
  "docs/browser-paths.json",
  "scripts/browser-benchmark.ts",
  "scripts/check-browser-benchmark.ts",
  "scripts/check-browser-api-key.ts",
  "scripts/check-bootstrap-qbittorrent.ts",
  "scripts/bootstrap-jellyfin.ts",
  "scripts/check-bootstrap-jellyfin.ts",
  "scripts/lib/session-access.ts",
  "scripts/check-session-access.ts",
  "docs/headless-access.md",
  "scripts/browser-form.ts",
  "scripts/check-browser-form.ts",
  "scripts/bootstrap-seerr.ts",
  "scripts/check-bootstrap-seerr.ts",
  "scripts/check-prowlarr-verifier.ts",
  "scripts/homarr-notebook.ts",
  "scripts/check-homarr-notebook.ts",
  "scripts/prove-homarr-widgets.ts",
  "scripts/check-prove-homarr-widgets.ts",
];

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));

function fail(message) {
  throw new Error(message);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalMode(stat) {
  if ((stat.mode & 0o111) !== 0) {
    return "0755";
  }
  return "0644";
}

async function readCanonicalFile(relativePath, expectedMode) {
  validateManifestPath(relativePath);
  const sourcePath = join(SOURCE_ROOT, ...relativePath.split("/"));
  const stat = await lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail(`canonical source is unsafe: ${relativePath}`);
  }
  if (
    typeof process.getuid !== "function"
    || typeof process.getgid !== "function"
    || stat.uid !== process.getuid()
    || stat.gid !== process.getgid()
  ) {
    fail(`canonical source ownership is unsafe: ${relativePath}`);
  }
  if (canonicalMode(stat) !== expectedMode) {
    fail(`canonical source mode changed: ${relativePath}`);
  }
  return readFile(sourcePath);
}

async function atomicWrite(targetPath, content, mode) {
  const temporaryPath = `${targetPath}.refresh-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", Number.parseInt(mode, 8));
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, Number.parseInt(mode, 8));
    await rename(temporaryPath, targetPath);
  } finally {
    if (handle) {
      await handle.close();
    }
    await rm(temporaryPath, { force: true });
  }
}

async function main() {
  if (Bun.argv.length !== 2) {
    fail("refresh-media-bundle.ts accepts no arguments");
  }

  const current = await loadAndVerifyBundleStructure(DEFAULT_BUNDLE_ROOT);
  const transformByPath = new Map(
    current.manifest.sourceTransforms.map((transform) => [transform.path, transform]),
  );
  const generated = [];
  const files = [];
  const sourceTransforms = [];

  const manifestFiles = [...current.manifest.files];
  for (const path of RUNTIME_ADDITIONS) {
    if (!manifestFiles.some((file) => file.path === path)) {
      const stat = await lstat(join(SOURCE_ROOT, path));
      manifestFiles.push({ path, mode: canonicalMode(stat), sha256: "" });
    }
  }
  manifestFiles.sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });
  for (const currentFile of manifestFiles) {
    const file = { ...currentFile };
    const source = await readCanonicalFile(file.path, file.mode);
    const transform = transformByPath.get(file.path);
    let content = source;
    if (transform) {
      content = Buffer.from(
        applyPortabilityTransform(transform.id, source.toString("utf8")),
        "utf8",
      );
      sourceTransforms.push({
        path: file.path,
        id: transform.id,
        sourceSha256: sha256(source),
      });
    }
    generated.push({ ...file, content });
    files.push({ path: file.path, mode: file.mode, sha256: sha256(content) });
  }

  for (const file of generated) {
    const previous = current.manifest.files.find(
      (entry) => entry.path === file.path,
    );
    const nextHash = sha256(file.content);
    const targetPath = join(DEFAULT_BUNDLE_ROOT, ...file.path.split("/"));
    let targetExists = true;
    try {
      await lstat(targetPath);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        targetExists = false;
      } else {
        throw error;
      }
    }
    if (previous?.sha256 === nextHash && targetExists) {
      continue;
    }
    await atomicWrite(targetPath, file.content, file.mode);
  }

  const nextManifest = {
    formatVersion: current.manifest.formatVersion,
    algorithm: current.manifest.algorithm,
    sourceTransforms,
    files,
  };
  const manifestContent = `${JSON.stringify(nextManifest, null, 2)}\n`;
  await atomicWrite(
    join(DEFAULT_BUNDLE_ROOT, BUNDLE_MANIFEST_NAME),
    manifestContent,
    "0644",
  );

  await loadAndVerifyBundle(DEFAULT_BUNDLE_ROOT);
  const count = await verifySourceDrift(SOURCE_ROOT, DEFAULT_BUNDLE_ROOT);
  process.stdout.write(`PASS media bundle refreshed: ${count} files\n`);
}

main().catch((error) => {
  let detail = "unknown failure";
  if (error instanceof Error && error.message.length > 0) {
    detail = error.message;
  }
  process.stderr.write(`FAIL media bundle refresh: ${detail}\n`);
  process.exitCode = 1;
});
