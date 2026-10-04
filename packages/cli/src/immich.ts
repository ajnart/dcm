import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildImmichManifest } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/immich-plan.ts";
import {
  createHouseholdCredentials,
  loadHouseholdCredential,
  materializeHouseholdCredential,
} from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-credentials.ts";
import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { bootstrapImmichAdmin, inspectInitialization, verifyLogin } from "./lib/immich-admin-api.ts";

type Account = {
  schemaVersion: 1;
  email: string;
  name: string;
  username: string;
};

type Options = {
  action: "apply" | "bootstrap" | "close-setup" | "plan" | "status" | "up" | "down" | "lifecycle-check";
  accountFile: string;
  approval: string;
  input: string;
  projectRoot: string;
  runId: string;
};

type ComposeStatus = { id: string | null; service: string; state: string; health: string | null };
type ClosureEvidence = {
  checkedAt: string;
  project: { id: string; directory: string; owner: string };
  port: { hostIp: string; published: number; protocol: "tcp"; owner: string };
  paths: Array<{ path: string; owner: string }>;
  networks: Array<{ name: string; owner: string }>;
};

export type ImmichRuntime = {
  preflight?: (plan: Awaited<ReturnType<typeof preparePlan>>) => Promise<void>;
  composeApply?: () => Promise<void>;
  composeStop?: () => Promise<void>;
  composeStatus?: (manifest: Record<string, any>, target: string) => ComposeStatus[];
  dockerJson?: (args: string[], label: string) => unknown;
  inspectInitialization?: (origin: string) => Promise<boolean | null>;
  verifyLogin?: (origin: string, email: string, password: string) => Promise<boolean>;
};

const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const maximumInputBytes = 256 * 1024;
const maximumAccountBytes = 8 * 1024;

function fail(message: string): never { throw new Error(message); }

function parse(args: string[]): Options {
  const action = args[0];
  if (!action || !["apply", "bootstrap", "close-setup", "plan", "status", "up", "down", "lifecycle-check"].includes(action)) {
    fail("Use immich plan, apply, bootstrap, close-setup, status, up, or down");
  }
  const flags: Record<string, string> = {};
  const allowed = new Set(["--account-file", "--approve", "--input", "--project-root", "--run-id"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated Immich option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  if (!flags["--project-root"] || !flags["--input"]) {
    fail("Immich commands need --project-root and --input");
  }
  if (["plan", "apply", "bootstrap", "close-setup"].includes(action) && (!flags["--run-id"] || !flags["--account-file"])) {
    fail(`immich ${action} needs --run-id and --account-file`);
  }
  if (["apply", "bootstrap", "close-setup"].includes(action) && !flags["--approve"]) {
    fail(`immich ${action} needs --approve with the exact token from immich plan`);
  }
  if (["plan", "status", "up", "down", "lifecycle-check"].includes(action) && flags["--approve"]) {
    fail(`immich ${action} does not accept --approve`);
  }
  if (["status", "up", "down", "lifecycle-check"].includes(action) && (flags["--run-id"] || flags["--account-file"])) {
    fail(`immich ${action} uses only the exact manifest input`);
  }
  return {
    action: action as Options["action"],
    accountFile: flags["--account-file"] ?? "",
    approval: flags["--approve"] ?? "",
    input: flags["--input"],
    projectRoot: flags["--project-root"],
    runId: flags["--run-id"] ?? "",
  };
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  if (path === "") return true;
  if (path === ".." || path.startsWith(`..${sep}`)) return false;
  return !isAbsolute(path);
}

async function inspectProjectRoot(input: string): Promise<string> {
  if (!isAbsolute(input) || resolve(input) !== input || input === "/") fail("--project-root must be an exact absolute project path");
  if (input === await realpath(homedir())) fail("--project-root must not be the user home directory");
  const metadata = await lstat(input);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(input) !== input) fail("Project root must be one real directory");
  if ((metadata.mode & 0o002) !== 0) fail("Project root must not be world-writable");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Project root has a different owner");
  return input;
}

async function readJsonFile(path: string, maximumBytes: number, privateFile: boolean, name = "Input"): Promise<unknown> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("Input paths must be exact and absolute");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path) {
    fail("Input must be one regular file without links");
  }
  if (metadata.size < 1 || metadata.size > maximumBytes) fail("Input file has an invalid size");
  if (privateFile && (metadata.mode & 0o777) !== 0o600) fail(`${name} must use mode 0600`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail("Input file has a different owner");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("Input is not valid JSON");
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

async function readAccount(root: string, path: string): Promise<Account> {
  if (!inside(root, path)) fail("--account-file must stay inside the selected project root");
  const value = await readJsonFile(path, maximumAccountBytes, true, "Account input");
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Account input is invalid");
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["schemaVersion", "email", "name", "username"]) || record.schemaVersion !== 1
    || typeof record.email !== "string" || record.email.length < 3 || record.email.length > 254
    || !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(record.email)
    || typeof record.name !== "string" || record.name.trim() !== record.name || record.name.length < 1 || record.name.length > 128
    || /[\u0000-\u001f\u007f]/.test(record.name)
    || typeof record.username !== "string" || !usernamePattern.test(record.username)) {
    fail("Account input must contain valid schemaVersion, email, name, and username fields");
  }
  return record as Account;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

