import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { dockerApiAuthorityProfile, type LoadedDockerApiAuthorityProfile } from "./docker-api-authority-profile.ts";

export const DOCKER_MANAGEMENT_DISCLOSURE = "Docker management client credentials confer host-wide Docker authority; this approval does not configure a daemon, grant socket access, or verify a connection.";
export const DOCKER_INVENTORY_DISCLOSURE = "Mutual TLS authenticates a client but does not make Docker read-only; a separately verified deny-write authorization policy is required before inventory access.";

/** Expected identities only. These owner choices are not network observations. */
export type DockerApiAuthorityInput = {
  schemaVersion: 1;
  id: string;
  owner: { projectId: string; revision: number; recordSha256: string; manifestSha256: string };
  consumer: { appId: string; recipeSha256: string; setupSha256: string;
    images: Array<{ serviceId: string; image: string }> };
  mode: "docker-management-mtls" | "docker-inventory-mtls";
  endpoint: { privateIpv4: string; port: number; serverName: string; expectedEngineId: string };
  /** Lowercase SHA-256 of DER X509 certificate bytes, not PEM text or a public-key digest. */
  identities: { peerCertificateSha256: string; caCertificateSha256: string; clientCertificateSha256: string };
  /** Opaque imported-file IDs only; never file paths, key bytes, or arbitrary secret stores. */
  credentialRefs: { ca: string; clientCertificate: string; clientKey: string };
  expectedAuthorizationPolicySha256: string | null;
  expiresAt: string;
};

export type DockerApiAuthorityPlan = {
  schemaVersion: 1;
  kind: "docker-api-authority-plan";
  state: "planned";
  input: DockerApiAuthorityInput;
  disclosure: string;
  fingerprint: string;
  approval: string;
  connectionVerified: false;
  authorizationVerified: false;
};

export type DockerApiAuthorityApproval = {
  schemaVersion: 1;
  kind: "docker-api-authority-approval";
  state: "approved-intent";
  plan: DockerApiAuthorityPlan;
  approvedAt: string;
  connectionVerified: false;
  authorizationVerified: false;
  authorityVerified: false;
  usableForApplicationSetup: false;
};

export type DockerApiAuthorityErrorCode = "invalid-input" | "unsafe-state" | "missing-intent" | "stale-intent" | "expired-intent"
  | "approval-required" | "probe-unknown" | "probe-failed" | "policy-unverified";
export class DockerApiAuthorityError extends Error {
  constructor(readonly code: DockerApiAuthorityErrorCode) {
    super(`Docker API authority ${code}; inspect exact owner prerequisites; payload withheld`);
    if (code === "expired-intent") this.message = "Retained Docker authority intent expired; startup is blocked. Intent renewal is not supported by this command; no authority was replaced and no Docker mutation occurred.";
    this.name = "DockerApiAuthorityError";
  }
}
function fail(): never { throw new DockerApiAuthorityError("invalid-input"); }

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join(",") !== keys.sort().join(",")) fail();
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) fail();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail();
  return value;
}

function now(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15) fail();
}

function privateIpv4(value: unknown): string {
  if (typeof value !== "string" || isIP(value) !== 4) fail();
  const octets = value.split(".").map(Number);
  if (!(octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168))) fail();
  return value;
}

