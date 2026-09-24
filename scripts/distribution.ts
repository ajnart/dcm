#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createClaudeMarketplace } from "./lib/claude-marketplace.ts";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const PLUGIN_NAME = "selfhost-skills";

function fail(message: string): never {
  throw new Error(message);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function readZip(archive: Buffer): Map<string, { data: Buffer; mode: string }> {
  if (archive.length > MAX_ARCHIVE_BYTES) {
    fail("Release ZIP exceeds the distribution size limit");
  }
  let end = -1;
  const first = Math.max(0, archive.length - 65_557);
  for (let index = archive.length - 22; index >= first; index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0 || end + 22 !== archive.length) {
    fail("ZIP end record is missing or has unsupported trailing data");
  }
  const count = archive.readUInt16LE(end + 10);
  const centralSize = archive.readUInt32LE(end + 12);
  const centralStart = archive.readUInt32LE(end + 16);
  if (archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0 || archive.readUInt16LE(end + 8) !== count) {
    fail("Multi-disk ZIP archives are unsupported");
  }
  if (centralStart + centralSize !== end) {
    fail("ZIP central directory is inconsistent");
  }
  const files = new Map<string, { data: Buffer; mode: string }>();
  let cursor = centralStart;
  let expandedBytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50) {
      fail("ZIP central entry is invalid");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const expandedSize = archive.readUInt32LE(cursor + 24);
    const nameSize = archive.readUInt16LE(cursor + 28);
    const extraSize = archive.readUInt16LE(cursor + 30);
    const commentSize = archive.readUInt16LE(cursor + 32);
    const modeBits = archive.readUInt32LE(cursor + 38) >>> 16;
    const localStart = archive.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    if (next > end || flags !== 0 || (method !== 0 && method !== 8)) {
      fail("ZIP entry uses unsupported metadata or compression");
    }
    const name = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameSize));
    const segments = name.split("/");
    if (!name || name.startsWith("/") || !/^[A-Za-z0-9._/-]+$/.test(name) || segments.some((part) => !part || part === "." || part === ".." || part.startsWith(".env") || part === ".sessions")) {
      fail(`Unsafe ZIP path: ${name}`);
    }
    if (files.has(name)) {
      fail(`Duplicate ZIP path: ${name}`);
    }
    if (modeBits !== 0o100644 && modeBits !== 0o100755) {
      fail(`Unsupported ZIP file mode: ${name}`);
    }
    if (localStart + 30 > centralStart || archive.readUInt32LE(localStart) !== 0x04034b50) {
      fail(`Invalid ZIP local entry: ${name}`);
    }
    const localNameSize = archive.readUInt16LE(localStart + 26);
    const localExtraSize = archive.readUInt16LE(localStart + 28);
    const payloadStart = localStart + 30 + localNameSize + localExtraSize;
    if (payloadStart + compressedSize > centralStart) {
      fail(`ZIP payload crosses central directory: ${name}`);
    }
    const localName = decoder.decode(archive.subarray(localStart + 30, localStart + 30 + localNameSize));
    if (localName !== name || archive.readUInt16LE(localStart + 8) !== method) {
      fail(`ZIP local and central entries disagree: ${name}`);
    }
    expandedBytes += expandedSize;
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      fail("Expanded ZIP exceeds the distribution size limit");
    }
    const payload = archive.subarray(payloadStart, payloadStart + compressedSize);
    let data = Buffer.from(payload);
    if (method === 8) {
      data = inflateRawSync(payload, { maxOutputLength: expandedSize });
    }
    if (data.length !== expandedSize) {
      fail(`ZIP expanded size mismatch: ${name}`);
    }
    let mode = "0644";
    if (modeBits === 0o100755) {
      mode = "0755";
    }
    files.set(name, { data, mode });
    cursor = next;
  }
  if (cursor !== end) {
    fail("ZIP central directory has unparsed entries");
  }
  return files;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    fail(`${label} is required`);
  }
  return value;
}

function parseArguments(input: string[]): Record<string, string> {
  const allowed = new Set(["--archive", "--manifest", "--checksums", "--archive-url", "--output", "--source-commit"]);
  const values: Record<string, string> = {};
  for (let index = 0; index < input.length; index += 2) {
    const key = input[index];
    const value = input[index + 1];
    if (!allowed.has(key) || !value || value.startsWith("--") || values[key]) {
      fail(`Invalid or missing value for ${key}`);
    }
    values[key] = value;
  }
  for (const key of ["--archive", "--manifest", "--checksums", "--archive-url", "--output"]) {
    requireString(values[key], key);
  }
  if (values["--source-commit"] && !/^[a-f0-9]{40}$/.test(values["--source-commit"])) {
    fail("--source-commit must be a full lowercase Git commit ID");
  }
  return values;
}

async function writeTree(root: string, files: Map<string, { data: Buffer; mode: string }>): Promise<void> {
  for (const [name, file] of files) {
    const destination = join(root, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.data, { mode: Number.parseInt(file.mode, 8), flag: "wx" });
  }
}

