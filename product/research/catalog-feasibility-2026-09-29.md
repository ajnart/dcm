# Compose-only catalog scope — 2026-09-29

The original 112 app records were not 112 installers. Five had bounded
new-install recipes; the other 107 were disabled in the TUI picker. That
number was **picker coverage**, not the catalog's `discovery` support label.

The catalog now has 95 entries: 90 containerized services and five
Compose-capable workloads (`archive-team-warrior`, `borgmatic`, `renovate`,
`restic`, `vector`). Seventeen records were removed from app selection:

- Host/platform/protocol: `docker`, `kubernetes`, `openmediavault`,
  `opnsense`, `proxmox`, `proxmox-backup-server`, `synology`, `truenas`,
  `unraid`, `wireguard`.
- External/format/client: `anchor`, `ical`, `anytype`, `obsidian`.
- Retired or superseded: `jellyseerr`, `overseerr`, `readarr`.

Update 2026-09-30: UniFi Network was also removed from app selection after
current vendor guidance established a host installer rather than a supported
Compose topology. The current catalog has 94 entries. The Homarr integration
registry still records `unifiController` as external-only, not an installable
Compose app; current in-catalog coverage is 42 of 43 standard integrations.

The host runtime is a prerequisite, not a selectable app. Removed host/platform
records are not offered through another installer in this product. Anytype's client is
not its self-hosted AnySync backend; a future backend offering needs a
separate name and recipe. Seerr remains the successor to Jellyseerr and
Overseerr; their migration details stay in research. Homarr's Docker and
Kubernetes integration support is not denied by their removal: this app
catalog intentionally tracks only integration surfaces for Compose-installable
apps. The checked 95-entry catalog has 43 matched Homarr integrations.

The 89 remaining entries without bounded install routes are **not yet
installable**. They include 84 services and five workloads. Gotify, Jellyfin,
Seerr, SABnzbd, Sonarr, Radarr, and qBittorrent have inspect-only standalone
recipes, but no standalone CLI apply route or complete live proof. Their
first-run sidecars can run under the experimental shared Compose owner;
Seerr's sidecar currently stops after Jellyfin library readback, before Arr
links, initialization, and restart acceptance.
Restic and Borgmatic remain catalogued only as Compose workloads: [Restic's
installation guide](https://restic.readthedocs.io/en/latest/020_installation.html)
and [Borgmatic's installation guide](https://torsion.org/borgmatic/how-to/install-borgmatic/)
document container images, but their manifests still require version and
restore validation before an install route can be offered. The catalog schema
no longer accepts a non-container image classification.
Container feasibility is not first-run support. Each promotion needs an image/version check, a typed Compose
recipe, deterministic account/API setup or an explicit no-account contract,
private credential handoff, functional acceptance, restart/resume behavior,
and optional Homarr readback. The five workloads need job/agent semantics,
not a pretend interactive app login. Host-device, Docker-daemon, DNS/edge,
mail-domain, and VPN capabilities remain separate explicit gates; a generic
recipe must not grant privileged containers or a Docker socket to make them
pass.

Version-sensitive lifecycle facts need refresh: 87 of the surviving 90
non-recipe entries were last checked on 2026-08-28. The two research batches
in [media-migration.md](media-migration.md) and
[utility-migration.md](utility-migration.md) identify reusable setup routes and
blockers; neither is a deployment proof. The current single-project compiler
and selected-add lifecycle primitive are documented in
[shared-compose-migration.md](../shared-compose-migration.md), but the TUI
still installs each bounded recipe as its own project.

Primary boundaries: [Docker Compose services](https://docs.docker.com/reference/compose-file/services/),
[networks](https://docs.docker.com/reference/compose-file/networks/), and
[volumes](https://docs.docker.com/reference/compose-file/volumes/);
[AnySync backend Compose source](https://github.com/anyproto/any-sync-dockercompose);
[Seerr migration](https://docs.seerr.dev/migration-guide/);
[archived Readarr repository](https://github.com/Readarr/Readarr).
