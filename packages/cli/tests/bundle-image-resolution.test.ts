#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function capture(action: () => Promise<void>): Promise<string> {
  const prior = console.log;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.map((value) => String(value)).join(" ")}\n`; };
  try { await action(); return output; }
  finally { console.log = prior; }
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-images-"));
try {
  const inspection = join(root, "host-inspection.json");
  await writeFile(inspection, `${JSON.stringify({
    schemaVersion: 1,
    mode: "read-only",
    platform: { kernel: { architecture: "x86_64" } },
    identity: { uid: process.getuid?.(), gid: process.getgid?.() },
    runtime: {
      docker: { state: "running", rootless: { state: "observed", value: false } },
      dockerContext: { state: "observed", current: "default" },
    },
    workloads: { dockerNetworks: { state: "observed", items: [], truncated: false } },
    network: {
      listeningPorts: { state: "observed", items: [], truncated: false },
      selectedTcpPorts: { state: "observed", complete: true, items: [
        { port: 2283, inUse: false }, { port: 3000, inUse: false }, { port: 8080, inUse: false },
      ] },
    },
  }, null, 2)}\n`, { mode: 0o600 });
  await chmod(inspection, 0o600);

  const tags = [
    "docker.io/docmost/docmost:0.96.0",
    "docker.io/library/postgres:18.6",
    "docker.io/library/redis:8.10.2",
    "docker.io/vaultwarden/server:1.37.3",
  ];
  const manifests = new Map(tags.map((tag, index) => {
    const raw = Buffer.from(JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        { digest: `sha256:${String(index + 1).repeat(64)}`, platform: { os: "linux", architecture: "amd64" } },
        { digest: `sha256:${String(index + 5).repeat(64)}`, platform: { os: "linux", architecture: "arm64" } },
      ],
    }));
    return [tag, raw];
  }));
  const calls: string[][] = [];
  let concurrentInspections = 0;
  let maximumConcurrentInspections = 0;
  const noop = async () => {};
  const dependencies = {
    media: noop, immich: noop, docmost: noop, vaultwarden: noop,
    inspectImage: async (command: string[]) => {
      calls.push(command);
      concurrentInspections += 1;
      maximumConcurrentInspections = Math.max(maximumConcurrentInspections, concurrentInspections);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrentInspections -= 1;
      const raw = manifests.get(command[4]);
      if (!raw) return { ok: false, stdout: Buffer.alloc(0) };
      return { ok: true, stdout: raw };
    },
  };
  const base = ["init", "--project-root", root, "--id", "home", "--email", "admin@example.com",
    "--name", "Home Admin", "--host-inspection", inspection, "--resolve-images",
    "--vaultwarden-origin", "https://vault.home.arpa", "--https-route-owner", "caddy-home",
    "--https-tls-owner", "caddy-home"];
  const output = JSON.parse(await capture(() => bundleCommand(base, dependencies)));
  check(calls.length === 4, "bundle init did not inspect all four reviewed tags");
  check(maximumConcurrentInspections === 4, "independent registry inspections did not run concurrently");
  for (let index = 0; index < tags.length; index += 1) {
    check(JSON.stringify(calls[index]) === JSON.stringify([
      "docker", "buildx", "imagetools", "inspect", tags[index], "--raw",
    ]), `unexpected registry inspection command for ${tags[index]}`);
  }
  check(output.selections.hostIp === "127.0.0.1" && output.selections.imageSource === "registry-resolved",
    "resolved init did not record the safe loopback and registry source defaults");
  check(output.limits.includes("No container was started."), "resolved init overstated its mutation boundary");
  const bundle = JSON.parse(await readFile(output.input, "utf8"));
  const docmost = JSON.parse(await readFile(bundle.services.docmost.input, "utf8"));
  const vaultwarden = JSON.parse(await readFile(bundle.services.vaultwarden.input, "utf8"));
  const expected = Object.fromEntries(tags.map((tag) => {
    const raw = manifests.get(tag);
    check(raw, `missing fixture manifest for ${tag}`);
    return [tag, `${tag}@sha256:${createHash("sha256").update(raw).digest("hex")}`];
  }));
  check(docmost.images.docmost === expected[tags[0]] && docmost.images.postgres === expected[tags[1]]
    && docmost.images.redis === expected[tags[2]] && vaultwarden.apps.vaultwarden.image === expected[tags[3]],
  "bundle inputs did not preserve the exact reviewed tags and raw-manifest digests");
  for (const path of [bundle.services.docmost.input, bundle.services.vaultwarden.input]) {
    check((await lstat(path)).mode % 0o1000 === 0o600, "resolved image input lost owner-only mode");
  }

  const mixed = [...base];
  mixed[mixed.indexOf("home")] = "mixed";
  mixed.push("--docmost-image", `${tags[0]}@sha256:${"a".repeat(64)}`);
  let mixedRejected = false;
  try { await bundleCommand(mixed, dependencies); }
  catch (error) { mixedRejected = error instanceof Error && error.message.includes("cannot be combined"); }
  check(mixedRejected && !existsSync(join(root, ".selfhost", "bundles", "mixed")),
    "bundle init accepted or wrote mixed resolved and explicit image inputs");

  const unavailable = [...base];
  unavailable[unavailable.indexOf("home")] = "unavailable";
  let unavailableRejected = false;
  try {
    await bundleCommand(unavailable, { ...dependencies,
      inspectImage: async () => ({ ok: false, stdout: Buffer.from("registry detail must not leak") }) });
  } catch (error) {
    unavailableRejected = error instanceof Error && error.message.includes("output was suppressed")
      && !error.message.includes("registry detail must not leak");
  }
  check(unavailableRejected && !existsSync(join(root, ".selfhost", "bundles", "unavailable")),
    "bundle init wrote files after registry resolution failed");

  const unsupported = [...base];
  unsupported[unsupported.indexOf("home")] = "unsupported";
  let unsupportedRejected = false;
  try {
    await bundleCommand(unsupported, { ...dependencies, inspectImage: async () => ({ ok: true, stdout: Buffer.from(JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [{ digest: `sha256:${"b".repeat(64)}`, platform: { os: "linux", architecture: "arm64" } }],
    })) }) });
  } catch (error) {
    unsupportedRejected = error instanceof Error && error.message.includes("required linux/amd64");
  }
  check(unsupportedRejected && !existsSync(join(root, ".selfhost", "bundles", "unsupported")),
    "bundle init accepted platform drift or wrote partial files");

  console.log("PASS bundle image resolution, immutable refs, and failure guards");
} finally {
  await rm(root, { recursive: true });
}
