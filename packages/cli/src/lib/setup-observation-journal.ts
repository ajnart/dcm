import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { assertPrivatePath, ownedByCurrentUser, privateMode, protectPrivatePath } from "./platform-private.ts";
import type { SetupObserver } from "../control-panel/setup-engine.ts";
import type { SetupCompatibilityResult } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";

export type SetupObservationIdentity = {
  appId: string;
  projectId: string;
  ownerRevision: number;
  manifestHash: string;
  recipeSha256: string;
  setupSubjectSha256: string;
  images: Record<string, string>;
};

export type SetupObservationEvent = {
  ordinal: number;
  attemptId: string;
  phase: "first-run" | "inspect";
  outcome: "attempted" | "adapter-ready" | "failed" | "deferred";
  identity: SetupObservationIdentity;
  /** Present only for newly observed, app-owned live result facts. */
  compatibility?: { checkedAt: string; result: SetupCompatibilityResult };
};

type Journal = { schemaVersion: 1; revision: number; events: SetupObservationEvent[] };
// One catalog-wide run can require several deferred approval rounds per app.
// Keep bounded history large enough for those rounds and later owner reuse.
const MAX_EVENTS = 4096;
const MAX_BYTES = 16 * 1024 * 1024;
const LABEL = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const HASH = /^[0-9a-f]{64}$/;

function fail(): never { throw new Error("Setup observation journal is unsafe, stale, full or changed"); }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
  return value as Record<string, unknown>;
}

function identity(value: unknown): SetupObservationIdentity {
  const row = exact(value, ["appId", "projectId", "ownerRevision", "manifestHash", "recipeSha256", "setupSubjectSha256", "images"]);
  if (typeof row.appId !== "string" || !LABEL.test(row.appId) || row.appId.length > 64
    || typeof row.projectId !== "string" || !LABEL.test(row.projectId) || row.projectId.length > 64
    || !Number.isSafeInteger(row.ownerRevision) || Number(row.ownerRevision) < 1
    || [row.manifestHash, row.recipeSha256, row.setupSubjectSha256].some((v) => typeof v !== "string" || !HASH.test(v))
    || !row.images || typeof row.images !== "object" || Array.isArray(row.images)) fail();
  const images: Record<string, string> = {};
  const entries = Object.entries(row.images).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 1 || entries.length > 32) fail();
  for (const [key, value] of entries) {
    if (!LABEL.test(key) || key.length > 64 || typeof value !== "string" || value.length > 512
      || !/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[0-9a-f]{64}$/.test(value)) fail();
    images[key] = value;
  }
  return { appId: row.appId, projectId: row.projectId, ownerRevision: Number(row.ownerRevision),
    manifestHash: String(row.manifestHash), recipeSha256: String(row.recipeSha256),
    setupSubjectSha256: String(row.setupSubjectSha256), images };
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function owned(metadata: ReturnType<typeof lstatSync>, mode: number): void {
  if (!privateMode(metadata, mode) || !ownedByCurrentUser(metadata)) fail();
}
function directory(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) fail();
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail();
  owned(metadata, 0o700);
  assertPrivatePath(path, 0o700);
}

function read(path: string): Journal {
  if (process.platform === "win32") {
    try { assertPrivatePath(path, 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, revision: 0, events: [] };
    fail();
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > MAX_BYTES) fail();
    owned(before, 0o600);
    const bytes = readFileSync(fd, "utf8");
    const after = fstatSync(fd);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs) fail();
    let raw: unknown;
    try { raw = JSON.parse(bytes); } catch { fail(); }
    const row = exact(raw, ["schemaVersion", "revision", "events"]);
    if (row.schemaVersion !== 1 || !Array.isArray(row.events) || row.events.length > MAX_EVENTS
      || row.revision !== row.events.length) fail();
    const attempts = new Map<string, SetupObservationEvent>();
    const completed = new Set<string>();
    const events = row.events.map((raw, index): SetupObservationEvent => {
      const keys = ["ordinal", "attemptId", "phase", "outcome", "identity"];
      if (raw && typeof raw === "object" && Object.hasOwn(raw, "compatibility")) keys.push("compatibility");
      const event = exact(raw, keys);
      if (event.ordinal !== index + 1 || typeof event.attemptId !== "string"
        || !/^[0-9a-f-]{36}$/.test(event.attemptId)
        || !["first-run", "inspect"].includes(String(event.phase))
        || !["attempted", "adapter-ready", "failed", "deferred"].includes(String(event.outcome))) fail();
      if (event.compatibility !== undefined) {
        const facts = exact(event.compatibility, ["checkedAt", "result"]);
        const result = exact(facts.result, ["origin", "credentialReadback"]);
        if (event.outcome !== "adapter-ready" || event.phase !== "first-run"
          || typeof facts.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(facts.checkedAt)
          || !Number.isFinite(Date.parse(facts.checkedAt)) || new Date(facts.checkedAt).toISOString() !== facts.checkedAt
          || !["fresh", "resume"].includes(String(result.origin))
          || !["verified", "no-account-verified"].includes(String(result.credentialReadback))) fail();
      }
      const parsed = { ...event, identity: identity(event.identity) } as SetupObservationEvent;
      if (parsed.outcome === "attempted") {
        if (attempts.has(parsed.attemptId)) fail();
        attempts.set(parsed.attemptId, parsed);
      } else {
        const original = attempts.get(parsed.attemptId);
        if (!original || completed.has(parsed.attemptId) || parsed.phase !== original.phase
          || hash(parsed.identity) !== hash(original.identity)) fail();
        completed.add(parsed.attemptId);
      }
      return parsed;
    });
    return { schemaVersion: 1, revision: events.length, events };
  } finally { closeSync(fd); }
}

