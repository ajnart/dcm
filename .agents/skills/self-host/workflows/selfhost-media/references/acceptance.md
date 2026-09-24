# Acceptance contract

Treat every row as unproven until its direct evidence exists.

| Requirement | Direct evidence |
| --- | --- |
| Isolated run | Unique Compose project, state root, ports, network, and browser session |
| Seven services | Project-scoped status plus expected HTTP or health response |
| qBittorrent authentication | Fresh login plus authenticated version API |
| Sonarr/Radarr to qBittorrent | Enabled client records and passing tests |
| Prowlarr to Sonarr/Radarr | Two passing full-sync apps and downstream indexer |
| Jellyfin | Authenticated admin API session and Movies/Shows virtual folders; visual home proof when requested |
| Seerr | Jellyfin connected; default Sonarr and Radarr fully configured |
| Homarr integrations | Six passing records with host app links and internal ping URLs |
| Homarr auto-generation | API board detail has six linked app items and integration-backed widgets; live widget queries pass; visual reload proof when requested |
| Credential setup | Run-scoped scripts pass without emitting values; browser fallback uses fresh refs and private helpers; no key appears in arguments or output |
| Homarr API/MCP | Private key created by setup script or captured by browser fallback; finalizer/config/verifier PASS; canonical endpoint and bridge return the read-only match; no media mutation or client install |
| Reusable connections | Password-free private connections file refreshed after acceptance; explicitly requested handoff writes owner-only private credentials and a separate redacted report; only paths appear in output |

Run `doctor` and the core verifier again at the end. Inspect authenticated API
records and redacted response structure; use the real UI when a fallback or
screenshot is needed. HTTP 200 alone is insufficient. Empty media data
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
