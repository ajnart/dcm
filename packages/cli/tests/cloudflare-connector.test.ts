import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { cloudflareConnector, cloudflareReadinessObservation, cloudflareTokenIdentity,
  cloudflareDenyAllConfiguration, cloudflareConfigurationRecheck } from
  "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/cloudflare-tunnel/connector.ts";

const catalog = new URL("../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/cloudflare-tunnel/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", catalog), "utf8"));
assert.equal(manifest.image.reference, cloudflareConnector.imageTag);
assert.equal(manifest.support.automation, "guided");
assert.deepEqual(manifest.frontend, { kind: "none" });
const homarr = JSON.parse(readFileSync(new URL("homarr.json", catalog), "utf8"));
// Mapping schema uses tileOnly for integration gaps; frontend:none prevents a fictitious app URL.
assert.equal(homarr.tileOnly, true);
assert.equal(homarr.integrationKind, null);
assert.deepEqual(homarr.widgets, []);
assert.equal(cloudflareConnector.installable, false);
assert.equal(cloudflareConnector.execution.publishTargetPort, null);
assert.equal(cloudflareConnector.enrollment.source, "owner-file");
assert.equal(cloudflareConnector.enrollment.payloadIncluded, false);
assert.deepEqual(cloudflareConnector.readiness.command,
  ["cloudflared", "tunnel", "--metrics", "127.0.0.1:2000", "ready"]);
assert.equal(cloudflareConnector.pendingLocalBranch.privateNetworkRouting, "disabled");
assert.equal(cloudflareConnector.pendingLocalBranch.providerWrites, "none");
assert.ok(cloudflareConnector.pendingLocalBranch.prerequisites.includes(
  "actual-mounted-credential-readability-under-selected-runtime-user-and-daemon-mapping"));
assert.ok(cloudflareConnector.pendingLocalBranch.prerequisites.includes(
  "separate-exact-public-route-dns-tls-auth-approval"));
assert.equal(existsSync(new URL("recipe.json", catalog)), false, "No token-only route may bypass pre-start route review");
assert.equal(existsSync(new URL("derived-recipe-adapter.json", catalog)), false,
  "No installer may activate without consumed mount-readability and public-route gates");
const body = { status: 200, readyConnections: 4, connectorId: "11111111-2222-4333-8444-555555555555" };
const observed = cloudflareReadinessObservation(200, body);
assert.equal(observed.edgeConnected, true);
assert.equal(observed.tunnelIdentityVerified, false);
assert.equal(observed.privateRoutesVerified, false);
assert.equal(observed.intendedClientVerified, false);
assert.equal(observed.setupReady, false);
assert.equal(cloudflareReadinessObservation(503, { ...body, status: 503, readyConnections: 0 }).edgeConnected, false);
for (const invalid of [null, [], {}, { ...body, status: 503 }, { ...body, readyConnections: 0 },
  { ...body, readyConnections: -1 }, { ...body, readyConnections: 1.5 },
  { ...body, connectorId: "not-an-id" }, { ...body, connectorId: "00000000-0000-0000-0000-000000000000" },
  { ...body, tunnelId: body.connectorId }]) {
  assert.throws(() => cloudflareReadinessObservation(200, invalid), /malformed|contradictory/);
}
assert.throws(() => cloudflareReadinessObservation(503, { ...body, status: 503 }), /contradictory/);
assert.throws(() => cloudflareReadinessObservation(204, { ...body, status: 204 }), /malformed/);

// Synthetic bytes only. No account, tunnel, or real Cloudflare credential is created/read.
const expected = { accountId: "a".repeat(32), tunnelId: body.connectorId };
const token = { a: expected.accountId, t: expected.tunnelId, s: Buffer.alloc(32, 7).toString("base64") };
function tokenBytes(value: unknown) { return Buffer.from(`${Buffer.from(JSON.stringify(value)).toString("base64")}\n`); }
assert.deepEqual(cloudflareTokenIdentity(tokenBytes(token)), expected);
assert.deepEqual(cloudflareTokenIdentity(tokenBytes({ ...token, e: "" })), expected);
for (const invalid of [{ ...token, s: "" }, { ...token, s: "!!!!" }, { ...token, a: "bad" },
  { ...token, t: "00000000-0000-0000-0000-000000000000" }, { ...token, e: "alternate-edge.example" },
  { ...token, unexpected: "secret-sentinel" }, { a: token.a, t: token.t }, null, []]) {
  assert.throws(() => cloudflareTokenIdentity(tokenBytes(invalid)), /pre-start review/);
}
assert.throws(() => cloudflareTokenIdentity(Buffer.alloc(4097)), /pre-start review/);
assert.throws(() => cloudflareTokenIdentity(Buffer.from("not-base64")), /pre-start review/);
const apiResponse = { success: true, errors: [], messages: [], result: {
  account_id: expected.accountId, tunnel_id: expected.tunnelId, source: "cloudflare", version: 1,
  config: { ingress: [{ service: "http_status:404" }] } } };
const review = cloudflareDenyAllConfiguration(apiResponse, expected);
assert.equal(review.httpOriginConfigured, false);
assert.equal(review.privateRoutesVerified, false);
assert.equal(review.tokenAccepted, false);
assert.equal(review.applyAuthorized, false);
assert.equal(review.setupReady, false);
assert.equal(JSON.stringify(review).includes(token.s), false);
assert.deepEqual(cloudflareConfigurationRecheck(review, apiResponse, expected), review);
assert.deepEqual(cloudflareDenyAllConfiguration({ ...apiResponse, result: {
  ...apiResponse.result, created_at: "2026-10-03T00:00:00Z" } }, expected), review);
for (const changed of [{ version: 2 }, { version: 1.5 }, { version: -1 }, { version: 2147483648 },
  { source: "local" }, { account_id: "b".repeat(32) }, { tunnel_id: "22222222-2222-4333-8444-555555555555" },
  { config: { ingress: [{ hostname: "public.example", service: "http://homarr:7575" }, { service: "http_status:404" }] } },
  { config: { ingress: [{ service: "http://homarr:7575" }] } },
  { config: { ingress: [{ service: "http_status:404", path: "/private" }] } },
  { config: { ingress: [{ service: "http_status:404" }], "warp-routing": {} } },
  { config: { ingress: [{ service: "http_status:404" }], originRequest: {} } },
  { config: { ingress: [] } }, { config: { ingress: [{ service: "http_status:404" }], futureRoute: true } }]) {
  assert.throws(() => cloudflareConfigurationRecheck(review,
    { ...apiResponse, result: { ...apiResponse.result, ...changed } }, expected), /pre-start review/);
}
for (const changed of [{ success: false }, { errors: [{ message: "secret-sentinel" }] },
  { messages: [{ message: "secret-sentinel" }] }, { future: true }]) {
  assert.throws(() => cloudflareDenyAllConfiguration({ ...apiResponse, ...changed }, expected), (error: Error) => {
    assert.equal(error.message.includes("secret-sentinel"), false);
    return /pre-start review/.test(error.message);
  });
}
assert.throws(() => cloudflareConfigurationRecheck({ ...review, configurationSha256: "0".repeat(64) },
  apiResponse, expected), /pre-start review/);
console.log("Cloudflare identity, exact deny-all pre-start recheck and readiness fixture passed; no live enrollment or apply authority");
