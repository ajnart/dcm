import { createHash } from "node:crypto";
import type { SharedPrestartContext } from "../../types/pre-start.ts";
import { assertActualCloudflareProviderObservation, type CloudflareProviderObservation } from "../../../../../../../../../packages/cli/src/control-panel/setup-cloudflare-provider.ts";

/** Remote-token review remains non-installable; the separately derived local
 * JSON recipe uses its consumed provider/public pre-start contract. */
export const cloudflareConnector = {
  appId: "cloudflare-tunnel",
  imageTag: "cloudflare/cloudflared:2026.9.1",
  imageSource: "https://github.com/cloudflare/cloudflared/blob/2026.9.1/Dockerfile",
  tokenSource: "https://developers.cloudflare.com/tunnel/reference/run-parameters/",
  readinessSource: "https://github.com/cloudflare/cloudflared/blob/2026.9.1/metrics/readiness.go",
  identitySource: "https://github.com/cloudflare/cloudflared/blob/2026.9.1/connection/connection.go",
  configurationSource: "https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/get/",
  authority: "read-only-plan",
  installable: false,
  execution: { kind: "private-connector", frontendSharing: "none", publishTargetPort: null },
  enrollment: { source: "owner-file", fileId: "tunnel-token", environment: "TUNNEL_TOKEN_FILE",
    payloadIncluded: false },
  readiness: { path: "/ready", hostPublished: false, proves: "active-edge-connection-only",
    command: ["cloudflared", "tunnel", "--metrics", "127.0.0.1:2000", "ready"] },
  localRecipe: {
    credentials: "owner-supplied-existing-tunnel-json",
    configuration: "one-selected-same-owner-http-frontend-plus-deny-all-tail",
    privateNetworkRouting: "disabled",
    providerWrites: "none",
    prerequisites: ["fresh-provider-local-identity-and-route-inventory",
      "separate-exact-public-route-dns-tls-auth-approval",
      "exact-owner-json-credential-and-private-environment-bytes",
      "consumed-shared-pre-start-verification"],
  },
  prerequisites: ["exact-owner-remote-route-review", "pre-start-configuration-recheck",
    "actual-mounted-token-readability-under-image-uid-65532-and-daemon-mapping",
    "owned-private-native-readiness-command"],
} as const;

export type CloudflareTunnelIdentity = { accountId: string; tunnelId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fail(): never {
  // Never include caller-controlled API messages, configuration, or token bytes.
  throw new Error("Cloudflare pre-start review requires the exact supported identity and deny-all configuration");
}

function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const result = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(result, key))
    || Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) fail();
  return result;
}

function identity(value: unknown): CloudflareTunnelIdentity {
  const result = object(value, ["accountId", "tunnelId"]);
  if (typeof result.accountId !== "string" || !/^[0-9a-f]{32}$/.test(result.accountId)
    || typeof result.tunnelId !== "string" || !uuid.test(result.tunnelId)
    || result.tunnelId === "00000000-0000-0000-0000-000000000000") fail();
  return { accountId: result.accountId, tunnelId: result.tunnelId };
}

/** Private apply-boundary helper only: decode the pinned token format without returning its secret.
 * This proves syntactic identity, not that Cloudflare accepts the token or grants account API access.
 */
export function cloudflareTokenIdentity(tokenFile: Uint8Array): CloudflareTunnelIdentity {
  if (!(tokenFile instanceof Uint8Array) || tokenFile.byteLength === 0 || tokenFile.byteLength > 4096) fail();
  const encoded = Buffer.from(tokenFile).toString("utf8").trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail();
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) fail();
  let value: unknown;
  try { value = JSON.parse(decoded.toString("utf8")); } catch { fail(); }
  const token = object(value, ["a", "s", "t"], ["e"]);
  // A custom edge endpoint changes authority and is outside the reviewed contract.
  if (token.e !== undefined && token.e !== "") fail();
  if (typeof token.s !== "string" || token.s.length === 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(token.s)
    || Buffer.from(token.s, "base64").toString("base64") !== token.s) fail();
  return identity({ accountId: token.a, tunnelId: token.t });
}

/** Validate an independently fetched account API response. No network or approval authority.
 * Only a single catch-all 404 is supported. Private IP routes/hostname routes live in other APIs;
 * absence of an HTTP origin here must never be promoted to private-route or setup acceptance.
 */
export function cloudflareDenyAllConfiguration(value: unknown, expected: CloudflareTunnelIdentity) {
  const selected = identity(expected);
  const response = object(value, ["success", "errors", "messages", "result"]);
  if (response.success !== true || !Array.isArray(response.errors) || response.errors.length !== 0
    || !Array.isArray(response.messages) || response.messages.length !== 0) fail();
  const result = object(response.result, ["account_id", "tunnel_id", "source", "version", "config"], ["created_at"]);
  if (result.account_id !== selected.accountId || result.tunnel_id !== selected.tunnelId
    || result.source !== "cloudflare" || !Number.isSafeInteger(result.version)
    || Number(result.version) < 0 || Number(result.version) > 2147483647) fail();
  if (result.created_at !== undefined && (typeof result.created_at !== "string"
    || !Number.isFinite(Date.parse(result.created_at)))) fail();
  const config = object(result.config, ["ingress"]);
  if (!Array.isArray(config.ingress) || config.ingress.length !== 1) fail();
  const rule = object(config.ingress[0], ["service"]);
  if (rule.service !== "http_status:404") fail();
  const observed = { ...selected, source: "cloudflare" as const, version: Number(result.version),
    config: { ingress: [{ service: "http_status:404" }] } };
  return { ...observed, configurationSha256: createHash("sha256").update(JSON.stringify(observed)).digest("hex"),
    httpOriginConfigured: false, privateRoutesVerified: false, tokenAccepted: false,
    applyAuthorized: false, setupReady: false } as const;
}

