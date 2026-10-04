import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SharedProjectCandidate, SharedProjectInput,
  SharedProjectObservation } from "./shared-compose-project.ts";
import { MAX_SHARED_SERVICES, MAX_SHARED_TCP_PORTS } from "./shared-project-limits.ts";
import { isManualJobService } from "./manual-job.ts";

type Entry = Record<string, unknown>;

export type SharedHostRequest = {
  projectRoot: string;
  projectId: string;
  tcpPorts: number[];
  volumeNames: string[];
  minimumFreeBytes: number;
  mediaPath: string | null;
  preparedMediaPath: boolean;
};

export type SharedHostFacts = Pick<SharedProjectInput, "dockerContext" | "uid" | "gid" | "observed"> & {
  timezone: string;
};

const projectIdPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const volumeNamePattern = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const observedVolumeNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;

function fail(message: string): never {
  throw new Error(`Shared-project host inspection: ${message}`);
}

function object(value: unknown, label: string): Entry {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid`);
  return value as Entry;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} is invalid`);
  return value;
}

function checkedRequest(request: SharedHostRequest): void {
  if (!request || !isAbsolute(request.projectRoot)
    || resolve(request.projectRoot) !== request.projectRoot
    || request.projectRoot === "/" || !projectIdPattern.test(request.projectId)
    || !Array.isArray(request.tcpPorts)
    || request.tcpPorts.length > MAX_SHARED_TCP_PORTS
    || request.tcpPorts.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
    || new Set(request.tcpPorts).size !== request.tcpPorts.length
    || !Array.isArray(request.volumeNames) || request.volumeNames.length > 512
    || request.volumeNames.some((name) => typeof name !== "string"
      || !volumeNamePattern.test(name) || !name.startsWith(`${request.projectId}-`))
    || new Set(request.volumeNames).size !== request.volumeNames.length
    || !Number.isSafeInteger(request.minimumFreeBytes) || request.minimumFreeBytes < 1024 * 1024
    || typeof request.preparedMediaPath !== "boolean"
    || (request.preparedMediaPath && request.mediaPath === null)
    || (request.mediaPath !== null && request.mediaPath !== join(request.projectRoot,
      ".selfhost", "shared", request.projectId, "data", "shared"))) {
    fail("request needs one exact project, distinct selected TCP ports, and project-scoped volume names");
  }
}

function listenerBind(value: unknown): string {
  if (value === "0.0.0.0" || value === "::" || value === "*") return "*";
  if (typeof value !== "string") fail("listener bind is invalid");
  const address = value.split("%", 1)[0];
  if (isIP(address) === 0) fail("listener bind is invalid");
  return address;
}

