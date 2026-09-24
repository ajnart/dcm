#!/usr/bin/env bun

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { loadProfile } from "./lib/profile.ts";
import {
  isMutatingHomarrTool,
  isReadOnlyHomarrTool,
  isRecord,
  NativeHomarrMcpClient,
  toolResultValue,
} from "./lib/homarr-mcp.ts";

const MAX_LINE_BYTES = 1024 * 1024;
const SERVER_INSTRUCTIONS = [
  "This Homarr bridge is strictly read-only.",
  "App tiles, integrations, and widgets are distinct resources.",
  "For add or request wording, run integration_searchMediaRequests, present exact matches, and stop pending confirmation.",
  "No mutation path is installed; report the request as blocked even after confirmation.",
].join(" ");

function protocolResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function protocolError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function validId(id) {
  if (typeof id === "string") {
    return id.length <= 256;
  }
  return typeof id === "number" && Number.isFinite(id);
}

function chooseProtocolVersion(params) {
  const supported = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
  if (supported.has(params.protocolVersion)) {
    return params.protocolVersion;
  }
  return "2025-06-18";
}

function validInitializeParams(params) {
  return typeof params.protocolVersion === "string"
    && params.protocolVersion.length <= 32
    && isRecord(params.clientInfo)
    && typeof params.clientInfo.name === "string"
    && params.clientInfo.name.length <= 128
    && typeof params.clientInfo.version === "string"
    && params.clientInfo.version.length <= 64
    && isRecord(params.capabilities);
}

function pathAllowed(path, paths) {
  if (typeof path !== "string" || path.length > 8192 || !path.startsWith("/")
    || /[\\\s\u0000-\u001f\u007f#]/u.test(path)) {
    return false;
  }
  let pathname;
  try {
    pathname = new URL(path, "https://policy.invalid").pathname;
  } catch {
    return false;
  }
  return paths.includes(pathname);
}

function validateIntegrationRequest(args, policy) {
  const allowedFields = new Set(["integrationId", "method", "path", "body", "confirmed"]);
  if (Object.keys(args).some((key) => !allowedFields.has(key))) {
    throw new Error("request fields are outside the configured integration policy");
  }
  const rule = policy.rules.find((candidate) => candidate.integrationId === args.integrationId);
  if (!rule || !rule.methods.includes(args.method) || !pathAllowed(args.path, rule.paths)) {
    throw new Error("request is outside the configured integration policy");
  }
  if (args.method === "GET" && args.body !== undefined) {
    throw new Error("GET body is unavailable");
  }
  if (args.method === "DELETE" && args.confirmed !== true) {
    throw new Error("DELETE requires confirmed true");
  }
  if (args.body !== undefined && Buffer.byteLength(JSON.stringify(args.body), "utf8") > 10 * 1024) {
    throw new Error("request body exceeds policy limit");
  }
  return rule;
}

export function createCapabilityBridge(client, capabilityPolicy = null) {
  if (
    !client
    || typeof client.connect !== "function"
    || typeof client.listTools !== "function"
    || typeof client.callTool !== "function"
  ) {
    throw new Error("Homarr bridge client is invalid");
  }

  let catalog;
  let useFallbackCatalog = false;
  const capabilityEnabled = capabilityPolicy?.mode === "integration-request";

  async function endpointInstructions() {
    await client.connect();
    let instructions = SERVER_INSTRUCTIONS;
    if (capabilityEnabled) {
      instructions = [
        "This Homarr bridge exposes read-only tools plus one policy-constrained integration_request tool.",
        "Every integration request must match its configured integration ID, service kind, method, and exact path.",
        "DELETE also requires confirmed true after the user confirms its effects.",
      ].join(" ");
    }
    if (client.endpointMode === "compatibility") {
      return `${instructions} Compatibility endpoint /api/mcp/mcp is active because canonical /api/mcp returned 404 or 405.`;
    }
    return `${instructions} Canonical endpoint /api/mcp is active.`;
  }

  async function getCatalog() {
    if (catalog) {
      return catalog;
    }
    const listed = await client.listTools();
    catalog = listed.tools.filter((tool) => isRecord(tool) && (
      isReadOnlyHomarrTool(tool.name)
      || (capabilityEnabled && tool.name === "integration_request")
    ));
    useFallbackCatalog = listed.fallback;
    return catalog;
  }

  async function handleToolCall(id, params) {
    const name = params.name;
    let args = {};
    if (params.arguments !== undefined) {
      args = params.arguments;
    }
    if (
      typeof name !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(name)
      || !isRecord(args)
    ) {
      return protocolError(id, -32602, "Invalid params");
    }
    if (name === "integration_request" && capabilityEnabled) {
      try {
        const tools = await getCatalog();
        if (!tools.some((tool) => tool.name === name)) {
          return protocolError(id, -32602, "Unknown tool");
        }
        const rule = validateIntegrationRequest(args, capabilityPolicy);
        const integration = toolResultValue(await client.callTool("integration_byId", { id: rule.integrationId }, {
          curatedOnly: useFallbackCatalog,
        }));
        if (!isRecord(integration) || String(integration.kind).toLowerCase() !== rule.service.toLowerCase()) {
          return protocolError(id, -32004, "Integration service does not match policy");
        }
        return protocolResult(id, await client.callTool(name, args));
      } catch {
        return protocolError(id, -32003, "Integration request rejected by policy");
      }
    }
    if (isMutatingHomarrTool(name)) {
      return protocolError(id, -32003, "Mutating Homarr tools are unavailable on the read-only bridge");
    }
    if (!isReadOnlyHomarrTool(name)) {
      return protocolError(id, -32602, "Unknown tool");
    }
    try {
      const tools = await getCatalog();
      const available = tools.some((tool) => tool.name === name);
      if (!available) {
        return protocolError(id, -32602, "Unknown tool");
      }
      const result = await client.callTool(name, args, { curatedOnly: useFallbackCatalog });
      return protocolResult(id, result);
    } catch {
      return protocolError(id, -32000, "Homarr tool call failed");
    }
  }

  async function handleRequest(message) {
    if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return protocolError(null, -32600, "Invalid Request");
    }
    if (!("id" in message)) {
      return null;
    }
    if (!validId(message.id)) {
      return protocolError(null, -32600, "Invalid Request");
    }
    let params = {};
    if (message.params !== undefined) {
      if (!isRecord(message.params)) {
        return protocolError(message.id, -32602, "Invalid params");
      }
      params = message.params;
    }

    if (message.method === "initialize") {
      if (!validInitializeParams(params)) {
        return protocolError(message.id, -32602, "Invalid params");
      }
      try {
        return protocolResult(message.id, {
          protocolVersion: chooseProtocolVersion(params),
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: capabilityEnabled ? "selfhost-homarr-integration-policy" : "selfhost-homarr-read-only",
            version: "1.0.0",
          },
          instructions: await endpointInstructions(),
        });
      } catch {
        return protocolError(message.id, -32000, "Homarr endpoint unavailable");
      }
    }
    if (message.method === "ping") {
      return protocolResult(message.id, {});
    }
    if (message.method === "tools/list") {
      try {
        const tools = await getCatalog();
        let catalogMode = "native-read-only-projection";
        if (useFallbackCatalog) {
          catalogMode = "curated-date-schema-fallback";
        }
        return protocolResult(message.id, {
          tools,
          _meta: {
            "selfhost-homarr/bridgeMode": capabilityEnabled ? "integration-request-policy" : "read-only",
            "selfhost-homarr/endpointMode": client.endpointMode,
            "selfhost-homarr/catalogMode": catalogMode,
          },
        });
      } catch {
        return protocolError(message.id, -32000, "Homarr tool catalog unavailable");
      }
    }
    if (message.method === "tools/call") {
      return await handleToolCall(message.id, params);
    }
    return protocolError(message.id, -32601, "Method not found");
  }

  return { handleRequest };
}

