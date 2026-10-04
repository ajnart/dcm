#!/usr/bin/env bun
import assert from "node:assert/strict";
import { PROCEDURES, proveHomarrWidgets, validateWidgetProof, widgetProofEval } from "./prove-homarr-widgets.ts";
import { appTilesAreLinked, widgetProofFailureReason, widgetResultIsHealthy } from "./prove-homarr-widgets-api.ts";
import { SERVICE_DESCRIPTIONS } from "./homarr-finalize.ts";

const rows = PROCEDURES.map((procedure) => ({
  procedure,
  method: "GET",
  path: `/api/trpc/${procedure}`,
  status: 200,
  classification: "result",
  ...(procedure === "widget.mediaRelease.getMediaReleases" ? { releases: 0, failedIntegrations: 0 } : {}),
}));
const proof = { board: "MyHomelab", rows };
assert.equal(validateWidgetProof(structuredClone(proof), "MyHomelab").rows.length, 7);
const evalSource = widgetProofEval("http://127.0.0.1:20020", "MyHomelab");
assert.doesNotThrow(() => new Function(evalSource));
assert.match(evalSource, /method:"GET"/);
assert.doesNotMatch(evalSource, /method:"(?:POST|PUT|PATCH|DELETE)"|ApiKey|password|secret/i);

const session = { manifest: { HOMARR_PORT: "20020", AGENT_BROWSER_SESSION: "auto-stack-fixture" } };
const observed = proveHomarrWidgets(session, "MyHomelab", (command, args, options) => {
  assert.equal(command, "agent-browser");
  assert.deepEqual(args, ["--session", "auto-stack-fixture", "eval", "--stdin"]);
  assert.equal(options.input, evalSource);
  assert.equal(options.timeout, 30_000);
  return { status: 0, stdout: JSON.stringify(proof), stderr: "" };
});
assert.equal(observed.board, "MyHomelab");

for (const mutator of [
  (value) => { value.rows.pop(); },
  (value) => { value.rows[0].status = 500; },
  (value) => { value.rows[1].classification = "error"; },
  (value) => { value.rows.at(-1).failedIntegrations = 1; },
]) {
  const invalid = structuredClone(proof); mutator(invalid);
  assert.throws(() => validateWidgetProof(invalid, "MyHomelab"));
}
assert.throws(() => widgetProofEval("http://127.0.0.1:20020", "../escape"));
assert.equal(widgetResultIsHealthy("widget.indexerManager.getIndexersStatus", [{ integrationId: "one", indexers: [] }], ["one"]), true);
assert.equal(widgetResultIsHealthy("widget.indexerManager.getIndexersStatus", [{ integrationId: "one", indexers: [], error: "INTEGRATION_REQUEST_FAILED" }], ["one"]), false);
assert.equal(widgetResultIsHealthy("widget.downloads.getJobsAndStatuses", [{ integrationId: "one", data: null, error: "INTEGRATION_REQUEST_FAILED" }], ["one"]), false);
assert.equal(widgetResultIsHealthy("widget.mediaRequests.getStats", { integrations: [{ id: "one" }], failedIntegrations: [{ integrationId: "one" }] }, ["one"]), false);
const services = ["sonarr", "radarr", "prowlarr", "qbittorrent", "jellyfin", "seerr"];
const access = { services: Object.fromEntries(services.map((service) => [service, { browserUrl: `http://localhost/${service}`, reachableUrl: null, dockerUrl: `http://${service}` }])) };
const board = { items: services.map((service) => ({ kind: "app", options: { appId: service } })) };
const apps = services.map((service) => ({ id: service, name: service, description: SERVICE_DESCRIPTIONS[service], href: `http://localhost/${service}`, pingUrl: `http://${service}` }));
assert.equal(appTilesAreLinked(board, apps, access), true);
assert.equal(appTilesAreLinked({ items: [...board.items, { kind: "app", options: { appId: "homarr-docs" } }] },
  [...apps, { id: "homarr-docs", name: "Homarr Docs" }], access), true);
assert.equal(appTilesAreLinked({ items: [...board.items, board.items[0]] }, apps, access), false);
assert.equal(appTilesAreLinked(board, apps.slice(1), access), false);
assert.equal(appTilesAreLinked(board, apps.map((app) => ({ ...app, pingUrl: "http://wrong" })), access), false);
assert.equal(appTilesAreLinked(board, apps.map((app) => ({ ...app, description: null })), access), false);
assert.equal(widgetProofFailureReason(new Error(`Homarr widget proof failed for ${PROCEDURES[0]}`)),
  `procedure=${PROCEDURES[0]}`);
assert.equal(widgetProofFailureReason(new Error("Homarr media-release proof has failed integrations")),
  "Homarr media-release proof has failed integrations");
assert.equal(widgetProofFailureReason(new Error("secret-key-value")), "unknown");
console.log("PASS Homarr generated-widget proof contract, read-only eval, redaction and rejection checks");
