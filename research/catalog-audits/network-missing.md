# Network setup gaps

Checked 2026-10-03. Planning and source inspection only; no Docker apply,
credentials, DNS, public routes, capability grants, or live acceptance.
Existing research is unchanged. None of these four apps has a new shared recipe
or setup adapter; their missing prerequisites must remain visible.

| App / checked source | Missing bounded primitive or owner input | Acceptance still required |
| --- | --- | --- |
| Authelia 4.39.25 | Writable private user database derived from a saved password hash; chosen HTTPS Authelia URL/cookie domain; notifier, access rules, and proxy owner. | Login/owner readback, protected-route deny/allow, recovery, restart credentials. |
| HAProxy 3.2.25 | Config delivery readable by default UID/GID 99 while retaining owner-only files; selected backend/route and certificate owner. | Configuration validation, exact backend routing, management protection, reload/restart. |
| Headscale v0.29.4 | Selected client-facing HTTPS origin, version-matched config, bounded tmpfs, private one-time API-key capture distinct from password capture. | API auth, node enrollment, peer connectivity, restart/state recovery. |
| Pangolin 1.24.0 | Selected dashboard/base domains, DNS/TLS/port owner, private server secret/config, initial setup token capture. Gerbil additionally needs separately approved capabilities/network namespace. | First-admin login, organization/key readback, actual connector/resource access, restart persistence. |

Authelia's [file backend](https://www.authelia.com/configuration/first-factor/file/)
writes its user database on password reset. Its
[session contract](https://www.authelia.com/configuration/session/introduction/)
requires an HTTPS URL and excludes `localhost` cookie domains. The
[official Docker guide](https://www.authelia.com/integration/deployment/docker/)
does not replace the domain, notifier, and access-policy choices with a loopback
port. A static non-secret config cannot bootstrap a credential-bearing user DB.

HAProxy's [pinned publisher Dockerfile](https://raw.githubusercontent.com/docker-library/haproxy/60e87b92f7a36f502cd71911c9a6c39220ba1424/3.2/Dockerfile)
sets `USER haproxy` (UID/GID 99). The
[official image instructions](https://raw.githubusercontent.com/docker-library/docs/master/haproxy/README.md)
require a supplied config. Do not bypass mode-0600 readability by running root
or assuming arbitrary numeric users are supported. HAProxy has no default
administrator account or API credential to invent.

Headscale's [container guide](https://headscale.net/stable/setup/install/container/)
is explicitly community-maintained, not developer-verified. Check it against the
[v0.29.4 config](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/config-example.yaml).
The [pinned API-key command](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/cmd/headscale/cli/api_key.go)
prints the secret once; listing returns metadata and prefixes. Default expiry is
90 days. A node user/preauthkey is not an administrator/password/API key.
Lost creation output must stop automatic replay. A loopback health check does
not prove the chosen HTTPS endpoint or mesh traffic.

Pangolin's [1.24.0 Compose template](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/docker-compose.yml)
grants Gerbil `NET_ADMIN` and `SYS_MODULE` and puts Traefik in Gerbil's network
namespace. Its [config template](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/config.yml)
binds dashboard/base domains, HTTPS CORS origin, and server secret. The
[manual install](https://docs.pangolin.net/self-host/manual/docker-compose)
uses an initial token from logs for first-admin creation. Omitting Gerbil is a
documented reverse-proxy-only mode, not tunnel acceptance; it still needs approved
domain/TLS/edge ownership. No full tunnel recipe fits ordinary shared authority.
The [documented admin CLI](https://docs.pangolin.net/self-host/advanced/container-cli-tool)
accepts plaintext `--password` in argv, so it cannot safely replace the pending
private-token HTTP bootstrap.

Verified: current official documentation and the pinned files linked above;
the four updated manifest JSON files parse, and all four isolated read-only app
plans pass with `mutation: false`. The fixture uses the committed catalog plus
these manifests, excluding unrelated concurrent changes. The live-worktree
plan was blocked by a concurrent Tracearr recipe/source mismatch at this check.
Pending: deployable recipes, exact private credential capture,
fresh-instance/replay behavior, image-user file readability, and all live
application/route/restart acceptance. No setup-ready or managed-support claim.
