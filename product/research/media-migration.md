# Media and download catalog migration

Reviewed 2026-09-29. This is a source-backed inventory and implementation
sequence, not a deployment or acceptance claim. It began with 26 media/download
records; Anchor, Readarr, Jellyseerr, and Overseerr were later removed from the
Compose-only app catalog. Their rows below are historical migration context,
not install options. No app manifest, recipe,
setup module, app registration, Compose file, or running service was changed for
this report. Shared recipe/Compose/CLI contract changes are present separately
in the current tree and are called out below.

## Decision

Do not promote another app by adding `recipe.json` and `setup.ts` alone. The
original audit saw five validated recipes. The current catalog has thirteen:
Prowlarr has a bounded experimental route, while Sonarr, Radarr, qBittorrent,
Jellyfin, Seerr, and SABnzbd have inspect-only media/download recipes. Seerr and
SABnzbd still lack app setup adapters. The seven-service media harness is a
separate fixed stack with its own Compose file and scripts, not a composable
catalog-app route. This matches the picker contract in
[`per-app-setup-contract.md`](../per-app-setup-contract.md); no Docker or host
mutation was performed for this catalog audit.

The setup-engine boundary is
[`setup-engine.ts`](../../packages/cli/src/control-panel/setup-engine.ts). The
inspected baseline statically imported and mapped only Homarr, Immich,
Paperless-ngx, Uptime Kuma, and Prowlarr. Current code now loads a bounded
app-folder `setup.js` (or Bun `setup.ts`) dynamically, so that
static allowlist is no longer the blocker. It does not create setup adapters for
the other media apps, add app-scoped media adapters to the skill registry, or
provide app-level apply/lifecycle acceptance. The existing `selfhost-media`
adapter remains stack-scoped and cannot be an app's `adapterSkill`. The catalog
contract says recipes are candidates, not automation promotion, and
`guided -> managed` still needs an application-scoped adapter with evidence.
The current implementation also adds a pure shared-project candidate compiler
and Compose network aliases, but no shared-project deploy/apply route or
persisted per-app state yet. Thus a recipe/setup sidecar alone would still
overstate support.

Keep current app projects separate. A new shared project must be an explicit
selection and exact-project apply; detect old projects and offer a reviewed
backup/migration plan rather than attaching or converting them implicitly.

## Reusable contract and missing seams

| Concern | Current contract | Required next seam |
| --- | --- | --- |
| App selection and project ownership | A bundled recipe is keyed by one `appId`. The current picker installs recipe apps as independent saved jobs. The media harness is one separate, fixed Compose project. | Compose selected app descriptors into one named project, with app/service IDs namespaced, exact dependency graph, and per-service status/checkpoints. Keep old app projects independent unless separately migrated. |
| Shared paths | Recipe v2 now has explicit owner-selected `hostPath` bind markers and `shareGroup`, while the base `selfhost-compose` manifest can enforce owner-checked bind mounts. There is not yet a multi-app recipe-to-manifest apply route. | Make user-selected media/download host paths explicit shared bind grants. Preserve a single in-container path across downloader and Arr apps when hardlinks/atomic moves are selected; inspect ownership/filesystem and never infer paths. Keep app config in project-owned volumes or isolated config mounts. |
| Identity and timezone | Recipe v2 now permits host-bound `PUID`/`PGID`, `USERMAP_UID`/`USERMAP_GID`, and `TZ`; the CLI resolves declared bindings from inspected host identity/timezone. Seerr explicitly does not support PUID/PGID. | Keep bindings opt-in per image and preserve Seerr's UID-1000 model. For the shared project, select one timezone and numeric UID/GID; do not claim these are app-independent defaults. |
| Ports and runtime details | Recipe v2 now has bounded, typed `additionalPorts` for TCP/UDP, but no `init`, device, capability, or network-mode field. qBittorrent's peer ports still need a recipe and owner choice. | Keep optional init and separately approved device/capability grants distinct. Default to private WebUI ports; do not publish peer ports unless the owner selects them. |
| Service networking and VPN | Recipe v2 does not declare network topology. The current implementation supports network aliases and has a pure shared-project candidate compiler. Neither app recipe v2 nor the base manifest supports `network_mode: service:<gateway>`; `selfhost-vpn` plans and evaluates a VPN topology but does not deploy it. | Finish a shared-project deploy route separately, including recipe-level attachment/dependency intent. Keep VPN deployment a separately gated adapter: only the selected downloader shares the gateway namespace, gateway owns TUN/network-admin privileges and WebUI bind, and post-apply verification includes a timestamped tunnel-break fail-closed test. |
| Authentication and secrets | Recipe v2 has one onboarding declaration per recipe: manual first admin, initial admin from a private file, or the Immich-specific API flow. Private-file/environment bindings are available, but there is no reusable per-service auth mode for generated temporary-password rotation, downstream API-key exchange, or dependency connection setup. | Define typed per-app setup operations over secret references; never place generated credentials in argv, logs, reports, or saved preferences. Make each selected app's first-run steps and dependency credentials independently reviewable and resumable. |
| Setup and acceptance | `SetupAdapter` exposes `firstRun/ready`, not a generic app lifecycle; the current setup engine handles one app's saved project. Functional, dependency, and restart acceptance remain separate. | Route typed, per-app setup steps through a bounded registry; prove direct login/API/function, dependency tests, and exact-project restart per app. A saved first-run checkpoint or HTTP 200 is not acceptance. |
| Managed support | `support.automation: managed` requires a registered application-scoped adapter. A recipe can expose an experimental bounded apply route without becoming managed. | Add an exact app-scoped adapter and install-profile entry only after rendering, focused preflight, idempotent apply, acceptance, and recovery/rollback behavior have evidence. |

