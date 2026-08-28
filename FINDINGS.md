# Auto-Stack Setup Findings

This document captures the complete setup process for the auto-stack Docker Compose application.

## Architecture

```
Prowlarr (indexer manager) --> Sonarr (TV shows) --> qBittorrent (downloads)
                            --> Radarr (movies)  --> qBittorrent (downloads)
Homarr (dashboard) --> all services via integrations
```

## Service Map

| Service     | Port | Auth Required | Default Credentials          |
|-------------|------|---------------|------------------------------|
| Prowlarr    | 9696 | Yes (Forms)   | admin / [REDACTED LEGACY TEST PASSWORD]           |
| Radarr      | 7878 | Yes (Forms)   | admin / [REDACTED LEGACY TEST PASSWORD]           |
| Sonarr      | 8989 | Yes (Forms)   | admin / [REDACTED LEGACY TEST PASSWORD]           |
| qBittorrent | 8088 | Yes           | admin / [REDACTED LEGACY TEST PASSWORD]           |
| Jellyfin    | 8096 | Yes           | admin / [REDACTED LEGACY TEST PASSWORD]           |
| Homarr      | 7578 | Yes           | First-time admin creation    |

## Key Findings

1. **Hotio arr images (Sonarr/Radarr/Prowlarr)**: **Now enforce authentication by default.** Recent (2025+) versions of hotio's arr images show a forced authentication setup modal on first access. You must set up Forms auth with credentials before using the dashboard. API keys also act as auth tokens.
2. **qBittorrent (hotio)**: Generates a random temporary password on first start. Displayed in container logs. The temp password rotates on every container recreate. If the host port 8080 is already taken (here by `traefik`), the port mapping silently fails to bind — you must pick a free host port AND set `WEBUI_PORT`/`WEBUI_PORTS` to match so qBittorrent's Host-header validation accepts requests.
3. **Homarr**: Generates a SECRET_ENCRYPTION_KEY but still requires creating first admin user via web UI.
4. **Jellyfin (hotio)**: First-time wizard requires setting up admin credentials and media library.
5. **Docker networking**: Services communicate over the internal Docker network (`auto-stack_default`). Use container names as hostnames.

### Homarr (port 7578)

- **Admin user**: `admin` / `[REDACTED LEGACY TEST PASSWORD]` (created via first-time wizard at `/init`).
- **Board**: name `Auto-Stack-Dashboard`, display title "Auto-Stack Dashboard". URL: `http://localhost:7578/boards/Auto-Stack-Dashboard` (also the home lander at `/`).
- **Setup flow**: open `http://localhost:7578` -> redirected to `/init` -> "Start from scratch" -> fill Username/Password/Confirm password -> "Create user" -> "Continue" (Settings) -> **Integrations step** (NOT skipped) -> click Sonarr card -> "Continue" -> fill Sonarr URL/API Key -> "Test connection and create" -> "Go to dashboard board" (Finish) -> skip the onboarding tour -> add remaining 4 integrations via Management -> Integrations (Radarr, Prowlarr, qBittorrent, Jellyfin).
- **Board rename**: via Management -> Boards -> Settings -> "Change name". **Homarr's board name schema rejects spaces** (`regex /^[A-Za-z0-9-_]*$/`, found in the bundle as `boardNameSchema`), so "Auto-Stack Dashboard" would fail validation. Used `Auto-Stack-Dashboard` for the name and set `pageTitle` = "Auto-Stack Dashboard" (spaces allowed) in the board's General settings, then "Save changes".
- **Onboarding state**: persisted to the `onboarding` table (step `finish`); first run sets `user`, `board`, `serverSetting`, etc. in SQLite at `config/homarr/db/db.sqlite`.
- **Known quirk**: Homarr dialogs/menus are Mantine overlays; clicks on "AD"/"Management"/"Settings" can be reported as covered. Re-snapshot after opening the menu and click the freshly listed menuitem ref.
- **Reference**: full step-by-step auto-flow in `homarr.md`, screenshots in `homarr-setup/`.
- **Apps on board**: After creating integrations/apps, they must be manually placed on the board via edit mode (gear icon → gear → "Add an app" → select each app). Apps are placed but may only be visible in edit mode if the board layout has limited rows — scrolling or creating a dedicated Services category can resolve this.

## Service Setup Details

### Jellyfin

**Setup method**: agent-browser browser automation via Chrome/Chromium CDP

