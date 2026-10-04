import { createHash, randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseMediaNetworkSubnets } from "./media-network-subnets.ts";

type RecordValue = Record<string, unknown>;
type BundleIdentity = {
  id: string;
  projectRoot: string;
  runIds: Record<Service, string>;
  inputSha256: string;
  inputFingerprints: Record<string, string>;
};
type Service = "media" | "immich" | "docmost" | "vaultwarden";
type EvidenceIdentity = { subject: string; runId: string; check: string };
type FileSummary = { path: string; sha256: string; observedAt: string; observer: string };

const SERVICES: Service[] = ["media", "immich", "docmost", "vaultwarden"];
const HOMARR_CHECKS = ["board", "widgets", "notebook", "search", "mcp"] as const;
const STAGES = ["media", "immich", "docmost", "vaultwarden", "homarr"] as const;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const OBSERVER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const REFERENCE = /^[a-z][a-z0-9+.-]*:[A-Za-z0-9._~:/#@+-]{1,240}$/;
const SECRET_WORD = /(?:password|passwd|secret|api[-_]?key|authorization|bearer|cookie|session[-_]?id|private[-_]?key)/i;
const MAX_JSON = 128 * 1024;
const MAX_EVIDENCE = 64 * 1024;
const MAX_SCREENSHOT = 8 * 1024 * 1024;

function fail(message: string): never { throw new Error(message); }

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as RecordValue;
}

function rejectUnknown(value: RecordValue, allowed: string[], name: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${name} has unsupported fields: ${unknown.sort().join(", ")}`);
}

function exact(value: RecordValue, keys: string[], name: string): void {
  rejectUnknown(value, keys, name);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) fail(`${name} is missing fields: ${missing.join(", ")}`);
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

async function boundedFile(root: string, path: string, name: string, maximum: number): Promise<Buffer> {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(root, path)) {
    fail(`${name} must be one exact path inside the project root`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || await realpath(path) !== path || metadata.size < 2 || metadata.size > maximum) {
    fail(`${name} must be one bounded regular file without links`);
  }
  if ((metadata.mode & 0o777) !== 0o600) fail(`${name} must use mode 0600`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
  return readFile(path);
}

function json(raw: Buffer, name: string): RecordValue {
  let value: unknown;
  try { value = JSON.parse(raw.toString("utf8")); }
  catch { fail(`${name} is not valid JSON`); }
  return record(value, name);
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !ID.test(value)) fail(`${name} is invalid`);
  return value;
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string") fail(`${name} must be an ISO UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) fail(`${name} must be an exact ISO UTC timestamp`);
  return value;
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function loadBundle(root: string, path: string, fingerprintReferences = true): Promise<BundleIdentity> {
  const raw = await boundedFile(root, path, "bundle input", MAX_JSON);
  const value = json(raw, "bundle input");
  exact(value, ["schemaVersion", "id", "projectRoot", "services"], "bundle input");
  if (value.schemaVersion !== 1 || value.projectRoot !== root) fail("Bundle input identity or project root is invalid");
  const id = identifier(value.id, "bundle id");
  const services = record(value.services, "bundle services");
  exact(services, SERVICES, "bundle services");
  const runIds = {} as Record<Service, string>;
  const inputFingerprints: Record<string, string> = {};
  for (const service of SERVICES) {
    const entry = record(services[service], `${service} service`);
    let keys = ["input", "runId", "accountFile"];
    if (service === "media") {
      keys = ["runId", "username", "credentialHandoff"];
      if (Object.hasOwn(entry, "mode")) keys.push("mode");
      if (Object.hasOwn(entry, "bindMode")) keys.push("bindMode");
      if (Object.hasOwn(entry, "portStart")) keys.push("portStart");
      if (Object.hasOwn(entry, "networkSubnets")) keys.push("networkSubnets");
    }
    if (service === "vaultwarden") keys.push("httpsPlan");
    exact(entry, keys, `${service} service`);
    runIds[service] = identifier(entry.runId, `${service} runId`);
    if (service === "media") {
      if (typeof entry.username !== "string" || !USERNAME.test(entry.username) || typeof entry.credentialHandoff !== "boolean") {
        fail("Media bundle identity is invalid");
      }
      if (entry.mode !== undefined && entry.mode !== "create" && entry.mode !== "adopt") fail("Media bundle mode is invalid");
      if (entry.bindMode !== undefined && entry.bindMode !== "host-only") fail("Media bundle bindMode is invalid");
      if (entry.portStart !== undefined && (typeof entry.portStart !== "number" || !Number.isInteger(entry.portStart)
        || entry.portStart < 20000 || entry.portStart > 44993)) fail("Media bundle portStart is invalid");
      if (entry.networkSubnets !== undefined) parseMediaNetworkSubnets(entry.networkSubnets);
      if (entry.mode === "adopt" && (entry.bindMode !== undefined || entry.portStart !== undefined || entry.networkSubnets !== undefined)) fail("Adopted media keeps its existing bind, port, and network selection");
    } else {
      for (const field of keys.filter((key) => key !== "runId")) {
        const referenced = entry[field];
        if (typeof referenced !== "string" || !isAbsolute(referenced) || resolve(referenced) !== referenced
          || !inside(root, referenced)) fail(`${service}.${field} must be one exact path inside the project root`);
        if (fingerprintReferences) {
          inputFingerprints[`${service}.${field}`] = sha256(await boundedFile(root, referenced,
            `${service}.${field}`, MAX_JSON));
        }
      }
    }
  }
  if (new Set(Object.values(runIds)).size !== SERVICES.length) fail("Bundle service run IDs must be distinct");
  return { id, projectRoot: root, runIds, inputSha256: sha256(raw), inputFingerprints };
}

