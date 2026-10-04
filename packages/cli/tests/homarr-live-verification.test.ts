import assert from "node:assert/strict";
import { homarrVerificationSourceCommit, verifyHomarrService } from "../src/lib/homarr-live-verification.ts";
import { checkSharedHomarrServices, testSharedHomarrStoredIntegration } from "../src/shared-homarr.ts";

const secret = "SYNTHETIC_PRIVATE_RESPONSE_NEVER_EMIT";
const configuration = { id: "adguard-home", appName: "AdGuard Home", boardName: "personal",
  browserUrl: "http://127.0.0.1:41071", serverUrl: "http://adguard-home:3000/" };
function fixture() {
  const integration = { id: "integration-adguard", name: "Auto-Stack: adguard-home", kind: "adGuardHome",
    url: configuration.serverUrl, permissions: { hasFullAccess: true, hasUseAccess: true } };
  const app = { id: "app-adguard", name: configuration.appName, href: configuration.browserUrl,
    pingUrl: configuration.serverUrl as string | null };
  const board = { id: "board-personal", name: "personal", isPublic: false, sections: [], items: [
    { id: "tile-adguard", kind: "app", options: { appId: app.id } },
    ...["dnsHoleSummary", "dnsHoleControls"].map((kind) => ({ id: kind, kind, options: {}, integrationIds: [integration.id] })),
  ] };
  let failWidget = false;
  let failPing = false;
  const calls: { procedure: string; input: unknown }[] = [];
  const context = { sourceCommit: homarrVerificationSourceCommit,
    async query(procedure: string, input?: unknown) {
      calls.push({ procedure, input });
      if (procedure === "board.getAllBoards") return [{ id: board.id, name: board.name, isPublic: board.isPublic }];
      if (procedure === "board.getBoardByName") return board;
      if (procedure === "app.all") return [app];
      if (procedure === "integration.all") return [integration];
      if (procedure === "integration.byId") return { ...integration, app, secrets: [{ kind: "password", value: secret }] };
      if (procedure === "widget.app.ping") {
        assert.deepEqual(input, { id: app.id });
        if (failPing) throw new Error(secret);
        return { url: configuration.serverUrl, statusCode: 200, durationMs: 2, private: secret };
      }
      if (procedure === "widget.dnsHole.summary") {
        assert.deepEqual(input, { integrationIds: [integration.id] });
        if (failWidget) return [{ integrationId: integration.id, summary: null, error: secret }];
        return [{ integrationId: integration.id, summary: { status: "disabled", domainsBeingBlocked: 0,
          adsBlockedToday: 0, adsBlockedTodayPercentage: 0, dnsQueriesToday: 0, private: secret } }];
      }
      throw new Error(secret);
    },
    async mutate() { throw new Error("Mutating transport must never be used"); },
  };
  return { context, calls, board, app, failWidget() { failWidget = true; }, failPing() { failPing = true; } };
}
{
  const f = fixture();
  const result = await verifyHomarrService(configuration, f.context);
  assert.equal(result.checks.tile.status, "pass");
  assert.equal(result.checks.reachability.status, "pass");
  assert.equal(result.checks.integrationTest.status, "not-run");
  assert.equal(result.checks.reload.status, "not-run");
  assert.equal(result.renderedContentVerified, false);
  assert.equal(result.deployedSourceRevisionVerified, false);
  assert.equal(result.mutation, false);
  assert.ok(result.widgets.every((widget) => widget.structure.status === "pass" && widget.data.status === "pass"),
    "Zero-valued and disabled DNS blocking data are successful queries, not loading failures");
  assert.equal(f.calls.filter((call) => call.procedure === "widget.dnsHole.summary").length, 1);
  assert.equal(f.calls.filter((call) => call.procedure === "app.all").length, 1);
  assert.equal(f.calls.filter((call) => call.procedure === "board.getBoardByName").length, 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.ok(f.calls.every(({ procedure }) => !/create|update|delete|enable|disable|test/.test(procedure)));
  await verifyHomarrService(configuration, f.context);
  assert.equal(f.calls.filter((call) => call.procedure === "widget.dnsHole.summary").length, 2,
    "Readback caches must not span invocations");
}
{
  const f = fixture(); f.failWidget(); f.failPing();
  const result = await verifyHomarrService(configuration, f.context);
  assert.equal(result.checks.reachability.status, "fail");
  assert.ok(result.widgets.every((widget) => widget.structure.status === "pass" && widget.data.status === "fail"));
  assert.equal(JSON.stringify(result).includes(secret), false);
}
{
  const f = fixture(); f.board.items = [];
  const result = await verifyHomarrService(configuration, f.context);
  assert.equal(result.checks.tile.status, "fail");
  assert.equal(result.checks.reachability.status, "not-run");
  assert.ok(result.widgets.every((widget) => widget.data.status === "not-run"));
  assert.equal(f.calls.some(({ procedure }) => procedure.startsWith("widget.")), false);
}
{
  const f = fixture(); f.board.isPublic = true;
  const result = await verifyHomarrService(configuration, f.context);
  assert.equal(result.checks.tile.status, "fail");
  assert.equal(f.calls.some(({ procedure }) => procedure.startsWith("widget.")), false);
}
{
  const f = fixture();
  f.app.pingUrl = null;
  const result = await verifyHomarrService(configuration, f.context);
  assert.equal(result.checks.tile.status, "pass");
  assert.equal(result.checks.reachability.status, "not-run");
  assert.equal(result.checks.reachability.reason, "saved-server-target-mismatch");
  assert.equal(f.calls.some(({ procedure }) => procedure === "widget.app.ping"), false,
    "Do not probe a browser localhost URL from Homarr or an unreviewed custom ping target");
}
{
  const f = fixture();
  const result = await checkSharedHomarrServices({ query: f.context.query,
    async mutate(): Promise<never> { assert.fail("Shared live readback cannot mutate"); } },
    "personal", [{ seed: { ...configuration, credentials: { password: secret } } }]);
  assert.equal(result[0].checks.reachability.status, "pass");
  assert.ok(result[0].widgets.every((widget) => widget.data.status === "pass"));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.ok(f.calls.every(({ procedure }) => !/create|update|delete|enable|disable|test/.test(procedure)));
}
{
  const f = fixture(); f.context.sourceCommit = "unverified";
  const result = await verifyHomarrService(configuration, f.context);
  assert.equal(result.checks.tile.status, "not-run");
  assert.equal(f.calls.length, 0);
}
{
  const origin = "http://127.0.0.1:41070";
  const id = "integration-adguard";
  const requests: { path: string; options: RequestInit }[] = [];
  function transport(status: number, body: unknown) {
    return (async (url, options) => {
      requests.push({ path: String(url), options: options! });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }
  const pass = await testSharedHomarrStoredIntegration(origin, secret, id, transport(200, { success: true }));
  assert.equal(pass.status, "pass");
  assert.equal(pass.reason, "stored-integration-connection-verified");
  assert.equal(requests[0].path, `${origin}/api/integrations/${id}/test-connection`);
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.body, undefined);
  assert.equal(requests[0].options.redirect, "error");
  assert.equal((requests[0].options.headers as Record<string, string>).ApiKey, secret);
  assert.equal(JSON.stringify(pass).includes(secret), false);
  for (const status of [404, 405]) {
    assert.equal((await testSharedHomarrStoredIntegration(origin, secret, id, transport(status, { error: secret }))).status, "not-run");
  }
  for (const status of [401, 403, 500]) {
    const failed = await testSharedHomarrStoredIntegration(origin, secret, id, transport(status, { error: secret }));
    assert.equal(failed.status, "fail");
    assert.equal(JSON.stringify(failed).includes(secret), false);
  }
  for (const error of ["missingSecret", "authorization", "certificate", "request", "statusCode", "parse", "unknown"]) {
    const failed = await testSharedHomarrStoredIntegration(origin, secret, id, transport(200, { success: false, error }));
    assert.equal(failed.status, "fail");
    assert.equal(failed.reason, `stored-integration-${error}`);
  }
  for (const body of [{ success: false, error: secret }, { success: true, data: secret }, {},
    { success: true, extra: "x".repeat(5000) }]) {
    const failed = await testSharedHomarrStoredIntegration(origin, secret, id, transport(200, body));
    assert.equal(failed.status, "fail");
    assert.equal(JSON.stringify(failed).includes(secret), false);
  }
  const brokenTransport = (async () => { throw new Error(secret); }) as typeof fetch;
  const failed = await testSharedHomarrStoredIntegration(origin, secret, id, brokenTransport);
  assert.equal(failed.status, "fail");
  assert.equal(JSON.stringify(failed).includes(secret), false);
  const invalid = await testSharedHomarrStoredIntegration(origin, secret, "../unowned", brokenTransport);
  assert.equal(invalid.reason, "stored-integration-request-scope-invalid");
}
{
  const f = fixture();
  const probed: string[] = [];
  const services = [{ seed: { ...configuration, credentials: {} } }, { seed: { ...configuration, credentials: {} } }];
  const result = await checkSharedHomarrServices({ query: f.context.query,
    async mutate(): Promise<never> { assert.fail("Connection checks cannot mutate dashboard resources"); } },
  "personal", services, async (id) => {
    probed.push(id);
    return { status: "pass", reason: "stored-integration-connection-verified" };
  });
  assert.deepEqual(probed, ["integration-adguard"]);
  assert.ok(result.every((service) => service.checks.integrationTest.status === "pass"));
  assert.equal(result[0].renderedContentVerified, false);
  f.board.items = [];
  await checkSharedHomarrServices({ query: f.context.query,
    async mutate(): Promise<never> { assert.fail("Connection checks cannot mutate dashboard resources"); } },
  "personal", services, async () => { assert.fail("Missing exact private-board tile cannot authorize a probe"); });
}
console.log("Homarr actual read-only query acceptance and private-output checks passed (synthetic fixture only)");
