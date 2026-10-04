import { assertPrivatePath, protectPrivatePath, ownedByCurrentUser, privateMode } from "./platform-private.ts";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { SharedProjectCandidate } from "./shared-compose-project.ts";
import { createSelfhostComposeOwner } from "./selfhost-compose.ts";
import { MAX_SHARED_APPS, MAX_SHARED_SERVICES } from "./shared-project-limits.ts";
import { isManualJobService } from "./manual-job.ts";
import { canonicalOriginService, bundledCanonicalOrigin, type SharedCanonicalOriginEvidence } from "./shared-canonical-origin-settings.ts";
import { loadSharedPrivateHttpsBinding, loadSharedPrivateHttpsTransportProof,
  restoreSharedPrivateHttpsSelection } from "./shared-private-https-state.ts";
import caddyRecipe from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/caddy/recipe.json";
import { bundledPostAccountTransition } from "./shared-post-account-settings.ts";

type ProjectIdentity = {
  id: string;
  dockerContext: string;
  owner: string;
  root: string;
  directory: string;
};

export type SharedProjectCheckpoint = {
  operation: "create" | "add" | "reinstall" | "start" | "stop" | "remove" | "resume" | "transition" | "recipe-migration" | "image-transition" | "canonical-origin" | "job-probe";
  phase: "reviewed" | "prepared" | "attempted" | "completed" | "inspect-required";
  appIds: string[];
  canonicalOrigin?: SharedCanonicalOriginEvidence;
  reinstallSourceHash?: string;
};

export type SharedProjectState = {
  schemaVersion: 1;
  revision: number;
  manifestRevision: number;
  previousHash: string | null;
  project: ProjectIdentity;
  manifestHash: string;
  manifest: SharedProjectCandidate["manifest"];
  units: SharedProjectCandidate["units"];
  selectionFingerprints: SharedProjectCandidate["selectionFingerprints"];
  settings: SharedProjectCandidate["settings"];
  checkpoint: SharedProjectCheckpoint;
  recordHash: string;
};

export type SharedProjectExpected = {
  revision: number;
  manifestHash: string | null;
  checkpoint: SharedProjectCheckpoint | null;
};

const appIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const projectIdPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const hashPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^revision-([0-9]{6})\.json$/;
const maxStateBytes = 4 * 1024 * 1024;
const validatedPostAccountTransitions = new WeakMap<SharedProjectState, { recordHash: string; apps: Set<string> }>();

/** Only actual validated journal objects carry transition history, never self-asserted state copies. */
export function hasValidatedSharedPostAccountTransition(state: SharedProjectState, appId: string): boolean {
  const { recordHash, ...record } = state;
  const validated = validatedPostAccountTransitions.get(state);
  return validated?.apps.has(appId) === true && validated.recordHash === recordHash && recordHash === hash(record);
}

function recordPostAccountHistory(previous: SharedProjectState | null, next: SharedProjectState): void {
  const apps = new Set(previous ? validatedPostAccountTransitions.get(previous)?.apps : []);
  if (next.checkpoint.operation === "transition" && next.checkpoint.phase === "reviewed"
    && bundledPostAccountTransition(next.checkpoint.appIds[0]!)) {
    apps.add(next.checkpoint.appIds[0]!);
  }
  for (const appId of apps) if (!Object.hasOwn(next.units, appId)) apps.delete(appId);
  validatedPostAccountTransitions.set(next, { recordHash: next.recordHash, apps });
}

