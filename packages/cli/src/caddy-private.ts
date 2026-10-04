import { createHash, timingSafeEqual } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer, isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { renderCaddyfile } from "../../../.agents/skills/self-host/workflows/selfhost-ingress/scripts/render-caddyfile.ts";
import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { parsePrivateNetworkSubnet } from "./private-network-subnet.ts";

type JsonObject = Record<string, any>;
type Action = "plan" | "apply" | "status" | "up" | "down";
type Options = {
  action: Action;
  projectRoot: string;
  input: string;
  checkpoint: string;
  approval: string;
};

type Route = {
  planPath: string;
  planSha256: string;
  network: string;
  service: string;
  hostname: string;
  origin: string;
  upstreamHost: string;
  upstreamPort: number;
  applicationRequirements: string[];
};

type Prepared = {
  manifest: JsonObject;
  projectId: string;
  projectOwner: string;
  directory: string;
  ownership: "new" | "verified-existing";
  bindAddress: string;
  httpsPort: number;
  configPath: string;
  dataPath: string;
  caddyfilePath: string;
  caSourcePath: string;
  caddyfile: string;
  routes: Route[];
  networks: Array<{ id: string; name: string; owner: string; internal: boolean; ownership: "new" | "verified-existing"; subnet?: string }>;
  portObservation: JsonObject;
};

type TransportProof = {
  hostname: string;
  origin: string;
  method: "curl-cacert-resolve";
  verified: boolean;
  httpStatus: number | null;
  verifiedAt: string;
};

type CheckpointPhase = "prepared" | "compose-started" | "verified" | "stopped";
type CheckpointRoute = {
  hostname: string;
  origin: string;
};

type Checkpoint = {
  schemaVersion: 3;
  kind: "shared-private-caddy-checkpoint";
  project: string;
  inputPath: string;
  approvalDigest: string;
  manifest: JsonObject;
  composeFile: string;
  caddyfilePath: string;
  caddyfileSha256: string;
  configPath: string;
  dataPath: string;
  caSourcePath: string;
  caExportPath: string;
  bindAddress: string;
  httpsPort: number;
  routes: CheckpointRoute[];
  phase: CheckpointPhase;
  caSha256: string | null;
  updatedAt: string;
  transportProofs: TransportProof[];
};

type CaddyPrivateRuntime = {
  portAvailable?: (bindAddress: string, port: number) => Promise<void>;
  composeApply?: (manifest: JsonObject, composePlan: JsonObject) => Promise<void>;
  composeStop?: (manifest: JsonObject, composePlan: JsonObject) => Promise<void>;
  proofAfterApply?: (checkpoint: Checkpoint) => Promise<{ caSha256: string; transportProofs: TransportProof[] }>;
  curlAvailable?: () => boolean;
};

const MAX_INPUT = 256 * 1024;
const MAX_PRIVATE = 64 * 1024;
const MAX_ROUTES = 100;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/;
const CADDY_IMAGE = /^docker\.io\/library\/caddy:2\.[0-9]+\.[0-9]+(?:-alpine)?@sha256:[0-9a-f]{64}$/;
const DIGEST = /^[0-9a-f]{64}$/;

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

function contentHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
  if (action !== "plan" && action !== "apply" && action !== "status" && action !== "up" && action !== "down") {
    fail("Use caddy-private plan, apply, status, up, or down");
  }
  const flags: Record<string, string> = {};
  const allowed = new Set(["--project-root", "--input", "--checkpoint", "--approve"]);
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key) || flags[key] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated private-Caddy option: ${key ?? "(missing)"}`);
    }
    flags[key] = value;
  }
  if (!flags["--project-root"]) {
    fail(`caddy-private ${action} needs --project-root`);
  }
  if ((action === "plan" || action === "apply") && !flags["--input"]) {
    fail(`caddy-private ${action} needs --input`);
  }
  if ((action === "plan" || action === "apply") && flags["--checkpoint"]) {
    fail(`caddy-private ${action} does not accept --checkpoint`);
  }
  if ((action === "status" || action === "up" || action === "down")
    && !flags["--input"] && !flags["--checkpoint"]) {
    fail(`caddy-private ${action} needs --input or --checkpoint`);
  }
  if (flags["--checkpoint"]) {
    requireLabel(flags["--checkpoint"], "checkpoint id");
  }
  if ((action === "apply" || action === "up" || action === "down") && !flags["--approve"]) {
    fail(`caddy-private ${action} needs the exact --approve token from plan or status`);
  }
  if (action !== "apply" && action !== "up" && action !== "down" && flags["--approve"]) {
    fail(`caddy-private ${action} does not accept --approve`);
  }
  let approval = "";
  if (flags["--approve"]) {
    approval = flags["--approve"];
  }
  return {
    action,
    projectRoot: flags["--project-root"],
    input: flags["--input"] ?? "",
    checkpoint: flags["--checkpoint"] ?? "",
    approval,
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
  if (!privateMode && (metadata.mode & 0o002) !== 0) {
    fail(`${name} must not be world-writable`);
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function privateBind(value: string): boolean {
  if (value === "127.0.0.1" || value === "::1") {
    return true;
  }
  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    return parts[0] === 10
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  if (isIP(value) === 6) {
    return value.toLowerCase().startsWith("fc") || value.toLowerCase().startsWith("fd");
  }
  return false;
}

function requireLabel(value: unknown, name: string): string {
  if (typeof value !== "string" || !LABEL.test(value)) {
    fail(`${name} must be a bounded identifier`);
  }
  return value;
}

function normalizeNetwork(value: unknown): { id: string; name: string; owner: string; internal: boolean; ownership: "new" | "verified-existing"; subnet?: string } {
  const network = object(value, "upstream network");
  exact(network, ["id", "name", "owner", "internal"], ["ownership", "subnet"], "upstream network");
  if (typeof network.internal !== "boolean") {
    fail("upstream network internal must be boolean");
  }
  const ownership = network.ownership ?? "verified-existing";
  if (ownership !== "new" && ownership !== "verified-existing") {
    fail("upstream network ownership must be new or verified-existing");
  }
  const normalized: { id: string; name: string; owner: string; internal: boolean; ownership: "new" | "verified-existing"; subnet?: string } = {
    id: requireLabel(network.id, "upstream network id"),
    name: requireLabel(network.name, "upstream network name"),
    owner: requireLabel(network.owner, "upstream network owner"),
    internal: network.internal,
    ownership,
  };
  if (Object.hasOwn(network, "subnet")) {
    if (ownership !== "new") {
      fail("upstream network subnet is valid only for a new Caddy-owned network");
    }
    normalized.subnet = parsePrivateNetworkSubnet(network.subnet);
  }
  return normalized;
}

async function loadPlans(inputRoutes: unknown, root: string, networkIds: Set<string>): Promise<{
  plans: JsonObject[];
  routes: Route[];
}> {
  if (!Array.isArray(inputRoutes) || inputRoutes.length === 0 || inputRoutes.length > MAX_ROUTES) {
    fail("routes must contain 1 to 100 private-Caddy plan references");
  }
  const plans: JsonObject[] = [];
  const routes: Route[] = [];
  const paths = new Set<string>();
  for (const rawRoute of inputRoutes) {
    const inputRoute = object(rawRoute, "route reference");
    exact(inputRoute, ["planPath", "network"], [], "route reference");
    if (typeof inputRoute.planPath !== "string" || !isAbsolute(inputRoute.planPath)
      || resolve(inputRoute.planPath) !== inputRoute.planPath || !inside(root, inputRoute.planPath)) {
      fail("route planPath must be an exact absolute path inside --project-root");
    }
    if (paths.has(inputRoute.planPath)) {
      fail("route plan paths must be unique");
    }
    paths.add(inputRoute.planPath);
    const network = requireLabel(inputRoute.network, "route network");
    if (!networkIds.has(network)) {
      fail("each route must reference one declared upstream network");
    }
    const plan = object(await readJson(inputRoute.planPath, MAX_INPUT, false, "private-Caddy route plan"), "private-Caddy route plan");
    plans.push(plan);
    const route = object(plan.route, "private-Caddy plan route");
    const caddy = object(route.caddy, "private-Caddy plan route.caddy");
    const service = object(plan.service, "private-Caddy plan service");
    if (typeof caddy.hostname !== "string" || typeof caddy.privateUrl !== "string"
      || typeof caddy.upstreamHost !== "string" || !Number.isInteger(caddy.upstreamPort)
      || typeof service.id !== "string" || !Array.isArray(route.applicationRequirements)
      || route.applicationRequirements.some((item: unknown) => typeof item !== "string")) {
      fail("private-Caddy route plan has invalid route metadata");
    }
    routes.push({
      planPath: inputRoute.planPath,
      planSha256: hash(plan),
      network,
      service: service.id,
      hostname: caddy.hostname,
      origin: caddy.privateUrl,
      upstreamHost: caddy.upstreamHost,
      upstreamPort: caddy.upstreamPort,
      applicationRequirements: [...route.applicationRequirements],
    });
  }
  return { plans, routes };
}

async function prepare(raw: unknown, root: string, requireFreshPort: boolean): Promise<Prepared> {
  const input = object(raw, "shared private-Caddy input");
  exact(input, ["schemaVersion", "project", "caddyImage", "routes", "upstreamNetworks", "observed", "portObservation"], ["ingressSubnet"], "shared private-Caddy input");
  if (input.schemaVersion !== 1) {
    fail("shared private-Caddy input schemaVersion must be 1");
  }
  if (typeof input.caddyImage !== "string" || !CADDY_IMAGE.test(input.caddyImage)) {
    fail("caddyImage must be an official version-tagged Caddy 2 image with an immutable sha256 digest");
  }

  const project = object(input.project, "project");
  exact(project, ["dockerContext", "id", "owner", "root", "directory", "ownership"], [], "project");
  const projectId = requireLabel(project.id, "project id");
  const projectOwner = requireLabel(project.owner, "project owner");
  if (project.root !== root || project.directory !== join(root, projectId)) {
    fail("shared private-Caddy project must own one exact directory below --project-root");
  }
  if (project.ownership !== "new" && project.ownership !== "verified-existing") {
    fail("shared private-Caddy project ownership is invalid");
  }
  if (typeof project.dockerContext !== "string" || project.dockerContext === "") {
    fail("shared private-Caddy project needs one explicit Docker context");
  }

  if (!Array.isArray(input.upstreamNetworks) || input.upstreamNetworks.length === 0
    || input.upstreamNetworks.length > MAX_ROUTES) {
    fail("upstreamNetworks must contain 1 to 100 networks");
  }
  const networks = input.upstreamNetworks.map(normalizeNetwork);
  networks.sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(networks.map((network) => network.id)).size !== networks.length
    || new Set(networks.map((network) => network.name)).size !== networks.length) {
    fail("upstream network IDs and names must be unique");
  }
  for (const network of networks) {
    if (network.ownership === "new" && (network.owner !== projectId || !network.internal
      || network.name !== `${projectId}-${network.id}`)) {
      fail("a new upstream network must be an internal bridge named <caddy-project>-<network-id> and owned by this Caddy project");
    }
  }
  if (networks.some((network) => network.id === "ingress" || network.name === `${projectId}-ingress`)) {
    fail("upstream networks must not collide with the Caddy ingress network");
  }
  const networkIds = new Set(networks.map((network) => network.id));
  const loaded = await loadPlans(input.routes, root, networkIds);
  const caddyfile = renderCaddyfile(structuredClone(loaded.plans));
  const plansByHostname = new Map(loaded.plans.map((plan) => [plan.route.caddy.hostname, plan]));
  loaded.routes.sort((left, right) => left.hostname.localeCompare(right.hostname));
  const usedNetworks = new Set(loaded.routes.map((route) => route.network));
  if (networks.some((network) => !usedNetworks.has(network.id))) {
    fail("every declared upstream network must be used by at least one route");
  }

  const firstPlan = plansByHostname.get(loaded.routes[0].hostname) as JsonObject;
  const firstRoute = object(firstPlan.route, "private-Caddy plan route");
  const firstCaddy = object(firstRoute.caddy, "private-Caddy plan route.caddy");
  if (firstCaddy.runtime !== "container" || firstCaddy.composePublishAddress !== firstCaddy.hostBindAddress) {
    fail("shared private-Caddy supports only container Caddy plans with an exact Compose publish address");
  }
  if (firstRoute.owner !== projectOwner) {
    fail("shared private-Caddy project owner must match the private ingress plan owner");
  }
  const bindAddress = firstCaddy.hostBindAddress;
  const httpsPort = firstCaddy.httpsPort;
  if (typeof bindAddress !== "string" || !privateBind(bindAddress)) {
    fail("shared private-Caddy bind must be loopback or one exact RFC1918/ULA address");
  }
  if (!Number.isInteger(httpsPort) || httpsPort < 1024 || httpsPort > 65535 || httpsPort === 80 || httpsPort === 443) {
    fail("shared private-Caddy requires one unprivileged high HTTPS port, not 80 or 443");
  }
  const directory = project.directory as string;
  const configPath = firstCaddy.configPath;
  const dataPath = firstCaddy.dataPath;
  if (configPath !== join(directory, "config") || dataPath !== join(directory, "data")) {
    fail("private ingress plans must use the shared Caddy project config and data directories");
  }
  const caddyfilePath = join(directory, "Caddyfile");

  const portObservation = object(input.portObservation, "portObservation");
  exact(portObservation, ["hostIp", "port", "protocol", "inUse", "checkedAt"], [], "portObservation");
  if (portObservation.hostIp !== bindAddress || portObservation.port !== httpsPort
    || portObservation.protocol !== "tcp" || portObservation.inUse !== false
    || typeof portObservation.checkedAt !== "string" || Number.isNaN(Date.parse(portObservation.checkedAt))) {
    fail("portObservation must record the selected exact-bind TCP port as unused");
  }
  const observationAge = Date.now() - Date.parse(portObservation.checkedAt);
  if (requireFreshPort && (observationAge < -60_000 || observationAge > 60 * 60 * 1000)) {
    fail("portObservation must be refreshed within one hour before plan or apply");
  }

  const observed = object(input.observed, "observed");
  const ownership = project.ownership as "new" | "verified-existing";
  let ingressSubnet: string | undefined;
  if (Object.hasOwn(input, "ingressSubnet")) {
    if (ownership !== "new") {
      fail("ingressSubnet is valid only for a new Caddy-owned ingress network");
    }
    ingressSubnet = parsePrivateNetworkSubnet(input.ingressSubnet);
  }
  const mount = (source: string, target: string, readOnly: boolean) => ({
    source,
    target,
    readOnly,
    shared: readOnly,
    owner: projectOwner,
    ownership,
  });
  const composeNetworks: JsonObject[] = networks.map((network) => {
    const composeNetwork: JsonObject = {
      id: network.id,
      name: network.name,
      driver: "bridge",
      internal: network.internal,
      owner: network.owner,
      ownership: network.ownership,
    };
    if (network.subnet !== undefined) {
      composeNetwork.subnet = network.subnet;
    }
    return composeNetwork;
  });
  const ingressNetwork: JsonObject = {
    id: "ingress",
    name: `${projectId}-ingress`,
    driver: "bridge",
    internal: false,
    owner: projectOwner,
    ownership,
  };
  if (ingressSubnet !== undefined) {
    ingressNetwork.subnet = ingressSubnet;
  }
  composeNetworks.push(ingressNetwork);
  const serviceNetworks = ["ingress", ...networks.map((network) => network.id)].sort();
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
      networks: serviceNetworks,
      secretRefs: [],
    }],
    networks: composeNetworks,
    observed,
  };
  return {
    manifest,
    projectId,
    projectOwner,
    directory,
    ownership,
    bindAddress,
    httpsPort,
    configPath,
    dataPath,
    caddyfilePath,
    caSourcePath: join(dataPath, "caddy", "pki", "authorities", "local", "root.crt"),
    caddyfile,
    routes: loaded.routes,
    networks,
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
    fail(`${name} differs from the approved shared route`);
  }
}

async function ownerOnlyFileSha256(path: string, name: string): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || await realpath(path) !== path) {
    fail(`${name} must be an owner-only regular file`);
  }
  assertOwner(metadata, name);
  return contentHash(await readFile(path));
}

async function exactFileSha256(path: string, expected: string, name: string): Promise<void> {
  const actual = await ownerOnlyFileSha256(path, name);
  if (actual !== expected) {
    fail(`${name} differs from its approved checkpoint`);
  }
}

async function replaceExactFile(path: string, priorSha256: string, value: string, name: string): Promise<void> {
  const actual = await ownerOnlyFileSha256(path, name);
  const expected = contentHash(value);
  if (actual === expected) {
    return;
  }
  if (actual !== priorSha256) {
    fail(`${name} differs from both the retained and newly approved content`);
  }
  const temporary = join(dirname(path), `.caddy-private.${process.pid}.${Date.now()}.tmp`);
  try {
    await writePrivate(temporary, value);
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

async function writeCheckpoint(path: string, checkpoint: Checkpoint): Promise<void> {
  if (!existsSync(path)) {
    await writePrivate(path, `${JSON.stringify(checkpoint, null, 2)}\n`);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return;
  }
  const temporary = join(dirname(path), `state.${process.pid}.${Date.now()}.tmp`);
  try {
    await writePrivate(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`);
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function acquireLifecycleLock(stateDirectory: string, action: "apply" | "up" | "down") {
  const path = join(stateDirectory, "lifecycle.lock");
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
        || (metadata.mode & 0o777) !== 0o600 || await realpath(path) !== path) {
        fail("shared private-Caddy lifecycle lock is unsafe; inspect it manually before recovery");
      }
      assertOwner(metadata, "shared private-Caddy lifecycle lock");
      fail("shared private-Caddy lifecycle is locked; inspect the recorded process and Docker project before manually removing a stale lock");
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      schemaVersion: 1,
      kind: "shared-private-caddy-lifecycle-lock",
      action,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    await handle.sync();
    await syncDirectory(stateDirectory);
  } catch (error) {
    await handle.close();
    await unlink(path);
    throw error;
  }
  return {
    async release(): Promise<void> {
      const held = await handle.stat();
      let sameLock = false;
      try {
        const current = await lstat(path);
        sameLock = current.dev === held.dev && current.ino === held.ino;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
          throw error;
        }
      } finally {
        await handle.close();
      }
      if (sameLock) {
        await unlink(path);
        await syncDirectory(stateDirectory);
      }
    },
  };
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
    server.once("error", () => rejectPromise(new Error(`TCP port ${port} is unavailable on ${bindAddress}; refresh the exact port observation`)));
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

