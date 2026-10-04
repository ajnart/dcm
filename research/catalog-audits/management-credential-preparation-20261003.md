# Management credential preparation — 2026-10-03

Portainer now has a real socket-free shared Compose candidate and headless
administrator/API-key preparation. **It remains endpoint-required, never ready
as a container manager.** WUD has a pure app-owned remote-TLS settings helper,
not a deployable watcher or a disconnected monitoring recipe.

This supersedes the earlier conclusion that no Portainer account-only deployment
could be represented. Reused the [management review](../compose-catalog-management-20261003.md),
[remaining headless boundaries](management-headless-remaining-20261003.md), and
[authority review](shared-management-authority.md); the missing endpoint authority
and acceptance conclusions still apply. Context7 resolved Portainer and WUD;
Portainer CLI documentation was useful, while WUD's indexed four-snippet landing
page did not document exact TLS or authentication fields. Pinned publisher source
therefore owns the exact contracts below.

## Portainer CE 2.45.1

Pinned [endpoint startup](https://github.com/portainer/portainer/blob/2.45.1/api/internal/endpointutils/endpoint_setup.go)
returns without creating an environment when the CLI endpoint URL is empty.
The recipe has no `--host`, socket mount, Agent, daemon listener or remote context.
It owns only `/data`, a loopback HTTP port and a mode-0600 password-derived file.
The upstream image's default user is retained; no readability exception is added.

The documented [password-file flag](https://docs.portainer.io/advanced/cli)
and pinned [startup initialization](https://github.com/portainer/portainer/blob/2.45.1/api/cmd/portainer/main.go)
seed only an absent administrator. Existing private configuration composition
provides `/run/secrets/admin-bootstrap`; no plaintext password enters argv or
ordinary environment. The current `manual-first-admin` onboarding label records
the saved generated `admin` identity only. Actual seeding is the CLI password
file, **not** an invented `/api/users/admin/init` request.

The adapter verifies pinned [version](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/system/status.go),
approves [login](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/auth/authenticate.go),
privately caches its password-bound JWT across deferred approvals, and verifies
the exact first administrator using [current-user readback](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/users/user_inspect_me.go).
It requires an empty authenticated environment inventory before creating a key.
Unexpected role/identity or transport errors preserve the private session;
only the pinned authentication 401 permits discarding an invalid session.

The one-time [key-create handler](https://github.com/portainer/portainer/blob/2.45.1/api/http/handler/users/user_create_access_token.go)
uses that user's password and JWT, not an API-key-authenticated request. The
adapter checkpoints before send, checks owner/description/prefix and the
publisher's [raw-key/digest format](https://github.com/portainer/portainer/blob/2.45.1/api/apikey/service.go),
saves the raw key privately before another network request, then verifies it.
A lost unsaved create response cannot be replayed. A saved key can be reconciled
and verified without minting another one. Administrator-equivalent authority
is disclosed in the key creation approval.

API-key authentication [updates LastUsed](https://github.com/portainer/portainer/blob/2.45.1/api/http/security/bouncer.go)
at most once per minute. The verification GET therefore carries an explicit
mutation approval. Read-only `inspect` does not use the key or renew a JWT;
it verifies the pinned version and immutable saved key/checkpoint, reporting
`loginVerified: false` and `apiKeyVerified: false` for current readback.
Both paths always report disconnected functional/authority acceptance false.

The management endpoint remains separately blocked on reviewed private mTLS
authority, private credential transport, connected-engine identity readback,
and functional/restart acceptance. Credentials are useful preparation, not
evidence that Docker was contacted or that the management goal is complete.

## WUD 9.1.0

Pinned [watcher registration](https://github.com/getwud/wud/blob/9.1.0/app/registry/index.ts)
creates a default local Docker watcher when none is declared; a registry-only
or disconnected useful monitoring recipe would be unsupported.

The [Docker watcher](https://github.com/getwud/wud/blob/9.1.0/app/watchers/providers/docker/Docker.ts)
accepts host/port plus `cafile`, `certfile`, `keyfile`, reading the files into its
Dockerode configuration. `remote-watcher.ts` now prepares the exact
`WUD_WATCHER_DOCKER_APPROVED_*` settings with three distinct opaque file IDs and
an explicit DNS name/port. It rejects credentials, URLs, sockets, undeclared
fields and caller assertions of verification. No watcher is started, no TLS
file is acquired/imported, and no endpoint is contacted. The result always
sets `deployable`, `connectionVerified` and `authorizationVerified` false.
Default container watching and events are disabled in this prepared choice;
actual inventory scope still needs separate explicit watched-container selection.
TLS identity, private DNS/dial resolution and deny-write authorization remain
the shared authority owner's work, not assertions accepted by the helper.

WUD administrator/token API contracts remain known from the prior reviews;
they are not published as an empty-dashboard setup adapter because startup
would contact Docker before its separate authority is available.

## Validation scope

One focused Bun 1.4 fixture covers private file preparation/reuse, scoped Compose
planning, administrator identity, stable key creation approval, capture-before-
readback, lost-create refusal, saved-key recovery, and always-false readiness.
It also exercises WUD's settings-only result and invalid endpoint/reference
choices, and rejects plaintext/undeclared CLI password-file paths. The shared
Compose owner required a narrow root-owned allowance for exactly the sourced
`--admin-password-file=/run/secrets/<declared-ref>` option; other secret-bearing
arguments remain rejected. The focused fixture, both changed-module Bun builds,
catalog validation and owned-file diff hygiene passed. These are source/synthetic
checks, not real image acceptance. No Docker,
pulls, browser, CI, host mutation, commits or live account checks were run.
