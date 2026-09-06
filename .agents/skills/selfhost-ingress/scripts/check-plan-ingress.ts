#!/usr/bin/env bun

import assert from "node:assert/strict";

import { buildIngressPlan } from "./plan-ingress.ts";

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

process.stdout.write("selfhost-ingress planner checks passed\n");
