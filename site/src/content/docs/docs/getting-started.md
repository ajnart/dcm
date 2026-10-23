---
title: Getting started
description: Install self-host on Linux, macOS or WSL, check the machine with doctor, and go through Onboarding to the Dashboard.
sidebar:
  order: 1
---

<figure>
  <img src="/images/readme/hero-command.svg" width="880" height="240" alt="The self-host install command connected to Jellyfin, Sonarr, Radarr, Immich, Nextcloud, Homarr, Vaultwarden, Navidrome and Home Assistant." />
  <figcaption>The installer adds only the binary. Run self-host afterward to choose Apps and approve the plan before anything is deployed.</figcaption>
</figure>

## Requirements

- Docker engine with the `docker compose` v2 plugin, with `include` support.
- Linux or macOS, amd64 or arm64. On Windows, use the Linux binary inside WSL2; native Windows is unsupported. See [what has been verified](#what-has-been-verified).
- Write access to the Project and data folders, free published ports, and enough storage and RAM for the Apps. Start with one App; photos, AI and multi-App Recipes need more.

No Node.js, checkout or AI account is needed.

## What has been verified

Each status is a dated launch run on a real host or VM, linked to its issue. Nothing else counts.

| Platform                     | Status                          | Run                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux amd64                  | Verified 2026-10-14             | Ubuntu 24.04, Debian 12 and 13 VMs. Install and `self-update` ([#497](https://github.com/ajnart/self-host/issues/497)); Onboarding, the Media Recipe with Homarr, Links, Backup and Restore ([#499](https://github.com/ajnart/self-host/issues/499)). |
| Linux amd64, Docker denied   | Verified 2026-10-14             | `sudo "$(command -v self-host)"` installs the Media Recipe and the Project stays yours ([#498](https://github.com/ajnart/self-host/issues/498)).                                                                                                      |
| Linux amd64, rootless Docker | Verified 2026-10-14             | Debian 13: a Recipe installs, and Easy names open from a second machine ([#500](https://github.com/ajnart/self-host/issues/500)).                                                                                                                     |
| Linux arm64                  | Verified 2026-10-14             | Debian 12 VM: install and one Recipe ([#501](https://github.com/ajnart/self-host/issues/501)).                                                                                                                                                        |
| macOS arm64 with OrbStack    | Verified 2026-10-17             | v0.5.11, Photos and cloud files Recipe, Home network Access ([#502](https://github.com/ajnart/self-host/issues/502)).                                                                                                                                 |
| macOS with Docker Desktop    | Not yet verified on a real host | Not run ([#502](https://github.com/ajnart/self-host/issues/502)).                                                                                                                                                                                     |
| Intel macOS                  | Not yet verified on a real host | Not run ([#502](https://github.com/ajnart/self-host/issues/502)).                                                                                                                                                                                     |
| WSL2                         | Not yet verified on a real host | Not run ([#502](https://github.com/ajnart/self-host/issues/502)).                                                                                                                                                                                     |
| Native Windows               | Unsupported                     | Not supported.                                                                                                                                                                                                                                        |

Known issues from these runs, both fixed on main after v0.5.11: a newcomer saw Nextcloud's Homarr credential-recovery inputs and Review listed port 7575 ([#589](https://github.com/ajnart/self-host/issues/589)); removing the last App left its network and `down` refused ([#590](https://github.com/ajnart/self-host/issues/590)). Four Apps that failed on real hosts are hidden from new installs: BookStack, LLDAP, Passbolt and Speedtest Tracker ([#493](https://github.com/ajnart/self-host/issues/493)).

## Install

```bash
curl -fsSL https://self-host.fyi/install | bash
# or: wget -qO- https://self-host.fyi/install | bash
export PATH="$HOME/.local/bin:$PATH"
self-host doctor
```

That is the recommended way. It picks the highest stable release, verifies the archive against `checksums.txt`, and installs to `~/.local/bin` (`/usr/local/bin` as root). It prints the exact `PATH` line for bash, zsh or fish when needed. A truncated download installs nothing.

Every other method below installs the same release binary, byte for byte. Then let your AI agents find self-host:

```bash
self-host skill install   # writes the self-host skill for Claude Code, Codex, OpenCode, Pi, Gemini and ~/.agents
```

<details>
<summary><b>Homebrew</b> (macOS and Linux)</summary>

```bash
brew install ajnart/tap/self-host
```

Update with `brew upgrade self-host`.

</details>

<details>
<summary><b>Docker</b> (nothing installed on the host)</summary>

The image holds the binary, the Docker CLI and the Compose plugin. It drives your host's Docker through the socket, which is the same trust as running self-host yourself. Mount the Home folder at the same path, because Compose resolves folders on the host.

```bash
# Linux
docker run --rm -it --network host \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.self-host:$HOME/.self-host" \
  -e USER -e HOME -e SELF_HOST_HOME="$HOME/.self-host" \
  ghcr.io/ajnart/self-host:latest

# macOS (OrbStack or Docker Desktop): the container cannot see your LAN address, so pass it
docker run --rm -it \
  --user "$(id -u):$(id -g)" --group-add 0 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.self-host:$HOME/.self-host" \
  -e USER -e HOME -e SELF_HOST_HOME="$HOME/.self-host" \
  -e SELF_HOST_LAN_IP="$(ipconfig getifaddr en0)" \
  ghcr.io/ajnart/self-host:latest
```

No arguments opens the Dashboard; add any command (`doctor`, `install jellyfin`, `status`) after the image name. Update with `docker pull ghcr.io/ajnart/self-host:latest`.

</details>

<details>
<summary><b>Debian, Ubuntu, Fedora, Alpine</b> (.deb, .rpm, .apk)</summary>

Download the package for your architecture (`amd64` or `arm64`) from [GitHub Releases](https://github.com/ajnart/self-host/releases/latest):

```bash
sudo apt install ./self-host_X.Y.Z_linux_amd64.deb                    # Debian, Ubuntu
sudo dnf install ./self-host_X.Y.Z_linux_amd64.rpm                    # Fedora, RHEL
sudo apk add --allow-untrusted ./self-host_X.Y.Z_linux_amd64.apk      # Alpine
```

They install `/usr/bin/self-host` and recommend Docker. Update by installing the newer package.

</details>

<details>
<summary><b>Arch Linux and Omarchy</b></summary>

```bash
sudo pacman -U ./self-host_X.Y.Z_linux_amd64.pkg.tar.zst   # from GitHub Releases
```

Or build it the way the AUR would, from the `PKGBUILD` attached to each release:

```bash
curl -fsSLO https://github.com/ajnart/self-host/releases/latest/download/PKGBUILD
makepkg -si
```

`self-host-bin` is not on the AUR yet: AUR account registration is closed for now. It will be published there as soon as it reopens.

On Omarchy, Docker needs `sudo` by default (your user is not in the `docker` group). Either run `sudo self-host` (the Project stays yours) or turn on sudoless Docker with `omarchy-setup-security-sudoless-docker` and reboot. Omarchy also enables `ufw` with incoming traffic denied; if another device cannot reach an App, allow its port with `sudo ufw allow <port>/tcp`.

</details>

<details>
<summary><b>Release archive</b> (manual download)</summary>

Pick `self-host_<version>_<os>_<arch>.tar.gz` for `linux` or `darwin`, `amd64` or `arm64` from [GitHub Releases](https://github.com/ajnart/self-host/releases).

```bash
VERSION=X.Y.Z   # set to the latest release (no leading v): https://github.com/ajnart/self-host/releases/latest
OS=linux        # or darwin
ARCH=amd64      # or arm64
BASE=https://github.com/ajnart/self-host/releases/download/v$VERSION
ARCHIVE=self-host_${VERSION}_${OS}_${ARCH}.tar.gz

curl -fsSLO $BASE/$ARCHIVE
curl -fsSLO $BASE/checksums.txt
sha256sum -c --ignore-missing checksums.txt        # Linux
# grep " $ARCHIVE\$" checksums.txt | shasum -a 256 -c -   # macOS

tar -xzf $ARCHIVE self-host
mkdir -p ~/.local/bin && mv self-host ~/.local/bin/
```

Do not run the binary if the checksum check fails.

</details>

<details>
<summary><b>Install script options</b> (version, folder, read it first)</summary>

| Variable                 | Effect                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `SELF_HOST_VERSION`      | Install `X.Y.Z` or `vX.Y.Z` instead of the latest.                                      |
| `SELF_HOST_INSTALL_DIR`  | Install here instead of the default directory.                                          |
| `SELF_HOST_RELEASE_REPO` | `owner/name` that publishes releases; also used by `self-update`. For forks.            |
| `SELF_HOST_GITHUB_TOKEN` | Lifts GitHub's anonymous API rate limit; falls back to `gh auth token`. Never paste it. |

Read it before you run it, and check the published hash:

```bash
curl -fsSL https://self-host.fyi/install -o install.sh
curl -fsSL https://self-host.fyi/install.sh.sha256   # compare with: shasum -a 256 install.sh
less install.sh && bash install.sh
```

</details>

<details>
<summary><b>Go / from source</b></summary>

Needs Go 1.26.0+.

```bash
go install github.com/ajnart/self-host/cmd/self-host@latest
# or
git clone https://github.com/ajnart/self-host && cd self-host
go build -buildvcs=false -o ~/.local/bin/self-host ./cmd/self-host
```

Development builds cannot `self-update`.

</details>

## Check the machine

```bash
self-host doctor
```

Without a Project, `doctor` checks that Docker is installed, that the engine answers, that the Compose v2 plugin is there, and whether Docker is rootless. It exits `1` when any check fails, and each failing check says how to fix it. See [Troubleshooting](/docs/troubleshooting) for a denied Docker socket.

## Onboarding

On a machine with no Project, bare `self-host` opens Onboarding, the setup wizard you see the first time you run it. It starts with the Intro while Doctor checks this machine, then asks one thing at a time in seven steps:

1. **Welcome**: whether this is all new to you or you have done it before.
2. **What**: the Apps you want to run, or a Recipe, a ready-made set of Apps that work together. You can add more later from the Catalog.
3. **Where**: this computer's address on your network, the settings your Apps share and where they keep their files.
4. **Access**: how phones, TVs and laptops will open your Apps. Home network needs nothing to set up; see [Access](/docs/access).
5. **Who**: one Admin login signs in to every App. Choose a password, or leave it empty and self-host generates a strong one, which `self-host credentials` shows later.
6. **Look**: draw icons with a Nerd Font, or with plain symbols every font has.
7. **Review**: the whole plan. Review checks free space in the Home folder and the selected Apps' ports before you approve.

Onboarding writes nothing until you approve Review. Pre-boot then plays while the first install pulls its images, and Onboarding hands over to the Dashboard.

Telemetry is announced on Welcome with a link to [the telemetry page](/telemetry). Turn it off with `SELF_HOST_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`.

## Without Onboarding

Install Apps or a Recipe straight from the command line, then open the Dashboard:

```bash
self-host apps list
self-host apps info jellyfin
self-host install media homarr
self-host
```

Without a terminal, `install` refuses unless you pass `--yes`. For a new Project, `--exposure`, `--easy-names`, `--media-root`, `--downloads-root` and `--admin-user` set the same choices Onboarding asks about. The Admin password comes from `SELF_HOST_ADMIN_PASSWORD` or is generated.

## The Dashboard

With a Project, `self-host` opens the Dashboard: Overview, Apps, Activity, Catalog and Settings. `?` lists the keys. No single key changes an App: `a` opens the Action menu for the selected App (`A` for the Project), which shows what each Action will do and runs it only on `enter`. Destructive Actions need a second `enter`.

On start, when it is idle, the Dashboard asks once about what it found: a changed network (switch the LAN address and recreate the Apps that use it), stopped Apps (start the Project) and App updates (update them). `y` runs that Action in the background; `n` leaves things as they are.

`SELF_HOST_REDUCED_MOTION=1 self-host` skips the decorative transitions. Plain commands, non-TTY output and `--json` never animate.

## Where things live

Everything self-host knows on a host lives in the Home folder, `~/.self-host`: the Project, its Apps' files, Unmanaged apps under `extra/`, and the Profile. `SELF_HOST_HOME` moves it. Secrets live only in the Project's `secrets.env`; read them with `self-host credentials`.

## Share your setup

```bash
self-host share
```

It prints two lines to post: `self-host install <ids>` for the Catalog Apps in the Project, and a self-host.fyi link that opens the Apps picker with the same Apps selected. It never includes Unmanaged apps, Addresses, host names or secrets.

## Update

```bash
self-host self-update
```

It replaces the binary after checking its sha256. The Dashboard asks "Update now? y/n" once when idle; `n` is remembered for that release. Plain commands print one line at most every 24 hours, and nothing under `--json`, off a terminal, with `CI` set, on development builds or with `SELF_HOST_NO_UPDATE_CHECK=1`.
