# Scoped operation choreography

## Mutating operations

Keep each phase owned and bounded:

1. Freeze the exact Docker context, project ID, owner, current manifest reference, current version, and operation plan ID.
2. Capture the required backup through `selfhost-backup`; require its restore-drill evidence before proceeding when the operation plan says so.
3. Give the target project manifest to `selfhost-compose`. Run its read-only validation and plan commands. Stop unless both capability plans are `pass` for the same project owner.
4. Ask `selfhost-compose` to render the target into its private directory. Run its exact-project `preflight`, which performs `docker compose config --quiet` without changing containers.
5. Obtain `APPLY:<project>` only after reviewing the redacted diff. A forward-only operation also requires its separate explicit gate before this token.
6. Delegate apply to `selfhost-compose`; it alone runs scoped `up --detach` against the byte-verified file.
7. Run all health and acceptance checks through `selfhost-verify`. Do not equate container state or HTTP 200 with acceptance.
8. On failure, stop further steps. For reversible work, delegate the recorded prior manifest back through the same Compose preflight/apply boundary and restore data when the statement requires it. For forward-only work, follow only the approved forward-recovery statement.

Troubleshooting remains read-only until a separate change plan passes these gates.

## Forbidden shortcuts

Do not operate by container-name discovery, wildcard, directory scan, or inferred ownership. Do not run `docker compose down`, `down --volumes`, `docker system prune`, network prune, volume prune, volume removal, or a broad stop/restart. Do not interpolate credentials into Compose or print resolved configuration.
