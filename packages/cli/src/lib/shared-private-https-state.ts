import { createHash, X509Certificate } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { open, realpath, lstat } from "node:fs/promises";
import { join } from "node:path";
import { planSharedPrivateHttps, sharedPrivateHttpsHostnameScope, type SharedPrivateHttpsPlan } from "./shared-private-https.ts";
import type { SharedAppSelection, SharedProjectObservation } from "./shared-compose-project.ts";
import type { SharedProjectState } from "./shared-project-state.ts";
import { hasValidatedSharedPostAccountTransition } from "./shared-project-state.ts";
import { postAccountTransitionService } from "./shared-post-account-settings.ts";
import { bundledCanonicalOrigin, canonicalOriginService } from "./shared-canonical-origin-settings.ts";
import type { SharedCanonicalTransportProof } from "./shared-canonical-origin-transition.ts";
import type { SharedHttpsProxyProfileBinding } from "./shared-https-proxy-profile.ts";

type Entry = Record<string, any>;
export type SharedPrivateHttpsBinding = {
  schemaVersion: 1;
  kind: "shared-private-https-binding";
  source: SharedProjectState;
  observation: SharedProjectObservation;
  canonicalRecipeSha256: string;
  image: string;
  port: number;
  routes: Array<{ appId: string; hostname: string }>;
  candidateManifestHash: string;
  selectionFingerprint: string;
  caddyfileSha256: string;
  proxyProfiles?: SharedHttpsProxyProfileBinding[];
  /** Omission replays historical routes without silently adding container aliases. */
  caddyRouteAliases?: "owner-front-v1";
  bindingHash: string;
};

export function sharedHttpsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(): never { throw new Error("Shared HTTPS binding differs from the exact reviewed owner, recipe, or routes"); }

function comparable(value: Entry): string {
  const copy = structuredClone(value);
  delete copy.ownership;
  for (const mount of copy.mounts ?? []) delete mount.ownership;
  return JSON.stringify(copy);
}

function replay(binding: SharedPrivateHttpsBinding, canonicalRecipe: Entry): SharedPrivateHttpsPlan {
  const keys = ["schemaVersion", "kind", "source", "observation", "canonicalRecipeSha256", "image",
    "port", "routes", "candidateManifestHash", "selectionFingerprint", "caddyfileSha256", "bindingHash"];
  if (binding && Object.hasOwn(binding, "proxyProfiles")) keys.push("proxyProfiles");
  if (binding && Object.hasOwn(binding, "caddyRouteAliases")) keys.push("caddyRouteAliases");
  if (!binding || Object.keys(binding).sort().join(",") !== keys.sort().join(",")
    || binding.schemaVersion !== 1 || binding.kind !== "shared-private-https-binding"
    || binding.canonicalRecipeSha256 !== sharedHttpsHash(canonicalRecipe)
    || (Object.hasOwn(binding, "caddyRouteAliases") && binding.caddyRouteAliases !== "owner-front-v1")) fail();
  const { bindingHash, ...record } = binding;
  if (bindingHash !== sharedHttpsHash(record)) fail();
  const plan = planSharedPrivateHttps(binding.source, canonicalRecipe, binding.image,
    binding.routes, binding.port, binding.observation, binding.caddyRouteAliases === "owner-front-v1");
  if (binding.candidateManifestHash !== sharedHttpsHash(plan.candidate.manifest)
    || binding.selectionFingerprint !== plan.candidate.selectionFingerprints.caddy
    || binding.caddyfileSha256 !== plan.caddyfileSha256) fail();
  if (plan.proxyProfiles.length > 0 || binding.proxyProfiles !== undefined) {
    if (!Array.isArray(binding.proxyProfiles) || binding.proxyProfiles.length < 1
      || JSON.stringify(binding.proxyProfiles) !== JSON.stringify(plan.proxyProfiles)) fail();
  }
  return plan;
}

