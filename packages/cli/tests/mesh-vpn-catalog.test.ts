import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPlan, loadCatalog, stackForGoalId } from
  "../../../.agents/skills/self-host/workflows/selfhost/scripts/catalog.ts";

const catalog = await loadCatalog();
const requirements = {
  gluetun: ["reviewed-vpn-gateway-authority", "downloader-namespace-ownership", "tunnel-break-fail-closed-evidence"],
  tailscale: ["owner-issued-enrollment-file", "private-serve-target-ownership", "tailnet-acl-owner", "intended-client-route-evidence"],
  zerotier: ["reviewed-overlay-device-authority", "controller-membership-owner", "intended-client-route-evidence"],
  netbird: ["owner-selected-canonical-origin", "protocol-aware-edge-owner", "reviewed-control-plane-image-pins", "peer-enrollment-and-route-evidence"],
};
for (const [appId, required] of Object.entries(requirements)) {
  const stack = stackForGoalId(catalog, `application-${appId}`);
  assert.ok(stack);
  const plan = buildPlan(catalog, stack, { "control-plane": "none" });
  for (const capability of required) {
    assert.ok(plan.requiredCapabilities.includes(capability), `${appId} must retain ${capability} in exact-app plans`);
  }
}

const mappingUrl = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/gluetun/homarr.json", import.meta.url);
const mapping = JSON.parse(await readFile(mappingUrl, "utf8"));
assert.equal(mapping.integrationKind, "gluetun");
assert.ok(mapping.alternativeSecrets.some((keys: string[]) => keys.length === 1 && keys[0] === "apiKey"));
const gluetun = catalog.apps.find((app) => app.id === "gluetun")!;
assert.ok(gluetun.security.some((rule) => rule.includes("read-only control role") && rule.includes("unauthenticated alternative")));

const plannerPath = fileURLToPath(new URL("../../../.agents/skills/self-host/workflows/selfhost-vpn/scripts/plan-vpn.ts", import.meta.url));
function vpnPlan(input: unknown) {
  const result = Bun.spawnSync([process.execPath, plannerPath, "--json", JSON.stringify(input)]);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  return JSON.parse(result.stdout.toString());
}
const input = {
  schemaVersion: 1,
  service: { id: "qbittorrent", class: "downloader", webUiPort: 8080 },
  facts: { observedTopology: {
    downloaderSharesGatewayNamespace: true, downloaderPublishesPorts: false,
    webUiPublishedByGateway: true, gatewayHasTun: true, gatewayHasNetAdmin: true,
    killSwitchEnabled: true, lanAllowlistApplied: true,
  } },
  preferences: { mode: "gluetun", gatewayService: "gluetun", scope: ["qbittorrent"],
    lanControlCidrs: ["127.0.0.1/32"], webUiBind: "127.0.0.1", secretRefs: ["vpn.credentials"], legalContentOnly: true },
  evidence: {
    healthy: { tunnelUp: true, externalIpObserved: true, expectedTunnelEgress: true, dnsResolverObserved: true, dnsUsesTunnel: true },
    restored: { tunnelUp: true, expectedTunnelEgress: true },
    routeAudit: { noDirectDefaultRoute: true, firewallRestrictsEgress: true },
  },
};
const healthOnly = vpnPlan(input);
assert.equal(healthOnly.verification.state, "not-verified");
assert.equal(healthOnly.verification.safeClaimAllowed, false);
assert.equal(healthOnly.claims.dockerMutated, false);
const breakEvidence = {
  performed: true, recordedAt: "2026-10-03T12:00:00Z", tunnelDownObserved: true,
  downloaderStayedRunning: true, externalRequestFailed: true, dnsRequestFailed: true,
};
const complete = vpnPlan({ ...input, evidence: { ...input.evidence, tunnelBreak: breakEvidence } });
assert.equal(complete.verification.state, "network-verified");
for (const failed of ["externalRequestFailed", "dnsRequestFailed"]) {
  const leaked = vpnPlan({ ...input, evidence: { ...input.evidence, tunnelBreak: { ...breakEvidence, [failed]: false } } });
  assert.equal(leaked.verification.state, "failed");
  assert.equal(leaked.verification.safeClaimAllowed, false);
}
console.log("mesh/VPN exact-app requirements and fail-closed planner fixture passed (synthetic; no enrollment or tunnel operation)");