**URL**: http://localhost:8096

**Credentials**: `admin` / `[REDACTED LEGACY TEST PASSWORD]`

**Wizard flow** (6 steps):
1. **Welcome** — language (English default), server name (auto-filled hostname), click Next
2. **Admin account** — fill username/password/confirm, click Next
3. **Media libraries** — skip (no media mounted), click Next
4. **Metadata language** — accept English/United States defaults, click Next
5. **Remote access** — accept default (allow remote connections checked), click Next
6. **Finish** — click Finish, then sign in with admin credentials

**Container env**: hotio/jellyfin image. Chrome required `--no-sandbox` flag for container execution.

**Full automation guide**: `jellyfin.md`

### Sonarr

**Setup method**: agent-browser browser automation via Chrome/Chromium CDP

**URL**: http://localhost:8989

**Credentials**: `admin` / `[REDACTED LEGACY TEST PASSWORD]`

**Auth method**: Forms (Login Page)

**API Key**: `<REDACTED_API_KEY>`

**Forced auth flow**:
1. Navigate to http://localhost:8989 — forced auth setup modal appears
2. Click the "None" dropdown toggle to open authentication method options
3. Select "Forms (Login Page)" from the dropdown
4. Fill in Username: `admin`, Password: `[REDACTED LEGACY TEST PASSWORD]`, Confirm Password: `[REDACTED LEGACY TEST PASSWORD]`
5. Click Save — modal closes, dashboard loads
6. Navigate to Settings → General to view auth settings and API key
7. API key is visible in a textbox on the General settings page

**Dropdown options**: `None`, `Basic (Browser Popup)`, `Forms (Login Page)`

**Container env**: ghcr.io/hotio/sonarr:latest. No auth env vars set in docker-compose.
Available env vars: `SONARR__AUTH_METHOD`, `SONARR__AUTH_REQUIRED`, `SONARR__API_KEY`

**Full automation guide**: `sonarr.md`

### Radarr

**Setup method**: agent-browser browser automation via Chrome/Chromium CDP

**URL**: http://localhost:7878

**Credentials**: `admin` / `[REDACTED LEGACY TEST PASSWORD]`

**Auth method**: Forms (Login Page)

**API Key**: `<REDACTED_API_KEY>`

**Forced auth flow**:
1. Navigate to http://localhost:7878 — forced auth setup modal appears
2. Click the "None" dropdown toggle to open authentication method options
3. Select "Forms (Login Page)" from the dropdown
4. Fill in Username: `admin`, Password: `[REDACTED LEGACY TEST PASSWORD]`, Confirm Password: `[REDACTED LEGACY TEST PASSWORD]`
5. Click Save — modal closes, dashboard loads
6. Navigate to Settings → General to view auth settings and API key
7. API key is visible in a textbox on the General settings page

**Dropdown options**: `None`, `Forms (Login Page)`

**Container env**: ghcr.io/hotio/radarr:latest. No auth env vars set in docker-compose.
Available env vars: `RADARR__AUTH_METHOD`, `RADARR__AUTH_REQUIRED`, `RADARR__API_KEY`

**Full automation guide**: `radarr.md`

### Prowlarr

**Setup method**: agent-browser browser automation via Chrome/Chromium CDP

**URL**: http://localhost:9696

**Credentials**: `admin` / `[REDACTED LEGACY TEST PASSWORD]`

**Auth method**: Forms (Login Page)

**API Key**: `<REDACTED_API_KEY>`

**Forced auth flow**:
1. Navigate to http://localhost:9696 — forced auth setup modal appears
2. Click the "None" dropdown toggle to open authentication method options
3. Select "Forms (Login Page)" from the dropdown
4. Fill in Username: `admin`, Password: `[REDACTED LEGACY TEST PASSWORD]`, Confirm Password: `[REDACTED LEGACY TEST PASSWORD]`
5. Click Save — modal closes, dashboard loads
6. Navigate to Settings → General to view auth settings and API key
7. API key is visible in a textbox on the General settings page

**Dropdown options**: `None`, `Forms (Login Page)`

**Container env**: ghcr.io/hotio/prowlarr:latest. No auth env vars set in docker-compose.
Available env vars: `PROWLARR__AUTH_METHOD`, `PROWLARR__AUTH_REQUIRED`, `PROWLARR__API_KEY`

**Full automation guide**: `prowlarr.md`

## Service Connections

### Homarr Integrations

