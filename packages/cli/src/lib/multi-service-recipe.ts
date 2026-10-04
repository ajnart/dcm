import { createHash, randomBytes, randomInt } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { assertPrivatePath, ownedByCurrentUser, privateMode, protectPrivatePath } from "./platform-private.ts";
import { checkedPrivateConfigs, preparePrivateConfigs, readPreparedPrivateConfig } from "./private-config.ts";
import { checkedMutableConfigs, prepareMutableConfigs } from "./mutable-config.ts";
import { checkedPrivateConfigEnvironment, serializePrivateConfigEnvironment, isCanonicalPrivateBase64 } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-config-environment.ts";
import { checkedBootstrapCapability, generatedPrivateFileLength as privateFileLength, type GeneratedPrivateFileFormat as PrivateFileFormat } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-file.ts";
import { checkedManualJobRecipe } from "./manual-job.ts";
import { checkedPrivateDaemonRecipe } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-daemon.ts";
export { checkedPrivateDaemonRecipe } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/private-daemon.ts";
import { checkedConnectorRecipe } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/connector.ts";
import { containerHashReferencesAllowed, bcryptHashTemplateReferencesAllowed } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/config-hash-reference.ts";
import { matchesRecipeImagePin } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/recipe-image-reference.ts";
import { compileSharedRuntimeResources } from "./shared-runtime-resources.ts";
import { compileSharedOwnerDirectory, verifyOwnedDirectoryIdentity } from "./shared-owner-directory.ts";
import { ownerDirectoryFields } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/owner-directory.ts";
import { checkedDockerCliTlsRequest, dockerCliTlsClaim, dockerCliTlsTargets } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/docker-cli-tls.ts";
export { checkedConnectorRecipe } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/connector.ts";

function selectedContainerUid(): number {
  if (typeof process.getuid === "function") return process.getuid();
  return 1000;
}

function selectedContainerGid(): number {
  if (typeof process.getgid === "function") return process.getgid();
  return 1000;
}

type Entry = Record<string, any>;
const secretEnvironmentName = /PASS(?:WORD|WD)?|SECRET|TOKEN|CREDENTIAL|(?:API|AUTH)_?KEY|(?:^|_)KEY(?:_|$)|(?:^|_)(?:AUTH|COOKIE|DATABASE_URL|DSN|CONNECTION_STRING)(?:_|$)/i;

function secretEnvironmentValue(recipe: Entry, binding: Entry, value: string): string {
  if (recipe.privateFiles?.find((file: Entry) => file.id === binding.fileId)?.format === "base64") {
    throw new Error("Standard Base64 requires a reviewed private configuration or file input");
  }
  const keys = Object.keys(binding ?? {}).sort().join(",");
  if (keys === "fileId,format,jsonFields,name,officialUrl" && binding.format === "owner-json"
    && checkedConnectorRecipe(recipe)
    && recipe.privateFiles.some((file: Entry) => file.id === binding.fileId && file.source === "owner")
    && Array.isArray(binding.jsonFields) && binding.jsonFields.length > 0 && binding.jsonFields.length <= 16
    && new Set(binding.jsonFields).size === binding.jsonFields.length
    && binding.jsonFields.every((field: unknown) => typeof field === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field))) {
    requireContainerConfigEvidence(recipe, binding);
    return value;
  }
  if (keys === "fileId,name") return value;
  if (keys === "fileId,format,name,officialUrl" && binding.format === "owner-token"
    && checkedManualJobRecipe(recipe)
    && recipe.privateFiles.some((file: Entry) => file.id === binding.fileId && file.source === "owner")
    && typeof binding.officialUrl === "string" && binding.officialUrl.startsWith("https://")) return value;
  if (keys === "fileId,format,name" && binding.format === "bcrypt-hash"
    && /^[A-Z][A-Z0-9_]*_AUTH_HASH$/.test(binding.name)) return value;
  if (keys === "fileId,format,name" && binding.format === "ntfy-auth-users"
    && recipe.appId === "ntfy" && binding.name === "NTFY_AUTH_USERS"
    && binding.fileId === "admin-password") {
    return `admin:${value}:admin`;
  }
  if (keys !== "database,fileId,format,host,name,port,username"
    || binding.format !== "postgres-url" || binding.name !== "DATABASE_URL"
    || !/^[a-z][a-z0-9_]{0,62}$/.test(binding.username)
    || !/^[a-z][a-z0-9_]{0,62}$/.test(binding.database)
    || !recipe.services.some((service: Entry) => service.id === binding.host && service.id !== recipe.appId)
    || !Number.isInteger(binding.port) || binding.port < 1 || binding.port > 65535) {
    throw new Error("Recipe secret environment format is unsupported");
  }
  return `postgresql://${binding.username}:${value}@${binding.host}:${binding.port}/${binding.database}`;
}

function ntfyAuthBinding(recipe: Entry, service: Entry, binding: Entry): boolean {
  if (binding.format !== "ntfy-auth-users") return false;
  if (recipe.appId !== "ntfy" || service.id !== "ntfy"
    || binding.name !== "NTFY_AUTH_USERS" || binding.fileId !== "admin-password") {
    throw new Error("ntfy auth binding is invalid");
  }
  const policy = new Map(service.environment?.map((entry: Entry) => [entry.name, entry.value]));
  if (policy.get("NTFY_AUTH_FILE") !== "/var/lib/ntfy/user.db"
    || policy.get("NTFY_AUTH_DEFAULT_ACCESS") !== "deny-all") {
    throw new Error("ntfy private authentication policy is required");
  }
  return true;
}

function bcryptHashBinding(binding: Entry): boolean {
  return binding.format === "bcrypt-hash"
    && Object.keys(binding).sort().join(",") === "fileId,format,name"
    && /^[A-Z][A-Z0-9_]*_AUTH_HASH$/.test(binding.name);
}

type SelectedAdditionalPort = {
  id: string;
  serviceId: string;
  targetPort: number;
  protocol: "tcp" | "udp";
  purpose: string;
  published: number;
};

export type MultiServiceManifestInput = {
  recipe: Entry;
  images: Record<string, string>;
  projectId: string;
  appsRoot: string;
  projectDirectory: string;
  dataDirectory: string;
  dockerContext: string;
  port: number | null;
  publishedPorts?: Record<string, number>;
  hostPaths?: Record<string, string>;
  uid: number;
  gid: number;
  timezone?: string;
  homarrNetwork?: string;
  observed: { checkedAt: string; ports: Entry[]; paths: Entry[]; networks: Entry[]; volumes?: Entry[] };
};

export function pinnedMultiServiceImages(recipe: Entry, specifications: string[]): Record<string, string> {
  if (recipe.schemaVersion !== 2 || !Array.isArray(recipe.services)
    || specifications.length !== recipe.services.length) {
    throw new Error("Provide one --image SERVICE=TAG@sha256:DIGEST for each recipe service");
  }
  const images: Record<string, string> = {};
  for (const specification of specifications) {
    const separator = specification.indexOf("=");
    if (separator < 1) throw new Error("Each image must use SERVICE=TAG@sha256:DIGEST");
    const id = specification.slice(0, separator);
    const image = specification.slice(separator + 1);
    const service = recipe.services.find((candidate: Entry) => candidate.id === id);
    if (!service || Object.hasOwn(images, id)
      || !matchesRecipeImagePin(service.imageTag, image)) {
      throw new Error("Pinned image does not match one unique recipe service and tag");
    }
    images[id] = image;
  }
  return Object.fromEntries(recipe.services.map((service: Entry) => [service.id, images[service.id]]));
}

