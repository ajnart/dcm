# Frigate traps

## Pitfalls

- Retention and inference load can exhaust storage or compute.
- The bootstrap explicitly disables TLS only on the private authenticated 8971 listener; authentication remains enabled. Internal unauthenticated 5000 is unpublished and bound to container loopback, so the no-secret Homarr integration does not yet have an authorized service-network endpoint.
- The read-only, camera-free bootstrap config pins schema version 0.18-0. Camera additions need a separately approved writable owner-configuration boundary; the starter does not provide recording, detection, camera or hardware acceptance.
- Only an exact-current-start fresh-user log block may supply the temporary password; reset blocks and ambiguous logs must be refused. Rotation checkpoints before PUT and never repeats an uncertain update. A login JWT is not a durable API key.

## Security

- Keep camera credentials secret; keep unauthenticated port 5000 unpublished; approve GPU/TPU devices explicitly.
- Capture the generated admin password only from this exact owned container's current startup into an owner-only file, rotate it with an approved checkpoint, and verify authenticated access. Do not dump container logs into reports.
