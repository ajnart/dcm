import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SharedPrestartAdapter, SharedPrestartContext, SharedPrestartOperation } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/pre-start.ts";
import type { SharedProjectState } from "./shared-project-state.ts";
import type { DockerApiAuthorityInput } from "./docker-api-authority.ts";
import { installedCliRoot } from "./installed-cli-root.ts";
import { verifyMutableConfigs, requireMutableConfigNamespace } from "./mutable-config.ts";
import { verifySharedRuntimeResourceDevices } from "./shared-runtime-resources.ts";
import { requireSharedOwnerDirectory } from "./shared-owner-directory.ts";

type Manifest = Record<string, any>;
type Declaration = { schemaVersion: 1; kind: "shared-pre-start-adapter"; appId: string; sourceFiles: string[]; effects: string[] };
export const sharedPrestartRuntimeNames = ["shared-prestart.ts", "shared-docker-authority.ts", "shared-runtime-resources.ts", "shared-owner-directory.ts", "selfhost-compose.ts", "shared-project.ts",
  "docker-api-authority.ts", "docker-api-authority-profile.ts", "docker-api-authority-probe.ts", "docker-api-authority-state.ts",
  "shared-private-https-state.ts", "shared-project-state.ts", "shared-derived-recipe.ts", "shared-derived-recipe-loader.ts",
  "shared-derived-recipe-state.ts", "shared-compose-project.ts", "shared-saved-recipe.ts", "shared-service-target.ts", "installed-cli-root.ts",
  "setup-cloudflare-provider.ts", "mutable-config.ts", "private-config.ts", "shared-host-observation.ts",
  "desktop-host-observation.ts", "platform-private.ts", "portable-compose-lifecycle.ts"] as const;
