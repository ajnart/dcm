# Bazarr Homarr slice: source checks, not live acceptance

Issue: [#272](https://github.com/ajnart/selfhost-skills/issues/272).
Reference base: `573a206e`, [#309](https://github.com/ajnart/selfhost-skills/pull/309).
The shared [Homarr Link contract](homarr-integration-contract.md) applies.

## Stage 1: historical descriptor-only source phase

The record below describes corrected source
`b28da7a09d19dbab3b47d61d562c20f7990e3fb9` against the original reference base.
Its pending registration/reference statements and test gate are historical;
the frozen-reference normalization record follows the official sources.

## Credentials and own Setup

The Catalog pins `lscr.io/linuxserver/bazarr:version-v1.6.0`. Bazarr v1.6.0
generates one unscoped API key, not separate read-only integration keys.
Setup preserves Basic authentication and discovers `auth.apikey` through the
existing App-local `h.ConfigValue` helper. It registers the discovered value
for redaction before any API request and stores it as `BAZARR_API_KEY` through
`h.SetSecret` only after verifying `/api/system/status` and `/api/badges`.
API authentication uses the `X-API-KEY` header, never a query argument.

Every credential step Check and App Check probes both endpoints afresh.
A valid saved key is reused without rereading configuration or rewriting any
setting. A missing key or a key rejected with 401/403 is rediscovered from the
same App-local helper. Other failures do not replace a saved credential.
Recovery: run `self-host setup bazarr`, then `self-host setup homarr`.
If recovery fails, inspect Bazarr's Status and Settings > General > Security;
do not disable authentication or paste a key into agent messages.

The existing Admin login and media mount are unchanged. This slice does not
configure Sonarr/Radarr, language profiles, path mappings or subtitle providers.
Provider account choices remain manual; no external account is created and no
subtitle is downloaded. The checked reference base has no Bazarr-owned Links;
none is removed or replaced here.

## Descriptor and native data

`internal/apps/homarr/target_bazarr.go` defines `bazarrTarget() target`.
Only the #262 registry owner should add `bazarrTarget()` to `targets.go`.
Until registration, the compiled Homarr App does not schedule this new Link.
This lane changes neither the registry nor shared reconciliation.

Homarr v2.4.1 source `ebbd4876d25a51151444a009ab596e1154d62880` defines:

- Integration kind `bazarr`, credential alternative `apiKey`, internal Address
  `http://bazarr:6767`; the browser Address remains independent.
- Native widget `bazarr`, showing missing episode and movie subtitles, provider
  issues and health issues with all four documented visibility options enabled.
- Shared Stats keys `episodes`, `movies`, `providers`. These are missing
  subtitle counts and throttled-provider issues, not library size or configured
  provider counts. Ownership and stable entry IDs come from the reference seam.
- Native query `widget.bazarr.getBadges` with Homarr's returned `integrationId`.
  Link verification validates all five nonnegative integer badge counts and both
  SignalR string fields after validating the peer's live API credential.

Zero counts and `DOWN` SignalR status are legitimate when media peers are absent
or the inventory is empty; neither is an authentication failure. Missing/null
fields, rejected credentials, malformed data and unsuccessful native queries
are failures, not an empty library or tile-only success.

## Verification and remaining gate

Remaining focused coverage is exactly the two baseline Bazarr App tests:
`TestSetupThenCheckThenRerunSkips` and
`TestFailingStepHintNamesTheSetupCommand`. The first checks successful Setup and
Check, saved API credentials, valid zero-count responses and rerun preservation
without authentication updates, with configuration still present. Missing-config
or configuration-reread avoidance is not test coverage. Its maintained fixture
serves `/`, `/api/system/settings`, `/api/system/status` and `/api/badges`. The
second covers a failed settings update and its Settings hint. Credential-change,
malformed-data rejection and Homarr descriptor/count-guard behavior remain
source/schema/compile-only pending native proof, not final-HEAD test coverage.

The entirely agent-added 135-line `target_bazarr_test.go` and the added functions
`TestAPIReadinessRejectsMissingFieldsAndAuthenticationErrors` (all seven table
cases) and `TestSetupRecoversExternallyChangedKeyAndCheckProbesAfresh` were removed
with explicit parent authorization, along with their exclusive fixture controls.
The earlier parent-authored delegation request was not an actual human explicit
unit-test request. No baseline function or implementation was removed and no
replacement tests were added. Added named test/helper function count against
fixed base `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d` is zero.

The final post-correction local gate passed on only the remaining test tree:
`GOFLAGS=-buildvcs=false`, empty `gofmt -l .`,
`go build ./...`, `go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`,
race tests for TUI, Activity, Bazarr and Homarr, `bash -n install.sh` and
`git diff --check`. Focused/full/race tests ran with `-count=1`; none of the
removed tests was part of this gate. No e2e-tagged runtime tests were run.

Live proof is blocked by reference acceptance and parent-controlled capacity.
No Docker, browser, installer, person's Project, protected secret file or browser profile
was accessed during this lane. Before readiness, register the descriptor and
explicitly authorize a disposable isolated Project, record resolved Homarr and
Bazarr image digests, and verify real badge/Stats rendering, both install orders,
late installation, restart, changed credentials and owned-only removal/reinstall.
Keep the PR draft and the issue open until those conditions are met.

## Official sources

- [Homarr Bazarr guide](https://homarr.dev/docs/integrations/bazarr/)
- [Homarr Bazarr authentication and native reads](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/bazarr/bazarr-integration.ts)
- [Homarr badge and status schemas](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/bazarr/bazarr-types.ts)
- [Homarr native widget options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/bazarr/index.ts)
- [Homarr native badge query](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/bazarr.ts)
- [Homarr Stats keys](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Bazarr v1.6.0 key generation](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/app/config.py)
- [Bazarr v1.6.0 authentication](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/utils.py)
- [Bazarr v1.6.0 status](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/system/status.py)
- [Bazarr v1.6.0 subtitle badge counts](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/badges/badges.py)

Context7 discovery was attempted but its quota was exhausted. The selected
contracts were verified directly against official tagged source instead.

## Stage 2: frozen-reference normalization, source only

Normalized source pin: `ee5de2c1939965789649ddf3541441306444d740`.
The subsequent source-check documentation commit changes no production or tests.

Reference #309 is merged and #262 closed. This phase merges frozen main
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c` normally into the existing Bazarr
branch at merge `e0bb36bde7a101295bc9280c3fbfcf9379601fff`, preserving corrected
`b28da7a09d19dbab3b47d61d562c20f7990e3fb9`. No merge conflicts occurred.
The frozen tree equals final reference evidence commit
`33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`; its tested reference production was
`89301aff17c86b767f5a45076881f2bb7b41db39`. That Immich proof is not Bazarr proof.
The current [peer workflow](https://github.com/ajnart/selfhost-skills/blob/main/docs/agents/homarr-integrations.md)
governs later phases.

The sole registry custodian adds exactly one `bazarrTarget()` call to
`targets.go`, retaining `existingTargets()` and `immichTarget()` unchanged.
The leaf uses the existing `target` contract. Its new preflight delegates to
the already exported, read-only `bazarr.VerifyHomarr(ctx, to)`: each invocation
reads the saved key, registers it for redaction and freshly probes authenticated
`/api/system/status` and `/api/badges` through existing HTTP helpers. Common
`linked` and `add` invoke it before compatibility checks or Homarr credential
creation/update. It does not call credential Setup, read configuration, store
keys, change authentication or require the Admin login/UI. This API-readiness
check does not establish whole Setup, Sonarr/Radarr readiness or provider access.
Missing/rejected keys retain the Bazarr-then-Homarr Setup recovery instructions.

The integration Address stays `http://bazarr:6767`: the actual adapter appends
`/api/system/status` and `/api/badges`, so storing an `/api` suffix would duplicate
it. The browser Address remains separately resolved by the frozen common flow.
Authenticated Homarr API version `2.4.1`, kind `bazarr` and exact `apiKey`
credential compatibility remain centrally enforced. No empty credential or
unauthenticated fallback is introduced.

The unchanged leaf validates authenticated `widget.bazarr.getBadges` data and
its five nonnegative integer counts and two SignalR strings. Central
`verifyData` still runs after the leaf, forces Stats refresh and requires an
advancing positive `updatedAt`, `error: false`, `stale: false` and non-null
`episodes`, `movies`, `providers`. Their missing-subtitle/throttling meanings
remain unchanged. Removal/absence never invokes preflight or native data reads.
Shared reconciliation, ownership, legacy registrations and images are untouched.

Cached Git source comparison confirms these nine Bazarr-scoped files are
identical at research baseline `ebbd4876d25a51151444a009ab596e1154d62880` and
recorded reference OCI revision `3d4150e59f600876b7e308f857b2f21572b75348`:
`packages/definitions/src/integration.ts`,
`packages/definitions/src/widget-integration-map.ts`,
`packages/integrations/src/bazarr/bazarr-integration.ts`,
`packages/integrations/src/bazarr/bazarr-types.ts`,
`packages/api/src/router/widgets/bazarr.ts`,
`packages/request-handler/src/bazarr.ts`,
`packages/widgets/src/bazarr/index.ts`,
`packages/widgets/src/bazarr/component.tsx` and
`packages/integrations/src/stats/existing.ts`.
This is scoped source provenance, not whole-revision equivalence or current
image attestation; no registry metadata or image was fetched in this phase.

Bazarr App source and its test file remain byte-identical to `b28da7a`.
No new test files, functions, subtests, independent scenarios, fault matrices,
comments or dependencies were added. Direct Bazarr coverage remains exactly
the two baseline tests described above; the descriptor, new preflight routing,
credential changes and malformed/native data guards are source/schema/compile
coverage, not newly implemented test or runtime proof.

The normalized production tree passed the local gate in terminal shell
`sh_13035227d001YlEZe0Pr7AsPnf` using cached Go 1.26.0 with
`GOFLAGS=-buildvcs=false`, `GOTOOLCHAIN=local`, `GOPROXY=off` and `GOSUMDB=off`:
empty `gofmt -l .`, focused Bazarr/Homarr tests, `go build ./...`,
`go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`, race tests for
TUI/Activity/Homarr/Bazarr, `bash -n install.sh` and `git diff --check`.
Focused/full/race tests used `-count=1`; no e2e-tagged runtime tests ran.
Only documentation was completed after this gate; production and test bytes
remain those verified by it.

Keep #320 draft and #272 open. Fresh independent Standards/Spec reviews and the
parent's oracle phase gate remain required before counting this normalization.
Native/rendered values, both installation orders, late-peer scheduling, restart,
credential-change recovery and shared removal/reinstall acceptance remain held
for a separately authorized bounded proof. No runtime consent is active and no
Docker, browser, installer, host/provider/account, protected secret/profile or
Gatus candidate/archive work was performed.

## Stage 3: missing-config scenario removal, source only

Starting pin: `9bb75b06cd1983c75f606e58c603d7e58cbd837b`; frozen reference remains
`6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. With parent/oracle approval, remove only
the confirmed agent-authored three-line `os.Remove(config.yaml)` block inside
`TestSetupThenCheckThenRerunSkips`. That added scenario had no explicit human
request and was not required API fixture maintenance. Both baseline functions,
API response fixtures, saved-key and settings-write idempotence assertions remain.
All production, preflight, registry and common bytes stay identical to the
starting pin; previously removed tests stay absent. No tests, helpers, functions,
subtests or scenarios are added. Missing-config/no-reread avoidance, credential
changes and descriptor/preflight/native guards remain source/schema/compile-only.

The corrected remaining test tree passed the cached Go 1.26.0 offline gate
under the same four environment settings recorded above: empty `gofmt -l .`,
build, both vet commands, focused/full tests, race tests for TUI/Activity/Homarr/
Bazarr, `bash -n install.sh` and `git diff --check`. Tests used `-count=1`;
the removed fault trigger was absent from every run. No e2e-tagged runtime ran.
Parent-owned fresh fixed-reference Standards and Spec reviews remain pending;
native proof is held.


## Shared Stats SDK normalization, source and focused HTTP evidence

The original branch history is preserved by forward merges of shared SDK
`0bf67c3c64c229af25f19c1b93264f19cc57a910` and additive metadata SDK
`d069339add5924f942ea6536f77d68e64b165df0`. No registry or common verification
implementation is changed by this peer.

The descriptor now uses a pure `statsSample` callback for `episodes`, `movies`, `providers`.
One common catalog/snapshot/forced-refresh sequence supplies the same values
validated by the leaf. Exact catalog units and value types are checked: counts.
Missing/null fields, invalid counts/units and no-op refreshes fail; legitimate
zeros remain valid. Common timestamp validation remains finite, positive and
advancing; this peer adds no invented clock policy.

Native authenticated peer status/badge checks and all five native count/two SignalR guards remain unchanged. Stats count values may differ from independently cached native badges; both are validated without equating volatile samples.

Units and selected provider keys were checked in immutable Homarr OCI source
`3d4150e59f600876b7e308f857b2f21572b75348`, using
`packages/integrations/src/stats/existing.ts` and, for Frigate,
`packages/integrations/src/stats/providers/frigate.ts`. This is source provenance,
not new image attestation.

Focused HTTP scenarios use the shared `statsFixture` through `verifyData`, with
the native verifier explicitly isolated, and assert one forced refresh for the
owned integration. They cover valid empty/populated samples, invalid selected
values/units and refresh no-op rejection. App and Homarr affected-package tests,
affected-package build/vet, changed-file gofmt and `git diff --check` passed.
No Docker, browser, installer or broad suite was run. These fixtures verify the
source interface; they do not claim real native/rendered acceptance.

#320 remains draft and #272 remains open. Provider setup, rendered native/Stats data and both installation orders still require their own approved bounded proof.
