# Seerr connection setup: verified deltas (2026-09-29)

Status: pinned-source and repository review; no live app/API verification. This
note records additions and corrections to the existing [Seerr route map](seerr-route-2026-09-29.md)
and [Arr peer contract](seerr-arr-peer-2026-09-29.md), not a replacement for them.

## Safe sequence and precise gaps

1. **Jellyfin first-admin connection.** First `GET /api/v1/settings/public`
   without authentication and proceed only when `initialized:false`. The current
   Seerr adapter creates the first admin using its verified shared Jellyfin
   admin. It sends
   `POST /api/v1/auth/jellyfin` with
   `{username,password,hostname:"jellyfin",port:8096,urlBase:"",useSsl:false,serverType:2}`;
   require `200`, administrator id `1`, and a session cookie. This is a
   one-time operation: the adapter persists `login-attempted` before sending
   and stops for inspection after an uncertain outcome; never replay it blindly.
   Then `GET /api/v1/settings/main` with the returned session cookie (`200`;
   admin response includes the existing read-only `apiKey`), save that key to
   Seerr's private file, and verify with `X-Api-Key` against `/auth/me` and
   `/settings/jellyfin` (each `200`). The [pinned Seerr auth source](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/auth.ts),
   [OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml), and
   [adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/setup.ts)
   support this flow. The adapter checks Jellyfin host, port, TLS, and server ID,
   but does not compare the saved `urlBase` to the configured empty value; add
   that readback before claiming an exact Compose endpoint.

2. **Owner-selected Jellyfin libraries.** With admin cookie or Seerr API key,
   `POST /api/v1/settings/jellyfin/library/sync` (no body) returns `200` and the
   library inventory. The inventory schema requires `id`, `name`, and `enabled`.
   For each explicitly selected library, send
   `PUT /api/v1/settings/jellyfin/library/{id}` with `{"enabled":true}` (expect
   `200`), then `GET /api/v1/settings/jellyfin/library` and compare the selected
   IDs and enabled states. Seerr's [v3.5.0 OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml)
   defines the sync, update, and readback contract. Current adapter work
   performs this sequence and checkpoints/readbacks the selected IDs. Its
   `Movies`/`Shows` names match the bounded Jellyfin adapter contract, which
   creates those two libraries from the owner's selected paths ([Jellyfin
   adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/setup.ts));
   the IDs are then resolved from the synced inventory rather than assumed.
   Keep this selection coupled to same-owner Jellyfin readiness. A future
   arbitrary library selector would need separate owner inputs.

3. **Resolve Arr choices from Arr, not Seerr's test response.** For each owned
   Arr instance, query its own pinned API using `X-Api-Key`:
   `GET /api/v3/qualityprofile` (expect `200`; select and confirm the exact
   numeric `id` and `name`) and `GET /api/v3/rootfolder` (expect `200`; select
   the exact owner-approved `path` and require `accessible:true`). These list
   shapes are exposed by the [Sonarr v4.0.19.2979 controllers](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/Profiles/Quality/QualityProfileController.cs)
   and [root-folder controller](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/RootFolders/RootFolderController.cs),
   and the corresponding [Radarr v6.4.4.10685 quality-profile](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/Profiles/Quality/QualityProfileController.cs)
   and [root-folder controllers](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/RootFolders/RootFolderController.cs).
   Existing per-app setup now accepts an exact `/data/...` root, creates it
   once if missing (POST body `{"path":"..."}`, require `201`), and reads it
   back as accessible; this corrects the older [Arr peer note](seerr-arr-peer-2026-09-29.md)
   which said roots were not created or verified. Neither Arr adapter exposes a
   quality-profile choice yet.

   Seerr's `POST /api/v1/settings/{radarr|sonarr}/test` is still useful as a
   connection check: required JSON is `hostname`, `port`, `apiKey`, `useSsl`,
   with optional `baseUrl`; a successful test is `200`. Its pinned OpenAPI
   describes profile/root details but the 200 response schema only declares
   `profiles` (profile entries have `id` and `name`); it does not declare
   `rootFolders` or `urlBase`. Do not trust undocumented fields from
   this response as profile/root proof. Query Arr's pinned API for those
   choices; use Seerr test only to prove that Seerr can authenticate/reach that
   endpoint. In this Compose catalog, the intended endpoints are `radarr:7878`
   and `sonarr:8989` on the verified shared network; HTTP/no base path follows
   the recipe unless an owner-selected configuration says otherwise.

