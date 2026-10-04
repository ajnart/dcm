# Hotio qBittorrent first-run identity route (2026-09-29)

## Scope and finding

This is a read-only review of the harness's `ghcr.io/hotio/qbittorrent:latest`
service and its first-run identity bootstrap. No container, browser, credential,
or live API was used. The current worktree's Compose sets both `WEBUI_PORT` and
`WEBUI_PORTS`; Hotio's current qBittorrent service command passes the port from
`WEBUI_PORTS` to qBittorrent, so that is the operative setting to keep aligned
with the published port and the bootstrap's loopback URL. The log-based
temporary-password route is viable for an empty qBittorrent profile: upstream
generates a random per-process password and prints it, the default WebUI user
is `admin`, and the existing bootstrap reads the newest matching log entry,
logs in, changes the identity, and verifies a second login. There is no
deterministic password value to predict; retrieval must use the actual
project-scoped startup log.

The image tag is mutable. Hotio's release metadata and image documentation
identified upstream qBittorrent 5.2.3 on this review date, but no image digest
was pulled or verified. Runtime behavior therefore remains an acceptance
question, not a finding established by this report.

## Image and local wiring

The canonical [Compose service](../../docker-compose.yml#L45-L59) selects
`ghcr.io/hotio/qbittorrent:latest`, persists `/config`, and sets
`WEBUI_PORTS=${QBITTORRENT_PORT:-8080}/tcp`. It also sets `WEBUI_PORT` to the
numeric port and publishes the same port. Hotio's [container documentation](https://hotio.dev/containers/qbittorrent/)
documents `WEBUI_PORTS` in the format `8080/tcp` for changing the WebUI port.
The [current Hotio run script](https://raw.githubusercontent.com/hotio/qbittorrent/release/root/etc/s6-overlay/s6-rc.d/service-qbittorrent/run)
starts `qbittorrent-nox` with `--webui-port="${WEBUI_PORTS%%/*}"`; the command
does not use `WEBUI_PORT`. Thus the two Compose variables can drift, but only
`WEBUI_PORTS` controls the port passed by this script. Keep it equal to the
container and published port so the app, WebUI, Host/Origin checks, and client
URLs agree.

Hotio's [release metadata](https://github.com/hotio/qbittorrent/blob/release/meta.json)
and [Linux image build](https://github.com/hotio/qbittorrent/blob/release/linux-amd64.Dockerfile)
reported the current upstream binary as 5.2.3. Since Compose uses `latest`,
that is date-stamped evidence only; pin or inspect the actual image version and
digest in any acceptance run before attributing behavior to this release.

## First-run credential provenance

The [qBittorrent 5.2.3 startup source](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/app/application.cpp#L3772-L3823)
generates a nine-character temporary password when the stored WebUI password
is empty, then prints the WebUI administrator username and the message
`A temporary password is provided for this session: ...`. The
[5.2.3 preferences source](https://raw.githubusercontent.com/qbittorrent/qBittorrent/release-5.2.3/src/base/preferences.cpp)
sets the default username to `admin` and leaves the stored password empty.
Therefore, on a genuinely fresh `/config`, `admin` plus the password from
that run's logs is source-supported; `adminadmin` or any other fixed password
is not.

Hotio launches qBittorrent-nox in the foreground from its service run script.
The tagged [nox main source](https://raw.githubusercontent.com/qbittorrent/qBittorrent/release-5.2.3/src/app/main.cpp)
also disables stdout buffering for the no-GUI build. That supports retrieval
from container stdout without a TTY. The
[upstream no-TTY fix](https://github.com/qbittorrent/qBittorrent/pull/20018)
specifically addressed the temporary-password line not appearing in Docker
logs. It is still necessary to inspect the actual current project logs and
fail closed if the expected line is absent.

The existing [bootstrap parser and login](../../scripts/bootstrap-core.ts#L83-L122)
POST URL-encoded `username` and `password` to `/api/v2/auth/login`, accepts
HTTP 200 or 204, and requires a `QBT_SID` cookie (optionally with a numeric
suffix). It strips ANSI color escapes and takes the last matching temporary
password line. The [identity setup](../../scripts/bootstrap-core.ts#L139-L188)
first tries the selected managed identity; on failure it obtains the temp
password and tries `LEGACY_STANDARD_USERNAME` (`admin`), writes the managed
username/password, then requires another successful login. Its temp-password
lookup retries project-scoped `docker compose logs qbittorrent` for up to ten
seconds; the log helper returns stdout without printing it
([log helper](../../scripts/lib/session-context.ts#L1359-L1390)).

The boundary matters: the parser retrieves a runtime-generated secret; it does
not derive or predict one. The username assumption is justified only for a
fresh default profile. On a reused/custom profile, qBittorrent can retain a
non-default username or a password, in which case the temp-password fallback
may not apply. Do not guess or silently fall back to a fixed password. If
reuse is supported, treat it as a separate recovery path requiring explicit,
already-managed credentials or a safely parsed startup username and a
documented reset procedure.

## WebUI API and cookie contract

The [official WebUI API v5 documentation](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29)
defines `POST /api/v2/auth/login` with form fields `username` and `password`,
cookie-based authentication, and requires either `Origin` or `Referer` to
match the request's Host (including port). The bootstrap supplies both headers
from its loopback base URL ([header helper](../../scripts/bootstrap-core.ts#L65-L80)).

The API documents `POST /api/v2/app/setPreferences` with a form field named
`json`; the object may include `web_ui_username` and `web_ui_password`. The
password is write-only in the preferences API, so a successful preference
write is not proof of the new secret. A fresh login using the managed identity
is the relevant verification. See the API's
[preference fields](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29#get-application-preferences)
and [set-preferences operation](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29#set-application-preferences).
The current bootstrap encodes the JSON object as that `json` form field and
includes both identity fields ([write call](../../scripts/bootstrap-core.ts#L190-L207)).

The wiki's login example calls the cookie `SID`, but the 5.2.3
[WebUI implementation](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp)
constructs it as `QBT_SID_<webui-port>`. Capturing the actual `Set-Cookie`
header is safer than hard-coding the documentation example; the current
bootstrap regex accepts both `QBT_SID` and `QBT_SID_<digits>`.

There is a response-status discrepancy worth preserving in acceptance checks:
the wiki documents login success as HTTP 200, while the tagged 5.2.3
[authentication controller](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/api/authcontroller.cpp)
and [API response mapping](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp)
produce an empty-body HTTP 204 for successful login. The current helper accepts
both, but status alone is insufficient; require the session cookie and then
an authenticated API read such as `GET /api/v2/app/version`.

Version history also warrants a fresh run: upstream tracked a v5.2 first-run
temporary-password WebAPI authentication regression in
[issue #23831](https://github.com/qbittorrent/qBittorrent/issues/23831), merged
a fix in [PR #23832](https://github.com/qbittorrent/qBittorrent/pull/23832),
and backported it to v5.2 in [PR #23823](https://github.com/qbittorrent/qBittorrent/pull/23823).
The 5.2.3 source is after that backport, but source ancestry does not prove
that the mutable Hotio image running in a future session contains the expected
build or that its runtime route succeeds.

## Fresh-isolated acceptance plan

Run only when Docker/live acceptance is explicitly in scope. Use one disposable
session with a unique Compose project name, an empty new session root (especially
an empty `config/qbittorrent`), a non-conflicting private host port, and no
reuse of another session's data. Record the exact pulled image digest/version
without exposing credentials.

1. Start only the scoped qBittorrent service through the owning harness. Poll
   the loopback WebUI/API at the `WEBUI_PORTS` port; do not assume readiness
   from container liveness alone.
2. Read that project's qBittorrent stdout internally. Select the newest
   temporary-password line from this fresh process. Keep the password, full
   line, cookies, and auth headers out of terminal output, reports, fixtures,
   screenshots, and artifacts. Abort if the line is absent; do not substitute
   a guessed value.
3. POST login as `admin` with the captured password, URL-encoded fields, and
   matching `Origin`/`Referer`. Accept 200 or 204 only when a `QBT_SID` cookie
   is returned. Use the cookie for authenticated `GET /api/v2/app/version`
   and require a successful version response.
4. POST `/api/v2/app/setPreferences` with the `json` form field containing the
   selected managed `web_ui_username` and derived session password. Do not
   read back or log the password.
5. Discard the temporary cookie, log in again with the managed identity, and
   require a new session cookie plus successful authenticated
   `GET /api/v2/app/version`. Optionally restart only this service and repeat
   the managed login to verify persistence.
6. Keep acceptance evidence to image digest/version, HTTP statuses, cookie
   presence (not value), authenticated version result, and pass/fail. Preserve
   or clean up the disposable session only through its approved project-scoped
   lifecycle; do not prune Docker resources or touch other projects.

## Verification boundary

This report establishes the route from source and checked-in code, not a live
credential round trip. No Docker, browser, image pull, API request, or focused
fixture was run. Runtime log wording, effective image version/digest, startup
readiness, login cookie issuance, preference persistence, and subsequent
authenticated access remain unverified and require the isolated acceptance
plan above.
