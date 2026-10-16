<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/mark/mark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/brand/mark/mark-light.svg">
    <img src="docs/assets/brand/mark/mark-light.svg" alt="self-host Logo: four containers with their status lights" width="128" height="128">
  </picture>
</p>

<h1 align="center">self-host</h1>

<p align="center"><b>Stop renting your software.</b></p>

<p align="center">
  <!-- Static while the repo is private; switch back to https://img.shields.io/github/v/release/ajnart/self-host?style=flat-square&labelColor=14121e&color=7a57d3 once it is public. -->
  <a href="https://github.com/ajnart/self-host/releases/latest"><img alt="Release v0.5.11" src="https://img.shields.io/badge/release-v0.5.11-7a57d3?style=flat-square&labelColor=14121e"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-7a57d3?style=flat-square&labelColor=14121e"></a>
  <img alt="Platforms: Linux, macOS, WSL2" src="https://img.shields.io/badge/platforms-Linux%20%C2%B7%20macOS%20%C2%B7%20WSL2-7a57d3?style=flat-square&labelColor=14121e">
  <a href="https://self-host.fyi/apps"><img alt="90 Apps in the Catalog" src="https://img.shields.io/badge/Apps-90-00d787?style=flat-square&labelColor=14121e"></a>
</p>

<p align="center">
  <a href="https://self-host.fyi">Website</a> · <a href="https://self-host.fyi/docs">Docs</a> · <a href="https://self-host.fyi/#reel">Showreel</a> · <a href="https://discord.gg/aCsmEV5RgA">Discord</a>
</p>

