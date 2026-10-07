# Nextcloud traps

## Pitfalls

- Cloud collaboration is heavier than device-to-device folder sync.
- The CLI uses `nextcloud-redis`, including for cron, separate from Immich's cache. If both Apps were installed with the old shared `redis` service, rerun `self-host install immich nextcloud --yes`; saved credentials, images, and persistent data paths are retained. An old `redis` container may remain as an orphan and needs separately reviewed retirement after its exact Project ownership and remaining references are checked. Reinstall does not delete it automatically.

## Security

- Require TLS, protected administration, and coordinated database/data backup.
