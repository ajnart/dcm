# Acceptance contract

Treat every row as unproven until its direct evidence exists.

| Requirement | Direct evidence |
| --- | --- |
| Isolated run | Unique Compose project, state root, ports, network, and browser session |
| Seven services | Project-scoped status plus expected HTTP or health response |
| qBittorrent authentication | Fresh login plus authenticated version API |
| Sonarr/Radarr to qBittorrent | Enabled client records and passing tests |
| Prowlarr to Sonarr/Radarr | Two passing full-sync apps and downstream indexer |
| Jellyfin | Authenticated home page with Movies and Shows libraries |
| Seerr | Jellyfin connected; default Sonarr and Radarr fully configured |
| Homarr integrations | Six passing records with host app links and internal ping URLs |
| Homarr auto-generation | Six onboarding-generated app tiles and live widgets after reload |
| Homarr API/MCP | Private key capture; finalizer/config/verifier PASS; canonical endpoint and bridge return the read-only match; no mutation or client install |
| Reusable connections | Password-free private connections file refreshed after acceptance; initial setup, or explicitly requested fresh upkeep handoff, displays the admin username and derived password to the user |

Run `doctor` and the core verifier again at the end. Inspect the real UI and
redacted response structure. HTTP 200 alone is insufficient. Empty media data
passes only when the response reports no failed integrations.

For Homarr widgets, require one fixed proof row for each expected procedure:
`widget.indexerManager.getIndexersStatus`,
`widget.downloads.getJobsAndStatuses`, `widget.mediaRequests.getStats`,
`widget.mediaServer.getCurrentStreams`, `widget.calendar.findAllEvents`,
`widget.mediaOrganizer.getData`, and
`widget.mediaRelease.getMediaReleases`. Each row records only method `GET`, its
sanitized `/api/trpc/<procedure>` path without query data, HTTP status 200, and a
non-error response-envelope classification. `mediaRelease` proof must also
report `releases.length` and `failedIntegrations.length`; a zero release count
passes only when the failed-integration count is zero. Visible empty-state text,
`Try again`, or a screenshot alone is not evidence.

The report must include the acceptance matrix with evidence paths, meaningful
action count per service, recoveries with causes, exact observed image
IDs/versions, final run status, and secret-safe Homarr API/MCP proof. Keep all
artifacts inside the selected run. Preserve the run for user review unless the
user explicitly authorizes destruction.
