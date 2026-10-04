# Homarr TLDR

- Purpose: final dashboard, apps, live integration widgets, API/MCP, and
  acceptance UI.
- Default image: `ghcr.io/homarr-labs/homarr:dev` (never substitute stable).
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
Verify the API path in each run; use the browser fallback below when it fails
and record the exact failure. Do not call a browser merely
to repeat a successful API form.
Use `bun scripts/prove-homarr-widgets-api.ts RUN_ID personal` for the
generated-widget API check; screenshots remain separate visual evidence.
After that proof, run `scripts/session.sh homarr-notebook plan RUN_ID personal`,
review its actions and `approvalDigest`, then run `scripts/session.sh
homarr-notebook apply RUN_ID personal --approve 'sha256:...'` with that digest.
Require `status: applied`; re-plan if the board changes.
It adds or updates a private stack recap through the board API and verifies
the saved Notebook before the final **View dashboard** link is offered. The
helper adds a new Notebook at a readable size and updates existing content
through the Notebook-only API. For a too-small existing recap it plans a
guarded `board.saveBoard` resize only when the target space is collision-free;
otherwise it refuses and requires the browser layout fallback. The
recap explains Homarr's Seerr-backed search bar (Ctrl+K) and the authorization
and indexer prerequisites for requesting a movie. Each generated app tile gets
a short description alongside its browser URL and internal ping target.

An optional board cleanup is available after app-link finalization and the
first generated-widget proof:

```bash
scripts/session.sh homarr-board-polish plan RUN_ID personal
```

The read-only plan cites the exact audited Homarr source snapshot and returns
an approval digest only when all seven unchanged starter items are present.
It lists every planned base/mobile y-offset delta for the 13 verified managed
media items. The digest covers those deltas and the full source board.
Approve it explicitly as `APPLY-HOMARR-BOARD:<approvalDigest>`, then run:

```bash
scripts/session.sh homarr-board-polish apply RUN_ID personal --approve 'sha256:...'
```

This board-only save removes the four upstream resource app tiles plus Clock,
Weather, and Useful Links, then compacts only the verified managed media items
upward without changing their x-offsets or sizes. Unrecognized and user-owned
items, including the recap, are fixed obstacles whose full content and layouts
must read back exactly. Sections and layout definitions are also unchanged.
Partial or customized starters, overlaps, extra layouts, or complex sections
are refused rather than guessed. Re-run
`prove-homarr-widgets-api.ts` after apply. The digest detects changes between
plan and apply; keep the board idle during the save because Homarr does not
offer a board revision precondition. Apply verifies every retained item and
rejects any base/mobile overlap. A fresh desktop and mobile reload or
screenshot is still required for visual acceptance.

For a board with added app tiles or recaps, separately opt into layout-only
packing of **all** items, including user-owned ones:

```bash
scripts/session.sh homarr-board-polish plan RUN_ID personal --reflow-all
scripts/session.sh homarr-board-polish apply RUN_ID personal --approve 'sha256:...' --reflow-all
```

The standalone CLI accepts the same `--reflow-all` switch on
`self-host install media board-polish plan|apply`. Review every x/y delta and
approve the new mode-bound digest; a starter-cleanup approval cannot authorize
reflow. App tiles pack first, other widgets next, and Notebooks last, using
stable kind/item-ID ordering and top-left free slots in each layout. No item is
deleted and no content, options, integrations, dimensions, sections, or layout
definitions change. Without the switch, user layouts remain fixed. Preserved
sizes may still clip a long recap; packing does not prove readable sizing or
desktop/mobile visual acceptance.

### Browser fallback

Before step 1, validate all four managed Arr/Seerr API keys on their service
settings pages with the private capture helpers below. Then stay on Homarr
`/init` until Review and Build: navigating back to a source app during Connect
can reset unsaved integration forms. `browser-key fill` uses the run's managed
key without revisiting that app.

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
5. Fill each matching Homarr form with `scripts/session.sh browser-key` from
   the already validated run-scoped key; do not leave Connect to revisit the
   settings pages. Select the
   username/password mode for qBittorrent and Jellyfin. Fill each password ref
   only through `scripts/session.sh browser-password "$RUN_ID" @eN`.
   Keep only one integration panel open while filling a key: the helper refuses
   ambiguous visible API-key fields. Test, use Save if offered, and collapse
   each panel once; do not reopen it merely to check. A tested credential-mode
   card may then show `Needs configuration`. Let Review's six-integration/six-app count and the
   post-Build management pages establish persistence; stop on a short count.
6. Review must state 6 integrations and 6 app tiles. Build and let `v2` generate
   the dashboard. Do not manually add apps/widgets: generation itself is under
   test.
7. Stop UI configuration after proving the generated board. In
   `/manage/tools/api`, use the **Authentication** tab to create one API key for
   this run. While the **API token created** alert is open, capture its
   read-only field privately through `./scripts/session.sh browser-key capture-code
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
| Homarr | `/manage/tools/api` → **Authentication**, or `/init` → **Extend** → **MCP** | create one key, then use `capture-code` on the exact one-time key field/code |

For Sonarr, Radarr, and Prowlarr, navigate directly to `/settings/general` and
capture the fixed readonly field without a snapshot or ref:

```bash
scripts/session.sh browser-key capture-field "$RUN_ID" SERVICE
```

For Seerr, finish onboarding, navigate directly to General Settings at
`/settings`, and obtain a fresh input ref with
`scripts/session.sh browser-key refs "$RUN_ID" seerr`.
This privately snapshots the page and prints only the single API-key field ref. Capture the DOM input
value through the private helper; do not click Copy (clipboard APIs can fail on
HTTP). Do not print `get value` directly or inspect full authenticated HTML.
The `/setup` page is not Seerr General Settings: a generic API-key field there
must not be captured as Seerr's managed key. If General Settings capture is
unavailable, the authenticated Seerr verifier row can validate the managed
`API_KEY` before it is filled into Homarr.
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
