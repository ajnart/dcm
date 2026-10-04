---
name: selfhost-ingress
description: Optional ingress extension. Plan private-first ingress and remote access for self-hosted services. Use for local or LAN access, tailnets, reverse proxies, tunnels, DNS, TLS, ports 80/443, authentication, ownership conflicts, or separate public-exposure approval. This capability produces a redacted plan and does not configure the edge.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer for the bundled planner; provider configuration stays outside this read-only capability.
---

# Self-host ingress

Choose one route for each service and keep one accountable owner for every edge resource. Treat access planning and public exposure as separate authorities.

## Workflow

1. Establish the target service and host. Default unspecified access to host-only; do not ask the user to know their server IP or DNS resolver in advance.
2. Invoke `selfhost-host` before asking about LAN or private-client routing. Inspect its bounded LAN-address candidates, resolver candidates, listeners, existing proxies, tunnel clients, and network ownership. Present observations as candidates, not route or DNS ownership. Ask which client devices need access and who controls DNS/CA trust only when that choice changes the route; the host probe cannot discover client trust.
3. Read [routes.md](references/routes.md) and [plan-contract.md](references/plan-contract.md). For listed applications, also read [application-profiles.md](references/application-profiles.md).
4. Run `scripts/plan-ingress.ts` with explicit facts and preferences. The planner never discovers infrastructure or contacts a provider.
5. Resolve every `conflict` and `blocked` gate before proposing an apply action. Reuse an existing Caddy, Traefik, or Nginx Proxy Manager only when its owner, lifecycle, network, route contract, and port ownership are known.
6. Present the redacted plan. Obtain separate approval for public reachability and its authentication policy. Hand implementation to the capability that owns the selected proxy, tunnel, DNS, TLS, or firewall.
7. Require post-apply evidence for client-side name resolution, certificate identity and expiry when TLS applies, intended route delivery, access-policy enforcement, and continued privacy of direct service ports.

## Run the planner

Resolve the script relative to this `GUIDE.md`.

```bash
bun <skill-directory>/scripts/plan-ingress.ts --input ingress-input.json
bun <skill-directory>/scripts/plan-ingress.ts --json '{"schemaVersion":1,"service":{"id":"photos","class":"application"},"facts":{},"preferences":{}}'
```

Use `--json` only for non-secret input that is safe in a process argument. The planner rejects secret-bearing fields and accepts opaque identifiers only through `secretRefs`.

## Shared private Caddy apply adapter

After one or more `caddy-private` plans pass, the standalone CLI can aggregate
them into one owned Caddy container and delegate its exact Compose lifecycle to
`selfhost-compose`:

```bash
self-host caddy-private plan --project-root /exact/project --input /exact/project/shared-caddy.json
self-host caddy-private apply --project-root /exact/project --input /exact/project/shared-caddy.json --approve APPLY:PROJECT:DIGEST
self-host caddy-private status --project-root /exact/project --input /exact/project/shared-caddy.json
self-host caddy-private down --project-root /exact/project --input /exact/project/shared-caddy.json --approve STOP:PROJECT:CHECKPOINT_DIGEST
self-host caddy-private up --project-root /exact/project --input /exact/project/shared-caddy.json --approve UP:PROJECT:CHECKPOINT_DIGEST
self-host caddy-private status --project-root /exact/project --checkpoint PROJECT
```