function selectedHostPaths(recipe: Entry, selections: Record<string, string> | undefined): Record<string, string> {
  const declared = new Set<string>();
  for (const service of recipe.services) {
    for (const mount of service.mounts) {
      if (mount.hostPath !== true) continue;
      if (typeof mount.name !== "string" || declared.has(mount.name)) {
        throw new Error("Selected host-path mount IDs must be unique and valid");
      }
      declared.add(mount.name);
    }
  }
  const selected = selections ?? {};
  if (!selected || typeof selected !== "object" || Array.isArray(selected)
    || Object.keys(selected).length !== declared.size
    || Object.keys(selected).some((id) => !declared.has(id))) {
    throw new Error("Provide one selected absolute host path for every declared host-path mount");
  }
  const paths: Record<string, string> = {};
  for (const id of declared) {
    const path = selected[id];
    let segments: string[] = [];
    if (typeof path === "string") segments = path.split(/[\\/]/).filter(Boolean);
    const windowsHost = process.platform === "win32";
    if (typeof path !== "string" || path.length > 1024 || /[\r\n\u0000-\u001f\u007f]/.test(path)
      || !isAbsolute(path) || (!windowsHost && path.includes("\\"))
      || (windowsHost && !/^[A-Za-z]:\\/.test(path))
      || normalize(path) !== path || resolve(path) !== path || path === "/" || /[\\/]$/.test(path)
      || segments.length < 2 || ["/proc", "/sys", "/dev", "/run", "/var/run", "/var/lib/docker"]
        .some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
      || /(?:^|[\\/])(?:\.ssh|\.gnupg|\.aws|\.kube|\.docker)(?:[\\/]|$)/i.test(path)) {
      throw new Error("Selected host paths must be normalized, specific native host paths outside protected host data");
    }
    paths[id] = path;
  }
  return paths;
}

function bindSource(mount: Entry, hostPaths: Record<string, string>, dataDirectory: string): string {
  if (mount.kind === "mutable-directory") return join(dataDirectory, "mutable-configs", mount.fileId);
  if (mount.kind === "generated-file") return join(dataDirectory, "config-files", mount.fileId);
  if (mount.hostPath === true) return hostPaths[mount.name];
  return join(dataDirectory, mount.name);
}

type GeneratedConfigFile = { content: string; mode: number };

function requireContainerConfigEvidence(recipe: Entry, file: Entry): void {
  let evidence: URL;
  try { evidence = new URL(file.officialUrl); }
  catch { throw new Error("Container-readable config needs an official publisher source"); }
  if (evidence.protocol !== "https:" || evidence.username || evidence.password
    || typeof recipe.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe.appId)) {
    throw new Error("Container-readable config needs an official publisher source");
  }
  const own = new URL(import.meta.url);
  let manifest = new URL(`./workflows/selfhost/references/catalog/apps/${recipe.appId}/manifest.json`, own);
  if (own.pathname.endsWith(".ts")) {
    manifest = new URL(`../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/${recipe.appId}/manifest.json`, own);
  }
  const path = fileURLToPath(manifest);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.size < 1 || metadata.size > 512 * 1024 || (metadata.mode & 0o002) !== 0
    || realpathSync(path) !== path) {
    throw new Error("Container-readable config publisher record is unsafe");
  }
  let app: Entry;
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (before.dev !== metadata.dev || before.ino !== metadata.ino || before.size !== metadata.size
      || before.nlink !== 1 || (before.mode & 0o002) !== 0) {
      throw new Error("Container-readable config publisher record changed");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const named = lstatSync(path);
    if (bytes.length !== before.size || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || named.dev !== before.dev || named.ino !== before.ino || named.nlink !== 1) {
      throw new Error("Container-readable config publisher record changed");
    }
    app = JSON.parse(bytes.toString("utf8"));
  } finally { closeSync(descriptor); }
  if (app.id !== recipe.appId || !Array.isArray(app.sources)
    || ![app.upstream?.repository, ...app.sources].includes(recipe.source)
    || !app.sources.includes(file.officialUrl)) {
    throw new Error("Container-readable config evidence must be an exact listed app publisher source");
  }
}

