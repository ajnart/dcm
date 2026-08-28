#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfile } from "./lib/profile.mjs";
import {
  isRecord,
  MUTATING_HOMARR_TOOL_NAMES,
  NativeHomarrMcpClient,
  toolResultArray,
} from "./lib/homarr-mcp.mjs";

const DEFAULT_TITLE = "Spider-Man: No Way Home";
const MAX_BRIDGE_OUTPUT = 4 * 1024 * 1024;

function bridgePath() {
  const path = resolve(fileURLToPath(new URL("./homarr-mcp-bridge.mjs", import.meta.url)));
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
  return path;
}

function parseArguments() {
  const args = process.argv.slice(2);
  if (args.length === 1) {
    return { profilePath: args[0], mediaSearch: false, query: DEFAULT_TITLE };
  }
  if ((args.length === 2 || args.length === 3) && args[1] === "--media-search") {
    let query = DEFAULT_TITLE;
    if (args.length === 3) {
      query = args[2];
    }
    if (
      typeof query !== "string"
      || query.length < 1
      || query.length > 200
      || /[\u0000-\u001f\u007f]/.test(query)
    ) {
      throw new Error("media search query is invalid");
    }
    return { profilePath: args[0], mediaSearch: true, query };
  }
  throw new Error("profile path is required");
}

function bridgeRequest(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function childEnvironment() {
  const environment = {
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
  if (typeof process.env.PATH === "string") {
    environment.PATH = process.env.PATH;
  }
  return environment;
}

function probeBridge(profilePath, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [bridgePath(), profilePath], {
      cwd: process.cwd(),
      env: childEnvironment(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    let expectedResponses = 3;
    if (options.mediaSearch) {
      expectedResponses = 4;
    }
    const responses = new Map();
    let buffer = "";
    let outputBytes = 0;
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(responses);
    };

    const timeout = setTimeout(() => {
      finish(new Error("Homarr bridge timed out"));
    }, 15_000);

    child.on("error", () => {
      finish(new Error("Homarr bridge could not start"));
    });
    child.on("exit", () => {
      if (responses.size < expectedResponses) {
        finish(new Error("Homarr bridge exited early"));
      }
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > MAX_BRIDGE_OUTPUT) {
        finish(new Error("Homarr bridge output is too large"));
        return;
      }
      buffer += chunk;
      while (buffer.includes("\n")) {
        const lineEnd = buffer.indexOf("\n");
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        let response;
        try {
          response = JSON.parse(line);
        } catch {
          finish(new Error("Homarr bridge returned invalid JSON"));
          return;
        }
        if (!isRecord(response) || response.jsonrpc !== "2.0") {
          finish(new Error("Homarr bridge returned invalid JSON-RPC"));
          return;
        }
        responses.set(response.id, response);
        if (responses.size === expectedResponses) {
          finish();
          return;
        }
      }
    });

    child.stdin.write(bridgeRequest(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "selfhost-homarr-verifier", version: "1.0.0" },
    }));
    child.stdin.write(bridgeRequest(2, "tools/list"));
    child.stdin.write(bridgeRequest(3, "tools/call", {
      name: "integration_all",
      arguments: {},
    }));
    if (options.mediaSearch) {
      child.stdin.write(bridgeRequest(4, "tools/call", {
        name: "integration_searchMediaRequests",
        arguments: mediaSearchArguments(options.seerrId, options.query),
      }));
    }
    child.stdin.end();
  });
}

function normalizeName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function usableIntegrationId(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 256
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function identifySeerrIntegration(integrations) {
  if (!Array.isArray(integrations)) {
    throw new Error("Homarr integrations are invalid");
  }
  const matches = integrations.filter(
    (integration) => isRecord(integration)
      && (
        normalizeName(integration.kind) === "seerr"
        || normalizeName(integration.name) === "seerr"
      ),
  );
  if (matches.length !== 1 || !usableIntegrationId(matches[0].id)) {
    throw new Error("Homarr requires exactly one usable Seerr integration");
  }
  return matches[0];
}

export function mediaSearchArguments(integrationId, query) {
  if (!usableIntegrationId(integrationId)) {
    throw new Error("Seerr integration ID is invalid");
  }
  if (
    typeof query !== "string"
    || query.length < 1
    || query.length > 200
    || /[\u0000-\u001f\u007f]/.test(query)
    || normalizeName(query).length === 0
  ) {
    throw new Error("media search query is invalid");
  }
  return { query, integrationIds: [integrationId] };
}

function entryHasExactTitle(value, normalizedQuery) {
  if (Array.isArray(value)) {
    return value.some((entry) => entryHasExactTitle(entry, normalizedQuery));
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      (key === "title" || key === "name")
      && typeof entry === "string"
      && normalizeName(entry) === normalizedQuery
    ) {
      return true;
    }
    if (isRecord(entry) || Array.isArray(entry)) {
      if (entryHasExactTitle(entry, normalizedQuery)) {
        return true;
      }
    }
  }
  return false;
}

