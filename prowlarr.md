# Prowlarr Browser Automation Guide

## Service Info

| Property     | Value                                |
|-------------|--------------------------------------|
| URL         | http://localhost:9696                |
| Image       | ghcr.io/hotio/prowlarr:latest        |
| Auth Method | Forms (Login Page)                   |
| Username    | admin                                |
| Password    | [REDACTED LEGACY TEST PASSWORD]                           |
| API Key     | <REDACTED_API_KEY>     |
| Port        | 9696                                 |

## Env Variables (docker-compose)

No auth-related env variables set in this stack. Known available env vars:

- `PROWLARR__AUTH_METHOD` = `None` | `Basic` | `Forms`
- `PROWLARR__AUTH_REQUIRED` = `Enabled` | `DisabledForLocalAddresses`
- `PROWLARR__API_KEY` = override the API key

## Automation Steps (agent-browser)

### Prerequisites

```bash
npm i -g agent-browser && agent-browser install --with-deps
export AGENT_BROWSER_ARGS="--no-sandbox"
```

### 1. Open Prowlarr

```bash
agent-browser --args "--no-sandbox" open http://localhost:9696
agent-browser --args "--no-sandbox" wait --load networkidle
```

### 2. Handle forced auth modal

The modal has:
- A dropdown for authentication method (currently showing "None")
- Username, Password, Confirm Password fields
- Save button

```bash
# Click the "None" dropdown to open it
agent-browser --args "--no-sandbox" click @e27
agent-browser --args "--no-sandbox" snapshot -i -c

# Click "Forms (Login Page)" from the dropdown
agent-browser --args "--no-sandbox" click @e9

# Fill in credentials
agent-browser --args "--no-sandbox" fill @e24 "admin"
agent-browser --args "--no-sandbox" fill @e25 "[REDACTED LEGACY TEST PASSWORD]"
agent-browser --args "--no-sandbox" fill @e26 "[REDACTED LEGACY TEST PASSWORD]"

# Click Save
agent-browser --args "--no-sandbox" click @e21
agent-browser --args "--no-sandbox" wait --load networkidle
```

**Note**: The `@eN` refs are assigned fresh on every snapshot. After clicking the dropdown toggle, the menu items appear as generics with `[onclick]`. Always re-snapshot after each interaction to get fresh refs.

### 3. Navigate to Settings -> General

```bash
agent-browser --args "--no-sandbox" click @e17   # Settings
agent-browser --args "--no-sandbox" wait --load networkidle
agent-browser --args "--no-sandbox" click @e19   # General
agent-browser --args "--no-sandbox" wait --load networkidle
```

### 4. View API Key and Auth Settings

The General settings page shows:
- **Port**: textbox with value `9696`
- **Authentication Method**: dropdown showing `Forms (Login Page)`
- **Authentication Requirement**: button showing `Enabled`
- **Username**: text `admin`
- **Password**: masked field
- **API Key**: visible textbox (e.g., `<REDACTED_API_KEY>`)

To see advanced settings, click "Show Advanced":

```bash
agent-browser --args "--no-sandbox" click @e8   # Show Advanced / Hide Advanced
```

### 5. Screenshot Settings

```bash
agent-browser --args "--no-sandbox" screenshot prowlarr-settings-general.png
```

### 6. Close

```bash
agent-browser --args "--no-sandbox" close --all
```

## Expected Snapshot States

### Initial forced auth modal (dropdown closed)

```
[...]
- button "None" [ref=e27]
- link "More Info" [ref=e23]
- button "Enabled" [ref=e28]
- textbox [ref=e24]
- textbox [ref=e25]
- textbox [ref=e26]
- button "Save" [disabled, ref=e21]
```

### Dropdown open

```
[...]
- generic "None" [ref=e8] clickable [onclick]
- generic "Forms (Login Page)" [ref=e9] clickable [onclick]
```

### After selecting Forms (Save enabled)

```
[...]
- button "Forms (Login Page)" [ref=e27]
- button "Enabled" [ref=e28]
- textbox [ref=e24]
- textbox [ref=e25]
- textbox [ref=e26]
- button "Save" [ref=e21]     # note: no [disabled]
```

### Dashboard (after auth configured)

No modal — just the sidebar with Indexers, Stats, Search, History, Settings, System.

## 7. Add a Test Indexer

The "Add Indexer" UI is a searchable modal. agent-browser had difficulty clicking Save/Cancel through the modal backdrop. The Prowlarr API is more reliable for indexer creation.

### Via API (recommended)

```bash
# List available indexer schemas
curl -s http://localhost:9696/api/v1/indexer/schema \
  -H "X-Api-Key: <REDACTED_API_KEY>" | python3 -c "
import json,sys
for item in json.load(sys.stdin):
    print(item['implementationName'], '|', item['definitionName'], '|', item['protocol'], '|', item['privacy'])
"

# Create a public Cardigann indexer (e.g., 1337x)
curl -s -X POST http://localhost:9696/api/v1/indexer \
  -H "X-Api-Key: <REDACTED_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "1337x",
    "implementationName": "Cardigann",
    "implementation": "Cardigann",
    "configContract": "CardigannSettings",
    "definitionName": "1337x",
    "protocol": "torrent",
    "priority": 25,
    "appProfileId": 1,
    "fields": [
      {"name": "baseUrl", "value": "https://1337x.to/"},
      {"name": "definitionFile", "value": "1337x"}
    ]
  }' | python3 -m json.tool

# Verify indexer was created
curl -s http://localhost:9696/api/v1/indexer \
  -H "X-Api-Key: <REDACTED_API_KEY>" | python3 -m json.tool
```

