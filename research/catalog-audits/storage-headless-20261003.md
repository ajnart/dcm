# Storage / basic infrastructure headless audit

Checked 2026-10-03 in the feature worktree. Source and synthetic-fixture work
only: no Docker, deployments, runtime/session/secret reads, mail/DNS changes,
remote jobs, CI or commits. Context7 documentation-first queries covered
PostgreSQL, Valkey, Kopia, Unbound, Caddy, Traefik and Nginx Proxy Manager;
version-pinned publisher source resolved response/bootstrap details.

## Fixes

**Nginx Proxy Manager 2.16.0:**
[environment bootstrap](https://github.com/NginxProxyManager/nginx-proxy-manager/blob/v2.16.0/backend/setup.js)
logs `INITIAL_ADMIN_PASSWORD` at INFO. Removed that binding and the email seed.
The recipe now uses existing `manual-first-email` onboarding, not a new shared
engine primitive. The
[status route](https://github.com/NginxProxyManager/nginx-proxy-manager/blob/v2.16.0/backend/routes/main.js)
provides exact version and first-user state; the
[first-user route](https://github.com/NginxProxyManager/nginx-proxy-manager/blob/v2.16.0/backend/routes/users.js)
grants administrator privileges only when no active user exists. The
[request schema](https://github.com/NginxProxyManager/nginx-proxy-manager/blob/v2.16.0/backend/schema/paths/users/post.json)
supports name, nickname, email and password auth.

Setup checkpoints before one POST, rechecks initialization, authenticates the
saved password, verifies enabled administrator email/role through `/api/users/me`
and pins its numeric ID. A lost creation response can reconcile a persisted
account, but an incomplete attempt is not replayed. An initialized instance
without a trusted creation checkpoint is refused. The login bearer stays private
and ephemeral, not a generated durable API key. Pending approval and transport
errors propagate unchanged; only response-body/semantic errors are translated.
Existing deployments made with
the old environment bootstrap may already have credentials in logs; removing the
binding does not erase those logs or rotate that password. Remediation needs
separate owner review and credential rotation.

**Kopia 0.23.1:** require the documented JSON shape, not just HTTP 200, after
the exact `Basic realm="Kopia"` challenge, wrong-password rejection and saved
Basic-auth verification. Its
[current-user handler](https://github.com/kopia/kopia/blob/v0.23.1/internal/server/api_user.go)
returns backup-process username/hostname, not the Basic-auth login identity.
Do not compare this username with `admin`. The
[server routing](https://github.com/kopia/kopia/blob/v0.23.1/internal/server/server.go)
allows this UI endpoint without repository connection. Records explicitly retain
`repositoryVerified: false` and `backupVerified: false`; the manifest now
distinguishes available UI setup from pending repository/backup setup.

**Traefik 3.6.22:** verify 200 plus the documented `OK` body using the existing
read-only adapter helper. A generic successful page must not count as
[ping](https://github.com/traefik/traefik/blob/v3.6.22/docs/content/reference/install-configuration/observability/healthcheck.md).

## Reviewed unchanged boundaries

| Catalog ID / pin | Current proof and remaining acceptance |
| --- | --- |
| `postgresql` / 18.6 | [Official image](https://hub.docker.com/_/postgres) supports password-file initialization and the PostgreSQL 18 `/var/lib/postgresql` volume target. The adapter rejects a wrong TCP password before querying `current_user`; local-socket trust and `pg_isready` are not authentication proof. Separate-client TCP access, persistence and isolated restore remain pending. |
| `valkey` / 9.1.2 | [Security contract](https://valkey.io/topics/security/) requires trusted-network isolation for this explicit unauthenticated/protected-mode-disabled recipe. Local PING remains readiness only; the record does not claim auth or peer connectivity. ACL/TLS, durable workload settings and restore need separate review. |
| `restic` / 0.19.1 | Existing [publisher/password research](backup-missing.md) still applies: portless manual profile, restart no, fixed version probe, saved repository password and empty managed staging. No admin account, initialization, production source coverage or restore proof. |
| `borgmatic` / 2.1.8 | Same manual-job boundary; fixed probe bypasses publisher init/cron. [Publisher](https://github.com/borgmatic-collective/docker-borgmatic) documents `CRON=false` and `BORG_PASSPHRASE_FILE`. Generated config/staging is not a backup. `borg` is not a separate catalog ID. |
| `unbound` / 1.26.0-0 | [Pinned publisher guide](https://github.com/madnuttah/unbound-docker/blob/1.26.0-0/doc/README.md) documents port 5335, drill and the healthcheck path. Setup requires UDP and TCP local DNS answers, stronger than the default open-port healthcheck. Host/peer reachability and public-recursion protection remain unverified. |
| `caddy` / 2.11.4 | [Explicit HTTP address](https://caddyserver.com/docs/caddyfile/concepts) and [respond directive](https://caddyserver.com/docs/caddyfile/directives/respond) support the inert 2015 health route. Admin API is off; no upstream route, TLS/DNS owner or public ports are configured. |
| `rclone` | No catalog folder/recipe/setup exists. Reported absence only; no invented app, remote credentials or job execution. |

The seven non-job service publisher tags were
checked through public Docker Hub tag metadata: PostgreSQL 18.6, Valkey 9.1.2,
Kopia 0.23.1, Unbound 1.26.0-0, Caddy 2.11.4, Traefik v3.6.22 and NPM 2.16.0
returned HTTP 200. This is tag availability, not an immutable-digest apply,
image pull or compatibility test. Manual-job pins reuse the same-date registry
evidence in the prior backup audit.

## Focused validation

`packages/cli/tests/storage-headless-setup.test.ts` passed: synthetic first-user
creation/replay, persisted/lost/incomplete outcomes, unowned and changed identity
rejection, version mismatch, 2FA stop, private result fields, Kopia JSON/auth
challenge/wrong-password validation, pending login approval and transport-error
propagation, Traefik body verification and preserved manual-job/restore boundaries.
The three changed adapter builds and three affected `catalog recipe` validations
passed. Live login, restart persistence, real ingress/DNS clients, snapshots and
isolated restore remain unverified. No support-level promotion was made.
