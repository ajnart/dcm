import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

const digestPattern = /^[0-9a-f]{64}$/;
const approvalPattern = /^sha256:[0-9a-f]{64}$/;
const runtimePathPattern = /^([a-z0-9-]+\/)*[a-z0-9.-]+$/;

type RuntimeFile = { path: string; sha256: string; mode: number };
type RuntimeManifest = { schemaVersion: 1; files: RuntimeFile[]; [key: string]: unknown };
type Transition = { fromSha256: string; toSha256: string; approvalDigest: string };
type TransitionLedger = { schemaVersion: 1; baseSha256: string; transitions: Transition[] };
type SyncJournal = {
  schemaVersion: 1;
  fromSha256: string;
  toSha256: string;
  approvalDigest: string;
  phase: "prepared" | "installing" | "runtime-installed" | "committed";
};

export type MediaRuntimePaths = { root: string; local: string; harness: string };

function fail(message: string): never { throw new Error(message); }
function sha(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function safeOwner(owner: number, packaged: boolean) {
  if (typeof process.getuid !== "function") return true;
  if (owner === process.getuid()) return true;
  return packaged && owner === 0;
}

async function validateCanonicalDirectory(path: string, label: string, ownerOnly: boolean) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !safeOwner(metadata.uid, false)) {
    fail(`${label} must be a real current-owner directory`);
  }
  if (await realpath(path) !== path) fail(`${label} must use its exact canonical path`);
  const mode = metadata.mode & 0o777;
  if (ownerOnly && mode !== 0o700) fail(`${label} must use mode 0700`);
  if (!ownerOnly && (mode & 0o022) !== 0) fail(`${label} must not be group- or world-writable`);
}

async function validateRuntimePaths(paths: MediaRuntimePaths) {
  if (paths.local !== join(paths.root, ".selfhost")
    || paths.harness !== join(paths.local, "media-harness")) {
    fail("Media runtime paths do not match the exact project root");
  }
  await validateCanonicalDirectory(paths.root, "Project root", false);
  await validateCanonicalDirectory(paths.local, ".selfhost", true);
  await validateCanonicalDirectory(paths.harness, "Installed media runtime", true);
}

async function readOwnerJson(path: string, label: string): Promise<Record<string, unknown>> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || !safeOwner(metadata.uid, false) || (metadata.mode & 0o777) !== 0o600) {
    fail(`Unsafe ${label}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, "utf8")); }
  catch { fail(`Invalid ${label}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(`Invalid ${label}`);
  return parsed as Record<string, unknown>;
}

async function syncDirectory(path: string) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function writeOwnerJson(path: string, value: unknown) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await syncDirectory(dirname(path));
}

function parseRuntimeManifest(value: unknown): RuntimeManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid media runtime manifest");
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) fail("Invalid media runtime manifest");
  const seen = new Set<string>();
  const files: RuntimeFile[] = [];
  for (const value of manifest.files) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid media runtime file record");
    const record = value as Record<string, unknown>;
    if (typeof record.path !== "string" || !runtimePathPattern.test(record.path) || seen.has(record.path)
      || typeof record.sha256 !== "string" || !digestPattern.test(record.sha256)
      || typeof record.mode !== "number" || ![0o644, 0o755].includes(record.mode)) {
      fail("Invalid media runtime file record");
    }
    seen.add(record.path);
    files.push({ path: record.path, sha256: record.sha256, mode: record.mode });
  }
  return { ...manifest, schemaVersion: 1, files };
}

