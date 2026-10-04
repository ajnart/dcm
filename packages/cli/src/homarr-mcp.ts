import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultProfilePath,
  doctorProfile,
  initializeProfile,
  loadProfile,
  normalizeBaseUrl,
  storeApiKey,
  validateApiKey,
} from "../../../.agents/skills/self-host/workflows/selfhost-homarr/scripts/lib/profile.ts";
import { runHomarrBridge } from "../../../.agents/skills/self-host/workflows/selfhost-homarr/scripts/homarr-mcp-bridge.ts";
import { generateClientConfig } from "../../../.agents/skills/self-host/workflows/selfhost-homarr/scripts/generate-client-config.ts";
import { verifyHomarr } from "../../../.agents/skills/self-host/workflows/selfhost-homarr/scripts/verify-homarr.ts";

type Launcher = { command: string; argsPrefix: string[] };
type FailureBoundary = { step: string; partialWritePossible: boolean };

function requirePosixProfile(): void {
  if (process.platform === "win32" || typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    throw new Error("Homarr MCP profiles require POSIX ownership and mode checks; this command is unsupported on Windows.");
  }
}

function absolutePath(value: string | undefined, label: string): string {
  if (!value || !isAbsolute(value) || resolve(value) !== value) {
    throw new Error(`${label} must be one normalized absolute path`);
  }
  return value;
}

function options(args: string[], allowed: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  const names = new Set(allowed);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if ((flag === "--json" || flag === "--require-read-only") && names.has(flag)
      && parsed[flag] === undefined) {
      parsed[flag] = "true";
      continue;
    }
    const value = args[index + 1];
    if (!names.has(flag) || !value || value.startsWith("--") || parsed[flag] !== undefined) {
      throw new Error(`Invalid or repeated Homarr MCP option: ${flag ?? "(missing)"}`);
    }
    parsed[flag] = value;
    index += 1;
  }
  return parsed;
}

function projectProfile(flags: Record<string, string>): string {
  const root = absolutePath(flags["--project-root"], "project root");
  const name = flags["--profile"];
  if (!name) throw new Error("--profile is required");
  return defaultProfilePath(name, root);
}

function savedKey(path: string): string {
  const exact = absolutePath(path, "API key file");
  const stat = lstatSync(exact);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || stat.uid !== process.getuid?.() || stat.gid !== process.getgid?.()
    || (stat.mode & 0o7777) !== 0o600 || stat.size < 16 || stat.size > 2048
    || realpathSync(exact) !== exact) {
    throw new Error("saved Homarr API key file must be one owner-only mode-0600 regular file");
  }
  const descriptor = openSync(exact, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw new Error("saved Homarr API key file changed while opening");
    }
    const value = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor);
    if (after.size !== stat.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error("saved Homarr API key file changed while reading");
    }
    return validateApiKey(value);
  } finally {
    closeSync(descriptor);
  }
}

function launcher(): Launcher {
  const command = realpathSync(process.execPath);
  if (typeof Bun !== "undefined" && Bun.isStandaloneExecutable) {
    return { command, argsPrefix: ["homarr", "mcp", "serve", "--profile-path"] };
  }
  const entry = fileURLToPath(new URL("../bin/selfhost.mjs", import.meta.url));
  const stat = lstatSync(entry);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(entry) !== entry) {
    throw new Error("installed self-host launcher is unavailable");
  }
  return { command, argsPrefix: [entry, "homarr", "mcp", "serve", "--profile-path"] };
}

export async function homarrMcpCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(`self-host homarr mcp

  prepare --project-root ABSOLUTE --profile NAME --base-url PRIVATE_OR_HTTPS_ORIGIN --api-key-file ABSOLUTE [--require-read-only] [--json]
  status --project-root ABSOLUTE --profile NAME [--json]
  verify --project-root ABSOLUTE --profile NAME [--media-search TITLE] [--json]
  fragment --project-root ABSOLUTE --profile NAME --format claude-code|codex|pi|generic-json|generic-toml [--json]
  serve --profile-path ABSOLUTE

Prepare imports one existing owner-only Homarr API key into a private profile. Fragment writes a secret-free client entry; installing it in a client requires separate INSTALL-MCP:<profile> approval.`);
    return;
  }
  const action = args[0];
  const json = action !== "serve" && args.includes("--json");
  const boundary: FailureBoundary = { step: "command-options", partialWritePossible: false };
  try {
    await runCommand(args, json, boundary);
  } catch (error) {
    if (!json) throw error;
    const unsupported = process.platform === "win32" || typeof process.getuid !== "function" || typeof process.getgid !== "function";
    let next = "Inspect this exact project's Homarr MCP profile before retrying.";
    if (unsupported) {
      next = "Use a POSIX host with owner and mode checks for Homarr MCP profiles.";
    } else if (action === "verify") {
      next = "Inspect the exact saved Homarr URL/key and MCP endpoint; use an approved browser fallback only after this API path is diagnosed.";
    }
    console.log(JSON.stringify({
      schemaVersion: 1,
      command: `homarr mcp ${action}`,
      status: "failed",
      mutation: boundary.partialWritePossible ? null : false,
      partialWritePossible: boundary.partialWritePossible,
      error: { code: unsupported ? "unsupported-platform" : "homarr-mcp-failed", step: boundary.step },
      next,
    }, null, 2));
    process.exitCode = 1;
  }
}

