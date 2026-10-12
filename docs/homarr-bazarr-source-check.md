# Bazarr Homarr slice: source checks, not live acceptance

Issue: [#272](https://github.com/ajnart/selfhost-skills/issues/272).
Reference base: `573a206e`, [#309](https://github.com/ajnart/selfhost-skills/pull/309).
The shared [Homarr Link contract](homarr-integration-contract.md) applies.

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

Remaining focused coverage is in the existing Bazarr App fixtures in
`internal/apps/bazarr/bazarr_test.go`: valid zero counts, fresh credential
rejection, key recovery, rerun preservation, rejected/unavailable API access,
missing version, missing/null/negative badge fields and malformed API data.
Homarr's Bazarr descriptor is source/schema/compile-only pending native proof;
there is no final-HEAD descriptor unit-test or full mock-acceptance claim.

The entirely agent-added 135-line `target_bazarr_test.go` was removed with explicit
parent authorization. The earlier parent-authored delegation request for focused
descriptor tests was not an actual human explicit unit-test request. No existing
App fixture or implementation was removed and no replacement tests were added.

The post-correction local gate passed on only the remaining test tree:
`GOFLAGS=-buildvcs=false`, empty `gofmt -l .`,
`go build ./...`, `go vet ./...`, `go vet -tags e2e ./e2e/`, `go test ./...`,
race tests for TUI, Activity, Bazarr and Homarr, `bash -n install.sh` and
`git diff --check`. Focused/full/race tests ran with `-count=1`; the removed
descriptor test was not part of this gate. No e2e-tagged runtime tests were run.

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
