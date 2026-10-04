import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readFullJourneyEvidence } from "./bundle-journey.ts";

type RecordValue = Record<string, unknown>;
type Phase = {
  id: string;
  lane: "cli" | "manual" | "browser" | "caddy" | "homarr";
  state: "recorded" | "unknown";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  source: "finalization-checkpoint" | "none";
};

const MAX_JSON = 128 * 1024;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const RECORDED_PHASES = new Set(["media", "immich", "docmost", "vaultwarden", "homarr"]);
const PHASES: Array<{ id: string; lane: Phase["lane"] }> = [
  { id: "host-inspection", lane: "cli" },
  { id: "bundle-plan-and-approvals", lane: "manual" },
  { id: "media", lane: "cli" },
  { id: "immich", lane: "cli" },
  { id: "docmost", lane: "cli" },
  { id: "caddy-private-https", lane: "caddy" },
  { id: "vaultwarden", lane: "cli" },
  { id: "browser-acceptance", lane: "browser" },
  { id: "homarr", lane: "homarr" },
  { id: "cleanup-and-finalize", lane: "manual" },
];

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as RecordValue;
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
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail("Project root has a different owner");
  }
  return path;
}

async function ownerJson(root: string, path: string, name: string): Promise<{ raw: Buffer; value: RecordValue }> {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(root, path)) {
    fail(`${name} must be an exact path inside the project root`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path
    || metadata.size < 2 || metadata.size > MAX_JSON || (metadata.mode & 0o777) !== 0o600) {
    fail(`${name} must be one bounded owner-only regular file (0600) without links`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail(`${name} has a different owner`);
  }
  const raw = await readFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
  return { raw, value: record(parsed, name) };
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function timestamp(value: unknown, name: string): { value: string; milliseconds: number } {
  if (typeof value !== "string") fail(`${name} must be an ISO UTC timestamp`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail(`${name} must be an ISO UTC timestamp`);
  }
  return { value, milliseconds };
}

function parse(args: string[]): { root: string; input: string } {
  if (args[0] !== "benchmark") {
    fail("Use bundle benchmark --project-root ABSOLUTE --input ABSOLUTE");
  }
  const flags: Record<string, string> = {};
  const allowed = new Set(["--project-root", "--input"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated bundle benchmark option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  if (!flags["--project-root"] || !flags["--input"]) {
    fail("bundle benchmark needs --project-root and --input");
  }
  return { root: flags["--project-root"], input: flags["--input"] };
}

async function loadBundle(root: string, input: string) {
  const loaded = await ownerJson(root, input, "bundle input");
  const value = loaded.value;
  if (value.schemaVersion !== 1 || typeof value.id !== "string" || !ID.test(value.id)
    || value.projectRoot !== root || !value.services || typeof value.services !== "object"
    || Array.isArray(value.services)) {
    fail("Bundle input identity is invalid");
  }
  const services = value.services as RecordValue;
  const expected = ["docmost", "immich", "media", "vaultwarden"];
  if (JSON.stringify(Object.keys(services).sort()) !== JSON.stringify(expected)) {
    fail("Bundle input must contain the four household services");
  }
  const media = record(services.media, "media service");
  if (media.mode !== undefined && media.mode !== "create" && media.mode !== "adopt") {
    fail("Bundle media mode is invalid");
  }
  return { id: value.id, sha256: sha256(loaded.raw), adoptedMedia: media.mode === "adopt" };
}

function unknownPhases(): Phase[] {
  return PHASES.map((definition) => ({
    id: definition.id,
    lane: definition.lane,
    state: "unknown",
    startedAt: null,
    completedAt: null,
    durationMs: null,
    source: "none",
  }));
}

function applyRecordedTimings(phases: Phase[], checkpoint: RecordValue): void {
  const timing = record(checkpoint.timing, "finalization timing");
  if (!Array.isArray(timing.stages)) fail("Finalization timing stages are invalid");
  const seen = new Set<string>();
  for (const raw of timing.stages) {
    const stage = record(raw, "finalization timing stage");
    if (typeof stage.id !== "string" || !RECORDED_PHASES.has(stage.id) || seen.has(stage.id)) {
      fail("Finalization timing stage identity is invalid");
    }
    seen.add(stage.id);
    const startedAt = timestamp(stage.startedAt, `${stage.id} startedAt`);
    const completedAt = timestamp(stage.completedAt, `${stage.id} completedAt`);
    if (completedAt.milliseconds < startedAt.milliseconds) fail(`${stage.id} timing is reversed`);
    const durationMs = completedAt.milliseconds - startedAt.milliseconds;
    if (stage.durationMs !== durationMs) fail(`${stage.id} duration does not match its timestamps`);
    const phase = phases.find((candidate) => candidate.id === stage.id);
    if (!phase) fail(`Unsupported finalization timing stage: ${stage.id}`);
    phase.state = "recorded";
    phase.startedAt = startedAt.value;
    phase.completedAt = completedAt.value;
    phase.durationMs = durationMs;
    phase.source = "finalization-checkpoint";
  }
}

async function loadFinalization(root: string, input: string, bundle: { id: string; sha256: string }, phases: Phase[]) {
  const path = join(dirname(input), "finalization.json");
  if (!existsSync(path)) {
    return { state: "missing", path: relative(root, path), status: null, independentlyVerified: false };
  }
  const loaded = await ownerJson(root, path, "finalization checkpoint");
  const checkpoint = loaded.value;
  const bundleInput = record(checkpoint.bundleInput, "finalization bundle input");
  if (checkpoint.schemaVersion !== 1 || checkpoint.kind !== "household-bundle-finalization-checkpoint"
    || checkpoint.bundleId !== bundle.id || checkpoint.projectRoot !== root
    || !HASH.test(bundleInput.sha256 as string) || bundleInput.sha256 !== bundle.sha256) {
    fail("Finalization checkpoint does not match the selected bundle input");
  }
  if (checkpoint.status !== "recorded" && checkpoint.status !== "blocked") {
    fail("Finalization checkpoint status is invalid");
  }
  if (checkpoint.independentlyVerified !== false) {
    fail("Finalization checkpoint has an invalid independent-verification claim");
  }
  applyRecordedTimings(phases, checkpoint);
  return {
    state: "present",
    path: relative(root, path),
    sha256: sha256(loaded.raw),
    status: checkpoint.status,
    independentlyVerified: false,
  };
}

export async function bundleBenchmarkCommand(args: string[],
  journeyRuntime?: Parameters<typeof readFullJourneyEvidence>[4]): Promise<void> {
  const parsed = parse(args);
  const root = await safeRoot(parsed.root);
  const bundle = await loadBundle(root, parsed.input);
  const phases = unknownPhases();
  const finalization = await loadFinalization(root, parsed.input, bundle, phases);
  const fullJourney = await readFullJourneyEvidence(root, parsed.input, bundle.id, bundle.sha256, journeyRuntime);
  const unknown = phases.filter((phase) => phase.state === "unknown").map((phase) => phase.id);
  const journeyMeasured = fullJourney.state === "finished";
  let benchmarkStatus = "not-measured";
  let journeyDurationMs: number | null = null;
  let underTenMinutes: boolean | null = null;
  let timingClaimStatus = "not-measured";
  let timingReason = "Start the monotonic journey before host inspection and finish it only after complete finalization evidence is recorded; partial stage timestamps do not measure the full setup.";
  if (bundle.adoptedMedia) {
    timingClaimStatus = "not-comparable-adopted-media";
    timingReason = "This bundle adopted an already installed media run; its journal cannot measure a fresh full-stack setup.";
    if (journeyMeasured) {
      benchmarkStatus = "extension-time-measured";
      journeyDurationMs = fullJourney.elapsedMs;
    }
  } else if (journeyMeasured) {
    benchmarkStatus = "time-measured";
    journeyDurationMs = fullJourney.elapsedMs;
    underTenMinutes = journeyDurationMs !== null && journeyDurationMs < 10 * 60 * 1000;
    timingClaimStatus = "measured";
    timingReason = "The owner-only same-boot monotonic journal spans start before bundle initialization through a finish gated by hash-bound recorded finalization evidence. This is a speed measurement, not independent acceptance.";
  } else if (fullJourney.state === "active" && fullJourney.elapsedMs !== null
    && fullJourney.elapsedMs >= 10 * 60 * 1000) {
    underTenMinutes = false;
    timingClaimStatus = "threshold-exceeded-in-progress";
    timingReason = "The same-boot monotonic journey has already reached the ten-minute limit without finishing. This run cannot meet the under-ten-minute target; its final duration and acceptance remain unmeasured.";
  }
  const result = {
    schemaVersion: 1,
    kind: "household-bundle-benchmark",
    status: benchmarkStatus,
    mutation: false,
    bundleId: bundle.id,
    evidence: {
      bundleInput: { path: relative(root, parsed.input), sha256: bundle.sha256 },
      finalization,
      fullJourneyJournal: fullJourney,
    },
    phases,
    coverage: {
      complete: false,
      freshFullStackComparable: !bundle.adoptedMedia,
      fullJourneyElapsedMeasured: journeyMeasured,
      phaseBreakdownComplete: unknown.length === 0,
      recordedPhaseCount: phases.length - unknown.length,
      requiredPhaseCount: phases.length,
      unknownPhaseIds: unknown,
      manualIncluded: false,
      browserIncluded: false,
      caddyIncluded: false,
      homarrIncluded: phases.some((phase) => phase.id === "homarr" && phase.state === "recorded"),
    },
    claims: {
      completeSetupUnderTenMinutes: {
        status: timingClaimStatus,
        value: underTenMinutes,
        thresholdMs: 10 * 60 * 1000,
        durationMs: journeyDurationMs,
        reason: timingReason,
      },
      ease: {
        status: "not-measured",
        score: null,
        target: 85,
        targetMet: null,
        reason: "No owner-validated ease instrument or complete setup observation is recorded.",
      },
      independentlyVerified: false,
    },
    secretsPrinted: false,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