async function walkRuntime(path: string, expected: Set<string>, packaged: boolean, prefix = "") {
  for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
    let relative = entry.name;
    if (prefix) relative = `${prefix}/${entry.name}`;
    const metadata = await lstat(join(path, relative));
    if (metadata.isSymbolicLink() || !safeOwner(metadata.uid, packaged)) fail(`Unsafe media runtime entry: ${relative}`);
    if (!packaged && relative === ".sessions") {
      if (!metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) fail("Unsafe private media sessions directory");
      continue;
    }
    if (metadata.isDirectory()) {
      if (![...expected].some((file) => file.startsWith(`${relative}/`))) {
        fail(`Unexpected media runtime directory: ${relative}`);
      }
      if (!packaged && (metadata.mode & 0o777) !== 0o700) fail(`Unsafe media runtime directory: ${relative}`);
      if (packaged && (metadata.mode & 0o002) !== 0) fail(`World-writable packaged media directory: ${relative}`);
      await walkRuntime(path, expected, packaged, relative);
      continue;
    }
    if (!metadata.isFile() || metadata.nlink !== 1 || !expected.has(relative)) {
      fail(`Unexpected media runtime entry: ${relative}`);
    }
  }
}

async function verifyRuntime(path: string, packaged: boolean) {
  const root = await lstat(path);
  if (!root.isDirectory() || root.isSymbolicLink() || !safeOwner(root.uid, packaged)) fail("Unsafe media runtime directory");
  if (!packaged && (root.mode & 0o777) !== 0o700) fail("Installed media runtime must use mode 0700");
  const manifestPath = join(path, "runtime-manifest.json");
  const manifestMetadata = await lstat(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink() || manifestMetadata.nlink !== 1
    || !safeOwner(manifestMetadata.uid, packaged)
    || (!packaged && (manifestMetadata.mode & 0o777) !== 0o600)) fail("Unsafe media runtime manifest");
  const manifestContent = await readFile(manifestPath);
  const manifest = parseRuntimeManifest(JSON.parse(manifestContent.toString("utf8")));
  const expected = new Set<string>(["runtime-manifest.json"]);
  for (const record of manifest.files) {
    expected.add(record.path);
    const metadata = await lstat(join(path, record.path));
    const mode = metadata.mode & 0o777;
    let unsafeMode = mode !== record.mode;
    if (packaged) {
      unsafeMode = (metadata.mode & 0o7000) !== 0 || (mode & 0o002) !== 0
        || (mode & 0o400) === 0
        || ((record.mode & 0o100) !== 0 && (mode & 0o100) === 0);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || !safeOwner(metadata.uid, packaged) || unsafeMode) fail(`Unsafe media runtime file: ${record.path}`);
    if (sha(await readFile(join(path, record.path))) !== record.sha256) fail(`Media runtime changed: ${record.path}`);
  }
  await walkRuntime(path, expected, packaged);
  return { manifest, manifestSha256: sha(manifestContent) };
}

function parseLedger(value: Record<string, unknown>): TransitionLedger {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["baseSha256", "schemaVersion", "transitions"])
    || value.schemaVersion !== 1 || typeof value.baseSha256 !== "string" || !digestPattern.test(value.baseSha256)
    || !Array.isArray(value.transitions)) fail("Invalid media runtime transition ledger");
  const transitions: Transition[] = [];
  let expectedFrom = value.baseSha256;
  for (const raw of value.transitions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Invalid media runtime transition ledger");
    const entry = raw as Record<string, unknown>;
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["approvalDigest", "fromSha256", "toSha256"])
      || entry.fromSha256 !== expectedFrom || typeof entry.toSha256 !== "string" || !digestPattern.test(entry.toSha256)
      || entry.toSha256 === entry.fromSha256 || typeof entry.approvalDigest !== "string"
      || !approvalPattern.test(entry.approvalDigest)) fail("Invalid media runtime transition ledger");
    transitions.push({
      fromSha256: entry.fromSha256 as string,
      toSha256: entry.toSha256,
      approvalDigest: entry.approvalDigest,
    });
    expectedFrom = entry.toSha256;
  }
  return { schemaVersion: 1, baseSha256: value.baseSha256, transitions };
}

async function readLedger(local: string): Promise<TransitionLedger | null> {
  const path = join(local, "media-runtime-transitions.json");
  if (!existsSync(path)) return null;
  return parseLedger(await readOwnerJson(path, "media runtime transition ledger"));
}

function ledgerTip(ledger: TransitionLedger) {
  const last = ledger.transitions.at(-1);
  if (last) return last.toSha256;
  return ledger.baseSha256;
}

