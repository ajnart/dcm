import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installedCliRoot } from "./installed-cli-root.ts";
import type { SharedDerivedRecipeAdapter } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/derived-recipe.ts";

const declarationName = "derived-recipe-adapter.json";
const runtimeNames = ["shared-derived-recipe.ts", "shared-derived-recipe-loader.ts", "shared-derived-recipe-state.ts",
  "shared-service-target.ts", "shared-compose-project.ts", "shared-saved-recipe.ts", "shared-https-proxy-profile.ts"];
function fail(): never { throw new Error("Shared derived recipe differs from its exact reviewed input, source, recipe or owner"); }
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Source imports share dependency caches across consumers. Never approve a new graph
 * over an already cached one; reload belongs to a fresh process, not this API. */
function pinSourceGraph(directory: URL, snapshot: Array<[string, string]>): void {
  const key = Symbol.for("selfhost.shared-derived-recipe.source-graphs.v1");
  const processState = globalThis as typeof globalThis & { [key: symbol]: Map<string, string> | undefined };
  let graphs = processState[key];
  if (!graphs) {
    graphs = new Map();
    processState[key] = graphs;
  }
  const identity = hash(JSON.stringify(snapshot.sort(([left], [right]) => left.localeCompare(right))));
  const previous = graphs.get(directory.href);
  if (previous !== undefined && previous !== identity) fail();
  graphs.set(directory.href, identity);
}

/** Never follow a link, hardlink or writable external replacement. */
function read(url: URL): Buffer {
  const path = fileURLToPath(url);
  if (realpathSync(path) !== path) fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 16 * 1024 * 1024
      || (before.mode & 0o002) !== 0) fail();
    const bytes = readFileSync(fd);
    const after = fstatSync(fd), named = statSync(path);
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || named.dev !== after.dev || named.ino !== after.ino || named.size !== after.size
      || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs || realpathSync(path) !== path) fail();
    return bytes;
  } finally { closeSync(fd); }
}

/** Strict opt-in: the declaration cannot select an executable or another app. */
export function declaredSharedDerivedRecipe(appDirectory: URL, appId: string): boolean {
  const declaration = new URL(declarationName, appDirectory);
  try { lstatSync(declaration); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const value = JSON.parse(read(declaration).toString("utf8"));
  if (!value || Array.isArray(value) || typeof value !== "object"
    || Object.keys(value).sort().join(",") !== "appId,kind,schemaVersion"
    || value.schemaVersion !== 1 || value.kind !== "shared-derived-recipe-adapter" || value.appId !== appId) fail();
  return true;
}

function locations() {
  const own = new URL(import.meta.url);
  if (own.pathname.endsWith(".ts")) return {
    catalog: new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", own),
    runtime: new URL("./", own), extension: "ts",
  };
  const root = installedCliRoot(import.meta.url);
  return { catalog: new URL("workflows/selfhost/references/catalog/", root),
    runtime: new URL("workflows/selfhost/references/derived-recipe-runtime/", root), extension: "js" };
}

function pinRuntimeSourceGraph(catalog: URL, runtime: URL): void {
  const files = runtimeNames.map((name) => new URL(name, runtime));
  files.push(new URL("types/derived-recipe.ts", catalog), new URL("types/domain-policy.ts", catalog));
  pinSourceGraph(runtime, files.map((url) => [url.href, hash(read(url))]));
}

function sourceFiles(adapter: SharedDerivedRecipeAdapter): string[] {
  if (!Array.isArray(adapter.sourceFiles) || adapter.sourceFiles.length < 1 || adapter.sourceFiles.length > 16
    || new Set(adapter.sourceFiles).size !== adapter.sourceFiles.length
    || !adapter.sourceFiles.includes("derived-recipe.ts")) fail();
  for (const name of adapter.sourceFiles) if (!/^[a-z0-9][a-z0-9-]*\.(?:ts|json)$/.test(name)) fail();
  return [...adapter.sourceFiles];
}

function validAdapter(adapter: SharedDerivedRecipeAdapter, appId: string): void {
  if (!adapter || adapter.appId !== appId || typeof adapter.derive !== "function"
    || !adapter.inputDefinitions || Array.isArray(adapter.inputDefinitions)
    || typeof adapter.inputDefinitions !== "object") fail();
  for (const [key, definition] of Object.entries(adapter.inputDefinitions)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || !definition
      || Object.keys(definition).sort().join(",") !== "description,maxLength"
      || typeof definition.description !== "string" || !definition.description.length
      || !Number.isSafeInteger(definition.maxLength) || definition.maxLength < 1 || definition.maxLength > 65536) fail();
  }
  sourceFiles(adapter);
}

