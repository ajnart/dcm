# Homarr TLDR

- Purpose: final dashboard, apps, live integration widgets, API/MCP, and
  acceptance UI.
- Required image: `ghcr.io/homarr-labs/homarr-test:v2` (never substitute stable).
- Internal port: `7575`; host URL comes from `scripts/session.sh urls`.
- State: `/appdata`; per-run 64-hex `SECRET_ENCRYPTION_KEY` is required.
- No Docker socket is mounted: each Homarr must see only explicitly configured
  integrations, not neighboring test stacks.

## Minimum fresh-run path

Run `bun scripts/setup-homarr.ts RUN_ID personal` after Jellyfin, Seerr, and
the Arr services pass their setup scripts. This uses the first-party
onboarding API, not a manually constructed board: claim, admin creation,
credentials login, six connection tests, `completeSetup`, then `apiKeys.create`.
It stores the key in the private run and prints no credential value. Continue
with `session.sh homarr-finalize`, `mcp-config`, and `mcp-verify`.
The API path is not yet live-proven in this revision; use the browser fallback
below when it fails and record the exact failure. Do not call a browser merely
to repeat a successful API form.
Use `bun scripts/prove-homarr-widgets-api.ts RUN_ID personal` for the
generated-widget API check; screenshots remain separate visual evidence.

### Browser fallback

1. Open `/init` with agent-browser, start from scratch, and create the standard
   local admin username `$ADMIN_USERNAME`. Fill its fresh password and confirmation refs
   through `scripts/session.sh browser-password "$RUN_ID" @eN @eN`.
2. Continue past Discover when it reports the intentionally absent Docker
   socket; manual setup is the isolation-safe path.
3. Do not skip onboarding's Connect step. Add and test **all six** services
   before finishing: Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin, and Seerr.
4. Use Docker URLs: `http://sonarr:8989`, `http://radarr:7878`,
   `http://prowlarr:9696`, `http://qbittorrent:$QBITTORRENT_PORT`,
   `http://jellyfin:8096`, and `http://seerr:5055`.
5. Use agent-browser to retrieve each Arr/Seerr key from its current
   run-scoped settings path, then fill the matching Homarr form with
   `scripts/session.sh browser-key`; use the exact workflow below. Select the
   username/password mode for qBittorrent and Jellyfin. Fill each password ref
   only through `scripts/session.sh browser-password "$RUN_ID" @eN`.
6. Review must state 6 integrations and 6 app tiles. Build and let `v2` generate
   the dashboard. Do not manually add apps/widgets: generation itself is under
   test.
7. Stop UI configuration after proving the generated board. In
   `/manage/tools/api`, use the **Authentication** tab to create one API key for
   this run. After the key appears beside **Copy API key**, capture its one-time
   code privately through `./scripts/session.sh browser-key capture-code
   "$RUN_ID" homarr`; do not copy it to the clipboard, expose it, or stage it.
8. Run `./scripts/session.sh homarr-finalize "$RUN_ID" "$BOARD_NAME"`,
   `./scripts/session.sh mcp-config "$RUN_ID"`, and
   `./scripts/session.sh mcp-verify "$RUN_ID"` in that order. The finalizer
   changes only the six generated apps to host-reachable primary links while
   retaining their Docker URLs for container-side ping. If `app_update` reports
   an error after committing a change, the finalizer accepts it only when a
   fresh read-only `app_all` finds exactly one app matching every submitted
   writable field: `id`, `name`, `description`, `iconUrl`, `href`, and
   `pingUrl`; every other case preserves the update failure. Final verification
   repeats the full-field check for mutated apps and the URL check for unchanged
   apps.
9. Keep the secret-free client fragment run-scoped and uninstalled unless the
   user separately authorizes client installation.

## Agent-browser credential path (fallback)

Resolve every host URL with `scripts/session.sh urls RUN_ID`; never open the
Docker URL in the host browser. These current upstream helper paths were
rechecked on 2026-09-07:

| Service | Host-browser path | Browser action |
| --- | --- | --- |
| Sonarr | `/settings/general` | capture the fixed readonly API-key field, then fill Homarr |
| Radarr | `/settings/general` | capture the fixed readonly API-key field, then fill Homarr |
| Prowlarr | `/settings/general` | capture the fixed readonly API-key field, then fill Homarr |
| Seerr | `/settings` | capture the API-key ref, then fill Homarr |
| qBittorrent | `/#/settings/webui` | reference only; Homarr uses the managed login |
| Jellyfin | `/web/index.html#!/dashboard/keys` | reference only; Homarr uses the managed login |
| Homarr | `/init`, then **Extend** → **MCP** | create the key, then use `capture-code` on the one-time code beside **Copy API key** |

For Sonarr, Radarr, and Prowlarr, navigate directly to `/settings/general` and
capture the fixed readonly field without a snapshot or ref:

```bash
scripts/session.sh browser-key capture-field "$RUN_ID" SERVICE
```

For Seerr, navigate directly to settings and obtain a fresh input ref with
`scripts/session.sh browser-key refs "$RUN_ID" seerr`.
This privately snapshots the page and prints only the single API-key field ref. Capture the DOM input
value through the private helper; do not click Copy (clipboard APIs can fail on
HTTP). Do not print `get value` directly or inspect full authenticated HTML.
If the field is absent, check the current page and Show Advanced once, then
refresh refs instead of retrying a stale selector:


