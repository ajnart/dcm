import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAppRecipe } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import { checkedManualProbe } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/manual-job.ts";
import { checkedManualJobRecipe, isManualJobService } from "../src/lib/manual-job.ts";
import { multiServiceManifest, prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

const catalogRoot = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/", import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), "selfhost-manual-job-"));
try {
  for (const appId of ["restic", "borgmatic", "renovate"]) {
    const recipe = JSON.parse(await readFile(new URL(`${appId}/recipe.json`, catalogRoot), "utf8"));
    const app = JSON.parse(await readFile(new URL(`${appId}/manifest.json`, catalogRoot), "utf8"));
    assert.deepEqual(validateAppRecipe(recipe, app), []);
    assert.equal(checkedManualJobRecipe(recipe), true);
    const projectId = `manual-${appId}`;
    const projectDirectory = join(temporary, projectId);
    const dataDirectory = join(projectDirectory, "data");
    const image = `${recipe.services[0].imageTag}@sha256:${"a".repeat(64)}`;
    const hostPaths: Record<string, string> = {};
    const manifest = multiServiceManifest({ recipe, images: { [appId]: image }, projectId,
      appsRoot: temporary, projectDirectory, dataDirectory, dockerContext: "default",
      port: null, hostPaths, uid: 1000, gid: 1000,
      observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } });
    const service = manifest.services[0];
    assert.equal(isManualJobService(service), true);
    assert.deepEqual(service.profiles, ["self-host-manual"]);
    assert.deepEqual(service.ports, []);
    assert.deepEqual(service.manualProbe, recipe.execution.probe);
    assert.deepEqual(checkedManualProbe(image, service.manualProbe), recipe.execution.probe);
    assert.equal(service.restart, "no");
    if (appId === "restic") assert.equal(service.hostname, "self-host-restic");
    if (appId !== "renovate") {
      assert.equal(service.mounts.find((mount: any) => mount.target.includes("source")).source,
        join(dataDirectory, "source"));
      assert.equal(service.mounts.find((mount: any) => mount.target.includes("repository")).source,
        join(dataDirectory, "repository"));
    }
    const owner = createSelfhostComposeOwner(manifest);
    const plan = await owner.plan();
    assert.equal(plan.status, "pass");
    assert.equal(plan.execution.performed, false);

    let inputs: Record<string, Buffer> = {};
    if (appId === "renovate") inputs = { "forge-token": Buffer.from("synthetic_fixture_token") };
    await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory, hostPaths, undefined, inputs);
    const privatePath = join(projectDirectory, "secrets", recipe.privateFiles[0].id);
    const metadata = await lstat(privatePath);
    assert.equal(metadata.mode & 0o777, 0o600);
    await prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory, hostPaths);
    assert.equal((await lstat(privatePath)).ino, metadata.ino, "resume preserves exact credential file");
    if (appId === "renovate") {
      const environmentPath = join(projectDirectory, "secrets", "renovate.env");
      assert.equal((await lstat(environmentPath)).mode & 0o777, 0o600);
      assert.equal(await readFile(environmentPath, "utf8"), "RENOVATE_TOKEN=synthetic_fixture_token\n");
      await assert.rejects(prepareMultiServiceFiles(recipe, projectDirectory, dataDirectory,
        hostPaths, undefined, { "forge-token": Buffer.from("different_fixture_token") }), /differs from saved/);
      assert.equal(JSON.stringify(manifest).includes("synthetic_fixture_token"), false);
    }

    const withPort = structuredClone(recipe);
    withPort.services[0].publishTargetPort = 8080;
    withPort.defaults.publishedPort = 18080;
    assert.ok(validateAppRecipe(withPort, app).length > 0);
    assert.throws(() => checkedManualJobRecipe(withPort), /portless/);
    const automatic = structuredClone(recipe);
    automatic.services[0].restart = "unless-stopped";
    assert.ok(validateAppRecipe(automatic, app).length > 0);
    const administrator = structuredClone(recipe);
    administrator.onboarding = { kind: "no-account", officialUrl: recipe.source };
    assert.ok(validateAppRecipe(administrator, app).length > 0);
    const writeProbe = structuredClone(recipe);
    writeProbe.execution.probe.argv = ["restic", "backup"];
    assert.ok(validateAppRecipe(writeProbe, app).length > 0);
    assert.throws(() => checkedManualProbe(image, writeProbe.execution.probe), /version command/);
    assert.throws(() => multiServiceManifest({ recipe, images: { [appId]: image }, projectId,
      appsRoot: temporary, projectDirectory, dataDirectory, dockerContext: "default",
      port: 18080, hostPaths, uid: 1000, gid: 1000,
      observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } }), /port/);
  }
} finally {
  await rm(temporary, { recursive: true });
}
process.stdout.write("manual job recipe and private preparation checks passed (no Docker)\n");