/** Immutable review evidence, not an alternate desired-manifest authority. */
export function createSharedPrivateHttpsBinding(source: SharedProjectState, canonicalRecipe: Entry,
  plan: SharedPrivateHttpsPlan, observation: SharedProjectObservation): SharedPrivateHttpsBinding {
  const record = {
    schemaVersion: 1 as const, kind: "shared-private-https-binding" as const,
    source: structuredClone(source), observation: structuredClone(observation),
    canonicalRecipeSha256: sharedHttpsHash(canonicalRecipe), image: plan.caddySelection.images.caddy!,
    port: plan.caddySelection.port!, routes: plan.routes.map(({ appId, hostname }) => ({ appId, hostname })),
    candidateManifestHash: sharedHttpsHash(plan.candidate.manifest),
    selectionFingerprint: plan.candidate.selectionFingerprints.caddy!, caddyfileSha256: plan.caddyfileSha256,
    ...(plan.proxyProfiles.length > 0 && { proxyProfiles: structuredClone(plan.proxyProfiles) }),
    ...(plan.caddyRouteAliases && { caddyRouteAliases: plan.caddyRouteAliases }),
  };
  const binding = { ...record, bindingHash: sharedHttpsHash(record) };
  replay(binding, canonicalRecipe);
  if (JSON.stringify(plan.owner) !== JSON.stringify({ projectId: source.project.id, revision: source.revision,
    recordHash: source.recordHash, manifestHash: source.manifestHash })) fail();
  return binding;
}

/** Reconstruct only Caddy from reviewed inputs; never promote retained source services. */
export function restoreSharedPrivateHttpsSelection(current: SharedProjectState, canonicalRecipe: Entry,
  binding: SharedPrivateHttpsBinding): SharedAppSelection {
  const plan = replay(binding, canonicalRecipe);
  const { recordHash, ...record } = current;
  if (recordHash !== sharedHttpsHash(record) || current.manifestHash !== sharedHttpsHash(current.manifest)
    || current.revision <= binding.source.revision
    || JSON.stringify(current.project) !== JSON.stringify(binding.source.project)
    || JSON.stringify(current.settings) !== JSON.stringify(binding.source.settings)
    || current.selectionFingerprints.caddy !== binding.selectionFingerprint
    || JSON.stringify(current.units.caddy) !== '["caddy"]') fail();
  const expected = plan.candidate.manifest.services.find((service: Entry) => service.id === "caddy");
  const caddy = current.manifest.services.filter((service: Entry) => service.id === "caddy");
  if (caddy.length !== 1 || comparable(caddy[0]) !== comparable(expected)) fail();
  for (const route of plan.routes) {
    const saved = current.manifest.services.filter((service: Entry) => service.id === route.frontService);
    const source = binding.source.manifest.services.find((service: Entry) => service.id === route.frontService);
    let matches = saved.length === 1 && comparable(saved[0]) === comparable(source);
    if (!matches && saved.length === 1 && bundledCanonicalOrigin(route.appId)) {
      matches = comparable(saved[0]) === comparable(canonicalOriginService(source, route.appId, route.url));
    }
    if (!matches && saved.length === 1 && hasValidatedSharedPostAccountTransition(current, route.appId)) {
      matches = comparable(saved[0]) === comparable(postAccountTransitionService(source, route.appId));
    }
    if (!matches
      || current.selectionFingerprints[route.appId] !== binding.source.selectionFingerprints[route.appId]
      || JSON.stringify(current.units[route.appId]) !== JSON.stringify(binding.source.units[route.appId])) fail();
    const profile = plan.proxyProfiles.find((entry) => entry.profile.appId === route.appId);
    if (profile) {
      const targets = new Set([profile.profile.grpc.service, profile.profile.http.service, profile.profile.fallback.service]);
      for (const id of targets) {
        if (id === route.frontService) continue;
        const before = binding.source.manifest.services.find((entry: Entry) => entry.id === id);
        const after = current.manifest.services.filter((entry: Entry) => entry.id === id);
        if (!before || after.length !== 1 || comparable(before) !== comparable(after[0])) fail();
      }
    }
  }
  for (const network of plan.candidate.manifest.networks.filter((entry: Entry) =>
    entry.id === "front" || entry.id === "caddy-private")) {
    const actual = current.manifest.networks.filter((entry: Entry) => entry.id === network.id);
    if (actual.length !== 1 || comparable(actual[0]) !== comparable(network)) fail();
  }
  return structuredClone(plan.caddySelection);
}

const maximumPrivateBytes = 4 * 1024 * 1024;

function currentUid(): number {
  if (typeof process.getuid !== "function") fail();
  return process.getuid();
}

