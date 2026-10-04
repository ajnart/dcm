import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { matchesRecipeImagePin } from "./recipe-image-reference.ts";

export type DockerCliTlsEndpoint = { serverName: string; privateIpv4: string; port: number };
export type DockerCliTlsRequest = { officialUrl: string; caFileId: string; certificateFileId: string; keyFileId: string; endpoint: DockerCliTlsEndpoint };
export type DockerCliTlsClaim = DockerCliTlsRequest & { appId: string; sourceSha256: string };
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function fail(): never { throw new Error("Docker CLI TLS profile, credential files or source differs"); }
function exact(value: any, keys: string[]) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function read(url: URL): Buffer {
  const name = fileURLToPath(url);
  if (realpathSync(name) !== name) fail();
  const fd = openSync(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 262144 || (before.mode & 0o002) !== 0) fail();
    const bytes = readFileSync(fd);
    for (const after of [fstatSync(fd), lstatSync(name)]) {
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mode !== after.mode || before.nlink !== after.nlink
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail();
    }
    if (bytes.length !== before.size || realpathSync(name) !== name) fail();
    return bytes;
  } finally { closeSync(fd); }
}
function policySources(catalog: URL) {
  return ["docker-cli-tls.ts", "recipe-image-reference.ts"].map((name) =>
    [name, sha(read(new URL(`types/${name}`, catalog)))]);
}
function loadedCatalogDirectory(): URL {
  const own = new URL(import.meta.url);
  if (own.pathname.endsWith(".ts")) return new URL("../", own);
  // Bundling moves import.meta.url to the executing adapter or owner. Read
  // canonical policy copies from that installed catalog, never a checkout.
  if (/\/workflows\/selfhost\/references\/catalog\/apps\/[a-z0-9-]+\/[^/]+\.js$/.test(own.pathname)) {
    return new URL("../../", own);
  }
  if (/\/workflows\/(?:selfhost|selfhost-compose)\/scripts\/[^/]+\.js$/.test(own.pathname)) {
    return new URL("selfhost/references/catalog/", new URL("../../", own));
  }
  return new URL("./workflows/selfhost/references/catalog/", own);
}
const loadedCatalog = loadedCatalogDirectory();
// Capture before any claim call: loaded code may not bless changed on-disk
// policy bytes, including changes made before this process's first review.
const loadedPolicyHash = sha(JSON.stringify(policySources(loadedCatalog)));
export function checkedDockerCliTlsRequest(value: unknown): DockerCliTlsRequest {
  if (!exact(value, ["officialUrl", "caFileId", "certificateFileId", "keyFileId", "endpoint"])) fail();
  const row = value as DockerCliTlsRequest;
  if (typeof row.officialUrl !== "string" || row.officialUrl.length > 512
    || !/^https:\/\/raw\.githubusercontent\.com\/docker\/cli\/(?:[a-f0-9]{40}|v\d+\.\d+\.\d+)\/cli\/flags\/options\.go$/.test(row.officialUrl)
    || [row.caFileId, row.certificateFileId, row.keyFileId].some((id) => typeof id !== "string" || id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
    || new Set([row.caFileId, row.certificateFileId, row.keyFileId]).size !== 3
    || !exact(row.endpoint, ["serverName", "privateIpv4", "port"])) fail();
  const endpoint = row.endpoint;
  if (typeof endpoint.serverName !== "string" || endpoint.serverName.length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(endpoint.serverName)
    || typeof endpoint.privateIpv4 !== "string" || isIP(endpoint.privateIpv4) !== 4
    || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) fail();
  const octets = endpoint.privateIpv4.split(".").map(Number);
  if (!(octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168))) fail();
  return { ...row, endpoint: { ...endpoint } };
}
export function dockerCliTlsTargets(request: DockerCliTlsRequest) {
  const row = checkedDockerCliTlsRequest(request);
  return [{ fileId: row.caFileId, target: "ca.pem" }, { fileId: row.certificateFileId, target: "cert.pem" },
    { fileId: row.keyFileId, target: "key.pem" }];
}

/** A closed source-owned profile; callers cannot choose certificate filenames,
 * directories, credential bytes or additional mounts. */
export function dockerCliTlsClaim(catalog: URL, appId: string, serviceId: string, image: string, request: unknown): DockerCliTlsClaim {
  const selected = checkedDockerCliTlsRequest(request);
  if (typeof appId !== "string" || appId.length > 47 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || serviceId !== appId) fail();
  const runtimeSources = policySources(catalog);
  const runtimeHash = sha(JSON.stringify(runtimeSources));
  if (runtimeHash !== loadedPolicyHash) fail();
  const key = Symbol.for("selfhost.shared-docker-cli-tls.runtime-source.v1");
  const processState = globalThis as typeof globalThis & { [key: symbol]: Map<string, string> | undefined };
  const snapshots = processState[key] ??= new Map<string, string>();
  const prior = snapshots.get(catalog.href);
  if (prior !== undefined && prior !== runtimeHash) fail();
  snapshots.set(catalog.href, runtimeHash);
  const directory = new URL(`apps/${appId}/`, catalog);
  const bytes = read(new URL("docker-cli-tls.json", directory));
  const declaration = JSON.parse(bytes.toString("utf8"));
  if (!exact(declaration, ["schemaVersion", "kind", "appId", "serviceId", "imageTag", "officialUrl", "caFileId", "certificateFileId", "keyFileId", "sourceFiles", "endpointMapping"])
    || declaration.schemaVersion !== 1 || declaration.kind !== "shared-docker-cli-tls"
    || declaration.appId !== appId || declaration.serviceId !== serviceId || declaration.endpointMapping !== "approved-private-docker-daemon"
    || !matchesRecipeImagePin(declaration.imageTag, image)
    || ["officialUrl", "caFileId", "certificateFileId", "keyFileId"].some((key) => declaration[key] !== (selected as any)[key])
    || !Array.isArray(declaration.sourceFiles) || declaration.sourceFiles.length < 1 || declaration.sourceFiles.length > 16
    || !declaration.sourceFiles.includes("manifest.json")
    || new Set(declaration.sourceFiles).size !== declaration.sourceFiles.length
    || declaration.sourceFiles.some((name: unknown) => typeof name !== "string" || !/^[a-z][a-z0-9-]*\.(?:ts|json)$/.test(name) || name === "docker-cli-tls.json")) fail();
  const manifestBytes = read(new URL("manifest.json", directory));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.id !== appId || !manifest.sources?.includes(selected.officialUrl)) fail();
  const sources = [...declaration.sourceFiles].sort().map((name: string) => [name, sha(read(new URL(name, directory)))]);
  if (JSON.stringify(policySources(catalog)) !== JSON.stringify(runtimeSources)) fail();
  return { ...selected, appId, sourceSha256: sha(JSON.stringify({ declaration: sha(bytes), sources, implementation: runtimeSources })) };
}
export function checkedDockerCliTlsClaim(catalog: URL, serviceId: string, image: string, value: unknown): DockerCliTlsClaim {
  if (!exact(value, ["officialUrl", "caFileId", "certificateFileId", "keyFileId", "endpoint", "appId", "sourceSha256"])) fail();
  const row = value as DockerCliTlsClaim;
  const { appId, sourceSha256, ...request } = row;
  const claim = dockerCliTlsClaim(catalog, appId, serviceId, image, request);
  if (claim.sourceSha256 !== sourceSha256) fail();
  return claim;
}
