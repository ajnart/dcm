#!/usr/bin/env bun

import assert from "node:assert/strict";

import { verifyProwlarrIndexers } from "./verify-core.ts";

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

process.stdout.write("PASS Prowlarr private indexer verification\n");
