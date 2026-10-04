import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function assertPackagedCatalogProject(root: string): Promise<void> {
  const path = join(root, ".selfhost", "project.json");
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("unable to inspect the saved project catalog source");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1
    || info.size < 1 || info.size > 512 * 1024) {
    throw new Error("saved project state is unsafe; inspect it before setup");
  }
  if (process.platform !== "win32" && ((info.mode & 0o7177) !== 0
    || info.uid !== process.getuid?.())) {
    throw new Error("saved project state must be owner-only before setup");
  }
  let state: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid state");
    }
    state = value as Record<string, unknown>;
  } catch {
    throw new Error("saved project state is unreadable; inspect it before setup");
  }
  if (state.schemaVersion === 1 || state.schemaVersion === 2) {
    if (Object.hasOwn(state, "catalogSource")) {
      throw new Error("saved project catalog source is invalid; inspect it before setup");
    }
    return;
  }
  if (state.schemaVersion === 3) {
    const source = state.catalogSource;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("saved project catalog source is invalid; inspect it before setup");
    }
    const kind = (source as Record<string, unknown>).kind;
    if (kind === "external") {
      throw new Error("this project uses an external read-only catalog; bundled installers cannot apply its recipes");
    }
    if (kind !== "bundled") {
      throw new Error("saved project catalog source is invalid; inspect it before setup");
    }
    return;
  }
  throw new Error("saved project version is unsupported; inspect it before setup");
}