async function preparePlan(options: Options) {
  const root = await inspectProjectRoot(options.projectRoot);
  if (!inside(root, options.input)) fail("--input must stay inside the selected project root");
  const raw = await readJsonFile(options.input, maximumInputBytes, false);
  const manifest = buildImmichManifest(raw) as Record<string, any>;
  if (manifest.project.root !== root) fail("Immich manifest project.root must equal --project-root");
  if (!inside(root, manifest.project.directory)) fail("Immich Compose project must stay inside --project-root");
  const expectedSecret = join(manifest.project.directory, "secrets", "immich-database-password");
  const server = manifest.services.find((service: Record<string, any>) => service.id === "immich-server");
  const database = manifest.services.find((service: Record<string, any>) => service.id === "database");
  if (!server || !database || server.secretRefs[0]?.filePath !== expectedSecret || database.secretRefs[0]?.filePath !== expectedSecret) {
    fail("Immich CLI requires the managed database secret path inside the exact Compose project");
  }
  const composeOwner = createSelfhostComposeOwner(manifest);
  const composePlan = await composeOwner.plan();
  let account: Account | null = null;
  if (!["status", "up", "down", "lifecycle-check"].includes(options.action)) {
    if (!runIdPattern.test(options.runId)) fail("Invalid Immich run ID");
    account = await readAccount(root, options.accountFile);
  }
  const approvalDigest = createHash("sha256").update(canonical({ manifest, composePlan, runId: options.runId, account })).digest("hex");
  const applyApproval = `APPLY:${manifest.project.id}:${approvalDigest}`;
  let bootstrapApproval: string | null = null;
  let closeSetupApproval: string | null = null;
  if (server.environment.some((entry: Record<string, string>) => entry.name === "IMMICH_ALLOW_SETUP" && entry.value === "true")) {
    bootstrapApproval = `BOOTSTRAP:${manifest.project.id}:${approvalDigest}`;
    closeSetupApproval = `CLOSE_SETUP:${manifest.project.id}:${approvalDigest}`;
  }
  return { root, manifest, composeOwner, composePlan, account, approvalDigest, applyApproval, bootstrapApproval, closeSetupApproval };
}

async function ensurePrivateState(root: string): Promise<void> {
  const state = join(root, ".selfhost");
  if (!existsSync(state)) await mkdir(state, { mode: 0o700 });
  const metadata = await lstat(state);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) fail(".selfhost must be an owner-only directory (0700)");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(".selfhost has a different owner");
  const ignore = join(state, ".gitignore");
  if (!existsSync(ignore)) {
    const handle = await open(ignore, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile("*\n"); await handle.sync(); }
    finally { await handle.close(); }
  }
  const ignoreMetadata = await lstat(ignore);
  if (!ignoreMetadata.isFile() || ignoreMetadata.isSymbolicLink() || ignoreMetadata.nlink !== 1 || (ignoreMetadata.mode & 0o777) !== 0o600
    || await readFile(ignore, "utf8") !== "*\n") fail(".selfhost/.gitignore must be the private wildcard guard");
}

