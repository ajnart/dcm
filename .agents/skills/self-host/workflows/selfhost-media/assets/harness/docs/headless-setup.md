# Script-first setup

Run these commands from the installed project's `.selfhost/media-harness`
directory after `session.sh create`. The aggregate runner performs `up`;
for individual commands, run `session.sh up RUN_ID` first.
After the exact media plan has been approved and a session has been created,
`bun scripts/setup-media-run.ts run RUN_ID personal --approved` runs `up`, all
seven setup scripts and Homarr API/widget checks, then pauses at a read-only
Notebook plan. Review `scripts/session.sh homarr-notebook plan RUN_ID personal`
and resume with `--from homarr-notebook --notebook-approve DIGEST` using the
printed digest. The runner then applies the recap, checks MCP and verification,
and writes the private handoff. `bun scripts/setup-media-run.ts plan` only lists
stages and touches no session. A failed run names the stage and
its existing browser-takeover artifact, when applicable; repair that stage and
resume with `--from STAGE`. Unless `--no-handoff` was selected, a failed run
also attempts a partial owner-only credential handoff with keys available so
far; that file is access information, not acceptance. Its owner-only benchmark
record includes per-stage time and total wall time. A resumed record is not a
full-run timing result;
image-pull time remains unseparated, and no under-ten-minute claim is made
without a measured live run. The `--approved` flag records an approval already
given to the agent; it cannot replace approval of the exact plan.

For individual control, use the commands below.
The per-service `setup-*.ts` commands are the current API-first path. They enable
the private curl transport before making service requests; `curl` must be
installed and runnable. Missing curl produces a fixed prerequisite error and
stops setup without a direct-Fetch retry. Credentials stay in owner-only files
and private curl config/body files, not command arguments or terminal output.

Each loopback origin (scheme, host, and assigned port) gets its own mode-`0600`
cookie jar under `.sessions/RUN_ID/artifacts/http-cookies/`. The helper selects
and reuses that jar for requests to the same origin; a different service port
uses a different jar. It sends cookies with `--cookie` and stores response
cookies with `--cookie-jar`. No request follows redirects or sends credentials
to a non-loopback URL.
At the transport boundary the equivalent curl shape is
`curl --cookie JAR --cookie-jar JAR --config PRIVATE_CONFIG`;
the helper creates both paths with restrictive permissions, starts curl with
`--disable` so user-level curl configuration cannot alter requests, refuses
secret query parameters, and removes request bodies and config files afterward.

```bash
bun scripts/setup-qbittorrent.ts RUN_ID
bun scripts/setup-sonarr.ts RUN_ID
bun scripts/setup-radarr.ts RUN_ID
bun scripts/setup-prowlarr.ts RUN_ID
bun scripts/setup-jellyfin.ts RUN_ID
bun scripts/setup-seerr.ts RUN_ID
bun scripts/setup-homarr.ts RUN_ID personal
```

The first four commands are individually repeatable reconcilers; each Arr
retry refreshes only that service's API key. Run them in the order shown for
normal setup. `session.sh bootstrap RUN_ID` remains a separate combined
compatibility command. `session.sh bootstrap-jellyfin RUN_ID` and
`session.sh bootstrap-seerr RUN_ID` invoke the older direct-Fetch helpers; use
`setup-jellyfin.ts` and `setup-seerr.ts` for the current per-service curl-first
path. Those wrappers share configuration logic with the legacy helpers, but
transport selection and cookie handling differ. Keep per-service commands for
a failed or resumed service rather than restarting the whole project. Homarr
is a separate optional stage; omit its command when the selected plan does not
include Homarr. The managed media Compose recipe itself still includes the
Homarr container.

