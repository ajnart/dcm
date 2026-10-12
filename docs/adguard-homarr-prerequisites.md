# AdGuard Home → Homarr prerequisites (#266)

Prerequisite code: `dacc3065025075f9beb816a81b01d82f96db4351`.
Runtime verification: **11 October 2026**, macOS host, Linux/arm64 container.
This is **not complete Homarr acceptance**. Registration, compatibility,
ownership and functional widget verification remain blocked by #262.

The above prerequisite pin and the runtime/local verification sections below
are historical evidence, not verification of the source correction described
later in this document. #262 subsequently closed with frozen source
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`; this branch's descriptor remains
unregistered, with final seam normalization and native acceptance still held.

## Implemented

- AdGuard Home already had a headless first-run `configure` operation. Its
  `Manual` field was a recovery hint, not an unconditional Manual step.
  Following the first-run redirect from `/control/status` could nevertheless
  treat the install page's HTTP 200 as a successful administrator login.
- Setup now verifies HTTP Basic authentication against `/control/profile`,
  requiring the saved administrator name, then verifies a running DNS server
  through structured `/control/status` data. Redirects, HTML and userless
  configuration cannot prove authentication.
- Initial configuration uses the existing Project Admin login. It neither
  generates a second password nor rotates a valid account. Existing accounts
  that reject that login are not overwritten; restore the saved login, keep
  administration on port 3000, then run `self-host setup adguard-home`.
- Check reads query/block statistics and filtering rule counts, accepting
  valid zero counts and empty filters but rejecting absent essential fields.
  This checks API readiness, not a network-wide DNS cutover.
- Compose is unchanged: only administration port 3000 is published under the
  selected Access. DNS port 53 remains inside the container. Setup never
  changes the host/router resolver, enables DHCP, disables authentication,
  changes existing blocking settings or calls installation autofix.
- `internal/apps/homarr/integration_adguard.go` proposes `adguardTarget()`
  using only existing `target`, `secret` and `widget` types. It is intentionally
  **not registered**. No common Homarr files or extension machinery changed.

## Descriptor and reference seam

| Field                           | Proposal                                                      |
| ------------------------------- | ------------------------------------------------------------- |
| Catalog ID / native Homarr kind | `adguard-home` / `adGuardHome`                                |
| Server-side internal Address    | `http://adguard-home:3000`                                    |
| Browser Address                 | Existing Homarr `browserAddress` resolution, separately       |
| Secrets                         | Target helper's shared Admin login as `username` / `password` |
| Native widgets                  | `dnsHoleSummary`, `dnsHoleControls`                           |
| Controls options                | `showToggleAllButtons: false`; no automatic toggle calls      |
| Shared Stats metrics            | `dnsQueriesToday`, `adsBlockedToday`, `domainsBeingBlocked`   |
| Selected identifiers            | None required by these widgets                                |

The #262 registry owner should register this function only after the supported
version/capability and explicit resource-ownership contract is available.
The final Link must recheck target readiness/credentials rather than allowing
Homarr's shallow connection test to accept a userless server. Homarr v2.4.1
supports only username/password for this native integration; no narrower
read-only account or token mode is established by the inspected source.

**Upstream caveat:** v2.4.1's AdGuard summary computes its blocked percentage
as `queries / blocked * 100`, not `blocked / queries * 100`. The proposed Stats
defaults exclude `adsBlockedTodayPercentage`. Native summary percentage
correctness must be revalidated/resolved before final acceptance; query and
blocked counts are separate claims.

## Disposable runtime evidence

Development binary SHA-256:
`af559031369eee446d16acf472eb7921c6690b502e1c33796428970c3200fc9a`.

AdGuard reported `v0.107.79` from image `adguard/adguardhome:v0.107.79`:

