---
title: Getting started
description: Install self-host on Linux, macOS or WSL, check the machine with doctor, and go through Onboarding to the Dashboard.
sidebar:
  order: 1
---

## Requirements

- Docker engine with the `docker compose` v2 plugin, with `include` support.
- Linux or macOS, amd64 or arm64. On Windows, use the Linux binary inside WSL; native Windows is unsupported.
- Write access to the Project and data folders, free published ports, and enough storage and RAM for the Apps. Start with one App; photos, AI and multi-App Recipes need more.

No Node.js, checkout or AI account is needed.

## Install

```bash
curl -fsSL https://self-host.fyi/install | bash
# or: wget -qO- https://self-host.fyi/install | bash
export PATH="$HOME/.local/bin:$PATH"
self-host doctor
```

The script picks the highest stable release, verifies the archive against `checksums.txt`, and installs to `~/.local/bin` (`/usr/local/bin` as root). It prints the exact `PATH` line for bash, zsh or fish when needed. A truncated download installs nothing. Installing the binary deploys nothing.

| Variable                 | Effect                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `SELF_HOST_VERSION`      | Install `X.Y.Z`, `vX.Y.Z` or `new-cli-vX.Y.Z` instead of the latest.                    |
| `SELF_HOST_INSTALL_DIR`  | Install here instead of the default directory.                                          |
| `SELF_HOST_RELEASE_REPO` | `owner/name` that publishes releases; also used by `self-update`. For forks.            |
| `SELF_HOST_GITHUB_TOKEN` | Lifts GitHub's anonymous API rate limit; falls back to `gh auth token`. Never paste it. |

Read it before you run it, and check the published hash:

```bash
curl -fsSL https://self-host.fyi/install -o install.sh
curl -fsSL https://self-host.fyi/install.sh.sha256   # compare with: shasum -a 256 install.sh
less install.sh && bash install.sh
```

### Arch Linux (AUR)

```bash
yay -S self-host-bin
```

Update it with your AUR helper.

### Release archive

Pick `self-host_<version>_<os>_<arch>.tar.gz` for `linux` or `darwin`, `amd64` or `arm64` from [GitHub Releases](https://github.com/ajnart/self-host/releases), check it against `checksums.txt`, and put the `self-host` binary in `~/.local/bin`. Do not run the binary if the checksum check fails.

### From source

Needs Go 1.26.0 or newer. Development builds cannot `self-update`.

```bash
git clone https://github.com/ajnart/self-host && cd self-host
go build -buildvcs=false -o ~/.local/bin/self-host ./cmd/self-host
```

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
