#!/usr/bin/env bun

import assert from "node:assert/strict";

import { runVerificationRows, verifyProwlarrIndexers } from "./verify-core.ts";

const privateIndexer = { id: 7, enable: true, privacy: "private" };
let tested = 0;
await verifyProwlarrIndexers([privateIndexer], [], async (indexer) => {
  assert.equal(indexer, privateIndexer);
  tested += 1;
  return true;
}, { now: 1_000, wait: async () => {} });
assert.equal(tested, 1);

await assert.rejects(
  verifyProwlarrIndexers([{ id: 8, enable: false, privacy: "private" }], [], async () => true),
  /no enabled indexer/,
);
await assert.rejects(
  verifyProwlarrIndexers([], [], async () => true),
  /no enabled indexer/,
);

const future = new Date(2_000).toISOString();
await assert.rejects(
  verifyProwlarrIndexers(
    [{ id: 9, enable: true, privacy: "private" }],
    [{ indexerId: 9, disabledTill: future }],
    async () => true,
    { now: 1_000, wait: async () => {} },
  ),
  /no available enabled indexer/,
);

await assert.rejects(
  verifyProwlarrIndexers([privateIndexer], [], async () => false, {
    now: 1_000,
    wait: async () => {},
  }),
  /enabled indexer test failed/,
);

const pendingOutput: string[] = [];
const pendingPassed = await runVerificationRows([
  { label: "Prowlarr selected indexer", pending: true },
  { label: "Seerr links", verify: async () => {} },
], (line: string) => pendingOutput.push(line));
assert.equal(pendingPassed, true);
assert.deepEqual(pendingOutput, ["PENDING Prowlarr selected indexer", "PASS Seerr links"]);

const failureOutput: string[] = [];
const unrelatedFailurePassed = await runVerificationRows([
  { label: "Prowlarr selected indexer", pending: true },
  { label: "Seerr links", verify: async () => { throw new Error("Seerr unavailable"); } },
], (line: string) => failureOutput.push(line));
assert.equal(unrelatedFailurePassed, false);
assert.deepEqual(failureOutput, ["PENDING Prowlarr selected indexer", "FAIL Seerr links: Seerr unavailable"]);

process.stdout.write("PASS Prowlarr private indexer verification\n");