[![self-host: Your Apps. Your home. One binary. Watch the showreel.](docs/assets/social-card.png)](https://self-host.fyi/#reel)

Run your own Apps at home without learning Docker. One binary installs and runs them, with a terminal Dashboard for you and plain commands for your agent.

```bash
curl -fsSL https://self-host.fyi/install | bash
```

That installs only the binary and deploys nothing. Needs Docker with the Compose v2 plugin on Linux, macOS or WSL2. Then run `self-host`.

<p align="center"><img src="docs/assets/readme/setup-terminal.svg" width="880" alt="Setting up self-host in 30 seconds. A terminal installs with curl -fsSL https://self-host.fyi/install | bash, answers Onboarding one question at a time (Welcome, What, Where, Access, Who, Look), shows the Review plan and presses enter to approve, then lands on the Dashboard Overview with Homarr, Jellyfin, Prowlarr, qBittorrent, Radarr, Seerr and Sonarr running."></p>

<details>
<summary><b>Other ways to install</b> (wget, Homebrew, Docker, packages, Arch, archive, source)</summary>

Every channel installs the same release binary, byte for byte.

| Channel                 | Command                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| wget                    | `wget -qO- https://self-host.fyi/install \| bash`                                                                                                            |
| Homebrew (macOS, Linux) | `brew install ajnart/tap/self-host`                                                                                                                          |
| Docker                  | `docker run --rm -it ghcr.io/ajnart/self-host:latest` plus socket and Home folder mounts: [full command](https://self-host.fyi/docs/getting-started#install) |
| Debian, Ubuntu (.deb)   | `sudo apt install ./self-host_X.Y.Z_linux_amd64.deb`                                                                                                         |
| Fedora, RHEL (.rpm)     | `sudo dnf install ./self-host_X.Y.Z_linux_amd64.rpm`                                                                                                         |
| Alpine (.apk)           | `sudo apk add --allow-untrusted ./self-host_X.Y.Z_linux_amd64.apk`                                                                                           |
| Arch Linux, Omarchy     | `sudo pacman -U ./self-host_X.Y.Z_linux_amd64.pkg.tar.zst`                                                                                                   |
| Release archive         | `self-host_<version>_<os>_<arch>.tar.gz` from [Releases](https://github.com/ajnart/self-host/releases), then check it against `checksums.txt`                |
| Go                      | `go install github.com/ajnart/self-host/cmd/self-host@latest`                                                                                                |
| From source             | `git clone https://github.com/ajnart/self-host && cd self-host && go build -buildvcs=false -o ~/.local/bin/self-host ./cmd/self-host`                        |

Packages come from [GitHub Releases](https://github.com/ajnart/self-host/releases/latest) for `amd64` or `arm64`. Go and source builds need Go 1.26.0+ and cannot `self-update`.

Update with `self-host self-update` for the script and the archive. Homebrew, Docker and packages update through their own tool.

</details>

To read the install script first: `curl -fsSL https://self-host.fyi/install -o install.sh`, compare `shasum -a 256 install.sh` with `https://self-host.fyi/install.sh.sha256`, then `bash install.sh`. It verifies the archive against `checksums.txt` and installs to `~/.local/bin`. Version, folder and fork options are in the [docs](https://self-host.fyi/docs/getting-started#install).

## What it replaces

<p align="center"><img src="docs/assets/readme/replaces-meet.svg" width="600" alt="What it replaces: Netflix to Jellyfin, Spotify to Navidrome, Drive to Nextcloud, Dropbox to Syncthing, Photos to Immich, 1Password to Vaultwarden, Notion to Docmost, ChatGPT to Open WebUI. Every App is in the Catalog, with 82 more."></p>

Each of these has an App you can install today, for example `self-host install immich`. Browse all 90 in the [Catalog](https://self-host.fyi/apps).

<p align="center"><img src="docs/assets/readme/hero-command.svg" width="880" alt="The install command, curl -fsSL self-host.fyi/install | bash, wired to nine Apps with data pulses travelling the wires: Jellyfin, Sonarr, Radarr, Immich, Nextcloud, Homarr, Vaultwarden, Navidrome and Home Assistant."></p>

## What it does and doesn't do

> [!IMPORTANT]
> Nothing installs without your approval. Onboarding writes nothing until you approve its plan, and no single Dashboard key changes an App.

> [!NOTE]
> Apps are third-party software under their own licences. self-host installs and connects them; it does not own or maintain them.

<details>
<summary><b>The honest list</b></summary>

| ✅ Does                                                                         | ❌ Doesn't                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Ships the Catalog inside the binary: 90 Apps and 7 Recipes.                     | Install Docker for you. `self-host doctor` checks it.                                   |
| Runs headless Setup for each App: accounts, API keys, settings.                 | Touch anything outside its one Compose Project in `~/.self-host`.                       |
| Wires Apps together with Links, and gives Homarr native tiles.                  | Back up media libraries or data outside App folders.                                    |
| Shows a five-tab Dashboard (Overview, Apps, Activity, Catalog, Settings).       | Run on native Windows. Use WSL2.                                                        |
| Offers Access from the Home network to Tailscale, Cloudflare or your own proxy. | Ship indexers, trackers or content sources.                                             |
| Backs up and restores with optional encryption.                                 | Prove safe version-to-version migration. Update checks are not migration tests.         |
| Gives agents plain commands with `--json` output.                               | Make every App work: 97 of 113 tested targets pass ([details](#platforms-and-support)). |

A **Recipe** is a pre-wired bundle: `media` is qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin and Seerr.

</details>

## With an agent

Paste this into Claude Code, Codex, OpenCode, OpenClaw or any coding agent:

```text
Install the self-host skill from github.com/ajnart/self-host and help me run my own movie server.
```

Or write the skill for every agent on the machine:

```bash
self-host skill install
```

<details>
<summary><b>Agent reference</b></summary>

The one public skill, [`skills/self-host/SKILL.md`](skills/self-host/SKILL.md), only routes to the guide built into the binary. Print it with `self-host skill`. Agents also read <https://self-host.fyi/llms.txt>.

Agents follow **inspect → plan → approval → apply → verify**. Loading the skill is intent, never approval: every change needs the person's explicit yes.

```bash
self-host doctor --json
self-host apps list --json
# only after the person approves:
self-host install ntfy --exposure local --yes --json
self-host status --json
```

- Pass secrets with `--set-file app.key=/path`, never as arguments. They land only in the Project's `secrets.env`.
- Exit codes: `0` success, `1` error, `2` incomplete Setup.
- A running container or HTTP 200 is not acceptance. Check that the App does its job.

All flags, events and the isolated Project setup are in the [agent docs](https://self-host.fyi/docs/agents).

</details>

## Reaching your Apps

Home network by default. Each change needs your approval.

**Anything reachable from the internet needs its own explicit yes that names the risk.** Do not forward port 80 on your router for Easy names.

<details>
<summary><b>Access options</b></summary>

| Access                   | What you get                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Home network (default)   | `http://192.168.1.20:8096`. Ports publish on all host interfaces.                    |
| This computer only       | `127.0.0.1` (`--exposure local`).                                                    |
| Easy names at home       | `http://jellyfin.192-168-1-20.sslip.io`, through one managed Caddy.                  |
| From anywhere, privately | Tailscale, one HTTPS node per App.                                                   |
| Your own web address     | Cloudflare Tunnel plus a login page.                                                 |
| Bring your own           | `self-host access export` for SWAG, Pangolin, Nginx Proxy Manager, Traefik or Caddy. |

The `IP:port` Address is always kept as a fallback.

Cannot reach an App from another device? Run `self-host debug <app>`, then see [Access](https://self-host.fyi/docs/access) and [Troubleshooting](https://self-host.fyi/docs/troubleshooting).

</details>

## Backup and Restore

> [!NOTE]
> Backups include App folders, Host settings, state and secrets, so keep the archive and its passphrase apart. Media libraries and data outside App folders are not included.

<details>
<summary><b>Backup details</b></summary>

A written archive is not a verified recovery plan: restore into an isolated Project and check the data.

```bash
self-host backup --encrypt
self-host restore <archive> [app]
```

</details>

## Commands

Everything the Dashboard does is also a plain command.

<details>
<summary><b>All commands</b></summary>

Prefix with `self-host`. `--verbose` (`-v`) adds detail. `--yes` authorizes an approved noninteractive install, remove or restore; it is not a preview flag.

| Command                                              | What it does                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `doctor`                                             | Check Docker, Compose and the Host, and a Project's Apps and ports.                       |
| `host report [--extra]`                              | Report OS, Docker access and port binds. Changes nothing.                                 |
| `install <app\|recipe>...`                           | Install Apps or Recipes into the Project.                                                 |
| `status [--updates]`                                 | URLs, container state, health and Setup; optionally check image updates.                  |
| `setup [app...]`                                     | Retry unfinished Setup.                                                                   |
| `up`, `down`                                         | Start / remove the Project's containers and networks. `down` keeps volumes and App files. |
| `start`, `stop`, `restart [app...]`                  | Operate named Apps, or every installed App when omitted.                                  |
| `update [app...]`                                    | Pull images, recreate Apps and rerun checks.                                              |
| `logs <app> [--follow] [--tail N]`                   | Container logs; default tail is 200 lines.                                                |
| `remove <app>... [--yes]`                            | Remove Apps, keep data; `--purge` also deletes their data folders.                        |
| `config set KEY=value...`                            | Change Host settings and recreate affected Apps.                                          |
| `config review [--yes]`                              | Review Host drift; `--yes` applies detected LAN address and time zone fixes.              |
| `access export --format caddy\|nginx\|traefik\|json` | Print each App's upstream for your own reverse proxy. Changes nothing.                    |
| `backup`, `restore`                                  | See [Backup and Restore](#backup-and-restore).                                            |
| `debug <app>`                                        | Status, failed steps with hints and the last 100 log lines, secrets masked.               |
| `apps list`, `apps info <app>`                       | Browse the Catalog.                                                                       |
| `apps request <name> [--url URL]`                    | For agents: report an App the Catalog lacks.                                              |
| `feedback [-m text] [--app app]`                     | Send a report to the maintainers after you see the masked text and agree.                 |
| `self-update`                                        | Replace the binary with the latest checksummed release.                                   |

A Compose folder you add by hand under `~/.self-host/extra/<name>/` is an Unmanaged app: it gets lifecycle, Address listing and Backup, but no Setup.

</details>

## Links: Apps that wire themselves

<p align="center"><img src="docs/assets/readme/links-graph.svg" width="880" alt="Apps that wire themselves. Apps appear and arrows draw between them: Sonarr and Radarr to qBittorrent, Prowlarr to Sonarr and Radarr, Seerr to Jellyfin, Sonarr and Radarr, Cleanuparr to Sonarr, Radarr and qBittorrent, and Homarr to a row of tiles for the other Apps."></p>

Every App gets headless Setup, and Links connect them: Sonarr and Radarr get qBittorrent, Seerr gets Jellyfin, Homarr gets native tiles.

<details>
<summary><b>Which Apps link to which</b></summary>

Each App gets automatic, headless Setup (accounts, API keys, settings). A **Link** is the part that connects one App to another. It belongs to the consuming App and runs once both have finished Setup.

| Consumer       | Linked to                                         |
| -------------- | ------------------------------------------------- |
| Sonarr, Radarr | qBittorrent (download client)                     |
| Prowlarr       | Sonarr, Radarr                                    |
| Seerr          | Jellyfin, Sonarr, Radarr                          |
| Cleanuparr     | Sonarr, Radarr, qBittorrent                       |
| Homarr         | native tiles and widgets for the Apps it supports |

A failing Link marks the consuming App as needing attention, not its target. Browser-only steps are reported as **Manual steps** with a hint and stay retryable: `self-host setup <app>`. Homarr Links need Homarr **2.4.1** or newer; NZBGet and SABnzbd Links need **2.5.1** or **2.5.2**. Other versions stop with a recovery hint (back up first). See the [Homarr contracts](docs/homarr-integration-contract.md) and [proof](docs/homarr-proof.md).

</details>

## Platforms and support

<details>
<summary><b>Requirements, validated platforms and the runtime matrix</b></summary>

You need Docker with the `docker compose` v2 plugin (with `include` support), write access to the Project and data folders, free published ports, and enough storage and RAM for the Apps. Start with one App; photos, AI and multi-App Recipes need more. Run `self-host doctor` first.

| Platform       | Binary       | Validation                                                             |
| -------------- | ------------ | ---------------------------------------------------------------------- |
| Linux amd64    | Yes          | Published install/update and clean Alpine bootstrap passed.            |
| Linux arm64    | Yes          | Native CLI and archive checks passed; image support varies by App.     |
| macOS arm64    | Yes          | Native checks passed; deployment needs a Linux Docker VM.              |
| Intel macOS    | Yes          | Native execution, checksummed install and corruption rejection passed. |
| WSL2           | Linux binary | Planned; native WSL validation pending.                                |
| Native Windows | No           | Unsupported.                                                           |

The [runtime matrix](docs/runtime-matrix.md) ([JSON](docs/runtime-matrix.json)) covers 113 targets, a 2026-10-07 snapshot pending the launch runs:

| Result                     | Count | Notes                                                                                    |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| Pass                       | 97    | Each result belongs to its recorded head, binary, image IDs and platform.                |
| Fail on the test host      | 3     | BookStack, Speedtest Tracker, Passbolt ([PHP-FPM evidence](docs/php-fpm-host-limit.md)). |
| Await external credentials | 8     | Provider accounts, VPN credentials, tunnel enrollment and licenses stay owner-supplied.  |
| Manual                     | 5     | Dockge, Emby, Stalwart, Uptime Kuma and the monitoring Recipe.                           |

Published-asset install/update proof covers Linux amd64 only ([scope](docs/release-proof.md)).

Docker socket denied? Run `sudo "$(command -v self-host)"`. The Project, config and cache stay yours. Rootless Docker also works.

</details>

## Troubleshooting

<details>
<summary><b>Common fixes</b></summary>

| Symptom                                       | Fix                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `self-host: command not found`                | Add `~/.local/bin` to `PATH`.                                               |
| Docker missing or stopped                     | Install or start it, then `self-host doctor`.                               |
| 403 rate limit on install                     | `SELF_HOST_GITHUB_TOKEN="$(gh auth token)"` before `bash`, or wait an hour. |
| `curl` error but the command seems to succeed | A pipe hides curl's exit status; use `set -o pipefail` in scripts.          |
| Native Windows                                | Unsupported. Use WSL2.                                                      |

More in the [troubleshooting docs](https://self-host.fyi/docs/troubleshooting).

</details>

## Responsible use

> [!WARNING]
> self-host installs and connects software; what you do with it is your responsibility. Download clients, indexers and media automation have legitimate uses: Linux ISOs, public-domain and Creative Commons works, and media you own or are licensed to copy. **We do not condone piracy and do not help anyone find or download content they have no right to.** self-host ships no indexers, trackers or content sources. Follow copyright law where you live and the terms of every service you connect.

The software is provided as is, without warranty (Apache-2.0). The maintainers are not liable for how it is used.

## Telemetry

Anonymous, on by default, and easy to turn off.

<details>
<summary><b>What is sent, what is not, and how to turn it off</b></summary>

| Sent                                                                        | Never sent                                 |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| A summary when you approve Onboarding's plan (your choices, not your data). | Host names, file paths or typed input.     |
| Errors: which command failed, which step, and where in the code.            | Secrets, App data or raw error text.       |
| The name of an App an agent asks for that the Catalog lacks.                | IP addresses or locations.                 |
| Feedback you wrote, only after you see the text and agree.                  | An ID that identifies you or your machine. |

Nothing is stored to link one run to another. The maintainers use it to see which Apps people install and where Setup breaks. It is never sold or shared.

To turn it off, set `SELF_HOST_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`. The full list is on the [telemetry page](https://self-host.fyi/telemetry).

</details>

## Community and support

- [Discord](https://discord.gg/aCsmEV5RgA): questions and show and tell.
- [GitHub Issues](https://github.com/ajnart/self-host/issues): bugs and App requests.
- Support the work: [GitHub Sponsors](https://github.com/sponsors/ajnart) · [Ko-fi](https://ko-fi.com/ajnart).
- Contributing: read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CONTEXT.md`](CONTEXT.md), open an issue first, then send a pull request.
- New to self-hosting? [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted).