function fail(message: string): never {
  throw new Error(`Shared-project state: ${message}`);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutOwnership(value: Record<string, any>): Record<string, any> {
  const copy = structuredClone(value);
  delete copy.ownership;
  if (Array.isArray(copy.mounts)) {
    for (const mount of copy.mounts) delete mount.ownership;
  }
  return copy;
}

function checkedRetainedAdd(previous: SharedProjectState, next: SharedProjectState): void {
  const priorServices = previous.manifest.services as Array<Record<string, any>>;
  const nextServices = next.manifest.services as Array<Record<string, any>>;
  const priorNetworks = previous.manifest.networks as Array<Record<string, any>>;
  const nextNetworks = next.manifest.networks as Array<Record<string, any>>;
  if (nextServices.length <= priorServices.length || nextNetworks.length < priorNetworks.length) {
    fail("add must retain every saved service and network");
  }
  for (const [index, service] of priorServices.entries()) {
    if (!same(withoutOwnership(service), withoutOwnership(nextServices[index]!))) {
      fail("add changed a retained service definition");
    }
  }
  for (const [index, network] of priorNetworks.entries()) {
    if (!same(withoutOwnership(network), withoutOwnership(nextNetworks[index]!))) {
      fail("add changed a retained network definition");
    }
  }
}

function checkedCheckpoint(value: unknown): SharedProjectCheckpoint {
  const keys = ["operation", "phase", "appIds"];
  if ((value as SharedProjectCheckpoint)?.operation === "canonical-origin") keys.push("canonicalOrigin");
  if ((value as SharedProjectCheckpoint)?.operation === "reinstall") keys.push("reinstallSourceHash");
  if (!exactKeys(value, keys)
    || !["create", "add", "reinstall", "start", "stop", "remove", "resume", "transition", "recipe-migration", "image-transition", "canonical-origin", "job-probe"].includes(value.operation)
    || !["reviewed", "prepared", "attempted", "completed", "inspect-required"].includes(value.phase)
    || (value.phase === "prepared" && !["create", "add"].includes(value.operation))
    || !Array.isArray(value.appIds) || value.appIds.length === 0
    || value.appIds.length > MAX_SHARED_APPS
    || value.appIds.some((id: unknown) => typeof id !== "string" || !appIdPattern.test(id) || id.length > 47)
    || new Set(value.appIds).size !== value.appIds.length
    || !same(value.appIds, [...value.appIds].sort())) {
    fail("checkpoint must name sorted, distinct app IDs and a supported operation/phase");
  }
  if (value.operation === "reinstall" && (value.appIds.length !== 1 || !hashPattern.test(value.reinstallSourceHash))) {
    fail("reinstall requires one app and its validated historical source hash");
  }
  if (value.operation === "canonical-origin") {
    const evidence = value.canonicalOrigin;
    if (value.appIds.length !== 1 || !bundledCanonicalOrigin(value.appIds[0])
      || !exactKeys(evidence, ["origin", "bindingHash", "ownerRecordHash", "transportHash"])
      || typeof evidence.origin !== "string" || evidence.origin.length > 256
      || !hashPattern.test(evidence.bindingHash) || !hashPattern.test(evidence.ownerRecordHash)
      || !hashPattern.test(evidence.transportHash)) fail("canonical checkpoint requires source-owned settings and exact proof evidence");
  }
  return value as SharedProjectCheckpoint;
}

function checkedUnitChange(previous: SharedProjectState | null, next: SharedProjectState,
  removedIds: Set<string>, records: readonly SharedProjectState[] = []): void {
  const ids = Object.keys(next.units);
  if (!previous) {
    if (!same(next.checkpoint.appIds, ids.sort())) {
      fail("initial create checkpoint must name every saved app unit");
    }
    return;
  }
  const oldIds = Object.keys(previous.units);
  const removed = oldIds.filter((id) => !Object.hasOwn(next.units, id)).sort();
  const added = ids.filter((id) => !Object.hasOwn(previous.units, id)).sort();
  if (removed.length > 0 && added.length > 0) {
    fail("a revision cannot mix app addition and removal");
  }
  for (const appId of oldIds) {
    if (removed.includes(appId)) continue;
    const migrationTarget = ["recipe-migration", "image-transition"].includes(next.checkpoint.operation)
      && next.checkpoint.phase === "reviewed" && next.checkpoint.appIds.length === 1
      && next.checkpoint.appIds[0] === appId && next.manifestHash !== previous.manifestHash;
    if (!same(next.units[appId], previous.units[appId])
      || (!migrationTarget && next.selectionFingerprints[appId] !== previous.selectionFingerprints[appId])) {
      fail("saved app unit was replaced");
    }
  }
  if (removed.length > 0) {
    if (next.manifestHash === previous.manifestHash || next.checkpoint.operation !== "remove"
      || next.checkpoint.phase !== "reviewed" || !same(next.checkpoint.appIds, removed)) {
      fail("removed units need one exact reviewed remove checkpoint and a new manifest");
    }
    const removedServices = new Set(removed.flatMap((appId) => previous.units[appId]!));
    const expected = structuredClone(previous.manifest);
    // Removal renders a new retained inventory in the existing private owner.
    // Only this exact metadata normalization is allowed; service bytes remain
    // unchanged and the original files continue owning their containers.
    if (next.manifest.project.ownership === "verified-existing") {
      expected.project.ownership = "verified-existing";
      expected.observed.project = { id: previous.project.id, directory: previous.project.directory, owner: previous.project.owner };
    }
    expected.services = expected.services.filter((service: Record<string, any>) => !removedServices.has(service.id));
    const usedNetworks = new Set(expected.services.flatMap((service: Record<string, any>) => service.networks));
    const retainedNetworks = new Set(next.manifest.networks.map((network: Record<string, any>) => network.id));
    if (expected.networks.some((network: Record<string, any>) => !retainedNetworks.has(network.id)
      && usedNetworks.has(network.id))) fail("remove cannot drop a retained service network");
    expected.networks = expected.networks.filter((network: Record<string, any>) => retainedNetworks.has(network.id));
    if (!same(expected, next.manifest)) fail("remove changed retained manifest bytes beyond the exact removed services and unused networks");
    for (const appId of removed) removedIds.add(appId);
  } else if (added.length > 0) {
    if (next.checkpoint.operation === "reinstall") {
      if (added.length !== 1 || next.checkpoint.phase !== "reviewed" || !same(next.checkpoint.appIds, added)) {
        fail("reinstall must restore exactly one reviewed removed app");
      }
      const source = removedSource(records, previous, added[0]!);
      if (source.recordHash !== next.checkpoint.reinstallSourceHash) fail("reinstall historical source changed");
      const expected = sharedReinstallCandidate(previous, source, added[0]!);
      expected.manifest.observed.checkedAt = next.manifest.observed.checkedAt;
      if (!same(expected.units, next.units) || !same(expected.selectionFingerprints, next.selectionFingerprints)
        || !same(expected.manifest.services, next.manifest.services)
        || !same(expected.manifest.networks, next.manifest.networks)
        || !same(expected.manifest.project, next.manifest.project)
        || !same(expected.manifest.observed, next.manifest.observed)) fail("reinstall changed saved app or retained resources");
      return;
    }
    if (next.manifestHash === previous.manifestHash || next.checkpoint.operation !== "add"
      || next.checkpoint.phase !== "reviewed" || !same(next.checkpoint.appIds, added)
      || added.some((id) => removedIds.has(id))) {
      fail("new units need one exact reviewed add checkpoint and cannot reuse a removed ID");
    }
    checkedRetainedAdd(previous, next);
  } else if (next.checkpoint.phase === "reviewed"
    && ["add", "remove", "reinstall"].includes(next.checkpoint.operation)) {
    fail("reviewed add/remove checkpoint has no matching unit change");
  }
  if (["transition", "recipe-migration", "image-transition", "canonical-origin"].includes(next.checkpoint.operation) && next.checkpoint.phase === "reviewed"
    && next.manifestHash === previous.manifestHash) {
    fail("reviewed transition has no manifest change");
  }
  if (removed.length === 0 && added.length === 0 && next.manifestHash !== previous.manifestHash) {
    if (next.checkpoint.operation === "image-transition") {
      checkedImageTransition(previous, next);
      return;
    }
    if (next.checkpoint.operation === "canonical-origin") {
      checkedCanonicalOriginChange(previous, next);
      return;
    }
    if (next.checkpoint.operation === "recipe-migration") {
      checkedRecipeMigration(previous, next);
      return;
    }
    if (next.checkpoint.operation !== "transition" || next.checkpoint.phase !== "reviewed"
      || next.checkpoint.appIds.length !== 1) fail("changed saved unit needs one reviewed transition");
    const targetId = next.checkpoint.appIds[0]!;
    const declared = bundledPostAccountTransition(targetId);
    let declaredServiceId = declared?.serviceId;
    if (declaredServiceId && declaredServiceId !== targetId) declaredServiceId = `${targetId}-${declaredServiceId}`;
    const oldManifest = structuredClone(previous.manifest);
    const newManifest = structuredClone(next.manifest);
    // A first-account closure after fresh create renders a retained revision
    // into the already-owned directory. Allow only this exact owner metadata
    // promotion, and only alongside a bundled source-declared switch below.
    if (declared && oldManifest.project.ownership === "new"
      && newManifest.project.ownership === "verified-existing") {
      oldManifest.project.ownership = "verified-existing";
      oldManifest.observed.project = { id: previous.project.id,
        directory: previous.project.directory, owner: previous.project.owner };
    }
    const oldServices = oldManifest.services as Array<Record<string, any>>;
    const newServices = newManifest.services as Array<Record<string, any>>;
    if (oldServices.length !== newServices.length) fail("transition cannot change service inventory");
    let changes = 0;
    for (let index = 0; index < oldServices.length; index += 1) {
      const oldService = oldServices[index]!;
      const newService = newServices[index]!;
      if (same(oldService, newService)) continue;
      if (!next.units[targetId]?.includes(oldService.id)
        || oldService.id !== newService.id) fail("transition changed another app or service");
      const oldEnvironment = oldService.environment;
      const newEnvironment = newService.environment;
      if (declared?.to === null && oldService.id === declaredServiceId) {
        if (!Array.isArray(oldEnvironment) || !Array.isArray(newEnvironment)
          || oldEnvironment.filter((item) => item.name === declared.name && item.value === declared.from).length !== 1
          || !same(newEnvironment, oldEnvironment.filter((item) => item.name !== declared.name))) {
          fail("transition differs from exact source-owned environment removal");
        }
        oldService.environment = newEnvironment;
        if (!same(oldService, newService)) fail("transition changed a non-environment service field");
        changes += 1;
        continue;
      }
      if (!Array.isArray(oldEnvironment) || !Array.isArray(newEnvironment)
        || oldEnvironment.length !== newEnvironment.length) fail("transition changed environment shape");
      oldService.environment = newEnvironment;
      for (let entry = 0; entry < oldEnvironment.length; entry += 1) {
        if (same(oldEnvironment[entry], newEnvironment[entry])) continue;
        if (oldEnvironment[entry]?.name !== newEnvironment[entry]?.name
          || typeof oldEnvironment[entry]?.value !== "string"
          || typeof newEnvironment[entry]?.value !== "string") fail("transition changed environment identity");
        if (bundledCanonicalOrigin(targetId)?.environmentNames.includes(oldEnvironment[entry].name)) {
          fail("canonical environment requires the separately bound canonical-origin operation");
        }
        if (declared && (oldService.id !== declaredServiceId || oldEnvironment[entry].name !== declared.name
          || oldEnvironment[entry].value !== declared.from || newEnvironment[entry].value !== declared.to)) {
          fail("transition differs from exact source-owned post-account switch");
        }
        changes += 1;
      }
      if (!same(oldService, newService)) fail("transition changed a non-environment service field");
    }
    oldManifest.services = newServices;
    if (changes !== 1 || !same(oldManifest, newManifest)) fail("transition must change exactly one environment value");
  }
}

/** Independent chain gate: only images inside one saved app unit may change. */
function checkedImageTransition(previous: SharedProjectState, next: SharedProjectState): void {
  const appId = next.checkpoint.appIds[0]!;
  if (next.checkpoint.phase !== "reviewed" || next.checkpoint.appIds.length !== 1
    || previous.selectionFingerprints[appId] === next.selectionFingerprints[appId]) {
    fail("image transition needs one reviewed unit and a new selection fingerprint");
  }
  const expected = structuredClone(previous.manifest);
  const observed = { id: previous.project.id, directory: previous.project.directory, owner: previous.project.owner };
  if (next.manifest.project.ownership !== "verified-existing"
    || !same(next.manifest.observed.project, observed)) fail("image transition needs the exact saved project owner");
  expected.project.ownership = "verified-existing";
  expected.observed.project = observed;
  let changes = 0;
  for (const service of expected.services) {
    const saved = next.manifest.services.find((item: Record<string, any>) => item.id === service.id);
    if (!saved) fail("image transition changed service inventory");
    if (service.image === saved.image) continue;
    if (!previous.units[appId]?.includes(service.id)
      || typeof saved.image !== "string" || !/^[^\s@$]+(?::[^\s@$]+)?@sha256:[0-9a-f]{64}$/.test(saved.image)) {
      fail("image transition changed another unit or lacks an exact image pin");
    }
    service.image = saved.image;
    changes += 1;
  }
  if (changes === 0 || !same(expected, next.manifest)) fail("image transition changed non-image runtime fields");
}

/** Independent history gate: exactly bundled static canonical settings, no other mutation. */
function checkedCanonicalOriginChange(previous: SharedProjectState, next: SharedProjectState): void {
  const checkpoint = next.checkpoint;
  const evidence = checkpoint.canonicalOrigin!;
  const appId = checkpoint.appIds[0]!;
  const definition = bundledCanonicalOrigin(appId);
  if (!definition || checkpoint.phase !== "reviewed" || checkpoint.appIds.length !== 1
    || evidence.ownerRecordHash !== previous.recordHash) fail("canonical settings require one exact completed predecessor");
  const expected = structuredClone(previous.manifest);
  expected.project.ownership = "verified-existing";
  expected.observed.project = { id: previous.project.id, directory: previous.project.directory, owner: previous.project.owner };
  let serviceId = `${appId}-${definition.serviceId}`;
  if (definition.serviceId === appId) serviceId = appId;
  const index = expected.services.findIndex((service: Record<string, any>) => service.id === serviceId);
  if (index < 0 || !previous.units[appId]?.includes(serviceId)) fail("canonical settings service is outside saved unit");
  expected.services[index] = canonicalOriginService(expected.services[index], appId, evidence.origin);
  if (same(expected.services[index], previous.manifest.services[index]) || !same(expected, next.manifest)) {
    fail("canonical settings must change only the exact source-declared origin environment");
  }
}

/** Load immutable producer evidence independently; checkpoints cannot self-assert verified TLS. */
async function checkedCanonicalOriginProof(previous: SharedProjectState | null, next: SharedProjectState): Promise<void> {
  if (next.checkpoint.operation !== "canonical-origin" || next.checkpoint.phase !== "reviewed") return;
  if (!previous) fail("canonical settings need a saved predecessor");
  const evidence = next.checkpoint.canonicalOrigin!;
  const binding = await loadSharedPrivateHttpsBinding(previous.project.directory, caddyRecipe);
  const proof = await loadSharedPrivateHttpsTransportProof(previous.project.directory, previous.recordHash);
  restoreSharedPrivateHttpsSelection(previous, caddyRecipe, binding);
  const routes = binding.routes.filter((route) => route.appId === next.checkpoint.appIds[0]);
  if (binding.bindingHash !== evidence.bindingHash || proof.bindingHash !== binding.bindingHash
    || proof.projectId !== previous.project.id || proof.ownerRecordHash !== previous.recordHash
    || evidence.transportHash !== hash(proof) || proof.transportVerified !== true || routes.length !== 1
    || evidence.origin !== `https://${routes[0]!.hostname}:${binding.port}`) {
    fail("canonical settings proof differs from exact completed owner and bound HTTPS route");
  }
  const proofs = proof.proofs.filter((route) => route.appId === next.checkpoint.appIds[0]);
  if (proofs.length !== 1 || proofs[0]!.url !== evidence.origin || proofs[0]!.verified !== true
    || proofs[0]!.method !== "curl-cacert-resolve" || !hashPattern.test(proof.caSha256)
    || !Number.isInteger(proofs[0]!.httpStatus) || proofs[0]!.httpStatus! < 100
    || proofs[0]!.httpStatus! > 599) fail("canonical settings lack verified exact-origin TLS producer evidence");
}

/** The catalog review owns authorization; the chain independently limits its mutation. */
function checkedRecipeMigration(previous: SharedProjectState, next: SharedProjectState): void {
  if (next.checkpoint.phase !== "reviewed" || next.checkpoint.appIds.length !== 1) {
    fail("recipe migration needs one reviewed app unit");
  }
  const appId = next.checkpoint.appIds[0]!;
  if (previous.selectionFingerprints[appId] === next.selectionFingerprints[appId]) {
    fail("recipe migration needs a new exact selection fingerprint");
  }
  const oldManifest = structuredClone(previous.manifest);
  const newManifest = structuredClone(next.manifest);
  const observedProject = { id: previous.project.id,
    directory: previous.project.directory, owner: previous.project.owner };
  if (!["new", "verified-existing"].includes(oldManifest.project.ownership)
    || newManifest.project.ownership !== "verified-existing"
    || !same(newManifest.observed.project, observedProject)) {
    fail("recipe migration requires the exact verified existing project owner");
  }
  // Only creation-to-existing bookkeeping may accompany the additive runtime
  // change. All other identity and observation fields remain byte-exact below.
  oldManifest.project.ownership = "verified-existing";
  oldManifest.observed.project = observedProject;
  if (oldManifest.services.length !== newManifest.services.length) {
    fail("recipe migration cannot change service inventory");
  }
  let additions = 0;
  for (let index = 0; index < oldManifest.services.length; index += 1) {
    const oldService = oldManifest.services[index];
    const newService = newManifest.services[index];
    if (same(oldService, newService)) continue;
    if (oldService.id !== newService.id || !previous.units[appId]?.includes(oldService.id)
      || !Array.isArray(oldService.environment) || !Array.isArray(newService.environment)) {
      fail("recipe migration changed another app or service");
    }
    const names = new Set<string>();
    for (const entry of newService.environment) {
      if (!exactKeys(entry, ["name", "value"]) || typeof entry.name !== "string"
        || typeof entry.value !== "string" || names.has(entry.name)) {
        fail("recipe migration environment identities are invalid");
      }
      names.add(entry.name);
    }
    for (const entry of oldService.environment) {
      if (newService.environment.filter((item: Record<string, any>) => item.name === entry.name).length !== 1
        || !same(entry, newService.environment.find((item: Record<string, any>) => item.name === entry.name))) {
        fail("recipe migration cannot remove or change saved environment values");
      }
    }
    additions += newService.environment.length - oldService.environment.length;
    for (const name of bundledCanonicalOrigin(appId)?.environmentNames ?? []) {
      if (!same(oldService.environment.find((entry: Record<string, any>) => entry.name === name),
        newService.environment.find((entry: Record<string, any>) => entry.name === name))) {
        fail("canonical environment cannot bypass its bound operation through recipe migration");
      }
    }
    oldService.environment = newService.environment;
    if (!same(oldService, newService)) {
      fail("recipe migration changed images, storage, ports, privileges or credential references");
    }
  }
  if (additions < 1 || !same(oldManifest, newManifest)) {
    fail("recipe migration must add only static environment within one saved unit");
  }
}

function checkedCheckpointScope(checkpoint: SharedProjectCheckpoint,
  units: Record<string, string[]>, removedIds: Set<string>, manifest: Record<string, any>): void {
  if (checkpoint.operation === "job-probe") {
    const ids = units[checkpoint.appIds[0]!];
    const service = manifest.services.find((entry: Record<string, any>) => entry.id === ids?.[0]);
    if (checkpoint.appIds.length !== 1 || ids?.length !== 1 || !service
      || !isManualJobService(service) || !service.manualProbe) {
      fail("job-probe checkpoint needs one exact inert manual service with a declared version probe");
    }
  }
  for (const appId of checkpoint.appIds) {
    if (Object.hasOwn(units, appId)) continue;
    if ((checkpoint.operation === "remove" || checkpoint.operation === "resume")
      && removedIds.has(appId)) continue;
    fail("checkpoint names an app outside its active or removed unit scope");
  }
}

function checkedCandidate(candidate: SharedProjectCandidate): ProjectIdentity {
  const project = candidate?.manifest?.project;
  if (!exactKeys(project, ["dockerContext", "id", "owner", "root", "directory", "ownership"])
    || !projectIdPattern.test(project.id) || project.owner !== project.id
    || typeof project.dockerContext !== "string" || project.dockerContext.length === 0
    || !isAbsolute(project.root) || resolve(project.root) !== project.root
    || !project.root.endsWith("/.selfhost/shared")
    || project.directory !== join(project.root, project.id)
    || project.directory !== candidate.projectDirectory
    || !exactKeys(candidate.settings, ["uid", "gid", "timezone"])
    || !Number.isSafeInteger(candidate.settings.uid) || candidate.settings.uid <= 0
    || !Number.isSafeInteger(candidate.settings.gid) || candidate.settings.gid <= 0
    || typeof candidate.settings.timezone !== "string" || candidate.settings.timezone.length > 128
    || !candidate.units || typeof candidate.units !== "object" || Array.isArray(candidate.units)
    || !candidate.selectionFingerprints || typeof candidate.selectionFingerprints !== "object"
    || Array.isArray(candidate.selectionFingerprints)
    || !Array.isArray(candidate.manifest.services) || candidate.manifest.services.length === 0
    || candidate.manifest.services.length > MAX_SHARED_SERVICES) {
    fail("candidate identity, settings, or manifest is invalid");
  }
  try { new Intl.DateTimeFormat("en", { timeZone: candidate.settings.timezone }); }
  catch { fail("candidate timezone is invalid"); }
  const appIds = Object.keys(candidate.units);
  const fingerprints = Object.keys(candidate.selectionFingerprints);
  if (appIds.length === 0 || appIds.length > MAX_SHARED_APPS
    || !same([...appIds].sort(), [...fingerprints].sort())) {
    fail("unit map and selection fingerprints differ");
  }
  const services = new Set(candidate.manifest.services.map((service: { id: unknown }) => service.id));
  const covered = new Set<string>();
  for (const appId of appIds) {
    const ids = candidate.units[appId];
    if (!appIdPattern.test(appId) || appId.length > 47
      || !hashPattern.test(candidate.selectionFingerprints[appId])
      || !Array.isArray(ids) || ids.length === 0) {
      fail("unit map or selection fingerprint is invalid");
    }
    for (const id of ids) {
      if (typeof id !== "string" || (id !== appId && !id.startsWith(`${appId}-`))
        || !services.has(id) || covered.has(id)) {
        fail("unit map does not uniquely cover its app-scoped services");
      }
      covered.add(id);
    }
  }
  if (services.size !== candidate.manifest.services.length || covered.size !== services.size) {
    fail("unit map must cover every distinct manifest service");
  }
  return { id: project.id, dockerContext: project.dockerContext,
    owner: project.owner, root: project.root, directory: project.directory };
}

async function privateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, (info.isDirectory() ? 0o700 : 0o600));
  if (!info.isDirectory() || info.isSymbolicLink() || !privateMode(info, 0o700)
    || !ownedByCurrentUser(info)
    || await realpath(path) !== path) {
    fail(`unsafe owner-only directory: ${path}`);
  }
}

