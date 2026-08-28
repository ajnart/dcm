# 50 - Generate Homarr from onboarding

Read `docs/homarr.md`. Open Homarr `/init`, start from scratch, and create the
standard local admin. Do not skip the onboarding integration phase.

During onboarding add, test, and link an app for all six integrations:

| Type | Docker URL | Auth |
| --- | --- | --- |
| Sonarr | `http://sonarr:8989` | per-run API key |
| Radarr | `http://radarr:7878` | per-run API key |
| Prowlarr | `http://prowlarr:9696` | per-run API key |
| qBittorrent | `http://qbittorrent:$QBITTORRENT_PORT` | standard login |
| Jellyfin | `http://jellyfin:8096` | standard login |
| Seerr | `http://seerr:5055` | per-run API key |

The missing Docker socket on Discover is expected isolation; continue to manual
Connect. Select each service card, expand its panel, enter the values above, and
use **Test connection** until all six headings say **Connection tested**.
qBittorrent and Jellyfin use the Username + Password mode.

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
