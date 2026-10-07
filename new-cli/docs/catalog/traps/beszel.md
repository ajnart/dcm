# Beszel traps

## Pitfalls

- Monitoring can gain host-level visibility beyond ordinary app scope.
- The hub alone has no machine metrics; an agent needs separate privilege and network review.
- The pinned first-run HTTP route creates separate Hub admin and PocketBase superuser accounts. Shared setup uses fixed admin@example.test; change that identity through a separately reviewed workflow, not an unbound runtime input.
- Beszel's universal token is an agent enrollment credential, not a general REST API key; this setup does not create or export it.

## Security

- Treat Docker socket or host-agent access as explicit privilege.