/** Read sanitized chronology only. No app checkpoint, secret file or runtime is opened. */
export function readSetupObservationJournal(ownerDirectory: string): readonly SetupObservationEvent[] {
  directory(ownerDirectory);
  return read(join(ownerDirectory, "setup-observations.json")).events;
}

/** Opt-in chronology plus sanitized app-owned live facts. Never restart or functional acceptance. */
export function createSetupObservationJournal(options: {
  directory: string;
  identity(appId: string): Promise<SetupObservationIdentity>;
  completed?(event: SetupObservationEvent): Promise<void>;
}): SetupObserver {
  const attempts = new Map<string, SetupObservationEvent>();
  function append(event: Omit<SetupObservationEvent, "ordinal">): SetupObservationEvent {
    directory(options.directory);
    const path = join(options.directory, "setup-observations.json");
    const lock = join(options.directory, "setup-observations.lock");
    let lockFd: number;
    try { lockFd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch { fail(); }
    let temporary: string | null = null;
    try {
      protectPrivatePath(lock, 0o600);
      const current = read(path);
      const same = current.events.find((item) => item.attemptId === event.attemptId && item.outcome !== "attempted");
      if (same) {
        if (same.outcome !== event.outcome || hash(same.identity) !== hash(event.identity)
          || hash(same.compatibility ?? null) !== hash(event.compatibility ?? null)) fail();
        return same;
      }
      const pending = new Set<string>();
      for (const item of current.events) {
        if (item.outcome === "attempted") pending.add(item.attemptId);
        else pending.delete(item.attemptId);
      }
      if (event.outcome === "attempted") {
        if (current.events.length + pending.size + 2 > MAX_EVENTS) fail();
      } else if (!pending.has(event.attemptId) || current.events.length >= MAX_EVENTS) fail();
      const next = { schemaVersion: 1, revision: current.revision + 1,
        events: [...current.events, { ...event, ordinal: current.revision + 1 }] };
      const bytes = JSON.stringify(next);
      if (Buffer.byteLength(bytes) > MAX_BYTES) fail();
      if (event.outcome === "attempted") {
        pending.add(event.attemptId);
        const reserved = next.events.filter((item) => item.outcome === "attempted" && pending.has(item.attemptId))
          .reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)) + 32, 0);
        if (Buffer.byteLength(bytes) + reserved > MAX_BYTES) fail();
      }
      temporary = join(options.directory, `setup-observations.${randomUUID()}.tmp`);
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        protectPrivatePath(temporary, 0o600);
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      directory(options.directory);
      renameSync(temporary, path);
      temporary = null;
      if (process.platform !== "win32") {
        const directoryFd = openSync(options.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      }
      return next.events[next.events.length - 1]!;
    } finally {
      if (temporary) unlinkSync(temporary);
      closeSync(lockFd);
      unlinkSync(lock);
    }
  }
  return {
    async before(call) {
      const bound = identity(await options.identity(call.appId));
      if (bound.appId !== call.appId || bound.projectId !== basename(options.directory)
        || !["first-run", "inspect"].includes(call.phase)) fail();
      const event: SetupObservationEvent = { ordinal: 0, attemptId: randomUUID(), phase: call.phase,
        outcome: "attempted", identity: bound };
      append(event);
      attempts.set(event.attemptId, event);
      return event.attemptId;
    },
    async after(attemptId, result) {
      const before = attempts.get(attemptId);
      if (!before || hash(identity(await options.identity(before.identity.appId))) !== hash(before.identity)) fail();
      const event: Omit<SetupObservationEvent, "ordinal"> = { ...before, outcome: "adapter-ready" };
      if (result) {
        if (before.phase !== "first-run" || Object.keys(result).sort().join() !== "credentialReadback,origin"
          || !["fresh", "resume"].includes(result.origin)
          || !["verified", "no-account-verified"].includes(result.credentialReadback)) fail();
        event.compatibility = { checkedAt: new Date().toISOString(), result: { ...result } };
      }
      const completed = append(event);
      if (completed.compatibility && options.completed) await options.completed(completed);
    },
    async error(attemptId, outcome) {
      const before = attempts.get(attemptId);
      if (!before || !["failed", "deferred"].includes(outcome)) fail();
      append({ ...before, outcome });
    },
  };
}