function checkedConfigFiles(recipe: Entry): Map<string, GeneratedConfigFile> {
  const files = new Map<string, GeneratedConfigFile>();
  if (recipe.configFiles === undefined) return files;
  if (!Array.isArray(recipe.configFiles) || recipe.configFiles.length < 1 || recipe.configFiles.length > 8) {
    throw new Error("Recipe generated config files are invalid");
  }
  for (const file of recipe.configFiles) {
    const bcryptNames = new Set(recipe.services.filter((service: Entry) =>
      service.mounts.some((mount: Entry) => mount.kind === "generated-file" && mount.fileId === file.id))
      .flatMap((service: Entry) => (service.secretEnvironment ?? [])
        .filter(bcryptHashBinding).map((entry: Entry) => entry.name)));
    let expectedKeys = "content,id";
    let mode = 0o600;
    if (file?.readability !== undefined) {
      expectedKeys = "content,id,officialUrl,readability";
      if (file.readability !== "container") throw new Error("Generated config readability is unsupported");
      requireContainerConfigEvidence(recipe, file);
      mode = 0o644;
    }
    if (Object.keys(file ?? {}).sort().join(",") !== expectedKeys
      || typeof file.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(file.id)
      || files.has(file.id) || typeof file.content !== "string" || file.content.length === 0
      || Buffer.byteLength(file.content, "utf8") > 16384
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(file.content)
      || /\$\{|\$\(|<%|%>/.test(file.content)
      || (file.content.includes("{{") && !bcryptHashTemplateReferencesAllowed(file.content, bcryptNames))
      || (mode === 0o644 && !containerHashReferencesAllowed(file.content, bcryptNames))
      || (mode === 0o644 && /process\s*\.\s*env\s*(?:\.\s*[A-Z][A-Z0-9_]*_AUTH_HASH\b|\[\s*["'][A-Z][A-Z0-9_]*_AUTH_HASH["']\s*\])/.test(file.content))
      || [...file.content.matchAll(/(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key)\s*[:=]\s*([^\s,;}]+)/gi)]
        .some((match) => {
          const reference = /^process\.env\.([A-Z][A-Z0-9_]*_AUTH_HASH)$/.exec(match[1]);
          return reference === null || !bcryptNames.has(reference[1]);
        })
      || /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(file.content)) {
      throw new Error("Recipe generated config must be bounded, literal, and non-secret");
    }
    files.set(file.id, { content: file.content, mode });
  }
  return files;
}

/** Public review labels contain provenance and readability, never configuration bytes. */
export function generatedConfigReadability(recipe: Entry): Array<{
  fileId: string; readability: "container"; mode: "0644"; officialUrl: string;
}> {
  checkedConfigFiles(recipe);
  return (recipe.configFiles ?? []).filter((file: Entry) => file.readability === "container")
    .map((file: Entry) => ({ fileId: file.id, readability: "container", mode: "0644", officialUrl: file.officialUrl }));
}

function checkedPrivateConfigBindings(recipe: Entry) {
  const configs = checkedPrivateConfigs(recipe);
  const used = new Set<string>();
  for (const service of recipe.services) {
    if (service.privateConfigFiles !== undefined && (!Array.isArray(service.privateConfigFiles)
      || service.privateConfigFiles.length < 1 || service.privateConfigFiles.length > 8)) {
      throw new Error("Private configuration bindings are invalid");
    }
    for (const id of service.privateConfigFiles ?? []) {
      if (!configs.has(id) || used.has(id)
        || service.fileEnvironment?.some((binding: Entry) => binding.fileId === id && binding.format !== "private-config-path")) {
        throw new Error("Private configuration requires one exact service binding");
      }
      used.add(id);
    }
    for (const binding of service.fileEnvironment ?? []) {
      if (binding.format !== "private-config-path") continue;
      const config = configs.get(binding.fileId);
      if (Object.keys(binding).sort().join(",") !== "fileId,format,name,officialUrl"
        || !/^[A-Z][A-Z0-9_]*$/.test(binding.name) || !config
        || !service.privateConfigFiles?.includes(config.id) || binding.officialUrl !== config.officialUrl) {
        throw new Error("Private configuration path requires its exact consuming service and publisher evidence");
      }
      requireContainerConfigEvidence(recipe, binding);
    }
    for (const binding of service.secretEnvironment ?? []) {
      if (binding.format !== "private-config") continue;
      const config = checkedPrivateConfigEnvironment(binding, configs);
      if (used.has(config.id)) throw new Error("Private configuration requires one exact service binding");
      used.add(config.id);
    }
  }
  if (used.size !== configs.size) throw new Error("Every private configuration needs one service binding");
  return configs;
}

function checkedGeneratedMount(mount: Entry, files: Map<string, GeneratedConfigFile>): void {
  if (Object.keys(mount ?? {}).sort().join(",") !== "fileId,kind,name,target"
    || !files.has(mount.fileId) || typeof mount.name !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mount.name)
    || typeof mount.target !== "string" || !/^\/[a-zA-Z0-9/_.-]+$/.test(mount.target)
    || mount.target.includes("//") || mount.target.endsWith("/")
    || mount.target.split("/").includes(".") || mount.target.split("/").includes("..")) {
    throw new Error("Recipe generated-file mount is invalid");
  }
}

function selectedAdditionalPorts(recipe: Entry, selections: Record<string, number> | undefined,
  primaryPort: number | null): SelectedAdditionalPort[] {
  const descriptors = new Map<string, { serviceId: string; descriptor: Entry }>();
  for (const service of recipe.services) {
    const serviceTargets = new Set<string>();
    if (Number.isInteger(service.publishTargetPort) && service.publishTargetPort >= 1
      && service.publishTargetPort <= 65535) serviceTargets.add(`tcp:${service.publishTargetPort}`);
    for (const descriptor of service.additionalPorts ?? []) {
      if (typeof descriptor.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(descriptor.id)
        || descriptors.has(descriptor.id)) {
        throw new Error("Additional published-port descriptor IDs must be unique");
      }
      if (!Number.isInteger(descriptor.targetPort) || descriptor.targetPort < 1
        || descriptor.targetPort > 65535 || !["tcp", "udp"].includes(descriptor.protocol)
        || !["admin", "application", "database", "management", "docker-api"].includes(descriptor.purpose)
        || typeof descriptor.required !== "boolean"
        || typeof service.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(service.id)
        || serviceTargets.has(`${descriptor.protocol}:${descriptor.targetPort}`)) {
        throw new Error("Additional published-port descriptors must be bounded app-service ports");
      }
      serviceTargets.add(`${descriptor.protocol}:${descriptor.targetPort}`);
      descriptors.set(descriptor.id, { serviceId: service.id, descriptor });
    }
  }
  const selected = selections ?? {};
  if (!selected || typeof selected !== "object" || Array.isArray(selected)
    || Object.keys(selected).some((id) => !descriptors.has(id))) {
    throw new Error("Selected published ports must match declared additional-port IDs");
  }
  for (const [id, value] of descriptors) {
    if (value.descriptor.required === true && !Object.hasOwn(selected, id)) {
      throw new Error(`Required additional published port ${id} needs an explicit host-port selection`);
    }
  }
  const hostPorts = new Set([`tcp:${primaryPort}`]);
  const ports: SelectedAdditionalPort[] = [];
  for (const [id, published] of Object.entries(selected)) {
    const entry = descriptors.get(id);
    if (!entry || !Number.isInteger(published) || published < 1024 || published > 65535
      || !Number.isInteger(entry.descriptor.targetPort) || entry.descriptor.targetPort < 1
      || entry.descriptor.targetPort > 65535 || !["tcp", "udp"].includes(entry.descriptor.protocol)
      || !["admin", "application", "database", "management", "docker-api"].includes(entry.descriptor.purpose)
      || typeof entry.descriptor.required !== "boolean") {
      throw new Error("Selected published port does not match a valid recipe descriptor and private host port");
    }
    const hostKey = `${entry.descriptor.protocol}:${published}`;
    if (hostPorts.has(hostKey)) {
      throw new Error("Selected published host ports must be unique per protocol");
    }
    hostPorts.add(hostKey);
    ports.push({ id, serviceId: entry.serviceId, targetPort: entry.descriptor.targetPort,
      protocol: entry.descriptor.protocol, purpose: entry.descriptor.purpose, published });
  }
  return ports;
}

export async function privateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
    protectPrivatePath(path, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const metadata = await lstat(path);
  assertPrivatePath(path, 0o700);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
    || !ownedByCurrentUser(metadata) || !privateMode(metadata, 0o700)) {
    throw new Error("Multi-service data and secret directories must be current-user-owned mode-0700 real directories");
  }
}

async function verifyGeneratedConfigFile(target: string, content: string, mode: number): Promise<void> {
  const metadata = await lstat(target);
  assertPrivatePath(target, mode);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || !ownedByCurrentUser(metadata) || !privateMode(metadata, mode)
    || metadata.size !== Buffer.byteLength(content) || await realpath(target) !== target) {
    throw new Error("Generated config file is not intact with its reviewed readability");
  }
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (current.dev !== metadata.dev || current.ino !== metadata.ino
      || current.nlink !== 1 || !ownedByCurrentUser(current)
      || !privateMode(current, mode) || current.size !== metadata.size
      || await handle.readFile("utf8") !== content) {
      throw new Error("Generated config file differs from the reviewed recipe");
    }
    const after = await handle.stat();
    const named = await lstat(target);
    if (await realpath(target) !== target) {
      throw new Error("Generated config file path changed during inspection");
    }
    for (const inspected of [after, named]) {
      if (!inspected.isFile() || inspected.dev !== metadata.dev || inspected.ino !== metadata.ino
        || inspected.nlink !== 1 || !ownedByCurrentUser(inspected)
        || !privateMode(inspected, mode) || inspected.size !== metadata.size
        || inspected.mtimeMs !== metadata.mtimeMs || inspected.ctimeMs !== metadata.ctimeMs) {
        throw new Error("Generated config file changed during inspection");
      }
    }
  } finally { await handle.close(); }
}

/** Read-only setup prerequisite; never repair changed files or read private configs. */
export async function verifySharedGeneratedConfigFiles(recipe: Entry, projectDirectory: string): Promise<void> {
  const files = checkedConfigFiles(recipe);
  if (files.size === 0) return;
  if (recipe.schemaVersion !== 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recipe.appId)
    || !isAbsolute(projectDirectory) || resolve(projectDirectory) !== projectDirectory) {
    throw new Error("Generated config verification needs one exact shared app directory");
  }
  const data = join(projectDirectory, "data");
  const app = join(data, recipe.appId);
  const directory = join(app, "config-files");
  for (const path of [projectDirectory, data, app, directory]) {
    const metadata = await lstat(path);
    assertPrivatePath(path, 0o700);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path
      || !ownedByCurrentUser(metadata) || !privateMode(metadata, 0o700)) {
      throw new Error("Generated config verification needs intact owner-only directories");
    }
  }
  for (const [id, { content, mode }] of files) {
    await verifyGeneratedConfigFile(join(directory, id), content, mode);
  }
}

