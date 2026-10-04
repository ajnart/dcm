import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { isIP } from "node:net";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBundleVaultwardenHandoff, exportBundleHandoff } from "./bundle-handoff.ts";
import { bundleApprovalsCommand } from "./bundle-approvals.ts";
import { bundleBenchmarkCommand } from "./bundle-benchmark.ts";
import { bundleFinalizeCommand } from "./bundle-finalize.ts";
import { bundleJourneyCommand } from "./bundle-journey.ts";
import { bundleHomarrAttachCommand, inspectBundleHomarrAttachments, type HomarrAttachmentAdapter } from "./bundle-homarr-attach.ts";
import { caddyPrivateCommand } from "./caddy-private.ts";
import { assertPackagedCatalogProject } from "./lib/catalog-project.ts";
import { approvedHouseholdParallelJobs } from "./lib/household-graph.ts";
import { runApprovedDag } from "./lib/approved-dag.ts";
import { parseMediaNetworkSubnets, type MediaNetworkSubnets } from "./media-network-subnets.ts";
import { assertNonOverlappingPrivateSubnets, parsePrivateNetworkSubnet } from "./private-network-subnet.ts";
import { buildIngressPlan } from "../../../.agents/skills/self-host/workflows/selfhost-ingress/scripts/plan-ingress.ts";
import { availableCatalog, buildCompositePlan, loadCatalog, stackForGoalId } from "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";
import type { HomarrImmichInput } from "./homarr-immich.ts";

type AdapterCommand = (args: string[]) => Promise<void>;
type ImageInspectResult = { ok: boolean; stdout: Buffer };
type ImageInspector = (command: string[]) => Promise<ImageInspectResult>;
type Service = "media" | "immich" | "docmost" | "vaultwarden";
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type AdoptedMediaFacts = { source: "cli-managed-media-info"; bind: "127.0.0.1" | "0.0.0.0"; ports: number[]; approvalDigest: string };

type Bundle = {
  schemaVersion: 1;
  id: string;
  projectRoot: string;
  services: {
    media: { runId: string; username: string; credentialHandoff: boolean; mode?: "create" | "adopt"; bindMode?: "host-only"; portStart?: number; networkSubnets?: MediaNetworkSubnets; adoptedMedia?: AdoptedMediaFacts };
    immich: { input: string; runId: string; accountFile: string };
    docmost: { input: string; runId: string; accountFile: string };
    vaultwarden: { input: string; runId: string; accountFile: string; httpsPlan: string };
  };
};

type Dependencies = {
  media: AdapterCommand;
  immich: AdapterCommand;
  docmost: AdapterCommand;
  vaultwarden: AdapterCommand;
  homarrAttach?: HomarrAttachmentAdapter;
  inspectImage?: ImageInspector;
  inspectHost?: (args: string[]) => Promise<void>;
  inspectMediaWeb?: (context: string, network: string, project: string) => Promise<void>;
  runIsolatedStage?: (args: string[]) => Promise<{ ok: boolean }>;
  assessFinalization?: AdapterCommand;
};

type StatusCapture = { ok: true; output: string } | { ok: false; reason: string };
type LocalHttpsSelection = { input: string; runId: string };
type MediaSummary = {
  expected: number;
  present: number;
  running: number;
  healthy: number;
  unhealthy: number;
  starting: number;
  healthUnavailable: number;
};

type BundleInspection = {
  privateHttps: Awaited<ReturnType<typeof vaultwardenHttpsState>>;
  media: StatusCapture;
  mediaSummary: MediaSummary | null;
  immich: StatusCapture;
  immichValue: Record<string, any> | null;
  docmost: StatusCapture;
  docmostValue: Record<string, any> | null;
  docmostAcceptance: Record<string, any> | null;
  docmostManualAcceptance?: { statusCommand: string[]; planCommand: string[]; browserFallback: string };
  vaultwarden: StatusCapture;
  vaultwardenValue: Record<string, any> | null;
};

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SOLE_INPUT_ACTIONS = new Set(["plan", "next", "run", "status", "info", "parallel-plan", "parallel-apply"]);
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/;
const EMAIL = /^[^@\s]+@[^@.\s]+(?:\.[^@.\s]+)+$/;
const OWNER = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const NETWORK = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/;
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9_.-]+)?@sha256:[0-9a-f]{64}$/;
const MAX_INPUT = 64 * 1024;
const HOMARR_BOARD = "personal";
const HOMARR_ICONS = {
  immich: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/immich.svg",
  docmost: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/docmost.png",
  vaultwarden: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/vaultwarden.svg",
};

const IMMICH_IMAGES = {
  server: "ghcr.io/immich-app/immich-server:v3.2.2@sha256:6b0eaf8cfea6d4d6f86a45dfd0c9e3b068ed4493d8b7fa1efeca4cc87792fbe8",
  machineLearning: "ghcr.io/immich-app/immich-machine-learning:v3.2.2@sha256:390453a571ca73b563cc3d9a12a37a4d71217b12608de72f26884f5e2ebc4896",
  redis: "docker.io/valkey/valkey:9@sha256:67878c70fc179bb928b1a9b510860aff1c475ff245e91d98d4b2133326bf8e3e",
  database: "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:b1d33572a9a0634aa6d344077467ad32847812a37fa3859f702952cba22a2f55",
};

const HOUSEHOLD_IMAGE_TAGS = {
  "--docmost-image": "docker.io/docmost/docmost:0.96.0",
  "--postgres-image": "docker.io/library/postgres:18.6",
  "--redis-image": "docker.io/library/redis:8.10.2",
  "--vaultwarden-image": "docker.io/vaultwarden/server:1.37.3",
} as const;
const CADDY_IMAGE = /^docker\.io\/library\/caddy:2\.[0-9]+\.[0-9]+(?:-alpine)?@sha256:[0-9a-f]{64}$/;
const CADDY_TAG = "docker.io/library/caddy:2.11.4-alpine";
const REGISTRY_INDEX_TYPES = new Set([
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.index.v1+json",
]);

function inspectRegistryImage(command: string[]): Promise<ImageInspectResult> {
  return new Promise((resolveInspection) => {
    execFile(command[0], command.slice(1), {
      encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true,
    }, (error, stdout) => {
      const output = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
      resolveInspection({ ok: !error, stdout: output });
    });
  });
}

async function immutableImage(tag: string, inspectImage: ImageInspector): Promise<string> {
  const command = ["docker", "buildx", "imagetools", "inspect", tag, "--raw"];
  const result = await inspectImage(command);
  if (!result.ok) fail(`Could not resolve ${tag}; Docker Buildx output was suppressed`);
  if (result.stdout.length < 2 || result.stdout.length > 1024 * 1024) {
    fail(`Docker Buildx returned an invalid registry manifest for ${tag}`);
  }
  let manifest: Record<string, any>;
  try { manifest = object(JSON.parse(result.stdout.toString("utf8")), `registry manifest for ${tag}`); }
  catch { fail(`Docker Buildx returned invalid registry manifest JSON for ${tag}`); }
  if (manifest.schemaVersion !== 2 || !REGISTRY_INDEX_TYPES.has(manifest.mediaType) || !Array.isArray(manifest.manifests)) {
    fail(`Registry manifest for ${tag} is not a supported OCI image index`);
  }
  const linuxAmd64 = manifest.manifests.some((entry: unknown) => {
    const candidate = requireRecord(entry, `registry manifest entry for ${tag}`);
    const platform = requireRecord(candidate.platform, `registry platform for ${tag}`);
    return platform.os === "linux" && platform.architecture === "amd64";
  });
  if (!linuxAmd64) fail(`Registry manifest for ${tag} does not include the required linux/amd64 image`);
  const digest = createHash("sha256").update(result.stdout).digest("hex");
  return `${tag}@sha256:${digest}`;
}

async function selectedHouseholdImages(flags: Record<string, string>, inspectImage: ImageInspector) {
  const options = Object.keys(HOUSEHOLD_IMAGE_TAGS) as Array<keyof typeof HOUSEHOLD_IMAGE_TAGS>;
  if (flags["--resolve-images"]) {
    const explicit = options.filter((option) => flags[option]);
    if (explicit.length > 0) fail(`--resolve-images cannot be combined with explicit image options: ${explicit.join(", ")}`);
    const images = await Promise.all(options.map((option) => immutableImage(HOUSEHOLD_IMAGE_TAGS[option], inspectImage)));
    const resolved: Record<string, string> = {};
    for (let index = 0; index < options.length; index += 1) resolved[options[index]] = images[index];
    return { values: resolved, source: "registry-resolved" };
  }
  const missing = options.filter((option) => !flags[option]);
  if (missing.length > 0) fail(`bundle init still needs: ${missing.join(", ")}; or use --resolve-images`);
  return { values: flags, source: "explicit" };
}

async function inspectBundledHost(args: string[]): Promise<void> {
  const packaged = fileURLToPath(new URL("./workflows/selfhost-host/scripts/inspect-host.sh", import.meta.url));
  const source = fileURLToPath(new URL("../../../.agents/skills/self-host/workflows/selfhost-host/scripts/inspect-host.sh", import.meta.url));
  let script = packaged;
  if (!existsSync(script)) script = source;
  if (!existsSync(script)) fail("The bounded host inspector is missing; reinstall the CLI before bundle begin");
  const result = spawnSync("bash", [script, ...args], {
    encoding: "buffer", maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
  });
  if (result.error || result.status !== 0) fail("Bounded host inspection failed; inspector output was suppressed");
}

function fail(message: string): never { throw new Error(message); }

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${name} has unknown or missing fields`);
  }
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  if (path === "") return true;
  if (path === ".." || path.startsWith(`..${sep}`)) return false;
  return !isAbsolute(path);
}

async function ownedProjectRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path || path === sep || path === resolve(homedir())) {
    fail("--project-root must be one exact absolute project path, not root or home");
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) fail("Project root must be one real directory");
  if ((metadata.mode & 0o002) !== 0) fail("Project root must not be world-writable");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Project root has a different owner");
  return path;
}

async function ownedPrivateDirectory(path: string, name: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail(`${name} does not exist`);
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700
    || await realpath(path) !== path) fail(`${name} must be one owner-only real directory (0700)`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
}

async function soleBundleInput(projectRoot: string): Promise<string> {
  const root = await ownedProjectRoot(projectRoot);
  const local = join(root, ".selfhost");
  const bundles = join(local, "bundles");
  await ownedPrivateDirectory(local, ".selfhost");
  await ownedPrivateDirectory(bundles, ".selfhost/bundles");
  const inputs: string[] = [];
  for (const entry of await readdir(bundles, { withFileTypes: true })) {
    if (!ID.test(entry.name) || !entry.isDirectory()) {
      fail(`Unsafe household bundle entry: ${entry.name}`);
    }
    const directory = join(bundles, entry.name);
    await ownedPrivateDirectory(directory, `Household bundle directory ${entry.name}`);
    const input = join(directory, "household-bundle.json");
    let metadata;
    try {
      metadata = await lstat(input);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || (metadata.mode & 0o777) !== 0o600 || await realpath(input) !== input) {
      fail(`Unsafe household bundle input: ${entry.name}`);
    }
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      fail(`Household bundle input has a different owner: ${entry.name}`);
    }
    await boundedFile(root, input, "discovered bundle input", true);
    inputs.push(input);
  }
  if (inputs.length === 0) {
    fail("No safe household bundle input exists under .selfhost/bundles; pass --input explicitly");
  }
  if (inputs.length > 1) {
    fail("Multiple household bundle inputs exist under .selfhost/bundles; pass one exact --input path");
  }
  return inputs[0];
}

async function boundedFile(root: string, path: string, name: string, privateMode = false): Promise<Buffer> {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(root, path)) fail(`${name} must be an exact path inside the project root`);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path
    || metadata.size < 2 || metadata.size > MAX_INPUT) fail(`${name} must be one bounded regular file without links`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
  if (privateMode && (metadata.mode & 0o777) !== 0o600) fail(`${name} must use mode 0600`);
  return readFile(path);
}

function service(value: unknown, keys: string[], name: string): Record<string, unknown> {
  const record = object(value, name);
  exact(record, keys, name);
  if (typeof record.runId !== "string" || !ID.test(record.runId)) fail(`${name} runId is invalid`);
  return record;
}

function numberFlag(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) fail(`${name} must be a port from 1024 through 65535`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) fail(`${name} must be a port from 1024 through 65535`);
  return number;
}

function privateHost(value: string | undefined): string {
  if (!value || isIP(value) === 0) fail("--host-ip must be one literal private IP address");
  if (value === "127.0.0.1" || value === "::1") return value;
  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)) return value;
  }
  if (isIP(value) === 6 && /^(fc|fd)/i.test(value)) return value;
  fail("--host-ip must be a loopback, RFC1918, or unique-local address; public ingress needs a separate plan");
}

function httpsOrigin(value: string | undefined): string {
  if (!value) fail("--vaultwarden-origin is required");
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { fail("--vaultwarden-origin must be one exact HTTPS origin"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/"
    || parsed.search || parsed.hash || parsed.origin !== value) fail("--vaultwarden-origin must be one exact HTTPS origin");
  return parsed.origin;
}

async function privateJson(path: string, value: unknown): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

async function privateFileIfPresent(path: string, name: string): Promise<string | null> {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600 || await realpath(path) !== path) {
    fail(`${name} must be one owner-only regular file (0600) without links`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
  return path;
}

async function replacePrivateJson(root: string, path: string, value: unknown): Promise<void> {
  await boundedFile(root, path, "owner-only input", true);
  const staging = await mkdtemp(join(dirname(path), ".route-network-"));
  const replacement = join(staging, "revised-input.json");
  try {
    await privateJson(replacement, value);
    await rename(replacement, path);
  } finally {
    await rm(staging, { recursive: true });
  }
}

function requireRecord(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} is invalid`);
  return value as Record<string, any>;
}

function listenerAddress(value: unknown): string {
  if (typeof value !== "string" || !value) fail("Host inspection contains an unsupported listener address");
  if (value === "0.0.0.0" || value === "::" || value === "*") return "*";
  const scoped = value.split("%");
  if (scoped.length === 1) {
    if (isIP(value) === 0) fail("Host inspection contains an unsupported listener address");
    return value;
  }
  if (scoped.length !== 2 || isIP(scoped[0]) === 0 || !/^[A-Za-z0-9_.-]{1,15}$/.test(scoped[1])) {
    fail("Host inspection contains an unsupported listener address");
  }
  return scoped[0];
}

async function hostObservation(root: string, path: string, selectedPorts: number[], allowExtraSelectedPorts = false) {
  const raw = await boundedFile(root, path, "host inspection report", true);
  let report: Record<string, any>;
  try { report = requireRecord(JSON.parse(raw.toString("utf8")), "host inspection report"); }
  catch { fail("Host inspection report is not valid JSON"); }
  const runtime = requireRecord(report.runtime, "host inspection runtime");
  const docker = requireRecord(runtime.docker, "host inspection Docker state");
  const context = requireRecord(runtime.dockerContext, "host inspection Docker context");
  const platform = requireRecord(report.platform, "host inspection platform");
  const kernel = requireRecord(platform.kernel, "host inspection kernel");
  const identity = requireRecord(report.identity, "host inspection identity");
  const workloads = requireRecord(report.workloads, "host inspection workloads");
  const networks = requireRecord(workloads.dockerNetworks, "host inspection networks");
  const network = requireRecord(report.network, "host inspection network");
  const listeners = requireRecord(network.listeningPorts, "host inspection listeners");
  const selected = report.network.selectedTcpPorts;
  if (report.schemaVersion !== 1 || report.mode !== "read-only" || docker.state !== "running"
    || context.state !== "observed" || typeof context.current !== "string" || !context.current
    || networks.state !== "observed" || networks.truncated !== false || listeners.state !== "observed"
    || !Array.isArray(networks.items) || !Array.isArray(listeners.items)) {
    fail("Host inspection must fully observe Docker context and networks plus the listener probe");
  }
  if (!["default", "rootless"].includes(context.current)) {
    fail("Bundle initialization supports only an inspected local Docker engine using the default or rootless context");
  }
  if (!Number.isInteger(identity.uid) || !Number.isInteger(identity.gid) || identity.uid === 0 || identity.gid === 0) {
    fail("Bundle initialization requires one observed non-root UID and GID");
  }
  if (!["x86_64", "amd64"].includes(kernel.architecture)) fail("The pinned Immich bundle currently requires a linux/amd64 host inspection");
  if (typeof process.getuid === "function" && (process.getuid() !== identity.uid || process.getgid?.() !== identity.gid)) {
    fail("Host inspection identity must match the user running bundle init");
  }
  const metadata = await lstat(path);
  const age = Date.now() - metadata.mtimeMs;
  if (age < -60_000 || age > 15 * 60_000) fail("Host inspection must be refreshed within the last 15 minutes");
  const checkedAt = new Date(metadata.mtimeMs).toISOString();
  const ports = listeners.items.map((item: unknown) => {
    const entry = requireRecord(item, "observed listener");
    const published = Number(entry.port);
    let protocol = entry.protocol;
    if (protocol === "tcp6") protocol = "tcp";
    if (protocol === "udp6") protocol = "udp";
    if (!Number.isInteger(published) || published < 1 || published > 65535 || !["tcp", "udp"].includes(protocol)) {
      fail("Host inspection contains an unsupported listener");
    }
    const hostIp = listenerAddress(entry.bind);
    return { hostIp, published, protocol, owner: "external" };
  });
  const exact = requireRecord(selected, "selected TCP port checks");
  if (exact.state !== "observed" || exact.complete !== true || !Array.isArray(exact.items)) {
    fail("Bundle initialization requires complete exact selected TCP port checks");
  }
  const exactPorts = exact.items.map((item: unknown) => {
    const entry = requireRecord(item, "selected TCP port check");
    if (!Number.isInteger(entry.port) || typeof entry.inUse !== "boolean") fail("Selected TCP port check is invalid");
    return { port: entry.port, inUse: entry.inUse };
  });
  const observedSelection = [...new Set(exactPorts.map((entry) => entry.port))].sort((left, right) => left - right);
  const expectedSelection = [...new Set(selectedPorts)].sort((left, right) => left - right);
  if (allowExtraSelectedPorts) {
    if (observedSelection.length !== exactPorts.length
      || expectedSelection.some((port) => !observedSelection.includes(port))) {
      fail(`Host inspection needs exact checks for selected TCP ports: ${expectedSelection.join(", ")}`);
    }
  } else if (JSON.stringify(observedSelection) !== JSON.stringify(expectedSelection)
    || exactPorts.length !== expectedSelection.length) {
    fail(`Host inspection needs exact checks for selected TCP ports: ${expectedSelection.join(", ")}`);
  }
  if (listeners.truncated !== true && listeners.truncated !== false) {
    fail("Host inspection listener truncation state is invalid");
  }
  const observedNetworks = networks.items.map((item: unknown) => {
    const entry = requireRecord(item, "observed Docker network");
    if (typeof entry.name !== "string" || !entry.name) fail("Host inspection contains an invalid Docker network");
    return { name: entry.name, owner: "external" };
  });
  return { dockerContext: context.current, checkedAt, ports, networks: observedNetworks, exactPorts };
}

function project(root: string, id: string, dockerContext: string) {
  return { dockerContext, id, owner: id, root, directory: join(root, id), ownership: "new" };
}

function observed(value: Awaited<ReturnType<typeof hostObservation>>) {
  return { checkedAt: value.checkedAt, project: null, ports: value.ports, paths: [], networks: value.networks };
}

function assertNoConflicts(ids: string[], ports: number[], observation: Awaited<ReturnType<typeof hostObservation>>): void {
  if (new Set(ids).size !== ids.length) fail("Generated Compose project and run IDs must be distinct");
  if (new Set(ports).size !== ports.length) fail("Immich, Docmost, and Vaultwarden need distinct published ports");
  const conflictingPorts = ports.filter((port) => observation.ports.some((entry) => entry.protocol === "tcp" && entry.published === port)
    || observation.exactPorts.some((entry) => entry.port === port && entry.inUse));
  if (conflictingPorts.length > 0) {
    const options = conflictingPorts.map((port) => {
      if (port === ports[0]) return `--immich-port (currently ${port})`;
      if (port === ports[1]) return `--docmost-port (currently ${port})`;
      return `--vaultwarden-port (currently ${port})`;
    });
    fail(`Selected TCP ports are already in use: ${conflictingPorts.join(", ")}. Re-run the host probe and bundle init with different ${options.join(" and ")}`);
  }
  const wantedNetworks = ids.map((id) => `${id}-private`);
  for (const name of wantedNetworks) {
    if (observation.networks.some((entry) => entry.name === name)) fail(`Docker network ${name} is already observed; choose another bundle ID`);
  }
}

function observedExternalNetwork(value: string | undefined, option: string, privateName: string,
  inspection: Awaited<ReturnType<typeof hostObservation>>): string | undefined {
  if (!value) return undefined;
  if (!NETWORK.test(value) || value === "host" || value === "none") fail(`${option} must be one exact bounded Docker network name`);
  if (value === privateName) fail(`${option} must differ from the application's private network`);
  if (!inspection.networks.some((entry) => entry.name === value)) {
    fail(`${option} ${value} was not found in the complete fresh Docker network observation`);
  }
  return value;
}

async function inspectMediaWebNetwork(context: string, networkName: string, projectId: string): Promise<void> {
  const result = spawnSync("docker", ["--context", context, "network", "inspect", networkName, "--format", "{{json .}}"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 8_000, maxBuffer: 128 * 1024,
  });
  if (result.error || result.status !== 0 || !result.stdout || Buffer.byteLength(result.stdout) > 128 * 1024) {
    fail("Media web network could not be inspected in the selected Docker context; Docker output was suppressed");
  }
  let parsed: Record<string, any>;
  try { parsed = requireRecord(JSON.parse(result.stdout), "media web network"); }
  catch { fail("Media web network inspection returned invalid JSON"); }
  const labels = requireRecord(parsed.Labels, "media web network labels");
  const containers = requireRecord(parsed.Containers, "media web network containers");
  const names = Object.values(containers).map((item) => requireRecord(item, "media web container").Name);
  const expected = ["homarr", "jellyfin", "seerr"].map((service) => `${projectId}-${service}-1`).sort();
  const mediaNames = names.filter((name) => typeof name === "string" && name.startsWith(`${projectId}-`)).sort();
  if (parsed.Name !== networkName || parsed.Driver !== "bridge" || parsed.Internal !== true
    || labels["com.docker.compose.project"] !== projectId || labels["com.docker.compose.network"] !== "web"
    || names.some((name) => typeof name !== "string")
    || JSON.stringify(mediaNames) !== JSON.stringify(expected)) {
    fail("Media web network is not the exact internal Compose network with Homarr, Jellyfin, and Seerr as its only media members");
  }
}

