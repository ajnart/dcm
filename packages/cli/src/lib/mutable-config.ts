import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, readdirSync } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkedMutableConfigs, type MutableConfigHook, type MutableConfigContext } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/mutable-config.ts";
import { readPreparedPrivateConfig } from "./private-config.ts";
import { installedCliRoot } from "./installed-cli-root.ts";
import { requireLocalSharedDockerContext } from "./shared-host-observation.ts";
export { checkedMutableConfigs };
type Entry = Record<string, any>;
export const mutableConfigRuntimeNames = ["mutable-config.ts", "private-config.ts", "installed-cli-root.ts",
  "shared-host-observation.ts", "shared-project-limits.ts", "manual-job.ts",
  "private-identity-worker.ts", "private-identity-bun.ts"] as const;
const own = new URL(import.meta.url);
const installedRoot = installedCliRoot(import.meta.url);
let catalog = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", own);
let extension = "ts";
if (!own.pathname.endsWith(".ts")) {
  catalog = new URL("workflows/selfhost/references/catalog/", installedRoot);
  extension = "js";
}
const catalogRoot = fileURLToPath(new URL("apps/", catalog));
function sourceDigest(url: URL): string {
  const path = fileURLToPath(url);
  if (realpathSync(path) !== path) throw new Error("Mutable configuration source is unsafe");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o002) !== 0 || before.size > 16 * 1024 * 1024) throw new Error("Mutable configuration source is unsafe");
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = readSync(fd, bytes, count, bytes.length - count, count);
      if (!size) break;
      count += size;
    }
    for (const after of [fstatSync(fd), lstatSync(path)]) {
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mode !== after.mode || before.nlink !== after.nlink
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || realpathSync(path) !== path || count !== before.size) {
        throw new Error("Mutable configuration source changed during inspection");
      }
    }
    return createHash("sha256").update(bytes.subarray(0, count)).digest("hex");
  } finally { closeSync(fd); }
}
/** Approval/journal source binding includes executable hooks, their declared dependencies and shared runtime. */
export function mutableConfigSourceHash(recipe: Entry): string | null {
  const configs = checkedMutableConfigs(recipe);
  if (!configs.size) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe.appId ?? "")) throw new Error("Mutable configuration app owner is invalid");
  const app = new URL(`apps/${recipe.appId}/`, catalog);
  const snapshots = readdirSync(app).filter((name) => /^[a-z0-9][a-z0-9-]*\.(?:ts|json)$/.test(name) || name === "derived-recipe.js")
    .sort().map((name) => [name, sourceDigest(new URL(name, app))]);
  if (extension === "ts") {
    const key = Symbol.for("selfhost.shared-derived-recipe.source-graphs.v1");
    const state = globalThis as any;
    state[key] ??= new Map<string, string>();
    const graph = createHash("sha256").update(JSON.stringify(snapshots)).digest("hex");
    if (state[key].has(app.href) && state[key].get(app.href) !== graph) throw new Error("Mutable configuration cached source graph differs");
    state[key].set(app.href, graph);
  }
  const names = [...new Set([...configs.values()].flatMap((config) => config.sourceFiles))].sort();
  if (extension === "js") names.push("mutable-config.js");
  const runtime = new URL("workflows/selfhost/references/mutable-config-runtime/", installedRoot);
  const sources = names.map((name) => [name, sourceDigest(new URL(name, app))]);
  for (const name of mutableConfigRuntimeNames) {
    let url = new URL(name, own);
    if (extension === "js") url = new URL(name, runtime);
    sources.push([name, sourceDigest(url)]);
  }
  sources.push(["types/mutable-config.ts", sourceDigest(new URL("types/mutable-config.ts", catalog))]);
  sources.push(["types/private-config-environment.ts", sourceDigest(new URL("types/private-config-environment.ts", catalog))]);
  sources.push(["types/manual-job.ts", sourceDigest(new URL("types/manual-job.ts", catalog))]);
  sources.push(["types/private-identity.ts", sourceDigest(new URL("types/private-identity.ts", catalog))]);
  const result = createHash("sha256").update(JSON.stringify({ declarations: [...configs.values()], sources })).digest("hex");
  const key = Symbol.for("selfhost.mutable-config.source-hashes.v1");
  const state = globalThis as any;
  state[key] ??= new Map<string, string>();
  const identity = app.href;
  const sourceIdentity = createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  if (state[key].has(identity) && state[key].get(identity) !== sourceIdentity) throw new Error("Mutable configuration cached source differs");
  state[key].set(identity, sourceIdentity);
  return result;
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o700
    || await realpath(path) !== path) throw new Error("Mutable configuration directory must be current-user-owned mode-0700");
}