export async function runtimeTransitionAllows(local: string, fromSha256: string, toSha256: string) {
  const ledger = await readLedger(local);
  if (fromSha256 === toSha256) {
    if (ledger && ledgerTip(ledger) !== toSha256) return false;
    return true;
  }
  if (!ledger || ledgerTip(ledger) !== toSha256) return false;
  let current = ledger.baseSha256;
  let started = current === fromSha256;
  for (const transition of ledger.transitions) {
    if (started && transition.fromSha256 !== current) return false;
    current = transition.toSha256;
    if (!started && transition.fromSha256 === fromSha256) started = true;
  }
  return started && current === toSha256;
}

function parseJournal(value: Record<string, unknown>): SyncJournal {
  if (JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify(["approvalDigest", "fromSha256", "phase", "schemaVersion", "toSha256"])
    || value.schemaVersion !== 1 || typeof value.fromSha256 !== "string" || !digestPattern.test(value.fromSha256)
    || typeof value.toSha256 !== "string" || !digestPattern.test(value.toSha256)
    || typeof value.approvalDigest !== "string" || !approvalPattern.test(value.approvalDigest)
    || !new Set(["prepared", "installing", "runtime-installed", "committed"]).has(String(value.phase))) {
    fail("Invalid media runtime sync journal");
  }
  return value as SyncJournal;
}

export async function assertNoRuntimeSyncTransaction(local: string) {
  const journal = join(local, "media-runtime-sync.json");
  if (!existsSync(journal)) return;
  const pending = parseJournal(await readOwnerJson(journal, "media runtime sync journal"));
  fail(`Media runtime sync is incomplete. Resume the exact approved apply for ${pending.approvalDigest} before using this runtime`);
}

async function ownerDirectory(path: string) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !safeOwner(metadata.uid, false)
    || (metadata.mode & 0o777) !== 0o700) fail("Unsafe media runtime transaction directory");
}

async function ensureOwnerDirectory(path: string) {
  if (!existsSync(path)) await mkdir(path, { recursive: true, mode: 0o700 });
  await ownerDirectory(path);
}

async function removeOwnedTemporaryDirectories(parent: string, prefix: string) {
  if (!existsSync(parent)) return;
  await ownerDirectory(parent);
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix)) continue;
    const path = join(parent, entry.name);
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !safeOwner(metadata.uid, false)
      || (metadata.mode & 0o777) !== 0o700) fail("Unsafe interrupted media runtime transaction directory");
    await rm(path, { recursive: true });
  }
}

