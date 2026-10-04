#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { validateWithComposeOwner } from "./household-plan";

type Storage = { path: string; owner: string; ownership: "new" | "verified-existing" };
type Input = {
  schemaVersion: 1;
  platform: "linux/amd64";
  project: Record<string, unknown>;
  observed: Record<string, unknown>;
  network: { id: string; name: string; internal: boolean; ownership?: "new" | "verified-existing"; subnet?: string };
  integrationNetwork?: { id: string; name: string; owner: string; internal?: boolean };
  hostIp: string;
  publishedPort: number;
  allowSetup: boolean;
  images: Record<"server" | "machineLearning" | "redis" | "database", string>;
  storage: { uploads: Storage; modelCache: Storage; database: Storage & { localFilesystem: true } };
  databaseSecret: { ref: string; filePath: string };
};

const RELEASE = {
  server: "ghcr.io/immich-app/immich-server:v3.2.2@sha256:6b0eaf8cfea6d4d6f86a45dfd0c9e3b068ed4493d8b7fa1efeca4cc87792fbe8",
  machineLearning: "ghcr.io/immich-app/immich-machine-learning:v3.2.2@sha256:390453a571ca73b563cc3d9a12a37a4d71217b12608de72f26884f5e2ebc4896",
  redis: "docker.io/valkey/valkey:9@sha256:67878c70fc179bb928b1a9b510860aff1c475ff245e91d98d4b2133326bf8e3e",
  database: "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:b1d33572a9a0634aa6d344077467ad32847812a37fa3859f702952cba22a2f55"
} as const;

function fail(message: string): never {
  throw new Error(message);
}

function object(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value as Record<string, any>;
}

function exact(value: Record<string, any>, required: string[], optional: string[], name: string): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    fail(`${name} must contain exactly the documented fields`);
  }
}

function storage(value: unknown, name: string, local = false): Storage {
  const record = object(value, name);
  exact(record, ["path", "owner", "ownership", ...(local ? ["localFilesystem"] : [])], [], name);
  if (local && record.localFilesystem !== true) {
    fail(`${name}.localFilesystem must be true`);
  }
  return record as Storage;
}

function mount(source: Storage, target: string) {
  return { source: source.path, target, readOnly: false, shared: false, owner: source.owner, ownership: source.ownership };
}

function healthcheck(test: string[], intervalSeconds: number, timeoutSeconds: number, startPeriodSeconds: number) {
  return { test, intervalSeconds, timeoutSeconds, startPeriodSeconds, retries: 3 };
}

function service(id: string, image: string, networks: string[], officialUrl: string) {
  return {
    id,
    image,
    restart: "always",
    readOnly: false,
    user: "image-default",
    imageUserEvidence: { officialUrl, reason: "official-image-runtime-contract" },
    environment: [] as { name: string; value: string }[],
    ports: [] as Record<string, unknown>[],
    mounts: [] as ReturnType<typeof mount>[],
    networks,
    secretRefs: [] as Record<string, unknown>[],
    healthcheck: healthcheck(["CMD", "true"], 30, 10, 0)
  };
}

