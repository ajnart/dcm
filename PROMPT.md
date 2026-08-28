# Auto-Stack: Complete System Prompt

## Concept

Auto-Stack turns a single Markdown file with a Docker Compose definition into a fully configured, connected self-hosted software stack. The user writes `docker-compose.yml`, runs one command, and all services are:

1. Started via Docker Compose
2. Authenticated with a standard credential set (`admin` / `Password1!`)
3. Inter-connected (download clients, indexers, app sync)
4. Integrated into a Homarr dashboard with live widgets

The entire setup must be done in a **fresh agent session** each time — no assumptions about prior state. Each run launches a sandboxed agent that starts from zero, writes the compose file, brings up the stack, and configures every service end-to-end.

## Current Stack

| Service     | Port | Image                            | Purpose                      |
|-------------|------|----------------------------------|------------------------------|
| Prowlarr    | 9696 | ghcr.io/hotio/prowlarr:latest    | Indexer manager              |
| Radarr      | 7878 | ghcr.io/hotio/radarr:latest      | Movie library manager        |
| Sonarr      | 8989 | ghcr.io/hotio/sonarr:latest      | TV series library manager    |
| qBittorrent | 8088 | ghcr.io/hotio/qbittorrent:latest | Torrent download client      |
| Jellyfin    | 8096 | ghcr.io/hotio/jellyfin:latest    | Media server & streaming     |
| Homarr      | 7578 | ghcr.io/homarr-labs/homarr:latest| Dashboard & service hub      |

## Architecture / Data Flow

```
Prowlarr (indexer mgr) ──sync──▶ Sonarr (TV) ──downloads──▶ qBittorrent
Prowlarr (indexer mgr) ──sync──▶ Radarr (movies) ──downloads──▶ qBittorrent
Homarr (dashboard) ◀──integrations──▶ Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin
```

All services communicate over the Docker internal network using container hostnames.

## Execution Plan (must follow this order)

### Phase 0: Environment & Compose

1. Write `docker-compose.yml` with all 6 services
2. Run `docker compose up -d`
3. Wait for all containers to be healthy (curl each port until 200/302)

### Phase 1: Authenticate Each Service (parallel via sub-agents)

**Sonarr** (port 8989), **Radarr** (7878), **Prowlarr** (9696):
- Hotio arr images now force an authentication setup modal on first access
- Click the "None" dropdown, select "Forms (Login Page)"
- Fill Username: `admin`, Password: `Password1!`, Confirm: `Password1!`
- Click Save
- Navigate to Settings → General, copy the **API Key** from the textbox
- Document all 3 API keys

**qBittorrent** (port 8088):
- First start generates a random temporary password in container logs
- Read it via `docker logs qbittorrent 2>&1 | grep "temporary password"`
- Log in with `admin` / `<temp-password>`
- Open Tools → Options → Web UI tab
- Fill Password: `Password1!`, click Save
- Verify via API: `curl -d "username=admin&password=Password1!" http://localhost:8088/api/v2/auth/login`
- IMPORTANT: If host port 8080 is taken (e.g. by traefik), remap to 8088 with `WEBUI_PORT=8088` and `WEBUI_PORTS=8088/tcp`

**Jellyfin** (port 8096):
- Complete the 6-step wizard:
  1. Welcome → Next
  2. Admin account → `admin` / `Password1!`
  3. Media libraries → Skip (no media mounted yet)
  4. Metadata language → Defaults → Next
  5. Remote access → Defaults → Next
  6. Finish → Sign in

**Homarr** (port 7578):
- Wipe config first: `rm -rf config/homarr/*` then recreate container
- Open `http://localhost:7578` → redirects to `/init`
- Click "Start from scratch"
- Create admin: `admin` / `Password1!`
- Settings → Continue
- Integrations → Select Sonarr card → Continue → fill URL + API Key → Test → success
- Homarr advances to Finish after ONE integration (onboarding wizard limitation)
- Click "Go to dashboard board"
- Skip tour
- Rename board to Auto-Stack-Dashboard (no spaces in slug, regex `/^[A-Za-z0-9-_]*$/`)
- Set page title: "Auto-Stack Dashboard"
- Add remaining 4 integrations via Management → Integrations:
  - Radarr (API Key), Prowlarr (API Key), qBittorrent (Username & Password), Jellyfin (Username & Password)

### Phase 2: Inter-Connect Services (parallel via sub-agents)

**Sonarr → qBittorrent**:
- Settings → Download Clients → Add → qBittorrent
- Host: `qbittorrent`, Port: `8088`, Username: `admin`, Password: `Password1!`
- Category: `tv-sonarr`
- Clear the auto-filled API Key field (qBittorrent uses username/password)
- Test → Save

**Radarr → qBittorrent**:
- Same as Sonarr but Category: `movies-radarr`
- Override the pre-filled `radarr` category

**Prowlarr indexer + app sync**:
- Add a public indexer (e.g. 1337x — note: Cloudflare-protected, needs FlareSolverr to function)
- Settings → Apps → Add Application → Sonarr
  - URL: http://sonarr:8989, API Key, Sync Level: Full Sync, Test → Save
- Add Application → Radarr
  - URL: http://radarr:7878, API Key, Sync Level: Full Sync, Test → Save
- Verify indexer shows sync targets

### Phase 3: Homarr Dashboard Finalization

