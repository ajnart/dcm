import { assertPrivatePath, protectPrivatePath, ownedByCurrentUser, privateMode } from "./platform-private.ts";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { withAppMutationLock } from "./batch-mutation-lock.ts";
import { COMPATIBILITY_DIMENSIONS, requiredCompatibilityChecks, type CompatibilityDimension,
  type CompatibilityEvidence, type CompatibilityHomarrMode } from "./catalog-compatibility.ts";
import { isRecipeImageReference } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/recipe-image-reference.ts";

export type CompatibilityReceiptOwner = { projectFingerprint: string; revision: number; manifestHash: string };
export type CompatibilityVerifierIdentity = { id: string; sourceSha256: string; release: string };
export type VerifiedRunObservation = {
  appId: string;
  dimension: CompatibilityDimension;
  runId: string;
  checkedAt: string;
  owner: CompatibilityReceiptOwner;
  recipeSha256: string;
  images: Record<string, string>;
  subjectSha256: string;
  verifier: CompatibilityVerifierIdentity;
  checks: { id: string; result: "pass" | "fail" | "not-run" }[];
  cleanup: "not-required" | "completed" | "pending";
};
/** Supplied by the production owner from current code/selection, never receipt JSON. */
export type CompatibilityReceiptContract = Pick<VerifiedRunObservation,
  "appId" | "dimension" | "owner" | "recipeSha256" | "images" | "subjectSha256" | "verifier"> & {
    homarrMode: CompatibilityHomarrMode;
  };
type Artifact = { schemaVersion: 1; kind: "production-verifier-observation";
  homarrMode: CompatibilityHomarrMode; observation: VerifiedRunObservation };
type Pointer = { path: string; sha256: string };
type RegistryRevision = { schemaVersion: 1; revision: number; previousHash: string | null; artifact: Pointer };
type Stored = { artifact: Pointer; value: Artifact };
type Snapshot = { revision: number; registryHash: string | null; stored: Stored[]; prefixHashes: Array<string | null> };
export type CompatibilityRegistryTip = { revision: number; registryHash: string | null };

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_REVISIONS = 4096;
const MAX_ARTIFACT_BYTES = 32 * 1024;
const MODES = ["native", "tile-only", "control-plane", "not-applicable"];