export function buildImmichManifest(raw: unknown) {
  const input = object(raw, "input") as Input;
  exact(input, ["schemaVersion", "platform", "project", "observed", "network", "hostIp", "publishedPort", "allowSetup", "images", "storage", "databaseSecret"], ["integrationNetwork"], "input");
  if (input.schemaVersion !== 1 || input.platform !== "linux/amd64") {
    fail("this recorded Immich release evidence requires schemaVersion 1 and linux/amd64");
  }
  if (typeof input.allowSetup !== "boolean") {
    fail("allowSetup must be boolean");
  }
  const project = object(input.project, "project");
  const network = object(input.network, "network");
  exact(network, ["id", "name", "internal"], ["ownership", "subnet"], "network");
  const networkOwnership = network.ownership ?? "new";
  if (networkOwnership !== "new" && networkOwnership !== "verified-existing") {
    fail("network.ownership must be new or verified-existing");
  }
  if (Object.hasOwn(network, "subnet") && typeof network.subnet !== "string") {
    fail("network.subnet must be a string when supplied");
  }
  const images = object(input.images, "images");
  exact(images, Object.keys(RELEASE), [], "images");
  for (const key of Object.keys(RELEASE) as (keyof typeof RELEASE)[]) {
    if (images[key] !== RELEASE[key]) {
      fail(`images.${key} must match the recorded v3.2.2 linux/amd64 digest`);
    }
  }
  const stores = object(input.storage, "storage");
  exact(stores, ["uploads", "modelCache", "database"], [], "storage");
  const uploads = storage(stores.uploads, "storage.uploads");
  const modelCache = storage(stores.modelCache, "storage.modelCache");
  const databaseStorage = storage(stores.database, "storage.database", true);
  const databaseSecret = object(input.databaseSecret, "databaseSecret");
  exact(databaseSecret, ["ref", "filePath"], [], "databaseSecret");

  const primaryNetwork: Record<string, unknown> = {
    id: network.id,
    name: network.name,
    driver: "bridge",
    internal: network.internal,
    owner: project.owner,
    ownership: networkOwnership
  };
  if (networkOwnership === "new" && network.subnet !== undefined) {
    primaryNetwork.subnet = network.subnet;
  }
  const networks = [primaryNetwork];
  const internalNetworks = [network.id];
  const serverNetworks = [network.id];
  if (input.integrationNetwork) {
    const integration = object(input.integrationNetwork, "integrationNetwork");
    exact(integration, ["id", "name", "owner"], ["internal"], "integrationNetwork");
    if (integration.internal !== undefined && typeof integration.internal !== "boolean") {
      fail("integrationNetwork.internal must be a boolean when supplied");
    }
    networks.push({ id: integration.id, name: integration.name, driver: "bridge",
      internal: integration.internal ?? false, owner: integration.owner, ownership: "verified-existing" });
    serverNetworks.push(integration.id);
  }

  const secret = { name: "database-password", ref: databaseSecret.ref, target: "db_password", filePath: databaseSecret.filePath };
  const server = service("immich-server", images.server, serverNetworks, "https://github.com/immich-app/immich/releases/tag/v3.2.2");
  server.environment = [
    { name: "DB_DATABASE_NAME", value: "immich" },
    { name: "DB_HOSTNAME", value: "database" },
    { name: "DB_PASSWORD_FILE", value: "/run/secrets/db_password" },
    { name: "DB_USERNAME", value: "postgres" },
    { name: "IMMICH_ALLOW_SETUP", value: input.allowSetup ? "true" : "false" },
    { name: "IMMICH_MACHINE_LEARNING_URL", value: "http://immich-machine-learning:3003" },
    { name: "REDIS_HOSTNAME", value: "redis" }
  ];
  server.ports = [{ hostIp: input.hostIp, published: input.publishedPort, target: 2283, protocol: "tcp", purpose: "application", publicApproved: false }];
  server.mounts = [mount(uploads, "/data")];
  server.secretRefs = [secret];
  server.healthcheck = healthcheck(["CMD", "immich-healthcheck"], 30, 30, 0);
  Object.assign(server, { dependsOn: [{ service: "database", condition: "service_started" }, { service: "redis", condition: "service_started" }] });

  const machineLearning = service("immich-machine-learning", images.machineLearning, internalNetworks, "https://github.com/immich-app/immich/blob/v3.2.2/machine-learning/Dockerfile");
  machineLearning.mounts = [mount(modelCache, "/cache")];
  machineLearning.healthcheck = healthcheck(["CMD", "python3", "healthcheck.py"], 30, 30, 0);

  const redis = service("redis", images.redis, internalNetworks, "https://github.com/immich-app/immich/releases/download/v3.2.2/docker-compose.yml");
  redis.healthcheck = healthcheck(["CMD", "redis-cli", "ping"], 30, 30, 0);

  const database = service("database", images.database, internalNetworks, "https://github.com/immich-app/immich/releases/download/v3.2.2/docker-compose.yml");
  database.environment = [
    { name: "POSTGRES_DB", value: "immich" },
    { name: "POSTGRES_INITDB_ARGS", value: "--data-checksums" },
    { name: "POSTGRES_PASSWORD_FILE", value: "/run/secrets/db_password" },
    { name: "POSTGRES_USER", value: "postgres" }
  ];
  database.mounts = [mount(databaseStorage, "/var/lib/postgresql/data")];
  database.secretRefs = [secret];
  database.healthcheck = healthcheck(["CMD", "/usr/local/bin/healthcheck.sh"], 300, 30, 300);
  Object.assign(database, { shmSizeBytes: 128 * 1024 * 1024 });

  return { schemaVersion: 1, project: input.project, services: [database, machineLearning, server, redis], networks, observed: input.observed };
}

function main(): void {
  const argv = Bun.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--input" || !path.isAbsolute(argv[1])) {
    fail("usage: immich-plan.ts --input ABSOLUTE_JSON_FILE");
  }
  const manifest = buildImmichManifest(JSON.parse(fs.readFileSync(argv[1], "utf8")));
  validateWithComposeOwner(manifest);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch {
    process.stderr.write("immich-plan.ts: manifest generation failed\n");
    process.exit(2);
  }
}
