#!/usr/bin/env bun

import assert from "node:assert/strict";

import { createReadOnlyBridge } from "./homarr-mcp-bridge.ts";
import {
  CURATED_HOMARR_TOOLS,
  MUTATING_HOMARR_TOOL_NAMES,
  NativeHomarrMcpClient,
} from "./lib/homarr-mcp.ts";

const EXPECTED_TOOL_NAMES = [
  "integration_all",
  "integration_byId",
  "integration_searchMediaRequests",
];
const TEST_SESSION = { manifest: { HOMARR_PORT: "7575" } };
const TEST_KEY = "TEST_ONLY_HOMARR_KEY";

function mockTool(name) {
  return {
    name,
    description: "mock tool",
    inputSchema: { type: "object", properties: {} },
  };
}

function mockResponse(status, body) {
  let encoded = body;
  if (typeof body !== "string") {
    encoded = JSON.stringify(body);
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") {
          return "application/json";
        }
        return null;
      },
    },
    async text() {
      return encoded;
    },
  };
}

function rpcError(id, code, message, status = 200) {
  return mockResponse(status, {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function requestPayload(options) {
  return JSON.parse(options.body);
}

async function checkReadOnlyProjectionAndCallGate() {
  assert.deepEqual(
    CURATED_HOMARR_TOOLS.map((tool) => tool.name),
    EXPECTED_TOOL_NAMES,
  );

  const upstreamCalls = [];
  const client = {
    endpointMode: "canonical",
    async connect() {},
    async listTools() {
      return {
        tools: [
          ...CURATED_HOMARR_TOOLS,
          ...MUTATING_HOMARR_TOOL_NAMES.map(mockTool),
          mockTool("app_all"),
          mockTool("future_mutation"),
        ],
        fallback: false,
      };
    },
    async callTool(name, args) {
      upstreamCalls.push({ name, args });
      return { structuredContent: { results: [] } };
    },
  };
  const bridge = createReadOnlyBridge(client);
  const listed = await bridge.handleRequest({
    jsonrpc: "2.0",
    id: "list",
    method: "tools/list",
    params: {},
  });
  assert.equal(listed.result._meta["selfhost-homarr/bridgeMode"], "read-only");
  assert.equal(
    listed.result._meta["selfhost-homarr/catalogMode"],
    "native-read-only-projection",
  );
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    EXPECTED_TOOL_NAMES,
  );

  const search = await bridge.handleRequest({
    jsonrpc: "2.0",
    id: "search",
    method: "tools/call",
    params: {
      name: "integration_searchMediaRequests",
      arguments: {
        query: "Spider-Man: No Way Home",
        integrationIds: ["seerr-1"],
      },
    },
  });
  assert.ok(search.result);
  assert.equal(upstreamCalls.length, 1);

  for (const name of MUTATING_HOMARR_TOOL_NAMES) {
    const rejected = await bridge.handleRequest({
      jsonrpc: "2.0",
      id: `reject-${name}`,
      method: "tools/call",
      params: { name, arguments: {} },
    });
    assert.equal(rejected.error.code, -32003);
  }
  for (const name of ["app_all", "future_mutation"]) {
    const rejected = await bridge.handleRequest({
      jsonrpc: "2.0",
      id: `reject-${name}`,
      method: "tools/call",
      params: { name, arguments: {} },
    });
    assert.equal(rejected.error.code, -32602);
  }
  assert.equal(upstreamCalls.length, 1);
}

function clientWithFetch(fetchImplementation) {
  return new NativeHomarrMcpClient(TEST_SESSION, TEST_KEY, {
    allowCompatibility: false,
    fetchImplementation,
  });
}

async function checkExactDateSchemaFallback() {
  const exactCalls = [];
  const exactClient = clientWithFetch(async (url, options) => {
    exactCalls.push(String(url));
    const payload = requestPayload(options);
    if (payload.method === "server/discover") {
      return rpcError(payload.id, -32601, "Method not found");
    }
    return rpcError(payload.id, -32603, "Date cannot be represented in JSON Schema");
  });
  await exactClient.connect();
  const fallback = await exactClient.listTools();
  assert.equal(fallback.fallback, true);
  assert.deepEqual(
    fallback.tools.map((tool) => tool.name),
    EXPECTED_TOOL_NAMES,
  );
  assert.equal(exactCalls.length, 2);

  const decoratedClient = clientWithFetch(async (url, options) => {
    const payload = requestPayload(options);
    if (payload.method === "server/discover") {
      return rpcError(payload.id, -32601, "Method not found");
    }
    return rpcError(
      payload.id,
      -32603,
      "Date cannot be represented in JSON Schema (decorated)",
    );
  });
  await assert.rejects(decoratedClient.connect());

  const serverErrorClient = clientWithFetch(async (url, options) => {
    const payload = requestPayload(options);
    if (payload.method === "server/discover") {
      return rpcError(payload.id, -32601, "Method not found");
    }
    return rpcError(
      payload.id,
      -32603,
      "Date cannot be represented in JSON Schema",
      500,
    );
  });
  await assert.rejects(serverErrorClient.connect());
}

await checkReadOnlyProjectionAndCallGate();
process.stdout.write("PASS media bridge projects only the three read-only tools and rejects all others\n");
await checkExactDateSchemaFallback();
process.stdout.write("PASS media bridge uses only the exact Date-schema fallback\n");
