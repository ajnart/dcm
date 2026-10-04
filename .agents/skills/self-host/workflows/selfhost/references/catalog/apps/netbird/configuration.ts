import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const NETBIRD_SOURCE = "https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/infrastructure_files/getting-started.sh";
export const NETBIRD_SETUP_SOURCE = "https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/http/handlers/instance/instance_handler.go";
export const NETBIRD_IMAGES = {
  netbird: "docker.io/netbirdio/dashboard:v2.94.0@sha256:70e0fc6dd3b7758148d182fb55ecd8d4f9ce01e9bba56c9389224e0b8354009d",
  server: "docker.io/netbirdio/netbird-server:0.80.0@sha256:05b3d8d6d056e5062a2965d4d6e5d6d83f09f2bf9133947a8e5972e0e0e7a261",
};
export type NetbirdConfigurationInput = {
  canonicalOrigin: string;
  /** Exact private address the separately owned edge uses; never trust every peer. */
  trustedProxyAddress: string;
  ownerEmail: string;
};
const fqdn = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Pure configuration consumed by the shared derived-recipe adapter.
 * Selecting an identity is not authority to configure DNS, TLS, UDP or an edge. */
export function compileNetbirdConfiguration(input: NetbirdConfigurationInput) {
  if (!input || Object.keys(input).sort().join(",") !== "canonicalOrigin,ownerEmail,trustedProxyAddress") {
    throw new Error("NetBird needs exactly the declared non-secret configuration inputs");
  }
  let origin: URL;
  try { origin = new URL(input.canonicalOrigin); }
  catch { throw new Error("NetBird needs one exact canonical HTTPS origin"); }
  const proxy = input.trustedProxyAddress;
  if (origin.protocol !== "https:" || origin.origin !== input.canonicalOrigin
    || origin.username || origin.password || origin.search || origin.hash || origin.port === "0"
    || !fqdn.test(origin.hostname)
    || isIP(proxy) !== 4 || !/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(proxy)
    || typeof input.ownerEmail !== "string" || input.ownerEmail.length > 254
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(input.ownerEmail)) {
    throw new Error("NetBird needs a canonical HTTPS FQDN, exact private IPv4 proxy and owner email");
  }
  const canonicalOrigin = input.canonicalOrigin;
  let exposedPort = origin.port;
  if (!exposedPort) exposedPort = "443";
  const exposedAddress = `${origin.protocol}//${origin.hostname}:${exposedPort}`;
  const privateConfig = { id: "server-config", officialUrl: NETBIRD_SOURCE, parts: [
    { literal: `server:\n  listenAddress: ":80"\n  exposedAddress: ${JSON.stringify(exposedAddress)}\n  stunPorts: [3478]\n  metricsPort: 9090\n  healthcheckAddress: ":9000"\n  logLevel: "info"\n  logFile: "console"\n  dataDir: "/var/lib/netbird"\n  authSecret: ` },
    { fileId: "relay-secret" },
    { literal: `\n  auth:\n    issuer: ${JSON.stringify(`${canonicalOrigin}/oauth2`)}\n    signKeyRefreshEnabled: true\n    sessionCookieEncryptionKey: ` },
    { fileId: "session-key" },
    { literal: `\n    dashboardRedirectURIs:\n      - ${JSON.stringify(`${canonicalOrigin}/nb-auth`)}\n      - ${JSON.stringify(`${canonicalOrigin}/nb-silent-auth`)}\n    cliRedirectURIs: ["http://localhost:53000/"]\n  reverseProxy:\n    trustedHTTPProxies: [${JSON.stringify(`${proxy}/32`)}]\n    trustedPeers: [${JSON.stringify(`${proxy}/32`)}]\n  store:\n    engine: "sqlite"\n    encryptionKey: ` },
    { fileId: "store-key" }, { literal: "\n" },
  ] };
  const dashboardEnvironment = Object.entries({
    NETBIRD_MGMT_API_ENDPOINT: canonicalOrigin, NETBIRD_MGMT_GRPC_API_ENDPOINT: canonicalOrigin,
    AUTH_AUDIENCE: "netbird-dashboard", AUTH_CLIENT_ID: "netbird-dashboard",
    AUTH_AUTHORITY: `${canonicalOrigin}/oauth2`, USE_AUTH0: "false",
    AUTH_SUPPORTED_SCOPES: "openid profile email groups", AUTH_REDIRECT_URI: "/nb-auth",
    AUTH_SILENT_REDIRECT_URI: "/nb-silent-auth", NGINX_SSL_PORT: "443", LETSENCRYPT_DOMAIN: "none",
  }).map(([name, value]) => ({ name, value }));
  const common = { imageSource: NETBIRD_SOURCE, user: "image-default",
    imageUserEvidence: { officialUrl: NETBIRD_SOURCE, reason: "official-image-runtime-contract" },
    restart: "unless-stopped", readOnly: false, hostEnvironment: [], fileEnvironment: [], dependsOn: [] };
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "netbird", source: NETBIRD_SOURCE,
    services: [
      { ...common, id: "netbird", purpose: "Dashboard behind the separately approved NetBird HTTPS edge.",
        imageTag: NETBIRD_IMAGES.netbird, environment: dashboardEnvironment,
        mounts: [], publishTargetPort: 80 },
      { ...common, id: "server", purpose: "Combined control plane with separately reviewed STUN and protocol-aware edge.",
        imageTag: NETBIRD_IMAGES.server, environment: [{ name: "NB_SETUP_PAT_ENABLED", value: "true" }],
        privateConfigFiles: ["server-config"], command: ["--config", "/run/secrets/server-config"],
        mounts: [{ name: "state", target: "/var/lib/netbird", kind: "volume" }], publishTargetPort: null,
        additionalPorts: [
          { id: "stun", targetPort: 3478, protocol: "udp", purpose: "application", required: true },
        ] },
    ],
    privateFiles: [{ id: "admin-password", bytes: 32 }, { id: "relay-secret", bytes: 32 },
      { id: "session-key", bytes: 32, format: "base64" }, { id: "store-key", bytes: 32, format: "base64" }],
    privateConfigs: [privateConfig],
    onboarding: { kind: "manual-first-email", officialUrl: NETBIRD_SETUP_SOURCE,
      email: input.ownerEmail, fileId: "admin-password" },
    defaults: { hostIp: "127.0.0.1", publishedPort: 18080, dataDirectoryName: "netbird" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
    acceptance: [
      { id: "owner-login", method: "api", description: "Verify the saved owner with a fresh login; a PAT does not prove the password." },
      { id: "edge-and-client", method: "api", description: "Verify trusted TLS, native gRPC, HTTP, WebSocket and separately approved UDP plus real authorized client connectivity." },
      { id: "restart-persistence", method: "persisted", description: "Recheck saved identity and real client connectivity after exact-project restart." },
    ],
  };
  const requirements = {
    canonicalOrigin, trustedProxyAddress: proxy,
    edge: { owner: "shared-private-https", serverService: "netbird-server", dashboardService: "netbird",
      httpPaths: ["/api/", "/oauth2/"], webSocketPaths: ["/relay", "/ws-proxy/"],
      grpcPaths: ["/signalexchange.SignalExchange/", "/management.ManagementService/", "/management.ProxyService/"], grpcUpstream: "h2c",
      udp: { port: 3478, protocol: "udp", approval: "separate-direct-reachability" } },
    bootstrap: { owner: "app-local-setup", inspect: "GET /api/instance", create: "POST /api/setup",
      optionalPatEnvironment: "NB_SETUP_PAT_ENABLED=true", optionalPatRequest: { create_pat: true, pat_expire_in: 1 },
      readback: "GET /api/users with Authorization: Token", lostResponse: "inspect-without-replaying",
      passwordLogin: "fresh-local-password-and-management-owner-readback", tokenRotation: "unimplemented" },
    blockers: ["approved-protocol-aware-https-route", "direct-udp-client-reachability",
      "one-day-pat-expiry-and-reviewed-rotation", "native-grpc-websocket-and-peer-acceptance"],
    runnable: true, readiness: "reviewed-recipe-and-headless-owner-setup-not-live-acceptance",
  };
  return { recipe, images: { ...NETBIRD_IMAGES }, requirements,
    selectionFingerprint: hash({ input, recipe, images: NETBIRD_IMAGES, requirements }) };
}
