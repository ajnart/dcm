# Syncthing traps

## Pitfalls

- Synchronization propagates deletions and is not a backup.
- An unpublished peer/discovery port or container bridge can leave the GUI running while device sync is unusable.
- The documented offline credential generator and API-key-protected REST configuration need an exact private-file/container-operation primitive before shared setup can claim readiness.

## Security

- Authenticate and restrict the GUI before any non-loopback exposure; the official Docker image listens on all container interfaces by default.
- Protect the device private key and API key; review each device and folder share separately.
