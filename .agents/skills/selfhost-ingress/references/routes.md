# Ingress route matrix

Load only the selected branch. Current provider syntax belongs in an apply adapter and must be refreshed from primary documentation before mutation.

| Route | Exposure | Required contract | Acceptance evidence |
|---|---|---|---|
| Local | This host only | Loopback backend; no public DNS | Loopback request succeeds; non-local request cannot reach the port |
| LAN | Chosen private CIDRs | Explicit LAN CIDRs and observed firewall scope | Allowed LAN client succeeds; outside-scope client fails |
| Tailscale Serve | Private tailnet | Running node, tailnet ACL owner, selected service only | Tailnet identity works; ordinary internet route is absent |
| Headscale | Private self-managed tailnet | Running control plane, lifecycle owner, ACL owner, selected route | Enrolled client works; unenrolled client fails; control state is backed up |
| Existing reverse proxy | Public HTTPS | Compatible Caddy, Traefik, or NPM owner; route/network contract; 80/443, DNS, TLS, and auth owners | DNS and certificate are correct; auth policy works; direct backend remains private |
| Cloudflare Tunnel | Public outbound connector | Account/zone owner, Access or equivalent auth policy, tunnel-token secret reference | Public hostname reaches only the intended app through policy; connector loss fails closed |
| Pangolin/Newt | Public connector to a self-hosted edge | Existing public Pangolin control plane, lifecycle/route contract, Newt secret reference | Identity policy works; Newt route targets the intended private service |
| ngrok | Temporary public endpoint | Explicit temporary/public approval, auth policy, token reference, expiry, non-production data | Endpoint expires or is removed; policy blocks unauthenticated traffic |

## Selection rules

- Choose Local when the user has not selected an exposure class.
- Choose LAN only for clients on named private networks. A wildcard bind is not firewall evidence.
- Choose Tailscale Serve for a private phone or trusted-device request. Choose Headscale only when operating the coordination plane is itself an accepted responsibility.
- Reuse an existing reverse proxy before proposing another owner for 80/443. Compatibility requires owner, lifecycle owner, route contract, reachable proxy network, accepted change mechanism, and persistent state.
- Choose Cloudflare Tunnel for an outbound hosted edge and Pangolin/Newt for an already-operated self-hosted edge. Neither replaces application or identity-aware authentication.
- Choose ngrok for a bounded development endpoint, never as a durable production route.

## Protected surfaces

Keep these behind loopback, LAN, or a private tailnet: databases and queues; Docker API/socket and container managers with host control; identity-provider administration; Caddy/Traefik/NPM administration; Arr applications; qBittorrent and other downloader control panels; host, NAS, and hypervisor administration.

For a media deployment, Homarr's dashboard may be the only approved public management edge while Homarr reaches Arr and downloader integrations over private networks. Jellyfin may be approved separately as the playback edge. Do not expose Sonarr, Radarr, Prowlarr, qBittorrent, or other direct administration surfaces as shortcuts. Keep Homarr's native `/api/mcp` private: the packaged read-only bridge filters tools locally, but the upstream endpoint and its key are not a read-only public profile. A public dashboard route must deny `/api/mcp`, and acceptance must prove that denial from a public client plus successful bridge access over its private route. A public native MCP route would need a separate constrained profile, tool policy, and approval that this pack does not provide. Public exposure of Homarr remains optional and still requires explicit approval plus application or identity-aware edge authentication.

Public user-facing applications still need their own authentication or an approved identity-aware edge. Public media streaming also requires a review of provider limits, traffic terms, and performance; the route planner does not decide those terms.

## Primary references

- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Headscale routes](https://headscale.net/latest/ref/routes/)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Traefik Docker provider](https://doc.traefik.io/traefik/providers/docker/)
- [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Pangolin architecture](https://docs.pangolin.net/about/how-pangolin-works)
- [ngrok agent](https://ngrok.com/docs/agent)
