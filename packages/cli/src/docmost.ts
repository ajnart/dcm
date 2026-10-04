import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, existsSync, lstatSync, readFileSync, type Stats } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createSelfhostComposeOwner } from "./lib/selfhost-compose.ts";
import { docmostBrowserPassword } from "./docmost-browser.ts";
import { parsePrivateNetworkSubnet } from "./private-network-subnet.ts";
import { docmostDbExportCommand, type DocmostDbExportOptions, type DocmostDbExportOwner, type DocmostDbExportRuntime } from "./lib/docmost-db-export.ts";

type Json = Record<string, any>;
type Action = "plan" | "recover-plan" | "recover-postgres-parent-plan" | "recover-postgres-parent-apply"
  | "repair-pgdata-plan" | "repair-pgdata-apply" | "owner-plan" | "owner-apply" | "owner-status"
  | "accept-plan" | "accept-apply" | "accept-status" | "accept-verify"
  | "apply" | "status" | "up" | "down" | "lifecycle-check";
type Options = { action: Action; projectRoot: string; input: string; runId: string; accountFile: string; approval: string };
type OwnerFetch = (url: string, init: RequestInit) => Promise<Response>;
type DocmostRuntime = {
  pgdataMetadata?: (path: string) => Promise<Stats>;
  rootlessDirectoryMetadata?: (path: string) => Promise<Stats>;
  health?: (origin: string) => Promise<boolean>;
  healthAfterApply?: (origin: string) => Promise<boolean>;
  composeApply?: () => Promise<void>;
  composePreflight?: () => Promise<void>;
  composeStop?: () => Promise<void>;
  ownerFetch?: OwnerFetch;
  dbExport?: DocmostDbExportRuntime;
};
type Account = { schemaVersion: 1; username: string; email: string; name: string };
type Handoff = {
  schemaVersion: 1;
  kind: "docmost-private-handoff";
  runId: string;
  projectId: string;
  account: Account;
  url: string;
  password: string;
  appSecret: string;
  databasePassword: string;
  status: "first-owner-browser-required";
};
type Checkpoint = {
  schemaVersion: 1;
  project: string;
  runId: string;
  approvalDigest: string;
  composeFile: string;
  handoffPath: string;
  health: boolean;
  ownerSetup: "browser-evidence-required";
};
type OwnerCheckpoint = {
  schemaVersion: 1;
  kind: "docmost-v0.96.0-owner-checkpoint";
  project: string;
  runId: string;
  origin: string;
  composeApprovalDigest: string;
  composeFile: string;
  accountDigest: string;
  credentialDigest: string;
  approvalDigest: string;
  result: "setup-created" | "existing-owner-login";
  workspace: { id: string; name: string; defaultSpaceId: string } | null;
  freshLogin: true;
  recordedAt: string;
};

const MAX_INPUT = 256 * 1024;
const MAX_PRIVATE = 16 * 1024;
const MAX_DOCKER_OUTPUT = 64 * 1024;
const MAX_OWNER_RESPONSE = 64 * 1024;
const OWNER_REQUEST_TIMEOUT_MS = 5_000;
const RUN_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const NETWORK = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/;
const HEX_SECRET = /^[0-9a-f]{64}$/;
const ROOTLESS_USER_EVIDENCE = {
  officialUrl: "https://docs.docker.com/engine/security/rootless/",
  reason: "host-user-mapped-container-root",
};
const START_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_SECRET="$(< /run/secrets/docmost_app_secret)"
DB_SECRET="$(< /run/secrets/docmost_db_password)"
if [[ ! "$APP_SECRET" =~ ^[0-9a-f]{64}$ || ! "$DB_SECRET" =~ ^[0-9a-f]{64}$ ]]; then
  printf 'Docmost secret file is invalid\\n' >&2
  exit 1
fi
export APP_SECRET
export DATABASE_URL="postgresql://docmost:"
DATABASE_URL+="$DB_SECRET"
DATABASE_URL+="@database:5432/docmost"
unset DB_SECRET
cd /app
exec "$@"
`;
const POSTGRES_START_SCRIPT_V1 = `#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$(id -u)" != "0" ]]; then
  printf 'PostgreSQL rootless parent setup requires container UID 0\n' >&2
  exit 1
fi
if [[ ! -d /var/lib/postgresql || -L /var/lib/postgresql ]]; then
  printf 'PostgreSQL parent must be the expected real directory\n' >&2
  exit 1
fi
chown postgres:postgres /var/lib/postgresql
chmod 0700 /var/lib/postgresql
exec /usr/local/bin/docker-entrypoint.sh "$@"
`;
const POSTGRES_START_SCRIPT_V2 = `#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$(id -u)" != "0" ]]; then
  printf 'PostgreSQL rootless parent setup requires container UID 0\\n' >&2
  exit 1
fi
if [[ ! -d /var/lib/postgresql || -L /var/lib/postgresql ]]; then
  printf 'PostgreSQL parent must be the expected real directory\\n' >&2
  exit 1
fi
DB_SECRET="$(< /run/secrets/docmost_db_password)"
if [[ ! "$DB_SECRET" =~ ^[0-9a-f]{64}$ ]]; then
  printf 'PostgreSQL secret file is invalid\\n' >&2
  exit 1
fi
POSTGRES_PASSWORD=$DB_SECRET
export POSTGRES_PASSWORD
unset DB_SECRET
unset POSTGRES_PASSWORD_FILE
POSTGRES_UID="$(id -u postgres)"
POSTGRES_GID="$(id -g postgres)"
if [[ "$(stat -c %u /var/lib/postgresql)" != "$POSTGRES_UID" || "$(stat -c %g /var/lib/postgresql)" != "$POSTGRES_GID" ]]; then
  chown postgres:postgres /var/lib/postgresql
fi
if [[ "$(stat -c %a /var/lib/postgresql)" != "700" ]]; then
  chmod 0700 /var/lib/postgresql
fi
exec gosu postgres /usr/local/bin/docker-entrypoint.sh "$@"
`;

function selectPostgresStartContent(path: string): string {
  if (!existsSync(path)) return POSTGRES_START_SCRIPT_V2;
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 1 || metadata.size > MAX_PRIVATE || (metadata.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    fail("Existing Docmost PostgreSQL wrapper is not one owner-only regular file");
  }
  const content = readFileSync(path, "utf8");
  if (content !== POSTGRES_START_SCRIPT_V1 && content !== POSTGRES_START_SCRIPT_V2) {
    fail("Existing Docmost PostgreSQL wrapper is not a supported exact version");
  }
  return content;
}

function fail(message: string): never { throw new Error(message); }

function object(value: unknown, name: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Json;
}

function exact(value: Json, fields: string[], name: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    fail(`${name} contains missing or unsupported fields`);
  }
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  if (path === "") return true;
  if (path === ".." || path.startsWith(`..${sep}`)) return false;
  return !isAbsolute(path);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parse(args: string[]): Options {
  let action = args[0] as Action;
  let optionStart = 1;
  if (args[0] === "accept") {
    if (args[1] === "plan") action = "accept-plan";
    else if (args[1] === "apply") action = "accept-apply";
    else if (args[1] === "status") action = "accept-status";
    else if (args[1] === "verify") action = "accept-verify";
    else fail("Use docmost accept plan, accept apply, accept status, or accept verify");
    optionStart = 2;
  }
  if (args[0] === "owner") {
    if (args[1] === "plan") action = "owner-plan";
    else if (args[1] === "apply") action = "owner-apply";
    else if (args[1] === "status") action = "owner-status";
    else fail("Use docmost owner plan, owner apply, or owner status");
    optionStart = 2;
  }
  if (args[0] === "repair-pgdata") {
    if (args[1] === "plan") action = "repair-pgdata-plan";
    else if (args[1] === "apply") action = "repair-pgdata-apply";
    else fail("Use docmost repair-pgdata plan or repair-pgdata apply");
    optionStart = 2;
  }
  if (args[0] === "recover-postgres-parent") {
    if (args[1] === "plan") action = "recover-postgres-parent-plan";
    else if (args[1] === "apply") action = "recover-postgres-parent-apply";
    else fail("Use docmost recover-postgres-parent plan or recover-postgres-parent apply");
    optionStart = 2;
  }
  if (action !== "plan" && action !== "recover-plan" && action !== "repair-pgdata-plan"
    && action !== "repair-pgdata-apply" && action !== "recover-postgres-parent-plan"
    && action !== "recover-postgres-parent-apply" && action !== "owner-plan" && action !== "owner-apply"
    && action !== "owner-status" && action !== "accept-plan" && action !== "accept-apply" && action !== "accept-status"
    && action !== "accept-verify" && action !== "apply" && action !== "status"
    && action !== "up" && action !== "down" && action !== "lifecycle-check") {
    fail("Use docmost plan, recover-plan, recover-postgres-parent plan|apply, repair-pgdata plan|apply, owner plan|apply|status, apply, status, up, or down");
  }
  const allowed = new Set(["--project-root", "--input", "--run-id", "--account-file", "--approve"]);
  const flags: Record<string, string> = {};
  for (let index = optionStart; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key) || flags[key] || !value || value.startsWith("--")) fail(`Invalid or repeated Docmost option: ${key ?? "(missing)"}`);
    flags[key] = value;
  }
  if (!flags["--project-root"] || !flags["--input"] || !flags["--run-id"]) {
    fail("Docmost commands need --project-root, --input, and --run-id");
  }
  if (!["status", "owner-status", "accept-status", "up", "down", "lifecycle-check"].includes(action) && !flags["--account-file"]) fail(`docmost ${action} needs --account-file`);
  const approvalRequired = action === "apply" || action === "repair-pgdata-apply"
    || action === "recover-postgres-parent-apply" || action === "owner-apply" || action === "accept-apply";
  if (approvalRequired && !flags["--approve"]) fail(`docmost ${action} needs the exact --approve token from plan`);
  if (!approvalRequired && flags["--approve"]) fail(`docmost ${action} does not accept --approve`);
  if (["status", "owner-status", "accept-status", "up", "down", "lifecycle-check"].includes(action) && flags["--account-file"]) fail(`docmost ${action} does not need --account-file`);
  if (!RUN_ID.test(flags["--run-id"])) fail("Docmost run ID is invalid");
  return {
    action,
    projectRoot: flags["--project-root"],
    input: flags["--input"],
    runId: flags["--run-id"],
    accountFile: flags["--account-file"] ?? "",
    approval: flags["--approve"] ?? "",
  };
}

async function ownedDirectory(path: string, name: string, privateMode: boolean): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) fail(`${name} must be a real directory`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
  const mode = metadata.mode & 0o777;
  if (privateMode && mode !== 0o700) fail(`${name} must use mode 0700`);
  if (!privateMode && (mode & 0o002) !== 0) fail(`${name} must not be world-writable`);
}

async function projectRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path || path === sep || path === resolve(homedir())) {
    fail("--project-root must be one exact absolute project path, not root or home");
  }
  await ownedDirectory(path, "project root", false);
  return path;
}

async function readJson(path: string, maximum: number, privateMode: boolean, name: string): Promise<unknown> {
  if (!isAbsolute(path) || resolve(path) !== path) fail(`${name} must be an exact absolute path`);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path
    || metadata.size < 2 || metadata.size > maximum) fail(`${name} must be one bounded regular file without links`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
  if (privateMode && (metadata.mode & 0o777) !== 0o600) fail(`${name} must use mode 0600`);
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { fail(`${name} is not valid JSON`); }
}

async function readAccount(root: string, path: string): Promise<Account> {
  if (!inside(root, path)) fail("--account-file must stay inside the selected project root");
  const account = object(await readJson(path, MAX_PRIVATE, true, "account file"), "account file");
  exact(account, ["schemaVersion", "username", "email", "name"], "account file");
  if (account.schemaVersion !== 1 || typeof account.username !== "string" || !USERNAME.test(account.username)
    || typeof account.email !== "string" || account.email.length > 254 || account.email.trim() !== account.email
    || !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(account.email)
    || typeof account.name !== "string" || account.name.length < 1 || account.name.length > 128
    || account.name.trim() !== account.name || /[\u0000-\u001f\u007f]/.test(account.name)) {
    fail("account file needs a selected username, valid email, and display name");
  }
  return account as Account;
}

function privateHost(hostIp: unknown): string {
  if (typeof hostIp !== "string" || isIP(hostIp) === 0) fail("Docmost hostIp must be a literal private address");
  if (hostIp === "127.0.0.1" || hostIp === "::1") return hostIp;
  if (isIP(hostIp) === 4) {
    const octets = hostIp.split(".").map(Number);
    if (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)) return hostIp;
  }
  if (isIP(hostIp) === 6 && /^(fc|fd)/i.test(hostIp)) return hostIp;
  fail("Docmost requires a private host bind; public ingress is a separate plan");
}

function image(value: unknown, reference: RegExp, name: string): string {
  if (typeof value !== "string" || !reference.test(value)) {
    fail(`${name} must use its reviewed version tag and an immutable sha256 digest`);
  }
  return value;
}

function mount(source: string, target: string, owner: string, ownership: string, readOnly = false) {
  return { source, target, readOnly, shared: readOnly, owner, ownership };
}

function buildManifest(raw: unknown, root: string) {
  const input = object(raw, "Docmost input");
  const fields = ["schemaVersion", "project", "observed", "images", "hostIp", "publishedPort"];
  if (Object.hasOwn(input, "integrationNetwork")) fields.push("integrationNetwork");
  if (Object.hasOwn(input, "networkSubnet")) fields.push("networkSubnet");
  exact(input, fields, "Docmost input");
  if (input.schemaVersion !== 1) fail("Docmost input schemaVersion must be 1");
  const project = object(input.project, "project");
  exact(project, ["dockerContext", "id", "owner", "root", "directory", "ownership"], "project");
  if (project.root !== root || project.directory !== join(root, project.id)) fail("Docmost project must own one exact directory below --project-root");
  if (project.ownership !== "new" && project.ownership !== "verified-existing") fail("Docmost project ownership is invalid");
  const images = object(input.images, "images");
  exact(images, ["docmost", "postgres", "redis"], "images");
  const appImage = image(images.docmost, /^docker\.io\/docmost\/docmost:0\.96\.0@sha256:[0-9a-f]{64}$/, "Docmost image");
  const dbImage = image(images.postgres, /^docker\.io\/library\/postgres:18(?:\.[0-9]+)?@sha256:[0-9a-f]{64}$/, "Postgres image");
  const redisImage = image(images.redis, /^docker\.io\/library\/redis:8(?:\.[0-9]+){0,2}@sha256:[0-9a-f]{64}$/, "Redis image");
  const hostIp = privateHost(input.hostIp);
  if (!Number.isInteger(input.publishedPort) || input.publishedPort < 1024 || input.publishedPort > 65535) fail("Docmost publishedPort must be 1024-65535");
  let host = hostIp;
  if (hostIp.includes(":")) host = `[${hostIp}]`;
  const origin = `http://${host}:${input.publishedPort}`;
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid === 0 || gid === 0) {
    fail("Docmost requires a non-root host UID and GID to read owner-only secrets");
  }
  const owner = project.owner as string;
  const ownership = project.ownership as string;
  let networkSubnet: string | undefined;
  if (Object.hasOwn(input, "networkSubnet")) {
    networkSubnet = parsePrivateNetworkSubnet(input.networkSubnet);
  }
  const directory = project.directory as string;
  const user = `${uid}:${gid}`;
  const rootless = project.dockerContext === "rootless";
  const networkId = "private";
  let integrationNetwork: { id: string; name: string; owner: string; internal: boolean } | null = null;
  if (Object.hasOwn(input, "integrationNetwork")) {
    const selected = object(input.integrationNetwork, "Docmost integrationNetwork");
    const selectedFields = ["id", "name", "owner"];
    if (Object.hasOwn(selected, "internal")) selectedFields.push("internal");
    exact(selected, selectedFields, "Docmost integrationNetwork");
    if (typeof selected.id !== "string" || !NETWORK.test(selected.id) || selected.id === networkId
      || typeof selected.name !== "string" || !NETWORK.test(selected.name)
      || selected.name === `${project.id}-private`
      || typeof selected.owner !== "string" || !NETWORK.test(selected.owner)
      || (selected.internal !== undefined && typeof selected.internal !== "boolean")) {
      fail("Docmost integrationNetwork must be a distinct, bounded existing network");
    }
    integrationNetwork = { id: selected.id, name: selected.name, owner: selected.owner, internal: selected.internal ?? false };
  }
  const secrets = join(directory, "secrets");
  const appSecret = join(secrets, "docmost-app-secret");
  const databasePassword = join(secrets, "docmost-database-password");
  const startScript = join(directory, "docmost-start.sh");
  const postgresStartScript = join(directory, "postgres-rootless-start.sh");
  const postgresStartContent = rootless ? selectPostgresStartContent(postgresStartScript) : POSTGRES_START_SCRIPT_V2;
  const storage = {
    attachments: join(directory, "data", "attachments"),
    database: join(directory, "data", "database"),
    redis: join(directory, "data", "redis"),
  };
  const base = (id: string, serviceImage: string) => {
    const service: Json = {
      id, image: serviceImage, restart: "unless-stopped", readOnly: false, user,
      environment: [] as { name: string; value: string }[], ports: [] as Json[], mounts: [] as Json[],
      networks: [networkId], secretRefs: [] as Json[],
    };
    if (rootless) {
      service.user = "0:0";
      service.rootlessUserEvidence = { ...ROOTLESS_USER_EVIDENCE };
    }
    return service;
  };
  const app = base("docmost", appImage);
  if (integrationNetwork) app.networks.push(integrationNetwork.id);
  app.environment = [
    { name: "APP_URL", value: origin },
    { name: "REDIS_URL", value: "redis://redis:6379" },
    { name: "HOME", value: "/tmp" },
  ];
  app.ports = [{ hostIp, published: input.publishedPort, target: 3000, protocol: "tcp", purpose: "application", publicApproved: false }];
  app.mounts = [
    mount(storage.attachments, "/app/data/storage", owner, ownership),
    mount(startScript, "/opt/selfhost/docmost-start.sh", owner, ownership, true),
  ];
  app.secretRefs = [
    { name: "docmost-app-secret", ref: "local/docmost/app-secret", target: "docmost_app_secret", filePath: appSecret },
    { name: "docmost-database-password", ref: "local/docmost/database-password", target: "docmost_db_password", filePath: databasePassword },
  ];
  const appService: Json = app;
  appService.entrypoint = ["/bin/bash", "/opt/selfhost/docmost-start.sh"];
  appService.command = ["pnpm", "start"];
  appService.healthcheck = { test: ["CMD", "curl", "--fail", "--silent", "http://127.0.0.1:3000/api/health"], intervalSeconds: 15, timeoutSeconds: 5, startPeriodSeconds: 60, retries: 5 };
  appService.dependsOn = [{ service: "database", condition: "service_healthy" }, { service: "redis", condition: "service_healthy" }];
  const database = base("database", dbImage);
  database.environment = [
    { name: "POSTGRES_DB", value: "docmost" },
    { name: "POSTGRES_USER", value: "docmost" },
    { name: "POSTGRES_PASSWORD_FILE", value: "/run/secrets/docmost_db_password" },
  ];
  database.mounts = [mount(storage.database, "/var/lib/postgresql", owner, ownership)];
  if (rootless) {
    let postgresScriptOwnership = "new";
    const observed = object(input.observed, "observed");
    if (Array.isArray(observed.paths)
      && observed.paths.some((entry: unknown) => object(entry, "observed path").path === postgresStartScript)) {
      postgresScriptOwnership = "verified-existing";
    }
    database.mounts.push(mount(postgresStartScript, "/opt/selfhost/postgres-rootless-start.sh",
      owner, postgresScriptOwnership, true));
    database.entrypoint = ["/bin/bash", "/opt/selfhost/postgres-rootless-start.sh"];
    database.command = ["postgres"];
  }
  database.secretRefs = [{ name: "docmost-database-password", ref: "local/docmost/database-password", target: "docmost_db_password", filePath: databasePassword }];
  const databaseService: Json = database;
  databaseService.healthcheck = { test: ["CMD", "pg_isready", "-U", "docmost", "-d", "docmost"], intervalSeconds: 10, timeoutSeconds: 5, startPeriodSeconds: 30, retries: 10 };
  const redis = base("redis", redisImage);
  redis.mounts = [mount(storage.redis, "/data", owner, ownership)];
  const redisService: Json = redis;
  redisService.command = ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"];
  redisService.healthcheck = { test: ["CMD", "redis-cli", "ping"], intervalSeconds: 10, timeoutSeconds: 5, startPeriodSeconds: 10, retries: 5 };
  const privateNetwork: Json = {
    id: networkId,
    name: `${project.id}-private`,
    driver: "bridge",
    internal: false,
    owner,
    ownership,
  };
  if (ownership === "new" && networkSubnet !== undefined) {
    privateNetwork.subnet = networkSubnet;
  }
  const networks = [privateNetwork];
  if (integrationNetwork) networks.push({ id: integrationNetwork.id, name: integrationNetwork.name,
    driver: "bridge", internal: integrationNetwork.internal, owner: integrationNetwork.owner, ownership: "verified-existing" });
  const manifest = {
    schemaVersion: 1,
    project,
    services: [appService, databaseService, redisService],
    networks,
    observed: input.observed,
  };
  return { manifest, origin, storage, appSecret, databasePassword, startScript, postgresStartScript,
    postgresStartContent, directory, rootless };
}

