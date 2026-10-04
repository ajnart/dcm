# Jellyfin selected original read acceptance — 2026-10-03

Added an app-owned verifier for one reviewed, existing authorized Movie or
Episode original and its metadata across a restart of only `jellyfin`.
Source/fixture validation earns **zero live compatibility credit**. No service,
private runtime state, browser, Docker, or CI was used.

## Workload and source contract

`item-id` is a reviewed opaque input of at most 36 characters; the observer
further requires a non-zero compact or hyphenated hexadecimal GUID. It never
discovers an item automatically. The pinned recipe reports Jellyfin `12.1.*`;
fresh public and saved-key authenticated system reads must agree on server ID
and version, with startup complete. The saved key must come from the exact
app-private `jellyfin-api-key` handoff. No password, account login, token/key
creation, or secret-store mutation occurs.
Sources: [saved setup](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/setup.ts),
[pinned system controller](https://github.com/jellyfin/jellyfin/blob/v12.1/Jellyfin.Api/Controllers/SystemController.cs).

`GET /Items` selects only the reviewed ID with `fields=Path,MediaSources`,
`locationTypes=File`, `includeItemTypes=Movie,Episode`, `limit=1`, and images/user
data disabled. Require exactly one non-folder Movie
or Episode, Video/File/VideoFile metadata, and exactly one Default local File
media source with the same normalized `/data/...` path. Remote, open/close,
infinite-stream, ambiguous, empty, unknown-size, and oversized sources fail.
The source must already have a non-empty original of at most 1 MiB.
Sources: [pinned item query](https://github.com/jellyfin/jellyfin/blob/v12.1/Jellyfin.Api/Controllers/ItemsController.cs),
[DTO static source attachment](https://github.com/jellyfin/jellyfin/blob/v12.1/Emby.Server.Implementations/Dto/DtoService.cs),
[media-source DTO](https://github.com/jellyfin/jellyfin/blob/v12.1/MediaBrowser.Model/Dto/MediaSourceInfo.cs).

`GET /Library/VirtualFolders` must return one corresponding Movies/movies or
Shows/tvshows library with exactly one normalized local location containing the
item path. `GET /Items/{id}/Ancestors` must include that library's ItemId.
This is library membership readback, not library creation, refresh, scan,
download acquisition, or external provider activity. Sources:
[virtual-folder contract](https://github.com/jellyfin/jellyfin/blob/v12.1/MediaBrowser.Model/Entities/VirtualFolderInfo.cs),
[library controller](https://github.com/jellyfin/jellyfin/blob/v12.1/Jellyfin.Api/Controllers/LibraryController.cs).

The same library controller implements `GET /Items/{id}/Download` as a
download-authorized physical original-file response; no playback/transcode
route is used. An API-key request has no user-scoped download log in this
implementation. Require 200, a video content type, and actual bytes matching
the previously checked source Size. The common HTTP transport aborts above
1 MiB of actual received data before retaining further chunks, independent of
Content-Length. Thus this route can safely read the full small original without
depending on byte-range response headers (the transport does not expose those).
Larger media is deliberately unsupported, not a false range acceptance.
Sources: [pinned original download](https://github.com/jellyfin/jellyfin/blob/v12.1/Jellyfin.Api/Controllers/LibraryController.cs),
[bounded transport](../../packages/cli/src/control-panel/setup-transport.ts).
Current documentation was resolved through Context7's Jellyfin API index; pinned
v12.1 source governs runtime behavior, not the latest indexed OpenAPI.

## Persistence and claims

The shared read-only lifecycle factory owns exact completed shared-owner,
immutable service/image identity, isolated acceptance checkpoint, immutable
reviewed input, CAS writes, and actual recorded running → stopped → distinct
running chronology. It stores only server/item/library/source IDs, original
size/SHA-256, and a SHA-256 of selected item/source/library metadata. Paths,
titles, bytes, and keys never appear in the baseline. Finish must preserve both
original bytes and selected metadata; a second begin cannot replace a changed
baseline. Bounded authenticated readiness reads tolerate startup connection
failure/502/503/504 only; denial fails immediately.

The reviewed mapping covers authenticated API health, selected local original
delivery/read, and persistence across only the exact service restart. It does
not prove rendered playback, codec decoding, transcoding, full libraries,
client/device networking, Homarr, external providers, acquisition, or recovery.
No cleanup writes are needed for this existing read-only workload.
Sources: [adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/acceptance.ts),
[reviewed result contract](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/jellyfin/acceptance-contract.json),
[shared lifecycle](../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/acceptance-lifecycle.ts).

## Focused validation

Bun 1.4.0 ran only `packages/cli/tests/jellyfin-read-acceptance.test.ts` and built
the changed adapter and fixture. The synthetic fixture checks GET-only intent,
saved-key-only auth, UUID input bounds, no title/path/bytes/key checkpoint leaks,
immutable repeated begin, exact restart/service/owner lineage, changed original
bytes and metadata, remote/multiple/missing media, wrong/duplicate library,
oversized preflight, empty/truncated/oversized actual bytes, non-video response,
denied credentials, and truthful reviewed result mapping.
No broad suites, live receipts, Docker, browser, deployments, commits, or pushes.