- Add all 5 service apps to the board via edit mode (gear → gear → "Add an app")
- Verify all integrations show as connected in Management → Integrations
- Take final screenshot

## Critical Findings & Gotchas

### Authentication
- **Hotio arr images (2025+) enforce Forms auth on first access** — you cannot skip the modal
- API keys are visible in Settings → General on each arr service
- **qBittorrent temp password rotates on every container recreate** — always re-read from logs
- API env vars exist but are not set in this compose: `SONARR__AUTH_METHOD`, `RADARR__AUTH_METHOD`, `PROWLARR__AUTH_METHOD` (set to `Forms`), `*__API_KEY` (set to pre-configure)

### Port Conflicts
- Port 8080 may be taken (traefik, etc.) — the compose port mapping fails **silently**
- Fix: remap to 8088 with `WEBUI_PORT=8088`, `WEBUI_PORTS=8088/tcp`, and `ports: 8088:8088`
- Host-header validation: the browser URL port MUST match the container's WebUI port

### Homarr Quirks
- **Onboarding only allows 1 integration** at a time; add the rest via Management → Integrations
- **Board name regex**: `/^[A-Za-z0-9-_]*$/` — NO spaces in slug; spaces allowed in `pageTitle`
- **Mantine overlay coverage**: clicks on AD menu, Management, Settings sometimes blocked by overlays; re-snapshot after opening menus
- Integration auth modes: default is "API Key"; must switch qBittorrent to "Username & Password"

### Docker Networking
- All inter-service URLs use Docker internal hostnames: `sonarr`, `radarr`, `prowlarr`, `qbittorrent`, `jellyfin`
- Services are on the default `auto-stack_default` network created by Docker Compose

### Browser Automation
- **Always use agent-browser** with `--args "--no-sandbox"` (Chrome in containers)
- Always set `export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix <task>)"` per sub-agent
- Refs `@eN` change on every snapshot — always re-snapshot before interacting
- Use `find text "..." click` or `find role button click --name "..."` as fallback when refs shift

## Files & Credentials (one-time per run)

### API Keys (regenerated on fresh config)
- Sonarr: `be664b980ad8498cae386c62bee0aacb`
- Radarr: `994dad0b2e89403ca708279a03a05159`
- Prowlarr: `60f32bf2cb1f429992c27e4520712524`

### Unified Credentials
- Username: `admin`
- Password: `Password1!`

## Future Features to Implement

### Essential
- [ ] **FlareSolverr** — add to compose alongside Prowlarr so Cloudflare-protected indexers work
- [ ] **Standard media directories** — mount `/media/tv`, `/media/movies`, `/media/downloads` for clean library management
- [ ] **Pre-configure auth via env vars** — set `*__AUTH_METHOD=Forms`, `*__API_KEY=<fixed>` in compose to skip auth modal
- [ ] **Auto-clean script** — `docker compose down -v && rm -rf config/*` for fresh starts between runs
- [ ] **API key extraction** — script to pull keys from each service via their APIs instead of browser nav

### Nice-to-Have
- [ ] **Cross-seed** — add autobrr/cross-seed for automatic cross-seeding between indexers
- [ ] **Tautulli / Bazarr** — media request management and subtitle fetching
- [ ] **Overseerr / Jellyseerr** — user-facing media request portals
- [ ] **Grafana + Prometheus** — monitoring & dashboards for all services
- [ ] **Traefik / Caddy reverse proxy** — automatic TLS, subdomain routing, single entry point
- [ ] **Authelia / Authentik** — centralized SSO across all services
- [ ] **Homepage / Dashy alternative** — compare with Homarr for dashboard approach
- [ ] **Backup automation** — scheduled SQLite backups for all config dirs
- [ ] **Healthcheck endpoints** — add `healthcheck:` to each compose service
- [ ] **Update management** — watchtower or Diun for automatic container updates
- [ ] **Telegram/Discord notifications** — connect Sonarr/Radarr/Prowlarr to notification channels
- [ ] **Hardlinks support** — configure volume mounts so Sonarr/Radarr can hardlink instead of copy
- [ ] **User management** — create restricted users for Jellyfin, shared family access
- [ ] **Resource limits** — add `deploy.resources.limits` to compose services

## Prompt Template for a New Run

```
You are setting up the auto-stack from scratch. Follow these steps in order:

1. Write docker-compose.yml with: [services list]
2. docker compose up -d; wait for all services to respond
3. Launch parallel sub-agents to authenticate each service (admin/Password1!)
4. Extract API keys from Sonarr, Radarr, Prowlarr (Settings → General)
5. Launch parallel sub-agents to connect:
   a. Sonarr → qBittorrent download client
   b. Radarr → qBittorrent download client
   c. Prowlarr → Sonarr + Radarr app sync + add a test indexer
6. Wipe and re-setup Homarr, using onboard integrations step for Sonarr, then post-onboarding for the other 4
7. Document everything in FINDINGS.md and {service}.md
```

Each run is a fresh sandboxed execution. The agent must not assume any prior state — it starts from the Markdown compose file and ends with a fully configured, connected, dashboard-integrated stack.

## How to Use This Prompt

To continue work on this project, paste this whole document as the prompt for a new agent, then tell it:

```
You have all the context above. Start by reading the current state of /home/habs/work/auto-stack/ — check which services are up, which integrations exist, and what remains to be done. Then execute the next phase.
```