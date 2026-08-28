#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  loadHomarrApiKey,
  loadSession,
  REPO_ROOT,
  requireSessionPasswordScheme,
} from "./lib/session-context.mjs";

function assertOwnedMode(stat, mode, label) {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    throw new Error(`${label} ownership cannot be verified`);
  }
  if (stat.uid !== process.getuid() || stat.gid !== process.getgid()) {
    throw new Error(`${label} has unexpected ownership`);
  }
  if ((stat.mode & 0o7777) !== mode) {
    throw new Error(`${label} has an unsafe mode`);
  }
}

function assertRealDirectory(path, parent, label) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`${label} is invalid`);
  }
  if (dirname(path) !== parent) {
    throw new Error(`${label} escaped its session`);
  }
  assertOwnedMode(stat, 0o700, label);
}

function assertArtifactFile(path, parent, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`${label} is invalid`);
  }
  if (dirname(path) !== parent || stat.nlink !== 1) {
    throw new Error(`${label} escaped its session`);
  }
  assertOwnedMode(stat, 0o600, label);
  return stat;
}

function validateBridgePath() {
  const bridgePath = join(REPO_ROOT, "scripts", "homarr-mcp-bridge.mjs");
  const stat = lstatSync(bridgePath);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || realpathSync(bridgePath) !== bridgePath
  ) {
    throw new Error("Homarr MCP bridge path is invalid");
  }
  if (dirname(bridgePath) !== join(REPO_ROOT, "scripts")) {
    throw new Error("Homarr MCP bridge escaped the repository");
  }
  return bridgePath;
}

function writeConfig(session, bridgePath, apiKey) {
  const artifactsDir = join(session.sessionDir, "artifacts");
  assertRealDirectory(artifactsDir, session.sessionDir, "artifacts directory");
  const destination = join(artifactsDir, "mcp-client.json");
  try {
    lstatSync(destination);
    assertArtifactFile(destination, artifactsDir, "MCP client artifact");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const replacement = join(
    artifactsDir,
    `.mcp-client.json.${randomBytes(12).toString("hex")}`,
  );
  let descriptor;
  let cleanupArmed = false;
  try {
    descriptor = openSync(replacement, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    const pathStat = assertArtifactFile(replacement, artifactsDir, "replacement MCP client artifact");
    const descriptorStat = fstatSync(descriptor);
    if (pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) {
      throw new Error("replacement MCP client artifact changed after creation");
    }
    cleanupArmed = true;
    const config = {
      mcpServers: {
        [`homarr-${session.runId}`]: {
          command: process.execPath,
          args: [bridgePath, session.runId],
        },
      },
    };
    writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertArtifactFile(replacement, artifactsDir, "replacement MCP client artifact");
    renameSync(replacement, destination);
    cleanupArmed = false;
    assertArtifactFile(destination, artifactsDir, "MCP client artifact");

    const persisted = JSON.parse(readFileSync(destination, "utf8"));
    const encoded = JSON.stringify(persisted);
    if (
      encoded.includes("HOMARR_API_KEY")
      || encoded.includes(apiKey)
      || /https?:\/\//.test(encoded)
    ) {
      throw new Error("MCP client artifact contains connection secrets");
    }
    const directoryDescriptor = openSync(artifactsDir, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (cleanupArmed && existsSync(replacement)) {
      assertArtifactFile(replacement, artifactsDir, "replacement MCP client artifact");
      unlinkSync(replacement);
    }
  }
}

function main() {
  if (process.argv.length !== 3) {
    throw new Error("RUN_ID is required");
  }
  const session = loadSession(process.argv[2]);
  requireSessionPasswordScheme(session);
  const { apiKey } = loadHomarrApiKey(session);
  writeConfig(session, validateBridgePath(), apiKey);
  process.stdout.write("PASS secret-free Homarr MCP client artifact written\n");
}

try {
  main();
} catch {
  process.stdout.write("FAIL Homarr MCP client artifact\n");
  process.exitCode = 1;
}