- Image ID: `sha256:e38d0ed0724eb284aa9e196359bd24cae4fff315b4550270cca948986b4b16b8`.
- Repository digest: `adguard/adguardhome@sha256:aba9e3bf0613be3ba3755e1fc311b126e2c24bec25e18b6483894a88283074f0`.

Containment was checked before install: new private disposable Home folder,
unique Compose Project `adguard-266-sol-znaevbdp`, no pre-existing labelled
containers/networks, free loopback administration port 52010, Telemetry and
update checks disabled, all mounts beneath the disposable Project, 256 MiB
memory/swap ceiling, 0.5 CPU and 128-process ceiling. No host DNS port, Docker
socket, host network, additional privilege or browser session was used.
The fixture generated its password only in memory, passed it through the
supported private environment input and never read/printed secret files.

| Observation                                    | Result                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Fresh CLI install and own Setup                | Configured the administrator and running DNS                                                 |
| Authenticated profile                          | Returned the expected saved administrator                                                    |
| Anonymous and incorrect-password profile reads | Both rejected with HTTP 401                                                                  |
| Fresh statistics                               | Valid zero-query dataset                                                                     |
| Controlled DNS traffic                         | Owned `.invalid` blocking rule; two container-local queries, two additional blocked queries  |
| Setup rerun                                    | Administrator step skipped; same login and owned rule preserved                              |
| Restart                                        | Same login remained valid                                                                    |
| Remove/reinstall without purge                 | Same login and owned rule preserved                                                          |
| Owned cleanup                                  | Only labelled fixture containers and empty network removed; private disposable data retained |

No Homarr container was run. No native integration, rendered widget,
installation-order behavior, Homarr credential update or user-resource
preservation/removal is claimed by this prerequisite proof. Those checks
belong to the next phase under #262's reference contract.

## Local verification

Passed with `GOFLAGS=-buildvcs=false`: empty `gofmt -l .`, `go build ./...`,
`go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/adguard/`
and `bash -n install.sh`. The first combined command's time limit expired
after the full normal suite passed; the remaining race/shell checks passed
in a separate bounded command. No new test functions or dependencies were added.

## Source-only correction (12 October 2026)

- The pinned AdGuard `handleFilteringStatus` starts with nil slices and appends
  subscriptions. No subscriptions therefore serialize as explicitly present
  `filters: null`, including a valid custom-rule-only configuration. Direct
  Setup/Check now distinguish that and `[]` from absent, malformed, scalar or
  invalid filter entries. No response is rewritten for Homarr.
- The pinned statistics `getData(0)` explicitly returns empty arrays and numeric
  zero totals. Those remain valid; missing totals or null histogram arrays are
  not treated as zeros. Unused allow-list/custom-rule arrays are not required by
  this direct query/block-statistics check.
- The source-only histogram follow-up decodes both query and blocking arrays
  as nullable integers and rejects null or negative elements, preserving
  explicit empty arrays and numeric zeros. The null/negative rejection and
  explicit-empty branches have source/schema/compile coverage only in the
  final tree, not independent regression-test or native/runtime acceptance.
- The administrator predicate now checks authentication only. Setup reuses the
  existing first-administrator callbacks inside an App-owned step that probes
  afresh before bootstrap, retaining HTTP/server/schema/transport failures
  rather than replacing them with signup or wrong-password guidance. Only
  HTTP 401 represents explicit rejection; the pinned first-run redirect is
  considered unconfigured only after a structured install-API check.
- Authenticated running status, statistics and filtering readiness now have a
  separate `dns-api` Setup step using the existing two-minute bounded Poll.
  A missing `running` field differs from `running: false`; both fail with DNS
  diagnostics and a logs/retry hint, not a person-required Manual step.
  Check performs the same fresh reads. Valid accounts/settings are not changed.
