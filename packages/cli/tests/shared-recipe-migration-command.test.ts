import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedProjectCandidate, prepareSharedProjectFiles } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedProjectCommand } from "../src/shared-project.ts";
import { reviewSharedCatalogRecipeMigration } from "../src/lib/shared-recipe-migration.ts";

const temporary = await mkdtemp(join(tmpdir(), "selfhost-migration-command-"));
const originalLog = console.log;
async function capture(task: () => Promise<void>) {
  const lines: string[] = [];
  console.log = (...values) => lines.push(values.join(" "));
  try { await task(); } finally { console.log = originalLog; }
  return JSON.parse(lines.join("\n"));
}
try {
  const recipe = JSON.parse(await readFile(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ntfy/recipe.json", import.meta.url), "utf8"));
  const priorRecipe = structuredClone(recipe);
  priorRecipe.services[0].environment = priorRecipe.services[0].environment
    .filter((entry: any) => entry.name !== "NTFY_CACHE_FILE");
  const images = { ntfy: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` };
  const args = (action: string, id: string) => [action, "--project-root", temporary,
    "--project-id", id, "--app", "ntfy", "--json"];
  const dependencies = { recipeFor: () => ({ recipe, boundedApply: true }),
    resolveImage: async () => { throw new Error("migration must retain saved images"); } };
  const tools = join(temporary, "tools");
  await mkdir(tools, { mode: 0o700 });
  const calls = join(temporary, "calls.jsonl");
  await writeFile(join(tools, "docker"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RECIPE_MIGRATION_FIXTURE_CALLS, JSON.stringify(args)+'\\n');
if (args.includes('info') && args.includes('{{.ServerVersion}}')) { process.stdout.write('27.0.0\\n'); }
else if (args.includes('volume') && args.includes('ls')) {
  const name = process.env.RECIPE_MIGRATION_FIXTURE_PROJECT+'-ntfy-data';
  if (!args.includes('name='+name)) process.exit(9);
  process.stdout.write(name+'\\n');
}
else if (args.includes('volume') && args.includes('inspect')) {
  const name = args[args.indexOf('inspect')+1];
  const project = process.env.RECIPE_MIGRATION_FIXTURE_PROJECT;
  if (name !== project+'-ntfy-data') process.exit(9);
  process.stdout.write([name,'local',project,name,project,'ntfy-data'].join('\\t')+'\\n');
}
else if (args.includes('config') && args.includes('--quiet')) {}
else if (args.includes('up') && args.includes('--force-recreate') && args.at(-1)==='ntfy') {
  if (process.env.RECIPE_MIGRATION_FIXTURE_FAIL==='1') process.exit(17);
}
else process.exit(9);
`, { mode: 0o700 });
  const child = join(temporary, "apply.ts");
  await writeFile(child, `import { sharedProjectCommand } from ${JSON.stringify(new URL("../src/shared-project.ts", import.meta.url).href)};
await sharedProjectCommand(JSON.parse(process.argv[2]), {recipeFor:()=>({recipe:${JSON.stringify(recipe)},boundedApply:true}),
resolveImage:async()=>{throw new Error('unexpected registry lookup')}});
`, { mode: 0o600 });
  for (const [projectId, fail, interrupted, refuseAttempted] of [["migration-ok", false, false, false],
    ["migration-uncertain", true, false, false], ["migration-reviewed", false, true, false],
    ["migration-attempted", false, true, true]] as const) {
    const prior = { appId: "ntfy", recipe: priorRecipe, images, port: 19203 };
    const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId,
      dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [prior],
      observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
    await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
    const owner = createSelfhostComposeOwner(candidate.manifest);
    await owner.render(await owner.plan());
    await prepareSharedProjectFiles(candidate, [prior]);
    let state = await saveSharedProjectState(candidate, { operation: "create", phase: "reviewed", appIds: ["ntfy"] },
      { revision: 0, manifestHash: null, checkpoint: null });
    for (const phase of ["attempted", "completed"] as const) state = await saveSharedProjectState(candidate,
      { operation: "create", phase, appIds: ["ntfy"] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
    const passwordPath = join(candidate.projectDirectory, "secrets", "ntfy", "admin-password");
    const password = await readFile(passwordPath);
    const envPath = join(candidate.projectDirectory, "secrets", "ntfy", "ntfy.env");
    const environment = await readFile(envPath);
    let review = await capture(() => sharedProjectCommand(args("recipe-migration-plan", projectId), dependencies));
    assert.equal(review.status, "review");
    assert.equal(review.mutation, false);
    assert.deepEqual(review.services, ["ntfy"]);
    assert.equal(review.credentialsRegenerated, false);
    assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, state.recordHash);
    await assert.rejects(sharedProjectCommand([...args("recipe-migration-apply", projectId), "--approve", "wrong"], dependencies), /exact saved-owner approval/);
    for (const extra of [["--port", "ntfy=19204"], ["--input", "ntfy.option=value"], ["--app", "other"]]) {
      await assert.rejects(sharedProjectCommand([...args("recipe-migration-plan", projectId), ...extra], dependencies), /one saved app/);
    }
    if (interrupted) {
      const originalApproval = review.approval;
      const migration = reviewSharedCatalogRecipeMigration(state, "ntfy", recipe);
      const reviewedOwner = createSelfhostComposeOwner(migration.candidate.manifest);
      const reviewedPath = await reviewedOwner.render(await reviewedOwner.plan());
      const reviewedBytes = await readFile(reviewedPath);
      state = await saveSharedProjectState(migration.candidate,
        { operation: "recipe-migration", phase: "reviewed", appIds: ["ntfy"] },
        { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
      await writeFile(reviewedPath, Buffer.concat([reviewedBytes, Buffer.from("# synthetic tamper\n")]));
      await assert.rejects(sharedProjectCommand(args("recipe-migration-plan", projectId), dependencies), /rendered check failed/);
      await writeFile(reviewedPath, reviewedBytes);
      review = await capture(() => sharedProjectCommand(args("recipe-migration-plan", projectId), dependencies));
      assert.equal(review.status, "resume-reviewed");
      assert.equal(review.resumeReviewed, true);
      assert.equal(review.pendingRevision, state.revision);
      assert.notEqual(review.approval, originalApproval);
      assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, state.recordHash);
      await assert.rejects(sharedProjectCommand([...args("recipe-migration-apply", projectId),
        "--approve", originalApproval], dependencies), /exact saved-owner approval/);
      if (refuseAttempted) {
        const attempted = await saveSharedProjectState(migration.candidate,
          { operation: "recipe-migration", phase: "attempted", appIds: ["ntfy"] },
          { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
        await assert.rejects(sharedProjectCommand(args("recipe-migration-plan", projectId), dependencies), /no automatic replay/);
        await assert.rejects(sharedProjectCommand([...args("recipe-migration-apply", projectId),
          "--approve", review.approval], dependencies), /no automatic replay/);
        assert.equal((await loadSharedProjectState(candidate.projectDirectory, projectId))?.recordHash, attempted.recordHash);
        continue;
      }
    }
    const result = Bun.spawnSync([process.execPath, child,
      JSON.stringify([...args("recipe-migration-apply", projectId), "--approve", review.approval])], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${tools}:${process.env.PATH}`,
        RECIPE_MIGRATION_FIXTURE_CALLS: calls, RECIPE_MIGRATION_FIXTURE_PROJECT: projectId,
        RECIPE_MIGRATION_FIXTURE_FAIL: String(Number(fail)) } });
    if (fail) {
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr.toString(), /outcome is uncertain/);
    } else {
      assert.equal(result.exitCode, 0, `${result.stderr.toString()}\nFixture Docker calls: ${await readFile(calls, "utf8")}`);
      assert.equal(JSON.parse(result.stdout.toString()).status, "migrated-unverified");
    }
    const updated = await loadSharedProjectState(candidate.projectDirectory, projectId);
    assert.equal(updated?.checkpoint.phase, fail ? "inspect-required" : "completed");
    assert.equal(updated?.checkpoint.operation, "recipe-migration");
    if (interrupted) assert.equal(updated?.revision, state.revision + 2);
    else assert.equal(updated?.revision, state.revision + 3);
    if (fail) await assert.rejects(sharedProjectCommand(args("recipe-migration-plan", projectId), dependencies), /no automatic replay/);
    assert.deepEqual(await readFile(passwordPath), password);
    assert.deepEqual(await readFile(envPath), environment);
    const invocations = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const writes = invocations.filter((argv) => argv.includes("up"));
    assert.ok(writes.length > 0);
    assert.ok(writes.every((argv) => argv.includes("--no-deps") && argv.includes("--force-recreate") && argv.at(-1) === "ntfy"));
    assert.ok(invocations.every((argv) => !argv.includes("down") && !argv.includes("prune")));
    await assert.rejects(sharedProjectCommand([...args("recipe-migration-apply", projectId), "--approve", review.approval], dependencies));
  }
} finally {
  console.log = originalLog;
  await rm(temporary, { recursive: true, force: true });
}
console.log("PASS production migration/scoped apply, reviewed recovery with fresh approval, attempted refusal and unchanged credentials (fixture Docker only)");
