# Existing monitoring, DNS and notification adapters — 2026-10-03

Source/fixture audit of fifteen existing entries. No container, private file,
DNS setting, notification, monitoring target or Docker socket was touched.
Pinned tags are not resolved digests. Current documentation is not necessarily
the pinned image contract. No support level was promoted.

## Evidence ledger

`Fresh`, `replay` and `restart` below mean a real isolated image run in this
audit, not source code, HTTP 200, a synthetic transport or a previous trial.
All fifteen are **not run** here. The historical seven-app trial included
AdGuard Home, Beszel, ntfy and Uptime Kuma plus Homarr, Paperless and Immich.
The parent reports historical setup/replay and scoped restart evidence, but
this audit neither reads its private artifacts nor refreshes authentication;
those results must retain their original run provenance, not become current
receipts. The parent's current liveness inspection is narrower than acceptance.
The shared setup gate additionally requires `sharedOwner: true`. Recipe
availability alone does not satisfy it.

| App / pin | Source-backed bootstrap and credential/API handling | Fixture and actual remaining acceptance |
| --- | --- | --- |
| AdGuard Home `v0.107.79` | [Pinned OpenAPI](https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/v0.107.79/openapi/openapi.yaml): inspect first-install addresses, checkpoint configure, create `admin`, then Basic-authenticated `/control/status`; no durable API key. Port 3000 remains the selected web port; DNS is container-internal only. | Source review only. Replay checks saved admin before considering first-install writes. No shared-owner declaration. Fresh/replay/restart, anonymous rejection, actual DNS filtering and Homarr are not proven. |
| Beszel `0.20.0` | [Hub install](https://www.beszel.dev/guide/hub-installation): port 8090, `/beszel_data`, `APP_URL`; agent is a separate service/authority. Adapter checkpoints first signup, then authenticates the fixed `admin@example.test` in `users` and `_superusers`, requiring Hub admin role. No durable REST key or enrollment token is exported. | Source review only. Current docs are 0.21.0, so the 0.20.0 first-run route still needs pinned-source/live confirmation. Replay verifies both saved accounts and signup closure; fresh/replay/restart, agent metrics and Homarr unproven here. |
| Gotify `3.1.1` | [Config](https://gotify.net/docs/config) seeds `admin` from `GOTIFY_DEFAULTUSER_PASS_FILE`; [pinned spec](https://raw.githubusercontent.com/gotify/server/v3.1.1/docs/spec.json) supplies version, current user and application API. Adapter checkpoints one `Auto-Stack` application and saves the one-time token privately. | Existing `check-gotify-setup.ts` passed: declined token-create approval propagates without being swallowed. That fixture does **not** prove full creation/replay. No shared-owner declaration. Saved-token/inventory readback does not exercise token-authenticated delivery. Fresh/replay/restart, client delivery and Homarr unproven. |
| ntfy `v2.28.0` | [Auth config](https://docs.ntfy.sh/config/) documents deny-all and environment-seeded bcrypt auth users. Adapter denies anonymous subscription, verifies admin, checkpoints one non-expiring `Homarr` token, saves it, checks inventory equality and Bearer subscription. Token inherits administrator authority, not topic-scoped permission. | Source review only. Manifest corrected: token provisioning exists; publisher/ACL/delivery provisioning does not. Replay never creates a replacement for an uncertain/missing token. Fresh/replay/restart and actual message delivery/Homarr unproven here. |
| Uptime Kuma `2.5.5` | [Pinned server](https://raw.githubusercontent.com/louislam/uptime-kuma/2.5.5/server/server.js) owns Socket.IO setup/login; recipe selects SQLite. Polling namespace/pong control is distinguished from approved application events, and first-admin write is checkpointed. An empty `default` status page is created when Homarr is present. No API key is created. | Source review only. Replay verifies saved admin after attempted setup and refuses unowned existing admin. Fresh/replay/restart, monitor checks and Homarr unproven here. Empty status page is not uptime monitoring; no real monitor is authorized by this audit. |
| Glances `4.5.6` | [Pinned API source](https://raw.githubusercontent.com/nicolargo/glances/v4.5.6/glances/outputs/glances_restful_api.py) defines an unauthenticated status router; recipe enables web mode `-w`. No account/key, host PID, host networking or socket. | Shared-owner probe enabled; focused synthetic fixture passed exact-owner denial and read-only replay. GET `/api/4/status` checks only status 200. Fresh/replay/restart and changing container-local metrics/Homarr unproven. Never claim host/sibling visibility. |
| Gatus `v5.37.0` | [Pinned README](https://raw.githubusercontent.com/TwiN/gatus/v5.37.0/README.md) backs generated self-check config and SQLite history; [Dockerfile](https://raw.githubusercontent.com/TwiN/gatus/v5.37.0/Dockerfile) backs runtime shape. No account/key. Starter monitors only its own `/health`. | Source review only. Adapter reports zero verified monitored services after readiness. Fresh/replay/restart, retained self-check history and Homarr unproven. Other targets and alerts need separate review. |
| PeaNUT `v6.0.0` | [Pinned README](https://raw.githubusercontent.com/Brandawg93/PeaNUT/v6.0.0/README.md) backs `WEB_USERNAME`/`WEB_PASSWORD`; [Dockerfile](https://raw.githubusercontent.com/Brandawg93/PeaNUT/v6.0.0/Dockerfile) provides `/config` ownership and runtime default. Adapter checks anonymous/wrong-password denial and saved Basic login on `/api/v1/info`. No API key. | Source review only. 65-character password matches the shared 48-byte base-62 generator. Reported auth-file path/persistence problem stays explicit, not silently patched without pinned implementation evidence. Fresh/replay/restart, NUT device readings and Homarr unproven. No UPS command authority. |
| Pi-hole `2026.09.0` | [Docker config](https://docs.pi-hole.net/docker/configuration/) documents `WEBPASSWORD_FILE` and `TZ`. Adapter authenticates password-only `/api/auth` and sends `X-FTL-SID` on version readback. A short-lived session is not a durable API key; DNS 53 is unpublished. | Fixed real bug: adapter rejected generated 65-character secrets by requiring 48. New `check-dns-admin-setup.ts` passed generated credential, two-call login/readback, authenticated replay and invalid-length rejection. Synthetic only: fresh/replay/restart, anonymous rejection, LAN filtering and Homarr still unproven. |
| Speedtest Tracker `v1.14.7-ls165` | [LinuxServer image docs](https://docs.linuxserver.io/images/docker-speedtest-tracker/) back PUID/PGID and `FILE__` loading. Recipe seeds `admin@example.test`, private APP_KEY and password. Adapter verifies Laravel password/role through private stdin, checkpoints one `results:read` Sanctum token, saves it, checks owner and `/api/v1/stats`. | Source review only. Replay uses saved token plus ownership verification; lost plaintext stops rather than creating another token. Fresh/replay/restart, browser login, measurements and Homarr unproven. No measurement is requested in the isolated smoke batch. |
| Technitium DNS `15.5.1` | [Pinned API docs](https://raw.githubusercontent.com/TechnitiumSoftware/DnsServer/v15.5.1/APIDOCS.md) support POST form login, Bearer session header and authenticated profile. [Current Compose](https://raw.githubusercontent.com/TechnitiumSoftware/DnsServer/master/docker-compose.yml) documents admin password file. No durable API key; DNS 53 unpublished. | Fixed same 48-vs-65-character rejection; new DNS fixture passed form login, exact profile header and synthetic replay. Version-specific Compose URL was unavailable: current master is weaker than pinned bootstrap evidence. Fresh/replay/restart, role/anonymous denial, DNS and Homarr unproven. |
| Traefik `v3.6.22` | [v3.6 healthcheck docs](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/observability/healthcheck/) back an explicit private `health` entrypoint and `/ping`. No account/key, Docker provider/socket, dashboard, ingress route or TLS owner. | Source review only. 200 establishes process readiness only. Fresh/replay/restart and Homarr unproven; actual DNS/TLS/80/443/auth route remains separate approval. |
| Umami `3.4.0` | [Pinned user route](https://raw.githubusercontent.com/umami-software/umami/v3.4.0/src/app/api/users/%5BuserId%5D/route.ts) confirms POST password update. Recipe includes PostgreSQL, unique app/two-factor keys; adapter proves seed, checkpoints rotation, verifies saved identity and rejects seed. Login token is not exported as durable API key. | Source review only. Replay requires matching recorded user ID and rotated credential. Fresh/replay/restart, account-only authenticated endpoint, real tracking event and Homarr unproven. No analytics site/event is authorized here. |
| Netdata `v2.11.0` | [Official Docker docs](https://learn.netdata.cloud/docs/netdata-agent/installation/docker) distinguish complete host observation from this unprivileged container-only recipe. Adapter reads `/api/v1/info` and checks pinned version. No account/key or Cloud claim. | Shared-owner probe enabled; focused synthetic fixture passed exact-owner denial and read-only replay. Fresh/replay/restart, updating local charts and Homarr unproven. Do not infer host/PID/network/socket access from image readiness. |
| aria2 `1.37.0-debian` | [Official 1.37 manual](https://aria2.github.io/manual/en/html/aria2c.html) documents secret-prefixed JSON-RPC and config file. Third-party image startup is bypassed; secret-derived private config keeps token out of argv. Adapter rejects unauthenticated `getVersion`, verifies token/version and selected download dir. No username/password account. | Source review only. Recipe supplies a chosen shared media bind; publishing RPC does not approve downloads. No shared-owner declaration. Fresh/replay/restart, transfer/session persistence, VPN fail-closed and Homarr unproven. |

## Runtime identity and timezone

All recipes preserve the evidenced image runtime user; none silently applies a
numeric Compose user. Only Speedtest Tracker binds inspected PUID/PGID. Gotify
and Pi-hole bind inspected TZ; other entries retain image defaults rather than
assuming TZ support. Named-volume ownership and readability of mode-0600
private/generated config mounts must be proven on the exact resolved image.
Gatus and aria2 require especially explicit config-readability acceptance.

## Next isolated batch — proposal only

Use new, disclosed mode-0700 roots under `/tmp`, one exact owned Compose project
per batch, fresh volumes, pinned tag-to-digest resolution, inspected non-root
UID/GID and `Europe/Berlin` only where documented. First inspect collisions and
show the exact rendered plan; apply/setup/restart each require their normal
approval. Do not reuse existing seven-app trial volumes or secret files.

| Candidate | Exact proposed private binding | Required checks before completion |
| --- | --- | --- |
| Pi-hole | `127.0.0.1:19101 -> 80/tcp` | Saved-password login, wrong/anonymous denial, authenticated account-only data; replay with unchanged credential; scoped restart and repeat. No DNS/DHCP ports or resolver cutover. |
| Technitium | `127.0.0.1:19102 -> 5380/tcp` | Confirm pinned file bootstrap, admin profile/role, denial, saved-password replay and scoped restart. No DNS port/cutover or durable-token creation. |
| Speedtest Tracker | `127.0.0.1:19103 -> 80/tcp` | Seeded identity/password, one approved read-scoped token, readback/ownership, replay without duplicate and scoped restart. No scheduled/manual speedtest. |
| PeaNUT | `127.0.0.1:19104 -> 8080/tcp` | Anonymous/wrong-password denial and saved login before/after replay and restart; record actual auth-file persistence separately. No NUT/UPS connection or commands. |
| Gatus | `127.0.0.1:19105 -> 8080/tcp` | Config readable at image runtime user, health and generated self-check history, read-only replay, retained SQLite self-history after restart. No added monitors/alerts. |
| Traefik | `127.0.0.1:19106 -> 8080/tcp` | Ping before/after read-only replay and restart. No provider/socket/routes or public listeners. |
| Umami + private PostgreSQL | `127.0.0.1:19107 -> 3000/tcp`; DB unpublished | Seed rotation once, saved identity login, seed rejection, authenticated user readback, replay and scoped project restart. No website/events. |
| Glances | `127.0.0.1:19108 -> 61208/tcp` | Verify status/version and container-local metric changes, replay and restart. No PID/socket mounts. |
| Netdata | `127.0.0.1:19109 -> 19999/tcp` | Verify info/version and local chart updates, replay and restart. No host observation or Cloud claim. |
| aria2 (gate blocked) | `127.0.0.1:19110 -> 6800/tcp` | Shared-owner capability decision plus exact disposable download bind first; config readability, anonymous denial, token/version/options, replay/restart. No transfer/peer ports/VPN claim. |

AdGuard Home, Beszel, Gotify, ntfy and Uptime Kuma are still part of the all-app
verification ledger. The separately reported prior trial did not cover Gotify.
If they need fresh reruns, reserve `127.0.0.1:19111 -> 3000`, `19112 -> 8090`,
`19113 -> 80`, `19114 -> 80`, `19115 -> 3001` respectively, all TCP. AdGuard
Home/Gotify need explicit shared-owner decisions first. Reruns use new storage
and the same checkpoint/login/key/replay/restart boundaries above. No
notifications, agents or monitors are added. Gotify notification token use,
UPS readings, external DNS, actual tracking/measurements and transfer acceptance
remain separately approved functional checks, not synthetic success.

Homarr is not included in these proposed app-only projects. Exact bridge
reachability, native integration credential forms, source-pinned mappings,
widget data and board persistence require their own evidence and approved
dashboard-owned phase. No `homarr.json` or registry file was edited here.

## Validation performed

- `check-dns-admin-setup.ts`: passed; synthetic generated-secret acceptance and
  authenticated replay for the two changed adapters, no external requests.
- Existing `check-gotify-setup.ts`: passed; approval deferral only.
- `check-container-monitor-setup.ts`: passed; synthetic read-only replay and
  exact-owner denial for Glances and Netdata shared probes.
- Focused Bun 1.4.0 builds of the four changed adapters and new fixtures: passed.
- No Docker, browser, full suite, installation, fresh image, functional
  delivery/monitoring, or scoped restart was executed.
