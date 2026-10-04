# Seerr v3.5.0 Jellyfin routes and setup replay (2026-09-29)

## Scope and finding

This is a read-only source review of Seerr v3.5.0's Jellyfin library API,
first-run authentication, and official Docker Compose guidance. It identifies
the required library-route correction in `scripts/bootstrap-seerr.ts` and a
separate first-run replay edge case. No container, browser, credential, or live
Seerr instance was used; no test was run.

The v3.5.0 library contract is: `POST /api/v1/settings/jellyfin/library/sync`
to synchronize; `PUT /api/v1/settings/jellyfin/library/{libraryId}` with
`{"enabled": true}` to set one library; and `GET
/api/v1/settings/jellyfin/library` to read back persisted state. Every library
is `{id: string, name: string, enabled: boolean}`. The legacy `GET
/settings/jellyfin/library?sync=true` and `GET ...?enable=...` calls do not
implement those operations in this release.

## Version-pinned route evidence

The [v3.5.0 OpenAPI source](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/seerr-api.yml)
and its [library endpoint definitions](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/seerr-api.yml#L2318-L2386)
define the route and response shapes. The [tagged implementation](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/server/routes/settings/index.ts#L344-L428)
confirms the behavior:

| Operation | v3.5.0 contract | Result and relevant behavior |
| --- | --- | --- |
| Sync | `POST /settings/jellyfin/library/sync` | JSON array of libraries. Sync matches IDs against saved entries and preserves each existing `enabled` flag; newly discovered libraries default to disabled. |
| Set one library | `PUT /settings/jellyfin/library/{libraryId}` with `{"enabled": boolean}` | `200` and the updated library object; `400` for an invalid body and `404` if that ID is absent. The write sets a boolean state rather than toggling it. |
| Read back | `GET /settings/jellyfin/library` | JSON array of the persisted library objects. The implementation returns stored state directly. |

The implementation's plain GET route has no sync/enable query handling. Both
legacy query calls therefore resolve to a list read and do not synchronize or
change any `enabled` flags. OpenAPI defines sync's array item as the same
required `JellyfinLibrary` shape (`id`, `name`, and `enabled`).

## Bootstrap implications

The canonical [Seerr bootstrap](../../scripts/bootstrap-seerr.ts#L110) in the
current worktree now uses the pinned routes: POST sync, selects the exact
Movies/Shows libraries by name, PUTs only currently-disabled selected IDs, then
GETs and validates state before it can reach `/settings/initialize`. That is a
bounded, deterministic change. Keep the current fail-closed rule for an
unexpected enabled library rather than disabling an operator's library as a
side effect. The code's URL-encoded path ID matches the path parameter contract.

The route sequence is replay-safe for a partial library write: a retry POSTs
sync, which preserves flags; it skips a managed library already enabled, sets
only a missing `true`, and verifies both with GET. A failed or stale readback
must abort before initialization. The existing [focused fixture](../../scripts/check-bootstrap-seerr.ts#L61)
has been updated in the worktree to model POST/PUT/GET and a failed readback;
that is a fixture plan/change, not runtime evidence.

There is a separate retry problem in first-run auth. In v3.5.0,
`POST /auth/jellyfin` is unprotected and accepts username/password plus optional
Jellyfin connection fields. The implementation returns HTTP 500
`Jellyfin hostname already configured` when the saved `settings.jellyfin.ip`
is nonempty and the submitted body still contains `hostname`; with no saved
host, omitting `hostname` also returns HTTP 500. See the [tagged auth route](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/server/routes/auth.ts#L230-L272).

That means a crash after `POST /settings/jellyfin` persists the server but
before `/settings/initialize` leaves `initialized=false`; a retry that sends
the original login body (including `hostname`) fails before it can resume. The
current fallback in `bootstrap-seerr.ts` catches only 400/422, so it does not
match v3.5.0's 500 behavior. Do not broadly retry arbitrary 500s: they can mean
bad credentials, a failed Jellyfin connection, or another real error.

The current worktree now performs an API-key preflight before login, but this
must distinguish a pristine install from a partial resume. Although the
[OpenAPI security scheme](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/seerr-api.yml#L2144-L2152)
accepts `X-Api-Key` for protected operations, the [pinned auth middleware](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/server/middleware/auth.ts#L8-L52)
maps that key to user id `1`; when that user does not yet exist, it leaves
`req.user` unset and admin authorization cannot succeed. Therefore, API-key
preflight is viable for a partial setup after `/auth/jellyfin` created the
admin, but not for a pristine no-user first run. The fixture must model this
distinction; it must not return settings for fresh setup solely because the
header matches.

Minimal recovery recommendation: on an uninitialized install, allow the
first-run path to proceed when the protected preflight returns the expected
403 for the no-user state, then authenticate with connection fields. If the
preflight succeeds, verify the saved endpoint and omit `hostname`, `port`,
`useSsl`, and `urlBase` so Seerr authenticates against its saved host; reject
conflicting saved host settings. Do not swallow arbitrary transport errors.
If a host-configuration 500 fallback is used instead, retry only when the
response is exactly `Jellyfin hostname already configured`, not for arbitrary
500s; this covers cases where preflight is unavailable without masking bad
credentials or connectivity failures. The auth route explicitly uses the
saved hostname when the stored `ip` is nonempty. The GET route exposes
`settings.jellyfin` directly; its internal field is named `ip`, while the
published `JellyfinSettings` schema is not fully aligned with that runtime
object, so confirm fields against the pinned implementation, not that schema
alone.

## Authentication and cookie contract

The [pinned OpenAPI security definitions](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/seerr-api.yml#L2144-L2152)
allow either the `connect.sid` cookie or `X-Api-Key` header on protected API
operations (the [document-level security](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/seerr-api.yml#L8286-L8289)
lists them as alternatives). `GET /settings/public` and `POST /auth/jellyfin`
are explicitly unauthenticated. OpenAPI says Jellyfin auth returns a user JSON
object and generates a session cookie; the [implementation sets the user on
the session and returns the filtered user](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/server/routes/auth.ts#L490-L495).
For first-user creation, the Jellyfin account must be an administrator and
`serverType` must be Jellyfin or Emby.

Seerr's official [General settings documentation](https://docs.seerr.dev/using-seerr/settings/general/)
says `API_KEY` sets the Seerr API key. The current worktree's Compose passes
`API_KEY: ${SEERR_API_KEY}`, and its request helper sends that value as
`X-Api-Key`; the key is an administrator-level secret, not an ordinary setup
fact. API-key authentication is sufficient for protected API requests only
when Seerr can resolve the admin account; on pristine setup the user row has
not been created yet. The login response cookie is separately `connect.sid`;
after first-user creation a caller that doesn't retain cookies must send it
on subsequent requests. Keep both values out of logs, fixtures with fixed
literals, screenshots, and command output.

## Official Compose runtime fields

The official [Docker guide's Compose example](https://docs.seerr.dev/getting-started/docker/)
uses image `ghcr.io/seerr-team/seerr:latest`, `init: true`, container name
`seerr`, optional `PORT=5055`, port `5055:5055`, persistent `/app/config`,
healthcheck against `/api/v1/settings/public` (20s start period, 3s timeout,
15s interval, 3 retries), `security_opt: [no-new-privileges]`,
`cap_drop: [ALL]`, and `restart: unless-stopped`. The guide says the process is
UID 1000 (`node`) and the config directory should be owned by `1000:1000`.
`PORT=5055` is optional; `API_KEY` is documented separately as the key override.

The current harness Compose already has the official image, `init: true`,
`TZ`, `API_KEY`, `/app/config`, internal port 5055 (host port can vary), the
same healthcheck path/timings, and `restart: unless-stopped`. It omits the
guide's optional `security_opt`/`cap_drop` hardening. Its image is `:latest`,
not the analyzed immutable-version selector `:v3.5.0`; therefore this source
review does not prove that a later `latest` image has the same API contract.
For runtime acceptance, pin the fixture to `v3.5.0` or verify the running
version before interpreting this contract.

## Isolated test plan

Extend only `scripts/check-bootstrap-seerr.ts` and run that focused fixture
after implementation:

1. Assert the call contract is POST sync, PUT each selected library with exact
   `{enabled: true}`, then GET readback; assert no `sync`/`enable` query route
   is used and `/settings/initialize` occurs only after successful readback.
2. Model stable IDs and all required response fields. Cover missing/duplicate
   target names, invalid or duplicate managed IDs, a pre-enabled target, an
   unexpected enabled library, and a readback that does not reflect the write.
3. Simulate interruption after enabling only one target, preserve that flag
   through the next sync, rerun, and assert only the missing target gets a PUT.
4. Cover pristine setup (the X-Api-Key preflight cannot resolve user id 1,
   then auth includes host fields) and configured-but-uninitialized resume
   (the preflight resolves the existing admin, validates `ip`, and auth omits
   host fields). Model the official 500 for a retry that incorrectly resends
   `hostname`; do not use a fake 400/422 to establish compatibility.
5. Keep this to `bun scripts/check-bootstrap-seerr.ts`; no Docker, browser, full
   suite, or live-service acceptance is necessary for this route-focused
   change.

## Not verified

No container image was pulled, pinned, or queried; no live API, login, cookie
round trip, settings persistence, startup health, or browser behavior was
verified. The official Compose guide is current documentation, while route
claims above are pinned to the v3.5.0 source tag. The local fixture remains
separate from source/runtime compatibility proof.
