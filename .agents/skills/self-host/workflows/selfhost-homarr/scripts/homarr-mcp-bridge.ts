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
  toolResultArray,
  toolResultValue,
} from "./lib/homarr-mcp.ts";

const MAX_LINE_BYTES = 1024 * 1024;
const MEDIA_REQUEST_TOOL = "integration_requestMedia";
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

function normalizeTitle(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function validateMediaRequest(args, policy) {
  const allowedFields = new Set([
    "integrationId",
    "query",
    "mediaId",
    "mediaType",
    "seasons",
    "confirmed",
  ]);
  if (Object.keys(args).some((key) => !allowedFields.has(key))) {
    throw new Error("media request fields are outside the configured policy");
  }
  if (args.integrationId !== policy.integrationId || args.confirmed !== true) {
    throw new Error("media request is outside the configured policy");
  }
  if (
    typeof args.query !== "string"
    || args.query.length < 1
    || args.query.length > 200
    || /[\u0000-\u001f\u007f]/u.test(args.query)
    || normalizeTitle(args.query).length === 0
  ) {
    throw new Error("media request query is invalid");
  }
  if (typeof args.mediaId !== "number" || !Number.isFinite(args.mediaId)) {
    throw new Error("media request media ID is invalid");
  }
  if (args.mediaType !== "movie" && args.mediaType !== "tv") {
    throw new Error("media request media type is invalid");
  }
  if (args.seasons !== undefined) {
    if (
      args.mediaType !== "tv"
      || !Array.isArray(args.seasons)
      || args.seasons.length < 1
      || args.seasons.length > 100
      || args.seasons.some((season) => !Number.isInteger(season) || season < 0)
    ) {
      throw new Error("media request seasons are invalid");
    }
  }
  const forwarded = {
    integrationId: args.integrationId,
    mediaId: args.mediaId,
    mediaType: args.mediaType,
  };
  if (args.seasons !== undefined) {
    forwarded.seasons = [...new Set(args.seasons)];
  }
  return {
    query: args.query,
    forwarded,
  };
}

function validateExactMediaSearch(result, request, policy) {
  const results = toolResultArray(result);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("media request search results are invalid");
  }
  const expectedTitle = normalizeTitle(request.query);
  const exactMatch = results.some((entry) => {
    if (!isRecord(entry) || !isRecord(entry.integration)) {
      return false;
    }
    const title = entry.title ?? entry.name;
    const mediaId = entry.mediaId ?? entry.id;
    const mediaType = entry.mediaType ?? entry.type;
    return normalizeTitle(title) === expectedTitle
      && mediaId === request.forwarded.mediaId
      && mediaType === request.forwarded.mediaType
      && entry.integration.id === policy.integrationId
      && String(entry.integration.kind).toLowerCase() === "seerr";
  });
  if (!exactMatch) {
    throw new Error("media request search result does not exactly match");
  }
}

function mediaRequestTool(tool, integrationId) {
  return {
    ...tool,
    description:
      "Submit one confirmed exact-title result through the configured Seerr integration. Re-runs the exact search before forwarding.",
    inputSchema: {
      type: "object",
      properties: {
        integrationId: {
          type: "string",
          const: integrationId,
          description: "The one Seerr integration authorized by this profile.",
        },
        query: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "The exact title selected from integration_searchMediaRequests.",
        },
        mediaId: { type: "number", description: "The selected search result ID." },
        mediaType: {
          type: "string",
          enum: ["movie", "tv"],
          description: "The selected search result type.",
        },
        seasons: {
          type: "array",
          items: { type: "integer", minimum: 0 },
          minItems: 1,
          maxItems: 100,
          description: "TV season numbers; omit only when the confirmed request covers all seasons.",
        },
        confirmed: {
          type: "boolean",
          const: true,
          description: "Caller attests that the user approved this exact request and possible downstream acquisition. The bridge cannot verify human approval.",
        },
      },
      required: ["integrationId", "query", "mediaId", "mediaType", "confirmed"],
      additionalProperties: false,
    },
  };
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
  const integrationRequestEnabled = capabilityPolicy?.mode === "integration-request";
  const mediaRequestEnabled = capabilityPolicy?.mode === "media-request";

  function bridgeMode() {
    if (integrationRequestEnabled) {
      return "integration-request-policy";
    }
    if (mediaRequestEnabled) {
      return "media-request-policy";
    }
    return "read-only";
  }

  function serverName() {
    if (integrationRequestEnabled) {
      return "selfhost-homarr-integration-policy";
    }
    if (mediaRequestEnabled) {
      return "selfhost-homarr-media-request-policy";
    }
    return "selfhost-homarr-read-only";
  }

  async function endpointInstructions() {
    await client.connect();
    let instructions = SERVER_INSTRUCTIONS;
    if (integrationRequestEnabled) {
      instructions = [
        "This Homarr bridge exposes read-only tools plus one policy-constrained integration_request tool.",
        "Every integration request must match its configured integration ID, service kind, method, and exact path.",
        "DELETE also requires confirmed true after the user confirms its effects.",
      ].join(" ");
    } else if (mediaRequestEnabled) {
      instructions = [
        "This Homarr bridge exposes read-only tools plus one policy-constrained integration_requestMedia tool.",
        "It can target only the configured Seerr integration ID.",
        "Every request requires confirmed true and an exact title, media ID, and media type match from a fresh scoped search.",
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
    catalog = listed.tools
      .filter((tool) => isRecord(tool) && (
        isReadOnlyHomarrTool(tool.name)
        || (integrationRequestEnabled && tool.name === "integration_request")
        || (mediaRequestEnabled && tool.name === MEDIA_REQUEST_TOOL)
      ))
      .map((tool) => {
        if (mediaRequestEnabled && tool.name === MEDIA_REQUEST_TOOL) {
          return mediaRequestTool(tool, capabilityPolicy.integrationId);
        }
        return tool;
      });
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
    if (name === "integration_request" && integrationRequestEnabled) {
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
    if (name === MEDIA_REQUEST_TOOL && mediaRequestEnabled) {
      try {
        const tools = await getCatalog();
        if (!tools.some((tool) => tool.name === name)) {
          return protocolError(id, -32602, "Unknown tool");
        }
        const request = validateMediaRequest(args, capabilityPolicy);
        const search = await client.callTool("integration_searchMediaRequests", {
          query: request.query,
          integrationIds: [capabilityPolicy.integrationId],
        });
        validateExactMediaSearch(search, request, capabilityPolicy);
        return protocolResult(id, await client.callTool(name, request.forwarded));
      } catch {
        return protocolError(id, -32003, "Media request rejected by policy");
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
            name: serverName(),
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
            "selfhost-homarr/bridgeMode": bridgeMode(),
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

export async function runHomarrBridge(profilePath) {
  let bridge;
  try {
    bridge = createProfileBridge(profilePath);
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
  await runHomarrBridge(process.argv.length === 3 ? process.argv[2] : undefined);
}
