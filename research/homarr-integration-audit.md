# Homarr v2 integration audit

Checked: 2026-08-28

## Result

Homarr v2 currently defines 54 standard external integration kinds, excluding
the development-only `mock` integration. Docker and Kubernetes are documented
system surfaces outside that standard registry. The initial selfhost catalog
covered 30 of the standard integrations plus Docker; 24 standard integrations
and the Kubernetes system surface were missing.

App tiles, integrations, and widgets are distinct:

- an app is primarily a board link and status-check surface;
- an integration is a credentialed backend connection;
- a widget is a presentation or API surface that may consume an integration.

Homarr's Docker-label contract exposes those separately as `homarr.href`,
`homarr.integration`, and `homarr.widget`. Catalog support must therefore mean
an official integration exists, not merely that Homarr can display an app link.

The requested image contract remains
`ghcr.io/homarr-labs/homarr-test:v2`. This audit did not pull it.

## Sources

- [Official v2 integration index](https://v2.preview.homarr.dev/docs/category/integrations/)
- [Integration definitions](https://github.com/homarr-labs/homarr/blob/dev/packages/definitions/src/integration.ts)
- [Docker labels](https://v2.preview.homarr.dev/docs/integrations/docker-labels/)
- [Post-install app and integration guidance](https://v2.preview.homarr.dev/docs/getting-started/after-the-installation/)
- [Merged WUD integration PR](https://github.com/homarr-labs/homarr/pull/6523)
- [Homarr test-image issue](https://github.com/homarr-labs/homarr/issues/6600)

## Standard integration registry

| Identifier | Display name |
| --- | --- |
| `adGuardHome` | AdGuard Home |
| `anchor` | Anchor |
| `archiveTeamWarrior` | ArchiveTeam Warrior |
| `aria2` | Aria2 |
| `audiobookshelf` | Audiobookshelf |
| `bazarr` | Bazarr |
| `beszel` | Beszel |
| `coolify` | Coolify |
| `dashDot` | Dash. |
| `deluge` | Deluge |
| `emby` | Emby |
| `glances` | Glances |
| `gluetun` | Gluetun |
| `gotify` | Gotify |
| `homeAssistant` | Home Assistant |
| `ical` | iCal |
| `immich` | Immich |
| `jellyfin` | Jellyfin |
| `jellyseerr` | Jellyseerr |
| `lidarr` | Lidarr |
| `navidrome` | Navidrome |
| `nextcloud` | Nextcloud |
| `ntfy` | ntfy |
| `nzbGet` | NZBGet |
| `openmediavault` | OpenMediaVault |
| `opnsense` | OPNsense |
| `overseerr` | Overseerr |
| `paperlessNgx` | Paperless-ngx |
| `patchmon` | PatchMon |
| `peaNut` | PeaNUT |
| `piHole` | Pi-hole |
| `plex` | Plex |
| `prowlarr` | Prowlarr |
| `proxmox` | Proxmox |
| `qBittorrent` | qBittorrent |
| `radarr` | Radarr |
| `readarr` | Readarr |
| `sabNzbd` | SABnzbd |
| `seerr` | Seerr |
| `slskd` | Slskd |
| `sonarr` | Sonarr |
| `speedtestTracker` | Speedtest Tracker |
| `synology` | Synology DiskStation |
| `tdarr` | Tdarr |
| `technitiumDns` | Technitium DNS |
| `tracearr` | Tracearr |
| `traefik` | Traefik |
| `transmission` | Transmission |
| `truenas` | TrueNAS |
| `umami` | Umami |
| `unifiController` | Unifi Controller |
| `unraid` | Unraid |
| `uptimeKuma` | Uptime Kuma |
| `wud` | What's Up Docker |

Special documented surfaces are Docker and Kubernetes. `mock` is excluded.

## Required catalog changes

Add records for these 24 missing standard integrations:

- download and media: NZBGet, Deluge, Transmission, Aria2, Slskd, Lidarr,
  Overseerr, Tdarr, Audiobookshelf, Navidrome, and Tracearr;
- platforms and operations: OpenMediaVault, Dash., Glances, Unifi Controller,
  PatchMon, Speedtest Tracker, Synology DiskStation, PeaNUT, and What's Up
  Docker;
- communication and utility surfaces: Gotify, iCal, Anchor, and ArchiveTeam
  Warrior.

Add Kubernetes as a system/platform record because the catalog already models
Docker, hypervisors, and NAS platforms. Correct the existing integration labels
from `Readarr (legacy)` to `Readarr` and `Jellyseerr (legacy)` to `Jellyseerr`.
Their upstream lifecycle remains retired or transitioning independently from
Homarr's still-current integration support.

Do not add Search.ch or release-provider connections as global integrations;
v2 treats them as widget-level configuration. Do not add `mock`.

## Popular gaps

These catalog applications are absent from Homarr's current official list and
should remain `gap` even though Homarr can still link to them as app tiles:

- PhotoPrism, Frigate, Node-RED, Homebridge, Syncthing, and Seafile;
- Vaultwarden, Stirling PDF, Caddy, Nginx Proxy Manager, Tailscale, Headscale,
  WireGuard, Authentik, and Authelia;
- Prometheus, Grafana, Netdata, Gatus, Portainer, Dockge, Forgejo, and MinIO;
- Ollama, Open WebUI, Actual Budget, FreshRSS, and Stalwart Mail.

Absence from the official registry is not a popularity judgment and does not
rule out an unreleased or community integration.

## Browser-harness result

The auditor loaded the repository's agent-browser and research contracts and
created the isolated session `h-int-339c1029` with an allowlist limited to
Homarr and GitHub domains. The browser daemon exited before navigation without
output. The auditor did not add `--no-sandbox`, use authentication, restore
state, HAR, or recording. Official Homarr/GitHub pages were used through a
read-only fallback. Cleanup reported no active sessions.

This audit establishes source and catalog coverage. It does not prove a live
Homarr instance, integration authentication, widget behavior, or browser UI.
