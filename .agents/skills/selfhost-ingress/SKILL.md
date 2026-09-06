---
name: selfhost-ingress
description: Optional ingress extension. Plan private-first ingress and remote access for self-hosted services. Use for local or LAN access, tailnets, reverse proxies, tunnels, DNS, TLS, ports 80/443, authentication, ownership conflicts, or separate public-exposure approval. This capability produces a redacted plan and does not configure the edge.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer for the bundled planner; provider configuration stays outside this read-only capability.
---

# Self-host ingress

Choose one route for each service and keep one accountable owner for every edge resource. Treat access planning and public exposure as separate authorities.

## Workflow

1. Establish the target service, host, intended clients, and whether access is local, LAN, private remote, public, or temporary. Default an unspecified route to local-only.
2. Invoke `selfhost-host` when host listeners, existing proxies, tunnel clients, or network ownership have not been inspected. Accept only bounded, redacted facts.
3. Read [routes.md](references/routes.md) for the selected route. Read [plan-contract.md](references/plan-contract.md) before constructing planner input or interpreting its result.
4. Run `scripts/plan-ingress.ts` with explicit facts and preferences. The planner never discovers infrastructure or contacts a provider.
5. Resolve every `conflict` and `blocked` gate before proposing an apply action. Reuse an existing Caddy, Traefik, or Nginx Proxy Manager only when its owner, lifecycle, network, route contract, and port ownership are known.
6. Present the redacted plan. Obtain separate approval for public reachability and its authentication policy. Hand implementation to the capability that owns the selected proxy, tunnel, DNS, TLS, or firewall.
7. Require post-apply evidence for client-side name resolution, certificate identity and expiry when TLS applies, intended route delivery, access-policy enforcement, and continued privacy of direct service ports.

## Run the planner

Resolve the script relative to this `SKILL.md`.

```bash
bun <skill-directory>/scripts/plan-ingress.ts --input ingress-input.json
bun <skill-directory>/scripts/plan-ingress.ts --json '{"schemaVersion":1,"service":{"id":"photos","class":"application"},"facts":{},"preferences":{}}'
```

Use `--json` only for non-secret input that is safe in a process argument. The planner rejects secret-bearing fields and accepts opaque identifiers only through `secretRefs`.

## Hard boundaries

- Keep service ports loopback-bound or private by default. A proxy or tunnel is the public edge; the backend is not a second edge.
- Keep database, Docker API/socket, identity administration, Arr, downloader, qBittorrent, and general administration surfaces off the public internet. Provide private tailnet or LAN access instead.
- For a media stack, Homarr's dashboard may be the single approved management edge while its Arr and downloader integrations stay private. Jellyfin may use a separate approved playback edge. Keep Homarr's native `/api/mcp` private and let the local read-only bridge reach it over loopback, LAN, or a private tailnet. A public dashboard route must deny that path and prove the denial from a public client; a public native MCP route requires a separate constrained profile and approval that this pack does not provide.
- Require `publicApproved: true` and an approved authentication policy for every public or temporary route. A tunnel supplies transport, not application authorization.
- Assign one owner per host port 80 and 443, DNS zone or hostname, and TLS certificate/termination point. Report competing owners as `conflict`; never steal a listener or edit another owner's route.
- Keep Caddy certificate data and proxy configuration persistent. Treat Traefik Docker API access as privileged. Keep Nginx Proxy Manager administration private.
- Use Tailscale Serve for private tailnet access. Treat Headscale as a chosen self-hosted coordination plane with an explicit lifecycle and ACL owner.
- Use Cloudflare Tunnel or Pangolin/Newt only with the relevant account/control-plane contract, secret references, and access policy. Use ngrok only for an approved, expiring, non-production endpoint.

## Result contract

Return the planner JSON plus a concise explanation of the selected route, reuse contract, gates, conflicts, decisions, and verification obligations. `pass` means the read-only plan is internally ready for review; it never means the route was applied or verified. `blocked` means evidence or approval is missing. `conflict` means the requested route would violate ownership or exposure policy.

## Completion criteria

Planning is complete when the route and intended clients are explicit; the backend remains private; owners for every selected edge resource and reused component are accountable; public and authentication approvals are recorded when applicable; protected surfaces remain private; every remaining uncertainty is a blocked gate or decision; and the plan contains no secret value or mutation claim.
