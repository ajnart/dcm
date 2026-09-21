#!/usr/bin/env bun
import assert from "node:assert/strict";
import { PROCEDURES, proveHomarrWidgets, validateWidgetProof, widgetProofEval } from "./prove-homarr-widgets.ts";

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
console.log("PASS Homarr generated-widget proof contract, read-only eval, redaction and rejection checks");
