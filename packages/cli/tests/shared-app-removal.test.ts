import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SharedProjectCommandError, sharedProjectCommand, sharedRemovalCandidate } from "../src/shared-project.ts";
import { sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { loadSharedProjectState, loadSharedUnitComposeOrigins, saveSharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import type { SharedProjectState } from "../src/lib/shared-project-state.ts";

const oldPath = process.env.PATH;
const root = await mkdtemp(join(tmpdir(), "shared-removal-fixture-"));
const imageTag = "docker.io/library/busybox:1.37.0";
function selection(appId: string, port: number) {
  return { appId, port, images: { [appId]: `${imageTag}@sha256:${"a".repeat(64)}` },
    recipe: { schemaVersion: 2, kind: "multi-service-compose", appId,
      services: [{ id: appId, imageTag, user: "image-default",
        imageUserEvidence: { officialUrl: "https://example.test", reason: "official-image-runtime-contract" },
        restart: "unless-stopped", readOnly: false, environment: [{ name: "FLAG", value: "false" }],
        hostEnvironment: [], fileEnvironment: [], mounts: [{ kind: "volume", name: "state", target: "/state" }], dependsOn: [], publishTargetPort: 8080 }],
      privateFiles: [], defaults: { hostIp: "127.0.0.1", publishedPort: port },
      storage: { minimumFreeBytes: 1048576 } } };
}

async function setup(projectId: string, appIds = ["alpha", "beta", "gamma"]) {
  const candidate = sharedProjectCandidate({ projectRoot: root, projectId,
    dockerContext: "default", uid: 1000, gid: 1000, timezone: "Etc/UTC",
    apps: appIds.map((appId, index) => selection(appId, 18080 + index)),
    observed: { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [], volumes: [] } });
  candidate.manifest.project.ownership = "verified-existing";
  candidate.manifest.observed.project = { id: projectId, directory: candidate.projectDirectory, owner: projectId };
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const owner = createSelfhostComposeOwner(candidate.manifest);
  const originalPlan = await owner.plan();
  await owner.render(originalPlan);
  let state = await saveSharedProjectState(candidate,
    { operation: "create", phase: "reviewed", appIds: [...appIds].sort() }, { revision: 0, manifestHash: null, checkpoint: null });
  for (const phase of ["attempted", "completed"] as const) {
    state = await saveSharedProjectState(candidate, { operation: "create", phase, appIds: [...appIds].sort() },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  }
  const revised = structuredClone(candidate);
  revised.manifest.services.find((service) => service.id === appIds[0])!.environment[0]!.value = "true";
  const revisedOwner = createSelfhostComposeOwner(revised.manifest);
  const revisedPlan = await revisedOwner.plan();
  await revisedOwner.render(revisedPlan);
  for (const phase of ["reviewed", "attempted", "completed"] as const) {
    state = await saveSharedProjectState(revised, { operation: "transition", phase, appIds: [appIds[0]!] },
      { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint });
  }
  const data = join(candidate.projectDirectory, "data", "beta", "marker");
  const credential = join(candidate.projectDirectory, "secrets", "beta", "fixture-credential");
  for (const path of [data, credential]) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, "synthetic retained fixture\n", { mode: 0o600 });
  }
  const runtimeFile = join(candidate.projectDirectory, "synthetic-runtime.json");
  await writeFile(runtimeFile, JSON.stringify({ directory: candidate.projectDirectory, projectId,
    log: [], fault: null, volumes: Object.fromEntries(["alpha", "beta", "gamma"].map((appId) => [`${projectId}-${appId}-state`, "synthetic existing volume data"])), containers: {
      alpha: { id: "1".repeat(64), file: revisedPlan.render.target },
      beta: { id: "2".repeat(64), file: originalPlan.render.target },
      gamma: { id: "3".repeat(64), file: originalPlan.render.target },
    } }), { mode: 0o600 });
  return { state, data, credential, runtimeFile, originalPlan, revisedPlan };
}

const binaryDirectory = join(root, "bin");
await mkdir(binaryDirectory, { mode: 0o700 });
await writeFile(join(binaryDirectory, "docker"), `#!${process.execPath}
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const args = process.argv.slice(2);
const path = process.env.REMOVAL_FIXTURE_RUNTIME;
const runtime = JSON.parse(readFileSync(path,"utf8"));
assert.deepEqual(args.slice(0,2),["--context","default"]);
const command = args[2];
let output="";
if(command==="info") output="28.0.0";
else if(command==="volume") {
  if(args[3]==="ls") {
    const name=args[args.indexOf("--filter")+1].slice(5);
    output=Object.hasOwn(runtime.volumes,name)?name:"";
  } else if(args[3]==="inspect") {
    const name=args[4]; assert.ok(Object.hasOwn(runtime.volumes,name));
    output=[name,"local",runtime.projectId,name,runtime.projectId,name.slice(runtime.projectId.length+1)].join("\\t");
  } else throw new Error("Synthetic volume mutation is forbidden");
}
else if(command==="ps") {
  const selected=args.find(value=>value.startsWith("label=com.docker.compose.service="))?.split("=").at(-1);
  assert.ok(selected);
  output=runtime.containers[selected]?.id??"";
} else if(command==="container") {
  const match=Object.entries(runtime.containers).find(([,value])=>value.id===args.at(-1));
  assert.ok(match);
  const [service,value]=match;
  let file=value.file;
  if(runtime.fault==="labels") file="/tmp/unowned-compose.yaml";
  output=[runtime.projectId,service,file,runtime.directory,"False"].join("|");
} else if(command==="compose") {
  const index=args.findIndex(value=>["config","stop","rm"].includes(value));
  const operation=args[index];
  assert.ok(operation);
  assert.equal(args[args.indexOf("--project-name")+1],runtime.projectId);
  if(operation!=="config") {
    const revisions=readdirSync(runtime.directory+"/state").filter(value=>/^revision-[0-9]+.json$/.test(value)).sort();
    const state=JSON.parse(readFileSync(runtime.directory+"/state/"+revisions.at(-1),"utf8"));
    assert.equal(state.checkpoint.operation,"remove");
    assert.equal(state.checkpoint.phase,"attempted");
    assert.ok(!args.includes("--volumes")&&!args.includes("-v")&&!args.includes("down"));
    const services=args.slice(index+1).filter(value=>value!=="--force");
    assert.ok(services.length>0&&!services.includes("gamma"));
    const file=args[args.indexOf("--file")+1];
    for(const service of services) assert.equal(runtime.containers[service]?.file,file);
    runtime.log.push({operation,services,file});
    writeFileSync(path,JSON.stringify(runtime));
    if(operation==="rm"&&runtime.fault==="rm") process.exit(4);
    if(operation==="rm") for(const service of services) delete runtime.containers[service];
    writeFileSync(path,JSON.stringify(runtime));
  }
} else throw new Error("Unexpected synthetic Docker command");
if(output) process.stdout.write(output+"\\n");
`, { mode: 0o700 });
process.env.PATH = `${binaryDirectory}:${dirname(process.execPath)}:${oldPath}`;
const dependencyMetadata: Record<string, string[]> = {};
const dependencies = {
  recipeFor() { throw new Error("Ordinary removal must not inspect recipes or credentials"); },
  async resolveImage() { throw new Error("Removal must not contact registries"); },
  appFor(appId: string) { return { dependencies: dependencyMetadata[appId] ?? [] }; },
};
async function command(projectId: string, extra: string[] = [], appIds = ["beta", "alpha"]) {
  const logs: string[] = [];
  const original = console.log;
  console.log = (line: string) => { logs.push(line); };
  try {
    await sharedProjectCommand(["remove", ...appIds.flatMap((appId) => ["--app", appId]), "--project-root", root,
      "--project-id", projectId, "--json", ...extra], dependencies);
  } finally { console.log = original; }
  assert.equal(logs.length, 1);
  return JSON.parse(logs[0]!);
}

try {
  const success = await setup("removal-success");
  process.env.REMOVAL_FIXTURE_RUNTIME = success.runtimeFile;
  const review = await command(success.state.project.id);
  assert.equal(review.command, "app shared remove"); assert.equal(review.status, "review");
  assert.deepEqual(review.apps, ["alpha", "beta"]); assert.deepEqual(review.retained, ["gamma"]);
  assert.deepEqual(review.services, ["alpha", "beta"]);
  assert.equal(review.dataPreserved, true); assert.equal(review.credentialsPreserved, true);
  assert.match(review.approval, /^SHARED-REMOVE:removal-success:[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(await readFile(success.runtimeFile, "utf8")).log, []);
  assert.equal((await command(success.state.project.id)).approval, review.approval);
  await assert.rejects(command(success.state.project.id, ["--apply", "--approval", `SHARED-REMOVE:${success.state.project.id}:${"0".repeat(64)}`]), /exact saved-revision approval/);
  dependencyMetadata.gamma = ["beta"];
  await assert.rejects(command(success.state.project.id), (error) => error instanceof SharedProjectCommandError
    && error.code === "shared-remove-dependency" && error.partialWritePossible === false);
  dependencyMetadata.gamma = [];
  const malformed = sharedRemovalCandidate(success.state, ["alpha", "beta"]);
  malformed.manifest.services[0]!.environment[0]!.value = "changed";
  await assert.rejects(saveSharedProjectState(malformed,
    { operation: "remove", phase: "reviewed", appIds: ["alpha", "beta"] },
    { revision: success.state.revision, manifestHash: success.state.manifestHash, checkpoint: success.state.checkpoint }), /retained manifest bytes/);
  assert.throws(() => sharedRemovalCandidate(success.state, ["alpha", "beta", "gamma"]), (error) => error instanceof SharedProjectCommandError
    && error.code === "shared-remove-last-app" && error.partialWritePossible === false);
  const withDependency = structuredClone(success.state);
  withDependency.manifest.services.find((service) => service.id === "gamma")!.dependsOn = [{ service: "beta", condition: "service_started" }];
  assert.throws(() => sharedRemovalCandidate(withDependency, ["beta"]), /retained service gamma depends/);
  const removed = await command(success.state.project.id, ["--apply", "--approval", review.approval]);
  assert.equal(removed.status, "removed-unverified"); assert.equal(removed.mutation, true);
  const final = await loadSharedProjectState(success.state.project.directory, success.state.project.id);
  assert.deepEqual(Object.keys(final!.units), ["gamma"]);
  assert.equal(final!.checkpoint.phase, "completed");
  const origins = await loadSharedUnitComposeOrigins(final!.project.directory, final!.project.id, final!.recordHash);
  assert.equal(origins.gamma, success.originalPlan.render.target);
  const runtime = JSON.parse(await readFile(success.runtimeFile, "utf8"));
  assert.deepEqual(Object.keys(runtime.containers), ["gamma"]);
  assert.deepEqual(runtime.volumes, Object.fromEntries(["alpha", "beta", "gamma"].map((appId) => [`${success.state.project.id}-${appId}-state`, "synthetic existing volume data"])));
  assert.equal(runtime.log.filter((entry: any) => entry.operation === "rm").length, 2);
  for (const path of [success.data, success.credential]) assert.equal(await readFile(path, "utf8"), "synthetic retained fixture\n");
  const beforeReinstall = JSON.stringify(runtime);
  await assert.rejects(sharedProjectCommand(["add", "--app", "beta", "--project-root", root,
    "--project-id", success.state.project.id, "--secret-file", "beta:owner-token=/tmp/never-read-removal-fixture", "--approve", "SYNTHETIC", "--json"], dependencies),
  (error) => error instanceof SharedProjectCommandError && error.code === "shared-reinstall-required"
    && error.partialWritePossible === false);
  assert.equal(JSON.stringify(JSON.parse(await readFile(success.runtimeFile, "utf8"))), beforeReinstall,
    "Re-add refusal must happen before recipe/image/host/secret preparation or Docker");
  for (const phase of ["attempted", "verified"]) {
    const linked = await setup(`removal-link-${phase}`, ["alpha", "qbittorrent", "sonarr"]);
    process.env.REMOVAL_FIXTURE_RUNTIME = linked.runtimeFile;
    assert.equal((await command(linked.state.project.id, [], ["qbittorrent"])).status, "review",
      "An eligible but unconfigured link must not prohibit removal");
    const linkDirectory = join(linked.state.project.directory, "service-links");
    await mkdir(linkDirectory, { mode: 0o700 });
    await writeFile(join(linkDirectory, "sonarr-to-qbittorrent.1.json"), JSON.stringify({ schemaVersion: 1,
      revision: 1, previousHash: "synthetic", checkpoint: { phase, linkId: "sonarr-to-qbittorrent" } }), { mode: 0o600 });
    await assert.rejects(command(linked.state.project.id, [], ["qbittorrent"]),
      (error) => error instanceof SharedProjectCommandError && error.code === "shared-remove-dependency"
        && error.partialWritePossible === false && error.message.includes("saved-link-history present"));
    await chmod(join(linkDirectory, "sonarr-to-qbittorrent.1.json"), 0o644);
    await assert.rejects(command(linked.state.project.id, [], ["qbittorrent"]),
      (error) => error instanceof SharedProjectCommandError && error.code === "shared-remove-dependency"
        && error.partialWritePossible === false && error.message.includes("file is unsafe"));
    assert.deepEqual(JSON.parse(await readFile(linked.runtimeFile, "utf8")).log, [], "Saved link history must block before stop/rm");
    assert.equal((await loadSharedProjectState(linked.state.project.directory, linked.state.project.id))!.recordHash,
      linked.state.recordHash, "Dependency block must not write a removal checkpoint");
  }
  for (const fault of ["labels", "rm"]) {
    const scenario = await setup(`removal-${fault}`);
    process.env.REMOVAL_FIXTURE_RUNTIME = scenario.runtimeFile;
    const approval = (await command(scenario.state.project.id)).approval;
    const state = JSON.parse(await readFile(scenario.runtimeFile, "utf8")); state.fault = fault;
    await writeFile(scenario.runtimeFile, JSON.stringify(state), { mode: 0o600 });
    await assert.rejects(command(scenario.state.project.id, ["--apply", "--approve", approval]),
      (error) => error instanceof SharedProjectCommandError && error.code === "shared-remove-inspect-required"
        && error.partialWritePossible === true);
    const uncertain = await loadSharedProjectState(scenario.state.project.directory, scenario.state.project.id);
    assert.equal(uncertain!.checkpoint.phase, "inspect-required");
    await assert.rejects(command(scenario.state.project.id), /completed owner/);
    const runtime = JSON.parse(await readFile(scenario.runtimeFile, "utf8"));
    if (fault === "labels") assert.deepEqual(runtime.log, []);
    assert.ok(runtime.containers.gamma);
    for (const path of [scenario.data, scenario.credential]) assert.equal(await readFile(path, "utf8"), "synthetic retained fixture\n");
  }
  process.stdout.write("Shared removal original-owner grouping, approval, journal, retained resources and failure reconciliation: pass\n");
} finally {
  process.env.PATH = oldPath;
  delete process.env.REMOVAL_FIXTURE_RUNTIME;
  await rm(root, { recursive: true, force: true });
}
