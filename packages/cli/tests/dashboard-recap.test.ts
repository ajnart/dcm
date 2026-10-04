import assert from "node:assert/strict";
import { dashboardRecap } from "../src/control-panel/dashboard-recap.ts";

const root = "/tmp/synthetic-dashboard-project";
const report = {
  command: "app shared homarr-status", mutation: false, projectRoot: root, projectId: "example",
  status: "attached", apiKeyAuthorizationVerified: true,
  serviceRuntimeVerified: false, renderedContentVerified: false,
  services: [{ id: "sonarr", metadataVerified: true, structureVerified: true,
    tileOnly: false, integrationStructureVerified: true,
    widgets: [{ kind: "calendar", present: true }],
    notebookContentVerified: true, notebookLayoutVerified: true }],
  preparedJobs: [{ id: "restic", executed: false, browserUrl: null }],
};
const summary = dashboardRecap(report, root, "example", ["restic", "sonarr"]);
assert.match(summary, /sonarr: app link present; integration configured; 1\/1 widgets present; recap present/);
assert.match(summary, /restic: prepared, not executed/);
assert.match(summary, /Service health and live widget data are separate checks/);
const missing = structuredClone(report);
missing.status = "needs-attachment";
missing.services[0]!.widgets[0]!.present = false;
missing.services[0]!.notebookContentVerified = false;
assert.match(dashboardRecap(missing, root, "example", ["restic", "sonarr"]), /0\/1 widgets present; recap needs attention/);
assert.throws(() => dashboardRecap({ ...report, projectId: "other" }, root, "example", ["restic", "sonarr"]));
assert.throws(() => dashboardRecap(report, root, "example", ["sonarr"]));
assert.throws(() => dashboardRecap({ ...report, mutation: true }, root, "example", ["restic", "sonarr"]));
assert.throws(() => dashboardRecap({ ...report, services: [...report.services, ...report.services] }, root, "example", ["restic", "sonarr"]));
const functional = [{ serviceId: "sonarr", checks: { reachability: { status: "pass" } },
  widgets: [{ kind: "calendar", data: { status: "fail" } }] }];
assert.match(dashboardRecap({ ...report, functional }, root, "example", ["restic", "sonarr"]), /widget data 0 passed, 1 failed, 0 not checked/);
assert.match(dashboardRecap({ ...report, functional }, root, "example", ["restic", "sonarr"]), /not fully verified/);
const passing = [{ serviceId: "sonarr", checks: { reachability: { status: "pass" } },
  widgets: [{ kind: "calendar", data: { status: "pass" } }] }];
assert.match(dashboardRecap({ ...report, functional: passing }, root, "example", ["restic", "sonarr"]), /widget data checks passed; integration tests/);
assert.throws(() => dashboardRecap({ ...report, functional: [] }, root, "example", ["restic", "sonarr"]));
assert.throws(() => dashboardRecap({ ...report, functional: [{ ...functional[0], serviceId: "other" }] }, root, "example", ["restic", "sonarr"]));
const serverFailure = [{ serviceId: "sonarr", checks: { reachability: { status: "fail", reason: "homarr-server-http-failed" } },
  widgets: [
    { kind: "calendar", data: { status: "fail", reason: "homarr-query-http-500" } },
    { kind: "calendar", data: { status: "fail", reason: "homarr-query-http-500" } },
  ] }];
