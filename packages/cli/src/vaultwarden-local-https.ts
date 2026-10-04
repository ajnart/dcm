import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer, isIP } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { parsePrivateNetworkSubnet } from "./private-network-subnet.ts";

type JsonObject = Record<string, any>;
type Action = "init" | "plan" | "apply" | "status" | "up" | "down" | "lifecycle-check";
type Options = {
  action: Action;
  projectRoot: string;
  input: string;
  runId: string;
  approval: string;
  hostInspection: string;
  caddyImage: string;
  hostname: string;
  httpsPort: string;
  bindAddress: string;
  dnsOwner: string;
  routeSubnet: string;
  ingressSubnet: string;
};

type Prepared = {
  manifest: JsonObject;
  origin: string;
  hostname: string;
  httpsPort: number;
  bindAddress: string;
  dnsOwner: string | null;
  accessScope: "host-only" | "private-network";
  caddyfile: string;
  caddyfilePath: string;
  configPath: string;
  dataPath: string;
  caSourcePath: string;
  directory: string;
  projectId: string;
  network: { id: string; name: string; owner: string };
  portObservation: JsonObject;
};

type Checkpoint = {
  schemaVersion: 1;
  kind: "vaultwarden-local-https-checkpoint";
  project: string;
  runId: string;
  approvalDigest: string;
  composeFile: string;
  caExportPath: string;
  caSha256: string;
  appliedAt: string;
  transportProof: {
    method: "curl-cacert-resolve";
    verified: boolean;
    httpStatus: number | null;
    verifiedAt: string;
  };
};

const MAX_INPUT = 256 * 1024;
const MAX_PRIVATE = 64 * 1024;
const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CADDY_IMAGE = /^docker\.io\/library\/caddy:2\.[0-9]+\.[0-9]+(?:-alpine)?@sha256:[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const NETWORK = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/;
const DNS_OWNER = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

function fail(message: string): never {
  throw new Error(message);
}

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value as JsonObject;
}

function exact(value: JsonObject, required: string[], optional: string[], name: string): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))) {
    fail(`${name} contains missing or unsupported fields`);
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  if (path === "") {
    return true;
  }
  if (path === ".." || path.startsWith(`..${sep}`)) {
    return false;
  }
  return !isAbsolute(path);
}

