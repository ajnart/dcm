# Setup routes and current gaps

Use the shortest verified route for the **selected** app, not a blanket promise
that every catalog record has an API installer. The managed seven-service media
harness uses private curl-backed HTTP for service configuration. Initial
credentials may need an app-specific bootstrap before those calls work.

| App | First credential or account | Configuration route | Browser use |
| --- | --- | --- | --- |
| Homarr `homarr:dev` (new installs) | `onboard` claim and `user.initUser`, then cookie login and `apiKeys.create` through authenticated tRPC | Six onboarding connection tests and `completeSetup`; board API for recap; `ApiKey` thereafter | Failed/changed procedure or requested visual proof |
| Sonarr, Radarr, Prowlarr | Read each fresh API key from the owned container's private `/config/config.xml` using project-scoped `docker compose exec` | Authenticated `/api/v3` or `/api/v1` endpoints for login settings, folders, clients, and app sync | API/bootstrap failure or external instance without owned config access |
| qBittorrent | The harness reads the upstream-generated temporary password from its own fresh container log, then uses cookie login; the exact Hotio image still needs live proof | `/api/v2` preferences and categories | Missing/changed password log, API/bootstrap failure |
| Jellyfin | Startup and admin APIs | Login and library APIs | API/bootstrap failure or visual proof |
| Seerr | Jellyfin-authenticated setup, then managed key/cookie | `/api/v1` Jellyfin, Sonarr, and Radarr settings | API/bootstrap failure or visual proof |

All these app calls run through the [private curl transport](headless-setup.md)
except the scoped Docker key/password reads and the later Homarr board/MCP
helpers. A Sonarr API key is **not** obtained by creating an account and
scraping Settings. Once the owned service has initialized, its key already
exists in its private config; the script then uses the API to set the admin
login. For an existing external instance where the agent cannot read that
config, it must use an authorized key source or a checked browser path. It
must not silently assume access to another project's files.

Homarr's [v2 API reference](https://v2.preview.homarr.dev/docs/management/api/)
documents OpenAPI and tRPC, `ApiKey` authentication, and board automation. Its
[integration guide](https://v2.preview.homarr.dev/docs/management/integrations/)
distinguishes the server-side integration URL from the browser-facing app URL
and requires a passing connection test. The [MCP guide](https://v2.preview.homarr.dev/docs/management/mcp/)
documents `/api/mcp`. The public overview does not specify the full input and
output schema for every onboarding and Notebook procedure; inspect the
generated API specification and the **running image** before adapting a
generic setup. The harness's exact tRPC calls are image-specific. Check them
against the running image, keep its browser fallback, and report the failing
procedure if it differs.

The seven-service media harness is the legacy route described above. New shared
projects discover recipe/setup coverage from each app folder through
`self-host catalog recipes --json`, then use `app shared setup`. Do not infer
first-run coverage from a catalog name or support tier. `guided` means the agent
can carry out a bounded setup with direct verification; missing recipes or
adapters remain pending. Neither means curl-only support. See
[app credential types and their limits](app-credentials.md). For an app not
in the catalog, the agent may offer an **experimental guided setup**: check
official install/API docs, inspect the host, present a plan and unknowns, get
exact apply approval, then try documented CLI/API steps before checked
agent-browser fallback. Unknown credentials, schema, ownership, or acceptance
remain blockers. A Homarr app tile is not proof of a supported integration or
working widget.

After successful media setup, the agent proves the generated board, calls the
Homarr board API to add/update one private Notebook explaining the installed
services, access methods, storage, backup status, and gaps, and reads it back.
The final recap provides **View dashboard** only with that board evidence and
states whether the URL is local, needs SSH forwarding, or uses a configured
private route. Shared projects use the separately reviewed `app shared
homarr-plan`, `homarr-apply`, and `homarr-status --live` routes to publish and
read back their recap and supported resources. A saved Notebook or successful
API response does not prove widget data, rendered content, or client access.
