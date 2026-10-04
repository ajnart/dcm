# Media service graph

Use one isolated Compose project and network per run. Default published ports
bind to all host interfaces; discover assigned values through the session helper
and approve router or Docker-aware firewall scope before starting that mode.
Explicit host-only runs bind all seven ports to 127.0.0.1.
Container-to-container connections use service DNS and internal ports.

```text
Prowlarr --full sync--> Sonarr ----+
          \----------> Radarr ----+--> qBittorrent --> owned media paths
                                      |
Jellyfin <--------- owned media paths-+
   ^
   +---------- Seerr ----------> Sonarr / Radarr

Homarr --> Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin, Seerr
```

- Prowlarr manages the tested indexer and full-sync applications for Sonarr and
  Radarr.
- Sonarr and Radarr use qBittorrent as their download client and write into the
  shared run-scoped data tree.
- Jellyfin exposes the Movies and Shows libraries from that same run-scoped
  media tree.
- Seerr authenticates against Jellyfin and delegates approved requests to the
  default Sonarr or Radarr service.
- Homarr onboarding tests and links all six external services. Its app links use
  run-scoped host URLs while integration ping URLs stay on the Compose network.

## Packaged images

| Service | Image |
| --- | --- |
| Prowlarr | `ghcr.io/hotio/prowlarr:latest` |
| Radarr | `ghcr.io/hotio/radarr:latest` |
| Sonarr | `ghcr.io/hotio/sonarr:latest` |
| qBittorrent | `ghcr.io/hotio/qbittorrent:latest` |
| Jellyfin | `ghcr.io/hotio/jellyfin:latest` |
| Seerr | `ghcr.io/seerr-team/seerr:latest` |
| Homarr | `ghcr.io/homarr-labs/homarr:dev` |

The bundle verifier treats this exact seven-image set as an invariant. The six
non-Homarr `:latest` references are allowed only in this isolated, disposable
evaluation harness with per-run ports. Production composition must go through
`selfhost-compose`, which rejects floating images. Do not replace them with
unverified pins; first verify the remote multi-architecture index digests.
