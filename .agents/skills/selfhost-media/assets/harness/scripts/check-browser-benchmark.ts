#!/usr/bin/env bun

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { groupedResults, validateRecord } from "./browser-benchmark.ts";

const root = await mkdtemp(join(tmpdir(), "browser-benchmark-"));
const recordPath = join(root, "record.json");
const jsonPath = join(root, "report.json");
const markdownPath = join(root, "report.md");

const valid = {
  schemaVersion: 1,
  kind: "selfhost-browser-benchmark",
  recordedAt: "2026-09-21T00:00:00.000Z",
  service: "sonarr",
  mode: "browser-wiring",
  journey: "fresh",
  outcome: "pass",
  counts: { navigations: 1, interactions: 2, snapshots: 1, waits: 1, toolCalls: 5, retries: 0 },
  elapsedMs: 1200,
};
assert.deepEqual(validateRecord(valid), valid);
assert.throws(() => validateRecord({ ...valid, note: "arbitrary payload" }));
assert.throws(() => validateRecord({ ...valid, service: "other" }));
assert.throws(() => validateRecord({ ...valid, counts: { ...valid.counts, retries: -1 } }));
assert.throws(() => validateRecord({ ...valid, secret: "do-not-accept" }));
const repeated = groupedResults([
  valid,
  { ...valid, elapsedMs: 800 },
  { ...valid, elapsedMs: 1000 },
  { ...valid, outcome: "fail", elapsedMs: 400 },
]);
assert.deepEqual(repeated[0].elapsedMs, { median: 1000, p95: 1200 });
assert.equal(repeated[0].failed, 1);

async function run(args: string[]) {
  const process = Bun.spawn(["bun", "scripts/browser-benchmark.ts", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const recipes = await run(["validate-recipes"]);
assert.equal(recipes.exitCode, 0, recipes.stderr);
assert.match(recipes.stdout, /7 services/);

const invalidRecipesPath = join(root, "invalid-recipes.json");
const invalidRecipes = JSON.parse(await readFile("docs/browser-paths.json", "utf8"));
invalidRecipes.services[0].captureHelper = "session arbitrary-command RUN_ID sonarr";
await writeFile(invalidRecipesPath, `${JSON.stringify(invalidRecipes)}\n`);
const invalidRecipesResult = await run(["validate-recipes", "--recipes", invalidRecipesPath]);
assert.notEqual(invalidRecipesResult.exitCode, 0);
assert.match(invalidRecipesResult.stderr, /capture helper is invalid/);

const lookup = await run(["lookup", "sonarr"]);
assert.equal(lookup.exitCode, 0, lookup.stderr);
const recipe = JSON.parse(lookup.stdout);
assert.equal(recipe.settingsPath, "/settings/general");
assert.match(recipe.successSignal, /qBittorrent/);

const recorded = await run([
  "record", "--service", "sonarr", "--mode", "browser-wiring", "--journey", "fresh", "--outcome", "pass",
  "--navigations", "1", "--interactions", "2", "--snapshots", "1", "--waits", "1",
  "--tool-calls", "5", "--retries", "0", "--elapsed-ms", "1200", "--output", recordPath,
]);
assert.equal(recorded.exitCode, 0, recorded.stderr);
validateRecord(JSON.parse(await readFile(recordPath, "utf8")));

const reported = await run(["report", "--input", recordPath, "--json-output", jsonPath, "--markdown-output", markdownPath]);
assert.equal(reported.exitCode, 0, reported.stderr);
const report = JSON.parse(await readFile(jsonPath, "utf8"));
assert.equal(report.aggregate.records, 1);
assert.equal(report.aggregate.counts.toolCalls, 5);
assert.equal(report.groups[0].elapsedMs, null);
assert.match(await readFile(markdownPath, "utf8"), /recorded observations/i);

process.stdout.write("PASS browser benchmark recorder\n");
