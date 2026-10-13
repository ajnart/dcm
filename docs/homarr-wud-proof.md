# WUD Homarr source validation

Source-only work for [#306](https://github.com/ajnart/selfhost-skills/issues/306),
based on committed reference `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
Uses the [reference Link contract](homarr-integration-contract.md).
The original peer history now forward-merges SDK
`0bf67c3c64c229af25f19c1b93264f19cc57a910`, without rewriting its commits.
The current native router, WUD mapping and Stats provider were inspected
read-only at OCI source `3d4150e59f600876b7e308f857b2f21572b75348`
in the local Homarr checkout. The tagged source below is a separate baseline.
No Docker, browser, image inspection, registry request or runtime proof was run.
Context7 was already exhausted; exact official source was read directly.

## Verified source contracts, not tested image identities

- Homarr `v2.4.1` resolves to
  `ebbd4876d25a51151444a009ab596e1154d62880`; compiled App image remains
  `ghcr.io/homarr-labs/homarr:v2.4.1`.
- Catalog WUD image remains `getwud/wud:9.1.0`; upstream tag `9.1.0` resolves
  to `93dac8761505ce77ae0584450dfabff72f94896b`.
- No resolved image digest or tested running version is available in this work.

## Credentials, data and widgets

WUD Setup's new `homarr-api` step and read-only `ReadHomarrStats` verify the
saved administrator identity/role at `/auth/user`, anonymous inventory denial,
and authenticated `GET /api/containers`. Existing Project secrets are reused;
no account/token creation, password rotation, role change, adoption or no-auth
fallback is added. Basic authentication is the pinned native client's usable
mode, not a dedicated least-privilege credential: WUD also allows `ro`/`rw`
accounts to read containers, but no such account is provisioned or adopted here.
The existing environment-owned administrator bootstrap is unchanged.

Homarr kind `wud` accepts `[]` or `username`/`password` upstream. This descriptor
always supplies the latter, targeting `http://wud:3000`, separately from the
browser Address. Its native widget uses `showTitle=true`, `showRing=true`,
`layout=horizontal`, `showUpdateList=true`, and at most one integration. Shared
Stats uses existing deterministic entry ownership, with keys:

| Key                | Exact meaning                                                   |
| ------------------ | --------------------------------------------------------------- |
| `totalContainers`  | Number of records returned by WUD's container API               |
| `updatesAvailable` | Number of returned records with explicit `updateAvailable=true` |

WUD's own update flag already accounts for snoozing/cooling-down and its
tag/digest comparison. These are not all installed Apps, scanned-image counts,
registry-success counts, or a guarantee that every image is current. Update
details follow Homarr's exact mapping: display name or name, current image tag,
remote update value or result tag, and nullable release link.

An authenticated `[]` is valid empty API data; it is not watcher readiness.
Link preflight emits a retryable Manual step before any Homarr mutation for
empty inventory. Explicit false update flags and zero counts are accepted.
Missing/null flags, duplicate/missing identifiers, invalid nested metadata,
unapproved watcher rows and reported watcher/registry errors fail explicitly.

Native verification retains administrator identity, anonymous denial and useful
update observations. `widget.wud.getStats` must have a timestamp within its
pinned ten-second cache window, finite nonnegative integral counts, updates no
greater than total containers, and an explicit update array of the stated size.
Every update has a unique nonempty ID/name and explicit string-or-null current
version, new version and link. Separate volatile inventories are not compared
for equality.

Central `verifyData` reads the catalog and obtains one forced advancing Stats
sample. Pure `verifyWUDStats` validates that same sample's count units, integral
nonnegative counts, updates no greater than containers, and timestamp between
request start and response completion plus the existing one-second future skew.
A slow response uses completion for the upper limit. No native failure reaches
Stats, and no semantic failure acquires a second sample.

Read-only Link preflight now also checks the App's fixed TLS prerequisites,
reporting missing approved endpoint/trust files as Manual before Homarr mutation.
It never runs the App's watcher scan or reads private credentials for discovery.

## Discovery and runtime acceptance blockers

The Link adds no Docker socket, host mount, device privilege, capability,
registry credential, public Access, auto-update trigger or Docker inspection.
Its WUD requests are reads; it does not invoke the existing App Check's watcher
POSTs. Compose and existing fixed App-owned TLS mounts are unchanged.

WUD's Docker watcher calls `listContainers` before client-side label filtering.
A global read-only socket proxy could therefore inspect the person's other
containers even with `WATCHBYDEFAULT=false`. A watcher name, Project membership,
Compose authority, TLS or denied write methods is not discovery approval.
No approved endpoint enforcing Project-only container and image reads is
available for this lane. A supported scoped disposable source needs separate
approval; synthetic inventory is not proof of real Docker/registry monitoring.

WUD's container API returns stored inventory without an observation timestamp.
Fresh Homarr cache timestamps do not prove current Docker membership or registry
age. Existing WUD Setup/Check perform scoped watcher scans separately, but their
Docker-list confidentiality and outbound registry boundary still require the
parent's contained runtime phase. No such phase was executed here.

Real native queries, nonempty watched-image data, rendered widget values,
negative runtime authentication, restart, credential changes, both installation
orders, late-peer retry, removal/reinstallation, and user-resource preservation
remain unproved. Parent-owned registry assembly is also still required: this
lane adds `wudTarget()` but deliberately leaves `targets.go` unchanged.

## Local evidence

Focused descriptor HTTP fixtures exercise `wudTarget().verifyData` with the
existing shared `statsFixture`: a changing independent inventory, nullable
update fields, legitimate zero updates, invalid counts/units, no-op refresh,
request/completion clock limits, stale/malformed native data and Manual TLS
prerequisites. These source fixtures are not Docker/registry monitoring proof.
Focused owning WUD/Homarr package checks, build, vet, gofmt and diff checks
are recorded by the normalization lane; no broad suites or runtime were run.

## Official source index

- [Homarr kind/auth definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/integration.ts)
- [WUD client](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/wud/wud-integration.ts)
- [WUD response schema and mapping](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/wud/wud-types.ts)
- [Native Stats metrics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Stats refresh/router](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/stats.ts)
- [Stats snapshot freshness/error semantics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts)
- [Native WUD router](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/wud.ts)
- [WUD widget options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/wud/index.ts)
- [Widget integration limits](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/definitions/src/widget-integration-map.ts)
- [Stats entry schema (100 entries maximum)](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/stats/config.ts)
- [WUD API and read/write roles](https://github.com/getwud/wud/blob/93dac8761505ce77ae0584450dfabff72f94896b/app/api/container.ts)
- [WUD update flag semantics](https://github.com/getwud/wud/blob/93dac8761505ce77ae0584450dfabff72f94896b/app/model/container.ts)
- [WUD discovery order](https://github.com/getwud/wud/blob/93dac8761505ce77ae0584450dfabff72f94896b/app/watchers/providers/docker/Docker.ts)
- [WUD environment-owned administrator bootstrap](https://github.com/getwud/wud/blob/93dac8761505ce77ae0584450dfabff72f94896b/app/store/auth_bootstrap.ts)
