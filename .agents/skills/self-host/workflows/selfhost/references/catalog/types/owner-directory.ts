import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecipeImageReference, matchesRecipeImagePin } from "./recipe-image-reference.ts";

export type OwnerDirectoryRequest = { kind: "docker-stack-directory"; officialUrl: string };
export type OwnerDirectoryClaim = OwnerDirectoryRequest & { appId: string; sourceSha256: string };
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function fail(): never { throw new Error("Owned daemon directory differs from reviewed app source, image or exact project path"); }
function read(url: URL): Buffer {
  const path = fileURLToPath(url);
  if (realpathSync(path) !== path) fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 1024 * 1024 || (before.mode & 0o002) !== 0) fail();
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    for (const after of [fstatSync(fd), lstatSync(path)]) {
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mode !== after.mode || before.nlink !== after.nlink
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail();
    }
    if (length !== before.size || realpathSync(path) !== path) fail();
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}
export function checkedOwnerDirectoryRequest(value: unknown): OwnerDirectoryRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as OwnerDirectoryRequest;
  if (Object.keys(row).sort().join(",") !== "kind,officialUrl" || row.kind !== "docker-stack-directory"
    || typeof row.officialUrl !== "string") fail();
  const url = new URL(row.officialUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) fail();
  return { kind: row.kind, officialUrl: row.officialUrl };
}
export function ownerDirectoryClaim(app: URL, appId: string, serviceId: string,
  image: string, request: unknown): OwnerDirectoryClaim {
  const selected = checkedOwnerDirectoryRequest(request);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || serviceId !== appId) fail();
  const runtime = new URL("../../types/", app);
  const runtimeNames = ["owner-directory.ts", "recipe-image-reference.ts"];
  const runtimeSources = runtimeNames.map((name) => [name, sha(read(new URL(name, runtime)))]);
  const runtimeHash = sha(JSON.stringify(runtimeSources));
  const key = Symbol.for("selfhost.shared-owner-directory.runtime-source.v1");
  const processState = globalThis as typeof globalThis & { [key: symbol]: Map<string, string> | undefined };
  const snapshots = processState[key] ??= new Map<string, string>();
  const prior = snapshots.get(runtime.href);
  if (prior !== undefined && prior !== runtimeHash) fail();
  snapshots.set(runtime.href, runtimeHash);
  const declarationBytes = read(new URL("owner-directory.json", app));
  const declaration = JSON.parse(declarationBytes.toString("utf8"));
  if (!declaration || Object.keys(declaration).sort().join(",") !== "appId,imageTag,kind,officialUrl,schemaVersion,serviceId"
    || declaration.schemaVersion !== 1 || declaration.kind !== "shared-owner-directory"
    || declaration.appId !== appId || declaration.serviceId !== serviceId
    || declaration.officialUrl !== selected.officialUrl || !isRecipeImageReference(declaration.imageTag)
    || !matchesRecipeImagePin(declaration.imageTag, image)) fail();
  const manifestBytes = read(new URL("manifest.json", app));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.id !== appId || !Array.isArray(manifest.sources) || !manifest.sources.includes(selected.officialUrl)) fail();
  const names = () => readdirSync(app).filter((name) => /^[a-z0-9][a-z0-9-]*\.(?:json|ts|js)$/.test(name)).sort();
  const sourceNames = names();
  if (sourceNames.length > 64) fail();
  const sources = sourceNames.map((name) => [name, sha(read(new URL(name, app)))]);
  if (JSON.stringify(names()) !== JSON.stringify(sourceNames)
    || sources.find(([name]) => name === "owner-directory.json")?.[1] !== sha(declarationBytes)
    || sources.find(([name]) => name === "manifest.json")?.[1] !== sha(manifestBytes)
    || JSON.stringify(runtimeNames.map((name) => [name, sha(read(new URL(name, runtime)))])) !== JSON.stringify(runtimeSources)) fail();
  return { ...selected, appId, sourceSha256: sha(JSON.stringify({ sources, runtimeSources })) };
}
export function checkedOwnerDirectoryClaim(catalog: URL, serviceId: string, image: string,
  value: unknown): OwnerDirectoryClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as OwnerDirectoryClaim;
  if (Object.keys(row).sort().join(",") !== "appId,kind,officialUrl,sourceSha256"
    || typeof row.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.appId)) fail();
  const claim = ownerDirectoryClaim(new URL(`apps/${row.appId}/`, catalog), row.appId, serviceId, image,
    { kind: row.kind, officialUrl: row.officialUrl });
  if (claim.sourceSha256 !== row.sourceSha256) fail();
  return claim;
}
/** One generated app-owned directory, never an owner-selected source or target. */
export function ownerDirectoryFields(projectDirectory: string, appId: string) {
  if (!isAbsolute(projectDirectory) || resolve(projectDirectory) !== projectDirectory
    || !dirname(projectDirectory).endsWith("/.selfhost/shared")
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)) fail();
  const path = join(projectDirectory, "data", appId, "stacks");
  return { path, environment: { name: "DOCKGE_STACKS_DIR", value: path },
    mount: { source: path, target: path, readOnly: false, shared: false } };
}
export function assertOwnerDirectoryService(projectDirectory: string, service: Record<string, any>,
  claim: OwnerDirectoryClaim): void {
  const fields = ownerDirectoryFields(projectDirectory, claim.appId);
  if (service.id !== claim.appId || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(service.user)
    || service.profiles !== undefined || service.runtimeResources !== undefined || !service.dockerCliTls) fail();
  const environments = service.environment.filter((row: Record<string, any>) => row.name === fields.environment.name);
  const mounts = service.mounts.filter((row: Record<string, any>) => row.source === fields.path || row.target === fields.path);
  if (environments.length !== 1 || environments[0].value !== fields.path || mounts.length !== 1
    || mounts[0].source !== fields.path || mounts[0].target !== fields.path
    || mounts[0].kind === "volume" || mounts[0].readOnly !== false || mounts[0].shared !== false
    || mounts[0].shareGroup !== undefined) fail();
}
