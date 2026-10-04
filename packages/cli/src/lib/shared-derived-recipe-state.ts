import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { assertSharedDerivedRecipeUnchanged, restoreSharedDerivedRecipeSelection, sharedDerivedRecipeAdapter,
  sharedDerivedBindingDirectory, type SharedDerivedRecipeBinding } from "./shared-derived-recipe.ts";
import type { SharedProjectState } from "./shared-project-state.ts";

const maximumBytes = 8 * 1024 * 1024;
function fail(): never { throw new Error("Shared derived recipe binding is missing, unsafe or differs from its exact saved owner"); }
function uid(): number {
  if (!process.getuid) fail();
  return process.getuid();
}
function checkedDirectory(directory: string, metadata: Stats, canonical: string): void {
  if (!isAbsolute(directory) || resolve(directory) !== directory || canonical !== directory
    || !metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid()
    || (metadata.mode & 0o7777) !== 0o700) fail();
}
function checkedFile(metadata: Stats): void {
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== uid()
    || (metadata.mode & 0o7777) !== 0o600 || metadata.size < 1 || metadata.size > maximumBytes) fail();
}
function unchanged(before: Stats, after: Stats): void {
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail();
}

export function sharedDerivedRecipeBindingPath(directory: string, appId: string): string {
  if (!sharedDerivedRecipeAdapter(appId)) fail();
  return join(directory, `derived-recipe-${appId}.json`);
}

function decoded(bytes: Buffer, directory: string, appId: string): SharedDerivedRecipeBinding {
  let binding: SharedDerivedRecipeBinding;
  try { binding = JSON.parse(bytes.toString("utf8")); } catch { fail(); }
  if (!binding || sharedDerivedBindingDirectory(binding) !== directory || binding.selection?.appId !== appId
    || binding.derived?.input?.appId !== appId) fail();
  if (binding.kind === "shared-derived-recipe-binding") assertSharedDerivedRecipeUnchanged(binding.source, binding);
  else if (binding.kind !== "shared-derived-create-binding") fail();
  checkedSourceRevision(directory, binding);
  return binding;
}

function readPrivateBytes(path: string): Buffer {
  if (realpathSync(path) !== path) fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd); checkedFile(before);
    const bytes = readFileSync(fd);
    unchanged(before, fstatSync(fd)); unchanged(before, statSync(path));
    if (bytes.length !== before.size || realpathSync(path) !== path) fail();
    return bytes;
  } finally { closeSync(fd); }
}

function readRevision(directory: string, revision: number): SharedProjectState {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 999999) fail();
  const stateDirectory = join(directory, "state");
  checkedDirectory(stateDirectory, lstatSync(stateDirectory), realpathSync(stateDirectory));
  const bytes = readPrivateBytes(join(stateDirectory, `revision-${String(revision).padStart(6, "0")}.json`));
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(); }
}

function checkedSourceRevision(directory: string, binding: SharedDerivedRecipeBinding): void {
  if (binding.kind === "shared-derived-create-binding") {
    const first = readRevision(directory, 1);
    if (first.revision !== 1 || first.previousHash !== null
      || first.checkpoint.operation !== "create" || first.checkpoint.phase !== "reviewed") fail();
    restoreSharedDerivedRecipeSelection(first, binding);
    return;
  }
  const recorded = readRevision(directory, binding.source.revision);
  if (JSON.stringify(recorded) !== JSON.stringify(binding.source)) fail();
}

function checkedAddRevision(directory: string, binding: SharedDerivedRecipeBinding, current: SharedProjectState): void {
  if (binding.kind === "shared-derived-create-binding") {
    checkedSourceRevision(directory, binding);
    restoreSharedDerivedRecipeSelection(current, binding);
    return;
  }
  const first = readRevision(directory, binding.source.revision + 1);
  if (first.revision !== binding.source.revision + 1 || first.previousHash !== binding.source.recordHash
    || first.checkpoint.operation !== "add" || first.checkpoint.phase !== "reviewed"
    || !first.checkpoint.appIds.includes(binding.selection.appId)
    || current.revision < first.revision) fail();
  restoreSharedDerivedRecipeSelection(first, binding);
  if (current.revision === first.revision && current.recordHash !== first.recordHash) fail();
}

/** Safe immutable app records only; missing records never fall back to a guessed recipe. */
export function loadSharedDerivedRecipeBindingSync(directory: string, appId: string,
  current?: SharedProjectState): SharedDerivedRecipeBinding {
  checkedDirectory(directory, lstatSync(directory), realpathSync(directory));
  const path = sharedDerivedRecipeBindingPath(directory, appId);
  const binding = decoded(readPrivateBytes(path), directory, appId);
  if (current) {
    checkedAddRevision(directory, binding, current);
    restoreSharedDerivedRecipeSelection(current, binding);
  }
  return binding;
}

export async function loadSharedDerivedRecipeBinding(directory: string, appId: string,
  current?: SharedProjectState): Promise<SharedDerivedRecipeBinding> {
  // Bindings are bounded local owner records; reuse exactly the synchronous consumers' checks.
  return loadSharedDerivedRecipeBindingSync(directory, appId, current);
}

/** Caller holds the shared owner lock and exact create/add approval.
 * Fresh bindings require the actual first reviewed create journal revision.
 * No directory creation, secret reads, overwrite, Docker action, or acceptance claim. */
export async function prepareSharedDerivedRecipeBinding(current: SharedProjectState,
  binding: SharedDerivedRecipeBinding): Promise<string> {
  const directory = sharedDerivedBindingDirectory(binding);
  if (binding.kind === "shared-derived-create-binding") {
    if (current.revision !== 1 || current.checkpoint.operation !== "create"
      || current.checkpoint.phase !== "reviewed" || current.previousHash !== null) fail();
    restoreSharedDerivedRecipeSelection(current, binding);
  } else if (current.recordHash === binding.source.recordHash) assertSharedDerivedRecipeUnchanged(current, binding);
  else {
    if (current.revision !== binding.source.revision + 1 || current.checkpoint.operation !== "add"
      || current.checkpoint.phase !== "reviewed" || current.previousHash !== binding.source.recordHash) fail();
    restoreSharedDerivedRecipeSelection(current, binding);
    checkedAddRevision(directory, binding, current);
  }
  checkedDirectory(directory, await lstat(directory), await realpath(directory));
  checkedSourceRevision(directory, binding);
  const path = sharedDerivedRecipeBindingPath(directory, binding.selection.appId);
  const bytes = Buffer.from(JSON.stringify(binding) + "\n");
  if (bytes.length < 1 || bytes.length > maximumBytes) fail();
  let file;
  try { file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const saved = loadSharedDerivedRecipeBindingSync(directory, binding.selection.appId);
    if (JSON.stringify(saved) !== JSON.stringify(binding)) fail();
    return path;
  }
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  // Validate exact metadata and bytes after the durable write; never repair a partial artifact.
  const saved = loadSharedDerivedRecipeBindingSync(directory, binding.selection.appId);
  if (JSON.stringify(saved) !== JSON.stringify(binding)) fail();
  return path;
}