async function copyRuntime(source: string, destination: string, sourceManifest: RuntimeManifest) {
  await mkdir(destination, { mode: 0o700 });
  for (const record of sourceManifest.files) {
    const target = join(destination, record.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(join(source, record.path), target, constants.COPYFILE_EXCL);
    await chmod(target, record.mode);
  }
  await copyFile(join(source, "runtime-manifest.json"), join(destination, "runtime-manifest.json"), constants.COPYFILE_EXCL);
  await chmod(join(destination, "runtime-manifest.json"), 0o600);
}

async function contentAddressedCopy(parent: string, digest: string, source: string, manifest: RuntimeManifest) {
  await ensureOwnerDirectory(parent);
  const destination = join(parent, digest);
  if (existsSync(destination)) {
    if (existsSync(join(destination, ".sessions"))) fail("Content-addressed media runtime copy contains private sessions");
    const verified = await verifyRuntime(destination, false);
    if (verified.manifestSha256 !== digest) fail("Content-addressed media runtime copy has the wrong manifest");
    return destination;
  }
  const staging = await mkdtemp(join(parent, ".runtime-copy-"));
  await chmod(staging, 0o700);
  try {
    for (const record of manifest.files) {
      const target = join(staging, record.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(join(source, record.path), target, constants.COPYFILE_EXCL);
      await chmod(target, record.mode);
    }
    await copyFile(join(source, "runtime-manifest.json"), join(staging, "runtime-manifest.json"), constants.COPYFILE_EXCL);
    await chmod(join(staging, "runtime-manifest.json"), 0o600);
    const verified = await verifyRuntime(staging, false);
    if (verified.manifestSha256 !== digest) fail("Staged media runtime copy has the wrong manifest");
    await rename(staging, destination);
    await syncDirectory(parent);
  } finally {
    if (existsSync(staging)) await rm(staging, { recursive: true });
  }
  return destination;
}

async function walkPartial(path: string, allowed: Set<string>, prefix = "") {
  for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
    let relative = entry.name;
    if (prefix) relative = `${prefix}/${entry.name}`;
    const metadata = await lstat(join(path, relative));
    if (metadata.isSymbolicLink() || !safeOwner(metadata.uid, false)) fail(`Unsafe partial media runtime entry: ${relative}`);
    if (relative === ".sessions") {
      if (!metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) fail("Unsafe private media sessions directory");
      continue;
    }
    if (metadata.isDirectory()) {
      if (![...allowed].some((file) => file.startsWith(`${relative}/`)) || (metadata.mode & 0o777) !== 0o700) {
        fail(`Unexpected partial media runtime directory: ${relative}`);
      }
      await walkPartial(path, allowed, relative);
      continue;
    }
    if (!metadata.isFile() || metadata.nlink !== 1 || !allowed.has(relative)) {
      fail(`Unexpected partial media runtime entry: ${relative}`);
    }
  }
}

async function verifyPartialRuntime(path: string, from: RuntimeManifest, to: RuntimeManifest,
  fromSha256: string, toSha256: string) {
  const root = await lstat(path);
  if (!root.isDirectory() || root.isSymbolicLink() || !safeOwner(root.uid, false) || (root.mode & 0o777) !== 0o700) {
    fail("Unsafe partial media runtime directory");
  }
  const allowed = new Set<string>(["runtime-manifest.json"]);
  const alternatives = new Map<string, RuntimeFile[]>();
  for (const record of [...from.files, ...to.files]) {
    allowed.add(record.path);
    const records = alternatives.get(record.path) ?? [];
    records.push(record);
    alternatives.set(record.path, records);
  }
  await walkPartial(path, allowed);
  const manifestMetadata = await lstat(join(path, "runtime-manifest.json"));
  const manifestHash = sha(await readFile(join(path, "runtime-manifest.json")));
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink() || manifestMetadata.nlink !== 1
    || (manifestMetadata.mode & 0o777) !== 0o600 || ![fromSha256, toSha256].includes(manifestHash)) {
    fail("Partial media runtime has an unsafe manifest");
  }
  for (const [relative, records] of alternatives) {
    const file = join(path, relative);
    if (!existsSync(file)) continue;
    const metadata = await lstat(file);
    const contentHash = sha(await readFile(file));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || !safeOwner(metadata.uid, false)
      || !records.some((record) => record.sha256 === contentHash && record.mode === (metadata.mode & 0o777))) {
      fail(`Partial media runtime file is not an old or new verified version: ${relative}`);
    }
  }
}

