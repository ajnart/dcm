# Infrastructure patterns for safe self-hosted orchestration

Date: 2026-08-28  
Scope: reusable orchestration patterns for macOS/Mac mini, Ubuntu/Debian, VPS, Unraid, TrueNAS, and Proxmox; reviewed against the current `auto-stack` checkout.

## Executive recommendation

Treat a host as a capability profile, not as a distribution name. The orchestrator should make the following lifecycle explicit:

```text
read-only inspect -> normalize profile -> route the request -> plan a diff
    -> obtain approval for exposure/destructive work -> stage paths/config
    -> render and validate -> apply one project -> wait for health
    -> run read-only probes -> persist non-secret preferences -> retain rollback
```

The stable boundary is a project-scoped adapter. It owns a Compose project name, a host/context, a path map, an ingress owner, a VPN boundary, and a backup policy. It must never infer those from a convenient default. In particular, “make it accessible” is incomplete until private versus public access, DNS ownership, TLS ownership, and an authentication policy have been chosen.

Docker Compose's current model is the Compose Specification. `docker compose config --quiet` is the inexpensive structural preflight; `--resolve-image-digests` or `--lock-image-digests` can make image resolution reviewable. [Compose Specification](https://docs.docker.com/reference/compose-file/) · [Compose config](https://docs.docker.com/reference/cli/docker/compose/config/)

## Evidence and limits

This report uses current first-party Docker, platform, proxy, VPN, and backup documentation. First-party project wikis and READMEs are called out as operational guidance rather than universal standards. No Docker daemon was started, no tests/builds were run, no implementation files were changed, and `.sessions` and secret material were not read.

Context7 was attempted for Docker Compose but could not be used: the available Node runtime first rejected the CLI syntax, and a Node 24 retry reported the monthly quota was exhausted. The links in this report are therefore direct primary documentation links and should be refreshed before implementing version-sensitive adapters.

The local browser prerequisite was inspected without opening an application session. `browser-harness --doctor` reported browser/daemon/connection failures (Chrome not running, daemon not alive, zero active connections). This is an environment prerequisite, not evidence that the stack is broken. The repository prompts expect the separate `agent-browser` session/ref contract; the current installed `browser-harness` has a different CDP contract. Reuse the isolation and evidence ideas, but keep the CLI adapter stack-specific.

## What is reusable in this checkout

### Reusable control-plane patterns

The current checkout already contains useful seams:

- [`scripts/session.sh`](../scripts/session.sh) has per-run IDs, a managed port range, file locks, ownership/mode/symlink checks, atomic staging, and project-scoped Compose invocation. These are good primitives for a host adapter, provided the state root is made configurable and the port range is not assumed to be globally safe.
- [`scripts/lib/session-context.mjs`](../scripts/lib/session-context.mjs) separates managed process environment from secrets, validates private files, and writes sensitive values atomically. Keep this boundary; replace stack-specific key names with capability-scoped secret references.
- [`docker-compose.yml`](../docker-compose.yml) demonstrates explicit project naming, service-name DNS, per-project bind mounts, loopback publication, healthchecks, and a private project network. These are reusable patterns, not production defaults.
- [`docs/README.md`](../docs/README.md), [`prompts/10-isolation-and-start.md`](../prompts/10-isolation-and-start.md), and [`prompts/80-acceptance.md`](../prompts/80-acceptance.md) show the right separation between preflight, apply, health, and evidence gates.
- [`scripts/lib/homarr-mcp.mjs`](../scripts/lib/homarr-mcp.mjs), [`scripts/homarr-mcp-bridge.mjs`](../scripts/homarr-mcp-bridge.mjs), and [`scripts/write-mcp-config.mjs`](../scripts/write-mcp-config.mjs) demonstrate capability-scoped protocol validation, bounded responses, a private credential adapter, and secret-free client configuration.

### Stack-specific pieces that must stay behind an adapter

The seven service IDs, Hotio/Seerr/Homarr image choices, `/data` media layout, qBittorrent port behavior, Arr/Seerr setup sequence, Homarr onboarding, Homarr API key, native MCP tool names, Date-schema fallback, and “Spider-Man: No Way Home” probe belong to the media-demo adapter. They should not leak into a generic host profile or routing skill.

