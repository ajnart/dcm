#!/usr/bin/env node

import assert from "node:assert/strict";

import { createReadOnlyBridge } from "./homarr-mcp-bridge.mjs";
import {
  CURATED_HOMARR_TOOLS,
  MUTATING_HOMARR_TOOL_NAMES,
  NativeHomarrMcpClient,
} from "./lib/homarr-mcp.mjs";
import {
  buildPlan,
  mappingFromCoverage,
  validateMapping,
  validateSelection,
} from "./integration-plan.mjs";
import {
  identifySeerrIntegration,
  mediaSearchArguments,
  validateStructuredSearchResult,
} from "./verify-homarr.mjs";

const TEST_KEY = "TEST_ONLY_HOMARR_KEY_123456789";
const QUERY = "Spider-Man: No Way Home";

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

function rpcResult(id, result, status = 200) {
  return mockResponse(status, { jsonrpc: "2.0", id, result });
}

function requestPayload(options) {
  return JSON.parse(options.body);
}

function clientWithFetch(fetchImplementation) {
  return new NativeHomarrMcpClient({
    baseUrl: "http://127.0.0.1:7575",
    apiKey: TEST_KEY,
    allowCompatibility: true,
    fetchImplementation,
  });
}

async function checkReadOnlyBridge() {
  const upstreamCalls = [];
  const nativeTools = [
    ...CURATED_HOMARR_TOOLS,
    ...MUTATING_HOMARR_TOOL_NAMES.map((name) => ({
      name,
      description: "mock mutation",
      inputSchema: { type: "object", properties: {} },
    })),
  ];
  const client = {
    endpointMode: "canonical",
    async connect() {},
    async listTools() {
      return { tools: nativeTools, fallback: false };
    },
    async callTool(name, args) {
      upstreamCalls.push({ name, args });
      return {
        structuredContent: {
          results: [{ title: QUERY, id: 1 }],
        },
      };
    },
  };
  const bridge = createReadOnlyBridge(client);
  const listed = await bridge.handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });
  const names = new Set(listed.result.tools.map((tool) => tool.name));
  assert.equal(listed.result._meta["selfhost-homarr/bridgeMode"], "read-only");
  for (const name of MUTATING_HOMARR_TOOL_NAMES) {
    assert.equal(names.has(name), false);
  }

  const search = await bridge.handleRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "integration_searchMediaRequests",
      arguments: mediaSearchArguments("seerr-1", QUERY),
    },
  });
  assert.ok(search.result);
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].name, "integration_searchMediaRequests");

  for (const name of MUTATING_HOMARR_TOOL_NAMES) {
    const rejected = await bridge.handleRequest({
      jsonrpc: "2.0",
      id: `mutation-${name}`,
      method: "tools/call",
      params: { name, arguments: {} },
    });
    assert.equal(rejected.error.code, -32003);
  }
  assert.equal(upstreamCalls.length, 1);
}