async function ensureCredential(root: string, runId: string, account: Account) {
  await ensurePrivateState(root);
  const handoff = join(root, ".selfhost", "household", ".sessions", runId, "artifacts", "private-handoff.json");
  let path = handoff;
  if (!existsSync(handoff)) {
    const created = createHouseholdCredentials({ projectRoot: root, runId, username: account.username, email: account.email, services: ["immich"] });
    path = created.path;
  }
  const credential = loadHouseholdCredential(root, runId, "immich");
  if (credential.username !== account.username || credential.email !== account.email) fail("Existing Immich credential handoff does not match the approved account");
  return { credential, path };
}

function existingCredential(root: string, runId: string, account: Account) {
  const path = join(root, ".selfhost", "household", ".sessions", runId, "artifacts", "private-handoff.json");
  if (!existsSync(path)) fail("Immich setup closure needs the existing private credential handoff from the approved bootstrap");
  const credential = loadHouseholdCredential(root, runId, "immich");
  if (credential.username !== account.username || credential.email !== account.email) {
    fail("Existing Immich credential handoff does not match the approved account");
  }
  return credential;
}

async function replacePrivateInput(root: string, path: string, value: unknown): Promise<void> {
  await readJsonFile(path, maximumInputBytes, true, "Immich input");
  const parent = dirname(path);
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || await realpath(parent) !== parent
    || (parentMetadata.mode & 0o077) !== 0 || (typeof process.getuid === "function" && parentMetadata.uid !== process.getuid())) {
    fail("Immich input directory must be one owner-only real directory");
  }
  const staging = await mkdtemp(join(parent, ".close-setup-"));
  const replacement = join(staging, "immich-input.json");
  try {
    const handle = await open(replacement, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(replacement, path);
    const directoryHandle = await open(parent, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await rm(staging, { recursive: true });
  }
  await readJsonFile(path, maximumInputBytes, true, "Immich input");
}

async function ensureDataDirectories(manifest: Record<string, any>): Promise<void> {
  const projectDirectory = manifest.project.directory as string;
  const data = join(projectDirectory, "data");
  const expected = [join(data, "database"), join(data, "model-cache"), join(data, "uploads")];
  const mounted = manifest.services.flatMap((service: Record<string, any>) => service.mounts.map((mount: Record<string, any>) => mount.source));
  if (JSON.stringify([...mounted].sort()) !== JSON.stringify([...expected].sort())) {
    fail("Managed Immich data mounts changed from the approved project paths");
  }
  const rootless = isVerifiedRootless(manifest.project, dockerJson);
  for (const path of [data, ...expected]) {
    if (!existsSync(path)) {
      if (manifest.project.ownership !== "new") fail("Verified-existing Immich data directory is missing");
      await mkdir(path, { mode: 0o700 });
    }
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
      || (metadata.mode & 0o777) !== 0o700 || !validDataOwner(metadata.uid, metadata.gid, rootless)) {
      fail("Immich data directory must be an owner-only real directory (0700)");
    }
  }
}

function validDataOwner(uid: number, gid: number, rootless: boolean): boolean {
  if (typeof process.getuid !== "function") return true;
  if (uid === process.getuid()) return true;
  return rootless && uid !== 0 && gid !== 0;
}

function isVerifiedRootless(project: Record<string, any>, inspectDocker: typeof dockerJson): boolean {
  if (project.dockerContext !== "rootless") return false;
  const options = inspectDocker(["--context", project.dockerContext, "info", "--format", "{{json .SecurityOptions}}"],
    "Immich rootless daemon inspection");
  if (!Array.isArray(options) || !options.some((option) => typeof option === "string" && option.includes("rootless"))) {
    fail("Immich rootless data ownership requires a verified rootless Docker daemon");
  }
  return true;
}