async function writePrivate(path: string, value: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(value); await handle.sync(); }
  finally { await handle.close(); }
}

async function ensureDirectory(path: string, name: string): Promise<void> {
  if (!existsSync(path)) await mkdir(path, { mode: 0o700 });
  await ownedDirectory(path, name, true);
}

async function ensureRootlessManagedDirectory(path: string, name: string,
  metadataReader: (path: string) => Promise<Stats> = lstat): Promise<void> {
  if (!existsSync(path)) await mkdir(path, { mode: 0o700 });
  const metadata = await metadataReader(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    fail(`${name} must be a real directory`);
  }
  if ((metadata.mode & 0o777) !== 0o700) fail(`${name} must use mode 0700`);
  if (metadata.uid === 0 || metadata.gid === 0) fail(`${name} must not be owned by host root`);
}

async function inspectDirectory(path: string, name: string, rootlessManaged = false): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    fail(`${name} must be a real directory`);
  }
  if ((metadata.mode & 0o777) !== 0o700) fail(`${name} must use mode 0700`);
  if (rootlessManaged) {
    if (metadata.uid === 0 || metadata.gid === 0) fail(`${name} must not be owned by host root`);
    return;
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
}

async function inspectPostgresDatabaseParent(path: string, rootlessWrapperProven: boolean,
  metadataReader: (path: string) => Promise<Stats> = lstat): Promise<Stats> {
  const metadata = await metadataReader(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    fail("Docmost database parent directory must be a real directory");
  }
  if ((metadata.mode & 0o777) !== 0o700) {
    fail("Docmost database parent directory must use mode 0700");
  }
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (!Number.isInteger(hostUid) || hostUid === 0 || !Number.isInteger(hostGid) || hostGid === 0) {
    fail("Docmost database parent recovery requires a non-root host identity");
  }
  if (metadata.uid === hostUid) return metadata;
  // The same rootless chown can appear as a host sub-ID or overflow ID from a nested user namespace.
  // The caller proves the exact wrapper/project first and binds this observed owner into its approval digest.
  const mappedWrapperOwner = metadata.uid !== 0 && metadata.uid !== hostUid
    && metadata.gid !== 0 && metadata.gid !== hostGid;
  if (!rootlessWrapperProven || !mappedWrapperOwner) {
    fail("Docmost database parent directory has an unverified owner");
  }
  return metadata;
}