function parse(args: string[]): Options {
  const action = args[0];
  if (action !== "init" && action !== "plan" && action !== "apply" && action !== "status"
    && action !== "up" && action !== "down" && action !== "lifecycle-check") {
    fail("Use vaultwarden local-https init, plan, apply, status, up, or down");
  }
  const flags: Record<string, string> = {};
  const allowed = new Set([
    "--project-root", "--input", "--run-id", "--approve", "--host-inspection", "--caddy-image", "--hostname", "--https-port",
    "--bind-address", "--dns-owner", "--route-subnet", "--ingress-subnet",
  ]);
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key) || flags[key] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated Vaultwarden local-HTTPS option: ${key ?? "(missing)"}`);
    }
    flags[key] = value;
  }
  if (!flags["--project-root"] || !flags["--run-id"]) {
    fail("Vaultwarden local-HTTPS commands need --project-root and --run-id");
  }
  if (!RUN_ID.test(flags["--run-id"])) {
    fail("Vaultwarden local-HTTPS run ID is invalid");
  }
  if (action === "init") {
    if (!flags["--host-inspection"] || !flags["--caddy-image"]) {
      fail("vaultwarden local-https init needs --host-inspection and --caddy-image");
    }
    if (flags["--input"] || flags["--approve"]) {
      fail("vaultwarden local-https init creates its input and does not accept --input or --approve");
    }
  } else if (!flags["--input"]) {
    fail(`vaultwarden local-https ${action} needs --input`);
  }
  if (action !== "init" && (flags["--host-inspection"] || flags["--caddy-image"] || flags["--hostname"] || flags["--https-port"]
    || flags["--bind-address"] || flags["--dns-owner"] || flags["--route-subnet"] || flags["--ingress-subnet"])) {
    fail(`vaultwarden local-https ${action} does not accept init-only options`);
  }
  if (action === "apply" && !flags["--approve"]) {
    fail("vaultwarden local-https apply needs the exact --approve token from plan");
  }
  if (action !== "apply" && action !== "init" && flags["--approve"]) {
    fail(`vaultwarden local-https ${action} does not accept --approve`);
  }
  let approval = "";
  if (flags["--approve"]) {
    approval = flags["--approve"];
  }
  return {
    action,
    projectRoot: flags["--project-root"],
    input: flags["--input"] ?? "",
    runId: flags["--run-id"],
    approval,
    hostInspection: flags["--host-inspection"] ?? "",
    caddyImage: flags["--caddy-image"] ?? "",
    hostname: flags["--hostname"] ?? "",
    httpsPort: flags["--https-port"] ?? "",
    bindAddress: flags["--bind-address"] ?? "",
    dnsOwner: flags["--dns-owner"] ?? "",
    routeSubnet: flags["--route-subnet"] ?? "",
    ingressSubnet: flags["--ingress-subnet"] ?? "",
  };
}

function assertOwner(metadata: Awaited<ReturnType<typeof lstat>>, name: string): void {
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail(`${name} has a different owner`);
  }
}

async function ownedDirectory(path: string, name: string, privateMode: boolean): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    fail(`${name} must be a real canonical directory`);
  }
  assertOwner(metadata, name);
  const mode = metadata.mode & 0o777;
  if (privateMode && mode !== 0o700) {
    fail(`${name} must use mode 0700`);
  }
  if (!privateMode && (mode & 0o002) !== 0) {
    fail(`${name} must not be world-writable`);
  }
}

async function validateProjectRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path || path === sep || path === resolve(homedir())) {
    fail("--project-root must be one exact absolute project path, not root or home");
  }
  await ownedDirectory(path, "project root", false);
  return path;
}

async function readJson(path: string, maximum: number, privateMode: boolean, name: string): Promise<unknown> {
  if (!isAbsolute(path) || resolve(path) !== path) {
    fail(`${name} must be an exact absolute path`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 2 || metadata.size > maximum || await realpath(path) !== path) {
    fail(`${name} must be one bounded regular file without links`);
  }
  assertOwner(metadata, name);
  if (privateMode && (metadata.mode & 0o777) !== 0o600) {
    fail(`${name} must use mode 0600`);
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function initHttpsPort(value: string): number {
  if (value === "") {
    return 28443;
  }
  if (!/^\d+$/.test(value)) {
    fail("--https-port must be an unprivileged high port and must not be 80 or 443");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 80 || port === 443) {
    fail("--https-port must be an unprivileged high port and must not be 80 or 443");
  }
  return port;
}

function supportedHostname(value: string): boolean {
  const localName = value === "localhost" || value.endsWith(".localhost");
  const privateName = value.endsWith(".home.arpa");
  if (value === "localhost") {
    return true;
  }
  return HOSTNAME.test(value) && (localName || privateName);
}

function initHostname(value: string): string {
  if (value === "") {
    return "vaultwarden.localhost";
  }
  if (value !== value.toLowerCase() || !supportedHostname(value)) {
    fail("--hostname must be localhost, a name below .localhost, or a private DNS name below .home.arpa");
  }
  return value;
}

function privateLanBindAddress(value: string): boolean {
  if (isIP(value) !== 4) {
    return false;
  }
  const parts = value.split(".").map(Number);
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function routeAccess(hostname: string, bindAddress: string, dnsOwner: string | null) {
  const localName = hostname === "localhost" || hostname.endsWith(".localhost");
  if (bindAddress === "127.0.0.1") {
    if (!localName || dnsOwner !== null) {
      fail("loopback local-HTTPS requires a .localhost name and no private DNS owner");
    }
    return "host-only" as const;
  }
  if (!privateLanBindAddress(bindAddress)) {
    fail("--bind-address must be 127.0.0.1 or an observed RFC1918 LAN address; tailnet binds need a separate private-ingress owner");
  }
  if (!hostname.endsWith(".home.arpa")) {
    fail("a private network bind requires a lowercase name below .home.arpa");
  }
  if (dnsOwner === null) {
    fail("a private .home.arpa route needs --dns-owner (dnsOwner in a route input)");
  }
  return "private-network" as const;
}

function initBindAddress(value: string): string {
  if (value === "") {
    return "127.0.0.1";
  }
  if (isIP(value) !== 4) {
    fail("--bind-address must be 127.0.0.1 or an observed RFC1918 LAN address; tailnet binds need a separate private-ingress owner");
  }
  return value;
}

function initDnsOwner(value: string): string | null {
  if (value === "") {
    return null;
  }
  if (!DNS_OWNER.test(value)) {
    fail("--dns-owner must be a bounded lowercase owner identifier");
  }
  return value;
}

function observedListenerHost(value: string): string {
  let hostIp = value;
  if (hostIp.includes("%")) {
    const scoped = hostIp.match(/^(.+)%([A-Za-z0-9][A-Za-z0-9_.:-]{0,14})$/);
    if (!scoped || isIP(scoped[1]) === 0) {
      fail("host inspection contains an unsupported scoped listener address");
    }
    hostIp = scoped[1];
  }
  if (hostIp === "0.0.0.0" || hostIp === "::" || hostIp === "*") {
    return "*";
  }
  if (isIP(hostIp) === 0) {
    fail("host inspection contains an unsupported listener address");
  }
  return hostIp;
}

async function hostInspectionInput(root: string, path: string, httpsPort: number, projectId: string, bindAddress: string) {
  if (!inside(root, path)) {
    fail("--host-inspection must stay inside the selected project root");
  }
  const report = object(await readJson(path, MAX_INPUT, true, "host inspection report"), "host inspection report");
  const metadata = await lstat(path);
  const age = Date.now() - metadata.mtimeMs;
  if (age < -60_000 || age > 15 * 60_000) {
    fail("host inspection must be refreshed within the last 15 minutes");
  }
  if (report.schemaVersion !== 1 || report.mode !== "read-only") {
    fail("host inspection must be a schemaVersion 1 read-only report");
  }
  const identity = object(report.identity, "host inspection identity");
  if (!Number.isInteger(identity.uid) || !Number.isInteger(identity.gid)) {
    fail("host inspection must record the local numeric identity");
  }
  if (typeof process.getuid === "function" && (identity.uid !== process.getuid() || identity.gid !== process.getgid?.())) {
    fail("host inspection identity must match the user running local-HTTPS init");
  }
  const runtime = object(report.runtime, "host inspection runtime");
  const docker = object(runtime.docker, "host inspection Docker state");
  const context = object(runtime.dockerContext, "host inspection Docker context");
  if (docker.state !== "running" || context.state !== "observed"
    || (context.current !== "default" && context.current !== "rootless")) {
    fail("local-HTTPS init requires an inspected local Docker engine using the default or rootless context");
  }
  const workloads = object(report.workloads, "host inspection workloads");
  const dockerNetworks = object(workloads.dockerNetworks, "host inspection Docker networks");
  if (dockerNetworks.state !== "observed" || dockerNetworks.truncated !== false || !Array.isArray(dockerNetworks.items)) {
    fail("local-HTTPS init requires a complete untruncated Docker network observation");
  }
  const network = object(report.network, "host inspection network");
  const listeners = object(network.listeningPorts, "host inspection listeners");
  if (listeners.state !== "observed" || typeof listeners.truncated !== "boolean" || !Array.isArray(listeners.items)) {
    fail("local-HTTPS init requires a valid bounded listener observation");
  }
  const selected = object(network.selectedTcpPorts, "host inspection selected TCP ports");
  if (selected.state !== "observed" || selected.complete !== true || !Array.isArray(selected.items)) {
    fail("local-HTTPS init requires complete exact selected TCP port checks");
  }

  const selectedMatches = selected.items.filter((item: unknown) => {
    const entry = object(item, "selected TCP port check");
    if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535 || typeof entry.inUse !== "boolean") {
      fail("host inspection contains an invalid selected TCP port check");
    }
    return entry.port === httpsPort;
  });
  if (selectedMatches.length !== 1) {
    fail(`host inspection needs one exact selected TCP port check for ${httpsPort}`);
  }
  if (selectedMatches[0].inUse !== false) {
    fail(`selected HTTPS port ${httpsPort} is occupied; inspect another high port`);
  }

  const observedPorts = listeners.items.map((item: unknown) => {
    const entry = object(item, "observed listener");
    const published = Number(entry.port);
    let protocol = entry.protocol;
    if (protocol === "tcp6") {
      protocol = "tcp";
    }
    if (protocol === "udp6") {
      protocol = "udp";
    }
    if (!Number.isInteger(published) || published < 1 || published > 65535
      || (protocol !== "tcp" && protocol !== "udp") || typeof entry.bind !== "string") {
      fail("host inspection contains an unsupported listener");
    }
    const hostIp = observedListenerHost(entry.bind);
    return { hostIp, published, protocol, owner: "external" };
  });
  if (observedPorts.some((entry) => entry.protocol === "tcp" && entry.published === httpsPort)) {
    fail(`host inspection contradicts its selected-port result for ${httpsPort}`);
  }
  let bindEvidence = "loopback-address";
  let bindAddressObservation: { address: string; interface: string; prefixLength: number | null } | null = null;
  if (bindAddress !== "127.0.0.1") {
    const candidates = object(network.lanIpv4Candidates, "host inspection LAN address candidates");
    if (candidates.state !== "observed" || !Array.isArray(candidates.items)) {
      fail("host inspection did not observe LAN address candidates; refresh host inspection before selecting a private bind");
    }
    for (const rawCandidate of candidates.items) {
      const candidate = object(rawCandidate, "host inspection LAN address candidate");
      if (candidate.address !== bindAddress) continue;
      if (typeof candidate.interface !== "string" || candidate.interface.length === 0
        || (candidate.prefixLength !== null && (!Number.isInteger(candidate.prefixLength)
          || (candidate.prefixLength as number) < 0 || (candidate.prefixLength as number) > 32))) {
        fail("host inspection contains invalid LAN address evidence");
      }
      bindAddressObservation = {
        address: bindAddress,
        interface: candidate.interface,
        prefixLength: candidate.prefixLength as number | null,
      };
      break;
    }
    if (bindAddressObservation === null) {
      fail(`host inspection does not observe bind address ${bindAddress} on a LAN interface`);
    }
    bindEvidence = "host-interface-candidate";
  }

  const inspectedNetworks = dockerNetworks.items.map((item: unknown) => {
    const entry = object(item, "observed Docker network");
    if (typeof entry.name !== "string" || !NETWORK.test(entry.name)) {
      fail("host inspection contains an invalid Docker network name");
    }
    return { name: entry.name, owner: "external" };
  });
  if (new Set(inspectedNetworks.map((entry) => entry.name)).size !== inspectedNetworks.length) {
    fail("host inspection contains duplicate Docker network names");
  }
  const observedNetworks = inspectedNetworks.filter((entry) => entry.name !== "host" && entry.name !== "none");
  const routeNetworks = [`${projectId}-private`, `${projectId}-ingress`];
  for (const routeNetwork of routeNetworks) {
    if (observedNetworks.some((entry) => entry.name === routeNetwork)) {
      fail(`Docker network ${routeNetwork} already exists; choose another run ID`);
    }
  }
  const checkedAt = new Date(metadata.mtimeMs).toISOString();
  return {
    dockerContext: context.current,
    observed: {
      checkedAt,
      project: null,
      ports: observedPorts,
      paths: [],
      networks: observedNetworks,
    },
    portObservation: {
      hostIp: bindAddress,
      port: httpsPort,
      protocol: "tcp",
      inUse: false,
      checkedAt,
    },
    bindEvidence,
    bindAddressObservation,
  };
}

function buildManifest(raw: unknown, root: string, requireFreshPortObservation: boolean): Prepared {
  const input = object(raw, "Vaultwarden local-HTTPS input");
  exact(input, ["schemaVersion", "project", "observed", "caddyImage", "portObservation"],
    ["hostname", "httpsPort", "bindAddress", "dnsOwner", "bindAddressObservation", "routeSubnet", "ingressSubnet"], "Vaultwarden local-HTTPS input");
  if (input.schemaVersion !== 1) {
    fail("Vaultwarden local-HTTPS input schemaVersion must be 1");
  }
  const project = object(input.project, "project");
  exact(project, ["dockerContext", "id", "owner", "root", "directory", "ownership"], [], "project");
  if (project.root !== root || project.directory !== join(root, project.id)) {
    fail("Vaultwarden local-HTTPS project must own one exact directory below --project-root");
  }
  if (project.ownership !== "new" && project.ownership !== "verified-existing") {
    fail("Vaultwarden local-HTTPS project ownership is invalid");
  }
  if (typeof input.caddyImage !== "string" || !CADDY_IMAGE.test(input.caddyImage)) {
    fail("caddyImage must be an official version-tagged Caddy 2 image with an immutable sha256 digest");
  }
  const hostname = input.hostname ?? "vaultwarden.localhost";
  if (typeof hostname !== "string" || hostname !== hostname.toLowerCase() || !supportedHostname(hostname)) {
    fail("hostname must be localhost, a name below .localhost, or a private DNS name below .home.arpa");
  }
  const httpsPort = input.httpsPort ?? 28443;
  if (!Number.isInteger(httpsPort) || httpsPort < 1024 || httpsPort > 65535 || httpsPort === 80 || httpsPort === 443) {
    fail("httpsPort must be an unprivileged high port and must not be 80 or 443");
  }
  const bindAddress = input.bindAddress ?? "127.0.0.1";
  if (typeof bindAddress !== "string" || isIP(bindAddress) !== 4) {
    fail("bindAddress must be an exact IPv4 address");
  }
  let dnsOwner: string | null = null;
  if (Object.hasOwn(input, "dnsOwner")) {
    if (typeof input.dnsOwner !== "string" || !DNS_OWNER.test(input.dnsOwner)) {
      fail("dnsOwner must be a bounded lowercase owner identifier");
    }
    dnsOwner = input.dnsOwner;
  }
  const accessScope = routeAccess(hostname, bindAddress, dnsOwner);
  const observed = object(input.observed, "observed");
  if (accessScope === "private-network") {
    if (!input.bindAddressObservation) {
      fail("private network route input lacks the exact observed bind-address evidence");
    }
    const candidate = object(input.bindAddressObservation, "bindAddressObservation");
    exact(candidate, ["address", "interface", "prefixLength"], [], "bindAddressObservation");
    if (candidate.address !== bindAddress || typeof candidate.interface !== "string"
      || candidate.interface.length === 0 || (candidate.prefixLength !== null
        && (!Number.isInteger(candidate.prefixLength) || (candidate.prefixLength as number) < 0
          || (candidate.prefixLength as number) > 32))) {
      fail("private network route input lacks the exact observed bind-address evidence");
    }
  }
  const portObservation = object(input.portObservation, "portObservation");
  exact(portObservation, ["hostIp", "port", "protocol", "inUse", "checkedAt"], [], "portObservation");
  if (portObservation.hostIp !== bindAddress || portObservation.port !== httpsPort
    || portObservation.protocol !== "tcp" || portObservation.inUse !== false
    || typeof portObservation.checkedAt !== "string" || Number.isNaN(Date.parse(portObservation.checkedAt))) {
    fail("portObservation must record the selected exact-bind TCP port as unused");
  }
  const observationAge = Date.now() - Date.parse(portObservation.checkedAt);
  if (requireFreshPortObservation && (observationAge < -60_000 || observationAge > 60 * 60 * 1000)) {
    fail("portObservation must be refreshed within one hour before plan or apply");
  }

  const directory = project.directory as string;
  const owner = project.owner as string;
  const ownership = project.ownership as "new" | "verified-existing";
  let routeSubnet: string | undefined;
  let ingressSubnet: string | undefined;
  if (Object.hasOwn(input, "routeSubnet") || Object.hasOwn(input, "ingressSubnet")) {
    if (ownership !== "new") {
      fail("route subnets are valid only for new project-owned networks");
    }
  }
  if (Object.hasOwn(input, "routeSubnet")) {
    routeSubnet = parsePrivateNetworkSubnet(input.routeSubnet);
  }
  if (Object.hasOwn(input, "ingressSubnet")) {
    ingressSubnet = parsePrivateNetworkSubnet(input.ingressSubnet);
  }
  const networkName = `${project.id}-private`;
  const caddyfilePath = join(directory, "Caddyfile");
  const configPath = join(directory, "config");
  const dataPath = join(directory, "data");
  const origin = `https://${hostname}:${httpsPort}`;
  const caddyfile = `{
\tadmin off
\tauto_https disable_redirects
\tskip_install_trust
}

https://${hostname}:${httpsPort} {
\ttls internal
\treverse_proxy vaultwarden:8080
}
`;
  const mount = (source: string, target: string, readOnly: boolean) => ({
    source,
    target,
    readOnly,
    shared: readOnly,
    owner,
    ownership,
  });
  const privateNetwork: JsonObject = {
    id: "private",
    name: networkName,
    driver: "bridge",
    internal: true,
    owner,
    ownership,
  };
  if (routeSubnet !== undefined) {
    privateNetwork.subnet = routeSubnet;
  }
  const ingressNetwork: JsonObject = {
    id: "ingress",
    name: `${project.id}-ingress`,
    driver: "bridge",
    internal: false,
    owner,
    ownership,
  };
  if (ingressSubnet !== undefined) {
    ingressNetwork.subnet = ingressSubnet;
  }
  const manifest = {
    schemaVersion: 1,
    project,
    services: [{
      id: "caddy",
      image: input.caddyImage,
      restart: "unless-stopped",
      readOnly: true,
      user: "image-default",
      imageUserEvidence: {
        officialUrl: "https://github.com/caddyserver/caddy-docker/blob/master/Dockerfile.tmpl",
        reason: "upstream-init-requires-default-user",
      },
      environment: [],
      ports: [{
        hostIp: bindAddress,
        published: httpsPort,
        target: httpsPort,
        protocol: "tcp",
        purpose: "application",
        publicApproved: false,
      }],
      mounts: [
        mount(caddyfilePath, "/etc/caddy/Caddyfile", true),
        mount(configPath, "/config", false),
        mount(dataPath, "/data", false),
      ],
      // Rootless Docker does not publish ports from a container attached only
      // to an internal network. Keep the upstream isolated and give Caddy a
      // separate bridge for its loopback-bound host listener.
      networks: ["private", "ingress"],
      secretRefs: [],
    }],
    networks: [privateNetwork, ingressNetwork],
    observed: input.observed,
  };
  return {
    manifest,
    origin,
    hostname,
    httpsPort,
    bindAddress,
    dnsOwner,
    accessScope,
    caddyfile,
    caddyfilePath,
    configPath,
    dataPath,
    caSourcePath: join(dataPath, "caddy", "pki", "authorities", "local", "root.crt"),
    directory,
    projectId: project.id,
    network: { id: "vaultwarden-route", name: networkName, owner },
    portObservation,
  };
}

