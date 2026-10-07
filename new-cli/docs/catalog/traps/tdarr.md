# Tdarr traps

## Pitfalls

- A bad transcode policy can replace source media; test on copies and preserve recoverable originals.
- The documented seededApiKey setting creates a key, not a first-admin identity. The headless adapter separately registers the first admin, verifies login, and saves an owned API key before insertion.
- Port 8266 is the server/API listener and is not published by the shared recipe; only the web UI is mapped to loopback.
- The internal node starts with zero configured workers; approve library write behavior and test on copies before enabling transcoding.

## Security

- Limit worker access to owner-selected libraries and approve GPU or device access explicitly.
- Keep the first-user setup screen private; auth=true does not pre-create an administrator or close registration.
