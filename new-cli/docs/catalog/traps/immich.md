# Immich traps

## Pitfalls

- PostgreSQL belongs on suitable local storage; back up database and originals.
- The CLI uses `immich-redis`, separate from Nextcloud's cache. For a Project installed with the old shared `redis` service, rerun `self-host install immich nextcloud --yes` to render both owned sidecars without changing their images or persistent data paths. An old `redis` container may remain as an orphan; inspect its exact Project ownership and remaining references before a separate scoped retirement. Reinstall does not delete it automatically.

## Security

- Keep originals private and protect mobile/session credentials.