Homarr was configured with 5 service integrations via the Integrations management page (`/manage/integrations`). Each integration uses the Docker internal URL (container hostname).

| Service     | Integration Type | URL (Docker)          | Auth Method            | Credentials / API Key                              |
|-------------|------------------|-----------------------|------------------------|----------------------------------------------------|
| Sonarr      | Sonarr           | http://sonarr:8989    | API Key                | `<REDACTED_API_KEY>`                 |
| Radarr      | Radarr           | http://radarr:7878    | API Key                | `<REDACTED_API_KEY>`                 |
| Prowlarr    | Prowlarr         | http://prowlarr:9696  | API Key                | `<REDACTED_API_KEY>`                 |
| qBittorrent | qBittorrent      | http://qbittorrent:8088| Username & Password    | `admin` / `[REDACTED LEGACY TEST PASSWORD]`                            |
| Jellyfin    | Jellyfin         | http://jellyfin:8096  | Username & Password    | `admin` / `[REDACTED LEGACY TEST PASSWORD]`                            |

**Integration creation flow**:
1. Navigate to Management -> Integrations -> "New integration"
2. Search or scroll to find the service card, click it
3. Fill the form: Name (pre-filled), URL (Docker internal hostname), API key or credentials
4. Ensure "Create app" is checked (default) to auto-create an app record
5. Fill "App url" with the same Docker internal URL
6. Click "Test connection and create"

**Apps placement**: After creating integrations, apps must be added to the board via the + menu:
- Enter edit mode (gear icon on dashboard)
- Click gear again to open the add menu
- Select "Add an app" -> pick the service app from the list
- Repeat for each service

**All 5 integrations were verified** in the Integrations management page showing `qBittorrent 1`, `Sonarr 1`, `Radarr 1`, `Prowlarr 1`, `Jellyfin 1`.
The corresponding apps were created and placed on the Auto-Stack-Dashboard board.

**Onboarding note**: The onboarding integrations wizard only allows configuring one integration at a time. After configuring the first integration (Sonarr in this case), Homarr advances to the Finish step. The remaining 4 integrations were added post-onboarding via Management → Integrations → "New integration".

**Full automation guide**: `homarr.md` (section "Adding Service Integrations")

### qBittorrent

**Setup method**: agent-browser browser automation via Chrome/Chromium CDP

**URL**: http://localhost:8088 (host port; container listens on 8088)

**Credentials**: `admin` / `[REDACTED LEGACY TEST PASSWORD]`

**Auth method**: Web UI login form (qBittorrent built-in WebUI)

**Login flow**:
1. Open http://localhost:8088 — qBittorrent WebUI login page loads (`Username`, `Password`,
   `Login` button)
2. Fill Username: `admin`, Password: `<temporary-password from docker logs>`, click Login
3. Main Transfers dashboard loads

**Password change flow**:
1. Tools menu → **Options...** → click **WebUI** tab in the options sidebar
2. WebUI form shows `Username: admin` and an empty `Password:` field
3. Fill `Password: [REDACTED LEGACY TEST PASSWORD]`, click **Save** — dialog closes, config persisted
4. Old temp password now returns 401; new password returns 204 and works via API

**Container env**: ghcr.io/hotio/qbittorrent:latest (hotio). First start prints a random temp
password to container logs; it rotates on every recreate. No auth env relationship — password
must be set through the WebUI.

**Port collision finding**: A host-side `traefik` process owns `0.0.0.0:8080`, so the compose
`8080:8080` mapping fails (`bind: address already in use`), and the qBittorrent container silently
runs with no published ports. To fix, compose was updated to:
- `WEBUI_PORT=8088` + `WEBUI_PORTS=8088/tcp` (container listens on 8088)
- `ports: 8088:8088` (and keep 6881 tcp/udp)

Matching the Host-header port to the container's listening port matters: if the host port differs
from the container WebUI port, qBittorrent's Host-header validation rejects requests with `401`
before the login page is served.

**Screenshots**: `qbit-settings-saved.png` (options saved), `qbit-final.png` (final state)

**Full automation guide**: `qbittorrent.md`

## Service Connections

### Prowlarr → Sonarr + Radarr (Configured)

Prowlarr was configured with indexer management and app sync via its API (browser UI posed challenges with modal backdrops for some operations).