function checkedDirectory(stat: Stats, resolved: string, directory: string, uid: number): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() || resolved !== directory
    || (stat.mode & 0o7777) !== 0o700 || stat.uid !== uid) fail();
}

function checkedPrivateFile(stat: Stats, maximumBytes: number, uid: number): void {
  if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600
    || stat.uid !== uid || stat.size < 1 || stat.size > maximumBytes) fail();
}

function checkedRead(stat: Stats, after: Stats, bytes: Buffer): void {
  if (stat.ino !== after.ino || stat.dev !== after.dev || stat.size !== after.size
    || stat.mtimeMs !== after.mtimeMs || bytes.length !== stat.size) fail();
}

function decodedBinding(bytes: Buffer, directory: string, canonicalRecipe: Entry): SharedPrivateHttpsBinding {
  let binding: SharedPrivateHttpsBinding;
  try { binding = JSON.parse(bytes.toString("utf8")); }
  catch { fail(); }
  replay(binding, canonicalRecipe);
  if (binding.source.project.directory !== directory) fail();
  return binding;
}

async function exactDirectory(directory: string): Promise<void> {
  checkedDirectory(await lstat(directory), await realpath(directory), directory, currentUid());
}

export function sharedPrivateHttpsBindingPath(directory: string): string {
  return join(directory, "private-https-binding.json");
}

export async function readSharedHttpsPrivateFile(path: string, maximumBytes = maximumPrivateBytes): Promise<Buffer> {
  if (await realpath(path) !== path) fail();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    checkedPrivateFile(stat, maximumBytes, currentUid());
    const bytes = await file.readFile();
    const after = await file.stat();
    checkedRead(stat, after, bytes);
    return bytes;
  } finally { await file.close(); }
}

/** No overwrite: a crash may leave an invalid artifact, which requires inspection. */
export async function writeSharedHttpsPrivateFile(directory: string, name: string, bytes: Buffer): Promise<string> {
  await exactDirectory(directory);
  if (!["private-https-binding.json", "private-https-root.crt"].includes(name)
    && !/^private-https-proof-[0-9a-f]{64}\.json$/.test(name)
    && !/^private-homarr-trust-attempt-[0-9a-f]{64}\.json$/.test(name)) fail();
  if (bytes.length < 1 || bytes.length > maximumPrivateBytes) fail();
  const path = join(directory, name);
  let file;
  try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await readSharedHttpsPrivateFile(path)).equals(bytes)) fail();
    return path;
  }
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  return path;
}

/** Immutable evidence from the approved transport producer, not a CLI input file. */
export async function saveSharedPrivateHttpsTransportProof(state: SharedProjectState,
  canonicalRecipe: Entry, binding: SharedPrivateHttpsBinding,
  proof: SharedCanonicalTransportProof): Promise<{ path: string; proof: SharedCanonicalTransportProof }> {
  restoreSharedPrivateHttpsSelection(state, canonicalRecipe, binding);
  const directory = state.project.directory;
  const { loadSharedProjectState } = await import("./shared-project-state.ts");
  const latest = await loadSharedProjectState(directory, state.project.id);
  if (latest?.recordHash !== state.recordHash) fail();
  const persisted = await loadSharedPrivateHttpsBinding(directory, canonicalRecipe);
  if (state.checkpoint.phase !== "completed" || proof.projectId !== state.project.id
    || proof.ownerRecordHash !== state.recordHash || proof.bindingHash !== binding.bindingHash
    || persisted.bindingHash !== binding.bindingHash
    || proof.caExportPath !== join(directory, "private-https-root.crt")
    || proof.hostnameScope !== sharedPrivateHttpsHostnameScope(binding.routes) || proof.composeMutation !== false
    || proof.trustStoreMutation !== false || proof.dnsVerified !== false
    || proof.clientTrustVerified !== false || proof.applicationVerified !== false) fail();
  const root = await readSharedHttpsPrivateFile(proof.caExportPath, 65536);
  const cert = new X509Certificate(root);
  if (proof.caSha256 !== createHash("sha256").update(root).digest("hex")
    || !cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey)
    || Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) fail();
  if (!/^[0-9a-f]{64}$/.test(proof?.ownerRecordHash ?? "") || proof.transportVerified !== true
    || !Array.isArray(proof.proofs) || proof.proofs.length < 1
    || !proof.proofs.every((route) => route.verified === true)
    || proof.proofs.length !== binding.routes.length) fail();
  for (const route of binding.routes) {
    const matches = proof.proofs.filter((entry) => entry.appId === route.appId);
    if (matches.length !== 1 || matches[0]!.hostname !== route.hostname
      || matches[0]!.url !== `https://${route.hostname}:${binding.port}`
      || matches[0]!.method !== "curl-cacert-resolve"
      || !Number.isInteger(matches[0]!.httpStatus) || matches[0]!.httpStatus! < 100
      || matches[0]!.httpStatus! > 599 || Number.isNaN(Date.parse(matches[0]!.verifiedAt))
      || Date.parse(matches[0]!.verifiedAt) > Date.now() + 1000) fail();
  }
  const path = join(directory, `private-https-proof-${proof.ownerRecordHash}.json`);
  let existing: SharedCanonicalTransportProof | undefined;
  try { existing = await loadSharedPrivateHttpsTransportProof(directory, proof.ownerRecordHash); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing) {
    const intent = (value: SharedCanonicalTransportProof) => ({ ...value,
      proofs: value.proofs.map(({ verifiedAt, ...route }) => route) });
    if (sharedHttpsHash(intent(existing)) !== sharedHttpsHash(intent(proof))) fail();
    return { path, proof: existing };
  }
  await writeSharedHttpsPrivateFile(directory, `private-https-proof-${proof.ownerRecordHash}.json`,
    Buffer.from(JSON.stringify(proof) + "\n"));
  return { path, proof };
}

