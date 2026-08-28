# Homarr First-Time Setup Guide (Full Onboarding with Integrations)

This document records the exact browser automation path used to set up Homarr's first
administrator, board, and dashboard on the auto-stack instance — including all 5 service
integrations configured during or immediately after the onboarding wizard.

Service: `http://localhost:7578` (container `homarr`, published port `7578` -> internal `7575`).

## Prerequisites

- The stack is up (`docker compose up -d`) and Homarr is serving on `http://localhost:7578/`.
- Homarr's config was wiped clean so it shows the onboarding wizard at `/init`.
- `agent-browser` is installed (`npm i -g agent-browser && agent-browser install`).
- Chrome needs `--no-sandbox` on this host.

## Session

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix homarr-full)"
```

## Step-by-step path

### 1. Open Homarr (redirects to /init)

```bash
agent-browser open http://localhost:7578 --args "--no-sandbox"
```

URL: `http://localhost:7578` -> redirects to `http://localhost:7578/init`

Snapshot:
- `@e1` heading "Homarr"
- `@e5` button "Start from scratch"
- `@e6` button "Import from Homarr before 1.0"
- `@e7` button "Restore from SQLite backup"

### 2. Step 1 - Welcome: Start from scratch

```bash
agent-browser click @e5
```

Advances to admin user creation step.

### 3. Step 2 - Admin user

Snapshot:
- `@e7` textbox "Username"
- `@e10` textbox "Password"
- `@e8` textbox "Confirm password"
- `@e6` button "Create user"

```bash
agent-browser fill @e7 "admin"
agent-browser fill @e10 "Password1!"
agent-browser fill @e8 "Password1!"
agent-browser click @e6
```

### 4. Step 3 - Settings

Snapshot shows `@e5` button "Continue" with default switches.

```bash
agent-browser click @e5
```

### 5. Step 4 - Integrations (CRITICAL — do NOT skip)

Snapshot heads "Integrations" and shows the full integration catalog with a grid of service cards.
The Continue button is disabled until at least one integration is selected.

**Available refs (from snapshot):**
- `@e5` generic "Sonarr" card
- `@e6` generic "Radarr" card
- `@e7` generic "Prowlarr" card
- `@e9` generic "qBittorrent" card
- `@e11` generic "Jellyfin" card
- `@e60` button "Continue" (initially disabled)
- `@e62` textbox "Base URL" (optional)
- `@e61` textbox "Search integrations..."

#### 5a. Click the Sonarr card to select it

```bash
agent-browser click @e5   # "Sonarr" card
```

The Continue button now shows "Continue(1)" indicating 1 integration selected.

#### 5b. Click Continue to configure Sonarr

```bash
agent-browser click @e60
```

**Sonarr configuration form:**
- `@e9` textbox "Name" (pre-filled: Sonarr)
- `@e10` textbox "Url"
- `@e11` textbox "API Key"
- `@e8` button "Test connection and create"

```bash
agent-browser fill @e10 "http://sonarr:8989"
agent-browser fill @e11 "<REDACTED_API_KEY>"
agent-browser click @e8
```

Connection test succeeds. Homarr advances to the "Finish setup" page.

### 6. Step 5 - Finish setup → Go to dashboard

```bash
agent-browser click @e5   # "Go to dashboard board"
```

### 7. Step 6 - Skip the onboarding tour

```bash
agent-browser click @e3   # "Skip tour"
```

### 8. Rename board and set page title

#### 8a. Open user menu → Management

```bash
agent-browser click @e4   # "AD" avatar button -> opens menu
agent-browser click @e6   # "Management" menuitem
```

#### 8b. Navigate to Boards

```bash
agent-browser click @e18  # "Boards" link in sidebar
```

#### 8c. Open board Settings

```bash
agent-browser click @e11  # "Settings" button on the board card (dropdown trigger)
agent-browser click @e4   # "Settings" menuitem in the popover
```

#### 8d. Change board name

```bash
agent-browser click @e18  # "Change name" in Danger zone
```

Rename dialog appears:
- `@e53` textbox "Name" (current value: `dashboard`)
- `@e40` button "Confirm"

**Note**: Homarr board names must match `/^[A-Za-z0-9-_]*$/`. No spaces allowed.

```bash
agent-browser fill @e53 "Auto-Stack-Dashboard"
agent-browser click @e40  # "Confirm"
```

#### 8e. Set display title

```bash
agent-browser fill @e21 "Auto-Stack Dashboard"  # "Page title" textbox
```

Scroll to bottom:

```bash
agent-browser scroll down 800
agent-browser click @e37  # "Save changes"
```

### 9. Add remaining 4 integrations via Management

The onboarding wizard only configures one integration at a time. The remaining 4
(Radarr, Prowlarr, qBittorrent, Jellyfin) must be added from the management page.

