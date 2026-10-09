# Keycloak traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `keycloak-db`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Development-mode quick starts are not production templates.
- A loopback-only HTTP container is not a complete TLS-backed identity-provider deployment.

## Security

- Use production mode with a production database, TLS, an explicit hostname, protected admin access, and realm export/recovery.
