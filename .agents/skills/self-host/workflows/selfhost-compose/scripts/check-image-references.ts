#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const composeProject = path.join(import.meta.dir, "compose-project.ts");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "compose-image-ref-"));
const digest = "a".repeat(64);

function manifest(image: string) {
  return {
    schemaVersion: 1,
    project: {
      dockerContext: "default",
      id: "image-ref-check",
      owner: "image-ref-check",
      root: "/srv/selfhost-projects",
      directory: "/srv/selfhost-projects/image-ref-check",
      ownership: "new"
    },
    services: [{
      id: "app",
      image,
      restart: "unless-stopped",
      readOnly: true,
      user: "1000:1000",
      environment: [],
      ports: [],
      mounts: [],
      networks: ["private"],
      secretRefs: []
    }],
    networks: [{ id: "private", name: "image-ref-check-private", driver: "bridge", internal: true, owner: "image-ref-check", ownership: "new" }],
    observed: { checkedAt: "2026-09-21T00:00:00Z", project: null, ports: [], paths: [], networks: [] }
  };
}

function validate(image: string) {
  const input = path.join(temporary, "manifest.json");
  fs.writeFileSync(input, `${JSON.stringify(manifest(image))}\n`, { mode: 0o600 });
  return Bun.spawnSync([process.execPath, composeProject, "validate", "--input", input], { stdout: "pipe", stderr: "pipe" });
}

try {
  for (const image of [
    `registry.example:5000/team/app:1.2.3@sha256:${digest}`,
    `registry.example:5000/team/app@sha256:${digest}`,
    `ghcr.io/homarr-labs/homarr:dev@sha256:${digest}`,
    "registry.example:5000/team/app:1.2.3"
  ]) {
    const result = validate(image);
    assert.equal(result.exitCode, 0, result.stderr.toString());
  }

  for (const image of [
    `registry.example:5000/team/app:latest@sha256:${digest}`,
    `registry.example:5000/team/app:stable@sha256:${digest}`,
    "ghcr.io/homarr-labs/homarr:dev",
    "registry.example:5000/team/app@sha256:abcd",
    `registry.example:5000/team/app:1.2.3@sha256:${"A".repeat(64)}`,
    "registry.example:5000/team/app"
  ]) {
    const result = validate(image);
    assert.equal(result.exitCode, 2, `unexpected acceptance: ${image}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("image reference checks passed\n");