async function initialize(root: string, flags: Record<string, string>, dependencies: Dependencies): Promise<void> {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function" || process.platform !== "linux") {
    fail("The current household bundle initializer requires a non-root Linux host");
  }
  const required = ["--id", "--email", "--name", "--host-inspection", "--vaultwarden-origin", "--https-route-owner", "--https-tls-owner"];
  const missing = required.filter((name) => !flags[name]);
  if (missing.length > 0) fail(`bundle init still needs: ${missing.join(", ")}`);
  const bundleId = flags["--id"];
  const username = flags["--username"] ?? "admin";
  const email = flags["--email"];
  const name = flags["--name"];
  if (!bundleId || !ID.test(bundleId)) fail("--id must be a lowercase bundle identifier up to 40 characters");
  if (!USERNAME.test(username)) fail("--username is invalid");
  if (!email || email.length > 254 || !EMAIL.test(email)) fail("--email must be a valid account email");
  if (!name || name.trim() !== name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) fail("--name must be a bounded display name");
  const hostIp = privateHost(flags["--host-ip"] ?? "127.0.0.1");
  const immichPort = numberFlag(flags["--immich-port"] ?? "2283", "--immich-port");
  const docmostPort = numberFlag(flags["--docmost-port"] ?? "3000", "--docmost-port");
  const vaultwardenPort = numberFlag(flags["--vaultwarden-port"] ?? "8080", "--vaultwarden-port");
  let mediaPortStart: number | undefined;
  if (flags["--media-port-start"]) {
    mediaPortStart = numberFlag(flags["--media-port-start"], "--media-port-start");
    if (mediaPortStart < 20000 || mediaPortStart > 44993) fail("--media-port-start must be from 20000 through 44993");
  }
  const mediaPorts = mediaPortStart === undefined ? [] : Array.from({ length: MEDIA_SERVICES.length }, (_, index) => mediaPortStart + index);
  let mediaNetworkSubnets: MediaNetworkSubnets | undefined;
  if (flags["--media-network-subnets"]) mediaNetworkSubnets = parseMediaNetworkSubnets(flags["--media-network-subnets"]);
  let immichNetworkSubnet: string | undefined;
  let docmostNetworkSubnet: string | undefined;
  let vaultwardenNetworkSubnet: string | undefined;
  if (flags["--immich-network-subnet"]) immichNetworkSubnet = parsePrivateNetworkSubnet(flags["--immich-network-subnet"]);
  if (flags["--docmost-network-subnet"]) docmostNetworkSubnet = parsePrivateNetworkSubnet(flags["--docmost-network-subnet"]);
  if (flags["--vaultwarden-network-subnet"]) vaultwardenNetworkSubnet = parsePrivateNetworkSubnet(flags["--vaultwarden-network-subnet"]);
  const selectedSubnets: string[] = [];
  if (mediaNetworkSubnets) selectedSubnets.push(mediaNetworkSubnets.default, mediaNetworkSubnets.web);
  if (immichNetworkSubnet) selectedSubnets.push(immichNetworkSubnet);
  if (docmostNetworkSubnet) selectedSubnets.push(docmostNetworkSubnet);
  if (vaultwardenNetworkSubnet) selectedSubnets.push(vaultwardenNetworkSubnet);
  assertNonOverlappingPrivateSubnets(selectedSubnets);
  const requestedMediaRun = flags["--media-run-id"];
  if (requestedMediaRun && mediaPortStart !== undefined) fail("--media-port-start selects a new media run; an adopted run keeps its existing ports");
  if (requestedMediaRun && mediaNetworkSubnets !== undefined) fail("--media-network-subnets selects a new media run; an adopted run keeps its existing networks");
  if (mediaPorts.some((port) => [immichPort, docmostPort, vaultwardenPort].includes(port))) {
    fail("Selected media ports overlap an Immich, Docmost, or Vaultwarden port");
  }
  const inspectionPath = flags["--host-inspection"];
  if (!inspectionPath) fail("--host-inspection is required; create it with selfhost-host inspect-host.sh --output");
  const inspection = await hostObservation(root, inspectionPath, [immichPort, docmostPort, vaultwardenPort, ...mediaPorts], true);
  const immichId = `${bundleId}-immich`;
  const docmostId = `${bundleId}-docmost`;
  const vaultwardenId = `${bundleId}-vault`;
  const mediaBindMode = flags["--media-bind-mode"] ?? "all-interfaces";
  if (mediaBindMode !== "all-interfaces" && mediaBindMode !== "host-only") {
    fail("--media-bind-mode accepts all-interfaces or host-only");
  }
  if (requestedMediaRun && flags["--media-bind-mode"]) {
    fail("--media-bind-mode selects a new media run; an adopted run keeps its existing bind");
  }
  let mediaRunId = `${bundleId}-media`;
  let mediaMode: "create" | "adopt" = "create";
  let adoptedMedia: AdoptedMediaFacts | undefined;
  if (requestedMediaRun) {
    if (!ID.test(requestedMediaRun)) fail("--media-run-id must be one exact CLI media run ID");
    const capture = await captureStatus(() => dependencies.media(["status", "--project-root", root,
      "--run-id", requestedMediaRun, "--json", "yes"]));
    const summary = mediaSummary(capture, requestedMediaRun);
    if (!summary || summary.present !== MEDIA_SERVICES.length || summary.running !== MEDIA_SERVICES.length) {
      fail("--media-run-id must identify a CLI-managed run in this project with all seven services currently running");
    }
    const handoffPath = join(root, ".selfhost", "media-harness", ".sessions", requestedMediaRun,
      "artifacts", "private-handoff.json");
    if (!existsSync(handoffPath)) {
      fail(`The adopted media run has no private credential handoff. First run bash ${join(root, ".selfhost", "media-harness", "scripts", "session.sh")} handoff ${requestedMediaRun}, then retry bundle init.`);
    }
    let mediaHandoff: Record<string, any>;
    try { mediaHandoff = requireRecord(JSON.parse((await boundedFile(root, handoffPath, "adopted media handoff", true)).toString("utf8")), "adopted media handoff"); }
    catch { fail("The adopted media private handoff is invalid; regenerate it through its owning media harness before retrying"); }
    const mediaHandoffServices = requireRecord(mediaHandoff.services, "adopted media handoff services");
    if (JSON.stringify(Object.keys(mediaHandoffServices).sort()) !== JSON.stringify([...MEDIA_SERVICES].sort())) {
      fail("The adopted media handoff does not contain all seven selected services");
    }
    for (const name of MEDIA_SERVICES) {
      const serviceHandoff = requireRecord(mediaHandoffServices[name], `adopted ${name} handoff`);
      if (typeof serviceHandoff.username !== "string" || typeof serviceHandoff.password !== "string"
        || serviceHandoff.password.length < 1 || typeof serviceHandoff.url !== "string"
        || !(serviceHandoff.apiKey === null || typeof serviceHandoff.apiKey === "string")) {
        fail(`The adopted ${name} handoff is incomplete; regenerate it through the owning media harness`);
      }
    }
    const homarrHandoff = requireRecord(mediaHandoffServices.homarr, "adopted Homarr handoff");
    if (mediaHandoff.runId !== requestedMediaRun || homarrHandoff.username !== username) {
      fail("The adopted media handoff does not match this run ID and selected administrator");
    }
    const infoCapture = await captureStatus(() => dependencies.media(["info", "--project-root", root,
      "--run-id", requestedMediaRun, "--json", "yes"]));
    adoptedMedia = mediaInfoFacts(infoCapture, root, requestedMediaRun, username);
    if (!adoptedMedia) fail("--media-run-id needs one unchanged, approved CLI media plan with exact bind and seven ports");
    mediaRunId = requestedMediaRun;
    mediaMode = "adopt";
  }
  for (const id of [immichId, docmostId, vaultwardenId]) {
    if (id.length > 63 || !OWNER.test(id)) fail("--id is too long for derived Compose project identifiers");
  }
  const newProjects = [immichId, docmostId, vaultwardenId];
  if (mediaMode === "create") newProjects.unshift(`${bundleId}-media`);
  assertNoConflicts(newProjects, [immichPort, docmostPort, vaultwardenPort], inspection);
  const occupiedMediaPorts = mediaPorts.filter((port) => inspection.ports.some((entry) => entry.protocol === "tcp" && entry.published === port)
    || inspection.exactPorts.some((entry) => entry.port === port && entry.inUse));
  if (occupiedMediaPorts.length > 0) fail(`Selected media ports are already in use: ${occupiedMediaPorts.join(", ")}`);
  const homarrNetwork = observedExternalNetwork(flags["--homarr-network"], "--homarr-network", `${immichId}-private`, inspection);
  const docmostNetwork = observedExternalNetwork(flags["--docmost-network"], "--docmost-network", `${docmostId}-private`, inspection);
  const vaultwardenRouteNetwork = observedExternalNetwork(flags["--vaultwarden-route-network"], "--vaultwarden-route-network",
    `${vaultwardenId}-private`, inspection);
  if (homarrNetwork && vaultwardenRouteNetwork && homarrNetwork === vaultwardenRouteNetwork) {
    fail("--vaultwarden-route-network must differ from --homarr-network so Vaultwarden stays behind its dedicated route");
  }
  if (docmostNetwork && vaultwardenRouteNetwork && docmostNetwork === vaultwardenRouteNetwork) {
    fail("--vaultwarden-route-network must differ from --docmost-network so Vaultwarden stays behind its dedicated route");
  }
  const images = await selectedHouseholdImages(flags, dependencies.inspectImage ?? inspectRegistryImage);
  const docmostImage = images.values["--docmost-image"];
  const postgresImage = images.values["--postgres-image"];
  const redisImage = images.values["--redis-image"];
  const vaultwardenImage = images.values["--vaultwarden-image"];
  if (!docmostImage || !/^docker\.io\/docmost\/docmost:0\.96\.0@sha256:[0-9a-f]{64}$/.test(docmostImage)) fail("--docmost-image needs the reviewed 0.96.0 tag and verified digest");
  if (!postgresImage || !/^docker\.io\/library\/postgres:18(?:\.[0-9]+)?@sha256:[0-9a-f]{64}$/.test(postgresImage)) fail("--postgres-image needs a reviewed Postgres 18 tag and verified digest");
  if (!redisImage || !/^docker\.io\/library\/redis:8(?:\.[0-9]+){0,2}@sha256:[0-9a-f]{64}$/.test(redisImage)) fail("--redis-image needs a reviewed Redis 8 tag and verified digest");
  if (!vaultwardenImage || !DIGEST_IMAGE.test(vaultwardenImage)) fail("--vaultwarden-image needs an explicit tag and verified immutable digest");
  const origin = httpsOrigin(flags["--vaultwarden-origin"]);
  const routeOwner = flags["--https-route-owner"];
  const tlsOwner = flags["--https-tls-owner"];
  if (!routeOwner || !OWNER.test(routeOwner) || !tlsOwner || !OWNER.test(tlsOwner)) fail("--https-route-owner and --https-tls-owner need bounded owner IDs");
  const routeStatus = flags["--https-route-status"];
  const trustStatus = flags["--https-trust"];
  if ((routeStatus && routeStatus !== "configured") || (trustStatus && trustStatus !== "verified-for-intended-client")) {
    fail("HTTPS readiness accepts only --https-route-status configured and --https-trust verified-for-intended-client");
  }
  if (Boolean(routeStatus) !== Boolean(trustStatus)) fail("HTTPS route status and intended-client trust must be recorded together or both left pending");
  let savedRouteStatus = "pending";
  let savedTrustStatus = "pending";
  if (routeStatus && trustStatus) {
    savedRouteStatus = "configured";
    savedTrustStatus = "verified-for-intended-client";
  }

  const local = join(root, ".selfhost");
  if (!existsSync(local)) await mkdir(local, { mode: 0o700 });
  const localMetadata = await lstat(local);
  if (!localMetadata.isDirectory() || localMetadata.isSymbolicLink() || (localMetadata.mode & 0o777) !== 0o700
    || await realpath(local) !== local || localMetadata.uid !== process.getuid()) fail(".selfhost must be an owner-only directory (0700)");
  const ignore = join(local, ".gitignore");
  if (!existsSync(ignore)) {
    const handle = await open(ignore, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile("*\n"); await handle.sync(); }
    finally { await handle.close(); }
  }
  const ignoreMetadata = await lstat(ignore);
  if (!ignoreMetadata.isFile() || ignoreMetadata.isSymbolicLink() || ignoreMetadata.nlink !== 1
    || (ignoreMetadata.mode & 0o777) !== 0o600 || await readFile(ignore, "utf8") !== "*\n") {
    fail(".selfhost/.gitignore must be an owner-only wildcard ignore file");
  }
  const bundles = join(local, "bundles");
  if (!existsSync(bundles)) await mkdir(bundles, { mode: 0o700 });
  const bundlesMetadata = await lstat(bundles);
  if (!bundlesMetadata.isDirectory() || bundlesMetadata.isSymbolicLink() || (bundlesMetadata.mode & 0o777) !== 0o700
    || await realpath(bundles) !== bundles || bundlesMetadata.uid !== process.getuid()) fail(".selfhost/bundles must be an owner-only directory (0700)");
  const target = join(bundles, bundleId);
  if (existsSync(target)) fail(`Bundle files already exist at ${target}; choose another --id or use bundle plan`);
  const staging = await mkdtemp(join(bundles, `.init-${bundleId}-`));
  const commonObserved = observed(inspection);
  const storage = (path: string, owner: string) => ({ path, owner, ownership: "new" });
  try {
    const immichProject = project(root, immichId, inspection.dockerContext);
    const immichInput = {
      schemaVersion: 1, platform: "linux/amd64", project: immichProject, observed: commonObserved,
      network: { id: "private", name: `${immichId}-private`, internal: false }, hostIp, publishedPort: immichPort,
      allowSetup: true, images: IMMICH_IMAGES,
      storage: {
        uploads: storage(join(immichProject.directory, "data", "uploads"), immichId),
        modelCache: storage(join(immichProject.directory, "data", "model-cache"), immichId),
        database: { ...storage(join(immichProject.directory, "data", "database"), immichId), localFilesystem: true },
      },
      databaseSecret: { ref: `local/${immichId}/database-password`, filePath: join(immichProject.directory, "secrets", "immich-database-password") },
    };
    if (immichNetworkSubnet) Object.assign(immichInput.network, { subnet: immichNetworkSubnet });
    if (homarrNetwork) {
      const mediaWebNetwork = `autostack-${mediaRunId}_web`;
      const integrationNetwork: { id: string; name: string; owner: string; internal?: boolean } =
        { id: "homarr", name: homarrNetwork, owner: "external" };
      if (homarrNetwork === mediaWebNetwork) integrationNetwork.internal = true;
      Object.assign(immichInput, { integrationNetwork });
    }
    const docmostProject = project(root, docmostId, inspection.dockerContext);
    const docmostInput = { schemaVersion: 1, project: docmostProject, observed: commonObserved,
      images: { docmost: docmostImage, postgres: postgresImage, redis: redisImage }, hostIp, publishedPort: docmostPort };
    if (docmostNetworkSubnet) Object.assign(docmostInput, { networkSubnet: docmostNetworkSubnet });
    if (docmostNetwork) {
      const mediaWebNetwork = `autostack-${mediaRunId}_web`;
      const integrationNetwork: { id: string; name: string; owner: string; internal?: boolean } =
        { id: "web", name: docmostNetwork, owner: "external" };
      if (docmostNetwork === mediaWebNetwork) integrationNetwork.internal = true;
      Object.assign(docmostInput, { integrationNetwork });
    }
    const vaultProject = project(root, vaultwardenId, inspection.dockerContext);
    const vaultwardenInput = {
      schemaVersion: 1, project: vaultProject, observed: commonObserved,
      network: { id: "private", name: `${vaultwardenId}-private`, internal: false },
      apps: { vaultwarden: { image: vaultwardenImage, uid: process.getuid?.(), gid: process.getgid?.(), hostIp,
        publishedPort: vaultwardenPort, storage: { data: storage(join(vaultProject.directory, "data"), vaultwardenId) },
        domain: origin, bootstrapRegistration: true } },
    };
    if (vaultwardenNetworkSubnet) Object.assign(vaultwardenInput.network, { subnet: vaultwardenNetworkSubnet });
    if (vaultwardenRouteNetwork) {
      Object.assign(vaultwardenInput, { integrationNetwork: { id: "vaultwarden-route", name: vaultwardenRouteNetwork, owner: "external" } });
    }
    const httpsPlan = { schemaVersion: 1, origin, exposure: "private", routeStatus: savedRouteStatus, routeOwner, tlsOwner,
      clientCertificateTrust: savedTrustStatus, backend: { hostIp, publishedPort: vaultwardenPort } };
    const account = { schemaVersion: 1, username, email, name };
    const vaultAccount = { schemaVersion: 1, username, email };
    const paths = {
      immichInput: join(staging, "immich-input.json"), immichAccount: join(staging, "immich-account.json"),
      docmostInput: join(staging, "docmost-input.json"), docmostAccount: join(staging, "docmost-account.json"),
      vaultwardenInput: join(staging, "vaultwarden-input.json"), vaultwardenAccount: join(staging, "vaultwarden-account.json"),
      vaultwardenHttps: join(staging, "vaultwarden-https.json"), bundle: join(staging, "household-bundle.json"),
    };
    await privateJson(paths.immichInput, immichInput);
    await privateJson(paths.immichAccount, account);
    await privateJson(paths.docmostInput, docmostInput);
    await privateJson(paths.docmostAccount, account);
    await privateJson(paths.vaultwardenInput, vaultwardenInput);
    await privateJson(paths.vaultwardenAccount, vaultAccount);
    await privateJson(paths.vaultwardenHttps, httpsPlan);
    const finalPath = (file: string) => join(target, file);
    const mediaService: Bundle["services"]["media"] = { runId: mediaRunId, username, credentialHandoff: true, mode: mediaMode };
    if (mediaBindMode === "host-only") mediaService.bindMode = "host-only";
    if (mediaPortStart !== undefined) mediaService.portStart = mediaPortStart;
    if (mediaNetworkSubnets !== undefined) mediaService.networkSubnets = mediaNetworkSubnets;
    if (adoptedMedia) mediaService.adoptedMedia = adoptedMedia;
    const bundle: Bundle = { schemaVersion: 1, id: bundleId, projectRoot: root, services: {
      media: mediaService,
      immich: { input: finalPath("immich-input.json"), runId: `${bundleId}-immich`, accountFile: finalPath("immich-account.json") },
      docmost: { input: finalPath("docmost-input.json"), runId: `${bundleId}-docmost`, accountFile: finalPath("docmost-account.json") },
      vaultwarden: { input: finalPath("vaultwarden-input.json"), runId: `${bundleId}-vault`, accountFile: finalPath("vaultwarden-account.json"), httpsPlan: finalPath("vaultwarden-https.json") },
    } };
    await privateJson(paths.bundle, bundle);
    await rename(staging, target);
    console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-init", status: "created", mutation: "owner-only-input-files",
      directory: target, input: finalPath("household-bundle.json"), createdFiles: Object.keys(paths).length,
      selections: { username, email, hostIp, ports: { immich: immichPort, docmost: docmostPort, vaultwarden: vaultwardenPort },
        imageSource: images.source,
        media: { runId: mediaRunId, mode: mediaMode, bindMode: adoptedMedia?.bind ?? mediaBindMode,
          ports: adoptedMedia?.ports ?? (mediaPorts.length > 0 ? mediaPorts : "automatic"),
          networkSubnets: mediaNetworkSubnets ?? "automatic" },
        appNetworkSubnets: { immich: immichNetworkSubnet ?? "automatic", docmost: docmostNetworkSubnet ?? "automatic", vaultwarden: vaultwardenNetworkSubnet ?? "automatic" },
        homarrNetwork: homarrNetwork ?? null,
        docmostNetwork: docmostNetwork ?? null,
        vaultwardenRouteNetwork: vaultwardenRouteNetwork ?? null, privateHttpsOrigin: origin,
        vaultwardenHttps: { routeStatus: savedRouteStatus, clientCertificateTrust: savedTrustStatus } },
      next: `self-host bundle plan --project-root ${root} --input ${finalPath("household-bundle.json")}`,
      limits: ["No container was started.", "This does not approve an adapter apply.", "Docmost and Vaultwarden still require protected browser checkpoints."] }, null, 2));
  } catch (error) {
    await rm(staging, { recursive: true });
    throw error;
  }
}

async function load(projectRoot: string, input: string): Promise<{ bundle: Bundle; approval: string; fingerprints: Record<string, string> }> {
  const root = await ownedProjectRoot(projectRoot);
  const raw = await boundedFile(root, input, "bundle input", true);
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); }
  catch { fail("Bundle input is not valid JSON"); }
  const value = object(parsed, "bundle input");
  exact(value, ["schemaVersion", "id", "projectRoot", "services"], "bundle input");
  if (value.schemaVersion !== 1 || typeof value.id !== "string" || !ID.test(value.id) || value.projectRoot !== root) {
    fail("Bundle identity or project root is invalid");
  }
  const services = object(value.services, "bundle services");
  exact(services, ["media", "immich", "docmost", "vaultwarden"], "bundle services");
  const mediaRecord = requireRecord(services.media, "media service");
  let mediaKeys = ["runId", "username", "credentialHandoff"];
  if (Object.hasOwn(mediaRecord, "mode")) mediaKeys = [...mediaKeys, "mode"];
  if (Object.hasOwn(mediaRecord, "bindMode")) mediaKeys = [...mediaKeys, "bindMode"];
  if (Object.hasOwn(mediaRecord, "portStart")) mediaKeys = [...mediaKeys, "portStart"];
  if (Object.hasOwn(mediaRecord, "networkSubnets")) mediaKeys = [...mediaKeys, "networkSubnets"];
  if (Object.hasOwn(mediaRecord, "adoptedMedia")) mediaKeys = [...mediaKeys, "adoptedMedia"];
  const media = service(mediaRecord, mediaKeys, "media service");
  if (typeof media.username !== "string" || !USERNAME.test(media.username) || typeof media.credentialHandoff !== "boolean") {
    fail("Media service needs a valid username and credentialHandoff boolean");
  }
  if (media.mode !== undefined && media.mode !== "create" && media.mode !== "adopt") fail("Media service mode is invalid");
  if (media.bindMode !== undefined && media.bindMode !== "host-only") fail("Media service bindMode is invalid");
  if (media.portStart !== undefined && (typeof media.portStart !== "number" || !Number.isInteger(media.portStart)
    || media.portStart < 20000 || media.portStart > 44993)) fail("Media service portStart is invalid");
  if (media.networkSubnets !== undefined) parseMediaNetworkSubnets(media.networkSubnets);
  if (media.mode === "adopt" && (media.bindMode !== undefined || media.portStart !== undefined || media.networkSubnets !== undefined)) fail("Adopted media keeps its existing bind, port, and network selection");
  if (media.adoptedMedia !== undefined) {
    if (media.mode !== "adopt" || !validAdoptedMediaFacts(media.adoptedMedia)) fail("Adopted media facts are invalid");
  }
  const immich = service(services.immich, ["input", "runId", "accountFile"], "Immich service");
  const docmost = service(services.docmost, ["input", "runId", "accountFile"], "Docmost service");
  const vaultwarden = service(services.vaultwarden, ["input", "runId", "accountFile", "httpsPlan"], "Vaultwarden service");
  const referenced: Record<string, unknown> = {
    immichInput: immich.input, immichAccount: immich.accountFile,
    docmostInput: docmost.input, docmostAccount: docmost.accountFile,
    vaultwardenInput: vaultwarden.input, vaultwardenAccount: vaultwarden.accountFile,
    vaultwardenHttps: vaultwarden.httpsPlan,
  };
  const fingerprints: Record<string, string> = {};
  for (const [name, path] of Object.entries(referenced)) {
    if (typeof path !== "string") fail(`${name} must be a path`);
    const privateMode = name.endsWith("Account");
    fingerprints[name] = createHash("sha256").update(await boundedFile(root, path, name, privateMode)).digest("hex");
  }
  const bundle = value as Bundle;
  const digest = createHash("sha256").update(JSON.stringify({ bundle, fingerprints })).digest("hex");
  return { bundle, approval: `BUNDLE:${bundle.id}:${digest}`, fingerprints };
}

async function vaultwardenHttpsState(root: string, path: string) {
  const raw = await boundedFile(root, path, "Vaultwarden HTTPS plan", true);
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); }
  catch { fail("Vaultwarden HTTPS plan is not valid JSON"); }
  const plan = object(parsed, "Vaultwarden HTTPS plan");
  exact(plan, ["schemaVersion", "origin", "exposure", "routeStatus", "routeOwner", "tlsOwner", "clientCertificateTrust", "backend"],
    "Vaultwarden HTTPS plan");
  const origin = httpsOrigin(plan.origin as string);
  const backend = object(plan.backend, "Vaultwarden HTTPS backend");
  exact(backend, ["hostIp", "publishedPort"], "Vaultwarden HTTPS backend");
  privateHost(backend.hostIp as string);
  const backendHostPort = numberFlag(String(backend.publishedPort), "Vaultwarden HTTPS backend port");
  if (plan.schemaVersion !== 1 || plan.exposure !== "private"
    || typeof plan.routeOwner !== "string" || !OWNER.test(plan.routeOwner)
    || typeof plan.tlsOwner !== "string" || !OWNER.test(plan.tlsOwner)
    || !["pending", "configured"].includes(plan.routeStatus as string)
    || !["pending", "verified-for-intended-client"].includes(plan.clientCertificateTrust as string)) {
    fail("Vaultwarden HTTPS plan has invalid private route or trust fields");
  }
  const ready = plan.routeStatus === "configured" && plan.clientCertificateTrust === "verified-for-intended-client";
  const hostname = new URL(origin).hostname;
  const hostOnly = hostname === "localhost" || hostname.endsWith(".localhost");
  let next = "Configure the private route, then verify DNS and CA trust from the intended client before recording readiness.";
  if (hostOnly) {
    next = "Configure the host-only route, then verify Caddy CA trust and HTTPS from this host before recording readiness.";
  }
  if (ready) {
    next = "Verify DNS and CA trust from every intended client; bundle readiness records the owner's assertion, not a client probe.";
    if (hostOnly) {
      next = "Verify Caddy CA trust and HTTPS on this host; this .localhost link is not reachable from other devices.";
    }
  }
  return {
    ready,
    origin,
    backendHostPort,
    routeOwner: plan.routeOwner,
    tlsOwner: plan.tlsOwner,
    recordedRouteStatus: plan.routeStatus,
    recordedClientTrust: plan.clientCertificateTrust,
    provenance: "operator-recorded-https-plan",
    independentlyVerifiedByBundle: false,
    next,
  };
}

async function vaultwardenHttpsReady(root: string, path: string): Promise<boolean> {
  return (await vaultwardenHttpsState(root, path)).ready;
}

async function recordHttpsReady(root: string, input: string, flags: Record<string, string>): Promise<void> {
  const current = await load(root, input);
  if (flags["--approve"] !== current.approval) {
    fail("bundle https-ready needs the exact approval from the unchanged bundle plan");
  }
  if (flags["--https-route-status"] !== "configured"
    || flags["--https-trust"] !== "verified-for-intended-client") {
    fail("Confirm both --https-route-status configured and --https-trust verified-for-intended-client after checking the intended client");
  }
  const path = current.bundle.services.vaultwarden.httpsPlan;
  const before = await vaultwardenHttpsState(root, path);
  if (before.ready) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-https-ready", status: "already-recorded",
      mutation: false, bundle: current.bundle.id, approval: current.approval,
      scope: "Operator-recorded readiness; this command does not verify client DNS or CA trust." }, null, 2));
    return;
  }
  if (before.recordedRouteStatus !== "pending" || before.recordedClientTrust !== "pending") {
    fail("Vaultwarden HTTPS readiness is inconsistent; inspect its owner-only plan before changing it");
  }
  const plan = object(JSON.parse((await boundedFile(root, path, "Vaultwarden HTTPS plan", true)).toString("utf8")),
    "Vaultwarden HTTPS plan");
  const unchanged = await load(root, input);
  if (unchanged.approval !== current.approval) fail("Bundle inputs changed before HTTPS readiness could be recorded");
  const revised = { ...plan, routeStatus: "configured", clientCertificateTrust: "verified-for-intended-client" };
  await replacePrivateJson(root, path, revised);
  const updated = await load(root, input);
  if (updated.approval === current.approval) fail("HTTPS readiness did not change the bundle approval");
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-https-ready", status: "recorded",
    mutation: "owner-only-https-plan", bundle: current.bundle.id, origin: before.origin,
    routeOwner: before.routeOwner, tlsOwner: before.tlsOwner, previousApproval: current.approval,
    approval: updated.approval, next: `self-host bundle plan --project-root ${root} --input ${input}`,
    scope: "Operator-confirmed route and intended-client trust only; no DNS, TLS, browser, or app acceptance was independently verified." }, null, 2));
}

function localHttpsSelection(flags: Record<string, string>): LocalHttpsSelection | null {
  const input = flags["--local-https-input"];
  const runId = flags["--local-https-run-id"];
  if (!input && !runId) return null;
  if (!input || !runId) fail("Local HTTPS lifecycle needs both --local-https-input and --local-https-run-id");
  if (!ID.test(runId)) fail("--local-https-run-id must be one exact route run ID");
  return { input, runId };
}

async function validatedLocalHttps(bundle: Bundle, selection: LocalHttpsSelection,
  dependencies: Dependencies): Promise<Record<string, unknown>> {
  const root = bundle.projectRoot;
  const capture = await captureStatus(() => dependencies.vaultwarden(["local-https", "status",
    "--project-root", root, "--run-id", selection.runId, "--input", selection.input]));
  const value = parsedStatus(capture);
  if (!value || value.kind !== "vaultwarden-local-https-status" || value.project !== selection.runId
    || value.runId !== selection.runId || value.applied !== true || !value.checkpoint) {
    fail("The explicitly selected local HTTPS route is not an applied adapter-owned checkpoint");
  }
  const https = await vaultwardenHttpsState(root, bundle.services.vaultwarden.httpsPlan);
  const integration = object(value.integrationNetwork, "local HTTPS integration network");
  exact(integration, ["id", "name", "owner"], "local HTTPS integration network");
  const access = object(value.access, "local HTTPS access");
  if (integration.id !== "vaultwarden-route" || typeof integration.name !== "string"
    || integration.owner !== selection.runId || value.origin !== https.origin
    || access.public !== false || !["host-only", "private-network"].includes(access.scope as string)
    || https.routeOwner !== selection.runId || https.tlsOwner !== selection.runId) {
    fail("The explicitly selected local HTTPS route does not own this bundle's private Vaultwarden origin");
  }
  let raw: unknown;
  try {
    raw = JSON.parse((await boundedFile(root, bundle.services.vaultwarden.input, "Vaultwarden input", true)).toString("utf8"));
  } catch {
    fail("Vaultwarden input is unavailable for local HTTPS binding validation");
  }
  const vaultwarden = object(raw, "Vaultwarden input");
  const bound = object(vaultwarden.integrationNetwork, "Vaultwarden route network");
  exact(bound, ["id", "name", "owner"], "Vaultwarden route network");
  if (bound.id !== "vaultwarden-route" || bound.name !== integration.name || bound.owner !== "external") {
    fail("The explicitly selected local HTTPS route is not bound to this exact Vaultwarden project");
  }
  return { project: selection.runId, input: selection.input, origin: https.origin,
    network: integration.name, accessScope: access.scope, checkpoint: "applied" };
}

