# Portainer traps

## Pitfalls

- A management UI can mutate projects it does not own.
- The disconnected recipe uses manual-first-admin only for generated admin identity metadata; --admin-password-file performs first-account seeding, not POST /api/users/admin/init. No socket, agent or remote Docker endpoint is supplied.
- A Portainer server without a connected, authenticated Docker environment and owner-authorized readback is not accepted as a working container manager.
- Fresh Portainer CE 2.39.4+ instances require a setup token unless an administrator password is pre-seeded with --admin-password-file; POST /api/users/admin/init alone neither bypasses that gate nor proves endpoint ownership. Do not copy the log-issued setup token or administrator password into commands or ordinary reports.
- Portainer API keys inherit their user's permissions. Pinned 2.45.1 supports POST /api/users/{id}/tokens using that user's authenticated session and password, returning rawAPIKey once; GET inventory cannot recover it. Checkpoint before creation, save before follow-up verification, and never replay an unsaved ambiguous create.

## Security

- Treat socket, Agent, and remote Docker API access as host-wide Docker authority. Require explicit privilege approval and a separately reviewed access boundary; never mount the host socket through the generic recipe or expose an unauthenticated Docker API. For a remote API, require mutually authenticated TLS with certificate verification.
