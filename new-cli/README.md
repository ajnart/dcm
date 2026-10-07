# self-host CLI

Choose an App. Review its ports and folders. Let `self-host` install it, create
its administrator account where supported, and connect it to the other Apps
in your Project. Come back to the terminal Dashboard to open Apps, check health,
retry Setup, update images, or make a Backup.

One Go binary runs both the terminal interface and plain commands for agents.
Apps share one Docker Compose Project, normally in `~/self-host`. The Catalog,
Setup code and agent guide ship inside the binary; running it needs no Node.js,
Bun, checkout, or AI account.

**Release status:** the Go CLI is being prepared for distribution. Published
`new-cli-vX.Y.Z` assets and an authenticated first install have not yet been
verified. The older npm CLI and agent-plugin releases are separate products;
do not use their versions to select this binary.

## Install

The repository is currently private. With repository access, fetch the installer
using your authenticated GitHub client:

```bash
set +x
gh auth status
gh api --method GET -H 'Accept: application/vnd.github.raw+json' \
  'repos/ajnart/selfhost-skills/contents/new-cli/install.sh?ref=feat/new-cli' \
  > /tmp/self-host-install.sh
SELF_HOST_GITHUB_TOKEN="$(gh auth token)" bash /tmp/self-host-install.sh
```

GitHub CLI must be logged in with access to this repository. The command passes
its stored credential directly to the installer through `SELF_HOST_GITHUB_TOKEN`
with shell tracing disabled. You can instead supply that variable through your
credential provider. Never print or paste its value into commands or reports.
The command above targets the development branch while release work is pending;
it cannot install a binary until a stable CLI release is published.

For public access after publication, the intended install command is:

```bash
curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/new-cli/install.sh | bash
```

The installer selects the highest stable `new-cli-vX.Y.Z` release, verifies the
archive against `checksums.txt`, and installs `self-host` in `~/.local/bin`
(`/usr/local/bin` when run as root). Put the selected directory on `PATH`.
`SELF_HOST_INSTALL_DIR` changes the destination; `SELF_HOST_VERSION` accepts
an existing `X.Y.Z` version or its `new-cli-vX.Y.Z` tag. No specific release
version is promised here.

To work from an authenticated checkout before release:

```bash
cd new-cli
go build -buildvcs=false -o /tmp/self-host ./cmd/self-host
/tmp/self-host --help
```

Source builds require Go 1.26.0 or newer and access to Go module downloads.
Development builds cannot run `self-update`.

## Requirements and platforms

Deployment needs a working Docker engine, the `docker compose` v2 plugin with
Compose `include` support, write access to the Project and data folders, free
published ports, and sufficient storage/RAM for the selected Apps. Start with
one App; photo libraries, AI workloads and multi-App Recipes need more capacity.
Run `self-host doctor` before installation. With rootless Docker, compatible
images may require container `PUID=0 PGID=0`; host filesystem ownership remains
the invoking user. Images with fixed container UIDs need separate handling.

| Platform | Binary target | Current validation |
| --- | --- | --- |
| Linux amd64 | Yes | Native CLI execution, local checksummed install and corruption rejection passed. |
| Linux arm64 | Yes | Same native CLI/install checks passed; image support varies by App. |
| macOS arm64 | Yes | Same native CLI/install checks passed; deployment requires a Linux Docker VM. |
| Intel macOS | Yes | Native CLI execution, local checksummed install and corruption rejection passed. |
| WSL2 | Linux binary inside WSL | Planned path; native WSL validation pending. |
| Native Windows | No | Unsupported. |

