# SABnzbd Homarr Link contract

Part of #298, using the [reference contract](homarr-integration-contract.md).

## Native activation: credential-safety hold #363

Tracker #363 blocks native activation. The SABnzbd Homarr Link is retryable
Manual before any Homarr or peer HTTP
request, credential creation/update, tile/widget mutation or native query.
Do not manually create an integration or bypass this hold. Standalone SABnzbd
Setup/Check and owned Link removal remain separate.

At recorded Homarr OCI-source revision
`3d4150e59f600876b7e308f857b2f21572b75348`, the native SABnzbd adapter puts
the full API key in the request query. A rejected response retains the raw
Address in `ResponseError`; the integration decorator sanitizes its own log
copy but rethrows the original cause. Downloads integration settling logs that
cause, and recursive error/metadata formatting retain the Address string.
Console logging is enabled; Redis/browser visibility depends on logging and
permissions. A currently valid direct API probe cannot prevent a later
rejected native request. This is source-confirmed risk, not an observed leak
or built-image attestation; no rejected-credential probe or log read was run.

Activation requires a supported adapter and complete downstream logging-chain
fix verified in the actual supported image, exact image/version/source
compatibility review and separate authorization. Source agreement, a local
upstream patch or valid credentials do not clear this image prerequisite.

The HTTP regression fixture failed before the hold: both Link Check/apply made
one request and did not return Manual. After the leaf hold, both return Manual
with zero HTTP requests. The existing native Downloads and pure Stats callback
remain unchanged behind the hold; their synthetic fixtures exercise the dormant
verifier directly and are not activation acceptance.

The inspected source chain is:

