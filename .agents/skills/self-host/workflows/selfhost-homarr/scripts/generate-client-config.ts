#!/usr/bin/env bun

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRealDirectory,
  atomicWritePrivate,
  loadProfile,
} from "./lib/profile.ts";

const FORMATS = new Set(["claude-code", "codex", "pi", "generic-json", "generic-toml"]);

function bridgePath() {
  const path = resolve(fileURLToPath(new URL("./homarr-mcp-bridge.ts", import.meta.url)));
  const stat = lstatSync(path);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || realpathSync(path) !== path
    || (stat.mode & 0o022) !== 0
  ) {
    throw new Error("Homarr bridge path is invalid");
  }
  if (typeof process.getuid !== "function" || stat.uid !== process.getuid()) {
    throw new Error("Homarr bridge ownership is invalid");
  }
  return path;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function render(format, serverName, command, args) {
  if (format === "claude-code" || format === "pi") {
    return `${JSON.stringify({
      mcpServers: {
        [serverName]: {
          type: "stdio",
          command,
          args,
        },
      },
    }, null, 2)}\n`;
  }
  if (format === "codex") {
    return [
      `[mcp_servers.${tomlString(serverName)}]`,
      `command = ${tomlString(command)}`,
      `args = [${args.map((value) => tomlString(value)).join(", ")}]`,
      "",
    ].join("\n");
  }
  if (format === "generic-json") {
    return `${JSON.stringify({
      name: serverName,
      transport: "stdio",
      command,
      args,
    }, null, 2)}\n`;
  }
  return [
    `name = ${tomlString(serverName)}`,
    'transport = "stdio"',
    `command = ${tomlString(command)}`,
    `args = [${args.map((value) => tomlString(value)).join(", ")}]`,
    "",
  ].join("\n");
}

function fileName(format) {
  if (format === "claude-code") {
    return "claude-code.json";
  }
  if (format === "codex") {
    return "codex.toml";
  }
  if (format === "pi") {
    return "pi.json";
  }
  if (format === "generic-json") {
    return "generic.json";
  }
  return "generic.toml";
}

export function generateClientConfig(format, profilePath, launcher, report = (line) => process.stdout.write(line)) {
  if (!FORMATS.has(format)) {
    throw new Error("client format is invalid");
  }
  const profile = loadProfile(profilePath);
  const fragmentsDirectory = join(profile.profilePath, "client-fragments");
  if (!existsSync(fragmentsDirectory)) {
    mkdirSync(fragmentsDirectory, { mode: 0o700 });
  }
  assertRealDirectory(fragmentsDirectory, { mode: 0o700, parent: profile.profilePath });

  const command = launcher?.command ?? realpathSync(process.execPath);
  const args = launcher ? [...launcher.argsPrefix, profile.profilePath] : [bridgePath(), profile.profilePath];
  let serverName = `homarr-${profile.profile}`;
  if (profile.capabilityPolicy?.mode === "integration-request") {
    serverName = `${serverName}-integration-request`;
  } else if (profile.capabilityPolicy?.mode === "media-request") {
    serverName = `${serverName}-media-request`;
  }
  const content = render(format, serverName, command, args);
  if (
    content.includes("ApiKey")
    || content.includes("apiKey")
    || content.includes("api_key")
    || content.includes(".credential")
    || content.includes("/api/mcp")
  ) {
    throw new Error("client fragment contains forbidden connection material");
  }
  const destination = join(fragmentsDirectory, fileName(format));
  if (basename(destination) !== fileName(format)) {
    throw new Error("client fragment path is invalid");
  }
  if (existsSync(destination)) {
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o600
      || realpathSync(destination) !== destination || stat.size > 64 * 1024
      || readFileSync(destination, "utf8") !== content) {
      throw new Error("existing Homarr MCP fragment differs or is unsafe");
    }
    report("PASS identical secret-free Homarr MCP client fragment retained\n");
    return { path: destination, created: false };
  }
  atomicWritePrivate(destination, content, { maxBytes: 64 * 1024 });
  report("PASS secret-free Homarr MCP client fragment written\n");
  return { path: destination, created: true };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    if (process.argv.length !== 4) {
      throw new Error("format and profile path are required");
    }
    generateClientConfig(process.argv[2], process.argv[3]);
  } catch {
    process.stdout.write("FAIL Homarr MCP client fragment\n");
    process.exitCode = 1;
  }
}
