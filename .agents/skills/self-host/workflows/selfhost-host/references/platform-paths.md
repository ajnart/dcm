# Platform paths and identities

Use logical paths in plans and map them to host paths only after inspection. Keep `config`, `data`, `media`, `downloads`, `cache`, and `backup` distinct. A recommended path is derived, not approved.

## macOS and Mac mini

- Runtime boundary: Docker Desktop's Linux VM.
- Suggested config root: `~/Library/Application Support/selfhost`.
- Suggested user-data root: `~/Selfhost`; explicitly share only required bind paths with Docker Desktop.
- Keep databases and high-churn caches in named volumes inside the VM when practical.
- Identity: Docker Desktop-mediated ownership. Still inspect application image support for numeric UID/GID and arm64 manifests.
- Gates: Docker Desktop resource limits, file-sharing permission, case sensitivity, sleep/restart behavior, and whether the machine is expected to provide 24/7 service.

Do not expand `~` and persist it silently. Resolve the path only after the user confirms the owning account.

## Linux server

- Runtime boundary: Docker Engine plus the Compose plugin; explicitly choose rootful or rootless.
- Suggested roots: `/srv/selfhost/config`, `/srv/selfhost/data`, `/srv/selfhost/media`, `/srv/selfhost/downloads`, and a backup destination in another failure domain.
- Identity: explicit numeric service UID/GID and a dedicated group when image behavior supports it. Validate access as the service identity; never blanket `chmod 777`.
- Rootless gates: `newuidmap`, `newgidmap`, subordinate UID/GID ranges, local storage for the daemon, and user-service linger where required.
- Exposure gate: Docker-published ports can bypass simplistic UFW/firewalld assumptions. A later networking skill must verify the effective firewall and `DOCKER-USER` or nftables policy.

## VPS

Use the Linux path and identity model. `vps` is normally chosen context, not an observable OS fact.

Before deployment, require an explicit local or SSH Docker context, provider and host firewalls, an administrative recovery path, backup destination, DNS ownership, one ingress owner for 80/443, TLS, and an authentication policy. Never expose the Docker API.

## Unraid

- Suggested config root: `/mnt/user/appdata/selfhost`.
- Suggested media and download roots: deliberate user shares such as `/mnt/user/media` and `/mnt/user/downloads`.
- Identity: preserve Unraid share ownership and ACL conventions. Do not replace them with a generic Linux UID recipe or recursive permission rewrite.
- Separate app state from large media. Unraid flash backup is not appdata or user-data backup.
- Confirm share cache/pool behavior, mover implications, image architecture, and write access before apply.

## TrueNAS SCALE

- Create deliberate datasets before application mounts; use templates such as `/mnt/<pool>/apps/selfhost`, `/mnt/<pool>/media`, and `/mnt/<pool>/downloads` only after choosing the pool and dataset layout.
- Identity: map the container's numeric identity to dataset ACLs explicitly. Host UID 1000 is not a portable default.
- Keep application data, media, downloads, and snapshots in separate datasets when lifecycle or retention differs.
- A snapshot is not a second copy. Plan replication or offsite backup and a restore drill.
- Route through the currently supported TrueNAS Custom App/Compose or VM boundary only after checking the installed TrueNAS release.

## Proxmox

- Default boundary: run Docker in a QEMU VM with `/srv/selfhost/...` inside the guest.
- Plan VM storage, bridge/VLAN, guest backups, application-consistent backups, resource limits, and restore separately.
- An LXC with nesting is an explicit exception. Require acceptance of shared-kernel exposure, device mapping, UID/GID translation, live-migration limitations, and backup/restore behavior.
- Do not deploy application containers directly on the Proxmox VE host.

## Cross-platform path gates

- Inspect each candidate without recursion. Before creation, resolve realpaths and reject symlinks escaping the approved root.
- Require downloads and media on the same device/filesystem for hardlinks or atomic moves. If not, disclose copy behavior and capacity impact.
- Treat NFS, SMB/CIFS, SSHFS, and similar mounts as network filesystems. Verify application locking/database support; do not place a rootless Docker data root on NFS.
- Check free bytes and inodes. Capacity thresholds belong to the selected stack, not this generic capability.
- A writable check reflects only the inspecting identity. Re-test as the actual service identity before apply.
- Validate timezone as an IANA zone before persistence.
