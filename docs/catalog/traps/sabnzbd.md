# SABnzbd traps

## Pitfalls

- Provider access and retention are external operational dependencies.
- Select completed and incomplete paths with the Arr import layout; differing paths or filesystems can prevent hardlinks or atomic moves.

## Security

- Treat provider credentials, server configuration, and the SABnzbd API key as secrets.
- Keep its WebUI private; the API key is accepted as a query parameter by the upstream API.
