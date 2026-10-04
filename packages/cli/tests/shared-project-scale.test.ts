import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extendSharedProject, sharedProjectCandidate } from "../src/lib/shared-compose-project.ts";
import { MAX_SHARED_APPS, MAX_SHARED_SERVICES, MAX_SHARED_TCP_PORTS } from "../src/lib/shared-project-limits.ts";
import { loadSharedProjectState, saveSharedProjectState, type SharedProjectState } from "../src/lib/shared-project-state.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";
import { excludedAppIds, saveExcludedAppIds } from "../src/control-panel/project-selection.ts";
import { loadProjectSnapshot } from "../src/control-panel/project-snapshot.ts";
import { sharedHostFacts } from "../src/lib/shared-host-observation.ts";
import { sharedProjectCommand } from "../src/shared-project.ts";

const imageTag = "docker.io/library/busybox:1.37.0";
function selection(index: number, count = 2) {
  const appId = `app-${String(index).padStart(3, "0")}`;
  const services = Array.from({ length: count }, (_, service) => {
    let id = `worker-${service}`;
    if (service === 0) id = appId;
    return { id, imageTag, imageSource: "https://example.test/image",
      purpose: "Synthetic bounded service for shared owner regression",
      user: "image-default",
      imageUserEvidence: { officialUrl: "https://example.test/image", reason: "official-image-runtime-contract" },
      restart: "unless-stopped", readOnly: false, environment: [], hostEnvironment: [], fileEnvironment: [],
      mounts: [{ name: `state-${service}`, target: "/state" }],
      dependsOn: [] as string[], publishTargetPort: null as number | null };
  });
  services[0]!.publishTargetPort = 8080;
  if (count > 1) services[0]!.dependsOn = [services[1]!.id];
  return { appId, port: 18000 + index,
    images: Object.fromEntries(services.map(({ id }) => [id, `${imageTag}@sha256:${"a".repeat(64)}`])),
    recipe: { schemaVersion: 2, kind: "multi-service-compose", appId, services,
      privateFiles: [], defaults: { hostIp: "127.0.0.1" } } };
}

function expected(state: SharedProjectState) {
  return { revision: state.revision, manifestHash: state.manifestHash, checkpoint: state.checkpoint };
}

