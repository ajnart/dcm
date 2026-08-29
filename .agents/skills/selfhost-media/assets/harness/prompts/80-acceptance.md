# 80 - Acceptance matrix

Treat every row as unproven until its listed evidence exists.

| Requirement | Required evidence |
| --- | --- |
| Isolated run | unique project, state root, ports, network, browser session |
| Seven services | project-scoped status plus expected HTTP/health response |
| qBittorrent auth | new per-run login and authenticated version API |
| Sonarr/Radarr -> qBittorrent | enabled client records and passing tests |
| Prowlarr -> Sonarr/Radarr | two passing full-sync apps; indexer downstream |
| Jellyfin | admin login and two media libraries |
| Seerr | initialized, Jellyfin connected, default Sonarr/Radarr fully set |
| Homarr integrations | six passing records; apps use host URL + internal ping |
| Homarr auto-generation | all app tiles and live widgets visible after reload |
| Homarr API/MCP | private key capture plus `homarr-finalize`, `mcp-config`, and `mcp-verify` PASS; secret-free `mcp-client.json`; canonical `/api/mcp` and bridge read-only searches find Spider-Man: No Way Home; no request/download or client install |

Run `scripts/session.sh doctor "$RUN_ID"` again. Inspect only redacted API output
and run `scripts/session.sh verify "$RUN_ID"` again. Inspect this run's UI and
redacted response structure. On Homarr, require all onboarding test calls and a
fixed proof row for each expected generated-widget procedure:
`widget.indexerManager.getIndexersStatus`,
`widget.downloads.getJobsAndStatuses`, `widget.mediaRequests.getStats`,
`widget.mediaServer.getCurrentStreams`, `widget.calendar.findAllEvents`,
`widget.mediaOrganizer.getData`, and
`widget.mediaRelease.getMediaReleases`. Each row records only method `GET`, the
sanitized `/api/trpc/<procedure>` path without query data, HTTP status 200, and
a non-error response-envelope classification after reload. `mediaRelease` proof
must also report `releases.length` and `failedIntegrations.length`; a zero
release count is valid only when the failed-integration count is zero. Visible
empty-state text, `Try again`, or a screenshot alone is not widget evidence. If
any row is missing or indirect, repair it and repeat the relevant proof. Do not
weaken the row or substitute a screenshot of a form. Keep the generated MCP
fragment candidate-scoped; only the promoted winner may be installed into a
client.
