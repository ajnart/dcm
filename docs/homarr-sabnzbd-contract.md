# SABnzbd Homarr Link contract

Part of #298, using the [reference contract](homarr-integration-contract.md).

## Source-verified versions and authentication

- Homarr's actual tag is `v2.4.1`, commit
  `ebbd4876d25a51151444a009ab596e1154d62880`.
- The existing Catalog image is `linuxserver/sabnzbd:version-5.1.3`;
  SABnzbd's `5.1.3` source tag resolves to
  `a647f73426cb70ad60ae7964b96c2d5e939b4727`.
- This slice accepts only Homarr 2.4.1 and SABnzbd 5.1.3. Older or newer
  versions are not claimed compatible. These are source baselines, not tested
  images or immutable image digests.
- Homarr's exact native kind is `sabNzbd`, secret kind `apiKey`, internal
  Address `http://sabnzbd:8080`. Its browser Address stays separate.
- The full API key is the minimum usable credential for this adapter. The
  NZB key only adds jobs and cannot read queue/history. SABnzbd has no
  separately named, dedicated read-only token in this pinned API; Setup reuses
  the generated full key and does not invent scopes or rotate it.
- Homarr's connection test reads `translate`; the Downloads adapter reads
  `queue` and `history`. No Basic-auth or unauthenticated alternative is sent.

## Setup and recovery

Readiness uses the version API rather than the root page, which redirects to
the first-run wizard when no provider exists. The existing administrator form
Setup remains in place; existing authentication and hostname restrictions are
not weakened. Basic-auth WebUI login is not verified by this slice.

The peer's `api-key` step discovers only `[misc].api_key` through the existing
`h.ConfigValue`/`helpers.INIKey` helper and stores it as `SABNZBD_API_KEY` with
`h.SetSecret`. It first reuses a working Project secret; a lost or rejected
secret is recovered from the same App's generated configuration without
changing the upstream key. No configuration dump, database access or secret
argument is used.

Verification uses `auth` with the candidate `key` and requires `auth=apikey`,
then authenticated queue/history data with explicit arrays, a boolean paused
state, nonnegative finite `kbpersec`, and the supported queue version. A
legitimate empty queue/history and zero rate pass. A public version response
alone is not authentication proof; missing data never becomes an empty queue.

The separate `provider` step reads the existing server configuration. At least
one enabled provider needs a host and positive connection count; absence is
Manual with a Config > Servers/first-run wizard hint. This verifies only that
configuration exists, never a provider account, retention, connectivity or
successful transfer. Setup neither creates nor tests a provider account.

Retry with `self-host setup sabnzbd`, followed by `self-host setup homarr`.
Hostname or private-network rejection retains a specific recovery hint; no
wildcard host whitelist, authentication removal or public Access is applied.

## Native widgets and verification

- `downloads` uses the upstream defaults: 50 rows per integration, normal
  history included, archived history disabled. No queue/job ID is invented.
- Shared `stats` binds only `download` (bytes/second) and `paused` (boolean
  value, upstream metric unit `text`). The adapter converts SABnzbd's legacy
  KiB/second rate by `floor(kbpersec * 1024)`.
- The shared Stats catalog also declares `upload`, but the SABnzbd adapter has
  no upload rate and returns `null`; it is deliberately not a default entry.
  There are no supported queue-count or total-transfer Stats IDs to invent.
- Both widget kinds support this integration with no declared maximum binding
  count. Shared Stats uses the reference lane's deterministic per-integration
  entry IDs and preserves unrelated bindings.

The read-only peer preflight verifies administrator/API/provider readiness
before any Homarr mutation. Native verification reads
`widget.downloads.getJobsAndStatuses` for the owned integration ID, requires
nonfailed explicit items, paused state and finite nonnegative download rate,
then validates the exact Stats keys via `widget.stats.catalog` and checks
`widget.stats.refresh` with `force=false`. The latter writes only Homarr's
bounded read-only statistics cache; a fresh cached snapshot is valid for its
one-hour upstream window. Error, missing values, stale data or a missing
timestamp fail. Zero rate and an empty items array remain legitimate.

## Implementation and acceptance limits

This peer owns `target_sabnzbd.go`, `sabnzbdTarget()`, and SABnzbd Setup. The
reference owner must add `sabnzbdTarget()` to `targets.go`; this branch does not
edit the shared registry or reconciliation seam. Until registered, no native
SABnzbd Link is exposed. The reference removal/ownership policy then applies.

Existing focused SABnzbd tests model key reuse, version readiness, explicit
empty queue/history, recovery of the same missing Project key, and a
missing-provider Manual step. Existing Homarr tests
exercise the reference seam, not this unregistered descriptor. No new test
files or dependencies were added.

The local gate passed with `GOFLAGS=-buildvcs=false`: clean `gofmt -l .`,
`go build ./...`, both repository/e2e-tag `go vet` commands, `go test ./...`,
race checks for TUI, Activity, SABnzbd and Homarr, and `bash -n install.sh`.
The ordinary test run did not enable the Docker e2e runtime build tag.

No Docker, browser, installer, download or provider connection was run.
Registration, real Setup/API responses, image digests, rendered widgets,
owned meaningful queue/history data, both installation orders, late peers,
readiness retry, restart, credential changes and removal/reinstallation remain
for the parent's approved disposable-Project runtime batch. No full functional
acceptance or lifecycle proof is claimed by these source checks and fakes.

## Primary sources

- [Homarr integration definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [Pinned SABnzbd adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/download-client/sabnzbd/sabnzbd-integration.ts)
- [Pinned Downloads query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/downloads.ts)
- [Pinned widget definitions and limits](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts)
- [Pinned Downloads defaults](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/downloads/index.ts)
- [Pinned Stats adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Pinned Stats cache](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [SABnzbd API reference](https://sabnzbd.org/wiki/configuration/5.1/api)
- [Pinned SABnzbd authentication and wizard](https://github.com/sabnzbd/sabnzbd/blob/a647f73426cb70ad60ae7964b96c2d5e939b4727/sabnzbd/interface.py)
- [Pinned SABnzbd API](https://github.com/sabnzbd/sabnzbd/blob/a647f73426cb70ad60ae7964b96c2d5e939b4727/sabnzbd/api.py)
- [Pinned SABnzbd config representation](https://github.com/sabnzbd/sabnzbd/blob/a647f73426cb70ad60ae7964b96c2d5e939b4727/sabnzbd/config.py)
