import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedProjectCandidate, prepareSharedProjectFiles, extendSharedProject } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState, loadSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedUnitStatus, sharedUnitHandoff } from "../src/lib/shared-unit-setup.ts";
import { sharedProjectCommand, sharedHostRequest } from "../src/shared-project.ts";

const temporary = await mkdtemp(join(tmpdir(), "selfhost-shared-jobs-"));
const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
const observed = { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] };
const originalLog = console.log;
async function capture(operation: () => Promise<void>) {
  const lines: string[] = [];
  console.log = (...values) => { lines.push(values.join(" ")); };
  try { await operation(); } finally { console.log = originalLog; }
  return JSON.parse(lines.join("\n"));
}
try {
  const apps = await Promise.all(["restic", "borgmatic", "renovate"].map(async (appId) => {
    const recipe = JSON.parse(await readFile(new URL(`${appId}/recipe.json`, catalog), "utf8"));
    return { appId, recipe, images: { [appId]: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` }, port: null };
  }));
  const recipeFor = (appId: string) => {
    const selection = apps.find((app) => app.appId === appId);
    assert.ok(selection);
    return { recipe: selection.recipe, boundedApply: true };
  };
  const dependencies = { recipeFor, resolveImage: async () => { throw new Error("unexpected image resolution"); } };
  const input = { projectRoot: temporary, projectId: "jobs", dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps, observed };
  const candidate = sharedProjectCandidate(input);
  assert.equal(candidate.manifest.services.length, 3);
  for (const service of candidate.manifest.services) {
    assert.deepEqual(service.ports, []);
    assert.deepEqual(service.networks, [`${service.id}-private`]);
    assert.deepEqual(service.profiles, ["self-host-manual"]);
    assert.equal(service.restart, "no");
  }
  const hostRequest = sharedHostRequest(temporary, "jobs", apps);
  assert.deepEqual(hostRequest.tcpPorts, []);
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const plan = await owner.plan();
  assert.equal(plan.status, "pass");
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  await owner.render(plan);
  await prepareSharedProjectFiles(candidate, apps, { "renovate:forge-token": Buffer.from("synthetic_fixture_token") });
  const checkpoints = { operation: "create" as const, appIds: apps.map((app) => app.appId).sort() };
  let state = await saveSharedProjectState(candidate, { ...checkpoints, phase: "reviewed" },
    { revision: 0, manifestHash: null, checkpoint: null });
  for (const phase of ["attempted", "completed"] as const) state = await saveSharedProjectState(candidate,
    { ...checkpoints, phase }, { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  for (const app of apps) {
    const status = await sharedUnitStatus(temporary, "jobs", app.appId, recipeFor, () => "fixture", false);
    assert.equal(status.status, "job-prepared");
    assert.equal(status.port, null);
    assert.equal(status.url, null);
    assert.equal(status.username, null);
    assert.equal(status.passwordFile, null);
    assert.equal(status.loginVia, "job-credentials");
    assert.equal(status.executed, false);
    assert.equal(status.acceptanceVerified, false);
    const handoff = await sharedUnitHandoff(temporary, "jobs", app.appId, recipeFor, () => "fixture");
    assert.equal(handoff.url, null);
    assert.equal(handoff.passwordFile, null);
  }
  const status = await capture(() => sharedProjectCommand(["status", "--project-root", temporary,
    "--project-id", "jobs", "--json"], dependencies));
  assert.deepEqual(status.manualJobs, apps.map((app) => app.appId).sort());
  assert.deepEqual(status.setup.direct, []);
  assert.deepEqual(status.setup.pending, []);
  assert.equal(status.jobExecutionVerified, false);
  const review = await capture(() => sharedProjectCommand(["job-plan", "--project-root", temporary,
    "--project-id", "jobs", "--app", "restic", "--json"], dependencies));
  assert.equal(review.status, "review");
  assert.equal(review.mutation, false);
  assert.equal(review.probeOnly, true);
  assert.deepEqual(review.probe.argv, ["restic", "version"]);
  assert.match(review.approval, /^SHARED-JOB-PROBE:jobs:[a-f0-9]{64}$/);
  await assert.rejects(sharedProjectCommand(["job-run", "--project-root", temporary,
    "--project-id", "jobs", "--app", "restic", "--approve", `SHARED-JOB-PROBE:jobs:${"0".repeat(64)}`], dependencies), /exact saved-owner/);
  for (const action of ["start", "stop"]) await assert.rejects(sharedProjectCommand([action,
    "--project-root", temporary, "--project-id", "jobs", "--app", "restic"], dependencies), /manual job/);
  const unchanged = await loadSharedProjectState(candidate.projectDirectory, "jobs");
  assert.equal(unchanged?.recordHash, state.recordHash, "read-only review and rejected approvals preserve owner");
  const changed = structuredClone(apps[0].recipe);
  changed.services[0].purpose += " changed";
  await assert.rejects(sharedProjectCommand(["job-plan", "--project-root", temporary,
    "--project-id", "jobs", "--app", "restic"], { ...dependencies,
      recipeFor: (id) => { if (id === "restic") return { recipe: changed, boundedApply: true }; return recipeFor(id); } }), /recipe changed/);

  // Inert job-private networks need not exist before adding an automatic app.
  const recipe = JSON.parse(await readFile(new URL("grafana/recipe.json", catalog), "utf8"));
  const extra = { appId: "grafana", recipe, port: recipe.defaults.publishedPort,
    images: Object.fromEntries(recipe.services.map((service: any) => [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`])) };
  const retainedPaths = candidate.manifest.services.flatMap((service: any) => service.mounts
    .filter((mount: any) => mount.kind !== "volume").map((mount: any) => ({ path: mount.source, owner: "jobs" })));
  const extended = extendSharedProject(candidate, [extra], input,
    { ...observed, volumes: [], paths: retainedPaths, project: { id: "jobs", owner: "jobs", directory: candidate.projectDirectory } });
  assert.deepEqual(extended.units.restic, candidate.units.restic);
  assert.equal(extended.selectionFingerprints.restic, candidate.selectionFingerprints.restic);
  assert.equal(extended.manifest.networks.find((network: any) => network.id === "restic-private").ownership, "new");
  assert.equal((await createSelfhostComposeOwner(extended.manifest).plan()).status, "pass");

  const tools = join(temporary, "tools");
  await mkdir(tools, { mode: 0o700 });
  const calls = join(temporary, "calls.txt");
  await writeFile(join(tools, "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SHARED_JOB_FIXTURE_CALLS"
case "$*" in
  'context inspect default --format '* ) printf '"unix:///var/run/docker.sock"\\n' ;;
  *' ps --all --format json' ) printf '[]\\n' ;;
  *' info --format '* ) printf '27.0.0\\n' ;;
  *' config --quiet' ) ;;
  *' run --rm --no-deps --entrypoint restic restic version' )
    if [[ "$SHARED_JOB_FIXTURE_FAIL" == 1 ]]; then exit 1; fi ;;
  * ) exit 9 ;;
