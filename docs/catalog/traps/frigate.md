# Frigate traps

## Pitfalls

- Retention and inference load can exhaust storage or compute.
- The bootstrap explicitly disables TLS only on the private authenticated 8971 listener; authentication remains enabled. Homarr's pinned adapter requires HTTPS, username/password and a verified admin profile; it has no no-secret alternative. Port 5000 is never a fallback. A separately approved Project-scoped TLS configuration and certificate trust in both Homarr and the CLI are prerequisites for the Link.
- The read-only, camera-free bootstrap config pins schema version 0.18-0. Camera additions need a separately approved writable owner-configuration boundary; the starter does not provide recording, detection, camera or hardware acceptance.
- The live first-login flag and exactly one fresh-user log block must agree before the temporary password is tried. Any reset block or ambiguous log is refused as a Manual step. Runtime acceptance must establish that the captured block belongs to the owned container's current startup. Rotation checkpoints before PUT and never repeats an uncertain update. A login JWT is not a durable API key.
- Setup and Check freshly deny anonymous profile access, verify the expected admin profile and read authenticated server statistics. Login-page HTTP 200, a missing session cookie or missing fields are not readiness. Zero cameras is a valid starter, not proof of recording or detection. See [the Frigate Homarr contract](../../homarr-frigate-contract.md).

## Security

- Keep camera credentials secret; keep unauthenticated port 5000 unpublished; approve GPU/TPU devices explicitly.
- Capture the generated admin password only from this exact owned container's current startup into an owner-only file, rotate it with an approved checkpoint, and verify authenticated access. Do not dump container logs into reports.
