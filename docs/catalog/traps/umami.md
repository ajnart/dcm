# Umami traps

## Pitfalls

- Self-hosting does not remove consent, retention, or data-governance duties.
- The seeded administrator is reachable on the selected loopback origin until the separately approved password-rotation setup completes; never expose it more broadly before rotation is verified.

## Security

- Keep administration private, change the seeded admin/umami password immediately, generate unique APP_SECRET and TWO_FACTOR_ENCRYPTION_KEY values, and minimize collected visitor data.
