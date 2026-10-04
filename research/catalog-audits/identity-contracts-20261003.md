# Authelia and Passbolt app-owned identity contracts

Checked 2026-10-03. Source-only implementation; no Docker, browser, credentials,
network mutation, image verification, CI, commits, or support promotion.

## Implemented

Authelia `configuration.ts` compiles exact owner-selected HTTPS portal/cookie
topology and one distinct protected hostname, deny-first policy, one exact user
subject, local SQLite storage and an explicitly selected private filesystem
notifier. Its cookie classifier is injected by the shared owner: a real PSL and
special-use classifier is required, not a hand-built allowlist or owner assertion.
Localhost is rejected independently. The private `bootstrap.ts` compiler and
resume verifier bind one username/email/display name, empty groups and a bounded
Argon2id PHC digest to the saved generated password through an injected hasher.
They never write or reset an existing user database. The digest/content is private
output, not ordinary status or recipe data.

Passbolt `configuration.ts` binds `APP_FULL_BASE_URL` and fixed registration argv
under `www-data`; owner email/names have no invented defaults. Its bounded private
parser accepts exactly one same-origin `/setup/start/<uuid>/<uuid>` credential.
No password, API token, GPG key, active-user or vault unlock claim is fabricated.
Registration cannot be safely executed by the current core capture profile.

These are executable app helpers, not discovered recipes or pending-only adapters.
The manifests retain their existing guided/discovery support levels.

## Core and owner requirements remaining

- Authelia: real PSL/special-use classification, production Argon2id hasher and
  YAML decoder, atomic create-once private writable database preparation with
  exact image-user access, secret-file declarations and reviewed owner/revision
  provenance. Resume must verify installed identity/hash without reseeding after
  reset. A real proxy owner must wire and test the protected route. Filesystem
  notifier contents need private recovery custody; this is not SMTP delivery.
- Passbolt: exact official CE image pin, approved SMTP configuration/private
  credentials and delivery proof, current time-sync evidence, persistent database/
  GPG/JWT storage, fixed non-root command profile, checkpoint-before-create and
  typed private enrollment-link capture. Save link before further requests;
  read back exact email/admin role; lost stdout stops automatic replay. Enrollment
  and owner GPG/passphrase/recovery-kit custody remain an explicit client gate.
- Both: same-owner canonical-origin/TLS route binding before credential traffic,
  intended-client DNS/trust, exact account acceptance and scoped restart proof.
  Authelia additionally needs anonymous deny/authenticated allow; Passbolt needs
  an encrypted save/decrypt round-trip and isolated complete restore.

No new onboarding kind/schema was added. Full recipes wait for these typed owner
contracts instead of disguising first-user setup as `no-account`.

## Evidence and validation

Context7 library/docs queries succeeded for Authelia and Passbolt. Pinned source
read confirms [Authelia's cookie checks](https://github.com/authelia/authelia/blob/v4.39.25/internal/configuration/validator/session.go),
[mutable database writes](https://github.com/authelia/authelia/blob/v4.39.25/internal/authentication/file_user_provider_database.go),
[Argon2 CLI parameters](https://github.com/authelia/authelia/blob/v4.39.25/docs/content/reference/cli/authelia/authelia_crypto_hash_generate_argon2.md),
and [Passbolt's non-root registration and token-bearing link output](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/RegisterUserCommand.php).
Current [CE instructions](https://www.passbolt.com/docs/hosting/install/ce/docker/)
explicitly leave client completion separate from command registration.

Bun 1.4.0 focused fixtures `authelia-identity-contract.test.ts` and
`passbolt-enrollment-contract.test.ts` passed. Authelia's injected hasher fixture
is synthetic: it verifies compiler/resume behavior, not cryptographic execution.
No live file permissions, upstream config validation, image-user access, account,
TLS/client trust, SMTP, GPG, forward-auth, restart or restore acceptance was run.
