# Sonarr Browser Automation Guide

## Service Info

| Property     | Value                                |
|-------------|--------------------------------------|
| URL         | http://localhost:8989                |
| Image       | ghcr.io/hotio/sonarr:latest          |
| Auth Method | Forms (Login Page)                   |
| Username    | admin                                |
| Password    | Password1!                           |
| API Key     | be664b980ad8498cae386c62bee0aacb     |
| Port        | 8989                                 |

## Env Variables (docker-compose)

No auth-related env variables set in this stack. Known available env vars:

- `SONARR__AUTH_METHOD` = `None` | `Basic` | `Forms`
- `SONARR__AUTH_REQUIRED` = `Enabled` | `DisabledForLocalAddresses`
- `SONARR__API_KEY` = override the API key

## Automation Steps (agent-browser)

### Prerequisites

```bash
npm i -g agent-browser && agent-browser install --with-deps
export AGENT_BROWSER_ARGS="--no-sandbox"
```

### 1. Open Sonarr

```bash
agent-browser --args "--no-sandbox" open http://localhost:8989
agent-browser --args "--no-sandbox" wait --load networkidle
```

### 2. Handle forced auth modal

The modal has:
- A dropdown for authentication method (currently showing "None")
- Username, Password, Confirm Password fields
- Save button

```bash
# Click the "None" dropdown to open it
agent-browser --args "--no-sandbox" click @e35
agent-browser --args "--no-sandbox" snapshot -i -c

# Click "Forms (Login Page)" from the dropdown
agent-browser --args "--no-sandbox" click @e10

# Fill in credentials
agent-browser --args "--no-sandbox" fill @e28 "admin"
agent-browser --args "--no-sandbox" fill @e29 "Password1!"
agent-browser --args "--no-sandbox" fill @e30 "Password1!"

# Click Save
agent-browser --args "--no-sandbox" click @e24
agent-browser --args "--no-sandbox" wait --load networkidle
```

**Note**: The `@eN` refs are assigned fresh on every snapshot. After clicking the dropdown toggle, the menu items appear as generics with `[onclick]`. The password fields shift numbers depending on dropdown state.

### 3. Navigate to Settings -> General

```bash
agent-browser --args "--no-sandbox" click @e19   # Settings
agent-browser --args "--no-sandbox" wait --load networkidle
agent-browser --args "--no-sandbox" click @e26   # General
agent-browser --args "--no-sandbox" wait --load networkidle
```

### 4. View API Key and Auth Settings

The General settings page shows:
- **Port**: textbox with value `8989`
- **Authentication Method**: dropdown showing `Forms (Login Page)`
- **Authentication Requirement**: button showing `Enabled`
- **Username**: text `admin`
- **Password**: masked field
- **API Key**: visible textbox (e.g., `be664b980ad8498cae386c62bee0aacb`)

To see advanced settings, click "Show Advanced":

```bash
agent-browser --args "--no-sandbox" click @e8   # Show Advanced / Hide Advanced
```

### 5. Screenshot Settings

```bash
agent-browser --args "--no-sandbox" screenshot sonarr-settings-general.png
```

### 6. Close

```bash
agent-browser --args "--no-sandbox" close --all
```

## Expected Snapshot States

### Initial forced auth modal (dropdown closed)

```
[...]
- button "None" [ref=e31]
- link "More Info" [ref=e27]
- button "Enabled" [ref=e32]
- textbox [ref=e28]
- textbox [ref=e29]
- textbox [ref=e30]
- button "Save" [disabled, ref=e24]
```

### Dropdown open

```
[...]
- generic "None" [ref=e8] clickable [onclick]
- generic "Forms (Login Page)" [ref=e9] clickable [onclick]
- generic "Basic (Browser Popup)" [ref=e10] clickable [onclick]
```

### After selecting Forms (dropdown closed, Save enabled)

