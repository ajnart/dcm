import { assertPrivatePath, protectPrivatePath, ownedByCurrentUser, privateMode } from "./platform-private.ts";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import packageMetadata from "../../package.json";
import { loadCompatibilityReceipts, prepareCompatibilityEvidenceRoot, publishCompatibilityObservation,
  type CompatibilityReceiptContract, type CompatibilityRegistryTip } from "./compatibility-receipts.ts";
import { readSharedAcceptanceSource } from "./shared-acceptance-contract.ts";
import { SharedAcceptanceOwnerError } from "./shared-acceptance-owner.ts";
import { requireLocalSharedDockerContext } from "./shared-host-observation.ts";
import { localDockerBindSourceMatches } from "./desktop-host-observation.ts";
import { loadSharedProjectState, type SharedProjectState } from "./shared-project-state.ts";
import { sharedUnitRecipeCheck } from "./shared-unit-setup.ts";

type Entry = Record<string, any>;
export type SharedComposeCompatibilityDependencies = {
  recipeFor(appId: string): { recipe: Entry; recipeSha256: string; boundedApply: boolean };
  appFor?(appId: string): Entry;
};
export type SharedComposeCompatibilityIdentity = {
  contract: CompatibilityReceiptContract;
  anchor: CompatibilityRegistryTip;
};
type Ledger = { schemaVersion: 1; runId: string; attemptedRecordHash: string; completedRecordHash: string;
  contract: CompatibilityReceiptContract; anchor: CompatibilityRegistryTip };
