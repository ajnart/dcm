import assert from "node:assert/strict";
import { inspectNewSharedHost, requireLocalSharedDockerContext,
  sharedHostFacts } from "../src/lib/shared-host-observation.ts";

const request = {
  projectRoot: "/tmp/selfhost-shared-fixture",
  projectId: "fixture-stack",
  tcpPorts: [7575, 2283],
  volumeNames: ["fixture-stack-homarr-config", "fixture-stack-immich-upload"],
  minimumFreeBytes: 8_000_000,
  mediaPath: null,
  preparedMediaPath: false,
};
const report = {
  schemaVersion: 1, mode: "read-only",
  identity: { state: "observed", uid: process.getuid?.(), gid: process.getgid?.(),
    timezone: { state: "observed", value: "Etc/UTC" } },
  runtime: { docker: { state: "running", rootless: { state: "observed", value: false } },
    dockerContext: { state: "observed", current: "default" } },
  workloads: {
    containers: { state: "observed", truncated: false, items: [] },
    dockerNetworks: { state: "observed", truncated: false, items: [] },
  },
  network: {
    listeningPorts: { state: "observed", truncated: true, items: [] },
    selectedTcpPorts: { state: "observed", complete: true,
      items: [{ port: 7575, inUse: false }, { port: 2283, inUse: false }] },
  },
  storage: { paths: [{ path: request.projectRoot, exists: true, directory: true,
    symlink: false, writableByInspector: true, networkFilesystem: false,
    readOnlyMount: false, availableBytes: 10_000_000, availableInodes: 10_000 }] },
};

const observed = sharedHostFacts(report, request, [], "2026-09-29T12:00:00.000Z");
assert.equal(observed.dockerContext, "default");
assert.equal(observed.timezone, "Etc/UTC");
assert.equal(observed.observed.ports.length, 0);
assert.deepEqual(observed.observed.volumes, []);

const unknownRootless = structuredClone(report);
unknownRootless.runtime.docker.rootless.state = "unknown";
assert.throws(() => sharedHostFacts(unknownRootless, request, []), /rootless mode was not fully observed/);
const invalidRootless = structuredClone(report);
Object.assign(invalidRootless.runtime.docker.rootless, { value: null });
assert.throws(() => sharedHostFacts(invalidRootless, request, []), /rootless mode was not fully observed/);
const missingRootless = structuredClone(report);
Reflect.deleteProperty(missingRootless.runtime.docker, "rootless");
assert.throws(() => sharedHostFacts(missingRootless, request, []), /Docker rootless mode is invalid/);
const wrongRootlessContext = structuredClone(report);
wrongRootlessContext.runtime.dockerContext.current = "rootless";
assert.throws(() => sharedHostFacts(wrongRootlessContext, request, []), /does not report rootless security mode/);
const nonMediaRootless = structuredClone(report);
nonMediaRootless.runtime.docker.rootless.value = true;
assert.equal(sharedHostFacts(nonMediaRootless, request, []).dockerContext, "default");

const occupied = structuredClone(report);
occupied.network.selectedTcpPorts.items[1].inUse = true;
assert.throws(() => sharedHostFacts(occupied, request, []), /already in use/);

const missing = structuredClone(report);
missing.network.selectedTcpPorts.items.pop();
assert.throws(() => sharedHostFacts(missing, request, []), /differ from the exact probe/);

const existingNetwork = structuredClone(report);
existingNetwork.workloads.dockerNetworks.items.push({ name: "fixture-stack-front" });
assert.throws(() => sharedHostFacts(existingNetwork, request, []), /front network already exists/);

const existingContainer = structuredClone(report);
existingContainer.workloads.containers.items.push({ name: "fixture-stack-homarr", publishedPorts: null });
assert.throws(() => sharedHostFacts(existingContainer, request, []), /already has a container/);

const occupiedByDocker = structuredClone(report);
occupiedByDocker.workloads.containers.items.push({ name: "another-service",
  publishedPorts: "127.0.0.1:7575->7575/tcp" });
assert.throws(() => sharedHostFacts(occupiedByDocker, request, []), /already publishes/);

assert.throws(() => sharedHostFacts(report, request, ["fixture-stack-homarr-config"]),
  /volume name already exists/);

const mediaPath = `${request.projectRoot}/.selfhost/shared/${request.projectId}/data/shared`;
const mediaReport = structuredClone(report);
mediaReport.storage.paths.push({ path: mediaPath, exists: false, directory: false,
  symlink: false, writableByInspector: null, networkFilesystem: null,
  readOnlyMount: null, availableBytes: null, availableInodes: null });
assert.equal(sharedHostFacts(mediaReport, { ...request, mediaPath }, []).observed.paths.length, 0);
const rootlessMedia = structuredClone(mediaReport);
rootlessMedia.runtime.dockerContext.current = "rootless";
rootlessMedia.runtime.docker.rootless.value = true;
assert.throws(() => sharedHostFacts(rootlessMedia, { ...request, mediaPath }, []),
  /rootless Docker media bind ownership/);
rootlessMedia.runtime.dockerContext.current = "default";
assert.throws(() => sharedHostFacts(rootlessMedia, { ...request, mediaPath }, []),
  /rootless Docker media bind ownership/);
assert.throws(() => sharedHostFacts(rootlessMedia,
  { ...request, mediaPath, preparedMediaPath: true }, []), /rootless Docker media bind ownership/);
mediaReport.storage.paths[1].exists = true;
assert.throws(() => sharedHostFacts(mediaReport, { ...request, mediaPath }, []),
  /media path must be absent/);
mediaReport.storage.paths[1] = { ...mediaReport.storage.paths[1], directory: true,
  writableByInspector: true, networkFilesystem: false, readOnlyMount: false };
assert.equal(sharedHostFacts(mediaReport,
  { ...request, mediaPath, preparedMediaPath: true }, []).observed.paths.length, 0);
mediaReport.storage.paths[1].symlink = true;
assert.throws(() => sharedHostFacts(mediaReport,
  { ...request, mediaPath, preparedMediaPath: true }, []), /safe observation/);

const originalDockerHost = process.env.DOCKER_HOST;
process.env.DOCKER_HOST = "tcp://127.0.0.1:2375";
try {
  assert.throws(() => inspectNewSharedHost(request), /environment overrides/);
  assert.throws(() => requireLocalSharedDockerContext("default"), /environment overrides/);
} finally {
  if (originalDockerHost === undefined) delete process.env.DOCKER_HOST;
  else process.env.DOCKER_HOST = originalDockerHost;
}

console.log("shared host observation: pass");
