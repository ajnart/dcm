# NZBGet Homarr slice: source and local proof

## Native activation: fixed-version gate

Current-release delivery covers source-reviewed integration support;
provider/account and hardware runtime verification is deferred. The #354 privacy
hold now probes authenticated `info.getInfo` first. Only exact Homarr API
`2.5.1` or `2.5.2` proceeds to the existing NZBGet restricted-login verifier.
Older, unreadable, malformed, unknown and unreviewed versions remain retryable
Manual before any peer request, integration/native query or Homarr mutation.
Do not bypass that hold or create a manual integration. Owned Link removal and
standalone NZBGet Setup stay separate.

[Hotfix #7170](https://github.com/homarr-labs/homarr/pull/7170), shipped in
2.5.1, moves NZBGet authentication from the RPC path to HTTP Basic headers and
fixes downstream integration failure logging. The exact 2.5.2 source
`7eb9a417a60d759adce5f7ac15ceb594aefad471` retains the audited APIs and privacy
owners unchanged from the fixed 2.5.1 image source. The
[shared contract](homarr-integration-contract.md) records the authenticated API
and image/source evidence separately. Those observations do not establish real
NZBGet native/rendered, provider or lifecycle acceptance.

Historically, #354 blocked all Link HTTP because Homarr 2.4.1 embedded
credentials in the RPC path and preserved the rejected Address through
ResponseError and downstream logging. No live leak or private log read was
performed. The common persisted hint remains custodian-owned; this leaf does
not edit reconciliation, registry or removal behavior.

## Contract

The descriptor is `nzbgetTarget()` in `internal/apps/homarr/target_nzbget.go`.
Registry assembly stays with the #262 reference owner: this peer branch does
not register the descriptor or modify common reconciliation.

The historical Homarr baseline was v2.4.1, tag commit
`ebbd4876d25a51151444a009ab596e1154d62880`. NZBGet's existing Catalog image
is `ghcr.io/nzbgetcom/nzbget:v26.3`, tag commit
`674787848dddabf9047b8fc1a75cf92fe6e41c55`. The parent recorded Homarr
OCI-source revision `3d4150e59f600876b7e308f857b2f21572b75348`; the
logging-risk source files agree with the researched tag. Source agreement is
not attestation of built-image contents. This lane obtained no running image
digest, and these source pins are not runtime compatibility proof.

The native integration kind is case-sensitive `nzbGet`, with `username` and
`password` secrets. Its internal Address is `http://nzbget:6789`; the
reference contract resolves the browser Address separately. Homarr's
historical adapter POSTs to `/<encoded username>:<encoded password>/jsonrpc`.
NZBGet supports both forms. Our peer readiness uses Basic headers on
`/jsonrpc`, never embeds secrets in a request path or diagnostic. The native
2.5.1/2.5.2 adapter instead uses HTTP Basic on `/jsonrpc`; older versions
remain blocked. Do not retain raw request/debug logs or provider configuration.

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

Every App Check probes afresh. The Link preflight checks the fixed Homarr version
before invoking the same restricted-login readiness owner.
RPC readiness requires anonymous RPC
rejection, the saved Admin login and exact version 26.3, matching restricted
account settings, authenticated restricted version, explicit numeric
`DownloadRate`, boolean `DownloadPaused`, and actual queue/history arrays.
Explicit zero rates, false and empty arrays are valid; HTTP/authentication,
body errors, missing/null results and incomplete records are not.

Setup separately records `usenet-provider` as retryable Manual when active
Admin `config` evidence has no enabled, non-placeholder provider host with a
valid port and positive bounded connection count. The check discovers returned
canonical `Server<N>` settings instead of inventing a server. As pinned
`Options::InitServers` does, it starts at 1, continues through disabled or
incomplete definitions and stops at the first absent definition, ignoring
retained settings beyond that gap. Definition presence is tracked before
filtering decision values using exactly upstream's fields: `Active`, `Name`,
`Level`, `Group`, `Host`, `Port`, `Optional`, `Username`, `Password`,
`Connections`, `JoinGroup`, `Encryption`, `Cipher`, `Retention`.
Unknown fields, `Notes`, `IpVersion` and `CertVerification` do not count; signed
or leading-zero indexes never alias loaded canonical names. A simple loop is
bounded by the number of discovered definitions, not the largest returned index.
The check accepts NZBGet's documented enabled aliases/default when `Active` is
absent and excludes the shipped
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
authentication still needs actual native runtime evidence; the fixed-version
gate alone does not establish it. Queue status, bounded items and supported
Stats keys are still validated. Downloads uses Homarr's ten-second
cache; Stats has a separate hourly snapshot/refresh path. Direct peer probes
are fresh, but catalog/readback alone does not prove a rendered Stats result.

## Local evidence and gaps

The existing focused NZBGet Setup/Check, rerun and wrong-password bodies use the
expanded fixture with a saved restricted login, explicit zero rate and empty
queue/history. Direct coverage includes failed-edit/no-restart and same-login
retry, the actual guarded script on a test-owned local file preserving UID/GID,
`0600` and unrelated configuration, active-login/no-restart recovery, failed
scoped-restart/same-settings retry, and a separate provider Manual followed by
configured-settings retry while idle RPC remains valid. The same existing
fixture sequence now checks Server2 alone, disabled/incomplete recognized
Server1 prefixes followed by valid Server2, fields excluded from definition
presence, a missing Server2 before valid Server3 and noncanonical indexes.
These prove source/local settings decisions, not provider connectivity or
NZBGet runtime loading. Root-exec-to-daemon
ownership is supported by the script controls and pinned image source, not
tested against a real container or different local owner. Leaf source assertions
now check the fixed-version gate before restricted readiness and the saved-identity/
explicit-null guards before native queries. Focused HTTP fixtures additionally
exercise the version and credential boundaries; these remain synthetic source
validation, not real native acceptance. No dependencies were added.

Historical validation before this fixed-version update, with `GOFLAGS=-buildvcs=false`:

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
- Real rejected-credential privacy and native activation evidence in the fixed image.
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

## 13 October shared Stats and Downloads migration

The original branch forward-merges the shared Stats/Downloads SDK and its
retry metadata without rewriting history. `nzbgetTarget()` keeps native
readiness, identity and queue semantics and uses `readDownloadsQueue` for
one owned Downloads result with an explicit items array and a requested
limit of 50. The shared owner acquires the catalog and exactly one forced,
positive advancing sample per `verifyData` invocation; `verifyNZBGetStats`
validates that same sample's units and types. Rates remain finite nonnegative
bytes/second and paused remains boolean with catalog unit `text`.
Only download and paused remain selected; unsupported nullable upload is
not coerced to zero. Finite negative completion times remain accepted.

Focused descriptor HTTP fixtures use the existing `statsFixture`, reject the
first invalid refreshed value without resampling, no-op refresh, wrong units,
wrong value types and foreign Downloads identity, and stop before the Stats
catalog on native failure. Explicit zero Stats remain valid even when the
independently sampled native rate or paused state differs. Local fixture
responses are synthetic and establish no real App/native/rendered acceptance.
The affected descriptor tests, shared Stats/Downloads tests, App tests,
package build/vet, gofmt and diff checks passed. No Docker/browser runtime,
provider request, download or protected Project state was used.

## 13 October fixed-version privacy gate

This leaf forward-merges shared SDK commit
`a62010719833f6db05810231fd1f1764d387c593` without rewriting history and uses
`requireCredentialSafeHomarr` before `nzbget.VerifyHomarr`. It preserves the
managed restricted identity, active/saved account agreement, anonymous RPC
rejection, native Downloads validators and one shared Stats sample.

Focused fake HTTP fixtures failed against the former unconditional hold and
passed after this change. Both Check/apply stop after exactly one `info.getInfo`
request for unsafe/unreadable versions, with no peer or other Homarr request.
Both fixed versions reach genuine restricted readiness. Rejected native
credentials fail in both paths before any further Homarr request or mutation.
The descriptor's native/Stats fixtures and affected App tests pass; formatting,
package build/vet and diff checks also pass. No Docker, browser, private Project,
real Usenet request, provider login or download was used. Real rendered and
lifecycle acceptance remains deferred.