function resolveTarget(hostname: string, port: number, bindAddress: string): string {
  let address = bindAddress;
  if (isIP(bindAddress) === 6) {
    address = `[${bindAddress}]`;
  }
  return `${hostname}:${port}:${address}`;
}

function curlProof(context: { bindAddress: string; httpsPort: number }, route: CheckpointRoute,
  caExportPath: string): TransportProof {
  const result = spawnSync("curl", [
    "--cacert", caExportPath,
    "--resolve", resolveTarget(route.hostname, context.httpsPort, context.bindAddress),
    "--noproxy", "*",
    "--silent",
    "--show-error",
    "--output", "/dev/null",
    "--write-out", "%{http_code}",
    "--connect-timeout", "3",
    "--max-time", "10",
    `${route.origin}/`,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const status = Number(result.stdout.trim());
  let verified = true;
  if (result.status !== 0 || !Number.isInteger(status) || status < 100 || status > 599) {
    verified = false;
  }
  let httpStatus: number | null = status;
  if (!verified) {
    httpStatus = null;
  }
  return {
    hostname: route.hostname,
    origin: route.origin,
    method: "curl-cacert-resolve",
    verified,
    httpStatus,
    verifiedAt: new Date().toISOString(),
  };
}

async function proofAfterApply(context: {
  bindAddress: string;
  httpsPort: number;
  caSourcePath: string;
  routes: CheckpointRoute[];
}, caExportPath: string): Promise<{
  caSha256: string;
  transportProofs: TransportProof[];
}> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (existsSync(context.caSourcePath)) {
      const caSha256 = await exportCaRoot(context.caSourcePath, caExportPath);
      const transportProofs = context.routes.map((route) => curlProof(context, route, caExportPath));
      if (transportProofs.every((proof) => proof.verified)) {
        return { caSha256, transportProofs };
      }
    }
    if (attempt < 29) {
      await delay(1000);
    }
  }
  fail("Caddy did not produce verifiable local-CA TLS endpoints for every approved route within 30 seconds");
}