export function createReadOnlyBridge(client) {
  return createCapabilityBridge(client);
}

function createProfileBridge(profilePath) {
  const profile = loadProfile(profilePath, { requireKey: true });
  const client = new NativeHomarrMcpClient({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    allowCompatibility: true,
  });
  return createCapabilityBridge(client, profile.capabilityPolicy ?? null);
}

function writeProtocol(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function runCli() {
  let bridge;
  try {
    if (Bun.argv.length !== 3) {
      throw new Error("profile path is required");
    }
    bridge = createProfileBridge(Bun.argv[2]);
  } catch {
    bridge = null;
  }

  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });
  let sequence = Promise.resolve();
  input.on("line", (line) => {
    sequence = sequence.then(async () => {
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        writeProtocol(protocolError(null, -32700, "Parse error"));
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        writeProtocol(protocolError(null, -32700, "Parse error"));
        return;
      }
      if (!bridge) {
        let id = null;
        if (isRecord(message) && validId(message.id)) {
          id = message.id;
        }
        writeProtocol(protocolError(id, -32000, "Homarr bridge unavailable"));
        return;
      }
      const response = await bridge.handleRequest(message);
      if (response) {
        writeProtocol(response);
      }
    }).catch(() => {
      writeProtocol(protocolError(null, -32603, "Internal error"));
    });
  });

  process.stdout.on("error", () => {
    process.exitCode = 1;
  });
}

const scriptPath = fileURLToPath(import.meta.url);
if (Bun.argv[1] && resolve(Bun.argv[1]) === scriptPath) {
  await runCli();
}
