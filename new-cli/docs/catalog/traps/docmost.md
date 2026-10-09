# Docmost traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `docmost-db`, `docmost-redis`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- APP_SECRET and DATABASE_URL have no documented _FILE form; the v2 recipe uses owner-only generated environment, which remains visible to Docker inspection access. Shared first-owner setup uses the fixed admin@example.test email in this batch.
- Bases and Kanban are commercial features, not included in the Community edition.
- Back up PostgreSQL and local attachment storage consistently.

## Security

- Keep the app, database, Redis, and workspace private; persist a random application secret and database credentials outside catalog or rendered manifests.
