import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/prowlarr/setup.ts";
import type { SetupCheckpoint, SetupContext, SetupInspectionContext } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";

const root = "/tmp/selfhost-prowlarr-fixture";
const privateFiles = join(root, ".selfhost", "shared", "fixture", "secrets", "prowlarr");
const passwordFile = join(privateFiles, "admin-password");
const apiKeyFile = join(privateFiles, "prowlarr-api-key");
const password = "generated-private-password-with-enough-characters";
const apiKey = "a".repeat(32);
const calls: string[] = [];
const loginRequests: string[] = [];
const loginInputs: Array<{ contentType: string; body: string }> = [];
let configured = false;
let foreignAuth = false;
let savedKey: string | null = null;
let checkpoint: SetupCheckpoint | null = null;
let hostUpdateStatus = 202;
let passwordAccepted = true;

function response(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return { status, ok: status >= 200 && status < 300,
    headers: { get(name: string) { return headers[name.toLowerCase()] ?? null; } },
    async json() { return body; }, async text() { return JSON.stringify(body); } };
}

const status = { command: "app status", ownerKind: "shared", appId: "prowlarr",
  projectRoot: root, status: "applied", mutation: false, runtime: { state: "running" },
  privateFiles, passwordFile };

const context = {
  appId: "prowlarr", projectRoot: root,
  async status() { return status; },
  async read() { throw new Error("standalone read was called"); },
  async apply() { throw new Error("standalone apply was called"); },
  http: {
    async request(request: { method: string; path: string; headers?: Record<string, string>;
      body?: string | Uint8Array; approval?: { action: string; once?: boolean };
      beforeSendCheckpoint?: { stage: string; data?: Record<string, string> } }) {
      calls.push(`${request.method} ${request.path}`);
      if (request.path === "/api/v1/config/host" && request.method === "GET") {
        assert.equal(request.headers?.["X-Api-Key"], apiKey);
        return response(200, { id: 1,
          authenticationMethod: configured || foreignAuth ? "forms" : "none",
          authenticationRequired: configured || foreignAuth ? "enabled" : "disabled",
          username: configured ? "admin" : foreignAuth ? "someone-else" : "",
          password: "" });
      }
      if (request.path === "/api/v1/config/host/1" && request.method === "PUT") {
        assert.equal(request.approval?.action, "prowlarr-configure-forms-auth");
        assert.equal(request.approval.once, true);
        assert.equal(request.beforeSendCheckpoint?.stage, "auth-update-attempted");
        assert.equal(JSON.parse(request.body as string).password, password);
        checkpoint = { schemaVersion: 1, appId: "prowlarr", projectRoot: root,
          revision: 1, stage: "auth-update-attempted",
          attemptedActions: ["prowlarr-configure-forms-auth"],
          data: { passwordFile, apiKeyFile } };
        configured = true;
        return response(hostUpdateStatus);
      }
      if (request.path === "/" && request.method === "GET") {
        if (request.headers?.Cookie === "ProwlarrAuth=owned-session") return response(200);
        return response(302, {}, { location: "/login?returnUrl=%2F" });
      }
      if (request.path === "/login" && request.method === "POST") {
        assert.equal(request.approval?.action, "prowlarr-verify-forms-login");
        assert.match(request.headers?.["Content-Type"] ?? "", /^multipart\/form-data; boundary=/);
        const body = Buffer.from(request.body as Uint8Array).toString("utf8");
        assert.ok(body.includes(password));
        loginRequests.push(`${request.headers?.["Content-Type"]}\n${body}`);
        loginInputs.push({ contentType: request.headers?.["Content-Type"] ?? "", body });
        if (!passwordAccepted) return response(302, {}, { location: "/login" });
        return response(302, {}, { location: "/", "set-cookie": "ProwlarrAuth=owned-session; Path=/" });
      }
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    },
  },
  checkpoint: {
    async read() { return checkpoint; },
    async compareAndSet(next: { expectedRevision: number | null; stage: string;
      data?: Record<string, string> }) {
      assert.equal(next.expectedRevision, checkpoint?.revision ?? null);
      checkpoint = { schemaVersion: 1, appId: "prowlarr", projectRoot: root,
        revision: (checkpoint?.revision ?? 0) + 1, stage: next.stage,
        attemptedActions: checkpoint?.attemptedActions ?? [], data: next.data ?? {} };
      return checkpoint;
    },
  },
  secrets: {
    async readAdminPassword() { return password; },
    async readServiceConfigXmlApiKey() { return apiKey; },
    async readApiKey() { return savedKey; },
    async apiKeyPath() { return savedKey === null ? null : apiKeyFile; },
    async writeApiKey(value: string) { assert.equal(value, apiKey); savedKey = value; return apiKeyFile; },
  },
} as unknown as SetupContext;

