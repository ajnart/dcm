# Gotify traps

## Pitfalls

- The default username and password initialize only when Gotify first creates its database; an existing /app/data volume keeps its current account and must be inspected if login fails.
- Gotify 3.x returns application tokens only on creation or rotation; if the one-time create response is lost, stop for inspection instead of retrying.
- Delivery outside the private network needs TLS and a deliberate mobile connectivity path.
- Setup creates a separate non-admin `self-host-homarr` account. Homarr can only display messages sent by applications owned by that account, not the administrator or other users. Create sending applications while signed in as that account; Setup never sends a notification or subscribes a device.
- The Homarr login uses `GOTIFY_HOMARR_USERNAME` and `GOTIFY_HOMARR_PASSWORD`, with ownership recorded in `GOTIFY_HOMARR_USER_ID`. These are username/password credentials, not an application token or client token. A matching existing account with lost or rejected credentials needs an explicit private ownership/recovery decision; Setup does not adopt it, rotate it, or delete its messages.
- Homarr 2.4.1's Gotify connection test only reads `/health`. A saved connection is not authenticated acceptance. The Link must read notifications and a successful fresh `messages` Stats result; zero is valid, and this count covers only the latest 100 retrieved notifications, not all-time messages or delivery to devices.

## Verification status

The descriptor is defined in `internal/apps/homarr/target_gotify.go` for the reference owner's registry assembly. This peer branch leaves `targets.go` unchanged. Native runtime/widget proof and the complete isolated lifecycle remain pending; no Docker or browser run has been performed for this change. See [the implementation boundary](../../homarr-gotify-boundary.md).

## Security

- Protect application tokens, user accounts, message contents, and WebSocket ingress.
