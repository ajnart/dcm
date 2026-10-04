import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { request } from "node:https";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { checkServerIdentity, type TLSSocket } from "node:tls";
import { DockerApiAuthorityError, planDockerApiAuthority, type DockerApiAuthorityInput } from "./docker-api-authority.ts";
import { checkDockerApiAuthorityDirectory, loadDockerApiAuthorityIntent,
  readDockerApiAuthorityRecord, saveDockerApiAuthorityRecord, dockerApiAuthorityProbeRecords,
  nextDockerApiAuthorityProbeRecords } from "./docker-api-authority-state.ts";
import { readSharedHttpsPrivateFile } from "./shared-private-https-state.ts";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const TIMEOUT_MS = 10000;
const MAX_BYTES = 256 * 1024;
export type DockerApiProbeReadback = { httpStatus: number; engineId: string; peerCertificateSha256: string };
export type DockerApiAuthorityObservation = {
  schemaVersion: 1;
  kind: "docker-api-connection-observation";
  fingerprint: string;
  method: "GET";
  path: "/info";
  observedAt: string;
  expiresAt: string;
  peerCertificateSha256: string;
  engineId: string;
  connectionVerified: true;
  authorizationVerified: false;
  authorityVerified: false;
  usableForApplicationSetup: boolean;
};
function failure(): DockerApiAuthorityError { return new DockerApiAuthorityError("probe-failed"); }

/** Runtime-only narrow credential read. No arbitrary URL, DNS resolution,
 * redirect, proxy, socket, request method, endpoint or certificate bypass. */
export async function requestDockerApiIdentity(directory: string, input: DockerApiAuthorityInput,
  revalidate: () => Promise<void>): Promise<DockerApiProbeReadback> {
  const result = await requestDockerApiRead(directory, input, { kind: "identity" }, revalidate);
  const info = result.body as Record<string, unknown>;
  if (!info || typeof info.ID !== "string" || info.ID !== input.endpoint.expectedEngineId) throw failure();
  return { httpStatus: 200, engineId: info.ID, peerCertificateSha256: result.peerCertificateSha256 };
}

type DockerApiRead = { kind: "identity" } | { kind: "container"; containerId: string }
  | { kind: "image"; imageId: string };
type DockerApiReadResult = { body: unknown; peerCertificateSha256: string };
/** Private fixed-route driver. Route IDs are validated before any private-file access. */
async function requestDockerApiRead(directory: string, input: DockerApiAuthorityInput,
  selection: DockerApiRead, revalidate: () => Promise<void>): Promise<DockerApiReadResult> {
  let path = "/info";
  if (selection.kind === "container") {
    if (!/^[0-9a-f]{64}$/.test(selection.containerId)) throw failure();
    path = `/containers/${selection.containerId}/json`;
  }
  if (selection.kind === "image") {
    if (!/^sha256:[0-9a-f]{64}$/.test(selection.imageId)) throw failure();
    path = `/images/${selection.imageId}/json`;
  }
  planDockerApiAuthority(input, Date.now());
  await checkDockerApiAuthorityDirectory(directory, input.owner.projectId);
  const privateDirectory = join(directory, "secrets", input.consumer.appId);
  try {
    for (const path of [join(directory, "secrets"), privateDirectory]) {
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
        || (metadata.mode & 0o7777) !== 0o700 || await realpath(path) !== path) throw failure();
    }
  } catch { throw failure(); }
  await revalidate();
  let ca: Buffer; let cert: Buffer; let key: Buffer;
  try {
    ca = await readSharedHttpsPrivateFile(join(privateDirectory, input.credentialRefs.ca), 16384);
    cert = await readSharedHttpsPrivateFile(join(privateDirectory, input.credentialRefs.clientCertificate), 16384);
    key = await readSharedHttpsPrivateFile(join(privateDirectory, input.credentialRefs.clientKey), 16384);
    for (const value of [ca, cert]) {
      if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/.test(value.toString("ascii").trim())) throw failure();
    }
    const caCertificate = new X509Certificate(ca);
    const clientCertificate = new X509Certificate(cert);
    if (hash(caCertificate.raw) !== input.identities.caCertificateSha256 || !caCertificate.ca
      || hash(clientCertificate.raw) !== input.identities.clientCertificateSha256
      || !clientCertificate.checkPrivateKey(createPrivateKey(key))) throw failure();
    for (const certificate of [caCertificate, clientCertificate]) {
      if (Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw failure();
    }
  } catch { throw failure(); }
  await revalidate();
  return new Promise((resolve, reject) => {
    let peerCertificateSha256 = "";
    const req = request({ hostname: input.endpoint.privateIpv4, port: input.endpoint.port,
      servername: input.endpoint.serverName, method: "GET", path, agent: false,
      ca, cert, key, rejectUnauthorized: true, minVersion: "TLSv1.2",
      headers: { Host: `${input.endpoint.serverName}:${input.endpoint.port}`, Accept: "application/json", "Accept-Encoding": "identity" },
      maxHeaderSize: 16384,
      checkServerIdentity(_hostname, peer) {
        if (checkServerIdentity(input.endpoint.serverName, peer)) return failure();
        if (!peer.raw || hash(peer.raw) !== input.identities.peerCertificateSha256) return failure();
        peerCertificateSha256 = hash(peer.raw);
      },
    }, (response) => {
      response.on("error", () => { clearTimeout(timer); reject(failure()); });
      const socket = response.socket as TLSSocket;
      if (response.statusCode !== 200 || socket.authorized !== true
        || peerCertificateSha256 !== input.identities.peerCertificateSha256
        || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy(failure()); req.destroy(failure()); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(failure()); req.destroy(failure()); return; }
        chunks.push(chunk);
      });
      response.on("end", async () => {
        clearTimeout(timer);
        try {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          await revalidate();
          planDockerApiAuthority(input, Date.now());
          resolve({ body, peerCertificateSha256 });
        } catch { reject(failure()); }
      });
    });
    const timer = setTimeout(() => req.destroy(failure()), TIMEOUT_MS);
    req.on("error", () => { clearTimeout(timer); reject(failure()); });
    req.end();
  });
}

