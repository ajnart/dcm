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
| Reusable connections | password-free `connections.env` refreshed; initial setup, or explicitly requested fresh upkeep handoff, returns the access artifact paths without credential values |

Run `scripts/session.sh doctor "$RUN_ID"` again. Inspect only redacted API output
and run `scripts/session.sh verify "$RUN_ID"` again. After every acceptance row
passes, run `scripts/session.sh connections "$RUN_ID"` and return its path. For
initial setup, also run `scripts/session.sh handoff "$RUN_ID"` as the final
command and return only its artifact paths. During
upkeep, run `handoff` only when the user explicitly asked for a fresh access
handoff. Do not copy the password into evidence. Inspect this run's UI and
redacted response structure. Run `scripts/session.sh homarr-widgets "$RUN_ID"
"$BOARD_NAME"` on the saved board after reload and before adding the recap.
On Homarr, require all onboarding test calls and a
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
fragment run-scoped and uninstalled unless the user separately authorizes its
installation.
