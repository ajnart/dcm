# Authentik traps

## Pitfalls

- A failed IdP change can lock users out of every protected service.
- The official Compose example mounts the Docker socket for automatic outpost management; omit it and manage outposts separately unless a reviewed privilege boundary is approved.

## Security

- Keep a tested break-glass administrator and protect signing material.
