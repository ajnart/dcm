# Ingress planner contract

`plan-ingress.mjs` consumes explicit, secret-free JSON and emits a deterministic read-only plan. It does not inspect the host, validate a supplied fact, resolve DNS, open a socket, or write a file.

## Input

```json
{
  "schemaVersion": 1,
  "service": {
    "id": "photos",
    "class": "application",
    "internalPort": 2283,
    "directBindings": [
      {"address": "127.0.0.1", "port": 2283, "internetReachable": false}
    ]
  },
  "facts": {
    "existingIngress": [
      {
        "kind": "caddy",
        "owner": "platform",
        "lifecycleOwner": "platform",
        "routeContract": "managed-caddyfile",
        "network": "edge",
        "acceptsRoutes": true,
        "ports": [80, 443]
      }
    ],
    "ownership": {
      "ports": [{"port": 80, "owner": "platform"}, {"port": 443, "owner": "platform"}],
      "dns": [{"zone": "example.com", "owner": "dns-team"}],
      "tls": [{"hostname": "photos.example.com", "owner": "platform"}]
    },
    "firewallScopeKnown": true,
    "tailscale": {"status": "running", "aclOwner": "tailnet-admin"},
    "headscale": {"status": "not_observable"},
    "cloudflare": {"accountOwner": "edge-team", "accessPolicyOwner": "identity-team"},
    "pangolin": {"status": "not_observable"}
  },
  "preferences": {
    "route": "reverse-proxy",
    "hostname": "photos.example.com",
    "desiredOwner": "platform",
    "publicApproved": true,
    "authentication": {"mode": "oidc", "owner": "identity-team", "approved": true},
    "lanCidrs": ["192.168.1.0/24"],
    "secretRefs": []
  }
}
```

Supported routes are `local`, `lan`, `tailscale-serve`, `headscale`, `reverse-proxy`, `cloudflare-tunnel`, `pangolin-newt`, and `ngrok`. An absent route becomes `local`.

Service classes `admin`, `database`, `queue`, `arr`, `downloader`, `qbittorrent`, `docker-api`, `docker-socket`, and `identity-admin` cannot use a public route. `application` is the general user-facing class.

A public route for `service.id: "homarr"` exposes the dashboard, not native MCP. It must include this explicit path contract:

```json
{
  "nativeMcp": {
    "publicAccess": "deny",
    "privateBridgeRoute": "loopback"
  }
}
```

Place the object under `preferences`. `privateBridgeRoute` accepts `loopback`, `lan`, or `private-tailnet`. A missing contract blocks the `homarr-native-mcp-private` gate. Any requested public access conflicts because this pack has no approved public native-MCP profile. Private Homarr routes do not require this public-edge contract.

Each `existingIngress` reuse candidate needs `kind`, `owner`, `lifecycleOwner`, `routeContract`, `network`, `acceptsRoutes: true`, and the ports it owns. Ownership records are evidence supplied by the caller; duplicate owners for the same resource become a conflict.

Use `secretRefs` for opaque identifiers such as `cloudflare.tunnel-token`, `pangolin.newt-token`, or `ngrok.agent-token`. The planner does not resolve them. Secret-bearing fields such as `token`, `password`, `apiKey`, `privateKey`, or `credentials` make the input invalid and are rejected without echoing a value.

## Output semantics

- `pass`: the plan has the facts and approvals needed for a separate apply proposal.
- `blocked`: a required fact, owner, secret reference, or approval is absent.
- `conflict`: competing ownership or a prohibited exposure must be resolved.
- `route.steps`: desired topology only, never evidence that configuration exists.
- `route.nativeMcp`: the required `/api/mcp` public-deny and private-bridge path policy for public Homarr routes.
- `requiredEvidence`: machine-readable post-apply requirements. Public Homarr emits `homarr-native-mcp-private`, matching the verifier's public-ingress plus Homarr gate.
- `verification`: post-apply obligations. The planner never marks them performed.

Keep the input as a reviewable artifact only when the user asks. If persisted, use private permissions and keep secret values outside it.