function planFacts(prepared: Prepared, composePlan: JsonObject) {
  return {
    schemaVersion: 1,
    kind: "shared-private-caddy-plan",
    project: {
      id: prepared.projectId,
      owner: prepared.projectOwner,
      directory: prepared.directory,
      ownership: prepared.ownership,
    },
    inputs: prepared.routes.map((route) => ({
      planPath: route.planPath,
      planSha256: route.planSha256,
      network: route.network,
      service: route.service,
      hostname: route.hostname,
    })),
    routes: prepared.routes.map((route) => ({
      service: route.service,
      hostname: route.hostname,
      origin: route.origin,
      upstream: `${route.upstreamHost}:${route.upstreamPort}`,
      network: route.network,
      applicationRequirements: route.applicationRequirements,
    })),
    access: {
      exposure: "private",
      bindAddress: prepared.bindAddress,
      httpsPort: prepared.httpsPort,
      public: false,
      httpRedirectPort: "disabled",
    },
    persistence: {
      caddyfile: prepared.caddyfilePath,
      config: prepared.configPath,
      data: prepared.dataPath,
      ownerOnly: true,
    },
    networks: prepared.networks,
    manifest: prepared.manifest,
    composePlan,
    caddyfileSha256: contentHash(prepared.caddyfile),
    portObservation: prepared.portObservation,
    dockerSocket: "not-mounted",
  };
}

function hostOnlyLocalhost(bindAddress: string, routes: Array<{ hostname: string }>): boolean {
  return (bindAddress === "127.0.0.1" || bindAddress === "::1")
    && routes.every((route) => route.hostname.endsWith(".localhost"));
}

function nameResolutionStep(bindAddress: string, routes: Array<{ hostname: string }>): string {
  if (hostOnlyLocalhost(bindAddress, routes)) {
    return "Verify each .localhost hostname resolves to loopback on this host; no private DNS owner is needed.";
  }
  return `Map every approved hostname to ${bindAddress} in the private DNS owner and verify from each intended client.`;
}

function verificationScope(caExportPath: string | null, bindAddress: string, routes: Array<{ hostname: string }>) {
  let nameResolutionScope = "must-be-verified-from-each-intended-client";
  if (hostOnlyLocalhost(bindAddress, routes)) {
    nameResolutionScope = "localhost-loopback-must-be-verified-on-this-host";
  }
  return {
    transport: "curl --cacert with an explicit --resolve mapping for each hostname",
    privateDns: {
      verified: false,
      scope: nameResolutionScope,
    },
    intendedClientCaTrust: {
      verified: false,
      scope: "must-be-verified-in-each-intended-client-trust-store",
      caExportPath,
    },
    upstreamReachability: "not-proven-unless-the-transport-response-is-not-502",
    upstreamNetworkIsolation: {
      verified: false,
      scope: "inspect runtime network membership and isolation; reused external networks are not changed by this adapter",
    },
    applicationAcceptance: "not-verified-by-route-cli",
    firewallScope: "not-verified-by-route-cli",
  };
}

function manualSteps(prepared: Prepared): string[] {
  const steps = prepared.routes.map((route) => `Ensure ${route.service} is attached to ${route.network} and reachable there as ${route.upstreamHost}:${route.upstreamPort}.`);
  steps.push(nameResolutionStep(prepared.bindAddress, prepared.routes));
  steps.push("Install the exported Caddy local CA root in every intended client's trust store, then verify each origin without a TLS bypass.");
  steps.push("Complete each route's application requirements and live acceptance checks; keep direct backend ports private.");
  return steps;
}

function newCheckpoint(prepared: Prepared, inputPath: string, approvalDigest: string,
  composeFile: string, caExportPath: string): Checkpoint {
  return {
    schemaVersion: 3,
    kind: "shared-private-caddy-checkpoint",
    project: prepared.projectId,
    inputPath,
    approvalDigest,
    manifest: structuredClone(prepared.manifest),
    composeFile,
    caddyfilePath: prepared.caddyfilePath,
    caddyfileSha256: contentHash(prepared.caddyfile),
    configPath: prepared.configPath,
    dataPath: prepared.dataPath,
    caSourcePath: prepared.caSourcePath,
    caExportPath,
    bindAddress: prepared.bindAddress,
    httpsPort: prepared.httpsPort,
    routes: prepared.routes.map((route) => ({ hostname: route.hostname, origin: route.origin })),
    phase: "prepared",
    caSha256: null,
    updatedAt: new Date().toISOString(),
    transportProofs: [],
  };
}

