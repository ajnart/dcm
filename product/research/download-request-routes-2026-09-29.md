# Self-host research report: download and request app routes

- Checked at: `2026-09-29`
- Status: `warn`
- Browser session: `not used`
- Session closed: `not applicable`
- Domain allowlist: `github.com, hotio.dev, sabnzbd.org, docs.linuxserver.io, docs.seerr.dev, wiki.servarr.com`

## Scope

Checked current upstream/image-publisher sources for qBittorrent, SABnzbd, and
Seerr: Compose shape, image/version provenance, first-run authentication or API
key access, and downstream client/server wiring. No service was installed or
changed. No provider, indexer, media title, request, seed ratio, download path,
or public/VPN route was selected. The report does not claim live API, UI,
download, or restart acceptance.

## Sources

Every source below was opened through read-only web retrieval on the check date;
canonical and final URLs are the same except the qBittorrent wiki's encoded
parentheses normalize to a decoded slug. No agent-browser session or local
browser state was created.

| Role | Canonical source | Final URL | Link result | Checked at |
| --- | --- | --- | --- | --- |
| official | [qBittorrent releases](https://github.com/qbittorrent/qBittorrent/releases) | Same | pass | 2026-09-29 |
| image-publisher | [LinuxServer qBittorrent image guide](https://docs.linuxserver.io/images/docker-qbittorrent/) | Same | pass | 2026-09-29 |
| image-publisher | [Hotio qBittorrent container](https://hotio.dev/containers/qbittorrent/) | Same | pass | 2026-09-29 |
| official | [qBittorrent WebUI API v5](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29) | https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0) | pass | 2026-09-29 |
| official | [qBittorrent API-key authentication](https://github.com/qbittorrent/qBittorrent/wiki/API-Key-Authentication-%28%E2%89%A5v5.2.0%29) | Same | pass | 2026-09-29 |
| official | [SABnzbd releases](https://github.com/sabnzbd/sabnzbd/releases) | Same | pass | 2026-09-29 |
| official | [SABnzbd API reference](https://sabnzbd.org/wiki/configuration/5.1/api) | Same | pass | 2026-09-29 |
| image-publisher | [LinuxServer SABnzbd image guide](https://docs.linuxserver.io/images/docker-sabnzbd/) | Same | pass | 2026-09-29 |
| image-publisher | [LinuxServer SABnzbd package tags](https://github.com/linuxserver/docker-sabnzbd/pkgs/container/sabnzbd/versions?filters%5Bversion_type%5D=tagged) | Same | pass | 2026-09-29 |
| official | [Seerr v3.5.0 release](https://github.com/seerr-team/seerr/releases/tag/v3.5.0) | Same | pass | 2026-09-29 |
| official | [Seerr image package tags](https://github.com/seerr-team/seerr/pkgs/container/seerr/versions?filters%5Bversion_type%5D=tagged) | Same | pass | 2026-09-29 |
| official | [Seerr Docker guide](https://docs.seerr.dev/getting-started/docker/) | Same | pass | 2026-09-29 |
| official | [Seerr v3.5.0 OpenAPI](https://raw.githubusercontent.com/seerr-team/seerr/v3.5.0/seerr-api.yml) | Same | pass | 2026-09-29 |
| official | [Seerr service settings](https://docs.seerr.dev/using-seerr/settings/services/) | Same | pass | 2026-09-29 |
| official | [Seerr media-server settings](https://docs.seerr.dev/using-seerr/settings/mediaserver/) | Same | pass | 2026-09-29 |
| official | [Seerr migration guide](https://docs.seerr.dev/migration-guide/) | Same | pass | 2026-09-29 |
| official | [Radarr settings and download-client behavior](https://wiki.servarr.com/radarr/settings) | Same | pass | 2026-09-29 |

## Findings

### qBittorrent

- Upstream stable is **5.2.4** (released 2026-09-28). The exact community image
  used by the canonical harness is Hotio. Its checked image guide exposes a
  single service with `/config`, `/data`, WebUI TCP `8080`, and documented
  `PUID`, `PGID`, `TZ`, and `WEBUI_PORTS`; the guide's latest release tag was
  `release-5.2.3`, so the packaged image trails upstream 5.2.4.
- Upstream WebUI authentication is cookie-based through
  `POST /api/v2/auth/login`; v5.2+ also supports an API key generated in the
  WebUI. The current canonical harness Compose uses `ghcr.io/hotio/qbittorrent:latest`,
  and its bootstrap parses the temporary-password log phrase. A follow-up
  [version-pinned source review](qbittorrent-route-2026-09-29.md) traced that
  phrase to qBittorrent itself and Hotio's foreground launch. The route is
  source-supported for a fresh profile, but first-run credentials still need
  proof against the exact selected image before promotion.
- Peer connectivity is distinct from the WebUI. The existing media harness
  configures torrent categories and wires qBittorrent into Sonarr and Radarr;
  the Arr client settings require an explicitly chosen host/port, credentials,
  category, and accessible download paths. Do not reuse its category names or
  paths as user-independent defaults. No client or category was selected here.

### SABnzbd

- Upstream stable is **5.1.3** (released 2026-09-08); 5.2.0 Beta 1 is marked
  pre-release. The LinuxServer package page's current `latest` aliases resolve
  to 5.1.2 (`5.1.2-ls271`), so the known community reference is marked
  `verify` and must be rechecked before install.
- Image-publisher Compose docs expose WebUI TCP `8080`, `/config`, optional
  `/incomplete-downloads` and `/downloads`, and `PUID`/`PGID`/`TZ`. Paths and
  the same-filesystem/shared-mount requirement must be selected with the Arr
  import layout; do not set a provider or queue item.
- The upstream API requires its API key on requests (commonly in an `apikey`
  query parameter); only `version` and `auth` are exempt. This repository's
  generic private HTTP transport rejects secret query parameters, and the
  adapter secret surface does not read SABnzbd's INI key. API setup therefore
  cannot be claimed safe or complete by a recipe alone. Usenet server and
  provider credentials remain explicit owner choices.

### Seerr

- Upstream stable release and image are **v3.5.0**. The official Docker guide
  declares `init: true`, port `5055`, and `/app/config`, and recommends
  `no-new-privileges` with all capabilities dropped. The current app recipe
  schema cannot represent `init` or those hardening fields, so no recipe was
  added that would silently omit the documented Compose contract.
- First-run requires the owner-selected media-server account/server and
  libraries. Radarr/Sonarr integration needs at least one default instance,
  API keys, root folders, profiles, and minimum availability; Docker siblings
  must use reachable service DNS, not `localhost`. These are not inferred from
  the fixed test harness.
- **v3.5.0 changes Jellyfin library routes.** The release and version-pinned
  OpenAPI declare `GET /settings/jellyfin/library` as a read-only list;
  `POST /settings/jellyfin/library/sync` returns a list of
  `{id, name, enabled}` libraries; and
  `PUT /settings/jellyfin/library/{libraryId}` requires JSON
  `{"enabled": boolean}` and returns the updated library. The old
  `GET /settings/jellyfin/library?sync=true` and `GET ...?enable=...` calls in
  `scripts/bootstrap-seerr.ts` no longer sync or enable libraries. **That
  script must stop at library synchronization/selection and must not proceed to
  initialization or report pass until it uses the v3.5.0 methods and verifies
  exact library state against the running image.** No request payload was
  inferred beyond the version-pinned OpenAPI contract.
- Existing-data migration from Overseerr/Jellyseerr is automatic and
  forward-only; back up first. No migration was attempted.

## Compose contract

No normalized recipe/Compose model was retained and no `recipe.json` or
`setup.ts` was added. Source topology suitable for future candidates:

| App | Evidence-backed Compose facts | Why a packaged setup is deferred |
| --- | --- | --- |
| qBittorrent | Hotio image; `/config`, `/data`; WebUI `8080/tcp`; host UID/GID/timezone and image-specific `WEBUI_PORTS` | Upstream binary generates a temporary password for a fresh profile; exact Hotio image login/restart acceptance is unproven. Peer ports/VPN are separate choices. |
| SABnzbd | LinuxServer image; `/config`, separate incomplete/complete targets; WebUI `8080/tcp`; UID/GID/timezone | Current image lags upstream stable; API key retrieval and API transport are not supported by the app adapter; provider/server and shared storage are owner choices. |
| Seerr | Official image; `/app/config`; `5055/tcp`; `init: true`; recommended no-new-privileges and all-capability drop | Recipe schema cannot express all documented runtime fields; initial server/library and Arr settings require explicit owner choices; corrected harness calls still need live v3.5.0 proof. |

The canonical downloader wiring is an existing fixed-stack behavior, not an
install route: `scripts/bootstrap-core.ts` sets qBittorrent save paths and
categories, then configures Sonarr/Radarr clients; `scripts/bootstrap-seerr.ts`
uses fixed Jellyfin, library, Arr, root-folder, and profile assumptions.
Servarr documents that clients report paths to Arr and that import/hardlink or
atomic-move behavior depends on accessible shared filesystem paths. No
indexer, provider, media title, or search/request action was selected.

## Alternatives

| Alternative | Evidence role | Strengths | Constraints | Confidence |
| --- | --- | --- | --- | --- |
| qBittorrent vs SABnzbd | upstream + image-publisher | Separate torrent and Usenet downloader roles, both can be used as Arr download clients | Not interchangeable; protocol, provider, indexer, paths, and optional VPN are user choices. Both current community image versions need rechecking. | high |

## Lifecycle and image provenance

| App | Lifecycle | Image reference | Provenance / version status | Catalog decision |
| --- | --- | --- | --- | --- |
| qBittorrent | active, checked 2026-09-29 | `ghcr.io/hotio/qbittorrent:release-5.2.3` | Community Hotio image; upstream 5.2.4 released after checked 5.2.3 image tag. | Record known tag; defer recipe/setup. |
| SABnzbd | active, checked 2026-09-29 | `lscr.io/linuxserver/sabnzbd:5.1.2` | Community LinuxServer image; current `latest` is 5.1.2 while upstream stable is 5.1.3. | Keep status `verify`; defer recipe/setup. |
| Seerr | active, checked 2026-09-29 | `ghcr.io/seerr-team/seerr:v3.5.0` | Upstream image and current stable package tag. | Record known tag; defer recipe/setup. |

## UI proof

Not applicable. No app instance or browser session was used.

## Safety and redaction

- Redaction applied: `true`
- Redaction count: `16` (scanner matched public URLs/non-secret text as high-entropy values; no credentials or rendered Compose were captured)
- Raw browser payload retained: `false`
- Auth, profile, restore, HAR, and recording used: `false`

## Limitations

- No image was pulled and no registry digest/platform resolution was performed;
  tag evidence is point-in-time and mutable tags remain non-deterministic.
- No Docker apply, live app API/UI, first-run credential, client connection,
  download, request, restart, VPN kill-switch, or restore acceptance was run.
- Seerr's source-backed v3.5.0 OpenAPI shapes were checked, but no live service
  proved the pinned image or current floating harness image implements them.
- The API key transport gap for SABnzbd and qBittorrent's app-owned temporary
  password read path need implementation and live proof; no shared CLI or
  transport code was changed here.

## Conclusion

Update the three manifests with source-backed lifecycle/image facts only. Do
not add recipes or setup sidecars in this change. qBittorrent and SABnzbd need
private first-run/API-key retrieval, exact-image proof, and an owner-approved storage/client
contract. Seerr needs the documented Compose hardening represented in the
recipe contract, user-selected server/library/Arr details, and live exact-state
verification of its corrected v3.5.0 library flow. The fixed harness
must not be treated as a generic app route.