const temporary = await mkdtemp(join(tmpdir(), "selfhost-shared-scale-"));
try {
  const host = { projectRoot: temporary, projectId: "large-stack", dockerContext: "default",
    uid: 1000, gid: 1000, timezone: "Etc/UTC" };
  const observed = { checkedAt: "2026-10-03T12:00:00Z", ports: [], paths: [], networks: [] };
  const apps = Array.from({ length: 15 }, (_, index) => selection(index));
  const candidate = sharedProjectCandidate({ ...host, apps, observed });
  assert.equal(Object.keys(candidate.units).length, 15);
  assert.equal(candidate.manifest.services.length, 30);
  assert.equal(candidate.manifest.project.id, host.projectId);
  assert.equal(candidate.manifest.networks.filter((network: { id: string }) => network.id === "front").length, 1);
  assert.equal(candidate.manifest.networks.length, 16);
  for (const app of apps) {
    const frontend = candidate.manifest.services.find((service: { id: string }) => service.id === app.appId);
    const worker = candidate.manifest.services.find((service: { id: string }) => service.id === `${app.appId}-worker-1`);
    assert.deepEqual(candidate.units[app.appId], [app.appId, worker.id]);
    assert.deepEqual(frontend.networks, ["front", `${app.appId}-private`]);
    assert.deepEqual(worker.networks, [`${app.appId}-private`]);
    assert.deepEqual(frontend.dependsOn, [{ service: worker.id, condition: "service_started" }]);
    assert.deepEqual(worker.networkAliases, [{ network: `${app.appId}-private`, alias: "worker-1" }]);
  }
  const plan = await createSelfhostComposeOwner(candidate.manifest).plan();
  assert.equal(plan.status, "pass");
  await mkdir(candidate.projectDirectory, { recursive: true, mode: 0o700 });
  const reviewed = { operation: "create" as const, phase: "reviewed" as const, appIds: apps.map((app) => app.appId) };
  const first = await saveSharedProjectState(candidate, reviewed, { revision: 0, manifestHash: null, checkpoint: null });
  const second = await saveSharedProjectState(candidate, { ...reviewed, phase: "attempted" }, expected(first));
  const completed = await saveSharedProjectState(candidate, { ...reviewed, phase: "completed" }, expected(second));

  const observation = { checkedAt: "2026-10-03T12:01:00Z",
    project: { id: host.projectId, owner: host.projectId, directory: candidate.projectDirectory },
    ports: candidate.manifest.services.flatMap((service: { ports: object[] }) =>
      service.ports.map((port) => ({ ...port, owner: host.projectId })))
      .map(({ target, purpose, publicApproved, ...port }: Record<string, any>) => port),
    paths: candidate.manifest.services.flatMap((service: { mounts: Array<{ source: string }> }) =>
      service.mounts.map((mount) => ({ path: mount.source, owner: host.projectId }))),
    networks: candidate.manifest.networks.map((network: { name: string }) =>
      ({ name: network.name, owner: host.projectId })) };
  const added = selection(15);
  const extended = extendSharedProject(candidate, [added], host, observation);
  assert.equal(extended.manifest.services.length, 32);
  assert.equal(extended.manifest.networks.filter((network: { id: string }) => network.id === "front").length, 1);
  for (const app of apps) {
    assert.deepEqual(extended.units[app.appId], candidate.units[app.appId]);
    assert.equal(extended.selectionFingerprints[app.appId], candidate.selectionFingerprints[app.appId]);
  }
  assert.equal((await createSelfhostComposeOwner(extended.manifest).plan()).status, "pass");
  const addReview = { operation: "add" as const, phase: "reviewed" as const, appIds: [added.appId] };
  const addFirst = await saveSharedProjectState(extended, addReview, expected(completed));
  const addAttempt = await saveSharedProjectState(extended, { ...addReview, phase: "attempted" }, expected(addFirst));
  const addComplete = await saveSharedProjectState(extended, { ...addReview, phase: "completed" }, expected(addAttempt));

  const removed = structuredClone(extended);
  const removedServices = new Set(removed.units[added.appId]);
  removed.manifest.services = removed.manifest.services.filter((service: { id: string }) => !removedServices.has(service.id));
  removed.manifest.networks = removed.manifest.networks.filter((network: { id: string }) => network.id !== `${added.appId}-private`);
  delete removed.units[added.appId];
  delete removed.selectionFingerprints[added.appId];
  assert.deepEqual(removed.units, candidate.units);
  assert.deepEqual(removed.manifest.services, extended.manifest.services.slice(0, 30));
  assert.equal((await createSelfhostComposeOwner(removed.manifest).plan()).status, "pass");
  const removal = await saveSharedProjectState(removed,
    { operation: "remove", phase: "reviewed", appIds: [added.appId] }, expected(addComplete));
  assert.deepEqual((await loadSharedProjectState(candidate.projectDirectory, host.projectId))?.units, removal.units);

  const maximum = sharedProjectCandidate({ ...host, projectId: "maximum-stack",
    apps: Array.from({ length: MAX_SHARED_APPS }, (_, index) => selection(index, 4)), observed });
  assert.equal(maximum.manifest.services.length, MAX_SHARED_SERVICES);
  assert.equal((await createSelfhostComposeOwner(maximum.manifest).plan()).status, "pass");
  await mkdir(maximum.projectDirectory, { mode: 0o700 });
  const maximumState = await saveSharedProjectState(maximum,
    { operation: "create", phase: "reviewed", appIds: Object.keys(maximum.units) },
    { revision: 0, manifestHash: null, checkpoint: null });
  assert.equal(Object.keys((await loadSharedProjectState(maximum.projectDirectory, "maximum-stack"))!.units).length, MAX_SHARED_APPS);
  assert.equal(maximumState.manifest.services.length, MAX_SHARED_SERVICES);
  assert.throws(() => sharedProjectCandidate({ ...host,
    apps: Array.from({ length: MAX_SHARED_APPS + 1 }, (_, index) => selection(index, 1)), observed }), /selection is invalid/);
  assert.throws(() => sharedProjectCandidate({ ...host,
    apps: Array.from({ length: 65 }, (_, index) => selection(index, 8)), observed }), /service count exceeds/);
  const ids = Object.keys(maximum.units);
  await saveExcludedAppIds(temporary, ids);
  assert.deepEqual(await excludedAppIds(temporary), ids);
  const snapshot = await loadProjectSnapshot(temporary, async (args) => {
    const projectId = args[args.indexOf("--project-id") + 1];
    return { command: "app shared status", mutation: false, projectRoot: temporary,
      projectId, status: "reviewed", apps: ids, urls: {} };
  });
  assert.equal(snapshot.shared.find((owner) => owner.id === "maximum-stack")?.apps.length, MAX_SHARED_APPS);
  await assert.rejects(saveExcludedAppIds(temporary, [...ids, "extra-app"]), /Invalid app selection/);
  await assert.rejects(sharedProjectCommand(["plan", "--project-root", temporary, "--project-id", "too-large",
    ...Array.from({ length: MAX_SHARED_APPS + 1 }, (_, index) => ["--app", `app-${index}`]).flat()], {
    recipeFor() { throw new Error("invalid count must fail before reading recipes"); },
    async resolveImage() { throw new Error("invalid count must fail before registry access"); },
  }), /select 1–128 distinct/);

  // --help exits during argument parsing: this checks bounds without running host or Docker probes.
  const probe = resolve(".agents/skills/self-host/workflows/selfhost-host/scripts/inspect-host.sh");
  const portArgs = Array.from({ length: MAX_SHARED_TCP_PORTS }, (_, index) => ["--check-tcp-port", String(18000 + index)]).flat();
  assert.equal(spawnSync("bash", [probe, "--limit", "512", ...portArgs, "--help"]).status, 0);
  assert.equal(spawnSync("bash", [probe, ...portArgs, "--check-tcp-port", "19000", "--help"]).status, 2);

  const tcpPorts = Array.from({ length: MAX_SHARED_TCP_PORTS }, (_, index) => 18000 + index);
  const request = { projectRoot: temporary, projectId: "host-scale", tcpPorts,
    volumeNames: [], minimumFreeBytes: 1048576, mediaPath: null, preparedMediaPath: false };
  const report = { schemaVersion: 1, mode: "read-only",
    identity: { state: "observed", uid: process.getuid?.(), gid: process.getgid?.(),
      timezone: { state: "observed", value: "Etc/UTC" } },
    runtime: { docker: { state: "running", rootless: { state: "observed", value: false } }, dockerContext: { state: "observed", current: "default" } },
    workloads: { containers: { state: "observed", truncated: false, items: [] },
      dockerNetworks: { state: "observed", truncated: false, items: [] } },
    network: { listeningPorts: { state: "observed", items: [] },
      selectedTcpPorts: { state: "observed", complete: true, items: tcpPorts.map((port) => ({ port, inUse: false })) } },
    storage: { paths: [{ path: temporary, exists: true, directory: true, symlink: false,
      writableByInspector: true, networkFilesystem: false, readOnlyMount: false,
      availableBytes: 10000000, availableInodes: 10000 }] } };
  assert.equal(sharedHostFacts(report, request, []).dockerContext, "default");
  assert.throws(() => sharedHostFacts(report, { ...request, tcpPorts: [...tcpPorts, 19000] }, []), /distinct selected TCP ports/);
} finally {
  await rm(temporary, { recursive: true });
}

console.log("shared project scale: 15-app add/remove and 128-app/512-service bounds passed");
