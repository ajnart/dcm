/** Evidence-only compatibility: implementation presence is not application acceptance. */
export const COMPATIBILITY_DIMENSIONS = ["compose", "setup", "homarr", "links", "liveRestart"] as const;
export type CompatibilityDimension = typeof COMPATIBILITY_DIMENSIONS[number];
export type CompatibilityState = "unknown" | "unsupported" | "external-required" | "declared";
export type CompatibilityLevel = CompatibilityState | "source-verified" | "fixture-verified" | "live-verified" | "failed";
export type CompatibilityHomarrMode = "native" | "tile-only" | "control-plane" | "not-applicable";

export type CompatibilityCapability = {
  state: CompatibilityState;
  /** Hash the actual reviewed implementation/contract, not its filename or manifest count. */
  subjectSha256: string | null;
  reason: string;
};

export type CompatibilityAppInput = {
  appId: string;
  name: string;
  recipeSha256: string | null;
  /** Every service in the recipe, including database/cache dependencies. */
  imageTags: Readonly<Record<string, string>>;
  homarrMode: CompatibilityHomarrMode;
  dimensions?: Partial<Record<CompatibilityDimension, CompatibilityCapability>>;
};

export type CompatibilityEvidence = {
  schemaVersion: 1;
  appId: string;
  dimension: CompatibilityDimension;
  kind: "source" | "fixture" | "live";
  result: "pass" | "fail";
  checkedAt: string;
  runId: string;
  recipeSha256: string;
  subjectSha256: string;
  /** Live receipts must identify immutable images as exact recipe-tag@sha256:digest. */
  images: Readonly<Record<string, string>>;
  /** Observed run coverage; a failed live subset does not claim these checks passed. */
  checks: readonly string[];
  artifact: { path: string; sha256: string };
};

export type CompatibilityDimensionReport = {
  dimension: CompatibilityDimension;
  level: CompatibilityLevel;
  points: number;
  maximum: 20;
  reason: string;
  requiredChecks: string[];
  evidence: CompatibilityEvidence | null;
};

export type CompatibilityAppReport = {
  appId: string;
  name: string;
  score: number;
  rating: "unverified" | "blocked" | "broken" | "partial" | "works" | "excellent";
  maximum: 100;
  homarrMode: CompatibilityHomarrMode;
  dimensions: CompatibilityDimensionReport[];
  actions: string[];
};

export type CompatibilityOptions = {
  /** Explicit as-of time keeps the result deterministic. */
  checkedAt: string;
  evidence?: readonly CompatibilityEvidence[];
  /** Supply the complete baseline inventory; absent apps stay in the denominator. */
  expectedAppIds?: readonly string[];
  /** Default 90 days. Old receipts are historical evidence, not current verification. */
  maximumEvidenceAgeDays?: number;
};

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_MS = 86_400_000;

function date(value: string): number {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return parsed;
}

export function requiredCompatibilityChecks(dimension: CompatibilityDimension,
  homarrMode: CompatibilityHomarrMode): string[] {
  if (dimension === "compose") return ["fresh-compose-apply", "private-exposure", "owned-storage"];
  if (dimension === "setup") return ["first-run", "credential-or-no-account-readback", "resume-readback"];
  if (dimension === "links") return ["selected-links-or-independence-readback"];
  if (dimension === "liveRestart") return ["application-health", "core-round-trip", "restart-persistence"];
  if (homarrMode === "native") return ["tile-readback", "homarr-origin-reachability", "integration-test", "widget-readback"];
  if (homarrMode === "control-plane") return ["board-readback", "api-readback", "reload-persistence"];
  if (homarrMode === "not-applicable") return ["homarr-not-applicable-reviewed"];
  return ["tile-readback", "homarr-origin-reachability"];
}

function validArtifact(artifact: CompatibilityEvidence["artifact"]): boolean {
  if (!artifact || !HASH.test(artifact.sha256) || typeof artifact.path !== "string") return false;
  // Receipts point only to sanitized, portable artifacts, never private owner files.
  const parts = artifact.path.split("/");
  return artifact.path.length <= 240 && /^(?:research|generations|evidence)\/[A-Za-z0-9/_.-]+$/.test(artifact.path)
    && parts.every((part) => part !== ".." && part !== "." && part !== "")
    && !/(?:secret|credential|handoff|cookie|\.sessions|\.env)/i.test(artifact.path);
}

function imagesMatch(app: CompatibilityAppInput, evidence: CompatibilityEvidence): boolean {
  if (!evidence.images || typeof evidence.images !== "object" || Array.isArray(evidence.images)) return false;
  const services = Object.keys(app.imageTags).sort();
  if (!services.length || JSON.stringify(Object.keys(evidence.images).sort()) !== JSON.stringify(services)) return false;
  return services.every((id) => {
    const expected = app.imageTags[id];
    const observed = evidence.images[id];
    if (typeof expected !== "string" || typeof observed !== "string") return false;
    if (evidence.kind !== "live") return observed === expected;
    if (/@sha256:[a-f0-9]{64}$/.test(expected)) return observed === expected;
    return observed.startsWith(`${expected}@sha256:`) && HASH.test(observed.slice(expected.length + 8));
  });
}