- [SABnzbd native query and rejected response](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/download-client/sabnzbd/sabnzbd-integration.ts#L150-L165)
- [ResponseError retains the response Address](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/common/src/errors/http/response-error.ts#L5-L10)
- [Decorator sanitizes one copy and rethrows the cause](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/base/errors/decorator.ts#L37-L145)
- [Integration settling logs the rejected cause](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/settle-integrations.ts#L39-L44)
- [Recursive error formatting](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/error.ts#L22-L53)
- [String metadata formatting](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/metadata.ts#L9-L14)
- [Console and conditional Redis transports](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/transports/index.ts#L7-L18)

## Source-verified versions and authentication

- Homarr's actual tag is `v2.4.1`, commit
  `ebbd4876d25a51151444a009ab596e1154d62880`.
- The existing Catalog image is `linuxserver/sabnzbd:version-5.1.3`;
  SABnzbd's `5.1.3` source tag resolves to
  `a647f73426cb70ad60ae7964b96c2d5e939b4727`.
- The Homarr Link accepts only Homarr 2.4.1 and SABnzbd 5.1.3. Older or newer
  versions are not claimed native-compatible. Standalone SABnzbd Setup/Check
  still validate the current administrator, full-key authentication, observed
  nonempty queue version and API capabilities without imposing the Link's
  exact-version restriction. These are source baselines, not tested images or
  immutable image digests.
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
state, nonnegative finite `kbpersec`, and a freshly observed nonempty queue
version. The Homarr preflight and native verification additionally require
that version to be exactly `5.1.3`; App Setup/Check do not. A
legitimate empty queue/history and zero rate pass. A public version response
alone is not authentication proof; missing data never becomes an empty queue.

The separate `provider` step reads the existing server configuration. At least
one enabled provider needs a host and positive connection count; absence is
Manual with a Config > Servers/first-run wizard hint. This verifies only that
configuration exists, never a provider account, retention, connectivity or
successful transfer. Setup neither creates nor tests a provider account.
After administrator and full-key/API validation, the exact explicit
`{"config":{}}` response is unconfigured, as is `{"config":{"servers":[]}}`.
The pinned configuration database has no `servers` section until a server is
registered; `get_dconfig` returns `{}` for that absent section. Missing/null
`config`, a non-object `config`, a nonempty object without `servers`, and
malformed server arrays still fail rather than becoming Manual or success.

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

Standalone Setup verifies administrator/API/provider readiness. The Homarr
preflight now stops unconditionally on the credential-safety hold before any
request or mutation. Its dormant native verification reads
`widget.downloads.getJobsAndStatuses` for the owned integration ID, requires
nonfailed explicit items, paused state and finite nonnegative download rate,
then checks every returned item against the pinned normalized schema and
SABnzbd adapter: nonempty ID/name, `usenet` type, an adapter-produced state,
finite index, nonnegative finite size, progress in `[0,1]`, and finite signed
time. Negative time since completion is legitimate. Optional byte counts,
speeds and added timestamps may be absent; when present they must be finite
numbers, with byte counts/speeds nonnegative. Optional category accepts a
string or string array. SABnzbd omits queue `added`, history `downSpeed` and
all `upSpeed` fields; absence is not zero. The optional numeric schema is not
nullable: explicit nulls and SuperJSON nonfinite-number strings cannot pass
the existing JSON-only decoder as valid numbers. Homarr's pinned lock uses
SuperJSON `2.2.6`: undefined becomes annotated null and nonfinite numbers
become annotated strings, not numeric zero. SABnzbd's omitted optional keys
do not need those annotations. The verifier then validates
the exact Stats keys and units through the shared catalog/refresh owner.
`verifySABnzbdStats` validates the same forced advancing sample obtained by
`verifyData`: finite nonnegative `download` in `bytesPerSecond` and boolean
`paused` in `text`. A cached no-op fails. Zero rate and an explicit empty items
array remain legitimate; native queue and Stats are independently sampled.

## Implementation and acceptance limits

This peer owns `target_sabnzbd.go`, `sabnzbdTarget()`, and SABnzbd Setup. The
reference owner registered `sabnzbdTarget()` in `targets.go`; this leaf hold
changes no shared registry or reconciliation code. Registration is not
activation approval: #363 keeps preflight Manual. The reference
removal/ownership policy remains unchanged.

Existing SABnzbd test bodies directly model key reuse, version readiness,
explicit empty queue/history, recovery of the same missing Project key,
authenticated `config:{}` and empty-server Manual states, and malformed
provider failures. The existing rerun body uses the real upstream `5.1.2`
version as a fake response control: standalone Setup/Check pass with valid
capabilities, Homarr verification rejects it, a fresh `5.1.3` passes, and a
blank observed version still fails standalone Setup/Check. This is not live
`5.1.2` acceptance. Both original regressions failed before the corrections
and passed after them. Those earlier checks covered the reference seam.
The 13 October migration
adds focused HTTP fixtures for this descriptor, including its
item validator. They are source validation, not native runtime acceptance.
No dependencies were added.

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
- [Pinned SABnzbd input schema](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/download-client/sabnzbd/sabnzbd-schema.ts)
- [Pinned normalized Downloads item schema](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/interfaces/downloads/download-client-items.ts)
- [Pinned tRPC serialization](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/trpc.ts)
- [Pinned serialization dependency](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/bun.lock)
- [SuperJSON 2.2.6 transformations](https://unpkg.com/superjson@2.2.6/dist/transformer.js)
- [Pinned Downloads query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/downloads.ts)
- [Pinned widget definitions and limits](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts)
- [Pinned Downloads defaults](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/downloads/index.ts)
- [Pinned Stats adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Pinned Stats cache](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [SABnzbd API reference](https://sabnzbd.org/wiki/configuration/5.1/api)
- [Pinned SABnzbd authentication and wizard](https://github.com/sabnzbd/sabnzbd/blob/a647f73426cb70ad60ae7964b96c2d5e939b4727/sabnzbd/interface.py)
- [Pinned SABnzbd API](https://github.com/sabnzbd/sabnzbd/blob/a647f73426cb70ad60ae7964b96c2d5e939b4727/sabnzbd/api.py)
- [Pinned SABnzbd config representation](https://github.com/sabnzbd/sabnzbd/blob/a647f73426cb70ad60ae7964b96c2d5e939b4727/sabnzbd/config.py)
- [SABnzbd 5.1.2 version control](https://github.com/sabnzbd/sabnzbd/commit/10609644c8b5eef462845ec6443f24dd8fcba96a)

## 13 October shared Stats and Downloads migration

The original branch forward-merges the shared Stats/Downloads SDK and its
retry metadata without rewriting history. `sabnzbdTarget()` keeps native
readiness, identity and queue semantics and uses `readDownloadsQueue` for
one owned Downloads result with an explicit items array and a requested
limit of 50. The shared owner acquires the catalog and exactly one forced,
positive advancing sample per `verifyData` invocation; `verifySABnzbdStats`
validates that same sample's units and types. Rates remain finite nonnegative
bytes/second and paused remains boolean with catalog unit `text`.
Only download and paused remain selected; unsupported nullable upload is
not coerced to zero. Finite negative completion times remain accepted.

Focused descriptor HTTP fixtures use the existing `statsFixture`, reject the
first invalid refreshed value without resampling, no-op refresh, wrong units,
wrong value types and foreign Downloads identity, and stop before the Stats
catalog on native failure. Explicit zero Stats remain valid even when the
independently sampled native rate or paused state differs. Local fixture
responses are synthetic and establish no real App/native/rendered acceptance.
The affected descriptor tests, shared Stats/Downloads tests, App tests,
package build/vet, gofmt and diff checks passed. No Docker/browser runtime,
provider request, download or protected Project state was used.

Registry assembly remains custodian-owned. The credential-safety image fix
and activation authorization precede useful real native/rendered data, both
installation orders and credential/ownership/removal lifecycle checks.
Source fixtures do not satisfy these prerequisites.
