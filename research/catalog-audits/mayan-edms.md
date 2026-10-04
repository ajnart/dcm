# Mayan EDMS shared candidate — 2026-10-03

Result: source-backed four-service recipe and headless setup adapter, with focused
synthetic validation. **Not live accepted.** This supersedes the Mayan image/API
uncertainty in the earlier documents-missing audit; Passbolt/Vaultwarden remain
separate work. No Docker apply, live account access, or secret inspection occurred.

## Publisher pin and source

Live [publisher tag metadata](https://hub.docker.com/v2/repositories/mayanedms/mayanedms/tags/v4.12.2/)
confirms `mayanedms/mayanedms:v4.12.2`, pushed 2026-09-17, index digest
`sha256:03f7f43a686433e7dfc1151c3df37d8c376149e59b026008a5e846e578f03747`.
AMD64 manifest: `sha256:8833b6d9622d80831d2b054849aaf470fe06a00e74f667128f98ff8b28247b6f`;
ARM64: `sha256:212f8f36051f611b338b063707d00173ffba5eba507fddcf1c9d9f5894b9bcfb`.
The recipe is tag-pinned and the shared apply still requires separately resolved
image digests. These public metadata observations do not substitute for image
runtime acceptance.

Live GitLab API resolves source commit `834ffec1b539171390358e60a0406870108514f5`
(2026-09-21, Docker files), following `9bfe1343639f425b9e5824b53a43a3ad791a080f`
(version 4.12.2). The [pinned Compose](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/docker/docker-compose.yml)
supports `all_in_one`: app, PostgreSQL 15.17, RabbitMQ 4.1.8-management, Redis
7.4.8. Optional Elasticsearch, worker splits, mirrors, backups, and Traefik are
not required for this candidate; none is silently enabled. Database/broker
management ports remain unpublished; the default host binding is loopback 8080,
forwarding to container port 8000.

The public AMD64 image config declares user `root`, entrypoint
`/usr/local/bin/entrypoint.sh`, and command `run_all`. Its bounded 7,965-byte script
layer (`sha256:b50503d82f2c93714129b136cdc96cec30cc21d1043a6c0be0d4eb77462b35de`)
was inspected in memory, without Docker. Initialization runs as image-default
root and application commands use `runuser --user mayan`; `run_all` initializes
or performs the image's upgrade routine before starting supervisor.

## Private configuration and readiness

The agreed generic `private-config` environment binding derives five upstream
settings: database dictionary, AMQP URL, Redis result URL, Redis lock dictionary,
and Redis event dictionary. Generated base64url values are safe literal
dictionary/URI components; no eval or guessed `*_FILE` variable is introduced.
PostgreSQL consumes its documented password file; RabbitMQ consumes the same
generated broker password used by its app URI.

Redis uses an owner-only generated config, not password-bearing argv. Its
[official entrypoint](https://github.com/redis/docker-library-redis/blob/0ae559ebb19b1cafc36720e8de97839d5d402883/7.4/debian/docker-entrypoint.sh)
explicitly supports `--user`; the recipe selects the current host UID and a
host-owned data bind so that mode-0600 config is readable without widening file
permissions. Actual intended-context readability remains a live acceptance
check. `REDISCLI_AUTH` supplies the CLI password privately; `redis-cli -e ping`
fails on command errors, as defined in [Redis 7.4.8 source](https://github.com/redis/redis/blob/7.4.8/src/redis-cli.c).
Database, RabbitMQ, and Redis health gates precede app startup. Health does not
prove application credentials or document processing.

## First administrator and durable token

[Pinned bootstrap manager](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/autoadmin/managers.py)
creates the initial superuser from generated admin environment values. Explicit
`MAYAN_AUTOADMIN_LOG_CREDENTIALS=false` prevents logging; the generic policy
exception permits only the exact string `false`.

Important correction: supplying an initial password does **not** suppress the
login-page credential display. The pinned manager stores that password in the
autoadmin singleton. The adapter authenticates the saved password first, then
performs one approved same-password PATCH on `/api/v4/users/current/`. A fresh
password hash triggers the [cleanup handler](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/autoadmin/handlers.py).
Before readiness, the adapter checks the private login page no longer contains
the saved password. Lost responses reconcile readback without replaying PATCH.
Keep the bootstrap route private until this check succeeds.

[Pinned API routes](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/rest_api/urls.py)
and [token view](https://gitlab.com/mayan-edms/mayan-edms/-/raw/834ffec1b539171390358e60a0406870108514f5/mayan/apps/rest_api/api_views.py)
establish POST `/api/v4/auth/token/obtain/`. Mayan pins DRF 3.17.2;
[that implementation](https://github.com/encode/django-rest-framework/blob/3.17.2/rest_framework/authtoken/views.py)
accepts username/password and gets or creates one durable token. Save the valid
returned token privately **before** follow-up network checks. An attempted
request with no saved token stops; setup does not replay it.

Basic and Token authentication both verify active saved identity and access to
`/api/v4/users/` containing that exact owner. This is the sourced
user-view permission/owner-visibility proof, **not administrator authority or
an invented `is_superuser` response flag**. A demoted owner with delegated
user-view access can pass; the pinned serializer does not expose its actual
staff/superuser flags. The result stage is `owner-login-and-api-token-verified`
with `administratorAuthority: "not-verified"`; readiness covers only owner
login, saved token, user-view access, and absent credential disclosure. Actual
administrator-role/function acceptance and full compatibility remain pending.
Anonymous `/api/v4/users/current/` must return 401/403. The checked Homarr
registry has no dedicated Mayan integration; no integration or key consumer is
invented.

## Validation

`mayan-edms-setup.test.ts` exercises real private HTTP transport and checkpoints
against synthetic responses: fresh cleanup/token flow, saved-token replay,
lost cleanup reconciliation, lost token refusal, identity mismatch, missing
administrative permission, anonymous access, and renewed credential disclosure.
The adapter/fixture build checks and catalog validation passed. No Docker,
image execution, actual file-readability, first-account, document round-trip,
restart, or isolated restore was performed. Support remains guided.
