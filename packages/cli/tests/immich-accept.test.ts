#!/usr/bin/env bun

import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHouseholdCredentials } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-credentials.ts";
import { immichAcceptCommand, immichHomarrKeyCommand } from "../src/immich-accept.ts";

const root = await mkdtemp(join(tmpdir(), "immich-accept-"));
try {
  await chmod(root, 0o700);
  await mkdir(join(root, ".selfhost", "inputs"), { recursive: true, mode: 0o700 });
  await chmod(join(root, ".selfhost"), 0o700);
  await writeFile(join(root, ".selfhost", ".gitignore"), "*\n", { mode: 0o600 });
  const directory = join(root, "immich");
  const inputFile = join(root, ".selfhost", "inputs", "immich.json");
  const accountFile = join(root, ".selfhost", "inputs", "account.json");
  const acceptanceFile = join(root, ".selfhost", "inputs", "accepted.json");
  const keyFile = join(root, ".selfhost", "inputs", "immich-homarr-key");
  const images = {
    server: "ghcr.io/immich-app/immich-server:v3.2.2@sha256:6b0eaf8cfea6d4d6f86a45dfd0c9e3b068ed4493d8b7fa1efeca4cc87792fbe8",
    machineLearning: "ghcr.io/immich-app/immich-machine-learning:v3.2.2@sha256:390453a571ca73b563cc3d9a12a37a4d71217b12608de72f26884f5e2ebc4896",
    redis: "docker.io/valkey/valkey:9@sha256:67878c70fc179bb928b1a9b510860aff1c475ff245e91d98d4b2133326bf8e3e",
    database: "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:b1d33572a9a0634aa6d344077467ad32847812a37fa3859f702952cba22a2f55",
  };
  const input = {
    schemaVersion: 1, platform: "linux/amd64",
    project: { dockerContext: "default", id: "immich", owner: "immich", root, directory, ownership: "verified-existing" },
    observed: { checkedAt: "2026-09-25T00:00:00.000Z", project: null, ports: [], paths: [], networks: [] },
    network: { id: "private", name: "immich-private", internal: false, ownership: "verified-existing" },
    hostIp: "127.0.0.1", publishedPort: 2283, allowSetup: false, images,
    storage: {
      uploads: { path: join(directory, "uploads"), owner: "immich", ownership: "verified-existing" },
      modelCache: { path: join(directory, "model-cache"), owner: "immich", ownership: "verified-existing" },
      database: { path: join(directory, "database"), owner: "immich", ownership: "verified-existing", localFilesystem: true },
    },
    databaseSecret: { ref: "local/immich/database-password", filePath: join(directory, "secrets", "immich-database-password") },
  };
  const account = { schemaVersion: 1, email: "owner@example.com", name: "Owner", username: "owner" };
  await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
  await writeFile(accountFile, JSON.stringify(account), { mode: 0o600 });
  createHouseholdCredentials({ projectRoot: root, runId: "run", username: account.username, email: account.email, services: ["immich"] });

  let trashed = false;
  let image: Buffer | null = null;
  const assetId = "123e4567-e89b-42d3-a456-426614174000";
  const calls: string[] = [];
  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(url)).pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/auth/login") return Response.json({ isAdmin: true, userEmail: account.email, accessToken: "private-token" }, { status: 201 });
    if (path === "/api/api-keys/me") {
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "private-immich-key");
      return Response.json({ id: assetId, name: "Homarr", permissions: [
        "album.statistics", "album.read", "album.create", "user.read", "user.update", "asset.read", "asset.view",
        "asset.download", "asset.statistics", "server.statistics", "server.about",
      ] });
    }
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer private-token");
    if (path === "/api/server/version") return Response.json({ major: 3, minor: 2, patch: 2 });
    if (path === "/api/server/config") return Response.json({ isInitialized: true });
    if (path === "/api/api-keys" && init?.method !== "POST") return Response.json([]);
    if (path === "/api/api-keys" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.name, "Homarr");
      assert.equal(body.permissions.length, 11);
      return Response.json({ id: assetId, name: "Homarr", permissions: body.permissions, secret: "private-immich-key" }, { status: 201 });
    }
    if (path === "/api/assets" && init?.method === "POST") {
      assert.ok(init.body instanceof FormData);
      const uploaded = init.body.get("assetData");
      assert.ok(uploaded instanceof Blob);
      image = Buffer.from(await uploaded.arrayBuffer());
      assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      return Response.json({ id: assetId, status: "created" }, { status: 201 });
    }
    if (path === `/api/assets/${assetId}/original`) return new Response(image);
    if (path === "/api/assets" && init?.method === "DELETE") {
      assert.deepEqual(JSON.parse(String(init.body)), { ids: [assetId] });
      trashed = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fixture path: ${path}`);
  };
  const args = ["--project-root", root, "--input", inputFile, "--account-file", accountFile,
    "--run-id", "run", "--integration-url", "http://immich-server:2283",
    "--acceptance-file", acceptanceFile];
  const previous = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try { await immichAcceptCommand(args, { fetch: mockFetch as typeof fetch, now: () => new Date("2026-09-25T00:00:00Z"),
    closedSetup: () => true }); }
  finally { process.stdout.write = previous; }
  const accepted = JSON.parse(await readFile(acceptanceFile, "utf8"));
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.integrationUrl, "http://immich-server:2283/");
  assert.deepEqual(accepted.checks.map((check: { id: string }) => check.id),
    ["admin-login", "release-version", "test-image-upload-retrieval"]);
  assert.equal((await lstat(acceptanceFile)).mode & 0o777, 0o600);
  assert.equal(trashed, true);
  assert.equal(calls.filter((call) => call === `GET /api/assets/${assetId}/original`).length, 1);
  assert.ok(!output.includes("private-token"));
  await assert.rejects(immichAcceptCommand(args, { fetch: mockFetch as typeof fetch, closedSetup: () => true }), /Input|output|exists/i);

  const keyArgs = ["--project-root", root, "--input", inputFile, "--account-file", accountFile, "--run-id", "run",
    "--acceptance-file", acceptanceFile, "--key-file", keyFile];
  output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => { output += String(chunk); return true; }) as typeof process.stdout.write;
  try {
    await immichHomarrKeyCommand(["plan", ...keyArgs]);
    const approval = JSON.parse(output).approval;
    output = "";
    await immichHomarrKeyCommand(["create", ...keyArgs, "--approve", approval], { fetch: mockFetch as typeof fetch });
  } finally { process.stdout.write = previous; }
  assert.equal(await readFile(keyFile, "utf8"), "private-immich-key\n");
  assert.equal((await lstat(keyFile)).mode & 0o777, 0o600);
  assert.ok(!output.includes("private-immich-key"));
} finally {
  await rm(root, { recursive: true, force: true });
}
