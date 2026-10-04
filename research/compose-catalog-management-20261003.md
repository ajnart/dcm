# Management Compose review — 2026-10-03

Result: fixed publisher images and account/token source verified for Portainer,
Dockge, and Coolify. **No useful recipe can currently be represented without a
new explicit host-authority boundary.** Their support remains discovery; no
login-only candidate, fake `no-account`, socket exception, SSH grant, Docker
apply, or credential access was added. Existing research was reused and current
Context7 documentation was checked before primary publisher/source checks.

## Fixed publisher images

Direct publisher tag metadata confirmed Linux AMD64/ARM64 images, without Docker.
These observed index digests are evidence, not saved project selections or apply
approval. A future plan must resolve and bind the selected platform digest again.

| App | Fixed tag | Observed index digest |
| --- | --- | --- |
| Portainer CE | `docker.io/portainer/portainer-ce:2.45.1` | `sha256:4d616db18cfeb5dd41a69c0958bc825c84483ea9cde1106eb82a5d26f3bd8b0e` |
| Dockge | `docker.io/louislam/dockge:1.5.0` | `sha256:335c6368b880ecc203236ed89e6e5232e0d6578e8ef5920e4a502390451502bf` |
| Coolify | `docker.io/coollabsio/coolify:4.3.23` | `sha256:79d5c0443696f2fcb280a4d5a15fcc091a51784e566ab212889a08e424d8187c` |

Sources: [Portainer publisher metadata](https://hub.docker.com/v2/repositories/portainer/portainer-ce/tags/2.45.1/),
[Dockge publisher metadata](https://hub.docker.com/v2/repositories/louislam/dockge/tags/1.5.0/),
[Coolify publisher metadata](https://hub.docker.com/v2/repositories/coollabsio/coolify/tags/4.3.23/).
Coolify's [release](https://github.com/coollabsio/coolify/releases/tag/v4.3.23)
and [publisher version catalog](https://cdn.coollabs.io/coolify/versions.json)
also identify 4.3.23. No unique latest Portainer release is inferred from
inconsistent indexed tag listings; the selected fixed tag was checked directly.

## Portainer: account/key routes are not the blocker

The [official installation](https://docs.portainer.io/start/install-ce/server/docker/linux)
is one server with persistent `/data` and host Docker socket, or server plus an
Agent/Edge topology. An agent also requires authority on its target host; moving
the socket out of the server container does not remove that grant.

`--admin-password-file` seeds only the first `admin`, avoiding the fresh setup
token gate; it is not a password-reset route. Login JWT remains a session.
[CLI contract](https://docs.portainer.io/advanced/cli),
[setup gate](https://docs.portainer.io/faqs/installing/setup-token).

Pinned 2.45.1 explicitly supports authenticated
`POST /api/users/{id}/tokens` with description and the internal user's password.
The same user must own the session; response supplies `rawAPIKey` plus metadata.
The paired GET returns inventory, not original plaintext. An eventual adapter
can reuse the existing private session, exact approval, pre-send checkpoint,
immutable API-key writer and authenticated readback. Lost unsaved creation must
stop, not mint another key. An administrator key has administrator-equivalent
authority and needs truthful export disclosure.
[Create source](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/users/user_create_access_token.go),
[inventory source](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/users/user_get_access_tokens.go).

A socket-free useful server can adopt an **already provisioned** private Docker
TLS endpoint only after separate host-wide management approval. Its endpoint API
requires multipart CA/client certificate/private-key material with TLS enabled
and both verification bypasses disabled. Current private-file import is storage,
not authority to acquire/use these keys or approve a remote host. Login success
without verified connected-environment identity remains pending management.
[Pinned endpoint source](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/endpoints/endpoint_create.go),
[official remote API requirements](https://docs.portainer.io/admin/environments/add/docker/api).

## Dockge: daemon plus stack filesystem

The [fixed 1.5.0 Compose](https://github.com/louislam/dockge/blob/1.5.0/compose.yaml)
uses one manager, `/app/data`, host socket, and an absolute writable stacks bind
whose host/container paths must match. Generic project data cannot replace this
path identity or grant ownership of imported stacks.

Pinned `setup` creates the first user only when the database has none; `login`
returns a password-bound JWT and supports a separate 2FA path. These are
Socket.IO events, not a stable HTTP owner or durable API-key route. Current
setup transport's Socket.IO control frames do not authorize arbitrary login,
setup, or stack events. A future transport extension must be source-pinned,
checkpointed and secret-safe; it must not label the login JWT a durable key.
[Pinned handler](https://github.com/louislam/dockge/blob/1.5.0/backend/socket-handlers/main-socket-handler.ts).

## Coolify: full topology and automatic host work

Pinned [base Compose](https://github.com/coollabsio/coolify/blob/v4.3.23/docker-compose.yml)
plus [production override](https://github.com/coollabsio/coolify/blob/v4.3.23/docker-compose.prod.yml)
define Coolify, PostgreSQL, Redis, and realtime. They use separately owned host
paths, installation environment, host-gateway alias and an external `coolify`
network. **Production Compose does not mount the Docker socket.** Realtime is
fixed at 1.0.19 in that source; database/cache defaults remain major-version tags
and need their own resolved selections. Do not copy password-bearing Redis argv.

The [production seeder](https://github.com/coollabsio/coolify/blob/v4.3.23/database/seeders/ProductionSeeder.php)
imports host SSH identity, creates a localhost server and schedules proxy and
Sentinel work. Thus a four-container dashboard is not an inert substitute for
the installer authority. The [root seeder](https://github.com/coollabsio/coolify/blob/v4.3.23/database/seeders/RootUserSeeder.php)
accepts ROOT inputs, validates real owner email DNS and password complexity,
skips an existing root and disables registration after creation.

The [token component](https://github.com/coollabsio/coolify/blob/v4.3.23/app/Livewire/Security/ApiTokens.php)
uses authenticated user/team policies, API enablement, explicit abilities and
expiry, then flashes the one-time Sanctum token. This is source-backed behavior,
not an established generic HTTP bootstrap transport. A read-only Homarr token
and SSH host authorization are distinct grants; neither follows from install.
[Official token guidance](https://coolify.io/docs/core/security/credentials/api-tokens).

## Shared missing primitive and exact boundary

`selfhost/scripts/catalog.ts` only reports `capability:docker-api-boundary`;
it does not implement an authority gate. Compose rejects sockets, and
`packages/cli/src/lib/shared-host-observation.ts` permits only inspected local
contexts. Generated/owner private files, structured secret settings, bounded
commands and account transport are reusable but do not grant host control.

The smallest useful first slice is approved adoption of a provisioned private
mTLS Docker endpoint: exact host/peer identity, credential references, permitted
consumer, host-wide authority disclosure, separate approval, expiry and
connected-environment readback. Do not configure a daemon listener implicitly.
Coolify needs an analogous SSH account/key/host-key and host-resource boundary;
Dockge additionally needs exact stacks-tree ownership/import policy. These are
application-independent capabilities, not app-folder exceptions.
[Docker authority warning](https://docs.docker.com/engine/security/protect-access/).

Only manifest facts and this research note changed. No runtime source, recipe,
setup adapter, approval record, or engine capability was added.

Validation: Bun 1.4 `catalog validate --json` passed for all 94 apps, 19 stacks,
and 74 existing recipes, with no errors. Owned-path `git diff --check` passed.
No tests, image builds, CI, Docker operations, or live account checks were run.
