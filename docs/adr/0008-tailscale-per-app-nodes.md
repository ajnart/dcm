# Each web App has its own private Tailscale node

For #203, use one generated userspace sidecar and HTTPS `serve.json` per App
with a web page. Its state lives under `apps/tailscale/nodes/<app>/`, so
restarts preserve its identity. The Tailscale App owns the generated services;
removing a web App removes its sidecar container, keeping state for reinstall.
No Funnel, Docker socket, host port or privileged network device is needed.

This preserves normal root-relative App links and works with ordinary
Tailscale clients, including phones, Apple TV and Android TV. Tailscale
Services require policy edits and per-Service definitions; automating those
needs an overly broad API scope. One node with paths breaks root-relative
links, one node with ports misses per-App names, and TSDProxy needs a Docker
socket. These are the trade-offs established by the throwaway prototype on
`origin/omos/p203-tailscale-names`, not a live-tailnet acceptance run.

One private `tailscale.auth_key` input accepts a reusable, pre-approved auth
key or an OAuth client secret. All nodes read a shared mounted 0600 file;
OAuth adds permanent/preauthorized options and `tag:self-host`. The existing
connector node remains for compatibility. HTTPS must be enabled by the owner,
with a plain warning that App names enter public certificate logs.

Read each node's `Self.DNSName`, never infer a suffix or ignore collisions.
Addresses are additive; the legacy `url` and IP:port fallback stay unchanged.
`KeyExpiry` and `NeedsLogin` become plain Needs attention items. Auth-key expiry
can block adding Apps after 90 days; untagged node sign-ins expire separately.

Sources checked on 2026-10-10: [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params),
[HTTPS](https://tailscale.com/kb/1153/enabling-https),
[Serve](https://tailscale.com/kb/1312/serve),
[auth keys](https://tailscale.com/kb/1085/auth-keys),
[OAuth clients](https://tailscale.com/kb/1215/oauth-clients).
Tests use fake status JSON, never live Docker or Tailscale. OAuth file options,
first-load certificate latency and large Immich uploads remain unverified
against a real tailnet, as recorded by the prototype.
