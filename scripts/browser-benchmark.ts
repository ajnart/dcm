#!/usr/bin/env bun

import { basename, dirname, resolve } from "node:path";

const SERVICES = ["sonarr", "radarr", "prowlarr", "qbittorrent", "jellyfin", "seerr", "homarr"] as const;
const MODES = ["browser", "browser-wiring", "hybrid"] as const;
const JOURNEYS = ["fresh", "returning"] as const;
const OUTCOMES = ["pass", "fail", "blocked"] as const;
const COUNT_KEYS = ["navigations", "interactions", "snapshots", "waits", "toolCalls", "retries"] as const;
const RECORD_KEYS = ["schemaVersion", "kind", "recordedAt", "service", "mode", "journey", "outcome", "counts", "elapsedMs"];

type Service = typeof SERVICES[number];
type Mode = typeof MODES[number];
type Journey = typeof JOURNEYS[number];
type Outcome = typeof OUTCOMES[number];
type Counts = Record<typeof COUNT_KEYS[number], number>;

export interface BrowserBenchmarkRecord {
  schemaVersion: 1;
  kind: "selfhost-browser-benchmark";
  recordedAt: string;
  service: Service;
  mode: Mode;
  journey: Journey;
  outcome: Outcome;
  counts: Counts;
  elapsedMs: number;
}

type Flags = Record<string, string>;

function usage() {
  return `Browser benchmark recorder

Usage:
  bun scripts/browser-benchmark.ts validate-recipes [--recipes PATH]
  bun scripts/browser-benchmark.ts lookup SERVICE [--recipes PATH]
  bun scripts/browser-benchmark.ts record --service ID --mode MODE --journey JOURNEY --outcome OUTCOME \\
    --navigations N --interactions N --snapshots N --waits N --tool-calls N --retries N \\
    --elapsed-ms N --output PATH
  bun scripts/browser-benchmark.ts report --input PATH --json-output PATH --markdown-output PATH

This tool records observed counters only. It does not run a browser or infer performance.`;
}

function parseFlags(input: string[]) {
  const flags: Flags = {};
  for (let index = 0; index < input.length; index += 2) {
    const key = input[index];
    const value = input[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid option near ${key ?? "end of input"}`);
    }
    const name = key.slice(2);
    if (flags[name] !== undefined) {
      throw new Error(`Duplicate option --${name}`);
    }
    flags[name] = value;
  }
  return flags;
}

function requireExactFlags(flags: Flags, names: string[]) {
  const actual = Object.keys(flags).sort();
  const expected = [...names].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected options: ${expected.map((name) => `--${name}`).join(", ")}`);
  }
}

function enumValue<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`--${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function boundedInteger(value: string, name: string, maximum: number) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`--${name} must be at most ${maximum}`);
  }
  return parsed;
}

function exactKeys(value: object, keys: readonly string[], label: string) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} fields are invalid`);
  }
}

export function validateRecord(value: unknown): BrowserBenchmarkRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Benchmark record must be an object");
  }
  const record = value as Record<string, unknown>;
  exactKeys(record, RECORD_KEYS, "Benchmark record");
  if (record.schemaVersion !== 1 || record.kind !== "selfhost-browser-benchmark") {
    throw new Error("Benchmark record identity is invalid");
  }
  if (typeof record.recordedAt !== "string" || Number.isNaN(Date.parse(record.recordedAt))) {
    throw new Error("Benchmark recordedAt is invalid");
  }
  enumValue(String(record.service), SERVICES, "service");
  enumValue(String(record.mode), MODES, "mode");
  enumValue(String(record.journey), JOURNEYS, "journey");
  enumValue(String(record.outcome), OUTCOMES, "outcome");
  if (!record.counts || typeof record.counts !== "object" || Array.isArray(record.counts)) {
    throw new Error("Benchmark counts are invalid");
  }
  exactKeys(record.counts, COUNT_KEYS, "Benchmark count");
  for (const key of COUNT_KEYS) {
    const count = (record.counts as Record<string, unknown>)[key];
    if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > 10_000) {
      throw new Error(`Benchmark ${key} is invalid`);
    }
  }
  if (!Number.isInteger(record.elapsedMs) || (record.elapsedMs as number) < 0 || (record.elapsedMs as number) > 86_400_000) {
    throw new Error("Benchmark elapsedMs is invalid");
  }
  return value as BrowserBenchmarkRecord;
}

