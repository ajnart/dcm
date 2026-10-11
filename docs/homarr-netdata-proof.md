# Netdata Link: source verification, runtime pending

Issue: [#287](https://github.com/ajnart/selfhost-skills/issues/287).
Reference: [#262](https://github.com/ajnart/selfhost-skills/issues/262) and
[the shared Link contract](homarr-integration-contract.md).

## Exact upstream contract

Read-only registry inspection on 2026-10-11 confirmed that
`ghcr.io/homarr-labs/homarr:v2.4.1` exists, with index digest
`sha256:ee67a5e856c051c4e114418a54b89a3fc3cb5507d0689e5cb89c790305c549cd`.
Its Linux arm64 manifest is
`sha256:308feba8b9845cbdb21eb2e1b05579d49fb815bf3f0a452e58b59fcd4db8ecd2`.
The image's OCI revision label is
`3d4150e59f600876b7e308f857b2f21572b75348`; its OCI version label is `main`.
The actual image revision was checked as well as the reference's release
source `ebbd4876d25a51151444a009ab596e1154d62880`: the Netdata credential
shape, Stats provider, refresh response and widget compatibility agree.
Registry metadata is not a running-version or functional acceptance claim.
The common Link must still verify authenticated `info.getInfo` is `2.4.1`.

- Kind `netdata`, internal Address `http://netdata:19999`, port `19999`.
- The only credential alternative is `[]`; the adapter sends no token.
  The shared transport serializes an explicit empty array, not `null`.
  Existing bearer protection or denied access is not disabled or bypassed.
- Native widget `stats`, metrics `warnings` and `criticals`, both counts.
  The provider reads `alarms.warning` and `alarms.critical` from
  `/api/v1/info`; both must be nonnegative integers, including explicit zero.
  Missing fields and refresh failures are not an empty alarm dataset.
- Netdata is not a supported System Resources or Health Monitoring kind.
  No dedicated Netdata widget or machine/chart selection is invented.
- `widget.stats.refresh` accepts `{integrationId, force: true}` and returns
  `{values, updatedAt, retryAt, error, stale}`. The verifier requires both
  false flags, a timestamp from this refresh and both explicit valid counts.
  This avoids accepting Homarr's ordinary one-hour cached snapshot as fresh.

Sources at the registry image's declared revision:

- [Integration definition](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/definitions/src/integration.ts)
- [Netdata Stats provider](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/providers/netdata.ts)
- [Stats router](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/stats.ts)
- [Stats refresh/cache](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/request-handler/src/stats.ts)
- [Widget compatibility](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/definitions/src/widget-integration-map.ts)

## Netdata readiness and authority

The compiled App remains `netdata/netdata:v2.11.0`, with unchanged Compose.
Setup and Check fetch fresh JSON every time, verify explicit local alarm
counts, discover the agent CPU chart from `/api/v1/charts`, and query its
returned identifier through `/api/v1/data`. Selection uses the declared
`netdata.server_cpu` context, `netdata` plugin, `pulse` module and
`milliseconds/s` units. A missing or ambiguous identifier stops the probe.
Returned identifiers and private machine metadata are not logged or persisted.

The JSON sample must contain a timestamp and actual non-null nonnegative
values, with a sample no older than two minutes; clock skew beyond thirty
seconds into the future is rejected. Zero CPU usage is valid. Empty or stale
samples do not pass readiness. Access denial is an actionable Manual step;
HTML, redirects and unsupported response shapes fail, not a no-auth fallback.

The upstream pulse collector reads `getrusage(RUSAGE_SELF)`: this measures
Netdata's own process, not total host CPU. Other container-visible metrics may
describe the shared Linux kernel or Docker virtual machine. This work adds
no host mounts, host PID/network namespace, privileges, capabilities, Docker
socket, Cloud enrollment or public Access.

Netdata v2.11.0 sources:

- [Alarm summary](https://github.com/netdata/netdata/blob/v2.11.0/src/web/api/v1/api_v1_info.c)
- [Agent CPU collector](https://github.com/netdata/netdata/blob/v2.11.0/src/daemon/pulse/pulse-daemon.c)
- [Chart metadata](https://github.com/netdata/netdata/blob/v2.11.0/src/web/api/formatters/rrdset2json.c)
- [Default chart context](https://github.com/netdata/netdata/blob/v2.11.0/src/database/rrdset-index-id.c)
- [Chart data API](https://github.com/netdata/netdata/blob/v2.11.0/src/web/api/v1/api_v1_data.c)
- [Timestamped JSON samples](https://github.com/netdata/netdata/blob/v2.11.0/src/web/api/formatters/json/json.c)

## Acceptance gaps

`target_netdata.go` owns the descriptor; only the reference owner may add
`netdataTarget()` to `targets.go`. Until then no Netdata Link is registered.
Common ownership, reconciliation, removal, shared Stats bindings and peer
scheduling are reused rather than independently reimplemented.
The latest committed reference supplies a read-only preflight seam. Netdata's
descriptor uses it to check readiness and denied access before any Homarr
resource mutation, with a specific recovery message for Manual prerequisites.
Removal does not depend on metric availability or successful preflight.

No Docker, browser, installer or user Project was used in this lane. The parent
runtime phase must verify exact running versions/digests, meaningful rendered
Stats results, both installation orders, late peers, unready/denied retries,
reruns/restarts, removal/reinstallation, and retained user-authored resources
in an approved disposable Project. Source verification and existing focused
tests do not constitute that live acceptance proof.

## Local verification

- Existing focused tests: `go test ./internal/apps/netdata/ ./internal/apps/homarr/`
  passed, with `GOFLAGS=-buildvcs=false`.
- `gofmt -l .` was empty; `git diff --check`, `go build ./...`,
  `go vet ./...`, `go vet -tags e2e ./e2e/`, and `bash -n install.sh` passed.
- The complete `go test ./...` gate passes after the authorized fixture
  correction, with `GOFLAGS=-buildvcs=false`.
- `go test -race ./internal/tui/ ./internal/activity/ ./internal/catalog/ ./internal/apps/netdata/ ./internal/apps/homarr/`
  passed, with `GOFLAGS=-buildvcs=false`.
- Before the authorized fixture correction,
  `go test ./internal/catalog/ -run '^TestGeneratedAppsOnboard/netdata$' -count=1`
  failed on the empty-200 fixture. It passes with the corrected fixture;
  production readiness remains unchanged.

The parent authorized a precise central test exception in the existing
`internal/catalog/generated_test.go`, restricted to Netdata's routes:

- `GET /api/v1/info` returns version `v2.11.0` and explicit integer alarm
  counts `{normal: 0, warning: 0, critical: 0}`. Zero is a valid alarm dataset.
- `GET /api/v1/charts` returns the native `netdata.server_cpu` chart with its
  actual identifier, matching context, `netdata` plugin, `pulse` module,
  `milliseconds/s` units and `user`/`system` dimensions.
- `GET /api/v1/data` requires `chart=netdata.server_cpu`, `after=-60`,
  `points=1` and `format=json`. Its literal `time`/`user`/`system` labels pair
  with one `[timestamp, 1, 0]` sample: timestamp is Unix seconds from the
  existing `deps.Now` clock seam; user/system values are milliseconds/s.
  Wrong query values return 400, unknown Netdata routes 404 and methods
  other than GET 405. There is no Netdata empty-200 fallback.

Other App fixture behavior is unchanged; no tests, test files, skips or
production seam changes were added. Independent Dashdot work was not imported
from dirty files. These synthetic responses validate the existing Setup/Check
contract only, not native Homarr/widget or runtime acceptance. The no-host-CPU,
unchanged authority and unsupported System Resources caveats remain in force.
