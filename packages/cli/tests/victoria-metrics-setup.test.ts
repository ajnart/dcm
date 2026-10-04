import assert from "node:assert/strict";

import ollama from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/ollama/setup";
import stirling from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/stirling-pdf/setup";
import prometheus from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/prometheus/setup";
import victoria from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/victoria-metrics/setup";
import vector from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/vector/setup";
import type { SetupCheckpoint, SetupContext, SetupHttpRequest } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup";

// Grafana's account/token mutations have their own grafana-setup fixture;
// this fixture covers genuinely read-only, account-free shared adapters.
for (const adapter of [victoria, prometheus, ollama, stirling, vector]) {
  const projectRoot = `/tmp/monitor-fixture-${adapter.appId}`;
  const calls: string[] = [];
  let exactOwner = true;
  let validVersion = true;
  let vectorHealth: unknown = { ok: true };
  let responseOk = true;
  const context = {
    appId: adapter.appId, projectRoot,
    async status() {
      let savedRoot = projectRoot;
      if (!exactOwner) savedRoot = "/tmp/different-monitor-owner";
      return { command: "app status", appId: adapter.appId, projectRoot: savedRoot,
        status: "applied", mutation: false, runtime: { state: "running" },
        ownerKind: "shared", username: "admin", passwordFile: `${projectRoot}/admin.txt` };
    },
    secrets: { async readAdminPassword() { throw new Error("No-account setup must not read a password"); } },
    http: { async request(request: SetupHttpRequest) {
      assert.equal(request.method, "GET");
      assert.equal(request.approval, undefined);
      calls.push(request.path);
      let body: unknown = {};
      if (request.path === "/vmui/config.json") {
        let version = "v1.153.0";
        if (!validVersion) version = "v1.152.0";
        body = { version };
      } else if (request.path === "/api/v1/status/buildinfo") {
        assert.equal(adapter.appId, "prometheus");
        body = { status: "success", data: { version: "3.15.0" } };
      } else if (request.path === "/api/version") {
        body = { version: "0.34.1" };
      } else if (request.path === "/api/tags") {
        body = { models: [] };
      } else if (request.path === "/") {
        assert.equal(adapter.appId, "stirling-pdf");
      } else {
        assert.ok(["/health", "/-/ready"].includes(request.path));
        if (adapter.appId === "vector") body = vectorHealth;
      }
      return { status: 200, ok: responseOk, headers: { get() { return null; } },
        async json() { return body; }, async text() {
          if (request.path === "/") return "<html><title>Stirling PDF</title></html>";
          return JSON.stringify(body);
        } };
    } },
  } as unknown as SetupContext;
  assert.equal(adapter.sharedOwner, true);
  assert.equal(adapter.ready(await adapter.firstRun(context)), true);
  assert.equal(adapter.ready(await adapter.firstRun(context)), true);
  const beforeOwnerDenial = calls.length;
  exactOwner = false;
  await assert.rejects(adapter.firstRun(context), /exact saved app project/);
  assert.equal(calls.length, beforeOwnerDenial);
  exactOwner = true;
  await assert.rejects(adapter.firstRun({ ...context, appId: "another-app" }), /another app|different app ID/);
  assert.equal(calls.length, beforeOwnerDenial);
  if (adapter.appId === "victoria-metrics") {
    assert.deepEqual(calls, ["/health", "/vmui/config.json", "/health", "/vmui/config.json"]);
    exactOwner = true;
    validVersion = false;
    await assert.rejects(adapter.firstRun(context), /pinned single-node version/);
  }
  if (adapter.appId === "vector") {
    assert.equal(adapter.healthSource, "GET /health (Vector service only)");
    assert.equal((await adapter.firstRun(context)).realTelemetryVerified, false);
    responseOk = false;
    await assert.rejects(adapter.firstRun(context), /endpoint is unavailable/);
    responseOk = true;
    for (const body of [{ ok: false }, [], null]) {
      vectorHealth = body;
      await assert.rejects(adapter.firstRun(context), /did not report serving/);
    }
  }
}

