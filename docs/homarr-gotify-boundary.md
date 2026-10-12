# Gotify Homarr implementation boundary

Issue #282; source implementation, not live functional proof.

## Contract

- Homarr: `ghcr.io/homarr-labs/homarr:v2.4.1`, source
  `ebbd4876d25a51151444a009ab596e1154d62880`. The shared version and
  `integration.getKinds` gates apply when the reference owner registers
  `gotifyTarget()`; this peer does not modify `targets.go` or reconciliation.
- Gotify: compiled `gotify/server:3.1.1`. No new dependencies or privileges.
  Runtime image digests are unrecorded because runtime verification is gated.
- Native kind `gotify`, internal Address `http://gotify:80`; the tile and
  notification deep links use the separately resolved browser Address.
- Exact credential shape: `username`, `password`, HTTP Basic authentication.
  No unauthenticated alternative, application token, or client token fallback.

## Account and visibility

Gotify Setup verifies the existing Admin login, then creates one non-admin
`self-host-homarr` account if that name does not exist. The generated password,
username and returned numeric account ID are saved with `h.SetSecret` as
`GOTIFY_HOMARR_PASSWORD`, `GOTIFY_HOMARR_USERNAME` and `GOTIFY_HOMARR_USER_ID`.
The password is saved before creation so an ambiguous response cannot cause
blind credential rotation. A valid recorded account is reused on every retry.

A same-name account without a usable recorded login remains Manual. Restore
the login and ID through the Project secret boundary only after deciding
ownership privately; do not delete the account, applications or messages.
Existing Projects can retry `self-host setup gotify` to create the missing
account. Recreating a container does not reset a database's administrator.

Messages belong to the user that owns their sending application. The new
account cannot read the administrator's or other users' messages. Sending
applications must be created while signed in as `self-host-homarr`; this is
an intentional least-privilege visibility boundary, not server-wide delivery.
Gotify does not provide a read-only username/password role: a standard user
can manage its own resources, but cannot administer other users. Routine
Setup/Check and Link verification never send, delete or acknowledge messages,
create a client, subscribe a device, or enable public registration.

## Widgets and checks

The defaults are native `notifications` with visible application logos and
plain message formatting, plus the owned shared Stats entry `messages`.
Both accept Gotify without an application selector; no identifier is guessed.
The notifications widget remains distinct from ntfy and other connections.
The #262 ownership contract preserves unrelated shared Stats/Calendar entries
and user-authored integrations and widgets.

Every Check probes the recorded non-admin identity and authenticated
`GET /message?limit=100` afresh, including required message/paging fields.
An explicit empty message array with size zero is valid; missing/null fields
and rejected authentication are not zeros.

The Link first verifies `/current/user` through Homarr's saved connection using
the supported `integration.request` mutation with `method: GET`. It requires
the exact integration ID/kind, upstream success with HTTP 200, the recorded
numeric Gotify account ID and strict `admin: false`. Missing or malformed
identity, a different account, and administrator credentials fail before native
data can be accepted. Homarr redacts the saved username in the response;
identity is established by the account ID, not by adopting that response name.
This read does not create, rotate or alter any account.

The Link reads `widget.stats.catalog` to confirm the `messages` count metric,
then polls `widget.notifications.getNotifications` scoped to the exact
integration using the existing polling helper and a 30-second context deadline.
It validates the result's integration identity, error state, native
`integration.updatedAt` and message fields. Homarr caches successful notification
reads for ten seconds; only an actual native timestamp within this polling
attempt is accepted. Older, future, missing or malformed timestamps never turn
cached empty messages into fresh success. A fresh authenticated empty array is
valid. Polling only reads data, without invalidation, fabricated timestamps or
notification sends.
`widget.stats.refresh` with `force: true` refreshes Homarr's cache using only
Gotify GET requests; this cache mutation does not change Gotify. Error, stale,
missing timestamp, a timestamp before the refresh attempt, missing value, and
invalid count fail verification. Compose containers share the Host clock; an
older snapshot returned while another refresh holds the lock is not accepted
as this attempt's fresh success.
The `messages` count means retrieved notifications, capped at 100 by the
adapter, not all-time volume, unread messages, or verified device delivery.
It can differ from a separately fetched list when messages arrive between reads.

## Acceptance still required

The descriptor is deliberately unregistered until the reference owner assembles
the approved peers. Runtime remains blocked on the reference proof/capacity gate.
Local checks and saved configuration do not prove a rendered widget.

Next phase must use an approved disposable loopback-only Project, development
Telemetry disabled, exact image digests recorded, and no person's credentials,
private files, Project or devices. Use the isolated account and one scoped
disposable application with one known fixture message, at most once; do not
send routine test notifications or reuse a real device subscription. Verify
that message through Homarr and the rendered notifications/Stats widgets.
Then prove both installation orders, late-peer/retry, restart, credential
updates, removal/reinstallation, stable owned IDs and preservation of user
resources. Cleanup must remain scoped to the approved disposable resources.

## Local verification

The local gate passed on the committed #262 reference
`b8f5ea0b27c1641079b834b280cc28b067119b1d` plus this
peer's changes: clean `gofmt -l .`, `go build ./...`, `go vet ./...`,
`go vet -tags e2e ./e2e/`, `go test ./...`, `bash -n install.sh`, and
`go test -race` for TUI, Activity, Gotify and Homarr, with
`GOFLAGS=-buildvcs=false`. The existing Gotify fake was updated to cover its
new account step, legitimate empty messages and rerun reuse; no new test
functions or dependencies were added. These are source/local-fixture results,
not Docker, native rendered widget or isolated lifecycle acceptance.

The source review correction remains on that frozen base; no reference merge,
registration, shared Stats normalization or common reconciliation edit was
performed. The custodian owns assembly onto the merged #309 reference
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`, including its central post-leaf
`freshStatsSnapshot` gate. Existing fixtures do not exercise this deliberately
unregistered descriptor; both corrected checks still require fresh source review
and approved native acceptance.

## Official sources

- [Homarr Gotify guide](https://homarr.dev/docs/integrations/gotify/)
- [Gotify user/message scope](https://gotify.net/docs/)
- [Gotify API documentation](https://gotify.net/api-docs)
- [Homarr 2.4.1 credentials](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Homarr Gotify adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/gotify/gotify-integration.ts)
- [Homarr notification query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/notifications.ts)
- [Homarr saved-connection request schema and response redaction](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/integration/integration-request.ts)
- [Homarr integration request route](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/integration/integration-router.ts)
- [Homarr saved-connection authentication and permission gate](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/integration/integration-http.ts)
- [Homarr native notification cache and timestamps](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/lib/request-handler.ts)
- [Homarr Stats metric](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Homarr Stats refresh/error contract](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [Gotify 3.1.1 account API](https://github.com/gotify/server/blob/v3.1.1/api/user.go)
- [Gotify 3.1.1 message API](https://github.com/gotify/server/blob/v3.1.1/api/message.go)