function validEvidence(app: CompatibilityAppInput, dimension: CompatibilityDimension,
  capability: CompatibilityCapability, evidence: CompatibilityEvidence, asOf: number, maximumAge: number): boolean {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  const observedAt = date(evidence.checkedAt);
  if (evidence.schemaVersion !== 1 || evidence.appId !== app.appId || evidence.dimension !== dimension
    || !["source", "fixture", "live"].includes(evidence.kind) || !["pass", "fail"].includes(evidence.result)
    || !HASH.test(evidence.recipeSha256) || evidence.recipeSha256 !== app.recipeSha256
    || !HASH.test(evidence.subjectSha256) || evidence.subjectSha256 !== capability.subjectSha256
    || !Number.isFinite(observedAt) || observedAt > asOf || asOf - observedAt > maximumAge * DAY_MS
    || typeof evidence.runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(evidence.runId)
    || !validArtifact(evidence.artifact) || !imagesMatch(app, evidence)
    || !Array.isArray(evidence.checks) || new Set(evidence.checks).size !== evidence.checks.length) return false;
  const required = requiredCompatibilityChecks(dimension, app.homarrMode);
  // A verified live failure needs no unrelated passing checks to invalidate a prior pass.
  // Its checked subset must still name actual required checks for this exact dimension.
  if (evidence.kind === "live" && evidence.result === "fail") {
    return evidence.checks.length > 0 && evidence.checks.length <= required.length
      && evidence.checks.every((check) => required.includes(check));
  }
  return required.every((check) => evidence.checks.includes(check));
}

function defaultCapability(): CompatibilityCapability {
  return { state: "unknown", subjectSha256: null, reason: "No reviewed capability or matching acceptance evidence supplied." };
}

function scoreDimension(app: CompatibilityAppInput, dimension: CompatibilityDimension,
  evidence: readonly CompatibilityEvidence[], asOf: number, maximumAge: number): CompatibilityDimensionReport {
  const capability = app.dimensions?.[dimension] ?? defaultCapability();
  const report: CompatibilityDimensionReport = { dimension, level: capability.state, points: 0, maximum: 20,
    reason: capability.reason, requiredChecks: requiredCompatibilityChecks(dimension, app.homarrMode), evidence: null };
  // Explicit blockers cannot be upgraded by a receipt against an unavailable route.
  if (capability.state === "unsupported" || capability.state === "external-required") return report;
  const matching = evidence.filter((item) => validEvidence(app, dimension, capability, item, asOf, maximumAge));
  const rank = { source: 1, fixture: 2, live: 3 };
  matching.sort((left, right) => rank[right.kind] - rank[left.kind]
    || date(right.checkedAt) - date(left.checkedAt)
    || Number(right.result === "fail") - Number(left.result === "fail")
    || left.runId.localeCompare(right.runId)
    || left.artifact.sha256.localeCompare(right.artifact.sha256));
  const selected = matching[0];
  if (!selected) return report;
  report.evidence = selected;
  if (selected.result === "fail") {
    report.level = "failed";
    report.reason = "Matching evidence records a failed acceptance check.";
    return report;
  }
  if (selected.kind === "source") report.level = "source-verified";
  if (selected.kind === "fixture") report.level = "fixture-verified";
  if (selected.kind === "live") {
    report.level = "live-verified";
    report.points = 20;
  }
  report.reason = "Source and fixtures establish their own boundaries; only matching live acceptance earns compatibility points.";
  return report;
}

/** No I/O, imports of app adapters, Docker access, or mutations. */
export function scoreCatalogCompatibility(inputs: readonly CompatibilityAppInput[], options: CompatibilityOptions) {
  const asOf = date(options.checkedAt);
  const maximumAge = options.maximumEvidenceAgeDays ?? 90;
  if (!Number.isFinite(asOf) || !Number.isFinite(maximumAge) || maximumAge < 0) {
    throw new Error("Compatibility requires a valid explicit date and nonnegative evidence age.");
  }
  const byId = new Map<string, CompatibilityAppInput>();
  for (const app of inputs) {
    if (!ID.test(app.appId) || byId.has(app.appId)) throw new Error("Compatibility app IDs must be valid and unique.");
    byId.set(app.appId, app);
  }
  const inventory = options.expectedAppIds ?? inputs.map((app) => app.appId);
  if (!inventory.length || new Set(inventory).size !== inventory.length || inventory.some((id) => !ID.test(id))
    || inputs.some((app) => !inventory.includes(app.appId))) {
    throw new Error("Compatibility inventory must include every supplied app exactly once.");
  }
  const apps: CompatibilityAppReport[] = [...inventory].sort().map((appId) => {
    const app = byId.get(appId) ?? { appId, name: appId, recipeSha256: null, imageTags: {}, homarrMode: "tile-only" as const };
    const dimensions = COMPATIBILITY_DIMENSIONS.map((dimension) => scoreDimension(app, dimension,
      options.evidence ?? [], asOf, maximumAge));
    const score = dimensions.reduce((sum, item) => sum + item.points, 0);
    let rating: CompatibilityAppReport["rating"] = "unverified";
    if (score > 0) rating = "partial";
    if (score > 75) rating = "works";
    if (score === 100) rating = "excellent";
    if (dimensions.some((item) => ["unsupported", "external-required"].includes(item.level))) rating = "blocked";
    if (dimensions.some((item) => item.level === "failed")) rating = "broken";
    return { appId, name: app.name, score, rating,
      maximum: 100, homarrMode: app.homarrMode, dimensions,
      actions: dimensions.filter((item) => item.points < item.maximum)
        .map((item) => `${item.dimension}: ${item.reason} Required: ${item.requiredChecks.join(", ")}.`) };
  });
  const earned = apps.reduce((sum, app) => sum + app.score, 0);
  const possible = apps.length * 100;
  const aggregate = Math.round(earned / possible * 10000) / 100;
  return { schemaVersion: 1 as const, rubric: "live-compatibility-v1" as const,
    checkedAt: options.checkedAt, maximumEvidenceAgeDays: maximumAge,
    appCount: apps.length, earnedPoints: earned, possiblePoints: possible, aggregate,
    goal: 75, goalMet: earned / possible > 0.75,
    evidenceBoundary: "Only exact, current live acceptance earns points. Source, fixtures, and capability declarations are reported separately.",
    apps };
}