async function ownedProjectRoot(path: string): Promise<void> {
  const info = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, (info.isDirectory() ? 0o700 : 0o600));
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o022) !== 0)
    || !ownedByCurrentUser(info)
    || await realpath(path) !== path) {
    fail("shared-project root must be a current-user-owned real directory without group or world write access");
  }
}

function checkedTransition(current: SharedProjectState | null, next: SharedProjectCheckpoint,
  manifestChanged: boolean): void {
  if (!current) {
    if (next.operation !== "create" || next.phase !== "reviewed") {
      fail("initial state must be a reviewed create checkpoint");
    }
    return;
  }
  const old = current.checkpoint;
  if (old.operation === "reinstall" && next.operation === "reinstall" && !manifestChanged
    && old.reinstallSourceHash !== next.reinstallSourceHash) fail("reinstall source cannot change between checkpoints");
  if (old.operation === "canonical-origin" && next.operation === "canonical-origin"
    && !manifestChanged && !same(old.canonicalOrigin, next.canonicalOrigin)) {
    fail("canonical operation evidence cannot change between lifecycle checkpoints");
  }
  if (manifestChanged) {
    if (next.operation === "job-probe") fail("job-probe cannot change the saved manifest");
    if (old.phase !== "completed" || next.phase !== "reviewed") {
      fail("a changed manifest needs a completed prior action and a new reviewed checkpoint");
    }
    return;
  }
  if (old.phase === "reviewed" && next.phase === "attempted"
    && old.operation === next.operation && same(old.appIds, next.appIds)) return;
  if (old.phase === "reviewed" && next.phase === "prepared"
    && ["create", "add"].includes(old.operation) && old.operation === next.operation
    && same(old.appIds, next.appIds)) return;
  if (old.phase === "prepared" && next.phase === "attempted"
    && ["create", "add"].includes(old.operation) && old.operation === next.operation
    && same(old.appIds, next.appIds)) return;
  if (old.phase === "attempted" && ["completed", "inspect-required"].includes(next.phase)
    && old.operation === next.operation && same(old.appIds, next.appIds)) return;
  if (old.phase === "inspect-required" && next.phase === "reviewed"
    && next.operation === "resume" && same(old.appIds, next.appIds)) return;
  if (old.phase === "completed" && next.phase === "reviewed") return;
  fail("checkpoint transition is unsafe or out of order");
}

