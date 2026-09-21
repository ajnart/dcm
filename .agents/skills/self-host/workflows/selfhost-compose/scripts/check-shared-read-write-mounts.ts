#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const composeProject = path.join(import.meta.dir, "compose-project.ts");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "compose-rw-share-"));

function mount(target: string, shareGroup = "nextcloud-data") {
  return { source: "/srv/nextcloud/data", target, readOnly: false, shared: true, shareGroup, owner: "nextcloud", ownership: "new" };
}

function manifest(left = mount("/var/www/html"), right = mount("/var/www/html")) {
  const service = (id: string, selectedMount: Record<string, unknown>) => ({
    id,
    image: `docker.io/library/busybox@sha256:${"a".repeat(64)}`,
    restart: "unless-stopped",
    readOnly: false,
    user: "1000:1000",
    environment: [],
    ports: [],
    mounts: [selectedMount],
    networks: ["private"],
    secretRefs: []
  });
  return {
    schemaVersion: 1,
    project: { dockerContext: "default", id: "nextcloud", owner: "nextcloud", root: "/srv/selfhost-projects", directory: "/srv/selfhost-projects/nextcloud", ownership: "new" },
    services: [service("app", left), service("cron", right)],
    networks: [{ id: "private", name: "nextcloud-private", driver: "bridge", internal: true, owner: "nextcloud", ownership: "new" }],
    observed: { checkedAt: "2026-09-21T00:00:00Z", project: null, ports: [], paths: [], networks: [] }
  };
}

function validate(value: unknown) {
  const input = path.join(temporary, "manifest.json");
  fs.writeFileSync(input, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return Bun.spawnSync([process.execPath, composeProject, "validate", "--input", input], { stdout: "pipe", stderr: "pipe" });
}

try {
  assert.equal(validate(manifest()).exitCode, 0);

  const mismatchedGroup = validate(manifest(mount("/var/www/html", "app-data"), mount("/var/www/html", "cron-data")));
  assert.equal(mismatchedGroup.exitCode, 3);

  const wrongOwnerMount = mount("/var/www/html");
  wrongOwnerMount.owner = "other-owner";
  assert.equal(validate(manifest(wrongOwnerMount)).exitCode, 2);

  const nestedMount = mount("/var/www/html");
  nestedMount.source = "/srv/nextcloud/data/cron";
  assert.equal(validate(manifest(mount("/var/www/html"), nestedMount)).exitCode, 3);

  const missingGroup = mount("/var/www/html") as Record<string, unknown>;
  delete missingGroup.shareGroup;
  assert.equal(validate(manifest(missingGroup)).exitCode, 2);

  const readOnlyLegacy = mount("/media") as Record<string, unknown>;
  readOnlyLegacy.readOnly = true;
  delete readOnlyLegacy.shareGroup;
  const otherReadOnly = { ...readOnlyLegacy };
  assert.equal(validate(manifest(readOnlyLegacy, otherReadOnly)).exitCode, 0);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("shared read-write mount checks passed\n");
