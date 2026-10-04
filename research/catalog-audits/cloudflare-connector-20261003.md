# Cloudflare connector — 2026-10-03

The portless connector and owner-file schema remove the old random-token/frontend blockers, but do not authorize activating a remotely configured tunnel. Keep Cloudflare **guided and not installable**. `connector.ts` records the pending contract and parses a previously collected readiness observation without network, secret, or Docker access. It is not a recipe or setup adapter.

Current publisher evidence, checked with Context7 resolve/docs and pinned source:

- [Pinned Dockerfile](https://github.com/cloudflare/cloudflared/blob/2026.9.1/Dockerfile): `cloudflare/cloudflared:2026.9.1` uses a distroless image, UID/GID 65532 and the cloudflared entrypoint. No shell/curl readiness command should be invented.
- [Run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/) and [pinned flags](https://github.com/cloudflare/cloudflared/blob/2026.9.1/cmd/cloudflared/tunnel/subcommands.go): the existing tunnel token is supported through `TUNNEL_TOKEN_FILE`. It must be an explicitly supplied private file, never a generated password or argv value.
- [Pinned readiness](https://github.com/cloudflare/cloudflared/blob/2026.9.1/metrics/readiness.go): `/ready` returns status, readyConnections and connectorId; 200 means active edge connections, 503 means none. Connector ID is not tunnel identity, and readiness proves neither private routing nor authorized client delivery.
- [Configuration readback](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/get/): exact account/tunnel GET requires a separate Cloudflare API token with read permission. The enrollment token is not that API credential.

Minimum interface before an installable recipe:

1. An owner-bound, read-only cloud-account transport with a separately supplied scoped API secret; read exact account/tunnel configuration and route inventory before apply. Bind its version/hash and approved origin/route scope to the saved owner approval, and recheck immediately before start. Reject public routes absent separate DNS/TLS/auth/public-exposure approval. Inspect every enabled routing mechanism; tunnel configuration alone is not a private-network route inventory.
2. A private-file ownership/runtime contract that makes the mode-0600 token readable by UID 65532 without chmod broadening, root fallback, or assuming the host owner matches the image user.
3. A private exact-owner readiness transport, plus provider readback associating the observed connector with the selected tunnel. No fake app HTTP frontend, admin, API key or Homarr widget.

Starting an existing tunnel can activate its existing routes; a post-start pending adapter is too late to protect that boundary. No account, tunnel, DNS, Access policy, route, enrollment, Docker run or live acceptance was performed. The focused synthetic fixture checks only contract and readiness interpretation.
