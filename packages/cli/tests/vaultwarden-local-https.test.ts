#!/usr/bin/env bun

import { chmod, lstat, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vaultwardenLocalHttpsCommand } from "../src/vaultwarden-local-https.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

async function capture(action: () => Promise<void>): Promise<any> {
  let output = "";
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
  } finally {
    process.stdout.write = write;
  }
  return JSON.parse(output);
}

const root = await mkdtemp(join(tmpdir(), "vaultwarden-local-https-"));
try {
  const caddyImage = "docker.io/library/caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b";
  const hostInspectionPath = join(root, "host-inspection.json");
  const unrelatedListeners = Array.from({ length: 51 }, (_, index) => ({
    protocol: "tcp",
    bind: "127.0.0.1",
    port: String(10_000 + index),
  }));
  unrelatedListeners[0].bind = "127.0.0.53%lo";
  const hostInspection = {
    schemaVersion: 1,
    mode: "read-only",
    identity: { uid: process.getuid?.(), gid: process.getgid?.() },
    runtime: {
      docker: { state: "running", rootless: { state: "observed", value: false } },
      dockerContext: { state: "observed", current: "default" },
    },
    workloads: {
      dockerNetworks: {
        state: "observed",
        truncated: false,
        items: [
          { name: "bridge", driver: "bridge", scope: "local" },
          { name: "host", driver: "host", scope: "local" },
          { name: "none", driver: "null", scope: "local" },
          { name: "existing-private", driver: "bridge", scope: "local" },
        ],
      },
    },
    network: {
      lanIpv4Candidates: {
        state: "observed",
        truncated: false,
        items: [{ interface: "eth0", address: "192.168.50.10", prefixLength: 24 }],
      },
      listeningPorts: {
        state: "observed",
        truncated: unrelatedListeners.length > 50,
        items: unrelatedListeners.slice(0, 50),
      },
      selectedTcpPorts: {
        state: "observed",
        complete: true,
        items: [{ port: 28001, inUse: false }, { port: 28443, inUse: false }],
      },
    },
  };
  await writeFile(hostInspectionPath, `${JSON.stringify(hostInspection)}\n`, { mode: 0o600 });
  await chmod(hostInspectionPath, 0o600);
  const initialized = await capture(() => vaultwardenLocalHttpsCommand([
    "init",
    "--project-root", root,
    "--run-id", "generated-route",
    "--host-inspection", hostInspectionPath,
    "--caddy-image", caddyImage,
  ]));
  check(initialized.status === "created" && initialized.mutation === "owner-only-route-input", "route init did not create its bounded input");
  check(initialized.origin === "https://vaultwarden.localhost:28443", "route init did not use candidate defaults");
  check(initialized.next.includes("vaultwarden local-https plan"), "route init did not print the next plan command");
  const initializedInput = JSON.parse(await readFile(initialized.input, "utf8"));
  check((await lstat(initialized.input)).mode % 0o1000 === 0o600, "route input is not owner-only");
  check(initializedInput.project.dockerContext === "default", "route input lost the inspected Docker context");
  check(initializedInput.portObservation.port === 28443 && initializedInput.portObservation.inUse === false,
    "route input did not map exact selected-port evidence");
  check(initializedInput.observed.ports.length === 50, "route input rejected the bounded inventory from a host with more than 50 listeners");
  check(initializedInput.observed.ports[0].hostIp === "127.0.0.53", "route input did not normalize the scoped listener address");
  check(JSON.stringify(initializedInput.observed.networks) === JSON.stringify([
    { name: "bridge", owner: "external" },
    { name: "existing-private", owner: "external" },
  ]), "route input did not exclude only Docker's non-Compose host and none networks");

  const privateInitialized = await capture(() => vaultwardenLocalHttpsCommand([
    "init",
    "--project-root", root,
    "--run-id", "private-route",
    "--host-inspection", hostInspectionPath,
    "--caddy-image", caddyImage,
    "--hostname", "vaultwarden.home.arpa",
    "--bind-address", "192.168.50.10",
    "--dns-owner", "home-dns",
  ]));
  check(privateInitialized.origin === "https://vaultwarden.home.arpa:28443", "private route init lost its origin");
  check(privateInitialized.hostInspection.bindAddressObserved === "192.168.50.10",
    "private route init did not report exact bind-address evidence");
  check(privateInitialized.hostInspection.bindAddressEvidence === "host-interface-candidate",
    "private route init did not use host-interface evidence");
  const privateInput = JSON.parse(await readFile(privateInitialized.input, "utf8"));
  check(privateInput.bindAddress === "192.168.50.10" && privateInput.dnsOwner === "home-dns",
    "private route input lost its bind or DNS owner");
  check(privateInput.bindAddressObservation.interface === "eth0",
    "private route input did not preserve inspected LAN-interface evidence");
  const privatePlan = await capture(() => vaultwardenLocalHttpsCommand([
    "plan",
    "--project-root", root,
    "--run-id", "private-route",
    "--input", privateInitialized.input,
  ]));
  check(privatePlan.status === "pass" && privatePlan.mutation === false, "private route plan did not remain read-only");
  check(privatePlan.access.scope === "private-network" && privatePlan.access.bindAddress === "192.168.50.10",
    "private route plan lost its exact private bind");
  check(privatePlan.manifest.services[0].ports[0].hostIp === "192.168.50.10",
    "private route did not publish Caddy on the exact observed address");
  check(JSON.stringify(privatePlan.manifest.services[0].networks) === JSON.stringify(["private", "ingress"])
    && privatePlan.manifest.networks[0].internal === true
    && privatePlan.manifest.networks[1].internal === false,
    "Caddy needs a private upstream bridge and a separate publishable ingress bridge");
  check(privatePlan.composePlan.claims.privatePorts[0].hostIp === "192.168.50.10"
    && privatePlan.composePlan.claims.publicPorts.length === 0,
    "private route was not classified as a private Compose publication");
  check(privatePlan.verificationGates.privateDns.owner === "home-dns"
    && privatePlan.verificationGates.privateDns.verified === false,
    "private route plan overclaimed DNS verification");
  check(privatePlan.verificationGates.intendedClientCaTrust.verified === false,
    "private route plan overclaimed intended-client CA trust");

  const privateWithoutBindEvidence = structuredClone(privateInput);
  delete privateWithoutBindEvidence.bindAddressObservation;
  const privateWithoutBindEvidencePath = join(root, "private-without-bind-evidence.json");
  await writeFile(privateWithoutBindEvidencePath, `${JSON.stringify(privateWithoutBindEvidence)}\n`, { mode: 0o600 });
  let privatePlanEvidenceRequired = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "plan", "--project-root", root, "--run-id", "private-route", "--input", privateWithoutBindEvidencePath,
    ]));
  } catch (error) {
    privatePlanEvidenceRequired = error instanceof Error && error.message.includes("lacks the exact observed bind-address evidence");
  }
  check(privatePlanEvidenceRequired, "private route plan accepted an input without exact bind-address evidence");

  let publicBindRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "public-bind-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
      "--hostname", "vaultwarden.home.arpa", "--bind-address", "203.0.113.10", "--dns-owner", "home-dns",
    ]));
  } catch (error) {
    publicBindRejected = error instanceof Error && error.message.includes("observed RFC1918 LAN address");
  }
  check(publicBindRejected, "route init accepted a public bind address");

  let tailnetBindRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "tailnet-bind-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
      "--hostname", "vaultwarden.home.arpa", "--bind-address", "100.111.30.70", "--dns-owner", "home-dns",
    ]));
  } catch (error) {
    tailnetBindRejected = error instanceof Error && error.message.includes("tailnet binds need a separate private-ingress owner");
  }
  check(tailnetBindRejected, "route init silently treated an RFC6598 tailnet bind as private Compose ingress");

  let unobservedBindRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "unobserved-bind-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
      "--hostname", "vaultwarden.home.arpa", "--bind-address", "192.168.50.11", "--dns-owner", "home-dns",
    ]));
  } catch (error) {
    unobservedBindRejected = error instanceof Error && error.message.includes("does not observe bind address");
  }
  check(unobservedBindRejected, "route init accepted a private bind absent from host evidence");

  let dnsOwnerRequired = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "ownerless-private-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
      "--hostname", "vaultwarden.home.arpa", "--bind-address", "192.168.50.10",
    ]));
  } catch (error) {
    dnsOwnerRequired = error instanceof Error && error.message.includes("needs --dns-owner");
  }
  check(dnsOwnerRequired, "private route init accepted an ownerless DNS name");

  hostInspection.network.listeningPorts.items[0].bind = "127.0.0.53%lo%invalid";
  await writeFile(hostInspectionPath, `${JSON.stringify(hostInspection)}\n`);
  let malformedScopeRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "bad-scope-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
    ]));
  } catch (error) {
    malformedScopeRejected = error instanceof Error && error.message.includes("unsupported scoped listener address");
  }
  check(malformedScopeRejected, "route init accepted a malformed scoped listener address");
  hostInspection.network.listeningPorts.items[0].bind = "127.0.0.53%lo";
  await writeFile(hostInspectionPath, `${JSON.stringify(hostInspection)}\n`);
  let noClobber = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init",
      "--project-root", root,
      "--run-id", "generated-route",
      "--host-inspection", hostInspectionPath,
      "--caddy-image", caddyImage,
    ]));
  } catch (error) {
    noClobber = error instanceof Error && error.message.includes("already exists");
  }
  check(noClobber, "route init overwrote its existing input");

  hostInspection.network.selectedTcpPorts.items[1].inUse = true;
  await writeFile(hostInspectionPath, `${JSON.stringify(hostInspection)}\n`);
  let occupiedRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "occupied-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
    ]));
  } catch (error) {
    occupiedRejected = error instanceof Error && error.message.includes("is occupied");
  }
  check(occupiedRejected, "route init accepted an occupied selected port");

  hostInspection.network.selectedTcpPorts.items[1].inUse = false;
  hostInspection.workloads.dockerNetworks.truncated = true;
  await writeFile(hostInspectionPath, `${JSON.stringify(hostInspection)}\n`);
  let truncatedRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "truncated-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
    ]));
  } catch (error) {
    truncatedRejected = error instanceof Error && error.message.includes("untruncated Docker network");
  }
  check(truncatedRejected, "route init accepted truncated Docker networks");

  hostInspection.workloads.dockerNetworks.truncated = false;
  hostInspection.runtime.dockerContext.current = "remote-host";
  await writeFile(hostInspectionPath, `${JSON.stringify(hostInspection)}\n`);
  let remoteRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "remote-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
    ]));
  } catch (error) {
    remoteRejected = error instanceof Error && error.message.includes("local Docker engine");
  }
  check(remoteRejected, "route init accepted a remote Docker context");

  hostInspection.runtime.dockerContext.current = "default";
  await writeFile(hostInspectionPath, `${JSON.stringify(hostInspection)}\n`);
  await chmod(hostInspectionPath, 0o644);
  let privateModeRequired = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "public-report-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
    ]));
  } catch (error) {
    privateModeRequired = error instanceof Error && error.message.includes("mode 0600");
  }
  check(privateModeRequired, "route init accepted a non-private host inspection");

  await chmod(hostInspectionPath, 0o600);
  const old = new Date(Date.now() - 16 * 60 * 1000);
  await utimes(hostInspectionPath, old, old);
  let freshReportRequired = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "init", "--project-root", root, "--run-id", "stale-report-route",
      "--host-inspection", hostInspectionPath, "--caddy-image", caddyImage,
    ]));
  } catch (error) {
    freshReportRequired = error instanceof Error && error.message.includes("last 15 minutes");
  }
  check(freshReportRequired, "route init accepted a stale host inspection");

  const inputPath = join(root, "route.json");
  const projectId = "vault-route";
  const input = {
    schemaVersion: 1,
    project: {
      dockerContext: "default",
      id: projectId,
      owner: projectId,
      root,
      directory: join(root, projectId),
      ownership: "new",
    },
    observed: {
      checkedAt: new Date().toISOString(),
      project: null,
      ports: [],
      paths: [],
      networks: [],
    },
    caddyImage,
    portObservation: {
      hostIp: "127.0.0.1",
      port: 28443,
      protocol: "tcp",
      inUse: false,
      checkedAt: new Date().toISOString(),
    },
  };
  await writeFile(inputPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
  await chmod(inputPath, 0o600);
  const plan = await capture(() => vaultwardenLocalHttpsCommand([
    "plan",
    "--project-root", root,
    "--input", inputPath,
    "--run-id", "local-route",
  ]));
  check(plan.status === "pass" && plan.mutation === false, "route plan did not remain read-only");
  check(plan.origin === "https://vaultwarden.localhost:28443", "route defaults changed");
  check(plan.manifest.services.length === 1 && plan.manifest.services[0].id === "caddy", "route owns more than Caddy");
  check(plan.manifest.services[0].ports[0].hostIp === "127.0.0.1", "route is not loopback-only");
  check(plan.manifest.services[0].ports[0].published === 28443, "route did not use the selected high port");
  check(plan.manifest.networks[0].internal === true, "route network is not private");
  check(JSON.stringify(plan.manifest).includes("docker.sock") === false, "route mounted the Docker socket");
  check(plan.integrationNetwork.name === `${projectId}-private`, "route did not report its shared network");
  check(plan.proofScope.privateDns === "not-proven-by-transport-check", "plan overclaimed private DNS proof");
  check(plan.proofScope.intendedClientTrust === "not-proven-by-transport-check", "plan overclaimed client trust");
  check(plan.access.scope === "host-only" && plan.access.bindAddress === "127.0.0.1", "route defaults stopped being host-only");
  check(plan.verificationGates.privateDns.required === false, "host-only route unexpectedly requires private DNS");
  check(plan.verificationGates.intendedClientCaTrust.verified === false, "host-only route overclaimed client trust");
  check(typeof plan.approval === "string" && plan.approval.startsWith(`APPLY:${projectId}:`), "route approval is invalid");

  const specialNetworkInput = structuredClone(input);
  specialNetworkInput.observed.networks = [{ name: "host", owner: "external" }];
  await writeFile(inputPath, `${JSON.stringify(specialNetworkInput)}\n`);
  const specialNetworkPlan = await capture(() => vaultwardenLocalHttpsCommand([
    "plan", "--project-root", root, "--input", inputPath, "--run-id", "special-network-route",
  ]));
  check(specialNetworkPlan.status === "pass", "route plan rejected an observed Docker built-in network");

  const conflictInput = structuredClone(input);
  conflictInput.observed.networks = [{ name: `${projectId}-private`, owner: "external" }];
  await writeFile(inputPath, `${JSON.stringify(conflictInput)}\n`);
  let conflictReason = "";
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "plan", "--project-root", root, "--input", inputPath, "--run-id", "conflict-route",
    ]));
  } catch (error) {
    if (error instanceof Error) {
      conflictReason = error.message;
    }
  }
  check(conflictReason.includes("conflict network:network-already-observed"),
    "route plan did not expose the bounded structured Compose conflict");
  check(!conflictReason.includes(root), "route plan exposed a Compose conflict resource path");

  await writeFile(inputPath, `${JSON.stringify(input)}\n`);

  const localInput = structuredClone(input);
  localInput.hostname = "localhost";
  localInput.httpsPort = 29443;
  localInput.portObservation.port = 29443;
  await writeFile(inputPath, `${JSON.stringify(localInput)}\n`);
  const localhostPlan = await capture(() => vaultwardenLocalHttpsCommand([
    "plan",
    "--project-root", root,
    "--input", inputPath,
    "--run-id", "localhost-route",
  ]));
  check(localhostPlan.origin === "https://localhost:29443", "explicit localhost route was rejected");

  localInput.portObservation.checkedAt = "2025-01-01T00:00:00Z";
  await writeFile(inputPath, `${JSON.stringify(localInput)}\n`);
  const unappliedStatus = await capture(() => vaultwardenLocalHttpsCommand([
    "status",
    "--project-root", root,
    "--input", inputPath,
    "--run-id", "localhost-route",
  ]));
  check(unappliedStatus.applied === false, "status required a fresh planning observation");

  localInput.httpsPort = 443;
  localInput.portObservation.port = 443;
  await writeFile(inputPath, `${JSON.stringify(localInput)}\n`);
  let protectedPortRejected = false;
  try {
    await capture(() => vaultwardenLocalHttpsCommand([
      "plan",
      "--project-root", root,
      "--input", inputPath,
      "--run-id", "bad-route",
    ]));
  } catch (error) {
    protectedPortRejected = error instanceof Error && error.message.includes("must not be 80 or 443");
  }
  check(protectedPortRejected, "route accepted protected port 443");
  console.log("PASS Vaultwarden local HTTPS initializes and plans one pinned, socket-free Caddy route without DNS or trust overclaims");
} finally {
  await rm(root, { recursive: true, force: true });
}