/** Bounded private read shared with resume/acceptance; never emits payloads. */
export async function readMutableConfig(path: string): Promise<string> {
  const before = await lstat(path);
  const intact = (stat: typeof before) => stat.isFile() && stat.nlink === 1
    && stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o600
    && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size
    && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs;
  if (!intact(before) || before.size < 1 || before.size > 65536 || await realpath(path) !== path) {
    throw new Error("Mutable configuration must be an intact owner-only bounded regular file");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!intact(await handle.stat())) throw new Error("Mutable configuration changed during inspection");
    const buffer = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== before.size || !intact(await handle.stat()) || !intact(await lstat(path))) {
      throw new Error("Mutable configuration changed during reading");
    }
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    if (!Buffer.from(text).equals(buffer.subarray(0, bytesRead))) throw new Error("Mutable configuration is not UTF-8");
    return text;
  } finally { await handle.close(); }
}

export async function prepareMutableConfigs(recipe: Entry, dataDirectory: string, privateFiles: string, initialize = true): Promise<void> {
  const configs = checkedMutableConfigs(recipe);
  if (!configs.size) return;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe.appId ?? "")) throw new Error("Mutable configuration app owner is invalid");
  const sourceHash = mutableConfigSourceHash(recipe)!;
  const hookPath = join(catalogRoot, recipe.appId, `mutable-config.${extension}`);
  if (await realpath(hookPath) !== hookPath) throw new Error("Mutable configuration hook must be catalog-owned");
  const hook: MutableConfigHook = (await import(pathToFileURL(hookPath).href)).mutableConfigHook;
  if (mutableConfigSourceHash(recipe) !== sourceHash) throw new Error("Mutable configuration source changed while loading");
  if (typeof hook?.initialize !== "function" || typeof hook?.validate !== "function") throw new Error("Mutable configuration hook is unavailable");
  const baseContext = { recipe, async readPrivateFile(id: string) {
    if (!(recipe.privateFiles ?? []).some((file: Entry) => file.id === id)) throw new Error("Mutable configuration private input is undeclared");
    return readPreparedPrivateConfig(privateFiles, id);
  } };
  const root = join(dataDirectory, "mutable-configs");
  if (initialize) await privateDirectory(root);
  for (const config of configs.values()) {
    if (config.containerUid !== process.getuid?.()) {
      throw new Error("Mutable configuration image UID cannot read/write current-user owner-only storage; ownership remapping is not authorized");
    }
    const directory = join(root, config.id);
    if (initialize) await privateDirectory(directory);
    for (const parent of [root, directory]) {
      const stat = await lstat(parent);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o700
        || await realpath(parent) !== parent) throw new Error("Mutable configuration private parent is unsafe");
    }
    const context: MutableConfigContext = { ...baseContext, configId: config.id, inputs: config.inputs ?? {} };
    const path = join(directory, config.filename);
    try {
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!initialize) throw new Error("Mutable configuration is missing; refusing to replace previously prepared state");
      const content = await hook.initialize(context);
      if (typeof content !== "string" || Buffer.byteLength(content) < 1 || Buffer.byteLength(content) > 65536) throw new Error("Mutable configuration initializer output is invalid");
      await hook.validate(content, context);
      try {
        const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    try { await hook.validate(await readMutableConfig(path), context); }
    catch { throw new Error("Mutable configuration resume semantics failed; existing state was preserved"); }
    if (mutableConfigSourceHash(recipe) !== sourceHash) throw new Error("Mutable configuration source changed during validation");
  }
}

export async function verifyMutableConfigs(recipe: Entry, dataDirectory: string, privateFiles: string): Promise<void> {
  return prepareMutableConfigs(recipe, dataDirectory, privateFiles, false);
}

/** Runtime read-only gate: actual daemon mode, not a caller mapping/pass flag. */
export function requireMutableConfigNamespace(recipe: Entry, dockerContext: string): void {
  if (!checkedMutableConfigs(recipe).size) return;
  requireLocalSharedDockerContext(dockerContext);
  if (dockerContext === "rootless") throw new Error("Mutable configuration rootless UID mapping is not implemented");
  const inspected = spawnSync("docker", ["--context", dockerContext, "info", "--format", "{{json .SecurityOptions}}"], {
    encoding: "utf8", timeout: 15000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"],
  });
  if (inspected.error || inspected.status !== 0) throw new Error("Mutable configuration daemon mapping could not be verified; output withheld");
  let security: unknown;
  try { security = JSON.parse(inspected.stdout.trim()); }
  catch { throw new Error("Mutable configuration daemon mapping observation is invalid"); }
  if (!Array.isArray(security) || security.some((entry) => typeof entry !== "string" || /(?:rootless|userns)/i.test(entry))) {
    throw new Error("Mutable configuration daemon UID namespace is unsupported; owner-private state was preserved");
  }
}
