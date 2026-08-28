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
redacted response structure. On Homarr, require all onboarding test calls and
every generated widget/data call to return successfully after a reload. A
Jellyfin media-release result with `releases: []` passes only when
`failedIntegrations: []`, regardless of Homarr's empty-state wording. If any row
is missing or indirect, repair it and repeat the relevant proof. Do not weaken
the row or substitute a screenshot of a form. Keep the generated MCP fragment
candidate-scoped; only the promoted winner may be installed into a client.