async function checkCanonicalFailures() {
  const serverFailureCalls = [];
  const serverFailureClient = clientWithFetch(async (url, options) => {
    serverFailureCalls.push(String(url));
    const payload = requestPayload(options);
    return rpcError(payload.id, -32603, "server failure", 500);
  });
  await assert.rejects(serverFailureClient.connect());
  assert.deepEqual(serverFailureCalls, ["http://127.0.0.1:7575/api/mcp"]);

  const exactDate500Calls = [];
  const exactDate500Client = clientWithFetch(async (url, options) => {
    exactDate500Calls.push(String(url));
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
  await assert.rejects(exactDate500Client.connect());
  assert.equal(exactDate500Calls.length, 2);
  assert.equal(exactDate500Calls.every((url) => url.endsWith("/api/mcp")), true);

  const malformedCalls = [];
  const malformedClient = clientWithFetch(async (url) => {
    malformedCalls.push(String(url));
    return mockResponse(200, "not-json");
  });
  await assert.rejects(malformedClient.connect());
  assert.deepEqual(malformedCalls, ["http://127.0.0.1:7575/api/mcp"]);

  const unrelatedCalls = [];
  const unrelatedClient = clientWithFetch(async (url, options) => {
    unrelatedCalls.push(String(url));
    const payload = requestPayload(options);
    return rpcError(payload.id, -32600, "unrelated RPC error");
  });
  await assert.rejects(unrelatedClient.connect());
  assert.deepEqual(unrelatedCalls, ["http://127.0.0.1:7575/api/mcp"]);

  const valid404Calls = [];
  const valid404Client = clientWithFetch(async (url, options) => {
    valid404Calls.push(String(url));
    const payload = requestPayload(options);
    return rpcError(payload.id, -32601, "Method not found", 404);
  });
  await assert.rejects(valid404Client.connect());
  assert.deepEqual(valid404Calls, ["http://127.0.0.1:7575/api/mcp"]);
}

async function checkDateFallback() {
  const decoratedCalls = [];
  const decoratedClient = clientWithFetch(async (url, options) => {
    decoratedCalls.push(String(url));
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
  assert.equal(decoratedCalls.length, 2);
  assert.equal(decoratedCalls.every((url) => url.endsWith("/api/mcp")), true);

  const exactClient = clientWithFetch(async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:7575/api/mcp");
    const payload = requestPayload(options);
    if (payload.method === "server/discover") {
      return rpcError(payload.id, -32601, "Method not found");
    }
    return rpcError(payload.id, -32603, "Date cannot be represented in JSON Schema");
  });
  await exactClient.connect();
  const catalog = await exactClient.listTools();
  assert.equal(catalog.fallback, true);
  assert.equal(
    catalog.tools.some((tool) => MUTATING_HOMARR_TOOL_NAMES.includes(tool.name)),
    false,
  );
}

async function checkCompatibilityGate() {
  const calls = [];
  const client = clientWithFetch(async (url, options) => {
    calls.push(String(url));
    const payload = requestPayload(options);
    if (String(url).endsWith("/api/mcp")) {
      return mockResponse(404, "missing");
    }
    return rpcResult(payload.id, { name: "compatibility-mock" });
  });
  await client.connect();
  assert.equal(client.endpointMode, "compatibility");
  assert.deepEqual(calls, [
    "http://127.0.0.1:7575/api/mcp",
    "http://127.0.0.1:7575/api/mcp/mcp",
  ]);
}

function checkVerifierSearchRules() {
  const seerr = identifySeerrIntegration([
    { id: "seerr-1", kind: "seerr", name: "Seerr" },
  ]);
  assert.equal(seerr.id, "seerr-1");
  assert.deepEqual(mediaSearchArguments(seerr.id, QUERY), {
    query: QUERY,
    integrationIds: ["seerr-1"],
  });
  assert.throws(() => identifySeerrIntegration([]));
  assert.throws(() => identifySeerrIntegration([
    { id: "seerr-1", kind: "seerr" },
    { id: "seerr-2", name: "Seerr" },
  ]));
  assert.throws(() => identifySeerrIntegration([{ id: "", kind: "seerr" }]));

  assert.throws(() => validateStructuredSearchResult({
    structuredContent: { query: QUERY, results: [] },
  }, QUERY));
  assert.throws(() => validateStructuredSearchResult({
    structuredContent: { results: [{ query: QUERY }] },
  }, QUERY));
  const results = validateStructuredSearchResult({
    structuredContent: {
      results: [{ id: 1, title: "Spider-Man: No Way Home" }],
    },
  }, QUERY);
  assert.equal(results.length, 1);
}

function coverageEntry(appId, status) {
  if (status === "supported") {
    return {
      status,
      surface: "standard",
      identifier: appId,
      displayName: appId,
      appId,
      appName: appId,
      lifecycle: "active",
      automation: "guided",
    };
  }
  return {
    status,
    surface: null,
    identifier: null,
    displayName: null,
    appId,
    appName: appId,
    lifecycle: "active",
    automation: "guided",
  };
}

function checkCoverageHandoff() {
  const required = [
    "seerr",
    "sonarr",
    "radarr",
    "prowlarr",
    "qbittorrent",
    "jellyfin",
    "immich",
  ];
  const coverage = {
    checkedAt: "2026-08-28",
    officialSources: ["https://example.invalid/homarr"],
    counts: {},
    entries: [
      ...required.map((appId) => coverageEntry(appId, "supported")),
      coverageEntry("grafana", "gap"),
    ],
  };
  const handoff = mappingFromCoverage(coverage);
  assert.equal(handoff.mapping.immich, "official-integration");
  assert.equal(handoff.mapping.grafana, "app-tile-only");
  assert.equal(validateMapping({}).immich, "official-integration");

  const selection = validateSelection({
    selectedApps: ["immich", "grafana", "unknown-app"],
    media: false,
    connectedIntegrations: [],
    generatedDashboard: false,
  });
  const plan = buildPlan(selection, handoff.mapping, {
    kind: "catalog-homarr",
    checkedAt: handoff.checkedAt,
  });
  const classifications = Object.fromEntries(
    plan.classifications.map((entry) => [entry.app, entry.classification]),
  );
  assert.equal(classifications.immich, "official integration");
  assert.equal(classifications.grafana, "app-tile-only gap");
  assert.equal(classifications["unknown-app"], "unsupported");

  const mediaPlan = buildPlan(validateSelection({
    selectedApps: required,
    media: true,
    connectedIntegrations: required.filter((appId) => appId !== "immich"),
    generatedDashboard: true,
  }), handoff.mapping, {
    kind: "catalog-homarr",
    checkedAt: handoff.checkedAt,
  });
  assert.equal(mediaPlan.media.generatedDashboardGate, "ready-for-managed-evidence-check");
}

await checkReadOnlyBridge();
process.stdout.write("PASS read-only bridge rejects mutations after search\n");
await checkCanonicalFailures();
process.stdout.write("PASS canonical failures cannot trigger compatibility\n");
await checkDateFallback();
process.stdout.write("PASS exact Date-schema fallback only\n");
await checkCompatibilityGate();
process.stdout.write("PASS compatibility requires canonical 404 or 405\n");
checkVerifierSearchRules();
process.stdout.write("PASS verifier requires exact structured Seerr result\n");
checkCoverageHandoff();
process.stdout.write("PASS catalog coverage handoff classifications\n");
