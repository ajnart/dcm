import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

function samePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
  }
  return left === right;
}

export async function savedAppIds(root: string): Promise<string[]> {
  const directory = join(root, ".selfhost", "app-state");
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || !samePath(await realpath(directory), directory)
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("Saved app state must be a current-user-owned private real directory");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 64) throw new Error("Too many saved app state files to review");
  const ids: string[] = [];
  for (const entry of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(entry.name)) continue;
    if (!entry.isFile()) throw new Error(`Unsafe saved app state entry: ${entry.name}`);
    ids.push(entry.name.slice(0, -5));
  }
  return ids.sort();
}
