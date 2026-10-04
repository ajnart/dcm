# Seerr–Arr shared Compose peer contract (2026-09-29)

Status: pinned-source/repo review only. No containers, network, credentials, tests,
or runtime setup were used.

## Pinned wiring and reachability

The shared recipes pin Sonarr `lscr.io/linuxserver/sonarr:version-4.0.19.2979`
(container port 8989), Radarr `lscr.io/linuxserver/radarr:version-6.4.4.10685`
(7878), and Seerr `ghcr.io/seerr-team/seerr:v3.5.0` (5055). Arr mounts `/config`
and the selected shared `/data`; Seerr persists `/app/config`. These are version
tags, not verified immutable digests. See the [Sonarr recipe](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/recipe.json#L7-L31),
[Radarr recipe](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/radarr/recipe.json#L7-L31),
and [Seerr recipe](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/recipe.json#L7-L30).

Shared-project rendering attaches each app's front service to the common
`${projectId}-front` bridge and to its own `${projectId}-${appId}-private`
network; only non-front services receive per-app aliases. Consequently, the
intended Seerr-to-Arr endpoints are `http://sonarr:8989` and
`http://radarr:7878`, using container ports—not `localhost` or published host
ports. Docker documents service-name DNS only for services on a shared Compose
network and says service-to-service traffic uses the container port ([networking](https://docs.docker.com/compose/how-tos/networking/));
the [shared renderer](../../packages/cli/src/lib/shared-compose-project.ts#L88-L118)
shows this repo's actual network mapping.

There is a material runtime gap: [`sharedUnitStatus`'s runtime check](../../packages/cli/src/lib/shared-unit-setup.ts#L73-L139)
checks Compose inventory, exact image/project labels, and port bindings, but does
not inspect `.NetworkSettings.Networks`. The planned manifest is not evidence
that running Seerr and Arr containers remain attached as planned. Before reading
or sending a peer key for a Compose-DNS URL, fail closed unless the exact Seerr
and selected Arr container IDs have the expected live network memberships and
the network's name/owner labels match this saved shared manifest. Docker's
[network inspection reference](https://docs.docker.com/reference/cli/docker/network/inspect/)
documents the live membership check; service DNS is valid only after it passes.

The recipe's `/data` mount plus shared-project preparation creates
`/data/media/movies` and `/data/media/tv` directories ([shared preparation](../../packages/cli/src/lib/shared-compose-project.ts#L282-L295)).
That does **not** configure either path as an Arr root folder. The existing
[Sonarr adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/sonarr/setup.ts#L136-L224)
and [Radarr adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/radarr/setup.ts#L136-L224)
only verify Forms auth/login and capture the API key; they do not create roots
or choose quality profiles. Seerr's test call cannot invent a missing root.

## Seerr v3.5.0 API contract

The pinned [OpenAPI](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L555-L696)
defines both instance objects. `POST /settings/{radarr|sonarr}/test` accepts
`hostname`, `port`, `apiKey`, `useSsl`, and optional `baseUrl`; the pinned
[Radarr route](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/radarr.ts)
and [Sonarr route](https://github.com/seerr-team/seerr/blob/v3.5.0/server/routes/settings/sonarr.ts)
query status, profiles, root folders, and tags, then return them. They do not
write to Arr or save the connection in Seerr. A successful HTTP 200 only means
those queries succeeded: the routes do not require a non-empty root-folder
array, so require the owner-selected profile and exact root path to appear in
the response before proceeding. If the root is absent, an explicit Arr-side
root-folder setup (for example its own API/UI) is still needed; Seerr linking
itself needs no additional Arr mutation once the root exists.

Then Seerr can persist the link through its own API: `POST /settings/radarr` or
`/settings/sonarr` creates an entry (201); `PUT /settings/{kind}/{id}` updates
the chosen entry (200); `GET` on the collection reads it back. These are Seerr
settings writes, not Arr writes ([pinned route definitions](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml#L2782-L3047)
and [route implementations](https://github.com/seerr-team/seerr/tree/v3.5.0/server/routes/settings)).

The required saved fields are:

- Both: owner-chosen `name`, `hostname`, `port`, `apiKey`, `useSsl`,
  `activeProfileId`, `activeProfileName`, `activeDirectory`, `is4k`, and
  `isDefault`.
- Radarr additionally requires `minimumAvailability`.
- Sonarr additionally requires `enableSeasonFolders`; anime profile/directory
  fields are optional.
- `baseUrl` is an optional internal path prefix. `externalUrl` is separate
  browser-facing addressing; do not substitute it for the Compose-DNS host.
  `preventSearch` is also a separate saved choice, not a connection-test
  prerequisite.

Thus the safe per-peer plan is to test using the selected peer's private key
reference and internal DNS URL; require the chosen profile and existing root
path in the result; save only those explicit settings to Seerr; then GET back
and compare the endpoint, profile, directory, default/4K state, and other
owner-selected fields. Never return API-key values in setup records or reports.

## Gaps and replay rules

- `SetupContext.peers` exposes only `readVerifiedAdmin("jellyfin")`; the Seerr
  adapter currently sets up only first-admin/Jellyfin and its own key. It has
  no Arr peer-key API or Arr-link step ([types](../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts#L54-L83),
  [engine owner check](../../packages/cli/src/control-panel/setup-engine.ts#L114-L134),
  [Seerr adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/seerr/setup.ts#L113-L196)).
  A peer-key reader should require `ownerKind=shared` and exact equality of
  project root/ID, revision, manifest hash, Compose target, plus a successful
  read-only peer-adapter inspection and the exact owner-only key-file path.
- The Seerr recipe does not encode Arr profile, root, default/4K slot,
  minimum-availability, season-folder, internal/base URL, external URL, or
  `preventSearch` choices. Current Arr adapters also do not make Seerr's profile
  or server choices. Require those inputs explicitly; do not infer defaults
  from labels or `isDefault` alone.
- Read each Seerr settings collection before writing. If one exact compatible
  instance exists, preserve it; if none exists, create; if conflicting or
  ambiguous entries exist, stop for owner direction. `POST` creation has no
  idempotency key in OpenAPI and may duplicate after a lost response: save a
  one-time pre-send checkpoint, then GET/reconcile before any retry. For an
  intentional update, use the known ID and read it back. Setting `isDefault`
  can clear the previous default for the same `is4k` type, so that effect needs
  explicit approval. Do not retry an ambiguous create or delete/recreate an
  existing link blindly.

No claim is made here about live network reachability, exact pulled-image
contents, or persisted Seerr/Arr settings.
