# Seerr Compose and headless setup contract (2026-09-29)

- Checked at: `2026-09-29 11:08 UTC`
- Status: `pass` for primary-source route review; live/image acceptance not performed
- Browser session: not used, per task scope
- Domain allowlist: `docs.seerr.dev`, `github.com`, `raw.githubusercontent.com` (an `api.github.com` release lookup was inaccessible and is not used below)

## Scope

Read-only follow-up to [the v3.5.0 route review](./seerr-route-2026-09-29.md). Checked official Seerr docs and v3.5.0 OpenAPI/implementation against the Seerr app manifest, root Compose service, and `scripts/bootstrap-seerr.ts`. No Docker, browser, secrets, test, commit, or push activity. Claims below are source-level only.

## Sources

| Role | Source | Result | Checked |
| --- | --- | --- | --- |
| official | [Docker guide](https://docs.seerr.dev/getting-started/docker/) | pass | 2026-09-29 |
| official | [v3.5.0 release](https://github.com/seerr-team/seerr/releases/tag/v3.5.0#L157-L199) | pass | 2026-09-29 |
| official | [v3.5.0 OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L214-L219), [Jellyfin library routes](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2318-L2386), [Arr routes](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2782-L3004), [public/init routes](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L3048-L3074) | pass | 2026-09-29 |
| official | [v3.5.0 auth route](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/auth.ts#L230-L495), [API-key read/rotation routes](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/index.ts#L69-L110), [Jellyfin/library implementation](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/index.ts#L285-L428), [auth middleware](https://github.com/seerr-team/seerr/blob/v3.5.0/server/middleware/auth.ts#L8-L52) | pass | 2026-09-29 |
| official | [General settings/API key](https://docs.seerr.dev/using-seerr/settings/general/), [media-server settings](https://docs.seerr.dev/using-seerr/settings/mediaserver/), [services](https://docs.seerr.dev/using-seerr/settings/services/) | pass | 2026-09-29 |
| official | [Migration guide](https://docs.seerr.dev/migration-guide/), [signed-artifact guide](https://docs.seerr.dev/using-seerr/advanced/verifying-signed-artifacts/) | pass | 2026-09-29 |

## Findings

The v3.5.0 release is marked **Latest** and dated 2026-09-28. Its breaking-change note explicitly replaces library GET query switches with `POST /settings/jellyfin/library/sync` and `PUT /settings/jellyfin/library/{libraryId}`. The app manifest already pins `ghcr.io/seerr-team/seerr:v3.5.0`; root `docker-compose.yml` still uses `:latest`. Keep route evidence pinned to v3.5.0 and reconcile that mutable runtime tag before claiming version-specific behavior. The official docs allow `latest`, version tags, aliases, and `develop`; no image was pulled and no digest/tag availability check was performed.

The official Compose contract is `ghcr.io/seerr-team/seerr:latest`, `init: true`, persistent `/app/config`, port 5055 (the `PORT` environment variable is optional), `TZ`, healthcheck on `/api/v1/settings/public` (20s start period, 3s timeout, 15s interval, 3 retries), and `restart: unless-stopped`. The current Docker guide also includes `security_opt: no-new-privileges` and `cap_drop: [ALL]`; the root harness has the same main runtime/storage/health/restart fields but omits those hardening fields and publishes its host port according to `MEDIA_PORT_BIND_PREFIX`. Apply this repo's private/loopback default rather than copying the guide's unqualified `5055:5055`. Seerr runs as UID 1000 (`node`), so `/app/config` needs writable 1000:1000 ownership; do not assume PUID/PGID support. Its healthcheck is only a startup observation, not integration acceptance.

### Candidate headless setup contract

1. Start with a persistent, version-pinned Compose service, `init: true`, `TZ`, the documented healthcheck, and the documented hardening. Keep the UI port private by default. Preserve an owner-controlled API-key secret reference; never include its value in reports.
2. Read public `GET /settings/public` to determine whether setup is initialized. Unauthenticated `POST /auth/jellyfin` accepts username/password; include Jellyfin connection fields when no server is saved. The first Seerr account is granted admin only when no users exist and the Jellyfin account is itself an administrator. The successful login establishes `connect.sid`; preserve the cookie for later calls when not using a cookie jar.
3. Obtain Seerr's key without rotating it: `API_KEY` is the documented environment override; otherwise, after admin login, read `apiKey` from `GET /settings/main` in memory. OpenAPI marks the field read-only and the implementation omits it for non-admin users. Do **not** call `POST /settings/main/regenerate` for extraction; it rotates the key. `X-Api-Key` is administrator-level access.
4. Resume fail-closed. A protected API-key preflight returning 403 is not proof of a pristine install: a wrong key also fails authentication, while a correct key on a no-user database cannot resolve user id 1. v3.5.0's auth route returns HTTP 500 `No hostname provided.` if no saved Jellyfin host exists and login omits `hostname`; conversely it returns HTTP 500 `Jellyfin hostname already configured` if a saved host exists and a retry resends `hostname`. A safe fallback is to try first-run Jellyfin auth **without** connection fields, use the saved host if it succeeds, and add the approved host fields only after the response is exactly the source-defined `No hostname provided.` error. Abort on other errors; do not retry arbitrary 500s or overwrite a conflicting saved endpoint. Then verify the saved internal Jellyfin endpoint before further writes.
5. Configure libraries by POSTing the sync route, selecting the owner-approved library IDs, PUTting `{ "enabled": true }` only for desired disabled IDs, and GETting the library list to verify persisted state. v3.5.0 sync preserves enabled flags and defaults new libraries to disabled; replay can skip already-enabled targets. Do not use the retired `?sync`/`?enable` query calls or disable unrelated libraries.
6. For each Arr service, GET existing settings, POST `/settings/{radarr|sonarr}/test` with its API key and connection details, select a returned profile/root folder, then POST the collection endpoint for a new instance or PUT its existing ID. Expect 201 on create and 200 on update. The official UI guidance supports Radarr/Sonarr v3/v4, requires a default server for requests, and treats automatic search as a separate setting. Keep connection endpoints and API keys owner-selected; use Docker service DNS (`jellyfin`, `radarr`, `sonarr`) internally, not `localhost`. The external URL is a separate browser-facing value.
7. POST `/settings/initialize` last, only after every required connection and library readback passes. This changes the app's initialized state and should not be used to paper over partial configuration.

## Current harness comparison and pitfalls

- `scripts/bootstrap-seerr.ts` already uses the v3.5.0 library POST/PUT/GET sequence and verifies readback before initialization. Its `SEERR_API_KEY` is injected from session secrets; it does not extract the key from Seerr. A later follow-up added GET readback of both Arr settings collections before initialization and a final public-settings GET requiring `initialized: true`.
- The Seerr manifest is a Compose app with media-server, Sonarr, and Radarr dependencies. Keep UID-1000 config ownership, timezone, private port binding, and ingress as recipe/host preconditions or owner choices, not selectable catalog apps.
- At review time, its API-key preflight treated a 403 as an unavailable saved-settings read, then sent Jellyfin connection fields. If the key was stale but the host was already saved, v3.5.0 returned the hostname-conflict **500**; the former fallback caught only 400/422, so that partial resume stopped. The no-host-first, exact-error retry above matches the tagged route better and avoids disguising credential/connectivity failures as resume cases.
- Implementation follow-up: `scripts/bootstrap-seerr.ts` now tries no-host login first, adds the approved host only for the exact `No hostname provided.` JSON error, and rejects unrelated HTTP 500 results. It also reads back both Arr settings and the final initialization flag. `bun scripts/check-bootstrap-seerr.ts` passes fresh, partial, stale-key preflight, unexpected-error, incorrect Arr readback, and failed initialization readback fixtures. No live Seerr retry has been claimed.
- The current login payload uses `admin@example.test`; keep that fixture value harness-only. For a real setup, use an owner-selected notification email or omit it and accept Seerr's username fallback.
- The current Arr payload writes `preventSearch: false`. The official UI exposes automatic search as an option that searches on request approval. Treat enabling that behavior as an explicit owner decision; the exact UI-to-field inversion is inferred from the payload name and setting description, not separately proven here.
- Seerr automatically migrates existing Overseerr/Jellyseerr data on first startup; the official guide explicitly recommends a backup for rollback. The official image's version tags are documented as immutable and signed; digest/signature verification remains a separate step.

## Verification boundary

Verified by reading current official documentation, the latest release page, and the v3.5.0 OpenAPI and implementation; also inspected the current local manifest, Compose section, and bootstrap source. Not verified: GHCR digest or exact pulled image, runtime version, live Jellyfin credentials/session cookie, API-key round trip, library persistence, Arr connectivity, Compose behavior, or browser acceptance. No tests were run. No secrets or rendered Compose values were accessed or retained; redaction count `0`; browser cleanup not applicable.

## Conclusion

The catalog's v3.5.0 pin matches the current release, but the harness still runs `latest`. The documented routes support an API-first setup with a source-matched, resumable Jellyfin login and readback-gated library/Arr writes. Before implementation, fix the stale-key/host-conflict resume path and keep API-key extraction, automatic search, service URLs, and library selection inside explicit secret/owner-choice boundaries.
