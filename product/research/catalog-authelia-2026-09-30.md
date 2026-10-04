# Authelia shared-recipe boundary (2026-09-30)

Decision: keep Authelia guided. Do not add a shared v2 recipe or `setup.ts` yet. The official image is pinned in the catalog to `docker.io/authelia/authelia:4.39.25`, but a started container alone cannot authenticate a first administrator or prove forward-auth works.

The official Docker example mounts `/config` and uses file-backed JWT, session, PostgreSQL-password, and storage-encryption secrets. It expects the operator to edit both `configuration.yml` and `users_database.yml`, including replacing the example user's default password. Authelia's file authentication backend stores password hashes in a YAML user database and writes that file back on password resets. There is no documented first-admin bootstrap environment variable or API key to hand off. A local first-user setup must therefore derive a password hash from the generated private password, write a secret-bearing and writable identity database at the exact mounted path, and verify authentication on replay. Static `configFiles` explicitly hold literal non-secret content, and `privateFiles` hold opaque random bytes; neither safely creates this structured, writable user file. Existing onboarding kinds do not represent this flow.

The missing shared primitive is a bounded secret-derived configuration/identity file: generate the password, hash it using Authelia's pinned algorithm/CLI, atomically create an owner-only writable user database with a fixed username, checkpoint its provenance, and on replay verify the saved generated credential against the existing identity without replacing it. It also needs a source-backed login check and failure behavior for pre-existing or modified users. A simple HTTP 200 or container health response is insufficient.

Separately, session cookie domains and the Authelia URL, access-control rules, notifier, and reverse-proxy forward-auth integration depend on the owner's DNS/TLS/ingress topology. They must be selected and approved rather than baked into a generic loopback recipe. No live image, Docker, browser, login, restart-persistence, or ingress check was performed.

Primary sources:

- [Official v4.39.25 release and image tag](https://github.com/authelia/authelia/releases/tag/v4.39.25)
- [Docker deployment and Compose examples](https://www.authelia.com/integration/deployment/docker/)
- [File authentication backend and writable user database](https://www.authelia.com/configuration/first-factor/file/)
- [Documented secret-file environment inputs](https://www.authelia.com/configuration/methods/secrets/)
- [First-factor backend choices](https://www.authelia.com/configuration/first-factor/introduction/)
- [Initial configuration and cookie-domain requirements](https://www.authelia.com/integration/prologue/get-started/)
