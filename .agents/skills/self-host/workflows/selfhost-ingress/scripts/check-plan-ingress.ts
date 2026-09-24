#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIngressPlan } from "./plan-ingress.ts";
import { renderCaddyfile } from "./render-caddyfile.ts";

function publicReverseProxyInput(serviceId) {
  const hostname = `${serviceId}.example.com`;
  return {
    schemaVersion: 1,
    service: {
      id: serviceId,
      class: "application",
      directBindings: [
        { address: "127.0.0.1", port: 7575, internetReachable: false },
      ],
    },
    facts: {
      existingIngress: [
        {
          kind: "caddy",
          owner: "edge-team",
          lifecycleOwner: "edge-team",
          routeContract: "managed-caddyfile",
          network: "edge",
          acceptsRoutes: true,
          ports: [80, 443],
        },
      ],
      ownership: {
        ports: [
          { port: 80, owner: "edge-team" },
          { port: 443, owner: "edge-team" },
        ],
        dns: [{ zone: "example.com", owner: "dns-team" }],
        tls: [{ hostname, owner: "edge-team" }],
      },
    },
    preferences: {
      route: "reverse-proxy",
      hostname,
      desiredOwner: "edge-team",
      publicApproved: true,
      authentication: {
        mode: "oidc",
        owner: "identity-team",
        approved: true,
      },
      secretRefs: [],
    },
  };
}

const missingContract = buildIngressPlan(publicReverseProxyInput("homarr"));
assert.equal(missingContract.status, "blocked");
assert.deepEqual(
  missingContract.gates.find((gate) => gate.id === "homarr-native-mcp-private"),
  {
    id: "homarr-native-mcp-private",
    status: "blocked",
    detail: "Declare preferences.nativeMcp.publicAccess as deny and choose privateBridgeRoute as loopback, lan, or private-tailnet.",
  },
);
assert.deepEqual(missingContract.requiredEvidence, [
  {
    id: "homarr-native-mcp-private",
    capability: "homarr",
    sourceClass: "network",
    probeClass: "native-mcp-public-deny",
    expectedClass: "private",
  },
]);

const approvedInput = publicReverseProxyInput("homarr");
approvedInput.preferences.nativeMcp = {
  publicAccess: "deny",
  privateBridgeRoute: "loopback",
};
const approved = buildIngressPlan(approvedInput);
assert.equal(approved.status, "pass");
assert.equal(
  approved.gates.find((gate) => gate.id === "homarr-native-mcp-private").status,
  "pass",
);
assert.deepEqual(approved.route.nativeMcp, {
  path: "/api/mcp",
  publicAccess: "deny",
  privateBridgeRoute: "loopback",
});
assert.equal(
  approved.route.steps.includes("Expose the Homarr dashboard while denying /api/mcp at the public edge."),
  true,
);
assert.equal(
  approved.verification.some((obligation) => obligation.includes("homarr-native-mcp-private")),
  true,
);

const unsupportedInput = publicReverseProxyInput("homarr");
unsupportedInput.preferences.nativeMcp = {
  publicAccess: "allow",
  privateBridgeRoute: "lan",
};
const unsupported = buildIngressPlan(unsupportedInput);
assert.equal(unsupported.status, "conflict");
assert.equal(
  unsupported.conflicts.some((item) => item.id === "homarr-native-mcp-public-route"),
  true,
);

const privateHomarr = buildIngressPlan({
  schemaVersion: 1,
  service: { id: "homarr", class: "application" },
  facts: {},
  preferences: {},
});
assert.equal(privateHomarr.status, "pass");
assert.equal(privateHomarr.gates.some((gate) => gate.id === "homarr-native-mcp-private"), false);
assert.deepEqual(privateHomarr.requiredEvidence, []);
assert.equal(Object.hasOwn(privateHomarr.route, "nativeMcp"), false);

