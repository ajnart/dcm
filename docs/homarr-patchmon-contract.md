# PatchMon native Homarr contract and blocker

This is source verification for #291, not functional or rendered acceptance.
The worktree starts at committed `d956824f`; no dirty Immich proof work was copied.
The reference owner must register `patchmonTarget()` in `targets.go` separately.
Common reconciliation and ownership files are unchanged.

## Read-only credential boundary

The existing Setup uses the official headless `auth/setup-admin` endpoint,
saved Admin login and authenticated profile readback. An incompatible existing
owner is not replaced. With Homarr installed, Setup records a retryable Manual
step instead of creating a credential with unapproved authority. Late Homarr
installation is covered by the descriptor's fresh, GET-only preflight before
any Homarr mutation. Account Setup alone does not prove statistics readiness.
Rerunning PatchMon Setup without Homarr records that credential step as skipped,
replacing an earlier Manual hold rather than retaining stale Needs attention.

Homarr requires **both** `patchmonApiKey` and `patchmonApiSecret`, sent as Basic
auth to `/api/v1/gethomepage/stats`. A login JWT or generic API key is not a
substitute. The matching PatchMon credential has metadata
`integration_type: gethomepage`; general `api` credentials with `host: get`
scopes cannot authenticate this endpoint. Creation/listing uses the official
`/api/v1/auto-enrollment/tokens` endpoint and `can_manage_settings` permission.
The once-returned secret cannot be retrieved from the token inventory.

The actual image's `Enroll` handler checks activity, secret, expiration,
IP ranges and daily limit, **but never integration type**. Thus GetHomepage
credentials also grant host enrollment. Creation replaces a zero daily limit
with 100; one-per-day still grants write authority. No supported minimum
permission combination yields a read-only credential. This branch does not
create, discover/adopt, rotate, delete or fabricate such a pair, nor treat a
manually supplied pair as approval. No pair is stored or transmitted at runtime
through this paused Link. Existing Project secrets remain unchanged.

Retry requires a reviewed upstream separation of statistics and enrollment
authority, an explicitly supported image contract, and owned credential
provisioning/verification through helpers and the Project secret boundary.
Do not bypass the hold with a browser token or broader credentials. Installing
agents, enrolling computers and collecting inventory require a separate approved
target. No host inspection, package upgrade, device privilege or external
account operation is included.

## Native data contract

The prepared descriptor uses `http://patchmon:3000` internally, independently
of the browser Address. Its native widget kind is `patchmon`, with one integration;
no host identifier is invented. Shared Stats keys are exactly `totalHosts`,
`hostsNeedingUpdates`, `securityUpdates`, `totalOutdatedPackages`.
The native query is authenticated `widget.patchmon.getStats`.

Prepared verification rejects missing halves, non-200 responses, absent/null/
negative/noninteger counts, invalid timestamps and inconsistent source counts.
The source read includes `awaiting_data_hosts`, which Homarr does not map:
nonzero awaiting inventory remains Manual, not a successful empty dataset.
Authenticated explicit zeros with zero hosts are legitimate empty inventory,
not evidence of secure computers. The compliance hero and threshold colors
are disabled to avoid a false healthy/100%-compliant empty-fleet presentation.

Exact server semantics:

| Field                         | Meaning                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `total_hosts`                 | All host records, including pending and nonreporting hosts                                       |
| `hosts_needing_updates`       | Distinct hosts with a package marked `needs_update`                                              |
| `security_updates`            | Distinct package IDs marked both update-needed and security-update, not host-package occurrences |
| `total_outdated_packages`     | Distinct update-needed package IDs across hosts                                                  |
| `hosts_with_security_updates` | Distinct hosts with security-update packages                                                     |
| `up_to_date_hosts`            | Hosts with package data minus hosts needing updates                                              |
| `awaiting_data_hosts`         | Hosts without package data                                                                       |
| `recent_updates_24h`          | Successful full/partial inventory report rows in the last day, not installed patches             |
| `total_repos`                 | Active repositories                                                                              |
| `last_updated`                | Statistics response generation time, not last host inventory time                                |

