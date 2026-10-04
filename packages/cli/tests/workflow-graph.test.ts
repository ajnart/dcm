#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { buildCompositePlan, buildPlan, loadCatalog } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";

const catalog = await loadCatalog();
const ids = ["personal-media", "photos", "private-notes", "passwords"];
const stacks = ids.map((id) => catalog.stacks.find((stack) => stack.id === id));
assert.ok(stacks.every(Boolean));

const plan = buildCompositePlan(catalog, stacks);
assert.equal(plan.workflow.mode, "planning-only");
assert.deepEqual(plan.workflow.parallelCandidates, ["app-immich", "app-docmost"]);
assert.deepEqual(plan.workflow.parallelGroups, [{ needs: ["media"], jobs: ["app-immich", "app-docmost"] }]);
const jobs = new Map(plan.workflow.jobs.map((job) => [job.id, job]));
assert.equal(jobs.size, plan.workflow.jobs.length);
for (const job of jobs.values()) {
  for (const dependency of job.needs) assert.ok(jobs.has(dependency), `${job.id} depends on an unknown job`);
}
assert.deepEqual(jobs.get("homarr-attachments").needs,
  ["media", "app-immich", "app-docmost", "app-vaultwarden"]);
assert.deepEqual(jobs.get("app-immich").needs, ["media"]);
assert.deepEqual(jobs.get("app-docmost").needs, ["media"]);
assert.ok(jobs.get("app-immich").gates.includes("media-web-network-bound"));
assert.ok(jobs.get("app-vaultwarden").gates.includes("private-https-before-signup"));
assert.ok(!plan.workflow.parallelCandidates.includes("app-vaultwarden"));

const appOnly = buildPlan(catalog, stacks[1], { "control-plane": "off" });
assert.ok(!appOnly.workflow.jobs.some((job) => job.id === "homarr-attachments"));
assert.deepEqual(appOnly.workflow.parallelCandidates, []);
console.log("PASS catalog workflow graph keeps independent jobs and human gates distinct");
