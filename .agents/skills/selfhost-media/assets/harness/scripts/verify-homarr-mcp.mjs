#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";

import {
  loadHomarrApiKey,
  loadSession,
  normalizeName,
  REPO_ROOT,
  sanitizedChildEnvironment,
} from "./lib/session-context.mjs";
import {
  CURATED_HOMARR_TOOLS,
  isRecord,
  NativeHomarrMcpClient,
  toolResultArray,
  toolResultValue,
} from "./lib/homarr-mcp.mjs";

const TARGET_TITLE = "Spider-Man: No Way Home";
const MAX_BRIDGE_OUTPUT = 4 * 1024 * 1024;

function bridgePath() {
  const path = join(REPO_ROOT, "scripts", "homarr-mcp-bridge.mjs");
  const stat = lstatSync(path);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || realpathSync(path) !== path
  ) {
    throw new Error("Homarr MCP bridge path is invalid");
  }
  return path;
}

function bridgeRequest(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function probeBridge(runId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath(), runId], {
      cwd: REPO_ROOT,
      env: sanitizedChildEnvironment(),
      stdio: ["pipe", "pipe", "ignore"],
    });
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
        reject(error);
        return;
      }
      resolve(responses);
    };

    const timeout = setTimeout(() => {
      finish(new Error("Homarr MCP bridge timed out"));
    }, 15_000);

    child.on("error", () => {
      finish(new Error("Homarr MCP bridge could not start"));
    });
    child.on("exit", () => {
      if (responses.size < 4) {
        finish(new Error("Homarr MCP bridge exited early"));
      }
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > MAX_BRIDGE_OUTPUT) {
        finish(new Error("Homarr MCP bridge output is too large"));
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
          finish(new Error("Homarr MCP bridge returned invalid JSON"));
          return;
        }
        if (!isRecord(response) || response.jsonrpc !== "2.0") {
          finish(new Error("Homarr MCP bridge returned invalid JSON-RPC"));
          return;
        }
        responses.set(response.id, response);
        if (responses.has(1) && responses.has(2) && responses.has(3) && responses.has(4)) {
          finish();
          return;
        }
      }
    });

    child.stdin.write(bridgeRequest(1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "auto-stack-verifier", version: "1.0.0" },
    }));
    child.stdin.write(bridgeRequest(2, "tools/list"));
    child.stdin.write(bridgeRequest(3, "tools/call", {
      name: "integration_all",
      arguments: {},
    }));
    child.stdin.write(bridgeRequest(4, "tools/call", {
      name: "integration_searchMediaRequests",
      arguments: { query: TARGET_TITLE },
    }));
  });
}

function validateBridgeResponses(responses) {
  const initialize = responses.get(1);
  const toolsList = responses.get(2);
  if (
    !isRecord(initialize?.result)
    || initialize.result.protocolVersion !== "2025-03-26"
    || typeof initialize.result.instructions !== "string"
    || !initialize.result.instructions.includes("integration_searchMediaRequests")
    || !initialize.result.instructions.includes("integration_getMediaRequestOptions")
    || !initialize.result.instructions.includes("integration_requestMedia")
  ) {
    throw new Error("Homarr MCP bridge initialize failed");
  }
  if (!isRecord(toolsList?.result) || !Array.isArray(toolsList.result.tools)) {
    throw new Error("Homarr MCP bridge tools/list failed");
  }
  const names = new Set(
    toolsList.result.tools
      .filter((tool) => isRecord(tool) && typeof tool.name === "string")
      .map((tool) => tool.name),
  );
  for (const tool of CURATED_HOMARR_TOOLS) {
    if (!names.has(tool.name)) {
      throw new Error("Homarr MCP bridge catalog is incomplete");
    }
  }

  const integrationCall = responses.get(3);
  const searchCall = responses.get(4);
  if (!isRecord(integrationCall?.result) || !isRecord(searchCall?.result)) {
    throw new Error("Homarr MCP bridge tools/call failed");
  }
  const integrations = toolResultArray(integrationCall.result);
  const seerrIntegrations = integrations.filter(
    (integration) => isRecord(integration) && normalizeName(integration.kind) === "seerr",
  );
  if (seerrIntegrations.length !== 1) {
    throw new Error("Homarr MCP bridge did not return Seerr");
  }
  const seerr = seerrIntegrations[0];
  if (
    seerr.url !== "http://seerr:5055"
    || !isRecord(seerr.permissions)
    || seerr.permissions.hasUseAccess !== true
    || seerr.permissions.hasInteractAccess !== true
    || seerr.permissions.hasFullAccess !== true
  ) {
    throw new Error("Homarr MCP bridge returned unsafe Seerr permissions");
  }
  if (!stringTreeContains(toolResultValue(searchCall.result), TARGET_TITLE)) {
    throw new Error("Homarr MCP bridge media search did not find the target");
  }
}

function stringTreeContains(value, target) {
  if (typeof value === "string") {
    return normalizeName(value) === normalizeName(target);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => stringTreeContains(entry, target));
  }
  if (isRecord(value)) {
    return Object.values(value).some((entry) => stringTreeContains(entry, target));
  }
  return false;
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error("RUN_ID is required");
  }
  const session = loadSession(process.argv[2]);
  const { apiKey } = loadHomarrApiKey(session);
  const client = new NativeHomarrMcpClient(session, apiKey);

  await client.connect();
  if (client.endpoint !== `${client.baseUrl}/api/mcp`) {
    throw new Error("Homarr canonical MCP endpoint is unavailable");
  }
  process.stdout.write("PASS Homarr MCP API-key authentication\n");
  const nativeCatalog = await client.listTools();
  if (nativeCatalog.fallback) {
    process.stdout.write("PASS Homarr MCP curated Date-schema fallback\n");
  } else {
    process.stdout.write("PASS Homarr MCP native catalog\n");
  }

  validateBridgeResponses(await probeBridge(session.runId));
  process.stdout.write("PASS Homarr stdio bridge initialize, tools/list, and tools/call\n");

  const integrations = toolResultArray(await client.callTool("integration_all"));
  const seerrIntegrations = integrations.filter(
    (integration) => isRecord(integration) && normalizeName(integration.kind) === "seerr",
  );
  if (seerrIntegrations.length !== 1) {
    throw new Error("Homarr Seerr integration is missing or duplicated");
  }
  const seerr = seerrIntegrations[0];
  if (
    typeof seerr.id !== "string"
    || !isRecord(seerr.permissions)
    || seerr.url !== "http://seerr:5055"
    || seerr.permissions.hasUseAccess !== true
    || seerr.permissions.hasInteractAccess !== true
    || seerr.permissions.hasFullAccess !== true
  ) {
    throw new Error("Homarr Seerr integration permissions are incomplete");
  }
  const details = toolResultValue(
    await client.callTool("integration_byId", { id: seerr.id }),
  );
  if (!isRecord(details) || !isRecord(details.app) || typeof details.app.id !== "string") {
    throw new Error("Homarr Seerr integration is not linked to an app");
  }
  process.stdout.write("PASS Homarr linked Seerr full, use, and interact permissions\n");

  const searchResult = toolResultValue(
    await client.callTool("integration_searchMediaRequests", {
      query: TARGET_TITLE,
      integrationIds: [seerr.id],
    }),
  );
  if (!stringTreeContains(searchResult, TARGET_TITLE)) {
    throw new Error("Homarr Seerr media search did not find the target");
  }
  process.stdout.write("PASS Homarr Seerr media search target found\n");
}

main().catch(() => {
  process.stdout.write("FAIL Homarr MCP verification\n");
  process.exitCode = 1;
});
