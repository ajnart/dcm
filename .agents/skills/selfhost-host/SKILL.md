---
name: selfhost-host
description: Inspect and plan a self-hosting host without mutation. Use before deployment, migration, or troubleshooting to identify the platform, Docker context, bounded containers and networks, listeners, filesystems, numeric identity, or safe paths across macOS, Linux, Unraid, TrueNAS SCALE, and Proxmox. Return redacted facts and non-secret recommendations only.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires POSIX shell tooling on macOS or Linux; Docker inspection is optional and remains read-only.
---

# Self-host host

Inspect first, then turn facts into a host plan. Keep observed facts separate from user choices and derived recommendations. Treat `not_observable` as uncertainty, never as absence.

## Workflow

1. Establish the target. Default to the local host. Use a remote shell or Docker context only when the user explicitly identifies it; do not guess a host or context.
2. Read [inspection-contract.md](references/inspection-contract.md). Run `scripts/inspect-host.sh` without `--output` unless the user asked to persist a report. Pass only candidate paths that are already in scope.
3. Read [platform-paths.md](references/platform-paths.md) when recommending storage, runtime placement, UID/GID, ACL, timezone, or a Proxmox boundary.
4. Classify each relevant item as `observed`, `chosen`, or `derived`. Record existing resources as `reuse`, `coexist`, or `conflict`; do not silently take ownership.
5. Ask only for choices that materially change safety or topology: target host/context, platform hint when it cannot be observed, path roots, numeric service identity or platform ACL owner, backup destination, and whether Proxmox LXC tradeoffs are accepted.
6. Return the contract below. Stop at a plan unless another explicitly selected skill and the user authorize changes.

## Run the probe

Resolve the script relative to this `SKILL.md`; do not assume the repository is the current directory.

```bash
bash <skill-directory>/scripts/inspect-host.sh
bash <skill-directory>/scripts/inspect-host.sh --platform-hint vps --path /srv/selfhost
bash <skill-directory>/scripts/inspect-host.sh --path /mnt/user/appdata --path /mnt/user/media
```

The probe writes JSON to stdout. `--output FILE` creates a new private file atomically and refuses to replace an existing path or symlink. Use `--skip-docker` when daemon access is out of scope. Use `--limit` only to lower or raise collection bounds within the script's hard cap.

Never run the probe through `sudo`. A permission failure is evidence that a fact is not observable to the current identity. Do not widen permissions merely to complete discovery.

## Safety boundary

This skill is read-only except for an explicitly requested `--output` file. It must not:

- call `env`, `printenv`, `docker inspect`, `docker compose config`, or APIs that return container environment, labels, mount credentials, tunnel tokens, or application configuration;
- read `.env*`, `.sessions`, Compose secret files, credential stores, SSH material, VPN configuration, cookies, arbitrary home-directory files, or recursive directory trees;
- start, stop, install, update, expose, or reconfigure anything;
- infer that a missing CLI means its containerized service is absent;
- recommend `chmod 777`, a host Docker socket mount, a floating container IP, or a Proxmox LXC as the unqualified default.

Inspect explicit path metadata only. Before a later mutation, another capability must re-check realpaths, symlink escape, mount ownership, free space, service-level write access, and the approved root.

## Decision rules

- Docker CLI absent: `not_installed`. Docker CLI present but daemon/context inaccessible: `not_observable`. Successful daemon query: `running`.
- Optional CLI present without a safely observable active service: `installed`, not `running`.
- A VPS generally looks like Linux. Use `--platform-hint vps` only from user-provided context; do not infer VPS status from an IP or hostname.
- On macOS, prefer named volumes for databases and caches inside Docker Desktop's VM; bind only deliberate user data paths shared with Docker Desktop.
- On Unraid and TrueNAS, preserve the platform share/dataset ACL model. Image-specific `PUID`/`PGID` variables are conventions, not Docker standards.
- On a Proxmox host, recommend Docker inside a QEMU VM. Treat nested LXC as a chosen exception and surface host-kernel, migration, device, and backup tradeoffs.
- For media automation, require downloads and media on the same filesystem when hardlinks or atomic moves are desired, and use one consistent container path such as `/data`.
- A backup root on the same disk or pool is staging, not an independent backup.

## Result contract

Return the typed result from [inspection-contract.md](references/inspection-contract.md)
plus a concise Markdown summary. Include the probe's JSON path only when the
user requested one.

Do not copy the full bounded container or listener inventory into prose. Highlight only facts that affect the requested stack. Do not persist host facts as preferences until the user confirms them.

## Completion criteria

Inspection is complete when the target and Docker context are unambiguous; unknowns remain explicitly `not_observable`; candidate path and identity recommendations cite their platform rationale; conflicts and reusable resources have owners; no secret value was requested or emitted; and every remaining high-impact choice appears under `decisionsNeeded`.