The adapter requires one exact private bind on an unprivileged high port,
owner-only persistent config/data, passing plan files, and observed ownership
for every reused upstream network. It can create a separate Caddy-owned internal
bridge for an app that must be routed before first deployment, such as
Vaultwarden: declare `ownership: new`, `internal: true`, and name it
`<caddy-project-id>-<upstream-network-id>`. The app joins that observed bridge through its own approved
Compose revision after Caddy applies; no database or media-admin network joins.
It mounts no Docker socket. Before Compose
mutation, apply retains the exact secret-free manifest and Compose identity in
owner-only state before Compose invocation, using `compose-started`
conservatively when Compose may have started. Status supplies exact
checkpoint-bound approvals for scoped stop and restart, including recovery
after TLS proof fails, a referenced plan disappears, or the input becomes
unreadable. The latter uses the explicit checkpoint ID; every lifecycle action
still validates that checkpoint's project, exact Compose target, and approval.
Apply exports the local CA and proves each TLS endpoint only with explicit
`curl --cacert` and `--resolve`; DNS, intended-client trust, upstream
network membership and isolation, firewall scope, application settings, and
application acceptance remain separate manual evidence. In particular, a
caller-declared `internal` value does not inspect or enforce isolation on a
reused external Docker network. See the CLI README for the input shape and
lifecycle commands. Each mutating command holds an owner-only, per-project lock
from checkpoint read through final checkpoint write. Same-project concurrency
fails closed without affecting other project locks. Never auto-remove an
apparently stale lock: first establish that no matching CLI process is active
and inspect the exact checkpoint and Docker project state. A stopped update may
resume only when the Caddyfile bytes equal either its retained hash or the newly
approved content; all third content is rejected. The ingress planner itself
remains read-only.

## Hard boundaries

- Keep service ports loopback-bound or private by default. A proxy or tunnel is the public edge; the backend is not a second edge.
- The explicit media harness publishes all seven host ports on every interface.
  Record those direct bindings as observed facts; require router or Docker-aware
  firewall evidence before calling any resulting route private. Adding Caddy
  alone does not close those ports.
- For CLI-managed media, join a private Caddy container to the media project's
  `${COMPOSE_PROJECT_NAME}_web` network for Homarr, Jellyfin, and Seerr. The
  default `${COMPOSE_PROJECT_NAME}_network` also contains Arr and qBittorrent;
  keep it outside Caddy's upstream network set. Verify the web network and
  service membership on the actual run before apply. Immich's and Docmost's
  optional application-only integration network can join that web network;
  keep their databases and queues on their private networks.
- Keep database, Docker API/socket, identity administration, Arr, downloader, qBittorrent, and general administration surfaces off the public internet. Provide private tailnet or LAN access instead.
- For a media stack, Homarr's dashboard may be the single approved management edge while its Arr and downloader integrations stay private. Jellyfin may use a separate approved playback edge. Keep Homarr's native `/api/mcp` private and let the local read-only bridge reach it over loopback, LAN, or a private tailnet. A public dashboard route must deny that path and prove the denial from a public client; a public native MCP route requires a separate constrained profile and approval that this pack does not provide.
- Require `publicApproved: true` and an approved authentication policy for every public or temporary route. A tunnel supplies transport, not application authorization.
- Assign one owner per host port 80 and 443, DNS zone or hostname, and TLS certificate/termination point. Report competing owners as `conflict`; never steal a listener or edit another owner's route.
- Keep Caddy state persistent; its private route contract lives in [plan-contract.md](references/plan-contract.md). Treat Traefik Docker API access as privileged. Keep Nginx Proxy Manager administration private.
- Use Tailscale Serve for private tailnet access. Treat Headscale as a chosen self-hosted coordination plane with an explicit lifecycle and ACL owner.
- Use Cloudflare Tunnel or Pangolin/Newt only with the relevant account/control-plane contract, secret references, and access policy. Use ngrok only for an approved, expiring, non-production endpoint.

## Result contract

Return the planner JSON plus a concise explanation of the selected route, reuse contract, gates, conflicts, decisions, and verification obligations. `pass` means the read-only plan is internally ready for review; it never means the route was applied or verified. `blocked` means evidence or approval is missing. `conflict` means the requested route would violate ownership or exposure policy.

## Completion criteria

Planning is complete when the route and intended clients are explicit; the backend remains private; owners for every selected edge resource and reused component are accountable; public and authentication approvals are recorded when applicable; protected surfaces remain private; every remaining uncertainty is a blocked gate or decision; and the plan contains no secret value or mutation claim.
