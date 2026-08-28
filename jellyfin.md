# Jellyfin First-Time Setup via Browser Automation

Complete guide to automating Jellyfin's initial setup wizard using `agent-browser`.

## Prerequisites

- Jellyfin running on `http://localhost:8096`
- `agent-browser` installed and configured

## Session Setup

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix jellyfin-auth)"
```

Use `--args "--no-sandbox"` in container/VM environments where Chrome's sandbox is unavailable.

## Wizard Walkthrough

### Step 1: Navigate to Jellyfin

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" --args "--no-sandbox" open http://localhost:8096
```

Result: Redirects to `http://localhost:8096/web/` showing the welcome page.

### Step 2: Welcome / Language Selection

**Snapshot refs:**
```
heading "Welcome to Jellyfin!" [ref=e2]
textbox "Server name" [ref=e1]
combobox "Preferred display language" [ref=e4]: English (default)
button "Next" [ref=e5]
```

English is selected by default. Click Next:

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" click @e5
```

### Step 3: Create Admin Account

**Snapshot refs:**
```
heading "Tell us about yourself" [ref=e2]
textbox "Username" [ref=e3]
textbox "Password" [ref=e4]
textbox "Password (confirm)" [ref=e5]
button "Next" [ref=e7]
```

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e3 "admin"
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e4 "[REDACTED LEGACY TEST PASSWORD]"
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e5 "[REDACTED LEGACY TEST PASSWORD]"
agent-browser --session "$AGENT_BROWSER_SESSION" click @e7
```

### Step 4: Media Libraries (Skip)

**Snapshot refs:**
```
heading "Set up your media libraries" [ref=e2]
button "Next" [ref=e6]
```

No media mounted yet — skip:

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" click @e6
```

### Step 5: Metadata Language

**Snapshot refs:**
```
heading "Preferred Metadata Language" [ref=e2]
combobox "Language" [ref=e3]: English (default)
combobox "Country/Region" [ref=e4]: United States (default)
button "Next" [ref=e6]
```

Defaults are acceptable:

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" click @e6
```

### Step 6: Remote Access

**Snapshot refs:**
```
heading "Set up Remote Access" [ref=e2]
checkbox "Allow remote connections to this server" [checked=true, ref=e4]
button "Next" [ref=e6]
```

Defaults accepted:

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" click @e6
```

### Step 7: Finish Setup

**Snapshot refs:**
```
heading "You're Done!" [ref=e2]
button "Finish" [ref=e4]
```

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" click @e4
```

### Step 8: Sign In

After setup, Jellyfin redirects to the login page.

**Snapshot refs:**
```
heading "Please sign in" [ref=e3]
textbox "User" [ref=e4]
textbox "Password" [ref=e5]
button "Sign In" [ref=e7]
```

```bash
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e4 "admin"
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e5 "[REDACTED LEGACY TEST PASSWORD]"
agent-browser --session "$AGENT_BROWSER_SESSION" click @e7
```

### Result: Dashboard

After login you see the Jellyfin dashboard with:
- Navigation sidebar (Home, Dashboard, Settings, Sign Out)
- "Nothing here." empty state (no media libraries configured)
- Button to create the first library

**Screenshot:** `jellyfin-logged-in.png`

## Complete Script

```bash
#!/bin/bash
set -euo pipefail

export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix jellyfin-setup)"

agent-browser --session "$AGENT_BROWSER_SESSION" --args "--no-sandbox" open http://localhost:8096
agent-browser --session "$AGENT_BROWSER_SESSION" snapshot -i

# Step 1: Welcome / Next
agent-browser --session "$AGENT_BROWSER_SESSION" click @e5

# Step 2: Admin account
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e3 "admin"
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e4 "[REDACTED LEGACY TEST PASSWORD]"
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e5 "[REDACTED LEGACY TEST PASSWORD]"
agent-browser --session "$AGENT_BROWSER_SESSION" click @e7

# Step 3: Skip media libraries
agent-browser --session "$AGENT_BROWSER_SESSION" click @e6

# Step 4: Metadata language defaults
agent-browser --session "$AGENT_BROWSER_SESSION" click @e6

# Step 5: Remote access defaults
agent-browser --session "$AGENT_BROWSER_SESSION" click @e6

# Step 6: Finish
agent-browser --session "$AGENT_BROWSER_SESSION" click @e4

# Sign in
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e4 "admin"
agent-browser --session "$AGENT_BROWSER_SESSION" fill @e5 "[REDACTED LEGACY TEST PASSWORD]"
agent-browser --session "$AGENT_BROWSER_SESSION" click @e7

# Verify
agent-browser --session "$AGENT_BROWSER_SESSION" snapshot -i
agent-browser --session "$AGENT_BROWSER_SESSION" screenshot jellyfin-logged-in.png
agent-browser --session "$AGENT_BROWSER_SESSION" close
```

## Troubleshooting

| Issue | Fix |
|---|---|
| Chrome sandbox error | Add `--args "--no-sandbox"` |
| Refs from earlier snapshot are invalid | Re-run `snapshot -i` after every page navigation |
| Login fails | Refs may differ — snapshot the login page and check element IDs |
| Page doesn't load | Verify Jellyfin is running: `curl http://localhost:8096` |
