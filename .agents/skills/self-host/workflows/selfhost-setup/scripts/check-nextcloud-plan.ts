#!/usr/bin/env bun

import assert from "node:assert/strict";

import { buildNextcloudManifest, validateWithComposeOwner } from "./nextcloud-plan.ts";

const digest = (character: string) => character.repeat(64);

function input() {
  return {
    schemaVersion: 1,
    project: { dockerContext: "default", id: "nextcloud", owner: "nextcloud", root: "/srv/selfhost-projects", directory: "/srv/selfhost-projects/nextcloud", ownership: "new" },
    observed: { checkedAt: "2026-09-21T03:00:00Z", project: null, ports: [], paths: [], networks: [{ name: "homarr-private", owner: "homarr" }] },
    network: { id: "private", name: "nextcloud-private" },
    integrationNetwork: { id: "homarr", name: "homarr-private", owner: "homarr" },
    images: {
      nextcloud: { pinnedRef: `docker.io/library/nextcloud:35.0.0-apache@sha256:${digest("a")}`, officialUrl: "https://github.com/nextcloud/docker/blob/master/README.md" },
      database: { pinnedRef: `docker.io/library/postgres:17.11-alpine3.24@sha256:${digest("b")}`, officialUrl: "https://hub.docker.com/_/postgres" },
      cache: { pinnedRef: `docker.io/library/redis:8.8.2-alpine@sha256:${digest("c")}`, officialUrl: "https://hub.docker.com/_/redis" }
    },
    storage: {
      html: { path: "/srv/nextcloud/html", owner: "nextcloud", ownership: "new" },
      database: { path: "/srv/nextcloud/database", owner: "nextcloud", ownership: "new", localFilesystem: true }
    },
    secrets: {
      adminPassword: { ref: "local/nextcloud/admin", filePath: "/srv/selfhost-projects/nextcloud/secrets/admin" },
      databasePassword: { ref: "local/nextcloud/database", filePath: "/srv/selfhost-projects/nextcloud/secrets/database" }
    },
    adminUsername: "household-admin",
    hostIp: "127.0.0.1",
    publishedPort: 18081,
    approvedHttpsOrigin: "https://files.home.arpa:20443",
    trustedProxies: ["172.24.0.8"],
    internalHomarrUrl: "http://nextcloud:80"
  };
}

const manifest = buildNextcloudManifest(input());
validateWithComposeOwner(manifest);
assert.deepEqual(manifest.services.map((service: any) => service.id), ["database", "nextcloud", "nextcloud-cron", "redis"]);
const app = manifest.services.find((service: any) => service.id === "nextcloud");
const cron = manifest.services.find((service: any) => service.id === "nextcloud-cron");
const database = manifest.services.find((service: any) => service.id === "database");
const redis = manifest.services.find((service: any) => service.id === "redis");
assert.deepEqual(app.dependsOn, [{ service: "database", condition: "service_healthy" }, { service: "redis", condition: "service_healthy" }]);
assert.deepEqual(cron.entrypoint, ["/cron.sh"]);
assert.deepEqual(cron.environment, [{ name: "REDIS_HOST", value: "redis" }]);
assert.equal(app.mounts[0].shareGroup, "nextcloud-html");
assert.equal(cron.mounts[0].shareGroup, "nextcloud-html");
assert.equal(database.healthcheck.test[0], "CMD");
assert.equal(redis.healthcheck.test[0], "CMD");
assert.deepEqual(redis.secretRefs, []);
assert.equal(redis.networks.includes("homarr"), false);
assert.equal(database.ports.length, 0);
assert.equal(app.environment.find((entry: any) => entry.name === "NEXTCLOUD_ADMIN_USER").value, "household-admin");
assert.equal(app.environment.find((entry: any) => entry.name === "NEXTCLOUD_TRUSTED_DOMAINS").value, "files.home.arpa:20443 nextcloud");
assert.equal(app.environment.find((entry: any) => entry.name === "TRUSTED_PROXIES").value, "172.24.0.8");

const unknown = input() as any;
unknown.unexpected = true;
assert.throws(() => buildNextcloudManifest(unknown), /unsupported field/);

const incomplete = input() as any;
delete incomplete.images.cache;
assert.throws(() => buildNextcloudManifest(incomplete), /missing cache/);

const publicOrigin = input();
publicOrigin.approvedHttpsOrigin = "http://files.example.test";
assert.throws(() => buildNextcloudManifest(publicOrigin), /HTTPS URL/);

const broadProxy = input();
broadProxy.trustedProxies = ["0.0.0.0/0"];
assert.throws(() => buildNextcloudManifest(broadProxy), /must be narrow/);

const outsideSecret = input();
outsideSecret.secrets.adminPassword.filePath = "/tmp/admin";
assert.throws(() => validateWithComposeOwner(buildNextcloudManifest(outsideSecret)), /selfhost-compose rejected/);

const unpinned = input();
unpinned.images.nextcloud.pinnedRef = "docker.io/library/nextcloud:35.0.0-apache";
assert.throws(() => buildNextcloudManifest(unpinned), /immutable sha256 digest/);

const wrongDatabase = input();
wrongDatabase.images.database.pinnedRef = `docker.io/library/postgres:16.9-alpine@sha256:${digest("d")}`;
assert.throws(() => buildNextcloudManifest(wrongDatabase), /PostgreSQL 17/);

const remoteDatabaseStorage = input();
remoteDatabaseStorage.storage.database.localFilesystem = false;
assert.throws(() => buildNextcloudManifest(remoteDatabaseStorage), /localFilesystem must be true/);

process.stdout.write("PASS Nextcloud manifest plan\n");
