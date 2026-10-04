#!/usr/bin/env bun

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { checkedManualProbe } from "../../selfhost/references/catalog/types/manual-job.ts";
import { checkedDockerCliTlsClaim, dockerCliTlsTargets } from "../../selfhost/references/catalog/types/docker-cli-tls.ts";
import { checkedRuntimeResourceClaim, runtimeResourceEffects, verifyRuntimeResourceDevice } from "../../selfhost/references/catalog/types/runtime-resources.ts";
import { checkedOwnerDirectoryClaim, assertOwnerDirectoryService, ownerDirectoryFields } from "../../selfhost/references/catalog/types/owner-directory.ts";
import { isCredentialLoggingPolicy, isDisabledCredentialLoggingPolicy, isPassboltNonSecretIdentity, isPublicOidcEnvironment } from "../../selfhost/references/catalog/types/non-secret-policy.ts";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 512;
const MAX_DEPTH = 12;
const MAX_STRING = 2048;
const MAX_SECRET_FILE_BYTES = 64 * 1024;
const FLOATING_TAGS = new Set(["latest", "stable", "edge", "main", "master", "nightly", "rolling", "current", "dev"]);
const PROTECTED_PURPOSES = new Set(["admin", "database", "management", "docker-api"]);
const PROTECTED_PORTS = new Set([22, 2375, 2376, 3306, 5432, 6379, 27017]);
const RESTART_POLICIES = new Set(["no", "always", "on-failure", "unless-stopped"]);
const OWNERSHIP_MODES = new Set(["new", "verified-existing"]);
const FORBIDDEN_KEYS = /^(?:privileged|network[_-]?mode|pid|ipc|devices?|cap[_-]?(?:add|drop)|security[_-]?opt|userns[_-]?mode)$/i;
const SENSITIVE_KEYS = /password|passwd|token|api[-_]?key|private[-_]?key|credential|secret/i;
const SECRET_REF_KEYS = /^(?:secretrefs?)$/i;
const SENSITIVE_ENV = /(?:^|_)(?:password|passwd|token|key|auth|authkey|apikey|credentials?|secret|cookie|database_url|dsn|connection_string)(?:_|$)/i;
const OPAQUE_REF = /^[a-z0-9][a-z0-9._:/-]{2,127}$/i;
const LABEL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const PROJECT_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const DOCKER_CONTEXT = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]{0,126}[a-zA-Z0-9])?$/;
const NETWORK_NAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]{0,126}[a-zA-Z0-9])?$/;
const VOLUME_LABEL_PROJECT = "io.selfhost.project";
const VOLUME_LABEL_MOUNT = "io.selfhost.volume";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const DEPENDENCY_CONDITIONS = new Set(["service_started", "service_healthy", "service_completed_successfully"]);
const IMAGE_USER_REASONS = new Set(["upstream-init-requires-default-user", "image-declares-nonroot-user", "official-image-runtime-contract"]);
const ROOTLESS_USER_EVIDENCE = {
  officialUrl: "https://docs.docker.com/engine/security/rootless/",
  reason: "host-user-mapped-container-root"
};
const RUNTIME_ARG_SENSITIVE = /password|passwd|token|api[-_]?key|private[-_]?key|credential|secret|cookie|auth/i;
const FORBIDDEN_SOURCE_PREFIXES = ["/proc", "/sys", "/dev", "/run", "/var/run", "/var/lib/docker"];
const FORBIDDEN_ROOTS = new Set(["/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var"]);

class ValidationError extends Error {}