/** Converts one complete, local, read-only probe into a shared-project observation. */
export function sharedHostFacts(reportValue: unknown, request: SharedHostRequest,
  existingVolumeNames: readonly string[], checkedAt = new Date().toISOString(),
  existingProject?: SharedProjectCandidate): SharedHostFacts {
  checkedRequest(request);
  if (!Number.isFinite(Date.parse(checkedAt))) fail("inspection timestamp is invalid");
  const report = object(reportValue, "report");
  const runtime = object(report.runtime, "runtime");
  const docker = object(runtime.docker, "Docker runtime");
  const rootless = object(docker.rootless, "Docker rootless mode");
  const context = object(runtime.dockerContext, "Docker context");
  const identity = object(report.identity, "identity");
  const timezone = object(identity.timezone, "timezone");
  const workloads = object(report.workloads, "workloads");
  const containers = object(workloads.containers, "containers");
  const dockerNetworks = object(workloads.dockerNetworks, "Docker networks");
  const network = object(report.network, "network");
  const listeners = object(network.listeningPorts, "listeners");
  const selected = object(network.selectedTcpPorts, "selected TCP ports");
  const storage = object(report.storage, "storage");
  const portsObserved = selected.state === "observed" && selected.complete === true;
  const noPortsRequested = request.tcpPorts.length === 0 && selected.state === "not_requested"
    && selected.complete === false && Array.isArray(selected.items) && selected.items.length === 0;
  if (report.schemaVersion !== 1 || report.mode !== "read-only"
    || docker.state !== "running" || context.state !== "observed"
    || !["default", "rootless"].includes(String(context.current))
    || identity.state !== "observed" || !Number.isSafeInteger(identity.uid)
    || !Number.isSafeInteger(identity.gid) || Number(identity.uid) <= 0
    || Number(identity.gid) <= 0 || timezone.state !== "observed"
    || typeof timezone.value !== "string"
    || containers.state !== "observed" || containers.truncated !== false
    || dockerNetworks.state !== "observed" || dockerNetworks.truncated !== false
    || listeners.state !== "observed" || (!portsObserved && !noPortsRequested)) {
    fail("Docker, identity, timezone, containers, networks, listeners, or exact ports were not fully observed");
  }
  if (typeof process.getuid === "function"
    && (identity.uid !== process.getuid() || identity.gid !== process.getgid?.())) {
    fail("observed UID/GID differs from the current local operator");
  }
  if (rootless.state !== "observed" || typeof rootless.value !== "boolean") {
    fail("Docker rootless mode was not fully observed");
  }
  if (context.current === "rootless" && rootless.value !== true) {
    fail("the rootless Docker context does not report rootless security mode");
  }
  if (rootless.value && request.mediaPath !== null) {
    fail("rootless Docker media bind ownership is not verified for the shared project");
  }
  try { new Intl.DateTimeFormat("en", { timeZone: timezone.value }); }
  catch { fail("observed timezone is not a recognized IANA zone"); }

  for (const raw of array(containers.items, "container inventory")) {
    const container = object(raw, "container");
    if (typeof container.name !== "string" || (!existingProject
      && (container.name === request.projectId || container.name.startsWith(`${request.projectId}-`)))) {
      fail("the proposed Compose project already has a container or an unidentifiable container exists");
    }
    if (container.publishedPorts !== null && typeof container.publishedPorts !== "string") {
      fail("container published-port inventory is invalid");
    }
    if (typeof container.publishedPorts === "string" && request.tcpPorts.some((port) =>
      new RegExp(`(?:^|[^0-9])${port}->`).test(container.publishedPorts as string))) {
      fail("a Docker container already publishes one selected TCP port");
    }
  }
  const checkedPorts = array(selected.items, "selected-port inventory").map((raw) => {
    const item = object(raw, "selected port");
    if (!Number.isInteger(item.port) || typeof item.inUse !== "boolean") {
      fail("selected-port result is invalid");
    }
    return { port: item.port as number, inUse: item.inUse as boolean };
  });
  const expectedPorts = [...request.tcpPorts].sort((left, right) => left - right);
  const actualPorts = checkedPorts.map((item) => item.port).sort((left, right) => left - right);
  if (JSON.stringify(actualPorts) !== JSON.stringify(expectedPorts)
    || checkedPorts.some((item) => item.inUse)) {
    fail("selected TCP ports differ from the exact probe or are already in use");
  }
  const ports = array(listeners.items, "listener inventory").map((raw) => {
    const item = object(raw, "listener");
    let protocol = item.protocol;
    if (protocol === "tcp6") protocol = "tcp";
    if (protocol === "udp6") protocol = "udp";
    const published = Number(item.port);
    if ((protocol !== "tcp" && protocol !== "udp") || !Number.isInteger(published)
      || published < 1 || published > 65535) fail("listener inventory contains an invalid endpoint");
    return { hostIp: listenerBind(item.bind), published, protocol, owner: "external" };
  });
  if (ports.some((item) => item.protocol === "tcp" && expectedPorts.includes(item.published))) {
    fail("listener inventory contradicts an available selected TCP port");
  }
  const networks = array(dockerNetworks.items, "Docker-network inventory").map((raw) => {
    const item = object(raw, "Docker network");
    if (typeof item.name !== "string" || !item.name) fail("Docker network name is invalid");
    return { name: item.name, owner: "external" };
  });
  if (!existingProject && networks.some((item) => item.name === `${request.projectId}-front`)) {
    fail("the proposed shared front network already exists");
  }
  const inspectedRoot = array(storage.paths, "storage paths")
    .map((raw) => object(raw, "storage path"))
    .find((path) => path.path === request.projectRoot);
  if (!inspectedRoot || inspectedRoot.exists !== true || inspectedRoot.directory !== true
    || inspectedRoot.symlink !== false || inspectedRoot.writableByInspector !== true
    || inspectedRoot.networkFilesystem !== false || inspectedRoot.readOnlyMount !== false
    || !Number.isSafeInteger(inspectedRoot.availableBytes)
    || Number(inspectedRoot.availableBytes) < request.minimumFreeBytes
    || !Number.isSafeInteger(inspectedRoot.availableInodes)
    || Number(inspectedRoot.availableInodes) < 1) {
    fail("project root lacks observed, local, writable capacity");
  }
  if (request.mediaPath !== null) {
    const media = array(storage.paths, "storage paths")
      .map((raw) => object(raw, "storage path"))
      .filter((path) => path.path === request.mediaPath);
    if (media.length !== 1 || media[0].symlink !== false) {
      fail("the selected media path has no exact safe observation");
    }
    if (request.preparedMediaPath) {
      if (media[0].exists !== true || media[0].directory !== true
        || media[0].writableByInspector !== true || media[0].networkFilesystem !== false
        || media[0].readOnlyMount !== false) {
        fail("the saved prepared media path is not an observed writable local directory");
      }
    } else if (media[0].exists !== false) {
      fail("the new project's selected media path must be absent before preparation");
    }
  }
  if (!Array.isArray(existingVolumeNames) || existingVolumeNames.length > 65536
    || existingVolumeNames.some((name) => typeof name !== "string" || !observedVolumeNamePattern.test(name))) {
    fail("Docker volume-name inventory is incomplete or invalid");
  }
  const existing = new Set(existingVolumeNames);
  const volumes = request.volumeNames.filter((name) => existing.has(name)).map((name) => ({
    name, driver: "local", owner: "external",
    labels: { "com.docker.compose.project": null, "com.docker.compose.volume": null,
      "io.selfhost.project": null, "io.selfhost.volume": null },
  }));
  if (volumes.length > 0) fail("a proposed project-owned volume name already exists");
  return { dockerContext: context.current as string, uid: identity.uid as number,
    gid: identity.gid as number, timezone: timezone.value,
    observed: { checkedAt, ports: ports.filter((item) => expectedPorts.includes(item.published)),
      paths: [], networks, volumes } };
}

