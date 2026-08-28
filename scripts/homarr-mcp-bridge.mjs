#!/usr/bin/env node

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { loadHomarrApiKey, loadSession } from "./lib/session-context.mjs";
import {
  isMutatingHomarrTool,
  isReadOnlyHomarrTool,
  isRecord,
  NativeHomarrMcpClient,
} from "./lib/homarr-mcp.mjs";

const MAX_LINE_BYTES = 1024 * 1024;
const SERVER_INSTRUCTIONS = [
  "This Homarr bridge is strictly read-only.",
  "Use integration_all and integration_byId to verify the configured Seerr integration.",
  "For add or request wording, run integration_searchMediaRequests, present exact matches, and stop.",
  "No mutation path is installed; report the request as unavailable even after confirmation.",
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

export function createReadOnlyBridge(client) {
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

  async function endpointInstructions() {
    await client.connect();
    if (client.endpointMode === "compatibility") {
      return `${SERVER_INSTRUCTIONS} Compatibility endpoint /api/mcp/mcp is active because canonical /api/mcp returned 404 or 405.`;
    }
    return `${SERVER_INSTRUCTIONS} Canonical endpoint /api/mcp is active.`;
  }

  async function getCatalog() {
    if (catalog) {
      return catalog;
    }
    const listed = await client.listTools();
    catalog = listed.tools.filter(
      (tool) => isRecord(tool) && isReadOnlyHomarrTool(tool.name),
    );
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
    if (isMutatingHomarrTool(name)) {
      return protocolError(
        id,
        -32003,
        "Mutating Homarr tools are unavailable on the read-only bridge",
      );
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
          serverInfo: { name: "auto-stack-homarr-read-only", version: "1.0.0" },
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
            "selfhost-homarr/bridgeMode": "read-only",
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

function createSessionBridge(runId) {
  const session = loadSession(runId);
  const { apiKey } = loadHomarrApiKey(session);
  return createReadOnlyBridge(new NativeHomarrMcpClient(session, apiKey));
}

function writeProtocol(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function runCli() {
  let bridge;
  try {
    if (process.argv.length !== 3) {
      throw new Error("RUN_ID is required");
    }
    bridge = createSessionBridge(process.argv[2]);
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
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await runCli();
}
