import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSharedAcceptanceOwner, inspectSharedAcceptanceRuntime } from "../src/lib/shared-acceptance-owner.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, saveSharedProjectState, type SharedProjectExpected } from "../src/lib/shared-project-state.ts";
import { sharedProjectCommand } from "../src/shared-project.ts";

const root = await mkdtemp(join(tmpdir(), "shared-acceptance-command-fixture-"));
const projectId = "acceptance-fixture";
const imageId = `sha256:${"b".repeat(64)}`;
const containerId = "c".repeat(64);
const oldPath = process.env.PATH;
try {
  const recipeBytes = await readFile(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ntfy/recipe.json", import.meta.url), "utf8");
  const recipe = JSON.parse(recipeBytes);
  const manifest = JSON.parse(await readFile(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ntfy/manifest.json", import.meta.url), "utf8"));
  const selection = { appId: "ntfy", recipe,
    images: Object.fromEntries(recipe.services.map((service: Record<string, any>) =>
      [service.id, `${service.imageTag}@sha256:${"a".repeat(64)}`])), port: 18981 };
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId, dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC", apps: [selection],
    observed: { checkedAt: "2026-10-03T00:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const inputPath = join(root, "manifest-fixture.json");
  async function composeCheck(value: Record<string, any>) {
    await writeFile(inputPath, JSON.stringify(value), { mode: 0o600 });
    return spawnSync(process.execPath, [new URL("../../../.agents/skills/self-host/workflows/selfhost-compose/scripts/compose-project.ts", import.meta.url).pathname,
      "plan", "--input", inputPath], { encoding: "utf8" });
  }
  const composed = await composeCheck(candidate.manifest);
  assert.equal(composed.status, 0, composed.stdout + composed.stderr);
  for (const changed of ["outside-mount", "auth-file-alias", "read-only-store", "other-prefix", "arbitrary-file"]) {
    const invalid = structuredClone(candidate.manifest);
    const service = invalid.services[0];
    const cache = service.environment.find((entry: Record<string, any>) => entry.name === "NTFY_CACHE_FILE");
    if (changed === "outside-mount") cache.value = "/outside/cache.db";
    if (changed === "auth-file-alias") cache.value = "/var/lib/ntfy/user.db";
    if (changed === "read-only-store") service.mounts[0].readOnly = true;
    if (changed === "other-prefix") cache.name = "OTHER_CACHE_FILE";
    if (changed === "arbitrary-file") service.environment.push({ name: "APP_PASSWORD_FILE", value: "/var/lib/ntfy/password" });
    assert.notEqual((await composeCheck(invalid)).status, 0, changed);
  }
  let previous: SharedProjectExpected = { revision: 0, manifestHash: null, checkpoint: null };
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    const next = await saveSharedProjectState(candidate, { operation: "create", phase, appIds: ["ntfy"] }, previous);
    previous = { revision: next.revision, manifestHash: next.manifestHash, checkpoint: next.checkpoint };
  }
  const current = (await loadSharedProjectState(candidate.projectDirectory, projectId))!;
  let recipeChanged = false;
  const dependencies = {
    recipeFor(appId: string) {
      assert.equal(appId, "ntfy");
      const selected = structuredClone(recipe);
      if (recipeChanged) selected.services[0].restart = "always";
      return { recipe: selected, defaults: recipe.defaults, storage: recipe.storage,
        boundedApply: true, recipeSha256: createHash("sha256").update(recipeBytes).digest("hex") };
    },
    appFor(appId: string) { assert.equal(appId, "ntfy"); return manifest; },
    async resolveImage(): Promise<never> { assert.fail("acceptance review must not resolve images"); },
    approvalFor() { return "FIXTURE-OWNER-APPROVAL"; },
  };
  const logs: string[] = [];
  const original = console.log;
  async function command(extra: string[], json = true) {
    logs.length = 0;
    console.log = (value: string) => { logs.push(value); };
    const args = ["acceptance-begin", "--project-root", root, "--project-id", projectId, "--app", "ntfy", ...extra];
    if (json) args.push("--json");
    try { await sharedProjectCommand(args, dependencies); } finally { console.log = original; }
  }
  await command([]);
  const review = JSON.parse(logs[0]!);
  assert.equal(review.status, "review"); assert.equal(review.mutation, false);
  assert.deepEqual(review.services, ["ntfy"]);
  assert.deepEqual(review.images, selection.images);
  assert.equal(review.owner.revision, current.revision);
  assert.equal(review.evidenceRoot, join(root, `selfhost-verification-${projectId}`));
  assert.equal(existsSync(review.evidenceRoot), false, "Review creates no evidence directory");
  assert.equal(existsSync(join(candidate.projectDirectory, "acceptance-run-ntfy.json")), false);
  assert.equal(existsSync(join(candidate.projectDirectory, "secrets")), false, "Review neither creates nor reads credentials");
  await command([], false);
  assert.ok(logs.some((line) => line.includes("Selected services: ntfy")));
  assert.ok(logs.some((line) => line.includes("retained-until-cache-expiry")));
  assert.ok(logs.some((line) => line.includes("--approve SHARED-ACCEPTANCE-BEGIN:")));
  await assert.rejects(command(["--port", "ntfy=18982"]), /no port/);
  await assert.rejects(command(["--evidence", root]), /unsupported option/);
  await assert.rejects(command(["--approve", "operator-asserted-pass"]), /changed/);
  assert.equal(existsSync(review.evidenceRoot), false);
  const owner = createSharedAcceptanceOwner(root, projectId, "ntfy", dependencies);
  const identity = await owner.identity();
  assert.deepEqual(identity.ownerAppIds, ["ntfy"]);
  assert.equal(identity.contract.homarrMode, "native");
  await assert.rejects(owner.lifecycle("stop"), /held project mutation lock/);
  recipeChanged = true;
  await assert.rejects(command([]), /review migration/);
  recipeChanged = false;

  // Unsupported acceptance is visible, not a fabricated fallback or an unexpected exception.
  logs.length = 0; console.log = (value: string) => { logs.push(value); };
  try {
    await sharedProjectCommand(["acceptance-begin", "--project-root", root, "--project-id", projectId,
      "--app", "filebrowser", "--json"], dependencies);
  } finally { console.log = original; }
  assert.equal(JSON.parse(logs[0]!).status, "blocked");

  // A fake executable exercises production inspection, never a real Docker daemon.
  const fixturePath = join(root, "runtime.json");
  const bin = join(root, "bin"); await mkdir(bin, { mode: 0o700 });
  const target = join(candidate.projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml");
  const origin = join(candidate.projectDirectory, "compose.bbbbbbbbbbbbbbbb.yaml");
  const fixture = { state: current, target, origin, imageId, actualImageId: imageId,
    containerId, runtime: "running", wrongOwner: false, ambiguous: false };
  await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  const script = `#!${process.execPath}
import { readFileSync } from 'node:fs';
const f=JSON.parse(readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));
let a=process.argv.slice(2);
const print=v=>console.log(JSON.stringify(v));
if(a[0]==='context'){ print('unix:///var/run/docker.sock'); process.exit(0); }
if(a[0]!=='--context'||a[1]!=='default') process.exit(2);
a=a.slice(2);
const s=f.state.manifest.services[0];
const labels={'com.docker.compose.project':f.state.project.id,'com.docker.compose.service':s.id,
'com.docker.compose.project.config_files':f.origin,'com.docker.compose.project.working_dir':f.state.project.directory};
if(f.wrongOwner) labels['com.docker.compose.project']='foreign';
if(a[0]==='compose'){
 if(a.includes('--quiet')){ console.log(f.ambiguous ? f.containerId+'\\n'+f.containerId : f.containerId); process.exit(0); }
 print([{Service:s.id,Project:f.state.project.id,Image:s.image,ID:f.containerId,State:f.runtime}]); process.exit(0);
}
if(a[0]==='network'){
 const n=f.state.manifest.networks.find(n=>n.name===a[2]);
 let members={}; if(f.runtime==='running') members={[f.containerId]:{}};
 print({Name:n.name,Id:n.id,Driver:'bridge',Internal:n.internal,
 Labels:{'com.docker.compose.project':f.state.project.id,'com.docker.compose.network':n.id},Containers:members}); process.exit(0);
}
const format=a.at(-1);
if(a[0]==='image'){ print({imageId:f.imageId}); process.exit(0); }
if(a[0]==='inspect'){
 if(format==='{{json .Config.Labels}}') print(labels);
 else if(format==='{{json .HostConfig.PortBindings}}') print(Object.fromEntries(s.ports.map(p=>[p.target+'/'+p.protocol,[{HostPort:String(p.published),HostIp:p.hostIp}]])));
 else if(format==='{{json .NetworkSettings.Networks}}') print(Object.fromEntries(s.networks.map(id=>{const n=f.state.manifest.networks.find(n=>n.id===id);return [n.name,{NetworkID:n.id,Aliases:[s.id]}];})));
 else if(format.startsWith('{"imageId"')) print({imageId:f.actualImageId,image:s.image,startedAt:'2026-10-03T01:00:00.000Z',state:f.runtime,labels});
 else process.exit(2);
 process.exit(0);
}
process.exit(2);
`;
  await writeFile(join(bin, "docker"), script, { mode: 0o700 });
  await chmod(join(bin, "docker"), 0o700);
  process.env.PATH = `${bin}:${oldPath ?? ""}`;
  const observed = inspectSharedAcceptanceRuntime(current, "ntfy", target, origin);
  assert.deepEqual(observed, [{ serviceId: "ntfy", imageId, immutableImage: selection.images.ntfy,
    startedAt: "2026-10-03T01:00:00.000Z", state: "running" }]);
  fixture.actualImageId = `sha256:${"d".repeat(64)}`;
  await writeFile(fixturePath, JSON.stringify(fixture));
  assert.throws(() => inspectSharedAcceptanceRuntime(current, "ntfy", target, origin), /actual container image/);
  fixture.actualImageId = imageId; fixture.ambiguous = true;
  await writeFile(fixturePath, JSON.stringify(fixture));
  assert.throws(() => inspectSharedAcceptanceRuntime(current, "ntfy", target, origin), /exactly one saved container/);
  fixture.ambiguous = false; fixture.wrongOwner = true;
  await writeFile(fixturePath, JSON.stringify(fixture));
  assert.throws(() => inspectSharedAcceptanceRuntime(current, "ntfy", target, origin), /ownership labels/);
  fixture.wrongOwner = false; fixture.runtime = "exited";
  await writeFile(fixturePath, JSON.stringify(fixture));
  assert.equal(inspectSharedAcceptanceRuntime(current, "ntfy", target, origin)[0]!.state, "stopped");
  console.log("shared acceptance command/production owner: review, drift, image identity and selected ownership fixtures pass; no live credit");
} finally {
  if (oldPath === undefined) delete process.env.PATH;
  else process.env.PATH = oldPath;
  await rm(root, { recursive: true, force: true });
}