/** Canonical field order ensures fingerprints do not depend on input object order. */
function checked(value: DockerApiAuthorityInput, nowMs: number): DockerApiAuthorityInput {
  now(nowMs);
  const input = exact(value, ["schemaVersion", "id", "owner", "consumer", "mode", "endpoint",
    "identities", "credentialRefs", "expectedAuthorizationPolicySha256", "expiresAt"]);
  const owner = exact(input.owner, ["projectId", "revision", "recordSha256", "manifestSha256"]);
  const consumer = exact(input.consumer, ["appId", "recipeSha256", "setupSha256", "images"]);
  const endpoint = exact(input.endpoint, ["privateIpv4", "port", "serverName", "expectedEngineId"]);
  const identities = exact(input.identities, ["peerCertificateSha256", "caCertificateSha256", "clientCertificateSha256"]);
  const refs = exact(input.credentialRefs, ["ca", "clientCertificate", "clientKey"]);
  if (input.schemaVersion !== 1 || !Number.isSafeInteger(owner.revision) || Number(owner.revision) < 1
    || !Number.isInteger(endpoint.port) || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535
    || typeof endpoint.serverName !== "string" || endpoint.serverName.length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(endpoint.serverName)
    || isIP(endpoint.serverName) !== 0
    || typeof endpoint.expectedEngineId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(endpoint.expectedEngineId)
    || !["docker-management-mtls", "docker-inventory-mtls"].includes(String(input.mode))) fail();
  if (typeof input.expiresAt !== "string" || !Number.isFinite(Date.parse(input.expiresAt))
    || new Date(input.expiresAt).toISOString() !== input.expiresAt || Date.parse(input.expiresAt) <= nowMs) fail();
  let policy: string | null = null;
  if (input.mode === "docker-inventory-mtls") policy = digest(input.expectedAuthorizationPolicySha256);
  else if (input.expectedAuthorizationPolicySha256 !== null) fail();
  assertDockerApiAuthorityConsumer({ consumer: { appId: id(consumer.appId) }, mode: input.mode as DockerApiAuthorityInput["mode"] });
  if (!Array.isArray(consumer.images)
    || consumer.images.length < 1 || consumer.images.length > 32) fail();
  const images = consumer.images.map((value) => {
    const entry = exact(value, ["serviceId", "image"]);
    if (typeof entry.image !== "string" || entry.image.length > 512
      || !/^[a-z0-9][a-z0-9._:/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*@sha256:[0-9a-f]{64}$/.test(entry.image)) fail();
    return { serviceId: id(entry.serviceId), image: entry.image };
  }).sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  if (new Set(images.map((entry) => entry.serviceId)).size !== images.length) fail();
  const credentialRefs = { ca: id(refs.ca), clientCertificate: id(refs.clientCertificate), clientKey: id(refs.clientKey) };
  if (new Set(Object.values(credentialRefs)).size !== 3) fail();
  return {
    schemaVersion: 1, id: id(input.id),
    owner: { projectId: id(owner.projectId), revision: Number(owner.revision),
      recordSha256: digest(owner.recordSha256), manifestSha256: digest(owner.manifestSha256) },
    consumer: { appId: id(consumer.appId), recipeSha256: digest(consumer.recipeSha256), setupSha256: digest(consumer.setupSha256), images },
    mode: input.mode as DockerApiAuthorityInput["mode"],
    endpoint: { privateIpv4: privateIpv4(endpoint.privateIpv4), port: Number(endpoint.port),
      serverName: endpoint.serverName, expectedEngineId: endpoint.expectedEngineId },
    identities: { peerCertificateSha256: digest(identities.peerCertificateSha256),
      caCertificateSha256: digest(identities.caCertificateSha256), clientCertificateSha256: digest(identities.clientCertificateSha256) },
    credentialRefs, expectedAuthorizationPolicySha256: policy, expiresAt: input.expiresAt,
  };
}

/** Bundled profile lookup only; never endpoint, credential, or application observations. */
export function assertDockerApiAuthorityConsumer(input: { consumer: { appId: string }; mode: DockerApiAuthorityInput["mode"] }): LoadedDockerApiAuthorityProfile {
  let profile: LoadedDockerApiAuthorityProfile | null;
  try { profile = dockerApiAuthorityProfile(input.consumer.appId); } catch { return fail(); }
  if (!profile || !profile.modes.includes(input.mode)) fail();
  return profile;
}

/** Current executable binding supplied by the shared owner, never saved/caller observations. */
export function assertDockerApiAuthorityBinding(input: DockerApiAuthorityInput,
  binding: DockerApiAuthorityInput["consumer"]): void {
  assertDockerApiAuthorityConsumer(input);
  const images = (rows: DockerApiAuthorityInput["consumer"]["images"]) => [...rows]
    .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  if (input.consumer.appId !== binding.appId || input.consumer.recipeSha256 !== binding.recipeSha256
    || input.consumer.setupSha256 !== binding.setupSha256
    || JSON.stringify(images(input.consumer.images)) !== JSON.stringify(images(binding.images))) fail();
}

/** Review gate: reads bundled profiles only; no DNS, TLS, Docker, secrets, or enrollment. */
export function planDockerApiAuthority(input: DockerApiAuthorityInput, nowMs: number): DockerApiAuthorityPlan {
  const canonical = checked(input, nowMs);
  const profile = assertDockerApiAuthorityConsumer(canonical);
  let disclosure = DOCKER_MANAGEMENT_DISCLOSURE;
  if (canonical.mode === "docker-inventory-mtls") disclosure = DOCKER_INVENTORY_DISCLOSURE;
  const fingerprint = createHash("sha256").update(JSON.stringify({ schemaVersion: 1,
    kind: "docker-api-authority-plan", input: canonical, disclosure, consumerSourceSha256: profile.sourceSha256 })).digest("hex");
  return { schemaVersion: 1, kind: "docker-api-authority-plan", state: "planned", input: canonical,
    disclosure, fingerprint, approval: `AUTHORITY-INTENT:${canonical.id}:${fingerprint}`,
    connectionVerified: false, authorizationVerified: false };
}

/** Accept exact review approval only. Nothing here can mint verified/usable authority. */
export function approveDockerApiAuthorityIntent(plan: DockerApiAuthorityPlan, approval: string,
  nowMs: number): DockerApiAuthorityApproval {
  exact(plan, ["schemaVersion", "kind", "state", "input", "disclosure", "fingerprint", "approval",
    "connectionVerified", "authorizationVerified"]);
  const expected = planDockerApiAuthority(plan.input, nowMs);
  for (const field of ["schemaVersion", "kind", "state", "disclosure", "fingerprint", "approval",
    "connectionVerified", "authorizationVerified"] as const) {
    if (plan[field] !== expected[field]) fail();
  }
  if (typeof approval !== "string" || approval !== expected.approval) fail();
  return { schemaVersion: 1, kind: "docker-api-authority-approval", state: "approved-intent",
    plan: expected, approvedAt: new Date(nowMs).toISOString(), connectionVerified: false,
    authorizationVerified: false, authorityVerified: false, usableForApplicationSetup: false };
}

/** Replay approved intent against the owner's current expected identities. A
 * saved record is never an authority to select a different consumer or target. */
export function assertDockerApiAuthorityIntent(input: DockerApiAuthorityInput,
  value: unknown, nowMs: number): DockerApiAuthorityApproval {
  const row = exact(value, ["schemaVersion", "kind", "state", "plan", "approvedAt", "connectionVerified",
    "authorizationVerified", "authorityVerified", "usableForApplicationSetup"]);
  if (typeof row.approvedAt !== "string" || !Number.isFinite(Date.parse(row.approvedAt))
    || new Date(row.approvedAt).toISOString() !== row.approvedAt || Date.parse(row.approvedAt) > nowMs) fail();
  const plan = planDockerApiAuthority(input, nowMs);
  const expected = approveDockerApiAuthorityIntent(plan, plan.approval, Date.parse(row.approvedAt));
  if (JSON.stringify(row) !== JSON.stringify(expected)) throw new DockerApiAuthorityError("stale-intent");
  return expected;
}