const HASH = /^[a-f0-9]{64}$/;
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(message: string): never { throw new Error(`Compose compatibility: ${message}`); }
function exact(value: unknown, keys: string[]): value is Entry {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...keys].sort().join();
}
function sourceSha256(): string {
  const own = new URL(import.meta.url);
  const sources = ["shared-compose-compatibility.ts", "shared-project.ts", "selfhost-compose.ts", "shared-project-state.ts"];
  const bytes = sources.map((name) => {
    let url = new URL(`./${name}`, own);
    if (own.pathname.endsWith(".ts") && name === "shared-project.ts") url = new URL(`../${name}`, own);
    return readSharedAcceptanceSource(url);
  });
  for (const name of ["compose-project.ts", "compose-lifecycle.sh"]) {
    let url = new URL(`./workflows/selfhost-compose/scripts/${name}`, own);
    if (own.pathname.endsWith(".ts")) url = new URL(`../../../../.agents/skills/self-host/workflows/selfhost-compose/scripts/${name}`, own);
    bytes.push(readSharedAcceptanceSource(url));
  }
  return hash(bytes);
}
function contractFor(state: SharedProjectState, appId: string,
  dependencies: SharedComposeCompatibilityDependencies): CompatibilityReceiptContract {
  if (sharedUnitRecipeCheck(state, appId, dependencies.recipeFor) !== "matches-saved-selection") {
    throw new SharedAcceptanceOwnerError("saved recipe changed; review migration before acceptance", "shared-recipe-migration-required");
  }
  const info = dependencies.recipeFor(appId);
  const app = dependencies.appFor?.(appId);
  if (!HASH.test(info.recipeSha256) || app?.id !== appId || !app.homarr) fail("current catalog identity unavailable");
  const services = state.units[appId];
  if (!services?.length || services.length > 32) fail("saved service inventory unavailable");
  const images: Record<string, string> = {};
  for (const id of [...services].sort()) {
    const service = state.manifest.services.find((item: Entry) => item.id === id);
    if (!service || !/@sha256:[a-f0-9]{64}$/.test(service.image)) fail("every service needs an immutable image");
    images[id] = service.image;
  }
  let homarrMode: CompatibilityReceiptContract["homarrMode"] = "tile-only";
  if (app.homarr.integration) homarrMode = "native";
  if (app.homarr.support === "not-applicable") homarrMode = "not-applicable";
  if (appId === "homarr") homarrMode = "control-plane";
  const subjectSha256 = sourceSha256();
  return { appId, dimension: "compose", homarrMode,
    owner: { projectFingerprint: hash(state.project), revision: state.revision, manifestHash: state.manifestHash },
    recipeSha256: info.recipeSha256, images, subjectSha256,
    verifier: { id: "shared-compose-acceptance", sourceSha256: subjectSha256, release: packageMetadata.version } };
}
async function owned(path: string, directory = false): Promise<void> {
  const stat = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, (stat.isDirectory() ? 0o700 : 0o600));
  let mode = 0o600;
  if (directory) mode = 0o700;
  if (stat.isSymbolicLink() || !ownedByCurrentUser(stat) || !privateMode(stat, mode)
    || await realpath(path) !== path || (directory && !stat.isDirectory())
    || (!directory && (!stat.isFile() || stat.nlink !== 1 || stat.size > 32 * 1024))) fail("unsafe owner ledger");
}
/** No Docker, credentials, status-based fresh proof or imported receipt assertions. */
export async function readSharedComposeCompatibilityIdentity(root: string, projectId: string, appId: string,
  dependencies: SharedComposeCompatibilityDependencies): Promise<SharedComposeCompatibilityIdentity | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || appId.length > 47) fail("invalid selected app");
  const directory = join(root, ".selfhost", "shared", projectId);
  const state = await loadSharedProjectState(directory, projectId);
  if (!state || state.project.directory !== directory || state.checkpoint.phase !== "completed") fail("completed owner unavailable");
  await owned(directory, true);
  const path = join(directory, `compose-run-${appId}.json`);
  try { await owned(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let value: Ledger;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || !ownedByCurrentUser(before)
      || !privateMode(before, 0o600) || before.size > 32 * 1024) fail("unsafe owner ledger");
    value = JSON.parse(await handle.readFile("utf8"));
    const after = await handle.stat(); const named = await lstat(path);
  if (process.platform === "win32") assertPrivatePath(path, (named.isDirectory() ? 0o700 : 0o600));
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || named.ino !== before.ino || named.dev !== before.dev || named.isSymbolicLink()) fail("ledger changed");
  } finally { await handle.close(); }
  if (!exact(value, ["schemaVersion", "runId", "attemptedRecordHash", "completedRecordHash", "contract", "anchor"])
    || value.schemaVersion !== 1 || !/^[0-9a-f-]{36}$/.test(value.runId)
    || !HASH.test(value.attemptedRecordHash) || !HASH.test(value.completedRecordHash)
    || !exact(value.anchor, ["revision", "registryHash"]) || !Number.isSafeInteger(value.anchor.revision)
    || value.anchor.revision < 1 || value.anchor.revision > 4096 || !HASH.test(value.anchor.registryHash!)) fail("invalid owner chronology");
  const contract = contractFor(state, appId, dependencies);
  if (state.recordHash !== value.completedRecordHash || state.previousHash !== value.attemptedRecordHash
    || state.checkpoint.operation !== "create" || hash(contract) !== hash(value.contract)) fail("witnessed owner or Compose verifier changed");
  return { contract, anchor: { ...value.anchor } };
}
function docker(context: string, args: string[]): string {
  const result = spawnSync("docker", ["--context", context, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail("bounded selected runtime inspection unavailable");
  return result.stdout.trim();
}
function object(raw: string): Entry {
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("runtime returned invalid object");
  return value;
}
function privateBind(ip: string): boolean {
  if (ip === "::1") return true;
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
      || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
  }
  return isIP(ip) === 6 && /^(?:fc|fd|fe[89ab])/i.test(ip);
}
function container(state: SharedProjectState, composeTarget: string, id: string): string {
  return docker(state.project.dockerContext, ["compose", "--project-name", state.project.id,
    "--file", composeTarget, "ps", "--all", "--quiet", id]);
}
async function runtimeChecks(state: SharedProjectState, appId: string, composeTarget: string): Promise<{ exposure: boolean; storage: boolean }> {
  let exposure = true; let storage = true;
  for (const id of [...state.units[appId]!].sort()) {
    const service = state.manifest.services.find((item: Entry) => item.id === id)!;
    const containerId = container(state, composeTarget, id);
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) fail("expected exactly one selected container");
    // Never inspect Env, commands, secret files, complete labels or raw container JSON.
    const actual = object(docker(state.project.dockerContext, ["inspect", "--type", "container", containerId, "--format",
      '{"imageId":{{json .Image}},"image":{{json .Config.Image}},"state":{{json .State.Status}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"file":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"directory":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},"networkMode":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}']));
    const pinned = object(docker(state.project.dockerContext, ["image", "inspect", service.image, "--format", '{"imageId":{{json .Id}}}']));
    if (!/^sha256:[a-f0-9]{64}$/.test(pinned.imageId) || actual.imageId !== pinned.imageId || actual.image !== service.image
      || actual.project !== state.project.id || actual.service !== id || actual.file !== composeTarget
      || actual.directory !== state.project.directory || actual.state !== "running") fail("actual image or owner differs");
    if (actual.networkMode === "host" || !actual.ports || typeof actual.ports !== "object" || Array.isArray(actual.ports)) exposure = false;
    const observedPorts: string[] = [];
    for (const [target, bindings] of Object.entries(actual.ports ?? {})) {
      if (bindings === null) continue;
      if (!Array.isArray(bindings)) { exposure = false; continue; }
      for (const binding of bindings) {
        if (!privateBind(binding.HostIp) || !/^[0-9]{1,5}$/.test(binding.HostPort)) exposure = false;
        observedPorts.push(`${target}:${binding.HostIp}:${binding.HostPort}`);
      }
    }
    const expectedPorts = service.ports.map((port: Entry) => `${port.target}/${port.protocol}:${port.hostIp}:${port.published}`);
    if (hash(observedPorts.sort()) !== hash(expectedPorts.sort())) exposure = false;
    if (!Array.isArray(actual.mounts)) { storage = false; continue; }
    for (const mount of service.mounts) {
      const found = actual.mounts.filter((item: Entry) => item.Destination === mount.target);
      if (found.length !== 1 || found[0].RW !== !mount.readOnly || mount.owner !== state.project.owner) { storage = false; continue; }
      if (mount.kind === "volume") {
        if (found[0].Type !== "volume" || found[0].Name !== mount.name) { storage = false; continue; }
        const volume = object(docker(state.project.dockerContext, ["volume", "inspect", mount.name, "--format",
          '{"driver":{{json .Driver}},"project":{{json (index .Labels "com.docker.compose.project")}},"volume":{{json (index .Labels "com.docker.compose.volume")}},"owner":{{json (index .Labels "io.selfhost.project")}},"id":{{json (index .Labels "io.selfhost.volume")}}}']));
        if (volume.driver !== "local" || volume.project !== state.project.id || volume.owner !== state.project.owner
          || volume.id !== mount.name.slice(state.project.id.length + 1) || volume.volume !== mount.name) storage = false;
      } else {
        if (found[0].Type !== "bind" || !localDockerBindSourceMatches(state.project.dockerContext, found[0].Source, mount.source)
          || await realpath(mount.source) !== mount.source) { storage = false; continue; }
        const metadata = await lstat(mount.source);
        if (process.platform === "win32") assertPrivatePath(mount.source, 0o600);
        if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory()) || !ownedByCurrentUser(metadata)) storage = false;
      }
    }
    // An anonymous image volume or an undeclared writable mount is not owned storage.
    for (const mount of actual.mounts) {
      if (mount.RW === true && !service.mounts.some((item: Entry) => item.target === mount.Destination)) storage = false;
    }
  }
  // Verify the approved storage inventory, including stateless/read-only selections.
  // Writable persistence and restart survival are separate application claims.
  return { exposure, storage };
}