async function inspectPrivateFile(path: string, name: string, maximum: number): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path
    || metadata.size < 1 || metadata.size > maximum || (metadata.mode & 0o777) !== 0o600) {
    fail(`${name} must be one bounded owner-only regular file without links`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
}

function docker(context: string, args: string[], name: string): string {
  const result = spawnSync("docker", ["--context", context, ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_DOCKER_OUTPUT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error || typeof result.stdout !== "string"
    || Buffer.byteLength(result.stdout) > MAX_DOCKER_OUTPUT) {
    fail(`${name} failed; Docker output was suppressed`);
  }
  return result.stdout.trimEnd();
}

function lines(value: string): string[] {
  if (!value) return [];
  return value.split("\n");
}

function imageAliases(reference: string): Set<string> {
  const withoutDigest = reference.split("@")[0];
  const aliases = new Set([reference, withoutDigest]);
  if (withoutDigest.startsWith("docker.io/library/")) {
    aliases.add(withoutDigest.slice("docker.io/library/".length));
    aliases.add(withoutDigest.slice("docker.io/".length));
  } else if (withoutDigest.startsWith("docker.io/")) {
    aliases.add(withoutDigest.slice("docker.io/".length));
  }
  return aliases;
}

function inspectRootlessComposeProject(prepared: ReturnType<typeof buildManifest>, composeFile: string,
  allowCreatedDocmost: boolean, composeFileByService: Map<string, string> = new Map()): { containers: Json[]; network: Json } {
  const project = prepared.manifest.project as Json;
  const projectId = project.id as string;
  const context = project.dockerContext as string;
  const securityOptions = docker(context, ["info", "--format", "{{json .SecurityOptions}}"], "Docmost rootless daemon inspection");
  if (!securityOptions.includes("rootless")) fail("Docmost inspection requires the selected context to report rootless security mode");

  const containerFormat = [
    "{{.ID}}",
    "{{.Names}}",
    "{{.Image}}",
    "{{.State}}",
    '{{.Label "com.docker.compose.project"}}',
    '{{.Label "com.docker.compose.service"}}',
    '{{.Label "com.docker.compose.project.config_files"}}',
    '{{.Label "com.docker.compose.project.working_dir"}}',
    '{{.Label "com.docker.compose.oneoff"}}',
  ].join("\t");
  const containerOutput = docker(context, [
    "container", "ls", "--all",
    "--no-trunc",
    "--filter", `label=com.docker.compose.project=${projectId}`,
    "--format", containerFormat,
  ], "Docmost Compose container inspection");
  const containers = lines(containerOutput).map((line) => line.split("\t"));
  if (containers.length !== 3 || containers.some((fields) => fields.length !== 9)) {
    fail("Docmost inspection requires exactly three bounded Compose-labeled containers");
  }
  const byService = new Map<string, string>();
  const stateByService = new Map<string, string>();
  const inspectedContainers: Json[] = [];
  const imageByService = new Map(prepared.manifest.services.map((service: Json) => [service.id, imageAliases(service.image)]));
  for (const fields of containers) {
    const [id, name, containerImage, state, labelProject, service, configFile, workingDirectory, oneoff] = fields;
    const allowedImages = imageByService.get(service);
    const expectedComposeFile = composeFileByService.get(service) ?? composeFile;
    let allowedState = state === "exited";
    if (allowCreatedDocmost && service === "docmost" && state === "created") allowedState = true;
    if (!/^[0-9a-f]{12,64}$/.test(id) || labelProject !== projectId
      || !["docmost", "database", "redis"].includes(service) || byService.has(service)
      || !allowedImages || !allowedImages.has(containerImage)
      || name !== `${projectId}-${service}-1` || !allowedState
      || configFile !== expectedComposeFile || workingDirectory !== prepared.directory
      || oneoff.toLowerCase() !== "false") {
      fail("Docmost inspection found an active, unrelated, or mismatched Compose container");
    }
    byService.set(service, id);
    stateByService.set(service, state);
    inspectedContainers.push({ id, service, state });
  }
  if (byService.size !== 3) fail("Docmost inspection did not find the exact Docmost service set");

  const docmostService = prepared.manifest.services.find((item: Json) => item.id === "docmost") as Json | undefined;
  if (!docmostService || !Array.isArray(docmostService.ports) || docmostService.ports.length !== 1) {
    fail("Docmost inspection could not resolve the approved application port");
  }
  const appPort = docmostService.ports[0] as Json;

  for (const service of ["docmost", "database", "redis"]) {
    const id = byService.get(service);
    if (!id) fail("Docmost inspection did not find the exact Docmost service set");
    const bindingOutput = docker(context, ["container", "inspect", "--format", "{{json .HostConfig.PortBindings}}", id],
      `Docmost ${service} configured port inspection`);
    let bindings: unknown;
    try { bindings = JSON.parse(bindingOutput); }
    catch { fail(`Docmost ${service} returned invalid configured port metadata`); }
    const mappings = docker(context, ["port", id], `Docmost ${service} port inspection`);
    if (service !== "docmost") {
      const emptyBindings = bindings === null || (typeof bindings === "object" && !Array.isArray(bindings)
        && Object.keys(bindings as Json).length === 0);
      if (!emptyBindings || mappings !== "") fail("Docmost dependencies must not publish host ports");
      continue;
    }
    const configured = object(bindings, "Docmost configured application ports");
    exact(configured, ["3000/tcp"], "Docmost configured application ports");
    const records = configured["3000/tcp"];
    if (!Array.isArray(records) || records.length !== 1) fail("Docmost inspection found a changed configured application port");
    const record = object(records[0], "Docmost configured application port");
    exact(record, ["HostIp", "HostPort"], "Docmost configured application port");
    if (record.HostIp !== appPort.hostIp || record.HostPort !== String(appPort.published)) {
      fail("Docmost inspection found a changed configured application port");
    }
    let expectedEndpoint = `${appPort.hostIp}:${appPort.published}`;
    if (String(appPort.hostIp).includes(":")) expectedEndpoint = `[${appPort.hostIp}]:${appPort.published}`;
    const state = stateByService.get(service);
    if (state === "created" && mappings !== "") {
      fail("A created Docmost container must not report an active runtime port mapping");
    }
    if (state === "exited" && mappings !== `3000/tcp -> ${expectedEndpoint}`) {
      fail("Docmost inspection found a changed or unrelated published port");
    }
  }

  const networkFormat = [
    "{{.ID}}",
    "{{.Name}}",
    "{{.Driver}}",
    "{{.Scope}}",
    '{{.Label "com.docker.compose.project"}}',
    '{{.Label "com.docker.compose.network"}}',
  ].join("\t");
  const networkOutput = docker(context, [
    "network", "ls",
    "--filter", `label=com.docker.compose.project=${projectId}`,
    "--format", networkFormat,
  ], "Docmost Compose network inspection");
  const networks = lines(networkOutput).map((line) => line.split("\t"));
  if (networks.length !== 1 || networks[0].length !== 6) {
    fail("Docmost inspection requires exactly one bounded Compose-labeled network");
  }
  const [networkId, networkName, driver, scope, labelProject, labelNetwork] = networks[0];
  if (!/^[0-9a-f]{12,64}$/.test(networkId) || networkName !== `${projectId}-private`
    || driver !== "bridge" || scope !== "local" || labelProject !== projectId || labelNetwork !== "private") {
    fail("Docmost inspection found an unrelated or mismatched Compose network");
  }
  inspectedContainers.sort((left, right) => left.service.localeCompare(right.service));
  return {
    containers: inspectedContainers,
    network: { id: networkId, name: networkName },
  };
}

function recoveredNetworks(prepared: ReturnType<typeof buildManifest>): Array<{ name: string; owner: string }> {
  return prepared.manifest.networks.map((network: Json) => ({ name: network.name, owner: network.owner }));
}

function inspectExternalRecoveryNetworks(prepared: ReturnType<typeof buildManifest>): void {
  const context = prepared.manifest.project.dockerContext as string;
  for (const network of prepared.manifest.networks as Json[]) {
    if (network.id === "private") continue;
    const output = docker(context, ["network", "inspect", "--format", "{{.Name}}\t{{.Driver}}\t{{.Scope}}\t{{.Internal}}", network.name],
      "Docmost external network inspection");
    if (output !== `${network.name}\tbridge\tlocal\t${String(network.internal)}`) {
      fail("Docmost external integration network is missing or changed");
    }
  }
}

async function preRootlessComposeTarget(prepared: ReturnType<typeof buildManifest>): Promise<string> {
  const manifest = structuredClone(prepared.manifest);
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid === 0 || gid === 0) {
    fail("Docmost pre-checkpoint recovery requires the original non-root host identity");
  }
  for (const service of manifest.services as Json[]) {
    service.user = `${uid}:${gid}`;
    delete service.rootlessUserEvidence;
  }
  const owner = createSelfhostComposeOwner(manifest);
  const plan = await owner.plan();
  return plan.render.target;
}

async function replacePrivateJson(path: string, expected: unknown, replacement: unknown): Promise<void> {
  const current = await readJson(path, MAX_INPUT, true, "Docmost input");
  if (JSON.stringify(current) !== JSON.stringify(expected)) fail("Docmost input changed during recovery inspection");
  const temporary = join(dirname(path), `.docmost-recovery.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writePrivate(temporary, `${JSON.stringify(replacement, null, 2)}\n`);
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); }
    finally { await directory.close(); }
  } finally {
    try { await unlink(temporary); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
}

async function ensureExactFile(path: string, value: string, name: string): Promise<void> {
  if (!existsSync(path)) await writePrivate(path, value);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(path) !== path
    || (metadata.mode & 0o777) !== 0o600) fail(`${name} must be an owner-only regular file`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(`${name} has a different owner`);
  const current = Buffer.from(await readFile(path));
  const expected = Buffer.from(value);
  if (current.length !== expected.length || !timingSafeEqual(current, expected)) fail(`${name} differs from the approved run`);
}

async function ensureStateRoot(root: string): Promise<void> {
  const state = join(root, ".selfhost");
  await ensureDirectory(state, ".selfhost");
  await ensureExactFile(join(state, ".gitignore"), "*\n", ".selfhost ignore guard");
}

function handoffValid(raw: unknown, expected: { runId: string; projectId: string; account: Account; origin: string }): Handoff {
  const value = object(raw, "Docmost handoff");
  exact(value, ["schemaVersion", "kind", "runId", "projectId", "account", "url", "password", "appSecret", "databasePassword", "status"], "Docmost handoff");
  if (value.schemaVersion !== 1 || value.kind !== "docmost-private-handoff" || value.runId !== expected.runId
    || value.projectId !== expected.projectId || value.url !== expected.origin
    || JSON.stringify(value.account) !== JSON.stringify(expected.account)
    || value.status !== "first-owner-browser-required"
    || !HEX_SECRET.test(value.password) || !HEX_SECRET.test(value.appSecret) || !HEX_SECRET.test(value.databasePassword)) {
    fail("Existing Docmost handoff does not match the approved run");
  }
  return value as Handoff;
}

export async function loadDocmostHandoffForExport(options: {
  projectRoot: string; input: string; runId: string; accountFile: string;
}): Promise<Handoff> {
  const root = await projectRoot(options.projectRoot);
  if (!RUN_ID.test(options.runId) || !inside(root, options.input)) {
    fail("Docmost export must stay with one selected run and project");
  }
  const raw = await readJson(options.input, MAX_INPUT, true, "Docmost input");
  const prepared = buildManifest(raw, root);
  const account = await readAccount(root, options.accountFile);
  const path = join(root, ".selfhost", "docmost", options.runId, "private-handoff.json");
  const handoff = await readJson(path, MAX_PRIVATE, true, "Docmost handoff");
  return handoffValid(handoff, {
    runId: options.runId,
    projectId: prepared.manifest.project.id as string,
    account,
    origin: prepared.origin,
  });
}

function checkpointValid(raw: unknown, expected: { projectId: string; runId: string; directory: string; handoffPath: string }): Checkpoint {
  const value = object(raw, "Docmost checkpoint");
  exact(value, ["schemaVersion", "project", "runId", "approvalDigest", "composeFile", "handoffPath", "health", "ownerSetup"], "Docmost checkpoint");
  const expectedPrefix = `${expected.directory}/compose.`;
  if (value.schemaVersion !== 1 || value.project !== expected.projectId || value.runId !== expected.runId
    || typeof value.approvalDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.approvalDigest)
    || typeof value.composeFile !== "string" || !value.composeFile.startsWith(expectedPrefix)
    || !/^[0-9a-f]{16}\.yaml$/.test(value.composeFile.slice(expectedPrefix.length))
    || value.handoffPath !== expected.handoffPath || typeof value.health !== "boolean"
    || value.ownerSetup !== "browser-evidence-required") {
    fail("Docmost checkpoint is invalid or belongs to another project");
  }
  return value as Checkpoint;
}

function ownerCheckpointValid(raw: unknown, expected: {
  projectId: string; runId: string; origin: string; composeApprovalDigest: string; composeFile: string;
  accountDigest?: string; credentialDigest?: string; approvalDigest?: string;
}): OwnerCheckpoint {
  const value = object(raw, "Docmost owner checkpoint");
  exact(value, ["schemaVersion", "kind", "project", "runId", "origin", "composeApprovalDigest", "composeFile",
    "accountDigest", "credentialDigest", "approvalDigest", "result", "workspace", "freshLogin", "recordedAt"],
  "Docmost owner checkpoint");
  if (value.schemaVersion !== 1 || value.kind !== "docmost-v0.96.0-owner-checkpoint"
    || value.project !== expected.projectId || value.runId !== expected.runId || value.origin !== expected.origin
    || value.composeApprovalDigest !== expected.composeApprovalDigest || value.composeFile !== expected.composeFile
    || !HEX_SECRET.test(value.accountDigest) || !HEX_SECRET.test(value.credentialDigest)
    || !HEX_SECRET.test(value.approvalDigest)
    || (expected.accountDigest && value.accountDigest !== expected.accountDigest)
    || (expected.credentialDigest && value.credentialDigest !== expected.credentialDigest)
    || (expected.approvalDigest && value.approvalDigest !== expected.approvalDigest)
    || !["setup-created", "existing-owner-login"].includes(value.result) || value.freshLogin !== true
    || typeof value.recordedAt !== "string" || Number.isNaN(Date.parse(value.recordedAt))) {
    fail("Docmost owner checkpoint is invalid or belongs to another approved owner plan");
  }
  if (value.workspace !== null) {
    const workspace = object(value.workspace, "Docmost owner workspace checkpoint");
    exact(workspace, ["id", "name", "defaultSpaceId"], "Docmost owner workspace checkpoint");
    for (const field of ["id", "name", "defaultSpaceId"]) {
      if (typeof workspace[field] !== "string" || workspace[field].length < 1 || workspace[field].length > 255
        || /[\u0000-\u001f\u007f]/.test(workspace[field])) {
        fail("Docmost owner workspace checkpoint is invalid");
      }
    }
  }
  if (value.result === "setup-created" && value.workspace === null) {
    fail("Docmost owner checkpoint is missing its setup-created workspace identity");
  }
  return value as OwnerCheckpoint;
}

async function ownerPlanFacts(prepared: ReturnType<typeof buildManifest>, account: Account, runId: string,
  statePath: string, handoffPath: string, ownerStatePath: string): Promise<{
    checkpoint: Checkpoint; handoff: Handoff; approval: string; approvalDigest: string;
    accountDigest: string; credentialDigest: string; prior: OwnerCheckpoint | null;
  }> {
  const selectedOrigin = new URL(prepared.origin);
  const selectedHost = selectedOrigin.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (selectedOrigin.protocol !== "http:" || (selectedHost !== "127.0.0.1" && selectedHost !== "::1")) {
    fail("Docmost API owner setup is restricted to the selected loopback origin; use a protected browser or separately approved HTTPS route");
  }
  if (account.name.length > 50) fail("Docmost v0.96.0 owner name must be at most 50 characters");
  if (!existsSync(statePath)) fail("Docmost owner setup needs the applied Compose checkpoint");
  const projectId = prepared.manifest.project.id as string;
  const checkpoint = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), {
    projectId, runId, directory: prepared.directory, handoffPath,
  });
  if (!checkpoint.health) fail("Docmost owner setup needs a healthy applied Compose checkpoint");
  const compose = createSelfhostComposeOwner(prepared.manifest);
  const composePlan = await compose.plan();
  const expectedComposeDigest = docmostApprovalDigest(prepared, composePlan, account, runId);
  if (checkpoint.approvalDigest !== expectedComposeDigest || checkpoint.composeFile !== composePlan.render.target
    || !existsSync(checkpoint.composeFile)) {
    fail("Docmost owner setup does not match the current applied Compose plan");
  }
  const handoff = handoffValid(await readJson(handoffPath, MAX_PRIVATE, true, "Docmost handoff"), {
    runId, projectId, account, origin: prepared.origin,
  });
  const accountDigest = hash(account);
  const credentialDigest = hash(handoff.password);
  const approvalDigest = hash({
    schemaVersion: 1,
    kind: "docmost-v0.96.0-owner-plan",
    project: projectId,
    runId,
    origin: prepared.origin,
    composeApprovalDigest: checkpoint.approvalDigest,
    composeFile: checkpoint.composeFile,
    accountDigest,
    credentialDigest,
  });
  const approval = `OWNER:${projectId}:${approvalDigest}`;
  let prior: OwnerCheckpoint | null = null;
  if (existsSync(ownerStatePath)) {
    prior = ownerCheckpointValid(await readJson(ownerStatePath, MAX_PRIVATE, true, "Docmost owner checkpoint"), {
      projectId,
      runId,
      origin: prepared.origin,
      composeApprovalDigest: checkpoint.approvalDigest,
      composeFile: checkpoint.composeFile,
      accountDigest,
      credentialDigest,
      approvalDigest,
    });
  }
  return { checkpoint, handoff, approval, approvalDigest, accountDigest, credentialDigest, prior };
}

function authCookiePresent(headers: Headers): boolean {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  let values: string[] = [];
  if (typeof extended.getSetCookie === "function") values = extended.getSetCookie();
  else {
    const value = headers.get("set-cookie");
    if (value) values = [value];
  }
  return values.some((value) => /(?:^|,\s*)authToken=[^;,\s]+(?:;|,|$)/.test(value));
}

async function boundedOwnerJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_OWNER_RESPONSE) {
      await response.body?.cancel();
      fail("Docmost owner API returned an invalid or oversized response");
    }
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_OWNER_RESPONSE) {
        await reader.cancel();
        fail("Docmost owner API returned an oversized response");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return null;
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  if (body.trim() === "") return null;
  try { return JSON.parse(body); }
  catch { fail("Docmost owner API returned an invalid JSON response"); }
}

async function ownerPost(fetcher: OwnerFetch, origin: string, route: "/api/auth/setup" | "/api/auth/login",
  body: Record<string, string>): Promise<{ status: number; cookie: boolean; body: unknown }> {
  let response: Response;
  try {
    response = await fetcher(`${origin}${route}`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OWNER_REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail("Docmost owner API request failed; use the protected browser fallback");
  }
  const cookie = authCookiePresent(response.headers);
  let parsed: unknown;
  try { parsed = await boundedOwnerJson(response); }
  catch {
    fail("Docmost owner API response was unsafe or invalid; use the protected browser fallback");
  }
  return { status: response.status, cookie, body: parsed };
}

function setupWorkspace(raw: unknown): { id: string; name: string; defaultSpaceId: string } {
  const envelope = object(raw, "Docmost owner setup response");
  if (envelope.success !== true || envelope.status !== 200) fail("Docmost owner setup response was not successful");
  const workspace = object(envelope.data, "Docmost owner setup workspace");
  const result: { id: string; name: string; defaultSpaceId: string } = {
    id: workspace.id,
    name: workspace.name,
    defaultSpaceId: workspace.defaultSpaceId,
  };
  for (const value of Object.values(result)) {
    if (typeof value !== "string" || value.length < 1 || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
      fail("Docmost owner setup response did not contain the expected workspace identity");
    }
  }
  return result;
}

function loginResponseValid(raw: unknown): boolean {
  if (raw === null) return true;
  const envelope = object(raw, "Docmost owner login response");
  return envelope.success === true && envelope.status === 200;
}

// Exact Community source contract, not a supported public API or browser UX proof.
const DOCMOST_ACCEPT_CONTRACT_V1 = "9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af:accept-v1";
const DOCMOST_ACCEPT_CONTRACT = "9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af:accept-v2-mime-charset";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPT_STAGES = ["start", "write-login", "write-identity", "create-page", "edit-page", "upload-file",
  "read-login", "read-identity", "read-page", "read-attachment", "download-file", "accepted"] as const;
type AcceptStage = typeof ACCEPT_STAGES[number];
type AcceptEvent = { schemaVersion: 1; digest: string; stage: AcceptStage; result: "intent" | "completed" | "unknown";
  pageId: string | null; attachmentId: string | null; recordedAt: string };

function acceptanceSynthetic(nonce: string) {
  const title = `Self-host acceptance ${nonce}`;
  const initial = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Initial acceptance ${nonce}` }] }] };
  const edited = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Edited acceptance ${nonce}` }] }] };
  const fileName = `selfhost-acceptance-${nonce}.txt`;
  const bytes = Buffer.from(`Self-host Docmost attachment acceptance ${nonce}\n`, "utf8");
  return { title, initial, edited, fileName, bytes, byteHash: createHash("sha256").update(bytes).digest("hex") };
}

async function acceptanceEvents(path: string, digest: string): Promise<{ events: AcceptEvent[]; interruptedTail: boolean }> {
  if (!existsSync(path)) return { events: [], interruptedTail: false };
  await inspectPrivateFile(path, "Docmost acceptance attempt", MAX_PRIVATE);
  const text = await readFile(path, "utf8");
  const interruptedTail = !text.endsWith("\n");
  const lines = text.split("\n");
  lines.pop(); // An unterminated final append is not durable evidence, but still consumes the attempt.
  if (lines.length > 32) fail("Docmost acceptance attempt has too many records");
  const events: AcceptEvent[] = [];
  for (const line of lines) {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { fail("Docmost acceptance attempt contains a malformed complete record"); }
    const event = object(raw, "Docmost acceptance event");
    exact(event, ["schemaVersion", "digest", "stage", "result", "pageId", "attachmentId", "recordedAt"], "Docmost acceptance event");
    if (event.schemaVersion !== 1 || event.digest !== digest || !ACCEPT_STAGES.includes(event.stage)
      || !["intent", "completed", "unknown"].includes(event.result)
      || (event.pageId !== null && !UUID.test(event.pageId)) || (event.attachmentId !== null && !UUID.test(event.attachmentId))
      || typeof event.recordedAt !== "string" || !Number.isFinite(Date.parse(event.recordedAt))) {
      fail("Docmost acceptance attempt identity or stage is invalid");
    }
    const previous = events.at(-1);
    if ((!previous && (event.stage !== "start" || event.result !== "intent" || event.pageId !== null || event.attachmentId !== null))
      || (previous && (previous.result === "unknown" || previous.stage === "accepted"
        || (previous.pageId !== null && previous.pageId !== event.pageId)
        || (previous.attachmentId !== null && previous.attachmentId !== event.attachmentId)))) {
      fail("Docmost acceptance attempt sequence is invalid");
    }
    if (previous) {
      const previousIndex = ACCEPT_STAGES.indexOf(previous.stage);
      const currentIndex = ACCEPT_STAGES.indexOf(event.stage);
      let transition = event.result === "unknown" && event.stage === previous.stage;
      if (previous.stage !== "start" && previous.result === "intent" && event.stage === previous.stage
        && event.result === "completed") transition = true;
      if ((previous.result === "completed" || previous.stage === "start") && currentIndex === previousIndex + 1
        && event.stage !== "accepted" && event.result === "intent") transition = true;
      if (previous.stage === "download-file" && previous.result === "completed" && event.stage === "accepted"
        && event.result === "completed" && event.pageId !== null && event.attachmentId !== null) transition = true;
      if (!transition || (event.stage === "create-page" && event.result === "completed" && event.pageId === null)
        || (event.stage === "upload-file" && event.result === "completed" && event.attachmentId === null)
        || (previous.pageId === null && event.pageId !== null
        && (event.stage !== "create-page" || event.result !== "completed"))
        || (previous.attachmentId === null && event.attachmentId !== null
          && (event.stage !== "upload-file" || event.result !== "completed"))) {
        fail("Docmost acceptance attempt transition is invalid");
      }
    }
    events.push(event as AcceptEvent);
  }
  if (!events.length && !interruptedTail) fail("Docmost acceptance attempt is empty");
  return { events, interruptedTail };
}

async function acceptanceAppend(path: string, event: AcceptEvent): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

function acceptanceData(raw: unknown): Json {
  const envelope = object(raw, "Docmost acceptance response");
  if (envelope.success !== true || envelope.status !== 200) fail("Docmost acceptance response envelope is invalid");
  return object(envelope.data, "Docmost acceptance data");
}

function acceptanceEditedContent(raw: unknown, expected: Json): boolean {
  // Yjs/Tiptap adds paragraph IDs and layout attrs. Compare the exact bounded semantic document instead.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const doc = raw as Json;
  if (Object.keys(doc).some((key) => key !== "type" && key !== "content") || doc.type !== "doc"
    || !Array.isArray(doc.content) || doc.content.length !== 1) return false;
  const paragraph = doc.content[0];
  if (!paragraph || typeof paragraph !== "object" || Array.isArray(paragraph) || paragraph.type !== "paragraph"
    || Object.keys(paragraph).some((key) => !["type", "content", "attrs"].includes(key))
    || !Array.isArray(paragraph.content) || paragraph.content.length !== 1) return false;
  if (paragraph.attrs !== undefined) {
    if (!paragraph.attrs || typeof paragraph.attrs !== "object" || Array.isArray(paragraph.attrs)
      || Object.keys(paragraph.attrs).length > 8 || JSON.stringify(paragraph.attrs).length > 1024) return false;
    // Attributes are schema-owned presentation, not extra text/nodes or marks.
  }
  const text = paragraph.content[0];
  return text !== null && typeof text === "object" && !Array.isArray(text)
    && Object.keys(text).every((key) => key === "type" || key === "text")
    && text.type === "text" && text.text === expected.content[0].content[0].text;
}

function acceptanceCookie(headers: Headers): string {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  const matches = values.flatMap((value) => [...value.matchAll(/(?:^|,\s*)authToken=([A-Za-z0-9_.-]{1,4096})(?:;|,|$)/g)]);
  if (matches.length !== 1) fail("Docmost acceptance session cookie is invalid");
  return `authToken=${matches[0][1]}`;
}

async function docmostAcceptance(prepared: ReturnType<typeof buildManifest>, options: Options, root: string,
  statePath: string, handoffPath: string, ownerStatePath: string, runtime: DocmostRuntime): Promise<void> {
  const attemptPath = join(dirname(statePath), "acceptance-attempt.jsonl");
  const verificationPath = join(dirname(statePath), "acceptance-verification.json");
  const project = prepared.manifest.project.id as string;
  const checkpoint = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), {
    projectId: project, runId: options.runId, directory: prepared.directory, handoffPath,
  });
  const recordedOwner = ownerCheckpointValid(await readJson(ownerStatePath, MAX_PRIVATE, true, "Docmost owner checkpoint"), {
    projectId: project, runId: options.runId, origin: prepared.origin,
    composeApprovalDigest: checkpoint.approvalDigest, composeFile: checkpoint.composeFile,
  });
  if (!checkpoint.health || !recordedOwner.workspace || !UUID.test(recordedOwner.workspace.id)
    || !UUID.test(recordedOwner.workspace.defaultSpaceId)) fail("Docmost acceptance needs the healthy managed owner workspace and default-space UUIDs");
  const factsDigest = hash({ manifest: prepared.manifest, checkpoint, owner: recordedOwner });
  const candidate = (contract: string) => {
    const nonce = hash({ factsDigest, contract }).slice(0, 24);
    const synthetic = acceptanceSynthetic(nonce);
    const bound = { schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-plan", project, runId: options.runId,
      origin: prepared.origin, contract, nonce, factsDigest,
      workspaceId: recordedOwner.workspace!.id, spaceId: recordedOwner.workspace!.defaultSpaceId,
      synthetic: { title: synthetic.title, fileName: synthetic.fileName, initialHash: hash(synthetic.initial),
        editedHash: hash(synthetic.edited), byteHash: synthetic.byteHash, byteLength: synthetic.bytes.length,
        disposition: "retained-for-inspection" } };
    return { ...bound, digest: hash(bound) };
  };
  let saved = candidate(DOCMOST_ACCEPT_CONTRACT);
  if (existsSync(attemptPath)) {
    await inspectPrivateFile(attemptPath, "Docmost acceptance attempt", MAX_PRIVATE);
    const firstLine = (await readFile(attemptPath, "utf8")).split("\n")[0];
    let first: Json;
    try { first = object(JSON.parse(firstLine), "Docmost acceptance first event"); }
    catch { fail("Docmost acceptance first durable event is invalid"); }
    if (first.digest !== saved.digest) {
      const legacy = candidate(DOCMOST_ACCEPT_CONTRACT_V1);
      if (first.digest !== legacy.digest) fail("Docmost acceptance attempt differs from the exact applied owner facts");
      saved = legacy;
    }
  }
  const synthetic = acceptanceSynthetic(saved.nonce);
  const priorAttempt = await acceptanceEvents(attemptPath, saved.digest);
  let originalAttemptHash: string | null = null;
  if (existsSync(attemptPath)) originalAttemptHash = hash(await readFile(attemptPath, "utf8"));
  let verification: Json | null = null;
  if (existsSync(verificationPath)) {
    verification = object(await readJson(verificationPath, MAX_PRIVATE, true, "Docmost acceptance verification"), "Docmost acceptance verification");
    exact(verification, ["schemaVersion", "kind", "contract", "approvalDigest", "attemptHash", "pageId", "attachmentId", "byteHash", "mimeType", "fileExt", "recordedAt"], "Docmost acceptance verification");
    const durable = priorAttempt.events.at(-1);
    if (verification.schemaVersion !== 1 || verification.kind !== "docmost-v0.96.0-acceptance-verification"
      || verification.contract !== DOCMOST_ACCEPT_CONTRACT || verification.approvalDigest !== saved.digest
      || !existsSync(attemptPath) || verification.attemptHash !== hash(await readFile(attemptPath, "utf8"))
      || !UUID.test(verification.pageId) || verification.pageId !== durable?.pageId || !UUID.test(verification.attachmentId)
      || (durable?.attachmentId !== null && verification.attachmentId !== durable?.attachmentId)
      || verification.byteHash !== synthetic.byteHash || verification.fileExt !== ".txt"
      || typeof verification.mimeType !== "string" || !/^text\/plain(?:;\s*charset=utf-8)?$/i.test(verification.mimeType)
      || typeof verification.recordedAt !== "string" || !Number.isFinite(Date.parse(verification.recordedAt))) {
      fail("Docmost acceptance verification differs from the original attempt");
    }
  }
  if (options.action === "accept-status") {
    const attempt = priorAttempt;
    const last = attempt.events.at(-1);
    let status = "planned";
    if (existsSync(attemptPath)) status = "unknown-no-replay";
    if (!attempt.interruptedTail && last?.stage === "accepted" && last.result === "completed") status = "accepted";
    if (verification) status = "verified-readback";
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-status", project, runId: options.runId, status,
      approval: `ACCEPT-DOCMOST:${project}:${saved.digest}`, attempt: attemptPath,
      interruptedTail: attempt.interruptedTail, lastDurableStage: last?.stage ?? null,
      recordedAt: last?.recordedAt ?? null, evidence: "recorded-api-proof-not-live-recheck",
      pageId: last?.pageId ?? null, attachmentId: verification?.attachmentId ?? last?.attachmentId ?? null,
      readonlyVerification: verificationPath, verified: verification !== null,
      verificationRecordedAt: verification?.recordedAt ?? null,
      synthetic: saved.synthetic, replayAllowed: !existsSync(attemptPath),
      next: "Inspect only the retained synthetic IDs; never replay an interrupted attempt. Browser UX, Homarr and isolated restore remain separate gates." });
    return;
  }
  const account = await readAccount(root, options.accountFile);
  const facts = await ownerPlanFacts(prepared, account, options.runId, statePath, handoffPath, ownerStatePath);
  const owner = facts.prior;
  if (!owner?.workspace || !UUID.test(owner.workspace.id) || !UUID.test(owner.workspace.defaultSpaceId)) {
    fail("Docmost acceptance needs the recorded managed owner workspace and default-space UUIDs");
  }
  if (saved.factsDigest !== hash({ manifest: prepared.manifest, checkpoint: facts.checkpoint, owner })
    || saved.workspaceId !== owner.workspace.id || saved.spaceId !== owner.workspace.defaultSpaceId) {
    fail("Docmost acceptance plan differs from the current exact applied owner facts");
  }
  const approval = `ACCEPT-DOCMOST:${project}:${saved.digest}`;
  if (options.action === "accept-plan") {
    let status = "ready-for-approval";
    if (existsSync(attemptPath)) status = "attempt-consumed-no-replay";
    print({ ...saved, status, approval, mutation: false,
      attemptConsumed: existsSync(attemptPath),
      request: "Fresh managed-owner login; one synthetic page create/edit and one attachment upload; second fresh login and exact content/metadata/byte-hash readback.",
      limits: ["Exact pinned Community source contract, not a supported public API.", "Only synthetic nonce artifacts are mutated and retained for inspection; no delete or existing-content mutation.",
        "Cookies remain in memory. Browser editor attachment rendering, Homarr and isolated restore are not proven.", "Any durable attempt, including an interrupted login, forbids replay."] });
    return;
  }
  const verifying = options.action === "accept-verify";
  if (!verifying && options.approval !== approval) fail("Docmost acceptance apply requires the exact approval token from the unchanged plan");
  if (!verifying && existsSync(attemptPath)) fail("Docmost acceptance attempt is already consumed; use accept status, never replay");
  if (verifying && (!priorAttempt.events.some((event) => event.stage === "create-page" && event.result === "completed")
    || !priorAttempt.events.some((event) => event.stage === "edit-page" && event.result === "completed"))) {
    fail("Docmost acceptance verify requires the original durable synthetic page create/edit proof");
  }
  if (verifying && verification) {
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-verify", status: "verified-readback",
      applicationWrites: false, localEvidenceWritten: false, verification: verificationPath,
      pageId: verification.pageId, attachmentId: verification.attachmentId,
      evidence: "existing-recorded-readback-not-live-recheck" });
    return;
  }
  const healthy = runtime.health ? await runtime.health(prepared.origin) : await health(prepared.origin);
  if (!healthy) fail("Docmost acceptance needs the exact loopback service healthy now");
  let stage: AcceptStage = "start";
  let storageFailed = false;
  let pageId: string | null = null;
  let attachmentId: string | null = null;
  let verifyStage: string | null = null;
  let attachmentMime: string | null = null;
  if (verifying) {
    const durable = priorAttempt.events.at(-1)!;
    pageId = durable.pageId;
    attachmentId = durable.attachmentId;
  }
  const event = (result: AcceptEvent["result"]): AcceptEvent => ({ schemaVersion: 1, digest: saved!.digest,
    stage, result, pageId, attachmentId, recordedAt: new Date().toISOString() });
  if (!verifying) {
    await writePrivate(attemptPath, `${JSON.stringify(event("intent"))}\n`);
    await syncDirectory(dirname(attemptPath));
  }
  const fetcher = runtime.ownerFetch ?? fetch;
  const request = async (route: string, cookie: string | null, body: Json | FormData | null): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (cookie) headers.cookie = cookie;
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== null) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const response = await fetcher(`${prepared.origin}${route}`, { method: body === null ? "GET" : "POST",
      headers, body: payload, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(OWNER_REQUEST_TIMEOUT_MS) });
    if (response.status !== 200) { await response.body?.cancel(); fail("Docmost acceptance request was rejected"); }
    return response;
  };
  const step = async <T>(next: AcceptStage, callback: () => Promise<T>): Promise<T> => {
    stage = next;
    if (verifying) return callback();
    try { await acceptanceAppend(attemptPath, event("intent")); }
    catch { storageFailed = true; throw new Error("Docmost acceptance durable intent failed"); }
    const result = await callback();
    try { await acceptanceAppend(attemptPath, event("completed")); }
    catch { storageFailed = true; throw new Error("Docmost acceptance durable completion failed"); }
    return result;
  };
  const login = async (): Promise<string> => {
    const response = await request("/api/auth/login", null, { email: account.email, password: facts.handoff.password });
    const cookie = acceptanceCookie(response.headers);
    if (!loginResponseValid(await boundedOwnerJson(response))) fail("Docmost acceptance fresh login was invalid");
    return cookie;
  };
  let userId: string | null = null;
  const identity = async (cookie: string): Promise<void> => {
    const data = acceptanceData(await boundedOwnerJson(await request("/api/users/me", cookie, {})));
    const user = object(data.user, "Docmost acceptance user");
    const workspace = object(data.workspace, "Docmost acceptance workspace");
    if (user.email !== account.email || !UUID.test(user.id) || user.workspaceId !== saved!.workspaceId
      || workspace.id !== saved!.workspaceId || (userId !== null && user.id !== userId)) fail("Docmost acceptance identity mismatch");
    userId = user.id;
  };
  const page = (raw: unknown): Json => {
    const data = acceptanceData(raw);
    if (!UUID.test(data.id) || (pageId !== null && data.id !== pageId) || data.spaceId !== saved!.spaceId
      || data.workspaceId !== saved!.workspaceId || data.creatorId !== userId || data.title !== synthetic.title) fail("Docmost acceptance page ownership mismatch");
    return data;
  };
  const attachment = (raw: unknown): Json => {
    const data = object(raw, "Docmost acceptance attachment");
    if (!UUID.test(data.id) || (attachmentId !== null && data.id !== attachmentId) || data.type !== "file"
      || data.pageId !== pageId || data.spaceId !== saved!.spaceId || data.workspaceId !== saved!.workspaceId
      || data.creatorId !== userId || data.fileName !== synthetic.fileName || Number(data.fileSize) !== synthetic.bytes.length
      || typeof data.mimeType !== "string" || !/^text\/plain(?:;\s*charset=utf-8)?$/i.test(data.mimeType)
      || data.fileExt !== ".txt") fail("Docmost acceptance attachment ownership mismatch");
    attachmentMime = data.mimeType;
    return data;
  };
  try {
    if (!verifying) {
      const writeCookie = await step("write-login", login);
      await step("write-identity", () => identity(writeCookie));
      await step("create-page", async () => {
        const created = page(await boundedOwnerJson(await request("/api/pages/create", writeCookie,
          { spaceId: saved!.spaceId, title: synthetic.title, content: synthetic.initial, format: "json" })));
        pageId = created.id;
      });
      await step("edit-page", async () => {
        page(await boundedOwnerJson(await request("/api/pages/update", writeCookie,
          { pageId, content: synthetic.edited, format: "json", operation: "replace" })));
      });
      await step("upload-file", async () => {
        const form = new FormData();
        form.append("pageId", pageId!);
        form.append("file", new Blob([synthetic.bytes], { type: "text/plain" }), synthetic.fileName);
        const uploaded = attachment(await boundedOwnerJson(await request("/api/files/upload", writeCookie, form)));
        attachmentId = uploaded.id;
      });
    }
    const readCookie = await step("read-login", login);
    await step("read-identity", () => identity(readCookie));
    await step("read-page", async () => {
      const read = page(await boundedOwnerJson(await request("/api/pages/info", readCookie, { pageId, format: "json" })));
      if (!acceptanceEditedContent(read.content, synthetic.edited)) fail("Docmost acceptance edited content mismatch");
    });
    if (verifying) {
      verifyStage = "list-attachments";
      let cursor: string | null = null;
      let matched: Json | null = null;
      let exhausted = false;
      const seenCursors = new Set<string>();
      for (let index = 0; index < 3; index += 1) {
        const body: Json = { pageId, limit: 20, query: synthetic.fileName };
        if (cursor !== null) body.cursor = cursor;
        const listed = acceptanceData(await boundedOwnerJson(await request("/api/pages/attachments", readCookie, body)));
        if (!Array.isArray(listed.items) || listed.items.length > 20) fail("Docmost acceptance attachment listing is invalid");
        for (const raw of listed.items) {
          const item = object(raw, "Docmost acceptance attachment candidate");
          if (item.fileName !== synthetic.fileName) continue;
          if (matched !== null) fail("Docmost acceptance attachment listing is ambiguous");
          matched = attachment(item);
        }
        const meta = object(listed.meta, "Docmost acceptance attachment pagination");
        if (typeof meta.hasNextPage !== "boolean") fail("Docmost acceptance attachment pagination is invalid");
        if (!meta.hasNextPage) { exhausted = true; break; }
        if (typeof meta.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(meta.nextCursor)
          || seenCursors.has(meta.nextCursor)) fail("Docmost acceptance attachment cursor is invalid");
        cursor = meta.nextCursor;
        seenCursors.add(cursor);
      }
      if (!exhausted || matched === null) fail("Docmost acceptance exact synthetic attachment was not uniquely verified");
      attachmentId = matched.id;
      verifyStage = null;
    }
    await step("read-attachment", async () => {
      attachment(acceptanceData(await boundedOwnerJson(await request("/api/files/info", readCookie, { attachmentId }))));
    });
    await step("download-file", async () => {
      // Never follow the server's returned URL: cookies only reach the approved loopback origin.
      const response = await request(`/api/files/${attachmentId}/${encodeURIComponent(synthetic.fileName)}`, readCookie, null);
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) !== synthetic.bytes.length) { await response.body?.cancel(); fail("Docmost acceptance attachment length mismatch"); }
      const reader = response.body?.getReader();
      if (!reader) fail("Docmost acceptance attachment bytes missing");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > synthetic.bytes.length) { await reader.cancel(); fail("Docmost acceptance attachment response oversized"); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (length !== synthetic.bytes.length || createHash("sha256").update(bytes).digest("hex") !== synthetic.byteHash) fail("Docmost acceptance attachment hash mismatch");
    });
    if (verifying) {
      verifyStage = "record-readback";
      if (hash(await readFile(attemptPath, "utf8")) !== originalAttemptHash) fail("Docmost acceptance original attempt changed during verification");
      const evidence = { schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-verification", contract: DOCMOST_ACCEPT_CONTRACT,
        approvalDigest: saved.digest, attemptHash: originalAttemptHash, pageId, attachmentId,
        byteHash: synthetic.byteHash, mimeType: attachmentMime, fileExt: ".txt", recordedAt: new Date().toISOString() };
      await writePrivate(verificationPath, `${JSON.stringify(evidence, null, 2)}\n`);
      await syncDirectory(dirname(verificationPath));
      print({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-verify", status: "verified-readback", project, runId: options.runId,
        applicationWrites: false, localEvidenceWritten: true, verification: verificationPath,
        originalWriteAttempt: "unchanged-no-replay", approvalDigest: saved.digest, pageId, attachmentId,
        checks: { freshManagedLogin: true, identity: true, editedPage: true, uniqueOwnedAttachment: true, originalByteHash: true },
        synthetic: saved.synthetic, mimeType: attachmentMime, fileExt: ".txt" });
      return;
    }
    stage = "accepted";
    try { await acceptanceAppend(attemptPath, event("completed")); }
    catch { storageFailed = true; throw new Error("Docmost acceptance durable acceptance failed"); }
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-apply", status: "accepted", project, runId: options.runId,
      attempt: attemptPath, approvalDigest: saved.digest, freshWriteLogin: true, freshReadLogin: true,
      pageId, attachmentId, synthetic: saved.synthetic,
      limits: "API page edit, attachment linkage and exact bytes proven; browser editor rendering, Homarr and isolated restore remain separate." });
  } catch {
    if (verifying) {
      process.exitCode = 1;
      print({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-verify", status: "unknown-readback", project, runId: options.runId,
        stage: verifyStage ?? stage, applicationWrites: false, originalWriteAttempt: "unchanged-no-replay",
        pageId, attachmentId, synthetic: saved.synthetic, next: "Inspect only these retained synthetic artifacts; never replay upload or change the consumed attempt." });
      return;
    }
    // The flushed prior intent remains authoritative even if storage becomes unavailable.
    let failureRecorded = false;
    if (!storageFailed) {
      try { await acceptanceAppend(attemptPath, event("unknown")); failureRecorded = true; } catch { /* no replay or further writes */ }
    }
    process.exitCode = 1;
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-acceptance-apply", status: "unknown-no-replay", project, runId: options.runId,
      stage, pageId, attachmentId, attempt: attemptPath, failureRecorded, synthetic: saved.synthetic,
      next: "Use accept status and inspect only these synthetic artifacts; do not replay the mutation attempt." });
  }
}

async function writeOwnerCheckpoint(path: string, checkpoint: OwnerCheckpoint): Promise<void> {
  const temporary = join(dirname(path), `.owner-state.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writePrivate(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    try { await unlink(temporary); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
}

async function recoveryRevision(raw: unknown, prepared: ReturnType<typeof buildManifest>, options: Options,
  statePath: string, handoffPath: string, preCheckpointComposeFile: string): Promise<{ revised: Json; source: string }> {
  const input = object(raw, "Docmost input");
  const project = prepared.manifest.project as Json;
  const observed = object(input.observed, "observed");
  if (!prepared.rootless || project.dockerContext !== "rootless") {
    fail("Docmost recover-plan is limited to an exact rootless Docker project");
  }
  if (project.ownership !== "new" || observed.project !== null) {
    fail("Docmost recover-plan accepts only the original failed new-project input; use plan after recovery");
  }
  await inspectDirectory(dirname(dirname(statePath)), "Docmost CLI state");
  await inspectDirectory(dirname(statePath), "Docmost run state");
  const checkpointIdentity = {
    projectId: project.id as string,
    runId: options.runId,
    directory: prepared.directory,
    handoffPath,
  };
  let composeFile = preCheckpointComposeFile;
  let source = "pre-checkpoint-compose";
  if (existsSync(statePath)) {
    const checkpoint = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), checkpointIdentity);
    if (checkpoint.health) fail("Docmost recover-plan refuses a healthy prior checkpoint");
    composeFile = checkpoint.composeFile;
    source = "failed-checkpoint";
    await inspectPrivateFile(statePath, "Docmost failed checkpoint", MAX_PRIVATE);
  }

  await inspectDirectory(prepared.directory, "Docmost Compose directory");
  await inspectDirectory(join(prepared.directory, "data"), "Docmost data parent");
  await inspectDirectory(prepared.storage.attachments, "Docmost attachment directory");
  await inspectDirectory(prepared.storage.database, "Docmost database directory", true);
  await inspectDirectory(prepared.storage.redis, "Docmost Redis directory", true);
  await inspectDirectory(join(prepared.directory, "secrets"), "Docmost secrets directory");
  await inspectPrivateFile(prepared.appSecret, "Docmost app secret", 64 * 1024);
  await inspectPrivateFile(prepared.databasePassword, "Docmost database password", 64 * 1024);
  await inspectPrivateFile(prepared.startScript, "Docmost start script", MAX_PRIVATE);
  if (prepared.rootless && existsSync(prepared.postgresStartScript)) {
    await inspectPrivateFile(prepared.postgresStartScript, "Docmost PostgreSQL rootless start script", MAX_PRIVATE);
    if (await readFile(prepared.postgresStartScript, "utf8") !== prepared.postgresStartContent) {
      fail("Docmost PostgreSQL rootless start script differs from the failed approved run");
    }
  }
  await inspectPrivateFile(handoffPath, "Docmost private handoff", MAX_PRIVATE);
  if (!existsSync(composeFile)) fail(`Docmost recover-plan requires the exact failed Compose file: ${composeFile}`);
  await inspectPrivateFile(composeFile, "Docmost failed Compose file", MAX_INPUT);
  if (await readFile(prepared.startScript, "utf8") !== START_SCRIPT) {
    fail("Docmost start script differs from the failed approved run");
  }

  inspectRootlessComposeProject(prepared, composeFile, source === "pre-checkpoint-compose");
  inspectExternalRecoveryNetworks(prepared);

  const revised = structuredClone(input);
  revised.project.ownership = "verified-existing";
  const recoveredPaths = [prepared.storage.attachments, prepared.storage.database, prepared.storage.redis, prepared.startScript];
  if (prepared.rootless && existsSync(prepared.postgresStartScript)) recoveredPaths.push(prepared.postgresStartScript);
  const paths = recoveredPaths.sort().map((path) => ({ path, owner: project.owner }));
  revised.observed = {
    checkedAt: new Date().toISOString(),
    project: { id: project.id, directory: prepared.directory, owner: project.owner },
    ports: [{ hostIp: input.hostIp, published: input.publishedPort, protocol: "tcp", owner: project.owner }],
    paths,
    networks: recoveredNetworks(prepared),
  };
  return { revised, source };
}

