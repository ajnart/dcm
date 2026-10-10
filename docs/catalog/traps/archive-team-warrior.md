# ArchiveTeam Warrior traps

## Pitfalls

- It runs externally assigned archival workloads and is not a backup or personal web archive.
- The exact publisher digest is a valid immutable image pin; the version label 20260917.01 is not a registry tag and must not be fabricated as one. The verified image is linux/amd64 only.
- Startup environment variables seed config.json only when it cannot be loaded; later restarts can ignore changed values. A corrupt config can trigger reseeding, so recovery is not a credential-rotation contract. A reachable UI or live container does not prove an approved project is running or uploads have completed.
- HTTP_USERNAME and HTTP_PASSWORD protect the control interface with HTTP authentication; they do not create a local administrator account or durable API key. No API-key provisioning contract was established.
- Read-only OCI inspection on 2026-10-03 verified immutable manifest/config, compressed layer SHA-256, and later-layer overlays/whiteouts. run-warrior3 imports seesaw.script.run_warrior; final library-copy layer direct_url.json pins seesaw bb6673d27a8717e13efe5d7deb3628349cd08585 and six runtime source files byte-match that revision. Earlier reviewed seesaw 699b0d2 is not the installed revision. The unpinned clone's installed warrior-code2 Git ref is 465aa2223a9d6d863f3e8ff173eaf8bfb5fbd0d5; labels alone would not establish either dependency.
- The publisher healthcheck reads /index.html on port 8001; it proves only that the web frontend responds. Projects and seeded config.json live in the container's Warrior projects directory; retain only reviewed project-owned storage, and do not mistake temporary downloads for an archive or backup.
- The Go CLI materializes image-provided download helpers as regular executables in its data bind, migrating only the known `wget-at -> /usr/local/bin/wget-lua` link. Existing regular/custom helpers are retained. Unknown outside links remain rejected by backup; the idle fixture does not establish archival-workload recovery.
- The shared recipe supports only explicitly selected idle mode: nickname, selected_project=none, concurrency=1, HQ registration/update traffic, CPU 1 and memory 512 MiB. The owner requires private writable UID-1000 configuration and exact resume validation before controlled start. No disk quota, HQ bandwidth cap or network destination firewall is implemented. Archival workload approval and acceptance remain separate and unsupported; idle readiness is not zero external work.
- The current manual-job contract permits fixed publisher version probes only for restic, Borgmatic and Renovate. No pinned canonical Warrior probe with verified image provenance was established; overriding its entrypoint with an arbitrary no-op would neither verify its runner nor configure the cataloged archival workload.

## Security

- The container actively downloads and uploads Archive Team work; require explicit consent to the selected project, outbound traffic, resource use, and destination policy before start.
- SELECTED_PROJECT=none is not an offline bootstrap: the upstream runner registers and sends updates to Warrior HQ during startup. Approve those external writes separately, or establish and verify an inert bootstrap with fail-closed egress before normal shared apply.
- Keep the port 8001 web control interface private. Configure its documented HTTP_USERNAME and HTTP_PASSWORD together before exposing it to other users; do not assume it has an administrator account by default.
- Do not include the recommended Watchtower Docker-socket mount in a shared Compose project. Review image updates as a separate scoped action.
