# NetBird traps

## Pitfalls

- Self-hosting the control plane adds availability and recovery dependencies.
- The first-owner setup endpoint is unauthenticated until setup completes; inspect GET /api/instance first. NB_SETUP_PAT_ENABLED=true and create_pat=true permit POST /api/setup to return a one-time PAT, followed by GET /api/users with Authorization: Token. Keep the response private and never replay setup after an ambiguous response; the PAT defaults to one day and needs a reviewed expiry/rotation policy.
- The pinned installer offers use-ip over HTTP, but that is an explicit different identity/exposure choice, not permission to substitute a loopback HTTP URL for reviewed HTTPS. External-proxy mode keeps HTTP frontends private but still exposes STUN separately and requires path-specific HTTP/WebSocket and h2c/gRPC routing.
- The selectable shared derived recipe binds the explicit canonical origin and exact private proxy address into privateConfigs with standard padded Base64 session/store keys. The protocol-aware HTTPS route is a separate reviewed boundary and does not authorize public exposure or establish peer connectivity.
- A healthy dashboard or server does not prove peer enrollment, remote connectivity, or route access.
- The app-owned setup adapter implements pinned setup JSON, fresh-instance checks, attempted-write replay refusal and private PAT capture followed by authenticated owner/PAT metadata readback. Fresh local password login uses a private retained PKCE attempt, one-use code and temporary Bearer readback. Expired or lost PAT requires explicit reconciliation, never an automatic replacement; external SSO and native peer connectivity are not configured or proven.

## Security

- Protect owner credentials, setup-time tokens, generated server secrets, and persistent control-plane state.
- Approve a public DNS/TLS/80/443 owner and UDP 3478 reachability separately; do not infer a LAN or subnet route from a running control plane.
