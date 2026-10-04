import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { matchesRecipeImagePin, isRecipeImageReference } from "./recipe-image-reference.ts";

export type RuntimeResourceRequest = { profile: "tun-net-admin"; officialUrl: string };
export type RuntimeResourceClaim = RuntimeResourceRequest & { appId: string; sourceSha256: string };
type Declaration = RuntimeResourceRequest & {
  schemaVersion: 1; kind: "shared-runtime-resources"; appId: string; serviceId: string; imageTag: string;
};
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const runtimeSourceNames = ["runtime-resources.ts", "recipe-image-reference.ts"] as const;
function fail(): never { throw new Error("Runtime resource declaration, publisher source or image differs; inspect before startup"); }
function read(url: URL): Buffer {
  const path = fileURLToPath(url);
  if (realpathSync(path) !== path) fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 1024 * 1024
      || (before.mode & 0o002) !== 0) fail();
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = readSync(fd, bytes, count, bytes.length - count, null);
      if (size === 0) break;
      count += size;
    }
    for (const after of [fstatSync(fd), lstatSync(path)]) {
      if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size
        || before.mode !== after.mode || before.nlink !== after.nlink
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail();
    }
    if (count !== before.size || realpathSync(path) !== path) fail();
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
export function checkedRuntimeResourceRequest(value: unknown): RuntimeResourceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "officialUrl,profile" || row.profile !== "tun-net-admin"
    || typeof row.officialUrl !== "string") fail();
  const url = new URL(row.officialUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) fail();
  return { profile: row.profile, officialUrl: row.officialUrl };
}
/** Authority comes from installed reviewed app source, never caller capability/device lists. */
export function runtimeResourceClaim(app: URL, appId: string, serviceId: string,
  image: string, request: unknown): RuntimeResourceClaim {
  // Resolve the canonical source copies through the catalog, including in a
  // bundled install where import.meta.url belongs to a CLI executable.
  const runtimeDirectory = new URL("../../types/", app);
  const runtimeSources = runtimeSourceNames.map((name) => [name, sha(read(new URL(name, runtimeDirectory)))]);
  const runtimeSha256 = sha(JSON.stringify(runtimeSources));
  const key = Symbol.for("selfhost.shared-runtime-resources.runtime-source.v1");
  const state = globalThis as typeof globalThis & { [key: symbol]: Map<string, string> | undefined };
  const snapshots = state[key] ??= new Map<string, string>();
  const prior = snapshots.get(runtimeDirectory.href);
  if (prior !== undefined && prior !== runtimeSha256) fail();
  snapshots.set(runtimeDirectory.href, runtimeSha256);
  const selected = checkedRuntimeResourceRequest(request);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)) fail();
  const declarationBytes = read(new URL("runtime-resources.json", app));
  const declaration: Declaration = JSON.parse(declarationBytes.toString("utf8"));
  if (Object.keys(declaration).sort().join(",") !== "appId,imageTag,kind,officialUrl,profile,schemaVersion,serviceId"
    || declaration.schemaVersion !== 1 || declaration.kind !== "shared-runtime-resources"
    || declaration.appId !== appId || declaration.serviceId !== appId
    || serviceId !== declaration.serviceId || declaration.profile !== selected.profile
    || declaration.officialUrl !== selected.officialUrl || !isRecipeImageReference(declaration.imageTag)
    || !matchesRecipeImagePin(declaration.imageTag, image)) fail();
  const manifestBytes = read(new URL("manifest.json", app));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.id !== appId || !Array.isArray(manifest.sources) || !manifest.sources.includes(selected.officialUrl)) fail();
  const sourceNames = () => readdirSync(app).filter((name) => /^[a-z0-9][a-z0-9-]*\.(?:ts|js|json)$/.test(name)).sort();
  const names = sourceNames();
  if (names.length > 64 || !names.includes("manifest.json") || !names.includes("runtime-resources.json")) fail();
  const sources = names.map((name) => [name, sha(read(new URL(name, app)))]);
  if (JSON.stringify(sourceNames()) !== JSON.stringify(names)
    || sources.find(([name]) => name === "runtime-resources.json")?.[1] !== sha(declarationBytes)
    || sources.find(([name]) => name === "manifest.json")?.[1] !== sha(manifestBytes)) fail();
  const currentRuntimeSources = runtimeSourceNames.map((name) => [name, sha(read(new URL(name, runtimeDirectory)))]);
  if (JSON.stringify(currentRuntimeSources) !== JSON.stringify(runtimeSources)) fail();
  return { ...selected, appId, sourceSha256: sha(JSON.stringify({ sources, runtimeSources })) };
}
export function checkedRuntimeResourceClaim(catalog: URL, serviceId: string,
  image: string, value: unknown): RuntimeResourceClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as RuntimeResourceClaim;
  if (Object.keys(row).sort().join(",") !== "appId,officialUrl,profile,sourceSha256"
    || typeof row.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.appId)) fail();
  const claim = runtimeResourceClaim(new URL(`apps/${row.appId}/`, catalog), row.appId, serviceId, image,
    { profile: row.profile, officialUrl: row.officialUrl });
  if (claim.sourceSha256 !== row.sourceSha256) fail();
  return claim;
}
export function runtimeResourceEffects(claim: RuntimeResourceClaim) {
  checkedRuntimeResourceRequest({ profile: claim.profile, officialUrl: claim.officialUrl });
  return { capabilities: ["NET_ADMIN"], devices: ["/dev/net/tun:/dev/net/tun:rwm"],
    scope: "container-network-namespace", hostNetworking: false, hostAdministration: false };
}
/** Metadata only: no device creation, module loading, permission changes or payload reads. */
export function verifyRuntimeResourceDevice(): void {
  const path = "/dev/net/tun";
  const stat = lstatSync(path);
  const major = Math.floor(stat.rdev / 256) & 0xfff;
  const minor = (stat.rdev & 0xff) | (Math.floor(stat.rdev / 4096) & 0xfffff00);
  if (!stat.isCharacterDevice() || stat.isSymbolicLink() || realpathSync(path) !== path
    || major !== 10 || minor !== 200) throw new Error("Runtime resource requires the existing exact Linux TUN character device (10:200)");
}
