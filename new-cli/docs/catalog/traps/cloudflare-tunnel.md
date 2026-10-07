# Cloudflare Tunnel traps

## Pitfalls

- Connector readiness can be checked at its local metrics /ready endpoint, but this does not prove a route is private or authenticated; a published application route can make its origin Internet-accessible.
- Token-file ingestion is available from cloudflared 2025.4.0 onward. Importing a token is not route approval, and no local administrator or generated API key should be fabricated for this connector.
- Remote configuration readback uses GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations with a separately scoped Cloudflare API credential. The connector token alone is not the generic setup engine's cloud-account API credential or an exact route approval.
- Local tunnel ingress validate and ingress rule commands check configuration without enrollment or route changes; they do not inspect remotely managed routes or verify origin delivery.
- The pinned native tunnel --metrics 127.0.0.1:2000 ready command checks the container-private readiness endpoint without shell/curl or a published metrics port. It does not establish tunnel identity, mounted credential readability, DNS/auth policy, selected-origin delivery or client acceptance.
- Pinned tunnel diag requires an existing local metrics instance, collects configuration even when optional logs and metrics are disabled, and can exit successfully with no instance or diagnostic failures. Neither its exit status nor its report is safe generic setup acceptance.

## Security

- A remotely managed tunnel needs an existing Cloudflare-issued token. Use the bounded owner-supplied mode-0600 secret-file import and TUNNEL_TOKEN_FILE if a separately approved connector workflow is added; generated random privateFiles cannot substitute for the token. Never put it in catalog data, argv, plans, or logs.
- Before starting the connector, inspect existing remotely managed routes and obtain a separate public-exposure approval covering the exact route, DNS, TLS, and authentication owners; starting an already configured tunnel can expose its origin immediately.
- The pinned image retains UID/GID 65532. Enrollment uses documented TUNNEL_CRED_CONTENTS from an owner-only env file, not a private bind or unsupported UID override. Credential bytes are visible to Docker operators/container processes; the account read token is never mounted or injected. No root fallback, chmod broadening or ownership repair.
- A locally managed branch must bind an existing credential JSON and fresh provider account/tunnel identity with config_src=local to one owner-selected frontend/hostname, disable WARP routing, retain a final http_status:404 rule, inspect provider route inventories, and separately approve DNS/TLS/auth ownership before startup. Creating tunnels, DNS records or Access policies is outside this branch.
