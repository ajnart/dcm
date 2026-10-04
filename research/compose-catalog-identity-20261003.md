# Compose-only identity catalog audit — 2026-10-03

Scope: Authelia, Passbolt CE and Vaultwarden. Source review only; no deployment,
credential access, notifications, browser, runtime, CI or acceptance test.
Existing September 30 app research and the standalone Vaultwarden implementation
were reused and checked against today's shared primitives.

## Decision

No safe `recipe.json` or `setup.ts` can be added for these apps with the current
shared owner. Keep Authelia/Vaultwarden guided and Passbolt discovery-only. Their
manifests now identify the concrete secret, enrollment and TLS gaps rather than
implying that Compose liveness configures an identity service or password vault.

Context7 resolution and official documentation queries succeeded for
`/authelia/authelia`, `/websites/passbolt` and `/dani-garcia/vaultwarden`, outside
the sandbox. No quota fallback was needed. Pinned public raw-source reads also
confirmed Authelia's file provider and Passbolt's registration command. GitHub's
unauthenticated tree API returned 403; directly fetched pinned files were
available. No Docker image digest was resolved.

## Authelia 4.39.25

The [official Docker guide](https://www.authelia.com/integration/deployment/docker/)
requires configuration, an authentication backend, persistence and file-backed
secrets; it is not a generated first-admin-password contract. The pinned
[file provider](https://github.com/authelia/authelia/blob/v4.39.25/internal/authentication/file_user_provider.go)
matches the supplied password against the stored digest and hashes password
changes. Its [database implementation](https://github.com/authelia/authelia/blob/v4.39.25/internal/authentication/file_user_provider_database.go)
decodes password hashes and writes the database back. The
[file-backend reference](https://www.authelia.com/configuration/first-factor/file/)
defaults to Argon2id and documents writable user persistence. There is no
distinct server-administrator password/API token to invent.

The [session contract](https://www.authelia.com/configuration/session/introduction/)
requires an eligible cookie domain and an HTTPS `authelia_url` in its scope;
special-use localhost is unsuitable. The pinned
[validator](https://github.com/authelia/authelia/blob/v4.39.25/internal/configuration/validator/session.go)
checks cookie domains, secure URLs and matching cookie scope. TLS transport alone
does not prove a browser can maintain the required authentication session.

Smallest missing primitive: pre-start, owner-only **secret-derived writable
identity file**. Support one reviewed password-digest format, fixed bounded user
schema, one explicit consumer/UID, atomic first creation and identity/hash
verification on resume. Never overwrite an existing changed user database.
Existing `privateConfigs` interpolate generated raw files and mount read-only;
`bcrypt-hash` binds an environment variable, not a mutable user record. Separately
bind approved DNS/cookie domains, HTTPS portal, notifier and deny-first access
rules, then verify login and one protected forward-auth target. Disabling TLS or
guessing a cookie domain is not a bootstrap fix.

## Passbolt CE

The [Docker guide](https://www.passbolt.com/docs/hosting/install/ce/docker/)
requires working SMTP and time synchronization. It documents `register_user`
under `www-data`, followed by browser registration. The reviewed source pin is
[API 5.16.0](https://github.com/passbolt/passbolt_api/releases/tag/v5.16.0), not a
verified CE Docker image. The exact
[registration command](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/RegisterUserCommand.php)
prints `/setup/start/<user-id>/<authentication-token>`: a private enrollment
credential, not a saved password or proof of active-user login.

The current [official Compose sample](https://github.com/passbolt/passbolt_docker/blob/master/docker-compose/docker-compose-ce.yaml)
has MariaDB, Passbolt, persistent database/GPG/JWT volumes and a database-wait
entrypoint. Its sample password, floating image and host-wide 80/443 mappings must
not be copied into a private ready recipe. The
[environment contract](https://www.passbolt.com/docs/hosting/configure/environment-reference/)
requires the real `APP_FULL_BASE_URL`, SMTP configuration and HTTPS security;
`PASSBOLT_SSL_FORCE=false` is not a production workaround. The
[FQDN guide](https://www.passbolt.com/docs/hosting/fqdn/) treats post-enrollment
origin changes as consequential client-recovery work.

Smallest missing enrollment primitive: privately capture a **typed one-time
registration URL**, restricted to the exact approved origin/path and identity,
after a write-ahead checkpoint. Keep its authentication token out of generic
stdout/reports; an interrupted capture must not auto-register a second user.
The existing `captureAdminPassword` is the wrong semantic/storage boundary.
An owner/browser completion gate must preserve the owner's key, passphrase and
recovery-kit custody, then verify GPG-authenticated identity and an encrypted
round-trip. HTTPS, reviewed SMTP/time facts and a versioned CE image are separate
prerequisites. No undocumented headless registration payload was invented.

## Vaultwarden 1.37.3

The pinned [configuration template](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/.env.template)
requires the actual `DOMAIN`; saved admin configuration can override environment
policy. Closure must account for domain whitelist, invitations and persisted
overrides, not just `SIGNUPS_ALLOWED=false`. The pinned
[configuration implementation](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/config.rs)
loads those retained overrides. The standalone CLI already separates bounded
first signup, registration closure and client/recovery checks; reuse that
lifecycle instead of an admin-page shortcut.

The pinned [environment reader](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/util.rs)
supports `NAME_FILE`, trims its contents and rejects concurrent direct/file
inputs. The [admin reference](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-admin-page)
supports an Argon2id PHC admin token. This is not the account's master password
or encryption key. Existing bcrypt derivation does not substitute for Argon2id;
no admin token is necessary when the separate admin page stays disabled.

The pinned [account models](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/core/accounts.rs)
require client-compatible KDF, authentication hash and wrapped user-key data.
[Identity routes](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/identity.rs)
implement registration completion and password-grant device fields. Server
authentication does not demonstrate client-side unlock. Keep the existing
official-client boundary; do not hand-roll cryptographic enrollment as an
email/password POST. A future headless client needs a pinned implementation,
private inputs, exact owner/TLS binding and decrypted-vault acceptance.

## Common owner gap and verification boundary

`shared-private-https.ts` is explicitly **planning-only**, localhost-only, and
rejects Authelia. It returns false transport/client/application evidence and
blockers for applied TLS, CA export, route persistence and canonical origin.
`setup-transport.ts` still pins HTTP requests to the exact saved loopback port.
The shared recipe's derived origin is not an owner-approved HTTPS identity.

The first common primitive is therefore an ingress-owned, revision-bound
**applied HTTPS setup target plus canonical app origin**: exact backend/service,
TLS hostname/port, pinned owner-exported CA, explicit loopback connection and
SNI/Host, no redirects/bypass/caller CA, and post-approval identity revalidation.
Client DNS/trust remains a separate gate. Authelia additionally needs eligible
non-localhost cookie topology; adding loopback TLS alone cannot unblock it.
Registration-closing environment transitions already exist, but require an
actual app-owned first-account proof and effective-policy readback.

No new executable recipe/adapter was added, so no build, Docker or fixture was
necessary. Focused owned-manifest JSON/source invariants and diff validation are
the only local validation. Fresh first run, replay, login/role/key, intended-client
TLS, scoped restart, Homarr integration and isolated restore remain unverified
for all three apps; a tile or journal readiness receipt does not replace them.
