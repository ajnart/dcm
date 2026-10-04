import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseMediaNetworkSubnets } from "./media-network-subnets.ts";
import { sharedCaddyRecoveryInventory } from "./caddy-private.ts";

type JsonObject = Record<string, any>;

type ServiceRecord = {
  input?: string;
  runId: string;
  accountFile?: string;
  httpsPlan?: string;
};

type Bundle = {
  schemaVersion: 1;
  id: string;
  projectRoot: string;
  services: {
    media: ServiceRecord;
    immich: ServiceRecord;
    docmost: ServiceRecord;
    vaultwarden: ServiceRecord;
  };
};

const MAX_JSON = 256 * 1024;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function fail(message: string): never {
  throw new Error(message);
}

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value as JsonObject;
}

function exact(value: JsonObject, fields: string[], name: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    fail(`${name} has unknown or missing fields`);
  }
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  if (path === "") return true;
  if (path === ".." || path.startsWith(`..${sep}`)) return false;
  return !isAbsolute(path);
}

function overlaps(left: string, right: string): boolean {
  return inside(left, right) || inside(right, left);
}

async function ownedProjectRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path || path === sep || path === resolve(homedir())) {
    fail("--project-root must be one exact absolute project path, not root or home");
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
    fail("Project root must be one real directory");
  }
  if ((metadata.mode & 0o002) !== 0) fail("Project root must not be world-writable");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail("Project root has a different owner");
  }
  return path;
}

