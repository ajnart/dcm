#!/usr/bin/env bun

import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCommand } from "../src/bundle.ts";
import { docmostCommand } from "../src/docmost.ts";
import { immichCommand } from "../src/immich.ts";
import { buildHouseholdManifest, validateWithComposeOwner } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/household-plan.ts";
import { buildImmichManifest } from "../../../.agents/skills/self-host/workflows/selfhost-setup/scripts/immich-plan.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function quiet(action: () => Promise<void>): Promise<void> {
  const prior = console.log;
  const priorWrite = process.stdout.write;
  console.log = () => {};
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try { await action(); }
  finally { console.log = prior; process.stdout.write = priorWrite; }
}

async function captureOutput(action: () => Promise<void>): Promise<string> {
  const prior = console.log;
  const priorWrite = process.stdout.write;
  let output = "";
  console.log = (...values: unknown[]) => { output += `${values.map((value) => String(value)).join(" ")}\n`; };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    if (typeof chunk === "string") output += chunk;
    else output += Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try { await action(); return output; }
  finally { console.log = prior; process.stdout.write = priorWrite; }
}

function mediaStatus(runId: string, running = 7) {
  const services = ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"].map((service, index) => {
    let state = "running";
    if (index >= running) state = "exited";
    return { service, present: true, state, running: state === "running", health: "unavailable" };
  });
  return {
    schemaVersion: 1, kind: "selfhost-media-status", provenance: "cli-managed", runId,
    composeProject: `autostack-${runId}`, services,
    summary: { expected: 7, present: 7, running, healthy: 0, unhealthy: 0, starting: 0, healthUnavailable: 7 },
  };
}

function mediaInfo(root: string, runId: string, bind = "127.0.0.1") {
  const keys = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
  return { schemaVersion: 1, runId, projectRoot: root, composeProject: `autostack-${runId}`,
    adminUsername: "admin", approved: true, bind, approvalDigest: "b".repeat(64),
    ports: Object.fromEntries(keys.map((key, index) => [key, String(21000 + index)])) };
}

function withoutOptions(values: string[], names: string[]): string[] {
  const result: string[] = [values[0]];
  for (let index = 1; index < values.length; index += 2) {
    if (!names.includes(values[index])) result.push(values[index], values[index + 1]);
  }
  return result;
}

