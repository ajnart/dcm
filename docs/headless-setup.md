# Script-first setup

Run these commands from the installed project's `.selfhost/media-harness`
directory after `session.sh create`, `up`, and `bootstrap`.
They keep credentials in owner-only files and send them in private curl config/body
files, not command arguments or terminal output. Each localhost service gets its
own mode-`0600` cookie jar under `.sessions/RUN_ID/artifacts/http-cookies/`.
The jar is reused across a login and subsequent requests to that service only.
No request follows redirects or sends credentials to a non-loopback URL.
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
retry refreshes only that service's API key. The existing
`session.sh bootstrap RUN_ID` is their combined supported baseline. Keep the
individual commands for a failed or resumed service rather than restarting the
whole project. The Jellyfin and Seerr scripts use the same API configuration as
the existing bootstrap helpers. Homarr is a separate optional stage; omit its
command when the selected plan does not include Homarr. The managed media
Compose recipe itself still includes the Homarr container.

| Service | Setup calls (the script supplies credentials privately) | Proof |
| --- | --- | --- |
| qBittorrent | `POST /api/v2/auth/login`; `POST /api/v2/app/setPreferences`; `GET /api/v2/torrents/categories`; `POST /api/v2/torrents/createCategory` or `editCategory` | authenticated version, login, categories |
| Sonarr, Radarr | `GET/PUT /api/v3/config/host`; `GET/POST /api/v3/rootfolder`; `GET /api/v3/downloadclient/schema`; `GET/POST/PUT /api/v3/downloadclient`; `POST /api/v3/downloadclient/test` | matching root and enabled qBittorrent client |
| Prowlarr | `GET/PUT /api/v1/config/host`; `GET /api/v1/applications/schema`; `GET/POST/PUT /api/v1/applications`; `POST /api/v1/applications/test` | Full Sync records for Sonarr and Radarr |
| Jellyfin | `GET /System/Info/Public`; startup configuration/user/complete POSTs when fresh; `POST /Users/AuthenticateByName`; `GET/POST /Library/VirtualFolders`; `POST /Sessions/Logout` | Movies and Shows libraries plus admin login |
| Seerr | `GET /api/v1/settings/public`; `POST /api/v1/auth/jellyfin` when fresh; Jellyfin-library and Sonarr/Radarr settings reads, tests, and writes; `POST /api/v1/settings/initialize` | Jellyfin libraries and exact Sonarr/Radarr links |
| Homarr | `POST /api/onboarding/claim`; tRPC `onboard.nextStep` and `user.initUser`; `GET /api/auth/csrf`, `POST /api/auth/callback/credentials`; six `onboard.testIntegration`; `onboard.completeSetup`; `apiKeys.create` | six integrations, generated app tiles/widgets, private API key |

The Homarr onboarding claim is valid before an admin exists. After `initUser`,
the script signs in as that admin before testing integrations or completing the
board. It never touches the Docker socket. A locked claim belongs to another
setup client; stop and inspect that client instead of bypassing the lock.
`completeSetup` receives all six internal Docker URLs and private credentials
from the run, so the test image generates the board in one transaction.
Then `homarr-finalize`, `mcp-config`, and `mcp-verify` operate on the private
Homarr API key. The board API proof checks six linked app tiles and their
host-facing navigation and Docker-side ping URLs as well as live widgets.
Do not install the generated client configuration without
separate approval.

If one script fails, use `session.sh doctor RUN_ID` and its service-specific
guide. Open that service in `agent-browser` only as a targeted fallback; keep
the browser session run-scoped and never capture raw authenticated traffic.
Treat API success as a configuration check, not visual proof of the Homarr
board. Use `session.sh verify` and
`bun scripts/prove-homarr-widgets-api.ts RUN_ID personal`; capture a browser
screenshot only for requested visual evidence. A screenshot cannot override
a failed API widget proof. Do not choose an
indexer or initiate a media request/download without the user's choice.

Implementation: [`curl-http.ts`](../scripts/lib/curl-http.ts), individual
[`setup-*.ts`](../scripts/setup-qbittorrent.ts) commands, and the canonical
[`PROMPT.md`](../PROMPT.md). Sources: [curl cookies](https://curl.se/docs/http-cookies.html),
[Seerr API](https://docs.seerr.dev/api/seerr-api/),
[Homarr API](https://homarr.dev/docs/management/api/).
