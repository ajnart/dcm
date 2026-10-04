# Seerr TLDR

- Purpose: user-facing movie/TV request portal backed by Jellyfin, Sonarr, and
  Radarr; supplies Homarr media-request widgets and Spotlight search.
- Image: `ghcr.io/seerr-team/seerr:latest` in the isolated harness; upstream v3.5.0 API routes were checked on 2026-09-29, but inspect each running image before claiming version-specific acceptance.
- Internal URL: `http://seerr:5055`; host URL comes from `scripts/session.sh urls`.
- State: `/app/config`; container runs as UID/GID 1000; `init: true` is required.
- Health: `/api/v1/settings/public`.
- Secret: per-run `SEERR_API_KEY`, injected with `API_KEY`; never reveal it.

## Minimum fresh-run path

1. From the installed project's `.selfhost/media-harness` directory, run
   `bun scripts/setup-seerr.ts "$RUN_ID"`. This current per-service path uses
   the private curl transport. It authenticates the selected Jellyfin
   administrator without printing credentials and currently uses the
   non-deliverable setup email `admin@example.test`.
   Seerr uses this email for notifications, password resets, and local sign-in;
   the placeholder cannot receive mail. It configures the internal
   Jellyfin address, and enables exactly Movies and Shows. Curl is required;
   missing curl stops setup with a fixed prerequisite error rather than falling
   back to direct Fetch.
2. The helper tests Radarr and Sonarr through Seerr, selects the unique `Any`
   profile and expected root returned by each live API, creates or resumes the
   default non-4K services with existing-media status sync and automatic search
   enabled for future approved requests, then marks setup initialized. Status
   sync reads Arr media/request state; it is not a download. Obtain explicit approval for that
   future-on-request behavior before invoking this script. Setup itself creates no request,
   search, or download. Conflicting existing
   servers, libraries, profiles, or roots stop the run.
3. Open Seerr and verify the Discover page. A scan may be started separately;
   the bootstrap does not request media or start downloads.
4. Add Seerr to Homarr during Homarr onboarding using `http://seerr:5055` and
   the per-run Seerr API key.

`scripts/session.sh bootstrap-seerr RUN_ID` and direct invocation of
`scripts/bootstrap-seerr.ts RUN_ID` are retained compatibility paths that use
Fetch instead of the private curl transport. They are not the current
per-service setup command. With `setup-seerr.ts`, the Seerr login cookie is
stored and reused through the private jar for that service's loopback origin;
the direct-Fetch helper carries the cookie in memory instead.

## Proof

- `session.sh verify` requires initialized public settings, exact loopback
  external URLs, and exact persisted Sonarr and Radarr API keys.
- Its read-only GET probes require a persisted Jellyfin user plus matching
  Radarr/Sonarr service IDs and nonempty service-detail profiles and roots.
- Both service tests succeed with selected profiles/root folders.
- Homarr's Seerr integration test succeeds; request list/stats/search capability
  is present on the generated dashboard.

## Version-sensitive API contract

The library bootstrap now targets Seerr v3.5.0's documented routes. A running older image may need a separately reviewed compatibility path; the script does not silently retry writes against old routes.

- `GET /api/v1/settings/public` reports initialization without authentication.
- `POST /api/v1/auth/jellyfin` creates or resumes the administrator session and
  returns the session cookie used until initialization completes. The helper
  tries a login without host fields first. It sends the approved Jellyfin host
  fields only after the exact HTTP 500 `No hostname provided.` response; any
  other error stops without retry.
- Before an uninitialized login, `GET /api/v1/settings/jellyfin` checks whether
  the expected Jellyfin endpoint is already saved. A 403 here is ambiguous:
  it can mean a stale API key or no first admin yet. It does not authorize a
  hostful login. If the endpoint is saved, login omits the hostname fields:
  v3.5.0 rejects a supplied hostname on a configured server. A conflicting
  saved endpoint stops setup instead of overwriting it.
- `POST /api/v1/settings/jellyfin/library/sync` refreshes libraries while
  preserving enabled flags. `PUT /api/v1/settings/jellyfin/library/{libraryId}`
  with `{"enabled":true}` enables each selected library. A final `GET` checks
  that exactly Movies and Shows are enabled before initialization.
- Radarr and Sonarr use `GET` for current settings, `POST .../test`, `POST` to
  create (HTTP 201), and `PUT .../<id>` to resume (HTTP 200). The helper GETs
  both collections again and verifies the saved endpoint, profile, root,
  default selection, and automatic-search setting.
- `POST /api/v1/settings/initialize` is the final mutation. A final public
  settings GET must confirm `initialized: true`; this still does not prove
  that a media request or download succeeds.

Sources: [Seerr v3.5.0 OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml),
[v3.5.0 settings routes](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/index.ts),
[v3.5.0 Jellyfin authentication](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/auth.ts), and
[v3.5.0 service routes](https://github.com/seerr-team/seerr/tree/v3.5.0/server/routes/settings).

## Traps

- `localhost` and `127.0.0.1` are invalid internal Docker targets.
- Browser Jellyfin sign-in stays disabled until its required Email Address is
  filled. Do not infer a network failure from that disabled button alone.
- Seerr's Radarr/Sonarr browser forms append help text to the API-key label.
  Use `browser-key refs` for the matching service and `browser-key fill` with
  its fresh ref; the private helper recognizes only the exact service-specific
  label on Seerr setup/service pages.
- If automatic search is declined or a safety review rejects the setting,
  leave it off, do not retry through another route, and report the verifier
  gap. A saved server is not proof that requests can initiate acquisition.
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
