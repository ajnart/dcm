# Authelia first-run audit — 2026-10-03

Scope: source-only review of official `4.39.25`; no runtime, DNS, TLS or acceptance
claim. Existing configuration, hash/bootstrap and login-state helpers were reused.

- [File backend](https://www.authelia.com/configuration/first-factor/file/)
  documents Argon2id defaults (64 MiB, three iterations, parallelism four,
  16-byte salt and 32-byte key). The app compiler verifies its injected hash
  before returning private JSON/YAML user content. No plaintext/password hash
  belongs in recipe data, commands or ordinary evidence.
- [Pinned database writer](https://github.com/authelia/authelia/blob/v4.39.25/internal/authentication/file_user_provider_database.go)
  parses YAML, decodes password digests and rewrites users after changes. Resume
  must parse the installed format and verify the saved identity/password, not
  compare the original serialized bytes or reseed after password reset.
  Preparation now returns private create content only for explicit absence;
  present valid state returns `reuse` without hashing or replacement bytes.
- [Pinned image](https://github.com/authelia/authelia/blob/v4.39.25/Dockerfile)
  defaults PUID/PGID to zero; [entrypoint](https://github.com/authelia/authelia/blob/v4.39.25/entrypoint.sh)
  chowns `/config` when starting as root before dropping to the configured IDs.
  These facts do not prove a selected host mount is readable/writable. The
  shared owner must establish exact UID/GID, private file custody and exclusive
  first creation, then preserve user DB, SQLite DB and three private secret files.
- [Session requirements](https://www.authelia.com/configuration/session/introduction/)
  require HTTPS and a standard-use cookie domain containing the portal host;
  public suffixes and special-use domains such as localhost are invalid. The
  existing app compiler requires an injected real classifier and explicit
  protected target. No fabricated domain, TLS identity or guessed cookie parent.
- [Pinned login](https://github.com/authelia/authelia/blob/v4.39.25/internal/handlers/handler_firstfactor_password.go)
  mutates regulation/session state, checks the password and replaces the session.
  [State readback](https://github.com/authelia/authelia/blob/v4.39.25/internal/handlers/handler_state.go)
  exposes username, authentication level and knowledge factor. The existing
  contract verifies all three through a fresh privately retained cookie session.

Shared inventory: derived adapters exist for HAProxy, Headscale and MinIO, but no
secret-derived writable identity-file preparation. Existing private configs are
read-only. Private HTTPS currently rejects Authelia and uses `.localhost`; the
canonical-origin transition binds environment values, not these configuration
choices. Therefore no recipe/setup adapter or support promotion is added.

Remaining acceptance: owner-approved real-domain DNS/TLS/proxy and cookie scope,
proven container file permissions, exact login/state, anonymous deny and owner
allow through the selected forward-auth target, intended-client trust and scoped
restart persistence. Homarr uses `homarr:dev`; no native Authelia integration or
widget claim.

Validation: affected Authelia identity-contract fixture and bootstrap Bun build
only, using Bun 1.4.0. These are deterministic source checks, not deployment proof.