async function writePrivate(path: string, value: string | Uint8Array): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDirectory(path: string, name: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { mode: 0o700 });
  }
  await ownedDirectory(path, name, true);
}

async function ensureExactFile(path: string, value: string, name: string): Promise<void> {
  if (!existsSync(path)) {
    await writePrivate(path, value);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || await realpath(path) !== path) {
    fail(`${name} must be an owner-only regular file`);
  }
  assertOwner(metadata, name);
  const current = Buffer.from(await readFile(path));
  const expected = Buffer.from(value);
  if (current.length !== expected.length || !timingSafeEqual(current, expected)) {
    fail(`${name} differs from the approved route`);
  }
}

async function ensureStateRoot(root: string): Promise<void> {
  const state = join(root, ".selfhost");
  await ensureDirectory(state, ".selfhost directory");
  await ensureExactFile(join(state, ".gitignore"), "*\n", ".selfhost ignore guard");
}

async function readCaRoot(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 128 || metadata.size > MAX_PRIVATE || await realpath(path) !== path) {
    fail("Caddy local CA root is not a bounded regular file");
  }
  const value = Buffer.from(await readFile(path));
  const text = value.toString("ascii");
  if (!text.includes("-----BEGIN CERTIFICATE-----") || !text.includes("-----END CERTIFICATE-----")) {
    fail("Caddy local CA root is not a PEM certificate");
  }
  return value;
}

