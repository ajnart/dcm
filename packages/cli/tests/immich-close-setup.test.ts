#!/usr/bin/env bun

import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImmichManifest } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/immich-plan.ts";
import {
  createHouseholdCredentials,
  loadHouseholdCredential,
} from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-credentials.ts";
import { immichCommand } from "../src/immich.ts";
import { createSelfhostComposeOwner } from "../src/lib/selfhost-compose.ts";

async function capture(action: () => Promise<void>): Promise<string> {
  const previous = process.stdout.write;
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
    process.stdout.write = previous;
  }
}

const root = await mkdtemp(join(tmpdir(), "selfhost-immich-close-"));
try {
  await chmod(root, 0o700);
  const privateDirectory = join(root, ".selfhost", "bundles", "home");
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await chmod(join(root, ".selfhost"), 0o700);
  await chmod(join(root, ".selfhost", "bundles"), 0o700);
  await chmod(privateDirectory, 0o700);
  await writeFile(join(root, ".selfhost", ".gitignore"), "*\n", { mode: 0o600 });
  const projectDirectory = join(root, "home-immich");
  const paths = {
    uploads: join(projectDirectory, "data", "uploads"),
    modelCache: join(projectDirectory, "data", "model-cache"),
    database: join(projectDirectory, "data", "database"),
  };
  const inputPath = join(privateDirectory, "immich-input.json");
  const accountPath = join(privateDirectory, "immich-account.json");
  const input = {
    schemaVersion: 1,
    platform: "linux/amd64",
    project: { dockerContext: "default", id: "home-immich", owner: "home-immich", root,
      directory: projectDirectory, ownership: "new" },
    observed: { checkedAt: "2026-09-25T00:00:00.000Z", project: null, ports: [], paths: [],
      networks: [{ name: "autostack-home_default", owner: "external" }] },
    network: { id: "private", name: "home-immich-private", internal: false },
    integrationNetwork: { id: "homarr", name: "autostack-home_default", owner: "external" },
    hostIp: "127.0.0.1",
    publishedPort: 2283,
    allowSetup: true,
    images: {
      server: "ghcr.io/immich-app/immich-server:v3.2.2@sha256:6b0eaf8cfea6d4d6f86a45dfd0c9e3b068ed4493d8b7fa1efeca4cc87792fbe8",
      machineLearning: "ghcr.io/immich-app/immich-machine-learning:v3.2.2@sha256:390453a571ca73b563cc3d9a12a37a4d71217b12608de72f26884f5e2ebc4896",
      redis: "docker.io/valkey/valkey:9@sha256:67878c70fc179bb928b1a9b510860aff1c475ff245e91d98d4b2133326bf8e3e",
      database: "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:b1d33572a9a0634aa6d344077467ad32847812a37fa3859f702952cba22a2f55",
    },
    storage: {
      uploads: { path: paths.uploads, owner: "home-immich", ownership: "new" },
      modelCache: { path: paths.modelCache, owner: "home-immich", ownership: "new" },
      database: { path: paths.database, owner: "home-immich", ownership: "new", localFilesystem: true },
    },
    databaseSecret: { ref: "local/home-immich/database-password",
      filePath: join(projectDirectory, "secrets", "immich-database-password") },
  };
  const account = { schemaVersion: 1, email: "admin@example.com", name: "Home Admin", username: "admin" };
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600 });
  await writeFile(accountPath, `${JSON.stringify(account, null, 2)}\n`, { mode: 0o600 });
  const runId = "home-immich";
  createHouseholdCredentials({ projectRoot: root, runId, username: account.username, email: account.email, services: ["immich"] });
  const credential = loadHouseholdCredential(root, runId, "immich");
  const common = ["--project-root", root, "--input", inputPath, "--run-id", runId, "--account-file", accountPath];
  const initialPlan = JSON.parse(await capture(() => immichCommand(["plan", ...common])));
  assert.match(initialPlan.approvals.closeSetup, /^CLOSE_SETUP:home-immich:[0-9a-f]{64}$/);
  const manifest = buildImmichManifest(input) as Record<string, any>;
  const owner = createSelfhostComposeOwner(manifest);
  const composePlan = await owner.plan();
  await owner.render(composePlan);
  for (const path of Object.values(paths)) await mkdir(path, { recursive: true, mode: 0o700 });

  await assert.rejects(immichCommand(["close-setup", ...common, "--approve", "CLOSE_SETUP:home-immich:wrong"]),
    /approval does not match/);
  assert.equal(JSON.parse(await readFile(inputPath, "utf8")).allowSetup, true);

  let preflightCalled = false;
  let loginCalled = false;
  const services = ["database", "immich-machine-learning", "immich-server", "redis"]
    .map((service, index) => ({ id: `${index + 1}`.repeat(12), service, state: "running", health: "healthy" }));
  const networkNames = new Map(manifest.networks.map((network: Record<string, any>) => [network.id, network.name]));
  const containers = manifest.services.map((service: Record<string, any>) => {
    const status = services.find((entry) => entry.service === service.id);
    assert.ok(status);
    const networks = Object.fromEntries(service.networks.map((id: string) => [networkNames.get(id), {}]));
    const ports: Record<string, unknown> = {};
    if (service.id === "immich-server") {
      ports["2283/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "2283" }];
    }
    return {
      Id: status.id[0].repeat(64),
      Config: { Labels: { "com.docker.compose.project": "home-immich", "com.docker.compose.service": service.id } },
      Mounts: service.mounts.map((mount: Record<string, any>) => ({ Source: mount.source, Destination: mount.target, RW: true })),
      NetworkSettings: { Networks: networks, Ports: ports },
    };
  });
  const networks = manifest.networks.map((network: Record<string, any>) => {
    const labels: Record<string, string> = {};
    if (network.owner === "home-immich") labels["com.docker.compose.project"] = "home-immich";
    return { Name: network.name, Driver: "bridge", Internal: network.internal, Labels: labels };
  });
  const foreignContainers = structuredClone(containers);
  foreignContainers[0].Config.Labels["com.docker.compose.project"] = "foreign-project";
  await assert.rejects(immichCommand(["close-setup", ...common, "--approve", initialPlan.approvals.closeSetup], {
    preflight: async () => {},
    composeStatus: () => services,
    inspectInitialization: async () => true,
    verifyLogin: async () => true,
    dockerJson: (args) => {
      if (args.includes("network")) return networks;
      return foreignContainers;
    },
  }), /not owned by the exact Immich Compose project/);
  assert.equal(JSON.parse(await readFile(inputPath, "utf8")).allowSetup, true);
  const output = await capture(() => immichCommand(["close-setup", ...common, "--approve", initialPlan.approvals.closeSetup], {
    preflight: async () => { preflightCalled = true; },
    composeStatus: () => services,
    inspectInitialization: async () => true,
    verifyLogin: async (_origin, email, password) => {
      loginCalled = email === account.email && password === credential.password;
      return loginCalled;
    },
    dockerJson: (args) => {
      if (args.includes("network")) return networks;
      return containers;
    },
  }));
  assert.equal(preflightCalled, true);
  assert.equal(loginCalled, true);
  assert.equal(output.includes(credential.password), false);
  const result = JSON.parse(output);
  assert.equal(result.status, "ready-for-apply-approval");
  assert.equal(result.dockerMutation, false);
  assert.equal(result.plan.approvals.bootstrap, null);
  assert.equal(result.plan.approvals.closeSetup, null);
  assert.match(result.plan.approvals.apply, /^APPLY:home-immich:[0-9a-f]{64}$/);
  assert.notEqual(result.plan.approvals.apply, initialPlan.approvals.apply);

  const revised = JSON.parse(await readFile(inputPath, "utf8"));
  assert.equal((await lstat(inputPath)).mode & 0o777, 0o600);
  assert.equal(revised.allowSetup, false);
  assert.equal(revised.project.ownership, "verified-existing");
  assert.equal(revised.network.ownership, "verified-existing");
  assert.equal(revised.storage.uploads.ownership, "verified-existing");
  assert.equal(revised.storage.modelCache.ownership, "verified-existing");
  assert.equal(revised.storage.database.ownership, "verified-existing");
  assert.deepEqual(revised.images, input.images);
  assert.deepEqual(revised.databaseSecret, input.databaseSecret);
  assert.deepEqual(revised.observed.project, { id: "home-immich", directory: projectDirectory, owner: "home-immich" });
  assert.equal(revised.observed.paths.length, 3);
  assert.equal(revised.observed.networks.length, 2);
  assert.equal(revised.observed.ports.length, 1);
  console.log("PASS Immich setup closure safely revises only owner input and emits a new non-applied plan");
} finally {
  await rm(root, { recursive: true });
}