function replay(input: DockerApiAuthorityInput, value: unknown, nowMs: number): DockerApiAuthorityObservation {
  const plan = planDockerApiAuthority(input, nowMs);
  const observation = value as DockerApiAuthorityObservation;
  if (!observation || Object.keys(observation).sort().join(",") !== ["schemaVersion", "kind", "fingerprint", "method", "path",
    "observedAt", "expiresAt", "peerCertificateSha256", "engineId", "connectionVerified", "authorizationVerified",
    "authorityVerified", "usableForApplicationSetup"].sort().join(",")
    || observation.schemaVersion !== 1 || observation.kind !== "docker-api-connection-observation"
    || observation.fingerprint !== plan.fingerprint || observation.method !== "GET" || observation.path !== "/info"
    || !Number.isFinite(Date.parse(observation.observedAt)) || new Date(observation.observedAt).toISOString() !== observation.observedAt
    || Date.parse(observation.observedAt) > nowMs || nowMs - Date.parse(observation.observedAt) > 300000
    || observation.expiresAt !== input.expiresAt || observation.peerCertificateSha256 !== input.identities.peerCertificateSha256
    || observation.engineId !== input.endpoint.expectedEngineId || observation.connectionVerified !== true
    || observation.authorizationVerified !== false || observation.authorityVerified !== false
    || observation.usableForApplicationSetup !== (input.mode === "docker-management-mtls")) throw failure();
  return structuredClone(observation);
}

export function dockerApiAuthorityProbeApproval(input: DockerApiAuthorityInput, nowMs: number): string {
  return `AUTHORITY-PROBE:${input.id}:${planDockerApiAuthority(input, nowMs).fingerprint}`;
}
/** Production defaults to the fixed mTLS driver. Facilities are code-owned
 * dependency injection, never CLI inputs or adapter/caller JSON assertions. */