const first = await adapter.firstRun(context);
assert.equal(adapter.ready(first), true);
assert.equal(first.apiKeyFile, apiKeyFile);
assert.equal(checkpoint?.stage, "forms-login-verified");
assert.equal(calls.filter((call) => call === "PUT /api/v1/config/host/1").length, 1);
const inspected = await adapter.inspect!(context as SetupInspectionContext);
assert.equal(adapter.ready(inspected), false);
assert.equal(adapter.apiReady!(inspected), true);
assert.equal(adapter.apiReady!({ ...inspected, ownerKind: "standalone" }), false);
assert.equal(adapter.apiReady!({ ...inspected, apiKeyFile: join(privateFiles, "foreign-key") }), false);
assert.equal(adapter.apiReady!({ ...inspected, configurationVerified: false }), false);
assert.equal(inspected.stage, "api-config-verified");
assert.equal(inspected.apiVerified, true);
assert.equal(inspected.configurationVerified, true);
assert.equal(inspected.loginVerified, false);
assert.equal(inspected.historicalLoginVerified, true);
assert.equal(adapter.compatibilityResult!(inspected), null);
assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(calls.filter((call) => call === "PUT /api/v1/config/host/1").length, 1);
assert.equal(loginRequests[0], loginRequests[1]);
passwordAccepted = false;
const callsBeforeInspection = calls.length;
const stalePasswordInspection = await adapter.inspect!(context as SetupInspectionContext);
assert.deepEqual(calls.slice(callsBeforeInspection), ["GET /api/v1/config/host"]);
assert.equal(adapter.ready(stalePasswordInspection), false);
assert.equal(adapter.apiReady!(stalePasswordInspection), true);
assert.equal(stalePasswordInspection.loginVerified, false);
assert.equal(stalePasswordInspection.apiVerified, true);
assert.equal(adapter.compatibilityResult!(stalePasswordInspection), null);
await assert.rejects(adapter.firstRun(context), /rejected the saved Forms administrator login/);
assert.equal(calls.filter((call) => call === "PUT /api/v1/config/host/1").length, 1);
passwordAccepted = true;
configured = false;
foreignAuth = true;
checkpoint = null;
await assert.rejects(adapter.firstRun(context), /already has different authentication/);
assert.equal(calls.filter((call) => call === "PUT /api/v1/config/host/1").length, 1);
foreignAuth = false;
savedKey = null;
hostUpdateStatus = 200;
assert.equal(adapter.ready(await adapter.firstRun(context)), true);
assert.equal(calls.filter((call) => call === "PUT /api/v1/config/host/1").length, 2);
assert.equal(loginRequests[0], loginRequests.at(-1));

const approvalRoot = await mkdtemp(join(tmpdir(), "selfhost-prowlarr-approval-"));
try {
  const projectId = "shared-approval";
  const directory = join(approvalRoot, ".selfhost", "shared", projectId);
  const secrets = join(directory, "secrets", "prowlarr");
  await mkdir(secrets, { recursive: true, mode: 0o700 });
  const tokens: string[] = [];
  const facilities = createSetupTransportFacilities({
    appId: "prowlarr", projectRoot: approvalRoot,
    async readStatus() {
      return { command: "app status", ownerKind: "shared", appId: "prowlarr",
        projectRoot: approvalRoot, projectId, status: "applied", mutation: false,
        runtime: { state: "running" }, ownerRevision: 4, manifestHash: "a".repeat(64),
        port: 18080, dockerContext: "default",
        composeTarget: join(directory, "compose.aaaaaaaaaaaaaaaa.yaml"),
        applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`,
        url: "http://127.0.0.1:18080", privateFiles: secrets,
        passwordFile: join(secrets, "admin-password") };
    },
    async readHandoff() { throw new Error("Unexpected credential handoff"); },
    async approve(_action, token) { tokens.push(token); return false; },
    approvalQueue: { tail: Promise.resolve() },
    registerSecret() {}, redact(value) { return value; },
  });
  for (const input of loginInputs.slice(0, 2)) {
    await assert.rejects(facilities.http.request({ method: "POST", path: "/login",
      headers: { Accept: "text/html", "Content-Type": input.contentType },
      body: input.body,
      approval: { action: "prowlarr-verify-forms-login", progress: "Verify the saved login" },
    }), /declined/);
  }
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0], tokens[1]);
} finally {
  await rm(approvalRoot, { recursive: true });
}
console.log("Prowlarr shared first-run setup: pass");