async function reviseRouteNetwork(root: string, input: string, flags: Record<string, string>): Promise<void> {
  const current = await load(root, input);
  if (flags["--approve"] !== current.approval) fail("bundle route-network needs the exact approval from the unchanged bundle plan");
  const network = flags["--network"];
  if (!network || !NETWORK.test(network) || network === "host" || network === "none") {
    fail("--network must be one exact bounded Docker network name");
  }
  const inspectionPath = flags["--host-inspection"];
  if (!inspectionPath) fail("bundle route-network needs --host-inspection");
  const immichPath = current.bundle.services.immich.input;
  let parsedImmich: unknown;
  try { parsedImmich = JSON.parse((await boundedFile(root, immichPath, "Immich input")).toString("utf8")); }
  catch { fail("Immich input is not valid JSON"); }
  const immich = object(parsedImmich, "Immich input");
  if (Object.hasOwn(immich, "integrationNetwork")) {
    const homarr = object(immich.integrationNetwork, "Immich Homarr network");
    const homarrFields = ["id", "name", "owner"];
    if (Object.hasOwn(homarr, "internal")) homarrFields.push("internal");
    exact(homarr, homarrFields, "Immich Homarr network");
    if (homarr.id !== "homarr" || typeof homarr.name !== "string" || homarr.owner !== "external"
      || (homarr.internal !== undefined && typeof homarr.internal !== "boolean")) {
      fail("Immich Homarr network record is invalid");
    }
    if (homarr.name === network) fail("Vaultwarden route network must differ from the Homarr/media network");
  }

  const config = current.bundle.services.vaultwarden;
  const raw = await boundedFile(root, config.input, "Vaultwarden input", true);
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); }
  catch { fail("Vaultwarden input is not valid JSON"); }
  const vaultwarden = object(parsed, "Vaultwarden input");
  const vaultwardenKeys = ["schemaVersion", "project", "observed", "network", "apps"];
  if (Object.hasOwn(vaultwarden, "integrationNetwork")) {
    vaultwardenKeys.push("integrationNetwork");
  }
  exact(vaultwarden, vaultwardenKeys, "Vaultwarden input");
  if (vaultwarden.schemaVersion !== 1) fail("Vaultwarden input schema is invalid");
  const project = object(vaultwarden.project, "Vaultwarden project");
  const privateNetwork = object(vaultwarden.network, "Vaultwarden private network");
  const apps = object(vaultwarden.apps, "Vaultwarden apps");
  const vaultApp = object(apps.vaultwarden, "Vaultwarden app");
  let fresh: Awaited<ReturnType<typeof hostObservation>>;
  try {
    fresh = await hostObservation(root, inspectionPath, [vaultApp.publishedPort], true);
  } catch (error) {
    if (error instanceof Error && error.message === "Host inspection must fully observe Docker context and networks plus the listener probe") {
      fail("Route-network revision needs a complete fresh local Docker network observation and listener probe");
    }
    throw error;
  }
  if (fresh.dockerContext !== project.dockerContext) {
    fail("Route-network inspection Docker context differs from the Vaultwarden project");
  }
  if (!fresh.networks.some((entry) => entry.name === network)) {
    fail(`--network ${network} was not found in the complete fresh Docker network observation`);
  }
  if (project.id !== config.runId || project.root !== root || project.directory !== join(root, config.runId)
    || privateNetwork.id !== "private" || privateNetwork.name !== `${config.runId}-private`) {
    fail("Vaultwarden input does not belong to this exact bundle project");
  }
  if (network === privateNetwork.name) fail("Vaultwarden route network must differ from its private network");
  const revised = { ...vaultwarden, observed: observed(fresh),
    integrationNetwork: { id: "vaultwarden-route", name: network, owner: "external" } };
  await replacePrivateJson(root, config.input, revised);
  const updated = await load(root, input);
  if (updated.approval === current.approval) fail("Vaultwarden route-network revision did not change the bundle approval");
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-route-network", status: "revised",
    mutation: "owner-only-vaultwarden-input", bundle: current.bundle.id, network, previousApproval: current.approval,
    approval: updated.approval, next: `self-host bundle plan --project-root ${root} --input ${input}`,
    limits: ["No Docker network or container was changed.", "DNS, TLS, and intended-client trust remain separate checkpoints."] }, null, 2));
}

async function reviseMediaWebNetwork(root: string, input: string, flags: Record<string, string>,
  dependencies: Dependencies): Promise<void> {
  const current = await load(root, input);
  if (flags["--approve"] !== current.approval) fail("bundle route-network needs the exact approval from the unchanged bundle plan");
  const bundle = current.bundle;
  const directory = join(root, ".selfhost", "bundles", bundle.id);
  if (input !== join(directory, "household-bundle.json")
    || bundle.services.immich.input !== join(directory, "immich-input.json")
    || bundle.services.docmost.input !== join(directory, "docmost-input.json")) {
    fail("Media-web revision requires the original canonical bundle and app inputs; rerun bundle plan after an earlier revision");
  }
  const network = `autostack-${bundle.services.media.runId}_web`;
  const projectId = `autostack-${bundle.services.media.runId}`;
  if (flags["--network"] !== network) fail(`Media-web revision requires the exact media-owned network ${network}`);
  const mediaCapture = await captureStatus(() => dependencies.media(["status", "--project-root", root,
    "--run-id", bundle.services.media.runId, "--json", "yes"]));
  const summary = mediaSummary(mediaCapture, bundle.services.media.runId);
  if (!summary || summary.running !== MEDIA_SERVICES.length) {
    fail("Media-web revision needs the exact seven-service media run observed running first");
  }
  const immich = await privateBundleObject(root, bundle.services.immich.input, "Immich input");
  const docmost = await privateBundleObject(root, bundle.services.docmost.input, "Docmost input");
  const immichProject = exactBundleProject(immich.project, root, bundle.services.immich.runId, "Immich");
  const docmostProject = exactBundleProject(docmost.project, root, bundle.services.docmost.runId, "Docmost");
  if (immichProject.ownership !== "new" || docmostProject.ownership !== "new"
    || existsSync(String(immichProject.directory)) || existsSync(String(docmostProject.directory))
    || Object.hasOwn(immich, "integrationNetwork") || Object.hasOwn(docmost, "integrationNetwork")) {
    fail("Media-web revision applies before Immich or Docmost deployment and only to inputs without an existing integration network");
  }
  if (immichProject.dockerContext !== docmostProject.dockerContext) fail("App Docker contexts must match for one media-web revision");
  privateBundleUrl(immich.hostIp, immich.publishedPort, "Immich");
  privateBundleUrl(docmost.hostIp, docmost.publishedPort, "Docmost");
  const fresh = await hostObservation(root, flags["--host-inspection"],
    [Number(immich.publishedPort), Number(docmost.publishedPort)], true);
  if (fresh.dockerContext !== immichProject.dockerContext
    || !fresh.networks.some((entry) => entry.name === network)
    || fresh.exactPorts.some((entry) => [immich.publishedPort, docmost.publishedPort].includes(entry.port) && entry.inUse)) {
    fail("Fresh host inspection does not prove this Docker context, media web network, and unused app ports");
  }
  await (dependencies.inspectMediaWeb ?? inspectMediaWebNetwork)(fresh.dockerContext, network, projectId);

  const immichRevised = { ...immich, observed: observed(fresh),
    integrationNetwork: { id: "homarr", name: network, owner: "external", internal: true } };
  const docmostRevised = { ...docmost, observed: observed(fresh),
    integrationNetwork: { id: "web", name: network, owner: "external", internal: true } };
  const digest = createHash("sha256").update(JSON.stringify({ bundleApproval: current.approval, network,
    immichRevised, docmostRevised })).digest("hex").slice(0, 16);
  const immichPath = join(directory, `immich-input-web-${digest}.json`);
  const docmostPath = join(directory, `docmost-input-web-${digest}.json`);
  const artifacts = [
    { path: immichPath, value: immichRevised, name: "Immich web input" },
    { path: docmostPath, value: docmostRevised, name: "Docmost web input" },
  ];
  const created: string[] = [];
  try {
    for (const artifact of artifacts) {
      const expected = `${JSON.stringify(artifact.value, null, 2)}\n`;
      const present = await privateFileIfPresent(artifact.path, artifact.name);
      if (present !== null) {
        if (await readFile(present, "utf8") !== expected) fail(`${artifact.name} differs from the reviewed revision`);
      } else {
        await privateJson(artifact.path, artifact.value);
        created.push(artifact.path);
      }
    }
    const immichPlan = parsedStatus(await captureStatus(() => dependencies.immich(["plan", "--project-root", root,
      "--input", immichPath, "--run-id", bundle.services.immich.runId,
      "--account-file", bundle.services.immich.accountFile])));
    const docmostPlan = parsedStatus(await captureStatus(() => dependencies.docmost(["plan", "--project-root", root,
      "--input", docmostPath, "--run-id", bundle.services.docmost.runId,
      "--account-file", bundle.services.docmost.accountFile])));
    if (immichPlan?.status !== "pass" || immichPlan.kind !== "immich-v3.2.2-cli-plan"
      || docmostPlan?.status !== "pass" || docmostPlan.kind !== "docmost-v0.96.0-cli-plan") {
      fail("Revised Immich or Docmost adapter plan did not pass; the bundle input was not changed");
    }
    const unchanged = await load(root, input);
    if (unchanged.approval !== current.approval || existsSync(String(immichProject.directory))
      || existsSync(String(docmostProject.directory))) {
      fail("Bundle or app project changed during media-web revision; no bundle input was replaced");
    }
    const revisedBundle = structuredClone(bundle);
    revisedBundle.services.immich.input = immichPath;
    revisedBundle.services.docmost.input = docmostPath;
    await replacePrivateJson(root, input, revisedBundle);
  } catch (error) {
    for (const path of created) await rm(path);
    throw error;
  }
  const updated = await load(root, input);
  if (updated.approval === current.approval) fail("Media-web revision did not change the bundle approval");
  let mediaAccessLimit = "All-interface media host ports still require the separately confirmed router or Docker-aware firewall scope.";
  if (bundle.services.media.bindMode === "host-only" || bundle.services.media.adoptedMedia?.bind === "127.0.0.1") {
    mediaAccessLimit = "Media host ports are loopback-only; other devices need a separately approved private route.";
  } else if (bundle.services.media.mode === "adopt" && !bundle.services.media.adoptedMedia) {
    mediaAccessLimit = "Adopted media exposure is not bound in this older bundle input; inspect the CLI-owned media run before using its links.";
  }
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-route-network", status: "revised",
    mutation: "owner-only-bundle-and-app-inputs", bundle: bundle.id, network,
    files: [immichPath, docmostPath, input], previousApproval: current.approval, approval: updated.approval,
    next: `self-host bundle plan --project-root ${root} --input ${input}`,
    limits: ["No Docker network or container was changed.",
      "The two app inputs are not deployed; review their new adapter approvals before apply.",
      mediaAccessLimit] }, null, 2));
}

function safeAdapterFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return "adapter-status-error";
  if (error.message === "Docker daemon is unavailable"
    || error.message.startsWith("Docker daemon is unreachable from this invocation")
    || error.message === "Docker daemon identity is unavailable") {
    return "docker-daemon-unavailable; check Docker context and socket access";
  }
  if (error.message === "Media lifecycle Compose validation failed for this exact run") {
    return "media-compose-validation-failed";
  }
  if (error.message === "Saved media plan changed; prepare a new run before continuing"
    || error.message === "Media lifecycle approval no longer matches the current plan") {
    return "media-plan-or-approval-drift";
  }
  return "adapter-status-error";
}

async function captureStatus(command: () => Promise<void>): Promise<StatusCapture> {
  const priorLog = console.log;
  const priorError = console.error;
  const priorWrite = process.stdout.write;
  const priorErrorWrite = process.stderr.write;
  const priorExitCode = process.exitCode;
  let output = "";
  const append = (value: string): void => {
    if (Buffer.byteLength(output) + Buffer.byteLength(value) > MAX_INPUT) fail("Adapter status output exceeded the safe capture limit");
    output += value;
  };
  console.log = (...values: unknown[]) => { append(`${values.map((value) => String(value)).join(" ")}\n`); };
  console.error = (...values: unknown[]) => { append(`${values.map((value) => String(value)).join(" ")}\n`); };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    let value: string;
    if (typeof chunk === "string") value = chunk;
    else value = Buffer.from(chunk).toString("utf8");
    append(value);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    let value: string;
    if (typeof chunk === "string") value = chunk;
    else value = Buffer.from(chunk).toString("utf8");
    append(value);
    return true;
  }) as typeof process.stderr.write;
  process.exitCode = 0;
  try {
    await command();
    if (process.exitCode) return { ok: false, reason: "adapter-status-error" };
    return { ok: true, output };
  } catch (error) {
    return { ok: false, reason: safeAdapterFailureReason(error) };
  } finally {
    console.log = priorLog;
    console.error = priorError;
    process.stdout.write = priorWrite;
    process.stderr.write = priorErrorWrite;
    // Older Bun does not clear a nonzero code when assigned undefined.
    process.exitCode = 0;
    process.exitCode = priorExitCode;
  }
}

function parsedStatus(capture: StatusCapture): Record<string, any> | null {
  if (!capture.ok || capture.output.trim() === "") return null;
  try {
    const value = JSON.parse(capture.output);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  } catch {
    // Media status is bounded plain output from its exact session owner.
  }
  return null;
}

async function inspectDocmostAcceptance(bundle: Bundle, dependencies: Dependencies,
  ownerStatus: Record<string, any> | null): Promise<Record<string, any> | null> {
  if (ownerStatus?.owner?.recorded !== true) return null;
  const config = bundle.services.docmost;
  try {
    const input = object(JSON.parse((await boundedFile(bundle.projectRoot, config.input, "Docmost input", true)).toString("utf8")), "Docmost input");
    const project = object(input.project, "Docmost project").id;
    if (typeof project !== "string" || !ID.test(project)) return null;
    if (ownerStatus.schemaVersion !== 1 || ownerStatus.kind !== "docmost-cli-status"
      || ownerStatus.project !== project || ownerStatus.runId !== config.runId) return null;
    const value = parsedStatus(await captureStatus(() => dependencies.docmost([
      "accept", "status", "--project-root", bundle.projectRoot, "--input", config.input, "--run-id", config.runId,
    ])));
    if (!value || value.schemaVersion !== 1 || value.kind !== "docmost-v0.96.0-acceptance-status"
      || value.project !== project || value.runId !== config.runId
      || value.evidence !== "recorded-api-proof-not-live-recheck"
      || !["planned", "unknown-no-replay", "accepted", "verified-readback"].includes(value.status)
      || typeof value.interruptedTail !== "boolean" || typeof value.replayAllowed !== "boolean"
      || typeof value.verified !== "boolean"
      || typeof value.approval !== "string" || !new RegExp(`^ACCEPT-DOCMOST:${project}:[0-9a-f]{64}$`).test(value.approval)) return null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const field of ["pageId", "attachmentId"]) {
      if (value[field] !== null && (typeof value[field] !== "string" || !uuid.test(value[field]))) return null;
    }
    for (const field of ["recordedAt", "verificationRecordedAt"]) {
      if (value[field] !== null && (typeof value[field] !== "string" || !Number.isFinite(Date.parse(value[field])))) return null;
    }
    const stages = ["start", "write-login", "write-identity", "create-page", "edit-page", "upload-file",
      "read-login", "read-identity", "read-page", "read-attachment", "download-file", "accepted"];
    if (value.lastDurableStage !== null && !stages.includes(value.lastDurableStage)) return null;
    if (value.status === "planned") {
      if (!value.replayAllowed || value.verified || value.interruptedTail || value.lastDurableStage !== null
        || value.pageId !== null || value.attachmentId !== null || value.recordedAt !== null
        || value.verificationRecordedAt !== null) return null;
    } else {
      if (value.replayAllowed) return null;
      if (value.status === "accepted" && (value.interruptedTail || value.lastDurableStage !== "accepted"
        || !value.pageId || !value.attachmentId || !value.recordedAt || value.verified)) return null;
      if (value.status === "verified-readback" && (!value.verified || !value.pageId || !value.attachmentId
        || !value.verificationRecordedAt)) return null;
      if (value.status === "unknown-no-replay" && (value.verified || value.verificationRecordedAt !== null)) return null;
    }
    // Never spread adapter output: only these recorded, non-secret facts cross the boundary.
    return { schemaVersion: 1, kind: value.kind, project, runId: config.runId, status: value.status,
      approval: value.approval, evidence: "recorded-api-proof-not-live-recheck", replayAllowed: value.replayAllowed,
      interruptedTail: value.interruptedTail, lastDurableStage: value.lastDurableStage,
      pageId: value.pageId, attachmentId: value.attachmentId, recordedAt: value.recordedAt,
      verified: value.verified, verificationRecordedAt: value.verificationRecordedAt };
  } catch { return null; }
}

function docmostApiProof(value: Record<string, any> | null): boolean {
  return value?.status === "accepted" || value?.status === "verified-readback";
}

function newDocmostOwner(value: Record<string, any> | null): boolean {
  return value?.health === true && value?.checkpoint?.recorded === true && value?.owner?.recorded === true
    && value.owner.method === "setup-created" && value.owner.freshLogin === true;
}

async function manualDocmostOwner(bundle: Bundle, value: Record<string, any> | null): Promise<boolean> {
  const config = bundle.services.docmost;
  if (value?.schemaVersion !== 1 || value.kind !== "docmost-cli-status" || value.runId !== config.runId
    || value.checkpoint?.recorded !== true || value.owner?.recorded !== true
    || value.owner.method !== "existing-owner-login" || value.owner.freshLogin !== true
    || existsSync(join(bundle.projectRoot, ".selfhost", "docmost", config.runId, "acceptance-attempt.jsonl"))) return false;
  try {
    const input = object(JSON.parse((await boundedFile(bundle.projectRoot, config.input, "Docmost input", true)).toString("utf8")), "Docmost input");
    const project = object(input.project, "Docmost project").id;
    return typeof project === "string" && ID.test(project) && value.project === project;
  } catch { return false; }
}

function docmostAcceptancePlanReady(plan: Record<string, any> | null, status: Record<string, any>): boolean {
  return plan?.schemaVersion === 1 && plan.kind === "docmost-v0.96.0-acceptance-plan"
    && plan.project === status.project && plan.runId === status.runId && plan.status === "ready-for-approval"
    && plan.mutation === false && plan.attemptConsumed === false && plan.approval === status.approval
    && plan.contract === "9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af:accept-v2-mime-charset"
    && plan.digest === status.approval.split(":").at(-1);
}

function statusCheck(capture: StatusCapture): "returned" | "not-prepared" | "error" {
  if (capture.ok) return "returned";
  if (capture.reason === "not-prepared") return "not-prepared";
  return "error";
}

function booleanOrNull(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

const MEDIA_SERVICES = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"];
const MEDIA_PORT_KEYS = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
const MEDIA_STATES = new Set(["absent", "created", "restarting", "running", "removing", "paused", "exited", "dead"]);
const MEDIA_HEALTH = new Set(["unavailable", "starting", "healthy", "unhealthy"]);

function validAdoptedMediaFacts(value: unknown): value is AdoptedMediaFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const facts = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(facts).sort()) !== JSON.stringify(["approvalDigest", "bind", "ports", "source"])
    || facts.source !== "cli-managed-media-info" || !["127.0.0.1", "0.0.0.0"].includes(String(facts.bind))
    || typeof facts.approvalDigest !== "string" || !/^[0-9a-f]{64}$/.test(facts.approvalDigest)
    || !Array.isArray(facts.ports) || facts.ports.length !== MEDIA_SERVICES.length
    || facts.ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
    || new Set(facts.ports).size !== MEDIA_SERVICES.length) return false;
  return true;
}

function mediaInfoFacts(capture: StatusCapture, root: string, runId: string, username: string): AdoptedMediaFacts | null {
  const value = parsedStatus(capture);
  if (!value || value.schemaVersion !== 1 || value.projectRoot !== root || value.runId !== runId
    || value.composeProject !== `autostack-${runId}` || value.adminUsername !== username
    || value.approved !== true || typeof value.ports !== "object" || !value.ports || Array.isArray(value.ports)
    || JSON.stringify(Object.keys(value.ports).sort()) !== JSON.stringify([...MEDIA_PORT_KEYS].sort())) return null;
  const ports: number[] = [];
  for (const key of MEDIA_PORT_KEYS) {
    const port = value.ports[key];
    if (typeof port !== "string" || !/^[1-9][0-9]{0,4}$/.test(port)) return null;
    ports.push(Number(port));
  }
  const facts = { source: "cli-managed-media-info", bind: value.bind, ports,
    approvalDigest: value.approvalDigest };
  if (!validAdoptedMediaFacts(facts)) return null;
  return facts;
}

function mediaSummary(capture: StatusCapture, runId: string): MediaSummary | null {
  const value = parsedStatus(capture);
  if (!value) return null;
  try {
    exact(value, ["schemaVersion", "kind", "provenance", "runId", "composeProject", "services", "summary"], "media status");
    if (value.schemaVersion !== 1 || value.kind !== "selfhost-media-status" || value.provenance !== "cli-managed" || value.runId !== runId
      || value.composeProject !== `autostack-${runId}` || !Array.isArray(value.services)
      || value.services.length !== MEDIA_SERVICES.length) return null;
    const seen = new Set<string>();
    for (const entry of value.services) {
      const record = object(entry, "media service status");
      exact(record, ["service", "present", "state", "running", "health"], "media service status");
      if (typeof record.service !== "string" || !MEDIA_SERVICES.includes(record.service) || seen.has(record.service)
        || typeof record.present !== "boolean" || typeof record.state !== "string" || !MEDIA_STATES.has(record.state)
        || typeof record.running !== "boolean" || typeof record.health !== "string" || !MEDIA_HEALTH.has(record.health)) return null;
      if (record.present !== (record.state !== "absent") || record.running !== (record.state === "running")) return null;
      if (!record.present && record.health !== "unavailable") return null;
      seen.add(record.service);
    }
    if (seen.size !== MEDIA_SERVICES.length) return null;
    const summary = object(value.summary, "media status summary");
    exact(summary, ["expected", "present", "running", "healthy", "unhealthy", "starting", "healthUnavailable"], "media status summary");
    const services = value.services as Array<Record<string, unknown>>;
    const expected: MediaSummary = {
      expected: MEDIA_SERVICES.length,
      present: services.filter((entry) => entry.present === true).length,
      running: services.filter((entry) => entry.running === true).length,
      healthy: services.filter((entry) => entry.health === "healthy").length,
      unhealthy: services.filter((entry) => entry.health === "unhealthy").length,
      starting: services.filter((entry) => entry.health === "starting").length,
      healthUnavailable: services.filter((entry) => entry.health === "unavailable").length,
    };
    for (const [name, count] of Object.entries(expected)) {
      if (summary[name] !== count) return null;
    }
    return expected;
  } catch {
    return null;
  }
}

async function inspectFinalization(bundle: Bundle, input: string, dependencies: Dependencies): Promise<Record<string, unknown>> {
  const evidence = join(dirname(input), "finalization-evidence.json");
  const summary: Record<string, unknown> = {
    status: "missing", independentlyVerified: false, currentRuntimeVerified: false,
    checkpointWritten: false,
    scope: "Read-only reassessment of current operator evidence, not comparison with a saved checkpoint or a fresh runtime probe.",
  };
  if (!existsSync(evidence)) return summary;
  const args = ["finalize", "status", "--project-root", bundle.projectRoot, "--input", input, "--evidence", evidence];
  const captured = await captureStatus(() => (dependencies.assessFinalization ?? bundleFinalizeCommand)(args));
  const assessment = parsedStatus(captured);
  if (!assessment || assessment.kind !== "household-bundle-finalization-assessment"
    || assessment.bundleId !== bundle.id || assessment.projectRoot !== bundle.projectRoot
    || !["recorded", "blocked"].includes(assessment.status)
    || assessment.independentlyVerified !== false || assessment.mutation !== false
    || !Array.isArray(assessment.mutationsPerformed) || assessment.mutationsPerformed.length !== 0) {
    return { ...summary, status: "unavailable", reason: "invalid-or-unavailable-finalization-evidence", reviewCommand: args };
  }
  return { ...summary, status: assessment.status, reviewCommand: args,
    allRequiredDeclarationsPassing: assessment.status === "recorded" };
}

