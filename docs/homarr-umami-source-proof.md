# Umami Homarr source contract

Source, static image inspection and existing Go checks only, on 11 October 2026.
This is not functional or rendered acceptance for [#308](https://github.com/ajnart/selfhost-skills/issues/308).
The [reference contract](homarr-integration-contract.md) owns registration,
reconciliation and lifecycle behavior.

## Authentication and owned data

The Catalog image is `ghcr.io/umami-software/umami:3.4.0`; tagged source is
`ec0ff50388c264ed8ce46f00967e92f7e71476ae`.
Umami Setup keeps the existing seeded-administrator rotation, then uses official
HTTP APIs to create one separate `self-host-homarr` account with role `view-only`
and one fixture website named `self-host Homarr fixture`, domain `self-host.invalid`.
The administrator creates the website and transfers only that explicitly owned
identifier to the generated account. No tracking script, public website,
synthetic visits, Cloud account, database write or real visitor data is added.

Account and website UUIDs are generated and saved before creation as pending
identifiers, supplied through the supported API `id` fields, then checked against
the returned identity. Published identifiers are recorded only after the account
authenticates and the website transfer is read back. Ambiguous responses are
recovered through the same pending identifier, not by creating a duplicate or
adopting a matching name. Valid account passwords and identifiers are reused.

Project helper storage holds `UMAMI_HOMARR_USERNAME`, `UMAMI_HOMARR_PASSWORD`,
`UMAMI_HOMARR_USER_ID`, `UMAMI_HOMARR_WEBSITE_ID` and
`UMAMI_HOMARR_WEBSITE_CREATED_BY`, plus pending identifiers. Passwords are
generated inside Setup; transient login tokens are registered for redaction and
are not sent as Homarr API keys. A missing saved password, rejected identity,
changed role/team access or changed fixture ownership stays explicit and
retryable. Matching manually created resources are never changed or adopted.
Retry with `self-host setup umami`, then `self-host setup homarr` after review.

`view-only` is the lowest supported account role, not a claim that the owned
website is immutable: Umami 3.4.0 grants update/delete access to a website's owner.
The generated account has no administrator or team access and only the disposable
fixture is bound by this Link. Sharing and recording must remain disabled.

## Homarr contract

- Supported Homarr API version: **2.4.1**. No API-reported version was observed
  here; the common compatibility check must enforce it at runtime.
- The integration kind is `umami`; credentials are the exact supported
  `username`/`password` alternative. `apiKey` selects `x-umami-api-key`, not a
  self-hosted login bearer token. Cloud authentication is not claimed.
- Internal integration Address: `http://umami:3000/api`; browser Address remains
  the App's person-facing Address. Login is `POST /api/auth/login` followed by
  authenticated website, statistics, pageview-series and active-visitor reads.
- Native widget kind: `umami`, with the recorded `websiteId`, `timeFrame: 24h`,
  chart/bar/grouped view and no selected custom events. Exactly one integration
  and its explicitly owned fixture website are used. The actual image source
  exposes `existingStatsProviders.umami`: `websites` with unit `count`, from
  authenticated `getWebsitesAsync().length`. Shared Stats selects only that
  supported metric; no visitor analytics Stats metrics are invented.
- Read-only preflight runs before any Homarr mutation. Direct fresh reads reject
  missing fields, HTTP/authentication failures and incomplete series; explicit
  zero counts and empty arrays are valid. It never emits tracking events.
- Native verification reads `widget.umami.getWebsites`,
  `widget.umami.getVisitorStats` (`integrationIds`, `websiteId`, `timeFrame`) and
  `widget.umami.getActiveVisitors` (`integrationId`, `websiteId`). Visitor results
  must include the requested identifiers/window, explicit counts, data points
  and an `updatedAt` timestamp within one minute of the Host clock.

Direct validation uses an explicit rolling 24-hour window ending at the current
instant, with UTC hourly series. Homarr's `24h` preset instead spans the current
server-local hour plus 24 previous hours, ending at the end of the current hour;
its pageview query uses UTC buckets. These are different windows, so their totals
are not asserted equal. Active visitors are distinct sessions with events in the
last five minutes, not the chart's windowed visitor count. Homarr calculates its
own displayed bounce rate/duration; self-host does not invent a percentage.
The native active-visitors route can mask upstream errors as zero; a direct,
authenticated Umami read is therefore also required, never just that native zero.

## Resolved image evidence

Read-only GHCR discovery, not Docker execution:

| Image           | Index digest                                                              | linux/arm64 manifest                                                      |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Homarr `v2.4.1` | `sha256:ee67a5e856c051c4e114418a54b89a3fc3cb5507d0689e5cb89c790305c549cd` | `sha256:308feba8b9845cbdb21eb2e1b05579d49fb815bf3f0a452e58b59fcd4db8ecd2` |
| Umami `3.4.0`   | `sha256:85909afc45bdcda1917394594a087421fdbb05610fded0fa9f6fb861abb2f367` | `sha256:f239f756d1a03b473c07d17ba68861991753707025db40ad13d564e9839f783e` |

Homarr's image-label revision is
`3d4150e59f600876b7e308f857b2f21572b75348` and its image-label version is `main`.
These are distinct from the API version, release-source baseline
`ebbd4876d25a51151444a009ab596e1154d62880`, index and architecture manifest.
The Umami adapter, types, widget, router, integration definitions and Stats
providers are byte-identical at that label revision and the tagged source.
Umami's image config returned no revision/version labels.

The actual Homarr application layer was fetched without Docker and its bytes
verified against SHA-256
`6450c3917917cfc20212a769d838897ace0145d7cbca2b0235c18824e5203759`.
Static compiled chunks confirmed credential alternatives, login/bearer handling,
website/statistics/pageview/active schemas, widget options and native query input:

| Compiled chunk                                 | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `packages_integrations_src_umami_07ixqzb._.js` | `d184bdf418ad7f5674f733e3e668e97119a0d77223ee63a0e99a99acded73331` |
| `packages_integrations_src_00xcvb-._.js`       | `05ed97daae24407ada9d91e3437a676cff600167cc8acfdc722b6d5c24648bc3` |
| `packages_1dfrg5o._.js`                        | `791435b5e61fd92943594e4616c51be190a7ff66ebd13e5a5a352f514580b121` |
| `_099oqj-._.js`                                | `42659004b60bc4c874a974e8e8b043ffb0a0f58c091b696eb8bed720544c3b58` |
| `ssr/_00r2cly._.js`                            | `4e406306c184325f767f862cb730a0e1a28048c12c7190c129ea6483e49575c8` |

The archive and two selected chunks remain under the approved temporary folder
`umami-source-308-zlpxaq46`. These observations establish static image contents,
not successful running APIs or a rendered widget.

## Verification and outstanding acceptance

Build, both vet runs, full Go tests, existing focused Umami/Homarr tests, race
checks for Umami/Homarr/TUI/Activity, formatting and installer shell syntax pass.
Only the existing Umami fake was extended with exact owned-account/site endpoints
and authenticated explicit-zero responses; no test cases/files or dependencies
were added. The Homarr descriptor is compiled but deliberately not added to the
reference-owned `targets.go` registry by this lane.

Registration, actual account creation/transfer, authenticated live Umami and
Homarr data, rendered chart/explicit-zero values, synthetic controlled visits,
Manual recovery, restart, credential changes, both installation orders,
late-peer readiness, removal/reinstall and preservation of user-authored
resources remain unproved. Parent runtime approval and the frozen common
ownership contract are required before claiming the complete slice. No person's
Project, credentials, browser, Docker or real tracking data was accessed.

## Primary sources

- [Homarr Umami guide](https://homarr.dev/docs/integrations/umami/)
- [Homarr actual image revision adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/umami/umami-integration.ts)
- [Homarr schemas](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/umami/umami-types.ts)
- [Homarr router](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/api/src/router/widgets/umami.ts)
- [Homarr widget options](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/widgets/src/umami/index.ts)
- [Homarr Stats providers](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/stats/providers.ts)
- [Umami users API](https://github.com/umami-software/umami/blob/v3.4.0/src/app/api/users/route.ts)
- [Umami website creation schema](https://github.com/umami-software/umami/blob/v3.4.0/src/app/api/websites/request-schema.ts)
- [Umami website transfer](https://github.com/umami-software/umami/blob/v3.4.0/src/app/api/websites/%5BwebsiteId%5D/transfer/route.ts)
- [Umami website permissions](https://github.com/umami-software/umami/blob/v3.4.0/src/permissions/website.ts)
- [Umami active-visitors semantics](https://github.com/umami-software/umami/blob/v3.4.0/src/queries/sql/getActiveVisitors.ts)

## Original-branch normalization, 13 October 2026

The original release branch forward-merges the SDK and additive Stats contracts
without rewriting history. Reinspection of the exact Homarr OCI source revision
corrects the earlier absent-provider statement: the `websites` provider is in
`existing.ts`. Its pure descriptor callback accepts finite nonnegative integer
counts with `count` units from one central advancing refresh. Website counts from
independently collected native and Stats samples are not compared for equality.
Native analytics keeps the recorded website/account, 24h window, explicit empty
series, direct authenticated reads and one-minute native timestamp limits. Native
counts, bounce percentage, data-point timestamps and website name/domain are
validated without fabricating nulls or missing values.

Focused descriptor HTTP fixtures exercise native authentication/identity and the
central catalog/snapshot/forced-refresh path, including invalid units/counts,
missing/null values and no-op timestamps. They are synthetic source evidence;
live/rendered/lifecycle acceptance remains outstanding. No Docker, browser,
private Project, tracking events or external account actions were used.

- [Actual image-source website Stats provider](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/existing.ts)