async function exportCaRoot(source: string, destination: string): Promise<string> {
  const value = await readCaRoot(source);
  if (!existsSync(destination)) {
    await writePrivate(destination, value);
  }
  const exported = Buffer.from(await readFile(destination));
  if (value.length !== exported.length || !timingSafeEqual(value, exported)) {
    fail("exported Caddy local CA root differs from persistent Caddy state");
  }
  return createHash("sha256").update(exported).digest("hex");
}

function curlAvailable(): boolean {
  const result = spawnSync("curl", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

async function assertLivePortAvailable(bindAddress: string, port: number): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", () => rejectPromise(new Error(`TCP port ${port} is unavailable on ${bindAddress}; refresh host inspection and choose another exact bind`)));
    server.listen({ host: bindAddress, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) {
          rejectPromise(new Error(`TCP port ${port} on ${bindAddress} could not be released after the apply preflight`));
          return;
        }
        resolvePromise();
      });
    });
  });
}

function curlProof(prepared: Prepared, caExportPath: string): { verified: boolean; httpStatus: number | null } {
  const result = spawnSync("curl", [
    "--cacert", caExportPath,
    "--resolve", `${prepared.hostname}:${prepared.httpsPort}:${prepared.bindAddress}`,
    "--noproxy", "*",
    "--silent",
    "--show-error",
    "--output", "/dev/null",
    "--write-out", "%{http_code}",
    "--connect-timeout", "3",
    "--max-time", "10",
    `${prepared.origin}/`,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const status = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isInteger(status) || status < 100 || status > 599) {
    return { verified: false, httpStatus: null };
  }
  return { verified: true, httpStatus: status };
}

async function proofAfterApply(prepared: Prepared, caExportPath: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (existsSync(prepared.caSourcePath)) {
      const caSha256 = await exportCaRoot(prepared.caSourcePath, caExportPath);
      const proof = curlProof(prepared, caExportPath);
      if (proof.verified) {
        return { ...proof, caSha256 };
      }
    }
    if (attempt < 29) {
      await delay(1000);
    }
  }
  fail("Caddy did not produce a verifiable local-CA TLS endpoint within 30 seconds");
}

