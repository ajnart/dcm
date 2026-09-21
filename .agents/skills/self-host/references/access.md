# Choose how people reach the apps

Ask where the user will open the dashboard: on this computer, another device
at home, or away from home. Reuse an answer already given. Present normal
language and usable URLs; derive bind addresses from that choice.

| Intended access | Plan |
| --- | --- |
| This computer only | Publish to `127.0.0.1`; use localhost links. |
| Home network | Use the host's observed LAN address for the entry point or selected app ports; give LAN URLs. |
| Away from home, privately | Use an existing or selected tailnet/VPN access path; give addresses reachable by the user's device. |
| Friendly HTTPS names | Reuse the existing reverse proxy or plan Caddy. Confirm DNS and certificate trust on the user's device. |
| Public internet | Separate ingress plan for domain, TLS, authentication, routing, and firewall ownership. |

`127.0.0.1` means only the Docker host can connect to that published port.
It is useful for a local harness or a host-based proxy, but a localhost link
will not open the server from the user's laptop. Removing the host address
publishes on all host interfaces; `0.0.0.0` is a bind address, not a URL.
An all-interface bind may be appropriate on an intentionally configured host,
but must reflect the selected access plan rather than be an accidental default.

For a containerized Caddy proxy, use the owned shared Docker network and service
names for upstreams (`homarr:7575`, not `127.0.0.1:7575`). Backend apps do not
need host-published ports for proxy traffic. Retain loopback ports only when
local onboarding or maintenance needs them. Publish the proxy's entry ports on
the chosen LAN/tailnet interface. Apps retain their own authentication; TLS does
not create accounts or protect an unauthenticated dashboard.

Read [ingress](../workflows/selfhost-ingress/GUIDE.md) for the concrete route plan
and [Compose](../workflows/selfhost-compose/GUIDE.md) for owned changes.
The media harness has a configurable Homarr bind and user-access URL; follow
its [headless access guide](../workflows/selfhost-media/assets/harness/docs/headless-access.md).
Its remaining loopback ports are local automation endpoints. Add explicit
private routes for apps the user will open directly, such as Jellyfin or Seerr.
A dashboard link does not proxy those apps.

Verify from the intended client path, including DNS and certificate trust.
Local HTTP checks alone do not prove LAN or remote access. Return one working
Homarr board link plus direct app links the user can actually reach.

Sources: [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/),
[Compose networking](https://docs.docker.com/compose/how-tos/networking/),
[Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
