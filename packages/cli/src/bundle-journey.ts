import { createHash, randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

type RecordValue = Record<string, unknown>;
type JourneyRuntime = {
  bootId: () => Promise<string>;
  monotonicNs: () => bigint | Promise<bigint>;
  wallTime: () => string;
};

export type FullJourneyEvidence = {
  state: "missing" | "active" | "invalidated" | "finished";
  path?: string;
  sha256?: string;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs: number | null;
  finalizationSha256?: string;
  prerequisites?: "validated-recorded";
  reason?: string;
};

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const MAX_JSON = 128 * 1024;
const MAX_EVIDENCE = 8 * 1024 * 1024;
const SERVICES = ["media", "immich", "docmost", "vaultwarden"];
const HOMARR_CHECKS = ["board", "widgets", "notebook", "search", "mcp"];

function fail(message: string): never { throw new Error(message); }

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as RecordValue;
}

function exact(value: RecordValue, keys: string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${name} fields are invalid`);
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  if (path === "") return true;
  if (path === ".." || path.startsWith(`..${sep}`)) return false;
  return !isAbsolute(path);
}

async function safeRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path || path === sep || path === resolve(homedir())) {
    fail("--project-root must be one exact absolute project path, not root or home");
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    fail("Project root must be one real directory");
  }
  if ((metadata.mode & 0o002) !== 0) fail("Project root must not be world-writable");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Project root has a different owner");
  return path;
}

async function ownerFile(root: string, path: string, name: string, maximum: number): Promise<Buffer> {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(root, path)) {
    fail(`${name} must be one exact path inside the project root`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path
    || metadata.size < 1 || metadata.size > maximum || (metadata.mode & 0o777) !== 0o600) {
    fail(`${name} must be one bounded owner-only regular file (0600) without links`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
  return readFile(path);
}

async function ownerJson(root: string, path: string, name: string): Promise<{ raw: Buffer; value: RecordValue }> {
  const raw = await ownerFile(root, path, name, MAX_JSON);
  let value: unknown;
  try { value = JSON.parse(raw.toString("utf8")); }
  catch { fail(`${name} is not valid JSON`); }
  return { raw, value: record(value, name) };
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string") fail(`${name} must be an ISO UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) fail(`${name} must be an ISO UTC timestamp`);
  return value;
}

function nanoseconds(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^[0-9]{1,24}$/.test(value)) fail(`${name} is invalid`);
  return BigInt(value);
}

function elapsedMs(started: bigint, current: bigint): number {
  if (current < started) fail("The monotonic clock precedes the recorded journey start");
  const milliseconds = (current - started) / 1_000_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) fail("Journey elapsed time exceeds the supported range");
  return Number(milliseconds);
}

async function defaultBootId(): Promise<string> {
  let value: string;
  try { value = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim().toLowerCase(); }
  catch { fail("Full-journey timing requires a Linux boot identity"); }
  if (!BOOT_ID.test(value)) fail("The Linux boot identity is invalid");
  return value;
}

async function defaultMonotonicNs(): Promise<bigint> {
  let value: string;
  try { value = (await readFile("/proc/uptime", "utf8")).trim().split(/\s+/)[0]; }
  catch { fail("Full-journey timing requires Linux monotonic uptime"); }
  const match = /^(0|[1-9][0-9]*)\.([0-9]{1,9})$/.exec(value);
  if (!match) fail("Linux monotonic uptime is invalid");
  const seconds = BigInt(match[1]);
  const fraction = BigInt(match[2].padEnd(9, "0"));
  return seconds * 1_000_000_000n + fraction;
}

const defaultRuntime: JourneyRuntime = {
  bootId: defaultBootId,
  monotonicNs: defaultMonotonicNs,
  wallTime: () => new Date().toISOString(),
};

function journalPath(root: string, id: string): string {
  return join(root, ".selfhost", "journeys", `${id}.json`);
}