const failedSummary = dashboardRecap({ ...report, functional: serverFailure }, root, "example", ["restic", "sonarr"]);
assert.match(failedSummary, /check the app's address and private network from inside Homarr/);
assert.match(failedSummary, /Homarr returned HTTP 500/);
assert.match(failedSummary, /status alone does not identify the cause/);
assert.equal(failedSummary.split("Homarr returned HTTP 500").length, 2, "Repeated failures have one bounded hint per app");
assert.match(failedSummary, /not fully verified/);
for (const status of [401, 403]) {
  const authorization = [{ ...functional[0], widgets: [{ data: { status: "fail", reason: `homarr-query-http-${status}` } }] }];
  assert.match(dashboardRecap({ ...report, functional: authorization }, root, "example", ["restic", "sonarr"]), /API key's access permissions/);
}
const privateReason = "SYNTHETIC_PRIVATE_ERROR_WITH_CREDENTIALS";
const unknown = [{ ...functional[0], widgets: [{ data: { status: "fail", reason: `homarr-query-http-500 ${privateReason}` } }] }];
const unknownSummary = dashboardRecap({ ...report, functional: unknown }, root, "example", ["restic", "sonarr"]);
assert.equal(unknownSummary.includes(privateReason), false);
assert.equal(unknownSummary.includes("Homarr returned HTTP 500"), false, "Only exact sanitized reasons receive explanations");
const readbackFailure = { id: "sonarr", status: "resource-readback-failed", metadataVerified: false,
  structureVerified: false, notebookContentVerified: false, notebookLayoutVerified: false,
  integrationStructureVerified: false, widgetStructureVerified: false };
assert.match(dashboardRecap({ ...report, services: [readbackFailure] }, root, "example", ["restic", "sonarr"]),
  /configuration remains unverified/);
assert.throws(() => dashboardRecap({ ...report, services: [{ ...readbackFailure, widgetStructureVerified: true }] },
  root, "example", ["restic", "sonarr"]), /inconsistent verification claims/);
const skippedPing = [{ ...passing[0], checks: { reachability: { status: "not-run", reason: "saved-server-target-mismatch" } } }];
const skippedSummary = dashboardRecap({ ...report, functional: skippedPing }, root, "example", ["restic", "sonarr"]);
assert.match(skippedSummary, /Ping was skipped because the saved target differs/);
assert.match(skippedSummary, /remain unverified/);
assert.equal(skippedSummary.includes("widget data checks passed"), false);
const connector = { id: "tailscale", state: "connector-applied-unverified", enrollmentStatus: "pending",
  enrollmentVerified: false, clientAccessVerified: false, browserUrl: null,
  integrationKind: null, apiKeyFile: null, notebookStatus: "not-published" };
const connectorReport = { ...report, pendingConnectors: [connector], functional: passing };
const connectorSelection = ["tailscale", "restic", "sonarr"];
const connectorSummary = dashboardRecap(connectorReport, root, "example", connectorSelection);
assert.match(connectorSummary, /tailscale: private connector; enrollment pending; client access unverified/);
assert.match(connectorSummary, /no browser URL, dashboard app link or app API key/);
assert.equal(connectorSummary.includes("tailscale: prepared"), false);
assert.equal(connectorSummary.includes("tailscale: app link"), false);
assert.throws(() => dashboardRecap(connectorReport, root, "example", ["restic", "sonarr"]), /selected apps/);
assert.throws(() => dashboardRecap(report, root, "example", connectorSelection), /selected apps/);
assert.throws(() => dashboardRecap({ ...connectorReport, pendingConnectors: [connector, connector] },
  root, "example", connectorSelection), /selected apps/);
assert.throws(() => dashboardRecap({ ...connectorReport, pendingConnectors: "tailscale" },
  root, "example", connectorSelection), /saved project/);
for (const changed of [
  { state: "prepared" }, { enrollmentStatus: "verified" }, { enrollmentVerified: true },
  { clientAccessVerified: true }, { browserUrl: "https://fiction.example" },
  { integrationKind: "tailscale" }, { apiKeyFile: "/tmp/fiction-api-key" },
  { notebookStatus: "published" },
]) {
  assert.throws(() => dashboardRecap({ ...connectorReport, pendingConnectors: [{ ...connector, ...changed }] },
    root, "example", connectorSelection), /connector readback/);
}
const daemon = { id: "crowdsec", state: "daemon-applied-unverified", enrollmentStatus: "pending",
  enrollmentVerified: false, clientAccessVerified: false, runtimeVerified: false,
  browserUrl: null, integrationKind: null, apiKeyFile: null, notebookStatus: "not-published" };
const tcpService = { id: "postgresql", state: "tcp-applied-unverified", browserUrl: null,
  integrationKind: null, notebookStatus: "not-published", endpoint: privateReason, reason: privateReason };
const nonBrowserReport = { ...connectorReport, pendingDaemons: [daemon], nonBrowserServices: [tcpService] };
const nonBrowserSelection = [...connectorSelection, "crowdsec", "postgresql"];
const nonBrowserSummary = dashboardRecap(nonBrowserReport, root, "example", nonBrowserSelection);
assert.match(nonBrowserSummary, /crowdsec: private daemon; runtime, enrollment and client access unverified/);
assert.match(nonBrowserSummary, /postgresql: private TCP service; runtime and client access unverified/);
assert.equal(nonBrowserSummary.includes(privateReason), false, "Private endpoints and raw reasons are never printed");
assert.equal(nonBrowserSummary.includes("crowdsec: prepared"), false);
assert.equal(nonBrowserSummary.includes("postgresql: app link"), false);
for (const category of ["pendingDaemons", "nonBrowserServices"]) {
  const entry = nonBrowserReport[category as "pendingDaemons" | "nonBrowserServices"][0]!;
  assert.throws(() => dashboardRecap({ ...nonBrowserReport, [category]: "invalid" },
    root, "example", nonBrowserSelection), /saved project/);
  assert.throws(() => dashboardRecap({ ...nonBrowserReport, [category]: [] },
    root, "example", nonBrowserSelection), /selected apps/);
  assert.throws(() => dashboardRecap({ ...nonBrowserReport, [category]: [entry, entry] },
    root, "example", nonBrowserSelection), /selected apps/);
  for (const id of ["sonarr", "unsafe\nidentity", "missing"]) {
    assert.throws(() => dashboardRecap({ ...nonBrowserReport, [category]: [{ ...entry, id }] },
      root, "example", nonBrowserSelection), /selected apps/);
  }
}
for (const changed of [
  { state: "prepared" }, { enrollmentStatus: "verified" }, { enrollmentVerified: true },
  { clientAccessVerified: true }, { runtimeVerified: true }, { browserUrl: "https://fiction.example" },
  { integrationKind: "crowdsec" }, { apiKeyFile: "/tmp/fiction-api-key" }, { notebookStatus: "published" },
]) {
  assert.throws(() => dashboardRecap({ ...nonBrowserReport, pendingDaemons: [{ ...daemon, ...changed }] },
    root, "example", nonBrowserSelection), /daemon readback/);
}
for (const changed of [{ state: "running" }, { browserUrl: "https://fiction.example" },
  { integrationKind: "postgresql" }, { notebookStatus: "published" }]) {
  assert.throws(() => dashboardRecap({ ...nonBrowserReport, nonBrowserServices: [{ ...tcpService, ...changed }] },
    root, "example", nonBrowserSelection), /TCP-service readback/);
}
const blockedService = { ...report.services[0], id: "frigate", integrationKind: "frigate",
  nativeIntegrationPending: true, nativeIntegrationReason: "native-auth-contract-unsupported",
  nativeIntegrationRequirement: "Review a separately authorized native API authentication contract.",
  integrationStructureVerified: false, widgetStructureVerified: false, widgets: [] };
const pendingNative = { id: "frigate", integrationKind: "frigate", reasonCode: blockedService.nativeIntegrationReason,
  requirement: blockedService.nativeIntegrationRequirement };
const blockedReport = { ...report, status: "needs-attachment", services: [...report.services, blockedService],
  pendingNativeIntegrations: [pendingNative], functional: passing };
const blockedSelection = ["frigate", "restic", "sonarr"];
const blockedSummary = dashboardRecap(blockedReport, root, "example", blockedSelection);
assert.match(blockedSummary, /frigate: app link present; native integration pending; integration and widgets unverified/);
assert.match(blockedSummary, /Review a separately authorized native API authentication contract/);
assert.match(blockedSummary, /Some live dashboard checks remain unverified/);
assert.equal(blockedSummary.includes("frigate: app link present; no native integration"), false);
assert.equal(blockedSummary.includes("frigate: app link present; integration configured"), false);
assert.equal(blockedSummary.includes("widget data checks passed"), false);
assert.match(dashboardRecap({ ...blockedReport, status: "attached-with-native-pending" }, root, "example", blockedSelection),
  /native integration pending/);
assert.throws(() => dashboardRecap({ ...blockedReport, status: "attached" }, root, "example", blockedSelection), /status is inconsistent/);
assert.throws(() => dashboardRecap({ ...report, status: "attached-with-native-pending" }, root, "example", ["restic", "sonarr"]), /status is inconsistent/);
for (const changed of [
  { tileOnly: true }, { nativeIntegrationPending: false }, { nativeIntegrationReason: "different" },
  { nativeIntegrationRequirement: "different" }, { integrationStructureVerified: true },
  { widgetStructureVerified: true }, { widgets: [{ kind: "camera", present: true }] },
]) {
  assert.throws(() => dashboardRecap({ ...blockedReport, services: [...report.services, { ...blockedService, ...changed }] },
    root, "example", blockedSelection), /inconsistent verification claims/);
}
for (const changed of [{ id: "missing" }, { reasonCode: "unknown" }, { requirement: "unsafe\ntext" },
  { requirement: "<script>" }, { requirement: "x".repeat(401) }]) {
  assert.throws(() => dashboardRecap({ ...blockedReport, pendingNativeIntegrations: [{ ...pendingNative, ...changed }] },
    root, "example", blockedSelection), /pending native integration readback/);
}
assert.throws(() => dashboardRecap({ ...blockedReport, pendingNativeIntegrations: [pendingNative, pendingNative] },
  root, "example", blockedSelection), /pending native integration readback/);
assert.throws(() => dashboardRecap({ ...blockedReport, pendingNativeIntegrations: [] },
  root, "example", blockedSelection), /inconsistent verification claims/);
assert.throws(() => dashboardRecap({ ...blockedReport, functional: [...passing,
  { ...passing[0], serviceId: "frigate" }] }, root, "example", blockedSelection), /selected services/);
console.log("PASS dashboard recap: exact identities, connectors/daemons/TCP services, native integrations and honest verification limits");
