#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ITEMS = 100;
const MAX_DEPTH = 12;
const MAX_STRING = 2048;
const FLOATING_TAGS = new Set(["latest", "stable", "edge", "main", "master", "nightly", "rolling", "current", "dev"]);
const PROTECTED_PURPOSES = new Set(["admin", "database", "management", "docker-api"]);
const PROTECTED_PORTS = new Set([22, 2375, 2376, 3306, 5432, 6379, 27017]);
const RESTART_POLICIES = new Set(["no", "always", "on-failure", "unless-stopped"]);
const OWNERSHIP_MODES = new Set(["new", "verified-existing"]);
const FORBIDDEN_KEYS = /^(?:privileged|network[_-]?mode|pid|ipc|devices?|cap[_-]?(?:add|drop)|security[_-]?opt|userns[_-]?mode)$/i;
const SENSITIVE_KEYS = /password|passwd|token|api[-_]?key|private[-_]?key|credential|secret/i;
const SECRET_REF_KEYS = /^(?:secretrefs?)$/i;
const SENSITIVE_ENV = /(?:^|_)(?:password|passwd|token|key|auth|credential|secret|cookie|database_url|dsn|connection_string)(?:_|$)/i;
const OPAQUE_REF = /^[a-z0-9][a-z0-9._:/-]{2,127}$/i;
const LABEL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const PROJECT_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const DOCKER_CONTEXT = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]{0,126}[a-zA-Z0-9])?$/;
const NETWORK_NAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]{0,126}[a-zA-Z0-9])?$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const FORBIDDEN_SOURCE_PREFIXES = ["/proc", "/sys", "/dev", "/run", "/var/run", "/var/lib/docker"];
const FORBIDDEN_ROOTS = new Set(["/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var"]);

class ValidationError extends Error {}

function usage() {
  process.stdout.write("Usage: compose-project.mjs <validate|plan|render|lifecycle-check> --input FILE [--output-dir DIR] [--context NAME --project ID --file FILE]\n");
}

function reject(message) {
  throw new ValidationError(message);
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    usage();
    process.exit(0);
  }
  const action = argv[0];
  if (!["validate", "plan", "render", "lifecycle-check"].includes(action)) {
    reject("unsupported action");
  }
  const options = { action, input: "", outputDir: "", context: "", project: "", file: "" };
  const allowed = new Set(["--input", "--output-dir", "--context", "--project", "--file"]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) {
      reject("unsupported option");
    }
    index += 1;
    if (index >= argv.length) {
      reject("an option is missing its value");
    }
    const value = argv[index];
    if (flag === "--input") {
      options.input = value;
    }
    if (flag === "--output-dir") {
      options.outputDir = value;
    }
    if (flag === "--project") {
      options.project = value;
    }
    if (flag === "--context") {
      options.context = value;
    }
    if (flag === "--file") {
      options.file = value;
    }
  }
  if (!options.input) {
    reject("--input is required");
  }
  if (action === "render" && !options.outputDir) {
    reject("render requires --output-dir");
  }
  if (action === "lifecycle-check" && (!options.context || !options.project || !options.file)) {
    reject("lifecycle-check requires --context, --project, and --file");
  }
  if (action !== "render" && options.outputDir) {
    reject("--output-dir is valid only for render");
  }
  if (action !== "lifecycle-check" && (options.context || options.project || options.file)) {
    reject("--context, --project, and --file are valid only for lifecycle-check");
  }
  return options;
}

function readInput(inputPath) {
  let stat;
  try {
    stat = fs.lstatSync(inputPath);
  } catch {
    reject("input file is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    reject("input must be a regular non-symlink file");
  }
  if (stat.size > MAX_INPUT_BYTES) {
    reject("input exceeds 256 KiB");
  }
  const content = fs.readFileSync(inputPath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_INPUT_BYTES) {
    reject("input exceeds 256 KiB");
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    reject("input is not valid JSON");
  }
  assertBoundedAndSecretFree(parsed);
  return parsed;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertBoundedAndSecretFree(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    reject("input nesting exceeds the supported limit");
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) {
      reject("an input collection exceeds 100 items");
    }
    for (const item of value) {
      assertBoundedAndSecretFree(item, depth + 1);
    }
    return;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_ITEMS) {
      reject("an input object exceeds 100 fields");
    }
    for (const [key, child] of entries) {
      if (key.length > 128) {
        reject("an input field name exceeds the supported limit");
      }
      if (FORBIDDEN_KEYS.test(key)) {
        reject("unsafe privilege or host namespace fields are not accepted");
      }
      if (SENSITIVE_KEYS.test(key) && !SECRET_REF_KEYS.test(key)) {
        reject("plaintext secret-bearing fields are not accepted; use secretRefs");
      }
      assertBoundedAndSecretFree(child, depth + 1);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  if (value.length > MAX_STRING) {
    reject("an input string exceeds the supported limit");
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    reject("control characters are not accepted");
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    reject("private key material is not accepted");
  }
  if (/[?&](?:token|password|api[_-]?key|secret)=/i.test(value)) {
    reject("secret-bearing URLs are not accepted");
  }
  if (/\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(value)) {
    reject("credential-bearing URLs are not accepted");
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i.test(value)) {
    reject("credential material is not accepted");
  }
  if (/\b(?:sk|ghp|github_pat|glpat)-?[A-Za-z0-9_]{16,}\b/.test(value)) {
    reject("credential material is not accepted");
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(value) || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value)) {
    reject("credential material is not accepted");
  }
  if (/\b(?:password|passwd|token|api[_-]?key|secret)\s*[:=]\s*\S+/i.test(value)) {
    reject("plaintext credential assignments are not accepted");
  }
  if (/\$\{[^}]+\}/.test(value)) {
    reject("environment interpolation is not accepted");
  }
}

