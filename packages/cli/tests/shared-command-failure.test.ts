import assert from "node:assert/strict";
import { sharedProjectFailure } from "../src/interactive.ts";

const secret = "SYNTHETIC_ERROR_DETAILS_MUST_NOT_APPEAR";
function report(action: string, code: string, partialWritePossible = false) {
  let mutation: boolean | null = false;
  if (partialWritePossible) mutation = null;
  return { schemaVersion: 1, command: `app shared ${action}`, status: "failed", mutation,
    partialWritePossible, error: { code, message: secret }, next: secret };
}
assert.match(sharedProjectFailure(report("remove", "shared-remove-dependency"), "remove")!, /retained app dependency or saved connection history/);
assert.match(sharedProjectFailure(report("remove", "shared-remove-last-app"), "remove")!, /final app/);
assert.match(sharedProjectFailure(report("add", "shared-reinstall-required"), "add")!, /safe reinstallation is not yet supported/);
assert.match(sharedProjectFailure(report("remove", "shared-remove-inspect-required", true), "remove")!, /may be partial/);
assert.match(sharedProjectFailure(report("remove", "shared-remove-dependency", true), "remove")!, /may be partial/,
  "A recognized blocker code must not disguise possible prior writes");
assert.equal(sharedProjectFailure(report("remove", "unknown"), "remove"), null);
assert.equal(sharedProjectFailure(report("remove", "shared-remove-dependency"), "add"), null);
assert.equal(sharedProjectFailure({ ...report("remove", "shared-remove-dependency"), mutation: null }, "remove"), null);
assert.equal(sharedProjectFailure({ ...report("remove", "shared-remove-dependency"), partialWritePossible: true }, "remove"), null);
assert.equal(sharedProjectFailure({ ...report("remove", "shared-remove-dependency"), schemaVersion: 2 }, "remove"), null);
for (const scenario of [report("remove", "shared-remove-dependency"), report("remove", "shared-remove-last-app"),
  report("add", "shared-reinstall-required"), report("remove", "unexpected", true)]) {
  const action = scenario.command.split(" ")[2]!;
  assert.equal(sharedProjectFailure(scenario, action)!.includes(secret), false);
}
console.log("PASS shared command failures: exact action, fixed safe explanations and unknown-outcome handling");