export function validateStructuredSearchResult(result, query) {
  if (!isRecord(result) || !("structuredContent" in result)) {
    throw new Error("Homarr media search lacks structured results");
  }
  const structured = result.structuredContent;
  let results;
  if (Array.isArray(structured)) {
    results = structured;
  } else if (isRecord(structured) && Array.isArray(structured.results)) {
    results = structured.results;
  } else {
    throw new Error("Homarr media search results are invalid");
  }
  if (results.length === 0) {
    throw new Error("Homarr media search returned no results");
  }
  const normalizedQuery = normalizeName(query);
  if (!results.some((entry) => entryHasExactTitle(entry, normalizedQuery))) {
    throw new Error("Homarr media search did not return the exact title");
  }
  return results;
}

export function validateBridgeResponses(responses, options) {
  const initialized = responses.get(1);
  if (
    !isRecord(initialized?.result)
    || initialized.result.protocolVersion !== "2025-06-18"
    || typeof initialized.result.instructions !== "string"
    || !initialized.result.instructions.includes("Canonical endpoint /api/mcp is active")
    || !initialized.result.instructions.includes("strictly read-only")
  ) {
    throw new Error("Homarr bridge initialize failed");
  }

  const listed = responses.get(2);
  if (
    !isRecord(listed?.result)
    || !Array.isArray(listed.result.tools)
    || !isRecord(listed.result._meta)
    || listed.result._meta["selfhost-homarr/bridgeMode"] !== "read-only"
    || listed.result._meta["selfhost-homarr/endpointMode"] !== "canonical"
  ) {
    throw new Error("Homarr bridge tools/list failed");
  }
  const names = new Set(
    listed.result.tools
      .filter((tool) => isRecord(tool) && typeof tool.name === "string")
      .map((tool) => tool.name),
  );
  for (const required of [
    "integration_all",
    "integration_searchMediaRequests",
  ]) {
    if (!names.has(required)) {
      throw new Error("Homarr bridge catalog is incomplete");
    }
  }
  for (const mutatingName of MUTATING_HOMARR_TOOL_NAMES) {
    if (names.has(mutatingName)) {
      throw new Error("Homarr bridge exposed a mutating tool");
    }
  }

  const integrationCall = responses.get(3);
  if (!isRecord(integrationCall?.result)) {
    throw new Error("Homarr bridge tools/call failed");
  }
  const integrations = toolResultArray(integrationCall.result);
  if (options.mediaSearch) {
    const seerr = identifySeerrIntegration(integrations);
    if (seerr.id !== options.seerrId) {
      throw new Error("Homarr bridge Seerr integration changed during verification");
    }
    const searchCall = responses.get(4);
    if (!isRecord(searchCall?.result)) {
      throw new Error("Homarr bridge media search failed");
    }
    validateStructuredSearchResult(searchCall.result, options.query);
  }
}

export async function main() {
  const options = parseArguments();
  const profile = loadProfile(options.profilePath, { requireKey: true });
  const client = new NativeHomarrMcpClient({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    allowCompatibility: false,
  });
  await client.connect();
  if (client.endpointMode !== "canonical") {
    throw new Error("canonical endpoint verification failed");
  }
  process.stdout.write("PASS Homarr canonical endpoint authentication\n");

  const catalog = await client.listTools();
  if (catalog.fallback) {
    process.stdout.write("PASS Homarr tools/list curated Date-schema fallback\n");
  } else {
    process.stdout.write("PASS Homarr tools/list native catalog\n");
  }

  const verificationOptions = { ...options };
  if (options.mediaSearch) {
    const integrations = toolResultArray(await client.callTool("integration_all", {}));
    const seerr = identifySeerrIntegration(integrations);
    verificationOptions.seerrId = seerr.id;
  }

  const responses = await probeBridge(profile.profilePath, verificationOptions);
  validateBridgeResponses(responses, verificationOptions);
  process.stdout.write("PASS Homarr bridge initialize, tools/list, and read-only tools/call\n");
  if (options.mediaSearch) {
    process.stdout.write("PASS Homarr Seerr media search\n");
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch(() => {
    process.stdout.write("FAIL Homarr read-only verification\n");
    process.exitCode = 1;
  });
}
