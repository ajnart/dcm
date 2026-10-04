# Remaining mesh/VPN shared-owner boundaries

## Implementation follow-up (2026-10-03)

The Tailscale proposal below is historical research, not the current runtime
contract. An inert portless userspace daemon recipe and deterministic shared
setup now exist. They use fixed `tailscale up` and `serve` commands with
separate owner/peer/file-bound approvals and checkpoint-before-send. Typed
container transport has no HTTP/session authority; uncertain enrollment is
observed before any replay. Readback rejects Funnel, SSH, subnet and exit routes.
The panel and Homarr recap distinguish pending connectors from browser apps.
Focused fixtures pass; no live provider, ACL/client, internet-isolation or
restart acceptance has been performed. ZeroTier/Gluetun/NetBird prerequisites
below remain open; no privilege or provider grant was inferred.

Checked 2026-10-03. Reuses [remote review](../compose-catalog-remote-20261003.md)
and [VPN review](../compose-catalog-vpn-20261003.md). Context7 resolved
`/websites/tailscale` and fetched current Docker parameters. No Docker, enrollment,
secret inspection, public edge deployment or actual tunnel-break test occurred.

The four exact-app plans now expose their external requirements as capabilities,
not merely prose. None is promoted to managed, given a fabricated local account,
or replaced by a health-only recipe. Existing Homarr mappings remain separate
from setup and network acceptance. Gluetun explicitly requires its private
read-only credential even though upstream Homarr also permits unauthenticated
access. Tailscale/ZeroTier/NetBird have no claimed native Homarr integration.

## Reusable connector seam: Tailscale

`ghcr.io/tailscale/tailscale:v1.102.4` supports userspace enrollment and Serve
without TUN or capabilities. Existing owner-file `file-uri` binding represents
`TS_AUTHKEY=file:/run/secrets/auth-key`; this is an issued enrollment key, not
a generated app API key. Persistent `TS_STATE_DIR` and `TS_AUTH_ONCE=true`
retain node identity. [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params),
[pinned containerboot](https://github.com/tailscale/tailscale/blob/v1.102.4/cmd/containerboot/main.go).

Smallest shared implementation proposal, sent to the shared-engine owner:

1. A long-running **private connector** execution kind: no host frontend and
   no fake primary HTTP port, no host/device/capability/socket grant.
2. A typed `{peerAppId, serviceId, targetPort}` Serve target resolved against the
   exact selected shared owner. Bind network, target, recipe revision and image
   identity into the approval; never accept an arbitrary proxy URL.
3. A generated watched config directory for `TS_SERVE_CONFIG`, rather than a
   single-file mount. Validate the generated config denies Funnel and unrelated
   targets; reject SSH, exit-node and subnet-route expansion.
4. Reuse owner-file enrollment import, with an explicit tailnet identity/ACL
   owner and reviewed key retention/revocation policy.
5. Fixed `tailscale status --json` and `tailscale serve status --json` readback
   may check enrolled local identity and installed route. Intended client allow
   and deny tests, absence of an internet route and restart identity persistence
   remain separate acceptance. Local `/healthz` cannot replace them.

`packages/cli/src/lib/connector-contract.ts` now implements the pure planning
portion, reusing `resolveSharedServiceTarget` rather than duplicating frontend
resolution. It binds the completed saved owner, exact peer fingerprint and image,
unique tailnet HTTPS ports, owner-file enrollment reference and ACL owner. Its
deterministic Serve JSON contains only HTTPS root proxies and empty AllowFunnel;
unknown fields and networking expansions are rejected. The pinned
[Serve types](https://github.com/tailscale/tailscale/blob/v1.102.4/ipn/serve.go)
and [container watcher](https://github.com/tailscale/tailscale/blob/v1.102.4/cmd/containerboot/serve.go)
define that configuration and `${TS_CERT_DOMAIN}` substitution. The explicit
execution model is portless and long-running, with a new owner-scoped state
volume and watched configuration directory. It has no approval/apply API and
cannot claim enrollment. CLI/schema/lifecycle integration remains required.

The watched-directory requirement and the fact Serve config can also enable
Funnel are explicit in [official parameters](https://tailscale.com/docs/features/containers/docker/docker-params).
Do not bypass userspace restrictions with `TS_DEST_IP`: [pinned settings](https://github.com/tailscale/tailscale/blob/v1.102.4/cmd/containerboot/settings.go)
reject it. No ordinary recipe currently represents all five boundaries.

## Gluetun and ZeroTier

Gluetun needs the VPN owner's separately reviewed gateway grant: exact TUN and
NET_ADMIN, same-owner downloader namespace, private gateway WebUI and firewall
policy. The ordinary owner excludes those fields. Provider secrets can already
use `*_SECRETFILE`; a generated read-only control role is representable, but
neither grants network authority. No supported unprivileged VPN-disabled mode
was established. [Released README](https://github.com/passteque/gluetun/blob/v3.41.3/README.md),
[container attachment](https://github.com/qdm12/gluetun-wiki/blob/main/setup/connect-a-container-to-gluetun.md).

ZeroTier's official container requires TUN/NET_ADMIN; its general Docker guide
also names SYS_ADMIN for TAP setup. `libzt` requires application integration,
not an arbitrary-service unprivileged sidecar. It needs a reviewed overlay
authority, controller membership owner, persistent private identity and peer
acceptance. No privilege exception or invented image pin was added.
[Docker guide](https://docs.zerotier.com/docker/),
[sockets SDK](https://docs.zerotier.com/sockets/).

## NetBird

The existing entry is the self-hosted control plane, not a userspace client
proxy. Its source-backed first-owner/PAT HTTP route does not remove reviewed
server/dashboard pins, origin-derived secret config, DNS/TLS ownership and
protocol-aware HTTP/WebSocket/h2c/gRPC plus STUN requirements. A common
owner-selected canonical-origin/private-config and edge contract is prerequisite;
do not create an HTTP localhost substitute or call a running dashboard mesh
acceptance. [Pinned installer](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/infrastructure_files/getting-started.sh),
[external proxy](https://docs.netbird.io/selfhosted/external-reverse-proxy),
[first-owner handler](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/http/handlers/instance/instance_handler.go).

## Focused validation

`packages/cli/tests/mesh-vpn-catalog.test.ts` exercises real exact-app planning
for all four capability lists and the existing VPN planner with synthetic
evidence: healthy status alone remains unverified; complete recorded break
evidence permits the narrow claim; either external-IP or DNS leakage fails it.
This fixture performs no network requests and proves no live tunnel behavior.
`packages/cli/tests/connector-contract.test.ts` also passes: exact-owner and
target binding, stable route serialization, private portless model, tampering,
foreign owner, unknown target, arbitrary config/URLs, duplicate routes and all
Funnel/SSH/subnet/exit expansions. The two fixtures are synthetic source-level
checks, not fresh image, ACL, Homarr, tunnel, or restart acceptance.