async function printAggregateStatus(bundle: Bundle, input: string, dependencies: Dependencies,
  localHttps: LocalHttpsSelection | null, approval: string): Promise<void> {
  const root = bundle.projectRoot;
  const privateHttps = await vaultwardenHttpsState(root, bundle.services.vaultwarden.httpsPlan);
  const mediaRunId = bundle.services.media.runId;
  const media = await captureStatus(() => dependencies.media(["status", "--project-root", root, "--run-id", mediaRunId, "--json", "yes"]));
  const immich = await captureStatus(() => dependencies.immich(["status", "--project-root", root, "--input", bundle.services.immich.input]));
  const docmost = await captureStatus(() => dependencies.docmost(["status", "--project-root", root, "--input", bundle.services.docmost.input,
    "--run-id", bundle.services.docmost.runId]));
  const vaultwardenRun = join(root, ".selfhost", "vaultwarden", bundle.services.vaultwarden.runId);
  let vaultwarden: StatusCapture = { ok: false, reason: "not-prepared" };
  if (existsSync(vaultwardenRun)) {
    vaultwarden = await captureStatus(() => dependencies.vaultwarden(["status", "--project-root", root,
      "--run-id", bundle.services.vaultwarden.runId]));
  }
  const immichValue = parsedStatus(immich);
  const docmostValue = parsedStatus(docmost);
  const docmostAcceptance = await inspectDocmostAcceptance(bundle, dependencies, docmostValue);
  const vaultwardenValue = parsedStatus(vaultwarden);
  const mediaValue = mediaSummary(media, mediaRunId);
  let immichPhase = "status-unavailable";
  if (immichValue?.status === "planned") immichPhase = "planned";
  if (immichValue?.status === "observed") immichPhase = "observed";
  if (immichValue?.status === "observed" && immichValue.initialized === true && immichValue.setupEnabled === true) {
    immichPhase = "initialized-awaiting-setup-closure";
  }
  if (immichValue?.status === "observed" && immichValue.initialized === true && immichValue.setupEnabled === false) {
    immichPhase = "setup-closed-awaiting-acceptance";
  }
  let docmostPhase = "status-unavailable";
  if (docmostValue) docmostPhase = "not-applied";
  if (docmostValue?.checkpoint?.recorded === true) docmostPhase = "applied-awaiting-owner";
  if (docmostValue?.owner?.recorded === true) docmostPhase = "owner-api-recorded-awaiting-acceptance";
  if (docmostApiProof(docmostAcceptance)) docmostPhase = "api-proof-recorded-awaiting-browser-and-homarr";
  let vaultwardenPhase = "not-prepared";
  if (!privateHttps.ready) {
    vaultwardenPhase = "awaiting-private-https";
  }
  if (statusCheck(vaultwarden) === "error") vaultwardenPhase = "status-unavailable";
  if (vaultwardenValue?.registrationClosure?.applied === true) vaultwardenPhase = "registration-closed-awaiting-acceptance";
  else if (vaultwardenValue?.bootstrap?.applied === true && vaultwardenValue?.accountBootstrap?.evidenceRecorded === true) {
    vaultwardenPhase = "signup-evidence-recorded-awaiting-registration-closure";
  }
  else if (vaultwardenValue?.bootstrap?.applied === true) vaultwardenPhase = "bootstrap-applied-awaiting-browser";
  else if (vaultwardenValue) vaultwardenPhase = "prepared-awaiting-apply";
  let mediaPhase = "status-unavailable";
  if (mediaValue && mediaValue.present === 0) mediaPhase = "not-created";
  else if (mediaValue && mediaValue.running === MEDIA_SERVICES.length) mediaPhase = "seven-services-running";
  else if (mediaValue && mediaValue.running === 0) mediaPhase = "services-present-not-running";
  else if (mediaValue) mediaPhase = "services-partially-running";
  const mediaObservations: Record<string, unknown> = {
    structuredStatus: false,
    expectedServices: null,
    presentServices: null,
    runningServices: null,
    allRunning: null,
    health: null,
    accepted: false,
  };
  if (mediaValue) {
    mediaObservations.structuredStatus = true;
    mediaObservations.expectedServices = mediaValue.expected;
    mediaObservations.presentServices = mediaValue.present;
    mediaObservations.runningServices = mediaValue.running;
    mediaObservations.allRunning = mediaValue.running === MEDIA_SERVICES.length;
    mediaObservations.health = { healthy: mediaValue.healthy, unhealthy: mediaValue.unhealthy,
      starting: mediaValue.starting, unavailable: mediaValue.healthUnavailable };
  }
  let docmostIncompleteGates = ["fresh-client login", "page edit", "attachment", "Homarr tile read-back"];
  if (docmostApiProof(docmostAcceptance)) docmostIncompleteGates = ["browser-client login and editor rendering", "Homarr tile read-back"];
  const services = [
    { service: "media", statusCheck: statusCheck(media), phase: mediaPhase,
      observations: mediaObservations,
      incompleteGates: ["seven-service direct verification", "Homarr board and widget read-back"],
      optionalChoice: "Indexer configuration and content requests are separate, user-approved choices; their omission is not a failed setup gate." },
    { service: "immich", statusCheck: statusCheck(immich), phase: immichPhase,
      observations: { initialized: booleanOrNull(immichValue?.initialized), setupEnabled: booleanOrNull(immichValue?.setupEnabled), accepted: false },
      incompleteGates: ["managed owner login", "upload and retrieval", "Homarr tile and integration read-back"] },
    { service: "docmost", statusCheck: statusCheck(docmost), phase: docmostPhase,
      observations: { health: booleanOrNull(docmostValue?.health), checkpointRecorded: docmostValue?.checkpoint?.recorded === true,
        ownerRecorded: docmostValue?.owner?.recorded === true, apiAcceptance: docmostAcceptance, accepted: false },
      incompleteGates: docmostIncompleteGates },
    { service: "vaultwarden", statusCheck: statusCheck(vaultwarden), phase: vaultwardenPhase,
      observations: { bootstrapApplied: vaultwardenValue?.bootstrap?.applied === true,
        signupEvidenceRecorded: vaultwardenValue?.accountBootstrap?.evidenceRecorded === true,
        registrationClosureApplied: vaultwardenValue?.registrationClosure?.applied === true, runtimeInspected: false, accepted: false },
      incompleteGates: ["trusted private HTTPS runtime", "fresh vault login and unlock", "registration rejection", "Homarr tile read-back"] },
  ];
  const errors = services.filter((entry) => entry.statusCheck === "error")
    .map((entry) => ({ service: entry.service, reason: "adapter-status-error" }));
  if (media.ok && !mediaValue) errors.push({ service: "media", reason: "invalid-adapter-status" });
  let routeLifecycle: Record<string, unknown> = {
    included: false,
    status: "separate-owner",
    warning: `Private HTTPS route lifecycle remains owned by ${privateHttps.routeOwner}; pass an already-applied local route explicitly to include it.`,
  };
  if (localHttps) {
    try {
      routeLifecycle = { included: true, status: "bound", ...await validatedLocalHttps(bundle, localHttps, dependencies) };
    } catch {
      routeLifecycle = { included: true, status: "invalid", warning: "The selected local HTTPS route is not safely bound to this bundle." };
      errors.push({ service: "local-https", reason: "invalid-or-unavailable-route" });
    }
  }
  const vaultInput = await privateBundleObject(root, bundle.services.vaultwarden.input, "Vaultwarden input");
  let backendPortMatchesApp = false;
  const vaultProject = vaultInput.project;
  let matchingProject = false;
  if (vaultInput.schemaVersion === 1 && vaultProject && typeof vaultProject === "object"
    && !Array.isArray(vaultProject)) {
    const projectRecord = vaultProject as Record<string, unknown>;
    matchingProject = projectRecord.id === bundle.services.vaultwarden.runId
      && projectRecord.root === root
      && projectRecord.directory === join(root, bundle.services.vaultwarden.runId);
  }
  if (matchingProject && vaultInput.apps && typeof vaultInput.apps === "object" && !Array.isArray(vaultInput.apps)) {
    const vaultApps = vaultInput.apps as Record<string, unknown>;
    if (vaultApps.vaultwarden && typeof vaultApps.vaultwarden === "object"
      && !Array.isArray(vaultApps.vaultwarden)) {
      backendPortMatchesApp = (vaultApps.vaultwarden as Record<string, unknown>).publishedPort === privateHttps.backendHostPort;
    }
  }
  let vaultwardenRouteNetwork: string | null = null;
  if (Object.hasOwn(vaultInput, "integrationNetwork")) {
    const route = requireRecord(vaultInput.integrationNetwork, "Vaultwarden route network");
    exact(route, ["id", "name", "owner"], "Vaultwarden route network");
    if (route.id !== "vaultwarden-route" || route.owner !== "external"
      || typeof route.name !== "string" || !NETWORK.test(route.name)) {
      fail("Vaultwarden route network is not a valid externally owned bridge");
    }
    vaultwardenRouteNetwork = route.name;
  }
  let parallelApply: Record<string, unknown> = { status: "not-started", jobs: [] };
  try {
    const ledger = await readParallelLedger(bundle, input);
    if (ledger) {
      parallelApply = { status: "recorded", path: parallelLedgerPath(bundle, input),
        bundleApprovalMatches: ledger.approvalSha256 === createHash("sha256").update(approval).digest("hex"),
        startedAt: ledger.startedAt, updatedAt: ledger.updatedAt,
        jobs: ledger.jobs.map((job) => ({ id: job.id, needs: job.needs, service: job.service,
          projectId: job.projectId, port: job.port, status: job.status, updatedAt: job.updatedAt })),
        next: "Inspect each adapter checkpoint. Parallel apply will not replay a recorded run; separate recovery needs its own reviewed adapter path." };
    }
  } catch {
    parallelApply = { status: "invalid-needs-inspection", path: join(root, ".selfhost", "bundles", bundle.id, "parallel-apply.json"),
      next: "Inspect the owner-only parallel job history before any parallel apply or recovery." };
    errors.push({ service: "parallel-apps", reason: "invalid-job-history" });
  }
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-status", bundle: bundle.id, projectRoot: root,
    status: "incomplete", mutation: false, fullAcceptance: false,
    privateHttps: { ...privateHttps, backendPortMatchesApp, vaultwardenRouteNetwork, lifecycle: routeLifecycle }, services, parallelApply,
    errors,
    finalizationEvidence: await inspectFinalization(bundle, input, dependencies),
    recovery: { status: "not-verified", selectedByBundle: false, dataProtectionVerified: false,
      scope: "Backup protection is a separate selected extension. Require isolated restore proof before claiming recovery or migrating real vault contents." },
    scope: "Read-only adapter status aggregation. Status checkpoints do not prove application, Homarr, timing, or recovery acceptance." }, null, 2));
}

async function inspectBundle(bundle: Bundle, dependencies: Dependencies): Promise<BundleInspection> {
  const root = bundle.projectRoot;
  const privateHttps = await vaultwardenHttpsState(root, bundle.services.vaultwarden.httpsPlan);
  const mediaRunId = bundle.services.media.runId;
  const media = await captureStatus(() => dependencies.media([
    "status", "--project-root", root, "--run-id", mediaRunId, "--json", "yes",
  ]));
  const immich = await captureStatus(() => dependencies.immich([
    "status", "--project-root", root, "--input", bundle.services.immich.input,
  ]));
  const docmost = await captureStatus(() => dependencies.docmost([
    "status", "--project-root", root, "--input", bundle.services.docmost.input,
    "--run-id", bundle.services.docmost.runId,
  ]));
  const docmostValue = parsedStatus(docmost);
  const docmostAcceptance = await inspectDocmostAcceptance(bundle, dependencies, docmostValue);
  const vaultwardenRun = join(root, ".selfhost", "vaultwarden", bundle.services.vaultwarden.runId);
  let vaultwarden: StatusCapture = { ok: false, reason: "not-prepared" };
  if (existsSync(vaultwardenRun)) {
    vaultwarden = await captureStatus(() => dependencies.vaultwarden([
      "status", "--project-root", root, "--run-id", bundle.services.vaultwarden.runId,
    ]));
  }
  return {
    privateHttps,
    media,
    mediaSummary: mediaSummary(media, mediaRunId),
    immich,
    immichValue: parsedStatus(immich),
    docmost,
    docmostValue,
    docmostAcceptance,
    vaultwarden,
    vaultwardenValue: parsedStatus(vaultwarden),
  };
}

async function appliedLifecycleReady(bundle: Bundle, dependencies: Dependencies): Promise<boolean> {
  const root = bundle.projectRoot;
  const checks: StatusCapture[] = [];
  checks.push(await captureStatus(() => dependencies.media([
    "lifecycle-check", "--project-root", root, "--run-id", bundle.services.media.runId,
  ])));
  checks.push(await captureStatus(() => dependencies.immich([
    "lifecycle-check", "--project-root", root, "--input", bundle.services.immich.input,
  ])));
  checks.push(await captureStatus(() => dependencies.docmost([
    "lifecycle-check", "--project-root", root, "--input", bundle.services.docmost.input,
    "--run-id", bundle.services.docmost.runId,
  ])));
  checks.push(await captureStatus(() => dependencies.vaultwarden([
    "lifecycle-check", "--project-root", root, "--run-id", bundle.services.vaultwarden.runId,
  ])));
  return checks.every((check) => check.ok);
}

function stageCommand(bundle: Bundle, input: string, service: Service, phase: string,
  approval?: string, stageApproval?: string, firewallScope?: string): string[] {
  const command = ["self-host", "bundle", "stage", "--project-root", bundle.projectRoot,
    "--input", input, "--service", service, "--phase", phase];
  if (approval) command.push("--approve", approval);
  if (stageApproval) command.push("--stage-approve", stageApproval);
  if (firewallScope) command.push("--firewall-scope", firewallScope);
  return command;
}

function mediaFirewallScope(flags: Record<string, string>): string | null {
  const scope = flags["--firewall-scope"];
  if (!scope) return null;
  if (scope !== "router-private" && scope !== "docker-aware-private") {
    fail("--firewall-scope needs router-private or docker-aware-private after checking the actual policy");
  }
  return scope;
}

function bundleCommandArgs(action: string, bundle: Bundle, input: string): string[] {
  return ["self-host", "bundle", action, "--project-root", bundle.projectRoot, "--input", input];
}

function parseCaddyInputs(args: string[]) {
  const action = args[0];
  if (action !== "plan" && action !== "apply") fail("Use bundle caddy-inputs plan or apply");
  const flags: Record<string, string> = {};
  const allowed = new Set(["--project-root", "--input", "--host-inspection", "--caddy-image", "--vaultwarden-network-subnet", "--ingress-network-subnet", "--approve"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated bundle caddy-inputs option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  for (const name of ["--project-root", "--input", "--host-inspection"]) {
    if (!flags[name]) fail(`bundle caddy-inputs needs ${name}`);
  }
  if (action === "plan" && flags["--approve"]) fail("bundle caddy-inputs plan is read-only and does not accept approval");
  if (action === "apply" && !flags["--approve"]) fail("bundle caddy-inputs apply needs the exact generated approval");
  return { action, flags };
}

async function caddyInputs(current: Awaited<ReturnType<typeof load>>, input: string,
  flags: Record<string, string>, action: "plan" | "apply", dependencies: Dependencies): Promise<void> {
  const bundle = current.bundle;
  const root = bundle.projectRoot;
  const https = await vaultwardenHttpsState(root, bundle.services.vaultwarden.httpsPlan);
  const origin = new URL(https.origin);
  if (origin.hostname !== "vaultwarden.localhost" || !origin.port || Number(origin.port) < 1024
    || https.routeOwner !== https.tlsOwner || !ID.test(https.routeOwner)) {
    fail("Generated shared Caddy routes need a host-only vaultwarden.localhost high-port origin with one bounded route/TLS owner");
  }
  const edgeId = https.routeOwner;
  const httpsPort = Number(origin.port);
  const edgeDirectory = join(root, edgeId);
  const outputDirectory = join(root, ".selfhost", "bundles", bundle.id, "caddy");
  if (existsSync(edgeDirectory)) fail("The selected Caddy project already exists; inspect its owner instead of generating a new route");
  const inspection = await hostObservation(root, flags["--host-inspection"], [httpsPort], true);
  if (inspection.exactPorts.some((entry) => entry.port === httpsPort && entry.inUse)
    || inspection.ports.some((entry) => entry.protocol === "tcp" && entry.published === httpsPort)) {
    fail("The selected private HTTPS port is already observed in use");
  }
  const mediaProject = `autostack-${bundle.services.media.runId}`;
  const mediaWeb = `${mediaProject}_web`;
  let vaultwardenNetworkSubnet: string | undefined;
  let ingressNetworkSubnet: string | undefined;
  if (flags["--vaultwarden-network-subnet"]) vaultwardenNetworkSubnet = parsePrivateNetworkSubnet(flags["--vaultwarden-network-subnet"]);
  if (flags["--ingress-network-subnet"]) ingressNetworkSubnet = parsePrivateNetworkSubnet(flags["--ingress-network-subnet"]);
  if (!inspection.networks.some((entry) => entry.name === mediaWeb)) {
    fail("Apply media first, then refresh host inspection with its observed internal web network");
  }
  await (dependencies.inspectMediaWeb ?? inspectMediaWebNetwork)(inspection.dockerContext, mediaWeb, mediaProject);
  const selectedSubnets: string[] = [];
  if (bundle.services.media.networkSubnets) selectedSubnets.push(bundle.services.media.networkSubnets.default, bundle.services.media.networkSubnets.web);
  for (const [service, expectedId] of [["immich", "homarr"], ["docmost", "web"]] as const) {
    const serviceInput = bundle.services[service].input;
    const raw = requireRecord(JSON.parse((await boundedFile(root, serviceInput, `${service} input`, true)).toString("utf8")), `${service} input`);
    const network = requireRecord(raw.integrationNetwork, `${service} integration network`);
    if (network.id !== expectedId || network.name !== mediaWeb || network.owner !== "external" || network.internal !== true) {
      fail(`Bind only ${service}'s application container to the verified media web network before generating Caddy routes`);
    }
    let appSubnet: unknown;
    if (service === "immich") appSubnet = requireRecord(raw.network, "Immich network").subnet;
    if (service === "docmost") appSubnet = raw.networkSubnet;
    if (appSubnet !== undefined) selectedSubnets.push(parsePrivateNetworkSubnet(appSubnet));
  }
  const vaultInput = requireRecord(JSON.parse((await boundedFile(root, bundle.services.vaultwarden.input,
    "Vaultwarden input", true)).toString("utf8")), "Vaultwarden input");
  const vaultApps = requireRecord(vaultInput.apps, "Vaultwarden apps");
  const vaultApp = requireRecord(vaultApps.vaultwarden, "Vaultwarden app");
  const vaultwardenHostPort = Number(vaultApp.publishedPort);
  if (!Number.isInteger(vaultwardenHostPort) || vaultwardenHostPort < 1024 || vaultwardenHostPort > 65535) {
    fail("Shared Caddy plan needs the exact selected Vaultwarden host port");
  }
  if (Object.hasOwn(vaultInput, "integrationNetwork")) {
    fail("The fresh Caddy-owned Vaultwarden bridge must be created before attaching Vaultwarden to it");
  }
  const vaultAppSubnet = requireRecord(vaultInput.network, "Vaultwarden network").subnet;
  if (vaultAppSubnet !== undefined) selectedSubnets.push(parsePrivateNetworkSubnet(vaultAppSubnet));
  if (vaultwardenNetworkSubnet) selectedSubnets.push(vaultwardenNetworkSubnet);
  if (ingressNetworkSubnet) selectedSubnets.push(ingressNetworkSubnet);
  assertNonOverlappingPrivateSubnets(selectedSubnets);
  const vaultNetwork = `${edgeId}-vaultwarden`;
  if (inspection.networks.some((entry) => entry.name === vaultNetwork)) {
    fail("The dedicated Vaultwarden upstream network already exists; inspect its owner before reusing it");
  }
  let caddyImage = flags["--caddy-image"];
  if (!caddyImage) caddyImage = await immutableImage(CADDY_TAG, dependencies.inspectImage ?? inspectRegistryImage);
  if (!CADDY_IMAGE.test(caddyImage)) fail("Caddy needs one reviewed official version tag and immutable digest");
  const routes = [
    { id: "homarr", upstream: "homarr", port: 7575, network: "media-web" },
    { id: "jellyfin", upstream: "jellyfin", port: 8096, network: "media-web" },
    { id: "seerr", upstream: "seerr", port: 5055, network: "media-web" },
    { id: "immich", upstream: "immich-server", port: 2283, network: "media-web" },
    { id: "docmost", upstream: "docmost", port: 3000, network: "media-web" },
    { id: "vaultwarden", upstream: "vaultwarden", port: 8080, network: "vaultwarden" },
  ];
  const plans = routes.map((route) => {
    const plan = buildIngressPlan({ schemaVersion: 1,
      service: { id: route.id, class: "application", internalPort: route.port },
      facts: { ownership: { ports: [{ port: httpsPort, owner: edgeId }] } },
      preferences: { route: "caddy-private", hostname: `${route.id}.localhost`, clientTrustPlanned: true,
        caddy: { owner: edgeId, runtime: "container", upstreamHost: route.upstream, clientScope: "host-only",
          hostBindAddress: "127.0.0.1", httpsPort, configPath: join(edgeDirectory, "config"),
          dataPath: join(edgeDirectory, "data") } } });
    if (plan.status !== "pass") fail(`Private ingress plan for ${route.id} did not pass`);
    return { name: `${route.id}-plan.json`, value: plan };
  });
  const caddyInput = { schemaVersion: 1, project: project(root, edgeId, inspection.dockerContext), caddyImage,
    routes: routes.map((route) => ({ planPath: join(outputDirectory, `${route.id}-plan.json`), network: route.network })),
    upstreamNetworks: [
      { id: "media-web", name: mediaWeb, owner: "external", internal: true },
      { id: "vaultwarden", name: vaultNetwork, owner: edgeId, internal: true, ownership: "new" },
    ],
    observed: observed(inspection),
    portObservation: { hostIp: "127.0.0.1", port: httpsPort, protocol: "tcp", inUse: false, checkedAt: inspection.checkedAt } };
  if (vaultwardenNetworkSubnet) Object.assign(caddyInput.upstreamNetworks[1], { subnet: vaultwardenNetworkSubnet });
  if (ingressNetworkSubnet) Object.assign(caddyInput, { ingressSubnet: ingressNetworkSubnet });
  const files = [...plans, { name: "shared-caddy.json", value: caddyInput }];
  const approval = `CADDY-INPUTS:${bundle.id}:${createHash("sha256").update(JSON.stringify({
    bundleApproval: current.approval, hostInspection: createHash("sha256").update(await boundedFile(root,
      flags["--host-inspection"], "host inspection", true)).digest("hex"), files,
  })).digest("hex")}`;
  const output = { schemaVersion: 1, kind: "household-caddy-inputs", bundle: bundle.id,
    status: "ready-for-review", mutation: false, approval, input: join(outputDirectory, "shared-caddy.json"), caddyImage,
    vaultwardenHostPort,
    routes: routes.map((route) => ({ service: route.id, origin: `https://${route.id}.localhost:${httpsPort}`,
      upstreamNetwork: route.network })),
    networks: { mediaWeb, vaultwarden: vaultNetwork, vaultwardenSubnet: vaultwardenNetworkSubnet ?? "automatic", ingressSubnet: ingressNetworkSubnet ?? "automatic" },
    scope: "Host-only Caddy plan inputs. This does not apply Docker, prove client CA trust, or accept an application." };
  if (action === "plan") {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (flags["--approve"] !== approval) fail("bundle caddy-inputs apply needs the exact approval from its unchanged plan");
  if (existsSync(outputDirectory)) fail("Caddy input directory already exists; use its saved files or inspect ownership");
  await mkdir(outputDirectory, { mode: 0o700 });
  try {
    for (const file of files) await privateJson(join(outputDirectory, file.name), file.value);
  } catch (error) {
    await rm(outputDirectory, { recursive: true });
    throw error;
  }
  console.log(JSON.stringify({ ...output, status: "created", mutation: "owner-only-caddy-inputs",
    next: `self-host caddy-private plan --project-root ${root} --input ${join(outputDirectory, "shared-caddy.json")}` }, null, 2));
}

function nextOutput(bundle: Bundle, inspection: BundleInspection, next: Record<string, unknown>, deferred: string[]): void {
  const checks = {
    media: statusCheck(inspection.media),
    immich: statusCheck(inspection.immich),
    docmost: statusCheck(inspection.docmost),
    vaultwarden: statusCheck(inspection.vaultwarden),
  };
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "household-bundle-next",
    status: "action-required",
    mutation: false,
    executionPerformed: false,
    bundle: bundle.id,
    projectRoot: bundle.projectRoot,
    adapterChecks: checks,
    optionalAppChecks: { docmost: inspection.docmostManualAcceptance ?? null },
    next,
    deferredGates: deferred,
    scope: "Read-only coordinator. One returned command or checkpoint is not full installation or acceptance.",
  }, null, 2));
}

type BundleNextOutput = {
  adapterChecks: Record<string, string>;
  bundle: string;
  deferredGates: string[];
  executionPerformed: false;
  kind: "household-bundle-next";
  mutation: false;
  next: Record<string, any>;
  projectRoot: string;
  schemaVersion: 1;
  scope: string;
  status: "action-required";
};

async function captureNext(current: Awaited<ReturnType<typeof load>>, input: string,
  flags: Record<string, string>, dependencies: Dependencies): Promise<BundleNextOutput> {
  const priorLog = console.log;
  let output = "";
  console.log = (...values: unknown[]) => {
    output += `${values.map((value) => String(value)).join(" ")}\n`;
    if (Buffer.byteLength(output) > MAX_INPUT) fail("Bundle coordinator output exceeded the safe capture limit");
  };
  try {
    await printNext(current, input, flags, dependencies);
  } finally {
    console.log = priorLog;
  }
  let value: Record<string, any> | null = null;
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed;
  } catch {
    fail("Bundle coordinator returned invalid JSON output");
  }
  if (!value || value.schemaVersion !== 1 || value.kind !== "household-bundle-next"
    || value.bundle !== current.bundle.id || value.projectRoot !== current.bundle.projectRoot
    || value.mutation !== false || value.executionPerformed !== false || !Array.isArray(value.deferredGates)) {
    fail("Bundle coordinator returned invalid structured output");
  }
  const next = object(value.next, "bundle next action");
  if (typeof next.checkpoint !== "string" || typeof next.service !== "string"
    || (next.command !== null && (!Array.isArray(next.command)
      || next.command.some((entry: unknown) => typeof entry !== "string")))) {
    fail("Bundle coordinator returned an invalid next action");
  }
  return value as BundleNextOutput;
}

function runCommandArgs(bundle: Bundle, input: string, flags: Record<string, string>): string[] {
  const command = bundleCommandArgs("run", bundle, input);
  if (flags["--approve"]) command.push("--approve", flags["--approve"]);
  if (flags["--stage-approve"]) command.push("--stage-approve", flags["--stage-approve"]);
  if (flags["--firewall-scope"]) command.push("--firewall-scope", flags["--firewall-scope"]);
  if (flags["--defer-indexer"]) command.push("--defer-indexer");
  if (flags["--local-https-input"]) {
    command.push("--local-https-input", flags["--local-https-input"],
      "--local-https-run-id", flags["--local-https-run-id"]);
  }
  return command;
}

function automaticRunCheckpoint(checkpoint: string): boolean {
  return new Set([
    "prepare-media-plan",
    "apply-or-resume-media",
    "inspect-adopted-media-lifecycle",
    "inspect-immich-status",
    "apply-immich",
    "bootstrap-immich",
    "close-setup-immich",
    "inspect-docmost-status",
    "apply-docmost",
    "apply-docmost-owner",
    "apply-docmost-acceptance",
    "prepare-vaultwarden-plan",
    "apply-vaultwarden-bootstrap",
    "restart-applied-bundle",
  ]).has(checkpoint);
}

