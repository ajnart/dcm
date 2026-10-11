# NZBGet Homarr slice: source and local proof

## Contract

The descriptor is `nzbgetTarget()` in `internal/apps/homarr/target_nzbget.go`.
Registry assembly stays with the #262 reference owner: this peer branch does
not register the descriptor or modify common reconciliation.

Homarr is exactly v2.4.1, tag commit
`ebbd4876d25a51151444a009ab596e1154d62880`. NZBGet's existing Catalog image
is `ghcr.io/nzbgetcom/nzbget:v26.3`, tag commit
`674787848dddabf9047b8fc1a75cf92fe6e41c55`. These source pins are not
resolved image digests or runtime compatibility proof.

The native integration kind is case-sensitive `nzbGet`, with `username` and
`password` secrets. Its internal Address is `http://nzbget:6789`; the
reference contract resolves the browser Address separately. Homarr's adapter
POSTs to `/<encoded username>:<encoded password>/jsonrpc`, not HTTP Basic
headers. NZBGet supports both forms. Our peer readiness uses Basic headers on
`/jsonrpc`, never embeds secrets in a request path or diagnostic. The runtime
phase must check redaction around Homarr's upstream credential-path behavior;
do not retain raw request/debug logs or provider configuration.

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
`/config/nzbget.conf`. A temporary file, duplicate/mismatch checks and rename
prevent a rejected edit from replacing the file. Existing provider and other
configuration lines are retained. Only NZBGet restarts when the active login
needs the saved change. This does not use `saveconfig`: the tagged implementation
omits every unsubmitted non-comment setting when rewriting the complete file.

Every Check and Link preflight probes afresh. Readiness requires anonymous RPC
rejection, the saved Admin login and exact version 26.3, matching restricted
account settings, authenticated restricted version, explicit numeric
`DownloadRate`, boolean `DownloadPaused`, and actual queue/history arrays.
Explicit zero rates, false and empty arrays are valid; HTTP/authentication,
body errors, missing/null results and incomplete records are not.

## Widgets

Downloads shows native queue plus retained history, capped at 50 items, with
name, progress, download speed, time and state. No job or download is created;
identifiers come from NZBGet's real `NZBID` values. Homarr's tagged adapter maps
queue `Status` and history `ScriptStatus`; this slice does not reinterpret
that mapping as proof of a completed provider transfer.

Shared Stats adds only `download` (bytes/second) and `paused` (boolean).
The tagged catalog also advertises `upload`, but NZBGet's adapter has no upload
rate and the Stats provider returns null; no upload tile or fake zero is added.
The native verifier checks the returned integration ID/kind, queue status,
bounded items and supported Stats keys. Downloads uses Homarr's ten-second
cache; Stats has a separate hourly snapshot/refresh path. Direct peer probes
are fresh, but catalog/readback alone does not prove a rendered Stats result.

## Local evidence and gaps

The existing focused NZBGet Setup/Check, rerun and wrong-password cases use the
expanded fixture with a saved restricted login, explicit zero rate and empty
queue/history. No new test cases or dependencies were added. Existing Homarr
tests still exercise the reference descriptors, not this unregistered one.

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
- Exact running versions and resolved image digests; scoped config edit/restart
  and authentication-path behavior against the actual images.
- Authenticated Downloads plus a meaningful rendered result from harmless
  owned queue/history data; supported Stats refresh/snapshot and rendered data.
- Missing provider/account limits, distinguished from a valid idle queue.
- Both installation orders, late peer, wait/retry, rerun/restart, credential
  changes, removal/reinstallation, stable owned IDs, shared Stats retention and
  preservation of user-authored resources in the approved disposable Project.

## Primary sources

- [Homarr v2.4.1 integration definition](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/definitions/src/integration.ts)
- [Homarr NZBGet adapter](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/download-client/nzbget/nzbget-integration.ts)
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