function exactRecoveredObservations(raw: unknown, prepared: ReturnType<typeof buildManifest>, includePostgresScript = false): void {
  const input = object(raw, "Docmost input");
  const project = prepared.manifest.project as Json;
  const observed = object(input.observed, "observed");
  const paths = [prepared.storage.attachments, prepared.storage.database, prepared.storage.redis, prepared.startScript];
  if (includePostgresScript) paths.push(prepared.postgresStartScript);
  const expectedPaths = paths.sort().map((path) => ({ path, owner: project.owner }));
  const expected = {
    project: { id: project.id, directory: prepared.directory, owner: project.owner },
    ports: [{ hostIp: input.hostIp, published: input.publishedPort, protocol: "tcp", owner: project.owner }],
    paths: expectedPaths,
    networks: recoveredNetworks(prepared),
  };
  if (typeof observed.checkedAt !== "string" || Number.isNaN(Date.parse(observed.checkedAt))
    || JSON.stringify(observed.project) !== JSON.stringify(expected.project)
    || JSON.stringify(observed.ports) !== JSON.stringify(expected.ports)
    || JSON.stringify(observed.paths) !== JSON.stringify(expected.paths)
    || JSON.stringify(observed.networks) !== JSON.stringify(expected.networks)) {
    fail("Docmost PGDATA repair requires the exact recovered project observations");
  }
}