function runMutation(command: string[]): boolean {
  if (command[2] === "up") return true;
  if (command[2] !== "stage") return false;
  const phaseIndex = command.indexOf("--phase");
  if (phaseIndex === -1) return false;
  return ["prepare", "apply", "bootstrap", "close-setup", "recover-plan", "close-registration", "owner-apply", "accept-apply"]
    .includes(command[phaseIndex + 1]);
}

async function runBundle(current: Awaited<ReturnType<typeof load>>, input: string,
  originalFlags: Record<string, string>, dependencies: Dependencies): Promise<void> {
  const flags = { ...originalFlags };
  const steps: Array<{ checkpoint: string; service: string; mutation: boolean; status: string }> = [];
  const seen = new Set<string>();
  let finalDecision: BundleNextOutput | null = null;
  let status = "action-required";
  let failure: string | null = null;
  let failedCommand: string[] | null = null;
  let diagnosisCommand: string[] | null = null;
  let approvalChanged = false;
  let stageApprovalConsumed = false;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const refreshed = await load(current.bundle.projectRoot, input);
    if (flags["--approve"] && flags["--approve"] !== refreshed.approval) {
      delete flags["--approve"];
      delete flags["--stage-approve"];
      delete flags["--firewall-scope"];
      delete flags["--defer-indexer"];
      approvalChanged = true;
    }
    const decision = await captureNext(refreshed, input, flags, dependencies);
    finalDecision = decision;
    const checkpoint = decision.next.checkpoint as string;
    const command = decision.next.command as string[] | null;
    if (!command || !automaticRunCheckpoint(checkpoint)) {
      if (typeof decision.next.afterApproval === "string") status = "approval-required";
      else status = "manual-checkpoint";
      break;
    }
    if (command[0] !== "self-host" || command[1] !== "bundle" || command[2] === "run") {
      fail("Bundle coordinator returned an unsupported automatic command");
    }
    const signature = `${checkpoint}\n${JSON.stringify(command)}`;
    if (seen.has(signature)) {
      status = "stalled";
      failure = "The same safe checkpoint remained after execution; inspect its adapter status before resuming.";
      break;
    }
    seen.add(signature);
    const mutation = runMutation(command);
    const result = await captureStatus(() => bundleCommand(command.slice(2), dependencies));
    steps.push({ checkpoint, service: String(decision.next.service), mutation,
      status: result.ok ? "completed" : "failed" });
    if (!result.ok) {
      status = "stage-failed";
      failure = result.reason;
      failedCommand = command;
      const service = decision.next.service;
      if (["media", "immich", "docmost", "vaultwarden"].includes(service)) {
        diagnosisCommand = stageCommand(refreshed.bundle, input, service as Service, "status");
        if (checkpoint === "apply-docmost-acceptance") diagnosisCommand = stageCommand(refreshed.bundle, input, "docmost", "accept-status");
      } else {
        diagnosisCommand = bundleCommandArgs("status", refreshed.bundle, input);
        if (flags["--local-https-input"]) diagnosisCommand.push("--local-https-input", flags["--local-https-input"],
          "--local-https-run-id", flags["--local-https-run-id"]);
      }
      break;
    }
    if (command.includes("--stage-approve")) {
      delete flags["--stage-approve"];
      stageApprovalConsumed = true;
    }
    if (command.includes("--firewall-scope")) delete flags["--firewall-scope"];
    if (command.includes("--defer-indexer")) delete flags["--defer-indexer"];
  }
  if (!finalDecision) fail("Bundle runner produced no decision");
  if (steps.length === 16) {
    status = "stalled";
    failure = "The bundle runner reached its bounded 16-step limit; inspect adapter status before resuming.";
  }
  const resume = runCommandArgs(current.bundle, input, flags);
  let instruction = "Complete the named manual gate, then rerun this command.";
  if (status === "approval-required") {
    instruction = "Review the returned plan and add only its exact missing approval token, then rerun this command.";
    if (approvalChanged) {
      instruction = "Bundle inputs changed since the last approval. Review the current bundle plan and use its new token; the old bundle and stage tokens were discarded.";
    }
  } else if (status === "stage-failed") {
    instruction = "Run diagnosis.command to inspect the failed stage read-only; do not replay the failed mutation for diagnosis. Repair or resume only its adapter-owned failed checkpoint, then rerun this command.";
  } else if (status === "stalled") {
    instruction = "Inspect the named adapter status before resuming; the runner will not repeat an unchanged checkpoint indefinitely.";
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "household-bundle-run",
    status,
    mutation: steps.some((step) => step.mutation),
    executionPerformed: steps.length > 0,
    bundle: current.bundle.id,
    projectRoot: current.bundle.projectRoot,
    steps,
    next: finalDecision.next,
    deferredGates: finalDecision.deferredGates,
    failure,
    diagnosis: { failedStageCommand: failedCommand, safeReason: failure,
      command: diagnosisCommand, doNotRetryForDiagnosis: failedCommand !== null },
    resume: {
      command: resume,
      approvalChanged,
      stageApprovalConsumed,
      instruction,
    },
    scope: "Deterministic approved-stage runner. Docmost synthetic API acceptance requires its separate exact token. Browser, private-HTTPS, credentials, other direct acceptance, Homarr and finalization remain separate gates. Backup protection is not selected or verified by this bundle.",
  }, null, 2));
}

async function attachmentGuidance(bundle: Bundle, input: string, dependencies: Dependencies): Promise<Record<string, unknown>> {
  const inspectCommand = ["self-host", "bundle", "homarr-attach", "status", "--project-root", bundle.projectRoot,
    "--input", input, "--inspect"];
  const generatePlanCommandTemplate = ["self-host", "bundle", "homarr-inputs", "plan", "--project-root", bundle.projectRoot,
    "--input", input, "--shared-caddy-input", "EXACT_PREVIOUSLY_APPROVED_SHARED_CADDY_INPUT"];
  const routeSelection = "For missing inputs, select the original approved route before planning generation; keep its exact --shared-caddy-input for shared HTTPS. Do not substitute loopback inputs for an existing HTTPS route.";
  try {
    const entries = await inspectBundleHomarrAttachments(bundle.projectRoot, input, dependencies.homarrAttach);
    const unresolved = entries.find((entry) => entry.state !== "attached");
    let planCommand = unresolved?.commands?.plan ?? null;
    const statusCommand = unresolved?.commands?.status ?? null;
    let nextActionCommand = planCommand;
    if (unresolved?.state === "status-unavailable") { planCommand = null; nextActionCommand = statusCommand; }
    return { observation: "fresh-read-only-attached-prefix", mutation: false, credentialBoundary: "adapter-only-status-calls",
      queue: entries, firstUnresolved: unresolved?.adapter ?? null,
      planCommand, statusCommand, nextActionCommand,
      generatePlanCommandTemplate, routeSelection, inspectCommand,
      approvalScope: "Review and apply one adapter plan directly, then obtain a fresh next plan; no aggregate attachment approval or automatic apply.",
      acceptance: "Shortcut readback is not native integration, browser, direct app, route, backup, or full acceptance." };
  } catch {
    return { observation: "unavailable", mutation: false, status: "attachment-queue-unavailable",
      planCommand: null, inspectCommand, generatePlanCommandTemplate, routeSelection };
  }
}

async function printNext(current: Awaited<ReturnType<typeof load>>, input: string,
  flags: Record<string, string>, dependencies: Dependencies): Promise<void> {
  const bundle = current.bundle;
  const inspection = await inspectBundle(bundle, dependencies);
  const suppliedApproval = flags["--approve"];
  const suppliedStageApproval = flags["--stage-approve"];
  const deferIndexer = flags["--defer-indexer"] === "yes";
  if (suppliedApproval && suppliedApproval !== current.approval) {
    fail("bundle next --approve does not match the unchanged bundle plan");
  }
  if (suppliedStageApproval && !suppliedApproval) {
    fail("bundle next --stage-approve also needs the exact current bundle --approve token");
  }
  if (deferIndexer && (!suppliedApproval || !suppliedStageApproval)) {
    fail("bundle next/run --defer-indexer needs the exact bundle and media adapter approvals");
  }
  const deferred: string[] = [];
  if (!suppliedApproval) {
    nextOutput(bundle, inspection, {
      checkpoint: "review-bundle-plan",
      service: "bundle",
      command: bundleCommandArgs("plan", bundle, input),
      afterApproval: "Run bundle next again with the exact approved --approve token.",
    }, deferred);
    return;
  }

  const media = bundle.services.media;
  const mediaReady = inspection.mediaSummary?.running === MEDIA_SERVICES.length;
  if (mediaReady) {
    const benchmarkCommand = ["self-host", "install", "media", "benchmark", "--project-root", bundle.projectRoot,
      "--run-id", media.runId];
    const capture = await captureStatus(() => dependencies.media(benchmarkCommand.slice(3)));
    const benchmark = parsedStatus(capture);
    const outcome = benchmark?.workflowCompletion;
    const valid = benchmark?.schemaVersion === 1 && benchmark.kind === "selfhost-media-benchmark"
      && benchmark.mutation === false && benchmark.runId === media.runId
      && outcome && outcome.recorded === true && typeof outcome.completed === "boolean"
      && Object.keys(outcome).length === 4
      && Object.keys(outcome).every((key) => ["recorded", "completed", "status", "failedStage"].includes(key))
      && ["passed", "pending-owner-choice", "failed", "incomplete"].includes(outcome.status)
      && (outcome.failedStage === null || (typeof outcome.failedStage === "string"
        && /^[a-z][a-z-]{0,39}$/.test(outcome.failedStage)));
    const complete = valid && outcome.completed === true
      && ["passed", "pending-owner-choice"].includes(outcome.status) && outcome.failedStage === null;
    if (!complete) {
      let checkpoint = "inspect-media-workflow-outcome";
      let command = benchmarkCommand;
      if (valid && outcome.status === "failed" && outcome.completed === false && outcome.failedStage !== null) {
        checkpoint = "diagnose-failed-media-workflow";
        command = ["self-host", "install", "media", "diagnose", "--project-root", bundle.projectRoot,
          "--run-id", media.runId];
      }
      nextOutput(bundle, inspection, {
        checkpoint, service: "media", command,
        reason: "Running containers do not establish recorded media workflow completion. Inspect the bounded adapter outcome; repair and resume only the exact failed stage under its original approval. Do not replay setup from container liveness.",
      }, deferred);
      return;
    }
    deferred.push("Media workflow completion is recorded command-stage evidence, not current graph or full acceptance proof.");
  }
  if (deferIndexer && mediaReady) {
    fail("--defer-indexer applies only while bundle next/run targets the media apply stage");
  }
  if (!mediaReady) {
    if (await appliedLifecycleReady(bundle, dependencies)) {
      if (deferIndexer) fail("--defer-indexer does not apply to bundle lifecycle restart");
      const localHttps = localHttpsSelection(flags);
      if (!localHttps) {
        nextOutput(bundle, inspection, {
          checkpoint: "restart-applied-bundle-with-route-owner",
          service: "bundle",
          command: null,
          reason: `All four exact adapter lifecycle checkpoints pass, but private HTTPS remains owned by ${inspection.privateHttps.routeOwner}. Confirm that route lifecycle or rerun bundle next with its exact --local-https-input and --local-https-run-id.`,
        }, deferred);
        return;
      }
      await validatedLocalHttps(bundle, localHttps, dependencies);
      const command = bundleCommandArgs("up", bundle, input);
      command.push("--approve", suppliedApproval, "--local-https-input", localHttps.input,
        "--local-https-run-id", localHttps.runId);
      nextOutput(bundle, inspection, {
        checkpoint: "restart-applied-bundle",
        service: "bundle",
        command,
        reason: "All four exact adapter lifecycle checkpoints pass, and the selected private HTTPS route is bound to its applied checkpoint. bundle up will preflight every owner again before mutation.",
      }, deferred);
      return;
    }
    if (media.mode === "adopt") {
      if (deferIndexer) fail("--defer-indexer does not apply to adopted media inspection");
      nextOutput(bundle, inspection, {
        checkpoint: "inspect-adopted-media-lifecycle",
        service: "media",
        command: stageCommand(bundle, input, "media", "status"),
        reason: "The adopted media run is not observed running, and at least one exact lifecycle preflight failed. Check Docker access and the applied projects before choosing a restart; do not reapply this run.",
      }, deferred);
      return;
    }
    const mediaInfo = await captureStatus(() => dependencies.media([
      "info", "--project-root", bundle.projectRoot, "--run-id", media.runId,
    ]));
    const mediaPlan = parsedStatus(mediaInfo);
    const mediaDigest = mediaPlan?.approvalDigest;
    if (typeof mediaDigest !== "string" || !/^[0-9a-f]{64}$/.test(mediaDigest)) {
      if (deferIndexer) fail("--defer-indexer needs a frozen media plan before apply");
      nextOutput(bundle, inspection, {
        checkpoint: "prepare-media-plan",
        service: "media",
        command: stageCommand(bundle, input, "media", "prepare", suppliedApproval),
        reason: "No exact frozen media adapter plan is available.",
      }, deferred);
      return;
    }
    let expectedBind = "0.0.0.0";
    if (media.bindMode === "host-only") expectedBind = "127.0.0.1";
    if (mediaPlan?.bind !== expectedBind) {
      fail("Frozen media plan bind differs from the reviewed household selection");
    }
    if (media.portStart !== undefined) {
      const portKeys = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
      if (portKeys.some((key, index) => mediaPlan?.ports?.[key] !== String(media.portStart + index))) {
        fail("Frozen media plan ports differ from the reviewed household selection");
      }
    }
    if (media.networkSubnets !== undefined) {
      if (mediaPlan?.networkSubnets?.default !== media.networkSubnets.default
        || mediaPlan?.networkSubnets?.web !== media.networkSubnets.web) {
        fail("Frozen media plan subnets differ from the reviewed household selection");
      }
    }
    let mediaApproved = mediaPlan?.approved === true;
    if (!mediaApproved && suppliedStageApproval) {
      if (suppliedStageApproval !== mediaDigest) fail("bundle next --stage-approve does not match the frozen media plan");
      mediaApproved = true;
    }
    if (!mediaApproved) {
      nextOutput(bundle, inspection, {
        checkpoint: "review-media-plan",
        service: "media",
        command: null,
        review: {
          approvalDigest: mediaDigest,
          composeProject: mediaPlan.composeProject,
          adminUsername: mediaPlan.adminUsername,
          bind: mediaPlan.bind,
          publishedPorts: mediaPlan.publishedPorts,
          ports: mediaPlan.ports,
          networkSubnets: mediaPlan.networkSubnets ?? "automatic",
          imagePolicy: mediaPlan.imagePolicy,
          composeSha256: mediaPlan.composeSha256,
          runtimeSha256: mediaPlan.runtimeSha256,
        },
        afterApproval: "Review these frozen media facts, then rerun bundle run with this bundle token and review.approvalDigest as --stage-approve.",
      }, deferred);
      return;
    }
    const firewallScope = mediaFirewallScope(flags);
    if (media.bindMode === "host-only" && firewallScope !== null) {
      fail("Host-only media ports do not use --firewall-scope");
    }
    if (!mediaPlan?.approved && media.bindMode !== "host-only" && firewallScope === null) {
      nextOutput(bundle, inspection, {
        checkpoint: "confirm-media-firewall-scope",
        service: "media",
        command: null,
        reason: "Seven media ports will listen on all host interfaces. First confirm router-private or Docker-aware private firewall policy, then rerun with --firewall-scope router-private or docker-aware-private. The CLI cannot verify that policy itself.",
      }, deferred);
      return;
    }
    const mediaCommand = stageCommand(bundle, input, "media", "apply", suppliedApproval, mediaDigest, firewallScope ?? undefined);
    if (deferIndexer) mediaCommand.push("--defer-indexer");
    nextOutput(bundle, inspection, {
      checkpoint: "apply-or-resume-media",
      service: "media",
      command: mediaCommand,
      reason: "The exact media plan is frozen and its adapter approval was supplied or previously recorded.",
    }, deferred);
    return;
  }
  deferred.push("Media runtime observation is not seven-service direct acceptance, Homarr read-back, content-flow proof, or recovery evidence.");

  if (media.mode === "create") {
    const webNetwork = `autostack-${media.runId}_web`;
    const immichInput = await privateBundleObject(bundle.projectRoot, bundle.services.immich.input, "Immich input");
    const docmostInput = await privateBundleObject(bundle.projectRoot, bundle.services.docmost.input, "Docmost input");
    const matchesWeb = (value: unknown, id: string) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      return record.id === id && record.name === webNetwork && record.owner === "external"
        && record.internal === true;
    };
    const immichAttached = matchesWeb(immichInput.integrationNetwork, "homarr");
    const docmostAttached = matchesWeb(docmostInput.integrationNetwork, "web");
    if (!immichAttached || !docmostAttached) {
      const immichPort = Number(immichInput.publishedPort);
      const docmostPort = Number(docmostInput.publishedPort);
      if ([immichPort, docmostPort].some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
        fail("Media web inspection needs valid selected Immich and Docmost TCP ports");
      }
      const reportPath = join(dirname(input), `host-media-web-${randomUUID()}.json`);
      const inspectionCommand = ["self-host", "host", "inspect", "--output", reportPath, "--limit", "50",
        "--check-tcp-port", String(immichPort), "--check-tcp-port", String(docmostPort)];
      const routeCommand = ["self-host", "bundle", "route-network", "--service", "media-web",
        "--project-root", bundle.projectRoot, "--input", input, "--host-inspection", reportPath,
        "--network", webNetwork, "--approve", suppliedApproval];
      nextOutput(bundle, inspection, {
        checkpoint: "bind-media-web",
        service: "bundle",
        command: inspectionCommand,
        inspection: { mutation: "new-owner-only-report", output: reportPath, overwritesExisting: false,
          checkedTcpPorts: [immichPort, docmostPort] },
        afterInspection: { command: routeCommand, mutation: "owner-only-bundle-and-app-inputs",
          requiresUnchangedBundleApproval: true, planCommand: bundleCommandArgs("plan", bundle, input),
          next: "Inspect the fresh report and run route-network only while the current bundle approval is unchanged. Then review bundle plan and obtain its new exact approval before resuming; do not reuse the old token." },
        reason: `Before either app apply, inspect the exact selected ports and media network. The returned command only creates a fresh owner-only host report and refuses to replace an existing path; it does not bind ${webNetwork}, apply apps, or approve the follow-up.`,
      }, deferred);
      return;
    }
  }

  const immich = bundle.services.immich;
  const immichStatus = inspection.immichValue;
  if (!immichStatus) {
    nextOutput(bundle, inspection, {
      checkpoint: "inspect-immich-status",
      service: "immich",
      command: stageCommand(bundle, input, "immich", "status"),
      reason: "The exact Immich adapter status is unavailable or invalid.",
    }, deferred);
    return;
  }
  const immichPlanCapture = await captureStatus(() => dependencies.immich([
    "plan", "--project-root", bundle.projectRoot, "--input", immich.input,
    "--run-id", immich.runId, "--account-file", immich.accountFile,
  ]));
  const immichPlan = parsedStatus(immichPlanCapture);
  const immichApprovals = immichPlan?.approvals;
  if (!immichApprovals || typeof immichApprovals !== "object" || Array.isArray(immichApprovals)) {
    nextOutput(bundle, inspection, {
      checkpoint: "review-immich-plan",
      service: "immich",
      command: stageCommand(bundle, input, "immich", "plan"),
      reason: "The exact read-only Immich plan could not be validated.",
    }, deferred);
    return;
  }
  let immichPhase = "apply";
  let immichToken = immichApprovals.apply;
  if (immichStatus.status === "observed") {
    if (immichStatus.initialized !== true) {
      if (immichStatus.initialized === null) {
        nextOutput(bundle, inspection, {
          checkpoint: "inspect-immich-setup-state",
          service: "immich",
          command: null,
          reason: "Immich has not answered its setup-state check yet. Wait for startup, then rerun bundle run; if this persists, inspect Immich status and use the browser fallback.",
        }, deferred);
        return;
      }
      immichPhase = "bootstrap";
      immichToken = immichApprovals.bootstrap;
    } else if (immichStatus.setupEnabled === true) {
      immichPhase = "close-setup";
      immichToken = immichApprovals.closeSetup;
    } else {
      deferred.push("Immich direct use, Homarr attachment and client access remain pending; recovery is not verified by this setup.");
      immichToken = null;
    }
  }
  if (immichToken) {
    if (typeof immichToken !== "string") fail("The exact Immich plan returned an invalid adapter approval token");
    if (!suppliedStageApproval) {
      nextOutput(bundle, inspection, {
        checkpoint: `review-immich-${immichPhase}`,
        service: "immich",
        command: stageCommand(bundle, input, "immich", "plan"),
        afterApproval: `Review the exact Immich ${immichPhase} plan, then use bundle approvals current.runAfterReview or rerun bundle run with this bundle token and its exact --stage-approve token.`,
      }, deferred);
      return;
    }
    if (suppliedStageApproval !== immichToken) fail(`bundle next --stage-approve does not match the exact Immich ${immichPhase} plan`);
    nextOutput(bundle, inspection, {
      checkpoint: `${immichPhase}-immich`,
      service: "immich",
      command: stageCommand(bundle, input, "immich", immichPhase, suppliedApproval, suppliedStageApproval),
      reason: "The exact adapter token was supplied; the coordinator still does not execute it.",
    }, deferred);
    return;
  }

  const docmost = bundle.services.docmost;
  const docmostStatus = inspection.docmostValue;
  if (!docmostStatus) {
    nextOutput(bundle, inspection, {
      checkpoint: "inspect-docmost-status",
      service: "docmost",
      command: stageCommand(bundle, input, "docmost", "status"),
      reason: "The exact Docmost adapter status is unavailable or invalid.",
    }, deferred);
    return;
  }
  if (docmostStatus.checkpoint?.recorded !== true) {
    const docmostPlanCapture = await captureStatus(() => dependencies.docmost([
      "plan", "--project-root", bundle.projectRoot, "--input", docmost.input,
      "--run-id", docmost.runId, "--account-file", docmost.accountFile,
    ]));
    const docmostPlan = parsedStatus(docmostPlanCapture);
    const docmostApproval = docmostPlan?.approval;
    if (typeof docmostApproval !== "string") {
      nextOutput(bundle, inspection, {
        checkpoint: "review-docmost-plan",
        service: "docmost",
        command: stageCommand(bundle, input, "docmost", "plan"),
        reason: "The exact read-only Docmost plan could not be validated.",
      }, deferred);
      return;
    }
    if (!suppliedStageApproval) {
      nextOutput(bundle, inspection, {
        checkpoint: "review-docmost-plan",
        service: "docmost",
        command: stageCommand(bundle, input, "docmost", "plan"),
        afterApproval: "Review the exact Docmost plan, then use bundle approvals current.runAfterReview or rerun bundle run with this bundle token and its exact --stage-approve token.",
      }, deferred);
      return;
    }
    if (suppliedStageApproval !== docmostApproval) fail("bundle next --stage-approve does not match the exact Docmost plan");
    nextOutput(bundle, inspection, {
      checkpoint: "apply-docmost",
      service: "docmost",
      command: stageCommand(bundle, input, "docmost", "apply", suppliedApproval, suppliedStageApproval),
      reason: "The exact adapter token was supplied; first-owner setup remains a separate API approval with browser fallback.",
    }, deferred);
    return;
  }
  if (docmostStatus.owner?.recorded !== true) {
    const ownerPlanCapture = await captureStatus(() => dependencies.docmost([
      "owner", "plan", "--project-root", bundle.projectRoot, "--input", docmost.input,
      "--run-id", docmost.runId, "--account-file", docmost.accountFile,
    ]));
    const ownerPlan = parsedStatus(ownerPlanCapture);
    const ownerApproval = ownerPlan?.approval;
    if (typeof ownerApproval !== "string") {
      nextOutput(bundle, inspection, {
        checkpoint: "review-docmost-owner-plan",
        service: "docmost",
        command: stageCommand(bundle, input, "docmost", "owner-plan"),
        reason: "The exact read-only Docmost v0.96.0 owner plan could not be validated; protected browser fallback remains available.",
      }, deferred);
      return;
    }
    if (!suppliedStageApproval) {
      nextOutput(bundle, inspection, {
        checkpoint: "review-docmost-owner-plan",
        service: "docmost",
        command: stageCommand(bundle, input, "docmost", "owner-plan"),
        afterApproval: "Review the exact Docmost owner plan, then use bundle approvals current.runAfterReview or rerun bundle run with this bundle token and its exact --stage-approve token.",
      }, deferred);
      return;
    }
    if (suppliedStageApproval !== ownerApproval) fail("bundle next --stage-approve does not match the exact Docmost owner plan");
    nextOutput(bundle, inspection, {
      checkpoint: "apply-docmost-owner",
      service: "docmost",
      command: stageCommand(bundle, input, "docmost", "owner-apply", suppliedApproval, suppliedStageApproval),
      reason: "The exact experimental v0.96.0 owner token was supplied; the coordinator still does not execute it.",
    }, deferred);
    return;
  }
  deferred.push("Docmost browser login/editor rendering and Homarr remain pending; recovery is not verified by this setup.");
  const acceptance = inspection.docmostAcceptance;
  let manualAcceptance = false;
  if (!docmostApiProof(acceptance) && acceptance?.status !== "unknown-no-replay") {
    manualAcceptance = await manualDocmostOwner(bundle, docmostStatus);
  }
  if (manualAcceptance) {
    inspection.docmostManualAcceptance = {
      statusCommand: stageCommand(bundle, input, "docmost", "accept-status"),
      planCommand: stageCommand(bundle, input, "docmost", "accept-plan"),
      browserFallback: "Reconcile the existing managed account through the protected Docmost browser path. API checks may lack a recorded workspace; do not repeat owner setup or synthetic writes.",
    };
    deferred.push("Docmost existing-owner API acceptance is optional and unproven; use the returned manual app-check commands or protected browser fallback. Independent app stages may continue.");
  } else if (!acceptance) {
    nextOutput(bundle, inspection, { checkpoint: "inspect-docmost-acceptance-status", service: "docmost",
      command: stageCommand(bundle, input, "docmost", "accept-status"),
      reason: "The exact recorded Docmost API acceptance status is unavailable or invalid; no acceptance mutation is authorized." }, deferred);
    return;
  }
  if (!manualAcceptance && acceptance && !docmostApiProof(acceptance)) {
    if (acceptance.status === "unknown-no-replay") {
      nextOutput(bundle, inspection, { checkpoint: "reconcile-docmost-acceptance", service: "docmost", command: null,
        reason: "The Docmost write attempt is consumed. Inspect its recorded stage; never replay login/create/edit/upload automatically.",
        apiAcceptance: acceptance, statusCommand: stageCommand(bundle, input, "docmost", "accept-status"),
        verifyCommand: stageCommand(bundle, input, "docmost", "accept-verify"),
        prohibitedAutomation: ["acceptance replay", "automatic verification login"] }, deferred);
      return;
    }
    if (!newDocmostOwner(docmostStatus)) {
      nextOutput(bundle, inspection, { checkpoint: "review-docmost-existing-owner-acceptance", service: "docmost", command: null,
        reason: "Bundle acceptance writes require the newly created managed workspace owner. Existing-owner reconciliation remains a separately reviewed direct adapter boundary.",
        apiAcceptance: acceptance, planCommand: stageCommand(bundle, input, "docmost", "accept-plan") }, deferred);
      return;
    }
    const capture = await captureStatus(() => dependencies.docmost(["accept", "plan", "--project-root", bundle.projectRoot,
      "--input", docmost.input, "--run-id", docmost.runId, "--account-file", docmost.accountFile]));
    const plan = parsedStatus(capture);
    const ready = docmostAcceptancePlanReady(plan, acceptance);
    if (!ready || !suppliedStageApproval) {
      nextOutput(bundle, inspection, { checkpoint: "review-docmost-acceptance-plan", service: "docmost",
        command: stageCommand(bundle, input, "docmost", "accept-plan"), apiAcceptance: acceptance,
        reason: "Review the exact one-attempt synthetic page/edit/attachment API plan; browser and Homarr remain separate. Recovery is not verified by this setup.",
        afterApproval: "Review the full plan, then use bundle approvals current.runAfterReview with its separate exact ACCEPT-DOCMOST token." }, deferred);
      return;
    }
    if (suppliedStageApproval !== acceptance.approval) fail("bundle next --stage-approve does not match the exact Docmost acceptance plan");
    nextOutput(bundle, inspection, { checkpoint: "apply-docmost-acceptance", service: "docmost",
      command: stageCommand(bundle, input, "docmost", "accept-apply", suppliedApproval, suppliedStageApproval),
      reason: "Only this exact newly managed run's separately approved synthetic API write pass is authorized." }, deferred);
    return;
  }
  if (docmostApiProof(acceptance)) deferred.push("Docmost API proof is recorded, not live-rechecked; it does not establish full application acceptance.");

  const vaultwarden = bundle.services.vaultwarden;
  if (!inspection.privateHttps.ready) {
    nextOutput(bundle, inspection, {
      checkpoint: "verify-vaultwarden-private-https",
      service: "vaultwarden",
      command: null,
      reason: inspection.privateHttps.next,
      afterVerification: [...bundleCommandArgs("https-ready", bundle, input), "--approve", suppliedApproval,
        "--https-route-status", "configured", "--https-trust", "verified-for-intended-client"],
      prohibitedAutomation: ["DNS or TLS ownership", "client CA trust", "browser signup"],
    }, deferred);
    return;
  }
  const vaultwardenStatus = inspection.vaultwardenValue;
  if (!vaultwardenStatus) {
    nextOutput(bundle, inspection, {
      checkpoint: "prepare-vaultwarden-plan",
      service: "vaultwarden",
      command: stageCommand(bundle, input, "vaultwarden", "prepare", suppliedApproval),
      reason: "No exact frozen Vaultwarden adapter plan is available.",
    }, deferred);
    return;
  }
  if (vaultwardenStatus.bootstrap?.applied !== true) {
    const vaultwardenApproval = vaultwardenStatus.bootstrap?.approvalDigest;
    if (typeof vaultwardenApproval !== "string") fail("The frozen Vaultwarden plan returned an invalid approval digest");
    if (!suppliedStageApproval) {
      nextOutput(bundle, inspection, {
        checkpoint: "review-vaultwarden-plan",
        service: "vaultwarden",
        command: stageCommand(bundle, input, "vaultwarden", "status"),
        afterApproval: "Review the exact Vaultwarden plan, then use bundle approvals current.runAfterReview or rerun bundle run with this bundle token and its exact --stage-approve digest.",
      }, deferred);
      return;
    }
    if (suppliedStageApproval !== vaultwardenApproval) fail("bundle next --stage-approve does not match the frozen Vaultwarden plan");
    nextOutput(bundle, inspection, {
      checkpoint: "apply-vaultwarden-bootstrap",
      service: "vaultwarden",
      command: stageCommand(bundle, input, "vaultwarden", "apply", suppliedApproval, suppliedStageApproval),
      reason: "The exact adapter digest was supplied; browser signup remains separate.",
    }, deferred);
    return;
  }
  if (vaultwardenStatus.registrationClosure?.applied !== true) {
    const signupEvidenceRecorded = vaultwardenStatus.accountBootstrap?.evidenceRecorded === true;
    const closureApproval = vaultwardenStatus.registrationClosure?.approvalDigest;
    const vaultwardenRunId = vaultwarden.runId;
    const statusCommand = `self-host vaultwarden status --project-root ${bundle.projectRoot} --run-id ${vaultwardenRunId}`;
    const loginCommand = ["self-host", "browser", "login", "--project-root", bundle.projectRoot,
      "--run-id", vaultwardenRunId, "--service", "vaultwarden", "--origin", inspection.privateHttps.origin];
    const signupEligible = vaultwardenStatus.accountBootstrap?.boundedSignupEligible === true;
    const signupAttemptRecorded = vaultwardenStatus.accountBootstrap?.attemptRecorded === true;
    const signupStatusCommand = ["self-host", "vaultwarden", "signup", "status", "--project-root", bundle.projectRoot,
      "--run-id", vaultwardenRunId];
    let reason = "Signup history is unknown; reconcile the existing managed account privately. Never repeat signup.";
    if (signupEvidenceRecorded) {
      reason = "Signup evidence is recorded, but the CLI cannot verify that the managed account logs in or unlocks. Fresh browser proof is still required before registration closure.";
    }
    let steps = [
      "Open the approved private HTTPS origin in a CA-trusted client and inspect current account state privately. Never repeat signup, reset the vault, or re-enable registration.",
      "For the initial email login form use the returned existing-account loginCommand. If login rejects, stop and reconcile privately; a saved assertion is not current login proof.",
      "Only after fresh login succeeds, review the exact registration-closure plan, apply its separately approved digest, and verify sign-in still works while new registration is disabled.",
    ];
    const checkpoint: Record<string, any> = {
      checkpoint: "complete-vaultwarden-browser-signup-and-registration-closure",
      homarrAttachments: await attachmentGuidance(bundle, input, dependencies),
      docmostAcceptancePlanCommand: stageCommand(bundle, input, "docmost", "accept-plan"),
      docmostAcceptanceStatusCommand: stageCommand(bundle, input, "docmost", "accept-status"),
      docmostAcceptanceVerifyCommand: stageCommand(bundle, input, "docmost", "accept-verify"),
      service: "vaultwarden",
      command: null,
      reason,
      signupEvidenceRecorded,
      closurePlanRecorded: typeof closureApproval === "string",
      statusCommand,
      signupStatusCommand,
      steps,
      prohibitedAutomation: ["blind signup retry", "plaintext password API submission", "registration closure without fresh login and separate approval"],
    };
    if (signupEligible && !signupEvidenceRecorded && !signupAttemptRecorded) {
      checkpoint.reason = "The adapter reports an eligible new pinned run. Review its separate content-bound signup plan before the single bounded browser attempt.";
      checkpoint.signupPlanCommandTemplate = ["self-host", "vaultwarden", "signup", "plan", "--project-root", bundle.projectRoot,
        "--run-id", vaultwardenRunId, "--browser-bin", "ABSOLUTE_BROWSER_EXECUTABLE", "--ca-cert", "PUBLIC_ROOT_CERTIFICATE"];
      checkpoint.steps = [
        "Select the exact browser executable and public CA certificate in the returned signup plan template; include an explicit sandbox choice only if required by this host.",
        "Review the full adapter signup plan and run its separately approved signup apply exactly once. The adapter owns private fill, onboarding, logout, and identity-matched fresh login; do not submit signup manually first.",
        "Only accepted signup writes evidence; registration closure retains its separate exact approval and post-closure login. Verify isolated recovery before migrating real vault contents.",
      ];
    } else if (signupAttemptRecorded && !signupEvidenceRecorded) {
      checkpoint.reason = "Signup was already attempted; inspect the adapter signup status for its exact durable stage and owned browser takeover. Never repeat signup.";
      checkpoint.steps = [
        "Run the returned signupStatusCommand and inspect only private form-control metadata in its recorded owned session. Do not print populated snapshots, full URLs, raw browser envelopes, or field values.",
        "Reconcile the existing account privately; fixed-session CLI login does not target a retained nonce browser. Never replay signup, reset the vault, or re-enable registration.",
        "Keep registration closure blocked until identity-matched fresh login is proven and its separate exact approval is reviewed.",
      ];
    } else {
      checkpoint.loginCommand = loginCommand;
    }
    nextOutput(bundle, inspection, checkpoint, deferred);
    return;
  }
  deferred.push("Vaultwarden fresh login, unlock, registration rejection and Homarr remain pending; verify isolated recovery before migrating real vault contents.");
  nextOutput(bundle, inspection, {
    checkpoint: "collect-direct-acceptance-and-finalization-evidence",
    homarrAttachments: await attachmentGuidance(bundle, input, dependencies),
    docmostAcceptancePlanCommand: stageCommand(bundle, input, "docmost", "accept-plan"),
    docmostAcceptanceStatusCommand: stageCommand(bundle, input, "docmost", "accept-status"),
    docmostAcceptanceVerifyCommand: stageCommand(bundle, input, "docmost", "accept-verify"),
    service: "bundle",
    command: null,
    reason: "All four adapter runtime checkpoints exist, but direct app, Homarr, screenshot, timing and cleanup evidence remain separate. Backup protection is not selected or verified by this bundle.",
  }, deferred);
}

