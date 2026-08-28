#!/usr/bin/env node

import { createInterface } from "node:readline";

import { loadHomarrApiKey, loadSession } from "./lib/session-context.mjs";
import {
  CURATED_HOMARR_TOOLS,
  isRecord,
  NativeHomarrMcpClient,
} from "./lib/homarr-mcp.mjs";

const MAX_LINE_BYTES = 1024 * 1024;
const REQUIRED_TOOL_NAMES = new Set(CURATED_HOMARR_TOOLS.map((tool) => tool.name));
const SERVER_INSTRUCTIONS = [
  "When the user explicitly asks to add or request media, call integration_searchMediaRequests.",
  "Disambiguate matches before acting.",
  "For TV, call integration_getMediaRequestOptions before integration_requestMedia.",
  "Never request media without explicit user intent.",
].join(" ");

let startupError = false;
let client;
try {
  if (process.argv.length !== 3) {
    throw new Error("RUN_ID is required");
  }
  const session = loadSession(process.argv[2]);
  const { apiKey } = loadHomarrApiKey(session);
  client = new NativeHomarrMcpClient(session, apiKey);
} catch {
  startupError = true;
}

let catalog;
let useFallbackCatalog = false;

function writeProtocol(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeResult(id, result) {
  writeProtocol({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message) {
  writeProtocol({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function validId(id) {
  if (typeof id === "string") {
    return id.length <= 256;
  }
  return typeof id === "number" && Number.isFinite(id);
}

function chooseProtocolVersion(params) {
  const requested = params.protocolVersion;
  if (
    requested === "2024-11-05"
    || requested === "2025-03-26"
    || requested === "2025-06-18"
  ) {
    return requested;
  }
  return "2025-03-26";
}

async function getCatalog() {
  if (catalog) {
    return catalog;
  }
  const nativeCatalog = await client.listTools();
  catalog = nativeCatalog.tools;
  useFallbackCatalog = nativeCatalog.fallback;
  return catalog;
}

async function handleRequest(message) {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    writeError(null, -32600, "Invalid Request");
    return;
  }

  const notification = !("id" in message);
  if (notification) {
    if (!message.method.startsWith("notifications/")) {
      return;
    }
    return;
  }
  if (!validId(message.id)) {
    writeError(null, -32600, "Invalid Request");
    return;
  }
  if (startupError || !client) {
    writeError(message.id, -32000, "Homarr bridge unavailable");
    return;
  }

  let params = {};
  if (message.params !== undefined) {
    if (!isRecord(message.params)) {
      writeError(message.id, -32602, "Invalid params");
      return;
    }
    params = message.params;
  }

  if (message.method === "initialize") {
    if (
      typeof params.protocolVersion !== "string"
      || params.protocolVersion.length > 32
      || !isRecord(params.clientInfo)
      || typeof params.clientInfo.name !== "string"
      || params.clientInfo.name.length > 128
      || typeof params.clientInfo.version !== "string"
      || params.clientInfo.version.length > 64
      || !isRecord(params.capabilities)
    ) {
      writeError(message.id, -32602, "Invalid params");
      return;
    }
    writeResult(message.id, {
      protocolVersion: chooseProtocolVersion(params),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "auto-stack-homarr", version: "1.0.0" },
      instructions: SERVER_INSTRUCTIONS,
    });
    return;
  }

  if (message.method === "ping") {
    writeResult(message.id, {});
    return;
  }

  if (message.method === "tools/list") {
    try {
      writeResult(message.id, { tools: await getCatalog() });
    } catch {
      writeError(message.id, -32000, "Homarr tool catalog unavailable");
    }
    return;
  }

  if (message.method === "tools/call") {
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
      writeError(message.id, -32602, "Invalid params");
      return;
    }

    try {
      const tools = await getCatalog();
      const available = tools.some((tool) => isRecord(tool) && tool.name === name);
      if (!available) {
        writeError(message.id, -32602, "Unknown tool");
        return;
      }
      if (useFallbackCatalog && !REQUIRED_TOOL_NAMES.has(name)) {
        writeError(message.id, -32602, "Unknown tool");
        return;
      }
      const result = await client.callTool(name, args, {
        curatedOnly: useFallbackCatalog,
      });
      writeResult(message.id, result);
    } catch {
      writeError(message.id, -32000, "Homarr tool call failed");
    }
    return;
  }

  writeError(message.id, -32601, "Method not found");
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
      writeError(null, -32700, "Parse error");
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      writeError(null, -32700, "Parse error");
      return;
    }
    await handleRequest(message);
  }).catch(() => {
    writeError(null, -32603, "Internal error");
  });
});

process.stdout.on("error", () => {
  process.exitCode = 1;
});