async function privateFile(path: string, bytes: number, format: PrivateFileFormat, bootstrapCapability = false): Promise<void> {
  let expectedLength = 32;
  if (!bootstrapCapability) expectedLength = privateFileLength(bytes, format);
  if (bootstrapCapability && (bytes !== 16 || format !== "hex")) {
    throw new Error("Bootstrap capability generation contract is invalid");
  }
  if (!bootstrapCapability && (!Number.isInteger(bytes) || bytes < 32 || bytes > 128)) {
    throw new Error("Multi-service private file length is outside the supported range");
  }
  if (format !== "base64url" && format !== "alphanumeric" && format !== "hex"
    && format !== "base64-prefixed" && format !== "base64") {
    throw new Error("Multi-service private file format is unsupported");
  }
  try {
    const handle = await open(path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      protectPrivatePath(path, 0o600);
      let value = "";
      if (format === "base64url") {
        value = randomBytes(bytes).toString("base64url");
      } else if (format === "base64-prefixed") {
        value = `base64:${randomBytes(bytes).toString("base64")}`;
      } else if (format === "base64") {
        value = randomBytes(bytes).toString("base64");
      } else if (format === "hex") {
        value = randomBytes(bytes).toString("hex");
      } else {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let index = 0; index < privateFileLength(bytes, format); index += 1) {
          value += alphabet[randomInt(alphabet.length)];
        }
      }
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const metadata = await lstat(path);
  assertPrivatePath(path, 0o600);
  if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path
    || !ownedByCurrentUser(metadata) || metadata.nlink !== 1
    || !privateMode(metadata, 0o600)
    || metadata.size !== expectedLength) {
    throw new Error("Multi-service private file must be one intact current-user-owned mode-0600 file");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.dev !== metadata.dev || current.ino !== metadata.ino
      || current.nlink !== 1 || !ownedByCurrentUser(current)
      || !privateMode(current, 0o600)) {
      throw new Error("Multi-service private file changed during format inspection");
    }
    const value = await handle.readFile("utf8");
    let pattern = /^[A-Za-z0-9_-]+$/;
    if (format === "alphanumeric") pattern = /^[A-Za-z0-9]+$/;
    if (format === "hex") pattern = /^[0-9a-f]+$/;
    if (format === "base64-prefixed") pattern = /^base64:(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if ((format === "base64" && !isCanonicalPrivateBase64(value, bytes))
      || (format !== "base64" && !pattern.test(value))) {
      throw new Error("Multi-service private file content does not match its declared format");
    }
  } finally {
    await handle.close();
  }
}

/** A native once-returned password replaces a generated placeholder, never its saved owner.
 * Only the pinned Stalwart adapter's private capture receipt permits its exact 16-character format. */
function capturedStalwartAdministrator(recipe: Entry, directory: string, file: Entry): boolean {
  if (recipe.appId !== "stalwart-mail" || file.id !== "admin-password") return false;
  const receipt = join(directory, "stalwart-administrator-capture.json");
  if (!existsSync(receipt)) return false;
  if (file.source !== undefined || file.format !== "alphanumeric"
    || recipe.onboarding?.kind !== "manual-first-email" || recipe.onboarding?.fileId !== file.id
    || recipe.onboarding?.officialUrl !== "https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs"
    || recipe.services?.length !== 1 || recipe.services[0]?.imageTag !== "stalwartlabs/stalwart:v0.16.24") {
    throw new Error("Captured Stalwart administrator differs from its pinned recipe");
  }
  function read(path: string): string {
    const metadata = lstatSync(path);
    assertPrivatePath(path, 0o600);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || !ownedByCurrentUser(metadata)
      || !privateMode(metadata, 0o600) || metadata.size < 1 || metadata.size > 4096 || realpathSync(path) !== path) {
      throw new Error("Captured Stalwart administrator metadata is unsafe");
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      if (before.dev !== metadata.dev || before.ino !== metadata.ino || before.size !== metadata.size
        || before.nlink !== 1 || before.uid !== metadata.uid || before.mode !== metadata.mode) throw new Error("Captured Stalwart administrator changed during inspection");
      const value = readFileSync(fd, "utf8");
      const after = fstatSync(fd), named = lstatSync(path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || after.dev !== named.dev || after.ino !== named.ino || realpathSync(path) !== path) throw new Error("Captured Stalwart administrator changed during inspection");
      return value;
    } finally { closeSync(fd); }
  }
  const value = JSON.parse(read(receipt));
  const password = read(join(directory, file.id));
  if (Object.keys(value).sort().join(",") !== "appId,identity,kind,projectId,schemaVersion,secretSha256,selectionFingerprint"
    || value.schemaVersion !== 1 || value.appId !== recipe.appId || value.kind !== "administrator"
    || value.identity !== recipe.onboarding.email || typeof value.projectId !== "string"
    || basename(directory) !== "stalwart-mail" || basename(dirname(directory)) !== "secrets"
    || basename(dirname(dirname(directory))) !== value.projectId
    || !/^[a-f0-9]{64}$/.test(value.selectionFingerprint ?? "")
    || !/^[A-Za-z0-9]{16}$/.test(password)
    || createHash("sha256").update(JSON.stringify(password)).digest("hex") !== value.secretSha256) {
    throw new Error("Captured Stalwart administrator receipt differs from its private credential or recipe identity");
  }
  return true;
}