function evidenceReference(value: unknown, name: string): string {
  if (typeof value !== "string" || !REFERENCE.test(value) || value.startsWith("http:") || value.startsWith("https:")
    || value.includes("?") || SECRET_WORD.test(value)) {
    fail(`${name} must be one redacted opaque reference without a URL, query, or secret-bearing label`);
  }
  return value;
}

async function loadEvidenceFile(root: string, path: string, identity: EvidenceIdentity,
  window: { start: number; end: number } | null): Promise<FileSummary> {
  const raw = await boundedFile(root, path, `${identity.check} evidence`, MAX_EVIDENCE);
  const value = json(raw, `${identity.check} evidence`);
  exact(value, ["schemaVersion", "kind", "bundleId", "subject", "runId", "check", "observedAt", "observer", "status", "evidenceRefs", "redacted"], `${identity.check} evidence`);
  if (value.schemaVersion !== 1 || value.kind !== "redacted-observation" || value.bundleId !== identity.subject.split(":")[0]
    || value.subject !== identity.subject || value.runId !== identity.runId || value.check !== identity.check) {
    fail(`${identity.check} evidence identity does not match this bundle checkpoint`);
  }
  if (value.redacted !== true) fail(`${identity.check} evidence must explicitly declare redacted: true`);
  if (value.status !== "pass") fail(`${identity.check} referenced evidence must have status pass`);
  const observedAt = timestamp(value.observedAt, `${identity.check} evidence observedAt`);
  if (typeof value.observer !== "string" || !OBSERVER.test(value.observer)) fail(`${identity.check} evidence observer is invalid`);
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1 || value.evidenceRefs.length > 16) {
    fail(`${identity.check} evidence needs one to sixteen opaque references`);
  }
  const references = value.evidenceRefs.map((reference, index) => evidenceReference(reference, `${identity.check} evidenceRefs[${index}]`));
  if (new Set(references).size !== references.length) fail(`${identity.check} evidence references must be unique`);
  if (window !== null) {
    const observed = new Date(observedAt).valueOf();
    if (observed < window.start || observed > window.end) fail(`${identity.check} evidence falls outside the measured end-to-end window`);
  }
  return { path: relative(root, path), sha256: sha256(raw), observedAt, observer: value.observer };
}

