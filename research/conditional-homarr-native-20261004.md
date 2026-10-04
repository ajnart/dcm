# Conditional Homarr native integrations

Checked 2026-10-04 against official Homarr `dev` commit
`917d92c9f31829e8ce9d8411daf69d28c89a8d8b`, not the unrelated local feature branch.
The catalog descriptors currently cite `f50d4ed...`; all three integrations exist
in current upstream source. This is source research, not deployed-image or live
acceptance. No containers, private state, tests, CI or commits were used.
Context7 resolved Caddy and fetched its official administration/security docs.

## Smallest next changes

| App / recipe pin | Proven Homarr contract | Recommended boundary |
| --- | --- | --- |
| Caddy 2.11.4 | No credentials; only `GET /reverse_proxy/upstreams`. Counts upstreams, active requests and remembered failures. | Preserve `:2015` and `/health`; bind admin exclusively to container loopback `127.0.0.1:2019`, and proxy only the exact GET path through the existing frontend. All other admin paths and methods return 404. Recipe config plus source-pinned mapping is sufficient; no arbitrary endpoint override or raw admin listener. Existing owners require their normal reviewed recipe transition. |
| Traefik 3.6.22 | Basic credentials, Bearer key or no auth; connection test `/api/version`; dashboard reads version, entrypoints and HTTP/TCP/UDP resource lists. | Keep ping, enable a file-provider router to `api@internal`, restrict it to the required GET paths and authenticate it. Reuse generated password, existing `bcrypt-hash` private environment and a mode-0600 dynamic config template; hand the same credentials to Homarr. Never enable `api.insecure`, Docker discovery/socket or template debug logging. This changes the management/authentication contract and needs a reviewed recipe transition. |
| Frigate 0.18.0 | HTTPS only; saved administrator login, exact admin profile, then stats. | Reuse the approved private HTTPS owner, but additionally establish a hostname/route reachable from the Homarr container and provision its issuing CA into Homarr's trusted-certificate store. Add a bounded owner-derived integration transport target distinct from the browser/ping URL; never accept a free-form URL/CA or fall back to unauthenticated port 5000. This requires separate route/trust approval; the current HTTP recipe cannot be promoted alone. |

## Primary evidence

Caddy's [current Homarr provider](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/integrations/src/stats/providers/caddy.ts#L5-L43)
uses only the upstream-status GET. Caddy's [2.11.4 handler](https://github.com/caddyserver/caddy/blob/v2.11.4/modules/caddyhttp/reverseproxy/admin.go#L46-L69)
rejects other methods. Its [admin API](https://caddyserver.com/docs/api) also exposes
configuration mutation and process-stop operations, so a private network alone
does not justify publishing the whole API. A permissioned Unix socket is a
documented alternative, not necessary for the minimal container-loopback plan.
The read-only bridge itself can appear in upstream counts; these statistics do
not establish application ingress, backend health or routed traffic acceptance.

Traefik's [current Homarr implementation](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/integrations/src/traefik/traefik-integration.ts#L18-L66)
reads `/api/version`, `/api/entrypoints`, HTTP/TCP routers, services and
middlewares, and UDP routers and services. Its [authentication helper](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/integrations/src/traefik/traefik-integration.ts#L221-L234)
supports Basic/Bearer. The pinned Traefik tag resolves to
`e15c8f86ba7370d01f529682f3b28d2f1d2bb4b5`; its [file-provider documentation](https://github.com/traefik/traefik/blob/e15c8f86ba7370d01f529682f3b28d2f1d2bb4b5/docs/content/reference/routing-configuration/other-providers/file.md#L463-L471)
supports environment-backed Go templates. Official [API security guidance](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/api-dashboard/)
requires administrative authentication/authorization and recommends internal-only
access. Dashboard partial endpoint failure is tolerated by Homarr; a rendered
widget or aggregate count is not proof every endpoint succeeded.

Frigate's [current Homarr provider](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/integrations/src/stats/providers/frigate.ts#L5-L65)
requires HTTPS and POSTs `{user, password}` to `/api/login`, captures the default
`frigate_token`, then checks the username/admin profile before `/api/stats`.
The [pinned Frigate login](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/api/auth.py#L774-L820)
provides that cookie contract. Homarr's [certificate documentation](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/apps/docs/docs/management/certificates/index.mdx#L29-L53)
supports admin upload or `.crt`/`.pem` files under persisted
`/appdata/trusted-certificates`. Its [request transport](https://github.com/homarr-labs/homarr/blob/917d92c9f31829e8ce9d8411daf69d28c89a8d8b/packages/core/src/infrastructure/http/request.ts#L59-L100)
uses an explicit CA list: do not assume a host-side CA proof or
`NODE_EXTRA_CA_CERTS` provisions Homarr trust.

The current shared publisher derives `serverUrl` from the saved application
frontend (`resolved-app.ts`), while `shared-https-target.ts` explicitly resolves
host loopback. Neither alone proves container DNS, TLS identity or Homarr trust.
Keep existing native-eligibility blocks until each replacement recipe/transport
has its reviewed source contract and direct readbacks. No source change earns
live compatibility credit.