const own = new URL(import.meta.url);
const installedRoot = installedCliRoot(import.meta.url);
let catalog = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", own);
let extension = "ts";
if (!own.pathname.endsWith(".ts")) {
  catalog = new URL("workflows/selfhost/references/catalog/", installedRoot);
  extension = "js";
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function fail(): never { throw new Error("Shared app pre-start source or prerequisite differs; inspect before startup"); }
function read(url: URL, limit = 1024 * 1024): Buffer {
  const path = fileURLToPath(url);
  if (realpathSync(path) !== path) fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > limit
      || (process.platform !== "win32" && (before.mode & 0o002) !== 0)) fail();
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = readSync(fd, bytes, count, bytes.length - count, null);
      if (size === 0) break;
      count += size;
    }
    if (count !== before.size) fail();
    for (const after of [fstatSync(fd), statSync(path)]) {
      if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mode !== after.mode
        || before.nlink !== after.nlink || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail();
    }
    if (realpathSync(path) !== path) fail();
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
function declaration(app: URL, appId: string): Declaration | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId)) fail();
  const url = new URL("pre-start-adapter.json", app);
  try { lstatSync(url); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const value = JSON.parse(read(url, 16384).toString("utf8"));
  if (!value || Object.keys(value).sort().join(",") !== "appId,effects,kind,schemaVersion,sourceFiles"
    || value.schemaVersion !== 1 || value.kind !== "shared-pre-start-adapter" || value.appId !== appId
    || !Array.isArray(value.sourceFiles) || value.sourceFiles.length > 24
    || !value.sourceFiles.includes("pre-start.ts") || !value.sourceFiles.includes("manifest.json")
    || new Set(value.sourceFiles).size !== value.sourceFiles.length
    || value.sourceFiles.some((name: unknown) => typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*\.(?:json|ts)$/.test(name))
    || !Array.isArray(value.effects) || value.effects.length > 32
    || value.effects.some((effect: unknown) => typeof effect !== "string" || !effect.length || effect.length > 2048)) fail();
  return value;
}
export function declaredSharedPrestart(app: URL, appId: string): boolean { return declaration(app, appId) !== null; }
function appDirectory(appId: string) { return new URL(`apps/${appId}/`, catalog); }
function sourceHash(row: Declaration): string {
  const app = appDirectory(row.appId);
  const files = ["pre-start-adapter.json", ...row.sourceFiles];
  if (extension === "js") files.push("pre-start.js");
  const runtime = new URL("workflows/selfhost/references/prestart-runtime/", installedRoot);
  const runtimeHashes = sharedPrestartRuntimeNames.map((name) => {
    let url = new URL(`./${name}`, own);
    if (name === "shared-project.ts") url = new URL(`../${name}`, own);
    if (name === "setup-cloudflare-provider.ts") url = new URL(`../control-panel/${name}`, own);
    if (extension === "js") url = new URL(name, runtime);
    return [name, digest(read(url))];
  });
  const key = Symbol.for("selfhost.shared-prestart.runtime-source.v1");
  const processState = globalThis as any;
  processState[key] ??= new Map<string, string>();
  let runtimeIdentity = new URL("./", own).href;
  if (extension === "js") runtimeIdentity = runtime.href;
  const runtimeHash = hash(runtimeHashes);
  if (processState[key].has(runtimeIdentity) && processState[key].get(runtimeIdentity) !== runtimeHash) fail();
  processState[key].set(runtimeIdentity, runtimeHash);
  const setup = new URL(`setup.${extension}`, app);
  let setupHash: string | null = null;
  try { lstatSync(setup); setupHash = digest(read(setup, 16 * 1024 * 1024)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return hash({ declaration: row, runtimeHashes, setupHash,
    types: digest(read(new URL("types/pre-start.ts", catalog))),
    sources: files.map((name) => [name, digest(read(new URL(name, app), 16 * 1024 * 1024))]) });
}
/** Read-only catalog metadata. No app import, owner file, credential or network read. */
export function sharedPrestartContracts(manifest: Manifest, serviceIds?: string[]) {
  const selected = new Set(serviceIds ?? manifest.services.map((service: any) => service.id));
  const contracts = new Map<string, Declaration>();
  for (const service of manifest.services) {
    if (!selected.has(service.id)) continue;
    // A remapped service uses APP-ID or APP-ID-SERVICE; select the longest
    // existing declaration instead of accepting a caller-supplied app mapping.
    const parts = String(service.id).split("-");
    for (let size = parts.length; size > 0; size--) {
      const appId = parts.slice(0, size).join("-");
      const row = declaration(appDirectory(appId), appId);
      if (!row) continue;
      contracts.set(appId, row);
      break;
    }
  }
  return [...contracts.values()].sort((a, b) => a.appId.localeCompare(b.appId))
    .map((row) => ({ appId: row.appId, sourceSha256: sourceHash(row), effects: [...row.effects] }));
}
const adapters = new Map<string, { adapter: SharedPrestartAdapter; sourceSha256: string }>();
async function adapterFor(appId: string) {
  const app = appDirectory(appId);
  const row = declaration(app, appId);
  if (!row) fail();
  const sourceSha256 = sourceHash(row);
  const prior = adapters.get(appId);
  if (prior) { if (prior.sourceSha256 !== sourceSha256) fail(); return prior.adapter; }
  // Pin dependency-only source drift before a warm module cache can load an
  // unchanged executable with old imported helpers.
  const { readdirSync } = await import("node:fs");
  const snapshot = readdirSync(app).filter((name) => /^[a-z0-9][a-z0-9-]*\.(?:ts|json)$/.test(name))
    .sort().map((name) => [name, digest(read(new URL(name, app)))]) as Array<[string, string]>;
  const key = Symbol.for("selfhost.shared-derived-recipe.source-graphs.v1");
  const state = globalThis as any;
  state[key] ??= new Map<string, string>();
  if (extension === "ts") {
    const graph = hash(snapshot);
    if (state[key].has(app.href) && state[key].get(app.href) !== graph) fail();
    state[key].set(app.href, graph);
  }
  const executable = new URL(`pre-start.${extension}`, app);
  executable.searchParams.set("sha256", digest(read(executable, 16 * 1024 * 1024)));
  const adapter: SharedPrestartAdapter = (await import(executable.href)).default;
  if (!adapter || adapter.appId !== appId || typeof adapter.verify !== "function"
    || (adapter.assertAuthority !== undefined && typeof adapter.assertAuthority !== "function")) fail();
  for (const [name, sha] of snapshot) if (digest(read(new URL(name, app))) !== sha) fail();
  if (sourceHash(row) !== sourceSha256) fail();
  adapters.set(appId, { adapter, sourceSha256 });
  return adapter;
}
/** Actual owner records only; caller JSON and status booleans are not a source. */
export async function sharedPrestartContext(state: SharedProjectState, appId: string,
  operation: SharedPrestartOperation = "start"): Promise<SharedPrestartContext> {
  const { loadSharedProjectState } = await import("./shared-project-state.ts");
  const { loadSharedDerivedRecipeBindingSync } = await import("./shared-derived-recipe-state.ts");
  const { sharedDerivedRecipeAdapter } = await import("./shared-derived-recipe.ts");
  const manifest = state.manifest;
  const contracts = sharedPrestartContracts(manifest, state.units[appId]);
  const contract = contracts.find((row) => row.appId === appId);
  if (!contract || !state.units[appId] || state.checkpoint.phase === "inspect-required") fail();
  let derived: SharedPrestartContext["derived"] = null;
  if (sharedDerivedRecipeAdapter(appId)) derived = loadSharedDerivedRecipeBindingSync(state.project.directory, appId, state);
  const context: SharedPrestartContext = { appId, operation, manifest: structuredClone(manifest),
    serviceIds: [...state.units[appId]!], state, derived,
    async revalidate() {
      const current = await loadSharedProjectState(state.project.directory, state.project.id);
      if (!current || current.recordHash !== state.recordHash || current.checkpoint.phase === "inspect-required"
        || current.project.root !== dirname(current.project.directory)
        || hash(current.manifest) !== hash(manifest)) fail();
      if (sharedPrestartContracts(current.manifest, current.units[appId]).find((row) => row.appId === appId)?.sourceSha256 !== contract.sourceSha256) fail();
      if (derived && loadSharedDerivedRecipeBindingSync(current.project.directory, appId, current).bindingHash !== derived.bindingHash) fail();
    } };
  const adapter = await adapterFor(appId);
  if (manifest.services.some((service: any) => context.serviceIds.includes(service.id) && service.ownerDirectory)) {
    context.requireSameDaemonDirectory = async () => { await requireSharedOwnerDirectory(context); };
  }
  if (adapter.assertAuthority) context.requireDockerAuthority = async () => {
    const { requireSharedDockerAuthorityForStart } = await import("./shared-docker-authority.ts");
    await requireSharedDockerAuthorityForStart(state, appId, context.revalidate);
  };
  if (appId === "cloudflare-tunnel") context.readCloudflareProvider = async () => {
    const { readCloudflareProvider } = await import("../control-panel/setup-cloudflare-provider.ts");
    return await readCloudflareProvider(state, context.revalidate);
  };
  await context.revalidate();
  return context;
}
export async function assertSharedPrestartAuthority(state: SharedProjectState, appId: string, input: DockerApiAuthorityInput): Promise<void> {
  const context = await sharedPrestartContext(state, appId);
  const adapter = await adapterFor(appId);
  if (!adapter.assertAuthority) fail();
  adapter.assertAuthority(context, input);
  await context.revalidate();
}
/** Lowest shared owner startup gate. Every invocation performs the current app
 * verifier; there is no caller pass flag or reusable in-process permit. */
export async function requireSharedPrestart(manifest: Manifest, operation: string, serviceIds?: string[]): Promise<void> {
  if (!["apply", "add", "start", "recreate", "probe"].includes(operation)) return;
  verifySharedRuntimeResourceDevices(manifest, serviceIds);
  const contracts = sharedPrestartContracts(manifest, serviceIds);
  const selected = new Set(serviceIds ?? manifest.services.map((service: any) => service.id));
  const ownedDirectories = manifest.services.filter((service: any) => selected.has(service.id) && service.ownerDirectory);
  const mutableServices = manifest.services.filter((service: any) => selected.has(service.id)
    && service.mounts?.some((mount: any) => typeof mount.source === "string"
      && mount.source.startsWith(`${manifest.project.directory}/data/`)
      && mount.source.includes("/mutable-configs/")));
  if (contracts.length === 0 && mutableServices.length === 0 && ownedDirectories.length === 0) return;
  const { loadSharedProjectState } = await import("./shared-project-state.ts");
  const state = await loadSharedProjectState(manifest.project.directory, manifest.project.id);
  if (!state || hash(state.manifest) !== hash(manifest) || state.checkpoint.phase === "inspect-required") fail();
  for (const service of ownedDirectories) {
    const appId = service.ownerDirectory.appId;
    if (!state.units[appId]?.includes(service.id)) fail();
    const context = await sharedPrestartContext(state, appId, operation as SharedPrestartOperation);
    await requireSharedOwnerDirectory(context);
    await context.revalidate();
  }
  if (mutableServices.length > 0) {
    const { loadSharedDerivedRecipeBindingSync } = await import("./shared-derived-recipe-state.ts");
    const mutableIds = new Set(mutableServices.map((service: any) => service.id));
    for (const [appId, units] of Object.entries(state.units)) {
      if (!units.some((id) => mutableIds.has(id))) continue;
      const binding = loadSharedDerivedRecipeBindingSync(state.project.directory, appId, state);
      requireMutableConfigNamespace(binding.selection.recipe, state.project.dockerContext);
      await verifyMutableConfigs(binding.selection.recipe,
        join(state.project.directory, "data", appId), join(state.project.directory, "secrets", appId));
      const current = await loadSharedProjectState(state.project.directory, state.project.id);
      if (!current || current.recordHash !== state.recordHash) fail();
    }
  }
  for (const contract of contracts) {
    const context = await sharedPrestartContext(state, contract.appId, operation as SharedPrestartOperation);
    const adapter = await adapterFor(contract.appId);
    await adapter.verify(context);
    await context.revalidate();
  }
}
