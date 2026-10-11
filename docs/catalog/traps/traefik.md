# Traefik traps

## Pitfalls

- The App never enables insecure API/dashboard access. Control-interface
  credentials do not create Traefik user records; existing owners are not
  silently migrated or given replacement credentials.

## Security

- Protect the Docker API and authenticate the dashboard.

## Homarr source contract (#304)

This is a source-only leaf for the [Homarr Link contract](../../homarr-integration-contract.md).
The reference owner must register `traefikTarget()` in `targets.go`; this leaf
does not change the registry or common ownership/reconciliation code.

The App already pins `traefik:v3.6.22`. Its official source tag resolves to
`e15c8f86ba7370d01f529682f3b28d2f1d2bb4b5`. Setup and Check verify the saved
Admin login against `/api/version` and the enabled `selfhost-api@file` router.
The Homarr leaf reuses those Project helpers and that existing Setup; it creates
no account, key or replacement credential and stores no additional peer secret.
The server-side Address is `http://traefik:8080`, separate from the browser
Address selected by Access. The App's native dashboard remains disabled.

Homarr's supported image tag is `ghcr.io/homarr-labs/homarr:v2.4.1`. The reference
lane reports its image-label source revision as
`3d4150e59f600876b7e308f857b2f21572b75348`, rather than the tagged research baseline
`ebbd4876d25a51151444a009ab596e1154d62880`. Public primary-source byte comparisons
on 12 October 2026 found these ten files identical across those revisions:

- `packages/definitions/src/integration.ts` and `widget-integration-map.ts`.
- `packages/integrations/src/traefik/traefik-integration.ts` and `traefik-types.ts`.
- `packages/integrations/src/stats/existing.ts`.
- `packages/api/src/router/widgets/traefik.ts` and `stats.ts`.
- `packages/widgets/src/traefik/index.ts` and `component.tsx`.
- `packages/request-handler/src/stats.ts`.

The adapter SHA-256 is
`e661c7c47e24cc1ee6130bd9760b98a92e4445ad3fb2bb37de6efb8e025c21fa`;
the existing Stats provider SHA-256 is
`e37b85fe958eb779a4de2580b32b1a65667e50e0125f3e892f47803a02322e2f`.
Source identity is not an image digest or live functional acceptance. This lane
did not inspect or run either image; neither a resolved Traefik image digest nor
live native data is claimed.

### Authentication and read-only readiness

The upstream definition allows empty credentials, `username`/`password`, or
bearer `apiKey`. This leaf selects only the existing saved BasicAuth login.
Traefik OSS does not issue a bearer key for this App configuration; Homarr's
alternative is not permission to invent one or remove authentication.

Before any Homarr compatibility request or resource mutation, preflight checks
the anonymous BasicAuth challenge and authenticated entry points and all eight
HTTP/TCP/UDP resource lists. It requires the existing management entry point,
enabled `selfhost-api@file` router targeting `api@internal`, enabled API service,
and enabled `selfhost-auth@file` BasicAuth middleware. Missing/malformed bodies
are failures, not empty lists. HTTP 404 identifies a missing or disabled API
route; a rejected saved BasicAuth login is a retryable credential/config failure.
Anonymous success, redirects, forbidden access and non-Basic challenges become
an actionable Manual step before mutation. Keep the existing protection unchanged,
review it with its owner, and retry `self-host setup traefik` followed by
`self-host setup homarr`; no no-auth, bearer, DigestAuth or forward-auth fallback
is attempted.

Traefik defaults to 100 entries per endpoint. Homarr's adapter does not paginate.
Preflight requires valid `X-Next-Page` metadata and stops as Manual if another
page exists, rather than report first-page counts as complete totals. Do not
delete user routes to satisfy this limit; retain routing and use a manually
configured dashboard capable of the existing resource set.

No change is made to the file provider, entry points, port bindings, Access,
Admin login, TLS, routes or existing mounts. No Docker/Kubernetes discovery,
socket, host privilege, insecure API, public Address or TLS bypass is added.
The middleware API can include sensitive configuration; response bodies and
transport errors are never included in this leaf's diagnostics.

### Native widgets and metric semantics

The native widget kind is `traefik`, with `showTcp`, `showUdp` and
`showEntryPoints` enabled. It supports multiple integrations without a declared
maximum; this Link binds its one recorded owned integration. Verification calls
`widget.traefik.getDashboard` with that ID, rejects failed endpoints, validates
protocol totals/status summaries and bounded resource details, and requires the
pinned version and management entry point. Homarr caps detail rows at 200.

Shared Stats uses exactly `routers`, `services` and `middlewares`, all in units
of **count**. Routers and services sum HTTP + TCP + UDP totals; middleware sums
HTTP + TCP only. These count returned configuration entries, including internal
management resources and disabled/warning entries, not request traffic,
successful connections or backend health. Homarr tracks enabled/warning/error
summary buckets; disabled entries contribute to total but not its error bucket.
Its health badge is not acceptance that ordinary user routes work.

Verification requests `widget.stats.refresh` with `force: true`, requires explicit
non-error/non-stale flags, a valid positive timestamp and finite nonnegative
integer values, and compares all three totals with fresh direct API reads.
Missing values are never replaced with zero. Explicit empty TCP/UDP lists are
valid; the protected HTTP management resources cannot be absent. Concurrent
route changes can cause a retryable count mismatch without changing routing.
The upstream refresh can return an existing snapshot when another worker owns
its lock. A central per-request freshness check remains reference-custodian
work; the flags alone do not prove a newly completed refresh.

### Acceptance limits

Existing focused tests and the repository's full local gate validate source
compilation and existing behavior, not execution of this unregistered leaf.
Registration, central Stats freshness, genuine authenticated native API output,
rendered widgets, ordinary user request routing, restart/credential changes,
both installation orders and removal/reinstallation still need contained
acceptance. Common recorded ownership must preserve manually authored resources;
this leaf neither adopts them nor supplies a separate lifecycle implementation.
No Docker, browser, installer or user Project was used for this source-only work.

### Primary sources

- [Official Homarr Traefik guide](https://homarr.dev/docs/integrations/traefik/).
- [Image-revision authentication definition](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/definitions/src/integration.ts).
- [Image-revision Traefik adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/traefik/traefik-integration.ts).
- [Image-revision dashboard query](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/traefik.ts).
- [Image-revision widget options](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/widgets/src/traefik/index.ts).
- [Image-revision Stats metrics](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/existing.ts).
- [Image-revision Stats refresh/cache semantics](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/request-handler/src/stats.ts).
- [Traefik v3.6 API security and GET endpoints](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/api-dashboard/).
- [Traefik v3.6.22 API pagination](https://github.com/traefik/traefik/blob/e15c8f86ba7370d01f529682f3b28d2f1d2bb4b5/pkg/api/criterion.go).
- [Traefik v3.6.22 resource/status representation](https://github.com/traefik/traefik/blob/e15c8f86ba7370d01f529682f3b28d2f1d2bb4b5/pkg/api/handler_http.go).
- [Traefik v3.6.22 BasicAuth](https://github.com/traefik/traefik/blob/e15c8f86ba7370d01f529682f3b28d2f1d2bb4b5/pkg/middlewares/auth/basic_auth.go).