const publicJellyfin = buildIngressPlan(publicReverseProxyInput("jellyfin"));
assert.equal(publicJellyfin.status, "pass");
assert.equal(publicJellyfin.gates.some((gate) => gate.id === "homarr-native-mcp-private"), false);
assert.deepEqual(publicJellyfin.requiredEvidence, []);
assert.equal(Object.hasOwn(publicJellyfin.route, "nativeMcp"), false);

const privateCaddyInput = {
  schemaVersion: 1,
  service: { id: "homarr", class: "application", internalPort: 7575 },
  facts: {
    privateDns: {
      hostname: "homarr.home.arpa",
      owner: "home-dns",
      resolvesToPrivateAddress: true,
    },
    ownership: { ports: [{ port: 443, owner: "home-stack" }] },
  },
  preferences: {
    route: "caddy-private",
    hostname: "homarr.home.arpa",
    clientTrustPlanned: true,
    caddy: {
      owner: "home-stack",
      runtime: "container",
      upstreamHost: "homarr",
      clientScope: "lan",
      hostBindAddress: "192.168.1.10",
      configPath: "/srv/home-stack/caddy/config",
      dataPath: "/srv/home-stack/caddy/data",
    },
  },
};
const privateCaddy = buildIngressPlan(privateCaddyInput);
assert.equal(privateCaddy.status, "pass");
assert.equal(privateCaddy.route.exposure, "private");
assert.equal(privateCaddy.gates.some((gate) => gate.id === "public-approval"), false);
assert.equal(privateCaddy.route.caddy.dockerSocket, "forbidden");
assert.equal(privateCaddy.route.caddy.composePublishAddress, "192.168.1.10");
assert.equal(privateCaddy.route.caddy.httpsPort, 443);
assert.equal(privateCaddy.route.caddy.privateUrl, "https://homarr.home.arpa");
assert.equal(
  privateCaddy.route.applicationRequirements.some((requirement) => requirement.includes("Docker DNS/internal HTTP")),
  true,
);
assert.equal(
  renderCaddyfile(privateCaddy),
  "{\n\tauto_https disable_redirects\n}\n\nhomarr.home.arpa {\n\ttls internal\n\treverse_proxy homarr:7575\n}\n",
);

const wrongContainerUpstream = structuredClone(privateCaddyInput);
wrongContainerUpstream.preferences.caddy.upstreamHost = "localhost";
const blockedContainerUpstream = buildIngressPlan(wrongContainerUpstream);
assert.equal(blockedContainerUpstream.status, "blocked");
assert.equal(
  blockedContainerUpstream.gates.find((gate) => gate.id === "caddy-upstream").status,
  "blocked",
);

const hostCaddyInput = structuredClone(privateCaddyInput);
hostCaddyInput.preferences.caddy.runtime = "host";
hostCaddyInput.preferences.caddy.upstreamHost = "127.0.0.1";
hostCaddyInput.preferences.caddy.clientScope = "host-only";
hostCaddyInput.preferences.caddy.hostBindAddress = "127.0.0.1";
const hostCaddy = buildIngressPlan(hostCaddyInput);
assert.equal(hostCaddy.status, "pass");
assert.equal(
  renderCaddyfile(hostCaddy),
  "{\n\tauto_https disable_redirects\n}\n\nhomarr.home.arpa {\n\tbind 127.0.0.1\n\ttls internal\n\treverse_proxy 127.0.0.1:7575\n}\n",
);

const publicBindInput = structuredClone(privateCaddyInput);
publicBindInput.preferences.caddy.hostBindAddress = "0.0.0.0";
const publicBind = buildIngressPlan(publicBindInput);
assert.equal(publicBind.status, "blocked");
assert.equal(publicBind.gates.find((gate) => gate.id === "caddy-private-bind").status, "blocked");
const tamperedPublicBind = structuredClone(privateCaddy);
tamperedPublicBind.route.caddy.hostBindAddress = "8.8.8.8";
tamperedPublicBind.route.caddy.composePublishAddress = "8.8.8.8";
assert.throws(() => renderCaddyfile(tamperedPublicBind), /host bind must be loopback/);