function fail(message: string): never { throw new Error(`Compatibility receipts: ${message}`); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
function exact(value: unknown, keys: string[]): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function same(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right); }
function boundedId(value: unknown): value is string { return typeof value === "string" && value.length <= 64 && ID.test(value); }
function validHash(value: unknown): value is string { return typeof value === "string" && HASH.test(value); }
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return parsed;
}
function owner(value: unknown): boolean {
  return exact(value, ["projectFingerprint", "revision", "manifestHash"])
    && validHash(value.projectFingerprint) && validHash(value.manifestHash)
    && Number.isSafeInteger(value.revision) && value.revision > 0;
}
function verifier(value: unknown): boolean {
  return exact(value, ["id", "sourceSha256", "release"]) && boundedId(value.id)
    && validHash(value.sourceSha256) && typeof value.release === "string"
    && /^v?\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9][a-z0-9.-]{0,31})?$/.test(value.release);
}
function images(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 32 && entries.every(([id, image]) => boundedId(id)
    && isRecipeImageReference(image) && /@sha256:[a-f0-9]{64}$/.test(image));
}
function identity(value: any): boolean {
  return boundedId(value.appId) && COMPATIBILITY_DIMENSIONS.includes(value.dimension)
    && owner(value.owner) && validHash(value.recipeSha256) && validHash(value.subjectSha256)
    && images(value.images) && verifier(value.verifier);
}
function checkedContract(value: CompatibilityReceiptContract): void {
  if (!exact(value, ["appId", "dimension", "homarrMode", "owner", "recipeSha256", "images", "subjectSha256", "verifier"])
    || !identity(value) || !MODES.includes(value.homarrMode)) fail("current verifier contract is invalid");
}
function checkedArtifact(value: unknown): asserts value is Artifact {
  if (!exact(value, ["schemaVersion", "kind", "homarrMode", "observation"])
    || value.schemaVersion !== 1 || value.kind !== "production-verifier-observation"
    || !MODES.includes(value.homarrMode)) fail("artifact schema is invalid");
  const item = value.observation;
  if (!exact(item, ["appId", "dimension", "runId", "checkedAt", "owner", "recipeSha256", "images", "subjectSha256", "verifier", "checks", "cleanup"])
    || !identity(item) || typeof item.runId !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(item.runId)
    || /secret|credential|handoff|cookie|\.env/i.test(item.runId)
    || !Number.isFinite(timestamp(item.checkedAt)) || !["not-required", "completed", "pending"].includes(item.cleanup)
    || !Array.isArray(item.checks)) fail("observation schema is invalid");
  const required = requiredCompatibilityChecks(item.dimension, value.homarrMode);
  let previous = -1;
  if (item.checks.length > required.length) fail("check coverage exceeds its dimension");
  for (const check of item.checks) {
    if (!exact(check, ["id", "result"]) || !["pass", "fail", "not-run"].includes(check.result)) fail("check result is invalid");
    const index = required.indexOf(check.id);
    if (index <= previous) fail("checks must be unique required IDs in contract order");
    previous = index;
  }
}
function artifactPath(item: VerifiedRunObservation): string {
  return `evidence/${item.runId}/${item.appId}/${item.dimension}.json`;
}
function matches(artifact: Artifact, contract: CompatibilityReceiptContract): boolean {
  const item = artifact.observation;
  return artifact.homarrMode === contract.homarrMode && item.appId === contract.appId && item.dimension === contract.dimension
    && item.recipeSha256 === contract.recipeSha256 && item.subjectSha256 === contract.subjectSha256
    && same(item.owner, contract.owner) && same(item.images, contract.images) && same(item.verifier, contract.verifier);
}
function checkedTip(tip: CompatibilityRegistryTip): void {
  if (!exact(tip, ["revision", "registryHash"]) || !Number.isSafeInteger(tip.revision)
    || tip.revision < 0 || tip.revision > MAX_REVISIONS
    || (tip.revision === 0 && tip.registryHash !== null)
    || (tip.revision > 0 && !validHash(tip.registryHash))) fail("expected registry tip is invalid");
}
function receipt(artifact: Artifact, pointer: Pointer): CompatibilityEvidence | null {
  const item = artifact.observation;
  const observed = item.checks.filter((check) => check.result !== "not-run");
  const failed = observed.some((check) => check.result === "fail");
  const required = requiredCompatibilityChecks(item.dimension, artifact.homarrMode);
  const passed = item.checks.length === required.length && item.checks.every((check) => check.result === "pass")
    && item.cleanup !== "pending";
  if (!failed && !passed) return null;
  let result: CompatibilityEvidence["result"] = "pass";
  if (failed) result = "fail";
  return { schemaVersion: 1, appId: item.appId, dimension: item.dimension, kind: "live", result,
    checkedAt: item.checkedAt, runId: item.runId, recipeSha256: item.recipeSha256, subjectSha256: item.subjectSha256,
    images: { ...item.images }, checks: observed.map((check) => check.id), artifact: { ...pointer } };
}

