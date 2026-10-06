# Plex traps

## Pitfalls

- Features and account requirements vary by subscription and release.
- The image ignores PLEX_CLAIM after the server is already logged in, so retries must inspect existing ownership before changing claim state.
- The upstream bootstrap writes /.firstRunComplete even when claim exchange fails. An expired or invalid first-run claim requires explicit inspection and reviewed recovery; restarting or rerunning extraction does not automatically retry claiming.
- The unauthenticated /identity endpoint reports claimed status and machine identity, not the owning Plex account; a local HTTP 200 or claimed=true is insufficient acceptance. The owner must verify the server in their Plex account before any claim of first-run completion.

## Security

- Treat the Plex claim token and resulting server token as private account credentials.
- Keep the server port private until claim ownership is verified; remote access and discovery ports need separate review.
- Do not put PLEX_CLAIM in catalog data, a generated Compose file, or Docker command arguments. Use the upstream bootstrap's PLEX_CLAIM_FILE with an owner-issued private token; a generated password cannot replace the account-bound claim token.
- Never enable DEBUG: the upstream bootstrap's shell tracing can expose claim and server tokens.