function exactObject(value, keys, context) {
  if (!isObject(value)) {
    reject(`${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) {
    reject(`${context} must contain exactly the documented fields`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      reject(`${context} must contain exactly the documented fields`);
    }
  }
}

function requireArray(value, context) {
  if (!Array.isArray(value)) {
    reject(`${context} must be an array`);
  }
  return value;
}

function requireBoolean(value, context) {
  if (typeof value !== "boolean") {
    reject(`${context} must be boolean`);
  }
  return value;
}

function requireInteger(value, context, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    reject(`${context} is outside the supported range`);
  }
  return value;
}

function requireLabel(value, context) {
  if (typeof value !== "string" || !LABEL.test(value)) {
    reject(`${context} must be a bounded lowercase identifier`);
  }
  return value;
}

function requireProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) {
    reject("project.id must be a valid Compose project identifier");
  }
  return value;
}

function requireDockerContext(value) {
  if (typeof value !== "string" || !DOCKER_CONTEXT.test(value)) {
    reject("project.dockerContext must be a bounded context name");
  }
  return value;
}

function requireNetworkName(value) {
  if (typeof value !== "string" || !NETWORK_NAME.test(value) || value === "host" || value === "none") {
    reject("network name is invalid or unsafe");
  }
  return value;
}

function requireText(value, context, maximum = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    reject(`${context} must be bounded text`);
  }
  return value;
}

function requireAbsolutePath(value, context, target = false) {
  if (typeof value !== "string" || !path.posix.isAbsolute(value) || value.includes("\\")) {
    reject(`${context} must be an absolute POSIX path`);
  }
  if (path.posix.normalize(value) !== value || value === "/" || value.endsWith("/")) {
    reject(`${context} must be normalized and bounded`);
  }
  const lowered = value.toLowerCase();
  if (lowered.endsWith("/docker.sock") || lowered === "/var/run/docker.sock" || lowered === "/run/docker.sock") {
    reject("Docker socket paths are not accepted");
  }
  if (target) {
    for (const prefix of ["/proc", "/sys", "/dev", "/run"]) {
      if (value === prefix || value.startsWith(`${prefix}/`)) {
        reject("container mount target enters a protected namespace");
      }
    }
  }
  return value;
}

function requireProjectRoot(value) {
  requireAbsolutePath(value, "project.root");
  if (FORBIDDEN_ROOTS.has(value)) {
    reject("project.root is too broad");
  }
  const segments = value.split("/").filter(Boolean);
  if (segments.length < 2) {
    reject("project.root is too broad");
  }
  for (const prefix of FORBIDDEN_SOURCE_PREFIXES) {
    if (value === prefix || value.startsWith(`${prefix}/`)) {
      reject("project.root enters a protected host path");
    }
  }
  return value;
}

function requireSourcePath(value) {
  requireAbsolutePath(value, "mount source");
  const segments = value.split("/").filter(Boolean);
  if (segments.length < 2) {
    reject("mount source is too broad");
  }
  for (const prefix of FORBIDDEN_SOURCE_PREFIXES) {
    if (value === prefix || value.startsWith(`${prefix}/`)) {
      reject("mount source enters a protected host path");
    }
  }
  if (/(?:^|\/)\.(?:ssh|gnupg|aws|kube|docker)(?:\/|$)/i.test(value)) {
    reject("mount source enters a credential-bearing host path");
  }
  if (value === "/etc/shadow" || value === "/etc/gshadow" || value === "/etc/sudoers") {
    reject("mount source enters a credential-bearing host path");
  }
  return value;
}

function requireOwnership(value, context) {
  if (!OWNERSHIP_MODES.has(value)) {
    reject(`${context} must be new or verified-existing`);
  }
  return value;
}

function requireOpaqueRef(value, context) {
  if (typeof value !== "string" || !OPAQUE_REF.test(value) || value.includes("..")) {
    reject(`${context} must be an opaque reference identifier`);
  }
  return value;
}

function requireTimestamp(value, context) {
  requireText(value, context, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    reject(`${context} must be a UTC timestamp`);
  }
  return value;
}

function requireImage(value) {
  requireText(value, "service image", 512);
  if (/\s/.test(value) || value.startsWith("-") || value.includes("//")) {
    reject("service image reference is invalid");
  }
  const imagePattern = /^(?:(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)(?::\d+)?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$/;
  if (!imagePattern.test(value)) {
    reject("service image reference is invalid");
  }
  if (/:latest@sha256:/i.test(value)) {
    reject("floating latest labels are not accepted even beside a digest");
  }
  const digestMatch = value.match(/@sha256:([a-f0-9]{64})$/i);
  if (digestMatch) {
    return value;
  }
  const lastSlash = value.lastIndexOf("/");
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= lastSlash || lastColon === value.length - 1) {
    reject("service image must have an explicit tag or sha256 digest");
  }
  const tag = value.slice(lastColon + 1).toLowerCase();
  if (FLOATING_TAGS.has(tag)) {
    reject("floating image tags are not accepted");
  }
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag)) {
    reject("service image tag is invalid");
  }
  return value;
}

function requireHostIp(value) {
  if (value === "*") {
    return value;
  }
  if (typeof value !== "string" || isIP(value) === 0) {
    reject("port hostIp must be a literal IP address or *");
  }
  return value;
}

function isPrivateBind(value) {
  if (value === "127.0.0.1" || value === "::1") {
    return true;
  }
  if (value === "0.0.0.0" || value === "::" || value === "*") {
    return false;
  }
  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127) {
      return true;
    }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
    if (parts[0] === 192 && parts[1] === 168) {
      return true;
    }
    if (parts[0] === 169 && parts[1] === 254) {
      return true;
    }
    return false;
  }
  const lowered = value.toLowerCase();
  return lowered.startsWith("fc") || lowered.startsWith("fd") || lowered.startsWith("fe8") || lowered.startsWith("fe9") || lowered.startsWith("fea") || lowered.startsWith("feb");
}

function normalizeProject(value, observedProject) {
  exactObject(value, ["dockerContext", "id", "owner", "root", "directory", "ownership"], "project");
  const dockerContext = requireDockerContext(value.dockerContext);
  const id = requireProjectId(value.id);
  const owner = requireLabel(value.owner, "project.owner");
  const root = requireProjectRoot(value.root);
  const directory = requireAbsolutePath(value.directory, "project.directory");
  if (directory !== path.posix.join(root, id)) {
    reject("project.directory must equal project.root/project.id");
  }
  const ownership = requireOwnership(value.ownership, "project.ownership");
  return { dockerContext, id, owner, root, directory, ownership, observedProject };
}

function normalizeEnvironment(value) {
  const result = [];
  const seen = new Set();
  for (const entry of requireArray(value, "service.environment")) {
    exactObject(entry, ["name", "value"], "environment entry");
    if (typeof entry.name !== "string" || !ENV_NAME.test(entry.name) || SENSITIVE_ENV.test(entry.name)) {
      reject("secret-bearing or invalid environment names are not accepted; use secretRefs");
    }
    if (seen.has(entry.name)) {
      reject("environment names must be unique per service");
    }
    seen.add(entry.name);
    result.push({ name: entry.name, value: requireText(entry.value, "environment value") });
  }
  result.sort((left, right) => left.name.localeCompare(right.name));
  return result;
}

function normalizePort(value) {
  exactObject(value, ["hostIp", "published", "target", "protocol", "purpose", "publicApproved"], "port");
  const hostIp = requireHostIp(value.hostIp);
  const published = requireInteger(value.published, "published port", 1, 65535);
  const target = requireInteger(value.target, "target port", 1, 65535);
  if (value.protocol !== "tcp" && value.protocol !== "udp") {
    reject("port protocol must be tcp or udp");
  }
  const purposes = new Set(["application", "admin", "database", "management", "docker-api"]);
  if (!purposes.has(value.purpose)) {
    reject("port purpose is unsupported");
  }
  const publicApproved = requireBoolean(value.publicApproved, "port.publicApproved");
  const privateBind = isPrivateBind(hostIp);
  if (privateBind && publicApproved) {
    reject("private ports must not carry public approval");
  }
  if (!privateBind) {
    if (PROTECTED_PURPOSES.has(value.purpose) || PROTECTED_PORTS.has(published) || PROTECTED_PORTS.has(target)) {
      reject("public protected ports are not accepted");
    }
    if (!publicApproved) {
      reject("public application ports require explicit approval");
    }
  }
  return { hostIp, published, target, protocol: value.protocol, purpose: value.purpose, publicApproved };
}

function normalizeMount(value, projectOwner) {
  exactObject(value, ["source", "target", "readOnly", "shared", "owner", "ownership"], "mount");
  const source = requireSourcePath(value.source);
  const target = requireAbsolutePath(value.target, "mount target", true);
  const readOnly = requireBoolean(value.readOnly, "mount.readOnly");
  const shared = requireBoolean(value.shared, "mount.shared");
  const owner = requireLabel(value.owner, "mount.owner");
  const ownership = requireOwnership(value.ownership, "mount.ownership");
  if (ownership === "new" && owner !== projectOwner) {
    reject("new mount sources must be project-owned");
  }
  if (!readOnly && owner !== projectOwner) {
    reject("read-write mount sources must be project-owned");
  }
  if (!readOnly && shared) {
    reject("shared mount sources must be read-only");
  }
  return { source, target, readOnly, shared, owner, ownership };
}

function normalizeSecretRef(value) {
  exactObject(value, ["name", "ref", "target"], "secret reference");
  const name = requireLabel(value.name, "secret reference name");
  const ref = requireOpaqueRef(value.ref, "secret ref");
  const target = requireLabel(value.target, "secret target");
  return { name, ref, target };
}

function normalizeService(value, projectOwner) {
  exactObject(value, ["id", "image", "restart", "readOnly", "user", "environment", "ports", "mounts", "networks", "secretRefs"], "service");
  const id = requireLabel(value.id, "service.id");
  const image = requireImage(value.image);
  if (!RESTART_POLICIES.has(value.restart)) {
    reject("service.restart is unsupported");
  }
  const readOnly = requireBoolean(value.readOnly, "service.readOnly");
  if (typeof value.user !== "string" || !/^\d{1,10}:\d{1,10}$/.test(value.user)) {
    reject("service.user must be a numeric uid:gid");
  }
  const userParts = value.user.split(":").map(Number);
  if (userParts[0] === 0 || userParts[1] === 0) {
    reject("service.user must not use the root uid or gid");
  }
  const environment = normalizeEnvironment(value.environment);
  const ports = requireArray(value.ports, "service.ports").map(normalizePort);
  ports.sort(comparePorts);
  const mounts = requireArray(value.mounts, "service.mounts").map((mount) => normalizeMount(mount, projectOwner));
  mounts.sort((left, right) => `${left.source}\0${left.target}`.localeCompare(`${right.source}\0${right.target}`));
  requireUnique(mounts.map((mount) => mount.target), "mount targets per service");
  const networks = requireArray(value.networks, "service.networks").map((network) => requireLabel(network, "service network"));
  networks.sort();
  if (networks.length === 0 || new Set(networks).size !== networks.length) {
    reject("each service needs unique explicit networks");
  }
  const secretRefs = requireArray(value.secretRefs, "service.secretRefs").map(normalizeSecretRef);
  secretRefs.sort((left, right) => left.name.localeCompare(right.name));
  const secretNames = new Set();
  const secretTargets = new Set();
  for (const secret of secretRefs) {
    if (secretNames.has(secret.name) || secretTargets.has(secret.target)) {
      reject("secret names and targets must be unique per service");
    }
    secretNames.add(secret.name);
    secretTargets.add(secret.target);
  }
  return { id, image, restart: value.restart, readOnly, user: value.user, environment, ports, mounts, networks, secretRefs };
}

function normalizeNetwork(value) {
  exactObject(value, ["id", "name", "driver", "internal", "owner", "ownership"], "network");
  const id = requireLabel(value.id, "network.id");
  const name = requireNetworkName(value.name);
  if (value.driver !== "bridge") {
    reject("only bridge networks are accepted");
  }
  const internal = requireBoolean(value.internal, "network.internal");
  const owner = requireLabel(value.owner, "network.owner");
  const ownership = requireOwnership(value.ownership, "network.ownership");
  return { id, name, driver: value.driver, internal, owner, ownership };
}

function normalizeObservedProject(value) {
  if (value === null) {
    return null;
  }
  exactObject(value, ["id", "directory", "owner"], "observed.project");
  return {
    id: requireLabel(value.id, "observed project id"),
    directory: requireAbsolutePath(value.directory, "observed project directory"),
    owner: requireLabel(value.owner, "observed project owner")
  };
}

function normalizeObservedPort(value) {
  exactObject(value, ["hostIp", "published", "protocol", "owner"], "observed port");
  const protocol = value.protocol;
  if (protocol !== "tcp" && protocol !== "udp") {
    reject("observed port protocol must be tcp or udp");
  }
  return {
    hostIp: requireHostIp(value.hostIp),
    published: requireInteger(value.published, "observed published port", 1, 65535),
    protocol,
    owner: requireLabel(value.owner, "observed port owner")
  };
}

function normalizeObservedPath(value) {
  exactObject(value, ["path", "owner"], "observed path");
  return { path: requireSourcePath(value.path), owner: requireLabel(value.owner, "observed path owner") };
}

function normalizeObservedNetwork(value) {
  exactObject(value, ["name", "owner"], "observed network");
  return { name: requireNetworkName(value.name), owner: requireLabel(value.owner, "observed network owner") };
}

function normalizeObserved(value) {
  exactObject(value, ["checkedAt", "project", "ports", "paths", "networks"], "observed");
  const result = {
    checkedAt: requireTimestamp(value.checkedAt, "observed.checkedAt"),
    project: normalizeObservedProject(value.project),
    ports: requireArray(value.ports, "observed.ports").map(normalizeObservedPort),
    paths: requireArray(value.paths, "observed.paths").map(normalizeObservedPath),
    networks: requireArray(value.networks, "observed.networks").map(normalizeObservedNetwork)
  };
  result.ports.sort(comparePorts);
  result.paths.sort((left, right) => left.path.localeCompare(right.path));
  result.networks.sort((left, right) => left.name.localeCompare(right.name));
  return result;
}

function normalizeManifest(input) {
  exactObject(input, ["schemaVersion", "project", "services", "networks", "observed"], "manifest");
  if (input.schemaVersion !== 1) {
    reject("schemaVersion must be 1");
  }
  const observed = normalizeObserved(input.observed);
  const project = normalizeProject(input.project, observed.project);
  const services = requireArray(input.services, "services").map((service) => normalizeService(service, project.owner));
  const networks = requireArray(input.networks, "networks").map(normalizeNetwork);
  if (services.length === 0 || networks.length === 0) {
    reject("at least one service and network are required");
  }
  services.sort((left, right) => left.id.localeCompare(right.id));
  networks.sort((left, right) => left.id.localeCompare(right.id));
  requireUnique(services.map((service) => service.id), "service IDs");
  requireUnique(networks.map((network) => network.id), "network IDs");
  requireUnique(networks.map((network) => network.name), "network names");
  const networkIds = new Set(networks.map((network) => network.id));
  for (const service of services) {
    for (const network of service.networks) {
      if (!networkIds.has(network)) {
        reject("a service references an undeclared network");
      }
    }
  }
  return { schemaVersion: 1, project, services, networks, observed };
}

function requireUnique(values, context) {
  if (new Set(values).size !== values.length) {
    reject(`${context} must be unique`);
  }
}

function comparePorts(left, right) {
  return `${left.protocol}\0${String(left.published).padStart(5, "0")}\0${left.hostIp}`.localeCompare(`${right.protocol}\0${String(right.published).padStart(5, "0")}\0${right.hostIp}`);
}

function wildcardBind(value) {
  return value === "0.0.0.0" || value === "::" || value === "*";
}

function portsOverlap(left, right) {
  if (left.protocol !== right.protocol || left.published !== right.published) {
    return false;
  }
  if (wildcardBind(left.hostIp) || wildcardBind(right.hostIp)) {
    return true;
  }
  return left.hostIp === right.hostIp;
}

function pathsOverlap(left, right) {
  if (left === right) {
    return true;
  }
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function gateStatus(hasConflict, hasBlocker) {
  if (hasConflict) {
    return "conflict";
  }
  if (hasBlocker) {
    return "blocked";
  }
  return "pass";
}

function buildAssessment(manifest) {
  const conflicts = [];
  const blockers = [];
  const project = manifest.project;
  const observed = manifest.observed;

  if (project.ownership === "new") {
    if (observed.project !== null) {
      conflicts.push({ kind: "project", resource: project.directory, reason: "project-already-observed" });
    }
  } else if (observed.project === null) {
    blockers.push({ kind: "project", resource: project.directory, reason: "ownership-evidence-missing" });
  } else if (observed.project.id !== project.id || observed.project.directory !== project.directory || observed.project.owner !== project.owner) {
    conflicts.push({ kind: "project", resource: project.directory, reason: "ownership-mismatch" });
  }

  const desiredPorts = [];
  const desiredMounts = [];
  for (const service of manifest.services) {
    for (const port of service.ports) {
      desiredPorts.push({ ...port, service: service.id });
    }
    for (const mount of service.mounts) {
      desiredMounts.push({ ...mount, service: service.id });
    }
  }

  for (let leftIndex = 0; leftIndex < desiredPorts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < desiredPorts.length; rightIndex += 1) {
      if (portsOverlap(desiredPorts[leftIndex], desiredPorts[rightIndex])) {
        conflicts.push({ kind: "port", resource: `${desiredPorts[leftIndex].protocol}:${desiredPorts[leftIndex].published}`, reason: "desired-port-overlap" });
      }
    }
  }
  for (const desired of desiredPorts) {
    for (const current of observed.ports) {
      if (!portsOverlap(desired, current)) {
        continue;
      }
      if (project.ownership === "verified-existing" && current.owner === project.owner) {
        continue;
      }
      conflicts.push({ kind: "port", resource: `${desired.protocol}:${desired.published}`, reason: "observed-port-owner-conflict" });
    }
  }

  for (let leftIndex = 0; leftIndex < desiredMounts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < desiredMounts.length; rightIndex += 1) {
      const left = desiredMounts[leftIndex];
      const right = desiredMounts[rightIndex];
      if (!pathsOverlap(left.source, right.source)) {
        continue;
      }
      const safeShared = left.source === right.source && left.readOnly && right.readOnly && left.shared && right.shared && left.owner === right.owner && left.ownership === right.ownership;
      if (!safeShared) {
        conflicts.push({ kind: "path", resource: left.source, reason: "desired-path-overlap" });
      }
    }
  }
  for (const desired of desiredMounts) {
    const exactObserved = observed.paths.find((current) => current.path === desired.source);
    const overlappingObserved = observed.paths.filter((current) => pathsOverlap(desired.source, current.path));
    if (desired.ownership === "verified-existing") {
      if (!exactObserved) {
        blockers.push({ kind: "path", resource: desired.source, reason: "ownership-evidence-missing" });
      } else if (exactObserved.owner !== desired.owner) {
        conflicts.push({ kind: "path", resource: desired.source, reason: "ownership-mismatch" });
      }
    }
    if (desired.ownership === "new" && overlappingObserved.length > 0) {
      conflicts.push({ kind: "path", resource: desired.source, reason: "new-path-overlaps-observed" });
    }
    for (const current of overlappingObserved) {
      if (current.path === desired.source && current.owner === desired.owner && desired.ownership === "verified-existing") {
        continue;
      }
      if (desired.ownership !== "new") {
        conflicts.push({ kind: "path", resource: desired.source, reason: "observed-path-overlap" });
      }
    }
  }

  for (const network of manifest.networks) {
    const matches = observed.networks.filter((current) => current.name === network.name);
    if (network.ownership === "new") {
      if (network.owner !== project.owner) {
        conflicts.push({ kind: "network", resource: network.name, reason: "new-network-owner-mismatch" });
      }
      if (matches.length > 0) {
        conflicts.push({ kind: "network", resource: network.name, reason: "network-already-observed" });
      }
      continue;
    }
    if (matches.length === 0) {
      blockers.push({ kind: "network", resource: network.name, reason: "ownership-evidence-missing" });
      continue;
    }
    if (matches.length > 1 || matches[0].owner !== network.owner) {
      conflicts.push({ kind: "network", resource: network.name, reason: "ownership-mismatch" });
    }
  }

  conflicts.sort(compareFinding);
  blockers.sort(compareFinding);
  const status = gateStatus(conflicts.length > 0, blockers.length > 0);
  return { status, conflicts, blockers, desiredPorts, desiredMounts };
}

function compareFinding(left, right) {
  return `${left.kind}\0${left.resource}\0${left.reason}`.localeCompare(`${right.kind}\0${right.resource}\0${right.reason}`);
}

function canonicalManifest(manifest) {
  const project = { ...manifest.project };
  delete project.observedProject;
  return {
    schemaVersion: manifest.schemaVersion,
    project,
    services: manifest.services,
    networks: manifest.networks,
    observed: manifest.observed
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function planIdFor(manifest) {
  const content = stableStringify(canonicalManifest(manifest));
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function renderTargetFor(manifest) {
  return path.posix.join(manifest.project.directory, `compose.${planIdFor(manifest)}.yaml`);
}

function buildPlan(manifest) {
  const assessment = buildAssessment(manifest);
  const publicPorts = [];
  const privatePorts = [];
  const services = [];
  const paths = [];
  const secretRefs = [];
  for (const service of manifest.services) {
    services.push({
      id: service.id,
      image: service.image,
      environmentNames: service.environment.map((entry) => entry.name),
      networks: service.networks,
      secretRefNames: service.secretRefs.map((entry) => entry.name)
    });
    for (const port of service.ports) {
      const claim = { service: service.id, hostIp: port.hostIp, published: port.published, target: port.target, protocol: port.protocol, purpose: port.purpose };
      if (isPrivateBind(port.hostIp)) {
        privatePorts.push(claim);
      } else {
        publicPorts.push(claim);
      }
    }
    for (const mount of service.mounts) {
      paths.push({ service: service.id, source: mount.source, target: mount.target, readOnly: mount.readOnly, owner: mount.owner, ownership: mount.ownership });
    }
    for (const secret of service.secretRefs) {
      secretRefs.push({ service: service.id, name: secret.name, ref: secret.ref, target: secret.target });
    }
  }
  privatePorts.sort(comparePlanPort);
  publicPorts.sort(comparePlanPort);
  paths.sort((left, right) => `${left.source}\0${left.service}`.localeCompare(`${right.source}\0${right.service}`));
  secretRefs.sort((left, right) => `${left.service}\0${left.name}`.localeCompare(`${right.service}\0${right.name}`));
  const ownershipConflict = assessment.conflicts.some((finding) => finding.reason.includes("owner") || finding.reason.includes("ownership") || finding.kind === "project");
  const ownershipBlocked = assessment.blockers.some((finding) => finding.reason.includes("ownership") || finding.kind === "project");
  const resourceConflict = assessment.conflicts.some((finding) => finding.kind !== "project");
  const resourceBlocked = assessment.blockers.some((finding) => finding.kind !== "project");
  return {
    schemaVersion: 1,
    kind: "selfhost-compose-plan",
    planId: planIdFor(manifest),
    status: assessment.status,
    project: {
      dockerContext: manifest.project.dockerContext,
      id: manifest.project.id,
      owner: manifest.project.owner,
      directory: manifest.project.directory,
      ownership: manifest.project.ownership,
      observedAt: manifest.observed.checkedAt
    },
    gates: [
      { id: "ownership", status: gateStatus(ownershipConflict, ownershipBlocked) },
      { id: "resource-conflicts", status: gateStatus(resourceConflict, resourceBlocked) },
      { id: "secret-boundary", status: "pass" },
      { id: "privilege-boundary", status: "pass" },
      { id: "exposure", status: "pass" }
    ],
    claims: {
      services,
      privatePorts,
      publicPorts,
      paths,
      networks: manifest.networks.map((network) => ({ id: network.id, name: network.name, internal: network.internal, owner: network.owner, ownership: network.ownership })),
      secretRefs
    },
    conflicts: assessment.conflicts,
    blockers: assessment.blockers,
    render: { target: renderTargetFor(manifest), format: "compose-yaml", noClobber: true },
    approvals: { apply: `APPLY:${manifest.project.id}`, stop: `STOP:${manifest.project.id}` },
    execution: { performed: false, verified: false }
  };
}

function comparePlanPort(left, right) {
  return `${left.protocol}\0${String(left.published).padStart(5, "0")}\0${left.hostIp}\0${left.service}`.localeCompare(`${right.protocol}\0${String(right.published).padStart(5, "0")}\0${right.hostIp}\0${right.service}`);
}

function yamlString(value) {
  return JSON.stringify(value);
}

function renderCompose(manifest) {
  const lines = [];
  lines.push(`name: ${yamlString(manifest.project.id)}`);
  lines.push("services:");
  for (const service of manifest.services) {
    lines.push(`  ${yamlString(service.id)}:`);
    lines.push(`    image: ${yamlString(service.image)}`);
    lines.push(`    restart: ${yamlString(service.restart)}`);
    lines.push(`    user: ${yamlString(service.user)}`);
    lines.push(`    read_only: ${String(service.readOnly)}`);
    lines.push("    security_opt:");
    lines.push(`      - ${yamlString("no-new-privileges:true")}`);
    if (service.environment.length > 0) {
      lines.push("    environment:");
      for (const entry of service.environment) {
        lines.push(`      ${yamlString(entry.name)}: ${yamlString(entry.value)}`);
      }
    }
    if (service.ports.length > 0) {
      lines.push("    ports:");
      for (const port of service.ports) {
        lines.push("      - target: " + String(port.target));
        lines.push("        published: " + String(port.published));
        lines.push(`        host_ip: ${yamlString(port.hostIp)}`);
        lines.push(`        protocol: ${yamlString(port.protocol)}`);
      }
    }
    if (service.mounts.length > 0) {
      lines.push("    volumes:");
      for (const mount of service.mounts) {
        lines.push("      - type: bind");
        lines.push(`        source: ${yamlString(mount.source)}`);
        lines.push(`        target: ${yamlString(mount.target)}`);
        lines.push(`        read_only: ${String(mount.readOnly)}`);
      }
    }
    lines.push("    networks:");
    for (const network of service.networks) {
      lines.push(`      ${yamlString(network)}: null`);
    }
    if (service.secretRefs.length > 0) {
      lines.push("    secrets:");
      for (const secret of service.secretRefs) {
        const source = `${service.id}-${secret.name}`;
        lines.push(`      - source: ${yamlString(source)}`);
        lines.push(`        target: ${yamlString(secret.target)}`);
      }
    }
  }
  lines.push("networks:");
  for (const network of manifest.networks) {
    lines.push(`  ${yamlString(network.id)}:`);
    lines.push(`    name: ${yamlString(network.name)}`);
    if (network.ownership === "verified-existing") {
      lines.push("    external: true");
    } else {
      lines.push(`    driver: ${yamlString(network.driver)}`);
      lines.push(`    internal: ${String(network.internal)}`);
    }
  }
  const allSecrets = [];
  for (const service of manifest.services) {
    for (const secret of service.secretRefs) {
      allSecrets.push({ source: `${service.id}-${secret.name}`, ref: secret.ref });
    }
  }
  allSecrets.sort((left, right) => left.source.localeCompare(right.source));
  if (allSecrets.length > 0) {
    lines.push("secrets:");
    for (const secret of allSecrets) {
      lines.push(`  ${yamlString(secret.source)}:`);
      lines.push("    external: true");
      lines.push(`    name: ${yamlString(secret.ref)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function ensurePrivateOutputDirectory(manifest, outputDir) {
  const resolved = path.resolve(outputDir);
  if (outputDir !== resolved || resolved !== manifest.project.directory) {
    reject("output directory must exactly match project.directory");
  }
  let rootStat;
  try {
    rootStat = fs.lstatSync(manifest.project.root);
  } catch {
    reject("project.root must already exist");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    reject("project.root must be a non-symlink directory");
  }
  if (fs.realpathSync(manifest.project.root) !== manifest.project.root) {
    reject("project.root must not traverse symlinks");
  }
  let directoryStat = null;
  try {
    directoryStat = fs.lstatSync(resolved);
  } catch (error) {
    if (error.code !== "ENOENT") {
      reject("project directory could not be inspected");
    }
  }
  if (manifest.project.ownership === "new") {
    if (directoryStat === null) {
      fs.mkdirSync(resolved, { mode: 0o700 });
      directoryStat = fs.lstatSync(resolved);
    }
  } else if (directoryStat === null) {
    reject("verified existing project directory is missing");
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    reject("project directory must be a non-symlink directory");
  }
  if (fs.realpathSync(resolved) !== resolved) {
    reject("project directory must not traverse symlinks");
  }
  if ((directoryStat.mode & 0o077) !== 0) {
    reject("project directory must not grant group or other permissions");
  }
  if (typeof process.getuid === "function" && directoryStat.uid !== process.getuid()) {
    reject("project directory must be owned by the current numeric user");
  }
  if (manifest.project.ownership === "new") {
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0) {
      reject("new project directory must be absent or empty");
    }
  }
  return resolved;
}

function verifyExistingProjectDirectory(manifest) {
  let stat;
  try {
    stat = fs.lstatSync(manifest.project.directory);
  } catch {
    reject("project directory is unavailable");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    reject("project directory must be a non-symlink directory");
  }
  if (fs.realpathSync(manifest.project.directory) !== manifest.project.directory) {
    reject("project directory must not traverse symlinks");
  }
  if ((stat.mode & 0o077) !== 0) {
    reject("project directory must not grant group or other permissions");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    reject("project directory must be owned by the current numeric user");
  }
}

function verifyMountSources(manifest) {
  const sources = new Set();
  for (const service of manifest.services) {
    for (const mount of service.mounts) {
      sources.add(mount.source);
    }
  }
  for (const source of [...sources].sort()) {
    let stat;
    try {
      stat = fs.lstatSync(source);
    } catch {
      reject("a declared bind source is unavailable; Docker must not create it implicitly");
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      reject("declared bind sources must be regular files or directories without symlinks");
    }
    if (fs.realpathSync(source) !== source) {
      reject("declared bind sources must not traverse symlinks");
    }
  }
}

function atomicNoClobber(target, content) {
  const directory = path.dirname(target);
  const suffix = crypto.randomBytes(8).toString("hex");
  const temporary = path.join(directory, `.compose-render.${process.pid}.${suffix}.tmp`);
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.linkSync(temporary, target);
    const directoryDescriptor = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (error.code === "EEXIST") {
      reject("render target already exists; no file was overwritten");
    }
    if (error instanceof ValidationError) {
      throw error;
    }
    reject("atomic render failed");
  } finally {
    if (descriptor !== null) {
      fs.closeSync(descriptor);
    }
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") {
        reject("temporary render cleanup failed");
      }
    }
  }
}