async function stateDirectory(projectDirectory: string, create: boolean): Promise<string> {
  if (!isAbsolute(projectDirectory) || resolve(projectDirectory) !== projectDirectory
    || !projectIdPattern.test(projectDirectory.split("/").at(-1) ?? "")
    || !dirname(projectDirectory).endsWith("/.selfhost/shared")) {
    fail("expected an exact shared Compose project directory");
  }
  await ownedProjectRoot(dirname(dirname(dirname(projectDirectory))));
  await privateDirectory(dirname(dirname(projectDirectory)));
  await privateDirectory(dirname(projectDirectory));
  await privateDirectory(projectDirectory);
  const directory = join(projectDirectory, "state");
  if (create) {
    try { await mkdir(directory, { mode: 0o700 }); protectPrivatePath(directory, 0o700); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  try { await privateDirectory(directory); }
  catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return directory;
    throw error;
  }
  return directory;
}

function recordName(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 999999) {
    fail("revision is out of range");
  }
  return `revision-${String(revision).padStart(6, "0")}.json`;
}

async function readRecord(path: string): Promise<SharedProjectState> {
  if (process.platform === "win32") assertPrivatePath(path, 0o600);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > maxStateBytes
      || !privateMode(before, 0o600)
      || !ownedByCurrentUser(before)) {
      fail(`unsafe revision file: ${path}`);
    }
    const bytes = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathInfo = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, (pathInfo.isDirectory() ? 0o700 : 0o600));
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || after.dev !== pathInfo.dev || after.ino !== pathInfo.ino || pathInfo.nlink !== 1) {
      fail(`revision changed while reading: ${path}`);
    }
    let record: unknown;
    try { record = JSON.parse(bytes); }
    catch { fail(`invalid revision JSON: ${path}`); }
    if (!exactKeys(record, ["schemaVersion", "revision", "manifestRevision", "previousHash", "project",
      "manifestHash", "manifest", "units", "selectionFingerprints", "settings", "checkpoint", "recordHash"])
      || `${JSON.stringify(record)}\n` !== bytes) {
      fail(`noncanonical or unsupported revision: ${path}`);
    }
    return record as SharedProjectState;
  } finally {
    await handle.close();
  }
}