- Test-scope cleanup removes all agent-authored independent filtering/statistics,
  DNS/profile/transport fault, recovery and credential-rejection matrices,
  including their sole-use injection fields, counter and transport override.
  Keeping two named test functions did not make those added cases authorized.
  Both baseline test bodies and assertions are restored exactly to fixed base
  `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`: fresh Setup configures the
  administrator, Check succeeds, rerun steps skip, and failed first-install
  configuration retains a hint naming the Setup command. Only required fixture
  maintenance remains: authenticated profile, structured status with ports,
  numeric zero statistics and explicitly present `filters: null`.
  Those single-default responses support baseline coverage, not new cases.
  Absent/malformed/filter-array alternatives, explicit empty histograms,
  null/negative histogram elements and other API/auth/bootstrap failure branches
  have source/schema/compile coverage only at the final head. Removed matrices
  are not claimed as final-head red/green coverage. No replacement cases,
  test functions/files, comments or dependencies were added; production code
  and the descriptor are unchanged by this cleanup.
- Native holds are separate: both Homarr's tagged research baseline and the
  reference's recorded OCI source revision require `filters` to be an array
  and compute blocked percentage backwards. Accepting direct `null` does not
  establish native compatibility or justify fabricating `[]`. This comparison
  concerns those two public source files only, not built-image attestation.
  Descriptor normalization/registration, native/rendered values, both
  installation orders and the full preservation/removal lifecycle remain held.
  No runtime, DNS traffic, container, browser, provider or registry action was
  performed for this correction; the historical runtime does not certify it.

### Correction verification

Passed in the terminal with `GOFLAGS=-buildvcs=false`: existing focused
AdGuard/Homarr suites with `-count=1`, empty repository `gofmt -l .`,
`go build ./...`, `go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/ ./internal/apps/adguard/`,
`bash -n install.sh` and `git diff --check`. The complete gate exited
successfully before publication; no Docker/e2e runtime or installer was run.
The gate was repeated after test-scope cleanup with only baseline cases and
required fixture maintenance retained. Static fixed-base comparison verified
all named function declarations unchanged and both baseline test bodies and
assertions byte-identical, not merely an unchanged test-function count.

## Sources

Context7 lookup was attempted but its monthly quota was exhausted. The
contract was checked directly against official versioned source instead.

- [AdGuard v0.107.79 first-run configuration](https://github.com/AdguardTeam/AdGuardHome/blob/v0.107.79/internal/home/controlinstall.go).
- [AdGuard authenticated profile and userless behavior](https://github.com/AdguardTeam/AdGuardHome/blob/v0.107.79/internal/home/profilehttp.go).
- [AdGuard HTTP Basic authentication](https://github.com/AdguardTeam/AdGuardHome/blob/v0.107.79/internal/home/authhttp.go).
- [AdGuard first-run redirect](https://github.com/AdguardTeam/AdGuardHome/blob/v0.107.79/internal/home/control.go#L446-L464).
- [AdGuard filtering response and nil subscription slices](https://github.com/AdguardTeam/AdGuardHome/blob/v0.107.79/internal/filtering/http.go#L415-L458).
- [AdGuard empty statistics and zero totals](https://github.com/AdguardTeam/AdGuardHome/blob/v0.107.79/internal/stats/unit.go#L412-L435).
- [AdGuard API schemas](https://github.com/AdguardTeam/AdGuardHome/blob/v0.107.79/openapi/openapi.yaml).
- [Official Homarr AdGuard guide](https://homarr.dev/docs/integrations/adguard-home/).
- [Homarr v2.4.1 native implementation and percentage caveat](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/adguard-home/adguard-home-integration.ts).
- [Homarr v2.4.1 native response schemas](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/adguard-home/adguard-home-types.ts).
- [Homarr recorded OCI-source AdGuard response schema](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/adguard-home/adguard-home-types.ts).
- [Homarr recorded OCI-source AdGuard percentage calculation](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/adguard-home/adguard-home-integration.ts).
- [Homarr v2.4.1 Stats metrics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts).
- [Homarr v2.4.1 widget support/limits](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts).
