# Gatus Link implementation — #280

## Contract

Based on committed #262 reference `573a206e`, not its uncommitted files.
Homarr v2.4.1 source is `ebbd4876d25a51151444a009ab596e1154d62880`;
the correct GHCR tag is `ghcr.io/homarr-labs/homarr:v2.4.1`.
The reference lane owns correcting its image tag and common compatibility code.
This lane leaves `targets.go` and common reconciliation untouched.

`gatusTarget()` uses `http://gatus:8080` for Homarr's server connection;
the browser Address remains independently resolved. It explicitly returns
`[]secret{}`. Upstream declares `requiredSecrets: [[]]` and accepts an empty
`secrets` array in its create/update schema. There is no credential generation,
rotation or fallback from an authenticated connection. A protected status API
fails; existing authentication is not disabled.

The only native widget is shared Stats, with `up`, `down`, `unknown`, `total`.
These are endpoint counts, not uptime percentages: Homarr reads
`/api/v1/endpoints/statuses`, uses the last result's `success`, and counts empty
result arrays as unknown. Native Stats accepts both endpoint arrays and records;
the pinned Gatus v5.37.0 API returns an array. No dedicated Gatus widget or
selector identifier is invented.

## Readiness and verification

Gatus Setup retains `/health` readiness and additionally polls its status API
for the starter `local_gatus-self` endpoint. Its recorded latest result must
explicitly succeed, have HTTP status 200, a nonzero timestamp, and report the
starter loopback hostname `127.0.0.1`. Checks probe afresh. The starter config
and image `ghcr.io/twin/gatus:v5.37.0` are unchanged: one local health check,
one-minute interval, SQLite history, no external monitor traffic.

The Link verifies Gatus directly, then requests `widget.stats.refresh` through
Homarr with its owned integration ID. It requires a successful, non-stale,
timestamped snapshot, all four explicit nonnegative integer counts, and
`up + down + unknown == total`. Zero down/unknown counts are valid. A valid
empty dataset is distinct from an API error, but cannot establish this Setup's
required local monitored result; it remains actionable, not tile-only success.
Snapshots are observations, not proof that unrelated monitored Apps work.

Existing Projects lacking the local check receive a retry hint to preserve
their monitors and add the starter loopback check; Setup does not rewrite their
configuration or remove authentication. No new dependencies or secrets are used.

## Evidence and acceptance gaps

The repository local gate passed: gofmt, build, both vet commands, all existing
tests, race checks for TUI/Activity/Gatus/Homarr, and installer shell syntax.
Existing Gatus tests cover recorded local data and repeat Setup; the existing
failure test additionally rejects a protected API, HTML navigation page, empty
data, absent success field, failed result and nonlocal result. These are fake
transport fixtures, not live integration proof.

The descriptor is deliberately not registered here: `targets.go` belongs to
#262. Parent registration, corrected common version/credential-shape gates,
fresh two-axis review, and approved disposable runtime acceptance remain open.
No Docker, browser, installer, real Project or protected files were accessed.
No resolved image digests, real Homarr widget rendering or lifecycle proof is
claimed. The old Gatus navigation proof is not native integration proof.

## First-party sources

- [Homarr Gatus guide](https://homarr.dev/docs/integrations/gatus/)
- [v2.4.1 Gatus Stats provider](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/providers/gatus.ts)
- [v2.4.1 integration definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [v2.4.1 create/update schema](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/validation/src/integration.ts)
- [v2.4.1 Stats router](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/stats.ts)
- [v2.4.1 Stats snapshot semantics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [Gatus v5.37.0 status API](https://github.com/TwiN/gatus/blob/v5.37.0/api/endpoint_status.go)
- [Gatus v5.37.0 endpoint result](https://github.com/TwiN/gatus/blob/v5.37.0/config/endpoint/result.go)