function withoutPostgresParentWrapper(prepared: ReturnType<typeof buildManifest>): Json {
  const manifest = structuredClone(prepared.manifest);
  const database = (manifest.services as Json[]).find((service) => service.id === "database");
  if (!database) fail("Docmost manifest is missing PostgreSQL");
  database.mounts = (database.mounts as Json[])
    .filter((mount) => mount.target !== "/opt/selfhost/postgres-rootless-start.sh");
  delete database.entrypoint;
  delete database.command;
  return manifest;
}

function withoutPostgresCommand(prepared: ReturnType<typeof buildManifest>): Json {
  const manifest = structuredClone(prepared.manifest);
  const database = (manifest.services as Json[]).find((service) => service.id === "database");
  if (!database) fail("Docmost manifest is missing PostgreSQL");
  delete database.command;
  return manifest;
}

function beforePostgresParentRecovery(prepared: ReturnType<typeof buildManifest>): Json {
  const manifest = withoutPostgresParentWrapper(prepared);
  manifest.observed.paths = (manifest.observed.paths as Json[])
    .filter((entry) => entry.path !== prepared.postgresStartScript);
  return manifest;
}

async function inspectPostgresParentRecovery(raw: unknown, prepared: ReturnType<typeof buildManifest>, options: Options,
  statePath: string, handoffPath: string, account: Account, runtime: DocmostRuntime) {
  const input = object(raw, "Docmost input");
  const project = prepared.manifest.project as Json;
  if (!prepared.rootless || project.dockerContext !== "rootless" || project.ownership !== "verified-existing") {
    fail("Docmost PostgreSQL parent recovery requires the verified-existing rootless project");
  }
  const observed = object(input.observed, "observed");
  const wrapperObserved = Array.isArray(observed.paths)
    && observed.paths.some((entry: unknown) => object(entry, "observed path").path === prepared.postgresStartScript);
  exactRecoveredObservations(raw, prepared, wrapperObserved);

  let phase = "parent-wrapper";
  let legacyManifest = withoutPostgresParentWrapper(prepared);
  if (wrapperObserved) {
    phase = "postgres-command";
    legacyManifest = withoutPostgresCommand(prepared);
  }
  const legacyCompose = createSelfhostComposeOwner(legacyManifest);
  const legacyPlan = await legacyCompose.plan();
  const composeFile = legacyPlan.render.target;
  if (!existsSync(composeFile)) {
    fail(`Docmost PostgreSQL parent recovery requires the exact prior Compose file: ${composeFile}`);
  }
  await inspectPrivateFile(composeFile, "Docmost prior Compose file", MAX_INPUT);
  await inspectDirectory(dirname(dirname(statePath)), "Docmost CLI state");
  await inspectDirectory(dirname(statePath), "Docmost run state");
  await inspectDirectory(prepared.directory, "Docmost Compose directory");
  await inspectDirectory(join(prepared.directory, "data"), "Docmost data parent");
  await inspectDirectory(prepared.storage.attachments, "Docmost attachment directory");
  await inspectDirectory(prepared.storage.redis, "Docmost Redis directory", true);
  await inspectDirectory(join(prepared.directory, "secrets"), "Docmost secrets directory");
  await inspectPrivateFile(prepared.appSecret, "Docmost app secret", 64 * 1024);
  await inspectPrivateFile(prepared.databasePassword, "Docmost database password", 64 * 1024);
  await inspectPrivateFile(prepared.startScript, "Docmost start script", MAX_PRIVATE);
  await inspectPrivateFile(handoffPath, "Docmost private handoff", MAX_PRIVATE);
  if (await readFile(prepared.startScript, "utf8") !== START_SCRIPT) {
    fail("Docmost start script differs from the prior approved run");
  }

  const legacyApproval: Json = { manifest: legacyManifest, composePlan: legacyPlan, account,
    runId: options.runId, startScript: START_SCRIPT };
  if (wrapperObserved) legacyApproval.postgresStartScript = prepared.postgresStartContent;
  const legacyDigest = hash(legacyApproval);
  let checkpoint: Json = { status: "absent" };
  if (existsSync(statePath)) {
    const saved = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), {
      projectId: project.id as string,
      runId: options.runId,
      directory: prepared.directory,
      handoffPath,
    });
    if (saved.health) fail("Docmost PostgreSQL parent recovery refuses a healthy checkpoint");
    if (saved.approvalDigest !== legacyDigest || saved.composeFile !== composeFile) {
      fail("Docmost PostgreSQL parent recovery found a checkpoint for a different plan");
    }
    checkpoint = { status: "failed", digest: hash(saved) };
  }

  if (runtime.composePreflight) await runtime.composePreflight();
  else await legacyCompose.preflight(legacyPlan);
  const composeFileByService = new Map<string, string>();
  let retainedComposeFile = composeFile;
  if (wrapperObserved) {
    const retainedManifest = beforePostgresParentRecovery(prepared);
    const retainedCompose = createSelfhostComposeOwner(retainedManifest);
    const retainedPlan = await retainedCompose.plan();
    retainedComposeFile = retainedPlan.render.target;
    if (!existsSync(retainedComposeFile)) {
      fail(`Docmost PostgreSQL command recovery requires the retained pre-wrapper Compose file: ${retainedComposeFile}`);
    }
    await inspectPrivateFile(retainedComposeFile, "Docmost retained pre-wrapper Compose file", MAX_INPUT);
    if (runtime.composePreflight) await runtime.composePreflight();
    else await retainedCompose.preflight(retainedPlan);
    composeFileByService.set("docmost", retainedComposeFile);
    composeFileByService.set("redis", retainedComposeFile);
  }
  const dockerState = inspectRootlessComposeProject(prepared, composeFile, true, composeFileByService);

  let wrapper = { status: "absent" } as Json;
  if (existsSync(prepared.postgresStartScript)) {
    await inspectPrivateFile(prepared.postgresStartScript, "Docmost PostgreSQL rootless start script", MAX_PRIVATE);
    if (await readFile(prepared.postgresStartScript, "utf8") !== prepared.postgresStartContent) {
      fail("Docmost PostgreSQL rootless start script differs from the supported recovery script");
    }
    const metadata = await lstat(prepared.postgresStartScript);
    wrapper = { status: "resumable", dev: metadata.dev, ino: metadata.ino };
  }
  if (wrapperObserved && wrapper.status !== "resumable") {
    fail("Docmost PostgreSQL command recovery requires the exact existing rootless wrapper");
  }
  const databaseMetadataReader = runtime.rootlessDirectoryMetadata ?? lstat;
  const databaseMetadata = await inspectPostgresDatabaseParent(
    prepared.storage.database,
    wrapperObserved && wrapper.status === "resumable",
    databaseMetadataReader,
  );

  const revisedRaw = structuredClone(input);
  let inputRevisionRequired = false;
  if (!wrapperObserved) {
    revisedRaw.observed.paths.push({ path: prepared.postgresStartScript, owner: project.owner });
    revisedRaw.observed.paths.sort((left: Json, right: Json) => left.path.localeCompare(right.path));
    inputRevisionRequired = true;
  }
  const revised = buildManifest(revisedRaw, options.projectRoot);
  const compose = createSelfhostComposeOwner(revised.manifest);
  const composePlan = await compose.plan();
  const retryDigest = docmostApprovalDigest(revised, composePlan, account, options.runId);
  const recoveryIdentity = {
    schemaVersion: 1,
    kind: "docmost-postgres-parent-recovery",
    phase,
    project: project.id,
    runId: options.runId,
    inputDigest: hash(raw),
    priorComposePlanId: legacyPlan.planId,
    priorComposeFile: composeFile,
    retainedComposeFile,
    checkpoint,
    dockerState,
    databaseParent: {
      path: prepared.storage.database,
      dev: databaseMetadata.dev,
      ino: databaseMetadata.ino,
      uid: databaseMetadata.uid,
      gid: databaseMetadata.gid,
      mode: databaseMetadata.mode & 0o777,
    },
    wrapper,
    revisedInputDigest: hash(revisedRaw),
    nextComposePlanId: composePlan.planId,
  };
  const digest = hash(recoveryIdentity);
  return {
    revisedRaw,
    composePlan,
    priorComposeFile: composeFile,
    approval: `RECOVER-POSTGRES-PARENT:${project.id}:${digest}`,
    retryApproval: `APPLY:${project.id}:${retryDigest}`,
    wrapperStatus: wrapper.status,
    phase,
    inputRevisionRequired,
    retainedComposeFile,
  };
}

