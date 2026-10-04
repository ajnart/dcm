# Keycloak private recipe evidence (2026-09-29)

The official 26.7.4 container is `quay.io/keycloak/keycloak:26.7.4`. Keycloak documents `start` with PostgreSQL settings and `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` for the initial administrator. These are first-start bootstrap inputs, not a password-reset mechanism on an existing master realm. The official developer guide documents the `admin-cli` password-grant token request against `/realms/master/protocol/openid-connect/token`, followed by an authenticated Admin REST API request. The adapter uses this only on the exact private origin and verifies the master realm; it never records the token.

The recipe publishes only port 8080 on `127.0.0.1`, runs `start` (not `start-dev`) with HTTP enabled and `hostname=localhost`, and keeps PostgreSQL unpublished. This is a private onboarding candidate, **not** a production SSO deployment: Keycloak production guidance requires an explicit hostname and TLS, and reverse-proxy guidance requires correct trusted forwarded-header handling. No public ingress or proxy ownership is inferred. No live image, bootstrap, restart, realm recovery, or TLS path was exercised here.

Sources:

- [Official Docker image and bootstrap environment](https://www.keycloak.org/server/containers)
- [Official image version in getting-started guide](https://www.keycloak.org/getting-started/getting-started-docker)
- [Database configuration](https://www.keycloak.org/server/db)
- [Bootstrap account lifecycle](https://www.keycloak.org/server/bootstrap-admin-recovery)
- [Admin REST token example, version 26.7.4](https://www.keycloak.org/docs/26.7.4/server_development/)
- [Production configuration](https://www.keycloak.org/server/configuration-production)
- [Hostname configuration](https://www.keycloak.org/server/hostname)
- [Reverse-proxy security](https://www.keycloak.org/server/reverseproxy)