function hostScript(): string {
  const candidates = [
    new URL("./workflows/selfhost-host/scripts/inspect-host.sh", import.meta.url),
    new URL("../../../../.agents/skills/self-host/workflows/selfhost-host/scripts/inspect-host.sh", import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  fail("the bounded host-inspection runtime is missing");
}

/** Local host observations cannot authorize a remote Docker context. */
export function requireLocalSharedDockerContext(context: string): void {
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail("remove Docker endpoint environment overrides before shared-project planning or apply");
  }
  if (context !== "default" && context !== "rootless") {
    fail("shared-project context is not a supported local Docker context");
  }
  const inspected = spawnSync("docker", ["context", "inspect", context,
    "--format", "{{json .Endpoints.docker.Host}}"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 4096,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (inspected.error || inspected.status !== 0) {
    fail("Docker context endpoint could not be verified; child output was suppressed");
  }
  let endpoint: unknown;
  try { endpoint = JSON.parse(inspected.stdout.trim()); }
  catch { fail("Docker context endpoint was not a JSON string"); }
  const local = context === "default" ? "unix:///var/run/docker.sock"
    : `unix:///run/user/${process.getuid?.()}/docker.sock`;
  if (endpoint !== local) fail("Docker context endpoint is not the inspected local Linux socket");
}

/** Reads only bounded host metadata. It never creates files or invokes Compose. */
export function inspectNewSharedHost(request: SharedHostRequest): SharedHostFacts {
  checkedRequest(request);
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail("remove Docker endpoint environment overrides before shared-project planning or apply");
  }
  const args = [hostScript(), "--path", request.projectRoot, "--limit", String(MAX_SHARED_SERVICES)];
  if (request.mediaPath !== null) args.push("--path", request.mediaPath);
  for (const port of request.tcpPorts) args.push("--check-tcp-port", String(port));
  const probe = spawnSync("bash", args, { encoding: "utf8", timeout: 30_000,
    maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (probe.error || probe.status !== 0) fail("bounded host probe failed; child output was suppressed");
  let report: unknown;
  try { report = JSON.parse(probe.stdout); }
  catch { fail("bounded host probe returned invalid JSON"); }
  const context = object(object(report, "report").runtime, "runtime");
  const dockerContext = object(context.dockerContext, "Docker context").current;
  if (dockerContext !== "default" && dockerContext !== "rootless") {
    fail("shared project requires an inspected local Docker context");
  }
  requireLocalSharedDockerContext(dockerContext);
  const listed = spawnSync("docker", ["--context", dockerContext, "volume", "ls", "--quiet"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (listed.error || listed.status !== 0) fail("Docker volume inventory failed; child output was suppressed");
  const names = listed.stdout.trim() === "" ? [] : listed.stdout.trim().split("\n");
  return sharedHostFacts(report, request, names);
}

function exactDockerJson(context: string, kind: "network" | "volume", name: string): Entry {
  const result = spawnSync("docker", ["--context", context, kind, "inspect", name,
    "--format", "{{json .}}"], { encoding: "utf8", timeout: 15_000,
    maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) fail(`saved ${kind} ownership could not be observed`);
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout.trim()); }
  catch { fail(`saved ${kind} metadata is invalid`); }
  return object(parsed, `saved ${kind}`);
}

function retainedContainer(context: string, projectId: string, directory: string,
  service: Entry): Entry {
  const listed = spawnSync("docker", ["--context", context, "container", "ls", "--all",
    "--no-trunc", "--filter", `label=com.docker.compose.project=${projectId}`,
    "--filter", `label=com.docker.compose.service=${service.id}`, "--format", "{{.ID}}"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 4096,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (listed.error || listed.status !== 0) fail("saved container inventory is unavailable");
  const ids = listed.stdout.trim().split("\n").filter(Boolean);
  if (ids.length !== 1 || !/^[0-9a-f]{64}$/.test(ids[0]!)) {
    fail("saved service has absent or ambiguous Compose containers");
  }
  const inspected = spawnSync("docker", ["--context", context, "container", "inspect", ids[0]!,
    "--format", '{"labels":{{json .Config.Labels}},"bindings":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}'], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (inspected.error || inspected.status !== 0) fail("saved container metadata is unavailable");
  let parsed: unknown;
  try { parsed = JSON.parse(inspected.stdout.trim()); }
  catch { fail("saved container metadata is invalid"); }
  const container = object(parsed, "saved container");
  const labels = object(container.labels, "saved container labels");
  if (labels["com.docker.compose.project"] !== projectId
    || labels["com.docker.compose.service"] !== service.id
    || labels["com.docker.compose.project.working_dir"] !== directory) {
    fail("saved container owner differs from the Compose project");
  }
  return container;
}

/** Re-observes one saved project and only the ports/path selected for an addition. */
export function inspectExistingSharedHost(request: SharedHostRequest,
  current: SharedProjectCandidate, absentServices: readonly string[] = []): SharedHostFacts & { observed: SharedProjectObservation } {
  checkedRequest(request);
  const manifest = current?.manifest;
  const directory = join(request.projectRoot, ".selfhost", "shared", request.projectId);
  if (new Set(absentServices).size !== absentServices.length || absentServices.length > MAX_SHARED_SERVICES
    || absentServices.some((id) => !current.manifest?.services?.some((service: Entry) => service.id === id))) {
    fail("restored absent services must name exact saved manifest services");
  }
  if (current.projectDirectory !== directory || manifest?.project?.id !== request.projectId
    || manifest.project.owner !== request.projectId || manifest.project.directory !== directory
    || manifest.project.root !== join(request.projectRoot, ".selfhost", "shared")
    || !Array.isArray(manifest.networks) || manifest.networks.length < 2
    || !Array.isArray(manifest.services) || manifest.services.length < 1
    || !current.settings || !Number.isSafeInteger(current.settings.uid)
    || !Number.isSafeInteger(current.settings.gid)
    || typeof current.settings.timezone !== "string") {
    fail("saved project identity or resource inventory is invalid");
  }
  if (Object.hasOwn(process.env, "DOCKER_HOST") || Object.hasOwn(process.env, "DOCKER_CONTEXT")) {
    fail("remove Docker endpoint environment overrides before shared-project planning or apply");
  }
  const savedNetworks = new Map<string, string>();
  for (const raw of manifest.networks as Entry[]) {
    const network = object(raw, "saved network");
    if (typeof network.id !== "string" || typeof network.name !== "string"
      || network.name !== `${request.projectId}-${network.id}`
      || network.owner !== request.projectId || network.driver !== "bridge"
      || typeof network.internal !== "boolean" || savedNetworks.has(network.name)) {
      fail("saved network identity is invalid");
    }
    savedNetworks.set(network.name, network.id);
  }
  if (savedNetworks.get(`${request.projectId}-front`) !== "front") {
    fail("saved front network is missing");
  }
  const savedVolumes = new Map<string, string>();
  for (const rawService of manifest.services as Entry[]) {
    const service = object(rawService, "saved service");
    if (!Array.isArray(service.mounts)) fail("saved service mounts are invalid");
    for (const rawMount of service.mounts) {
      const mount = object(rawMount, "saved mount");
      if (mount.kind !== "volume") continue;
      if (typeof mount.name !== "string" || !mount.name.startsWith(`${request.projectId}-`)
        || mount.owner !== request.projectId) fail("saved volume identity is invalid");
      savedVolumes.set(mount.name, mount.name.slice(request.projectId.length + 1));
    }
  }
  if (request.volumeNames.some((name) => savedVolumes.has(name))) {
    fail("a new volume overlaps a saved volume");
  }
  if (request.preparedMediaPath && request.mediaPath !== null
    && !(manifest.services as Entry[]).some((service) => (service.mounts as Entry[])
      .some((mount) => mount.kind !== "volume" && mount.source === request.mediaPath
        && mount.owner === request.projectId))) {
    fail("the prepared media path is not owned by a saved service");
  }
  const args = [hostScript(), "--path", request.projectRoot, "--limit", String(MAX_SHARED_SERVICES)];
  if (request.mediaPath !== null) args.push("--path", request.mediaPath);
  for (const port of request.tcpPorts) args.push("--check-tcp-port", String(port));
  const probe = spawnSync("bash", args, { encoding: "utf8", timeout: 30_000,
    maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (probe.error || probe.status !== 0) fail("bounded host probe failed; child output was suppressed");
  let report: unknown;
  try { report = JSON.parse(probe.stdout); }
  catch { fail("bounded host probe returned invalid JSON"); }
  const runtime = object(object(report, "report").runtime, "runtime");
  const context = object(runtime.dockerContext, "Docker context").current;
  if ((context !== "default" && context !== "rootless")
    || context !== manifest.project.dockerContext) fail("saved local Docker context changed");
  requireLocalSharedDockerContext(context);
  const listed = spawnSync("docker", ["--context", context, "volume", "ls", "--quiet"], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (listed.error || listed.status !== 0) fail("Docker volume inventory failed; child output was suppressed");
  const names = listed.stdout.trim() === "" ? [] : listed.stdout.trim().split("\n");
  if (new Set(names).size !== names.length
    || [...savedVolumes.keys()].some((name) => !names.includes(name)
      && manifest.services.some((service: Entry) => !isManualJobService(service)
        && service.mounts.some((mount: Entry) => mount.kind === "volume" && mount.name === name)))) {
    fail("saved volume inventory is absent or ambiguous");
  }
  const facts = sharedHostFacts(report, request, names, new Date().toISOString(), current);
  if (facts.dockerContext !== manifest.project.dockerContext
    || facts.uid !== current.settings.uid || facts.gid !== current.settings.gid
    || facts.timezone !== current.settings.timezone) {
    fail("saved host identity or timezone changed");
  }
  const observedNetworks = facts.observed.networks as Entry[];
  for (const [name, id] of savedNetworks) {
    if (!observedNetworks.some((item) => item.name === name)
      && !manifest.services.some((service: Entry) => !isManualJobService(service)
        && service.networks.includes(id))) continue;
    if (observedNetworks.filter((item) => item.name === name).length !== 1) {
      fail("saved network inventory is absent or ambiguous");
    }
    const network = exactDockerJson(context, "network", name);
    const labels = object(network.Labels, "saved network labels");
    const saved = (manifest.networks as Entry[]).find((item) => item.id === id)!;
    if (network.Name !== name || network.Driver !== "bridge"
      || network.Internal !== saved.internal
      || labels["com.docker.compose.project"] !== request.projectId
      || labels["com.docker.compose.network"] !== id) {
      fail("saved network ownership differs from the Compose project");
    }
    observedNetworks.find((item) => item.name === name)!.owner = request.projectId;
  }
  const volumes: Entry[] = [];
  for (const [name, id] of savedVolumes) {
    if (!names.includes(name)) continue;
    const volume = exactDockerJson(context, "volume", name);
    const labels = object(volume.Labels, "saved volume labels");
    if (volume.Name !== name || volume.Driver !== "local"
      || labels["com.docker.compose.project"] !== request.projectId
      || labels["com.docker.compose.volume"] !== name
      || labels["io.selfhost.project"] !== request.projectId
      || labels["io.selfhost.volume"] !== id) {
      fail("saved volume ownership differs from the Compose project");
    }
    volumes.push({ name, driver: "local", owner: request.projectId,
      labels: { "com.docker.compose.project": request.projectId,
        "com.docker.compose.volume": name, "io.selfhost.project": request.projectId,
        "io.selfhost.volume": id } });
  }
  const retainedPorts: Entry[] = [];
  const retainedPaths = new Set<string>();
  for (const raw of manifest.services as Entry[]) {
    const service = object(raw, "saved service");
    if (typeof service.id !== "string" || !Array.isArray(service.ports)
      || !Array.isArray(service.mounts)) fail("saved service inventory is invalid");
    if (absentServices.includes(service.id)) {
      const listed = spawnSync("docker", ["--context", context, "container", "ls", "--all", "--no-trunc",
        "--filter", `label=com.docker.compose.project=${request.projectId}`,
        "--filter", `label=com.docker.compose.service=${service.id}`, "--format", "{{.ID}}"], {
        encoding: "utf8", timeout: 15_000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
      if (listed.error || listed.status !== 0 || listed.stdout.trim() !== "") {
        fail("removed app has an existing or uncertain container; inspect before reinstalling");
      }
    }
    if (isManualJobService(service) || absentServices.includes(service.id)) {
      for (const rawMount of service.mounts) {
        const mount = object(rawMount, "prepared job mount");
        if (mount.kind === "volume") continue;
        if (typeof mount.source !== "string" || mount.owner !== request.projectId) {
          fail("prepared job bind is not owned by the saved project");
        }
        const metadata = lstatSync(mount.source);
        if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())
          || realpathSync(mount.source) !== mount.source) fail("prepared job bind is not an exact local path");
        retainedPaths.add(mount.source);
      }
      continue;
    }
    const container = retainedContainer(context, request.projectId, directory, service);
    const bindings = container.bindings === null ? {} : object(container.bindings, "saved port bindings");
    const mounted = array(container.mounts, "saved container mounts").map((item) =>
      object(item, "saved container mount"));
    for (const rawPort of service.ports) {
      const port = object(rawPort, "saved port");
      const bound = bindings[`${port.target}/${port.protocol}`];
      if (!Array.isArray(bound) || bound.length !== 1
        || bound[0]?.HostIp !== port.hostIp
        || bound[0]?.HostPort !== String(port.published)) {
        fail("saved container port binding differs from the manifest");
      }
      if (request.tcpPorts.includes(port.published as number)) {
        fail("new selected port overlaps a retained service");
      }
      retainedPorts.push({ hostIp: port.hostIp, published: port.published,
        protocol: port.protocol, owner: request.projectId });
    }
    for (const rawMount of service.mounts) {
      const mount = object(rawMount, "saved mount");
      const matches = mounted.filter((item) => item.Destination === mount.target);
      if (matches.length !== 1 || matches[0]?.RW !== !mount.readOnly) {
        fail("saved container mount is absent or ambiguous");
      }
      const actual = matches[0]!;
      if (mount.kind === "volume") {
        if (actual.Type !== "volume" || actual.Name !== mount.name
          || !savedVolumes.has(mount.name as string)) {
          fail("saved container volume differs from the manifest");
        }
      } else {
        if (actual.Type !== "bind" || actual.Source !== mount.source
          || mount.owner !== request.projectId || typeof mount.source !== "string") {
          fail("saved container bind differs from the manifest");
        }
        let metadata;
        try { metadata = lstatSync(mount.source); }
        catch { fail("saved bind source is missing"); }
        if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())
          || realpathSync(mount.source) !== mount.source) {
          fail("saved bind source is not an exact local path");
        }
        retainedPaths.add(mount.source);
      }
    }
  }
  const ports = facts.observed.ports as Entry[];
  for (const retained of retainedPorts) {
    const normalized = listenerBind(retained.hostIp);
    const matches = ports.filter((item) => item.protocol === retained.protocol
      && item.published === retained.published && item.hostIp === normalized);
    if (matches.length > 1) fail("retained listener inventory is ambiguous");
    if (matches.length === 1) matches[0]!.owner = request.projectId;
    else ports.push(retained);
  }
  const paths = [...retainedPaths].map((path) => ({ path, owner: request.projectId }));
  return { ...facts, observed: { ...facts.observed, ports, paths,
    project: { id: request.projectId, owner: request.projectId, directory }, volumes } };
}
