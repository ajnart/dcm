# Seerr TLDR

- Purpose: user-facing movie/TV request portal backed by Jellyfin, Sonarr, and
  Radarr; supplies Homarr media-request widgets and Spotlight search.
- Image: `ghcr.io/seerr-team/seerr:latest` (observed v3.4.1 on 2026-08-28).
- Internal URL: `http://seerr:5055`; host URL comes from `scripts/session.sh urls`.
- State: `/app/config`; container runs as UID/GID 1000; `init: true` is required.
- Health: `/api/v1/settings/public`.
- Secret: per-run `SEERR_API_KEY`, injected with `API_KEY`; never reveal it.

## Minimum fresh-run path

1. Initialize Seerr using Jellyfin. Its split form expects host `jellyfin`, port
   `8096`, disposable email `admin@example.test`, and username `admin`. Fill the
   fresh password ref through
   `scripts/session.sh browser-password "$RUN_ID" @eN`. Focus the action and
   press Enter if a mouse click is inert.
2. Sync, select Movies and Shows, set the host URL as External URL, save, and
   start the first manual scan.
3. Add Radarr: hostname `radarr`, port `7878`, no SSL, per-run Radarr API key,
   default non-4K server, a quality profile, `/data/media/movies`, scan enabled.
4. Add Sonarr: hostname `sonarr`, port `8989`, no SSL, per-run Sonarr API key,
   default non-4K server, a quality profile, `/data/media/tv`, scan enabled.
   Select the standard and anime profile/root fields, enable season folders,
   and enable automatic search for both services.
5. Finish setup and verify the Discover page.
6. Add Seerr to Homarr during Homarr onboarding using `http://seerr:5055` and
   the per-run Seerr API key.

## Proof

- `session.sh verify` requires initialized public settings, exact loopback
  external URLs, and exact persisted Sonarr and Radarr API keys.
- Its read-only GET probes require a persisted Jellyfin user plus matching
  Radarr/Sonarr service IDs and nonempty service-detail profiles and roots.
- Both service tests succeed with selected profiles/root folders.
- Homarr's Seerr integration test succeeds; request list/stats/search capability
  is present on the generated dashboard.

## Traps

- `localhost` and `127.0.0.1` are invalid internal Docker targets.
- Rootless Docker remaps container UID 1000. The isolated session creator makes
  only Seerr's nested config mount writable while keeping its parent run private.
- Sonarr/Radarr requests fail unless a default server, quality profile, and root
  folder are all selected.
- The API key grants admin access. Source it from the session file, never copy it
  into Markdown or screenshots.

Sources: [Docker](https://docs.seerr.dev/getting-started/docker/),
[media server settings](https://docs.seerr.dev/using-seerr/settings/mediaserver/),
[Sonarr/Radarr services](https://docs.seerr.dev/using-seerr/settings/services/),
[general/API key](https://docs.seerr.dev/using-seerr/settings/general/).
