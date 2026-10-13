# Nextcloud traps

Source status, 13 October 2026 (before this docs update):
`357af8ac85900f65558ea7bba98513f2be8fccb4`.
The descriptor is normalized to the Stats SDK and registered in `internal/apps/homarr/targets.go`. This establishes source
wiring only; native/rendered data, both installation orders and lifecycle
acceptance remain unproved. Earlier dated evidence retains its original scope.

## Pitfalls

- Auxiliary Compose services use App-owned names: `nextcloud-db`, `nextcloud-redis`, `nextcloud-cron`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- To upgrade old service names, rerun `self-host install immich nextcloud --yes`. Reinstall renders the current definitions and Compose removes orphan containers only in this Project, without deleting volumes. `self-host update` pulls images from saved definitions; it does not rename services.
- Cloud collaboration is heavier than device-to-device folder sync.

## Security

- Require TLS, protected administration, and coordinated database/data backup.
- Homarr uses the recorded `self-host Homarr` app password and token ID for the Project administrator. The app password retains administrator and file-write authority; it is not read-only. Unknown ownership remains Manual. If two-factor authentication prevents headless reissuance, restore only the known matching credential and ID; never disable two-factor authentication.
- Homarr verifies the saved username and redacted password metadata, notifications, and calendar events before one central forced Stats refresh. `messages` counts retrieved notifications with `count` units and requires a nonnegative integer in the original int64-compatible range; explicit zero is valid. Its refresh timestamp must reach the request start. Independently cached native notifications may differ from the refreshed count. The descriptor is registered; rendered/lifecycle acceptance remains a parent-owned hold.
