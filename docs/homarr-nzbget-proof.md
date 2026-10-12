# NZBGet Homarr slice: source and local proof

## Native activation: BLOCKED

Private tracker [#354](https://github.com/ajnart/selfhost-skills/issues/354)
blocks native activation and acceptance. The NZBGet leaf preflight returns
retryable Manual before any Homarr compatibility request, credential
creation/update, tile/widget mutation or native query. A currently valid login
cannot prevent a later rejected-credential request. Standalone NZBGet Setup and
owned Link removal stay separate; common reconciliation and registry are unchanged.

At both Homarr source revisions below, the adapter embeds the username/password
in the RPC path. On a rejected response, the original `ResponseError` retains
that Address. Integration settling logs the rejected cause; recursive error and
metadata formatting retain its string properties. The decorator sanitizes its
own log copy but rethrows the original cause. Console logging is source-confirmed;
Redis history and the browser terminal are conditional on Redis logging and
log-view permission. Ordinary connection-test 401/403 payloads omit the Address
and are not the established surface. No live leak, negative-auth runtime probe
or log read was observed or performed.

Resolution needs a supported HTTP Basic transport or complete downstream
credential-path redaction, reconciliation/review of the exact accepted Homarr
version/source contract, then explicit authorization of bounded acceptance.
No proxy, no-auth switch, direct-App-data substitute, upstream disclosure,
dependency update or activation test was introduced.

## Contract

The descriptor is `nzbgetTarget()` in `internal/apps/homarr/target_nzbget.go`.
Registry assembly stays with the #262 reference owner: this peer branch does
not register the descriptor or modify common reconciliation.

Homarr is exactly v2.4.1, tag commit
`ebbd4876d25a51151444a009ab596e1154d62880`. NZBGet's existing Catalog image
is `ghcr.io/nzbgetcom/nzbget:v26.3`, tag commit
`674787848dddabf9047b8fc1a75cf92fe6e41c55`. The parent recorded Homarr
OCI-source revision `3d4150e59f600876b7e308f857b2f21572b75348`; the
logging-risk source files agree with the researched tag. Source agreement is
not attestation of built-image contents. This lane obtained no running image
digest, and these source pins are not runtime compatibility proof.

The native integration kind is case-sensitive `nzbGet`, with `username` and
`password` secrets. Its internal Address is `http://nzbget:6789`; the
reference contract resolves the browser Address separately. Homarr's adapter
POSTs to `/<encoded username>:<encoded password>/jsonrpc`, not HTTP Basic
headers. NZBGet supports both forms. Our peer readiness uses Basic headers on
`/jsonrpc`, never embeds secrets in a request path or diagnostic. The native
path remains blocked, not merely pending a runtime redaction check. Do not retain
raw request/debug logs or provider configuration.

## Credentials and recovery

The restricted user is the minimum upstream role supporting `version`,
`status`, `listgroups` and `history`. The add-only user supports only append
and version; it cannot power Downloads. Restricted access is not read-only:
upstream also allows queue controls, reload and shutdown, but denies
`saveconfig` and masks protected settings. Homarr interaction permissions remain
separate; this slice invokes no download mutations.

NZBGet Setup stores a dedicated `self-host-homarr` login under
`NZBGET_HOMARR_USERNAME` and `NZBGET_HOMARR_PASSWORD` through `h.SetSecret`.
It does not share or change the Admin login. A valid saved restricted login is
reused. Active and persisted restricted-user settings must be empty or match
that saved managed login; another account, a lost secret or a mismatch becomes
an explicit retryable Manual step, never adoption or password rotation.

When the slot is empty, `h.ExecSecret` passes the generated credential in the
environment and changes only the two restricted-user lines in the App's
`/config/nzbget.conf`. The guarded edit rejects non-regular/symlink inputs and
duplicate/mismatched restricted-user lines. Python 3, explicitly installed by
the pinned image's Dockerfile, reads the original UID/GID and applies them to
the temporary file before private `0600` permissions and atomic rename. An
ownership/permission failure stops before rename and cleans up the temporary
file; it does not reset the owner, make the file world-readable or rely on the
entrypoint's restart-time chown. Existing provider and other configuration lines
are retained. The active-account-already-matches path therefore remains readable
without a restart. Only NZBGet restarts when the active login needs the saved
change. Failed/ambiguous edits request a permissions/slot review and retry with
the same managed login; a failed scoped restart identifies the saved settings
and the same retry. Neither path rotates credentials. This does not use
`saveconfig`: the tagged implementation omits every unsubmitted non-comment
setting when rewriting the complete file.

Every App Check probes afresh; the held Link preflight performs no request.
RPC readiness requires anonymous RPC
rejection, the saved Admin login and exact version 26.3, matching restricted
account settings, authenticated restricted version, explicit numeric
`DownloadRate`, boolean `DownloadPaused`, and actual queue/history arrays.
Explicit zero rates, false and empty arrays are valid; HTTP/authentication,
body errors, missing/null results and incomplete records are not.

Setup separately records `usenet-provider` as retryable Manual when active
Admin `config` evidence has no enabled, non-placeholder provider host with a
valid port and positive bounded connection count. The check discovers returned
`Server<N>` settings instead of inventing a server, accepts NZBGet's documented
enabled aliases/default when `Active` is absent, and excludes the shipped
`my.newsserver.com` placeholder. It reads only the relevant configuration fields
into the decision, never prints provider settings or uses provider credentials.
This establishes settings only: no account creation, automatic provider
configuration, NNTP connection, provider authentication or download is performed
or proven. `App.Check` still reports authenticated RPC readiness with a valid
idle queue; a missing provider remains a separate Setup prerequisite.

## Widgets

Downloads shows native queue plus retained history, capped at 50 items, with
name, progress, download speed, time and state. No job or download is created;
identifiers come from NZBGet's real `NZBID` values. Homarr's tagged adapter maps
queue `Status` and history `ScriptStatus`; this slice does not reinterpret
that mapping as proof of a completed provider transfer.

Shared Stats adds only `download` (bytes/second) and `paused` (boolean).
The tagged catalog also advertises `upload`, but NZBGet's adapter has no upload
rate and the Stats provider returns null; no upload tile or fake zero is added.
Before any native query, the native verifier reads supported `integration.byId`
metadata and requires the exact integration ID, `nzbGet` kind and internal
Address, exactly one public `self-host-homarr` username and one explicit null
password value. Missing/extra/duplicate kinds, missing values, an Admin/foreign
username or an exposed password remain Manual for explicit owned-record repair;
no record is adopted or credential changed. Null is the upstream redaction
contract, not proof that the stored password matches. Subsequent peer/native
authentication would establish that only after #354 is resolved and activation
is authorized. Queue status, bounded items and supported Stats keys are still
validated. Downloads uses Homarr's ten-second
cache; Stats has a separate hourly snapshot/refresh path. Direct peer probes
are fresh, but catalog/readback alone does not prove a rendered Stats result.

## Local evidence and gaps

The existing focused NZBGet Setup/Check, rerun and wrong-password bodies use the
expanded fixture with a saved restricted login, explicit zero rate and empty
queue/history. Direct coverage includes failed-edit/no-restart and same-login
retry, the actual guarded script on a test-owned local file preserving UID/GID,
`0600` and unrelated configuration, active-login/no-restart recovery, failed
scoped-restart/same-settings retry, and a separate provider Manual followed by
configured-settings retry while idle RPC remains valid. Root-exec-to-daemon
ownership is supported by the script controls and pinned image source, not
tested against a real container or different local owner. Leaf source assertions
cover the unconditional #354 preflight hold and saved-identity/explicit-null
guards before native queries; they are not executable Homarr metadata acceptance
or activation tests. No new test functions, cases, files or dependencies were
added. Existing Homarr tests still exercise the reference descriptors, not this
unregistered one.

Passed from this clean-base worktree with `GOFLAGS=-buildvcs=false`:

- `go test ./internal/apps/nzbget ./internal/apps/homarr`
- `gofmt -l .` (empty) and `git diff --check`
- `go build ./...`, `go vet ./...`, `go vet -tags e2e ./e2e/`
- `go test ./...` (without the Docker runtime build tag)
- `go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/nzbget/ ./internal/apps/homarr/`
- `bash -n install.sh`

Source/local validation only. No Docker, browser, installer, real download,
provider connection, Usenet account creation or person's Project access was
performed. Full functional acceptance remains open:

- Reference-owner registry assembly and a real Homarr-created integration ID.
- #354 resolution, reviewed exact version/source compatibility and authorization
  before any native credential write or activation.
- Exact running versions and resolved image digests; real root-exec/daemon-owned
  config edit, failure/retry/restart and authentication-path behavior against
  the actual images.
- Authenticated Downloads plus a meaningful rendered result from harmless
  owned queue/history data; supported Stats refresh/snapshot and rendered data.
- Real provider-unavailable/account limits, distinguished from the source/local
  settings-only prerequisite and a valid authenticated idle queue.
- Both installation orders, late peer, wait/retry, rerun/restart, credential
  changes, removal/reinstallation, stable owned IDs, shared Stats retention and
  preservation of user-authored resources in the approved disposable Project.

## Primary sources

- [Homarr v2.4.1 integration definition](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/definitions/src/integration.ts)
- [Homarr NZBGet adapter](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/download-client/nzbget/nzbget-integration.ts)
- [Homarr integration metadata/redaction](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/integration/integration-router.ts#L155-L224)
- [NZBGet provider option parsing](https://github.com/nzbgetcom/nzbget/blob/674787848dddabf9047b8fc1a75cf92fe6e41c55/daemon/main/Options.cpp#L937-L1044)
- [Homarr Downloads router](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/api/src/router/widgets/downloads.ts)
- [Homarr Downloads options](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/widgets/src/downloads/index.ts)
- [Homarr Stats provider](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/stats/existing.ts)
- [Homarr Stats refresh/cache](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/request-handler/src/stats.ts)
- [NZBGet v26.3 role definitions](https://github.com/nzbgetcom/nzbget/blob/v26.3/nzbget.conf)
- [NZBGet authentication paths](https://github.com/nzbgetcom/nzbget/blob/v26.3/daemon/remote/WebServer.cpp)
- [NZBGet RPC authorization](https://github.com/nzbgetcom/nzbget/blob/v26.3/daemon/remote/XmlRpc.cpp)
- [NZBGet complete-file save behavior](https://github.com/nzbgetcom/nzbget/blob/v26.3/daemon/extension/ScriptConfig.cpp)
- [NZBGet image/startup](https://github.com/nzbgetcom/nzbget/blob/v26.3/docker/entrypoint.sh)
- [NZBGet runtime image](https://github.com/nzbgetcom/nzbget/blob/v26.3/docker/Dockerfile)

The conditional logging chain is public source; #354 remains private coordination:

- [Credential-bearing RPC path](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/download-client/nzbget/nzbget-integration.ts#L116-L123)
- [Original ResponseError Address](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/common/src/errors/http/response-error.ts#L5-L10)
- [Settling logger](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/settle-integrations.ts#L39-L44)
- [Recursive cause formatting](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/error.ts#L22-L53)
- [String metadata formatting](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/metadata.ts#L9-L14)
- [Decorator sanitizes its own copy, rethrows original](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/base/errors/decorator.ts#L37-L145)
- [Console transport](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/transports/index.ts#L7)
- [Conditional Redis log history](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/transports/redis-transport.ts#L28-L51)
- [Permission-gated log API](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/log.ts#L55-L60)
- [Browser log terminal](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/apps/nextjs/src/app/%5Blocale%5D/manage/tools/logs/terminal.tsx#L159-L165)
