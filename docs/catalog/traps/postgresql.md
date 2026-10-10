# PostgreSQL traps

## Pitfalls

- Volume copies of a live database are not automatically consistent backups.
- pg_isready reports server availability, not password authentication or application readiness.

## Security

- Default published port binds only to loopback. Do not expose PostgreSQL publicly; keep generated credentials in private files.
