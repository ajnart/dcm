# Seerr v3.5.0 setup wiring — 2026-09-29

## Finding

The v3.5.0 API supports a deterministic, readback-gated setup after the first
administrator exists. Jellyfin library sync and enable are explicit POST/PUT
operations; Radarr/Sonarr expose test, create, update, and list routes; the
final initialize route only flips the public `initialized` flag. The current
shared-Compose recipe pins Seerr v3.5.0 and selects Jellyfin as its provider,
but the setup adapter stops after first-admin/API-key setup. The separate
media-harness helper implements the rest with fixed choices rather than
owner-selected library IDs, profiles, roots, and request behavior. [recipe](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/recipe.json#L8-L52), [adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/setup.ts#L8-L10), [harness](../../scripts/bootstrap-seerr.ts#L105-L216)

This is source and local-code inspection only. No live service or tests were
run. Scope is the selected shared Compose project; this note proposes no
host/platform catalog workflow.

## v3.5.0 route contract

All paths below are under `/api/v1`.

| Step | Exact contract | Replay / readback |
| --- | --- | --- |
| State | `GET /settings/public` returns `PublicSettings`; `initialized` is boolean. | Read first and last. `initialized: true` is routing state, not proof that selected links work. [OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L3048-L3074) |
| First admin/session (fresh database only) | Unauthenticated `POST /auth/jellyfin`; required JSON: `{ "username": string, "password": string }`. The tagged handler also accepts `hostname`, `port`, `urlBase`, `useSsl`, `email`, `serverType`. A successful response is a User and creates the session cookie. First user becomes admin only when there are no users and the Jellyfin account is an administrator. | If a server host is already saved, sending `hostname` returns HTTP 500 `Jellyfin hostname already configured`; if none is saved and `hostname` is omitted, it returns HTTP 500 `No hostname provided.`. Do not retry a lost request blindly; inspect saved state and use the exact error only to select the hostful first attempt. [OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L4051-L4084), [auth implementation](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/auth.ts#L230-L495) |
| Seerr API key | With the session cookie, `GET /settings/main` returns `MainSettings.apiKey` to an admin; the field is read-only and the route omits it for non-admins. | Save it only to Seerr's owner-only secret handoff. Do not call `POST /settings/main/regenerate` to read it: the handler regenerates the key. [MainSettings schema](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L214-L220), [routes](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2212-L2286), [handler](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/index.ts#L58-L110) |
| Jellyfin libraries | `POST /settings/jellyfin/library/sync` has no request body and returns an array of `{id:string,name:string,enabled:boolean}`; it preserves enabled flags. `PUT /settings/jellyfin/library/{libraryId}` requires `{ "enabled": boolean }`, returns the updated library (200; 400 invalid body, 404 unknown ID). `GET /settings/jellyfin/library` returns the persisted array. | Sync, then set `enabled:true` only for approved IDs, then GET and verify. This state-setting PUT is replay-safe for the same ID/value; sync preserves it. v3.5.0 removed GET query-based sync/toggle behavior. [OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2318-L2386), [handler](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/index.ts#L344-L428), [release note](https://github.com/seerr-team/seerr/releases/tag/v3.5.0#L170-L176) |
| Radarr/Sonarr test | `POST /settings/{radarr|sonarr}/test` requires `{hostname:string,port:number,apiKey:string,useSsl:boolean}`; `baseUrl:string` is optional. It returns 200 on success. OpenAPI prose says profiles and root folders are returned, but its response schema documents only `profiles: ServiceProfile[]`; each documented profile has `id:number,name:string`. | Do not claim `rootFolders[].path`, `urlBase`, or `tags` as a pinned OpenAPI contract. The current helper consumes them, so confirm their exact v3.5.0 shape from tagged route source before implementing an adapter that depends on them. [Radarr test](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2815-L2859), [Sonarr test](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2959-L3003), [ServiceProfile](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L1381-L1389) |
| Arr save/readback | `GET /settings/radarr` and `/settings/sonarr` return arrays of their settings schema. Create with `POST /settings/{kind}`: 201 + one settings object. Update with `PUT /settings/{kind}/{numericId}`: 200 + one settings object. Read the list again after either write. | OpenAPI defines no idempotency key or replay guarantee. Never blindly replay an ambiguous create; GET and reconcile first to avoid duplicates. After an uncertain update, GET and compare with the approved state before deciding whether another PUT is needed. GET schemas include `apiKey`, so responses are secret-bearing. [Radarr routes](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2782-L2903), [Sonarr routes](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2926-L3047), [schemas](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L555-L696) |
| Initialize | Admin-only `POST /settings/initialize`, no request body; returns `PublicSettings`. The v3.5.0 handler sets `settings.public.initialized = true` and saves. | Call last after all selected library/Arr readbacks pass; GET public settings and require `initialized:true`. Replaying the assignment is state-idempotent, but an already-initialized instance should be inspected rather than re-running setup writes. [OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L3062-L3074), [handler](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/index.ts#L812-L823) |

The schemas document these required save fields:

- Radarr: `name`, `hostname`, `port`, `apiKey`, `useSsl`, `activeProfileId`,
  `activeProfileName`, `activeDirectory`, `is4k`, `minimumAvailability`,
  `isDefault`.
- Sonarr: `name`, `hostname`, `port`, `apiKey`, `useSsl`, `activeProfileId`,
  `activeProfileName`, `activeDirectory`, `is4k`, `enableSeasonFolders`,
  `isDefault`.

Both schemas also list optional `baseUrl`, `externalUrl`, `syncEnabled`, and
`preventSearch`; `id` is read-only. Sonarr additionally lists optional
`activeLanguageProfileId`, nullable `activeAnimeProfileId`,
`activeAnimeLanguageProfileId`, `activeAnimeProfileName`, and
`activeAnimeDirectory`.

`minimumAvailability` is only typed as a string in the schema (no enum). The
schema gives no behavioral description for `is4k`, `isDefault`,
`enableSeasonFolders`, `syncEnabled`, or `preventSearch`; don't infer their
meaning or select values from names alone. Current harness-only extras such as
`tags`, `tagRequests`, `seriesType`, `animeSeriesType`, `animeTags`, and
`monitorNewItems` are not in the tagged save schemas. [Radarr schema](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L555-L617), [Sonarr schema](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L618-L696), [current payload construction](../../scripts/bootstrap-seerr.ts#L154-L204)

## Owner choices and security boundary

Request or show for explicit approval before writes:

- The Jellyfin identity/credential and the chosen shared-Compose provider. The
  current recipe fixes `providerAppId` to `jellyfin`; the first-admin email is
  optional in Seerr, but the harness currently hardcodes `admin@example.test`.
- Exact library IDs selected from the sync response, not just labels. The
  helper currently assumes unique libraries named Movies and Shows.
- Sonarr and Radarr instances/endpoints plus private API-key references. Only
  derive `jellyfin:8096`, `radarr:7878`, `sonarr:8989`, no TLS, and empty base
  paths when the approved services are confirmed on this shared network.
- Exact quality profile ID/name and root-folder path for each service. The
  helper silently chooses the `Any` profile and `/data/media/movies` or
  `/data/media/tv`; for Sonarr, it also reuses those values for anime fields.
- Whether each selected Arr instance should be default or 4K, season-folder
  behavior, Radarr minimum availability, optional external URLs, and the exact
  `syncEnabled` / `preventSearch` values after their semantics are established.
  The existing helper writes `isDefault:true`, `is4k:false`,
  `enableSeasonFolders:true`, `syncEnabled:true`, `preventSearch:false`, and
  `minimumAvailability:"released"`; these are implementation defaults, not
  owner choices or schema-enumerated values.

Security note: the shared-project compiler attaches each app's primary service
to the common `front` bridge as well as its app-private bridge, and declares
`front` non-internal. Seerr's configured peer connections use `useSsl:false`,
and its setup requests carry Jellyfin credentials and Arr API keys. This makes
all containers attached to that shared front network a mutual reachability and
trust boundary; HTTP does not encrypt those credentials in transit. Treat the
attached app set as trusted, keep unrelated workloads off that network, and
prefer a narrower peer network or TLS if the topology permits it. This is a
transport-boundary risk statement, not evidence that ordinary Docker peers can
passively sniff traffic. [network compiler](../../packages/cli/src/lib/shared-compose-project.ts#L88-L119), [front network](../../packages/cli/src/lib/shared-compose-project.ts#L169-L186), [first-admin request](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/setup.ts#L160-L168), [current Seerr peer requests](../../scripts/bootstrap-seerr.ts#L154-L185)

## Local gaps and useful fixture coverage

- The recipe correctly declares the four separate acceptance claims, but the
  adapter explicitly stops at first-admin/API-key; the harness supplies the
  remaining setup with fixed inputs. [recipe](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/recipe.json#L48-L52), [adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/setup.ts#L8-L10), [record status](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/setup.ts#L77-L80)
- The existing first-admin fixture covers the key handoff, successful replay,
  wrong Jellyfin peer, and lost-response fail-closed path. The bootstrap
  fixture covers fresh/partial/already-initialized flows, conflicts, failed
  readbacks, and no request creation. Neither fixture represents owner-selected
  IDs/profile/root/search settings. [first-admin fixture](../../packages/cli/tests/seerr-setup.test.ts#L86-L117), [bootstrap fixture](../../scripts/check-bootstrap-seerr.ts#L107-L165)
- Add focused cases for duplicate/missing library IDs and exact selected-ID
  PUTs; profile/root selection by approved IDs/paths (and absent test response
  fields); all required schema fields; no hardcoded `Any`/Movies/Shows/default/
  search values; create-response loss reconciled by GET without duplicate
  POST; initialization withheld on any failed readback; and secret redaction
  across request errors, progress, checkpoints, and output. Add a compose-plan
  assertion that only the chosen trusted apps share Seerr's peer network.
- No test was run for this research task.
