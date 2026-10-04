import assert from "node:assert/strict";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareSharedProjectFiles, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { sharedUnitHandoff, sharedUnitSecretHandoff } from "../src/lib/shared-unit-setup.ts";
import { sharedProjectCommand } from "../src/shared-project.ts";

const temporary = await mkdtemp(join(tmpdir(), "selfhost-manual-handoff-"));
try {
  const appIds = ["borgmatic", "restic"];
  const selections = await Promise.all(appIds.map(async (appId) => {
    const recipe = JSON.parse(await readFile(new URL(
      `../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${appId}/recipe.json`,
      import.meta.url), "utf8"));
    return { appId, recipe, images: {
      [appId]: `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}` }, port: null };
  }));
  const projectId = "manual-handoff";
  const candidate = sharedProjectCandidate({ projectRoot: temporary, projectId,
    dockerContext: "default", uid: process.getuid!(), gid: process.getgid!(), timezone: "Etc/UTC",
    apps: selections, observed: { checkedAt: "2026-10-03T12:00:00Z",
      ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const plan = await owner.plan();
  assert.equal(plan.status, "pass");
  await owner.render(plan);
  await prepareSharedProjectFiles(candidate, selections);
  const reviewed = { operation: "create" as const, phase: "reviewed" as const, appIds };
  const first = await saveSharedProjectState(candidate, reviewed,
    { revision: 0, manifestHash: null, checkpoint: null });
  const attempted = await saveSharedProjectState(candidate, { ...reviewed, phase: "attempted" },
    { revision: first.revision, manifestHash: first.manifestHash, checkpoint: first.checkpoint });
  await saveSharedProjectState(candidate, { ...reviewed, phase: "completed" },
    { revision: attempted.revision, manifestHash: attempted.manifestHash, checkpoint: attempted.checkpoint });
  const recipeFor = (appId: string) => ({
    recipe: selections.find((selection) => selection.appId === appId)!.recipe, boundedApply: true });
  const dependencies = { recipeFor, async resolveImage() { throw new Error("handoff cannot resolve images"); } };
  const capture = async (args: string[]) => {
    const output: string[] = [];
    const original = console.log;
    console.log = (line: string) => { output.push(line); };
    try { await sharedProjectCommand(args, dependencies); }
    finally { console.log = original; }
    return output.join("\n");
  };
  for (const selection of selections) {
    const { appId, recipe } = selection;
    const fileId = recipe.privateFiles[0].id;
    const secretDirectory = join(candidate.projectDirectory, "secrets", appId);
    const secretPath = join(secretDirectory, fileId);
    const value = await readFile(secretPath, "utf8");
    const publicHandoff = await sharedUnitHandoff(temporary, projectId, appId, recipeFor, () => "unused");
    assert.deepEqual(publicHandoff.credentialFiles, { [fileId]: secretPath });
    assert.equal(publicHandoff.secretful, false);
    assert.equal(publicHandoff.manualJob, true);
    assert.equal(publicHandoff.executed, false);
    assert.equal(publicHandoff.acceptanceVerified, false);
    assert.equal(publicHandoff.username, null);
    assert.equal(publicHandoff.url, null);
    assert.equal(publicHandoff.passwordFile, null);
    assert.equal(publicHandoff.apiKeyFile, null);
    assert.equal(publicHandoff.recovery.adapter.state, "present");
    assert.ok(publicHandoff.recovery.adapter.path.endsWith(`/apps/${appId}/setup.ts`));
    assert.match(publicHandoff.recovery.adapter.sha256, /^[0-9a-f]{64}$/);
    assert.ok(publicHandoff.recovery.instructions.some((instruction: string) => instruction.includes("same completion criterion")));
    assert.ok(publicHandoff.recovery.instructions.some((instruction: string) => instruction.includes("if unavailable, stop")));
    assert.ok(!Object.hasOwn(publicHandoff, "credentials"));
    assert.ok(!JSON.stringify(publicHandoff).includes(value.trim()));
    const secretful = await sharedUnitSecretHandoff(temporary, projectId, appId, recipeFor, () => "unused");
    assert.deepEqual(secretful.credentials, { [fileId]: value.trim() });
    assert.equal(secretful.password, null);
    assert.equal(secretful.apiKey, null);
    const args = ["handoff", "--project-root", temporary, "--project-id", projectId, "--app", appId];
    const json = JSON.parse(await capture([...args, "--json"]));
    assert.deepEqual(json.credentialFiles, { [fileId]: secretPath });
    assert.ok(!JSON.stringify(json).includes(value.trim()));
    const shown = JSON.parse(await capture([...args, "--show", "--json"]));
    assert.deepEqual(shown.credentials, { [fileId]: value.trim() });
    const plain = await capture(args);
    assert.ok(plain.includes(secretPath));
    assert.ok(!plain.includes(value.trim()));
    assert.ok(!plain.includes("Jellyfin"));
    const privatePlain = await capture([...args, "--show"]);
    assert.ok(privatePlain.includes(JSON.stringify(value.trim())));
    assert.ok(privatePlain.includes("Prepared job; no workload has run"));
    assert.ok(!privatePlain.includes("Jellyfin"));

    await chmod(secretPath, 0o644);
    await assert.rejects(sharedUnitSecretHandoff(temporary, projectId, appId, recipeFor, () => "unused"),
      /exact owner-only file|rendered check failed/);
    await chmod(secretPath, 0o600);
    const alias = join(secretDirectory, "synthetic-alias");
    await link(secretPath, alias);
    await assert.rejects(sharedUnitSecretHandoff(temporary, projectId, appId, recipeFor, () => "unused"),
      /exact owner-only file|rendered check failed/);
    await unlink(alias);
    await unlink(secretPath);
    await writeFile(alias, value, { mode: 0o600 });
    await symlink(alias, secretPath);
    await assert.rejects(sharedUnitSecretHandoff(temporary, projectId, appId, recipeFor, () => "unused"));
    await unlink(secretPath);
    await unlink(alias);
    await writeFile(secretPath, value, { mode: 0o600 });
    await chmod(secretDirectory, 0o755);
    await assert.rejects(sharedUnitSecretHandoff(temporary, projectId, appId, recipeFor, () => "unused"),
      /exact owner-only file|rendered check failed/);
    await chmod(secretDirectory, 0o700);
  }
} finally {
  await rm(temporary, { recursive: true });
}
console.log("shared manual-job credential handoff: pass");