export async function loadSharedPrivateHttpsTransportProof(directory: string,
  ownerRecordHash: string): Promise<SharedCanonicalTransportProof> {
  if (!/^[0-9a-f]{64}$/.test(ownerRecordHash)) fail();
  await exactDirectory(directory);
  const bytes = await readSharedHttpsPrivateFile(join(directory, `private-https-proof-${ownerRecordHash}.json`));
  let proof: SharedCanonicalTransportProof;
  try { proof = JSON.parse(bytes.toString("utf8")); }
  catch { fail(); }
  if (proof.ownerRecordHash !== ownerRecordHash || proof.transportVerified !== true) fail();
  return proof;
}

/** Read-only current CA validation for applying settings; historical chain reads do not expire. */
export async function validateSharedPrivateHttpsTransportProof(directory: string,
  proof: SharedCanonicalTransportProof): Promise<void> {
  if (proof.caExportPath !== join(directory, "private-https-root.crt")) fail();
  const root = await readSharedHttpsPrivateFile(proof.caExportPath, 65536);
  const cert = new X509Certificate(root);
  if (proof.caSha256 !== createHash("sha256").update(root).digest("hex")
    || !cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey)
    || Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) fail();
}

/** Caller holds the existing same-owner lock across binding write and approved add. */
export async function saveSharedPrivateHttpsBinding(directory: string, binding: SharedPrivateHttpsBinding,
  canonicalRecipe: Entry): Promise<string> {
  replay(binding, canonicalRecipe);
  if (directory !== binding.source.project.directory) fail();
  return writeSharedHttpsPrivateFile(directory, "private-https-binding.json",
    Buffer.from(JSON.stringify(binding) + "\n"));
}

export async function loadSharedPrivateHttpsBinding(directory: string, canonicalRecipe: Entry): Promise<SharedPrivateHttpsBinding> {
  await exactDirectory(directory);
  const bytes = await readSharedHttpsPrivateFile(sharedPrivateHttpsBindingPath(directory));
  return decodedBinding(bytes, directory, canonicalRecipe);
}

/** Synchronous saved-recipe consumers use the same private, immutable binding contract. */
export function loadSharedPrivateHttpsBindingSync(directory: string, canonicalRecipe: Entry): SharedPrivateHttpsBinding {
  checkedDirectory(lstatSync(directory), realpathSync(directory), directory, currentUid());
  const path = sharedPrivateHttpsBindingPath(directory);
  if (realpathSync(path) !== path) fail();
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = fstatSync(file);
    checkedPrivateFile(stat, maximumPrivateBytes, currentUid());
    bytes = readFileSync(file);
    const after = fstatSync(file);
    checkedRead(stat, after, bytes);
  } finally { closeSync(file); }
  return decodedBinding(bytes, directory, canonicalRecipe);
}
