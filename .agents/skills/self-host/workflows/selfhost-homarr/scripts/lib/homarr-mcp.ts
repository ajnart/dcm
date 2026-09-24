import { normalizeBaseUrl, validateApiKey } from "./profile.ts";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CANONICAL_PATH = "/api/mcp";
const COMPATIBILITY_PATH = "/api/mcp/mcp";
const DATE_SCHEMA_FAILURE_MESSAGE = "Date cannot be represented in JSON Schema";

export const MUTATING_HOMARR_TOOL_NAMES = Object.freeze([
  "app_update",
  "integration_request",
  "integration_requestMedia",
  "mediaRequests_answerRequest",
]);

export const READ_ONLY_HOMARR_TOOL_NAMES = Object.freeze([
  "app_all",
  "app_search",
  "integration_all",
  "integration_byId",
  "integration_search",
  "integration_mediaRequestSearchTargets",
  "integration_searchMediaRequests",
  "integration_getMediaRequestOptions",
  "mediaRequests_getLatestRequests",
  "mediaRequests_getStats",
]);

const readOnlyToolNames = new Set(READ_ONLY_HOMARR_TOOL_NAMES);
const mutatingToolNames = new Set(MUTATING_HOMARR_TOOL_NAMES);

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
    description: "List all app tiles.",
    inputSchema: emptyObjectSchema,
  },
  {
    name: "app_search",
    description: "Search app tiles by name.",
    inputSchema: objectSchema(
      {
        query: stringSchema(),
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      ["query"],
    ),
  },
  {
    name: "integration_all",
    description: "List configured integrations and their permissions.",
    inputSchema: emptyObjectSchema,
  },
  {
    name: "integration_byId",
    description: "Get integration details and its linked app tile.",
    inputSchema: objectSchema({ id: integrationId }, ["id"]),
  },
  {
    name: "integration_search",
    description: "Search configured integrations by name.",
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
    description: "List integrations that support read-only media-request search.",
    inputSchema: emptyObjectSchema,
  },
  {
    name: "integration_searchMediaRequests",
    description:
      "Read-only: search one selected Seerr integration and present exact matches; this bridge cannot request media.",
    inputSchema: objectSchema(
      {
        query: stringSchema(),
        integrationIds: arraySchema(integrationId, { minItems: 1, maxItems: 1 }),
      },
      ["query", "integrationIds"],
    ),
  },
  {
    name: "integration_getMediaRequestOptions",
    description: "Read-only: inspect available TV seasons for a selected search match.",
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
    name: "mediaRequests_getLatestRequests",
    description: "Read-only: get recent media requests.",
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
    description: "Read-only: get media-request statistics.",
    inputSchema: objectSchema(
      { integrationIds: arraySchema(integrationId, { minItems: 1 }) },
      ["integrationIds"],
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
    throw new Error("Homarr MCP returned invalid JSON-RPC");
  }
  return parsed;
}

function isCatalogSchemaFailure(value) {
  return value === DATE_SCHEMA_FAILURE_MESSAGE;
}

class NativeMcpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "NativeMcpError";
    this.status = options.status ?? 0;
    this.code = options.code;
    this.catalogSchemaFailure = options.catalogSchemaFailure === true;
    this.protocolResponse = options.protocolResponse === true;
  }
}

function isAuthenticationFailure(error) {
  return error instanceof NativeMcpError && (error.status === 401 || error.status === 403);
}

function isDefinitiveRouteMissing(error) {
  return error instanceof NativeMcpError
    && (error.status === 404 || error.status === 405)
    && !error.protocolResponse;
}

function isModernMethodUnsupported(error) {
  return error instanceof NativeMcpError
    && error.protocolResponse
    && error.status >= 200
    && error.status < 300
    && error.code === -32601;
}

