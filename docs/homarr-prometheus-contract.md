# Prometheus native Link: source contract and verification scope

## Pinned sources

- Homarr authenticated API is `2.4.1`, image tag `ghcr.io/homarr-labs/homarr:v2.4.1`.
  The resolved image revision's Prometheus provider
  `3d4150e59f600876b7e308f857b2f21572b75348` was checked for the exact native
  metrics/authentication/active-target semantics below. Tagged research baseline
  `ebbd4876d25a51151444a009ab596e1154d62880` is a separate source identity.
- Prometheus `v3.15.0` resolves through its annotated tag to
  `5241a27fe3c6983549fccc32f6e65917408c63cd`.
- These source tags were read, not deployed. No image digest or runtime version
  was observed in this lane. Neither mutable image tag is runtime proof.

The [shared reference contract](homarr-integration-contract.md) owns version
checks, registration, scheduling, stable resource IDs, shared widget bindings
and removal. The retained common registry custodian normally merged frozen main
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`, preserving reviewed leaf
`56dc88ec7bcfb1a2397b8365d894b26ebd7e974e` and its recovery/startup corrections.
Only this branch's `prometheusTarget()` registry call is added. Source activation
is not live acceptance; no frozen common contract/helper body/signature changes.

## Actual native capabilities

Homarr's resolved-image Prometheus Stats provider reads `GET /api/v1/targets`. Its exact
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
requires all three keys with unit `count`. It reuses frozen `freshStatsSnapshot`
rather than copying refresh/timestamp logic: before-snapshot, forced refresh,
`error: false`, `stale: false` and positive advancing Unix **millisecond**
`updatedAt`. This is a read-only source refresh, not a configuration mutation.
All three numeric counts must equal a fresh direct read. Null, absent, failed,
unrefreshed and changed counts are rejected; explicit zero up/down counts are valid.
Frozen `verifyData` retains the common post-leaf selected-metric freshness guard.
The App's independent source-sample clock/freshness checks below remain unchanged.

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
is not zero. A valid empty target list is a retryable startup observation:
Prometheus can answer before its asynchronous scrape-pool initialization finishes.
Setup polls within its existing one-minute deadline; only target absence that
remains at the deadline becomes Manual. An already populated configuration
without a unique starter self-scrape remains a distinct Manual prerequisite.
Missing target arrays, malformed responses, query errors and stale samples are
not reclassified as target absence. Setup never adds or replaces a self-scrape.

The no-auth starter selects Homarr's exact empty credential alternative and
sends explicit `[]`. Optional private inputs `prometheus.username` and
`prometheus.password` reuse the existing private-input/Project secret boundary
for an already protected HTTP Basic endpoint. Both are required together and
are reused without generation, rotation, or a fallback after rejection. They
do not configure server authentication or create accounts.

There is no credential-only private-input update command for an installed
Prometheus App. Its missing or rejected credentials remain a Manual boundary;
do not reinstall for credential recovery. The install private-input path renders
and replaces the App's Compose fragment, potentially dropping protected web
configuration, arguments, mounts and scrape settings. Preserve that configuration
and require its review and separate approval before any operation that might
replace it. A manually configured authenticated Homarr connection is not adopted
as an owned Link and does not establish unattended acceptance. No generic secret
setter or alternate recovery command is introduced, and no credentials belong
in arguments or proof output.

Partial/rejected credentials, forbidden endpoints, redirects and an HTTPS
Address are actionable Manual boundaries. Unsupported authentication must stay
in place and be connected manually; preflight stops before any owned Homarr
board, tile or integration mutation. Other API/transport failures remain
actionable failures. Basic and no-auth are source-supported alternatives, not
tested claims about every secured configuration.

## Evidence and remaining acceptance

The existing Prometheus storage-user install fixture now returns valid empty
target discovery for its first five fake-clock seconds, then the exact starter
target/query data. It fails with premature Manual completion before this
correction and passes afterward, without adding test cases. A source check also
rejects the old reinstall hint and requires separate-approval guidance.
The generated Catalog fixture still supplies only this App's exact required
responses; other generated fixtures are unchanged. Empty HTTP 200 is not
Prometheus acceptance. No new files, test cases, dependencies, Docker runs,
browser runs, installer runs or person's Project access were added by the
correction.

Local gate passed with `GOFLAGS=-buildvcs=false`: focused Prometheus/Homarr/
Catalog tests, `gofmt -l .` (empty), `go build ./...`, `go vet ./...`,
`go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/prometheus/ ./internal/apps/homarr/ ./internal/catalog/`,
`bash -n install.sh`, and `git diff --check`.
The untagged Go gate does not launch the Docker e2e runtime.
The full gate passed again on the normalized source-activated tree, including
TUI/Activity/Prometheus/Homarr/Catalog race checks. Fresh normalized-head reviews
remain parent-owned; prior clean leaf reviews do not certify this final head.

Source/fake verification cannot prove native rendering. Pending the parent's
fresh final normalized-head Standards/Spec review and separately approved
isolated batch: real Homarr provider refresh, rendered
Targets/Up/Down values, resolved image digests, Basic-mode verification, both
installation orders, late/unready peers, restart and credential changes, owned
removal/reinstallation, and preservation of user-authored/shared resources.
Genuinely cross-kind shared-binding acceptance also remains held. These gaps keep
#299 open; registration is not full functional or lifecycle acceptance. This phase
adds no Docker/browser/installer, provider/account, secret-file or paid-model actions,
new test cases/comments/dependencies or duplicate guide/harness work.

## Primary references

- [Homarr integration guide](https://homarr.dev/docs/integrations/prometheus/)
- [Resolved-image Prometheus Stats provider](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/providers/prometheus.ts)
- [Homarr v2.4.1 credential alternatives](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/definitions/src/integration.ts)
- [Homarr v2.4.1 Prometheus provider](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/stats/providers/prometheus.ts)
- [Stats router](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/api/src/router/widgets/stats.ts)
- [Stats snapshot/refresh semantics](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/request-handler/src/stats.ts)
- [Stats entry schema](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/widgets/src/stats/config.ts)
- [Prometheus current HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)
- [Prometheus v3.15.0 starter](https://github.com/prometheus/prometheus/blob/v3.15.0/documentation/examples/prometheus.yml)
- [Prometheus v3.15.0 Dockerfile](https://github.com/prometheus/prometheus/blob/v3.15.0/Dockerfile)
