# Inspection contract

Use this reference when collecting or interpreting host facts. The bundled probe is intentionally narrower than a full inventory tool.

## Status vocabulary

| State | Meaning |
|---|---|
| `not_installed` | The relevant command is not discoverable on the current `PATH`. It does not prove a containerized or remote service is absent. |
| `installed` | A command exists, but safe evidence of an active service was unavailable or the tool is not a daemon. |
| `not_observable` | The probe could not establish the fact with current access. Common causes include an inactive daemon, remote-context failure, permissions, or a missing platform probe. |
| `running` | A bounded active query succeeded, or a known local service unit/process was observed active. |
| `observed` | A non-liveness collection or value was read successfully. |

Never rewrite `not_observable` as `not_installed`, stopped, empty, safe, or unused.

## Allowed discovery

The probe uses only bounded, allowlisted fields:

- kernel, architecture, selected OS release identifiers, and virtualization type;
- numeric UID, GID, supplementary numeric groups, timezone, and presence of subordinate-ID prerequisites;
- Docker client/server versions, current context name, context names, Compose version, rootless indicator, and limited lists of container name/image/state/status/published ports and network name/driver/scope;
- listening TCP/UDP bind endpoints without owning processes;
- metadata for `/` and explicit `--path` arguments: existence, type, symlink flag, current-user writability, device ID, mount point, filesystem type, network-filesystem and read-only indicators, available bytes, and available inodes;
- installation and safely observable liveness of a fixed set of infrastructure CLIs.

Collection limits are applied before JSON emission. Strings are converted to bounded printable ASCII. Array order comes from the underlying stable CLI order and schema key order is fixed.

## Prohibited discovery

Never add generic environment, label, mount, or config dumps. In particular, do not use:

- `env`, `printenv`, `/proc/*/environ`, `docker inspect`, unredacted `docker info`, or unredacted Compose rendering;
- recursive `find`, home-directory search, filesystem indexing, shell history, `.env*`, `.sessions`, password stores, keychains, browser state, SSH files, VPN configs, or application databases;
- Docker context endpoints, registry auth, proxy URLs, mount source strings, or raw mount options. Endpoints and mount options can contain credentials or identifying data.

The probe discards command stderr. Report the collection as `not_observable`; do not paste a potentially secret-bearing error into evidence.

## Script options

```text
--path PATH              Inspect metadata for an explicit candidate path; repeat up to 8 times.
--platform-hint KIND     User-provided route: macos, linux, vps, unraid,
                         truenas, proxmox-vm, or proxmox-lxc.
--limit N                Items per bounded collection, 1 through 50.
--skip-docker            Do not query Docker even if its CLI exists.
--output FILE            Atomically create a new mode-0600 report; never overwrite.
--help                    Print usage.
```

`--platform-hint` is a chosen input and remains separate from `observedKind`. It is useful for VPS and hypervisor-guest context that cannot be proven from a generic local probe.

## Interpreting existing resources

The inventory is only candidate evidence. Before reuse, a later, explicitly authorized planner must establish:

1. owner/project and lifecycle responsibility;
2. stable service DNS or proxy route rather than a container IP;
3. network and port ownership;
4. who may upgrade, restart, and back up the resource;
5. one of `reuse`, `coexist`, or `conflict`.

Do not claim a reverse proxy from an image or container name alone. Do not attach to an existing Docker network from this skill.

## Persistence

Safe preference candidates include logical path mappings, numeric UID/GID when confirmed, IANA timezone, Docker context name, platform kind, ingress class, backup cadence, and an external resource owner. Never persist a password, API key, private key, tunnel token, cookie, raw connection string, generated encryption key, or secret payload. Persist only a secret reference through a separate secret-boundary capability.
