# App credentials

Setup reuses each app's documented API, CLI, or owned private configuration.
Generated administrator passwords and API credentials stay in owner-only
project files. A login session is not automatically a durable API key.

| App | Saved machine credential | Important limit |
| --- | --- | --- |
| Homarr | API key | Board/API/MCP authority follows the selected key and bridge policy. |
| Sonarr / Radarr / Prowlarr | Existing key from owned `config.xml` | No account-creation/page-scraping shortcut is needed. |
| Bazarr | Existing key from owned `config/config.yaml` | Read through the image's YAML parser; reject foreign authentication and ambiguous configuration. |
| qBittorrent | Native WebUI API key | Administrator login is verified separately; local/subnet authentication bypass must stay disabled. |
| SABnzbd | Existing key from owned `sabnzbd.ini` | Generated WebUI login must mint fresh authentication cookies; a redirect alone is not proof. |
| Jellyfin | Labeled persistent API key | Bind login and key inventory to the original administrator ID; do not adopt another account. |
| Seerr | Managed API key | Requires the selected Jellyfin administrator. An unfinished wizard is not proof that no account exists. |
| BookStack | Token ID and secret | Inherits administrator permissions; explicit 2099-01-01 expiry. |
| Forgejo | Personal access token | `read:user` account scope, not repository access. |
| Grafana | Viewer service-account token | Same organization; no dashboard/datasource writes; no expiry. |
| Technitium | Permanent administrator API token | Does not authorize a DNS cutover. |
| FreshRSS | Independent mobile API password | Stored as an API credential, not as a Google Reader Auth value; API enablement is separately approved. |
| PhotoPrism | User-bound API app password | Read-only scope, one-year lifetime, no idle timeout. Expired/changed credentials stop setup; they are not silently rotated. |
| Uptime Kuma | Permanent metrics API key | **Metrics only**, not a management/MCP token. The first key switches global `/metrics` authentication from admin Basic auth to API-key Basic auth; approval explicitly discloses this. Homarr still uses the status-page integration. |

These routes are checked against pinned upstream source and focused synthetic
fixtures. Fresh-container setup, actual function,
restart persistence, and Homarr data are separate live acceptance gates; this
table does not award compatibility points.

## Resume and handoff

Private files remain canonical; setup checkpoints bind them to the saved app
and project. Save one-time credentials before later readbacks. On resume,
verify the saved credential and its owner instead of creating another one.
Missing credentials, foreign resources, or uncertain writes require inspection,
not automatic recreation.

`app shared handoff` returns private references. Its deliberate `--show` option
prints credentials only in an explicitly requested private terminal handoff.
Approved Homarr publication also writes an owner-only `connections.json`; it
does not replace the per-app credential files. Never put secrets in a Notebook.

Pinned protocol references: [FreshRSS 1.30.0 API password](https://github.com/FreshRSS/FreshRSS/blob/1.30.0/app/Controllers/apiController.php),
[PhotoPrism OAuth handler](https://github.com/photoprism/photoprism/blob/bbde8f4521771a1b1f6a258baac1fc53c8dd0227/internal/api/oauth_token.go),
[Uptime Kuma 2.5.5 key handler](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/socket-handlers/api-key-socket-handler.js).
