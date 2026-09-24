#!/usr/bin/env bun

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const script = join(dirname(import.meta.path), "stack.ts");
const profiles = JSON.parse(readFileSync(join(dirname(import.meta.path), "../references/install-profiles.json"), "utf8"));
const basic = profiles.profiles.find((profile: { id: string }) => profile.id === "basic");
assert.ok(basic);

function run(projectRoot: string) {
  const result = spawnSync(process.execPath, [
    script,
    "prerequisites",
    "--profile",
    "basic",
    "--agent",
    "codex",
    "--scope",
    "project",
    "--project-root",
    projectRoot,
    "--json",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const fixture = mkdtempSync(join(tmpdir(), "selfhost-prerequisite-install-"));
process.on("exit", () => rmSync(fixture, { force: true, recursive: true }));
const missing = run(fixture);
assert.deepEqual(missing.missingSkills, basic.skills);
assert.equal(missing.ready, false);
assert.equal(missing.installCommands.some((item: { reason: string }) => item.reason.startsWith("agent-browser")), false);
const install = missing.installCommands.find((item: { reason: string }) => item.reason === "selected-profile-skills");
assert.ok(install);
assert.match(install.command, /--skill self-host/);
assert.doesNotMatch(install.command, /--skill selfhost(?:\s|-)/);

const publicRoot = join(fixture, ".agents/skills/self-host");
mkdirSync(publicRoot, { recursive: true });
writeFileSync(join(publicRoot, "SKILL.md"), "---\nname: self-host\n---\n");
for (const workflow of basic.skills as string[]) {
  if (workflow === "self-host") {
    continue;
  }
  const workflowRoot = join(publicRoot, "workflows", workflow);
  mkdirSync(workflowRoot, { recursive: true });
  writeFileSync(join(workflowRoot, "GUIDE.md"), `---\nname: ${workflow}\n---\n`);
}

const installed = run(fixture);
assert.deepEqual(installed.missingSkills, []);
assert.equal(installed.ready, true);
assert.equal(installed.installCommands.length, 0);
assert.equal(
  installed.installCommands.some((item: { reason: string }) => item.reason === "selected-profile-skills"),
  false,
);

writeFileSync(join(publicRoot, "workflows", "selfhost-compose", "GUIDE.md"), "");
const guideStillPresent = run(fixture);
assert.deepEqual(guideStillPresent.missingSkills, ["selfhost-compose"]);

process.stdout.write("self-host prerequisite install checks passed\n");
