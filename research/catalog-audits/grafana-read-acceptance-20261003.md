# Grafana staged dashboard configuration read candidate

Checked 2026-10-03 against recipe `grafana/grafana:13.2.2`.

The app-owned adapter reads one reviewed existing `dashboard-uid` (opaque
ASCII ID, at most 40 characters), using the saved `admin` Basic credential.
It creates no dashboard, token, data source or other application object.

This observer is staged, not active application acceptance. There is no
`acceptance-contract.json`; the shared dispatcher reports Grafana unavailable.
Dashboard configuration reads do not establish useful monitoring or a core
round-trip. No generic core/liveRestart receipt or full product acceptance
credit is allowed until separately authorized datasource query/metric read
evidence establishes the actual monitoring workload. Merely attaching the
configuration-read result to generic core checks would inflate its scope.

The retained candidate input is `{ "key": "dashboard-uid", "format":
"opaque-id", "maximumLength": 40 }`. Its future narrow observation mapping
is `dashboardLayoutConfigReadVerified: true` with `workloadScope:
"dashboard-layout-config-read"`, not a generic `core-round-trip` pass.

## Pinned official evidence

- [API route registration](https://github.com/grafana/grafana/blob/v13.2.2/pkg/api/api.go)
  declares Basic authentication and protects `GET /api/dashboards/uid/:uid`
  with dashboard-read UID scope. No datasource query route is invoked.
- [Dashboard read implementation](https://github.com/grafana/grafana/blob/v13.2.2/pkg/api/dashboard.go)
  reads in the current authenticated organization, returns saved dashboard JSON
  and metadata, computes save/admin capabilities, and synchronizes version.
  The legacy route is deprecated but remains implemented at this exact pin.
- [Current user read](https://github.com/grafana/grafana/blob/v13.2.2/pkg/api/user.go)
  supplies administrator identity and organization. The observer requires the
  saved server administrator, positive user/org IDs and dashboard owner scope.
- [HTTP database health](https://github.com/grafana/grafana/blob/v13.2.2/pkg/api/http_server.go)
  returns database status and 503 when database/API readiness fails.

Context7 resolved `/grafana/grafana` and confirmed the dashboard-read route;
its indexed sources use `main`, so pinned source above is authoritative here.

## Exact claim and exclusions

Scope is `dashboard-layout-config-read`. The selected existing dashboard must
contain at least one valid visualization panel; empty dashboards and rows-only
layouts fail. Panels have unique positive IDs, bounded grid positions, safe
plugin-type identifiers, and at most 256 total panels/four nested row levels.

The persisted baseline contains only user/org/dashboard IDs, panel count and a
SHA-256. Hash input is stable dashboard ID/UID/version/schema/folder identity,
panel IDs/order/type/grid, row collapse and narrowly allowlisted display config:
transparency, header visibility, orientation, graph/color/text/justify modes.
Unknown plugin options, queries, targets, datasource configuration, text,
titles, URLs and credential fields are excluded even from hash input. This
does not claim persistence of every plugin option or arbitrary dashboard content.

The shared read-only lifecycle factory binds inputs and exact owner/image
lineage, forbids observer writes, retains an immutable baseline via CAS, and
requires recorded stop plus distinct restart of only `grafana`. After bounded
authenticated startup reads, the observer repeats identity/health/dashboard
reads and compares the stable baseline.

The focused synthetic fixture explicitly checks that the contract loader
returns null and the dispatcher remains unavailable, then directly exercises
the candidate adapter. It checks rejection of empty/malformed dashboards,
wrong scope/auth/health, changed layout/config/version/organization, changed
workload/lifecycle, and baseline replacement; it checks read-only requests and
absence of raw content/credentials in checkpoint. It does not exercise Docker,
real Grafana, browser rendering, metrics, datasource connectivity, user/client
acceptance or a live compatibility score.
