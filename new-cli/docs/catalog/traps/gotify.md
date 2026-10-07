# Gotify traps

## Pitfalls

- The default username and password initialize only when Gotify first creates its database; an existing /app/data volume keeps its current account and must be inspected if login fails.
- Gotify 3.x returns application tokens only on creation or rotation; if the one-time create response is lost, stop for inspection instead of retrying.
- Delivery outside the private network needs TLS and a deliberate mobile connectivity path.

## Security

- Protect application tokens, user accounts, message contents, and WebSocket ingress.
