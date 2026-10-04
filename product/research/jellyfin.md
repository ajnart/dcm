# Jellyfin Compose and first-run route — 2026-09-29

Status: official-source research, a validated **inspect-only** recipe, and a
source-checked first-run adapter with a synthetic fixture, not a fresh-container
acceptance result. The canonical
seven-service media harness uses Hotio `:latest` and is a separate route; do
not apply v12.1 API assumptions to it.

## Image and Compose

- The current stable official multi-arch package is
  `ghcr.io/jellyfin/jellyfin:12.1.20260915-010956`, index digest
  `sha256:008ec8024bdaaa6f0a3f0de468e185633eeba9d67c56936e8dbf5ef6b8d6200f`.
  Resolve the exact platform digest again at planning time. Sources:
  [v12.1 release](https://github.com/jellyfin/jellyfin/releases/tag/v12.1),
  [GHCR package](https://github.com/jellyfin/jellyfin/pkgs/container/jellyfin).
- The [official container guide](https://jellyfin.org/docs/general/installation/container/)
  documents Compose `user: uid:gid` instead of root, persistent `/config` and
  `/cache` volumes, and optional read-only media mounts. The pinned
  [Dockerfile](https://raw.githubusercontent.com/jellyfin/jellyfin-packaging/v12.1-202609142034/docker/Dockerfile)
  prepares the config/cache directories for a non-root process. Actual volume
  writes and restart persistence need a fresh-instance check. `PUID`/`PGID`
  belongs to other images and is not an official Jellyfin setting.
- Use TCP 8096 on the selected private bind. Omit host networking, UDP discovery,
  and GPU devices from the default recipe. Docker image `/health` is liveness,
  not account, key, library, or playback acceptance. The official image may
  serve without a selected media directory, but a useful library needs an
  owner-approved mount and path.

## Deterministic first run

1. Read public `GET /System/Info/Public`; do not infer wizard completion from
   HTTP 200 alone. On a fresh profile, `GET /Startup/User` calls
   `InitializeAsync()` despite being GET. Treat it as an approved one-shot
   mutation with a pre-send checkpoint, then `POST /Startup/User` for the
   generated `admin` credential and `POST /Startup/Complete`. Source:
   [v12.1 StartupController](https://raw.githubusercontent.com/jellyfin/jellyfin/v12.1/Jellyfin.Api/Controllers/StartupController.cs).
2. `POST /Users/AuthenticateByName` with modern `Authorization: MediaBrowser`
   client/device fields, verify the returned administrator policy and access
   token, and keep the session token private. Legacy `X-Emby-Token` is disabled
   by default in v12; do not copy the Hotio harness's header. Sources:
   [v12.1 UserController](https://raw.githubusercontent.com/jellyfin/jellyfin/v12.1/Jellyfin.Api/Controllers/UserController.cs),
   [authorization implementation](https://raw.githubusercontent.com/jellyfin/jellyfin/v12.1/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs),
   [v12 release notes](https://github.com/jellyfin/jellyfin/releases/tag/v12.0).
3. Create a uniquely labeled persistent API key with approved
   `POST /Auth/Keys?app=...`, then elevated `GET /Auth/Keys`. Require exactly
   one matching `AppName`, save its `AccessToken` privately, and verify an
   authenticated read. Avoid another create when a matching key already
   exists. Source: [v12.1 ApiKeyController](https://raw.githubusercontent.com/jellyfin/jellyfin/v12.1/Jellyfin.Api/Controllers/ApiKeyController.cs).
4. For owner-selected, mounted libraries, read
   `GET /Library/VirtualFolders`, reject same-name mismatches, create only
   missing entries with approved `POST /Library/VirtualFolders` and structured
   query fields (`name`, `collectionType`, `paths`, `refreshLibrary`), then
   read back names, types, and locations. Reject comma-bearing paths because
   the v12.1 binder splits `paths` on commas. Sources:
   [v12.1 controller](https://raw.githubusercontent.com/jellyfin/jellyfin/v12.1/Jellyfin.Api/Controllers/LibraryStructureController.cs),
   [official collection types](https://typescript-sdk.jellyfin.org/variables/generated-client.CollectionTypeOptions.html).

The shared private HTTP transport supports bounded non-secret query maps and
reviewed one-shot GETs. The first-run adapter covers the administrator and
labeled API key with durable checkpoints; it does not create a media library.
Its normal inspection verifies the completed wizard, saved checkpoint, and
API-key authorization, but cannot reauthenticate the saved password through
the read-only inspection interface. The generic manual first-admin state
accepts the recipe, but the current app CLI does not offer owner-selected mounts
through its app plan, so the recipe remains inspect-only. Keep Jellyfin
unpromoted until a fresh profile, owner-selected media mount, credentials,
readback, and safe restart are proven.
Homarr's [Jellyfin integration](https://homarr.dev/docs/integrations/jellyfin/)
also needs independent network, credential, integration, and widget readback.