export async function prepareMultiServiceFiles(recipe: Entry, projectDirectory: string,
  dataDirectory: string, hostPaths?: Record<string, string>, appScope?: string,
  ownerSecrets: Record<string, Buffer> = {}, initializeMutable = true,
  ownerIdentity?: { uid: number; gid: number }): Promise<void> {
  if (recipe.schemaVersion !== 2 || !Array.isArray(recipe.services)
    || !Array.isArray(recipe.privateFiles)) {
    throw new Error("Expected one validated multi-service catalog recipe");
  }
  selectedHostPaths(recipe, hostPaths);
  const configFiles = checkedConfigFiles(recipe);
  const privateConfigs = checkedPrivateConfigBindings(recipe);
  checkedMutableConfigs(recipe);
  const mountedConfigFiles = new Set<string>();
  for (const service of recipe.services) {
    for (const mount of service.mounts) {
      if (mount.kind !== "generated-file") continue;
      checkedGeneratedMount(mount, configFiles);
      if (mountedConfigFiles.has(mount.fileId)) throw new Error("Generated config may be mounted only once");
      mountedConfigFiles.add(mount.fileId);
    }
  }
  if (mountedConfigFiles.size !== configFiles.size) throw new Error("Every generated config needs one mount");
  if (appScope !== undefined
    && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appScope)
      || dataDirectory !== join(projectDirectory, "data", appScope))) {
    throw new Error("Shared-project private files need one exact app-scoped data directory");
  }
  await privateDirectory(projectDirectory);
  if (appScope !== undefined) await privateDirectory(join(projectDirectory, "data"));
  await privateDirectory(dataDirectory);
  const names = new Set<string>();
  for (const service of recipe.services) {
    for (const mount of service.mounts) {
      if (mount.kind === "mutable-directory") continue;
      if (mount.kind === "generated-file") {
        checkedGeneratedMount(mount, configFiles);
        continue;
      }
      if (typeof mount.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mount.name)) {
        throw new Error("Multi-service mount name is invalid");
      }
      if (configFiles.size > 0 && mount.name === "config-files") {
        throw new Error("config-files is reserved for generated project configuration");
      }
      if (mount.kind !== "volume" && mount.hostPath !== true) names.add(mount.name);
    }
  }
  for (const name of [...names].sort()) await privateDirectory(join(dataDirectory, name));
  for (const service of recipe.services) {
    if (service.ownerDirectory === undefined) continue;
    if (appScope !== recipe.appId || service.user !== "host-selected" || !ownerIdentity
      || ownerIdentity.uid !== selectedContainerUid() || ownerIdentity.gid !== selectedContainerGid()) throw new Error("Owned stack directories require one exact shared app and numeric host identity");
    const fields = ownerDirectoryFields(projectDirectory, recipe.appId);
    await privateDirectory(fields.path);
    verifyOwnedDirectoryIdentity(projectDirectory, recipe.appId, `${ownerIdentity.uid}:${ownerIdentity.gid}`, ownerIdentity.uid, ownerIdentity.gid);
  }
  if (configFiles.size > 0) {
    const configDirectory = join(dataDirectory, "config-files");
    await privateDirectory(configDirectory);
    for (const [id, { content, mode }] of configFiles) {
      const target = join(configDirectory, id);
      try {
        const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
        try {
          // Windows ACLs precede payload writes; Unix readability is descriptor-owned.
          if (process.platform === "win32") protectPrivatePath(target, mode);
          else if (mode === 0o644) await handle.chmod(mode);
          await handle.writeFile(content); await handle.sync();
        } finally { await handle.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      await verifyGeneratedConfigFile(target, content, mode);
    }
  }
  const secrets = join(projectDirectory, "secrets");
  await privateDirectory(secrets);
  const fileDirectory = appScope === undefined ? secrets : join(secrets, appScope);
  if (appScope !== undefined) await privateDirectory(fileDirectory);
  const ownerFiles = recipe.privateFiles.filter((file: Entry) => file.source === "owner");
  const bootstrapCapability = checkedBootstrapCapability(recipe);
  if (Object.keys(ownerSecrets).some((id) => !ownerFiles.some((file: Entry) => file.id === id))) {
    throw new Error("Owner secret input does not match a declared private file");
  }
  for (const file of recipe.privateFiles) {
    if (typeof file.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(file.id)) {
      throw new Error("Multi-service private file name is invalid");
    }
    if (file.source !== "owner") {
      if (capturedStalwartAdministrator(recipe, fileDirectory, file)) continue;
      await privateFile(join(fileDirectory, file.id), file.bytes, file.format ?? "base64url", file === bootstrapCapability);
      continue;
    }
    if (!Number.isInteger(file.maxBytes) || file.maxBytes < 1 || file.maxBytes > 16384) {
      throw new Error("Owner secret size contract is invalid");
    }
    const target = join(fileDirectory, file.id);
    const input = ownerSecrets[file.id];
    if (!input && !existsSync(target)) throw new Error("Owner secret is required before Docker apply");
    if (input && (input.length < 1 || input.length > file.maxBytes)) {
      throw new Error("Owner secret size is outside its declared range");
    }
    try {
      const handle = await open(target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        if (!input) throw new Error("Owner secret is required before Docker apply");
        protectPrivatePath(target, 0o600);
        await handle.writeFile(input);
        await handle.sync();
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const metadata = await lstat(target);
    assertPrivatePath(target, 0o600);
    if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(target) !== target
      || !ownedByCurrentUser(metadata) || metadata.nlink !== 1
      || !privateMode(metadata, 0o600) || metadata.size < 1 || metadata.size > file.maxBytes) {
      throw new Error("Owner secret must be an intact current-user-owned mode-0600 file");
    }
    if (input) {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = await handle.stat();
        if (current.dev !== metadata.dev || current.ino !== metadata.ino
          || !ownedByCurrentUser(current) || current.nlink !== 1
          || !privateMode(current, 0o600)) {
          throw new Error("Owner secret changed during comparison");
        }
        if (!(await handle.readFile()).equals(input)) throw new Error("Owner secret differs from saved value");
      } finally { await handle.close(); }
    }
  }
  await preparePrivateConfigs(recipe, fileDirectory);
  await prepareMutableConfigs(recipe, dataDirectory, fileDirectory, initializeMutable);
  for (const service of recipe.services) {
    if (!Array.isArray(service.secretEnvironment) || service.secretEnvironment.length === 0) continue;
    const entries: string[] = [];
    const names = new Set<string>();
    const target = join(fileDirectory, `${service.id}.env`);
    let savedEnvironment: string | null = null;
    try {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const metadata = await handle.stat();
        assertPrivatePath(target, 0o600);
        if (!metadata.isFile() || metadata.nlink !== 1 || !ownedByCurrentUser(metadata)
          || !privateMode(metadata, 0o600) || metadata.size > 8192) {
          throw new Error("Existing private env file is not owner-only");
        }
        savedEnvironment = await handle.readFile("utf8");
      } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const binding of service.secretEnvironment) {
      if (binding.format === "owner-json") {
        secretEnvironmentValue(recipe, binding, "review-only");
        if (names.has(binding.name)) throw new Error("Recipe secret environment binding is duplicated");
        names.add(binding.name);
        const value = await readFile(join(fileDirectory, binding.fileId), "utf8");
        let parsed: unknown;
        try { parsed = JSON.parse(value); } catch { throw new Error("Owner JSON credential is malformed; payload withheld"); }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
          || Object.keys(parsed).sort().join(",") !== [...binding.jsonFields].sort().join(",")
          || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error("Owner JSON credential fields differ; payload withheld");
        entries.push(serializePrivateConfigEnvironment(binding.name, JSON.stringify(parsed)));
        continue;
      }
      if (binding.format === "private-config") {
        checkedPrivateConfigEnvironment(binding, privateConfigs);
        if (names.has(binding.name)) throw new Error("Recipe secret environment binding is invalid");
        names.add(binding.name);
        const value = await readPreparedPrivateConfig(fileDirectory, binding.fileId);
        entries.push(serializePrivateConfigEnvironment(binding.name, value));
        continue;
      }
      if (!/^[A-Z][A-Z0-9_]*$/.test(binding.name) || !secretEnvironmentName.test(binding.name)
        || binding.name.endsWith("_FILE") || names.has(binding.name)
        || !recipe.privateFiles.some((file: Entry) => file.id === binding.fileId)) {
        throw new Error("Recipe secret environment binding is invalid");
      }
      names.add(binding.name);
      const value = await readFile(join(fileDirectory, binding.fileId), "utf8");
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Private value is not env-file safe");
      if (ntfyAuthBinding(recipe, service, binding) || bcryptHashBinding(binding)) {
        let hash: string;
        if (savedEnvironment !== null) {
          const match = ntfyAuthBinding(recipe, service, binding)
            ? savedEnvironment.match(/^NTFY_AUTH_USERS='admin:(\$2[aby]\$10\$[./A-Za-z0-9]{53}):admin'$/m)
            : savedEnvironment.match(new RegExp(`^${binding.name}='(\\$2[aby]\\$10\\$[./A-Za-z0-9]{53})'$`, "m"));
          if (!match || !await bcrypt.compare(value, match[1])) {
            throw new Error("Existing derived authentication hash does not match the saved password");
          }
          hash = match[1];
        } else {
          hash = await bcrypt.hash(value, 10);
        }
        entries.push(`${binding.name}='${secretEnvironmentValue(recipe, binding, hash)}'`);
      } else {
        entries.push(`${binding.name}=${secretEnvironmentValue(recipe, binding, value)}`);
      }
    }
    const content = `${entries.sort().join("\n")}\n`;
    if (Buffer.byteLength(content) > 8192) throw new Error("Private environment exceeds its bounded size");
    try {
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { protectPrivatePath(target, 0o600); await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const metadata = await lstat(target);
    assertPrivatePath(target, 0o600);
    if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(target) !== target
      || !ownedByCurrentUser(metadata) || metadata.nlink !== 1
      || !privateMode(metadata, 0o600) || metadata.size !== Buffer.byteLength(content)) {
      throw new Error("Existing private env file does not match generated bindings");
    }
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (current.dev !== metadata.dev || current.ino !== metadata.ino
        || current.nlink !== 1 || !ownedByCurrentUser(current)
        || !privateMode(current, 0o600) || await handle.readFile("utf8") !== content) {
        throw new Error("Existing private env file does not match generated bindings");
      }
    } finally { await handle.close(); }
  }
}