**Indexer**: **1337x** (Cardigann, public torrent, id=2)
- Protocol: torrent, Privacy: public
- Status: created but disabled (Cloudflare-protected — requires FlareSolverr to function)
- API creation payload: `POST /api/v1/indexer` with fields `baseUrl: https://1337x.to/`, `definitionFile: 1337x`, `appProfileId: 1`

**Apps configured**:

| App    | Docker URL              | API Key                                 | Sync Level |
|--------|------------------------|-----------------------------------------|------------|
| Sonarr | http://sonarr:8989      | <REDACTED_API_KEY>        | Full Sync  |
| Radarr | http://radarr:7878      | <REDACTED_API_KEY>        | Full Sync  |

- Both apps were created via `POST /api/v1/applications` with `syncLevel: fullSync`
- Prowlarr communicates over the Docker internal network using container names
- App tests (POST /api/v1/applications/test/1 and test/2) passed successfully
- **Note**: The UI "Add Indexer" modal couldn't be submitted due to modal backdrop interaction issues with agent-browser. API-based creation was used as a workaround.

**Screenshots**: `prowlarr-indexer-added.png`, `prowlarr-apps-configured.png`, `prowlarr-indexer-synced.png`

### Sonarr → qBittorrent (Configured)

Sonarr was configured with qBittorrent as its download client via agent-browser browser automation.

| Property   | Value                            |
|------------|----------------------------------|
| Client     | qBittorrent                      |
| Host       | qbittorrent (Docker hostname)    |
| Port       | 8088                             |
| Username   | admin                            |
| Password   | [REDACTED LEGACY TEST PASSWORD]                       |
| Category   | tv-sonarr                        |

**Configuration flow**:
1. Navigate to Settings → Download Clients in Sonarr
2. Click the Add button, select qBittorrent
3. Override Host (`localhost` → `qbittorrent`), Port (`8080` → `8088`)
4. Fill Username (`admin`) and Password (`[REDACTED LEGACY TEST PASSWORD]`)
5. Verify Category is `tv-sonarr` (pre-filled)
6. Test connection — `qBittorrent authentication succeeded` logged
7. Save — qBittorrent appears in the download clients list
8. **Screenshot**: `sonarr-download-client-configured.png`

### Radarr → qBittorrent (Configured)

Radarr was configured with qBittorrent as its download client via agent-browser browser automation.

| Property   | Value                            |
|------------|----------------------------------|
| Client     | qBittorrent                      |
| Host       | qbittorrent (Docker hostname)    |
| Port       | 8088                             |
| Username   | admin                            |
| Password   | [REDACTED LEGACY TEST PASSWORD]                       |
| Category   | movies-radarr                    |

**Configuration flow**:
1. Navigate to Settings → Download Clients in Radarr
2. Click the Add button, select qBittorrent
3. Override Host (`localhost` → `qbittorrent`), Port (`8080` → `8088`)
4. Fill Username (`admin`) and Password (`[REDACTED LEGACY TEST PASSWORD]`)
5. Override Category (`radarr` → `movies-radarr`)
6. Test connection — `qBittorrent authentication succeeded` logged
7. Save — qBittorrent appears in the download clients list
8. **Screenshot**: `radarr-download-client-configured.png`

### Connection Notes

- **Docker networking**: Both Sonarr and Radarr connect to qBittorrent using the Docker internal hostname `qbittorrent` on port `8088`
- **Port 8080 vs 8088**: qBittorrent's default WebUI port is 8080, but this stack configures it to 8088 via `WEBUI_PORT` env var (to avoid host port conflicts). Even though the form pre-fills port 8080, it must be changed to 8088
- **API Key field**: Sonarr/Radarr v4 have an "API Key" field for qBittorrent connections. Leave it blank — qBittorrent uses username/password authentication
- **Categories**: Each service uses a distinct category (`tv-sonarr` for Sonarr, `movies-radarr` for Radarr) to avoid download conflicts. The forms pre-fill generic categories (`tv-sonarr`, `radarr`) — override Radarr's to `movies-radarr`
- **Test failure debug**: If "Unable to connect to qBittorrent", check:
  - The port field (likely still `8080` instead of `8088`)
  - Sonarr/Radarr debug logs at `/config/logs/*.debug.txt` inside the container
  - That qBittorrent is running and accessible: `docker exec <arr-container> curl -s http://qbittorrent:8088`
- **Authentication**: qBittorrent WebUI accepts login via POST `/api/v2/auth/login` with `username` and `password` form params; returns a QBT_SID cookie used for subsequent API calls