async function ensureJournalDirectory(root: string): Promise<string> {
  const local = join(root, ".selfhost");
  if (!existsSync(local)) await mkdir(local, { mode: 0o700 });
  const localMetadata = await lstat(local);
  if (!localMetadata.isDirectory() || localMetadata.isSymbolicLink() || await realpath(local) !== local
    || (localMetadata.mode & 0o777) !== 0o700) fail(".selfhost must be one owner-only real directory (0700)");
  if (typeof process.getuid === "function" && localMetadata.uid !== process.getuid()) fail(".selfhost has a different owner");
  const ignore = join(local, ".gitignore");
  if (!existsSync(ignore)) {
    const handle = await open(ignore, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile("*\n"); await handle.sync(); }
    finally { await handle.close(); }
  }
  const ignoreMetadata = await lstat(ignore);
  if (!ignoreMetadata.isFile() || ignoreMetadata.isSymbolicLink() || ignoreMetadata.nlink !== 1
    || await realpath(ignore) !== ignore || (ignoreMetadata.mode & 0o777) !== 0o600
    || await readFile(ignore, "utf8") !== "*\n") {
    fail(".selfhost/.gitignore must be an owner-only wildcard ignore file");
  }
  if (typeof process.getuid === "function" && ignoreMetadata.uid !== process.getuid()) fail(".selfhost/.gitignore has a different owner");
  const directory = join(local, "journeys");
  if (!existsSync(directory)) await mkdir(directory, { mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory
    || (metadata.mode & 0o777) !== 0o700) fail("Journey directory must be one owner-only real directory (0700)");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Journey directory has a different owner");
  return directory;
}

async function createJournal(path: string, value: RecordValue): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  const parent = await open(dirname(path), constants.O_RDONLY);
  try { await parent.sync(); }
  finally { await parent.close(); }
}

