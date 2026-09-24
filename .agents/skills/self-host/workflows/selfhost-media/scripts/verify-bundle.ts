#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  join,
  posix,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLE_MANIFEST_NAME = "bundle-manifest.json";
export const DEFAULT_BUNDLE_ROOT = fileURLToPath(
  new URL("../assets/harness/", import.meta.url),
);

const FORMAT_VERSION = 1;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const ROOT_FILES = new Set(["PROMPT.md", "docker-compose.yml"]);
const CANONICAL_DIRECTORIES = new Set(["docs", "prompts", "scripts"]);
const SOURCE_DRIFT_EXCLUSIONS = new Set([
  "docs/cli.md",
  "docs/images",
  "docs/migration-v1.md",
  "docs/opencode-install.md",
  "docs/plugin-audit.md",
  "docs/release.md",
  "scripts/distribution.ts",
  "scripts/lib/claude-marketplace.ts",
  "scripts/publish-plugin-branches.sh",
  "scripts/refresh-media-bundle.ts",
  "scripts/skillpack.ts",
  "scripts/lib/skillpack.ts",
  "scripts/smoke-install.sh",
  "scripts/validate-repo.ts",
]);
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".sessions",
  "artifacts",
  "config",
  "configs",
  "data",
  "generations",
  "screenshots",
  "secrets",
]);
const EXPECTED_IMAGES = new Map([
  ["prowlarr", "ghcr.io/hotio/prowlarr:latest"],
  ["radarr", "ghcr.io/hotio/radarr:latest"],
  ["sonarr", "ghcr.io/hotio/sonarr:latest"],
  ["qbittorrent", "ghcr.io/hotio/qbittorrent:latest"],
  ["jellyfin", "ghcr.io/hotio/jellyfin:latest"],
  ["seerr", "ghcr.io/seerr-team/seerr:latest"],
  ["homarr", "ghcr.io/homarr-labs/homarr-test:v2"],
]);
const PORTABILITY_TRANSFORMS = new Map([
  [
    "portable-agent-browser-skill-path-v1",
    {
      pattern: /^1\. Read `\/[^`\r\n]+\/agent-browser\/SKILL\.md`\.$/gm,
      to: "1. Read the available `agent-browser` skill's `SKILL.md`.",
    },
  ],
  [
    "portable-working-directory-v1",
    {
      pattern: /^- Working tree `\/[^`\r\n]+`\.$/gm,
      to: "- Working directory: the installed harness root.",
    },
  ],
]);

function fail(message) {
  throw new Error(message);
}

function isMissing(error) {
  return error && error.code === "ENOENT";
}

function assertSafeBundleFile(stat, label) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail(`${label} must be a regular single-link file`);
  }
  if (
    typeof process.getuid !== "function"
    || typeof process.getgid !== "function"
  ) {
    fail(`${label} ownership cannot be verified`);
  }
  if (stat.uid !== process.getuid() || stat.gid !== process.getgid()) {
    fail(`${label} must be owned by the current user and group`);
  }
}

function assertCompatibleBundleMode(stat, expectedMode, label) {
  const actualMode = stat.mode & 0o7777;
  const canonicalMode = Number.parseInt(expectedMode, 8);
  if (actualMode === canonicalMode) {
    return;
  }
  if (actualMode === (canonicalMode | 0o020)) {
    return;
  }
  fail(`${label} mode is unsafe`);
}

function canonicalSourceMode(stat) {
  if ((stat.mode & 0o111) !== 0) {
    return "0755";
  }
  return "0644";
}

function isExcludedSegment(segment) {
  const lower = segment.toLowerCase();
  if (EXCLUDED_SEGMENTS.has(lower)) {
    return true;
  }
  if (lower === ".env" || lower.startsWith(".env.")) {
    return true;
  }
  if (lower.startsWith("secrets.")) {
    return true;
  }
  if (lower.endsWith(".key") || lower.endsWith(".secret")) {
    return true;
  }
  return false;
}