async function bundleAccess(root: string, path: string, name: string): Promise<string> {
  const raw = await boundedFile(root, path, `${name} input`, true);
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); }
  catch { fail(`${name} input is not valid JSON`); }
  const input = object(parsed, `${name} input`);
  const host = privateHost(input.hostIp as string);
  const port = input.publishedPort;
  if (!Number.isInteger(port) || Number(port) < 1024 || Number(port) > 65535) {
    fail(`${name} input has an invalid access port`);
  }
  let urlHost = host;
  if (isIP(host) === 6) urlHost = `[${host}]`;
  return `http://${urlHost}:${port}`;
}

type HomarrAttachInput = {
  schemaVersion: 1;
  homarr: { origin: string; boardName: string };
  service: {
    id: "immich" | "docmost" | "vaultwarden";
    name: string;
    description: string;
    href: string;
    iconUrl: string;
    access: "local" | "private-route";
    storagePath: string;
  };
};

type HomarrInputEntry = {
  path: string;
  input: HomarrAttachInput | HomarrImmichInput;
  bytes: string;
  label: string;
  service: "immich" | "docmost" | "vaultwarden" | "immich-native";
};

type HomarrInputPlan = {
  approval: string;
  apiKeyFile: string | null;
  routeApproval: string | null;
  immichApiKeyFile: string;
  immichAcceptanceFile: string;
  immichNativePath: string;
  immichNativePending: string | null;
  entries: HomarrInputEntry[];
};

async function sharedCaddyOrigins(bundle: Bundle, input: string, routeOwner: string): Promise<{ urls: Record<"immich" | "docmost" | "vaultwarden", string>; approval: string }> {
  const root = bundle.projectRoot;
  const expectedInput = join(root, ".selfhost", "bundles", bundle.id, "caddy", "shared-caddy.json");
  if (input !== expectedInput) fail("Homarr HTTPS links require this bundle's exact generated shared-Caddy input");
  const capture = await captureStatus(() => caddyPrivateCommand(["status", "--project-root", root, "--input", input]));
  const status = parsedStatus(capture);
  if (!status || status.kind !== "shared-private-caddy-status" || status.project !== routeOwner
    || status.applied !== true || status.current !== true || status.currentInput !== "matches-checkpoint"
    || status.checkpoint?.inputPath !== input || typeof status.checkpoint?.approvalDigest !== "string"
    || status.access?.public !== false || status.access?.bindAddress !== "127.0.0.1"
    || !Number.isInteger(status.access?.httpsPort) || !Array.isArray(status.routes)
    || !Array.isArray(status.liveTransport)) {
    fail("The selected shared Caddy route is not the current applied host-private bundle route");
  }
  const urls = {} as Record<"immich" | "docmost" | "vaultwarden", string>;
  for (const name of ["immich", "docmost", "vaultwarden"] as const) {
    const expected = `https://${name}.localhost:${status.access.httpsPort}`;
    const routes = status.routes.filter((route: Record<string, unknown>) => route.hostname === `${name}.localhost` && route.origin === expected);
    const transports = status.liveTransport.filter((entry: Record<string, unknown>) => entry.hostname === `${name}.localhost`
      && entry.origin === expected && entry.verified === true && entry.httpStatus === 200);
    if (routes.length !== 1 || transports.length !== 1) fail(`Shared Caddy has no verified ${name} HTTPS route`);
    urls[name] = expected;
  }
  return { urls, approval: status.checkpoint.approvalDigest };
}

function exactBundleProject(value: unknown, root: string, runId: string, name: string): Record<string, unknown> {
  const project = object(value, `${name} project`);
  exact(project, ["dockerContext", "id", "owner", "root", "directory", "ownership"], `${name} project`);
  if (project.id !== runId || project.owner !== runId || project.root !== root
    || project.directory !== join(root, runId) || typeof project.dockerContext !== "string" || !project.dockerContext
    || !["new", "verified-existing"].includes(String(project.ownership))) {
    fail(`${name} project no longer has the exact bundle-owned identity and path`);
  }
  return project;
}

function exactStoragePath(value: unknown, expected: string, owner: string, name: string): string {
  const storage = object(value, `${name} storage`);
  exact(storage, ["path", "owner", "ownership"], `${name} storage`);
  if (storage.path !== expected || storage.owner !== owner
    || !["new", "verified-existing"].includes(String(storage.ownership))) {
    fail(`${name} storage no longer has the exact bundle-owned path`);
  }
  return expected;
}

function privateBundleUrl(hostValue: unknown, portValue: unknown, name: string): string {
  if (typeof hostValue !== "string") fail(`${name} host is invalid`);
  const host = privateHost(hostValue);
  if (!Number.isInteger(portValue) || Number(portValue) < 1024 || Number(portValue) > 65535) {
    fail(`${name} port is invalid`);
  }
  let displayHost = host;
  if (isIP(host) === 6) displayHost = `[${host}]`;
  return `http://${displayHost}:${portValue}`;
}

function runIsolatedStage(args: string[]): Promise<{ ok: boolean }> {
  return new Promise((resolveResult) => {
    let argv = args;
    let env = process.env;
    if (typeof Bun !== "undefined" && Bun.isStandaloneExecutable) {
      env = { ...process.env };
      delete env.BUN_BE_BUN;
    } else {
      const entry = fileURLToPath(new URL("../bin/selfhost.mjs", import.meta.url));
      argv = [entry, ...args];
    }
    const child = spawn(process.execPath, argv, {
      stdio: "ignore", windowsHide: true, shell: false, env,
    });
    child.once("error", () => {
      resolveResult({ ok: false });
    });
    child.once("close", (code) => {
      resolveResult({ ok: code === 0 });
    });
  });
}

type ParallelJobState = "pending" | "launch-attempted" | "applied" | "inspect-checkpoint" | "blocked";
type ParallelLedger = {
  schemaVersion: 1;
  kind: "household-parallel-job-run";
  bundle: string;
  approvalSha256: string;
  graphSha256: string;
  adapterApprovalSha256: Record<"immich" | "docmost", string>;
  startedAt: string;
  updatedAt: string;
  jobs: Array<{ id: string; service: "immich" | "docmost"; needs: string[];
    projectId: string; port: number; status: ParallelJobState; updatedAt: string }>;
};

function exactIsoTime(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  try { return new Date(value).toISOString() === value; }
  catch { return false; }
}

function parallelLedgerPath(bundle: Bundle, input: string): string {
  const directory = join(bundle.projectRoot, ".selfhost", "bundles", bundle.id);
  if (input !== join(directory, "household-bundle.json")) {
    fail("Parallel job history needs this bundle's exact private input path");
  }
  return join(directory, "parallel-apply.json");
}

async function readParallelLedger(bundle: Bundle, input: string): Promise<ParallelLedger | null> {
  const path = parallelLedgerPath(bundle, input);
  await ownedPrivateDirectory(dirname(path), "parallel job directory");
  if (!await privateFileIfPresent(path, "parallel job history")) return null;
  let parsed: unknown;
  try { parsed = JSON.parse((await boundedFile(bundle.projectRoot, path, "parallel job history", true)).toString("utf8")); }
  catch { fail("Parallel job history is not valid owner-only JSON"); }
  const ledger = object(parsed, "parallel job history");
  exact(ledger, ["schemaVersion", "kind", "bundle", "approvalSha256", "graphSha256",
    "adapterApprovalSha256", "startedAt", "updatedAt", "jobs"], "parallel job history");
  if (ledger.schemaVersion !== 1 || ledger.kind !== "household-parallel-job-run" || ledger.bundle !== bundle.id
    || typeof ledger.approvalSha256 !== "string" || !/^[0-9a-f]{64}$/.test(ledger.approvalSha256)
    || typeof ledger.graphSha256 !== "string" || !/^[0-9a-f]{64}$/.test(ledger.graphSha256)
    || !exactIsoTime(ledger.startedAt) || !exactIsoTime(ledger.updatedAt)
    || !Array.isArray(ledger.jobs) || ledger.jobs.length !== 2) fail("Parallel job history has invalid identity");
  const approvals = object(ledger.adapterApprovalSha256, "parallel adapter approval fingerprints");
  exact(approvals, ["immich", "docmost"], "parallel adapter approval fingerprints");
  if (Object.values(approvals).some((value) => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))) {
    fail("Parallel job history has invalid adapter approval fingerprints");
  }
  const services = ["immich", "docmost"];
  for (const [index, value] of ledger.jobs.entries()) {
    const job = object(value, "parallel job");
    exact(job, ["id", "service", "needs", "projectId", "port", "status", "updatedAt"], "parallel job");
    if (job.id !== `app-${services[index]}` || job.service !== services[index]
      || !Array.isArray(job.needs) || JSON.stringify(job.needs) !== JSON.stringify(["media"])
      || job.projectId !== bundle.services[services[index] as "immich" | "docmost"].runId
      || !Number.isInteger(job.port) || Number(job.port) < 1024 || Number(job.port) > 65535
      || !["pending", "launch-attempted", "applied", "inspect-checkpoint", "blocked"].includes(String(job.status))
      || !exactIsoTime(job.updatedAt)) fail("Parallel job history has invalid job ownership or state");
  }
  const graph = ledger.jobs.map((value) => {
    const job = value as ParallelLedger["jobs"][number];
    return { id: job.id, needs: job.needs, service: job.service };
  });
  if (createHash("sha256").update(JSON.stringify(graph)).digest("hex") !== ledger.graphSha256) {
    fail("Parallel job history no longer matches its approved graph");
  }
  return ledger as ParallelLedger;
}

async function parallelAppApply(current: Awaited<ReturnType<typeof load>>, input: string,
  flags: Record<string, string>, dependencies: Dependencies, apply: boolean): Promise<void> {
  const bundle = current.bundle;
  await assertPackagedCatalogProject(bundle.projectRoot);
  let approvedJobs: ReturnType<typeof approvedHouseholdParallelJobs> = null;
  try {
    const catalog = availableCatalog(await loadCatalog());
    const goals = ["personal-media", "photos", "private-notes", "passwords"];
    const stacks = goals.map((id) => stackForGoalId(catalog, id));
    if (stacks.every((stack) => stack !== null)) {
      approvedJobs = approvedHouseholdParallelJobs(buildCompositePlan(catalog, stacks));
    }
  } catch {
    approvedJobs = null;
  }
  if (!approvedJobs) {
    fail("Parallel app apply is not bound to the current exact household dependency graph");
  }
  const ledgerPath = parallelLedgerPath(bundle, input);
  if (await readParallelLedger(bundle, input)) {
    fail("A parallel job run is already recorded; inspect bundle status and exact adapter checkpoints before any recovery");
  }
  if (bundle.services.media.mode === "adopt") {
    fail("Parallel app apply needs a newly managed media run with its verified internal web network");
  }
  const mediaCapture = await captureStatus(() => dependencies.media(["status", "--project-root", bundle.projectRoot,
    "--run-id", bundle.services.media.runId, "--json", "yes"]));
  if (mediaSummary(mediaCapture, bundle.services.media.runId)?.running !== MEDIA_SERVICES.length) {
    fail("Parallel app apply needs all seven exact media services running first");
  }
  const benchmark = parsedStatus(await captureStatus(() => dependencies.media(["benchmark", "--project-root", bundle.projectRoot,
    "--run-id", bundle.services.media.runId])));
  const outcome = benchmark?.workflowCompletion;
  if (benchmark?.schemaVersion !== 1 || benchmark.kind !== "selfhost-media-benchmark"
    || benchmark.mutation !== false || benchmark.runId !== bundle.services.media.runId
    || outcome?.recorded !== true || outcome.completed !== true || outcome.failedStage !== null
    || Object.keys(outcome).sort().join(",") !== "completed,failedStage,recorded,status"
    || !["passed", "pending-owner-choice"].includes(outcome.status)) {
    fail("Parallel app apply needs the recorded media workflow completion, not container liveness alone");
  }
  const network = `autostack-${bundle.services.media.runId}_web`;
  const mediaProject = `autostack-${bundle.services.media.runId}`;
  const appInputs = await Promise.all([
    privateBundleObject(bundle.projectRoot, bundle.services.immich.input, "Immich input"),
    privateBundleObject(bundle.projectRoot, bundle.services.docmost.input, "Docmost input"),
  ]);
  const services = ["immich", "docmost"] as const;
  const ports: number[] = [];
  let dockerContext: string | null = null;
  for (const [index, serviceName] of services.entries()) {
    const app = bundle.services[serviceName];
    const appInput = appInputs[index];
    const project = exactBundleProject(appInput.project, bundle.projectRoot, app.runId, serviceName);
    const expectedId = serviceName === "immich" ? "homarr" : "web";
    const integration = requireRecord(appInput.integrationNetwork, `${serviceName} integration network`);
    if (Object.keys(integration).sort().join(",") !== "id,internal,name,owner"
      || integration.id !== expectedId || integration.name !== network
      || integration.owner !== "external" || integration.internal !== true) {
      fail(`${serviceName} must be bound to the exact verified internal media web network before parallel apply`);
    }
    if (project.ownership !== "new" || existsSync(String(project.directory))) {
      fail(`${serviceName} has an existing project; inspect its checkpoint and resume it separately`);
    }
    let adapterState = join(bundle.projectRoot, ".selfhost", "docmost", app.runId);
    if (serviceName === "immich") {
      adapterState = join(bundle.projectRoot, ".selfhost", "household", ".sessions", app.runId);
    }
    if (existsSync(adapterState)) {
      fail(`${serviceName} has adapter-owned state; inspect its checkpoint and resume it separately`);
    }
    if (dockerContext !== null && dockerContext !== project.dockerContext) {
      fail("Parallel apps must use the same inspected Docker context");
    }
    dockerContext = String(project.dockerContext);
    privateBundleUrl(appInput.hostIp, appInput.publishedPort, serviceName);
    ports.push(Number(appInput.publishedPort));
  }
  if (bundle.services.immich.runId === bundle.services.docmost.runId || ports[0] === ports[1]) {
    fail("Parallel apps need distinct project IDs and host ports");
  }
  const fresh = await hostObservation(bundle.projectRoot, flags["--host-inspection"], ports, true);
  if (fresh.dockerContext !== dockerContext || !fresh.networks.some((entry) => entry.name === network)
    || fresh.exactPorts.some((entry) => ports.includes(entry.port) && entry.inUse)) {
    fail("Fresh host inspection does not prove the selected context, media web network, and unused app ports");
  }
  await (dependencies.inspectMediaWeb ?? inspectMediaWebNetwork)(fresh.dockerContext, network, mediaProject);
  const immich = parsedStatus(await captureStatus(() => dependencies.immich(["plan", "--project-root", bundle.projectRoot,
    "--input", bundle.services.immich.input, "--run-id", bundle.services.immich.runId,
    "--account-file", bundle.services.immich.accountFile])));
  const docmost = parsedStatus(await captureStatus(() => dependencies.docmost(["plan", "--project-root", bundle.projectRoot,
    "--input", bundle.services.docmost.input, "--run-id", bundle.services.docmost.runId,
    "--account-file", bundle.services.docmost.accountFile])));
  const immichApproval = immich?.approvals?.apply;
  const docmostApproval = docmost?.approval;
  if (immich?.kind !== "immich-v3.2.2-cli-plan" || immich.status !== "pass"
    || docmost?.kind !== "docmost-v0.96.0-cli-plan" || docmost.status !== "pass"
    || typeof immichApproval !== "string" || typeof docmostApproval !== "string") {
    fail("Both exact adapter plans must pass before parallel apply");
  }
  const approvals = { immich: immichApproval, docmost: docmostApproval };
  if (!apply) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-parallel-plan", status: "ready-for-review",
      mutation: false, bundle: bundle.id, approval: current.approval, services, network,
      jobs: approvedJobs.map((job) => ({ id: job.id, needs: job.needs, status: "pending" })),
      adapterApprovals: approvals, hostInspection: flags["--host-inspection"],
      next: "Review both adapter plans, refresh the host inspection, then use bundle parallel-apply with this bundle token and both exact adapter tokens.",
      limits: ["Only initial Immich and Docmost Compose apply can run together; account/bootstrap and acceptance remain separate."] }, null, 2));
    return;
  }
  if (flags["--approve"] !== current.approval
    || flags["--immich-approve"] !== immichApproval || flags["--docmost-approve"] !== docmostApproval) {
    fail("Parallel apply needs the unchanged bundle approval and both exact reviewed adapter apply tokens");
  }
  const unchanged = await load(bundle.projectRoot, input);
  if (unchanged.approval !== current.approval || services.some((name) => existsSync(join(bundle.projectRoot, bundle.services[name].runId)))) {
    fail("Bundle input or app projects changed during preflight; no parallel app apply started");
  }
  const now = new Date().toISOString();
  const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
  const ledger: ParallelLedger = {
    schemaVersion: 1, kind: "household-parallel-job-run", bundle: bundle.id,
    approvalSha256: fingerprint(current.approval),
    graphSha256: fingerprint(JSON.stringify(approvedJobs)),
    adapterApprovalSha256: { immich: fingerprint(immichApproval), docmost: fingerprint(docmostApproval) },
    startedAt: now, updatedAt: now,
    jobs: approvedJobs.map((job) => ({ id: job.id, service: job.service, needs: job.needs,
      projectId: bundle.services[job.service].runId, port: ports[services.indexOf(job.service)],
      status: "pending", updatedAt: now })),
  };
  try { await privateJson(ledgerPath, ledger); }
  catch { fail("Parallel job history could not be created exclusively; inspect this bundle before retrying"); }
  let writeQueue = Promise.resolve();
  const recordTransition = (id: string, status: ParallelJobState): Promise<void> => {
    writeQueue = writeQueue.then(async () => {
      const job = ledger.jobs.find((entry) => entry.id === id);
      if (!job) fail("Parallel job result was not in the approved graph");
      const changedAt = new Date().toISOString();
      job.status = status;
      job.updatedAt = changedAt;
      ledger.updatedAt = changedAt;
      await replacePrivateJson(bundle.projectRoot, ledgerPath, ledger);
    });
    return writeQueue;
  };
  const execute = dependencies.runIsolatedStage ?? runIsolatedStage;
  const results = await runApprovedDag(approvedJobs.map((job) => {
    const name = job.service;
    const args = ["bundle", "stage", "--service", name, "--phase", "apply", "--project-root", bundle.projectRoot,
      "--input", input, "--approve", current.approval, "--stage-approve", approvals[name]];
    return { id: job.id, needs: job.needs,
      owns: [`project:${bundle.services[name].runId}`, `port:${ports[services.indexOf(name)]}`],
      run: async () => (await execute(args)).ok };
  }), new Set(["media"]), 2, recordTransition);
  const status = results.every((result) => result.status === "applied") ? "applied-awaiting-account-setup" : "partial-needs-inspection";
  if (status === "partial-needs-inspection") process.exitCode = 1;
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-parallel-apply", status,
    bundle: bundle.id, jobHistory: ledgerPath,
    results: results.map((result) => ({ service: result.id.slice(4), status: result.status })),
    next: "Inspect bundle status and each adapter checkpoint; never replay a failed apply without its exact recovery plan.",
    limits: ["No account/bootstrap, Homarr attachment, direct acceptance, or recovery verification was performed."] }, null, 2));
}

