#!/usr/bin/env bun

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function capture(action: () => Promise<void>): Promise<string> {
  const priorLog = console.log;
  const priorWrite = process.stdout.write;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.map((value) => String(value)).join(" ")}\n`; };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === "string") output += chunk;
    else output += Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try { await action(); return output; }
  finally { console.log = priorLog; process.stdout.write = priorWrite; }
}

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function mediaStatus(runId: string) {
  const services = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"]
    .map((service) => ({ service, present: true, state: "running", running: true, health: "unavailable" }));
  return { schemaVersion: 1, kind: "selfhost-media-status", provenance: "cli-managed", runId,
    composeProject: `autostack-${runId}`, services,
    summary: { expected: 7, present: 7, running: 7, healthy: 0, unhealthy: 0, starting: 0, healthUnavailable: 7 } };
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-lifecycle-"));
try {
  const immichInput = join(root, "immich.json");
  const immichAccount = join(root, "immich-account.json");
  const docmostInput = join(root, "docmost.json");
  const docmostAccount = join(root, "docmost-account.json");
  const vaultwardenInput = join(root, "vaultwarden.json");
  const vaultwardenAccount = join(root, "vaultwarden-account.json");
  const httpsPlan = join(root, "vaultwarden-https.json");
  const bundleInput = join(root, "bundle.json");
  const localHttpsInput = join(root, "caddy.json");
  for (const path of [immichInput, immichAccount, docmostInput, docmostAccount, vaultwardenAccount, localHttpsInput]) {
    await privateJson(path, { fixture: true });
  }
  await privateJson(vaultwardenInput, {
    integrationNetwork: { id: "vaultwarden-route", name: "caddy-home-private", owner: "external" },
  });
  await privateJson(httpsPlan, { schemaVersion: 1, origin: "https://vaultwarden.localhost:28443", exposure: "private",
    routeStatus: "configured", routeOwner: "caddy-home", tlsOwner: "caddy-home",
    clientCertificateTrust: "verified-for-intended-client", backend: { hostIp: "127.0.0.1", publishedPort: 8080 } });
  await privateJson(bundleInput, { schemaVersion: 1, id: "home", projectRoot: root, services: {
    media: { runId: "home-media", username: "admin", credentialHandoff: true },
    immich: { input: immichInput, runId: "home-immich", accountFile: immichAccount },
    docmost: { input: docmostInput, runId: "home-docmost", accountFile: docmostAccount },
    vaultwarden: { input: vaultwardenInput, runId: "home-vault", accountFile: vaultwardenAccount, httpsPlan },
  } });

  const noop = async () => {};
  const plan = JSON.parse(await capture(() => bundleCommand(["plan", "--project-root", root, "--input", bundleInput], {
    media: noop, immich: noop, docmost: noop, vaultwarden: noop,
  })));

  const status = JSON.parse(await capture(() => bundleCommand(["status", "--project-root", root, "--input", bundleInput], {
    media: async () => { console.log(JSON.stringify(mediaStatus("home-media"))); },
    immich: async () => { console.log("{}"); },
    docmost: async () => { console.log("{}"); },
    vaultwarden: noop,
  })));
  check(status.privateHttps.lifecycle.status === "separate-owner"
    && status.privateHttps.lifecycle.warning.includes("caddy-home"),
  "bundle status did not keep the omitted route owner explicit");

  const calls: string[] = [];
  const dependency = (name: string) => async (args: string[]) => { calls.push(`${name}:${args[0]}`); };
  const lifecycleDependencies = {
    media: dependency("media"), immich: dependency("immich"), docmost: dependency("docmost"),
    vaultwarden: dependency("vaultwarden"),
  };
  const up = JSON.parse(await capture(() => bundleCommand(["up", "--project-root", root, "--input", bundleInput,
    "--approve", plan.approval], lifecycleDependencies)));
  check(JSON.stringify(calls) === JSON.stringify([
    "media:lifecycle-check", "immich:lifecycle-check", "docmost:lifecycle-check", "vaultwarden:lifecycle-check",
    "media:up", "immich:up", "docmost:up", "vaultwarden:up",
  ]), "bundle up did not preflight every owner before deterministic startup");
  check(up.volumesDeleted === false && up.resourcesPruned === false && up.fullAcceptance === false,
    "bundle up overstated its mutation or acceptance scope");

  calls.length = 0;
  await capture(() => bundleCommand(["down", "--project-root", root, "--input", bundleInput,
    "--approve", plan.approval], lifecycleDependencies));
  check(JSON.stringify(calls) === JSON.stringify([
    "media:lifecycle-check", "immich:lifecycle-check", "docmost:lifecycle-check", "vaultwarden:lifecycle-check",
    "vaultwarden:down", "docmost:down", "immich:down", "media:stop",
  ]), "bundle down did not stop dependents first or use the media stop path");

  calls.length = 0;
  const routeStatus = { schemaVersion: 1, kind: "vaultwarden-local-https-status", project: "caddy-home", runId: "caddy-home",
    origin: "https://vaultwarden.localhost:28443",
    integrationNetwork: { id: "vaultwarden-route", name: "caddy-home-private", owner: "caddy-home" },
    access: { scope: "host-only", bindAddress: "127.0.0.1", bindingOwner: "compose-published-port", public: false },
    applied: true, checkpoint: { recorded: true } };
  const routeDependencies = {
    media: dependency("media"), immich: dependency("immich"), docmost: dependency("docmost"),
    vaultwarden: async (args: string[]) => {
      calls.push(`vaultwarden:${args.slice(0, 2).join("/")}`);
      if (args[0] === "local-https" && args[1] === "status") console.log(JSON.stringify(routeStatus));
    },
  };
  const routed = JSON.parse(await capture(() => bundleCommand(["up", "--project-root", root, "--input", bundleInput,
    "--approve", plan.approval, "--local-https-input", localHttpsInput, "--local-https-run-id", "caddy-home"], routeDependencies)));
  check(routed.localHttps.network === "caddy-home-private" && calls.at(-1) === "vaultwarden:local-https/up",
    "bundle up did not validate and start the explicit bound local route last");

  let invalidRouteRefused = false;
  const invalidRouteDependencies = { ...routeDependencies, vaultwarden: async (args: string[]) => {
    if (args[0] === "local-https" && args[1] === "status") {
      console.log(JSON.stringify({ ...routeStatus,
        integrationNetwork: { id: "vaultwarden-route", name: "another-network", owner: "caddy-home" } }));
    }
  } };
  try {
    await capture(() => bundleCommand(["up", "--project-root", root, "--input", bundleInput,
      "--approve", plan.approval, "--local-https-input", localHttpsInput, "--local-https-run-id", "caddy-home"], invalidRouteDependencies));
  } catch (error) {
    invalidRouteRefused = error instanceof Error && error.message.includes("not bound to this exact Vaultwarden project");
  }
  check(invalidRouteRefused, "bundle lifecycle accepted a Caddy route bound to another network");

  let mutationCalled = false;
  let preflightMessage = "";
  const failingPreflight = {
    media: dependency("media"), immich: dependency("immich"),
    docmost: async (args: string[]) => {
      if (args[0] === "lifecycle-check") throw new Error("fixture preflight failure");
      mutationCalled = true;
    },
    vaultwarden: dependency("vaultwarden"),
  };
  try {
    await capture(() => bundleCommand(["down", "--project-root", root, "--input", bundleInput,
      "--approve", plan.approval], failingPreflight));
  } catch (error) {
    if (error instanceof Error) preflightMessage = error.message;
  }
  check(mutationCalled === false && preflightMessage.includes("down preflight failed for docmost")
    && preflightMessage.includes("adapter-status-error")
    && !preflightMessage.includes("fixture preflight failure")
    && preflightMessage.includes("Projects already changed by this command: none"),
  "bundle lifecycle failed to explain a safe preflight stop");

  let dockerMessage = "";
  try {
    await capture(() => bundleCommand(["up", "--project-root", root, "--input", bundleInput,
      "--approve", plan.approval], {
      ...lifecycleDependencies,
      media: async () => { throw new Error("Docker daemon is unavailable"); },
    }));
  } catch (error) {
    if (error instanceof Error) dockerMessage = error.message;
  }
  check(dockerMessage.includes("media (docker-daemon-unavailable; check Docker context and socket access)")
    && dockerMessage.includes("Projects already changed by this command: none"),
  "bundle lifecycle did not classify Docker preflight failure");

  calls.length = 0;
  const failingMutation = {
    media: dependency("media"), immich: dependency("immich"),
    docmost: async (args: string[]) => {
      if (args[0] === "up") throw new Error("fixture mutation failure");
      calls.push(`docmost:${args[0]}`);
    },
    vaultwarden: dependency("vaultwarden"),
  };
  let mutationMessage = "";
  try {
    await capture(() => bundleCommand(["up", "--project-root", root, "--input", bundleInput,
      "--approve", plan.approval], failingMutation));
  } catch (error) {
    if (error instanceof Error) mutationMessage = error.message;
  }
  check(mutationMessage.includes("up mutation failed for docmost")
    && mutationMessage.includes("Projects already changed by this command: media, immich"),
  "bundle lifecycle did not report partial progress after an adapter failure");
  console.log("PASS bundle lifecycle ownership, ordering, and optional Caddy binding");
} finally {
  await rm(root, { recursive: true, force: true });
}
