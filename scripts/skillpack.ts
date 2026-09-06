#!/usr/bin/env bun

import {
  auditPublication,
  benchmarkPack,
  buildPackage,
  checkRelease,
  envelope,
  formatError,
  inspectPack,
  loadRegistry,
  runBehaviorTests,
  validatePack,
  writeIndexArtifacts,
  writePackage
} from "./lib/skillpack.ts";

type FlagValue = boolean | string;

interface ParsedArguments {
  flags: Record<string, FlagValue>;
  positional: string[];
}

function usage() {
  return `Selfhost Skills CLI

Usage:
  bun run skillpack <command> [options]

Commands:
  inspect                         Summarize the installed skill pack
  audit                           Audit publishable history and assets
  validate [--scope SCOPE]        Validate metadata, content, package, and public contracts
  test (--skill ID | --changed-from REF | --all)
                                  Run deterministic behavior scenarios
  index (--check | --write)       Check or regenerate discovery indexes
  benchmark [--runs COUNT]        Measure command latency against the p95 budget
  release-check [--tag TAG]       Verify release version and changelog contracts
  package [--version VERSION] --output DIRECTORY
                                  Build a reproducible release archive

Global option:
  --json                          Emit the stable machine-readable envelope

Examples:
  bun run skillpack inspect
  bun run skillpack validate --scope all --json
  bun run skillpack test --changed-from origin/main`;
}

function parseArguments(input: string[]): ParsedArguments {
  const flags: Record<string, FlagValue> = { json: false };
  const positional: string[] = [];
  const valued = new Set(["--scope", "--skill", "--changed-from", "--runs", "--version", "--output", "--tag"]);
  const boolean = new Set(["--json", "--all", "--check", "--write"]);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    if (boolean.has(value)) {
      flags[value.slice(2)] = true;
      continue;
    }
    if (!valued.has(value)) {
      throw new Error(`Unknown option ${value}`);
    }
    index += 1;
    if (index >= input.length) {
      throw new Error(`Option ${value} requires a value`);
    }
    flags[value.slice(2)] = input[index];
  }
  return { flags, positional };
}

function printResult(result: {
  command: string;
  limitations: string[];
  status: string;
  summary: string;
}, json: FlagValue) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.status.toUpperCase()} ${result.command}: ${result.summary}\n`);
  if (result.status !== "pass") {
    for (const limitation of result.limitations) {
      process.stdout.write(`  - ${limitation}\n`);
    }
  }
}

function requiredFlag(flags: Record<string, FlagValue>, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

async function main() {
  const [command, ...input] = Bun.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const parsed = parseArguments(input);
  if (parsed.positional.length > 0) {
    throw new Error(`Unexpected argument ${parsed.positional[0]}`);
  }
  let result;
  if (command === "inspect") {
    const data = await inspectPack();
    result = envelope(command, "pass", data, { summary: `Inspected ${data.skills} skills at pack version ${data.packVersion}.` });
  } else if (command === "audit") {
    const data = await auditPublication();
    let status = "pass";
    if (!data.ok) {
      status = "blocked";
      process.exitCode = 3;
    }
    result = envelope(command, status, data, { decisions: data.decisions, limitations: data.blockers, summary: `Audited ${data.history.commits} commits and ${data.images.total} tracked images for publication.` });
  } else if (command === "validate") {
    const scope = parsed.flags.scope || "all";
    const data = await validatePack(scope);
    let status = "pass";
    const limitations = [];
    if (!data.ok) {
      status = "blocked";
      for (const check of data.checks) {
        limitations.push(...check.errors);
      }
      process.exitCode = 3;
    }
    result = envelope(command, status, data, { limitations, summary: `${data.checks.length} validation groups completed for ${scope}.` });
  } else if (command === "test") {
    if (!parsed.flags.all && !parsed.flags.skill && !parsed.flags["changed-from"]) {
      throw new Error("Use --all, --skill ID, or --changed-from REF");
    }
    const data = await runBehaviorTests({ skill: parsed.flags.skill, changedFrom: parsed.flags["changed-from"] });
    let status = "pass";
    const limitations = [];
    if (!data.ok) {
      status = "blocked";
      limitations.push("One or more deterministic behavior checks failed");
      process.exitCode = 3;
    }
    if (data.uncovered.length > 0) {
      limitations.push(`No migrated behavior scenario yet: ${data.uncovered.join(", ")}`);
      if (status === "pass") {
        status = "warn";
      }
    }
    result = envelope(command, status, data, { limitations, summary: `Ran ${data.results.length} checks across ${data.covered.length} covered skills.` });
  } else if (command === "index") {
    if (parsed.flags.write === parsed.flags.check) {
      throw new Error("Use exactly one of --check or --write");
    }
    if (parsed.flags.write) {
      const files = await writeIndexArtifacts();
      result = envelope(command, "pass", { files }, { mutation: true, summary: `Generated ${files.length} discovery indexes.` });
    } else {
      const data = await validatePack("public");
      let status = "pass";
      const limitations = [];
      if (!data.ok) {
        status = "blocked";
        process.exitCode = 3;
        for (const check of data.checks) {
          limitations.push(...check.errors);
        }
      }
      result = envelope(command, status, data, { limitations, summary: "Checked generated discovery indexes." });
    }
  } else if (command === "benchmark") {
    let runs = 30;
    if (parsed.flags.runs) {
      runs = Number.parseInt(parsed.flags.runs, 10);
    }
    if (!Number.isInteger(runs) || runs < 3 || runs > 100) {
      throw new Error("--runs must be an integer from 3 through 100");
    }
    const data = benchmarkPack(runs);
    let status = "pass";
    const limitations = [];
    if (!data.ok) {
      status = "blocked";
      limitations.push(`One or more commands exceeded the ${data.p95BudgetMs} ms p95 budget`);
      process.exitCode = 3;
    }
    result = envelope(command, status, data, { limitations, summary: `Benchmarked ${data.results.length} commands over ${runs} runs each.` });
  } else if (command === "release-check") {
    const tag = parsed.flags.tag;
    const data = await checkRelease(tag);
    let status = "pass";
    if (!data.ok) {
      status = "blocked";
      process.exitCode = 3;
    }
    result = envelope(command, status, data, { limitations: data.errors, summary: `Checked ${data.tag} against the complete release contract.` });
  } else if (command === "package") {
    let version = parsed.flags.version;
    if (!version) {
      const registry = await loadRegistry();
      version = registry.packVersion;
    }
    const output = requiredFlag(parsed.flags, "output");
    await buildPackage(version);
    const data = await writePackage(version, output);
    result = envelope(command, "pass", data, { mutation: true, summary: `Built reproducible package ${data.archive}.` });
  } else {
    throw new Error(`Unknown command ${command}`);
  }
  printResult(result, parsed.flags.json);
}

main().catch((error) => {
  const message = formatError(error);
  const result = envelope("skillpack", "blocked", null, {
    limitations: [message],
    summary: "The command stopped before completion."
  });
  printResult(result, Bun.argv.includes("--json"));
  process.exitCode = 2;
});
