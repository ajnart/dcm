# Seafile traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `seafile-db`, `seafile-redis`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- The official image uses initial-admin, database, and JWT environment secrets; Docker operators can inspect container environment.
- The shared recipe verifies administrator login only; library/file round-trip, client sync, restart persistence, and isolated restore remain separate acceptance gates.
- Seafile's configured hostname and protocol must match the selected access route, including a nondefault host port.

## Security

- Keep the private HTTP bind private; require TLS before exposing the service, and recover database and file data together.
