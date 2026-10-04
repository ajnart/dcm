#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleBackupCommand } from "../src/bundle-backup.ts";
import { caddyPrivateCommand } from "../src/caddy-private.ts";
import { buildIngressPlan } from "../../../.agents/skills/self-host/workflows/selfhost-ingress/scripts/plan-ingress.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function privateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function capture(action: () => Promise<void>): Promise<string> {
  const previous = console.log;
  let output = "";
  console.log = (value: unknown) => { output += `${String(value)}\n`; };
  try { await action(); return output; }
  finally { console.log = previous; }
}

const root = await mkdtemp(join(tmpdir(), "selfhost-backup-plan-"));
try {
  const state = join(root, ".selfhost", "bundles", "household");
  await mkdir(state, { recursive: true, mode: 0o700 });
  const bundlePath = join(state, "household-bundle.json");
  const immichInput = join(state, "immich-input.json");
  const docmostInput = join(state, "docmost-input.json");
  const vaultInput = join(state, "vaultwarden-input.json");
  const account = join(state, "account.json");
  const httpsPlan = join(state, "https-plan.json");
  const appProject = (id: string) => ({ id, root, directory: join(root, id), dockerContext: "default" });
  await privateJson(immichInput, { project: appProject("household-immich"),
    storage: {
      uploads: { path: join(root, "household-immich", "data", "uploads") },
      database: { path: join(root, "household-immich", "data", "database") },
      modelCache: { path: join(root, "household-immich", "data", "model-cache") },
    }, images: { server: "synthetic-image" } });
  await privateJson(docmostInput, { project: appProject("household-docmost"), images: { app: "synthetic-image" } });
  await privateJson(vaultInput, { project: appProject("household-vault"),
    apps: { vaultwarden: { image: "synthetic-image", storage: { data: { path: join(root, "household-vault", "data") } } } } });
  await privateJson(account, { schemaVersion: 1 });
  await privateJson(httpsPlan, { schemaVersion: 1 });
  await privateJson(bundlePath, { schemaVersion: 1, id: "household", projectRoot: root,
    services: {
      media: { runId: "household-media", username: "admin", credentialHandoff: true },
      immich: { input: immichInput, runId: "household-immich", accountFile: account },
      docmost: { input: docmostInput, runId: "household-docmost", accountFile: account },
      vaultwarden: { input: vaultInput, runId: "household-vault", accountFile: account, httpsPlan },
    } });
  const backup = join(tmpdir(), `selfhost-backup-target-${process.pid}`);
  const restore = join(tmpdir(), `selfhost-restore-target-${process.pid}`);
  const args = ["plan", "--project-root", root, "--input", bundlePath,
    "--backup-target", backup, "--restore-target", restore];
  const first = JSON.parse(await capture(() => bundleBackupCommand(args)));
  const second = JSON.parse(await capture(() => bundleBackupCommand(args)));
  check(first.planDigest === second.planDigest && first.status === "blocked" && first.mutation === false,
    "backup plan was not stable and explicitly non-mutating");
  check(first.sources.some((entry: any) => entry.id === "docmost-durable"
    && entry.paths.includes(join(root, "household-docmost", "data", "redis"))),
  "Docmost Redis AOF was omitted without a proven safe exclusion");
  check(!existsSync(backup) && !existsSync(restore), "read-only backup plan created a target");
  check(first.routeCoverage.startsWith("uncovered") && !first.runtime.sharedCaddy, "unselected Caddy was silently covered");

  const edge = "household-caddy";
  const edgeDirectory = join(root, edge);
  const caddyDirectory = join(state, "caddy");
  const edgeState = join(root, ".selfhost", "caddy-private", edge);
  await mkdir(caddyDirectory, { mode: 0o700 });
  await mkdir(edgeState, { recursive: true, mode: 0o700 });
  const routePath = join(caddyDirectory, "vaultwarden-plan.json");
  const routePlan = buildIngressPlan({ schemaVersion: 1,
    service: { id: "vaultwarden", class: "application", internalPort: 80 },
    facts: { ownership: { ports: [{ port: 28443, owner: edge }] } },
    preferences: { route: "caddy-private", hostname: "vaultwarden.localhost", clientTrustPlanned: true,
      caddy: { owner: edge, runtime: "container", upstreamHost: "vaultwarden", clientScope: "host-only",
        hostBindAddress: "127.0.0.1", httpsPort: 28443,
        configPath: join(edgeDirectory, "config"), dataPath: join(edgeDirectory, "data") } } });
  await privateJson(routePath, routePlan);
  const caddyInput = { schemaVersion: 1,
    project: { dockerContext: "default", id: edge, owner: edge, root, directory: edgeDirectory, ownership: "new" },
    caddyImage: `docker.io/library/caddy:2.11.4-alpine@sha256:${"a".repeat(64)}`,
    routes: [{ planPath: routePath, network: "vaultwarden" }],
    upstreamNetworks: [{ id: "vaultwarden", name: "vaultwarden-private", owner: "external", internal: true }],
    observed: { checkedAt: new Date().toISOString(), project: null, ports: [], paths: [],
      networks: [{ name: "vaultwarden-private", owner: "external" }] },
    portObservation: { hostIp: "127.0.0.1", port: 28443, protocol: "tcp", inUse: false, checkedAt: new Date().toISOString() } };
  const caddyInputPath = join(caddyDirectory, "shared-caddy.json");
  await privateJson(caddyInputPath, caddyInput);
  let caddyPlanOutput = "";
  const previousWrite = process.stdout.write;
  process.stdout.write = ((value: string | Uint8Array) => { caddyPlanOutput += String(value); return true; }) as typeof process.stdout.write;
  try { await caddyPrivateCommand(["plan", "--project-root", root, "--input", caddyInputPath]); }
  finally { process.stdout.write = previousWrite; }
  const caddyPlan = JSON.parse(caddyPlanOutput);
  const checkpoint = { schemaVersion: 3, kind: "shared-private-caddy-checkpoint", project: edge,
    inputPath: caddyInputPath, approvalDigest: caddyPlan.approval.split(":").at(-1), manifest: caddyPlan.manifest,
    composeFile: caddyPlan.composePlan.render.target, caddyfilePath: join(edgeDirectory, "Caddyfile"),
    caddyfileSha256: caddyPlan.caddyfileSha256, configPath: join(edgeDirectory, "config"), dataPath: join(edgeDirectory, "data"),
    caSourcePath: join(edgeDirectory, "data", "caddy", "pki", "authorities", "local", "root.crt"),
    caExportPath: join(edgeState, "caddy-local-root.crt"), bindAddress: "127.0.0.1", httpsPort: 28443,
    routes: [{ hostname: "vaultwarden.localhost", origin: "https://vaultwarden.localhost:28443" }],
    phase: "stopped", caSha256: "b".repeat(64), updatedAt: new Date().toISOString(), transportProofs: [] };
  const statePath = join(edgeState, "state.json");
  await privateJson(statePath, checkpoint);
  await privateJson(httpsPlan, { routeOwner: edge, tlsOwner: edge, origin: "https://vaultwarden.localhost:28443" });
  const caddyArgs = [...args, "--shared-caddy-input", caddyInputPath];
  const included = JSON.parse(await capture(() => bundleBackupCommand(caddyArgs)));
  const includedAgain = JSON.parse(await capture(() => bundleBackupCommand(caddyArgs)));
  check(included.planDigest === includedAgain.planDigest && included.planDigest !== first.planDigest, "Caddy plan was unstable or unbound");
  check(included.status === "blocked" && included.verification.restore === "not-verified"
    && included.runtime.sharedCaddy.image === caddyInput.caddyImage
    && included.sources.some((source: any) => source.id === "shared-caddy-durable"
      && source.paths.includes(join(edgeDirectory, "data")) && source.paths.includes(edgeState)
      && source.paths.includes(routePath)), "Caddy recovery inventory omitted owned persistence/control paths or overstated recovery");
  check(!existsSync(checkpoint.caSourcePath) && !existsSync(edgeDirectory) && !existsSync(backup) && !existsSync(restore),
    "inventory read or created persistence/CA/target paths instead of control metadata only");
  const rejects = async (action: () => Promise<unknown>) => {
    let refused = false;
    try { await action(); } catch { refused = true; }
    check(refused, "unsafe shared-Caddy recovery inventory was accepted");
  };
  await rejects(() => capture(() => bundleBackupCommand([...args, "--shared-caddy-input", join(root, "unrelated-proxy.json")])));
  await privateJson(caddyInputPath, { ...caddyInput, caddyImage: `docker.io/library/caddy:2.11.4-alpine@sha256:${"c".repeat(64)}` });
  await rejects(() => capture(() => bundleBackupCommand(caddyArgs)));
  await privateJson(caddyInputPath, caddyInput);
  await privateJson(caddyInputPath, { ...caddyInput, routes: [{ planPath: join(root, "unrelated-route-plan.json"), network: "vaultwarden" }] });
  await rejects(() => capture(() => bundleBackupCommand(caddyArgs)));
  await privateJson(caddyInputPath, caddyInput);
  await chmod(routePath, 0o644);
  await rejects(() => capture(() => bundleBackupCommand(caddyArgs)));
  await chmod(routePath, 0o600);
  await privateJson(statePath, { ...checkpoint, unexpected: true });
  await rejects(() => capture(() => bundleBackupCommand(caddyArgs)));
  await privateJson(statePath, { ...checkpoint, dataPath: join(root, "unrelated-data") });
  await rejects(() => capture(() => bundleBackupCommand(caddyArgs)));
  await rm(statePath);
  await rejects(() => capture(() => bundleBackupCommand(caddyArgs)));

  let overlapRejected = false;
  try {
    await capture(() => bundleBackupCommand([...args.slice(0, -1), join(backup, "nested")]));
  } catch { overlapRejected = true; }
  check(overlapRejected, "backup plan accepted overlapping capture and restore targets");
  console.log("PASS bundle backup plan is stable, non-mutating, and scopes Docmost AOF plus optional retained shared-Caddy inventory");
} finally {
  await rm(root, { recursive: true, force: true });
}
