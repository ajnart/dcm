# Uptime Kuma traps

## Pitfalls

- Its data path requires POSIX locks and is not supported on NFS.

## Security

- Protect the admin UI and notification credentials.
- Creating an API key globally changes /metrics authentication from administrator Basic auth to API-key Basic auth. These keys do not authenticate the status-page API or the administrator's Socket.IO API. Setup creates and rotates no keys.

## Homarr Link

- The source contract is Homarr v2.4.1 and Catalog image `louislam/uptime-kuma:2.5.5`. No image digest or runtime compatibility has been verified for this slice.
- The descriptor is `uptimeKumaTarget()`, kind `uptimeKuma`, with internal Address `http://uptime-kuma:3001`, separate from the browser Address. Registry assembly belongs to the reference lane.
- Select an actual existing page with `self-host install uptime-kuma --yes --set uptime-kuma.homarr_status_page=SLUG`, replacing `SLUG` with its real slug. Review the monitors already shared without a login before selecting it. Retry `self-host setup uptime-kuma` and `self-host setup homarr`. No default slug is assumed.
- Selection grants read-only use, not ownership: the Link never creates, changes, publishes, adopts or deletes a Kuma page, group, monitor, account or key. It never changes Access. Creating a new public monitor group needs separate explicit approval; do not publish private monitors to satisfy Homarr.
- The selected credential alternative is only `slug`. Homarr declares empty, slug, API-key and slug-plus-key alternatives, but its tagged native adapter reads `/api/status-page/<slug>` and `/api/status-page/heartbeat/<slug>` without using the key. An API key is not a privacy boundary for those endpoints. Kuma's `published` flag is not relied on as access control.
- The first administrator, API keys and page management use Socket.IO. There is no existing transport in this Go module, so administrator creation remains retryable Manual. Saved Admin login verification uses challenged Basic-auth `/metrics` only; existing API-key mode remains Manual instead of disabling keys or claiming that metrics access proves a Socket.IO sign-in.
- Missing selection/pages stop the peer preflight before Homarr mutation. Readiness probes parse actual page/group/monitor identifiers and heartbeat data. HTTP 200 alone is not monitor health. An explicitly empty page is valid but gives no monitor-health proof.
- Native verification reads `widget.uptimeKuma.getDashboard` with the owned integration ID, checks monitor IDs/names, status counts and percentage ranges, then reads `widget.stats.catalog`. The dedicated `uptimeKuma` widget enables its six official display switches; shared Stats adds `totalMonitors`, `upCount`, `downCount`, `averageUptimePercent`. No fabricated monitor ID or unsupported paused Stats metric is supplied.
- Homarr maps heartbeat 0 to down, 1 to up, 2/3 to paused, and missing observations to paused; the latter is not evidence of a healthy monitor. Its 24-hour uptime is the upstream ratio multiplied by 100, and the average excludes missing uptime values.
- Source and existing Go tests are the current evidence only. Native API, rendered widget, scoped fixture monitor, resolved image digest and installation/restart/removal/reinstallation lifecycle proof remain for the parent-approved contained phase. No Docker, browser, notification or monitoring runtime was used.

## Sources

- [Homarr v2.4.1 adapter](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/uptime-kuma/uptime-kuma-integration.ts)
- [Homarr credentials](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/definitions/src/integration.ts)
- [Homarr widget options](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/widgets/src/uptime-kuma/index.ts)
- [Homarr native Stats fields](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/stats/existing.ts)
- [Kuma 2.5.5 authentication](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/auth.js)
- [Kuma status-page reads](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/routers/status-page-router.js)
- [Kuma administrator setup](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/server.js)
- [Kuma page management](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/socket-handlers/status-page-socket-handler.js)
- [Kuma key management](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/socket-handlers/api-key-socket-handler.js)
