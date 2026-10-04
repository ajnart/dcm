import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { assertPrivatePath, ownedByCurrentUser, privateMode, protectPrivatePath } from "./platform-private.ts";

type FileIdentity = { dev: number; ino: number };

export class BatchMutationLockError extends Error {
  constructor(message: string, readonly partialWritePossible = false) {
    super(message);
    this.name = "BatchMutationLockError";
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function removeOwnedPath(path: string, owner: FileIdentity): Promise<void> {
  let current;
  try { current = await lstat(path); }
  catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (current.dev !== owner.dev || current.ino !== owner.ino) {
    throw new BatchMutationLockError(`Mutation lock path changed; left ${path} untouched for inspection`, true);
  }
  await unlink(path);
}

async function requirePrivateParent(root: string): Promise<string> {
  if (!isAbsolute(root) || resolve(root) !== root) {
    throw new BatchMutationLockError("Batch mutation lock needs an exact absolute project root");
  }
  const parent = join(root, ".selfhost");
  const info = await lstat(parent);
  assertPrivatePath(parent, 0o700);
  if (!info.isDirectory() || info.isSymbolicLink()
    || !ownedByCurrentUser(info)
    || !privateMode(info, 0o700) || await realpath(parent) !== parent) {
    throw new BatchMutationLockError(".selfhost must be an owner-only real directory (0700) at the exact project root");
  }
  return parent;
}

async function requireProjectRoot(root: string): Promise<string> {
  if (!isAbsolute(root) || resolve(root) !== root) {
    throw new BatchMutationLockError("App mutation lock needs an exact absolute project root");
  }
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()
    || !ownedByCurrentUser(info)
    || (process.platform !== "win32" && (info.mode & 0o022) !== 0) || await realpath(root) !== root) {
    throw new BatchMutationLockError("App mutation lock needs a current-user-owned real project root without group or world write access");
  }
  if (process.platform === "win32") assertPrivatePath(root, 0o700);
  return root;
}

async function existingLockError(parent: string, lockPath: string, label: string): Promise<Error> {
  let info;
  try { info = await lstat(lockPath); }
  catch (error) {
    if (!isMissing(error)) throw error;
    return new BatchMutationLockError(`${label} mutation lock changed during acquisition at ${lockPath}; inspect that exact path before retrying`);
  }
  if (!info.isFile() || info.isSymbolicLink()
    || !ownedByCurrentUser(info)
    || !privateMode(info, 0o600) || info.nlink < 1 || info.nlink > 2) {
    return new BatchMutationLockError(`Unsafe ${label} mutation lock at ${lockPath}; inspect that exact path before retrying. This CLI will not reclaim it`);
  }
  assertPrivatePath(lockPath, 0o600);
  const paths = [lockPath];
  if (info.nlink === 2) {
    const prefix = `${basename(lockPath)}.candidate-`;
    for (const name of await readdir(parent)) {
      if (!name.startsWith(prefix)
        || !/^[1-9][0-9]*-[0-9a-f-]{36}$/.test(name.slice(prefix.length))) continue;
      const path = join(parent, name);
      let candidate;
      try { candidate = await lstat(path); }
      catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      if (candidate.dev === info.dev && candidate.ino === info.ino) paths.push(path);
    }
    if (paths.length !== 2) {
      let current;
      try { current = await lstat(lockPath); }
      catch (error) {
        if (!isMissing(error)) throw error;
        return new BatchMutationLockError(`${label} mutation lock changed during acquisition at ${lockPath}; recheck before retrying`);
      }
      if (current.dev === info.dev && current.ino === info.ino && current.nlink === 1) {
        return new BatchMutationLockError(`${label} mutation lock already exists. This CLI will not reclaim it. Confirm no matching CLI process is active, then remove only ${lockPath} before retrying`);
      }
      return new BatchMutationLockError(`${label} mutation lock at ${lockPath} has an unlocated hardlink; inspect both links before retrying. This CLI will not reclaim it`);
    }
  }
  return new BatchMutationLockError(`${label} mutation lock already exists. This CLI will not reclaim it. Confirm no matching CLI process is active, then remove only ${paths.join(" and ")} before retrying`);
}

async function withHardlinkLock<T>(parent: string, lockPath: string, label: string,
  callback: () => Promise<T>): Promise<T> {
  const candidate = `${lockPath}.candidate-${process.pid}-${randomUUID()}`;
  const handle = await open(candidate,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let owner: FileIdentity | undefined;
  let acquired = false;
  try {
    owner = await handle.stat();
    protectPrivatePath(candidate, 0o600);
    await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, pid: process.pid })}\n`);
    await handle.sync();
    try {
      await link(candidate, lockPath);
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw await existingLockError(parent, lockPath, label);
    }
    await removeOwnedPath(candidate, owner);
    return await callback();
  } finally {
    try {
      if (acquired && owner) await removeOwnedPath(lockPath, owner);
    } finally {
      try { if (owner) await removeOwnedPath(candidate, owner); }
      finally { await handle.close(); }
    }
  }
}

export async function withBatchMutationLock<T>(root: string, callback: () => Promise<T>): Promise<T> {
  const parent = await requirePrivateParent(root);
  return withHardlinkLock(parent, join(parent, ".app-batch-run.lock"), "Batch", callback);
}

export async function withAppMutationLock<T>(root: string, appId: string,
  callback: () => Promise<T>): Promise<T> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appId) || appId.length > 47) {
    throw new BatchMutationLockError("App mutation lock needs one bounded app ID");
  }
  const parent = await requireProjectRoot(root);
  return withHardlinkLock(parent, join(parent, `.selfhost-app-${appId}.run.lock`), "App", callback);
}

export async function withAppPortMutationLock<T>(root: string, port: number,
  callback: () => Promise<T>): Promise<T> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new BatchMutationLockError("App port mutation lock needs one valid host TCP port");
  }
  const parent = await requireProjectRoot(root);
  return withHardlinkLock(parent, join(parent, `.selfhost-port-${port}.run.lock`),
    `App port ${port}`, callback);
}

/** Serializes one shared project and every selected frontend port before any project files change. */
export async function withSharedProjectMutationLock<T>(root: string, projectId: string,
  ports: number[], callback: () => Promise<T>): Promise<T> {
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(projectId)
    || !Array.isArray(ports) || ports.length > 16
    || new Set(ports).size !== ports.length) {
    throw new BatchMutationLockError("Shared-project lock needs one bounded project ID and distinct selected ports");
  }
  const parent = await requireProjectRoot(root);
  const ordered = [...ports].sort((left, right) => left - right);
  const withPorts = async (index: number): Promise<T> => {
    if (index === ordered.length) return callback();
    return withAppPortMutationLock(root, ordered[index], () => withPorts(index + 1));
  };
  return withHardlinkLock(parent, join(parent, `.selfhost-shared-${projectId}.run.lock`),
    "Shared project", () => withPorts(0));
}