4. **Save and verify each link.** First `GET /api/v1/settings/radarr` and
   `/settings/sonarr`; stop on ambiguous/conflicting entries. For a new link,
   `POST /settings/{kind}` with the required fields below and require `201`
   (created settings object).
   For an explicitly approved update to one known ID, `PUT /settings/{kind}/{id}`
   with the full settings object and require `200`. Then GET the collection and
   verify the exact endpoint, chosen profile ID/name, selected root path, and
   owner choices. A lost POST response is uncertain: read and reconcile before
   retrying; OpenAPI defines no idempotency key. Never put an Arr key in a
   checkpoint, plan, setup record, or ordinary log. Seerr's settings GET
   returns key-bearing objects, so compare the key internally and redact it.

   Required `RadarrSettings` fields are `name`, `hostname`, `port`, `apiKey`,
   `useSsl`, `activeProfileId`, `activeProfileName`, `activeDirectory`, `is4k`,
   `minimumAvailability`, and `isDefault`. Sonarr requires the shared fields
   except `minimumAvailability`, plus `enableSeasonFolders`. Those required
   values mean the owner must choose the default/4K slot, Radarr availability,
   and Sonarr season-folder behavior; the catalog must not silently infer them.
   Also obtain explicit choices before setting optional `syncEnabled`,
   `preventSearch`, `externalUrl`, tags, or a nonempty `baseUrl`. The harness
   currently chooses `Any`, `is4k:false`, `isDefault:true`, hard-coded roots,
   and several behavior flags. That is fixture choreography, not a general
   owner-approved configuration.

5. **Initialize last.** After both selected libraries and each chosen Arr link
   pass GET readback, an authenticated admin may `POST /api/v1/settings/initialize`
   with no body (expect `200`), then `GET /api/v1/settings/public` and require
   `initialized:true`. Do not call initialize as a substitute for the earlier
   readbacks. Do not run the harness's setup writes against an already
   initialized instance unless the owner explicitly requested a separate
   reconciliation/upkeep action: the harness gates login/initialize but still
   mutates libraries and Arr settings when `initialized` was already true.

## What can be promoted from current code

The Seerr recipe pins `ghcr.io/seerr-team/seerr:v3.5.0` and separately accepts
media-server admin, libraries, Arr links, and restart persistence. Current
adapter work handles first-admin, its API key, and canonical Movies/Shows
sync/readback. Its `setupAfter: ["jellyfin", "sonarr", "radarr"]` and
`peers.inspectVerified(appId)` establish same-owner ordering/inspection, not
read peer secrets. `readVerifiedAdmin` remains Jellyfin-only. The setup HTTP
transport is for the current app's saved origin; no peer-authenticated Arr API
request or Arr-key handoff exists. Safely reuse `inspectVerified` and the Arr
`rootFolderPath` readback, but completing profile/root resolution and Seerr
Arr-link persistence still needs a narrow same-owner Arr-key capability at the
apply boundary plus a peer-scoped way to query Arr profile/root inventories.
Do not expand generic peer inspection to return secret values. For standalone
Compose-only setup, omit Seerr's optional `/settings/jellyfin`
`externalHostname` POST; it is a browser-facing URL choice, not required to
connect internally.

The main bootstrap remains a useful sequence reference but not a generic
adapter: it assumes canonical `Movies`/`Shows`, `Any`, fixed roots and
availability/default flags, and does not gate all writes on preexisting
initialization. Recipe setup should persist the owner's non-secret root/profile/
behavior choices, use one-time checkpoints before first-admin/root/link
creation writes, and read back after every write.

## Evidence limits

The findings are from exact tagged upstream OpenAPI/source and current local
adapters/harness. No credentials, containers, live HTTP calls, image contents,
browser session, tests, or initialization were used. Image recipes pin tags,
not immutable digests; actual network membership and live endpoint reachability
remain unverified. See also [existing Seerr contract](seerr-contract-v3-2026-09-29.md)
and [wiring review](seerr-wiring-v3-2026-09-29.md) for broader route and Compose
details.
