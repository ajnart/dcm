import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dir, "../../..");
const temporary = await mkdtemp(join(tmpdir(), "shared-prestart-guard-"));
const sandbox = join(temporary, "source");
const workflow = ".agents/skills/self-host/workflows";
const catalog = join(sandbox, workflow, "selfhost/references/catalog");
const lib = join(sandbox, "packages/cli/src/lib");
const witness = Symbol.for("selfhost.fixture.prestart.calls");
try {
  await mkdir(join(sandbox, "packages/cli/src"), { recursive: true });
  await symlink(join(repository, "packages/cli/node_modules"), join(sandbox, "packages/cli/node_modules"));
  await cp(join(repository, "packages/cli/src/lib"), lib, { recursive: true });
  await cp(join(repository, "packages/cli/src/shared-project.ts"), join(sandbox, "packages/cli/src/shared-project.ts"));
  await mkdir(join(sandbox, "packages/cli/src/control-panel"), { recursive: true });
  await cp(join(repository, "packages/cli/src/control-panel/setup-cloudflare-provider.ts"),
    join(sandbox, "packages/cli/src/control-panel/setup-cloudflare-provider.ts"));
  await cp(join(repository, workflow, "selfhost/references/catalog"), catalog, { recursive: true });
  await cp(join(repository, workflow, "selfhost-compose"), join(sandbox, workflow, "selfhost-compose"), { recursive: true });
  await cp(join(repository, workflow, "selfhost-ingress"), join(sandbox, workflow, "selfhost-ingress"), { recursive: true });
  const app = join(catalog, "apps/alpha");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "manifest.json"), JSON.stringify({ id: "alpha" }));
  await writeFile(join(app, "pre-start-adapter.json"), JSON.stringify({ schemaVersion: 1,
    kind: "shared-pre-start-adapter", appId: "alpha", sourceFiles: ["manifest.json", "pre-start.ts"],
    effects: ["Synthetic startup disclosure"] }));
  await writeFile(join(app, "pre-start.ts"), `export default { appId: "alpha", async verify(context) {
    await context.revalidate();
    if (context.state.checkpoint.phase !== "prepared") throw new Error("wrong owner source");
    globalThis[Symbol.for("selfhost.fixture.prestart.calls")].push(context.operation);
  }};\n`);
  (globalThis as any)[witness] = [];
  const engine = await import(pathToFileURL(join(lib, "shared-prestart.ts")).href);
  const { sharedProjectCandidate } = await import(pathToFileURL(join(lib, "shared-compose-project.ts")).href);
  const { saveSharedProjectState } = await import(pathToFileURL(join(lib, "shared-project-state.ts")).href);
  const imageTag = "docker.io/library/busybox:1.37.0";
  const candidate = sharedProjectCandidate({ projectRoot: join(temporary, "owner"), projectId: "fixture",
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: [{ appId: "alpha", port: 18080, images: { alpha: `${imageTag}@sha256:${"a".repeat(64)}` },
      recipe: { schemaVersion: 2, kind: "multi-service-compose", appId: "alpha",
        services: [{ id: "alpha", imageTag, user: "image-default",
          imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
          restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [], fileEnvironment: [],
          mounts: [{ name: "state", target: "/state" }], dependsOn: [], publishTargetPort: 8080 }],
        privateFiles: [], defaults: { hostIp: "127.0.0.1" } } }],
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const reviewed = { operation: "create", phase: "reviewed", appIds: ["alpha"] };
  const state = await saveSharedProjectState(candidate, reviewed, { revision: 0, manifestHash: null, checkpoint: null });
  await saveSharedProjectState(candidate, { ...reviewed, phase: "prepared" },
    { revision: state.revision, manifestHash: state.manifestHash, checkpoint: reviewed });
  const operations = ["apply", "add", "start", "recreate", "probe"];
  assert.equal(engine.sharedPrestartContracts(candidate.manifest)[0].effects[0], "Synthetic startup disclosure");
  for (const operation of operations) await engine.requireSharedPrestart(candidate.manifest, operation, ["alpha"]);
  assert.deepEqual((globalThis as any)[witness], operations);
  await engine.requireSharedPrestart(candidate.manifest, "stop", ["alpha"]);
  await engine.requireSharedPrestart(candidate.manifest, "remove", ["alpha"]);
  await engine.requireSharedPrestart({ services: [{ id: "ordinary" }] }, "apply");
  assert.deepEqual((globalThis as any)[witness], operations);
  const forged = structuredClone(candidate.manifest);
  forged.services[0].image = `docker.io/library/busybox:1.37.0@sha256:${"b".repeat(64)}`;
  forged.approved = true;
  await assert.rejects(engine.requireSharedPrestart(forged, "start"), /pre-start/);
  const manifestPath = join(temporary, "ordinary.json");
  await writeFile(manifestPath, JSON.stringify({ services: [{ id: "ordinary" }] }), { mode: 0o644 });
  const check = spawnSync("bun", [join(sandbox, workflow, "selfhost-compose/scripts/pre-start-check.ts"),
    "--manifest", manifestPath, "--operation", "apply"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
  const lifecycle = await readFile(join(sandbox, workflow, "selfhost-compose/scripts/compose-lifecycle.sh"), "utf8");
  for (const operation of ["apply", "add", "start", "recreate", "probe"]) {
    assert(lifecycle.includes(`check_app_prestart ${operation}`), `canonical raw ${operation} lacks mandatory guard`);
  }
  await writeFile(join(app, "pre-start.ts"), "export default {appId:'alpha',async verify(){}};\n");
  await assert.rejects(engine.requireSharedPrestart(candidate.manifest, "start"), /pre-start/);
  assert.deepEqual((globalThis as any)[witness], operations, "source drift and caller approval never run a verifier");
} finally {
  delete (globalThis as any)[witness];
  await rm(temporary, { recursive: true });
}
console.log("Shared pre-start exact-owner/startup/source guards: pass (synthetic; no Docker or provider calls)");
