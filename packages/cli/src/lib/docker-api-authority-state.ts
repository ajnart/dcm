import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { approveDockerApiAuthorityIntent, assertDockerApiAuthorityIntent, DockerApiAuthorityError,
  planDockerApiAuthority, type DockerApiAuthorityApproval, type DockerApiAuthorityInput } from "./docker-api-authority.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(): never { throw new DockerApiAuthorityError("unsafe-state"); }
function unchanged(a: Stats, b: Stats): void {
  if (a.ino !== b.ino || a.dev !== b.dev || a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs) fail();
}
export async function checkDockerApiAuthorityDirectory(directory: string, projectId: string): Promise<void> {
  try {
    const metadata = await lstat(directory);
    if (!isAbsolute(directory) || resolve(directory) !== directory || basename(directory) !== projectId
      || await realpath(directory) !== directory || !metadata.isDirectory() || metadata.isSymbolicLink()
      || process.getuid?.() !== metadata.uid || (metadata.mode & 0o7777) !== 0o700) fail();
  } catch { fail(); }
}
function safeName(name: string): void {
  if (!/^docker-api-authority-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{64}(?:-[0-9]{6})?-(?:input|intent|attempt|observation)\.json$/.test(name)) fail();
}
/** Owner records only, not secrets. No path selection from payload data. */
export async function readDockerApiAuthorityRecord(directory: string, projectId: string, name: string): Promise<unknown> {
  await checkDockerApiAuthorityDirectory(directory, projectId); safeName(name);
  const path = join(directory, name);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail();
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.()
      || (before.mode & 0o7777) !== 0o600 || before.size < 2 || before.size > 65536
      || await realpath(path) !== path) fail();
    const bytes = await handle.readFile();
    unchanged(before, await handle.stat()); unchanged(before, await stat(path));
    if (bytes.length !== before.size || await realpath(path) !== path) fail();
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || Object.keys(value).sort().join(",") !== "directory,record,recordHash,schemaVersion"
      || value.schemaVersion !== 1 || value.directory !== directory
      || value.recordHash !== hash({ schemaVersion: 1, directory, record: value.record })) fail();
    return value.record;
  } catch { fail(); }
  finally { await handle.close(); }
}
/** Caller holds shared-owner lock and has revalidated current owner. Exclusive,
 * durable, immutable writes; uncertain/partial records are never repaired. */
export async function saveDockerApiAuthorityRecord(directory: string, projectId: string,
  name: string, record: unknown): Promise<string> {
  await checkDockerApiAuthorityDirectory(directory, projectId); safeName(name);
  const envelope = { schemaVersion: 1, directory, record };
  const bytes = Buffer.from(JSON.stringify({ ...envelope, recordHash: hash(envelope) }) + "\n");
  if (bytes.length > 65536) fail();
  const path = join(directory, name);
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") fail();
    if (JSON.stringify(await readDockerApiAuthorityRecord(directory, projectId, name)) !== JSON.stringify(record)) fail();
    return path;
  }
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
  if (JSON.stringify(await readDockerApiAuthorityRecord(directory, projectId, name)) !== JSON.stringify(record)) fail();
  return path;
}
export function dockerApiAuthorityRecordName(input: DockerApiAuthorityInput, nowMs: number,
  kind: "intent" | "attempt" | "observation"): string {
  const plan = planDockerApiAuthority(input, nowMs);
  return `docker-api-authority-${input.id}-${plan.fingerprint}-${kind}.json`;
}

/** Append-only read probes can be refreshed after their observation expires.
 * A bounded exact-owner scan never discovers endpoints or secret paths. */
export async function dockerApiAuthorityProbeRecords(directory: string, input: DockerApiAuthorityInput,
  nowMs: number): Promise<{ generation: number; attempt: string; observation: string }> {
  await checkDockerApiAuthorityDirectory(directory, input.owner.projectId);
  const prefix = `docker-api-authority-${input.id}-${planDockerApiAuthority(input, nowMs).fingerprint}`;
  const entries = await readdir(directory);
  if (entries.length > 4096) fail();
  let generation = 0;
  for (const entry of entries) {
    if (!entry.startsWith(prefix + "-")) continue;
    const match = /^([0-9]{6})-(?:attempt|observation)\.json$/.exec(entry.slice(prefix.length + 1));
    if (match) generation = Math.max(generation, Number(match[1]));
  }
  let selected = prefix;
  if (generation > 0) selected += `-${String(generation).padStart(6, "0")}`;
  return { generation, attempt: `${selected}-attempt.json`, observation: `${selected}-observation.json` };
}

export function nextDockerApiAuthorityProbeRecords(input: DockerApiAuthorityInput,
  nowMs: number, generation: number) {
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 999999) fail();
  const prefix = `docker-api-authority-${input.id}-${planDockerApiAuthority(input, nowMs).fingerprint}-${String(generation).padStart(6, "0")}`;
  return { generation, attempt: `${prefix}-attempt.json`, observation: `${prefix}-observation.json` };
}
export async function loadDockerApiAuthorityIntent(directory: string, input: DockerApiAuthorityInput,
  nowMs: number): Promise<DockerApiAuthorityApproval> {
  const value = await readDockerApiAuthorityRecord(directory, input.owner.projectId,
    dockerApiAuthorityRecordName(input, nowMs, "intent"));
  if (!value) throw new DockerApiAuthorityError("missing-intent");
  return assertDockerApiAuthorityIntent(input, value, nowMs);
}
export async function persistDockerApiAuthorityIntent(directory: string, input: DockerApiAuthorityInput,
  approval: string, nowMs: number): Promise<DockerApiAuthorityApproval> {
  const plan = planDockerApiAuthority(input, nowMs);
  if (approval !== plan.approval) throw new DockerApiAuthorityError("approval-required");
  const name = dockerApiAuthorityRecordName(input, nowMs, "intent");
  const existing = await readDockerApiAuthorityRecord(directory, input.owner.projectId, name);
  if (existing) return assertDockerApiAuthorityIntent(input, existing, nowMs);
  const intent = approveDockerApiAuthorityIntent(plan, approval, nowMs);
  await saveDockerApiAuthorityRecord(directory, input.owner.projectId, name, intent);
  return loadDockerApiAuthorityIntent(directory, input, nowMs);
}
