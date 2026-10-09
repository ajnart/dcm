# Immich traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `immich-database`, `immich-redis`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- To upgrade old service names, rerun `self-host install immich nextcloud --yes`. Reinstall renders the current definitions and Compose removes orphan containers only in this Project, without deleting volumes. `self-host update` pulls images from saved definitions; it does not rename services.
- PostgreSQL belongs on suitable local storage; back up database and originals.

## Security

- Keep originals private and protect mobile/session credentials.
