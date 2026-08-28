# qBittorrent TLDR

- Purpose: download client for Sonarr and Radarr.
- Image: `ghcr.io/hotio/qbittorrent:latest` (observed 5.2.3 on 2026-08-28).
- Internal URL: `http://qbittorrent:$QBITTORRENT_PORT`; this run deliberately
  uses the same dynamic port inside and outside the container.
- State: `/config`; downloads: `/data/torrents`.
- Authentication: `admin` plus a generated first-start password, replaced with
  the run's standard local password.

## Minimum fresh-run path

1. Run `scripts/session.sh bootstrap RUN_ID`. It consumes the temporary password
   from scoped logs without printing it, rotates to the standard login, and
   proves a fresh login.
2. It sets `/data/torrents`, an incomplete directory, and explicit
   `tv-sonarr`/`movies-radarr` category paths.
3. It configures and tests both Arr download clients against Docker host
   `qbittorrent` and the run's dynamic internal port.
4. Confirm the login and list state with agent-browser; do not repeat setup.

## Proof

- `POST /api/v2/auth/login` with the standard credentials returns HTTP 204 on
  the observed qBittorrent 5.2.3 image.
- `/api/v2/app/version` works with the resulting session cookie.
- Both Sonarr and Radarr download-client tests succeed.
- Homarr's qBittorrent integration test succeeds and its torrent widget loads.

## Traps

- The temporary password rotates whenever fresh config is created.
- qBittorrent rejects mismatched WebUI/Host-header ports. The session harness
  keeps `WEBUI_PORT`, `WEBUI_PORTS`, published port, and downstream port equal.
- API requests must send a matching `Origin` or `Referer`; preserve the exact
  run host and port when verifying `/api/v2`.
- qBittorrent 5.2.3 names its cookie `QBT_SID_<port>` in this setup. Capture and
  replay the actual cookie name instead of assuming the historical `SID` name.
- qBittorrent uses username/password here, not an API key.

Sources: [hotio image docs](https://hotio.dev/containers/qbittorrent/),
[official WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)).
