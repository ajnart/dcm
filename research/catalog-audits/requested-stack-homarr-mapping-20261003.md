# Requested stack: Homarr mapping review

Source-only review on 2026-10-03. Homarr checkout `/tmp/homarr-hostnames-6997-review`
is pinned to production fix `c8c0a72bb016a2c46aa447d74eeba3e05fa7b070`.
No runtime configuration, credentials, containers, network state, or live APIs were inspected.

## Coverage

| App | Native kind / saved credential mode | Catalog widgets |
| --- | --- | --- |
| qBittorrent | `qBittorrent`; API key or username/password | downloads |
| SABnzbd | `sabNzbd`; API key | downloads |
| Sonarr | `sonarr`; API key | calendar, missing/queued media |
| Radarr | `radarr`; API key | calendar, missing/queued media |
| Bazarr | `bazarr`; API key | subtitle badges |
| Seerr | `seerr`; API key | request list and statistics |
| Navidrome | `navidrome`; username/password | audio statistics, active streams |
| Immich | `immich`; API key | server statistics; album carousel requires selected album |
| Beszel hub | `beszel`; username/password | system grid/table, alerts; system statistics requires selected system |
| Portainer | tile only | none |
| ntfy | `ntfy`; topic, optionally API key | notifications |
| Jellyfin | `jellyfin`; API key or username/password | active streams, releases |
| Homarr | dashboard / tile only | no self-integration |

No incorrect integration identifier, credential alternative, widget procedure,
input envelope, or required response field was demonstrated in these app-owned
`homarr.json` records against the pinned source. No mapping edit is justified.
Beszel's optional agent is not a second Homarr integration: the hub owns system
inventory and its widgets; enrollment and actual metrics remain separate evidence.

## Fixed prerequisite forwarding gap

The shared publication path previously accepted only `topic`/`slug` and
constructed `HomarrStackSeedService` without `prerequisites`, omitting Immich's
album carousel and Beszel's per-system statistics. It now derives allowed
kebab-case choices from validated catalog widget prerequisites, forwards their
canonical names to the existing seed, and reports selected/omitted widgets
consistently. Choices are persisted and remain bound by the existing outer
approval; the lower-level approval already binds selected widget options.
One fixed source-owned prerequisite/input/option table also drives the existing
widget mapper. It includes Home Assistant's manually clickable automation
widget, which intentionally has no read contract. Configuration never executes
the automation; its functional data check stays `not-run`.
Missing choices still omit these widgets. No album, system, or agent is created.

Examples: `--input immich.immich-album-id=EXISTING_ALBUM_ID` and
`--input beszel.beszel-system-id=EXISTING_SYSTEM_ID` on `app shared homarr-plan`
and its separately approved `homarr-apply`.

## Reuse and acceptance boundaries

- Keep existing catalog-driven credential selection and widget read contracts;
  no app-specific routing layer is needed.
- `resolved-app.ts` already separates browser published-port URLs from Homarr
  server URLs using the selected Docker service and container port. Known
  frontend Docker-DNS/authority blockers need their own evidence/fix; this
  review does not claim to resolve them.
- `homarr-stack-seed.ts` reuses exact owned integrations and checks private-board,
  linked-app, widget, and credential-mode metadata. `shared-homarr.ts` reuses the
  stack recap and redacted readback; `homarr-live-verification.ts` reads exact
  provider data and rejects provider errors/identity mismatches.
- A tile proves neither an integration nor widget content. Empty lists can
  legitimately pass a response-shape contract, but do not prove seeded media,
  active playback, notifications, photos, monitoring enrollment, or rendered UI.
- ntfy needs an explicit topic choice as well as its saved token for this
  authenticated recipe; inventing a topic is not acceptance.

Evidence: pinned Homarr `packages/definitions/src/integration.ts`,
`packages/api/src/router/widgets/{downloads,calendar,media-organizer,bazarr,media-requests,audio-stats,media-server,media-release,immich,beszel,notifications}.ts`,
and the corresponding integration/request-handler types; Auto-Stack catalog
descriptors and `packages/cli/src/lib/{homarr-stack-mapping,homarr-stack-seed,homarr-live-verification,resolved-app}.ts`.

The affected `shared-homarr-recipe-drift.test.ts` synthetic owner/HTTP fixture
passed: optional selection/omission, changed-ID stale-approval rejection,
wrong-app/DEL input rejection, persistence before an uncertain publication,
and saved-choice status readback. `bun build packages/cli/src/shared-homarr.ts
--target=bun --outfile=/dev/null` and focused diff hygiene also passed.
The same affected fixture verifies a saved Home Assistant automation choice
matches the exact `automationId` widget option and remains `not-run` for data,
with no automation execution request; unknown/wrong-app choices are rejected.
No deployment, browser, widget rendering, restart, or live integration claim is made.