async function intendedNameResolution(hostname: string, bindAddress: string): Promise<{
  hostObserved: boolean;
  loopbackOnly: boolean;
  bindAddressMatched: boolean;
}> {
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const loopbackOnly = addresses.length > 0 && addresses.every((entry) => entry.address === "127.0.0.1" || entry.address === "::1");
    const bindAddressMatched = addresses.some((entry) => entry.address === bindAddress);
    return { hostObserved: addresses.length > 0, loopbackOnly, bindAddressMatched };
  } catch {
    return { hostObserved: false, loopbackOnly: false, bindAddressMatched: false };
  }
}

function checkpointValid(raw: unknown, expected: {
  project: string;
  runId: string;
  directory: string;
  caExportPath: string;
}): Checkpoint {
  const value = object(raw, "Vaultwarden local-HTTPS checkpoint");
  exact(value, ["schemaVersion", "kind", "project", "runId", "approvalDigest", "composeFile", "caExportPath", "caSha256", "appliedAt", "transportProof"], [], "Vaultwarden local-HTTPS checkpoint");
  const proof = object(value.transportProof, "transportProof");
  exact(proof, ["method", "verified", "httpStatus", "verifiedAt"], [], "transportProof");
  const composePrefix = `${expected.directory}/compose.`;
  if (value.schemaVersion !== 1 || value.kind !== "vaultwarden-local-https-checkpoint"
    || value.project !== expected.project || value.runId !== expected.runId
    || !DIGEST.test(value.approvalDigest) || !DIGEST.test(value.caSha256)
    || typeof value.composeFile !== "string" || !value.composeFile.startsWith(composePrefix)
    || !/^[0-9a-f]{16}\.yaml$/.test(value.composeFile.slice(composePrefix.length))
    || value.caExportPath !== expected.caExportPath
    || typeof value.appliedAt !== "string" || Number.isNaN(Date.parse(value.appliedAt))
    || proof.method !== "curl-cacert-resolve" || typeof proof.verified !== "boolean"
    || (proof.httpStatus !== null && (!Number.isInteger(proof.httpStatus) || proof.httpStatus < 100 || proof.httpStatus > 599))
    || typeof proof.verifiedAt !== "string" || Number.isNaN(Date.parse(proof.verifiedAt))) {
    fail("Vaultwarden local-HTTPS checkpoint is invalid or belongs to another route");
  }
  return value as Checkpoint;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function verificationGates(prepared: Prepared) {
  const privateDnsRequired = prepared.accessScope === "private-network";
  let expectedAddress: string | null = null;
  if (privateDnsRequired) {
    expectedAddress = prepared.bindAddress;
  }
  return {
    privateDns: {
      required: privateDnsRequired,
      hostname: prepared.hostname,
      owner: prepared.dnsOwner,
      expectedAddress,
      verified: false,
      scope: "must-be-verified-from-each-intended-client",
    },
    intendedClientCaTrust: {
      required: true,
      verified: false,
      scope: "must-be-verified-in-each-intended-client-trust-store",
    },
  };
}

function planFacts(prepared: Prepared, composePlan: JsonObject, runId: string) {
  return {
    schemaVersion: 1,
    kind: "vaultwarden-local-https-plan",
    runId,
    origin: prepared.origin,
    manifest: prepared.manifest,
    composePlan,
    caddyfileSha256: hash(prepared.caddyfile),
    portObservation: prepared.portObservation,
    integrationNetwork: prepared.network,
    access: {
      scope: prepared.accessScope,
      bindAddress: prepared.bindAddress,
      bindingOwner: "compose-published-port",
      public: false,
    },
    verificationGates: verificationGates(prepared),
    upstream: { service: "vaultwarden", port: 8080 },
    proofScope: {
      transport: "curl --cacert with an explicit --resolve mapping",
      privateDns: "not-proven-by-transport-check",
      intendedClientTrust: "not-proven-by-transport-check",
      application: "not-proven-by-transport-check",
    },
  };
}

async function initializeLocalHttps(options: Options, root: string): Promise<void> {
  const httpsPort = initHttpsPort(options.httpsPort);
  const hostname = initHostname(options.hostname);
  const bindAddress = initBindAddress(options.bindAddress);
  const dnsOwner = initDnsOwner(options.dnsOwner);
  let routeSubnet: string | undefined;
  let ingressSubnet: string | undefined;
  if (options.routeSubnet !== "") {
    routeSubnet = parsePrivateNetworkSubnet(options.routeSubnet);
  }
  if (options.ingressSubnet !== "") {
    ingressSubnet = parsePrivateNetworkSubnet(options.ingressSubnet);
  }
  routeAccess(hostname, bindAddress, dnsOwner);
  const projectId = options.runId;
  const inspection = await hostInspectionInput(root, options.hostInspection, httpsPort, projectId, bindAddress);
  const routeInput: JsonObject = {
    schemaVersion: 1,
    project: {
      dockerContext: inspection.dockerContext,
      id: projectId,
      owner: projectId,
      root,
      directory: join(root, projectId),
      ownership: "new",
    },
    observed: inspection.observed,
    caddyImage: options.caddyImage,
    hostname,
    httpsPort,
    bindAddress,
    portObservation: inspection.portObservation,
  };
  if (inspection.bindAddressObservation !== null) {
    routeInput.bindAddressObservation = inspection.bindAddressObservation;
  }
  if (dnsOwner !== null) {
    routeInput.dnsOwner = dnsOwner;
  }
  if (routeSubnet !== undefined) {
    routeInput.routeSubnet = routeSubnet;
  }
  if (ingressSubnet !== undefined) {
    routeInput.ingressSubnet = ingressSubnet;
  }
  const prepared = buildManifest(routeInput, root, true);
  await createSelfhostComposeOwner(prepared.manifest).plan();

  const stateDirectory = join(root, ".selfhost", "vaultwarden", "local-https", options.runId);
  const inputPath = join(stateDirectory, "route-input.json");
  if (existsSync(inputPath)) {
    fail(`Vaultwarden local-HTTPS input already exists at ${inputPath}`);
  }
  await ensureStateRoot(root);
  await ensureDirectory(join(root, ".selfhost", "vaultwarden"), "Vaultwarden CLI state");
  await ensureDirectory(join(root, ".selfhost", "vaultwarden", "local-https"), "Vaultwarden local-HTTPS state");
  await ensureDirectory(stateDirectory, "Vaultwarden local-HTTPS run state");
  await writePrivate(inputPath, `${JSON.stringify(routeInput, null, 2)}\n`);
  print({
    schemaVersion: 1,
    kind: "vaultwarden-local-https-init",
    status: "created",
    mutation: "owner-only-route-input",
    input: inputPath,
    runId: options.runId,
    origin: prepared.origin,
    project: prepared.projectId,
    integrationNetwork: prepared.network,
    hostInspection: {
      dockerContext: inspection.dockerContext,
      selectedPortObservedFree: httpsPort,
      bindAddressObserved: bindAddress,
      bindAddressEvidence: inspection.bindEvidence,
      observedNetworks: inspection.observed.networks.length,
    },
    next: `self-host vaultwarden local-https plan --project-root ${root} --run-id ${options.runId} --input ${inputPath}`,
    limits: [
      "No Docker command was run and no route was applied.",
      "The selected port is still re-probed immediately before first apply.",
      "The hostname remains a candidate until name resolution is verified on the intended client.",
    ],
  });
}

export async function vaultwardenLocalHttpsCommand(args: string[]): Promise<void> {
  const options = parse(args);
  const root = await validateProjectRoot(options.projectRoot);
  if (options.action === "init") {
    await initializeLocalHttps(options, root);
    return;
  }
  if (!inside(root, options.input)) {
    fail("--input must stay inside the selected project root");
  }
  const input = await readJson(options.input, MAX_INPUT, false, "Vaultwarden local-HTTPS input");
  const prepared = buildManifest(input, root, options.action === "plan" || options.action === "apply");
  const compose = createSelfhostComposeOwner(prepared.manifest);
  const composePlan = await compose.plan();
  const facts = planFacts(prepared, composePlan, options.runId);
  const digest = hash(facts);
  const approval = `APPLY:${prepared.projectId}:${digest}`;
  const stateDirectory = join(root, ".selfhost", "vaultwarden", "local-https", options.runId);
  const statePath = join(stateDirectory, "state.json");
  const caExportPath = join(stateDirectory, "caddy-local-root.crt");
  const checkpointIdentity = {
    project: prepared.projectId,
    runId: options.runId,
    directory: prepared.directory,
    caExportPath,
  };

  if (options.action === "plan") {
    let accessLimit = "The loopback route is not reachable from another device.";
    if (prepared.accessScope === "private-network") {
      accessLimit = "The route is published only on the exact observed private address; firewall reachability is not verified.";
    }
    const limits = [
      accessLimit,
      "Before Vaultwarden joins the reported integration network, an HTTP 502 response is expected and is not application failure evidence.",
      "Apply exports Caddy's CA and proves only the TLS endpoint with curl --cacert and --resolve; it does not configure or prove DNS or browser/client trust.",
    ];
    print({
      ...facts,
      status: "pass",
      mutation: false,
      approval,
      caExportPath,
      defaults: { hostname: "vaultwarden.localhost", httpsPort: 28443, bindAddress: "127.0.0.1" },
      next: `Review the exact route plan, then apply with --approve ${approval}`,
      limits,
    });
    return;
  }

  if (options.action === "status") {
    let checkpoint: Checkpoint | null = null;
    if (existsSync(statePath)) {
      checkpoint = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Vaultwarden local-HTTPS state"), checkpointIdentity);
    }
    let liveTransport = { verified: false, httpStatus: null as number | null };
    let caStateMatches: boolean | null = null;
    if (checkpoint && existsSync(caExportPath)) {
      liveTransport = curlProof(prepared, caExportPath);
      if (existsSync(prepared.caSourcePath)) {
        const currentCa = await readCaRoot(prepared.caSourcePath);
        caStateMatches = createHash("sha256").update(currentCa).digest("hex") === checkpoint.caSha256;
      }
    }
    const resolution = await intendedNameResolution(prepared.hostname, prepared.bindAddress);
    let reportedCaExportPath: string | null = null;
    if (checkpoint) {
      reportedCaExportPath = caExportPath;
    }
    print({
      schemaVersion: 1,
      kind: "vaultwarden-local-https-status",
      project: prepared.projectId,
      runId: options.runId,
      origin: prepared.origin,
      integrationNetwork: prepared.network,
      access: facts.access,
      verificationGates: verificationGates(prepared),
      applied: checkpoint !== null,
      checkpoint,
      liveTransport: { ...liveTransport, scope: "curl-cacert-resolve-only" },
      persistentCaMatchesExport: caStateMatches,
      nameResolution: {
        hostObserved: resolution.hostObserved,
        loopbackOnly: resolution.loopbackOnly,
        bindAddressMatched: resolution.bindAddressMatched,
        dnsOwner: prepared.dnsOwner,
        intendedClientVerified: false,
      },
      clientCertificateTrust: {
        verified: false,
        scope: "must-be-verified-on-each-intended-client",
        caExportPath: reportedCaExportPath,
      },
      applicationAcceptance: "not-verified-by-route-cli",
    });
    return;
  }

  if (options.action === "up" || options.action === "down" || options.action === "lifecycle-check") {
    if (!existsSync(statePath)) fail("Vaultwarden local-HTTPS lifecycle needs the applied route checkpoint");
    const checkpoint = checkpointValid(
      await readJson(statePath, MAX_PRIVATE, true, "Vaultwarden local-HTTPS state"),
      checkpointIdentity,
    );
    if (checkpoint.approvalDigest !== digest || checkpoint.composeFile !== composePlan.render.target) {
      fail("Vaultwarden local-HTTPS checkpoint does not match the current exact route plan");
    }
    if (!existsSync(checkpoint.composeFile)) fail("The exact applied Caddy Compose file is missing");
    if (options.action === "lifecycle-check") await compose.preflight(composePlan);
    else if (options.action === "up") await compose.apply(composePlan);
    else await compose.stop(composePlan);
    print({ schemaVersion: 1, kind: "vaultwarden-local-https-bundle-lifecycle", action: options.action,
      project: prepared.projectId, runId: options.runId, origin: prepared.origin,
      integrationNetwork: prepared.network, composeFile: checkpoint.composeFile,
      volumesDeleted: false, applicationAcceptance: "not-verified-by-route-cli" });
    return;
  }

  if (options.approval !== approval) {
    fail("Vaultwarden local-HTTPS apply requires the exact approval token from the unchanged plan");
  }
  if (!curlAvailable()) {
    fail("curl is required before apply so the local CA transport proof can be recorded");
  }
  let prior: Checkpoint | null = null;
  if (existsSync(statePath)) {
    prior = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Vaultwarden local-HTTPS state"), checkpointIdentity);
    if (prior.approvalDigest !== digest || prior.composeFile !== composePlan.render.target) {
      fail("Existing Vaultwarden local-HTTPS checkpoint belongs to another plan");
    }
  }
  if (!prior) {
    await assertLivePortAvailable(prepared.bindAddress, prepared.httpsPort);
  }
  if (prepared.manifest.project.ownership === "verified-existing") {
    const claimed = [prepared.directory, prepared.caddyfilePath, prepared.configPath, prepared.dataPath];
    if (claimed.some((path) => !existsSync(path))) {
      fail("Verified-existing Caddy resources are missing; inspect ownership and plan a separate adoption");
    }
  }
  await ensureStateRoot(root);
  await ensureDirectory(join(root, ".selfhost", "vaultwarden"), "Vaultwarden CLI state");
  await ensureDirectory(join(root, ".selfhost", "vaultwarden", "local-https"), "Vaultwarden local-HTTPS state");
  await ensureDirectory(stateDirectory, "Vaultwarden local-HTTPS run state");
  await compose.render(composePlan);
  await ensureExactFile(prepared.caddyfilePath, prepared.caddyfile, "approved Caddyfile");
  await ensureDirectory(prepared.configPath, "Caddy config directory");
  await ensureDirectory(prepared.dataPath, "Caddy data directory");
  await compose.apply(composePlan);
  const proof = await proofAfterApply(prepared, caExportPath);
  const now = new Date().toISOString();
  const checkpoint: Checkpoint = {
    schemaVersion: 1,
    kind: "vaultwarden-local-https-checkpoint",
    project: prepared.projectId,
    runId: options.runId,
    approvalDigest: digest,
    composeFile: composePlan.render.target,
    caExportPath,
    caSha256: proof.caSha256,
    appliedAt: now,
    transportProof: {
      method: "curl-cacert-resolve",
      verified: proof.verified,
      httpStatus: proof.httpStatus,
      verifiedAt: now,
    },
  };
  if (!existsSync(statePath)) {
    await writePrivate(statePath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  } else {
    const temporary = join(stateDirectory, `state.${process.pid}.${Date.now()}.tmp`);
    await writePrivate(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`);
    await rename(temporary, statePath);
  }
  const resolution = await intendedNameResolution(prepared.hostname, prepared.bindAddress);
  print({
    schemaVersion: 1,
    kind: "vaultwarden-local-https-apply",
    status: "applied-transport-only",
    project: prepared.projectId,
    runId: options.runId,
    origin: prepared.origin,
    access: facts.access,
    verificationGates: verificationGates(prepared),
    composeFile: composePlan.render.target,
    integrationNetwork: prepared.network,
    caExportPath,
    transportProof: checkpoint.transportProof,
    nameResolution: {
      hostObserved: resolution.hostObserved,
      loopbackOnly: resolution.loopbackOnly,
      bindAddressMatched: resolution.bindAddressMatched,
      dnsOwner: prepared.dnsOwner,
      intendedClientVerified: false,
    },
    clientCertificateTrust: {
      verified: false,
      scope: "must-be-verified-on-each-intended-client",
    },
    applicationAcceptance: "not-verified-by-route-cli",
    next: "Configure the chosen name on the intended client, install the exported CA root in that client's trust store, verify the origin without a TLS bypass, then let Vaultwarden join the reported integration network.",
  });
}