export function validateManifestPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    fail("manifest contains an empty path");
  }
  if (relativePath.length > 256 || !/^[a-zA-Z0-9._/-]+$/.test(relativePath)) {
    fail("manifest contains an invalid path");
  }
  if (relativePath.includes("\\") || relativePath.includes("\0")) {
    fail("manifest contains a non-portable path");
  }
  if (posix.isAbsolute(relativePath) || posix.normalize(relativePath) !== relativePath) {
    fail("manifest contains an unsafe relative path");
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail("manifest path traversal is forbidden");
  }
  if (segments.some(isExcludedSegment)) {
    fail("manifest contains an excluded path");
  }

  if (segments.length === 1 && ROOT_FILES.has(relativePath)) {
    return relativePath;
  }
  if (segments.length > 1 && CANONICAL_DIRECTORIES.has(segments[0])) {
    return relativePath;
  }
  fail("manifest path is outside the harness allowlist");
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function sha256Content(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function applyPortabilityTransform(transformId, sourceContent) {
  const transform = PORTABILITY_TRANSFORMS.get(transformId);
  if (!transform) {
    fail("bundle manifest contains an unknown source transform");
  }
  const matches = sourceContent.match(transform.pattern);
  if (!matches || matches.length !== 1) {
    fail("canonical source does not match its portability transform");
  }
  return sourceContent.replace(transform.pattern, transform.to);
}

function expectedDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    let parent = posix.dirname(file.path);
    while (parent !== ".") {
      directories.add(parent);
      parent = posix.dirname(parent);
    }
  }
  return directories;
}

function parseManifest(raw) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    fail("bundle manifest is not valid JSON");
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("bundle manifest root must be an object");
  }
  const topLevelKeys = Object.keys(manifest).sort();
  if (topLevelKeys.join(",") !== "algorithm,files,formatVersion,sourceTransforms") {
    fail("bundle manifest has unsupported fields");
  }
  if (manifest.formatVersion !== FORMAT_VERSION) {
    fail("bundle manifest format version is unsupported");
  }
  if (
    manifest.algorithm !== "sha256"
    || !Array.isArray(manifest.files)
    || !Array.isArray(manifest.sourceTransforms)
  ) {
    fail("bundle manifest algorithm or file list is invalid");
  }
  if (manifest.files.length === 0 || manifest.files.length > 10000) {
    fail("bundle manifest file count is invalid");
  }

  const seen = new Set();
  let previousPath = "";
  for (const file of manifest.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      fail("bundle manifest file entry must be an object");
    }
    const keys = Object.keys(file).sort();
    if (keys.join(",") !== "mode,path,sha256") {
      fail("bundle manifest file entry has unsupported fields");
    }
    validateManifestPath(file.path);
    if (seen.has(file.path) || (previousPath && file.path <= previousPath)) {
      fail("bundle manifest paths must be unique and sorted");
    }
    if (file.mode !== "0644" && file.mode !== "0755") {
      fail("bundle manifest contains an unsupported file mode");
    }
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      fail("bundle manifest contains an invalid SHA256 hash");
    }
    seen.add(file.path);
    previousPath = file.path;
  }

  const transformedPaths = new Set();
  previousPath = "";
  for (const transform of manifest.sourceTransforms) {
    if (!transform || typeof transform !== "object" || Array.isArray(transform)) {
      fail("bundle manifest source transform must be an object");
    }
    const keys = Object.keys(transform).sort();
    if (keys.join(",") !== "id,path,sourceSha256") {
      fail("bundle manifest source transform has unsupported fields");
    }
    validateManifestPath(transform.path);
    if (!seen.has(transform.path) || transformedPaths.has(transform.path)) {
      fail("bundle manifest source transform path is invalid");
    }
    if (previousPath && transform.path <= previousPath) {
      fail("bundle manifest source transforms must be sorted");
    }
    if (!PORTABILITY_TRANSFORMS.has(transform.id)) {
      fail("bundle manifest contains an unknown source transform");
    }
    if (
      typeof transform.sourceSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(transform.sourceSha256)
    ) {
      fail("bundle manifest source transform hash is invalid");
    }
    transformedPaths.add(transform.path);
    previousPath = transform.path;
  }
  return manifest;
}