async function removeEmptyRuntimeDirectories(root: string, manifest: RuntimeManifest) {
  const directories = new Set<string>();
  for (const record of manifest.files) {
    let parent = dirname(record.path);
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  const ordered = [...directories].sort((left, right) => right.split("/").length - left.split("/").length);
  for (const relative of ordered) {
    try { await rmdir(join(root, relative)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function installFromVerifiedCopy(paths: MediaRuntimePaths, source: string, sourceManifest: RuntimeManifest,
  previousManifest: RuntimeManifest) {
  const writer = await mkdtemp(join(paths.local, ".media-runtime-write-"));
  await chmod(writer, 0o700);
  try {
    await copyRuntime(source, join(writer, "runtime"), sourceManifest);
    const payload = join(writer, "runtime");
    await verifyRuntime(payload, false);
    const nextPaths = new Set(sourceManifest.files.map((record) => record.path));
    for (const record of sourceManifest.files) {
      const destination = join(paths.harness, record.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await chmod(dirname(destination), 0o700);
      await rename(join(payload, record.path), destination);
    }
    for (const record of previousManifest.files) {
      if (!nextPaths.has(record.path) && existsSync(join(paths.harness, record.path))) {
        await unlink(join(paths.harness, record.path));
      }
    }
    await removeEmptyRuntimeDirectories(paths.harness, previousManifest);
    await rename(join(payload, "runtime-manifest.json"), join(paths.harness, "runtime-manifest.json"));
    await syncDirectory(paths.harness);
  } finally {
    if (existsSync(writer)) await rm(writer, { recursive: true });
  }
}

function runtimeDiff(from: RuntimeManifest, to: RuntimeManifest) {
  const oldFiles = new Map(from.files.map((record) => [record.path, record]));
  const newFiles = new Map(to.files.map((record) => [record.path, record]));
  const added = [...newFiles.keys()].filter((path) => !oldFiles.has(path)).sort();
  const removed = [...oldFiles.keys()].filter((path) => !newFiles.has(path)).sort();
  const changed = [...newFiles.keys()].filter((path) => {
    const old = oldFiles.get(path);
    const current = newFiles.get(path)!;
    return old !== undefined && (old.sha256 !== current.sha256 || old.mode !== current.mode);
  }).sort();
  return { added, changed, removed };
}

async function plan(paths: MediaRuntimePaths, packagedRuntime: string) {
  const packaged = await verifyRuntime(packagedRuntime, true);
  const installed = await verifyRuntime(paths.harness, false);
  const ledger = await readLedger(paths.local);
  if (ledger && ledgerTip(ledger) !== installed.manifestSha256) {
    fail("Installed media runtime does not match the transition ledger tip");
  }
  if (installed.manifestSha256 === packaged.manifestSha256) {
    return {
      schema: "selfhost-media-runtime-sync-plan/v1",
      action: "already-current" as const,
      live: false,
      projectRoot: paths.root,
      installedSha256: installed.manifestSha256,
      packagedSha256: packaged.manifestSha256,
      approvalDigest: null,
      sessionsPreserved: true,
      dockerMutation: false,
      files: runtimeDiff(installed.manifest, packaged.manifest),
    };
  }
  const facts = {
    schema: "selfhost-media-runtime-sync-plan/v1",
    action: "replace-runtime" as const,
    live: false,
    projectRoot: paths.root,
    installedSha256: installed.manifestSha256,
    packagedSha256: packaged.manifestSha256,
    sessionsPreserved: true,
    dockerMutation: false,
    files: runtimeDiff(installed.manifest, packaged.manifest),
  };
  return { ...facts, approvalDigest: `sha256:${sha(JSON.stringify(facts))}` };
}

async function appendTransition(local: string, transition: Transition) {
  const path = join(local, "media-runtime-transitions.json");
  const existing = await readLedger(local);
  let next: TransitionLedger;
  if (!existing) {
    next = { schemaVersion: 1, baseSha256: transition.fromSha256, transitions: [transition] };
  } else {
    if (ledgerTip(existing) !== transition.fromSha256) fail("Media runtime transition no longer starts at the ledger tip");
    next = { ...existing, transitions: [...existing.transitions, transition] };
  }
  await writeOwnerJson(path, next);
}

function hasTransition(ledger: TransitionLedger | null, journal: SyncJournal) {
  return ledger?.transitions.some((entry) => entry.fromSha256 === journal.fromSha256
    && entry.toSha256 === journal.toSha256 && entry.approvalDigest === journal.approvalDigest) === true;
}

async function apply(paths: MediaRuntimePaths, packagedRuntime: string, approval: string) {
  if (!approvalPattern.test(approval)) fail("--approve must be the sha256-prefixed digest from a fresh runtime-sync plan");
  const journalPath = join(paths.local, "media-runtime-sync.json");
  let currentJournal: SyncJournal | null = null;
  if (existsSync(journalPath)) currentJournal = parseJournal(await readOwnerJson(journalPath, "media runtime sync journal"));
  const resuming = currentJournal !== null;

  const packaged = await verifyRuntime(packagedRuntime, true);
  if (currentJournal) {
    if (currentJournal.approvalDigest !== approval) fail("A different approved media runtime sync is incomplete");
    if (currentJournal.toSha256 !== packaged.manifestSha256) {
      fail("The incomplete media runtime sync needs the exact CLI package that created its plan");
    }
  }

  let syncPlan: Awaited<ReturnType<typeof plan>> | null = null;
  if (!currentJournal) {
    syncPlan = await plan(paths, packagedRuntime);
    if (syncPlan.action !== "replace-runtime" || syncPlan.approvalDigest === null) {
      fail("Installed media runtime is already current; there is no apply action");
    }
    if (syncPlan.approvalDigest !== approval) fail("Runtime sync plan changed; review a fresh plan before apply");
    currentJournal = {
      schemaVersion: 1,
      fromSha256: syncPlan.installedSha256,
      toSha256: syncPlan.packagedSha256,
      approvalDigest: approval,
      phase: "prepared",
    };
  }

  const rollbackRoot = join(paths.local, "media-runtime-rollbacks");
  const stagingRoot = join(paths.local, "media-runtime-staging");
  await removeOwnedTemporaryDirectories(paths.local, ".media-runtime-write-");
  await removeOwnedTemporaryDirectories(rollbackRoot, ".runtime-copy-");
  await removeOwnedTemporaryDirectories(stagingRoot, ".runtime-copy-");
  let backup: string;
  let staged: string;
  if (existsSync(journalPath)) {
    backup = join(rollbackRoot, currentJournal.fromSha256);
    staged = join(stagingRoot, currentJournal.toSha256);
    if (!existsSync(backup) || !existsSync(staged)) fail("Incomplete media runtime sync is missing its verified recovery copy");
  } else {
    const installed = await verifyRuntime(paths.harness, false);
    if (installed.manifestSha256 !== currentJournal.fromSha256) fail("Installed media runtime changed before sync staging");
    backup = await contentAddressedCopy(rollbackRoot, currentJournal.fromSha256, paths.harness, installed.manifest);
    staged = await contentAddressedCopy(stagingRoot, currentJournal.toSha256, packagedRuntime, packaged.manifest);
    await writeOwnerJson(journalPath, currentJournal);
  }

  const oldRuntime = await verifyRuntime(backup, false);
  const newRuntime = await verifyRuntime(staged, false);
  if (existsSync(join(backup, ".sessions")) || existsSync(join(staged, ".sessions"))) {
    fail("Media runtime recovery copies must not contain private sessions");
  }
  if (oldRuntime.manifestSha256 !== currentJournal.fromSha256
    || newRuntime.manifestSha256 !== currentJournal.toSha256) fail("Media runtime recovery copies do not match the approved transition");

  const existingLedger = await readLedger(paths.local);
  if (hasTransition(existingLedger, currentJournal)) {
    const installed = await verifyRuntime(paths.harness, false);
    if (installed.manifestSha256 !== currentJournal.toSha256) fail("Committed media runtime transition does not match the installed runtime");
    await rm(journalPath);
    await rm(staged, { recursive: true });
    return { schema: "selfhost-media-runtime-sync-result/v1", action: "applied", live: true,
      projectRoot: paths.root, fromSha256: currentJournal.fromSha256, toSha256: currentJournal.toSha256,
      approvalDigest: approval, recovered: true, sessionsPreserved: true, dockerMutation: false };
  }

  await verifyPartialRuntime(paths.harness, oldRuntime.manifest, newRuntime.manifest,
    currentJournal.fromSha256, currentJournal.toSha256);
  try {
    currentJournal.phase = "installing";
    await writeOwnerJson(journalPath, currentJournal);
    await installFromVerifiedCopy(paths, staged, newRuntime.manifest, oldRuntime.manifest);
    const installed = await verifyRuntime(paths.harness, false);
    if (installed.manifestSha256 !== currentJournal.toSha256) fail("Installed media runtime does not match the approved target");
    currentJournal.phase = "runtime-installed";
    await writeOwnerJson(journalPath, currentJournal);
    await appendTransition(paths.local, {
      fromSha256: currentJournal.fromSha256,
      toSha256: currentJournal.toSha256,
      approvalDigest: currentJournal.approvalDigest,
    });
    currentJournal.phase = "committed";
    await writeOwnerJson(journalPath, currentJournal);
  } catch (error) {
    const ledger = await readLedger(paths.local);
    if (hasTransition(ledger, currentJournal)) throw error;
    await verifyPartialRuntime(paths.harness, oldRuntime.manifest, newRuntime.manifest,
      currentJournal.fromSha256, currentJournal.toSha256);
    await installFromVerifiedCopy(paths, backup, oldRuntime.manifest, newRuntime.manifest);
    const restored = await verifyRuntime(paths.harness, false);
    if (restored.manifestSha256 !== currentJournal.fromSha256) {
      fail("Media runtime sync failed and automatic rollback could not verify the old runtime; retain the journal and recovery copies");
    }
    await rm(journalPath);
    throw new Error(`Media runtime sync failed and rolled back to ${currentJournal.fromSha256}: ${(error as Error).message}`);
  }
  await rm(journalPath);
  await rm(staged, { recursive: true });
  return { schema: "selfhost-media-runtime-sync-result/v1", action: "applied", live: true,
    projectRoot: paths.root, fromSha256: currentJournal.fromSha256, toSha256: currentJournal.toSha256,
    approvalDigest: approval, recovered: resuming, sessionsPreserved: true, dockerMutation: false };
}

export async function mediaRuntimeSync(action: "plan" | "apply", paths: MediaRuntimePaths,
  packagedRuntime: string, approval: string | null) {
  await assertNoUnexpectedTransactionArguments(action, approval);
  await validateRuntimePaths(paths);
  if (action === "plan") return plan(paths, packagedRuntime);
  return apply(paths, packagedRuntime, approval!);
}

async function assertNoUnexpectedTransactionArguments(action: "plan" | "apply", approval: string | null) {
  if (action === "plan" && approval !== null) fail("runtime-sync plan does not accept --approve");
  if (action === "apply" && approval === null) fail("runtime-sync apply needs --approve TOKEN");
}

export async function withMediaRuntimeLock<T>(root: string, callback: () => Promise<T>): Promise<T> {
  const lockPath = join(root, ".selfhost-media-runtime.lock");
  const createLock = async () => {
    const candidate = `${lockPath}.candidate-${process.pid}-${randomUUID()}`;
    const handle = await open(candidate,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, pid: process.pid })}\n`);
      await handle.sync();
      await link(candidate, lockPath);
    } finally {
      await handle.close();
      if (existsSync(candidate)) await unlink(candidate);
    }
    return open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  };
  let handle;
  try { handle = await createLock(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const metadata = await lstat(lockPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !safeOwner(metadata.uid, false)
      || (metadata.mode & 0o777) !== 0o600) fail("Unsafe media runtime lock");
    if (metadata.nlink === 2) {
      fail(`Media runtime lock acquisition is active or was interrupted. This CLI will not reclaim it. Confirm no media CLI process is active, then remove only the exact owner-only lock and candidate hardlink shown for ${lockPath}`);
    }
    if (metadata.nlink !== 1) fail("Unsafe media runtime lock");
    const lock = await readOwnerJson(lockPath, "media runtime lock");
    if (JSON.stringify(Object.keys(lock).sort()) !== JSON.stringify(["pid", "schemaVersion"])
      || lock.schemaVersion !== 1 || !Number.isInteger(lock.pid) || Number(lock.pid) <= 0) fail("Invalid media runtime lock");
    fail(`Media runtime lock exists for PID ${lock.pid}. This CLI will not reclaim it. Confirm no media CLI process is active, then remove only ${lockPath} before retrying`);
  }
  try {
    return await callback();
  } finally {
    const owned = await handle.stat();
    await handle.close();
    if (existsSync(lockPath)) {
      const current = await lstat(lockPath);
      if (current.dev === owned.dev && current.ino === owned.ino) await unlink(lockPath);
    }
  }
}
