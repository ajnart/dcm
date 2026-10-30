# Oxynote traps

## Pitfalls

- The image runs the whole product (web, API, realtime and an embedded PostgreSQL 18) as UID 65532. `oxynote-init` hands `./data` to that user before each start.
- `OXYNOTE_PUBLIC_URL` is the only origin Oxynote trusts, and its session cookie is set for that host alone. Signing in through any other address fails. With Easy names on, use the name; on this computer only, use `127.0.0.1`.
- The first start creates one workspace with the admin `admin@example.com` and the password `oxynote-admin-1234`, shown on the login page until it changes. Setup signs in with it and sets the Admin password through `/auth-realtime/api/auth/change-password`. Oxynote requires 16 to 128 characters, so a shorter Admin password stops Setup before anything changes.
- Changing the admin's email address in Oxynote stops `self-host check oxynote` from signing in.
- Sign-in allows three attempts in ten seconds and answers 429 with `X-Retry-After`.
- Without an email sender, invitation links are copied by hand from the workspace settings and password reset is off. `OXYNOTE_SMTP_DSN` and `OXYNOTE_EMAIL_FROM_ADDRESS` turn email on.
- The MCP server needs an `https://` origin or a loopback host, so it stays off on a plain `http://` LAN address.
- Shutdown flushes open documents last, so the service keeps a 60 second stop grace period.

## Security

- `./data` holds the database, the generated secrets (session signing, data-source credential encryption) and uploads. Losing it signs everyone out and orphans stored data-source credentials; back it up whole.
- Workspace members can point data sources at any address the container reaches, including other Apps in the Project.
