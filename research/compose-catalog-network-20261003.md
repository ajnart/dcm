# Network Compose catalog recheck

Checked 2026-10-03. Source and plan work only: no Docker, runtime/secret reads,
DNS changes, public routes, capability grants, CI, commits, or live acceptance.
Existing `research/catalog-audits/network-missing.md` is preserved.

Context7 `library` then `docs` ran outside the sandbox for HAProxy, Headscale,
NetBird and Pangolin. Pinned primary files below control version-specific facts;
the Headscale index describes `main` and omits gRPC fields present in v0.29.4.
No recipe/setup was added: none fits the current safe shared contract.

| App / source pin | Exact blocker | Existing primitive to reuse |
| --- | --- | --- |
| HAProxy 3.2.25 | The image runs as UID/GID 99; generated mounts are owner-owned 0600. No proven readable config delivery or selected backend binding. No admin account/key exists to create. | Literal `configFiles`, immutable images, private frontend and same-owner route facts, once readability and route selection are reviewed. |
| Headscale v0.29.4 | Approved client-facing HTTPS `server_url`, matching config, client DNS/trust and control-protocol proxy; CLI-issued key capture/reconciliation after a lost response. | Bounded `tmpfs`, named state volume, `container.exec` pre-send checkpoint/private stdout and `secrets.writeApiKey`. Do not capture an API key as an admin password. |
| NetBird v0.80.0 source | Server/dashboard image pins remain unverified; selected OAuth/exposed origin, secret config and HTTP/WebSocket/h2c routing are not represented by static recipes. STUN reachability needs its own approval. | `privateConfigs` generated secret parts, `manual-first-email`, private HTTP, checkpoint-before-POST, private API-key storage and authenticated owner readback. No new app command router. |
| Pangolin 1.24.0 | Selected domains/TLS edge, private server config and one-time setup-token logs; full tunnels additionally require Gerbil capabilities/network namespace. | Private config, fixed healthcheck, named state and checkpointed HTTP once pinned bootstrap and fresh-start token capture are proven. No-tunneling is a separate mode, not tunnel acceptance. |

## Primary evidence

HAProxy's [pinned publisher Dockerfile](https://raw.githubusercontent.com/docker-library/haproxy/60e87b92f7a36f502cd71911c9a6c39220ba1424/3.2/Dockerfile)
sets UID/GID 99 and `USER haproxy`; the [publisher guide](https://raw.githubusercontent.com/docker-library/docs/master/haproxy/README.md)
requires a supplied config. Do not change it to root or relax private-file modes
to bypass the current readability gap. Syntax/route/reload acceptance is pending.

Headscale's [pinned container example](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/docs/setup/install/container.md)
uses read-only root, `/var/run/headscale` tmpfs, config and persistent state.
Its [version-matched config](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/config-example.yaml)
binds `server_url`; defaults listening on container loopback are not usable
unchanged for published clients. [API-key source](https://raw.githubusercontent.com/juanfont/headscale/v0.29.4/cmd/headscale/cli/api_key.go)
prints the secret only on creation (90-day default); listing cannot recover it.
Current private stdout/storage primitives narrow the old audit's capture gap,
but loss between execution and persistence must remain unresolved, not replayed.

NetBird's [v0.80.0 installer](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/infrastructure_files/getting-started.sh)
generates combined-server secret config and dashboard OAuth endpoints, but
defaults their images to `latest`. It also offers explicit `use-ip` HTTP;
this review does not select that different identity or exposure mode.
[External proxy docs](https://docs.netbird.io/selfhosted/external-reverse-proxy)
require distinct h2c/gRPC and HTTP/WebSocket routes plus UDP STUN.
The [pinned handler](https://raw.githubusercontent.com/netbirdio/netbird/v0.80.0/management/server/http/handlers/instance/instance_handler.go)
provides instance inspection and one-time owner setup.
[Automated setup](https://docs.netbird.io/selfhosted/automated-setup) documents
`NB_SETUP_PAT_ENABLED=true`, `create_pat`, expiry (1–365 days, default 1),
private one-time PAT response and `Authorization: Token` for `/api/users`.
PAT loss requires inspection; do not retry an ambiguous first-owner write.

Pangolin's [1.24.0 Compose template](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/docker-compose.yml)
grants Gerbil `NET_ADMIN`/`SYS_MODULE` and shares its network namespace with
Traefik. Its [config template](https://raw.githubusercontent.com/fosrl/pangolin/1.24.0/install/config/config.yml)
binds domains, HTTPS dashboard/CORS and server secret.
[Manual setup](https://docs.pangolin.net/self-host/manual/docker-compose)
requires a first-boot log token; documented no-tunneling removes Gerbil, not
domain/TLS ownership. [Admin CLI](https://docs.pangolin.net/self-host/advanced/container-cli-tool)
uses plaintext password argv and is unsuitable for private generated passwords.

## Shared source boundary and validation

`catalog/types/setup.ts` and `setup-transport.ts` already provide private HTTP,
CAS checkpoints, bounded CLI stdout and private key storage. `multi-service-recipe.ts`
writes config as owner-only 0600 and accepts literal config or literal/generated
secret parts, not selected external-origin interpolation. Shared private HTTPS
is a callable localhost-only planning seam; TLS apply, canonical app origins,
persisted routes, DNS and client trust remain blockers. It cannot satisfy these
apps merely by producing a Caddyfile.

Manifest updates refine those boundaries without support promotion. Required
future proof remains fresh-instance owner/key authentication, replay behavior,
client enrollment or actual routed resource traffic, and restart persistence.
Source checks do not earn live compatibility points.

Focused checks passed: the four manifest JSON records parse; each actual
`selfhost.ts plan --app ID --json` returns `status: pass`, `mutation: false`;
owned-file `git diff --check` is clean. No recipe/setup source changed, so no
build or adapter fixture was applicable. HAProxy's existing manifest remains
accurate and unchanged; Headscale, NetBird and Pangolin received the refinements.
