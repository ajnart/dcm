---
title: Troubleshooting
description: Fix a broken App or machine with self-host doctor, the Debug report, the Host report, logs and Feedback.
sidebar:
  order: 4
---

Start with three read-only commands: `self-host doctor` for the machine, `self-host status` for every App, and `self-host debug <app>` for one App.

## doctor

```bash
self-host doctor
```

Without a Project it runs the Docker checks and stops at the first failure: `docker` (the CLI is found), `docker-socket` (the engine answers), `compose` (the v2 plugin) and `docker-userns` (rootless detection). With a Project it adds `project-lock`, `project-userns`, `project`, `exposure`, `lan-ip` and `firewall`, and for each App `running`, `binding` and `reachable`, plus `easy-names` while Easy names at home are on. Each failing check has a hint. `doctor` exits `1` when any check fails.

### Docker socket permission denied

Pick one:

- Run with sudo: `sudo "$(command -v self-host)"`. The full path is needed because sudo drops `~/.local/bin`; the Project, config and cache stay yours.
- Use rootless Docker. Some Apps lose low ports, host networking or device access.
- Add yourself to the `docker` group (`sudo usermod -aG docker $USER`, then log out and in). This gives root-equivalent access without a password.

## The Debug report

```bash
self-host debug jellyfin
```

What an agent or a person reads before opening a broken App in a browser: its Status, Addresses, failed and Manual steps with their hints and docs, the last 100 log lines with secrets masked, and what a working page should show. Add `--json` for agents.

A **Manual step** needs a person to finish it in a browser; it keeps its hint and stays retryable. Once it is done, retry Setup. Finished steps are skipped:

```bash
self-host setup jellyfin
```

A failing Link marks the consuming App as needing attention, not its target. For more of the log:

```bash
self-host logs jellyfin --follow --tail 500
```

## The Host report

```bash
self-host host report
self-host host report --extra
```

What this machine looks like, without changing it: OS and architecture, Docker and socket reachability, IPv6, and bind results for ports 80 and 443 on `0.0.0.0`, `127.0.0.1` and `::`. Its port probes are the same checks used before an App or Easy names claims a port. `--extra` also checks resources, connectivity, port 53, filesystem behavior and temporary Docker resources, which are removed before the report ends. Findings never change the command's successful exit status.

## Cannot reach an App from another device

Start with `self-host debug <app>`, `self-host status` and `self-host doctor`, and check the recorded [Access](/docs/access), Docker, published ports and the host firewall.

- This computer only binds `127.0.0.1`. To allow the home network: `self-host config set EXPOSURE=lan`.
- After a network move, `self-host status --json` reports `lan_ip_stale`. Run `self-host config set LAN_IP=auto` or `self-host config review`.
- If it works on the host but not on your phone or TV, check that both are on the same network, guest-network isolation, the firewall and Docker VM forwarding. A check from the host cannot prove a device can reach it.

## Common problems

| Symptom                                       | Fix                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `self-host: command not found`                | Add `~/.local/bin` to `PATH`.                                               |
| Agent guide lacks the New/Advanced paths      | `self-host self-update`.                                                    |
| Docker missing or stopped                     | Install or start it, then `self-host doctor`.                               |
| 403 rate limit on install                     | `SELF_HOST_GITHUB_TOKEN="$(gh auth token)"` before `bash`, or wait an hour. |
| `curl` error but the command seems to succeed | A pipe hides curl's exit status; use `set -o pipefail` in scripts.          |
| Native Windows                                | Unsupported. WSL2 is not yet verified.                                      |

## Feedback

When something breaks that you cannot fix, send the maintainers a report:

```bash
self-host feedback -m "Sonarr Setup fails at download-client after a restart" --app sonarr
```

The CLI masks every known secret, shows the exact text and asks y/n before sending. `--app` adds that App's Status and failed steps with hints, never its logs. The message comes from `--message` (`-m`) or stdin, at most 4096 bytes. Feedback travels with Telemetry: when Telemetry is off it sends nothing and prints how to open a GitHub issue instead.

Bugs and App requests from people go to [GitHub Issues](https://github.com/ajnart/self-host/issues). Questions are welcome on [Discord](https://discord.gg/aCsmEV5RgA).