async function inspectPgdataRepair(raw: unknown, prepared: ReturnType<typeof buildManifest>, options: Options,
  statePath: string, handoffPath: string, account: Account, runtime: DocmostRuntime) {
  const project = prepared.manifest.project as Json;
  if (!prepared.rootless || project.dockerContext !== "rootless" || project.ownership !== "verified-existing") {
    fail("Docmost PGDATA repair requires the recovered verified-existing rootless project");
  }
  exactRecoveredObservations(raw, prepared, existsSync(prepared.postgresStartScript));

  const compose = createSelfhostComposeOwner(prepared.manifest);
  const composePlan = await compose.plan();
  const composeFile = composePlan.render.target;
  if (!existsSync(composeFile)) fail(`Docmost PGDATA repair requires the current rendered Compose file: ${composeFile}`);
  await inspectPrivateFile(composeFile, "Docmost current Compose file", MAX_INPUT);

  await inspectDirectory(dirname(dirname(statePath)), "Docmost CLI state");
  await inspectDirectory(dirname(statePath), "Docmost run state");
  await inspectDirectory(prepared.directory, "Docmost Compose directory");
  await inspectDirectory(join(prepared.directory, "data"), "Docmost data parent");
  await inspectDirectory(prepared.storage.attachments, "Docmost attachment directory");
  await inspectDirectory(prepared.storage.redis, "Docmost Redis directory", true);
  await inspectDirectory(join(prepared.directory, "secrets"), "Docmost secrets directory");
  await inspectPrivateFile(prepared.appSecret, "Docmost app secret", 64 * 1024);
  await inspectPrivateFile(prepared.databasePassword, "Docmost database password", 64 * 1024);
  await inspectPrivateFile(prepared.startScript, "Docmost start script", MAX_PRIVATE);
  await inspectPrivateFile(handoffPath, "Docmost private handoff", MAX_PRIVATE);
  if (await readFile(prepared.startScript, "utf8") !== START_SCRIPT) {
    fail("Docmost start script differs from the current approved run");
  }
  let wrapperProven = false;
  if (existsSync(prepared.postgresStartScript)) {
    await inspectPrivateFile(prepared.postgresStartScript, "Docmost PostgreSQL rootless start script", MAX_PRIVATE);
    if (await readFile(prepared.postgresStartScript, "utf8") !== prepared.postgresStartContent) {
      fail("Docmost PostgreSQL rootless start script differs from the current approved run");
    }
    wrapperProven = true;
  }

  const retryDigest = docmostApprovalDigest(prepared, composePlan, account, options.runId);
  let checkpoint: Json = { status: "absent" };
  if (existsSync(statePath)) {
    const saved = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), {
      projectId: project.id as string,
      runId: options.runId,
      directory: prepared.directory,
      handoffPath,
    });
    if (saved.health) fail("Docmost PGDATA repair refuses a healthy checkpoint");
    if (saved.approvalDigest !== retryDigest || saved.composeFile !== composeFile) {
      fail("Docmost PGDATA repair found a checkpoint for a different plan");
    }
    checkpoint = { status: "failed", digest: hash(saved) };
  }

  if (runtime.composePreflight) await runtime.composePreflight();
  else await compose.preflight(composePlan);
  const dockerState = inspectRootlessComposeProject(prepared, composeFile, true);
  const databaseMetadataReader = runtime.rootlessDirectoryMetadata ?? lstat;
  const databaseMetadata = await inspectPostgresDatabaseParent(
    prepared.storage.database,
    wrapperProven,
    databaseMetadataReader,
  );

  const versionDirectory = join(prepared.storage.database, "18");
  await ownedDirectory(versionDirectory, "Docmost PostgreSQL 18 directory", false);
  const versionMetadata = await lstat(versionDirectory);
  const pgdata = join(versionDirectory, "docker");
  const metadataReader = runtime.pgdataMetadata ?? lstat;
  const pgdataMetadata = await metadataReader(pgdata);
  if (!pgdataMetadata.isDirectory() || pgdataMetadata.isSymbolicLink() || await realpath(pgdata) !== pgdata
    || (pgdataMetadata.mode & 0o777) !== 0o700 || pgdataMetadata.dev !== versionMetadata.dev) {
    fail("Docmost PGDATA repair requires the exact inaccessible mode-0700 PostgreSQL directory");
  }
  const uid = process.getuid?.();
  if (!Number.isInteger(uid) || uid === 0 || pgdataMetadata.uid === uid || pgdataMetadata.uid === 0) {
    fail("Docmost PGDATA repair requires PGDATA to have an inaccessible non-host owner");
  }

  const repairIdentity = {
    schemaVersion: 1,
    kind: "docmost-pgdata-repair",
    project: project.id,
    runId: options.runId,
    inputDigest: hash(raw),
    composePlanId: composePlan.planId,
    composeFile,
    checkpoint,
    dockerState,
    databaseParent: {
      path: prepared.storage.database,
      dev: databaseMetadata.dev,
      ino: databaseMetadata.ino,
      uid: databaseMetadata.uid,
      gid: databaseMetadata.gid,
      mode: databaseMetadata.mode & 0o777,
    },
    versionDirectory: {
      path: versionDirectory,
      dev: versionMetadata.dev,
      ino: versionMetadata.ino,
      uid: versionMetadata.uid,
      gid: versionMetadata.gid,
      mode: versionMetadata.mode & 0o777,
    },
    pgdata: {
      path: pgdata,
      dev: pgdataMetadata.dev,
      ino: pgdataMetadata.ino,
      uid: pgdataMetadata.uid,
      gid: pgdataMetadata.gid,
      mode: pgdataMetadata.mode & 0o777,
    },
  };
  const digest = hash(repairIdentity);
  const quarantine = join(versionDirectory, `docker.quarantine.${digest.slice(0, 16)}`);
  if (existsSync(quarantine)) fail(`Docmost PGDATA quarantine already exists: ${quarantine}`);
  return {
    composePlan,
    composeFile,
    digest,
    approval: `REPAIR-PGDATA:${project.id}:${digest}`,
    retryApproval: `APPLY:${project.id}:${retryDigest}`,
    pgdata,
    quarantine,
    priorOwner: { uid: pgdataMetadata.uid, gid: pgdataMetadata.gid, mode: "0700" },
  };
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