export async function probeDockerApiAuthority(directory: string, input: DockerApiAuthorityInput, approval: string,
  facilities: { now?: () => number; revalidate(): Promise<void>;
    transport?: typeof requestDockerApiIdentity }): Promise<DockerApiAuthorityObservation> {
  const now = facilities.now ?? Date.now;
  const nowMs = now();
  const plan = planDockerApiAuthority(input, nowMs);
  if (approval !== dockerApiAuthorityProbeApproval(input, nowMs)) throw new DockerApiAuthorityError("approval-required");
  await facilities.revalidate();
  await loadDockerApiAuthorityIntent(directory, input, nowMs);
  let names = await dockerApiAuthorityProbeRecords(directory, input, nowMs);
  const existing = await readDockerApiAuthorityRecord(directory, input.owner.projectId, names.observation);
  if (existing) {
    // Validate the original observation fully before considering expiry. Unsafe
    // state is not repaired or hidden by a new probe generation.
    const prior = await loadDockerApiAuthorityObservation(directory, input,
      Date.parse((existing as DockerApiAuthorityObservation).observedAt));
    if (nowMs - Date.parse(prior.observedAt) <= 300000) return loadDockerApiAuthorityObservation(directory, input, nowMs);
    names = nextDockerApiAuthorityProbeRecords(input, nowMs, names.generation + 1);
  }
  if (await readDockerApiAuthorityRecord(directory, input.owner.projectId, names.attempt)) {
    // GET /info is a fixed read, not an uncertain mutation. A separately
    // approved retry gets a new append-only attempt; prior failures stay intact.
    names = nextDockerApiAuthorityProbeRecords(input, nowMs, names.generation + 1);
  }
  await saveDockerApiAuthorityRecord(directory, input.owner.projectId, names.attempt,
    { schemaVersion: 1, kind: "docker-api-probe-attempt", fingerprint: plan.fingerprint,
      method: "GET", path: "/info", timeoutMs: TIMEOUT_MS, maximumBytes: MAX_BYTES,
      attemptedAt: new Date(nowMs).toISOString() });
  await facilities.revalidate();
  let result: DockerApiProbeReadback;
  try { result = await (facilities.transport ?? requestDockerApiIdentity)(directory, input, facilities.revalidate); }
  catch { throw failure(); }
  await facilities.revalidate();
  await loadDockerApiAuthorityIntent(directory, input, now());
  if (result.httpStatus !== 200 || result.engineId !== input.endpoint.expectedEngineId
    || result.peerCertificateSha256 !== input.identities.peerCertificateSha256) throw failure();
  const observation: DockerApiAuthorityObservation = { schemaVersion: 1, kind: "docker-api-connection-observation",
    fingerprint: plan.fingerprint, method: "GET", path: "/info", observedAt: new Date(now()).toISOString(),
    expiresAt: input.expiresAt, peerCertificateSha256: result.peerCertificateSha256, engineId: result.engineId,
    connectionVerified: true, authorizationVerified: false, authorityVerified: false,
    usableForApplicationSetup: input.mode === "docker-management-mtls" };
  replay(input, observation, now());
  await saveDockerApiAuthorityRecord(directory, input.owner.projectId, names.observation, observation);
  return loadDockerApiAuthorityObservation(directory, input, now());
}

export async function loadDockerApiAuthorityObservation(directory: string, input: DockerApiAuthorityInput,
  nowMs: number): Promise<DockerApiAuthorityObservation> {
  await loadDockerApiAuthorityIntent(directory, input, nowMs);
  const names = await dockerApiAuthorityProbeRecords(directory, input, nowMs);
  const attempt = await readDockerApiAuthorityRecord(directory, input.owner.projectId,
    names.attempt) as Record<string, unknown> | null;
  const value = await readDockerApiAuthorityRecord(directory, input.owner.projectId,
    names.observation);
  if (!attempt || !value) throw new DockerApiAuthorityError("probe-unknown");
  const observation = replay(input, value, nowMs);
  const expected = { schemaVersion: 1, kind: "docker-api-probe-attempt",
    fingerprint: planDockerApiAuthority(input, nowMs).fingerprint, method: "GET", path: "/info",
    timeoutMs: TIMEOUT_MS, maximumBytes: MAX_BYTES, attemptedAt: attempt.attemptedAt };
  if (JSON.stringify(attempt) !== JSON.stringify(expected) || typeof attempt.attemptedAt !== "string"
    || !Number.isFinite(Date.parse(attempt.attemptedAt)) || new Date(attempt.attemptedAt).toISOString() !== attempt.attemptedAt
    || Date.parse(attempt.attemptedAt) > Date.parse(observation.observedAt)) throw failure();
  return observation;
}

/** Fixed start/setup gate: inventory intentionally cannot pass without a trusted
 * endpoint-policy verifier. mTLS and /info alone are never a read-only ACL. */
export async function requireDockerApiAuthorityForStart(directory: string, input: DockerApiAuthorityInput,
  nowMs: number): Promise<DockerApiAuthorityObservation> {
  const observation = await loadDockerApiAuthorityObservation(directory, input, nowMs);
  if (!observation.usableForApplicationSetup || input.mode === "docker-inventory-mtls") {
    throw new DockerApiAuthorityError("policy-unverified");
  }
  return observation;
}

export type DockerApiContainerImageObservation = Readonly<{
  kind: "docker-api-container-image-observation";
  authorityFingerprint: string;
  authorityMode: DockerApiAuthorityInput["mode"];
  containerId: string;
  imageId: string;
  imageReference: string;
  repoTags: readonly string[];
  repoDigests: readonly string[];
  observedAt: string;
  authorizationVerified: false;
}>;
const containerImageObservations = new WeakSet<object>();

/** Adapter-side narrow guard. The owner callback already replayed the exact
 * authority; only driver-minted live objects can cross this boundary. */
