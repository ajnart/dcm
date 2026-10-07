# Kopia traps

## Pitfalls

- The generated repository password does not create or connect a repository; keep it available for an owner-approved repository setup.
- Kopia does not issue an API key during this server-password bootstrap. The saved admin password only verifies private UI access, not backup readiness.
- The current Compose recipe has no repository or snapshot-source mount. A local filesystem repository would live on the same host and would not satisfy the off-host-repository dependency by itself.
- Repository availability, snapshot sources, and isolated restore must be tested independently.

## Security

- Protect repository password, server credentials, and retention policy.
