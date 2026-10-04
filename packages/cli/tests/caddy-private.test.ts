#!/usr/bin/env bun

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIngressPlan } from "../../../.agents/skills/self-host/workflows/selfhost-ingress/scripts/plan-ingress.ts";
import { renderCaddyfile } from "../../../.agents/skills/self-host/workflows/selfhost-ingress/scripts/render-caddyfile.ts";
import { caddyPrivateCommand } from "../src/caddy-private.ts";

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

const root = await mkdtemp(join(tmpdir(), "shared-private-caddy-"));
try {
  const projectId = "shared-edge";
  const directory = join(root, projectId);
  const httpsPort = 28443;
  const bindAddress = "127.0.0.1";
  const caddyImage = "docker.io/library/caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b";

  function ingressPlan(service: string, hostname: string, upstreamHost: string, upstreamPort: number, port = httpsPort) {
    return buildIngressPlan({
      schemaVersion: 1,
      service: { id: service, class: "application", internalPort: upstreamPort },
      facts: {
        ownership: { ports: [{ port, owner: projectId }] },
      },
      preferences: {
        route: "caddy-private",
        hostname,
        clientTrustPlanned: true,
        caddy: {
          owner: projectId,
          runtime: "container",
          upstreamHost,
          clientScope: "host-only",
          hostBindAddress: bindAddress,
          httpsPort: port,
          configPath: join(directory, "config"),
          dataPath: join(directory, "data"),
        },
      },
    });
  }

  const homarrPath = join(root, "homarr-caddy-plan.json");
  const jellyfinPath = join(root, "jellyfin-caddy-plan.json");
  await writeFile(homarrPath, `${JSON.stringify(ingressPlan("homarr", "homarr.localhost", "homarr", 7575), null, 2)}\n`);
  await writeFile(jellyfinPath, `${JSON.stringify(ingressPlan("jellyfin", "jellyfin.localhost", "jellyfin", 8096), null, 2)}\n`);

  const inputPath = join(root, "shared-caddy.json");
  const input = {
    schemaVersion: 1,
    project: {
      dockerContext: "default",
      id: projectId,
      owner: projectId,
      root,
      directory,
      ownership: "new",
    },
    caddyImage,
    routes: [
      { planPath: jellyfinPath, network: "jellyfin" },
      { planPath: homarrPath, network: "homarr" },
    ],
    upstreamNetworks: [
      { id: "jellyfin", name: "jellyfin-private", owner: "jellyfin", internal: true },
      { id: "homarr", name: "homarr-private", owner: "homarr", internal: true },
    ],
    observed: {
      checkedAt: new Date().toISOString(),
      project: null,
      ports: [],
      paths: [],
      networks: [
        { name: "homarr-private", owner: "homarr" },
        { name: "jellyfin-private", owner: "jellyfin" },
      ],
    },
    portObservation: {
      hostIp: bindAddress,
      port: httpsPort,
      protocol: "tcp",
      inUse: false,
      checkedAt: new Date().toISOString(),
    },
  };
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600 });
  await chmod(inputPath, 0o600);

  const plan = await capture(() => caddyPrivateCommand([
    "plan", "--project-root", root, "--input", inputPath,
  ]));
  check(plan.status === "pass" && plan.mutation === false, "shared Caddy plan was not read-only and passing");
  check(plan.access.bindAddress === bindAddress && plan.access.httpsPort === httpsPort,
    "shared Caddy plan lost its exact private high-port bind");
  check(plan.routes.length === 2 && plan.routes[0].hostname === "homarr.localhost"
    && plan.routes[1].hostname === "jellyfin.localhost", "shared routes were not deterministic");
  check(plan.manifest.services.length === 1 && plan.manifest.services[0].id === "caddy",
    "shared Caddy adapter owns more than one container");
  check(JSON.stringify(plan.manifest).includes("docker.sock") === false, "shared Caddy adapter mounted the Docker socket");
  check(plan.manifest.services[0].networks.includes("homarr")
    && plan.manifest.services[0].networks.includes("jellyfin"), "shared Caddy missed an upstream network");
  check(plan.verification.privateDns.verified === false
    && plan.verification.intendedClientCaTrust.verified === false,
  "shared Caddy plan overclaimed DNS or intended-client trust");
  check(plan.verification.privateDns.scope === "localhost-loopback-must-be-verified-on-this-host",
    "host-only Caddy plan asked for LAN DNS evidence");
  check(plan.manualSteps.some((step: string) => step.includes("no private DNS owner is needed")),
    "host-only Caddy plan still asks for a household DNS owner");
  check(plan.verification.upstreamNetworkIsolation.verified === false,
    "shared Caddy plan implied that external-network isolation was verified");
  check(typeof plan.approval === "string" && plan.approval.startsWith(`APPLY:${projectId}:`),
    "shared Caddy plan did not emit its exact apply token");
  check(!await Bun.file(directory).exists() && !await Bun.file(join(root, ".selfhost")).exists(),
    "shared Caddy plan mutated project state");

  const status = await capture(() => caddyPrivateCommand([
    "status", "--project-root", root, "--input", inputPath,
  ]));
  check(status.applied === false && status.current === false && status.liveTransport.length === 0,
    "shared Caddy status overclaimed an unapplied route");

  const changedHomarr = ingressPlan("homarr", "homarr.localhost", "homarr", 7576);
  await writeFile(homarrPath, `${JSON.stringify(changedHomarr, null, 2)}\n`);
  const changedPlan = await capture(() => caddyPrivateCommand([
    "plan", "--project-root", root, "--input", inputPath,
  ]));
  check(changedPlan.approval !== plan.approval, "shared Caddy approval was not tied to route plan content");

  let wrongApprovalRejected = false;
  try {
    await capture(() => caddyPrivateCommand([
      "apply", "--project-root", root, "--input", inputPath, "--approve", plan.approval,
    ]));
  } catch (error) {
    wrongApprovalRejected = error instanceof Error && error.message.includes("unchanged inputs");
  }
  check(wrongApprovalRejected, "shared Caddy apply accepted a stale approval");
  check(!await Bun.file(directory).exists() && !await Bun.file(join(root, ".selfhost")).exists(),
    "rejected shared Caddy apply mutated project state");

  let composeApplyCount = 0;
  let composeStopCount = 0;
  let stoppedManifest: any = null;
  const statePath = join(root, ".selfhost", "caddy-private", projectId, "state.json");
  let phaseBeforeComposeFailure = "";
  const failedComposeRuntime = {
    portAvailable: async () => {},
    curlAvailable: () => true,
    composeApply: async () => {
      composeApplyCount += 1;
      phaseBeforeComposeFailure = JSON.parse(await readFile(statePath, "utf8")).phase;
      throw new Error("synthetic Compose result failure");
    },
    proofAfterApply: async () => { throw new Error("proof must not run after Compose failure"); },
  };
  let composeFailureRecorded = false;
  try {
    await capture(() => caddyPrivateCommand([
      "apply", "--project-root", root, "--input", inputPath, "--approve", changedPlan.approval,
    ], failedComposeRuntime));
  } catch (error) {
    composeFailureRecorded = error instanceof Error && error.message.includes("synthetic Compose result failure");
  }
  check(composeFailureRecorded && composeApplyCount === 1 && phaseBeforeComposeFailure === "compose-started",
    "shared Caddy did not record conservative recovery state before Compose apply");
  const failedCheckpoint = JSON.parse(await readFile(statePath, "utf8"));
  check(failedCheckpoint.schemaVersion === 3 && failedCheckpoint.phase === "compose-started",
    "Compose failure did not retain a recoverable checkpoint");
  check(failedCheckpoint.manifest.services.length === 1
    && failedCheckpoint.manifest.services[0].secretRefs.length === 0,
  "recoverable checkpoint did not retain the exact secret-free Caddy manifest");

  await rm(jellyfinPath);
  const updatedInput = structuredClone(input);
  updatedInput.caddyImage = "docker.io/library/caddy:2.11.3-alpine@sha256:7aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b";
  await writeFile(inputPath, `${JSON.stringify(updatedInput, null, 2)}\n`);
  const changedStatus = await capture(() => caddyPrivateCommand([
    "status", "--project-root", root, "--input", inputPath,
  ]));
  check(changedStatus.current === false && changedStatus.currentInput === "unavailable-or-invalid"
    && changedStatus.checkpoint.phase === "compose-started",
  "missing referenced route plan hid the recoverable prior checkpoint");
  check(typeof changedStatus.lifecycleApprovals.down === "string"
    && changedStatus.lifecycleApprovals.down.startsWith(`STOP:${projectId}:`),
  "status did not expose an exact scoped stop approval");
  check(changedStatus.manualSteps.some((step: string) => step.includes("no private DNS owner is needed")),
    "checkpointed host-only Caddy status asked for a household DNS owner");

  const failedProofRuntime = {
    curlAvailable: () => true,
    composeApply: async () => { composeApplyCount += 1; },
    proofAfterApply: async () => { throw new Error("synthetic TLS proof failure"); },
  };
  let proofFailureRecorded = false;
  try {
    await capture(() => caddyPrivateCommand([
      "up", "--project-root", root, "--input", inputPath, "--approve", changedStatus.lifecycleApprovals.up,
    ], failedProofRuntime));
  } catch (error) {
    proofFailureRecorded = error instanceof Error && error.message.includes("synthetic TLS proof failure");
  }
  check(proofFailureRecorded && composeApplyCount === 2,
    "checkpoint-first up did not retain recovery after its TLS proof failure");
  const recoveryStatus = await capture(() => caddyPrivateCommand([
    "status", "--project-root", root, "--input", inputPath,
  ]));

  let missingStopApprovalRejected = false;
  try {
    await capture(() => caddyPrivateCommand(["down", "--project-root", root, "--input", inputPath]));
  } catch (error) {
    missingStopApprovalRejected = error instanceof Error && error.message.includes("exact --approve token");
  }
  check(missingStopApprovalRejected, "shared Caddy down mutated without exact approval");
  let wrongStopApprovalRejected = false;
  try {
    await capture(() => caddyPrivateCommand([
      "down", "--project-root", root, "--input", inputPath, "--approve", `${changedStatus.lifecycleApprovals.down}0`,
    ], { composeStop: async () => { composeStopCount += 1; } }));
  } catch (error) {
    wrongStopApprovalRejected = error instanceof Error && error.message.includes("exact approval token from status");
  }
  check(wrongStopApprovalRejected && composeStopCount === 0, "shared Caddy down accepted a stale approval");
  const stopped = await capture(() => caddyPrivateCommand([
    "down", "--project-root", root, "--input", inputPath, "--approve", recoveryStatus.lifecycleApprovals.down,
  ], {
    composeStop: async (manifest) => {
      composeStopCount += 1;
      stoppedManifest = manifest;
    },
  }));
  check(stopped.phase === "stopped" && composeStopCount === 1,
    "shared Caddy did not stop the exact checkpointed project");
  check(stoppedManifest.services[0].image === caddyImage,
    "changed route input replaced the prior manifest used for scoped stop");

  const updatedJellyfinPlan = ingressPlan("jellyfin", "jellyfin.localhost", "jellyfin", 8096);
  const updatedHomarrPlan = ingressPlan("homarr", "homarr.localhost", "homarr", 7577);
  await writeFile(jellyfinPath, `${JSON.stringify(updatedJellyfinPlan, null, 2)}\n`);
  await writeFile(homarrPath, `${JSON.stringify(updatedHomarrPlan, null, 2)}\n`);
  updatedInput.project.ownership = "verified-existing";
  updatedInput.observed = {
    checkedAt: new Date().toISOString(),
    project: { id: projectId, directory, owner: projectId },
    ports: [{ hostIp: bindAddress, published: httpsPort, protocol: "tcp", owner: projectId }],
    paths: [
      { path: join(directory, "Caddyfile"), owner: projectId },
      { path: join(directory, "config"), owner: projectId },
      { path: join(directory, "data"), owner: projectId },
    ],
    networks: [
      { name: `${projectId}-ingress`, owner: projectId },
      { name: "homarr-private", owner: "homarr" },
      { name: "jellyfin-private", owner: "jellyfin" },
    ],
  };
  updatedInput.portObservation.checkedAt = new Date().toISOString();
  await writeFile(inputPath, `${JSON.stringify(updatedInput, null, 2)}\n`);
  const updatePlan = await capture(() => caddyPrivateCommand([
    "plan", "--project-root", root, "--input", inputPath,
  ]));
  const successfulRuntime = {
    portAvailable: async () => {},
    curlAvailable: () => true,
    composeApply: async () => { composeApplyCount += 1; },
    proofAfterApply: async (checkpoint: any) => ({
      caSha256: "f".repeat(64),
      transportProofs: checkpoint.routes.map((route: any) => ({
        hostname: route.hostname,
        origin: route.origin,
        method: "curl-cacert-resolve",
        verified: true,
        httpStatus: 502,
        verifiedAt: new Date().toISOString(),
      })),
    }),
  };
  const caddyfilePath = join(directory, "Caddyfile");
  await writeFile(caddyfilePath, "malformed third-party Caddyfile\n");
  let malformedCaddyfileRejected = false;
  try {
    await capture(() => caddyPrivateCommand([
      "apply", "--project-root", root, "--input", inputPath, "--approve", updatePlan.approval,
    ], successfulRuntime));
  } catch (error) {
    malformedCaddyfileRejected = error instanceof Error && error.message.includes("retained and newly approved content");
  }
  check(malformedCaddyfileRejected && composeApplyCount === 2,
    "stopped-route update accepted unapproved third Caddyfile content");

  const approvedUpdatedCaddyfile = renderCaddyfile([updatedHomarrPlan, updatedJellyfinPlan]);
  await writeFile(caddyfilePath, approvedUpdatedCaddyfile);
  let oldUpRejectedAfterSwap = false;
  try {
    await capture(() => caddyPrivateCommand([
      "up", "--project-root", root, "--input", inputPath, "--approve", stopped.nextApprovals.up,
    ], successfulRuntime));
  } catch (error) {
    oldUpRejectedAfterSwap = error instanceof Error && error.message.includes("approved checkpoint");
  }
  check(oldUpRejectedAfterSwap && composeApplyCount === 2,
    "old checkpoint restarted after the approved new Caddyfile was swapped into place");
  const stoppedAfterSwap = await capture(() => caddyPrivateCommand([
    "down", "--project-root", root, "--input", inputPath, "--approve", stopped.nextApprovals.down,
  ], { composeStop: async () => { composeStopCount += 1; } }));
  check(stoppedAfterSwap.phase === "stopped" && composeStopCount === 2,
    "old checkpoint could not remain safely stopped after the new Caddyfile swap");

  let releaseConcurrentApply = () => {};
  let signalConcurrentApply = () => {};
  const concurrentApplyEntered = new Promise<void>((resolve) => { signalConcurrentApply = resolve; });
  const concurrentApplyRelease = new Promise<void>((resolve) => { releaseConcurrentApply = resolve; });
  const concurrentApplyRuntime = {
    ...successfulRuntime,
    composeApply: async () => {
      composeApplyCount += 1;
      signalConcurrentApply();
      await concurrentApplyRelease;
    },
  };
  const updatePromise = capture(() => caddyPrivateCommand([
    "apply", "--project-root", root, "--input", inputPath, "--approve", updatePlan.approval,
  ], concurrentApplyRuntime));
  await concurrentApplyEntered;
  let concurrentApplyDownRejected = false;
  try {
    await caddyPrivateCommand([
      "down", "--project-root", root, "--input", inputPath, "--approve", stoppedAfterSwap.nextApprovals.down,
    ], { composeStop: async () => { composeStopCount += 1; } });
  } catch (error) {
    concurrentApplyDownRejected = error instanceof Error && error.message.includes("lifecycle is locked");
  }
  releaseConcurrentApply();
  check(concurrentApplyDownRejected && composeStopCount === 2,
    "concurrent down crossed the same-project apply lifecycle lock");
  const updated = await updatePromise;
  check(updated.status === "applied-transport-only" && composeApplyCount === 3,
    "approved stopped-route update did not apply the changed route");
  const updatedCheckpoint = JSON.parse(await readFile(statePath, "utf8"));
  check(updatedCheckpoint.phase === "verified"
    && updatedCheckpoint.manifest.services[0].image === updatedInput.caddyImage,
  "updated route checkpoint did not retain the new exact manifest");
  check(typeof updated.lifecycleApprovals.up === "string" && typeof updated.lifecycleApprovals.down === "string",
    "successful apply did not expose approval-gated lifecycle tokens");

  let missingUpApprovalRejected = false;
  try {
    await capture(() => caddyPrivateCommand(["up", "--project-root", root, "--input", inputPath]));
  } catch (error) {
    missingUpApprovalRejected = error instanceof Error && error.message.includes("exact --approve token");
  }
  check(missingUpApprovalRejected, "shared Caddy up mutated without exact approval");
  let releaseConcurrentUp = () => {};
  let signalConcurrentUp = () => {};
  const concurrentUpEntered = new Promise<void>((resolve) => { signalConcurrentUp = resolve; });
  const concurrentUpRelease = new Promise<void>((resolve) => { releaseConcurrentUp = resolve; });
  const concurrentUpRuntime = {
    ...successfulRuntime,
    composeApply: async () => {
      composeApplyCount += 1;
      signalConcurrentUp();
      await concurrentUpRelease;
    },
  };
  const restartPromise = capture(() => caddyPrivateCommand([
    "up", "--project-root", root, "--input", inputPath, "--approve", updated.lifecycleApprovals.up,
  ], concurrentUpRuntime));
  await concurrentUpEntered;
  let concurrentUpDownRejected = false;
  try {
    await caddyPrivateCommand([
      "down", "--project-root", root, "--input", inputPath, "--approve", updated.lifecycleApprovals.down,
    ], { composeStop: async () => { composeStopCount += 1; } });
  } catch (error) {
    concurrentUpDownRejected = error instanceof Error && error.message.includes("lifecycle is locked");
  }
  releaseConcurrentUp();
  check(concurrentUpDownRejected && composeStopCount === 2,
    "concurrent down crossed the same-project up lifecycle lock");
  const restarted = await restartPromise;
  check(restarted.phase === "verified" && composeApplyCount === 4,
    "shared Caddy up did not use its exact lifecycle approval");

  await writeFile(inputPath, "{invalid-json\n");
  const invalidInputStatus = await capture(() => caddyPrivateCommand([
    "status", "--project-root", root, "--input", inputPath, "--checkpoint", projectId,
  ]));
  check(invalidInputStatus.currentInput === "unavailable-or-invalid"
    && invalidInputStatus.checkpoint.inputPath === inputPath,
  "explicit checkpoint recovery did not survive an invalid adapter input");
  let unrelatedCheckpointRejected = false;
  try {
    await capture(() => caddyPrivateCommand([
      "down", "--project-root", root, "--checkpoint", "other-edge",
      "--approve", invalidInputStatus.lifecycleApprovals.down,
    ], { composeStop: async () => { composeStopCount += 1; } }));
  } catch (error) {
    unrelatedCheckpointRejected = error instanceof Error && error.message.includes("checkpoint from apply");
  }
  check(unrelatedCheckpointRejected && composeStopCount === 2,
    "explicit checkpoint selection could stop an unrelated project");
  const lifecycleLockPath = join(root, ".selfhost", "caddy-private", projectId, "lifecycle.lock");
  await writeFile(lifecycleLockPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: "shared-private-caddy-lifecycle-lock",
    action: "down",
    pid: 999999,
    startedAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  let staleLockRejected = false;
  try {
    await caddyPrivateCommand([
      "down", "--project-root", root, "--checkpoint", projectId,
      "--approve", invalidInputStatus.lifecycleApprovals.down,
    ], { composeStop: async () => { composeStopCount += 1; } });
  } catch (error) {
    staleLockRejected = error instanceof Error && error.message.includes("manually removing a stale lock");
  }
  check(staleLockRejected && composeStopCount === 2 && await Bun.file(lifecycleLockPath).exists(),
    "stale lifecycle lock was ignored or removed automatically");
  await rm(lifecycleLockPath);
  const stoppedInvalidInput = await capture(() => caddyPrivateCommand([
    "down", "--project-root", root, "--input", inputPath, "--checkpoint", projectId,
    "--approve", invalidInputStatus.lifecycleApprovals.down,
  ], { composeStop: async () => { composeStopCount += 1; } }));
  check(stoppedInvalidInput.phase === "stopped" && composeStopCount === 3,
    "invalid-input recovery did not require and use the exact stop approval");

  const lowPortPlanPath = join(root, "low-port.json");
  await writeFile(lowPortPlanPath, `${JSON.stringify(ingressPlan("homarr", "low.localhost", "homarr", 7575, 443), null, 2)}\n`);
  const lowPortInputPath = join(root, "low-port-input.json");
  const lowPortInput = structuredClone(input);
  lowPortInput.routes = [{ planPath: lowPortPlanPath, network: "homarr" }];
  lowPortInput.upstreamNetworks = [{ id: "homarr", name: "homarr-private", owner: "homarr", internal: true }];
  lowPortInput.observed.networks = [{ name: "homarr-private", owner: "homarr" }];
  lowPortInput.portObservation.port = 443;
  await writeFile(lowPortInputPath, `${JSON.stringify(lowPortInput, null, 2)}\n`, { mode: 0o600 });
  await chmod(lowPortInputPath, 0o600);
  let lowPortRejected = false;
  try {
    await capture(() => caddyPrivateCommand([
      "plan", "--project-root", root, "--input", lowPortInputPath,
    ]));
  } catch (error) {
    lowPortRejected = error instanceof Error && error.message.includes("unprivileged high HTTPS port");
  }
  check(lowPortRejected, "shared Caddy adapter accepted port 443 despite the high-port boundary");

  process.stdout.write("shared private-Caddy CLI checks passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