const root = await mkdtemp(join(tmpdir(), "selfhost-bundle-init-"));
try {
  const hostReport = join(root, "host-inspection.json");
  await writeFile(hostReport, `${JSON.stringify({
    schemaVersion: 1,
    mode: "read-only",
    platform: { kernel: { architecture: "x86_64" } },
    identity: { uid: process.getuid?.(), gid: process.getgid?.() },
    runtime: {
      docker: { state: "running", rootless: { state: "observed", value: false } },
      dockerContext: { state: "observed", current: "default" },
    },
    workloads: { dockerNetworks: { state: "observed", items: [
      { name: "autostack-media_default", driver: "bridge", scope: "local" },
      { name: "selfhost-caddy-route", driver: "bridge", scope: "local" },
    ], truncated: false } },
    network: {
      listeningPorts: { state: "observed", items: [
        ...Array.from({ length: 51 }, (_, index) => ({ protocol: "tcp", bind: "127.0.0.1", port: String(10_000 + index) })),
        { protocol: "udp", bind: "127.0.0.53%lo", port: "53" },
      ], truncated: true },
      selectedTcpPorts: { state: "observed", complete: true, items: [
        { port: 2283, inUse: false }, { port: 3000, inUse: false }, { port: 8080, inUse: false },
      ] },
    },
  }, null, 2)}\n`, { mode: 0o600 });
  await chmod(hostReport, 0o600);
  const digest = "a".repeat(64);
  const args = ["init", "--project-root", root, "--id", "home", "--email", "admin@example.com", "--name", "Home Admin",
    "--host-inspection", hostReport, "--host-ip", "127.0.0.1",
    "--docmost-image", `docker.io/docmost/docmost:0.96.0@sha256:${digest}`,
    "--postgres-image", `docker.io/library/postgres:18.6@sha256:${digest}`,
    "--redis-image", `docker.io/library/redis:8.10.2@sha256:${digest}`,
    "--vaultwarden-image", `docker.io/vaultwarden/server:1.35.4@sha256:${digest}`,
    "--vaultwarden-origin", "https://vault.home.arpa", "--https-route-owner", "caddy-home",
    "--https-tls-owner", "caddy-home", "--https-route-status", "configured",
    "--https-trust", "verified-for-intended-client",
    "--homarr-network", "autostack-media_default", "--vaultwarden-route-network", "selfhost-caddy-route"];
  const noop = async () => {};
  let missingReported = false;
  try { await quiet(() => bundleCommand(["init", "--project-root", root, "--id", "partial"], { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) {
    missingReported = error instanceof Error && error.message.includes("--email") && error.message.includes("--vaultwarden-origin");
  }
  check(missingReported, "initializer did not report its remaining choice group together");
  await quiet(() => bundleCommand(args, { media: noop, immich: noop, docmost: noop, vaultwarden: noop }));
  const directory = join(root, ".selfhost", "bundles", "home");
  const bundlePath = join(directory, "household-bundle.json");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  const info = JSON.parse(await captureOutput(() => bundleCommand(["info", "--project-root", root, "--input", bundlePath], {
    media: async () => { console.log(JSON.stringify({ bind: "0.0.0.0", services: [
      { name: "Homarr", purpose: "Dashboard", url: "http://127.0.0.1:21000" },
      { name: "Jellyfin", purpose: "Movies and shows", url: "http://127.0.0.1:21001" },
      { name: "Seerr", purpose: "Requests", url: "http://127.0.0.1:21002" },
      { name: "Sonarr", purpose: "TV", url: "http://127.0.0.1:21003" },
      { name: "Radarr", purpose: "Movies", url: "http://127.0.0.1:21004" },
      { name: "Prowlarr", purpose: "Search", url: "http://127.0.0.1:21005" },
      { name: "qBittorrent", purpose: "Downloads", url: "http://127.0.0.1:21006" },
    ] })); },
    immich: noop, docmost: noop, vaultwarden: noop,
  })));
  check(info.dashboard === "http://127.0.0.1:21000/boards/personal"
    && info.mediaInfo === "available"
    && info.services.some((entry: any) => entry.name === "Immich" && entry.purpose.includes("photos"))
    && info.services.some((entry: any) => entry.name === "Vaultwarden" && entry.url === "https://vault.home.arpa")
    && info.credentialFile === null && info.status.includes("Links and purposes only")
    && info.access.includes("all host interfaces"),
  "bundle info omitted plain-language purposes, planned links, or credential-file absence");
  const legacyInfo = JSON.parse(await captureOutput(() => bundleCommand(
    ["info", "--project-root", root, "--input", bundlePath], {
      media: async () => { console.log(JSON.stringify({ bind: "127.0.0.1", services: info.services.slice(0, 7) })); },
      immich: noop, docmost: noop, vaultwarden: noop,
    },
  )));
  check(legacyInfo.access.includes("binds its seven ports to loopback")
    && !legacyInfo.access.includes("all host interfaces"),
  "bundle info mislabeled an approved legacy loopback run as all-interface");
  const hostOnlyArgs = [...args];
  hostOnlyArgs[hostOnlyArgs.indexOf("home")] = "hostonly";
  hostOnlyArgs[hostOnlyArgs.indexOf("https://vault.home.arpa")] = "https://vaultwarden.localhost:28443";
  await quiet(() => bundleCommand(hostOnlyArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop }));
  const hostOnlyInfo = JSON.parse(await captureOutput(() => bundleCommand(["info", "--project-root", root,
    "--input", join(root, ".selfhost", "bundles", "hostonly", "household-bundle.json")], {
    media: noop, immich: noop, docmost: noop, vaultwarden: noop,
  })));
  check(hostOnlyInfo.access.includes("works on this host only") && !hostOnlyInfo.access.includes("private DNS"),
    "bundle info told host-only users to configure private DNS");
  const partialInfo = JSON.parse(await captureOutput(() => bundleCommand(["info", "--project-root", root, "--input", bundlePath], {
    media: async () => { throw new Error("Docker unavailable"); },
    immich: noop, docmost: noop, vaultwarden: noop,
  })));
  check(partialInfo.mediaInfo === "unavailable" && partialInfo.dashboard === null
    && partialInfo.status.includes("Partial links only") && partialInfo.status.includes("Docker access"),
  "bundle info silently presented partial links as a complete summary");
  const incompleteMediaInfo = JSON.parse(await captureOutput(() => bundleCommand(["info", "--project-root", root, "--input", bundlePath], {
    media: async () => { console.log(JSON.stringify({ services: [
      { name: "Homarr", purpose: "Dashboard", url: "http://127.0.0.1:21000" },
    ] })); },
    immich: noop, docmost: noop, vaultwarden: noop,
  })));
  check(incompleteMediaInfo.mediaInfo === "unavailable" && incompleteMediaInfo.dashboard === null
    && incompleteMediaInfo.status.includes("Partial links only"),
  "bundle info marked an incomplete media list available");
  check(bundle.services.media.username === "admin", "initializer did not apply the admin default");
  check(new Set(Object.values(bundle.services).map((entry: any) => entry.runId)).size === 4, "run IDs are not distinct");
  const immichInput = JSON.parse(await readFile(bundle.services.immich.input, "utf8"));
  check(JSON.stringify(immichInput.integrationNetwork) === JSON.stringify({ id: "homarr", name: "autostack-media_default", owner: "external" }),
    "initializer did not record the exact externally owned Homarr network");
  const immichManifest = buildImmichManifest(immichInput) as any;
  const immichServer = immichManifest.services.find((service: any) => service.id === "immich-server");
  check(immichServer.networks.includes("homarr"), "Immich server was not attached to the Homarr integration network");
  check(immichManifest.services.filter((service: any) => service.id !== "immich-server")
    .every((service: any) => !service.networks.includes("homarr")), "an Immich dependency escaped onto the Homarr integration network");
  const vaultwardenInput = JSON.parse(await readFile(bundle.services.vaultwarden.input, "utf8"));
  check(JSON.stringify(vaultwardenInput.integrationNetwork) === JSON.stringify({ id: "vaultwarden-route", name: "selfhost-caddy-route", owner: "external" }),
    "initializer did not record the exact externally owned Vaultwarden route network");
  const vaultwardenManifest = buildHouseholdManifest(vaultwardenInput) as any;
  check(vaultwardenManifest.services.length === 1 && vaultwardenManifest.services[0].id === "vaultwarden"
    && JSON.stringify(vaultwardenManifest.services[0].networks) === JSON.stringify(["private", "vaultwarden-route"]),
  "Vaultwarden route network was not confined to the Vaultwarden-only manifest");
  const pendingArgs = withoutOptions(args, ["--https-route-status", "--https-trust", "--vaultwarden-route-network"]);
  pendingArgs[pendingArgs.indexOf("home")] = "pending-https";
  await quiet(() => bundleCommand(pendingArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop }));
  const pendingBundlePath = join(root, ".selfhost", "bundles", "pending-https", "household-bundle.json");
  const pendingBundle = JSON.parse(await readFile(pendingBundlePath, "utf8"));
  const pendingHttps = JSON.parse(await readFile(pendingBundle.services.vaultwarden.httpsPlan, "utf8"));
  check(pendingHttps.routeStatus === "pending" && pendingHttps.clientCertificateTrust === "pending",
    "initializer falsely recorded pending Vaultwarden HTTPS as ready");
  let independentPlanCalled = false;
  await quiet(() => bundleCommand(["stage", "--project-root", root, "--input", pendingBundlePath,
    "--service", "immich", "--phase", "plan"], {
    media: noop, immich: async () => { independentPlanCalled = true; }, docmost: noop, vaultwarden: noop,
  }));
  check(independentPlanCalled, "pending Vaultwarden HTTPS blocked an independent service plan");
  const pendingPlan = JSON.parse(await captureOutput(() => bundleCommand(["plan", "--project-root", root, "--input", pendingBundlePath], {
    media: noop, immich: noop, docmost: noop, vaultwarden: noop,
  })));
  let closeSetupArgs: string[] = [];
  await quiet(() => bundleCommand(["stage", "--project-root", root, "--input", pendingBundlePath,
    "--service", "immich", "--phase", "close-setup", "--approve", pendingPlan.approval,
    "--stage-approve", "CLOSE_SETUP:pending-https-immich:fixture"], {
    media: noop, immich: async (stageArgs) => { closeSetupArgs = stageArgs; }, docmost: noop, vaultwarden: noop,
  }));
  check(closeSetupArgs[0] === "close-setup" && closeSetupArgs.includes("--account-file")
    && closeSetupArgs.slice(-2).join(" ") === "--approve CLOSE_SETUP:pending-https-immich:fixture",
  "bundle did not route the separately approved Immich setup closure");
  let pendingVaultwardenRefused = false;
  try {
    await quiet(() => bundleCommand(["stage", "--project-root", root, "--input", pendingBundlePath,
      "--service", "vaultwarden", "--phase", "prepare", "--approve", pendingPlan.approval], {
      media: noop, immich: noop, docmost: noop, vaultwarden: noop,
    }));
  } catch (error) {
    pendingVaultwardenRefused = error instanceof Error && error.message.includes("private route is configured");
  }
  check(pendingVaultwardenRefused, "Vaultwarden prepare accepted pending route or certificate trust");
  let homarrReuseRefused = false;
  try {
    await quiet(() => bundleCommand(["route-network", "--project-root", root, "--input", pendingBundlePath,
      "--host-inspection", hostReport, "--network", "autostack-media_default", "--approve", pendingPlan.approval], {
      media: noop, immich: noop, docmost: noop, vaultwarden: noop,
    }));
  } catch (error) {
    homarrReuseRefused = error instanceof Error && error.message.includes("must differ from the Homarr/media network");
  }
  check(homarrReuseRefused, "route-network reused the broader Homarr media network");
  const pendingVaultInputBefore = JSON.parse(await readFile(pendingBundle.services.vaultwarden.input, "utf8"));
  check(!Object.hasOwn(pendingVaultInputBefore, "integrationNetwork"), "failed route-network revision mutated Vaultwarden input");
  const truncatedRouteReport = join(root, "host-inspection-truncated-route.json");
  const routeReport = JSON.parse(await readFile(hostReport, "utf8"));
  routeReport.workloads.dockerNetworks.truncated = true;
  await writeFile(truncatedRouteReport, `${JSON.stringify(routeReport, null, 2)}\n`, { mode: 0o600 });
  let truncatedRouteRefused = false;
  try {
    await quiet(() => bundleCommand(["route-network", "--project-root", root, "--input", pendingBundlePath,
      "--host-inspection", truncatedRouteReport, "--network", "selfhost-caddy-route", "--approve", pendingPlan.approval], {
      media: noop, immich: noop, docmost: noop, vaultwarden: noop,
    }));
  } catch (error) {
    truncatedRouteRefused = error instanceof Error && error.message.includes("complete fresh local Docker network observation");
  }
  check(truncatedRouteRefused, "route-network accepted a truncated Docker network observation");
  routeReport.workloads.dockerNetworks.truncated = false;
  routeReport.workloads.dockerNetworks.items.push({ name: "pending-https-vault-private", driver: "bridge", scope: "local" });
  const privateCollisionReport = join(root, "host-inspection-private-route.json");
  await writeFile(privateCollisionReport, `${JSON.stringify(routeReport, null, 2)}\n`, { mode: 0o600 });
  let privateCollisionRefused = false;
  try {
    await quiet(() => bundleCommand(["route-network", "--project-root", root, "--input", pendingBundlePath,
      "--host-inspection", privateCollisionReport, "--network", "pending-https-vault-private", "--approve", pendingPlan.approval], {
      media: noop, immich: noop, docmost: noop, vaultwarden: noop,
    }));
  } catch (error) {
    privateCollisionRefused = error instanceof Error && error.message.includes("must differ from its private network");
  }
  check(privateCollisionRefused, "route-network accepted the Vaultwarden private network");
  const routeRevision = JSON.parse(await captureOutput(() => bundleCommand(["route-network", "--project-root", root,
    "--input", pendingBundlePath, "--host-inspection", hostReport, "--network", "selfhost-caddy-route",
    "--approve", pendingPlan.approval], { media: noop, immich: noop, docmost: noop, vaultwarden: noop })));
  const pendingVaultInputAfter = JSON.parse(await readFile(pendingBundle.services.vaultwarden.input, "utf8"));
  check(JSON.stringify(pendingVaultInputAfter.integrationNetwork)
    === JSON.stringify({ id: "vaultwarden-route", name: "selfhost-caddy-route", owner: "external" }),
  "route-network did not add only the external Vaultwarden route network");
  check(pendingVaultInputAfter.observed.networks.some((entry: any) => entry.name === "selfhost-caddy-route")
    && pendingVaultInputAfter.observed.ports.every((entry: any) => entry.protocol === "tcp" || entry.protocol === "udp"),
    "route-network did not refresh Vaultwarden host observations from the approved inspection");
  check(routeRevision.approval !== pendingPlan.approval && routeRevision.mutation === "owner-only-vaultwarden-input",
    "route-network did not issue a changed bundle approval");
  check((await lstat(pendingBundle.services.vaultwarden.input)).mode % 0o1000 === 0o600,
    "route-network replacement is not mode 0600");
  const pendingHttpsAfterRoute = JSON.parse(await readFile(pendingBundle.services.vaultwarden.httpsPlan, "utf8"));
  check(pendingHttpsAfterRoute.routeStatus === "pending" && pendingHttpsAfterRoute.clientCertificateTrust === "pending",
    "route-network falsely claimed DNS, TLS, or client trust");
  const freshWebArgs = withoutOptions(pendingArgs, ["--homarr-network"]);
  freshWebArgs[freshWebArgs.indexOf("pending-https")] = "webfresh";
  await quiet(() => bundleCommand(freshWebArgs, {
    media: noop, immich: noop, docmost: noop, vaultwarden: noop,
  }));
  const webBundlePath = join(root, ".selfhost", "bundles", "webfresh", "household-bundle.json");
  const initialWebBundle = JSON.parse(await readFile(webBundlePath, "utf8"));
  const initialWebPlan = JSON.parse(await captureOutput(() => bundleCommand(
    ["plan", "--project-root", root, "--input", webBundlePath],
    { media: noop, immich: noop, docmost: noop, vaultwarden: noop },
  )));
  const mediaWeb = `autostack-${initialWebBundle.services.media.runId}_web`;
  const inspectFreshMedia = async (mediaArgs: string[]) => {
    if (mediaArgs[0] === "benchmark") {
      console.log(JSON.stringify({ schemaVersion: 1, kind: "selfhost-media-benchmark", mutation: false,
        runId: initialWebBundle.services.media.runId,
        workflowCompletion: { recorded: true, completed: true, status: "passed", failedStage: null } }));
      return;
    }
    console.log(JSON.stringify(mediaStatus(initialWebBundle.services.media.runId)));
  };
  const webReport = join(root, "host-inspection-media-web.json");
  const webObservation = JSON.parse(await readFile(hostReport, "utf8"));
  webObservation.workloads.dockerNetworks.items.push({ name: mediaWeb, driver: "bridge", scope: "local" });
  await writeFile(webReport, `${JSON.stringify(webObservation, null, 2)}\n`, { mode: 0o600 });
  const webArgs = ["route-network", "--service", "media-web", "--project-root", root,
    "--input", webBundlePath, "--host-inspection", webReport, "--network", mediaWeb,
    "--approve", initialWebPlan.approval];
  const webNext = JSON.parse(await captureOutput(() => bundleCommand(
    ["next", "--project-root", root, "--input", webBundlePath, "--approve", initialWebPlan.approval], {
      media: inspectFreshMedia,
      immich: noop, docmost: noop, vaultwarden: noop,
    },
  )));
  const inspectionArgs = webNext.next.command;
  const proposedReport = webNext.next.inspection.output;
  const immichSelected = JSON.parse(await readFile(initialWebBundle.services.immich.input, "utf8")).publishedPort;
  const docmostSelected = JSON.parse(await readFile(initialWebBundle.services.docmost.input, "utf8")).publishedPort;
  check(webNext.next.checkpoint === "bind-media-web"
    && JSON.stringify(inspectionArgs) === JSON.stringify(["self-host", "host", "inspect", "--output", proposedReport,
      "--limit", "50", "--check-tcp-port", String(immichSelected), "--check-tcp-port", String(docmostSelected)])
    && proposedReport.startsWith(join(root, ".selfhost", "bundles", "webfresh", "host-media-web-"))
    && !existsSync(proposedReport) && webNext.next.inspection.overwritesExisting === false
    && webNext.next.afterInspection.command.includes("media-web")
    && webNext.next.afterInspection.command.includes(proposedReport)
    && webNext.next.afterInspection.command.at(-1) === initialWebPlan.approval
    && webNext.next.afterInspection.planCommand[2] === "plan"
    && webNext.next.afterInspection.next.includes("do not reuse the old token"),
  "bundle next advanced past missing media web attachment");
  const webRun = JSON.parse(await captureOutput(() => bundleCommand(
    ["run", "--project-root", root, "--input", webBundlePath, "--approve", initialWebPlan.approval], {
      media: inspectFreshMedia,
      immich: noop, docmost: noop, vaultwarden: noop,
    },
  )));
  check(webRun.status === "manual-checkpoint" && webRun.next.checkpoint === "bind-media-web"
    && webRun.executionPerformed === false && webRun.next.inspection.output !== proposedReport
    && !existsSync(webRun.next.inspection.output),
  "bundle run advanced automatically past missing media web attachment");
  let partialWebRefused = false;
  try {
    await quiet(() => bundleCommand(webArgs, {
      media: async () => { console.log(JSON.stringify(mediaStatus(initialWebBundle.services.media.runId, 6))); },
      immich: immichCommand, docmost: docmostCommand, vaultwarden: noop,
      inspectMediaWeb: async () => {},
    }));
  } catch (error) {
    partialWebRefused = error instanceof Error && error.message.includes("seven-service media run");
  }
  check(partialWebRefused, "media-web revision accepted a partially running media stack");
  const beforeWeb = await readFile(webBundlePath, "utf8");
  let inspectedWeb = false;
  const webRevision = JSON.parse(await captureOutput(() => bundleCommand(webArgs, {
    media: async () => { console.log(JSON.stringify(mediaStatus(initialWebBundle.services.media.runId))); },
    immich: immichCommand, docmost: docmostCommand, vaultwarden: noop,
    inspectMediaWeb: async (context, network, project) => {
      inspectedWeb = context === "default" && network === mediaWeb
        && project === `autostack-${initialWebBundle.services.media.runId}`;
    },
  })));
  check(inspectedWeb && webRevision.approval !== initialWebPlan.approval
    && webRevision.mutation === "owner-only-bundle-and-app-inputs",
  "media-web revision did not inspect exact ownership and return a new approval");
  const afterWeb = await readFile(webBundlePath, "utf8");
  check(beforeWeb !== afterWeb, "media-web revision did not atomically update the bundle pointer");
  const webBundle = JSON.parse(afterWeb);
  const webImmich = JSON.parse(await readFile(webBundle.services.immich.input, "utf8"));
  const webDocmost = JSON.parse(await readFile(webBundle.services.docmost.input, "utf8"));
  check(webImmich.integrationNetwork.name === mediaWeb && webImmich.integrationNetwork.internal === true
    && webDocmost.integrationNetwork.name === mediaWeb && webDocmost.integrationNetwork.internal === true,
  "media-web revision did not bind both app inputs to the internal network");
  const afterWebNext = JSON.parse(await captureOutput(() => bundleCommand(
    ["next", "--project-root", root, "--input", webBundlePath, "--approve", webRevision.approval], {
      media: inspectFreshMedia,
      immich: noop, docmost: noop, vaultwarden: noop,
    },
  )));
  check(afterWebNext.next.checkpoint !== "bind-media-web",
    "bundle next stayed blocked after the exact media web revision");
  for (const file of [webBundle.services.immich.input, webBundle.services.docmost.input, webBundlePath]) {
    check((await lstat(file)).mode % 0o1000 === 0o600, "media-web revision did not preserve owner-only inputs");
  }
  let staleWebRefused = false;
  try {
    await quiet(() => bundleCommand(webArgs, {
      media: noop, immich: noop, docmost: noop, vaultwarden: noop,
      inspectMediaWeb: async () => {},
    }));
  } catch (error) {
    staleWebRefused = error instanceof Error && error.message.includes("exact approval");
  }
  check(staleWebRefused, "media-web revision reused a stale bundle approval");
  const partialAdoptionArgs = [...args, "--media-run-id", "existing-media"];
  partialAdoptionArgs[partialAdoptionArgs.indexOf("home")] = "partial-adoption";
  let partialAdoptionRefused = false;
  try {
    await quiet(() => bundleCommand(partialAdoptionArgs, {
      media: async () => { console.log(JSON.stringify(mediaStatus("existing-media", 6))); },
      immich: noop, docmost: noop, vaultwarden: noop,
    }));
  } catch (error) {
    partialAdoptionRefused = error instanceof Error && error.message.includes("all seven services currently running");
  }
  check(partialAdoptionRefused, "initializer adopted a media run without seven running services");
  check(!existsSync(join(root, ".selfhost", "bundles", "partial-adoption")), "partial media adoption wrote bundle files");
  const adoptionArgs = [...args, "--media-run-id", "existing-media"];
  adoptionArgs[adoptionArgs.indexOf("home")] = "adopted";
  let missingHandoffRefused = false;
  try {
    await quiet(() => bundleCommand(adoptionArgs, {
      media: async () => { console.log(JSON.stringify(mediaStatus("existing-media"))); },
      immich: noop, docmost: noop, vaultwarden: noop,
    }));
  } catch (error) {
    missingHandoffRefused = error instanceof Error && error.message.includes("no private credential handoff");
  }
  check(missingHandoffRefused && !existsSync(join(root, ".selfhost", "bundles", "adopted")),
    "initializer adopted a media run whose credential export cannot be combined");
  const mediaArtifacts = join(root, ".selfhost", "media-harness", ".sessions", "existing-media", "artifacts");
  await mkdir(mediaArtifacts, { recursive: true, mode: 0o700 });
  const syntheticMediaPassword = ["synthetic", "password"].join("-");
  const mediaHandoffServices = Object.fromEntries(
    ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"].map((name) =>
      [name, { username: "admin", password: syntheticMediaPassword, url: "http://localhost:21000",
        localUrl: "http://127.0.0.1:21000", userUrl: null, apiKey: null }]),
  );
  await writeFile(join(mediaArtifacts, "private-handoff.json"),
    `${JSON.stringify({ runId: "existing-media", services: mediaHandoffServices })}\n`, { mode: 0o600 });
  await quiet(() => bundleCommand(adoptionArgs, {
    media: async (statusArgs) => {
      check(statusArgs.join(" ").includes(`--project-root ${root}`), "adoption did not scope status to this project root");
      if (statusArgs[0] === "status") console.log(JSON.stringify(mediaStatus("existing-media")));
      else if (statusArgs[0] === "info") console.log(JSON.stringify(mediaInfo(root, "existing-media")));
    },
    immich: noop, docmost: noop, vaultwarden: noop,
  }));
  const adoptedBundlePath = join(root, ".selfhost", "bundles", "adopted", "household-bundle.json");
  const adoptedBundle = JSON.parse(await readFile(adoptedBundlePath, "utf8"));
  check(adoptedBundle.services.media.runId === "existing-media" && adoptedBundle.services.media.mode === "adopt"
    && adoptedBundle.services.media.adoptedMedia.bind === "127.0.0.1"
    && adoptedBundle.services.media.adoptedMedia.ports.length === 7,
    "initializer did not record exact media adoption");
  const adoptedPlan = JSON.parse(await captureOutput(() => bundleCommand(["plan", "--project-root", root, "--input", adoptedBundlePath], {
    media: noop, immich: noop, docmost: noop, vaultwarden: noop,
  })));
  check(adoptedPlan.mediaExposure.includes("127.0.0.1")
    && JSON.stringify(adoptedPlan.mediaPorts) === JSON.stringify([21000, 21001, 21002, 21003, 21004, 21005, 21006])
    && adoptedPlan.mediaSelection.mode === "adopt" && adoptedPlan.mediaSelection.runId === "existing-media"
    && adoptedPlan.mediaSelection.bind === "127.0.0.1",
  "adopted bundle plan did not show bound media exposure, ports, and run identity");
  let adoptedPrepareChecked = false;
  await quiet(() => bundleCommand(["stage", "--project-root", root, "--input", adoptedBundlePath,
    "--service", "media", "--phase", "prepare", "--approve", adoptedPlan.approval], {
    media: async (statusArgs) => {
      adoptedPrepareChecked = statusArgs[0] === "status" && statusArgs.includes("--json")
        && !statusArgs.includes("--username") && !statusArgs.includes("--credential-handoff");
    },
    immich: noop, docmost: noop, vaultwarden: noop,
  }));
  check(adoptedPrepareChecked, "adopted media prepare attempted to recreate or rewrite the existing run");
  for (const phase of ["apply", "resume"]) {
    let routed = false;
    let refused = false;
    try {
      await quiet(() => bundleCommand(["stage", "--project-root", root, "--input", adoptedBundlePath,
        "--service", "media", "--phase", phase, "--approve", adoptedPlan.approval,
        "--stage-approve", "synthetic-approval"], {
        media: async () => { routed = true; }, immich: noop, docmost: noop, vaultwarden: noop,
      }));
    } catch (error) {
      refused = error instanceof Error && error.message.includes("already applied");
    }
    check(refused, `adopted media ${phase} was not explicitly refused`);
    check(!routed, `adopted media ${phase} reached the media adapter`);
  }
  for (const file of ["immich-input.json", "immich-account.json", "docmost-input.json", "docmost-account.json",
    "vaultwarden-input.json", "vaultwarden-account.json", "vaultwarden-https.json", "household-bundle.json"]) {
    check((await lstat(join(directory, file))).mode % 0o1000 === 0o600, `${file} is not mode 0600`);
  }
  await quiet(() => bundleCommand(["plan", "--project-root", root, "--input", bundlePath], { media: noop, immich: noop, docmost: noop, vaultwarden: noop }));
  const recoveryBundlePlan = JSON.parse(await captureOutput(() => bundleCommand(
    ["plan", "--project-root", root, "--input", bundlePath],
    { media: noop, immich: noop, docmost: noop, vaultwarden: noop },
  )));
  let recoveryRouted = false;
  await quiet(() => bundleCommand(["stage", "--project-root", root, "--input", bundlePath,
    "--service", "docmost", "--phase", "recover-plan", "--approve", recoveryBundlePlan.approval], {
    media: noop, immich: noop, docmost: async (stageArgs) => {
      recoveryRouted = stageArgs[0] === "recover-plan" && stageArgs.includes("--account-file") && !stageArgs.includes("--approve");
    }, vaultwarden: noop,
  }));
  check(recoveryRouted, "bundle did not route approved Docmost recovery without an adapter apply token");
  const calls: string[] = [];
  const mediaStatusValue = {
    schemaVersion: 1, kind: "selfhost-media-status", provenance: "cli-managed", runId: bundle.services.media.runId,
    composeProject: `autostack-${bundle.services.media.runId}`,
    services: ["prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr"].map((service, index) => {
      let state = "running";
      if (index === 6) state = "exited";
      let health = "unavailable";
      if (index === 5) health = "healthy";
      return { service, present: true, state, running: index !== 6, health };
    }),
    summary: { expected: 7, present: 7, running: 6, healthy: 1, unhealthy: 0, starting: 0, healthUnavailable: 6 },
  };
  const pendingRaw = await captureOutput(() => bundleCommand(["status", "--project-root", root, "--input", pendingBundlePath], {
    media: async () => { console.log(JSON.stringify(mediaStatusValue)); },
    immich: noop,
    docmost: noop,
    vaultwarden: async () => { throw new Error("unprepared Vaultwarden status must not be called"); },
  }));
  const pending = JSON.parse(pendingRaw);
  const pendingVaultwarden = pending.services.find((entry: any) => entry.service === "vaultwarden");
  check(pendingVaultwarden.statusCheck === "not-prepared" && pendingVaultwarden.phase === "awaiting-private-https"
    && pending.errors.every((entry: any) => entry.service !== "vaultwarden"),
  "bundle status treated pending Vaultwarden HTTPS as an adapter failure");
  check(pending.privateHttps.ready === false && pending.privateHttps.independentlyVerifiedByBundle === false
    && pending.privateHttps.provenance === "operator-recorded-https-plan",
  "bundle status overstated pending private HTTPS evidence");
  await mkdir(join(root, ".selfhost", "vaultwarden", bundle.services.vaultwarden.runId), { recursive: true, mode: 0o700 });
  const aggregateRaw = await captureOutput(() => bundleCommand(["status", "--project-root", root, "--input", bundlePath], {
    media: async (statusArgs) => {
      calls.push("media");
      check(statusArgs.slice(-2).join(" ") === "--json yes", "bundle status did not request structured media status");
      console.log(JSON.stringify(mediaStatusValue));
    },
    immich: async () => { calls.push("immich"); process.stdout.write(`${JSON.stringify({ status: "password=immich-secret", initialized: "password=initialized-secret", setupEnabled: "password=setup-secret" })}\n`); },
    docmost: async () => { calls.push("docmost"); console.log(JSON.stringify({ health: "password=docmost-secret", checkpoint: { recorded: false } })); },
    vaultwarden: async () => { calls.push("vaultwarden"); console.log(JSON.stringify({ bootstrap: { applied: true }, accountBootstrap: { evidenceRecorded: true }, registrationClosure: { applied: false } })); },
  }));
  const aggregate = JSON.parse(aggregateRaw);
  check(JSON.stringify(calls) === JSON.stringify(["media", "immich", "docmost", "vaultwarden"]), "bundle status did not continue through every adapter");
  check(!aggregateRaw.includes("must-not-leak") && !aggregateRaw.includes("private adapter detail")
    && !aggregateRaw.includes("immich-secret") && !aggregateRaw.includes("initialized-secret")
    && !aggregateRaw.includes("setup-secret") && !aggregateRaw.includes("docmost-secret"), "bundle status leaked captured adapter output or untrusted JSON fields");
  check(aggregate.status === "incomplete" && aggregate.fullAcceptance === false && aggregate.mutation === false,
    "bundle status overstated aggregate acceptance");
  check(aggregate.privateHttps.ready === true && aggregate.privateHttps.independentlyVerifiedByBundle === false
    && aggregate.privateHttps.recordedClientTrust === "verified-for-intended-client"
    && aggregate.privateHttps.provenance === "operator-recorded-https-plan",
  "bundle status confused recorded HTTPS readiness with an independent client probe");
  check(aggregate.errors.length === 0, "bundle status rejected the structured media status");
  const mediaAggregate = aggregate.services.find((entry: any) => entry.service === "media");
  const immichAggregate = aggregate.services.find((entry: any) => entry.service === "immich");
  const docmostAggregate = aggregate.services.find((entry: any) => entry.service === "docmost");
  const vaultwardenAggregate = aggregate.services.find((entry: any) => entry.service === "vaultwarden");
  check(mediaAggregate.phase === "services-partially-running" && mediaAggregate.observations.runningServices === 6
    && mediaAggregate.observations.allRunning === false && mediaAggregate.observations.health.healthy === 1,
  "bundle status equated a returned media command with seven running services");
  check(immichAggregate.phase === "status-unavailable" && immichAggregate.observations.initialized === null
    && immichAggregate.observations.setupEnabled === null && docmostAggregate.observations.health === null,
  "bundle status did not normalize untrusted adapter fields");
  check(vaultwardenAggregate.phase === "signup-evidence-recorded-awaiting-registration-closure",
    "bundle status did not advance from browser signup evidence to registration closure");
  check(aggregate.services.every((entry: any) => entry.incompleteGates.length > 0), "bundle status omitted explicit incomplete gates");
  check(aggregate.services.every((entry: any) => !entry.incompleteGates.includes("isolated recovery"))
    && aggregate.recovery.status === "not-verified" && aggregate.recovery.selectedByBundle === false
    && aggregate.recovery.dataProtectionVerified === false,
  "bundle status selected backup protection implicitly or hid unverified recovery");
  check(aggregate.finalizationEvidence.status === "missing"
    && aggregate.finalizationEvidence.checkpointWritten === false,
  "bundle status hid missing finalization evidence or claimed a checkpoint write");
  const finalizationPath = join(root, ".selfhost", "bundles", bundle.id, "finalization-evidence.json");
  const rejectedField = ["pass", "word"].join("");
  await writeFile(finalizationPath, JSON.stringify({ [rejectedField]: "must-not-leak-finalization" }), { mode: 0o600 });
  const statusArgs = ["status", "--project-root", root, "--input", bundlePath];
  const statusOwners = { media: noop, immich: noop, docmost: noop, vaultwarden: noop };
  const malformedFinalization = await captureOutput(() => bundleCommand(statusArgs, statusOwners));
  check(JSON.parse(malformedFinalization).finalizationEvidence.status === "unavailable"
    && !malformedFinalization.includes("must-not-leak-finalization")
    && !existsSync(join(root, ".selfhost", "bundles", bundle.id, "finalization.json")),
  "bundle status leaked invalid evidence or wrote a finalization checkpoint");
  for (const evidenceStatus of ["recorded", "blocked"]) {
    const observed = JSON.parse(await captureOutput(() => bundleCommand(statusArgs, {
      ...statusOwners,
      assessFinalization: async (assessmentArgs) => {
        check(JSON.stringify(assessmentArgs) === JSON.stringify(["finalize", "status", "--project-root", root,
          "--input", bundlePath, "--evidence", finalizationPath]),
        "bundle status did not use the read-only finalizer for its exact input");
        console.log(JSON.stringify({ kind: "household-bundle-finalization-assessment", bundleId: bundle.id,
          projectRoot: root, status: evidenceStatus, independentlyVerified: false, mutation: false,
          mutationsPerformed: [], unexpected: "must-not-leak-assessment" }));
      },
    })));
    check(observed.finalizationEvidence.status === evidenceStatus
      && observed.finalizationEvidence.allRequiredDeclarationsPassing === (evidenceStatus === "recorded")
      && observed.finalizationEvidence.independentlyVerified === false
      && observed.finalizationEvidence.currentRuntimeVerified === false
      && observed.status === "incomplete" && observed.fullAcceptance === false
      && !JSON.stringify(observed).includes("must-not-leak-assessment"),
    "bundle status hid recorded declarations, leaked arbitrary fields, or promoted them to live acceptance");
  }
  const wrongFinalization = JSON.parse(await captureOutput(() => bundleCommand(statusArgs, {
    ...statusOwners,
    assessFinalization: async () => { console.log(JSON.stringify({ kind: "household-bundle-finalization-checkpoint",
      bundleId: bundle.id, projectRoot: root, status: "recorded", independentlyVerified: false,
      mutation: false, mutationsPerformed: ["owner-only-finalization-checkpoint"] })); },
  })));
  check(wrongFinalization.finalizationEvidence.status === "unavailable" && wrongFinalization.fullAcceptance === false,
    "bundle status accepted a mutating checkpoint as a read-only assessment");
  await rm(finalizationPath);
  const invalidMediaRaw = await captureOutput(() => bundleCommand(["status", "--project-root", root, "--input", bundlePath], {
    media: async () => { console.log(JSON.stringify({ ...mediaStatusValue, unexpected: "password=media-secret" })); },
    immich: async () => { console.log("{}"); },
    docmost: async () => { console.log("{}"); },
    vaultwarden: async () => { console.log("{}"); },
  }));
  const invalidMedia = JSON.parse(invalidMediaRaw);
  check(!invalidMediaRaw.includes("media-secret") && invalidMedia.errors.length === 1
    && invalidMedia.errors[0].service === "media" && invalidMedia.errors[0].reason === "invalid-adapter-status",
  "bundle status accepted or leaked a media status field outside the allowlist");
  await quiet(() => immichCommand(["plan", "--project-root", root, "--input", bundle.services.immich.input,
    "--run-id", bundle.services.immich.runId, "--account-file", bundle.services.immich.accountFile]));
  await quiet(() => docmostCommand(["plan", "--project-root", root, "--input", bundle.services.docmost.input,
    "--run-id", bundle.services.docmost.runId, "--account-file", bundle.services.docmost.accountFile]));
  validateWithComposeOwner(vaultwardenManifest);
  let refused = false;
  try { await quiet(() => bundleCommand(args, { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) { refused = error instanceof Error && error.message.includes("already exist"); }
  check(refused, "initializer replaced or reused an existing bundle directory");
  const conflictingReport = join(root, "host-inspection-conflict.json");
  const report = JSON.parse(await readFile(hostReport, "utf8"));
  report.network.selectedTcpPorts.items[1].inUse = true;
  report.network.selectedTcpPorts.items[2].inUse = true;
  await writeFile(conflictingReport, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const conflictArgs = [...args];
  conflictArgs[conflictArgs.indexOf("home")] = "other";
  conflictArgs[conflictArgs.indexOf(hostReport)] = conflictingReport;
  let conflictRefused = false;
  try { await quiet(() => bundleCommand(conflictArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) {
    conflictRefused = error instanceof Error && error.message.includes("3000, 8080")
      && error.message.includes("--docmost-port") && error.message.includes("--vaultwarden-port");
  }
  check(conflictRefused, "initializer did not stop on an observed port conflict");
  check(!existsSync(join(root, ".selfhost", "bundles", "other")), "conflicted bundle files were written");
  const remoteReport = join(root, "host-inspection-remote.json");
  report.network.selectedTcpPorts.items[1].inUse = false;
  report.network.selectedTcpPorts.items[2].inUse = false;
  report.runtime.dockerContext.current = "remote-host";
  await writeFile(remoteReport, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const remoteArgs = [...args];
  remoteArgs[remoteArgs.indexOf("home")] = "remote";
  remoteArgs[remoteArgs.indexOf(hostReport)] = remoteReport;
  let remoteRefused = false;
  try { await quiet(() => bundleCommand(remoteArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) { remoteRefused = error instanceof Error && error.message.includes("local Docker engine"); }
  check(remoteRefused, "local selected-port evidence was accepted for a remote Docker context");
  check(!existsSync(join(root, ".selfhost", "bundles", "remote")), "remote-context bundle files were written");
  const missingNetworkReport = join(root, "host-inspection-missing-network.json");
  report.runtime.dockerContext.current = "default";
  report.workloads.dockerNetworks.items = [];
  await writeFile(missingNetworkReport, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const missingNetworkArgs = [...args];
  missingNetworkArgs[missingNetworkArgs.indexOf("home")] = "missingnet";
  missingNetworkArgs[missingNetworkArgs.indexOf(hostReport)] = missingNetworkReport;
  let missingNetworkRefused = false;
  try { await quiet(() => bundleCommand(missingNetworkArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) { missingNetworkRefused = error instanceof Error && error.message.includes("not found in the complete fresh Docker network observation"); }
  check(missingNetworkRefused, "initializer accepted an unobserved Homarr network");
  check(!existsSync(join(root, ".selfhost", "bundles", "missingnet")), "unobserved-network bundle files were written");
  const missingRouteReport = join(root, "host-inspection-missing-route.json");
  report.workloads.dockerNetworks.items = [{ name: "autostack-media_default", driver: "bridge", scope: "local" }];
  await writeFile(missingRouteReport, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const missingRouteArgs = [...args];
  missingRouteArgs[missingRouteArgs.indexOf("home")] = "missingroute";
  missingRouteArgs[missingRouteArgs.indexOf(hostReport)] = missingRouteReport;
  let missingRouteRefused = false;
  try { await quiet(() => bundleCommand(missingRouteArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) {
    missingRouteRefused = error instanceof Error && error.message.includes("--vaultwarden-route-network")
      && error.message.includes("not found in the complete fresh Docker network observation");
  }
  check(missingRouteRefused, "initializer accepted an unobserved Vaultwarden route network");
  check(!existsSync(join(root, ".selfhost", "bundles", "missingroute")), "unobserved-route bundle files were written");
  const sharedNetworkReport = join(root, "host-inspection-shared-network.json");
  report.workloads.dockerNetworks.items = [{ name: "autostack-media_default", driver: "bridge", scope: "local" }];
  await writeFile(sharedNetworkReport, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const sharedNetworkArgs = [...args];
  sharedNetworkArgs[sharedNetworkArgs.indexOf("home")] = "sharednet";
  sharedNetworkArgs[sharedNetworkArgs.indexOf(hostReport)] = sharedNetworkReport;
  sharedNetworkArgs[sharedNetworkArgs.indexOf("selfhost-caddy-route")] = "autostack-media_default";
  let sharedNetworkRefused = false;
  try { await quiet(() => bundleCommand(sharedNetworkArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) { sharedNetworkRefused = error instanceof Error && error.message.includes("must differ from --homarr-network"); }
  check(sharedNetworkRefused, "initializer allowed Vaultwarden's route to reuse the Homarr media network");
  check(!existsSync(join(root, ".selfhost", "bundles", "sharednet")), "shared-network bundle files were written");
  const malformedListenerReport = join(root, "host-inspection-malformed-listener.json");
  report.network.listeningPorts.items.push({ protocol: "udp", bind: "127.0.0.53%lo%bad", port: "53" });
  await writeFile(malformedListenerReport, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const malformedListenerArgs = [...args];
  malformedListenerArgs[malformedListenerArgs.indexOf("home")] = "malformed-listener";
  malformedListenerArgs[malformedListenerArgs.indexOf(hostReport)] = malformedListenerReport;
  let malformedListenerRefused = false;
  try { await quiet(() => bundleCommand(malformedListenerArgs, { media: noop, immich: noop, docmost: noop, vaultwarden: noop })); }
  catch (error) { malformedListenerRefused = error instanceof Error && error.message.includes("unsupported listener address"); }
  check(malformedListenerRefused, "initializer accepted a malformed scoped listener address");
  check(!existsSync(join(root, ".selfhost", "bundles", "malformed-listener")), "malformed-listener bundle files were written");
  console.log("PASS bundle init inputs, conflict guards, and secret-safe aggregate status");
} finally {
  await rm(root, { recursive: true });
}
