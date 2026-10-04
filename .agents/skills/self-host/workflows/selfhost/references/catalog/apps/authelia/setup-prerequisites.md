# Authelia 4.39.25 setup boundary

The app-owned derived recipe requires explicit portal origin, eligible cookie
domain, distinct protected origin, username, display name, email, and filesystem
notifier selections. The shared suffix classifier must reject public and
special-use domains; a loopback port never establishes DNS or a cookie domain.

The immutable official image runs as the observed non-root host UID/GID. Its
pinned entrypoint executes directly for non-root users, avoiding its root-only
recursive `/config` ownership change. Explicit `--config` reads immutable
`/etc/authelia/configuration.yml`. Writable users live in `/var/lib/authelia-users`,
with SQLite and private notifier output separately mounted at `/var/lib/authelia`.
No root chown, Docker socket, external database or privileged helper is used.

The owner-private mutable primitive prepares the user database exclusively,
using generated private password bytes through the bounded Bun Argon2 worker.
Resume parses installed JSON/YAML privately and verifies the selected identity
and password digest without replacement. Changed users, password resets,
malformed YAML or unknown owner state stop rather than reseed. The three
documented session/storage/reset secrets remain file-backed.

Setup verifies mutable configuration before authentication. Every request
requires the exact applied HTTPS owner route and saved CA; an unavailable route
must stop before password release. First-factor login is an approved write.
Its Secure HttpOnly cookie is saved only in the private owner/origin-bound store.
Resume reuses that cookie with `GET /api/state`, verifying exact username,
numeric authentication level 1 and `factor_knowledge=true`. Expired or changed
sessions stop and clear private state before a subsequent approved login.

Portal readiness is narrower than SSO acceptance. This recipe does not install
protected-target forward-auth wiring, prove intended-client DNS/trust, deliver
notifications, or prove restart persistence. Setup records keep those claims
false. No separate administrator API token exists for this file-user model.
Eligible domains and loopback HTTPS do not imply public DNS, public TLS or
remote-device trust. Source/fixture validation is not live deployment acceptance.

Further acceptance requires approved target wiring and anonymous-denial plus
authenticated-allowance checks, intended-client DNS/trust, and login/hash
readback after an approved scoped restart.

Sources: [file backend](https://www.authelia.com/configuration/first-factor/file/),
[writable database](https://github.com/authelia/authelia/blob/v4.39.25/internal/authentication/file_user_provider_database.go),
[cookie validator](https://github.com/authelia/authelia/blob/v4.39.25/internal/configuration/validator/session.go),
[non-root entrypoint](https://github.com/authelia/authelia/blob/v4.39.25/entrypoint.sh),
[first factor](https://github.com/authelia/authelia/blob/v4.39.25/internal/handlers/handler_firstfactor_password.go),
[state handler](https://github.com/authelia/authelia/blob/v4.39.25/internal/handlers/handler_state.go).