Repeated fresh reads do not prove recent host reporting, installed patches,
reboot completion or hardware security. OS distribution counts active host
records by OS type/version; no OS widget or hardware-specific metric is enabled.
Verification code is prepared but cannot run through the held preflight.

## Exact sources and registry identities

OCI registry metadata was read over HTTPS without Docker on 11 October 2026;
no image was started. These tags are mutable, not runtime compatibility proof.

| Image                                    | Index SHA-256                                                      | linux/arm64 manifest SHA-256                                       | Config SHA-256                                                     |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `ghcr.io/homarr-labs/homarr:v2.4.1`      | `ee67a5e856c051c4e114418a54b89a3fc3cb5507d0689e5cb89c790305c549cd` | `308feba8b9845cbdb21eb2e1b05579d49fb815bf3f0a452e58b59fcd4db8ecd2` | `c6d895d659718b05ab9cc7b936458e6f5820b5cf3f0d35318588bd1b6901ee1b` |
| `ghcr.io/patchmon/patchmon-server:2.1.3` | `9eba4008c8e25f72929752bba7499b5deda26cf5de3e4678dbf760d16822b2f2` | `54d587af0871a8d6369386c8d2e8830d20f03b69f51b19cf5c6cb5bf5356a2ed` | `e22cecbb743cdabffd50fbc6a06293c7ad29eacd41d0d08556c954305860904c` |

Homarr's image revision label is
`3d4150e59f600876b7e308f857b2f21572b75348`, with version label `main`.
The reference tagged baseline is `ebbd4876d25a51151444a009ab596e1154d62880`.
The integration definition, PatchMon adapter/types, native router/widget options
and component, and shared Stats adapter/router/types are byte-identical between
those revisions. Actual authenticated Homarr `info.getInfo` version remains
unverified for this lane; the reference common version check is unchanged.
PatchMon's revision label and `v2.1.3` tag both resolve to
`354ec8cdeb53338e57a8332fb2ddd5c7f307c75c`; its version label is `2.1.3`.

Primary sources:

- [Homarr official integration guide](https://homarr.dev/docs/integrations/patchmon/)
- [Actual Homarr adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/patchmon/patchmon-integration.ts)
- [Actual native response schema](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/patchmon/patchmon-types.ts)
- [Actual Stats metric keys](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/existing.ts)
- [Actual widget options](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/widgets/src/patchmon/index.ts)
- [PatchMon creation and enrollment handlers](https://github.com/PatchMon/PatchMon/blob/354ec8cdeb53338e57a8332fb2ddd5c7f307c75c/server-source-code/internal/handler/auto_enrollment.go)
- [PatchMon auth/type check](https://github.com/PatchMon/PatchMon/blob/354ec8cdeb53338e57a8332fb2ddd5c7f307c75c/server-source-code/internal/middleware/api_auth.go)
- [PatchMon route permissions](https://github.com/PatchMon/PatchMon/blob/354ec8cdeb53338e57a8332fb2ddd5c7f307c75c/server-source-code/internal/server/router.go)
- [PatchMon count queries](https://github.com/PatchMon/PatchMon/blob/354ec8cdeb53338e57a8332fb2ddd5c7f307c75c/server-source-code/internal/sqlc/queries/dashboard.sql)
- [PatchMon response construction](https://github.com/PatchMon/PatchMon/blob/354ec8cdeb53338e57a8332fb2ddd5c7f307c75c/server-source-code/internal/store/dashboard.go)

## Acceptance gaps

This draft does not complete #291. Registry activation remains reference-owner
work. Read-only credential provisioning is upstream-blocked. Fresh-image account
Setup, negative live auth, populated/empty native statistics, rendered widgets,
both install orders, restart, credential changes, user-resource preservation,
removal and reinstall have not been exercised. No Docker, browser, installer,
agent enrollment or patching was run. Existing focused and full local gates
validate source/build behavior only; they are not API or lifecycle proof.

Local verification passed with `GOFLAGS=-buildvcs=false`: focused tests for
PatchMon/Homarr/Catalog, `go build ./...`, both vet runs including the e2e
build-tag compile check, `go test ./...`, and race checks for
PatchMon/Homarr/TUI/Activity. `gofmt -l .`, `git diff --check` and
`bash -n install.sh` were clean. The e2e runtime was not enabled.