function docmostApprovalDigest(prepared: ReturnType<typeof buildManifest>, composePlan: Json,
  account: Account, runId: string): string {
  const approvalInput: Json = { manifest: prepared.manifest, composePlan, account, runId, startScript: START_SCRIPT };
  if (prepared.rootless) approvalInput.postgresStartScript = prepared.postgresStartContent;
  return hash(approvalInput);
}

async function ensureHandoff(path: string, expected: { runId: string; projectId: string; account: Account; origin: string }): Promise<Handoff> {
  if (!existsSync(path)) {
    const handoff: Handoff = {
      schemaVersion: 1, kind: "docmost-private-handoff", runId: expected.runId,
      projectId: expected.projectId, account: expected.account, url: expected.origin,
      password: randomBytes(32).toString("hex"), appSecret: randomBytes(32).toString("hex"),
      databasePassword: randomBytes(32).toString("hex"), status: "first-owner-browser-required",
    };
    await writePrivate(path, `${JSON.stringify(handoff, null, 2)}\n`);
  }
  return handoffValid(await readJson(path, MAX_PRIVATE, true, "Docmost handoff"), expected);
}

async function health(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000), redirect: "error" });
    await response.body?.cancel();
    return response.status === 200;
  } catch { return false; }
}

async function healthAfterApply(origin: string): Promise<boolean> {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    if (await health(origin)) return true;
    if (attempt < 17) await delay(5000);
  }
  return false;
}

function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

// This export seam reads only adapter metadata and rendered configuration, never the
// private handoff, password file, database, or session payload.
async function databaseExportOwner(options: DocmostDbExportOptions): Promise<DocmostDbExportOwner> {
  const root = await projectRoot(options.projectRoot);
  if (!inside(root, options.input)) fail("--input must stay inside the selected project root");
  const prepared = buildManifest(await readJson(options.input, MAX_INPUT, false, "Docmost input"), root);
  const account = await readAccount(root, options.accountFile);
  const project = prepared.manifest.project;
  const stateDir = join(root, ".selfhost", "docmost", options.runId);
  await ownedDirectory(join(root, ".selfhost"), "Docmost metadata", true);
  await ownedDirectory(dirname(stateDir), "Docmost metadata", true);
  await ownedDirectory(stateDir, "Docmost run metadata", true);
  const checkpoint = checkpointValid(await readJson(join(stateDir, "state.json"), MAX_PRIVATE, true, "Docmost state"), {
    projectId: project.id, runId: options.runId, directory: prepared.directory, handoffPath: join(stateDir, "private-handoff.json"),
  });
  const compose = createSelfhostComposeOwner(prepared.manifest);
  const composePlan = await compose.plan();
  if (!checkpoint.health || checkpoint.composeFile !== composePlan.render.target
    || checkpoint.approvalDigest !== docmostApprovalDigest(prepared, composePlan, account, options.runId)) {
    fail("Database export requires the exact healthy applied Docmost adapter");
  }
  await ownedDirectory(prepared.directory, "Docmost Compose directory", true);
  await inspectPrivateFile(checkpoint.composeFile, "Docmost Compose file", MAX_INPUT);
  await compose.checkRendered(composePlan);
  const database = prepared.manifest.services.find((service: Json) => service.id === "database");
  const mounts = database.mounts.map((mount: Json) => ({ source: mount.source, target: mount.target, readOnly: mount.readOnly }));
  mounts.push({ source: prepared.databasePassword, target: "/run/secrets/docmost_db_password", readOnly: true });
  return { root, project: project.id, context: project.dockerContext, directory: prepared.directory,
    composeFile: checkpoint.composeFile, manifestHash: hash(prepared.manifest), checkpointHash: hash(checkpoint),
    composeHash: createHash("sha256").update(await readFile(checkpoint.composeFile)).digest("hex"),
    sourceImage: database.image, mounts };
}

