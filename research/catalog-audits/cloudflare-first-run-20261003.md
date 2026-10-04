# Cloudflare first-run boundary — 2026-10-03

Implemented app-owned private token identity decoding, strict account/tunnel/source/version
matching for the account API's single catch-all `http_status:404` configuration,
and fresh-response digest recheck. Unknown fields, additional rules, custom token
edge endpoints and mismatches fail closed with sanitized errors. These helpers
grant no apply authority. The connector has no frontend or fictitious Homarr tile.

## Current official evidence

- [Run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/):
  `--token-file`/`TUNNEL_TOKEN_FILE` is available from 2025.4.0. Context7's
  `/cloudflare/cloudflare-docs` lookup corroborated the official file input.
- [Pinned token source](https://github.com/cloudflare/cloudflared/blob/2026.9.1/connection/connection.go):
  base64-encoded JSON holds account (`a`), secret (`s`), tunnel (`t`) and optional
  edge endpoint (`e`). Decoding identity is not successful enrollment or API authorization.
- [Configuration API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/get/):
  GET `/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations` requires a
  separately scoped account API credential with a listed read permission.
  It returns identity, source and version; it is not a generic tunnel-token API.
- [Pinned orchestrator](https://github.com/cloudflare/cloudflared/blob/2026.9.1/orchestration/orchestrator.go):
  remote configuration updates replace origin routing while the connector runs.
  An approval-time configuration snapshot cannot freeze subsequent remote changes.
- [Pinned ingress config](https://github.com/cloudflare/cloudflared/blob/2026.9.1/ingress/config.go):
  WARP routing is a separate remote configuration surface. An HTTP deny-all
  observation does not prove absence of private IP/hostname routes in other APIs.
- [Pinned Dockerfile](https://github.com/cloudflare/cloudflared/blob/2026.9.1/Dockerfile):
  runtime UID/GID is `65532:65532`, not the importing host user's identity.

## Exact common interfaces still missing

1. **Owned external API transport before start:** separate declared owner-only
   API credential, exact account/tunnel paths on `api.cloudflare.com`, response
   bounds/no redirects, permission/identity readback and route inventory across
   relevant IP/hostname/configuration APIs. Current setup HTTP is loopback-only;
   current connector setup occurs after Compose start. No bypass is introduced.
2. **Ingress approval before Compose start:** bind the exact shared owner/peer,
   remote identity, route inventory and configuration version/hash to independent
   public-exposure approval, including DNS/TLS/authentication owners; re-fetch
   immediately before start and stop on changed authority. Ongoing remote changes
   require an explicit retained-owner monitoring/lifecycle policy, not claimed
   immutability from this local recheck.
3. **Nonroot private-file staging:** importer-owned `0600` files cannot silently
   become world-readable or root-run. A reviewed UID-65532-readable secret mount
   with exact saved-byte/ownership checks is required before token consumption.
4. **Owned readiness observation:** the pinned distroless image has no assumed
   shell/curl, and connector transport has no HTTP origin. Add an exact internal
   metrics observation, never publish a metrics port or invent a web frontend.

No recipe/setup-ready stub was added: a token-only recipe would activate opaque
remote authority before inspection. The existing portless shared Compose and
owner-file contracts remain reusable once these narrower authority gaps are closed.

Validation: only `packages/cli/tests/cloudflare-connector.test.ts` with Bun 1.4.0
and syntax build of `connector.ts`. Synthetic fixtures only; no Docker, browser,
private runtime reads, cloud-account API calls or enrollment were performed.