/** Internal approved-create hook. Only this call's successful apply can mint fresh evidence.
 * Interrupted/retrospective completed owners cannot replay this hook to recover missing proof. */
export async function witnessSharedComposeCompatibilityCreate(attempted: SharedProjectState, composeTarget: string,
  applyAndComplete: () => Promise<SharedProjectState>, dependencies: SharedComposeCompatibilityDependencies): Promise<void> {
  if (attempted.checkpoint.operation !== "create" || attempted.checkpoint.phase !== "attempted"
    || attempted.manifest.project.ownership !== "new") fail("fresh approved create chronology required");
  const absent = new Set<string>();
  try {
    requireLocalSharedDockerContext(attempted.project.dockerContext);
    for (const [appId, services] of Object.entries(attempted.units)) {
      try { if (services.every((id) => container(attempted, composeTarget, id) === "")) absent.add(appId); }
      catch { /* Unknown pre-apply absence cannot become fresh proof. */ }
    }
  } catch { /* Context inspection failure cannot change approved apply behavior. */ }
  const completed = await applyAndComplete();
  if (completed.checkpoint.operation !== "create" || completed.checkpoint.phase !== "completed"
    || completed.previousHash !== attempted.recordHash || completed.revision !== attempted.revision + 1
    || completed.manifestHash !== attempted.manifestHash) fail("create completion chronology differs");
  try {
    await publishCompletedCreate(attempted, completed, composeTarget, absent, dependencies);
  } catch {
    // Deployment is already complete. Never label receipt failure as failed apply or authorize replay.
    console.error("Compose apply completed; compatibility evidence is incomplete. Inspect this owner without replaying apply.");
  }
}
async function publishCompletedCreate(attempted: SharedProjectState, completed: SharedProjectState,
  composeTarget: string, absent: Set<string>, dependencies: SharedComposeCompatibilityDependencies): Promise<void> {
  const checkedAt = new Date().toISOString();
  const root = join(dirname(dirname(completed.project.root)), `selfhost-verification-${completed.project.id}`);
  await prepareCompatibilityEvidenceRoot(root);
  for (const appId of Object.keys(completed.units).sort()) {
    // A missing catalog descriptor is not license to infer applicability.
    if (!dependencies.appFor) continue;
    try {
      const contract = contractFor(completed, appId, dependencies);
      const checks: Array<{ id: string; result: "pass" | "fail" | "not-run" }> = [
        { id: "fresh-compose-apply", result: "not-run" }, { id: "private-exposure", result: "not-run" },
        { id: "owned-storage", result: "not-run" }];
      if (absent.has(appId)) {
        checks[0]!.result = "pass";
        try {
          const observed = await runtimeChecks(completed, appId, composeTarget);
          checks[1]!.result = "fail";
          if (observed.exposure) checks[1]!.result = "pass";
          checks[2]!.result = "fail";
          if (observed.storage) checks[2]!.result = "pass";
        } catch { /* Runtime unavailable: retain explicit incomplete observation, zero points. */ }
      }
      const runId = randomUUID();
      const tip = await loadCompatibilityReceipts(root, [contract], { checkedAt });
      const { homarrMode: _mode, ...identity } = contract;
      const published = await publishCompatibilityObservation(root, { ...identity, runId, checkedAt, checks, cleanup: "not-required" },
        contract, { expectedRevision: tip.revision, expectedRegistryHash: tip.registryHash });
      const ledger: Ledger = { schemaVersion: 1, runId, attemptedRecordHash: attempted.recordHash,
        completedRecordHash: completed.recordHash, contract,
        anchor: { revision: published.revision, registryHash: published.registryHash } };
      await owned(completed.project.directory, true);
      const handle = await open(join(completed.project.directory, `compose-run-${appId}.json`),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { protectPrivatePath(join(completed.project.directory, `compose-run-${appId}.json`), 0o600); await handle.writeFile(JSON.stringify(ledger)); await handle.sync(); } finally { await handle.close(); }
    } catch {
      console.error(`Compose apply completed; ${appId} compatibility evidence is incomplete. Inspect without replaying apply.`);
    }
  }
}