[Native CI run 37590881662](https://github.com/ajnart/selfhost-skills/actions/runs/37590881662)
validated CLI execution, local checksummed installation and corruption rejection
on all four native targets at `d1e7e33`. [Earlier CI](https://github.com/ajnart/selfhost-skills/actions/runs/37587841176)
validated source vet/tests at `0c186fa`. Locally served archives do not prove
authenticated GitHub release delivery or Docker/App acceptance. See
[runtime acceptance boundaries](e2e/acceptance.md).

## First App

```bash
self-host doctor
self-host apps info ntfy
self-host install ntfy --exposure local
self-host status
self-host
```

Interactive install reviews Host settings and the selection. The example uses
**this machine only** (`local`); the default is **local network** (`lan`),
which publishes ports on all host interfaces. Review network/firewall scope
before choosing LAN access. Public ingress is a separate decision.

Run `self-host` on a terminal to open the first-install flow or the existing
Dashboard. Use `i` to choose more Apps and `/` to search. A Recipe chooses a
bundle: inspect `self-host apps list`, then install it by ID, for example
`self-host install media`. External accounts, hardware and browser-only setup
remain explicit prerequisites.

| Dashboard key | Action |
| --- | --- |
| ↑/↓ or k/j, tab | Select an App; change its details tab. |
| enter, o | Start/stop the selected App; open its URL. |
| r, u, b | Retry Setup; update images; make a Backup. |
| i, s, d, w | Install picker; Settings; Stack; Workflow. |
| c, ?, q | Copy Admin password; help; quit. |

Settings applies edits with `ctrl+s`; `esc` returns to the Dashboard. Workflow
shows remembered render/pull/start, Setup, Links and checks. Space expands an
App, `/` filters, and enter expands a failed step's error and recovery hint.

## Agents and automation

Run `self-host skill` to get the guide matching the installed binary.
[new-cli/SKILL.md](SKILL.md) is the small agent entry point. This Go guide is
separate from the repository's older bundled self-host skill.

Inspect first, agree on the Apps and Exposure, then apply the approved selection:

```bash
self-host doctor --json
self-host apps list --json
self-host apps info ntfy --json
# After approval:
self-host install ntfy --exposure local --yes --json
self-host status --json
```

Use repeated `--set app.key=value` for documented inputs and
`--set app.port=N` to select a port. `--media-root`, `--downloads-root` and
`--exposure lan|local` set new-Project choices; `--admin-user` defaults to
`admin`. An Admin password is generated unless `SELF_HOST_ADMIN_PASSWORD` is
provided through the environment. Forgejo uses `selfhost-admin` for a fresh
install when the shared username is `admin`; check its App credentials for the
actual login. Do not pass secrets as command arguments.

With `--json`, mutations and `doctor` produce newline-delimited events;
`status`, `apps list`, `apps info` and `credentials` produce JSON documents.
Read each `step.fail` and its hint. Exit codes are `0` for success, `1` for an
error and `2` for incomplete Setup. A failed Setup needs repair and
`self-host setup <app>`; completed steps are skipped. Verify the App's intended
function afterward. A running container or HTTP 200 alone is not acceptance.

`self-host credentials` deliberately reveals the Shared Admin login and per-App API
keys. Use it privately; exclude its output, logs, passwords and API keys from
chat replies, screenshots and ordinary evidence.

## Daily commands

| Command | Effect |
| --- | --- |
| `status [--updates]` | Show URLs, container state, health and Setup; optionally check image updates. |
| `setup [app...]` | Retry unfinished Setup. |
| `start`, `stop`, `restart [app...]` | Operate named Apps, or every installed App when omitted. |
| `update [app...]` | Pull images, recreate Apps and rerun checks. |
| `logs <app> [--follow] [--tail N]` | Read container logs; default tail is 200 lines. |
| `remove <app>... [--yes]` | Remove Apps while keeping data; `--purge` also deletes their data folders. |
| `config set KEY=value...` | Change Host settings and recreate affected Apps. |
| `config review [--yes]` | Review current host drift; `--yes` applies detected LAN IP/time zone fixes. |
| `self-update` | Replace a release binary with the latest stable checksummed CLI release. |

Prefix each with `self-host`. `--verbose` (`-v`) adds command and step details.
Use `--yes` for approved noninteractive install, remove and restore operations;
it is authorization to perform the operation, not a preview flag.

For an isolated Project, set both `SELF_HOST_HOME` to an absolute directory and
`SELF_HOST_COMPOSE_PROJECT` to a unique lowercase Compose name. Keep them
consistent for subsequent commands. Do not point this CLI at an older CLI's
Project as an assumed migration path.

## Cannot reach an App from another device

Start with `self-host status` and `self-host doctor`. Check the recorded
Exposure and URL, Docker availability, published ports, and the host firewall.
`local` binds to loopback. To deliberately allow LAN access:

```bash
self-host config set EXPOSURE=lan
```

After moving networks, `status --json` reports `lan_ip_stale` when the saved
address is gone. Repair it with `self-host config set LAN_IP=auto`, or review
all Host settings using `self-host config review`. These operations recreate
Apps that use changed settings. `config review --yes` applies detected LAN IP
and time zone fixes; ownership IDs and folder changes remain deliberate choices.

If the URL works on the host but fails on your phone/TV, check same-network
connectivity, guest-network isolation, firewall scope and Docker VM forwarding.
A host-side probe cannot prove reachability from that device.

## Backup and Restore

```bash
self-host backup --encrypt
self-host backup ntfy --encrypt --output /absolute/private/ntfy.tar.zst.age
self-host restore /absolute/private/ntfy.tar.zst.age ntfy
```

Provide `SELF_HOST_BACKUP_PASSPHRASE` through your credential provider, or answer
the interactive prompt. Keep the passphrase separately from the archive.
Backup pauses running App services while copying their folders, then starts
those services again. It includes App folders, Host settings, state and secrets;
external media/download libraries and data stored outside App folders are not
included. Even a single-App Backup contains Project credential metadata.

The default destination is `~/self-host/backups/selfhost-DATE.tar.zst`, with
`.age` added for encryption. Restore replaces the selected Apps' current data
and asks for confirmation; `--yes` skips it. A fresh Project requires a full
Backup restore before selective restores are possible. Review Host settings on
a different machine and verify logins, data and the App's actual workload.

Keep another private copy off the host. A written archive is not a verified
recovery plan: perform a restore into an isolated Project and check the data.
The generic acceptance harness checks archive extraction and existing Setup/Check
probes; database-content recovery needs App-specific proof.

## What is supported

The compiled Catalog contains **93 Apps and 20 Recipes** (19 legacy Recipes
plus `media`). These are metadata/implementation counts, not 113 runtime passes.
Real Linux lifecycle runs for ntfy and Vaultwarden passed, including isolated
Restore. Full-Catalog, database-content recovery and other platform Docker
acceptance remain incomplete.

| Capability | Available behavior | Evidence limit |
| --- | --- | --- |
| Catalog install | Compiled Compose definitions and App inputs. | All-catalog runtime acceptance is incomplete. |
| Setup and Links | Per-App API/configuration routines; retry unfinished steps. | Browser-only tasks, external credentials and remote enrollment may need you. |
| Dashboard/Workflow | TUI, persisted stages, retry hints and live progress. | Real terminal/UI evidence must accompany release claims. |
| Lifecycle/update | Project-scoped commands and image refreshes. | Update checks do not establish safe version-to-version migration. |
| Backup/Restore | Compressed archives, optional encryption, selected-App restore. | Archive sentinels do not prove database or workload recovery. |
| Unmanaged Apps | Lifecycle/Backup for manually added Compose App folders. | No compiled Setup for off-Catalog Apps; see `self-host skill`. |
| VPN/public access | App configuration where implemented. | Tunnel-break fail-closed, DNS/TLS and external accounts need their own proof. |

[Acceptance documentation](e2e/acceptance.md) defines lifecycle stages,
per-target outcomes and the limits of generic checks. Manual, blocked,
missing-configuration, awaiting-external-credentials and not-run targets are
reported separately from passes. [The handoff](docs/handoff.md) records older
local results whose temporary artifacts are unavailable in a fresh checkout;
those results do not validate this build or your installed binary.
