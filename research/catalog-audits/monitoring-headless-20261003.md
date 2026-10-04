# Monitoring/network headless audit — 2026-10-03

Source review, not image acceptance. Tags below are catalog pins, not freshly
resolved digests. No trial containers, private files, DNS, notifications,
monitoring targets, socket mounts or deployments were touched. Every app's
fresh setup, real authenticated replay, restart and Homarr widget acceptance
is **not run in this audit**. Historical seven-app receipts remain historical;
current liveness cannot refresh them. Prior details are in
[monitoring-existing.md](monitoring-existing.md).

## Findings and changes

- VictoriaMetrics's pinned [handler](https://raw.githubusercontent.com/VictoriaMetrics/VictoriaMetrics/v1.153.0/app/vmselect/main.go)
  deliberately returns Prometheus compatibility version `2.24.0` from
  `/api/v1/status/buildinfo`. Requiring `1.153.0` rejected valid installations.
  Setup now checks `/health` plus `/vmui/config.json`, whose `version` is
  populated from `buildinfo.ShortVersion()` (`v1.153.0`). This endpoint is a
  pinned implementation contract, not a promised stable public API.
- Shared setup is permitted unless an adapter explicitly declares
  `sharedOwner: false`. Prometheus, Grafana and VictoriaMetrics keep their
  existing exact-owner, read-only behavior; no redundant support declaration,
  bootstrap mutation or shared transport was added.
- Homarr's isolated API-key verification, private session-cookie persistence,
  saved-key reuse and one-time create checkpoints remain unchanged. No cookie
  or dashboard session can substitute for successful saved-key authentication.

## Per-app ledger

