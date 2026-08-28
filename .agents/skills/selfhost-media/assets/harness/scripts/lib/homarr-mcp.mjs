const MODERN_PROTOCOL_VERSION = "2026-07-28";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const emptyObjectSchema = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false,
});

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function stringSchema(options = {}) {
  return { type: "string", ...options };
}

function numberSchema(options = {}) {
  return { type: "number", ...options };
}

function arraySchema(items, options = {}) {
  return { type: "array", items, ...options };
}

const integrationId = stringSchema({ minLength: 1 });
const mediaType = { type: "string", enum: ["tv", "movie"] };

export const CURATED_HOMARR_TOOLS = Object.freeze([
  {
    name: "app_all",
    description: "List all apps.",
    inputSchema: emptyObjectSchema,
  },
  {
    name: "app_search",
    description: "Search apps by name.",
    inputSchema: objectSchema(
      {
        query: stringSchema(),
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      ["query"],
    ),
  },
  {
    name: "app_update",
    description: "Update an existing app.",
    inputSchema: objectSchema(
      {
        id: stringSchema({ minLength: 1 }),
        name: stringSchema({ minLength: 1, maxLength: 64 }),
        description: { type: ["string", "null"], maxLength: 512 },
        iconUrl: stringSchema({ minLength: 1 }),
        href: { type: ["string", "null"] },
        pingUrl: { type: ["string", "null"] },
      },
      ["id", "name", "iconUrl", "href"],
    ),
  },
  {
    name: "integration_all",
    description: "List all configured integrations and their permissions.",
    inputSchema: emptyObjectSchema,
  },
  {
    name: "integration_byId",
    description: "Get integration details and its linked app.",
    inputSchema: objectSchema({ id: integrationId }, ["id"]),
  },
  {
    name: "integration_search",
    description: "Search integrations by name.",
    inputSchema: objectSchema(
      {
        query: stringSchema(),
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      ["query"],
    ),
  },
  {
    name: "integration_mediaRequestSearchTargets",
    description: "List integrations that support media-request search.",
    inputSchema: emptyObjectSchema,
  },
  {
    name: "integration_searchMediaRequests",
    description:
      "Search Seerr for movies or TV shows after explicit add/request intent. Disambiguate the returned matches before requesting.",
    inputSchema: objectSchema(
      {
        query: stringSchema(),
        integrationIds: arraySchema(integrationId),
      },
      ["query"],
    ),
  },
  {
    name: "integration_getMediaRequestOptions",
    description:
      "Get available seasons before requesting a TV match selected from integration_searchMediaRequests.",
    inputSchema: objectSchema(
      {
        integrationId,
        mediaId: numberSchema(),
        mediaType,
      },
      ["integrationId", "mediaId", "mediaType"],
    ),
  },
  {
    name: "integration_requestMedia",
    description:
      "Submit a selected media match only when the user explicitly asked to add or request it.",
    inputSchema: objectSchema(
      {
        integrationId,
        mediaId: numberSchema(),
        mediaType,
        seasons: arraySchema(numberSchema({ minimum: 0 })),
      },
      ["integrationId", "mediaId", "mediaType"],
    ),
  },
  {
    name: "mediaRequests_getLatestRequests",
    description: "Get recent media requests.",
    inputSchema: objectSchema(
      {
        integrationIds: arraySchema(integrationId, { minItems: 1 }),
        statuses: arraySchema(
          {
            type: "string",
            enum: ["pending", "approved", "declined", "failed", "completed"],
          },
          { minItems: 1 },
        ),
        recentDays: numberSchema({ minimum: 0, maximum: 365 }),
      },
      ["integrationIds", "statuses", "recentDays"],
    ),
  },
  {
    name: "mediaRequests_getStats",
    description: "Get media-request statistics.",
    inputSchema: objectSchema(
      { integrationIds: arraySchema(integrationId, { minItems: 1 }) },
      ["integrationIds"],
    ),
  },
  {
    name: "mediaRequests_answerRequest",
    description: "Approve or decline a pending media request.",
    inputSchema: objectSchema(
      {
        integrationId,
        requestId: numberSchema(),
        answer: { type: "string", enum: ["approve", "decline"] },
      },
      ["integrationId", "requestId", "answer"],
    ),
  },
]);

const curatedToolNames = new Set(CURATED_HOMARR_TOOLS.map((tool) => tool.name));

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseProtocolBody(contentType, body) {
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("Homarr MCP response is too large");
  }

  let encoded = body;
  if (contentType.includes("text/event-stream")) {
    const dataLines = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) {
      throw new Error("Homarr MCP returned an invalid event stream");
    }
    encoded = dataLines.at(-1);
  }

  const parsed = JSON.parse(encoded);
  if (!isPlainObject(parsed) || parsed.jsonrpc !== "2.0") {
    throw new Error("Homarr MCP returned an invalid JSON-RPC response");
  }
  return parsed;
}

function isCatalogSchemaFailure(value) {
  return String(value ?? "").includes("Date cannot be represented in JSON Schema");
}

class NativeMcpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "NativeMcpError";
    this.status = options.status ?? 0;
    this.code = options.code;
    this.catalogSchemaFailure = options.catalogSchemaFailure === true;
  }
}