function timingWindow(value: unknown, findings: string[]) {
  const empty = { start: 0, end: 0, result: {
    status: "blocked", stages: [] as RecordValue[], endToEnd: null as RecordValue | null,
    durationMs: null as number | null, underTenMinutesMeasured: null as boolean | null,
  } };
  if (value === undefined) {
    findings.push("timing");
    return empty;
  }
  const timing = record(value, "timing");
  rejectUnknown(timing, ["stages", "endToEnd"], "timing");
  if (!Array.isArray(timing.stages) || !timing.endToEnd) {
    findings.push("timing");
    return empty;
  }
  const stages = new Map<string, RecordValue>();
  for (const raw of timing.stages) {
    const stage = record(raw, "timing stage");
    exact(stage, ["id", "startedAt", "completedAt"], "timing stage");
    const id = identifier(stage.id, "timing stage id");
    if (!STAGES.includes(id as typeof STAGES[number]) || stages.has(id)) fail("Timing stages must identify each required stage exactly once");
    const startedAt = timestamp(stage.startedAt, `${id} startedAt`);
    const completedAt = timestamp(stage.completedAt, `${id} completedAt`);
    const durationMs = new Date(completedAt).valueOf() - new Date(startedAt).valueOf();
    if (durationMs < 0) fail(`${id} completedAt precedes startedAt`);
    stages.set(id, { id, startedAt, completedAt, durationMs });
  }
  const missing = STAGES.filter((id) => !stages.has(id));
  if (missing.length > 0) findings.push(...missing.map((id) => `timing.${id}`));
  const endToEnd = record(timing.endToEnd, "end-to-end timing");
  exact(endToEnd, ["startedAt", "completedAt"], "end-to-end timing");
  const startedAt = timestamp(endToEnd.startedAt, "end-to-end startedAt");
  const completedAt = timestamp(endToEnd.completedAt, "end-to-end completedAt");
  const start = new Date(startedAt).valueOf();
  const end = new Date(completedAt).valueOf();
  if (end < start) fail("End-to-end completedAt precedes startedAt");
  for (const stage of stages.values()) {
    const stageStart = new Date(stage.startedAt as string).valueOf();
    const stageEnd = new Date(stage.completedAt as string).valueOf();
    if (stageStart < start || stageEnd > end) fail(`${stage.id} timing falls outside the end-to-end window`);
  }
  const durationMs = end - start;
  let underTenMinutesMeasured: boolean | null = durationMs < 10 * 60 * 1000;
  let status = "measured";
  if (missing.length > 0) underTenMinutesMeasured = null;
  if (missing.length > 0) status = "blocked";
  const result = {
    status,
    stages: STAGES.filter((id) => stages.has(id)).map((id) => stages.get(id) as RecordValue),
    endToEnd: { startedAt, completedAt },
    durationMs,
    underTenMinutesMeasured,
  };
  return { start, end, result };
}

function checkStatus(value: unknown, name: string, findings: string[]): RecordValue | null {
  if (value === undefined) {
    findings.push(name);
    return null;
  }
  const item = record(value, name);
  rejectUnknown(item, ["status", "evidence"], name);
  if (item.status !== "pass" && item.status !== "blocked" && item.status !== "fail") fail(`${name}.status is invalid`);
  if (item.status !== "pass") findings.push(name);
  if (!Array.isArray(item.evidence)) fail(`${name}.evidence must be an array`);
  if (item.status === "pass" && item.evidence.length < 1) findings.push(`${name}.evidence`);
  if (item.evidence.length > 8 || item.evidence.some((path) => typeof path !== "string")) fail(`${name}.evidence is invalid`);
  return item;
}

