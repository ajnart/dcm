#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installPlanSupported } from "../src/catalog-gate.ts";
import { householdCatalogSupported } from "../src/interactive-household.ts";

const entry = resolve(import.meta.dir, "..", "bin", "selfhost.mjs");

function cli(args: string[], expectedStatus: string | null = "pass"): Record<string, any> {
  const result = Bun.spawnSync({ cmd: ["node", entry, ...args], stdout: "pipe", stderr: "pipe" });
  assert.equal(result.exitCode, 0, `CLI failed: ${result.stderr.toString().slice(0, 300)}`);
  const output = JSON.parse(result.stdout.toString());
  if (expectedStatus !== null) assert.equal(output.status, expectedStatus);
  return output;
}

const created = await mkdtemp(join(tmpdir(), "selfhost-platform-smoke-"));
try {
  const root = await realpath(created);
  const doctor = cli(["doctor", "--scope", "plan", "--json"], "ready");
  assert.equal(doctor.scope, "plan");
  assert.equal(doctor.platform, process.platform);
  const targets = cli(["target", "list", "--json"], null);
  assert.equal(targets.platform, process.platform);
  assert.equal(targets.mutation, false);
  assert.ok(["available", "none", "unavailable", "unsupported"].includes(targets.status));
  const menu = cli(["catalog", "menu", "--json"]);
  assert.ok(menu.data.goals.some((goal: { id: string }) => goal.id === "photos"));
  const plan = cli(["plan", "photos", "--project-root", root, "--json"]);
  assert.ok(plan.data.selectedApps.some((app: { id: string }) => app.id === "immich"));
  assert.equal(plan.mutation, false);
  const household = cli(["plan", "personal-media", "photos", "private-notes", "passwords",
    "--compose", "--project-root", root, "--json"]);
  assert.equal(householdCatalogSupported(household.data), true);
  assert.equal(await installPlanSupported("media"), true);
  assert.equal(await installPlanSupported("household"), true);
  console.log(`PASS ${process.platform} packaged CLI doctor, catalog and photo plan`);
} finally {
  await rm(created, { recursive: true });
}
