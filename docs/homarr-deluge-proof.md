# Deluge native Homarr Link: implementation evidence

## Status

Source-backed implementation for #275, based on the fixed committed #262 head
`cf8f04c07da6a0394c30c5000906ac441ca4601c` (updated from the `573a206e`
checkpoint). No Docker, browser, installer,
download or person's Project was used. This is not functional acceptance.

The descriptor is intentionally not registered in this lane. The #262 registry
owner must add `delugeTarget()` in `internal/apps/homarr/targets.go` and complete
the reference compatibility acceptance. Shared reconciliation is unchanged.
The fixed reference pins `ghcr.io/homarr-labs/homarr:v2.4.1` and includes the
absent-peer scheduling and user-binding preservation fixes. None of the
reference lane's uncommitted files were copied.

The newer frozen contract at `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`
and tested contract at `89301aff17c86b767f5a45076881f2bb7b41db39` were read
without importing common code or changing this base. Parent-owned normalization
must retain the newer common Stats freshness guard and picker App-email choice;
neither exists in this peer's fixed base. No duplicate freshness guard was added.

## Credential and readiness contract

Deluge 2.2.0 (`lscr.io/linuxserver/deluge:2.2.0-ls381`) authenticates its Web
JSON-RPC at `POST /json` using `auth.login([password])`, then the returned
`_session_id` cookie. Setup verifies `auth.check_session` with that new cookie.
Ambient HTTP cookie jars are disabled for these calls, redirects are rejected,
and HTTP/error responses are not dumped. Temporary sessions are deleted after
use. A rejected password is not rescued by an earlier authenticated session.

Setup saves the verified password as `DELUGE_WEB_PASSWORD` through `h.SetSecret`.
A valid saved password is reused, including after an Admin login change. Existing
Projects without it discover the Admin password by a fresh authenticated probe.
Only when that fails does Setup try the documented initial password and change it
to the non-default Admin password with `auth.change_password([old, new])`, verifying
a fresh login before saving. Unknown changed passwords stop with an actionable
`self-host setup deluge` recovery hint; no password is read from App files.

The parent-authorized picker exception adds only a labelled `Deluge Web password`
choice when `creds.Apps["deluge"]["DELUGE_WEB_PASSWORD"]` is nonempty. Its row
stores only the App/key/label. Enter rereads the credential through the existing
private clipboard path; values never enter rendered rows or the copied notice.
Admin, API-key/token and login-alias choices and the row layout are unchanged.

Web authentication is separate from daemon credentials. Setup requires
`web.connected` and authenticated `web.update_ui` to return a connected queue,
a present torrent object and nonnegative `download_rate`/`upload_rate`. An empty
object with explicit zero rates is valid. It does not mean a download was tested.

When disconnected, Setup reads `web.get_hosts`, which returns identifiers,
addresses, ports and usernames, not passwords. It connects only an unambiguous
existing loopback entry on Deluge's documented default daemon port, using the
discovered identifier. An existing default connection is respected, never
replaced. Missing/ambiguous local connections become a retryable Manual step.
Setup checks `web.connected` before discovery and immediately before
`web.connect`. An already-connected daemon, including one selected during
discovery, is preserved: its actual queue verdict is returned without connecting
to another daemon or writing `default_daemon`. Missing rates are not permission
to switch a person's active remote connection to a local daemon.
After connecting a fresh local entry, Setup saves and reads back `default_daemon`
through `web.set_config`/`web.get_config` so upstream can reconnect after restart.
No daemon credential, new host entry or published port is created.

## Homarr contract

The native `deluge` integration uses internal Address `http://deluge:8112` and
exactly `[{kind: "password", value: <saved Web password>}]`. There is no username,
daemon password or unauthenticated fallback. The common Link keeps the browser
Address separate and owns integration/widget IDs, updates and removal.

Useful defaults are a native Downloads widget with name, progress, download/upload
speed, time and state columns, limited to 50 items; and the shared Stats fields
`download`, `upload` (bytes/second), and `paused` (boolean displayed as text).

