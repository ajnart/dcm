import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixture = await mkdtemp(join(tmpdir(), "selfhost-bin-errors-"));
const hiddenDetail = "SYNTHETIC_PRIVATE_UPSTREAM_RESPONSE_MUST_STAY_HIDDEN";
const nodeExecutable = spawnSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).stdout.trim();
assert.ok(nodeExecutable, "The focused packaged-bin fixture requires Node on the test runner PATH");
try {
  await mkdir(join(fixture, "bin"));
  await mkdir(join(fixture, "dist"));
  await copyFile(new URL("../bin/selfhost.mjs", import.meta.url), join(fixture, "bin", "selfhost.mjs"));
  await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(fixture, "dist", "app.js"), `
    export class AppCommandError extends Error {
      constructor() { super(${JSON.stringify(hiddenDetail)}); this.code = "shared-recipe-migration-required"; }
    }
    export class ComposeRuntimeUnavailableError extends Error {
      constructor() {
        super(${JSON.stringify(hiddenDetail)});
        this.code = "untrusted-exception-code";
        this.partialWritePossible = false;
      }
    }
    export class DockerApiAuthorityError extends Error {
      constructor() {
        super("Docker authority intent expired; renewal is unsupported");
        this.code = "expired-intent";
      }
    }
    export async function appCommand() {
      if (process.env.SYNTHETIC_BIN_FAILURE === "runtime") throw new ComposeRuntimeUnavailableError();
      if (process.env.SYNTHETIC_BIN_FAILURE === "recipe") throw new AppCommandError();
      if (process.env.SYNTHETIC_BIN_FAILURE === "authority") throw new DockerApiAuthorityError();
      throw new Error(${JSON.stringify(hiddenDetail)});
    }
  `);

  function run(args: string[], kind = "unexpected", json = true) {
    const flags = ["app", ...args];
    if (json) flags.push("--json");
    const result = spawnSync(nodeExecutable, [join(fixture, "bin", "selfhost.mjs"), ...flags], {
      encoding: "utf8", timeout: 10000, cwd: fixture,
      env: { ...process.env, PATH: "/usr/bin:/bin", SYNTHETIC_BIN_FAILURE: kind },
    });
    assert.equal(result.status, 1);
    assert.equal(`${result.stdout}${result.stderr}`.includes(hiddenDetail), false);
    if (!json) return result;
    assert.equal(result.stderr, "");
    return JSON.parse(result.stdout);
  }

  const missing = run(["shared", "homarr-status"], "runtime");
  assert.equal(missing.command, "app shared homarr-status");
  assert.equal(missing.error.code, "compose-bun-missing");
  assert.match(missing.error.message, /Bun 1\.4\.0.*PATH/);
  assert.match(missing.next, /Bun 1\.4\.0.*PATH.*self-host doctor/);
  assert.equal(missing.partialWritePossible, false);
  assert.equal(missing.mutation, false);
  const human = run(["shared", "homarr-status"], "runtime", false);
  assert.match(human.stderr, /Bun 1\.4\.0.*PATH.*self-host doctor/);

  for (const action of ["plan", "status", "handoff", "homarr-plan", "homarr-status", "job-plan", "transition-plan", "authority-plan"]) {
    const result = run(["shared", action]);
    assert.equal(result.command, `app shared ${action}`);
    assert.equal(result.partialWritePossible, false);
    assert.equal(result.mutation, false);
    assert.equal(result.error.code, "unexpected");
  }
  for (const action of ["setup", "add", "start", "stop", "acceptance-begin", "acceptance-finish", "authority-probe"]) {
    assert.equal(run(["shared", action]).partialWritePossible, false);
    const approved = run(["shared", action, "--approve", "synthetic-approved-action"]);
    assert.equal(approved.command, `app shared ${action}`);
    assert.equal(approved.partialWritePossible, true);
    assert.equal(approved.mutation, null);
  }
  const changedRecipe = run(["shared", "acceptance-begin"], "recipe");
  assert.equal(changedRecipe.error.code, "shared-recipe-migration-required");
  assert.equal(changedRecipe.partialWritePossible, false);
  assert.match(changedRecipe.next, /migration.*do not reset/);
  const expired = run(["shared", "authority-probe"], "authority");
  assert.equal(expired.command, "app shared authority-probe");
  assert.equal(expired.error.code, "expired-intent");
  assert.equal(expired.mutation, false);
  assert.match(expired.next, /expired.*Renewal is not supported.*not replaced/);
  assert.match(run(["shared", "start"], "authority", false).stderr, /expired.*renewal is unsupported/);
  for (const action of ["apply", "resume", "homarr-apply", "transition-apply", "job-run", "authority-apply"]) {
    const result = run(["shared", action, "--approve", "synthetic-approved-action"]);
    assert.equal(result.command, `app shared ${action}`);
    assert.equal(result.partialWritePossible, true);
    assert.equal(result.mutation, null);
  }
  const unknown = run(["shared", "unknown-action", "--approve", "synthetic-approved-action"]);
  assert.equal(unknown.command, "app shared");
  assert.equal(unknown.partialWritePossible, true);
  assert.equal(unknown.mutation, null);
  const missingAfterWrite = run(["shared", "homarr-apply", "--approve", "synthetic-approved-action"], "runtime");
  assert.equal(missingAfterWrite.error.code, "compose-bun-missing");
  assert.equal(missingAfterWrite.partialWritePossible, true, "Missing runtime must not override possible earlier writes");
  assert.equal(missingAfterWrite.mutation, null);
  const unchanged = run(["status"]);
  assert.equal(unchanged.command, "app status");
  assert.equal(unchanged.partialWritePossible, false);
  assert.equal(unchanged.mutation, false);
  console.log("Packaged bin runtime diagnostic and conservative shared failure checks passed");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