Schema evidence: [`compose-recipe.schema.json`](../../.agents/skills/self-host/workflows/selfhost/references/catalog/schemas/compose-recipe.schema.json)
caps multi-service recipes at eight services, allows static environment values
plus explicit host UID/GID/timezone bindings, explicit selected host binds,
bounded additional TCP/UDP ports, and one recipe-wide onboarding declaration.
The current CLI resolves `TZ` from inspected host facts, and the
shared-project compiler maps validated recipes into a candidate manifest;
there is still no shared-project deploy/apply lifecycle.
By contrast,
[`manifest-contract.md`](../../.agents/skills/self-host/workflows/selfhost-compose/references/manifest-contract.md)
already describes verified bind mounts, shared mount groups, network aliases,
multiple protocol-specific ports, and owned bridge networks. Those lower-level
features do not yet flow from app recipes through a shared-project apply route.
The manifest also rejects host/device/capability expansion and has no service
network-namespace binding, so VPN and hardware acceleration need their own
narrow, approved route.

The existing media harness demonstrates a useful topology: one Compose project
with Prowlarr, Radarr, Sonarr, qBittorrent, Jellyfin, Seerr, and Homarr; a shared
`/data` tree for the Arr apps and media server; PUID/PGID/TZ for images that use
them; and Seerr's distinct UID-1000/TZ setup. Its app bootstrap scripts are
reusable evidence, not the generic app-picker route. The harness's published
ports and owned-content policy remain separate from any new private-first
catalog project. See [`docker-compose.yml`](../../docker-compose.yml),
[`setup-routes.md`](../../docs/setup-routes.md), and
[`headless-setup.md`](../../docs/headless-setup.md).

## App-by-app classification

“Harness” means the app has a script in the fixed media harness, not an app
recipe route. “None” means no bundled recipe/setup route. The catalog automation
label and priority tier are independent; neither turns a picker listing into an
installer.