#### 9a. Navigate to Integrations management

```bash
agent-browser navigate http://localhost:7578/manage/integrations
```

#### 9b. Add Radarr

```bash
agent-browser click @e6   # "New integration"
# Click the Radarr card (use find since refs shift)
agent-browser find text "Radarr" click
```

Configuration form:
- `@e24` textbox "Url"
- `@e26` textbox "API Key"
- `@e10` button "Test connection and create"

```bash
agent-browser fill @e24 "http://radarr:7878"
agent-browser fill @e26 "<REDACTED_API_KEY>"
agent-browser click @e10
```

#### 9c. Add Prowlarr

```bash
agent-browser click @e6   # "New integration"
agent-browser find text "Prowlarr" click
agent-browser fill @e24 "http://prowlarr:9696"
agent-browser fill @e26 "<REDACTED_API_KEY>"
agent-browser click @e10
```

#### 9d. Add qBittorrent (switch to Username & Password)

```bash
agent-browser click @e6   # "New integration"
agent-browser find text "qBittorrent" click
```

Default auth mode is "API Key". Switch to "Username & Password":

```bash
agent-browser click @e28  # "Username & Password" radio (unchecked -> checked)
```

Form now shows:
- `@e24` textbox "Url"
- `@e26` textbox "Username"
- `@e31` textbox "Password"
- `@e10` button "Test connection and create"

```bash
agent-browser fill @e24 "http://qbittorrent:8088"
agent-browser fill @e26 "admin"
agent-browser fill @e31 "Password1!"
agent-browser click @e10
```

#### 9e. Add Jellyfin (defaults to Username & Password)

```bash
agent-browser click @e6   # "New integration"
agent-browser find text "Jellyfin" click
agent-browser fill @e24 "http://jellyfin:8096"
agent-browser fill @e26 "admin"
agent-browser fill @e31 "Password1!"
agent-browser click @e10
```

### 10. Verify all 5 integrations

```bash
agent-browser navigate http://localhost:7578/manage/integrations
```

Integrations list shows:
- `qBittorrent 1`
- `Sonarr 1`
- `Radarr 1`
- `Prowlarr 1`
- `Jellyfin 1`

### 11. Dashboard screenshot

```bash
agent-browser navigate http://localhost:7578/
agent-browser wait --load networkidle
agent-browser screenshot /home/habs/work/auto-stack/homarr-dashboard.png
```

## Result summary

| Item                     | Value                       |
|--------------------------|-----------------------------|
| Admin username           | `admin`                     |
| Admin password           | `Password1!`                |
| Board slug / name        | `Auto-Stack-Dashboard`      |
| Display title (pageTitle)| `Auto-Stack Dashboard`      |
| Board URL                | `http://localhost:7578/boards/Auto-Stack-Dashboard` |
| Home URL                 | `http://localhost:7578/`    |

### Integrations configured

| Service     | Integration Type | URL (Docker)          | Auth Method            | Credentials / API Key                              |
|-------------|------------------|-----------------------|------------------------|----------------------------------------------------|
| Sonarr      | Sonarr           | http://sonarr:8989    | API Key                | `<REDACTED_API_KEY>`                 |
| Radarr      | Radarr           | http://radarr:7878    | API Key                | `<REDACTED_API_KEY>`                 |
| Prowlarr    | Prowlarr         | http://prowlarr:9696  | API Key                | `<REDACTED_API_KEY>`                 |
| qBittorrent | qBittorrent      | http://qbittorrent:8088| Username & Password    | `admin` / `Password1!`                            |
| Jellyfin    | Jellyfin         | http://jellyfin:8096  | Username & Password    | `admin` / `Password1!`                            |

## Issues encountered

1. **Onboarding only allows one integration at a time**: The onboarding wizard's integration step only accepts one integration at a time. After configuring and testing the first integration (Sonarr), the wizard advances to the Finish page. The remaining 4 integrations must be added from Management → Integrations.
2. **Board name validation**: Homarr rejects spaces in board names (`/^[A-Za-z0-9-_]*$/`). Use `Auto-Stack-Dashboard`; the display title field (`pageTitle`) accepts spaces.
3. **Covered-element clicks**: The user menu (`AD`), board "Settings", and "Management" targets were sometimes reported as covered by a Mantine overlay. Re-snapshot after opening the menu and click the freshly listed menuitem ref.
4. **Sandbox**: Chrome needs `--no-sandbox` on this host.
5. **qBittorrent auth mode**: Must switch from default "API Key" to "Username & Password" before filling credentials.
6. **Refs shift between snapshots**: The `@eN` refs change after every page action. Always re-snapshot before interacting.

## Screenshots

- `homarr-dashboard.png` — final dashboard showing the Auto-Stack Dashboard board