async function privateBundleObject(root: string, path: string, name: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try { parsed = JSON.parse((await boundedFile(root, path, name, true)).toString("utf8")); }
  catch { fail(`${name} is not valid JSON or an owner-only file`); }
  return object(parsed, name);
}

function immichNativePendingReason(value: unknown, bundle: Bundle, sharedCaddyInput?: string): string | null {
  const pending = "Native Immich attachment is pending until the Immich application container is bound to one validated Homarr-reachable external network.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return pending;
  const network = value as Record<string, unknown>;
  let expectedKeys = ["id", "name", "owner"];
  if (Object.hasOwn(network, "internal")) expectedKeys = [...expectedKeys, "internal"];
  if (JSON.stringify(Object.keys(network).sort()) !== JSON.stringify(expectedKeys.sort())
    || network.id !== "homarr" || network.owner !== "external"
    || typeof network.name !== "string" || !NETWORK.test(network.name)
    || (Object.hasOwn(network, "internal") && typeof network.internal !== "boolean")) return pending;
  if (sharedCaddyInput) {
    const mediaWeb = `autostack-${bundle.services.media.runId}_web`;
    if (network.name !== mediaWeb || network.internal !== true) {
      return `Native Immich attachment is pending until bundle route-network binds Immich to the exact internal ${mediaWeb} network used by shared Caddy and Homarr.`;
    }
  }
  return null;
}

async function managedHomarr(bundle: Bundle, dependencies: Dependencies): Promise<{ origin: string; apiKeyFile: string | null }> {
  const root = bundle.projectRoot;
  const runId = bundle.services.media.runId;
  const capture = await captureStatus(() => dependencies.media(["info", "--project-root", root, "--run-id", runId]));
  const info = parsedStatus(capture);
  if (!info || info.schemaVersion !== 1 || info.runId !== runId || info.projectRoot !== root
    || info.composeProject !== `autostack-${runId}` || !Array.isArray(info.services)) {
    fail("Managed media info could not prove this bundle's Homarr origin");
  }
  const expectedNames = new Set(["Homarr", "Jellyfin", "Seerr", "Sonarr", "Radarr", "Prowlarr", "qBittorrent"]);
  const observedNames = info.services.map((value: unknown) => object(value, "media info service").name);
  if (observedNames.length !== expectedNames.size || new Set(observedNames).size !== expectedNames.size
    || observedNames.some((name: unknown) => typeof name !== "string" || !expectedNames.has(name))) {
    fail("Managed media info does not contain the exact seven-service run");
  }
  const homarr = info.services.filter((value: unknown) => object(value, "media info service").name === "Homarr");
  if (homarr.length !== 1) fail("Managed media info must contain exactly one Homarr service");
  const service = object(homarr[0], "Homarr media info");
  exact(service, ["name", "purpose", "url"], "Homarr media info");
  if (typeof service.url !== "string") fail("Managed Homarr URL is invalid");
  let parsed: URL;
  try { parsed = new URL(service.url); }
  catch { fail("Managed Homarr URL is invalid"); }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail("Managed Homarr URL must be the exact loopback origin emitted by the media owner");
  }
  const session = join(root, ".selfhost", "media-harness", ".sessions", runId);
  let apiKeyFile = await privateFileIfPresent(join(session, "connections.env"), "Managed media connections file");
  if (apiKeyFile === null) {
    apiKeyFile = await privateFileIfPresent(join(session, "homarr-api-key.env"), "Managed Homarr API key file");
  }
  return { origin: parsed.origin, apiKeyFile };
}

async function homarrInputPlan(current: Awaited<ReturnType<typeof load>>, inputPath: string,
  dependencies: Dependencies, sharedCaddyInput?: string): Promise<HomarrInputPlan> {
  const bundle = current.bundle;
  const root = bundle.projectRoot;
  const directory = join(root, ".selfhost", "bundles", bundle.id);
  if (inputPath !== join(directory, "household-bundle.json")) {
    fail("bundle homarr-inputs requires the canonical bundle-owned household-bundle.json path");
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) fail("Bundle directory must be one owner-only real directory (0700)");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Bundle directory has a different owner");

  const managed = await managedHomarr(bundle, dependencies);
  const immichSource = await privateBundleObject(root, bundle.services.immich.input, "Immich input");
  const immichProject = exactBundleProject(immichSource.project, root, bundle.services.immich.runId, "Immich");
  const immichStorage = object(immichSource.storage, "Immich storage");
  const immichPath = exactStoragePath(immichStorage.uploads,
    join(String(immichProject.directory), "data", "uploads"), bundle.services.immich.runId, "Immich uploads");
  let immichUrl = privateBundleUrl(immichSource.hostIp, immichSource.publishedPort, "Immich");
  const immichNativePending = immichNativePendingReason(immichSource.integrationNetwork, bundle, sharedCaddyInput);

  const docmostSource = await privateBundleObject(root, bundle.services.docmost.input, "Docmost input");
  const docmostProject = exactBundleProject(docmostSource.project, root, bundle.services.docmost.runId, "Docmost");
  const docmostPath = join(String(docmostProject.directory), "data", "attachments");
  if (!inside(root, docmostPath)) fail("Docmost storage path escapes the project root");
  let docmostUrl = privateBundleUrl(docmostSource.hostIp, docmostSource.publishedPort, "Docmost");

  const vaultSource = await privateBundleObject(root, bundle.services.vaultwarden.input, "Vaultwarden input");
  const vaultProject = exactBundleProject(vaultSource.project, root, bundle.services.vaultwarden.runId, "Vaultwarden");
  const vaultApps = object(vaultSource.apps, "Vaultwarden apps");
  const vaultApp = object(vaultApps.vaultwarden, "Vaultwarden app");
  const vaultStorage = object(vaultApp.storage, "Vaultwarden storage");
  const vaultPath = exactStoragePath(vaultStorage.data,
    join(String(vaultProject.directory), "data"), bundle.services.vaultwarden.runId, "Vaultwarden data");
  const vaultHttps = await vaultwardenHttpsState(root, bundle.services.vaultwarden.httpsPlan);
  let routeApproval: string | null = null;
  if (sharedCaddyInput) {
    if (vaultHttps.routeOwner !== vaultHttps.tlsOwner) {
      fail("The shared Caddy route and TLS owners do not match the approved Vaultwarden plan");
    }
    const route = await sharedCaddyOrigins(bundle, sharedCaddyInput, vaultHttps.routeOwner);
    if (route.urls.vaultwarden !== vaultHttps.origin) {
      fail("The shared Caddy route does not match the approved Vaultwarden HTTPS owner and origin");
    }
    immichUrl = route.urls.immich;
    docmostUrl = route.urls.docmost;
    routeApproval = route.approval;
  }

  const homarr = { origin: managed.origin, boardName: HOMARR_BOARD };
  const values: HomarrAttachInput[] = [
    { schemaVersion: 1, homarr, service: { id: "immich", name: "Immich",
      description: "Keep and browse your own photos.", href: immichUrl, iconUrl: HOMARR_ICONS.immich,
      access: sharedCaddyInput ? "private-route" : "local", storagePath: immichPath } },
    { schemaVersion: 1, homarr, service: { id: "docmost", name: "Docmost",
      description: "Write and share private pages and documents.", href: docmostUrl, iconUrl: HOMARR_ICONS.docmost,
      access: sharedCaddyInput ? "private-route" : "local", storagePath: docmostPath } },
    { schemaVersion: 1, homarr, service: { id: "vaultwarden", name: "Vaultwarden",
      description: "Store passwords in your private vault.", href: vaultHttps.origin, iconUrl: HOMARR_ICONS.vaultwarden,
      access: "private-route", storagePath: vaultPath } },
  ];
  const entries: HomarrInputEntry[] = values.map((value) => {
    const path = join(directory, `homarr-attach-${value.service.id}.json`);
    return { path, input: value, bytes: `${JSON.stringify(value, null, 2)}\n`, label: value.service.name,
      service: value.service.id };
  });
  const immichNative: HomarrImmichInput = {
    schemaVersion: 1,
    homarr,
    immich: {
      appName: "Immich",
      integrationName: "Immich",
      url: "http://immich-server:2283/",
      widgets: [{ kind: "immich-serverStats", options: {
        showUsers: true, showPhotos: true, showVideos: true, showStorage: true,
      } }],
    },
  };
  const immichNativePath = join(directory, "homarr-attach-immich-native.json");
  const immichApiKeyFile = join(directory, "immich-homarr-api-key");
  const immichAcceptanceFile = join(directory, "immich-acceptance.json");
  if (immichNativePending === null) {
    entries.push({ path: immichNativePath, input: immichNative,
      bytes: `${JSON.stringify(immichNative, null, 2)}\n`, label: "native Immich", service: "immich-native" });
    await privateFileIfPresent(immichApiKeyFile, "Existing limited Immich Homarr API key");
    await privateFileIfPresent(immichAcceptanceFile, "Existing Immich acceptance evidence");
  }
  const digest = createHash("sha256").update(JSON.stringify({ bundleApproval: current.approval, routeApproval,
    generated: entries.map((entry) => ({ path: entry.path, bytes: entry.bytes })),
    immichApiKeyFile, immichAcceptanceFile, immichNativePath, immichNativePending })).digest("hex");
  return { approval: `HOMARR-INPUTS:${bundle.id}:${digest}`, apiKeyFile: managed.apiKeyFile, routeApproval,
    immichApiKeyFile, immichAcceptanceFile, immichNativePath, immichNativePending, entries };
}

function homarrAttachCommands(plan: HomarrInputPlan): Array<Record<string, unknown>> {
  if (plan.apiKeyFile === null) return [];
  return plan.entries.map((entry) => {
    let argv = ["self-host", "homarr", "attach", "plan", "--input", entry.path,
      "--api-key-file", plan.apiKeyFile as string];
    if (entry.service === "immich-native") {
      argv = ["self-host", "homarr", "attach", "immich", "plan", "--input", entry.path,
        "--api-key-file", plan.apiKeyFile as string, "--immich-api-key-file", plan.immichApiKeyFile,
        "--acceptance-file", plan.immichAcceptanceFile];
    }
    return { service: entry.service, argv,
      shell: argv.map((value) => `'${value.replaceAll("'", `'\"'\"'`)}'`).join(" ") };
  });
}

function printHomarrInputs(bundle: Bundle, plan: HomarrInputPlan, status: string, mutation: boolean,
  created: string[] = []): void {
  const pending = plan.apiKeyFile === null
    ? "Managed media has not yet produced an owner-only connections or Homarr key file; finish its Homarr/connections stage, then rerun this command."
    : null;
  let immichNativeStatus = "ready-for-plan";
  if (plan.immichNativePending !== null) immichNativeStatus = "pending-network";
  const limitations = [
    "The three shortcut inputs create app shortcuts and recap Notebook entries only; they do not verify runtime, native integrations, or widgets.",
    "The native Immich input does not create its limited API key, record service acceptance, or call Homarr.",
    "Immich key creation and homarr attach immich apply keep their separate exact plans and approvals.",
  ];
  if (plan.immichNativePending !== null) limitations.push(plan.immichNativePending);
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-homarr-inputs", status, mutation,
    bundle: bundle.id, homarr: plan.entries[0].input.homarr, approval: plan.approval, routeApproval: plan.routeApproval,
    inputs: plan.entries.map((entry) => ({ path: entry.path, mode: "0600", content: entry.input })),
    created, apiKeyFile: plan.apiKeyFile, immichApiKeyFile: plan.immichApiKeyFile,
    immichAcceptanceFile: plan.immichAcceptanceFile, secretsPrinted: false,
    next: { commands: homarrAttachCommands(plan), pending,
      immichNative: { status: immichNativeStatus, input: plan.immichNativePath,
        apiKeyFile: plan.immichApiKeyFile, acceptanceFile: plan.immichAcceptanceFile,
        pending: plan.immichNativePending } },
    limitations,
  }, null, 2));
}

async function applyHomarrInputs(bundle: Bundle, plan: HomarrInputPlan, approval: string): Promise<void> {
  if (approval !== plan.approval) fail("bundle homarr-inputs apply needs the exact approval from the unchanged bundle and generated inputs");
  const missing: HomarrInputEntry[] = [];
  for (const entry of plan.entries) {
    let existing: string | null = null;
    const present = await privateFileIfPresent(entry.path, `Existing ${entry.label} Homarr input`);
    if (present !== null) existing = await readFile(present, "utf8");
    if (existing !== null && existing !== entry.bytes) {
      fail(`Existing ${entry.label} Homarr input differs; no file was overwritten`);
    }
    if (existing === null) missing.push(entry);
  }
  const created: string[] = [];
  for (const entry of missing) {
    await privateJson(entry.path, entry.input);
    created.push(entry.path);
  }
  let status = "created";
  if (created.length === 0) status = "already-current";
  printHomarrInputs(bundle, plan, status, created.length > 0, created);
}

async function printBundleInfo(bundle: Bundle, dependencies: Dependencies): Promise<void> {
  const root = bundle.projectRoot;
  const mediaCapture = await captureStatus(() => dependencies.media(["info", "--project-root", root,
    "--run-id", bundle.services.media.runId]));
  const media = parsedStatus(mediaCapture);
  let mediaInfo = "available";
  if (!media || !Array.isArray(media.services)) mediaInfo = "unavailable";
  const mediaServices: Array<{ name: string; purpose: string; url: string }> = [];
  if (Array.isArray(media?.services)) {
    for (const raw of media.services) {
      const entry = object(raw, "media info service");
      if (typeof entry.name !== "string" || typeof entry.purpose !== "string" || typeof entry.url !== "string") {
        fail("Media info contains an invalid service");
      }
      const url = new URL(entry.url);
      if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        fail("Media info contains an unsafe service URL");
      }
      mediaServices.push({ name: entry.name, purpose: entry.purpose, url: entry.url });
    }
  }
  const expectedMediaNames = new Set(["Homarr", "Jellyfin", "Seerr", "Sonarr", "Radarr", "Prowlarr", "qBittorrent"]);
  const observedMediaNames = new Set(mediaServices.map((entry) => entry.name));
  if (mediaServices.length !== expectedMediaNames.size || observedMediaNames.size !== expectedMediaNames.size
    || [...observedMediaNames].some((name) => !expectedMediaNames.has(name))) {
    mediaInfo = "unavailable";
  }
  const homarr = mediaServices.find((entry) => entry.name === "Homarr");
  let dashboard: string | null = null;
  if (homarr && mediaInfo === "available") dashboard = `${homarr.url}/boards/personal`;
  const https = await vaultwardenHttpsState(root, bundle.services.vaultwarden.httpsPlan);
  const services = [
    ...mediaServices,
    { name: "Immich", purpose: "Keep and browse your own photos", url: await bundleAccess(root, bundle.services.immich.input, "Immich") },
    { name: "Docmost", purpose: "Write and share private pages and documents", url: await bundleAccess(root, bundle.services.docmost.input, "Docmost") },
    { name: "Vaultwarden", purpose: "Store passwords in your private vault", url: https.origin },
  ];
  const handoffPath = join(root, ".selfhost", "bundles", bundle.id, "private-handoff.env");
  let credentialFile: string | null = null;
  if (existsSync(handoffPath)) credentialFile = handoffPath;
  let status = "Links and purposes only; use bundle status and direct app checks for runtime and acceptance.";
  if (mediaInfo !== "available") {
    status = "Partial links only: the media adapter could not read back Homarr and media URLs. Check Docker access, then rerun bundle info; do not treat this as a complete stack summary.";
  }
  let vaultwardenAccess = "Vaultwarden requires private DNS and CA trust on each intended client.";
  const vaultwardenHost = new URL(https.origin).hostname;
  if (vaultwardenHost === "localhost" || vaultwardenHost.endsWith(".localhost")) {
    vaultwardenAccess = "Vaultwarden's .localhost HTTPS link works on this host only and requires trust in Caddy's local CA here.";
  }
  let mediaAccess = "The media adapter did not confirm its host-port bind; inspect that run before relying on access from another device.";
  if (media?.bind === "127.0.0.1") {
    mediaAccess = "This approved media run binds its seven ports to loopback; its links work on this host only unless a separate private route is configured.";
  } else if (media?.bind === "0.0.0.0") {
    mediaAccess = "The media links shown use this host, but their seven ports publish on all host interfaces; confirm private router or Docker-aware firewall scope.";
  }
  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-info", bundle: bundle.id,
    dashboard, services, credentialFile, mediaInfo,
    access: `${mediaAccess} Immich and Docmost use selected private HTTP binds. ${vaultwardenAccess}`,
    status }, null, 2));
}

async function runBundleLifecycle(current: Awaited<ReturnType<typeof load>>, input: string, action: "up" | "down",
  approval: string, localHttps: LocalHttpsSelection | null, dependencies: Dependencies): Promise<void> {
  if (approval !== current.approval) fail(`bundle ${action} needs the exact approval from the unchanged bundle plan`);
  const bundle = current.bundle;
  const root = bundle.projectRoot;
  let route: Record<string, unknown> | null = null;
  if (localHttps) route = await validatedLocalHttps(bundle, localHttps, dependencies);

  const completed: string[] = [];
  const exactCall = async (serviceName: string, command: () => Promise<void>, phase: string): Promise<void> => {
    const result = await captureStatus(command);
    if (!result.ok) {
      const changed = completed.length > 0 ? completed.join(", ") : "none";
      fail(`Bundle ${action} ${phase} failed for ${serviceName} (${result.reason}). Projects already changed by this command: ${changed}. Inspect the exact adapter and run bundle status --project-root ${root} --input ${input} before retrying. Adapter output was suppressed to protect credentials.`);
    }
    if (phase === "mutation") completed.push(serviceName);
  };
  const checks: Array<[string, () => Promise<void>]> = [
    ["media", () => dependencies.media(["lifecycle-check", "--project-root", root, "--run-id", bundle.services.media.runId])],
    ["immich", () => dependencies.immich(["lifecycle-check", "--project-root", root, "--input", bundle.services.immich.input])],
    ["docmost", () => dependencies.docmost(["lifecycle-check", "--project-root", root, "--input", bundle.services.docmost.input,
      "--run-id", bundle.services.docmost.runId])],
    ["vaultwarden", () => dependencies.vaultwarden(["lifecycle-check", "--project-root", root,
      "--run-id", bundle.services.vaultwarden.runId])],
  ];
  if (localHttps) {
    checks.push(["local-https", () => dependencies.vaultwarden(["local-https", "lifecycle-check", "--project-root", root,
      "--run-id", localHttps.runId, "--input", localHttps.input])]);
  }
  for (const [serviceName, command] of checks) await exactCall(serviceName, command, "preflight");

  let mediaAction = "up";
  if (action === "down") mediaAction = "stop";
  const actions: Array<[string, () => Promise<void>]> = [
    ["media", () => dependencies.media([mediaAction, "--project-root", root, "--run-id", bundle.services.media.runId])],
    ["immich", () => dependencies.immich([action, "--project-root", root, "--input", bundle.services.immich.input])],
    ["docmost", () => dependencies.docmost([action, "--project-root", root, "--input", bundle.services.docmost.input,
      "--run-id", bundle.services.docmost.runId])],
    ["vaultwarden", () => dependencies.vaultwarden([action, "--project-root", root,
      "--run-id", bundle.services.vaultwarden.runId])],
  ];
  if (localHttps) {
    actions.push(["local-https", () => dependencies.vaultwarden(["local-https", action, "--project-root", root,
      "--run-id", localHttps.runId, "--input", localHttps.input])]);
  }
  if (action === "down") actions.reverse();
  for (const [serviceName, command] of actions) await exactCall(serviceName, command, "mutation");

  console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-lifecycle", bundle: bundle.id,
    action, status: "completed", projectRoot: root, projects: actions.map(([serviceName]) => serviceName),
    localHttps: route, volumesDeleted: false, resourcesPruned: false, fullAcceptance: false,
    next: `self-host bundle info --project-root ${root} --input ${input}` }, null, 2));
}