export function assertTrustedDockerContainerImageObservation(value: unknown,
  selectedContainerId: string, nowMs = Date.now()): asserts value is DockerApiContainerImageObservation {
  if (!value || typeof value !== "object" || !containerImageObservations.has(value)) throw failure();
  const observation = value as DockerApiContainerImageObservation;
  if (observation.authorityMode !== "docker-management-mtls" || observation.containerId !== selectedContainerId
    || nowMs < Date.parse(observation.observedAt) || nowMs - Date.parse(observation.observedAt) > 300000) throw failure();
}

/** Only this driver's live results are accepted; serialized caller/status JSON is not evidence. */
export function assertDockerApiContainerImageObservation(value: unknown, input: DockerApiAuthorityInput,
  selectedContainerId: string, nowMs: number): asserts value is DockerApiContainerImageObservation {
  if (!value || typeof value !== "object" || !containerImageObservations.has(value)) throw failure();
  const observation = value as DockerApiContainerImageObservation;
  const fingerprint = planDockerApiAuthority(input, nowMs).fingerprint;
  if (observation.authorityFingerprint !== fingerprint || observation.authorityMode !== input.mode
    || observation.containerId !== selectedContainerId || nowMs < Date.parse(observation.observedAt)
    || nowMs - Date.parse(observation.observedAt) > 300000) throw failure();
}

/** Code-owned facilities only; never URL/path/method inputs or caller JSON evidence.
 * Management credentials remain host-wide; these reads do not establish deny-write authorization. */
export async function observeDockerApiContainerImage(directory: string, input: DockerApiAuthorityInput,
  selectedContainerId: string, facilities: { revalidate(): Promise<void>; now?: () => number;
    transport?: typeof requestDockerApiRead }): Promise<DockerApiContainerImageObservation> {
  if (!/^[0-9a-f]{64}$/.test(selectedContainerId)) throw failure();
  const now = facilities.now ?? Date.now;
  const fingerprint = planDockerApiAuthority(input, now()).fingerprint;
  await facilities.revalidate();
  await requireDockerApiAuthorityForStart(directory, input, now());
  const read = async (selection: DockerApiRead): Promise<Record<string, unknown>> => {
    await facilities.revalidate();
    await loadDockerApiAuthorityIntent(directory, input, now());
    const result = await (facilities.transport ?? requestDockerApiRead)(directory, input, selection, facilities.revalidate);
    await facilities.revalidate();
    await loadDockerApiAuthorityIntent(directory, input, now());
    if (planDockerApiAuthority(input, now()).fingerprint !== fingerprint
      || result.peerCertificateSha256 !== input.identities.peerCertificateSha256
      || !result.body || typeof result.body !== "object" || Array.isArray(result.body)) throw failure();
    return result.body as Record<string, unknown>;
  };
  const identity = async () => {
    const body = await read({ kind: "identity" });
    if (body.ID !== input.endpoint.expectedEngineId) throw failure();
  };
  await identity();
  const container = await read({ kind: "container", containerId: selectedContainerId });
  const config = container.Config as Record<string, unknown> | undefined;
  if (container.Id !== selectedContainerId || typeof container.Image !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(container.Image) || !config || typeof config.Image !== "string"
    || config.Image.length > 512 || !/^[a-z0-9][A-Za-z0-9._:/@-]*$/.test(config.Image)) throw failure();
  const image = await read({ kind: "image", imageId: container.Image });
  let repoTags: string[] = [];
  if (image.RepoTags !== null) {
    if (!Array.isArray(image.RepoTags) || image.RepoTags.length > 128
      || image.RepoTags.some((value) => typeof value !== "string" || value.length > 512
        || !/^[a-z0-9][A-Za-z0-9._:/-]*$/.test(value))) throw failure();
    repoTags = image.RepoTags;
  }
  if (image.Id !== container.Image || !Array.isArray(image.RepoDigests) || image.RepoDigests.length > 128
    || image.RepoDigests.some((value) => typeof value !== "string" || value.length > 512
      || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$/.test(value))) throw failure();
  const current = await read({ kind: "container", containerId: selectedContainerId });
  if (current.Id !== selectedContainerId || current.Image !== container.Image
    || (current.Config as Record<string, unknown> | undefined)?.Image !== config.Image) throw failure();
  await identity();
  const observation: DockerApiContainerImageObservation = Object.freeze({
    kind: "docker-api-container-image-observation", authorityFingerprint: fingerprint,
    authorityMode: input.mode, containerId: selectedContainerId, imageId: container.Image,
    imageReference: config.Image, repoTags: Object.freeze([...new Set(repoTags)].sort()),
    repoDigests: Object.freeze([...new Set(image.RepoDigests as string[])].sort()),
    observedAt: new Date(now()).toISOString(), authorizationVerified: false,
  });
  containerImageObservations.add(observation);
  assertDockerApiContainerImageObservation(observation, input, selectedContainerId, now());
  return observation;
}