Verification first probes Deluge with its saved credential, then reads
`widget.downloads.getJobsAndStatuses` through Homarr with only the owned
integration ID and the 50-item limit. It requires the exact integration/kind,
queue state, explicit transfer rates, torrent type and item array. Returned items
need real identifiers/names, supported states and progress in [0, 1], finite signed
`time` and nonnegative finite `upSpeed`/`downSpeed`. Only `progress == 1` permits
an omitted download speed; the adapter omits it for completed torrents, and the
native schema explicitly infers completion from that progress value. The pinned
API uses SuperJSON 2.2.6, which serializes `undefined` as JSON null; the existing
common decoder returns that JSON without metadata, so this completed-only
exception accepts absent/null `downSpeed` without inventing zero. Other selected
numeric fields and unfinished download speeds reject missing/null/nonnumeric/
nonfinite values; provided speeds reject negative values. Negative completion time is
valid. Unexpected states still fail rather than bypassing validation. The adapter
and schema were checked at both the tagged source
`ebbd4876d25a51151444a009ab596e1154d62880` and the reference's resolved-image
revision `3d4150e59f600876b7e308f857b2f21572b75348`; their selected-field semantics
match. This source check is not this lane's runtime/image acceptance.
Per-integration errors fail; explicit empty authenticated data passes.
`widget.stats.catalog` must expose all three selected metric keys.

## Local evidence

Existing Deluge fixtures were updated to the upstream authenticated session,
daemon discovery, connection and queue response shapes. Existing checks now cover
initial rotation, saved-password reuse, no repeat rotation, reconnection after a
simulated disconnect, Admin login changes, and rejected passwords despite an
ambient valid session. These are fakes, not an upstream/runtime proof.

The same existing Deluge test body now asserts no `web.connect` or configuration
write after an already-connected malformed queue, preserves a daemon selected
during discovery, and leaves an unknown remote default Manual. The existing
copy-modal test body exercises the saved Web-password identifier, fresh private
fetch after an Admin change, and label-only clipboard notice at 80x24. Both
regressions failed on the preceding implementation and passed after correction.

The local gate passes: `gofmt -l .`, `go build ./...`, `go vet ./...`,
`go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/deluge/`,
and `bash -n install.sh`; build/vet use `GOFLAGS=-buildvcs=false`.
The Homarr descriptor compiles, but the committed registry does not exercise it.
All existing Homarr tests are external-package/registry-driven: no reachable
Deluge native-item validation seam exists within the permitted file scope.
Malformed/missing native display-field controls remain unexecuted pending
parent-owned registration and isolated native acceptance; no test seam was added.
No dependencies were added and no new test functions were added.

## Remaining functional acceptance

After registry/reference acceptance and parent capacity approval, use only a
disposable isolated Project with development Telemetry disabled. Record exact
Homarr/Deluge versions and resolved image digests. Verify wrong-password denial
with a fresh session, daemon-disconnected distinction, real data through Homarr
and rendered Downloads/Stats with a scoped owned paused fixture, both installation
orders, late-peer readiness/retry, reruns/restart, credential updates, and
removal/reinstallation while preserving manual resources and other Stats bindings.
No public torrent, network/download activity, new port or public Access is implied.

## Sources

- [Official Homarr Deluge guide](https://homarr.dev/docs/integrations/deluge/)
- [Homarr v2.4.1 integration definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Homarr Deluge adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/download-client/deluge/deluge-integration.ts)
- [Homarr native download item schema](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/interfaces/downloads/download-client-items.ts)
- [Resolved-image Deluge adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/download-client/deluge/deluge-integration.ts)
- [Resolved-image download item schema](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/interfaces/downloads/download-client-items.ts)
- [Homarr tRPC transformer](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/trpc.ts)
- [Homarr pinned SuperJSON dependency](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/bun.lock)
- [SuperJSON 2.2.6 undefined serialization](https://unpkg.com/superjson@2.2.6/dist/transformer.js)
- [Homarr Downloads options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/downloads/index.ts)
- [Homarr Downloads query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/downloads.ts)
- [Homarr native Stats fields](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Homarr Stats catalog](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/stats.ts)
- [Deluge 2.2.0 Web authentication](https://github.com/deluge-torrent/deluge/blob/deluge-2.2.0/deluge/ui/web/auth.py)
- [Deluge 2.2.0 JSON-RPC](https://github.com/deluge-torrent/deluge/blob/deluge-2.2.0/deluge/ui/web/json_api.py)
- [Deluge 2.2.0 host discovery](https://github.com/deluge-torrent/deluge/blob/deluge-2.2.0/deluge/ui/hostlist.py)
- [Deluge 2.2.0 reconnect settings](https://github.com/deluge-torrent/deluge/blob/deluge-2.2.0/deluge/ui/web/server.py)
- [Official LinuxServer Deluge guide](https://docs.linuxserver.io/images/docker-deluge/)