async function readChain(directory: string, projectId: string): Promise<{
  current: SharedProjectState | null; removedIds: Set<string>; records: SharedProjectState[];
}> {
  let entries;
  try { entries = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { current: null, removedIds: new Set(), records: [] };
    throw error;
  }
  if (entries.length > 999999 || entries.some((entry) => !revisionPattern.test(entry))) {
    fail("state directory has unrecognized or interrupted entries; inspect before retrying");
  }
  entries.sort();
  let previous: SharedProjectState | null = null;
  const removedIds = new Set<string>();
  const records: SharedProjectState[] = [];
  for (const [index, entry] of entries.entries()) {
    if (entry !== recordName(index + 1)) fail("revision chain has a gap");
    const record = await readRecord(join(directory, entry));
    if (record.schemaVersion !== 1 || record.revision !== index + 1
      || !Number.isSafeInteger(record.manifestRevision) || record.manifestRevision < 1
      || (!previous && record.manifestRevision !== 1)
      || record.project?.id !== projectId || record.project.directory !== dirname(directory)
      || !hashPattern.test(record.manifestHash) || record.manifestHash !== hash(record.manifest)
      || !hashPattern.test(record.recordHash)
      || record.recordHash !== hash({ ...record, recordHash: undefined })
      || record.previousHash !== (previous?.recordHash ?? null)) {
      fail(`revision integrity or project identity mismatch: ${entry}`);
    }
    const identity = checkedCandidate({ manifest: record.manifest, units: record.units,
      selectionFingerprints: record.selectionFingerprints, settings: record.settings,
      projectDirectory: record.project.directory });
    if (!same(identity, record.project)) fail(`manifest project mismatch: ${entry}`);
    checkedCheckpoint(record.checkpoint);
    checkedTransition(previous, record.checkpoint,
      !previous || record.manifestHash !== previous.manifestHash);
    if (previous) {
      if (!same(previous.project, record.project) || !same(previous.settings, record.settings)
        || record.manifestRevision !== previous.manifestRevision + Number(record.manifestHash !== previous.manifestHash)) {
        fail(`project settings or manifest revision changed unexpectedly: ${entry}`);
      }
    }
    checkedUnitChange(previous, record, removedIds, records);
    await checkedCanonicalOriginProof(previous, record);
    recordPostAccountHistory(previous, record);
    checkedCheckpointScope(record.checkpoint, record.units, removedIds, record.manifest);
    records.push(record);
    previous = record;
  }
  return { current: previous, removedIds, records };
}

