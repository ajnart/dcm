# qBittorrent/Hotio route follow-up (2026-09-29)

- Checked at: `2026-09-29`
- Status: `warn`
- Scope: source and repository review only; no Docker, image pull, browser, credentials, or live API.

## Image provenance and local manifest

The checked-in qBittorrent [catalog manifest](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/qbittorrent/manifest.json#L19-L27)
pins `ghcr.io/hotio/qbittorrent:release-5.2.3`. The canonical [media Compose
service](../../docker-compose.yml#L45-L59) instead uses the mutable
`ghcr.io/hotio/qbittorrent:latest`, without a digest. Hotio's [image metadata](https://github.com/hotio/qbittorrent/blob/release/meta.json)
reports upstream version `5.2.3`; its [package tag listing](https://github.com/hotio/qbittorrent/pkgs/container/qbittorrent/versions)
lists `latest` with `release-v5.2.3` / `release-5.2.3` at digest
`sha256:6d55650a450d23f1798f7eef95c97db6d355c24789622a1d586489d8881f57f9`
(registry metadata checked 2026-09-29, not a local pull). The [container
documentation](https://hotio.dev/containers/qbittorrent/) also lists 5.2.3.
Upstream's [official release page](https://github.com/qbittorrent/qBittorrent/releases) now lists stable
v5.2.4 (released 2026-09-28). Therefore, the known Hotio image provenance is
5.2.3 and it trails upstream; do not attribute 5.2.4 behavior to this image.
Because Compose uses a floating tag and no image was pulled, the running
container's resolved digest/version remain unverified. Keep the manifest and
Compose choice aligned before promoting an image pin.

Compose sets both `WEBUI_PORT` and `WEBUI_PORTS` to the selected
`QBITTORRENT_PORT` (with `/tcp` on `WEBUI_PORTS`), persists `/config` and
`/data/torrents`, and publishes only the configured WebUI TCP port. The
Hotio documents `/config`, `/data`, and that `WEBUI_PORTS` also controls its
VPN firewall exposure (and is the port override for some images). Its
[qBittorrent service command](https://github.com/hotio/qbittorrent/blob/release/root/etc/s6-overlay/s6-rc.d/service-qbittorrent/run#L268)
passes the `WEBUI_PORTS` port to `qbittorrent-nox`, so keep it aligned with the
published port and clients. The Compose service has no qBittorrent
`healthcheck` or peer-listener port mapping.

## First-run identity and API route

For the known 5.2.3 binary, upstream [`application.cpp`](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/app/application.cpp#L3772-L3823)
generates a temporary password when the stored WebUI password is empty and
prints it for that process; the tagged [preferences source](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/base/preferences.cpp)
sets the initial username to `admin` and password empty. The temporary secret
must come from that profile's actual startup, never a guess. The existing
parser selects the newest matching line from project-scoped service logs, but
the log query has no `--since` or process filter; a reused project can therefore
present a stale line. A custom/reused `/config` is not this first-run case.

The existing [bootstrap route](../../scripts/bootstrap-core.ts#L83-L204)
tries the managed credentials first, then the newest matching temporary-password
line returned by this project's service logs with `admin`, writes the selected
`web_ui_username` and `web_ui_password` through
`POST /api/v2/app/setPreferences`, and requires a second login. The official
[WebUI API documentation](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29)
documents form fields `username` and `password` for `/api/v2/auth/login`,
cookie authentication, the `Origin`/`Referer` host-and-port match, and the
`json` form field for `setPreferences`. Password is write-only; verify the new
identity by logging in again and making an authenticated read, not by reading
preferences back. The local helper accepts 200 or 204 only when a `QBT_SID`
cookie is present.
For the pinned upstream 5.2.3 source specifically, successful login is
HTTP 204 with an empty body and a port-suffixed QBT_SID cookie; the
[auth controller](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/api/authcontroller.cpp#L401)
and [response implementation](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp#L2797)
are more precise than the older 200/Ok./SID example in the v5.0 wiki.

An API key is available from qBittorrent/WebAPI 5.2.0. The official
[API-key guide](https://github.com/qbittorrent/qBittorrent/wiki/API-Key-Authentication-%28%E2%89%A5v5.2.0%29)
documents Bearer authentication and its limits: it cannot call `login` or
`logout` or fetch the WebUI/static assets. The tagged 5.2.3
[application controller](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/api/appcontroller.cpp)
returns `web_ui_api_key` in authenticated preferences and implements
`POST /api/v2/app/rotateAPIKey` to generate a key when none exists. The
[WebAPI changelog](https://github.com/qbittorrent/qBittorrent/blob/v5_2_x/WebAPI_Changelog.md)
records that route in WebAPI 2.14.1. The existing adapter's read-existing-first
route is source-backed, but its cookie login, key creation, read-back, and
Bearer request still need fresh-container verification. No API key is
configured in the canonical media Compose service.

## Health, paths, VPN, and resume boundary

Hotio's qBittorrent documentation does not specify an app readiness probe; its
`VPN_HEALTHCHECK_ENABLED` option is a separate WireGuard connectivity watchdog
and is off in the documented example. The local readiness loop polls
`/api/v2/app/version` and accepts 200/401/403 before identity setup
([bootstrap-core.ts](../../scripts/bootstrap-core.ts#L43-L69)); that shows an
HTTP surface, not authenticated usability. The later authenticated version
read plus fresh-credential login remains the appropriate API check. No health
or API check was run here.

The [bootstrap path settings](../../scripts/bootstrap-core.ts#L190-L225) use
`/data/torrents`, `/data/torrents/incomplete`, and category paths
`/data/torrents/tv-sonarr` and `/data/torrents/movies-radarr`. Compose persists
the config and those downloads under the same session root, while [Sonarr and
Radarr share `/data`](../../docker-compose.yml#L17-L43); keep these in-container paths stable for imports and
hardlinks. The [catalog](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/qbittorrent/manifest.json#L44-L50)
separates the WebUI from peer ports and requires explicit VPN approval. The
media Compose service currently has no VPN namespace or VPN credentials. The
[Hotio WireGuard example](https://hotio.dev/containers/qbittorrent/#wireguard)
uses an explicit `VPN_ENABLED=true`, config in
`/config/wireguard`, and `NET_ADMIN`; none is configured here. The
catalog's [download-privacy goal](../../.agents/skills/self-host/workflows/selfhost/references/catalog/stacks/goals.json#L177-L183)
makes the gateway an explicit choice and requires healthy egress, a recorded
tunnel-break fail-closed check, restored egress, and proof that control-plane
traffic stays outside the downloader namespace. Hotio's optional in-image VPN
support is not itself that acceptance proof.

Source-level safe re-entry is reasonable: bootstrap attempts the persisted
managed identity before consulting startup logs, then verifies after changing
preferences; category setup creates missing categories or updates mismatched
paths. This is an inference from checked-in code, not a live rerun. For
transfer resumption, retain both the exact `/config` and `/data/torrents`
mounts and do not reset profile state or remap download paths. qBittorrent's
[official FAQ](https://github.com/qbittorrent/qBittorrent/wiki/Frequently-Asked-Questions#where-does-qbittorrent-save-its-settings)
documents where preferences and application data live, but no restart/resume
was tested in this work. A service-only restart, restored torrent state, and
path/file verification are still live acceptance gates.

## Remaining proof

Still unverified: the running container's resolved `latest` digest and binary
version, actual Hotio startup log visibility, temporary login/cookie issuance,
preference persistence, managed re-login, authenticated readiness, and transfer
resume after a scoped restart. A fresh isolated acceptance run should record image digest/version,
HTTP status and cookie presence only; keep the temporary password, credentials,
cookies, and authorization headers out of output and evidence. Do not reset or
reuse an existing profile to simulate first run.