async function privateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, 0o700);
  if (!info.isDirectory() || info.isSymbolicLink() || !ownedByCurrentUser(info)
    || !privateMode(info, 0o700) || await realpath(path) !== path) fail("evidence directories must be canonical owner-only 0700");
}
function checkedRootPath(root: string): void {
  if (!isAbsolute(root) || resolve(root) !== root || root === "/"
    || root.split("/").some((part) => /^\.(?:sessions|selfhost|env)|^(?:secrets|credentials)$/.test(part))) {
    fail("an explicit canonical evidence-only root is required");
  }
}
async function checkedRoot(root: string): Promise<void> {
  checkedRootPath(root);
  await privateDirectory(root);
}
/** Internal approved apply boundary only; receipt inspection never creates its root. */
export async function prepareCompatibilityEvidenceRoot(root: string): Promise<void> {
  checkedRootPath(root);
  const parent = resolve(root, "..");
  const info = await lstat(parent);
  if (process.platform === "win32") assertPrivatePath(parent, 0o700);
  if (!info.isDirectory() || info.isSymbolicLink() || !ownedByCurrentUser(info)
    || (process.platform !== "win32" && (info.mode & 0o0022) !== 0) || await realpath(parent) !== parent) {
    fail("the evidence parent must be a canonical owned directory without other writers");
  }
  try { await mkdir(root, { mode: 0o700 }); protectPrivatePath(root, 0o700); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await checkedRoot(root);
}
async function parents(root: string, relative: string, create: boolean): Promise<string> {
  let directory = root;
  for (const part of relative.split("/").slice(0, -1)) {
    directory = join(directory, part);
    if (create) {
      try { await mkdir(directory, { mode: 0o700 }); protectPrivatePath(directory, 0o700); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    await privateDirectory(directory);
  }
  return directory;
}
async function checkedRead(root: string, relative: string, maximum: number): Promise<string | null> {
  try { await parents(root, relative, false); }
  catch (error) { if (missing(error)) return null; throw error; }
  const path = join(root, relative);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (missing(error)) return null; throw error; }
  try {
    const info = await handle.stat();
    const named = await lstat(path);
    if (process.platform === "win32") assertPrivatePath(path, 0o600);
    if (!info.isFile() || info.nlink !== 1 || !ownedByCurrentUser(info) || !privateMode(info, 0o600)
      || info.size < 1 || info.size > maximum || named.isSymbolicLink() || named.ino !== info.ino || named.dev !== info.dev) fail("registry/artifact file is unsafe");
    const raw = await handle.readFile("utf8");
    const after = await handle.stat();
    const current = await lstat(path);
    if (Buffer.byteLength(raw) !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs
      || current.ino !== info.ino || current.dev !== info.dev || current.nlink !== 1) fail("registry/artifact changed during reading");
    return raw;
  } finally { await handle.close(); }
}
async function createOnly(root: string, relative: string, raw: string): Promise<void> {
  const directory = await parents(root, relative, true);
  const path = join(root, relative);
  const temporary = join(directory, `.candidate-${randomUUID()}`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const original = await handle.stat();
  try {
    protectPrivatePath(temporary, 0o600);
    await handle.writeFile(raw); await handle.sync();
    await privateDirectory(directory);
    await link(temporary, path);
  } finally {
    await handle.close();
    const current = await lstat(temporary);
    if (current.ino !== original.ino || current.dev !== original.dev) fail("temporary artifact ownership changed");
    await unlink(temporary);
  }
  if (process.platform !== "win32") {
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
}
function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { fail("registry/artifact JSON is invalid"); }
}
async function snapshot(root: string): Promise<Snapshot> {
  const state: Snapshot = { revision: 0, registryHash: null, stored: [], prefixHashes: [null] };
  const paths = new Set<string>();
  let names: string[];
  try {
    await privateDirectory(join(root, "registry"));
    names = await readdir(join(root, "registry"));
  } catch (error) { if (missing(error)) return state; throw error; }
  if (names.length > MAX_REVISIONS + 1) fail("registry file limit exceeded");
  const revisions = names.filter((name) => /^revision-\d{6}\.json$/.test(name)).sort();
  if (revisions.some((name, index) => name !== `revision-${String(index + 1).padStart(6, "0")}.json`)) {
    fail("registry revision sequence has a gap");
  }
  for (const name of revisions) {
    const next = state.revision + 1;
    const path = `registry/${name}`;
    const raw = await checkedRead(root, path, 4096);
    if (raw === null) fail("listed registry revision disappeared");
    if (next > MAX_REVISIONS) fail("registry revision limit exceeded");
    const value = parse(raw);
    if (!exact(value, ["schemaVersion", "revision", "previousHash", "artifact"])
      || value.schemaVersion !== 1 || value.revision !== next || value.previousHash !== state.registryHash
      || !exact(value.artifact, ["path", "sha256"]) || !validHash(value.artifact.sha256)
      || typeof value.artifact.path !== "string"
      || !/^evidence\/[a-z0-9][a-z0-9_.-]{0,63}\/[a-z0-9-]{1,64}\/(?:compose|setup|homarr|links|liveRestart)\.json$/.test(value.artifact.path)
      || value.artifact.path.split("/").some((part: string) => part === ".." || part === ".")
      || paths.has(value.artifact.path)) fail("registry chain/pointer is invalid");
    const artifactRaw = await checkedRead(root, value.artifact.path, MAX_ARTIFACT_BYTES);
    if (artifactRaw === null || sha(artifactRaw) !== value.artifact.sha256) fail("listed artifact is missing or its hash changed");
    const artifact = parse(artifactRaw);
    checkedArtifact(artifact);
    if (artifactPath(artifact.observation) !== value.artifact.path) fail("artifact path differs from its observation");
    state.stored.push({ artifact: value.artifact, value: artifact });
    paths.add(value.artifact.path);
    state.revision = next;
    state.registryHash = sha(raw);
    state.prefixHashes.push(state.registryHash);
  }
  return state;
}

/** Internal production-owner boundary. Not cryptographic attestation against same-owner edits. */
export async function publishCompatibilityObservation(root: string, observation: VerifiedRunObservation,
  contract: CompatibilityReceiptContract, options: { expectedRevision: number; expectedRegistryHash?: string | null }) {
  checkedContract(contract);
  const proposed: Artifact = { schemaVersion: 1, kind: "production-verifier-observation", homarrMode: contract.homarrMode, observation };
  checkedArtifact(proposed);
  if (!matches(proposed, contract)) fail("observation differs from the current production verifier contract");
  const value: Artifact = JSON.parse(canonical(proposed));
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) fail("expected registry revision is invalid");
  const expectedRevision = options.expectedRevision;
  const expectedRegistryHash = options.expectedRegistryHash;
  if (expectedRegistryHash !== undefined) checkedTip({ revision: expectedRevision, registryHash: expectedRegistryHash });
  await checkedRoot(root);
  return withAppMutationLock(root, "compatibility-evidence", async () => {
    await checkedRoot(root);
    const current = await snapshot(root);
    if (current.revision !== expectedRevision || (expectedRegistryHash !== undefined && current.registryHash !== expectedRegistryHash)) {
      fail("registry compare-and-set revision/hash changed");
    }
    const path = artifactPath(value.observation);
    const raw = `${canonical(value)}\n`;
    if (Buffer.byteLength(raw) > MAX_ARTIFACT_BYTES) fail("artifact exceeds its size bound");
    const pointer = { path, sha256: sha(raw) };
    const previous = current.stored.find((entry) => entry.artifact.path === path);
    if (previous) {
      if (!same(previous.artifact, pointer)) fail("run artifact already exists with different observations");
      return { revision: current.revision, registryHash: current.registryHash, observation: value.observation,
        artifact: pointer, receipt: receipt(value, pointer), reused: true };
    }
    if (current.revision >= MAX_REVISIONS) fail("registry revision limit exceeded");
    const existing = await checkedRead(root, path, MAX_ARTIFACT_BYTES);
    if (existing === null) await createOnly(root, path, raw);
    else if (existing !== raw) fail("unlisted artifact conflicts with the exact run");
    const revision: RegistryRevision = { schemaVersion: 1, revision: current.revision + 1,
      previousHash: current.registryHash, artifact: pointer };
    const indexRaw = `${canonical(revision)}\n`;
    await createOnly(root, `registry/revision-${String(revision.revision).padStart(6, "0")}.json`, indexRaw);
    return { revision: revision.revision, registryHash: sha(indexRaw), observation: value.observation, artifact: pointer,
      receipt: receipt(value, pointer), reused: false };
  });
}

/** Loads only publisher-indexed artifacts; never scans private owners. A caller-pinned tip detects
 * intact-prefix rollback. Local hashes/permissions do not authenticate same-owner rewrites. */
export async function loadCompatibilityReceipts(root: string, contracts: readonly CompatibilityReceiptContract[],
  options: { checkedAt: string; maximumEvidenceAgeDays?: number; expectedRegistry?: CompatibilityRegistryTip;
    requiredAnchors?: readonly CompatibilityRegistryTip[] }) {
  const checkedAt = timestamp(options.checkedAt);
  const maximumAge = options.maximumEvidenceAgeDays ?? 90;
  if (!Number.isFinite(checkedAt) || !Number.isFinite(maximumAge) || maximumAge < 0) fail("load date/freshness bound is invalid");
  let expectedRegistry: CompatibilityRegistryTip | undefined;
  if (options.expectedRegistry !== undefined) {
    checkedTip(options.expectedRegistry);
    expectedRegistry = { ...options.expectedRegistry };
  }
  const requiredAnchors: CompatibilityRegistryTip[] = [];
  if (options.requiredAnchors !== undefined) {
    if (!Array.isArray(options.requiredAnchors) || options.requiredAnchors.length > MAX_REVISIONS) {
      fail("required registry anchor list is invalid");
    }
    for (const anchor of options.requiredAnchors) {
      checkedTip(anchor);
      requiredAnchors.push({ ...anchor });
    }
  }
  const ids = new Set<string>();
  for (const contract of contracts) {
    checkedContract(contract);
    const id = `${contract.appId}:${contract.dimension}`;
    if (ids.has(id)) fail("current verifier contracts are duplicated");
    ids.add(id);
  }
  const currentContracts: CompatibilityReceiptContract[] = JSON.parse(canonical(contracts));
  await checkedRoot(root);
  const state = await snapshot(root);
  if (expectedRegistry && (state.revision !== expectedRegistry.revision || state.registryHash !== expectedRegistry.registryHash)) {
    fail("registry differs from its caller-pinned tip");
  }
  for (const anchor of requiredAnchors) {
    if (anchor.revision > state.revision || state.prefixHashes[anchor.revision] !== anchor.registryHash) {
      fail("required registry anchor is missing or changed in the hash-linked prefix");
    }
  }
  const receipts: CompatibilityEvidence[] = [];
  const observations = state.stored.map((entry) => {
    const observedAt = timestamp(entry.value.observation.checkedAt);
    const matched = currentContracts.some((contract) => matches(entry.value, contract))
      && observedAt <= checkedAt && checkedAt - observedAt <= maximumAge * 86_400_000;
    let evidence: CompatibilityEvidence | null = null;
    if (matched) evidence = receipt(entry.value, entry.artifact);
    return { observation: entry.value.observation, artifact: entry.artifact, matched, receipt: evidence };
  });
  for (const entry of observations) {
    if (entry.receipt?.result === "pass" && observations.some((other) => other.matched
      && other.observation.appId === entry.observation.appId && other.observation.dimension === entry.observation.dimension
      && other.receipt === null && timestamp(other.observation.checkedAt) >= timestamp(entry.observation.checkedAt))) {
      entry.receipt = null;
    }
    if (entry.receipt) receipts.push(entry.receipt);
  }
  return { revision: state.revision, registryHash: state.registryHash, observations, receipts };
}