async function evaluateChecks(root: string, manifest: RecordValue, bundle: BundleIdentity,
  window: { start: number; end: number } | null, findings: string[]) {
  const applications: Record<string, unknown> = {};
  if (manifest.applications === undefined) {
    findings.push(...SERVICES.map((service) => `applications.${service}`));
  } else {
    const supplied = record(manifest.applications, "applications");
    rejectUnknown(supplied, SERVICES, "applications");
    for (const service of SERVICES) {
      const name = `applications.${service}`;
      const item = checkStatus(supplied[service], name, findings);
      if (item === null) continue;
      const files: FileSummary[] = [];
      for (const path of item.evidence as string[]) {
        files.push(await loadEvidenceFile(root, path, {
          subject: `${bundle.id}:${service}`, runId: bundle.runIds[service], check: "direct-acceptance",
        }, window));
      }
      applications[service] = { status: item.status, evidence: files };
    }
  }

  const homarr: Record<string, unknown> = {};
  if (manifest.homarr === undefined) {
    findings.push(...HOMARR_CHECKS.map((check) => `homarr.${check}`));
  } else {
    const supplied = record(manifest.homarr, "homarr");
    rejectUnknown(supplied, HOMARR_CHECKS, "homarr");
    for (const check of HOMARR_CHECKS) {
      const name = `homarr.${check}`;
      const item = checkStatus(supplied[check], name, findings);
      if (item === null) continue;
      const files: FileSummary[] = [];
      for (const path of item.evidence as string[]) {
        files.push(await loadEvidenceFile(root, path, {
          subject: `${bundle.id}:homarr`, runId: bundle.runIds.media, check,
        }, window));
      }
      homarr[check] = { status: item.status, evidence: files };
    }
  }
  return { applications, homarr };
}