export function multiServiceManifest(input: MultiServiceManifestInput): Entry {
  const { recipe, images, projectId, appsRoot, projectDirectory, dataDirectory,
    dockerContext, port, uid, gid, timezone, homarrNetwork, observed } = input;
  if (recipe.schemaVersion !== 2 || recipe.kind !== "multi-service-compose"
    || !Array.isArray(recipe.services) || !Array.isArray(recipe.privateFiles)) {
    throw new Error("Expected one validated multi-service catalog recipe");
  }
  const manualJob = checkedManualJobRecipe(recipe);
  const connector = checkedConnectorRecipe(recipe);
  const portless = manualJob || connector || checkedPrivateDaemonRecipe(recipe);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid <= 0 || gid <= 0) {
    throw new Error("Fresh non-root host UID and GID are required for this recipe");
  }
  if ((portless && port !== null)
    || (!portless && (!Number.isInteger(port) || port === null || port < 1024 || port > 65535))) {
    throw new Error("The selected private app port is invalid");
  }
  for (const service of recipe.services) {
    const targetPort = service.publishTargetPortSource === "published-port" ? port : service.publishTargetPort;
    if (service.publishedPortMustMatchTarget === true && port !== targetPort) {
      throw new Error(`${recipe.appId} requires host port ${service.publishTargetPort} to match its WebUI port`);
    }
  }
  const hostPaths = selectedHostPaths(recipe, input.hostPaths);
  const configFiles = checkedConfigFiles(recipe);
  const privateConfigs = checkedPrivateConfigBindings(recipe);
  const mutableConfigs = checkedMutableConfigs(recipe);
  if (mutableConfigs.size > 0 && dockerContext === "rootless") {
    throw new Error("Mutable owner-private state requires native UID mapping; rootless mapping is not implemented");
  }
  for (const config of mutableConfigs.values()) {
    if (config.containerUid !== uid) throw new Error("Mutable configuration image UID differs from its inspected host owner");
  }
  const additionalPorts = selectedAdditionalPorts(recipe, input.publishedPorts, port);
  if (portless && (homarrNetwork !== undefined || additionalPorts.length > 0)) {
    throw new Error("Portless jobs and connectors have no frontend or Homarr network exposure");
  }
  if (homarrNetwork !== undefined
    && (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(homarrNetwork)
      || homarrNetwork === `${projectId}-private` || recipe.appId === "homarr"
      || !observed.networks.some((network) => network.name === homarrNetwork && network.owner === "external"))) {
    throw new Error("The selected Homarr bridge is not an observed external app network");
  }
  const serviceIds = new Set(recipe.services.map((service: Entry) => service.id));
  if (Object.keys(images).length !== serviceIds.size
    || Object.keys(images).some((id) => !serviceIds.has(id))) {
    throw new Error("Pinned images must match every recipe service exactly");
  }
  const fileIds = new Set(recipe.privateFiles.map((file: Entry) => file.id));
  const mountsBySource = new Map<string, Entry[]>();
  const mountedConfigFiles = new Set<string>();
  for (const service of recipe.services) {
    for (const mount of service.mounts) {
      if (mount.kind === "volume") continue;
      if (mount.kind === "generated-file") {
        checkedGeneratedMount(mount, configFiles);
        if (mountedConfigFiles.has(mount.fileId)) throw new Error("Generated config may be mounted only once");
        mountedConfigFiles.add(mount.fileId);
      } else if (mount.kind !== "mutable-directory" && mount.fileId !== undefined) {
        throw new Error("Only generated-file mounts may reference config files");
      }
      if (configFiles.size > 0 && mount.name === "config-files") {
        throw new Error("config-files is reserved for generated project configuration");
      }
      const source = bindSource(mount, hostPaths, dataDirectory);
      const mounts = mountsBySource.get(source) ?? [];
      mounts.push(mount);
      mountsBySource.set(source, mounts);
    }
  }
  if (mountedConfigFiles.size !== configFiles.size) throw new Error("Every generated config needs one mount");
  const sharedSources = new Set<string>();
  for (const [source, mounts] of mountsBySource) {
    if (mounts.length < 2) continue;
    const readOnlyModes = new Set(mounts.map((mount) => mount.readOnly === true));
    if (readOnlyModes.has(false)) {
      const groups = new Set(mounts.map((mount) => mount.shareGroup));
      if (groups.size !== 1 || mounts[0].shareGroup === undefined) {
        throw new Error("A shared bind path with a writer needs one explicit matching share group");
      }
    } else if (new Set(mounts.map((mount) => mount.shareGroup)).size !== 1) {
      throw new Error("A shared read-only bind path cannot mix share groups");
    }
    sharedSources.add(source);
  }
  const services = recipe.services.map((service: Entry) => {
    const image = images[service.id];
    if (!matchesRecipeImagePin(service.imageTag, image)) {
      throw new Error(`Service ${service.id} needs the reviewed immutable image digest`);
    }
    const environment = [...service.environment];
    for (const binding of service.hostEnvironment) {
      if (binding.source === "timezone" && binding.name === "TZ") {
        if (typeof timezone !== "string" || timezone.length > 128
          || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(timezone)) {
          throw new Error("The recipe needs one observed IANA timezone");
        }
        try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
        catch { throw new Error("The inspected timezone is not recognized"); }
        environment.push({ name: "TZ", value: timezone });
        continue;
      }
      if (binding.source !== "uid" && binding.source !== "gid") {
        throw new Error("Recipe host environment source is unsupported");
      }
      const value = binding.source === "uid" ? uid : gid;
      environment.push({ name: binding.name, value: String(value) });
    }
    if (service.derivedEnvironment !== undefined
      && (!Array.isArray(service.derivedEnvironment) || service.derivedEnvironment.length > 4)) {
      throw new Error("Recipe derived environment bindings are invalid");
    }
    for (const binding of service.derivedEnvironment ?? []) {
      const keys = Object.keys(binding ?? {}).sort().join(",");
      const suffix = binding.pathSuffix;
      if (binding.source === "published-port") {
        if (!["name,source", "format,name,source"].includes(keys)
          || (binding.format !== undefined && binding.format !== "tcp-port")
          || !/^[A-Z][A-Z0-9_]*$/.test(binding.name)
          || environment.some((entry: Entry) => entry.name === binding.name)) {
          throw new Error("Recipe published-port environment binding is invalid");
        }
        let value = String(port);
        if (binding.format === "tcp-port") value += "/tcp";
        environment.push({ name: binding.name, value });
        continue;
      }
      if (keys !== "name,source" && keys !== "name,pathSuffix,source") {
        throw new Error("Recipe derived environment binding is invalid");
      }
      if (suffix !== undefined && (typeof suffix !== "string" || suffix.length > 128
        || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(suffix))) {
        throw new Error("Recipe derived origin path is invalid");
      }
      if (!["local-origin", "local-host-authority"].includes(binding.source)
        || (binding.source === "local-host-authority" && suffix !== undefined)
        || typeof binding.name !== "string"
        || !/^[A-Z][A-Z0-9_]*$/.test(binding.name)
        || environment.some((entry: Entry) => entry.name === binding.name)) {
        throw new Error("Recipe derived environment source is unsupported");
      }
      const host = recipe.defaults.hostIp === "::1" ? "[::1]" : "127.0.0.1";
      let value = `${host}:${port}`;
      if (binding.source === "local-origin") value = `http://${value}${suffix ?? ""}`;
      environment.push({ name: binding.name, value });
    }
    const secretRefs = [];
    let dockerCliTls;
    if (service.dockerCliTls !== undefined) {
      const request = checkedDockerCliTlsRequest(service.dockerCliTls);
      let catalog = new URL("./workflows/selfhost/references/catalog/", import.meta.url);
      if (new URL(import.meta.url).pathname.endsWith(".ts")) {
        catalog = new URL("../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/", import.meta.url);
      }
      dockerCliTls = dockerCliTlsClaim(catalog, recipe.appId, service.id, images[service.id], request);
      if (environment.filter((entry: Entry) => entry.name === "DOCKER_HOST"
        && entry.value === `tcp://${request.endpoint.serverName}:${request.endpoint.port}`).length !== 1) {
        throw new Error("Docker CLI host must match its exact source-bound endpoint mapping");
      }
      if (environment.some((entry: Entry) => ["DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_TLS", "DOCKER_CONTEXT", "DOCKER_CONFIG"].includes(entry.name))
        || service.fileEnvironment.some((entry: Entry) => [request.caFileId, request.certificateFileId, request.keyFileId].includes(entry.fileId))) {
        throw new Error("Docker CLI TLS filenames or environment cannot be overridden");
      }
      for (const binding of dockerCliTlsTargets(request)) {
        if (recipe.privateFiles.find((file: Entry) => file.id === binding.fileId)?.source !== "owner") {
          throw new Error("Docker CLI TLS requires three exact owner-issued private files");
        }
        secretRefs.push({ name: binding.fileId, ref: `local/${projectId}/${binding.fileId}`, target: binding.target,
          filePath: join(projectDirectory, "secrets", binding.fileId) });
      }
      environment.push({ name: "DOCKER_CERT_PATH", value: "/run/secrets" }, { name: "DOCKER_TLS_VERIFY", value: "1" });
    }
    for (const id of service.privateConfigFiles ?? []) {
      if (!privateConfigs.has(id)) throw new Error("Recipe private configuration binding is unavailable");
      secretRefs.push({ name: id, ref: `local/${projectId}/${id}`, target: id,
        filePath: join(projectDirectory, "secrets", id) });
    }
    const fileEnvironmentConsumers: Entry[] = [];
    for (const binding of service.fileEnvironment) {
      if (binding.format === "private-config-path") {
        // checkedPrivateConfigBindings has verified the source and exact service mount.
        if (environment.some((entry: Entry) => entry.name === binding.name)
          || !secretRefs.some((secret: Entry) => secret.target === binding.fileId)) {
          throw new Error("Private configuration path is duplicated or has no declared secret mount");
        }
        environment.push({ name: binding.name, value: `/run/secrets/${binding.fileId}` });
        fileEnvironmentConsumers.push({ name: binding.name, target: binding.fileId,
          format: "private-config-path", officialUrl: binding.officialUrl, appId: recipe.appId, source: "generated-config" });
        continue;
      }
      if (!fileIds.has(binding.fileId)) throw new Error("Recipe private-file binding is unavailable");
      let value = `/run/secrets/${binding.fileId}`;
      if (binding.format === "file-uri" || binding.format === "file-path") {
        if (Object.keys(binding).sort().join(",") !== "fileId,format,name,officialUrl"
          || !/^[A-Z][A-Z0-9_]*$/.test(binding.name)
          || recipe.privateFiles.find((file: Entry) => file.id === binding.fileId)?.source !== "owner"
          || typeof binding.officialUrl !== "string" || !binding.officialUrl.startsWith("https://")) {
          throw new Error("Recipe owner-file environment binding is invalid");
        }
        if (binding.format === "file-uri") value = `file:${value}`;
        if (binding.format === "file-path") {
          requireContainerConfigEvidence(recipe, binding);
          fileEnvironmentConsumers.push({ name: binding.name, target: binding.fileId,
            format: "file-path", officialUrl: binding.officialUrl, appId: recipe.appId, source: "owner" });
        }
      } else if (Object.keys(binding).sort().join(",") !== "fileId,name"
        || !/^(?:[A-Z][A-Z0-9_]*_(?:FILE|SECRETFILE)|FILE__[A-Z][A-Z0-9_]*)$/.test(binding.name)) {
        throw new Error("Recipe private-file environment binding is invalid");
      }
      if (environment.some((entry: Entry) => entry.name === binding.name)) {
        throw new Error("Recipe private-file environment binding is duplicated");
      }
      environment.push({ name: binding.name, value });
      secretRefs.push({ name: binding.fileId, ref: `local/${projectId}/${binding.fileId}`,
        target: binding.fileId, filePath: join(projectDirectory, "secrets", binding.fileId) });
    }
    const ports = [];
    if (service.publishTargetPort !== null) {
      if (service.publishTargetPortSource !== undefined && service.publishTargetPortSource !== "published-port") {
        throw new Error("Recipe published target-port source is unsupported");
      }
      let targetPort = service.publishTargetPort;
      if (service.publishTargetPortSource === "published-port") targetPort = port;
      ports.push({ hostIp: recipe.defaults.hostIp, published: port,
        target: targetPort, protocol: "tcp", purpose: "admin", publicApproved: false });
    }
    for (const selected of additionalPorts) {
      if (selected.serviceId !== service.id) continue;
      ports.push({ hostIp: recipe.defaults.hostIp, published: selected.published,
        target: selected.targetPort, protocol: selected.protocol,
        purpose: selected.purpose, publicApproved: false });
    }
    const mounts = service.mounts.map((mount: Entry) => {
      if (mount.kind === "volume") {
        return { kind: "volume", name: `${projectId}-${mount.name}`, target: mount.target,
          readOnly: false, owner: projectId, ownership: "new" };
      }
      const source = bindSource(mount, hostPaths, dataDirectory);
      if (mount.kind === "generated-file") {
        return { kind: "bind", source, target: mount.target, readOnly: true,
          shared: false, owner: projectId, ownership: "new" };
      }
      const readOnly = mount.readOnly === true;
      const shareGroup = mount.shareGroup;
      const compiled: Entry = { source, target: mount.target, readOnly,
        shared: sharedSources.has(source) || shareGroup !== undefined, owner: projectId, ownership: "new" };
      if (mount.kind === "bind" || mount.kind === "mutable-directory" || mount.hostPath === true) compiled.kind = "bind";
      if (shareGroup !== undefined) compiled.shareGroup = shareGroup;
      return compiled;
    });
    const userFields: Entry = { user: service.user };
    if (service.user === "host-selected") {
      const evidence = service.imageUserEvidence;
      let officialUrl: URL;
      try { officialUrl = new URL(evidence?.officialUrl); }
      catch { throw new Error(`Service ${service.id} needs official evidence for its numeric user`); }
      if (officialUrl.protocol !== "https:" || officialUrl.username || officialUrl.password
        || officialUrl.hash || evidence?.reason !== "official-image-runtime-contract") {
        throw new Error(`Service ${service.id} needs official evidence for its numeric user`);
      }
      userFields.user = `${uid}:${gid}`;
    } else if (service.user === "image-default") {
      const evidence = service.imageUserEvidence;
      const officialUrl = new URL(evidence.officialUrl);
      // Catalog citations may select a documentation section; Compose evidence names the page.
      officialUrl.hash = "";
      userFields.imageUserEvidence = { ...evidence, officialUrl: officialUrl.href };
    } else {
      throw new Error(`Service ${service.id} has an unsupported user mode`);
    }
    const entry: Entry = {
      id: service.id, image, restart: service.restart, readOnly: service.readOnly,
      ...userFields,
      environment, ports, mounts,
      networks: service.id === recipe.appId && homarrNetwork !== undefined ? ["private", "homarr"] : ["private"],
      secretRefs,
    };
    if (service.ownerDirectory !== undefined) {
      const owned = compileSharedOwnerDirectory(recipe, service, image, projectDirectory, dataDirectory);
      if (environment.some((row: Entry) => row.name === owned.fields.environment.name)
        || mounts.some((row: Entry) => row.source === owned.fields.path || row.target === owned.fields.path)) throw new Error("Owned stack directory must be derived once, never caller-bound");
      environment.push(owned.fields.environment);
      mounts.push({ ...owned.fields.mount, owner: projectId, ownership: "new" });
      entry.ownerDirectory = owned.claim;
    }
    if (fileEnvironmentConsumers.length > 0) entry.fileEnvironmentConsumers = fileEnvironmentConsumers;
    if (service.secretEnvironment?.length > 0) {
      const names = new Set(environment.map((entry: Entry) => entry.name));
      for (const binding of service.secretEnvironment) {
        if (binding.format === "private-config") {
          checkedPrivateConfigEnvironment(binding, privateConfigs);
          if (names.has(binding.name)) throw new Error("Recipe secret environment binding is invalid");
          names.add(binding.name);
          continue;
        }
        if (!fileIds.has(binding.fileId) || !/^[A-Z][A-Z0-9_]*$/.test(binding.name)
          || (!secretEnvironmentName.test(binding.name) && binding.format !== "owner-json") || binding.name.endsWith("_FILE")
          || names.has(binding.name)) {
          throw new Error("Recipe secret environment binding is invalid");
        }
        ntfyAuthBinding(recipe, service, binding);
        secretEnvironmentValue(recipe, binding, "generated");
        names.add(binding.name);
      }
      entry.envFilePath = join(projectDirectory, "secrets", `${service.id}.env`);
    }
    if (service.init === true) entry.init = true;
    if (manualJob) {
      entry.profiles = ["self-host-manual"];
      entry.manualProbe = recipe.execution.probe;
    }
    if (service.hostname !== undefined) entry.hostname = service.hostname;
    if (service.healthcheck !== undefined) entry.healthcheck = service.healthcheck;
    if (service.shmSizeBytes !== undefined) entry.shmSizeBytes = service.shmSizeBytes;
    if (dockerCliTls) entry.dockerCliTls = dockerCliTls;
    if (service.runtimeResources !== undefined) entry.runtimeResources = compileSharedRuntimeResources(recipe, service, images[service.id]);
    if (service.ulimits !== undefined) entry.ulimits = service.ulimits;
    if (service.capDrop !== undefined) entry.capDrop = service.capDrop;
    if (service.memoryLimitBytes !== undefined) entry.memoryLimitBytes = service.memoryLimitBytes;
    if (service.cpuLimit !== undefined) entry.cpuLimit = service.cpuLimit;
    if (service.tmpfs !== undefined) entry.tmpfs = service.tmpfs;
    if (service.entrypoint !== undefined) entry.entrypoint = service.entrypoint;
    if (service.command !== undefined) entry.command = service.command;
    if (service.dependsOn.length > 0) {
      entry.dependsOn = service.dependsOn.map((dependency: string | { service: string; condition: string }) => {
        if (typeof dependency === "string") return { service: dependency, condition: "service_started" };
        return dependency;
      });
    }
    return entry;
  });
  return {
    schemaVersion: 1,
    project: { dockerContext, id: projectId, owner: projectId,
      root: appsRoot, directory: projectDirectory, ownership: "new" },
    services,
    networks: [
      { id: "private", name: `${projectId}-private`, driver: "bridge",
        internal: false, owner: projectId, ownership: "new" },
      ...(homarrNetwork === undefined ? [] : [{ id: "homarr", name: homarrNetwork,
        driver: "bridge", internal: false, owner: "external", ownership: "verified-existing" }]),
    ],
    observed: { checkedAt: observed.checkedAt, project: null,
      ports: observed.ports, paths: observed.paths, networks: observed.networks,
      ...(recipe.services.some((service: Entry) => service.mounts.some((mount: Entry) => mount.kind === "volume"))
        ? { volumes: observed.volumes ?? [] } : {}) },
  };
}