async function main(): Promise<void> {
  const args = parseArguments(Bun.argv.slice(2));
  const archivePath = resolve(args["--archive"]);
  const manifestPath = resolve(args["--manifest"]);
  const checksumsPath = resolve(args["--checksums"]);
  const output = resolve(args["--output"]);
  const url = new URL(args["--archive-url"]);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".zip")) {
    fail("--archive-url must be a credential-free HTTPS ZIP URL");
  }
  if (existsSync(output)) {
    const details = await lstat(output);
    if (!details.isDirectory() || details.isSymbolicLink() || (await readdir(output)).length > 0) {
      fail("Distribution output must be a new or empty regular directory");
    }
  }
  let outputAncestor = output;
  while (!existsSync(outputAncestor)) {
    outputAncestor = dirname(outputAncestor);
  }
  if (await realpath(outputAncestor) !== outputAncestor) {
    fail("Distribution output has a symlinked parent");
  }
  for (const source of [archivePath, manifestPath, checksumsPath]) {
    if (source === output || source.startsWith(`${output}${sep}`)) {
      fail("Input files must remain outside the output directory");
    }
    const details = await lstat(source);
    if (!details.isFile() || details.isSymbolicLink()) {
      fail(`Input must be a regular file: ${source}`);
    }
  }
  const archive = await readFile(archivePath);
  const digest = sha256(archive);
  const checksumText = (await readFile(checksumsPath, "utf8")).trim();
  const checksumMatch = /^([a-f0-9]{64})  (selfhost-skills-[0-9A-Za-z.-]+\.zip)$/.exec(checksumText);
  if (!checksumMatch || checksumMatch[1] !== digest || checksumMatch[2] !== archivePath.split(sep).at(-1)) {
    fail("SHA256SUMS does not match the release ZIP");
  }
  const files = readZip(archive);
  const archiveManifest = files.get("RELEASE-MANIFEST.json");
  if (!archiveManifest || !archiveManifest.data.equals(await readFile(manifestPath))) {
    fail("External release manifest does not match ZIP contents");
  }
  const manifest = JSON.parse(archiveManifest.data.toString("utf8"));
  if (manifest.schemaVersion !== 1 || manifest.name !== PLUGIN_NAME || !Array.isArray(manifest.files)) {
    fail("Release manifest has an unsupported shape");
  }
  const version = requireString(manifest.version, "Release version");
  if (checksumMatch[2] !== `selfhost-skills-${version}.zip` || !url.pathname.endsWith(`/${checksumMatch[2]}`)) {
    fail("Release version, ZIP name, and archive URL disagree");
  }
  if (files.size !== manifest.files.length + 1) {
    fail("ZIP file count differs from release manifest");
  }
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    const name = requireString(entry.path, "Manifest path");
    const file = files.get(name);
    if (!file || seen.has(name) || sha256(file.data) !== entry.sha256 || file.data.length !== entry.size || file.mode !== entry.mode) {
      fail(`Release manifest mismatch: ${name}`);
    }
    seen.add(name);
  }
  for (const name of files.keys()) {
    if (name !== "RELEASE-MANIFEST.json" && !seen.has(name)) {
      fail(`Release manifest omits ZIP file: ${name}`);
    }
  }
  const plugin = files.get("plugin.json");
  const claudePlugin = files.get(".claude-plugin/plugin.json");
  if (!plugin || !claudePlugin || !files.has("skills/self-host/SKILL.md")) {
    fail("ZIP is missing a required plugin or skill entry");
  }
  if ([plugin, claudePlugin].some((entry) => JSON.parse(entry.data.toString("utf8")).version !== version)) {
    fail("Plugin manifest version differs from release version");
  }
  const skillEntries = [...files.keys()].filter((name) => /^skills\/[^/]+\/SKILL\.md$/.test(name));
  if (skillEntries.length !== 1) {
    fail("Distribution must expose exactly one public skill");
  }
  const codexCatalog = {
    name: "selfhost-skills-codex",
    interface: { displayName: "Selfhost Skills" },
    plugins: [{
      name: PLUGIN_NAME,
      source: { source: "local", path: `./plugins/${PLUGIN_NAME}` },
      policy: { installation: "AVAILABLE", authentication: "ON_USE" },
      category: "Productivity"
    }]
  };
  const claudeCatalog = createClaudeMarketplace({ version });
  const provenance: Record<string, unknown> = {
    schemaVersion: 1,
    name: PLUGIN_NAME,
    version,
    archiveUrl: url.toString(),
    archiveSha256: digest,
    archiveFiles: files.size
  };
  if (args["--source-commit"]) {
    provenance.sourceCommit = args["--source-commit"];
  }
  await mkdir(output, { recursive: true });
  const codexRoot = join(output, "codex");
  const claudeRoot = join(output, "claude");
  await writeTree(join(codexRoot, "plugins", PLUGIN_NAME), files);
  await writeTree(join(claudeRoot, "plugins", PLUGIN_NAME), files);
  await mkdir(join(codexRoot, ".agents", "plugins"), { recursive: true });
  await mkdir(join(claudeRoot, ".claude-plugin"), { recursive: true });
  await writeFile(join(codexRoot, ".agents", "plugins", "marketplace.json"), `${JSON.stringify(codexCatalog, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(claudeRoot, ".claude-plugin", "marketplace.json"), `${JSON.stringify(claudeCatalog, null, 2)}\n`, { flag: "wx" });
  for (const root of [codexRoot, claudeRoot]) {
    await writeFile(join(root, "DISTRIBUTION-MANIFEST.json"), `${JSON.stringify(provenance, null, 2)}\n`, { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify({ version, sha256: digest, output, codexRoot, claudeRoot }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