/** Recovery may inspect only the completed predecessor of an exact pre-Docker review. */
export async function loadSharedReviewedMigrationOrigin(projectDirectory: string, projectId: string,
  expectedRecordHash: string, appId: string,
  operation: "recipe-migration" | "image-transition" = "recipe-migration"): Promise<SharedProjectState> {
  if (!projectIdPattern.test(projectId) || projectDirectory.split("/").at(-1) !== projectId
    || !hashPattern.test(expectedRecordHash) || !appIdPattern.test(appId)) {
    fail("reviewed migration recovery identity is invalid");
  }
  const directory = await stateDirectory(projectDirectory, false);
  const { current, records } = await readChain(directory, projectId);
  const origin = records.at(-2);
  if (!current || current.recordHash !== expectedRecordHash
    || current.checkpoint.operation !== operation || current.checkpoint.phase !== "reviewed"
    || !same(current.checkpoint.appIds, [appId]) || !origin
    || origin.checkpoint.phase !== "completed" || current.previousHash !== origin.recordHash) {
    fail("recovery requires one exact reviewed migration before any Docker attempt");
  }
  return origin;
}

/** Only an exact reviewed canonical operation has pre-Docker recovery authority. */
export async function loadSharedReviewedCanonicalOrigin(projectDirectory: string, projectId: string,
  expectedRecordHash: string, appId: string): Promise<SharedProjectState> {
  if (!projectIdPattern.test(projectId) || projectDirectory.split("/").at(-1) !== projectId
    || !hashPattern.test(expectedRecordHash) || !appIdPattern.test(appId)) fail("canonical recovery identity is invalid");
  const directory = await stateDirectory(projectDirectory, false);
  const { current, records } = await readChain(directory, projectId);
  const origin = records.at(-2);
  if (!current || current.recordHash !== expectedRecordHash || current.checkpoint.operation !== "canonical-origin"
    || current.checkpoint.phase !== "reviewed" || !same(current.checkpoint.appIds, [appId])
    || !origin || origin.checkpoint.phase !== "completed" || current.previousHash !== origin.recordHash) {
    fail("canonical recovery requires exact reviewed state before any Docker attempt");
  }
  return origin;
}

/** Recover removal's original owner only before its attempted checkpoint.
 * The reviewed inventory is already retained-only, but no container removal
 * has authority to run until the following attempted record is durable. */
export async function loadReviewedSharedRemovalSource(current: SharedProjectState): Promise<SharedProjectState> {
  const directory = await stateDirectory(current.project.directory, false);
  const { current: latest, records } = await readChain(directory, current.project.id);
  const source = records.at(-2);
  if (!latest || latest.recordHash !== current.recordHash
    || latest.checkpoint.operation !== "remove" || latest.checkpoint.phase !== "reviewed"
    || !source || source.checkpoint.phase !== "completed" || latest.previousHash !== source.recordHash) {
    fail("removal recovery requires exact reviewed state before any container removal attempt");
  }
  return source;
}

/** Recover the retained owner only before a prepared add has attempted Docker. */
export async function loadPreparedSharedAddSource(current: SharedProjectState): Promise<SharedProjectState> {
  const directory = await stateDirectory(current.project.directory, false);
  const chain = await readChain(directory, current.project.id);
  const latest = chain.current;
  const reviewed = chain.records.at(-2);
  const source = chain.records.at(-3);
  if (!latest || latest.recordHash !== current.recordHash
    || latest.checkpoint.operation !== "add" || latest.checkpoint.phase !== "prepared"
    || !reviewed || reviewed.checkpoint.operation !== "add" || reviewed.checkpoint.phase !== "reviewed"
    || !same(reviewed.checkpoint.appIds, latest.checkpoint.appIds)
    || reviewed.manifestHash !== latest.manifestHash || reviewed.manifestRevision !== latest.manifestRevision
    || latest.previousHash !== reviewed.recordHash
    || !source || source.checkpoint.phase !== "completed" || reviewed.previousHash !== source.recordHash) {
    fail("add recovery requires exact prepared state before any Docker attempt");
  }
  return source;
}

/** Authority follows an actual prepared app introduction, not transient lifecycle revisions. */
export async function loadSharedPrestartAuthoritySource(current: SharedProjectState,
  appId: string): Promise<SharedProjectState> {
  if (!appIdPattern.test(appId) || !Object.hasOwn(current.units, appId)) {
    fail("pre-start authority requires an installed app identity");
  }
  const directory = await stateDirectory(current.project.directory, false);
  const chain = await readChain(directory, current.project.id);
  if (!chain.current || chain.current.recordHash !== current.recordHash) {
    fail("pre-start authority requires the exact current journal record");
  }
  let introduced: number | null = null;
  for (const record of chain.records) {
    if (!Object.hasOwn(record.units, appId)) introduced = null;
    else if (introduced === null) introduced = record.revision;
  }
  const source = chain.records.find((record) => introduced !== null && record.revision >= introduced
    && ["create", "add"].includes(record.checkpoint.operation)
    && record.checkpoint.phase === "prepared" && record.checkpoint.appIds.includes(appId));
  if (!source || source.selectionFingerprints[appId] !== current.selectionFingerprints[appId]
    || !same(source.units[appId], current.units[appId])) {
    fail("pre-start authority requires a matching actual prepared app introduction");
  }
  return source;
}

/** Exact pre-Docker Caddy-only add predecessor; attempted/uncertain work cannot replay. */
export async function loadReviewedSharedPrivateHttpsAddSource(current: SharedProjectState): Promise<SharedProjectState> {
  const directory = await stateDirectory(current.project.directory, false);
  const chain = await readChain(directory, current.project.id);
  const latest = chain.current;
  const source = chain.records.at(-2);
  if (!latest || latest.recordHash !== current.recordHash || latest.checkpoint.operation !== "add"
    || latest.checkpoint.phase !== "reviewed" || !same(latest.checkpoint.appIds, ["caddy"])
    || !source || source.checkpoint.phase !== "completed" || latest.previousHash !== source.recordHash
    || Object.hasOwn(source.units, "caddy") || !same(latest.units.caddy, ["caddy"])) {
    fail("HTTPS add recovery requires exact Caddy-only reviewed state before any Docker attempt");
  }
  return source;
}

