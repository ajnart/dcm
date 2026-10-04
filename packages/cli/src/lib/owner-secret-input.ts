import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export type OwnerSecretSources = Record<string, { kind: "file"; path: string } | { kind: "stdin" }>;

export async function readOwnerSecretSources(sources: OwnerSecretSources): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = Object.create(null);
  const stdinIds = Object.keys(sources).filter((id) => sources[id]?.kind === "stdin");
  if (stdinIds.length > 1) throw new Error("Only one owner secret may use stdin");
  for (const [id, source] of Object.entries(sources)) {
    if (source.kind === "stdin") {
      if (process.stdin.isTTY) throw new Error("Owner secret stdin must be a non-interactive pipe");
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of process.stdin) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > 16384) throw new Error("Owner secret input exceeds 16384 bytes");
        chunks.push(bytes);
      }
      if (length === 0) throw new Error("Owner secret stdin must contain one nonempty payload");
      result[id] = Buffer.concat(chunks);
      continue;
    }
    if (!isAbsolute(source.path) || resolve(source.path) !== source.path) {
      throw new Error("Owner secret source must be an exact absolute path");
    }
    const metadata = await lstat(source.path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o600
      || metadata.size < 1 || metadata.size > 16384 || await realpath(source.path) !== source.path) {
      throw new Error("Owner secret source must be one current-user-owned mode-0600 regular file");
    }
    const handle = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (current.dev !== metadata.dev || current.ino !== metadata.ino || current.size !== metadata.size) {
        throw new Error("Owner secret source changed during read");
      }
      result[id] = await handle.readFile();
    } finally { await handle.close(); }
  }
  return result;
}