| App | Current catalog | Bounded setup route today | Classification / next gate |
| --- | --- | --- | --- |
| Prowlarr | guided / T0 / active | Recipe v2 and wired `setup.ts`; experimental app route. Separate fresh rootless trial is documented in [`prowlarr.md`](prowlarr.md). | Keep as preview, not managed: registration is still absent, indexer selection remains an explicit user choice, and search/indexer acceptance is unproved. Reuse its exact Forms-login/API checks after shared-project assembly exists. |
| Sonarr | guided / T0 / active | Inspect-only v2 recipe and Forms/API setup sidecar, plus fixed harness. | First core promotion after the shared-project route: bind the selected media/download tree consistently; prove Forms login, root folder, qBittorrent client test, and Prowlarr sync. Do not choose an indexer. |
| Radarr | guided / T0 / active | Inspect-only v2 recipe and Forms/API setup sidecar, plus fixed harness. | Same core path as Sonarr, with a separate movie root and app identity. Direct source docs warn that separate `/movies` and `/downloads` mounts can lose hardlinks/atomic moves; do not imply a hardlink-capable layout without one shared path. |
| qBittorrent | guided / T0 / active | Inspect-only v2 recipe and WebUI/API setup sidecar, plus fixed harness. | High-priority downloader, but first-run requires privately reading and rotating a generated temporary password. WebUI is distinct from optional peer TCP/UDP ports. If VPN is selected, require the separate namespace/firewall contract and tunnel-break proof. |
| Jellyfin | guided / T0 / active | Inspect-only v2 recipe and checkpointed v12.1 setup sidecar, plus fixed harness; see [`jellyfin.md`](jellyfin.md). | Keep unpromoted until owner-selected media mounts and fresh-wizard/restart proof. Keep remote access off by default; GPU devices and discovery UDP need an explicit optional host-resource route. |
| Seerr | guided / T0 / transitioning | Inspect-only v3.5.0 Compose recipe and fixed harness; see [`seerr-v3.5.0.md`](seerr-v3.5.0.md). | First admin requires an owner-selected media-server administrator; then configure selected libraries and Arr links. No local-only first-admin API exists. Existing-data migration must start with a backup. |
| Bazarr | guided / T1 / active | None. | Add after Arr API/setup composition: Sonarr/Radarr endpoints and keys, shared TV/movie paths, and any subtitle-provider credentials need app-specific checks and secret handling. |
| Lidarr | guided / T1 / active | None. | Reuse Arr setup primitives only after confirming current metadata support and a music/download path that preserves the chosen import semantics. LinuxServer image docs expose PUID/PGID/TZ, `/music`, and `/downloads`; this is packager guidance, not upstream image ownership. |
| SABnzbd | guided / T1 / active | Inspect-only v5.1.3 Compose recipe and private INI-key extractor; see [`sabnzbd-route-2026-09-29.md`](sabnzbd-route-2026-09-29.md). | Keep as an alternate downloader, not a silent qBittorrent dependency. Owner-supplied Usenet credentials, path/API/login acceptance, optional VPN, and live proof remain. |
| Readarr | Removed from app catalog | None; upstream repository archived. | Do not promote or install. Preserve migration research, not an installable entry; do not infer a supported successor from an unaffiliated fork or third-party image. |
| NZBGet | guided / T1 / transitioning | None. | Recheck the current `nzbgetcom` project/release/image and migration boundary before any recipe; do not reuse legacy organization artifacts or stale package tags. |
| Deluge | guided / T1 / active | None. | Separate downloader candidate. Resolve daemon/Web UI mode, RPC auth, storage, and port policy; require the VPN path only when selected. |
| Transmission | guided / T1 / active | None. | Separate downloader candidate. Resolve RPC authentication and peer-port choices; do not treat a private RPC UI as proof of egress isolation. |
| Aria2 | discovery / T2 / active | None. | Discovery-to-guided candidate only after selecting a maintained container packager and proving private token-authenticated RPC, file paths, and API acceptance. Do not expose RPC publicly. |
| Slskd | discovery / T2 / active | None. | Distinct peer-to-peer workflow, not a drop-in torrent/Usenet client. Upstream docs show default UI credentials `slskd/slskd`, API-key support, separate HTTP/HTTPS and Soulseek ports, and user/permission choices; require credential rotation and explicit share/outbound policy. |
| Emby | discovery / T2 / active | None. | Valid server-role candidate: vendor docs provide an official Docker image and first-run wizard. Resolve account/licensing policy, selected media paths, remote-access defaults, and any hardware access before promotion. |
| Plex | guided / T1 / active | None. | Alternative media-server role, not a Jellyfin alias. Verify current official image/claim flow, licensing/account consent, library path, remote-access defaults, and optional transcoding resources. |
| Audiobookshelf | guided / T1 / active | None. | Separate audiobook/podcast-library role. Validate its current official container, first-admin path, library mounts, and restart/content acceptance before adding to the shared project. |
| Navidrome | guided / T1 / active | None. | Separate music-server role. Verify official image and user/library configuration; mount the music library read-only unless a specific write capability is required. |
| Gluetun | guided / T0 / active | VPN planning capability only; no recipe/app apply route. | Do not treat the gateway as an ordinary app recipe. Use the downloader VPN adapter boundary, exact secret handoff, minimum TUN/network-admin grant, allowlisted WebUI bind, and fail-closed evidence. |
| Tdarr | discovery / T1 / active | None. | Separate transcoding stack candidate. Official docs describe Server plus Node, shared media and transcode-cache paths, optional GPU/device access, and multiple ports. Current recipes cannot declare the needed shared bind paths or device/capability grants; assess as a separate stack-level resource route. |
| Tracearr | discovery / T2 / active | None. | Separate analytics stack. Current upstream examples depend on PostgreSQL and Redis and require JWT/cookie secrets; the PostgreSQL 18 sample is explicitly new-install-only and warns about incompatible data formats. Pin and verify the supported topology plus backup/restore before an adapter. |
| Jellyseerr | Removed from app catalog | None. | Keep migration research only; Seerr's official guide migrates Jellyseerr data on first start. Back up and review that forward migration before any apply. |
| Overseerr | Removed from app catalog | None. | Keep migration research only; Seerr's official guide migrates Overseerr data on first start. Back up and review that forward migration before any apply. |
| Anchor | Removed from app catalog | Not applicable. | Hosted Spotify for Podcasters surface, not a self-hosted app. Do not create a container recipe. |
| ArchiveTeam Warrior | discovery / T2 / active | None. | Exclude from the personal media stack. It is an opt-in volunteer archival worker with changing external tasks and egress/resource impact; review separately if requested. |