/** Approval binds the declaration, exact loaded app dependencies and packaged executable. */
export function sharedDerivedRecipeSourceHash(adapter: SharedDerivedRecipeAdapter): string {
  const { catalog, runtime, extension } = locations();
  if (extension === "ts") pinRuntimeSourceGraph(catalog, runtime);
  const app = new URL(`apps/${adapter.appId}/`, catalog);
  if (!declaredSharedDerivedRecipe(app, adapter.appId)) fail();
  const files = runtimeNames.map((name) => new URL(name, runtime));
  files.push(new URL("types/derived-recipe.ts", catalog), new URL("types/domain-policy.ts", catalog), new URL(declarationName, app));
  for (const name of sourceFiles(adapter)) files.push(new URL(name, app));
  if (extension === "js") files.push(new URL("derived-recipe.js", app));
  return hash(JSON.stringify(files.map((url) => hash(read(url)))));
}

/** Only installed catalog opt-ins; no caller path, checkout fallback or executable registry. */
export async function loadSharedDerivedRecipeAdapters() {
  const { catalog, runtime, extension } = locations();
  const appRoot = new URL("apps/", catalog);
  if (realpathSync(appRoot) !== fileURLToPath(appRoot).replace(/\/$/, "")) fail();
  const adapters = new Map<string, SharedDerivedRecipeAdapter>();
  const loadedSourceHashes = new Map<string, string>();
  if (extension === "ts") pinRuntimeSourceGraph(catalog, runtime);
  for (const entry of readdirSync(appRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;
    const app = new URL(`${entry.name}/`, appRoot);
    if (!entry.isDirectory()) {
      if (entry.isSymbolicLink()) fail();
      continue;
    }
    if (!declaredSharedDerivedRecipe(app, entry.name)) continue;
    // Snapshot all bounded app source files before importing so a warm module cannot bind new bytes.
    const snapshots = new Map<string, string>();
    for (const file of readdirSync(app)) {
      if (/^[a-z0-9][a-z0-9-]*\.(?:ts|json)$/.test(file) || file === "derived-recipe.js") {
        snapshots.set(file, hash(read(new URL(file, app))));
      }
    }
    // Pin before import: dependencies may already be cached by another source consumer.
    if (extension === "ts") pinSourceGraph(app, [...snapshots]);
    const executableName = `derived-recipe.${extension}`;
    const executable = new URL(executableName, app);
    // Distinct bundled consumers must not reuse Node's old executable cache after byte drift.
    const executableHash = snapshots.get(executableName);
    if (!executableHash) fail();
    executable.searchParams.set("sha256", executableHash);
    const loaded = await import(executable.href);
    const adapter: SharedDerivedRecipeAdapter = loaded.default;
    validAdapter(adapter, entry.name);
    for (const name of [declarationName, ...sourceFiles(adapter), `derived-recipe.${extension}`]) {
      if (snapshots.get(name) !== hash(read(new URL(name, app)))) fail();
    }
    adapters.set(entry.name, adapter);
    loadedSourceHashes.set(entry.name, sharedDerivedRecipeSourceHash(adapter));
  }
  return { adapters, loadedSourceHashes };
}
