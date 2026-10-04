# Seerr v3.5.0 Compose and first-run route — 2026-09-29

Status: official-source research plus an inspect-only recipe and synthetic
render check. No fresh-container, account, Arr-link, Homarr, or restart acceptance.

## Compose contract

The [official Docker guide](https://docs.seerr.dev/getting-started/docker/)
uses `ghcr.io/seerr-team/seerr`, `init: true`, a persistent `/app/config`, and
container TCP 5055. The [v3.5.0 release](https://github.com/seerr-team/seerr/releases/tag/v3.5.0)
is pinned in this app recipe. The image's [tagged Dockerfile](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/Dockerfile)
runs as `node` UID 1000; it does not explicitly install `wget`. The guide's
healthcheck is a shell string using `wget` and `|| exit 1`, while our Compose
contract allows only argv `CMD` checks. We therefore leave the recipe health
unknown instead of inventing a command. A named config volume needs a live
write/restart check. Existing Overseerr/Jellyseerr data needs backup before
Seerr's [forward migration](https://docs.seerr.dev/migration-guide/).

## First run

Seerr cannot create its first administrator through local login or `API_KEY`
alone. Tagged [auth routes](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/auth.ts)
show `/auth/local` signs in an existing account, while Jellyfin/Emby sign-in
creates the initial admin only with a media-server administrator. The API-key
[middleware](https://github.com/seerr-team/seerr/blob/v3.5.0/server/middleware/auth.ts)
maps the key to user ID 1, so it also needs that first user. The recipe declares
`external-first-admin` and generates no fictional Seerr admin password.

An app adapter can reuse the canonical harness's
[`bootstrap-seerr.ts`](../../scripts/bootstrap-seerr.ts) sequence, but must
replace its fixed library names, profile, roots, external URLs, and automatic
search choice with exact owner selections. The tagged [OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml)
and [settings routes](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/index.ts)
support public initialization readback, Jellyfin/Emby auth, Jellyfin library
sync/enable/readback, Sonarr/Radarr test/create-or-update/readback, and an
admin-only `GET /settings/main` API-key read. Do not call the regenerate route
to extract the key. The v3.5.0 library sync change uses POST, then explicit
PUT per selected library; old GET mutation patterns are removed.

The adapter needs verified saved peer credentials and in-project DNS; the
current per-app transport only trusts an app-owned standalone project. A
separate shared-project handoff must prove the exact media-server/Arr origins,
private key references, selected libraries/profiles/root folders, and
auto-search choice before Seerr can be promoted. The current recipe is not
installable through bounded apply. A setup smoke test must not create a media
request: [request creation](https://docs.seerr.dev/api/create-new-request/)
may auto-approve and trigger Arr search.

Homarr's [Seerr integration](https://homarr.dev/docs/integrations/seerr/)
uses Seerr's API key. Integration, dashboard tile, and widgets each need their
own readback; network reachability alone proves none of them.
