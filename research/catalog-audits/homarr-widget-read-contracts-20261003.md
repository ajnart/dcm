# Homarr native widget read contracts

Source inspected: Homarr production commit `c8c0a72bb016a2c46aa447d74eeba3e05fa7b070`.
These are Homarr tRPC query contracts, not upstream routes or browser-render acceptance.

All procedure names begin with `widget.`. One middleware takes `integrationId`;
many takes `integrationIds`. Many-result envelopes must match the requested ID
through `integrationId` or `integration.id` and reject an `error` entry.
See [integration middleware](https://github.com/homarr-labs/homarr/blob/c8c0a72bb016a2c46aa447d74eeba3e05fa7b070/packages/api/src/middlewares/integration.ts).

| Catalog widget | Exact query | Input | Validity payload |
| --- | --- | --- | --- |
| Immich server statistics | `immich.getServerStats` | one | Direct numeric photoCount, videoCount, userCount, totalLibraryUsageInBytes |
| Immich album carousel | `immich.getAlbum` | one, albumId from approved prerequisite | Direct id, albumName, assets with typed id/type/timestamps/publicLink |
| Paperless-ngx | `paperlessNgx.getStats` | one | Direct numeric documentsTotal, documentsInbox, correspondentsCount, tagsCount, documentTypesCount |
| Home Assistant entity state | `smartHome.entityState` | one, entityId from prerequisite | Direct string |
| Calendar (Nextcloud/Home Assistant) | `calendar.findAllEvents` | many, current UTC year/month (1–12), releaseType, showUnmonitored | Envelope events array: title, startDate, indicatorColor, links |
| DNS summary/controls | `dnsHole.summary` | many | Envelope summary numeric domainsBeingBlocked, adsBlockedToday, adsBlockedTodayPercentage, dnsQueriesToday; control actions remain unverified |
| Gotify/ntfy/Nextcloud notifications | `notifications.getNotifications` | many | Envelope data array: id, time, title, body |
| Glances/Dashdot health/resources/disks | `healthMonitoring.getSystemHealthStatus` | many | Envelope healthInfo: numeric CPU/memory/uptime, fileSystem/smart/gpu arrays |
| Beszel grid/table | `beszel.getSystems` | many | Envelope systems normalized rows, not raw BeszelSystem: id/name/status/cpu/memory/disk/uptime |
| Beszel alerts | `beszel.getAlerts` | many, includeHistory/maxHistoryItems optional | Envelope alerts: id/user/system/name/triggered/value/min |
| Beszel system stats | `beszel.getSystemStats` | many with exactly one ID, systemId prerequisite, timePeriod/includeDocker | **Direct object** with integrationId and systemStats array; reject error fallback |
| Uptime Kuma | `uptimeKuma.getDashboard` | many | Envelope dashboard count fields and monitors: id/name/status/nullable uptimePercent24h |
| Archive Team Warrior | `archiveTeamWarrior.getStatus` | one | Direct wrapper status: status string, items array, numeric counts |
| Coolify | `coolify.getInstancesInfo` | many | Envelope instanceInfo version string, applications/services/servers arrays |
| PatchMon | `patchmon.getStats` | one | Direct numeric host/package/repo statistics, lastUpdated string, osDistribution array |
| PeaNUT | `ups.getSummaries` | many | Envelope summaries: id/name/status, nullable numeric voltage/runtime/charge fields |
| Speedtest Tracker | `speedtestTracker.getDashboard` | many | Envelope dashboard nullable latestResult/stats, recentResults array |
| WUD | `wud.getStats` | one | Direct wrapper stats numeric totalContainers/updatesAvailable and updates array |
| Umami | `umami.getVisitorStats` | many, websiteId prerequisite, timeFrame | Envelope visitorStats domain/websiteId/websiteName, numeric totals and dataPoints |
| Traefik | `traefik.getDashboard` | many | Envelope dashboard entryPoints/resources/failedEndpoints arrays and http/tcp/udp protocol counts; blocked native eligibility remains |

Router ownership and exact output types: [widget router directory](https://github.com/homarr-labs/homarr/tree/c8c0a72bb016a2c46aa447d74eeba3e05fa7b070/packages/api/src/router/widgets),
[integration types](https://github.com/homarr-labs/homarr/tree/c8c0a72bb016a2c46aa447d74eeba3e05fa7b070/packages/integrations/src),
[Beszel normalization](https://github.com/homarr-labs/homarr/blob/c8c0a72bb016a2c46aa447d74eeba3e05fa7b070/packages/request-handler/src/beszel.ts).

No widget contract is invented for tile-only Portainer/Grafana/Nginx Proxy
Manager or integration-only Prometheus/Netdata/Gatus/Linkwarden. Caddy and
Frigate retain their blocked eligibility and empty widget lists. Home Assistant
automation has no query: its widget only calls a mutation, so read verification
must report a gap rather than execute it. See [automation component](https://github.com/homarr-labs/homarr/blob/c8c0a72bb016a2c46aa447d74eeba3e05fa7b070/packages/widgets/src/smart-home/execute-automation/component.tsx).

Empty arrays can be valid provider responses, not proof of rendered non-empty
content. Local structural contract checks and live provider/browser acceptance
remain separate evidence.