esac
`, { mode: 0o700 });
  const previousPath = process.env.PATH;
  const child = join(temporary, "probe-child.ts");
  await writeFile(child, `import { sharedProjectCommand } from ${JSON.stringify(new URL("../src/shared-project.ts", import.meta.url).href)};
const selections = ${JSON.stringify(apps)};
await sharedProjectCommand(JSON.parse(process.argv[2]), {
  recipeFor: (id) => ({ recipe: selections.find((selection) => selection.appId === id).recipe, boundedApply: true }),
  resolveImage: async () => { throw new Error("unexpected image resolution"); }
});\n`, { mode: 0o600 });
  function runProbe(approval: string, fail = false) {
    const args = ["job-run", "--project-root", temporary, "--project-id", "jobs",
      "--app", "restic", "--approve", approval, "--json"];
    return Bun.spawnSync([process.execPath, child, JSON.stringify(args)], { stdout: "pipe", stderr: "pipe",
      env: { ...process.env, PATH: `${tools}:${previousPath}`, SHARED_JOB_FIXTURE_CALLS: calls,
        SHARED_JOB_FIXTURE_FAIL: String(Number(fail)) } });
  }
  try {
    const result = runProbe(review.approval);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const completed = JSON.parse(result.stdout.toString());
    assert.equal(completed.status, "probe-completed");
    assert.equal(completed.versionProbeVerified, true);
    assert.equal(completed.jobExecutionVerified, false);
    assert.equal(completed.backupVerified, false);
    assert.equal(completed.restoreVerified, false);
    const probeState = await loadSharedProjectState(candidate.projectDirectory, "jobs");
    assert.equal(probeState?.checkpoint.operation, "job-probe");
    assert.equal(probeState?.checkpoint.phase, "completed");
    const invocations = await readFile(calls, "utf8");
    assert.match(invocations, /run --rm --no-deps --entrypoint restic restic version/);
    assert.doesNotMatch(invocations, /\b(?:backup|restore|init|up)\b/);
    await assert.rejects(sharedProjectCommand(["job-run", "--project-root", temporary,
      "--project-id", "jobs", "--app", "restic", "--approve", review.approval], dependencies), /exact saved-owner/);
    const next = await capture(() => sharedProjectCommand(["job-plan", "--project-root", temporary,
      "--project-id", "jobs", "--app", "restic", "--json"], dependencies));
    const failed = runProbe(next.approval, true);
    assert.notEqual(failed.exitCode, 0);
    assert.match(failed.stderr.toString(), /no automatic replay/);
    assert.equal((await loadSharedProjectState(candidate.projectDirectory, "jobs"))?.checkpoint.phase, "inspect-required");
    await assert.rejects(sharedProjectCommand(["job-plan", "--project-root", temporary,
      "--project-id", "jobs", "--app", "restic"], dependencies), /completed shared owner/);
  } finally {
    // All Docker-looking operations above use only the fresh child's fixture PATH.
  }
} finally {
  console.log = originalLog;
  await rm(temporary, { recursive: true });
}
process.stdout.write("shared manual-job preparation, metadata, and probe approval checks passed (no Docker)\n");