async function readManifest(bundleRoot) {
  const manifestPath = join(bundleRoot, BUNDLE_MANIFEST_NAME);
  const stat = await lstat(manifestPath);
  assertSafeBundleFile(stat, "bundle manifest");
  assertCompatibleBundleMode(stat, "0644", "bundle manifest");
  if (stat.size > MAX_MANIFEST_BYTES) {
    fail("bundle manifest is too large");
  }
  return parseManifest(await readFile(manifestPath, "utf8"));
}

async function assertRootDirectory(rootPath, label, rejectSymlinkComponents = false) {
  const requested = resolve(rootPath);
  const stat = await lstat(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be a real directory`);
  }
  const resolved = await realpath(requested);
  if (rejectSymlinkComponents && resolved !== requested) {
    fail(`${label} must not cross a symlink`);
  }
  return resolved;
}

async function verifyBundleTree(bundleRoot, manifest) {
  const expectedFiles = new Map(
    manifest.files.map((file) => [file.path, file]),
  );
  const expectedDirs = expectedDirectories(manifest.files);
  const foundFiles = new Set();

  async function walk(relativeDirectory) {
    const directoryPath = relativeDirectory
      ? join(bundleRoot, ...relativeDirectory.split("/"))
      : bundleRoot;
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      let relativePath = entry.name;
      if (relativeDirectory) {
        relativePath = `${relativeDirectory}/${entry.name}`;
      }
      const fullPath = join(bundleRoot, ...relativePath.split("/"));
      const stat = await lstat(fullPath);
      if (stat.isSymbolicLink()) {
        fail("bundle contains a symbolic link");
      }
      if (stat.isDirectory()) {
        if (!expectedDirs.has(relativePath)) {
          fail("bundle contains an unexpected directory");
        }
        await walk(relativePath);
        continue;
      }
      assertSafeBundleFile(stat, `bundle file ${relativePath}`);
      if (relativePath === BUNDLE_MANIFEST_NAME) {
        assertCompatibleBundleMode(stat, "0644", "bundle manifest");
        continue;
      }

      const expected = expectedFiles.get(relativePath);
      if (!expected) {
        fail("bundle contains an unexpected file");
      }
      assertCompatibleBundleMode(stat, expected.mode, `bundle file ${relativePath}`);
      if ((await sha256File(fullPath)) !== expected.sha256) {
        fail(`bundle hash mismatch for ${relativePath}`);
      }
      foundFiles.add(relativePath);
    }
  }

  await walk("");
  if (foundFiles.size !== manifest.files.length) {
    fail("bundle is missing one or more manifest files");
  }
}

async function verifyComposeContract(bundleRoot) {
  const compose = await readFile(join(bundleRoot, "docker-compose.yml"), "utf8");
  const observed = new Map();
  const services = new Set();
  let inServices = false;
  let currentService = "";

  for (const line of compose.split(/\r?\n/)) {
    if (line === "services:") {
      inServices = true;
      continue;
    }
    if (inServices && /^[a-zA-Z]/.test(line)) {
      inServices = false;
      currentService = "";
    }
    if (!inServices) {
      continue;
    }
    const serviceMatch = line.match(/^  ([a-z0-9_-]+):\s*$/);
    if (serviceMatch) {
      currentService = serviceMatch[1];
      services.add(currentService);
      continue;
    }
    const imageMatch = line.match(/^    image:\s*([^\s#]+)\s*$/);
    if (currentService && imageMatch) {
      observed.set(currentService, imageMatch[1]);
    }
  }

  if (observed.size !== EXPECTED_IMAGES.size || services.size !== EXPECTED_IMAGES.size) {
    fail("Compose service/image count does not match the media contract");
  }
  for (const [service, image] of EXPECTED_IMAGES) {
    if (!services.has(service) || observed.get(service) !== image) {
      fail(`Compose image contract mismatch for ${service}`);
    }
  }

  const requiredSeerrHealthcheck = [
    "      test: wget --no-verbose --tries=1 --spider http://localhost:5055/api/v1/settings/public || exit 1",
    "      start_period: 20s",
    "      timeout: 3s",
    "      interval: 15s",
    "      retries: 3",
  ];
  for (const line of requiredSeerrHealthcheck) {
    if (!compose.includes(`${line}\n`)) {
      fail("Compose Seerr healthcheck contract changed");
    }
  }

  const requiredPublishedPorts = [
    '      - "127.0.0.1:${PROWLARR_PORT:-9696}:9696"',
    '      - "127.0.0.1:${RADARR_PORT:-7878}:7878"',
    '      - "127.0.0.1:${SONARR_PORT:-8989}:8989"',
    '      - "127.0.0.1:${QBITTORRENT_PORT:-8080}:${QBITTORRENT_PORT:-8080}"',
    '      - "127.0.0.1:${JELLYFIN_PORT:-8096}:8096"',
    '      - "127.0.0.1:${SEERR_PORT:-5055}:5055"',
    '      - "${HOMARR_BIND_ADDRESS:-127.0.0.1}:${HOMARR_PORT:-7575}:7575"',
  ];
  for (const line of requiredPublishedPorts) {
    if (!compose.includes(`${line}\n`)) {
      fail("Compose published-port contract changed");
    }
  }
  if (
    !compose.includes("      WEBUI_PORT: ${QBITTORRENT_PORT:-8080}\n")
    || !compose.includes("      WEBUI_PORTS: ${QBITTORRENT_PORT:-8080}/tcp\n")
  ) {
    fail("Compose qBittorrent fallback-port contract changed");
  }
}

async function verifyPromptManifest(bundleRoot, manifest) {
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  const raw = await readFile(join(bundleRoot, "prompts", "manifest.txt"), "utf8");
  const modules = raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (modules.length === 0) {
    fail("prompt module manifest is empty");
  }
  for (const modulePath of modules) {
    validateManifestPath(modulePath);
    if (!modulePath.startsWith("prompts/") || !modulePath.endsWith(".md")) {
      fail("prompt module manifest contains an invalid module");
    }
    if (!manifestPaths.has(modulePath)) {
      fail("prompt module is absent from the bundle manifest");
    }
  }
}

async function verifyPortableContract(bundleRoot) {
  const contract = await readFile(join(bundleRoot, "prompts", "00-contract.md"), "utf8");
  const serviceNotes = await readFile(join(bundleRoot, "docs", "README.md"), "utf8");
  if (/^- Working tree `\//m.test(contract)) {
    fail("packaged contract depends on the canonical repository root");
  }
  if (/^1\. Read `\//m.test(serviceNotes)) {
    fail("packaged service notes depend on a host-specific skill path");
  }
}

export async function loadAndVerifyBundleStructure(bundleRoot = DEFAULT_BUNDLE_ROOT) {
  const safeRoot = await assertRootDirectory(bundleRoot, "bundle root");
  const manifest = await readManifest(safeRoot);
  await verifyBundleTree(safeRoot, manifest);
  return { bundleRoot: safeRoot, manifest };
}

export async function loadAndVerifyBundle(bundleRoot = DEFAULT_BUNDLE_ROOT) {
  const bundle = await loadAndVerifyBundleStructure(bundleRoot);
  const safeRoot = bundle.bundleRoot;
  await verifyComposeContract(safeRoot);
  await verifyPromptManifest(safeRoot, bundle.manifest);
  await verifyPortableContract(safeRoot);
  return bundle;
}

async function assertSafeSourceRoot(sourceRoot) {
  const safeRoot = await assertRootDirectory(sourceRoot, "source root", true);
  if (safeRoot === sep) {
    fail("source root cannot be the filesystem root");
  }
  let safeHome = "";
  try {
    safeHome = await realpath(homedir());
  } catch {
    safeHome = "";
  }
  if (safeHome && safeRoot === safeHome) {
    fail("source root cannot be the user home directory");
  }
  return safeRoot;
}

async function detectUnexpectedSourceFiles(sourceRoot, manifest) {
  const expectedFiles = new Set(manifest.files.map((file) => file.path));
  const expectedDirs = expectedDirectories(manifest.files);

  async function walk(relativeDirectory) {
    const directoryPath = join(sourceRoot, ...relativeDirectory.split("/"));
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (isExcludedSegment(entry.name)) {
        continue;
      }
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (SOURCE_DRIFT_EXCLUSIONS.has(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!expectedDirs.has(relativePath)) {
          fail("source drift: unexpected canonical directory");
        }
        await walk(relativePath);
        continue;
      }
      if (!expectedFiles.has(relativePath)) {
        fail("source drift: unexpected canonical file");
      }
    }
  }

  for (const directory of CANONICAL_DIRECTORIES) {
    await walk(directory);
  }
}

export async function verifySourceDrift(sourceRoot, bundleRoot = DEFAULT_BUNDLE_ROOT) {
  const bundle = await loadAndVerifyBundle(bundleRoot);
  const safeSourceRoot = await assertSafeSourceRoot(sourceRoot);
  const sourceTransforms = new Map(
    bundle.manifest.sourceTransforms.map((transform) => [transform.path, transform]),
  );

  for (const file of bundle.manifest.files) {
    const sourcePath = join(safeSourceRoot, ...file.path.split("/"));
    let stat;
    try {
      stat = await lstat(sourcePath);
    } catch (error) {
      if (isMissing(error)) {
        fail(`source drift: missing ${file.path}`);
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      fail(`source drift: unsafe source file ${file.path}`);
    }
    if (canonicalSourceMode(stat) !== file.mode) {
      fail(`source drift: executable mode changed for ${file.path}`);
    }
    const sourceContent = await readFile(sourcePath);
    const transform = sourceTransforms.get(file.path);
    if (transform) {
      if (sha256Content(sourceContent) !== transform.sourceSha256) {
        fail(`source drift: content changed for ${file.path}`);
      }
      const portableContent = applyPortabilityTransform(
        transform.id,
        sourceContent.toString("utf8"),
      );
      if (sha256Content(portableContent) !== file.sha256) {
        fail(`source drift: portability transform changed for ${file.path}`);
      }
      continue;
    }
    if (sha256Content(sourceContent) !== file.sha256) {
      fail(`source drift: content changed for ${file.path}`);
    }
  }

  await detectUnexpectedSourceFiles(safeSourceRoot, bundle.manifest);
  return bundle.manifest.files.length;
}

function usage() {
  process.stdout.write(
    "Usage: bun scripts/verify-bundle.ts [--bundle PATH] [--source-root PATH]\n",
  );
}

function parseArguments(argv) {
  let bundleRoot = DEFAULT_BUNDLE_ROOT;
  let sourceRoot = "";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      return null;
    }
    if (argument === "--bundle" || argument === "--source-root") {
      const value = argv[index + 1];
      if (!value) {
        fail(`${argument} requires a path`);
      }
      if (argument === "--bundle") {
        bundleRoot = value;
      } else {
        sourceRoot = value;
      }
      index += 1;
      continue;
    }
    fail("unknown verifier argument");
  }
  return { bundleRoot, sourceRoot };
}

async function main() {
  const options = parseArguments(Bun.argv.slice(2));
  if (!options) {
    return;
  }
  const bundle = await loadAndVerifyBundle(options.bundleRoot);
  process.stdout.write(`PASS bundle: ${bundle.manifest.files.length} files verified\n`);
  if (options.sourceRoot) {
    const count = await verifySourceDrift(options.sourceRoot, options.bundleRoot);
    process.stdout.write(`PASS source drift: ${count} files match\n`);
  }
}

let isMain = false;
if (Bun.argv[1]) {
  try {
    isMain = realpathSync(resolve(Bun.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isMain = false;
  }
}

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