/** Projection only: callers must supply records returned by readChain. */
function composeOriginRecords(records: readonly SharedProjectState[]): Record<string, SharedProjectState> {
  const origins: Record<string, SharedProjectState> = {};
  // Cache only historical app origins referenced by reinstalls, not complete
  // prefix projections. Repeated remove/restore remains one forward pass.
  const needed = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.checkpoint.operation !== "reinstall") continue;
    const sourceHash = record.checkpoint.reinstallSourceHash!;
    let apps = needed.get(sourceHash);
    if (!apps) { apps = new Set(); needed.set(sourceHash, apps); }
    for (const appId of record.checkpoint.appIds) apps.add(appId);
  }
  const snapshots = new Map<string, Record<string, SharedProjectState>>();
  let previous: SharedProjectState | null = null;
  for (const record of records) {
    for (const appId of Object.keys(record.units)) {
      if (!previous || !Object.hasOwn(previous.units, appId)) {
        if (record.checkpoint.operation === "reinstall") {
          const source = snapshots.get(record.checkpoint.reinstallSourceHash!)?.[appId];
          if (!source) fail("reinstalled unit has no historical Compose origin");
          origins[appId] = source;
        } else origins[appId] = record;
      }
    }
    if (["transition", "recipe-migration", "image-transition", "canonical-origin"].includes(record.checkpoint.operation)
      && record.checkpoint.phase === "completed") origins[record.checkpoint.appIds[0]!] = record;
    for (const appId of Object.keys(previous?.units ?? {})) {
      if (!Object.hasOwn(record.units, appId)) delete origins[appId];
    }
    const required = needed.get(record.recordHash);
    if (required) {
      const snapshot: Record<string, SharedProjectState> = {};
      for (const appId of required) if (origins[appId]) snapshot[appId] = origins[appId]!;
      snapshots.set(record.recordHash, snapshot);
    }
    previous = record;
  }
  return origins;
}

function removedSource(records: readonly SharedProjectState[], current: SharedProjectState,
  appId: string): SharedProjectState {
  if (!appIdPattern.test(appId) || current.checkpoint.phase !== "completed" || Object.hasOwn(current.units, appId)
    || records.at(-1)?.recordHash !== current.recordHash) fail("reinstall needs one completed exact owner and an absent app");
  let source: SharedProjectState | null = null;
  let removedAt = -1;
  for (let index = 1; index < records.length; index++) {
    if (Object.hasOwn(records[index - 1]!.units, appId) && !Object.hasOwn(records[index]!.units, appId)) {
      source = records[index - 1]!;
      removedAt = index;
    }
  }
  if (!source || source.checkpoint.phase !== "completed"
    || !records.slice(removedAt).some((record) => record.checkpoint.operation === "remove"
      && record.checkpoint.phase === "completed" && record.checkpoint.appIds.includes(appId))) {
    fail("reinstall requires an acknowledged completed removal, not uncertain or unowned resources");
  }
  return source;
}

/** Exact saved bytes plus verified-existing resource metadata; never recompiles or prepares an app. */
export function sharedReinstallCandidate(current: SharedProjectState, source: SharedProjectState,
  appId: string): SharedProjectCandidate {
  if (!same(current.project, source.project) || !same(current.settings, source.settings)
    || Object.hasOwn(current.units, appId) || !Object.hasOwn(source.units, appId)) fail("reinstall source belongs to another owner or active app");
  const manifest = structuredClone(current.manifest);
  manifest.project.ownership = "verified-existing";
  manifest.observed.project = { id: current.project.id, directory: current.project.directory, owner: current.project.owner };
  const ids = source.units[appId]!;
  const restored = source.manifest.services.filter((service: Record<string, any>) => ids.includes(service.id));
  const occupied = new Set(manifest.services.flatMap((service: Record<string, any>) =>
    service.ports.map((port: Record<string, any>) => `${port.protocol}:${port.published}`)));
  if (restored.length !== ids.length || restored.some((service: Record<string, any>) =>
    manifest.services.some((retained: Record<string, any>) => retained.id === service.id)
    || service.ports.some((port: Record<string, any>) => occupied.has(`${port.protocol}:${port.published}`)))) {
    fail("reinstall conflicts with a retained service or exact saved port");
  }
  manifest.services.push(...structuredClone(restored));
  for (const service of manifest.services) {
    service.ownership = "verified-existing";
    for (const mount of service.mounts) mount.ownership = "verified-existing";
  }
  const required = new Set(restored.flatMap((service: Record<string, any>) => service.networks));
  for (const network of source.manifest.networks) {
    if (!required.has(network.id)) continue;
    const existing = manifest.networks.find((item: Record<string, any>) => item.id === network.id);
    if (existing && !same(withoutOwnership(existing), withoutOwnership(network))) fail("reinstall network differs from the saved owner");
    if (!existing) manifest.networks.push(structuredClone(network));
  }
  for (const network of manifest.networks) network.ownership = "verified-existing";
  const volumeNames = [...new Set(manifest.services.flatMap((service: Record<string, any>) =>
    service.mounts.filter((mount: Record<string, any>) => mount.kind === "volume")
      .map((mount: Record<string, any>) => mount.name)))] as string[];
  const paths = [...new Set(manifest.services.flatMap((service: Record<string, any>) =>
    service.mounts.filter((mount: Record<string, any>) => mount.kind !== "volume")
      .map((mount: Record<string, any>) => mount.source)))] as string[];
  manifest.observed = { checkedAt: current.manifest.observed.checkedAt,
    project: { id: current.project.id, directory: current.project.directory, owner: current.project.owner },
    paths: paths.map((path) => ({ path, owner: current.project.id })),
    ports: current.manifest.services.flatMap((service: Record<string, any>) => service.ports
      .map((port: Record<string, any>) => ({ hostIp: port.hostIp, published: port.published,
        protocol: port.protocol, owner: current.project.id }))),
    networks: manifest.networks.map((network: Record<string, any>) => ({ name: network.name, owner: current.project.id })),
    volumes: volumeNames.map((name) => ({ name, driver: "local", owner: current.project.id,
      labels: { "com.docker.compose.project": current.project.id, "com.docker.compose.volume": name,
        "io.selfhost.project": current.project.id, "io.selfhost.volume": name.slice(current.project.id.length + 1) } })) };
  return { manifest, projectDirectory: current.project.directory, settings: { ...current.settings },
    units: { ...current.units, [appId]: [...ids] },
    selectionFingerprints: { ...current.selectionFingerprints, [appId]: source.selectionFingerprints[appId]! } };
}

