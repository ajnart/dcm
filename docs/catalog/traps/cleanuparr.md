# Cleanuparr traps

## Pitfalls

- The image tag has no `v` prefix (`ghcr.io/cleanuparr/cleanuparr:2.10.10`) even though the GitHub release is `v2.10.10`.
- Every `/api/` path except `/api/auth/*` answers 403 until first-run setup completes; `/health` always answers. Setup creates the account with `POST /api/auth/setup/account` and finishes with `POST /api/auth/setup/complete`. On a 409 (an account exists but setup never finished, e.g. an interrupted run) Setup still completes it, and the login check catches an account made with other credentials.
- Links add Sonarr (API v4), Radarr (API v6) and qBittorrent by Compose service URL through `/api/configuration/{sonarr,radarr}/instances` and `/api/configuration/download_client`, signed in with a Bearer token from `/api/auth/login`. Responses return URLs with a trailing slash; instances the person added for other hosts are left alone. The enum `typeName` is sent as the string `qBittorrent`.
- Linking does not turn on any cleaner: the Queue Cleaner, Malware Blocker and Download Cleaner stay off until the person picks their rules, because they delete downloads.
- Turning on two-factor sign-in stops the Links from changing Cleanuparr's connections.
- Mount the downloads folder at `/downloads` only to use the unlinked download cleaner; the default recipe does not.

## Security

- Keep the web UI private. Its login locks out after repeated failures, and "disable auth for local addresses" would let anyone on the network in.
- Cleanuparr deletes downloads; review its cleaner rules before enabling them.
