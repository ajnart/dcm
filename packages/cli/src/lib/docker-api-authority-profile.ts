import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from "node:fs";
import { fileURLToPath } from "node:url";
import { installedCliRoot } from "./installed-cli-root.ts";

export type DockerApiAuthorityMode = "docker-management-mtls" | "docker-inventory-mtls";
export type DockerApiAuthorityProfile = {
  version: 1;
  appId: string;
  modes: readonly DockerApiAuthorityMode[];
  sourceFiles: readonly string[];
  additionalBoundaries: readonly string[];
};
export type LoadedDockerApiAuthorityProfile = DockerApiAuthorityProfile & { sourceSha256: string };

function invalid(): never { throw new Error("Catalog Docker authority profile is invalid; payload withheld"); }
function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode
    && a.nlink === b.nlink && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
export function decodeDockerApiAuthorityProfile(value: unknown, appId: string): DockerApiAuthorityProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(",") !== "additionalBoundaries,appId,modes,sourceFiles,version"
    || data.version !== 1 || !identifier(appId) || data.appId !== appId
    || !Array.isArray(data.modes) || data.modes.length < 1 || data.modes.length > 2
    || data.modes.some((mode) => !["docker-management-mtls", "docker-inventory-mtls"].includes(mode))
    || new Set(data.modes).size !== data.modes.length
    || !Array.isArray(data.sourceFiles) || data.sourceFiles.length < 1 || data.sourceFiles.length > 16
    || data.sourceFiles.some((file) => typeof file !== "string" || file.length > 96
      || !/^[a-z][a-z0-9-]*\.(?:json|ts)$/.test(file) || file === "docker-authority.json")
    || new Set(data.sourceFiles).size !== data.sourceFiles.length
    || !data.sourceFiles.includes("manifest.json")
    || !Array.isArray(data.additionalBoundaries) || data.additionalBoundaries.length > 8
    || data.additionalBoundaries.some((boundary) => !identifier(boundary))
    || new Set(data.additionalBoundaries).size !== data.additionalBoundaries.length) invalid();
  return Object.freeze({ version: 1, appId,
    modes: Object.freeze([...data.modes]) as DockerApiAuthorityMode[],
    sourceFiles: Object.freeze([...data.sourceFiles].sort()),
    additionalBoundaries: Object.freeze([...data.additionalBoundaries].sort()) });
}

/** Closed catalog paths only. No supplied paths, executable declarations, or secret files. */
function readClosedFile(path: string, limit: number): Buffer {
  if (realpathSync(path) !== path) invalid();
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const descriptor = openSync(path, flags);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > limit
      || (before.mode & 0o002) !== 0) invalid();
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(descriptor);
    if (length !== before.size || !sameFile(before, after) || realpathSync(path) !== path) invalid();
    const current = openSync(path, flags);
    try { if (!sameFile(after, fstatSync(current))) invalid(); }
    finally { closeSync(current); }
    return buffer.subarray(0, length);
  } finally { closeSync(descriptor); }
}

/** The profile and every declared app-local source enter the authority fingerprint. */
export function dockerApiAuthorityProfile(appId: string): LoadedDockerApiAuthorityProfile | null {
  if (!identifier(appId)) return null;
  let root = new URL("workflows/selfhost/references/catalog/apps/", installedCliRoot(import.meta.url));
  if (new URL(import.meta.url).pathname.endsWith(".ts")) {
    root = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
  }
  const directory = new URL(`${appId}/`, root);
  const path = fileURLToPath(new URL("docker-authority.json", directory));
  try { lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    invalid();
  }
  try {
    const bytes = readClosedFile(path, 4096);
    const profile = decodeDockerApiAuthorityProfile(JSON.parse(bytes.toString("utf8")), appId);
    const hash = createHash("sha256").update("docker-authority.json\0").update(bytes);
    for (const file of profile.sourceFiles) {
      hash.update(`\0${file}\0`).update(readClosedFile(fileURLToPath(new URL(file, directory)), 262144));
    }
    return Object.freeze({ ...profile, sourceSha256: hash.digest("hex") });
  } catch { return invalid(); }
}
