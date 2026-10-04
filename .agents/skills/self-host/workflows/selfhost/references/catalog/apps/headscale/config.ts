import { createHash } from "node:crypto";

export const HEADSCALE_CONFIG_SOURCE = "https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/config-example.yaml";
export const HEADSCALE_CONTAINER_SOURCE = "https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/docs/setup/install/container.md";
export const HEADSCALE_IMAGE = "docker.io/headscale/headscale:0.29.4";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const domain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Pure pre-start contract. The shared owner must supply and approve both values;
 * this module never infers a public route or installs one. */
export function compileHeadscaleConfiguration(canonicalOrigin: string, magicDnsDomain: string) {
  let origin: URL;
  try { origin = new URL(canonicalOrigin); }
  catch { throw new Error("Headscale requires an exact canonical HTTPS origin"); }
  if (origin.protocol !== "https:" || origin.origin !== canonicalOrigin
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || !domain.test(origin.hostname) || !domain.test(magicDnsDomain)
    || origin.hostname === magicDnsDomain) {
    throw new Error("Headscale requires a canonical HTTPS origin and a distinct MagicDNS FQDN");
  }
  const content = `server_url: ${JSON.stringify(canonicalOrigin)}
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 127.0.0.1:9090
grpc_listen_addr: 127.0.0.1:50443
grpc_allow_insecure: false
noise:
  private_key_path: /var/lib/headscale/noise_private.key
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
  allocation: sequential
derp:
  server:
    enabled: false
  urls:
    - https://controlplane.tailscale.com/derpmap/default
  paths: []
  auto_update_enabled: true
  update_frequency: 3h
disable_check_updates: true
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite
    write_ahead_log: true
policy:
  mode: file
  path: ""
dns:
  magic_dns: true
  base_domain: ${JSON.stringify(magicDnsDomain)}
  override_local_dns: false
  nameservers:
    global: []
    split: {}
  search_domains: []
  extra_records: []
unix_socket: /var/run/headscale/headscale.sock
unix_socket_permission: "0770"
log:
  level: info
  format: text
logtail:
  enabled: false
`;
  const configSha256 = hash(content);
  const service = {
    id: "headscale", purpose: "Private Headscale control plane behind one separately approved canonical HTTPS route.",
    imageTag: HEADSCALE_IMAGE, imageSource: HEADSCALE_CONTAINER_SOURCE, user: "image-default",
    imageUserEvidence: { officialUrl: HEADSCALE_CONTAINER_SOURCE, reason: "official-image-runtime-contract" },
    restart: "unless-stopped", readOnly: true, command: ["serve"],
    environment: [], hostEnvironment: [], fileEnvironment: [],
    mounts: [
      { name: "config", target: "/etc/headscale/config.yaml", kind: "generated-file", fileId: "headscale-config" },
      { name: "state", target: "/var/lib/headscale", kind: "volume" },
    ],
    tmpfs: [{ target: "/var/run/headscale", sizeBytes: 16777216, mode: 0o755 }],
    healthcheck: { test: ["CMD", "/ko-app/headscale", "health"], intervalSeconds: 30,
      timeoutSeconds: 10, startPeriodSeconds: 30, retries: 3 },
    dependsOn: [], publishTargetPort: 8080,
  };
  const configFiles = [{ id: "headscale-config", content, readability: "container",
    officialUrl: HEADSCALE_CONTAINER_SOURCE }];
  return { canonicalOrigin, magicDnsDomain, configSha256, service, configFiles,
    selectionFingerprint: hash(JSON.stringify({ version: 1, canonicalOrigin, magicDnsDomain,
      configSha256, service, configFiles })) };
}

/** A selected canonical identity is mandatory; never publish a default config. */
export function compileHeadscaleRecipe(canonicalOrigin: string, magicDnsDomain: string) {
  const configuration = compileHeadscaleConfiguration(canonicalOrigin, magicDnsDomain);
  const recipe = {
    schemaVersion: 2, kind: "multi-service-compose", appId: "headscale", source: HEADSCALE_CONFIG_SOURCE,
    services: [configuration.service], privateFiles: [], configFiles: configuration.configFiles,
    onboarding: { kind: "no-account", officialUrl: HEADSCALE_CONFIG_SOURCE },
    defaults: { hostIp: "127.0.0.1", publishedPort: 18082, dataDirectoryName: "headscale" },
    storage: { filesystem: "local-posix-locks", minimumFreeBytes: 1073741824 },
    acceptance: [
      { id: "api-key-readback", method: "api", description: "Create one checkpointed private API key and read back its exact prefix; not client enrollment." },
      { id: "canonical-client-enrollment", method: "api", description: "Verify the separately approved canonical HTTPS route and enroll an authorized real client; health alone is insufficient." },
      { id: "restart-persistence", method: "persisted", description: "After exact-owner restart, verify saved key readback and enrolled-client connectivity." },
    ],
  };
  return { recipe, configuration };
}
