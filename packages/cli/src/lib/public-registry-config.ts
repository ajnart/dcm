import { createHash } from "node:crypto";

// OCI descriptors bind config bytes by digest/size; config owns os/architecture:
// https://github.com/opencontainers/image-spec/tree/v1.1.1
// Anonymous bearer pull challenge: https://distribution.github.io/distribution/spec/auth/token/

type Entry = Record<string, any>;
export type VerifiedImagePlatform = { os: "linux"; architecture: string; configDigest: string };
const maximumConfig = 1024 * 1024;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function fail(): never {
  throw new Error("Public registry image configuration is unavailable or invalid; private/unsupported registry authentication is not imported");
}

function checkedDescriptor(descriptor: Entry): void {
  if (!descriptor || typeof descriptor.digest !== "string" || !digestPattern.test(descriptor.digest)
    || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > maximumConfig
    || !["application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"].includes(descriptor.mediaType)) fail();
}

/** Exact blob bytes, never serialized JSON, establish image platform provenance. */
export function verifyRegistryImageConfig(bytes: Uint8Array, descriptor: Entry): VerifiedImagePlatform {
  checkedDescriptor(descriptor);
  if (bytes.byteLength !== descriptor.size
    || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== descriptor.digest) fail();
  let value: Entry;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail(); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.os !== "linux" || !["amd64", "arm64"].includes(value.architecture)) {
    throw new Error("Catalog image configuration does not identify a supported Linux architecture");
  }
  return { os: "linux", architecture: value.architecture, configDigest: descriptor.digest };
}

function registryLocation(reference: string): { origin: string; repository: string; service: string; realm: string | null } {
  let name = reference.split("@")[0]!;
  const colon = name.lastIndexOf(":");
  if (colon > name.lastIndexOf("/")) name = name.slice(0, colon);
  const segments = name.split("/");
  let host = "registry-1.docker.io";
  if (segments.length > 1 && /[.:]|^localhost$/.test(segments[0]!)) host = segments.shift()!;
  if (["docker.io", "index.docker.io"].includes(host)) host = "registry-1.docker.io";
  if (host === "registry-1.docker.io" && segments.length === 1) segments.unshift("library");
  if (!["registry-1.docker.io", "ghcr.io", "atdr.meo.ws", "lscr.io", "quay.io", "registry.k8s.io"].includes(host)
    || segments.length === 0 || segments.some((segment) => !/^[a-z0-9]+(?:[._-]+[a-z0-9]+)*$/.test(segment))) fail();
  let realm: string | null = null;
  let service = host;
  if (host === "registry-1.docker.io") { realm = "https://auth.docker.io/token"; service = "registry.docker.io"; }
  if (host === "ghcr.io") realm = "https://ghcr.io/token";
  return { origin: `https://${host}`, repository: segments.join("/"), service, realm };
}

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (response.redirected || response.status !== 200 || !response.body) fail();
  const length = response.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maximum)) {
    await response.body.cancel();
    fail();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); fail(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function challengeRealm(challenge: string | null, expected: ReturnType<typeof registryLocation>): string {
  if (!challenge || !expected.realm || !/^Bearer\s+/i.test(challenge)) fail();
  const fields: Record<string, string> = {};
  const parameters = challenge.replace(/^Bearer\s+/i, "").split(/,\s*/);
  for (const parameter of parameters) {
    const match = /^(realm|service|scope)="([^"\\\r\n]+)"$/.exec(parameter);
    if (!match || Object.hasOwn(fields, match[1]!)) fail();
    fields[match[1]!] = match[2]!;
  }
  const scope = `repository:${expected.repository}:pull`;
  if (fields.realm !== expected.realm || fields.service !== expected.service
    || (fields.scope !== undefined && fields.scope !== scope)) fail();
  const endpoint = new URL(expected.realm);
  endpoint.searchParams.set("service", expected.service);
  endpoint.searchParams.set("scope", scope);
  return endpoint.href;
}

/** Public reads only: anonymous pull tokens for the two reviewed token realms.
 * No Docker config/session access, redirects, caller URLs, or credential fallback.
 * Return only digest-bound platform evidence, never the image config payload.
 */
export async function fetchPublicRegistryImageConfig(reference: string, descriptor: Entry,
  request: typeof fetch = fetch): Promise<VerifiedImagePlatform> {
  checkedDescriptor(descriptor);
  if (typeof reference !== "string" || !/@sha256:[a-f0-9]{64}$/.test(reference)) fail();
  const location = registryLocation(reference);
  const endpoint = `${location.origin}/v2/${location.repository}/blobs/${descriptor.digest}`;
  const headers: Record<string, string> = { Accept: "application/octet-stream" };
  const options = { redirect: "error" as const, credentials: "omit" as const, signal: AbortSignal.timeout(15_000) };
  try {
    let response = await request(endpoint, { ...options, headers });
    if (response.status === 401) {
      const tokenEndpoint = challengeRealm(response.headers.get("www-authenticate"), location);
      await response.body?.cancel();
      const tokenResponse = await request(tokenEndpoint, { ...options, headers: { Accept: "application/json" } });
      const tokenBytes = await boundedBytes(tokenResponse, 64 * 1024);
      const tokenData = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(tokenBytes));
      const token = tokenData.token ?? tokenData.access_token;
      if (typeof token !== "string" || token.length > 8192 || !/^[A-Za-z0-9_.~+/-]+=*$/.test(token)) fail();
      headers.Authorization = `Bearer ${token}`;
      response = await request(endpoint, { ...options, headers });
    }
    return verifyRegistryImageConfig(await boundedBytes(response, descriptor.size), descriptor);
  } catch {
    fail();
  }
}