function immichOrigin(manifest: Record<string, any>): string {
  const server = manifest.services.find((service: Record<string, any>) => service.id === "immich-server");
  const port = server?.ports?.[0];
  if (!port || port.protocol !== "tcp" || port.target !== 2283) fail("Immich server port is unavailable");
  let host = port.hostIp;
  if (host.includes(":")) host = `[${host}]`;
  return `http://${host}:${port.published}`;
}

function dockerJson(args: string[], label: string): unknown {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) fail(`${label} failed; child output was suppressed`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${label} returned invalid JSON`);
  }
}

function exactStringSet(actual: unknown[], expected: string[], label: string): void {
  const values = actual.filter((value): value is string => typeof value === "string").sort();
  if (values.length !== actual.length || JSON.stringify(values) !== JSON.stringify([...expected].sort())) {
    fail(`${label} does not match the exact approved Immich project`);
  }
}

function validateClosureServices(manifest: Record<string, any>, services: ComposeStatus[]): void {
  const expectedServices = manifest.services.map((service: Record<string, any>) => service.id) as string[];
  exactStringSet(services.map((service) => service.service), expectedServices, "Live Compose services");
  if (services.some((service) => !service.id || service.state !== "running" || service.health !== "healthy")) {
    fail("Immich setup closure needs all four exact Compose services running and healthy");
  }
}

async function inspectClosureEvidence(manifest: Record<string, any>, services: ComposeStatus[], inspectDocker = dockerJson): Promise<ClosureEvidence> {
  const project = manifest.project as Record<string, any>;
  if (project.owner !== project.id || project.ownership !== "new") {
    fail("Immich setup closure supports only the exact CLI-created project owner");
  }
  const projectMetadata = await lstat(project.directory);
  if (!projectMetadata.isDirectory() || projectMetadata.isSymbolicLink() || await realpath(project.directory) !== project.directory
    || (projectMetadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && projectMetadata.uid !== process.getuid())) {
    fail("Immich Compose project directory is not an owner-only current-user-owned real directory");
  }
  const expectedServices = manifest.services.map((service: Record<string, any>) => service.id) as string[];
  validateClosureServices(manifest, services);
  const containerIds = services.map((service) => service.id as string);
  const rawContainers = inspectDocker(["--context", project.dockerContext, "inspect", ...containerIds], "Exact Immich container inspection");
  if (!Array.isArray(rawContainers) || rawContainers.length !== expectedServices.length) {
    fail("Exact Immich container inspection returned an unexpected result");
  }
  const containers = new Map<string, Record<string, any>>();
  const inspectedIds = new Set<string>();
  for (const candidate of rawContainers) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("Exact Immich container inspection is invalid");
    const record = candidate as Record<string, any>;
    const labels = record.Config?.Labels;
    const service = labels?.["com.docker.compose.service"];
    const matches = containerIds.filter((id) => typeof record.Id === "string" && record.Id.startsWith(id));
    if (typeof record.Id !== "string" || !/^[0-9a-f]{64}$/.test(record.Id) || matches.length !== 1 || inspectedIds.has(record.Id)
      || labels?.["com.docker.compose.project"] !== project.id || typeof service !== "string"
      || !expectedServices.includes(service) || containers.has(service)) {
      fail("Live containers are not owned by the exact Immich Compose project");
    }
    inspectedIds.add(record.Id);
    containers.set(service, record);
  }
  exactStringSet([...containers.keys()], expectedServices, "Inspected Compose services");

  const networkNames = new Map<string, string>();
  for (const network of manifest.networks as Array<Record<string, any>>) networkNames.set(network.id, network.name);
  for (const desired of manifest.services as Array<Record<string, any>>) {
    const container = containers.get(desired.id);
    if (!container) fail("Live Immich service inspection is incomplete");
    let mounts: Array<Record<string, any>> = [];
    if (Array.isArray(container.Mounts)) mounts = container.Mounts;
    for (const mount of desired.mounts as Array<Record<string, any>>) {
      const actual = mounts.find((entry: Record<string, any>) => entry?.Destination === mount.target);
      if (!actual || actual.Source !== mount.source || actual.RW !== !mount.readOnly) {
        fail("Live Immich mount paths do not match the exact approved Compose project");
      }
    }
    const expectedNetworks = desired.networks.map((id: string) => networkNames.get(id));
    if (expectedNetworks.some((name: string | undefined) => !name)) fail("Immich manifest network mapping is incomplete");
    exactStringSet(Object.keys(container.NetworkSettings?.Networks ?? {}), expectedNetworks as string[], "Live container networks");
  }

  const server = manifest.services.find((service: Record<string, any>) => service.id === "immich-server");
  const port = server?.ports?.[0];
  const serverContainer = containers.get("immich-server");
  const bindings = serverContainer?.NetworkSettings?.Ports?.[`${port?.target}/tcp`];
  if (!port || !Array.isArray(bindings) || bindings.length !== 1
    || bindings[0]?.HostIp !== port.hostIp || bindings[0]?.HostPort !== String(port.published)) {
    fail("Live Immich port binding does not match the exact approved Compose project");
  }

  const rawNetworks = inspectDocker(["--context", project.dockerContext, "network", "inspect", ...[...networkNames.values()]],
    "Exact Immich network inspection");
  if (!Array.isArray(rawNetworks) || rawNetworks.length !== networkNames.size) fail("Exact Immich network inspection is incomplete");
  const networks = new Map<string, Record<string, any>>();
  for (const candidate of rawNetworks) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || typeof candidate.Name !== "string") {
      fail("Exact Immich network inspection is invalid");
    }
    networks.set(candidate.Name, candidate as Record<string, any>);
  }
  exactStringSet([...networks.keys()], [...networkNames.values()], "Live Docker networks");
  for (const desired of manifest.networks as Array<Record<string, any>>) {
    const actual = networks.get(desired.name);
    if (!actual || actual.Driver !== "bridge" || actual.Internal !== desired.internal) {
      fail("Live Immich network configuration does not match the approved manifest");
    }
    if (desired.owner === project.owner && actual.Labels?.["com.docker.compose.project"] !== project.id) {
      fail("Live Immich private network is not owned by the exact Compose project");
    }
  }

  const rootless = isVerifiedRootless(project, inspectDocker);
  const paths: Array<{ path: string; owner: string }> = [];
  const seenPaths = new Set<string>();
  for (const desired of manifest.services as Array<Record<string, any>>) {
    for (const mount of desired.mounts as Array<Record<string, any>>) {
      if (seenPaths.has(mount.source)) continue;
      const metadata = await lstat(mount.source);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(mount.source) !== mount.source
        || (metadata.mode & 0o777) !== 0o700 || !validDataOwner(metadata.uid, metadata.gid, rootless)) {
        fail("Immich data paths must remain owner-only real directories (0700)");
      }
      paths.push({ path: mount.source, owner: project.owner });
      seenPaths.add(mount.source);
    }
  }
  paths.sort((left, right) => left.path.localeCompare(right.path));
  const observedNetworks = (manifest.networks as Array<Record<string, any>>)
    .map((network) => ({ name: network.name, owner: network.owner }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    checkedAt: new Date().toISOString(),
    project: { id: project.id, directory: project.directory, owner: project.owner },
    port: { hostIp: port.hostIp, published: port.published, protocol: "tcp", owner: project.owner },
    paths,
    networks: observedNetworks,
  };
}

function validateClosureEvidence(manifest: Record<string, any>, evidence: ClosureEvidence): void {
  const project = manifest.project as Record<string, any>;
  const expectedProject = { id: project.id, directory: project.directory, owner: project.owner };
  if (canonical(evidence.project) !== canonical(expectedProject)) fail("Immich closure project evidence does not match the exact project");
  const server = manifest.services.find((service: Record<string, any>) => service.id === "immich-server");
  const port = server?.ports?.[0];
  const expectedPort = { hostIp: port?.hostIp, published: port?.published, protocol: "tcp", owner: project.owner };
  if (canonical(evidence.port) !== canonical(expectedPort)) fail("Immich closure port evidence does not match the exact project");
  const expectedPaths = [...new Set(manifest.services.flatMap((service: Record<string, any>) =>
    service.mounts.map((mount: Record<string, any>) => mount.source)))]
    .sort()
    .map((path) => ({ path, owner: project.owner }));
  const actualPaths = [...evidence.paths].sort((left, right) => left.path.localeCompare(right.path));
  if (canonical(actualPaths) !== canonical(expectedPaths)) fail("Immich closure path evidence does not match the exact project");
  const expectedNetworks = manifest.networks.map((network: Record<string, any>) => ({ name: network.name, owner: network.owner }))
    .sort((left: Record<string, string>, right: Record<string, string>) => left.name.localeCompare(right.name));
  const actualNetworks = [...evidence.networks].sort((left, right) => left.name.localeCompare(right.name));
  if (canonical(actualNetworks) !== canonical(expectedNetworks)) fail("Immich closure network evidence does not match the exact project");
  const checkedAt = Date.parse(evidence.checkedAt);
  const age = Date.now() - checkedAt;
  if (!Number.isFinite(checkedAt) || age < -60_000 || age > 60_000) fail("Immich closure evidence must be current");
}

function write(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function planOutput(plan: Awaited<ReturnType<typeof preparePlan>>, runId: string) {
  return {
    schemaVersion: 1,
    kind: "immich-v3.2.2-cli-plan",
    status: "pass",
    mutation: false,
    release: "v3.2.2",
    runId,
    account: plan.account,
    compose: plan.composePlan,
    approvalDigest: plan.approvalDigest,
    approvals: { apply: plan.applyApproval, bootstrap: plan.bootstrapApproval, closeSetup: plan.closeSetupApproval },
    execution: { performed: false, verified: false },
    limitations: ["Compose apply, account bootstrap, and post-bootstrap setup closure are separate approvals.",
      "Status verifies only exact-project runtime state and Immich initialization, not full application acceptance."],
  };
}

function parseComposeStatus(output: string) {
  const trimmed = output.trim();
  if (trimmed === "") return [];
  let records: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) records = parsed;
    else records = [parsed];
  } catch {
    records = trimmed.split("\n").map((line) => JSON.parse(line));
  }
  return records.map((record) => {
    let id: string | null = null;
    if (typeof record.ID === "string" && /^[0-9a-f]{12,64}$/.test(record.ID)) id = record.ID;
    return { id, service: record.Service, state: record.State, health: record.Health ?? null };
  });
}

function composeStatus(manifest: Record<string, any>, target: string) {
  const docker = spawnSync("docker", [
    "--context", manifest.project.dockerContext,
    "compose", "--project-name", manifest.project.id,
    "--file", target,
    "ps", "--format", "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 });
  if (docker.status !== 0) fail("Could not inspect the exact Immich Compose project");
  return parseComposeStatus(docker.stdout);
}

function closedInput(raw: unknown, evidence: ClosureEvidence): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Immich input is invalid");
  const input = structuredClone(raw) as Record<string, any>;
  if (input.allowSetup !== true) fail("Immich setup is already closed in this input");
  input.allowSetup = false;
  input.project.ownership = "verified-existing";
  input.network.ownership = "verified-existing";
  input.storage.uploads.ownership = "verified-existing";
  input.storage.modelCache.ownership = "verified-existing";
  input.storage.database.ownership = "verified-existing";
  input.observed = {
    checkedAt: evidence.checkedAt,
    project: evidence.project,
    ports: [evidence.port],
    paths: evidence.paths,
    networks: evidence.networks,
  };
  return input;
}

export async function immichCommand(args: string[], runtime: ImmichRuntime = {}): Promise<void> {
  const options = parse(args);
  const plan = await preparePlan(options);
  if (options.action === "plan") {
    write(planOutput(plan, options.runId));
    return;
  }
  if (options.action === "up" || options.action === "down" || options.action === "lifecycle-check") {
    if (plan.manifest.project.ownership !== "verified-existing") {
      fail("Immich lifecycle needs the closed verified-existing project input from the applied setup");
    }
    const target = plan.composePlan.render.target;
    if (!existsSync(target)) fail("The exact applied Immich Compose file is missing");
    if (options.action === "lifecycle-check") {
      if (runtime.preflight) await runtime.preflight(plan);
      else await plan.composeOwner.preflight(plan.composePlan);
    } else if (options.action === "up") {
      if (runtime.composeApply) await runtime.composeApply();
      else await plan.composeOwner.apply(plan.composePlan);
    } else {
      if (runtime.composeStop) await runtime.composeStop();
      else await plan.composeOwner.stop(plan.composePlan);
    }
    write({ schemaVersion: 1, kind: "immich-bundle-lifecycle", action: options.action,
      project: plan.manifest.project.id, composeFile: target, volumesDeleted: false, accepted: false });
    return;
  }
  if (options.action === "close-setup") {
    if (!plan.closeSetupApproval || options.approval !== plan.closeSetupApproval) {
      fail("Immich setup closure approval does not match this exact setup-enabled plan");
    }
    if (!plan.account) fail("Immich account plan is unavailable");
    const target = plan.composePlan.render.target;
    if (!existsSync(target)) fail("The exact approved Immich Compose project has not been rendered");
    if (runtime.preflight) await runtime.preflight(plan);
    else await plan.composeOwner.preflight(plan.composePlan);
    let services: ComposeStatus[];
    if (runtime.composeStatus) services = runtime.composeStatus(plan.manifest, target);
    else services = composeStatus(plan.manifest, target);
    validateClosureServices(plan.manifest, services);
    const credential = existingCredential(plan.root, options.runId, plan.account);
    const origin = immichOrigin(plan.manifest);
    let initialized: boolean | null;
    if (runtime.inspectInitialization) initialized = await runtime.inspectInitialization(origin);
    else initialized = await inspectInitialization(origin);
    if (initialized !== true) fail("Immich setup closure needs a live initialized server; the input was not changed");
    let loginVerified: boolean;
    if (runtime.verifyLogin) loginVerified = await runtime.verifyLogin(origin, plan.account.email, credential.password);
    else loginVerified = await verifyLogin(origin, plan.account.email, credential.password);
    if (!loginVerified) fail("Immich setup closure needs the existing managed owner login; the input was not changed");
    let inspectDocker = dockerJson;
    if (runtime.dockerJson) inspectDocker = runtime.dockerJson;
    const evidence = await inspectClosureEvidence(plan.manifest, services, inspectDocker);
    validateClosureEvidence(plan.manifest, evidence);
    const raw = await readJsonFile(options.input, maximumInputBytes, true, "Immich input");
    const revision = closedInput(raw, evidence);
    const revisedManifest = buildImmichManifest(revision) as Record<string, any>;
    const revisedOwner = createSelfhostComposeOwner(revisedManifest);
    await revisedOwner.plan();
    await replacePrivateInput(plan.root, options.input, revision);
    const nextPlan = await preparePlan({ ...options, action: "plan", approval: "" });
    write({
      schemaVersion: 1,
      kind: "immich-v3.2.2-setup-closure",
      status: "ready-for-apply-approval",
      mutation: "owner-only-immich-input",
      dockerMutation: false,
      project: plan.manifest.project.id,
      input: options.input,
      previousPlanId: plan.composePlan.planId,
      verifiedEvidence: {
        exactComposeOwner: true,
        servicesRunningHealthy: services.length,
        initialized: true,
        managedOwnerLogin: true,
        paths: evidence.paths.length,
        networks: evidence.networks.length,
        portBinding: true,
      },
      revised: { allowSetup: false, ownership: "verified-existing", checkedAt: evidence.checkedAt },
      plan: planOutput(nextPlan, options.runId),
      next: {
        inspect: ["self-host", "immich", "plan", "--project-root", plan.root, "--input", options.input,
          "--run-id", options.runId, "--account-file", options.accountFile],
        apply: ["self-host", "immich", "apply", "--project-root", plan.root, "--input", options.input,
          "--run-id", options.runId, "--account-file", options.accountFile, "--approve", nextPlan.applyApproval],
      },
      limitations: ["No Compose or Docker mutation was performed.", "The revised apply still needs its new exact approval.",
        "Full Immich, Homarr, and recovery acceptance remain pending."],
    });
    return;
  }
  if (options.action === "apply") {
    if (options.approval !== plan.applyApproval) fail("Immich apply approval does not match this exact plan");
    if (!plan.account) fail("Immich account plan is unavailable");
    const handoff = await ensureCredential(plan.root, options.runId, plan.account);
    const target = plan.composePlan.render.target;
    await plan.composeOwner.render(plan.composePlan);
    await ensureDataDirectories(plan.manifest);
    const secret = materializeHouseholdCredential({
      projectRoot: plan.root,
      runId: options.runId,
      service: "immich",
      field: "databasePassword",
      projectDirectory: plan.manifest.project.directory,
    });
    const expectedSecret = join(plan.manifest.project.directory, "secrets", "immich-database-password");
    if (secret.path !== expectedSecret) fail("Managed Immich database secret path changed");
    await plan.composeOwner.apply(plan.composePlan);
    let next = "Run immich status; this plan keeps first-admin setup disabled.";
    if (plan.bootstrapApproval) next = "Run the separately approved Immich bootstrap after the server is ready.";
    write({
      schemaVersion: 1,
      status: "applied",
      project: plan.manifest.project.id,
      planId: plan.composePlan.planId,
      composeFile: target,
      privateCredentialHandoff: handoff.path,
      verified: false,
      next,
    });
    return;
  }
  if (options.action === "bootstrap") {
    if (!plan.bootstrapApproval || options.approval !== plan.bootstrapApproval) fail("Immich bootstrap approval does not match this exact setup-enabled plan");
    if (!plan.account) fail("Immich account plan is unavailable");
    const target = plan.composePlan.render.target;
    if (!existsSync(target)) fail("The exact approved Immich Compose project has not been rendered");
    await plan.composeOwner.preflight(plan.composePlan);
    const services = composeStatus(plan.manifest, target);
    const server = services.find((service) => service.service === "immich-server");
    if (!server || server.state !== "running") fail("The exact approved Immich server is not running");
    const handoff = await ensureCredential(plan.root, options.runId, plan.account);
    const origin = immichOrigin(plan.manifest);
    const outcome = await bootstrapImmichAdmin({ origin, email: plan.account.email,
      name: plan.account.name, password: handoff.credential.password });
    if (outcome.status === "browser-fallback-required") {
      write({ status: outcome.status, origin, reason: outcome.reason, verified: false });
      process.exitCode = 3;
      return;
    }
    write({ status: outcome.status, origin, loginVerified: true, verified: false,
      setupClosure: ["self-host", "immich", "close-setup", "--project-root", plan.root, "--input", options.input,
        "--run-id", options.runId, "--account-file", options.accountFile, "--approve", plan.closeSetupApproval],
      next: "Run the separately approved setup-closure operation; full application acceptance remains pending." });
    return;
  }
  const target = plan.composePlan.render.target;
  if (!existsSync(target)) {
    write({ status: "planned", project: plan.manifest.project.id, planId: plan.composePlan.planId, composeFile: target, dockerChecked: false, initialized: null, accepted: false });
    return;
  }
  await plan.composeOwner.preflight(plan.composePlan);
  const services = composeStatus(plan.manifest, target);
  const initialized = await inspectInitialization(immichOrigin(plan.manifest));
  const setupEnabled = plan.bootstrapApproval !== null;
  let next = "Complete owner-specific Immich and Homarr acceptance.";
  if (initialized === true && setupEnabled) next = "Inspect and approve a new manifest with allowSetup false before continuing acceptance.";
  write({
    status: "observed",
    project: plan.manifest.project.id,
    planId: plan.composePlan.planId,
    composeFile: target,
    services: services.map((service) => ({ service: service.service, state: service.state, health: service.health })),
    initialized,
    setupEnabled,
    accepted: false,
    next,
  });
}
