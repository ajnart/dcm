# Prometheus native Link: source contract and verification scope

## Pinned sources

- Homarr `v2.4.1` resolves to
  `ebbd4876d25a51151444a009ab596e1154d62880`.
- Prometheus `v3.15.0` resolves through its annotated tag to
  `5241a27fe3c6983549fccc32f6e65917408c63cd`.
- These source tags were read, not deployed. No image digest or runtime version
  was observed in this lane. Neither mutable image tag is runtime proof.

The [shared reference contract](homarr-integration-contract.md) owns version
checks, registration, scheduling, stable resource IDs, shared widget bindings
and removal. This lane only provides `prometheusTarget()`; the registry owner
must add it to `targets()` before native Links can run.

## Actual native capabilities

Homarr's tagged Prometheus Stats provider reads `GET /api/v1/targets`. Its exact
metrics are `total` (Targets), `up` (Up), and `down` (Down), all unit `count`.
Only active targets are counted. Other health strings contribute to `total`,
not to either up/down count; dropped targets are excluded. There is no dedicated
Prometheus widget or arbitrary PromQL option in this provider. No CPU percentage
or invented metric is configured.

The shared `stats` widget gets three metric entries. Its tagged schema allows
100 entries with unique IDs; the reference contract generates IDs per
integration and metric and retains other Apps' entries. Aggregate widget limits
must still be checked during batch registration. Browser Addresses remain
separate from the integration's `http://prometheus:9090` internal Address.

Native verification calls `widget.stats.catalog` with `{integrationId}` and
requires all three keys with unit `count`. It then POSTs `widget.stats.refresh`
with `{integrationId, force: true}`. This is a read-only source refresh, not a
configuration mutation. The returned snapshot must have `error: false`,
`stale: false`, a numeric `updatedAt` in Unix **milliseconds** at or after the
request start and no more than five seconds ahead of the local clock, and all
three numeric counts equal to a fresh direct read. Null, absent, failed,
unrefreshed and changed counts are rejected. An explicit zero up/down count is
valid. A concurrent refresh returning an older snapshot requires a retry.

## App Setup and credentials

The unchanged Prometheus image supplies a 15-second self-scrape of
`localhost:9090/metrics`, with `job="prometheus"` and
`instance="localhost:9090"`. Its Dockerfile copies that starter configuration
into the image. Setup does not write or replace configuration, add remote
targets, grant privileges, or change Access or authentication.

Setup and Link preflight read fresh target discovery and evaluate this exact
query through `GET /api/v1/query`:

```promql
up{job="prometheus",instance="localhost:9090"}[1m]
```

This is an **instant query of a range selector**, so `resultType` must be
`matrix`, not `vector`. The returned `values` contain source sample timestamps
in Unix **seconds**, not an instant-vector evaluation timestamp. Exactly one
series with the starter labels/name is required. Samples must be ordered,
finite 0/1 values, and the latest timestamp must be at most 60 seconds old
and at most five seconds ahead. The latest value must match the current
starter target's up/down health. A fresh `0` is a valid failed-scrape observation;
an empty result, missing sample, malformed response, JSON error, or stale sample
is not zero. A valid empty target list stops as Manual because it does not
establish the chosen starter time series. Customized configurations without
that self-scrape require an explicit person-owned decision; Setup never adds it.

The no-auth starter selects Homarr's exact empty credential alternative and
sends explicit `[]`. Optional private inputs `prometheus.username` and
`prometheus.password` reuse the existing private-input/Project secret boundary
for an already protected HTTP Basic endpoint. Both are required together and
are reused without generation, rotation, or a fallback after rejection. They
do not configure server authentication or create accounts.

After a separately approved reinstall, existing read-only Basic credentials
can be supplied with `--set-file prometheus.username=PATH` and
`--set-file prometheus.password=PATH`, using owner-only files; then retry
`self-host setup prometheus` and `self-host setup homarr`. Reinstallation renders
the App's Compose fragment: review any customized fragment before approving it.
No credentials belong in arguments or proof output.

Partial/rejected credentials, forbidden endpoints, redirects and an HTTPS
Address are actionable Manual boundaries. Unsupported authentication must stay
in place and be connected manually; preflight stops before any owned Homarr
board, tile or integration mutation. Other API/transport failures remain
actionable failures. Basic and no-auth are source-supported alternatives, not
tested claims about every secured configuration.

## Evidence and remaining acceptance

The existing Prometheus storage-user install test and generated Catalog Setup
fixture now supply only the exact target discovery/query responses required by
this App. The other generated fixtures are unchanged; empty HTTP 200 is no
longer Prometheus acceptance. No new test cases, dependencies, Docker runs,
browser runs, installer runs or person's Project access were added.

Local gate passed with `GOFLAGS=-buildvcs=false`: focused Prometheus/Homarr/
Catalog tests, `gofmt -l .` (empty), `go build ./...`, `go vet ./...`,
`go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/`, and `bash -n install.sh`.
The untagged Go gate does not launch the Docker e2e runtime.

Source/fake verification cannot prove native rendering. Pending the parent's
isolated batch: registry activation, real Homarr provider refresh, rendered
Targets/Up/Down values, resolved image digests, Basic-mode verification, both
installation orders, late/unready peers, restart and credential changes, owned
removal/reinstallation, and preservation of user-authored/shared resources.
These gaps keep #299 open; this is not full functional or lifecycle acceptance.
README/embedded-guide summaries and the common reference belong to the registry
owner and should be updated with registration.

## Primary references

- [Homarr integration guide](https://homarr.dev/docs/integrations/prometheus/)
- [Homarr v2.4.1 credential alternatives](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/definitions/src/integration.ts)
- [Homarr v2.4.1 Prometheus provider](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/stats/providers/prometheus.ts)
- [Stats router](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/api/src/router/widgets/stats.ts)
- [Stats snapshot/refresh semantics](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/request-handler/src/stats.ts)
- [Stats entry schema](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/widgets/src/stats/config.ts)
- [Prometheus current HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)
- [Prometheus v3.15.0 starter](https://github.com/prometheus/prometheus/blob/v3.15.0/documentation/examples/prometheus.yml)
- [Prometheus v3.15.0 Dockerfile](https://github.com/prometheus/prometheus/blob/v3.15.0/Dockerfile)
