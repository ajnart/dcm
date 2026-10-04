# Passbolt first-run configuration boundary

Checked 2026-10-03; no runtime or browser deployment. Reused existing app helpers,
canonical-origin declaration, prerequisite document and installability research.
Context7 resolved `/websites/passbolt`; fetched Docker and GPGAuth documentation.

## Upstream verification

[Current official Compose](https://github.com/passbolt/passbolt_docker/blob/master/docker-compose/docker-compose-ce.yaml)
uses MariaDB 10.11 and separate database, server-GPG and JWT volumes. Its sample
floating CE tag, password, hostname and unrestricted published ports are examples,
not safe owner choices. Keep the catalog's 5.16.0-1-ce pin and resolve platform
digests during apply. Never remove or recreate persistent key material on resume.

[Pinned registration source](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/RegisterUserCommand.php)
confirms explicit email/names/admin role, a non-root execution requirement and
`/setup/start/<user-id>/<token>` output. That token is an invitation, not an active
account, password or API key. Existing private parser/argv helper is retained.

[Pinned SMTP configuration](https://github.com/passbolt/passbolt_api/blob/v5.16.0/config/app.default.php)
confirms host/port/sender/TLS variable names. The new pure first-start compiler
emits their common environment-array shape, forces HTTPS, and preserves explicit
owner-selected sender and server-key subjects. It rejects inline secrets and
unknown fields. STARTTLS only; SMTP credential transport remains unimplemented.

[Environment reference](https://www.passbolt.com/docs/hosting/configure/environment-reference/)
documents server-key subject variables as initial generation inputs, not existing
key updates. The helper never generates or rotates keys.
[GPGAuth](https://www.passbolt.com/docs/development/authentication) proves private-key
possession through a challenge and establishes cookies. Neither a health response
nor a setup URL can substitute for owner-client enrollment and encrypted proof.

## Exact shared-engine interfaces still required

1. Persist/bind typed pre-start non-secret environment choices and approved owner
   secret inputs. Reuse canonical-origin/TLS ownership, never fabricate SMTP auth.
2. Fixed Passbolt service/image-bound `www-data` execution profile; approval and
   before-send registration checkpoint.
3. Bounded private-output parser callback and immutable mode-0600 enrollment-link
   capture; ordinary output exposes only its path/reference and user ID. Private
   stdout must not flow through `captureAdminPassword` or API-key storage.
4. Pending-GPG-client onboarding with no generated local/master password; inspect
   exact user/role after ambiguous creation. Lost invitation output is unresolved,
   not permission to rerun registration or issue recovery/reset tokens.
5. Owner-controlled key/passphrase/recovery custody, server-fingerprint verification,
   authenticated owner/admin session, encrypted save/decrypt, restart and restore
   acceptance. No fake durable API key or client-private-key import was added.

Validation: existing affected Passbolt fixture and configuration syntax build
passed using Bun 1.4.0 explicitly on PATH. Coverage includes deterministic replay,
SMTP input rejection, private URL parsing, fixed registration argv and real
catalog prerequisite planning. No broad tests, Docker, browser, CI or support
promotion; no recipe/setup adapter until the interfaces above actually exist.
