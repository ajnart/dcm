# Authentik traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `authentik-worker`, `authentik-postgresql`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- A failed IdP change can lock users out of every protected service.
- The official Compose example mounts the Docker socket for automatic outpost management; omit it and manage outposts separately unless a reviewed privilege boundary is approved.

## Security

- Keep a tested break-glass administrator and protect signing material.