| Service | Setup calls (the script supplies credentials privately) | Proof |
| --- | --- | --- |
| qBittorrent | `POST /api/v2/auth/login`; `POST /api/v2/app/setPreferences`; `GET /api/v2/torrents/categories`; `POST /api/v2/torrents/createCategory` or `editCategory` | authenticated version, login, categories |
| Sonarr, Radarr | `GET /api/v3/config/host` then `PUT /api/v3/config/host/{id}` with its read ID; `GET/POST /api/v3/rootfolder`; `GET /api/v3/downloadclient/schema`; `GET/POST/PUT /api/v3/downloadclient`; `POST /api/v3/downloadclient/test` | matching root and enabled qBittorrent client |
| Prowlarr | `GET/PUT /api/v1/config/host`; `GET /api/v1/applications/schema`; `GET/POST/PUT /api/v1/applications`; `POST /api/v1/applications/test` | Full Sync records for Sonarr and Radarr |
| Jellyfin | `GET /System/Info/Public`; startup configuration/user/complete POSTs when fresh; `POST /Users/AuthenticateByName`; `GET/POST /Library/VirtualFolders`; `POST /Sessions/Logout` | Movies and Shows libraries plus admin login |
| Seerr | `GET /api/v1/settings/public`; `POST /api/v1/auth/jellyfin` when fresh; `POST /api/v1/settings/jellyfin/library/sync`, per-library `PUT /api/v1/settings/jellyfin/library/{libraryId}`, readback `GET`, and Sonarr/Radarr settings reads, tests, and writes; `POST /api/v1/settings/initialize` | Jellyfin libraries and exact Sonarr/Radarr links |
| Homarr | `POST /api/onboarding/claim`; tRPC `onboard.nextStep` and `user.initUser`; `GET /api/auth/csrf`, `POST /api/auth/callback/credentials`; one `onboard.completeSetup` with concurrent server-side validation; `apiKeys.create` | six integrations, generated app tiles/widgets, private API key |

The Homarr onboarding claim is valid before an admin exists. After `initUser`,
the script signs in as that admin before testing integrations or completing the
board. It never touches the Docker socket. A locked claim belongs to another
setup client; stop and inspect that client instead of bypassing the lock.
`completeSetup` receives all six internal Docker URLs and private credentials
from the run, so the test image generates the board in one transaction.
Then `homarr-finalize`, `mcp-config`, and `mcp-verify` operate on the private
Homarr API key. The board API proof checks six linked app tiles and their
host-facing navigation and Docker-side ping URLs as well as live widgets.
After proving the generated widgets, run `session.sh homarr-notebook plan RUN_ID
BOARD_NAME`, review its actions, and run `session.sh homarr-notebook apply RUN_ID
BOARD_NAME --approve DIGEST` to create or update the private stack recap and
read it back. A changed board requires a fresh digest.
The final handoff reports **View dashboard** only when this proof wrote
`board-access.json`; a local URL still needs an SSH tunnel from another device.
Do not install the generated client configuration without
separate approval.

Each `setup-*.ts` command uses the same failure runner. On failure it reports
the failed step or HTTP procedure, a bounded failure code, and the path to
`artifacts/setup-fallback-SERVICE.json`. That owner-only mode-`0600` file is
**secrets-full**: it contains the current run's usernames, generated password,
available API keys, URLs, existing per-origin curl cookie-jar paths, exact
failure detail, browser session and entry URL, and API resume/doctor commands.
It is a private takeover artifact, not a redacted benchmark report. The
terminal prints only its path and a safe stage summary. Read it only for this
run, use the available credentials or cookie jar through the existing private
browser helpers, inspect the failed service in `agent-browser`, and rerun only
that service's script and verification. Do not create another run or repeat
already working services. XDG runtime tuning is relevant only if the browser
fallback itself cannot start; the normal script path does not use Chromium.

When multiple agent-browser versions are installed, keep the password helper on
the exact executable used to open the run-scoped session:
`scripts/session.sh browser-password RUN_ID @eN --browser-bin /absolute/path/to/agent-browser`.
The optional trailing pair accepts an absolute executable-file path and resolves
symlinks to its canonical target. It bypasses PATH/version-manager selection
for every helper action and never falls back to `bunx` if that executable fails.
Without the option, existing PATH selection and missing-command fallback remain unchanged.

If one script fails, use its takeover artifact and `session.sh doctor RUN_ID`
with the service-specific guide. Open only that service in `agent-browser`;
keep the browser session run-scoped and never capture raw authenticated traffic.
Treat API success as a configuration check, not visual proof of the Homarr
board. Use `session.sh verify` and
`bun scripts/prove-homarr-widgets-api.ts RUN_ID personal`; capture a browser
screenshot only for requested visual evidence. A screenshot cannot override
a failed API widget proof. Do not choose an
indexer or initiate a media request/download without the user's choice.

Implementation: [`curl-http.ts`](../scripts/lib/curl-http.ts), the shared
[`setup-handoff.ts`](../scripts/lib/setup-handoff.ts), individual
[`setup-*.ts`](../scripts/setup-qbittorrent.ts) commands, and the canonical
[`PROMPT.md`](../PROMPT.md). Sources: [curl cookies](https://curl.se/docs/http-cookies.html),
[Seerr API](https://docs.seerr.dev/api/seerr-api/),
[Homarr API](https://homarr.dev/docs/management/api/).
