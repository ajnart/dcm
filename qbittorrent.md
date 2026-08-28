# qBittorrent WebUI Authentication Setup Guide

This guide documents the exact browser automation path used to set up qBittorrent authentication via the web UI.

## Service Info

- **Container**: `qbittorrent` (ghcr.io/hotio/qbittorrent:latest)
- **Web UI port (container)**: 8080
- **Web UI port (host)**: 8088
- **Default username**: `admin`
- **Temporary password** (from container logs, per-session): e.g. `whqLR4eyn`
- **Final credentials**: `admin` / `Password1!`

> **Note on port 8088**: A host-side `traefik` process (PID 1310767) is bound to `0.0.0.0:8080`, so
> the qBittorrent `8080:8080` port mapping fails to bind. The compose file was updated to map
> `8088:8088` and the image env `WEBUI_PORT=8088` / `WEBUI_PORTS=8088/tcp` was set so the Web UI
> listens on 8088 inside the container (avoiding qBittorrent's Host-header validation from rejecting
> a mismatched host port).

## Prerequisites / Gotchas

1. **Chrome sandbox**: In containerized environments Chrome fails to launch without a usable
   sandbox. Launch with: `--args "--no-sandbox"`.
2. **Named session**: Use a dedicated `agent-browser` session so refs don't collide with other
   agents:
   ```bash
   export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix qbit-auth)"
   ```
3. **Temporary password is per-session**: The temp password shown at first container start is only
   valid for that session. If the container is recreated, re-read the logs for the new temp password:
   ```bash
   docker logs qbittorrent 2>&1 | grep "temporary password"
   ```
4. **The Web UI login page only loads over `http://` when the port is reachable.** If you get a bare
   `Unauthorized` text/plain body on the root path, the request was rejected by Host-header
   validation or authentication; make sure the Host header port matches the port the Web UI is
   listening on.

## Browser Automation Steps

### 1. Start a dedicated browser session

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix qbit-auth)"
```

### 2. Open the login page

```bash
agent-browser open http://localhost:8088 --args "--no-sandbox"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

URL: `http://localhost:8088/`

Snapshot (interactive elements):

```
- heading "qBittorrent WebUI" [level=1, ref=e1]
- textbox "Username" [required, ref=e2]
- textbox "Password" [required, ref=e3]
- button "Login" [ref=e4]
```

### 3. Log in with the temporary password

```bash
agent-browser fill @e2 "admin"
agent-browser fill @e3 "whqLR4eyn"      # use the temp password from the container logs
agent-browser click @e4
agent-browser wait --load networkidle
```

After login the main Transfers dashboard loads at `http://localhost:8088/`, with the toolbar
(`File`, `Edit`, `View`, `Tools`, `Help`) and sidebar (`Transfers`, `Search`, `RSS`) visible.

> Use the *current* temp password from `docker logs`. In this session it was `whqLR4eyn`
> (first start) but changed to e.g. `QGDueSSGp` after the container was recreated.

### 4. Open Options → Web UI

Open the **Tools** menu and choose **Options...**:

```bash
agent-browser click @e17      # Tools menu
agent-browser click @e46      # "Options..." menu item
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Snapshot after Options opens — sidebar list items include:

```
- listitem "Behavior" ... [ref=e30]
- listitem "Downloads" ... [ref=e31]
- listitem "Connection" ... [ref=e32]
- listitem "Speed" ... [ref=e33]
- listitem "BitTorrent" ... [ref=e34]
- listitem "RSS" ... [ref=e35]
- listitem "WebUI" [level=1, ref=e36] clickable
- listitem "Advanced" ... [ref=e37]
```

Select the **WebUI** section:

```bash
agent-browser click @e36      # WebUI settings tab
```

Re-snapshot to get fresh refs for the WebUI form.

### 5. Change the password

WebUI settings form fields seen in the snapshot:

```
- textbox "Username:" [ref=e123]: admin
- textbox "Password:" [ref=e124]            # empty — new password goes here
- checkbox "Bypass authentication for clients on localhost" [checked=false, ref=e97]
- checkbox "Enable Host header validation" [checked=true, ref=e114]
- textbox "Server domains:" [ref=e129]: *
- ...
- button "Save" [ref=e74]
```

Set the new password and save:

```bash
agent-browser fill @e124 "Password1!"
agent-browser click @e74       # Save
agent-browser wait --load networkidle
```

The Options dialog closes and returns to the Transfers dashboard. The password is now persisted in
the container config file `config/qbittorrent/config/qBittorrent.conf` under `[WebUI]`.

### 6. Screenshot confirmation

```bash
agent-browser screenshot qbit-final.png
```

Screenshots captured along the way:

| File                       | Content                                        |
|----------------------------|------------------------------------------------|
| `qbit-settings-saved.png`  | Options dialog saved + Transfers dashboard     |
| `qbit-final.png`           | Final dashboard after logout/password change   |
| `qbit-login.png`           | Login page pre-auth flow (was `Unauthorized`)  |

### 7. Log out and verify the new password

The menu-driven logout can be flaky. A reliable logout + verification is done with the API
(equivalent to clicking **Tools → Logout**):

```bash
# Confirm new password works (returns 204 + sets session cookie)
curl -s -c /tmp/qbit-cookies.txt \
  -o /dev/null -w "%{http_code}\n" \
  http://localhost:8088/api/v2/auth/login -X POST \
  -d "username=admin&password=Password1!"

# Use the session
curl -s -b /tmp/qbit-cookies.txt http://localhost:8088/api/v2/app/version
# -> v5.2.3

# Confirm old temp password is rejected (expect 401)
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:8088/api/v2/auth/login -X POST \
  -d "username=admin&password=<old-temp-password>"
# -> 401
```

In this run: new password returned `204` and API session worked (`v5.2.3`); the old temp password
returned `401`.

## Settings Changed

Only one setting changed in the Web UI:

| Setting              | Before | After        |
|----------------------|--------|--------------|
| Web UI Password      | (temp) | `Password1!` |

Username stayed `admin`. All other WebUI defaults were left untouched (`Bypass authentication for
clients on localhost` unchecked, `Enable Host header validation` checked with `Server domains: *`).

## Docker Compose Changes (infrastructure, not Web UI)

Because host port 8080 is already taken by `traefik`, `docker-compose.yml` for the `qbittorrent`
service was changed:

```yaml
environment:
  - WEBUI_PORT=8088
  - WEBUI_PORTS=8088/tcp
ports:
  - 8088:8088
  - 6881:6881
  - 6881:6881/udp
```

Apply with:

```bash
docker compose up -d qbittorrent
```

## Troubleshooting

- **`No usable sandbox!` on Chrome launch** → add `--args "--no-sandbox"`.
- **`Unauthorized` plain text instead of login page** → request rejected by qBittorrent auth /
  Host-header validation. Verify the port in the URL matches the container's listening Web UI port.
- **`bind: address already in use` when creating the container** → another process (here `traefik`)
  owns the host port. Pick a free host port and set `WEBUI_PORT`/`WEBUI_PORTS` to the same value.
- **Login fails with temp password** → the temp password rotates on every container recreate; always
  re-fetch it from `docker logs qbittorrent`.