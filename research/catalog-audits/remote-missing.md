# Remote-access and VPN catalog audit

Checked 2026-10-03. Scope: Cloudflare Tunnel, NetBird, Tailscale, ZeroTier,
and Gluetun. Source review only: no Docker apply, enrollment, public route,
privilege expansion, or tunnel-break test was performed. All five remain
without a shared recipe or setup adapter; the blockers below are not solved
by publishing a health endpoint or inventing an administrator.

## Current upstream contracts

| App | Headless route | Remaining shared-engine boundary |
| --- | --- | --- |
| Cloudflare Tunnel | Import an issued token through `TUNNEL_TOKEN_FILE`; no local account bootstrap. | Starting a remotely managed connector can activate existing routes. Inspect the exact remote configuration and bind separate exposure/authentication approval before start; local readiness is insufficient. |
| NetBird | Embedded-IdP first-owner API can issue a one-time PAT; use the PAT for owner readback. | Owner-selected domain, generated server/identity configuration, approved DNS/TLS edge, and peer connectivity; do not substitute a loopback dashboard for the control plane. |
| Tailscale | Userspace containerboot can ingest an issued auth-key file and persist node state without TUN/capabilities. | Review one exact private Serve target, deny Funnel, bind only the owned app network, and verify intended tailnet ownership and authorized/denied clients. A health/proxy-only recipe does not fulfill private ingress. |
| ZeroTier | CLI join plus controller authorization and observed network state. | Official Docker networking requires TUN and elevated capabilities; controller/network ownership and exact route review require a separate privileged capability. |
| Gluetun | Owner-issued provider configuration plus generated private control-auth TOML. | TUN, NET_ADMIN, downloader network namespace, and timestamped fail-closed evidence belong to a separately reviewed VPN apply/verify capability. |

### Cloudflare Tunnel

The [run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/)
document token-file support from 2025.4.0. The reviewed catalog pin is
`cloudflare/cloudflared:2026.9.1`; this audit did not pull or resolve its digest.
The [remote-tunnel workflow](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
separates connector start from configuring published/private routes. Therefore,
an already configured token must not be treated as private-route authority.
The future adapter must report connector readiness separately from route,
DNS/TLS, policy enforcement, and direct-backend privacy acceptance.

### NetBird

The current [quickstart](https://docs.netbird.io/selfhosted/selfhosted-quickstart)
uses a combined server and dashboard with embedded identity; its documented
deployment requires a public domain and TCP 80/443 plus UDP 3478. No domain,
edge owner, or corresponding approval is selected in a generic app recipe.

The [automated setup contract](https://docs.netbird.io/selfhosted/automated-setup)
documents `NB_SETUP_PAT_ENABLED=true`, an approved `POST /api/setup` containing
the saved owner identity and `create_pat: true`, and token-authenticated
`GET /api/users`. It is available only before the first account exists. Its
returned PAT is shown once and must be privately persisted before reporting
success. A lost response requires inspection and reconciliation, not replay;
setup/PAT success remains separate from peer enrollment and route acceptance.
These facts do not identify a pinned container version or establish compatibility
with an installed instance, so no adapter is advertised.

### Tailscale

The [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
document default userspace networking, persistent `TS_STATE_DIR`, and
`TS_AUTH_ONCE=true`. The [pinned v1.102.4 containerboot source](https://github.com/tailscale/tailscale/blob/v1.102.4/cmd/containerboot/main.go)
confirms `TS_AUTHKEY=file:/path`. The existing owner-file/file-URI primitive
can carry this without placing its bytes in Compose or argv.

The same documentation defines `/healthz` as proof of a tailnet IP only. This
does not prove tailnet identity, service delivery, or ACL enforcement. It also
requires a directory bind for watched `TS_SERVE_CONFIG` updates. Serve
configuration can enable public Funnel: a future bounded configuration must
reject that branch and bind one exact owned upstream rather than accept an
arbitrary owner file. The engine's individual generated-file mount and required
primary host port do not yet model this connector correctly.

### ZeroTier

The official [Docker guide](https://docs.zerotier.com/docker/)
requires `/dev/net/tun`, NET_ADMIN, and SYS_ADMIN for its tap-mode example.
It demonstrates that CLI join can precede usable network configuration; a
future adapter must observe authorized network state and test the selected
peer path. Persist node identity privately. No image/version was promoted:
the current catalog image remains unknown, and unreviewed privilege fields
must not be added to ordinary recipes to hide that gap.

### Gluetun

The [upstream README](https://raw.githubusercontent.com/qdm12/gluetun/master/README.md)
confirms the repository migration to `passteque/gluetun` without changing image
names and still declares TUN plus NET_ADMIN in its Compose example. Provider
selection is separate from generated control credentials. The
[namespace contract](https://github.com/qdm12/gluetun-wiki/blob/main/setup/connect-a-container-to-gluetun.md)
uses `network_mode: service:gluetun` for a downloader in the same Compose file.

The reviewed [v3.40.0 auth settings](https://raw.githubusercontent.com/qdm12/gluetun/v3.40.0/internal/server/middlewares/auth/settings.go)
have permissive default public roles. The
[config parser](https://raw.githubusercontent.com/qdm12/gluetun/v3.40.0/internal/server/middlewares/auth/configfile.go)
reads strict TOML roles. Existing `privateConfigs` can represent a generated
secret with an explicit read-only role; a literal public config cannot safely
carry it. This removes the old secret-file representation gap, not the device,
capability, or downloader-namespace gap. Control login is not VPN acceptance.

## Required acceptance before offering shared setup

- Keep issued credentials in exact owner-only files; reject changed ownership,
  byte content, and recipe identity on resume. Never manufacture an enrollment
  key, controller authorization, provider account, or public hostname.
- For identity/control-plane writes, checkpoint before submission and reconcile
  after lost responses. Preserve identity across a scoped restart.
- For ingress, verify selected-client delivery and an unauthorized-client denial;
  verify public routes are absent unless separately approved.
- For Gluetun, prove namespace ownership, gateway-only WebUI publication,
  firewall/route restrictions, tunnel egress and DNS, a deliberate tunnel break
  while the downloader remains running, failed external/DNS requests, and
  restoration. Neither health nor a successful control request satisfies this.

Validation: parse only the five changed manifests and check `git diff --check`.
No new runtime scripts or tests were added; no Docker, browser, network apply,
or CI validation was run.