function requirePass(manifest) {
  const assessment = buildAssessment(manifest);
  if (assessment.status !== "pass") {
    reject("manifest has blocked or conflicting ownership claims");
  }
}

function verifyLifecycleTarget(manifest, context, project, file) {
  requirePass(manifest);
  if (context !== manifest.project.dockerContext) {
    reject("lifecycle Docker context does not match the manifest");
  }
  if (project !== manifest.project.id) {
    reject("lifecycle project does not match the manifest");
  }
  const expected = renderTargetFor(manifest);
  if (file !== expected || path.resolve(file) !== expected) {
    reject("lifecycle file is not the deterministic render target");
  }
  verifyExistingProjectDirectory(manifest);
  verifyMountSources(manifest);
  let stat;
  try {
    stat = fs.lstatSync(expected);
  } catch {
    reject("rendered Compose file is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES) {
    reject("rendered Compose target must be a bounded regular non-symlink file");
  }
  const actual = fs.readFileSync(expected, "utf8");
  const expectedContent = renderCompose(manifest);
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expectedContent).digest();
  if (actualDigest.length !== expectedDigest.length || !crypto.timingSafeEqual(actualDigest, expectedDigest)) {
    reject("rendered Compose file does not match the validated manifest");
  }
  return expected;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = normalizeManifest(readInput(options.input));
  const plan = buildPlan(manifest);
  if (options.action === "validate") {
    writeJson({ valid: plan.status === "pass", status: plan.status, planId: plan.planId, renderTarget: plan.render.target, dockerInvoked: false });
    if (plan.status !== "pass") {
      process.exitCode = 3;
    }
    return;
  }
  if (options.action === "plan") {
    writeJson(plan);
    if (plan.status !== "pass") {
      process.exitCode = 3;
    }
    return;
  }
  if (options.action === "render") {
    requirePass(manifest);
    ensurePrivateOutputDirectory(manifest, options.outputDir);
    const target = renderTargetFor(manifest);
    const content = renderCompose(manifest);
    atomicNoClobber(target, content);
    writeJson({ status: "rendered", project: manifest.project.id, target, bytes: Buffer.byteLength(content), overwritten: false, dockerInvoked: false });
    return;
  }
  const target = verifyLifecycleTarget(manifest, options.context, options.project, options.file);
  writeJson({ valid: true, status: "pass", context: manifest.project.dockerContext, project: manifest.project.id, file: target, dockerInvoked: false });
}

try {
  main();
} catch (error) {
  if (error instanceof ValidationError) {
    process.stderr.write(`compose-project.mjs: ${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write("compose-project.mjs: unexpected failure\n");
  process.exit(2);
}
