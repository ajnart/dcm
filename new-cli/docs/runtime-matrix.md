# Runtime acceptance matrix

Status: **final**. Generated 2026-10-07T17:29:44.652650+00:00.

Inventory: 93 Apps and 20 Recipes (19 legacy Recipes plus `media`), 113 targets.

Outcomes: **awaiting-external-credentials: 8**, **failed: 3**, **manual: 5**, **pass: 97**.

Full per-App/Recipe stage results, source hashes, binary hashes, image IDs and cleanup: [runtime-matrix.json](runtime-matrix.json).

Heads are per target; results are not upgraded to the current source head.

Stage legend: `P` pass, `F` failed, `B` blocked, `M` manual, `NR` not-run, `MC` missing-configuration, `EC` awaiting-external-credentials, `LP` awaiting-local-prerequisites, `R` running.

Base stage order: install, Setup/Check, idempotency, restart, recovery, update, payload seed, backup, isolated Restore, restored Check, payload restored, sentinel. Specialized probes are named separately; the JSON records each result.

| Target | Outcome | Classification | Head | Base stage outcomes in order | Specialized probes | Image proof | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| app-actual-budget | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-adguard-home | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-archive-team-warrior | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 2 services; linux/amd64 | pass |
| app-aria2 | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-audiobookshelf | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-authelia | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-authentik | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| app-bazarr | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-beszel | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-bookstack | failed | runnable | 72898709c83a | F NR NR NR NR NR NR NR NR NR NR NR | none | 2 services; linux/amd64 | pass |
| app-borgmatic | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-caddy | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-cloudflare-tunnel | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |
| app-dashdot | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-deluge | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-dockge | manual | runnable | d724ebd4fb80 | M NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | pass |
| app-docmost | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| app-emby | manual | runnable | d724ebd4fb80 | M NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | pass |
| app-firefly-iii | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 2 services; linux/amd64 | pass |
| app-forgejo | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-freshrss | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-frigate | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-gatus | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-glances | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-gluetun | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |
| app-gotify | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-grafana | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-haproxy | pass | runnable | ee7975a8d094 | P P P P P P P P P P P P | backend-routing=P; restored-backend-routing=P | 2 services; linux/amd64 | pass |
| app-headscale | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-homarr | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-home-assistant | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-homebridge | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-immich | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 4 services; linux/amd64 | pass |
| app-jellyfin | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-keycloak | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 2 services; linux/amd64 | pass |
| app-kopia | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-lidarr | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-linkwarden | pass | runnable | ee7975a8d094 | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| app-lldap | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-loki | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-mayan-edms | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 4 services; linux/amd64 | pass |
| app-minio | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |
| app-navidrome | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-netbird | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | management-tls=P; restored-management-tls=P | 2 services; linux/amd64 | pass |
| app-netdata | pass | runnable | ee7975a8d094 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-nextcloud | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 4 services; linux/amd64 | pass |
| app-nginx-proxy-manager | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-node-red | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-ntfy | pass | runnable | d724ebd4fb80 | P P P P P P P P P P P P | none | 1 services; linux/amd64 | pass |
| app-nzbget | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-ollama | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-open-webui | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-pangolin | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 2 services; linux/amd64 | pass |
| app-paperless-ngx | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| app-passbolt | failed | runnable | b54733427f9c | F NR NR NR NR NR NR NR NR NR NR NR | local-prerequisites=NR; restored-local-prerequisites=NR | 3 services; linux/amd64 | pass |
| app-patchmon | pass | runnable | d4d352189363 | P P P P P P NR P P P NR P | none | 4 services; linux/amd64 | pass |
| app-peanut | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-photoprism | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-pihole | pass | runnable | d175e030a47f | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-plex | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |
| app-portainer | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-postgresql | pass | runnable | d724ebd4fb80 | P P P P P P P P P P P P | none | 1 services; linux/amd64 | pass |
| app-prometheus | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-prowlarr | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-qbittorrent | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-radarr | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-renovate | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | forge-token-identity=P; restored-forge-token-identity=P | 2 services; linux/amd64 | pass |
| app-restic | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-sabnzbd | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-scrypted | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-seafile | pass | runnable | ee7975a8d094 | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| app-seerr | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-slskd | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-sonarr | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-speedtest-tracker | failed | runnable | 72898709c83a | F NR NR NR NR NR NR NR NR NR NR NR | none | 1 services; linux/amd64 | pass |
| app-stalwart-mail | manual | runnable | b17d9de4a75a | M NR NR NR NR NR NR NR NR NR NR NR | none | 1 services; linux/amd64 | pass |
| app-stirling-pdf | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-syncthing | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-tailscale | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |
| app-tdarr | pass | runnable | e4297c75564b | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-technitium-dns | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-tracearr | pass | runnable | 2d961a5763b5 | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| app-traefik | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-transmission | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-umami | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 2 services; linux/amd64 | pass |
| app-unbound | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-uptime-kuma | manual | runnable | d724ebd4fb80 | M NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | pass |
| app-valkey | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-vaultwarden | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-vector | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-victoria-metrics | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| app-wud | pass | runnable | 11dbc7e55914 | P P P P P P P P P P P P | owned-inventory=P; restored-owned-inventory=P | 3 services; linux/amd64 | pass |
| app-zerotier | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| recipe-audio-library | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 2 services; linux/amd64 | pass |
| recipe-backups | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| recipe-dns | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 2 services; linux/amd64 | pass |
| recipe-documents | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 4 services; linux/amd64 | pass |
| recipe-download-privacy | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |
| recipe-files | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 4 services; linux/amd64 | pass |
| recipe-full | pass | runnable | d175e030a47f | P P P P P P NR P P P NR P | none | 18 services; linux/amd64 | pass |
| recipe-homarr-control-plane | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| recipe-home-automation | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| recipe-local-ai | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| recipe-media | pass | runnable | b17d9de4a75a | P P P P P P NR P P P NR P | none | 6 services; linux/amd64 | pass |
| recipe-monitoring | manual | runnable | b17d9de4a75a | M NR NR NR NR NR NR NR NR NR NR NR | none | 5 services; linux/amd64 | pass |
| recipe-owned-video-library | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| recipe-passwords | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| recipe-personal-finance | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 1 services; linux/amd64 | pass |
| recipe-personal-media | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |
| recipe-photos | pass | runnable | d724ebd4fb80 | P P P P P P NR P P P NR P | none | 4 services; linux/amd64 | pass |
| recipe-photos-and-files | pass | runnable | d175e030a47f | P P P P P P NR P P P NR P | none | 8 services; linux/amd64 | pass |
| recipe-private-notes | pass | runnable | f06f1b262c4d | P P P P P P NR P P P NR P | none | 3 services; linux/amd64 | pass |
| recipe-remote-access | awaiting-external-credentials | awaiting-external-credentials | d724ebd4fb80 | NR NR NR NR NR NR NR NR NR NR NR NR | none | not-recorded | not-run |

## Limits

- Final snapshot as requested; each target retains its own evidence identity.
- Read only ordinary exact app-<id>.json and recipe-<id>.json files; no private diagnostics, credentials or browser state.
- Each pass applies only to its recorded head, binary SHA256, image identities, host and probes. Later source fixes are not live passes.
- Missing or unrecorded stages are not-run. Historical source heads are retained even for untouched not-run records.
- Generic Setup/Check and archive sentinels do not prove browser acceptance, application workload, database-content recovery, migration, VPN fail-closed or external provider enrollment.
- Payload seed/restored stages provide only the App-specific probe named in the evidence. Absent payload stages are not-run, never inferred.
- Image IDs and cleanup are reproduced as recorded; this generator does not inspect Docker or independently establish expected service completeness.
- The matrix uses latest per-target records. Immutable archives preserve earlier iterations where available; two d175 failure records survive only in the redacted run log after they were overwritten before archival.