The current experiment also uses `latest` for Seerr and an always-pull policy for the Homarr test image. That is acceptable for a disposable experiment, but a production profile should record a version and preferably a digest. Tags are mutable while digests identify exact content. [Docker image digests](https://docs.docker.com/dhi/explore/security-concepts/digests/)

## Host inspection: read-only first

Inspection should produce facts, capabilities, and conflicts without printing environment values, full container inspection, cookies, API keys, passwords, or paths known to contain secrets. Never inspect `.sessions`, `.env*`, credential stores, or arbitrary user files as part of generic discovery.

### Safe fact inventory

Record the command result as `observed`, with a timestamp and confidence:

- Platform and architecture: `uname -srm`, `uname -m`; `sw_vers` on macOS; `/etc/os-release` on Linux.
- Runtime: `docker version` (client/server only), `docker info` with a deliberately limited format, `docker compose version`, `docker context show`, and `docker context ls`. Remote contexts must be explicit.
- Identity: numeric `id`, group membership, rootless indicator, and whether `newuidmap`/`newgidmap` plus subordinate ranges exist when rootless Docker is selected.
- Storage: filesystem type, free bytes/inodes, mount options, case sensitivity where relevant, and whether candidate roots are local, NFS, SMB, or a NAS share. Use `findmnt`, `df -PT`, and platform-safe `stat`; do not recursively enumerate user data.
- Network: listening TCP/UDP ports and interfaces, Docker networks, and firewall state. Use a bounded `ss`/`lsof` query and `docker network ls`; do not dump labels or environment values indiscriminately.
- Existing workloads: `docker ps` with names, images, status, and published ports only; inspect labels and network attachments through a redacted allowlist. Never assume a container name is an API.
- Optional capabilities: versions and health only for installed `caddy`, `traefik`, `cloudflared`, `tailscale`, `headscale`, `ngrok`, or WireGuard tooling.

The inspection result should distinguish “not installed,” “installed but not configured,” “running,” and “not observable.” A missing optional tunnel binary is not a failure if the chosen route does not need it.

### Runtime and platform routing

| Observed host | Default route | Gates and caveats |
|---|---|---|
| macOS/Mac mini | Docker Desktop project, loopback or tailnet access | Docker runs in a Linux VM; share only required directories, prefer VM named volumes for databases/caches, check case sensitivity, CPU/memory/disk limits, and arm64 image support. A Mac mini is not automatically a 24/7 server. |
| Ubuntu/Debian host | Docker Engine plus Compose plugin | Install from the official package instructions; decide rootful versus rootless; check systemd/linger for a user daemon. Published Docker ports can bypass UFW/firewalld intent, so inspect the `DOCKER-USER`/iptables-nft policy. |
| VPS | Engine/Compose over an explicit local or SSH Docker context | Require provider firewall, host firewall, domain/DNS, one 80/443 owner, backups, and an admin access path before public exposure. Never expose an unauthenticated Docker API. |
| Unraid | Docker project with `appdata` config and explicit media/download shares | Preserve Unraid's default share permissions. Separate application state from large media; verify the image architecture and the container user/share ACL model. Flash backup does not replace appdata or user-data backup. |
| TrueNAS SCALE | Version-checked Custom App/Compose or a dedicated VM | Create datasets before shares/apps, map ACLs deliberately, and record container identities. Host UID 1000 is not a portable identity. Use snapshots plus replication, not snapshots alone. |
| Proxmox | Docker inside a QEMU VM by default | Proxmox documents the VM route as the stronger isolation model for Docker. An LXC with nesting is an explicit exception with host-kernel exposure, migration, and backup tradeoffs. |

Docker Desktop's Mac implementation uses a Linux VM and file sharing; its documentation recommends keeping databases/caches in VM-managed storage where possible. [Desktop resources and file sharing](https://docs.docker.com/desktop/settings-and-maintenance/settings/) · [Desktop networking](https://docs.docker.com/desktop/features/networking/)

Official Engine installation and security docs cover Ubuntu/Debian, rootless prerequisites, and protecting the daemon. [Ubuntu install](https://docs.docker.com/engine/install/ubuntu/) · [Debian install](https://docs.docker.com/engine/install/debian/) · [Rootless mode](https://docs.docker.com/engine/security/rootless/) · [Protect daemon access](https://docs.docker.com/engine/security/protect-access/)

## Declarative host profile and preference model

Persist facts and choices separately. A profile is portable intent plus host mappings; generated runtime files are disposable outputs. Use `observed`, `chosen`, `derived`, and `secretRef` as explicit value provenance. A secret reference identifies a vault/file/socket location but never contains the secret.

```yaml
schemaVersion: 1
profileId: host-profile-example
capturedAt: 2026-08-28T00:00:00Z

host:
  kind: macos                 # macos | linux | vps | unraid | truenas | proxmox-vm | proxmox-lxc
  os: {family: darwin, version: observed}
  arch: arm64
  dockerContext: desktop
  virtualization: docker-desktop-vm
  rootless: {value: false, source: observed}
  capabilities: {source: observed, confidence: medium}

runtime:
  engine: docker
  composeVersion: {source: observed}
  project: media-demo
  imagePolicy: pinned             # pinned | digest | floating-experiment
  networkName: media-demo_default
  externalNetworks: []            # each requires an ownership/existence contract

identity:
  uid: {value: 1000, source: observed}
  gid: {value: 1000, source: observed}
  timezone: Europe/Berlin
  umask: "0022"
  perServiceMappings: {}

storage:
  roots:
    config: {hostPath: /srv/media/config, source: chosen}
    data: {hostPath: /srv/media/data, source: chosen}
    downloads: {containerPath: /data/torrents, source: derived}
    media: {containerPath: /data/media, source: derived}
    cache: {hostPath: /srv/media/cache, source: chosen}
    backup: {hostPath: /srv/backup/media-demo, source: chosen}
  sameFilesystemGroups:
    - [downloads, media]
  filesystem: {type: observed, local: true, nfs: false, source: observed}
  acl: {mode: observed, owner: chosen, group: chosen}
  symlinkPolicy: reject-escape

services:
  - id: downloader
    image: registry.example/downloader@sha256:REDACTED_DIGEST
    enabled: true
    profile: vpn-download
    mounts: [data, config]
    networks: [private, vpn]
    healthcheck: required
    secretRefs: [downloader.credentials]

ingress:
  mode: tailnet                  # local | lan | tailnet | public | tunnel
  owner: tailscale               # none | caddy | traefik | npm | cloudflare | pangolin | tailscale | ngrok
  domains: []
  tls: {required: true, provider: managed}
  dns: {owner: tailscale, records: []}
  accessPolicy: {source: chosen, value: tailnet-acl}
  publishedPorts: {default: loopback}

vpn:
  mode: gluetun                 # none | gluetun | wireguard | tailscale-exit
  scope: [downloader]
  killSwitch: {required: true, source: chosen}
  allowedLanCidrs: [192.168.0.0/16]
  dnsMode: vpn-resolver
  forwardedPort: {source: secretRef, ref: vault://media/forwarded-port}
  credentials: {source: secretRef, ref: vault://media/vpn}

backup:
  provider: truenas-replication
  configSchedule: daily
  retention: {daily: 7, weekly: 4, monthly: 6}
  encryption: required
  lastRestoreTest: null

monitoring:
  healthchecks: compose-and-api
  metrics: {enabled: false}
  alerts: [disk-space, restart-loop, backup-age, ingress-tls, vpn-egress]

preferences:                    # non-secret user intent only
  locale: en-US
  media:
    categories: [movies, tv]
    defaultQualityProfile: null
  access:
    preferredName: media
    exposure: tailnet
  ui: {theme: system}

policy:
  allowDockerSocket: false
  allowPublicPorts: false
  allowMediaMutations: false
  allowAutomaticUpgrades: false
  affiliateDisclosureRequired: true
```

For implementation, store each important field as a record with `value`, `source`, `observedAt`, `confidence`, and `lastVerified`, rather than overloading a single YAML scalar. Keep logical path IDs (`config`, `downloads`, `media`) separate from host paths and container paths. This permits a Mac path, an Unraid share, and a TrueNAS dataset to produce the same in-container `/data` layout.

Non-secret preferences may include locale, UI choices, desired exposure class, media categories, quality-profile names, logical path IDs, host aliases, and backup cadence. They must not include passwords, API keys, WireGuard private keys, tunnel tokens, cookies, or generated encryption keys. Persist secret references and ownership metadata; resolve secrets only at the narrowest apply step.

## Compose, paths, identities, and reuse

### Compose topology

- Generate an explicit project name. Do not set global `container_name`; it defeats project isolation and makes parallel runs collide.
- Use user-defined networks and service-name DNS. Container IPs are ephemeral; a service name remains the stable dependency address when Compose recreates a container. [Compose networking](https://docs.docker.com/compose/how-tos/networking/) · [Engine networks](https://docs.docker.com/engine/network/)
- Keep host and container ports distinct in the profile. Publish loopback by default. Bind public ports only when the ingress owner explicitly owns them.
- Use `depends_on` with `condition: service_healthy` for readiness dependencies. Compose start order alone does not mean an application is ready. `docker compose up --wait` is useful after rendering. [Startup order](https://docs.docker.com/compose/how-tos/startup-order/) · [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)
- Declare an external network only after inspection confirms it exists, its owner is known, and its labels/contract match. Compose does not create an `external: true` network and errors if it is absent. [Networks](https://docs.docker.com/reference/compose-file/networks/)
- Use separate front/private networks when a reverse proxy or VPN gateway is present. The database/control plane should not share an exposed network without a reason.
- Mount configuration and data deliberately. Bind mounts are host-specific and writable by default; use `ro` for assets and configuration that should not be changed by a service. Named volumes can keep Mac database/cache I/O inside the Docker VM. [Storage](https://docs.docker.com/engine/storage) · [Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)

Run `docker compose config --quiet` before apply, but do not save raw config output: interpolation and secret sources can reveal sensitive values. Keep a redacted, normalized plan instead.

### Path planning

The planner should reject a path when it is missing, a symlink escaping its approved root, a device/mount type is unsupported, free space is insufficient, or the permissions cannot be made compatible without a user decision. It should show a diff and ask before creating directories outside the project state root.

For media/download workloads, expose one consistent container path such as `/data` to the downloader and Arr-like managers. The official Servarr Docker guide and Radarr documentation explain why differing container paths cause remote path mapping problems and prevent hardlinks/atomic moves. [Servarr Docker Guide](https://github.com/Servarr/Wiki/blob/master/docker-guide.md) · [Radarr download clients](https://radarr.video/docs/download_clients)

Require downloads and media to be on the same filesystem when hardlinks or atomic moves are desired. A planner can expose a `sameFilesystemGroups` constraint rather than guessing from path names. A NAS share, SMB mount, or separate dataset may intentionally violate it; then the plan must say that copies are expected and estimate the storage/latency consequence.

Keep config, databases, media, downloads, cache, and backups distinct. Config/database backups should be quiesced or made through an application-native backup. Large media may be rebuildable or separately protected; do not silently treat it as disposable.

### UID/GID, ACL, and timezone

Inspect numeric UID/GID and service-level identity support. `PUID`/`PGID` are image conventions, not Docker standards. Rootless Docker maps container IDs through subordinate ranges; TrueNAS containers have identities independent from the host and need explicit mappings. Unraid templates may deliberately use `nobody:users`; preserve that platform's ACL model instead of applying a Linux-host recipe.

Create directories with least privilege and test write access as the actual service identity. Avoid blanket `chmod 777`; the current experiment uses nested writable directories only to accommodate rootless remapping, and that should remain an isolated adapter decision. Keep the parent state directory private.

Use an IANA timezone, validate it against the host's zoneinfo database, and persist the chosen value as a non-secret preference. Do not accept arbitrary timezone strings that alter process behavior or produce path traversal.

### Existing container, network, port, and proxy reuse

Reuse is safe only when an inspected object has an explicit contract:

1. Identify owner/project, image, ports, networks, labels, health, and data mounts through a redacted allowlist.
2. Confirm the candidate service can reach it by a service name or declared proxy route, not an IP or incidental container name.
3. Confirm the port and network are owned by the same profile or by a user-approved external owner.
4. Confirm lifecycle expectations: who upgrades it, who backs it up, and whether the new project may restart it.
5. Record the result as `reuse`, `coexist`, or `conflict`; never silently replace it.

Do not mount `/var/run/docker.sock` for convenience. Docker control access is effectively host-level control; if a capability genuinely needs it, make it an explicit, isolated policy choice with a read-only proxy or equivalent boundary. [Docker security](https://docs.docker.com/engine/security/)

## DNS, HTTPS, reverse proxies, and private access

There must be one TLS/HTTP ingress owner per host/port. A new stack should attach to an existing Caddy, Traefik, or Nginx Proxy Manager only after discovering its network and route contract. It should not bind 80/443 just because those ports are conventional.

| Need | Preferred route | Required checks |
|---|---|---|
| One machine or LAN only | Loopback plus host/LAN firewall, or an existing internal proxy | No public DNS; verify bind address and firewall scope. |
| Private access from a phone or trusted devices | Tailscale Serve; Headscale if the control plane is intentionally self-hosted | Tailnet identity and ACL policy; route only the chosen service. Serve is private to the tailnet. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) |
| Public domain with inbound 80/443 | Reuse one Caddy, Traefik, or NPM owner | DNS A/AAAA, firewall, certificate persistence, auth policy, and route ownership. |
| Public domain without inbound ports/behind CGNAT | Cloudflare Tunnel or Pangolin/Newt | Provider account/token boundary, outbound route, public hostname, access policy, and large-file/media terms. |
| Temporary development endpoint | ngrok | Ephemeral URL, token boundary, explicit auth/traffic policy, and no production data. |

### Caddy

Caddy can automatically obtain and renew certificates and redirect HTTP to HTTPS. Public ACME HTTP-01/TLS-ALPN validation needs DNS and the relevant ports; DNS challenge avoids public validation ports but requires DNS credentials. Persist Caddy's data directory and treat DNS credentials as a secret reference. [Automatic HTTPS](https://caddyserver.com/docs/automatic-https) · [Reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

### Traefik and Nginx Proxy Manager

Traefik's Docker provider watches labels and needs a correctly selected Docker network; protect the Docker API/TLS configuration. [Traefik Docker provider](https://doc.traefik.io/traefik/providers/docker/)

Nginx Proxy Manager is a reasonable GUI-owned alternative when its existing admin/data lifecycle is already understood. Treat its features (Let's Encrypt/custom certificates, access lists, basic auth) as project README guidance and keep admin access private. [Nginx Proxy Manager project](https://github.com/NginxProxyManager/nginx-proxy-manager)

### Tunnels and private overlays

Cloudflare Tunnel uses outbound-only encrypted connections and maps a public hostname to a local service; a tunnel does not by itself provide application authentication. Configure Cloudflare Access or equivalent policy, and use a private route for large media where provider limits/terms make public streaming unsuitable. [Tunnel](https://developers.cloudflare.com/tunnel/) · [Configuration](https://developers.cloudflare.com/tunnel/configuration/) · [Routing](https://developers.cloudflare.com/tunnel/routing/)

Pangolin is a self-hosted identity-aware reverse proxy/VPN pattern. Its standard self-host route expects a Linux host with public IP/domain and ports including 80, 443, 51820, and 21820; Newt connectors provide outbound tunnels for private resources. The host profile must model whether that prerequisite exists rather than recommending Pangolin for every CGNAT host. [Pangolin quick install](https://docs.pangolin.net/self-host/quick-install) · [How Pangolin works](https://docs.pangolin.net/about/how-pangolin-works)

Tailscale Funnel is public internet exposure and should be a deliberate exception to the default private Serve route; enforce an ACL and application authentication. Headscale provides a self-hosted coordination plane, while subnet routes still need explicit advertisement/approval. [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) · [Headscale routes](https://headscale.net/latest/ref/routes/) · [Headscale getting started](https://docs.headscale.org/usage/getting-started/)

ngrok is useful for a short-lived, policy-controlled endpoint, not a default production ingress. Protect its agent token and apply traffic policies/authentication. [ngrok agent](https://ngrok.com/docs/agent) · [ngrok CLI](https://ngrok.com/docs/agent/cli)

DNS/TLS validation should resolve the chosen hostname from the relevant client network, verify certificate name/expiry/issuer, prove that the route reaches the intended service, and confirm that direct service ports remain private. ACME itself is standardized by [RFC 8555](https://www.rfc-editor.org/info/rfc8555/).

## VPN routing and torrent kill-switch safety

Model VPN scope explicitly. The default media topology is:

```text
control plane (Arr/Seerr/Jellyfin/proxy) -- normal private network
downloader/qBittorrent -- network namespace of Gluetun/WireGuard
                                      \-- strict firewall -> VPN interface only
```

Use `vpn.mode: none` only when the user chose no VPN. For Gluetun, the downloader joins the VPN container's network namespace (`network_mode: service:gluetun`), the WebUI port is published on the Gluetun service, and the container has the required `NET_ADMIN`/TUN capability. This is a first-party Gluetun operational pattern, not a guarantee that every VPN provider or image is equivalent. [Gluetun project](https://github.com/qdm12/gluetun) · [Gluetun firewall FAQ](https://github.com/qdm12/gluetun-wiki/blob/main/faq/firewall.md)

Guardrails:

- Keep kill-switch/firewall behavior enabled; allow only required LAN control paths, DNS, and VPN egress.
- Do not route Arr, the reverse proxy, or management traffic through the downloader namespace by accident.
- Store WireGuard private keys, provider credentials, and forwarded-port values as secret references.
- Treat WireGuard `AllowedIPs` as a routing decision, not merely a connection toggle. [WireGuard quickstart](https://www.wireguard.com/quickstart/)
- Do not claim “torrent-safe” from a green VPN status alone. The verification must prove egress behavior.

Required read-only validation for a selected VPN route:

1. From the downloader namespace, record the public IP and DNS resolver while the tunnel is healthy; compare with the selected provider/region without logging credentials.
2. Break or stop the tunnel while leaving the downloader container running. An external IP/DNS request must fail, not fall back to the host interface.
3. Restore the tunnel and prove the expected public IP returns.
4. Inspect routes and firewall state for a direct default route or unexpected interface.
5. If the user explicitly asks for torrent validation, use a controlled legal test and verify the observed peer IP; otherwise stop at network-level validation.

The kill-switch test is a hard gate. A timeout, ambiguous DNS result, or inability to stop/restart the tunnel is `blocked`, not “probably secure.”

## Storage, permissions, and platform-specific data layouts

Use a path plan with these logical classes:

```text
config/     application settings, databases, generated keys
data/       shared working tree and downloads
media/      durable movies/TV or other user media
cache/      disposable indexes/transcodes
backup/     separate destination, preferably another failure domain
```

For Unraid, `appdata` is the natural application-state share; keep media/downloads in deliberate shares and do not rewrite default share permissions. Unraid's automated flash backup covers the flash configuration/license/settings, not container or user data. [Unraid shares](https://docs.unraid.net/unraid-os/using-unraid-to/manage-storage/shares/) · [Unraid flash backup](https://docs.unraid.net/unraid-connect/automated-flash-backup/)

For TrueNAS, create datasets before shares/apps, separate application data from media, and select an ACL mode that matches the service identities. TrueNAS explicitly warns that container identities are independent from host IDs. [TrueNAS apps](https://www.truenas.com/docs/scale/apps/apps/) · [Datasets](https://www.truenas.com/docs/scale/26/datasets/managingdatasets/) · [Container identities](https://www.truenas.com/docs/scale/containers/managingcontainers/)

For Proxmox, back up the VM/CT at the hypervisor layer in addition to application-level backups. Proxmox's `vzdump` covers VM/CT configuration and data according to the storage/mode selected; snapshot mode requires snapshot-capable storage. [Proxmox admin guide](https://pve.proxmox.com/pve-docs/pve-admin-guide.pdf) · [vzdump documentation](https://github.com/proxmox/pve-docs/blob/master/vzdump.adoc)

Rootless Docker data directories should not live on NFS; verify local filesystem and subordinate ID mappings before choosing rootless. [Rootless tips](https://docs.docker.com/engine/security/rootless/tips/)

## Backups, restores, monitoring, and upgrades

### Backup contract

The profile should say what is backed up, where, how often, how it is encrypted, and when a restore was last tested. A practical policy is:

- Back up the Compose/profile definition, image references/digests, config directories, app databases, metadata, and secret references. Back up the secret payload only through a protected secret-management process.
- Keep media in the backup plan when it is not reproducible; otherwise state explicitly that it is rebuildable and protect the metadata that makes rebuilding possible.
- Keep at least one copy in another failure domain. Label this as operational guidance, not a formal standard.
- Quiesce stateful services or use their native export before copying databases. Record application/schema versions with the backup.
- Restore into a fresh project/profile first. Do not overwrite production during a drill.

Docker documents volume backup/restore patterns, and its Desktop guidance separates the Compose definition from volume contents. [Volume backup](https://docs.docker.com/engine/storage/volumes/) · [Desktop backup](https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/)

TrueNAS snapshots are point-in-time protections, not independent copies; use replication/offsite storage for a second failure domain. [TrueNAS replication](https://www.truenas.com/docs/scale/26/dataprotection/replication/) · [TrueNAS snapshots](https://www.truenas.com/docs/core/13.0/coretutorials/tasks/creatingperiodicsnapshottasks/)

### Monitoring contract

Use three layers:

1. Container/process: healthchecks, restart loops, OOM, CPU/memory, disk and inode pressure.
2. Application: read-only API readiness, library/database health, queue age, and authentication failures.
3. Edge: proxy route, certificate expiry, tunnel connection, DNS resolution, and VPN public egress.

Docker events expose lifecycle and `health_status` events; `docker stats` provides runtime metrics. Prometheus/OpenTelemetry are optional integration capabilities, not prerequisites for a local stack. [Docker events](https://docs.docker.com/reference/cli/docker/system/events/) · [Docker runtime metrics](https://docs.docker.com/engine/containers/runmetrics/) · [Prometheus exposition](https://prometheus.io/docs/instrumenting/exposition_formats/) · [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/)

### Upgrade, migration, and rollback

Before changing an image or schema:

1. Capture the current profile hash, Compose model, image digests, health state, and backup age.
2. Make a restorable application-level backup and a host/storage snapshot where available.
3. Render the new model and validate it without applying it. Resolve or lock image digests for review.
4. Upgrade one service or a disposable clone first; wait for health and run read-only API/UI probes.
5. Retain the previous digest and profile. If migration fails, stop the candidate, restore the backup/snapshot, and reapply the previous digest.

Do not use `docker compose down -v` as a routine upgrade step: it removes named volumes. Prefer `up` with the same project and explicit image policy; Compose recreates changed containers while preserving mounted volumes. [Compose up behavior](https://docs.docker.com/reference/cli/docker/compose/up/)

Treat forward-only database migrations as a high-risk approval gate. If the application cannot downgrade its schema, rollback means restore, not simply changing the image tag. Production profiles should reject floating `latest` unless the user explicitly selects an experiment policy.

## Security and ethics guardrails

The default policy should be deny-by-default:

- Loopback/private publication unless public access is explicitly chosen.
- One ingress/TLS owner; no duplicate 80/443 listener.
- No unauthenticated admin panel, Docker API, Docker socket, or direct database publication.
- Secret references only in profiles; private secret files owned and mode-restricted; no secret values in logs, screenshots, URLs, reports, or generated client configs.
- Least-privilege service identities, explicit ACLs, and read-only mounts where practical.
- Reject arbitrary user-provided host paths unless they pass realpath, ownership, filesystem, and approved-root checks.
- Ask before destructive operations, migration, deletion, public exposure, or changing an existing proxy/network.
- Redact `docker inspect`, Compose environment, proxy labels, and error payloads before evidence capture.
- Preserve a pre-change backup and previous image digest before migration.

Affiliate or sponsored links must never influence the capability route. If an affiliate relationship exists, disclose it next to the link, keep neutral official/self-hosted alternatives visible, explain selection criteria, and do not rank a product higher because it pays commission. Record the link and date in user-facing recommendations; do not put affiliate URLs in machine-readable defaults.

## Natural-language decision routing

The router should map intent to a small number of capability choices, then ask for missing high-impact decisions:

| User wording | Route | Ask/gate |
|---|---|---|
| “Only this Mac” / “LAN only” | Loopback/LAN, no tunnel | Which LAN/interface and admin auth? |
| “Access it privately from my phone” | Tailscale Serve; Headscale only when self-hosting the control plane is desired | Tailnet/ACL owner and service list. |
| “Public domain with HTTPS” | Reuse existing Caddy/Traefik/NPM, else select one | Domain/DNS owner, 80/443 availability, auth policy. |
| “I am behind CGNAT” / “No port forwarding” | Cloudflare Tunnel or Pangolin/Newt; ngrok for temporary work | Provider account, public hostname, access policy, media-size/terms constraints. |
| “VPN all torrent traffic” | Gluetun/WireGuard downloader namespace with kill-switch validation | Provider/region, allowed LAN control path, forwarded port, legal test consent. |
| “Run it on my NAS/Unraid/TrueNAS” | Platform adapter with appdata/dataset/ACL checks | Dataset/share roots, identities, snapshots/replication, image architecture. |
| “It is on Proxmox” | Docker in a QEMU VM by default | VM storage/network/backup; LXC nesting requires explicit exception. |
| “I already have Traefik/Caddy” | Reuse after owner/network/route inspection | Whether this project may add labels/routes and who owns TLS. |
| “Deploy it on a VPS” | Explicit Docker context/SSH, firewall, ingress, backup | DNS, public exposure, recovery/admin path, provider limits. |

If the user has not chosen private versus public, data roots, tunnel/provider, VPN scope, backup policy, or whether migration/destruction is allowed, stop and ask. These choices materially change the threat model and data safety.

## Capability skill candidates

The reusable implementation can be split into narrow, auditable capabilities:

- `host-inspection`: redacted platform/runtime/storage/network facts.
- `runtime-preflight`: Docker/Compose/version/context/rootless/readiness checks.
- `storage-path-planner`: logical-to-host/container path maps, filesystem and symlink checks.
- `identity-permissions`: UID/GID/ACL/umask/TZ planning and write probes.
- `compose-renderer`: profile-to-Compose rendering, config validation, digest locking.
- `resource-reuse-auditor`: existing container/network/port/proxy ownership and conflict report.
- `ingress-router`: local/LAN/tailnet/public/tunnel choice with one-owner enforcement.
- `dns-tls-verifier`: DNS, ACME/TLS, route, and direct-port checks.
- `vpn-download-isolator`: Gluetun/WireGuard namespace, kill-switch, DNS/IP leak validation.
- `backup-restore-drill`: backup manifest, protected copy, fresh-profile restore, and evidence.
- `health-monitoring`: health/API/edge probes, event and metrics hooks, alert policy.
- `upgrade-migration`: digest-pinned canary, migration gate, rollback/restore.
- `secret-boundary`: secret references, atomic files, redaction, and no-secret artifacts.
- `browser-proof`: CDP session isolation, AX/screenshot evidence, and environment-prerequisite reporting.
- `natural-language-router`: intent-to-capability mapping and high-impact clarification prompts.
- `affiliate-disclosure`: link provenance and disclosure enforcement, separate from ranking logic.

Each skill should return a structured result with `status: pass|warn|blocked|conflict`, evidence paths, observed/chosen/derived fields, and a remediation that does not mutate the host unless explicitly authorized.

## Representative validation scenarios

1. Mac Apple Silicon: image has no arm64 manifest, required directory is not shared with Docker Desktop, or a case-sensitive path assumption fails. Stop before `up`.
2. Linux rootless: subordinate ID ranges are missing or a candidate data root is NFS. Explain the incompatibility and offer a local path/VM route.
3. Ubuntu firewall: a published port is reachable despite UFW rules. Require a `DOCKER-USER`/nftables policy review before exposure.
4. Existing Traefik/Caddy owns 80/443 or a managed port is occupied. Reuse or allocate an explicit alternate; never steal it.
5. Declared external network is absent or owned by another project. Mark conflict; do not auto-create or attach.
6. Arr/downloader paths use different container roots or different filesystems. Warn that hardlinks/atomic moves will not work and require a choice.
7. Unraid `appdata`/media share ACL prevents the container identity from writing. Repair through the Unraid share model, not blanket chmod.
8. TrueNAS dataset ACL maps a container to an unexpected identity. Show the numeric mapping and require confirmation.
9. Proxmox request targets an LXC. Route to a QEMU VM recommendation unless the user explicitly accepts nesting/security tradeoffs.
10. Caddy hostname lacks correct A/AAAA or 80/443; DNS challenge lacks a secret reference. Block ACME apply.
11. Cloudflare Tunnel has no public ingress but lacks an Access/auth policy; Pangolin lacks its public host/required ports; Tailscale Funnel was selected for a private request. Correct route before apply.
12. Gluetun baseline succeeds, tunnel break leaks a public request, or DNS falls back to the host. Fail the VPN gate and do not call it torrent-safe.
13. Backup restore into a fresh profile loses app database/library/request state or permissions. Mark backup policy unverified.
14. Digest-pinned upgrade changes schema and health fails. Preserve previous digest, restore snapshot/backup, and report forward-only migration risk.
15. Browser harness has no Chrome/CDP daemon. Stop UI validation and report an environment prerequisite; do not infer application failure from it.
16. A secret appears in a Compose plan, log, screenshot, or MCP artifact. Reject evidence, rotate if necessary, and rerun with redaction.

## Minimal implementation contract

An adapter is ready to apply only when it can answer all of these questions in a redacted plan:

- Which host and Docker context will change?
- Which project, network, containers, paths, and ports are owned by this run?
- Which existing resources are reused, and under what contract?
- Which non-secret preferences will persist, and where?
- Which secret references are needed, and when are they resolved?
- Which services may reach the public internet, and through what VPN/egress boundary?
- Who owns DNS, TLS, 80/443, and authentication?
- What data is backed up, when was restore last tested, and what is rollback?
- Which health/API/edge/VPN probes prove success?
- What exact action is blocked pending user choice?

The result should be idempotent for the same `(host context, project, profile hash)` and safe to rerun after interruption. It should never perform a host-wide `down`, remove volumes by default, mutate an existing proxy without an ownership decision, or claim success from process liveness alone.
