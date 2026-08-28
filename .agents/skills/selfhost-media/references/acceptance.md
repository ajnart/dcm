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

Run `doctor` and the core verifier again at the end. Inspect the real UI and
redacted response structure. HTTP 200 alone is insufficient. Empty media data
passes only when the response reports no failed integrations.

The report must include the acceptance matrix with evidence paths, meaningful
action count per service, recoveries with causes, exact observed image
IDs/versions, final run status, and secret-safe Homarr API/MCP proof. Keep all
artifacts inside the selected run. Preserve the run for supervisor review unless
the user explicitly authorizes destruction.