function usage() {
  process.stdout.write("Usage: compose-project.ts <validate|plan|render|automatic-services|lifecycle-check|volume-preflight|selected-plan|selected-check> --input FILE [--output-dir DIR] [--context NAME --project ID --file FILE] [--services IDS --operation start|stop|add|recreate|probe|remove --approval TOKEN] [--allow-new-volumes true]\n");
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
  if (!["validate", "plan", "render", "automatic-services", "apply-approval", "runtime-preflight", "probe-run", "lifecycle-check", "volume-preflight", "selected-plan", "selected-check"].includes(action)) {
    reject("unsupported action");
  }
  const options = { action, input: "", outputDir: "", context: "", project: "", file: "", services: "", operation: "", approval: "", requireExistingVolumes: "", allowNewVolumes: "" };
  const allowed = new Set(["--input", "--output-dir", "--context", "--project", "--file", "--services", "--operation", "--approval", "--require-existing-volumes", "--allow-new-volumes"]);
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag) || seen.has(flag)) {
      reject("unsupported option");
    }
    seen.add(flag);
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
    if (flag === "--services") options.services = value;
    if (flag === "--operation") options.operation = value;
    if (flag === "--approval") options.approval = value;
    if (flag === "--require-existing-volumes") options.requireExistingVolumes = value;
    if (flag === "--allow-new-volumes") options.allowNewVolumes = value;
  }
  if (!options.input) {
    reject("--input is required");
  }
  if (action === "render" && !options.outputDir) {
    reject("render requires --output-dir");
  }
  if (["lifecycle-check", "runtime-preflight", "volume-preflight", "selected-check", "probe-run"].includes(action) && (!options.context || !options.project || !options.file)) {
    reject("lifecycle-check requires --context, --project, and --file");
  }
  if (action !== "render" && options.outputDir) {
    reject("--output-dir is valid only for render");
  }
  if (!["lifecycle-check", "runtime-preflight", "volume-preflight", "selected-check", "probe-run"].includes(action) && (options.context || options.project || options.file)) {
    reject("--context, --project, and --file are valid only for lifecycle-check");
  }
  if (options.requireExistingVolumes && (action !== "volume-preflight" || options.requireExistingVolumes !== "true")) {
    reject("--require-existing-volumes=true is valid only for volume-preflight");
  }
  if (options.allowNewVolumes && (action !== "volume-preflight" || options.allowNewVolumes !== "true"
    || options.requireExistingVolumes)) {
    reject("--allow-new-volumes=true is valid only for volume-preflight without existing-only mode");
  }
  if (["selected-plan", "selected-check", "probe-run"].includes(action)) {
    if (!options.services || !["start", "stop", "add", "recreate", "probe", "remove"].includes(options.operation)) reject("selected lifecycle requires services and a supported operation");
    if (["selected-check", "probe-run"].includes(action) && !options.approval) reject("selected-check requires its exact approval");
    if (action === "probe-run" && options.operation !== "probe") reject("probe-run only accepts its fixed probe operation");
    if (action === "selected-plan" && options.approval) reject("selected-plan does not accept approval");
  } else if (options.services || options.operation || options.approval) reject("selection options require a selected lifecycle action");
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
    reject("input exceeds 2 MiB");
  }
  const content = fs.readFileSync(inputPath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_INPUT_BYTES) {
    reject("input exceeds 2 MiB");
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
      reject("an input collection exceeds 512 items");
    }
    for (const item of value) {
      assertBoundedAndSecretFree(item, depth + 1);
    }
    return;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_ITEMS) {
      reject("an input object exceeds 512 fields");
    }
    for (const [key, child] of entries) {
      if (key.length > 128) {
        reject("an input field name exceeds the supported limit");
      }
      if (FORBIDDEN_KEYS.test(key) && key !== "capDrop") {
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

function exactObjectWithOptional(value, requiredKeys, optionalKeys, context) {
  if (!isObject(value)) {
    reject(`${context} must be an object`);
  }
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      reject(`${context} contains an unsupported field`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      reject(`${context} is missing a required field`);
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

function privateSubnetRange(value) {
  if (typeof value !== "string") {
    reject("network.subnet must be a canonical RFC1918 IPv4 CIDR from /24 through /28");
  }
  const match = value.match(/^((?:0|[1-9]\d{0,2}))\.((?:0|[1-9]\d{0,2}))\.((?:0|[1-9]\d{0,2}))\.((?:0|[1-9]\d{0,2}))\/(2[4-8])$/);
  if (!match) {
    reject("network.subnet must be a canonical RFC1918 IPv4 CIDR from /24 through /28");
  }
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) {
    reject("network.subnet must be a canonical RFC1918 IPv4 CIDR from /24 through /28");
  }
  const prefix = Number(match[5]);
  const start = (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  if ((start & mask) >>> 0 !== start) {
    reject("network.subnet must use the canonical network address");
  }
  const end = start + (2 ** (32 - prefix)) - 1;
  const privateRanges = [
    [0x0a000000, 0x0affffff],
    [0xac100000, 0xac1fffff],
    [0xc0a80000, 0xc0a8ffff]
  ];
  const isPrivate = privateRanges.some(([privateStart, privateEnd]) => start >= privateStart && end <= privateEnd);
  if (!isPrivate) {
    reject("network.subnet must be contained in an RFC1918 private range");
  }
  return { start, end };
}

function requirePrivateSubnet(value) {
  privateSubnetRange(value);
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
  const imagePattern = /^(?:(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)(?::\d+)?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;
  if (!imagePattern.test(value)) {
    reject("service image reference is invalid");
  }
  if (/:latest@sha256:/i.test(value)) {
    reject("floating latest labels are not accepted even beside a digest");
  }
  const digestMatch = value.match(/@sha256:([a-f0-9]{64})$/i);
  if (digestMatch) {
    const repositoryAndTag = value.slice(0, value.lastIndexOf("@sha256:"));
    const tagSlash = repositoryAndTag.lastIndexOf("/");
    const tagColon = repositoryAndTag.lastIndexOf(":");
    if (tagColon > tagSlash) {
      const tag = repositoryAndTag.slice(tagColon + 1).toLowerCase();
      // The selected development channel still deploys an immutable digest.
      // Unpinned dev and the other floating-label policies remain unchanged.
      if (FLOATING_TAGS.has(tag) && tag !== "dev") {
        reject("floating image tags are not accepted");
      }
    }
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

function normalizeFileEnvironmentConsumers(value, environment, secretRefs) {
  const consumers = requireArray(value, "service.fileEnvironmentConsumers");
  if (consumers.length < 1 || consumers.length > 12) reject("file environment consumers must contain one to twelve entries");
  const result = consumers.map((entry) => {
    exactObject(entry, ["name", "target", "format", "officialUrl", "appId", "source"], "file environment consumer");
    const ownerPath = entry.format === "file-path" && entry.source === "owner";
    const generatedConfigPath = entry.format === "private-config-path" && entry.source === "generated-config";
    if ((!ownerPath && !generatedConfigPath)
      || typeof entry.name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(entry.name)
      || typeof entry.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.appId)) {
      reject("file environment consumer must name an owner-issued input or generated private configuration path");
    }
    const target = requireLabel(entry.target, "file environment consumer target");
    let officialUrl;
    try { officialUrl = new URL(entry.officialUrl); }
    catch { reject("file environment consumer requires HTTPS publisher evidence"); }
    if (officialUrl.protocol !== "https:" || officialUrl.username || officialUrl.password) {
      reject("file environment consumer requires HTTPS publisher evidence without credentials");
    }
    const publisher = new URL(`../../selfhost/references/catalog/apps/${entry.appId}/manifest.json`, import.meta.url);
    let app;
    try {
      const metadata = fs.lstatSync(publisher);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
        || metadata.size < 1 || metadata.size > 512 * 1024) reject("file environment publisher record is unsafe");
      app = JSON.parse(fs.readFileSync(publisher, "utf8"));
    } catch { reject("file environment consumer requires an installed publisher record"); }
    if (app.id !== entry.appId || !Array.isArray(app.sources) || !app.sources.includes(entry.officialUrl)) {
      reject("file environment evidence must exactly match a listed app publisher source");
    }
    if (!secretRefs.some((secret) => secret.target === target)
      || !environment.some((item) => item.name === entry.name && item.value === `/run/secrets/${target}`)) {
      reject("file environment consumer must match one declared secret target and exact environment path");
    }
    return { name: entry.name, target, format: entry.format, officialUrl: entry.officialUrl,
      appId: entry.appId, source: entry.source };
  });
  requireUnique(result.map((entry) => entry.name), "file environment consumer names");
  result.sort((left, right) => left.name.localeCompare(right.name));
  return result;
}

function normalizeEnvironment(value, secretRefs, mounts, fileEnvironmentConsumers = []) {
  const result = [];
  const seen = new Set();
  const entries = requireArray(value, "service.environment");
  for (const entry of entries) {
    exactObject(entry, ["name", "value"], "environment entry");
    if (typeof entry.name !== "string" || !ENV_NAME.test(entry.name)) {
      reject("secret-bearing or invalid environment names are not accepted; use secretRefs");
    }
    const fileVariable = entry.name.endsWith("_FILE") || entry.name.endsWith("_SECRETFILE")
      || /^FILE__[A-Z][A-Z0-9_]*$/.test(entry.name);
    const fileUri = typeof entry.value === "string" && entry.value.startsWith("file:/run/secrets/");
    const sourcedFilePath = fileEnvironmentConsumers.some((consumer) => consumer.name === entry.name
      && entry.value === `/run/secrets/${consumer.target}`);
    if (typeof entry.value === "string" && entry.value.startsWith("/run/secrets/")
      && !fileVariable && !sourcedFilePath) {
      reject("non-file environment names require a typed owner-file path consumer");
    }
    const enabledAuthFlag = entry.name === "auth" && entry.value === "true";
    const credentialLoggingDisabled = isDisabledCredentialLoggingPolicy(entry.name, entry.value);
    if (isCredentialLoggingPolicy(entry.name) && !credentialLoggingDisabled) {
      reject("credential logging policies accept only the literal false value");
    }
    // A deny-all access policy and its mounted auth database are configuration,
    // not a plaintext credential or a secret-input file. Keep the pair bounded.
    const authPolicy = /^[A-Z][A-Z0-9_]*_AUTH_DEFAULT_ACCESS$/.test(entry.name)
      && entry.value === "deny-all";
    const authStore = /^([A-Z][A-Z0-9_]*)_AUTH_FILE$/.exec(entry.name);
    let mountedAuthStore = false;
    if (authStore && typeof entry.value === "string" && !entry.value.startsWith("/run/secrets/")) {
      const prefix = authStore[1];
      const deniedByDefault = entries.some((item) => item.name === `${prefix}_AUTH_DEFAULT_ACCESS`
        && item.value === "deny-all");
      const filePath = requireAbsolutePath(entry.value, "auth database path", true);
      mountedAuthStore = deniedByDefault && mounts.some((mount) => !mount.readOnly
        && filePath.startsWith(`${mount.target}/`));
    }
    // A cache beside that same persistent deny-all auth store is also a path,
    // not a secret-input file. Do not broaden arbitrary *_FILE consumers.
    const cacheStore = /^([A-Z][A-Z0-9_]*)_CACHE_FILE$/.exec(entry.name);
    let mountedPrivateCache = false;
    if (cacheStore && typeof entry.value === "string" && !entry.value.startsWith("/run/secrets/")) {
      const prefix = cacheStore[1];
      const authFile = entries.find((item) => item.name === `${prefix}_AUTH_FILE`);
      const deniedByDefault = entries.some((item) => item.name === `${prefix}_AUTH_DEFAULT_ACCESS`
        && item.value === "deny-all");
      const cachePath = requireAbsolutePath(entry.value, "persistent cache path", true);
      if (deniedByDefault && typeof authFile?.value === "string" && authFile.value !== cachePath
        && !authFile.value.startsWith("/run/secrets/")) {
        const authPath = requireAbsolutePath(authFile.value, "auth database path", true);
        mountedPrivateCache = mounts.some((mount) => !mount.readOnly
          && cachePath.startsWith(`${mount.target}/`) && authPath.startsWith(`${mount.target}/`));
      }
    }
    if (SENSITIVE_ENV.test(entry.name) && !fileVariable && !fileUri && !sourcedFilePath && !enabledAuthFlag && !authPolicy && !credentialLoggingDisabled && !isPassboltNonSecretIdentity(entry.name, entry.value) && !isPublicOidcEnvironment(entry.name, entry.value)) {
      reject("secret-bearing or invalid environment names are not accepted; use secretRefs");
    }
    if ((fileVariable || fileUri || sourcedFilePath) && !mountedAuthStore && !mountedPrivateCache) {
      let prefix = "";
      if (fileUri) prefix = "file:";
      const matchingSecret = secretRefs.find((secret) => entry.value === `${prefix}/run/secrets/${secret.target}`);
      if (!matchingSecret) {
        reject("file-backed environment values must exactly name a declared /run/secrets target");
      }
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

function volumeMountId(name, projectId) {
  const prefix = `${projectId}-`;
  if (typeof name !== "string" || !NETWORK_NAME.test(name) || !name.startsWith(prefix)) {
    reject("volume name must be scoped to the exact Compose project");
  }
  return requireLabel(name.slice(prefix.length), "volume mount id");
}

function volumeLabels(projectId, name) {
  return {
    "com.docker.compose.project": projectId,
    "com.docker.compose.volume": name,
    [VOLUME_LABEL_PROJECT]: projectId,
    [VOLUME_LABEL_MOUNT]: volumeMountId(name, projectId)
  };
}

function normalizeMount(value, projectOwner, projectId) {
  if (value?.kind === "volume") {
    exactObject(value, ["kind", "name", "target", "readOnly", "owner", "ownership"], "volume mount");
    volumeMountId(value.name, projectId);
    const target = requireAbsolutePath(value.target, "mount target", true);
    const readOnly = requireBoolean(value.readOnly, "mount.readOnly");
    const owner = requireLabel(value.owner, "mount.owner");
    const ownership = requireOwnership(value.ownership, "mount.ownership");
    if (owner !== projectOwner) reject("named volumes must be project-owned");
    return { kind: "volume", name: value.name, target, readOnly, owner, ownership };
  }
  exactObjectWithOptional(value, ["source", "target", "readOnly", "shared", "owner", "ownership"], ["kind", "shareGroup"], "mount");
  if (Object.hasOwn(value, "kind") && value.kind !== "bind") reject("mount kind is unsupported");
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
  let shareGroup = null;
  if (Object.hasOwn(value, "shareGroup")) {
    shareGroup = requireLabel(value.shareGroup, "mount.shareGroup");
    if (!shared) {
      reject("mount.shareGroup requires an explicit shared mount");
    }
  }
  if (!readOnly && shared && shareGroup === null) {
    reject("shared read-write mounts require an explicit shareGroup");
  }
  const result = { source, target, readOnly, shared, owner, ownership };
  if (shareGroup !== null) {
    result.shareGroup = shareGroup;
  }
  return result;
}

function normalizeSecretRef(value, projectDirectory, tlsTargets = []) {
  exactObjectWithOptional(value, ["name", "ref", "target"], ["filePath"], "secret reference");
  const name = requireLabel(value.name, "secret reference name");
  const ref = requireOpaqueRef(value.ref, "secret ref");
  let target;
  if (tlsTargets.some((binding) => binding.target === value.target && binding.fileId === name)) target = value.target;
  else target = requireLabel(value.target, "secret target");
  if (!Object.hasOwn(value, "filePath")) {
    return { name, ref, target };
  }
  const filePath = requireAbsolutePath(value.filePath, "secret filePath");
  const secretsDirectory = path.posix.join(projectDirectory, "secrets");
  if (!filePath.startsWith(`${secretsDirectory}/`)) {
    reject("secret filePath must be inside project.directory/secrets");
  }
  return { name, ref, target, filePath };
}

function normalizeArgv(value, context, secretRefs = [], mounts = []) {
  const argv = requireArray(value, context);
  if (argv.length === 0 || argv.length > 32) {
    reject(`${context} must contain 1 to 32 arguments`);
  }
  return argv.map((argument) => {
    const normalized = requireText(argument, `${context} argument`);
    const configArgument = /^(--[a-z][a-z-]*=)?(\/run\/secrets\/[a-z0-9-]+)$/.exec(normalized);
    // A documented file option may name a mounted secret; it must never carry
    // the password itself or point outside this service's declared references.
    const secretFileOption = configArgument?.[1] === "--admin-password-file=";
    const declaredConfig = configArgument !== null
      && (secretFileOption || !RUNTIME_ARG_SENSITIVE.test(configArgument[1] ?? ""))
      && secretRefs.some((reference) => configArgument[2] === `/run/secrets/${reference.target}`);
    const generatedFilePath = mounts.some((mount) => mount.kind !== "volume" && mount.readOnly === true
      && mount.target === normalized && /\/config-files\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mount.source));
    if ((RUNTIME_ARG_SENSITIVE.test(normalized) && !declaredConfig && !generatedFilePath) || normalized.includes("$")) {
      reject(`${context} must not contain secret-bearing or interpolated arguments`);
    }
    return normalized;
  });
}

function normalizeHealthcheck(value) {
  exactObject(value, ["test", "intervalSeconds", "timeoutSeconds", "startPeriodSeconds", "retries"], "healthcheck");
  const test = normalizeArgv(value.test, "healthcheck.test");
  if (test[0] !== "CMD" || test.length < 2) {
    reject("healthcheck.test must be a CMD argv list");
  }
  return {
    test,
    intervalSeconds: requireInteger(value.intervalSeconds, "healthcheck.intervalSeconds", 1, 3600),
    timeoutSeconds: requireInteger(value.timeoutSeconds, "healthcheck.timeoutSeconds", 1, 300),
    startPeriodSeconds: requireInteger(value.startPeriodSeconds, "healthcheck.startPeriodSeconds", 0, 3600),
    retries: requireInteger(value.retries, "healthcheck.retries", 1, 20)
  };
}

function normalizeDependsOn(value) {
  const dependencies = requireArray(value, "service.dependsOn").map((dependency) => {
    exactObject(dependency, ["service", "condition"], "service dependency");
    const service = requireLabel(dependency.service, "dependency service");
    if (!DEPENDENCY_CONDITIONS.has(dependency.condition)) {
      reject("dependency condition is unsupported");
    }
    return { service, condition: dependency.condition };
  });
  dependencies.sort((left, right) => left.service.localeCompare(right.service));
  requireUnique(dependencies.map((dependency) => dependency.service), "dependency services per service");
  return dependencies;
}

function normalizeImageUserEvidence(value) {
  exactObject(value, ["officialUrl", "reason"], "imageUserEvidence");
  const officialUrl = requireText(value.officialUrl, "imageUserEvidence.officialUrl");
  let parsed;
  try {
    parsed = new URL(officialUrl);
  } catch {
    reject("imageUserEvidence.officialUrl must be an HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    reject("imageUserEvidence.officialUrl must be an HTTPS URL without credentials or fragments");
  }
  if (!IMAGE_USER_REASONS.has(value.reason)) {
    reject("imageUserEvidence.reason is unsupported");
  }
  return { officialUrl, reason: value.reason };
}

function normalizeRootlessUserEvidence(value) {
  exactObject(value, ["officialUrl", "reason"], "rootlessUserEvidence");
  if (value.officialUrl !== ROOTLESS_USER_EVIDENCE.officialUrl || value.reason !== ROOTLESS_USER_EVIDENCE.reason) {
    reject("rootlessUserEvidence must cite the supported Docker rootless UID mapping contract");
  }
  return { ...ROOTLESS_USER_EVIDENCE };
}

function normalizeService(value, projectOwner, projectId, projectDirectory, dockerContext) {
  exactObjectWithOptional(value, ["id", "image", "restart", "readOnly", "user", "environment", "ports", "mounts", "networks", "secretRefs"], ["command", "entrypoint", "healthcheck", "dependsOn", "imageUserEvidence", "rootlessUserEvidence", "shmSizeBytes", "ulimits", "capDrop", "memoryLimitBytes", "cpuLimit", "tmpfs", "networkAliases", "ownership", "init", "envFilePath", "profiles", "hostname", "manualProbe", "fileEnvironmentConsumers", "runtimeResources", "ownerDirectory", "dockerCliTls"], "service");
  const id = requireLabel(value.id, "service.id");
  const image = requireImage(value.image);
  if (!RESTART_POLICIES.has(value.restart)) {
    reject("service.restart is unsupported");
  }
  const readOnly = requireBoolean(value.readOnly, "service.readOnly");
  let imageUserEvidence = null;
  let rootlessUserEvidence = null;
  if (value.user === "image-default") {
    if (!Object.hasOwn(value, "imageUserEvidence")) {
      reject("image-default requires official imageUserEvidence");
    }
    imageUserEvidence = normalizeImageUserEvidence(value.imageUserEvidence);
    if (Object.hasOwn(value, "rootlessUserEvidence")) {
      reject("rootlessUserEvidence is valid only with user 0:0");
    }
  } else if (value.user === "0:0") {
    if (dockerContext !== "rootless") {
      reject("service.user 0:0 is allowed only for the exact rootless Docker context");
    }
    if (!Object.hasOwn(value, "rootlessUserEvidence")) {
      reject("service.user 0:0 requires rootlessUserEvidence");
    }
    rootlessUserEvidence = normalizeRootlessUserEvidence(value.rootlessUserEvidence);
    if (Object.hasOwn(value, "imageUserEvidence")) {
      reject("imageUserEvidence is valid only with user image-default");
    }
  } else {
    if (typeof value.user !== "string" || !/^\d{1,10}:\d{1,10}$/.test(value.user)) {
      reject("service.user must be a numeric uid:gid, evidenced rootless 0:0, or image-default");
    }
    const userParts = value.user.split(":").map(Number);
    if (userParts[0] === 0 || userParts[1] === 0) {
      reject("service.user must not use the root uid or gid");
    }
    if (Object.hasOwn(value, "imageUserEvidence")) {
      reject("imageUserEvidence is valid only with user image-default");
    }
    if (Object.hasOwn(value, "rootlessUserEvidence")) {
      reject("rootlessUserEvidence is valid only with user 0:0");
    }
  }
  let dockerCliTls;
  let tlsTargets = [];
  if (value.dockerCliTls !== undefined) {
    dockerCliTls = checkedDockerCliTlsClaim(new URL("../../selfhost/references/catalog/", import.meta.url), id, image, value.dockerCliTls);
    const { appId, sourceSha256, ...request } = dockerCliTls;
    tlsTargets = dockerCliTlsTargets(request);
  }
  const secretRefs = requireArray(value.secretRefs, "service.secretRefs").map((secret) => normalizeSecretRef(secret, projectDirectory, tlsTargets));
  secretRefs.sort((left, right) => left.name.localeCompare(right.name));
  const ports = requireArray(value.ports, "service.ports").map(normalizePort);
  ports.sort(comparePorts);
  const mounts = requireArray(value.mounts, "service.mounts").map((mount) => normalizeMount(mount, projectOwner, projectId));
  mounts.sort((left, right) => `${left.source ?? left.name}\0${left.target}`.localeCompare(`${right.source ?? right.name}\0${right.target}`));
  requireUnique(mounts.map((mount) => mount.target), "mount targets per service");
  let fileEnvironmentConsumers;
  if (Object.hasOwn(value, "fileEnvironmentConsumers")) {
    fileEnvironmentConsumers = normalizeFileEnvironmentConsumers(value.fileEnvironmentConsumers,
      requireArray(value.environment, "service.environment"), secretRefs);
  }
  const environment = normalizeEnvironment(value.environment, secretRefs, mounts, fileEnvironmentConsumers);
  if (dockerCliTls) {
    if (!tlsTargets.every((binding) => secretRefs.filter((secret) => secret.name === binding.fileId
      && secret.target === binding.target && typeof secret.filePath === "string").length === 1)
      || environment.filter((entry) => entry.name === "DOCKER_CERT_PATH" && entry.value === "/run/secrets").length !== 1
      || environment.filter((entry) => entry.name === "DOCKER_TLS_VERIFY" && entry.value === "1").length !== 1
      || environment.filter((entry) => entry.name === "DOCKER_HOST"
        && entry.value === `tcp://${dockerCliTls.endpoint.serverName}:${dockerCliTls.endpoint.port}`).length !== 1
      || environment.some((entry) => ["DOCKER_TLS", "DOCKER_CONTEXT", "DOCKER_CONFIG"].includes(entry.name))) {
      reject("Docker CLI TLS requires its exact owner file targets and generated verified-TLS directory environment");
    }
  }
  const networks = requireArray(value.networks, "service.networks").map((network) => requireLabel(network, "service network"));
  networks.sort();
  if (networks.length === 0 || new Set(networks).size !== networks.length) {
    reject("each service needs unique explicit networks");
  }
  let networkAliases;
  if (Object.hasOwn(value, "networkAliases")) {
    networkAliases = requireArray(value.networkAliases, "service.networkAliases").map((entry) => {
      exactObject(entry, ["network", "alias"], "service network alias");
      const network = requireLabel(entry.network, "service network alias network");
      const alias = requireLabel(entry.alias, "service network alias name");
      if (!networks.includes(network)) reject("service network alias must target an attached network");
      return { network, alias };
    });
    networkAliases.sort((left, right) => `${left.network}\0${left.alias}`.localeCompare(`${right.network}\0${right.alias}`));
    requireUnique(networkAliases.map((entry) => `${entry.network}\0${entry.alias}`), "network aliases per service");
  }
  const secretNames = new Set();
  const secretTargets = new Set();
  for (const secret of secretRefs) {
    if (secretNames.has(secret.name) || secretTargets.has(secret.target)) {
      reject("secret names and targets must be unique per service");
    }
    secretNames.add(secret.name);
    secretTargets.add(secret.target);
  }
  const result = { id, image, restart: value.restart, readOnly, user: value.user, environment, ports, mounts, networks, secretRefs };
  if (Object.hasOwn(value, "ownerDirectory")) {
    try {
      result.ownerDirectory = checkedOwnerDirectoryClaim(new URL("../../selfhost/references/catalog/", import.meta.url), id, image, value.ownerDirectory);
      assertOwnerDirectoryService(projectDirectory, value, result.ownerDirectory);
    } catch { reject("ownerDirectory must match exact reviewed source, image, numeric user and derived same-path bind/environment"); }
  }
  if (Object.hasOwn(value, "runtimeResources")) {
    try { result.runtimeResources = checkedRuntimeResourceClaim(new URL("../../selfhost/references/catalog/", import.meta.url), id, image, value.runtimeResources); }
    catch { reject("runtimeResources must match exact reviewed installed app source and image"); }
    if (value.capDrop !== undefined || value.profiles !== undefined) reject("network tunnel resources cannot combine capability dropping or manual execution");
  }
  if (fileEnvironmentConsumers !== undefined) result.fileEnvironmentConsumers = fileEnvironmentConsumers;
  if (Object.hasOwn(value, "profiles")) {
    if (!Array.isArray(value.profiles) || value.profiles.length !== 1
      || value.profiles[0] !== "self-host-manual" || value.restart !== "no" || ports.length > 0) {
      reject("manual jobs require only the self-host-manual profile, restart no, and no published ports");
    }
    result.profiles = ["self-host-manual"];
  }
  if (Object.hasOwn(value, "hostname")) {
    if (typeof value.hostname !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value.hostname)) {
      reject("service hostname must be one bounded lowercase DNS label");
    }
    result.hostname = value.hostname;
  }
  if (Object.hasOwn(value, "manualProbe")) {
    if (!result.profiles || mounts.some((mount) => mount.kind === "volume")) {
      reject("manualProbe requires an inert manual job without implicit named-volume creation");
    }
    try { result.manualProbe = checkedManualProbe(image, value.manualProbe); }
    catch { reject("manualProbe must exactly match a fixed catalog version command, image and official source"); }
  }
  if (Object.hasOwn(value, "envFilePath")) {
    const envFilePath = requireAbsolutePath(value.envFilePath, "service.envFilePath");
    if (!envFilePath.startsWith(`${path.posix.join(projectDirectory, "secrets")}/`)
      || !envFilePath.endsWith(".env")) reject("envFilePath must be a private project secret env file");
    result.envFilePath = envFilePath;
  }
  if (Object.hasOwn(value, "init")) {
    if (value.init !== true) reject("service.init must be explicitly true");
    result.init = true;
  }
  if (Object.hasOwn(value, "ownership")) result.ownership = requireOwnership(value.ownership, "service.ownership");
  if (dockerCliTls) result.dockerCliTls = dockerCliTls;
  if (networkAliases) result.networkAliases = networkAliases;
  if (imageUserEvidence) {
    result.imageUserEvidence = imageUserEvidence;
  }
  if (rootlessUserEvidence) {
    result.rootlessUserEvidence = rootlessUserEvidence;
  }
  if (Object.hasOwn(value, "command")) {
    result.command = normalizeArgv(value.command, "service.command", secretRefs, result.mounts);
  }
  if (Object.hasOwn(value, "entrypoint")) {
    result.entrypoint = normalizeArgv(value.entrypoint, "service.entrypoint");
  }
  if (Object.hasOwn(value, "healthcheck")) {
    result.healthcheck = normalizeHealthcheck(value.healthcheck);
  }
  if (Object.hasOwn(value, "dependsOn")) {
    result.dependsOn = normalizeDependsOn(value.dependsOn);
  }
  if (Object.hasOwn(value, "shmSizeBytes")) {
    result.shmSizeBytes = requireInteger(value.shmSizeBytes, "service.shmSizeBytes", 1024 * 1024, 1024 * 1024 * 1024);
  }
  if (Object.hasOwn(value, "ulimits")) {
    exactObject(value.ulimits, ["nofile"], "service ulimits");
    exactObject(value.ulimits.nofile, ["soft", "hard"], "service nofile limits");
    const soft = requireInteger(value.ulimits.nofile.soft, "nofile soft", 1024, 1048576);
    const hard = requireInteger(value.ulimits.nofile.hard, "nofile hard", 1024, 1048576);
    if (soft > hard) reject("nofile soft limit must not exceed its hard limit");
    result.ulimits = { nofile: { soft, hard } };
  }
  if (Object.hasOwn(value, "capDrop")) {
    if (!Array.isArray(value.capDrop) || value.capDrop.length !== 1 || value.capDrop[0] !== "ALL") {
      reject("service capDrop accepts only ALL");
    }
    result.capDrop = ["ALL"];
  }
  if (Object.hasOwn(value, "memoryLimitBytes")) {
    result.memoryLimitBytes = requireInteger(value.memoryLimitBytes, "service memory limit", 67108864, 17179869184);
  }
  if (Object.hasOwn(value, "cpuLimit")) {
    if (typeof value.cpuLimit !== "number" || value.cpuLimit < 0.1 || value.cpuLimit > 16
      || !Number.isInteger(value.cpuLimit * 10)) reject("service CPU limit must be 0.1–16 in tenth increments");
    result.cpuLimit = value.cpuLimit;
  }
  if (Object.hasOwn(value, "tmpfs")) {
    const entries = requireArray(value.tmpfs, "service.tmpfs");
    if (entries.length > 8) reject("service.tmpfs supports at most eight paths");
    const tmpfs = entries.map((entry) => {
      exactObject(entry, ["target", "sizeBytes", "mode"], "service tmpfs");
      const target = requireAbsolutePath(entry.target, "tmpfs target", true);
      if (/[:,\s]/.test(target)) reject("tmpfs target must not contain mount-option delimiters or whitespace");
      return {
        target,
        sizeBytes: requireInteger(entry.sizeBytes, "tmpfs sizeBytes", 1024 * 1024, 1024 * 1024 * 1024),
        mode: requireInteger(entry.mode, "tmpfs mode", 0, 0o1777)
      };
    });
    tmpfs.sort((left, right) => left.target.localeCompare(right.target));
    requireUnique(tmpfs.map((entry) => entry.target), "tmpfs targets per service");
    for (let index = 0; index < tmpfs.length; index += 1) {
      const entry = tmpfs[index];
      if (pathsOverlap(entry.target, "/run/secrets")
        || mounts.some((mount) => pathsOverlap(entry.target, mount.target))
        || tmpfs.slice(index + 1).some((other) => pathsOverlap(entry.target, other.target))) {
        reject("tmpfs targets must not overlap persistent mounts, secrets, or other tmpfs paths");
      }
    }
    result.tmpfs = tmpfs;
  }
  return result;
}

function validateDependencyGraph(services) {
  const serviceById = new Map(services.map((service) => [service.id, service]));
  for (const service of services) {
    for (const dependency of service.dependsOn ?? []) {
      const target = serviceById.get(dependency.service);
      if (!target) {
        reject("a service dependency references an undeclared service");
      }
      if (target.profiles && !service.profiles) {
        reject("automatic services must not depend on manual jobs");
      }
      if (dependency.condition === "service_healthy" && !target.healthcheck) {
        reject("service_healthy requires a healthcheck on the dependency");
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(serviceId) {
    if (visiting.has(serviceId)) {
      reject("service dependency graph must be acyclic");
    }
    if (visited.has(serviceId)) {
      return;
    }
    visiting.add(serviceId);
    const service = serviceById.get(serviceId);
    for (const dependency of service.dependsOn ?? []) {
      visit(dependency.service);
    }
    visiting.delete(serviceId);
    visited.add(serviceId);
  }
  for (const service of services) {
    visit(service.id);
  }
}

function normalizeNetwork(value) {
  exactObjectWithOptional(value, ["id", "name", "driver", "internal", "owner", "ownership"], ["subnet"], "network");
  const id = requireLabel(value.id, "network.id");
  const name = requireNetworkName(value.name);
  if (value.driver !== "bridge") {
    reject("only bridge networks are accepted");
  }
  const internal = requireBoolean(value.internal, "network.internal");
  const owner = requireLabel(value.owner, "network.owner");
  const ownership = requireOwnership(value.ownership, "network.ownership");
  const result = { id, name, driver: value.driver, internal, owner, ownership };
  if (Object.hasOwn(value, "subnet")) {
    if (ownership !== "new") {
      reject("network.subnet is valid only for new project-owned networks");
    }
    result.subnet = requirePrivateSubnet(value.subnet);
  }
  return result;
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
  if (typeof value.name !== "string" || !NETWORK_NAME.test(value.name)) {
    reject("observed network name is invalid or unsafe");
  }
  return { name: value.name, owner: requireLabel(value.owner, "observed network owner") };
}

function normalizeObservedVolume(value, projectId) {
  exactObject(value, ["name", "driver", "owner", "labels"], "observed volume");
  if (typeof value.name !== "string" || !NETWORK_NAME.test(value.name)) reject("observed volume name is invalid");
  const driver = requireLabel(value.driver, "observed volume driver");
  const owner = requireLabel(value.owner, "observed volume owner");
  const labels = volumeLabels(projectId, value.name);
  exactObject(value.labels, Object.keys(labels), "observed volume labels");
  for (const key of Object.keys(labels)) {
    if (value.labels[key] !== null && (typeof value.labels[key] !== "string" || value.labels[key].length > 128)) {
      reject("observed volume labels are invalid");
    }
  }
  return { name: value.name, driver, owner, labels: { ...value.labels } };
}

function normalizeObserved(value, projectId) {
  exactObjectWithOptional(value, ["checkedAt", "project", "ports", "paths", "networks"], ["volumes"], "observed");
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
  if (Object.hasOwn(value, "volumes")) {
    result.volumes = requireArray(value.volumes, "observed.volumes").map((volume) => normalizeObservedVolume(volume, projectId));
    result.volumes.sort((left, right) => left.name.localeCompare(right.name));
    requireUnique(result.volumes.map((volume) => volume.name), "observed volume names");
  }
  return result;
}

function normalizeManifest(input) {
  exactObject(input, ["schemaVersion", "project", "services", "networks", "observed"], "manifest");
  if (input.schemaVersion !== 1) {
    reject("schemaVersion must be 1");
  }
  const projectId = requireProjectId(input.project?.id);
  const observed = normalizeObserved(input.observed, projectId);
  const project = normalizeProject(input.project, observed.project);
  const services = requireArray(input.services, "services").map((service) => normalizeService(service, project.owner, project.id, project.directory, project.dockerContext));
  const networks = requireArray(input.networks, "networks").map(normalizeNetwork);
  if (services.length === 0 || networks.length === 0) {
    reject("at least one service and network are required");
  }
  services.sort((left, right) => left.id.localeCompare(right.id));
  networks.sort((left, right) => left.id.localeCompare(right.id));
  requireUnique(services.map((service) => service.id), "service IDs");
  const volumeOwners = new Map();
  for (const service of services) {
    for (const mount of service.mounts) {
      if (mount.kind !== "volume") continue;
      const previous = volumeOwners.get(mount.name);
      if (previous && (previous.service === service.id || previous.target !== mount.target
        || previous.readOnly !== mount.readOnly || previous.owner !== mount.owner
        || previous.ownership !== mount.ownership)) {
        reject("a shared named volume needs identical target, access, and project ownership across distinct services");
      }
      if (!previous) volumeOwners.set(mount.name, { ...mount, service: service.id });
    }
  }
  if (volumeOwners.size > 0 && project.owner !== project.id) {
    reject("named volume owner must equal the Compose project ID recorded by ownership labels");
  }
  if (volumeOwners.size > 0 && !Array.isArray(observed.volumes)) {
    reject("named volumes require explicit observed.volumes evidence");
  }
  validateDependencyGraph(services);
  requireUnique(networks.map((network) => network.id), "network IDs");
  requireUnique(networks.map((network) => network.name), "network names");
  const selectedSubnets = networks.filter((network) => network.subnet !== undefined);
  for (let leftIndex = 0; leftIndex < selectedSubnets.length; leftIndex += 1) {
    const leftRange = privateSubnetRange(selectedSubnets[leftIndex].subnet);
    for (let rightIndex = leftIndex + 1; rightIndex < selectedSubnets.length; rightIndex += 1) {
      const rightRange = privateSubnetRange(selectedSubnets[rightIndex].subnet);
      if (leftRange.start <= rightRange.end && rightRange.start <= leftRange.end) {
        reject("selected network subnets must not overlap");
      }
    }
  }
  const networkIds = new Set(networks.map((network) => network.id));
  const networkNames = new Map();
  for (const service of services) {
    for (const network of service.networks) {
      if (!networkIds.has(network)) {
        reject("a service references an undeclared network");
      }
      const name = `${network}\0${service.id}`;
      if (networkNames.has(name) && networkNames.get(name) !== service.id) {
        reject("a service name conflicts with a network alias");
      }
      networkNames.set(name, service.id);
    }
  }
  for (const service of services) {
    for (const entry of service.networkAliases ?? []) {
      const name = `${entry.network}\0${entry.alias}`;
      if (networkNames.has(name) && networkNames.get(name) !== service.id) {
        reject("network aliases must uniquely identify one service on each network");
      }
      networkNames.set(name, service.id);
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
  const desiredVolumes = [];
  for (const service of manifest.services) {
    for (const port of service.ports) {
      desiredPorts.push({ ...port, service: service.id });
    }
    for (const mount of service.mounts) {
      if (mount.kind === "volume") {
        desiredVolumes.push({ ...mount, service: service.id });
      } else {
        desiredMounts.push({ ...mount, service: service.id });
      }
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
      const sameReadOnlyShare = left.readOnly && right.readOnly && left.shareGroup === right.shareGroup;
      const sameOwnedGroup = left.shareGroup && left.shareGroup === right.shareGroup
        && left.owner === project.owner;
      const safeShared = left.source === right.source && left.shared && right.shared
        && left.owner === right.owner && left.ownership === right.ownership
        && (sameReadOnlyShare || sameOwnedGroup);
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

  const uniqueDesiredVolumes = [...new Map(desiredVolumes.map((volume) => [volume.name, volume])).values()];
  for (const desired of uniqueDesiredVolumes) {
    const current = observed.volumes.find((volume) => volume.name === desired.name);
    if (desired.ownership === "new") {
      if (current) conflicts.push({ kind: "volume", resource: desired.name, reason: "volume-already-observed" });
      continue;
    }
    if (!current) {
      blockers.push({ kind: "volume", resource: desired.name, reason: "ownership-evidence-missing" });
      continue;
    }
    const expectedLabels = volumeLabels(project.id, desired.name);
    const labelsMatch = Object.entries(expectedLabels).every(([key, value]) => current.labels[key] === value);
    if (current.driver !== "local" || current.owner !== project.owner || !labelsMatch) {
      conflicts.push({ kind: "volume", resource: desired.name, reason: "ownership-mismatch" });
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

function manifestSha256(manifest) {
  const content = stableStringify(canonicalManifest(manifest));
  return crypto.createHash("sha256").update(content).digest("hex");
}

function planIdFor(manifest) {
  return manifestSha256(manifest).slice(0, 16);
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
  const volumes = [];
  const secretRefs = [];
  for (const service of manifest.services) {
    const serviceClaim = {
      id: service.id,
      image: service.image,
      environmentNames: service.environment.map((entry) => entry.name),
      networks: service.networks,
      secretRefNames: service.secretRefs.map((entry) => entry.name)
    };
    if (service.user === "image-default") {
      serviceClaim.user = "image-default";
      serviceClaim.imageUserEvidence = service.imageUserEvidence;
    }
    if (service.user === "0:0") {
      serviceClaim.user = "0:0";
      serviceClaim.rootlessUserEvidence = service.rootlessUserEvidence;
    }
    if (service.shmSizeBytes !== undefined) {
      serviceClaim.shmSizeBytes = service.shmSizeBytes;
    }
    if (service.tmpfs !== undefined) serviceClaim.tmpfs = service.tmpfs;
    if (service.ulimits !== undefined) serviceClaim.ulimits = service.ulimits;
    if (service.capDrop !== undefined) serviceClaim.capDrop = service.capDrop;
    if (service.runtimeResources !== undefined) serviceClaim.runtimeResources = { ...service.runtimeResources, ...runtimeResourceEffects(service.runtimeResources) };
    if (service.dockerCliTls !== undefined) {
      const { appId, sourceSha256, ...request } = service.dockerCliTls;
      serviceClaim.dockerCliTls = { ...service.dockerCliTls, certificateDirectory: "/run/secrets",
        fixedTargets: dockerCliTlsTargets(request), endpointMapping: { ...service.dockerCliTls.endpoint } };
    }
    if (service.ownerDirectory !== undefined) serviceClaim.ownerDirectory = { ...service.ownerDirectory,
      path: ownerDirectoryFields(manifest.project.directory, service.ownerDirectory.appId).path,
      user: service.user, authority: "docker-management-mtls-same-local-daemon", hostWideDockerControl: true };
    if (service.memoryLimitBytes !== undefined) serviceClaim.memoryLimitBytes = service.memoryLimitBytes;
    if (service.cpuLimit !== undefined) serviceClaim.cpuLimit = service.cpuLimit;
    if (service.readOnly) serviceClaim.readOnly = true;
    if (service.profiles) {
      serviceClaim.profiles = service.profiles;
      serviceClaim.execution = "manual-job-prepared-only";
    }
    if (service.hostname !== undefined) serviceClaim.hostname = service.hostname;
    if (service.manualProbe !== undefined) serviceClaim.manualProbe = service.manualProbe;
    if (service.fileEnvironmentConsumers !== undefined) serviceClaim.fileEnvironmentConsumers = service.fileEnvironmentConsumers;
    if (service.init === true) serviceClaim.init = true;
    services.push(serviceClaim);
    for (const port of service.ports) {
      const claim = { service: service.id, hostIp: port.hostIp, published: port.published, target: port.target, protocol: port.protocol, purpose: port.purpose };
      if (isPrivateBind(port.hostIp)) {
        privatePorts.push(claim);
      } else {
        publicPorts.push(claim);
      }
    }
    for (const mount of service.mounts) {
      if (mount.kind === "volume") {
        volumes.push({ service: service.id, name: mount.name, target: mount.target, readOnly: mount.readOnly, owner: mount.owner, ownership: mount.ownership });
      } else {
        paths.push({ service: service.id, source: mount.source, target: mount.target, readOnly: mount.readOnly, owner: mount.owner, ownership: mount.ownership });
      }
    }
    for (const secret of service.secretRefs) {
      if (secret.filePath) {
        secretRefs.push({ service: service.id, name: secret.name, ref: secret.ref, target: secret.target, source: "file", filePath: secret.filePath });
      } else {
        secretRefs.push({ service: service.id, name: secret.name, ref: secret.ref, target: secret.target });
      }
    }
  }
  privatePorts.sort(comparePlanPort);
  publicPorts.sort(comparePlanPort);
  paths.sort((left, right) => `${left.source}\0${left.service}`.localeCompare(`${right.source}\0${right.service}`));
  volumes.sort((left, right) => `${left.name}\0${left.service}`.localeCompare(`${right.name}\0${right.service}`));
  secretRefs.sort((left, right) => `${left.service}\0${left.name}`.localeCompare(`${right.service}\0${right.name}`));
  const ownershipConflict = assessment.conflicts.some((finding) => finding.reason.includes("owner") || finding.reason.includes("ownership") || finding.kind === "project");
  const ownershipBlocked = assessment.blockers.some((finding) => finding.reason.includes("ownership") || finding.kind === "project");
  const resourceConflict = assessment.conflicts.some((finding) => finding.kind !== "project");
  const resourceBlocked = assessment.blockers.some((finding) => finding.kind !== "project");
  const claims = {
    services,
    privatePorts,
    publicPorts,
    paths,
    networks: manifest.networks.map((network) => {
      const claim = { id: network.id, name: network.name, internal: network.internal, owner: network.owner, ownership: network.ownership };
      if (network.subnet !== undefined) claim.subnet = network.subnet;
      return claim;
    }),
    secretRefs
  };
  if (volumes.length > 0) claims.volumes = volumes;
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
    claims,
    conflicts: assessment.conflicts,
    blockers: assessment.blockers,
    render: { target: renderTargetFor(manifest), format: "compose-yaml", noClobber: true },
    approvals: { apply: applyApproval(manifest), stop: `STOP:${manifest.project.id}` },
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
    if (service.profiles) lines.push(`    profiles: ${yamlString(service.profiles)}`);
    if (service.hostname !== undefined) lines.push(`    hostname: ${yamlString(service.hostname)}`);
    if (service.user !== "image-default") {
      lines.push(`    user: ${yamlString(service.user)}`);
    }
    lines.push(`    read_only: ${String(service.readOnly)}`);
    if (service.init === true) lines.push("    init: true");
    lines.push("    security_opt:");
    lines.push(`      - ${yamlString("no-new-privileges:true")}`);
    if (service.capDrop !== undefined) lines.push("    cap_drop:", `      - ${yamlString("ALL")}`);
    if (service.runtimeResources !== undefined) {
      const effects = runtimeResourceEffects(service.runtimeResources);
      lines.push("    cap_add:", ...effects.capabilities.map((cap) => `      - ${yamlString(cap)}`),
        "    devices:", ...effects.devices.map((device) => `      - ${yamlString(device)}`));
    }
    if (service.memoryLimitBytes !== undefined) lines.push(`    mem_limit: ${String(service.memoryLimitBytes)}`);
    if (service.cpuLimit !== undefined) lines.push(`    cpus: ${String(service.cpuLimit)}`);
    if (service.entrypoint) {
      lines.push(`    entrypoint: ${yamlString(service.entrypoint)}`);
    }
    if (service.command) {
      lines.push(`    command: ${yamlString(service.command)}`);
    }
    if (service.shmSizeBytes !== undefined) {
      lines.push(`    shm_size: ${String(service.shmSizeBytes)}`);
    }
    if (service.ulimits !== undefined) {
      lines.push("    ulimits:", "      nofile:");
      lines.push(`        soft: ${String(service.ulimits.nofile.soft)}`);
      lines.push(`        hard: ${String(service.ulimits.nofile.hard)}`);
    }
    if (service.tmpfs && service.tmpfs.length > 0) {
      lines.push("    tmpfs:");
      for (const entry of service.tmpfs) {
        lines.push(`      - ${yamlString(`${entry.target}:size=${entry.sizeBytes},mode=${entry.mode.toString(8)}`)}`);
      }
    }
    if (service.healthcheck) {
      lines.push("    healthcheck:");
      lines.push(`      test: ${yamlString(service.healthcheck.test)}`);
      lines.push(`      interval: ${yamlString(`${service.healthcheck.intervalSeconds}s`)}`);
      lines.push(`      timeout: ${yamlString(`${service.healthcheck.timeoutSeconds}s`)}`);
      lines.push(`      start_period: ${yamlString(`${service.healthcheck.startPeriodSeconds}s`)}`);
      lines.push(`      retries: ${String(service.healthcheck.retries)}`);
    }
    if (service.dependsOn && service.dependsOn.length > 0) {
      lines.push("    depends_on:");
      for (const dependency of service.dependsOn) {
        lines.push(`      ${yamlString(dependency.service)}:`);
        lines.push(`        condition: ${yamlString(dependency.condition)}`);
      }
    }
    if (service.environment.length > 0) {
      lines.push("    environment:");
      for (const entry of service.environment) {
        lines.push(`      ${yamlString(entry.name)}: ${yamlString(entry.value)}`);
      }
    }
    if (service.envFilePath) {
      lines.push("    env_file:");
      lines.push(`      - ${yamlString(service.envFilePath)}`);
    }
    if (service.dockerCliTls) {
      // Only this known source-bound Docker daemon TLS profile can map DNS.
      const endpoint = service.dockerCliTls.endpoint;
      lines.push("    extra_hosts:");
      lines.push(`      - ${yamlString(`${endpoint.serverName}=${endpoint.privateIpv4}`)}`);
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
        if (mount.kind === "volume") {
          lines.push("      - type: volume");
          lines.push(`        source: ${yamlString(mount.name)}`);
        } else {
          lines.push("      - type: bind");
          lines.push(`        source: ${yamlString(mount.source)}`);
        }
        lines.push(`        target: ${yamlString(mount.target)}`);
        lines.push(`        read_only: ${String(mount.readOnly)}`);
      }
    }
    lines.push("    networks:");
    for (const network of service.networks) {
      const aliases = (service.networkAliases ?? []).filter((entry) => entry.network === network);
      if (aliases.length === 0) {
        lines.push(`      ${yamlString(network)}: null`);
        continue;
      }
      lines.push(`      ${yamlString(network)}:`);
      lines.push("        aliases:");
      for (const entry of aliases) lines.push(`          - ${yamlString(entry.alias)}`);
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
      if (network.subnet !== undefined) {
        lines.push("    ipam:");
        lines.push("      config:");
        lines.push(`        - subnet: ${yamlString(network.subnet)}`);
      }
    }
  }
  const namedVolumes = [...new Map(manifest.services.flatMap((service) => service.mounts.filter((mount) => mount.kind === "volume")
    .map((mount) => [mount.name, mount]))).values()];
  namedVolumes.sort((left, right) => left.name.localeCompare(right.name));
  if (namedVolumes.length > 0) {
    lines.push("volumes:");
    for (const volume of namedVolumes) {
      lines.push(`  ${yamlString(volume.name)}:`);
      lines.push(`    name: ${yamlString(volume.name)}`);
      lines.push(`    driver: ${yamlString("local")}`);
      lines.push("    labels:");
      lines.push(`      ${yamlString(VOLUME_LABEL_PROJECT)}: ${yamlString(manifest.project.id)}`);
      lines.push(`      ${yamlString(VOLUME_LABEL_MOUNT)}: ${yamlString(volumeMountId(volume.name, manifest.project.id))}`);
    }
  }
  const allSecrets = [];
  for (const service of manifest.services) {
    for (const secret of service.secretRefs) {
      allSecrets.push({ source: `${service.id}-${secret.name}`, ref: secret.ref, filePath: secret.filePath });
    }
  }
  allSecrets.sort((left, right) => left.source.localeCompare(right.source));
  if (allSecrets.length > 0) {
    lines.push("secrets:");
    for (const secret of allSecrets) {
      lines.push(`  ${yamlString(secret.source)}:`);
      if (secret.filePath) {
        lines.push(`    file: ${yamlString(secret.filePath)}`);
      } else {
        lines.push("    external: true");
        lines.push(`    name: ${yamlString(secret.ref)}`);
      }
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
      if (mount.kind !== "volume") sources.add(mount.source);
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

function verifySecretFiles(manifest) {
  const files = new Set();
  for (const service of manifest.services) {
    if (service.envFilePath) files.add(service.envFilePath);
    for (const secret of service.secretRefs) {
      if (!secret.filePath) {
        reject("external secret references are planning-only in the local Compose lifecycle; bind a private filePath or use an external secret platform");
      }
      files.add(secret.filePath);
    }
  }
  for (const filePath of [...files].sort()) {
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch {
      reject("a declared local secret file is unavailable");
    }
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filePath) !== filePath) {
      reject("local secret files must be regular files without symlink traversal");
    }
    if ((stat.mode & 0o777) !== 0o600) {
      reject("local secret files must have mode 0600");
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      reject("local secret files must be owned by the current numeric user");
    }
    if (stat.nlink !== 1) {
      reject("local secret files must not have hard links");
    }
    if (stat.size < 1 || stat.size > MAX_SECRET_FILE_BYTES) {
      reject("local secret files must be non-empty and at most 64 KiB");
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
  verifySecretFiles(manifest);
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

function dockerVolumeQuery(context, args) {
  const result = spawnSync("docker", ["--context", context, "volume", ...args], {
    encoding: "utf8", maxBuffer: 64 * 1024, timeout: 10_000
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    reject("exact Docker volume ownership preflight failed; no Compose mutation was attempted");
  }
  return result.stdout.trim();
}

function verifyNamedVolumes(manifest, requireExisting, allowNew) {
  const volumes = [...new Map(manifest.services.flatMap((service) => service.mounts.filter((mount) => mount.kind === "volume")
    .map((mount) => [mount.name, mount]))).values()];
  let present = 0;
  let absent = 0;
  for (const volume of volumes) {
    const names = dockerVolumeQuery(manifest.project.dockerContext, ["ls", "--filter", `name=${volume.name}`, "--format", "{{.Name}}"]);
    const exists = names.split("\n").includes(volume.name);
    if (!exists) {
      if (requireExisting || volume.ownership === "verified-existing") {
        reject("a saved named volume is unavailable; refusing to create an empty replacement");
      }
      absent += 1;
      continue;
    }
    if (allowNew && volume.ownership === "new") {
      reject("a selected-add volume already exists; inspect and resume the interrupted addition");
    }
    present += 1;
    const format = '{{.Name}}\t{{.Driver}}\t{{index .Labels "com.docker.compose.project"}}\t{{index .Labels "com.docker.compose.volume"}}\t{{index .Labels "io.selfhost.project"}}\t{{index .Labels "io.selfhost.volume"}}';
    const observed = dockerVolumeQuery(manifest.project.dockerContext, ["inspect", volume.name, "--format", format]).split("\t");
    const expected = volumeLabels(manifest.project.id, volume.name);
    if (observed.length !== 6 || observed[0] !== volume.name || observed[1] !== "local"
      || observed[2] !== expected["com.docker.compose.project"]
      || observed[3] !== expected["com.docker.compose.volume"]
      || observed[4] !== expected[VOLUME_LABEL_PROJECT]
      || observed[5] !== expected[VOLUME_LABEL_MOUNT]) {
      reject("named volume ownership or driver mismatch; no Compose mutation was attempted");
    }
  }
  if (present > 0 && absent > 0 && !allowNew) {
    reject("only some saved named volumes exist; refusing to create empty replacements");
  }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function applyApproval(manifest) {
  if (manifest.services.some((service) => service.runtimeResources || service.ownerDirectory || service.dockerCliTls)) return `APPLY:${manifest.project.id}:${manifestSha256(manifest)}`;
  return `APPLY:${manifest.project.id}`;
}

function verifyRuntimeResourceHost(manifest) {
  if (!manifest.services.some((service) => service.runtimeResources)) return;
  try { verifyRuntimeResourceDevice(); }
  catch { reject("runtime resources require existing exact non-symlink Linux TUN device 10:200; no host changes attempted"); }
  if (process.env.DOCKER_HOST || process.env.DOCKER_TLS_VERIFY || process.env.DOCKER_CERT_PATH) reject("runtime resources require an explicit local context without ambient endpoint overrides");
  const context = manifest.project.dockerContext;
  const query = (args) => {
    const result = spawnSync("docker", ["--context", context, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
    if (result.error || result.status !== 0) reject("runtime resource Docker locality/security metadata unavailable; no Compose mutation attempted");
    return result.stdout.trim();
  };
  const endpoint = query(["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"]);
  if (![JSON.stringify("unix:///var/run/docker.sock"), JSON.stringify("unix:///run/docker.sock")].includes(endpoint)) reject("runtime resources require an exact local system Unix Docker socket; remote, proxy and user sockets are unsupported");
  const security = query(["info", "--format", "{{json .SecurityOptions}}"]);
  let options;
  try { options = JSON.parse(security); } catch { reject("runtime resource daemon security metadata is invalid"); }
  if (!Array.isArray(options) || options.some((value) => typeof value !== "string" || /rootless|userns/i.test(value))) reject("runtime resources cannot use rootless or user-remapped daemon namespaces");
}

function selectedPlan(manifest, plan, options) {
  requirePass(manifest);
  const services = options.services.split(",");
  if (services.length > MAX_ITEMS || services.some((id) => !LABEL.test(id)
    || !manifest.services.some((service) => service.id === id)) || new Set(services).size !== services.length) {
    reject("selected services must be unique exact manifest service IDs");
  }
  services.sort();
  if (options.operation === "probe" && (services.length !== 1
    || !manifest.services.find((service) => service.id === services[0]).manualProbe)) {
    reject("selected probe requires exactly one declared fixed manual-job version probe");
  }
  if (["start", "recreate"].includes(options.operation)
    && services.some((id) => manifest.services.find((service) => service.id === id).profiles)) {
    reject("routine selected start or recreate cannot execute manual jobs; no job-run authority is available");
  }
  if (options.operation === "add") {
    if (manifest.project.ownership !== "verified-existing"
      || manifest.services.some((service) => !service.ownership)
      || manifest.services.filter((service) => service.ownership === "new").length !== services.length
      || services.some((id) => manifest.services.find((service) => service.id === id).ownership !== "new")) {
      reject("selected add must name every new service in one verified existing project");
    }
  }
  const identity = { project: manifest.project.id, context: manifest.project.dockerContext,
    planId: plan.planId, manifestSha256: manifestSha256(manifest), file: plan.render.target, operation: options.operation, services };
  const digest = crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return { ...identity, approval: `SELECTED-${options.operation.toUpperCase()}:${manifest.project.id}:${digest}`,
    mutation: false, dockerInvoked: false, dependenciesStarted: false, fullAcceptance: false };
}

function main() {
  const options = parseArguments(Bun.argv.slice(2));
  const manifest = normalizeManifest(readInput(options.input));
  const plan = buildPlan(manifest);
  if (options.action === "apply-approval") {
    requirePass(manifest);
    process.stdout.write(`${applyApproval(manifest)}\n`);
    return;
  }
  if (options.action === "automatic-services") {
    requirePass(manifest);
    for (const service of manifest.services) {
      if (!service.profiles) process.stdout.write(`${service.id}\n`);
    }
    return;
  }
  if (["selected-plan", "selected-check", "probe-run"].includes(options.action)) {
    const selection = selectedPlan(manifest, plan, options);
    if (["selected-check", "probe-run"].includes(options.action)) {
      verifyLifecycleTarget(manifest, options.context, options.project, options.file);
      if (options.approval !== selection.approval) reject("selected lifecycle approval does not match the exact plan and services");
    }
    if (options.action === "probe-run") {
      const selected = manifest.services.find((service) => service.id === selection.services[0]);
      const argv = selected.manualProbe.argv;
      const result = spawnSync("docker", ["--context", options.context, "compose", "--project-name", options.project,
        "--file", options.file, "run", "--rm", "--no-deps", "--entrypoint", argv[0], selected.id, ...argv.slice(1)], {
        timeout: 60000, maxBuffer: 1024 * 1024, encoding: "utf8", env: { ...process.env, COMPOSE_PROFILES: "" }
      });
      if (result.error || result.status !== 0) reject("fixed version probe failed or its outcome is unknown; raw output withheld; inspect before retrying");
      writeJson({ project: options.project, service: selected.id, exitCode: 0, probe: "version-only", outputWithheld: true,
        backupAcceptance: false, remoteScopeVerified: false });
      return;
    }
    writeJson(selection);
    return;
  }
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
  if (options.action === "runtime-preflight") verifyRuntimeResourceHost(manifest);
  if (options.action === "volume-preflight") verifyNamedVolumes(manifest,
    options.requireExistingVolumes === "true", options.allowNewVolumes === "true");
  writeJson({ valid: true, status: "pass", context: manifest.project.dockerContext, project: manifest.project.id, file: target, dockerInvoked: (options.action === "volume-preflight" && manifest.services.some((service) => service.mounts.some((mount) => mount.kind === "volume"))) || (options.action === "runtime-preflight" && manifest.services.some((service) => service.runtimeResources)) });
}

try {
  main();
} catch (error) {
  if (error instanceof ValidationError) {
    process.stderr.write(`compose-project.ts: ${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write("compose-project.ts: unexpected failure\n");
  process.exit(2);
}
