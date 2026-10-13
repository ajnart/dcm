# Glances Link source contract (#281)

This is source verification, not functional runtime acceptance. The descriptor
uses the [reference ownership contract](homarr-integration-contract.md). Its
registration in `targets.go` belongs to the reference lane and is outstanding.

## Version and authentication

- Homarr: `ghcr.io/homarr-labs/homarr:v2.4.1`, source commit
  `ebbd4876d25a51151444a009ab596e1154d62880`. The registry declares `glances`,
  `httpAuth: {type: "none"}` and `secretKinds: [[]]`. The common compatibility
  check must receive the exact empty alternative from `integration.getKinds`.
- Glances: `nicolargo/glances:4.5.6`, tag source commit
  `ce2f8506289c71e48ed8bf186f2c04d8256203d5`, API version `4`. No image digest
  has been resolved or runtime-tested here; a tag is not immutable proof.
- The Homarr server uses `http://glances:61208`; browser navigation keeps the
  separately resolved App Address. No Glances credentials are created, rotated
  or read.
  Existing Basic/JWT authentication is never disabled or bypassed. This Homarr
  adapter cannot use it; Glances Setup reports a retryable Manual boundary.

## Readiness and widget semantics

Glances Setup waits for `/api/4/status`, then checks the JSON string returned by
`/api/4/version` equals `4.5.6` and validates `/api/4/all`. Check probes version
and resource data afresh. Missing/null/wrong-typed/negative required fields,
HTTP errors and redirects fail. Explicit numeric zeros and explicitly returned
empty network/filesystem arrays are valid. Authentication errors remain Manual.
Unsupported versions name the pinned version and `self-host setup glances`.

The Homarr adapter reads `/api/4/version` as text, including the JSON string's
quotes, and maps `/api/4/all` to system health. `/api/4/sensors` and
`/api/4/smart` are optional upstream reads: missing or incompatible payloads
become unavailable temperature/SMART data, not hardware proof.

Defaults:

- `systemResources`: CPU, memory and network charts; no GPU chart.
- `healthMonitoring`: CPU/memory, with GPU and filesystem display off. No disk
  identifier is guessed or selected. Hardware temperatures and SMART health are
  not prerequisites and are not represented as fabricated zeroes.
- Shared `stats`: only the supported `cpu` (percent), `memoryUsed` (bytes),
  `memoryAvailable` (bytes) and `uptime` (seconds). Homarr defines available
  memory as `mem.total - mem.used`, not Glances `mem.free`/`mem.available`.
  No invented disk/network Stats. Homarr's Health Monitoring information modal
  includes adapter placeholders (`availablePkgUpdates: 0`, `rebootRequired:
false`); these are not observed package-update or reboot health results.

The descriptor verifies the owned integration's
`widget.healthMonitoring.getSystemHealthStatus` data. Homarr's health response
must match the requested integration ID and exact Glances version. The shared
Stats SDK discovers the selected catalog keys and acquires one forced refresh
with a finite positive advancing timestamp, no error and no stale flag. The
pure Glances Stats callback validates percent CPU in 0–100, integral nonnegative
bytes and nonnegative uptime in seconds. All values must be finite and defined;
legitimate zero values are accepted. Native and Stats observations can change
independently, so they are not compared for equality.
The peer preflight verifies Glances before compatibility requests or any Link
mutation; authentication produces a specific Manual recovery message. Removal
does not probe Glances, so unavailable credentials or data cannot block cleanup.

Metrics describe the kernel and namespaces visible to Glances, not guaranteed
physical-host or isolated-container resource use. Docker Desktop usually exposes
its backing Linux VM. No host PID namespace, socket, mount, capability or device
permission is added; the Compose definition is unchanged. Existing Access stays
unchanged; keep this no-auth API private because it can reveal process details.

## Acceptance still outstanding

The parent runtime batch must register `glancesTarget()`, record resolved image
digests, and verify real API data and rendered widgets in an approved disposable
Project with development Telemetry disabled. Source-shaped fixtures and shared
ownership tests are not a live lifecycle proof. Both installation orders,
late-peer installation, readiness retry, restart, idempotence, removal/reinstall,
shared Stats preservation and preservation of user-authored resources remain
runtime acceptance items. Authenticated Glances, absent hardware and physical-host
observation are explicitly not claimed to pass.

Local gate: the existing Glances Catalog Compose/Setup fixture and focused
Homarr Link/ownership checks passed, as did `gofmt -l .`, `go build ./...`,
`go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/homarr/`
and `bash -n install.sh` with `GOFLAGS=-buildvcs=false`. No Docker, browser,
installer or e2e runtime was run. No new test suite or dependency was added.

## Primary sources

- [Homarr integration registry](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Glances adapter and schemas](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/glances/glances-integration.ts)
- [Supported Stats keys and units](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Health query result and errors](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/health-monitoring.ts)
- [Stats snapshot/refresh lifecycle](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [System Resources options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/system-resources/index.ts)
- [Health Monitoring options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/health-monitoring/index.ts)
- [Health Monitoring information modal](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/health-monitoring/system-health.tsx)
- [Widget compatibility and limits](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts)
- [Glances version/API constants](https://github.com/nicolargo/glances/blob/ce2f8506289c71e48ed8bf186f2c04d8256203d5/glances/__init__.py)
- [Glances routes and authentication](https://github.com/nicolargo/glances/blob/ce2f8506289c71e48ed8bf186f2c04d8256203d5/glances/outputs/glances_restful_api.py)
- [Glances CPU metrics](https://github.com/nicolargo/glances/blob/ce2f8506289c71e48ed8bf186f2c04d8256203d5/glances/plugins/cpu/__init__.py)
- [Glances memory metrics](https://github.com/nicolargo/glances/blob/ce2f8506289c71e48ed8bf186f2c04d8256203d5/glances/plugins/mem/__init__.py)
- [Glances uptime](https://github.com/nicolargo/glances/blob/ce2f8506289c71e48ed8bf186f2c04d8256203d5/glances/plugins/uptime/__init__.py)
- [Official Glances guide](https://homarr.dev/docs/integrations/glances/)