async function replaceJournal(root: string, path: string, value: RecordValue): Promise<void> {
  await ownerJson(root, path, "journey journal");
  const temporary = join(dirname(path), `.journey-${randomBytes(12).toString("hex")}.json`);
  try {
    await createJournal(temporary, value);
    await rename(temporary, path);
    const parent = await open(dirname(path), constants.O_RDONLY);
    try { await parent.sync(); }
    finally { await parent.close(); }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function validateJournal(value: RecordValue, root: string, id: string): void {
  let keys = ["schemaVersion", "kind", "state", "projectRoot", "bundleId", "clock", "bootId",
    "startedAt", "startedMonotonicNs", "secretsAccepted"];
  if (value.state === "finished") {
    keys = [...keys, "finishedAt", "finishedMonotonicNs", "elapsedMs", "sameBoot", "bundleInputSha256",
      "finalizationSha256", "prerequisites", "independentlyVerified"];
  }
  exact(value, keys, "journey journal");
  if (value.schemaVersion !== 1 || value.kind !== "household-full-journey" || value.projectRoot !== root
    || value.bundleId !== id || value.clock !== "linux-proc-uptime" || !BOOT_ID.test(value.bootId as string)
    || value.secretsAccepted !== false || (value.state !== "active" && value.state !== "finished")) {
    fail("Journey journal identity is invalid");
  }
  timestamp(value.startedAt, "journey startedAt");
  nanoseconds(value.startedMonotonicNs, "journey startedMonotonicNs");
  if (value.state === "finished") {
    timestamp(value.finishedAt, "journey finishedAt");
    const finished = nanoseconds(value.finishedMonotonicNs, "journey finishedMonotonicNs");
    const started = nanoseconds(value.startedMonotonicNs, "journey startedMonotonicNs");
    if (value.elapsedMs !== elapsedMs(started, finished) || value.sameBoot !== true
      || !HASH.test(value.bundleInputSha256 as string) || !HASH.test(value.finalizationSha256 as string)
      || value.prerequisites !== "validated-recorded" || value.independentlyVerified !== false) {
      fail("Finished journey journal is invalid");
    }
  }
}

async function fingerprintReference(root: string, value: unknown, name: string, maximum = MAX_JSON): Promise<void> {
  const item = record(value, name);
  if (typeof item.path !== "string" || isAbsolute(item.path) || typeof item.sha256 !== "string" || !HASH.test(item.sha256)) {
    fail(`${name} identity is invalid`);
  }
  const path = resolve(root, item.path);
  if (!inside(root, path) || sha256(await ownerFile(root, path, name, maximum)) !== item.sha256) {
    fail(`${name} no longer matches its recorded hash`);
  }
}

function passingEvidence(value: unknown, name: string): RecordValue[] {
  const item = record(value, name);
  if (item.status !== "pass" || !Array.isArray(item.evidence) || item.evidence.length < 1) {
    fail(`${name} is not complete passing evidence`);
  }
  return item.evidence.map((entry, index) => record(entry, `${name}.evidence[${index}]`));
}

async function validateFinalization(root: string, input: string, id: string, inputSha256: string) {
  const path = join(dirname(input), "finalization.json");
  const loaded = await ownerJson(root, path, "finalization checkpoint");
  const value = loaded.value;
  const bundleInput = record(value.bundleInput, "finalization bundle input");
  const findings = record(value.findings, "finalization findings");
  if (value.schemaVersion !== 1 || value.kind !== "household-bundle-finalization-checkpoint"
    || value.bundleId !== id || value.projectRoot !== root || value.status !== "recorded"
    || value.independentlyVerified !== false || bundleInput.path !== relative(root, input)
    || bundleInput.sha256 !== inputSha256 || !Array.isArray(findings.blocked) || findings.blocked.length !== 0) {
    fail("Finalization checkpoint does not prove complete recorded prerequisites for this journey");
  }
  const timing = record(value.timing, "finalization timing");
  const cleanup = record(value.cleanup, "finalization cleanup");
  if (timing.status !== "measured" || timing.durationMs === null || cleanup.status !== "pass") {
    fail("Finalization timing and cleanup prerequisites are incomplete");
  }
  const references: Array<{ value: unknown; name: string; maximum?: number }> = [
    { value: value.evidenceManifest, name: "finalization evidence manifest" },
    { value: value.screenshot, name: "finalization screenshot", maximum: MAX_EVIDENCE },
  ];
  const applications = record(value.applications, "finalization applications");
  const homarr = record(value.homarr, "finalization Homarr evidence");
  exact(applications, SERVICES, "finalization applications");
  exact(homarr, HOMARR_CHECKS, "finalization Homarr evidence");
  for (const service of SERVICES) {
    for (const evidence of passingEvidence(applications[service], `applications.${service}`)) {
      references.push({ value: evidence, name: `applications.${service} evidence` });
    }
  }
  for (const check of HOMARR_CHECKS) {
    for (const evidence of passingEvidence(homarr[check], `homarr.${check}`)) {
      references.push({ value: evidence, name: `homarr.${check} evidence` });
    }
  }
  for (const evidence of passingEvidence(cleanup, "cleanup")) {
    references.push({ value: evidence, name: "cleanup evidence" });
  }
  for (const reference of references) {
    await fingerprintReference(root, reference.value, reference.name, reference.maximum);
  }
  return { path, raw: loaded.raw, sha256: sha256(loaded.raw) };
}

async function loadBundleIdentity(root: string, input: string, expectedId?: string) {
  const loaded = await ownerJson(root, input, "bundle input");
  const value = loaded.value;
  if (value.schemaVersion !== 1 || typeof value.id !== "string" || !ID.test(value.id)
    || value.projectRoot !== root || (expectedId !== undefined && value.id !== expectedId)) {
    fail("Bundle input identity is invalid");
  }
  return { id: value.id, sha256: sha256(loaded.raw) };
}

function parse(args: string[]): { action: string; root: string; id: string; input?: string } {
  const action = args[0];
  if (!action || !["start", "status", "finish"].includes(action)) {
    fail("Use bundle journey start|status|finish --project-root ABSOLUTE --id ID [--input ABSOLUTE]");
  }
  const flags: Record<string, string> = {};
  const allowed = new Set(["--project-root", "--id", "--input"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated bundle journey option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  if (!flags["--project-root"] || !flags["--id"] || !ID.test(flags["--id"])) {
    fail("bundle journey needs --project-root and one valid --id");
  }
  if (action === "finish" && !flags["--input"]) fail("bundle journey finish needs --input");
  if (action !== "finish" && flags["--input"]) fail("--input applies only to bundle journey finish");
  return { action, root: flags["--project-root"], id: flags["--id"], input: flags["--input"] };
}

export async function readFullJourneyEvidence(root: string, input: string, id: string,
  inputSha256: string, runtime: JourneyRuntime = defaultRuntime): Promise<FullJourneyEvidence> {
  const path = journalPath(root, id);
  if (!existsSync(path)) return { state: "missing", elapsedMs: null, reason: "No full-journey timer was started for this bundle." };
  const loaded = await ownerJson(root, path, "journey journal");
  validateJournal(loaded.value, root, id);
  const value = loaded.value;
  if (value.state === "active") {
    const bootId = await runtime.bootId();
    if (bootId !== value.bootId) {
      return { state: "invalidated", path: relative(root, path), sha256: sha256(loaded.raw),
        startedAt: value.startedAt as string, elapsedMs: null,
        reason: "The host rebooted after this journey started; cross-boot monotonic elapsed time cannot be measured." };
    }
    return { state: "active", path: relative(root, path), sha256: sha256(loaded.raw),
      startedAt: value.startedAt as string,
      elapsedMs: elapsedMs(nanoseconds(value.startedMonotonicNs, "journey startedMonotonicNs"), await runtime.monotonicNs()),
      reason: "The journey has not been finished against complete finalization evidence." };
  }
  if (value.bundleInputSha256 !== inputSha256) fail("Finished journey does not match the selected bundle input");
  const finalization = await validateFinalization(root, input, id, inputSha256);
  if (value.finalizationSha256 !== finalization.sha256) fail("Finished journey does not match the current finalization checkpoint");
  return { state: "finished", path: relative(root, path), sha256: sha256(loaded.raw),
    startedAt: value.startedAt as string, finishedAt: value.finishedAt as string,
    elapsedMs: value.elapsedMs as number, finalizationSha256: finalization.sha256,
    prerequisites: "validated-recorded" };
}

export async function bundleJourneyCommand(args: string[], runtime: JourneyRuntime = defaultRuntime): Promise<void> {
  const parsed = parse(args);
  const root = await safeRoot(parsed.root);
  const path = journalPath(root, parsed.id);
  if (parsed.action === "start") {
    if (existsSync(join(root, ".selfhost", "bundles", parsed.id))) {
      fail("Journey timing must start before bundle initialization and host inspection evidence is recorded");
    }
    await ensureJournalDirectory(root);
    if (existsSync(path)) fail("A journey journal already exists for this bundle ID");
    const bootId = await runtime.bootId();
    if (!BOOT_ID.test(bootId)) fail("The Linux boot identity is invalid");
    const startedAt = timestamp(runtime.wallTime(), "journey startedAt");
    await createJournal(path, { schemaVersion: 1, kind: "household-full-journey", state: "active",
      projectRoot: root, bundleId: parsed.id, clock: "linux-proc-uptime", bootId,
      startedAt, startedMonotonicNs: (await runtime.monotonicNs()).toString(), secretsAccepted: false });
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, kind: "household-full-journey-status",
      status: "active", mutation: "owner-only-journey-journal", bundleId: parsed.id,
      journal: relative(root, path), startedAt, elapsedMs: 0,
      boundary: "Started now from the host monotonic clock; no historical elapsed time was inferred." }, null, 2)}\n`);
    return;
  }
  if (!existsSync(path)) fail("No journey journal exists for this bundle ID");
  const loaded = await ownerJson(root, path, "journey journal");
  validateJournal(loaded.value, root, parsed.id);
  if (parsed.action === "status") {
    let status = loaded.value.state as string;
    let measured: number | null = null;
    if (typeof loaded.value.elapsedMs === "number") measured = loaded.value.elapsedMs;
    let reason: string | null = null;
    if (loaded.value.state === "active") {
      if (await runtime.bootId() === loaded.value.bootId) {
        measured = elapsedMs(nanoseconds(loaded.value.startedMonotonicNs, "journey startedMonotonicNs"), await runtime.monotonicNs());
      } else {
        status = "invalidated";
        measured = null;
        reason = "The host rebooted after start; this timer cannot produce a cross-boot elapsed value.";
      }
    }
    let sameBoot = reason === null;
    if (loaded.value.state === "finished") sameBoot = true;
    let prerequisites: unknown = "pending";
    if (loaded.value.prerequisites !== undefined) prerequisites = loaded.value.prerequisites;
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, kind: "household-full-journey-status",
      status, mutation: false, bundleId: parsed.id, journal: relative(root, path),
      startedAt: loaded.value.startedAt, finishedAt: loaded.value.finishedAt ?? null,
      elapsedMs: measured, sameBoot,
      prerequisites, independentlyVerified: false, reason }, null, 2)}\n`);
    return;
  }
  if (loaded.value.state !== "active") fail("This journey is already finished");
  const bootId = await runtime.bootId();
  if (bootId !== loaded.value.bootId) fail("The host rebooted after journey start; finish cannot fabricate cross-boot elapsed time");
  const input = parsed.input as string;
  const bundle = await loadBundleIdentity(root, input, parsed.id);
  const finalization = await validateFinalization(root, input, parsed.id, bundle.sha256);
  const finishedMonotonicNs = await runtime.monotonicNs();
  const duration = elapsedMs(nanoseconds(loaded.value.startedMonotonicNs, "journey startedMonotonicNs"), finishedMonotonicNs);
  const finishedAt = timestamp(runtime.wallTime(), "journey finishedAt");
  const completed = { ...loaded.value, state: "finished", finishedAt,
    finishedMonotonicNs: finishedMonotonicNs.toString(), elapsedMs: duration, sameBoot: true,
    bundleInputSha256: bundle.sha256, finalizationSha256: finalization.sha256,
    prerequisites: "validated-recorded", independentlyVerified: false };
  await replaceJournal(root, path, completed);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, kind: "household-full-journey-status",
    status: "finished", mutation: "owner-only-journey-journal", bundleId: parsed.id,
    journal: relative(root, path), startedAt: loaded.value.startedAt, finishedAt,
    elapsedMs: duration, sameBoot: true, prerequisites: "validated-recorded",
    independentlyVerified: false,
    boundary: "Elapsed time is monotonic and complete finalization evidence is hash-bound; acceptance remains recorded, not independently verified." }, null, 2)}\n`);
}