export function closedImmichManifest(manifest: Entry, observed: Entry): Entry {
  if (manifest.project?.ownership !== "new" || manifest.project?.id !== manifest.project?.owner
    || !Array.isArray(manifest.services) || manifest.services.length !== 4
    || !Array.isArray(manifest.networks) || manifest.networks.length < 1 || manifest.networks.length > 2
    || (manifest.networks.length === 2 && (manifest.networks[1].id !== "homarr"
      || manifest.networks[1].owner !== "external" || manifest.networks[1].ownership !== "verified-existing"))) {
    throw new Error("Immich setup closure needs one exact newly owned four-service manifest");
  }
  const closed = structuredClone(manifest);
  const server = closed.services.find((service: Entry) => service.id === "immich");
  const setup = server?.environment?.filter((entry: Entry) => entry.name === "IMMICH_ALLOW_SETUP");
  if (!Array.isArray(setup) || setup.length !== 1 || setup[0].value !== "true") {
    throw new Error("Immich setup closure needs one setup-enabled server");
  }
  setup[0].value = "false";
  closed.project.ownership = "verified-existing";
  for (const service of closed.services) {
    for (const mount of service.mounts) mount.ownership = "verified-existing";
  }
  closed.networks[0].ownership = "verified-existing";
  closed.observed = structuredClone(observed);
  return closed;
}
