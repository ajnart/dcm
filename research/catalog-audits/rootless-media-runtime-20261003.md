# Rootless media runtime: UID mapping and publisher startup evidence

Checked 2026-10-03. Reuses [media-existing.md](media-existing.md) and
[media-headless-20261003.md](media-headless-20261003.md) for bootstrap boundaries;
this note adds image-init/UID evidence, not another adapter audit. Read-only public
source research; no Docker pull/run/exec, private runtime inspection, tests or CI.
Only this note changes. Context7 resolved `/linuxserver/docker-documentation`
and fetched rootless/PUID docs; publisher source fills the image-specific gap.

## Decision

Do not enable a supported rootless media profile yet. `PUID=0` / `PGID=0` is
meaningful inside a rootless namespace and has concrete publisher source paths,
not merely arithmetic speculation. It is **not** a formally supported LSIO
configuration, and this pass has not linked every recipe image digest to the
inspected init revision or proved fresh/restart operation. Hotio has explicit
UID-zero handling, but no rootless deployment promise was found in its app docs.
[LSIO support policy](https://docs.linuxserver.io/misc/support-policy/) lists zero
PUID/PGID among configurations receiving, at most, case-dependent assistance.

## Exact recipes and source linkage

All five recipes use `user: image-default`, inject inspected host UID/GID through
`hostEnvironment`, and use fresh named `/config` volumes. Sonarr, Radarr, Bazarr
and qBittorrent share an owner-selected `/data` bind; Prowlarr has **no `/data`
mount**, so its remaining issue is config-volume startup, not media access.
Sources: app-local `recipe.json` under
`.agents/skills/self-host/workflows/selfhost/references/catalog/apps/`.

| App | Exact recipe tag | Version-specific publisher source inspected |
| --- | --- | --- |
| Sonarr | `lscr.io/linuxserver/sonarr:version-4.0.19.2979` | [4.0.19.2979-ls324 runner](https://github.com/linuxserver/docker-sonarr/blob/4.0.19.2979-ls324/root/etc/s6-overlay/s6-rc.d/svc-sonarr/run), source ref `e9da3fa2a7d36fe9ac80022bf5f2f222e6b906eb` |
| Radarr | `lscr.io/linuxserver/radarr:version-6.4.4.10685` | [6.4.4.10685-ls318 runner](https://github.com/linuxserver/docker-radarr/blob/6.4.4.10685-ls318/root/etc/s6-overlay/s6-rc.d/svc-radarr/run), source ref `c96a4978d8ac4ccf6c875368cf0717b8f41a1dce` |
| Prowlarr | `lscr.io/linuxserver/prowlarr:version-2.6.5.5623` | [2.6.5.5623-ls162 runner](https://github.com/linuxserver/docker-prowlarr/blob/2.6.5.5623-ls162/root/etc/s6-overlay/s6-rc.d/svc-prowlarr/run), source ref `5807ae6608a72716ca09c0c48406d3cb09260894` |
| Bazarr | `lscr.io/linuxserver/bazarr:version-v1.6.0` | [v1.6.0-ls363 runner](https://github.com/linuxserver/docker-bazarr/blob/v1.6.0-ls363/root/etc/s6-overlay/s6-rc.d/svc-bazarr/run), source ref `2154b521ffbee2deaece8abb9684fb3c275825a9` |
| qBittorrent | `ghcr.io/hotio/qbittorrent:release-5.2.3` | [current release runner](https://github.com/hotio/qbittorrent/blob/4a792a9ad4bb771180b0885a1b1e974dbc2a88e0/root/etc/s6-overlay/s6-rc.d/service-qbittorrent/run); **not proven to be 5.2.3's runner** |

`git ls-remote` confirmed those LSIO source refs; several build refs exist for
the same application version. Their version-only recipe tags do not select a
unique source build. Dockerfiles for the inspected Sonarr/Radarr/Prowlarr builds
use LSIO Alpine 3.24; Bazarr uses 3.23. Source refs are not OCI digests.

The recipes' `imageSource` pointers are the publisher's GitHub package-version
pages (`linuxserver/docker-<app>` and `hotio/qbittorrent`). **Registry manifests,
architecture digests and image-config revision/base labels were not resolved**.
The [Hotio public tags feed](https://hotio.dev/containers/qbittorrent-tags.json)
currently exposes only `release`, with no 5.2.3 entry; the inspected
[release build metadata](https://github.com/hotio/qbittorrent/blob/4a792a9ad4bb771180b0885a1b1e974dbc2a88e0/meta.json)
is already 5.2.4 and uses `alpinevpn-698fab4`. That cannot attest the 5.2.3 image.

## Why host UID 1000 fails the intended ownership model

Docker rootless uses a user namespace; container root is not host root.
[Docker rootless docs](https://docs.docker.com/engine/security/rootless/) and
[RootlessKit ID-mapping example](https://github.com/rootless-containers/rootlesskit#usage)
describe that boundary. Under the usual observed mapping, container UID/GID 0
maps to the daemon caller, while container UID 1000 maps into subordinate IDs.
Thus `PUID=<host caller UID>` is not generally the caller's host identity in a
rootless container. The actual UID **and GID** maps must be checked; do not infer
them from a context name or assume supplementary host groups are retained.

For a new caller-owned directory with owner write/search permissions, an app
running at container 0:0 can access it as the caller. Setting `PUID=0/PGID=0`
does not itself change host ownership or grant host-root access. Conversely,
setting Compose `user: 0:0` only fixes PID1's identity: these images still launch
the application as their configured account. Its PUID/PGID must be checked too.
This is a namespace/permission inference, not an acceptance claim.

## Startup behavior: stronger than a hypothetical UID map

LSIO's [Alpine init-adduser](https://github.com/linuxserver/docker-baseimage-alpine/blob/3.24/root/etc/s6-overlay/s6-rc.d/init-adduser/run)
defaults missing IDs to 911, uses `groupmod -o` and `usermod -o` for `abc`, and
does not reject zero. It adjusts `/app`, `/config`, `/defaults`, not `/data`,
through `lsiown`. All four version-specific runners above call `s6-setuidgid
abc` in the normal root-init branch; setting `abc` to 0:0 therefore makes the
service run at 0:0. This does not bypass init or depend on host sudo.

The [s6-setuidgid contract](https://skarnet.org/software/s6/s6-setuidgid.html)
looks up the account and sets its real/effective UID, GID and supplementary
groups before exec. It specifies no nonzero-ID requirement. Namespace-root s6
can therefore select account 0 in principle, with ordinary namespace
capabilities. No added capability, privileged mode, device or socket is needed
by this argument; successful image startup still needs verification.

Hotio's [Alpine base init at 698fab4](https://github.com/hotio/base/blob/698fab4da234f3ca4133d6f4cac6133622ed3281/root/etc/s6-overlay/s6-rc.d/init-setup/run)
explicitly branches on `PUID != 0` around home changes, then runs `usermod -o -u`
and `groupmod -o -g`. It changes ownership only on the `/config` top-level entry
in this script, not `/data`. The current qBittorrent runner calls `s6-setuidgid
hotio`. This is source-backed zero-ID handling, not a published rootless
support commitment. [Hotio app docs](https://hotio.dev/containers/qbittorrent/)
document PUID/PGID with 1000 examples and no rootless-specific recipe.

Do not substitute Compose `user: 1000:1000`: LSIO's
[non-root documentation](https://docs.linuxserver.io/misc/non-root/) says that
mode ignores PUID/PGID and requires separately owned `/run` for s6 when
no-new-privileges is set. It also remains subordinate-mapped here. The existing
compiler rejects `/run` tmpfs customization; weakening it is not a fix for this
bind-owner problem.

## Smallest candidate and the gate before implementation

No compiler change is justified as a supported fix from this evidence alone.
The smallest **disabled research candidate** is app-owned and exact-image-bound:
retain image-default init, writable image filesystem, fresh owned config volume,
existing no-new-privileges, private ports and shared `/data` ownership; override
only the app account IDs to PUID/PGID 0 after the exact daemon and both namespace
maps are verified. Keep VPN disabled and retain existing UMASK. Apply this only
to the five reviewed app services, not every PUID image or every rootless plan.

If subsequent approval/runtime evidence warrants such a conditional profile,
the existing seam is `multiServiceManifest` in
`packages/cli/src/lib/multi-service-recipe.ts`: its hostEnvironment loop currently
turns the observed non-root **host** `uid/gid` directly into PUID/PGID; userFields
already preserves image-default and publisher evidence. Keep host observations
nonzero and separately derive the approved **container** account IDs. Do not
globally pass zero host IDs or key the behavior solely on `dockerContext`.
The lower Compose contract already has a daemon-verified explicit rootless 0:0
exception, but that does not change an s6-managed app's account by itself.

Missing proof, in order:

1. Resolve each exact recipe tag to reviewed platform digest and image-config
   revision/build/base linkage; recover qBittorrent 5.2.3's own init and runner.
2. Inspect the exact rootless daemon's UID/GID maps and caller ownership of a
   **new empty** disposable `/data`, without changing existing host data.
3. With separate bounded apply approval, prove all five fresh config volumes
   initialize, app process IDs are 0:0, and logs show no s6/init ownership error.
4. Prove approved marker create/read/rename and cross-app access on `/data`,
   host ownership remains the caller, then restart/config/auth persistence.
   Prowlarr needs config/auth persistence, not an invented media bind.

Do not use mode 0777, chown an existing library, sudo, device/socket/privileged
changes, or additional capabilities to force that proof. If policy requires
formal publisher support, LSIO zero-ID mode remains disqualified even after an
isolated trial succeeds; trial evidence cannot change upstream support policy.
