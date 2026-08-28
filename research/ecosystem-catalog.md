# Self-hosting ecosystem catalog research

_Checked 2026-08-28. This is a research artifact for the Auto-Stack catalog; it does not change the runtime stack._

## Executive findings

- Homarr has a strong first-party integration surface for the media/download/NAS/DNS dashboard use case. Its current documentation enumerates roughly 55 integrations, while the [raw integration definitions](https://raw.githubusercontent.com/homarr-labs/homarr/dev/packages/definitions/src/integration.ts) are the better machine-readable source of names, categories, secret kinds, and default ports.
- The repository's seed is a coherent media-request path: Prowlarr -> Sonarr/Radarr -> qBittorrent, with Jellyfin and Seerr, surfaced by Homarr. See the local [compose file](../docker-compose.yml) and [experiment contract](../PROMPT.md). The seed is a useful T0 but is not a general self-hosting catalog.
- The largest Homarr gaps are control-plane and data-safety capabilities: password managers, identity providers, backup/restore, metrics/logs/traces, object storage, file synchronization alternatives, developer tooling, communication, and local AI. A generic URL tile is not equivalent to a supported integration.
- The catalog should separate upstream software from the container image that packages it. The seed uses several `hotio` images; those may be well maintained, but they are not the upstream projects. Record image provenance, tag/digest, architecture, and volume conventions independently.
- Lifecycle metadata is essential. Seerr supersedes the older Jellyseerr/Overseerr names; Readarr is retired and its repository is archived; NZBGet has a current successor under `nzbgetcom`; Home Assistant's old Core/Supervised installation modes are no longer supported; and several old Pi-hole, Immich, Uptime Kuma, and Jellyfin snippets are now misleading.
- A good first release should ship T0 (foundations and safe defaults), then T1 (common extensions). T2 should remain an explicit alternative or “verify before rollout” tier. Do not treat GitHub stars, Docker pulls, or a Reddit thread as a correctness or security guarantee.

## Scope and method

Technical facts below come from upstream documentation, source repositories, release/retirement notices, and the local compose/runbook. Community signals are explicitly labeled and used only to rank interest or expose likely operator pain. Popularity is a directional snapshot, not a deployment count. The date above is the validity boundary; release tags, image manifests, ports, and license terms should be rechecked before provisioning.

The Homarr baseline is the current [integration documentation index](https://homarr.dev/docs/category/integrations/), checked against the [integration-management behavior](https://homarr.dev/docs/management/integrations/) and source definitions. Homarr encrypts integration secrets in its database and does not send them to the browser, but an upstream API change can still break an integration. Its docs also require a base URL without a path and warn about host/container networking, reverse proxies, tunnels, firewalls, and DNS. Those are catalog validation requirements, not just UI concerns.

### Status and support vocabulary

| Label | Meaning |
| --- | --- |
| `supported` | Homarr has a named first-party integration definition and/or widget. |
| `partial` | Homarr can link, iframe, or discover the service generically, but has no equivalent dedicated integration. |
| `gap` | No current first-party Homarr integration was found. |
| `active` | Upstream source and release activity were visible at the check date. This is not a promise of a support SLA. |
| `transitioning` | A rename, merger, successor, or packaging transition needs migration-aware metadata. |
| `verify` | A sensible candidate, but current upstream lifecycle, image, license, or architecture needs a fresh check before an automated recommendation. |
| `retired` | Upstream has announced retirement or the repository is archived. Do not seed new installs. |

## Taxonomy: Homarr coverage and the major gaps

The names in the middle column are the current Homarr first-party surface, not a claim that every service is equally mature. The gaps column is the initial expansion target.

| Capability family | Homarr-supported today | Major gaps / catalog direction |
| --- | --- | --- |
| Media libraries and playback | Jellyfin, Emby, Plex, Audiobookshelf, Navidrome | PhotoPrism, LibrePhotos, Kavita, Komga, Owncast, Audiobookshelf-adjacent book tools. Record transcode GPU/device requirements separately. |
| Media request and automation | Seerr, Jellyseerr, Overseerr, Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Tdarr, Tracearr | Seerr is the current target; keep old names as migration aliases only. Readarr is retired. Add ErsatzTV, Kavita/Komga, and alternative request workflows as `verify`. |
| Torrent, Usenet, and other downloads | qBittorrent, Transmission, Deluge, Aria2, Slskd, SABnzbd, NZBGet, Gluetun, plus a downloads widget for these clients | Add current NZBGet successor metadata, VPN policy, seed/path conventions, and legal-content guardrails. Do not infer downloader health from an HTTP 200 alone. |
| Photos and video libraries | Immich | PhotoPrism, LibrePhotos, Ente/self-hosted alternatives, Lychee, photoview. Immich needs Postgres, Redis/Valkey, ML, and storage-aware backup fields. |
| Documents, PDF, OCR | Paperless-ngx | Mayan EDMS, Docspell, Stirling PDF, OCRmyPDF, Gotenberg, Apache Tika. Model ingest/consume, OCR, export, and archive separately. |
| File sync, cloud, and sharing | Nextcloud | Syncthing, Seafile, SFTPGo, File Browser, Pydio Cells, ownCloud. Distinguish synchronized folders from cloud collaboration and object storage. |
| Passwords and secrets | None found in the first-party catalog | Vaultwarden, Passbolt, Bitwarden self-host, KeePass-compatible sync, Infisical, OpenBao. A dashboard link must never imply that a password vault is Homarr-managed. |
| Home automation | Home Assistant | openHAB, Domoticz, Node-RED, Homebridge, Scrypted. Record host networking, USB/Zigbee/Z-Wave devices, and privileged access. |
| Cameras and physical security | None dedicated; UniFi Controller and OPNsense are adjacent | Frigate, Scrypted, Shinobi, ZoneMinder, Agent DVR, go2rtc. GPU/TPU inference and camera stream protocols are first-class dependencies. |
| DNS and ad blocking | AdGuard Home, Pi-hole, Technitium DNS | Keep all three as alternatives; port 53, DHCP, systemd-resolved, and LAN placement are conflict-prone. Add Blocky and Unbound as headless components. |
| Firewalls and network control | OPNsense, UniFi Controller | pfSense CE, VyOS, OpenWrt, Mikrotik/Omada controllers, NetBox/IPAM. Treat network appliances as hosts or external targets, not ordinary app containers. |
| Reverse proxy and ingress | Traefik | Caddy, Nginx Proxy Manager, HAProxy, Envoy, Kong, Cloudflare Tunnel. Capture certificate storage and whether the control plane is exposed. |
| VPN, tunnels, and mesh access | Gluetun (download-container VPN) | Tailscale, Headscale, NetBird, WireGuard, Netmaker, Cloudflare Tunnel, ZeroTier. Separate a private admin overlay from public ingress. |
| Identity, authentication, and SSO | Homarr consumes OIDC/LDAP for its own login, but no IdP is a catalog integration | Authentik, Authelia, Keycloak, Kanidm, LLDAP, Zitadel, Dex. Model OIDC/LDAP/SAML capabilities and the bootstrap/recovery path. |
| Uptime and host monitoring | Uptime Kuma, Beszel, Glances, PatchMon, Speedtest Tracker, PeaNUT, Dash | Gatus, Netdata, Zabbix, Checkmk CE. Homarr has no first-party Prometheus/Grafana/Loki/Tempo/OpenTelemetry surface. |
| Metrics, logs, and traces | No general metrics/logs/traces stack; some host/service widgets | Prometheus, VictoriaMetrics, Grafana, Loki, Tempo, Mimir, OpenTelemetry Collector, Vector, Fluent Bit. Add exporter and retention dependencies. |
| Backups and restore | No backup product integration found | restic, Kopia, Borg/Borgmatic, Duplicati, Kopia Repository Server, Proxmox Backup Server, K8up/Velero. The model must include app-native dumps and restore tests, not only a volume path. |
| Containers and orchestration | Docker, Kubernetes, Coolify | Podman, Portainer, Dockge, Komodo, Rancher, k3s, Nomad, Incus/LXD, Harbor, registry mirrors. Socket access and cluster credentials need explicit risk metadata. |
| Virtualization and NAS | Proxmox, OpenMediaVault, TrueNAS, Synology DiskStation, Unraid | XCP-ng, OpenNebula, Incus, CasaOS, Rockstor, Ceph, Longhorn, MinIO, Garage. NAS/virtualization software may be an OS or appliance, not a compose service. |
| Developer tooling and source control | Coolify is adjacent; no general source-control/CI integration found | Forgejo, Gitea, GitLab CE, Woodpecker CI, Jenkins, Buildkite agent, Renovate, Harbor, Sentry. Separate code hosting, CI runners, registry, and error tracking. |
| Productivity, notes, and knowledge | Nextcloud, Anchor, iCal | BookStack, Outline, Wiki.js, Vikunja, Joplin Server, TriliumNext, Linkwarden, Stirling PDF, Cal.com. Record external OAuth/storage dependencies. |
| Communications and notifications | Gotify, ntfy, iCal | Matrix/Synapse, Element, Mattermost, Zulip, Rocket.Chat, Mailpit, SMTP relay, Apprise. Push channels and federation have different exposure requirements. |
| Analytics and product telemetry | Umami | Plausible, Matomo, Metabase, Superset, PostHog, ClickHouse. Record data residency, cookies/consent, and database/warehouse dependencies. |
| Databases, queues, and object storage | No generic database/storage integration; service-specific dependencies are implicit | PostgreSQL, MariaDB, MySQL, Valkey/Redis, ClickHouse, MinIO, Garage, SeaweedFS, OpenBao. These should be dependency records, not necessarily dashboard tiles. |
| Local AI and media generation | None found | Ollama, llama.cpp, vLLM, LocalAI, Open WebUI, LiteLLM, ComfyUI, InvokeAI, Whisper, Piper, Immich ML. Record GPU/VRAM, model storage, model licenses, and network exposure. |
| Other useful self-hosted services | ArchiveTeam Warrior, WUD, Anchor, Speedtest Tracker | RSS/news (FreshRSS), recipes (Mealie), finance (Actual Budget, Firefly III), bookmarks (Linkwarden), mail (Stalwart/Mailcow), e-books (Kavita/Komga), and status pages (Uptime Kuma/Gatus). |

### What Homarr is particularly good at

The current catalog is unusually useful for a media-and-homelab dashboard: media servers, Arr services, download clients, DNS, firewalls, NAS/virtualization, notifications, and uptime all have named integration definitions. The [downloads widget](https://homarr.dev/docs/widgets/downloads/) supports SABnzbd, NZBGet, Deluge, Transmission, qBittorrent, Aria2, and Slskd and can expose queue/interactions according to permission level.

The boundary is important: Homarr's integrations are third-party API connections, not lifecycle management. Homarr can show and interact with a service, but it does not provision its database, migrate its schema, back it up, or guarantee that an upstream API remains stable. The [integration troubleshooting guidance](https://homarr.dev/docs/management/integrations/) explicitly calls out upstream breaking changes and host/container connectivity.

## Seed baseline from this repository

The current stack keeps host bindings on loopback and puts the services on one compose network. qBittorrent's host port is configurable; Homarr's definition uses 8080 as the common internal default. The table intentionally records image provenance separately from upstream application licensing.

| Seed service | Role and internal endpoint | Persistent state in this run | Homarr | Lifecycle/license note |
| --- | --- | --- | --- | --- |
| Prowlarr | Indexer manager, 9696/TCP | `/config` | Supported | Upstream GPL family; the run uses a third-party `ghcr.io/hotio/prowlarr` image. |
| Sonarr | TV automation, 8989/TCP | `/config`, shared `/data` | Supported | Upstream GPL-3.0; keep the shared path identical in Arr and download containers. |
| Radarr | Movie automation, 7878/TCP | `/config`, shared `/data` | Supported | Upstream GPL-3.0; API base and default port are documented by [Radarr](https://radarr.video/docs/api/). |
| qBittorrent | Torrent client, common WebUI 8080/TCP | `/config`, `/data/torrents` | Supported | Upstream GPL-2.0; host port is variable here. VPN routing and legal-content policy are external dependencies. |
| Jellyfin | Media server, 8096/TCP; optional 7359/UDP discovery | `/config`, `/cache`, `/data/media` | Supported | Upstream GPL-2.0; [official container guidance](https://jellyfin.org/docs/general/installation/container/) covers multi-architecture images, HWA, and optional host networking. |
| Seerr | Media request/discovery, 5055/TCP | `/app/config` | Supported | MIT; [Seerr merged the Jellyseerr and Overseerr projects](https://docs.seerr.dev/blog/seerr-release/) and provides a [migration guide](https://docs.seerr.dev/migration-guide/). |
| Homarr | Dashboard, 7575/TCP | `/appdata` | N/A (the catalog owner) | Apache-2.0; the repository advertises integrations, OIDC/LDAP SSO, encrypted integration secrets, and Docker/Kubernetes deployment options. |

The media dependency path is:

```text
Seerr -> Jellyfin (or Plex/Emby)
      -> Sonarr/Radarr -> Prowlarr -> qBittorrent (or SABnzbd/NZBGet)
      -> shared /data paths and media storage
Homarr -> read/interact integrations for each selected service
```

Use only media for which the operator has the necessary rights. The catalog describes orchestration and connectivity, not acquisition authorization.

## Prioritized initial catalog

The endpoint column uses common internal defaults. A host port is a separate deployment decision and must not be conflated with the container port. `varies` means the component is an agent, CLI, host OS, or deployment-specific service. `active` is a check-date signal, not a guarantee; `verify` is intentionally conservative.

### T0 — foundation and safe defaults

These should be the first catalog records because they cover the seed, the common data plane, and the minimum operational safety story.

| Record | Capability | Endpoint(s) | Shape and persistence | Status / license / caveat |
| --- | --- | --- | --- | --- |
| Homarr | Dashboard and integration hub | 7575/TCP | `/appdata`; one web app with encrypted integration records | Active, Apache-2.0; supported integration definitions are the source of truth. |
| Docker Engine + Compose | Container runtime | Unix socket; no app port | Host daemon; socket access is privileged | Active; package/runtime terms vary. Never expose the raw socket to an untrusted app. |
| Jellyfin | Video/music playback | 8096/TCP; 7359/UDP optional | `/config`, `/cache`, media bind mount; optional GPU `/dev/dri` | Active, GPL-2.0; use official image or record third-party image provenance. |
| Seerr | Requests and discovery | 5055/TCP | `/app/config`; connects to media server and Arr APIs | Active/transitioning, MIT; new installs should use Seerr, not the old aliases. |
| Sonarr + Radarr | TV/movie automation | 8989/7878 TCP | `/config` plus the same `/data` view as the download client | Active, GPL-3.0; path mapping is a correctness dependency. |
| Prowlarr | Indexer management/sync | 9696/TCP | `/config`; pushes configured indexers to Arr apps | Active, GPL family; upstream API/indexer availability is external. |
| qBittorrent | Torrent downloads | 8080/TCP common; peer ports vary | `/config`, downloads, incomplete/complete paths | Active, GPL-2.0; keep the WebUI private and record VPN/network policy. |
| Bazarr | Subtitle automation | 6767/TCP | `/config`; reads/writes the same media paths and uses Arr metadata | Active, GPL-3.0; optional rather than a hard media dependency. |
| Immich | Photo/video management | 2283/TCP; ML service commonly 3003; DB 5432 | Server + Postgres + Redis/Valkey + ML; uploads and DB are separate backup classes | Active, AGPL-3.0; [requirements](https://docs.immich.app/install/requirements/) recommend local SSD for Postgres and document architecture/RAM constraints. |
| Paperless-ngx | Document archive and OCR | 8000/TCP | Web + Postgres + Redis; `consume`, `media`, `data`, and export paths | Active, GPL family; [Docker setup](https://docs.paperless-ngx.com/setup/) recommends Compose/Postgres and documents OCR/Tika options. |
| Nextcloud | Cloud files, sharing, collaboration | Apache image 80/TCP; publish through 443/TCP | App + DB + Redis + data; optional office/collaboration sidecars | Active, AGPL-3.0; official image is community maintained while [AIO](https://github.com/nextcloud/all-in-one) is the vendor-supported easy path. |
| Vaultwarden | Bitwarden-compatible password vault | Container 80/TCP; publish behind TLS | `/data`; one server plus client apps | Active, AGPL-3.0; [unofficial compatibility server](https://github.com/dani-garcia/vaultwarden), not the Bitwarden vendor server. Review client compatibility and backup/recovery carefully. |
| Authentik | Identity provider / SSO | 9000/TCP HTTP, 9443/TCP HTTPS; metrics 9300 | Server + worker + Postgres + Redis; `/data`, `/certs`, `/templates` | Active; MIT core with separately licensed enterprise features. [Architecture](https://docs.goauthentik.io/core/architecture) and [Compose install](https://docs.goauthentik.io/install-config/install/docker-compose/) are authoritative. |
| Caddy or Traefik | TLS reverse proxy / ingress | 80/443; Traefik dashboard commonly 8080 | Certificate/config data; Docker provider may read the socket | Active; Caddy Apache-2.0, Traefik MIT. Never ship Traefik `api.insecure=true` outside a protected lab. |
| Tailscale or Headscale | Private remote access | No fixed web port for a client; control-plane ports vary | Tailscale state `/var/lib/tailscale`; Headscale config/state volumes | Active; Tailscale has a hosted/commercial control plane, Headscale is a self-hosted control server. Persist state and use secret refs for auth keys. |
| Uptime Kuma | Synthetic uptime/status | 3001/TCP | `/app/data`; POSIX file locks required | Active v2, MIT; NFS is unsupported in the official install notes. Avoid the deprecated Alpine/v1 tag. |
| Beszel | Lightweight host/container metrics | Hub 8090/TCP; agent commonly 45876/WebSocket | Hub `/beszel_data`; one agent per host, usually host network/read-only Docker socket | Active, MIT; [hub/agent docs](https://www.beszel.dev/guide/hub-installation) describe the topology and socket/device trade-offs. |
| Prometheus + Grafana | Metrics and dashboards | Prometheus 9090; Grafana 3000 | `/prometheus` and `/var/lib/grafana`; exporters/agents feed Prometheus | Active; Prometheus Apache-2.0, Grafana AGPLv3/commercial options. This is a major Homarr gap and a T0 operational addition. |
| restic or Kopia | Encrypted file/application backup | No fixed port; optional repository server | Repository plus scheduler; restic is typically a CLI job, Kopia can run a GUI/server | Active; restic BSD-2-Clause, Kopia Apache-2.0. Official [restic design](https://github.com/restic/restic/blob/master/doc/design.rst) and [Kopia repository model](https://kopia.io/docs/getting-started/) cover encrypted deduplicated repositories. |
| PostgreSQL | Common stateful dependency | 5432/TCP | `/var/lib/postgresql/data`; local SSD for latency-sensitive DBs | Active, PostgreSQL License; back it up with an app-consistent dump plus volume/repository policy. |
| Valkey | Redis-compatible queues/cache | 6379/TCP | `/data`; usually disposable cache plus optional durable queue state | Active, BSD-3-Clause; use the app's supported version and do not assume Redis/Valkey interchangeability without testing. |
| NAS/host platform | Storage and virtualization boundary | Host-specific | ZFS/pools, VM disks, shares; not an ordinary app volume | TrueNAS, OpenMediaVault, Proxmox, Synology, and Unraid are already Homarr-supported; record subscription/proprietary terms and host upgrade policy. |

### T1 — strong ecosystem extensions

These are good candidates after T0. Where several products fill the same role, store them as alternatives rather than installing all of them.

| Record(s) | Capability | Common endpoint(s) and shape | Status / selection note |
| --- | --- | --- | --- |
| SABnzbd | Usenet downloads | 8080/TCP; `/config` and downloads | Active, GPL family; a conservative default for Usenet automation. |
| NZBGet (`nzbgetcom/nzbget`) | Usenet downloads | 6789/TCP common; config and downloads | Active successor; the [current upstream](https://github.com/nzbgetcom/nzbget) has releases, while the old `nzbget/nzbget` repository is archived. Keep image and migration metadata explicit. |
| Transmission, Deluge, Aria2, Slskd | Alternative download clients | 9091, 8112, 6800 RPC, and 5030 are common defaults | Active/verify by project; all need download path, RPC auth, and exposure metadata. Homarr supports these clients in its integrations/download widget. |
| Lidarr | Music automation | 8686/TCP; `/config` + shared `/data` | Active/verify; GPL family. Validate upstream metadata and indexer support before making it a hard dependency. |
| Audiobookshelf + Navidrome | Audiobooks/podcasts and music | 13378 and 4533/TCP; config/metadata/media volumes | Active; open-source projects with different library/tag models. Audiobookshelf is a strong audiobook default; Navidrome is a lightweight music server. Both are Homarr-supported. |
| PhotoPrism, LibrePhotos, Photoview | Photo alternatives | Common web ports 2342, 3000, and deployment-specific | Active/verify; PhotoPrism has Pro/commercial features; each has different DB/AI/storage requirements. Use Immich as T0 unless a library-specific need favors an alternative. |
| Syncthing | Peer-to-peer file synchronization | GUI 8384; sync 22000 TCP/UDP; discovery 21027 UDP | Active, MPL-2.0; `/var/syncthing` or equivalent. It is not a backup or cloud collaboration product; the [FAQ](https://docs.syncthing.net/users/faq.html) calls out CPU, relay, and iOS limitations. |
| Seafile, SFTPGo, File Browser | Cloud/file sync and file transfer | Usually 80/443, 8080, or deployment-specific | Active/verify; Seafile editions and features differ, SFTPGo is a transfer server, File Browser is a simple UI. Store DB/object-storage dependencies and edition terms. |
| Passbolt | Team password management | 80/443 plus DB; TLS via proxy | Active, AGPL CE with commercial Pro features; strong alternative when organization sharing/audit matters more than Bitwarden compatibility. |
| Authelia, Keycloak, LLDAP, Kanidm | SSO and directory alternatives | Authelia 9091; Keycloak 8080; others vary | Active/verify. Authelia is a focused portal/MFA layer; Keycloak is a broad OIDC/SAML IdP; LLDAP/Kanidm provide directory primitives. Do not add an IdP without a recovery/bootstrap record. |
| Home Assistant | Home automation | 8123/TCP; often host network; `/config` and device/dbus mounts | Active, Apache-2.0. [Container install](https://www.home-assistant.io/installation/linux/) is supported for Docker users, while Home Assistant OS is recommended for most users. |
| Frigate, Scrypted, Shinobi | Camera/NVR/security | Frigate commonly 8971 web, 8554 RTSP, 8555 WebRTC | Active/verify; Frigate needs `/config`, `/media/frigate`, shared memory/tmpfs, and GPU/TPU mapping for practical detection. Physical camera streams and retention are large storage dependencies. |
| Node-RED, openHAB, Homebridge | Automation/integration runtimes | Node-RED 1880; others vary | Active/verify; separate event-bus/device permissions from dashboards. Node-RED is Apache-2.0; check add-on/node licenses. |
| Pi-hole, AdGuard Home, Technitium DNS | DNS/ad-blocking alternatives | DNS 53 TCP/UDP; web 80/443 or setup 3000; Technitium console 5380 | Active; each needs LAN placement and persistent config. [Pi-hole Docker docs](https://docs.pi-hole.net/docker/) and [AdGuard Docker guidance](https://github.com/AdguardTeam/AdGuardHome/wiki/Docker) cover port conflicts, volumes, and host networking. |
| Caddy, Nginx Proxy Manager, HAProxy | Ingress alternatives | 80/443; NPM admin 81; HAProxy varies | Active; choose one edge owner, store certificates in an explicit backup class, and keep admin endpoints private. |
| Cloudflare Tunnel, NetBird, WireGuard/Netmaker | Remote/public access alternatives | Tunnel has no inbound app port; other control planes vary | Active/verify; Cloudflare and Tailscale have hosted-control-plane/commercial terms. Use an outbound tunnel for selected apps, not as a substitute for authorization. |
| Gatus, Netdata, VictoriaMetrics | Lightweight checks/metrics | Gatus 8080; Netdata 19999; VictoriaMetrics 8428 | Active/verify; Gatus is synthetic checks, Netdata is host observability, VictoriaMetrics is a Prometheus-compatible storage/metrics layer. |
| Loki, Tempo, OpenTelemetry Collector, Vector | Logs/traces/telemetry | Loki 3100; OTLP 4317/4318; others vary | Active/verify; treat retention, cardinality, and PII as data-governance fields. No current Homarr first-party integration was found. |
| Portainer, Dockge, Komodo | Container management | Portainer 9443 (and optional 8000); Dockge commonly 5001; Komodo varies | Active/verify; Portainer has CE/Business boundaries. Dockge and Komodo need stack directory/socket access; record the security cost. |
| Forgejo, Gitea, GitLab CE | Git hosting | Forgejo/Gitea 3000 + SSH 22; GitLab commonly 80/443 + SSH | Active; GitLab has an open-core/commercial boundary. Keep repositories, runners, registry, and CI credentials separate. |
| Woodpecker CI, Jenkins, Renovate | CI and dependency automation | Deployment-specific; runners need workspace/registry access | Active/verify; high-impact credentials deserve a separate capability and least-privilege policy. |
| BookStack, Outline, Wiki.js, Vikunja, Joplin Server | Knowledge/tasks | BookStack/Outline often 80/3000; Vikunja 3456; Joplin 22300 | Active/verify; Outline/Joplin commonly need Postgres/Redis and object storage; BookStack is simpler. |
| Matrix Synapse, Mattermost, ntfy, Gotify | Communications and notifications | Synapse 8008/8448; Mattermost 8065; ntfy/Gotify commonly 80/443 | Active/verify; Mattermost has commercial tiers, Matrix federation changes exposure, and ntfy/Gotify are focused push systems. |
| FreshRSS, Mealie, Actual Budget, Firefly III, Linkwarden | Personal productivity | Common web ports 80/3000/8080 or deployment-specific | Active/verify; useful “other” category coverage, with DB/storage/auth requirements recorded per app. |
| Umami, Plausible, Matomo, Metabase | Analytics/BI | 3000/8000/80/3000 common | Active/verify; Umami is already Homarr-supported. Consent, cookie, warehouse, and commercial terms vary. |
| MinIO, Garage, SeaweedFS | Object/blob storage | MinIO commonly 9000 API and 9001 console; others vary | Active/verify; useful for Nextcloud, backups, media exports, and AI models. MinIO has changed licensing/edition terms over time; always inspect the current repository/license. |
| Ollama, Open WebUI, LiteLLM, LocalAI | Local LLM serving/UI/proxy | Ollama 11434; Open WebUI 8080; others vary | Active/verify; model weights have independent terms, GPU/VRAM is material, and public exposure is unsafe without strong auth. |
| n8n, Node-RED | General workflow automation | n8n 5678; Node-RED 1880 | Active/verify; n8n uses a fair-code/Sustainable Use licensing model rather than a conventional OSI license; commercial-use boundaries must be visible in catalog metadata. |

### T2 — alternatives, commercial boundaries, and niche entries

T2 is not “bad”; it is where the choice depends strongly on hardware, team size, hosted-control-plane preference, or licensing. Candidates include Plex and Emby (proprietary/freemium media options), Resilio Sync (proprietary synchronization), Unraid and Synology DSM (commercial/proprietary host platforms), Proxmox Backup Server (subscription-supported host backup), Zabbix/Checkmk (larger monitoring operations), GitLab/Mattermost/Portainer enterprise editions, Cloudflare Tunnel/Tailscale hosted plans, and specialized AI/camera systems. Store these with an explicit `commercial_features` field rather than flattening them into “open source.”

## Stack recipes

All recipes assume a private management network, a reverse proxy or mesh access layer, secret references rather than literal values, and an off-host backup target. Host ports are examples; the catalog must allocate them per deployment.

### Netflix-like personal media

```text
Homarr (7575)
  -> Seerr (5055)
       -> Jellyfin (8096)
       -> Sonarr (8989) / Radarr (7878)
            -> Prowlarr (9696)
            -> qBittorrent (common 8080) or SABnzbd (8080)
       -> optional Bazarr (6767)
```

- Use one shared path view (`/data`) for Arr services and the download client; place completed media and incomplete downloads in deliberate subdirectories.
- Persist each app's config separately. Media is large and replaceable; configs, databases, API keys, and request history need tighter backup/restore treatment.
- Jellyfin may need `/dev/dri` or another accelerator device for practical transcoding. The [HWA guide](https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/) lists supported paths and calls out old Raspberry Pi V4L2 guidance as deprecated.
- Expose Seerr and Jellyfin through the selected private ingress/mesh; keep Arr, Prowlarr, qBittorrent, and indexer credentials off the public edge.
- This recipe is for legally obtained content. A catalog entry should not encode or encourage copyright infringement.

### Photos

```text
Immich (2283)
  -> PostgreSQL (5432, local SSD)
  -> Redis/Valkey (queue/cache)
  -> machine-learning service (commonly 3003)
  -> upload/library storage
```

- Follow the [Immich Compose install](https://github.com/immich-app/immich/blob/main/docs/docs/install/docker-compose.mdx) and pin a tested release. Use `docker compose`, not legacy `docker-compose` snippets.
- Keep the Postgres data directory on local SSD; the official requirements warn against putting the database on a network share. Back up database, uploads, machine-learning/config state, and any external library mapping separately.
- Nextcloud can complement Immich for file sharing, but it is not a substitute for Immich's photo index, ML, and mobile workflow. PhotoPrism/LibrePhotos are alternatives, not co-requisites.

### PDFs and scanned documents

```text
Paperless-ngx (8000)
  -> PostgreSQL (5432)
  -> Redis (queue)
  -> consume/ingest + media/archive + export paths
  -> optional Apache Tika / Gotenberg for Office/PDF conversion
```

- Use the [Paperless setup guide](https://docs.paperless-ngx.com/setup/) and its Docker Compose profile for Postgres. Keep `consume` as an ingestion boundary, not the only copy of the archive.
- OCR language packages, rootless containers, NFS, and inotify/polling choices affect reliability. The official docs note that NFS may require polling; record that as a deployment flag.
- Back up the database and media/archive, and test a restore that reindexes a document. Treat OCR derivatives as rebuildable only if the original source and metadata are safe.

### Dropbox-like file cloud

```text
Reverse proxy (443)
  -> Nextcloud AIO or official Apache image (80)
       -> PostgreSQL/MariaDB
       -> Redis
       -> data volume
       -> optional Collabora/OnlyOffice and object storage
Syncthing (optional) -> peer device folders, not a cloud substitute
```

- Use [Nextcloud AIO](https://github.com/nextcloud/all-in-one) for the vendor-supported bundled path, or the [official Docker image](https://github.com/nextcloud/docker) when composing dependencies deliberately. The official image docs distinguish Apache and FPM variants and list persistent paths.
- Store the data directory on reliable storage and use a reverse proxy for TLS. If using Collabora/OnlyOffice, make the office service a separate dependency with its own resource/backup policy.
- Syncthing is a strong private device-folder sync companion, but the upstream FAQ explicitly distinguishes synchronization from backup and notes relay/CPU/iOS trade-offs. Do not market a Syncthing record as “Dropbox.”

### Backups and restore

```text
App-native dumps / quiesce hooks
  -> restic, Kopia, Borg/Borgmatic, or Duplicati client
       -> local staging + off-host S3/B2/SFTP/PBS repository
       -> retention / immutability policy
       -> scheduled restore test
```

- Back up application databases consistently: use native dump/export or stop/quiesce hooks before copying files. A snapshot of a live DB volume is not automatically a valid backup.
- Keep at least one repository off the primary host, protect repository credentials separately, and record object-lock/append-only support where available. RAID, ZFS snapshots, and replication improve availability but do not replace an independent backup.
- T0 should provide a backup plan for Homarr, Arr configs, Seerr, Immich DB/uploads, Paperless DB/media, Nextcloud DB/data, Authentik DB/config, and the catalog's own metadata. Add a periodic restore test as an acceptance criterion.

### Remote access

```text
Private tailnet: Tailscale client or Headscale control server
  -> private DNS / reverse proxy -> selected apps

Public/managed edge: Cloudflare Tunnel (outbound connector)
  -> identity-aware policy -> reverse proxy/app
```

- Tailscale's [container guide](https://tailscale.com/docs/features/containers/docker/how-to/connect-docker-container) requires persistent state and recommends supplying auth keys as secrets. Kernel networking needs the TUN device/capabilities; userspace networking has different reachability.
- Headscale is a self-hosted Tailscale-compatible control server. Keep its state and versioned image pinned; do not use a development `main` image in a production catalog.
- Cloudflare Tunnel avoids inbound port forwarding but introduces a hosted control plane and terms. It is a public-edge option, not a replacement for app authentication. In all cases, never publish database, qBittorrent, Arr, Docker, or identity-admin ports directly.

## Capability dependencies

Dependencies should be graph records so a catalog UI can explain why an app cannot be deployed in isolation.

| Capability | Required/typical dependencies | Failure and backup implications |
| --- | --- | --- |
| Media request | Seerr + Jellyfin/Plex/Emby + at least one Sonarr/Radarr + Prowlarr/indexer + download client + shared paths | API credentials, service-name DNS, path mapping, and legal-content policy. Back up request/config state and Arr databases. |
| Video playback | Jellyfin/Emby/Plex + media storage + optional GPU/HWA devices + optional reverse proxy | HWA is hardware/driver specific. Library metadata/config can be restored separately from large media. |
| Subtitles | Bazarr + Sonarr/Radarr + media path + subtitle/indexer credentials | Permissions and path mappings cause common failures; store subtitle language/profile settings. |
| Photos | Immich + Postgres + Redis/Valkey + ML + upload/library storage | Postgres must be on suitable local storage; back up DB and originals/uploads, not just thumbnails. |
| Documents | Paperless + Postgres + Redis + consume/media/data/export + OCR and optional Tika/Gotenberg | NFS/inotify and OCR language choices affect ingestion. Test archive plus DB restore. |
| Cloud files | Nextcloud + DB + Redis + data + TLS reverse proxy + optional office/object storage | Data and DB must be backed up together; app upgrades can require maintenance mode and DB migrations. |
| Device sync | Syncthing/Seafile/SFTPGo + peer/device credentials + storage | Sync is not backup; conflicts, deletions, and relay behavior need explicit policy. |
| Passwords | Vaultwarden or Passbolt + TLS + recovery/export + optional SMTP | Vault data and encryption/recovery material are high consequence; no public unauthenticated dashboard link. |
| SSO | Authentik/Authelia/Keycloak/Kanidm + DB/Redis as applicable + reverse proxy + recovery admin | A bad IdP rollout can lock out every app. Keep a break-glass path and back up directory/IdP state before changing providers. |
| Home automation/security | Home Assistant/openHAB + host network/device mounts + MQTT/Zigbee/Z-Wave + Frigate/Scrypted cameras as needed | Device passthrough/privilege and high-volume media retention must be represented. |
| DNS | Pi-hole/AdGuard/Technitium + LAN clients/router/DHCP + port 53 ownership | A DNS outage can make every app look down. Keep a fallback resolver and avoid host port conflicts. |
| Public ingress | Caddy/Traefik/Nginx Proxy Manager + DNS + certificate storage + auth middleware | Certificate files and proxy config need backup; Docker socket read/write is a high-risk dependency. |
| Private remote access | Tailscale/Headscale/NetBird/WireGuard + persistent node/control state + identity secrets | State loss can require re-enrollment; auth keys belong in secret stores, never catalog values. |
| Observability | Exporters/agents -> Prometheus/VictoriaMetrics -> Grafana; Loki/Tempo/OTel for logs/traces; Uptime Kuma/Gatus for synthetic checks | Retention, labels, and PII can dominate storage. Monitoring must not depend on the same failure domain it reports on. |
| Backup | Scheduler + app-native dump/quiesce hook + restic/Kopia/Borg + off-host repository + restore test | Repository access and restore credentials are separate secrets; record retention and object-lock semantics. |
| Containers | Docker/Podman + Compose/Swarm/Kubernetes + registry + optional management UI | Socket/cluster credentials are equivalent to host control. Pin image digests and check architecture manifests. |
| Local AI | Ollama/vLLM/llama.cpp + model store + Open WebUI/LiteLLM + GPU/VRAM + model/license metadata | Model downloads are large; model licenses differ from server licenses; bind the API privately and rate-limit. |

## Deprecated, avoid, and verify-before-rollout list

| Avoid or flag | Why | Replacement or migration source |
| --- | --- | --- |
| New Overseerr/Jellyseerr installs | The teams merged into Seerr; old names are migration aliases, not the preferred new record. | [Seerr release announcement](https://docs.seerr.dev/blog/seerr-release/) and [migration guide](https://docs.seerr.dev/migration-guide/). |
| Readarr as a new dependency | The upstream repository was archived on 2025-06-27 and contains an official retirement announcement. | Keep it `retired`; use Audiobookshelf/Kavita/Komga/BookStack or a future replacement only after a fresh upstream review. [Archived repo](https://github.com/Readarr/Readarr). |
| The old `nzbget/nzbget` image/repository | The old upstream organization is archived; current maintenance is under `nzbgetcom/nzbget`. | Use the [current upstream](https://github.com/nzbgetcom/nzbget), pin a release, and verify migration of config/download paths. |
| Home Assistant Core or Supervised as a new standalone install | Official FAQ says the old Core and Supervised methods are no longer offered/supported. | Home Assistant OS for most users, or the supported [Container install](https://www.home-assistant.io/installation/linux/) for existing Docker operators. |
| Uptime Kuma v1 or `:alpine` | The official install notes mark the old Alpine tag as deprecated because of DNS issues. | Use v2 (`louislam/uptime-kuma:2` or a pinned release) and `/app/data`. |
| Pi-hole v5 configuration snippets | Pi-hole v6 changes environment/config behavior; the last v5 Docker image was 2024.07.0 and old `/etc/dnsmasq.d` assumptions can silently fail. | Follow the [v5-to-v6 migration](https://docs.pi-hole.net/docker/upgrading/v5-v6/) and current [Docker docs](https://docs.pi-hole.net/docker/). |
| Legacy Immich `docker-compose` snippets or DB on a network share | `docker compose` is the current command and Immich warns that Postgres belongs on local suitable storage, not a network share. | Use the current [Compose install](https://github.com/immich-app/immich/blob/main/docs/docs/install/docker-compose.mdx) and requirements. |
| Old Jellyfin Raspberry Pi OMX/V4L2 HWA snippets | Current Jellyfin docs deprecate Raspberry Pi V4L2 support because it lacks full acceleration. | Use a supported QSV/NVENC/VA-API/VideoToolbox/RKMPP path or accept CPU transcoding. |
| Traefik `api.insecure=true` on a reachable interface | It publishes an unauthenticated dashboard/API in quick-start examples. | Use TLS, auth middleware, and a private management network; the [quick start](https://doc.traefik.io/traefik/getting-started/quick-start/) labels insecure mode for development. |
| Writable Docker socket mounted into arbitrary apps | Socket access is effectively host/daemon control and creates a large blast radius. | Prefer read-only or a socket proxy, isolate management UIs, and record the exception in `security_requirements`. |
| Unqualified `latest` for stateful/critical services | A floating tag makes rollback, architecture, and migration behavior non-deterministic. | Pin a release or digest, record upgrade notes, and run a restore/compatibility check before promotion. |
| Treating third-party container images as upstream | Hotio, LinuxServer, vendor, and community images can have different users, paths, tags, and release cadence. | Keep `upstream_repo` and `image_source` separate; validate each image manifest and volume contract. |
| Homarr legacy global release-provider assumptions | Homarr's changes moved release-provider/Search.ch behavior into widget options; widget-visible options cannot safely carry provider credentials. | Keep provider credentials scoped to their widget/integration type; use the current [changes](https://github.com/homarr-labs/homarr/blob/dev/CHANGES.md). |

## Candidate declarative fields

These fields are intentionally implementation-neutral. They support Compose, Kubernetes, a host-installed service, or an external appliance without pretending all four have the same lifecycle.

| Field | Shape | Purpose |
| --- | --- | --- |
| `id`, `display_name`, `category[]`, `capabilities[]`, `role` | strings/lists | Stable catalog identity and user-facing taxonomy; categories are not limited to Homarr's categories. |
| `upstream_url`, `docs_url`, `source_repo`, `license`, `license_evidence`, `commercial_features` | URLs/strings | Primary evidence and license/commercial boundary. Never infer “free” from “has a GitHub repo.” |
| `status`, `maintenance_signal`, `checked_at`, `retirement_or_migration` | enum/object/date | `active`, `transitioning`, `verify`, `retired`; include the evidence and replacement. |
| `image`, `image_source`, `tag_policy`, `digest`, `architectures` | strings/lists | Distinguish upstream project from packager, pin policy, and `amd64`/`arm64`/other image support. |
| `ports[]` | `{container, host?, protocol, purpose, exposure}` | Separate container from host port, TCP/UDP, public/private, and why the port exists. Allow `varies`/no port for agents and host services. |
| `volumes[]` | `{container_path, host_or_claim?, purpose, data_class, backup_class, readonly?}` | Distinguish config, DB, cache, media, ingest, models, and certificates. Mark data as rebuildable, protected, or replaceable. |
| `networks[]`, `dns_requirements`, `host_network`, `devices[]`, `privileged`, `capabilities[]` | lists/booleans | Capture service discovery, LAN/DHCP needs, GPU/USB/TUN access, and privilege risk. |
| `depends_on[]`, `external_dependencies[]` | references | Postgres, Redis/Valkey, DBus, GPU runtime, SMTP, DNS, object storage, indexer, or host appliance relationships. |
| `healthcheck`, `readiness`, `startup_order`, `restart_policy`, `init` | objects | Make “container started” distinct from “API usable,” especially for DB/worker stacks. |
| `auth` | `{modes, bootstrap, recovery, oidc?, ldap?, api?}` | State supported authentication, first-admin path, break-glass recovery, and whether an API key is required. |
| `secret_refs[]` | references only | Point to Docker/Kubernetes/host secret names. Never store values, generated keys, session cookies, or passwords in the catalog or evidence. |
| `ingress` | `{url_template, tls, auth_proxy, public, allowed_networks}` | Link safely through a reverse proxy or tailnet and make exposure explicit. |
| `homarr` | `{support, integration_kind?, widget_kinds?, permissions?, default_url?}` | `supported`, `partial`, or `gap`; keep widget/provider credentials distinct from app links. |
| `links[]` | `{label, target, relation, condition?}` | Human navigation and dependency graph edges such as “Seerr -> Jellyfin” or “Grafana -> Prometheus.” |
| `backup_policy` | `{app_dump, quiesce, paths, repository, retention, immutable?, restore_test}` | Describe how to produce a consistent backup and prove that it restores. |
| `upgrade_notes`, `migration_notes`, `known_pitfalls[]` | text/lists | Pi-hole v6, Seerr migration, Immich DB/storage, image user/path differences, and other known transitions. |
| `popularity_signal` | `{source, kind, checked_at, confidence, note}` | GitHub activity/stars, Docker pulls, community discussion, or internal adoption; explicitly label it as a weak/strong directional signal. |
| `security_requirements[]`, `legal_or_usage_notes[]` | lists | Socket/privileged access, public-edge rules, model/media licensing, and other constraints visible before install. |

Secret-safe policy: catalog records may contain a secret reference such as `secret_refs: ["seerr/api-key"]`, never the value. Screenshots, logs, generated compose files, and research notes must be checked for tokens, cookies, passwords, private keys, and API keys before they enter the repository.

## Community signals and known operator pain

These are qualitative signals only; official docs remain authoritative.

- GitHub repository activity, release history, stars/forks, and Docker image pulls indicate interest and maintenance effort, but they do not prove safety, supportability, or production adoption. Use them as `popularity_signal` with a date and confidence rather than as a ranking oracle.
- A [community report about a missing Homarr GitHub integration](https://www.reddit.com/r/homarr/comments/1uvxsme/did_homarr_just_quietly_remove_github_integrations/) is unverified user evidence, but it illustrates why a catalog needs an upstream evidence URL and a transition state instead of assuming the UI list is permanent.
- Readarr retirement discussions in [r/selfhosted](https://www.reddit.com/r/selfhosted/comments/1llqji9/the_readarr_project_has_been_retired/) are useful for understanding the operator impact of a dead metadata service; the archived upstream repository and retirement notice are the actual lifecycle evidence.
- Repeated pain points confirmed in primary docs are more actionable than popularity anecdotes: Seerr cannot use `localhost` to reach a sibling container on a bridged Docker network; Paperless may need polling on NFS; Uptime Kuma requires POSIX file locks and does not support NFS; Immich's Postgres should be on local suitable storage; Traefik's Docker socket and insecure dashboard need protection; Jellyfin HWA needs matching host devices/drivers. These should become validation rules or warnings in the declarative schema.

## Primary source index

### Homarr

- [Integration index](https://homarr.dev/docs/category/integrations/)
- [Integration management, permissions, and troubleshooting](https://homarr.dev/docs/management/integrations/)
- [Raw integration definitions](https://raw.githubusercontent.com/homarr-labs/homarr/dev/packages/definitions/src/integration.ts)
- [Downloads widget](https://homarr.dev/docs/widgets/downloads/)
- [Homarr repository and README](https://github.com/homarr-labs/homarr)
- [Current changes/migrations](https://github.com/homarr-labs/homarr/blob/dev/CHANGES.md)
- [Helm installation](https://homarr.dev/docs/getting-started/installation/helm/)

### Seed and media

- Local [compose file](../docker-compose.yml), [contract](../PROMPT.md), and [docs index](../docs/README.md)
- [Jellyfin container installation](https://jellyfin.org/docs/general/installation/container/), [hardware acceleration](https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/)
- [Radarr API](https://radarr.video/docs/api/)
- [Seerr getting started](https://docs.seerr.dev/getting-started/), [media-server settings](https://docs.seerr.dev/using-seerr/settings/mediaserver/), [service settings](https://docs.seerr.dev/using-seerr/settings/services/)
- [Seerr source repository](https://github.com/seerr-team/seerr)

### Photos, documents, and cloud

- [Immich requirements](https://docs.immich.app/install/requirements/), [environment variables](https://docs.immich.app/install/environment-variables/), [Compose installation](https://github.com/immich-app/immich/blob/main/docs/docs/install/docker-compose.mdx)
- [Paperless-ngx setup](https://docs.paperless-ngx.com/setup/), [configuration](https://docs.paperless-ngx.com/configuration/), [source repository](https://github.com/paperless-ngx/paperless-ngx)
- [Nextcloud official Docker image](https://github.com/nextcloud/docker), [Nextcloud AIO](https://github.com/nextcloud/all-in-one)
- [Syncthing repository](https://github.com/syncthing/syncthing), [FAQ](https://docs.syncthing.net/users/faq.html)

### Passwords, identity, and automation/security

- [Vaultwarden repository](https://github.com/dani-garcia/vaultwarden), [container guide](https://github.com/dani-garcia/vaultwarden/blob/main/docker/README.md)
- [Authentik Compose install](https://docs.goauthentik.io/install-config/install/docker-compose/), [architecture](https://docs.goauthentik.io/core/architecture), [license](https://github.com/goauthentik/authentik/blob/main/LICENSE)
- [Authelia repository](https://github.com/authelia/authelia), [Keycloak Docker guide](https://www.keycloak.org/getting-started/getting-started-docker), [LLDAP repository](https://github.com/lldap/lldap)
- [Home Assistant Linux/container install](https://www.home-assistant.io/installation/linux/), [container architecture ADR](https://github.com/home-assistant/architecture/blob/master/adr/0013-home-assistant-container.md), [HA vs. Supervised FAQ](https://www.home-assistant.io/faq/ha-vs-hassio/)
- [Frigate getting started](https://docs.frigate.video/guides/getting_started/), [hardware acceleration](https://docs.frigate.video/configuration/hardware_acceleration_video)

### DNS, ingress, tunnels, and monitoring

- [Pi-hole Docker](https://docs.pi-hole.net/docker/), [v5-to-v6 migration](https://docs.pi-hole.net/docker/upgrading/v5-v6/)
- [AdGuard Home Docker](https://github.com/AdguardTeam/AdGuardHome/wiki/Docker)
- [Technitium Docker Compose](https://github.com/TechnitiumSoftware/DnsServer/blob/master/docker-compose.yml)
- [Traefik quick start](https://doc.traefik.io/traefik/getting-started/quick-start/)
- [Tailscale container guide](https://tailscale.com/docs/features/containers/docker/how-to/connect-docker-container), [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
- [Headscale container install](https://headscale.net/stable/setup/install/container/)
- [Uptime Kuma install](https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install)
- [Beszel hub installation](https://www.beszel.dev/guide/hub-installation), [agent installation](https://beszel.dev/guide/agent-installation)
- [Prometheus installation](https://prometheus.io/docs/prometheus/latest/installation/), [Grafana Docker installation](https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/)

### Backups and storage

- [restic repository](https://github.com/restic/restic), [design](https://github.com/restic/restic/blob/master/doc/design.rst), [documentation](https://restic.readthedocs.io/en/stable/)
- [Kopia installation](https://kopia.io/docs/installation/), [repository model](https://kopia.io/docs/getting-started/), [Docker Compose example](https://github.com/kopia/kopia/blob/master/tools/docker/docker-compose.yml)
- [Proxmox Backup Server documentation](https://pbs.proxmox.com/docs/)