async function postJsonRpc(url, apiKey, method, params, options = {}) {
  const requestId = options.requestId ?? 1;
  const modern = options.modern === true;
  const bodyParams = { ...params };
  const headers = {
    Accept: "application/json, text/event-stream",
    ApiKey: apiKey,
    "Content-Type": "application/json",
  };

  if (modern) {
    bodyParams._meta = {
      "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientInfo": {
        name: "auto-stack-harness",
        version: "1.0.0",
      },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    headers["MCP-Protocol-Version"] = MODERN_PROTOCOL_VERSION;
    headers["Mcp-Method"] = method;
    if (method === "tools/call") {
      headers["Mcp-Name"] = String(bodyParams.name ?? "");
    } else {
      headers["Mcp-Name"] = "homarr";
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response;
  let responseBody;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method,
        params: bodyParams,
      }),
      redirect: "manual",
      signal: controller.signal,
    });
    responseBody = await response.text();
  } catch {
    throw new NativeMcpError("Homarr MCP did not respond");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new NativeMcpError("Homarr MCP authentication failed", {
      status: response.status,
    });
  }

  let payload;
  try {
    payload = parseProtocolBody(response.headers.get("content-type") ?? "", responseBody);
  } catch {
    throw new NativeMcpError("Homarr MCP returned an invalid response", {
      status: response.status,
    });
  }

  if (payload.id !== requestId) {
    throw new NativeMcpError("Homarr MCP returned a mismatched response", {
      status: response.status,
    });
  }

  if (isPlainObject(payload.error)) {
    throw new NativeMcpError("Homarr MCP returned an RPC error", {
      status: response.status,
      code: payload.error.code,
      catalogSchemaFailure:
        method === "tools/list"
        && payload.error.code === -32603
        && isCatalogSchemaFailure(payload.error.message),
    });
  }
  if (!response.ok || !("result" in payload)) {
    throw new NativeMcpError("Homarr MCP request failed", {
      status: response.status,
    });
  }
  return payload.result;
}

async function probeEndpoint(url, apiKey) {
  try {
    const discovery = await postJsonRpc(url, apiKey, "server/discover", {}, {
      modern: true,
      requestId: "discover",
    });
    return { modern: true, discovery };
  } catch (error) {
    if (!(error instanceof NativeMcpError)) {
      throw error;
    }
    if (error.status === 401 || error.status === 403) {
      throw error;
    }
  }

  try {
    await postJsonRpc(url, apiKey, "tools/list", {}, {
      modern: false,
      requestId: "probe",
    });
    return { modern: false, discovery: null };
  } catch (error) {
    if (!(error instanceof NativeMcpError)) {
      throw error;
    }
    if (error.status === 401 || error.status === 403) {
      throw error;
    }
    return null;
  }
}

export class NativeHomarrMcpClient {
  constructor(session, apiKey) {
    this.baseUrl = `http://127.0.0.1:${session.manifest.HOMARR_PORT}`;
    this.apiKey = apiKey;
    this.endpoint = null;
    this.modern = true;
    this.requestId = 10;
  }

  async connect() {
    if (this.endpoint) {
      return;
    }

    for (const path of ["/api/mcp", "/api/mcp/mcp"]) {
      const url = `${this.baseUrl}${path}`;
      const probe = await probeEndpoint(url, this.apiKey);
      if (!probe) {
        continue;
      }
      this.endpoint = url;
      this.modern = probe.modern;
      return;
    }
    throw new Error("Homarr MCP endpoint is unavailable");
  }

  async request(method, params = {}) {
    await this.connect();
    this.requestId += 1;
    return await postJsonRpc(this.endpoint, this.apiKey, method, params, {
      modern: this.modern,
      requestId: this.requestId,
    });
  }

  async listTools() {
    try {
      const result = await this.request("tools/list", {});
      if (!isPlainObject(result) || !Array.isArray(result.tools)) {
        throw new Error("Homarr MCP returned an invalid tool catalog");
      }
      const validTools = result.tools.every(
        (tool) => isPlainObject(tool)
          && typeof tool.name === "string"
          && isPlainObject(tool.inputSchema),
      );
      if (!validTools) {
        throw new Error("Homarr MCP returned an invalid tool catalog");
      }
      return { tools: result.tools, fallback: false };
    } catch (error) {
      if (
        error instanceof NativeMcpError
        && error.code === -32603
        && error.catalogSchemaFailure
      ) {
        return { tools: CURATED_HOMARR_TOOLS, fallback: true };
      }
      throw error;
    }
  }

  async callTool(name, args = {}, options = {}) {
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(name)) {
      throw new Error("Homarr MCP tool name is invalid");
    }
    if (!isPlainObject(args)) {
      throw new Error("Homarr MCP tool arguments are invalid");
    }
    if (options.curatedOnly === true && !curatedToolNames.has(name)) {
      throw new Error("Homarr MCP tool is outside the fallback catalog");
    }

    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    if (!isPlainObject(result)) {
      throw new Error("Homarr MCP returned an invalid tool result");
    }
    if (result.isError === true) {
      throw new Error("Homarr MCP tool call failed");
    }
    return result;
  }
}

function parseTextContent(result) {
  if (!Array.isArray(result.content)) {
    return undefined;
  }
  for (const content of result.content) {
    if (!isPlainObject(content) || content.type !== "text" || typeof content.text !== "string") {
      continue;
    }
    try {
      return JSON.parse(content.text);
    } catch {
      continue;
    }
  }
  return undefined;
}

export function toolResultValue(result) {
  if (!isPlainObject(result)) {
    throw new Error("Homarr MCP tool result is invalid");
  }
  if ("structuredContent" in result) {
    return result.structuredContent;
  }
  const parsed = parseTextContent(result);
  if (parsed !== undefined) {
    return parsed;
  }
  throw new Error("Homarr MCP tool result has no JSON content");
}

export function toolResultArray(result) {
  const value = toolResultValue(result);
  if (Array.isArray(value)) {
    return value;
  }
  if (isPlainObject(value)) {
    for (const key of ["items", "apps", "integrations", "results", "data"]) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }
  }
  throw new Error("Homarr MCP tool result is not a list");
}

export function isRecord(value) {
  return isPlainObject(value);
}
