import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import type { PrivateConfigDeclaration } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-config-environment.ts";
import { isCanonicalPrivateBase64 } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-config-environment.ts";

type Entry = Record<string, any>;
export type PrivateConfig = PrivateConfigDeclaration;

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkedPrivateConfigs(recipe: Entry): Map<string, PrivateConfig> {
  const configs = new Map<string, PrivateConfig>();
  if (recipe.privateConfigs === undefined) return configs;
  if (!Array.isArray(recipe.privateConfigs) || !Array.isArray(recipe.privateFiles)) {
    throw new Error("Private configuration declarations are invalid");
  }
  const files = new Map<string, Entry>();
  for (const file of recipe.privateFiles) files.set(file.id, file);
  for (const config of recipe.privateConfigs) {
    if (!config || Object.keys(config).sort().join(",") !== "id,officialUrl,parts"
      || typeof config.id !== "string" || !identifier.test(config.id)
      || files.has(config.id) || configs.has(config.id)
      || typeof config.officialUrl !== "string"
      || !Array.isArray(config.parts) || config.parts.length < 1 || config.parts.length > 64) {
      throw new Error("Private configuration declaration is invalid");
    }
    let url: URL;
    try { url = new URL(config.officialUrl); }
    catch { throw new Error("Private configuration documentation URL is invalid"); }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      throw new Error("Private configuration documentation must use HTTPS");
    }
    let literalBytes = 0;
    let references = 0;
    for (const part of config.parts) {
      if (!part || typeof part !== "object") throw new Error("Private configuration part is invalid");
      const keys = Object.keys(part).join(",");
      if (keys === "literal") {
        if (typeof part.literal !== "string" || part.literal.length === 0
          || /\0|\$\{|\$\(|`/.test(part.literal)) {
          throw new Error("Private configuration literal is invalid");
        }
        literalBytes += Buffer.byteLength(part.literal);
        if (literalBytes > 16384) throw new Error("Private configuration literals exceed their size limit");
      } else if (keys === "fileId") {
        const file = files.get(part.fileId);
        if (typeof part.fileId !== "string" || !identifier.test(part.fileId)
          || !file || file.source !== undefined
          || !Number.isInteger(file.bytes) || file.bytes < 32 || file.bytes > 128
          || !["base64url", "alphanumeric", "hex", "base64"].includes(file.format ?? "base64url")) {
          throw new Error("Private configuration requires a supported generated private file");
        }
        references += 1;
      } else {
        throw new Error("Private configuration part is invalid");
      }
    }
    if (references === 0) throw new Error("Private configuration must reference a generated private file");
    configs.set(config.id, config);
  }
  return configs;
}

function intact(metadata: Stats, expected?: Stats): boolean {
  return metadata.isFile() && metadata.uid === process.getuid?.()
    && metadata.nlink === 1 && (metadata.mode & 0o777) === 0o600
    && (!expected || (metadata.dev === expected.dev && metadata.ino === expected.ino
      && metadata.size === expected.size));
}

async function readPrivate(path: string, limit: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!intact(before) || before.size < 1 || before.size > limit || await realpath(path) !== path) {
    throw new Error("Private configuration file must be an intact owner-only regular file");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!intact(await handle.stat(), before)) throw new Error("Private configuration file changed during inspection");
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== before.size || !intact(await handle.stat(), before)
      || !intact(await lstat(path), before)) {
      throw new Error("Private configuration file changed during reading");
    }
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

/** Read only an already prepared, exact owner-only configuration; never print its payload. */
export async function readPreparedPrivateConfig(directory: string, id: string): Promise<string> {
  if (!identifier.test(id)) throw new Error("Private configuration reference is invalid");
  return (await readPrivate(join(directory, id), 4096)).toString("utf8");
}

export async function preparePrivateConfigs(recipe: Entry, fileDirectory: string): Promise<void> {
  const configs = checkedPrivateConfigs(recipe);
  if (configs.size === 0) return;
  const directory = await lstat(fileDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || directory.uid !== process.getuid?.() || (directory.mode & 0o777) !== 0o700
    || await realpath(fileDirectory) !== fileDirectory) {
    throw new Error("Private configuration directory must be a current-user-owned mode-0700 real directory");
  }
  for (const config of configs.values()) {
    const parts: Buffer[] = [];
    for (const part of config.parts) {
      if ("literal" in part) {
        parts.push(Buffer.from(part.literal));
      } else {
        const value = await readPrivate(join(fileDirectory, part.fileId), 16384);
        const file = recipe.privateFiles.find((entry: Entry) => entry.id === part.fileId);
        const text = value.toString("utf8");
        let valid = /^[A-Za-z0-9_-]+$/.test(text);
        if (file.format === "base64") valid = isCanonicalPrivateBase64(text, file.bytes);
        if (!valid || value.some((byte) => byte > 127)) {
          throw new Error("Private configuration source content is invalid");
        }
        parts.push(value);
      }
    }
    const payload = Buffer.concat(parts);
    const target = join(fileDirectory, config.id);
    let created: Stats | undefined;
    try {
      const handle = await open(target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(payload);
        await handle.sync();
        created = await handle.stat();
        if (!intact(created) || created.size !== payload.length) {
          throw new Error("Private configuration output is not intact");
        }
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const saved = await readPrivate(target, payload.length);
    if (!saved.equals(payload) || (created && !intact(await lstat(target), created))) {
      throw new Error("Private configuration differs from its expected saved value");
    }
  }
}