/** Historical snapshots come only from this owner-checked chain; callers cannot supply authority JSON. */
export async function loadSharedRemovedAppSource(current: SharedProjectState, appId: string):
  Promise<{ source: SharedProjectState; composeOrigin: SharedProjectState }> {
  const directory = await stateDirectory(current.project.directory, false);
  const chain = await readChain(directory, current.project.id);
  const source = removedSource(chain.records, current, appId);
  const index = chain.records.findIndex((record) => record.recordHash === source.recordHash);
  const composeOrigin = composeOriginRecords(chain.records.slice(0, index + 1))[appId];
  if (!composeOrigin) fail("removed app has no verified historical Compose origin");
  return { source, composeOrigin };
}

/** Finds each active unit's creation or completed recreation record in the validated chain. */
export async function loadSharedUnitComposeOriginStates(projectDirectory: string, projectId: string,
  expectedRecordHash: string): Promise<Record<string, SharedProjectState>> {
  if (!projectIdPattern.test(projectId) || projectDirectory.split("/").at(-1) !== projectId
    || !hashPattern.test(expectedRecordHash)) fail("expected project identity or record hash is invalid");
  const directory = await stateDirectory(projectDirectory, false);
  const { current, records } = await readChain(directory, projectId);
  if (!current || current.recordHash !== expectedRecordHash) fail("saved record hash differs from expected revision");
  return composeOriginRecords(records);
}

/** Removed IDs remain reserved because their data and ownership resources survive. */
export async function loadSharedRemovedAppIds(projectDirectory: string, projectId: string,
  expectedRecordHash: string): Promise<readonly string[]> {
  if (!projectIdPattern.test(projectId) || projectDirectory.split("/").at(-1) !== projectId
    || !hashPattern.test(expectedRecordHash)) fail("expected project identity or record hash is invalid");
  const directory = await stateDirectory(projectDirectory, false);
  const { current, removedIds } = await readChain(directory, projectId);
  if (!current || current.recordHash !== expectedRecordHash) fail("saved record hash differs from expected revision");
  return [...removedIds].sort();
}

export async function loadSharedUnitComposeOrigins(projectDirectory: string, projectId: string,
  expectedRecordHash?: string): Promise<Record<string, string>> {
  if (!projectIdPattern.test(projectId) || projectDirectory.split("/").at(-1) !== projectId
    || (expectedRecordHash !== undefined && !hashPattern.test(expectedRecordHash))) {
    fail("expected project identity or record hash is invalid");
  }
  const directory = await stateDirectory(projectDirectory, false);
  const { current, records } = await readChain(directory, projectId);
  if (expectedRecordHash !== undefined && current?.recordHash !== expectedRecordHash) {
    fail("saved record hash differs from the expected revision");
  }
  if (!current) return {};

  const sourceRecords = composeOriginRecords(records);

  const targets: Record<string, string> = {};
  const checked = new Map<number, string>();
  for (const appId of Object.keys(current.units)) {
    const source = sourceRecords[appId];
    if (!source) fail(`no saved Compose origin for ${appId}`);
    let target = checked.get(source.manifestRevision);
    if (!target) {
      const owner = createSelfhostComposeOwner(source.manifest);
      const plan = await owner.plan();
      await owner.checkRendered(plan);
      target = plan.render.target;
      checked.set(source.manifestRevision, target);
    }
    targets[appId] = target;
  }
  return targets;
}

/** Reads an owner-only, append-only state chain. It never reads secret payloads or contacts Docker. */
export async function loadSharedProjectState(projectDirectory: string, projectId: string,
  expectedManifestHash?: string): Promise<SharedProjectState | null> {
  if (!projectIdPattern.test(projectId) || projectDirectory.split("/").at(-1) !== projectId
    || (expectedManifestHash !== undefined && !hashPattern.test(expectedManifestHash))) {
    fail("expected project identity or manifest hash is invalid");
  }
  const directory = await stateDirectory(projectDirectory, false);
  const { current } = await readChain(directory, projectId);
  if (current && expectedManifestHash !== undefined && current.manifestHash !== expectedManifestHash) {
    fail("saved manifest hash differs from the expected reviewed manifest");
  }
  return current;
}

/** CAS append. The caller owns review/approval and must checkpoint before any external mutation. */
export async function saveSharedProjectState(candidate: SharedProjectCandidate,
  checkpoint: SharedProjectCheckpoint, expected: SharedProjectExpected): Promise<SharedProjectState> {
  const project = checkedCandidate(candidate);
  checkedCheckpoint(checkpoint);
  if (!exactKeys(expected, ["revision", "manifestHash", "checkpoint"])
    || !Number.isSafeInteger(expected.revision) || expected.revision < 0
    || (expected.manifestHash !== null && !hashPattern.test(expected.manifestHash))) {
    fail("compare-and-set expectation is invalid");
  }
  if (expected.revision === 0 && (expected.manifestHash !== null || expected.checkpoint !== null)) {
    fail("initial compare-and-set expectation must be empty");
  }
  await createSelfhostComposeOwner(candidate.manifest).plan();
  const directory = await stateDirectory(candidate.projectDirectory, true);
  const { current, removedIds, records } = await readChain(directory, project.id);
  if ((current?.revision ?? 0) !== expected.revision
    || (current?.manifestHash ?? null) !== expected.manifestHash
    || !same(current?.checkpoint ?? null, expected.checkpoint)) {
    fail("compare-and-set revision, manifest hash, or checkpoint changed; inspect before retrying");
  }
  if (current) {
    if (!same(current.project, project) || !same(current.settings, candidate.settings)) {
      fail("candidate changed the saved project identity or common settings");
    }
  }
  const manifestHash = hash(candidate.manifest);
  checkedTransition(current, checkpoint, !current || current.manifestHash !== manifestHash);
  const next = {
    schemaVersion: 1 as const,
    revision: (current?.revision ?? 0) + 1,
    manifestRevision: (current?.manifestRevision ?? 0) + Number(!current || current.manifestHash !== manifestHash),
    previousHash: current?.recordHash ?? null,
    project, manifestHash, manifest: candidate.manifest,
    units: candidate.units, selectionFingerprints: candidate.selectionFingerprints,
    settings: candidate.settings, checkpoint,
  };
  const record: SharedProjectState = { ...next, recordHash: hash(next) };
  checkedUnitChange(current, record, removedIds, records);
  await checkedCanonicalOriginProof(current, record);
  checkedCheckpointScope(checkpoint, record.units, removedIds, record.manifest);
  const bytes = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(bytes) > maxStateBytes) fail("revision exceeds size limit");
  const temporary = join(directory, `.revision-${randomUUID()}.tmp`);
  const target = join(directory, recordName(record.revision));
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    protectPrivatePath(temporary, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail("compare-and-set revision was written concurrently; inspect before retrying");
    }
    throw error;
  } finally {
    await unlink(temporary);
  }
  if (process.platform !== "win32") {
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); }
    finally { await directoryHandle.close(); }
  }
  recordPostAccountHistory(current, record);
  return record;
}
