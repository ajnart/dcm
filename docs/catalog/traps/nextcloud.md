# Nextcloud traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `nextcloud-db`, `nextcloud-redis`, `nextcloud-cron`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- To upgrade old service names, rerun `self-host install immich nextcloud --yes`. Reinstall renders the current definitions and Compose removes orphan containers only in this Project, without deleting volumes. `self-host update` pulls images from saved definitions; it does not rename services.
- Cloud collaboration is heavier than device-to-device folder sync.

## Security

- Require TLS, protected administration, and coordinated database/data backup.