function screenshotFormat(contents: Buffer): string | null {
  if (contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff) return "jpeg";
  if (contents.subarray(0, 4).toString("ascii") === "RIFF" && contents.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

async function evaluateScreenshot(root: string, value: unknown, findings: string[]) {
  if (value === undefined) {
    findings.push("screenshot");
    return null;
  }
  const screenshot = record(value, "screenshot");
  rejectUnknown(screenshot, ["path", "sha256", "redacted"], "screenshot");
  if (typeof screenshot.path !== "string" || typeof screenshot.sha256 !== "string" || screenshot.redacted !== true) {
    findings.push("screenshot");
    return null;
  }
  if (!HASH.test(screenshot.sha256)) fail("screenshot.sha256 is invalid");
  const contents = await boundedFile(root, screenshot.path, "screenshot", MAX_SCREENSHOT);
  const actual = sha256(contents);
  if (actual !== screenshot.sha256) fail("Screenshot digest does not match its declared identity");
  const format = screenshotFormat(contents);
  if (format === null) fail("Screenshot must be a PNG, JPEG, or WebP image");
  return { path: relative(root, screenshot.path), sha256: actual, format, redaction: "operator-confirmed" };
}

async function evaluateCleanup(root: string, value: unknown, bundle: BundleIdentity,
  window: { start: number; end: number } | null, findings: string[]) {
  if (value === undefined) {
    findings.push("cleanup");
    return null;
  }
  const cleanup = record(value, "cleanup");
  rejectUnknown(cleanup, ["status", "temporaryArtifacts", "browserSession", "testData", "stackState", "evidence"], "cleanup");
  if (cleanup.status !== "pass" && cleanup.status !== "blocked" && cleanup.status !== "fail") fail("cleanup.status is invalid");
  if (cleanup.temporaryArtifacts !== "removed" || !["closed", "not-used"].includes(cleanup.browserSession as string)
    || !["removed", "recoverable-trash", "not-created"].includes(cleanup.testData as string)
    || !["running", "stopped"].includes(cleanup.stackState as string)) {
    fail("cleanup state fields are invalid");
  }
  if (cleanup.status !== "pass") findings.push("cleanup");
  if (!Array.isArray(cleanup.evidence) || cleanup.evidence.length < 1 || cleanup.evidence.length > 8
    || cleanup.evidence.some((path) => typeof path !== "string")) {
    findings.push("cleanup.evidence");
    return { status: cleanup.status, temporaryArtifacts: cleanup.temporaryArtifacts,
      browserSession: cleanup.browserSession, testData: cleanup.testData, stackState: cleanup.stackState, evidence: [] };
  }
  const files: FileSummary[] = [];
  for (const path of cleanup.evidence as string[]) {
    files.push(await loadEvidenceFile(root, path, {
      subject: `${bundle.id}:bundle`, runId: bundle.id, check: "cleanup",
    }, window));
  }
  return { status: cleanup.status, temporaryArtifacts: cleanup.temporaryArtifacts,
    browserSession: cleanup.browserSession, testData: cleanup.testData, stackState: cleanup.stackState, evidence: files };
}

async function bundleDirectory(root: string, input: string): Promise<string> {
  const directory = dirname(input);
  const directoryMetadata = await lstat(directory);
  if (!inside(root, directory) || !directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()
    || await realpath(directory) !== directory || (directoryMetadata.mode & 0o077) !== 0) {
    fail("Bundle input directory must be one owner-only real directory");
  }
  if (typeof process.getuid === "function" && directoryMetadata.uid !== process.getuid()) fail("Bundle input directory has a different owner");
  return directory;
}

async function writeCheckpoint(root: string, input: string, result: RecordValue): Promise<string> {
  const directory = await bundleDirectory(root, input);
  const target = join(directory, "finalization.json");
  if (existsSync(target)) await boundedFile(root, target, "existing finalization checkpoint", MAX_JSON);
  const temporary = join(directory, `.finalization-${randomBytes(12).toString("hex")}.json`);
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    const parent = await open(directory, constants.O_RDONLY);
    try { await parent.sync(); }
    finally { await parent.close(); }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return target;
}

function parse(args: string[], scaffold: boolean, readOnly: boolean) {
  let offset = 1;
  if (scaffold || readOnly) offset = 2;
  const allowed = new Set(["--project-root", "--input"]);
  if (!scaffold) allowed.add("--evidence");
  const flags: Record<string, string> = {};
  for (let index = offset; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) fail(`Invalid or repeated bundle finalize option: ${name ?? "(missing)"}`);
    flags[name] = value;
  }
  for (const name of allowed) if (!flags[name]) fail(`bundle finalize needs ${name}`);
  return flags;
}

function parseRecord(args: string[]) {
  const required = ["--project-root", "--input", "--subject", "--check", "--observed-at", "--observer", "--status", "--redacted"];
  const cleanupFields = ["--temporary-artifacts", "--browser-session", "--test-data", "--stack-state"];
  const allowed = new Set([...required, "--reference", ...cleanupFields]);
  const flags: Record<string, string> = {};
  const references: string[] = [];
  for (let index = 2; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || !value || value.startsWith("--") || (name !== "--reference" && flags[name])) {
      fail(`Invalid or repeated bundle finalize record option: ${name ?? "(missing)"}`);
    }
    if (name === "--reference") references.push(value);
    else flags[name] = value;
  }
  for (const name of required) if (!flags[name]) fail(`bundle finalize record needs ${name}`);
  if (references.length < 1 || references.length > 16) fail("bundle finalize record needs one to sixteen --reference values");
  for (const [index, reference] of references.entries()) evidenceReference(reference, `--reference[${index}]`);
  if (new Set(references).size !== references.length) fail("bundle finalize record references must be unique");
  if (flags["--subject"] === "bundle") {
    for (const name of cleanupFields) if (!flags[name]) fail(`bundle finalize record cleanup needs ${name}`);
    if (flags["--temporary-artifacts"] !== "removed"
      || !["closed", "not-used"].includes(flags["--browser-session"])
      || !["removed", "recoverable-trash", "not-created"].includes(flags["--test-data"])
      || !["running", "stopped"].includes(flags["--stack-state"])) {
      fail("bundle finalize record cleanup state is invalid");
    }
  } else {
    for (const name of cleanupFields) if (flags[name]) fail(`${name} applies only to bundle cleanup`);
  }
  return { flags, references };
}

