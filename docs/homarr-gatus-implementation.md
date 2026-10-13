# Gatus Link implementation — #280

## Contract

Normalized by the retained common registry custodian against frozen main
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`, merged normally while preserving
leaf `c3aca1a6d3a8cff2d5d39ca96913960e9ce4b2c8` and its reviewed local-provenance
corrections. Only this peer's `gatusTarget()` registry call is added in this branch.
Frozen common reconciliation, compatibility, ownership and freshness remain unchanged.

Homarr's authenticated supported API is `2.4.1`, image tag
`ghcr.io/homarr-labs/homarr:v2.4.1`. The resolved image revision
`3d4150e59f600876b7e308f857b2f21572b75348` Gatus provider was checked for these
exact count semantics; tagged research baseline
`ebbd4876d25a51151444a009ab596e1154d62880` remains a separate identity.

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
at `/api/v1/endpoints/local_gatus-self/statuses`, whose pinned handler reads only
the local store, for the starter endpoint. The existing `ConfigValue` helper
reads the Project's App configuration: that monitor must be uniquely configured,
enabled (including Gatus's enabled-by-default mode), and use GET at the exact
starter destination `http://127.0.0.1:8080/health`. A matching name or loopback
hostname alone is insufficient; other ports and paths are not adopted.
The key is derived from that verified configuration's group and name. Under
Gatus v5.37.0 key semantics, the permitted lowercase `local` and `gatus-self`
values need no character replacement, yielding `local_gatus-self`. The returned
key/name/group must corroborate that configuration. No identifier is guessed.
Aggregate `/api/v1/endpoints/statuses` appends remote-instance records without
provenance markers; a same-key remote success therefore cannot prove the owned
local check. Its absence (404 or no local results) stays an actionable wait.
Its recorded latest result must explicitly succeed, have HTTP status 200, and
report the starter loopback hostname `127.0.0.1`. Its timestamp must not be in
the future or older than the configured monitor interval, using `h.Now()`;
omitted/zero intervals use Gatus's one-minute default. Stale records poll during
Setup and otherwise return an actionable retry, including retained SQLite
results for disabled monitors. The single-key handler does not use the aggregate
API cache; no guessed freshness allowance is applied. Homarr's native Stats
still uses the aggregate endpoint and legitimately counts its remote records;
the local readiness proof does not change those upstream count semantics.
Checks probe afresh. The starter config
and image `ghcr.io/twin/gatus:v5.37.0` are unchanged: one local health check,
one-minute interval, SQLite history, no external monitor traffic.

The Link verifies Gatus directly. After the native check succeeds, the shared
Stats SDK reads the authenticated catalog and obtains one sample with its owned
integration ID. It reads `widget.stats.snapshot`, then forces `widget.stats.refresh`, requiring
a successful, non-stale snapshot with a timestamp strictly advanced from the
before-snapshot (or a positive timestamp when the before-snapshot was unfilled).
A forced refresh that returns without updating because of a distributed lock
or unavailable queue slot is an actionable wait, not acceptance of Homarr's
one-hour cache. The pure Gatus Stats callback requires all four catalog units to
be `count`, all four explicit nonnegative integer counts and
`up + down + unknown == total`. Zero down/unknown counts are valid. A valid
empty dataset is distinct from an API error, but cannot establish this Setup's
required local monitored result; it remains actionable, not tile-only success.
Snapshots are observations, not proof that unrelated monitored Apps work.
Each verification invocation uses one refresh; the Step's separate apply and
Check invocations can collect multiple samples. Native record clock limits stay
in the Gatus owner; Stats timestamps retain the SDK's finite, positive, advancing
requirements without an additional clock policy.

Existing Projects lacking or changing the local check receive a retry hint to
preserve their monitors and review the starter loopback check; Setup does not
create an unsolicited monitor, name-only adopt another target, or rewrite their
configuration or remove authentication. No new dependencies or secrets are used.

## Evidence and acceptance gaps

The normalized source-activated tree passed the full local gate again, including
TUI/Activity/Gatus/Homarr/Catalog race checks. This is source/fake verification,
not live peer acceptance; final normalized-head reviews remain parent-owned.

The repository local gate passed: gofmt, build, both vet commands, all existing
tests, race checks for TUI/Activity/Gatus/Homarr, and installer shell syntax.
Existing Gatus tests cover recorded local data and repeat Setup; the existing
failure test additionally rejects a protected API, HTML navigation page, empty
data, absent success field, failed result and nonlocal result. These are fake
transport fixtures, not live integration proof.

The source correction for the three review findings adds configuration and
interval validation plus snapshot timestamp advancement. Only the existing
Gatus fixture was aligned with its fake clock and Project config contract; no
new test cases/files were added. The three corrected boundaries still need
fresh independent source review and approved runtime evidence; compilation and
the existing fixture suite are not claimed as dedicated live regression proof.

The remaining owned-record provenance correction switches verification to the
local-store-only single-key route and aligns only the existing fixture route
and object response shape. It does not touch Homarr's descriptor or the
before/after forced-refresh advancement check. Fresh source review at the new
head remains required; no remote traffic or live proof was used.

The descriptor is source-activated through the custodian's single registry call.
The forward merge of SDK `ecc21d9f95664ef6245863ddfb05930bf4cde3a3`
preserves that registration. Gatus's `verify` retains native local-store and
configured-monitor provenance; its `stats` callback validates the same central
sample without another Stats request. Nil preflight leaves cleanup and scheduling
unchanged. The public Link fixture covers two verification invocations on first
apply, one on each rerun and none on removal; each has one catalog/snapshot/refresh.
Fresh parent-owned Standards/Spec reviews of the normalized final head and approved
disposable runtime acceptance remain open. Registration is not live native,
rendered, authentication, both-installation-order, ownership lifecycle or genuinely
cross-kind shared-binding acceptance. Those gates remain held.
No Docker, browser, installer, real Project or protected files were accessed.
No resolved image digests, real Homarr widget rendering or lifecycle proof is
claimed. The old Gatus navigation proof is not native integration proof.

## First-party sources

- [Homarr Gatus guide](https://homarr.dev/docs/integrations/gatus/)
- [Resolved-image Gatus Stats provider](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/providers/gatus.ts)
- [v2.4.1 Gatus Stats provider](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/providers/gatus.ts)
- [v2.4.1 integration definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [v2.4.1 create/update schema](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/validation/src/integration.ts)
- [v2.4.1 Stats router](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/stats.ts)
- [v2.4.1 Stats snapshot semantics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [Gatus v5.37.0 status API](https://github.com/TwiN/gatus/blob/v5.37.0/api/endpoint_status.go)
- [Gatus v5.37.0 single-key status route](https://github.com/TwiN/gatus/blob/v5.37.0/api/api.go)
- [Gatus v5.37.0 key derivation](https://github.com/TwiN/gatus/blob/v5.37.0/config/key/key.go)
- [Gatus v5.37.0 endpoint result](https://github.com/TwiN/gatus/blob/v5.37.0/config/endpoint/result.go)
- [Gatus v5.37.0 enabled and interval defaults](https://github.com/TwiN/gatus/blob/v5.37.0/config/endpoint/endpoint.go)
- [Gatus v5.37.0 monitoring and retained results](https://github.com/TwiN/gatus/blob/v5.37.0/watchdog/endpoint.go)
- [Gatus v5.37.0 API cache lifetime](https://github.com/TwiN/gatus/blob/v5.37.0/api/cache.go)