// Provenance is owner-first-read/replay, not a synthetic fresh server claim.
for (const adapter of [victoria, prometheus, stirling, vector]) {
  const projectRoot = `/tmp/no-account-provenance-${adapter.appId}`;
  let marker: SetupCheckpoint | null = null;
  let writes = 0;
  let reads = 0;
  let validResponse = true;
  let selectionFingerprint = "a".repeat(64);
  let manifestHash = "b".repeat(64);
  let sharedOwner = true;
  const context = {
    appId: adapter.appId, projectRoot,
    async status() {
      const status = { command: "app status", appId: adapter.appId, projectRoot,
      status: "applied", mutation: false, runtime: { state: "running" },
      ownerKind: "shared", loginVia: "none", username: null, passwordFile: null,
      projectId: "no-account-fixture", selectionFingerprint, manifestHash };
      if (!sharedOwner) status.ownerKind = "standalone";
      return status;
    },
    checkpoint: {
      async read() { return structuredClone(marker); },
      async compareAndSet(update: any) {
        assert.equal(update.expectedRevision, null);
        assert.equal(marker, null);
        writes += 1;
        marker = { schemaVersion: 1, appId: adapter.appId, projectRoot, revision: 1,
          stage: update.stage, attemptedActions: [], data: update.data };
        return structuredClone(marker);
      },
    },
    http: { async request(request: SetupHttpRequest) {
      assert.equal(request.method, "GET");
      reads += 1;
      let body: unknown = {};
      if (request.path === "/vmui/config.json") body = { version: "v1.153.0" };
      if (request.path === "/api/v1/status/buildinfo") body = { status: "success", data: { version: "3.15.0" } };
      if (adapter.appId === "vector") body = { ok: true };
      let status = 503;
      if (validResponse) status = 200;
      return { status, ok: validResponse,
        async json() { return body; }, async text() { return "<html><title>Stirling PDF</title></html>"; } };
    } },
  } as unknown as SetupContext;
  validResponse = false;
  await assert.rejects(adapter.firstRun(context));
  assert.equal(marker, null);
  assert.equal(writes, 0);
  validResponse = true;
  sharedOwner = false;
  marker = { schemaVersion: 1, appId: adapter.appId, projectRoot, revision: 1,
    stage: "legacy-standalone-ready", attemptedActions: [], data: {} };
  const standaloneMarker = structuredClone(marker);
  const standalone = await adapter.firstRun(context);
  assert.equal(adapter.ready(standalone), true);
  assert.equal(adapter.compatibilityResult!(standalone), null);
  assert.equal(adapter.ready(await adapter.inspect!(context)), true);
  assert.deepEqual(marker, standaloneMarker);
  assert.equal(writes, 0);
  sharedOwner = true;
  marker = null;
  assert.equal(adapter.compatibilityResult!(await adapter.inspect!(context)), null);
  assert.equal(marker, null);
  assert.equal(writes, 0);
  const fresh = await adapter.firstRun(context);
  if (adapter.appId === "vector") {
    assert.equal(fresh.stage, "private-health-ready");
    assert.equal(fresh.realTelemetryVerified, false);
  }
  assert.deepEqual(adapter.compatibilityResult!(fresh), { origin: "fresh", credentialReadback: "no-account-verified" });
  assert.equal(adapter.compatibilityResult!(structuredClone(fresh)), null);
  assert.equal(writes, 1);
  // Unrelated app additions may change the whole manifest, not this app's selection.
  manifestHash = "c".repeat(64);
  assert.deepEqual(adapter.compatibilityResult!(await adapter.firstRun(context)),
    { origin: "resume", credentialReadback: "no-account-verified" });
  assert.equal(writes, 1);
  assert.equal(adapter.compatibilityResult!(await adapter.inspect!(context)), null);
  assert.equal(writes, 1);
  const beforeMismatch = reads;
  selectionFingerprint = "d".repeat(64);
  await assert.rejects(adapter.firstRun(context), /marker changed/);
  await assert.rejects(adapter.inspect!(context), /marker changed/);
  assert.equal(reads, beforeMismatch);
  assert.equal(writes, 1);
}

console.log("Monitoring shared read-only setup, VM version, replay and owner denial: pass (synthetic)");
