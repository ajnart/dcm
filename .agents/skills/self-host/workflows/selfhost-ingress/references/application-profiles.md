# Application reverse-proxy handoffs

Apply these requirements after rendering the generic private Caddy route. They are application-owned settings and live checks, not proof supplied by the ingress planner.

| Application | Required handoff and live checks | Official guidance |
|---|---|---|
| Nextcloud | Add the exact friendly hostname to `trusted_domains`. Trust only the exact observed proxy address or narrow proxy CIDR in `trusted_proxies`; never insert a broad private range by default. Set `overwriteprotocol` to `https` only when automatic detection fails, and keep `overwritehost`/`overwrite.cli.url` aligned with the canonical client URL when needed. Check login, generated links, and CalDAV/CardDAV discovery live. | [Nextcloud reverse proxy](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/reverse_proxy_configuration.html) |
| Immich | Use the root of its own hostname; subpath hosting is unsupported. Preserve forwarded headers and verify large photo/video uploads and long-running transfers live. Do not add a request-body cap; review timeout behavior against current Immich guidance. | [Immich reverse proxy](https://docs.immich.app/administration/reverse-proxy/) |
| Jellyfin | Configure the exact proxy address as a Known Proxy, confirm forwarded client identity, and test WebSocket playback/session behavior. Do not invent a subpath unless Jellyfin's Base URL is configured to the same path; root-host routing is the beginner default. | [Jellyfin reverse proxy](https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/) |
| Vaultwarden | Use the HTTPS client URL because the web vault needs a secure context. Prove browser and native-client login/sync live; local CA trust is required on every client and does not replace Vaultwarden authentication. | [Vaultwarden README](https://github.com/dani-garcia/vaultwarden/blob/main/README.md#usage) |
| Homarr | Give dashboard tiles the client-facing HTTPS URL. Keep integrations on their Docker DNS/internal HTTP URLs so service-to-service traffic does not depend on client DNS or the reverse proxy. If Homarr is ever made public, deny `/api/mcp` at that edge under the existing public Homarr contract. | [Homarr documentation](https://homarr.dev/docs/) |

Use one hostname per application. Do not synthesize subpath routes for applications without explicit upstream support. A rendered Caddyfile still needs DNS, client trust, application configuration, and live behavior checks.