## Recommended implementation order

1. Wire the current shared Compose candidate compiler and app-alias seam
   into a deploy route: exact app selection, namespaced service IDs, one project
   approval, and persisted per-app status. Do not change old project ownership
   or paths implicitly.
2. Extend the reusable recipe contract with shared bind paths, network intent,
   multiple protocol-specific ports, and per-service typed setup/auth operations.
   Keep UID/GID/timezone bindings opt-in only where the image supports them;
   keep host hardware and gateway namespace options separately gated.
3. Port the proven core from the fixed harness: Prowlarr, qBittorrent, Sonarr,
   Radarr, Jellyfin, and Seerr. Preserve the user's selected services; default
   to no indexer, no media request, and no public exposure. Direct acceptance
   must include the relevant app login/API plus dependency connection tests and
   scoped restart read-back.
4. Add Bazarr and Lidarr as Arr extensions; add SABnzbd, Deluge, Transmission,
   Aria2, and Slskd as separate downloader choices with distinct credentials,
   port contracts, and optional VPN evidence. Never make every downloader
   depend on every other downloader.
5. Treat Emby/Plex/Jellyfin as alternative server roles; add Audiobookshelf and
   Navidrome as optional media-server roles. Assess Tdarr and Tracearr as their
   own multi-service/resource-heavy stacks. Keep research for Readarr,
   Jellyseerr, and Overseerr migration only; Anchor is non-deployable.

No Docker install, browser run, image digest resolution, catalog test, or
acceptance check was performed for this audit. It establishes what the current
contract can express and which app sources must drive the next implementation;
it does not establish current-image compatibility on a host.

## Primary sources

- Container/path contracts: [LinuxServer Sonarr](https://docs.linuxserver.io/images/docker-sonarr/), [Radarr](https://docs.linuxserver.io/images/docker-radarr/), [qBittorrent](https://docs.linuxserver.io/images/docker-qbittorrent/), [Bazarr](https://docs.linuxserver.io/images/docker-bazarr/), [Lidarr](https://docs.linuxserver.io/images/docker-lidarr/), and [SABnzbd](https://docs.linuxserver.io/images/docker-sabnzbd/). These are image-publisher docs, separate from each application's upstream.
- qBittorrent: [official WebUI/API wiki](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)) and [temporary password/recovery behavior](https://github.com/qbittorrent/qBittorrent/wiki/Web-UI-password-locked-on-qBittorrent-NO-X-%28qbittorrent-nox%29).
- Seerr: [official Docker setup](https://docs.seerr.dev/getting-started/docker/), [Overseerr/Jellyseerr migration guide](https://docs.seerr.dev/migration-guide/), and [why the official image does not support PUID/PGID](https://docs.seerr.dev/blog/why-seerr-doesnt-support-puid-pgid/).
- Jellyfin: [official container installation](https://jellyfin.org/docs/general/installation/container/) and the checked-in [version/API research](jellyfin.md).
- Readarr: [archived upstream repository and retirement notice](https://github.com/Readarr/Readarr).
- Aria2: [official RPC/security manual](https://aria2.github.io/manual/en/html/aria2c.html).
- Slskd: [upstream Docker README](https://github.com/slskd/slskd/blob/master/README.md) and [configuration/authentication docs](https://github.com/slskd/slskd/blob/master/docs/config.md).
- Emby: [official Docker instructions](https://docs.emby.media/docker-server.html) and [startup wizard](https://support.emby.media/support/articles/Installation.html).
- Tdarr: [official Docker Compose guide](https://docs.tdarr.io/docs/installation/docker/run-compose/) and [hardware transcoding guide](https://docs.tdarr.io/docs/installation/docker/hardware-transcoding/).
- Tracearr: [upstream Compose example](https://github.com/connorgallopo/Tracearr/blob/main/docker/examples/docker-compose.pg18.yml) and [project deployment README](https://github.com/connorgallopo/Tracearr).
- VPN: the current owner workflow's [topology](../../.agents/skills/self-host/workflows/selfhost-vpn/references/topology.md) and [evidence contract](../../.agents/skills/self-host/workflows/selfhost-vpn/references/evidence-contract.md).
