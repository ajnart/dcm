# Authelia traps

## Pitfalls

- Forward-auth headers and application trust boundaries need per-app testing.
- The file authentication backend requires a writable hashed user database. The mutable owner prepares it exclusively and verifies identity/hash on resume; password resets or changed users stop rather than reseed.
- Official Compose examples require configuration.yml and readable secret files. Authelia requires a user-chosen cookie domain and HTTPS Authelia URL; localhost is explicitly invalid. Access rules, notifier, and proxy wiring need approval for the actual deployment. No public route or identity-provider key can be inferred from a loopback Compose port.
- The file backend creates login users, not a separate administrator API token. Generated login credentials need hash verification, authenticated owner readback, and restart persistence before readiness; a running authentication portal is insufficient.
- The non-root numeric host user bypasses the pinned entrypoint's root-only /config chown. Immutable configuration, writable users, and private SQLite/notifier state use separate mount paths. Source evidence is not live image acceptance.
- An applied private HTTPS route alone cannot bootstrap Authelia: an eligible non-localhost cookie domain, matching HTTPS authelia_url, writable hashed user database, and approved protected application target are required. Verify intended-client DNS/trust, login identity, forward-auth denial and allow behavior, and persistence separately; never relax cookie-domain validation to make the portal start.

## Security

- Protect file-based session, storage, and reset-password secrets and preserve a recovery route.
- Treat proxy trust, session cookie domains, and protected application routes as separately approved ingress decisions.