const immichInput = structuredClone(privateCaddyInput);
immichInput.service.id = "immich";
immichInput.service.internalPort = 2283;
immichInput.facts.privateDns.hostname = "immich.home.arpa";
immichInput.preferences.hostname = "immich.home.arpa";
immichInput.preferences.caddy.upstreamHost = "immich-server";
const immich = buildIngressPlan(immichInput);
assert.equal(immich.status, "pass");
assert.equal(
  immich.route.applicationRequirements.some((requirement) => requirement.includes("unsupported subpath")),
  true,
);

const auditInput = structuredClone(privateCaddyInput);
auditInput.preferences.hostname = "homarr.audit.localhost";
auditInput.facts.privateDns.hostname = "homarr.audit.localhost";
auditInput.facts.ownership.ports = [{ port: 20443, owner: "home-stack" }];
auditInput.preferences.caddy.httpsPort = 20443;
auditInput.preferences.caddy.clientScope = "host-only";
auditInput.preferences.caddy.hostBindAddress = "127.0.0.1";
const auditHomarr = buildIngressPlan(auditInput);
assert.equal(auditHomarr.status, "pass");
assert.equal(auditHomarr.route.caddy.privateUrl, "https://homarr.audit.localhost:20443");
assert.deepEqual(auditHomarr.route.caddy.resourceOwnership, { httpsPort: 20443, owner: "home-stack", hostBindAddress: "127.0.0.1" });

const auditJellyfinInput = structuredClone(auditInput);
auditJellyfinInput.service.id = "jellyfin";
auditJellyfinInput.service.internalPort = 8096;
auditJellyfinInput.preferences.hostname = "jellyfin.audit.localhost";
auditJellyfinInput.facts.privateDns.hostname = "jellyfin.audit.localhost";
auditJellyfinInput.preferences.caddy.upstreamHost = "jellyfin";
const auditJellyfin = buildIngressPlan(auditJellyfinInput);
assert.equal(
  renderCaddyfile([auditJellyfin, auditHomarr]),
  "{\n\tauto_https disable_redirects\n}\n\nhomarr.audit.localhost:20443 {\n\ttls internal\n\treverse_proxy homarr:7575\n}\n\njellyfin.audit.localhost:20443 {\n\ttls internal\n\treverse_proxy jellyfin:8096\n}\n",
);

assert.throws(() => renderCaddyfile([auditHomarr, structuredClone(auditHomarr)]), /hostnames must be unique/);
const mixedOwner = structuredClone(auditJellyfin);
mixedOwner.route.owner = "other-owner";
mixedOwner.route.caddy.resourceOwnership.owner = "other-owner";
assert.throws(() => renderCaddyfile([auditHomarr, mixedOwner]), /must share owner/);
const unknownPlanField = structuredClone(auditHomarr);
unknownPlanField.unexpected = true;
assert.throws(() => renderCaddyfile(unknownPlanField), /exactly the documented fields/);

const cliDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "selfhost-ingress-caddy-fixture-"));
const homarrPlanPath = path.join(cliDirectory, "homarr.json");
const jellyfinPlanPath = path.join(cliDirectory, "jellyfin.json");
fs.writeFileSync(homarrPlanPath, JSON.stringify(auditHomarr));
fs.writeFileSync(jellyfinPlanPath, JSON.stringify(auditJellyfin));
const cli = Bun.spawnSync([
  process.execPath,
  fileURLToPath(new URL("./render-caddyfile.ts", import.meta.url)),
  "--inputs",
  jellyfinPlanPath,
  homarrPlanPath,
], { stdout: "pipe", stderr: "pipe" });
assert.equal(cli.exitCode, 0);
assert.equal(cli.stdout.toString(), renderCaddyfile([auditHomarr, auditJellyfin]));
fs.rmSync(cliDirectory, { recursive: true, force: true });

process.stdout.write("selfhost-ingress planner checks passed\n");