```bash
scripts/session.sh browser-key capture "$RUN_ID" seerr @eN
scripts/session.sh browser-key capture-code "$RUN_ID" homarr
```

This proves that the UI value matches the run's managed key. Return to Homarr,
snapshot its integration form, and fill the fresh key ref:

```bash
scripts/session.sh browser-key fill "$RUN_ID" SERVICE @eN
```

The helper accepts `sonarr`, `radarr`, `prowlarr`, or `seerr`; Homarr is
capture-only. It tries the installed agent-browser executable first and falls
back to `bunx --bun agent-browser` only when that executable is absent. Browser
output is suppressed, values travel through stdin or private process memory,
and only fixed PASS/FAIL text is emitted.

## API/MCP contract

- Native Streamable HTTP endpoint: `/api/mcp`.
- Compatibility alias: `/api/mcp/mcp`; probe it only when the canonical route
  is unavailable and never select it for new configuration.
- Authentication: the private per-run key in the `ApiKey` header. The harness,
  not setup-authored commands or config, owns key injection.
- Direct native MCP is the target. The generated local stdio bridge injects the
  private per-run key without persisting it in client configuration. It projects
  only `integration_all`, `integration_byId`, and
  `integration_searchMediaRequests` from a successful native catalog. The same
  three curated schemas are available only for exact RPC `-32603` message
  `Date cannot be represented in JSON Schema`. Neither mode masks auth, route,
  or network failures.
- `mcp-config` writes the credential-free run fragment to
  `SESSION_ROOT/artifacts/mcp-client.json`. It remains uninstalled unless the
  user separately authorizes a client configuration change.
  The fragment identifies the local bridge and `RUN_ID`, never the key value.

The bridge uses `integration_all` and `integration_byId` to verify the one Seerr
integration, then calls `integration_searchMediaRequests`. Acceptance is
intentionally read-only: search for **Spider-Man: No Way Home**, record the
exact structured match, then stop. The bridge rejects `app_update`,
`integration_requestMedia`, `mediaRequests_answerRequest`, and every other
unapproved tool before upstream dispatch.

## Proof

- Every onboarding integration test passes.
- Management -> Integrations lists exactly one connected integration for each of
  the six service types, each linked to an app.
- Management -> Apps shows host-reachable primary URLs and Docker-reachable ping
  URLs for all six service apps.
- `homarr-finalize`, `mcp-config`, and `mcp-verify` emit PASS without revealing
  the key; canonical native MCP and the stdio adapter return the read-only title
  search result, with native-versus-curated catalog mode reported explicitly.
- The board-detail API lists all six app tiles plus integration-backed widgets,
  including Seerr requests, Jellyfin media, qBittorrent downloads, and
  Arr/Prowlarr data. If the user requests visual proof, reload the board, leave
  edit mode, and capture a full-page screenshot in the run's artifact directory.
- Fixed API evidence contains one row for each expected procedure:
  `widget.indexerManager.getIndexersStatus`,
  `widget.downloads.getJobsAndStatuses`, `widget.mediaRequests.getStats`,
  `widget.mediaServer.getCurrentStreams`, `widget.calendar.findAllEvents`,
  `widget.mediaOrganizer.getData`, and
  `widget.mediaRelease.getMediaReleases`. Each row records only method `GET`, its
  sanitized `/api/trpc/<procedure>` path without query data, HTTP status 200,
  and a non-error response-envelope classification.
- `mediaRelease` proof also reports `releases.length` and
  `failedIntegrations.length`; a zero release count is valid only when the
  failed-integration count is zero. Visible empty-state text,
  `No integration data available`, `Try again`, or a screenshot alone is not
  widget evidence.

## Traps

- Integration URLs are base URLs only; never append settings/API paths.
- Homarr's Docker URLs are not host-browser routes. Use the run-scoped host URL
  plus the table suffix when retrieving credentials with agent-browser.
- Re-snapshot after dialogs and menus; stale refs and overlays are common.
- Never pass the derived password in an agent-browser or shell argument; use
  only the bounded browser-password helper with fresh refs.
- During setup, never invoke, print, or persist authenticated agent-browser
  diagnostics such as `console`, raw `network requests`, or HAR output inside
  or outside the run; use only page-scoped approved fixed summaries or fixed
  harness summaries.
- A green integration list without visible generated apps/widgets is incomplete.
- Never fall back to post-onboarding manual placement to claim auto-generation.
- Never screenshot the one-time API key or put it in a client fragment.
- Never invoke media request/download tools as part of verification.

Sources: [Docker installation](https://homarr.dev/docs/getting-started/installation/docker/),
[integration management](https://homarr.dev/docs/management/integrations/),
[API](https://homarr.dev/docs/management/api/),
[MCP](https://homarr.dev/docs/management/mcp/), and
[Seerr integration](https://homarr.dev/docs/integrations/seerr/). Exact helper
paths come from Homarr's current
[`integration.ts`](https://github.com/homarr-labs/homarr/blob/dev/packages/definitions/src/integration.ts).
