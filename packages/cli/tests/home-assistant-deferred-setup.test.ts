import assert from "node:assert/strict";
import { createServer } from "node:http";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/home-assistant/setup.ts";
import type { SetupContext } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { createSetupTransportFacilities } from "../src/control-panel/setup-transport.ts";
import { prepareMultiServiceFiles } from "../src/lib/multi-service-recipe.ts";

const root = await mkdtemp(join(tmpdir(), "ha-deferred-setup-"));
let created = false;
let ownerWrites = 0;
let flowOpens = 0;
let logins = 0;
let exchanges = 0;
let password = "";
let onboardingStatus = 200;
let remainingStepsDone = false;
const server = createServer(async (request, result) => {
  let raw = "";
  for await (const chunk of request) raw += String(chunk);
  result.setHeader("Content-Type", "application/json");
  let body: unknown;
  if (request.url === "/api/onboarding") {
    result.statusCode = onboardingStatus;
    body = [{ step: "user", done: created }, ...["core_config", "analytics", "integration"].map((step) => ({ step, done: remainingStepsDone }))];
  } else if (request.url === "/api/onboarding/users") {
    assert.equal(request.method, "POST");
    assert.equal(created, false);
    ownerWrites += 1;
    created = true;
    body = { auth_code: "discarded" };
  } else if (request.url === "/auth/login_flow") {
    flowOpens += 1;
    body = { type: "form", flow_id: flowOpens.toString(16).padStart(32, "0") };
  } else if (request.url?.startsWith("/auth/login_flow/")) {
    assert.equal(request.url, `/auth/login_flow/${flowOpens.toString(16).padStart(32, "0")}`);
    assert.equal(JSON.parse(raw).password, password);
    logins += 1;
    body = { type: "create_entry", result: logins.toString(16).padStart(32, "0") };
  } else if (request.url === "/auth/token") {
    assert.equal(new URLSearchParams(raw).get("code"), logins.toString(16).padStart(32, "0"));
    exchanges += 1;
    body = { access_token: `private-session-${"a".repeat(64)}-${exchanges}`,
      token_type: "Bearer", expires_in: 1800 };
  } else if (request.url === "/api/") {
    assert.equal(request.headers.authorization, `Bearer private-session-${"a".repeat(64)}-${exchanges}`);
    body = { message: "API running." };
  } else throw new Error("Unexpected fixture route");
  result.end(JSON.stringify(body));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const projectId = "ha_deferred";
  const projectDirectory = join(root, ".selfhost", "shared", projectId);
  const privateFiles = join(projectDirectory, "secrets", "home-assistant");
  await mkdir(join(root, ".selfhost", "shared"), { recursive: true, mode: 0o700 });
  const recipe = await Bun.file(new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/home-assistant/recipe.json", import.meta.url)).json();
  await prepareMultiServiceFiles(recipe, projectDirectory, join(projectDirectory, "data", "home-assistant"), undefined, "home-assistant");
  const passwordFile = join(privateFiles, "admin-password");
  password = await readFile(passwordFile, "utf8");
  assert.match(password, /^[A-Za-z0-9]{65}$/);
  const status = { command: "app status", ownerKind: "shared", appId: "home-assistant",
    projectRoot: root, mutation: false, status: "applied", runtime: { state: "running" },
    projectId, dockerContext: "default", port: address.port, url: `http://127.0.0.1:${address.port}`,
    composeTarget: join(projectDirectory, "compose.aaaaaaaaaaaaaaaa.yaml"),
    applyApproval: `SHARED-APPLY:${projectId}:${"a".repeat(64)}`, ownerRevision: 1,
    manifestHash: "b".repeat(64), privateFiles, passwordFile, username: "admin" };
  const approvals = new Set<string>();
  const reviews: Array<{ action: string; token: string }> = [];

  // Reconstruct the actual facilities each time, as separate CLI invocations
  // do. Only current_user is stubbed; all HTTP approvals and token-command
  // hashing/private session persistence run through the real shared transport.
  function invocation(): SetupContext {
    const facilities = createSetupTransportFacilities({ appId: "home-assistant", projectRoot: root,
      async readStatus() { return status; }, async readHandoff() { throw new Error("Unexpected handoff"); },
      async approve(action, token) { reviews.push({ action, token }); return approvals.has(token); },
      approvalQueue: { tail: Promise.resolve() }, registerSecret() {}, redact(value) { return value; } });
    const originalWebSocket = facilities.webSocket.request;
    return { ...facilities, appId: "home-assistant", projectRoot: root,
      async status() { return status; }, installedAppIds: [], inputs: {},
      webSocket: { async request(request) {
        if (request.type === "auth/current_user") {
          return { id: "b".repeat(32), is_owner: true, is_admin: true,
            credentials: [{ auth_provider_type: "homeassistant", auth_provider_id: null }] };
        }
        return originalWebSocket(request);
      } },
    } as unknown as SetupContext;
  }
  async function deferred(): Promise<{ action: string; token: string }> {
    await assert.rejects(adapter.firstRun(invocation()), /approval was declined/);
    assert.ok(reviews.length > 0);
    return reviews.at(-1)!;
  }
  let review = await deferred(); // First-owner write.
  approvals.add(review.token);
  review = await deferred(); // Open login flow.
  approvals.add(review.token);
  review = await deferred(); // Password POST to the newly saved flow ID.
  assert.equal(flowOpens, 1);
  const flowReview = review.token;
  assert.equal((await deferred()).token, flowReview);
  assert.equal(flowOpens, 1);
  approvals.add(flowReview);
  review = await deferred(); // Exchange the privately saved authorization code.
  assert.equal(logins, 1);
  const exchangeReview = review.token;
  assert.equal((await deferred()).token, exchangeReview);
  assert.equal(logins, 1);
  approvals.add(exchangeReview);
  review = await deferred(); // Create long-lived token from stable saved session.
  assert.equal(review.action, "home-assistant-create-integration-token");
  assert.equal(exchanges, 1);
  const tokenReview = review.token;
  assert.equal((await deferred()).token, tokenReview);
  assert.equal(exchanges, 1);
  assert.equal(ownerWrites, 1);
  assert.equal(flowOpens, 1);
  assert.equal(logins, 1);
  assert.equal((await lstat(join(privateFiles, "session-cookies.json"))).mode & 0o777, 0o600);
  const saved = await invocation().secrets.readSessionCookies();
  assert.deepEqual(Object.keys(saved).sort(), ["access_token", "password_digest"]);
  assert.equal((await invocation().checkpoint.read())?.stage, "owner-attempted");

  // Account/token readiness is not proof that the remaining wizard is closed.
  // Use real generated/private-file transport, with only completed WebSocket
  // key issuance and its saved receipt injected for read-only inspection.
  const inspected = invocation();
  const apiKeyFile = await inspected.secrets.writeApiKey(`synthetic-integration-${"d".repeat(64)}`);
  inspected.checkpoint.read = async () => ({ schemaVersion: 1, appId: "home-assistant", projectRoot: root,
    revision: 3, stage: "owner-and-token-verified",
    attemptedActions: ["home-assistant-first-admin", "home-assistant-create-integration-token"],
    data: { ownerId: "b".repeat(32), credentialRef: passwordFile, apiKeyFile } });
  const unfinished = await adapter.inspect!(inspected);
  assert.ok(adapter.ready(unfinished));
  assert.equal(unfinished.onboardingComplete, false);
  assert.deepEqual(unfinished.pendingOnboardingSteps, ["core_config", "analytics", "integration"]);
  remainingStepsDone = true;
  const finished = await adapter.inspect!(inspected);
  assert.equal(finished.onboardingComplete, true);
  assert.deepEqual(finished.pendingOnboardingSteps, []);
  created = false;
  await assert.rejects(adapter.inspect!(inspected), /saved owner onboarding is no longer complete/);
  created = true;
  onboardingStatus = 404; // Pinned view is absent after completed onboarding restarts.
  assert.equal((await adapter.inspect!(inspected)).onboardingComplete, true);
  onboardingStatus = 500;
  await assert.rejects(adapter.inspect!(inspected), /completion could not be read back/);
  assert.equal(ownerWrites, 1);
  assert.equal(logins, 1);
  process.stdout.write("Home Assistant actual-transport deferred approval hashes and private session persistence: pass\n");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); }));
  await rm(root, { recursive: true, force: true });
}
