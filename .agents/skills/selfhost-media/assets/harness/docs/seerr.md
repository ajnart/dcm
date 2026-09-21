# Seerr TLDR

- Purpose: user-facing movie/TV request portal backed by Jellyfin, Sonarr, and
  Radarr; supplies Homarr media-request widgets and Spotlight search.
- Image: `ghcr.io/seerr-team/seerr:latest` (observed v3.4.1 on 2026-08-28).
- Internal URL: `http://seerr:5055`; host URL comes from `scripts/session.sh urls`.
- State: `/app/config`; container runs as UID/GID 1000; `init: true` is required.
- Health: `/api/v1/settings/public`.
- Secret: per-run `SEERR_API_KEY`, injected with `API_KEY`; never reveal it.

## Minimum fresh-run path

1. Run `bun scripts/bootstrap-seerr.ts "$RUN_ID"`. The helper authenticates the
   selected Jellyfin administrator without printing credentials, configures the
   internal Jellyfin address, and enables exactly Movies and Shows.
2. The helper tests Radarr and Sonarr through Seerr, selects the unique `Any`
   profile and expected root returned by each live API, creates or resumes the
   default non-4K services, then marks setup initialized. Conflicting existing
   servers, libraries, profiles, or roots stop the run.
3. Open Seerr and verify the Discover page. A scan may be started separately;
   the bootstrap does not request media or start downloads.
4. Add Seerr to Homarr during Homarr onboarding using `http://seerr:5055` and
   the per-run Seerr API key.

## Proof

- `session.sh verify` requires initialized public settings, exact loopback
  external URLs, and exact persisted Sonarr and Radarr API keys.
- Its read-only GET probes require a persisted Jellyfin user plus matching
  Radarr/Sonarr service IDs and nonempty service-detail profiles and roots.
- Both service tests succeed with selected profiles/root folders.
- Homarr's Seerr integration test succeeds; request list/stats/search capability
  is present on the generated dashboard.

## v3.4.1 API contract

The bootstrap targets the routes shipped by the documented v3.4.1 image:

- `GET /api/v1/settings/public` reports initialization without authentication.
- `POST /api/v1/auth/jellyfin` creates or resumes the administrator session and
  returns the session cookie used until initialization completes.
- `GET /api/v1/settings/jellyfin/library?sync=true` refreshes libraries; a
  second `GET` with `enable=<ids>` persists the exact enabled set.
- Radarr and Sonarr use `GET` for current settings, `POST .../test`, `POST` to
  create (HTTP 201), and `PUT .../<id>` to resume (HTTP 200).
- `POST /api/v1/settings/initialize` is the final mutation.

Source: [Seerr v3.4.1 settings routes](https://github.com/seerr-team/seerr/blob/v3.4.1/server/routes/settings/index.ts),
[Radarr routes](https://github.com/seerr-team/seerr/blob/v3.4.1/server/routes/settings/radarr.ts),
[Sonarr routes](https://github.com/seerr-team/seerr/blob/v3.4.1/server/routes/settings/sonarr.ts), and
[Jellyfin authentication](https://github.com/seerr-team/seerr/blob/v3.4.1/server/routes/auth.ts).

## Traps

- `localhost` and `127.0.0.1` are invalid internal Docker targets.
- Rootless Docker remaps container UID 1000. The isolated session creator makes
  only Seerr's nested config mount writable while keeping its parent run private.
- Sonarr/Radarr requests fail unless a default server, quality profile, and root
  folder are all selected.
- API setup is safe to resume only when the existing Jellyfin, Radarr, and
  Sonarr identities match the managed topology. It rejects conflicts rather
  than replacing another server.
- The API key grants admin access. Source it from the session file, never copy it
  into Markdown or screenshots.

Sources: [Docker](https://docs.seerr.dev/getting-started/docker/),
[media server settings](https://docs.seerr.dev/using-seerr/settings/mediaserver/),
[Sonarr/Radarr services](https://docs.seerr.dev/using-seerr/settings/services/),
[general/API key](https://docs.seerr.dev/using-seerr/settings/general/).