export async function docmostCommand(args: string[], runtime: DocmostRuntime = {}): Promise<void> {
  if (args[0] === "db-export") {
    await docmostDbExportCommand(args.slice(1), databaseExportOwner, runtime.dbExport);
    return;
  }
  if (args[0] === "browser-password") {
    await docmostBrowserPassword(args.slice(1));
    return;
  }
  const options = parse(args);
  const root = await projectRoot(options.projectRoot);
  if (!inside(root, options.input)) fail("--input must stay inside the selected project root");
  const privateInput = options.action === "recover-plan" || options.action === "repair-pgdata-plan"
    || options.action === "repair-pgdata-apply" || options.action === "recover-postgres-parent-plan"
    || options.action === "recover-postgres-parent-apply";
  const raw = await readJson(options.input, MAX_INPUT, privateInput, "Docmost input");
  const prepared = buildManifest(raw, root);
  const projectId = prepared.manifest.project.id as string;
  const stateDir = join(root, ".selfhost", "docmost", options.runId);
  const statePath = join(stateDir, "state.json");
  const handoffPath = join(stateDir, "private-handoff.json");
  const ownerStatePath = join(stateDir, "owner-state.json");
  const checkpointIdentity = { projectId, runId: options.runId, directory: prepared.directory, handoffPath };

  if (options.action === "accept-plan" || options.action === "accept-apply" || options.action === "accept-status" || options.action === "accept-verify") {
    await docmostAcceptance(prepared, options, root, statePath, handoffPath, ownerStatePath, runtime);
    return;
  }

  if (options.action === "recover-plan") {
    const account = await readAccount(root, options.accountFile);
    let preCheckpointComposeFile = "";
    if (!existsSync(statePath)) preCheckpointComposeFile = await preRootlessComposeTarget(prepared);
    const recovery = await recoveryRevision(raw, prepared, options, statePath, handoffPath, preCheckpointComposeFile);
    const revisedRaw = recovery.revised;
    const revised = buildManifest(revisedRaw, root);
    const compose = createSelfhostComposeOwner(revised.manifest);
    const composePlan = await compose.plan();
    const digest = docmostApprovalDigest(revised, composePlan, account, options.runId);
    const approval = `APPLY:${projectId}:${digest}`;
    await replacePrivateJson(options.input, raw, revisedRaw);
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-recovery-plan", status: "pass",
      mutation: { inputRevised: true, docker: false }, project: projectId, runId: options.runId,
      url: revised.origin, account, compose: composePlan, approval, handoffPath,
      recovery: { input: options.input, ownership: "verified-existing", source: recovery.source,
        retainedData: true, retainedSecrets: true },
      checkpoint: "first-owner-browser-required",
      limits: ["The exact stopped rootless Compose project, service set, network, paths, and published port were inspected.",
        "No container was started or changed; apply still requires this new exact approval token.",
        "The first owner, page, attachment, and isolated restore remain unverified."] });
    return;
  }

  if (options.action === "recover-postgres-parent-plan" || options.action === "recover-postgres-parent-apply") {
    const account = await readAccount(root, options.accountFile);
    const recovery = await inspectPostgresParentRecovery(raw, prepared, options, statePath, handoffPath, account, runtime);
    if (options.action === "recover-postgres-parent-plan") {
      print({ schemaVersion: 1, kind: "docmost-v0.96.0-postgres-parent-recovery-plan", status: "pass", mutation: false,
        project: projectId, runId: options.runId, approval: recovery.approval,
        recovery: { phase: recovery.phase, priorComposeFile: recovery.priorComposeFile,
          retainedComposeFile: recovery.retainedComposeFile,
          wrapper: prepared.postgresStartScript, wrapperStatus: recovery.wrapperStatus,
          action: "prepare-rootless-postgres-parent-and-explicit-command" },
        retry: { action: "docmost apply", approval: recovery.retryApproval,
          composeFile: recovery.composePlan.render.target },
        limits: ["The exact stopped rootless project and prior immutable Compose target were inspected read-only.",
          "Apply creates only the non-secret mode-0600 wrapper and revises only the same owner-controlled input.",
          "Docker remains stopped until normal docmost apply receives its separate approval."] });
      return;
    }
    if (options.approval !== recovery.approval) {
      fail("Docmost PostgreSQL parent recovery apply requires the exact approval token from the unchanged plan");
    }
    await ensureExactFile(prepared.postgresStartScript, prepared.postgresStartContent,
      "Docmost PostgreSQL rootless start script");
    if (recovery.inputRevisionRequired) await replacePrivateJson(options.input, raw, recovery.revisedRaw);
    let wrapperCreated = false;
    if (recovery.wrapperStatus === "absent") wrapperCreated = true;
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-postgres-parent-recovery-apply", status: "recovered",
      mutation: { docker: false, wrapperCreated, wrapperVerified: true,
        inputRevised: recovery.inputRevisionRequired, dataChanged: false },
      project: projectId, runId: options.runId, wrapper: prepared.postgresStartScript,
      retry: { action: "docmost apply", approval: recovery.retryApproval,
        composeFile: recovery.composePlan.render.target },
      next: "Run normal docmost apply with the returned approval; it will render and apply the new immutable Compose target." });
    return;
  }

  if (options.action === "repair-pgdata-plan" || options.action === "repair-pgdata-apply") {
    const account = await readAccount(root, options.accountFile);
    const repair = await inspectPgdataRepair(raw, prepared, options, statePath, handoffPath, account, runtime);
    if (options.action === "repair-pgdata-plan") {
      print({ schemaVersion: 1, kind: "docmost-v0.96.0-pgdata-repair-plan", status: "pass", mutation: false,
        project: projectId, runId: options.runId, approval: repair.approval,
        repair: { source: repair.pgdata, quarantine: repair.quarantine, priorOwner: repair.priorOwner,
          action: "atomic-rename-and-create-empty-mode-0700" },
        retry: { action: "docmost apply", approval: repair.retryApproval, composeFile: repair.composeFile },
        limits: ["The plan inspected metadata only and did not read PostgreSQL data or secret payloads.",
          "The exact stopped rootless Compose project remains unchanged until repair-pgdata apply.",
          "The quarantine is retained permanently until the operator separately verifies acceptance and chooses a disposition."] });
      return;
    }
    if (options.approval !== repair.approval) {
      fail("Docmost PGDATA repair apply requires the exact approval token from the unchanged repair plan");
    }
    await rename(repair.pgdata, repair.quarantine);
    let freshCreated = false;
    try {
      await mkdir(repair.pgdata, { mode: 0o700 });
      freshCreated = true;
      await chmod(repair.pgdata, 0o700);
      await ownedDirectory(repair.pgdata, "fresh Docmost PGDATA", true);
      await syncDirectory(dirname(repair.pgdata));
    } catch (error) {
      if (freshCreated && existsSync(repair.pgdata) && (await readdir(repair.pgdata)).length === 0) {
        await rmdir(repair.pgdata);
      }
      if (!existsSync(repair.pgdata) && existsSync(repair.quarantine)) {
        try {
          await rename(repair.quarantine, repair.pgdata);
          await syncDirectory(dirname(repair.pgdata));
        }
        catch { fail(`Docmost PGDATA creation failed; preserved data remains at ${repair.quarantine}`); }
      }
      throw error;
    }
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-pgdata-repair-apply", status: "repaired",
      mutation: { docker: false, sourceRenamed: true, freshPgdataCreated: true, dataDeleted: false },
      project: projectId, runId: options.runId, pgdata: repair.pgdata, quarantine: repair.quarantine,
      retry: { action: "docmost apply", approval: repair.retryApproval, composeFile: repair.composeFile },
      rollback: `Stop ${projectId}; atomically rename the fresh PGDATA aside, then atomically rename ${repair.quarantine} back to ${repair.pgdata}.`,
      retained: "The quarantined PostgreSQL directory is never deleted automatically." });
    return;
  }

  if (options.action === "owner-status") {
    if (!existsSync(statePath)) {
      print({ schemaVersion: 1, kind: "docmost-v0.96.0-owner-status", project: projectId,
        runId: options.runId, recorded: false, status: "compose-not-applied" });
      return;
    }
    const checkpoint = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), checkpointIdentity);
    let owner: OwnerCheckpoint | null = null;
    if (existsSync(ownerStatePath)) {
      owner = ownerCheckpointValid(await readJson(ownerStatePath, MAX_PRIVATE, true, "Docmost owner checkpoint"), {
        projectId,
        runId: options.runId,
        origin: prepared.origin,
        composeApprovalDigest: checkpoint.approvalDigest,
        composeFile: checkpoint.composeFile,
      });
    }
    let status = "owner-pending";
    let method: OwnerCheckpoint["result"] | null = null;
    let freshLogin = false;
    if (owner) {
      status = "owner-recorded";
      method = owner.result;
      freshLogin = owner.freshLogin;
    }
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-owner-status", project: projectId,
      runId: options.runId, recorded: owner !== null, status, method, freshLogin,
      acceptance: "page-edit-attachment-fresh-client-and-restore-not-verified" });
    return;
  }

  if (options.action === "owner-plan" || options.action === "owner-apply") {
    const account = await readAccount(root, options.accountFile);
    const facts = await ownerPlanFacts(prepared, account, options.runId, statePath, handoffPath, ownerStatePath);
    if (options.action === "owner-plan") {
      print({ schemaVersion: 1, kind: "docmost-v0.96.0-owner-plan", status: "ready-for-approval", mutation: false,
        experimental: true, project: projectId, runId: options.runId, url: prepared.origin,
        owner: { name: account.name, email: account.email }, approval: facts.approval,
        alreadyRecorded: facts.prior !== null,
        request: { setup: "POST /api/auth/setup", loginProof: "POST /api/auth/login" },
        checkpoint: ownerStatePath,
        limits: [
          "This source-pinned Docmost Community route is not a supported public API contract.",
          "Apply sends the existing generated password only in bounded request bodies to the selected loopback origin; it never prints or stores cookies.",
          "A 403 setup response is accepted only when a fresh password login succeeds for this exact account.",
          "Browser fallback remains available if the API path fails.",
          "Page edit, attachment, fresh-client acceptance, Homarr attachment, and isolated restore remain separate gates.",
        ] });
      return;
    }
    if (options.approval !== facts.approval) {
      fail("Docmost owner apply requires the exact approval token from the unchanged owner plan");
    }
    const liveHealthy = runtime.health ? await runtime.health(prepared.origin) : await health(prepared.origin);
    if (!liveHealthy) fail("Docmost owner apply needs the selected loopback service to be healthy now; start its exact Compose project first");
    let fetcher = fetch;
    if (runtime.ownerFetch) fetcher = runtime.ownerFetch;
    const setup = await ownerPost(fetcher, prepared.origin, "/api/auth/setup", {
      name: account.name,
      email: account.email,
      password: facts.handoff.password,
    });
    let result: OwnerCheckpoint["result"];
    let workspace: OwnerCheckpoint["workspace"] = null;
    if (facts.prior) workspace = facts.prior.workspace;
    if (setup.status === 200) {
      if (!setup.cookie) fail("Docmost owner setup did not return the required session cookie; use the protected browser fallback");
      workspace = setupWorkspace(setup.body);
      result = "setup-created";
    } else if (setup.status === 403) {
      result = "existing-owner-login";
    } else {
      fail("Docmost owner setup returned an unexpected status; use the protected browser fallback");
    }
    const login = await ownerPost(fetcher, prepared.origin, "/api/auth/login", {
      email: account.email,
      password: facts.handoff.password,
    });
    if (login.status !== 200 || !login.cookie || !loginResponseValid(login.body)) {
      fail("Docmost fresh owner login failed; use the protected browser fallback");
    }
    const ownerCheckpoint: OwnerCheckpoint = {
      schemaVersion: 1,
      kind: "docmost-v0.96.0-owner-checkpoint",
      project: projectId,
      runId: options.runId,
      origin: prepared.origin,
      composeApprovalDigest: facts.checkpoint.approvalDigest,
      composeFile: facts.checkpoint.composeFile,
      accountDigest: facts.accountDigest,
      credentialDigest: facts.credentialDigest,
      approvalDigest: facts.approvalDigest,
      result,
      workspace,
      freshLogin: true,
      recordedAt: new Date().toISOString(),
    };
    await writeOwnerCheckpoint(ownerStatePath, ownerCheckpoint);
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-owner-apply", status: "owner-recorded",
      experimental: true, project: projectId, runId: options.runId, url: prepared.origin,
      result, freshLogin: true, checkpoint: ownerStatePath,
      acceptance: "page-edit-attachment-fresh-client-and-restore-not-verified",
      next: "Verify a fresh protected client login, page edit, attachment, Homarr tile, and isolated restore. Use browser fallback if any API behavior differs from v0.96.0 source." });
    return;
  }

  if (options.action === "up" || options.action === "down" || options.action === "lifecycle-check") {
    if (!existsSync(statePath)) fail("Docmost lifecycle needs the applied adapter checkpoint");
    const checkpoint = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), checkpointIdentity);
    const compose = createSelfhostComposeOwner(prepared.manifest);
    const composePlan = await compose.plan();
    const target = composePlan.render.target;
    if (checkpoint.composeFile !== target || !existsSync(target)) {
      fail("Docmost lifecycle checkpoint does not match the current exact Compose file");
    }
    if (options.action === "lifecycle-check") {
      if (runtime.composePreflight) await runtime.composePreflight();
      else await compose.preflight(composePlan);
    } else if (options.action === "up") {
      if (runtime.composeApply) await runtime.composeApply();
      else await compose.apply(composePlan);
    } else {
      if (runtime.composeStop) await runtime.composeStop();
      else await compose.stop(composePlan);
    }
    print({ schemaVersion: 1, kind: "docmost-bundle-lifecycle", action: options.action,
      project: projectId, runId: options.runId, composeFile: target, volumesDeleted: false, acceptance: "not-verified-by-cli" });
    return;
  }

  if (options.action === "status") {
    let checkpoint: { recorded: true; composeFile: string; healthAtApply: boolean; ownerSetup: string } | null = null;
    let owner: OwnerCheckpoint | null = null;
    if (existsSync(statePath)) {
      const saved = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), checkpointIdentity);
      checkpoint = { recorded: true, composeFile: saved.composeFile, healthAtApply: saved.health, ownerSetup: saved.ownerSetup };
      if (existsSync(ownerStatePath)) {
        owner = ownerCheckpointValid(await readJson(ownerStatePath, MAX_PRIVATE, true, "Docmost owner checkpoint"), {
          projectId,
          runId: options.runId,
          origin: prepared.origin,
          composeApprovalDigest: saved.approvalDigest,
          composeFile: saved.composeFile,
        });
      }
    }
    let endpointHealthy: boolean | null = null;
    if (checkpoint && runtime.health) endpointHealthy = await runtime.health(prepared.origin);
    else if (checkpoint) endpointHealthy = await health(prepared.origin);
    let ownerSetup = "api-or-browser-owner-required";
    let ownerMethod: OwnerCheckpoint["result"] | null = null;
    let ownerFreshLogin = false;
    if (owner) {
      ownerSetup = "api-owner-recorded";
      ownerMethod = owner.result;
      ownerFreshLogin = owner.freshLogin;
    }
    print({ schemaVersion: 1, kind: "docmost-cli-status", project: projectId, runId: options.runId,
      url: prepared.origin, health: endpointHealthy, checkpoint,
      ownerSetup,
      owner: { recorded: owner !== null, method: ownerMethod, freshLogin: ownerFreshLogin },
      acceptance: "not-verified-by-cli" });
    return;
  }

  const account = await readAccount(root, options.accountFile);
  const compose = createSelfhostComposeOwner(prepared.manifest);
  const composePlan = await compose.plan();
  const digest = docmostApprovalDigest(prepared, composePlan, account, options.runId);
  const approval = `APPLY:${projectId}:${digest}`;
  if (options.action === "plan") {
    print({ schemaVersion: 1, kind: "docmost-v0.96.0-cli-plan", status: "pass", mutation: false,
      project: projectId, runId: options.runId, url: prepared.origin, account,
      compose: composePlan, approval, handoffPath,
      checkpoint: "first-owner-browser-required",
      limits: ["All three image digests must be independently matched to the named version tags.",
        "The rootless context runs container UID/GID 0 inside its user namespace; an owner-only wrapper transfers only the PostgreSQL parent bind to mapped postgres before the official entrypoint. Rootful contexts retain the numeric non-root host identity.",
        "The first owner requires a separate exact API-owner plan and approval, with protected browser fallback.",
        "Health 200 is not page/attachment acceptance or an isolated restore."] });
    return;
  }
  if (options.approval !== approval) fail("Docmost apply requires the exact approval token from the unchanged plan");
  const target = composePlan.render.target;
  if (existsSync(statePath)) {
    const prior = checkpointValid(await readJson(statePath, MAX_PRIVATE, true, "Docmost state"), checkpointIdentity);
    const changedPlan = prior.approvalDigest !== digest || prior.composeFile !== target;
    if (prior.project !== projectId || prior.runId !== options.runId || (changedPlan && prior.health)) {
      fail("Existing Docmost checkpoint belongs to another plan");
    }
  }
  if (prepared.manifest.project.ownership === "verified-existing") {
    const input = object(raw, "Docmost input");
    const observed = object(input.observed, "observed");
    const postgresWrapperObserved = Array.isArray(observed.paths)
      && observed.paths.some((entry: unknown) => object(entry, "observed path").path === prepared.postgresStartScript);
    if (prepared.rootless && !postgresWrapperObserved) {
      fail("Verified-existing rootless Docmost requires recover-postgres-parent before apply");
    }
    const claimed = [prepared.directory, join(prepared.directory, "data"), ...Object.values(prepared.storage),
      join(prepared.directory, "secrets"), prepared.appSecret, prepared.databasePassword, prepared.startScript, handoffPath];
    if (prepared.rootless) claimed.push(prepared.postgresStartScript);
    if (claimed.some((path) => !existsSync(path))) {
      fail("Verified-existing Docmost resources are missing; inspect ownership and plan a separate adoption");
    }
  }
  await ensureStateRoot(root);
  await ensureDirectory(join(root, ".selfhost", "docmost"), "Docmost CLI state");
  await ensureDirectory(stateDir, "Docmost run state");
  await ensureDirectory(prepared.directory, "Docmost Compose directory");
  await compose.render(composePlan);
  await ensureDirectory(join(prepared.directory, "data"), "Docmost data parent");
  await ensureDirectory(prepared.storage.attachments, "Docmost attachment directory");
  if (prepared.rootless) {
    const metadataReader = runtime.rootlessDirectoryMetadata ?? lstat;
    await ensureRootlessManagedDirectory(prepared.storage.database, "Docmost database directory", metadataReader);
    await ensureRootlessManagedDirectory(prepared.storage.redis, "Docmost Redis directory", metadataReader);
  } else {
    await ensureDirectory(prepared.storage.database, "Docmost database directory");
    await ensureDirectory(prepared.storage.redis, "Docmost Redis directory");
  }
  await ensureDirectory(join(prepared.directory, "secrets"), "Docmost secrets directory");
  const handoff = await ensureHandoff(handoffPath, { runId: options.runId, projectId, account, origin: prepared.origin });
  await ensureExactFile(prepared.appSecret, `${handoff.appSecret}\n`, "Docmost app secret");
  await ensureExactFile(prepared.databasePassword, `${handoff.databasePassword}\n`, "Docmost database password");
  await ensureExactFile(prepared.startScript, START_SCRIPT, "Docmost start script");
  if (prepared.rootless) {
    await ensureExactFile(prepared.postgresStartScript, prepared.postgresStartContent,
      "Docmost PostgreSQL rootless start script");
  }
  if (runtime.composeApply) await runtime.composeApply();
  else await compose.apply(composePlan);
  let healthy: boolean;
  if (runtime.healthAfterApply) healthy = await runtime.healthAfterApply(prepared.origin);
  else healthy = await healthAfterApply(prepared.origin);
  const checkpoint = { schemaVersion: 1, project: projectId, runId: options.runId, approvalDigest: digest,
    composeFile: target, handoffPath, health: healthy, ownerSetup: "browser-evidence-required" };
  if (!existsSync(statePath)) await writePrivate(statePath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  else {
    const temporary = join(stateDir, `state.${randomBytes(8).toString("hex")}.tmp`);
    await writePrivate(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`);
    await rename(temporary, statePath);
  }
  let status = "applied-awaiting-owner";
  if (!healthy) status = "applied-health-pending";
  print({ schemaVersion: 1, kind: "docmost-cli-apply", status, project: projectId, runId: options.runId,
    url: prepared.origin, health: healthy, handoffPath, composeFile: target,
    checkpoint: "first-owner-browser-required", acceptance: "not-verified-by-cli",
    next: "Run docmost owner plan for the experimental v0.96.0 API checkpoint, or use the protected browser fallback; then verify fresh-client login, page edit, attachment, and isolated restore." });
  if (!healthy) process.exitCode = 3;
}