| App / pin | Source-backed setup and credential behavior | Remaining boundary |
| --- | --- | --- |
| Homarr `homarr-test:v2` | [Official source](https://github.com/homarr-labs/homarr): reviewed local adapter claims/creates admin once, persists private cookies, completes private personal board, saves one API key, verifies saved key without cookies. | Mutable image tag is not proof of source revision. No new fixture/change. Saved-cookie refresh, private-board/key replay and data widgets need real image evidence. |
| Beszel `0.20.0` | [Pinned Hub](https://raw.githubusercontent.com/henrygd/beszel/v0.20.0/internal/hub/hub.go), [Hub docs](https://www.beszel.dev/guide/hub-installation): fixed `admin@example.test`, verify Hub admin and PocketBase superuser separately; no durable exported API key. | Current docs may differ from pin; first-signup route still needs pinned/live confirmation. Agent enrollment and metrics are separate. |
| Uptime Kuma `2.5.5` | [Pinned Socket.IO server](https://raw.githubusercontent.com/louislam/uptime-kuma/2.5.5/server/server.js): polling handshake, checkpoint signup, saved login, optional empty default status page. No durable API key. | Setup writes remain approval-bound; no monitor is added. Socket namespace/pong, login/page replay and dashboard need live evidence. |
| ntfy `2.28.0` | [Auth docs](https://docs.ntfy.sh/config/): deny-all plus seeded bcrypt admin; verify saved account and one non-expiring labeled Homarr admin token; ambiguous token creation stops. | Token is administrator authority, not publish-only. Publisher ACL, delivery and native widget behavior remain separate/unverified. |
| AdGuard Home `0.107.79` | [Pinned OpenAPI](https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/v0.107.79/openapi/openapi.yaml): inspect first-install addresses, checkpoint configure, verify admin Basic `/control/status` and exact version/ports. No durable key. | DNS unpublished; anonymous denial, filtering and widget data unverified. |
| Pi-hole `2026.09.0` | [Docker config](https://docs.pi-hole.net/docker/configuration/): `WEBPASSWORD_FILE`, `TZ`; password-only `/api/auth`, session `X-FTL-SID` version readback. Prior generated-secret fix accepts 65 chars. | Session is not durable key; version-object readback does not assert image version. DNS/DHCP cutover not authorized. |
| Technitium DNS `15.5.1` | Exact catalog ID `technitium-dns`. [Pinned API](https://raw.githubusercontent.com/TechnitiumSoftware/DnsServer/v15.5.1/APIDOCS.md): form login, Bearer session/profile; prior 65-char generated-secret fix. | Password-file evidence uses [current Compose](https://raw.githubusercontent.com/TechnitiumSoftware/DnsServer/master/docker-compose.yml), weaker than pin. No durable key/DNS cutover. |
| Prometheus `3.15.0` | [Pinned API](https://raw.githubusercontent.com/prometheus/prometheus/v3.15.0/web/api/v1/api.go): read-only `/-/ready`, buildinfo exact version; no account/key. | Self-scrape only; successful readiness/version does not establish external metrics or Homarr (no mapped native integration). |
| Grafana `13.2.2` | [Pinned Docker startup](https://raw.githubusercontent.com/grafana/grafana/v13.2.2/packaging/docker/run.sh), [login handler](https://raw.githubusercontent.com/grafana/grafana/v13.2.2/pkg/api/login.go): generated admin password, Basic `/api/user`, require active server admin. | No service-account token, datasource or dashboard provisioning. Actual seed/password persistence and browser login require image acceptance. |
| Netdata `2.11.0` | [Docker docs](https://learn.netdata.cloud/docs/netdata-agent/installation/docker): unprivileged container-local Agent, `/api/v1/info` version; prior shared read-only fixture. No account/key. | No host/PID/socket observation or Cloud claim. Changing charts and Homarr remain unverified. |
| Glances `4.5.6` | [API docs](https://glances.readthedocs.io/en/latest/api.html): container-local web API `/api/4/status`; prior shared read-only fixture; no seeded account/key. | Status alone does not prove host metrics or authentication. No host/PID/socket mounts; chart/widget acceptance separate. |
| Gatus `5.37.0` | [Pinned README](https://github.com/TwiN/gatus/blob/v5.37.0/README.md): `/health`, generated self-check and SQLite history; no account/key. | Process health is not target/alert acceptance. Runtime-user readability, retained SQLite history and Homarr need exact image evidence. |
| VictoriaMetrics `1.153.0` | [Pinned handler](https://raw.githubusercontent.com/VictoriaMetrics/VictoriaMetrics/v1.153.0/app/vmselect/main.go), [health handler](https://raw.githubusercontent.com/VictoriaMetrics/VictoriaMetrics/v1.153.0/lib/httpserver/httpserver.go): corrected version endpoint above, no account/key. | No external ingestion or query correctness claim. Future VMUI contract changes must fail closed. |
| Loki `3.7.0` | [Pinned Dockerfile](https://raw.githubusercontent.com/grafana/loki/v3.7.0/cmd/loki/Dockerfile) and [Docker config](https://raw.githubusercontent.com/grafana/loki/v3.7.0/cmd/loki/loki-docker-config.yaml): UID 10001, `/loki` storage, Docker config (not host `/tmp` config), auth disabled; `/ready`. | Existing mount is correct; no speculative path fix. Readiness does not prove log ingestion/query/retention. No credentials/native integration. |
| Vector `0.58.0-debian` | [Pinned API server](https://raw.githubusercontent.com/vectordotdev/vector/v0.58.0/src/api/grpc_server.rs): compatibility `GET /health` explicitly returns JSON `ok:true` even though API now uses gRPC; generated API bind and internal-log console pipeline. | Existing probe is valid; no speculative gRPC rewrite. Unauthenticated API stays private. External pipeline/delivery not configured or proven. |
| PeaNUT `6.0.0` | [Pinned env example](https://raw.githubusercontent.com/Brandawg93/PeaNUT/v6.0.0/.env.example), [Dockerfile](https://raw.githubusercontent.com/Brandawg93/PeaNUT/v6.0.0/Dockerfile): seeded Basic credentials, anonymous/wrong-password denial, saved `/api/v1/info`. No key. | Reported auth-file persistence concern remains unproven, not silently repaired. No NUT device/UPS command authority. |
| PatchMon `2.1.3` | [Pinned source](https://github.com/PatchMon/PatchMon/tree/v2.1.3): saved active superadmin JWT/session readback, explicit stats/enrollment authority, checkpoint one scoped auto-enrollment token, private API-key/API-secret pair, Basic stats verification. | Login JWT is not an integration key. Broad enrollment credential authority is explicitly chosen; stats GET's last-used update stays approved. Real token replay/restart/Homarr data unverified. |

## Focused validation

`packages/cli/tests/victoria-metrics-setup.test.ts` passes synthetic ready/replay and exact-owner
denial for all three reviewed adapters, Grafana Basic credential submission,
Prometheus's distinct buildinfo contract and VictoriaMetrics wrong-version
rejection. Changed adapters and fixture build with Bun 1.4.0. No broad suite,
Docker compilation, browser, installation or live API request ran.

Fresh verification must use new approved roots/volumes and disclosed loopback
ports, resolve tag-to-digest and runtime UID/GID/config readability, then test
first setup, anonymous/wrong credential denial where applicable, saved-credential
replay without duplicate resources, exact-project restart and authenticated
readback. No DNS changes, external monitors, notifications, host/socket access,
UPS commands, log pipelines or agents are implied. Homarr integration/widget
acceptance is a separate dashboard-owned step, not app-tile success.
