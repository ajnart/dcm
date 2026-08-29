#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  appMatchesUpdate,
  updateApp,
} from "./homarr-finalize.mjs";

const update = Object.freeze({
  id: "onboarding_app_sonarr",
  name: "Sonarr",
  description: null,
  iconUrl: "https://cdn.example.test/sonarr.svg",
  href: "http://127.0.0.1:11001",
  pingUrl: "http://sonarr:8989",
});

function appResult(apps) {
  return { structuredContent: { apps } };
}

function clientFor(responses) {
  const calls = [];
  return {
    calls,
    async callTool(name, args = {}) {
      calls.push({ args, name });
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
  };
}

async function assertOriginalFailure(client, expectedError) {
  await assert.rejects(
    updateApp(client, update),
    (error) => {
      assert.equal(error, expectedError);
      return true;
    },
  );
}

async function runChecks() {
  const directClient = clientFor([{}]);
  await updateApp(directClient, update);
  assert.deepEqual(directClient.calls, [
    { args: update, name: "app_update" },
  ]);

  const committedError = new Error("fixture mutation response failed");
  const committedClient = clientFor([
    committedError,
    appResult([{ ...update }]),
  ]);
  await updateApp(committedClient, update);
  assert.deepEqual(committedClient.calls, [
    { args: update, name: "app_update" },
    { args: {}, name: "app_all" },
  ]);
  assert.equal(appMatchesUpdate({ ...update }, update), true);

  const staleError = new Error("fixture stale mutation response failed");
  const staleClient = clientFor([
    staleError,
    appResult([
      { ...update, id: "onboarding_app_other" },
      { ...update, href: "http://127.0.0.1:10000" },
    ]),
  ]);
  await assertOriginalFailure(staleClient, staleError);

  const stalePingError = new Error("fixture stale ping mutation response failed");
  const stalePingClient = clientFor([
    stalePingError,
    appResult([{ ...update, pingUrl: "http://sonarr:9999" }]),
  ]);
  await assertOriginalFailure(stalePingClient, stalePingError);

  const fieldMismatches = [
    ["name", "Wrong Sonarr"],
    ["description", "Wrong description"],
    ["iconUrl", "https://cdn.example.test/wrong.svg"],
  ];
  for (const [field, value] of fieldMismatches) {
    const mismatchError = new Error("fixture writable field mismatch");
    const mismatchClient = clientFor([
      mismatchError,
      appResult([{ ...update, [field]: value }]),
    ]);
    await assertOriginalFailure(mismatchClient, mismatchError);
    assert.equal(appMatchesUpdate({ ...update, [field]: value }, update), false);
  }

  const readError = new Error("fixture read failed");
  const unreadableUpdateError = new Error("fixture mutation transport failed");
  const unreadableClient = clientFor([unreadableUpdateError, readError]);
  await assertOriginalFailure(unreadableClient, unreadableUpdateError);

  process.stdout.write("PASS Homarr update reconciliation checks\n");
}

runChecks().catch(() => {
  process.stdout.write("FAIL Homarr update reconciliation checks\n");
  process.exitCode = 1;
});
