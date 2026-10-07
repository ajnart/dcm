# Traefik traps

## Pitfalls

- The recipe never enables insecure API/dashboard access. Control-interface credentials do not create Traefik user records; existing owners are not silently migrated or given replacement credentials.

## Security

- Protect the Docker API and authenticate the dashboard.