function recordIdentity(bundle: BundleIdentity, subject: string, check: string): EvidenceIdentity {
  if (SERVICES.includes(subject as Service) && check === "direct-acceptance") {
    return { subject: `${bundle.id}:${subject}`, runId: bundle.runIds[subject as Service], check };
  }
  if (subject === "homarr" && HOMARR_CHECKS.includes(check as typeof HOMARR_CHECKS[number])) {
    return { subject: `${bundle.id}:homarr`, runId: bundle.runIds.media, check };
  }
  if (subject === "bundle" && check === "cleanup") {
    return { subject: `${bundle.id}:bundle`, runId: bundle.id, check };
  }
  fail("bundle finalize record subject and check do not identify one required observation slot");
}

function recordSlot(manifest: RecordValue, subject: string, check: string): RecordValue {
  if (subject === "bundle") return record(manifest.cleanup, "cleanup");
  if (subject === "homarr") {
    const homarr = record(manifest.homarr, "homarr");
    rejectUnknown(homarr, [...HOMARR_CHECKS], "homarr");
    if (check === "search" && !Object.hasOwn(homarr, "search")) {
      homarr.search = { status: "blocked", evidence: [] };
    }
    return record(homarr[check], `homarr.${check}`);
  }
  return record(record(manifest.applications, "applications")[subject], `applications.${subject}`);
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let complete = false;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    complete = true;
  } finally {
    if (!complete) {
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
    }
  }
}

