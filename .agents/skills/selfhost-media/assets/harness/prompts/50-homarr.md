# 50 - Generate Homarr from onboarding

Read `docs/homarr.md`. Open Homarr `/init`, start from scratch, and create the
local admin username `admin`. Fill its password and confirmation fields through
`scripts/session.sh browser-password "$RUN_ID" @eN @eN` using fresh refs. Do
not skip the onboarding integration phase.

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

For Sonarr, Radarr, Prowlarr, and Seerr, use agent-browser to open the
run-scoped host URL at the table path and take a fresh snapshot. Capture the
visible key field without printing it:

```bash
scripts/session.sh browser-key capture "$RUN_ID" SERVICE @eN
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

Stop onboarding work after proving the generated board. Preserve the six apps
exactly as generated and do not edit them in the UI.
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