async function writeText(path: string, contents: string) {
  const target = resolve(path);
  const temporary = resolve(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  await Bun.write(temporary, contents);
  await import("node:fs/promises").then(({ rename }) => rename(temporary, target));
}

async function writeJson(path: string, value: unknown) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function validateRecipes(path: string) {
  const value = await Bun.file(path).json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recipe index must be an object");
  }
  exactKeys(value, ["schemaVersion", "services", "rules"], "Recipe index");
  if (value.schemaVersion !== 1 || !Array.isArray(value.services) || value.services.length !== SERVICES.length) {
    throw new Error("Recipe index identity or service count is invalid");
  }
  const ids = value.services.map((service: { id?: unknown }) => service.id);
  if (JSON.stringify(ids) !== JSON.stringify(SERVICES)) {
    throw new Error("Recipe index must contain the exact ordered first-party service set");
  }
  for (const service of value.services) {
    exactKeys(service, ["id", "credential", "settingsPath", "linkedDoc", "authMethod", "successSignal", "controlHints", "sourceChecked", "fresh", "returning", "captureHelper"], `Recipe ${service.id}`);
    exactKeys(service.fresh, MODES, `Recipe ${service.id} fresh modes`);
    const hasSupportedFragment = service.settingsPath.includes("#!/") || service.settingsPath.includes("#/");
    const hasUnsupportedFragment = service.settingsPath.includes("#") && !hasSupportedFragment;
    if (!service.settingsPath.startsWith("/") || service.settingsPath.includes("?") || hasUnsupportedFragment) {
      throw new Error(`Recipe ${service.id} settingsPath is invalid`);
    }
    if (
      MODES.some((mode) => !Array.isArray(service.fresh[mode]))
      || !Array.isArray(service.returning)
      || typeof service.linkedDoc !== "string"
      || !service.linkedDoc.startsWith("docs/")
      || typeof service.authMethod !== "string"
      || typeof service.successSignal !== "string"
      || !Array.isArray(service.controlHints)
      || service.controlHints.length === 0
      || service.controlHints.some((hint: unknown) => typeof hint !== "string" || !hint)
      || typeof service.sourceChecked !== "string"
    ) {
      throw new Error(`Recipe ${service.id} actions are invalid`);
    }
    for (const actions of [...MODES.map((mode) => service.fresh[mode]), service.returning]) {
      if (actions.length < 2 || actions.some((action: unknown) => typeof action !== "string" || !/^[a-z][a-z0-9-]*$/.test(action))) {
        throw new Error(`Recipe ${service.id} action is invalid`);
      }
    }
    const captureHelpers: Record<string, string> = {
      sonarr: "session browser-key capture-field RUN_ID sonarr",
      radarr: "session browser-key capture-field RUN_ID radarr",
      prowlarr: "session browser-key capture-field RUN_ID prowlarr",
      qbittorrent: "session browser-password RUN_ID FRESH_REF",
      jellyfin: "session browser-password RUN_ID FRESH_REF",
      seerr: "session browser-key capture RUN_ID seerr FRESH_REF",
      homarr: "session browser-key capture-code RUN_ID homarr",
    };
    if (service.captureHelper !== captureHelpers[service.id]) {
      throw new Error(`Recipe ${service.id} capture helper is invalid`);
    }
  }
  return value.services.length;
}

function aggregate(records: BrowserBenchmarkRecord[]) {
  const totals = Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])) as Counts;
  let elapsedMs = 0;
  for (const record of records) {
    elapsedMs += record.elapsedMs;
    for (const key of COUNT_KEYS) {
      totals[key] += record.counts[key];
    }
  }
  return { records: records.length, elapsedMs, counts: totals };
}

function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
  return ordered[index];
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) {
    return ordered[middle];
  }
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

