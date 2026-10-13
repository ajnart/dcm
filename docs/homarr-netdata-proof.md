# Netdata Link: source verification, runtime pending

Source status, 13 October 2026 (before this docs update):
`7e2e7480d1977a1ead494ab7010dd8ba8dd6a46e`.
The descriptor is normalized to the Stats SDK and registered in `internal/apps/homarr/targets.go`. This establishes source
wiring only; native/rendered data, both installation orders and lifecycle
acceptance remain unproved. Earlier dated evidence retains its original scope.

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

The JSON sample must contain exactly one `time`, `user` and `system` column,
with `time` first and either order for the two native CPU dimensions. Rows
must align with all three columns and contain actual non-null nonnegative
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

`target_netdata.go` owns the descriptor; the reference owner has registered
`netdataTarget()` in `targets.go`.
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
  that fixture correction did not change production readiness.

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

Other App fixture behavior is unchanged; no test functions, test files, skips or
production seam changes were added. Independent Dashdot work was not imported
from dirty files. These synthetic responses validate the existing Setup/Check
contract only, not native Homarr/widget or runtime acceptance. The no-host-CPU,
unchanged authority and unsupported System Resources caveats remain in force.

## Source-review dimension correction

At source head `fb792342c9985274bbbe347d32c435a41a49e094`, on fixed reference
base `dce263ef822dc056558a648f8f59ea795a3e56d9`, a fresh numeric sample could
pass with unrelated or missing CPU dimensions. The pinned pulse collector
defines both `user` and `system`; the readiness filter now requires exactly
those dimensions plus the unique first `time` column. Existing per-row
alignment, non-null numeric and freshness checks are retained. Zero is still
valid, but missing dimensions are never substituted with zero.

Direct controls are inside the existing `TestGeneratedAppsOnboard/netdata`
body, keeping native info/chart routes and strict data-query validation:

- Unrelated dimension, missing user/system, duplicate user/system/time,
  misplaced time, extra dimension and misaligned columns are rejected by
  the App's real Check path.
- Native all-zero CPU and reversed system/user column order are accepted.
  The original nonzero-user/zero-system Setup and Check control remains.
- The fixture response format is atomically replaced so the HTTP handler
  and Check controls remain race-safe; timestamp still uses `deps.Now`.

Before the production correction, the focused existing command failed with
`Netdata Check accepted unrelated dimension`; after correction it passes.
After this source correction, the focused Netdata/Homarr tests and complete
local gate listed above all pass, including the Catalog/TUI/Activity/App race
checks. Build, both vet commands, formatting/diff and installer syntax pass.
No test functions, files, comments, external dependencies, shared production
seams or registry changes were introduced. These are synthetic Check controls,
not real native/rendered acceptance. At that correction, fresh parent
Standards/Spec reviews, custodian normalization of the shared freshness guard,
registry assembly, real native/rendered data, both installation orders and shared
ownership lifecycle remained held. The source-status note above records
subsequent SDK normalization and registration, without new runtime proof.
