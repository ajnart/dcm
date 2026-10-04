#!/usr/bin/env bun

import { strict as assert } from "node:assert";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-begin-"));
const digest = "a".repeat(64);
let inspectionPath = "";
let inspectedPorts: number[] = [];
const noApply = async () => { throw new Error("bundle begin must not invoke an adapter"); };

async function capture(action: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const priorLog = console.log;
  const priorWrite = process.stdout.write;
  const priorErrorWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  console.log = (...values: unknown[]) => { stdout += `${values.join(" ")}\n`; };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;
  try { await action(); return { stdout, stderr }; }
  finally {
    console.log = priorLog;
    process.stdout.write = priorWrite;
    process.stderr.write = priorErrorWrite;
  }
}

try {
  const args = ["begin", "--project-root", root, "--id", "home", "--email", "admin@example.com",
    "--name", "Home Admin", "--media-port-start", "21000",
    "--docmost-image", `docker.io/docmost/docmost:0.96.0@sha256:${digest}`,
    "--postgres-image", `docker.io/library/postgres:18.6@sha256:${digest}`,
    "--redis-image", `docker.io/library/redis:8.10.2@sha256:${digest}`,
    "--vaultwarden-image", `docker.io/vaultwarden/server:1.37.3@sha256:${digest}`,
    "--vaultwarden-origin", "https://vaultwarden.localhost:28443",
    "--https-route-owner", "caddy-home", "--https-tls-owner", "caddy-home"];
  const output = await capture(() => bundleCommand(args, {
    media: noApply, immich: noApply, docmost: noApply, vaultwarden: noApply,
    inspectHost: async (options) => {
      const index = options.indexOf("--output");
      assert.ok(index >= 0);
      inspectionPath = options[index + 1];
      assert.equal((await lstat(dirname(inspectionPath))).mode & 0o777, 0o700);
      assert.deepEqual(options.slice(0, 2), ["--limit", "50"]);
      inspectedPorts = [];
      for (let offset = 2; offset < index; offset += 2) {
        assert.equal(options[offset], "--check-tcp-port");
        inspectedPorts.push(Number(options[offset + 1]));
      }
      assert.ok(inspectedPorts.length <= 16);
      assert.deepEqual(inspectedPorts, [2283, 3000, 8080, 21000, 21001, 21002, 21003, 21004, 21005, 21006]);
      await writeFile(inspectionPath, `${JSON.stringify({
        schemaVersion: 1, mode: "read-only",
        platform: { kernel: { architecture: "x86_64" } },
        identity: { uid: process.getuid?.(), gid: process.getgid?.() },
        runtime: { docker: { state: "running", rootless: { state: "observed", value: false } }, dockerContext: { state: "observed", current: "default" } },
        workloads: { dockerNetworks: { state: "observed", items: [], truncated: false } },
        network: {
          listeningPorts: { state: "observed", items: [], truncated: false },
          selectedTcpPorts: { state: "observed", complete: true,
            items: inspectedPorts.map((port) => ({ port, inUse: false })) },
        },
      })}\n`, { mode: 0o600 });
      await chmod(inspectionPath, 0o600);
    },
  }));
  assert.equal((await lstat(inspectionPath)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(root, ".selfhost", "journeys", "home.json"))).mode & 0o777, 0o600);
  const bundlePath = join(root, ".selfhost", "bundles", "home", "household-bundle.json");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  assert.equal(bundle.services.media.bindMode, "host-only");
  const plan = JSON.parse(output.stdout);
  assert.equal(plan.kind, "household-bundle-plan", "stdout is one machine-readable plan");
  assert.equal(plan.bundle, "home");
  assert.match(output.stderr, /"kind": "household-full-journey-status"/);
  assert.match(output.stderr, /"kind": "household-bundle-init"/);
  await assert.rejects(bundleCommand(args, {
    media: noApply, immich: noApply, docmost: noApply, vaultwarden: noApply,
    inspectHost: noApply,
  }), /refuses to overwrite existing path/);
  const adoptedArgs = [...args];
  adoptedArgs.splice(adoptedArgs.indexOf("--media-port-start"), 2);
  adoptedArgs[adoptedArgs.indexOf("home")] = "adopted";
  adoptedArgs.push("--media-run-id", "existing-media");
  await assert.rejects(bundleCommand([...adoptedArgs.slice(0, -1), "INVALID"], {
    media: noApply, immich: noApply, docmost: noApply, vaultwarden: noApply, inspectHost: noApply,
  }), /exact CLI media run ID/);
  assert.equal(existsSync(join(root, ".selfhost", "journeys", "adopted.json")), false);
  await assert.rejects(bundleCommand([...adoptedArgs, "--media-bind-mode", "host-only"], {
    media: noApply, immich: noApply, docmost: noApply, vaultwarden: noApply, inspectHost: noApply,
  }), /keeps its existing bind, ports, and networks/);
  assert.equal(existsSync(join(root, ".selfhost", "journeys", "adopted.json")), false);
  const mediaArtifacts = join(root, ".selfhost", "media-harness", ".sessions", "existing-media", "artifacts");
  await mkdir(mediaArtifacts, { recursive: true, mode: 0o700 });
  const names = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"];
  const syntheticMediaPassword = ["synthetic", "password"].join("-");
  const services = Object.fromEntries(names.map((name) => [name, {
    username: "admin", password: syntheticMediaPassword, url: "http://127.0.0.1:21000", apiKey: null,
  }]));
  await writeFile(join(mediaArtifacts, "private-handoff.json"), `${JSON.stringify({ runId: "existing-media", services })}\n`, { mode: 0o600 });
  const adoptedOutput = await capture(() => bundleCommand(adoptedArgs, {
    media: async (command) => {
      if (command[0] === "status") {
        console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-status", provenance: "cli-managed",
          runId: "existing-media", composeProject: "autostack-existing-media",
          services: names.map((service) => ({ service, present: true, state: "running", running: true, health: "unavailable" })),
          summary: { expected: 7, present: 7, running: 7, healthy: 0, unhealthy: 0, starting: 0, healthUnavailable: 7 } }));
      } else if (command[0] === "info") {
        const keys = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
        console.log(JSON.stringify({ schemaVersion: 1, runId: "existing-media", projectRoot: root,
          composeProject: "autostack-existing-media", adminUsername: "admin", approved: true,
          bind: "127.0.0.1", approvalDigest: "b".repeat(64),
          ports: Object.fromEntries(keys.map((key, index) => [key, String(21000 + index)])) }));
      }
    },
    immich: noApply, docmost: noApply, vaultwarden: noApply,
    inspectHost: async (options) => {
      const index = options.indexOf("--output");
      const ports: number[] = [];
      for (let offset = 2; offset < index; offset += 2) ports.push(Number(options[offset + 1]));
      assert.deepEqual(ports, [2283, 3000, 8080]);
      await writeFile(options[index + 1], `${JSON.stringify({ schemaVersion: 1, mode: "read-only",
        platform: { kernel: { architecture: "x86_64" } }, identity: { uid: process.getuid?.(), gid: process.getgid?.() },
        runtime: { docker: { state: "running", rootless: { state: "observed", value: false } }, dockerContext: { state: "observed", current: "default" } },
        workloads: { dockerNetworks: { state: "observed", items: [], truncated: false } },
        network: { listeningPorts: { state: "observed", items: [], truncated: false },
          selectedTcpPorts: { state: "observed", complete: true, items: ports.map((port) => ({ port, inUse: false })) } },
      })}\n`, { mode: 0o600 });
    },
  }));
  const adoptedPlan = JSON.parse(adoptedOutput.stdout);
  assert.equal(adoptedPlan.mediaSelection.mode, "adopt");
  assert.equal(adoptedPlan.mediaSelection.runId, "existing-media");
  assert.equal(adoptedPlan.mediaSelection.bind, "127.0.0.1");
  assert.deepEqual(adoptedPlan.mediaPorts, [21000, 21001, 21002, 21003, 21004, 21005, 21006]);
  assert.match(adoptedPlan.mediaExposure, /127\.0\.0\.1/);
  console.log("PASS bundle begin guided preparation and no-clobber gates");
} finally {
  await rm(root, { recursive: true, force: true });
}
