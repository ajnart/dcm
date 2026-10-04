import { assertPrivatePath, ownedByCurrentUser } from "../lib/platform-private.ts";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { MAX_SHARED_APPS } from "../lib/shared-project-limits.ts";

const appIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function samePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
  }
  return left === right;
}

async function privateSelectionPath(root: string): Promise<string> {
  const directory = join(root, ".selfhost");
  const stat = await lstat(directory);
  if (process.platform === "win32") assertPrivatePath(directory, 0o700);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (process.platform !== "win32" && (stat.mode & 0o077) !== 0) || !samePath(await realpath(directory), directory)
    || !ownedByCurrentUser(stat)) {
    throw new Error("The saved project configuration is not an owner-only real directory");
  }
  return join(directory, "control-panel.json");
}

export async function excludedAppIds(root: string): Promise<string[]> {
  let path: string;
  try { path = await privateSelectionPath(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192
    || (process.platform !== "win32" && (stat.mode & 0o077) !== 0) || !samePath(await realpath(path), path)
    || !ownedByCurrentUser(stat)) {
    throw new Error("The saved app selection is not an owner-only regular file");
  }
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid app selection");
  const selection = value as { schemaVersion?: unknown; excludedAppIds?: unknown };
  if (selection.schemaVersion !== 1 || !Array.isArray(selection.excludedAppIds)
    || selection.excludedAppIds.length > MAX_SHARED_APPS
    || selection.excludedAppIds.some((id) => typeof id !== "string" || id.length > 47 || !appIdPattern.test(id))
    || new Set(selection.excludedAppIds).size !== selection.excludedAppIds.length) {
    throw new Error("Invalid saved app selection");
  }
  return selection.excludedAppIds;
}

export async function saveExcludedAppIds(root: string, ids: readonly string[]): Promise<void> {
  if (ids.length > MAX_SHARED_APPS || ids.some((id) => id.length > 47 || !appIdPattern.test(id))) {
    throw new Error("Invalid app selection");
  }
  const path = await privateSelectionPath(root);
  const sorted = [...new Set(ids)].sort();
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, excludedAppIds: sorted })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
