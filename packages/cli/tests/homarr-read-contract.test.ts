import assert from "node:assert/strict";
import { decodeHomarrReadVerification, homarrReadShapeMatches, homarrVerificationSourceCommit } from "../src/lib/homarr-read-contract.ts";
import { homarrCatalogReadProcedures, homarrStackMapping } from "../src/lib/homarr-stack-mapping.ts";
import { verifyHomarrService } from "../src/lib/homarr-live-verification.ts";

const descriptor = { sourceCommit: homarrVerificationSourceCommit, widgets: [{ kind: "sample",
  procedure: "widget.sample.getData", inputMode: "many", field: "data", shape: "array" }] };
assert.deepEqual(decodeHomarrReadVerification(descriptor, ["sample"]), descriptor);
for (const patch of [{ procedure: "widget.sample.delete" }, { procedure: "integration.request" },
  { input: { integrationId: "override" } }, { inputBindings: { integrationIds: "immichAlbumId" } },
  { input: { constructor: "override" } }, { input: { endpoint: "https://example.com" } },
  { inputBindings: { albumId: "runtimePath" } }, { dateBindings: { day: "day" } },
  { shape: { type: "script", value: "eval" } }, { shape: { type: "binding", value: "credential" } },
  { shape: { type: "array", items: "object", minLength: 2, maxLength: 1 } }]) {
  assert.throws(() => decodeHomarrReadVerification({ ...descriptor, widgets: [{ ...descriptor.widgets[0], ...patch }] }, ["sample"]));
}
assert.throws(() => decodeHomarrReadVerification({ ...descriptor, sourceCommit: "unverified" }, ["sample"]));
assert.equal(homarrReadShapeMatches({ count: 0, entries: [] }, { type: "object", fields: {
  count: "number", entries: { type: "array", items: "object", maxLength: 0 } } }), true);
assert.equal(homarrReadShapeMatches({ count: NaN }, { type: "object", fields: { count: "number" } }), false);
assert.equal(homarrReadShapeMatches([{}], { type: "array", items: "object", maxLength: 0 }), false);
assert.equal(homarrReadShapeMatches("navidrome", { type: "literal", value: "audiobookshelf" }), false);
assert.equal(homarrReadShapeMatches("selected", { type: "binding", value: "integrationId" }), false);
assert.equal(homarrReadShapeMatches("other", { type: "binding", value: "integrationId" }, { integrationId: "selected" }), false);
assert.equal(homarrReadShapeMatches("selected", { type: "binding", value: "integrationId" }, { integrationId: "selected" }), true);
const statsShape = homarrStackMapping("seerr")!.verification!.widgets.find((widget) => widget.kind === "mediaRequests-requestStats")!.shape;
const stats = { stats: [{ total: 0, movie: 0, tv: 0, pending: 0, approved: 0, declined: 0, processing: 0, available: 0 }],
  users: [], integrations: [{ id: "selected", name: "Seerr", kind: "seerr" }], failedIntegrations: [] };
assert.equal(homarrReadShapeMatches(stats, statsShape, { integrationId: "selected" }), true);
assert.equal(homarrReadShapeMatches({ ...stats, integrations: [{ ...stats.integrations[0], id: "other" }] }, statsShape, { integrationId: "selected" }), false);
assert.equal(homarrReadShapeMatches({ stats: [], users: [], integrations: [], failedIntegrations: [] }, statsShape, { integrationId: "selected" }), false);
const procedures = homarrCatalogReadProcedures();
for (const procedure of ["widget.dnsHole.summary", "widget.beszel.getSystems", "widget.beszel.getAlerts",
  "widget.immich.getServerStats", "widget.paperlessNgx.getStats", "widget.uptimeKuma.getDashboard",
  "widget.notifications.getNotifications", "widget.calendar.findAllEvents", "widget.mediaOrganizer.getData"]) {
  assert.ok(procedures.includes(procedure), `Existing and new app-owned read procedure remains available: ${procedure}`);
}
assert.equal(new Set(procedures).size, procedures.length);
assert.equal(homarrStackMapping("home-assistant")?.verification?.widgets.some((widget) => widget.kind === "smartHome-executeAutomation"), false);

const configuration = { id: "sonarr", appName: "Sonarr", boardName: "personal",
  browserUrl: "http://127.0.0.1:8989", serverUrl: "http://sonarr:8989/" };
const integration = { id: "integration-sonarr", name: "Auto-Stack: sonarr", kind: "sonarr", url: configuration.serverUrl,
  permissions: { hasFullAccess: true, hasUseAccess: true } };
const app = { id: "app-sonarr", name: "Sonarr", href: configuration.browserUrl, pingUrl: configuration.serverUrl };
const board = { id: "board", name: "personal", isPublic: false, sections: [], items: [
  { id: "tile", kind: "app", options: { appId: app.id } },
  ...["calendar", "mediaMissing"].map((kind) => ({ id: kind, kind, options: {}, integrationIds: [integration.id] })),
] };
let wrongIdentity = false;
let failedProvider = false;
const context = { sourceCommit: homarrVerificationSourceCommit, now: new Date("2026-12-01T00:00:00Z"),
  async query(procedure: string, input?: unknown) {
    if (procedure === "board.getAllBoards") return [{ id: board.id, name: board.name, isPublic: false }];
    if (procedure === "board.getBoardByName") return board;
    if (procedure === "app.all") return [app];
    if (procedure === "integration.all") return [integration];
    if (procedure === "integration.byId") return { ...integration, app, secrets: [] };
    if (procedure === "widget.app.ping") return { url: configuration.serverUrl, statusCode: 200 };
    if (procedure === "widget.calendar.findAllEvents") {
      assert.deepEqual(input, { integrationIds: [integration.id], year: 2026, month: 12,
        releaseType: ["inCinemas", "digitalRelease", "physicalRelease"], showUnmonitored: true });
      return [{ integration: { id: integration.id }, events: [], error: null }];
    }
    if (procedure === "widget.mediaOrganizer.getData") {
      assert.deepEqual(input, { integrationIds: [integration.id], pageSize: 10 });
      let integrationId = integration.id;
      if (wrongIdentity) integrationId = "other";
      return [{ integrationId, missing: [], missingCount: 0, queued: [], queuedCount: 0,
        error: failedProvider ? "SYNTHETIC_PRIVATE_ERROR" : null }];
    }
    throw new Error("Unexpected read-only procedure");
  } };
let result = await verifyHomarrService(configuration, context);
assert.ok(result.widgets.every((widget) => widget.data.status === "pass"));
wrongIdentity = true;
result = await verifyHomarrService(configuration, context);
assert.equal(result.widgets.find((widget) => widget.kind === "mediaMissing")?.data.status, "fail");
wrongIdentity = false; failedProvider = true;
result = await verifyHomarrService(configuration, context);
assert.equal(result.widgets.find((widget) => widget.kind === "mediaMissing")?.data.status, "fail");
assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE_ERROR"), false);
console.log("Bounded catalog-owned read contracts and generic query execution passed (synthetic fixtures only)");
