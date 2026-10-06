# Uptime Kuma traps

## Pitfalls

- Its data path requires POSIX locks and is not supported on NFS.

## Security

- Protect the admin UI and notification credentials.
- Creating an API key globally changes /metrics authentication from administrator Basic auth to API-key Basic auth. The owned nonexpiring key is metrics-only, not a general API or MCP token.
