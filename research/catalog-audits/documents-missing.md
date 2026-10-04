# Documents and password vaults: shared setup gaps

Checked: 2026-10-03. Scope: Mayan EDMS, Passbolt CE, Vaultwarden.

Result: none of these three can truthfully become configured shared apps through
the current recipe/setup interface. No recipe, fake `no-account` adapter,
administrator reset, or guessed registration route was added. Manifest evidence
was refreshed without promoting support. No Docker apply or secret access occurred.

## Mayan EDMS

[Official installation](https://docs.mayan-edms.com/chapters/docker/install_docker_compose.html)
and [first steps](https://docs.mayan-edms.com/chapters/getting_started.html)
currently identify documentation version 4.12.2. They document initial account
seeding with `MAYAN_AUTOADMIN_USERNAME` and `MAYAN_AUTOADMIN_PASSWORD`.
This is first-database bootstrap, not permission to reset an existing account.

The [official Compose source](https://gitlab.com/mayan-edms/mayan-edms/-/raw/master/docker/docker-compose.yml)
has both an `all_in_one` application profile and an optional multi-container
topology. A worker split is not inherently required. However, its app uses
`MAYAN_DATABASES` (a Django dictionary), `MAYAN_CELERY_BROKER_URL` (AMQP),
`MAYAN_CELERY_RESULT_BACKEND` (Redis DB 1),
`MAYAN_LOCK_MANAGER_BACKEND_ARGUMENTS` (Redis DB 2 dictionary), and
`MAYAN_SERVER_SIDE_EVENTS_BACKEND_ARGUMENTS` (Redis DB 3 dictionary).
Each embeds one of the database, RabbitMQ, or Redis passwords. The upstream
Redis command and healthcheck also place its password in argv: do not copy that
pattern into a managed recipe. A generated private Redis config and secret-safe
health check need separate source/runtime proof.

Required shared primitives: bounded secret URI encoding plus typed dictionary
serialization, and generated private service config consumption. Ordinary
`secretEnvironment` supports only a direct secret or the existing typed
PostgreSQL URL, not these expressions. `privateConfigs` can interpolate a saved
file into a private file, but does not bind its contents as structured app
environment settings; inventing a `_FILE` variable is not a solution.

Pinning is pending: the reviewed master Compose defaults to `s4.12`, not an
immutable 4.12.2 image. Guessed `v4.12.2` and `4.12.2` source paths returned 404;
the `s4.12.2` source fetch was unresolved. Do not infer a tag or digest.
After derivations/pinning, verify generated admin authentication and an
authenticated current-user response, save a durable API credential only where
the pinned API supports it, then replay, document round-trip, and restart.

## Passbolt CE

[Docker installation](https://www.passbolt.com/docs/hosting/install/ce/docker/)
requires SMTP and time synchronization, and recommends an explicit version tag.
Its [sample Compose](https://github.com/passbolt/passbolt_docker/blob/master/docker-compose/docker-compose-ce.yaml)
uses an example HTTPS hostname, floating application tag, sample database
password, and host 80/443 publications. None is an approved shared default.
See also the [environment reference](https://www.passbolt.com/docs/hosting/configure/environment-reference/)
and [TLS guide](https://www.passbolt.com/docs/hosting/tls/ce/docker-manual/).

Required shared primitives: owner-selected stable private HTTPS origin with
certificate/client trust verification; approved SMTP inputs/private credentials
with real delivery proof; time-sync observation; private one-time registration
link capture; owner-controlled browser extension/key/passphrase/recovery-kit
enrollment. The documented `register_user` command creates an enrollment link,
not a generated administrator password. Link issuance is pending enrollment,
not ready. `captureAdminPassword` must not capture the URL as a password.

Application/image version is not pinned in this audit. A Docker-repository
release number is not automatically the Passbolt application image version.
First-admin enrollment, fresh authenticated login, encrypted secret round-trip,
replay, restart, and recovery remain unverified.

## Vaultwarden 1.37.3: reuse existing capabilities

Source-backed pin: [1.37.3 release](https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.3),
[configuration](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/.env.template),
[registration/account models](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/core/accounts.rs),
and [identity routes](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/identity.rs).
Registration uses client-derived KDF/master-password hash and encrypted key
material, not a plaintext generic create-user request. Server authentication
alone is not client-side vault unlock. `ADMIN_TOKEN` is server administration,
not vault owner authentication or a durable Homarr API credential.

Reuse, rather than rewrite, these existing implementation boundaries:

- `packages/cli/src/vaultwarden-local-https.ts`: reviewed private hostname/bind,
  route ownership, Caddy image digest, public CA export and TLS transport proof.
- `packages/cli/src/vaultwarden.ts`: bootstrap owner checks, exact image pin,
  first-signup eligibility, nonce browser session, durable before-submission
  attempt ledger, fresh identity-matched login, separate registration-closure
  Compose plan/approval, no signup replay after interrupted/unknown attempts.
- `.agents/skills/self-host/workflows/selfhost-setup/scripts/household-browser-credentials.ts`:
  CA-trusted pinned web-client signup/login and account identity proof. Never
  expose its populated browser output or credential payloads.

The current shared context exposes exact loopback HTTP/container operations,
but no reviewed HTTPS route/CA/browser authority. Legacy code binds a standalone
run and a separate ingress owner; merely invoking that CLI from shared setup
does not port ownership into one shared Compose project. Required reusable
interfaces are shared-owner private HTTPS/TLS proof, private browser credential
submission with a durable attempt ledger, and an independently approved
signup-closure revision. The existing `postFirstAccountEnvironment` metadata
alone does not establish those runtime actions or effective policy readback.

Closure must verify `SIGNUPS_ALLOWED=false`, empty domain whitelist, invitation
policy, and persisted config overrides, followed by fresh login/unlock and a
registration-unavailable check. No API reimplementation or browser run occurred.

## Homarr and validation boundaries

The checked Homarr registry contains no dedicated integration identifier for
these three apps. A future URL tile is a separate partial claim; do not invent
an API key or call it an integration.

Context7 CLI library/docs lookup was used for Mayan and Vaultwarden; official
source/installation pages were inspected directly to verify pinned behavior.
The catalog manifests were checked locally as JSON with matching IDs, valid
check dates, and HTTPS source URLs. No setup code or fixture was added because
the actual shared primitive gaps remain. No broad tests, Docker compilation,
live account creation, browser, TLS, restart, SMTP, or restore acceptance ran.