### Via Browser (agent-browser)

```bash
SESSION="$(agent-browser session id --scope worktree --prefix prowlarr-setup)"

# Navigate to Indexers and click Add Indexer
agent-browser --session "$SESSION" --args "--no-sandbox" click @e8
agent-browser --session "$SESSION" --args "--no-sandbox" wait --load networkidle

# Search for an indexer (e.g. 1337x)
agent-browser --session "$SESSION" --args "--no-sandbox" fill @e23 "1337x"
agent-browser --session "$SESSION" --args "--no-sandbox" wait 1000

# Click the result row to open config
agent-browser --session "$SESSION" --args "--no-sandbox" click @e29
agent-browser --session "$SESSION" --args "--no-sandbox" wait --load networkidle

# Click Save
agent-browser --session "$SESSION" --args "--no-sandbox" click @e26
agent-browser --session "$SESSION" --args "--no-sandbox" wait --load networkidle

# Close the modal and return to Indexers view
agent-browser --session "$SESSION" --args "--no-sandbox" click @e25
agent-browser --session "$SESSION" --args "--no-sandbox" click @e13
```

**Note**: `@eN` refs change per session. Always re-snapshot before interacting. The modal backdrop sometimes covers sidebar links — use `Close` or `Cancel` buttons first.

## 8. Connect Sonarr and Radarr (Settings → Apps)

### Via API (recommended)

```bash
# Add Sonarr
curl -s -X POST http://localhost:9696/api/v1/applications \
  -H "X-Api-Key: <REDACTED_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sonarr",
    "implementationName": "Sonarr",
    "implementation": "Sonarr",
    "configContract": "SonarrSettings",
    "syncLevel": "fullSync",
    "fields": [
      {"name": "prowlarrUrl", "value": "http://prowlarr:9696"},
      {"name": "baseUrl", "value": "http://sonarr:8989"},
      {"name": "apiKey", "value": "<REDACTED_API_KEY>"}
    ]
  }'

# Add Radarr
curl -s -X POST http://localhost:9696/api/v1/applications \
  -H "X-Api-Key: <REDACTED_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Radarr",
    "implementationName": "Radarr",
    "implementation": "Radarr",
    "configContract": "RadarrSettings",
    "syncLevel": "fullSync",
    "fields": [
      {"name": "prowlarrUrl", "value": "http://prowlarr:9696"},
      {"name": "baseUrl", "value": "http://radarr:7878"},
      {"name": "apiKey", "value": "<REDACTED_API_KEY>"}
    ]
  }'

# Test each app
curl -s -X POST http://localhost:9696/api/v1/applications/test/1 \
  -H "X-Api-Key: <REDACTED_API_KEY>"
curl -s -X POST http://localhost:9696/api/v1/applications/test/2 \
  -H "X-Api-Key: <REDACTED_API_KEY>"

# Trigger sync of all apps
curl -s -X POST http://localhost:9696/api/v1/applications/sync/all \
  -H "X-Api-Key: <REDACTED_API_KEY>"

# Verify configured apps
curl -s http://localhost:9696/api/v1/applications \
  -H "X-Api-Key: <REDACTED_API_KEY>" | python3 -m json.tool
```

### Via Browser (agent-browser)

```bash
SESSION="$(agent-browser session id --scope worktree --prefix prowlarr-setup)"

# Navigate: Settings → Apps
agent-browser --session "$SESSION" --args "--no-sandbox" click @e17   # Settings
agent-browser --session "$SESSION" --args "--no-sandbox" wait --load networkidle
agent-browser --session "$SESSION" --args "--no-sandbox" click @e15   # Apps sub-link
agent-browser --session "$SESSION" --args "--no-sandbox" wait --load networkidle

# Click Manage Applications
agent-browser --session "$SESSION" --args "--no-sandbox" click @e11

# Select "Sonarr" from the app list
agent-browser --session "$SESSION" --args "--no-sandbox" snapshot -i
# Click the Sonarr button (ref varies)

# Fill in: Name, Server (http://sonarr:8989), API Key, Sync Level
agent-browser --session "$SESSION" --args "--no-sandbox" fill @e... "Sonarr"
agent-browser --session "$SESSION" --args "--no-sandbox" fill @e... "http://sonarr:8989"
agent-browser --session "$SESSION" --args "--no-sandbox" fill @e... "<REDACTED_API_KEY>"

# Test and Save
agent-browser --session "$SESSION" --args "--no-sandbox" click @e...   # Test
agent-browser --session "$SESSION" --args "--no-sandbox" click @e...   # Save

# Repeat for Radarr...
```

**Note**: The Manage Applications dialog shows a list of addable apps as buttons. Their order may vary — use snapshot to identify the correct ref before clicking.

## Screenshots

- `prowlarr-indexer-added.png` — Indexers page showing 1337x in the list
- `prowlarr-apps-configured.png` — Manage Applications dialog showing Sonarr and Radarr with Full Sync
- `prowlarr-indexer-synced.png` — Indexers page after sync showing indexer with app tags
