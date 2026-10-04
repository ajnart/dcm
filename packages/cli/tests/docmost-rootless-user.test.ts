#!/usr/bin/env bun

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docmostCommand } from "../src/docmost.ts";

async function captureOutput(action: () => Promise<void>): Promise<string> {
  const priorWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === "string") output += chunk;
    else output += Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
    return output;
  } finally {
    process.stdout.write = priorWrite;
  }
}

const root = await mkdtemp(join(tmpdir(), "selfhost-docmost-rootless-"));
try {
  const id = "docmost-rootless";
  const digest = "a".repeat(64);
  const inputPath = join(root, "docmost-input.json");
  const accountPath = join(root, "docmost-account.json");
  const input = {
    schemaVersion: 1,
    project: {
      dockerContext: "rootless",
      id,
      owner: id,
      root,
      directory: join(root, id),
      ownership: "new",
    },
    observed: {
      checkedAt: "2026-09-25T10:00:00Z",
      project: null,
      ports: [],
      paths: [],
      networks: [],
    },
    images: {
      docmost: `docker.io/docmost/docmost:0.96.0@sha256:${digest}`,
      postgres: `docker.io/library/postgres:18.6@sha256:${digest}`,
      redis: `docker.io/library/redis:8.10.2@sha256:${digest}`,
    },
    hostIp: "127.0.0.1",
    publishedPort: 3000,
  };
  const account = { schemaVersion: 1, username: "admin", email: "admin@example.com", name: "Admin" };
  await writeFile(inputPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
  await writeFile(accountPath, `${JSON.stringify(account)}\n`, { mode: 0o600 });
  await chmod(accountPath, 0o600);

  const output = await captureOutput(() => docmostCommand([
    "plan",
    "--project-root", root,
    "--input", inputPath,
    "--run-id", "rootless-fixture",
    "--account-file", accountPath,
  ]));
  const plan = JSON.parse(output);
  assert.match(plan.approval, /^APPLY:docmost-rootless:[0-9a-f]{64}$/);
  assert.equal(plan.compose.status, "pass");
  assert.equal(plan.compose.claims.services.length, 3);
  for (const service of plan.compose.claims.services) {
    assert.equal(service.user, "0:0");
    assert.deepEqual(service.rootlessUserEvidence, {
      officialUrl: "https://docs.docker.com/engine/security/rootless/",
      reason: "host-user-mapped-container-root",
    });
  }
  const postgresWrapper = plan.compose.claims.paths.find((path: { service: string; target: string }) =>
    path.service === "database" && path.target === "/opt/selfhost/postgres-rootless-start.sh");
  assert.equal(postgresWrapper.readOnly, true);
  assert.equal(postgresWrapper.ownership, "new");
  assert.match(plan.limits.join("\n"), /rootless context runs container UID\/GID 0/);
  process.stdout.write("PASS Docmost plans container root only for the evidenced rootless context\n");
} finally {
  await rm(root, { recursive: true });
}