function lifecycleApproval(checkpoint: Checkpoint, action: "up" | "down"): string {
  let prefix = "UP";
  if (action === "down") {
    prefix = "STOP";
  }
  return `${prefix}:${checkpoint.project}:${hash(checkpoint)}`;
}

function lifecycleApprovals(checkpoint: Checkpoint | null) {
  if (!checkpoint) {
    return { up: null, down: null };
  }
  return {
    up: lifecycleApproval(checkpoint, "up"),
    down: lifecycleApproval(checkpoint, "down"),
  };
}

function checkpointValid(raw: unknown, expected: {
  project: string;
  directory: string;
  caExportPath: string;
  inputPath?: string;
}): Checkpoint {
  const checkpoint = object(raw, "shared private-Caddy checkpoint");
  exact(checkpoint, ["schemaVersion", "kind", "project", "inputPath", "approvalDigest", "manifest", "composeFile",
    "caddyfilePath", "caddyfileSha256", "configPath", "dataPath", "caSourcePath", "caExportPath",
    "bindAddress", "httpsPort", "routes", "phase", "caSha256", "updatedAt", "transportProofs"], [],
  "shared private-Caddy checkpoint");
  const composePrefix = `${expected.directory}/compose.`;
  const phases = new Set(["prepared", "compose-started", "verified", "stopped"]);
  if (checkpoint.schemaVersion !== 3 || checkpoint.kind !== "shared-private-caddy-checkpoint"
    || checkpoint.project !== expected.project || !DIGEST.test(checkpoint.approvalDigest)
    || typeof checkpoint.inputPath !== "string" || !isAbsolute(checkpoint.inputPath)
    || resolve(checkpoint.inputPath) !== checkpoint.inputPath || !inside(dirname(expected.directory), checkpoint.inputPath)
    || (expected.inputPath !== undefined && checkpoint.inputPath !== expected.inputPath)
    || checkpoint.caExportPath !== expected.caExportPath
    || typeof checkpoint.composeFile !== "string" || !checkpoint.composeFile.startsWith(composePrefix)
    || !/^[0-9a-f]{16}\.yaml$/.test(checkpoint.composeFile.slice(composePrefix.length))
    || checkpoint.caddyfilePath !== join(expected.directory, "Caddyfile")
    || checkpoint.configPath !== join(expected.directory, "config")
    || checkpoint.dataPath !== join(expected.directory, "data")
    || checkpoint.caSourcePath !== join(expected.directory, "data", "caddy", "pki", "authorities", "local", "root.crt")
    || !DIGEST.test(checkpoint.caddyfileSha256)
    || typeof checkpoint.bindAddress !== "string" || !privateBind(checkpoint.bindAddress)
    || !Number.isInteger(checkpoint.httpsPort) || checkpoint.httpsPort < 1024 || checkpoint.httpsPort > 65535
    || !phases.has(checkpoint.phase)
    || (checkpoint.caSha256 !== null && !DIGEST.test(checkpoint.caSha256))
    || typeof checkpoint.updatedAt !== "string" || Number.isNaN(Date.parse(checkpoint.updatedAt))
    || !Array.isArray(checkpoint.routes) || checkpoint.routes.length === 0 || checkpoint.routes.length > MAX_ROUTES
    || !Array.isArray(checkpoint.transportProofs) || checkpoint.transportProofs.length > MAX_ROUTES) {
    fail("shared private-Caddy checkpoint is invalid or belongs to another project");
  }
  const manifest = object(checkpoint.manifest, "checkpoint manifest");
  const project = object(manifest.project, "checkpoint manifest project");
  if (project.id !== expected.project || project.root !== dirname(expected.directory)
    || project.directory !== expected.directory
    || !Array.isArray(manifest.services) || manifest.services.length !== 1) {
    fail("shared private-Caddy checkpoint manifest is invalid or belongs to another project");
  }
  const service = object(manifest.services[0], "checkpoint Caddy service");
  if (service.id !== "caddy" || !Array.isArray(service.secretRefs) || service.secretRefs.length !== 0
    || !Array.isArray(service.environment) || service.environment.length !== 0
    || JSON.stringify(manifest).includes("docker.sock")) {
    fail("shared private-Caddy checkpoint manifest must remain Caddy-only and secret-free");
  }
  const routeKeys = new Set<string>();
  for (const rawRoute of checkpoint.routes) {
    const route = object(rawRoute, "checkpoint route");
    exact(route, ["hostname", "origin"], [], "checkpoint route");
    const expectedOrigin = `https://${route.hostname}:${checkpoint.httpsPort}`;
    if (typeof route.hostname !== "string" || typeof route.origin !== "string"
      || route.origin !== expectedOrigin || routeKeys.has(route.hostname)) {
      fail("shared private-Caddy checkpoint contains an invalid route");
    }
    routeKeys.add(route.hostname);
  }
  for (const rawProof of checkpoint.transportProofs) {
    const proof = object(rawProof, "transport proof");
    exact(proof, ["hostname", "origin", "method", "verified", "httpStatus", "verifiedAt"], [], "transport proof");
    if (typeof proof.hostname !== "string" || typeof proof.origin !== "string"
      || proof.method !== "curl-cacert-resolve" || typeof proof.verified !== "boolean"
      || (proof.httpStatus !== null && (!Number.isInteger(proof.httpStatus) || proof.httpStatus < 100 || proof.httpStatus > 599))
      || typeof proof.verifiedAt !== "string" || Number.isNaN(Date.parse(proof.verifiedAt))) {
      fail("shared private-Caddy checkpoint contains an invalid transport proof");
    }
  }
  if (checkpoint.phase === "verified") {
    const proofHostnames = new Set(checkpoint.transportProofs.map((proof: TransportProof) => proof.hostname));
    if (checkpoint.caSha256 === null || checkpoint.transportProofs.length !== checkpoint.routes.length
      || checkpoint.transportProofs.some((proof: TransportProof) => !proof.verified)
      || checkpoint.routes.some((route: CheckpointRoute) => !proofHostnames.has(route.hostname))) {
      fail("verified shared private-Caddy checkpoint lacks complete TLS transport proof");
    }
  }
  return checkpoint as Checkpoint;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function checkpointProject(raw: unknown, root: string): string {
  const input = object(raw, "shared private-Caddy input identity");
  const project = object(input.project, "shared private-Caddy project identity");
  const projectId = requireLabel(project.id, "project id");
  if (project.root !== root || project.directory !== join(root, projectId)) {
    fail("shared private-Caddy input does not identify one project below --project-root");
  }
  return projectId;
}

function checkpointPaths(root: string, project: string) {
  const directory = join(root, project);
  const stateDirectory = join(root, ".selfhost", "caddy-private", project);
  return {
    directory,
    stateDirectory,
    statePath: join(stateDirectory, "state.json"),
    caExportPath: join(stateDirectory, "caddy-local-root.crt"),
  };
}

/** Metadata-only recovery inventory. Never opens persistence, CA files, or a runtime connection. */
export async function sharedCaddyRecoveryInventory(root: string, inputPath: string) {
  await validateProjectRoot(root);
  if (!isAbsolute(inputPath) || resolve(inputPath) !== inputPath || !inside(root, inputPath)) {
    fail("Shared Caddy recovery input must remain inside the exact project root");
  }
  const input = await readJson(inputPath, MAX_INPUT, true, "shared private-Caddy backup input");
  const prepared = await prepare(input, root, false);
  const paths = checkpointPaths(root, prepared.projectId);
  const checkpoint = checkpointValid(await readJson(paths.statePath, MAX_INPUT, true, "shared private-Caddy backup checkpoint"), {
    project: prepared.projectId, directory: prepared.directory, caExportPath: paths.caExportPath, inputPath,
  });
  const expectedRoutes = prepared.routes.map(({ hostname, origin }) => ({ hostname, origin }));
  if (!["verified", "stopped"].includes(checkpoint.phase) || checkpoint.caSha256 === null
    || !isDeepStrictEqual(checkpoint.manifest, prepared.manifest)
    || !isDeepStrictEqual(checkpoint.routes, expectedRoutes)
    || checkpoint.caddyfileSha256 !== contentHash(prepared.caddyfile)) {
    fail("Shared Caddy backup inventory requires the unchanged retained applied checkpoint");
  }
  const context = prepared.manifest.project.dockerContext;
  if (typeof context !== "string" || !LABEL.test(context)) fail("Shared Caddy backup Docker context is invalid");
  return {
    project: prepared.projectId, directory: prepared.directory, dockerContext: context,
    image: prepared.manifest.services[0].image as string,
    inputPath, inputSha256: hash(input), stateDirectory: paths.stateDirectory, statePath: paths.statePath,
    checkpointSha256: hash(checkpoint), approvalDigest: checkpoint.approvalDigest,
    composeFile: checkpoint.composeFile, caddyfilePath: checkpoint.caddyfilePath,
    caddyfileSha256: checkpoint.caddyfileSha256, configPath: checkpoint.configPath, dataPath: checkpoint.dataPath,
    caSourcePath: checkpoint.caSourcePath, caExportPath: checkpoint.caExportPath, caSha256: checkpoint.caSha256,
    bindAddress: checkpoint.bindAddress, httpsPort: checkpoint.httpsPort, phase: checkpoint.phase,
    routes: prepared.routes.map(({ planPath, planSha256, network, service, hostname, origin }) =>
      ({ planPath, planSha256, network, service, hostname, origin })),
    verification: "validated-control-metadata-only; persistence-and-client-trust-not-inspected",
  };
}

function checkpointManualSteps(checkpoint: Checkpoint): string[] {
  return [
    nameResolutionStep(checkpoint.bindAddress, checkpoint.routes),
    "Install the exported Caddy local CA root in every intended client's trust store, then verify each origin without a TLS bypass.",
    "Verify upstream network membership and isolation separately; reused external Docker networks are not changed by this adapter.",
    "Complete each route's application requirements and live acceptance checks; keep direct backend ports private.",
  ];
}

async function checkpointStatus(checkpoint: Checkpoint, root: string, inputPath: string): Promise<void> {
  let current = false;
  let currentInput = "not-requested";
  if (inputPath !== "") {
    currentInput = "unavailable-or-invalid";
    try {
      const input = await readJson(inputPath, MAX_INPUT, true, "shared private-Caddy input");
      const prepared = await prepare(input, root, false);
      if (prepared.projectId === checkpoint.project) {
        const compose = createSelfhostComposeOwner(prepared.manifest);
        const composePlan = await compose.plan();
        const digest = hash(planFacts(prepared, composePlan));
        current = checkpoint.approvalDigest === digest && checkpoint.composeFile === composePlan.render.target;
        currentInput = "valid-but-changed";
        if (current) {
          currentInput = "matches-checkpoint";
        }
      }
    } catch {
      current = false;
    }
  }

  const liveTransport: TransportProof[] = [];
  let persistentCaMatchesExport: boolean | null = null;
  if (checkpoint.phase !== "stopped" && existsSync(checkpoint.caExportPath)) {
    for (const route of checkpoint.routes) {
      liveTransport.push(curlProof(checkpoint, route, checkpoint.caExportPath));
    }
    if (checkpoint.caSha256 !== null && existsSync(checkpoint.caSourcePath)) {
      const currentCa = await readCaRoot(checkpoint.caSourcePath);
      persistentCaMatchesExport = contentHash(currentCa) === checkpoint.caSha256;
    }
  }
  let reportedCaPath: string | null = null;
  if (checkpoint.caSha256 !== null) {
    reportedCaPath = checkpoint.caExportPath;
  }
  print({
    schemaVersion: 1,
    kind: "shared-private-caddy-status",
    project: checkpoint.project,
    applied: checkpoint.phase === "verified",
    checkpointRecorded: true,
    current,
    currentInput,
    checkpoint: {
      recorded: true,
      phase: checkpoint.phase,
      approvalDigest: checkpoint.approvalDigest,
      composeFile: checkpoint.composeFile,
      inputPath: checkpoint.inputPath,
      updatedAt: checkpoint.updatedAt,
      routes: checkpoint.routes,
    },
    lifecycleApprovals: lifecycleApprovals(checkpoint),
    routes: checkpoint.routes,
    access: {
      exposure: "private",
      bindAddress: checkpoint.bindAddress,
      httpsPort: checkpoint.httpsPort,
      public: false,
      httpRedirectPort: "disabled",
    },
    liveTransport,
    persistentCaMatchesExport,
    verification: verificationScope(reportedCaPath, checkpoint.bindAddress, checkpoint.routes),
    manualSteps: checkpointManualSteps(checkpoint),
  });
}

async function checkpointLifecycle(action: "up" | "down", approval: string, checkpoint: Checkpoint,
  statePath: string, runtime: CaddyPrivateRuntime): Promise<void> {
  const expectedLifecycleApproval = lifecycleApproval(checkpoint, action);
  if (approval !== expectedLifecycleApproval) {
    fail(`shared private-Caddy ${action} requires the exact approval token from status`);
  }
  if (!existsSync(checkpoint.composeFile)) {
    fail("the exact checkpointed shared-Caddy Compose file is missing");
  }
  const checkpointCompose = createSelfhostComposeOwner(checkpoint.manifest);
  const checkpointPlan = await checkpointCompose.plan();
  if (checkpointPlan.render.target !== checkpoint.composeFile) {
    fail("shared private-Caddy checkpoint manifest does not match its exact Compose file");
  }
  if (action === "up") {
    let hasCurl: boolean;
    if (runtime.curlAvailable) {
      hasCurl = runtime.curlAvailable();
    } else {
      hasCurl = curlAvailable();
    }
    if (!hasCurl) {
      fail("curl is required before starting the shared private-Caddy route");
    }
    await exactFileSha256(checkpoint.caddyfilePath, checkpoint.caddyfileSha256, "checkpointed shared Caddyfile");
    await ownedDirectory(checkpoint.configPath, "Caddy config directory", true);
    await ownedDirectory(checkpoint.dataPath, "Caddy data directory", true);
    checkpoint = {
      ...checkpoint,
      phase: "compose-started",
      caSha256: null,
      updatedAt: new Date().toISOString(),
      transportProofs: [],
    };
    await writeCheckpoint(statePath, checkpoint);
    if (runtime.composeApply) {
      await runtime.composeApply(checkpoint.manifest, checkpointPlan);
    } else {
      await checkpointCompose.apply(checkpointPlan);
    }
    let proof: { caSha256: string; transportProofs: TransportProof[] };
    if (runtime.proofAfterApply) {
      proof = await runtime.proofAfterApply(checkpoint);
    } else {
      proof = await proofAfterApply(checkpoint, checkpoint.caExportPath);
    }
    checkpoint = {
      ...checkpoint,
      phase: "verified",
      caSha256: proof.caSha256,
      updatedAt: new Date().toISOString(),
      transportProofs: proof.transportProofs,
    };
    await writeCheckpoint(statePath, checkpoint);
  } else {
    if (runtime.composeStop) {
      await runtime.composeStop(checkpoint.manifest, checkpointPlan);
    } else {
      await checkpointCompose.stop(checkpointPlan);
    }
    checkpoint = {
      ...checkpoint,
      phase: "stopped",
      updatedAt: new Date().toISOString(),
    };
    await writeCheckpoint(statePath, checkpoint);
  }
  print({
    schemaVersion: 1,
    kind: "shared-private-caddy-lifecycle",
    action,
    project: checkpoint.project,
    composeFile: checkpoint.composeFile,
    phase: checkpoint.phase,
    nextApprovals: lifecycleApprovals(checkpoint),
    volumesDeleted: false,
    verification: verificationScope(checkpoint.caExportPath, checkpoint.bindAddress, checkpoint.routes),
  });
}

export async function caddyPrivateCommand(args: string[], runtime: CaddyPrivateRuntime = {}): Promise<void> {
  const options = parse(args);
  const root = await validateProjectRoot(options.projectRoot);
  if (options.input !== "" && (!isAbsolute(options.input) || resolve(options.input) !== options.input
    || !inside(root, options.input))) {
    fail("--input must stay inside the selected project root");
  }

  if (options.action === "status" || options.action === "up" || options.action === "down") {
    let recoveryProject = options.checkpoint;
    if (recoveryProject === "") {
      const identityInput = await readJson(options.input, MAX_INPUT, true, "shared private-Caddy input identity");
      recoveryProject = checkpointProject(identityInput, root);
    }
    const recoveryPaths = checkpointPaths(root, recoveryProject);
    if (existsSync(recoveryPaths.statePath)) {
      let expectedInputPath: string | undefined;
      if (options.input !== "") {
        expectedInputPath = options.input;
      }
      if (options.action === "status") {
        const recovered = checkpointValid(
          await readJson(recoveryPaths.statePath, MAX_INPUT, true, "shared private-Caddy state"),
          {
            project: recoveryProject,
            directory: recoveryPaths.directory,
            caExportPath: recoveryPaths.caExportPath,
            inputPath: expectedInputPath,
          },
        );
        await checkpointStatus(recovered, root, options.input);
      } else {
        const lifecycleLock = await acquireLifecycleLock(recoveryPaths.stateDirectory, options.action);
        try {
          if (!existsSync(recoveryPaths.statePath)) {
            fail("shared private-Caddy checkpoint disappeared after lifecycle lock acquisition");
          }
          const recovered = checkpointValid(
            await readJson(recoveryPaths.statePath, MAX_INPUT, true, "shared private-Caddy state"),
            {
              project: recoveryProject,
              directory: recoveryPaths.directory,
              caExportPath: recoveryPaths.caExportPath,
              inputPath: expectedInputPath,
            },
          );
          await checkpointLifecycle(options.action, options.approval, recovered, recoveryPaths.statePath, runtime);
        } finally {
          await lifecycleLock.release();
        }
      }
      return;
    }
    if (options.checkpoint !== "" || options.action === "up" || options.action === "down") {
      fail("shared private-Caddy lifecycle needs an owner-only checkpoint from apply");
    }
  }

  const input = await readJson(options.input, MAX_INPUT, true, "shared private-Caddy input");
  const needsFreshPort = options.action === "plan" || options.action === "apply";
  const prepared = await prepare(input, root, needsFreshPort);
  const compose = createSelfhostComposeOwner(prepared.manifest);
  const composePlan = await compose.plan();
  const facts = planFacts(prepared, composePlan);
  const digest = hash(facts);
  const approval = `APPLY:${prepared.projectId}:${digest}`;
  const paths = checkpointPaths(root, prepared.projectId);
  const stateDirectory = paths.stateDirectory;
  const statePath = paths.statePath;
  const caExportPath = paths.caExportPath;
  const checkpointIdentity = {
    project: prepared.projectId,
    directory: prepared.directory,
    caExportPath,
    inputPath: options.input,
  };

  let checkpoint: Checkpoint | null = null;
  if (options.action === "plan" && existsSync(statePath)) {
    checkpoint = checkpointValid(await readJson(statePath, MAX_INPUT, true, "shared private-Caddy state"), checkpointIdentity);
  }

  if (options.action === "plan") {
    let existingLifecycle = null;
    if (checkpoint) {
      existingLifecycle = {
        phase: checkpoint.phase,
        current: checkpoint.approvalDigest === digest && checkpoint.composeFile === composePlan.render.target,
        composeFile: checkpoint.composeFile,
        approvals: lifecycleApprovals(checkpoint),
      };
    }
    print({
      ...facts,
      status: "pass",
      mutation: false,
      approval,
      caExportPath,
      existingLifecycle,
      verification: verificationScope(null, prepared.bindAddress, prepared.routes),
      manualSteps: manualSteps(prepared),
      knownGaps: [
        "The adapter does not verify client hostname resolution, client CA trust, firewall policy, or application authentication.",
        "The supplied external-network ownership does not prove that each upstream service is attached or resolves by its Docker DNS name.",
        "The caller-declared internal flag is not proof that a reused external Docker network is isolated.",
        "A curl transport proof, including HTTP 502, proves Caddy TLS termination but not backend or application acceptance.",
      ],
    });
    return;
  }

  if (options.action === "status") {
    print({
      schemaVersion: 1,
      kind: "shared-private-caddy-status",
      project: prepared.projectId,
      applied: false,
      checkpointRecorded: false,
      current: false,
      currentInput: "valid-without-checkpoint",
      checkpoint: null,
      lifecycleApprovals: lifecycleApprovals(null),
      routes: facts.routes,
      access: facts.access,
      liveTransport: [],
      persistentCaMatchesExport: null,
      verification: verificationScope(null, prepared.bindAddress, prepared.routes),
      manualSteps: manualSteps(prepared),
    });
    return;
  }

  if (options.approval !== approval) {
    fail("shared private-Caddy apply requires the exact approval token from the unchanged inputs");
  }
  let hasCurl: boolean;
  if (runtime.curlAvailable) {
    hasCurl = runtime.curlAvailable();
  } else {
    hasCurl = curlAvailable();
  }
  if (!hasCurl) {
    fail("curl is required before apply so the local CA transport proofs can be recorded");
  }
  await ensureStateRoot(root);
  await ensureDirectory(join(root, ".selfhost", "caddy-private"), "private-Caddy CLI state");
  await ensureDirectory(stateDirectory, "shared private-Caddy project state");
  const lifecycleLock = await acquireLifecycleLock(stateDirectory, "apply");
  try {
    if (existsSync(statePath)) {
      checkpoint = checkpointValid(
        await readJson(statePath, MAX_INPUT, true, "shared private-Caddy state"),
        checkpointIdentity,
      );
    }
    if (checkpoint) {
      const unchanged = checkpoint.approvalDigest === digest && checkpoint.composeFile === composePlan.render.target;
      if (unchanged) {
        fail("shared private-Caddy already has a checkpoint; use status and its exact up or down approval");
      }
      if (checkpoint.phase !== "stopped") {
        fail("changed shared private-Caddy inputs require an approved stop of the checkpointed project first");
      }
    }
    const portAvailable = runtime.portAvailable ?? assertLivePortAvailable;
    await portAvailable(prepared.bindAddress, prepared.httpsPort);
    if (prepared.ownership === "verified-existing") {
      const claimed = [prepared.directory, prepared.caddyfilePath, prepared.configPath, prepared.dataPath];
      if (claimed.some((path) => !existsSync(path))) {
        fail("verified-existing shared-Caddy resources are missing; inspect ownership before apply");
      }
    }
    await compose.render(composePlan);
    if (checkpoint) {
      if (checkpoint.caddyfilePath !== prepared.caddyfilePath) {
        fail("changed shared private-Caddy inputs cannot move the checkpointed Caddyfile");
      }
      await replaceExactFile(prepared.caddyfilePath, checkpoint.caddyfileSha256, prepared.caddyfile,
        "checkpointed shared Caddyfile");
    } else {
      await ensureExactFile(prepared.caddyfilePath, prepared.caddyfile, "approved shared Caddyfile");
    }
    await ensureDirectory(prepared.configPath, "Caddy config directory");
    await ensureDirectory(prepared.dataPath, "Caddy data directory");
    let nextCheckpoint = newCheckpoint(prepared, options.input, digest, composePlan.render.target, caExportPath);
    await writeCheckpoint(statePath, nextCheckpoint);
    nextCheckpoint = {
      ...nextCheckpoint,
      phase: "compose-started",
      updatedAt: new Date().toISOString(),
    };
    await writeCheckpoint(statePath, nextCheckpoint);
    if (runtime.composeApply) {
      await runtime.composeApply(prepared.manifest, composePlan);
    } else {
      await compose.apply(composePlan);
    }
    let proof: { caSha256: string; transportProofs: TransportProof[] };
    if (runtime.proofAfterApply) {
      proof = await runtime.proofAfterApply(nextCheckpoint);
    } else {
      proof = await proofAfterApply(nextCheckpoint, caExportPath);
    }
    nextCheckpoint = {
      ...nextCheckpoint,
      phase: "verified",
      caSha256: proof.caSha256,
      updatedAt: new Date().toISOString(),
      transportProofs: proof.transportProofs,
    };
    await writeCheckpoint(statePath, nextCheckpoint);
    print({
      schemaVersion: 1,
      kind: "shared-private-caddy-apply",
      status: "applied-transport-only",
      project: prepared.projectId,
      routes: facts.routes,
      access: facts.access,
      composeFile: composePlan.render.target,
      caExportPath,
      transportProofs: proof.transportProofs,
      lifecycleApprovals: lifecycleApprovals(nextCheckpoint),
      verification: verificationScope(caExportPath, prepared.bindAddress, prepared.routes),
      manualSteps: manualSteps(prepared),
    });
  } finally {
    await lifecycleLock.release();
  }
}