export function groupedResults(records: BrowserBenchmarkRecord[]) {
  const buckets = new Map<string, BrowserBenchmarkRecord[]>();
  for (const record of records) {
    const key = `${record.service}/${record.mode}/${record.journey}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, bucket]) => {
    const passed = bucket.filter((record) => record.outcome === "pass");
    const elapsed = passed.map((record) => record.elapsedMs);
    return {
      key,
      samples: bucket.length,
      passed: passed.length,
      failed: bucket.filter((record) => record.outcome === "fail").length,
      blocked: bucket.filter((record) => record.outcome === "blocked").length,
      elapsedMs: passed.length >= 3 ? {
        median: median(elapsed),
        p95: percentile(elapsed, 0.95),
      } : null,
    };
  });
}

function markdownReport(records: BrowserBenchmarkRecord[]) {
  const lines = [
    "# Browser benchmark report",
    "",
    "> These are recorded observations. Missing service/mode/journey combinations were not measured.",
    "",
    "| Service | Mode | Journey | Outcome | Navigations | Interactions | Snapshots | Waits | Tool calls | Retries | Elapsed ms |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const record of records) {
    const counts = record.counts;
    lines.push(`| ${record.service} | ${record.mode} | ${record.journey} | ${record.outcome} | ${counts.navigations} | ${counts.interactions} | ${counts.snapshots} | ${counts.waits} | ${counts.toolCalls} | ${counts.retries} | ${record.elapsedMs} |`);
  }
  const total = aggregate(records);
  lines.push(
    "",
    "## Repeated-run summary",
    "",
    "| Group | Samples | Passed | Failed | Blocked | Median ms | p95 ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const group of groupedResults(records)) {
    const median = group.elapsedMs?.median ?? "unmeasured";
    const p95 = group.elapsedMs?.p95 ?? "unmeasured";
    lines.push(`| ${group.key} | ${group.samples} | ${group.passed} | ${group.failed} | ${group.blocked} | ${median} | ${p95} |`);
  }
  lines.push("", `Recorded ${total.records} run(s), totaling ${total.elapsedMs} observed ms.`, "");
  return lines.join("\n");
}

async function main() {
  const [command, ...input] = Bun.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "lookup") {
    const [serviceInput, ...flagInput] = input;
    const service = enumValue(serviceInput ?? "", SERVICES, "service");
    const flags = parseFlags(flagInput);
    const allowed = Object.keys(flags);
    if (allowed.some((key) => key !== "recipes")) {
      throw new Error("lookup accepts only --recipes after SERVICE");
    }
    const path = flags.recipes ?? "docs/browser-paths.json";
    await validateRecipes(path);
    const index = await Bun.file(path).json();
    const recipe = index.services.find((candidate: { id: string }) => candidate.id === service);
    process.stdout.write(`${JSON.stringify(recipe, null, 2)}\n`);
    return;
  }
  const flags = parseFlags(input);
  if (command === "validate-recipes") {
    const allowed = Object.keys(flags);
    if (allowed.some((key) => key !== "recipes")) {
      throw new Error("validate-recipes accepts only --recipes");
    }
    const count = await validateRecipes(flags.recipes ?? "docs/browser-paths.json");
    process.stdout.write(`PASS browser recipes: ${count} services\n`);
    return;
  }
  if (command === "record") {
    requireExactFlags(flags, ["service", "mode", "journey", "outcome", ...COUNT_KEYS.map((key) => key === "toolCalls" ? "tool-calls" : key), "elapsed-ms", "output"]);
    const counts = {} as Counts;
    for (const key of COUNT_KEYS) {
      const flag = key === "toolCalls" ? "tool-calls" : key;
      counts[key] = boundedInteger(flags[flag], flag, 10_000);
    }
    const record = validateRecord({
      schemaVersion: 1,
      kind: "selfhost-browser-benchmark",
      recordedAt: new Date().toISOString(),
      service: enumValue(flags.service, SERVICES, "service"),
      mode: enumValue(flags.mode, MODES, "mode"),
      journey: enumValue(flags.journey, JOURNEYS, "journey"),
      outcome: enumValue(flags.outcome, OUTCOMES, "outcome"),
      counts,
      elapsedMs: boundedInteger(flags["elapsed-ms"], "elapsed-ms", 86_400_000),
    });
    await writeJson(flags.output, record);
    process.stdout.write(`PASS browser benchmark recorded: ${record.service} ${record.mode} ${record.journey}\n`);
    return;
  }
  if (command === "report") {
    requireExactFlags(flags, ["input", "json-output", "markdown-output"]);
    const inputValue = await Bun.file(flags.input).json();
    const records = (Array.isArray(inputValue) ? inputValue : [inputValue]).map(validateRecord);
    if (records.length === 0 || records.length > 1_000) {
      throw new Error("Report input must contain 1 through 1000 records");
    }
    const report = {
      schemaVersion: 1,
      kind: "selfhost-browser-benchmark-report",
      aggregate: aggregate(records),
      groups: groupedResults(records),
      records,
    };
    await writeJson(flags["json-output"], report);
    await writeText(flags["markdown-output"], markdownReport(records));
    process.stdout.write(`PASS browser benchmark report: ${records.length} records\n`);
    return;
  }
  throw new Error(`Unknown command ${command}`);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAIL browser benchmark: ${message}\n`);
    process.exitCode = 2;
  });
}
