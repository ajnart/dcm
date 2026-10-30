---
title: Apps and Links
description: Choose self-hosted Apps from the Catalog and learn how Setup links Jellyfin, Sonarr, Radarr, qBittorrent and Homarr together.
sidebar:
  order: 4
---

An App is one deployable product in the Catalog, with its automatic Setup built into the binary. Browse [all Apps](/apps) or choose a [Recipe](/docs/recipes), a pre-wired bundle for one purpose.

## Choose your Apps

<figure>
  <img src="/images/readme/replaces-meet.svg" width="640" height="554" alt="Self-hosted alternatives: Netflix to Jellyfin, Spotify to Navidrome, Drive to Nextcloud, Dropbox to Syncthing, Photos to Immich, 1Password to Vaultwarden, Notion to Docmost, and ChatGPT to Open WebUI." loading="lazy" decoding="async" />
  <figcaption>These Catalog Apps cover media, music, files, photos, passwords, documents and AI chat. They are alternatives, not identical services: you provide the server, storage and any content or model they need.</figcaption>
</figure>

Read an App's requirements before installing it:

```bash
self-host apps info immich
self-host install immich
```

The install command shows a plan and asks before changing anything. Start with [Getting started](/docs/getting-started) for Docker Compose requirements and the dated platform-verification table; being in the Catalog does not mean an App has passed a launch run on every platform.

Prefer to keep your own `docker-compose.yaml`? [Docker Compose Maker](/compose) generates one, with a `.env`, for the same Apps and for containers outside the Catalog. It does not run Setup or Links.

## How Links work

Setup configures an installed App's accounts, API keys and settings. A Link is the part of Setup that wires it to another App, and runs once both Apps have finished their own Setup.

<figure>
  <img src="/images/readme/links-graph.svg" width="880" height="484" alt="Links connect Sonarr and Radarr to qBittorrent, Prowlarr to Sonarr and Radarr, Seerr to Jellyfin, Sonarr and Radarr, and Cleanuparr to Sonarr, Radarr and qBittorrent; Homarr shows tiles for the Apps." loading="lazy" decoding="async" />
  <figcaption>Arrows show which App consumes a Link. Sonarr and Radarr use qBittorrent as a download client; Seerr connects to Jellyfin, Sonarr and Radarr. Homarr adds native tiles and widgets for the Apps it supports.</figcaption>
</figure>

Each Link belongs to the consuming App. If Sonarr's Link to qBittorrent fails, Sonarr's Setup is incomplete, not qBittorrent's. Read the Debug report and retry the consuming App's Setup:

```bash
self-host debug sonarr
self-host setup sonarr
```

Browser-only steps are reported as Manual steps with a hint and stay retryable. See [Troubleshooting](/docs/troubleshooting) for unfinished Setup, or [Agents](/docs/agents) for the approval and verification rules when an agent runs the commands.
