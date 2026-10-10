# HAProxy traps

## Pitfalls

- The official image has no default configuration and runs as haproxy UID/GID 99. Only the publisher-evidenced non-secret configuration may be container-readable; generated passwords and hash env files remain owner-private. Do not change the container to root or relax private files.
- Configuration reload and certificate lifecycle need explicit ownership.

## Security

- Protect statistics/admin endpoints and certificate material.
- Keep the listener private until a separately approved ingress route has one DNS/TLS/auth owner.