async function recordObservation(root: string, input: string, bundle: BundleIdentity, args: string[]): Promise<void> {
  const { flags, references } = parseRecord(args);
  const identity = recordIdentity(bundle, flags["--subject"], flags["--check"]);
  const observedAt = timestamp(flags["--observed-at"], "--observed-at");
  if (Date.parse(observedAt) > Date.now()) fail("--observed-at cannot be in the future");
  const observer = flags["--observer"];
  if (!OBSERVER.test(observer)) fail("--observer is invalid");
  if (flags["--status"] !== "pass" || flags["--redacted"] !== "true") {
    fail("Recording requires explicit --status pass and --redacted true assertions; blocked evidence remains in the scaffold");
  }
  const directory = await bundleDirectory(root, input);
  const manifestPath = join(directory, "finalization-evidence.json");
  const observationPath = join(directory, `finalization-${flags["--subject"]}-${flags["--check"]}-observation.json`);
  const lockPath = join(directory, ".finalization-evidence.lock");
  const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let observationCreated = false;
  let manifestCommitted = false;
  const temporary = join(directory, `.finalization-evidence-${randomBytes(12).toString("hex")}.json`);
  try {
    const raw = await boundedFile(root, manifestPath, "finalization evidence manifest", MAX_JSON);
    const manifest = json(raw, "finalization evidence manifest");
    exact(manifest, ["schemaVersion", "kind", "bundleId", "projectRoot", "runIds", "evaluatedAt", "observer", "applications", "homarr", "screenshot", "timing", "cleanup"], "finalization evidence manifest");
    if (manifest.schemaVersion !== 1 || manifest.kind !== "household-bundle-finalization"
      || manifest.bundleId !== bundle.id || manifest.projectRoot !== root) {
      fail("Finalization evidence identity does not match the selected bundle");
    }
    validateRunIds(manifest.runIds, bundle);
    const slot = recordSlot(manifest, flags["--subject"], flags["--check"]);
    if (flags["--subject"] === "bundle") {
      exact(slot, ["status", "temporaryArtifacts", "browserSession", "testData", "stackState", "evidence"], "cleanup");
    } else {
      exact(slot, ["status", "evidence"], "finalization observation slot");
    }
    if (slot.status !== "blocked" || !Array.isArray(slot.evidence) || slot.evidence.length !== 0) {
      fail("Finalization observation slot is not empty and blocked; refusing to overwrite it");
    }
    const observation = {
      schemaVersion: 1, kind: "redacted-observation", bundleId: bundle.id,
      subject: identity.subject, runId: identity.runId, check: identity.check,
      observedAt, observer, status: "pass", evidenceRefs: references, redacted: true,
    };
    await writePrivateFile(observationPath, `${JSON.stringify(observation, null, 2)}\n`);
    observationCreated = true;
    slot.status = "pass";
    slot.evidence = [observationPath];
    if (flags["--subject"] === "bundle") {
      slot.temporaryArtifacts = flags["--temporary-artifacts"];
      slot.browserSession = flags["--browser-session"];
      slot.testData = flags["--test-data"];
      slot.stackState = flags["--stack-state"];
    }
    const current = await boundedFile(root, manifestPath, "finalization evidence manifest", MAX_JSON);
    if (!current.equals(raw)) fail("Finalization evidence manifest changed while recording; refusing to overwrite it");
    await writePrivateFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, manifestPath);
    manifestCommitted = true;
    const parent = await open(directory, constants.O_RDONLY);
    try { await parent.sync(); }
    finally { await parent.close(); }
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1, kind: "household-bundle-finalization-observation", bundleId: bundle.id,
      subject: identity.subject, check: identity.check, path: observationPath, manifest: manifestPath,
      mode: "0600", acceptanceStatus: "blocked", independentlyVerified: false,
      mutationsPerformed: ["owner-only-redacted-observation", "owner-only-finalization-evidence-manifest"],
    }, null, 2)}\n`);
  } finally {
    await unlink(temporary).catch(() => undefined);
    if (observationCreated && !manifestCommitted) await unlink(observationPath).catch(() => undefined);
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

async function writeScaffold(root: string, input: string, bundle: BundleIdentity): Promise<string> {
  const directory = await bundleDirectory(root, input);
  const target = join(directory, "finalization-evidence.json");
  if (existsSync(target)) fail("Finalization evidence scaffold already exists; refusing to overwrite it");
  const blocked = { status: "blocked", evidence: [] };
  const template: RecordValue = {
    schemaVersion: 1,
    kind: "household-bundle-finalization",
    bundleId: bundle.id,
    projectRoot: root,
    runIds: bundle.runIds,
    evaluatedAt: "",
    observer: "",
    applications: Object.fromEntries(SERVICES.map((service) => [service, { ...blocked }])),
    homarr: Object.fromEntries(HOMARR_CHECKS.map((check) => [check, { ...blocked }])),
    screenshot: { path: "", sha256: "", redacted: false },
    timing: {
      stages: STAGES.map((id) => ({ id, startedAt: "", completedAt: "" })),
      endToEnd: { startedAt: "", completedAt: "" },
    },
    cleanup: {
      status: "blocked",
      temporaryArtifacts: "",
      browserSession: "",
      testData: "",
      stackState: "",
      evidence: [],
    },
  };
  let created = false;
  try {
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(template, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const parent = await open(directory, constants.O_RDONLY);
    try { await parent.sync(); }
    finally { await parent.close(); }
  } catch (error) {
    if (created) await unlink(target).catch(() => undefined);
    throw error;
  }
  return target;
}

function validateRunIds(value: unknown, bundle: BundleIdentity): void {
  if (value === undefined) return;
  const runIds = record(value, "finalization evidence runIds");
  exact(runIds, SERVICES, "finalization evidence runIds");
  for (const service of SERVICES) {
    if (runIds[service] !== bundle.runIds[service]) {
      fail("Finalization evidence run IDs do not match the selected bundle");
    }
  }
}

export async function bundleFinalizeCommand(args: string[]): Promise<void> {
  if (args[0] !== "finalize") fail("Use bundle finalize [scaffold|record|status] --project-root ABSOLUTE --input ABSOLUTE [--evidence ABSOLUTE]");
  const scaffold = args[1] === "scaffold";
  const readOnly = args[1] === "status";
  if (args[1] === "record") {
    const { flags } = parseRecord(args);
    const root = await safeRoot(flags["--project-root"]);
    const bundle = await loadBundle(root, flags["--input"]);
    await recordObservation(root, flags["--input"], bundle, args);
    return;
  }
  const flags = parse(args, scaffold, readOnly);
  const root = await safeRoot(flags["--project-root"]);
  const bundle = await loadBundle(root, flags["--input"], !scaffold);
  if (scaffold) {
    const path = await writeScaffold(root, flags["--input"], bundle);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      kind: "household-bundle-finalization-scaffold",
      bundleId: bundle.id,
      projectRoot: root,
      runIds: bundle.runIds,
      path,
      mode: "0600",
      acceptanceStatus: "blocked",
      mutationsPerformed: ["owner-only-finalization-evidence-scaffold"],
    }, null, 2)}\n`);
    return;
  }
  const raw = await boundedFile(root, flags["--evidence"], "finalization evidence manifest", MAX_JSON);
  const manifest = json(raw, "finalization evidence manifest");
  const manifestFields = ["schemaVersion", "kind", "bundleId", "projectRoot", "evaluatedAt", "observer", "applications", "homarr", "screenshot", "timing", "cleanup"];
  if (Object.hasOwn(manifest, "runIds")) manifestFields.push("runIds");
  exact(manifest, manifestFields, "finalization evidence manifest");
  if (manifest.schemaVersion !== 1 || manifest.kind !== "household-bundle-finalization"
    || manifest.bundleId !== bundle.id || manifest.projectRoot !== root) {
    fail("Finalization evidence identity does not match the selected bundle");
  }
  validateRunIds(manifest.runIds, bundle);
  const evaluatedAt = timestamp(manifest.evaluatedAt, "evaluatedAt");
  if (typeof manifest.observer !== "string" || !OBSERVER.test(manifest.observer)) fail("Finalization observer is invalid");
  const findings: string[] = [];
  const measured = timingWindow(manifest.timing, findings);
  if (measured.end > new Date(evaluatedAt).valueOf()) fail("Measured end-to-end completion is later than evaluatedAt");
  let window: { start: number; end: number } | null = null;
  if (measured.start > 0 && measured.end >= measured.start) window = { start: measured.start, end: measured.end };
  const checks = await evaluateChecks(root, manifest, bundle, window, findings);
  const screenshot = await evaluateScreenshot(root, manifest.screenshot, findings);
  const cleanup = await evaluateCleanup(root, manifest.cleanup, bundle, window, findings);
  const uniqueFindings = [...new Set(findings)].sort();
  let status = "recorded";
  if (uniqueFindings.length > 0) status = "blocked";
  const checkpoint = join(dirname(flags["--input"]), "finalization.json");
  const result: RecordValue = {
    schemaVersion: 1,
    kind: "household-bundle-finalization-checkpoint",
    bundleId: bundle.id,
    projectRoot: root,
    bundleInput: { path: relative(root, flags["--input"]), sha256: bundle.inputSha256,
      referencedFiles: bundle.inputFingerprints },
    evidenceManifest: { path: relative(root, flags["--evidence"]), sha256: sha256(raw) },
    evaluatedAt,
    observer: manifest.observer,
    status,
    findings: { blocked: uniqueFindings },
    applications: checks.applications,
    homarr: checks.homarr,
    screenshot,
    timing: measured.result,
    cleanup,
    secrets: { secretFieldsAccepted: false, valuesPrinted: false, screenshotRedaction: "operator-confirmed-not-pixel-inspected" },
    independentlyVerified: false,
    mutationsPerformed: ["owner-only-finalization-checkpoint"],
    checkpoint: { path: checkpoint, mode: "0600" },
    claimBoundary: "Recorded means the bound redacted evidence files declare pass with matching identities, measured timestamps, screenshot hash and operator redaction assertion, and cleanup record. It is not independent acceptance: the finalizer does not re-run applications, inspect screenshot pixels or metadata content, or prove future availability.",
  };
  if (readOnly) {
    result.kind = "household-bundle-finalization-assessment";
    result.mutationsPerformed = [];
    result.mutation = false;
    delete result.checkpoint;
  } else {
    await writeCheckpoint(root, flags["--input"], result);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