/** Revalidate the fresh API response rather than trust an approval-time snapshot or its hash. */
export function cloudflareConfigurationRecheck(reviewed: ReturnType<typeof cloudflareDenyAllConfiguration>,
  fresh: unknown, expected: CloudflareTunnelIdentity) {
  const original = cloudflareDenyAllConfiguration({ success: true, errors: [], messages: [],
    result: { account_id: reviewed.accountId, tunnel_id: reviewed.tunnelId, source: reviewed.source,
      version: reviewed.version, config: reviewed.config } }, expected);
  const current = cloudflareDenyAllConfiguration(fresh, expected);
  if (original.configurationSha256 !== reviewed.configurationSha256
    || current.configurationSha256 !== original.configurationSha256) fail();
  return current;
}

/** Interpret an already collected exact-owner observation, never fetch or accept a caller URL.
 * The connector ID is not the tunnel ID. This result grants no setup or route acceptance.
 */
export function cloudflareReadinessObservation(httpStatus: number, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cloudflare readiness observation is malformed");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "connectorId,readyConnections,status"
    || body.status !== httpStatus || ![200, 503].includes(httpStatus)
    || typeof body.readyConnections !== "number" || !Number.isSafeInteger(body.readyConnections)
    || body.readyConnections < 0
    || typeof body.connectorId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.connectorId)
    || body.connectorId === "00000000-0000-0000-0000-000000000000"
    || (httpStatus === 200) !== (body.readyConnections > 0)) {
    throw new Error("Cloudflare readiness observation is malformed or contradictory");
  }
  return { appId: "cloudflare-tunnel", connectorId: body.connectorId,
    edgeConnected: httpStatus === 200, readyConnections: body.readyConnections,
    tunnelIdentityVerified: false, privateRoutesVerified: false, intendedClientVerified: false,
    setupReady: false } as const;
}

/** Actual provider readbacks only. This is a review of an existing locally
 * managed tunnel, not permission to activate it or proof of client auth/TLS. */
export function cloudflareLocalProviderReview(observed: CloudflareProviderObservation) {
  assertActualCloudflareProviderObservation(observed);
  const scope = observed.scope;
  if (observed.account.id !== scope.accountId || observed.tunnel.id !== scope.tunnelId
    || observed.tunnel.account_tag !== scope.accountId || observed.tunnel.config_src !== "local"
    || observed.tunnel.deleted_at !== null || observed.ipRoutes.length !== 0
    || observed.hostnameRoutes.length !== 0 || observed.zone.id !== scope.zoneId
    || observed.zone.account?.id !== scope.accountId || observed.zone.status !== "active"
    || (scope.hostname !== observed.zone.name && !scope.hostname.endsWith(`.${observed.zone.name}`))
    || observed.accessApplication.id !== scope.accessApplicationId
    || observed.accessApplication.domain !== scope.hostname || observed.accessApplication.type !== "self_hosted"
    || observed.accessPolicies.length < 1
    || observed.accessPolicies.some((policy) => !["allow", "deny"].includes(policy.decision)
      || (policy.decision === "allow" && (!Array.isArray(policy.include) || policy.include.length < 1
        || policy.include.some((rule: Record<string, unknown>) => !rule || Object.keys(rule).length !== 1
          || !["email", "email_domain", "group", "login_method", "gsuite", "github", "okta", "azure_ad"].includes(Object.keys(rule)[0]!)))))
    || !observed.accessPolicies.some((policy) => policy.decision === "allow")
    || observed.dnsRecords.length !== 1 || observed.dnsRecords[0].name !== scope.hostname
    || observed.dnsRecords[0].type !== "CNAME" || observed.dnsRecords[0].proxied !== true
    || observed.dnsRecords[0].content !== `${scope.tunnelId}.cfargotunnel.com`
    || observed.ssl.id !== "ssl" || !["full", "strict"].includes(observed.ssl.value)) fail();
  const covered = (hostname: unknown) => hostname === scope.hostname
    || hostname === `*.${scope.hostname.split(".").slice(1).join(".")}`;
  if (!observed.certificates.some((pack) => pack.status === "active"
    && Array.isArray(pack.certificates) && pack.certificates.some((cert: Record<string, any>) =>
      cert.status === "active" && Date.parse(cert.expires_on) > Date.now()
      && Array.isArray(cert.hosts) && cert.hosts.some(covered)))) fail();
  return { accountId: scope.accountId, tunnelId: scope.tunnelId, hostname: scope.hostname,
    inventoryFingerprint: observed.fingerprint, observedAt: observed.observedAt,
    apiReadbacksVerified: true, privateRoutesAbsent: true,
    applyAuthorized: false, mountedCredentialReadable: false,
    intendedClientVerified: false, setupReady: false } as const;
}

/** The shared pre-start owner supplies the no-argument real provider facility.
 * This standalone review is not the consumed public-exposure/start gate. */
export async function cloudflarePrestartProviderReview(context: SharedPrestartContext) {
  if (context.appId !== "cloudflare-tunnel" || !context.readCloudflareProvider) fail();
  await context.revalidate();
  const result = cloudflareLocalProviderReview(await context.readCloudflareProvider());
  await context.revalidate();
  return result;
}