async function readPrivateJson(root: string, path: string, name: string): Promise<JsonObject> {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(root, path)) {
    fail(`${name} must be one exact path inside the project root`);
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 2 || metadata.size > MAX_JSON || await realpath(path) !== path) {
    fail(`${name} must be one bounded regular file without links`);
  }
  if ((metadata.mode & 0o777) !== 0o600) fail(`${name} must use mode 0600`);
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    fail(`${name} has a different owner`);
  }
  try {
    return object(JSON.parse(await readFile(path, "utf8")), name);
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

function exactTarget(path: string | undefined, name: string, root: string): string {
  if (!path || !isAbsolute(path) || resolve(path) !== path || path === sep || path === resolve(homedir())) {
    fail(`${name} must be one exact absolute path, not root or home`);
  }
  if (overlaps(root, path)) fail(`${name} must be outside the protected project tree`);
  if (existsSync(path)) fail(`${name} must not already exist; this planner never reuses or replaces a target`);
  return path;
}

function ownedReference(root: string, path: string | undefined, name: string): string {
  if (!path || !isAbsolute(path) || resolve(path) !== path || !inside(root, path)) {
    fail(`${name} must be one exact path inside the project root`);
  }
  return path;
}

function service(value: unknown, fields: string[], name: string): ServiceRecord {
  const record = object(value, name);
  exact(record, fields, name);
  if (typeof record.runId !== "string" || !ID.test(record.runId)) fail(`${name} runId is invalid`);
  for (const field of fields.filter((field) => field !== "runId")) {
    if (field === "credentialHandoff" || field === "username" || field === "mode" || field === "bindMode" || field === "portStart" || field === "networkSubnets") continue;
    if (typeof record[field] !== "string") fail(`${name} ${field} must be a path`);
  }
  return record as ServiceRecord;
}

async function loadBundle(root: string, input: string): Promise<Bundle> {
  const value = await readPrivateJson(root, input, "bundle input");
  exact(value, ["schemaVersion", "id", "projectRoot", "services"], "bundle input");
  if (value.schemaVersion !== 1 || typeof value.id !== "string" || !ID.test(value.id)
    || value.projectRoot !== root) {
    fail("Bundle identity or project root is invalid");
  }
  const services = object(value.services, "bundle services");
  exact(services, ["media", "immich", "docmost", "vaultwarden"], "bundle services");
  const mediaValue = object(services.media, "media service");
  let mediaFields = ["runId", "username", "credentialHandoff"];
  if (Object.hasOwn(mediaValue, "mode")) mediaFields = [...mediaFields, "mode"];
  if (Object.hasOwn(mediaValue, "bindMode")) mediaFields = [...mediaFields, "bindMode"];
  if (Object.hasOwn(mediaValue, "portStart")) mediaFields = [...mediaFields, "portStart"];
  if (Object.hasOwn(mediaValue, "networkSubnets")) mediaFields = [...mediaFields, "networkSubnets"];
  const media = service(mediaValue, mediaFields, "media service");
  if (typeof mediaValue.username !== "string" || typeof mediaValue.credentialHandoff !== "boolean") {
    fail("Media service metadata is invalid");
  }
  if (mediaValue.mode !== undefined && mediaValue.mode !== "create" && mediaValue.mode !== "adopt") {
    fail("Media service mode is invalid");
  }
  if (mediaValue.bindMode !== undefined && mediaValue.bindMode !== "host-only") {
    fail("Media service bindMode is invalid");
  }
  if (mediaValue.portStart !== undefined && (typeof mediaValue.portStart !== "number" || !Number.isInteger(mediaValue.portStart)
    || mediaValue.portStart < 20000 || mediaValue.portStart > 44993)) {
    fail("Media service portStart is invalid");
  }
  if (mediaValue.networkSubnets !== undefined) parseMediaNetworkSubnets(mediaValue.networkSubnets);
  if (mediaValue.mode === "adopt" && (mediaValue.bindMode !== undefined || mediaValue.portStart !== undefined || mediaValue.networkSubnets !== undefined)) {
    fail("Adopted media keeps its existing bind, port, and network selection");
  }
  const immich = service(services.immich, ["input", "runId", "accountFile"], "Immich service");
  const docmost = service(services.docmost, ["input", "runId", "accountFile"], "Docmost service");
  const vaultwarden = service(services.vaultwarden, ["input", "runId", "accountFile", "httpsPlan"], "Vaultwarden service");
  ownedReference(root, immich.input, "Immich input");
  ownedReference(root, immich.accountFile, "Immich account file");
  ownedReference(root, docmost.input, "Docmost input");
  ownedReference(root, docmost.accountFile, "Docmost account file");
  ownedReference(root, vaultwarden.input, "Vaultwarden input");
  ownedReference(root, vaultwarden.accountFile, "Vaultwarden account file");
  ownedReference(root, vaultwarden.httpsPlan, "Vaultwarden HTTPS plan");
  return { schemaVersion: 1, id: value.id, projectRoot: root, services: { media, immich, docmost, vaultwarden } };
}

function project(input: JsonObject, root: string, runId: string, name: string) {
  const value = object(input.project, `${name} project`);
  if (value.id !== runId || value.root !== root || value.directory !== join(root, runId)
    || typeof value.dockerContext !== "string" || !value.dockerContext) {
    fail(`${name} project identity does not match its bundle record`);
  }
  return { id: runId, directory: value.directory as string, dockerContext: value.dockerContext as string };
}

function storagePath(value: unknown, expected: string, name: string): string {
  const storage = object(value, name);
  if (storage.path !== expected) fail(`${name} must use ${expected}`);
  return expected;
}

function stringRecord(value: unknown, name: string): Record<string, string> {
  const record = object(value, name);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string" || item.length === 0) fail(`${name} contains an invalid value`);
    result[key] = item;
  }
  return result;
}