```
[...]
- button "Forms (Login Page)" [ref=e31]
- button "Enabled" [ref=e32]
- textbox [ref=e28]
- textbox [ref=e29]
- textbox [ref=e30]
- button "Save" [ref=e24]     # note: no [disabled]
```

### Dashboard (after auth configured)

No modal — just the sidebar with Series, Calendar, Activity, Wanted, Settings, System.

### 7. Connecting qBittorrent Download Client

Navigate to Settings → Download Clients and add qBittorrent:

```bash
# 1. Set session (if not already)
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix arr-download-client)"

# 2. Open Sonarr and log in
agent-browser --args "--no-sandbox" open http://localhost:8989
agent-browser --args "--no-sandbox" wait --load networkidle
agent-browser --args "--no-sandbox" fill @e4 "admin"
agent-browser --args "--no-sandbox" fill @e5 "Password1!"
agent-browser --args "--no-sandbox" click @e3
agent-browser --args "--no-sandbox" wait --load networkidle

# 3. Navigate to Settings → Download Clients
agent-browser --args "--no-sandbox" click @e19   # Settings
agent-browser --args "--no-sandbox" wait --load networkidle
agent-browser --args "--no-sandbox" click @e20   # Download Clients
agent-browser --args "--no-sandbox" wait --load networkidle

# 4. Click the Add Download Client button (unnamed button, last in toolbar)
agent-browser --args "--no-sandbox" click @e31

# 5. Select qBittorrent from the list (use JS to find and click it)
agent-browser --args "--no-sandbox" eval \
  "Array.from(document.querySelectorAll('[class*=AddDownloadClientItem]'))"\
  ".filter(el => el.textContent.includes('qBittorrent'))"\
  ".forEach(el => { const btn = el.tagName === 'BUTTON' ? el : el.querySelector('button'); if(btn) btn.click(); })"
agent-browser --args "--no-sandbox" wait 2000

# 6. Fill in the connection form
# Note: @eN refs change after the form loads; re-snapshot to see refs
agent-browser --args "--no-sandbox" click @e40   # Host field (pre-filled "localhost")
agent-browser --args "--no-sandbox" press Control+a
agent-browser --args "--no-sandbox" press Delete
agent-browser --args "--no-sandbox" fill @e40 "qbittorrent"
agent-browser --args "--no-sandbox" click @e41   # Port field (pre-filled "8080")
agent-browser --args "--no-sandbox" press Control+a
agent-browser --args "--no-sandbox" press Delete
agent-browser --args "--no-sandbox" fill @e41 "8088"
agent-browser --args "--no-sandbox" fill @e43 "admin"                     # Username
agent-browser --args "--no-sandbox" fill @e44 "Password1!"               # Password
# Category @e45 is pre-filled with "tv-sonarr" — verify or set:
agent-browser --args "--no-sandbox" fill @e45 "tv-sonarr"

# 7. Test connection
agent-browser --args "--no-sandbox" click @e33   # Test button
agent-browser --args "--no-sandbox" wait 5000
# Check logs: docker exec <sonarr-container> tail /config/logs/sonarr.debug.txt

# 8. Save
agent-browser --args "--no-sandbox" click @e35   # Save button
agent-browser --args "--no-sandbox" wait 3000

# 9. Screenshot
agent-browser --args "--no-sandbox" screenshot sonarr-download-client-configured.png
```

**Key details**:
- **Host**: Use Docker internal hostname `qbittorrent` (not `localhost`)
- **Port**: `8088` (qBittorrent WebUI port configured via `WEBUI_PORT`)
- **Category**: `tv-sonarr` — Sonarr-specific category to avoid conflicts
- **API Key field**: Optional; leave blank for qBittorrent
- The form pre-fills Name (`qBittorrent`), Host (`localhost`), Port (`8080`), and Category (`tv-sonarr`) by default. Override Host and Port.
- Successful test shows `qBittorrent authentication succeeded` in Sonarr debug logs