async function postJsonRpc(url, apiKey, method, params, options = {}) {
  const requestId = options.requestId ?? 1;
  const bodyParams = { ...params };
  const headers = {
    Accept: "application/json, text/event-stream",
    ApiKey: apiKey,
    "Content-Type": "application/json",
  };
  if (options.modern === true) {
    bodyParams._meta = {
      "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientInfo": {
        name: "selfhost-homarr",
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
    let fetchImplementation = globalThis.fetch;
    if (typeof options.fetchImplementation === "function") {
      fetchImplementation = options.fetchImplementation;
    }
    if (typeof fetchImplementation !== "function") {
      throw new Error("fetch is unavailable");
    }
    response = await fetchImplementation(url, {
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
    throw new NativeMcpError("Homarr MCP authentication failed", { status: response.status });
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
      protocolResponse: true,
    });
  }
  if (isPlainObject(payload.error)) {
    throw new NativeMcpError("Homarr MCP returned an RPC error", {
      status: response.status,
      code: payload.error.code,
      protocolResponse: true,
      catalogSchemaFailure:
        response.ok
        && method === "tools/list"
        && payload.error.code === -32603
        && isCatalogSchemaFailure(payload.error.message),
    });
  }
  if (!response.ok || !("result" in payload)) {
    throw new NativeMcpError("Homarr MCP request failed", {
      status: response.status,
      protocolResponse: true,
    });
  }
  return payload.result;
}

async function probeEndpoint(url, apiKey, fetchImplementation) {
  try {
    const discovery = await postJsonRpc(url, apiKey, "server/discover", {}, {
      modern: true,
      requestId: "discover",
      fetchImplementation,
    });
    return { available: true, modern: true, discovery };
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      throw error;
    }
    if (isDefinitiveRouteMissing(error)) {
      return { available: false };
    }
    if (!isModernMethodUnsupported(error)) {
      throw error;
    }
  }

  try {
    await postJsonRpc(url, apiKey, "tools/list", {}, {
      modern: false,
      requestId: "probe",
      fetchImplementation,
    });
    return { available: true, modern: false, discovery: null };
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      throw error;
    }
    if (error instanceof NativeMcpError && error.catalogSchemaFailure) {
      return {
        available: true,
        modern: false,
        discovery: null,
        catalogSchemaFailure: true,
      };
    }
    throw error;
  }
}

function validateCatalog(result) {
  if (!isPlainObject(result) || !Array.isArray(result.tools)) {
    throw new Error("Homarr MCP returned an invalid tool catalog");
  }
  const valid = result.tools.every(
    (tool) => isPlainObject(tool)
      && typeof tool.name === "string"
      && isPlainObject(tool.inputSchema),
  );
  if (!valid) {
    throw new Error("Homarr MCP returned an invalid tool catalog");
  }
  return result.tools;
}

export class NativeHomarrMcpClient {
  constructor(options) {
    if (!isPlainObject(options)) {
      throw new Error("Homarr MCP client options are invalid");
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = validateApiKey(options.apiKey);
    this.allowCompatibility = options.allowCompatibility !== false;
    this.fetchImplementation = options.fetchImplementation;
    this.endpoint = null;
    this.endpointMode = null;
    this.modern = true;
    this.catalogSchemaFailure = false;
    this.requestId = 10;
  }

  async connect() {
    if (this.endpoint) {
      return;
    }
    const canonicalUrl = `${this.baseUrl}${CANONICAL_PATH}`;
    const canonical = await probeEndpoint(
      canonicalUrl,
      this.apiKey,
      this.fetchImplementation,
    );
    if (canonical.available) {
      this.endpoint = canonicalUrl;
      this.endpointMode = "canonical";
      this.modern = canonical.modern;
      this.catalogSchemaFailure = canonical.catalogSchemaFailure === true;
      return;
    }
    if (!this.allowCompatibility) {
      throw new Error("Homarr canonical MCP endpoint is unavailable");
    }
    const compatibilityUrl = `${this.baseUrl}${COMPATIBILITY_PATH}`;
    const compatibility = await probeEndpoint(
      compatibilityUrl,
      this.apiKey,
      this.fetchImplementation,
    );
    if (!compatibility.available) {
      throw new Error("Homarr MCP endpoint is unavailable");
    }
    this.endpoint = compatibilityUrl;
    this.endpointMode = "compatibility";
    this.modern = compatibility.modern;
    this.catalogSchemaFailure = compatibility.catalogSchemaFailure === true;
  }

  async request(method, params = {}) {
    await this.connect();
    this.requestId += 1;
    return await postJsonRpc(this.endpoint, this.apiKey, method, params, {
      modern: this.modern,
      requestId: this.requestId,
      fetchImplementation: this.fetchImplementation,
    });
  }

  async listTools() {
    if (this.catalogSchemaFailure) {
      return { tools: CURATED_HOMARR_TOOLS, fallback: true };
    }
    try {
      const result = await this.request("tools/list", {});
      return { tools: validateCatalog(result), fallback: false };
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

export function isMutatingHomarrTool(name) {
  return mutatingToolNames.has(name);
}

export function isReadOnlyHomarrTool(name) {
  return readOnlyToolNames.has(name);
}
