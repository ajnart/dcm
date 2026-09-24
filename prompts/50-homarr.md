# 50 - Generate Homarr from onboarding

Read `docs/homarr.md`. Run `bun scripts/setup-homarr.ts "$RUN_ID"
"$BOARD_NAME"` after the six services are configured. The script claims the
fresh onboarding session, creates or signs in as `$ADMIN_USERNAME`, tests all
six internal integrations, builds their generated board, and stores a private
Homarr API key. It does not install the MCP client configuration.

If it fails, stop and diagnose the specific step. Use the browser workflow
below only as a targeted fallback; do not bypass a claim held by another
client. On resume, inspect the current onboarding step and existing key first.

## Browser fallback

Open Homarr `/init`, start from scratch, and create the local admin username
`$ADMIN_USERNAME`. Fill password fields through
`scripts/session.sh browser-password "$RUN_ID" @eN @eN` using fresh refs.
Do not skip the onboarding integration phase.

During onboarding add, test, and link an app for all six integrations. The
Docker URL is what Homarr stores; the host-browser path is where agent-browser
retrieves the current credential before filling Homarr:

| Type | Docker URL | Host-browser credential path | Auth |
| --- | --- | --- | --- |
| Sonarr | `http://sonarr:8989` | `$SONARR_URL/settings/general` | per-run API key |
| Radarr | `http://radarr:7878` | `$RADARR_URL/settings/general` | per-run API key |
| Prowlarr | `http://prowlarr:9696` | `$PROWLARR_URL/settings/general` | per-run API key |
| qBittorrent | `http://qbittorrent:$QBITTORRENT_PORT` | `$QBITTORRENT_URL/#/settings/webui` | per-run login |
| Jellyfin | `http://jellyfin:8096` | `$JELLYFIN_URL/web/index.html#!/dashboard/keys` | per-run login |
| Seerr | `http://seerr:5055` | `$SEERR_URL/settings` | per-run API key |

The missing Docker socket on Discover is expected isolation; continue to manual
Connect. Select each service card, expand its panel, enter the values above, and
use **Test connection** until all six headings say **Connection tested**.
qBittorrent and Jellyfin use the Username + Password mode.
For each password input, take a fresh snapshot and call
`scripts/session.sh browser-password "$RUN_ID" @eN`; never place the password
in an agent-browser or shell argument.

For Sonarr, Radarr, and Prowlarr, capture the fixed readonly API-key field
directly from `/settings/general` without a snapshot or ref:

```bash
scripts/session.sh browser-key capture-field "$RUN_ID" SERVICE
```

For Seerr, open its run-scoped settings URL and use `browser-key refs RUN_ID
seerr`; ordinary snapshots can reveal its value.
Capture that fresh field without printing it:

```bash
scripts/session.sh browser-key capture "$RUN_ID" seerr @eN
```

The capture must match the key already managed by this run. Return to the
Homarr integration form, take another snapshot, and fill its fresh key ref:

```bash
scripts/session.sh browser-key fill "$RUN_ID" SERVICE @eN
```

Use only `sonarr`, `radarr`, `prowlarr`, or `seerr` for `SERVICE`. Both helpers
send values through the run-scoped browser process without putting them in
arguments, terminal output, screenshots, or reports. Re-snapshot after every
navigation or form change.

On Review require **6 integrations** and **6 app tiles**, then Build my board and
Open my board. Dismiss the tour with a real click if keyboard activation merely
advances it. Do not manually add or move an app/widget to manufacture success.

Prove the generated board before adding optional content. Preserve its six
generated apps. After that proof, add a TLDR Notebook widget to the personal
board with service purposes, access links, storage/backup notes and MCP usage.
Use `scripts/session.sh homarr-notebook "$RUN_ID" "$BOARD_NAME"` with the exact
created board name. The helper preserves existing items and verifies the saved
recap; repeating it does not add a duplicate. Never put credentials or the
private artifact contents in the widget.
`prompts/60-homarr-api-mcp.md` captures a Homarr API key and runs the
deterministic finalizer that assigns host-reachable app links while retaining
the Docker URLs for internal ping.

## Stop gate

Management -> Integrations lists the six tested Docker URLs and Management ->
Apps lists all six onboarding-generated, linked apps. After reload, the board
contains all six generated app tiles and the generated widgets request Seerr
list/stats, Jellyfin releases/streams, qBittorrent downloads, Sonarr/Radarr
calendar/organizer, and Prowlarr status without an integration failure.
For `widget.mediaRelease.getMediaReleases`, inspect the tRPC result rather than
the empty-state label: `releases: []` is valid only when
`failedIntegrations: []`. Homarr may label that valid fresh-library result
`No integration data available`; a non-empty `failedIntegrations` or tRPC error
is a failure. Other empty libraries and request queues may likewise render
empty-state text when their response contains no integration failure. Continue
to module 60 for app-link finalization and API/MCP proof.
