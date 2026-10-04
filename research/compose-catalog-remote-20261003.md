# Remote-access Compose re-review

Checked 2026-10-03 against the current shared engine. Context7 library resolution
and documentation preceded primary-source checks. Reuses the earlier
[remote audit](catalog-audits/remote-missing.md); no Docker, enrollment, secret
inspection, or routing changes. All three remain blocked rather than receiving
a health-only recipe or fabricated administrator.

## Tailscale

Reviewed catalog pin: `ghcr.io/tailscale/tailscale:v1.102.4`; no digest was pulled.
Userspace mode avoids TUN/capabilities. The existing owner-file `file-uri`
binding can express `TS_AUTHKEY=file:/run/secrets/auth-key`; persistent state
and `TS_AUTH_ONCE=true` retain node identity. This fixes token representation,
not remote access. [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params),
[pinned containerboot](https://github.com/tailscale/tailscale/blob/v1.102.4/cmd/containerboot/main.go).

Pinned settings reject `TS_DEST_IP` and `TS_EXPERIMENTAL_DEST_DNS_NAME` in
userspace mode. Simple destination forwarding is therefore not a safe substitute
for private Serve. [Pinned validation](https://github.com/tailscale/tailscale/blob/v1.102.4/cmd/containerboot/settings.go).

Missing generic prerequisites: a long-running portless connector contract;
typed owner-selected Serve target and exact owned network; generated watched
configuration-directory binding; rejection of Funnel, subnet routes, exit-node
and SSH expansion; explicit enrollment/ACL scope and authorized/denied-client
verification. `/healthz` observes a tailnet IP only. The setup interface exposes fixed
container commands, but its ordinary adapter HTTP transport targets the saved
loopback app origin, not an arbitrary cloud account. A proxy/health endpoint
would not deliver this catalog entry's private-ingress role.
[Serve parameters and health semantics](https://tailscale.com/docs/features/containers/docker/docker-params),
[Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Cloudflare Tunnel

Reviewed pin: `cloudflare/cloudflared:2026.9.1`; `TUNNEL_TOKEN_FILE` safely
references an owner-issued token, but starting a remotely managed connector can
activate previously configured routes. Token import is not exposure approval.
[Token-file contract](https://developers.cloudflare.com/tunnel/reference/run-parameters/),
[remote tunnel permissions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/).

Route inspection has a documented API: `GET
/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations`, authenticated with
a scoped account API credential. The engine lacks that approved cloud-account
transport and a pre-start route/configuration revision binding. It also lacks
separate DNS/TLS/authentication/public-exposure approval in generic app apply.
[Configuration API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/get/).

The image declares `65532:65532`; readability of an importer-owned `0600` token
must be proved without permission broadening or an unsupported user override.
Long-running portless connectors also remain unrepresented: nullable primary
ports currently apply only to inert manual jobs. No connector recipe/setup is
safe yet; readiness would not prove route privacy.
[Pinned Dockerfile](https://github.com/cloudflare/cloudflared/blob/2026.9.1/Dockerfile).

## ZeroTier

The official Docker guide requires `/dev/net/tun`, NET_ADMIN and SYS_ADMIN for
TAP setup. The image README names TUN and NET_ADMIN; neither documents a
generic no-privilege sidecar. `libzt` instead requires application-level sockets
integration. No image/version is promoted from the catalog's unknown pin.
[Docker guide](https://docs.zerotier.com/docker/),
[image README](https://github.com/zerotier/ZeroTierOne/blob/dev/README.docker.md),
[sockets SDK](https://docs.zerotier.com/sockets/).

Persist `/var/lib/zerotier-one` privately. CLI join, controller authorization,
assigned-address readback and peer reachability are separate steps. Local
service API `X-ZT1-Auth` credentials are not Central credentials; no enrollment
or route acceptance was tested. A separately reviewed privileged networking
owner is prerequisite to a useful recipe.
[CLI](https://docs.zerotier.com/cli/),
[local API](https://docs.zerotier.com/api-service/),
[Central API](https://docs.zerotier.com/api-central/).

Validation: parsed only the three edited manifests and checked their diff.
No recipe/runtime code or new fixture was added because no supported safe
execution path emerged. Source review is not enrollment, ingress, ACL,
restart, or VPN fail-closed acceptance.