function parse(args: string[]) {
  if (args[0] !== "plan") fail("Use bundle backup plan");
  const flags: Record<string, string> = {};
  const required = ["--project-root", "--input", "--backup-target", "--restore-target"];
  const allowed = new Set([...required, "--shared-caddy-input"]);
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || flags[name] || !value || value.startsWith("--")) {
      fail(`Invalid or repeated bundle backup option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  for (const name of required) {
    if (!flags[name]) fail(`bundle backup plan needs ${name}`);
  }
  return flags;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function bundleBackupCommand(args: string[]): Promise<void> {
  const flags = parse(args);
  const root = await ownedProjectRoot(flags["--project-root"]);
  const inputPath = flags["--input"];
  const bundle = await loadBundle(root, inputPath);
  const backupTarget = exactTarget(flags["--backup-target"], "--backup-target", root);
  const restoreTarget = exactTarget(flags["--restore-target"], "--restore-target", root);
  if (overlaps(backupTarget, restoreTarget)) {
    fail("--backup-target and --restore-target must be separate non-overlapping paths");
  }

  const immichInput = await readPrivateJson(root, bundle.services.immich.input as string, "Immich input");
  const docmostInput = await readPrivateJson(root, bundle.services.docmost.input as string, "Docmost input");
  const vaultwardenInput = await readPrivateJson(root, bundle.services.vaultwarden.input as string, "Vaultwarden input");
  const immichProject = project(immichInput, root, bundle.services.immich.runId, "Immich");
  const docmostProject = project(docmostInput, root, bundle.services.docmost.runId, "Docmost");
  const vaultwardenProject = project(vaultwardenInput, root, bundle.services.vaultwarden.runId, "Vaultwarden");
  let sharedCaddy: Awaited<ReturnType<typeof sharedCaddyRecoveryInventory>> | null = null;
  if (flags["--shared-caddy-input"]) {
    const directory = join(root, ".selfhost", "bundles", bundle.id);
    const caddyDirectory = join(directory, "caddy");
    const caddyInputPath = join(caddyDirectory, "shared-caddy.json");
    if (inputPath !== join(directory, "household-bundle.json") || flags["--shared-caddy-input"] !== caddyInputPath) {
      fail("--shared-caddy-input must select this exact bundle's generated caddy/shared-caddy.json");
    }
    const routeInput = await readPrivateJson(root, caddyInputPath, "Shared Caddy input");
    if (!Array.isArray(routeInput.routes) || routeInput.routes.length === 0 || routeInput.routes.length > 100) fail("Shared Caddy routes are invalid");
    for (const reference of routeInput.routes) {
      const route = object(reference, "Shared Caddy route reference");
      exact(route, ["planPath", "network"], "Shared Caddy route reference");
      if (typeof route.planPath !== "string" || dirname(route.planPath) !== caddyDirectory) {
        fail("Shared Caddy backup route plans must remain in this bundle's generated Caddy directory");
      }
      await readPrivateJson(root, route.planPath, "Shared Caddy route plan");
    }
    sharedCaddy = await sharedCaddyRecoveryInventory(root, caddyInputPath);
    const https = await readPrivateJson(root, bundle.services.vaultwarden.httpsPlan as string, "Vaultwarden HTTPS plan");
    if (https.routeOwner !== sharedCaddy.project || https.tlsOwner !== sharedCaddy.project
      || !sharedCaddy.routes.some((route) => route.service === "vaultwarden" && route.origin === https.origin)) {
      fail("Shared Caddy recovery inventory does not own the bundle's exact Vaultwarden HTTPS route");
    }
  }

  const immichStorage = object(immichInput.storage, "Immich storage");
  const immichUploads = storagePath(immichStorage.uploads, join(immichProject.directory, "data", "uploads"), "Immich uploads");
  const immichDatabase = storagePath(immichStorage.database, join(immichProject.directory, "data", "database"), "Immich database");
  const immichModelCache = storagePath(immichStorage.modelCache, join(immichProject.directory, "data", "model-cache"), "Immich model cache");

  const vaultwardenApps = object(vaultwardenInput.apps, "Vaultwarden apps");
  const vaultwardenApp = object(vaultwardenApps.vaultwarden, "Vaultwarden app");
  const vaultwardenStorage = object(vaultwardenApp.storage, "Vaultwarden storage");
  const vaultwardenData = storagePath(vaultwardenStorage.data, join(vaultwardenProject.directory, "data"), "Vaultwarden data");

  const bundleControlPaths = [
    inputPath,
    bundle.services.immich.input as string,
    bundle.services.immich.accountFile as string,
    bundle.services.docmost.input as string,
    bundle.services.docmost.accountFile as string,
    bundle.services.vaultwarden.input as string,
    bundle.services.vaultwarden.accountFile as string,
    bundle.services.vaultwarden.httpsPlan as string,
    join(dirname(inputPath), "private-handoff.env"),
  ];
  const sources = [
    {
      id: "media-session",
      service: "media",
      paths: [join(root, ".selfhost", "media-harness", ".sessions", bundle.services.media.runId)],
      dataClass: "configuration-user-data-credentials",
      consistency: { method: "quiesced-copy", scope: "stop all seven services in the exact media Compose project before copying the session tree" },
    },
    {
      id: "immich-durable",
      service: "immich",
      paths: [immichUploads, immichDatabase, join(immichProject.directory, "secrets")],
      dataClass: "user-data-database-credentials",
      consistency: { method: "quiesced-copy", scope: "stop Immich server, machine learning, Valkey, and PostgreSQL together before copying uploads, database, and secrets" },
    },
    {
      id: "docmost-durable",
      service: "docmost",
      paths: [join(docmostProject.directory, "data", "attachments"), join(docmostProject.directory, "data", "database"),
        join(docmostProject.directory, "data", "redis"), join(docmostProject.directory, "secrets")],
      dataClass: "user-data-database-credentials",
      consistency: { method: "quiesced-copy", scope: "stop Docmost, Redis, and PostgreSQL together before copying attachments, database, Redis AOF, and secrets" },
    },
    {
      id: "vaultwarden-durable",
      service: "vaultwarden",
      paths: [vaultwardenData, join(root, ".selfhost", "vaultwarden", bundle.services.vaultwarden.runId),
        join(root, ".selfhost", "household", ".sessions", bundle.services.vaultwarden.runId)],
      dataClass: "vault-database-attachments-credentials-state",
      consistency: { method: "quiesced-copy", scope: "stop the exact Vaultwarden service before copying its complete /data and owner-only CLI state" },
    },
    {
      id: "bundle-control",
      service: "bundle",
      paths: bundleControlPaths,
      dataClass: "configuration-account-metadata-optional-private-handoff",
      consistency: { method: "filesystem-copy", scope: "copy only after all four application groups are quiesced; absent optional handoff files must be recorded, not invented" },
    },
    {
      id: "docmost-cli-state",
      service: "docmost",
      paths: [join(root, ".selfhost", "docmost", bundle.services.docmost.runId)],
      dataClass: "credentials-checkpoint-state",
      consistency: { method: "filesystem-copy", scope: "copy after Docmost is quiesced" },
    },
    {
      id: "immich-cli-state",
      service: "immich",
      paths: [join(root, ".selfhost", "household", ".sessions", bundle.services.immich.runId)],
      dataClass: "credentials-state",
      consistency: { method: "filesystem-copy", scope: "copy after Immich is quiesced" },
    },
  ];
  const excluded = [
    { service: "immich", path: immichModelCache, reason: "rebuildable machine-learning cache" },
  ];
  if (sharedCaddy) {
    sources.push({ id: "shared-caddy-durable", service: "shared-caddy",
      paths: [sharedCaddy.configPath, sharedCaddy.dataPath, sharedCaddy.caddyfilePath, sharedCaddy.composeFile,
        sharedCaddy.stateDirectory, sharedCaddy.inputPath, ...sharedCaddy.routes.map((route) => route.planPath)],
      dataClass: "route-configuration-persistent-local-ca-private-key-checkpoint-state",
      consistency: { method: "quiesced-copy", scope: "stop only the exact shared-Caddy Compose project before capturing complete config/data and retained route control state; preserve the existing CA and private key" } });
  }
  const runtime: Record<string, unknown> = {
    media: { runId: bundle.services.media.runId, composeProject: `autostack-${bundle.services.media.runId}`,
      imageIdentity: "not pinned by the media bundle; record resolved image digests before capture" },
    immich: { ...immichProject, images: stringRecord(immichInput.images, "Immich images") },
    docmost: { ...docmostProject, images: stringRecord(docmostInput.images, "Docmost images") },
    vaultwarden: { ...vaultwardenProject, images: { vaultwarden: vaultwardenApp.image } },
  };
  if (sharedCaddy) runtime.sharedCaddy = sharedCaddy;
  if (typeof vaultwardenApp.image !== "string" || vaultwardenApp.image.length === 0) {
    fail("Vaultwarden image reference is invalid");
  }

  let routeCoverage = "uncovered; optional shared Caddy and client DNS/trust require a separate recovery plan";
  let routeGate = "The optional Caddy route, its CA, and client DNS/trust configuration are not included in this four-service data plan; re-establish them separately during recovery.";
  const routeCapture: string[] = [];
  const routeRestore: string[] = [];
  const routeRestart: string[] = [];
  if (sharedCaddy) {
    routeCoverage = "selected-shared-caddy-control-metadata-inventoried; capture-and-restore-not-verified";
    routeGate = "Selected shared Caddy paths are inventoried only; CA/private-key capture, isolated route restore, DNS, and intended-client trust remain unverified.";
    routeCapture.push("Review a separate shared-Caddy lifecycle approval and stop that exact route project before quiescing apps; keep it stopped until its complete persistence and control state are captured.");
    routeCapture.push("Include complete config/data with original CA/private keys, route plans, pinned image, Compose input, and checkpoint state in owner-only encrypted capture; record CA/key identity privately instead of automatically generating a replacement.");
    routeRestore.push("Restore complete shared-Caddy persistence and the original CA/private key into an isolated route project; do not regenerate CA/key material or reuse production mounts, networks, ports, or checkpoint paths.");
    routeRestore.push("Rewrite and validate route plan/config/state references for isolated upstreams, preserve recorded CA identity, and start the restored route only after restored apps are healthy under separately reviewed lifecycle approval.");
    routeRestore.push("Verify every isolated HTTPS origin with normal CA/hostname checks and intended-client DNS/trust separately; retained TLS observations or an exported root file are not current client-trust proof.");
    routeRestart.push("Restart the retained shared-Caddy route last with its own fresh lifecycle approval; verify every origin separately without reissuing its CA.");
  }
  const plan = {
    schemaVersion: 1,
    kind: "household-bundle-backup-plan",
    status: "blocked",
    planReady: true,
    mutation: false,
    bundle: bundle.id,
    projectRoot: root,
    targets: {
      backup: { path: backupTarget, role: "local-staging", sourceFailureDomainIndependent: false },
      restore: { path: restoreTarget, role: "isolated-restore", productionOverwriteAllowed: false },
    },
    sources,
    excluded,
    runtime,
    routeCoverage,
    captureSequence: [
      ...routeCapture,
      "Obtain a separate approval to quiesce only the four exact Compose projects recorded above.",
      "Confirm every included source exists, is not a symlink, and retains its expected owner and mode; record optional absent paths.",
      "Quiesce each consistency group and keep it stopped until every path in that group is captured.",
      "Create a new backup target without replacing, pruning, or deleting any existing path.",
      "Write a bounded manifest with relative paths, file types, modes, owners, sizes, and SHA-256 hashes, then fsync the captured files and manifest.",
      "Restart production only under its existing lifecycle approval and verify each adapter independently.",
      ...routeRestart,
    ],
    restorePrerequisites: [
      "The restore target must be absent, owner-approved, outside both the project and backup target, and created without following links.",
      "Verify the backup manifest, every SHA-256 hash, source coverage, ownership metadata, and the recorded application and schema versions before extraction.",
      "Use new Compose project IDs, networks, bind paths, and non-conflicting ports; never reuse the production bundle input unchanged.",
      "An adapter must rewrite and validate every restored bind source under the restore target before any restored container starts.",
      "Keep production paths mounted nowhere in the drill and refuse any overwrite, merge, prune, or in-place database restore.",
      "Run database integrity checks before application checks, then verify login plus media playback/request, photo upload/retrieval, Docmost page/attachment, and Vaultwarden vault unlock.",
      ...routeRestore,
      "Record elapsed restore time, exact source coverage, checksums, application results, and evidence references before claiming recovery verification.",
    ],
    blockedGates: [
      "No capture or restore adapter is implemented by this command; it performs no filesystem or Docker mutation.",
      "The local backup target shares an unverified failure domain with the source and does not satisfy independent off-host coverage.",
      "Encryption, recovery-key custody, retention, pruning policy, RPO/RTO, and failure notification owners remain unspecified.",
      "Media images are not pinned in the current bundle, so their resolved digests must be recorded before a reproducible capture.",
      "No isolated restore, integrity result, application acceptance, or measured RTO evidence has been supplied.",
      routeGate,
    ],
    verification: { backup: "not-verified", restore: "not-verified", durableCoverage: "blocked-local-target-only" },
    scope: "Deterministic read-only planning from the owner-controlled bundle inputs. This does not stop services, copy data, restore data, or approve destructive work.",
  };
  const planDigest = createHash("sha256").update(canonical(plan)).digest("hex");
  console.log(JSON.stringify({ ...plan, planDigest }, null, 2));
}