function result(json: boolean, value: Record<string, unknown>, human: string): void {
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...value }, null, 2));
    return;
  }
  console.log(human);
}

async function runCommand(args: string[], json: boolean, boundary: FailureBoundary): Promise<void> {
  requirePosixProfile();
  const action = args[0];
  if (action === "serve") {
    const flags = options(args.slice(1), ["--profile-path"]);
    if (Object.keys(flags).length !== 1) throw new Error("--profile-path is required");
    await runHomarrBridge(absolutePath(flags["--profile-path"], "profile path"));
    return;
  }
  const allowed = ["--project-root", "--profile", "--json"];
  if (action === "prepare") allowed.push("--base-url", "--api-key-file", "--require-read-only");
  if (action === "verify") allowed.push("--media-search");
  if (action === "fragment") allowed.push("--format");
  if (!["prepare", "status", "verify", "fragment"].includes(action)) {
    throw new Error("Use homarr mcp prepare, status, verify, fragment, or serve");
  }
  const flags = options(args.slice(1), allowed);
  if (!flags["--project-root"] || !flags["--profile"]) throw new Error("--project-root and --profile are required");
  const profilePath = projectProfile(flags);
  if (action === "prepare") {
    if (!flags["--base-url"] || !flags["--api-key-file"]) {
      throw new Error("--base-url and --api-key-file are required");
    }
    const baseUrl = normalizeBaseUrl(flags["--base-url"]);
    boundary.step = "private-key-validation";
    const key = savedKey(flags["--api-key-file"]);
    boundary.step = "profile-inspection";
    const initialized = !loadableProfile(profilePath);
    if (initialized) {
      boundary.step = "profile-initialization";
      boundary.partialWritePossible = true;
      initializeProfile({ profile: flags["--profile"], baseUrl, projectRoot: flags["--project-root"] });
    }
    const profile = loadProfile(profilePath);
    if (profile.baseUrl !== baseUrl) throw new Error("existing Homarr profile has a different base URL");
    if (flags["--require-read-only"] && profile.capabilityPolicy) {
      throw new Error("existing Homarr profile has a capability policy; no key was imported");
    }
    let existingKey: string | undefined;
    try {
      existingKey = loadProfile(profilePath, { requireKey: true }).apiKey;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existingKey && existingKey !== key) {
      throw new Error("existing Homarr profile has a different key; use the owning rotation workflow");
    }
    if (!existingKey) {
      boundary.step = "private-key-import";
      boundary.partialWritePossible = true;
      storeApiKey(profilePath, key);
    }
    boundary.step = "profile-verification";
    doctorProfile(profilePath);
    result(json, { command: "homarr mcp prepare", status: "ready", mutation: initialized || !existingKey,
      profilePath, capabilityMode: profile.capabilityPolicy?.mode ?? "read-only" },
    `Homarr MCP profile prepared: ${profilePath} (${profile.capabilityPolicy?.mode ?? "read-only"})`);
    return;
  }
  if (action === "status") {
    boundary.step = "private-profile-inspection";
    doctorProfile(profilePath);
    const profile = loadProfile(profilePath);
    result(json, { command: "homarr mcp status", status: "ready", mutation: false,
      profilePath: profile.profilePath, capabilityMode: profile.capabilityPolicy?.mode ?? "read-only" },
    `Homarr MCP profile ready: ${profile.profilePath} (${profile.capabilityPolicy?.mode ?? "read-only"})`);
    return;
  }
  if (action === "verify") {
    boundary.step = "canonical-mcp-and-bridge-verification";
    const verification = [profilePath];
    if (flags["--media-search"]) verification.push("--media-search", flags["--media-search"]);
    const verified = await verifyHomarr(verification, launcher(), json ? () => {} : undefined);
    if (json) {
      result(true, { command: "homarr mcp verify", status: "verified", mutation: false,
        profilePath, capabilityMode: verified.capabilityMode,
        verification: { canonicalAuthenticated: true, catalogMode: verified.catalogMode,
          bridgeProbed: true, mediaSearchVerified: verified.mediaSearchVerified,
          dashboardAcceptance: false } }, "");
    }
    return;
  }
  if (!flags["--format"]) throw new Error("--format is required");
  if (!["claude-code", "codex", "pi", "generic-json", "generic-toml"].includes(flags["--format"])) {
    throw new Error("client format is invalid");
  }
  boundary.step = "private-profile-inspection";
  doctorProfile(profilePath);
  const profile = loadProfile(profilePath);
  const stableLauncher = launcher();
  boundary.step = "client-fragment-generation";
  boundary.partialWritePossible = true;
  const fragment = generateClientConfig(flags["--format"], profilePath, stableLauncher, json ? () => {} : undefined);
  result(json, { command: "homarr mcp fragment", status: "generated", mutation: fragment.created,
    profilePath, capabilityMode: profile.capabilityPolicy?.mode ?? "read-only",
    fragmentPath: fragment.path, installed: false },
  `Fragment: ${fragment.path} (${profile.capabilityPolicy?.mode ?? "read-only"}; not installed)`);
}

function loadableProfile(profilePath: string): boolean {
  try {
    lstatSync(join(profilePath, "profile.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
