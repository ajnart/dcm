# self-host rewrite plan

Vocabulary is in [CONTEXT.md](CONTEXT.md). Decisions are in [docs/adr](docs/adr).

## Goal

One static Go binary, installed with `curl | bash`, that installs Apps and
Recipes into one Docker Compose Project and sets them up headlessly. A TUI for
people, plain subcommands with `--json` events for agents. When automatic Setup
fails, the agent finishes the job with agent-browser and reruns Setup.

## Non-goals for v1

Installing Docker, public ingress/TLS, VPN, scheduled backups, Windows outside
WSL, migrating projects from the previous CLI.

## Repository layout

```
cmd/self-host/        entrypoint
internal/cli/         subcommands and flag parsing
internal/tui/         Bubble Tea + Huh screens
internal/events/      step logger: human text or NDJSON
internal/host/        Docker/Compose checks, host settings detection, ports, doctor
internal/project/     ~/self-host layout, include list, .env, secrets.env, state.json, lock
internal/compose/     `docker compose` wrapper (logs every command it runs)
internal/catalog/     App and Recipe registry
internal/apps/<id>/   one package per catalog App
internal/helpers/     shared Setup helpers (the `h` package)
internal/backup/      backup and restore (.tar.zst, optional age)
internal/skill/       embedded agent guide printed by `self-host skill`
install.sh            curl | bash installer
.goreleaser.yaml      release builds and checksums
```

## Project on disk

```
~/self-host/
  compose.yml          generated: `include:` of every apps/*/compose.yml
  .env                 Host settings: TZ, PUID, PGID, UMASK, MEDIA_ROOT, DOWNLOADS_ROOT, LAN_IP, EXPOSURE
  secrets.env          0600: Admin login, per-App API keys
  state.json           installed catalog Apps, inputs, step results
  .lock                PID of the running mutating command
  apps/<id>/compose.yml
  apps/<id>/...        config bind mounts (no named volumes)
```

- Compose files decide what runs. A folder in `apps/` with no catalog entry is
  an Unmanaged app: start/stop/update/backup work, Setup does not.
- Under `sudo`, the project goes in `SUDO_USER`'s home and PUID/PGID come
  from `SUDO_UID`/`SUDO_GID`.
- The lock is a PID file. Mutating commands fail if a live PID holds it, and
  ignore it otherwise. Read-only commands do not take it.

## App contract

```go
type App interface {
	ID() string
	Info() Info                          // name, description, default port, image, docs URL
	Inputs() []Input                     // key, prompt, default, required
	Compose(env Env) ([]byte, error)     // apps/<id>/compose.yml, uses ${TZ} etc.
	Setup(ctx context.Context, h *helpers.H) error
	Check(ctx context.Context, h *helpers.H) error
	Links() []Link                       // run when the target App has completed Setup
}
```

- Each Setup step goes through `h.Step(id, check, do, hint)`: run `check`
  first and skip if already done, otherwise `do` and re-`check`. On failure,
  emit `hint`.
- `helpers.H` provides: HTTP with retries and auth, wait-until-healthy,
  `exec` in a container, secrets get/set, XML/INI/YAML config edits, App URLs
  on the LAN IP, logging.
- A Link belongs to the consuming App (e.g. Sonarr → qBittorrent download
  client). `remove <app>` also undoes the Links that point at it.
- Images: linuxserver.io first, official images second, floating stable tags.

## Events

Human text by default, one JSON object per line with `--json`:

```json
{"event":"step.fail","app":"sonarr","step":"download-client","msg":"…","url":"http://192.168.1.20:8989","credential":"admin","hint":"…"}
```

Events: `run.start`, `step.start`, `step.ok`, `step.skip`, `step.fail`,
`run.end`. Every `docker compose` command is logged verbatim. Secret values
never appear; credentials are referenced by name.

## Commands

| Command | Notes |
|---|---|
| `self-host` | TUI: first-run wizard or dashboard |
| `install <app\|recipe>… [--set k=v] [--yes]` | non-interactive install + Setup |
| `setup [app…]` | rerun Setup; finished steps are skipped |
| `status`, `doctor` | recap / reachability diagnosis, `--json` |
| `credentials` | Admin login and per-App keys |
| `start`, `stop`, `update [app…]` | Compose-driven; update pulls, recreates, runs Check |
| `remove <app> [--purge]` | keeps `apps/<id>/` data unless `--purge` |
| `config set k=v` | updates `.env`, recreates the affected Apps |
| `backup [app…] -o file [--encrypt]` | `.tar.zst` + manifest, stops one App at a time |
| `restore file [app…]` | one App or all |
| `apps list`, `apps info <id>` | catalog and inputs, `--json` |
| `skill` | embedded agent guide |
| `self-update` | replace the binary after checksum check |

## Recap (`status`, end of install)

Exposure, LAN IP, Host settings, then for each App: URL on the LAN IP, port,
container health, Setup result, failed steps with hints.
`doctor` adds: port bound to 0.0.0.0 or 127.0.0.1, ufw/firewalld/macOS
firewall state, HTTP reachability on the LAN IP.

## Host requirements

Docker with Compose v2 reachable through the active `docker context` /
`DOCKER_HOST`. If it is missing or the socket is denied, stop and print the
Docker docs URL (OrbStack on macOS). Linux amd64/arm64, macOS arm64.

## Build order

1. **Skeleton**: CLI parsing, events logger, host checks, `--version`.
2. **Project**: layout, host settings detection, `.env`, secrets, state, lock,
   include-list `compose.yml`, `docker compose` wrapper, `start`/`stop`/`status`.
3. **First App end to end**: ntfy (single container, headless admin) through
   `install` → Setup → `Check` → recap.
4. **Helpers hardening**: HTTP, config edits, waits, step/hint contract.
5. **Media Recipe**: Prowlarr, Radarr, Sonarr, qBittorrent, Jellyfin, Seerr,
   Homarr, with their Links. Reuse knowledge from the old repo's FINDINGS
   and click-path notes; port facts, not code.
6. **Vaultwarden**, `remove`, `update`, `config set`, `doctor`.
7. **Backup and restore**.
8. **TUI**: wizard and dashboard over the same commands.
9. **Agent guide** (`self-host skill`), `install.sh`, goreleaser, `self-update`.
10. **Nightly e2e** per Recipe in CI.
