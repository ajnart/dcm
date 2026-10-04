# Remaining monitoring / remote topology — 2026-10-03

Dashdot and Cloudflare Tunnel remain guided. No safe role-complete recipe or
adapter fits the current shared owner. No placeholder account, health-only
promotion, schema relaxation, Docker execution or new negative fixture was added.
Context7 documentation was resolved and fetched before pinned primary-source
review. Reuses [monitoring review](../compose-catalog-monitoring-20261003.md)
and [remote review](../compose-catalog-remote-20261003.md).

## Dashdot: exact host-observation authority

The [pinned Compose](https://github.com/MauriceNino/dashdot/blob/v6.3.4/apps/docs/content/docs/installation/docker-compose.mdx)
requires privileged mode and host `/` read-only at `/mnt/host`, with port 3001.
Removing those permissions substitutes container visibility for host monitoring.
The current recipe service rejects privilege fields; selected-host-path validation
rejects `/`. A normal apply approval cannot grant this capability.

Minimum useful topology: a separately reviewed `host-observation` profile binding
the exact shared project, digest-pinned service, privileged grant, and read-only
`/` → `/mnt/host` mount. Keep the unauthenticated API private, expose no Docker
socket, retain the explicit profile on replay, and reject any wider privilege or
mount change. This is a shared authority contract, not an app-local schema escape.
An independent host observation must establish host identity and matching live
CPU/RAM/storage values. The [API](https://github.com/MauriceNino/dashdot/blob/v6.3.4/apps/docs/content/docs/integration/api.mdx)
provides `/info` and `/load/*`; no generated login/key is appropriate. Native
Homarr mapping exists, but live widget freshness and exact-project restart remain
separate acceptance checks. No new recipe can honestly claim this today.

## Cloudflared: offline checks are not enrollment

Pinned [ingress commands](https://github.com/cloudflare/cloudflared/blob/2026.9.1/cmd/cloudflared/tunnel/ingress_subcommands.go)
provide genuine no-enrollment diagnostics:

```text
cloudflared tunnel --config /exact/reviewed/config.yml ingress validate
cloudflared tunnel --config /exact/reviewed/config.yml ingress rule https://reviewed.example.test/
```

These parse local config and match a URL; they do not start a connector, change
DNS, prove upstream reachability, authenticate clients, or inspect remote config.
A catch-all `http_status:404` can validate fail-closed local rule shape without a
public origin, but publishing this as a remote-access install would be misleading.

Current [connectivity docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/connectivity-prechecks/)
advertise automatic checks in `tunnel run` and `tunnel diag`. Exact
[diagnostic source](https://github.com/cloudflare/cloudflared/blob/2026.9.1/diagnostic/diagnostic.go)
first resolves a running metrics instance before running prechecks. Its jobs
always collect CLI and tunnel configuration, even when optional collection is
disabled. The [command](https://github.com/cloudflare/cloudflared/blob/2026.9.1/cmd/cloudflared/tunnel/subcommands.go)
returns success when no instance exists and also after diagnostic errors.
Therefore neither exit 0 nor a generated diagnostic archive is a standalone
connectivity proof or safe ordinary report. No diagnostic was executed here.

Minimum useful connector seam:

- Long-running **portless connector**, distinct from current inert manual jobs;
  optional private metrics origin must not fabricate an application frontend.
- Exact externally issued token reference, account/tunnel IDs and pre-start
  remotely managed configuration revision. A scoped cloud-account read transport
  must inspect routes before start and fail closed if their approved scope changes.
- Explicit connector/remote enrollment approval and separately owned private
  network/target/client access policy. Public hostnames additionally require
  independent DNS, TLS and authentication/public-exposure grants; token import
  or generic catalog apply never supplies these.
- Non-root secret readability proven against the pinned image, whose
  [Dockerfile](https://github.com/cloudflare/cloudflared/blob/2026.9.1/Dockerfile)
  declares UID/GID 65532. Private file preparation currently creates current-user
  mode-0600 files and verifies ownership/content on resume. File-environment
  rendering passes only `/run/secrets/<id>`; it neither transfers ownership nor
  proves runtime readability. Broad chmod or an unexplained root override is not
  a fix. Any deliberate `host-selected` runtime user needs pinned support and
  exact-image evidence; any alternate secret projection needs an explicit
  container-reader contract retaining private host ownership and replay checks.

Verification must cover the selected private connector identity, approved/denied
clients, exact intended upstream delivery, direct-origin privacy and scoped
restart. Cloudflared has no local administrator or native Homarr integration;
a tile/metrics endpoint cannot substitute for routing acceptance.

## Validation and boundary

Only the two edited public manifests were JSON-parsed and whitespace-checked.
No live token/config, private runtime, DNS, image pull, connector, privileged
service, tests or CI were used. The two applications do not advance the count of
role-complete deterministic shared installations. Missing authority contracts
above are implementation prerequisites, not unavailable upstream HTTP syntax.