function parseHomarrInputs(args: string[]) {
  const action = args[0];
  if (action !== "plan" && action !== "apply") fail("Use bundle homarr-inputs plan or apply");
  const flags: Record<string, string> = {};
  const allowed = new Set(["--project-root", "--input", "--approve", "--shared-caddy-input"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated bundle homarr-inputs option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  if (!flags["--project-root"] || !flags["--input"]) {
    fail("bundle homarr-inputs needs --project-root and --input");
  }
  if (action === "apply" && !flags["--approve"]) {
    fail("bundle homarr-inputs apply needs --approve from its exact plan");
  }
  if (action === "plan" && flags["--approve"]) fail("bundle homarr-inputs plan is read-only and does not accept --approve");
  return { action, flags };
}

function parse(args: string[]) {
  const action = args[0];
  if (!action || !["begin", "init", "plan", "next", "run", "stage", "status", "info", "up", "down", "route-network", "parallel-plan", "parallel-apply", "https-ready", "handoff", "handoff-check"].includes(action)) {
    fail("Use bundle begin, init, plan, next, run, stage, status, info, up, down, route-network, parallel-plan, parallel-apply, https-ready, handoff, or handoff-check. begin inspects and plans; it never applies.");
  }
  const flags: Record<string, string> = {};
  const allowed = new Set(["--project-root", "--input", "--service", "--phase", "--approve", "--stage-approve", "--firewall-scope", "--from",
    "--id", "--username", "--email", "--name", "--host-inspection", "--host-ip", "--immich-port", "--docmost-port",
    "--vaultwarden-port", "--media-run-id", "--media-bind-mode", "--media-port-start", "--media-network-subnets", "--immich-network-subnet", "--docmost-network-subnet", "--vaultwarden-network-subnet", "--homarr-network", "--docmost-network", "--vaultwarden-route-network", "--docmost-image", "--postgres-image", "--redis-image", "--vaultwarden-image",
    "--vaultwarden-origin", "--https-route-owner", "--https-tls-owner", "--https-route-status", "--https-trust", "--network", "--immich-api-key-file",
    "--local-https-input", "--local-https-run-id", "--resolve-images", "--defer-indexer", "--immich-approve", "--docmost-approve"]);
  for (let index = 1; index < args.length;) {
    const name = args[index];
    if (name === "--resolve-images" || name === "--defer-indexer") {
      if (flags[name]) fail(`Invalid or repeated bundle option: ${name}`);
      flags[name] = "yes";
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) fail(`Invalid or repeated bundle option: ${name ?? "(missing)"}`);
    flags[name] = value;
    index += 2;
  }
  if (action === "init" && Object.keys(flags).length === 0) {
    fail("bundle init choices: --project-root, --id, --email, --name, --host-inspection; --resolve-images or verified --docmost-image, --postgres-image, --redis-image, --vaultwarden-image; and --vaultwarden-origin, --https-route-owner, --https-tls-owner. Optional: --username (admin), --host-ip (127.0.0.1), --immich-port (2283), --docmost-port (3000), --vaultwarden-port (8080), --media-bind-mode host-only, --media-port-start FIRST_OF_SEVEN, --media-network-subnets DEFAULT_CIDR,WEB_CIDR, --immich-network-subnet, --docmost-network-subnet, --vaultwarden-network-subnet, --media-run-id, --homarr-network, --docmost-network, --vaultwarden-route-network. Record HTTPS only after verification with --https-route-status configured and --https-trust verified-for-intended-client.");
  }
  if (action === "begin" && Object.keys(flags).length === 0) {
    fail("bundle begin needs --project-root, --id, --email, --name, --vaultwarden-origin, --https-route-owner, --https-tls-owner, and --resolve-images or four reviewed immutable image references. Optional: --username, --host-ip, selected app ports, --media-run-id for an existing CLI media run, or --media-port-start, private network subnets, and --media-bind-mode for a new run. It starts a journey, inspects exact new ports, writes owner-only inputs, and prints a plan without applying.");
  }
  if (!flags["--project-root"]) fail("Bundle commands need --project-root");
  if (action !== "init" && action !== "begin" && !flags["--input"] && !SOLE_INPUT_ACTIONS.has(action)) {
    fail(`bundle ${action} needs --input`);
  }
  if (action === "init" && flags["--input"]) fail("bundle init creates its input and does not accept --input");
  if (action === "plan" && Object.keys(flags).some((name) => !["--project-root", "--input"].includes(name))) fail("bundle plan accepts only --project-root and --input");
  const nextOptions = ["--project-root", "--input", "--approve", "--stage-approve", "--firewall-scope", "--local-https-input", "--local-https-run-id", "--defer-indexer"];
  if ((action === "next" || action === "run") && Object.keys(flags).some((name) => !nextOptions.includes(name))) {
    fail(`bundle ${action} accepts project root, input, optional exact bundle and adapter approval tokens, and one exact local-HTTPS selection`);
  }
  const statusOptions = ["--project-root", "--input", "--local-https-input", "--local-https-run-id"];
  if (action === "status" && Object.keys(flags).some((name) => !statusOptions.includes(name))) {
    fail("bundle status accepts project root, input, and an optional explicit local-HTTPS input and run ID");
  }
  if (action === "info" && Object.keys(flags).some((name) => !["--project-root", "--input"].includes(name))) {
    fail("bundle info accepts only project root and input");
  }
  const parallelOptions = ["--project-root", "--input", "--host-inspection", "--approve", "--immich-approve", "--docmost-approve"];
  if (action === "parallel-plan" || action === "parallel-apply") {
    if (Object.keys(flags).some((name) => !parallelOptions.includes(name)) || !flags["--host-inspection"]) {
      fail(`bundle ${action} needs --project-root and a fresh --host-inspection report checking both app ports`);
    }
    if (action === "parallel-plan" && ["--approve", "--immich-approve", "--docmost-approve"].some((name) => flags[name])) {
      fail("bundle parallel-plan is read-only and does not accept approval tokens");
    }
    if (action === "parallel-apply" && ["--approve", "--immich-approve", "--docmost-approve"].some((name) => !flags[name])) {
      fail("bundle parallel-apply needs the bundle approval and both exact adapter apply tokens");
    }
  }
  const lifecycleOptions = [...statusOptions, "--approve"];
  if ((action === "up" || action === "down") && Object.keys(flags).some((name) => !lifecycleOptions.includes(name))) {
    fail(`bundle ${action} accepts project root, input, exact approval, and an optional explicit local-HTTPS input and run ID`);
  }
  if ((action === "up" || action === "down") && !flags["--approve"]) {
    fail(`bundle ${action} needs --approve from the unchanged bundle plan`);
  }
  if (action === "handoff" && Object.keys(flags).some((name) => !["--project-root", "--input", "--immich-api-key-file"].includes(name))) {
    fail("bundle handoff accepts only --project-root, --input, and optional --immich-api-key-file");
  }
  if (action === "handoff-check" && Object.keys(flags).some((name) => !["--project-root", "--input"].includes(name))) {
    fail("bundle handoff-check accepts only --project-root and --input");
  }
  const routeNetworkOptions = ["--project-root", "--input", "--host-inspection", "--network", "--approve"];
  const routeNetworkAllowed = [...routeNetworkOptions, "--service"];
  if (action === "route-network" && Object.keys(flags).some((name) => !routeNetworkAllowed.includes(name))) {
    fail("bundle route-network accepts only --project-root, --input, --host-inspection, --network, --approve, and optional --service");
  }
  if (action === "route-network" && routeNetworkOptions.some((name) => !flags[name])) {
    fail("bundle route-network needs --project-root, --input, --host-inspection, --network, and --approve");
  }
  if (action === "route-network" && flags["--service"]
    && !["vaultwarden", "media-web"].includes(flags["--service"])) {
    fail("bundle route-network --service must be vaultwarden or media-web");
  }
  const httpsReadyOptions = ["--project-root", "--input", "--approve", "--https-route-status", "--https-trust"];
  if (action === "https-ready" && (httpsReadyOptions.some((name) => !flags[name])
    || Object.keys(flags).some((name) => !httpsReadyOptions.includes(name)))) {
    fail("bundle https-ready needs --project-root, --input, the current --approve token, --https-route-status configured, and --https-trust verified-for-intended-client");
  }
  const initOptions = ["--project-root", "--id", "--username", "--email", "--name", "--host-inspection", "--host-ip",
    "--immich-port", "--docmost-port", "--vaultwarden-port", "--media-run-id", "--media-bind-mode", "--media-port-start", "--media-network-subnets", "--immich-network-subnet", "--docmost-network-subnet", "--vaultwarden-network-subnet", "--homarr-network", "--docmost-network", "--vaultwarden-route-network", "--docmost-image", "--postgres-image", "--redis-image",
    "--vaultwarden-image", "--vaultwarden-origin", "--https-route-owner", "--https-tls-owner", "--https-route-status", "--https-trust", "--resolve-images"];
  if (action === "init" && Object.keys(flags).some((name) => !initOptions.includes(name))) fail("bundle init received an option for another bundle action");
  const beginOptions = initOptions.filter((name) => !["--host-inspection", "--https-route-status", "--https-trust"].includes(name));
  if (action === "begin" && Object.keys(flags).some((name) => !beginOptions.includes(name))) {
    fail("bundle begin accepts only reviewed init choices; host inspection and HTTPS readiness are recorded by their own verified steps");
  }
  const stageOptions = ["--project-root", "--input", "--service", "--phase", "--approve", "--stage-approve", "--firewall-scope", "--from", "--defer-indexer"];
  if (action === "stage" && Object.keys(flags).some((name) => !stageOptions.includes(name))) fail("bundle stage received an init-only option");
  if (action === "stage" && flags["--from"] && (flags["--service"] !== "media" || flags["--phase"] !== "resume")) {
    fail("--from applies only to the media resume stage");
  }
  const deferActions = ["stage", "next", "run"];
  if (flags["--defer-indexer"] && !deferActions.includes(action)) {
    fail("--defer-indexer applies only to the media apply or resume stage");
  }
  if (action === "stage" && flags["--defer-indexer"]
    && (flags["--service"] !== "media" || !["apply", "resume"].includes(flags["--phase"]))) {
    fail("--defer-indexer applies only to the media apply or resume stage");
  }
  if (["next", "run", "status", "up", "down"].includes(action)) localHttpsSelection(flags);
  return { action, flags };
}

async function begin(root: string, flags: Record<string, string>, dependencies: Dependencies): Promise<void> {
  const required = ["--id", "--email", "--name", "--vaultwarden-origin", "--https-route-owner", "--https-tls-owner"];
  const missing = required.filter((name) => !flags[name]);
  if (missing.length > 0) fail(`bundle begin still needs: ${missing.join(", ")}`);
  const id = flags["--id"];
  if (!ID.test(id)) fail("--id must be a lowercase bundle identifier up to 40 characters");
  if (flags["--media-run-id"] && !ID.test(flags["--media-run-id"])) {
    fail("--media-run-id must be one exact CLI media run ID");
  }
  const username = flags["--username"] ?? "admin";
  if (!USERNAME.test(username)) fail("--username is invalid");
  if (!EMAIL.test(flags["--email"]) || flags["--email"].length > 254) fail("--email must be a valid account email");
  const name = flags["--name"];
  if (name.trim() !== name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) fail("--name must be a bounded display name");
  privateHost(flags["--host-ip"] ?? "127.0.0.1");
  httpsOrigin(flags["--vaultwarden-origin"]);
  if (!OWNER.test(flags["--https-route-owner"]) || !OWNER.test(flags["--https-tls-owner"])) {
    fail("--https-route-owner and --https-tls-owner need bounded owner IDs");
  }
  const images = Object.keys(HOUSEHOLD_IMAGE_TAGS);
  if (flags["--resolve-images"] && images.some((option) => flags[option])) {
    fail("--resolve-images cannot be combined with explicit image options");
  }
  if (!flags["--resolve-images"] && images.some((option) => !flags[option])) {
    fail(`bundle begin needs --resolve-images or all four immutable image options: ${images.join(", ")}`);
  }
  if (!flags["--resolve-images"]) {
    if (!/^docker\.io\/docmost\/docmost:0\.96\.0@sha256:[0-9a-f]{64}$/.test(flags["--docmost-image"])
      || !/^docker\.io\/library\/postgres:18(?:\.[0-9]+)?@sha256:[0-9a-f]{64}$/.test(flags["--postgres-image"])
      || !/^docker\.io\/library\/redis:8(?:\.[0-9]+){0,2}@sha256:[0-9a-f]{64}$/.test(flags["--redis-image"])
      || !DIGEST_IMAGE.test(flags["--vaultwarden-image"])) {
      fail("bundle begin requires four reviewed tag-plus-sha256 image references");
    }
  }
  const appPorts = ["--immich-port", "--docmost-port", "--vaultwarden-port"]
    .map((option, index) => numberFlag(flags[option] ?? ["2283", "3000", "8080"][index], option));
  const selectedPorts = new Set(appPorts);
  if (selectedPorts.size !== appPorts.length) fail("Selected app ports must be distinct");
  if (flags["--media-port-start"]) {
    const start = numberFlag(flags["--media-port-start"], "--media-port-start");
    if (start < 20000 || start > 44993) fail("--media-port-start must be from 20000 through 44993");
    for (let index = 0; index < MEDIA_SERVICES.length; index += 1) {
      const port = start + index;
      if (selectedPorts.has(port)) fail("Selected media ports overlap an app port");
      selectedPorts.add(port);
    }
  }
  if (flags["--media-run-id"] && (flags["--media-bind-mode"] || flags["--media-port-start"] || flags["--media-network-subnets"])) {
    fail("An adopted media run keeps its existing bind, ports, and networks; omit all new-media options");
  }
  if (selectedPorts.size > 16) fail("bundle begin exceeds the inspector's 16 exact TCP port checks");
  if (flags["--media-bind-mode"] && !["host-only", "all-interfaces"].includes(flags["--media-bind-mode"])) {
    fail("--media-bind-mode accepts host-only or all-interfaces");
  }
  if (!flags["--media-bind-mode"] && !flags["--media-run-id"]) flags["--media-bind-mode"] = "host-only";
  const privateSubnets: string[] = [];
  if (flags["--media-network-subnets"]) {
    const mediaSubnets = parseMediaNetworkSubnets(flags["--media-network-subnets"]);
    privateSubnets.push(mediaSubnets.default, mediaSubnets.web);
  }
  privateSubnets.push(...["--immich-network-subnet", "--docmost-network-subnet", "--vaultwarden-network-subnet"]
    .filter((option) => flags[option]).map((option) => parsePrivateNetworkSubnet(flags[option])));
  assertNonOverlappingPrivateSubnets(privateSubnets);
  const bundlePath = join(root, ".selfhost", "bundles", id, "household-bundle.json");
  const report = join(root, ".selfhost", "journeys", `${id}-host-inspection.json`);
  for (const path of [join(root, ".selfhost", "bundles", id), report]) {
    try { await lstat(path); fail(`bundle begin refuses to overwrite existing path: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await beginProgress(() => bundleJourneyCommand(["start", "--project-root", root, "--id", id]));
  await ownedPrivateDirectory(join(root, ".selfhost", "journeys"), "Journey directory");
  const inspectionArgs = ["--limit", "50", ...[...selectedPorts].map((port) => ["--check-tcp-port", String(port)]).flat(), "--output", report];
  await (dependencies.inspectHost ?? inspectBundledHost)(inspectionArgs);
  const initFlags = { ...flags, "--host-inspection": report };
  await beginProgress(() => initialize(root, initFlags, dependencies));
  const current = await load(root, bundlePath);
  printPlan(current.bundle, bundlePath, current.approval, current.fingerprints);
}

async function beginProgress(command: () => Promise<void>): Promise<void> {
  const originalLog = console.log;
  const originalWrite = process.stdout.write;
  console.log = (...values: unknown[]) => {
    process.stderr.write(`${values.map(String).join(" ")}\n`);
  };
  process.stdout.write = ((chunk: string | Uint8Array) => process.stderr.write(chunk)) as typeof process.stdout.write;
  try {
    await command();
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
}

function printPlan(bundle: Bundle, input: string, approval: string, fingerprints: Record<string, string>): void {
  const root = bundle.projectRoot;
  const services = bundle.services;
  const common = `--project-root ${root}`;
  let mediaExposure = "All seven media ports bind to every host interface; verify private router or Docker-aware firewall scope before first apply.";
  let mediaPorts: number[] | string = "automatic";
  let mediaNetworkSubnets: MediaNetworkSubnets | string = services.media.networkSubnets ?? "automatic";
  if (services.media.bindMode === "host-only") {
    mediaExposure = "All seven media ports bind to 127.0.0.1; another device needs a separately approved private route.";
  }
  if (services.media.portStart !== undefined) {
    mediaPorts = Array.from({ length: MEDIA_SERVICES.length }, (_, index) => services.media.portStart! + index);
  }
  if (services.media.mode === "adopt") {
    mediaExposure = "Adopted CLI media exposure is not bound in this older bundle input; inspect the existing run before approval.";
    mediaPorts = "unverified-existing-run";
    mediaNetworkSubnets = "existing-run";
    if (services.media.adoptedMedia) {
      mediaPorts = services.media.adoptedMedia.ports;
      mediaExposure = "Adopted CLI media plan recorded all seven ports on every host interface; verify the existing private firewall scope.";
      if (services.media.adoptedMedia.bind === "127.0.0.1") {
        mediaExposure = "Adopted CLI media plan recorded all seven ports on 127.0.0.1; another device needs a separately approved private route.";
      }
    }
  }
  let mediaBind: "127.0.0.1" | "0.0.0.0" | null = null;
  if (services.media.mode === "adopt") mediaBind = services.media.adoptedMedia?.bind ?? null;
  else if (services.media.bindMode === "host-only") mediaBind = "127.0.0.1";
  else mediaBind = "0.0.0.0";
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "household-bundle-plan",
    status: "ready-for-staged-planning",
    mutation: false,
    bundle: bundle.id,
    projectRoot: root,
    input,
    approval,
    mediaExposure,
    mediaPorts,
    mediaNetworkSubnets,
    mediaSelection: { mode: services.media.mode ?? "create", runId: services.media.runId,
      bind: mediaBind,
      source: services.media.adoptedMedia?.source ?? "bundle-selection",
      approvalDigest: services.media.adoptedMedia?.approvalDigest ?? null },
    inputFingerprints: fingerprints,
    stages: [
      { service: "media", purpose: "Netflix-style library and requests", next: `self-host bundle stage ${common} --input ${input} --service media --phase prepare --approve ${approval}`, acceptance: "seven-service adapter verification; no media content or indexer is added" },
      { service: "immich", purpose: "Google Photos replacement", next: `self-host bundle stage ${common} --input ${input} --service immich --phase plan`, acceptance: "separate apply, bootstrap, and setup-closure approvals plus direct app checks" },
      { service: "docmost", purpose: "Notion-style collaborative pages", next: `self-host bundle stage ${common} --input ${input} --service docmost --phase plan`, acceptance: "separate version-pinned API-owner approval with browser fallback; fresh-client login, page and attachment evidence remain required; recovery is not verified" },
      { service: "vaultwarden", purpose: "Bitwarden-compatible password vault", next: `self-host bundle stage ${common} --input ${input} --service vaultwarden --phase prepare --approve ${approval}`, acceptance: "trusted private HTTPS, browser signup, registration closure and fresh login/unlock remain required; isolated recovery is required before migrating real vault contents" },
    ],
    composition: {
      oneCommandLimit: "Each mutating stage keeps its adapter-specific exact approval. Re-run the same stage after repair to resume from adapter-owned state.",
      homarr: "Attach only after each app is accepted; app tiles, integrations, widgets, and runtime health are separate claims.",
      paths: "All referenced inputs and account metadata stay inside this project root.",
      timing: services.media.mode === "adopt"
        ? "Existing media setup predates this bundle; this extension is not a fresh full-stack speed measurement."
        : "No under-ten-minute completion claim has been measured.",
    },
    runIds: Object.fromEntries(Object.entries(services).map(([name, config]) => [name, config.runId])),
  }, null, 2));
}

export async function bundleCommand(args: string[], dependencies: Dependencies): Promise<void> {
  if (args[0] === "approvals") {
    await bundleApprovalsCommand(args.slice(1), dependencies, bundleCommand);
    return;
  }
  if (args[0] === "journey") {
    await bundleJourneyCommand(args.slice(1));
    return;
  }
  if (args[0] === "benchmark") {
    await bundleBenchmarkCommand(args);
    return;
  }
  if (args[0] === "caddy-inputs") {
    const parsed = parseCaddyInputs(args.slice(1));
    const current = await load(parsed.flags["--project-root"], parsed.flags["--input"]);
    await caddyInputs(current, parsed.flags["--input"], parsed.flags, parsed.action, dependencies);
    return;
  }
  if (args[0] === "homarr-inputs") {
    const parsed = parseHomarrInputs(args.slice(1));
    const current = await load(parsed.flags["--project-root"], parsed.flags["--input"]);
    const plan = await homarrInputPlan(current, parsed.flags["--input"], dependencies, parsed.flags["--shared-caddy-input"]);
    if (parsed.action === "plan") {
      printHomarrInputs(current.bundle, plan, "ready-for-review", false);
      return;
    }
    await applyHomarrInputs(current.bundle, plan, parsed.flags["--approve"]);
    return;
  }
  if (args[0] === "homarr-attach") {
    await bundleHomarrAttachCommand(args.slice(1), dependencies.homarrAttach);
    return;
  }
  const parsed = parse(args);
  if (parsed.action === "begin") {
    const root = await ownedProjectRoot(parsed.flags["--project-root"]);
    await assertPackagedCatalogProject(root);
    await begin(root, parsed.flags, dependencies);
    return;
  }
  if (parsed.action === "init") {
    const root = await ownedProjectRoot(parsed.flags["--project-root"]);
    await assertPackagedCatalogProject(root);
    await initialize(root, parsed.flags, dependencies);
    return;
  }
  if (!parsed.flags["--input"] && SOLE_INPUT_ACTIONS.has(parsed.action)) {
    parsed.flags["--input"] = await soleBundleInput(parsed.flags["--project-root"]);
  }
  if (parsed.action === "route-network") {
    const root = await ownedProjectRoot(parsed.flags["--project-root"]);
    if (parsed.flags["--service"] === "media-web") {
      await reviseMediaWebNetwork(root, parsed.flags["--input"], parsed.flags, dependencies);
    } else {
      await reviseRouteNetwork(root, parsed.flags["--input"], parsed.flags);
    }
    return;
  }
  if (parsed.action === "https-ready") {
    const root = await ownedProjectRoot(parsed.flags["--project-root"]);
    await recordHttpsReady(root, parsed.flags["--input"], parsed.flags);
    return;
  }
  const current = await load(parsed.flags["--project-root"], parsed.flags["--input"]);
  if (parsed.action === "parallel-plan" || parsed.action === "parallel-apply") {
    await parallelAppApply(current, parsed.flags["--input"], parsed.flags, dependencies, parsed.action === "parallel-apply");
    return;
  }
  if (parsed.action === "plan") {
    printPlan(current.bundle, parsed.flags["--input"], current.approval, current.fingerprints);
    return;
  }
  if (parsed.action === "next") {
    await printNext(current, parsed.flags["--input"], parsed.flags, dependencies);
    return;
  }
  if (parsed.action === "run") {
    await runBundle(current, parsed.flags["--input"], parsed.flags, dependencies);
    return;
  }
  if (parsed.action === "status") {
    await printAggregateStatus(current.bundle, parsed.flags["--input"], dependencies,
      localHttpsSelection(parsed.flags), current.approval);
    return;
  }
  if (parsed.action === "info") {
    await printBundleInfo(current.bundle, dependencies);
    return;
  }
  if (parsed.action === "up" || parsed.action === "down") {
    await runBundleLifecycle(current, parsed.flags["--input"], parsed.action, parsed.flags["--approve"],
      localHttpsSelection(parsed.flags), dependencies);
    return;
  }
  if (parsed.action === "handoff") {
    const result = await exportBundleHandoff(current.bundle, parsed.flags["--immich-api-key-file"]);
    console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-private-handoff", bundle: current.bundle.id,
      path: result.path, mode: "0600", secretsPrinted: false, pending: result.pending,
      scope: "Credential and URL export only. This does not prove application, Homarr, client access, or recovery acceptance." }, null, 2));
    return;
  }
  if (parsed.action === "handoff-check") {
    const result = await checkBundleVaultwardenHandoff(current.bundle);
    console.log(JSON.stringify({ schemaVersion: 1, kind: "household-bundle-handoff-check", bundle: current.bundle.id,
      path: result.path, vaultwardenPasswordMatchesAdapter: result.matches, mutation: false,
      secretsPrinted: false, scope: "Compares the existing private bundle export with the adapter-owned Vaultwarden credential; does not prove browser login or vault acceptance." }, null, 2));
    return;
  }
  const serviceName = parsed.flags["--service"];
  if (!serviceName || !["media", "immich", "docmost", "vaultwarden"].includes(serviceName)) fail("bundle stage needs --service media|immich|docmost|vaultwarden");
  const service = serviceName as Service;
  const phase = parsed.flags["--phase"];
  if (!phase) fail("bundle stage needs --phase");
  const approval = parsed.flags["--approve"];
  const mutating = ["prepare", "apply", "resume", "bootstrap", "close-setup", "recover-plan", "close-registration", "owner-apply", "accept-apply"].includes(phase);
  if (mutating && approval !== current.approval) fail("Mutating bundle stages need the exact approval from the unchanged bundle plan");
  if (!mutating && approval) fail("Read-only bundle stages do not accept --approve");
  const root = current.bundle.projectRoot;
  const config = current.bundle.services[service];
  const stageApproval = parsed.flags["--stage-approve"];
  const firewallScope = mediaFirewallScope(parsed.flags);
  if (firewallScope !== null && (service !== "media" || phase !== "apply")) {
    fail("--firewall-scope applies only to the initial media apply stage");
  }
  if (service === "media") {
    if (!["prepare", "apply", "resume", "status"].includes(phase)) fail("Media bundle phases are prepare, apply, resume, or status");
    if (config.mode === "adopt" && (phase === "apply" || phase === "resume")) {
      fail("An adopted media run is already applied; use media status or its own CLI upkeep commands, not bundle apply/resume");
    }
    const next = [phase, "--project-root", root, "--run-id", config.runId];
    if (phase === "prepare") {
      if (config.mode === "adopt") {
        await dependencies.media(["status", "--project-root", root, "--run-id", config.runId, "--json", "yes"]);
        return;
      }
      let handoff = "no";
      if (config.credentialHandoff) handoff = "yes";
      next.push("--username", config.username, "--credential-handoff", handoff);
      if (config.bindMode === "host-only") next.push("--bind-mode", "host-only");
      if (config.portStart !== undefined) next.push("--port-start", String(config.portStart));
      if (config.networkSubnets !== undefined) next.push("--network-subnets", `${config.networkSubnets.default},${config.networkSubnets.web}`);
    }
    if (phase === "apply" || phase === "resume") {
      if (!stageApproval) fail(`Media ${phase} needs --stage-approve with its exact adapter digest`);
      next.push("--approve", stageApproval);
      if (phase === "apply" && firewallScope !== null) next.push("--firewall-scope", firewallScope);
      if (phase === "resume") {
        if (!parsed.flags["--from"]) fail("Media resume needs --from with its recorded failed stage");
        next.push("--from", parsed.flags["--from"]);
      }
      if (parsed.flags["--defer-indexer"]) next.push("--defer-indexer");
    }
    await dependencies.media(next);
    return;
  }
  if (service === "immich") {
    if (!["plan", "apply", "bootstrap", "close-setup", "status"].includes(phase)) {
      fail("Immich bundle phases are plan, apply, bootstrap, close-setup, or status");
    }
    const next = [phase, "--project-root", root, "--input", config.input];
    if (phase !== "status") next.push("--run-id", config.runId, "--account-file", config.accountFile);
    if (["apply", "bootstrap", "close-setup"].includes(phase)) {
      if (!stageApproval) fail(`Immich ${phase} needs --stage-approve with its exact adapter token`);
      next.push("--approve", stageApproval);
    }
    await dependencies.immich(next);
    return;
  }
  if (service === "docmost") {
    if (!["plan", "recover-plan", "apply", "status", "owner-plan", "owner-apply", "owner-status", "accept-plan", "accept-apply", "accept-status", "accept-verify"].includes(phase)) {
      fail("Docmost bundle phases are plan, recover-plan, apply, status, owner-plan|apply|status, or accept-plan|apply|status|verify");
    }
    let next = [phase, "--project-root", root, "--input", config.input, "--run-id", config.runId];
    if (phase.startsWith("owner-")) next = ["owner", phase.slice("owner-".length), "--project-root", root,
      "--input", config.input, "--run-id", config.runId];
    if (phase.startsWith("accept-")) next = ["accept", phase.slice("accept-".length), "--project-root", root,
      "--input", config.input, "--run-id", config.runId];
    if (!["status", "owner-status", "accept-status"].includes(phase)) next.push("--account-file", config.accountFile);
    if (phase === "apply" || phase === "owner-apply" || phase === "accept-apply") {
      if (!stageApproval) fail(`Docmost ${phase} needs --stage-approve with its exact adapter token`);
      if (phase === "accept-apply") {
        const owner = parsedStatus(await captureStatus(() => dependencies.docmost(["status", "--project-root", root,
          "--input", config.input, "--run-id", config.runId])));
        const acceptance = await inspectDocmostAcceptance(current.bundle, dependencies, owner);
        if (!newDocmostOwner(owner) || acceptance?.status !== "planned" || acceptance.replayAllowed !== true
          || stageApproval !== acceptance.approval) fail("Docmost bundle acceptance requires the original newly managed owner and exact unconsumed acceptance token");
        const plan = parsedStatus(await captureStatus(() => dependencies.docmost(["accept", "plan", "--project-root", root,
          "--input", config.input, "--run-id", config.runId, "--account-file", config.accountFile])));
        if (!docmostAcceptancePlanReady(plan, acceptance)) fail("Docmost bundle acceptance needs the unchanged ready pinned acceptance plan");
      }
      next.push("--approve", stageApproval);
    }
    await dependencies.docmost(next);
    return;
  }
  if (!["prepare", "apply", "status"].includes(phase)) fail("Vaultwarden bundle phases are prepare, apply, or status; registration closure follows its browser checkpoint");
  if ((phase === "prepare" || phase === "apply") && !await vaultwardenHttpsReady(root, config.httpsPlan)) {
    fail("Vaultwarden remains blocked until its private route is configured and certificate trust is verified for the intended client");
  }
  const next = [phase, "--project-root", root, "--run-id", config.runId];
  if (phase === "prepare") next.push("--account-file", config.accountFile, "--input", config.input, "--https-plan", config.httpsPlan);
  if (phase === "apply") {
    if (!stageApproval) fail("Vaultwarden apply needs --stage-approve with its exact adapter digest");
    next.push("--approve", stageApproval);
  }
  await dependencies.vaultwarden(next);
}
